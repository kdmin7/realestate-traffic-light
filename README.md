# 🚦 부동산 신호등 (Real Estate Traffic Light)

수도권(서울 25개 구 + 경기 31개 시·군 = 56개 전 지역)의 부동산 실거래가, 한국은행 거시경제, 나이스(NEIS) 학군, 경찰청 범죄·치안 통계를 실시간 수집·분석하여 **투자 신호등(매수고려·주의·관망)**과 **인터랙티브 시각화 대시보드**를 제공하는 멀티 에이전트 & MCP 시스템입니다.

---

## 💡 게시판(대시보드) 소개

**부동산 신호등**은 파편화된 공공데이터(국토교통부 실거래가, 한국은행 ECOS 금리, 교육부 나이스 학군 정보, 경찰청 13개년 범죄통계)를 단 하나의 직관적인 사용자 인터페이스로 통합한 **수도권 부동산 종합 진단 대시보드**입니다.

사용자는 복잡한 공공데이터 포털을 일일이 찾아다니지 않고도, 메인 대시보드([`index.html`](index.html))에서 수도권 56개 전 지역의 **가격 흐름, 금리 부담, 치안 안전도, 학군 선호도**를 한눈에 비교 분석할 수 있습니다.

---

## 🌟 주요 장점 및 실무 유용성

### 1. 4대 공공 빅데이터의 객관적 융합 (감정이 배제된 팩트 분석)
- **국토교통부 실거래가**: 매매·전월세 전수 데이터 및 국민평형(84㎡) 실거래가 실시간 추적
- **한국은행 ECOS**: 기준금리(3.0%) 및 시중은행 주담대 평균금리(4.39%) 금융 지표 연동
- **교육부 나이스(NEIS)**: 특목고·자율고 배출률, 명문 초·중·고 학군 및 학원가 클러스터 분석
- **경찰청 공공데이터**: 2012~2024년 13개년 5대 강력범죄 통계 및 인구 1천명당 치안 위험도 지수 산출

### 2. 직관적인 3단계 신호등 판정 엔진
- **🟢 매수고려 (BUY)**: 높은 전세가율(50% 이상) + 트렌드 모멘텀 상승 + 리스크 지수 안정 구간
- **🟡 주의 (WARNING)**: 단기 급등 피로도, 고금리 이자 부담 또는 전세가율 50% 미만으로 갭 부담이 높은 구간
- **🔴 관망 (WATCH)**: 거래량 침체, 전세가율 저조 및 관망 필요 구간

### 3. 심층 분석 대시보드 연계 (원클릭 드릴다운)
- 메인 카드 클릭 시 해당 지역 전용 [심층 분석 리포트](data/district_analysis_dashboard.html)로 즉시 전환
- **모듈 ①**: 5대 랜드마크 단지 시세·전세가율 매트릭스
- **모듈 ②**: NEIS 교육 빅데이터 기반 명문 학군·학원가 인프라 지수
- **모듈 ③**: LTV 40% 대출 시뮬레이션 및 월 순현금흐름(이자 vs 임대수익) 정밀 계산
- **모듈 ④**: 멀티 에이전트 종합 진단 총평 및 실수요자·투자자 맞춤형 행동 지침

### 4. 무설치 로컬 구동 & 100% 오프라인 완결성
- 별도의 웹서버 없이 로컬 파일(`file:///...`)로 브라우저에서 바로 열어도 데이터가 절대 끊기지 않는 **임베디드 사전 컴파일 데이터셋** 내장
- 네트워크 에러나 CORS 정책 차단 환경에서도 0.01초 만에 즉각 로딩

### 5. 대화면 고가독성 UI & 완벽한 모바일 반응형
- **PC 모니터 환경**: 15~25% 확대된 대형 폰트, 선명한 고대비 네온 컬러, 넓은 400px 차트 캔버스 적용으로 멀리서도 한눈에 판독 가능
- **모바일/태블릿 환경**: 터치 스크롤 칩 네비게이션, 1열 전폭 카드 자동 스택, 44px 이상 터치 타깃으로 작은 스마트폰에서도 글씨 겹침이나 화면 깨짐 제로 보장

---

## 🛠️ 최근 업데이트 내역 (2026-09-18)

오늘 진행된 주요 개선 및 결함 해결 작업 내역입니다.

