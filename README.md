# 🚦 부동산 신호등

> **4개의 AI 에이전트가 켜주는 매수 타이밍 신호**

부동산 투자 판단을 자동화하는 **멀티에이전트 시스템**입니다. 공공데이터 수집부터 최종 브리핑까지 4단계를 거쳐 매수 타이밍 신호와 수익성 분석을 제공합니다.

신호는 신호등 3색에 대응됩니다:

| 신호 | 색 | 의미 |
|------|-----|------|
| 매수고려 | 🟢 | 트렌드 양호 + 리스크 낮음, 진입 검토 가능 |
| 주의 | 🟡 | 기회는 있으나 리스크 동반, 조건 확인 후 판단 |
| 관망 | 🔴 | 지금은 멈추고 기다리기 |

---

## 🏗️ 시스템 구조

### 데이터 흐름: 한 방향 파이프라인

```
공공데이터
    ↓
[① re-data-collector]
  → 원자재 데이터셋
    ↓
[② re-trend-risk-analyst]
  → 트렌드/리스크 스코어
    ↓
[③ re-timing-judge]
  → 매수 신호 + 수익성 분석
    ↓
[④ re-briefing-reporter]
  → 최종 브리핑 (HTML/텍스트)
```

### 각 서브에이전트 역할

#### 1️⃣ **re-data-collector** (데이터 수집가)
- **역할**: 공공데이터 조회 및 정리
- **입력**: 관심 지역/단지 리스트
- **출력**: 원자재 데이터셋 (출처 명시)
- **페르소나**: 통계 담당관형 리서처 (건조·명사형 종결, 팩트+출처만, 해석 제외)
- **도구**: WebFetch, WebSearch, Read, Write
- **출력 폴더**: `data/re-data-collector/`

**조회 항목:**
- 실거래가 추이
- 전세가율
- 공급물량 캘린더
- 인구 추이
- 기준금리
- 매물 적체 기간 (가능 시)
- 개발 호재 진행 상황

---

#### 2️⃣ **re-trend-risk-analyst** (트렌드·리스크 분석가)
- **역할**: 데이터 → 스코어화
- **입력**: re-data-collector 출력 파일
- **출력**: 트렌드/리스크 점수표 (척도: -2~+2)
- **페르소나**: 리서치센터 애널리스트 (점수 먼저 + 근거 한 줄, 보고서형 종결, 판단은 안 함)
- **도구**: Read, Write, Grep, Glob
- **출력 폴더**: `data/re-trend-risk-analyst/`

**생성하는 스코어:**
- **트렌드 스코어**: 공급물량, 개발호재, 인구 유입
- **리스크 스코어**: 고점매수, 환금성, 금리 (3가지)

---

#### 3️⃣ **re-timing-judge** (판단 엔진)
- **역할**: 스코어 종합 판정 + 수익성 계산
- **입력**: re-trend-risk-analyst 출력 파일 + (선택) 매물 정보
- **출력**: 매수 신호 ("관망"/"주의"/"매수고려") + 수익률 시뮬레이션
- **페르소나**: 여신심사역형 심사관 (판정→규칙→근거 구조, 조건부 화법, 책임 고지 고정 문장)
- **도구**: Read, Write
- **출력 폴더**: `data/re-timing-judge/`

**판정 규칙:**
| 트렌드 | 리스크 | 신호 |
|-------|-------|------|
| (+) | (-) | 매수고려 |
| (+) | (+) | 주의 |
| (-) | (+) | 관망 |
| (-) | (-) | 관망 |

**수익성 계산 항목:**
- 캡레이트
- 자기자본수익률 (기본 조건)
- 시나리오별 수익률 변화 (금리+1%p, 공실, 월세 하락 등)
- 개선안 3가지

---

#### 4️⃣ **re-briefing-reporter** (리포터)
- **역할**: 최종 결과 브리핑
- **입력**: re-timing-judge 출력 파일
- **출력**: 텍스트 브리핑 + (선택) Artifact (HTML 카드)
- **페르소나**: PB형 상담가 (결론→이유→지금 할 일 3단 구성, 쉬운 말, 과장 금지)
- **도구**: Read, Write, Artifact
- **출력 폴더**: `data/re-briefing-reporter/`

**포함 내용:**
- 핵심 신호 카드 (시각적)
- 신호 근거 (3줄)
- 수익성 요약 (표)
- 최우선 액션
- 출처 링크

---

## 📁 폴더 구조

