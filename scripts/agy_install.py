#!/usr/bin/env python3
"""agy_install.py - Antigravity CLI(agy) 설정 적용 도우미

하는 일
  1) 권한 규칙: agy/settings.permissions.json 을 사용자 설정(~/.gemini/antigravity-cli/settings.json)에 병합한다.
     Antigravity CLI의 권한 규칙은 프로젝트 파일이 아니라 이 사용자 설정 파일에 들어간다.
  2) MCP 경로(선택, --absolute-mcp): .agents/mcp_config.json 의 상대 경로를 이 프로젝트의 절대 경로로 바꾼다.
     agy가 MCP 서버를 어느 작업 폴더에서 띄우는지 확실치 않을 때 쓴다.

기본은 미리보기(dry-run)다. 파일을 쓰려면 --apply 를 준다. 쓰기 전에 백업(.bak-타임스탬프)을 만든다.
기존 설정의 다른 키와 기존 규칙은 그대로 두고, 없는 규칙만 추가한다(여러 번 실행해도 같은 결과).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import sys
from pathlib import Path

LISTS = ("allow", "ask", "deny")


def load_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except ValueError as e:
        raise SystemExit(f"오류: {path} 가 올바른 JSON이 아닙니다({e}). 덮어쓰지 않고 중단합니다.")


def merge_permissions(settings, snippet):
    """settings를 복사해 권한 규칙을 병합하고 (새 설정, 추가된 규칙, 경고)를 반환한다."""
    merged = json.loads(json.dumps(settings))
    perms = merged.setdefault("permissions", {})
    added = {k: [] for k in LISTS}
    for key in LISTS:
        current = perms.setdefault(key, [])
        for rule in snippet.get("permissions", {}).get(key, []):
            if rule not in current:
                current.append(rule)
                added[key].append(rule)
    warnings = []
    for rule in perms.get("allow", []):
        for other in ("ask", "deny"):
            if rule in perms.get(other, []):
                warnings.append(f"같은 규칙이 allow와 {other}에 모두 있습니다: {rule} (Deny > Ask > Allow 순으로 적용)")
    return merged, added, warnings


def backup(path):
    if Path(path).exists():
        dest = f"{path}.bak-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, dest)
        return dest
    return None


def absolutize_mcp(project):
    cfg_path = project / ".agents" / "mcp_config.json"
    cfg = load_json(cfg_path)
    if cfg is None:
        raise SystemExit(f"오류: {cfg_path} 가 없습니다.")
    changed = []
    for name, server in cfg.get("mcpServers", {}).items():
        args = server.get("args") or []
        if args and not os.path.isabs(args[0]) and (project / args[0]).exists():
            args[0] = str((project / args[0]).resolve())
            changed.append(name)
        env = server.setdefault("env", {})
        if env.get("BOARD_ROOT") != str(project.resolve()):
            env["BOARD_ROOT"] = str(project.resolve())
            if name not in changed:
                changed.append(name)
    return cfg_path, cfg, changed


def main(argv=None):
    here = Path(__file__).resolve().parent.parent
    default_settings = os.environ.get("AGY_SETTINGS") or str(Path.home() / ".gemini" / "antigravity-cli" / "settings.json")
    ap = argparse.ArgumentParser(description="Antigravity CLI 설정 적용 도우미")
    ap.add_argument("--project", default=str(here), help="프로젝트 루트(기본: 이 스크립트의 상위 폴더)")
    ap.add_argument("--settings", default=default_settings, help="agy 사용자 설정 파일 경로")
    ap.add_argument("--apply", action="store_true", help="실제로 파일을 쓴다(기본은 미리보기)")
    ap.add_argument("--absolute-mcp", action="store_true", help=".agents/mcp_config.json 의 경로를 절대 경로로 바꾼다")
    ap.add_argument("--skip-permissions", action="store_true", help="권한 규칙 병합을 건너뛴다")
    args = ap.parse_args(argv)

    project = Path(args.project).resolve()
    mode = "적용" if args.apply else "미리보기(dry-run)"
    print(f"[{mode}] 프로젝트: {project}")

    if not args.skip_permissions:
        snippet = load_json(project / "agy" / "settings.permissions.json")
        if snippet is None:
            raise SystemExit("오류: agy/settings.permissions.json 이 없습니다.")
        existing = load_json(args.settings)
        merged, added, warnings = merge_permissions(existing or {}, snippet)
        total = sum(len(v) for v in added.values())
        print(f"권한 규칙 대상: {args.settings}" + ("" if existing is not None else " (새로 만듦)"))
        for key in LISTS:
            for rule in added[key]:
                print(f"  + {key}: {rule}")
        if total == 0:
            print("  추가할 규칙이 없습니다(이미 적용됨).")
        for w in warnings:
            print(f"  ! {w}")
        if args.apply and total:
            os.makedirs(os.path.dirname(args.settings), exist_ok=True)
            bak = backup(args.settings)
            Path(args.settings).write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  저장했습니다." + (f" 백업: {bak}" if bak else ""))

    if args.absolute_mcp:
        cfg_path, cfg, changed = absolutize_mcp(project)
        print(f"MCP 설정 대상: {cfg_path}")
        print("  변경할 서버: " + (", ".join(changed) if changed else "없음(이미 절대 경로)"))
        if args.apply and changed:
            bak = backup(str(cfg_path))
            cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"  저장했습니다. 백업: {bak}")

    if not args.apply:
        print("\n파일은 바꾸지 않았습니다. 적용하려면 --apply 를 붙여 다시 실행하세요.")
    print("\n다음: 프로젝트 폴더에서 agy 를 실행하고 /mcp, /hooks, /skills, /agents 로 로드 상태를 확인하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
