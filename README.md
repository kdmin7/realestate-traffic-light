# 근거 기반 부동산 게시판 에이전트 키트 (Antigravity CLI용)

> **최종 갱신 기준일:** 2026-09-21  
> **운영 환경:** Google Antigravity CLI (`agy`) / Node.js / Python 3.10+  
> **핵심 원칙:** 근거 등급제(A~E), 구매력 한도 내 추천, 개인정보 비저장(클라이언트 계산), 4중 안전 게이트 (법률 자문 아님)

---

## 📌 2026-09-21 작업 및 업데이트 요약

본 저장소는 기존 Claude Code 기반 설정을 **Google Antigravity CLI(`agy`) 표준 아키텍처**로 전면 전환하고, 데이터 파이프라인 시각화 및 무결성 검증 체계를 완비했습니다.

1. **Google Antigravity CLI 표준 규약 전면 적용**
   - 프로젝트 공통 룰셋 정의: `.agents/rules/board-core.md` (절대 규칙 5대 원칙, 근거 등급 A~E, 문체 규약)
   - 멀티 에이전트 구축: `board-orchestrator`를 중심으로 15개 전문 서브에이전트 구성 (`.agents/agents/`)
   - 전문 스킬 체계화: 절차적 워크플로우를 담당하는 13개 스킬 등록 (`.agents/skills/`)
   - 권한 및 훅 체계: `.agents/hooks.json` 및 `agy/settings.permissions.json`을 통한 발행 통제

2. **단일 진실 공급원(SSOT) 정책 규칙 및 자체 Python 경량 MCP 서버 구축**
   - `rules/rules.json`: LTV, DSR, 취득세, 스트레스 금리 등 대출·세제 규정의 단일 기준점 마련 (AI 에이전트의 임의 수정 차단)
   - `MCP/board_mcp.py`: 표준 라이브러리 기반 경량 MCP 서버 개발 (`rules`, `board-read`, `board-write` 3개 프로필로 읽기/쓰기 권한 분리)

3. **엔드투엔드 Agent·MCP 데이터 파이프라인 시각화 구축 (`project_agent_mcp_dataflow.html`)**
   - Archify 엔진 기반 5단계 데이터 흐름도(`project_agent_mcp_dataflow.json`) 작성 및 단독 실행형 HTML 다이어그램 빌드
   - 3대 중점 경로 뷰(`facts-path`, `rules-strategy-path`, `gate-publish-path`), 다크/라이트 테마, 인라인 SVG 애니메이션, 모바일 반응형 최적화 완료
   - Headless Chrome 기반 해상도별 렌더링 및 시각 회귀 테스트 검증 통과

4. **클라이언트 사이드 구매력 게이트(`web/budget-gate.js`) 및 테스트 스위트 강화**
   - 사용자 소득·자산 등 개인 재정 정보의 서버 전송을 원천 차단하고 브라우저에서만 실시간 대출·부대비용을 계산하는 로직 구축
   - Python `unittest` 33개 테스트 및 `budget-gate.test.js` 전원 통과 검증

---

## 📂 전체 디렉터리 및 파일 구성

