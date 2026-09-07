import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawData = JSON.parse(fs.readFileSync(path.join(__dirname, 'yongsan_api_raw.json'), 'utf-8'));

console.log('=== 1. 국토교통부 거래량 건수 ===');
console.log('2026.08 매매 건수:', rawData.trades['202608']?.length || 0);
console.log('2026.07 매매 건수:', rawData.trades['202607']?.length || 0);
console.log('2026.06 매매 건수:', rawData.trades['202606']?.length || 0);

console.log('2026.08 전월세 건수:', rawData.rents['202608']?.length || 0);
console.log('2026.07 전월세 건수:', rawData.rents['202607']?.length || 0);
console.log('2026.06 전월세 건수:', rawData.rents['202606']?.length || 0);

console.log('\n=== 2. ECOS 기준금리 ===');
console.log(rawData.ecosBase?.slice(-6));

console.log('\n=== 3. ECOS 주담대 금리 ===');
console.log(rawData.ecosLoan?.slice(-10));

console.log('\n=== 4. NEIS 학군 데이터 ===');
const yongsanSchools = rawData.neisData?.yongsanSchools || [];
console.log(`용산구 고교 총 수: ${yongsanSchools.length}`);
const specials = ['자율', '특수목적', '외국어', '과학', '국제', '영재', '예술', '체육'];
const specSchools = yongsanSchools.filter(r => {
  const blob = Object.values(r).join(' ');
  return specials.some(k => blob.includes(k)) && !blob.includes('특성화');
});
console.log(`용산구 자율/특목고 (${specSchools.length}개):`, specSchools.map(s => `${s.SCHUL_NM} (${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '기타'})`));
console.log('용산구 고등학교 전체:', yongsanSchools.map(s => `${s.SCHUL_NM} (${s.ORG_RDNMA || s.ORG_RDNZC}) - ${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || s.SCHUL_KND_SC_NM}`));

// 2026.07 동별 집계
const trades07 = rawData.trades['202607'] || [];
console.log(`\n=== 5. 2026.07 매매 실거래가 동별 집계 (총 ${trades07.length}건) ===`);

const dongMap = {};

trades07.forEach(item => {
  const dong = (item.umdNm || item.법정동 || '').trim();
  const dealAmountStr = (item.dealAmount || item.거래금액 || '').replace(/,/g, '').trim();
  const dealAmount = parseInt(dealAmountStr, 10);
  const exclusArea = parseFloat(item.excluUseAr || item.전용면적 || 0);
  const py = exclusArea / 3.3058;
  const pyeongPrice = py > 0 ? (dealAmount / py) : 0; // 만원/평

  if (!dongMap[dong]) {
    dongMap[dong] = { count: 0, prices: [], items: [] };
  }
  dongMap[dong].count += 1;
  dongMap[dong].prices.push(pyeongPrice);
  dongMap[dong].items.push(item);
});

const dongStats = Object.keys(dongMap).map(dong => {
  const prices = dongMap[dong].prices.sort((a, b) => a - b);
  const sum = prices.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / prices.length);
  const mid = Math.round(prices[Math.floor(prices.length / 2)]);
  return { dong, count: dongMap[dong].count, avg, mid };
});

dongStats.sort((a, b) => b.count - a.count);
console.table(dongStats);

console.log('\n=== 6. 주요 단지 실거래 샘플 (2026.07/08) ===');
const allTrades = [...(rawData.trades['202607'] || []), ...(rawData.trades['202608'] || [])];
allTrades.forEach(item => {
  const aptNm = item.aptNm || item.아파트;
  const dealAmountStr = (item.dealAmount || item.거래금액 || '').replace(/,/g, '').trim();
  const dealAmount = parseInt(dealAmountStr, 10);
  const exclusArea = parseFloat(item.excluUseAr || item.전용면적 || 0);
  const py = exclusArea / 3.3058;
  const pyeongPrice = Math.round(dealAmount / py);
  const month = item.dealYear ? `${item.dealYear}-${String(item.dealMonth).padStart(2, '0')}-${String(item.dealDay).padStart(2, '0')}` : `${item.년}-${String(item.월).padStart(2, '0')}-${String(item.일).padStart(2, '0')}`;
  
  // 주요 단지 필터
  const targets = ['한남더힐', '한가람', '래미안용산', '한강맨션', '신동아', '용산센트럴파크', '푸르지오써밋', '이촌동', '도원삼성', '산천동', '효창', '원효로'];
  if (targets.some(t => aptNm.includes(t)) || dealAmount >= 200000) {
    console.log(`${aptNm} | ${item.umdNm || item.법정동} | ${exclusArea}㎡ | ${item.floor || item.층}층 | ${dealAmount}만원 | 평당 ${pyeongPrice}만원 | ${month}`);
  }
});
