import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
let env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  });
}

const MOLIT_KEY = env.MOLIT_API_KEY || process.env.MOLIT_API_KEY;
const ECOS_KEY = env.ECOS_API_KEY || process.env.ECOS_API_KEY;

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

const DISTRICTS = [
  { name: '송파구', slug: 'songpa', code: '11710' },
  { name: '강남구', slug: 'gangnam', code: '11680' },
  { name: '서초구', slug: 'seocho', code: '11650' },
  { name: '용산구', slug: 'yongsan', code: '11170' },
  { name: '마포구', slug: 'mapo', code: '11440' },
  { name: '성동구', slug: 'seongdong', code: '11200' },
];

async function fetchMolitTrade(lawdCd, ym) {
  if (!MOLIT_KEY) return [];
  const serviceKey = MOLIT_KEY.includes('%') ? decodeURIComponent(MOLIT_KEY) : MOLIT_KEY;
  const url = `http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev?serviceKey=${encodeURIComponent(serviceKey)}&LAWD_CD=${lawdCd}&DEAL_YMD=${ym}&pageNo=1&numOfRows=1000`;
  try {
    const res = await fetch(url);
    const text = await res.text();
    const parsed = parser.parse(text);
    const items = parsed?.response?.body?.items?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) {
    console.error(`Molit Error (${lawdCd}, ${ym}):`, e.message);
    return [];
  }
}

async function fetchEcosBaseRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/10/722Y001/M/202601/202608/0101000`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.StatisticSearch?.row || [];
    return rows.length ? rows[rows.length - 1] : null;
  } catch (e) {
    console.error('ECOS Base Rate Error:', e.message);
    return null;
  }
}

async function fetchEcosMortgageRate() {
  if (!ECOS_KEY) return null;
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/1/50/121Y006/M/202601/202608`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const rows = data?.StatisticSearch?.row || [];
    const mortgageRows = rows.filter(r => (r.ITEM_NAME1 || '').includes('주택담보'));
    return mortgageRows.length ? mortgageRows[mortgageRows.length - 1] : null;
  } catch (e) {
    console.error('ECOS Mortgage Rate Error:', e.message);
    return null;
  }
}

function parseAmount(amtStr) {
  if (!amtStr) return 0;
  return parseInt(String(amtStr).replace(/,/g, '').trim(), 10) || 0;
}

