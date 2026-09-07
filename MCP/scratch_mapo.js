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

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

async function fetchMolitTrade(ym) {
  if (!MOLIT_KEY) return null;
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11440&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
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
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11440&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
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
    const mapoSchools = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('마포구'));
    return { allSeoul: rows.length, mapoSchools };
  } catch (e) {
    console.error('NEIS Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('--- Fetching Mapo Data ---');
  const trades07 = await fetchMolitTrade('202607');
  const trades06 = await fetchMolitTrade('202606');
  const rents07 = await fetchMolitRent('202607');
  const rents06 = await fetchMolitRent('202606');
  const ecosBase = await fetchEcosBaseRate();
  const ecosLoan = await fetchEcosMortgageRate();
  const neisData = await fetchNeisSchools();

  console.log('\n=== 국토교통부 매매 ===');
  console.log(`2026.07 건수: ${trades07 ? trades07.length : '조회 실패'}`);
  console.log(`2026.06 건수: ${trades06 ? trades06.length : '조회 실패'}`);

  console.log('\n=== 국토교통부 전월세 ===');
  console.log(`2026.07 건수: ${rents07 ? rents07.length : '조회 실패'}`);
  console.log(`2026.06 건수: ${rents06 ? rents06.length : '조회 실패'}`);

  console.log('\n=== ECOS 기준금리 ===');
  console.log(Array.isArray(ecosBase) ? ecosBase.slice(-5) : ecosBase);

  console.log('\n=== ECOS 주담대금리 ===');
  console.log(Array.isArray(ecosLoan) ? ecosLoan.slice(-5) : ecosLoan);

  console.log('\n=== NEIS 마포구 고등학교 ===');
  if (neisData) {
    console.log(`마포구 고교 수: ${neisData.mapoSchools.length}`);
    console.log(JSON.stringify(neisData.mapoSchools.map(s => ({
      name: s.SCHUL_NM,
      kind: s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '일반고',
      addr: s.ORG_RDNMA,
      type: s.SCHUL_KND_SC_NM
    })), null, 2));
  }

  // 동별 평당가 및 주요 단지 분석
  if (trades07 && trades07.length > 0) {
    const dongMap = {};
    const apts = [];

    for (const t of trades07) {
      const dong = String(t.umdNm || '').trim();
      const dealAmountStr = String(t.dealAmount || '').replace(/,/g, '').trim();
      const amount = Number(dealAmountStr);
      const area = Number(t.excluUseAr);
      const pyeong = area / 3.30578;
      const pyeongPrice = amount / pyeong; // 만원/평

      if (!dongMap[dong]) dongMap[dong] = { count: 0, prices: [] };
      dongMap[dong].count++;
      dongMap[dong].prices.push(pyeongPrice);

      apts.push({
        apt: String(t.aptNm).trim(),
        dong,
        area,
        floor: t.floor,
        amount,
        pyeongPrice: Math.round(pyeongPrice),
        dealDate: `${t.dealYear}-${String(t.dealMonth).padStart(2, '0')}-${String(t.dealDay).padStart(2, '0')}`
      });
    }

    console.log('\n=== 동별 평당가 요약 (2026.07) ===');
    const dongSummary = Object.keys(dongMap).map(d => {
      const prices = dongMap[d].prices.sort((a,b)=>a-b);
      const avg = Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
      const mid = Math.round(prices[Math.floor(prices.length/2)]);
      return { dong: d, count: dongMap[d].count, avgPyeongPrice: avg, midPyeongPrice: mid };
    });
    console.table(dongSummary);

    console.log('\n=== 대표 아파트 단지 실거래 샘플 ===');
    const targetApts = ['마포프레스티지자이', '마포래미안푸르지오', '마포더클래시', '래미안마포리버웰', 'e편한세상마포리버파크', '신촌숲아이파크', '성산시영', '상암월드컵파크', '한강밤섬자이', '마포자이', '공덕'];
    const filteredApts = apts.filter(a => targetApts.some(t => a.apt.includes(t)));
    console.log(JSON.stringify(filteredApts.length > 0 ? filteredApts : apts.slice(0, 20), null, 2));
  }
}

main();
