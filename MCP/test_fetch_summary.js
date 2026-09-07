import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  });
}

const MOLIT_KEY = env.MOLIT_API_KEY || process.env.MOLIT_API_KEY;
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

async function fetchMonth(ym) {
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11710&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  const res = await fetch(url);
  const text = await res.text();
  const parsed = parser.parse(text);
  const items = parsed?.response?.body?.items?.item || [];
  return Array.isArray(items) ? items : [items];
}

async function main() {
  const m07 = await fetchMonth('202607');
  const m06 = await fetchMonth('202606');
  const m05 = await fetchMonth('202605');

  const all = [...m05, ...m06, ...m07];

  // 주요 단지 검색
  const targetApts = ['잠실엘스', '리센츠', '트리지움', '헬리오시티', '파크리오', '올림픽선수기자촌', '문정시영', '주공아파트 5단지', '래미안송파파인탑'];
  
  const aptSummary = {};
  for (const apt of targetApts) {
    aptSummary[apt] = [];
  }

  for (const r of all) {
    const name = String(r.aptNm || '').trim();
    const match = targetApts.find(t => name.includes(t) || t.includes(name));
    if (match) {
      const priceStr = String(r.dealAmount || '').replace(/,/g, '').trim();
      const price = Number(priceStr);
      const area = Number(r.excluUseAr);
      const py = (area / 3.3058).toFixed(1);
      const pyPrice = Math.round((price / area) * 3.3058); // 만원/평
      aptSummary[match].push({
        apt: name,
        dong: r.umdNm,
        area,
        py,
        price,
        pyPrice,
        date: `${r.dealYear}-${String(r.dealMonth).padStart(2,'0')}-${String(r.dealDay).padStart(2,'0')}`,
        floor: r.floor
      });
    }
  }

  console.log('=== 송파구 주요 단지 최근 실거래 내역 (2026.05~07) ===');
  for (const [apt, list] of Object.entries(aptSummary)) {
    console.log(`\n[${apt}] - 총 ${list.length}건`);
    list.sort((a,b) => b.date.localeCompare(a.date));
    list.slice(0, 5).forEach(item => {
      console.log(`  - ${item.date} | ${item.dong} | 전용 ${item.area}㎡ (${item.py}평) | ${item.floor}층 | ${item.price}만원 (평당 ${item.pyPrice}만원)`);
    });
  }

  // 동별 평당가 평균 및 중위값
  const dongs = {};
  for (const r of m07) {
    const d = r.umdNm;
    const priceStr = String(r.dealAmount || '').replace(/,/g, '').trim();
    const price = Number(priceStr);
    const area = Number(r.excluUseAr);
    if (!dongs[d]) dongs[d] = [];
    if (price > 0 && area > 0) {
      dongs[d].push((price / area) * 3.3058); // 만원/평
    }
  }

  console.log('\n=== 2026년 7월 송파구 동별 아파트 평균 평당가 (국토교통부 API 계산) ===');
  for (const [dong, list] of Object.entries(dongs)) {
    const avg = Math.round(list.reduce((a,b)=>a+b, 0) / list.length);
    list.sort((a,b)=>a-b);
    const med = Math.round(list[Math.floor(list.length/2)]);
    console.log(`  - ${dong}: 평균 평당 ${avg}만원 | 중위 평당 ${med}만원 (거래건수: ${list.length}건)`);
  }
}

main();
