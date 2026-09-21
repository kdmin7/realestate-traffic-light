import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
INSTALL = KIT / "scripts" / "agy_install.py"


def run(*args):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, str(INSTALL), *args], capture_output=True, text=True, encoding="utf-8", env=env)


class AgyInstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.project = self.tmp / "proj"
        (self.project / ".agents").mkdir(parents=True)
        (self.project / "agy").mkdir()
        (self.project / "mcp").mkdir()
        (self.project / "mcp" / "board_mcp.py").write_text("# stub\n", encoding="utf-8")
        shutil.copy(KIT / "agy" / "settings.permissions.json", self.project / "agy")
        shutil.copy(KIT / ".agents" / "mcp_config.json", self.project / ".agents")
        self.settings = self.tmp / "home" / "settings.json"

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_dry_run_writes_nothing(self):
        r = run("--project", str(self.project), "--settings", str(self.settings))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(self.settings.exists())
        self.assertIn("mcp(board-write/publish_post)", r.stdout)

    def test_apply_merges_and_preserves_existing(self):
        self.settings.parent.mkdir(parents=True)
        self.settings.write_text(json.dumps({"colorScheme": "dark", "permissions": {"allow": ["command(git)"], "ask": ["command(*)"]}}),
                                 encoding="utf-8")
        r = run("--project", str(self.project), "--settings", str(self.settings), "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        data = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertEqual(data["colorScheme"], "dark")
        self.assertIn("command(git)", data["permissions"]["allow"])
        self.assertIn("command(*)", data["permissions"]["ask"])
        self.assertIn("mcp(board-write/publish_post)", data["permissions"]["ask"])
        self.assertIn("write_file(rules/rules.json)", data["permissions"]["deny"])
        self.assertTrue(list(self.settings.parent.glob("settings.json.bak-*")))

    def test_apply_is_idempotent(self):
        run("--project", str(self.project), "--settings", str(self.settings), "--apply")
        first = self.settings.read_text(encoding="utf-8")
        r = run("--project", str(self.project), "--settings", str(self.settings), "--apply")
        self.assertIn("추가할 규칙이 없습니다", r.stdout)
        self.assertEqual(first, self.settings.read_text(encoding="utf-8"))

    def test_invalid_json_aborts_without_overwriting(self):
        self.settings.parent.mkdir(parents=True)
        self.settings.write_text("{ not json", encoding="utf-8")
        r = run("--project", str(self.project), "--settings", str(self.settings), "--apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.settings.read_text(encoding="utf-8"), "{ not json")

    def test_absolute_mcp_paths(self):
        r = run("--project", str(self.project), "--settings", str(self.settings), "--skip-permissions", "--absolute-mcp", "--apply")
        self.assertEqual(r.returncode, 0, r.stderr)
        cfg = json.loads((self.project / ".agents" / "mcp_config.json").read_text(encoding="utf-8"))["mcpServers"]
        for server in cfg.values():
            self.assertTrue(Path(server["args"][0]).is_absolute())
            self.assertEqual(server["env"]["BOARD_ROOT"], str(self.project.resolve()))


if __name__ == "__main__":
    unittest.main()
