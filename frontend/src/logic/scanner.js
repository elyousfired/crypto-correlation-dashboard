import axios from 'axios';

const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

export const calculateEMA = (data, period) => {
  if (data.length < period) return data.map(() => data[0]);
  const k = 2 / (period + 1);
  let ema = data[0];
  const results = [ema];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    results.push(ema);
  }
  return results;
};



export const fetchDepth = async (symbol) => {
  const url = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=200&t=${Date.now()}`;
  
  // Try direct connection first (incredibly fast, supports CORS natively)
  try {
    const res = await axios.get(url, { timeout: 1500 });
    return res.data?.result || res.data || null;
  } catch (err) {
    // Only fall back to proxies on Network/CORS errors
  }

  // Safe fallback to proxies if direct fails
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
      return response.data?.result || response.data || null;
    } catch (e) { }
  }
  return null;
};

export const fetchTrades = async (symbol) => {
  const url = `https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=1000&t=${Date.now()}`;
  
  // Try direct connection first
  try {
    const res = await axios.get(url, { timeout: 1500 });
    return res.data?.result?.list || [];
  } catch (err) {
    // Only fall back to proxies on Network/CORS errors
  }

  // Safe fallback to proxies
  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
      let list = response.data?.result?.list || response.data?.list;
      if (!list && typeof response.data === 'string') {
          try { list = JSON.parse(response.data)?.result?.list; } catch(e) {}
      }
      if (list) return list;
    } catch (e) { }
  }
  return [];
};

export const calculateNebulaLogic = (klines, depth = null, trades = []) => {
  if (!klines || klines.length === 0) return null;
  const klinesChron = [...klines].reverse();
  const processed = [];
  let currentVwapSum = 0, currentVolumeSum = 0, lastDay = -1;

  for (let i = 0; i < klinesChron.length; i++) {
    const [time, open, high, low, close, volume] = klinesChron[i].map(Number);
    const date = new Date(time);
    const day = date.getUTCDay();
    const hlc3 = (high + low + close) / 3;
    
    if (day !== lastDay) { 
      currentVwapSum = 0; 
      currentVolumeSum = 0; 
      lastDay = day; 
    }
    currentVwapSum += hlc3 * volume;
    currentVolumeSum += volume;
    processed.push({ 
      time, open, close, high, low,
      vwapDaily: currentVolumeSum > 0 ? (currentVwapSum / currentVolumeSum) : close, 
      date: date.toISOString().split('T')[0] 
    });
  }

  const closes = processed.map(r => r.close);
  const ema50Values = calculateEMA(closes, 50);
  const ema20Values = calculateEMA(closes, 20);
  processed.forEach((p, i) => { 
    p.ema50 = ema50Values[i]; 
    p.ema20 = ema20Values[i];
  });

  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  let yesterdayMaxVwap = 0, yesterdayMinVwap = Infinity;
  let yesterdayMaxPrice = 0, yesterdayMinPrice = Infinity;
  let hasYesterday = false;

  for (const p of processed) {
    if (p.date === yesterdayStr) {
      yesterdayMaxVwap = Math.max(yesterdayMaxVwap, p.vwapDaily);
      yesterdayMinVwap = Math.min(yesterdayMinVwap, p.vwapDaily);
      yesterdayMaxPrice = Math.max(yesterdayMaxPrice, p.high);
      yesterdayMinPrice = Math.min(yesterdayMinPrice, p.low);
      hasYesterday = true;
    }
  }

  // CALCUL DU PWH (Previous Weekly High)
  const now = new Date();
  const dayOfWeek = now.getUTCDay() === 0 ? 7 : now.getUTCDay(); // 1 = Monday, 7 = Sunday
  const startOfCurrentWeek = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek + 1));
  const startOfPreviousWeek = new Date(startOfCurrentWeek.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endOfPreviousWeek = startOfCurrentWeek.getTime() - 1;

  let pwh = 0;
  for (const p of processed) {
    if (p.time >= startOfPreviousWeek.getTime() && p.time <= endOfPreviousWeek) {
      pwh = Math.max(pwh, p.high);
    }
  }

  const current = processed[processed.length - 1];
  
  // PURE ORDER BOOK & TRADE FLOW ANALYSIS
  let depthAnalysis = { buyPressure: 50, wallStrength: 0, bids: [], asks: [], momentumLabel: 'STABLE' };
  
  if (depth && depth.b && depth.a) {
    const bV = depth.b.reduce((acc, b) => acc + parseFloat(b[1]), 0);
    const sV = depth.a.reduce((acc, a) => acc + parseFloat(a[1]), 0);
    
    // Order Flow from recent trades (Market Orders)
    let tradePressure = 50;
    if (trades.length > 0) {
      const buyVol = trades.filter(t => t.side === 'Buy').reduce((acc, t) => acc + parseFloat(t.size), 0);
      const sellVol = trades.filter(t => t.side === 'Sell').reduce((acc, t) => acc + parseFloat(t.size), 0);
      tradePressure = (buyVol / (buyVol + sellVol || 1)) * 100;
    }

    // Combine Limit Orders (Depth) and Market Orders (Trades)
    const limitPressure = (bV / (bV + sV || 1)) * 100;
    const finalPressure = (limitPressure * 0.6) + (tradePressure * 0.4);

    // LIQUIDITY CLUSTERING (NEBULA LABS METHOD)
    const findClusters = (levels) => {
      if (!levels || levels.length === 0) return [];
      const clusters = [];
      const sorted = [...levels].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      
      let currentCluster = { price: parseFloat(sorted[0][0]), size: parseFloat(sorted[0][1]), count: 1 };
      
      for (let i = 1; i < sorted.length; i++) {
        const p = parseFloat(sorted[i][0]);
        const s = parseFloat(sorted[i][1]);
        // If within 0.5% of current cluster, merge
        if (Math.abs(p - currentCluster.price) / currentCluster.price < 0.005) {
          currentCluster.size += s;
          currentCluster.count++;
          currentCluster.price = (currentCluster.price + p) / 2; // Average price
        } else {
          clusters.push(currentCluster);
          currentCluster = { price: p, size: s, count: 1 };
        }
      }
      clusters.push(currentCluster);
      return clusters.sort((a, b) => b.size - a.size).slice(0, 2);
    };

    const bidClusters = findClusters(depth.b);
    const askClusters = findClusters(depth.a);

    const biggestWall = Math.max(...depth.b.map(b => parseFloat(b[1])), 0);
    const wallRatio = biggestWall / (bV / (depth.b.length || 1) || 1);
    
    let label = 'STABLE';
    if (finalPressure > 75) label = 'PARABOLIC BUYING';
    else if (finalPressure > 60) label = 'INSTITUTIONAL ACCUMULATION';
    else if (finalPressure < 40) label = 'HEAVY DISTRIBUTION';

    depthAnalysis = { 
      buyPressure: finalPressure, 
      wallStrength: wallRatio, 
      bids: depth.b.slice(0, 6), 
      asks: depth.a.slice(0, 6),
      bidClusters,
      askClusters,
      momentumLabel: label
    };
  }

  const startTime = Date.now() - (86400000 * 2);

  // Détection du Liquidity Sweep
  const isSweepHigh = current.high > yesterdayMaxPrice && current.close < yesterdayMaxPrice;
  const isSweepLow = yesterdayMinPrice > 0 && current.low < yesterdayMinPrice && current.close > yesterdayMinPrice;

  return {
    vwapDaily: current.vwapDaily,
    yesterdayMax: yesterdayMaxVwap,
    yesterdayMin: hasYesterday ? yesterdayMinVwap : 0,
    yesterdayMaxPrice: yesterdayMaxPrice,
    yesterdayMinPrice: hasYesterday ? yesterdayMinPrice : 0,
    pwh: pwh,
    isSweepHigh,
    isSweepLow,
    depthAnalysis,
    trajectory: processed.filter(p => p.time >= startTime).map(p => ({
      time: p.time,
      open: p.open,
      price: p.close,
      high: p.high,
      low: p.low,
      vwap: p.vwapDaily,
      ema: p.ema50,
      ema20: p.ema20,
      gap: yesterdayMaxVwap > 0 ? ((p.close / yesterdayMaxVwap - 1) * 100) : 0
    })),
    ema20Bullish: current.close > current.ema20
  };
};

export const fetchDailyMacro = async (symbol) => {
  const klines = await fetchBybitData(symbol, 'D', 365); // 365 days history
  if (!klines || klines.length === 0) return null;
  
  const now = new Date();
  const startOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).getTime();
  const endOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)).getTime();
  
  let pmh = 0;
  for (const k of klines) {
    const time = Number(k[0]);
    const high = parseFloat(k[2]);
    if (time >= startOfPrevMonth && time <= endOfPrevMonth) {
      pmh = Math.max(pmh, high);
    }
  }

  // --- Parabolic Recovery (Cup & Handle) Logic ---
  let cupPattern = null;
  const currentPrice = parseFloat(klines[0][4]);

  // On cherche l'ancien sommet (la lèvre gauche du bol) jusqu'à un an en arrière (la limite des klines)
  for (let i = klines.length - 1; i >= 15; i--) {
    const potentialHigh = parseFloat(klines[i][2]);
    
    // On s'assure que ce point est le sommet le PLUS HAUT depuis le début de la cassure
    // Cela garantit que c'est un vrai "sommet local" et non un point au hasard dans une chute.
    let isHighest = true;
    for (let j = 5; j <= i; j++) {
      if (parseFloat(klines[j][2]) > potentialHigh) {
        isHighest = false;
        break;
      }
    }
    
    if (!isHighest) continue;

    // Trouver le point le plus bas (le fond du bol) entre ce sommet et aujourd'hui
    let cupBottom = Infinity;
    let cupBottomIndex = -1;
    for (let j = 1; j < i; j++) {
      const low = parseFloat(klines[j][3]);
      if (low < cupBottom) {
        cupBottom = low;
        cupBottomIndex = j;
      }
    }

    const dropPercent = ((cupBottom / potentialHigh) - 1) * 100;
    const distanceToHigh = ((currentPrice / potentialHigh) - 1) * 100;
    
    // 1. Chute d'au moins 15% (permet d'inclure les petites paraboles comme RLUSD)
    // 2. Le fond doit dater d'au moins 5 jours
    // 3. Proche du sommet: entre -15% et +10%
    if (dropPercent <= -15 && cupBottomIndex >= 5 && distanceToHigh >= -15 && distanceToHigh <= 10) {
      
      const formattedKlines = [...klines].reverse().map(k => ({
         time: Math.floor(Number(k[0]) / 1000),
         open: parseFloat(k[1]),
         high: parseFloat(k[2]),
         low: parseFloat(k[3]),
         close: parseFloat(k[4])
      }));

      // --- CALCUL MATHÉMATIQUE DE LA COURBE PARABOLIQUE ---
      const idx1 = klines.length - 1 - i; // Point 1: Ancien Sommet
      const idx2 = klines.length - 1 - cupBottomIndex; // Point 2: Le fond du bol
      const idx3 = klines.length - 1; // Point 3: Aujourd'hui

      const x2 = idx2 - idx1;
      const x3 = idx3 - idx1;
      const y1 = potentialHigh;
      const y2 = cupBottom;
      const y3 = currentPrice;

      // Résolution du système y = Ax² + Bx + C
      const A = ((y3 - y1) - (x3 / x2) * (y2 - y1)) / (x3 * (x3 - x2));
      const B = (y2 - y1 - (x2 * x2) * A) / x2;
      const C = y1;

      const parabolaCurve = [];
      for (let idx = idx1; idx <= idx3; idx++) {
        const x = idx - idx1;
        const y = A * x * x + B * x + C;
        parabolaCurve.push({
          time: formattedKlines[idx].time,
          value: y
        });
      }

      cupPattern = {
        type: distanceToHigh < 0 ? 'PRE-BREAKOUT' : 'EARLY BREAKOUT',
        oldHigh: potentialHigh,
        cupBottom,
        currentPrice,
        dropPercent,
        breakoutPercent: distanceToHigh,
        daysSinceHigh: i,
        daysSinceBottom: cupBottomIndex,
        klines: formattedKlines,
        parabolaCurve
      };

      // On a trouvé le bol le plus macro (le plus large valide), on arrête la recherche.
      break; 
    }
  }

  return { pmh, cupPattern, klines };
};

export const fetchBybitData = async (symbol, interval = '240', limit = 100, end = null) => {
  let url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`;
  if (end) url += `&end=${end}`;
  url += `&_t=${Date.now()}`;
  
  let data = [];

  try {
    const response = await axios.get(url, { timeout: 10000 });
    data = response.data?.result?.list || response.data?.list || [];
  } catch (e) { }

  if (!data || data.length === 0) {
    const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    try {
      const response = await axios.get(allOriginsUrl, { timeout: 3000 });
      data = response.data?.result?.list || response.data?.list || [];
    } catch (e) { }
  }

  if (!data || data.length === 0) {
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
        let pData = response.data?.result?.list || response.data?.list;
        if (!pData && typeof response.data === 'string') {
            try { pData = JSON.parse(response.data)?.result?.list; } catch(err) {}
        }
        if (pData && pData.length > 0) {
           data = pData;
           break;
        }
      } catch (e) { }
    }
  }

  // BINANCE FALLBACK
  if (!data || data.length === 0) {
     const binanceIntervals = {
        '1': '1m', '3': '3m', '5': '5m', '15': '15m', '30': '30m',
        '60': '1h', '120': '2h', '240': '4h', '360': '6h', '720': '12h',
        'D': '1d', 'M': '1M', 'W': '1w'
     };
     const bInterval = binanceIntervals[interval] || '4h';
     const bUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${bInterval}&limit=${limit}`;
      try {
        const bRes = await axios.get(bUrl, { timeout: 5000 });
        if (bRes.data && Array.isArray(bRes.data) && bRes.data.length > 0) {
            // Binance returns [time, open, high, low, close, volume, closeTime, quoteAssetVolume]
            // Bybit expects [time, open, high, low, close, volume, turnover]
            data = bRes.data.map(k => [
              k[0].toString(),
              k[1],
              k[2],
              k[3],
              k[4],
              k[5],
              k[7]
            ]).reverse();
        }
     } catch(e) {}
  }

  return data || [];
};

export const fetchBinanceData = async (symbol, interval = '240', limit = 100) => {
  const map = {
    '15': '15m',
    '60': '1h',
    '240': '4h',
    'D': '1d'
  };
  const binanceInterval = map[interval] || '4h';
  let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
  
  let data = [];
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (Array.isArray(response.data)) {
        data = response.data;
    }
  } catch (e) {}

  if (!data || data.length === 0) {
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
        let pData = response.data;
        if (!pData && typeof response.data === 'string') {
            try { pData = JSON.parse(response.data); } catch(err) {}
        }
        if (pData && Array.isArray(pData) && pData.length > 0) {
           data = pData;
           break;
        }
      } catch (e) { }
    }
  }

  if (data && data.length > 0) {
      // Binance returns chronological (oldest first). Bybit returns newest first.
      // Format: [time, open, high, low, close, volume, closeTime, quoteAssetVolume]
      return data.map(k => [
        k[0].toString(),
        k[1],
        k[2],
        k[3],
        k[4],
        k[5],
        k[7]
      ]).reverse();
  }

  return [];
};


export const fetchOrderBook = async (symbol, limit = 50) => {
  try {
    const response = await fetch(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${symbol}&limit=${limit}`);
    const data = await response.json();
    if (data.retCode === 0) {
      return data.result;
    }
    return null;
  } catch (error) {
    console.error("Error fetching order book:", error);
    return null;
  }
};

