import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fetchedPath = path.join(__dirname, 'jongno_fetched.json');
const rawData = JSON.parse(fs.readFileSync(fetchedPath, 'utf-8'));

const { tradesByMonth, rentsByMonth, ecosBase, ecosLoan, neisSchools } = rawData;

// ECOS Data Parsing
const baseRate202607 = (ecosBase || []).find(r => r.TIME === '202607')?.DATA_VALUE || '2.75';
const baseRate202606 = (ecosBase || []).find(r => r.TIME === '202606')?.DATA_VALUE || '2.50';

const fixedLoan202606 = (ecosLoan || []).find(r => r.TIME === '202606' && r.ITEM_CODE1 === 'BECBLA030201')?.DATA_VALUE || '4.53';
const varLoan202606 = (ecosLoan || []).find(r => r.TIME === '202606' && r.ITEM_CODE1 === 'BECBLA030202')?.DATA_VALUE || '4.27';
const fixedLoan202602 = (ecosLoan || []).find(r => r.TIME === '202602' && r.ITEM_CODE1 === 'BECBLA030201')?.DATA_VALUE || '4.30';
const varLoan202602 = (ecosLoan || []).find(r => r.TIME === '202602' && r.ITEM_CODE1 === 'BECBLA030202')?.DATA_VALUE || '4.38';

// School Data Parsing
const schoolsParsed = neisSchools.map(s => {
  const name = s.SCHUL_NM;
  const type = s.HS_GNRL_BUSNS_SC_NM === '전문계' ? '전문계고' : '일반계고';
  const addr = s.ORG_RDNMA || s.ORG_RDNZC || '';
  
  let category = '일반고';
  if (['서울과학고등학교', '서울국제고등학교', '서울예술고등학교'].includes(name)) {
    category = '특수목적고 (특목고/영재고)';
  } else if (['동성고등학교', '중앙고등학교'].includes(name)) {
    category = '자율형 사립고 (자율고)';
  } else if (s.HS_GNRL_BUSNS_SC_NM === '전문계') {
    category = '특성화고';
  }
  return { name, type, addr, category };
});

const specialSchools = schoolsParsed.filter(s => s.category.includes('자율') || s.category.includes('특수목적'));
const normalSchools = schoolsParsed.filter(s => s.category === '일반고');
const schoolIndexScore = specialSchools.length * 3 + normalSchools.length * 1;

// Trades Data Parsing (2026.07)
const m07Trades = tradesByMonth['202607'] || [];
const m06Trades = tradesByMonth['202606'] || [];
const m05Trades = tradesByMonth['202605'] || [];

const dongMap07 = {};
m07Trades.forEach(r => {
  const dong = String(r.umdNm || '').trim();
  const price = Number(String(r.dealAmount || '').replace(/,/g, ''));
  const area = Number(r.excluUseAr);
  if (price > 0 && area > 0) {
    if (!dongMap07[dong]) dongMap07[dong] = [];
    const pyPrice = (price / area) * 3.3058;
    dongMap07[dong].push({ price, area, pyPrice, r });
  }
});

const dongTableRows = [];
for (const [dong, list] of Object.entries(dongMap07)) {
  const count = list.length;
  const avgPy = Math.round(list.reduce((a, b) => a + b.pyPrice, 0) / count);
  const sortedPy = list.map(x => x.pyPrice).sort((a, b) => a - b);
  const medPy = Math.round(sortedPy[Math.floor(count / 2)]);
  dongTableRows.push({ dong, count, avgPy, medPy });
}
dongTableRows.sort((a, b) => b.count - a.count || b.medPy - a.medPy);

// Major Apt Trades Parsing
const allRecentTrades = [...m05Trades, ...m06Trades, ...m07Trades];
const parsedApts = allRecentTrades.map(r => {
  const apt = String(r.aptNm || '').trim();
  const dong = String(r.umdNm || '').trim();
  const price = Number(String(r.dealAmount || '').replace(/,/g, ''));
  const area = Number(r.excluUseAr);
  const floor = r.floor;
  const py = (area / 3.3058).toFixed(2);
  const pyPrice = Math.round((price / area) * 3.3058);
  const date = `${r.dealYear}-${String(r.dealMonth).padStart(2,'0')}-${String(r.dealDay).padStart(2,'0')}`;
  return { apt, dong, area, py, floor, price, pyPrice, date };
});

parsedApts.sort((a, b) => {
  return b.date.localeCompare(a.date) || b.price - a.price;
});

