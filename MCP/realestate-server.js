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
    }),
    valid: (r) => Number.isFinite(r.deposit) && r.area > 0,
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
const CODE_TO_GU = Object.fromEntries(Object.entries(SEOUL_GU).map(([k, v]) => [v, k]));

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
  const code = /^\d{5}$/.test(district) ? district : SEOUL_GU[district];
  if (!code) return null;
  return { code, name: CODE_TO_GU[code] || district };
}
function resolvePeriod(startYearMonth, endYearMonth) {
  const now = new Date();
  const end = endYearMonth ? Number(endYearMonth) : now.getFullYear() * 100 + (now.getMonth() + 1);
  const start = Number(startYearMonth);
  return { start, end };
}

// ---------------------------------------------------------------------------
// 국토부 API 호출 + 캐시 (매매·전월세 공통)
// ---------------------------------------------------------------------------

function cachePath(ds, code, ym) {
  return path.join(CACHE_DIR, ds.cacheSub, code, `${ym}.json`);
}
function readCache(ds, code, ym) {
  try {
    const p = cachePath(ds, code, ym);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch { /* 손상 캐시 무시 */ }
  return null;
}
function writeCache(ds, code, ym, data) {
  try {
    fs.mkdirSync(path.join(CACHE_DIR, ds.cacheSub, code), { recursive: true });
    fs.writeFileSync(cachePath(ds, code, ym), JSON.stringify(data));
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

async function fetchMonth(ds, code, ym) {
  const cached = readCache(ds, code, ym);
  if (cached) return cached;
  const first = await fetchPage(ds, code, ym, 1);
  let all = first.items;
  const pages = Math.ceil(first.total / 100);
  for (let p = 2; p <= pages; p++) all = all.concat((await fetchPage(ds, code, ym, p)).items);
  const rows = all.map(ds.map).filter(ds.valid);
  writeCache(ds, code, ym, rows);
  return rows;
}

/** 지정 기간의 모든 거래를 병합 반환 (실패 월은 건너뜀) */
async function fetchRange(ds, code, months) {
  let failed = 0, lastErr = "";
  const monthly = await pool(months, 6, async (ym) => {
    try { return await fetchMonth(ds, code, ym); }
    catch (e) { failed++; lastErr = e.message; return []; }
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
    title: "자치구 아파트 매매가 분기 트렌드",
    description:
      "국토교통부 아파트 매매 실거래가로 서울 자치구의 분기별 평균가·중위가·평당가·거래량 " +
      "시계열과 CAGR·변동성을 반환합니다. (아파트 매매 전용)",
    inputSchema: {
      district: z.string().describe("서울 자치구 이름(예: '강남구') 또는 코드 5자리(예: '11680')"),
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").default("202301")
        .describe("시작 연월(YYYYMM). 실거래가는 200601부터"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월. 생략 시 이번 달"),
      minAreaM2: z.number().optional().describe("전용면적 하한(㎡)"),
      maxAreaM2: z.number().optional().describe("전용면적 상한(㎡)"),
    },
  },
  async ({ district, startYearMonth, endYearMonth, minAreaM2, maxAreaM2 }) => {
    if (!MOLIT_KEY) return errorResult("환경변수 MOLIT_API_KEY 가 설정되지 않았습니다.");
    const gu = resolveGu(district);
    if (!gu) return errorResult(`자치구 '${district}' 를 찾을 수 없습니다. (예: 강남구, 11680)`);
    const { start, end } = resolvePeriod(startYearMonth, endYearMonth);
    if (start > end) return errorResult("시작 연월이 종료 연월보다 늦습니다.");
    if (start < 200601) return errorResult("실거래가는 2006년 1월(200601)부터 제공됩니다.");
    const months = monthRange(start, end);
    if (months.length > 300) return errorResult(`조회 범위가 너무 넓습니다(${months.length}개월).`);

    const { rows: all, failed, lastErr } = await fetchRange(DATASETS.sale, gu.code, months);
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
    title: "자치구 전세가율 분기 추이",
    description:
      "국토부 매매+전월세 실거래가를 결합해 자치구의 분기별 전세가율(전세 ₩/㎡ ÷ 매매 ₩/㎡)과 " +
      "월세 비중을 반환합니다. 전세가율은 갭투자·임대수익 판단의 핵심 참고 지표입니다.",
    inputSchema: {
      district: z.string().describe("서울 자치구 이름 또는 코드 5자리"),
      startYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").default("202301").describe("시작 연월(YYYYMM). 전월세는 201101 이후 신뢰도↑"),
      endYearMonth: z.string().regex(/^\d{6}$/, "YYYYMM").optional().describe("종료 연월. 생략 시 이번 달"),
    },
  },
  async ({ district, startYearMonth, endYearMonth }) => {
    if (!MOLIT_KEY) return errorResult("환경변수 MOLIT_API_KEY 가 설정되지 않았습니다.");
    const gu = resolveGu(district);
    if (!gu) return errorResult(`자치구 '${district}' 를 찾을 수 없습니다.`);
    const { start, end } = resolvePeriod(startYearMonth, endYearMonth);
    if (start > end) return errorResult("시작 연월이 종료 연월보다 늦습니다.");
    if (start < 200601) return errorResult("실거래가는 2006년 1월(200601)부터 제공됩니다.");
    const months = monthRange(start, end);
    if (months.length > 300) return errorResult(`조회 범위가 너무 넓습니다(${months.length}개월).`);

    const [sale, rent] = await Promise.all([
      fetchRange(DATASETS.sale, gu.code, months),
      fetchRange(DATASETS.rent, gu.code, months),
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

const norm = (s) => String(s).replace(/\s|서울특별시|서울/g, "");
const listCsv = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => /\.csv$/i.test(f)).map((f) => path.join(dir, f)); }
  catch { return []; }
};
const yearFromName = (f) => { const m = path.basename(f).match(/(19|20)\d{2}/); return m ? Number(m[0]) : null; };

// 자치구 인구(2024년 주민등록인구 근사값, 명) — 범죄율 정규화용. populationOverride로 교체 가능.
const GU_POP_2024 = {
  종로구: 140000, 중구: 120000, 용산구: 210000, 성동구: 280000, 광진구: 340000,
  동대문구: 340000, 중랑구: 380000, 성북구: 420000, 강북구: 290000, 도봉구: 300000,
  노원구: 490000, 은평구: 460000, 서대문구: 300000, 마포구: 360000, 양천구: 430000,
  강서구: 560000, 구로구: 400000, 금천구: 230000, 영등포구: 380000, 동작구: 380000,
  관악구: 490000, 서초구: 410000, 강남구: 530000, 송파구: 650000, 강동구: 460000,
};
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

async function neisSchoolPage(pIndex) {
  const params = new URLSearchParams({
    KEY: NEIS_KEY, Type: "json", pIndex: String(pIndex), pSize: "1000",
    SCHUL_KND_SC_NM: "고등학교", LCTN_SC_NM: "서울특별시",
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

server.registerTool(
  "get_school_index",
  {
    title: "자치구 학군 지수(자사·특목고 밀도)",
    description:
      "NEIS 학교기본정보로 서울 자치구별 고등학교 수와 자율·특목고 수를 집계해 학군 지수(proxy)를 " +
      "반환합니다. '서울대 진학률'은 비공개라 자율·특목고 밀도로 근사합니다.",
    inputSchema: {
      district: z.string().optional().describe("자치구 이름/코드(생략 시 25개 구 순위)"),
    },
  },
  async ({ district }) => {
    if (!NEIS_KEY) return errorResult("환경변수 NEIS_API_KEY 가 설정되지 않았습니다. open.neis.go.kr 에서 발급하세요.");
    const gu = district ? resolveGu(district) : null;
    // 3개월(분기) 단위 캐시 처리 (학군 데이터는 3개월 단위 취합)
    const now = new Date();
    const currentQuarterKey = `${now.getFullYear()}Q${quarterOf(now.getMonth() + 1)}`;
    const schoolCacheDir = path.join(CACHE_DIR, "school-index");
    const schoolCacheFile = path.join(schoolCacheDir, `${currentQuarterKey}.json`);

    let rows = [];
    if (fs.existsSync(schoolCacheFile)) {
      try { rows = JSON.parse(fs.readFileSync(schoolCacheFile, "utf8")); }
      catch { rows = []; }
    }

    if (!rows.length) {
      try {
        const first = await neisSchoolPage(1);
        rows = first.rows;
        const pages = Math.ceil(first.total / 1000);
        for (let p = 2; p <= pages; p++) rows = rows.concat((await neisSchoolPage(p)).rows);
        if (rows.length) {
          fs.mkdirSync(schoolCacheDir, { recursive: true });
          fs.writeFileSync(schoolCacheFile, JSON.stringify(rows));
        }
      } catch (e) { return errorResult(`NEIS 조회 실패 — ${e.message}`); }
    }
    if (!rows.length) return errorResult("NEIS에서 학교 목록을 받지 못했습니다.");

    // 자치구별 집계
    const stat = {}; // guName -> {total, special}
    for (const name of Object.keys(SEOUL_GU)) stat[name] = { total: 0, special: 0, schools: [] };
    for (const r of rows) {
      const addr = String(r.ORG_RDNMA ?? r.ORG_RDNZC ?? "");
      const gname = Object.keys(SEOUL_GU).find((n) => addr.includes(n));
      if (!gname) continue;
      const blob = Object.values(r).map(String).join(" ");        // 모든 필드값 스캔
      const isSpecial = SPECIAL_HS.some((k) => blob.includes(k)) && !blob.includes("특성화");
      stat[gname].total++;
      if (isSpecial) { stat[gname].special++; stat[gname].schools.push(String(r.SCHUL_NM ?? "")); }
    }

    const build = (name) => {
      const s = stat[name];
      // 학군지수 = 자율·특목고 밀도(특목·자율 수 × 3 + 일반고 수 × 1), 상대 비교용 원점수
      const index = s.special * 3 + (s.total - s.special);
      return { 자치구: name, 고교수: s.total, 자율특목고수: s.special, 학군지수: index, 자율특목고: s.schools };
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
    const all = Object.keys(SEOUL_GU).map(build).sort((a, b) => b.학군지수 - a.학군지수);
    const lines = all.map((s, i) => `${String(i + 1).padStart(2)}. ${s.자치구}  지수 ${s.학군지수} (고교 ${s.고교수} · 자율특목 ${s.자율특목고수})`);
    return {
      content: [
        { type: "text", text: `🎓 자치구 학군 지수 순위 (자율·특목고 밀도 기준)\n\n${lines.join("\n")}` },
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
async function collectSchool() {
  if (!NEIS_KEY) return null;
  try {
    let rows = [];
    const first = await neisSchoolPage(1); rows = first.rows;
    const pages = Math.ceil(first.total / 1000);
    for (let p = 2; p <= pages; p++) rows = rows.concat((await neisSchoolPage(p)).rows);
    const acc = {};
    for (const n of Object.keys(SEOUL_GU)) acc[n] = { t: 0, s: 0 };
    for (const r of rows) {
      const g = Object.keys(SEOUL_GU).find((n) => String(r.ORG_RDNMA ?? "").includes(n));
      if (!g) continue;
      const blob = Object.values(r).map(String).join(" ");
      acc[g].t++; if (SPECIAL_HS.some((k) => blob.includes(k)) && !blob.includes("특성화")) acc[g].s++;
    }
    const m = new Map();
    for (const [g, v] of Object.entries(acc)) if (v.t) m.set(g, v.s * 3 + (v.t - v.s));
    return m.size ? m : null;
  } catch { return null; }
}
function collectCrime(year, pop) {
  const files = listCsv(path.join(DATA_DIR, "crime"));
  if (!files.length) return null;
  const file = files.find((f) => year && yearFromName(f) === year) || files.sort((a, b) => (yearFromName(b) || 0) - (yearFromName(a) || 0))[0];
  let header, rows;
  try { ({ header, rows } = readCsvSmart(file)); } catch { return null; }
  const guCols = {};
  header.forEach((h, i) => { const nh = norm(h); for (const n of Object.keys(SEOUL_GU)) if (nh === norm(n)) guCols[n] = i; });
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
function collectIncome(year) {
  return collectFromCsvMap("income", (files) => {
    const latest = new Map(); // gu -> {year, v}
    for (const file of files) {
      let header, rows; try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      const iR = header.findIndex((h) => /지역|시군구|행정구역|자치구|구분|권역/.test(h) && !/소득/.test(h));
      if (iR < 0) continue;
      const yc = header.map((h, i) => ({ y: (h.match(/(19|20)\d{2}/) || [])[0], i })).filter((x) => x.y).map((x) => ({ year: +x.y, i: x.i }));
      const iInc = header.findIndex((h) => /소득|금액/.test(h)), iY = header.findIndex((h) => /연도|년도|시점|기간|year/i.test(h));
      for (const row of rows) {
        const g = Object.keys(SEOUL_GU).find((n) => norm(row[iR] || "") === norm(n) || String(row[iR] || "").includes(n));
        if (!g) continue;
        const push = (y, v) => { if (!year || y === year) { const c = latest.get(g); if (!c || y >= c.year) latest.set(g, { year: y, v }); } };
        if (yc.length) for (const x of yc) { const v = Number(String(row[x.i] || "").replace(/[,\s]/g, "")); if (v) push(x.year, v); }
        else if (iInc >= 0) { const v = Number(String(row[iInc] || "").replace(/[,\s]/g, "")); const y = iY >= 0 ? Number(String(row[iY]).match(/(19|20)\d{2}/)?.[0]) : yearFromName(file); if (v && y) push(y, v); }
      }
    }
    const m = new Map(); for (const [g, o] of latest) m.set(g, o.v); return m;
  });
}
function collectLiving(from, to) {
  return collectFromCsvMap("living_pop", (files) => {
    const agg = new Map(); // gu -> Map(ym->{sum,n})
    for (const file of files) {
      let header, rows; try { ({ header, rows } = readCsvSmart(file)); } catch { continue; }
      const iD = header.findIndex((h) => /기준일|일자|날짜|date/i.test(h));
      const iG = header.findIndex((h) => /자치구코드|자치구|구코드|gu/i.test(h));
      const iP = header.findIndex((h) => /총생활인구|생활인구수|인구수|population/i.test(h));
      if (iD < 0 || iG < 0 || iP < 0) continue;
      for (const row of rows) {
        const ym = Number(String(row[iD] || "").slice(0, 6)); if (!ym) continue;
        if (from && ym < from) continue; if (to && ym > to) continue;
        const g = CODE_TO_GU[String(row[iG] || "").trim()] || Object.keys(SEOUL_GU).find((n) => norm(n) === norm(row[iG] || ""));
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
      districts: z.array(z.string()).optional().describe("대상 자치구 목록(생략 시 25개 구 전체)"),
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
      collectSchool(),
      Promise.resolve(collectLiving(null, null)),
      Promise.resolve(collectIncome(incomeYear)),
    ]);
    const crime = collectCrime(crimeYear, GU_POP_2024);
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

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("서울 부동산 인사이트 MCP Server(Phase 2 완성, 8 tools) 실행 중. (stdio)");
}
main().catch((e) => { console.error("치명적 오류:", e); process.exit(1); });
