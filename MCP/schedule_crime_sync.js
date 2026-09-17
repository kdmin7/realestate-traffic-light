#!/usr/bin/env node
/**
 * schedule_crime_sync.js
 * 
 * 경찰청 범죄 통계 데이터 3개월 주기(분기별, 90일) 자동 재수집 스케줄러
 * 
 * 사용법:
 *   node schedule_crime_sync.js               # 3개월 경과 여부 검사 후 만료 시 자동 재수집
 *   node schedule_crime_sync.js --check       # 현재 주기 상태 및 다음 수집 예정일 확인
 *   node schedule_crime_sync.js --force       # 주기와 관계없이 즉시 강제 재수집 + 대시보드 갱신
 *   node schedule_crime_sync.js --daemon      # 상시 백그라운드 데몬 (24시간마다 주기 검사 후 자동 수집)
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  collectAllYears,
  checkQuarterlySyncStatus,
  getLocalCrimeStatus,
} from './crime-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runDashboardUpdate() {
  try {
    console.log('\n▶ 대시보드(crime_dashboard.html) 갱신 중...');
    execSync('node generate_crime_dashboard.js', { cwd: __dirname, stdio: 'inherit' });
    console.log('✔ 대시보드 최신화 완료!');
  } catch (err) {
    console.error('대시보드 갱신 중 오류:', err.message);
  }
}

async function executeSync() {
  console.log('\n======================================================');
  console.log('  [경찰청 범죄 데이터 3개월 정기 재수집 시작]');
  console.log(`  시각: ${new Date().toLocaleString('ko-KR')}`);
  console.log('======================================================\n');

  try {
    const manifest = await collectAllYears({ overwrite: true });
    console.log('\n✔ 전체 연도 데이터 재수집 성공!');
    console.log(`- 다음 예정일: ${new Date(manifest.nextSyncDueAt).toLocaleDateString('ko-KR')}`);

    // 대시보드 자동 갱신
    await runDashboardUpdate();
    return true;
  } catch (err) {
    console.error('재수집 실행 중 오류:', err.message);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isForce = args.includes('--force');
  const isDaemon = args.includes('--daemon');

  const status = checkQuarterlySyncStatus();

  console.log('======================================================');
  console.log('  🛡️ 경찰청 범죄 데이터 분기(3개월) 주기 동기화 매니저');
  console.log('======================================================');
  console.log(`- 수집 주기: 90일 (3개월)`);
  console.log(`- 마지막 수집일: ${status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString('ko-KR') : '없음'}`);
  console.log(`- 경과 일수: ${status.daysElapsed != null ? status.daysElapsed + '일' : '-'}`);
  console.log(`- 다음 수집 예정: ${status.nextSyncDueAt ? new Date(status.nextSyncDueAt).toLocaleDateString('ko-KR') : '-'}`);
  console.log(`- 수집 필요 상태: ${status.isDue ? '🚨 [재수집 필요 (3개월 도래)]' : '✅ [최신 상태 유지 중]'}`);
  console.log('------------------------------------------------------');

  if (isCheck) {
    console.log(status.message);
    return;
  }

  if (isForce) {
    console.log('⚡ --force 옵션 감지: 3개월 경과 여부와 상관없이 즉시 재수집을 실행합니다.');
    await executeSync();
    return;
  }

  if (isDaemon) {
    console.log('🔄 상시 감시 데몬 모드로 전환합니다. (매 24시간마다 3개월 만료 여부 확인)');
    // 최초 1회 즉시 검사
    if (status.isDue) {
      console.log('수집 주기가 도래하여 즉시 재수집을 진행합니다.');
      await executeSync();
    } else {
      console.log(`다음 수집까지 약 ${status.daysRemaining}일 남았습니다. 대기 중...`);
    }

    // 24시간 간격 점검 루프
    const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
    setInterval(async () => {
      const current = checkQuarterlySyncStatus();
      console.log(`[${new Date().toLocaleString('ko-KR')}] 정기 점검: ${current.message}`);
      if (current.isDue) {
        console.log('🚨 3개월 주기 도래! 자동 재수집 실행...');
        await executeSync();
      }
    }, CHECK_INTERVAL_MS);

    // 프로세스 유지
    return new Promise(() => {});
  }

  // 기본 모드: isDue인 경우만 재수집
  if (status.isDue) {
    console.log(`\n📢 ${status.message}`);
    await executeSync();
  } else {
    console.log(`\n✔ 최신 데이터가 유지되고 있습니다. (다음 재수집까지 ${status.daysRemaining}일 남음)`);
    console.log('강제로 재수집하려면: node schedule_crime_sync.js --force');
  }
}

main().catch((err) => {
  console.error('스케줄러 오류:', err);
  process.exit(1);
});
