import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "realestate-server.js");
const expectedToolCount = 29;

const client = new Client(
  { name: "mcp-health-checker", version: "1.0.0" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: __dirname,
  stderr: "pipe",
});

function assertToolResponse(name, response) {
  if (!response || response.isError || !Array.isArray(response.content)) {
    throw new Error(`${name} returned an invalid MCP response`);
  }
}

async function runHealthCheck() {
  console.log("🔍 MCP 서버 기동 및 공식 Client 핸드셰이크...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`📋 등록 도구 개수: ${tools.length}개`);
  if (tools.length !== expectedToolCount) {
    throw new Error(`expected ${expectedToolCount} tools, received ${tools.length}`);
  }

  const checks = [
    ["get_region_code", { region_name: "강남구" }],
    ["get_crime_rate", { district: "강남구", year: 2024 }],
    ["calculate_loan_payment", { principal_10k: 30000, annual_rate_pct: 4.2, years: 30 }],
    ["find_nearest_subway_stations", { address: "강남구 대치동", limit: 3 }],
    [
      "recommend_property",
      {
        property_name: "대치은마",
        price_10k: 240000,
        area_m2: 84.5,
        user_preference: "investment",
        building_year: 1979,
        subway_distance_km: 0.3,
      },
    ],
  ];

  for (const [name, args] of checks) {
    const response = await client.callTool({ name, arguments: args });
    assertToolResponse(name, response);
    console.log(`✅ ${name}`);
  }

  await client.close();
  console.log("🏁 MCP health check passed");
}

runHealthCheck().catch(async (error) => {
  console.error(`❌ MCP health check failed: ${error.message}`);
  await client.close().catch(() => {});
  process.exitCode = 1;
});
