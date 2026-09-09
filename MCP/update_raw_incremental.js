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
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^[']|[']$/g, '');
      }
    }
  });
}

const MOLIT_KEY = env.MOLIT_API_KEY || process.env.MOLIT_API_KEY;
const ECOS_KEY = env.ECOS_API_KEY || process.env.ECOS_API_KEY;
const NEIS_KEY = env.NEIS_API_KEY || process.env.NEIS_API_KEY;

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

const DISTRICT_MAP = {
  "gangnam": { code: "11680", name: "서울특별시 강남구", short: "강남구" },
  "seocho": { code: "11650", name: "서울특별시 서초구", short: "서초구" },
  "songpa": { code: "11710", name: "서울특별시 송파구", short: "송파구" },
  "yongsan": { code: "11170", name: "서울특별시 용산구", short: "용산구" },
  "seongdong": { code: "11200", name: "서울특별시 성동구", short: "성동구" },
  "mapo": { code: "11440", name: "서울특별시 마포구", short: "마포구" },
  "yeongdeungpo": { code: "11560", name: "서울특별시 영등포구", short: "영등포구" },
  "yangcheon": { code: "11470", name: "서울특별시 양천구", short: "양천구" },
  "jongno": { code: "11110", name: "서울특별시 종로구", short: "종로구" },
  "bundang": { code: "41135", name: "경기도 성남시 분당구", short: "분당구" },
  "suji": { code: "41465", name: "경기도 용인시 수지구", short: "수지구" },
  "gwacheon": { code: "41290", name: "경기도 과천시", short: "과천시" },
  "pyeongchon": { code: "41173", name: "경기도 안양시 동안구", short: "동안구" },
  "ilsan": { code: "41285", name: "경기도 고양시 일산동구", short: "일산동구" },
  "gwangmyeong": { code: "41210", name: "경기도 광명시", short: "광명시" },
  "hanam": { code: "41450", name: "경기도 하남시", short: "하남시" }
};

function getWeekNumber(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week: weekNo };
}

async function fetchMolitTradeMonth(code, ym) {
  if (!MOLIT_KEY) return [];
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${code}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.warn(`[Molit API] Error (${code}, ${ym}):`, e.message);
    return [];
  }
}

function parseLastUpdateFromRaw(content) {
  let lastYm = null;
  let lastDealDate = null;
  const dateMatches = content.match(/20\d{2}-\d{2}-\d{2}/g);
  if (dateMatches && dateMatches.length > 0) {
    const sorted = [...dateMatches].sort();
    lastDealDate = sorted[sorted.length - 1];
    lastYm = lastDealDate.slice(0, 7).replace('-', '');
  } else {
    const ymMatches = content.match(/20\d{2}년\s*(\d{1,2})월/g);
    if (ymMatches && ymMatches.length > 0) {
      for (const m of ymMatches) {
        const parts = m.match(/(20\d{2})년\s*(\d{1,2})월/);
        if (parts) {
          const ym = `${parts[1]}${parts[2].padStart(2, '0')}`;
          if (!lastYm || ym > lastYm) lastYm = ym;
        }
      }
    }
  }
  return { lastYm, lastDealDate };
}

