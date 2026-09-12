#!/usr/bin/env node
/**
 * 서울 부동산 인사이트 MCP Server — Phase 1 + 2
 *
 *  Phase 1 · get_price_trend    : 아파트 매매가 분기 트렌드(CAGR·변동성)
 *  Phase 2 · get_jeonse_ratio   : 전세가율(임대수익 축) + 월세 비중
 *  Phase 2 · get_macro_context  : 기준금리·주택담보대출 금리(한국은행 ECOS)
 *
 * 설계 원칙(설계도 참조):
 *  - 공간 단위: 자치구(LAWD_CD 5자리)   - 시간 단위: 분기 리샘플
 *  - 금액은 만원 단위 문자열(콤마) → 숫자 변환, 숫자 자동변환 OFF
 *  - resultCode 문자열 유지("000"/"00" 정상), 월별 응답 디스크 캐시(L2)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// check_schools.js (schoolinfo-mcp 및 NEIS 연동) 서비스 모듈 임포트
import {
  searchSchools,
  getDistrictHighSchoolsData,
  getSchoolMealData,
  getSchoolScheduleData,
  getParentDigestData,
  callRemoteMcp as callRemoteSchoolMcp,
} from "./check_schools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 파일 자동 로드
for (const envPath of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env")]) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

const MOLIT_KEY = process.env.MOLIT_API_KEY;   // 국토부 실거래가(매매·전월세 공통)
const ECOS_KEY = process.env.ECOS_API_KEY;     // 한국은행 ECOS
const CACHE_DIR = path.join(__dirname, ".cache");

// 국토부 데이터셋 정의(매매·전월세)
const DATASETS = {
  sale: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    cacheSub: "apt-trade",
    map: (it) => ({
      amount: manwon(it.dealAmount),          // 매매금액(만원)
      area: Number(it.excluUseAr),
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
      apt: str(it.aptNm), dong: str(it.umdNm),
      floor: Number(it.floor),
    }),
    valid: (r) => Number.isFinite(r.amount) && r.area > 0,
  },
  rent: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
    cacheSub: "apt-rent",
    map: (it) => ({
      deposit: manwon(it.deposit),            // 보증금(만원)
      monthly: manwon(it.monthlyRent),        // 월세(만원), 전세면 0
      area: Number(it.excluUseAr),
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
      apt: str(it.aptNm), dong: str(it.umdNm),
      floor: Number(it.floor),
    }),
    valid: (r) => Number.isFinite(r.deposit) && r.area > 0,
  },
  // --- tae0y/real-estate-mcp 확장 데이터셋 ---
  officetel_sale: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade",
    cacheSub: "offi-trade",
    map: (it) => ({
      name: str(it.offiNm),
      dong: str(it.umdNm),
      amount: manwon(it.dealAmount),
      area: Number(it.excluUseAr),
      floor: Number(it.floor),
      buildYear: Number(it.buildYear),
      dealType: str(it.dealingGbn),
      canceled: str(it.cdealType) === "O",
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.amount) && r.area > 0 && !r.canceled,
  },
  officetel_rent: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent",
    cacheSub: "offi-rent",
    map: (it) => ({
      name: str(it.offiNm),
      dong: str(it.umdNm),
      deposit: manwon(it.deposit),
      monthly: manwon(it.monthlyRent),
      area: Number(it.excluUseAr),
      floor: Number(it.floor),
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.deposit) && r.area > 0,
  },
  villa_sale: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade",
    cacheSub: "villa-trade",
    map: (it) => ({
      name: str(it.mhouseNm),
      dong: str(it.umdNm),
      houseType: str(it.houseType),
      amount: manwon(it.dealAmount),
      area: Number(it.excluUseAr),
      floor: Number(it.floor),
      buildYear: Number(it.buildYear),
      dealType: str(it.dealingGbn),
      canceled: str(it.cdealType) === "O",
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.amount) && r.area > 0 && !r.canceled,
  },
  villa_rent: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent",
    cacheSub: "villa-rent",
    map: (it) => ({
      name: str(it.mhouseNm),
      dong: str(it.umdNm),
      houseType: str(it.houseType),
      deposit: manwon(it.deposit),
      monthly: manwon(it.monthlyRent),
      area: Number(it.excluUseAr),
      floor: Number(it.floor),
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.deposit) && r.area > 0,
  },
  single_sale: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade",
    cacheSub: "single-trade",
    map: (it) => ({
      houseType: str(it.houseType),
      dong: str(it.umdNm),
      amount: manwon(it.dealAmount),
      area: Number(it.totArea || it.plottageAr || 0),
      buildYear: Number(it.buildYear),
      dealType: str(it.dealingGbn),
      canceled: str(it.cdealType) === "O",
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.amount) && r.area > 0 && !r.canceled,
  },
  single_rent: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcSHRent/getRTMSDataSvcSHRent",
    cacheSub: "single-rent",
    map: (it) => ({
      houseType: str(it.houseType),
      dong: str(it.umdNm),
      deposit: manwon(it.deposit),
      monthly: manwon(it.monthlyRent),
      area: Number(it.totArea || 0),
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.deposit) && r.area > 0,
  },
  commercial_sale: {
    url: "http://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade",
    cacheSub: "commercial-trade",
    map: (it) => ({
      buildingType: str(it.buildingType),
      buildingUse: str(it.buildingUse),
      landUse: str(it.landUse),
      dong: str(it.umdNm),
      amount: manwon(it.dealAmount),
      area: Number(it.buildingAr || 0),
      floor: Number(it.floor),
      buildYear: Number(it.buildYear),
      dealType: str(it.dealingGbn),
      canceled: str(it.cdealtype) === "O",
      y: Number(it.dealYear), m: Number(it.dealMonth), d: Number(it.dealDay),
    }),
    valid: (r) => Number.isFinite(r.amount) && r.area > 0 && !r.canceled,
  },
};

// 서울 25개 자치구 법정동코드(앞 5자리)
const SEOUL_GU = {
  종로구: "11110", 중구: "11140", 용산구: "11170", 성동구: "11200",
  광진구: "11215", 동대문구: "11230", 중랑구: "11260", 성북구: "11290",
  강북구: "11305", 도봉구: "11320", 노원구: "11350", 은평구: "11380",
  서대문구: "11410", 마포구: "11440", 양천구: "11470", 강서구: "11500",
  구로구: "11530", 금천구: "11545", 영등포구: "11560", 동작구: "11590",
  관악구: "11620", 서초구: "11650", 강남구: "11680", 송파구: "11710",
  강동구: "11740",
};

// 경기도 31개 시·군 및 일반구 법정동코드(앞 5자리)
const GYEONGGI_GU = {
  // 수원시
  "수원시 장안구": "41111", "장안구": "41111",
  "수원시 권선구": "41113", "권선구": "41113",
  "수원시 팔달구": "41115", "팔달구": "41115",
  "수원시 영통구": "41117", "영통구": "41117", "수원시": "41110",
  // 성남시
  "성남시 수정구": "41131", "수정구": "41131",
  "성남시 중원구": "41133", "중원구": "41133",
  "성남시 분당구": "41135", "분당구": "41135", "분당": "41135", "판교": "41135", "성남시": "41130",
  // 의정부시
  "의정부시": "41150", "의정부": "41150",
  // 안양시
  "안양시 만안구": "41171", "만안구": "41171",
  "안양시 동안구": "41173", "동안구": "41173", "평촌": "41173", "안양시": "41170",
  // 부천시
  "부천시": "41190", "부천": "41190", "부천시 원미구": "41192", "원미구": "41192",
  "부천시 소사구": "41194", "소사구": "41194", "부천시 오정구": "41196", "오정구": "41196",
  // 광명시
  "광명시": "41210", "광명": "41210",
  // 평택시
  "평택시": "41220", "평택": "41220", "고덕": "41220",
  // 동두천시
  "동두천시": "41250", "동두천": "41250",
  // 안산시
  "안산시 상록구": "41271", "상록구": "41271",
  "안산시 단원구": "41273", "단원구": "41273", "안산시": "41270",
  // 고양시
  "고양시 덕양구": "41281", "덕양구": "41281",
  "고양시 일산동구": "41285", "일산동구": "41285", "일산동": "41285",
  "고양시 일산서구": "41287", "일산서구": "41287", "일산서": "41287",
  "일산": "41285", "고양시": "41280",
  // 과천시
  "과천시": "41290", "과천": "41290",
  // 구리시
  "구리시": "41310", "구리": "41310",
  // 남양주시
  "남양주시": "41360", "남양주": "41360", "다산": "41360", "별내": "41360",
  // 오산시
  "오산시": "41370", "오산": "41370",
  // 시흥시
  "시흥시": "41390", "시흥": "41390", "배곧": "41390",
  // 군포시
  "군포시": "41410", "군포": "41410", "산본": "41410",
  // 의왕시
  "의왕시": "41430", "의왕": "41430",
  // 하남시
  "하남시": "41450", "하남": "41450", "미사": "41450", "위례": "41450",
  // 용인시
  "용인시 처인구": "41461", "처인구": "41461",
  "용인시 기흥구": "41463", "기흥구": "41463",
  "용인시 수지구": "41465", "수지구": "41465", "수지": "41465", "용인시": "41460",
  // 파주시
  "파주시": "41480", "파주": "41480", "운정": "41480",
  // 이천시
  "이천시": "41500", "이천": "41500",
  // 안성시
  "안성시": "41550", "안성": "41550",
  // 김포시
  "김포시": "41570", "김포": "41570",
  // 화성시
  "화성시": "41590", "화성": "41590", "동탄": "41590",
  // 광주시
  "광주시": "41610", "경기 광주시": "41610", "경기광주": "41610",
  // 양주시
  "양주시": "41630", "양주": "41630", "옥정": "41630",
  // 포천시
  "포천시": "41650", "포천": "41650",
  // 여주시
  "여주시": "41670", "여주": "41670",
  // 연천군
  "연천군": "41800", "연천": "41800",
  // 가평군
  "가평군": "41820", "가평": "41820",
  // 양평군
  "양평군": "41830", "양평": "41830",
};

// 표준 대표 명칭 매핑
const CANONICAL_REGIONS = {
  ...SEOUL_GU,
  "수원시 장안구": "41111", "수원시 권선구": "41113", "수원시 팔달구": "41115", "수원시 영통구": "41117",
  "성남시 수정구": "41131", "성남시 중원구": "41133", "성남시 분당구": "41135",
  "의정부시": "41150", "안양시 만안구": "41171", "안양시 동안구": "41173",
  "부천시": "41190", "광명시": "41210", "평택시": "41220", "동두천시": "41250",
  "안산시 상록구": "41271", "안산시 단원구": "41273",
  "고양시 덕양구": "41281", "고양시 일산동구": "41285", "고양시 일산서구": "41287",
  "과천시": "41290", "구리시": "41310", "남양주시": "41360", "오산시": "41370",
  "시흥시": "41390", "군포시": "41410", "의왕시": "41430", "하남시": "41450",
  "용인시 처인구": "41461", "용인시 기흥구": "41463", "용인시 수지구": "41465",
  "파주시": "41480", "이천시": "41500", "안성시": "41550", "김포시": "41570",
  "화성시": "41590", "광주시": "41610", "양주시": "41630", "포천시": "41650",
  "여주시": "41670", "연천군": "41800", "가평군": "41820", "양평군": "41830",
};

const ALL_REGIONS = { ...SEOUL_GU, ...GYEONGGI_GU };
const CODE_TO_GU = Object.fromEntries(Object.entries(CANONICAL_REGIONS).map(([k, v]) => [v, k]));

const parser = new XMLParser({
  ignoreAttributes: true, parseTagValue: false, parseAttributeValue: false, trimValues: true,
});

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = (v) => String(v ?? "").trim();
function manwon(v) {
  if (v == null) return NaN;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}
function monthRange(start, end) {
  const out = [];
  let y = Math.floor(start / 100), m = start % 100;
  const ey = Math.floor(end / 100), em = end % 100;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
const quarterOf = (mm) => Math.floor((mm - 1) / 3) + 1;
const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
};
const errorResult = (m) => ({ isError: true, content: [{ type: "text", text: `❌ 오류: ${m}` }] });

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) { const c = idx++; results[c] = await worker(items[c], c); }
    })
  );
  return results;
}

function resolveGu(district) {
  if (!district) return null;
  const trimmed = String(district).trim();
  let code = /^\d{5}$/.test(trimmed) ? trimmed : ALL_REGIONS[trimmed];
  if (!code) {
    const foundKey = Object.keys(ALL_REGIONS).find(
      (k) => k === trimmed || k === `${trimmed}구` || k === `${trimmed}시` || k === `${trimmed}군`
    );
    if (foundKey) code = ALL_REGIONS[foundKey];
  }
  if (!code) return null;
  const name = CODE_TO_GU[code] || trimmed;
  const province = code.startsWith("11") ? "seoul" : code.startsWith("41") ? "gyeonggi" : "other";
  return { code, name, province };
}
function resolvePeriod(startYearMonth, endYearMonth) {
  const now = new Date();
  const end = endYearMonth ? Number(endYearMonth) : now.getFullYear() * 100 + (now.getMonth() + 1);
  const start = Number(startYearMonth);
  return { start, end };
}

// ---------------------------------------------------------------------------
// 국토부 API 호출 + 캐시 (매매·전월세 공통)
function cachePath(ds, code, ym) {
  return path.join(CACHE_DIR, ds.cacheSub, code, `${ym}.json`);
}

function isFinalMonth(ym) {
  const now = new Date();
  const currentYm = now.getFullYear() * 100 + (now.getMonth() + 1);
  // 신고기한 30일을 고려하여 2개월 전 이전의 데이터는 확정 데이터(과거 데이터)로 간주
  const cutoffYm = (now.getMonth() + 1 <= 2)
    ? (now.getFullYear() - 1) * 100 + (now.getMonth() + 1 + 10)
    : now.getFullYear() * 100 + (now.getMonth() - 1);
  return Number(ym) < cutoffYm;
}

function rowKey(r) {
  const nm = r.apt || r.name || r.houseType || r.buildingUse || "";
  const val = r.amount ?? r.deposit ?? 0;
  return `${r.y}-${r.m}-${r.d}_${nm}_${val}_${r.area}_${r.floor || ""}_${r.dong || ""}`;
}

function mergeRows(existingRows, newRows) {
  const map = new Map();
  // 1. 기존 데이터 우선 등록 (기존 데이터 완벽 보존)
  for (const r of (existingRows || [])) {
    map.set(rowKey(r), r);
  }
  // 2. 최신 증분 데이터 병합
  for (const r of (newRows || [])) {
    const k = rowKey(r);
    if (!map.has(k)) {
      map.set(k, r);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const da = `${a.y}${String(a.m).padStart(2, "0")}${String(a.d).padStart(2, "0")}`;
    const db = `${b.y}${String(b.m).padStart(2, "0")}${String(b.d).padStart(2, "0")}`;
    return da.localeCompare(db);
  });
}

function readCacheInfo(ds, code, ym) {
  try {
    const p = cachePath(ds, code, ym);
    if (!fs.existsSync(p)) return null;
    const stat = fs.statSync(p);
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(parsed)) {
      return { rows: parsed, updatedAt: stat.mtime.toISOString(), isFinal: isFinalMonth(ym) };
    } else if (parsed && Array.isArray(parsed.rows)) {
      return {
        rows: parsed.rows,
        updatedAt: parsed.updatedAt || stat.mtime.toISOString(),
        isFinal: parsed.isFinal ?? isFinalMonth(ym),
        latestDealDate: parsed.latestDealDate,
      };
    }
  } catch { /* 손상 캐시 무시 */ }
  return null;
}

function readCache(ds, code, ym) {
  const info = readCacheInfo(ds, code, ym);
  return info ? info.rows : null;
}

