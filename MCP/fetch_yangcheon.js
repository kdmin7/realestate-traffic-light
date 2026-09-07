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

async function main() {
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11470&DEAL_YMD=202607&pageNo=1&numOfRows=1000`;
  const res = await fetch(url);
  const text = await res.text();
  const parsed = parser.parse(text);
  const trades07 = parsed?.response?.body?.items?.item || [];

  const dongMap = {};
  trades07.forEach(t => {
    const dong = t.umdNm || '미분류';
    if (!dongMap[dong]) dongMap[dong] = [];
    const amt = Number(String(t.dealAmount).replace(/,/g, ''));
    const area = Number(t.excluUseAr);
    const pyung = area / 3.3058;
    const pricePerPyung = amt / pyung;
    dongMap[dong].push({ ...t, amt, area, pyung, pricePerPyung });
  });

  console.log('=== 2026년 7월 동별 통계 ===');
  Object.keys(dongMap).sort().forEach(dong => {
    const list = dongMap[dong];
    const count = list.length;
    const sumPyungPrice = list.reduce((acc, cur) => acc + cur.pricePerPyung, 0);
    const avgPyungPrice = Math.round(sumPyungPrice / count);
    
    const sortedPyungPrices = [...list.map(l => l.pricePerPyung)].sort((a, b) => a - b);
    const midIdx = Math.floor(sortedPyungPrices.length / 2);
    const medianPyungPrice = Math.round(sortedPyungPrices.length % 2 !== 0 ? sortedPyungPrices[midIdx] : (sortedPyungPrices[midIdx - 1] + sortedPyungPrices[midIdx]) / 2);

    console.log(`${dong}: 건수 ${count}건 | 평균 평당가 ${avgPyungPrice.toLocaleString()}만원 | 중위 평당가 ${medianPyungPrice.toLocaleString()}만원`);
  });
}

main();
