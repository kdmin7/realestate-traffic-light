#!/usr/bin/env python3
"""board_mcp.py - 게시판용 최소 MCP 서버 (stdio, 표준 라이브러리만 사용)

프로필로 노출하는 도구를 나눈다. 읽기 서버와 쓰기 서버를 분리해 에이전트별 권한을 좁히기 위함이다.
  --profile rules        규칙 테이블 조회 (읽기 전용)
  --profile board-read   초안·견해·경험·게이트 기록 조회 (읽기 전용)
  --profile board-write  견해·경험 저장, 게이트 기록, 발행 (쓰기)

루트 디렉터리는 환경변수 BOARD_ROOT, 없으면 이 파일의 상위 폴더(프로젝트 루트)다. 작업 디렉터리에 의존하지 않는다.
발행(publish_post)은 이 서버 안에서도 게이트 기록과 결정적 검증을 다시 확인한다(훅과 별개의 이중 방어).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.environ.get("BOARD_ROOT") or Path(__file__).resolve().parent.parent).resolve()
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import validate_board as vb  # noqa: E402

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
BOARD = ROOT / "data" / "board"
DIRS = {k: BOARD / k for k in ("drafts", "claims", "experiences", "gates", "published")}

STANCE = {"agree", "oppose", "conditional"}
INTEREST = {"confirmed", "none_confirmed", "unknown"}
VERIFY = {"verified", "partial", "unverifiable", "contradicted"}
DEAL = {"buy", "jeonse", "wolse", "subscription"}
OUTCOME = {"satisfied", "mixed", "regret"}
PHASE = {"rise", "flat", "fall", "unknown"}


class ToolError(Exception):
    pass


def now_iso():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def need_slug(slug):
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        raise ToolError("slug는 영문 소문자·숫자·-_ 로 64자 이하여야 합니다.")
    return slug


def read_json(path, default=None):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def short_id(prefix, *parts):
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:10]
    return f"{prefix}-{h}"


def need_enum(value, allowed, name, default=None):
    if value is None and default is not None:
        return default
    if value not in allowed:
        raise ToolError(f"{name}은(는) {sorted(allowed)} 중 하나여야 합니다.")
    return value


def need_text(args, key, max_len=None):
    v = args.get(key)
    if not isinstance(v, str) or not v.strip():
        raise ToolError(f"{key}가 필요합니다.")
    if max_len and len(v) > max_len:
        raise ToolError(f"{key}는 {max_len}자 이하여야 합니다(원문 전재 방지를 위해 자체 표현으로 요약하세요).")
    return v.strip()


# ---------- rules ----------
def t_list_rules(_):
    data = read_json(ROOT / "rules" / "rules.json", None)
    if data is None:
        raise ToolError("rules/rules.json을 읽을 수 없습니다.")
    return data


def t_get_rule(args):
    rid = args.get("id")
    for r in t_list_rules({}).get("rules", []):
        if r.get("id") == rid:
            return r
    raise ToolError(f"규칙 {rid!r}을(를) 찾을 수 없습니다.")


def t_check_rules_freshness(_):
    status = vb.rules_status(ROOT, vb.load_policy(ROOT))
    if status is None:
        raise ToolError("rules/rules.json을 읽을 수 없습니다.")
    return {"all_ok": all(s["ok"] for s in status), "rules": status}


# ---------- board-read ----------
def list_dir(kind, pattern):
    d = DIRS[kind]
    return sorted(p.name for p in d.glob(pattern)) if d.is_dir() else []


def t_list_drafts(_):
    return {"drafts": [Path(n).stem for n in list_dir("drafts", "*.md")]}


def t_get_draft(args):
    slug = need_slug(args.get("slug"))
    p = DIRS["drafts"] / f"{slug}.md"
    if not p.is_file():
        raise ToolError(f"초안 {slug}이(가) 없습니다.")
    return {"slug": slug, "sha256": sha256_of(p), "content": p.read_text(encoding="utf-8")}


def t_list_claims(args):
    out = []
    for n in list_dir("claims", "*.json"):
        c = read_json(DIRS["claims"] / n, {})
        if not args.get("region") or c.get("region") == args["region"]:
            out.append(c)
    return {"claims": out}


def t_list_experiences(args):
    out = []
    for n in list_dir("experiences", "*.json"):
        c = read_json(DIRS["experiences"] / n, {})
        if not args.get("region") or c.get("region") == args["region"]:
            out.append(c)
    return {"experiences": out}


def t_get_gate(args):
    slug = need_slug(args.get("slug"))
    return read_json(DIRS["gates"] / f"{slug}.json", {"slug": slug})


# ---------- board-write ----------
def t_save_claim(args):
    summary = need_text(args, "summary", 300)
    claim = {
        "evidence_grade": "C",
        "region": need_text(args, "region"),
        "topic": need_text(args, "topic"),
        "speaker": need_text(args, "speaker"),
        "source_url": need_text(args, "source_url"),
        "published_at": args.get("published_at") or "",
        "summary": summary,
        "stance": need_enum(args.get("stance"), STANCE, "stance"),
        "interest_disclosure": need_enum(args.get("interest_disclosure"), INTEREST, "interest_disclosure", "unknown"),
        "interest_detail": args.get("interest_detail") or "",
        "verification_status": need_enum(args.get("verification_status"), VERIFY, "verification_status"),
        "evidence_refs": args.get("evidence_refs") or [],
        "counter_claim_ids": args.get("counter_claim_ids") or [],
        "saved_at": now_iso(),
    }
    cid = args.get("id") or short_id("c", claim["source_url"], claim["summary"])
    if not ID_RE.match(cid):
        raise ToolError("id 형식이 올바르지 않습니다.")
    claim["id"] = cid
    write_json(DIRS["claims"] / f"{cid}.json", claim)
    return {"saved": cid}


def t_save_experience(args):
    regrets = args.get("regrets")
    if isinstance(regrets, list):
        regrets = "; ".join(str(x) for x in regrets if str(x).strip())
    if not isinstance(regrets, str) or not regrets.strip():
        raise ToolError("regrets(후회한 점)는 필수입니다. 성공담만 받지 않습니다.")
    ym = need_text(args, "contract_ym")
    if not re.match(r"^\d{4}-\d{2}$", ym):
        raise ToolError("contract_ym은 YYYY-MM 형식이어야 합니다.")
    exp = {
        "evidence_grade": "D",
        "region": need_text(args, "region"),
        "deal_type": need_enum(args.get("deal_type"), DEAL, "deal_type"),
        "contract_ym": ym,
        "price_band": need_text(args, "price_band"),
        "outcome": need_enum(args.get("outcome"), OUTCOME, "outcome"),
        "regrets": regrets.strip(),
        "summary": need_text(args, "summary", 400),
        "verified_level": need_enum(args.get("verified_level"), {"none", "verified"}, "verified_level", "none"),
        "market_phase": need_enum(args.get("market_phase"), PHASE, "market_phase", "unknown"),
        "saved_at": now_iso(),
    }
    eid = args.get("id") or short_id("x", exp["region"], exp["contract_ym"], exp["summary"])
    if not ID_RE.match(eid):
        raise ToolError("id 형식이 올바르지 않습니다.")
    exp["id"] = eid
    write_json(DIRS["experiences"] / f"{eid}.json", exp)
    return {"saved": eid}


def t_record_gate(args):
    slug = need_slug(args.get("slug"))
    gate = need_enum(args.get("gate"), {"legal", "validate"}, "gate")
    draft = DIRS["drafts"] / f"{slug}.md"
    if not draft.is_file():
        raise ToolError(f"초안 {slug}이(가) 없습니다.")
    record = read_json(DIRS["gates"] / f"{slug}.json", {"slug": slug})
    digest = sha256_of(draft)
    if gate == "legal":
        verdict = need_enum(args.get("verdict"), {"pass", "reject"}, "verdict")
        notes = args.get("notes") or []
        if verdict == "reject" and not notes:
            raise ToolError("reject에는 사유(notes)가 필요합니다.")
        record["legal"] = {"verdict": verdict, "notes": notes, "reviewer": args.get("reviewer") or "legal-reviewer",
                           "at": now_iso(), "draft_sha256": digest}
    else:
        rep = vb.run_checks(ROOT, only={"drafts", "rules"}, drafts=[slug], strict=False)
        record["validate"] = {"verdict": "pass" if rep.ok else "reject", "errors": rep.errors[:20],
                              "at": now_iso(), "draft_sha256": digest}
    write_json(DIRS["gates"] / f"{slug}.json", record)
    return record


def t_publish_post(args):
    slug = need_slug(args.get("slug"))
    draft = DIRS["drafts"] / f"{slug}.md"
    if not draft.is_file():
        raise ToolError(f"초안 {slug}이(가) 없습니다.")
    gate = read_json(DIRS["gates"] / f"{slug}.json", {})
    digest = sha256_of(draft)
    legal = gate.get("legal") or {}
    if legal.get("verdict") != "pass":
        raise ToolError("legal-reviewer 통과 기록이 없어 발행할 수 없습니다.")
    if legal.get("draft_sha256") != digest:
        raise ToolError("법·표현 검토 이후 초안이 수정되었습니다. 다시 검토를 받으세요.")
    rep = vb.run_checks(ROOT, only={"drafts", "rules"}, drafts=[slug], strict=False)
    if not rep.ok:
        raise ToolError("결정적 검증 실패:\n" + rep.format())
    dest = DIRS["published"] / f"{slug}.md"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(draft.read_text(encoding="utf-8"), encoding="utf-8")
    index_path = DIRS["published"] / "index.json"
    index = read_json(index_path, {"posts": []})
    index["posts"] = [p for p in index["posts"] if p.get("slug") != slug]
    index["posts"].append({"slug": slug, "published_at": now_iso(), "sha256": digest})
    write_json(index_path, index)
    return {"published": slug, "path": str(dest.relative_to(ROOT)), "sha256": digest}


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required)}


S = {"type": "string"}
TOOLS = {
    "list_rules": ("규칙 테이블 전체를 조회한다(읽기 전용).", obj({}), t_list_rules),
    "get_rule": ("규칙 하나를 id로 조회한다.", obj({"id": S}, ["id"]), t_get_rule),
    "check_rules_freshness": ("규칙별 검증 상태와 확인 후 경과일을 점검한다.", obj({}), t_check_rules_freshness),
    "list_drafts": ("초안 slug 목록을 조회한다.", obj({}), t_list_drafts),
    "get_draft": ("초안 본문과 sha256을 조회한다.", obj({"slug": S}, ["slug"]), t_get_draft),
    "list_claims": ("저장된 견해(C 등급)를 조회한다. region으로 거른다.", obj({"region": S}), t_list_claims),
    "list_experiences": ("저장된 경험 사례(D 등급)를 조회한다. region으로 거른다.", obj({"region": S}), t_list_experiences),
    "get_gate": ("초안의 게이트 통과 기록을 조회한다.", obj({"slug": S}, ["slug"]), t_get_gate),
    "save_claim": ("견해를 C 등급으로 저장한다. summary는 300자 이하 자체 요약이며 원문 전재는 거부된다.",
                   obj({"region": S, "topic": S, "speaker": S, "source_url": S, "published_at": S, "summary": S,
                        "stance": {"type": "string", "enum": sorted(STANCE)},
                        "interest_disclosure": {"type": "string", "enum": sorted(INTEREST)},
                        "interest_detail": S,
                        "verification_status": {"type": "string", "enum": sorted(VERIFY)},
                        "evidence_refs": {"type": "array", "items": S},
                        "counter_claim_ids": {"type": "array", "items": S}},
                       ["region", "topic", "speaker", "source_url", "summary", "stance", "verification_status"]),
                   t_save_claim),
    "save_experience": ("경험 사례를 D 등급으로 저장한다. regrets(후회한 점)가 없으면 거부한다.",
                        obj({"region": S, "deal_type": {"type": "string", "enum": sorted(DEAL)}, "contract_ym": S,
                             "price_band": S, "outcome": {"type": "string", "enum": sorted(OUTCOME)},
                             "regrets": S, "summary": S,
                             "verified_level": {"type": "string", "enum": ["none", "verified"]},
                             "market_phase": {"type": "string", "enum": sorted(PHASE)}},
                            ["region", "deal_type", "contract_ym", "price_band", "outcome", "regrets", "summary"]),
                        t_save_experience),
    "record_gate": ("게이트 결과를 기록한다. legal은 verdict와 notes를 받고, validate는 서버가 직접 검증해 기록한다.",
                    obj({"slug": S, "gate": {"type": "string", "enum": ["legal", "validate"]},
                         "verdict": {"type": "string", "enum": ["pass", "reject"]},
                         "notes": {"type": "array", "items": S}, "reviewer": S}, ["slug", "gate"]),
                    t_record_gate),
    "publish_post": ("게이트를 통과한 초안을 발행한다. 법·표현 검토 기록, 초안 해시, 결정적 검증을 다시 확인한다.",
                     obj({"slug": S}, ["slug"]), t_publish_post),
}
PROFILES = {
    "rules": ["list_rules", "get_rule", "check_rules_freshness"],
    "board-read": ["list_drafts", "get_draft", "list_claims", "list_experiences", "get_gate"],
    "board-write": ["save_claim", "save_experience", "record_gate", "publish_post"],
}


def handle(msg, tools):
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None
    if method == "initialize":
        version = (msg.get("params") or {}).get("protocolVersion") or "2024-11-05"
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": version, "capabilities": {"tools": {}},
            "serverInfo": {"name": "board-mcp", "version": "0.1.0"}}}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        listing = [{"name": n, "description": TOOLS[n][0], "inputSchema": TOOLS[n][1]} for n in tools]
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": listing}}
    if method == "tools/call":
        params = msg.get("params") or {}
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in tools:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"알 수 없는 도구: {name}"}}
        try:
            result = TOOLS[name][2](args)
            text, is_error = json.dumps(result, ensure_ascii=False, indent=2), False
        except ToolError as e:
            text, is_error = str(e), True
        except Exception as e:  # noqa: BLE001
            text, is_error = f"내부 오류: {e}", True
        return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}], "isError": is_error}}
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"지원하지 않는 메서드: {method}"}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True, choices=sorted(PROFILES))
    tools = PROFILES[ap.parse_args().profile]
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        resp = handle(msg, tools)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
