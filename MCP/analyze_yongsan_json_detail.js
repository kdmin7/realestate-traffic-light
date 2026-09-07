import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawData = JSON.parse(fs.readFileSync(path.join(__dirname, 'yongsan_api_raw.json'), 'utf-8'));

// 2026.06 매매 동별 집계
const trades06 = rawData.trades['202606'] || [];
console.log(`\n=== 2026.06 매매 실거래가 동별 집계 (총 ${trades06.length}건) ===`);
const dongMap06 = {};
trades06.forEach(item => {
  const dong = (item.umdNm || item.법정동 || '').trim();
  const dealAmountStr = (item.dealAmount || item.거래금액 || '').replace(/,/g, '').trim();
  const dealAmount = parseInt(dealAmountStr, 10);
  const exclusArea = parseFloat(item.excluUseAr || item.전용면적 || 0);
  const py = exclusArea / 3.3058;
  const pyeongPrice = py > 0 ? (dealAmount / py) : 0;

  if (!dongMap06[dong]) dongMap06[dong] = { count: 0, prices: [] };
  dongMap06[dong].count += 1;
  dongMap06[dong].prices.push(pyeongPrice);
});

const dongStats06 = Object.keys(dongMap06).map(dong => {
  const prices = dongMap06[dong].prices.sort((a, b) => a - b);
  const sum = prices.reduce((acc, v) => acc + v, 0);
  const avg = Math.round(sum / prices.length);
  const mid = Math.round(prices[Math.floor(prices.length / 2)]);
  return { dong, count: dongMap06[dong].count, avg, mid };
});
dongStats06.sort((a, b) => b.count - a.count);
console.table(dongStats06);

// 전월세 2026.07 / 2026.06 건수 및 주요 사례
const rents07 = rawData.rents['202607'] || [];
const rents06 = rawData.rents['202606'] || [];
console.log(`\n=== 전월세 건수 ===\n2026.07: ${rents07.length}건, 2026.06: ${rents06.length}건`);

// 전세가율 계산 가능한 동일 단지/면적 건 추출
console.log('\n=== 주요 단지 전세 실거래 예시 (2026.07) ===');
rents07.forEach(item => {
  if ((item.monthlyRent || item.월세금액 || '0') === '0') { // 순수 전세
    const aptNm = item.aptNm || item.아파트;
    const depositStr = (item.deposit || item.보증금액 || '').replace(/,/g, '').trim();
    const deposit = parseInt(depositStr, 10);
    const exclusArea = parseFloat(item.excluUseAr || item.전용면적 || 0);
    const targets = ['한남더힐', '한가람', '래미안용산', '한강맨션', '신동아', '센트럴파크', '푸르지오써밋', '강촌', '대림', '이촌코오롱'];
    if (targets.some(t => aptNm.includes(t))) {
      console.log(`${aptNm} | ${item.umdNm || item.법정동} | ${exclusArea}㎡ | ${item.floor || item.층}층 | 전세 ${deposit}만원 | 2026.07`);
    }
  }
});
