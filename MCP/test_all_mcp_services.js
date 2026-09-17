/**
 * test_all_mcp_services.js
 * 모든 MCP 서버 및 데이터 연동 종합 점검 스크립트
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testSeoulRealtyMcp() {
  console.log('----------------------------------------------------');
  console.log('1. seoul-realty MCP (realestate-server.js) 점검');
  console.log('----------------------------------------------------');

  const serverPath = path.join(__dirname, 'realestate-server.js');
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: __dirname,
    stderr: 'pipe',
  });

  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`✔ 등록된 도구 개수: ${tools.length}개`);

  // 핵심 도구 테스트 1: 범죄율 조회
  const resCrime = await client.callTool({
    name: 'get_crime_rate',
    arguments: { district: '강남구', year: 2024 },
  });
  console.log(`✔ get_crime_rate 응답 확인: ${resCrime.content[0].text.slice(0, 70)}...`);

  // 핵심 도구 테스트 2: 지역 코드 조회
  const resRegion = await client.callTool({
    name: 'get_region_code',
    arguments: { region_name: '송파구' },
  });
  console.log(`✔ get_region_code 응답 확인: ${resRegion.content[0].text.replace(/\r?\n/g, ' ')}`);

  // 핵심 도구 테스트 3: 범죄 데이터 수집 상태 확인 (신규 추가 도구)
  const resCollectCheck = await client.callTool({
    name: 'collect_crime_data',
    arguments: { year: 2024, overwrite: false },
  });
  console.log(`✔ collect_crime_data 응답 확인: ${JSON.parse(resCollectCheck.content[0].text).message}`);

  await client.close();
  return { toolsCount: tools.length, status: 'PASS' };
}

async function testSchoolInfoMcp() {
  console.log('\n----------------------------------------------------');
  console.log('2. schoolinfo MCP (check_schools.js) 점검');
  console.log('----------------------------------------------------');

  const serverPath = path.join(__dirname, 'check_schools.js');
  const client = new Client({ name: 'test-school-client', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: __dirname,
    stderr: 'pipe',
  });

  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`✔ 등록된 도구 개수: ${tools.length}개 (${tools.map(t => t.name).join(', ')})`);

  // 학군 검색 테스트
  const resSearch = await client.callTool({
    name: 'find_school',
    arguments: { name: '휘문고' },
  });
  console.log(`✔ find_school 응답 확인: ${resSearch.content[0].text.replace(/\r?\n/g, ' ').slice(0, 70)}...`);

  await client.close();
  return { toolsCount: tools.length, status: 'PASS' };
}

async function testCrimeMcp() {
  console.log('\n----------------------------------------------------');
  console.log('3. crime-mcp (crime-collector-server.js) 점검');
  console.log('----------------------------------------------------');

  const serverPath = path.join(__dirname, 'crime-collector-server.js');
  const client = new Client({ name: 'test-crime-client', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: __dirname,
    stderr: 'pipe',
  });

  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`✔ 등록된 도구 개수: ${tools.length}개 (${tools.map(t => t.name).join(', ')})`);

  // 도구 1: list_crime_status
  const resStatus = await client.callTool({ name: 'list_crime_status', arguments: {} });
  const status = JSON.parse(resStatus.content[0].text);
  console.log(`✔ list_crime_status 확인: ${status.downloadedCsvCount}/${status.totalSupportedYears} 연도 보유`);

  // 도구 2: get_crime_analysis
  const resAnalysis = await client.callTool({
    name: 'get_crime_analysis',
    arguments: { district: '서초구', year: 2024 },
  });
  const analysis = JSON.parse(resAnalysis.content[0].text);
  console.log(`✔ get_crime_analysis 확인: ${analysis.지역} 5대범죄 ${analysis['5대강력범죄_건수']}건`);

  await client.close();
  return { toolsCount: tools.length, status: 'PASS' };
}

async function main() {
  console.log('====================================================');
  console.log('  🔍 부동산 신호등 시스템 MCP & 데이터 연동 전수 점검');
  console.log('====================================================\n');

  const r1 = await testSeoulRealtyMcp();
  const r2 = await testSchoolInfoMcp();
  const r3 = await testCrimeMcp();

  console.log('\n====================================================');
  console.log('  전수 점검 결과 요약');
  console.log('====================================================');
  console.log(`1. seoul-realty MCP: [${r1.status}] 도구 ${r1.toolsCount}개 정상 가동`);
  console.log(`2. schoolinfo MCP:   [${r2.status}] 도구 ${r2.toolsCount}개 정상 가동`);
  console.log(`3. crime-mcp:        [${r3.status}] 도구 ${r3.toolsCount}개 정상 가동`);
  console.log('====================================================');
}

main().catch(err => {
  console.error('점검 중 치명적 오류:', err);
  process.exit(1);
});
