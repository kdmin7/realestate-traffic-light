import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "scripts"))
os.environ["BOARD_TODAY"] = "2026-09-21"
import validate_board as vb  # noqa: E402

GOOD = KIT / "examples" / "good"
BAD = KIT / "examples" / "bad"


def payload(name, slug="songpa", extra=None):
    p = {"toolCall": {"name": name, "args": {"slug": slug} if slug else {}}, "stepIdx": 3,
         "conversationId": "x", "workspacePaths": []}
    p.update(extra or {})
    return p


class AgyHookTest(unittest.TestCase):
    def test_valid_draft_requires_human_approval(self):
        d = vb.agy_hook_decision(GOOD, payload("mcp_board-write_publish_post"))
        self.assertEqual(d["decision"], "force_ask", d)

    def test_invalid_draft_is_denied_with_reason(self):
        d = vb.agy_hook_decision(BAD, payload("board-write/publish_post", "gangnam"))
        self.assertEqual(d["decision"], "deny")
        self.assertIn("결정적 검증 실패", d["reason"])

    def test_missing_or_malformed_slug_is_denied(self):
        self.assertEqual(vb.agy_hook_decision(GOOD, payload("publish_post", None))["decision"], "deny")
        self.assertEqual(vb.agy_hook_decision(GOOD, payload("publish_post", "../etc"))["decision"], "deny")

    def test_other_tools_are_not_auto_allowed(self):
        d = vb.agy_hook_decision(GOOD, payload("run_command"))
        self.assertEqual(d["decision"], "ask")

    def _run(self, stdin, *extra):
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        out = subprocess.run([sys.executable, str(KIT / "scripts" / "validate_board.py"), "--agy-hook", *extra],
                             input=stdin, capture_output=True, text=True, encoding="utf-8", env=env)
        return out.returncode, json.loads(out.stdout)

    def test_cli_outputs_json_and_exits_zero(self):
        code, d = self._run(json.dumps(payload("publish_post", "gangnam")), "--root", str(BAD))
        self.assertEqual(code, 0)
        self.assertEqual(d["decision"], "deny")
        code, d = self._run(json.dumps(payload("publish_post")), "--root", str(GOOD))
        self.assertEqual((code, d["decision"]), (0, "force_ask"))

    def test_cli_fails_closed_on_garbage_input(self):
        code, d = self._run("not json", "--root", str(GOOD))
        self.assertEqual(code, 0)
        self.assertEqual(d["decision"], "deny")

    def test_workspace_path_is_used_to_find_project(self):
        p = payload("publish_post", "gangnam", {"workspacePaths": [str(BAD)]})
        # BAD에는 scripts/가 없으므로 기본 root(GOOD)로 되돌아가야 한다
        d = vb.agy_hook_decision(vb.find_root(p, GOOD), p)
        self.assertEqual(vb.find_root(p, GOOD), GOOD)
        self.assertEqual(d["decision"], "deny")  # GOOD에는 gangnam 초안이 없다


if __name__ == "__main__":
    unittest.main()
