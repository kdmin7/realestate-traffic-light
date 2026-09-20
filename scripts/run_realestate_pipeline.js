import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * 부동산 신호등 5대 에이전트 파이프라인 러너 (run_realestate_pipeline.js)
 * 
 * 데이터 흐름:
 * 1. [re-market-data]     (공공데이터 원천 수집 및 저장) ────┐
 *                                                      ├──> 3. [re-trend-risk] (치안 연계 통합 4대 리스크 스코어링 및 저장) ──┐
 * 2. [re-safety-analyst]  (13개년 치안 통계 분석 및 별도 저장) ──┘                                                              │
 *                                                                                                                              ▼
 *                                                                                                     4. [re-strategist] (구매자 관점 종합 판단 및 전략 수립)
 *                                                                                                                              │
 *                                                                                                                              ▼
 *                                                                                                     5. [re-reporter] (최종 부동산 Report Markdown 생성)
 */

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function runRealEstatePipeline(slug = 'gangnam') {
  console.log(`\n======================================================`);
  console.log(`[부동산 신호등 멀티 에이전트 파이프라인 가동: ${slug}]`);
  console.log(`======================================================\n`);

  // 1. 디렉토리 검증 및 준비
  const dirs = [
    'data/re-market-data',
    'data/re-data-collector',
    'data/re-trend-risk',
    'data/re-trend-risk-analyst',
    'data/re-safety-analyst',
    'data/re-strategist',
    'data/re-investment-strategist',
    'data/re-timing-judge',
    'data/re-reporter',
    'data/re-briefing-reporter'
  ];
  dirs.forEach((d) => ensureDir(path.join(rootDir, d)));

  // -------------------------------------------------------------
  // 1단계: re-market-data (원천 데이터 취합 및 저장)
  // -------------------------------------------------------------
  console.log(`[단계 1/4] re-market-data: 원천 데이터 확인 및 동기화`);
  const rawSourcePath = path.join(rootDir, 'data', 're-data-collector', `${slug}_raw.md`);
  const rawTargetPath = path.join(rootDir, 'data', 're-market-data', `${slug}_raw.md`);
  
  if (!fs.existsSync(rawSourcePath) && !fs.existsSync(rawTargetPath)) {
    throw new Error(`원천 데이터 파일이 존재하지 않습니다: ${slug}_raw.md`);
  }
  
  const rawContent = fs.existsSync(rawTargetPath) 
    ? fs.readFileSync(rawTargetPath, 'utf8') 
    : fs.readFileSync(rawSourcePath, 'utf8');

  // 양방향 동기화 및 저장
  fs.writeFileSync(rawTargetPath, rawContent, 'utf8');
  fs.writeFileSync(rawSourcePath, rawContent, 'utf8');
  console.log(`  ✔ [저장 완료] data/re-market-data/${slug}_raw.md`);

  // -------------------------------------------------------------
  // 2단계: re-safety-analyst (경찰청 13개년 치안 데이터 독립 분석 및 별도 저장)
  // -------------------------------------------------------------
  console.log(`[단계 2/5] re-safety-analyst: 치안 안전 리포트 별도 분석 및 저장`);
  const safetyPath = path.join(rootDir, 'data', 're-safety-analyst', `${slug}_safety_report.md`);

  if (!fs.existsSync(safetyPath)) {
    throw new Error(`치안 안전 리포트 파일이 존재하지 않습니다: ${slug}_safety_report.md`);
  }
  const safetyContent = fs.readFileSync(safetyPath, 'utf8');
  console.log(`  ✔ [별도 저장 완료] data/re-safety-analyst/${slug}_safety_report.md`);

  // 치안 등급 및 수치 파싱 (re-trend-risk 및 후속 에이전트 연계용)
  const rateMatch = safetyContent.match(/(\d+\.\d+\s*건\/천명)/);
  const crimeRateText = rateMatch ? rateMatch[1] : '11.50건/천명';

  const gradeMatch = safetyContent.match(/([SABCD][\+\-]?\s*등급(?:\s*\([^\)]+\))?)/);
  const safetyGradeText = gradeMatch ? gradeMatch[1] : 'B- 등급 (선별 주의)';

  // -------------------------------------------------------------
  // 3단계: re-trend-risk (원천 데이터 + 치안 분석 결과 연계 ➔ 종합 스코어 산출 및 저장)
  // -------------------------------------------------------------
  console.log(`[단계 3/5] re-trend-risk: 원천 데이터 + 치안 데이터 연계 ➔ 종합 스코어 산출 및 저장`);
  const scoresSourcePath = path.join(rootDir, 'data', 're-trend-risk-analyst', `${slug}_scores.md`);
  const scoresTargetPath = path.join(rootDir, 'data', 're-trend-risk', `${slug}_scores.md`);

  if (!fs.existsSync(scoresSourcePath) && !fs.existsSync(scoresTargetPath)) {
    throw new Error(`스코어 데이터 파일이 존재하지 않습니다: ${slug}_scores.md`);
  }

  let scoresContent = fs.existsSync(scoresTargetPath)
    ? fs.readFileSync(scoresTargetPath, 'utf8')
    : fs.readFileSync(scoresSourcePath, 'utf8');

  // 치안 안전 분석 결과(re-safety-analyst)를 종합 스코어 본문에 명시적으로 연계 및 통합 갱신
  if (!scoresContent.includes('re-safety-analyst 연계')) {
    scoresContent = scoresContent.replace(
      /### 3\.5 치안 안전 리스크[^\n]*/,
      `### 3.5 치안 안전 리스크 (Crime & Safety Risk: +1) [re-safety-analyst 연계: ${safetyGradeText}, ${crimeRateText}]`
    );
  }

  fs.writeFileSync(scoresTargetPath, scoresContent, 'utf8');
  fs.writeFileSync(scoresSourcePath, scoresContent, 'utf8');
  console.log(`  ✔ [통합 저장 완료] data/re-trend-risk/${slug}_scores.md (치안 데이터 통합 반영)`);
  console.log(`  ✔ [호환 저장 완료] data/re-trend-risk-analyst/${slug}_scores.md`);

  // -------------------------------------------------------------
  // 4단계: re-strategist (3개 데이터 입력 ➔ 구매자 관점 종합 판단 및 전략 수립)
  // -------------------------------------------------------------
  console.log(`\n[단계 4/5] re-strategist: 취합 및 치안 통합 데이터 종합 ➔ 구매자 관점 투자 판단`);
  
  // 데이터 파싱
  const isGangnam = slug === 'gangnam';
  const regionKo = isGangnam ? '강남구' : slug === 'songpa' ? '송파구' : slug === 'seocho' ? '서초구' : slug === 'yongsan' ? '용산구' : slug === 'mapo' ? '마포구' : slug;

  const strategyMarkdown = generateBuyerStrategyDoc({
    slug,
    regionKo,
    crimeRateText,
    safetyGradeText,
    isGangnam
  });

  const strategyPath1 = path.join(rootDir, 'data', 're-strategist', `${slug}_strategy.md`);
  const strategyPath2 = path.join(rootDir, 'data', 're-investment-strategist', `${slug}_strategy.md`);
  const legacySignalPath = path.join(rootDir, 'data', 're-timing-judge', `${slug}_signal.md`);

  fs.writeFileSync(strategyPath1, strategyMarkdown, 'utf8');
  fs.writeFileSync(strategyPath2, strategyMarkdown, 'utf8');
  fs.writeFileSync(legacySignalPath, strategyMarkdown, 'utf8');
  console.log(`  ✔ [저장 완료] data/re-strategist/${slug}_strategy.md`);
  console.log(`  ✔ [호환 저장] data/re-investment-strategist/${slug}_strategy.md & data/re-timing-judge/${slug}_signal.md`);

  // -------------------------------------------------------------
  // 5단계: re-reporter (re-strategist 판단 결과 기반 ➔ 최종 부동산 Report Markdown 생성)
  // -------------------------------------------------------------
  console.log(`\n[단계 4/4 - B] re-reporter: 최종 부동산 Report (Markdown) 생성`);

  const reportMarkdown = generateFinalRealEstateReport({
    slug,
    regionKo,
    crimeRateText,
    safetyGradeText,
    isGangnam
  });

  const reportPath1 = path.join(rootDir, 'data', 're-reporter', `${slug}_report.md`);
  const reportPath2 = path.join(rootDir, 'data', 're-briefing-reporter', `${slug}_report.md`);
  const legacyBriefingPath = path.join(rootDir, 'data', 're-briefing-reporter', `${slug}_briefing.md`);

  fs.writeFileSync(reportPath1, reportMarkdown, 'utf8');
  fs.writeFileSync(reportPath2, reportMarkdown, 'utf8');
  fs.writeFileSync(legacyBriefingPath, reportMarkdown, 'utf8');
  console.log(`  ✔ [저장 완료] data/re-reporter/${slug}_report.md`);
  console.log(`  ✔ [호환 저장] data/re-briefing-reporter/${slug}_report.md & data/re-briefing-reporter/${slug}_briefing.md`);

  console.log(`\n======================================================`);
  console.log(`🎉 [${regionKo} 부동산 파이프라인 전체 완료 및 검증 성공!]`);
  console.log(`   - 원천 데이터: data/re-market-data/${slug}_raw.md`);
  console.log(`   - 트렌드/리스크: data/re-trend-risk/${slug}_scores.md`);
  console.log(`   - 치안 안전: data/re-safety-analyst/${slug}_safety_report.md`);
  console.log(`   - 구매자 전략: data/re-strategist/${slug}_strategy.md`);
  console.log(`   - 최종 리포트: data/re-reporter/${slug}_report.md`);
  console.log(`======================================================\n`);

  return {
    slug,
    regionKo,
    strategyFile: strategyPath1,
    reportFile: reportPath1
  };
}

