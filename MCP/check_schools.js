#!/usr/bin/env node
/**
 * 학교정보 & 학군 인사이트 MCP Server (schoolinfo-mcp)
 * 
 * GitHub: https://github.com/chrisryugj/schoolinfo-mcp 연동
 * 데이터 소스:
 *  1. chrisryugj/schoolinfo-mcp 원격 엔드포인트 (https://mcp.gomdori.app/school)
 *  2. NEIS 나이스 교육정보 개방포털 OpenAPI (https://open.neis.go.kr)
 *
 * 제공 도구:
 *  - find_school: 학교명만으로 전국 초·중·고 검색 (schoolinfo-mcp 연동)
 *  - get_school_info: 학교 상세 정보 (주소, 설립일, 관할교육청, 학교구분)
 *  - get_district_high_schools: 자치구/시·군 고등학교 목록 및 학군 유형(특목고/자율고/일반고) 분류
 *  - get_school_meal: 학교 급식 식단 및 칼로리/영양 정보
 *  - get_school_schedule: 학교 학사일정 및 시험/방학 D-day
 *  - get_parent_digest: 학부모 핵심 학교 공시 요약 (학생수, 학급수 등)
 *  - call_remote_schoolinfo: 원격 schoolinfo-mcp 도구 직접 호출 브릿지
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env 로드
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

const NEIS_KEY = process.env.NEIS_API_KEY || "b6923b89aefd4f5585ec16dde1718395";
const REMOTE_MCP_URL = "https://mcp.gomdori.app/school";

const server = new McpServer({
  name: "schoolinfo-mcp-server",
  version: "1.0.0",
});

/** 원격 schoolinfo-mcp 서버 호출 헬퍼 */
async function callRemoteMcp(toolName, args = {}) {
  try {
    const res = await fetch(REMOTE_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`원격 MCP HTTP ${res.status}: ${res.statusText}`);
    }

    const json = await res.json();
    if (json.error) {
      throw new Error(`원격 MCP 에러: ${json.error.message || JSON.stringify(json.error)}`);
    }
    return json.result;
  } catch (err) {
    throw new Error(`schoolinfo-mcp 원격 연결 실패: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 서비스 구현 함수 (도구 핸들러 및 외부 모듈 연동 공용)
// ---------------------------------------------------------------------------

async function searchSchools({ name }) {
  try {
    const remoteRes = await callRemoteMcp("find_school", { name });
    if (remoteRes && remoteRes.content) {
      return remoteRes;
    }
  } catch {
    // 2차 폴백: 로컬 NEIS API 직접 호출
  }

  try {
    const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=20&SCHUL_NM=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.schoolInfo?.[1]?.row || [];

    if (!rows.length) {
      return { content: [{ type: "text", text: `📭 '${name}' 검색 결과가 없습니다.` }] };
    }

    const lines = rows.map((s, i) =>
      `${i + 1}. 🏫 [${s.SCHUL_NM}] (${s.SCHUL_KND_SC_NM}) | ${s.LCTN_SC_NM} | 코드: ${s.SD_SCHUL_CODE}\n   - 주소: ${s.ORG_RDNMA || s.ORG_RDNZC}\n   - 교육청: ${s.ATPT_OFCDC_SC_NM} (${s.ATPT_OFCDC_SC_CODE})`
    );

    return {
      content: [
        { type: "text", text: `🔍 '${name}' 학교 검색 결과 (${rows.length}건)\n\n` + lines.join("\n\n") },
        { type: "text", text: JSON.stringify(rows, null, 2) },
      ],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `❌ 학교 검색 실패: ${e.message}` }] };
  }
}

async function getDistrictHighSchoolsData({ district, province = "서울특별시" }) {
  try {
    const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=1000&SCHUL_KND_SC_NM=${encodeURIComponent("고등학교")}&LCTN_SC_NM=${encodeURIComponent(province)}`;
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.schoolInfo?.[1]?.row || [];

    const filtered = rows.filter((r) =>
      (r.ORG_RDNMA || r.ORG_RDNZC || "").includes(district)
    );

    if (!filtered.length) {
      return { content: [{ type: "text", text: `📭 [${province} ${district}] 고등학교 데이터가 없습니다.` }] };
    }

    const specialized = []; // 특목고
    const autonomous = [];  // 자율고
    const general = [];     // 일반고
    const vocational = [];  // 특성화고

    filtered.forEach((s) => {
      const item = {
        name: s.SCHUL_NM,
        kind: s.HS_GNRL_BUSNS_SC_NM || "일반계",
        purpose: s.HS_PURPS_SMS_NM || "일반고",
        address: s.ORG_RDNMA,
        code: s.SD_SCHUL_CODE,
        officeCode: s.ATPT_OFCDC_SC_CODE,
      };

      const purp = String(s.HS_PURPS_SMS_NM || "");
      if (/외국어고|과학고|국제고|예술고|체육고|마이스터고/.test(purp)) {
        specialized.push(item);
      } else if (/자율/.test(purp)) {
        autonomous.push(item);
      } else if (/특성화/.test(purp)) {
        vocational.push(item);
      } else {
        general.push(item);
      }
    });

    const report =
      `🏫 [${province} ${district}] 고등학교 학군 현황 (총 ${filtered.length}개교)\n` +
      `• 🌟 특목고 (${specialized.length}개교): ${specialized.map((s) => s.name).join(", ") || "없음"}\n` +
      `• 🔷 자율고 (${autonomous.length}개교): ${autonomous.map((s) => s.name).join(", ") || "없음"}\n` +
      `• 📚 일반고 (${general.length}개교): ${general.map((s) => s.name).join(", ")}\n` +
      `• ⚙️ 특성화고 (${vocational.length}개교): ${vocational.map((s) => s.name).join(", ") || "없음"}`;

    return {
      content: [
        { type: "text", text: report },
        {
          type: "text",
          text: JSON.stringify(
            {
              district,
              province,
              total_schools: filtered.length,
              counts: {
                specialized: specialized.length,
                autonomous: autonomous.length,
                general: general.length,
                vocational: vocational.length,
              },
              schools: { specialized, autonomous, general, vocational },
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `❌ 학군 조회 실패: ${e.message}` }] };
  }
}

async function getSchoolMealData({ school_name, date, office_code, school_code }) {
  try {
    try {
      const remoteRes = await callRemoteMcp("get_school_meal", {
        school_name,
        date,
      });
      if (remoteRes && remoteRes.content) return remoteRes;
    } catch {
      // 폴백으로 진행
    }

    let ofcCd = office_code;
    let schCd = school_code;
    if (!schCd || !ofcCd) {
      const srchUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(school_name)}`;
      const sRes = await fetch(srchUrl);
      const sData = await sRes.json();
      const row = sData?.schoolInfo?.[1]?.row?.[0];
      if (!row) return { content: [{ type: "text", text: `📭 '${school_name}' 정보를 찾을 수 없습니다.` }] };
      ofcCd = row.ATPT_OFCDC_SC_CODE;
      schCd = row.SD_SCHUL_CODE;
    }

    const todayStr = date || new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const mealUrl = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=5&ATPT_OFCDC_SC_CODE=${ofcCd}&SD_SCHUL_CODE=${schCd}&MLSV_YMD=${todayStr}`;
    const mRes = await fetch(mealUrl);
    const mData = await mRes.json();
    const mealRow = mData?.mealServiceDietInfo?.[1]?.row?.[0];

    if (!mealRow) {
      return { content: [{ type: "text", text: `🍱 [${school_name}] ${todayStr} 급식 정보가 없거나 휴일입니다.` }] };
    }

    const dish = String(mealRow.DDISH_NM || "").replace(/<br\/>/g, "\n• ");
    const cal = mealRow.CAL_INFO || "칼로리 정보 없음";
    const ntr = String(mealRow.NTR_INFO || "").replace(/<br\/>/g, "\n  ");

    const report =
      `🍱 [${school_name}] ${todayStr} 급식 식단표\n\n` +
      `• ${dish}\n\n` +
      `🔥 열량: ${cal}\n` +
      `📊 영양 정보:\n  ${ntr}`;

    return {
      content: [
        { type: "text", text: report },
        { type: "text", text: JSON.stringify(mealRow, null, 2) },
      ],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `❌ 급식 조회 실패: ${e.message}` }] };
  }
}

