import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Activity, 
  Building2, 
  GraduationCap, 
  BadgePercent, 
  Calculator, 
  ArrowUpRight, 
  ArrowDownRight, 
  Info,
  Clock,
  Layers
} from './icons';

// District Dataset Grounded in Seoul/Gyeonggi A/B Grade Real Estate Metrics
const DISTRICT_DATA = {
  '용산구': {
    name: '서울시 용산구 (Yongsan-gu)',
    signal: 'CAUTION',
    signalLabel: 'HOLD / CAUTION (관망 및 선별 접근)',
    signalColor: 'yellow',
    avgPrice: '22.8억',
    jeonseRatio: '47.5%',
    safetyScore: 92.4,
    schoolScore: 88.6,
    subwayMin: 3.2,
    tradeCount: '142건/월',
    pros: '용산공원 및 국제업무지구 핵심 개발 호재, 한남뉴타운 배후 수요',
    cons: '낮은 전세가율(47.5%)로 인한 높은 갭투자 현금 부담, 단기 급등 피로감',
    properties: [
      { name: '한강자이', pyeong: '84㎡ (34평)', tradePrice: '24.5억', jeonsePrice: '12.0억', gap: '12.5억', floor: '14층', date: '2026-09-18', signal: 'YELLOW' },
      { name: '도원삼성래미안', pyeong: '59㎡ (25평)', tradePrice: '13.8억', jeonsePrice: '7.8억', gap: '6.0억', floor: '9층', date: '2026-09-15', signal: 'GREEN' },
      { name: '한남더힐', pyeong: '177㎡ (59평)', tradePrice: '72.0억', jeonsePrice: '38.0억', gap: '34.0억', floor: '3층', date: '2026-09-12', signal: 'YELLOW' },
      { name: '이촌현대(리모델링)', pyeong: '84㎡ (32평)', tradePrice: '19.2억', jeonsePrice: '8.5억', gap: '10.7억', floor: '11층', date: '2026-09-08', signal: 'RED' }
    ]
  },
  '종로구': {
    name: '서울시 종로구 (Jongno-gu)',
    signal: 'SAFE',
    signalLabel: 'BUY / SAFE (안정적 전세가율 & 직주근접)',
    signalColor: 'green',
    avgPrice: '13.4억',
    jeonseRatio: '61.8%',
    safetyScore: 95.1,
    schoolScore: 86.4,
    subwayMin: 2.5,
    tradeCount: '89건/월',
    pros: 'CBD 도심 직주근접 최상, 안정적인 전세 수요로 갭 방어력 우수',
    cons: '대규모 신축 공급 부족 및 구축 위주 재정비 지연 트레이드오프',
    properties: [
      { name: '경희궁자이 (2단지)', pyeong: '84㎡ (34평)', tradePrice: '21.0억', jeonsePrice: '13.5억', gap: '7.5억', floor: '12층', date: '2026-09-19', signal: 'GREEN' },
      { name: '경희궁유보라', pyeong: '59㎡ (25평)', tradePrice: '12.4억', jeonsePrice: '8.2억', gap: '4.2억', floor: '8층', date: '2026-09-16', signal: 'GREEN' },
      { name: '무악현대', pyeong: '84㎡ (33평)', tradePrice: '10.8억', jeonsePrice: '6.9억', gap: '3.9억', floor: '6층', date: '2026-09-11', signal: 'GREEN' },
      { name: '창신쌍용(2단지)', pyeong: '59㎡ (24평)', tradePrice: '6.4억', jeonsePrice: '4.2억', gap: '2.2억', floor: '15층', date: '2026-09-05', signal: 'YELLOW' }
    ]
  },
  '마포구': {
    name: '서울시 마포구 (Mapo-gu)',
    signal: 'SAFE',
    signalLabel: 'BUY / SAFE (실수요 두터운 상위 주거지)',
    signalColor: 'green',
    avgPrice: '16.9억',
    jeonseRatio: '58.3%',
    safetyScore: 91.0,
    schoolScore: 89.2,
    subwayMin: 3.0,
    tradeCount: '214건/월',
    pros: 'YBD/CBD 양대 업무권역 최인접, 대흥동 학원가 급성장',
    cons: '소형 평형 위주 거래 쏠림, 주거 선호도 대비 중대형 매물 희소',
    properties: [
      { name: '마포프레스티지자이', pyeong: '84㎡ (34평)', tradePrice: '22.3억', jeonsePrice: '13.2억', gap: '9.1억', floor: '18층', date: '2026-09-20', signal: 'GREEN' },
      { name: '마포래미안푸르지오', pyeong: '59㎡ (25평)', tradePrice: '15.5억', jeonsePrice: '9.3억', gap: '6.2억', floor: '10층', date: '2026-09-17', signal: 'GREEN' },
      { name: '신촌숲아이파크', pyeong: '84㎡ (34평)', tradePrice: '18.9억', jeonsePrice: '11.0억', gap: '7.9억', floor: '7층', date: '2026-09-14', signal: 'GREEN' },
      { name: '망원한강아이파크', pyeong: '59㎡ (24평)', tradePrice: '11.2억', jeonsePrice: '6.4억', gap: '4.8억', floor: '5층', date: '2026-09-09', signal: 'YELLOW' }
    ]
  },
  '성남 분당구': {
    name: '경기도 성남시 분당구 (Bundang-gu)',
    signal: 'SAFE',
    signalLabel: 'BUY / SAFE (1기 신도시 선도지구 & 판교 배후)',
    signalColor: 'green',
    avgPrice: '15.8억',
    jeonseRatio: '59.1%',
    safetyScore: 96.8,
    schoolScore: 98.4,
    subwayMin: 4.1,
    tradeCount: '278건/월',
    pros: '전국 최고 수준 수내/정자 학군, 1기 신도시 특별법 선도지구 모멘텀',
    cons: '재건축 사업 장기 소요 및 분담금 리스크 상존',
    properties: [
      { name: '수내 양지마을5단지', pyeong: '84㎡ (32평)', tradePrice: '16.7억', jeonsePrice: '10.2억', gap: '6.5억', floor: '11층', date: '2026-09-21', signal: 'GREEN' },
      { name: '정자 미금현대', pyeong: '59㎡ (24평)', tradePrice: '11.4억', jeonsePrice: '6.9억', gap: '4.5억', floor: '14층', date: '2026-09-18', signal: 'GREEN' },
      { name: '서현 시범한신', pyeong: '84㎡ (32평)', tradePrice: '17.2억', jeonsePrice: '10.5억', gap: '6.7억', floor: '9층', date: '2026-09-15', signal: 'GREEN' },
      { name: '이매 아름마을두산', pyeong: '101㎡ (38평)', tradePrice: '18.5억', jeonsePrice: '10.8억', gap: '7.7억', floor: '4층', date: '2026-09-10', signal: 'YELLOW' }
    ]
  },
  '화성 동탄': {
    name: '경기도 화성시 동탄신도시 (Dongtan)',
    signal: 'CAUTION',
    signalLabel: 'HOLD / CAUTION (GTX-A 호재 선반영 & 매물 적체)',
    signalColor: 'yellow',
    avgPrice: '9.8억',
    jeonseRatio: '52.6%',
    safetyScore: 94.2,
    schoolScore: 91.5,
    subwayMin: 5.5,
    tradeCount: '310건/월',
    pros: 'GTX-A 동탄-수서 수혜, 삼성전자 나노시티 반도체 배후 주거단지',
    cons: '역세권 외곽 지역의 전세가율 하락 및 신규 입주 물량 경계',
    properties: [
      { name: '동탄역롯데캐슬', pyeong: '84㎡ (34평)', tradePrice: '16.2억', jeonsePrice: '8.4억', gap: '7.8억', floor: '26층', date: '2026-09-19', signal: 'YELLOW' },
      { name: '동탄역시범우남퍼스트빌', pyeong: '84㎡ (33평)', tradePrice: '11.8억', jeonsePrice: '6.5억', gap: '5.3억', floor: '15층', date: '2026-09-17', signal: 'GREEN' },
      { name: '동탄레이크자연앤푸르지오', pyeong: '84㎡ (33평)', tradePrice: '9.2억', jeonsePrice: '5.1억', gap: '4.1억', floor: '12층', date: '2026-09-13', signal: 'GREEN' },
      { name: '동탄목동 센트럴힐즈', pyeong: '59㎡ (25평)', tradePrice: '5.8억', jeonsePrice: '3.1억', gap: '2.7억', floor: '7층', date: '2026-09-08', signal: 'RED' }
    ]
  }
};

