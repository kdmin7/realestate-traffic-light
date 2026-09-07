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
const ECOS_KEY = env.ECOS_API_KEY || process.env.ECOS_API_KEY;
const NEIS_KEY = env.NEIS_API_KEY || process.env.NEIS_API_KEY;

console.log('API Keys status:', {
  MOLIT: !!MOLIT_KEY,
  ECOS: !!ECOS_KEY,
  NEIS: !!NEIS_KEY
});

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

async function fetchMolitTrade(lawdCd, ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=1&numOfRows=2000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch (e) {
    console.error(`Molit Trade Error (${ym}):`, e.message);
    return null;
  }
}

async function fetchMolitRent(lawdCd, ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=1&numOfRows=2000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch (e) {
    console.error(`Molit Rent Error (${ym}):`, e.message);
    return null;
  }
}

async function fetchEcosBaseRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/100/722Y001/M/202401/202608/0101000`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data?.StatisticSearch?.row || [];
  } catch (e) {
    console.error('ECOS Base Rate Error:', e.message);
    return null;
  }
}

async function fetchEcosMortgageRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/500/121Y006/M/202401/202608`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.StatisticSearch?.row || [];
    return rows.filter(r => (r.ITEM_NAME1 || '').includes('주택담보'));
  } catch (e) {
    console.error('ECOS Mortgage Rate Error:', e.message);
    return null;
  }
}

async function fetchNeisSchools() {
  if (!NEIS_KEY) return null;
  const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=1000&SCHUL_KND_SC_NM=${encodeURIComponent('고등학교')}&LCTN_SC_NM=${encodeURIComponent('서울특별시')}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.schoolInfo?.[1]?.row || [];
    const yongsanSchools = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('용산구'));
    return { allSeoul: rows.length, yongsanSchools };
  } catch (e) {
    console.error('NEIS Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('--- Executing Yongsan-gu 3 Major API Queries ---');
  const lawdCd = '11170';

  const trades08 = await fetchMolitTrade(lawdCd, '202608');
  const trades07 = await fetchMolitTrade(lawdCd, '202607');
  const trades06 = await fetchMolitTrade(lawdCd, '202606');

  const rents08 = await fetchMolitRent(lawdCd, '202608');
  const rents07 = await fetchMolitRent(lawdCd, '202607');
  const rents06 = await fetchMolitRent(lawdCd, '202606');

  const ecosBase = await fetchEcosBaseRate();
  const ecosLoan = await fetchEcosMortgageRate();
  const neisData = await fetchNeisSchools();

  const results = {
    trades: {
      '202608': trades08,
      '202607': trades07,
      '202606': trades06
    },
    rents: {
      '202608': rents08,
      '202607': rents07,
      '202606': rents06
    },
    ecosBase,
    ecosLoan,
    neisData
  };

  fs.writeFileSync(path.join(__dirname, 'yongsan_api_raw.json'), JSON.stringify(results, null, 2));
  console.log('Saved to MCP/yongsan_api_raw.json');
}

main();