### 1. 성남시(분당/판교) 심층 리포트 모듈 ② (NEIS 학군) 연동 복구 및 Blank 결함 완전 해결
- **문제 진단**: `index.html`에서 "성남시 (분당/판교)" 심층 분석 리포트 진입 시 모듈 ②(명문 학군 & 학원가 인프라 지수)가 Blank(빈칸)으로 출력되거나 기본 폴백값으로 떨어지는 현상 확인.
- **원인**: 로컬 파일(`file://`) 프로토콜 실행 시 브라우저 보안 정책에 의해 `fetch('regions_detail.json')`가 차단되어 데이터 연동이 실패함.
- **조치 사항**:
  - `data/district_analysis_dashboard.html`에 31개 자치구 정밀 빅데이터를 `EMBEDDED_REGIONS_DETAIL` 상수로 내장 컴파일하여 로컬/오프라인 환경에서도 100% 즉시 렌더링되도록 개선.
  - `findRegionTarget` 지능형 매칭 엔진을 도입하여 `성남시 (분당/판교)`, `성남`, `분당`, `판교` 등 다양한 키워드를 완벽히 인식하도록 처리.
  - NEIS 대표 학교 목록을 시각적인 뱃지 칩(`school-tag`) UI로 고도화 (낙생고, 서현고, 분당대진고, 내정중, 수내중 등).

### 2. 경찰청 범죄통계 대시보드 (`crime_dashboard.html`) 정상화 및 최신화
- `crime_dashboard.html`의 2012~2024년 13개년 범죄 발생 통계 및 지자체별 순위 데이터 렌더링 점검 및 동기화 완료.
- 5대 강력범죄 구성비 및 시계열 추이 그래프 표시 안정화.

### 3. 메인 대시보드 (`index.html`) 대화면 고가독성 & 모바일 반응형 전면 개편
- **폰트 크기 및 시인성 대폭 상향**:
  - 메인 타이틀 (`1.85rem` ➔ `2.1rem`, 굵기 900)
  - 지역 카드 타이틀 (`1.35rem` ➔ `1.45rem`, 가독성 극대화)
  - 핵심 전용 84㎡ 실거래가 (`1.22rem` ➔ `1.35rem`, 스카이블루 고대비 강조)
  - 매크로 지표 수치 (`1.8rem` ➔ `2.1rem`)
  - 카드 테이블 상세 지표 (`0.9rem ~ 1.0rem` ➔ `0.98rem ~ 1.1rem`)
- **Chart.js 비교 그래프 가독성 강화**:
  - 차트 높이 `400px`로 확대, 축 라벨 폰트(`13px`, 굵기 600) 및 막대 테두리 선명도 증대.
  - 범례 및 툴팁 폰트 확대(`14px`)로 호버 시 가격 비교 용이.
- **모바일/태블릿 반응형 무결점 점검**:
  - 상단 메뉴 가로 터치 스크롤(`nowrap`) 처리로 스마트폰에서 메뉴 줄바꿈 깨짐 방지.
  - 모바일(≤768px)에서 지역 카드를 1열 전폭(`1fr`)으로 자동 전환하여 텍스트 말림/잘림 원천 방지.
  - 모바일 최소 터치 타깃 `44px~48px` 확보.

---

## 🔄 Agent · MCP · 데이터 흐름 (Data Flow Architecture)

전체 시스템은 **공공데이터 원천 → 3개 MCP 서버 → 5개 전문 에이전트 체인 → 대시보드 & 산출물 계층**의 4단계 파이프라인으로 유기적으로 연결됩니다.

