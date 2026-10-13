import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { FiSearch, FiRefreshCw, FiTrendingUp, FiTrendingDown, FiActivity, FiGlobe, FiTarget, FiX, FiBriefcase, FiAlertTriangle, FiZap, FiRepeat, FiBox } from 'react-icons/fi';
import { Scale } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import MonthlyTop50BenchmarkComparator from './MonthlyTop50BenchmarkComparator';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const BSTOCKS = ['AMDB', 'NVDAB', 'TSMB', 'INTCB', 'INTWB', 'QQQB', 'TQQQB', 'SOXLB', 'SOXSB', 'AVGOB', 'AXTIB', 'DRAMB', 'GLWB', 'COHRB', 'HOODB', 'CBRSB', 'NBISB', 'MRNAB', 'NFLXB', 'SNDKB'];

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedToken, setSelectedToken] = useState('BTC');
  const [viewMode, setViewMode] = useState('monthly_top50_benchmark'); // 'monthly_top50_benchmark' | 'solcore' | 'single' | 'global' | 'weekend' | 'signals' | 'pingpong'
  
  // Solana Core Hub State
  const [solCoreData, setSolCoreData] = useState(null);
  const [solCoreLoading, setSolCoreLoading] = useState(false);
  const [matrixTf, setMatrixTf] = useState('24h'); // '24h' | '7d' | '30d'

  // Solana Charts State (Side-by-side & Normalized)
  const [solChartsData, setSolChartsData] = useState(null);
  const [solChartsLoading, setSolChartsLoading] = useState(false);
  const [solChartsTf, setSolChartsTf] = useState('1h'); // '15m' | '1h' | '4h' | '1d' | '1w' | '1M'
  const [chartViewType, setChartViewType] = useState('grid'); // 'grid' (wahd hda wahad) | 'overlay' (superposé)

  // Signals State
  const [signals, setSignals] = useState({ data: [], last_updated: 0 });
  const [signalsLoading, setSignalsLoading] = useState(false);

  // Ping Pong State
  const [ppT1, setPpT1] = useState('SOXLB');
  const [ppT2, setPpT2] = useState('SOXSB');
  const [ppTimeframe, setPpTimeframe] = useState('1h');
  const [ppData, setPpData] = useState(null);
  const [ppLoading, setPpLoading] = useState(false);

  // Chart Modal State
  const [chartPair, setChartPair] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [timeframe, setTimeframe] = useState('1h');
  const timeframes = ['15m', '1h', '4h', '1d', '1w', '1M'];

  const [matrixPeriod, setMatrixPeriod] = useState('1w');

  const fetchCorrelation = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get(`http://localhost:8000/api/correlation?limit=400&period=${matrixPeriod}${forceRefresh ? '&force_refresh=true' : ''}`);
      if (res.data.error) {
        setError(res.data.error);
      } else {
        setData(res.data);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const fetchSignals = async () => {
    try {
      setSignalsLoading(true);
      const res = await axios.get(`http://localhost:8000/api/signals`);
      if (res.data.data) {
        setSignals(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch signals');
    } finally {
      setSignalsLoading(false);
    }
  };

  const fetchSolCore = async () => {
    try {
      setSolCoreLoading(true);
      const res = await axios.get(`http://localhost:8000/api/solana-core`);
      if (res.data && res.data.tokens) {
        setSolCoreData(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch Solana Core data', err);
    } finally {
      setSolCoreLoading(false);
    }
  };

  const fetchSolCharts = async (tf = solChartsTf) => {
    try {
      setSolChartsLoading(true);
      const res = await axios.get(`http://localhost:8000/api/solana-charts?timeframe=${tf}`);
      if (res.data && res.data.tokens) {
        setSolChartsData(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch Solana Charts data', err);
    } finally {
      setSolChartsLoading(false);
    }
  };

  const runPingPong = async () => {
    try {
      setPpLoading(true);
      const res = await axios.get(`http://localhost:8000/api/pingpong?t1=${ppT1}&t2=${ppT2}&timeframe=${ppTimeframe}`);
      if (res.data.error) {
        alert(res.data.error);
      } else {
        setPpData(res.data);
      }
    } catch (err) {
      alert("Simulation failed.");
    } finally {
      setPpLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'monthly_top50_benchmark') {
      setError(null);
      return;
    }

    if (viewMode === 'single' || viewMode === 'global') {
      fetchCorrelation();
    } else if (viewMode === 'signals') {
      fetchSignals();
    } else if (viewMode === 'solcore') {
      fetchSolCore();
      fetchSolCharts(solChartsTf);
    }

    const interval = setInterval(() => {
      if (viewMode === 'signals') fetchSignals();
      if (viewMode === 'solcore') {
        fetchSolCore();
        fetchSolCharts(solChartsTf);
      }
    }, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [matrixPeriod, viewMode]);

  // Refetch charts on timeframe change
  useEffect(() => {
    if (viewMode === 'solcore') {
      fetchSolCharts(solChartsTf);
    }
  }, [solChartsTf, viewMode]);

  // Fetch Chart Data for Modal
  useEffect(() => {
    if (chartPair) {
      const fetchChart = async () => {
        setChartLoading(true);
        try {
          const res = await axios.get(`http://localhost:8000/api/chart?t1=${chartPair.t1}&t2=${chartPair.t2}&timeframe=${timeframe}`);
          setChartData(res.data.data || []);
        } catch (err) {
          console.error(err);
        } finally {
          setChartLoading(false);
        }
      };
      fetchChart();
    }
  }, [chartPair, timeframe]);

  // Initial Ping Pong Fetch
  useEffect(() => {
    if (viewMode === 'pingpong' && !ppData) {
      runPingPong();
    }
  }, [viewMode]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (search.trim()) {
      setSelectedToken(search.toUpperCase());
      setViewMode('single');
    }
  };

  const getSingleCorrelations = () => {
    if (!data || !data.matrix || !data.matrix[selectedToken]) return null;
    const correlations = data.matrix[selectedToken];
    let arr = Object.keys(correlations)
      .filter(k => k !== selectedToken && correlations[k] !== null && !isNaN(correlations[k]))
      .map(k => ({ symbol: k, value: correlations[k] }));
    arr.sort((a, b) => b.value - a.value);
    return { top: arr.slice(0, 50), bottom: arr.slice(-50).reverse() };
  };

  const getGlobalCorrelations = () => {
    if (!data || !data.matrix || !data.tokens) return null;
    const pairs = [];
    const tokens = data.tokens;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const t1 = tokens[i];
        const t2 = tokens[j];
        const val = data.matrix[t1]?.[t2];
        if (val !== undefined && val !== null && !isNaN(val) && val < 0.999) {
          pairs.push({ symbol: `${t1} - ${t2}`, value: val });
        }
      }
    }
    pairs.sort((a, b) => b.value - a.value);
    return { top: pairs.slice(0, 50), bottom: pairs.slice(-50).reverse() };
  };

  const getWeekendArbitrage = () => {
    if (!data || !data.matrix || !data.tokens) return null;
    const tokens = data.tokens;
    const bstocksInMarket = tokens.filter(t => BSTOCKS.includes(t));
    const cryptos = tokens.filter(t => !BSTOCKS.includes(t));

    const results = [];
    bstocksInMarket.forEach(bstock => {
      const correlations = data.matrix[bstock];
      if (!correlations) return;

      let cryptoCorrs = cryptos
        .map(c => ({ symbol: c, value: correlations[c] }))
        .filter(item => item.value !== null && !isNaN(item.value));

      cryptoCorrs.sort((a, b) => b.value - a.value);

      results.push({
        bstock,
        topPos: cryptoCorrs.slice(0, 3),
        topInv: cryptoCorrs.slice(-3).reverse()
      });
    });
    return results;
  };

  // Weekend Live Alerts State
  const [weekendAlerts, setWeekendAlerts] = useState([]);
  
  const fetchWeekendAlerts = async () => {
    try {
      const res = await axios.get('http://localhost:8000/api/weekend-alerts');
      if (res.data.alerts) setWeekendAlerts(res.data.alerts);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (viewMode === 'weekend') fetchWeekendAlerts();
  }, [viewMode, data]);

  const displayData = viewMode === 'global' ? getGlobalCorrelations() : (viewMode === 'single' ? getSingleCorrelations() : null);
  const weekendData = viewMode === 'weekend' ? getWeekendArbitrage() : null;

  const handleRowClick = (symbolStr) => {
    let t1, t2;
    if (viewMode === 'global' || viewMode === 'signals') {
      [t1, t2] = symbolStr.split(' - ');
    } else {
      t1 = selectedToken;
      t2 = symbolStr;
    }
    setChartPair({ t1, t2 });
    setTimeframe('1h');
  };

  const handleWeekendClick = (bstock, crypto) => {
    setChartPair({ t1: bstock, t2: crypto });
    setTimeframe('1h');
  };

  return (
    <div className="min-h-screen p-2 md:p-4 w-full max-w-[98vw] 2xl:max-w-[1920px] mx-auto relative">
      
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 gap-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FiActivity className="text-accent" /> Apex Terminal
          </h1>
          <p className="text-gray-400 mt-2 font-geist text-sm">Crypto Correlation Dashboard · Binance Spot</p>
        </div>
        
        <form onSubmit={handleSearch} className="relative w-full md:w-80">
          <input 
            type="text" 
            placeholder="Search Token (e.g. WLD, BTC)" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface border border-gray-800 rounded-lg py-3 px-4 pl-12 focus:outline-none focus:border-accent text-ink placeholder-gray-500 transition-colors"
          />
          <FiSearch className="absolute left-4 top-3.5 text-gray-400 text-xl" />
        </form>
      </header>

      {/* View Toggles & Controls */}
      <div className="flex flex-col xl:flex-row justify-between items-center mb-8 bg-surface p-4 rounded-xl border border-gray-800 gap-4">
        <div className="flex items-center gap-2 bg-[#0a1519] p-1 rounded-lg border border-gray-800 flex-wrap">
          <button 
            onClick={() => setViewMode('monthly_top50_benchmark')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all shadow-lg border font-bold", viewMode === 'monthly_top50_benchmark' ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50" : "text-cyan-400/80 hover:text-cyan-300 hover:bg-cyan-500/10 border-cyan-500/30")}
          >
            <Scale size={16} /> Bybit Benchmark (Top 50)
          </button>
          <button 
            onClick={() => setViewMode('solcore')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all shadow-lg border font-bold", viewMode === 'solcore' ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50" : "text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 border-cyan-500/30")}
          >
            <FiActivity /> ⚡ Solana Core Hub
          </button>
          <button 
            onClick={() => { setSelectedToken('BTC'); setViewMode('single'); }}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all", viewMode === 'single' ? "bg-accent/20 text-accent" : "text-gray-400 hover:text-white")}
          >
            <FiTarget /> Single Token
          </button>
          <button 
            onClick={() => setViewMode('global')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all", viewMode === 'global' ? "bg-accent/20 text-accent" : "text-gray-400 hover:text-white")}
          >
            <FiGlobe /> Global Market Pairs
          </button>
          <button 
            onClick={() => setViewMode('weekend')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all", viewMode === 'weekend' ? "bg-purple-500/20 text-purple-400" : "text-gray-400 hover:text-white")}
          >
            <FiBriefcase /> Weekend GAP
          </button>
          <button 
            onClick={() => setViewMode('signals')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all", viewMode === 'signals' ? "bg-yellow-500/20 text-yellow-400" : "text-gray-400 hover:text-white")}
          >
            <FiZap /> Auto Signals
          </button>
          <button 
            onClick={() => setViewMode('pingpong')}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-md font-geist text-sm transition-all shadow-lg border", viewMode === 'pingpong' ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50" : "text-emerald-500/70 hover:text-emerald-400 hover:bg-emerald-500/10 border-transparent")}
          >
            <FiRepeat /> Ping-Pong Grid
          </button>

        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => { fetchCorrelation(true); fetchSignals(); if(viewMode==='pingpong') runPingPong(); }}
            disabled={loading || signalsLoading || ppLoading}
            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors bg-white/5 px-4 py-2 rounded-lg border border-transparent hover:border-gray-800"
          >
            <FiRefreshCw className={cn((loading || signalsLoading || ppLoading) && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Content */}
      {viewMode === 'monthly_top50_benchmark' ? (
        <div className="animate-fade-in">
          <MonthlyTop50BenchmarkComparator />
        </div>
      ) : viewMode === 'pingpong' ? (
        <div className="space-y-8 animate-fade-in">
          <div className="bg-emerald-900/10 border border-emerald-500/50 rounded-2xl p-6 flex items-start gap-4">
            <FiRepeat className="text-emerald-500 text-3xl shrink-0 mt-1" />
            <div className="w-full">
              <h2 className="text-emerald-500 font-bold text-xl mb-2">Ping-Pong Tracker (Volatility Harvesting)</h2>
              <p className="text-emerald-200/80 font-geist text-sm leading-relaxed mb-4">
                Simulates a daily or hourly 50/50 rebalancing strategy on any two highly correlated (or inversely correlated) assets. 
                Instead of holding and losing to volatility decay, this bot automatically "sells the winner and buys the loser" to capture the divergence gap.
              </p>
              
              <div className="flex items-end gap-4 mt-6">
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-bold mb-2">Token A</label>
                  <input type="text" value={ppT1} onChange={e=>setPpT1(e.target.value.toUpperCase())} className="bg-[#0a1519] border border-gray-800 rounded px-3 py-2 text-white font-geist w-32 focus:outline-none focus:border-emerald-500" />
                </div>
                <div className="text-gray-500 font-bold pb-2">vs</div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-bold mb-2">Token B</label>
                  <input type="text" value={ppT2} onChange={e=>setPpT2(e.target.value.toUpperCase())} className="bg-[#0a1519] border border-gray-800 rounded px-3 py-2 text-white font-geist w-32 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 uppercase font-bold mb-2">Rebalance Interval</label>
                  <select value={ppTimeframe} onChange={e=>setPpTimeframe(e.target.value)} className="bg-[#0a1519] border border-gray-800 rounded px-3 py-2 text-white font-geist focus:outline-none focus:border-emerald-500">
                    <option value="15m">15 Minutes</option>
                    <option value="1h">1 Hour</option>
                    <option value="1d">1 Day</option>
                  </select>
                </div>
                <button onClick={runPingPong} disabled={ppLoading} className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-6 py-2 rounded font-bold hover:bg-emerald-500/30 transition-colors">
                  {ppLoading ? 'Running...' : 'Run Simulation'}
                </button>
              </div>
            </div>
          </div>

          {ppData && (
            <div className="space-y-6">
              {/* LIVE ACTION CARD */}
              <div className="bg-surface border-2 border-emerald-500/30 rounded-2xl p-8 text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/50"></div>
                <h3 className="text-gray-400 text-sm font-bold uppercase tracking-widest mb-4">Live Rebalance Action (Now)</h3>
                <p className={cn("text-3xl font-bold font-geist", ppData.live_action.includes('Sell') ? "text-white" : "text-gray-500")}>
                  {ppData.live_action}
                </p>
                <p className="text-sm text-gray-500 mt-4">Execute this trade to maintain a perfect 50/50 balance and capture the recent divergence.</p>
              </div>

              {/* STATS */}
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-[#0a1519] border border-gray-800 rounded-xl p-6">
                  <p className="text-gray-500 text-xs font-bold uppercase mb-2">Initial Investment (Day 1)</p>
                  <p className="text-2xl font-geist text-white">$2,000.00</p>
                </div>
                <div className="bg-[#0a1519] border border-gray-800 rounded-xl p-6">
                  <p className="text-gray-500 text-xs font-bold uppercase mb-2">Hold Value (No Action)</p>
                  <p className="text-2xl font-geist text-red-400">${ppData.final_hold.toFixed(2)}</p>
                </div>
                <div className="bg-[#0a1519] border border-emerald-500/30 rounded-xl p-6">
                  <p className="text-emerald-500/70 text-xs font-bold uppercase mb-2">Ping-Pong Value (Rebalanced)</p>
                  <p className="text-2xl font-geist text-emerald-400">${ppData.final_rebalance.toFixed(2)}</p>
                  <p className="text-xs text-emerald-500 mt-1">Profit over Hold: +${ppData.profit_vs_hold.toFixed(2)}</p>
                </div>
              </div>

              {/* CHART */}
              <div className="h-96 w-full relative bg-[#071013] rounded-xl border border-gray-800/50 p-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ppData.chart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#ffffff40" 
                        fontSize={12} 
                        tickFormatter={(val) => val.split(',')[0]} 
                        minTickGap={30}
                      />
                      <YAxis 
                        stroke="#ffffff40" 
                        fontSize={12} 
                        domain={['auto', 'auto']}
                        tickFormatter={(val) => `$${val}`}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#102127', borderColor: '#334155', borderRadius: '8px' }}
                        itemStyle={{ fontFamily: 'Geist Mono', fontSize: '14px' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
                        formatter={(value, name) => [`$${value.toFixed(2)}`, name === 'hold_value' ? 'Buy & Hold' : 'Ping-Pong Bot']}
                      />
                      <Legend iconType="circle" />
                      <Line type="monotone" dataKey={`hold_value`} name="Buy & Hold" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey={`rebal_value`} name="Ping-Pong Bot" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      ) : viewMode === 'signals' ? (
        <div className="space-y-8 animate-fade-in">
          <div className="bg-yellow-900/10 border border-yellow-500/50 rounded-2xl p-6 flex items-start gap-4">
            <FiZap className="text-yellow-500 text-3xl shrink-0 mt-1" />
            <div>
              <h2 className="text-yellow-500 font-bold text-xl mb-2">Automated Anomaly Detector (Sayd L'M3ttel)</h2>
              <p className="text-yellow-200/80 font-geist text-sm leading-relaxed">
                The backend engine scans the market automatically every hour. It compares the <strong>1-Week Matrix</strong> against the <strong>1-Hour Matrix</strong>.
                Below are the top anomalies where tokens that are historically <em>highly correlated (&gt;85%)</em> have suddenly <em>diverged (&lt;20%)</em>. 
                <br/><strong className="text-white">This indicates a temporary Arbitrage opportunity. Click any pair to check the chart!</strong>
              </p>
              <p className="text-xs text-gray-500 mt-2">Last Scan: {signals.last_updated ? new Date(signals.last_updated).toLocaleString() : 'Scanning now...'}</p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {signals.data.length > 0 ? signals.data.map((sig, i) => (
              <div key={i} onClick={() => handleRowClick(sig.pair)} className="bg-surface border border-gray-800 rounded-2xl p-6 hover:border-yellow-500/50 transition-colors cursor-pointer">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-2xl font-bold">{sig.pair}</h3>
                  <span className={cn("text-xs px-3 py-1 rounded-full font-bold border", sig.type==='Weekend GAP' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' : 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20')}>{sig.type}</span>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#0a1519] p-4 rounded-xl border border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">1-Week Corr (Normal)</p>
                    <p className="text-green-400 font-geist text-xl font-bold">{(sig.corr_1w * 100).toFixed(1)}%</p>
                  </div>
                  <div className="bg-[#0a1519] p-4 rounded-xl border border-gray-800">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">1-Hour Corr (Current)</p>
                    <p className="text-red-400 font-geist text-xl font-bold">{(sig.corr_1h * 100).toFixed(1)}%</p>
                  </div>
                </div>
                
                <div className="mt-4 text-center">
                  <p className="text-sm text-gray-400 font-geist">Divergence Gap: <span className="text-yellow-400 font-bold">{(sig.divergence * 100).toFixed(1)}%</span></p>
                </div>
              </div>
            )) : (
              <div className="col-span-2 text-center py-12 text-gray-500 font-geist">
                No major anomalies detected right now. The market is moving in sync.
              </div>
            )}
          </div>
        </div>
      ) : loading && !data ? (
        <div className="flex justify-center items-center h-64">
          <div className="flex flex-col items-center gap-4">
             <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
             <p className="text-gray-400 font-geist text-sm animate-pulse">Fetching 400 markets & computing matrix...</p>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-6 rounded-xl space-y-3">
          <h3 className="font-bold text-lg flex items-center gap-2">
            <FiAlertTriangle className="text-red-400 text-xl" /> Erreur de chargement (Backend Local)
          </h3>
          <p className="font-geist text-sm text-gray-300 leading-relaxed">
            {error === 'Network Error'
              ? "Cette section utilise le serveur local (port 8000). Si vous consultez ce dashboard sur Vercel, utilisez l'onglet « Bybit Benchmark (Top 50) » qui fonctionne 100% en direct sans serveur local."
              : error}
          </p>
          <button
            onClick={() => { setError(null); setViewMode('monthly_top50_benchmark'); }}
            className="mt-2 px-4 py-2 bg-cyan-500/20 border border-cyan-500/50 text-cyan-300 rounded-lg text-xs font-bold hover:bg-cyan-500/30 transition-all flex items-center gap-2"
          >
            <Scale size={14} /> Aller au Bybit Benchmark (Top 50)
          </button>
        </div>

      ) : viewMode === 'solcore' ? (
        <div className="space-y-8 animate-fade-in">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-[#14F195]/10 via-[#9945FF]/10 to-transparent border border-[#14F195]/30 rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#14F195] to-[#9945FF] flex items-center justify-center text-black font-black text-xl shadow-lg">
                ◎
              </div>
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  Solana Core Ecosystem Hub <span className="text-xs px-2 py-0.5 rounded bg-[#14F195]/20 text-[#14F195] border border-[#14F195]/40 font-mono">BINANCE LIVE</span>
                </h2>
                <p className="text-sm text-gray-400 font-geist">
                  Performance & Force Relative des 8 Piliers de Solana (SOL, JUP, MET, JTO, ORCA, RAY, KMNO, PUMP)
                </p>
              </div>
            </div>
            <button
              onClick={fetchSolCore}
              disabled={solCoreLoading}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-gray-700 rounded-lg text-sm font-geist text-gray-300 hover:text-white transition-all self-start md:self-auto"
            >
              <FiRefreshCw className={cn(solCoreLoading && "animate-spin")} /> Rafraîchir
            </button>
          </div>

          {solCoreLoading && !solCoreData ? (
            <div className="flex justify-center items-center h-64">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#14F195]"></div>
                <p className="text-gray-400 font-geist text-sm">Chargement des 8 tokens de base Solana...</p>
              </div>
            </div>
          ) : solCoreData && solCoreData.tokens ? (
            <div className="space-y-8">
              {/* TABLEAU 1: GAIN / LOSE (24h, 7j, 30j) */}
              <div className="bg-surface border border-gray-800 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center justify-between mb-4 border-b border-gray-800 pb-3">
                  <div>
                    <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                      📊 Tableau de Rendement & Performances
                    </h3>
                    <p className="text-xs text-gray-400 font-geist">
                      Gain / Loss : Dernier Jour (24h), Dernière Semaine (7j), et Dernier Mois (30j)
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left font-geist">
                    <thead>
                      <tr className="text-xs text-gray-400 uppercase tracking-wider border-b border-gray-800/80 bg-white/[0.02]">
                        <th className="py-3 px-4">Token</th>
                        <th className="py-3 px-4">Prix Actuel</th>
                        <th className="py-3 px-4">24h (1 Jour)</th>
                        <th className="py-3 px-4">7j (1 Semaine)</th>
                        <th className="py-3 px-4">30j (1 Mois)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50 text-sm">
                      {solCoreData.tokens.map((t) => (
                        <tr key={t.symbol} className="hover:bg-white/[0.03] transition-colors">
                          <td className="py-3 px-4 flex items-center gap-3">
                            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }}></span>
                            <div>
                              <span className="font-bold text-white uppercase">{t.symbol}</span>
                              <span className="text-xs text-gray-500 ml-2">{t.name}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-mono font-medium text-gray-200">
                            ${t.price >= 1 ? t.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : t.price.toFixed(6)}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span className={cn(
                              "px-2.5 py-1 rounded text-xs font-bold inline-block",
                              t.change_24h > 0 ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40" :
                              t.change_24h < 0 ? "bg-rose-950/60 text-rose-400 border border-rose-800/40" : "text-gray-400"
                            )}>
                              {t.change_24h > 0 ? `+${t.change_24h}%` : `${t.change_24h}%`}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span className={cn(
                              "px-2.5 py-1 rounded text-xs font-bold inline-block",
                              t.change_7d > 0 ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40" :
                              t.change_7d < 0 ? "bg-rose-950/60 text-rose-400 border border-rose-800/40" : "text-gray-400"
                            )}>
                              {t.change_7d > 0 ? `+${t.change_7d}%` : `${t.change_7d}%`}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span className={cn(
                              "px-2.5 py-1 rounded text-xs font-bold inline-block",
                              t.change_30d > 0 ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40" :
                              t.change_30d < 0 ? "bg-rose-950/60 text-rose-400 border border-rose-800/40" : "text-gray-400"
                            )}>
                              {t.change_30d > 0 ? `+${t.change_30d}%` : `${t.change_30d}%`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* SECTION: GRAPHIQUES SIDE-BY-SIDE (WAHD HDA WAHAD) */}
              <div className="bg-surface border border-gray-800 rounded-2xl p-6 shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-800 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                      📈 Graphiques Solana Core (Côte à Côte • Wahd hda Wahad)
                    </h3>
                    <p className="text-xs text-gray-400 font-geist mt-1">
                      Suivi visuel en direct des 8 tokens de 15 minutes jusqu'à 1 mois
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    {/* View Switcher: Mosaïque (Side by Side) vs Superposé (Overlay) */}
                    <div className="flex items-center bg-[#0b171c] p-1 rounded-lg border border-gray-800">
                      <button
                        onClick={() => setChartViewType('grid')}
                        className={cn(
                          "px-3 py-1 text-xs font-geist rounded transition-all",
                          chartViewType === 'grid' ? "bg-accent/20 text-accent font-bold border border-accent/40" : "text-gray-400 hover:text-white"
                        )}
                      >
                        🔲 Mosaïque (8 Graphiques)
                      </button>
                      <button
                        onClick={() => setChartViewType('overlay')}
                        className={cn(
                          "px-3 py-1 text-xs font-geist rounded transition-all",
                          chartViewType === 'overlay' ? "bg-accent/20 text-accent font-bold border border-accent/40" : "text-gray-400 hover:text-white"
                        )}
                      >
                        📊 Comparatif Superposé (%)
                      </button>
                    </div>

                    {/* Timeframe Selector: 15m -> 1M */}
                    <div className="flex items-center bg-[#0b171c] p-1 rounded-lg border border-gray-800">
                      {['15m', '1h', '4h', '1d', '1w', '1M'].map((tf) => (
                        <button
                          key={tf}
                          onClick={() => setSolChartsTf(tf)}
                          className={cn(
                            "px-2.5 py-1 text-xs font-geist rounded transition-all font-mono",
                            solChartsTf === tf ? "bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/40" : "text-gray-400 hover:text-white"
                          )}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {solChartsLoading && !solChartsData ? (
                  <div className="flex justify-center items-center h-48">
                    <div className="flex flex-col items-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
                      <p className="text-xs text-gray-400 font-geist">Chargement des graphiques ({solChartsTf})...</p>
                    </div>
                  </div>
                ) : solChartsData && chartViewType === 'grid' ? (
                  /* 8 CHARTS SIDE-BY-SIDE IN A 4x2 GRID */
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {solChartsData.tokens.map((t) => {
                      const isUp = t.period_change >= 0;
                      return (
                        <div key={t.symbol} className="bg-[#0b171c]/90 border border-gray-800/80 hover:border-gray-700 rounded-xl p-4 transition-all flex flex-col justify-between">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }}></span>
                              <div>
                                <h4 className="font-bold text-white text-sm">{t.symbol}</h4>
                                <span className="text-[10px] text-gray-500 font-geist block">{t.name}</span>
                              </div>
                            </div>
                            <div className="text-right font-mono">
                              <div className="text-sm font-bold text-gray-200">
                                ${t.current_price >= 1 ? t.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : t.current_price.toFixed(6)}
                              </div>
                              <span className={cn(
                                "text-[11px] font-bold px-1.5 py-0.5 rounded inline-block mt-0.5",
                                isUp ? "bg-emerald-950/60 text-emerald-400" : "bg-rose-950/60 text-rose-400"
                              )}>
                                {isUp ? `+${t.period_change}%` : `${t.period_change}%`}
                              </span>
                            </div>
                          </div>

                          <div className="h-28 w-full mt-2">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={t.candles} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id={`grad-${t.symbol}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={t.color} stopOpacity={0.35}/>
                                    <stop offset="95%" stopColor={t.color} stopOpacity={0.0}/>
                                  </linearGradient>
                                </defs>
                                <Tooltip
                                  contentStyle={{ backgroundColor: '#0a1519', borderColor: '#1f2937', borderRadius: '8px', fontSize: '11px' }}
                                  labelStyle={{ color: '#9ca3af' }}
                                  formatter={(val) => [`$${val}`, 'Prix']}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="price"
                                  stroke={t.color}
                                  strokeWidth={2}
                                  fillOpacity={1}
                                  fill={`url(#grad-${t.symbol})`}
                                  dot={false}
                                  isAnimationActive={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : solChartsData && chartViewType === 'overlay' ? (
                  /* NORMALIZED OVERLAY COMPARISON CHART */
                  <div className="h-80 w-full pt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={solChartsData.combined} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                        <XAxis dataKey="time" stroke="#4b5563" fontSize={10} tickLine={false} />
                        <YAxis stroke="#4b5563" fontSize={10} tickLine={false} domain={['auto', 'auto']} tickFormatter={(v) => `${v}%`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0a1519', borderColor: '#1f2937', borderRadius: '8px', fontSize: '11px' }}
                          formatter={(val, name) => [`${val}%`, name.replace('_pct', '')]}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }}
                          formatter={(value) => value.replace('_pct', '')}
                        />
                        <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
                        {solChartsData.tokens.map((t) => (
                          <Line
                            key={t.symbol}
                            type="monotone"
                            dataKey={`${t.symbol}_pct`}
                            name={t.symbol}
                            stroke={t.color}
                            strokeWidth={t.symbol === 'SOL' ? 2.5 : 1.8}
                            dot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="text-center py-10 text-gray-500 font-geist text-xs">
                    Aucune donnée de graphique disponible.
                  </div>
                )}
              </div>

              {/* TABLEAU 2: MATRICE DE FORCE RELATIVE (HEATMAP IDENTIQUE À LA CAPTURE) */}
              <div className="bg-surface border border-gray-800 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 border-b border-gray-800 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                      <span className="text-yellow-400">❖</span> Matrice de Force Relative 8x8 (Écart de Performance)
                    </h3>
                    <p className="text-xs text-gray-400 font-geist mt-1">
                      <span className="text-gray-300 font-semibold">Ligne vs Colonne :</span> <span className="text-emerald-400">Vert = La ligne bat la colonne</span> • <span className="text-rose-400">Rouge = La colonne bat la ligne</span>
                    </p>
                  </div>

                  {/* Timeframe Selector for Relative Strength */}
                  <div className="flex items-center gap-1 bg-[#0b171c] p-1 rounded-lg border border-gray-800 self-start md:self-auto">
                    <button
                      onClick={() => setMatrixTf('24h')}
                      className={cn(
                        "px-3 py-1 text-xs font-geist rounded transition-all",
                        matrixTf === '24h' ? "bg-accent/20 text-accent font-bold border border-accent/40" : "text-gray-400 hover:text-white"
                      )}
                    >
                      24 Heures
                    </button>
                    <button
                      onClick={() => setMatrixTf('7d')}
                      className={cn(
                        "px-3 py-1 text-xs font-geist rounded transition-all",
                        matrixTf === '7d' ? "bg-accent/20 text-accent font-bold border border-accent/40" : "text-gray-400 hover:text-white"
                      )}
                    >
                      7 Jours
                    </button>
                    <button
                      onClick={() => setMatrixTf('30d')}
                      className={cn(
                        "px-3 py-1 text-xs font-geist rounded transition-all",
                        matrixTf === '30d' ? "bg-accent/20 text-accent font-bold border border-accent/40" : "text-gray-400 hover:text-white"
                      )}
                    >
                      30 Jours
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-center font-geist text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-400">
                        <th className="py-3 px-4 text-left font-semibold text-gray-400 uppercase tracking-wider">
                          Base \ Quote
                        </th>
                        {solCoreData.tokens.map((t) => (
                          <th key={t.symbol} className="py-3 px-3 font-bold uppercase text-gray-200">
                            {t.symbol}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/40">
                      {solCoreData.tokens.map((row) => {
                        const rowChange = matrixTf === '24h' ? row.change_24h : (matrixTf === '7d' ? row.change_7d : row.change_30d);

                        return (
                          <tr key={row.symbol} className="hover:bg-white/[0.02]">
                            {/* Row Header */}
                            <td className="py-3 px-4 text-left font-bold uppercase flex items-center gap-2 whitespace-nowrap text-white">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.color }}></span>
                              {row.symbol}
                            </td>

                            {/* Matrix Cells */}
                            {solCoreData.tokens.map((col) => {
                              if (row.symbol === col.symbol) {
                                return (
                                  <td key={col.symbol} className="py-3 px-3 text-gray-600 font-mono bg-black/20">
                                    —
                                  </td>
                                );
                              }

                              const colChange = matrixTf === '24h' ? col.change_24h : (matrixTf === '7d' ? col.change_7d : col.change_30d);
                              const spread = Number((rowChange - colChange).toFixed(1));
                              const isPositive = spread > 0;
                              const isZero = spread === 0;

                              return (
                                <td
                                  key={col.symbol}
                                  className={cn(
                                    "py-3 px-3 font-mono font-bold transition-colors",
                                    isPositive
                                      ? "bg-[#06241a]/80 text-[#22c55e] border-y border-[#063b27]/60"
                                      : !isZero
                                      ? "bg-[#270b13]/80 text-[#f43f5e] border-y border-[#3d111d]/60"
                                      : "bg-black/20 text-gray-400"
                                  )}
                                >
                                  {isPositive ? `+${spread.toFixed(1)}%` : `${spread.toFixed(1)}%`}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 font-geist">
              Impossible de charger les données Solana Core pour le moment.
            </div>
          )}
        </div>
      ) : viewMode === 'weekend' && weekendData ? (
        <div className="space-y-8 animate-fade-in">
          <div className="bg-purple-900/20 border border-purple-500/50 rounded-2xl p-6 flex items-start gap-4">
            <FiAlertTriangle className="text-purple-400 text-3xl shrink-0 mt-1" />
            <div className="w-full">
              <h2 className="text-purple-400 font-bold text-xl mb-2">LIVE: Weekend GAP Scanner</h2>
              <p className="text-purple-200/80 font-geist text-sm leading-relaxed mb-4">
                Traditional stock markets (Wall Street) are currently closed for the weekend, but crypto trades 24/7. 
                Below are Tokenized Stocks (bStocks) available on Binance Spot and their most correlated crypto proxies. 
                <br/><strong className="text-white">If a proxy pumps &gt; 4% over the weekend, the bStock is mathematically guaranteed (60-100% win rate) to GAP UP on Monday open!</strong>
              </p>
              
              {weekendAlerts.length > 0 ? (
                <div className="mt-6 space-y-4">
                  {weekendAlerts.map((alert, i) => (
                    <div 
                      key={i} 
                      onClick={() => handleWeekendClick(alert.bStock, alert.proxy)}
                      className="bg-red-500/10 border-2 border-red-500/50 rounded-xl p-4 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.2)] cursor-pointer hover:border-red-400 hover:bg-red-500/20 transition-all"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <h3 className="text-red-400 font-bold text-lg">{alert.message}</h3>
                          <p className="text-red-300/80 text-sm font-geist mb-2">Action: Go LONG on {alert.bStock} at exactly Monday 14:30 UTC.</p>
                          {alert.stats && alert.stats.pumps > 0 ? (
                            <span className="inline-flex items-center gap-1 bg-black/40 border border-red-500/30 text-red-300 text-xs px-2 py-1 rounded font-geist">
                              🎯 Historical Win Rate: {alert.stats.wins}/{alert.stats.pumps} ({alert.stats.rate}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-black/40 border border-gray-700 text-gray-400 text-xs px-2 py-1 rounded font-geist">
                              ⏳ Not enough historical data for this pair
                            </span>
                          )}
                        </div>
                        <div className="bg-red-500/20 px-4 py-2 rounded-lg border border-red-500/50 shrink-0">
                          <span className="text-red-400 font-bold font-geist text-xl">+{alert.pump.toFixed(2)}%</span>
                        </div>
                      </div>
                      
                      {alert.reasoning && (
                        <div className="mt-2 bg-red-900/30 p-3 rounded-lg border border-red-500/20">
                          <p className="text-red-200/90 text-sm font-geist italic">
                             <span className="font-bold text-red-400 not-italic mr-2">🧠 AI Insight:</span> 
                             {alert.reasoning}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 bg-purple-500/10 border border-purple-500/20 rounded-xl p-4 text-center">
                  <p className="text-purple-400 font-bold font-geist">Waiting for a Crypto PUMP... Scanning Binance 24/7.</p>
                </div>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {weekendData.map(item => (
              <div key={item.bstock} className="bg-surface border border-gray-800 rounded-2xl p-6 hover:border-purple-500/50 transition-colors">
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-800">
                  <h3 className="text-2xl font-bold">{item.bstock}</h3>
                  <span className="bg-white/5 text-gray-400 text-xs px-2 py-1 rounded font-geist">bStock</span>
                </div>
                
                <div className="mb-6">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Crypto Proxies (Positive)</p>
                  <div className="space-y-2">
                    {item.topPos.map(proxy => (
                      <div key={proxy.symbol} onClick={() => handleWeekendClick(item.bstock, proxy.symbol)} className="flex justify-between items-center p-2 bg-[#0a1519] rounded border border-gray-800 hover:border-accent cursor-pointer transition-colors">
                        <span className="font-bold text-sm">{proxy.symbol}</span>
                        <span className="text-green-400 font-geist text-sm">{proxy.value.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Crypto Proxies (Inverse)</p>
                  <div className="space-y-2">
                    {item.topInv.map(proxy => (
                      <div key={proxy.symbol} onClick={() => handleWeekendClick(item.bstock, proxy.symbol)} className="flex justify-between items-center p-2 bg-[#0a1519] rounded border border-gray-800 hover:border-red-400 cursor-pointer transition-colors">
                        <span className="font-bold text-sm">{proxy.symbol}</span>
                        <span className="text-red-400 font-geist text-sm">{proxy.value.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : displayData ? (
        <div className="grid md:grid-cols-2 gap-8">
          
          {/* Top Correlated */}
          <div className="bg-surface border border-gray-800 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-green-400">
              <FiTrendingUp /> {viewMode === 'global' ? "Top 50 Correlated Pairs" : "Highest Correlation (Top 50)"}
            </h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#102127 transparent' }}>
              {displayData.top.map((item, i) => (
                <div key={item.symbol} onClick={() => handleRowClick(item.symbol)} className="flex justify-between items-center p-2.5 hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-gray-800 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 font-geist text-sm w-6">{i + 1}.</span>
                    <span className="font-bold text-sm md:text-sm">{item.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 md:w-28 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500" style={{ width: `${Math.max(0, item.value * 100)}%` }} />
                    </div>
                    <span className="font-geist text-sm text-green-400 w-10 text-right">{item.value.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Least/Inverse Correlated */}
          <div className="bg-surface border border-gray-800 rounded-2xl p-6">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-red-400">
              <FiTrendingDown /> {viewMode === 'global' ? "Top 50 Inverse Pairs" : "Lowest Correlation (Top 50)"}
            </h2>
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#102127 transparent' }}>
              {displayData.bottom.map((item, i) => (
                <div key={item.symbol} onClick={() => handleRowClick(item.symbol)} className="flex justify-between items-center p-2.5 hover:bg-white/5 rounded-lg transition-colors border border-transparent hover:border-gray-800 cursor-pointer">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 font-geist text-sm w-6">{i + 1}.</span>
                    <span className="font-bold text-sm md:text-sm">{item.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 md:w-28 h-1.5 bg-gray-800 rounded-full overflow-hidden flex justify-end">
                      <div className={cn("h-full", item.value < 0 ? "bg-red-500" : "bg-gray-500")} style={{ width: `${Math.abs(item.value) * 100}%` }} />
                    </div>
                    <span className={cn("font-geist text-sm w-10 text-right", item.value < 0 ? "text-red-400" : "text-gray-400")}>{item.value.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      ) : null}

      {/* Heatmap Preview (Simplified list of all for now) */}
      {data && data.tokens && viewMode === 'single' && (
        <div className="mt-12 bg-surface border border-gray-800 rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-6 text-gray-300">Available Top Markets ({data.tokens.length})</h2>
          <div className="flex flex-wrap gap-2 max-h-64 overflow-y-auto p-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#102127 transparent' }}>
            {data.tokens.map(t => (
              <button 
                key={t}
                onClick={() => setSelectedToken(t)}
                className={cn(
                  "px-3 py-1.5 rounded-lg font-geist text-sm transition-all border",
                  selectedToken === t 
                    ? "bg-accent/20 border-accent text-accent" 
                    : "bg-[#0a1519] border-gray-800 hover:border-gray-600 text-gray-400 hover:text-white"
                )}
              >
                {t}
              </button>
            ))}
        </div>
        </div>
      )}

      {/* Chart Modal */}
      {chartPair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-surface border border-gray-800 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col">
            
            <div className="flex justify-between items-center p-6 border-b border-gray-800">
              <h3 className="text-2xl font-bold flex items-center gap-3">
                {chartPair.t1} <span className="text-gray-500 text-sm">vs</span> {chartPair.t2}
              </h3>
              <button onClick={() => setChartPair(null)} className="text-gray-400 hover:text-white p-2">
                <FiX className="text-2xl" />
              </button>
            </div>

            <div className="p-6">
              {/* Timeframe selector */}
              <div className="flex gap-2 mb-6">
                {timeframes.map(tf => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    className={cn(
                      "px-3 py-1.5 rounded-md font-geist text-sm transition-all",
                      timeframe === tf ? "bg-accent/20 text-accent border border-accent/50" : "bg-black/20 text-gray-400 border border-transparent hover:border-gray-800 hover:text-white"
                    )}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              {/* Chart Area */}
              <div className="h-96 w-full relative bg-[#071013] rounded-xl border border-gray-800/50 p-4">
                {chartLoading ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent mb-4"></div>
                    <span className="font-geist text-gray-400">Loading {timeframe} history...</span>
                  </div>
                ) : chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#ffffff40" 
                        fontSize={12} 
                        tickFormatter={(val) => val.split(',')[0]} // Show only date
                        minTickGap={30}
                      />
                      <YAxis 
                        stroke="#ffffff40" 
                        fontSize={12} 
                        tickFormatter={(val) => `${val > 0 ? '+' : ''}${val.toFixed(1)}%`}
                        domain={['dataMin', 'dataMax']}
                      />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#102127', borderColor: '#334155', borderRadius: '8px' }}
                        itemStyle={{ fontFamily: 'Geist Mono', fontSize: '14px' }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '8px' }}
                        formatter={(value, name) => [`${value > 0 ? '+' : ''}${value.toFixed(2)}%`, name.replace('_pct', ' % Change')]}
                      />
                      <Legend iconType="circle" />
                      
                      {/* Monday Reference Lines & Gap Win Indicators */}
                      {(() => {
                        let lastFriday = null;
                        const lines = [];
                        
                        chartData.forEach((d, i, arr) => {
                          const dateObj = new Date(d.time);
                          const day = dateObj.getDay();
                          
                          // Track Friday's close (the last data point of Friday)
                          if (day === 5) {
                            const nextDay = i < arr.length - 1 ? new Date(arr[i+1].time).getDay() : null;
                            if (nextDay !== 5) lastFriday = d;
                          }
                          
                          // First point of Monday
                          if (day === 1) {
                            const prevDateObj = i > 0 ? new Date(arr[i-1].time) : null;
                            if (!prevDateObj || prevDateObj.getDay() !== 1) {
                              
                              let isSuccess = false;
                              if (lastFriday && chartPair) {
                                const friT1 = lastFriday[chartPair.t1]; // bStock close
                                const friT2 = lastFriday[chartPair.t2]; // Crypto close
                                const monT1 = d[chartPair.t1]; // bStock open
                                const monT2 = d[chartPair.t2]; // Crypto open
                                
                                if (friT1 && friT2 && monT1 && monT2) {
                                  const t2Move = ((monT2 - friT2) / friT2) * 100;
                                  const t1Gap = ((monT1 - friT1) / friT1) * 100;
                                  // Condition: Crypto pumped > 3% on weekend, bStock gapped UP > 0%
                                  if (t2Move > 3 && t1Gap > 0) {
                                    isSuccess = true;
                                  }
                                }
                              }
                              
                              lines.push(
                                <ReferenceLine 
                                  key={`mon-${i}`} 
                                  x={d.date} 
                                  stroke={isSuccess ? "#22c55e" : "#a855f7"} 
                                  strokeOpacity={isSuccess ? 0.8 : 0.4} 
                                  strokeWidth={isSuccess ? 2 : 1}
                                  strokeDasharray="4 4"
                                  label={{ 
                                    position: 'insideTopLeft', 
                                    value: isSuccess ? '🚀 WIN' : 'MONDAY', 
                                    fill: isSuccess ? '#22c55e' : '#a855f7', 
                                    fontSize: isSuccess ? 12 : 10, 
                                    opacity: 0.9,
                                    fontWeight: isSuccess ? 'bold' : 'normal'
                                  }}
                                />
                              );
                            }
                          }
                        });
                        return lines;
                      })()}

                      <Line type="monotone" dataKey={`${chartPair.t1}_pct`} name={chartPair.t1} stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey={`${chartPair.t2}_pct`} name={chartPair.t2} stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-geist">
                    No matching historical data found for this timeframe.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