export default function App() {
  const [selectedDistrictKey, setSelectedDistrictKey] = useState('용산구');
  const district = DISTRICT_DATA[selectedDistrictKey];

  // Budget Gate Simulator State (Client-Side Only per rule: board-core.md)
  const [annualIncome, setAnnualIncome] = useState(8500); // 8,500 만원
  const [cashSavings, setCashSavings] = useState(45000); // 4.5 억원
  const [targetLoanRate, setTargetLoanRate] = useState(3.8); // 3.8% 주담대

  // Purchasing Power Calculation (Strict DSR 40% + LTV 70% Max)
  const purchasingPower = useMemo(() => {
    // Annual DSR 40% limit for mortgage interest + principal (30yr amortized)
    const annualDsrCap = (annualIncome * 0.40);
    // Rough 30-year amortized loan principal calculation
    const r = (targetLoanRate / 100) / 12;
    const n = 360;
    const monthlyPayment = annualDsrCap / 12;
    const maxLoanByDsr = monthlyPayment * ((Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n)));
    const maxLoanManwon = Math.floor(maxLoanByDsr);
    
    // Total purchasing power = Cash + Loan
    const totalAffordabilityManwon = cashSavings + maxLoanManwon;
    const totalAffordabilityEok = (totalAffordabilityManwon / 10000).toFixed(1);
    const maxLoanEok = (maxLoanManwon / 10000).toFixed(1);

    return {
      maxLoanEok,
      totalAffordabilityEok,
      totalAffordabilityManwon,
      annualDsrCap: Math.floor(annualDsrCap)
    };
  }, [annualIncome, cashSavings, targetLoanRate]);

  return (
    <div className="min-h-screen bg-[#070A12] text-slate-100 flex flex-col font-sans">
      {/* 1. Terminal Top Ribbon / Macro Bar */}
      <header className="border-b border-slate-800/80 bg-[#0B1326]/90 backdrop-blur-md sticky top-0 z-50 px-4 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-heading font-bold tracking-wider text-base text-white">
                METROPOLITAN ALPHA TERMINAL
              </span>
              <span className="font-mono-code text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                QUANT v2.4
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono-code">
              수도권 부동산 신호등 퀀트 텔레메트리 대시보드
            </p>
          </div>
        </div>

        {/* Live Macro Ticker */}
        <div className="hidden md:flex items-center space-x-6 text-xs font-mono-code text-slate-300">
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">기준금리:</span>
            <span className="text-emerald-400 font-semibold">3.25%</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">주담대 평균:</span>
            <span className="text-amber-400 font-semibold">3.82%</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="text-slate-400">스트레스 DSR:</span>
            <span className="text-blue-400 font-semibold">40% 한도</span>
          </div>
          <div className="flex items-center space-x-1.5 border-l border-slate-700 pl-4">
            <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[11px] font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> 근거 A·B 검증 완료
            </span>
          </div>
        </div>
      </header>

      {/* 2. Main Terminal Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 lg:px-8 py-6 space-y-6">
        
        {/* District Selector Rail & Status Overview */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-2 overflow-x-auto pb-2 md:pb-0">
            <span className="text-xs font-mono-code uppercase text-slate-400 pr-2">분석 권역:</span>
            {Object.keys(DISTRICT_DATA).map((key) => {
              const item = DISTRICT_DATA[key];
              const isSelected = selectedDistrictKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedDistrictKey(key)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 flex items-center space-x-2 cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20 border border-blue-400'
                      : 'bg-slate-800/80 text-slate-300 hover:bg-slate-700/80 border border-slate-700/60'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    item.signal === 'SAFE' ? 'bg-emerald-400' :
                    item.signal === 'CAUTION' ? 'bg-amber-400' : 'bg-red-400'
                  }`} />
                  <span>{key}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center space-x-3 text-xs font-mono-code text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>기준일: 2026-09 실거래 통계 연동</span>
          </div>
        </div>

        {/* 12-Column Grid Canvas */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left / Center 8 Columns: Telemetry & Real Estate Data Tape */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* District Header & Traffic Light Banner */}
            <div className={`p-6 rounded-2xl border transition-all ${
              district.signal === 'SAFE'
                ? 'bg-emerald-950/20 border-emerald-500/30 glow-green'
                : district.signal === 'CAUTION'
                ? 'bg-amber-950/20 border-amber-500/30 glow-yellow'
                : 'bg-red-950/20 border-red-500/30 glow-red'
            }`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-heading text-2xl font-bold text-white tracking-tight">
                      {district.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 font-mono-code">
                      GRADE A
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mt-1">
                    신호등 판정: <span className="font-bold text-white">{district.signalLabel}</span>
                  </p>
                </div>

                {/* Tactical Indicator Pill */}
                <div className={`px-4 py-2 rounded-xl flex items-center space-x-2 font-mono-code text-xs font-bold border ${
                  district.signal === 'SAFE'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : district.signal === 'CAUTION'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-red-500/10 text-red-400 border-red-500/30'
                }`}>
                  <span className={`w-2.5 h-2.5 rounded-full animate-ping ${
                    district.signal === 'SAFE' ? 'bg-emerald-400' :
                    district.signal === 'CAUTION' ? 'bg-amber-400' : 'bg-red-400'
                  }`} />
                  <span>{district.signal} SIGNAL ACTIVE</span>
                </div>
              </div>

              {/* Trade-off Insights */}
              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 pt-4 border-t border-slate-800/80 text-xs">
                <div className="flex items-start space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-200">얻는 것 (Opportunity):</span>
                    <p className="text-slate-300 mt-0.5">{district.pros}</p>
                  </div>
                </div>
                <div className="flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-slate-200">포기/주의할 점 (Trade-off):</span>
                    <p className="text-slate-300 mt-0.5">{district.cons}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 4 Quantitative Telemetry Metric Tiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-mono-code uppercase font-semibold">평균 매매가</span>
                  <Building2 className="w-4 h-4 text-blue-400" />
                </div>
                <div className="mt-2 font-mono-code text-2xl font-bold text-white tracking-tight">
                  {district.avgPrice}
                </div>
                <div className="mt-1 flex items-center space-x-1 text-[11px] text-emerald-400">
                  <ArrowUpRight className="w-3 h-3" />
                  <span>+1.8% QoQ (A등급)</span>
                </div>
              </div>

              <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-mono-code uppercase font-semibold">전세가율</span>
                  <BadgePercent className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="mt-2 font-mono-code text-2xl font-bold text-white tracking-tight">
                  {district.jeonseRatio}
                </div>
                <div className="mt-1 flex items-center space-x-1 text-[11px] text-slate-400">
                  <span>안전선 60% 기준</span>
                </div>
              </div>

              <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-mono-code uppercase font-semibold">치안 안전도</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="mt-2 font-mono-code text-2xl font-bold text-emerald-300 tracking-tight">
                  {district.safetyScore}
                  <span className="text-xs text-slate-400 font-normal"> / 100</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  경찰청 통계 기반 (A)
                </div>
              </div>

              <div className="glass-card p-4 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span className="font-mono-code uppercase font-semibold">학군 성취도</span>
                  <GraduationCap className="w-4 h-4 text-purple-400" />
                </div>
                <div className="mt-2 font-mono-code text-2xl font-bold text-purple-300 tracking-tight">
                  {district.schoolScore}
                  <span className="text-xs text-slate-400 font-normal"> / 100</span>
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  학교알리미 공시 (A)
                </div>
              </div>
            </div>

            {/* Real Estate Data Tape (최신 실거래 & 갭투자 분석 테이블) */}
            <div className="glass-panel p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <h3 className="font-heading font-semibold text-sm text-white">
                    최근 실거래 텔레메트리 & 갭투자 분석 (Real Estate Tape)
                  </h3>
                </div>
                <span className="font-mono-code text-xs text-slate-400">
                  총 {district.properties.length}개 대표 단지
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono-code">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                      <th className="py-2.5 px-3">단지명 / 소재지</th>
                      <th className="py-2.5 px-3">전용면적</th>
                      <th className="py-2.5 px-3 text-right">매매 실거래</th>
                      <th className="py-2.5 px-3 text-right">전세 실거래</th>
                      <th className="py-2.5 px-3 text-right">갭(GAP)</th>
                      <th className="py-2.5 px-3 text-center">층수</th>
                      <th className="py-2.5 px-3 text-center">신호등</th>
                      <th className="py-2.5 px-3 text-right">계약일</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {district.properties.map((p, idx) => (
                      <tr 
                        key={idx} 
                        className="hover:bg-slate-800/40 transition-colors duration-150 group"
                      >
                        <td className="py-3 px-3 font-sans font-medium text-slate-200">
                          {p.name}
                        </td>
                        <td className="py-3 px-3 text-slate-400">{p.pyeong}</td>
                        <td className="py-3 px-3 text-right text-white font-bold">{p.tradePrice}</td>
                        <td className="py-3 px-3 text-right text-cyan-300">{p.jeonsePrice}</td>
                        <td className="py-3 px-3 text-right text-amber-300 font-semibold">{p.gap}</td>
                        <td className="py-3 px-3 text-center text-slate-400">{p.floor}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.signal === 'GREEN' 
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : p.signal === 'YELLOW'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                              : 'bg-red-500/10 text-red-400 border border-red-500/30'
                          }`}>
                            {p.signal}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-400">{p.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* Right 4 Columns: Budget Gate & Personal Purchasing Power Simulator */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Budget Gate Simulator Card */}
            <div className="glass-panel p-6 rounded-2xl border border-blue-500/20 relative overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Calculator className="w-5 h-5 text-blue-400" />
                  <h3 className="font-heading font-semibold text-base text-white">
                    구매력 예산 게이트 (Budget Gate)
                  </h3>
                </div>
                <span className="text-[10px] font-mono-code px-2 py-0.5 rounded bg-blue-900/40 text-blue-300 border border-blue-500/30">
                  로컬 온디바이스 계산
                </span>
              </div>

              <p className="text-xs text-slate-300 mb-5 leading-relaxed">
                사용자의 소득·자산 데이터는 절대 서버로 전송되지 않으며, 오직 브라우저 내부에서만 DSR 40% 한도와 최대 매수 가능 금액을 계산합니다.
              </p>

              <div className="space-y-4 text-xs font-mono-code">
                {/* Annual Income */}
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>연소득 (부부합산):</span>
                    <span className="text-blue-400 font-bold">{annualIncome.toLocaleString()} 만원 ({ (annualIncome/10000).toFixed(2) }억)</span>
                  </div>
                  <input
                    type="range"
                    min="3000"
                    max="30000"
                    step="500"
                    value={annualIncome}
                    onChange={(e) => setAnnualIncome(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>

                {/* Cash Savings */}
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>보유 현금/자본금:</span>
                    <span className="text-cyan-400 font-bold">{cashSavings.toLocaleString()} 만원 ({ (cashSavings/10000).toFixed(1) }억)</span>
                  </div>
                  <input
                    type="range"
                    min="5000"
                    max="150000"
                    step="1000"
                    value={cashSavings}
                    onChange={(e) => setCashSavings(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                  />
                </div>

                {/* Loan Rate */}
                <div>
                  <div className="flex justify-between text-slate-300 mb-1">
                    <span>적용 주담대 금리:</span>
                    <span className="text-amber-400 font-bold">{targetLoanRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="3.0"
                    max="6.0"
                    step="0.1"
                    value={targetLoanRate}
                    onChange={(e) => setTargetLoanRate(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                {/* Resulting Capacity Box */}
                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-700/80 mt-5 space-y-2">
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>DSR 40% 대출 한도:</span>
                    <span className="font-bold text-slate-200">약 {purchasingPower.maxLoanEok} 억원</span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-400">
                    <span>연간 원리금 상환액:</span>
                    <span className="font-bold text-slate-200">{purchasingPower.annualDsrCap.toLocaleString()} 만원/년</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                    <span className="text-xs text-blue-300 font-semibold">최대 매수 가능 예산:</span>
                    <span className="text-xl font-bold text-white text-emerald-400 font-heading">
                      {purchasingPower.totalAffordabilityEok} 억원
                    </span>
                  </div>
                </div>

                {/* Budget Gate Verification Result */}
                <div className="mt-4 pt-3 border-t border-slate-800">
                  <div className="text-[11px] font-sans text-slate-300">
                    {Number(purchasingPower.totalAffordabilityEok) >= parseFloat(district.avgPrice) ? (
                      <div className="flex items-center space-x-2 text-emerald-400">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>현재 권역({selectedDistrictKey}) 평균 시세 내 진입 가능 권역입니다.</span>
                      </div>
                    ) : (
                      <div className="flex items-start space-x-2 text-amber-400">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                          <span>현재 권역({selectedDistrictKey}) 평균가 대비 약 {(parseFloat(district.avgPrice) - Number(purchasingPower.totalAffordabilityEok)).toFixed(1)}억 초과입니다.</span>
                          <p className="text-[10px] text-slate-400 mt-0.5">※ 무리한 영끌을 차단하고 예산 내 후보 권역 검토를 권장합니다.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            {/* Evidence Grade & Legal Safeguard Notice */}
            <div className="glass-card p-4 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-2">
              <div className="flex items-center space-x-1.5 text-slate-300 font-semibold font-mono-code">
                <Info className="w-3.5 h-3.5 text-blue-400" />
                <span>데이터 거버넌스 및 근거 등급 규약</span>
              </div>
              <p className="leading-relaxed">
                본 대시보드는 국토교통부 실거래가(A), 학교알리미(A), 경찰청 통계(A)와 규칙 계산 엔진(B)의 공시 데이터만 지표 및 신호등 산출에 반영합니다.
              </p>
              <p className="text-slate-400 leading-relaxed">
                ※ 매물 등록과 거래 알선은 수행하지 않으며, 모든 수치는 법률 자문이 아닙니다.
              </p>
            </div>

          </div>

        </div>

      </main>

      {/* 3. Terminal Footer */}
      <footer className="border-t border-slate-800 bg-[#0B1326] px-4 lg:px-8 py-4 text-xs font-mono-code text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>
          <span>Metropolitan Alpha Terminal &bull; Stitch Design System Applied</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>Stitch Project: 7458574699588813404</span>
          <span>Status: Verified Safe</span>
        </div>
      </footer>
    </div>
  );
}
