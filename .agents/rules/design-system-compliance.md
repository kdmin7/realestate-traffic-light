# Design System Compliance Rule

Strict design system governance for all frontend, HTML, and UI development in this repository.

## Absolute Rules

1. **Strictly Follow `DESIGN.md` Tokens**:
   - Whenever creating or modifying frontend/HTML/CSS/React code, you MUST exclusively use the styling tokens, spacing rhythm (4px/8px incremental base), typography scale, and color palette defined in [DESIGN.md](file:///C:/practice/geminiCLI/realestate_prj/DESIGN.md).
   - Base surface tokens: `--bg-primary`, `--bg-secondary`, `--bg-elevated`.
   - Text tokens: `--text-primary`, `--text-secondary`, `--text-muted`.
   - Border tokens: `--border-default`, `--border-subtle`.
   - Semantic signals: `--status-success` (`#10B981`), `--status-warning` (`#F59E0B`), `--status-danger` (`#EF4444`), `--status-info` (`#3B82F6`).

2. **No Arbitrary Inline Styles or Hardcoded Hex Colors**:
   - NEVER use arbitrary inline styles or ad-hoc CSS properties directly in HTML/JSX tags.
   - NEVER use hardcoded hex colors that are not present in [DESIGN.md](file:///C:/practice/geminiCLI/realestate_prj/DESIGN.md).
   - Use dedicated CSS classes or Tailwind utility classes defined in `tailwind.config.js`.

3. **Typography Constraints**:
   - Headings & Titles: `Space Grotesk` (or Pretendard / system fallback).
   - Body & Descriptions: `Inter` / `Hanken Grotesk` / `Pretendard`.
   - Data, Statistics, Currency, Numbers, Ratios: `JetBrains Mono` (`font-variant-numeric: tabular-nums`).

4. **Evidence & Budget Constraints (`board-core.md` alignment)**:
   - Always retain evidence grade indicators (A/B) on quantitative cards.
   - Budget Gate calculations must strictly remain client-side (no personal financial data saved or sent to servers).
