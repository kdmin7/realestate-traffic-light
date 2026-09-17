/**
 * crime-service.js
 * 경찰청 범죄발생지역별 통계 데이터 수집 및 가공 모듈
 * 
 * 데이터 소스:
 * 공공데이터포털 / 경찰청_범죄발생지역별 통계 (OpenAPI / odcloud.kr)
 * Swagger 스펙: https://infuser.odcloud.kr/oas/docs?namespace=3074462/v1
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_CRIME_DIR = path.join(__dirname, 'data', 'crime');

// OpenAPI 연도별 엔드포인트 맵 (2012 ~ 2024)
export const CRIME_ENDPOINTS = {
  2012: '/3074462/v1/uddi:9ce2c7eb-438b-417e-9986-e458906f2bf6_201910221524',
  2013: '/3074462/v1/uddi:3621ad6a-4570-49bf-a09b-fe9f4a63a248_201910221518',
  2014: '/3074462/v1/uddi:efafd73f-3310-48f8-9f56-bddc1c51f3ba_201910221541',
  2015: '/3074462/v1/uddi:7e73ac26-d0fa-4444-9c2e-81fdad4eff1b_201912061355',
  2016: '/3074462/v1/uddi:10bde8f1-739c-4b66-b6a6-ccf5339a658e_201910221521',
  2017: '/3074462/v1/uddi:f046e6e5-58f2-4716-8b74-be62f1a6c6fc_201910221520',
  2018: '/3074462/v1/uddi:48e1d87b-aaf1-4274-bc0d-a234aeec3889',
  2019: '/3074462/v1/uddi:c81b4639-53cd-4b18-95ce-f716cc6bf1ff',
  2020: '/3074462/v1/uddi:5c067b9b-efe1-414a-8096-89b67ee686bf',
  2021: '/3074462/v1/uddi:14dc5ecc-3702-4df9-9dae-cb2337bf93cb',
  2022: '/3074462/v1/uddi:fe3ae686-8f7d-4d82-8c3a-901a02a0aa75',
  2023: '/3074462/v1/uddi:161740bd-8ec5-4734-9a3d-f7a2cde34942',
  2024: '/3074462/v1/uddi:ae109087-8690-4cb5-bda9-a7876a92f3b8',
};

/**
 * 환경 변수(.env)에서 API 키 로드
 */
export function getApiKey() {
  if (process.env.MOLIT_API_KEY) return process.env.MOLIT_API_KEY.trim();
  if (process.env.PUBLIC_DATA_KEY) return process.env.PUBLIC_DATA_KEY.trim();

  for (const envPath of [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', '.env'),
  ]) {
    if (fs.existsSync(envPath)) {
      const envText = fs.readFileSync(envPath, 'utf8');
      const match = envText.match(/(?:MOLIT_API_KEY|PUBLIC_DATA_KEY)=([^\r\n]+)/);
      if (match) return match[1].trim();
    }
  }
  return '';
}

/**
 * 특정 연도의 범죄 데이터 API 호출
 */
