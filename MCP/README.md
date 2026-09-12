# 수도권(서울·경기) 부동산 인사이트 MCP Server

서울 25개 자치구 및 경기도 31개 시·군/구를 기준 단위로, 아파트 실거래가·전세가율·금리·학군·범죄율·생활인구를
하나의 지표 체계로 조회하는 MCP 서버입니다. (`realestate-server.js`)

> ⚠️ **이 서버는 투자 조언을 하지 않습니다.** 공공데이터 지표를 조회·집계할 뿐이며,
> 가중치와 최종 판단은 사용자 몫입니다. 과거 트렌드는 구조 파악용이지 미래 수익 보장이 아닙니다.
> 설계 배경은 [설계도](design.html) 참고.

---

## 제공 도구 (20+개)

### 1. 거시·지역 분석 및 종합 지표 도구
| 도구 | 설명 | 데이터 소스 | 방식 |
|------|------|------------|:---:|
| `get_price_trend` | 자치구/시·구 아파트 매매가 분기 트렌드(평균·중위·평당가·거래량 + CAGR·변동성) | 국토부 실거래가 | REST |
| `get_jeonse_ratio` | 전세가율(전세 ₩/㎡ ÷ 매매 ₩/㎡) + 월세 비중 | 국토부 매매+전월세 | REST |
| `get_macro_context` | 기준금리·주택담보대출 금리 월별 시계열 | 한국은행 ECOS | REST |
| `get_school_index` | 자치구/시·구 학군 지수(자율·특목고 밀도 - 서울/경기 지원) | NEIS 학교기본정보 | REST |
| `get_crime_rate` | 자치구/시·구 5대 범죄율(인구 1천명당) | 경찰청 범죄 지역별 통계 | 파일(CSV) |
| `get_living_population` | 자치구/시·구 생활인구(유동인구) 월별 추이·증감 | 서울/수도권 생활인구 | 파일(CSV) |
| `get_region_income` | 자치구/시·구 평균 소득·연도별 추이 | KOSIS/국세청 시군구 소득 | 파일(CSV) |
| `get_district_score` | **종합 스코어** — 위 지표를 0~100 정규화·가중합한 지역 순위 | (위 도구 종합) | 오케스트레이터 |

### 2. 부동산 유형별 실거래가 & 청약 & 재무 계산 도구 ([tae0y/real-estate-mcp](https://github.com/tae0y/real-estate-mcp) 연동)
| 도구 | 설명 | 데이터 소스 / 유형 |
|------|------|:---:|
| `get_region_code` | 지역명(구/시/군) → 국토부 5자리 법정동코드(LAWD_CD) 조회 | 내장 매핑 엔진 |
| `get_apartment_trades` | 아파트 매매 실거래 내역 + 중위가/평균/범위 요약 통계 | 국토부 아파트 매매 API |
| `get_apartment_rent` | 아파트 전월세 실거래 내역 + 보증금/월세 요약 통계 | 국토부 아파트 전월세 API |
| `get_officetel_trades` | 오피스텔 매매 실거래 내역 + 요약 통계 | 국토부 오피스텔 매매 API |
| `get_officetel_rent` | 오피스텔 전월세 실거래 내역 + 요약 통계 | 국토부 오피스텔 전월세 API |
| `get_villa_trades` | 연립다세대(빌라) 매매 실거래 내역 + 요약 통계 | 국토부 연립다세대 매매 API |
| `get_villa_rent` | 연립다세대(빌라) 전월세 실거래 내역 + 요약 통계 | 국토부 연립다세대 전월세 API |
| `get_single_house_trades` | 단독·다가구 매매 실거래 내역 + 요약 통계 | 국토부 단독다가구 매매 API |
| `get_single_house_rent` | 단독·다가구 전월세 실거래 내역 + 요약 통계 | 국토부 단독다가구 전월세 API |
| `get_commercial_trade` | 상업·업무용(상가/빌딩) 매매 실거래 내역 + 요약 통계 | 국토부 상업업무용 매매 API |
| `get_apt_subscription_info` | 청약홈 아파트 분양 공고 및 청약/당첨자 발표 일정 | 한국부동산원 청약홈 API |
| `calculate_loan_payment` | 주택담보대출 원리금 균등상환(EMI) 및 총이자 계산 | 금융 계산 엔진 |
| `calculate_monthly_cashflow` | 월 소득, 대출원리금, 생활비 반영 월 잉여 현금흐름 및 DSR 분석 | 재무 건전성 엔진 |
| `calculate_compound_growth` | 초기자본 + 월 적립액 기반 복리 자산 성장 시뮬레이터 | 자산 형성 시뮬레이터 |

### 3. 위치 분석 & 가치 평가 & 맞춤 추천 도구 ([gum798/A2A-MCP-RealEstate](https://github.com/gum798/A2A-MCP-RealEstate) 연동)
| 도구 | 설명 | 데이터 소스 / 유형 |
|------|------|:---:|
| `find_nearest_subway_stations` | 주소/좌표 기준 최근접 지하철역 Top N, 직선거리(km/m), 노선 분석 | 역세권 입지 분석 엔진 |
| `calculate_location_score` | 역세권 거리, 편의시설 개수, 녹지 거리를 종합한 위치 점수(0~100) 및 등급 | 입지 평가 엔진 |
| `evaluate_investment_value` | 가격 적정성, 감가/연식, 층수 프리미엄, 역세권 기반 투자가치 점수 및 등급 | 투자 가치 평가 |
| `evaluate_life_quality` | 통근 편의, 인프라, 녹지 환경, 단지 컨디션 기반 삶의 질 지수 및 등급 | 거주 만족도 평가 |
| `recommend_property` | 사용자 성향(투자형/실거주형/균형형) 맞춤 추천 점수 및 종합 행동 신호 | A2A 맞춤형 추천 엔진 |

