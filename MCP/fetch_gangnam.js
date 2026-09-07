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
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11680&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
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
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=11680&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
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
    const gangnamSchools = rows.filter(r => (r.ORG_RDNMA || r.ORG_RDNZC || '').includes('강남구'));
    return { allSeoul: rows.length, gangnamSchools };
  } catch (e) {
    console.error('NEIS Error:', e.message);
    return null;
  }
}

async function main() {
  console.log('--- Fetching Gangnam (11680) Data ---');
  
  const m07 = await fetchMolitTrade('202607');
  const m06 = await fetchMolitTrade('202606');
  const m05 = await fetchMolitTrade('202605');
  const r07 = await fetchMolitRent('202607');
  const r06 = await fetchMolitRent('202606');
  const r05 = await fetchMolitRent('202605');

  const ecosBase = await fetchEcosBaseRate();
  const ecosLoan = await fetchEcosMortgageRate();
  const neisData = await fetchNeisSchools();

  console.log(`\n[국토부 매매 거래량] 2026.07: ${m07 ? m07.length : '조회실패'}건, 2026.06: ${m06 ? m06.length : '조회실패'}건, 2026.05: ${m05 ? m05.length : '조회실패'}건`);
  console.log(`[국토부 전월세 거래량] 2026.07: ${r07 ? r07.length : '조회실패'}건, 2026.06: ${r06 ? r06.length : '조회실패'}건, 2026.05: ${r05 ? r05.length : '조회실패'}건`);

  // 동별 평당가 (2026.07)
  const dongs = {};
  if (m07) {
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
  }

  console.log('\n=== 2026.07 강남구 동별 평당가 ===');
  for (const [dong, list] of Object.entries(dongs)) {
    const avg = Math.round(list.reduce((a,b)=>a+b, 0) / list.length);
    list.sort((a,b)=>a-b);
    const med = Math.round(list[Math.floor(list.length/2)]);
    console.log(`동: ${dong} | 건수: ${list.length} | 평균: ${avg}만원/평 | 중위: ${med}만원/평`);
  }

  // 대표 단지 실거래 (2026.05 ~ 07)
  const allM = [...(m05||[]), ...(m06||[]), ...(m07||[])];
  const targetApts = ['현대', '은마', '래미안대치팰리스', '디에이치 퍼스티어 아이파크', '개포자이프레지던스', '도곡렉슬', '청담 자이', '압구정', '아크로리버파크', '대치'];
  
  console.log('\n=== 강남구 주요 대표 단지 매매 실거래 내역 (2026.05~07) ===');
  const foundApts = [];
  for (const r of allM) {
    const name = String(r.aptNm || '').trim();
    const match = targetApts.find(t => name.includes(t) || t.includes(name));
    if (match) {
      const priceStr = String(r.dealAmount || '').replace(/,/g, '').trim();
      const price = Number(priceStr);
      const area = Number(r.excluUseAr);
      const py = (area / 3.3058).toFixed(1);
      const pyPrice = Math.round((price / area) * 3.3058);
      foundApts.push({
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
  foundApts.sort((a,b) => b.date.localeCompare(a.date));
  foundApts.slice(0, 20).forEach(item => {
    console.log(`${item.apt} (${item.dong}) | ${item.area}㎡ (${item.py}평) | ${item.floor}층 | ${item.price}만원 (평당 ${item.pyPrice}만원) | ${item.date}`);
  });

  console.log('\n=== ECOS 금리 데이터 ===');
  console.log('기준금리:', Array.isArray(ecosBase) ? ecosBase.slice(-7) : ecosBase);
  console.log('주담대금리:', Array.isArray(ecosLoan) ? ecosLoan.slice(-7) : ecosLoan);

  console.log('\n=== NEIS 강남구 학군 데이터 ===');
  if (neisData) {
    console.log(`강남구 고교 수: ${neisData.gangnamSchools.length}`);
    const specials = ['자율', '특수목적', '외국어', '과학', '국제', '영재', '예술', '체육'];
    const specSchools = neisData.gangnamSchools.filter(r => {
      const blob = Object.values(r).join(' ');
      return specials.some(k => blob.includes(k)) && !blob.includes('특성화');
    });
    console.log(`자율/특목고 (${specSchools.length}개):`, specSchools.map(s => `${s.SCHUL_NM} (${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '기타'})`));
    console.log('모든 고교:', neisData.gangnamSchools.map(s => `${s.SCHUL_NM} (${s.HS_PURPS_SMS_NM || s.HS_GNRL_BUSNS_SC_NM || '일반고'}, ${s.ORG_RDNMA})`));
  }
}

main();
