import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { updateRawDataIncremental } from './update_raw_incremental.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'index.html');

async function runDailySync() {
  const now = new Date();
  const dateStr = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
  console.log(`\n======================================================`);
  console.log(`[일일 데이터 취합 및 게시판 갱신 파이프라인 시작]`);
  console.log(`실행 일시: ${now.toISOString().slice(0, 19)} (기준일: ${dateStr})`);
  console.log(`캐싱 규칙: 과거 확정월 100% 보존, 최신 진행월만 최신 일정까지 증분 수집`);
  console.log(`======================================================\n`);

  const targetRegions = ['gangnam', 'songpa', 'seocho', 'yongsan', 'seongdong', 'bundang', 'gwacheon', 'suji'];
  const updatePromises = targetRegions.map(async (slug) => {
    try {
      await updateRawDataIncremental(slug);
    } catch (e) {
      console.error(`[오류] ${slug} 증분 수집 중 에러:`, e.message);
    }
  });
  await Promise.all(updatePromises);

  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace(
      /<div>기준일:\s*<strong>[^<]+<\/strong><\/div>/,
      `<div>기준일: <strong>${dateStr} (매일 실시간 증분 갱신)</strong></div>`
    );
    fs.writeFileSync(indexPath, html, 'utf8');
    console.log(`✔ index.html 게시판 최신 기준일(${dateStr}) 및 데이터 동기화 완료!`);
  }

  // -------------------------------------------------------------
  // 경찰청 범죄 통계 3개월(분기별, 90일) 주기 자동 재수집 체크
  // -------------------------------------------------------------
  try {
    const { checkQuarterlySyncStatus, collectAllYears } = await import('./crime-service.js');
    const crimeStatus = checkQuarterlySyncStatus();
    console.log(`\n[경찰청 범죄 데이터 3개월 주기 점검]`);
    console.log(`- 상태: ${crimeStatus.message}`);
    if (crimeStatus.isDue) {
      console.log('🚨 3개월 주기가 도래하여 범죄 데이터 자동 재수집 및 대시보드 갱신을 실행합니다...');
      await collectAllYears({ overwrite: true });
      const { execSync } = await import('child_process');
      execSync('node generate_crime_dashboard.js', { cwd: __dirname, stdio: 'inherit' });
      console.log('✔ 범죄 데이터 3개월 정기 재수집 및 대시보드 갱신 완료!');
    }
  } catch (err) {
    console.warn('[경고] 범죄 데이터 주기 점검 중 오류:', err.message);
  }

  console.log(`\n🎉 [일일 파이프라인 취합 & 게시판 업데이트 완료]`);
}

runDailySync();