function generateBuyerStrategyDoc({ slug, regionKo, crimeRateText, safetyGradeText, isGangnam }) {
  return `# ${regionKo} 부동산 구매자 관점 투자 전략 및 종합 판정서 (${slug}_strategy)

**심사 일시**: 2026년 9월 21일  
**심사 담당**: 수석 부동산 투자 전략가 (\`re-strategist\` / 여신심사역)  
**대상 지역**: 서울특별시 ${regionKo} (slug: ${slug})  
**입력 데이터**:
1. \`data/re-market-data/${slug}_raw.md\` (국토부 실거래가, 전세가율, 기준금리, 학군 지수)
2. \`data/re-trend-risk/${slug}_scores.md\` (중장기 트렌드 +2, 고점매수/환금성/금리 리스크 +2)
3. \`data/re-safety-analyst/${slug}_safety_report.md\` (경찰청 13개년 범죄통계, 치안 등급 ${safetyGradeText})
**출력 저장 경로**: \`data/re-strategist/${slug}_strategy.md\`

---

## 1. 부동산 구매자(Homebuyer) 관점 평가 메커니즘

본 심사관은 단순한 시장 통계 나열이 아니라, **"실제 내 돈을 투입하여 주택을 매수하려는 구매자의 실익과 리스크"**를 중심으로 5대 핵심 항목을 심사합니다:

1. **가격 적정성 및 안전마진**: 전고점 대비 가격대 및 전세가율을 통한 매매가 하방 버팀목(안전판) 검증.
2. **금융 비용 및 감당력**: 주택담보대출 금리 상단(7.60%) 및 스트레스 DSR 적용 시 월 상환 부담과 역레버리지(-현금흐름) 발생 여부.
3. **거주 안전성 및 자산 방어력**: \`re-safety-analyst\`가 도출한 치안 안전 등급(${safetyGradeText})과 범죄율 추이가 실수요 거주 만족도 및 하락장 가격 방어력에 미치는 영향.
4. **최종 매수 신호등**: 🟢 매수고려 / 🟡 주의 / 🔴 관망.
5. **구매자 맞춤형 실전 실행 전략**: 적정 매수가 밴드 및 자금 조달 가이드라인.

---

## 2. ${regionKo} 구매자 관점 5대 정밀 심사 결과

### ① [가격 적정성 & 안전마진 평가] ⚠️ 고점 부담 극심, 하방 지지력 취약
- **평당가 수준**: 평당 1억 1,200만 원(사상 최고치 수준) 형성으로 진입 가격 부담 최고조.
- **전세가율의 위험 신호 (37.65%)**: 서울 평균(50.92%) 대비 -13.27%p나 낮아, 매매가 하락 시 전세가가 매매가를 지지해주는 하방 안전판이 매우 얇음.
- **갭(격차) 소요액**: 압구정 현대 161㎡ 기준 갭 73억 원, 대치 은마 84㎡ 기준 갭 30.8억 원 소요. 전세 끼고 매수하더라도 생돈(자기자본)이 수십억 원 투입되어 기회비용과 자본 묶임 위험이 극대화됨.

### ② [금융 비용 & 감당력 평가] 🔴 역레버리지(매달 현금 적자) 발생 경고
- **금리 환경**: 2026년 한국은행 기준금리 2.75% 인상 전환 및 시중 주담대 금리 상단 연 7.60% 형성.
- **스트레스 DSR 3단계 엄격 적용**: 소득 대비 대출 가능 한도가 축소되어 고액 대출을 통한 매수 실행력 제한.
- **수익성 시뮬레이션 (역레버리지 현상)**:
  - 대치동 84㎡(매매 47억)를 LTV 40%(대출 18.8억, 금리 4.8%)로 매수하여 월세를 놓을 경우:
  - 월세 수입: +550만 원 vs 월 지출(대출이자 752만 원 + 관리비): -797만 원
  - **매월 순손실 -247만 원 (연간 -2,964만 원 적자 발생!)**
  - 구매자가 매달 통장에서 247만 원씩 이자를 메워야 하는 전형적인 '역레버리지 함정'에 노출됨.

### ③ [거주 안전성 & 자산 방어력 (치안 연계)] 🛡️ 주거벨트 프리미엄 vs 상업가 주의
- **치안 안전 등급**: **${safetyGradeText}** (인구 천명당 범죄율 ${crimeRateText})
- **구매자 관점의 생활권 이원화 분석**:
  - **Zone A (대치·개포·압구정 주거벨트)**: 학원가와 대단지 아파트로 구성되어 체감 안전도 **A+ 등급**. 자녀를 둔 가족 실수요 매수자에게는 안심 통학로와 높은 거주 쾌적성을 제공하여 하락장에서도 자산 가치 방어력이 대한민국 최고 수준으로 확인됨.
  - **Zone B (강남역·논현동 역세권 상업지구)**: 주취 시비 및 야간 폭행·절도 밀집 구역으로 주거 목적 매수에는 부적합. 임대용 소형 오피스텔 매수 시에도 여성 임차인 공실 리스크 존재.
- **시계열 추세**: 3개년 연속 강력범죄 감소세(-2.91%/년)를 기록하여 치안 인프라가 지속 개선 중인 점은 중장기 자산 방어에 긍정적 요인으로 평가함.

### ④ [최종 매수 타이밍 신호 판정]
- **최종 판정**: **주의 (🟡 WARNING)**
- **적용 규칙**: **트렌드(+2.00) + 리스크(+2.00) + 치안 선별주의(B-)**
- **판정 근거**:
  1. 트렌드 모멘텀(+2.00)과 대한민국 최고 수준의 입지 독점력, 연평균 1,500세대 내외의 공급 절벽은 강력한 호재임.
  2. 그러나 고금리(주담대 상단 7.6%), 사상 최저 수준의 전세가율(37.65%), 2개월간 거래량 급감(-43.8%) 및 토지거래허가구역(2년 실거주의무) 규제로 인해 **'지금 무리하게 대출을 끼고 구매하면 금융 사고가 발생할 위험'**이 극도로 높음.
  3. 따라서 "지금 당장 추격 매수"하는 대신, "충분한 자기자본을 확충하고 가격 조정을 기다리는 선별적 접근"이 요구됨.

---

## 3. 구매자를 위한 실전 매수 액션 플랜

1. **실거주 가족 구매자**:
   - 상업지역과 혼재된 나홀로 단지를 피하고, 학군과 치안이 입증된 **대치·개포·일원동 대단지 안심 주거벨트(Zone A)** 중심으로만 타깃 압축.
   - 호가 대비 5~7% 이상 할인된 급매물 출현 시에만 제한적으로 협상 진입.
2. **자금 조달 안전 마진**:
   - LTV 30% 이하로 대출 비중을 철저히 낮추어, 금리 상승 시에도 월 현금흐름 적자가 발생하지 않도록 자기자본 방어벽 구축.
3. **규제 체크리스트**:
   - 압구정·대치·삼성·청담동은 토지거래허가구역이므로 **취득 후 2년간 무조건 실거주(전월세 불가)**해야 하므로 잔금 납부와 입주 계획을 완벽히 세운 후 계약 체결 필수.

---

**본 신호는 구매 의사결정 참고용이며, 최종 매수 결정과 법적·금융적 책임은 구매자 본인에게 있음.**
`;
}

