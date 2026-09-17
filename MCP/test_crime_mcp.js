import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "crime-collector-server.js");

const client = new Client(
  { name: "crime-mcp-test-client", version: "1.0.0" },
  { capabilities: {} },
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: __dirname,
  stderr: "pipe",
});

async function runTest() {
  console.log("🔍 Crime Collector MCP 서버 기동 및 테스트 시작...");
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`📋 등록된 도구 목록 (${tools.length}개):`);
  tools.forEach(t => console.log(`   - ${t.name}: ${t.description.slice(0, 50)}...`));

  // 1. list_crime_status 호출
  console.log("\n1. list_crime_status 호출 테스트...");
  const resStatus = await client.callTool({ name: "list_crime_status", arguments: {} });
  const statusJson = JSON.parse(resStatus.content[0].text);
  console.log(`✅ 저장된 CSV 개수: ${statusJson.downloadedCsvCount} / ${statusJson.totalSupportedYears}`);

  // 2. get_crime_analysis 호출
  console.log("\n2. get_crime_analysis 호출 테스트 (강남구 2024년)...");
  const resAnalysis = await client.callTool({
    name: "get_crime_analysis",
    arguments: { district: "강남구", year: 2024 },
  });
  const analysisJson = JSON.parse(resAnalysis.content[0].text);
  console.log(`✅ ${analysisJson.지역} (기준연도: ${analysisJson.기준연도})`);
  console.log(`   - 총 범죄: ${analysisJson.총범죄건수}건`);
  console.log(`   - 5대 강력범죄: ${analysisJson["5대강력범죄_건수"]}건 (천명당: ${analysisJson["5대범죄율_천명당"]})`);
  console.log("   - 세부현황:", analysisJson["5대강력범죄_세부현황"]);

  // 3. get_crime_trends 호출
  console.log("\n3. get_crime_trends 호출 테스트 (수원시 추이)...");
  const resTrends = await client.callTool({
    name: "get_crime_trends",
    arguments: { district: "수원시" },
  });
  const trendsJson = JSON.parse(resTrends.content[0].text);
  console.log(`✅ ${trendsJson.지역} 연도별 추이 데이터 ${trendsJson.데이터연도수}개 연도 확보:`);
  trendsJson.추이.slice(-3).forEach(t => {
    console.log(`   - ${t.연도}년: 5대범죄 ${t["5대범죄건수"]}건 / 전체 ${t["전체범죄건수"]}건`);
  });

  await client.close();
  console.log("\n🏁 Crime MCP 서버의 모든 도구 테스트 통과 완료!");
}

runTest().catch(async (err) => {
  console.error("❌ Crime MCP 테스트 실패:", err);
  await client.close().catch(() => {});
  process.exit(1);
});
