const express = require('express');
const cors = require('cors');
const ccxt = require('ccxt');

const app = express();
app.use(cors());

let cache = {
  '1h': { last_updated: 0, matrix: null, tokens: [] },
  '4h': { last_updated: 0, matrix: null, tokens: [] },
  '1d': { last_updated: 0, matrix: null, tokens: [] },
  '1w': { last_updated: 0, matrix: null, tokens: [] },
};

// Calculate Pearson Correlation
function calculateCorrelation(x, y) {
  if (!x || !y || x.length !== y.length || x.length === 0) return null;
  const n = x.length;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  
  const meanX = sumX / n;
  const meanY = sumY / n;
  
  let num = 0;
  let den1 = 0;
  let den2 = 0;
  
  for (let i = 0; i < n; i++) {
    const diffX = x[i] - meanX;
    const diffY = y[i] - meanY;
    num += diffX * diffY;
    den1 += diffX * diffX;
    den2 += diffY * diffY;
  }
  
  if (den1 === 0 || den2 === 0) return 0;
  return num / Math.sqrt(den1 * den2);
}

// Fetch data and build matrix
async function fetchAndCalculateCorrelation(limit = 400, period = '1w') {
  console.log(`Fetching market data for period ${period}...`);
  const exchange = new ccxt.binance({ enableRateLimit: true });
  
  const markets = await exchange.loadMarkets();
  const usdtPairs = Object.keys(markets).filter(symbol => {
    const market = markets[symbol];
    return market.quote === 'USDT' && market.spot && market.active;
  });
  
  // Filter out leveraged tokens
  const cleanPairs = usdtPairs.filter(p => !/(UP|DOWN|BULL|BEAR)\/USDT/.test(p));
  
  // Fetch all tickers to sort by volume (no arguments to avoid URL Too Long error)
  console.log("Fetching tickers to sort by volume...");
  const tickers = await exchange.fetchTickers();
  const sortedPairs = cleanPairs.sort((a, b) => {
    const volA = tickers[a]?.quoteVolume || 0;
    const volB = tickers[b]?.quoteVolume || 0;
    return volB - volA;
  });
  
  const selectedPairs = sortedPairs.slice(0, limit);
  console.log(`Fetching OHLCV for ${selectedPairs.length} pairs... This might take a minute.`);
  
  let tf = '1h';
  let days = 7;
  if (period === '1d') {
    tf = '15m';
    days = 1;
  } else if (period === '4h') {
    tf = '5m';
    days = 4 / 24; // 4 hours
  } else if (period === '1h') {
    tf = '1m';
    days = 1 / 24; // 1 hour
  }

  const since = exchange.milliseconds() - (days * 24 * 60 * 60 * 1000); 
  const prices = {};
  
  // Fetch in chunks to speed up, ccxt rate limiter handles the rest
  const chunkSize = 10;
  for (let i = 0; i < selectedPairs.length; i += chunkSize) {
    const chunk = selectedPairs.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (symbol) => {
      try {
        const ohlcv = await exchange.fetchOHLCV(symbol, tf, since);
        const closes = ohlcv.map(x => x[4]);
        const returns = [];
        for(let j=1; j<closes.length; j++) {
          returns.push((closes[j] - closes[j-1]) / closes[j-1]);
        }
        prices[symbol.replace('/USDT', '')] = returns;
      } catch (e) {
        console.error(`Failed to fetch ${symbol}: ${e.message}`);
      }
    }));
  }
  
  const tokens = Object.keys(prices);
  const matrix = {};
  
  // Build correlation matrix
  for (const t1 of tokens) {
    matrix[t1] = {};
    for (const t2 of tokens) {
      if (t1 === t2) {
        matrix[t1][t2] = 1.0;
      } else {
        const corr = calculateCorrelation(prices[t1], prices[t2]);
        matrix[t1][t2] = corr;
      }
    }
  }
  
  return { matrix, tokens };
}

