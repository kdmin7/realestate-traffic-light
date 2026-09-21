# 근거 기반 부동산 게시판 에이전트 키트 (Antigravity CLI용)

> **최종 갱신 기준일:** 2026-09-22  
> **운영 환경:** Google Antigravity CLI (`agy`) / Node.js / Python 3.10+  
> **핵심 원칙:** 근거 등급제(A~E), 구매력 한도 내 추천, 개인정보 비저장(클라이언트 계산), 4중 안전 게이트 (법률 자문 아님)

---

## 📌 2026-09-22 작업 및 파이프라인 검증 요약

본 저장소는 **Google Antigravity CLI(`agy`) 표준 아키텍처**로의 전면 전환에 이어, **웹 대시보드 간 네비게이션·디자인 일원화**, **지역 심층 대시보드 내 근거 아코디언 컴포넌트 연동**, 그리고 **MCP-Agent 유기적 연동 무결성 검증**을 완료했습니다.

1. **대시보드 상단 네비게이션 및 디자인 시스템 전면 통일**
   - 핵심 웹 대시보드 5종(`index.html`, `district_analysis_dashboard.html`, `schoolinfo_dashboard.html`, `crime_board.html`, `project_agent_mcp_dataflow.html`, `mcp_architecture_dashboard.html`)의 상단 글로벌 바(`.topbar`)에 표준 5대 네비게이션 메뉴를 일치시키고, 다크/라이트 테마 및 폰트(Pretendard/Noto Sans KR) 시스템을 전면 통일했습니다.
   - 메인 허브(`index.html`)의 56개 전 지역 행 클릭 시 `data/district_analysis_dashboard.html?region={지역명}` 으로 단일 라우팅되도록 일원화했습니다.

2. **지역 심층 분석 대시보드(`data/district_analysis_dashboard.html`) 고도화**
   - **지역 빠른 전환 드롭다운**: 상단 헤더에 수도권 31개 주요 지역 셀렉터를 탑재하여, 페이지 새로고침 없이 URL 쿼리 파라미터(`pushState`)와 시세·랜드마크·차트·학군·현금흐름이 실시간 동기화되도록 구현했습니다.
   - **[📑 공식 근거 카드 & PB 추천 리포트] 인라인 아코디언**: 4중 게이트 심의 상태 배너(`⏱️ 게시판 정식 발행 심의 대기 중`), A/B 사실 패널, C/D 의견 패널, PB 트레이드오프 분석(얻는 것/포기하는 것/전제조건) 카드를 구조화 렌더링하도록 연동했습니다.

3. **MCP 및 멀티 에이전트 유기적 데이터 파이프라인 검증 (PASS)**
   - `seoul-realty`, `crime-collector`, `schoolinfo` MCP의 실거래·치안·학군 데이터 수집 및 A등급 정규화 검증 완료.
   - `re-trend-risk`가 오직 A·B등급 근거만 읽어 4대 리스크 스코어를 산출하고 C·D등급 의견의 점수 오염을 차단함을 확인.
   - `rules` MCP를 통한 `rules/rules.json` 단일 진실 공급원(SSOT) 안전 조회 및 에이전트 쓰기 차단 무결성 확인.
   - 초안 작성(`re-reporter`) → 사전 심의(`legal-reviewer`) → 자동 훅 검증(`validate_board.py`) → 서버 해시 검증(`board_mcp.py`) → 사람 최종 승인(`force_ask`) → 공식 발행(`publisher`) 4중 방어선 연동 통과.

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
│   ├── verify_full_system.js             # Agent-MCP-데이터셋 전체 파이프라인 무결성 점검
│   └── validate-project.js               # 프로젝트 형상 무결성 점검 스크립트
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
│   ├── index.html                        # 메인 허브 대시보드 (전체 56개 지역 신호등)
│   ├── data/district_analysis_dashboard.html # 지역 심층 분석 대시보드 (31개 지역 드롭다운 & 근거 아코디언)
│   ├── mcp_architecture_dashboard.html  # MCP 아키텍처 대시보드
│   ├── crime_board.html                  # 경찰청 범죄 통계 치안 대시보드
│   └── schoolinfo_dashboard.html         # NEIS 학교정보 학군 대시보드
│
├── tests/                                # 단위 및 회귀 테스트
│   ├── test_board_mcp.py                 # MCP 서버 및 게이트 기능 테스트
│   ├── budget-gate.test.js               # 구매력 게이트 계산 로직 테스트
│   └── ... (총 33개 파이썬 유닛 테스트 전원 통과)
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

# 3) 전체 시스템(에이전트·MCP·데이터셋) 무결성 점검
node scripts/verify_full_system.js

# 4) 초안 및 규정 무결성 검증
python scripts/validate_board.py
```

### 2. Antigravity CLI (`agy`) 연동 설정
```powershell
# 권한 설정 미리보기
python scripts/agy_install.py

# 권한 설정 및 MCP 경로 실제 적용
python scripts/agy_install.py --apply --absolute-mcp
```

### 3. 인터랙티브 대시보드 및 데이터플로우 열기
- **메인 신호등 대시보드**: 브라우저에서 [`index.html`](file:///C:/practice/geminiCLI/realestate_prj/index.html) 오픈
- **지역 심층 분석 대시보드**: 브라우저에서 [`data/district_analysis_dashboard.html`](file:///C:/practice/geminiCLI/realestate_prj/data/district_analysis_dashboard.html) 오픈 (상단 드롭다운으로 31개 지역 전환 가능)
- **전사 Agent·MCP 데이터 파이프라인 다이어그램**: [`project_agent_mcp_dataflow.html`](file:///C:/practice/geminiCLI/realestate_prj/project_agent_mcp_dataflow.html) 오픈 (특정 노드 포커스: `#focus=mcp_rules`)
