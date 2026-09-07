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

async function fetchMolitTrade(ym) {
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11680&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  const res = await fetch(url);
  const text = await res.text();
  const parsed = parser.parse(text);
  const items = parsed?.response?.body?.items?.item || [];
  return Array.isArray(items) ? items : [items];
}

async function main() {
  const m07 = await fetchMolitTrade('202607');
  const m06 = await fetchMolitTrade('202606');
  const m05 = await fetchMolitTrade('202605');

  console.log('=== 동별 거래건수 및 평당가 (2026.07) ===');
  const dongs = {};
  for (const r of m07) {
    const d = r.umdNm;
    const priceStr = String(r.dealAmount || '').replace(/,/g, '').trim();
    const price = Number(priceStr);
    const area = Number(r.excluUseAr);
    if (!dongs[d]) dongs[d] = [];
    if (price > 0 && area > 0) {
      dongs[d].push({ price, area, pyPrice: Math.round((price / area) * 3.3058) });
    }
  }

  for (const [dong, list] of Object.entries(dongs)) {
    const pyPrices = list.map(l => l.pyPrice);
    pyPrices.sort((a,b)=>a-b);
    const avg = Math.round(pyPrices.reduce((a,b)=>a+b, 0) / pyPrices.length);
    const med = Math.round(pyPrices[Math.floor(pyPrices.length/2)]);
    console.log(`| ${dong} | ${list.length}건 | ${avg.toLocaleString()}만원 | ${med.toLocaleString()}만원 | 국토교통부 실거래가 API | 국토교통부 (RTMSDataSvcAptTradeDev) |`);
  }

  console.log('\n=== 주요 대표 단지 실거래가 (2026.07~06) ===');
  const allM = [...m06, ...m07];
  allM.sort((a,b) => {
    const da = `${a.dealYear}${String(a.dealMonth).padStart(2,'0')}${String(a.dealDay).padStart(2,'0')}`;
    const db = `${b.dealYear}${String(b.dealMonth).padStart(2,'0')}${String(b.dealDay).padStart(2,'0')}`;
    return db.localeCompare(da);
  });

  const seenApts = new Set();
  const samples = [];
  for (const r of allM) {
    const name = String(r.aptNm || '').trim();
    const priceStr = String(r.dealAmount || '').replace(/,/g, '').trim();
    const price = Number(priceStr);
    const area = Number(r.excluUseAr);
    const py = (area / 3.3058).toFixed(1);
    const pyPrice = Math.round((price / area) * 3.3058);
    const date = `${r.dealYear}-${String(r.dealMonth).padStart(2,'0')}-${String(r.dealDay).padStart(2,'0')}`;
    const eoc = price >= 10000 ? `${Math.floor(price/10000)}억 ${(price%10000).toLocaleString()}만원` : `${price.toLocaleString()}만원`;

    const key = `${name}_${area}`;
    if (!seenApts.has(key) && (name.includes('현대') || name.includes('은마') || name.includes('래미안대치팰리스') || name.includes('디에이치') || name.includes('개포자이') || name.includes('도곡렉슬') || name.includes('청담') || name.includes('자이') || price > 300000)) {
      seenApts.add(key);
      samples.push({
        name, dong: r.umdNm, area: `${area}㎡`, py, floor: `${r.floor}층`, eoc, pyPrice: `${pyPrice.toLocaleString()}만원`, date
      });
    }
  }

  samples.slice(0, 15).forEach(s => {
    console.log(`| ${s.name} | ${s.dong} | ${s.area} | ${s.floor} | ${s.eoc} (국토교통부 API) | ${s.pyPrice} (국토교통부 API) | ${s.date} | 국토교통부 (RTMSDataSvcAptTradeDev) |`);
  });
}

main();