```
realestate_prj/
├── .agents/                               # Antigravity CLI 에이전트·스킬·규칙 설정
│   ├── rules/
│   │   └── board-core.md                 # 5대 절대 규칙, 근거 등급제, 발행 파이프라인 규약
│   ├── agents/                           # 15개 전문 서브에이전트 정의 (agent.md)
│   │   ├── board-orchestrator/           # 전체 파이프라인 조율 오케스트레이터 (메인)
│   │   ├── re-market-data/               # 실거래·공공 데이터 수집 및 A등급 정규화
│   │   ├── re-safety-analyst/            # 경찰청 치안/안전 데이터 분석
│   │   ├── re-trend-risk/                # 4대 리스크 스코어링 (A·B등급 근거만 사용)
│   │   ├── re-rules/                     # 공식 법령·보도자료 원문 대조 및 규정 제안
│   │   ├── re-strategist/                # 구매력 한도 내 트레이드오프 및 추천 카드 도출
│   │   ├── re-tax-strategist/            # 취득세·보유세·양도세 정밀 세무 시뮬레이션
│   │   ├── re-reporter/                  # 사실(A/B)·의견(C/D) 패널 분리 초안 작성
│   │   ├── legal-reviewer/               # 담합·단정적 수익 표현·법률 리스크 사전 심의
│   │   ├── fact-checker/                 # 유튜버·보고서 등 전문가 견해 검증
│   │   ├── community-moderator/          # 회원 거래/거주 후기 검수
│   │   ├── publisher/                    # 품질 게이트 통과 초안 최종 게시판 발행
│   │   └── ... (통합 에이전트 등)
│   ├── skills/                           # 전문 작업 지침 (13개 SKILL.md)
│   │   ├── board-workflow/               # 발행 단계 및 게이트 증적 체크리스트
│   │   ├── budget-gate/                  # 구매력 계산 및 예산 초과 차단 로직
│   │   ├── rules-table/                  # LTV·DSR 등 정책 테이블 관리 지침
│   │   ├── evidence-grading/             # A~E 근거 등급 부여 및 출처 검증
│   │   ├── claim-verification/           # 전문가 견해 검증 절차
│   │   ├── experience-review/            # 회원 경험 사례 양식 검수
│   │   ├── legal-gate/                   # 발행 전 법률·표현 체크리스트
│   │   ├── location-metrics/             # 학군·상권·역세권 등 입지 지표 산출
│   │   ├── recommend-card/               # 추천 카드 및 지표 팩 작성 규약
│   │   ├── region-card/                  # 지역 게시 초안 포맷 규약
│   │   ├── moderation-policy/            # 커뮤니티 운영 및 게시글 검수 정책
│   │   └── archify / archify-review/     # 시스템 아키텍처 다이어그램 생성·리뷰
│   ├── mcp_config.json                   # rules, board-read, board-write MCP 서버 설정
│   └── hooks.json                        # 발행(publish_post) 전 결정적 검증 강제 훅
│
├── MCP/                                  # 자체 및 외부 MCP 도구 구성
│   └── board_mcp.py                      # 표준 라이브러리 기반 통합 MCP 서버
│       ├── --profile rules               # 정책 규칙 조회 (list_rules, get_rule 등)
│       ├── --profile board-read          # 초안·견해·후기·게이트 조회
│       └── --profile board-write         # 견해/후기 저장, 게이트 기록, 최종 발행
│
├── rules/                                # 공식 정책 규정 단일 진실 공급원 (SSOT)
│   ├── rules.json                        # LTV, DSR, 취득세, 스트레스 가산금리 (AI 수정 불가)
│   └── proposals/                        # 규정 개정 제안서 마크다운 저장소
│
├── data/                                 # 데이터 저장소
│   ├── board/                            # 게시판 파이프라인 산출물
│   │   ├── drafts/                       # 작성된 지역 초안 (.md)
│   │   ├── claims/                       # 검증된 C등급 전문가 견해 (.json)
│   │   ├── experiences/                  # 검수된 D등급 회원 경험담 (.json)
│   │   ├── gates/                        # 초안별 법률·무결성 통과 증적 기록 (.json)
│   │   └── published/                    # 최종 발행 완료된 게시글 및 색인
│   ├── re-market-data/                   # 실거래가 정규화 데이터 (A등급)
│   ├── re-safety-analyst/                # 지역별 치안 안전 지표 (A등급)
│   └── re-trend-risk/                    # 4대 리스크 스코어 산출 데이터 (B등급)
│
├── scripts/                              # 자동화 및 품질 검증 스크립트
│   ├── validate_board.py                 # 초안·근거·메타·규정·금지어 결정적 검증 도구
│   ├── agy_install.py                    # 권한 규칙 병합 및 MCP 경로 설정 유틸리티
│   └── validate-project.js               # 프로젝트 무결성 점검 스크립트
│
├── web/                                  # 브라우저 프론트엔드 연동 자산
│   └── budget-gate.js                    # 클라이언트 전용 구매력 계산기 (개인정보 비저장)
│
├── config/                               # 설정 파일
│   ├── forbidden_phrases.json            # 금지 문구(단정적 수익, 오를 지역 등) 사전
│   └── board_policy.json                 # 데이터 및 규칙 유효 기간(Max Age) 정책
│
├── diagrams/ & Root Visual Dashboards    # 인터랙티브 시각화 대시보드
│   ├── project_agent_mcp_dataflow.html   # 전사 Agent·MCP 데이터 파이프라인 흐름도 (Archify)
│   ├── project_agent_mcp_dataflow.json   # 흐름도 모델 원본
│   ├── index.html                        # 프로젝트 종합 허브 및 리소스 센터
│   ├── mcp_architecture_dashboard.html  # MCP 아키텍처 대시보드
│   ├── district_safety_dashboard.html    # 지역별 치안 대시보드
│   ├── crime_board.html                  # 범죄 통계 분석 보드
│   └── schoolinfo_dashboard.html         # 학군 정보 대시보드
│
├── tests/                                # 단위 및 회귀 테스트
│   ├── test_board_mcp.py                 # MCP 서버 및 게이트 기능 테스트
│   ├── budget-gate.test.js               # 구매력 게이트 계산 로직 테스트
│   └── ... (총 33개 파이썬 테스트)
│
├── agy/                                  # Antigravity CLI 보조 설정
│   └── settings.permissions.json         # 사용자 전역 설정용 권한 프리셋 템플릿
│
└── examples/                             # 검증 통과(good) 및 실패(bad) 예시 데이터
```