```mermaid
flowchart TD
    subgraph SOURCEDATA ["🌐 공공데이터 원천 (OpenAPI & Bulk Data)"]
        D1["국토교통부 실거래가<br/>(아파트/오피스텔/연립/단독/상업)"]
        D2["한국은행 ECOS<br/>(기준금리, 주택담보대출금리)"]
        D3["나이스 NEIS<br/>(전국 초·중·고 학군, 급식, 학사일정)"]
        D4["경찰청 odcloud.kr<br/>(2012~2024 범죄발생지역별 통계)"]
    end

    subgraph MCPLAYER ["⚙️ MCP 서버 계층 (총 39개 도구)"]
        M1["seoul-realty MCP (29 tools)<br/>realestate-server.js<br/>- 실거래가/전세가율/금리/대출/입지평가"]
        M2["schoolinfo MCP (6 tools)<br/>check_schools.js<br/>- 학교검색/학군분류/학사일정"]
        M3["crime-collector MCP (4 tools)<br/>crime-collector-server.js<br/>- 13개년 범죄수집/치안분석/시계열추이"]
    end

    subgraph AGENTCHAIN ["🤖 멀티 에이전트 파이프라인"]
        A1["01. re-market-data<br/>(공공데이터 원천 수집)"]
        A2["02. re-trend-risk-analyst<br/>(트렌드 모멘텀 & 리스크 스코어링)"]
        A3["03. re-investment-strategist<br/>(규칙 기반 신호등 판정: BUY/WARN/WATCH)"]
        A4["04. re-briefing-reporter<br/>(투자 브리핑 리포트 생성)"]
        A5["05. re-tax-strategist<br/>(취득세·보유세·양도세 세후 수익률 시뮬레이션)"]
    end

    subgraph OUTPUTLAYER ["📊 최종 산출물 및 대시보드"]
        OUT1["index.html<br/>56개 지역 신호등 메인 대시보드"]
        OUT2["crime_dashboard.html<br/>2012~2024 경찰청 범죄통계 대시보드"]
        OUT3["schoolinfo_dashboard.html<br/>나이스 학군 심층 분석 대시보드"]
        OUT4["data/re-*/*.md<br/>지역별 raw / scores / signal / briefing 리포트"]
    end

    D1 & D2 --> M1
    D3 --> M2
    D4 --> M3
    M3 -.->|범죄율 연동| M1

    M1 & M2 & M3 --> A1
    A1 -->|raw.md| A2
    A2 -->|scores.md| A3
    A3 -->|signal.md| A4
    A3 -.-> A5
    A4 -->|briefing.md| OUT4

    A3 & A4 -->|REGION_DATA 갱신| OUT1
    M3 -->|13개년 집계| OUT2
    M2 -->|학군 데이터| OUT3
```

### 단계별 데이터 전환 흐름

1. **수집 단계 (`re-market-data` + MCP 서버 3종)**:
   - `seoul-realty`: 국토부 API에서 실거래가(매매·전월세)를 수집하고 한국은행 ECOS에서 금리 데이터를 취합
   - `schoolinfo`: 나이스 API에서 자치구별 초·중·고 학군 및 특목고/자율고 비율 취합
   - `crime-collector`: 경찰청 OpenAPI에서 2012~2024년 13개 연도 범죄 데이터를 3개월(90일) 주기로 수집하여 `data/crime/{year}.csv` 및 `{year}.json`으로 보관
   - ➡️ 산출물: `data/re-data-collector/{slug}_raw.md`

2. **분석 단계 (`re-trend-risk-analyst`)**:
   - 거래량 및 실거래가 분기 CAGR로 **트렌드 모멘텀 점수** 산출
   - 전세가율, 인구 1천명당 범죄율(역수), 학군 선호도, 금리 부담을 결합한 **리스크 점수** 산출
   - ➡️ 산출물: `data/re-trend-risk-analyst/{slug}_scores.md`

3. **판정 단계 (`re-investment-strategist`)**:
   - 모멘텀과 리스크 지수를 교차 평가하여 **신호등(BUY 매수고려 / WARNING 주의 / WATCH 관망)** 부여
   - ➡️ 산출물: `data/re-timing-judge/{slug}_signal.md`

4. **브리핑 단계 (`re-briefing-reporter`)**:
   - 핵심 지표 요약, 상승/하락 요인, 단지별 최고가 현황을 담은 분석 리포트 발행
   - ➡️ 산출물: `data/re-briefing-reporter/{slug}_briefing.md` 및 `index.html`의 56개 지역 카드 데이터 갱신

---

## 📂 계층별 데이터 구조 (Data Structure)

### 1. 원천 데이터 구조 (Raw Datasets)

| 데이터군 | 저장 경로 / 엔드포인트 | 포맷 | 주요 필드 및 구조 |
|---|---|:---:|---|
| **아파트 실거래가** | `RTMSDataSvcAptTradeDev` (국토부) | XML/JSON | `dealAmount`(매매가), `excluUseAr`(전용면적), `dealYear/Month/Day`, `aptNm`, `floor` |
| **아파트 전월세** | `RTMSDataSvcAptRent` (국토부) | XML/JSON | `deposit`(보증금), `monthlyRent`(월세), `excluUseAr`, `dealYear/Month` |
| **한국은행 금리** | `ECOS` 통계 (한국은행) | JSON | `BASE_RATE`(기준금리), `MORTGAGE_RATE`(주담대 평균금리), 월별 시계열 |
| **경찰청 범죄통계** | `MCP/data/crime/{year}.csv` & `.json` | CSV/JSON | `범죄대분류`, `범죄중분류`, `서울 강남구`, `경기도 고양시` ... 전국 249개 지자체별 발생건수 |
| **범죄 동기화 메타** | `MCP/data/crime/manifest.json` | JSON | `updatedAt`, `syncIntervalDays: 90`, `nextSyncDueAt`, 연도별 건수/컬럼수 |
| **나이스 학군** | NEIS API 대방 포털 | JSON | `SCHUL_NM`, `HS_PURPS_SMS_NM`(특목/자율/일반), `ORG_RDNMA` |

