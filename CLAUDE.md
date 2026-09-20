# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 이 저장소는 무엇인가

**"부동산 신호등"** — 부동산 투자 판단(매수 타이밍 신호 + 수익성 분석)을 자동화하기 위한 4단계 subagent 파이프라인이다. 판정 신호 3단계는 신호등 색에 대응된다(매수고려 🟢 / 주의 🟡 / 관망 🔴). 전통적인 코드베이스가 아니라 `.claude/agents/`의 subagent 정의와 `data/`의 산출물 저장소로 구성되며, 빌드·린트·테스트 명령은 없다 (`MCP/`의 Node 서버는 예외).

## 파이프라인 구조

데이터는 3대 정보 수집·분석 에이전트(`re-market-data`, `re-trend-risk`, `re-safety-analyst`)에서 각각 취합되어 저장된 뒤, 투자 전략가(`re-strategist`)에게 전달되어 **"부동산을 구매하기 위한 입장"**에서 종합 판단을 내리고, 최종적으로 리포터(`re-reporter`)가 완성형 부동산 종합 Report (Markdown)를 생성한다.

```
[re-market-data]    (공공데이터 원천 수집)   ──┐
[re-trend-risk]     (트렌드·리스크 스코어링) ──┼─> [re-strategist] (구매자 관점 종합 판단) ─> [re-reporter] (최종 부동산 Report 생성)
[re-safety-analyst] (13개년 치안·범죄 분석) ──┘
```

- **re-market-data**: 국토부 실거래가, 전세가율, 인구·공급, 기준금리, 학군 지수를 수집해 원자재 데이터셋 저장 (`data/re-market-data/{slug}_raw.md`, 호환: `data/re-data-collector/{slug}_raw.md`).
- **re-trend-risk**: 원자재 데이터를 중장기 트렌드 점수와 4대 리스크(고점매수·환금성·금리·치안) 점수(-2~+2)로 변환해 저장 (`data/re-trend-risk/{slug}_scores.md`, 호환: `data/re-trend-risk-analyst/{slug}_scores.md`).
- **re-safety-analyst**: 경찰청 13개년 범죄통계와 5대 강력범죄율, 시계열 추이를 심층 분석해 자치구 치안 등급(S/A/B/C/D) 및 안심 주거 리포트 저장 (`data/re-safety-analyst/{slug}_safety_report.md`).
- **re-strategist**: 위 3대 에이전트가 저장한 데이터들을 종합 입력받아 **"부동산을 구매하기 위한 입장 (매수자 / 실거주자 / 투자자)"**에서 가격 적정성, 금융 감당력, 거주 안전성과 자산 방어력을 판단하고 매수 타이밍 신호(🟢/🟡/🔴) 및 실전 구매 전략 저장 (`data/re-strategist/{slug}_strategy.md`, 호환: `data/re-investment-strategist/{slug}_strategy.md`, `data/re-timing-judge/{slug}_signal.md`).
- **re-reporter**: `re-strategist`의 구매자 관점 종합 판단을 받아 3초 요약 카드, PB 브리핑 3단 구성, 4대 심층 진단표, 맞춤형 실전 매수 가이드를 담은 최종 부동산 Report (Markdown) 생성·저장 (`data/re-reporter/{slug}_report.md`, 호환: `data/re-briefing-reporter/{slug}_report.md`, `{slug}_briefing.md`).

각 subagent의 상세 역할·페르소나·원칙·출력 형식은 `.agents/agents/<name>/agent.md` 및 `.claude/agents/<name>.md`가 단일 진실 공급원(source of truth)이다.

## 오케스트레이션 규칙 (메인 에이전트가 지킬 것)

메인 세션의 역할은 **지휘자**다: 단계를 순서대로 호출하고, 산출물을 검증하고, 최종 대시보드를 조립한다.

### 표준 실행 (지역 전체 분석: "OO구 분석해줘")

1. 지역명을 slug로 변환한다 — 소문자 로마자 (예: 송파구 → `songpa`, 강남구 → `gangnam`).
2. 1단계: `re-market-data`, `re-trend-risk`, `re-safety-analyst`를 호출하여 정보를 취합·저장한다.
   - `re-market-data` ➔ `data/re-market-data/{slug}_raw.md`
   - `re-trend-risk` ➔ `data/re-trend-risk/{slug}_scores.md`
   - `re-safety-analyst` ➔ `data/re-safety-analyst/{slug}_safety_report.md`
3. 2단계: `re-strategist`에 위 3개 저장 파일 경로를 입력하여 **부동산 구매자 관점**의 종합 판단과 매수 타이밍 신호를 산출·저장한다.
   - `re-strategist` ➔ `data/re-strategist/{slug}_strategy.md` (호환: `data/re-timing-judge/{slug}_signal.md`)
