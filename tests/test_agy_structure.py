"""Antigravity CLI(agy) 구조 정합성 검사 (PyYAML이 있을 때만 실행)."""
import json
import re
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

KIT = Path(__file__).resolve().parent.parent
# 공식 문서(Hooks > Supported Tools)에 나온 도구 이름. 철자가 틀린 도구 이름은 서브에이전트를 멈추게 할 수 있다.
KNOWN_TOOLS = {
    "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content", "list_dir", "find_by_name",
    "grep_search", "search_web", "read_url_content", "run_command", "manage_task", "schedule", "list_permissions",
    "ask_permission", "invoke_subagent", "define_subagent", "send_message", "manage_subagents", "ask_question",
    "generate_image",
}
ALLOWED_KEYS = {"name", "description", "tools", "mainAgent", "subagent", "model", "commandExecutionPolicy",
                "mcpServers", "skills", "plugins"}
WRITE_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content", "run_command"}
ORCH_ONLY = {"invoke_subagent", "send_message", "manage_subagents", "define_subagent"}


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    assert m, f"{path}: frontmatter 없음"
    return yaml.safe_load(m.group(1)), m.group(2)


@unittest.skipIf(yaml is None, "PyYAML 없음")
class AgyStructureTest(unittest.TestCase):
    def setUp(self):
        self.agents = {p.parent.name: frontmatter(p) for p in sorted((KIT / ".agents" / "agents").glob("*/agent.md"))}
        self.skills = {p.parent.name: frontmatter(p) for p in sorted((KIT / ".agents" / "skills").glob("*/SKILL.md"))}

    def test_counts_and_names(self):
        self.assertGreaterEqual(len(self.agents), 1)
        self.assertGreaterEqual(len(self.skills), 1)
        for name, (fm, _) in self.agents.items():
            self.assertEqual(fm["name"], name)
            self.assertTrue(fm.get("description"), name)
        for name, (fm, _) in self.skills.items():
            self.assertEqual(fm["name"], name)
            self.assertTrue(fm.get("description"), name)

    def test_agent_frontmatter_is_valid(self):
        for name, (fm, _) in self.agents.items():
            self.assertLessEqual(set(fm), ALLOWED_KEYS, name)
            self.assertLessEqual(set(fm["tools"]), KNOWN_TOOLS, f"{name}: 알 수 없는 도구 이름")
            self.assertIn(fm["model"], {"inherit", "flash", "pro"}, name)
            self.assertIsInstance(fm["commandExecutionPolicy"], str, name)
            self.assertIn(fm["commandExecutionPolicy"], {"off", "auto", "eager", "sandbox"}, name)
            for s in fm["skills"]:
                self.assertTrue((KIT / ".agents" / s / "SKILL.md").is_file(), f"{name}: {s}")

    def test_main_and_subagent_flags(self):
        for name, (fm, _) in self.agents.items():
            if name == "board-orchestrator":
                self.assertTrue(fm["mainAgent"])
                self.assertFalse(fm["subagent"])
            else:
                self.assertFalse(fm["mainAgent"], name)
                self.assertTrue(fm["subagent"], name)

    def test_only_orchestrator_can_delegate(self):
        for name, (fm, _) in self.agents.items():
            has = bool(set(fm["tools"]) & ORCH_ONLY)
            self.assertEqual(has, name == "board-orchestrator", name)

    def test_reviewers_cannot_write_or_run(self):
        for name in ("board-orchestrator", "legal-reviewer", "fact-checker", "community-moderator", "publisher"):
            self.assertFalse(set(self.agents[name][0]["tools"]) & WRITE_TOOLS, name)
        self.assertEqual(self.agents["publisher"][0]["tools"], ["view_file"])

    def test_re_rules_cannot_edit_existing_files(self):
        tools = set(self.agents["re-rules"][0]["tools"])
        self.assertIn("write_to_file", tools)
        self.assertNotIn("replace_file_content", tools)
        self.assertNotIn("run_command", tools)

    def test_every_agent_body_has_common_rules(self):
        for name, (_, body) in self.agents.items():
            self.assertIn("공통 규칙", body, name)
            self.assertIn("등급이 없는 정보는 발행하지 않는다", body, name)

    def test_every_skill_is_used_by_some_agent(self):
        used = {s.split("/", 1)[1] for fm, _ in self.agents.values() for s in fm.get("skills", [])}
        optional_skills = {"archify", "archify-review"}
        self.assertFalse((set(self.skills) - optional_skills) - used)

    def test_no_claude_code_leftovers(self):
        bad = ("mcp__", ".claude", "claude --agent", "Read로", "Bash 도구", "references/", "auto/bypass")
        for p in list((KIT / ".agents").rglob("*.md")):
            if "skills" in p.parts and p.parts[p.parts.index("skills") + 1] in {"archify", "archify-review"}:
                continue
            text = p.read_text(encoding="utf-8")
            for b in bad:
                self.assertNotIn(b, text, f"{p}: {b}")

    def test_rules_file_size_and_frontmatter(self):
        text = (KIT / ".agents" / "rules" / "board-core.md").read_text(encoding="utf-8")
        self.assertLess(len(text), 12000)
        self.assertIn("절대 규칙", text)

    def test_hooks_json(self):
        hooks = json.loads((KIT / ".agents" / "hooks.json").read_text(encoding="utf-8"))
        entry = hooks["board-publish-gate"]["PreToolUse"][0]
        rx = re.compile(entry["matcher"])
        for name in ("publish_post", "board-write/publish_post", "mcp_board-write_publish_post"):
            self.assertTrue(rx.search(name), name)
        for name in ("run_command", "view_file", "save_claim"):
            self.assertFalse(rx.search(name), name)
        handler = entry["hooks"][0]
        self.assertEqual(handler["type"], "command")
        self.assertIn("--agy-hook", handler["command"])

    def test_mcp_config_uses_documented_fields(self):
        cfg = json.loads((KIT / ".agents" / "mcp_config.json").read_text(encoding="utf-8"))["mcpServers"]
        self.assertEqual(set(cfg), {"rules", "board-read", "board-write"})
        for name, server in cfg.items():
            self.assertIn("command", server, name)
            self.assertFalse({"url", "httpUrl"} & set(server), name)

    def test_permission_snippet(self):
        perms = json.loads((KIT / "agy" / "settings.permissions.json").read_text(encoding="utf-8"))["permissions"]
        self.assertIn("mcp(board-write/publish_post)", perms["ask"])
        self.assertIn("mcp(board-write/record_gate)", perms["ask"])
        self.assertIn("write_file(rules/rules.json)", perms["deny"])
        for risky in ("mcp(board-write/publish_post)", "mcp(board-write/record_gate)", "mcp(*)", "mcp(board-write/*)"):
            self.assertNotIn(risky, perms["allow"])


if __name__ == "__main__":
    unittest.main()