export const fetchMaxHistory = async (symbol, interval = '240', limit = 1000) => {
  // Just fetch 1000 candles to avoid proxy rate limits. 1000 is plenty for OB calculations.
  const data = await fetchBybitData(symbol, interval, limit, null);
  return data || [];
};

let CACHED_GLOBAL_BYBIT_SYMBOLS = [];

export const fetchTop500Symbols = async (includeBinance = false, maxLimit = 500) => {
  const url = 'https://api.bybit.com/v5/market/tickers?category=spot';
  let bybitList = [];
  
  // Try direct connection first with solid 6s timeout
  try {
    const response = await axios.get(url, { timeout: 6000 });
    const list = response.data?.result?.list || response.data?.list;
    if (list && list.length > 50) {
      bybitList = filterTickers(list, 1000).map(t => ({ ...t, exchange: 'bybit' }));
      CACHED_GLOBAL_BYBIT_SYMBOLS = bybitList;
    }
  } catch (e) { }

  if (bybitList.length === 0 && CACHED_GLOBAL_BYBIT_SYMBOLS.length > 0) {
    bybitList = CACHED_GLOBAL_BYBIT_SYMBOLS;
  }

  if (bybitList.length === 0) {
    // Safe fallback to proxies
    for (let i = 0; i < PROXIES.length; i++) {
      try {
        const response = await axios.get(PROXIES[i](url), { timeout: 5000 });
        let list = response.data?.result?.list || response.data?.list;
        if (!list && typeof response.data === 'string') {
            try { list = JSON.parse(response.data)?.result?.list; } catch(e) {}
        }
        if (list) {
          bybitList = filterTickers(list, 1000).map(t => ({ ...t, exchange: 'bybit' }));
          break;
        }
      } catch (e) { }
    }
  }

  if (!includeBinance) return bybitList.slice(0, maxLimit);

  // Fetch Binance if requested
  try {
    const binanceUrl = 'https://api.binance.com/api/v3/ticker/24hr';
    const res = await axios.get(binanceUrl, { timeout: 3000 });
    if (Array.isArray(res.data)) {
      const blackList = ['USD', 'DAI', 'EUR', 'GBP', 'TRY', 'BUSD', 'USDC', 'USDE'];
      const binanceList = res.data
        .filter(t => t.symbol.endsWith('USDT'))
        .filter(t => parseFloat(t.bidPrice) > 0 || parseFloat(t.askPrice) > 0)
        .filter(t => !blackList.some(ex => t.symbol.startsWith(ex)))
        .map(t => ({
          symbol: t.symbol,
          priceChangePercent: parseFloat(t.priceChangePercent),
          lastPrice: parseFloat(t.lastPrice),
          turnover24h: parseFloat(t.quoteVolume),
          exchange: 'binance'
        }));
      
      const bybitTop = bybitList.slice(0, 500);
      const binanceTop = binanceList.sort((a, b) => b.turnover24h - a.turnover24h).slice(0, 500);
      
      const bybitSet = new Set(bybitTop.map(t => t.symbol));
      const filteredBinance = binanceTop.filter(t => !bybitSet.has(t.symbol));
      
      return [...bybitTop, ...filteredBinance];
    }
  } catch (e) {
    console.error("Binance fetch error:", e);
  }

  return bybitList.slice(0, 500);
};