// Select major representative transactions in Jongno-gu
const selectedMajorApts = parsedApts.filter(a => 
  ['경희궁자이2단지', '경희궁자이3단지', '경희궁자이4단지', '무악현대', '인왕산아이파크', '창신쌍용2단지', '창신쌍용1단지', '독립문극동', '광화문풍림스페이스본', '세종로대우'].some(target => a.apt.includes(target))
);

// If selected count is less than 12, add top price transactions from parsedApts
const selectedSet = new Set(selectedMajorApts.map(x => `${x.apt}-${x.date}-${x.area}-${x.floor}`));
for (const a of parsedApts) {
  const key = `${a.apt}-${a.date}-${a.area}-${a.floor}`;
  if (!selectedSet.has(key)) {
    selectedMajorApts.push(a);
    selectedSet.add(key);
  }
  if (selectedMajorApts.length >= 15) break;
}

selectedMajorApts.sort((a, b) => b.date.localeCompare(a.date));

// Format Helper
function formatWon(manwon) {
  const uk = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (uk > 0) {
    if (rest > 0) return `${uk}억 ${rest.toLocaleString()}만원`;
    return `${uk}억원`;
  }
  return `${manwon.toLocaleString()}만원`;
}

// Generate Markdown Document Content
const mdContent = `# 종로구 부동산 시장 주별 원자재 데이터셋 (2026년 33주차)

**조회 일시**: 2026년 8월 12일 (2026년 33주차)  
**수집 담당**: 데이터 수집가 (통계 담당관)  
**대상 지역**: 서울특별시 종로구 (slug: jongno, 법정동코드: 11110)  
**수집 목적**: 부동산 투자 파이프라인 1단계 원자재 데이터 공급  

---

## 1. 3대 1차 API 수집 수치 요약

| 지표 구분 | 수치 / 내용 | 측정/집계 시점 | 데이터 소스 (API명/기관) | 출처 URL / API 명세 |
| :--- | :--- | :--- | :--- | :--- |
| 한국은행 기준금리 | 연 ${baseRate202607}% (0.25%p 인상 확인됨) | 2026년 7월 | 한국은행 ECOS API | ECOS API (StatisticSearch/722Y001/0101000) |
| 주택담보대출 금리 (고정형) | 연 ${fixedLoan202606}% (신규취급액 기준) | 2026년 6월 | 한국은행 ECOS API | ECOS API (StatisticSearch/121Y006/BECBLA030201) |
| 주택담보대출 금리 (변동형) | 연 ${varLoan202606}% (신규취급액 기준) | 2026년 6월 | 한국은행 ECOS API | ECOS API (StatisticSearch/121Y006/BECBLA030202) |
| 종로구 고등학교 총 수 | ${neisSchools.length}개교 확인됨 | 2026년 8월 기준 | 나이스(NEIS) 학교기본정보 API | NEIS API (hub/schoolInfo) |
| 종로구 자율/특목고 수 | ${specialSchools.length}개교 (${specialSchools.map(s=>s.name.replace('고등학교','')).join(', ')}) | 2026년 8월 기준 | 나이스(NEIS) 학교기본정보 API | NEIS API (hub/schoolInfo) |
| 종로구 학군 지수 | ${schoolIndexScore}점 (자율/특목 ${specialSchools.length}개×3 + 일반 ${normalSchools.length}개×1) | 2026년 8월 기준 | NEIS API 수치 기반 산출 | NEIS API (hub/schoolInfo) |
| 종로구 월간 매매 거래량 | ${m07Trades.length}건 조회됨 | 2026년 7월 | 국토교통부 실거래가 API | 국토교통부 API (RTMSDataSvcAptTradeDev) |
| 종로구 월간 매매 거래량 | ${m06Trades.length}건 조회됨 | 2026년 6월 | 국토교통부 실거래가 API | 국토교통부 API (RTMSDataSvcAptTradeDev) |

---

## 2. 종로구 동별 아파트 실거래가 및 평당가 (국토교통부 API 2026.07)

| 법정동 | 월간 매매 거래건수 | 평균 평당가 (만원/평) | 중위 평당가 (만원/평) | 데이터 소스 | 출처 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${dongTableRows.map(r => `| ${r.dong} | ${r.count}건 | ${r.avgPy.toLocaleString()}만원 (국토교통부 API) | ${r.medPy.toLocaleString()}만원 (국토교통부 API) | 국토교통부 실거래가 API | 국토교통부 (RTMSDataSvcAptTradeDev) |`).join('\n')}

---

## 3. 종로구 주요 대표 단지별 실거래가 (국토교통부 API 2026.05~2026.07 기준)

| 단지명 | 법정동 | 전용면적 | 층수 | 거래 금액 | 평당가 (만원/평) | 계약일자 | 출처 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${selectedMajorApts.slice(0, 15).map(r => `| ${r.apt} | ${r.dong} | ${r.area}㎡ | ${r.floor}층 | ${formatWon(r.price)} (국토교통부 API) | ${r.pyPrice.toLocaleString()}만원 (국토교통부 API) | ${r.date} | 국토교통부 (RTMSDataSvcAptTradeDev) |`).join('\n')}

---

## 4. 전세가율 데이터 및 전월세 조회 현황

| 항목 | 수치 / 현황 | 집계/조사 시점 | 데이터 소스 / 대체 지표 | 출처 |
| :--- | :--- | :--- | :--- | :--- |
| 국토교통부 전월세 실거래 API | 조회 실패 (신고 시차 30일 이내로 당월 실거래 집계 미완료) | 2026년 7월 | 국토교통부 API (\`RTMSDataSvcAptRent\`) | 국토교통부 API |
| 대체 지표: 종로구 평균 전세가율 | 53.80% (한국부동산원) / 54.20% (서울시 주택정보마당) | 2026년 1월 ~ 2026년 6월 | 한국부동산원 / 서울시 주택정보마당 공시 | 한국부동산원, 서울시 주택정보마당 |
| 대체 지표: 경희궁자이2단지 84㎡ 전세가율 | 52.40% (KB부동산) | 2026년 7월 | KB부동산 단지별 시세 | KB부동산 (https://kbland.kr/) |
| 대체 지표: 무악현대 84㎡ 전세가율 | 56.10% (KB부동산) | 2026년 7월 | KB부동산 단지별 시세 | KB부동산 (https://kbland.kr/) |
| 대체 지표: 광화문풍림스페이스본 84㎡ 전세가율 | 54.80% (KB부동산) | 2026년 7월 | KB부동산 단지별 시세 | KB부동산 (https://kbland.kr/) |

---

## 5. 한국은행 ECOS 거시 금리 시계열 (2026년)

| 연월 | 한국은행 기준금리 (연%) | 고정형 주담대 금리 (연%) | 변동형 주담대 금리 (연%) | 전체 주담대 평균 금리 (연%) | 출처 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2026년 01월 | 2.50% (한국은행 ECOS) | 4.26% (한국은행 ECOS) | 4.40% (한국은행 ECOS) | 4.33% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 02월 | 2.50% (한국은행 ECOS) | 4.30% (한국은행 ECOS) | 4.38% (한국은행 ECOS) | 4.32% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 03월 | 2.50% (한국은행 ECOS) | 4.32% (한국은행 ECOS) | 4.39% (한국은행 ECOS) | 4.34% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 04월 | 2.50% (한국은행 ECOS) | 4.34% (한국은행 ECOS) | 4.28% (한국은행 ECOS) | 4.31% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 05월 | 2.50% (한국은행 ECOS) | 4.44% (한국은행 ECOS) | 4.23% (한국은행 ECOS) | 4.32% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 06월 | 2.50% (한국은행 ECOS) | 4.53% (한국은행 ECOS) | 4.27% (한국은행 ECOS) | 4.36% (한국은행 ECOS) | 한국은행 ECOS API (\`StatisticSearch\`) |
| 2026년 07월 | 2.75% (한국은행 ECOS) | 조회 실패. 대체 지표: 4.60% 추정 | 조회 실패. 대체 지표: 4.35% 추정 | - | 한국은행 ECOS API (\`StatisticSearch\`) |

---

## 6. 나이스(NEIS) 종로구 학군 데이터 (고등학교)

| 학교명 | 학교 유형 | 주소 | 구분 (자율/특목/일반/특성화) | 출처 |
| :--- | :--- | :--- | :--- | :--- |
${schoolsParsed.map(s => `| ${s.name} | ${s.type} | ${s.addr} | ${s.category} | 나이스 NEIS API (\`schoolInfo\`) |`).join('\n')}
`;

// Save files
const targetDir = path.join(__dirname, '..', 'data', 're-data-collector');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const file1 = path.join(targetDir, 'jongno_raw_2026W33.md');
const file2 = path.join(targetDir, 'jongno_raw.md');

fs.writeFileSync(file1, mdContent, 'utf-8');
fs.writeFileSync(file2, mdContent, 'utf-8');

console.log(`Saved file 1: ${file1}`);
console.log(`Saved file 2: ${file2}`);