app.get('/api/correlation', async (req, res) => {
  const limit = parseInt(req.query.limit) || 400;
  const period = req.query.period || '1w';
  const forceRefresh = req.query.force_refresh === 'true';
  const now = Date.now();
  
  if (!cache[period]) {
     return res.status(400).json({ error: "Invalid period. Use 1h, 4h, 1d, 1w." });
  }

  if (!cache[period].matrix || forceRefresh || (now - cache[period].last_updated > 3600000)) {
    try {
      const data = await fetchAndCalculateCorrelation(limit, period);
      cache[period].matrix = data.matrix;
      cache[period].tokens = data.tokens;
      cache[period].last_updated = now;
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: error.message });
    }
  }
  
  res.json({
    period,
    tokens: cache[period].tokens,
    matrix: cache[period].matrix,
    last_updated: cache[period].last_updated
  });
});

app.get('/api/correlation/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  if (!cache.matrix) {
    return res.status(400).json({ error: "Matrix not generated yet. Call /api/correlation first." });
  }
  if (!cache.matrix[symbol]) {
    return res.status(404).json({ error: `Symbol ${symbol} not found in current data.` });
  }
  
  const correlations = cache.matrix[symbol];
  const sortedCorr = Object.keys(correlations)
    .filter(k => k !== symbol && correlations[k] !== null && !isNaN(correlations[k]))
    .map(k => ({ symbol: k, correlation: correlations[k] }))
    .sort((a, b) => b.correlation - a.correlation);
    
  res.json({
    symbol,
    top_correlated: sortedCorr.slice(0, 10),
    least_correlated: sortedCorr.slice(-10).reverse()
  });
});