### 2. 중간 에이전트 산출물 구조 (`data/re-*/`)

- **`{slug}_raw.md`**: 수집된 최근 거래 내역, 전세가율, 학군 목록, 5대 강력범죄 건수 원본
- **`{slug}_scores.md`**: 트렌드 지수 (1~100점), 리스크 지수 (1~100점), 지표별 가중치 breakdown
- **`{slug}_signal.md`**: 최종 신호 (`BUY` / `WARNING` / `WATCH`), 신호 산출 사유, 모니터링 체크리스트
- **`{slug}_briefing.md`**: 사람이 읽기 쉬운 종합 투자 요약문, 학군/치안 종합 평가, 세부 매물 추천

### 3. 최종 메인 대시보드 데이터 구조 (`index.html` 내 `REGION_DATA`)

```javascript
{
  name: "성남시 (분당/판교)",          // 지역명 (서울 25구 + 경기 31개 시·군)
  province: "gyeonggi",              // 광역 구분 (seoul | gyeonggi)
  zone: "경부축",                     // 세부 생활권역 (경부축, 동남권, 서북권 등)
  signal: "warning",                 // 신호등 판정 (buy | warning | watch)
  signalText: "🟡 주의",              // UI 표시 라벨
  trades: "420건 (7월: 280 / 8월: 140)", // 최근 실거래량
  avgPrice: 16.2,                    // 전체 평균 매매가 (억원)
  avg84: 17.8,                       // 국민평형(84㎡) 기준 평균 거래가 (억원)
  topApt: "산운마을7단지 (28.0억)",    // 신고 최고가 단지
  trend: "+1.6",                     // 트렌드 모멘텀 점수
  risk: "+1.0"                       // 복합 리스크 지수
}
```

---

## 🎯 어떻게 사용하면 좋을까? (실전 활용 가이드)

### 시나리오 1. 👨‍👩‍👧 실수요자 / 학부모 (안전 + 학군 중심 지역 선정)
1. **메인 화면 탐색**: [`index.html`](index.html)에서 `🌲 경기도` 또는 `🏛️ 서울특별시` 탭을 선택하고 신호등 상태가 `🟢 매수고려` 또는 `🟡 주의`인 후보 지역을 1차 선별합니다.
2. **치안 안전도 점검**: 상단 링크의 [`🛡️ 경찰청 범죄통계 대시보드`](crime_dashboard.html)를 열어 후보 지역의 **인구 1,000명당 5대 범죄율 랭킹**을 확인합니다.
3. **학군 우수성 비교**: [`🏫 나이스 학군 대시보드`](schoolinfo_dashboard.html)에서 자치구별 특목고·자율고 배정 현황과 명문고 분포를 비교하여 최종 이사 후보지를 확정합니다.

### 시나리오 2. 💼 갭투자자 / 자산가 (저평가·고수익 매물 발굴)
1. **전세가율 & 금리 모멘텀 확인**: [`index.html`](index.html) 상단 매크로 바에서 기준금리(3%) 및 주담대 평균금리 추이를 확인합니다.
2. **급매물 발굴**: `전용 84㎡ 기준 평균가`와 `트렌드 모멘텀`이 높으면서 리스크 지수가 낮은 자치구를 탐색합니다.
3. **지역별 심층 분석**: 카드를 클릭하여 [상세 분석 페이지](data/district_analysis_dashboard.html)로 이동, **모듈 ③(LTV 40% 대출 및 월 순현금흐름 시뮬레이션)**을 통해 월 이자 부담액과 전세/월세 기대수익 간의 실수익성을 검증합니다.

