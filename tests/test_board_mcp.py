import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
SERVER = KIT / "mcp" / "board_mcp.py"


class Client:
    def __init__(self, profile, root):
        env = dict(os.environ, BOARD_ROOT=str(root), BOARD_TODAY="2026-09-21", PYTHONIOENCODING="utf-8")
        self.p = subprocess.Popen([sys.executable, str(SERVER), "--profile", profile], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, text=True, encoding="utf-8", env=env)
        self.n = 0
        self.rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}})
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
        self.p.stdin.flush()

    def rpc(self, method, params=None):
        self.n += 1
        self.p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params or {}}) + "\n")
        self.p.stdin.flush()
        return json.loads(self.p.stdout.readline())

    def call(self, name, **args):
        r = self.rpc("tools/call", {"name": name, "arguments": args})
        res = r["result"]
        return res["isError"], res["content"][0]["text"]

    def close(self):
        self.p.stdin.close()
        self.p.wait(timeout=5)
        self.p.stdout.close()


class BoardMcpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(KIT / "examples" / "good", self.tmp, dirs_exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_profiles_expose_only_their_tools(self):
        expect = {"rules": 3, "board-read": 5, "board-write": 4}
        for profile, n in expect.items():
            c = Client(profile, self.tmp)
            names = [t["name"] for t in c.rpc("tools/list")["result"]["tools"]]
            c.close()
            self.assertEqual(len(names), n, profile)
        c = Client("board-read", self.tmp)
        r = c.rpc("tools/call", {"name": "publish_post", "arguments": {"slug": "songpa"}})
        c.close()
        self.assertIn("error", r)

    def test_publish_requires_gates_and_blocks_edits(self):
        w = Client("board-write", self.tmp)
        err, msg = w.call("publish_post", slug="songpa")
        self.assertTrue(err)
        self.assertIn("legal-reviewer", msg)
        err, _ = w.call("record_gate", slug="songpa", gate="legal", verdict="reject")
        self.assertTrue(err)
        err, _ = w.call("record_gate", slug="songpa", gate="legal", verdict="pass", notes=["ok"])
        self.assertFalse(err)
        draft = self.tmp / "data" / "board" / "drafts" / "songpa.md"
        original = draft.read_bytes()
        draft.write_bytes(original + "\n- 추가 수정\n".encode("utf-8"))
        err, msg = w.call("publish_post", slug="songpa")
        self.assertTrue(err)
        self.assertIn("수정", msg)
        draft.write_bytes(original)
        err, out = w.call("publish_post", slug="songpa")
        self.assertFalse(err, out)
        self.assertTrue((self.tmp / "data" / "board" / "published" / "songpa.md").is_file())
        w.close()

    def test_claim_and_experience_guards(self):
        w = Client("board-write", self.tmp)
        err, _ = w.call("save_claim", region="송파구", topic="학군", speaker="채널A", source_url="https://example.com",
                        summary="가" * 301, stance="agree", verification_status="unverifiable")
        self.assertTrue(err)
        err, out = w.call("save_claim", region="송파구", topic="학군", speaker="채널A", source_url="https://example.com",
                          summary="짧은 자체 요약", stance="agree", verification_status="unverifiable")
        self.assertFalse(err, out)
        self.assertIn('"interest_disclosure": "unknown"', (next((self.tmp / "data/board/claims").glob("*.json"))).read_text(encoding="utf-8"))
        err, _ = w.call("save_experience", region="송파구", deal_type="buy", contract_ym="2024-03", price_band="10~15억",
                        outcome="satisfied", regrets="", summary="만족")
        self.assertTrue(err)
        err, out = w.call("save_experience", region="송파구", deal_type="buy", contract_ym="2024-03", price_band="10~15억",
                          outcome="mixed", regrets="입주 물량 확인 부족", summary="보통")
        self.assertFalse(err, out)
        w.close()

    def test_rules_reader(self):
        r = Client("rules", self.tmp)
        err, out = r.call("check_rules_freshness")
        self.assertFalse(err)
        self.assertIn('"all_ok": false', out)
        err, _ = r.call("get_rule", id="nope")
        self.assertTrue(err)
        r.close()


if __name__ == "__main__":
    unittest.main()
