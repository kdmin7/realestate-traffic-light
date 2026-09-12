import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, "realestate-server.js");

console.log("🔍 [1/4] MCP 서버 프로세스 기동 중...");
const serverProcess = spawn("node", [serverPath], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

let buffer = "";
const responses = [];

serverProcess.stdout.on("data", (data) => {
  buffer += data.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop(); // 남은 불완전한 줄 유지

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      responses.push(parsed);
      console.log(`📥 [수신 ID: ${parsed.id ?? "알림"}] 응답 수신 성공`);
    } catch (e) {
      // JSON이 아닌 일반 출력 무시
    }
  }
});

serverProcess.stderr.on("data", (data) => {
  const msg = data.toString().trim();
  if (msg) console.log(`[서버 로그] ${msg}`);
});

function sendRpc(msg) {
  const payload = JSON.stringify(msg) + "\n";
  serverProcess.stdin.write(payload);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runHealthCheck() {
  await sleep(1000);

  // 1. Initialize 핸드셰이크
  console.log("\n🚀 [2/4] MCP Initialize 핸드셰이크 전송...");
  sendRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-health-checker", version: "1.0.0" },
    },
  });

  await sleep(1200);

  // 2. tools/list 도구 목록 조회
  console.log("\n📋 [3/4] 등록 도구 목록(tools/list) 검증...");
  sendRpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  });

  await sleep(1500);

  // 3. 주요 도구 호출 테스트 (tools/call)
  console.log("\n🧪 [4/4] 주요 도구별 데이터 입력 & 응답 검증 (tools/call)...");

  // A. 지역코드 변환 도구 테스트
  sendRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "get_region_code",
      arguments: { region_name: "강남구" },
    },
  });

  // B. 금융 대출 계산기 도구 테스트
  sendRpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "calculate_loan_payment",
      arguments: { principal_10k: 30000, annual_rate_pct: 4.2, years: 30 },
    },
  });

  // C. A2A 지하철역 검색 도구 테스트
  sendRpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "find_nearest_subway_stations",
      arguments: { address: "강남구 대치동", limit: 3 },
    },
  });

  // D. A2A 종합 맞춤 추천 도구 테스트
  sendRpc({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "recommend_property",
      arguments: {
        property_name: "대치은마",
        price_10k: 240000,
        area_m2: 84.5,
        user_preference: "investment",
        building_year: 1979,
        subway_distance_km: 0.3,
      },
    },
  });

  await sleep(3500);

  // 결과 종합
  console.log("\n==========================================");
  console.log("🏁 [종합 점검 결과 보고]");
  console.log("==========================================");

  const initRes = responses.find((r) => r.id === 1);
  const listRes = responses.find((r) => r.id === 2);
  const regionRes = responses.find((r) => r.id === 3);
  const loanRes = responses.find((r) => r.id === 4);
  const subwayRes = responses.find((r) => r.id === 5);
  const recRes = responses.find((r) => r.id === 6);

  console.log(`1. MCP 서버 초기화(Handshake): ${initRes ? "✅ 정상" : "❌ 실패"}`);

  if (listRes?.result?.tools) {
    console.log(`2. 등록 도구 개수: ✅ 총 ${listRes.result.tools.length}개 도구 정상 등록됨`);
  } else {
    console.log(`2. 등록 도구 개수: ❌ 도구 목록 조회 실패`);
  }

  console.log(`3. get_region_code 응답: ${regionRes?.result?.content ? "✅ 정상 입력/출력 완료" : "❌ 오류"}`);
  if (regionRes?.result?.content?.[0]?.text) {
    console.log(`   👉 출력 샘플: ${regionRes.result.content[0].text}`);
  }

  console.log(`4. calculate_loan_payment 응답: ${loanRes?.result?.content ? "✅ 정상 계산 완료" : "❌ 오류"}`);
  if (loanRes?.result?.content?.[0]?.text) {
    const preview = loanRes.result.content[0].text.split("\n").slice(0, 3).join(" | ");
    console.log(`   👉 출력 샘플: ${preview}`);
  }

  console.log(`5. find_nearest_subway_stations 응답: ${subwayRes?.result?.content ? "✅ 정상 역세권 분석 완료" : "❌ 오류"}`);
  if (subwayRes?.result?.content?.[0]?.text) {
    const preview = subwayRes.result.content[0].text.split("\n").slice(0, 3).join(" | ");
    console.log(`   👉 출력 샘플: ${preview}`);
  }

  console.log(`6. recommend_property 응답: ${recRes?.result?.content ? "✅ 정상 맞춤 추천 완료" : "❌ 오류"}`);
  if (recRes?.result?.content?.[0]?.text) {
    const preview = recRes.result.content[0].text.split("\n").slice(0, 3).join(" | ");
    console.log(`   👉 출력 샘플: ${preview}`);
  }

  console.log("==========================================\n");

  serverProcess.kill();
  process.exit(0);
}

runHealthCheck().catch((err) => {
  console.error("점검 중 오류 발생:", err);
  serverProcess.kill();
  process.exit(1);
});