async function getSchoolScheduleData({ school_name, from_date, to_date }) {
  try {
    try {
      const remoteRes = await callRemoteMcp("get_school_schedule", {
        school_name,
        from_date,
        to_date,
      });
      if (remoteRes && remoteRes.content) return remoteRes;
    } catch {
      // 폴백
    }

    const srchUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(school_name)}`;
    const sRes = await fetch(srchUrl);
    const sData = await sRes.json();
    const row = sData?.schoolInfo?.[1]?.row?.[0];
    if (!row) return { content: [{ type: "text", text: `📭 '${school_name}' 학교를 찾을 수 없습니다.` }] };

    const ofcCd = row.ATPT_OFCDC_SC_CODE;
    const schCd = row.SD_SCHUL_CODE;

    const now = new Date();
    const from = from_date || `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}01`;
    const to = to_date || `${now.getFullYear()}${String(now.getMonth() + 2).padStart(2, "0")}28`;

    const schedUrl = `https://open.neis.go.kr/hub/SchoolSchedule?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=100&ATPT_OFCDC_SC_CODE=${ofcCd}&SD_SCHUL_CODE=${schCd}&AA_FROM_YMD=${from}&AA_TO_YMD=${to}`;
    const scRes = await fetch(schedUrl);
    const scData = await scRes.json();
    const rows = scData?.SchoolSchedule?.[1]?.row || [];

    if (!rows.length) {
      return { content: [{ type: "text", text: `📅 [${school_name}] ${from} ~ ${to} 기간 내 등록된 학사일정이 없습니다.` }] };
    }

    const lines = rows.map((r) => {
      const dt = `${r.AA_YMD.slice(0, 4)}.${r.AA_YMD.slice(4, 6)}.${r.AA_YMD.slice(6, 8)}`;
      return `• [${dt}] ${r.EVENT_NM} (${r.SBTR_DD_SC_NM || "수업일"})`;
    });

    return {
      content: [
        { type: "text", text: `📅 [${school_name}] 학사일정 (${from} ~ ${to})\n\n` + lines.join("\n") },
        { type: "text", text: JSON.stringify(rows, null, 2) },
      ],
    };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `❌ 학사일정 조회 실패: ${e.message}` }] };
  }
}

