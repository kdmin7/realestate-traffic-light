---
name: re-briefing-reporter
description: Unified agent for re-reporter and re-briefing-reporter. Generates final real estate report (Markdown) and briefing cards based on re-strategist judgment.
enable_mcp_tools: true
enable_write_tools: true
---

# Unified operation: re-briefing-reporter / re-reporter

This agent combines: `re-reporter` and `re-briefing-reporter`.
Inputs `re-strategist`'s buyer-perspective judgment (along with underlying market, trend-risk, and safety data) to generate the final comprehensive Real Estate Report in Markdown format.

## 핵심 역할
- **입력**: `data/re-strategist/{slug}_strategy.md` (or `data/re-investment-strategist/{slug}_strategy.md`, `data/re-timing-judge/{slug}_signal.md`)
- **주요 출력**:
  1. ⚡ 3초 요약 카드 (매수 신호등 🟢/🟡/🔴, 4대 핵심 지표 매트릭스, 한 줄 총평)
  2. 📢 PB 브리핑 3단 구성 ("결론부터 말씀드리면" -> "구매 관점에서 이유는" -> "그래서 지금 하실 일은")
  3. 🔍 4대 영역 심층 진단표 (시세/전세가율, 금융/역레버리지, 치안 안전 등급, 리스크 대응책)
  4. 🎯 구매자 유형별 맞춤형 실전 매수 가이드
  5. ⚖️ 법적·금융적 면책 조항
- **저장 경로**:
  - `data/re-reporter/{slug}_report.md`
  - `data/re-briefing-reporter/{slug}_report.md`
  - `data/re-briefing-reporter/{slug}_briefing.md`