REST 도구는 API 키만 있으면 되고, 파일 도구는 CSV를 내려받아 `data/` 폴더에 두어야 합니다.
`get_district_score`는 **가용한 지표만 자동으로 골라** 종합 점수를 내며(키·CSV가 일부만 있어도 동작), 커버리지를 함께 표기합니다.

---

## 설치

```bash
npm install
```

의존성: `@modelcontextprotocol/sdk`, `fast-xml-parser`, `zod` · Node 18+

---

## 환경변수 (API 키)

| 변수 | 발급처 | 필요한 도구 |
|------|--------|------------|
| `MOLIT_API_KEY` | [공공데이터포털](https://www.data.go.kr/data/15126469/openapi.do) (매매) + [전월세](https://www.data.go.kr/data/15126474/openapi.do) 각각 **활용신청** | 매매·전세가율·유형별 실거래 |
| `ECOS_API_KEY` | [한국은행 ECOS](https://ecos.bok.or.kr/api/) | 금리 |
| `NEIS_API_KEY` | [나이스 교육정보 개방 포털](https://open.neis.go.kr/) | 학군 |

> 공공데이터포털은 **API마다 별도 활용신청**이 필요합니다. **Decoding 키**를 사용하세요.
> 범죄·생활인구·소득 도구는 키가 필요 없고, 대신 CSV 파일이 필요합니다(아래).

---

## 파일 데이터 준비 (범죄·생활인구·소득)

이 데이터들은 REST가 아니라 **벌크 CSV**라 직접 내려받아 둡니다:

```
data/
├─ crime/         ← 경찰청_범죄 발생 지역별 통계 (연도별 CSV, 예: 2024.csv)
├─ living_pop/    ← 자치구 단위 서울 생활인구 (LOCAL_PEOPLE_GU_YYYY.csv)
└─ income/        ← 시군구 소득 통계 (KOSIS/국세청 CSV)
```

- **범죄**: [경찰청_범죄 발생 지역별 통계](https://www.data.go.kr/data/3074462/fileData.do) → 연도별 CSV
- **생활인구**: [자치구 단위 서울 생활인구(내국인)](https://data.seoul.go.kr/dataList/OA-15439/S/1/datasetView.do) → zip 해제 후 CSV
- **소득**: KOSIS 'e-지방지표 1인당 개인소득' 또는 국세청 시군구 소득 통계 → CSV (연도가 컬럼인 wide, 소득/연도 컬럼인 long 모두 지원)

파일 도구는 **컬럼명을 자동 감지**하고 **인코딩(UTF-8/EUC-KR)도 자동 처리**하므로, 원본 CSV를 그대로 두면 됩니다.

---

## 실행 · 등록

```bash
# 직접 실행
npm start
# 또는
npm run start:realty

# Claude Code / Desktop 에 등록
claude mcp add seoul-realty \
  -e MOLIT_API_KEY=국토부_키 \
  -e ECOS_API_KEY=한국은행_키 \
  -e NEIS_API_KEY=나이스_키 \
  -- node <경로>/realestate-server.js
```

---

## 사용 예시 (자연어)

- "강남구 아파트 매매가를 2015년부터 분기별로 보여줘" → `get_price_trend`
- "송파구 전세가율 추이 알려줘" → `get_jeonse_ratio`
- "2015년 이후 기준금리랑 주담대 금리 추이" → `get_macro_context`
- "마포구 오피스텔 최근 실거래가 어때?" → `get_officetel_trades`
- "청약홈 이번 달 분양 공고 찾아줘" → `get_apt_subscription_info`
- "3억 대출 30년 4% 금리면 월 상환액 얼마야?" → `calculate_loan_payment`
- "2024년 자치구별 범죄율 순위" → `get_crime_rate`
- "노원구 생활인구 늘고 있어?" → `get_living_population`
- "학군 좋은 구 순위 보여줘" → `get_school_index`
- "자치구별 소득 순위" → `get_region_income`
- "학군·가격 위주로 종합 순위 내줘" → `get_district_score` (weights 조정)

---

## 동작·설계 메모

- **공간 단위 통일**: 실거래가·생활인구는 코드 앞자리로 자치구 매핑, 범죄는 자치구 컬럼 매칭.
- **시간 단위**: 매매·전세가율은 분기 리샘플, 금리는 월별, 범죄는 연별, 생활인구는 월평균.
- **캐시 & 증분 업데이트**: 국토부 월별 응답은 `.cache/`에 저장되며, 30일 신고기한이 경과한 과거 확정 데이터는 영구 보존되어 재호출 없이 기존 데이터를 100% 동일하게 사용합니다. 최근 진행월(당월/전월)만 마지막 업데이트 이후 추가된 최신 일정의 신규 거래를 증분 수집(Incremental Merge & Deduplication)하여 안전하게 갱신합니다.
- **RAW 데이터 증분 갱신**: `node MCP/update_raw_incremental.js [지역slug]` 스크립트로 기존 수집된 과거 원자재 데이터는 온전히 보존하면서 마지막 업데이트 이후의 최신 실거래가만 증분 반영할 수 있습니다.
- **resultCode**: 국토부 API는 `"000"` (정상)을 기준으로 검증합니다.

## 한계

- 전세가율은 **자치구 집계 수준**(단지·평형 매칭 아님) 참고 지표.
- 범죄율 인구는 **2024년 근사값** 내장 — 정밀 계산은 `populationOverride` 사용.
- 전월세는 **2021년 신고제 강화 이후** 신뢰도가 높습니다.
- ECOS 주담대 코드(`121Y006`)는 실제 키로 1회 확인 권장(항목명 필터로 견고 처리).

---

자세한 설계는 [설계도](design.html) 참고.
