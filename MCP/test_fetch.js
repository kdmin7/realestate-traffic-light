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

async function fetchMolitTrade(ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11710&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    if (parsed.OpenAPI_ServiceResponse) {
      console.log(`Molit Service Response (${ym}):`, parsed.OpenAPI_ServiceResponse);
    }
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.error(`Molit Trade Error (${ym}):`, e.message);
    return null;
  }
}

async function fetchMolitRent(ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11710&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : [items];
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
    return data?.StatisticSearch?.row || data?.RESULT || null;
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
    const songpaSchools = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('송파구'));
    return { allSeoul: rows.length, songpaSchools };
  } catch (e) {
    console.error('NEIS Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('--- Executing 3 Major API Queries ---');
  
  const trades07 = await fetchMolitTrade('202607');
  const trades06 = await fetchMolitTrade('202606');
  const rents07 = await fetchMolitRent('202607');
  const rents06 = await fetchMolitRent('202606');
  const ecosBase = await fetchEcosBaseRate();
  const ecosLoan = await fetchEcosMortgageRate();
  const neisData = await fetchNeisSchools();

  console.log('\n=== 국토교통부 실거래가 (매매 2026.07 / 2026.06) ===');
  console.log(`2026.07 건수: ${trades07 ? trades07.length : '조회 실패'}`);
  console.log(`2026.06 건수: ${trades06 ? trades06.length : '조회 실패'}`);
  if (trades07 && trades07.length > 0) {
    console.log('2026.07 샘플 2건:', JSON.stringify(trades07.slice(0, 2), null, 2));
  }

  console.log('\n=== 국토교통부 전월세 (2026.07 / 2026.06) ===');
  console.log(`2026.07 건수: ${rents07 ? rents07.length : '조회 실패'}`);
  console.log(`2026.06 건수: ${rents06 ? rents06.length : '조회 실패'}`);
  if (rents07 && rents07.length > 0) {
    console.log('2026.07 전월세 샘플 2건:', JSON.stringify(rents07.slice(0, 2), null, 2));
  }

  console.log('\n=== 한국은행 ECOS (기준금리 최근 5개) ===');
  if (Array.isArray(ecosBase)) {
    console.log(ecosBase.slice(-5));
  } else {
    console.log(ecosBase);
  }

  console.log('\n=== 한국은행 ECOS (주담대금리 최근 5개) ===');
  if (Array.isArray(ecosLoan)) {
    console.log(ecosLoan.slice(-5));
  } else {
    console.log(ecosLoan);
  }

  console.log('\n=== 나이스 NEIS (송파구 학군 데이터) ===');
  if (neisData) {
    console.log(`서울 전체 고교 수: ${neisData.allSeoul}, 송파구 고교 수: ${neisData.songpaSchools.length}`);
    const specials = ['자율', '특수목적', '외국어', '과학', '국제', '영재', '예술', '체육'];
    const specSchools = neisData.songpaSchools.filter(r => {
      const blob = Object.values(r).join(' ');
      return specials.some(k => blob.includes(k)) && !blob.includes('특성화');
    });
    console.log(`송파구 자율/특목고 수 (${specSchools.length}개):`, specSchools.map(s => `${s.SCHUL_NM} (${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '기타'})`));
    console.log('송파구 모든 고등학교:', neisData.songpaSchools.map(s => `${s.SCHUL_NM} (${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '일반고'})`));
  } else {
    console.log('NEIS 조회 실패');
  }
}

main();