function writeCache(ds, code, ym, rows, extraMeta = {}) {
  try {
    fs.mkdirSync(path.join(CACHE_DIR, ds.cacheSub, code), { recursive: true });
    const latestDeal = rows.length > 0 ? rows[rows.length - 1] : null;
    const latestDealDate = latestDeal ? `${latestDeal.y}-${String(latestDeal.m).padStart(2, "0")}-${String(latestDeal.d).padStart(2, "0")}` : null;
    const payload = {
      updatedAt: new Date().toISOString(),
      isFinal: isFinalMonth(ym),
      totalCount: rows.length,
      latestDealDate,
      ...extraMeta,
      rows,
    };
    fs.writeFileSync(cachePath(ds, code, ym), JSON.stringify(payload, null, 2));
  } catch { /* 캐시 실패 비치명적 */ }
}

async function fetchPage(ds, code, ym, pageNo) {
  const serviceKey = MOLIT_KEY.includes("%") ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const params = new URLSearchParams({
    serviceKey, LAWD_CD: code, DEAL_YMD: ym,
    pageNo: String(pageNo), numOfRows: "100",
  });
  const res = await fetch(`${ds.url}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = parser.parse(await res.text());
  if (parsed.OpenAPI_ServiceResponse) {
    const h = parsed.OpenAPI_ServiceResponse.cmmMsgHeader || {};
    throw new Error(`서비스키 오류: ${h.errMsg || ""} ${h.returnAuthMsg || ""}`.trim());
  }
  const root = parsed.response;
  if (!root) throw new Error("응답 형식이 올바르지 않습니다.");
  const rc = String(root.header?.resultCode ?? "");
  if (rc !== "000" && rc !== "00") throw new Error(`API 오류(코드 ${rc}): ${root.header?.resultMsg ?? ""}`);
  const items = toArray(root.body?.items?.item);
  return { items, total: Number(root.body?.totalCount ?? items.length) };
}

/**
 * 특정 연월(ym) 데이터 조회 (증분 업데이트 및 캐싱 지원)
 * - 과거 확정월: 기존 캐시 100% 재사용 (API 호출 0)
 * - 최신 진행월: 기존 캐시를 유지하면서 마지막 업데이트 이후의 최신 데이터만 증분 병합
 */
async function fetchMonth(ds, code, ym, forceRefresh = false) {
  const cachedInfo = readCacheInfo(ds, code, ym);
  const isFinal = isFinalMonth(ym);

  // 1. 과거 확정월은 캐시가 있으면 영구 재사용
  if (cachedInfo && isFinal) {
    return cachedInfo.rows;
  }

  // 2. 최신 진행월: 오늘 12시간 이내에 이미 업데이트되었고 forceRefresh가 아니면 기존 캐시 사용
  if (cachedInfo && !forceRefresh) {
    const cacheAgeMs = Date.now() - new Date(cachedInfo.updatedAt).getTime();
    if (cacheAgeMs < 12 * 60 * 60 * 1000) {
      return cachedInfo.rows;
    }
  }

  // 3. 최신 데이터 조회 (API 호출)
  const first = await fetchPage(ds, code, ym, 1);
  let all = first.items;
  const pages = Math.ceil(first.total / 100);
  for (let p = 2; p <= pages; p++) all = all.concat((await fetchPage(ds, code, ym, p)).items);
  const fetchedRows = all.map(ds.map).filter(ds.valid);

  // 4. 기존 데이터와 최신 데이터의 증분 병합 (기존 데이터 보존 + 최신 일정 갱신)
  const mergedRows = cachedInfo ? mergeRows(cachedInfo.rows, fetchedRows) : fetchedRows;
  writeCache(ds, code, ym, mergedRows, {
    newlyAddedCount: mergedRows.length - (cachedInfo?.rows?.length || 0),
  });
  return mergedRows;
}

/** 지정 기간의 모든 거래를 병합 반환 (과거 데이터는 캐시 재사용, 최신 데이터만 증분 업데이트) */
async function fetchRange(ds, code, months, forceRefreshLatest = false) {
  let failed = 0, lastErr = "";
  const monthly = await pool(months, 6, async (ym) => {
    try {
      // 최신 진행월에 대해서만 forceRefreshLatest 적용
      const isLatest = !isFinalMonth(ym);
      return await fetchMonth(ds, code, ym, isLatest && forceRefreshLatest);
    } catch (e) {
      failed++; lastErr = e.message; return [];
    }
  });
  return { rows: monthly.flat(), failed, lastErr };
}

// ---------------------------------------------------------------------------
// 도구 1 · get_price_trend (매매)
// ---------------------------------------------------------------------------

function aggregateSaleQuarters(rows) {
  const b = new Map();
  for (const r of rows) {
    const k = `${r.y}Q${quarterOf(r.m)}`;
    (b.get(k) || b.set(k, []).get(k)).push(r);
  }
  return [...b.entries()].sort((a, c) => a[0].localeCompare(c[0])).map(([q, list]) => {
    const amts = list.map((r) => r.amount);
    const perM2 = list.map((r) => r.amount / r.area);
    const sumAmt = amts.reduce((a, x) => a + x, 0);
    const sumArea = list.reduce((a, r) => a + r.area, 0);
    return {
      분기: q, 거래건수: list.length,
      평균가_억: +(sumAmt / list.length / 10000).toFixed(3),
      중위가_억: +(median(amts) / 10000).toFixed(3),
      평당_만원: +(median(perM2) * 3.3058).toFixed(1),
      "㎡당_만원": +(sumAmt / sumArea).toFixed(1),
    };
  });
}
function trendStats(quarters) {
  const v = quarters.filter((q) => q.거래건수 > 0 && Number.isFinite(q.평당_만원));
  if (v.length < 2) return { cagr: null, volatility: null };
  const years = (v.length - 1) / 4;
  const cagr = years > 0 ? (Math.pow(v[v.length - 1].평당_만원 / v[0].평당_만원, 1 / years) - 1) * 100 : null;
  const rets = [];
  for (let i = 1; i < v.length; i++) rets.push(v[i].평당_만원 / v[i - 1].평당_만원 - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length) * 100;
  return { cagr: cagr == null ? null : +cagr.toFixed(2), volatility: +vol.toFixed(2) };
}

const server = new McpServer({ name: "seoul-realty-insight", version: "0.2.0" });

server.registerTool(
  "get_price_trend",
  {
    title: "수도권 아파트 매매가 분기 트렌드",
    description:
      "국토교통부 아파트 매매 실거래가로 서울 및 경기도 시·구의 분기별 평균가·중위가·평당가·거래량 " +
      "시계열과 CAGR·변동성을 반환합니다. (아파트 매매 전용)",
    inputSchema: {
      district: z.string().describe("지역 이름(예: '강남구', '분당구', '수지구', '과천시') 또는 법정동코드 5자리"),
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").default("202301")
        .describe("시작 연월(YYYYMM). 실거래가는 200601부터"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월. 생략 시 이번 달"),
      minAreaM2: z.number().optional().describe("전용면적 하한(㎡)"),
      maxAreaM2: z.number().optional().describe("전용면적 상한(㎡)"),
      forceRefreshLatest: z.boolean().optional().default(false).describe("최신 진행월(당월/전월) 데이터를 최신 일정까지 증분 업데이트할지 여부 (기존 과거 데이터는 100% 보존)"),
    },
  },
  async ({ district, startYearMonth, endYearMonth, minAreaM2, maxAreaM2, forceRefreshLatest }) => {
    if (!MOLIT_KEY) return errorResult("환경변수 MOLIT_API_KEY 가 설정되지 않았습니다.");
    const gu = resolveGu(district);
    if (!gu) return errorResult(`지역 '${district}' 를 찾을 수 없습니다. (예: 강남구, 분당구, 과천시, 11680, 41135)`);
    const { start, end } = resolvePeriod(startYearMonth, endYearMonth);
    if (start > end) return errorResult("시작 연월이 종료 연월보다 늦습니다.");
    if (start < 200601) return errorResult("실거래가는 2006년 1월(200601)부터 제공됩니다.");
    const months = monthRange(start, end);
    if (months.length > 300) return errorResult(`조회 범위가 너무 넓습니다(${months.length}개월).`);

    const { rows: all, failed, lastErr } = await fetchRange(DATASETS.sale, gu.code, months, forceRefreshLatest);
    if (failed === months.length) return errorResult(`모든 요청 실패: ${lastErr}`);
    let rows = all;
    if (minAreaM2 != null) rows = rows.filter((r) => r.area >= minAreaM2);
    if (maxAreaM2 != null) rows = rows.filter((r) => r.area <= maxAreaM2);
    if (!rows.length) return { content: [{ type: "text", text: `📭 조회 결과 없음 · ${gu.name}(${gu.code}) · ${start}~${end}` }] };

    const quarters = aggregateSaleQuarters(rows);
    const s = trendStats(quarters);
    const l = quarters[quarters.length - 1];
    const head = `🏙️ ${gu.name} 아파트 매매가 분기 트렌드\n` +
      `${quarters[0].분기} ~ ${l.분기} · 총 ${rows.length.toLocaleString()}건 · ${quarters.length}개 분기` +
      (failed ? ` · ⚠️ ${failed}개월 실패` : "");
    const kpi = `\n\n📈 CAGR(평당): ${s.cagr ?? "N/A"}%/년 · 변동성: ${s.volatility ?? "N/A"}%` +
      `\n최근(${l.분기}): 중위 ${l.중위가_억}억 · 평당 ${l.평당_만원}만 · ${l.거래건수}건`;
    const table = quarters.map((q) =>
      `• ${q.분기}  중위 ${q.중위가_억}억 / 평균 ${q.평균가_억}억 / 평당 ${q.평당_만원}만 / ${q.거래건수}건`).join("\n");
    return {
      content: [
        { type: "text", text: head + kpi + "\n\n" + table },
        { type: "text", text: JSON.stringify({ 자치구: gu.name, 코드: gu.code, 기간: { start, end }, 거래건수: rows.length, CAGR_평당: s.cagr, 변동성: s.volatility, 분기시계열: quarters }, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 도구 2 · get_jeonse_ratio (전세가율 = 임대수익 축)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_jeonse_ratio",
  {
    title: "수도권 전세가율 분기 추이",
    description:
      "국토부 매매+전월세 실거래가를 결합해 서울 및 경기도 시·구의 분기별 전세가율(전세 ₩/㎡ ÷ 매매 ₩/㎡)과 " +
      "월세 비중을 반환합니다. 전세가율은 갭투자·임대수익 판단의 핵심 참고 지표입니다.",
    inputSchema: {
      district: z.string().describe("지역 이름(예: '강남구', '분당구', '과천시') 또는 코드 5자리"),
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").default("202301").describe("시작 연월(YYYYMM). 전월세는 201101 이후 신뢰도↑"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월. 생략 시 이번 달"),
      forceRefreshLatest: z.boolean().optional().default(false).describe("최신 진행월(당월/전월) 데이터를 최신 일정까지 증분 업데이트할지 여부"),
    },
  },
  async ({ district, startYearMonth, endYearMonth, forceRefreshLatest }) => {
    if (!MOLIT_KEY) return errorResult("환경변수 MOLIT_API_KEY 가 설정되지 않았습니다.");
    const gu = resolveGu(district);
    if (!gu) return errorResult(`지역 '${district}' 를 찾을 수 없습니다.`);
    const { start, end } = resolvePeriod(startYearMonth, endYearMonth);
    if (start > end) return errorResult("시작 연월이 종료 연월보다 늦습니다.");
    if (start < 200601) return errorResult("실거래가는 2006년 1월(200601)부터 제공됩니다.");
    const months = monthRange(start, end);
    if (months.length > 300) return errorResult(`조회 범위가 너무 넓습니다(${months.length}개월).`);

    const [sale, rent] = await Promise.all([
      fetchRange(DATASETS.sale, gu.code, months, forceRefreshLatest),
      fetchRange(DATASETS.rent, gu.code, months, forceRefreshLatest),
    ]);
    if (sale.failed === months.length && rent.failed === months.length)
      return errorResult(`모든 요청 실패: ${sale.lastErr || rent.lastErr}`);

    // 분기별 매매/전세 ₩당(만원/㎡) 중위값 집계
    const saleQ = new Map(), jeonseQ = new Map(), wolseQ = new Map();
    for (const r of sale.rows) {
      const k = `${r.y}Q${quarterOf(r.m)}`;
      (saleQ.get(k) || saleQ.set(k, []).get(k)).push(r.amount / r.area);
    }
    for (const r of rent.rows) {
      const k = `${r.y}Q${quarterOf(r.m)}`;
      if (r.monthly > 0) (wolseQ.get(k) || wolseQ.set(k, []).get(k)).push(r);
      else (jeonseQ.get(k) || jeonseQ.set(k, []).get(k)).push(r.deposit / r.area);
    }
    const keys = [...new Set([...saleQ.keys(), ...jeonseQ.keys()])].sort();
    const quarters = keys.map((q) => {
      const saleMed = median(saleQ.get(q) || []);          // 만원/㎡
      const jeonseMed = median(jeonseQ.get(q) || []);      // 만원/㎡
      const nJeonse = (jeonseQ.get(q) || []).length;
      const nWolse = (wolseQ.get(q) || []).length;
      const ratio = Number.isFinite(saleMed) && Number.isFinite(jeonseMed) && saleMed > 0
        ? +((jeonseMed / saleMed) * 100).toFixed(1) : null;
      return {
        분기: q,
        전세가율_퍼센트: ratio,
        매매중위_평당만원: Number.isFinite(saleMed) ? +(saleMed * 3.3058).toFixed(1) : null,
        전세중위_평당만원: Number.isFinite(jeonseMed) ? +(jeonseMed * 3.3058).toFixed(1) : null,
        전세건수: nJeonse, 월세건수: nWolse,
        월세비중_퍼센트: nJeonse + nWolse ? +((nWolse / (nJeonse + nWolse)) * 100).toFixed(1) : null,
      };
    });
    const withRatio = quarters.filter((q) => q.전세가율_퍼센트 != null);
    if (!withRatio.length)
      return { content: [{ type: "text", text: `📭 전세가율 계산에 필요한 매매/전세 데이터가 부족합니다 · ${gu.name} · ${start}~${end}` }] };

    const l = withRatio[withRatio.length - 1];
    const avg = +(withRatio.reduce((a, q) => a + q.전세가율_퍼센트, 0) / withRatio.length).toFixed(1);
    const head = `🔑 ${gu.name} 전세가율 분기 추이\n${withRatio[0].분기} ~ ${l.분기} · 기간평균 ${avg}%` +
      (sale.failed || rent.failed ? ` · ⚠️ 매매${sale.failed}·전월세${rent.failed}개월 실패` : "");
    const kpi = `\n최근(${l.분기}): 전세가율 ${l.전세가율_퍼센트}% · 월세비중 ${l.월세비중_퍼센트}% · 전세 ${l.전세건수}건`;
    const table = quarters.map((q) =>
      `• ${q.분기}  전세가율 ${q.전세가율_퍼센트 ?? "-"}% · 매매 ${q.매매중위_평당만원 ?? "-"}만/평 · 전세 ${q.전세중위_평당만원 ?? "-"}만/평 · 월세비중 ${q.월세비중_퍼센트 ?? "-"}%`).join("\n");
    return {
      content: [
        { type: "text", text: head + kpi + "\n\n" + table },
        { type: "text", text: JSON.stringify({ 자치구: gu.name, 코드: gu.code, 기간: { start, end }, 기간평균_전세가율: avg, 분기시계열: quarters }, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 도구 3 · get_macro_context (한국은행 ECOS: 기준금리·주담대금리)
// ---------------------------------------------------------------------------

/** ECOS StatisticSearch 호출 → [{time, item, itemName, value}] */
async function ecosSearch({ stat, cycle, start, end, item }) {
  const seg = [
    "https://ecos.bok.or.kr/api/StatisticSearch",
    ECOS_KEY, "json", "kr", "1", "1000", stat, cycle, start, end,
  ];
  if (item) seg.push(item);
  const res = await fetch(seg.join("/"));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.RESULT) throw new Error(`ECOS: ${data.RESULT.CODE} ${data.RESULT.MESSAGE}`);
  const rows = data.StatisticSearch?.row || [];
  return rows.map((r) => ({
    time: String(r.TIME), item: String(r.ITEM_CODE1 ?? ""),
    itemName: String(r.ITEM_NAME1 ?? ""), value: Number(r.DATA_VALUE),
  }));
}

server.registerTool(
  "get_macro_context",
  {
    title: "거시 맥락: 기준금리·주택담보대출 금리",
    description:
      "한국은행 ECOS에서 기준금리와 예금은행 주택담보대출 금리(신규취급액 기준) 월별 시계열을 " +
      "반환합니다. 부동산 가격의 사이클 효과를 지역 효과와 분리해 보기 위한 오버레이 지표입니다.",
    inputSchema: {
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").default("201501").describe("시작 연월(YYYYMM)"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월. 생략 시 이번 달"),
      baseRateStat: z.string().default("722Y001").describe("기준금리 통계표코드(기본 722Y001)"),
      baseRateItem: z.string().default("0101000").describe("기준금리 항목코드(기본 0101000=한국은행 기준금리)"),
      loanStat: z.string().default("121Y006").describe("대출금리 통계표코드(기본 121Y006=예금은행 신규취급 대출금리)"),
      loanKeyword: z.string().default("주택담보").describe("대출금리 항목명 필터 키워드(기본 '주택담보')"),
    },
  },
  async ({ startYearMonth, endYearMonth, baseRateStat, baseRateItem, loanStat, loanKeyword }) => {
    if (!ECOS_KEY) return errorResult("환경변수 ECOS_API_KEY 가 설정되지 않았습니다. 한국은행 ECOS에서 발급받아 설정하세요.");
    const { start, end } = resolvePeriod(startYearMonth, endYearMonth);
    if (start > end) return errorResult("시작 연월이 종료 연월보다 늦습니다.");
    const s = String(start), e = String(end);

    // 기준금리
    let base = [];
    try { base = await ecosSearch({ stat: baseRateStat, cycle: "M", start: s, end: e, item: baseRateItem }); }
    catch (err) { return errorResult(`기준금리 조회 실패 — ${err.message}`); }

    // 주택담보대출 금리: 항목코드 대신 항목명 키워드로 필터(코드 변경에 견고)
    let loanRows = [], loanNote = "";
    try {
      const allLoan = await ecosSearch({ stat: loanStat, cycle: "M", start: s, end: e });
      loanRows = allLoan.filter((r) => r.itemName.includes(loanKeyword));
      if (!loanRows.length) loanNote = `⚠️ '${loanKeyword}' 항목을 ${loanStat}에서 찾지 못했습니다. loanStat/loanKeyword 파라미터로 조정하세요.`;
    } catch (err) { loanNote = `⚠️ 대출금리 조회 실패: ${err.message}`; }

    // 월별 병합
    const map = new Map();
    for (const r of base) map.set(r.time, { 월: r.time, 기준금리: r.value });
    for (const r of loanRows) {
      const cur = map.get(r.time) || { 월: r.time };
      cur.주담대금리 = r.value; map.set(r.time, cur);
    }
    const series = [...map.values()].sort((a, b) => a.월.localeCompare(b.월));
    if (!series.length) return errorResult("조회 결과가 없습니다. 기간·통계코드를 확인하세요.");

    const last = series[series.length - 1], first = series[0];
    const fmtM = (t) => `${t.slice(0, 4)}.${t.slice(4)}`;
    const head = `💰 거시 맥락 · ${fmtM(first.월)} ~ ${fmtM(last.월)}` + (loanNote ? `\n${loanNote}` : "");
    const kpi =
      `\n최근(${fmtM(last.월)}): 기준금리 ${last.기준금리 ?? "-"}% · 주담대금리 ${last.주담대금리 ?? "-"}%` +
      `\n시작(${fmtM(first.월)}): 기준금리 ${first.기준금리 ?? "-"}% · 주담대금리 ${first.주담대금리 ?? "-"}%`;
    // 표는 분기 말(3·6·9·12월)만 축약 표기
    const table = series.filter((r) => ["03", "06", "09", "12"].includes(r.월.slice(4)))
      .map((r) => `• ${fmtM(r.월)}  기준 ${r.기준금리 ?? "-"}% · 주담대 ${r.주담대금리 ?? "-"}%`).join("\n");
    return {
      content: [
        { type: "text", text: head + kpi + "\n\n(분기 말 표기)\n" + table },
        { type: "text", text: JSON.stringify({ 기간: { start, end }, 월별시계열: series }, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 파일 기반 데이터 유틸 (범죄·생활인구는 벌크 CSV)
//   - 경찰청 범죄 지역별 통계: 연 단위 CSV(자치구가 컬럼), 보통 CP949
//   - 자치구 생활인구: LOCAL_PEOPLE_GU_YYYY 일별 CSV, 보통 UTF-8
//   두 파일 모두 컬럼명이 버전마다 달라 "헤더 자동 감지"로 처리한다.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, "data");

/** 인코딩 자동 감지(UTF-8 우선, 깨지면 EUC-KR) 후 CSV 파싱 */
function readCsvSmart(file) {
  const buf = fs.readFileSync(file);
  let text = new TextDecoder("utf-8").decode(buf);
  if ((text.match(/�/g) || []).length > 5) {
    try { text = new TextDecoder("euc-kr").decode(buf); } catch { /* ICU 미탑재 시 UTF-8 유지 */ }
  }
  return parseCsv(text);
}

/** 따옴표·콤마를 처리하는 간단한 CSV 파서 → {header, rows} */
function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length);
  const parseLine = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = lines.length ? parseLine(lines[0]) : [];
  const rows = lines.slice(1).map(parseLine);
  return { header, rows };
}

const norm = (s) => String(s).replace(/\s|서울특별시|서울|경기도|경기/g, "");
const listCsv = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(dir, f)); }
  catch { return []; }
};
const yearFromName = (f) => { const m = path.basename(f).match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };

// 수도권(서울 25개 구 + 경기 시·군/구) 인구(2024년 주민등록인구 근사값, 명) — 범죄율 정규화용
const REGION_POP_2024 = {
  // 서울 25개 자치구
  종로구: 140000, 중구: 120000, 용산구: 210000, 성동구: 280000, 광진구: 340000,
  동대문구: 340000, 중랑구: 380000, 성북구: 420000, 강북구: 290000, 도봉구: 300000,
  노원구: 490000, 은평구: 460000, 서대문구: 300000, 마포구: 360000, 양천구: 430000,
  강서구: 560000, 구로구: 400000, 금천구: 230000, 영등포구: 380000, 동작구: 380000,
  관악구: 490000, 서초구: 410000, 강남구: 530000, 송파구: 650000, 강동구: 460000,
  // 경기도 주요 시·군 및 일반구
  "수원시 장안구": 270000, "수원시 권선구": 360000, "수원시 팔달구": 190000, "수원시 영통구": 360000, 수원시: 1180000,
  "성남시 수정구": 230000, "성남시 중원구": 210000, "성남시 분당구": 470000, 분당구: 470000, 성남시: 910000,
  "안양시 만안구": 230000, "안양시 동안구": 310000, 동안구: 310000, 안양시: 540000,
  "안산시 상록구": 340000, "안산시 단원구": 290000, 안산시: 630000,
  "고양시 덕양구": 490000, "고양시 일산동구": 290000, "고양시 일산서구": 280000, 일산동구: 290000, 일산서구: 280000, 고양시: 1060000,
  "용인시 처인구": 260000, "용인시 기흥구": 430000, "용인시 수지구": 370000, 수지구: 370000, 용인시: 1060000,
  과천시: 84000, 광명시: 280000, 하남시: 330000, 화성시: 960000, 부천시: 780000,
  남양주시: 730000, 평택시: 590000, 시흥시: 520000, 파주시: 500000, 김포시: 490000,
  의정부시: 460000, 광주시: 400000, 군포시: 260000, 오산시: 240000, 양주시: 270000,
  이천시: 220000, 구리시: 190000, 안성시: 190000, 의왕시: 160000, 포천시: 140000,
  양평군: 120000, 여주시: 110000, 동두천시: 90000, 가평군: 60000, 연천군: 40000,
};
const GU_POP_2024 = REGION_POP_2024;
const CRIME5 = ["살인", "강도", "강간", "추행", "절도", "폭력"];

// ---------------------------------------------------------------------------
// 도구 4 · get_crime_rate (범죄율 · 파일 기반)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_crime_rate",
  {
    title: "자치구 5대 범죄율",
    description:
      "경찰청 '범죄 발생 지역별 통계' CSV(자치구별 컬럼)를 읽어 자치구별 5대 범죄 발생건수와 " +
      "인구 1천명당 범죄율을 반환합니다. data/crime/ 폴더에 연도별 CSV를 두어야 합니다.",
    inputSchema: {
      district: z.string().optional().describe("자치구 이름/코드(생략 시 25개 구 전체)"),
      year: z.number().optional().describe("조회 연도(생략 시 폴더의 모든 연도)"),
      allCategories: z.boolean().default(false).describe("true면 5대범죄가 아닌 전체 범죄 합산"),
      populationOverride: z.record(z.number()).optional().describe("자치구별 인구 수동 지정 {구이름:인구}"),
    },
  },
  async ({ district, year, allCategories, populationOverride }) => {
    const files = listCsv(path.join(DATA_DIR, "crime"));
    if (!files.length) {
      return errorResult(
        "data/crime/ 폴더에 CSV가 없습니다. 공공데이터포털 '경찰청_범죄 발생 지역별 통계'의 " +
        "연도별 CSV를 내려받아 data/crime/2024.csv 처럼 저장하세요."
      );
    }
    const pop = { ...GU_POP_2024, ...(populationOverride || {}) };
    const gu = district ? resolveGu(district) : null;
    if (district && !gu) return errorResult(`자치구 '${district}' 를 찾을 수 없습니다.`);

    const results = [];
    for (const file of files) {
      const fy = yearFromName(file);
      if (year && fy && fy !== year) continue;
      let header, rows;
      try { ({ header, rows } = readCsvSmart(file)); }
      catch (e) { results.push({ 연도: fy, 오류: `읽기 실패: ${e.message}` }); continue; }

      // 자치구 컬럼 매핑: 헤더 셀을 정규화해 25개 구 이름과 매칭
      const guCols = {}; // guName -> colIndex
      header.forEach((h, i) => {
        const nh = norm(h);
        for (const name of Object.keys(SEOUL_GU)) if (nh === norm(name)) guCols[name] = i;
      });
      if (!Object.keys(guCols).length) {
        results.push({ 연도: fy, 오류: "자치구 컬럼을 찾지 못했습니다(헤더 형식 확인)." });
        continue;
      }
      // 범죄 분류 컬럼(대/중분류)은 앞쪽 문자열 컬럼으로 가정 → 5대범죄 필터에 사용
      const catCols = header.map((h, i) => ({ h, i })).filter(({ h }) => /분류|죄종|구분/.test(h)).map((x) => x.i);

      const sums = {}; // guName -> count
      for (const gname of Object.keys(guCols)) sums[gname] = 0;
      for (const row of rows) {
        if (!allCategories) {
          const catText = catCols.map((i) => row[i] || "").join(" ") || row.slice(0, 2).join(" ");
          if (!CRIME5.some((k) => catText.includes(k))) continue;
        }
        for (const [gname, ci] of Object.entries(guCols)) {
          const v = Number(String(row[ci] || "").replace(/[,\s]/g, ""));
          if (Number.isFinite(v)) sums[gname] += v;
        }
      }
      const targets = gu ? [gu.name] : Object.keys(SEOUL_GU);
      const perGu = targets.map((gname) => {
        const cnt = sums[gname] ?? 0;
        const p = pop[gname];
        return { 자치구: gname, 범죄건수: cnt, 인구: p, 범죄율_천명당: p ? +((cnt / p) * 1000).toFixed(2) : null };
      }).sort((a, b) => (b.범죄율_천명당 ?? 0) - (a.범죄율_천명당 ?? 0));
      results.push({ 연도: fy, 기준: allCategories ? "전체범죄" : "5대범죄", 자치구별: perGu });
    }
    if (!results.length) return errorResult(`연도 ${year} 에 해당하는 CSV를 찾지 못했습니다.`);

    const lines = results.flatMap((r) => {
      if (r.오류) return [`[${r.연도}] ⚠️ ${r.오류}`];
      const top = r.자치구별.slice(0, gu ? 1 : 5)
        .map((g) => `   ${g.자치구} ${g.범죄율_천명당 ?? "-"}건/천명 (${g.범죄건수.toLocaleString()}건)`);
      return [`📊 ${r.연도}년 ${r.기준} 범죄율${gu ? "" : " (상위 5개 구)"}`, ...top];
    });
    return {
      content: [
        { type: "text", text: lines.join("\n") + "\n\n※ 인구는 2024년 근사값 기준. 정확도가 필요하면 populationOverride 사용." },
        { type: "text", text: JSON.stringify(results, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 도구 5 · get_living_population (유동인구/생활인구 · 파일 기반)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_living_population",
  {
    title: "자치구 생활인구(유동인구) 월별 추이",
    description:
      "서울시 '자치구 단위 생활인구(내국인)' CSV를 읽어 자치구별 월평균 총생활인구와 증감 추세를 " +
      "반환합니다. data/living_pop/ 폴더에 LOCAL_PEOPLE_GU_YYYY.csv 를 두어야 합니다.",
    inputSchema: {
      district: z.string().optional().describe("자치구 이름/코드(생략 시 25개 구 전체 요약)"),
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("시작 연월(생략 시 전체)"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월(생략 시 전체)"),
    },
  },
  async ({ district, startYearMonth, endYearMonth }) => {
    const files = listCsv(path.join(DATA_DIR, "living_pop"));
    if (!files.length) {
      return errorResult(
        "data/living_pop/ 폴더에 CSV가 없습니다. 서울 열린데이터광장 '자치구 단위 서울 생활인구(내국인)' " +
        "(LOCAL_PEOPLE_GU_YYYY)를 내려받아 data/living_pop/ 에 저장하세요."
      );
    }
    const gu = district ? resolveGu(district) : null;
    if (district && !gu) return errorResult(`자치구 '${district}' 를 찾을 수 없습니다.`);
    const from = startYearMonth ? Number(startYearMonth) : null;
    const to = endYearMonth ? Number(endYearMonth) : null;

    // guName -> Map(YYYYMM -> {sum, n})
    const agg = new Map();
    let scanned = 0, matchedCols = false;
    for (const file of files) {
      let header, rows;
      try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      // 컬럼 자동 감지
      const find = (re) => header.findIndex((h) => re.test(h));
      const iDate = find(/기준일|일자|날짜|date/i);
      const iGu = find(/자치구코드|자치구|구코드|gu/i);
      const iPop = find(/총생활인구|생활인구수|인구수|population/i);
      if (iDate < 0 || iGu < 0 || iPop < 0) continue;
      matchedCols = true;
      for (const row of rows) {
        const dRaw = String(row[iDate] || "");
        const ym = Number(dRaw.slice(0, 6));
        if (!ym) continue;
        if (from && ym < from) continue;
        if (to && ym > to) continue;
        const guRaw = String(row[iGu] || "").trim();
        const gname = CODE_TO_GU[guRaw] || (Object.keys(SEOUL_GU).find((n) => norm(n) === norm(guRaw)));
        if (!gname) continue;
        const v = Number(String(row[iPop] || "").replace(/[,\s]/g, ""));
        if (!Number.isFinite(v)) continue;
        if (!agg.has(gname)) agg.set(gname, new Map());
        const mm = agg.get(gname);
        const cur = mm.get(ym) || { sum: 0, n: 0 };
        cur.sum += v; cur.n++; mm.set(ym, cur);
        scanned++;
      }
    }
    if (!matchedCols) return errorResult("CSV에서 날짜·자치구코드·총생활인구 컬럼을 찾지 못했습니다(헤더 확인).");
    if (!scanned) return errorResult("조건에 맞는 데이터가 없습니다(기간·자치구 확인).");

    const buildSeries = (gname) => {
      const mm = agg.get(gname); if (!mm) return null;
      const series = [...mm.entries()].sort((a, b) => a[0] - b[0])
        .map(([ym, v]) => ({ 월: `${String(ym).slice(0, 4)}.${String(ym).slice(4)}`, 월평균생활인구: Math.round(v.sum / v.n) }));
      const f = series[0], l = series[series.length - 1];
      const growth = series.length > 1 ? +(((l.월평균생활인구 / f.월평균생활인구) - 1) * 100).toFixed(1) : null;
      return { 자치구: gname, 시작: f.월, 종료: l.월, 증감률_퍼센트: growth, 최근_월평균: l.월평균생활인구, 시계열: series };
    };

    if (gu) {
      const s = buildSeries(gu.name);
      if (!s) return errorResult(`${gu.name} 데이터가 없습니다.`);
      const table = s.시계열.map((r) => `• ${r.월}  ${r.월평균생활인구.toLocaleString()}명`).join("\n");
      return {
        content: [
          { type: "text", text: `👥 ${gu.name} 생활인구 월별 추이\n${s.시작} ~ ${s.종료} · 증감 ${s.증감률_퍼센트 ?? "N/A"}%\n\n${table}` },
          { type: "text", text: JSON.stringify(s, null, 2) },
        ],
      };
    }
    // 전체 구 요약(증감률 순)
    const all = Object.keys(SEOUL_GU).map(buildSeries).filter(Boolean)
      .sort((a, b) => (b.증감률_퍼센트 ?? -999) - (a.증감률_퍼센트 ?? -999));
    const lines = all.map((s) => `• ${s.자치구}  ${s.최근_월평균.toLocaleString()}명 · 증감 ${s.증감률_퍼센트 ?? "-"}%`);
    return {
      content: [
        { type: "text", text: `👥 자치구별 생활인구 (${all[0]?.시작}~${all[0]?.종료}, 증감률 순)\n\n${lines.join("\n")}` },
        { type: "text", text: JSON.stringify(all.map(({ 시계열, ...rest }) => rest), null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 도구 6 · get_school_index (학군 · NEIS 학교기본정보 REST)
// ---------------------------------------------------------------------------

const NEIS_KEY = process.env.NEIS_API_KEY;
const NEIS_URL = "https://open.neis.go.kr/hub/schoolInfo";
// 자율형사립고·특목고 등을 폭넓게 잡는 키워드(필드명이 버전마다 달라 값 전체를 스캔)
const SPECIAL_HS = ["자율", "특수목적", "외국어", "과학", "국제", "영재", "예술", "체육"];

async function neisSchoolPage(pIndex, lctnScNm = "서울특별시") {
  const params = new URLSearchParams({
    KEY: NEIS_KEY, Type: "json", pIndex: String(pIndex), pSize: "1000",
    SCHUL_KND_SC_NM: "고등학교", LCTN_SC_NM: lctnScNm,
  });
  const res = await fetch(`${NEIS_URL}?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.RESULT) throw new Error(`NEIS: ${data.RESULT.CODE} ${data.RESULT.MESSAGE}`);
  const blocks = data.schoolInfo;
  if (!blocks) return { rows: [], total: 0 };
  const head = blocks[0]?.head || [];
  const total = Number(head.find((h) => h.list_total_count)?.list_total_count ?? 0);
  const rows = blocks[1]?.row || [];
  return { rows, total };
}

