#!/usr/bin/env node
/**
 * crime-collector-server.js
 * 
 * 경찰청 범죄 발생 지역별 통계 데이터 수집 및 분석을 위한 전용 MCP 서버
 * 
 * 데이터 소스:
 *   - 경찰청_범죄발생지역별 통계 OpenAPI (공공데이터포털 odcloud)
 *   - Swagger 문서: https://infuser.odcloud.kr/oas/docs?namespace=3074462/v1
 * 
 * 저장 경로:
 *   - data/crime/{year}.csv (UTF-8 BOM 포함)
 *   - data/crime/{year}.json (원본 JSON)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectAndSaveYear,
  collectAllYears,
  getLocalCrimeStatus,
  CRIME_ENDPOINTS,
  DATA_CRIME_DIR,
} from "./crime-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 수도권 자치구 인구 근사치 (인구 1천명당 범죄율 산출용)
const GU_POP_MAP = {
  종로구: 140000, 중구: 120000, 용산구: 210000, 성동구: 280000, 광진구: 340000,
  동대문구: 340000, 중랑구: 380000, 성북구: 420000, 강북구: 290000, 도봉구: 300000,
  노원구: 490000, 은평구: 460000, 서대문구: 300000, 마포구: 360000, 양천구: 430000,
  강서구: 560000, 구로구: 400000, 금천구: 230000, 영등포구: 380000, 동작구: 380000,
  관악구: 490000, 서초구: 410000, 강남구: 530000, 송파구: 650000, 강동구: 460000,
  수원시: 1180000, 성남시: 910000, 고양시: 1060000, 용인시: 1060000, 부천시: 780000,
  안산시: 630000, 안양시: 540000, 남양주시: 730000, 화성시: 960000, 평택시: 590000,
  의정부시: 460000, 시흥시: 520000, 파주시: 500000, 김포시: 490000, 광명시: 280000,
  광주시: 400000, 군포시: 260000, 이천시: 220000, 오산시: 240000, 하남시: 330000,
  양주시: 270000, 구리시: 190000, 안성시: 190000, 포천시: 140000, 의왕시: 160000,
  여주시: 110000, 동두천시: 90000, 과천시: 84000, 가평군: 60000, 양평군: 120000, 연천군: 40000,
};

const CRIME5_KEYWORDS = ["살인", "강도", "강간", "추행", "절도", "폭력"];

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}

// MCP 서버 초기화
const server = new McpServer({
  name: "crime-data-mcp",
  version: "1.0.0",
});

// 도구 1: 범죄 데이터 수집
server.registerTool(
  "collect_crime_data",
  {
    title: "경찰청 범죄 데이터 수집",
    description:
      "경찰청_범죄발생지역별 통계 API (https://infuser.odcloud.kr/oas/docs?namespace=3074462/v1)에서 " +
      "데이터를 수집하여 data/crime/{year}.csv 및 json에 저장합니다. year 생략 시 2012~2024 전체 연도를 수집합니다.",
    inputSchema: {
      year: z.number().optional().describe("수집할 연도 (2012 ~ 2024, 생략 시 전체 수집)"),
      overwrite: z.boolean().default(true).describe("기존 파일 덮어쓰기 여부"),
    },
  },
  async ({ year, overwrite }) => {
    try {
      if (year) {
        if (!CRIME_ENDPOINTS[year]) {
          return errorResult(`지원하지 않는 연도입니다: ${year}. 지원 연도: 2012 ~ 2024`);
        }
        const res = await collectAndSaveYear(year, { overwrite });
        return jsonResult({
          message: `${year}년 범죄 데이터 수집 완료`,
          result: res,
          storage: DATA_CRIME_DIR,
        });
      } else {
        const manifest = await collectAllYears({ overwrite });
        return jsonResult({
          message: "전체 연도(2012~2024) 범죄 데이터 일괄 수집 완료",
          manifest,
          storage: DATA_CRIME_DIR,
        });
      }
    } catch (err) {
      return errorResult(`데이터 수집 중 오류: ${err.message}`);
    }
  }
);

// 도구 2: 수집 현황 확인
server.registerTool(
  "list_crime_status",
  {
    title: "범죄 데이터 저장 현황 조회",
    description: "로컬 data/crime 폴더에 수집된 연도별 CSV 및 JSON 파일 현황을 조회합니다.",
    inputSchema: {},
  },
  async () => {
    try {
      const status = getLocalCrimeStatus();
      return jsonResult(status);
    } catch (err) {
      return errorResult(`현황 조회 중 오류: ${err.message}`);
    }
  }
);

// 도구 3: 특정 지역 범죄 통계 및 위험도 분석
server.registerTool(
  "get_crime_analysis",
  {
    title: "지역 범죄율 및 위험도 분석",
    description:
      "수집된 데이터를 바탕으로 특정 자치구 또는 시/군의 5대 강력범죄 건수, 세부 범죄유형별 통계, " +
      "인구 1천명당 범죄율 및 안전 지표를 분석합니다.",
    inputSchema: {
      district: z.string().describe("분석할 지역명 (예: 강남구, 송파구, 고양시, 수원시)"),
      year: z.number().optional().describe("분석 기준 연도 (생략 시 최신 연도인 2024년)"),
    },
  },
  async ({ district, year = 2024 }) => {
    try {
      const jsonPath = path.join(DATA_CRIME_DIR, `${year}.json`);
      if (!fs.existsSync(jsonPath)) {
        return errorResult(
          `${year}년 범죄 데이터가 로컬에 없습니다. collect_crime_data 도구를 실행하여 먼저 수집하세요.`
        );
      }

      const rawRows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const normQuery = district.replace(/\s|서울특별시|서울|경기도|경기/g, "");

      // 해당 지역 컬럼 찾기
      const sample = rawRows[0] || {};
      const targetCol = Object.keys(sample).find((k) => {
        const nk = k.replace(/\s|서울특별시|서울|경기도|경기/g, "");
        return nk === normQuery || nk.includes(normQuery);
      });

      if (!targetCol) {
        return errorResult(`'${district}'에 해당하는 지역 컬럼을 ${year}년 데이터에서 찾지 못했습니다.`);
      }

      let totalCrimes = 0;
      let crime5Total = 0;
      const crime5Detail = {};
      const allCategoryBreakdown = {};

      for (const row of rawRows) {
        const major = row["범죄대분류"] || "기타";
        const mid = row["범죄중분류"] || "";
        const cnt = Number(row[targetCol]) || 0;

        totalCrimes += cnt;
        if (!allCategoryBreakdown[major]) allCategoryBreakdown[major] = 0;
        allCategoryBreakdown[major] += cnt;

        const is5Major = CRIME5_KEYWORDS.some((kw) => mid.includes(kw) || major.includes(kw));
        if (is5Major) {
          crime5Total += cnt;
          crime5Detail[mid || major] = (crime5Detail[mid || major] || 0) + cnt;
        }
      }

      const pop = GU_POP_MAP[normQuery] || null;
      const ratePerThousand = pop ? +((crime5Total / pop) * 1000).toFixed(2) : null;

      return jsonResult({
        지역: targetCol,
        입력지역명: district,
        기준연도: year,
        총범죄건수: totalCrimes,
        "5대강력범죄_건수": crime5Total,
        추정인구: pop,
        "5대범죄율_천명당": ratePerThousand,
        "5대강력범죄_세부현황": crime5Detail,
        범죄대분류별_비중: allCategoryBreakdown,
        출처: "경찰청_범죄발생지역별 통계 (data.go.kr / odcloud.kr)",
      });
    } catch (err) {
      return errorResult(`분석 중 오류: ${err.message}`);
    }
  }
);

// 도구 4: 지역별 범죄 추이(다년도 트렌드)
server.registerTool(
  "get_crime_trends",
  {
    title: "지역별 범죄 연도별 추이 분석",
    description: "2012년부터 2024년까지 특정 지역의 5대 범죄 및 전체 범죄 건수 연도별 증감 추이를 반환합니다.",
    inputSchema: {
      district: z.string().describe("조회할 지역명 (예: 강남구, 서초구, 고양, 수원)"),
    },
  },
  async ({ district }) => {
    try {
      const normQuery = district.replace(/\s|서울특별시|서울|경기도|경기/g, "");
      const years = Object.keys(CRIME_ENDPOINTS).map(Number).sort((a, b) => a - b);
      const trend = [];

      for (const y of years) {
        const jsonPath = path.join(DATA_CRIME_DIR, `${y}.json`);
        if (!fs.existsSync(jsonPath)) continue;

        const rows = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        const sample = rows[0] || {};
        const col = Object.keys(sample).find((k) => {
          const nk = k.replace(/\s|서울특별시|서울|경기도|경기/g, "");
          return nk === normQuery || nk.includes(normQuery);
        });

        if (!col) continue;

        let yearTotal = 0;
        let year5 = 0;
        for (const row of rows) {
          const major = row["범죄대분류"] || "";
          const mid = row["범죄중분류"] || "";
          const cnt = Number(row[col]) || 0;
          yearTotal += cnt;
          if (CRIME5_KEYWORDS.some((kw) => mid.includes(kw) || major.includes(kw))) {
            year5 += cnt;
          }
        }

        trend.push({
          연도: y,
          컬럼명: col,
          "5대범죄건수": year5,
          전체범죄건수: yearTotal,
        });
      }

      if (!trend.length) {
        return errorResult(`'${district}'에 대한 연도별 데이터를 찾을 수 없습니다.`);
      }

      return jsonResult({
        지역: district,
        데이터연도수: trend.length,
        추이: trend,
      });
    } catch (err) {
      return errorResult(`트렌드 조회 중 오류: ${err.message}`);
    }
  }
);

// CLI 직접 실행 시 (동기화/수집 옵션)
if (process.argv.includes("--sync")) {
  console.log("경찰청 범죄 데이터 전체 동기화 시작...");
  collectAllYears().then((manifest) => {
    console.log("동기화 완료:", JSON.stringify(manifest, null, 2));
    process.exit(0);
  }).catch((err) => {
    console.error("동기화 오류:", err);
    process.exit(1);
  });
} else {
  // Stdio MCP 서버 기동
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Crime Data MCP Server running on stdio");
}