4. 3단계: `re-reporter`에 `re-strategist`의 판단 결과를 입력하여 **최종 부동산 종합 Report (Markdown)**를 생성·저장한다.
   - `re-reporter` ➔ `data/re-reporter/{slug}_report.md` (호환: `data/re-briefing-reporter/{slug}_report.md`)
5. **결론 주입 금지**: 이전 단계 데이터의 요약·점수·결론을 다음 단계 프롬프트에 미리 써넣지 않는다. 각 단계가 입력 파일을 직접 읽고 스스로 판단해야 판정 편향이 없다.
6. **체크포인트**: 각 단계 완료 후 출력 파일 존재를 확인하고 다음 단계로 넘어간다.

### 데이터 저장 규칙

- 각 subagent는 자기 이름과 매핑된 폴더에 쓴다:
  - `data/re-market-data/` 및 `data/re-data-collector/`
  - `data/re-trend-risk/` 및 `data/re-trend-risk-analyst/`
  - `data/re-safety-analyst/`
  - `data/re-strategist/` 및 `data/re-investment-strategist/`, `data/re-timing-judge/`
  - `data/re-reporter/` 및 `data/re-briefing-reporter/`
- 파일명 컨벤션: `{slug}_raw.md` → `{slug}_scores.md` & `{slug}_safety_report.md` → `{slug}_strategy.md` → `{slug}_report.md`.
- 같은 지역 재실행 시 기본은 덮어쓰기. 보존 가치가 있는 버전은 `{slug}_raw_deep.md`처럼 접미사로 구분한다.
- 목적: 단계별 산출물의 독립 추적 + 부분 재실행 시 신규 생성물 식별.

## MCP 데이터 서버 (`MCP/`)

`MCP/` 폴더에는 파이프라인과 연동된 로컬 MCP 서버가 있다 (Node 18+, stdio 트랜스포트):

- **realestate-server.js (seoul-realty)** — 수도권 거시분석(금리/학군/범죄/인구/소득) + 유형별 실거래(아파트/오피스텔/빌라/단독/상업) + 청약 + 재무계산기 + A2A 위치/역세권/투자가치/삶의질/맞춤추천, 총 28개 도구. 등록 시 `mcp__seoul-realty__*`로 노출되며 re-data-collector 및 후속 에이전트의 핵심 데이터 소스가 된다.

등록 명령(경로는 이 저장소 기준으로 갱신된 것):
```
claude mcp add seoul-realty -e MOLIT_API_KEY=... -e ECOS_API_KEY=... -e NEIS_API_KEY=... -- node C:\practice\geminiCLI\realestate_prj\MCP\realestate-server.js
```
API 키는 사용자 소유이며 절대 커밋하지 않는다. REST 도구(실거래가·전세가율·금리·학군)는 키만 있으면 되고, 범죄·생활인구·소득 도구는 `MCP/data/` 아래 CSV 파일을 요구한다(현재 비어 있음). 상세 문서: `MCP/README.md`, `MCP/TRANSFER-GUIDE.md`.

## 설계 원칙 (수정 시 유지할 것)

- **읽기 전용**: 4개 subagent 모두 Bash/PowerShell/Edit 도구를 의도적으로 배제했다. 공개데이터를 읽고 새 결과 파일을 쓰는 것만 가능하며, 시스템 명령 실행이나 기존 파일 수정은 불가능하다. subagent에 새 도구를 추가할 때는 이 read-only 원칙이 깨지지 않는지 먼저 확인한다. MCP 도구는 collector에게만 부여한다 (데이터 조회 창구 단일화).
- **출처 명시**: 모든 수치·점수·신호는 근거(출처 URL 또는 이전 단계 산출물 경로)를 남긴다. 출처 불명 수치는 사용하지 않는다.
- **최종 판단은 사용자 몫**: 어떤 subagent도 "매수하라"는 지시를 내리지 않는다. 신호는 참고용이며, 실제 매수·매도·자금집행 결정과 세무·대출 실행은 항상 사용자가 한다.

## 알려진 제약

- 새로 만들거나 수정한 `.claude/agents/*.md`와 새로 등록한 MCP 서버는 **세션을 새로 시작해야** 반영된다. 같은 세션에서 Agent 도구로 새 이름을 호출하면 "Agent type not found" 에러가 난다.
- 재시작 전에 파이프라인을 테스트해야 한다면: 해당 subagent `.md`를 Read로 읽어 그 내용을 `general-purpose` 에이전트 프롬프트 앞부분에 그대로 붙여 임시 실행한다. 이때도 오케스트레이션 규칙(결론 주입 금지, 저장 경로, 체크포인트)은 동일하게 적용한다.
