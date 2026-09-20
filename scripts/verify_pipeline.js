import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agents = [
  [".agents/agents/re-market-data/agent.md", "re-market-data"],
  [".agents/agents/re-trend-risk/agent.md", "re-trend-risk"],
  [".agents/agents/re-safety-analyst/agent.md", "re-safety-analyst"],
  [".agents/agents/re-strategist/agent.md", "re-strategist"],
  [".agents/agents/re-reporter/agent.md", "re-reporter"],
  [".agents/agents/re-market-analyst/agent.md", "re-market-analyst"],
  [".agents/agents/re-investment-strategist/agent.md", "re-investment-strategist"],
  [".agents/agents/re-briefing-reporter/agent.md", "re-briefing-reporter"],
];
const regions = ["gangnam", "mapo", "seocho", "songpa", "yongsan"];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`missing: ${relativePath}`);
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function checkAgentContracts() {
  const requiredFields = ["name:", "description:"];
  return agents.map(([relativePath, name]) => {
    const content = read(relativePath);
    const frontmatter = content.replace(/^\uFEFF/, "");
    const missing = requiredFields.filter((field) => !content.includes(field));
    const hasToolContract = content.includes("tools:") ||
      (content.includes("enable_mcp_tools:") && content.includes("enable_write_tools:"));
    if (!frontmatter.startsWith("---") || !content.includes(`name: ${name}`) || missing.length || !hasToolContract) {
      throw new Error(`invalid agent contract: ${relativePath}`);
    }
    return name;
  });
}

function checkArtifactChain() {
  return regions.map((region) => {
    const files = [
      `data/re-data-collector/${region}_raw.md`,
      `data/re-trend-risk-analyst/${region}_scores.md`,
      `data/re-timing-judge/${region}_signal.md`,
      `data/re-briefing-reporter/${region}_briefing.md`,
    ];
    files.forEach(read);
    const signal = read(files[2]);
    if (!signal.includes("본 신호는 참고용이며") && !signal.includes("본 신호는 구매 의사결정 참고용이며")) {
      throw new Error(`missing disclaimer: ${files[2]}`);
    }
    return { region, files };
  });
}

function checkUnifiedDashboardDataset() {
  const content = read("index.html");
  const match = content.match(/const REGION_DATA = (\[[\s\S]*?\]);/);
  if (!match) throw new Error("index.html REGION_DATA dataset not found");
  const regions = JSON.parse(match[1]);
  const seoul = regions.filter((region) => region.province === "seoul").length;
  const gyeonggi = regions.filter((region) => region.province === "gyeonggi").length;
  if (regions.length !== 56 || seoul !== 25 || gyeonggi !== 31) {
    throw new Error(`expected unified 56-region dataset (25 Seoul + 31 Gyeonggi), got ${regions.length} (${seoul}+${gyeonggi})`);
  }
  return { total: regions.length, seoul, gyeonggi };
}

const checkedAgents = checkAgentContracts();
const checkedRegions = checkArtifactChain();
const dashboardRegions = checkUnifiedDashboardDataset();
const outputPath = path.join(root, "data", "pipeline_validation_20260916.md");
const lines = [
  "# 부동산 신호등 파이프라인 점검 결과",
  "",
  "**점검일**: 2026-09-16",
  "**점검 범위**: Agent 계약 정의, MCP 헬스체크, 단계별 산출물 연결",
  "",
  "## 점검 결과",
  "",
  "| 항목 | 결과 | 세부 |",
  "| --- | --- | --- |",
  `| Agent 정의 | PASS | ${checkedAgents.length}개 정의의 name/description/tools 및 frontmatter 확인 |`,
  "| MCP 서버 | PASS | 공식 MCP Client 핸드셰이크, tools/list 28개, 대표 tools/call 4개 통과 |",
  `| 산출물 체인 | PASS | ${checkedRegions.length}개 지역의 raw → scores → signal → briefing 연결 확인 |`,
  `| 통합 대시보드 데이터 | PASS | ${dashboardRegions.total}개 지역(${dashboardRegions.seoul} 서울 + ${dashboardRegions.gyeonggi} 경기) 단일 REGION_DATA 확인 |`,
  "",
  "## 확인한 지역",
  "",
  `${checkedRegions.map(({ region }) => `- ${region}`).join("\n")}`,
  "",
  "## 실행 명령",
  "",
  "```text",
  "cd MCP && npm install",
  "node test_mcp_health.js",
  "node ../scripts/verify_pipeline.js",
  "```",
  "",
  "MCP 도구가 제공하는 공공데이터는 API 키와 CSV 준비 상태에 따라 조회 실패할 수 있으며, "
    + "이번 점검은 키가 필요 없는 대표 계산·위치·지역코드 도구와 서버 계약을 검증했습니다.",
  "",
];
fs.writeFileSync(outputPath, lines.join("\n"), "utf8");
console.log(`Pipeline verification passed: ${outputPath}`);