async function fetchSchoolsForProvince(province = "seoul") {
  const lctnScNm = province === "gyeonggi" ? "경기도" : "서울특별시";
  const now = new Date();
  const currentQuarterKey = `${now.getFullYear()}Q${quarterOf(now.getMonth() + 1)}`;
  const schoolCacheDir = path.join(CACHE_DIR, "school-index");
  const schoolCacheFile = path.join(schoolCacheDir, `${currentQuarterKey}_${province}.json`);

  let rows = [];
  if (fs.existsSync(schoolCacheFile)) {
    try { rows = JSON.parse(fs.readFileSync(schoolCacheFile, "utf8")); }
    catch { rows = []; }
  }

  if (!rows.length) {
    const first = await neisSchoolPage(1, lctnScNm);
    rows = first.rows;
    const pages = Math.ceil(first.total / 1000);
    for (let p = 2; p <= pages; p++) rows = rows.concat((await neisSchoolPage(p, lctnScNm)).rows);
    if (rows.length) {
      fs.mkdirSync(schoolCacheDir, { recursive: true });
      fs.writeFileSync(schoolCacheFile, JSON.stringify(rows));
    }
  }
  return rows;
}

server.registerTool(
  "get_school_index",
  {
    title: "수도권 학군 지수(자사·특목고 밀도 및 학교 분석)",
    description:
      "check_schools.js 및 NEIS 학교기본정보를 결합하여 서울 및 경기도 시·구별 고등학교 수와 자율·특목고 수를 집계해 학군 지수(proxy)를 " +
      "반환하고 세부 학교 정보를 연동 제공합니다. '서울대 진학률'은 비공개라 자율·특목고 밀도로 근사합니다.",
    inputSchema: {
      district: z.string().optional().describe("자치구/시·군 이름/코드(예: '강남구', '분당구', '과천시')"),
      regionScope: z.enum(["서울", "경기", "수도권전체"]).default("서울").describe("district 생략 시 랭킹 범위(서울/경기/수도권전체)"),
    },
  },
  async ({ district, regionScope }) => {
    const gu = district ? resolveGu(district) : null;
    if (district && !gu) return errorResult(`지역 '${district}' 를 찾을 수 없습니다.`);

    // 1. 단일 자치구 조회 시 check_schools.js의 상세 학군 데이터 우선 연동
    if (gu) {
      try {
        const provinceNm = gu.province === "gyeonggi" ? "경기도" : "서울특별시";
        const districtSchoolData = await getDistrictHighSchoolsData({ district: gu.name, province: provinceNm });
        if (districtSchoolData && !districtSchoolData.isError) {
          const detailParsed = JSON.parse(districtSchoolData.content[1]?.text || "{}");
          const counts = detailParsed.counts || {};
          const specCnt = (counts.specialized || 0) + (counts.autonomous || 0);
          const totCnt = detailParsed.total_schools || 0;
          const schoolIndex = specCnt * 3 + (totCnt - specCnt);
          const specialNames = [
            ...(detailParsed.schools?.specialized || []).map((s) => s.name),
            ...(detailParsed.schools?.autonomous || []).map((s) => s.name),
          ];

          const payload = {
            지역: gu.name,
            시도: provinceNm,
            고교수: totCnt,
            자율특목고수: specCnt,
            학군지수: schoolIndex,
            자율특목고: specialNames,
            상세학군분류: counts,
            데이터출처: "check_schools.js (schoolinfo-mcp & NEIS 연동)",
          };

          return {
            content: [
              {
                type: "text",
                text:
                  `🎓 [${gu.name}] 학군 분석 리포트 (check_schools 연동)\n` +
                  `• 총 고등학교: ${totCnt}개교 (특목고 ${counts.specialized || 0}개교, 자율고 ${counts.autonomous || 0}개교, 일반고 ${counts.general || 0}개교)\n` +
                  `• 학군 지수: ${schoolIndex}점 (자사·특목고 가중치 적용)\n` +
                  (specialNames.length ? `• 주요 명문/특목·자율고: ${specialNames.join(", ")}` : "• 특목/자율고 없음"),
              },
              { type: "text", text: JSON.stringify(payload, null, 2) },
            ],
          };
        }
      } catch {
        // 폴백으로 진행
      }
    }

    if (!NEIS_KEY) return errorResult("환경변수 NEIS_API_KEY 가 설정되지 않았습니다. open.neis.go.kr 에서 발급하세요.");

    const targetProvince = gu ? gu.province : (regionScope === "경기" ? "gyeonggi" : regionScope === "수도권전체" ? "all" : "seoul");

    let rows = [];
    try {
      if (targetProvince === "all") {
        const [sRows, gRows] = await Promise.all([fetchSchoolsForProvince("seoul"), fetchSchoolsForProvince("gyeonggi")]);
        rows = [...sRows, ...gRows];
      } else {
        rows = await fetchSchoolsForProvince(targetProvince);
      }
    } catch (e) {
      return errorResult(`NEIS 조회 실패 — ${e.message}`);
    }
    if (!rows.length) return errorResult("NEIS에서 학교 목록을 받지 못했습니다.");

    // 대상 구 집합 결정
    const targetGuNames = gu
      ? [gu.name]
      : (targetProvince === "gyeonggi"
          ? Object.keys(CANONICAL_REGIONS).filter((k) => CANONICAL_REGIONS[k].startsWith("41"))
          : targetProvince === "all"
          ? Object.keys(CANONICAL_REGIONS)
          : Object.keys(SEOUL_GU));

    // 시·구별 집계
    const stat = {};
    for (const name of targetGuNames) stat[name] = { total: 0, special: 0, schools: [] };

    // 정밀 매칭을 위해 이름 긴 순서로 정렬된 지역 키 목록
    const matchKeys = [...targetGuNames].sort((a, b) => b.length - a.length);

    for (const r of rows) {
      const addr = String(r.ORG_RDNMA ?? r.ORG_RDNZC ?? "");
      const matchedName = matchKeys.find((n) => addr.includes(n) || (n.includes(" ") && addr.includes(n.split(" ")[1])));
      if (!matchedName || !stat[matchedName]) continue;
      const blob = Object.values(r).map(String).join(" ");
      const isSpecial = SPECIAL_HS.some((k) => blob.includes(k)) && !blob.includes("특성화");
      stat[matchedName].total++;
      if (isSpecial) { stat[matchedName].special++; stat[matchedName].schools.push(String(r.SCHUL_NM ?? "")); }
    }

    const build = (name) => {
      const s = stat[name] || { total: 0, special: 0, schools: [] };
      const index = s.special * 3 + (s.total - s.special);
      return { 지역: name, 고교수: s.total, 자율특목고수: s.special, 학군지수: index, 자율특목고: s.schools };
    };

    if (gu) {
      const s = build(gu.name);
      return {
        content: [
          { type: "text", text: `🎓 ${gu.name} 학군 지수\n고등학교 ${s.고교수}개 · 자율/특목고 ${s.자율특목고수}개 · 학군지수 ${s.학군지수}` +
            (s.자율특목고.length ? `\n자율·특목: ${s.자율특목고.join(", ")}` : "") },
          { type: "text", text: JSON.stringify(s, null, 2) },
        ],
      };
    }

    const all = targetGuNames.map(build).filter((s) => s.고교수 > 0).sort((a, b) => b.학군지수 - a.학군지수);
    const lines = all.map((s, i) => `${String(i + 1).padStart(2)}. ${s.지역.padEnd(8)}  지수 ${s.학군지수} (고교 ${s.고교수} · 자율특목 ${s.자율특목고수})`);
    return {
      content: [
        { type: "text", text: `🎓 수도권 학군 지수 순위 (${regionScope}, 자율·특목고 밀도 기준 · check_schools 연동)\n\n${lines.join("\n")}` },
        { type: "text", text: JSON.stringify(all.map(({ 자율특목고, ...r }) => r), null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 도구 7 · get_region_income (소득 · 파일 기반, KOSIS/국세청 CSV)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_region_income",
  {
    title: "자치구 평균 소득",
    description:
      "KOSIS/국세청에서 내려받은 시군구 소득 CSV(data/income/)를 읽어 자치구별 소득과 연도별 추이를 " +
      "반환합니다. wide(연도가 컬럼)·long(소득/연도 컬럼) 포맷을 자동 감지합니다.",
    inputSchema: {
      district: z.string().optional().describe("자치구 이름/코드(생략 시 25개 구)"),
      year: z.number().optional().describe("특정 연도(생략 시 전체 연도)"),
    },
  },
  async ({ district, year }) => {
    const files = listCsv(path.join(DATA_DIR, "income"));
    if (!files.length) {
      return errorResult(
        "data/income/ 폴더에 CSV가 없습니다. KOSIS 'e-지방지표 1인당 개인소득' 또는 국세청 시군구 소득 통계를 " +
        "CSV로 내려받아 data/income/ 에 저장하세요."
      );
    }
    const gu = district ? resolveGu(district) : null;
    if (district && !gu) return errorResult(`자치구 '${district}' 를 찾을 수 없습니다.`);

    // guName -> {year -> value}
    const agg = new Map();
    let matched = false, unit = "";
    for (const file of files) {
      let header, rows;
      try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      const iRegion = header.findIndex((h) => /지역|시군구|행정구역|자치구|구분|권역/.test(h) && !/소득/.test(h));
      if (iRegion < 0) continue;
      const yearCols = header.map((h, i) => ({ y: (h.match(/(19|20)\d{2}/) || [])[0], i }))
        .filter((x) => x.y).map((x) => ({ year: Number(x.y), i: x.i }));
      const iIncome = header.findIndex((h) => /소득|income|금액|소득액/.test(h));
      const iYear = header.findIndex((h) => /연도|년도|시점|기간|year/i.test(h));
      const fileYear = yearFromName(file);

      for (const row of rows) {
        const gname = Object.keys(SEOUL_GU).find((n) => norm(row[iRegion] || "") === norm(n) || String(row[iRegion] || "").includes(n));
        if (!gname) continue;
        matched = true;
        if (yearCols.length) {                       // wide: 연도별 컬럼
          for (const yc of yearCols) {
            const v = Number(String(row[yc.i] || "").replace(/[,\s]/g, ""));
            if (Number.isFinite(v) && v !== 0) setInc(agg, gname, yc.year, v);
          }
        } else if (iIncome >= 0) {                    // long: 소득 + (연도)
          const v = Number(String(row[iIncome] || "").replace(/[,\s]/g, ""));
          const y = iYear >= 0 ? Number(String(row[iYear]).match(/(19|20)\d{2}/)?.[0]) : fileYear;
          if (Number.isFinite(v) && y) setInc(agg, gname, y, v);
        }
      }
    }
    if (!matched) return errorResult("CSV에서 자치구 행을 찾지 못했습니다(지역 컬럼·자치구명 확인).");

    const build = (name) => {
      const m = agg.get(name); if (!m) return null;
      let series = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([y, v]) => ({ 연도: y, 소득: v }));
      if (year) series = series.filter((s) => s.연도 === year);
      if (!series.length) return null;
      const l = series[series.length - 1], f = series[0];
      const growth = series.length > 1 ? +(((l.소득 / f.소득) - 1) * 100).toFixed(1) : null;
      return { 자치구: name, 최근연도: l.연도, 최근소득: l.소득, 증감률_퍼센트: growth, 시계열: series };
    };

    if (gu) {
      const s = build(gu.name);
      if (!s) return errorResult(`${gu.name} 소득 데이터가 없습니다.`);
      const table = s.시계열.map((r) => `• ${r.연도}  ${r.소득.toLocaleString()}`).join("\n");
      return {
        content: [
          { type: "text", text: `💵 ${gu.name} 소득 추이\n최근 ${s.최근연도}년: ${s.최근소득.toLocaleString()}` + (s.증감률_퍼센트 != null ? ` · 증감 ${s.증감률_퍼센트}%` : "") + `\n\n${table}` },
          { type: "text", text: JSON.stringify(s, null, 2) },
        ],
      };
    }
    const all = Object.keys(SEOUL_GU).map(build).filter(Boolean).sort((a, b) => b.최근소득 - a.최근소득);
    const lines = all.map((s, i) => `${String(i + 1).padStart(2)}. ${s.자치구}  ${s.최근소득.toLocaleString()} (${s.최근연도})`);
    return {
      content: [
        { type: "text", text: `💵 자치구 소득 순위 (최근연도 기준)\n\n${lines.join("\n")}` },
        { type: "text", text: JSON.stringify(all.map(({ 시계열, ...r }) => r), null, 2) },
      ],
    };
  }
);
function setInc(agg, gname, y, v) {
  if (!agg.has(gname)) agg.set(gname, new Map());
  agg.get(gname).set(y, v);
}

// ---------------------------------------------------------------------------
// 도구 8 · get_district_score (종합 스코어 오케스트레이터)
//   7개 지표를 자치구 간 0~100 정규화 후 가중합 → 종합 순위.
//   가용한 지표만 사용하고(그래이스풀 디그레이드) 커버리지를 표기한다.
//   ⚠️ 투자 조언 아님 — 가중치는 사용자 입력으로 노출.
// ---------------------------------------------------------------------------

// 지표 정의: key, 라벨, 역방향 여부(낮을수록 좋음), 기본 가중치
const SCORE_METRICS = [
  { key: "price", label: "가격상승", invert: false, w: 0.25 },
  { key: "jeonse", label: "전세가율", invert: false, w: 0.15 },
  { key: "living", label: "유동인구", invert: false, w: 0.15 },
  { key: "income", label: "소득", invert: false, w: 0.15 },
  { key: "school", label: "학군", invert: false, w: 0.15 },
  { key: "crime", label: "범죄(역)", invert: true, w: 0.15 },
];

/** [{gu,v}] → Map(gu→0~100). invert면 낮을수록 고득점. 값 없으면 제외. */
function minMax(entries, invert) {
  const vals = entries.filter((e) => e.v != null && Number.isFinite(e.v)).map((e) => e.v);
  const out = new Map();
  if (!vals.length) return out;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  for (const e of entries) {
    if (e.v == null || !Number.isFinite(e.v)) continue;
    let s = span === 0 ? 50 : ((e.v - min) / span) * 100;
    if (invert) s = 100 - s;
    out.set(e.gu, +s.toFixed(1));
  }
  return out;
}

// ---- 지표 수집기(가용한 소스만; 실패 시 null) ----
async function collectPrice(codes, months) {
  if (!MOLIT_KEY) return null;
  const m = new Map();
  await pool(codes, 4, async ({ code, name }) => {
    try {
      const { rows } = await fetchRange(DATASETS.sale, code, months);
      if (!rows.length) return;
      const s = trendStats(aggregateSaleQuarters(rows));
      if (s.cagr != null) m.set(name, s.cagr);
    } catch { /* 개별 구 실패 무시 */ }
  });
  return m.size ? m : null;
}
async function collectJeonse(codes, months) {
  if (!MOLIT_KEY) return null;
  const m = new Map();
  await pool(codes, 4, async ({ code, name }) => {
    try {
      const [sale, rent] = await Promise.all([
        fetchRange(DATASETS.sale, code, months), fetchRange(DATASETS.rent, code, months),
      ]);
      const sMed = median(sale.rows.map((r) => r.amount / r.area));
      const jMed = median(rent.rows.filter((r) => r.monthly === 0).map((r) => r.deposit / r.area));
      if (Number.isFinite(sMed) && Number.isFinite(jMed) && sMed > 0) m.set(name, (jMed / sMed) * 100);
    } catch { /* 무시 */ }
  });
  return m.size ? m : null;
}
async function collectSchool(targets) {
  if (!NEIS_KEY) return null;
  try {
    const hasGyeonggi = targets ? targets.some((t) => t.code && t.code.startsWith("41")) : true;
    const hasSeoul = targets ? targets.some((t) => t.code && t.code.startsWith("11")) : true;

    let rows = [];
    if (hasSeoul && hasGyeonggi) {
      const [s, g] = await Promise.all([fetchSchoolsForProvince("seoul"), fetchSchoolsForProvince("gyeonggi")]);
      rows = [...s, ...g];
    } else if (hasGyeonggi) {
      rows = await fetchSchoolsForProvince("gyeonggi");
    } else {
      rows = await fetchSchoolsForProvince("seoul");
    }

    const targetNames = targets ? targets.map((t) => t.name) : Object.keys(SEOUL_GU);
    const acc = {};
    for (const n of targetNames) acc[n] = { t: 0, s: 0 };

    const matchKeys = [...targetNames].sort((a, b) => b.length - a.length);
    for (const r of rows) {
      const addr = String(r.ORG_RDNMA ?? r.ORG_RDNZC ?? "");
      const matchedName = matchKeys.find((n) => addr.includes(n) || (n.includes(" ") && addr.includes(n.split(" ")[1])));
      if (!matchedName || !acc[matchedName]) continue;
      const blob = Object.values(r).map(String).join(" ");
      acc[matchedName].t++;
      if (SPECIAL_HS.some((k) => blob.includes(k)) && !blob.includes("특성화")) acc[matchedName].s++;
    }
    const m = new Map();
    for (const [g, v] of Object.entries(acc)) if (v.t) m.set(g, v.s * 3 + (v.t - v.s));
    return m.size ? m : null;
  } catch { return null; }
}
function collectCrime(year, pop, targetNames) {
  const files = listCsv(path.join(DATA_DIR, "crime"));
  if (!files.length) return null;
  const file = files.find((f) => year && yearFromName(f) === year) || files.sort((a, b) => (yearFromName(b) || 0) - (yearFromName(a) || 0))[0];
  let header, rows;
  try { ({ header, rows } = readCsvSmart(file)); } catch { return null; }
  const guCols = {};
  const names = targetNames || Object.keys(CANONICAL_REGIONS);
  header.forEach((h, i) => {
    const nh = norm(h);
    for (const n of names) if (nh === norm(n) || nh.includes(norm(n))) guCols[n] = i;
  });
  if (!Object.keys(guCols).length) return null;
  const catCols = header.map((h, i) => ({ h, i })).filter(({ h }) => /분류|죄종|구분/.test(h)).map((x) => x.i);
  const sums = {}; for (const g of Object.keys(guCols)) sums[g] = 0;
  for (const row of rows) {
    const ct = catCols.map((i) => row[i] || "").join(" ");
    if (!CRIME5.some((k) => ct.includes(k))) continue;
    for (const [g, ci] of Object.entries(guCols)) {
      const v = Number(String(row[ci] || "").replace(/[,\s]/g, "")); if (Number.isFinite(v)) sums[g] += v;
    }
  }
  const m = new Map();
  for (const [g, cnt] of Object.entries(sums)) if (pop[g]) m.set(g, (cnt / pop[g]) * 1000);
  return m.size ? m : null;
}
function collectFromCsvMap(sub, valueOf) {
  const files = listCsv(path.join(DATA_DIR, sub));
  if (!files.length) return null;
  const m = valueOf(files);
  return m && m.size ? m : null;
}
function collectIncome(year, targetNames) {
  const names = targetNames || Object.keys(CANONICAL_REGIONS);
  return collectFromCsvMap("income", (files) => {
    const latest = new Map(); // gu -> {year, v}
    for (const file of files) {
      let header, rows; try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      const iR = header.findIndex((h) => /지역|시군구|행정구역|자치구|구분|권역/.test(h) && !/소득/.test(h));
      if (iR < 0) continue;
      const yc = header.map((h, i) => ({ y: (h.match(/(19|20)\d{2}/) || [])[0], i })).filter((x) => x.y).map((x) => ({ year: +x.y, i: x.i }));
      const iInc = header.findIndex((h) => /소득|금액/.test(h)), iY = header.findIndex((h) => /연도|년도|시점|기간|year/i.test(h));
      for (const row of rows) {
        const g = names.find((n) => norm(row[iR] || "") === norm(n) || String(row[iR] || "").includes(n));
        if (!g) continue;
        const push = (y, v) => { if (!year || y === year) { const c = latest.get(g); if (!c || y >= c.year) latest.set(g, { year: y, v }); } };
        if (yc.length) for (const x of yc) { const v = Number(String(row[x.i] || "").replace(/[,\s]/g, "")); if (v) push(x.year, v); }
        else if (iInc >= 0) { const v = Number(String(row[iInc] || "").replace(/[,\s]/g, "")); const y = iY >= 0 ? Number(String(row[iY]).match(/(19|20)\d{2}/)?.[0]) : yearFromName(file); if (v && y) push(y, v); }
      }
    }
    const m = new Map(); for (const [g, o] of latest) m.set(g, o.v); return m;
  });
}
function collectLiving(from, to, targetNames) {
  const names = targetNames || Object.keys(CANONICAL_REGIONS);
  return collectFromCsvMap("living_pop", (files) => {
    const agg = new Map(); // gu -> Map(ym->{sum,n})
    for (const file of files) {
      let header, rows; try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      const iD = header.findIndex((h) => /기준일|일자|날짜|date/i.test(h));
      const iG = header.findIndex((h) => /자치구코드|자치구|시군구코드|구코드|시군|gu/i.test(h));
      const iP = header.findIndex((h) => /총생활인구|생활인구수|인구수|population/i.test(h));
      if (iD < 0 || iG < 0 || iP < 0) continue;
      for (const row of rows) {
        const ym = Number(String(row[iD] || "").slice(0, 6)); if (!ym) continue;
        if (from && ym < from) continue; if (to && ym > to) continue;
        const guRaw = String(row[iG] || "").trim();
        const g = CODE_TO_GU[guRaw] || names.find((n) => norm(n) === norm(guRaw) || guRaw.includes(n));
        if (!g) continue;
        const v = Number(String(row[iP] || "").replace(/[,\s]/g, "")); if (!Number.isFinite(v)) continue;
        if (!agg.has(g)) agg.set(g, new Map());
        const mm = agg.get(g), c = mm.get(ym) || { sum: 0, n: 0 }; c.sum += v; c.n++; mm.set(ym, c);
      }
    }
    const m = new Map();
    for (const [g, mm] of agg) {
      const ser = [...mm.entries()].sort((a, b) => a[0] - b[0]);
      if (ser.length < 2) continue;
      const f = ser[0][1].sum / ser[0][1].n, l = ser[ser.length - 1][1].sum / ser[ser.length - 1][1].n;
      m.set(g, (l / f - 1) * 100); // 증감률%
    }
    return m.size ? m : null;
  });
}

server.registerTool(
  "get_district_score",
  {
    title: "자치구 종합 스코어(순위)",
    description:
      "가격상승·전세가율·유동인구·소득·학군·범죄(역) 지표를 자치구 간 0~100 정규화 후 가중합해 " +
      "종합 순위를 반환합니다. 가중치는 입력으로 조정 가능하며, 가용한 지표만 사용합니다. " +
      "⚠️ 투자 조언이 아니라 지표 종합입니다.",
    inputSchema: {
      districts: z.array(z.string()).optional().describe("대상 자치구 목록(생략 시 서울 25개 구 기본, 경기도 구/시 지정 가능)"),
      priceFrom: z.string().regex(/^\d{6}$/, "YYYYMM").default("202301").describe("가격/전세가율 CAGR 산정 시작 연월"),
      crimeYear: z.number().optional().describe("범죄 기준 연도(생략 시 최신 파일)"),
      incomeYear: z.number().optional().describe("소득 기준 연도(생략 시 최신)"),
      weights: z.record(z.number()).optional().describe("지표 가중치 {price,jeonse,living,income,school,crime}"),
    },
  },
  async ({ districts, priceFrom, crimeYear, incomeYear, weights }) => {
    // 대상 자치구
    let targets;
    if (districts?.length) {
      targets = districts.map(resolveGu);
      if (targets.some((t) => !t)) return errorResult("인식할 수 없는 자치구가 포함되어 있습니다.");
    } else {
      targets = Object.entries(SEOUL_GU).map(([name, code]) => ({ name, code }));
    }
    const names = targets.map((t) => t.name);

    const now = new Date();
    const end = now.getFullYear() * 100 + (now.getMonth() + 1);
    const months = monthRange(Number(priceFrom), end);

    // 지표 수집(병렬)
    const [price, jeonse, school, living, income] = await Promise.all([
      collectPrice(targets, months),
      collectJeonse(targets, months),
      collectSchool(targets),
      Promise.resolve(collectLiving(null, null, names)),
      Promise.resolve(collectIncome(incomeYear, names)),
    ]);
    const crime = collectCrime(crimeYear, GU_POP_2024, names);
    const raw = { price, jeonse, school, living, income, crime };

    // 커버리지: 대상 구에 대해 2개 이상 값이 있는 지표만 사용
    const present = SCORE_METRICS.filter((mt) => {
      const map = raw[mt.key];
      return map && names.filter((n) => map.has(n)).length >= 2;
    });
    if (!present.length) {
      return errorResult(
        "사용 가능한 지표가 없습니다. API 키(MOLIT/NEIS)와 data/ CSV(crime/living_pop/income)를 준비한 뒤 다시 시도하세요."
      );
    }

    // 가중치 정규화(입력 override → 가용 지표에 대해 합=1)
    const wIn = weights || {};
    const wSum = present.reduce((a, mt) => a + (wIn[mt.key] ?? mt.w), 0);
    const wOf = (mt) => (wIn[mt.key] ?? mt.w) / wSum;

    // 지표별 0~100 정규화
    const normMaps = {};
    for (const mt of present) {
      normMaps[mt.key] = minMax(names.map((n) => ({ gu: n, v: raw[mt.key].get(n) ?? null })), mt.invert);
    }

    // 종합 점수
    const scored = names.map((n) => {
      let total = 0, wUsed = 0; const breakdown = {};
      for (const mt of present) {
        const s = normMaps[mt.key].get(n);
        if (s == null) continue;
        total += s * wOf(mt); wUsed += wOf(mt); breakdown[mt.label] = s;
      }
      // 일부 지표 결측 시 사용 가중치로 재정규화
      const score = wUsed > 0 ? +(total / wUsed).toFixed(1) : null;
      return { 자치구: n, 종합점수: score, 지표: breakdown };
    }).filter((r) => r.종합점수 != null).sort((a, b) => b.종합점수 - a.종합점수);

    const covLabel = present.map((mt) => mt.label).join(", ");
    const missing = SCORE_METRICS.filter((mt) => !present.includes(mt)).map((mt) => mt.label);
    const wLabel = present.map((mt) => `${mt.label} ${(wOf(mt) * 100).toFixed(0)}%`).join(" · ");

    const lines = scored.map((r, i) =>
      `${String(i + 1).padStart(2)}. ${r.자치구.padEnd(4)} ${String(r.종합점수).padStart(5)}점  ` +
      present.map((mt) => `${mt.label} ${String(r.지표[mt.label] ?? "-").padStart(4)}`).join(" · "));

    return {
      content: [
        {
          type: "text",
          text:
            `🏆 자치구 종합 스코어 (${scored.length}개 구)\n` +
            `사용 지표: ${covLabel}` + (missing.length ? ` · ⚠️ 미사용(데이터 없음): ${missing.join(", ")}` : "") + "\n" +
            `가중치: ${wLabel}\n\n` + lines.join("\n") +
            `\n\n⚠️ 이 점수는 공공데이터 지표의 상대 비교일 뿐 투자 조언이 아닙니다. 가중치를 바꿔 여러 관점으로 보세요.`,
        },
        { type: "text", text: JSON.stringify({ 사용지표: present.map((m) => m.label), 미사용: missing, 가중치: Object.fromEntries(present.map((m) => [m.label, +(wOf(m)).toFixed(3)])), 순위: scored }, null, 2) },
      ],
    };
  }
);

// ===========================================================================
// tae0y/real-estate-mcp 연동 확장 도구 (14+ Tools)
// https://github.com/tae0y/real-estate-mcp
// ===========================================================================

const ODCLOUD_KEY = process.env.ODCLOUD_API_KEY || process.env.DATA_GO_KR_API_KEY || MOLIT_KEY;

function summarizeTradeRecords(rows, isRent = false) {
  if (!rows || !rows.length) return null;
  const vals = rows
    .map((r) => (isRent ? (r.monthly > 0 ? r.monthly : r.deposit) : r.amount))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((a, b) => a + b, 0);
  const perPyeongs = rows
    .map((r) => {
      const v = isRent ? r.deposit : r.amount;
      return r.area > 0 ? (v / r.area) * 3.3058 : NaN;
    })
    .filter(Number.isFinite);

  return {
    total_count: rows.length,
    min_10k: sorted[0],
    max_10k: sorted[sorted.length - 1],
    avg_10k: +(sum / vals.length).toFixed(1),
    median_10k: median(vals),
    median_pyeong_10k: perPyeongs.length ? +median(perPyeongs).toFixed(1) : null,
  };
}

function resolveRegionOrCode(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^\d{5}$/.test(trimmed)) {
    const gu = resolveGu(trimmed);
    return gu || { code: trimmed, name: trimmed, province: trimmed.startsWith("11") ? "seoul" : "gyeonggi" };
  }
  return resolveGu(trimmed);
}

// ---------------------------------------------------------------------------
// 1. get_region_code (지역코드 조회)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_region_code",
  {
    title: "지역 법정동코드 5자리 조회",
    description: "지역명(서울 자치구, 경기 시·군·구 등)을 입력받아 국토부 실거래가 조회용 5자리 법정동코드(LAWD_CD)를 반환합니다.",
    inputSchema: {
      region_name: z.string().describe("지역 이름 (예: '강남구', '분당구', '수지구', '과천시', '마포구')"),
    },
  },
  async ({ region_name }) => {
    const gu = resolveRegionOrCode(region_name);
    if (!gu) return errorResult(`지역 '${region_name}'에 해당하는 법정동코드를 찾을 수 없습니다.`);
    return {
      content: [
        { type: "text", text: `📍 [${gu.name}] 법정동코드: ${gu.code} (${gu.province})` },
        { type: "text", text: JSON.stringify({ name: gu.name, code: gu.code, province: gu.province }, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 공통 실거래가 도구 핸들러
// ---------------------------------------------------------------------------
async function handlePropertyQuery(ds, label, region_code, year_month, num_of_rows = 100, isRent = false) {
  if (!MOLIT_KEY) return errorResult("환경변수 MOLIT_API_KEY 가 설정되지 않았습니다.");
  const gu = resolveRegionOrCode(region_code);
  if (!gu) return errorResult(`지역코드 또는 지역명 '${region_code}' 를 인식할 수 없습니다.`);

  const ym = String(year_month).trim();
  if (!/^\d{6}$/.test(ym)) return errorResult("year_month 는 6자리 YYYYMM 형식이어야 합니다 (예: 202501).");

  try {
    const allRows = await fetchMonth(ds, gu.code, ym);
    const rows = allRows.slice(0, num_of_rows);
    const summary = summarizeTradeRecords(allRows, isRent);

    if (!rows.length) {
      return { content: [{ type: "text", text: `📭 [${gu.name}] ${ym} ${label} 실거래 데이터가 없습니다.` }] };
    }

    const lines = rows.slice(0, 30).map((r) => {
      const dt = `${r.y}.${String(r.m).padStart(2, "0")}.${String(r.d).padStart(2, "0")}`;
      const nm = r.name || r.apt || r.buildingUse || r.houseType || "부동산";
      const dong = r.dong ? `(${r.dong})` : "";
      const ar = r.area ? `${r.area.toFixed(1)}㎡` : "";
      const fl = r.floor ? `${r.floor}층` : "";
      if (isRent) {
        const cost = r.monthly > 0 ? `보증금 ${r.deposit.toLocaleString()}만 / 월 ${r.monthly.toLocaleString()}만` : `전세 ${r.deposit.toLocaleString()}만원`;
        return `• [${dt}] ${nm} ${dong} ${ar} ${fl} → ${cost}`;
      } else {
        const amt = `${(r.amount / 10000).toFixed(2)}억(${r.amount.toLocaleString()}만원)`;
        return `• [${dt}] ${nm} ${dong} ${ar} ${fl} → ${amt}`;
      }
    });

    const summaryText = summary
      ? `\n📊 [요약 통계] 총 ${summary.total_count}건 | 중위가: ${(summary.median_10k / 10000).toFixed(2)}억 | 평균: ${(summary.avg_10k / 10000).toFixed(2)}억 | 최저: ${(summary.min_10k / 10000).toFixed(2)}억 ~ 최고: ${(summary.max_10k / 10000).toFixed(2)}억`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `🏠 [${gu.name} · ${gu.code}] ${ym} ${label} 실거래가 조회 결과 (총 ${allRows.length}건 중 ${rows.length}건 표시)\n${summaryText}\n\n` + lines.join("\n"),
        },
        {
          type: "text",
          text: JSON.stringify({ region: gu.name, code: gu.code, ym, summary, total_fetched: allRows.length, items: rows }, null, 2),
        },
      ],
    };
  } catch (err) {
    return errorResult(`조회 실패: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 2. get_apartment_trades & get_apartment_rent
// ---------------------------------------------------------------------------
server.registerTool(
  "get_apartment_trades",
  {
    title: "아파트 매매 실거래가 조회",
    description: "국토부 API를 통해 지정 지역 및 연월의 아파트 매매 실거래가 목록과 요약 통계(중위가, 최저/최고가 등)를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드(예: '11680') 또는 자치구 이름(예: '강남구', '분당구')"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM 형식, 예: '202501')"),
      num_of_rows: z.number().optional().default(100).describe("최대 반환 건수 (기본값: 100)"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.sale, "아파트 매매", region_code, year_month, num_of_rows, false)
);

server.registerTool(
  "get_apartment_rent",
  {
    title: "아파트 전월세 실거래가 조회",
    description: "국토부 API를 통해 지정 지역 및 연월의 아파트 전월세 실거래가 목록과 요약 통계를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 자치구 이름"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM 형식, 예: '202501')"),
      num_of_rows: z.number().optional().default(100).describe("최대 반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.rent, "아파트 전월세", region_code, year_month, num_of_rows, true)
);

// ---------------------------------------------------------------------------
// 3. get_officetel_trades & get_officetel_rent
// ---------------------------------------------------------------------------
server.registerTool(
  "get_officetel_trades",
  {
    title: "오피스텔 매매 실거래가 조회",
    description: "국토교통부 오피스텔 매매 신고 자료 API를 통해 실거래가 내역과 요약 통계를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명 (예: '11440', '마포구')"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM, 예: '202501')"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.officetel_sale, "오피스텔 매매", region_code, year_month, num_of_rows, false)
);

server.registerTool(
  "get_officetel_rent",
  {
    title: "오피스텔 전월세 실거래가 조회",
    description: "국토교통부 오피스텔 전월세 자료 API를 통해 실거래가 내역과 보증금/월세 요약 통계를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.officetel_rent, "오피스텔 전월세", region_code, year_month, num_of_rows, true)
);

// ---------------------------------------------------------------------------
// 4. get_villa_trades & get_villa_rent (연립다세대)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_villa_trades",
  {
    title: "연립다세대(빌라) 매매 실거래가 조회",
    description: "국토교통부 연립다세대 매매 실거래가 자료 API를 통해 빌라 매매 내역과 요약 통계를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명 (예: '11680', '강남구')"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.villa_sale, "연립다세대(빌라) 매매", region_code, year_month, num_of_rows, false)
);

server.registerTool(
  "get_villa_rent",
  {
    title: "연립다세대(빌라) 전월세 실거래가 조회",
    description: "국토교통부 연립다세대 전월세 자료 API를 통해 빌라 전월세 실거래가 내역을 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.villa_rent, "연립다세대(빌라) 전월세", region_code, year_month, num_of_rows, true)
);

// ---------------------------------------------------------------------------
// 5. get_single_house_trades & get_single_house_rent (단독/다가구)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_single_house_trades",
  {
    title: "단독·다가구 매매 실거래가 조회",
    description: "국토교통부 단독/다가구 매매 실거래가 자료 API를 통해 실거래가 내역과 요약 통계를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.single_sale, "단독/다가구 매매", region_code, year_month, num_of_rows, false)
);

server.registerTool(
  "get_single_house_rent",
  {
    title: "단독·다가구 전월세 실거래가 조회",
    description: "국토교통부 단독/다가구 전월세 자료 API를 통해 전월세 실거래가 내역을 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.single_rent, "단독/다가구 전월세", region_code, year_month, num_of_rows, true)
);

// ---------------------------------------------------------------------------
// 6. get_commercial_trade (상업업무용)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_commercial_trade",
  {
    title: "상업·업무용 부동산 매매 실거래가 조회",
    description: "국토교통부 상업업무용 부동산 매매 신고 자료 API를 통해 상가/빌딩/오피스 매매 실거래가를 반환합니다.",
    inputSchema: {
      region_code: z.string().describe("5자리 법정동코드 또는 지역명 (예: '11110', '종로구')"),
      year_month: z.string().regex(/^\d{6}$/).describe("조회 연월 (YYYYMM)"),
      num_of_rows: z.number().optional().default(100).describe("반환 건수"),
    },
  },
  async ({ region_code, year_month, num_of_rows }) =>
    handlePropertyQuery(DATASETS.commercial_sale, "상업/업무용 매매", region_code, year_month, num_of_rows, false)
);

// ---------------------------------------------------------------------------
// 7. 청약홈 분양정보 (get_apt_subscription_info)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_apt_subscription_info",
  {
    title: "아파트 분양 및 청약 공고 조회",
    description: "한국부동산원 청약홈 아파트 분양 공고 목록(주택명, 공급위치, 모집공고일, 청약접수일정, 당첨자발표일 등)을 조회합니다.",
    inputSchema: {
      page: z.number().optional().default(1).describe("페이지 번호 (기본: 1)"),
      per_page: z.number().optional().default(20).describe("페이지당 조회 건수 (기본: 20)"),
      search_house_name: z.string().optional().describe("특정 단지명(주택명) 필터 검색어"),
    },
  },
  async ({ page, per_page, search_house_name }) => {
    if (!ODCLOUD_KEY) return errorResult("공공데이터포털 API 키(MOLIT_API_KEY 또는 ODCLOUD_API_KEY)가 설정되지 않았습니다.");
    const key = ODCLOUD_KEY.includes("%") ? decodeURIComponent(ODCLOUD_KEY) : ODCLOUD_KEY;
    const url = `https://api.odcloud.kr/api/15101046/v1/uddi:14a46595-03dd-47d3-a418-d64e52820598?page=${page}&perPage=${per_page}&serviceKey=${encodeURIComponent(key)}`;

    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      let items = data.data || [];
      if (search_house_name) {
        items = items.filter((it) => String(it["주택명"] || "").includes(search_house_name));
      }

      if (!items.length) {
        return { content: [{ type: "text", text: `📭 조회된 청약 공고가 없습니다.` }] };
      }

      const lines = items.map((it) => {
        const name = it["주택명"] || "미상";
        const loc = it["공급위치"] || "";
        const rcvDate = `${it["청약접수시작일"] || ""} ~ ${it["청약접수종료일"] || ""}`;
        const winDate = it["당첨자발표일"] || "";
        return `• 🏢 [${name}] ${loc}\n  - 청약일정: ${rcvDate} | 당첨자 발표: ${winDate}`;
      });

      return {
        content: [
          { type: "text", text: `📋 한국부동산원 청약홈 분양 공고 (${items.length}건)\n\n` + lines.join("\n\n") },
          { type: "text", text: JSON.stringify({ page, per_page, total_match: items.length, items }, null, 2) },
        ],
      };
    } catch (e) {
      return errorResult(`청약 정보 조회 실패: ${e.message}`);
    }
  }
);

// ---------------------------------------------------------------------------
// 8. 부동산 재무·대출 계산기 (Finance Tools)
// ---------------------------------------------------------------------------
server.registerTool(
  "calculate_loan_payment",
  {
    title: "주택담보대출 원리금 균등상환(EMI) 계산기",
    description: "대출원금(만원), 연이율(%), 상환기간(년)을 바탕으로 월 납입 원리금, 총 상환액, 총 발생 이자를 정밀 계산합니다.",
    inputSchema: {
      principal_10k: z.number().min(1).describe("대출 원금 (만원 단위, 예: 30000 = 3억원)"),
      annual_rate_pct: z.number().min(0).describe("연 이자율 (%, 예: 4.2)"),
      years: z.number().min(1).max(50).describe("대출 기간 (년 단위, 예: 30, 40)"),
    },
  },
  async ({ principal_10k, annual_rate_pct, years }) => {
    const r = annual_rate_pct / 100 / 12;
    const n = years * 12;
    let monthly_10k = 0;
    if (r === 0) {
      monthly_10k = principal_10k / n;
    } else {
      const growth = Math.pow(1 + r, n);
      monthly_10k = (principal_10k * r * growth) / (growth - 1);
    }
    const total_paid_10k = monthly_10k * n;
    const total_interest_10k = total_paid_10k - principal_10k;

    const principalWon = principal_10k * 10000;
    const monthlyWon = Math.round(monthly_10k * 10000);
    const totalInterestWon = Math.round(total_interest_10k * 10000);
    const totalPaidWon = Math.round(total_paid_10k * 10000);

    const report =
      `💳 [대출 원리금 균등상환 시뮬레이션]\n` +
      `• 대출 원금: ${(principal_10k / 10000).toFixed(2)}억원 (${principalWon.toLocaleString()}원)\n` +
      `• 연 이자율: ${annual_rate_pct}% (만기: ${years}년 / ${n}개월)\n\n` +
      `💰 월 원리금 납입액: ${monthlyWon.toLocaleString()}원 (${monthly_10k.toFixed(1)}만원)\n` +
      `📈 총 대출 이자: ${totalInterestWon.toLocaleString()}원 (${total_interest_10k.toFixed(1)}만원)\n` +
      `💵 만기 총 상환액: ${totalPaidWon.toLocaleString()}원 (${total_paid_10k.toFixed(1)}만원)`;

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            {
              principal_10k,
              annual_rate_pct,
              years,
              monthly_payment_10k: +monthly_10k.toFixed(2),
              monthly_payment_won: monthlyWon,
              total_interest_10k: +total_interest_10k.toFixed(2),
              total_paid_10k: +total_paid_10k.toFixed(2),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "calculate_monthly_cashflow",
  {
    title: "월간 잉여 현금흐름 및 DSR 스트레스 시뮬레이터",
    description: "월 소득, 생활비, 월 대출상환액, 임대소득을 종합하여 실질적인 월 잉여 현금흐름과 주거비 부담율(DSR 추정)을 분석합니다.",
    inputSchema: {
      monthly_income_10k: z.number().describe("월 실수령 총소득 (만원 단위, 예: 600)"),
      monthly_expenses_10k: z.number().describe("월 고정 생활비/소비지출 (만원 단위, 예: 250)"),
      monthly_loan_payment_10k: z.number().describe("월 대출 원리금 상환액 (만원 단위, 예: 180)"),
      monthly_rent_income_10k: z.number().optional().default(0).describe("월 임대/부수입 (만원 단위, 예: 50)"),
    },
  },
  async ({ monthly_income_10k, monthly_expenses_10k, monthly_loan_payment_10k, monthly_rent_income_10k }) => {
    const total_in = monthly_income_10k + (monthly_rent_income_10k || 0);
    const total_out = monthly_expenses_10k + monthly_loan_payment_10k;
    const net_surplus = total_in - total_out;
    const dsr_approx = monthly_income_10k > 0 ? (monthly_loan_payment_10k / monthly_income_10k) * 100 : 0;
    const saving_ratio = total_in > 0 ? (net_surplus / total_in) * 100 : 0;

    let healthStatus = "🟢 양호 (여유로운 현금흐름)";
    if (dsr_approx > 40) healthStatus = "🔴 위험 (DSR 40% 초과, 가계 건전성 악화 주의)";
    else if (dsr_approx > 30) healthStatus = "🟡 주의 (대출 원리금 비중 30% 초과)";

    const text =
      `💼 [월간 현금흐름 & 재무 건전성 진단]\n` +
      `• 총 수입: ${total_in.toLocaleString()}만원 (기본소득 ${monthly_income_10k}만 + 부수입 ${monthly_rent_income_10k}만)\n` +
      `• 총 지출: ${total_out.toLocaleString()}만원 (생활비 ${monthly_expenses_10k}만 + 대출원리금 ${monthly_loan_payment_10k}만)\n\n` +
      `💵 월 잉여 현금: ${net_surplus.toLocaleString()}만원 (저축/투자 가능 여력)\n` +
      `📊 추정 DSR(소득대비 대출상환비율): ${dsr_approx.toFixed(1)}%\n` +
      `📈 저축률: ${saving_ratio.toFixed(1)}%\n` +
      `🛡️ 재무 상태: ${healthStatus}`;

    return {
      content: [
        { type: "text", text },
        {
          type: "text",
          text: JSON.stringify(
            { total_in, total_out, net_surplus, dsr_approx: +dsr_approx.toFixed(2), saving_ratio: +saving_ratio.toFixed(2) },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.registerTool(
  "calculate_compound_growth",
  {
    title: "자산 복리 성장 시뮬레이터 (매수 vs 투자 비교)",
    description: "초기 자본금, 월 적립액, 연간 기대수익률, 투자 기간을 바탕으로 복리 자산 축적 시뮬레이션을 수행합니다.",
    inputSchema: {
      initial_capital_10k: z.number().min(0).describe("초기 투자 자본금 (만원 단위, 예: 10000 = 1억원)"),
      monthly_saving_10k: z.number().min(0).describe("월 추가 적립 투자금 (만원 단위, 예: 150)"),
      annual_return_pct: z.number().describe("연간 기대 수익률 (%, 예: 7.0)"),
      years: z.number().min(1).max(50).describe("투자 기간 (년 단위, 예: 10)"),
    },
  },
  async ({ initial_capital_10k, monthly_saving_10k, annual_return_pct, years }) => {
    const r = annual_return_pct / 100 / 12;
    const months = years * 12;
    let balance = initial_capital_10k;
    const yearlySnapshots = [];

    for (let m = 1; m <= months; m++) {
      balance = balance * (1 + r) + monthly_saving_10k;
      if (m % 12 === 0) {
        const y = m / 12;
        yearlySnapshots.push({
          year: `${y}년차`,
          자산_억: +(balance / 10000).toFixed(2),
          자산_만원: Math.round(balance),
        });
      }
    }

    const total_invested_10k = initial_capital_10k + monthly_saving_10k * months;
    const total_gain_10k = balance - total_invested_10k;

    const lines = yearlySnapshots.map((s) => `• ${s.year}: ${s.자산_억}억원 (${s.자산_만원.toLocaleString()}만원)`);

    const text =
      `📈 [복리 투자 자산 축적 시뮬레이션]\n` +
      `• 초기자본: ${(initial_capital_10k / 10000).toFixed(2)}억원 | 월 적립: ${monthly_saving_10k.toLocaleString()}만원 | 기대수익률: 연 ${annual_return_pct}%\n` +
      `• ${years}년 후 최종 자산: ${(balance / 10000).toFixed(2)}억원 (${Math.round(balance).toLocaleString()}만원)\n` +
      `• 원금 총합: ${(total_invested_10k / 10000).toFixed(2)}억 | 순 복리수익: ${(total_gain_10k / 10000).toFixed(2)}억원\n\n` +
      `📅 연도별 자산 성장 추이:\n` +
      lines.join("\n");

    return {
      content: [
        { type: "text", text },
        {
          type: "text",
          text: JSON.stringify(
            {
              final_asset_10k: Math.round(balance),
              total_invested_10k,
              total_gain_10k: Math.round(total_gain_10k),
              snapshots: yearlySnapshots,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ===========================================================================
// gum798/A2A-MCP-RealEstate 연동 확장 도구
// https://github.com/gum798/A2A-MCP-RealEstate
// 위치 기반 역세권 분석, 투자가치/삶의질 평가 및 맞춤형 부동산 추천 엔진
// ===========================================================================

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return +(R * c).toFixed(2);
}

const SUBWAY_STATIONS_DATA = {
  강남역: { lat: 37.4979, lon: 127.0276, lines: ["2호선", "신분당선"] },
  역삼역: { lat: 37.5, lon: 127.0366, lines: ["2호선"] },
  선릉역: { lat: 37.5044, lon: 127.049, lines: ["2호선", "수인분당선"] },
  삼성역: { lat: 37.5081, lon: 127.0631, lines: ["2호선"] },
  종각역: { lat: 37.5703, lon: 126.9821, lines: ["1호선"] },
  명동역: { lat: 37.5636, lon: 126.9838, lines: ["4호선"] },
  홍대입구역: { lat: 37.5567, lon: 126.9244, lines: ["2호선", "6호선", "공항철도"] },
  신촌역: { lat: 37.5551, lon: 126.9366, lines: ["2호선"] },
  이대역: { lat: 37.5564, lon: 126.9458, lines: ["2호선"] },
  서울역: { lat: 37.5547, lon: 126.9706, lines: ["1호선", "4호선", "공항철도", "KTX"] },
  용산역: { lat: 37.5299, lon: 126.9646, lines: ["1호선", "경의중앙선", "KTX"] },
  여의도역: { lat: 37.5219, lon: 126.9245, lines: ["5호선", "9호선"] },
  당산역: { lat: 37.5344, lon: 126.9025, lines: ["2호선", "9호선"] },
  영등포역: { lat: 37.5156, lon: 126.9077, lines: ["1호선", "KTX"] },
  목동역: { lat: 37.526, lon: 126.8643, lines: ["5호선"] },
  오목교역: { lat: 37.5244, lon: 126.8752, lines: ["5호선"] },
  김포공항역: { lat: 37.5629, lon: 126.8014, lines: ["5호선", "9호선", "공항철도", "김포골드라인", "서해선"] },
  수원역: { lat: 37.2656, lon: 127.0011, lines: ["1호선", "수인분당선", "KTX"] },
  판교역: { lat: 37.3951, lon: 127.1116, lines: ["신분당선", "경강선"] },
  분당역: { lat: 37.3896, lon: 127.1226, lines: ["수인분당선"] },
  서현역: { lat: 37.385, lon: 127.1233, lines: ["수인분당선"] },
  정자역: { lat: 37.3667, lon: 127.1084, lines: ["수인분당선", "신분당선"] },
  미금역: { lat: 37.3501, lon: 127.1066, lines: ["수인분당선", "신분당선"] },
  수지구청역: { lat: 37.3223, lon: 127.0978, lines: ["신분당선"] },
  과천역: { lat: 37.4331, lon: 126.9967, lines: ["4호선"] },
  잠실역: { lat: 37.5133, lon: 127.1, lines: ["2호선", "8호선"] },
  가락시장역: { lat: 37.4926, lon: 127.1186, lines: ["3호선", "8호선"] },
  건대입구역: { lat: 37.5403, lon: 127.0703, lines: ["2호선", "7호선"] },
  왕십리역: { lat: 37.5618, lon: 127.0372, lines: ["2호선", "5호선", "경의중앙선", "수인분당선"] },
  청량리역: { lat: 37.5802, lon: 127.0479, lines: ["1호선", "경의중앙선", "수인분당선", "경춘선", "KTX"] },
  동대문역: { lat: 37.5712, lon: 127.0096, lines: ["1호선", "4호선"] },
  을지로3가역: { lat: 37.5663, lon: 126.9928, lines: ["2호선", "3호선"] },
  충무로역: { lat: 37.5635, lon: 126.9936, lines: ["3호선", "4호선"] },
  사당역: { lat: 37.4766, lon: 126.9814, lines: ["2호선", "4호선"] },
  교대역: { lat: 37.4934, lon: 127.0146, lines: ["2호선", "3호선"] },
  서초역: { lat: 37.4837, lon: 127.0108, lines: ["2호선"] },
  고속터미널역: { lat: 37.5048, lon: 127.0049, lines: ["3호선", "7호선", "9호선"] },
  압구정역: { lat: 37.5271, lon: 127.0284, lines: ["3호선"] },
  신사역: { lat: 37.5163, lon: 127.0205, lines: ["3호선", "신분당선"] },
  합정역: { lat: 37.5494, lon: 126.9138, lines: ["2호선", "6호선"] },
  마포역: { lat: 37.5396, lon: 126.9458, lines: ["5호선"] },
  공덕역: { lat: 37.5444, lon: 126.9515, lines: ["5호선", "6호선", "경의중앙선", "공항철도"] },
};

const KNOWN_LANDMARK_COORDS = {
  강남: { lat: 37.4979, lon: 127.0276 },
  역삼: { lat: 37.5, lon: 127.0366 },
  대치: { lat: 37.4946, lon: 127.0636 },
  개포: { lat: 37.4828, lon: 127.0673 },
  압구정: { lat: 37.5271, lon: 127.0284 },
  청담: { lat: 37.5253, lon: 127.0531 },
  서초: { lat: 37.4837, lon: 127.0108 },
  반포: { lat: 37.5048, lon: 127.0049 },
  송파: { lat: 37.5145, lon: 127.1058 },
  잠실: { lat: 37.5133, lon: 127.1 },
  가락: { lat: 37.4926, lon: 127.1186 },
  용산: { lat: 37.5299, lon: 126.9646 },
  한남: { lat: 37.5347, lon: 127.0024 },
  이촌: { lat: 37.5222, lon: 126.9744 },
  마포: { lat: 37.5567, lon: 126.9244 },
  합정: { lat: 37.5494, lon: 126.9138 },
  공덕: { lat: 37.5444, lon: 126.9515 },
  상암: { lat: 37.5775, lon: 126.8913 },
  성동: { lat: 37.5635, lon: 127.0368 },
  성수: { lat: 37.5445, lon: 127.0559 },
  옥수: { lat: 37.5414, lon: 127.0177 },
  양천: { lat: 37.526, lon: 126.8643 },
  목동: { lat: 37.526, lon: 126.8643 },
  영등포: { lat: 37.5156, lon: 126.9077 },
  여의도: { lat: 37.5219, lon: 126.9245 },
  당산: { lat: 37.5344, lon: 126.9025 },
  분당: { lat: 37.385, lon: 127.1233 },
  판교: { lat: 37.3951, lon: 127.1116 },
  정자: { lat: 37.3667, lon: 127.1084 },
  수지: { lat: 37.3223, lon: 127.0978 },
  과천: { lat: 37.4331, lon: 126.9967 },
  평촌: { lat: 37.3943, lon: 126.9568 },
  일산: { lat: 37.6584, lon: 126.7701 },
  광명: { lat: 37.4786, lon: 126.8646 },
};

function resolveCoords(address, lat, lon) {
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, source: "direct" };
  }
  if (!address) return null;
  const clean = String(address).trim();
  for (const [k, coord] of Object.entries(KNOWN_LANDMARK_COORDS)) {
    if (clean.includes(k)) {
      return { ...coord, source: `matched:${k}` };
    }
  }
  // 기본값 서울시청 중심
  return { lat: 37.5665, lon: 126.978, source: "default:seoul" };
}

function scoreToGrade(score) {
  if (score >= 90) return "S (최상)";
  if (score >= 80) return "A (우수)";
  if (score >= 70) return "B (양호)";
  if (score >= 60) return "C (보통)";
  return "D (주의)";
}

// ---------------------------------------------------------------------------
// A2A 도구 1: 가장 가까운 지하철역 검색 (find_nearest_subway_stations)
// ---------------------------------------------------------------------------
server.registerTool(
  "find_nearest_subway_stations",
  {
    title: "가장 가까운 지하철역 및 거리 분석",
    description: "주소명 또는 좌표(위경도)를 기준으로 반경 내 가장 가까운 지하철역 목록과 직선거리(km/m), 노선 정보를 계산하여 역세권 입지를 분석합니다.",
    inputSchema: {
      address: z.string().optional().describe("조회할 주소나 지역명 (예: '강남구 대치동', '목동 현대아파트', '분당구 정자동')"),
      lat: z.number().optional().describe("위도 (선택)"),
      lon: z.number().optional().describe("경도 (선택)"),
      limit: z.number().optional().default(5).describe("반환할 최근접 역 개수 (기본: 5)"),
    },
  },
  async ({ address, lat, lon, limit = 5 }) => {
    const coords = resolveCoords(address, lat, lon);
    if (!coords) return errorResult("주소 또는 좌표(lat, lon) 정보가 필요합니다.");

    const list = Object.entries(SUBWAY_STATIONS_DATA).map(([name, info]) => {
      const distKm = calculateDistanceKm(coords.lat, coords.lon, info.lat, info.lon);
      return {
        station_name: name,
        distance_km: distKm,
        distance_m: Math.round(distKm * 1000),
        lines: info.lines,
        coordinates: { lat: info.lat, lon: info.lon },
      };
    });

    list.sort((a, b) => a.distance_km - b.distance_km);
    const nearest = list.slice(0, limit);
    const closest = nearest[0];

    const isSuperStation = closest.distance_m <= 500;
    const isWalkingStation = closest.distance_m <= 1000;
    const stationGrade = isSuperStation ? "초역세권 (도보 7분 이내)" : isWalkingStation ? "역세권 (도보 15분 이내)" : "비역세권 (버스/환승 필요)";

    const lines = nearest.map(
      (s, i) => `${i + 1}. 🚇 ${s.station_name} (${s.lines.join(", ")}) - ${s.distance_m}m (${s.distance_km}km)`
    );

    const report =
      `📍 [역세권 입지 분석]\n` +
      `• 기준 위치: ${address || "좌표 (" + coords.lat + ", " + coords.lon + ")"}\n` +
      `• 최근접 역: ${closest.station_name} (${closest.distance_m}m)\n` +
      `• 역세권 등급: ${stationGrade}\n\n` +
      `[최근접 지하철역 Top ${nearest.length}]\n` +
      lines.join("\n");

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            { query: { address, coordinates: coords }, nearest_stations: nearest, closest_station: closest, station_grade: stationGrade },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// A2A 도구 2: 위치 점수 계산 (calculate_location_score)
// ---------------------------------------------------------------------------
server.registerTool(
  "calculate_location_score",
  {
    title: "부동산 위치 및 입지 점수 종합 산출",
    description: "지하철역 거리(km), 편의시설 개수, 공원/녹지 거리(km)를 기반으로 위치 종합 점수(0~100)와 입지 등급을 정량 평가합니다.",
    inputSchema: {
      subway_distance_km: z.number().min(0).describe("가장 가까운 지하철역까지의 거리 (km 단위, 예: 0.4)"),
      facilities_count: z.number().optional().default(15).describe("반경 1km 내 편의시설 개수 (기본: 15)"),
      park_distance_km: z.number().optional().default(0.5).describe("가장 가까운 공원/녹지까지의 거리 (km 단위, 기본: 0.5)"),
    },
  },
  async ({ subway_distance_km, facilities_count = 15, park_distance_km = 0.5 }) => {
    // 1. 교통 점수 (40%)
    let transportScore = 40;
    if (subway_distance_km <= 0.4) transportScore = 100;
    else if (subway_distance_km <= 0.8) transportScore = 85;
    else if (subway_distance_km <= 1.2) transportScore = 70;
    else if (subway_distance_km <= 2.0) transportScore = 55;

    // 2. 편의성 점수 (35%)
    let convenienceScore = 40;
    if (facilities_count >= 30) convenienceScore = 100;
    else if (facilities_count >= 20) convenienceScore = 85;
    else if (facilities_count >= 10) convenienceScore = 70;
    else if (facilities_count >= 5) convenienceScore = 55;

    // 3. 환경 점수 (25%)
    let envScore = 40;
    if (park_distance_km <= 0.3) envScore = 100;
    else if (park_distance_km <= 0.6) envScore = 85;
    else if (park_distance_km <= 1.0) envScore = 70;
    else if (park_distance_km <= 1.5) envScore = 55;

    const totalScore = +(transportScore * 0.4 + convenienceScore * 0.35 + envScore * 0.25).toFixed(1);
    const grade = scoreToGrade(totalScore);

    const text =
      `🎯 [입지 점수 종합 평가]\n` +
      `• 종합 위치 점수: ${totalScore}점 / 100점 (${grade})\n` +
      `• 🚆 교통 접근성 (40% 가중치): ${transportScore}점 (지하철역 ${Math.round(subway_distance_km * 1000)}m)\n` +
      `• 🛒 생활 인프라 편의성 (35% 가중치): ${convenienceScore}점 (편의시설 ${facilities_count}개)\n` +
      `• 🌳 쾌적성/공원 환경 (25% 가중치): ${envScore}점 (녹지 거리 ${Math.round(park_distance_km * 1000)}m)`;

    return {
      content: [
        { type: "text", text },
        {
          type: "text",
          text: JSON.stringify(
            { total_score: totalScore, grade, breakdown: { transport: transportScore, convenience: convenienceScore, environment: envScore } },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// A2A 도구 3: 투자가치 평가 (evaluate_investment_value)
// ---------------------------------------------------------------------------
server.registerTool(
  "evaluate_investment_value",
  {
    title: "부동산 투자가치 정량 평가 (Investment Score)",
    description: "매물 가격(만원), 전용면적(㎡), 층수, 건축년도, 지하철역 거리(km)를 분석하여 가격 적정성, 감가상각 여력, 층수/입지 프리미엄을 반영한 투자가치 점수를 산출합니다.",
    inputSchema: {
      price_10k: z.number().min(100).describe("매매 가격 (만원 단위, 예: 120000 = 12억원)"),
      area_m2: z.number().min(10).describe("전용면적 (㎡ 단위, 예: 84.9)"),
      floor: z.number().optional().default(10).describe("해당 매물 층수 (예: 12)"),
      total_floor: z.number().optional().default(20).describe("건물 전체 층수 (예: 25)"),
      building_year: z.number().optional().default(2015).describe("준공 건축년도 (예: 2018)"),
      subway_distance_km: z.number().optional().default(0.5).describe("지하철역 거리 (km 단위, 예: 0.5)"),
    },
  },
  async ({ price_10k, area_m2, floor = 10, total_floor = 20, building_year = 2015, subway_distance_km = 0.5 }) => {
    const currentYear = new Date().getFullYear();
    const age = currentYear - building_year;
    const pyeong = area_m2 / 3.3058;
    const pricePerPyeong_10k = +(price_10k / pyeong).toFixed(1);

    // 1. 가격 경쟁력 점수 (30%)
    let priceScore = 70;
    if (pricePerPyeong_10k < 3000) priceScore = 95;
    else if (pricePerPyeong_10k < 4500) priceScore = 85;
    else if (pricePerPyeong_10k < 6500) priceScore = 75;
    else priceScore = 65;

    // 2. 연식 및 미래 잠재력 (25%): 5년 이내 신축 또는 30년 이상 재건축 연한 도래 시 고득점
    let futureScore = 60;
    if (age <= 5) futureScore = 95; // 신축 프리미엄
    else if (age <= 10) futureScore = 85; // 준신축
    else if (age >= 30) futureScore = 90; // 재건축 기대감
    else if (age <= 20) futureScore = 75; // 기축 양호
    else futureScore = 60;

    // 3. 층수 점수 (15%): 중상층 로열층 여부
    const floorRatio = total_floor > 0 ? floor / total_floor : 0.5;
    let floorScore = 70;
    if (floorRatio >= 0.4 && floorRatio <= 0.8) floorScore = 95; // 로열층
    else if (floorRatio > 0.8) floorScore = 85; // 탑층 부근
    else if (floor >= 3) floorScore = 75; // 중저층
    else floorScore = 60; // 1~2층 저층

    // 4. 교통 역세권 (30%)
    let transportScore = 50;
    if (subway_distance_km <= 0.4) transportScore = 95;
    else if (subway_distance_km <= 0.8) transportScore = 85;
    else if (subway_distance_km <= 1.2) transportScore = 70;

    const totalScore = +(priceScore * 0.3 + futureScore * 0.25 + floorScore * 0.15 + transportScore * 0.3).toFixed(1);
    const grade = scoreToGrade(totalScore);

    const report =
      `💰 [부동산 투자가치 평가 결과]\n` +
      `• 투자가치 점수: ${totalScore}점 (${grade})\n` +
      `• 평당 가격: ${pricePerPyeong_10k.toLocaleString()}만원/평 (전용 ${area_m2}㎡ / ${pyeong.toFixed(1)}평)\n` +
      `• 연식: ${age}년차 (${building_year}년식, ${age <= 5 ? "신축 프리미엄" : age >= 30 ? "재건축 가치" : "기축"})\n` +
      `• 층수 분석: ${floor}층 / ${total_floor}층 (${floorScore >= 90 ? "로열층 우수" : "일반층"})\n` +
      `• 역세권 분석: 도보 ${Math.round(subway_distance_km * 1000)}m (점수: ${transportScore}점)`;

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            {
              total_score: totalScore,
              grade,
              price_per_pyeong_10k: pricePerPyeong_10k,
              age,
              breakdown: { price_competitiveness: priceScore, future_potential: futureScore, floor_premium: floorScore, transit_access: transportScore },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);



// ---------------------------------------------------------------------------
// A2A 도구 4: 삶의 질 평가 (evaluate_life_quality)
// ---------------------------------------------------------------------------
server.registerTool(
  "evaluate_life_quality",
  {
    title: "실거주 삶의 질 가치 평가 (Life Quality Score)",
    description: "실거주자의 만족도에 영향을 미치는 교통, 생활인프라, 공원 녹지, 건물 연식, 학군 및 학교 교육 환경(check_schools 연동)을 바탕으로 삶의 질 지수를 정량 평가합니다.",
    inputSchema: {
      subway_distance_km: z.number().min(0).describe("지하철역 거리 (km 단위)"),
      facilities_count: z.number().optional().default(20).describe("반경 내 편의시설 개수"),
      park_distance_km: z.number().optional().default(0.4).describe("공원 거리 (km 단위)"),
      building_year: z.number().optional().default(2018).describe("건축 준공연도"),
      district: z.string().optional().describe("자치구명(선택, 입력 시 check_schools 학군 데이터 자동 반영)"),
    },
  },
  async ({ subway_distance_km, facilities_count = 20, park_distance_km = 0.4, building_year = 2018, district }) => {
    const age = new Date().getFullYear() - building_year;

    // 1. 편의 인프라 (25%)
    let convScore = facilities_count >= 25 ? 95 : facilities_count >= 15 ? 85 : facilities_count >= 8 ? 70 : 50;
    // 2. 통근/교통 편의 (25%)
    let transitScore = subway_distance_km <= 0.5 ? 95 : subway_distance_km <= 1.0 ? 80 : subway_distance_km <= 1.5 ? 65 : 45;
    // 3. 녹지 환경 쾌적성 (20%)
    let envScore = park_distance_km <= 0.3 ? 95 : park_distance_km <= 0.6 ? 85 : park_distance_km <= 1.0 ? 70 : 50;
    // 4. 단지 컨디션 (15%)
    let buildingScore = age <= 5 ? 95 : age <= 10 ? 85 : age <= 20 ? 75 : 55;

    // 5. 학군 및 교육 인프라 (15%): check_schools.js 연동
    let schoolScore = 75;
    let schoolSummary = "일반 보통 수준";
    if (district) {
      try {
        const gu = resolveGu(district);
        const prov = gu?.province === "gyeonggi" ? "경기도" : "서울특별시";
        const highSchools = await getDistrictHighSchoolsData({ district: gu?.name || district, province: prov });
        if (highSchools && !highSchools.isError) {
          const detail = JSON.parse(highSchools.content[1]?.text || "{}");
          const spec = (detail.counts?.specialized || 0) + (detail.counts?.autonomous || 0);
          if (spec >= 5) { schoolScore = 98; schoolSummary = `최상급 명문 학군 (자율/특목고 ${spec}개교)`; }
          else if (spec >= 3) { schoolScore = 90; schoolSummary = `우수 학군 (자율/특목고 ${spec}개교)`; }
          else if (spec >= 1) { schoolScore = 80; schoolSummary = `양호 학군 (자율/특목고 ${spec}개교)`; }
          else { schoolScore = 70; schoolSummary = `일반 학군 (일반고 ${detail.counts?.general || 0}개교)`; }
        }
      } catch {
        // 기본값 유지
      }
    }

    const totalScore = +(convScore * 0.25 + transitScore * 0.25 + envScore * 0.20 + buildingScore * 0.15 + schoolScore * 0.15).toFixed(1);
    const grade = scoreToGrade(totalScore);

    const report =
      `🌿 [실거주 삶의 질 평가 결과 (check_schools 연동)]\n` +
      `• 삶의 질 지수: ${totalScore}점 (${grade})\n` +
      `• 🛒 생활 편의성 (25%): ${convScore}점 (주변 편의시설 ${facilities_count}개)\n` +
      `• 🚆 대중교통 통근 편의 (25%): ${transitScore}점 (역거리 ${Math.round(subway_distance_km * 1000)}m)\n` +
      `• 🏞️ 녹지/휴식 환경 (20%): ${envScore}점 (공원 거리 ${Math.round(park_distance_km * 1000)}m)\n` +
      `• 🏢 주거 시설 쾌적성 (15%): ${buildingScore}점 (${building_year}년 준공, ${age}년차)\n` +
      `• 🎓 학군 및 교육 환경 (15%): ${schoolScore}점 (${schoolSummary})`;

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            {
              total_score: totalScore,
              grade,
              breakdown: {
                convenience: convScore,
                transit: transitScore,
                environment: envScore,
                building: buildingScore,
                education_school: schoolScore,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// A2A 도구 5: 종합 부동산 맞춤 추천 (recommend_property)
// ---------------------------------------------------------------------------
server.registerTool(
  "recommend_property",
  {
    title: "성향별 종합 부동산 추천 및 판정 (A2A Recommendation)",
    description: "사용자의 투자 성향(투자형 'investment', 실거주형 'life_quality', 학군/자녀교육형 'education', 균형형 'balanced')에 맞춰 투자가치, 삶의 질, 학군 데이터를 종합 합성하고 추천 점수를 산출합니다.",
    inputSchema: {
      property_name: z.string().describe("매물명 또는 단지명 (예: '반포자이', '마포래미안푸르지오')"),
      price_10k: z.number().describe("매매 가격 (만원 단위, 예: 150000)"),
      area_m2: z.number().describe("전용면적 (㎡ 단위, 예: 84.5)"),
      user_preference: z.enum(["investment", "life_quality", "education", "balanced"]).default("balanced").describe("사용자 성향 ('investment': 자산증식, 'life_quality': 거주만족, 'education': 학군/자녀교육, 'balanced': 균형)"),
      building_year: z.number().optional().default(2018).describe("준공 연도"),
      subway_distance_km: z.number().optional().default(0.5).describe("지하철역 거리(km)"),
      district: z.string().optional().describe("자치구/지역명(예: '강남구', '서초구', '송파구', '양천구', '노원구')"),
    },
  },
  async ({ property_name, price_10k, area_m2, user_preference = "balanced", building_year = 2018, subway_distance_km = 0.5, district }) => {
    // 투자가치 계산
    const pyeong = area_m2 / 3.3058;
    const pricePerPyeong_10k = +(price_10k / pyeong).toFixed(1);
    const age = new Date().getFullYear() - building_year;

    let investScore = 75;
    if (pricePerPyeong_10k < 4000) investScore += 10;
    if (subway_distance_km <= 0.5) investScore += 10;
    if (age <= 5 || age >= 30) investScore += 5;
    investScore = Math.min(100, Math.max(40, investScore));

    // 삶의 질 계산
    let lifeScore = 70;
    if (subway_distance_km <= 0.6) lifeScore += 15;
    if (age <= 10) lifeScore += 15;
    lifeScore = Math.min(100, Math.max(40, lifeScore));

    // 학군 점수 (check_schools.js 연동)
    let schoolScore = 75;
    let schoolNote = "보통 학군";
    if (district) {
      try {
        const gu = resolveGu(district);
        const prov = gu?.province === "gyeonggi" ? "경기도" : "서울특별시";
        const highSchools = await getDistrictHighSchoolsData({ district: gu?.name || district, province: prov });
        if (highSchools && !highSchools.isError) {
          const detail = JSON.parse(highSchools.content[1]?.text || "{}");
          const spec = (detail.counts?.specialized || 0) + (detail.counts?.autonomous || 0);
          if (spec >= 5) { schoolScore = 98; schoolNote = `S급 최상위 학군 (자율/특목고 ${spec}개교)`; }
          else if (spec >= 3) { schoolScore = 90; schoolNote = `A급 우수 학군 (자율/특목고 ${spec}개교)`; }
          else if (spec >= 1) { schoolScore = 80; schoolNote = `B급 양호 학군 (자율/특목고 ${spec}개교)`; }
          else { schoolScore = 70; schoolNote = `C급 일반 학군 (일반고 ${detail.counts?.general || 0}개교)`; }
        }
      } catch {
        // 기본값 유지
      }
    }

    // 가중치 적용
    let weightInvest = 0.4, weightLife = 0.4, weightSchool = 0.2;
    let prefLabel = "균형 추구형 (투자 40% + 거주 40% + 학군 20%)";
    if (user_preference === "investment") {
      weightInvest = 0.6; weightLife = 0.25; weightSchool = 0.15;
      prefLabel = "자산 증식형 (투자 60% + 거주 25% + 학군 15%)";
    } else if (user_preference === "life_quality") {
      weightInvest = 0.25; weightLife = 0.55; weightSchool = 0.2;
      prefLabel = "실거주 만족형 (투자 25% + 거주 55% + 학군 20%)";
    } else if (user_preference === "education") {
      weightInvest = 0.25; weightLife = 0.25; weightSchool = 0.5;
      prefLabel = "학군/자녀 교육 집중형 (학군 50% + 거주 25% + 투자 25%)";
    }

    const compositeScore = +(investScore * weightInvest + lifeScore * weightLife + schoolScore * weightSchool).toFixed(1);
    const grade = scoreToGrade(compositeScore);

    let actionSignal = "🟢 강력 추천 (매수 적극 고려)";
    if (compositeScore < 70) actionSignal = "🔴 관망 권고 (가격 또는 입지 재검토)";
    else if (compositeScore < 80) actionSignal = "🟡 조건부 추천 (호가 조정 및 현장 확인 필요)";

    const report =
      `🏆 [A2A 부동산 맞춤 추천 리포트: ${property_name} (check_schools 학군 연동)]\n` +
      `• 매물 조건: ${(price_10k / 10000).toFixed(2)}억원 | 전용 ${area_m2}㎡ (${pyeong.toFixed(1)}평) | ${building_year}년식\n` +
      `• 분석 성향: ${prefLabel}\n\n` +
      `📊 [종합 점수]: ${compositeScore}점 / 100점 (${grade})\n` +
      `• 💰 투자가치 점수: ${investScore}점 (평당 ${pricePerPyeong_10k.toLocaleString()}만원)\n` +
      `• 🌿 삶의질 점수: ${lifeScore}점 (역거리 ${Math.round(subway_distance_km * 1000)}m)\n` +
      `• 🎓 학군 점수: ${schoolScore}점 (${schoolNote})\n\n` +
      `🚦 판정 신호: ${actionSignal}`;

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            {
              property_name,
              district: district || "미지정",
              price_10k,
              user_preference,
              composite_score: compositeScore,
              grade,
              investment_score: investScore,
              life_quality_score: lifeScore,
              education_score: schoolScore,
              action_signal: actionSignal,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// check_schools 연동 도구: 학교 및 학습 데이터 직접 조회 브릿지
// ---------------------------------------------------------------------------
server.registerTool(
  "find_school_learning",
  {
    title: "학교 및 학습 정보 조회 (check_schools 연동)",
    description: "check_schools.js 및 schoolinfo-mcp를 통해 특정 학교의 기본정보, 공시, 급식 식단, 학사일정을 통합 조회합니다.",
    inputSchema: {
      school_name: z.string().describe("학교명 (예: '개포중학교', '휘문고등학교', '자양중학교')"),
      query_type: z.enum(["all", "info", "meal", "schedule", "digest"]).default("all").describe("조회할 학습/학교 정보 유형 ('all': 전체 종합, 'info': 기본정보, 'meal': 급식, 'schedule': 학사일정, 'digest': 학부모공시)"),
    },
  },
  async ({ school_name, query_type = "all" }) => {
    try {
      const results = {};

      if (query_type === "all" || query_type === "info") {
        const srch = await searchSchools({ name: school_name });
        results.info = srch?.content?.[0]?.text;
      }
      if (query_type === "all" || query_type === "digest") {
        const dig = await getParentDigestData({ school_name });
        results.digest = dig?.content?.[0]?.text;
      }
      if (query_type === "all" || query_type === "meal") {
        const ml = await getSchoolMealData({ school_name });
        results.meal = ml?.content?.[0]?.text;
      }
      if (query_type === "all" || query_type === "schedule") {
        const sc = await getSchoolScheduleData({ school_name });
        results.schedule = sc?.content?.[0]?.text;
      }

      const report =
        `🏫 [${school_name}] 학교 및 학습 정보 조회 결과 (check_schools.js 연동)\n\n` +
        Object.entries(results)
          .map(([k, v]) => `[${k.toUpperCase()}]\n${v || "데이터 없음"}`)
          .join("\n\n--------------------\n\n");

      return {
        content: [
          { type: "text", text: report },
          { type: "text", text: JSON.stringify({ school_name, query_type, results }, null, 2) },
        ],
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ 학교 및 학습 정보 조회 실패: ${e.message}` }] };
    }
  }
);

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("서울·수도권 종합 부동산 인사이트 MCP Server (tae0y + A2A-MCP + check_schools 연동 완성, 28 tools) 실행 중. (stdio)");
}
main().catch((e) => {
  console.error("치명적 오류:", e);
  process.exit(1);
});


