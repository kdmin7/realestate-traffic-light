#!/usr/bin/env python3
"""validate_board.py - 게시판 발행 전 결정적 검증

LLM 판단에 맡기지 않고 규칙으로 잡을 수 있는 것만 검사한다.
  1) 초안(draft) 형식: 등급 태그, 출처, 기준일, 패널 구성
  2) 근거 파일(sources)의 메타: evidence_grade(A/B), source_url, as_of
  3) 점수 파일의 입력 등급: A/B 이외 등급이 점수 입력에 섞이지 않았는지
  4) 규칙 테이블(rules/rules.json): 검증 상태와 확인 시점
  5) 금지 문구(config/forbidden_phrases.json)

종료 코드: 0 통과 / 2 실패(훅에서 도구 호출을 막음) / 1 사용법 오류

사용 예:
  python3 scripts/validate_board.py                      # 모든 초안 + 규칙 검사
  python3 scripts/validate_board.py --draft songpa       # 초안 하나
  python3 scripts/validate_board.py --only meta          # data/ 전체 메타 감사
  python3 scripts/validate_board.py --hook               # Claude Code 훅(표준입력 JSON에서 slug 추출, 실패 시 종료 코드 2)
  python3 scripts/validate_board.py --agy-hook           # Antigravity 훅(표준입력 JSON -> 표준출력 JSON 결정)
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

FACT_GRADES = {"A", "B"}
ALL_GRADES = {"A", "B", "C", "D", "E"}
TAG_FACT = re.compile(r"\[(A|B) \| [^|\]]+ \| \d{4}-\d{2}(-\d{2})?\]\s*$")
TAG_OPINION = re.compile(r"^- \[(C|D|E)\]")
DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
BUDGET_RE = re.compile(r"대출|LTV|DSR|구매력")

DEFAULT_POLICY = {
    "data_dirs": ["data/re-market-data", "data/re-safety-analyst", "data/re-trend-risk"],
    "score_dirs": ["data/re-trend-risk"],
    "draft_dir": "data/board/drafts",
    "max_age_days": {"draft": 45, "rules": 30, "data": 45},
}
OPINION_REQUIRED = {
    "C": ["출처:", "이해관계:", "검증:"],
    "D": ["시장 국면:", "인증:"],
    "E": ["가정:"],
}


def today() -> dt.date:
    override = os.environ.get("BOARD_TODAY")
    if override:
        return dt.date.fromisoformat(override)
    return dt.date.today()


def parse_date(value):
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    parts = [int(x) for x in value.split("-")]
    try:
        if len(parts) == 2:
            year, month = parts
            nxt = dt.date(year + (month == 12), 1 if month == 12 else month + 1, 1)
            return nxt - dt.timedelta(days=1)
        return dt.date(*parts)
    except ValueError:
        return None


def parse_frontmatter(text):
    """(meta, body, offset) 반환. offset은 본문 앞에 있던 줄 수."""
    if not text.startswith("---"):
        return {}, text, 0
    lines = text.split("\n")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return {}, text, 0
    meta = {}
    for ln in lines[1:end]:
        if not ln.strip() or ln.lstrip().startswith("#") or ":" not in ln:
            continue
        key, val = ln.split(":", 1)
        val = re.sub(r"\s+#.*$", "", val.strip())
        if val.startswith("[") and val.endswith("]"):
            meta[key.strip()] = [x.strip().strip("'\"") for x in val[1:-1].split(",") if x.strip()]
        else:
            meta[key.strip()] = val.strip("'\"")
    return meta, "\n".join(lines[end + 1:]), end + 1


def split_sections(body, offset):
    """[(제목, [(파일 줄번호, 텍스트), ...]), ...]"""
    sections = []
    title, cur = "", []
    for i, ln in enumerate(body.split("\n")):
        if ln.startswith("## "):
            sections.append((title, cur))
            title, cur = ln[3:].strip(), []
        else:
            cur.append((offset + i + 1, ln))
    sections.append((title, cur))
    return sections


class Report:
    def __init__(self):
        self.errors, self.warnings, self.checked = [], [], []

    def err(self, file, rule, msg, line=None):
        item = {"file": str(file), "line": line, "rule": rule, "message": msg}
        if item not in self.errors:
            self.errors.append(item)

    def warn(self, file, rule, msg, line=None):
        item = {"file": str(file), "line": line, "rule": rule, "message": msg}
        if item not in self.warnings:
            self.warnings.append(item)

    def promote_warnings(self):
        self.errors.extend(self.warnings)
        self.warnings = []

    @property
    def ok(self):
        return not self.errors

    def to_dict(self):
        return {"ok": self.ok, "errors": self.errors, "warnings": self.warnings, "checked": self.checked}

    def format(self):
        out = []
        for tag, items in (("E", self.errors), ("W", self.warnings)):
            for it in items:
                loc = it["file"] + (f":{it['line']}" if it["line"] else "")
                out.append(f"[{tag}] {loc} [{it['rule']}] {it['message']}")
        out.append(f"검사 대상 {len(self.checked)}개, 오류 {len(self.errors)}건, 경고 {len(self.warnings)}건 -> {'통과' if self.ok else '실패'}")
        return "\n".join(out)


def load_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def load_policy(root):
    policy = dict(DEFAULT_POLICY)
    custom = load_json(root / "config" / "board_policy.json", {})
    for k, v in custom.items():
        if isinstance(v, dict) and isinstance(policy.get(k), dict):
            policy[k] = {**policy[k], **v}
        else:
            policy[k] = v
    return policy


def rel(root, path):
    try:
        return Path(path).resolve().relative_to(root.resolve())
    except ValueError:
        return Path(path)


def check_evidence_file(root, path, policy, rep, is_score=False):
    """근거 파일(data/…)의 메타 검사."""
    r = rel(root, path)
    rep.checked.append(str(r))
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        rep.err(r, "meta.missing", "근거 파일을 읽을 수 없습니다.")
        return
    meta, _, _ = parse_frontmatter(text)
    if not meta:
        rep.err(r, "meta.frontmatter", "frontmatter(---)가 없습니다. evidence_grade, source_url, as_of가 필요합니다.")
        return
    grade = meta.get("evidence_grade")
    if grade not in FACT_GRADES:
        rep.err(r, "meta.grade", f"evidence_grade는 A 또는 B여야 합니다. 현재 값: {grade!r}")
    if not meta.get("source_url"):
        rep.err(r, "meta.source", "source_url이 비어 있습니다.")
    as_of = parse_date(meta.get("as_of"))
    if as_of is None:
        rep.err(r, "meta.as_of", f"as_of가 없거나 형식이 틀립니다(YYYY-MM 또는 YYYY-MM-DD): {meta.get('as_of')!r}")
    else:
        limit = policy["max_age_days"].get("data", 45)
        if (today() - as_of).days > limit:
            rep.warn(r, "meta.stale", f"기준일이 {limit}일보다 오래됐습니다({meta.get('as_of')}). 갱신 지연 표시 대상입니다.")
    if is_score or any(r.as_posix().startswith(d.rstrip("/") + "/") for d in policy.get("score_dirs", [])):
        ig = meta.get("inputs_grades")
        if not isinstance(ig, list) or not ig:
            rep.err(r, "scores.inputs", "점수 파일에는 inputs_grades: [A, B] 형식의 입력 등급 목록이 필요합니다.")
        elif not set(ig) <= FACT_GRADES:
            rep.err(r, "scores.inputs", f"점수 입력에 A·B 이외 등급이 섞였습니다: {ig}")


def rules_status(root, policy):
    data = load_json(root / "rules" / "rules.json", None)
    if data is None:
        return None
    out = []
    limit = policy["max_age_days"].get("rules", 30)
    for rule in data.get("rules", []):
        checked = parse_date(rule.get("checked_at"))
        age = (today() - checked).days if checked else None
        problems = []
        if rule.get("status") != "verified":
            problems.append("status가 verified가 아님")
        if rule.get("value") is None:
            problems.append("value가 비어 있음")
        if not rule.get("source_url"):
            problems.append("source_url 없음")
        if checked is None:
            problems.append("checked_at 없음")
        elif age > limit:
            problems.append(f"확인 후 {age}일 경과(한도 {limit}일)")
        out.append({"id": rule.get("id"), "status": rule.get("status"), "checked_at": rule.get("checked_at"),
                    "age_days": age, "ok": not problems, "problems": problems})
    return out


def check_rules(root, policy, rep, required):
    path = root / "rules" / "rules.json"
    status = rules_status(root, policy)
    rep.checked.append("rules/rules.json")
    emit = rep.err if required else rep.warn
    if status is None:
        emit("rules/rules.json", "rules.missing", "규칙 테이블이 없습니다.")
        return
    bad = [st for st in status if not st["ok"]]
    if bad:
        detail = "; ".join(f"{st['id']}({st['problems'][0]})" for st in bad)
        emit("rules/rules.json", "rules.unverified",
             f"검증되지 않았거나 오래된 규칙 {len(bad)}개: {detail}. 값은 공식 공고 원문으로 채우고 status를 verified로 바꾸세요.")


def load_phrases(root):
    return load_json(root / "config" / "forbidden_phrases.json", [])


def check_draft(root, path, policy, phrases, rep):
    """초안 하나를 검사하고 예산 관련 내용 포함 여부를 반환."""
    r = rel(root, path)
    rep.checked.append(str(r))
    try:
        text = Path(path).read_text(encoding="utf-8")
    except OSError:
        rep.err(r, "draft.missing", "초안을 읽을 수 없습니다.")
        return False
    meta, body, offset = parse_frontmatter(text)
    stem = Path(path).stem
    if not SLUG_RE.match(stem):
        rep.err(r, "draft.slug", "파일명(slug)은 영문 소문자·숫자·-_ 로 64자 이하여야 합니다.")
    for key in ("slug", "region", "as_of", "status"):
        if not meta.get(key):
            rep.err(r, "draft.meta", f"frontmatter에 {key}가 없습니다.")
    if meta.get("slug") and meta["slug"] != stem:
        rep.err(r, "draft.slug", f"slug({meta['slug']})가 파일명({stem})과 다릅니다.")
    if meta.get("status") and meta["status"] not in ("draft", "reviewed"):
        rep.err(r, "draft.status", f"status는 draft 또는 reviewed여야 합니다: {meta['status']}")
    as_of = parse_date(meta.get("as_of"))
    if meta.get("as_of") and as_of is None:
        rep.err(r, "draft.as_of", f"as_of 형식이 틀립니다: {meta['as_of']}")
    elif as_of is not None and (today() - as_of).days > policy["max_age_days"].get("draft", 45):
        rep.err(r, "draft.stale", f"초안 기준일이 오래됐습니다({meta['as_of']}). 데이터를 갱신하세요.")

    sources = meta.get("sources")
    if not isinstance(sources, list) or not sources:
        rep.err(r, "draft.sources", "frontmatter에 sources: [근거 파일 경로, ...]가 필요합니다.")
    else:
        for s in sources:
            sp = root / s
            if not sp.is_file():
                rep.err(r, "draft.sources", f"근거 파일이 없습니다: {s}")
            else:
                check_evidence_file(root, sp, policy, rep)

    sections = split_sections(body, offset)
    titles = [t for t, _ in sections]
    if not any(t.startswith("사실 패널") for t in titles):
        rep.err(r, "draft.panels", "'## 사실 패널' 섹션이 없습니다.")
    if not any(t.startswith("의견 패널") for t in titles):
        rep.err(r, "draft.panels", "'## 의견 패널' 섹션이 없습니다(견해·경험이 없으면 '해당 없음'으로 두세요).")

    facts_text = []
    for title, lines in sections:
        is_fact = title.startswith("사실 패널") or title.startswith("요약")
        is_opinion = title.startswith("의견 패널")
        for no, ln in lines:
            if is_fact:
                facts_text.append(ln)
                if ln.startswith("- ") and not TAG_FACT.search(ln):
                    rep.err(r, "facts.tag", "사실 패널 항목 끝에 [A|출처|기준일] 또는 [B|출처|기준일] 태그가 필요합니다: " + ln[:60], no)
            if is_opinion and ln.startswith("- "):
                m = TAG_OPINION.match(ln)
                if not m:
                    rep.err(r, "opinion.tag", "의견 패널 항목은 [C], [D], [E] 중 하나로 시작해야 합니다: " + ln[:60], no)
                    continue
                for need in OPINION_REQUIRED[m.group(1)]:
                    if need not in ln:
                        rep.err(r, "opinion.field", f"[{m.group(1)}] 항목에 '{need}' 항목이 없습니다.", no)

    facts_joined = "\n".join(facts_text)
    needs_budget = bool(BUDGET_RE.search(facts_joined))
    if needs_budget and parse_date(meta.get("rules_as_of")) is None:
        rep.err(r, "draft.rules_as_of", "대출·구매력 내용이 있으면 frontmatter에 rules_as_of(적용 규칙 기준일)가 필요합니다.")

    for ph in phrases:
        scope_text = body if ph.get("scope", "all") == "all" else facts_joined
        try:
            rx = re.compile(ph["pattern"])
        except re.error:
            continue
        m = rx.search(scope_text)
        if m:
            hint = f" 대체: {ph['replacement']}" if ph.get("replacement") else ""
            msg = f"금지 문구 '{m.group(0)}': {ph.get('reason', '')}.{hint}"
            (rep.err if ph.get("severity", "block") == "block" else rep.warn)(r, "phrase." + ph.get("id", "x"), msg)
    return needs_budget


def run_checks(root, only=None, drafts=None, strict=False):
    root = Path(root)
    policy = load_policy(root)
    rep = Report()
    only = set(only) if only else {"drafts", "rules"}
    needs_budget = False

    if "drafts" in only:
        ddir = root / policy["draft_dir"]
        if drafts:
            paths = []
            for s in drafts:
                if not SLUG_RE.match(s):
                    rep.err(s, "draft.slug", "slug 형식이 올바르지 않습니다.")
                    continue
                paths.append(ddir / f"{s}.md")
        else:
            paths = sorted(ddir.glob("*.md")) if ddir.is_dir() else []
        if not paths:
            rep.warn(policy["draft_dir"], "draft.none", "검사할 초안이 없습니다.")
        phrases = load_phrases(root)
        for p in paths:
            needs_budget |= check_draft(root, p, policy, phrases, rep)

    if "meta" in only:
        for d in policy["data_dirs"]:
            base = root / d
            if base.is_dir():
                for p in sorted(base.glob("*.md")):
                    check_evidence_file(root, p, policy, rep)

    if "rules" in only:
        check_rules(root, policy, rep, required=needs_budget)

    if strict:
        rep.promote_warnings()
    return rep


def find_root(payload, default):
    for p in payload.get("workspacePaths") or []:
        if (Path(p) / "scripts" / "validate_board.py").is_file():
            return Path(p)
    return Path(default)


def agy_hook_decision(root, payload):
    """Antigravity PreToolUse 훅 결정. publish_post 호출만 다루며 실패는 닫는 쪽(deny)이다."""
    call = payload.get("toolCall") or {}
    name = str(call.get("name", ""))
    args = call.get("args") or {}
    if "publish_post" not in name:
        return {"decision": "ask", "reason": "이 훅은 publish_post 호출에만 적용됩니다."}
    slug = args.get("slug")
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        return {"decision": "deny", "reason": "slug 인자가 없거나 형식이 올바르지 않아 발행 전 검증을 할 수 없습니다."}
    rep = run_checks(root, only={"drafts", "rules"}, drafts=[slug])
    if not rep.ok:
        return {"decision": "deny", "reason": "발행 전 결정적 검증 실패:\n" + rep.format()[:1500]}
    warn = f" 경고 {len(rep.warnings)}건." if rep.warnings else ""
    return {"decision": "force_ask", "reason": f"결정적 검증 통과({slug}).{warn} 발행을 승인하시겠습니까?"}


def main(argv=None):
    ap = argparse.ArgumentParser(description="게시판 발행 전 결정적 검증")
    ap.add_argument("--root", default=os.environ.get("CLAUDE_PROJECT_DIR") or os.environ.get("BOARD_ROOT") or os.getcwd())
    ap.add_argument("--only", help="쉼표로 구분: drafts, meta, rules (기본: drafts,rules)")
    ap.add_argument("--all", action="store_true", help="drafts, meta, rules 모두 검사")
    ap.add_argument("--draft", action="append", help="검사할 초안 slug (여러 번 지정 가능)")
    ap.add_argument("--strict", action="store_true", help="경고도 오류로 취급")
    ap.add_argument("--json", action="store_true", help="JSON으로 출력")
    ap.add_argument("--hook", action="store_true", help="Claude Code 훅 모드: 표준입력 JSON에서 slug를 읽음")
    ap.add_argument("--agy-hook", action="store_true", help="Antigravity 훅 모드: 표준입력 JSON을 읽고 결정을 표준출력 JSON으로 출력")
    args = ap.parse_args(argv)

    if args.agy_hook:
        try:
            payload = json.loads(sys.stdin.read() or "{}")
            decision = agy_hook_decision(find_root(payload, args.root), payload)
        except Exception as e:  # noqa: BLE001  훅 오류는 발행을 막는다
            decision = {"decision": "deny", "reason": f"훅 내부 오류로 발행을 막습니다: {e}"}
        print(json.dumps(decision, ensure_ascii=False))
        return 0

    drafts = args.draft
    if args.hook:
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except ValueError:
            payload = {}
        slug = (payload.get("tool_input") or {}).get("slug")
        if slug:
            drafts = [slug]

    only = {"drafts", "meta", "rules"} if args.all else (set(x.strip() for x in args.only.split(",")) if args.only else None)
    if only and not only <= {"drafts", "meta", "rules"}:
        print("--only 값은 drafts, meta, rules 중에서 고르세요.", file=sys.stderr)
        return 1

    rep = run_checks(args.root, only=only, drafts=drafts, strict=args.strict)
    if args.json:
        print(json.dumps(rep.to_dict(), ensure_ascii=False, indent=2))
    else:
        (sys.stdout if rep.ok else sys.stderr).write(rep.format() + "\n")
    return 0 if rep.ok else 2


if __name__ == "__main__":
    sys.exit(main())
