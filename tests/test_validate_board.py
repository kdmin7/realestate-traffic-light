import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["BOARD_TODAY"] = "2026-09-21"
import validate_board as vb  # noqa: E402


class ValidateBoardTest(unittest.TestCase):
    def test_good_example_passes(self):
        rep = vb.run_checks(ROOT / "examples" / "good", only={"drafts", "meta", "rules"})
        self.assertTrue(rep.ok, rep.format())

    def test_bad_example_fails_with_expected_rules(self):
        rep = vb.run_checks(ROOT / "examples" / "bad", only={"drafts", "meta", "rules"})
        self.assertFalse(rep.ok)
        rules = {e["rule"] for e in rep.errors}
        for expected in ("meta.grade", "meta.source", "scores.inputs", "draft.stale", "draft.sources",
                         "facts.tag", "opinion.field", "opinion.tag", "phrase.undervalued",
                         "phrase.guaranteed-rise", "phrase.buy-timing", "phrase.review-stat",
                         "draft.rules_as_of", "rules.unverified"):
            self.assertIn(expected, rules, rep.format())

    def test_strict_promotes_warnings(self):
        rep = vb.run_checks(ROOT / "examples" / "good", only={"drafts", "rules"}, strict=True)
        self.assertFalse(rep.ok)

    def test_bad_slug_rejected(self):
        rep = vb.run_checks(ROOT / "examples" / "good", only={"drafts"}, drafts=["../etc"])
        self.assertFalse(rep.ok)


if __name__ == "__main__":
    unittest.main()