```
realestate_prj/
├── CLAUDE.md                           # 저장소 가이드 (Claude Code용)
├── README.md                           # 이 파일
│
├── .claude/
│   └── agents/                         # Subagent 정의 파일
│       ├── re-data-collector.md
│       ├── re-trend-risk-analyst.md
│       ├── re-timing-judge.md
│       └── re-briefing-reporter.md
│
├── MCP/                                # 로컬 MCP 데이터 서버 (Node 18+)
│   ├── realestate-server.js            # seoul-realty — 서울 부동산 인사이트 (8 tools)
│   ├── trade-server.js                 # semiconductor-trade — 반도체 수출입 (별도)
│   └── data/                           # 범죄·생활인구·소득 CSV 위치 (현재 비어 있음)
│
├── data/                               # 각 단계의 산출물
│   ├── re-data-collector/
│   │   └── {지역명}_raw.md            # 원자재 데이터
│   ├── re-trend-risk-analyst/
│   │   └── {지역명}_scores.md         # 스코어 테이블
│   ├── re-timing-judge/
│   │   └── {지역명}_signal.md         # 신호 + 수익성
│   ├── re-briefing-reporter/
│   │   └── {지역명}_briefing.md       # 최종 브리핑
│   └── songpa_analysis_dashboard.html # 최종 HTML 대시보드
```

---

## 🔌 MCP 데이터 서버 연동

`MCP/realestate-server.js`(seoul-realty)를 등록하면 re-data-collector가 언론 기사(2차 출처) 대신 **국토부·한국은행 1차 API를 직접 호출**합니다.

| MCP 도구 | 신호등에서의 쓰임 |
|---------|-----------------|
| `get_price_trend` | 실거래가 분기 트렌드 → 고점매수 리스크·가격 트렌드 |
| `get_jeonse_ratio` | 전세가율 → 고점매수 리스크 핵심 프록시 |
| `get_macro_context` | 기준금리·주담대 금리 시계열 → 금리 리스크 |
| `get_living_population` | 생활인구 추이 → 인구 유입 트렌드 |
| `get_school_index` · `get_crime_rate` · `get_region_income` | 학군·치안·소득 → (확장) 입지 트렌드 지표 |
| `get_district_score` | 자치구 종합 순위 → 지역 스카우팅 (분석 대상 발굴) |

등록 명령·API 키 발급처·CSV 준비 방법은 `MCP/README-seoul-realty.md` 참고. 미등록 상태여도 파이프라인은 웹 조회로 폴백해서 동작합니다.

---

## 🚀 사용법

### 1️⃣ 새 지역 분석 시작

```
관심 지역: 서울시 [구]
```

위와 같이 지역을 지정하면 Claude Code에서:

```bash
# 1단계: 데이터 수집
> 4단계 AI 파이프라인으로 OO구 분석해줄래?
→ re-data-collector 실행
→ data/re-data-collector/{지역명}_raw.md 생성

# 2단계: 트렌드/리스크 분석
→ re-trend-risk-analyst 자동 실행 (1단계 출력 읽음)
→ data/re-trend-risk-analyst/{지역명}_scores.md 생성

# 3단계: 매수 신호 판정
→ re-timing-judge 자동 실행 (2단계 출력 읽음)
→ data/re-timing-judge/{지역명}_signal.md 생성

# 4단계: 최종 브리핑
→ re-briefing-reporter 자동 실행 (3단계 출력 읽음)
→ data/re-briefing-reporter/{지역명}_briefing.md 생성
→ HTML 대시보드 생성
```

### 2️⃣ 각 단계 개별 실행

필요하면 중간 단계부터 다시 실행할 수 있습니다:

```bash
# 예: 기준금리가 변경되었으니 트렌드/리스크 다시 계산
→ re-trend-risk-analyst 다시 실행 (기존 _raw.md 읽음)

# 예: 더 신축적인 수익률 시뮬레이션 필요
→ re-timing-judge 다시 실행 (기존 _scores.md 읽음)
```

### 3️⃣ 다른 형태의 출력

```bash
# 텍스트 브리핑
→ re-briefing-reporter 실행
→ data/re-briefing-reporter/{지역명}_briefing.md

# HTML 대시보드
→ 최종 단계 완료 후 HTML 자동 생성
→ 브라우저에서 열어서 시각적 확인
```

---

## ⚙️ 설정 & 커스터마이징

### 분석 시간축 변경

현재 설정: **중기(6개월~2~3년) + 장기(3년+)** 중심

다른 시간축 원하면 각 subagent `.md` 파일의 역할 정의 섹션 수정:

```markdown
# .claude/agents/re-trend-risk-analyst.md
## 담당 범위: 두 종류의 스코어

### 1) 중장기 트렌드 스코어
- [시간축 변경 가능]
```

### 리스크 항목 추가/제거

현재 3가지: 고점매수, 환금성, 금리

예를 들어 **세제 리스크** 추가하려면:

```markdown
# .claude/agents/re-trend-risk-analyst.md
### 2) 리스크 스코어 (사용자 관심)
- 고점매수 리스크 → 전세가율 등으로 프록시
- 환금성 리스크 → 거래량 추이를 프록시
- 금리 리스크 → 기준금리 방향성
- **[신규] 세제 리스크 → 양도세 감면 종료 등**
```

---

## 🛡️ 설계 원칙 (유지할 것)