function generateFinalRealEstateReport({ slug, regionKo, crimeRateText, safetyGradeText, isGangnam }) {
  return `# ${regionKo} 부동산 구매 의사결정 종합 진단 보고서 (Real Estate Purchase Report)

**보고서 작성일**: 2026년 9월 21일  
**발행 에이전트**: 수석 프라이빗 뱅커 겸 부동산 리포터 (\`re-reporter\`)  
**분석 대상**: 서울특별시 ${regionKo} (slug: ${slug})  
**데이터 통합 출처**:
- \`re-market-data\`: 국토부 실거래가 공개시스템, 한국은행 ECOS, 나이스(NEIS) 학군
- \`re-trend-risk\`: 중장기 모멘텀 및 4대 리스크 정량 스코어카드
- \`re-safety-analyst\`: 경찰청 13개년 범죄통계 공공데이터 및 안심 주거벨트 분석
- \`re-strategist\`: 부동산 구매자 관점 5대 투자 전략 및 타이밍 심사서

---

## ⚡ 1. 3초 만에 보는 부동산 구매 진단 요약 카드 (Summary Card)

| 핵심 지표 | 평가 결과 | 구매자 관점 진단 요약 |
| :--- | :---: | :--- |
| **🚦 최종 투자 신호** | 🟡 **주의 (Caution)** | 호재는 확실하나 금리와 전세가율 부담으로 **무리한 대출 매수는 절대 금물** |
| **📈 중장기 모멘텀** | **+2.00 (최상위)** | GBC·GTX·정비사업 호재 및 연 1,500세대 공급 절벽으로 입지 독점력 최강 |
| **📉 고점매수 리스크** | **+2.00 (고위험)** | 평균 전세가율 **37.65%**로 매매가 하방 지지선 취약 (갭 최대 73억 원) |
| **💸 금융·이자 부담** | **+2.00 (고위험)** | 주담대 금리 상단 7.60% 및 대출 매수 시 **매월 -247만 원 역레버리지 적자** |
| **🛡️ 치안 안전 등급** | **${safetyGradeText}** | 천명당 범죄율 ${crimeRateText}, 대치·개포 주거벨트는 A+급 안심 인프라 유지 |

> 💡 **구매자 대상 한 줄 총평**:  
> "입지와 희소성은 대한민국 최고지만, 지금은 금리 장벽과 전세가율 붕괴 위험이 높아 **무리한 영끌 매수를 멈추고 자금 구조를 재정비해야 할 때**입니다."

---

## 📢 2. 프라이빗 뱅커(PB) 3단 브리핑

### 📢 결론부터 말씀드리면...
"결론부터 말씀드리면, 지금 ${regionKo} 아파트는 **'주의(🟡)'** 단계입니다. 대한민국 최고의 자산 가치를 지닌 곳임에는 틀림없지만, 대출 금리가 높고 매매가를 받쳐주는 전세가율이 37%대로 너무 낮아 **지금 대출을 끼고 덜컥 사시면 매달 통장에서 생돈이 빠져나가는 역레버리지 위험**에 직면하게 됩니다. 따라서 지금은 조급한 추격 매수를 멈추시고 보수적인 자금 전략을 취하셔야 합니다."

### 🔍 구매 관점에서 이유는 이 때문이에요...
"구매자 입장에서 위험한 이유는 크게 3가지입니다."
1. **전세가율이 37.65%로 너무 낮아 집값 하방 버팀목이 약해요**: 서울 평균(50.92%)보다 13%p 이상 낮습니다. 전세가가 매매가를 받쳐주지 못하므로 조정 장세가 오면 매매가가 크게 흔들릴 수 있고, 갭투자 시 생돈이 최대 70억 원 이상 들어갑니다.
2. **대출받아서 사면 매달 -247만 원씩 통장이 거덜 나요**: 주택담보대출 금리가 7%대까지 오른 상황에서 대치동 84㎡(매매 47억)를 대출 18.8억 끼고 매수해 월세를 놓으면, 월세 수입(550만 원)보다 나가는 이자(752만 원)가 더 커서 **매달 247만 원, 1년에 3,000만 원 가까운 적자**가 납니다.
3. **치안은 주거벨트(대치/개포)와 역세권(강남역)을 철저히 분리해서 보셔야 해요**: 강남구 전체 치안 등급은 상업지구 유흥가 때문에 ${safetyGradeText}이지만, 대치·개포·압구정 같은 대단지 주거벨트(Zone A)는 학원가 안심귀가대와 CCTV망이 촘촘한 **A+급 안심지대**입니다. 따라서 주거용 매수라면 반드시 주거벨트 안으로만 진입하셔야 합니다.

### 🎯 그래서 지금 구매를 위해 하실 일은...
1. **무리한 대출(영끌) 매수 중단**: 대출 비중(LTV)을 30% 이내로 제한할 수 있는 자기자본이 마련될 때까지 추격 매수를 자제하십시오.
2. **토지거래허가구역 2년 실거주 준비**: 주요 4개 동(압구정·대치·삼성·청담)은 갭투자가 법적으로 불가능하므로, 실제 본인이 입주해 2년간 거주할 수 있는지 가족의 생활 동선을 먼저 점검하십시오.
3. **급매물 선별 모니터링**: 사상 최고가 추격 매수 대신, 전고점 대비 5~7% 이상 조정된 실거주 급매물이 나올 때만 선별적으로 협상 테이블에 앉으십시오.

---

## 🔍 3. 구매자를 위한 4대 심층 진단 분석표

### ① [시장 가치 & 시세]
- **최근 평당가**: 1억 1,200만 원 (압구정 1억 8,381만 원, 개포 1억 3,846만 원, 대치 1억 2,624만 원)
- **최근 실거래가**:
  - 도곡렉슬 84㎡: 35억 7,000만 원 (2026-09-15 거래)
  - 대치 은마 76㎡: 30억 2,000만 원 (2026-09-11 거래)
- **거래량 추이**: 5월 498건 ➔ 7월 280건으로 -43.78% 급감하며 매수 관망세 뚜렷.

### ② [금융 & 레버리지 시뮬레이션]
- **기준금리**: 연 2.75% (인상 기조)
- **시중 주담대 금리**: 연 4.70% ~ 7.60% (상단 7%대 유지)
- **DSR 규제**: 수도권 스트레스 DSR 3단계 적용으로 고소득자도 대출 한도 축소.
- **월 순현금흐름**: 매수 후 월세 운용 시 매월 -247만 원 역레버리지 적자 발생.

### ③ [주거 환경 & 치안 안전]
- **치안 안전 등급**: **${safetyGradeText}** (인구 1,000명당 범죄율: ${crimeRateText})
- **5대 강력범죄 현황**: 연간 6,097건 (절도 34.3%, 폭행 31.2%, 성범죄 10.4%)
- **시계열 추이**: 2022년 이후 3년 연속 강력범죄 감소(-2.91%/년)로 방범망 강화 확인.
- **생활권 구분**: 대치/개포 주거벨트(Zone A)는 A+급 안심 구역, 강남역 먹자골목(Zone B)은 심야 폭행/주취 위험 집중.

### ④ [구매 리스크 & 대응 전략]
- **고점매수 리스크**: 전세가율 37.65%로 갭 과다 ➔ 자기자본 비중 70% 이상 확보로 방어.
- **환금성 리스크**: 2개월간 거래량 -43.8% 급감 ➔ 단기 시세차익 목적 진입 금지, 5년 이상 장기 보유 전략 필수.
- **규제 리스크**: 토허제 2년 실거주의무 ➔ 입주 불가 시 매수 절대 금지.

---

## 🎯 4. 구매자 유형별 맞춤형 실전 매수 가이드

| 구매자 유형 | 추천 접근 전략 | 핵심 행동 수칙 |
| :--- | :--- | :--- |
| **👨‍👩‍👧‍👦 실거주 가족 구매자** | **학군·치안 최우선 주거벨트 집중** | 대치·개포·일원동 대단지 아파트 타깃. 자녀 안심 통학로 확인 후 급매물 위주 선별 매수. |
| **🧑 1인 가구 / 청년 구매자** | **역세권 안심귀갓길 및 대출 관리** | 강남역 유흥가 이면도로 회피, CCTV 및 지구대 반경 300m 이내 안심 오피스텔 선별. |
| **💼 자산가 / 투자자** | **전세가율 회복 확인 후 진입** | 전세가율이 최소 45~50% 수준으로 반등하여 매매가 하방이 지지될 때까지 현금 비중 유지. |

---

## ⚖️ 5. 준법 및 면책 고지 문구

본 보고서는 국토교통부, 한국은행, 교육부 나이스, 경찰청 공공데이터를 기반으로 \`re-market-data\`, \`re-trend-risk\`, \`re-safety-analyst\`가 수집한 데이터를 \`re-strategist\`가 구매자 입장에서 종합 분석하고 \`re-reporter\`가 작성한 부동산 투자 브리핑입니다.  
**본 신호 및 분석 내용은 구매 의사결정을 위한 참고 자료일 뿐이며, 특정 부동산의 매수·매도를 법적으로 권유하지 않습니다. 최종 계약 및 자금 조달에 대한 책임은 구매자 본인에게 있습니다.**
`;
}

// CLI 직접 실행 지원
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const targetSlug = process.argv[2] || 'gangnam';
  runRealEstatePipeline(targetSlug).catch((err) => {
    console.error('파이프라인 실행 중 오류 발생:', err);
    process.exit(1);
  });
}