### 시나리오 3. 📊 공공데이터 리서처 / 부동산 분석가 (시계열 심층 연구)
1. **13개년 범죄 추이 분석**: [`crime_dashboard.html`](crime_dashboard.html)에서 2012년부터 2024년까지의 5대 범죄 추이를 시계열로 비교 분석하고, `💾 CSV 내보내기`로 엑셀 모델링을 진행합니다.
2. **MCP 도구 직접 호출**: Claude Code 또는 터미널 환경에서 `get_price_trend`, `get_jeonse_ratio`, `get_district_score` 도구를 직접 호출하여 논문 및 브리핑 보고서용 원자재 데이터를 즉시 추출합니다.

---

## ⚡ 일상 운영 워크플로우 (Daily & Quarterly)

```bash
# 1. [웹 대시보드 브라우징 (PowerShell 실행)]
Start-Process "index.html"
Start-Process "crime_dashboard.html"
Start-Process "schoolinfo_dashboard.html"
Start-Process "data\district_analysis_dashboard.html?region=성남시 (분당/판교)"

# 2. [매일 아침 1회] 실거래가 증분 수집 및 index.html 최신화
cd MCP
npm run daily:sync

# 3. [3개월 주기] 경찰청 범죄 데이터 자동 재수집 및 대시보드 동기화
npm run sync:crime:check  # 현재 주기(90일) 및 남은 일수 확인
npm run sync:crime        # 90일 만료 시 자동 재수집 + 대시보드 최신화

# 4. [전체 시스템 정합성 원클릭 검증]
cd ..
node scripts\verify_full_system.js
```

---

## 💻 MCP 설치와 실행

필요 조건은 Node.js 18 이상입니다. MCP 의존성은 `MCP/package.json`에 있으며 공식 SDK, `fast-xml-parser`, `nodemailer`, `zod`를 사용합니다.

```powershell
cd C:\practice\geminiCLI\realestate_prj\MCP
npm install
```

`MCP/.env.example`을 참고해 필요한 키를 환경변수로 설정합니다.

```text
MOLIT_API_KEY=...
ECOS_API_KEY=...
NEIS_API_KEY=...
SMTP_USER=...       # 선택
SMTP_PASS=...       # 선택
```

```powershell
# MCP 폴더에서
npm start                  # realestate-server.js (29개 도구)
npm run start:realty       # realestate-server.js
npm run start:school       # check_schools.js (6개 도구)
npm run start:crime        # crime-collector-server.js (4개 도구)
npm run fetch:crime        # 13개 연도 범죄통계 일괄 수집
npm run dashboard:crime    # crime_dashboard.html 재생성
npm run sync:crime         # 3개월 정기 동기화 검사
npm run daily:sync         # 일일 증분 파이프라인
```

루트 `.mcp.json` 등록 현황:

```json
{
  "mcpServers": {
    "seoul-realty": { "command": "node", "args": ["MCP/realestate-server.js"] },
    "schoolinfo": { "command": "node", "args": ["MCP/check_schools.js"] },
    "crime-collector": { "command": "node", "args": ["MCP/crime-collector-server.js"] }
  }
}
```

---

## 🔍 대시보드 파일 맵

- [`index.html`](index.html): **부동산 신호등 메인 대시보드** (수도권 56개 전 지역 종합 현황 및 비교 차트)
- [`crime_dashboard.html`](crime_dashboard.html): **경찰청 범죄통계 대시보드** (2012~2024년 13개년 5대 강력범죄 추이 및 지자체 치안 순위)
- [`schoolinfo_dashboard.html`](schoolinfo_dashboard.html): **나이스 학군 대시보드** (자치구별 초·중·고 학군 및 명문 학교 인프라)
- [`data/district_analysis_dashboard.html`](data/district_analysis_dashboard.html): **지역 심층 분석 대시보드** (랜드마크, 학군·학원가, LTV 40% 현금흐름, 에이전트 진단)
- [`mcp_architecture_dashboard.html`](mcp_architecture_dashboard.html): MCP 아키텍처 및 도구 파이프라인 시각화 화면

---

## 🔒 보안 및 데이터 한계

- API 키와 비밀번호는 Git 커밋에 포함되지 않으며, `.env` 로컬 환경에만 보관됩니다.
- MCP 서버가 제공하는 계산값과 알고리즘 신호(매수고려·주의·관망)는 **참고자료**이며 법적 투자 권유가 아닙니다.
- 공공데이터 수집 시점과 시장 호가 간에는 시차가 발생할 수 있으므로, 최종 거래 시 현장 확인 및 전문가 상담을 권고합니다.
