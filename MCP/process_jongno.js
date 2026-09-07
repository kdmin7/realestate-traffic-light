import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fetchedPath = path.join(__dirname, 'jongno_fetched.json');
const rawData = JSON.parse(fs.readFileSync(fetchedPath, 'utf-8'));

const { tradesByMonth, rentsByMonth, ecosBase, ecosLoan, neisSchools } = rawData;

console.log('========================================');
console.log('1. 거래량 현황');
for (const ym of Object.keys(tradesByMonth)) {
  console.log(`${ym}: 매매 ${tradesByMonth[ym].length}건, 전월세 ${rentsByMonth[ym].length}건`);
}

console.log('\n========================================');
console.log('2. 2026년 7월 매매 거래 상세 (종로구 동별 집계)');

const m07Trades = tradesByMonth['202607'] || [];
const m06Trades = tradesByMonth['202606'] || [];
const m05Trades = tradesByMonth['202605'] || [];

const dongStats07 = {};
for (const r of m07Trades) {
  const dong = String(r.umdNm || '').trim();
  const price = Number(String(r.dealAmount || '').replace(/,/g, ''));
  const area = Number(r.excluUseAr);
  if (!dongStats07[dong]) dongStats07[dong] = [];
  if (price > 0 && area > 0) {
    const pyPrice = (price / area) * 3.3058; // 만원/평
    dongStats07[dong].push({ price, area, pyPrice, r });
  }
}

console.log('2026.07 동별 매매 집계:');
for (const [dong, list] of Object.entries(dongStats07)) {
  const count = list.length;
  const avgPy = Math.round(list.reduce((a, b) => a + b.pyPrice, 0) / count);
  const sortedPy = list.map(x => x.pyPrice).sort((a, b) => a - b);
  const medPy = Math.round(sortedPy[Math.floor(count / 2)]);
  console.log(`- ${dong}: ${count}건, 평균 평당가 ${avgPy.toLocaleString()}만원, 중위 평당가 ${medPy.toLocaleString()}만원`);
}

// 2026.06 동별 집계도 필요 시 확인
const dongStats06 = {};
for (const r of m06Trades) {
  const dong = String(r.umdNm || '').trim();
  const price = Number(String(r.dealAmount || '').replace(/,/g, ''));
  const area = Number(r.excluUseAr);
  if (!dongStats06[dong]) dongStats06[dong] = [];
  if (price > 0 && area > 0) {
    const pyPrice = (price / area) * 3.3058;
    dongStats06[dong].push({ price, area, pyPrice, r });
  }
}

console.log('\n========================================');
console.log('3. 주요 단지 실거래 내역 (2026.05 ~ 2026.07 전체)');

const allTrades = [...m05Trades, ...m06Trades, ...m07Trades];
allTrades.sort((a, b) => {
  const dateA = `${a.dealYear}-${String(a.dealMonth).padStart(2,'0')}-${String(a.dealDay).padStart(2,'0')}`;
  const dateB = `${b.dealYear}-${String(b.dealMonth).padStart(2,'0')}-${String(b.dealDay).padStart(2,'0')}`;
  return dateB.localeCompare(dateA);
});

console.log(`최근 3개월 총 매매 건수: ${allTrades.length}건`);
const aptList = [];
for (const r of allTrades) {
  const apt = String(r.aptNm || '').trim();
  const dong = String(r.umdNm || '').trim();
  const price = Number(String(r.dealAmount || '').replace(/,/g, ''));
  const area = Number(r.excluUseAr);
  const floor = r.floor;
  const py = (area / 3.3058).toFixed(1);
  const pyPrice = Math.round((price / area) * 3.3058);
  const date = `${r.dealYear}-${String(r.dealMonth).padStart(2,'0')}-${String(r.dealDay).padStart(2,'0')}`;
  aptList.push({ apt, dong, area, py, floor, price, pyPrice, date });
}

console.log('상위 20개 거래 목록:');
aptList.slice(0, 25).forEach(item => {
  console.log(`- [${item.date}] ${item.apt} (${item.dong}) ${item.area}㎡(${item.py}평) ${item.floor}층 | ${item.price.toLocaleString()}만원 (평당 ${item.pyPrice.toLocaleString()}만원)`);
});

console.log('\n========================================');
console.log('4. ECOS 금리 데이터');
console.log('기준금리:');
console.log(ecosBase);
console.log('주담대 금리:');
console.log(ecosLoan);

console.log('\n========================================');
console.log('5. NEIS 고교 목록');
console.log(`종로구 총 고등학교 수: ${neisSchools.length}개`);
neisSchools.forEach(s => {
  console.log(`- ${s.SCHUL_NM} | ${s.ORG_RDNMA} | HS_GNRL_BUSNS_SC_NM: ${s.HS_GNRL_BUSNS_SC_NM || '-'} | HS_PURPS_SMS_NM: ${s.HS_PURPS_SMS_NM || '-'}`);
});