async function getParentDigestData({ school_name }) {
  try {
    const remoteRes = await callRemoteMcp("get_parent_digest", {
      school_name,
    });
    if (remoteRes && remoteRes.content) return remoteRes;
  } catch {
    // 원격 실패 시 기본 학교정보로 응답
  }

  const srchUrl = `https://open.neis.go.kr/hub/schoolInfo?KEY=${NEIS_KEY}&Type=json&pIndex=1&pSize=5&SCHUL_NM=${encodeURIComponent(school_name)}`;
  const sRes = await fetch(srchUrl);
  const sData = await sRes.json();
  const row = sData?.schoolInfo?.[1]?.row?.[0];
  if (!row) return { content: [{ type: "text", text: `📭 '${school_name}' 학교를 찾을 수 없습니다.` }] };

  const report =
    `📋 [${row.SCHUL_NM}] 학교 기본 공시 요약\n` +
    `• 학교급: ${row.SCHUL_KND_SC_NM} (${row.FOND_SC_NM} / ${row.COEDU_SC_NM})\n` +
    `• 관할 교육청: ${row.ATPT_OFCDC_SC_NM} (${row.JU_OFCDC_SC_NM})\n` +
    `• 설립일: ${row.FOND_YMD} | 개교기념일: ${row.FOAS_MEMRD}\n` +
    `• 주소: ${row.ORG_RDNMA} (우편번호: ${row.ORG_RDNZC})\n` +
    `• 전화번호: ${row.ORG_TELNO} | 홈페이지: ${row.HMPG_ADRES || "없음"}`;

  return {
    content: [
      { type: "text", text: report },
      { type: "text", text: JSON.stringify(row, null, 2) },
    ],
  };
}

// ---------------------------------------------------------------------------
// 도구 1: 전국 학교 검색 (find_school - schoolinfo-mcp 연동)
// ---------------------------------------------------------------------------
server.registerTool(
  "find_school",
  {
    title: "전국 초·중·고 학교 검색",
    description: "학교명 또는 일부 키워드만으로 전국의 초·중·고등학교를 검색합니다. (시도/지역을 몰라도 전국 검색 가능)",
    inputSchema: {
      name: z.string().describe("학교명 또는 일부 (예: '개포중', '휘문고', '자양중', '한밭초')"),
    },
  },
  searchSchools
);

// ---------------------------------------------------------------------------
// 도구 2: 자치구/시·군 고등학교 목록 및 학군 유형 분류 (get_district_high_schools)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_district_high_schools",
  {
    title: "지역별 고등학교 목록 및 학군 유형 분류",
    description: "서울 25개 자치구 및 경기도 시·군의 고등학교 전체 목록과 특목고/자율고/일반고/특성화고 분류 현황을 반환합니다.",
    inputSchema: {
      district: z.string().describe("지역명 (예: '마포구', '강남구', '분당구', '송파구', '수지구')"),
      province: z.enum(["서울특별시", "경기도"]).default("서울특별시").describe("시도명 (기본: 서울특별시)"),
    },
  },
  getDistrictHighSchoolsData
);