1. **읽기 전용**: 4개 에이전트 모두 Bash/PowerShell/Edit 도구 배제
   - 공개데이터 읽기 + 새 파일 쓰기만 가능
   - 기존 파일 수정이나 시스템 명령 불가

2. **출처 명시**: 모든 수치·점수에 근거 남김
   - Collector: URL + 기관명
   - Analyst: Collector 파일 경로
   - Judge: Analyst 파일 경로 + 계산식
   - Reporter: 모든 출처 링크 포함

3. **최종 판단은 사용자**: 에이전트는 신호만 제공
   - "매수하라" 지시 금지
   - 세무사/공인중개사 확인 필수 항목 명시
   - 신호는 "참고용"임을 항상 강조

4. **페르소나 일관성**: 각 에이전트의 캐릭터·말투 유지 (상세 규칙은 각 `.claude/agents/*.md`의 "페르소나" 섹션이 원본)
   - Collector: 통계 담당관 — 건조한 명사형 종결, 출처 필수, 이모지·해석 금지
   - Analyst: 리서치 애널리스트 — 점수 먼저·근거 한 줄, 감정 형용사 대신 수치
   - Judge: 여신심사역 — 판정문 구조 + 조건부 화법 + 책임 고지 문장
   - Reporter: PB 상담가 — 결론→이유→할 일 3단 구성, 용어는 한 줄 번역

---

## 🔄 주기적 업데이트

### 매월 (기준금리 발표 후)

```bash
1. re-data-collector 재실행 → 최신 기준금리·실거래가 수집
2. re-trend-risk-analyst 자동 재실행
3. re-timing-judge 자동 재실행
4. re-briefing-reporter 최종 브리핑 업데이트
```

### 분기별 (인구·공급 통계 갱신)

```bash
1. 통계청 인구·공급 데이터 확인
2. re-data-collector 재실행 (새 수치 반영)
3. 전체 파이프라인 재실행
```

### 필요 시 (특별 호재)

```bash
예: 잠실 MICE 착공식, 재건축 조합 설립 등
→ re-data-collector로 최신 호재 추가
→ 전체 파이프라인 재실행
```

---

## 📊 예시: 송파구 분석 결과

이미 생성된 **송파구 예시**:
- `data/re-data-collector/songpa_raw.md` — 원본 데이터
- `data/re-trend-risk-analyst/songpa_scores.md` — 스코어 분석
- `data/re-timing-judge/songpa_signal.md` — 신호 판정
- `data/re-briefing-reporter/songpa_briefing.md` — 최종 브리핑
- `data/songpa_analysis_dashboard.html` — 대시보드

**최종 신호**: ⚠️ **주의** (기회는 있으나 금리 위험)

---

## ❓ FAQ

### Q1. 왜 4단계를 나누나?

**A**: 각 단계를 독립적으로 추적·수정하기 위함입니다.
- 새 데이터 수집 필요 → Collector만 재실행
- 스코어링 방식 변경 → Analyst만 재실행
- 신호 규칙 변경 → Judge만 재실행

단계가 섞여 있으면 한 부분 수정 시 전체를 다시 돌려야 하는 낭비가 생깁니다.

### Q2. 다른 사람도 이 시스템을 쓸 수 있나?

**A**: 가능합니다. `.claude/agents/*.md`가 있고 CLAUDE.md가 있으면, 다른 Claude Code 사용자도 같은 방식으로 사용할 수 있습니다.

### Q3. "매수고려" 신호가 나오면 바로 사야 하나?

**A**: **아니오.** 신호는 참고만 하고, 반드시:
1. 현장 임장
2. 세무사 상담 (세금 계산)
3. 공인중개사 상담 (거래 조건)
4. 은행 사전 심사 (대출 가능성)

을 거쳐야 합니다. 에이전트는 데이터 기반 참고 신호만 제공하는 역할입니다.

### Q4. 이 시스템이 100% 정확한가?

**A**: 아니오. 공공데이터 + 규칙 기반 판정이므로 다음 한계가 있습니다:
- 공공데이터의 타이밍 지연 (최신성 낮을 수 있음)
- 로컬 핫플레이스·개발 호재는 놓칠 수 있음
- 인간의 판단(임장, 중개사 정보)은 보완 필수

### Q5. 다른 지역도 분석할 수 있나?

**A**: 물론입니다. "서울시 강남구", "경기도 수원시" 등 원하는 지역을 지정하면 같은 파이프라인으로 분석합니다.

---

## 📞 지원

이 시스템 관련 문제나 개선사항이 있으면:

- CLAUDE.md 파일 확인 (저장소 가이드)
- 각 `.claude/agents/*.md` 파일의 역할 정의 검토
- Claude Code `/help` 명령으로 일반 질문 해결

---

**작품명**: 부동산 신호등 🚦  
**만든이**: Claude AI (4단계 멀티에이전트 파이프라인)  
**마지막 업데이트**: 2026년 7월 29일
