#!/usr/bin/env node
/**
 * 반도체 수출입 조회 MCP Server
 *
 * 관세청_품목별 국가별 수출입실적 API(공공데이터포털)를 사용하여
 * 특정 국가/품목의 수출금액, 수입금액, 무역수지를 조회합니다.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 설정
// ---------------------------------------------------------------------------

const API_URL = "http://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList";
const API_KEY = process.env.CUSTOMS_API_KEY;

/**
 * XML 파서 설정.
 * - parseTagValue / parseAttributeValue 를 false 로 두어
 *   숫자처럼 보이는 문자열(예: 반도체 HS코드 "8541", resultCode "00")을
 *   자동으로 숫자로 변환하지 않고 문자열 그대로 유지합니다.
 *   특히 resultCode 의 "00" 이 숫자 0 으로 바뀌는 것을 방지합니다.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/** 응답 항목을 항상 배열로 정규화합니다. */
function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** 금액 문자열을 안전하게 숫자로 변환합니다(콤마 제거 포함). */
function toNumber(value) {
  if (value === undefined || value === null || value === "") return 0;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 한국어 오류 메시지를 담은 MCP 응답을 생성합니다. */
function errorResult(message) {
  return {
    isError: true,
    content: [{ type: "text", text: `❌ 오류: ${message}` }],
  };
}

// ---------------------------------------------------------------------------
// API 호출
// ---------------------------------------------------------------------------

/**
 * 관세청 품목별 국가별 수출입실적 API 를 호출하고 파싱된 결과를 반환합니다.
 */
async function fetchTrade({ hsSgn, cntyCd, strtYymm, endYymm }) {
  const params = new URLSearchParams({
    serviceKey: API_KEY,
    strtYymm,
    endYymm,
    hsSgn,
    cntyCd,
  });

  const url = `${API_URL}?${params.toString()}`;

  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error(`API 서버에 연결할 수 없습니다. (${e.message})`);
  }

  if (!response.ok) {
    throw new Error(`API 요청이 실패했습니다. (HTTP ${response.status})`);
  }

  const xml = await response.text();

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (e) {
    throw new Error(`API 응답(XML)을 해석하는 데 실패했습니다. (${e.message})`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// MCP 서버 및 Tool 정의
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "semiconductor-trade-server",
  version: "1.0.0",
});

server.registerTool(
  "get_semiconductor_trade",
  {
    title: "반도체 수출입 조회",
    description:
      "관세청 품목별 국가별 수출입실적 API를 사용하여 특정 국가와 반도체 품목의 " +
      "수출금액, 수입금액, 무역수지를 조회합니다.",
    inputSchema: {
      country: z
        .string()
        .describe(
          "조회할 국가 코드(관세청 국가코드, 예: 미국 'US', 중국 'CN', 일본 'JP')"
        ),
      hsCode: z
        .string()
        .default("8541")
        .describe(
          "반도체 품목 HS코드(2~10자리). 예: 다이오드·트랜지스터 '8541', 집적회로 '8542'"
        ),
      startYearMonth: z
        .string()
        .regex(/^\d{6}$/, "YYYYMM 형식(6자리)으로 입력하세요.")
        .describe("조회 시작 연월 (YYYYMM, 예: '202401')"),
      endYearMonth: z
        .string()
        .regex(/^\d{6}$/, "YYYYMM 형식(6자리)으로 입력하세요.")
        .describe("조회 종료 연월 (YYYYMM, 예: '202412')"),
    },
  },
  async ({ country, hsCode, startYearMonth, endYearMonth }) => {
    // 1) 환경변수 확인
    if (!API_KEY) {
      return errorResult(
        "환경변수 CUSTOMS_API_KEY 가 설정되지 않았습니다. " +
          "공공데이터포털에서 발급받은 서비스키를 CUSTOMS_API_KEY 로 설정해 주세요."
      );
    }

    // 2) API 호출
    let parsed;
    try {
      parsed = await fetchTrade({
        hsSgn: hsCode,
        cntyCd: country,
        strtYymm: startYearMonth,
        endYymm: endYearMonth,
      });
    } catch (e) {
      return errorResult(e.message);
    }

    // 3) 응답 구조 확인
    const root = parsed?.response;
    if (!root) {
      return errorResult(
        "API 응답 형식이 올바르지 않습니다. 요청 값과 서비스키를 확인해 주세요."
      );
    }

    const header = root.header ?? {};
    // resultCode 는 "00" 처럼 앞자리 0 이 의미를 가지므로 반드시 문자열로 유지합니다.
    const resultCode = String(header.resultCode ?? "");
    const resultMsg = header.resultMsg ?? "메시지 없음";

    // 4) 정상 응답 조건: resultCode 가 "00" 인 경우만 정상으로 처리
    if (resultCode !== "00") {
      return errorResult(
        `API에서 오류를 반환했습니다. (코드: ${resultCode}, 메시지: ${resultMsg})`
      );
    }

    // 5) 결과 항목 파싱
    const items = toArray(root.body?.items?.item);
    if (items.length === 0) {
      return {
        content: [
          {
            type: "text",
            text:
              `📭 조회 결과가 없습니다.\n` +
              `- 국가코드: ${country}\n` +
              `- 품목(HS)코드: ${hsCode}\n` +
              `- 기간: ${startYearMonth} ~ ${endYearMonth}`,
          },
        ],
      };
    }

    // 6) 반환 데이터 구성 (기간/국가명/품목명/수출금액/수입금액/무역수지)
    const rows = items.map((it) => {
      const exportAmount = toNumber(it.expDlr); // 수출금액(달러)
      const importAmount = toNumber(it.impDlr); // 수입금액(달러)
      const balance = toNumber(it.balPayments); // 무역수지(달러)

      // API 응답 필드 매핑
      // - year: 기간(연월/총계)
      // - statCdCntnKor1: 국가명(한글), statCd: 국가코드
      // - statKor: 품목명(한글), hsCd: 품목 HS코드
      const countryName = String(it.statCdCntnKor1 ?? it.statCd ?? country);
      const itemName = String(it.statKor ?? "");
      const itemHs = String(it.hsCd ?? "");

      return {
        기간: String(it.year ?? `${startYearMonth}~${endYearMonth}`),
        국가명: countryName,
        품목명: itemHs && itemHs !== "-" ? `${itemName} (HS ${itemHs})` : itemName,
        수출금액: exportAmount,
        수입금액: importAmount,
        // 무역수지 값이 응답에 없으면 수출-수입으로 계산
        무역수지: it.balPayments !== undefined ? balance : exportAmount - importAmount,
      };
    });

    // 7) 사람이 읽기 좋은 요약 + 구조화된 JSON 을 함께 반환
    const summaryLines = rows.map(
      (r) =>
        `• [${r.기간}] ${r.국가명} / ${r.품목명}\n` +
        `   - 수출금액: ${r.수출금액.toLocaleString("ko-KR")} USD\n` +
        `   - 수입금액: ${r.수입금액.toLocaleString("ko-KR")} USD\n` +
        `   - 무역수지: ${r.무역수지.toLocaleString("ko-KR")} USD`
    );

    return {
      content: [
        {
          type: "text",
          text:
            `✅ 반도체 수출입 조회 결과 (총 ${rows.length}건)\n\n` +
            summaryLines.join("\n\n"),
        },
        {
          type: "text",
          text: JSON.stringify(rows, null, 2),
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio 서버이므로 로그는 stderr 로 출력합니다(stdout 은 MCP 통신용).
  console.error("반도체 수출입 조회 MCP Server 가 실행 중입니다. (stdio)");
}

main().catch((err) => {
  console.error("서버 실행 중 치명적 오류가 발생했습니다:", err);
  process.exit(1);
});