// ---------------------------------------------------------------------------
// 도구 3: 학교 급식 식단 및 영양 정보 (get_school_meal)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_school_meal",
  {
    title: "학교 급식 식단 및 알레르기/칼로리 조회",
    description: "NEIS API 및 schoolinfo-mcp를 통해 특정 학교의 일자별 급식 메뉴, 알레르기 정보, 칼로리를 조회합니다.",
    inputSchema: {
      school_name: z.string().describe("학교명 (예: '개포중학교', '자양중학교', '휘문고등학교')"),
      date: z.string().optional().describe("조회 일자 (YYYYMMDD 형식, 생략 시 오늘)"),
      office_code: z.string().optional().describe("시도교육청코드 (예: 'B10' 서울시교육청)"),
      school_code: z.string().optional().describe("표준학교코드 (생략 시 학교명으로 자동 탐색)"),
    },
  },
  getSchoolMealData
);

// ---------------------------------------------------------------------------
// 도구 4: 학교 학사일정 및 시험/방학 D-day (get_school_schedule)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_school_schedule",
  {
    title: "학교 학사일정 및 시험/방학 D-day 조회",
    description: "NEIS API 및 schoolinfo-mcp를 통해 특정 학교의 학사일정(중간/기말고사, 개학, 방학, 입학식 등)을 조회합니다.",
    inputSchema: {
      school_name: z.string().describe("학교명 (예: '개포중학교', '자양중학교')"),
      from_date: z.string().optional().describe("조회 시작일 (YYYYMMDD 형식, 생략 시 이번 달 초)"),
      to_date: z.string().optional().describe("조회 종료일 (YYYYMMDD 형식, 생략 시 다음 달 말)"),
    },
  },
  getSchoolScheduleData
);

// ---------------------------------------------------------------------------
// 도구 5: 학부모 핵심 공시 요약 (get_parent_digest - schoolinfo-mcp 연동)
// ---------------------------------------------------------------------------
server.registerTool(
  "get_parent_digest",
  {
    title: "학부모 핵심 학교 공시 요약",
    description: "schoolinfo-mcp 학교알리미 연동을 통해 학생수, 학급당 학생수, 교원수, 방과후 프로그램 등 핵심 공시를 한 번에 조회합니다.",
    inputSchema: {
      school_name: z.string().describe("학교명 (예: '개포중학교', '자양중학교', '휘문고')"),
    },
  },
  getParentDigestData
);

// ---------------------------------------------------------------------------
// 도구 6: 원격 schoolinfo-mcp 도구 브릿지 (call_remote_schoolinfo)
// ---------------------------------------------------------------------------
server.registerTool(
  "call_remote_schoolinfo",
  {
    title: "원격 schoolinfo-mcp API 직접 호출 브릿지",
    description: "https://github.com/chrisryugj/schoolinfo-mcp 원격 엔드포인트(https://mcp.gomdori.app/school)의 도구를 직접 호출합니다.",
    inputSchema: {
      tool_name: z.string().describe("호출할 도구명 (예: 'find_school', 'get_parent_digest', 'get_school_meal', 'get_school_schedule')"),
      arguments: z.record(z.any()).optional().default({}).describe("도구 인자 객체"),
    },
  },
  async ({ tool_name, arguments: args }) => {
    try {
      const res = await callRemoteMcp(tool_name, args);
      return res;
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ 원격 schoolinfo-mcp 호출 실패: ${e.message}` }] };
    }
  }
);

// ---------------------------------------------------------------------------
// 핵심 함수 export (realestate-server.js 등 외부 모듈 연동용)
// ---------------------------------------------------------------------------
export {
  callRemoteMcp,
  searchSchools,
  getDistrictHighSchoolsData,
  getSchoolMealData,
  getSchoolScheduleData,
  getParentDigestData,
};

// ---------------------------------------------------------------------------
// 실행 (CLI로 직접 실행 시에만 stdio Transport 활성화)
// ---------------------------------------------------------------------------
async function main() {
  await server.connect(new StdioServerTransport());
  console.error("우리학교 알리미 & 학군 분석 MCP Server (schoolinfo-mcp 연동 완성) 실행 중. (stdio)");
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith("check_schools.js") ||
  process.argv[1].includes("check_schools")
);

if (isDirectRun && (!process.env.MCP_DISABLE_AUTO_START || process.env.MCP_DISABLE_AUTO_START !== "true")) {
  main().catch((err) => {
    console.error("치명적 오류:", err);
    process.exit(1);
  });
}