---

## 🛡️ 5대 절대 규칙 및 4중 안전 게이트

본 프로젝트의 모든 에이전트와 파이프라인은 [`.agents/rules/board-core.md`](file:///C:/practice/geminiCLI/realestate_prj/.agents/rules/board-core.md)의 절대 규칙을 따릅니다:

1. **근거 등급 없는 정보 발행 금지**: 모든 데이터와 견해에 등급(A~E), 출처 URL, 기준일자가 필수 기재됩니다.
2. **점수/추천은 A·B 등급만 반영**: 전문가 견해(C), 개인 후기(D), 주관적 전망(E)은 수치 스코어링에 포함되지 않고 의견 패널에만 분리 표시됩니다.
3. **구매력 초과 지역 추천 차단**: 사용자 예산을 넘어서는 지역은 절대 메인 추천에 포함되지 않으며 참고 영역으로 격리됩니다.
4. **금지 문구 사용 차단**: "무조건 상승", "저평가 단지", "매수 적기" 등 조급함을 유도하거나 확정적인 수익을 암시하는 표현 사용을 금지합니다 (`config/forbidden_phrases.json`).
5. **개인 금융 정보 비저장**: 소득·자산 등 개인 재정 정보는 서버나 외부 모델에 전송되지 않으며 오직 브라우저(`web/budget-gate.js`)에서만 연산됩니다.

### 최종 발행 전 4중 방어선
```
[초안 작성] re-reporter
   ↓
[1차] legal-reviewer 심의 (담합 유도, 수익 보장 표현 점검 → record_gate legal)
   ↓
[2차] validate_board.py 자동 훅 검증 (규칙 최신성, 근거 등급 무결성, 금지어 검사)
   ↓
[3차] board_mcp.py 서버 단 검증 (초안 파일 sha256 해시 일치 및 변조 여부 재확인)
   ↓
[4차] Antigravity force_ask (권한 프리셋과 무관하게 사람의 최종 승인 필수)
   ↓
[발행 완료] publisher 에이전트가 data/board/published/ 로 배포
```

---

## 🚀 실행 및 검증 가이드

### 1. 테스트 스위트 실행
```powershell
# 1) Python 파이프라인, MCP, 검증기 전체 단위 테스트 (33개)
python -m unittest discover -s tests

# 2) 브라우저 예산 게이트(구매력 계산기) 테스트
node tests/budget-gate.test.js

# 3) 초안 및 규정 무결성 검증
python scripts/validate_board.py
```

### 2. Antigravity CLI (`agy`) 연동 설정
```powershell
# 권한 설정 미리보기
python scripts/agy_install.py

# 권한 설정 및 MCP 경로 실제 적용
python scripts/agy_install.py --apply --absolute-mcp
```

### 3. 인터랙티브 데이터 파이프라인 다이어그램 열기
- 브라우저에서 [`project_agent_mcp_dataflow.html`](file:///C:/practice/geminiCLI/realestate_prj/project_agent_mcp_dataflow.html)을 열어 전체 에이전트-MCP 상호작용 및 3대 핵심 경로(`facts-path`, `rules-strategy-path`, `gate-publish-path`)를 인터랙티브하게 탐색할 수 있습니다.
- 특정 노드(예: 규정 조회 MCP) 포커스 URL:  
  `project_agent_mcp_dataflow.html#focus=mcp_rules`
