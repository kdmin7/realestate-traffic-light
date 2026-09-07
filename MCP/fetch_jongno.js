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

const LAWD_CD = '11110'; // 종로구
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

async function fetchMolitTrade(ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch (e) {
    console.error(`Molit Trade Error (${ym}):`, e.message);
    return [];
  }
}

async function fetchMolitRent(ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${LAWD_CD}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  } catch (e) {
    console.error(`Molit Rent Error (${ym}):`, e.message);
    return [];
  }
}

async function fetchEcosBaseRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/100/722Y001/M/202601/202608/0101000`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data?.StatisticSearch?.row || [];
  } catch (e) {
    console.error('ECOS Base Rate Error:', e.message);
    return [];
  }
}

async function fetchEcosMortgageRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/500/121Y006/M/202601/202608`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.StatisticSearch?.row || [];
    return rows.filter(r => (r.ITEM_NAME1 || '').includes('주택담보'));
  } catch (e) {
    console.error('ECOS Mortgage Rate Error:', e.message);
    return [];
  }
}

async function fetchNeisSchools() {
  if (!NEIS_KEY) return null;
  const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=1000&SCHUL_KND_SC_NM=${encodeURIComponent('고등학교')}&LCTN_SC_NM=${encodeURIComponent('서울특별시')}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.schoolInfo?.[1]?.row || [];
    const jongnoSchools = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('종로구'));
    return jongnoSchools;
  } catch (e) {
    console.error('NEIS Error:', e.message);
    return [];
  }
}

async function main() {
  console.log('Fetching Jongno data...');
  const months = ['202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608'];
  const tradesByMonth = {};
  const rentsByMonth = {};

  for (const ym of months) {
    tradesByMonth[ym] = await fetchMolitTrade(ym);
    rentsByMonth[ym] = await fetchMolitRent(ym);
  }

  const ecosBase = await fetchEcosBaseRate();
  const ecosLoan = await fetchEcosMortgageRate();
  const neisSchools = await fetchNeisSchools();

  const resultData = {
    tradesByMonth,
    rentsByMonth,
    ecosBase,
    ecosLoan,
    neisSchools
  };

  fs.writeFileSync(path.join(__dirname, 'jongno_fetched.json'), JSON.stringify(resultData, null, 2));
  console.log('Fetch completed. Saved to MCP/jongno_fetched.json');
}

main();