export async function fetchCrimeApi(year, apiKey = getApiKey()) {
  const endpoint = CRIME_ENDPOINTS[year];
  if (!endpoint) {
    throw new Error(`지원하지 않는 연도입니다: ${year}. 지원 연도: ${Object.keys(CRIME_ENDPOINTS).join(', ')}`);
  }
  if (!apiKey) {
    throw new Error('공공데이터포털 API Key(MOLIT_API_KEY)가 설정되지 않았습니다.');
  }

  const url = `https://api.odcloud.kr/api${endpoint}?page=1&perPage=500`;

  // 1차 시도: Header 'Authorization: Infuser <KEY>'
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Infuser ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json.data) && json.data.length > 0) {
        return json.data;
      }
    }
  } catch (err) {
    console.warn(`[Header Auth 실패] ${year}년 데이터 수집 재시도(Query Param): ${err.message}`);
  }

  // 2차 시도: Query Param 'serviceKey'
  const fallbackUrl = `${url}&serviceKey=${encodeURIComponent(apiKey)}`;
  const fallbackRes = await fetch(fallbackUrl, {
    headers: { 'Accept': 'application/json' },
  });

  if (!fallbackRes.ok) {
    const errText = await fallbackRes.text();
    throw new Error(`API 호출 실패 (HTTP ${fallbackRes.status}): ${errText}`);
  }

  const json = await fallbackRes.json();
  if (!json.data || !Array.isArray(json.data)) {
    throw new Error(`유효하지 않은 응답 데이터 구조입니다: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.data;
}

/**
 * JSON 데이터 배열을 CSV 문자열로 변환 (헤더 순서: 범죄대분류, 범죄중분류, ...지역명들)
 */
export function jsonToCsv(rows) {
  if (!rows || rows.length === 0) return '';

  // 전체 컬럼 수집
  const colSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      colSet.add(key);
    }
  }

  // 범죄 분류 컬럼을 맨 앞으로, 나머지 지역 컬럼은 정렬
  const catHeaders = ['범죄대분류', '범죄중분류'].filter(k => colSet.has(k));
  const otherHeaders = Array.from(colSet)
    .filter(k => !catHeaders.includes(k))
    .sort((a, b) => a.localeCompare(b, 'ko'));

  const headers = [...catHeaders, ...otherHeaders];

  const escapeCsv = (val) => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [];
  // 헤더 라인
  csvLines.push(headers.map(escapeCsv).join(','));

  // 데이터 라인
  for (const row of rows) {
    const line = headers.map(h => escapeCsv(row[h] ?? 0)).join(',');
    csvLines.push(line);
  }

  // UTF-8 BOM(\uFEFF) 추가하여 엑셀 및 텍스트 뷰어에서 한글 완벽 호환
  return '\uFEFF' + csvLines.join('\r\n');
}

/**
 * 특정 연도 수집 및 파일 저장
 */
export async function collectAndSaveYear(year, options = {}) {
  const { saveJson = true, overwrite = true, apiKey = getApiKey() } = options;

  if (!fs.existsSync(DATA_CRIME_DIR)) {
    fs.mkdirSync(DATA_CRIME_DIR, { recursive: true });
  }

  const csvPath = path.join(DATA_CRIME_DIR, `${year}.csv`);
  const jsonPath = path.join(DATA_CRIME_DIR, `${year}.json`);

  if (!overwrite && fs.existsSync(csvPath)) {
    return {
      year,
      skipped: true,
      message: `${year}.csv 파일이 이미 존재합니다.`,
      csvPath,
    };
  }

  const rows = await fetchCrimeApi(year, apiKey);
  const csvContent = jsonToCsv(rows);

  fs.writeFileSync(csvPath, csvContent, 'utf8');

  if (saveJson) {
    fs.writeFileSync(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
  }

  const sampleCols = rows[0] ? Object.keys(rows[0]) : [];

  return {
    year,
    success: true,
    rowCount: rows.length,
    columnCount: sampleCols.length,
    csvPath,
    jsonPath: saveJson ? jsonPath : null,
  };
}

/**
 * 전체 연도(2012 ~ 2024) 일괄 수집
 */
export async function collectAllYears(options = {}) {
  const years = Object.keys(CRIME_ENDPOINTS).map(Number).sort((a, b) => a - b);
  const results = [];

  for (const year of years) {
    try {
      console.log(`[Crime Collector] ${year}년 범죄 통계 데이터 수집 중...`);
      const res = await collectAndSaveYear(year, options);
      results.push(res);
      console.log(`[Crime Collector] ${year}년 수집 완료 (${res.rowCount}행, ${res.columnCount}개 컬럼)`);
    } catch (err) {
      console.error(`[Crime Collector] ${year}년 수집 오류:`, err.message);
      results.push({
        year,
        success: false,
        error: err.message,
      });
    }
  }

  // 수집 메타데이터 저장
  const manifestPath = path.join(DATA_CRIME_DIR, 'manifest.json');
  const now = new Date();
  const nextSyncDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 3개월 후
  const manifest = {
    updatedAt: now.toISOString(),
    syncIntervalDays: 90,
    intervalMonths: 3,
    nextSyncDueAt: nextSyncDate.toISOString(),
    source: 'https://infuser.odcloud.kr/oas/docs?namespace=3074462/v1',
    agency: '경찰청 (공공데이터포털)',
    results,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  return manifest;
}

export const SYNC_INTERVAL_DAYS = 90; // 3개월 주기

/**
 * 3개월 주기 재수집 대상 여부 확인
 */
export function checkQuarterlySyncStatus() {
  const manifestPath = path.join(DATA_CRIME_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return {
      isDue: true,
      lastSyncedAt: null,
      daysElapsed: null,
      nextSyncDueAt: new Date().toISOString(),
      message: '수집 이력이 없습니다. 즉시 수집이 필요합니다.',
    };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const lastSync = new Date(manifest.updatedAt || 0);
    const now = new Date();
    const diffMs = now.getTime() - lastSync.getTime();
    const daysElapsed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const nextSyncDate = new Date(lastSync.getTime() + SYNC_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    const isDue = daysElapsed >= SYNC_INTERVAL_DAYS;

    return {
      isDue,
      lastSyncedAt: lastSync.toISOString(),
      daysElapsed,
      syncIntervalDays: SYNC_INTERVAL_DAYS,
      nextSyncDueAt: nextSyncDate.toISOString(),
      daysRemaining: Math.max(0, SYNC_INTERVAL_DAYS - daysElapsed),
      message: isDue
        ? `마지막 수집일로부터 ${daysElapsed}일이 경과하여 3개월 주기 재수집이 필요합니다.`
        : `마지막 수집일로부터 ${daysElapsed}일 경과. 다음 수집까지 ${SYNC_INTERVAL_DAYS - daysElapsed}일 남았습니다.`,
    };
  } catch (err) {
    return { isDue: true, error: err.message };
  }
}

/**
 * 로컬 저장소 상태 확인
 */
export function getLocalCrimeStatus() {
  if (!fs.existsSync(DATA_CRIME_DIR)) {
    return { count: 0, files: [] };
  }

  const files = fs.readdirSync(DATA_CRIME_DIR);
  const csvFiles = files.filter(f => /\.csv$/i.test(f));
  const jsonFiles = files.filter(f => /\.json$/i.test(f));

  const yearsInfo = Object.keys(CRIME_ENDPOINTS).map(Number).sort((a, b) => a - b).map(year => {
    const csvExists = csvFiles.includes(`${year}.csv`);
    const jsonExists = jsonFiles.includes(`${year}.json`);
    let size = 0;
    if (csvExists) {
      size = fs.statSync(path.join(DATA_CRIME_DIR, `${year}.csv`)).size;
    }
    return {
      year,
      csvExists,
      jsonExists,
      sizeBytes: size,
    };
  });

  return {
    directory: DATA_CRIME_DIR,
    totalSupportedYears: Object.keys(CRIME_ENDPOINTS).length,
    downloadedCsvCount: yearsInfo.filter(y => y.csvExists).length,
    quarterlySync: checkQuarterlySyncStatus(),
    years: yearsInfo,
  };
}
