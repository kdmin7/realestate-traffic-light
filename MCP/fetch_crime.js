#!/usr/bin/env node
/**
 * fetch_crime.js
 * 경찰청 범죄 발생 지역별 통계 데이터 일괄 수집 CLI
 * 
 * 사용법:
 *   node fetch_crime.js               # 2012 ~ 2024 전체 연도 수집
 *   node fetch_crime.js --year 2024   # 특정 연도만 수집
 */

import { collectAllYears, collectAndSaveYear, getLocalCrimeStatus, CRIME_ENDPOINTS } from './crime-service.js';

async function main() {
  const args = process.argv.slice(2);
  let targetYear = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' && args[i + 1]) {
      targetYear = Number(args[i + 1]);
      i++;
    } else if (args[i].startsWith('--year=')) {
      targetYear = Number(args[i].split('=')[1]);
    }
  }

  console.log('====================================================');
  console.log('  경찰청 범죄 발생 지역별 통계 데이터 수집기');
  console.log('  소스: https://infuser.odcloud.kr/oas/docs?namespace=3074462/v1');
  console.log('====================================================\n');

  if (targetYear) {
    if (!CRIME_ENDPOINTS[targetYear]) {
      console.error(`[오류] 지원하지 않는 연도입니다: ${targetYear}`);
      console.log(`지원 연도: ${Object.keys(CRIME_ENDPOINTS).join(', ')}`);
      process.exit(1);
    }
    console.log(`▶ ${targetYear}년 범죄 데이터 단일 수집 시작...`);
    try {
      const res = await collectAndSaveYear(targetYear);
      console.log(`\n[성공] ${targetYear}년 수집 완료!`);
      console.log(`- CSV: ${res.csvPath}`);
      console.log(`- 행 수: ${res.rowCount}, 컬럼 수: ${res.columnCount}`);
    } catch (err) {
      console.error(`\n[실패] 수집 중 오류:`, err.message);
      process.exit(1);
    }
  } else {
    console.log('▶ 전체 연도(2012 ~ 2024) 일괄 수집을 시작합니다...\n');
    const result = await collectAllYears();
    console.log('\n====================================================');
    console.log('  전체 수집 완료 결과 요약');
    console.log('====================================================');
    for (const r of result.results) {
      if (r.success) {
        console.log(`[V] ${r.year}년: ${r.rowCount}행, ${r.columnCount}컬럼 저장 완료`);
      } else {
        console.log(`[X] ${r.year}년: 실패 (${r.error})`);
      }
    }
  }

  console.log('\n▶ 로컬 저장소 최종 상태:');
  const status = getLocalCrimeStatus();
  console.log(`- 저장 경로: ${status.directory}`);
  console.log(`- 수집된 CSV 파일: ${status.downloadedCsvCount} / ${status.totalSupportedYears} 개`);

  // 대시보드 자동 갱신
  try {
    const { execSync } = await import('child_process');
    console.log('\n▶ 범죄 통계 대시보드(crime_dashboard.html) 자동 갱신 중...');
    execSync('node generate_crime_dashboard.js', { stdio: 'inherit' });
  } catch (err) {
    console.warn('대시보드 갱신 경고:', err.message);
  }
}

main().catch((err) => {
  console.error('치명적 오류 발생:', err);
  process.exit(1);
});