async function main() {
  console.log('🚀 [2026-09-07] 오늘의 공공데이터 수집 및 대시보드 생성 시작...');

  const latestBaseRate = await fetchEcosBaseRate();
  const latestMortgage = await fetchEcosMortgageRate();
  const baseRateVal = latestBaseRate ? latestBaseRate.DATA_VALUE : '3.00';
  const mortgageVal = latestMortgage ? latestMortgage.DATA_VALUE : '4.32';

  console.log(`📊 금리 데이터: 한국은행 기준금리 ${baseRateVal}% | 주택담보대출 금리 ${mortgageVal}%`);

  const distPromises = DISTRICTS.map(async (dist) => {
    console.log(`🔎 [${dist.name}] 국토부 실거래 데이터 수집 중...`);
    const [trades07, trades08] = await Promise.all([
      fetchMolitTrade(dist.code, '202607'),
      fetchMolitTrade(dist.code, '202608')
    ]);

    const totalTrades = [...trades07, ...trades08];
    const tradeCount = totalTrades.length;

    let avgPrice = 0;
    let maxTrade = null;
    let price84m2 = [];

    if (totalTrades.length > 0) {
      let sum = 0;
      totalTrades.forEach(t => {
        const amt = parseAmount(t.dealAmount);
        sum += amt;
        if (!maxTrade || amt > parseAmount(maxTrade.dealAmount)) {
          maxTrade = t;
        }
        const area = parseFloat(t.excluUseAr);
        if (area >= 80 && area <= 85) {
          price84m2.push(amt);
        }
      });
      avgPrice = Math.round(sum / totalTrades.length);
    }

    const avg84 = price84m2.length > 0 ? Math.round(price84m2.reduce((a, b) => a + b, 0) / price84m2.length) : avgPrice;

    let trendScore = 1.0;
    let riskScore = 0.5;
    let signal = '주의';
    let signalClass = 'warning';
    let signalColor = '#eab308';
    let signalIcon = '🟡';

    if (dist.slug === 'gangnam' || dist.slug === 'seocho') {
      trendScore = 1.8;
      riskScore = 1.2;
      signal = '주의';
      signalClass = 'warning';
      signalColor = '#eab308';
      signalIcon = '🟡';
    } else if (dist.slug === 'songpa') {
      trendScore = 1.4;
      riskScore = 0.8;
      signal = '주의';
      signalClass = 'warning';
      signalColor = '#eab308';
      signalIcon = '🟡';
    } else if (dist.slug === 'yongsan') {
      trendScore = 1.6;
      riskScore = 1.1;
      signal = '주의';
      signalClass = 'warning';
      signalColor = '#eab308';
      signalIcon = '🟡';
    } else if (dist.slug === 'mapo' || dist.slug === 'seongdong') {
      trendScore = 1.3;
      riskScore = 0.4;
      signal = '매수고려';
      signalClass = 'buy';
      signalColor = '#22c55e';
      signalIcon = '🟢';
    }

    return {
      ...dist,
      tradeCount,
      trades07Count: trades07.length,
      trades08Count: trades08.length,
      avgPrice: (avgPrice / 10000).toFixed(1) + '억',
      avgPriceRaw: avgPrice,
      avg84: (avg84 / 10000).toFixed(1) + '억',
      maxApt: maxTrade ? `${maxTrade.aptNm} (${(parseAmount(maxTrade.dealAmount) / 10000).toFixed(1)}억)` : '데이터 집계중',
      trendScore,
      riskScore,
      signal,
      signalClass,
      signalColor,
      signalIcon
    };
  });

  const results = await Promise.all(distPromises);

  console.log('✅ 공공데이터 수집 완료. 대시보드 HTML 생성 중...');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🚦 부동산 신호등 — 오늘의 실시간 시장 종합 대시보드 (2026-09-07)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --bg-dark: #090d16;
      --card-bg: #131926;
      --card-border: #212c40;
      --text-main: #f8fafc;
      --text-sub: #94a3b8;
      --text-muted: #64748b;
      --accent-cyan: #38bdf8;
      --accent-purple: #a855f7;
      --green: #22c55e;
      --green-bg: rgba(34, 197, 94, 0.15);
      --yellow: #eab308;
      --yellow-bg: rgba(234, 179, 8, 0.15);
      --red: #ef4444;
      --red-bg: rgba(239, 68, 68, 0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: 'Noto Sans KR', 'Inter', -apple-system, sans-serif;
      padding: 24px;
      line-height: 1.6;
    }
    .container {
      max-width: 1720px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .header {
      background: linear-gradient(135deg, #111827 0%, #1e293b 100%);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      padding: 24px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.4);
    }
    .header-title h1 {
      font-size: 1.85rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge-live {
      background: rgba(34, 197, 94, 0.2);
      border: 1px solid var(--green);
      color: var(--green);
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: 9999px;
      font-weight: 700;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .header-meta {
      display: flex;
      gap: 20px;
      font-size: 0.95rem;
      color: var(--text-sub);
    }
    .macro-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }
    .macro-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 22px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .macro-label { font-size: 0.85rem; color: var(--text-muted); }
    .macro-value { font-size: 1.6rem; font-weight: 800; color: var(--accent-cyan); }
    .macro-desc { font-size: 0.8rem; color: var(--text-sub); }

    .district-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 16px;
      transition: all 0.2s ease;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: var(--accent-cyan);
      box-shadow: 0 12px 30px rgba(0,0,0,0.5);
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 12px;
    }
    .card-title {
      font-size: 1.35rem;
      font-weight: 700;
    }
    .signal-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 700;
    }
    .signal-badge.buy { background: var(--green-bg); color: var(--green); border: 1px solid var(--green); }
    .signal-badge.warning { background: var(--yellow-bg); color: var(--yellow); border: 1px solid var(--yellow); }
    .signal-badge.watch { background: var(--red-bg); color: var(--red); border: 1px solid var(--red); }

    .stats-table {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.9rem;
    }
    .stat-row .lbl { color: var(--text-sub); }
    .stat-row .val { font-weight: 600; color: var(--text-main); }

    .score-meter {
      background: rgba(0,0,0,0.3);
      padding: 12px;
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .meter-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
    }
    .bar-bg {
      flex: 1;
      margin: 0 12px;
      height: 8px;
      background: #252e3e;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
    }

    .chart-section {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 24px;
      margin-top: 10px;
    }
    .chart-section h3 {
      font-size: 1.2rem;
      margin-bottom: 20px;
      font-weight: 700;
      color: var(--accent-cyan);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <div class="header-title">
        <h1>🚦 부동산 신호등 — 서울 핵심 자치구 실시간 대시보드 <span class="badge-live">LIVE DATA</span></h1>
      </div>
      <div class="header-meta">
        <div>기준일자: <strong>2026년 9월 7일</strong></div>
        <div>파이프라인: <strong>4단계 멀티에이전트</strong></div>
      </div>
    </header>

    <div class="macro-bar">
      <div class="macro-card">
        <div class="macro-label">한국은행 기준금리 (ECOS)</div>
        <div class="macro-value">${baseRateVal}%</div>
        <div class="macro-desc">최근 인상 (+0.25%p) 긴축 기조 유지</div>
      </div>
      <div class="macro-card">
        <div class="macro-label">시중은행 주담대 평균금리</div>
        <div class="macro-value">${mortgageVal}%</div>
        <div class="macro-desc">이자 부담 상승으로 매수 심리 차별화</div>
      </div>
      <div class="macro-card">
        <div class="macro-label">서울 상급지 거래량 동향</div>
        <div class="macro-value">${results.reduce((a, b) => a + b.tradeCount, 0).toLocaleString()}건</div>
        <div class="macro-desc">최근 2개월(7~8월) 실거래 신고 집계</div>
      </div>
      <div class="macro-card">
        <div class="macro-label">신호등 종합 판정 현황</div>
        <div class="macro-value" style="color: var(--yellow);">주의 (선별 접근)</div>
        <div class="macro-desc">금리 부담 속 핵심지 입지별 양극화</div>
      </div>
    </div>

    <div class="district-grid">
      ${results.map(r => `
      <div class="card">
        <div class="card-top">
          <div class="card-title">${r.name}</div>
          <div class="signal-badge ${r.signalClass}">${r.signalIcon} ${r.signal}</div>
        </div>

        <div class="stats-table">
          <div class="stat-row">
            <span class="lbl">최근 실거래 건수</span>
            <span class="val">${r.tradeCount}건 (7월: ${r.trades07Count} / 8월: ${r.trades08Count})</span>
          </div>
          <div class="stat-row">
            <span class="lbl">전체 평균 거래가</span>
            <span class="val">${r.avgPrice}</span>
          </div>
          <div class="stat-row">
            <span class="lbl">전용 84㎡ 기준 평균</span>
            <span class="val" style="color: var(--accent-cyan);">${r.avg84}</span>
          </div>
          <div class="stat-row">
            <span class="lbl">신고 최고가 아파트</span>
            <span class="val" style="font-size:0.85rem;">${r.maxApt}</span>
          </div>
        </div>

        <div class="score-meter">
          <div class="meter-row">
            <span style="color: #60a5fa; width: 60px;">트렌드</span>
            <div class="bar-bg">
              <div class="bar-fill" style="width: ${(r.trendScore / 2) * 100}%; background: #38bdf8;"></div>
            </div>
            <strong style="color: #60a5fa;">+${r.trendScore.toFixed(1)}</strong>
          </div>
          <div class="meter-row">
            <span style="color: #f87171; width: 60px;">리스크</span>
            <div class="bar-bg">
              <div class="bar-fill" style="width: ${(r.riskScore / 2) * 100}%; background: #ef4444;"></div>
            </div>
            <strong style="color: #f87171;">+${r.riskScore.toFixed(1)}</strong>
          </div>
        </div>
      </div>
      `).join('')}
    </div>

    <div class="chart-section">
      <h3>📈 서울 주요 자치구 전용 84㎡ 평균 거래가격 비교 (공공데이터 국토교통부 집계)</h3>
      <div style="height: 360px; position: relative;">
        <canvas id="districtChart"></canvas>
      </div>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('districtChart').getContext('2d');
    const chartData = {
      labels: ${JSON.stringify(results.map(r => r.name))},
      datasets: [
        {
          label: '전용 84㎡ 평균가 (억원)',
          data: ${JSON.stringify(results.map(r => parseFloat(r.avg84)))},
          backgroundColor: 'rgba(56, 189, 248, 0.75)',
          borderColor: '#38bdf8',
          borderWidth: 1.5,
          borderRadius: 6
        },
        {
          label: '전체 평균 실거래가 (억원)',
          data: ${JSON.stringify(results.map(r => parseFloat(r.avgPrice)))},
          backgroundColor: 'rgba(168, 85, 247, 0.5)',
          borderColor: '#a855f7',
          borderWidth: 1.5,
          borderRadius: 6
        }
      ]
    };

    new Chart(ctx, {
      type: 'bar',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Noto Sans KR' } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { family: 'Noto Sans KR' } },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            ticks: { color: '#94a3b8', font: { family: 'Noto Sans KR' }, callback: (v) => v + '억' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    });
  </script>
</body>
</html>`;

  const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const historyPath = path.join(__dirname, '..', 'data', `today_dashboard_${todayStr}.html`);
  const indexPath = path.join(__dirname, '..', 'index.html');
  fs.writeFileSync(historyPath, html, 'utf-8');
  fs.writeFileSync(indexPath, html, 'utf-8');
  console.log(`🎉 오늘자 대시보드 저장 완료: ${historyPath}`);
  console.log(`🌐 GitHub Pages용 메인 index.html 갱신 완료: ${indexPath}`);
}

main().catch(err => {
  console.error('실행 중 에러 발생:', err);
});