// Helper for filtering & formatting tickers
const filterTickers = (list, limit = 500) => {
  const blackList = ['USD', 'DAI', 'EUR', 'GBP', 'TRY', 'BUSD', 'USDC', 'USDE'];
  return list
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !blackList.some(ex => t.symbol.startsWith(ex)))
    .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, limit).map(t => ({
      symbol: t.symbol,
      priceChangePercent: t.price24hPcnt * 100,
      lastPrice: t.lastPrice,
      turnover24h: t.turnover24h
    }));
};

export const fetchOpenInterest = async (symbol, interval = '15') => {
  const map = {
    '15': '15min',
    '60': '1h',
    '240': '4h',
    'D': '1d',
    'W': '1d'
  };
  const intervalTime = map[interval] || '15min';
  
  const url = `https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=${intervalTime}&limit=200&t=${Date.now()}`;
  
  // Try direct connection first
  try {
    const response = await axios.get(url, { timeout: 1500 });
    const data = response.data?.result?.list || response.data?.list;
    if (data && data.length > 0) return data;
  } catch (e) { }

  // Fallback to Binance if not on Bybit
  const bMap = {
    '15': '15m',
    '60': '1h',
    '240': '4h',
    'D': '1d',
    'W': '1d'
  };
  const bInterval = bMap[interval] || '15m';
  const bUrl = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=${bInterval}&limit=200`;
  try {
    const bRes = await axios.get(bUrl, { timeout: 1500 });
    if (bRes.data && Array.isArray(bRes.data) && bRes.data.length > 0) {
      return bRes.data.map(item => ({
        symbol: item.symbol,
        openInterest: item.sumOpenInterest,
        timestamp: String(item.timestamp)
      })).reverse();
    }
  } catch (e) {}

  // Fallback to proxies for Bybit
  const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  try {
    const response = await axios.get(allOriginsUrl, { timeout: 3000 });
    const data = response.data?.result?.list || response.data?.list;
    if (data && data.length > 0) return data;
  } catch (e) { }

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
      let data = response.data?.result?.list || response.data?.list;
      if (!data && typeof response.data === 'string') {
          try { data = JSON.parse(response.data)?.result?.list; } catch(err) {}
      }
      if (data && data.length > 0) return data;
    } catch (e) { }
  }
  return null;
};

// Alias for backward compatibility with other components
export const fetchTop200Symbols = fetchTop500Symbols;

export const calculateVolumeProfile = (klines) => {
  if (!klines || klines.length === 0) return null;
  const candlesChron = [...klines].reverse().map(c => ({
    time: Number(c[0]),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
    volume: Number(c[5])
  }));

  const now = new Date();
  const startOfTodayTs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const startOfPrevDayTs = startOfTodayTs - 24 * 60 * 60 * 1000;

  let todayCandles = candlesChron.filter(c => c.time >= startOfPrevDayTs && c.time < startOfTodayTs);
  if (todayCandles.length < 12) {
    todayCandles = candlesChron.filter(c => c.time < startOfTodayTs).slice(-96);
  }
  
  if (todayCandles.length === 0) return null;

  const highs = todayCandles.map(c => c.high);
  const lows = todayCandles.map(c => c.low);
  const dayHigh = Math.max(...highs);
  const dayLow = Math.min(...lows);
  const currentPrice = candlesChron[candlesChron.length - 1].close;

  const binsCount = 30;
  const binSize = (dayHigh - dayLow) / binsCount;
  const bins = Array.from({ length: binsCount }, (_, idx) => ({
    idx,
    low: dayLow + idx * binSize,
    high: dayLow + idx * binSize + binSize,
    volume: 0
  }));

  todayCandles.forEach(c => {
    const { high, low, volume } = c;
    if (high === low) {
      const binIdx = Math.min(Math.floor((high - dayLow) / binSize), binsCount - 1);
      if (binIdx >= 0 && binIdx < binsCount) bins[binIdx].volume += volume;
    } else {
      const overlapping = bins.filter(b => high >= b.low && low <= b.high);
      if (overlapping.length > 0) {
        const volPerBin = volume / overlapping.length;
        overlapping.forEach(b => { b.volume += volPerBin; });
      }
    }
  });

  let maxVol = 0;
  let pocPrice = (dayHigh + dayLow) / 2;
  let pocBinIdx = 0;
  bins.forEach((b, idx) => {
    if (b.volume > maxVol) {
      maxVol = b.volume;
      pocPrice = (b.low + b.high) / 2;
      pocBinIdx = idx;
    }
  });

  const dayVolume = todayCandles.reduce((acc, c) => acc + c.volume, 0);
  const targetVaVol = dayVolume * 0.70;
  let vaMinIdx = pocBinIdx;
  let vaMaxIdx = pocBinIdx;
  let currentVaVol = bins[pocBinIdx]?.volume || 0;

  while (currentVaVol < targetVaVol && (vaMinIdx > 0 || vaMaxIdx < binsCount - 1)) {
    let prevVol = 0;
    if (vaMinIdx > 0) prevVol = bins[vaMinIdx - 1].volume + (bins[vaMinIdx - 2]?.volume || 0);
    let nextVol = 0;
    if (vaMaxIdx < binsCount - 1) nextVol = bins[vaMaxIdx + 1].volume + (bins[vaMaxIdx + 2]?.volume || 0);

    if (vaMinIdx > 0 && (vaMaxIdx === binsCount - 1 || prevVol >= nextVol)) {
      currentVaVol += bins[vaMinIdx - 1].volume;
      vaMinIdx--;
    } else if (vaMaxIdx < binsCount - 1) {
      currentVaVol += bins[vaMaxIdx + 1].volume;
      vaMaxIdx++;
    } else {
      break;
    }
  }

  const vah = bins[vaMaxIdx]?.high || dayHigh;
  const val = bins[vaMinIdx]?.low || dayLow;

  const distancePoc = ((currentPrice - pocPrice) / pocPrice) * 100;
  const distanceVah = ((currentPrice - vah) / vah) * 100;
  const distanceVal = ((currentPrice - val) / val) * 100;

  const dayOpen = todayCandles[0].open;
  const dayClose = todayCandles[todayCandles.length - 1].close;

  return {
    bins,
    dayHigh,
    dayLow,
    dayOpen,
    dayClose,
    dayVolume,
    pocPrice,
    vah,
    val,
    maxVol,
    todayCandles,
    allCandles: candlesChron,
    usingFallback: todayCandles.length < 12,
    startOfDayTs: (todayCandles.length < 12) ? todayCandles[0].time : startOfPrevDayTs,
    currentPrice,
    distancePoc,
    distanceVah,
    distanceVal
  };
};

export const calculateRollingStrength = (tokenKlines, baseKlines) => {
  if (!tokenKlines || !baseKlines || tokenKlines.length < 48 || baseKlines.length < 48) return null;
  const results = [];
  for (let i = 0; i < 24; i++) {
    const tokenNow = parseFloat(tokenKlines[i][4]);
    const tokenPast = parseFloat(tokenKlines[i + 24][4]);
    let baseNow = 1;
    let basePast = 1;
    if (baseKlines) {
        baseNow = parseFloat(baseKlines[i][4]);
        basePast = parseFloat(baseKlines[i + 24][4]);
    }
    const syntheticNow = tokenNow / baseNow;
    const syntheticPast = tokenPast / basePast;
    const strength = ((syntheticNow / syntheticPast) - 1) * 100;
    results.push({
      time: parseInt(tokenKlines[i][0], 10),
      strength: strength
    });
  }
  return results.reverse();
};