export async function updateRawDataIncremental(slug) {
  const info = DISTRICT_MAP[slug];
  if (!info) {
    console.error(`알 수 없는 지역 slug: ${slug}`);
    return false;
  }

  const dataDir = path.join(__dirname, '..', 'data', 're-data-collector');
  const targetFile = path.join(dataDir, `${slug}_raw.md`);

  const now = new Date();
  const currentYm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prevYm = now.getMonth() === 0 
    ? `${now.getFullYear() - 1}12`
    : `${now.getFullYear()}${String(now.getMonth()).padStart(2, '0')}`;

  console.log(`\n======================================================`);
  console.log(`[증분 업데이트] ${info.name} (${slug}, 코드: ${info.code})`);
  console.log(`현재 일자: ${now.toISOString().slice(0, 10)}, 기준월: ${currentYm}`);

  let existingContent = '';
  let lastYm = null;
  let lastDealDate = null;

  if (fs.existsSync(targetFile)) {
    existingContent = fs.readFileSync(targetFile, 'utf8');
    const parsed = parseLastUpdateFromRaw(existingContent);
    lastYm = parsed.lastYm;
    lastDealDate = parsed.lastDealDate;
    console.log(`- 기존 데이터 확인: ${targetFile}`);
    console.log(`- 기존 마지막 수집 연월: ${lastYm || '미확인'}, 마지막 거래일자: ${lastDealDate || '미확인'}`);
  }

  const targetMonths = [];
  if (!lastYm) {
    targetMonths.push(prevYm, currentYm);
  } else {
    let y = Math.floor(Number(lastYm) / 100), m = Number(lastYm) % 100;
    const curNum = Number(currentYm);
    while (y * 100 + m <= curNum) {
      targetMonths.push(`${y}${String(m).padStart(2, '0')}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  console.log(`- 증분 수집 대상 월: ${targetMonths.join(', ')} (과거 완료 월은 API 호출 없이 100% 보존)`);

  const newTrades = [];
  for (const ym of targetMonths) {
    console.log(`  -> 국토부 API 증분 조회 (${info.short} ${ym})...`);
    const trades = await fetchMolitTradeMonth(info.code, ym);
    console.log(`     조회 건수: ${trades.length}건`);
    for (const t of trades) {
      const dealDate = `${t.dealYear}-${String(t.dealMonth).padStart(2, '0')}-${String(t.dealDay).padStart(2, '0')}`;
      if (!lastDealDate || dealDate >= lastDealDate) {
        newTrades.push({
          apt: t.aptNm,
          dong: t.umdNm,
          area: Number(t.excluUseAr),
          floor: Number(t.floor),
          amount: Number(String(t.dealAmount || '0').replace(/,/g, '').trim()),
          dealDate,
          raw: t,
        });
      }
    }
  }

  console.log(`- 마지막 업데이트 이후 최신 일정 신규 거래 건수: ${newTrades.length}건`);

  if (!existingContent) {
    console.log(`- 기존 파일이 없어 신규 초기 원자재 데이터셋 생성 진행`);
    newTrades.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
    const recentSample = newTrades.slice(0, 15);
    let tableAddition = '';
    for (const t of recentSample) {
      const pyeongPrice = Math.round((t.amount / t.area) * 3.3058);
      const amtStr = t.amount >= 10000 
        ? `${Math.floor(t.amount / 10000)}억 ${(t.amount % 10000).toLocaleString()}만원`
        : `${t.amount.toLocaleString()}만원`;
      tableAddition += `| ${t.apt} | ${t.dong} | ${t.area}㎡ | ${t.floor}층 | ${amtStr} | ${pyeongPrice.toLocaleString()}만원 | ${t.dealDate} | 국토교통부 실거래가 |\n`;
    }

    const weekInfo = getWeekNumber(now);
    const updatedDateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${weekInfo.year}년 ${weekInfo.week}주차 최초 수집)`;
    existingContent = `# ${info.name} 부동산 시장 원자재 데이터셋 (${slug}_raw)

**조회 일시**: ${updatedDateStr}  
**수집 담당**: 데이터 수집가 (통계 담당관)  
**대상 지역**: ${info.name} (slug: ${slug}, 법정동코드: ${info.code})  
**수집 목적**: 부동산 투자 파이프라인 1단계 원자재 데이터 공급  

---

## 1. 주요 대표 단지별 실거래가 (국토교통부 API 최신 기준)

| 단지명 | 법정동 | 전용면적 | 층수 | 거래 금액 | 평당가 (만원/평) | 계약일자 | 출처 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${tableAddition}
---
`;
    fs.writeFileSync(targetFile, existingContent, 'utf8');
    const historyFile = path.join(dataDir, `${slug}_raw_${weekInfo.year}W${String(weekInfo.week).padStart(2, '0')}.md`);
    fs.writeFileSync(historyFile, existingContent, 'utf8');
    console.log(`✔ 신규 원자재 파일 생성 완료: ${targetFile}`);
    return true;
  }

  const weekInfo = getWeekNumber(now);
  const updatedDateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${weekInfo.year}년 ${weekInfo.week}주차 증분 갱신)`;

  let updatedContent = existingContent.replace(
    /\*\*조회 일시\*\*:[^\n]+/,
    `**조회 일시**: ${updatedDateStr} (마지막 업데이트 이후 최신 거래 증분 반영)`
  );

  if (newTrades.length > 0) {
    newTrades.sort((a, b) => b.dealDate.localeCompare(a.dealDate));
    const recentSample = newTrades.slice(0, 10);
    
    let tableAddition = `\n<!-- 최신 증분 거래 (${now.toISOString().slice(0, 10)} 갱신) -->\n`;
    for (const t of recentSample) {
      const pyeongPrice = Math.round((t.amount / t.area) * 3.3058);
      const amtStr = t.amount >= 10000 
        ? `${Math.floor(t.amount / 10000)}억 ${(t.amount % 10000).toLocaleString()}만원`
        : `${t.amount.toLocaleString()}만원`;
      tableAddition += `| ${t.apt} | ${t.dong} | ${t.area}㎡ | ${t.floor}층 | ${amtStr} (국토부 증분) | ${pyeongPrice.toLocaleString()}만원 | ${t.dealDate} | 국토교통부 실거래가 |\n`;
    }

    const tableHeaderRegex = /(\| 단지명 \| 법정동 \| 전용면적 \| 층수 \| 거래 금액 \| 평당가[^\n]+\n\|[ :|-]+\n)/;
    if (tableHeaderRegex.test(updatedContent)) {
      updatedContent = updatedContent.replace(tableHeaderRegex, `$1${tableAddition}`);
    }
  }

  fs.writeFileSync(targetFile, updatedContent, 'utf8');
  console.log(`✔ 최신 가동 파일 증분 갱신 완료: ${targetFile}`);

  const historyFile = path.join(dataDir, `${slug}_raw_${weekInfo.year}W${String(weekInfo.week).padStart(2, '0')}.md`);
  fs.writeFileSync(historyFile, updatedContent, 'utf8');
  console.log(`✔ 주별 이력 파일 증분 보관 완료: ${historyFile}`);
  console.log(`[완료] 기존 과거 데이터 100% 동일 유지 + 최신 일정 증분 업데이트 성공!\n`);
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('update_raw_incremental.js')) {
  const targetSlug = process.argv[2] || 'gangnam';
  if (targetSlug === 'all') {
    (async () => {
      for (const slug of Object.keys(DISTRICT_MAP)) {
        await updateRawDataIncremental(slug);
      }
    })();
  } else {
    updateRawDataIncremental(targetSlug);
  }
}