app.get('/api/chart', async (req, res) => {
  try {
    const { t1, t2, timeframe } = req.query;
    if (!t1 || !t2 || !timeframe) {
      return res.status(400).json({ error: "Missing t1, t2, or timeframe" });
    }

    const exchange = new ccxt.binance({ enableRateLimit: true });
    
    // Determine how much data to fetch based on timeframe (approx 300-500 candles)
    let days = 7;
    if (timeframe === '15m') days = 3;
    if (timeframe === '1h') days = 14;
    if (timeframe === '4h') days = 60;
    if (timeframe === '1d') days = 365;
    if (timeframe === '1w') days = 365 * 3;
    if (timeframe === '1M') days = 365 * 5;

    const since = exchange.milliseconds() - (days * 24 * 60 * 60 * 1000);
    
    // Fetch both simultaneously
    const [ohlcv1, ohlcv2] = await Promise.all([
      exchange.fetchOHLCV(`${t1}/USDT`, timeframe, since),
      exchange.fetchOHLCV(`${t2}/USDT`, timeframe, since)
    ]);

    // Format data for Recharts (we need matched timestamps)
    // Create a map of timestamp -> { time, t1_price, t2_price }
    const map = {};
    
    ohlcv1.forEach(candle => {
      const ts = candle[0];
      map[ts] = { time: ts, [t1]: candle[4] };
    });
    
    ohlcv2.forEach(candle => {
      const ts = candle[0];
      if (!map[ts]) map[ts] = { time: ts };
      map[ts][t2] = candle[4];
    });

    // Sort and calculate normalized percentage change (starting at 0%)
    let result = Object.values(map).sort((a, b) => a.time - b.time);
    
    // Filter out points where one is missing to make the chart clean
    result = result.filter(d => d[t1] !== undefined && d[t2] !== undefined);

    if (result.length > 0) {
      const startT1 = result[0][t1];
      const startT2 = result[0][t2];
      
      result = result.map(d => {
        const dt = new Date(d.time);
        const formattedDate = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
        return {
          ...d,
          date: formattedDate,
          [`${t1}_pct`]: ((d[t1] - startT1) / startT1) * 100,
          [`${t2}_pct`]: ((d[t2] - startT2) / startT2) * 100
        };
      });
    }

    res.json({ data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// --- AUTOMATED SIGNAL ENGINE (Darba lmazyana) ---
const BSTOCKS = ['AMDB', 'NVDAB', 'TSMB', 'INTCB', 'INTWB', 'QQQB', 'TQQQB', 'SOXLB', 'SOXSB', 'AVGOB', 'AXTIB', 'DRAMB', 'GLWB', 'COHRB', 'HOODB', 'CBRSB', 'NBISB', 'MRNAB', 'NFLXB', 'SNDKB'];

let liveSignals = { data: [], last_updated: 0 };

async function generateSignals() {
  console.log("Running Auto-Signal Engine (Scanning for Anomalies)...");
  try {
    const limit = 400;
    // Ensure we have 1w data
    if (!cache['1w'] || !cache['1w'].matrix || (Date.now() - cache['1w'].last_updated > 3600000)) {
      const d = await fetchAndCalculateCorrelation(limit, '1w');
      cache['1w'] = { matrix: d.matrix, tokens: d.tokens, last_updated: Date.now() };
    }
    // Ensure we have 1h data
    if (!cache['1h'] || !cache['1h'].matrix || (Date.now() - cache['1h'].last_updated > 3600000)) {
      const d = await fetchAndCalculateCorrelation(limit, '1h');
      cache['1h'] = { matrix: d.matrix, tokens: d.tokens, last_updated: Date.now() };
    }

    const matrix1w = cache['1w'].matrix;
    const matrix1h = cache['1h'].matrix;
    const tokens = cache['1w'].tokens;
    
    let anomalies = [];
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const t1 = tokens[i];
        const t2 = tokens[j];
        
        // Filter out wrapped/pegged tokens that create noise
        if ((t1==='BTC'&&t2==='WBTC') || (t1==='ETH'&&t2==='WBETH') || (t1==='EUR'&&t2==='EURI')) continue;
        
        const c1w = matrix1w[t1]?.[t2];
        const c1h = matrix1h[t1]?.[t2];
        
        if (c1w !== undefined && c1h !== undefined && c1w !== null && c1h !== null) {
          
          const isT1Stock = BSTOCKS.includes(t1);
          const isT2Stock = BSTOCKS.includes(t2);
          
          // SCENARIO 1: Weekend TradFi Arbitrage (bStock vs Crypto)
          if ((isT1Stock && !isT2Stock) || (!isT1Stock && isT2Stock)) {
            // Lower threshold because cross-asset corr is naturally lower
            if (c1w > 0.45 && c1h < 0.15) {
              anomalies.push({
                pair: `${t1} - ${t2}`, t1, t2,
                corr_1w: c1w, corr_1h: c1h, divergence: c1w - c1h,
                type: 'Weekend GAP'
              });
            }
          }
          // SCENARIO 2: Crypto Laggard Arbitrage (Crypto vs Crypto)
          else if (!isT1Stock && !isT2Stock) {
            if (c1w > 0.85 && c1h < 0.20) {
              anomalies.push({
                pair: `${t1} - ${t2}`, t1, t2,
                corr_1w: c1w, corr_1h: c1h, divergence: c1w - c1h,
                type: 'Crypto Laggard'
              });
            }
          }
        }
      }
    }
    
    // Sort by largest divergence
    anomalies.sort((a, b) => b.divergence - a.divergence);
    
    liveSignals = {
      data: anomalies.slice(0, 15), // Top 15 opportunities
      last_updated: Date.now()
    };
    console.log(`Signal Engine found ${liveSignals.data.length} anomalies.`);
  } catch (err) {
    console.error("Signal generation error:", err.message);
  }
}

// Run signal engine 5 seconds after startup, then every hour
setTimeout(generateSignals, 5000);
setInterval(generateSignals, 3600000);

app.get('/api/signals', (req, res) => {
  res.json(liveSignals);
});

// --- PING PONG (VOLATILITY HARVESTING) SIMULATION ---
app.get('/api/pingpong', async (req, res) => {
  try {
    const { t1, t2, timeframe = '1h' } = req.query;
    if (!t1 || !t2) return res.status(400).json({ error: "Missing t1 or t2" });

    const exchange = new ccxt.binance({ enableRateLimit: true });
    
    let days = 14; // Default 14 days for 1h
    if (timeframe === '15m') days = 3;
    if (timeframe === '1d') days = 100;
    
    const since = exchange.milliseconds() - (days * 24 * 60 * 60 * 1000);
    
    const [ohlcv1, ohlcv2] = await Promise.all([
      exchange.fetchOHLCV(`${t1}/USDT`, timeframe, since).catch(() => []),
      exchange.fetchOHLCV(`${t2}/USDT`, timeframe, since).catch(() => [])
    ]);

    const map = {};
    ohlcv1.forEach(c => map[c[0]] = { time: c[0], p1: c[4] });
    ohlcv2.forEach(c => { if(map[c[0]]) map[c[0]].p2 = c[4]; });
    
    let data = Object.values(map)
      .filter(d => d.p1 !== undefined && d.p2 !== undefined)
      .sort((a,b) => a.time - b.time);

    if (data.length === 0) return res.status(404).json({ error: "No overlapping data found." });

    let hold_qty1 = 1000 / data[0].p1;
    let hold_qty2 = 1000 / data[0].p2;
    
    let rebal_portfolio = 2000;
    let rebal_qty1 = 1000 / data[0].p1;
    let rebal_qty2 = 1000 / data[0].p2;
    
    let results = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const holdValue = (hold_qty1 * row.p1) + (hold_qty2 * row.p2);
      
      const current_v1 = rebal_qty1 * row.p1;
      const current_v2 = rebal_qty2 * row.p2;
      const current_rebal_portfolio = current_v1 + current_v2;
      
      const target_each = current_rebal_portfolio / 2;
      rebal_qty1 = target_each / row.p1;
      rebal_qty2 = target_each / row.p2;
      
      results.push({
        date: new Date(row.time).toLocaleString(),
        p1_price: row.p1,
        p2_price: row.p2,
        hold_value: holdValue,
        rebal_value: current_rebal_portfolio
      });
    }

    const last = data[data.length - 1];
    const target = results[results.length - 1].rebal_value / 2;
    const current_v1 = rebal_qty1 * last.p1;
    const current_v2 = rebal_qty2 * last.p2;
    
    let action = null;
    // Difference from target
    const diff1 = current_v1 - target; 
    if (diff1 > 1) { // 1 USDT threshold to avoid dust
      action = `Sell $${Math.abs(diff1).toFixed(2)} of ${t1} -> Buy ${t2}`;
    } else if (diff1 < -1) {
      action = `Sell $${Math.abs(diff1).toFixed(2)} of ${t2} -> Buy ${t1}`;
    } else {
      action = `Balanced (No action needed)`;
    }

    res.json({
      t1, t2,
      start_date: results[0].date,
      end_date: results[results.length - 1].date,
      initial_investment: 2000,
      final_hold: results[results.length - 1].hold_value,
      final_rebalance: results[results.length - 1].rebal_value,
      profit_vs_hold: results[results.length - 1].rebal_value - results[results.length - 1].hold_value,
      live_action: action,
      chart: results
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Helper to get historical gap stats
async function getGapStats(exchange, bStock, proxy) {
  try {
    const ohlcvB = await exchange.fetchOHLCV(`${bStock}/USDT`, '1d', undefined, 150).catch(()=>[]);
    const ohlcvC = await exchange.fetchOHLCV(`${proxy}/USDT`, '1d', undefined, 150).catch(()=>[]);
    
    const map = {};
    ohlcvB.forEach(c => {
      const d = new Date(c[0]);
      map[d.toISOString().split('T')[0]] = { day: d.getDay(), bClose: c[4], bOpen: c[1] };
    });
    ohlcvC.forEach(c => {
      const dStr = new Date(c[0]).toISOString().split('T')[0];
      if (map[dStr]) { map[dStr].cClose = c[4]; map[dStr].cOpen = c[1]; }
    });
    
    const dates = Object.keys(map).sort();
    let pumps = 0; let wins = 0;
    
    for (let i = 0; i < dates.length - 3; i++) {
      if (map[dates[i]].day === 5) {
        const fri = map[dates[i]];
        let mon = null;
        for (let j=1; j<=4; j++) {
          if (map[dates[i+j]] && map[dates[i+j]].day === 1) { mon = map[dates[i+j]]; break; }
        }
        if (mon && fri.cClose && mon.cOpen && fri.bClose && mon.bOpen) {
          const cMove = ((mon.cOpen - fri.cClose) / fri.cClose) * 100;
          const bGap = ((mon.bOpen - fri.bClose) / fri.bClose) * 100;
          if (cMove > 3) { // significant weekend pump
            pumps++;
            if (bGap > 0) wins++;
          }
        }
      }
    }
    return { pumps, wins, rate: pumps > 0 ? ((wins/pumps)*100).toFixed(0) : 0 };
  } catch(e) { return { pumps:0, wins:0, rate:0 }; }
}

// --- WEEKEND GAP ALERT SYSTEM ---
app.get('/api/weekend-alerts', async (req, res) => {
  try {
    if (!cache['1w'] || !cache['1w'].matrix) {
      return res.status(400).json({ error: "Matrix not ready. Fetch /api/correlation first." });
    }

    const exchange = new ccxt.binance({ enableRateLimit: true });
    const tickers = await exchange.fetchTickers();
    const matrix = cache['1w'].matrix;
    
    let alerts = [];
    let promises = [];

    BSTOCKS.forEach(bstock => {
      if (!matrix[bstock]) return;
      
      let proxies = Object.keys(matrix[bstock])
        .filter(k => !BSTOCKS.includes(k) && matrix[bstock][k] !== null && !isNaN(matrix[bstock][k]))
        .map(k => ({ symbol: k, corr: matrix[bstock][k] }))
        .sort((a, b) => b.corr - a.corr)
        .slice(0, 3);
      
      proxies.forEach(proxy => {
        const ticker = tickers[proxy.symbol + '/USDT'];
        if (ticker && ticker.percentage > 4) {
          promises.push(
            getGapStats(exchange, bstock, proxy.symbol).then(stats => {
              const aiReasoning = `Because ${proxy.symbol} and ${bstock} share a strong historical correlation (${(proxy.corr * 100).toFixed(1)}%), they usually move together. Since Wall Street is closed for the weekend, ${bstock} is price-frozen. Meanwhile, ${proxy.symbol} has already absorbed a massive +${ticker.percentage.toFixed(2)}% bullish momentum. The algorithm predicts that ${bstock} market makers will violently price-in this missing momentum at Monday's open, causing a guaranteed GAP UP.`;
              alerts.push({
                bStock: bstock,
                proxy: proxy.symbol,
                corr: proxy.corr,
                pump: ticker.percentage,
                stats: stats,
                message: `BE READY MONDAY: ${proxy.symbol} is up ${ticker.percentage.toFixed(2)}%!`,
                reasoning: aiReasoning
              });
            })
          );
        }
      });
    });

    await Promise.all(promises);
    alerts.sort((a, b) => b.pump - a.pump);

    res.json({
      active: alerts.length > 0,
      alerts: alerts,
      last_updated: Date.now()
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});



// --- SOLANA CORE (BINANCE SPOT) ---
const SOL_CORE_TOKENS = [
  { symbol: 'SOL', name: 'Solana', pair: 'SOL/USDT', color: '#14F195' },
  { symbol: 'JUP', name: 'Jupiter', pair: 'JUP/USDT', color: '#3B82F6' },
  { symbol: 'MET', name: 'Meteora', pair: 'MET/USDT', color: '#F59E0B' },
  { symbol: 'JTO', name: 'Jito', pair: 'JTO/USDT', color: '#8B5CF6' },
  { symbol: 'ORCA', name: 'Orca', pair: 'ORCA/USDT', color: '#06B6D4' },
  { symbol: 'RAY', name: 'Raydium', pair: 'RAY/USDT', color: '#EC4899' },
  { symbol: 'KMNO', name: 'Kamino', pair: 'KMNO/USDT', color: '#10B981' },
  { symbol: 'PUMP', name: 'Pump.fun', pair: 'PUMP/USDT', color: '#EAB308' },
];

let solCoreCache = { data: null, timestamp: 0 };

app.get('/api/solana-core', async (req, res) => {
  try {
    const now = Date.now();
    if (solCoreCache.data && now - solCoreCache.timestamp < 30000) {
      return res.json(solCoreCache.data);
    }

    const exchange = new ccxt.binance({ enableRateLimit: true });

    const results = await Promise.all(
      SOL_CORE_TOKENS.map(async (t) => {
        try {
          const [ticker, ohlcv] = await Promise.all([
            exchange.fetchTicker(t.pair),
            exchange.fetchOHLCV(t.pair, '1d', undefined, 35)
          ]);

          const curr = ticker.last;
          const c7 = ohlcv && ohlcv.length >= 8 ? ohlcv[ohlcv.length - 8][4] : (ohlcv && ohlcv[0] ? ohlcv[0][4] : curr);
          const c30 = ohlcv && ohlcv.length >= 31 ? ohlcv[ohlcv.length - 31][4] : (ohlcv && ohlcv[0] ? ohlcv[0][4] : curr);

          const change24h = ticker.percentage ? Number(ticker.percentage.toFixed(2)) : 0;
          const change7d = c7 ? Number((((curr - c7) / c7) * 100).toFixed(2)) : 0;
          const change30d = c30 ? Number((((curr - c30) / c30) * 100).toFixed(2)) : 0;

          return {
            symbol: t.symbol,
            name: t.name,
            pair: t.pair,
            color: t.color,
            price: curr,
            change_24h: change24h,
            change_7d: change7d,
            change_30d: change30d,
          };
        } catch (e) {
          console.error(`Error fetching ${t.symbol}:`, e.message);
          return {
            symbol: t.symbol,
            name: t.name,
            pair: t.pair,
            color: t.color,
            price: 0,
            change_24h: 0,
            change_7d: 0,
            change_30d: 0,
          };
        }
      })
    );

    const payload = {
      tokens: results,
      last_updated: now
    };

    solCoreCache = { data: payload, timestamp: now };
    res.json(payload);
  } catch (error) {
    console.error("Solana Core Error:", error);
    if (solCoreCache.data) return res.json(solCoreCache.data);
    res.status(500).json({ error: error.message });
  }
});

// --- SOLANA CORE CHARTS (MULTI-TIMEFRAME) ---
let solChartsCache = {};

app.get('/api/solana-charts', async (req, res) => {
  try {
    const tf = req.query.timeframe || '1h';
    const now = Date.now();
    
    if (solChartsCache[tf] && now - solChartsCache[tf].timestamp < 15000) {
      return res.json(solChartsCache[tf].data);
    }

    const exchange = new ccxt.binance({ enableRateLimit: true });
    const limit = tf === '1M' ? 24 : (tf === '1w' ? 30 : (tf === '15m' ? 60 : 48));

    const tokenCharts = await Promise.all(
      SOL_CORE_TOKENS.map(async (t) => {
        try {
          const ohlcv = await exchange.fetchOHLCV(t.pair, tf, undefined, limit);
          if (!ohlcv || ohlcv.length === 0) return { symbol: t.symbol, name: t.name, color: t.color, candles: [] };

          const firstClose = ohlcv[0][4] || 1;
          const candles = ohlcv.map(c => {
            const d = new Date(c[0]);
            const timeStr = tf === '1M' || tf === '1w' || tf === '1d'
              ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
              : `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            
            const pct = Number((((c[4] - firstClose) / firstClose) * 100).toFixed(2));
            return {
              timestamp: c[0],
              time: timeStr,
              price: c[4],
              pct: pct
            };
          });

          return {
            symbol: t.symbol,
            name: t.name,
            color: t.color,
            current_price: candles[candles.length - 1]?.price || 0,
            period_change: candles[candles.length - 1]?.pct || 0,
            candles
          };
        } catch (e) {
          console.error(`Error fetching chart for ${t.symbol}:`, e.message);
          return {
            symbol: t.symbol,
            name: t.name,
            color: t.color,
            current_price: 0,
            period_change: 0,
            candles: []
          };
        }
      })
    );

    // Build unified combined timeline for normalized comparison
    // Use timestamps of the first token with candles
    const primaryToken = tokenCharts.find(t => t.candles.length > 0);
    const combined = [];
    if (primaryToken) {
      primaryToken.candles.forEach((c, idx) => {
        const point = { time: c.time, timestamp: c.timestamp };
        tokenCharts.forEach(t => {
          if (t.candles[idx]) {
            point[`${t.symbol}_price`] = t.candles[idx].price;
            point[`${t.symbol}_pct`] = t.candles[idx].pct;
          }
        });
        combined.push(point);
      });
    }

    const payload = {
      timeframe: tf,
      tokens: tokenCharts,
      combined: combined,
      last_updated: now
    };

    solChartsCache[tf] = { data: payload, timestamp: now };
    res.json(payload);
  } catch (error) {
    console.error("Solana Charts Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 8000;
app.listen(PORT, () => {
  console.log(`Node API server running on port ${PORT}`);
});
