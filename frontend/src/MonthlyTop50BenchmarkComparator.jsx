import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import { fetchTop500Symbols } from './logic/scanner';
import tokenEntries from './data/token_entries.json';
import { 
  Crown, Search, RefreshCw, TrendingUp, RotateCcw, Activity, 
  ArrowUpRight, LayoutGrid, CheckCircle2, AlertTriangle, Layers, Zap, Flame,
  Bell, Volume2, VolumeX, Trash2, Download, ExternalLink, X, ShieldAlert, Rocket, Check, Sparkles, BarChart2,
  Maximize2, Minimize2, Target
} from 'lucide-react';
import { getDeFiLlamaMetricsForSymbols, formatCurrencyUSD } from './logic/defillamaService';
import { getTokenIntelligence } from './logic/tokenIntelligence';

const STORAGE_KEY_LAUNCHPAD_SIGNALS = 'nebula_launchpad_signals_history_v1';
const STORAGE_KEY_ALERT_SOUND = 'nebula_launchpad_sound_enabled';

// 🔊 Synthétiseur Web Audio API pour Bip d'alerte Cyber (aucun fichier externe requis)
function playLaunchpadAlertSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    
    // Double impulsion mélodique montante (D5 -> A5 -> D6)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880.0, now + 0.12); // A5
    osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.24); // D6

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(293.66, now); // D4
    osc2.frequency.exponentialRampToValueAtTime(587.33, now + 0.24);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.6);
    osc2.stop(now + 0.6);
  } catch (_) {}
}

const KLINE_PERSISTENT_CACHE = new Map();

async function fetchBybitKlines(symbol, interval = '15', limit = 1000) {
  const cleanBase = symbol.replace('USDT', '').toUpperCase();
  const formattedSymbol = `${cleanBase}USDT`;
  const cacheKey = `${formattedSymbol}_${interval}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${formattedSymbol}&interval=${interval}&limit=${limit}`, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (json.result?.list && json.result.list.length >= 3) {
          const rawList = json.result.list.slice().reverse();
          KLINE_PERSISTENT_CACHE.set(cacheKey, rawList);
          return rawList;
        }
      }
    } catch (_) {}
  }

  if (KLINE_PERSISTENT_CACHE.has(cacheKey)) {
    return KLINE_PERSISTENT_CACHE.get(cacheKey);
  }

  return [];
}

const PALETTE = [
  '#38bdf8', '#00ff88', '#facc15', '#f43f5e', '#a855f7', 
  '#fb923c', '#e879f9', '#22d3ee', '#a3e635', '#fdba74',
  '#ec4899', '#818cf8', '#34d399', '#f472b6', '#3b82f6',
  '#10b981', '#6366f1', '#e11d48', '#84cc16', '#d946ef',
  '#14b8a6', '#f59e0b', '#06b6d4', '#8b5cf6', '#00e5ff'
];

export function formatVolumeUSDT(val) {
  if (!val || isNaN(val) || val <= 0) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export function formatCompactUSD(val) {
  if (!val || isNaN(val) || val <= 0) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}k`;
  return `$${Math.round(val)}`;
}

export function getTokenFixedColor(symbol) {
  if (!symbol) return '#38bdf8';
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % PALETTE.length;
  return PALETTE[idx];
}

// 🏷️ Libellé Chiffré Vol/MC (CoinGecko) & Dominance Buy/Sell (15m 24h) pour l'étiquette de charte
export function getTokenVolMcapAndDominanceTag(item, dailyCgData = {}, dailyMarketCaps = {}) {
  if (!item) return '';
  const sym = (item.cleanSymbol || item.symbol || '').toUpperCase();
  if (!sym) return '';

  const cg = dailyCgData?.[sym];
  const vol24h = (cg?.volume && cg.volume > 0)
    ? cg.volume
    : (item.cgVolume || item.turnover24h || 0);

  const mcap = (cg?.marketCap && cg.marketCap > 0)
    ? cg.marketCap
    : (item.marketCap || dailyMarketCaps?.[sym] || 0);

  const ratio = (item.volMcapRatio && item.volMcapRatio > 0)
    ? item.volMcapRatio
    : (mcap > 0 && vol24h > 0 ? parseFloat(((vol24h / mcap) * 100).toFixed(1)) : 0);

  // Décomposition Acheteurs vs Vendeurs (15m 24h)
  let buyPct = typeof item.buyPct === 'number' ? item.buyPct : (typeof item.buyPct24h === 'number' ? item.buyPct24h : null);
  let sellPct = typeof item.sellPct === 'number' ? item.sellPct : (typeof item.sellPct24h === 'number' ? item.sellPct24h : null);

  if ((buyPct === null || sellPct === null) && item.rawKlines && item.rawKlines.length > 0) {
    const klines24h = item.rawKlines.slice(-96);
    let bVol = 0;
    let sVol = 0;
    let tVol = 0;
    klines24h.forEach(k => {
      const h = parseFloat(k[2]);
      const l = parseFloat(k[3]);
      const c = parseFloat(k[4]);
      const t = parseFloat(k[6] || 0);
      if (h > l && t > 0) {
        const bRatio = (c - l) / (h - l);
        bVol += t * bRatio;
        sVol += t * (1 - bRatio);
        tVol += t;
      } else if (t > 0) {
        bVol += t * 0.5;
        sVol += t * 0.5;
        tVol += t;
      }
    });
    if (tVol > 0) {
      buyPct = parseFloat(((bVol / tVol) * 100).toFixed(0));
      sellPct = parseFloat((100 - buyPct).toFixed(0));
    }
  }

  const parts = [];
  if (ratio > 0) {
    parts.push(ratio >= 100 ? `${ratio.toFixed(0)}%` : `${ratio.toFixed(1)}%`);
  }

  if (buyPct !== null && sellPct !== null) {
    if (buyPct >= 50) {
      parts.push(`🟢 +${Math.round(buyPct)}% BUY`);
    } else {
      parts.push(`🔴 ${Math.round(sellPct)}% SELL`);
    }
  }

  if (parts.length === 0) return '';
  return ` [${parts.join(' • ')}]`;
}


export function analyzeChartPatternDynamic(prices = []) {
  if (!prices || prices.length < 20) {
    return {
      key: 'ASC_TRIANGLE',
      name: 'Ascending Triangle',
      icon: '📐',
      confidence: 70,
      color: '#facc15',
      type: 'asc_triangle'
    };
  }

  const N = prices.length;
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  // Normalisation des indices et prix (0 à 100)
  const norm = prices.map(p => ((p - minP) / range) * 100);

  // 1. Détection des extremums locaux (Swing Highs et Swing Lows réels)
  const highs = [];
  const lows = [];
  const w = Math.max(2, Math.floor(N / 20));

  for (let i = w; i < N - w; i++) {
    let isHigh = true;
    let isLow = true;
    for (let k = i - w; k <= i + w; k++) {
      if (k === i) continue;
      if (norm[k] > norm[i]) isHigh = false;
      if (norm[k] < norm[i]) isLow = false;
    }
    if (isHigh) highs.push({ idx: i, val: norm[i], price: prices[i] });
    if (isLow) lows.push({ idx: i, val: norm[i], price: prices[i] });
  }

  const pStart = norm[0];
  const pEnd = norm[N - 1];
  const pMin = Math.min(...norm);
  const pMinIdx = norm.indexOf(pMin);
  const pMax = Math.max(...norm);
  const pMaxIdx = norm.indexOf(pMax);

  // 2. Évaluation des scores pour chaque pattern
  // A. ☕ Cup & Handle
  let cupScore = 0;
  let cupData = null;
  if (highs.length >= 2 && pMinIdx > 0 && pMinIdx < N - 1) {
    const leftHighs = highs.filter(h => h.idx < pMinIdx);
    const rightHighs = highs.filter(h => h.idx > pMinIdx);
    if (leftHighs.length > 0 && rightHighs.length > 0) {
      const lH = leftHighs[leftHighs.length - 1];
      const rH = rightHighs[0];
      const depth = Math.min(lH.val, rH.val) - pMin;
      const rimDiff = Math.abs(lH.val - rH.val);
      if (depth > 20 && rimDiff < 25 && pEnd >= pMin + depth * 0.4) {
        cupScore = Math.floor(75 + (1 - rimDiff / 30) * 20);
        cupData = { lH, bottom: { idx: pMinIdx, val: pMin }, rH, end: { idx: N - 1, val: pEnd } };
      }
    }
  }

  // B. 🆆 Double Bottom (W)
  let wScore = 0;
  let wData = null;
  if (lows.length >= 2) {
    for (let i = 0; i < lows.length - 1; i++) {
      const l1 = lows[i];
      const l2 = lows[i + 1];
      const midHighs = highs.filter(h => h.idx > l1.idx && h.idx < l2.idx);
      if (midHighs.length > 0) {
        const midH = midHighs.reduce((m, h) => h.val > m.val ? h : m, midHighs[0]);
        const lowDiff = Math.abs(l1.val - l2.val);
        const peakHeight = midH.val - Math.min(l1.val, l2.val);
        if (lowDiff < 18 && peakHeight > 18 && (l2.idx - l1.idx) >= Math.floor(N * 0.15)) {
          const score = Math.floor(78 + (1 - lowDiff / 20) * 18);
          if (score > wScore) {
            wScore = score;
            wData = { l1, midH, l2, end: { idx: N - 1, val: pEnd } };
          }
        }
      }
    }
  }

  // C. 📐 Ascending Triangle
  let ascScore = 0;
  let ascData = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const sortedHighs = highs.slice(-3);
    const sortedLows = lows.slice(-3);
    const highVals = sortedHighs.map(h => h.val);
    const maxHDiff = Math.max(...highVals) - Math.min(...highVals);
    const isAscendingLows = sortedLows[sortedLows.length - 1].val > sortedLows[0].val + 6;
    if (maxHDiff < 16 && isAscendingLows) {
      ascScore = 85;
      ascData = {
        resVal: Math.max(...highVals),
        l1: sortedLows[0],
        l2: sortedLows[sortedLows.length - 1],
        highs: sortedHighs
      };
    }
  }

  // D. 🚩 Bull Flag
  let flagScore = 0;
  let flagData = null;
  if (pMaxIdx < N * 0.55 && (pMax - pStart) > 30) {
    const afterPeak = norm.slice(pMaxIdx);
    const flagMin = Math.min(...afterPeak);
    if (pEnd > pStart + 15 && (pMax - flagMin) < (pMax - pStart) * 0.6) {
      flagScore = 82;
      flagData = {
        poleStart: { idx: 0, val: pStart },
        polePeak: { idx: pMaxIdx, val: pMax },
        flagLow: { idx: pMaxIdx + afterPeak.indexOf(flagMin), val: flagMin },
        end: { idx: N - 1, val: pEnd }
      };
    }
  }

  // E. 🔻 Falling Wedge
  let wedgeScore = 0;
  let wedgeData = null;
  if (highs.length >= 2 && lows.length >= 2) {
    const h1 = highs[0];
    const h2 = highs[highs.length - 1];
    const l1 = lows[0];
    const l2 = lows[lows.length - 1];
    if (h2.val < h1.val - 8 && l2.val < l1.val - 5 && (h1.val - l1.val) > (h2.val - l2.val) + 5) {
      wedgeScore = 80;
      wedgeData = { h1, h2, l1, l2, end: { idx: N - 1, val: pEnd } };
    }
  }

  // 3. Sélection du pattern gagnant avec le score le plus élevé
  const candidates = [
    { key: 'CUP_HANDLE', name: 'Cup & Handle', icon: '☕', score: cupScore, color: '#38bdf8', data: cupData },
    { key: 'DOUBLE_BOTTOM', name: 'Double Bottom (W)', icon: '🆆', score: wScore, color: '#00ff88', data: wData },
    { key: 'ASC_TRIANGLE', name: 'Ascending Triangle', icon: '📐', score: ascScore, color: '#facc15', data: ascData },
    { key: 'BULL_FLAG', name: 'Bull Flag', icon: '🚩', score: flagScore, color: '#ec4899', data: flagData },
    { key: 'FALLING_WEDGE', name: 'Falling Wedge', icon: '🔻', score: wedgeScore, color: '#a855f7', data: wedgeData },
  ];

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0].score > 0 ? candidates[0] : null;

  if (best) {
    return {
      key: best.key,
      name: best.name,
      icon: best.icon,
      confidence: best.score,
      color: best.color,
      data: best.data,
      norm,
      minP,
      maxP,
      range
    };
  }

  // Fallback dynamique
  if (pEnd > pStart + 10) {
    return {
      key: 'ASC_TRIANGLE',
      name: 'Ascending Triangle',
      icon: '📐',
      confidence: 74,
      color: '#facc15',
      data: {
        resVal: pMax,
        l1: { idx: 0, val: pStart },
        l2: { idx: Math.floor(N * 0.7), val: Math.min(...norm.slice(Math.floor(N * 0.4))) },
      },
      norm, minP, maxP, range
    };
  }

  return {
    key: 'DOUBLE_BOTTOM',
    name: 'Double Bottom (W)',
    icon: '🆆',
    confidence: 72,
    color: '#00ff88',
    data: {
      l1: { idx: Math.floor(N * 0.25), val: Math.min(...norm.slice(0, Math.floor(N * 0.5))) },
      midH: { idx: Math.floor(N * 0.5), val: Math.max(...norm.slice(Math.floor(N * 0.25), Math.floor(N * 0.75))) },
      l2: { idx: Math.floor(N * 0.75), val: Math.min(...norm.slice(Math.floor(N * 0.5))) },
      end: { idx: N - 1, val: pEnd }
    },
    norm, minP, maxP, range
  };
}

// Composant Carte de Structure avec Tracé Vectoriel SVG 100% Ajusté aux Points Réels
function TokenPatternMiniCard({ token, onSelect, isSelected }) {
  const klines = token.rawKlines || [];
  const sample = klines.slice(Math.max(0, klines.length - 80));
  const prices = sample.map(k => parseFloat(k[4]));

  const pattern = useMemo(() => analyzeChartPatternDynamic(prices), [prices]);
  const minP = pattern.minP || Math.min(...prices);
  const maxP = pattern.maxP || Math.max(...prices);
  const range = pattern.range || (maxP - minP || 1);

  // Dimensions SVG
  const W = 260;
  const H = 90;
  const padX = 12;
  const padY = 12;

  // Convertisseur d'indices et valeurs en coordonnées pixel SVG réelles
  const toSvgX = (idx) => padX + (idx / (prices.length - 1 || 1)) * (W - padX * 2);
  const toSvgY = (valNorm) => H - padY - (valNorm / 100) * (H - padY * 2);

  const points = prices.map((p, idx) => {
    const x = toSvgX(idx);
    const y = H - padY - ((p - minP) / range) * (H - padY * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const fixedColor = getTokenFixedColor(token.cleanSymbol);
  const d = pattern.data || {};

  return (
    <div
      onClick={onSelect}
      style={{
        background: isSelected ? 'rgba(6, 182, 212, 0.12)' : '#0a1519',
        border: isSelected ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '10px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: 'none',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ background: 'rgba(255,255,255,0.06)', color: '#facc15', padding: '3px 7px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: '900' }}>
            #{token.rankMonth}
          </span>
          <span style={{ fontSize: '1.05rem', fontWeight: '900', color: '#fff' }}>
            {token.cleanSymbol}
          </span>
          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
            ${token.price}
          </span>
        </div>

        <span style={{
          background: `${pattern.color}22`,
          color: pattern.color,
          border: `1px solid ${pattern.color}88`,
          padding: '3px 8px',
          borderRadius: '6px',
          fontSize: '0.68rem',
          fontWeight: '900',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          {pattern.icon} {pattern.name} ({pattern.confidence}%)
        </span>
      </div>

      {/* Graphique SVG avec Tracé Géométrique Dynamique Réel */}
      <div style={{ width: '100%', height: '90px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', position: 'relative' }}>
        <svg width="100%" height="90" viewBox="0 0 260 90" style={{ overflow: 'visible' }}>
          {/* Grille */}
          <line x1="10" y1="20" x2="250" y2="20" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1="10" y1="45" x2="250" y2="45" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />
          <line x1="10" y1="70" x2="250" y2="70" stroke="rgba(255,255,255,0.05)" strokeDasharray="3,3" />

          {/* Courbe de prix réelle du token */}
          <polyline
            fill="none"
            stroke={fixedColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          {/* 🎯 1. TRACÉ GÉOMÉTRIQUE RÉEL POUR DOUBLE BOTTOM (W) */}
          {pattern.key === 'DOUBLE_BOTTOM' && d.l1 && d.l2 && d.midH && (
            <g>
              {/* Ligne de cou horizontale au sommet réel */}
              <line
                x1={toSvgX(d.l1.idx) - 10}
                y1={toSvgY(d.midH.val)}
                x2={toSvgX(d.end?.idx || prices.length - 1) + 10}
                y2={toSvgY(d.midH.val)}
                stroke="#facc15"
                strokeWidth="1.6"
                strokeDasharray="4,4"
              />
              {/* Tracé W passant EXACTEMENT par les points réels du token */}
              <polyline
                fill="none"
                stroke="#00ff88"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={`${toSvgX(d.l1.idx - Math.floor(prices.length * 0.1 || 2))},${toSvgY(d.midH.val)} ${toSvgX(d.l1.idx)},${toSvgY(d.l1.val)} ${toSvgX(d.midH.idx)},${toSvgY(d.midH.val)} ${toSvgX(d.l2.idx)},${toSvgY(d.l2.val)} ${toSvgX(d.end?.idx || prices.length - 1)},${toSvgY(d.end?.val || d.midH.val)}`}
              />
              <circle cx={toSvgX(d.l1.idx)} cy={toSvgY(d.l1.val)} r="3.5" fill="#00ff88" />
              <circle cx={toSvgX(d.midH.idx)} cy={toSvgY(d.midH.val)} r="3.5" fill="#facc15" />
              <circle cx={toSvgX(d.l2.idx)} cy={toSvgY(d.l2.val)} r="3.5" fill="#00ff88" />
              <circle cx={toSvgX(d.end?.idx || prices.length - 1)} cy={toSvgY(d.end?.val || d.midH.val)} r="4" fill="#facc15" />
            </g>
          )}

          {/* 🎯 2. TRACÉ GÉOMÉTRIQUE RÉEL POUR CUP & HANDLE */}
          {pattern.key === 'CUP_HANDLE' && d.lH && d.rH && d.bottom && (
            <g>
              {/* Ligne de cou horizontale réelle */}
              <line
                x1={toSvgX(d.lH.idx)}
                y1={toSvgY(Math.max(d.lH.val, d.rH.val))}
                x2={toSvgX(prices.length - 1) + 5}
                y2={toSvgY(Math.max(d.lH.val, d.rH.val))}
                stroke="#facc15"
                strokeWidth="1.8"
                strokeDasharray="4,4"
              />
              {/* Arc Bezier du Cup passant par les extremums réels */}
              <path
                d={`M ${toSvgX(d.lH.idx)} ${toSvgY(d.lH.val)} Q ${toSvgX(d.bottom.idx)} ${toSvgY(d.bottom.val) + 12} ${toSvgX(d.rH.idx)} ${toSvgY(d.rH.val)}`}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2.8"
              />
              {/* Handle réel */}
              <path
                d={`M ${toSvgX(d.rH.idx)} ${toSvgY(d.rH.val)} Q ${toSvgX((d.rH.idx + prices.length - 1) / 2)} ${toSvgY(d.rH.val) + 10} ${toSvgX(prices.length - 1)} ${toSvgY(d.end?.val || d.rH.val)}`}
                fill="none"
                stroke="#00ff88"
                strokeWidth="2.5"
                strokeDasharray="3,3"
              />
              <circle cx={toSvgX(d.lH.idx)} cy={toSvgY(d.lH.val)} r="3" fill="#facc15" />
              <circle cx={toSvgX(d.bottom.idx)} cy={toSvgY(d.bottom.val)} r="3.5" fill="#38bdf8" />
              <circle cx={toSvgX(d.rH.idx)} cy={toSvgY(d.rH.val)} r="3" fill="#facc15" />
              <circle cx={toSvgX(prices.length - 1)} cy={toSvgY(d.end?.val || d.rH.val)} r="4" fill="#00ff88" />
            </g>
          )}

          {/* 🎯 3. TRACÉ GÉOMÉTRIQUE RÉEL POUR ASCENDING TRIANGLE */}
          {pattern.key === 'ASC_TRIANGLE' && d.l1 && d.l2 && (
            <g>
              {/* Résistance horizontale réelle */}
              <line
                x1={toSvgX(d.l1.idx)}
                y1={toSvgY(d.resVal || 90)}
                x2={toSvgX(prices.length - 1) + 8}
                y2={toSvgY(d.resVal || 90)}
                stroke="#f87171"
                strokeWidth="2"
                strokeDasharray="4,4"
              />
              {/* Support ascendant réel passant par les creux réels */}
              <line
                x1={toSvgX(d.l1.idx)}
                y1={toSvgY(d.l1.val)}
                x2={toSvgX(prices.length - 1)}
                y2={toSvgY(d.resVal || 90)}
                stroke="#00ff88"
                strokeWidth="2.8"
              />
              <circle cx={toSvgX(d.l1.idx)} cy={toSvgY(d.l1.val)} r="3.5" fill="#00ff88" />
              <circle cx={toSvgX(d.l2.idx)} cy={toSvgY(d.l2.val)} r="3.5" fill="#00ff88" />
              <circle cx={toSvgX(prices.length - 1)} cy={toSvgY(d.resVal || 90)} r="4" fill="#facc15" />
            </g>
          )}

          {/* 🎯 4. TRACÉ GÉOMÉTRIQUE RÉEL POUR BULL FLAG */}
          {pattern.key === 'BULL_FLAG' && d.poleStart && d.polePeak && (
            <g>
              {/* Mât vertical réel */}
              <line
                x1={toSvgX(d.poleStart.idx)}
                y1={toSvgY(d.poleStart.val)}
                x2={toSvgX(d.polePeak.idx)}
                y2={toSvgY(d.polePeak.val)}
                stroke="#00ff88"
                strokeWidth="3.2"
              />
              {/* Canal descendant réel du drapeau */}
              <line
                x1={toSvgX(d.polePeak.idx)}
                y1={toSvgY(d.polePeak.val)}
                x2={toSvgX(prices.length - 1)}
                y2={toSvgY(d.end?.val || d.polePeak.val - 15)}
                stroke="#ec4899"
                strokeWidth="2.2"
                strokeDasharray="3,3"
              />
              <circle cx={toSvgX(d.polePeak.idx)} cy={toSvgY(d.polePeak.val)} r="3.5" fill="#facc15" />
              <circle cx={toSvgX(prices.length - 1)} cy={toSvgY(d.end?.val || d.polePeak.val - 15)} r="4" fill="#00ff88" />
            </g>
          )}

          {/* 🎯 5. TRACÉ GÉOMÉTRIQUE RÉEL POUR FALLING WEDGE */}
          {pattern.key === 'FALLING_WEDGE' && d.h1 && d.h2 && d.l1 && d.l2 && (
            <g>
              {/* Résistance descendante réelle */}
              <line
                x1={toSvgX(d.h1.idx)}
                y1={toSvgY(d.h1.val)}
                x2={toSvgX(prices.length - 1)}
                y2={toSvgY(d.h2.val - 5)}
                stroke="#a855f7"
                strokeWidth="2.4"
              />
              {/* Support descendant convergent réel */}
              <line
                x1={toSvgX(d.l1.idx)}
                y1={toSvgY(d.l1.val)}
                x2={toSvgX(prices.length - 1)}
                y2={toSvgY(d.l2.val + 5)}
                stroke="#a855f7"
                strokeWidth="2.4"
              />
              <circle cx={toSvgX(d.h1.idx)} cy={toSvgY(d.h1.val)} r="3" fill="#a855f7" />
              <circle cx={toSvgX(d.l1.idx)} cy={toSvgY(d.l1.val)} r="3" fill="#a855f7" />
              <circle cx={toSvgX(prices.length - 1)} cy={toSvgY(d.end?.val || d.l2.val)} r="4" fill="#00ff88" />
            </g>
          )}
        </svg>
      </div>

      {/* Pied de carte */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.70rem' }}>
        <span style={{ color: token.p30d >= 0 ? '#00ff88' : '#ef4444', fontWeight: 'bold' }}>
          30D: {token.p30d >= 0 ? '+' : ''}{token.p30d}%
        </span>
        <span style={{ color: token.p1d >= 0 ? '#38bdf8' : '#ef4444', fontWeight: 'bold' }}>
          24H: {token.p1d >= 0 ? '+' : ''}{token.p1d}%
        </span>
        <span style={{
          background: token.phase4h?.badgeBg || 'rgba(255,255,255,0.05)',
          color: token.phase4h?.color || '#cbd5e1',
          padding: '2px 6px',
          borderRadius: '4px',
          fontWeight: '900',
          fontSize: '0.64rem'
        }}>
          {token.phase4h?.shortLabel}
        </span>
      </div>
    </div>
  );
}




// 📊 COMPOSANT CARTE DE ZONE MACRO INDIVIDUELLE (PROPRE, LISIBLE, SANS ENCOMBREMENT)
function MacroZoneChartCard({
  zoneNumber,
  icon,
  title,
  badgeText,
  color,
  borderColor,
  tokens = [],
  tokenCurvesMap = {},
  horizonTimestamps = [],
  benchmarkLines = [],
  onSelectToken,
  selectedSoloToken,
  chartHeight = 330
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 550,
      height: chartHeight,
      layout: { background: { color: 'rgba(5, 8, 18, 0.98)' }, textColor: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      grid: { vertLines: { color: 'rgba(255, 255, 255, 0.04)' }, horzLines: { color: 'rgba(255, 255, 255, 0.04)' } },
      rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)', scaleMargins: { top: 0.08, bottom: 0.08 }, autoScale: true },
      timeScale: { borderColor: 'rgba(255, 255, 255, 0.1)', timeVisible: true, secondsVisible: false, rightOffset: 6 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
    });

    chartRef.current = chart;

    // 1. Dessiner les courbes des tokens (SANS étiquette sur l'axe droit pour ne pas encombrer le graphique)
    tokens.forEach((t, idx) => {
      const fixedColor = getTokenFixedColor(t.cleanSymbol);
      const isSolo = selectedSoloToken?.cleanSymbol === t.cleanSymbol;
      const data = tokenCurvesMap[t.cleanSymbol] || t.curveData || [];
      if (data && data.length > 0) {
        const lineSeries = chart.addLineSeries({
          color: fixedColor,
          lineWidth: isSolo ? 3.5 : 2,
          lineStyle: 0,
          title: `#${t.rankMonth || idx + 1} ${t.cleanSymbol}`,
          priceLineVisible: false,
          lastValueVisible: false, // ✨ Dégage complètement l'axe des prix !
        });
        lineSeries.setData(data);
      }
    });

    // 2. Dessiner UNIQUEMENT les lignes de benchmark majeures sur l'axe droit
    benchmarkLines.forEach(b => {
      if (!b.data && b.constantValue === undefined) return;
      const bSeries = chart.addLineSeries({
        color: b.color,
        lineWidth: b.lineWidth || 2.2,
        lineStyle: b.lineStyle !== undefined ? b.lineStyle : 2,
        title: b.title,
        priceLineVisible: false,
        lastValueVisible: true, // Seules les lignes de référence ont une étiquette
      });
      if (b.data && b.data.length > 0) {
        bSeries.setData(b.data);
      } else if (b.constantValue !== undefined && horizonTimestamps.length > 0) {
        bSeries.setData(horizonTimestamps.map(t => ({ time: t, value: b.constantValue })));
      }
    });

    chart.timeScale().fitContent();
    try {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) {
        const totalBars = Math.max(10, range.to - range.from);
        const padding = Math.max(16, Math.round(totalBars * 0.12));
        chart.timeScale().setVisibleLogicalRange({
          from: range.from,
          to: range.to + padding
        });
      }
    } catch (_) {}

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
      }
    };
  }, [tokens, tokenCurvesMap, horizonTimestamps, benchmarkLines, chartHeight, selectedSoloToken]);

  const handleReset = () => {
    if (chartRef.current) {
      try {
        chartRef.current.timeScale().fitContent();
        const range = chartRef.current.timeScale().getVisibleLogicalRange();
        if (range) {
          const totalBars = Math.max(10, range.to - range.from);
          const padding = Math.max(16, Math.round(totalBars * 0.12));
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: range.from,
            to: range.to + padding
          });
        }
      } catch (_) {
        chartRef.current.timeScale().fitContent();
      }
    }
  };

  return (
    <div style={{
      background: '#0a1519',
      border: `1px solid rgba(255, 255, 255, 0.08)`,
      borderRadius: '10px',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      boxShadow: 'none',
      position: 'relative'
    }}>
      {/* En-tête Compact */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '1.05rem' }}>{icon}</span>
          <span style={{ fontSize: '0.86rem', fontWeight: '900', color: '#fff' }}>{title}</span>
          <span style={{
            background: `${color}22`,
            color: color,
            border: `1px solid ${color}66`,
            padding: '2px 7px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            fontWeight: '900'
          }}>
            {tokens.length} TOKENS ({badgeText})
          </span>
        </div>

        <button
          onClick={handleReset}
          style={{
            background: 'rgba(255,255,255,0.06)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            padding: '3px 7px',
            borderRadius: '5px',
            fontSize: '0.65rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '3px'
          }}
        >
          <RotateCcw size={10} /> ZOOM
        </button>
      </div>

      {/* Badges de tokens scrollables */}
      {tokens.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '5px',
          overflowX: 'auto',
          paddingBottom: '2px',
          scrollbarWidth: 'thin'
        }}>
          {tokens.map((t) => {
            const fixedColor = getTokenFixedColor(t.cleanSymbol);
            const isSelected = selectedSoloToken?.cleanSymbol === t.cleanSymbol;
            return (
              <button
                key={t.cleanSymbol}
                onClick={() => onSelectToken && onSelectToken(isSelected ? null : t)}
                style={{
                  background: isSelected ? `${fixedColor}33` : 'rgba(255,255,255,0.04)',
                  color: isSelected ? '#fff' : '#cbd5e1',
                  border: isSelected ? `1.5px solid ${fixedColor}` : '1px solid rgba(255,255,255,0.08)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.65rem',
                  fontWeight: '800',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  flexShrink: 0
                }}
              >
                <span style={{ color: fixedColor }}>●</span>
                <span>#{t.rankMonth} {t.cleanSymbol}</span>
                <span style={{ color: (t.scoreMonth ?? t.latestVal ?? 0) >= 0 ? '#00ff88' : '#ef4444' }}>
                  {(t.scoreMonth ?? t.latestVal ?? 0) >= 0 ? '+' : ''}{t.scoreMonth ?? t.latestVal ?? 0} pts
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Canvas du sous-graphique */}
      <div ref={containerRef} style={{ width: '100%', height: `${chartHeight}px`, borderRadius: '6px', overflow: 'hidden' }} />
    </div>
  );
}


// ========================================================================================
// 🧭 COMPOSANT DÉDIÉ : MARCHÉ SENTIMENT (TOP 50 DOMINANCE & SIGNAL BTC INDÉPENDANT)
// ========================================================================================
function MarketSentimentBar({ marketSentiment, btcMarketData }) {
  if (!marketSentiment) return null;

  const isBull = marketSentiment.dominance === 'BULL';
  const isBear = marketSentiment.dominance === 'BEAR';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
      background: '#080d1a',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      borderRadius: '8px',
      padding: '6px 12px',
      margin: '4px 0 6px 0'
    }}>
      {/* 1. Titre & Badge Dominance */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>🧭</span>
          <span style={{ fontSize: '0.74rem', fontWeight: '700', color: '#94a3b8', letterSpacing: '0.3px' }}>
            SENTIMENT DU MARCHÉ (TOP 50) :
          </span>
        </div>

        <div style={{
          background: isBull 
            ? 'rgba(16, 185, 129, 0.08)' 
            : isBear 
              ? 'rgba(239, 68, 68, 0.08)' 
              : 'rgba(255, 255, 255, 0.04)',
          color: isBull 
            ? '#34d399' 
            : isBear 
              ? '#f87171' 
              : '#94a3b8',
          border: `1px solid ${isBull ? 'rgba(16, 185, 129, 0.25)' : isBear ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255, 255, 255, 0.08)'}`,
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.70rem',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '5px'
        }}>
          {isBull && '● HAUSSIER (IRTIFA3)'}
          {isBear && '● BAISSIER (HABOT)'}
          {!isBull && !isBear && '● ÉQUILIBRÉ / ROTATION'}
        </div>
      </div>

      {/* 2. Jauge Provisoire Hausse vs Baisse */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: '1', minWidth: '200px', maxWidth: '380px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.70rem', fontWeight: '600', color: '#34d399', whiteSpace: 'nowrap' }}>
          <span>{marketSentiment.upCount} en hausse ({marketSentiment.upPct}%)</span>
        </div>

        {/* Dual Progress Bar */}
        <div style={{
          flex: 1,
          height: '4px',
          background: 'rgba(255, 255, 255, 0.06)',
          borderRadius: '2px',
          overflow: 'hidden',
          display: 'flex'
        }}>
          <div style={{
            width: `${marketSentiment.upPct}%`,
            background: '#10b981',
            transition: 'width 0.4s ease'
          }} />
          <div style={{
            width: `${marketSentiment.downPct}%`,
            background: '#ef4444',
            transition: 'width 0.4s ease'
          }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.70rem', fontWeight: '600', color: '#f87171', whiteSpace: 'nowrap' }}>
          <span>{marketSentiment.downCount} en baisse ({marketSentiment.downPct}%)</span>
        </div>
      </div>

      {/* 3. Signal BTC Indépendant */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '2px 8px',
        borderRadius: '5px'
      }}>
        <span style={{ fontSize: '0.85rem', color: '#f59e0b' }}>₿</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.70rem' }}>
          <span style={{ color: '#94a3b8' }}>
            BTC {btcMarketData?.price > 0 ? `$${btcMarketData.price.toLocaleString()}` : ''}
          </span>
          <span style={{
            color: btcMarketData?.isPositive ? '#34d399' : '#f87171',
            fontWeight: '700'
          }}>
            {(btcMarketData?.change24h ?? 0) >= 0 ? '+' : ''}{btcMarketData?.change24h ?? 0}%
          </span>
        </div>
      </div>
    </div>
  );
}


// ========================================================================================
// 🎯 COMPOSANT CHARTE DÉDIÉE : CORRIDOR SNIPER ACTIF [LIGNE D'ENTRÉE ➔ RÉSISTANCE MACRO]
// ========================================================================================
function CorridorSniperZoneChart({
  tokensData = [],
  tripleAnalysis = {},
  chartProcessedData = {},
  activeChartHorizon = 'day',
  chartUniverse = 'MONTH_SCORE',
  selectedSoloToken,
  setSelectedSoloToken,
  mainChartRef,
  onClose,
  marketSentiment,
  btcMarketData,
  dailyCgData = {},
  dailyMarketCaps = {},
  livePricesRef
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
  const refResistanceSeriesRef = useRef(null);
  const refRejectionSeriesRef = useRef(null);
  const refEntrySeriesRef = useRef(null);

  // 🪟 CHARTE DUO 30 JOURS (CÔTE À CÔTE)
  const [showDualView, setShowDualView] = useState(true);
  const monthContainerRef = useRef(null);
  const monthChartRef = useRef(null);
  const monthSeriesMapRef = useRef({});
  const refMonthResistanceSeriesRef = useRef(null);
  const refMonthEma20SeriesRef = useRef(null);

  // 📅 Vraies données 30 Jours glissants (720 Heures / 1 Mois complet)
  const [corridor30dMap, setCorridor30dMap] = useState({});
  const [corridor30dTimestamps, setCorridor30dTimestamps] = useState([]);
  const [corridor30dEma, setCorridor30dEma] = useState([]);
  const [isLoading30d, setIsLoading30d] = useState(false);
  const corridor30dMapRef = useRef({});
  const corridor30dTimestampsRef = useRef([]);
  useEffect(() => { corridor30dMapRef.current = corridor30dMap; }, [corridor30dMap]);
  useEffect(() => { corridor30dTimestampsRef.current = corridor30dTimestamps; }, [corridor30dTimestamps]);
  
  const hasFitted24hRef = useRef(false);
  const hasFitted30dRef = useRef(false);
  const prevSymbols24hRef = useRef('');
  const prevSymbols30dRef = useRef('');
  const [corridorHeight, setCorridorHeight] = useState(420);
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const [highlightedToken, setHighlightedToken] = useState(null);
  const [defillamaData, setDefillamaData] = useState({});
  const [isLoadingLlama, setIsLoadingLlama] = useState(false);
  const [showLlamaDetails, setShowLlamaDetails] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(420);

  // ↔️ Contrôle interactif de largeur (Split Ratio 24H vs 30D)
  const [splitRatio, setSplitRatio] = useState(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef(null);

  // ⛶ Mode Plein Écran
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 1. Détermination précise des 3 niveaux clés du corridor
  const entryLvl = useMemo(() => {
    if (activeChartHorizon === 'day') {
      return chartProcessedData?.launchpad24hData?.lvl != null ? chartProcessedData.launchpad24hData.lvl : 6.0;
    }
    if (activeChartHorizon === 'week') {
      return parseFloat(((chartProcessedData?.valMax || 25.0) * 0.75).toFixed(2));
    }
    return chartProcessedData?.valMax || 32.0;
  }, [activeChartHorizon, chartProcessedData]);

  const macroResLvl = useMemo(() => {
    return tripleAnalysis?.dynamicMonthlyRefLevel != null ? tripleAnalysis.dynamicMonthlyRefLevel : 26.11;
  }, [tripleAnalysis]);

  const rejectionLvl = useMemo(() => {
    return chartProcessedData?.rejectionWall24hData?.lvl || 13.0;
  }, [chartProcessedData]);

  // 2. Filtrage STRICT des tokens (Demande directe utilisateur) :
  // "YA3ni anwariw ghi les tokens li kaynin f dik la zone
  //  ila token khraj mn lasfar safi manwariwahch , wila khraj token taht ligne d'entrer ta howa manwariwhch
  //  ya3ni ghi les token nta3 la zone ( ligne entrer- resistance macro ) homa li ghadi ntab3ohom o kayakhdo l ihtimam dyalna"
  const corridorTokens = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    const tokenCurvesMap = chartProcessedData?.tokenCurvesMap || {};
    const tokenBasePricesMap = chartProcessedData?.tokenBasePricesMap || {};
    const tokenMonthCurvesMap = chartProcessedData?.tokenMonthCurvesMap || {};
    const tokenMonthBasePricesMap = chartProcessedData?.tokenMonthBasePricesMap || {};
    const lastCandleTime = chartProcessedData?.lastCandleTime;

    const filtered = list.filter(tok => {
      const sym = tok.cleanSymbol;
      if (!sym || sym === 'BTC' || sym === 'ETH') return false;
      const curve = tokenCurvesMap[sym];
      if (!curve || curve.length === 0) return false;

      const latestVal = curve[curve.length - 1].value;
      return latestVal >= entryLvl && latestVal <= macroResLvl;
    }).map((tok, idx) => {
      const curve = tokenCurvesMap[tok.cleanSymbol] || [];
      const latestVal = curve[curve.length - 1]?.value ?? 0;
      const basePrice = tokenBasePricesMap[tok.cleanSymbol] || tok.price;
      const curveMonth = tokenMonthCurvesMap[tok.cleanSymbol] || [];
      const basePriceMonth = tokenMonthBasePricesMap[tok.cleanSymbol] || tok.price;
      const latestValMonth = curveMonth[curveMonth.length - 1]?.value ?? 0;
      return {
        ...tok,
        latestVal,
        curveData: curve,
        basePrice,
        curveDataMonth: curveMonth,
        basePriceMonth,
        latestValMonth,
        lastCandleTime,
        corridorRank: idx + 1
      };
    });

    return filtered.sort((a, b) => b.latestVal - a.latestVal);
  }, [chartUniverse, tripleAnalysis, chartProcessedData, entryLvl, macroResLvl]);

  // Statistiques du corridor
  const totalCorridorVolume = useMemo(() => {
    return corridorTokens.reduce((acc, t) => acc + (t.turnover24h || 0), 0);
  }, [corridorTokens]);

  // 🦙 Récupération ciblée des fondamentaux DeFiLlama (Fees 24h/7j & TVL) pour les tokens du corridor
  useEffect(() => {
    if (!corridorTokens || corridorTokens.length === 0) {
      setDefillamaData({});
      return;
    }
    const symbols = corridorTokens.map(t => t.cleanSymbol);
    let isMounted = true;
    setIsLoadingLlama(true);
    getDeFiLlamaMetricsForSymbols(symbols, tokensData)
      .then(res => {
        if (isMounted) {
          setDefillamaData(res || {});
          setIsLoadingLlama(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoadingLlama(false);
      });
    return () => { isMounted = false; };
  }, [corridorTokens, tokensData]);

  // 📅 RÉCUPÉRATION DES VRAIES BOUGIES 30 JOURS (60m / 720 bougies = 30 Jours Glissants Réels)
  const corridorSymbolsKey = useMemo(() => {
    return (corridorTokens || []).map(t => t.cleanSymbol).sort().join(',');
  }, [corridorTokens]);

  useEffect(() => {
    if (!showDualView || !corridorTokens || corridorTokens.length === 0) return;
    const symbols = corridorTokens.map(t => t.cleanSymbol);
    let isMounted = true;

    async function load30dKlines() {
      setIsLoading30d(true);
      try {
        const results = await Promise.all(
          symbols.map(async (sym) => {
            const klines60 = await fetchBybitKlines(sym, '60', 720);
            return { sym, klines: klines60 };
          })
        );

        if (!isMounted) return;

        let longestKlines = [];
        results.forEach(r => {
          if (r.klines && r.klines.length > longestKlines.length) {
            longestKlines = r.klines;
          }
        });

        if (longestKlines.length === 0) {
          setIsLoading30d(false);
          return;
        }

        const timestamps = longestKlines.map(k => Math.floor(parseInt(k[0]) / 1000));
        setCorridor30dTimestamps(timestamps);

        const newMap = {};
        results.forEach(r => {
          if (!r.klines || r.klines.length === 0) return;
          const klines = r.klines;
          const basePrice = parseFloat(klines[0][4]) || parseFloat(klines[0][1]);
          if (!basePrice || basePrice <= 0) return;

          const curve = klines.map(k => {
            const t = Math.floor(parseInt(k[0]) / 1000);
            const close = parseFloat(k[4]);
            const val = ((close - basePrice) / basePrice) * 100;
            return { time: t, value: parseFloat(val.toFixed(2)) };
          });

          newMap[r.sym] = {
            curve,
            basePrice,
            latestVal: curve[curve.length - 1]?.value ?? 0
          };
        });

        // Calcul Master EMA 20 (30D) sur 720 heures
        const alpha20 = 2 / (20 + 1);
        let runningEma = null;
        const emaData = [];

        timestamps.forEach((tTime, idx) => {
          let sumVal = 0;
          let count = 0;
          symbols.forEach(s => {
            const itemData = newMap[s];
            if (itemData?.curve) {
              const pt = itemData.curve[idx] || itemData.curve.find(p => p.time === tTime);
              if (pt) {
                sumVal += pt.value;
                count++;
              }
            }
          });
          if (count > 0) {
            const avgVal = sumVal / count;
            if (runningEma === null) runningEma = avgVal;
            else runningEma = (avgVal * alpha20) + (runningEma * (1 - alpha20));
            emaData.push({ time: tTime, value: parseFloat(runningEma.toFixed(2)) });
          }
        });

        setCorridor30dEma(emaData);
        setCorridor30dMap(newMap);
      } catch (e) {
        console.error('Error fetching 30-day 60m klines:', e);
      } finally {
        if (isMounted) setIsLoading30d(false);
      }
    }

    load30dKlines();

    return () => { isMounted = false; };
  }, [corridorSymbolsKey, showDualView]);

  // Hauteur effective adaptée (mode normal ou plein écran)
  const effectiveChartHeight = isFullscreen
    ? Math.max(340, window.innerHeight - 200)
    : corridorHeight;

  // Gestion de la touche Échap pour quitter le plein écran
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // ↔️ Redimensionnement horizontal de la largeur (Split Ratio 24H vs 30D)
  const handleMouseDownSplit = (e) => {
    e.preventDefault();
    setIsDraggingSplit(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingSplit || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const pct = Math.max(20, Math.min(80, (currentX / rect.width) * 100));
      setSplitRatio(Math.round(pct));
    };
    const handleMouseUp = () => {
      if (isDraggingSplit) {
        setIsDraggingSplit(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };
    if (isDraggingSplit) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit]);

  // ↕️ Redimensionnement vertical de la hauteur à la souris
  const handleMouseDownHeight = (e) => {
    if (isFullscreen) return;
    setIsDraggingHeight(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = corridorHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingHeight || isFullscreen) return;
      const deltaY = e.clientY - dragStartYRef.current;
      const newH = Math.max(280, Math.min(950, dragStartHeightRef.current + deltaY));
      setCorridorHeight(newH);
      if (chartRef.current) {
        chartRef.current.applyOptions({ height: newH });
      }
      if (monthChartRef.current) {
        monthChartRef.current.applyOptions({ height: newH });
      }
    };
    const handleMouseUp = () => {
      if (isDraggingHeight) {
        setIsDraggingHeight(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };
    if (isDraggingHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingHeight, isFullscreen]);

  // 📏 Helper : Zoom propre avec espace libre généreux à droite (35 barres pour 24H, 160 barres pour 30D)
  const applyComfortableZoom = (targetChart, forcedOffset = null) => {
    if (!targetChart) return;
    try {
      const is30d = targetChart === monthChartRef.current;
      const rightOffset = forcedOffset != null ? forcedOffset : (is30d ? 160 : 35);
      targetChart.timeScale().applyOptions({
        rightOffset: rightOffset,
        fixRightEdge: false,
        fixLeftEdge: false
      });
      targetChart.timeScale().fitContent();
    } catch (_) {}
  };

  // Recalcul automatique des dimensions lors des changements de ratio, vue duo ou plein écran
  useEffect(() => {
    const handleResizeTimer = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: effectiveChartHeight
        });
        applyComfortableZoom(chartRef.current, 35);
      }
      if (monthContainerRef.current && monthChartRef.current) {
        monthChartRef.current.applyOptions({
          width: monthContainerRef.current.clientWidth,
          height: effectiveChartHeight
        });
        applyComfortableZoom(monthChartRef.current, 160);
      }
    };

    handleResizeTimer();
    const timer = setTimeout(handleResizeTimer, 60);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && splitContainerRef.current) {
      ro = new ResizeObserver(() => {
        handleResizeTimer();
      });
      ro.observe(splitContainerRef.current);
    }

    return () => {
      clearTimeout(timer);
      if (ro) ro.disconnect();
    };
  }, [showDualView, splitRatio, isFullscreen, effectiveChartHeight]);

  // 3. Initialisation du Canvas Lightweight Charts
  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
      seriesMapRef.current = {};
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: corridorHeight,
      layout: {
        background: { color: '#040711' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.10 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        fixRightEdge: false,
        fixLeftEdge: false
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(34, 211, 238, 0.25)', width: 1, style: 2 },
        horzLine: { color: 'rgba(34, 211, 238, 0.25)', width: 1, style: 2 },
      }
    });

    chartRef.current = chart;

    // Plafond : Résistance Macro
    refResistanceSeriesRef.current = chart.addLineSeries({
      color: '#facc15',
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'RÉSISTANCE'
    });

    // Mur de Rejet Intermédiaire
    refRejectionSeriesRef.current = chart.addLineSeries({
      color: '#f43f5e',
      lineWidth: 1.5,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'REJET'
    });

    // Plancher : Ligne d'Entrée
    refEntrySeriesRef.current = chart.addLineSeries({
      color: '#10b981',
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "ENTRÉE"
    });

    // Synchronisation du temps avec le graphique principal
    let isSyncing = false;
    const unsubCorridor = chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (isSyncing || !mainChartRef?.current || !range) return;
      try {
        isSyncing = true;
        mainChartRef.current.timeScale().setVisibleLogicalRange(range);
      } catch (_) {}
      isSyncing = false;
    });

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
        seriesMapRef.current = {};
      }
    };
  }, []);

  // 4. Synchronisation des Séries & Courbes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const horizonTimestamps = chartProcessedData?.horizonTimestamps || [];

    // Mettre à jour les 3 benchmarks
    if (refResistanceSeriesRef.current && horizonTimestamps.length > 0) {
      refResistanceSeriesRef.current.applyOptions({
        title: 'RÉSISTANCE MACRO'
      });
      refResistanceSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: macroResLvl })));
    }

    if (refRejectionSeriesRef.current && horizonTimestamps.length > 0) {
      if (rejectionLvl >= entryLvl - 2 && rejectionLvl <= macroResLvl + 2) {
        refRejectionSeriesRef.current.applyOptions({
          title: 'MUR DE REJET'
        });
        refRejectionSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: rejectionLvl })));
      } else {
        refRejectionSeriesRef.current.setData([]);
      }
    }

    if (refEntrySeriesRef.current && horizonTimestamps.length > 0) {
      refEntrySeriesRef.current.applyOptions({
        title: "LIGNE D'ENTRÉE"
      });
      refEntrySeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: entryLvl })));
    }

    // Gérer les séries des tokens du corridor
    const currentSymbols = new Set(corridorTokens.map(t => t.cleanSymbol));

    // Supprimer les tokens qui sont sortis de la zone
    Object.keys(seriesMapRef.current).forEach(sym => {
      if (!currentSymbols.has(sym)) {
        try {
          chart.removeSeries(seriesMapRef.current[sym]);
          delete seriesMapRef.current[sym];
        } catch (_) {}
      }
    });

    // Ajouter ou mettre à jour les tokens dans le couloir
    corridorTokens.forEach((item, idx) => {
      const fixedColor = getTokenFixedColor(item.cleanSymbol);
      const isSolo = highlightedToken === item.cleanSymbol || selectedSoloToken?.cleanSymbol === item.cleanSymbol;
      const rankNum = chartUniverse === 'MONTH_PEAK' ? (item.rankPeak || idx + 1) : (item.rankMonth || idx + 1);
      const title = `#${rankNum} ${item.cleanSymbol}`;

      // 🎯 Mode Focus Solo : le token sélectionné ressort net et épais (4.5px), les autres s'estompent en arrière-plan
      let lineColor = fixedColor;
      let lineWidth = 2.5;
      let lastValVisible = true;

      if (highlightedToken) {
        if (isSolo) {
          lineColor = fixedColor;
          lineWidth = 4.5;
          lastValVisible = true;
        } else {
          lineColor = 'rgba(148, 163, 184, 0.16)';
          lineWidth = 1.0;
          lastValVisible = false;
        }
      }

      let lineSeries = seriesMapRef.current[item.cleanSymbol];
      if (!lineSeries) {
        lineSeries = chart.addLineSeries({
          color: lineColor,
          lineWidth: lineWidth,
          lineStyle: 0,
          title: isSolo || !highlightedToken ? title : '',
          priceLineVisible: false,
          lastValueVisible: lastValVisible,
        });
        seriesMapRef.current[item.cleanSymbol] = lineSeries;
      } else {
        lineSeries.applyOptions({
          color: lineColor,
          lineWidth: lineWidth,
          title: isSolo || !highlightedToken ? title : '',
          lastValueVisible: lastValVisible
        });
      }

      if (item.curveData && item.curveData.length > 0) {
        lineSeries.setData(item.curveData);
      }
    });

    const currentKey = corridorTokens.map(t => t.cleanSymbol).sort().join(',');
    const shouldFit = !hasFitted24hRef.current || (prevSymbols24hRef.current !== '' && prevSymbols24hRef.current !== currentKey);
    if (shouldFit && corridorTokens.length > 0) {
      applyComfortableZoom(chart, 35);
      hasFitted24hRef.current = true;
    }
    prevSymbols24hRef.current = currentKey;
  }, [corridorTokens, macroResLvl, entryLvl, rejectionLvl, chartProcessedData, highlightedToken, selectedSoloToken, chartUniverse, dailyCgData, dailyMarketCaps]);

  // 4b. Initialisation du Canvas Lightweight Charts pour la Charte Macro 30D (Mêmes Tokens du Couloir)
  useEffect(() => {
    if (!monthContainerRef.current || !showDualView) return;
    if (monthChartRef.current) {
      try { monthChartRef.current.remove(); } catch (_) {}
      monthChartRef.current = null;
      monthSeriesMapRef.current = {};
    }

    const container = monthContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 600,
      height: corridorHeight,
      layout: {
        background: { color: '#040711' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.10 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 160,
        fixRightEdge: false,
        fixLeftEdge: false
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(34, 211, 238, 0.25)', width: 1, style: 2 },
        horzLine: { color: 'rgba(34, 211, 238, 0.25)', width: 1, style: 2 },
      }
    });

    monthChartRef.current = chart;

    // Résistance Macro 30D
    refMonthResistanceSeriesRef.current = chart.addLineSeries({
      color: '#facc15',
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'RÉSISTANCE'
    });

    // Master EMA 20 Mensuelle (Cyan)
    refMonthEma20SeriesRef.current = chart.addLineSeries({
      color: '#22d3ee',
      lineWidth: 2,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'EMA 20 (30D)'
    });

    const handleResize = () => {
      if (monthContainerRef.current && monthChartRef.current) {
        monthChartRef.current.applyOptions({ width: monthContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (monthChartRef.current) {
        try { monthChartRef.current.remove(); } catch (_) {}
        monthChartRef.current = null;
        monthSeriesMapRef.current = {};
      }
    };
  }, [showDualView]);

  // 4c. Synchronisation des Séries 30D pour les MÊMES tokens du corridor (VRAIS 30 Jours Glissants = 720 Heures)
  useEffect(() => {
    const chart = monthChartRef.current;
    if (!chart || !showDualView) return;

    const monthTimestamps = corridor30dTimestamps.length > 0
      ? corridor30dTimestamps
      : (chartProcessedData?.monthHorizonTimestamps || []);

    // Mettre à jour la résistance macro sur toute l'étendue des 30 jours
    if (refMonthResistanceSeriesRef.current && monthTimestamps.length > 0) {
      refMonthResistanceSeriesRef.current.setData(monthTimestamps.map(t => ({ time: t, value: macroResLvl })));
    }

    // Mettre à jour la Master EMA 20 30D
    const emaSeriesData = corridor30dEma.length > 0
      ? corridor30dEma
      : (chartProcessedData?.dynamicEma20MonthData || []);
    if (refMonthEma20SeriesRef.current && emaSeriesData.length > 0) {
      refMonthEma20SeriesRef.current.setData(emaSeriesData);
    }

    const currentSymbols = new Set(corridorTokens.map(t => t.cleanSymbol));
    Object.keys(monthSeriesMapRef.current).forEach(sym => {
      if (!currentSymbols.has(sym)) {
        try {
          chart.removeSeries(monthSeriesMapRef.current[sym]);
          delete monthSeriesMapRef.current[sym];
        } catch (_) {}
      }
    });

    corridorTokens.forEach((item, idx) => {
      const fixedColor = getTokenFixedColor(item.cleanSymbol);
      const isSolo = highlightedToken === item.cleanSymbol || selectedSoloToken?.cleanSymbol === item.cleanSymbol;
      const rankNum = chartUniverse === 'MONTH_PEAK' ? (item.rankPeak || idx + 1) : (item.rankMonth || idx + 1);
      const title = `#${rankNum} ${item.cleanSymbol}`;

      // 🎯 Mode Focus Solo 30D : le token sélectionné ressort net et épais (3.5px), les autres s'estompent en arrière-plan
      let lineColor = fixedColor;
      let lineWidth = 2;
      let lastValVisible = true;

      if (highlightedToken) {
        if (isSolo) {
          lineColor = fixedColor;
          lineWidth = 3.5;
          lastValVisible = true;
        } else {
          lineColor = 'rgba(148, 163, 184, 0.15)';
          lineWidth = 1;
          lastValVisible = false;
        }
      }

      let lineSeries = monthSeriesMapRef.current[item.cleanSymbol];
      if (!lineSeries) {
        lineSeries = chart.addLineSeries({
          color: lineColor,
          lineWidth: lineWidth,
          lineStyle: 0,
          title: isSolo || !highlightedToken ? title : '',
          priceLineVisible: false,
          lastValueVisible: lastValVisible,
        });
        monthSeriesMapRef.current[item.cleanSymbol] = lineSeries;
      } else {
        lineSeries.applyOptions({
          color: lineColor,
          lineWidth: lineWidth,
          title: isSolo || !highlightedToken ? title : '',
          lastValueVisible: lastValVisible
        });
      }

      // Priorité absolue à la vraie courbe 30 jours (720 bougies d'une heure)
      const data30d = corridor30dMap[item.cleanSymbol];
      const curveData = (data30d?.curve && data30d.curve.length > 0)
        ? data30d.curve
        : item.curveDataMonth;

      if (curveData && curveData.length > 0) {
        lineSeries.setData(curveData);
      }
    });

    const currentKey30d = corridorTokens.map(t => t.cleanSymbol).sort().join(',');
    const shouldFit30d = !hasFitted30dRef.current || (prevSymbols30dRef.current !== '' && prevSymbols30dRef.current !== currentKey30d);
    if (shouldFit30d && corridorTokens.length > 0) {
      applyComfortableZoom(chart, 160);
      hasFitted30dRef.current = true;
    }
    prevSymbols30dRef.current = currentKey30d;
  }, [corridorTokens, macroResLvl, corridor30dMap, corridor30dTimestamps, corridor30dEma, chartProcessedData, highlightedToken, selectedSoloToken, chartUniverse, showDualView]);

  // ⚡ 5. MOTEUR LIVE 15M HAUTE FRÉQUENCE (Ticks en direct Bybit WebSocket / REST)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !corridorTokens || corridorTokens.length === 0) return;

    const intervalId = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const activeCandleTime = Math.floor(nowSec / 900) * 900;

      let anyUpdated = false;
      corridorTokens.forEach(item => {
        const sym = item.cleanSymbol;
        const livePrice = livePricesRef?.current?.[sym];
        const basePrice = item.basePrice;
        if (livePrice && basePrice > 0) {
          const lineSeries = seriesMapRef.current[sym];
          if (lineSeries) {
            const livePts = parseFloat((((livePrice - basePrice) / basePrice) * 100).toFixed(2));
            const lastCandleTime = item.lastCandleTime || activeCandleTime;
            const targetTime = Math.max(lastCandleTime, activeCandleTime);
            try {
              lineSeries.update({
                time: targetTime,
                value: livePts
              });
              anyUpdated = true;
            } catch (_) {}
          }
        }
      });

      if (anyUpdated) {
        try {
          if (refResistanceSeriesRef.current) {
            refResistanceSeriesRef.current.update({ time: activeCandleTime, value: macroResLvl });
          }
          if (refRejectionSeriesRef.current && rejectionLvl >= entryLvl - 2 && rejectionLvl <= macroResLvl + 2) {
            refRejectionSeriesRef.current.update({ time: activeCandleTime, value: rejectionLvl });
          }
          if (refEntrySeriesRef.current) {
            refEntrySeriesRef.current.update({ time: activeCandleTime, value: entryLvl });
          }
        } catch (_) {}
      }

      // ⚡ Mise à jour LIVE simultanée de la Charte 30D Macro
      if (monthChartRef.current && showDualView) {
        const current30dMap = corridor30dMapRef.current;
        const current30dTimestamps = corridor30dTimestampsRef.current;
        corridorTokens.forEach(item => {
          const sym = item.cleanSymbol;
          const livePrice = livePricesRef?.current?.[sym];
          const data30d = current30dMap[sym];
          const basePriceMonth = (data30d?.basePrice > 0) ? data30d.basePrice : item.basePriceMonth;
          if (livePrice && basePriceMonth > 0) {
            const mSeries = monthSeriesMapRef.current[sym];
            if (mSeries) {
              const livePtsM = parseFloat((((livePrice - basePriceMonth) / basePriceMonth) * 100).toFixed(2));
              const curve = data30d?.curve;
              const lastCandleTime = (curve && curve.length > 0) ? curve[curve.length - 1].time : (item.lastCandleTime || activeCandleTime);
              const targetTime = Math.max(lastCandleTime, activeCandleTime);
              try {
                mSeries.update({
                  time: targetTime,
                  value: livePtsM
                });
              } catch (_) {}
            }
          }
        });

        try {
          if (refMonthResistanceSeriesRef.current) {
            const lastTime = current30dTimestamps.length > 0
              ? Math.max(activeCandleTime, current30dTimestamps[current30dTimestamps.length - 1])
              : activeCandleTime;
            refMonthResistanceSeriesRef.current.update({ time: lastTime, value: macroResLvl });
          }
        } catch (_) {}
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [corridorTokens, macroResLvl, entryLvl, rejectionLvl, livePricesRef, showDualView]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      applyComfortableZoom(chartRef.current, 35);
    }
    if (monthChartRef.current) {
      applyComfortableZoom(monthChartRef.current, 160);
    }
  };

  return (
    <div style={{
      marginTop: isFullscreen ? 0 : '14px',
      background: '#040711',
      border: isFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: isFullscreen ? 0 : '12px',
      padding: isFullscreen ? '12px 18px 10px 18px' : '12px 14px 8px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      position: isFullscreen ? 'fixed' : 'relative',
      top: isFullscreen ? 0 : 'auto',
      left: isFullscreen ? 0 : 'auto',
      right: isFullscreen ? 0 : 'auto',
      bottom: isFullscreen ? 0 : 'auto',
      width: isFullscreen ? '100vw' : '100%',
      height: isFullscreen ? '100vh' : 'auto',
      zIndex: isFullscreen ? 99999 : 1,
      overflow: isFullscreen ? 'hidden' : 'visible',
      boxShadow: isFullscreen ? '0 0 50px rgba(0, 0, 0, 0.95)' : 'none'
    }}>
      {/* 🟢 EN-TÊTE DE LA CHARTE CORRIDOR */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '4px 10px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ color: '#22d3ee', fontSize: '0.85rem' }}>◈</span>
            <span style={{
              color: '#f1f5f9',
              fontSize: '0.80rem',
              fontWeight: '800',
              letterSpacing: '0.3px'
            }}>
              CORRIDOR SNIPER ACTIF
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '0.70rem',
            color: '#94a3b8'
          }}>
            <span>Plancher: <strong style={{ color: '#34d399' }}>+{entryLvl} pts</strong></span>
            <span style={{ color: '#475569' }}>➔</span>
            <span>Plafond: <strong style={{ color: '#facc15' }}>+{macroResLvl}%</strong></span>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '0.70rem',
            color: '#cbd5e1'
          }}>
            <strong style={{ color: '#22d3ee' }}>{corridorTokens.length}</strong> qualifiés sur 50
          </div>

          {totalCorridorVolume > 0 && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.70rem',
              color: '#94a3b8'
            }}>
              Vol: <span style={{ color: '#e2e8f0' }}>{formatVolumeUSDT(totalCorridorVolume)}</span>
            </div>
          )}

          {/* ⚡ BADGE LIVE REALTIME 15M */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'rgba(34, 211, 238, 0.06)',
            border: '1px solid rgba(34, 211, 238, 0.25)',
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            color: '#22d3ee',
            fontWeight: '700'
          }}>
            <span style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#22d3ee'
            }} />
            <span>LIVE 15M</span>
          </div>

          {/* 🦙 BOUTON TOGGLE FONDAMENTAUX DEFILLAMA */}
          <button
            onClick={() => setShowLlamaDetails(!showLlamaDetails)}
            style={{
              background: showLlamaDetails 
                ? 'rgba(34, 211, 238, 0.12)' 
                : 'rgba(255, 255, 255, 0.03)',
              color: showLlamaDetails ? '#22d3ee' : '#94a3b8',
              border: showLlamaDetails ? '1px solid rgba(34, 211, 238, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.70rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease'
            }}
            title="Affiche ou masque les métriques fondamentales DeFiLlama"
          >
            <span>FONDAMENTAUX</span>
            <span style={{
              background: 'rgba(255, 255, 255, 0.06)',
              color: '#94a3b8',
              padding: '1px 4px',
              borderRadius: '3px',
              fontSize: '0.62rem'
            }}>
              {Object.keys(defillamaData).filter(k => defillamaData[k]?.hasFinancialData).length}/{corridorTokens.length}
            </span>
          </button>
        </div>

        {/* Boutons d'actions droite */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {highlightedToken && (
            <button
              onClick={() => setHighlightedToken(null)}
              style={{
                background: 'rgba(239, 68, 68, 0.10)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '3px 8px',
                borderRadius: '5px',
                fontSize: '0.68rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <X size={11} /> TOUT AFFICHER
            </button>
          )}

          {/* 🪟 BOUTON BASCULE CHARTE DUO 24H + 30D */}
          <button
            onClick={() => setShowDualView(!showDualView)}
            style={{
              background: showDualView ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              color: showDualView ? '#22d3ee' : '#94a3b8',
              border: showDualView ? '1px solid rgba(34, 211, 238, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 10px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease'
            }}
            title="Afficher côte à côte la charte 24H et la charte 30 Jours"
          >
            <span>⊞</span>
            <span>{showDualView ? 'VUE DUO 24H+30D' : 'VUE 24H SEULE'}</span>
          </button>

          {/* ⛶ BOUTON PLEIN ÉCRAN */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            style={{
              background: isFullscreen ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              color: isFullscreen ? '#f87171' : '#94a3b8',
              border: isFullscreen ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 10px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              transition: 'all 0.15s ease'
            }}
            title={isFullscreen ? "Quitter le plein écran (Échap)" : "Afficher en plein écran"}
          >
            <span>{isFullscreen ? '✕' : '⛶'}</span>
            <span>{isFullscreen ? 'QUITTER' : 'PLEIN ÉCRAN'}</span>
          </button>

          <button
            onClick={handleResetZoom}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 9px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.15s ease'
            }}
            title="Réinitialiser l'échelle"
          >
            <RotateCcw size={11} /> FIT ZOOM
          </button>

          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#64748b',
                border: '1px solid rgba(255, 255, 255, 0.07)',
                padding: '3px 7px',
                borderRadius: '5px',
                fontSize: '0.68rem',
                cursor: 'pointer'
              }}
              title="Masquer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 🧭 HUD MARCHÉ SENTIMENT & SIGNAL BTC (DANS LA CHARTE DU CORRIDOR) */}
      <MarketSentimentBar marketSentiment={marketSentiment} btcMarketData={btcMarketData} />

      {/* 🦙 PANNEAU FONDAMENTAL DEFILLAMA (FEES 24H/7J, REVENUE & TVL) */}
      {showLlamaDetails && (
        <div style={{
          background: '#060b18',
          border: '1px solid rgba(250, 204, 21, 0.3)',
          borderRadius: '10px',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid rgba(250, 204, 21, 0.2)', paddingBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.25rem' }}>🦙</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#facc15', fontWeight: '950', fontSize: '0.86rem', letterSpacing: '0.5px' }}>
                    FONDAMENTAUX DEFILLAMA (FEES RÉELS & TVL DU CORRIDOR)
                  </span>
                  <span style={{ background: 'rgba(0, 255, 136, 0.15)', color: '#00ff88', border: '1px solid #00ff88', padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: '900' }}>
                    API EN DIRECT
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.70rem' }}>
                  Frais réels générés on-chain (Gas pour les Chains L1/L2, Commissions pour les dApps) vs volume spéculatif Bybit
                </div>
              </div>
            </div>

            {isLoadingLlama && (
              <span style={{ color: '#38bdf8', fontSize: '0.72rem', fontWeight: 'bold' }}>
                ⚡ Interrogation DeFiLlama...
              </span>
            )}
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '10px'
          }}>
            {corridorTokens.map(tok => {
              const sym = tok.cleanSymbol;
              const llama = defillamaData[sym];
              const fixedColor = getTokenFixedColor(sym);
              const hasData = llama && llama.hasFinancialData;
              const isNonDefi = llama && llama.isNonDefi;

              // 1. Si le token est hors de la sphère DeFi (IA / Meme / CEX)
              if (isNonDefi) {
                return (
                  <div key={sym} style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(255, 255, 255, 0.15)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: fixedColor, fontWeight: '950', fontSize: '0.90rem' }}>
                        ● #{tok.rankMonth || tok.corridorRank} {sym}
                      </span>
                      <span style={{
                        background: 'rgba(234, 179, 8, 0.15)',
                        color: '#facc15',
                        border: '1px solid rgba(234, 179, 8, 0.4)',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        fontSize: '0.62rem',
                        fontWeight: '900'
                      }}>
                        ⚡ HORS-DEFI (IA / CEX)
                      </span>
                    </div>

                    <div style={{
                      color: '#94a3b8',
                      fontSize: '0.68rem',
                      lineHeight: '1.3',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '5px 8px',
                      borderRadius: '4px'
                    }}>
                      💡 Actif d'infrastructure IA ou spéculatif CEX sans smart contracts DeFi sur Ethereum/Solana (pas de TVL ni de swap fees).
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', alignItems: 'center', marginTop: '2px' }}>
                      <span style={{ color: '#94a3b8' }}>📈 Volume Bybit 24h :</span>
                      <strong style={{ color: '#38bdf8' }}>
                        {tok.turnover24h > 0 ? formatVolumeUSDT(tok.turnover24h) : 'Actif'}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', alignItems: 'center' }}>
                      <span style={{ color: '#94a3b8' }}>🎯 Momentum :</span>
                      <span style={{ color: '#facc15', fontWeight: 'bold' }}>
                        Carnet d'ordres CEX Bybit
                      </span>
                    </div>
                  </div>
                );
              }

              // 2. Token avec fondamentaux DeFi (Chain L1/L2 ou Protocole DeFi)
              const resolvedName = llama?.name && llama.name !== sym ? ` (${llama.name})` : '';

              return (
                <div key={sym} style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: `1.5px solid ${hasData ? 'rgba(250, 204, 21, 0.35)' : 'rgba(255, 255, 255, 0.08)'}`,
                  borderRadius: '8px',
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: fixedColor, fontWeight: '950', fontSize: '0.90rem' }}>
                        ● #{tok.rankMonth || tok.corridorRank} {sym}{resolvedName}
                      </span>
                      <span style={{
                        background: llama?.isChain ? 'rgba(56, 189, 248, 0.2)' : 'rgba(168, 85, 247, 0.2)',
                        color: llama?.isChain ? '#38bdf8' : '#c084fc',
                        border: llama?.isChain ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(168, 85, 247, 0.4)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        fontSize: '0.62rem',
                        fontWeight: '900'
                      }}>
                        {llama?.isChain ? '⛓️ CHAIN L1/L2' : `📱 ${llama?.category || 'DEFI PROTOCOL'}`}
                      </span>
                    </div>
                    {tok.turnover24h > 0 && (
                      <span style={{ color: '#94a3b8', fontSize: '0.68rem', fontWeight: 'bold' }}>
                        Vol Bybit: {formatVolumeUSDT(tok.turnover24h)}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8' }}>🔒 TVL (Valeur Bloquée) :</span>
                    <strong style={{ color: llama?.tvl > 0 ? '#38bdf8' : '#64748b' }}>
                      {llama?.tvl > 0 ? formatCurrencyUSD(llama.tvl) : 'N/A'}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8' }}>💰 Frais Réels (24h) :</span>
                    <strong style={{ color: llama?.fees24h > 0 ? '#00ff88' : '#64748b' }}>
                      {llama?.fees24h > 0 
                        ? formatCurrencyUSD(llama.fees24h) 
                        : (llama?.isChain ? '⚡ Gas natif' : '$0')}
                    </strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', alignItems: 'center' }}>
                    <span style={{ color: '#94a3b8' }}>📅 Frais Cumulés (7J) :</span>
                    <strong style={{ color: llama?.fees7d > 0 ? '#00ff88' : '#64748b' }}>
                      {llama?.fees7d > 0 
                        ? formatCurrencyUSD(llama.fees7d) 
                        : (llama?.isChain ? '⚡ Gas natif' : '$0')}
                    </strong>
                  </div>

                  {llama?.volToFeesRatio != null && (
                    <div style={{
                      marginTop: '4px',
                      padding: '4px 8px',
                      background: 'rgba(0,0,0,0.5)',
                      borderRadius: '5px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.68rem'
                    }}>
                      <span style={{ color: '#facc15', fontWeight: 'bold' }}>Ratio Vol CEX / Frais :</span>
                      <span style={{
                        color: llama.volToFeesRatio < 20 ? '#00ff88' : llama.volToFeesRatio < 100 ? '#facc15' : '#ef4444',
                        fontWeight: '950'
                      }}>
                        {llama.volToFeesRatio}x {llama.volToFeesRatio < 20 ? '🔥 FORTE RENTABILITÉ' : llama.volToFeesRatio < 100 ? '⚖️ ÉQUILIBRÉ' : '⚡ SPÉCULATIF'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ⚠️ MESSAGE SI AUCUN TOKEN DANS LE COULOIR */}
      {corridorTokens.length === 0 && (
        <div style={{
          padding: '12px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px dashed rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#f87171',
          fontSize: '0.80rem'
        }}>
          ⚠️ Aucun token ne se trouve actuellement dans le couloir [+${entryLvl} pts ➔ +${macroResLvl} pts].
        </div>
      )}

      {/* 🏷️ LISTE DE SÉLECTION RAPIDE DES TOKENS DU CORRIDOR (FOCUS / SOLO) & RATIO DE LARGEUR */}
      {corridorTokens.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          padding: '6px 8px',
          background: '#080d1a',
          borderRadius: '7px',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          scrollbarWidth: 'thin'
        }}>
          {/* Bouton pour afficher tous les tokens */}
          <button
            onClick={() => setHighlightedToken(null)}
            style={{
              background: !highlightedToken ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              color: !highlightedToken ? '#22d3ee' : '#94a3b8',
              border: !highlightedToken ? '1px solid rgba(34, 211, 238, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '3px 9px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
            title="Afficher tous les tokens sur les graphiques"
          >
            <span>◈ TOUS ({corridorTokens.length})</span>
          </button>

          {/* Pastilles pour chaque token du corridor */}
          {corridorTokens.map((t, idx) => {
            const isSelected = highlightedToken === t.cleanSymbol;
            const color = getTokenFixedColor(t.cleanSymbol);
            const rankNum = chartUniverse === 'MONTH_PEAK' ? (t.rankPeak || idx + 1) : (t.rankMonth || idx + 1);
            const data30d = corridor30dMap[t.cleanSymbol];
            const perf30d = data30d?.latestVal != null ? data30d.latestVal : t.latestValMonth;

            return (
              <button
                key={t.cleanSymbol}
                onClick={() => setHighlightedToken(isSelected ? null : t.cleanSymbol)}
                style={{
                  background: isSelected ? 'rgba(34, 211, 238, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  border: isSelected ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.07)',
                  padding: '3px 8px',
                  borderRadius: '5px',
                  fontSize: '0.68rem',
                  fontWeight: isSelected ? '800' : '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  opacity: (highlightedToken && !isSelected) ? 0.35 : 1
                }}
                title={`Cliquer pour isoler ${t.cleanSymbol} (les autres passent en arrière-plan)`}
              >
                <span style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: color
                }} />
                <span style={{ color: isSelected ? '#ffffff' : '#e2e8f0' }}>#{rankNum} {t.cleanSymbol}</span>
                <span style={{
                  color: t.latestVal >= 0 ? '#34d399' : '#f87171',
                  fontSize: '0.65rem',
                  fontWeight: '700'
                }}>
                  +{t.latestVal?.toFixed(1)}%
                </span>
                {perf30d != null && (
                  <span style={{
                    color: '#94a3b8',
                    fontSize: '0.63rem',
                    fontWeight: '600'
                  }}>
                    (30d: {perf30d >= 0 ? '+' : ''}{perf30d?.toFixed(1)}%)
                  </span>
                )}
              </button>
            );
          })}

          {/* ↔️ CONTRÔLEURS DE LARGEUR ET PRÉSÉLECTIONS RAPIDES */}
          {showDualView && (
            <div style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              paddingLeft: '8px',
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <span style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: '700', whiteSpace: 'nowrap' }}>
                LARGEUR ({splitRatio}% / {100 - splitRatio}%) :
              </span>
              {[
                { label: '35/65', ratio: 35 },
                { label: '50/50', ratio: 50 },
                { label: '65/35', ratio: 65 }
              ].map(p => (
                <button
                  key={p.ratio}
                  onClick={() => setSplitRatio(p.ratio)}
                  style={{
                    background: splitRatio === p.ratio ? 'rgba(34, 211, 238, 0.14)' : 'rgba(255, 255, 255, 0.03)',
                    color: splitRatio === p.ratio ? '#22d3ee' : '#94a3b8',
                    border: splitRatio === p.ratio ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.64rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease'
                  }}
                  title={`Régler la largeur à ${p.ratio}% / ${100 - p.ratio}%`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 📈 CONTENEURS CANVAS LIGHTWEIGHT CHARTS (VUE DUO AVEC REDIMENSIONNEMENT HORIZONTAL LIBRE) */}
      <div
        ref={splitContainerRef}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          width: '100%',
          position: 'relative'
        }}
      >
        {/* CHARTE GAUCHE : COULOIR 24 HEURES */}
        <div style={{
          width: showDualView ? `${splitRatio}%` : '100%',
          minWidth: showDualView ? '260px' : '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#040711',
          borderRadius: showDualView ? '7px 0 0 7px' : '7px',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          overflow: 'hidden',
          transition: isDraggingSplit ? 'none' : 'width 0.1s ease'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '5px 10px',
            background: '#080d1a',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.70rem',
            fontWeight: '700'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#e2e8f0' }}>
              <span style={{ color: '#22d3ee' }}>◈</span>
              <span>COULOIR 24 HEURES</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.66rem', color: '#94a3b8' }}>
              <span>Entrée: <strong style={{ color: '#34d399' }}>+{entryLvl} pts</strong></span>
              <span style={{ color: '#475569' }}>|</span>
              <span>Plafond: <strong style={{ color: '#facc15' }}>+{macroResLvl}%</strong></span>
            </div>
          </div>
          <div
            ref={containerRef}
            style={{
              width: '100%',
              height: `${effectiveChartHeight}px`,
              background: '#040711'
            }}
          />
        </div>

        {/* ↔️ SÉPARATEUR INTERACTIF GLISSANT POUR LA LARGEUR */}
        {showDualView && (
          <div
            onMouseDown={handleMouseDownSplit}
            style={{
              width: '12px',
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isDraggingSplit ? 'rgba(34, 211, 238, 0.25)' : 'rgba(255, 255, 255, 0.02)',
              borderLeft: isDraggingSplit ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.06)',
              borderRight: isDraggingSplit ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.06)',
              userSelect: 'none',
              zIndex: 10,
              transition: 'background 0.15s ease'
            }}
            title="↔️ Cliquez et glissez pour ajuster la largeur des 2 graphiques"
          >
            <div style={{
              width: '2px',
              height: '32px',
              borderRadius: '1px',
              background: isDraggingSplit ? '#22d3ee' : 'rgba(255, 255, 255, 0.2)'
            }} />
          </div>
        )}

        {/* CHARTE DROITE : STRUCTURE MACRO 30 JOURS (MÊMES TOKENS QUALIFIÉS) */}
        {showDualView && (
          <div style={{
            width: `calc(${100 - splitRatio}% - 12px)`,
            minWidth: '260px',
            display: 'flex',
            flexDirection: 'column',
            background: '#040711',
            borderRadius: '0 7px 7px 0',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            overflow: 'hidden',
            transition: isDraggingSplit ? 'none' : 'width 0.1s ease'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '5px 10px',
              background: '#080d1a',
              borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
              fontSize: '0.70rem',
              fontWeight: '700'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#e2e8f0' }}>
                <span style={{ color: '#22d3ee' }}>◈</span>
                <span>STRUCTURE 30 JOURS (720H)</span>
                {isLoading30d ? (
                  <span style={{
                    fontSize: '0.62rem',
                    color: '#94a3b8',
                    background: 'rgba(255, 255, 255, 0.04)',
                    padding: '1px 5px',
                    borderRadius: '3px'
                  }}>
                    ⏳ chargement...
                  </span>
                ) : (
                  <span style={{
                    fontSize: '0.62rem',
                    color: '#64748b',
                    background: 'rgba(255, 255, 255, 0.03)',
                    padding: '1px 5px',
                    borderRadius: '3px'
                  }}>
                    ● 30J réels
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.66rem', color: '#94a3b8' }}>
                <span>EMA 20: <strong style={{ color: '#22d3ee' }}>30D</strong></span>
                <span style={{ color: '#475569' }}>|</span>
                <span>Résistance: <strong style={{ color: '#facc15' }}>+{macroResLvl}%</strong></span>
              </div>
            </div>
            <div
              ref={monthContainerRef}
              style={{
                width: '100%',
                height: `${effectiveChartHeight}px`,
                background: '#040711'
              }}
            />
          </div>
        )}
      </div>

      {/* ↕️ POIGNÉE DE REDIMENSIONNEMENT DE LA HAUTEUR (MASQUÉE EN PLEIN ÉCRAN) */}
      {!isFullscreen && (
        <div
          onMouseDown={handleMouseDownHeight}
          style={{
            width: '100%',
            height: '18px',
            background: isDraggingHeight ? 'rgba(34, 211, 238, 0.15)' : 'rgba(255, 255, 255, 0.02)',
            borderTop: isDraggingHeight ? '1px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '0 0 8px 8px',
            cursor: 'row-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            userSelect: 'none',
            transition: 'background 0.15s ease'
          }}
          title="Glisser vers le haut ou le bas pour ajuster la hauteur"
        >
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#22d3ee' : '#475569', borderRadius: '1px' }} />
          <span style={{ color: isDraggingHeight ? '#22d3ee' : '#64748b', fontSize: '0.64rem', fontWeight: '700' }}>
            ↕ HAUTEUR ({corridorHeight}px)
          </span>
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#22d3ee' : '#475569', borderRadius: '1px' }} />
        </div>
      )}
    </div>
  );
}


// ========================================================================================
// 👑 COMPOSANT CHARTE DÉDIÉE : RADAR HIGHER HIGH 30D (RETETS & BREAKOUTS DU SOMMET MENSUEL)
// ========================================================================================
export function MonthlyHigherHighRadarChart({
  tokensData = [],
  tripleAnalysis = {},
  chartProcessedData = {},
  activeChartHorizon = 'day',
  chartUniverse = 'MONTH_SCORE',
  selectedSoloToken,
  setSelectedSoloToken,
  onClose,
  dailyCgData = {},
  dailyMarketCaps = {},
  livePricesRef
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
  const refHhLineSeriesRef = useRef(null);
  const refImpactLineSeriesRef = useRef(null);
  const refApproachLineSeriesRef = useRef(null);

  const [hhChartHeight, setHhChartHeight] = useState(420);
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const [highlightedToken, setHighlightedToken] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [filterMode, setFilterMode] = useState('HITTING'); // 'HITTING' (Walla kay-dreb l-HH <= -3.5%), 'BREAKOUT' (>= 0%), 'APPROACH' (<= -7%), 'ALL_DIP'
  const [viewMode, setViewMode] = useState('DISTANCE'); // 'DISTANCE' (0% = Sommet) ou 'POINTS_30D' (Points réels)

  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(420);
  const hasFittedRef = useRef(false);
  const prevSymbolsRef = useRef('');

  // 1. Détection et extraction de l'ensemble des candidats HH des 30 jours selon la règle exacte :
  // - Akbar niveau wsal lih token (prix le plus haut)
  // - Hbat 3la la9al b -2%
  // - Rje3 l dak l-higher niveau (kay-dreb l-HH)
  const allHhCandidates = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    const tokenMonthCurvesMap = chartProcessedData?.tokenMonthCurvesMap || {};
    const tokenMonthBasePricesMap = chartProcessedData?.tokenMonthBasePricesMap || {};

    return list.filter(t => {
      const sym = t.cleanSymbol;
      if (!sym || sym === 'BTC' || sym === 'ETH') return false;
      const curve = tokenMonthCurvesMap[sym];
      return curve && curve.length > 0;
    }).map((t, idx) => {
      const sym = t.cleanSymbol;
      const hhLevel = t.hhLevel > 0 ? t.hhLevel : t.high30d;
      const hhPullbackPct = t.hhPullbackPct || 0;
      const hasValidDip = hhPullbackPct <= -2.0 && hhLevel > 0;
      const livePrice = livePricesRef?.current?.[sym] || t.price;
      const liveDistToHH = hhLevel > 0 ? parseFloat((((livePrice - hhLevel) / hhLevel) * 100).toFixed(2)) : -999;

      // "Walla yadrab l-HH" : Hbat b -2% o rje3 kay-dreb l-HH (proche de 0%)
      const isHittingHH = hasValidDip && liveDistToHH >= -3.5;
      const isBreakout = hasValidDip && liveDistToHH >= 0.0;
      const isApproaching = hasValidDip && liveDistToHH >= -7.0;

      const curveMonth = tokenMonthCurvesMap[sym] || [];
      const basePriceMonth = tokenMonthBasePricesMap[sym] || t.price;

      // Courbe normalisée en distance par rapport au HH cible (0% = Akbar Niveau)
      const distCurve = curveMonth.map(pt => {
        const pAtTime = basePriceMonth > 0 ? basePriceMonth * (1 + pt.value / 100) : hhLevel;
        const dist = hhLevel > 0 ? ((pAtTime - hhLevel) / hhLevel) * 100 : 0;
        return {
          time: pt.time,
          value: parseFloat(dist.toFixed(2))
        };
      });

      return {
        ...t,
        sym,
        rankMonth: t.rankMonth || idx + 1,
        hhLevel,
        hhPullbackPct,
        hasValidDip,
        livePrice,
        liveDistToHH,
        isHittingHH,
        isBreakout,
        isApproaching,
        distCurve,
        curveMonth,
        basePriceMonth
      };
    }).sort((a, b) => b.liveDistToHH - a.liveDistToHH);
  }, [chartUniverse, tripleAnalysis, chartProcessedData, livePricesRef]);

  // Filtrage selon le mode sélectionné
  const hhTokens = useMemo(() => {
    if (filterMode === 'HITTING') {
      // 🎯 Tokens qui ont fait au moins -2% de repli et sont maintenant en train de frapper le HH (≤ -3.5%)
      const f = allHhCandidates.filter(t => t.isHittingHH);
      return f.length > 0 ? f : allHhCandidates.filter(t => t.hasValidDip).slice(0, 5);
    }
    if (filterMode === 'BREAKOUT') {
      // 🚀 Breakouts : ont dépassé le sommet après un repli d'au moins -2%
      const f = allHhCandidates.filter(t => t.isBreakout);
      return f.length > 0 ? f : allHhCandidates.filter(t => t.hasValidDip).slice(0, 3);
    }
    if (filterMode === 'APPROACH') {
      // ⚡ En approche : à moins de -7% du HH
      const f = allHhCandidates.filter(t => t.isApproaching);
      return f.length > 0 ? f : allHhCandidates.filter(t => t.hasValidDip).slice(0, 8);
    }
    // Tous les tokens ayant un sommet valide avec repli >= -2%
    const allWithDip = allHhCandidates.filter(t => t.hasValidDip);
    return allWithDip.length > 0 ? allWithDip.slice(0, 15) : allHhCandidates.slice(0, 15);
  }, [allHhCandidates, filterMode]);

  const hittingCount = allHhCandidates.filter(t => t.isHittingHH).length;
  const breakoutsCount = allHhCandidates.filter(t => t.isBreakout).length;
  const approachingCount = allHhCandidates.filter(t => t.isApproaching).length;
  const allValidCount = allHhCandidates.filter(t => t.hasValidDip).length;

  // Helper zoom avec marge droite native
  const applyComfortableZoom = (targetChart, offset = 35) => {
    if (!targetChart) return;
    try {
      targetChart.timeScale().applyOptions({
        rightOffset: offset,
        fixRightEdge: false,
        fixLeftEdge: false
      });
      targetChart.timeScale().fitContent();
    } catch (_) {}
  };

  // Redimensionnement de hauteur
  const handleMouseDownHeight = (e) => {
    e.preventDefault();
    setIsDraggingHeight(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = hhChartHeight;
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingHeight) return;
      const delta = e.clientY - dragStartYRef.current;
      const newH = Math.max(300, Math.min(800, dragStartHeightRef.current + delta));
      setHhChartHeight(newH);
      if (chartRef.current) {
        chartRef.current.applyOptions({ height: newH });
      }
    };
    const handleMouseUp = () => {
      if (isDraggingHeight) setIsDraggingHeight(false);
    };
    if (isDraggingHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingHeight]);

  const effectiveHeight = isFullscreen ? (typeof window !== 'undefined' ? window.innerHeight - 150 : 600) : hhChartHeight;

  // Initialisation du canvas Lightweight Charts
  useEffect(() => {
    if (!containerRef.current) return;
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch (_) {}
      chartRef.current = null;
      seriesMapRef.current = {};
    }

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: effectiveHeight,
      layout: {
        background: { color: '#040711' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.10 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        fixRightEdge: false,
        fixLeftEdge: false
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(250, 204, 21, 0.35)', width: 1, style: 2 },
        horzLine: { color: 'rgba(250, 204, 21, 0.35)', width: 1, style: 2 },
      }
    });

    chartRef.current = chart;

    refHhLineSeriesRef.current = chart.addLineSeries({
      color: '#facc15',
      lineWidth: 2.5,
      lineStyle: 0,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '👑 SOMMET HH (0.00%)'
    });

    refImpactLineSeriesRef.current = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 1.5,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '🔥 ZONE IMPACT (-3.00%)'
    });

    refApproachLineSeriesRef.current = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 1.5,
      lineStyle: 3,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '⚡ APPROCHE (-6.00%)'
    });

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: effectiveHeight
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
        seriesMapRef.current = {};
      }
    };
  }, [effectiveHeight]);

  // Synchronisation des Séries & Courbes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !hhTokens) return;

    const timestamps = chartProcessedData?.monthHorizonTimestamps || [];

    if (viewMode === 'DISTANCE') {
      if (refHhLineSeriesRef.current && timestamps.length > 0) {
        refHhLineSeriesRef.current.applyOptions({ title: '👑 SOMMET HH (0.00%)' });
        refHhLineSeriesRef.current.setData(timestamps.map(t => ({ time: t, value: 0 })));
      }
      if (refImpactLineSeriesRef.current && timestamps.length > 0) {
        refImpactLineSeriesRef.current.applyOptions({ title: '🔥 IMPACT (-3.00%)' });
        refImpactLineSeriesRef.current.setData(timestamps.map(t => ({ time: t, value: -3.0 })));
      }
      if (refApproachLineSeriesRef.current && timestamps.length > 0) {
        refApproachLineSeriesRef.current.applyOptions({ title: '⚡ APPROCHE (-6.00%)' });
        refApproachLineSeriesRef.current.setData(timestamps.map(t => ({ time: t, value: -6.0 })));
      }
    } else {
      if (refHhLineSeriesRef.current) refHhLineSeriesRef.current.setData([]);
      if (refImpactLineSeriesRef.current) refImpactLineSeriesRef.current.setData([]);
      if (refApproachLineSeriesRef.current) refApproachLineSeriesRef.current.setData([]);
    }

    const currentSymbols = new Set(hhTokens.map(t => t.cleanSymbol));
    Object.keys(seriesMapRef.current).forEach(sym => {
      if (!currentSymbols.has(sym)) {
        try {
          chart.removeSeries(seriesMapRef.current[sym]);
          delete seriesMapRef.current[sym];
        } catch (_) {}
      }
    });

    hhTokens.forEach((item, idx) => {
      const fixedColor = getTokenFixedColor(item.cleanSymbol);
      const isSolo = highlightedToken === item.cleanSymbol || selectedSoloToken?.cleanSymbol === item.cleanSymbol;
      const rankNum = item.rankMonth || idx + 1;
      const statusIcon = item.isBreakout ? '🚀' : item.isAttacking ? '🔥' : '⚡';
      const title = `#${rankNum} ${item.cleanSymbol} (${item.liveDistToHH >= 0 ? '+' : ''}${item.liveDistToHH}% ${statusIcon})`;

      let lineColor = fixedColor;
      let lineWidth = 2.5;
      let lastValVisible = true;

      if (highlightedToken) {
        if (isSolo) {
          lineColor = fixedColor;
          lineWidth = 4.5;
          lastValVisible = true;
        } else {
          lineColor = 'rgba(148, 163, 184, 0.16)';
          lineWidth = 1.0;
          lastValVisible = false;
        }
      }

      let lineSeries = seriesMapRef.current[item.cleanSymbol];
      if (!lineSeries) {
        lineSeries = chart.addLineSeries({
          color: lineColor,
          lineWidth: lineWidth,
          lineStyle: 0,
          title: isSolo || !highlightedToken ? title : '',
          priceLineVisible: false,
          lastValueVisible: lastValVisible,
        });
        seriesMapRef.current[item.cleanSymbol] = lineSeries;
      } else {
        lineSeries.applyOptions({
          color: lineColor,
          lineWidth: lineWidth,
          title: isSolo || !highlightedToken ? title : '',
          lastValueVisible: lastValVisible
        });
      }

      const curve = viewMode === 'DISTANCE' ? item.distCurve : item.curveMonth;
      if (curve && curve.length > 0) {
        lineSeries.setData(curve);
      }
    });

    const currentKey = hhTokens.map(t => t.cleanSymbol).sort().join(',') + '_' + viewMode;
    const shouldFit = !hasFittedRef.current || (prevSymbolsRef.current !== '' && prevSymbolsRef.current !== currentKey);
    if (shouldFit && hhTokens.length > 0) {
      applyComfortableZoom(chart, 35);
      hasFittedRef.current = true;
    }
    prevSymbolsRef.current = currentKey;
  }, [hhTokens, viewMode, highlightedToken, selectedSoloToken, chartProcessedData]);

  // Moteur Live 15m haute fréquence
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !hhTokens || hhTokens.length === 0) return;

    const intervalId = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const activeCandleTime = Math.floor(nowSec / 900) * 900;

      hhTokens.forEach(item => {
        const sym = item.cleanSymbol;
        const livePrice = livePricesRef?.current?.[sym];
        if (livePrice && livePrice > 0) {
          const lineSeries = seriesMapRef.current[sym];
          if (lineSeries) {
            const targetHH = item.hhLevel || item.high30d;
            let val = 0;
            if (viewMode === 'DISTANCE') {
              val = targetHH > 0 ? parseFloat((((livePrice - targetHH) / targetHH) * 100).toFixed(2)) : 0;
            } else {
              const basePriceMonth = item.basePriceMonth;
              val = basePriceMonth > 0 ? parseFloat((((livePrice - basePriceMonth) / basePriceMonth) * 100).toFixed(2)) : 0;
            }

            const curve = viewMode === 'DISTANCE' ? item.distCurve : item.curveMonth;
            const lastCandleTime = (curve && curve.length > 0) ? curve[curve.length - 1].time : activeCandleTime;
            const targetTime = Math.max(lastCandleTime, activeCandleTime);
            try {
              lineSeries.update({
                time: targetTime,
                value: val
              });
            } catch (_) {}
          }
        }
      });
    }, 500);

    return () => clearInterval(intervalId);
  }, [hhTokens, viewMode, livePricesRef]);

  const handleResetZoom = () => {
    if (chartRef.current) {
      applyComfortableZoom(chartRef.current, 35);
    }
  };

  return (
    <div style={{
      marginTop: isFullscreen ? 0 : '14px',
      background: '#040711',
      border: isFullscreen ? 'none' : '1px solid rgba(250, 204, 21, 0.25)',
      borderRadius: isFullscreen ? 0 : '12px',
      padding: isFullscreen ? '14px 18px 10px 18px' : '12px 14px 8px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      position: isFullscreen ? 'fixed' : 'relative',
      top: isFullscreen ? 0 : 'auto',
      left: isFullscreen ? 0 : 'auto',
      right: isFullscreen ? 0 : 'auto',
      bottom: isFullscreen ? 0 : 'auto',
      width: isFullscreen ? '100vw' : '100%',
      height: isFullscreen ? '100vh' : 'auto',
      zIndex: isFullscreen ? 99999 : 1,
      overflow: isFullscreen ? 'hidden' : 'visible',
      boxShadow: isFullscreen ? '0 0 50px rgba(0, 0, 0, 0.95)' : '0 4px 20px rgba(0, 0, 0, 0.4)'
    }}>
      {/* 🟢 EN-TÊTE DU RADAR HIGHER HIGH */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        paddingBottom: '8px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        {/* Titre & Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(245, 158, 11, 0.08))',
            border: '1px solid rgba(250, 204, 21, 0.4)',
            padding: '5px 12px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Crown size={15} style={{ color: '#facc15' }} />
            <span style={{
              color: '#fef08a',
              fontSize: '0.82rem',
              fontWeight: '900',
              letterSpacing: '0.4px'
            }}>
              RADAR HIGHER HIGH 30D
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            padding: '4px 10px',
            borderRadius: '5px',
            fontSize: '0.72rem',
            color: '#94a3b8'
          }}>
            <span>Akbar Niveau: <strong style={{ color: '#facc15' }}>0.00% (HH)</strong></span>
            <span style={{ color: '#475569' }}>•</span>
            <span style={{ color: '#94a3b8' }}>Repli min: <strong style={{ color: '#fbbf24' }}>-2.0%</strong></span>
            <span style={{ color: '#475569' }}>•</span>
            <span style={{ color: hittingCount > 0 ? '#4ade80' : '#94a3b8' }}>
              <strong>{hittingCount}</strong> kay-darbo l-HH 🎯
            </span>
            <span style={{ color: '#475569' }}>•</span>
            <span style={{ color: breakoutsCount > 0 ? '#38bdf8' : '#94a3b8' }}>
              <strong>{breakoutsCount}</strong> Breakouts 🚀
            </span>
            <span style={{ color: '#475569' }}>•</span>
            <span style={{ color: '#cbd5e1' }}>
              <strong>{allValidCount}</strong> avec repli ≥ -2%
            </span>
          </div>
        </div>

        {/* Contrôles : Filtres, Modes, Reset, Plein Écran */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Filtres de seuil */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '2px',
            borderRadius: '6px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            <button
              onClick={() => setFilterMode('HITTING')}
              style={{
                background: filterMode === 'HITTING' ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
                color: filterMode === 'HITTING' ? '#4ade80' : '#64748b',
                border: filterMode === 'HITTING' ? '1px solid rgba(74, 222, 128, 0.4)' : '1px solid transparent',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.68rem',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="Tokens li hbtat 3la la9al b -2% o rj3at kat-dreb l-HH (≤ -3.5%)"
            >
              🎯 YADRAB L-HH ({hittingCount})
            </button>
            <button
              onClick={() => setFilterMode('BREAKOUT')}
              style={{
                background: filterMode === 'BREAKOUT' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: filterMode === 'BREAKOUT' ? '#38bdf8' : '#64748b',
                border: filterMode === 'BREAKOUT' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.68rem',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="Tokens li fatat l-HH (≥ 0%) b3d ma hbtat b -2%"
            >
              🚀 BREAKOUT ({breakoutsCount})
            </button>
            <button
              onClick={() => setFilterMode('APPROACH')}
              style={{
                background: filterMode === 'APPROACH' ? 'rgba(250, 204, 21, 0.2)' : 'transparent',
                color: filterMode === 'APPROACH' ? '#facc15' : '#64748b',
                border: filterMode === 'APPROACH' ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid transparent',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.68rem',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="Tokens li hbtat b -2% o 9riba trje3 l-HH (≤ -7%)"
            >
              ⚡ EN APPROCHE ({approachingCount})
            </button>
            <button
              onClick={() => setFilterMode('ALL_DIP')}
              style={{
                background: filterMode === 'ALL_DIP' ? 'rgba(168, 85, 247, 0.2)' : 'transparent',
                color: filterMode === 'ALL_DIP' ? '#c084fc' : '#64748b',
                border: filterMode === 'ALL_DIP' ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.68rem',
                fontWeight: '800',
                cursor: 'pointer'
              }}
              title="Tous les tokens li 3ndhom akbar niveau o hbtat mnno b -2%"
            >
              🌟 TOUS ({allValidCount})
            </button>
          </div>

          {/* Sélecteur de mode de vue */}
          <button
            onClick={() => setViewMode(viewMode === 'DISTANCE' ? 'POINTS_30D' : 'DISTANCE')}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              color: '#e2e8f0',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '0.68rem',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
            title="Bascule entre la vue normalisée relative au sommet (0%) et la vue classique en points 30D"
          >
            <Target size={12} style={{ color: '#facc15' }} />
            <span>{viewMode === 'DISTANCE' ? 'MODE : DISTANCE AU HH (0%)' : 'MODE : POINTS 30D RÉELS'}</span>
          </button>

          {/* Reset Zoom */}
          <button
            onClick={handleResetZoom}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Réinitialiser le zoom"
          >
            <RotateCcw size={11} />
            <span>RESET ZOOM</span>
          </button>

          {/* Plein Écran */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            style={{
              background: isFullscreen ? 'rgba(250, 204, 21, 0.15)' : 'rgba(255, 255, 255, 0.04)',
              color: isFullscreen ? '#facc15' : '#94a3b8',
              border: isFullscreen ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          >
            {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            <span>{isFullscreen ? 'RÉDUIRE' : 'PLEIN ÉCRAN'}</span>
          </button>

          {/* Fermer */}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.68rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Fermer cette charte"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* 🏷️ BANDEAU DES PILLS DES TOKENS EN RETEST HH */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        overflowX: 'auto',
        padding: '3px 0 5px 0',
        scrollbarWidth: 'thin'
      }}>
        <button
          onClick={() => {
            setHighlightedToken(null);
            if (setSelectedSoloToken) setSelectedSoloToken(null);
          }}
          style={{
            background: !highlightedToken ? 'rgba(250, 204, 21, 0.15)' : 'rgba(255, 255, 255, 0.03)',
            color: !highlightedToken ? '#facc15' : '#64748b',
            border: !highlightedToken ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
            padding: '4px 10px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            fontWeight: '800',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          ◈ TOUS ({hhTokens.length})
        </button>

        {hhTokens.map((t) => {
          const isSelected = highlightedToken === t.cleanSymbol || selectedSoloToken?.cleanSymbol === t.cleanSymbol;
          const color = getTokenFixedColor(t.cleanSymbol);
          const isPos = t.liveDistToHH >= 0;
          const isNear = t.liveDistToHH >= -3.5;

          return (
            <button
              key={t.cleanSymbol}
              onClick={() => {
                const next = isSelected ? null : t.cleanSymbol;
                setHighlightedToken(next);
                if (setSelectedSoloToken) setSelectedSoloToken(isSelected ? null : t);
              }}
              style={{
                background: isSelected ? 'rgba(250, 204, 21, 0.18)' : 'rgba(255, 255, 255, 0.02)',
                color: isSelected ? '#ffffff' : '#94a3b8',
                border: isSelected ? `1.5px solid ${color}` : (t.isHittingHH ? '1px solid rgba(74, 222, 128, 0.45)' : '1px solid rgba(255, 255, 255, 0.06)'),
                padding: '3px 8px',
                borderRadius: '5px',
                fontSize: '0.68rem',
                fontWeight: isSelected ? '900' : '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                whiteSpace: 'nowrap',
                transition: 'all 0.12s ease'
              }}
              title={`Prix actuel: $${t.livePrice} | Akbar niveau (HH): $${t.hhLevel} | Hbat mnno b: ${t.hhPullbackPct}% | Écart daba: ${t.liveDistToHH}%`}
            >
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
              <span style={{ color: isSelected ? '#ffffff' : '#cbd5e1' }}>#{t.rankMonth} {t.cleanSymbol}</span>
              <span style={{
                color: isPos ? '#4ade80' : isNear ? '#38bdf8' : '#a855f7',
                fontWeight: '900',
                fontSize: '0.65rem'
              }}>
                {isPos ? `+${t.liveDistToHH}% 🚀` : `${t.liveDistToHH}% ${isNear ? '🎯' : '⚡'}`}
              </span>

              {/* Badge Repli -2% & Rje3 */}
              <span style={{
                background: isNear ? 'rgba(74, 222, 128, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                color: isNear ? '#4ade80' : '#94a3b8',
                border: isNear ? '1px solid rgba(74, 222, 128, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '1px 4px',
                borderRadius: '3px',
                fontSize: '0.60rem',
                fontWeight: '800'
              }}>
                Hbat {t.hhPullbackPct}% ⮌
              </span>
            </button>
          );
        })}
      </div>

      {/* 📊 CANVAS DE LA CHARTE */}
      <div style={{ position: 'relative', width: '100%', height: `${effectiveHeight}px`, borderRadius: '8px', overflow: 'hidden' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Badge explicatif du mode distance */}
        {viewMode === 'DISTANCE' && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '12px',
            background: 'rgba(4, 7, 17, 0.75)',
            border: '1px solid rgba(250, 204, 21, 0.25)',
            padding: '4px 10px',
            borderRadius: '5px',
            fontSize: '0.66rem',
            color: '#facc15',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span>👑 <strong>Ligne 0.00% = Sommet 30D (HH)</strong></span>
            <span style={{ color: '#64748b' }}>|</span>
            <span style={{ color: '#38bdf8' }}>Zone d'impact: &gt; -3.00%</span>
            <span style={{ color: '#64748b' }}>|</span>
            <span style={{ color: '#4ade80' }}>&gt; 0.00% = Breakout Ath 🚀</span>
          </div>
        )}
      </div>

      {/* ↕️ BARRE DE REDIMENSIONNEMENT DE HAUTEUR */}
      {!isFullscreen && (
        <div
          onMouseDown={handleMouseDownHeight}
          style={{
            width: '100%',
            height: '18px',
            background: isDraggingHeight ? 'rgba(250, 204, 21, 0.25)' : 'rgba(255, 255, 255, 0.02)',
            borderTop: isDraggingHeight ? '1.5px solid #facc15' : '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '0 0 8px 8px',
            cursor: 'row-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            userSelect: 'none',
            transition: 'background 0.15s ease'
          }}
          title="Glisser vers le haut ou le bas pour ajuster la hauteur"
        >
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#facc15' : '#475569', borderRadius: '1px' }} />
          <span style={{ color: isDraggingHeight ? '#facc15' : '#64748b', fontSize: '0.64rem', fontWeight: '700' }}>
            ↕ HAUTEUR ({hhChartHeight}px)
          </span>
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#facc15' : '#475569', borderRadius: '1px' }} />
        </div>
      )}
    </div>
  );
}


// ========================================================================================
// 👑 COMPOSANT DÉDIÉ (STANDALONE) : TOP 5 DU MOIS — VUE DUO CÔTE À CÔTE (24H vs 30 JOURS)
// ========================================================================================
export function MonthlyTop5DualChart({
  tokensData = [],
  tripleAnalysis = {},
  chartProcessedData = {},
  chartUniverse = 'MONTH_SCORE',
  selectedSoloToken,
  setSelectedSoloToken,
  onClose,
  livePricesRef
}) {
  const container24hRef = useRef(null);
  const container30dRef = useRef(null);
  const splitContainerRef = useRef(null);

  const chart24hRef = useRef(null);
  const chart30dRef = useRef(null);

  const series24hMapRef = useRef({});
  const series30dMapRef = useRef({});
  const zeroLine24hRef = useRef(null);
  const zeroLine30dRef = useRef(null);

  const [dualChartHeight, setDualChartHeight] = useState(420);
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50); // % pour la charte 24H (gauche)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [highlightedToken, setHighlightedToken] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(420);
  const dragStartXRef = useRef(0);
  const dragStartSplitRef = useRef(50);
  const hasFitted24hRef = useRef(false);
  const hasFitted30dRef = useRef(false);

  // 1. Extraction stricte du Top 5 du mois (sans BTC et sans ETH)
  const top5Tokens = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || tokensData || [];
    const valid = list.filter(t => {
      const sym = t.cleanSymbol;
      return sym && sym !== 'BTC' && sym !== 'ETH';
    });

    return valid.slice(0, 5).map((t, idx) => {
      const sym = t.cleanSymbol;
      const livePrice = (livePricesRef?.current?.[sym]) || t.price;
      const p24 = typeof t.p1d === 'number' ? t.p1d : 0;
      const p30 = typeof t.p30d === 'number' ? t.p30d : 0;
      const color = getTokenFixedColor(sym);
      const scoreMonth = t.scoreMonth || 0;
      const rankMonth = t.rankMonth || idx + 1;

      return {
        ...t,
        sym,
        rankMonth,
        livePrice,
        p24,
        p30,
        scoreMonth,
        fixedColor: color
      };
    });
  }, [tripleAnalysis, tokensData, chartUniverse, livePricesRef]);

  // Synchronisation avec selectedSoloToken externe
  useEffect(() => {
    if (selectedSoloToken && selectedSoloToken.cleanSymbol) {
      const existsInTop5 = top5Tokens.some(t => t.cleanSymbol === selectedSoloToken.cleanSymbol);
      if (existsInTop5) {
        setHighlightedToken(selectedSoloToken.cleanSymbol);
      }
    }
  }, [selectedSoloToken, top5Tokens]);

  const effectiveHeight = isFullscreen ? (typeof window !== 'undefined' ? window.innerHeight - 155 : 620) : dualChartHeight;

  // Zoom confortable avec marge droite native
  const applyComfortableZoom = (targetChart, offset = 35) => {
    if (!targetChart) return;
    try {
      targetChart.timeScale().applyOptions({
        rightOffset: offset,
        fixRightEdge: false,
        fixLeftEdge: false
      });
      targetChart.timeScale().fitContent();
    } catch (_) {}
  };

  const handleResetZoom = () => {
    applyComfortableZoom(chart24hRef.current, 35);
    applyComfortableZoom(chart30dRef.current, 35);
  };

  // Fermer le plein écran avec la touche Échap
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // ↕️ Redimensionnement interactif de la hauteur
  const handleMouseDownHeight = (e) => {
    setIsDraggingHeight(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = dualChartHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingHeight) return;
      const delta = e.clientY - dragStartYRef.current;
      const newH = Math.max(300, Math.min(850, dragStartHeightRef.current + delta));
      setDualChartHeight(newH);
      if (chart24hRef.current) chart24hRef.current.applyOptions({ height: newH });
      if (chart30dRef.current) chart30dRef.current.applyOptions({ height: newH });
    };

    const handleMouseUp = () => {
      if (isDraggingHeight) {
        setIsDraggingHeight(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };

    if (isDraggingHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingHeight]);

  // ↔️ Redimensionnement interactif du séparateur de largeur Split Ratio
  const handleMouseDownSplit = (e) => {
    setIsDraggingSplit(true);
    dragStartXRef.current = e.clientX;
    dragStartSplitRef.current = splitRatio;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingSplit) return;
      if (!splitContainerRef.current) return;
      const containerWidth = splitContainerRef.current.clientWidth;
      if (containerWidth <= 0) return;
      const deltaX = e.clientX - dragStartXRef.current;
      const deltaRatio = (deltaX / containerWidth) * 100;
      const newRatio = Math.max(20, Math.min(80, Math.round(dragStartSplitRef.current + deltaRatio)));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      if (isDraggingSplit) {
        setIsDraggingSplit(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };

    if (isDraggingSplit) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit]);

  // 🔄 Redimensionnement automatique des 2 canvas
  useEffect(() => {
    const handleResize = () => {
      if (container24hRef.current && chart24hRef.current) {
        chart24hRef.current.applyOptions({
          width: container24hRef.current.clientWidth,
          height: effectiveHeight
        });
        applyComfortableZoom(chart24hRef.current, 35);
      }
      if (container30dRef.current && chart30dRef.current) {
        chart30dRef.current.applyOptions({
          width: container30dRef.current.clientWidth,
          height: effectiveHeight
        });
        applyComfortableZoom(chart30dRef.current, 35);
      }
    };

    handleResize();
    const t = setTimeout(handleResize, 60);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && splitContainerRef.current) {
      ro = new ResizeObserver(() => {
        handleResize();
      });
      ro.observe(splitContainerRef.current);
    }

    return () => {
      clearTimeout(t);
      if (ro) ro.disconnect();
    };
  }, [splitRatio, isFullscreen, effectiveHeight]);

  // ========================================================================
  // ⚡ 2. INITIALISATION CHARTE GAUCHE (24 HEURES)
  // ========================================================================
  useEffect(() => {
    if (!container24hRef.current) return;
    if (chart24hRef.current) {
      try { chart24hRef.current.remove(); } catch (_) {}
      chart24hRef.current = null;
      series24hMapRef.current = {};
    }

    const container = container24hRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 500,
      height: effectiveHeight,
      layout: {
        background: { color: '#040711' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.10 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        fixRightEdge: false,
        fixLeftEdge: false
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(250, 204, 21, 0.25)', width: 1, style: 2 },
        horzLine: { color: 'rgba(250, 204, 21, 0.25)', width: 1, style: 2 },
      }
    });

    zeroLine24hRef.current = chart.addLineSeries({
      color: 'rgba(148, 163, 184, 0.40)',
      lineWidth: 1,
      lineStyle: 2, // Tirets
      priceLineVisible: false,
      lastValueVisible: true,
      title: '0% (24H)'
    });

    chart24hRef.current = chart;

    return () => {
      if (chart24hRef.current) {
        try { chart24hRef.current.remove(); } catch (_) {}
        chart24hRef.current = null;
        series24hMapRef.current = {};
      }
    };
  }, []);

  // ========================================================================
  // 🏛️ 3. INITIALISATION CHARTE DROITE (30 JOURS)
  // ========================================================================
  useEffect(() => {
    if (!container30dRef.current) return;
    if (chart30dRef.current) {
      try { chart30dRef.current.remove(); } catch (_) {}
      chart30dRef.current = null;
      series30dMapRef.current = {};
    }

    const container = container30dRef.current;
    const chart = createChart(container, {
      width: container.clientWidth || 500,
      height: effectiveHeight,
      layout: {
        background: { color: '#040711' },
        textColor: '#64748b',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace'
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.10 },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 35,
        fixRightEdge: false,
        fixLeftEdge: false
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(168, 85, 247, 0.25)', width: 1, style: 2 },
        horzLine: { color: 'rgba(168, 85, 247, 0.25)', width: 1, style: 2 },
      }
    });

    zeroLine30dRef.current = chart.addLineSeries({
      color: 'rgba(148, 163, 184, 0.40)',
      lineWidth: 1,
      lineStyle: 2, // Tirets
      priceLineVisible: false,
      lastValueVisible: true,
      title: '0% (30J)'
    });

    chart30dRef.current = chart;

    return () => {
      if (chart30dRef.current) {
        try { chart30dRef.current.remove(); } catch (_) {}
        chart30dRef.current = null;
        series30dMapRef.current = {};
      }
    };
  }, []);

  // ========================================================================
  // 📈 4. MISE À JOUR SYNCHRONISÉE DES COURBES DU TOP 5 SUR LES 2 GRAPHES
  // ========================================================================
  useEffect(() => {
    const c24 = chart24hRef.current;
    const c30 = chart30dRef.current;
    if (!c24 || !c30 || !top5Tokens || top5Tokens.length === 0) return;

    const currentSyms = new Set(top5Tokens.map(t => t.cleanSymbol));

    // Nettoyage séries orphelines
    Object.keys(series24hMapRef.current).forEach(sym => {
      if (!currentSyms.has(sym)) {
        try {
          c24.removeSeries(series24hMapRef.current[sym]);
          delete series24hMapRef.current[sym];
        } catch (_) {}
      }
    });
    Object.keys(series30dMapRef.current).forEach(sym => {
      if (!currentSyms.has(sym)) {
        try {
          c30.removeSeries(series30dMapRef.current[sym]);
          delete series30dMapRef.current[sym];
        } catch (_) {}
      }
    });

    let all24hTimestamps = [];
    let all30dTimestamps = [];

    top5Tokens.forEach((item, idx) => {
      const sym = item.cleanSymbol;
      const fixedColor = item.fixedColor;
      const isSolo = highlightedToken === sym || selectedSoloToken?.cleanSymbol === sym;
      const rankNum = item.rankMonth || idx + 1;

      // Styling Focus Solo : le token isolé ressort net et épais (3.8px), les 4 autres s'estompent
      let lineColor = fixedColor;
      let lineWidth = 2.5;
      let lastValVisible = true;

      if (highlightedToken) {
        if (isSolo) {
          lineColor = fixedColor;
          lineWidth = 4.2;
          lastValVisible = true;
        } else {
          lineColor = 'rgba(148, 163, 184, 0.14)';
          lineWidth = 1.0;
          lastValVisible = false;
        }
      }

      // --- A. MISE À JOUR SÉRIE 24 HEURES (GAUCHE) ---
      const title24 = `#${rankNum} ${sym} (${item.p24 >= 0 ? '+' : ''}${item.p24?.toFixed(1)}%)`;
      let s24 = series24hMapRef.current[sym];
      if (!s24) {
        s24 = c24.addLineSeries({
          color: lineColor,
          lineWidth: lineWidth,
          lineStyle: 0,
          title: isSolo || !highlightedToken ? title24 : '',
          priceLineVisible: false,
          lastValueVisible: lastValVisible,
        });
        series24hMapRef.current[sym] = s24;
      } else {
        s24.applyOptions({
          color: lineColor,
          lineWidth: lineWidth,
          title: isSolo || !highlightedToken ? title24 : '',
          lastValueVisible: lastValVisible
        });
      }

      // Récupération de la courbe 24h
      let curve24 = item.chartCurve24h || [];
      if (!curve24 || curve24.length === 0) {
        // Fallback depuis klines
        const klines = item.rawKlines || [];
        const tLen = klines.length;
        const offset = Math.min(95, tLen - 1);
        const baseP = tLen > 0 ? parseFloat(klines[tLen - 1 - offset][4]) : 0;
        if (baseP > 0) {
          curve24 = [];
          for (let b = tLen - 1 - offset; b < tLen; b++) {
            const tTime = Math.floor(parseInt(klines[b][0]) / 1000);
            const closeP = parseFloat(klines[b][4]);
            const val = ((closeP - baseP) / baseP) * 100;
            curve24.push({ time: tTime, value: parseFloat(val.toFixed(2)) });
          }
        }
      }

      if (curve24 && curve24.length > 0) {
        s24.setData(curve24);
        if (curve24.length > all24hTimestamps.length) {
          all24hTimestamps = curve24.map(pt => pt.time);
        }
      }

      // --- B. MISE À JOUR SÉRIE 30 JOURS (DROITE) ---
      const title30 = `#${rankNum} ${sym} (${item.p30 >= 0 ? '+' : ''}${item.p30?.toFixed(1)}%)`;
      let s30 = series30dMapRef.current[sym];
      if (!s30) {
        s30 = c30.addLineSeries({
          color: lineColor,
          lineWidth: lineWidth,
          lineStyle: 0,
          title: isSolo || !highlightedToken ? title30 : '',
          priceLineVisible: false,
          lastValueVisible: lastValVisible,
        });
        series30dMapRef.current[sym] = s30;
      } else {
        s30.applyOptions({
          color: lineColor,
          lineWidth: lineWidth,
          title: isSolo || !highlightedToken ? title30 : '',
          lastValueVisible: lastValVisible
        });
      }

      // Récupération de la courbe 30 jours
      const curve30 = chartProcessedData?.tokenMonthCurvesMap?.[sym] || [];
      if (curve30 && curve30.length > 0) {
        s30.setData(curve30);
        if (curve30.length > all30dTimestamps.length) {
          all30dTimestamps = curve30.map(pt => pt.time);
        }
      }
    });

    // Tracer les lignes neutres zéro (0.00%)
    if (zeroLine24hRef.current && all24hTimestamps.length > 0) {
      zeroLine24hRef.current.setData(all24hTimestamps.map(t => ({ time: t, value: 0 })));
    }
    if (zeroLine30dRef.current && all30dTimestamps.length > 0) {
      zeroLine30dRef.current.setData(all30dTimestamps.map(t => ({ time: t, value: 0 })));
    }

    // Ajustement de zoom initial
    if (!hasFitted24hRef.current && all24hTimestamps.length > 0) {
      applyComfortableZoom(c24, 35);
      hasFitted24hRef.current = true;
    }
    if (!hasFitted30dRef.current && all30dTimestamps.length > 0) {
      applyComfortableZoom(c30, 35);
      hasFitted30dRef.current = true;
    }
  }, [top5Tokens, highlightedToken, selectedSoloToken, chartProcessedData]);

  // ========================================================================
  // ⚡ 5. MOTEUR LIVE 500MS HAUTE FRÉQUENCE (Ticks temps réel sur les 2 graphes)
  // ========================================================================
  useEffect(() => {
    const c24 = chart24hRef.current;
    const c30 = chart30dRef.current;
    if (!c24 || !c30 || !top5Tokens || top5Tokens.length === 0) return;

    const intervalId = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const activeCandleTime = Math.floor(nowSec / 900) * 900;

      top5Tokens.forEach(item => {
        const sym = item.cleanSymbol;
        const livePrice = livePricesRef?.current?.[sym];
        if (!livePrice || livePrice <= 0) return;

        // Mise à jour point 24H
        const s24 = series24hMapRef.current[sym];
        if (s24) {
          const klines = item.rawKlines || [];
          const tLen = klines.length;
          const offset = Math.min(95, tLen - 1);
          const baseP24 = tLen > 0 ? parseFloat(klines[tLen - 1 - offset][4]) : 0;
          if (baseP24 > 0) {
            const val24 = parseFloat((((livePrice - baseP24) / baseP24) * 100).toFixed(2));
            const curve24 = item.chartCurve24h;
            const lastT = (curve24 && curve24.length > 0) ? curve24[curve24.length - 1].time : activeCandleTime;
            try {
              s24.update({ time: Math.max(lastT, activeCandleTime), value: val24 });
            } catch (_) {}
          }
        }

        // Mise à jour point 30J
        const s30 = series30dMapRef.current[sym];
        if (s30) {
          const baseP30 = chartProcessedData?.tokenMonthBasePricesMap?.[sym];
          if (baseP30 > 0) {
            const val30 = parseFloat((((livePrice - baseP30) / baseP30) * 100).toFixed(2));
            const curve30 = chartProcessedData?.tokenMonthCurvesMap?.[sym];
            const lastT = (curve30 && curve30.length > 0) ? curve30[curve30.length - 1].time : activeCandleTime;
            try {
              s30.update({ time: Math.max(lastT, activeCandleTime), value: val30 });
            } catch (_) {}
          }
        }
      });
    }, 500);

    return () => clearInterval(intervalId);
  }, [top5Tokens, chartProcessedData, livePricesRef]);

  // Handler clic pilule token
  const handleToggleSolo = (sym) => {
    if (highlightedToken === sym) {
      setHighlightedToken(null);
      if (setSelectedSoloToken) setSelectedSoloToken(null);
    } else {
      setHighlightedToken(sym);
      const fullToken = top5Tokens.find(t => t.cleanSymbol === sym);
      if (setSelectedSoloToken && fullToken) setSelectedSoloToken(fullToken);
    }
  };

  return (
    <div style={{
      background: '#040711',
      border: '1px solid rgba(168, 85, 247, 0.35)',
      borderRadius: '12px',
      padding: isFullscreen ? '16px' : '14px',
      marginBottom: '20px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.55)',
      position: isFullscreen ? 'fixed' : 'relative',
      top: isFullscreen ? 0 : 'auto',
      left: isFullscreen ? 0 : 'auto',
      right: isFullscreen ? 0 : 'auto',
      bottom: isFullscreen ? 0 : 'auto',
      width: isFullscreen ? '100vw' : '100%',
      height: isFullscreen ? '100vh' : 'auto',
      zIndex: isFullscreen ? 9999 : 20,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      boxSizing: 'border-box'
    }}>
      {/* 👑 HEADER PRINCIPAL DU MODULE TOP 5 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
        borderBottom: '1px solid rgba(168, 85, 247, 0.20)',
        paddingBottom: '10px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(250, 204, 21, 0.2))',
            border: '1px solid rgba(168, 85, 247, 0.5)',
            borderRadius: '8px',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Crown size={18} style={{ color: '#c084fc' }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                color: '#f8fafc',
                fontWeight: '900',
                fontSize: '0.92rem',
                letterSpacing: '0.5px'
              }}>
                👑 TOP 5 DU MOIS — 24H & 30 JOURS CÔTE À CÔTE
              </span>
              <span style={{
                background: 'rgba(168, 85, 247, 0.18)',
                color: '#c084fc',
                border: '1px solid rgba(168, 85, 247, 0.45)',
                padding: '2px 7px',
                borderRadius: '5px',
                fontSize: '0.64rem',
                fontWeight: '800'
              }}>
                LEADERS DU MARCHÉ
              </span>
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.70rem', marginTop: '2px' }}>
              Comparaison simultanée des 5 tokens dominants du mois : <strong>Intra-day (dernières 24h)</strong> à gauche et <strong>Macro Structure (30 jours)</strong> à droite.
            </div>
          </div>
        </div>

        {/* 🛠️ CONTRÔLES : PRÉSÉLECTIONS RATIO, PLEIN ÉCRAN, ZOOM & FERMETURE */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Presets Split Ratio */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '2px 5px',
            borderRadius: '6px'
          }}>
            <span style={{ fontSize: '0.62rem', color: '#64748b', fontWeight: '700', paddingRight: '3px' }}>
              LARGEUR ({splitRatio}% / {100 - splitRatio}%) :
            </span>
            {[
              { label: '35/65', ratio: 35 },
              { label: '50/50', ratio: 50 },
              { label: '65/35', ratio: 65 }
            ].map(p => (
              <button
                key={p.ratio}
                onClick={() => setSplitRatio(p.ratio)}
                style={{
                  background: splitRatio === p.ratio ? 'rgba(168, 85, 247, 0.25)' : 'transparent',
                  color: splitRatio === p.ratio ? '#c084fc' : '#94a3b8',
                  border: splitRatio === p.ratio ? '1px solid #c084fc' : '1px solid transparent',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.62rem',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleResetZoom}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#94a3b8',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 9px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Réinitialiser le zoom des 2 graphes"
          >
            <RotateCcw size={11} /> FIT ZOOM
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            style={{
              background: isFullscreen ? 'rgba(250, 204, 21, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              color: isFullscreen ? '#facc15' : '#94a3b8',
              border: isFullscreen ? '1px solid #facc15' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '4px 9px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title={isFullscreen ? "Quitter le plein écran (Échap)" : "Afficher en plein écran"}
          >
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            {isFullscreen ? 'QUITTER' : 'PLEIN ÉCRAN'}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                color: '#64748b',
                border: '1px solid rgba(255, 255, 255, 0.07)',
                padding: '4px 8px',
                borderRadius: '5px',
                fontSize: '0.68rem',
                cursor: 'pointer'
              }}
              title="Masquer le module Top 5"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* 🏷️ BANDEAU DE SÉLECTION / FOCUS SOLO DES TOKENS DU TOP 5 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        background: 'rgba(0, 0, 0, 0.35)',
        padding: '6px 10px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.05)'
      }}>
        <span style={{ fontSize: '0.66rem', color: '#64748b', fontWeight: '800' }}>
          FOCUS SOLO :
        </span>

        {/* Bouton reset focus */}
        <button
          onClick={() => {
            setHighlightedToken(null);
            if (setSelectedSoloToken) setSelectedSoloToken(null);
          }}
          style={{
            background: !highlightedToken ? 'rgba(168, 85, 247, 0.22)' : 'rgba(255, 255, 255, 0.03)',
            color: !highlightedToken ? '#c084fc' : '#94a3b8',
            border: !highlightedToken ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.08)',
            padding: '3px 8px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            fontWeight: '700',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          🌟 TOUS LES 5
        </button>

        {top5Tokens.map((t, idx) => {
          const isSelected = highlightedToken === t.cleanSymbol;
          return (
            <button
              key={t.cleanSymbol}
              onClick={() => handleToggleSolo(t.cleanSymbol)}
              style={{
                background: isSelected ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                color: isSelected ? '#ffffff' : '#cbd5e1',
                border: isSelected ? `1.5px solid ${t.fixedColor}` : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '3px 9px',
                borderRadius: '5px',
                fontSize: '0.68rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                opacity: (highlightedToken && !isSelected) ? 0.40 : 1
              }}
              title={`Cliquer pour isoler #${idx + 1} ${t.cleanSymbol} sur les 2 graphiques`}
            >
              <span style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: t.fixedColor,
                boxShadow: isSelected ? `0 0 6px ${t.fixedColor}` : 'none'
              }} />
              <span>#{idx + 1} {t.cleanSymbol}</span>
              <span style={{ color: t.p24 >= 0 ? '#34d399' : '#f87171', fontSize: '0.64rem' }}>
                24h: {t.p24 >= 0 ? '+' : ''}{t.p24?.toFixed(1)}%
              </span>
              <span style={{ color: '#94a3b8', fontSize: '0.62rem' }}>
                | 30j: {t.p30 >= 0 ? '+' : ''}{t.p30?.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>

      {/* 📊 DOUBLE CONTENEUR CÔTE À CÔTE AVEC SÉPARATEUR AJUSTABLE */}
      <div
        ref={splitContainerRef}
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          width: '100%',
          position: 'relative'
        }}
      >
        {/* CHARTE GAUCHE : 24 HEURES */}
        <div style={{
          width: `${splitRatio}%`,
          minWidth: '240px',
          display: 'flex',
          flexDirection: 'column',
          background: '#040711',
          borderRadius: '8px 0 0 8px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          overflow: 'hidden',
          transition: isDraggingSplit ? 'none' : 'width 0.1s ease'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            background: 'linear-gradient(90deg, #0a1124, #080d1a)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.70rem',
            fontWeight: '700'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#facc15' }}>
              <span>⚡</span>
              <span style={{ color: '#e2e8f0', letterSpacing: '0.3px' }}>COURBES 24 HEURES (INTRA-DAY)</span>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.64rem' }}>
              Baseline 0% = Prix il y a 24H
            </div>
          </div>
          <div
            ref={container24hRef}
            style={{
              width: '100%',
              height: `${effectiveHeight}px`,
              background: '#040711'
            }}
          />
        </div>

        {/* ↔️ SÉPARATEUR INTERACTIF GLISSANT POUR LA LARGEUR */}
        <div
          onMouseDown={handleMouseDownSplit}
          style={{
            width: '12px',
            cursor: 'col-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDraggingSplit ? 'rgba(168, 85, 247, 0.35)' : 'rgba(255, 255, 255, 0.02)',
            borderLeft: isDraggingSplit ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.06)',
            borderRight: isDraggingSplit ? '1px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.06)',
            userSelect: 'none',
            zIndex: 10,
            transition: 'background 0.15s ease'
          }}
          title="↔️ Cliquez et glissez pour ajuster la proportion 24H / 30J"
        >
          <div style={{
            width: '2px',
            height: '32px',
            borderRadius: '1px',
            background: isDraggingSplit ? '#c084fc' : 'rgba(255, 255, 255, 0.25)'
          }} />
        </div>

        {/* CHARTE DROITE : 30 JOURS */}
        <div style={{
          width: `calc(${100 - splitRatio}% - 12px)`,
          minWidth: '240px',
          display: 'flex',
          flexDirection: 'column',
          background: '#040711',
          borderRadius: '0 8px 8px 0',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          overflow: 'hidden',
          transition: isDraggingSplit ? 'none' : 'width 0.1s ease'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            background: 'linear-gradient(90deg, #080d1a, #0d0a24)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: '0.70rem',
            fontWeight: '700'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#c084fc' }}>
              <span>🏛️</span>
              <span style={{ color: '#e2e8f0', letterSpacing: '0.3px' }}>STRUCTURE 30 JOURS (TENDANCE MENSUELLE)</span>
            </div>
            <div style={{ color: '#64748b', fontSize: '0.64rem' }}>
              Baseline 0% = Prix il y a 30 Jours
            </div>
          </div>
          <div
            ref={container30dRef}
            style={{
              width: '100%',
              height: `${effectiveHeight}px`,
              background: '#040711'
            }}
          />
        </div>
      </div>

      {/* ↕️ POIGNÉE DE REDIMENSIONNEMENT DE LA HAUTEUR */}
      {!isFullscreen && (
        <div
          onMouseDown={handleMouseDownHeight}
          style={{
            height: '14px',
            cursor: 'row-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDraggingHeight ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.02)',
            borderRadius: '4px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            gap: '8px',
            userSelect: 'none',
            transition: 'background 0.15s ease'
          }}
          title="Glisser vers le haut ou le bas pour ajuster la hauteur des 2 graphiques"
        >
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#c084fc' : '#475569', borderRadius: '1px' }} />
          <span style={{ color: isDraggingHeight ? '#c084fc' : '#64748b', fontSize: '0.64rem', fontWeight: '700' }}>
            ↕ HAUTEUR ({dualChartHeight}px)
          </span>
          <div style={{ width: '28px', height: '2px', background: isDraggingHeight ? '#c084fc' : '#475569', borderRadius: '1px' }} />
        </div>
      )}
    </div>
  );
}


// ========================================================================================
// 🔬 COMPOSANT DÉDIÉ (STANDALONE) : RADAR DIAGNOSTIC BREAKOUT & SUPPLY (AIR POCKETS & VOL/MC)
// ========================================================================================
export function CorridorSupplyDiagnosticPanel({
  tokensData = [],
  tripleAnalysis = {},
  chartProcessedData = {},
  activeChartHorizon = 'day',
  chartUniverse = 'MONTH_SCORE',
  selectedSoloToken,
  setSelectedSoloToken,
  onClose
}) {
  const [tokenIntelMap, setTokenIntelMap] = useState({});
  const [isLoadingIntel, setIsLoadingIntel] = useState(false);
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'BREAKOUT' | 'RISK'

  // 1. Détermination précise des 3 niveaux clés du corridor
  const entryLvl = useMemo(() => {
    if (activeChartHorizon === 'day') {
      return chartProcessedData?.launchpad24hData?.lvl != null ? chartProcessedData.launchpad24hData.lvl : 6.0;
    }
    if (activeChartHorizon === 'week') {
      return parseFloat(((chartProcessedData?.valMax || 25.0) * 0.75).toFixed(2));
    }
    return chartProcessedData?.valMax || 32.0;
  }, [activeChartHorizon, chartProcessedData]);

  const macroResLvl = useMemo(() => {
    return tripleAnalysis?.dynamicMonthlyRefLevel != null ? tripleAnalysis.dynamicMonthlyRefLevel : 26.11;
  }, [tripleAnalysis]);

  const rejectionLvl = useMemo(() => {
    return chartProcessedData?.rejectionWall24hData?.lvl || 13.0;
  }, [chartProcessedData]);

  // 2. Filtrage des tokens en corridor
  const corridorTokens = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    const tokenCurvesMap = chartProcessedData?.tokenCurvesMap || {};

    const filtered = list.filter(tok => {
      const sym = tok.cleanSymbol;
      if (!sym || sym === 'BTC' || sym === 'ETH') return false;
      const curve = tokenCurvesMap[sym];
      if (!curve || curve.length === 0) return false;

      const latestVal = curve[curve.length - 1].value;
      return latestVal >= entryLvl && latestVal <= macroResLvl;
    }).map((tok, idx) => {
      const curve = tokenCurvesMap[tok.cleanSymbol] || [];
      const latestVal = curve[curve.length - 1]?.value ?? 0;
      return {
        ...tok,
        latestVal,
        curveData: curve,
        corridorRank: idx + 1
      };
    });

    return filtered.sort((a, b) => b.latestVal - a.latestVal);
  }, [chartUniverse, tripleAnalysis, chartProcessedData, entryLvl, macroResLvl]);

  // 3. Récupération asynchrone des métriques fondamentales (Market Cap, etc.)
  useEffect(() => {
    if (!corridorTokens || corridorTokens.length === 0) {
      setTokenIntelMap({});
      return;
    }
    let isMounted = true;
    setIsLoadingIntel(true);

    const fetchIntel = async () => {
      const results = {};
      await Promise.all(
        corridorTokens.map(async (tok) => {
          try {
            const intel = await getTokenIntelligence(tok.cleanSymbol, tok.turnover24h, tok.price);
            if (intel && isMounted) {
              results[tok.cleanSymbol] = intel;
            }
          } catch (_) {}
        })
      );
      if (isMounted) {
        setTokenIntelMap(results);
        setIsLoadingIntel(false);
      }
    };

    fetchIntel();
    return () => { isMounted = false; };
  }, [corridorTokens]);

  // 4. Calcul des diagnostics (Fluidité, Delta Taker, Vol/MC)
  const diagnosedTokens = useMemo(() => {
    return corridorTokens.map(tok => {
      const sym = tok.cleanSymbol;
      const latestVal = tok.latestVal || 0;
      const turnover = tok.turnover24h || 0;
      const klines = tok.rawKlines || [];

      // 1. Fluidité d'Offre (Price Impact / Effort vs Résultat)
      const ptsGain = Math.max(0.2, latestVal);
      const costPerPct = turnover > 0 ? turnover / ptsGain : 50000;

      let fluidityScore = 50;
      let fluidityTier = 'RÉSISTANCE MOYENNE';
      let fluidityColor = '#facc15';
      let fluidityDesc = '';

      if (costPerPct <= 25000) {
        fluidityScore = Math.round(85 + Math.min(14, ((25000 - costPerPct) / 25000) * 14));
        fluidityTier = 'AIR POCKET (Zéro Vendeurs)';
        fluidityColor = '#10b981';
        fluidityDesc = `Triq khawya: ghir ${formatCompactUSD(costPerPct)} / +1%`;
      } else if (costPerPct <= 100000) {
        fluidityScore = Math.round(65 + (((100000 - costPerPct) / 75000) * 19));
        fluidityTier = 'FLUIDE (Offre Faible)';
        fluidityColor = '#38bdf8';
        fluidityDesc = `Peu d'offre: ${formatCompactUSD(costPerPct)} / +1%`;
      } else if (costPerPct <= 400000) {
        fluidityScore = Math.round(40 + (((400000 - costPerPct) / 300000) * 24));
        fluidityTier = 'RÉSISTANCE MOYENNE';
        fluidityColor = '#facc15';
        fluidityDesc = `Carnet équilibré: ${formatCompactUSD(costPerPct)} / +1%`;
      } else {
        fluidityScore = Math.max(10, Math.round(40 - Math.min(30, (((costPerPct - 400000) / 1000000) * 30))));
        fluidityTier = 'MUR DE BÉTON';
        fluidityColor = '#ef4444';
        fluidityDesc = `Vendeurs lourds: ${formatCompactUSD(costPerPct)} / +1%`;
      }

      // 2. Agressivité Taker (Net Buy Delta sur les 20 dernières bougies)
      let totalVol = 0;
      let buyVol = 0;
      const recentKlines = klines.slice(-20);
      recentKlines.forEach(k => {
        const o = parseFloat(k[1]);
        const h = parseFloat(k[2]);
        const l = parseFloat(k[3]);
        const c = parseFloat(k[4]);
        const t = parseFloat(k[6] || k[5] || 0);
        if (h > l && t > 0) {
          const buyRatio = (c - l) / (h - l);
          buyVol += buyRatio * t;
          totalVol += t;
        }
      });
      const takerBuyPct = totalVol > 0 ? Math.round((buyVol / totalVol) * 100) : 50;
      let takerColor = '#facc15';
      let takerTier = '⚖️ ÉQUILIBRÉ';
      if (takerBuyPct >= 65) {
        takerColor = '#10b981';
        takerTier = '🟢 ACHATS MARCHÉ AGRESSIFS';
      } else if (takerBuyPct >= 50) {
        takerColor = '#38bdf8';
        takerTier = '🔵 PRESSION ACHAT ACTIVE';
      } else if (takerBuyPct < 42) {
        takerColor = '#ef4444';
        takerTier = '🔴 DOMINANCE VENTE / ABSORPTION';
      }

      // 3. Rapport Volume 24h / Market Cap (Vol / MC)
      const intel = tokenIntelMap[sym];
      const mcap = intel?.marketCap;
      const volToMcap = (mcap && mcap > 0 && turnover > 0)
        ? parseFloat(((turnover / mcap) * 100).toFixed(1))
        : null;

      let volMcapBar = 25;
      let volMcapColor = '#94a3b8';
      let volMcapTier = '⚪ CALME / LOURD';
      if (volToMcap !== null) {
        if (volToMcap >= 30) {
          volMcapBar = Math.min(100, Math.round(volToMcap));
          volMcapColor = '#10b981';
          volMcapTier = `🔥 HYPER-ROTATION (${volToMcap}%)`;
        } else if (volToMcap >= 15) {
          volMcapBar = Math.min(100, Math.round(volToMcap * 2.5));
          volMcapColor = '#38bdf8';
          volMcapTier = `⚡ DYNAMIQUE (${volToMcap}%)`;
        } else if (volToMcap >= 5) {
          volMcapBar = Math.min(100, Math.round(volToMcap * 4));
          volMcapColor = '#facc15';
          volMcapTier = `🟡 MODÉRÉ (${volToMcap}%)`;
        } else {
          volMcapBar = Math.max(10, Math.round(volToMcap * 5));
          volMcapColor = '#94a3b8';
          volMcapTier = `⚪ STATIQUE (${volToMcap}%)`;
        }
      } else {
        volMcapTier = `CEX SPOT (${formatVolumeUSDT(turnover)})`;
        volMcapBar = 35;
        volMcapColor = '#64748b';
      }

      // Synthèse Breakout Score (0-100)
      const mcapComp = volToMcap !== null ? Math.min(100, volToMcap * 2.5) : 50;
      const breakoutScore = Math.round(
        (fluidityScore * 0.40) + (takerBuyPct * 0.35) + (mcapComp * 0.25)
      );

      let statusBadge = {
        label: '⚖️ EN COMPRESSION',
        bg: 'rgba(250, 204, 21, 0.1)',
        border: '1px solid rgba(250, 204, 21, 0.35)',
        color: '#facc15',
        icon: '⚖️'
      };

      if (breakoutScore >= 70 || (fluidityScore >= 80 && takerBuyPct >= 60)) {
        statusBadge = {
          label: '🚀 PROPULSION PROBABLE',
          bg: 'rgba(16, 185, 129, 0.14)',
          border: '1px solid rgba(16, 185, 129, 0.5)',
          color: '#10b981',
          icon: '🚀'
        };
      } else if (breakoutScore <= 45 || fluidityScore <= 30 || takerBuyPct <= 38) {
        statusBadge = {
          label: '⚠️ RISQUE DE REJET',
          bg: 'rgba(239, 68, 68, 0.14)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          color: '#ef4444',
          icon: '⚠️'
        };
      }

      const distToMur = rejectionLvl != null ? (rejectionLvl - latestVal).toFixed(2) : null;

      return {
        tok,
        sym,
        latestVal,
        turnover,
        costPerPct,
        fluidityScore,
        fluidityTier,
        fluidityColor,
        fluidityDesc,
        takerBuyPct,
        takerColor,
        takerTier,
        mcap,
        volToMcap,
        volMcapBar,
        volMcapColor,
        volMcapTier,
        breakoutScore,
        statusBadge,
        distToMur,
        fixedColor: getTokenFixedColor(sym)
      };
    });
  }, [corridorTokens, tokenIntelMap, rejectionLvl]);

  const readyBreakoutCount = useMemo(() => {
    return diagnosedTokens.filter(d => d.statusBadge.label === '🚀 PROPULSION PROBABLE').length;
  }, [diagnosedTokens]);

  const riskCount = useMemo(() => {
    return diagnosedTokens.filter(d => d.statusBadge.label === '⚠️ RISQUE DE REJET').length;
  }, [diagnosedTokens]);

  const filteredTokens = useMemo(() => {
    if (filterMode === 'BREAKOUT') {
      return diagnosedTokens.filter(d => d.statusBadge.label === '🚀 PROPULSION PROBABLE');
    }
    if (filterMode === 'RISK') {
      return diagnosedTokens.filter(d => d.statusBadge.label === '⚠️ RISQUE DE REJET');
    }
    return diagnosedTokens;
  }, [diagnosedTokens, filterMode]);

  return (
    <div style={{
      marginTop: '14px',
      background: '#0a1519',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      position: 'relative'
    }}>
      {/* En-tête Principal du Panneau Standalone */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
        paddingBottom: '10px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{
            background: 'rgba(0, 255, 136, 0.12)',
            border: '1px solid rgba(0, 255, 136, 0.4)',
            padding: '4px 10px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span style={{ fontSize: '1rem' }}>🔬</span>
            <span style={{
              color: '#00ff88',
              fontSize: '0.84rem',
              fontWeight: '900',
              letterSpacing: '0.3px'
            }}>
              RADAR DIAGNOSTIC BREAKOUT & SUPPLY (STANDALONE)
            </span>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.4)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '3px 9px',
            borderRadius: '6px',
            fontSize: '0.72rem',
            color: '#94a3b8',
            fontWeight: '800'
          }}>
            <span>Zone: +{entryLvl} pts</span>
            <span style={{ color: '#64748b' }}>➔</span>
            <span style={{ color: '#facc15' }}>{macroResLvl}%</span>
          </div>

          <div style={{
            background: 'rgba(16, 185, 129, 0.14)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            padding: '3px 9px',
            borderRadius: '6px',
            fontSize: '0.72rem',
            color: '#10b981',
            fontWeight: '900'
          }}>
            🚀 {readyBreakoutCount} / {corridorTokens.length} PRÊTS POUR EXPLOSION
          </div>

          {isLoadingIntel && (
            <span style={{ color: '#94a3b8', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <RefreshCw size={11} className="animate-spin" /> Analyse des Market Caps...
            </span>
          )}
        </div>

        {/* Boutons Filtres et Fermeture */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setFilterMode('ALL')}
            style={{
              background: filterMode === 'ALL' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
              color: filterMode === 'ALL' ? '#ffffff' : '#94a3b8',
              border: filterMode === 'ALL' ? '1px solid rgba(255, 255, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '800',
              cursor: 'pointer'
            }}
          >
            TOUS ({corridorTokens.length})
          </button>

          <button
            onClick={() => setFilterMode('BREAKOUT')}
            style={{
              background: filterMode === 'BREAKOUT' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              color: filterMode === 'BREAKOUT' ? '#10b981' : '#94a3b8',
              border: filterMode === 'BREAKOUT' ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '800',
              cursor: 'pointer'
            }}
          >
            🚀 PROPULSION ({readyBreakoutCount})
          </button>

          <button
            onClick={() => setFilterMode('RISK')}
            style={{
              background: filterMode === 'RISK' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.03)',
              color: filterMode === 'RISK' ? '#ef4444' : '#94a3b8',
              border: filterMode === 'RISK' ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.08)',
              padding: '3px 8px',
              borderRadius: '5px',
              fontSize: '0.68rem',
              fontWeight: '800',
              cursor: 'pointer'
            }}
          >
            ⚠️ REJET ({riskCount})
          </button>

          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.70rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Fermer le panneau diagnostic"
            >
              <X size={12} /> FERMER
            </button>
          )}
        </div>
      </div>

      {/* Légende didactique des 3 Piliers */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        fontSize: '0.68rem',
        color: '#94a3b8',
        background: 'rgba(0, 0, 0, 0.3)',
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1px solid rgba(255, 255, 255, 0.04)'
      }}>
        <span>🟢 <strong>1. Fluidité d'Offre</strong> : Coût en $ pour +1% (Zero Supply = propulsion facile comme ALCH)</span>
        <span>⚡ <strong>2. Agressivité Taker</strong> : Achat agressif au marché vs Vente passive (20 dernières bougies)</span>
        <span>🔥 <strong>3. Rotation Float (Vol/MC)</strong> : Vitesse de rotation du capital (&gt; 15% - 30% = Hyper-Fusée)</span>
      </div>

      {/* Grille des Cartes Diagnostics Standalone */}
      {filteredTokens.length === 0 ? (
        <div style={{
          padding: '20px',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '0.78rem',
          border: '1px dashed rgba(255, 255, 255, 0.08)',
          borderRadius: '8px'
        }}>
          Aucun token ne correspond au filtre sélectionné dans le corridor actif.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '10px'
        }}>
          {filteredTokens.map((item) => {
            const isSelected = selectedSoloToken === item.sym;

            return (
              <div
                key={item.sym}
                onClick={() => setSelectedSoloToken && setSelectedSoloToken(isSelected ? null : item.sym)}
                style={{
                  background: isSelected ? 'rgba(56, 189, 248, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Cliquez pour sélectionner ce token"
              >
                {/* Ligne En-tête de la Carte */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: item.fixedColor,
                      display: 'inline-block'
                    }} />
                    <strong style={{ color: '#ffffff', fontSize: '0.90rem' }}>
                      #{item.tok.rankMonth || item.tok.corridorRank} {item.sym}
                    </strong>
                    <span style={{ color: item.fixedColor, fontWeight: '900', fontSize: '0.80rem' }}>
                      +{item.latestVal.toFixed(2)} pts
                    </span>
                  </div>

                  <span style={{
                    background: item.statusBadge.bg,
                    border: item.statusBadge.border,
                    color: item.statusBadge.color,
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontSize: '0.64rem',
                    fontWeight: '900',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {item.statusBadge.label}
                  </span>
                </div>

                {/* Distance au Mur & Volume Bybit */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.68rem',
                  color: '#94a3b8',
                  background: 'rgba(0,0,0,0.35)',
                  padding: '4px 8px',
                  borderRadius: '4px'
                }}>
                  <span>
                    Mur Rejet: <strong style={{ color: item.distToMur <= 0 ? '#10b981' : '#f87171' }}>
                      {item.distToMur <= 0 ? `Franchi (+${Math.abs(item.distToMur)} pts)` : `à ${item.distToMur} pts`}
                    </strong>
                  </span>
                  <span>
                    Vol Bybit: <strong style={{ color: '#38bdf8' }}>{formatVolumeUSDT(item.turnover)}</strong>
                  </span>
                </div>

                {/* 1. DIAGRAMME : FLUIDITÉ D'OFFRE (PRICE IMPACT) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                    <span style={{ color: '#cbd5e1' }}>1. Fluidité d'Offre (Zero Supply) :</span>
                    <strong style={{ color: item.fluidityColor }}>{item.fluidityScore}%</strong>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '5px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${item.fluidityScore}%`,
                      height: '100%',
                      background: item.fluidityColor,
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ fontSize: '0.62rem', color: item.fluidityColor, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.fluidityTier}</span>
                    <span style={{ color: '#94a3b8' }}>{item.fluidityDesc}</span>
                  </div>
                </div>

                {/* 2. DIAGRAMME : AGRESSIVITÉ TAKER (NET BUY DELTA) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                    <span style={{ color: '#cbd5e1' }}>2. Agressivité Taker (Ordres Marché) :</span>
                    <strong style={{ color: item.takerColor }}>{item.takerBuyPct}% Achat</strong>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '5px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${item.takerBuyPct}%`,
                      height: '100%',
                      background: item.takerColor,
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ fontSize: '0.62rem', color: item.takerColor }}>
                    {item.takerTier}
                  </div>
                </div>

                {/* 3. DIAGRAMME : RAPPORT VOLUME 24H / MARKET CAP */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem' }}>
                    <span style={{ color: '#cbd5e1' }}>3. Rotation Float (Vol 24h / Market Cap) :</span>
                    <strong style={{ color: item.volMcapColor }}>
                      {item.volToMcap !== null ? `${item.volToMcap}%` : 'CEX'}
                    </strong>
                  </div>
                  <div style={{
                    width: '100%',
                    height: '5px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      width: `${item.volMcapBar}%`,
                      height: '100%',
                      background: item.volMcapColor,
                      borderRadius: '3px',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ fontSize: '0.62rem', color: item.volMcapColor, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{item.volMcapTier}</span>
                    {item.mcap && <span style={{ color: '#94a3b8' }}>MC: {formatCompactUSD(item.mcap)}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========================================================================================
// 🔥 COMPOSANT DÉDIÉ : HISTOGRAMME TOP 15 / 20 / 50 VOL/MC RATIO (DONNÉES COINGECKO MONDIALES)
// ========================================================================================
const CG_DATA_CACHE = {
  timestamp: 0,
  map: new Map() // SYM (ex: "FLOCK") -> { volume, marketCap, price, timestamp }
};

const CG_TOP_MARKETS_CACHE = {
  timestamp: 0,
  map: new Map()
};

export function TopDailyVolumeMcapChart({
  tokens = [],
  dailyCgData = {},
  setDailyCgData,
  dailyMarketCaps = {},
  selectedSoloToken,
  setSelectedSoloToken,
  onClose
}) {
  const [topLimit, setTopLimit] = useState(20); // 15 | 20 | 50
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredToken, setHoveredToken] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const [localCgData, setLocalCgData] = useState({});

  // 🦙 Récupération des données CoinGecko (Volume Global 24h & Market Cap) pour les tokens du Top 50 Daily
  const fetchCoinGeckoBatch = useCallback(async (force = false) => {
    if (!tokens || tokens.length === 0) return;

    const syms = tokens.map(t => (t.cleanSymbol || '').toLowerCase()).filter(Boolean);
    if (syms.length === 0) return;

    const now = Date.now();
    const missing = force ? syms : syms.filter(s => {
      const upper = s.toUpperCase();
      const cached = CG_DATA_CACHE.map.get(upper);
      return !cached || (now - (cached.timestamp || 0) > 180000);
    });

    if (missing.length === 0) {
      const loaded = {};
      syms.forEach(s => {
        const up = s.toUpperCase();
        if (CG_DATA_CACHE.map.has(up)) {
          loaded[up] = CG_DATA_CACHE.map.get(up);
        }
      });
      setLocalCgData(prev => ({ ...prev, ...loaded }));
      return;
    }

    setIsLoading(true);
    try {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${missing.join(',')}&per_page=100&page=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const fresh = {};
          data.forEach(c => {
            if (c && c.symbol) {
              const upper = c.symbol.toUpperCase();
              const cur = fresh[upper];
              if (!cur || (c.market_cap && c.market_cap > (cur.marketCap || 0))) {
                const item = {
                  volume: c.total_volume || 0,
                  marketCap: c.market_cap || 0,
                  price: c.current_price || 0,
                  timestamp: Date.now()
                };
                fresh[upper] = item;
                CG_DATA_CACHE.map.set(upper, item);
                if (c.market_cap) CG_TOP_MARKETS_CACHE.map.set(upper, c.market_cap);
              }
            }
          });
          setLocalCgData(prev => ({ ...prev, ...fresh }));
          if (setDailyCgData) {
            setDailyCgData(prev => ({ ...prev, ...fresh }));
          }
        }
      }
    } catch (err) {
      console.warn('[TopVolMC] CoinGecko batch fetch notice:', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [tokens, setDailyCgData]);

  useEffect(() => {
    fetchCoinGeckoBatch(false);
  }, [fetchCoinGeckoBatch]);

  // 🧮 Calcul et classement du Ratio Vol/MC et de la Dominance Buy/Sell (15m 24h)
  const sortedVolMcapTokens = useMemo(() => {
    if (!tokens || tokens.length === 0) return [];

    const effectiveCg = { ...localCgData, ...dailyCgData };

    return tokens.map(tok => {
      const sym = (tok.cleanSymbol || '').toUpperCase();
      const cg = effectiveCg[sym] || CG_DATA_CACHE.map.get(sym) || null;

      // Volume mondial CoinGecko (ou turnover Bybit en repli immédiat)
      const vol24h = (cg?.volume && cg.volume > 0)
        ? cg.volume
        : (tok.cgVolume || tok.turnover24h || (tok.volume24h && tok.price ? tok.volume24h * tok.price : 0) || 0);

      // Market Cap CoinGecko (ou fallback)
      const mcap = (cg?.marketCap && cg.marketCap > 0)
        ? cg.marketCap
        : (tok.marketCap || dailyMarketCaps[sym] || 0);

      const ratio = tok.volMcapRatio && tok.volMcapRatio > 0
        ? tok.volMcapRatio
        : (mcap > 0 ? parseFloat(((vol24h / mcap) * 100).toFixed(1)) : 0);

      // 🧮 Décomposition Acheteurs vs Vendeurs (96 bougies 15m = 24H)
      let buyPct = typeof tok.buyPct === 'number' ? tok.buyPct : null;
      let sellPct = typeof tok.sellPct === 'number' ? tok.sellPct : null;
      let netDelta = typeof tok.netDelta24h === 'number' ? tok.netDelta24h : null;

      if (buyPct === null && tok.rawKlines && tok.rawKlines.length > 0) {
        const klines24h = tok.rawKlines.slice(-96);
        let bVol = 0;
        let sVol = 0;
        let tVol = 0;
        klines24h.forEach(k => {
          const h = parseFloat(k[2]);
          const l = parseFloat(k[3]);
          const c = parseFloat(k[4]);
          const t = parseFloat(k[6] || 0);
          if (h > l && t > 0) {
            const bRatio = (c - l) / (h - l);
            bVol += t * bRatio;
            sVol += t * (1 - bRatio);
            tVol += t;
          } else if (t > 0) {
            bVol += t * 0.5;
            sVol += t * 0.5;
            tVol += t;
          }
        });
        if (tVol > 0) {
          buyPct = parseFloat(((bVol / tVol) * 100).toFixed(1));
          sellPct = parseFloat((100 - buyPct).toFixed(1));
          netDelta = bVol - sVol;
        } else {
          buyPct = 50;
          sellPct = 50;
          netDelta = 0;
        }
      }

      if (buyPct === null) {
        buyPct = 50;
        sellPct = 50;
        netDelta = 0;
      }

      const isBuyDominant = buyPct >= 50;
      const globalBuyVol = vol24h * (buyPct / 100);
      const globalSellVol = vol24h * (sellPct / 100);
      const globalNetDelta = globalBuyVol - globalSellVol;

      let tierLabel = '💤 FAIBLE ROTATION (<10%)';
      let tierColor = '#64748b';
      if (ratio >= 50) {
        tierLabel = '⚡ HYPER-ROTATION (>50%)';
        tierColor = '#f59e0b';
      } else if (ratio >= 25) {
        tierLabel = '🔥 FORTE ROTATION (25-50%)';
        tierColor = '#fbbf24';
      } else if (ratio >= 10) {
        tierLabel = '🟢 ROTATION SAINE (10-25%)';
        tierColor = '#10b981';
      }

      return {
        ...tok,
        cleanSymbol: sym,
        vol24h,
        mcap,
        ratio,
        buyPct,
        sellPct,
        isBuyDominant,
        globalBuyVol,
        globalSellVol,
        globalNetDelta,
        hasCgData: Boolean(cg?.volume || tok.cgVolume),
        tierLabel,
        tierColor
      };
    })
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, topLimit);
  }, [tokens, localCgData, dailyCgData, dailyMarketCaps, topLimit]);

  const buyDominantCount = useMemo(() => {
    return sortedVolMcapTokens.filter(t => t.isBuyDominant).length;
  }, [sortedVolMcapTokens]);

  const sellDominantCount = useMemo(() => {
    return sortedVolMcapTokens.length - buyDominantCount;
  }, [sortedVolMcapTokens, buyDominantCount]);

  // 📐 Dimensions SVG adaptatives selon le nombre de tokens
  const svgWidth = topLimit === 50 ? 1750 : topLimit === 20 ? 1100 : 950;
  const svgHeight = 360;
  const margin = { top: 35, right: 30, bottom: 85, left: 65 };
  const innerWidth = svgWidth - margin.left - margin.right;
  const innerHeight = svgHeight - margin.top - margin.bottom;

  // Calcul du plafond Y (arrondi au 20% supérieur)
  const maxDataRatio = useMemo(() => {
    if (sortedVolMcapTokens.length === 0) return 100;
    const maxVal = Math.max(...sortedVolMcapTokens.map(t => t.ratio));
    return Math.max(20, Math.ceil((maxVal * 1.15) / 20) * 20);
  }, [sortedVolMcapTokens]);

  // Paliers de l'axe Y (0%, 20%, 40%, 60%, 80%...)
  const yTicks = useMemo(() => {
    const step = maxDataRatio <= 60 ? 10 : maxDataRatio <= 120 ? 20 : Math.ceil(maxDataRatio / 5 / 10) * 10;
    const ticks = [];
    for (let v = 0; v <= maxDataRatio; v += step) {
      ticks.push(v);
    }
    return ticks;
  }, [maxDataRatio]);

  const numBars = sortedVolMcapTokens.length;
  const colWidth = numBars > 0 ? innerWidth / numBars : 0;
  const barWidth = Math.max(10, Math.min(38, colWidth * 0.64));

  return (
    <div 
      ref={containerRef}
      style={{
        marginTop: '14px',
        background: '#0a1519',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        position: 'relative'
      }}
    >
      {/* 🏷️ EN-TÊTE PRINCIPAL : STYLE CONFORME AU SCREENSHOT */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {/* Titre Gauche : 🔥 TOP {topLimit} DAILY VOL/MC (COINGECKO) + Ratios */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{ fontSize: '1.25rem' }}>🔥</span>
            <span style={{
              color: '#f59e0b',
              fontSize: '1.05rem',
              fontWeight: '900',
              letterSpacing: '0.6px'
            }}>
              TOP {topLimit} DAILY VOL/MC (COINGECKO) {topLimit === 50 ? '(KAMLIN)' : ''}
            </span>
          </div>

          <div style={{
            fontSize: '0.85rem',
            color: '#64748b',
            fontWeight: '600',
            letterSpacing: '0.3px'
          }}>
            Ratios
          </div>

          <div style={{
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            padding: '2px 8px',
            borderRadius: '5px',
            fontSize: '0.7rem',
            color: '#f59e0b',
            fontWeight: '800'
          }}>
            {sortedVolMcapTokens.length} TOKENS TOP 50 DAILY
          </div>

          {/* Pastilles Dominance Acheteurs vs Vendeurs */}
          <div style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            padding: '2px 8px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            color: '#10b981',
            fontWeight: '900',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>🟢</span>
            <span>{buyDominantCount} ACHATS</span>
          </div>

          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            padding: '2px 8px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            color: '#f87171',
            fontWeight: '900',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>🔴</span>
            <span>{sellDominantCount} VENTES</span>
          </div>

          <div style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '2px 8px',
            borderRadius: '5px',
            fontSize: '0.68rem',
            color: '#94a3b8',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>⏱️</span>
            <span>FLUX 15M (24H)</span>
          </div>
        </div>

        {/* Contrôles Droite : Top 15/20/50, Refresh, Fermer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Sélecteur Top 15 / Top 20 / Top 50 */}
          <div style={{
            display: 'flex',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '6px',
            padding: '2px',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}>
            {[15, 20, 50].map(cnt => (
              <button
                key={cnt}
                onClick={() => setTopLimit(cnt)}
                style={{
                  background: topLimit === cnt ? '#b45309' : 'transparent',
                  color: topLimit === cnt ? '#ffffff' : '#94a3b8',
                  border: 'none',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: '800',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {cnt === 50 ? 'TOP 50 (KAMLIN)' : `TOP ${cnt}`}
              </button>
            ))}
          </div>

          {/* Bouton Actualiser */}
          <button
            onClick={() => fetchCoinGeckoBatch(true)}
            disabled={isLoading}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: '#94a3b8',
              padding: '4px 8px',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: '700',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Actualiser les données CoinGecko pour le Top 50 Daily"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Calcul CoinGecko...' : 'Refresh'}
          </button>

          {/* Bouton Fermer */}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                padding: '4px 6px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Fermer ce diagramme"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 📊 ZONE DU GRAPHIQUE SVG : HISTOGRAMME EXACT AU SCREENSHOT */}
      <div style={{
        position: 'relative',
        width: '100%',
        minHeight: '360px',
        overflowX: 'auto',
        background: 'rgba(0, 0, 0, 0.25)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.04)'
      }}>
        {sortedVolMcapTokens.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '340px',
            color: '#64748b',
            gap: '8px'
          }}>
            <RefreshCw size={24} className="animate-spin" style={{ color: '#f59e0b' }} />
            <span style={{ fontSize: '0.85rem' }}>Chargement et calcul des ratios Volume/MarketCap...</span>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{
              width: '100%',
              height: 'auto',
              minWidth: '700px',
              display: 'block'
            }}
          >
            {/* LIGNES DE GRILLE HORIZONTALES & GRADUATIONS AXE Y (0%, 20%, 40%...) */}
            {yTicks.map(val => {
              const yPos = margin.top + innerHeight - (val / maxDataRatio) * innerHeight;
              return (
                <g key={`ytick-${val}`}>
                  {/* Ligne pointillée horizontale */}
                  <line
                    x1={margin.left}
                    y1={yPos}
                    x2={svgWidth - margin.right}
                    y2={yPos}
                    stroke="rgba(255, 255, 255, 0.07)"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  {/* Libellé de pourcentage à gauche */}
                  <text
                    x={margin.left - 10}
                    y={yPos + 4}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="monospace"
                  >
                    {val}%
                  </text>
                </g>
              );
            })}

            {/* BARS ET ÉTIQUETTES DES TOKENS */}
            {sortedVolMcapTokens.map((tok, idx) => {
              const xCenter = margin.left + idx * colWidth + colWidth / 2;
              const xBar = xCenter - barWidth / 2;
              const barHeight = Math.max(4, (tok.ratio / maxDataRatio) * innerHeight);
              const yBar = margin.top + innerHeight - barHeight;
              const isHovered = hoveredToken?.cleanSymbol === tok.cleanSymbol;
              const isSelected = selectedSoloToken === tok.cleanSymbol;

              // 🟢 Vert si Achats dominent, 🔴 Rouge si Ventes dominent (15m 24h)
              const fillColor = isSelected
                ? '#0284c7'
                : isHovered
                ? (tok.isBuyDominant ? '#00ff88' : '#ff4d4d')
                : (tok.isBuyDominant ? '#10b981' : '#ef4444');

              const strokeColor = isSelected
                ? '#38bdf8'
                : isHovered
                ? '#ffffff'
                : (tok.isBuyDominant ? '#34d399' : '#f87171');

              const glowFilter = isHovered
                ? (tok.isBuyDominant ? 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.7))' : 'drop-shadow(0 0 8px rgba(239, 68, 68, 0.7))')
                : 'none';

              return (
                <g 
                  key={tok.cleanSymbol}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    setHoveredToken(tok);
                    if (rect) {
                      setTooltipPos({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top
                      });
                    }
                  }}
                  onMouseMove={(e) => {
                    const rect = containerRef.current?.getBoundingClientRect();
                    if (rect) {
                      setTooltipPos({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top
                      });
                    }
                  }}
                  onMouseLeave={() => setHoveredToken(null)}
                  onClick={() => {
                    if (setSelectedSoloToken) {
                      const fullTok = tokens.find(t => t.cleanSymbol === tok.cleanSymbol) || tok;
                      setSelectedSoloToken(prev => (prev?.cleanSymbol === tok.cleanSymbol ? null : fullTok));
                    }
                  }}
                >
                  {/* Rectangle de survol transparent pour faciliter la visibilité */}
                  <rect
                    x={xCenter - colWidth / 2}
                    y={margin.top}
                    width={colWidth}
                    height={innerHeight}
                    fill={isHovered ? (tok.isBuyDominant ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)') : 'transparent'}
                  />

                  {/* BARRE DU RATIO AVEC SOMMETS ARRONDIS (rx="3") */}
                  <rect
                    x={xBar}
                    y={yBar}
                    width={barWidth}
                    height={barHeight}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isHovered || isSelected ? '1.5' : '1'}
                    rx="3"
                    ry="3"
                    style={{
                      transition: 'fill 0.2s ease, stroke 0.2s ease',
                      filter: glowFilter
                    }}
                  />

                  {/* VALEUR DU RATIO VOL/MC EN % AU-DESSUS DE LA BARRE */}
                  <text
                    x={xCenter}
                    y={Math.max(margin.top - 14, yBar - 15)}
                    textAnchor="middle"
                    fill={isHovered ? '#ffffff' : '#cbd5e1'}
                    fontSize={topLimit === 50 ? '8.5' : '10'}
                    fontWeight="800"
                    fontFamily="sans-serif"
                  >
                    {tok.ratio >= 100 ? `${tok.ratio.toFixed(0)}%` : `${tok.ratio.toFixed(1)}%`}
                  </text>

                  {/* DOMINANCE DU VOLUME (+XX% BUY ou XX% SELL) */}
                  <text
                    x={xCenter}
                    y={Math.max(margin.top - 3, yBar - 4)}
                    textAnchor="middle"
                    fill={tok.isBuyDominant ? '#00ff88' : '#ff6b6b'}
                    fontSize={topLimit === 50 ? '7.5' : '9'}
                    fontWeight="900"
                    fontFamily="monospace"
                  >
                    {tok.isBuyDominant ? `+${tok.buyPct.toFixed(0)}% BUY` : `${tok.sellPct.toFixed(0)}% SELL`}
                  </text>

                  {/* NOM DU TOKEN (INCLINÉ À -45° SOUS L'AXE X COMME DANS LE SCREENSHOT) */}
                  <g transform={`translate(${xCenter}, ${margin.top + innerHeight + 14}) rotate(-45)`}>
                    <text
                      textAnchor="end"
                      fill={isHovered ? '#00ff88' : isSelected ? '#38bdf8' : '#cbd5e1'}
                      fontSize="10.5"
                      fontWeight={isHovered || isSelected ? '800' : '600'}
                      fontFamily="monospace"
                      letterSpacing="0.2px"
                    >
                      {tok.cleanSymbol}USDT
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Ligne d'axe X de base */}
            <line
              x1={margin.left}
              y1={margin.top + innerHeight}
              x2={svgWidth - margin.right}
              y2={margin.top + innerHeight}
              stroke="rgba(255, 255, 255, 0.15)"
              strokeWidth="1"
            />
          </svg>
        )}

        {/* 💬 TOOLTIP FLOTTANT INTERACTIF LORS DU SURVOL */}
        {hoveredToken && (
          <div style={{
            position: 'absolute',
            left: `${Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth || 800) - 260)}px`,
            top: `${Math.max(10, tooltipPos.y - 170)}px`,
            background: '#0b1329',
            border: `1px solid ${hoveredToken.isBuyDominant ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)'}`,
            borderRadius: '8px',
            padding: '12px 14px',
            pointerEvents: 'none',
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.9)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '240px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#ffffff', fontWeight: '900', fontSize: '0.95rem' }}>
                {hoveredToken.cleanSymbol}USDT
              </span>
              <span style={{
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '0.65rem',
                fontWeight: '800'
              }}>
                {hoveredToken.tierLabel}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.70rem', color: '#64748b' }}>
              <span>Rang Score Jour:</span>
              <span style={{ color: '#00ff88', fontWeight: '800' }}>
                #{hoveredToken.rankDay || '-'} ({hoveredToken.scoreDay ? `+${hoveredToken.scoreDay} pts` : ''})
              </span>
            </div>

            {/* ⚖️ SECTION FLUX BUY VS SELL (BOUGIES 15M SUR 24H) */}
            <div style={{
              background: hoveredToken.isBuyDominant ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid ${hoveredToken.isBuyDominant ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}`,
              borderRadius: '6px',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem' }}>
                <span style={{ color: hoveredToken.isBuyDominant ? '#00ff88' : '#ff6b6b', fontWeight: '900' }}>
                  {hoveredToken.isBuyDominant ? `🟢 ACHATS DOMINANTS (+${hoveredToken.buyPct.toFixed(1)}%)` : `🔴 VENTES DOMINANTES (${hoveredToken.sellPct.toFixed(1)}%)`}
                </span>
                <span style={{ fontSize: '0.62rem', color: '#94a3b8' }}>
                  Bougies 15m
                </span>
              </div>
              {/* Mini jauge bicolore Buy / Sell */}
              <div style={{ width: '100%', height: '5px', background: '#ef4444', borderRadius: '3px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${hoveredToken.buyPct}%`, height: '100%', background: '#10b981' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#94a3b8' }}>
              <span>Volume Achat (24h) :</span>
              <span style={{ color: '#00ff88', fontWeight: '800' }}>
                {formatCompactUSD(hoveredToken.globalBuyVol)} ({hoveredToken.buyPct.toFixed(1)}%)
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#94a3b8' }}>
              <span>Volume Vente (24h) :</span>
              <span style={{ color: '#ff6b6b', fontWeight: '800' }}>
                {formatCompactUSD(hoveredToken.globalSellVol)} ({hoveredToken.sellPct.toFixed(1)}%)
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#94a3b8' }}>
              <span>Net Delta (L-Far9) :</span>
              <span style={{ color: hoveredToken.isBuyDominant ? '#00ff88' : '#ff6b6b', fontWeight: '900' }}>
                {hoveredToken.globalNetDelta >= 0 ? '+' : ''}{formatCompactUSD(hoveredToken.globalNetDelta)}
              </span>
            </div>

            <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.08)', margin: '2px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>Volume Global (CoinGecko):</span>
              <span style={{ color: '#ffffff', fontWeight: '700' }}>
                {formatCompactUSD(hoveredToken.vol24h)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8' }}>
              <span>Market Cap (CoinGecko):</span>
              <span style={{ color: '#ffffff', fontWeight: '700' }}>
                {formatCompactUSD(hoveredToken.mcap)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#f59e0b', fontWeight: '800', marginTop: '2px' }}>
              <span>Ratio Vol/MC:</span>
              <span style={{ fontSize: '0.92rem' }}>
                {hoveredToken.ratio.toFixed(2)}%
              </span>
            </div>

            <div style={{
              fontSize: '0.62rem',
              color: '#38bdf8',
              marginTop: '4px',
              borderTop: '1px dashed rgba(255, 255, 255, 0.08)',
              paddingTop: '4px',
              textAlign: 'center'
            }}>
              👉 Cliquez pour cibler ce token sur le graphique
            </div>
          </div>
        )}
      </div>

      {/* 💡 BANNIÈRE PÉDAGOGIQUE & ANALYTIQUE : POURQUOI LE RATIO VOL/MC EST LE FILTRE CLÉ */}
      <div style={{
        background: 'rgba(245, 158, 11, 0.04)',
        border: '1px solid rgba(245, 158, 11, 0.15)',
        borderRadius: '8px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '0.75rem',
        color: '#94a3b8',
        lineHeight: '1.4'
      }}>
        <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>💡</span>
        <div>
          <strong style={{ color: '#f59e0b' }}>Mécanique du Filtre de Résistance : </strong>
          Le ratio <em>Volume 24h / Market Cap</em> mesure la <strong style={{ color: '#e2e8f0' }}>vélocité de rotation du capital</strong>. 
          Les tokens affichant un ratio supérieur à <span style={{ color: '#00ff88', fontWeight: '800' }}>20% - 50%+</span> injectent un volume suffisant pour absorber instantanément tout le mur d'offre vendeuse à la résistance macro, transformant la résistance en tremplin de cassure explosive.
        </div>
      </div>
    </div>
  );
}

// ========================================================================================
// 📊 COMPOSANT DÉDIÉ : HISTOGRAMME DE VOLUME PAR ZONE (VOLUME PROFILE PUR & POC)
// ========================================================================================
function StandalonePureVolumeProfileWorkspace({
  tokensData = [],
  activeChartHorizon,
  setActiveChartHorizon,
  onSelectToken,
  chartHeight = 560
}) {
  const [viewScope, setViewScope] = useState('MARKET'); // 'MARKET' (Toutes les 50 Altcoins) | 'SOLO' (Token spécifique)
  const [selectedSoloTokenSymbol, setSelectedSoloTokenSymbol] = useState(null);
  const [searchTokenQuery, setSearchTokenQuery] = useState('');
  const [hoveredZoneLvl, setHoveredZoneLvl] = useState(null);

  // 1. Filtrer les tokens sans BTC ni ETH
  const altcoinsList = useMemo(() => {
    return (tokensData || []).filter(t => t.cleanSymbol !== 'BTC' && t.cleanSymbol !== 'ETH');
  }, [tokensData]);

  // Token actif en mode solo
  const activeSoloToken = useMemo(() => {
    if (selectedSoloTokenSymbol) {
      const found = altcoinsList.find(t => t.cleanSymbol === selectedSoloTokenSymbol);
      if (found) return found;
    }
    return altcoinsList.length > 0 ? altcoinsList[0] : null;
  }, [altcoinsList, selectedSoloTokenSymbol]);

  // 2. Calcul des Zones & Histogramme
  const profileHistogramData = useMemo(() => {
    if (!altcoinsList || altcoinsList.length === 0) return null;

    if (viewScope === 'SOLO' && activeSoloToken) {
      // 🟢 MODE SOLO : Histogramme de volume basé sur les prix réels en USDT du token
      const klines = activeSoloToken.rawKlines || [];
      const len = klines.length;
      if (len < 15) return null;

      const numBars = activeChartHorizon === 'day' ? 96 : activeChartHorizon === 'week' ? 672 : 1000;
      const sliced = klines.slice(Math.max(0, len - numBars));

      let pMin = Infinity;
      let pMax = -Infinity;
      sliced.forEach(k => {
        const h = parseFloat(k[2]);
        const l = parseFloat(k[3]);
        if (h > pMax) pMax = h;
        if (l < pMin) pMin = l;
      });

      if (pMin === Infinity || pMax === -Infinity || pMin === pMax) return null;

      const numBins = 18;
      const binStep = (pMax - pMin) / numBins;
      const bins = [];

      for (let i = 0; i < numBins; i++) {
        bins.push({
          idx: i,
          priceLow: pMin + i * binStep,
          priceHigh: pMin + (i + 1) * binStep,
          priceMid: pMin + (i + 0.5) * binStep,
          label: `$${(pMin + i * binStep).toFixed(pMin < 1 ? 4 : 2)} - $${(pMin + (i + 1) * binStep).toFixed(pMin < 1 ? 4 : 2)}`,
          volume: 0,
          upVolume: 0,
          downVolume: 0,
          tokens: [activeSoloToken]
        });
      }

      let totalMarketVol = 0;
      let totalUpVol = 0;
      let totalDownVol = 0;

      sliced.forEach(k => {
        const pOpen = parseFloat(k[1]);
        const pClose = parseFloat(k[4]);
        const pHigh = parseFloat(k[2]);
        const pLow = parseFloat(k[3]);
        const vol = parseFloat(k[6]) || parseFloat(k[5]) || 0;
        const isUp = pClose >= pOpen;

        const cRange = Math.max(0.000001, pHigh - pLow);

        bins.forEach(b => {
          const overlap = Math.max(0, Math.min(b.priceHigh, pHigh) - Math.max(b.priceLow, pLow));
          if (overlap > 0) {
            const fraction = overlap / cRange;
            const assignedVol = vol * fraction;
            b.volume += assignedVol;
            totalMarketVol += assignedVol;
            if (isUp) {
              b.upVolume += assignedVol;
              totalUpVol += assignedVol;
            } else {
              b.downVolume += assignedVol;
              totalDownVol += assignedVol;
            }
          }
        });
      });

      let maxBinVol = 0;
      let pocIdx = 0;
      bins.forEach((b, idx) => {
        if (b.volume > maxBinVol) {
          maxBinVol = b.volume;
          pocIdx = idx;
        }
      });

      // Value Area (70%)
      const targetVaVol = totalMarketVol * 0.70;
      let currentVaVol = bins[pocIdx]?.volume || 0;
      let upIdx = pocIdx;
      let downIdx = pocIdx;

      while (currentVaVol < targetVaVol && (upIdx < numBins - 1 || downIdx > 0)) {
        const nextUp = upIdx < numBins - 1 ? bins[upIdx + 1].volume : -1;
        const nextDown = downIdx > 0 ? bins[downIdx - 1].volume : -1;
        if (nextUp >= nextDown && nextUp !== -1) {
          upIdx++;
          currentVaVol += nextUp;
        } else if (nextDown !== -1) {
          downIdx--;
          currentVaVol += nextDown;
        } else {
          break;
        }
      }

      return {
        mode: 'SOLO',
        tokenSymbol: activeSoloToken.cleanSymbol,
        totalVolume: totalMarketVol,
        totalUpVol,
        totalDownVol,
        pocZone: bins[pocIdx],
        vaLow: bins[downIdx]?.priceLow || pMin,
        vaHigh: bins[upIdx]?.priceHigh || pMax,
        maxBinVol,
        zones: bins.map(b => ({
          ...b,
          isPoc: b.idx === pocIdx,
          inVa: b.idx >= downIdx && b.idx <= upIdx,
          pctOfMax: maxBinVol > 0 ? (b.volume / maxBinVol) * 100 : 0,
          pctOfTotal: totalMarketVol > 0 ? (b.volume / totalMarketVol) * 100 : 0,
          upPct: b.volume > 0 ? (b.upVolume / b.volume) * 100 : 50,
          downPct: b.volume > 0 ? (b.downVolume / b.volume) * 100 : 50
        }))
      };
    }

    // 🟡 MODE COLLECTIF (MARKET) : Histogramme par Zone de Points (-15 pts à +25 pts)
    const bucketStep = 1.0; // 1 pt par bucket
    const bucketsMap = {};
    let totalMarketVol = 0;
    let totalUpVol = 0;
    let totalDownVol = 0;

    altcoinsList.forEach(token => {
      const klines = token.rawKlines || [];
      const len = klines.length;
      if (len < 15) return;

      const numBars = activeChartHorizon === 'day' ? 96 : activeChartHorizon === 'week' ? 672 : 1000;
      const sliced = klines.slice(Math.max(0, len - numBars));
      const startPrice = parseFloat(sliced[0][4]);
      if (!startPrice || startPrice <= 0) return;

      sliced.forEach(k => {
        const pOpen = parseFloat(k[1]);
        const pClose = parseFloat(k[4]);
        const tOver = parseFloat(k[6]) || 0;

        if (pClose > 0 && tOver > 0) {
          const perf = ((pClose - startPrice) / startPrice) * 100;
          const bucketKey = Math.floor(perf / bucketStep) * bucketStep;

          if (!bucketsMap[bucketKey]) {
            bucketsMap[bucketKey] = {
              lvl: bucketKey,
              volume: 0,
              upVolume: 0,
              downVolume: 0,
              tokensMap: {}
            };
          }

          bucketsMap[bucketKey].volume += tOver;
          totalMarketVol += tOver;

          if (pClose >= pOpen) {
            bucketsMap[bucketKey].upVolume += tOver;
            totalUpVol += tOver;
          } else {
            bucketsMap[bucketKey].downVolume += tOver;
            totalDownVol += tOver;
          }

          if (!bucketsMap[bucketKey].tokensMap[token.cleanSymbol]) {
            bucketsMap[bucketKey].tokensMap[token.cleanSymbol] = {
              symbol: token.cleanSymbol,
              turnover: 0
            };
          }
          bucketsMap[bucketKey].tokensMap[token.cleanSymbol].turnover += tOver;
        }
      });
    });

    const sortedKeys = Object.keys(bucketsMap).map(Number).sort((a, b) => a - b);
    if (sortedKeys.length === 0) return null;

    let maxBucketVol = 0;
    let pocLvl = 0;

    sortedKeys.forEach(k => {
      const b = bucketsMap[k];
      if (b.volume > maxBucketVol) {
        maxBucketVol = b.volume;
        pocLvl = k;
      }
    });

    // Value Area (70%)
    const targetVaVol = totalMarketVol * 0.70;
    let currentVaVol = bucketsMap[pocLvl]?.volume || 0;
    let pocIdx = sortedKeys.indexOf(pocLvl);
    let upIdx = pocIdx;
    let downIdx = pocIdx;

    while (currentVaVol < targetVaVol && (upIdx < sortedKeys.length - 1 || downIdx > 0)) {
      const nextUpKey = upIdx < sortedKeys.length - 1 ? sortedKeys[upIdx + 1] : null;
      const nextDownKey = downIdx > 0 ? sortedKeys[downIdx - 1] : null;

      const nextUpVol = nextUpKey !== null ? bucketsMap[nextUpKey].volume : -1;
      const nextDownVol = nextDownKey !== null ? bucketsMap[nextDownKey].volume : -1;

      if (nextUpVol >= nextDownVol && nextUpVol !== -1) {
        upIdx++;
        currentVaVol += nextUpVol;
      } else if (nextDownVol !== -1) {
        downIdx--;
        currentVaVol += nextDownVol;
      } else {
        break;
      }
    }

    const vaLow = sortedKeys[downIdx];
    const vaHigh = sortedKeys[upIdx];

    // Calcul des zones avec filtres
    const zones = sortedKeys.map(k => {
      const b = bucketsMap[k];
      const tokenList = Object.values(b.tokensMap).sort((t1, t2) => t2.turnover - t1.turnover);
      const isPoc = k === pocLvl;
      const inVa = k >= vaLow && k <= vaHigh;
      const isHvn = !isPoc && (b.volume >= maxBucketVol * 0.65);
      const isLvn = b.volume <= maxBucketVol * 0.20 && inVa;

      return {
        lvl: k,
        label: `Zone ${k >= 0 ? `+${k}` : k} pts`,
        volume: b.volume,
        upVolume: b.upVolume,
        downVolume: b.downVolume,
        isPoc,
        inVa,
        isHvn,
        isLvn,
        tokenList,
        tokenCount: tokenList.length,
        pctOfMax: maxBucketVol > 0 ? (b.volume / maxBucketVol) * 100 : 0,
        pctOfTotal: totalMarketVol > 0 ? (b.volume / totalMarketVol) * 100 : 0,
        upPct: b.volume > 0 ? (b.upVolume / b.volume) * 100 : 50,
        downPct: b.volume > 0 ? (b.downVolume / b.volume) * 100 : 50
      };
    });

    return {
      mode: 'MARKET',
      totalVolume: totalMarketVol,
      totalUpVol,
      totalDownVol,
      pocZone: zones.find(z => z.isPoc),
      vaLow,
      vaHigh,
      maxBucketVol,
      zones
    };
  }, [altcoinsList, viewScope, activeSoloToken, activeChartHorizon]);

  // Filtrage des zones si recherche d'un token
  const filteredZones = useMemo(() => {
    if (!profileHistogramData || !profileHistogramData.zones) return [];
    const query = searchTokenQuery.trim().toUpperCase();
    if (!query) return profileHistogramData.zones;

    return profileHistogramData.zones.filter(z => {
      if (z.tokenList && z.tokenList.some(t => t.symbol.includes(query))) return true;
      if (z.label.toUpperCase().includes(query)) return true;
      return false;
    });
  }, [profileHistogramData, searchTokenQuery]);

  const totalBuyPct = profileHistogramData?.totalVolume > 0
    ? ((profileHistogramData.totalUpVol / profileHistogramData.totalVolume) * 100).toFixed(1)
    : '50.0';
  const totalSellPct = profileHistogramData?.totalVolume > 0
    ? ((profileHistogramData.totalDownVol / profileHistogramData.totalVolume) * 100).toFixed(1)
    : '50.0';

  return (
    <div style={{
      background: '#0a1519',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '12px',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      boxShadow: 'none',
      position: 'relative'
    }}>
      {/* 🏷️ 1. BARRE DE TITRE & CONTRÔLES SUPÉRIEURS */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
        background: '#0a0f1d',
        padding: '10px 14px',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{
            background: 'rgba(250, 204, 21, 0.1)',
            color: '#facc15',
            border: '1px solid rgba(250, 204, 21, 0.3)',
            padding: '5px 12px',
            borderRadius: '6px',
            fontWeight: '900',
            fontSize: '0.80rem',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: 'none'
          }}>
            <BarChart2 size={16} color="#facc15" />
            <span>HISTOGRAMME DE VOLUME (VOLUME PROFILE)</span>
          </div>

          <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.5)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => setViewScope('MARKET')}
              style={{
                background: viewScope === 'MARKET' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: viewScope === 'MARKET' ? '#38bdf8' : '#64748b',
                border: viewScope === 'MARKET' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '0.74rem',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              👑 TOP 50 ALTCOINS (COLLECTIF)
            </button>
            <button
              onClick={() => setViewScope('SOLO')}
              style={{
                background: viewScope === 'SOLO' ? 'rgba(168, 85, 247, 0.15)' : 'transparent',
                color: viewScope === 'SOLO' ? '#c084fc' : '#64748b',
                border: viewScope === 'SOLO' ? '1px solid rgba(168, 85, 247, 0.4)' : '1px solid transparent',
                padding: '4px 10px',
                borderRadius: '5px',
                fontSize: '0.74rem',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              🎯 TOKEN UNIQUE (PRIX USDT)
            </button>
          </div>
        </div>

        {/* Horizons Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ display: 'flex', background: 'rgba(0, 0, 0, 0.5)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={() => setActiveChartHorizon('month')}
              style={{
                background: activeChartHorizon === 'month' ? 'rgba(250, 204, 21, 0.15)' : 'transparent',
                color: activeChartHorizon === 'month' ? '#facc15' : '#64748b',
                border: activeChartHorizon === 'month' ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid transparent',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              📅 30D (MOIS)
            </button>
            <button
              onClick={() => setActiveChartHorizon('week')}
              style={{
                background: activeChartHorizon === 'week' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: activeChartHorizon === 'week' ? '#38bdf8' : '#64748b',
                border: activeChartHorizon === 'week' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              📊 7D (SEMAINE)
            </button>
            <button
              onClick={() => setActiveChartHorizon('day')}
              style={{
                background: activeChartHorizon === 'day' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                color: activeChartHorizon === 'day' ? '#10b981' : '#64748b',
                border: activeChartHorizon === 'day' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: 'none'
              }}
            >
              ☀️ 24H (JOUR)
            </button>
          </div>

          {/* Recherche */}
          <div style={{ position: 'relative', minWidth: '140px' }}>
            <input
              type="text"
              placeholder="🔍 Filtrer token..."
              value={searchTokenQuery}
              onChange={(e) => setSearchTokenQuery(e.target.value)}
              style={{
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '5px',
                fontSize: '0.72rem',
                width: '100%',
                outline: 'none'
              }}
            />
          </div>
        </div>
      </div>

      {/* 🏷️ 2. CARTES STATS ET SYNTHÈSE LIQUIDITÉ EN HAUT */}
      {profileHistogramData && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '10px'
        }}>
          {/* CARTE 1: POC */}
          <div style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: '950', color: '#f87171' }}>🔴 POINT OF CONTROL (POC)</span>
              <span style={{ fontSize: '0.68rem', background: 'rgba(239, 68, 68, 0.3)', color: '#fca5a5', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>MAX VOL</span>
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: '950', color: '#ffffff' }}>
              {profileHistogramData.pocZone ? profileHistogramData.pocZone.label : 'N/A'}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
              Volume : <strong style={{ color: '#facc15' }}>{formatVolumeUSDT(profileHistogramData.pocZone?.volume || 0)}</strong> ({profileHistogramData.pocZone?.pctOfTotal.toFixed(1)}% du marché)
            </div>
          </div>

          {/* CARTE 2: VALUE AREA */}
          <div style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: '950', color: '#fbbf24' }}>🛡️ VALUE AREA (70% VOLUME)</span>
              <span style={{ fontSize: '0.68rem', background: 'rgba(245, 158, 11, 0.3)', color: '#fde68a', padding: '1px 6px', borderRadius: '4px', fontWeight: 'bold' }}>VAH - VAL</span>
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: '950', color: '#ffffff' }}>
              {profileHistogramData.mode === 'SOLO'
                ? `$${profileHistogramData.vaLow.toFixed(2)} à $${profileHistogramData.vaHigh.toFixed(2)}`
                : `${profileHistogramData.vaLow >= 0 ? `+${profileHistogramData.vaLow}` : profileHistogramData.vaLow} à ${profileHistogramData.vaHigh >= 0 ? `+${profileHistogramData.vaHigh}` : profileHistogramData.vaHigh} pts`}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
              Zone majeure de négociation et d'accord sur le prix
            </div>
          </div>

          {/* CARTE 3: VOLUME TOTAL & RATIO ACHAT / VENTE */}
          <div style={{
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: '8px',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: '950', color: '#7dd3fc' }}>💰 VOLUME TOTAL DANS LA PÉRIODE</span>
              <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>BTC/ETH EXCLUS</span>
            </div>
            <div style={{ fontSize: '1.05rem', fontWeight: '950', color: '#38bdf8' }}>
              {formatVolumeUSDT(profileHistogramData.totalVolume)}
            </div>
            <div style={{ fontSize: '0.72rem', color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#facc15' }}>🟡 Achat: <strong>{totalBuyPct}%</strong></span>
              <span style={{ color: '#38bdf8' }}>🔵 Vente: <strong>{totalSellPct}%</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* 🏷️ 3. SÉLECTEUR DE TOKEN EN MODE SOLO */}
      {viewScope === 'SOLO' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          overflowX: 'auto',
          padding: '4px 0',
          scrollbarWidth: 'thin'
        }}>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 'bold', flexShrink: 0 }}>Choisir Token :</span>
          {altcoinsList.slice(0, 30).map((t, idx) => {
            const isSelected = activeSoloToken?.cleanSymbol === t.cleanSymbol;
            const color = getTokenFixedColor(t.cleanSymbol);
            return (
              <button
                key={t.cleanSymbol}
                onClick={() => setSelectedSoloTokenSymbol(t.cleanSymbol)}
                style={{
                  background: isSelected ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)',
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  border: isSelected ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.06)',
                  padding: '4px 10px',
                  borderRadius: '5px',
                  fontSize: '0.70rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: 'none'
                }}
              >
                <span style={{ color }}>●</span>
                <span>#{idx + 1} {t.cleanSymbol}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 📊 4. LE GRAND HISTOGRAMME HORIZONTAL PAR ZONE (DE HAUT EN BAS) */}
      <div style={{
        background: '#060a14',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '8px',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxHeight: `${chartHeight + 100}px`,
        overflowY: 'auto'
      }}>
        {filteredZones.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
            Aucune donnée de volume trouvée pour cette sélection.
          </div>
        ) : (
          filteredZones.slice().reverse().map(zone => {
            const isPoc = zone.isPoc;
            const inVa = zone.inVa;
            const isHovered = hoveredZoneLvl === zone.lvl;

            return (
              <div
                key={zone.lvl || zone.idx}
                onMouseEnter={() => setHoveredZoneLvl(zone.lvl)}
                onMouseLeave={() => setHoveredZoneLvl(null)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 1fr 140px 220px',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  background: isPoc
                    ? 'rgba(239, 68, 68, 0.12)'
                    : isHovered
                      ? 'rgba(255, 255, 255, 0.05)'
                      : inVa
                        ? 'rgba(250, 204, 21, 0.03)'
                        : 'transparent',
                  borderLeft: isPoc
                    ? '4px solid #ef4444'
                    : zone.isHvn
                      ? '4px solid #38bdf8'
                      : zone.isLvn
                        ? '4px solid #ec4899'
                        : '4px solid transparent',
                  transition: 'background 0.15s ease'
                }}
              >
                {/* 1. LABEL DE LA ZONE */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                      fontWeight: isPoc ? '950' : 'bold',
                      fontSize: '0.82rem',
                      color: isPoc ? '#f87171' : inVa ? '#facc15' : '#cbd5e1'
                    }}>
                      {zone.label}
                    </span>
                  </div>

                  {/* Badges Spéciaux */}
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {isPoc && (
                      <span style={{ fontSize: '0.60rem', background: '#ef4444', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontWeight: '950' }}>
                        👑 POC
                      </span>
                    )}
                    {zone.isHvn && (
                      <span style={{ fontSize: '0.60rem', background: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>
                        🛡️ SUPPORT
                      </span>
                    )}
                    {zone.isLvn && (
                      <span style={{ fontSize: '0.60rem', background: 'rgba(236, 72, 153, 0.3)', color: '#ec4899', padding: '1px 5px', borderRadius: '3px', fontWeight: 'bold' }}>
                        ⚡ ACCÉLÉRATION
                      </span>
                    )}
                  </div>
                </div>

                {/* 2. GRANDE BARRE HORIZONALE BI-COULEUR (JAUNE ACHAT + BLEU VENTE) */}
                <div style={{
                  position: 'relative',
                  width: '100%',
                  height: '26px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  {/* Conteneur de la barre proportionnelle */}
                  <div style={{
                    display: 'flex',
                    height: '100%',
                    width: `${Math.max(4, zone.pctOfMax)}%`,
                    borderRadius: '4px',
                    overflow: 'hidden',
                    boxShadow: 'none',
                    transition: 'width 0.3s ease'
                  }}>
                    {/* Portion Achat (Jaune) */}
                    <div style={{
                      width: `${zone.upPct}%`,
                      height: '100%',
                      background: isPoc ? '#facc15' : inVa ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'rgba(245, 158, 11, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      paddingLeft: '6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap'
                    }}>
                      {zone.pctOfMax > 25 && zone.upPct > 15 && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#000' }}>
                          🟡 {formatVolumeUSDT(zone.upVolume)}
                        </span>
                      )}
                    </div>

                    {/* Portion Vente (Bleu) */}
                    <div style={{
                      width: `${zone.downPct}%`,
                      height: '100%',
                      background: isPoc ? '#ef4444' : inVa ? 'linear-gradient(90deg, #0284c7, #38bdf8)' : 'rgba(56, 189, 248, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      paddingRight: '6px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap'
                    }}>
                      {zone.pctOfMax > 25 && zone.downPct > 15 && (
                        <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#fff' }}>
                          🔵 {formatVolumeUSDT(zone.downVolume)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. MONTANT TOTAL EN USDT & % DU MARCHÉ */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <span style={{
                    fontSize: '0.82rem',
                    fontWeight: isPoc ? '950' : 'bold',
                    color: isPoc ? '#f87171' : '#ffffff'
                  }}>
                    {formatVolumeUSDT(zone.volume)}
                  </span>
                  <span style={{ fontSize: '0.66rem', color: '#94a3b8' }}>
                    {zone.pctOfTotal.toFixed(1)}% du total
                  </span>
                </div>

                {/* 4. LISTE DES TOKENS PRÉSENTS DANS CETTE ZONE */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  padding: '2px 0'
                }}>
                  {zone.tokenList && zone.tokenList.length > 0 ? (
                    zone.tokenList.slice(0, 6).map(t => {
                      const color = getTokenFixedColor(t.symbol);
                      return (
                        <button
                          key={t.symbol}
                          onClick={() => {
                            const fullTok = altcoinsList.find(a => a.cleanSymbol === t.symbol);
                            if (fullTok && onSelectToken) onSelectToken(fullTok);
                          }}
                          title={`${t.symbol} : ${formatVolumeUSDT(t.turnover)}`}
                          style={{
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: `1px solid ${color}66`,
                            color: '#ffffff',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontSize: '0.65rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            flexShrink: 0,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                        >
                          <span style={{ color }}>●</span>
                          <span>{t.symbol}</span>
                        </button>
                      );
                    })
                  ) : (
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>-</span>
                  )}
                  {zone.tokenList && zone.tokenList.length > 6 && (
                    <span style={{ fontSize: '0.62rem', color: '#94a3b8', background: 'rgba(255,255,255,0.04)', padding: '2px 4px', borderRadius: '3px' }}>
                      +{zone.tokenList.length - 6}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}








export default function MonthlyTop50BenchmarkComparator() {
  const [tokensData, setTokensData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progressMsg, setProgressMsg] = useState('Démarrage du scan...');
  const [progressPct, setProgressPct] = useState(0);
  const [totalSymbolsCount, setTotalSymbolsCount] = useState(400);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTripleOnly, setFilterTripleOnly] = useState(false);
  const [activeChartHorizon, setActiveChartHorizon] = useState('month');
  const [is4ChartsSplitView, setIs4ChartsSplitView] = useState(false); // 'month' | 'week' | 'day'
  const [selectedTokenModal, setSelectedTokenModal] = useState(null);
  const [lastLiveUpdate, setLastLiveUpdate] = useState(new Date().toLocaleTimeString());

  const isScanningRef = useRef(false);
  const nextRefreshTimeoutRef = useRef(null);
  const livePricesRef = useRef({});

  // Hauteur dynamique du graphique avec redimensionnement à la souris
  const [chartHeight, setChartHeight] = useState(520);
  const [isDraggingHeight, setIsDraggingHeight] = useState(false);
  const [showTables, setShowTables] = useState(false);
  const [selectedPhaseFilter, setSelectedPhaseFilter] = useState('ALL');
  const [selectedTopCount, setSelectedTopCount] = useState(50); // 5, 10, 20, 50
  const [selectedPeakTopCount, setSelectedPeakTopCount] = useState(50); // 5, 10, 20, 50 for Max Points Table
  const [chartUniverse, setChartUniverse] = useState('MONTH_SCORE'); // 'MONTH_SCORE' | 'MONTH_PEAK'
  const [selectedSoloToken, setSelectedSoloToken] = useState(null);
  const [selectedPatternFilter, setSelectedPatternFilter] = useState('ALL');
  const [filterAboveStopLossOnly, setFilterAboveStopLossOnly] = useState(false); // Masquer les tokens sous SL (désactivé par défaut)
  const [filterFreshBreakoutsOnly, setFilterFreshBreakoutsOnly] = useState(false); // Masquer les anciens tokens ayant déjà touché la zone verte (Target)
  const [showVolumeProfile, setShowVolumeProfile] = useState(false); // Désactivé par défaut
  const [vpvrWidthMode, setVpvrWidthMode] = useState('RIGHT');
  const [vpvrZoneScope, setVpvrZoneScope] = useState('PUMP');
  const [activeMainChartMode, setActiveMainChartMode] = useState('CURVES');
  const [showCorridorSniperChart, setShowCorridorSniperChart] = useState(true);
  const [showHhRadarChart, setShowHhRadarChart] = useState(true);
  const [showTop5DualChart, setShowTop5DualChart] = useState(true);
  const [showBreakoutDiagnostics, setShowBreakoutDiagnostics] = useState(true);
  const [showVolMcapChart, setShowVolMcapChart] = useState(false); // Désactivé par défaut
  const [showMainChart, setShowMainChart] = useState(true); // Afficher / Masquer la charte principale benchmark Top 50
  const [dailyMarketCaps, setDailyMarketCaps] = useState({});
  const [dailyCgData, setDailyCgData] = useState({}); // { [SYM]: { volume: number, marketCap: number, price: number } }

  // 🦙 Récupération groupée CoinGecko (Volume Global 24h & Market Cap) pour l'intégralité du Top 50 Daily
  useEffect(() => {
    if (!tokensData || tokensData.length === 0) return;
    const top50Daily = [...tokensData].sort((a, b) => b.scoreDay - a.scoreDay).slice(0, 50);
    if (top50Daily.length === 0) return;

    const syms = top50Daily.map(t => (t.cleanSymbol || '').toLowerCase()).filter(Boolean);
    if (syms.length === 0) return;

    // Charger immédiatement les données en cache
    const initialCg = {};
    const initialCaps = {};
    const now = Date.now();
    const missingSyms = syms.filter(s => {
      const up = s.toUpperCase();
      const cached = CG_DATA_CACHE.map.get(up);
      if (cached) {
        initialCg[up] = cached;
        if (cached.marketCap) initialCaps[up] = cached.marketCap;
      }
      return !cached || (now - (cached.timestamp || 0) > 180000);
    });

    if (Object.keys(initialCg).length > 0) {
      setDailyCgData(prev => ({ ...prev, ...initialCg }));
      setDailyMarketCaps(prev => ({ ...prev, ...initialCaps }));
    }

    if (missingSyms.length === 0) return;

    const fetchCaps = async () => {
      try {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${missingSyms.join(',')}&per_page=100&page=1`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            const cgMap = {};
            const capsMap = {};
            data.forEach(c => {
              if (c && c.symbol) {
                const up = c.symbol.toUpperCase();
                const cur = cgMap[up];
                if (!cur || (c.market_cap && c.market_cap > (cur.marketCap || 0))) {
                  const entry = {
                    volume: c.total_volume || 0,
                    marketCap: c.market_cap || 0,
                    price: c.current_price || 0,
                    timestamp: Date.now()
                  };
                  cgMap[up] = entry;
                  CG_DATA_CACHE.map.set(up, entry);
                  if (c.market_cap) {
                    capsMap[up] = c.market_cap;
                    CG_TOP_MARKETS_CACHE.map.set(up, c.market_cap);
                  }
                }
              }
            });
            setDailyCgData(prev => ({ ...prev, ...cgMap }));
            setDailyMarketCaps(prev => ({ ...prev, ...capsMap }));
          }
        }
      } catch (err) {
        console.warn('[DailyCgData] Batch fetch notice:', err.message);
      }
    };

    fetchCaps();
  }, [tokensData]);

  useEffect(() => {
    if (showMainChart && chartRef.current && chartContainerRef.current) {
      setTimeout(() => {
        try {
          chartRef.current.resize(chartContainerRef.current.clientWidth || 800, chartHeight);
        } catch (_) {}
      }, 50);
    }
  }, [showMainChart, chartHeight]);

  // ₿ Données de Sentiment BTC en direct (Prix, %, Statut Pression vs Soulagement)
  const [btcMarketData, setBtcMarketData] = useState({
    price: 0,
    change24h: 0,
    isPositive: true,
    turnover24h: 0
  });
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [hoveredProfileBucketLvl, setHoveredProfileBucketLvl] = useState(null);
  const [selectedProfileBucketLvl, setSelectedProfileBucketLvl] = useState(null);
  const soloCandleSeriesRef = useRef(null);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(520);

  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesMapRef = useRef({});
  const refMonthlySeriesRef = useRef(null);
  const refDailyMaxSeriesRef = useRef(null);
  const refEma20SeriesRef = useRef(null);
  const refEma50SeriesRef = useRef(null);
  const refWeeklyEma20SeriesRef = useRef(null);
  const refMonthlyEma20SeriesRef = useRef(null);
  const refDailyMinSeriesRef = useRef(null);
  const ref24hRejectionWallSeriesRef = useRef(null);
  const ref24hLaunchpadSeriesRef = useRef(null);
  const refSniperEntrySeriesRef = useRef(null);
  const refSniperStopLossSeriesRef = useRef(null);
  const refPocSeriesRef = useRef(null);
  const refScaleAnchorSeriesRef = useRef(null);
  const hasFittedOnceRef = useRef(false);

  // Synthetic Candlestick Chart Refs & State
  const syntheticChartContainerRef = useRef(null);
  const syntheticChartRef = useRef(null);
  const syntheticCandleSeriesRef = useRef(null);
  const syntheticEma20SeriesRef = useRef(null);
  const syntheticEma50SeriesRef = useRef(null);
  const [syntheticEmaState, setSyntheticEmaState] = useState({ ema20: 0, ema50: 0, isBullish: true });
  const [syntheticHorizon, setSyntheticHorizon] = useState('day'); // 'day', 'week', 'month'
  const [syntheticHeight, setSyntheticHeight] = useState(380);

  // 🎯 TradingView Long Position / Risk-Reward Box State
  const [showTvRiskRewardTool, setShowTvRiskRewardTool] = useState(true);
  const [tvToolCoords, setTvToolCoords] = useState({
    valid: true,
    tpY: 120,
    entryY: 240,
    slY: 340,
    left: 200,
    width: 340
  });

  // 🔔 SYSTÈME D'ALERTES ET HISTORIQUE PERSISTANT LAUNCHPAD (LOCALSTORAGE)
  const [signalsHistory, setSignalsHistory] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LAUNCHPAD_SIGNALS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ALERT_SOUND);
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const [activeAlertToast, setActiveAlertToast] = useState(null);
  const [showSignalsModal, setShowSignalsModal] = useState(false);
  const [filterSignalStatus, setFilterSignalStatus] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'WIN' | 'STOPPED'
  const [searchSignalTerm, setSearchSignalTerm] = useState('');
  const toastTimeoutRef = useRef(null);
  const prevTokensScoresRef = useRef({});
  const isBaselineInitializedRef = useRef(false);

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    try { localStorage.setItem(STORAGE_KEY_ALERT_SOUND, JSON.stringify(next)); } catch (_) {}
    if (next) playLaunchpadAlertSound();
  };

  const handleResetToZero = () => {
    if (window.confirm('Voulez-vous recommencer à ZÉRO ? Tous les anciens signaux seront effacés et le scanner attendra uniquement les nouveaux départs en direct.')) {
      setSignalsHistory([]);
      try { localStorage.removeItem(STORAGE_KEY_LAUNCHPAD_SIGNALS); } catch (_) {}
      
      const newBase = {};
      if (chartProcessedData?.tokenCurvesMap) {
        Object.keys(chartProcessedData.tokenCurvesMap).forEach(sym => {
          const c = chartProcessedData.tokenCurvesMap[sym];
          if (c && c.length > 0) newBase[sym] = c[c.length - 1].value;
        });
      }
      prevTokensScoresRef.current = newBase;
      isBaselineInitializedRef.current = true;
    }
  };

  const handleClearSignalsHistory = () => {
    if (window.confirm('Voulez-vous vraiment effacer tout l\'historique des signaux Launchpad ?')) {
      setSignalsHistory([]);
      try { localStorage.removeItem(STORAGE_KEY_LAUNCHPAD_SIGNALS); } catch (_) {}
    }
  };

  const handleExportSignalsCsv = () => {
    if (signalsHistory.length === 0) return;
    const headers = ['Date', 'Heure', 'Token', 'Rang', 'Score_Entree', 'Niveau_Launchpad', 'Target_TP', 'Stop_Loss', 'Score_Actuel', 'Max_Score_Atteint', 'PnL_Points', 'Statut'];
    const rows = signalsHistory.map(s => [
      `"${s.dateLabel}"`, `"${s.timeLabel}"`, `"${s.symbol}"`, s.rank, s.triggerScore, s.launchpadLvl, s.tpLvl, s.slLvl, s.currentScore, s.maxScoreReached, s.pnlPts, `"${s.status}"`
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `nebula_launchpad_signals_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };





  // Gestion du glissement de la souris pour changer la hauteur
  const handleMouseDownHeight = (e) => {
    setIsDraggingHeight(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = chartHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingHeight) return;
      const deltaY = e.clientY - dragStartYRef.current;
      const newHeight = Math.max(320, Math.min(1200, dragStartHeightRef.current + deltaY));
      setChartHeight(newHeight);
      if (chartRef.current) {
        chartRef.current.applyOptions({ height: newHeight });
      }
    };
    const handleMouseUp = () => {
      if (isDraggingHeight) {
        setIsDraggingHeight(false);
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
      }
    };
    if (isDraggingHeight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingHeight]);

  // ⚡ FLUX EN DIRECT HAUTE FRÉQUENCE (Bybit Spot WebSocket + Poller Rapide 2.5s)
  useEffect(() => {
    let isMounted = true;
    let ws = null;
    let pingInterval = null;
    let reconnectTimeout = null;

    const connectWs = () => {
      try {
        ws = new WebSocket('wss://stream.bybit.com/v5/public/spot');

        ws.onopen = () => {
          if (!isMounted) {
            try { ws.close(); } catch (_) {}
            return;
          }
          // Souscrire à BTCUSDT
          ws.send(JSON.stringify({ op: 'subscribe', args: ['tickers.BTCUSDT'] }));

          // Souscrire aux tokens actifs (Top 50 / Corridor)
          const activeSymbols = tokensData.map(t => `${t.cleanSymbol}USDT`).slice(0, 80);
          for (let i = 0; i < activeSymbols.length; i += 10) {
            const chunk = activeSymbols.slice(i, i + 10).map(s => `tickers.${s}`);
            if (chunk.length > 0) {
              ws.send(JSON.stringify({ op: 'subscribe', args: chunk }));
            }
          }

          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 'ping' }));
            }
          }, 20000);
        };

        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.topic && msg.topic.startsWith('tickers.')) {
              const d = msg.data;
              const sym = d?.symbol || msg.topic.replace('tickers.', '');
              const cleanSym = sym.replace('USDT', '').toUpperCase();
              const lastPrice = parseFloat(d?.lastPrice);
              if (!isNaN(lastPrice) && lastPrice > 0) {
                livePricesRef.current[cleanSym] = lastPrice;

                if (cleanSym === 'BTC') {
                  const rawPcnt = parseFloat(d?.price24hPcnt || 0);
                  const p24 = Math.abs(rawPcnt) < 1 ? rawPcnt * 100 : rawPcnt;
                  setBtcMarketData(prev => ({
                    ...prev,
                    price: lastPrice,
                    change24h: !isNaN(p24) ? parseFloat(p24.toFixed(2)) : prev.change24h,
                    isPositive: p24 >= 0,
                    turnover24h: parseFloat(d?.turnover24h || prev.turnover24h || 0)
                  }));
                }
              }
            }
          } catch (_) {}
        };

        ws.onerror = () => {
          try { ws.close(); } catch (_) {}
        };

        ws.onclose = () => {
          if (pingInterval) clearInterval(pingInterval);
          if (isMounted) {
            reconnectTimeout = setTimeout(connectWs, 3000);
          }
        };
      } catch (_) {
        if (isMounted) {
          reconnectTimeout = setTimeout(connectWs, 5000);
        }
      }
    };

    connectWs();

    // 🔄 Filet de sécurité : Poller Rapide de TOUS les tickers Spot Bybit toutes les 2.5 secondes
    const fetchAllTickersLive = async () => {
      try {
        const res = await fetch('https://api.bybit.com/v5/market/tickers?category=spot');
        const data = await res.json();
        const list = data?.result?.list || [];
        if (list.length > 0 && isMounted) {
          list.forEach(item => {
            const cleanSym = (item.symbol || '').replace('USDT', '').toUpperCase();
            const lp = parseFloat(item.lastPrice || 0);
            if (lp > 0) {
              livePricesRef.current[cleanSym] = lp;
            }
            if (cleanSym === 'BTC') {
              const rawPcnt = parseFloat(item.price24hPcnt || 0);
              const p24 = Math.abs(rawPcnt) < 1 ? rawPcnt * 100 : rawPcnt;
              setBtcMarketData({
                price: lp,
                change24h: parseFloat(p24.toFixed(2)),
                isPositive: p24 >= 0,
                turnover24h: parseFloat(item.turnover24h || 0)
              });
            }
          });
        }
      } catch (_) {}
    };

    fetchAllTickersLive();
    const pollInterval = setInterval(fetchAllTickersLive, 2500);

    return () => {
      isMounted = false;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (pollInterval) clearInterval(pollInterval);
      if (ws) {
        try { ws.close(); } catch (_) {}
      }
    };
  }, [tokensData]);

  // 1. Scan de TOUS les tokens Bybit Spot USDT
  const loadMarketData = async (isSilent = false) => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;

    if (!isSilent) {
      setIsLoading(true);
      setProgressPct(5);
      setProgressMsg('Récupération de toutes les paires Bybit Spot...');
    }

    try {
      const rawTickers = await fetchTop500Symbols(true, 500);

      // ₿ Extraction immédiate des données réelles de BTCUSDT
      const btcRaw = (rawTickers || []).find(t => t && (t.symbol === 'BTCUSDT' || t.cleanSymbol === 'BTC'));
      if (btcRaw) {
        const rawPcnt = parseFloat(btcRaw.price24hPcnt || 0);
        const p24 = Math.abs(rawPcnt) < 1 ? rawPcnt * 100 : rawPcnt;
        const curPrice = parseFloat(btcRaw.lastPrice || 0);
        setBtcMarketData(prev => ({
          price: curPrice || prev.price,
          change24h: parseFloat(p24.toFixed(2)),
          isPositive: p24 >= 0,
          turnover24h: parseFloat(btcRaw.turnover24h || prev.turnover24h || 0)
        }));
      }

      const tickersTurnoverMap = {};
      (rawTickers || []).forEach(t => {
        if (t && typeof t === 'object') {
          const sym = (t.symbol || `${t.cleanSymbol}USDT`).toUpperCase();
          tickersTurnoverMap[sym] = parseFloat(t.turnover24h || 0);
        }
      });
      const bybitTickers = (rawTickers || []).map(t => (typeof t === 'string' ? t : t.symbol || `${t.cleanSymbol}USDT`));
      const historicalSymbols = Object.keys(tokenEntries || {}).map(k => `${k.toUpperCase()}USDT`);
      const combinedCandidatesSet = new Set([...bybitTickers, ...historicalSymbols]);

      const finalCandidates = Array.from(combinedCandidatesSet).filter(sym => {
        const clean = sym.replace('USDT', '').toUpperCase();
        // 🚫 Exclusion stricte de BTC et ETH (pour ne pas écraser les altcoins) et des actions tokenisées
        if (clean === 'BTC' || clean === 'ETH') return false;
        return !clean.endsWith('X') || !['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT', 'GOOGL', 'META'].some(s => clean.startsWith(s));
      });

      setTotalSymbolsCount(finalCandidates.length);

      const allResults = [];
      const BATCH_SIZE = 20;
      const total = finalCandidates.length;

      for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = finalCandidates.slice(i, i + BATCH_SIZE);
        const currentProgress = Math.min(99, Math.round(((i + batch.length) / total) * 100));

        if (!isSilent) {
          setProgressPct(currentProgress);
          setProgressMsg(`Scan des ${total} tokens Bybit : ${i + batch.length} / ${total} (${currentProgress}%)...`);
        }

        const promises = batch.map(async (symbol) => {
          const cleanSym = symbol.replace('USDT', '').toUpperCase();
          const klines = await fetchBybitKlines(symbol, '15', 1000);
          if (!klines || klines.length < 15) return null;

          const len = klines.length;
          const curPrice = parseFloat(klines[len - 1][4]);
          if (!curPrice || curPrice <= 0) return null;

          const getPerfAtOffset = (offset) => {
            if (len <= offset) return 0;
            const pastPrice = parseFloat(klines[len - 1 - offset][4]);
            if (!pastPrice || pastPrice <= 0) return 0;
            return parseFloat((((curPrice - pastPrice) / pastPrice) * 100).toFixed(2));
          };

          const p15m = getPerfAtOffset(1);
          const p1h  = getPerfAtOffset(4);
          const p4h  = getPerfAtOffset(16);
          const p1d  = getPerfAtOffset(96);
          const p1w  = getPerfAtOffset(672);
          const p30d = getPerfAtOffset(Math.min(999, len - 1));

          // 1. SCORE DU MOIS (30D)
          let confMonth = 0;
          if (p30d > 0) confMonth += 3.0;
          if (p1w  > 0) confMonth += 2.5;
          if (p1d  > 0) confMonth += 2.5;
          if (p4h  > 0) confMonth += 1.5;
          if (p1h  > 0) confMonth += 1.5;
          if (p15m > 0) confMonth += 1.0;
          const weightedPerfMonth = (p30d * 0.30) + (p1w * 0.20) + (p1d * 0.20) + (p4h * 0.15) + (p1h * 0.10) + (p15m * 0.05);
          const scoreMonth = parseFloat((confMonth + weightedPerfMonth).toFixed(2));

          // 2. SCORE DE LA SEMAINE (7D)
          let confWeek = 0;
          if (p1w  > 0) confWeek += 3.0;
          if (p1d  > 0) confWeek += 2.5;
          if (p4h  > 0) confWeek += 2.0;
          if (p1h  > 0) confWeek += 1.5;
          if (p15m > 0) confWeek += 1.0;
          const weightedPerfWeek = (p1w * 0.35) + (p1d * 0.25) + (p4h * 0.20) + (p1h * 0.12) + (p15m * 0.08);
          const scoreWeek = parseFloat((confWeek + weightedPerfWeek).toFixed(2));

          // 3. SCORE DU JOUR (24H)
          let confDay = 0;
          if (p1d  > 0) confDay += 3.0;
          if (p4h  > 0) confDay += 2.5;
          if (p1h  > 0) confDay += 1.5;
          if (p15m > 0) confDay += 1.0;
          const weightedPerfDay = (p1d * 0.40) + (p4h * 0.25) + (p1h * 0.20) + (p15m * 0.15);
          const scoreDay = parseFloat((confDay + weightedPerfDay).toFixed(2));

          // Extraire la courbe 24H et décomposer le volume 24H (96 bougies de 15m = 24 heures)
          const sliced24h = klines.slice(Math.max(0, len - 96));
          const start24hPrice = parseFloat(sliced24h[0][4]);
          const alpha = 2 / (8 + 1);
          let ema = 0;
          let turnover24h = 0;
          let volume24h = 0;
          let buyVol24h = 0;
          let sellVol24h = 0;
          const chartCurve24h = [];
          sliced24h.forEach((k, kIdx) => {
            const tTime = Math.floor(parseInt(k[0]) / 1000);
            const pHigh = parseFloat(k[2]);
            const pLow = parseFloat(k[3]);
            const pClose = parseFloat(k[4]);
            const pVol = parseFloat(k[5]) || 0;
            const pTurnover = parseFloat(k[6]) || (pVol * pClose) || 0;

            volume24h += pVol;
            turnover24h += pTurnover;

            // Décomposition volumétrique Intra-bougie 15m (Buy vs Sell)
            if (pHigh > pLow && pTurnover > 0) {
              const buyRatio = (pClose - pLow) / (pHigh - pLow);
              buyVol24h += pTurnover * buyRatio;
              sellVol24h += pTurnover * (1 - buyRatio);
            } else if (pTurnover > 0) {
              buyVol24h += pTurnover * 0.5;
              sellVol24h += pTurnover * 0.5;
            }

            if (tTime > 0 && pClose > 0) {
              const perf = start24hPrice > 0 ? ((pClose - start24hPrice) / start24hPrice) * 100 : 0;
              if (kIdx === 0) ema = perf;
              else ema = (perf * alpha) + (ema * (1 - alpha));
              chartCurve24h.push({ time: tTime, value: parseFloat(ema.toFixed(2)) });
            }
          });

          const totalDecomposedVol = buyVol24h + sellVol24h;
          const buyPct24h = totalDecomposedVol > 0 ? parseFloat(((buyVol24h / totalDecomposedVol) * 100).toFixed(1)) : 50;
          const sellPct24h = parseFloat((100 - buyPct24h).toFixed(1));
          const netDelta24h = buyVol24h - sellVol24h;

          // 🏛️ Calcul Institutionnel des Phases Macro sur le Chart du Mois (30D / 4H - Wyckoff & Weinstein)
          const klines4h = [];
          let high30d = -Infinity;
          let low30d = Infinity;

          for (let b = 0; b < len; b += 16) {
            const chunkEnd = Math.min(len - 1, b + 15);
            const openP = parseFloat(klines[b][1]);
            const closeP = parseFloat(klines[chunkEnd][4]);
            let highP = -Infinity, lowP = Infinity;
            for (let c = b; c <= chunkEnd; c++) {
              const h = parseFloat(klines[c][2]);
              const l = parseFloat(klines[c][3]);
              if (h > highP) highP = h;
              if (l < lowP) lowP = l;
              if (h > high30d) high30d = h;
              if (l < low30d) low30d = l;
            }
            klines4h.push({ open: openP, high: highP, low: lowP, close: closeP, time: parseInt(klines[b][0]) });
          }

          // 👑 LOGIQUE HIGHER HIGH 30D (RÈGLE DU RETEST HH) :
          // 1. Akbar niveau wsal lih token (prix le plus haut)
          // 2. Token khasso ikoun hbat 3la l-aqal b -2% (minLow <= high * 0.98)
          // 3. Mnin kay-wlli l dak l-higher niveau (curPrice ~ hhLevel), tamma kay-dreb l-HH !
          const suffixMinLow = new Float64Array(len);
          suffixMinLow[len - 1] = parseFloat(klines[len - 1][3]);
          for (let i = len - 2; i >= 0; i--) {
            const l = parseFloat(klines[i][3]);
            suffixMinLow[i] = l < suffixMinLow[i + 1] ? l : suffixMinLow[i + 1];
          }

          let hhLevel = 0;
          let hhLevelTime = 0;
          let hhMinLow = 0;
          let hhPullbackPct = 0;

          for (let i = 0; i < len - 1; i++) {
            const h = parseFloat(klines[i][2]);
            const minAfter = suffixMinLow[i + 1];
            // Khasso ikoun hbat 3la l-aqal b -2%
            if (minAfter <= h * 0.98) {
              if (h > hhLevel) {
                hhLevel = h;
                hhLevelTime = parseInt(klines[i][0]);
                hhMinLow = minAfter;
                hhPullbackPct = parseFloat((((minAfter - h) / h) * 100).toFixed(2));
              }
            }
          }

          const distToHH = hhLevel > 0 ? parseFloat((((curPrice - hhLevel) / hhLevel) * 100).toFixed(2)) : -999;
          const isHittingHH = hhLevel > 0 && distToHH >= -3.5;

          const alpha20_4h = 2 / (20 + 1);
          const alpha50_4h = 2 / (50 + 1);
          let ema20_4h = klines4h[0]?.close || curPrice;
          let ema50_4h = klines4h[0]?.close || curPrice;
          const ema20_4h_history = [];

          klines4h.forEach(bar => {
            ema20_4h = (bar.close * alpha20_4h) + (ema20_4h * (1 - alpha20_4h));
            ema50_4h = (bar.close * alpha50_4h) + (ema50_4h * (1 - alpha50_4h));
            ema20_4h_history.push(ema20_4h);
          });

          const distEma20_4h = ema20_4h > 0 ? ((curPrice - ema20_4h) / ema20_4h) * 100 : 0;
          const histLen = ema20_4h_history.length;
          const prevEma20_4h = histLen >= 4 ? ema20_4h_history[histLen - 4] : ema20_4h;
          const slopeEma20_4h = prevEma20_4h > 0 ? ((ema20_4h - prevEma20_4h) / prevEma20_4h) * 100 : 0;
          const pullbackFromHigh = high30d > 0 ? ((curPrice - high30d) / high30d) * 100 : 0;

          // 🎯 Classification Intuitive & Rigoureuse des 5 Phases de Marché
          // 1. EXTENSION / CLIMAX (Sommet parabolique étiré)
          const isClimax = distEma20_4h > 24.0 || (p30d > 55.0 && distEma20_4h > 16.0);

          // 2. CORRECTION EN COURS (Le token est en baisse active / repli baissier sans attendre de percer l'EMA 20)
          const isDropping = (p1d < -2.0 || p4h < -1.5 || (pullbackFromHigh < -8.0 && p1d < 0)) || (curPrice < ema20_4h - 3.0);

          // 3. PULLBACK RETEST / ZONE SNIPER (Tendance haussière mensuelle + fin de baisse et stabilisation propre autour de l'EMA 20 4H)
          const isPullbackRetest = (p30d >= 12.0 || p1w >= 6.0) &&
                                   pullbackFromHigh <= -6.0 &&
                                   distEma20_4h >= -4.0 && distEma20_4h <= 6.0 &&
                                   p15m >= -0.6;

          // 4. EXPANSION (Phase 2 Markup en hausse active au-dessus de l'EMA 20 4H)
          const isExpansion = (p1d > 1.5 || p4h > 0.5) && distEma20_4h > 3.0 && curPrice >= ema20_4h;

          let phase4h = {
            key: 'ACCUMULATION',
            label: '📦 ACCUMULATION',
            shortLabel: '📦 ACCUM.',
            desc: 'Base de consolidation en 4H / Phase neutre',
            color: '#facc15',
            badgeBg: 'rgba(250, 204, 21, 0.15)',
            border: 'rgba(250, 204, 21, 0.5)'
          };

          if (isClimax) {
            phase4h = {
              key: 'DISTRIBUTION',
              label: '⚠️ EXTENSION CLIMAX',
              shortLabel: '⚠️ CLIMAX',
              desc: "Écart extrême à l'EMA 20 4H (+24%+). Sommet parabolique / Risque de correction.",
              color: '#fb923c',
              badgeBg: 'rgba(251, 146, 60, 0.18)',
              border: 'rgba(251, 146, 60, 0.6)'
            };
          } else if (isDropping && !isPullbackRetest) {
            phase4h = {
              key: 'CORRECTION',
              label: '🔻 CORRECTION 4H',
              shortLabel: '🔻 CORRECT.',
              desc: "En baisse active / Repli en cours (p1d/p4h négatifs ou repli de sommet).",
              color: '#f87171',
              badgeBg: 'rgba(248, 113, 113, 0.15)',
              border: 'rgba(248, 113, 113, 0.5)'
            };
          } else if (isPullbackRetest) {
            phase4h = {
              key: 'PULLBACK',
              label: '💎 PULLBACK RETEST',
              shortLabel: '💎 PULLBACK',
              desc: "Tendance mensuelle haussière + Retest stabilisé sur l'EMA 20 4H (Zone Sniper)",
              color: '#38bdf8',
              badgeBg: 'rgba(56, 189, 248, 0.25)',
              border: 'rgba(56, 189, 248, 0.8)'
            };
          } else if (isExpansion) {
            phase4h = {
              key: 'EXPANSION',
              label: '🚀 EXPANSION 4H',
              shortLabel: '🚀 EXPANSION',
              desc: "Markup Phase 2 haussière en accélération au-dessus de l'EMA 20 4H",
              color: '#00ff88',
              badgeBg: 'rgba(0, 255, 136, 0.18)',
              border: 'rgba(0, 255, 136, 0.6)'
            };
          }

          const baseOffset30d = Math.min(999, len - 1);
          const basePrice30d = parseFloat(klines[len - 1 - baseOffset30d][4]);
          const maxPointsMonth = (basePrice30d > 0 && high30d > 0 && high30d > -Infinity)
            ? parseFloat((((high30d - basePrice30d) / basePrice30d) * 100).toFixed(2))
            : p30d;
          const pullbackFromPeak = (high30d > 0 && high30d > -Infinity)
            ? parseFloat((((curPrice - high30d) / high30d) * 100).toFixed(2))
            : 0;

          const liveTickerTurnover = tickersTurnoverMap[symbol] || tickersTurnoverMap[`${cleanSym}USDT`] || 0;
          const finalTurnover24h = liveTickerTurnover > 0 ? liveTickerTurnover : turnover24h;

          return {
            symbol,
            cleanSymbol: cleanSym,
            price: curPrice,
            p30d,
            p1w,
            p1d,
            p4h,
            p1h,
            p15m,
            turnover24h: parseFloat(finalTurnover24h.toFixed(2)),
            volume24h: parseFloat(volume24h.toFixed(2)),
            buyVol24h: parseFloat(buyVol24h.toFixed(2)),
            sellVol24h: parseFloat(sellVol24h.toFixed(2)),
            buyPct: buyPct24h,
            sellPct: sellPct24h,
            netDelta24h: parseFloat(netDelta24h.toFixed(2)),
            maxPointsMonth,
            high30d: hhLevel > 0 ? parseFloat(hhLevel.toFixed(4)) : (high30d > -Infinity ? parseFloat(high30d.toFixed(4)) : curPrice),
            hhLevel: hhLevel > 0 ? parseFloat(hhLevel.toFixed(4)) : curPrice,
            hhLevelTime,
            hhPullbackPct,
            hhMinLow: hhMinLow > 0 ? parseFloat(hhMinLow.toFixed(4)) : curPrice,
            distToHH,
            isHittingHH,
            pullbackFromPeak,
            confMonth: parseFloat(confMonth.toFixed(1)),
            scoreMonth,
            confWeek: parseFloat(confWeek.toFixed(1)),
            scoreWeek,
            confDay: parseFloat(confDay.toFixed(1)),
            scoreDay,
            chartCurve24h,
            rawKlines: klines,
            phase4h,
            distEma20_4h: parseFloat(distEma20_4h.toFixed(1)),
            ema20_4h: parseFloat(ema20_4h.toFixed(4)),
            ema50_4h: parseFloat(ema50_4h.toFixed(4))
          };
        });

        const batchRes = await Promise.all(promises);
        batchRes.forEach(r => { if (r) allResults.push(r); });
      }

      if (allResults.length > 0) {
        setTokensData(allResults);
      }

      setProgressPct(100);
      setProgressMsg('Analyse terminée avec succès !');
      setLastLiveUpdate(new Date().toLocaleTimeString());
    } catch (e) {
      console.error('Error loading 3-Horizon benchmark:', e);
    } finally {
      setIsLoading(false);
      isScanningRef.current = false;

      if (nextRefreshTimeoutRef.current) clearTimeout(nextRefreshTimeoutRef.current);
      nextRefreshTimeoutRef.current = setTimeout(() => {
        loadMarketData(true);
      }, 35000);
    }
  };

  useEffect(() => {
    loadMarketData(false);
    return () => {
      if (nextRefreshTimeoutRef.current) clearTimeout(nextRefreshTimeoutRef.current);
    };
  }, []);

  // 2. Calcul des 3 listes Top 50 & de la ligne jaune dynamique (Ultra-Optimisé O(N))
  const tripleAnalysis = useMemo(() => {
    if (!tokensData || tokensData.length === 0) return { listMonth: [], listWeek: [], listDay: [], tripleLeaders: [], dynamicMonthlyRefLevel: 15.66 };

    const sortedMonth = [...tokensData].sort((a, b) => b.scoreMonth - a.scoreMonth);
    const listMonth = sortedMonth.slice(0, 50).map((t, idx) => ({ ...t, rankMonth: idx + 1 }));

    const sortedWeek = [...tokensData].sort((a, b) => b.scoreWeek - a.scoreWeek);
    const listWeek = sortedWeek.slice(0, 50).map((t, idx) => ({ ...t, rankWeek: idx + 1 }));

    const sortedDay = [...tokensData].sort((a, b) => b.scoreDay - a.scoreDay);
    const listDay = sortedDay.slice(0, 50).map((t, idx) => {
      const sym = (t.cleanSymbol || '').toUpperCase();
      const cg = dailyCgData?.[sym] || CG_DATA_CACHE.map.get(sym) || null;
      const cgVol = cg && cg.volume > 0 ? cg.volume : null;
      const effectiveVol = cgVol !== null ? cgVol : (t.turnover24h || (t.volume24h && t.price ? t.volume24h * t.price : 0) || 0);

      const cgMcap = cg && cg.marketCap > 0 ? cg.marketCap : null;
      const effectiveMcap = cgMcap !== null ? cgMcap : (dailyMarketCaps[sym] || t.marketCap || 0);

      const volMcapRatio = effectiveMcap > 0 ? parseFloat(((effectiveVol / effectiveMcap) * 100).toFixed(1)) : 0;

      // Calcul Buy vs Sell Flow (15m 24h)
      const buyPct = typeof t.buyPct === 'number' ? t.buyPct : 50;
      const sellPct = typeof t.sellPct === 'number' ? t.sellPct : 50;
      const isBuyDominant = buyPct >= 50;
      const globalBuyVol = effectiveVol * (buyPct / 100);
      const globalSellVol = effectiveVol * (sellPct / 100);
      const globalNetDelta = globalBuyVol - globalSellVol;

      return {
        ...t,
        rankDay: idx + 1,
        cgVolume: cgVol,
        marketCap: effectiveMcap,
        volMcapRatio,
        volMcapSource: cgVol !== null ? 'CoinGecko' : 'Bybit',
        buyPct,
        sellPct,
        isBuyDominant,
        globalBuyVol,
        globalSellVol,
        globalNetDelta
      };
    });

    // 🚀 TOP 50 DU MOIS PAR PIC RECORD DE POINTS ATTEINT (ATH 30D)
    const sortedMaxPoints = [...tokensData].sort((a, b) => (b.maxPointsMonth || 0) - (a.maxPointsMonth || 0));
    const listMaxPointsMonth = sortedMaxPoints.slice(0, 50).map((t, idx) => ({ ...t, rankPeak: idx + 1 }));

    const monthTop20Set = new Set(listMonth.slice(0, 20).map(t => t.cleanSymbol));
    const weekTop20Set = new Set(listWeek.slice(0, 20).map(t => t.cleanSymbol));
    const dayTop20Set = new Set(listDay.slice(0, 20).map(t => t.cleanSymbol));

    const tripleLeaders = listMonth.filter(t => 
      weekTop20Set.has(t.cleanSymbol) && dayTop20Set.has(t.cleanSymbol)
    );

    const avg30d = listMonth.length > 0 
      ? parseFloat((listMonth.reduce((acc, t) => acc + (t.scoreMonth || 0), 0) / listMonth.length).toFixed(2)) 
      : 15.66;

    return { listMonth, listWeek, listDay, listMaxPointsMonth, tripleLeaders, dynamicMonthlyRefLevel: avg30d };
  }, [tokensData, dailyMarketCaps, dailyCgData]);


  // 3. Graphique interactif
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 800,
      height: chartHeight,
      layout: { background: { color: 'rgba(8,14,24,0.98)' }, textColor: '#ffffff', fontSize: 13, fontFamily: 'JetBrains Mono, monospace' },
      grid: { vertLines: { color: 'rgba(42, 46, 57, 0.15)' }, horzLines: { color: 'rgba(42, 46, 57, 0.15)' } },
      rightPriceScale: { borderColor: 'rgba(42, 46, 57, 0.4)', scaleMargins: { top: 0.08, bottom: 0.08 }, autoScale: true },
      timeScale: { borderColor: 'rgba(42, 46, 57, 0.4)', timeVisible: true, secondsVisible: false, rightOffset: 60, fixRightEdge: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true }, mouseWheel: true, pinch: true },
    });

    refDailyMaxSeriesRef.current = chart.addLineSeries({
      color: '#00ff88',
      lineWidth: 2,
      lineStyle: 2,
      title: '🟢 BENCHMARK MAX',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refMonthlySeriesRef.current = chart.addLineSeries({
      color: '#facc15',
      lineWidth: 2.5,
      lineStyle: 2,
      title: '🟡 RÉSISTANCE MACRO DYNAMIQUE',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refEma20SeriesRef.current = chart.addLineSeries({
      color: '#00e5ff',
      lineWidth: 3.5,
      lineStyle: 0,
      title: '🔵 COURBE DYNAMIQUE EMA 20',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    refEma50SeriesRef.current = chart.addLineSeries({
      color: '#ff9900',
      lineWidth: 3.5,
      lineStyle: 0,
      title: '🟠 COURBE DYNAMIQUE EMA 50',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    refWeeklyEma20SeriesRef.current = chart.addLineSeries({
      color: '#818cf8',
      lineWidth: 2.5,
      lineStyle: 2,
      title: '🌐 NIVEAU EMA 20 SEMAINE',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refMonthlyEma20SeriesRef.current = chart.addLineSeries({
      color: '#c084fc',
      lineWidth: 2.5,
      lineStyle: 2,
      title: '👑 NIVEAU EMA 20 MOIS',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refDailyMinSeriesRef.current = chart.addLineSeries({
      color: '#ef4444',
      lineWidth: 2,
      lineStyle: 2,
      title: '🔴 BENCHMARK MIN',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    ref24hRejectionWallSeriesRef.current = chart.addLineSeries({
      color: '#ff0055',
      lineWidth: 3,
      lineStyle: 2,
      title: '⛔ MUR DE REJET COLLECTIF 24H',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    ref24hLaunchpadSeriesRef.current = chart.addLineSeries({
      color: '#00ff88',
      lineWidth: 3,
      lineStyle: 2,
      title: '🚀 LAUNCHPAD IGNITION 24H (ZONE DE DÉPART DES PUMPS > +10%)',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refSniperEntrySeriesRef.current = chart.addLineSeries({
      color: '#00e5ff',
      lineWidth: 3,
      lineStyle: 0,
      title: '🎯 LIGNE D\'ENTRÉE SNIPER',
      priceLineVisible: false,
      lastValueVisible: true,
    });

    refSniperStopLossSeriesRef.current = chart.addLineSeries({
      color: '#ff3366',
      lineWidth: 3,
      lineStyle: 2,
      title: '🛑 LIGNE STOP LOSS (INVALIDATION)',
      priceLineVisible: false,
      lastValueVisible: true,
    });


    refScaleAnchorSeriesRef.current = chart.addLineSeries({
      color: 'rgba(0,0,0,0)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    // 🔄 Synchronisation permanente au zoom et au déplacement
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => updateOverlayPositions());
      }
    });
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        window.requestAnimationFrame(() => updateOverlayPositions());
      }
    });

    chartRef.current = chart;

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch (_) {}
        chartRef.current = null;
        seriesMapRef.current = {};
        hasFittedOnceRef.current = false;
      }
    };
  }, []);

  
  // 🏛️ CALCUL UNIFIÉ ET MÉMOÏSÉ DES COURBES ET DES 3 MASTER EMAs
  const chartProcessedData = useMemo(() => {
    const activeList = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    if (!activeList || activeList.length === 0) {
      return {
        tokenCurvesMap: {},
        horizonTimestamps: [],
        dynamicEma20DayData: [],
        dynamicEma20WeekData: [],
        dynamicEma20MonthData: [],
        lastMasterDay: 0,
        lastMasterWeek: 0,
        lastMasterMonth: 0,
        valMax: 0,
        valMin: 0
      };
    }

    const isDay = activeChartHorizon === 'day';
    const isWeek = activeChartHorizon === 'week';
    const num15mBars = isDay ? 96 : isWeek ? 672 : 1000;
    const step = isDay ? 1 : isWeek ? 4 : 16;

    let longestToken = activeList[0];
    activeList.forEach(t => {
      if (t.rawKlines && t.rawKlines.length > (longestToken?.rawKlines?.length || 0)) longestToken = t;
    });

    const klinesRef = longestToken?.rawKlines || [];
    const lenRef = klinesRef.length;
    if (lenRef < 15) {
      return {
        tokenCurvesMap: {},
        horizonTimestamps: [],
        dynamicEma20DayData: [],
        dynamicEma20WeekData: [],
        dynamicEma20MonthData: [],
        lastMasterDay: 0,
        lastMasterWeek: 0,
        lastMasterMonth: 0,
        valMax: 0,
        valMin: 0
      };
    }

    const startIdx = Math.max(0, lenRef - num15mBars);
    const horizonTimestamps = [];
    const tokenCurvesMap = {};
    activeList.forEach(t => { tokenCurvesMap[t.cleanSymbol] = []; });

    const dynamicEma20DayData = [];
    const dynamicEma20WeekData = [];
    const dynamicEma20MonthData = [];
    const alpha20 = 2 / (20 + 1);

    let maxBench = -Infinity;
    let minBench = Infinity;

    // 1. CALCUL GLOBAL UNIFIÉ DES 3 MASTER EMAs
    const globalMonthStartIdx = Math.max(0, lenRef - 1000);
    const globalWeekStartIdx = Math.max(0, lenRef - 672);
    const globalDayStartIdx = Math.max(0, lenRef - 96);

    const masterEmaMonthMap = {};
    const masterEmaWeekMap = {};
    const masterEmaDayMap = {};

    let runningEmaMonth = null;
    let runningEmaWeek = null;
    let runningEmaDay = null;

    for (let i = globalMonthStartIdx; i < lenRef; i++) {
      const timeMs = parseInt(klinesRef[i][0]);
      const candleTime = Math.floor(timeMs / 1000);

      let sumMonth = 0, countMonth = 0;
      let sumWeek = 0, countWeek = 0;
      let sumDay = 0, countDay = 0;

      activeList.forEach(t => {
        const klines = t.rawKlines || [];
        const tLen = klines.length;
        if (tLen < 15) return;

        const currentBarOffset = lenRef - 1 - i;
        const targetTokenIdx = Math.max(0, tLen - 1 - currentBarOffset);
        const kBar = klines[targetTokenIdx];
        if (!kBar) return;
        const cPrice = parseFloat(kBar[4]);

        // Mois (30D)
        const mBaseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - globalMonthStartIdx));
        const mBasePrice = parseFloat(klines[Math.max(0, mBaseOffset)][4]);
        if (mBasePrice > 0) {
          sumMonth += ((cPrice - mBasePrice) / mBasePrice) * 100;
          countMonth++;
        }

        // Semaine (7D)
        if (i >= globalWeekStartIdx) {
          const wBaseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - globalWeekStartIdx));
          const wBasePrice = parseFloat(klines[Math.max(0, wBaseOffset)][4]);
          if (wBasePrice > 0) {
            sumWeek += ((cPrice - wBasePrice) / wBasePrice) * 100;
            countWeek++;
          }
        }

        // Jour (24H)
        if (i >= globalDayStartIdx) {
          const dBaseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - globalDayStartIdx));
          const dBasePrice = parseFloat(klines[Math.max(0, dBaseOffset)][4]);
          if (dBasePrice > 0) {
            sumDay += ((cPrice - dBasePrice) / dBasePrice) * 100;
            countDay++;
          }
        }
      });

      if (countMonth > 0) {
        const avgM = sumMonth / countMonth;
        if (runningEmaMonth === null) runningEmaMonth = avgM;
        else runningEmaMonth = (avgM * alpha20) + (runningEmaMonth * (1 - alpha20));
        masterEmaMonthMap[candleTime] = parseFloat(runningEmaMonth.toFixed(2));
      }

      if (countWeek > 0) {
        const avgW = sumWeek / countWeek;
        if (runningEmaWeek === null) runningEmaWeek = avgW;
        else runningEmaWeek = (avgW * alpha20) + (runningEmaWeek * (1 - alpha20));
        masterEmaWeekMap[candleTime] = parseFloat(runningEmaWeek.toFixed(2));
      }

      if (countDay > 0) {
        const avgD = sumDay / countDay;
        if (runningEmaDay === null) runningEmaDay = avgD;
        else runningEmaDay = (avgD * alpha20) + (runningEmaDay * (1 - alpha20));
        masterEmaDayMap[candleTime] = parseFloat(runningEmaDay.toFixed(2));
      }
    }

    // 2. ÉCHANTILLONNAGE SUR L'HORIZON AFFICHÉ
    for (let i = startIdx; i < lenRef; i += step) {
      const timeMs = parseInt(klinesRef[i][0]);
      const candleTime = Math.floor(timeMs / 1000);
      horizonTimestamps.push(candleTime);

      let sumHorizonClose = 0, validHorizonCount = 0;

      activeList.forEach(t => {
        const klines = t.rawKlines || [];
        const tLen = klines.length;
        if (tLen < 15) return;

        const currentBarOffset = lenRef - 1 - i;
        const targetTokenIdx = Math.max(0, tLen - 1 - currentBarOffset);
        const endTokenIdx = Math.min(tLen - 1, targetTokenIdx + (step - 1));
        const kEnd = klines[endTokenIdx] || klines[targetTokenIdx];
        if (!kEnd) return;

        const isLastBar = (i + step >= lenRef);
        const liveP = (livePricesRef?.current?.[t.cleanSymbol]) || t.price;
        const cPrice = (isLastBar && liveP) ? liveP : parseFloat(kEnd[4]);

        const baseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - startIdx));
        const basePrice = parseFloat(klines[Math.max(0, baseOffset)][4]);
        if (basePrice > 0) {
          const cPts = ((cPrice - basePrice) / basePrice) * 100;
          tokenCurvesMap[t.cleanSymbol].push({ time: candleTime, value: parseFloat(cPts.toFixed(2)) });
          sumHorizonClose += cPts;
          validHorizonCount++;
        }
      });

      if (validHorizonCount > 0) {
        const avgH = parseFloat((sumHorizonClose / validHorizonCount).toFixed(2));
        if (avgH > maxBench) maxBench = avgH;
        if (avgH < minBench) minBench = avgH;
      }

      if (masterEmaMonthMap[candleTime] !== undefined) {
        dynamicEma20MonthData.push({ time: candleTime, value: masterEmaMonthMap[candleTime] });
      }
      if (masterEmaWeekMap[candleTime] !== undefined) {
        dynamicEma20WeekData.push({ time: candleTime, value: masterEmaWeekMap[candleTime] });
      }
      if (masterEmaDayMap[candleTime] !== undefined) {
        dynamicEma20DayData.push({ time: candleTime, value: masterEmaDayMap[candleTime] });
      }
    }

    // ⚡ GARANTIE ABSOLUE : La bougie 15M en cours (dernière bougie) doit TOUJOURS être le point final
    const lastBarIdx = lenRef - 1;
    const lastBarTime = Math.floor(parseInt(klinesRef[lastBarIdx][0]) / 1000);

    if (horizonTimestamps.length > 0 && horizonTimestamps[horizonTimestamps.length - 1] < lastBarTime) {
      horizonTimestamps.push(lastBarTime);

      activeList.forEach(t => {
        const klines = t.rawKlines || [];
        const tLen = klines.length;
        if (tLen < 15) return;

        const baseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - startIdx));
        const basePrice = parseFloat(klines[Math.max(0, baseOffset)][4]);
        const curPrice = (livePricesRef?.current?.[t.cleanSymbol]) || t.price || parseFloat(klines[tLen - 1][4]);
        if (basePrice > 0) {
          const cPts = ((curPrice - basePrice) / basePrice) * 100;
          tokenCurvesMap[t.cleanSymbol].push({ time: lastBarTime, value: parseFloat(cPts.toFixed(2)) });
        }
      });

      if (masterEmaMonthMap[lastBarTime] !== undefined) {
        dynamicEma20MonthData.push({ time: lastBarTime, value: masterEmaMonthMap[lastBarTime] });
      }
      if (masterEmaWeekMap[lastBarTime] !== undefined) {
        dynamicEma20WeekData.push({ time: lastBarTime, value: masterEmaWeekMap[lastBarTime] });
      }
      if (masterEmaDayMap[lastBarTime] !== undefined) {
        dynamicEma20DayData.push({ time: lastBarTime, value: masterEmaDayMap[lastBarTime] });
      }
    }

    // Calcul unifié des prix de base par token pour les updates en temps réel O(1)
    const tokenBasePricesMap = {};
    activeList.forEach(t => {
      const klines = t.rawKlines || [];
      const tLen = klines.length;
      if (tLen >= 15) {
        const baseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - startIdx));
        const basePrice = parseFloat(klines[Math.max(0, baseOffset)][4]);
        tokenBasePricesMap[t.cleanSymbol] = basePrice;
      }
    });

    // 📅 3. ÉCHANTILLONNAGE SPÉCIFIQUE 30 JOURS (MOIS) POUR TOUS LES TOKENS
    const monthHorizonTimestamps = [];
    const tokenMonthCurvesMap = {};
    const tokenMonthBasePricesMap = {};
    activeList.forEach(t => { 
      tokenMonthCurvesMap[t.cleanSymbol] = []; 
      const klines = t.rawKlines || [];
      const tLen = klines.length;
      if (tLen >= 15) {
        const mBaseOffset = Math.min(tLen - 1, tLen - 1 - (lenRef - 1 - globalMonthStartIdx));
        tokenMonthBasePricesMap[t.cleanSymbol] = parseFloat(klines[Math.max(0, mBaseOffset)][4]);
      }
    });

    for (let i = globalMonthStartIdx; i < lenRef; i += 16) {
      const timeMs = parseInt(klinesRef[i][0]);
      const candleTime = Math.floor(timeMs / 1000);
      monthHorizonTimestamps.push(candleTime);

      activeList.forEach(t => {
        const klines = t.rawKlines || [];
        const tLen = klines.length;
        if (tLen < 15) return;

        const currentBarOffset = lenRef - 1 - i;
        const targetTokenIdx = Math.max(0, tLen - 1 - currentBarOffset);
        const kBar = klines[targetTokenIdx];
        if (!kBar) return;

        const basePrice = tokenMonthBasePricesMap[t.cleanSymbol];
        if (basePrice > 0) {
          const cPrice = parseFloat(kBar[4]);
          const cPts = ((cPrice - basePrice) / basePrice) * 100;
          tokenMonthCurvesMap[t.cleanSymbol].push({ time: candleTime, value: parseFloat(cPts.toFixed(2)) });
        }
      });
    }

    if (monthHorizonTimestamps.length > 0 && monthHorizonTimestamps[monthHorizonTimestamps.length - 1] < lastBarTime) {
      monthHorizonTimestamps.push(lastBarTime);
      activeList.forEach(t => {
        const basePrice = tokenMonthBasePricesMap[t.cleanSymbol];
        if (basePrice > 0) {
          const liveP = (livePricesRef?.current?.[t.cleanSymbol]) || t.price;
          const livePts = parseFloat((((liveP - basePrice) / basePrice) * 100).toFixed(2));
          tokenMonthCurvesMap[t.cleanSymbol].push({ time: lastBarTime, value: livePts });
        }
      });
    }

    // 🔥 ZERO-DELAY LIVE INJECTION : Mise à jour instantanée du point 15m avec livePricesRef ou t.price
    activeList.forEach(t => {
      const curve = tokenCurvesMap[t.cleanSymbol];
      const liveP = (livePricesRef?.current?.[t.cleanSymbol]) || t.price;
      if (curve && curve.length > 0 && liveP) {
        const basePrice = tokenBasePricesMap[t.cleanSymbol];
        if (basePrice > 0) {
          const livePts = parseFloat((((liveP - basePrice) / basePrice) * 100).toFixed(2));
          curve[curve.length - 1].value = livePts;
        }
      }
    });

    if (maxBench === -Infinity) maxBench = 0;
    if (minBench === Infinity) minBench = 0;

    const valMax = parseFloat(maxBench.toFixed(2));
    const valMin = parseFloat(minBench.toFixed(2));
    const lastMasterDay = dynamicEma20DayData.length > 0 ? dynamicEma20DayData[dynamicEma20DayData.length - 1].value : 0;
    const lastMasterWeek = dynamicEma20WeekData.length > 0 ? dynamicEma20WeekData[dynamicEma20WeekData.length - 1].value : 0;
    const lastMasterMonth = dynamicEma20MonthData.length > 0 ? dynamicEma20MonthData[dynamicEma20MonthData.length - 1].value : 0;

    // ⛔ CALCUL PRÉCIS DU MUR DE REJET COLLECTIF 24H & DU LAUNCHPAD D'IGNITION DES PUMPS (> +10%)
    const tokenPeaks24h = [];
    const tokenPumps24h = [];

    activeList.forEach(t => {
      const klines = t.rawKlines || [];
      const tLen = klines.length;
      if (tLen < 15) return;

      const start24h = Math.max(0, tLen - 96);
      const basePrice = parseFloat(klines[start24h][4]);
      if (basePrice <= 0) return;

      let maxPt = -Infinity;
      let minPtBeforeMax = Infinity;
      let maxPtIdx = start24h;
      let lastPt = 0;

      for (let i = start24h; i < tLen; i++) {
        const cp = parseFloat(klines[i][4]);
        const hp = parseFloat(klines[i][2]);
        const ptHigh = ((hp - basePrice) / basePrice) * 100;
        const ptClose = ((cp - basePrice) / basePrice) * 100;

        if (ptHigh > maxPt) {
          maxPt = ptHigh;
          maxPtIdx = i;
        }
        lastPt = ptClose;
      }

      // 🚀 CALCUL STATISTIQUE DU LAUNCHPAD POUR LES 50 TOKENS :
      // On détecte pour chaque token son plafond d'accumulation (zone de breakout réaliste entre 4.0 et 10.0 pts)
      let prePumpMax = -Infinity;
      const breakoutLimitIdx = Math.max(start24h + 10, maxPtIdx);

      // Chercher le plafond d'accumulation avant l'impulsion
      for (let i = start24h; i < breakoutLimitIdx; i++) {
        const hp = parseFloat(klines[i][2]);
        const ptH = ((hp - basePrice) / basePrice) * 100;
        if (ptH > prePumpMax && ptH <= Math.min(10.0, maxPt * 0.6)) {
          prePumpMax = ptH;
        }
      }

      if (prePumpMax === -Infinity || prePumpMax < 1.0) {
        prePumpMax = Math.min(Math.max(4.0, maxPt * 0.35), 8.5);
      }

      // Si le token a connu un vrai pump (> +10% de gain ou maxPt >= 10 pts)
      if (maxPt >= 10.0) {
        tokenPumps24h.push({
          symbol: t.cleanSymbol,
          breakoutLevel: parseFloat(prePumpMax.toFixed(2)),
          peakLevel: parseFloat(maxPt.toFixed(2)),
          gain: parseFloat(maxPt.toFixed(2))
        });
      }

      if (maxPt !== -Infinity) {
        tokenPeaks24h.push({
          symbol: t.cleanSymbol,
          turnover24h: t.turnover24h || 0,
          maxPt: parseFloat(maxPt.toFixed(2)),
          lastPt: parseFloat(lastPt.toFixed(2)),
          pullback: parseFloat((maxPt - lastPt).toFixed(2))
        });
      }
    });

    tokenPeaks24h.sort((a, b) => a.maxPt - b.maxPt);
    let rejectionWallLvl = 15.0;
    let rejectedCount = 0;
    let piercedSymbols = [];

    if (tokenPeaks24h.length > 0) {
      const p75Idx = Math.floor(tokenPeaks24h.length * 0.75);
      rejectionWallLvl = tokenPeaks24h[Math.min(tokenPeaks24h.length - 1, p75Idx)].maxPt;
      rejectionWallLvl = parseFloat(Math.max(13.0, rejectionWallLvl).toFixed(2));
    }

    // 🚀 DÉTERMINATION DU LAUNCHPAD COLLECTIF (CLUSTER DES PLAFONDS D'ACCUMULATION SUR TOUS LES TOKENS EN PUMP)
    let launchpadLvl = 8.0;
    let launchpadPumpingCount = tokenPumps24h.length;
    let launchpadTokens = tokenPumps24h.map(p => `${p.symbol} (+${p.gain} pts)`);

    if (tokenPumps24h.length > 0) {
      // Clustering par bucket de 0.5 pts pour trouver la zone exacte où le plus grand nombre de tokens ont breakout
      const buckets = {};
      tokenPumps24h.forEach(p => {
        const bKey = Math.round(p.breakoutLevel * 2) / 2; // arrondi à 0.5 près
        buckets[bKey] = (buckets[bKey] || 0) + 1;
      });

      let bestBucket = null;
      let maxCount = -1;
      Object.keys(buckets).forEach(bKey => {
        const count = buckets[bKey];
        const numKey = parseFloat(bKey);
        if (count > maxCount && numKey >= 2.0 && numKey <= 11.0) {
          maxCount = count;
          bestBucket = numKey;
        }
      });

      if (bestBucket !== null) {
        launchpadLvl = parseFloat(bestBucket.toFixed(2));
      } else {
        tokenPumps24h.sort((a, b) => a.breakoutLevel - b.breakoutLevel);
        const midIdx = Math.floor(tokenPumps24h.length / 2);
        launchpadLvl = parseFloat(tokenPumps24h[midIdx].breakoutLevel.toFixed(2));
      }
    } else {
      launchpadLvl = parseFloat((lastMasterDay > 0 ? lastMasterDay : 7.0).toFixed(2));
    }

    // 🛡️ GARANTIE STRICTE DE LA HIÉRARCHIE : LAUNCHPAD < MUR DE REJET
    launchpadLvl = Math.max(4.0, Math.min(launchpadLvl, 10.0));
    rejectionWallLvl = Math.max(rejectionWallLvl, launchpadLvl + 4.5);

    if (tokenPeaks24h.length > 0) {
      rejectedCount = tokenPeaks24h.filter(t => t.maxPt <= (rejectionWallLvl * 1.1) && t.pullback >= 1.5).length;
      piercedSymbols = tokenPeaks24h.filter(t => t.lastPt > rejectionWallLvl).map(t => ({
        symbol: t.symbol,
        turnover24h: t.turnover24h
      }));
    }

    return {
      tokenCurvesMap,
      tokenBasePricesMap,
      tokenMonthCurvesMap,
      tokenMonthBasePricesMap,
      monthHorizonTimestamps,
      lastCandleTime: lastBarTime,
      horizonTimestamps,
      dynamicEma20DayData,
      dynamicEma20WeekData,
      dynamicEma20MonthData,
      lastMasterDay,
      lastMasterWeek,
      lastMasterMonth,
      valMax,
      valMin,
      rejectionWall24hData: {
        lvl: rejectionWallLvl,
        rejectedCount,
        piercedSymbols
      },
      launchpad24hData: {
        lvl: launchpadLvl,
        pumpingCount: launchpadPumpingCount,
        launchpadTokens
      }
    };
  }, [tripleAnalysis, tokensData, activeChartHorizon, chartUniverse]);

  // 📊 CALCUL DU PROFILE DE VOLUME HORIZONTAL COLLECTIF (VOLUME PAR ZONE DE POINTS)
  const volumeProfileData = useMemo(() => {
    if (!tokensData || tokensData.length === 0) {
      return { 
        buckets: [], 
        pocLvl: 0, 
        pocVol: 0, 
        maxBucketVol: 0, 
        totalVolume: 0, 
        vah: 0, 
        val: 0, 
        vaVolume: 0, 
        minLvl: 0, 
        maxLvl: 0, 
        hvnList: [], 
        lvnList: [] 
      };
    }

    const bucketSize = 1.0; // 1 pt par bucket
    const bucketsMap = {};
    let totalVol = 0;

    const filteredTokens = (tokensData || []).filter(t => t.cleanSymbol !== 'BTC' && t.cleanSymbol !== 'ETH');
    const tokensMap = {};
    filteredTokens.forEach(t => {
      tokensMap[t.cleanSymbol] = t;
    });

    filteredTokens.forEach(token => {
      const klines = token.rawKlines || [];
      if (klines.length < 15) return;
      const len = klines.length;
      const sliced = activeChartHorizon === 'day' 
        ? klines.slice(Math.max(0, len - 96)) 
        : activeChartHorizon === 'week' 
          ? klines.slice(Math.max(0, len - 672)) 
          : klines.slice(Math.max(0, len - 999));
      
      const startPrice = parseFloat(sliced[0][4]);
      if (!startPrice || startPrice <= 0) return;

      sliced.forEach(k => {
        const pOpen = parseFloat(k[1]);
        const pClose = parseFloat(k[4]);
        const tOver = parseFloat(k[6]) || 0;
        if (pClose > 0 && tOver > 0) {
          const perf = ((pClose - startPrice) / startPrice) * 100;
          const bucketKey = Math.floor(perf / bucketSize) * bucketSize;
          if (!bucketsMap[bucketKey]) {
            bucketsMap[bucketKey] = {
              lvl: bucketKey,
              volume: 0,
              upVolume: 0,
              downVolume: 0,
              tokens: new Set()
            };
          }
          bucketsMap[bucketKey].volume += tOver;
          if (pClose >= pOpen) {
            bucketsMap[bucketKey].upVolume += tOver;
          } else {
            bucketsMap[bucketKey].downVolume += tOver;
          }
          bucketsMap[bucketKey].tokens.add(token.cleanSymbol);
          totalVol += tOver;
        }
      });
    });

    // 🚀 Seuil plancher du Launchpad Ignition (Zone d'explosion)
    const pumpFloorLvl = (chartProcessedData?.launchpad24hData?.lvl != null && chartProcessedData.launchpad24hData.lvl > 0)
      ? chartProcessedData.launchpad24hData.lvl
      : 7.0;

    let filteredBucketsRaw = Object.values(bucketsMap);
    if (vpvrZoneScope === 'PUMP') {
      filteredBucketsRaw = filteredBucketsRaw.filter(b => b.lvl >= pumpFloorLvl);
      // Si aucun bucket n'est encore au-dessus de Launchpad, fallback sur les buckets positifs
      if (filteredBucketsRaw.length === 0) {
        filteredBucketsRaw = Object.values(bucketsMap).filter(b => b.lvl >= 0);
      }
    }

    let scopeTotalVol = 0;
    filteredBucketsRaw.forEach(b => {
      scopeTotalVol += b.volume;
    });

    const buckets = filteredBucketsRaw.map(b => ({
      lvl: b.lvl,
      lvlEnd: b.lvl + bucketSize,
      volume: b.volume,
      upVolume: b.upVolume,
      downVolume: b.downVolume,
      tokenCount: b.tokens.size,
      tokenList: Array.from(b.tokens)
    })).sort((a, b) => a.lvl - b.lvl);

    let maxBucketVol = 0;
    let pocLvl = buckets.length > 0 ? buckets[0].lvl : pumpFloorLvl;
    let pocVol = 0;

    buckets.forEach(b => {
      if (b.volume > maxBucketVol) {
        maxBucketVol = b.volume;
        pocLvl = b.lvl;
        pocVol = b.volume;
      }
    });

    // 🎯 Calcul de la Value Area (70% de la liquidité du corridor sélectionné)
    const sortedByLvl = [...buckets].sort((a, b) => a.lvl - b.lvl);
    const pocIdx = sortedByLvl.findIndex(b => b.lvl === pocLvl);
    let vaMinIdx = pocIdx >= 0 ? pocIdx : 0;
    let vaMaxIdx = pocIdx >= 0 ? pocIdx : 0;
    let currentVaVol = pocIdx >= 0 ? (sortedByLvl[pocIdx]?.volume || 0) : 0;
    const targetVaVol = scopeTotalVol * 0.70;

    while (currentVaVol < targetVaVol && (vaMinIdx > 0 || vaMaxIdx < sortedByLvl.length - 1)) {
      const nextUpVol = vaMaxIdx < sortedByLvl.length - 1 ? sortedByLvl[vaMaxIdx + 1].volume : -1;
      const nextDownVol = vaMinIdx > 0 ? sortedByLvl[vaMinIdx - 1].volume : -1;

      if (nextUpVol >= nextDownVol && nextUpVol !== -1) {
        vaMaxIdx++;
        currentVaVol += nextUpVol;
      } else if (nextDownVol !== -1) {
        vaMinIdx--;
        currentVaVol += nextDownVol;
      } else {
        break;
      }
    }

    const val = sortedByLvl[vaMinIdx]?.lvl ?? pocLvl;
    const vah = sortedByLvl[vaMaxIdx]?.lvlEnd ?? (pocLvl + 1);
    const vaVolume = currentVaVol;

    const minLvl = buckets.length > 0 ? buckets[0].lvl : pumpFloorLvl;
    const maxLvl = buckets.length > 0 ? buckets[buckets.length - 1].lvlEnd : (pumpFloorLvl + 30);

    const enrichedBuckets = buckets.map(b => {
      const pctOfMax = maxBucketVol > 0 ? (b.volume / maxBucketVol) * 100 : 0;
      const pctOfTotal = scopeTotalVol > 0 ? (b.volume / scopeTotalVol) * 100 : 0;
      const isPoc = b.lvl === pocLvl;
      const isHvn = pctOfMax >= 60;
      const isLvn = pctOfMax < 25 && b.lvl > pocLvl;
      const isInValueArea = b.lvl >= val && b.lvl < vah;
      
      const tokenObjects = b.tokenList.map(sym => tokensMap[sym]).filter(Boolean);

      return {
        ...b,
        pctOfMax: parseFloat(pctOfMax.toFixed(1)),
        pctOfTotal: parseFloat(pctOfTotal.toFixed(1)),
        isPoc,
        isHvn,
        isLvn,
        isInValueArea,
        tokenObjects
      };
    });

    const hvnList = enrichedBuckets.filter(b => b.isHvn);
    const lvnList = enrichedBuckets.filter(b => b.isLvn);

    return {
      buckets: enrichedBuckets,
      pocLvl,
      pocVol,
      maxBucketVol,
      totalVolume: scopeTotalVol,
      globalMarketVol: totalVol,
      vah,
      val,
      vaVolume,
      minLvl,
      maxLvl,
      hvnList,
      lvnList,
      pumpFloorLvl,
      zoneScope: vpvrZoneScope
    };
  }, [tokensData, activeChartHorizon, vpvrZoneScope, chartProcessedData]);

  // 🎯 CLASSIFICATION STRICTE DES 4 ZONES MACRO (DEMANDE UTILISATEUR)
  const macro4Zones = useMemo(() => {
    const list = tripleAnalysis?.listMonth || [];
    if (list.length === 0) return { zone1: [], zone2: [], zone3: [], zone4: [], lvlDay: 0, lvlRes: 0, lvlMonth: 0 };

    const lvlDay = chartProcessedData.lastMasterDay || 3.5;
    const lvlRes = tripleAnalysis.dynamicMonthlyRefLevel || 11.5;
    const lvlMonth = chartProcessedData.lastMasterMonth || 29.0;

    const z1 = [];
    const z2 = [];
    const z3 = [];
    const z4 = [];

    list.forEach(t => {
      const curve = chartProcessedData.tokenCurvesMap[t.cleanSymbol] || [];
      const latestVal = curve.length > 0 
        ? curve[curve.length - 1].value 
        : (activeChartHorizon === 'month' ? t.scoreMonth : activeChartHorizon === 'week' ? t.scoreWeek : t.scoreDay);
      
      const tokenWithVal = { ...t, latestVal, curveData: curve };

      if (latestVal < lvlDay) {
        z1.push(tokenWithVal);
      } else if (latestVal < lvlRes) {
        z2.push(tokenWithVal);
      } else if (latestVal < lvlMonth) {
        z3.push(tokenWithVal);
      } else {
        z4.push(tokenWithVal);
      }
    });

    z1.sort((a, b) => b.latestVal - a.latestVal);
    z2.sort((a, b) => b.latestVal - a.latestVal);
    z3.sort((a, b) => b.latestVal - a.latestVal);
    z4.sort((a, b) => b.latestVal - a.latestVal);

    return { zone1: z1, zone2: z2, zone3: z3, zone4: z4, lvlDay, lvlRes, lvlMonth };
  }, [tripleAnalysis, chartProcessedData, activeChartHorizon]);

  // 🧭 CALCUL DU SENTIMENT DU MARCHÉ EN DIRECT (TOP 50 TOKENS : HAUSSE VS BAISSE & DAGHT DU MOMENT)
  const marketSentiment = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    const top50 = list.slice(0, 50).filter(t => t.cleanSymbol !== 'BTC' && t.cleanSymbol !== 'ETH');
    const tokenCurvesMap = chartProcessedData?.tokenCurvesMap || {};

    if (top50.length === 0) {
      return {
        upCount: 0,
        downCount: 0,
        neutralCount: 0,
        totalCount: 0,
        upPct: 50,
        downPct: 50,
        dominance: 'NEUTRE',
        tokensDeltaMap: {}
      };
    }

    let upCount = 0;
    let downCount = 0;
    let neutralCount = 0;
    const tokensDeltaMap = {};

    top50.forEach(t => {
      const curve = tokenCurvesMap[t.cleanSymbol] || [];
      let delta = 0;
      let lastVal = 0;
      let prevVal = 0;

      if (curve.length >= 2) {
        lastVal = curve[curve.length - 1].value;
        const lookbackIdx = Math.max(0, curve.length - 3); // Regard sur les 2-3 dernières bougies (~30-45min de trading)
        prevVal = curve[lookbackIdx].value;
        delta = parseFloat((lastVal - prevVal).toFixed(2));
      } else {
        lastVal = t.scoreDay || 0;
        prevVal = 0;
        delta = parseFloat(lastVal.toFixed(2));
      }

      const isUp = delta > 0.05;
      const isDown = delta < -0.05;

      tokensDeltaMap[t.cleanSymbol] = {
        delta,
        isUp,
        isDown,
        lastVal,
        prevVal
      };

      if (isUp) upCount++;
      else if (isDown) downCount++;
      else neutralCount++;
    });

    const activeTotal = upCount + downCount + neutralCount || top50.length;
    const upPct = Math.round((upCount / activeTotal) * 100);
    const downPct = Math.round((downCount / activeTotal) * 100);

    let dominance = 'NEUTRE';
    if (upPct >= 55) dominance = 'BULL';
    else if (downPct >= 55) dominance = 'BEAR';

    return {
      upCount,
      downCount,
      neutralCount,
      totalCount: top50.length,
      upPct,
      downPct,
      dominance,
      tokensDeltaMap
    };
  }, [tripleAnalysis, chartUniverse, chartProcessedData]);

  // 🧮 CALCUL DES MÉTRIQUES QUANTITATIVES SNIPER (GAIN/PERTE, WIN RATE, RISK/REWARD, ESPÉRANCE)
  const quantMetrics = useMemo(() => {
    const list = (chartUniverse === 'MONTH_PEAK' ? tripleAnalysis?.listMaxPointsMonth : tripleAnalysis?.listMonth) || [];
    if (list.length === 0 || !chartProcessedData) {
      return {
        entryLvl: 0,
        slLvl: 0,
        tpLvl: 0,
        totalSignals: 0,
        wins: 0,
        losses: 0,
        inProgress: 0,
        winRate: 0,
        avgGainPts: 0,
        avgLossPts: 0,
        riskReward: '1 : 3.0',
        currentPnlPts: 0,
        expectancyPts: 0,
        trades: []
      };
    }

    const isDay = activeChartHorizon === 'day';
    const isWeek = activeChartHorizon === 'week';
    
    // Niveaux selon l'horizon
    const entryLvl = isDay 
      ? (chartProcessedData.launchpad24hData?.lvl || 8.0)
      : isWeek
        ? parseFloat(((chartProcessedData.valMax || 25.0) * 0.75).toFixed(2))
        : (chartProcessedData.valMax || 32.0);

    const slLvl = isDay
      ? parseFloat(Math.max(0, entryLvl - 2.0).toFixed(2))
      : isWeek
        ? parseFloat(Math.min(entryLvl - 2.0, chartProcessedData.lastMasterWeek || 12.0).toFixed(2))
        : parseFloat(Math.min(entryLvl - 2.0, chartProcessedData.lastMasterMonth || 24.0).toFixed(2));

    const tpLvl = isDay
      ? Math.max(parseFloat((entryLvl + 4.0).toFixed(2)), chartProcessedData.rejectionWall24hData?.lvl || parseFloat((entryLvl + 6.5).toFixed(2)))
      : parseFloat(Math.max(entryLvl + 5.0, entryLvl * 1.35).toFixed(2));

    const tokenCurvesMap = chartProcessedData.tokenCurvesMap || {};
    const trades = [];

    list.slice(0, selectedTopCount).forEach(t => {
      const curve = tokenCurvesMap[t.cleanSymbol] || [];
      if (curve.length === 0) return;

      let triggeredIdx = -1;
      let maxPtAfterTrigger = -Infinity;
      let minPtAfterTrigger = Infinity;

      for (let i = 0; i < curve.length; i++) {
        const val = curve[i].value;
        if (triggeredIdx === -1 && val >= entryLvl) {
          triggeredIdx = i;
        }
        if (triggeredIdx !== -1) {
          if (val > maxPtAfterTrigger) maxPtAfterTrigger = val;
          if (val < minPtAfterTrigger) minPtAfterTrigger = val;
        }
      }

      // Si le token a franchi la ligne d'entrée
      if (triggeredIdx !== -1) {
        const currentVal = curve[curve.length - 1].value;
        const pnlPts = parseFloat((currentVal - entryLvl).toFixed(2));
        const peakGainPts = parseFloat((maxPtAfterTrigger - entryLvl).toFixed(2));

        let status = 'IN_PROGRESS';
        if (maxPtAfterTrigger >= tpLvl || currentVal >= tpLvl) {
          status = 'WIN';
        } else if (minPtAfterTrigger <= slLvl || currentVal <= slLvl) {
          status = 'LOSS';
        }

        trades.push({
          symbol: t.cleanSymbol,
          entryLvl,
          slLvl,
          tpLvl,
          currentVal,
          maxPt: maxPtAfterTrigger,
          pnlPts,
          peakGainPts,
          status,
          phase: t.phase4h?.shortLabel || 'N/A',
          fixedColor: getTokenFixedColor(t.cleanSymbol)
        });
      }
    });

    const winsList = trades.filter(tr => tr.status === 'WIN');
    const lossList = trades.filter(tr => tr.status === 'LOSS');
    const inProgressList = trades.filter(tr => tr.status === 'IN_PROGRESS');

    const totalDecided = winsList.length + lossList.length;
    const winRate = totalDecided > 0 ? parseFloat(((winsList.length / totalDecided) * 100).toFixed(1)) : (trades.length > 0 ? 80.0 : 0);

    const sumGains = winsList.reduce((acc, tr) => acc + Math.max(0, tr.peakGainPts), 0);
    const avgGainPts = winsList.length > 0 ? parseFloat((sumGains / winsList.length).toFixed(2)) : parseFloat(Math.max(1, tpLvl - entryLvl).toFixed(2));

    const sumLosses = lossList.reduce((acc, tr) => acc + Math.abs(Math.min(0, tr.pnlPts)), 0);
    const avgLossPts = lossList.length > 0 ? parseFloat((sumLosses / lossList.length).toFixed(2)) : parseFloat(Math.max(0.5, entryLvl - slLvl).toFixed(2));

    const targetDist = Math.max(0.1, tpLvl - entryLvl);
    const riskDist = Math.max(0.1, entryLvl - slLvl);
    const rrValue = (riskDist > 0) ? (targetDist / riskDist).toFixed(1) : '3.0';

    const currentPnlPts = parseFloat(trades.reduce((acc, tr) => acc + tr.pnlPts, 0).toFixed(2));
    
    // Espérance Mathématique = (WinRate% * AvgGain) - (LossRate% * AvgLoss)
    const winProb = winRate / 100;
    const lossProb = 1 - winProb;
    const expectancyPts = parseFloat(((winProb * avgGainPts) - (lossProb * avgLossPts)).toFixed(2));

    return {
      entryLvl,
      slLvl,
      tpLvl,
      totalSignals: trades.length,
      wins: winsList.length,
      losses: lossList.length,
      inProgress: inProgressList.length,
      winRate,
      avgGainPts,
      avgLossPts,
      riskReward: `1 : ${rrValue}`,
      currentPnlPts,
      expectancyPts,
      trades
    };
  }, [tripleAnalysis, chartUniverse, activeChartHorizon, chartProcessedData, selectedTopCount]);

  // 🎯 DÉTECTION EN TEMPS RÉEL DES NOUVEAUX DÉPARTS LAUNCHPAD (DÉMARRAGE À ZÉRO SANS LES ANCIENS PUMPS)
  useEffect(() => {
    if (!tripleAnalysis || !chartProcessedData) return;

    const { tokenCurvesMap, launchpad24hData } = chartProcessedData;
    if (!tokenCurvesMap || !launchpad24hData) return;

    const launchpadLvl = launchpad24hData.lvl || 8.0;
    const currentTpLvl = quantMetrics?.tpLvl || (launchpadLvl + 6.0);
    const currentSlLvl = quantMetrics?.slLvl || Math.max(0, launchpadLvl - 2.0);

    const activeList = tripleAnalysis.listMonth || [];

    // 🚀 1. INITIALISATION DE LA BASELINE AU PREMIER CHARGEMENT DU SCANNER :
    // On enregistre les scores actuels de tous les tokens pour NE PAS déclencher d'alertes sur les anciens pumps passés !
    if (!isBaselineInitializedRef.current) {
      const initialMap = {};
      activeList.forEach(item => {
        const sym = item.cleanSymbol;
        const curve = tokenCurvesMap[sym];
        if (curve && curve.length > 0) {
          initialMap[sym] = curve[curve.length - 1].value;
        }
      });
      prevTokensScoresRef.current = initialMap;
      isBaselineInitializedRef.current = true;
      return;
    }

    let historyChanged = false;
    let newSignalsTriggered = [];

    // 2. Détection STRICTE des VRAIS nouveaux franchissements en direct (Live Crossover)
    activeList.forEach((item, idx) => {
      const sym = item.cleanSymbol;
      const curve = tokenCurvesMap[sym];
      if (!curve || curve.length === 0) return;

      const latestVal = curve[curve.length - 1].value;
      const prevVal = prevTokensScoresRef.current[sym] !== undefined ? prevTokensScoresRef.current[sym] : latestVal;
      prevTokensScoresRef.current[sym] = latestVal;

      const rankNum = item.rankMonth || idx + 1;

      // ⚡ VRAI SIGNAL EN DIRECT : Le token était STRICTEMENT sous la ligne Launchpad et vient de percer en direct !
      const isFreshLiveBreakout = prevVal < launchpadLvl && latestVal >= launchpadLvl && latestVal >= currentSlLvl;

      if (isFreshLiveBreakout) {
        // Vérifier si pas déjà actif
        const existingSignal = signalsHistory.find(s => s.symbol === sym && s.status === 'ACTIVE');

        if (!existingSignal) {
          const nowIso = new Date().toISOString();
          const now = new Date();
          const newSig = {
            id: `SIG_${sym}_${Date.now()}`,
            symbol: sym,
            rank: rankNum,
            triggerScore: parseFloat(latestVal.toFixed(2)),
            launchpadLvl: parseFloat(launchpadLvl.toFixed(2)),
            tpLvl: parseFloat(currentTpLvl.toFixed(2)),
            slLvl: parseFloat(currentSlLvl.toFixed(2)),
            currentScore: parseFloat(latestVal.toFixed(2)),
            maxScoreReached: parseFloat(latestVal.toFixed(2)),
            minScoreReached: parseFloat(latestVal.toFixed(2)),
            pnlPts: 0,
            status: latestVal >= currentTpLvl ? 'WIN' : 'ACTIVE',
            timestamp: nowIso,
            timeLabel: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            dateLabel: now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
            p30d: item.p30d || 0,
            scoreDay: item.scoreDay || 0
          };

          newSignalsTriggered.push(newSig);
        }
      }
    });

    // 3. Synchronisation en continu des signaux existants
    let updatedHistory = signalsHistory.map(sig => {
      const curve = tokenCurvesMap[sig.symbol];
      if (!curve || curve.length === 0) return sig;

      const currentScore = curve[curve.length - 1].value;
      const newMax = Math.max(sig.maxScoreReached ?? sig.triggerScore, currentScore);
      const newMin = Math.min(sig.minScoreReached ?? sig.triggerScore, currentScore);

      let status = sig.status;
      let pnlPts = parseFloat((currentScore - sig.triggerScore).toFixed(2));
      let closedAt = sig.closedAt;

      if (status === 'ACTIVE') {
        if (newMax >= sig.tpLvl) {
          status = 'WIN';
          pnlPts = parseFloat((sig.tpLvl - sig.triggerScore).toFixed(2));
          closedAt = new Date().toISOString();
          historyChanged = true;
        } else if (currentScore <= sig.slLvl) {
          status = 'STOPPED';
          pnlPts = parseFloat((sig.slLvl - sig.triggerScore).toFixed(2));
          closedAt = new Date().toISOString();
          historyChanged = true;
        }
      }

      if (
        parseFloat(currentScore.toFixed(2)) !== sig.currentScore ||
        parseFloat(newMax.toFixed(2)) !== sig.maxScoreReached ||
        status !== sig.status
      ) {
        historyChanged = true;
        return {
          ...sig,
          currentScore: parseFloat(currentScore.toFixed(2)),
          maxScoreReached: parseFloat(newMax.toFixed(2)),
          minScoreReached: parseFloat(newMin.toFixed(2)),
          pnlPts,
          status,
          closedAt
        };
      }
      return sig;
    });

    // 4. Si nouveau signal, déclencher Alerte Sonore + Toast + Enregistrer dans l'historique
    if (newSignalsTriggered.length > 0) {
      historyChanged = true;
      updatedHistory = [...newSignalsTriggered, ...updatedHistory];

      const latestNewSig = newSignalsTriggered[0];
      setActiveAlertToast(latestNewSig);

      if (soundEnabled) {
        playLaunchpadAlertSound();
      }

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setActiveAlertToast(null);
      }, 7000);
    }

    if (historyChanged) {
      setSignalsHistory(updatedHistory);
      try {
        localStorage.setItem(STORAGE_KEY_LAUNCHPAD_SIGNALS, JSON.stringify(updatedHistory));
      } catch (_) {}
    }
  }, [tripleAnalysis, chartProcessedData, quantMetrics, soundEnabled]);

  // 📍 CALCUL PRÉCIS ET VERROUILLAGE PIXEL-PERFECT DU RISK/REWARD BOX SUR LE GRAPHIQUE
  const updateOverlayPositions = useCallback(() => {
    if (!chartContainerRef.current || !chartRef.current) return;
    
    // 🔥 Série ancre globale couvrant tout l'intervalle réel [valMin, valMax]
    const anchorSeries = refScaleAnchorSeriesRef.current 
      || refDailyMinSeriesRef.current
      || refEma20SeriesRef.current;

    const container = chartContainerRef.current;
    const w = container.clientWidth || 800;
    const h = chartHeight || 520;

    const minVal = chartProcessedData?.valMin ?? 0;
    const maxVal = chartProcessedData?.valMax ?? 30;
    const range = (maxVal - minVal) || 1;

    let yMin = anchorSeries?.priceToCoordinate ? anchorSeries.priceToCoordinate(minVal) : null;
    let yMax = anchorSeries?.priceToCoordinate ? anchorSeries.priceToCoordinate(maxVal) : null;

    let entryY = anchorSeries?.priceToCoordinate ? anchorSeries.priceToCoordinate(quantMetrics.entryLvl) : null;
    let tpY = anchorSeries?.priceToCoordinate ? anchorSeries.priceToCoordinate(quantMetrics.tpLvl) : null;
    let slY = anchorSeries?.priceToCoordinate ? anchorSeries.priceToCoordinate(quantMetrics.slLvl) : null;

    // 🔥 FORMULE D'INTERPOLATION LINÉAIRE EXACTE SI LES COORDONNÉES MIN/MAX SONT CONNUES
    if (yMin !== null && yMax !== null && !isNaN(yMin) && !isNaN(yMax) && Math.abs(yMin - yMax) > 10) {
      const calcExactY = (price) => yMin - ((price - minVal) / range) * (yMin - yMax);
      entryY = calcExactY(quantMetrics.entryLvl);
      tpY = calcExactY(quantMetrics.tpLvl);
      slY = calcExactY(quantMetrics.slLvl);
    }

    // Ne pas appliquer si les coordonnées de prix ne sont pas prêtes
    if (entryY === null || isNaN(entryY)) {
      return;
    }

    // Le TP doit toujours être au-dessus de l'Entrée (coordonnée Y inférieure)
    const validEntryY = Math.max(15, Math.min(h - 15, entryY));
    const validTpY = Math.max(8, Math.min(tpY ?? (validEntryY - 60), validEntryY - 10));
    const validSlY = Math.min(h - 8, Math.max(slY ?? (validEntryY + 30), validEntryY + 10));

    // Positionnement X : Pleine largeur sur tout le graphique 24H (du début à la fin de l'horizon)
    const boxLeft = 0;
    const boxWidth = Math.max(200, w - 60);

    setTvToolCoords({
      valid: true,
      tpY: validTpY,
      entryY: validEntryY,
      slY: validSlY,
      left: boxLeft,
      width: boxWidth
    });
  }, [quantMetrics, chartHeight, chartProcessedData]);

  useEffect(() => {
    const runUpdate = () => {
      updateOverlayPositions();
    };

    // Déclenchements multiples pour garantir le calcul après chaque étape de layout
    const t0 = setTimeout(runUpdate, 10);
    const t1 = setTimeout(runUpdate, 50);
    const t2 = setTimeout(runUpdate, 150);
    const t3 = setTimeout(runUpdate, 350);
    const t4 = setTimeout(runUpdate, 700);

    const container = chartContainerRef.current;
    if (container) {
      container.addEventListener('wheel', runUpdate, { passive: true });
      container.addEventListener('mousemove', runUpdate, { passive: true });
      container.addEventListener('pointermove', runUpdate, { passive: true });
    }

    return () => {
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      if (container) {
        container.removeEventListener('wheel', runUpdate);
        container.removeEventListener('mousemove', runUpdate);
        container.removeEventListener('pointermove', runUpdate);
      }
    };
  }, [updateOverlayPositions, quantMetrics, chartHeight, activeChartHorizon, chartUniverse, tokensData]);


  // 4. Dessiner les 50 Champions du Mois (Universe Fixe) zoomés selon l'horizon actif (Mois, Semaine, Jour)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !tripleAnalysis || !tokensData || tokensData.length === 0) return;

    const { dynamicMonthlyRefLevel, listMonth, listMaxPointsMonth } = tripleAnalysis;
    const activeList = (chartUniverse === 'MONTH_PEAK' ? listMaxPointsMonth : listMonth) || [];

    if (!activeList || activeList.length === 0) return;

    const {
      tokenCurvesMap,
      horizonTimestamps,
      dynamicEma20DayData,
      dynamicEma20WeekData,
      dynamicEma20MonthData,
      lastMasterDay,
      lastMasterWeek,
      lastMasterMonth,
      valMax,
      valMin
    } = chartProcessedData;

    const lastEma20Active = lastMasterDay;
    const isDay = activeChartHorizon === 'day';
    const isWeek = activeChartHorizon === 'week';
    const num15mBars = isDay ? 96 : isWeek ? 672 : 1000;
    const step = isDay ? 1 : isWeek ? 4 : 16;
    let longestToken = activeList[0];
    activeList.forEach(t => {
      if (t.rawKlines && t.rawKlines.length > (longestToken?.rawKlines?.length || 0)) longestToken = t;
    });
    const klinesRef = longestToken?.rawKlines || [];
    const lenRef = klinesRef.length;
    const startIdx = Math.max(0, lenRef - num15mBars);

    // MODE 1 : AFFICHAGE EN BOUGIES EN POINTS DU TOKEN UNIQUE SÉLECTIONNÉ
    if (selectedSoloToken) {
      // Nettoyer toutes les courbes de tokens multiples
      Object.keys(seriesMapRef.current).forEach(sym => {
        try {
          chart.removeSeries(seriesMapRef.current[sym]);
          delete seriesMapRef.current[sym];
        } catch (_) {}
      });

      // Créer ou réutiliser la série de bougies
      if (!soloCandleSeriesRef.current) {
        soloCandleSeriesRef.current = chart.addCandlestickSeries({
          upColor: '#00ff88',
          downColor: '#ef4444',
          borderVisible: false,
          wickUpColor: '#00ff88',
          wickDownColor: '#ef4444',
          priceLineVisible: false,
          lastValueVisible: true,
          title: `🕯️ BOUGIES ${selectedSoloToken.cleanSymbol} (POINTS)`
        });
      }

      // Construction des bougies en points pour le token sélectionné
      const soloKlines = selectedSoloToken.rawKlines || [];
      const sLen = soloKlines.length;
      const soloCandles = [];

      if (sLen >= 15) {
        const sBaseOffset = Math.min(sLen - 1, sLen - 1 - (lenRef - 1 - startIdx));
        const sBasePrice = parseFloat(soloKlines[Math.max(0, sBaseOffset)][4]);

        if (sBasePrice > 0) {
          for (let i = startIdx; i < lenRef; i += step) {
            const timeMs = parseInt(klinesRef[i][0]);
            const candleTime = Math.floor(timeMs / 1000);

            const currentBarOffset = lenRef - 1 - i;
            const targetTokenIdx = Math.max(0, sLen - 1 - currentBarOffset);
            const kStart = soloKlines[targetTokenIdx];
            const endTokenIdx = Math.min(sLen - 1, targetTokenIdx + (step - 1));
            const kEnd = soloKlines[endTokenIdx] || kStart;

            if (kStart && kEnd) {
              const oPrice = parseFloat(kStart[1]);
              const cPrice = parseFloat(kEnd[4]);
              let hPrice = -Infinity, lPrice = Infinity;

              for (let b = targetTokenIdx; b <= endTokenIdx; b++) {
                if (soloKlines[b]) {
                  const h = parseFloat(soloKlines[b][2]);
                  const l = parseFloat(soloKlines[b][3]);
                  if (h > hPrice) hPrice = h;
                  if (l < lPrice) lPrice = l;
                }
              }
              if (hPrice === -Infinity) hPrice = Math.max(oPrice, cPrice);
              if (lPrice === Infinity) lPrice = Math.min(oPrice, cPrice);

              const oPts = ((oPrice - sBasePrice) / sBasePrice) * 100;
              const hPts = ((hPrice - sBasePrice) / sBasePrice) * 100;
              const lPts = ((lPrice - sBasePrice) / sBasePrice) * 100;
              const cPts = ((cPrice - sBasePrice) / sBasePrice) * 100;

              let avgOpen = parseFloat(oPts.toFixed(2));
              let avgHigh = parseFloat(hPts.toFixed(2));
              let avgLow = parseFloat(lPts.toFixed(2));
              let avgClose = parseFloat(cPts.toFixed(2));

              avgHigh = Math.max(avgHigh, avgOpen, avgClose);
              avgLow = Math.min(avgLow, avgOpen, avgClose);

              soloCandles.push({
                time: candleTime,
                open: avgOpen,
                high: avgHigh,
                low: avgLow,
                close: avgClose
              });
            }
          }
        }
      }

      if (soloCandles.length > 0) {
        soloCandleSeriesRef.current.setData(soloCandles);
      }
    } else {
      // MODE 2 : AFFICHAGE MULTI-COURBES DE TOUS LES CHAMPIONS
      if (soloCandleSeriesRef.current) {
        try {
          chart.removeSeries(soloCandleSeriesRef.current);
          soloCandleSeriesRef.current = null;
        } catch (_) {}
      }

      const slicedActiveList = activeList.slice(0, selectedTopCount);
      const currentSlLvl = activeChartHorizon === 'day' 
        ? parseFloat(Math.max(0, (chartProcessedData.launchpad24hData?.lvl || 8) - 2.0).toFixed(2)) 
        : (quantMetrics?.slLvl || 6.0);
      const currentTpLvl = activeChartHorizon === 'day'
        ? (chartProcessedData.rejectionWall24hData?.lvl || 14.3)
        : (quantMetrics?.tpLvl || 14.3);

      const filteredTokens = slicedActiveList.filter(item => {
        const data = tokenCurvesMap[item.cleanSymbol];
        if (!data || data.length === 0) return false;

        const latestVal = data[data.length - 1].value;

        // 🛡️ Filtre Purificateur : Masquer tous les tokens morts / échoués sous le Stop Loss (< SL)
        if (filterAboveStopLossOnly && latestVal < currentSlLvl) {
          return false;
        }

        // ⚡ Filtre Nouveaux Entrants Seuls (Pré-Target / Ignition corridor) :
        // 1. Masquer les tokens actuels >= TP (qui ont déjà atteint / dépassé la zone verte)
        // 2. Masquer les anciens tokens ayant DÉJÀ atteint la zone verte dans l'historique de la courbe
        // 3. Masquer les tokens sous le Stop Loss (< SL)
        // -> Ne conserve et n'affiche en temps réel QUE les nouveaux entrants prêts à exploser vers la Target !
        if (filterFreshBreakoutsOnly) {
          if (latestVal >= currentTpLvl) return false;
          if (latestVal < currentSlLvl) return false;
          let maxPastVal = -Infinity;
          for (let k = 0; k < data.length; k++) {
            if (data[k].value > maxPastVal) maxPastVal = data[k].value;
          }
          if (maxPastVal >= currentTpLvl) return false;
        }

        return true;
      });

      const activeSymbolsSet = new Set(filteredTokens.map(t => t.cleanSymbol));
      Object.keys(seriesMapRef.current).forEach(sym => {
        if (!activeSymbolsSet.has(sym)) {
          try {
            chart.removeSeries(seriesMapRef.current[sym]);
            delete seriesMapRef.current[sym];
          } catch (_) {}
        }
      });

      filteredTokens.forEach((item, idx) => {
        const fixedColor = getTokenFixedColor(item.cleanSymbol);
        const rankNum = chartUniverse === 'MONTH_PEAK' ? (item.rankPeak || idx + 1) : (item.rankMonth || idx + 1);
        const scoreVal = chartUniverse === 'MONTH_PEAK' 
          ? (item.maxPointsMonth || item.p30d || 0)
          : (activeChartHorizon === 'month' ? item.scoreMonth : activeChartHorizon === 'week' ? item.scoreWeek : item.scoreDay);
        
        const volStr = item.turnover24h > 0 ? ` (${formatVolumeUSDT(item.turnover24h)})` : '';
        const tag = getTokenVolMcapAndDominanceTag(item, dailyCgData, dailyMarketCaps);
        const title = `#${rankNum} ${item.cleanSymbol}${tag}${volStr}`;
        const tokenData = tokenCurvesMap[item.cleanSymbol];

        let lineSeries = seriesMapRef.current[item.cleanSymbol];
        if (!lineSeries) {
          lineSeries = chart.addLineSeries({
            color: fixedColor,
            lineWidth: 2,
            lineStyle: 0,
            title: title,
            priceLineVisible: false,
            lastValueVisible: true,
          });
          seriesMapRef.current[item.cleanSymbol] = lineSeries;
        } else {
          lineSeries.applyOptions({ color: fixedColor, lineWidth: 2, title });
        }

        if (tokenData && tokenData.length > 0) {
          lineSeries.setData(tokenData);
        }
      });
    }

    // Recréation des 3 EMA 20 en avant-plan absolu
    if (refEma50SeriesRef.current) {
      try { chart.removeSeries(refEma50SeriesRef.current); } catch (_) {}
      refEma50SeriesRef.current = null;
    }
    if (refEma20SeriesRef.current) {
      try { chart.removeSeries(refEma20SeriesRef.current); } catch (_) {}
      refEma20SeriesRef.current = null;
    }
    if (refWeeklyEma20SeriesRef.current) {
      try { chart.removeSeries(refWeeklyEma20SeriesRef.current); } catch (_) {}
      refWeeklyEma20SeriesRef.current = null;
    }
    if (refMonthlyEma20SeriesRef.current) {
      try { chart.removeSeries(refMonthlyEma20SeriesRef.current); } catch (_) {}
      refMonthlyEma20SeriesRef.current = null;
    }

    if (refDailyMaxSeriesRef.current && horizonTimestamps.length > 0) {
      refDailyMaxSeriesRef.current.applyOptions({ color: '#10b981', lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: `🟢 BENCHMARK MAX (+${valMax} pts)` });
      refDailyMaxSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: valMax })));
    }

    if (refMonthlySeriesRef.current && horizonTimestamps.length > 0) {
      refMonthlySeriesRef.current.applyOptions({ color: '#22d3ee', lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: `⚡ RÉSISTANCE MACRO (${dynamicMonthlyRefLevel}%)` });
      refMonthlySeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: dynamicMonthlyRefLevel })));
    }

    // 👑 1. EMA 20 MOIS (Valeur Master Universelle)
    if (dynamicEma20MonthData.length > 0) {
      const sMonth = chart.addLineSeries({
        color: '#ec4899',
        lineWidth: 4.5,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `👑 EMA 20 MOIS (${lastMasterMonth >= 0 ? '+' : ''}${lastMasterMonth} pts)`
      });
      sMonth.setData(dynamicEma20MonthData);
      refMonthlyEma20SeriesRef.current = sMonth;
    }

    // 🌐 2. EMA 20 SEMAINE (Valeur Master Universelle)
    if (dynamicEma20WeekData.length > 0) {
      const sWeek = chart.addLineSeries({
        color: '#6366f1',
        lineWidth: 4.5,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `🌐 EMA 20 SEMAINE (${lastMasterWeek >= 0 ? '+' : ''}${lastMasterWeek} pts)`
      });
      sWeek.setData(dynamicEma20WeekData);
      refWeeklyEma20SeriesRef.current = sWeek;
    }

    // 🔵 3. EMA 20 JOUR (Valeur Master Universelle)
    if (dynamicEma20DayData.length > 0) {
      const sDay = chart.addLineSeries({
        color: '#00ffff',
        lineWidth: 4.5,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `🔵 EMA 20 JOUR (${lastMasterDay >= 0 ? '+' : ''}${lastMasterDay} pts)`
      });
      sDay.setData(dynamicEma20DayData);
      refEma20SeriesRef.current = sDay;
    }

    if (refDailyMinSeriesRef.current && horizonTimestamps.length > 0) {
      refDailyMinSeriesRef.current.applyOptions({ color: '#ef4444', lineWidth: 2, lineStyle: 2, priceLineVisible: false, title: `🔴 BENCHMARK MIN (${valMin >= 0 ? '+' : ''}${valMin} pts)` });
      refDailyMinSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: valMin })));
    }

    // ⛔ 4. MUR DE REJET COLLECTIF 24H (Ligne de Résistance des Sommets)
    if (ref24hRejectionWallSeriesRef.current && horizonTimestamps.length > 0) {
      const rData = chartProcessedData.rejectionWall24hData;
      if (rData && rData.lvl > 0 && activeChartHorizon === 'day') {
        ref24hRejectionWallSeriesRef.current.applyOptions({
          color: '#ff0055',
          lineWidth: 3.5,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: `⛔ MUR DE REJET 24H (+${rData.lvl} pts)`
        });
        ref24hRejectionWallSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: rData.lvl })));
      } else {
        ref24hRejectionWallSeriesRef.current.setData([]);
      }
    }

    // 🚀 5. LAUNCHPAD IGNITION 24H (Niveau de départ des Pumps > +10%)
    if (ref24hLaunchpadSeriesRef.current && horizonTimestamps.length > 0) {
      const lData = chartProcessedData.launchpad24hData;
      if (lData && lData.pumpingCount > 0 && activeChartHorizon === 'day') {
        ref24hLaunchpadSeriesRef.current.applyOptions({
          color: '#00ff88',
          lineWidth: 3,
          lineStyle: 3,
          priceLineVisible: false,
          lastValueVisible: true,
          title: `🚀 LAUNCHPAD IGNITION (+${lData.lvl} pts)`
        });
        ref24hLaunchpadSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: lData.lvl })));
      } else {
        ref24hLaunchpadSeriesRef.current.setData([]);
      }
    }

    // 🎯 6. LIGNE D'ENTRÉE SNIPER
    if (refSniperEntrySeriesRef.current && horizonTimestamps.length > 0) {
      const isDay = activeChartHorizon === 'day';
      const isWeek = activeChartHorizon === 'week';
      const entryVal = isDay 
        ? (chartProcessedData.launchpad24hData?.lvl || 8.0)
        : isWeek
          ? parseFloat(((chartProcessedData.valMax || 25.0) * 0.75).toFixed(2))
          : (chartProcessedData.valMax || 32.0);

      refSniperEntrySeriesRef.current.applyOptions({
        color: '#00e5ff',
        lineWidth: 3.5,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `🎯 LIGNE D'ENTRÉE (+${entryVal} pts)`
      });
      refSniperEntrySeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: entryVal })));
    }

    // 🛑 7. LIGNE STOP LOSS (INVALIDATION)
    if (refSniperStopLossSeriesRef.current && horizonTimestamps.length > 0) {
      const isDay = activeChartHorizon === 'day';
      const isWeek = activeChartHorizon === 'week';
      const entryVal = isDay 
        ? (chartProcessedData.launchpad24hData?.lvl || 8.0)
        : isWeek
          ? parseFloat(((chartProcessedData.valMax || 25.0) * 0.75).toFixed(2))
          : (chartProcessedData.valMax || 32.0);

      const slVal = isDay
        ? parseFloat(Math.max(0, entryVal - 2.0).toFixed(2))
        : isWeek
          ? parseFloat(Math.min(entryVal - 2.0, chartProcessedData.lastMasterWeek || 12.0).toFixed(2))
          : parseFloat(Math.min(entryVal - 2.0, chartProcessedData.lastMasterMonth || 24.0).toFixed(2));

      refSniperStopLossSeriesRef.current.applyOptions({
        color: '#ff3366',
        lineWidth: 3,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: `🛑 STOP LOSS (+${slVal} pts)`
      });
      refSniperStopLossSeriesRef.current.setData(horizonTimestamps.map(t => ({ time: t, value: slVal })));
    }


    // ⚓ 9. ANCRE D'ÉCHELLE GLOBALE POUR POSITIONNEMENT PIXEL-PERFECT
    if (refScaleAnchorSeriesRef.current && horizonTimestamps.length >= 2) {
      refScaleAnchorSeriesRef.current.setData([
        { time: horizonTimestamps[0], value: valMin },
        { time: horizonTimestamps[horizonTimestamps.length - 1], value: valMax }
      ]);
    }

    chart.timeScale().fitContent();
    try {
      const range = chart.timeScale().getVisibleLogicalRange();
      if (range) {
        const totalBars = Math.max(10, range.to - range.from);
        const padding = Math.max(16, Math.round(totalBars * 0.12));
        chart.timeScale().setVisibleLogicalRange({
          from: range.from,
          to: range.to + padding
        });
      }
    } catch (_) {}
    setTimeout(updateOverlayPositions, 40);
    setTimeout(updateOverlayPositions, 250);
  }, [tripleAnalysis, activeChartHorizon, chartUniverse, tokensData, selectedPhaseFilter, selectedTopCount, selectedSoloToken, chartProcessedData, updateOverlayPositions, filterAboveStopLossOnly, filterFreshBreakoutsOnly, volumeProfileData, showVolumeProfile, dailyCgData, dailyMarketCaps]);

  // ⚡ Moteur LIVE 15M Haute Fréquence pour la Charte Principale
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !tokensData || tokensData.length === 0) return;

    const intervalId = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const activeCandleTime = Math.floor(nowSec / 900) * 900;
      const tokenBasePricesMap = chartProcessedData?.tokenBasePricesMap || {};
      const lastCandleTime = chartProcessedData?.lastCandleTime || activeCandleTime;
      const targetTime = Math.max(lastCandleTime, activeCandleTime);

      Object.keys(seriesMapRef.current).forEach(sym => {
        const livePrice = livePricesRef.current[sym];
        const basePrice = tokenBasePricesMap[sym];
        if (livePrice && basePrice > 0) {
          const lineSeries = seriesMapRef.current[sym];
          if (lineSeries) {
            const livePts = parseFloat((((livePrice - basePrice) / basePrice) * 100).toFixed(2));
            try {
              lineSeries.update({
                time: targetTime,
                value: livePts
              });
            } catch (_) {}
          }
        }
      });
    }, 500);

    return () => clearInterval(intervalId);
  }, [tokensData, chartProcessedData]);


  

  const handleResetZoom = () => {
    if (chartRef.current) {
      try {
        chartRef.current.timeScale().fitContent();
        const range = chartRef.current.timeScale().getVisibleLogicalRange();
        if (range) {
          const totalBars = Math.max(10, range.to - range.from);
          const padding = Math.max(16, Math.round(totalBars * 0.12));
          chartRef.current.timeScale().setVisibleLogicalRange({
            from: range.from,
            to: range.to + padding
          });
        }
      } catch (_) {
        chartRef.current.timeScale().fitContent();
      }
    }
  };

  const filterList = (list) => {
    let res = list;
    if (searchTerm) {
      res = res.filter(t => t.cleanSymbol.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    if (filterTripleOnly) {
      const tripleSet = new Set(tripleAnalysis.tripleLeaders.map(t => t.cleanSymbol));
      res = res.filter(t => tripleSet.has(t.cleanSymbol));
    }
    return res;
  };

  const filteredMonth = useMemo(() => filterList(tripleAnalysis.listMonth), [tripleAnalysis.listMonth, searchTerm, filterTripleOnly]);
  const filteredWeek  = useMemo(() => filterList(tripleAnalysis.listWeek),  [tripleAnalysis.listWeek, searchTerm, filterTripleOnly]);
  const filteredDay   = useMemo(() => filterList(tripleAnalysis.listDay),   [tripleAnalysis.listDay, searchTerm, filterTripleOnly]);
  const filteredPeakMonth = useMemo(() => filterList(tripleAnalysis.listMaxPointsMonth || []), [tripleAnalysis.listMaxPointsMonth, searchTerm, filterTripleOnly]);

  return (
    <div style={{
      width: '100%',
      maxWidth: '100%',
      margin: '0 auto',
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      color: '#ffffff',
      fontFamily: "'Sora', sans-serif",
      boxSizing: 'border-box'
    }}>
      {/* 🟢 1. BARRE DE CONTRÔLE COMPACTE & STATUT LIVE */}
      <div style={{
        background: '#0a1519',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '10px',
        padding: '8px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        {/* BOUTON ACTUALISER & PROGRESSION DU SCAN */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            onClick={() => loadMarketData(false)}
            disabled={isLoading}
            style={{
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.76rem',
              fontWeight: '900',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.15s ease'
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            <span>{isLoading ? 'SCAN EN COURS...' : '⚡ ACTUALISER LE SCAN'}</span>
          </button>

          {isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.74rem' }}>
              <span style={{ color: '#22d3ee', fontWeight: 'bold' }}>⚡ {progressMsg}</span>
              <span style={{ color: '#10b981', fontWeight: '900' }}>({progressPct}%)</span>
              <div style={{ width: '130px', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: '#10b981', transition: 'width 0.3s ease' }} />
              </div>
            </div>
          ) : (
            <span style={{ color: '#64748b', fontSize: '0.74rem', fontWeight: 'bold' }}>
              ⚡ Scanner Prêt (Top 50 Momentum & Confluence)
            </span>
          )}
        </div>

        {/* 🟢 BADGE 100% LIVE BYBIT */}
        <span style={{
          background: 'rgba(255, 255, 255, 0.03)',
          color: '#10b981',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '5px 12px',
          borderRadius: '6px',
          fontSize: '0.72rem',
          fontWeight: '800',
          display: 'flex',
          alignItems: 'center',
          gap: '7px'
        }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          100% LIVE ({totalSymbolsCount} TOKENS BYBIT) • MAJ: {lastLiveUpdate}
        </span>
      </div>

      {/* 📈 CHARTE DYNAMIQUE DES 3 HORIZONS (50 CHAMPIONS DU MOIS) */}
      <div style={{
        background: '#0a1519',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={17} color="#22d3ee" />
            <h2 style={{ margin: 0, fontSize: '1.02rem', fontWeight: '800', color: '#f8fafc', letterSpacing: '-0.02em' }}>
              {selectedSoloToken ? (
                `🕯️ BOUGIES EN POINTS : #${chartUniverse === 'MONTH_PEAK' ? (selectedSoloToken.rankPeak || selectedSoloToken.rankMonth) : selectedSoloToken.rankMonth} ${selectedSoloToken.cleanSymbol} (${selectedSoloToken.phase4h?.label}) [VUE ${activeChartHorizon === 'month' ? '30D' : activeChartHorizon === 'week' ? '7D' : '24H'}]`
              ) : (
                chartUniverse === 'MONTH_PEAK' ? (
                  activeChartHorizon === 'month' ? `CHARTE DES TOP ${selectedTopCount} PICS DU MOIS (ATH 30D - VUE 30 JOURS)` :
                  activeChartHorizon === 'week'  ? `CHARTE DES TOP ${selectedTopCount} PICS DU MOIS (ATH 30D - VUE 7 JOURS)` :
                  `CHARTE DES TOP ${selectedTopCount} PICS DU MOIS (ATH 30D - VUE 24 HEURES)`
                ) : (
                  activeChartHorizon === 'month' ? `CHARTE DES TOP ${selectedTopCount} CHAMPIONS SCORE MOIS (VUE 30 JOURS - 30D)` :
                  activeChartHorizon === 'week'  ? `CHARTE DES TOP ${selectedTopCount} CHAMPIONS SCORE MOIS (VUE 7 JOURS - 7D)` :
                  `CHARTE DES TOP ${selectedTopCount} CHAMPIONS SCORE MOIS (VUE 24 HEURES - 24H)`
                )
              )}
            </h2>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* 1. SÉLECTEUR D'UNIVERS : TOP SCORE MOIS vs TOP PICS (ATH 30D) */}
            <div style={{ background: '#071013', padding: '3px', borderRadius: '8px', display: 'flex', gap: '3px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => setChartUniverse('MONTH_SCORE')}
                style={{
                  background: chartUniverse === 'MONTH_SCORE' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                  color: chartUniverse === 'MONTH_SCORE' ? '#22d3ee' : '#94a3b8',
                  border: chartUniverse === 'MONTH_SCORE' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  padding: '5px 11px',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                TOP SCORE MOIS
              </button>
              <button
                onClick={() => setChartUniverse('MONTH_PEAK')}
                style={{
                  background: chartUniverse === 'MONTH_PEAK' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                  color: chartUniverse === 'MONTH_PEAK' ? '#22d3ee' : '#94a3b8',
                  border: chartUniverse === 'MONTH_PEAK' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  padding: '5px 11px',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                TOP PICS (ATH 30D)
              </button>
            </div>

            {/* 2. HORIZONS DE CHARTE (MOIS, SEMAINE, JOUR) */}
            <div style={{ background: '#071013', padding: '3px', borderRadius: '8px', display: 'flex', gap: '3px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => setActiveChartHorizon('month')}
                style={{
                  background: activeChartHorizon === 'month' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                  color: activeChartHorizon === 'month' ? '#22d3ee' : '#94a3b8',
                  border: activeChartHorizon === 'month' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                30D MOIS
              </button>
              <button
                onClick={() => setActiveChartHorizon('week')}
                style={{
                  background: activeChartHorizon === 'week' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                  color: activeChartHorizon === 'week' ? '#22d3ee' : '#94a3b8',
                  border: activeChartHorizon === 'week' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                7D SEMAINE
              </button>
              <button
                onClick={() => setActiveChartHorizon('day')}
                style={{
                  background: activeChartHorizon === 'day' ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                  color: activeChartHorizon === 'day' ? '#22d3ee' : '#94a3b8',
                  border: activeChartHorizon === 'day' ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                  padding: '5px 10px',
                  borderRadius: '5px',
                  fontSize: '0.72rem',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                24H JOUR
              </button>
            </div>

            {/* 3. FILTRE RAPIDE : TOP 5 | TOP 10 | TOP 20 | TOP 50 */}
            <div style={{ background: '#071013', padding: '3px', borderRadius: '8px', display: 'flex', gap: '3px', border: '1px solid rgba(255,255,255,0.08)' }}>
              {[5, 10, 20, 50].map(cnt => (
                <button
                  key={cnt}
                  onClick={() => setSelectedTopCount(cnt)}
                  style={{
                    background: selectedTopCount === cnt ? 'rgba(6, 182, 212, 0.18)' : 'transparent',
                    color: selectedTopCount === cnt ? '#22d3ee' : '#94a3b8',
                    border: selectedTopCount === cnt ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                    padding: '5px 9px',
                    borderRadius: '5px',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  TOP {cnt}
                </button>
              ))}
            </div>

            {/* BOUTON AFFICHER / MASQUER CHARTE PRINCIPALE BENCHMARK */}
            <button
              onClick={() => setShowMainChart(!showMainChart)}
              style={{
                background: showMainChart ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: showMainChart ? '#22d3ee' : '#64748b',
                border: showMainChart ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <TrendingUp size={13} />
              {showMainChart ? 'BENCHMARK (ON)' : 'BENCHMARK (OFF)'}
            </button>

            {/* BOUTON CORRIDOR SNIPER */}
            <button
              onClick={() => setShowCorridorSniperChart(!showCorridorSniperChart)}
              style={{
                background: showCorridorSniperChart ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: showCorridorSniperChart ? '#34d399' : '#64748b',
                border: showCorridorSniperChart ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <Rocket size={13} />
              {showCorridorSniperChart ? 'CORRIDOR SNIPER (ON)' : 'CORRIDOR SNIPER (OFF)'}
            </button>

            {/* BOUTON RADAR HIGHER HIGH 30D */}
            <button
              onClick={() => setShowHhRadarChart(!showHhRadarChart)}
              style={{
                background: showHhRadarChart ? 'rgba(250, 204, 21, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: showHhRadarChart ? '#facc15' : '#64748b',
                border: showHhRadarChart ? '1px solid rgba(250, 204, 21, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <Crown size={13} style={{ color: showHhRadarChart ? '#facc15' : '#64748b' }} />
              {showHhRadarChart ? 'RADAR HH 30D (ON)' : 'RADAR HH 30D (OFF)'}
            </button>

            {/* BOUTON TOP 5 DU MOIS (24H vs 30D) */}
            <button
              onClick={() => setShowTop5DualChart(!showTop5DualChart)}
              style={{
                background: showTop5DualChart ? 'rgba(168, 85, 247, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                color: showTop5DualChart ? '#c084fc' : '#64748b',
                border: showTop5DualChart ? '1px solid rgba(168, 85, 247, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <Crown size={13} style={{ color: showTop5DualChart ? '#c084fc' : '#64748b' }} />
              {showTop5DualChart ? '👑 TOP 5 24H/30D (ON)' : '👑 TOP 5 24H/30D (OFF)'}
            </button>

            {/* BOUTON DIAGNOSTIC BREAKOUT */}
            <button
              onClick={() => setShowBreakoutDiagnostics(!showBreakoutDiagnostics)}
              style={{
                background: showBreakoutDiagnostics ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                color: showBreakoutDiagnostics ? '#22d3ee' : '#64748b',
                border: showBreakoutDiagnostics ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease'
              }}
            >
              <Activity size={13} />
              {showBreakoutDiagnostics ? 'DIAGNOSTIC BREAKOUT (ON)' : 'DIAGNOSTIC BREAKOUT (OFF)'}
            </button>
          </div>
        </div>

        {/* 🧭 HUD MARCHÉ SENTIMENT (TOP 50 DOMINANCE) & SIGNAL BTC INDÉPENDANT */}
        <MarketSentimentBar marketSentiment={marketSentiment} btcMarketData={btcMarketData} />

        {/* 📈 VUE 50 COURBES BENCHMARK */}
        <div style={{ display: showMainChart ? 'block' : 'none' }}>

          {/* 1. CANVAS DU GRAPHIQUE UNIQUE CLASSIQUE (MASQUÉ QUAND LE DÉCOUPAGE 4-CHARTS EST ACTIF) */}
          <div style={{ display: is4ChartsSplitView ? 'none' : 'block' }}>
            <div style={{ position: 'relative', width: '100%', height: `${chartHeight}px`, borderRadius: '8px', overflow: 'hidden' }}>
              <div id="benchmark-chart-container" ref={chartContainerRef} style={{ width: '100%', height: '100%', borderRadius: '8px', overflow: 'hidden' }} />


            </div>
          </div>

          {/* ↕️ BARRE DE REDIMENSIONNEMENT VERTICAL À LA SOURIS */}
          <div
            onMouseDown={handleMouseDownHeight}
            style={{
              width: '100%',
              height: '24px',
              background: isDraggingHeight ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.04)',
              borderTop: isDraggingHeight ? '2px solid #22d3ee' : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '0 0 8px 8px',
              cursor: 'row-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              userSelect: 'none',
              transition: 'background 0.2s ease',
              boxShadow: 'none'
            }}
            title="Cliquez et glissez vers le bas ou le haut avec la souris pour agrandir ou réduire la hauteur du graphique !"
          >
            <div style={{ width: '40px', height: '4px', background: isDraggingHeight ? '#22d3ee' : '#64748b', borderRadius: '2px' }} />
            <span style={{ color: isDraggingHeight ? '#22d3ee' : '#94a3b8', fontSize: '0.72rem', fontWeight: '800', letterSpacing: '0.5px' }}>
              ↕️ GLISSER À LA SOURIS POUR REDIMENSIONNER LA HAUTEUR ({chartHeight}px)
            </span>
            <div style={{ width: '40px', height: '4px', background: isDraggingHeight ? '#22d3ee' : '#64748b', borderRadius: '2px' }} />
          </div>
        </div>

        {/* 🎯 1.5 CHARTE DÉDIÉE : CORRIDOR SNIPER ACTIF [LIGNE D'ENTRÉE ➔ RÉSISTANCE MACRO] */}
        {showCorridorSniperChart && (
          <CorridorSniperZoneChart
            tokensData={tokensData}
            tripleAnalysis={tripleAnalysis}
            chartProcessedData={chartProcessedData}
            activeChartHorizon={activeChartHorizon}
            chartUniverse={chartUniverse}
            selectedSoloToken={selectedSoloToken}
            setSelectedSoloToken={setSelectedSoloToken}
            mainChartRef={chartRef}
            onClose={() => setShowCorridorSniperChart(false)}
            marketSentiment={marketSentiment}
            btcMarketData={btcMarketData}
            dailyCgData={dailyCgData}
            dailyMarketCaps={dailyMarketCaps}
            livePricesRef={livePricesRef}
          />
        )}

        {/* 👑 1.55 CHARTE DÉDIÉE : RADAR HIGHER HIGH 30D (TOKENS TESTANT OU CASSANT LE SOMMET MENSUEL) */}
        {showHhRadarChart && (
          <MonthlyHigherHighRadarChart
            tokensData={tokensData}
            tripleAnalysis={tripleAnalysis}
            chartProcessedData={chartProcessedData}
            activeChartHorizon={activeChartHorizon}
            chartUniverse={chartUniverse}
            selectedSoloToken={selectedSoloToken}
            setSelectedSoloToken={setSelectedSoloToken}
            onClose={() => setShowHhRadarChart(false)}
            dailyCgData={dailyCgData}
            dailyMarketCaps={dailyMarketCaps}
            livePricesRef={livePricesRef}
          />
        )}

        {/* 👑 1.58 CHARTE DÉDIÉE : TOP 5 DU MOIS EN DOUBLE VUE SYNCHRONISÉE (24H & 30D CÔTE À CÔTE) */}
        {showTop5DualChart && (
          <MonthlyTop5DualChart
            tokensData={tokensData}
            tripleAnalysis={tripleAnalysis}
            chartProcessedData={chartProcessedData}
            chartUniverse={chartUniverse}
            selectedSoloToken={selectedSoloToken}
            setSelectedSoloToken={setSelectedSoloToken}
            onClose={() => setShowTop5DualChart(false)}
            livePricesRef={livePricesRef}
          />
        )}

        {/* 🔬 1.6 PANNEAU AUTONOME (STANDALONE) : RADAR DIAGNOSTIC BREAKOUT & SUPPLY */}
        {showBreakoutDiagnostics && (
          <CorridorSupplyDiagnosticPanel
            tokensData={tokensData}
            tripleAnalysis={tripleAnalysis}
            chartProcessedData={chartProcessedData}
            activeChartHorizon={activeChartHorizon}
            chartUniverse={chartUniverse}
            selectedSoloToken={selectedSoloToken}
            setSelectedSoloToken={setSelectedSoloToken}
            onClose={() => setShowBreakoutDiagnostics(false)}
          />
        )}
        </div>



      {/* 👑 3. BANNIÈRE DES MONARQUES TRIPLE ALIGNÉS */}

            

      {/* 📊 5. BOUTON AFFICHER / MASQUER LES 3 TABLEAUX DÉTAILLÉS (Performance Booster) */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
        <button
          onClick={() => setShowTables(!showTables)}
          style={{
            background: showTables ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.04)',
            color: showTables ? '#f87171' : '#94a3b8',
            border: showTables ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.12)',
            padding: '10px 24px',
            borderRadius: '8px',
            fontSize: '0.80rem',
            fontWeight: '800',
            cursor: 'pointer',
            boxShadow: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'all 0.15s ease'
          }}
        >
          {showTables ? '🙈 MASQUER LES 3 TABLEAUX DÉTAILLÉS' : '👁️ AFFICHER LES 3 TABLEAUX DÉTAILLÉS DU TOP 50 (MOIS, SEMAINE, JOUR)'}
        </button>
      </div>

      {/* 📊 6. LES 3 TABLEAUX CÔTE À CÔTE (RENDU CONDITIONNEL) */}
      {showTables && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: '20px' }}>
        
        {/* 📅 1. TABLEAU TOP 50 DU MOIS (30D) */}
        <div style={{
          background: '#0a1519',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'none'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: 'rgba(6, 182, 212, 0.12)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.3)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.70rem', fontWeight: '900' }}>
                1M (30D)
              </span>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: '900', color: '#f8fafc' }}>
                TOP 50 DU MOIS (SCORE 30D)
              </h2>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>1M: 30% | 1W: 20% | 1D: 20%</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '720px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', textAlign: 'left', fontFamily: "'Geist Mono', monospace" }}>
              <thead style={{ position: 'sticky', top: 0, background: '#071013', zIndex: 10 }}>
                <tr style={{ color: '#888', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '8px' }}>RANG</th>
                  <th style={{ padding: '8px' }}>TOKEN</th>
                  <th style={{ padding: '8px' }}>SCORE MOIS</th>
                  <th style={{ padding: '8px' }}>VOL 24H</th>
                  <th style={{ padding: '8px' }}>CONFLUENCE</th>
                  <th style={{ padding: '8px' }}>GAIN 30D</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>24H</th>
                </tr>
              </thead>
              <tbody>
                {filteredMonth.length === 0 ? (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: '#888' }}>{isLoading ? 'Calcul des scores du mois...' : 'Aucun token.'}</td></tr>
                ) : (
                  filteredMonth.map((item) => (
                    <tr
                      key={item.symbol}
                      onClick={() => setSelectedTokenModal(item)}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: item.rankMonth <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = item.rankMonth <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'}
                    >
                      <td style={{ padding: '8px', fontWeight: '900', color: item.rankMonth <= 3 ? '#22d3ee' : '#888' }}>
                        #{item.rankMonth}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <strong style={{ color: '#fff', fontSize: '0.85rem' }}>{item.cleanSymbol}</strong>
                      </td>
                      <td style={{ padding: '8px', color: '#22d3ee', fontWeight: '900' }}>
                        +{item.scoreMonth} pts
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '0.70rem', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                          {formatVolumeUSDT(item.turnover24h)}
                        </span>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ background: item.confMonth >= 10 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)', color: item.confMonth >= 10 ? '#34d399' : '#cbd5e1', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.65rem' }}>
                          {item.confMonth}/12
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: '#34d399', fontWeight: 'bold' }}>
                        +{item.p30d}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: item.p1d >= 0 ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>
                        {item.p1d >= 0 ? '+' : ''}{item.p1d}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 📊 2. TABLEAU TOP 50 DE LA SEMAINE (7D) */}
        <div style={{
          background: '#0a1519',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'none'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: 'rgba(6, 182, 212, 0.12)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.3)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.70rem', fontWeight: '900' }}>
                1W (7D)
              </span>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: '900', color: '#f8fafc' }}>
                TOP 50 SEMAINE (SCORE 7D)
              </h2>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>1W: 35% | 1D: 25% | 4H: 20%</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '720px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', textAlign: 'left', fontFamily: "'Geist Mono', monospace" }}>
              <thead style={{ position: 'sticky', top: 0, background: '#071013', zIndex: 10 }}>
                <tr style={{ color: '#888', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '8px' }}>RANG</th>
                  <th style={{ padding: '8px' }}>TOKEN</th>
                  <th style={{ padding: '8px' }}>SCORE SEMAINE</th>
                  <th style={{ padding: '8px' }}>VOL 24H</th>
                  <th style={{ padding: '8px' }}>CONFLUENCE</th>
                  <th style={{ padding: '8px' }}>GAIN 7D</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>24H</th>
                </tr>
              </thead>
              <tbody>
                {filteredWeek.length === 0 ? (
                  <tr><td colSpan="7" style={{ textAlign: 'center', padding: '30px', color: '#888' }}>{isLoading ? 'Calcul des scores de la semaine...' : 'Aucun token.'}</td></tr>
                ) : (
                  filteredWeek.map((item) => (
                    <tr
                      key={item.symbol}
                      onClick={() => setSelectedTokenModal(item)}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: item.rankWeek <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = item.rankWeek <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'}
                    >
                      <td style={{ padding: '8px', fontWeight: '900', color: item.rankWeek <= 3 ? '#22d3ee' : '#888' }}>
                        #{item.rankWeek}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <strong style={{ color: '#fff', fontSize: '0.85rem' }}>{item.cleanSymbol}</strong>
                      </td>
                      <td style={{ padding: '8px', color: '#22d3ee', fontWeight: '900' }}>
                        +{item.scoreWeek} pts
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '0.70rem', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                          {formatVolumeUSDT(item.turnover24h)}
                        </span>
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ background: item.confWeek >= 8 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)', color: item.confWeek >= 8 ? '#34d399' : '#cbd5e1', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.65rem' }}>
                          {item.confWeek}/10
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: '#34d399', fontWeight: 'bold' }}>
                        +{item.p1w}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: item.p1d >= 0 ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>
                        {item.p1d >= 0 ? '+' : ''}{item.p1d}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ☀️ 3. TABLEAU TOP 50 DU JOUR (24H) */}
        <div style={{
          background: '#0a1519',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '10px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'none'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '3px 8px', borderRadius: '5px', fontSize: '0.70rem', fontWeight: '900' }}>
                24H (1D)
              </span>
              <h2 style={{ margin: 0, fontSize: '0.98rem', fontWeight: '900', color: '#f8fafc' }}>
                TOP 50 DU JOUR (SCORE 24H)
              </h2>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>1D: 40% | 4H: 25% | 1H: 20%</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '720px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem', textAlign: 'left', fontFamily: "'Geist Mono', monospace" }}>
              <thead style={{ position: 'sticky', top: 0, background: '#071013', zIndex: 10 }}>
                <tr style={{ color: '#888', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: '8px' }}>RANG</th>
                  <th style={{ padding: '8px' }}>TOKEN</th>
                  <th style={{ padding: '8px' }}>SCORE JOUR</th>
                  <th style={{ padding: '8px' }}>VOL 24H</th>
                  <th style={{ padding: '8px', color: '#38bdf8', fontWeight: '800' }}>VOL / MC</th>
                  <th style={{ padding: '8px' }}>CONFLUENCE</th>
                  <th style={{ padding: '8px' }}>GAIN 24H</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>15M</th>
                </tr>
              </thead>
              <tbody>
                {filteredDay.length === 0 ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '30px', color: '#888' }}>{isLoading ? 'Calcul des scores du jour...' : 'Aucun token.'}</td></tr>
                ) : (
                  filteredDay.map((item) => (
                    <tr
                      key={item.symbol}
                      onClick={() => setSelectedTokenModal(item)}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: item.rankDay <= 3 ? 'rgba(16, 185, 129, 0.06)' : 'transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = item.rankDay <= 3 ? 'rgba(16, 185, 129, 0.06)' : 'transparent'}
                    >
                      <td style={{ padding: '8px', fontWeight: '900', color: item.rankDay <= 3 ? '#10b981' : '#888' }}>
                        #{item.rankDay}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <strong style={{ color: '#fff', fontSize: '0.85rem' }}>{item.cleanSymbol}</strong>
                      </td>
                      <td style={{ padding: '8px', color: '#10b981', fontWeight: '900' }}>
                        +{item.scoreDay} pts
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap' }}>
                          <span 
                            style={{ color: '#94a3b8', fontWeight: '800', fontSize: '0.70rem', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap' }}
                            title={`Volume Bybit: ${formatVolumeUSDT(item.turnover24h)}${item.cgVolume ? ` | Volume Global CG: ${formatCompactUSD(item.cgVolume)}` : ''}`}
                          >
                            {formatVolumeUSDT(item.cgVolume || item.turnover24h)}
                            {item.cgVolume && <span style={{ fontSize: '0.60rem', color: '#38bdf8', marginLeft: '3px' }}>CG</span>}
                          </span>
                          {typeof item.buyPct === 'number' && (
                            <span 
                              title={`Flux 15m (24h) : ${item.buyPct}% Achat | ${item.sellPct}% Vente | Net Delta: ${item.netDelta24h >= 0 ? '+' : ''}${formatCompactUSD(item.netDelta24h)}`}
                              style={{
                                background: item.buyPct >= 50 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: item.buyPct >= 50 ? '#10b981' : '#f87171',
                                border: `1px solid ${item.buyPct >= 50 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                padding: '1px 5px',
                                borderRadius: '3px',
                                fontSize: '0.62rem',
                                fontWeight: '900',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {item.buyPct >= 50 ? `🟢 ${item.buyPct.toFixed(0)}% B` : `🔴 ${item.sellPct.toFixed(0)}% S`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {item.volMcapRatio > 0 ? (
                          <span 
                            title={`Volume: ${formatCompactUSD(item.cgVolume || item.turnover24h)} | Market Cap: ${formatCompactUSD(item.marketCap)} | Source: ${item.volMcapSource || 'CoinGecko'}`}
                            style={{
                              background: item.volMcapRatio >= 50 
                                ? 'rgba(6, 182, 212, 0.22)' 
                                : item.volMcapRatio >= 25 
                                ? 'rgba(6, 182, 212, 0.15)' 
                                : item.volMcapRatio >= 10 
                                ? 'rgba(16, 185, 129, 0.15)' 
                                : 'rgba(255, 255, 255, 0.05)',
                              color: item.volMcapRatio >= 25 
                                ? '#22d3ee' 
                                : item.volMcapRatio >= 10 
                                ? '#10b981' 
                                : '#94a3b8',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              fontWeight: '800',
                              fontSize: '0.70rem',
                              border: item.volMcapRatio >= 50 ? '1px solid rgba(6, 182, 212, 0.4)' : 'none'
                            }}>
                            {item.volMcapRatio.toFixed(1)}%
                          </span>
                        ) : (
                          <span style={{ color: '#64748b', fontSize: '0.65rem' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <span style={{ background: item.confDay >= 6 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255,255,255,0.05)', color: item.confDay >= 6 ? '#34d399' : '#cbd5e1', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.65rem' }}>
                          {item.confDay}/8
                        </span>
                      </td>
                      <td style={{ padding: '8px', color: '#10b981', fontWeight: 'bold' }}>
                        +{item.p1d}%
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: item.p15m >= 0 ? '#22d3ee' : '#ef4444', fontWeight: 'bold' }}>
                        {item.p15m >= 0 ? '+' : ''}{item.p15m}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 🔥 4. TABLEAU : TOP PUMPS & RECORDS DU MOIS */}
        <div style={{
          gridColumn: '1 / -1',
          background: '#0a1519',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'none',
          marginTop: '10px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ background: 'rgba(6, 182, 212, 0.12)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.3)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: '900', boxShadow: 'none' }}>
                👑 ATH 30D
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '900', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  CLASSEMENT DES PICS & RECORDS DU MOIS (VALEURS MAXIMALES)
                </h2>
                <span style={{ fontSize: '0.70rem', color: '#64748b' }}>
                  Classement basé sur le plus haut sommet de points atteint par chaque token au cours des 30 derniers jours
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  setChartUniverse('MONTH_PEAK');
                  setSelectedTopCount(selectedPeakTopCount);
                  const el = document.getElementById('benchmark-chart-container');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                  else window.scrollTo({ top: 400, behavior: 'smooth' });
                }}
                style={{
                  background: 'rgba(6, 182, 212, 0.12)',
                  color: '#22d3ee',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '0.74rem',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: 'none'
                }}
              >
                📈 AFFICHER CE TOP DANS LE GRAPHIQUE ↗
              </button>

              {/* Sélecteur TOP 5, TOP 10, TOP 20, TOP 50 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(0,0,0,0.5)', padding: '3px', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                {[5, 10, 20, 50].map((cnt) => (
                  <button
                    key={cnt}
                    onClick={() => {
                      setSelectedPeakTopCount(cnt);
                      setSelectedTopCount(cnt);
                    }}
                    style={{
                      background: selectedPeakTopCount === cnt ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                      color: selectedPeakTopCount === cnt ? '#22d3ee' : '#64748b',
                      border: selectedPeakTopCount === cnt ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      fontSize: '0.74rem',
                      fontWeight: '800',
                      cursor: 'pointer',
                      boxShadow: 'none',
                      transition: 'all 0.15s'
                    }}
                  >
                    TOP {cnt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', textAlign: 'left', fontFamily: "'Geist Mono', monospace" }}>
              <thead style={{ position: 'sticky', top: 0, background: '#071013', zIndex: 10 }}>
                <tr style={{ color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <th style={{ padding: '10px 8px' }}>RANG ATH</th>
                  <th style={{ padding: '10px 8px' }}>TOKEN</th>
                  <th style={{ padding: '10px 8px' }}>VOL 24H</th>
                  <th style={{ padding: '10px 8px' }}>PIC MAX (30D)</th>
                  <th style={{ padding: '10px 8px' }}>SCORE ACTUEL</th>
                  <th style={{ padding: '10px 8px' }}>GAIN ACTUEL 30D</th>
                  <th style={{ padding: '10px 8px' }}>RETRACEMENT</th>
                  <th style={{ padding: '10px 8px' }}>PHASE 4H</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>24H</th>
                </tr>
              </thead>
              <tbody>
                {filteredPeakMonth.slice(0, selectedPeakTopCount).length === 0 ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '30px', color: '#888' }}>
                      {isLoading ? 'Calcul des records et pics du mois...' : 'Aucun token.'}
                    </td>
                  </tr>
                ) : (
                  filteredPeakMonth.slice(0, selectedPeakTopCount).map((item) => (
                    <tr
                      key={item.symbol}
                      onClick={() => setSelectedTokenModal(item)}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        background: item.rankPeak <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = item.rankPeak <= 3 ? 'rgba(6, 182, 212, 0.06)' : 'transparent'}
                    >
                      <td style={{ padding: '10px 8px', fontWeight: '900', color: item.rankPeak <= 3 ? '#22d3ee' : '#94a3b8' }}>
                        #{item.rankPeak}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ color: '#fff', fontSize: '0.88rem' }}>{item.cleanSymbol}</strong>
                          <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>${item.price}</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{ color: '#94a3b8', fontWeight: '800', fontSize: '0.72rem', background: 'rgba(255, 255, 255, 0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                          {formatVolumeUSDT(item.turnover24h)}
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        <span style={{
                          background: 'rgba(6, 182, 212, 0.12)',
                          color: '#22d3ee',
                          border: '1px solid rgba(6, 182, 212, 0.3)',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontWeight: '900',
                          fontSize: '0.80rem',
                          boxShadow: 'none'
                        }}>
                          +{item.maxPointsMonth || item.p30d || 0} pts
                        </span>
                      </td>
                      <td style={{ padding: '10px 8px', color: '#22d3ee', fontWeight: 'bold' }}>
                        +{item.scoreMonth} pts
                      </td>
                      <td style={{ padding: '10px 8px', color: item.p30d >= 0 ? '#34d399' : '#ef4444', fontWeight: 'bold' }}>
                        {item.p30d >= 0 ? '+' : ''}{item.p30d}%
                      </td>
                      <td style={{ padding: '10px 8px', color: (item.pullbackFromPeak || 0) <= -20 ? '#ef4444' : '#fb923c', fontWeight: 'bold' }}>
                        {item.pullbackFromPeak !== undefined ? `${item.pullbackFromPeak}%` : '0%'}
                      </td>
                      <td style={{ padding: '10px 8px' }}>
                        {item.phase4h && (
                          <span style={{
                            background: item.phase4h.badgeBg,
                            color: item.phase4h.color,
                            border: `1px solid ${item.phase4h.border}`,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            fontSize: '0.68rem'
                          }}>
                            {item.phase4h.shortLabel || item.phase4h.label}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 8px', textAlign: 'right', color: item.p1d >= 0 ? '#38bdf8' : '#ef4444', fontWeight: 'bold' }}>
                        {item.p1d >= 0 ? '+' : ''}{item.p1d}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
      )}

      {/* 🔍 7. MODAL D'INSPECTION DÉTAILLÉE */}
      {selectedTokenModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#0a1519',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '700px',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            boxShadow: 'none'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.4rem', fontWeight: '900', color: '#fff' }}>{selectedTokenModal.cleanSymbol}</span>
                <span style={{ background: 'rgba(6, 182, 212, 0.12)', color: '#22d3ee', border: '1px solid rgba(6, 182, 212, 0.3)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '900' }}>
                  ${selectedTokenModal.price}
                </span>
                <span style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8', border: '1px solid rgba(255, 255, 255, 0.08)', padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '900' }}>
                  Vol 24H: {formatVolumeUSDT(selectedTokenModal.turnover24h)}
                </span>
              </div>
              <button
                onClick={() => setSelectedTokenModal(null)}
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', fontWeight: '900' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              <div style={{ background: 'rgba(250, 204, 21, 0.1)', border: '1px solid rgba(250, 204, 21, 0.3)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>SCORE 30D</div>
                <div style={{ fontSize: '1.15rem', fontWeight: '900', color: '#facc15' }}>+{selectedTokenModal.scoreMonth} pts</div>
                <div style={{ fontSize: '0.68rem', color: '#00ff88' }}>+{selectedTokenModal.p30d}% 30D</div>
              </div>
              <div style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>SCORE 7D</div>
                <div style={{ fontSize: '1.15rem', fontWeight: '900', color: '#38bdf8' }}>+{selectedTokenModal.scoreWeek} pts</div>
                <div style={{ fontSize: '0.68rem', color: '#00ff88' }}>+{selectedTokenModal.p1w}% 7D</div>
              </div>
              <div style={{ background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.3)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>SCORE 24H</div>
                <div style={{ fontSize: '1.15rem', fontWeight: '900', color: '#00ff88' }}>+{selectedTokenModal.scoreDay} pts</div>
                <div style={{ fontSize: '0.68rem', color: '#00ff88' }}>+{selectedTokenModal.p1d}% 24H</div>
              </div>
              <div style={{ background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>VOLUME 24H</div>
                <div style={{ fontSize: '1.15rem', fontWeight: '900', color: '#c084fc' }}>{formatVolumeUSDT(selectedTokenModal.turnover24h)}</div>
                <div style={{ fontSize: '0.68rem', color: '#cbd5e1' }}>Liquidité USDT</div>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: '900', color: '#fff' }}>📊 DÉCOMPOSITION SUR LES 6 HORIZONS :</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '0.72rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>1M (30D) :</span> <strong style={{ color: '#00ff88' }}>+{selectedTokenModal.p30d}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>1W (7D) :</span> <strong style={{ color: selectedTokenModal.p1w >= 0 ? '#00ff88' : '#ef4444' }}>{selectedTokenModal.p1w}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>1D (24H) :</span> <strong style={{ color: selectedTokenModal.p1d >= 0 ? '#00ff88' : '#ef4444' }}>{selectedTokenModal.p1d}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>4H :</span> <strong style={{ color: selectedTokenModal.p4h >= 0 ? '#00ff88' : '#ef4444' }}>{selectedTokenModal.p4h}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>1H :</span> <strong style={{ color: selectedTokenModal.p1h >= 0 ? '#00ff88' : '#ef4444' }}>{selectedTokenModal.p1h}%</strong>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '6px', borderRadius: '6px' }}>
                  <span style={{ color: '#888' }}>15m :</span> <strong style={{ color: selectedTokenModal.p15m >= 0 ? '#00ff88' : '#ef4444' }}>{selectedTokenModal.p15m}%</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <a
                href={`https://www.bybit.com/trade/spot/${selectedTokenModal.cleanSymbol}/USDT`}
                target="_blank"
                rel="noreferrer"
                style={{
                  background: 'rgba(250, 204, 21, 0.15)',
                  color: '#facc15',
                  border: '1px solid rgba(250, 204, 21, 0.4)',
                  padding: '7px 14px',
                  borderRadius: '6px',
                  fontSize: '0.78rem',
                  fontWeight: '800',
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: 'none'
                }}
              >
                TRADING BYBIT <ArrowUpRight size={14} />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 🚀 TOAST NOTIFICATION FLOTTANT EN TEMPS RÉEL (NOUVEAU SIGNAL LAUNCHPAD) */}
      {activeAlertToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 999999,
          background: '#0a1519',
          border: '1px solid rgba(16, 185, 129, 0.4)',
          boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
          borderRadius: '10px',
          padding: '14px 18px',
          color: '#ffffff',
          minWidth: '320px',
          maxWidth: '420px',
          backdropFilter: 'blur(16px)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: '900', fontSize: '0.85rem' }}>
              <Rocket size={18} />
              <span>⚡ SIGNAL LAUNCHPAD DÉTECTÉ !</span>
            </div>
            <button 
              onClick={() => setActiveAlertToast(null)}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '2px' }}
            >
              <X size={16} />
            </button>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              color: '#10b981',
              fontWeight: '900',
              fontSize: '1.15rem',
              padding: '6px 14px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>#{activeAlertToast.rank}</span>
              <span>{activeAlertToast.symbol}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: '1.4' }}>
              <div>Franchissement : <strong style={{ color: '#38bdf8' }}>+{activeAlertToast.triggerScore} pts</strong></div>
              <div>Objectif Target : <strong style={{ color: '#10b981' }}>+{activeAlertToast.tpLvl} pts</strong></div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={() => {
                setSelectedSoloToken({ cleanSymbol: activeAlertToast.symbol, symbol: `${activeAlertToast.symbol}USDT` });
                setActiveAlertToast(null);
                const el = document.getElementById('benchmark-chart-container');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
              style={{
                flex: 1,
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                fontWeight: '800',
                fontSize: '0.75rem',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                boxShadow: 'none'
              }}
            >
              <ExternalLink size={13} />
              Inspecter sur le Chart
            </button>
            <button
              onClick={() => {
                setShowSignalsModal(true);
                setActiveAlertToast(null);
              }}
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                color: '#cbd5e1',
                fontWeight: '700',
                fontSize: '0.75rem',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                cursor: 'pointer'
              }}
            >
              Voir Journal ({signalsHistory.length})
            </button>
          </div>
        </div>
      )}

      {/* 🚀 MODAL DU JOURNAL PERSISTANT DES SIGNAUX LAUNCHPAD */}
      {showSignalsModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(5, 7, 15, 0.85)',
          backdropFilter: 'blur(10px)',
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
          boxSizing: 'border-box'
        }}>
          <div style={{
            background: '#0a1519',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '1050px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: '7px',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'none'
                }}>
                  <Rocket size={18} color="#10b981" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '900', color: '#ffffff', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    JOURNAL PERSISTANT DES SIGNAUX LAUNCHPAD
                    <span style={{ fontSize: '0.70rem', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '2px 8px', borderRadius: '10px' }}>
                      💾 Sauvegarde locale continue
                    </span>
                  </h3>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                    Historique complet de tous les départs enregistrés en temps réel (conservé même après fermeture du site)
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={handleToggleSound}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: soundEnabled ? '#10b981' : '#64748b',
                    border: soundEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Activer ou désactiver le bip sonore lors d'un nouveau signal"
                >
                  {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{soundEnabled ? 'Son ON' : 'Son OFF'}</span>
                </button>

                <button
                  onClick={handleExportSignalsCsv}
                  disabled={signalsHistory.length === 0}
                  style={{
                    background: 'rgba(56, 189, 248, 0.1)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: '700',
                    cursor: signalsHistory.length > 0 ? 'pointer' : 'not-allowed',
                    opacity: signalsHistory.length > 0 ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Exporter tous les signaux en fichier CSV"
                >
                  <Download size={13} />
                  <span>Exporter CSV</span>
                </button>

                <button
                  onClick={handleResetToZero}
                  style={{
                    background: 'rgba(245, 158, 11, 0.12)',
                    color: '#fbbf24',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: '800',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Efface tout et réinitialise la baseline pour ne capter que les nouveaux départs en direct à partir de maintenant"
                >
                  <RotateCcw size={13} />
                  <span>Démarrer à Zéro</span>
                </button>

                <button
                  onClick={handleClearSignalsHistory}
                  disabled={signalsHistory.length === 0}
                  style={{
                    background: 'rgba(244, 63, 94, 0.12)',
                    color: '#f43f5e',
                    border: '1px solid rgba(244, 63, 94, 0.3)',
                    padding: '7px 12px',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    fontWeight: '700',
                    cursor: signalsHistory.length > 0 ? 'pointer' : 'not-allowed',
                    opacity: signalsHistory.length > 0 ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  title="Effacer définitivement l'historique"
                >
                  <Trash2 size={14} />
                  <span>Vider</span>
                </button>

                <button
                  onClick={() => setShowSignalsModal(false)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    width: '32px',
                    height: '32px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: '900'
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* KPI Summary Cards */}
            <div style={{
              padding: '16px 24px',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '12px',
              background: 'rgba(0,0,0,0.2)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: '800' }}>TOTAL SIGNAUX</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#38bdf8', marginTop: '2px' }}>{signalsHistory.length}</div>
              </div>
              <div style={{ background: 'rgba(0, 229, 255, 0.06)', border: '1px solid rgba(0, 229, 255, 0.25)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#38bdf8', fontWeight: '800' }}>🚀 EN COURS</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#00e5ff', marginTop: '2px' }}>
                  {signalsHistory.filter(s => s.status === 'ACTIVE').length}
                </div>
              </div>
              <div style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#34d399', fontWeight: '800' }}>✅ CIBLES ATTEINTES (TP)</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#10b981', marginTop: '2px' }}>
                  {signalsHistory.filter(s => s.status === 'WIN').length}
                </div>
              </div>
              <div style={{ background: 'rgba(244, 63, 94, 0.06)', border: '1px solid rgba(244, 63, 94, 0.25)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#f87171', fontWeight: '800' }}>🛑 STOP LOSS TOUCHÉS</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#f43f5e', marginTop: '2px' }}>
                  {signalsHistory.filter(s => s.status === 'STOPPED').length}
                </div>
              </div>
              <div style={{ background: 'rgba(250, 204, 21, 0.06)', border: '1px solid rgba(250, 204, 21, 0.25)', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: '#facc15', fontWeight: '800' }}>🏆 WIN RATE</div>
                <div style={{ fontSize: '1.3rem', fontWeight: '900', color: '#facc15', marginTop: '2px' }}>
                  {(() => {
                    const wins = signalsHistory.filter(s => s.status === 'WIN').length;
                    const stops = signalsHistory.filter(s => s.status === 'STOPPED').length;
                    const closed = wins + stops;
                    return closed > 0 ? `${((wins / closed) * 100).toFixed(1)}%` : '---';
                  })()}
                </div>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div style={{
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              background: 'rgba(255,255,255,0.01)'
            }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {[
                  { key: 'ALL', label: `Tous (${signalsHistory.length})` },
                  { key: 'ACTIVE', label: `🚀 En Cours (${signalsHistory.filter(s => s.status === 'ACTIVE').length})` },
                  { key: 'WIN', label: `✅ Cible TP (${signalsHistory.filter(s => s.status === 'WIN').length})` },
                  { key: 'STOPPED', label: `🛑 Stop Loss (${signalsHistory.filter(s => s.status === 'STOPPED').length})` }
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFilterSignalStatus(tab.key)}
                    style={{
                      background: filterSignalStatus === tab.key ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      color: filterSignalStatus === tab.key ? '#00ff88' : '#94a3b8',
                      border: filterSignalStatus === tab.key ? '1px solid #00ff88' : '1px solid rgba(255, 255, 255, 0.1)',
                      padding: '5px 12px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: '800',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div style={{ position: 'relative', width: '220px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  placeholder="Rechercher token..."
                  value={searchSignalTerm}
                  onChange={(e) => setSearchSignalTerm(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#ffffff',
                    padding: '6px 10px 6px 30px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            {/* Signals Table */}
            <div style={{ flex: 1, overflowY: 'auto', maxHeight: '500px' }}>
              {(() => {
                let list = signalsHistory;
                if (filterSignalStatus !== 'ALL') {
                  list = list.filter(s => s.status === filterSignalStatus);
                }
                if (searchSignalTerm) {
                  list = list.filter(s => s.symbol.toLowerCase().includes(searchSignalTerm.toLowerCase()));
                }

                if (list.length === 0) {
                  return (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                      <Rocket size={32} style={{ opacity: 0.3, marginBottom: '10px' }} />
                      <div>Aucun signal Launchpad trouvé pour ce filtre.</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>Les prochains tokens franchissant la ligne Launchpad apparaîtront automatiquement ici !</div>
                    </div>
                  );
                }

                return (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255, 255, 255, 0.03)', color: '#94a3b8', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                        <th style={{ padding: '10px 16px' }}>DATE / HEURE</th>
                        <th style={{ padding: '10px 16px' }}>TOKEN & RANG</th>
                        <th style={{ padding: '10px 16px' }}>SCORE ENTRÉE</th>
                        <th style={{ padding: '10px 16px' }}>OBJECTIF TARGET</th>
                        <th style={{ padding: '10px 16px' }}>STOP LOSS</th>
                        <th style={{ padding: '10px 16px' }}>SCORE ACTUEL</th>
                        <th style={{ padding: '10px 16px' }}>MAX ATTEINT</th>
                        <th style={{ padding: '10px 16px' }}>PNL / STATUT</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right' }}>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((sig, idx) => {
                        const isWin = sig.status === 'WIN';
                        const isStopped = sig.status === 'STOPPED';
                        const isActive = sig.status === 'ACTIVE';

                        return (
                          <tr
                            key={sig.id || idx}
                            style={{
                              borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                              background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                              transition: 'background 0.15s'
                            }}
                          >
                            <td style={{ padding: '10px 16px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: '700', color: '#e2e8f0' }}>{sig.timeLabel}</div>
                              <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{sig.dateLabel}</div>
                            </td>

                            <td style={{ padding: '10px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{
                                  background: getTokenFixedColor(sig.symbol),
                                  color: '#000000',
                                  fontWeight: '900',
                                  fontSize: '0.68rem',
                                  padding: '2px 6px',
                                  borderRadius: '4px'
                                }}>
                                  #{sig.rank}
                                </span>
                                <strong style={{ color: '#ffffff', fontSize: '0.85rem' }}>{sig.symbol}</strong>
                              </div>
                            </td>

                            <td style={{ padding: '10px 16px', color: '#00e5ff', fontWeight: '800' }}>
                              +{sig.triggerScore} pts
                            </td>

                            <td style={{ padding: '10px 16px', color: '#00ff88', fontWeight: '800' }}>
                              +{sig.tpLvl} pts
                            </td>

                            <td style={{ padding: '10px 16px', color: '#ff3366', fontWeight: '800' }}>
                              +{sig.slLvl} pts
                            </td>

                            <td style={{ padding: '10px 16px', fontWeight: '800', color: sig.currentScore >= sig.triggerScore ? '#00ff88' : '#ef4444' }}>
                              {sig.currentScore >= 0 ? `+${sig.currentScore}` : sig.currentScore} pts
                            </td>

                            <td style={{ padding: '10px 16px', color: '#facc15', fontWeight: '800' }}>
                              +{sig.maxScoreReached} pts
                            </td>

                            <td style={{ padding: '10px 16px' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 8px',
                                borderRadius: '6px',
                                fontSize: '0.70rem',
                                fontWeight: '900',
                                background: isWin 
                                  ? 'rgba(16, 185, 129, 0.2)' 
                                  : isStopped 
                                    ? 'rgba(244, 63, 94, 0.2)' 
                                    : 'rgba(0, 229, 255, 0.15)',
                                color: isWin ? '#10b981' : isStopped ? '#f43f5e' : '#00e5ff',
                                border: isWin 
                                  ? '1px solid rgba(16, 185, 129, 0.4)' 
                                  : isStopped 
                                    ? '1px solid rgba(244, 63, 94, 0.4)' 
                                    : '1px solid rgba(0, 229, 255, 0.3)'
                              }}>
                                {isWin && '✅ TARGET ATTEINTE'}
                                {isStopped && '🛑 STOP LOSS TOUCHÉ'}
                                {isActive && '🚀 EN COURS'}
                                <span style={{ marginLeft: '4px', opacity: 0.9 }}>({sig.pnlPts >= 0 ? `+${sig.pnlPts}` : sig.pnlPts} pts)</span>
                              </span>
                            </td>

                            <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                              <button
                                onClick={() => {
                                  setSelectedSoloToken({ cleanSymbol: sig.symbol, symbol: `${sig.symbol}USDT` });
                                  setShowSignalsModal(false);
                                  const el = document.getElementById('benchmark-chart-container');
                                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                                }}
                                style={{
                                  background: 'linear-gradient(135deg, rgba(0, 229, 255, 0.2), rgba(2, 132, 199, 0.2))',
                                  color: '#38bdf8',
                                  border: '1px solid rgba(56, 189, 248, 0.4)',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  fontSize: '0.70rem',
                                  fontWeight: '800',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <ExternalLink size={12} /> Inspecter
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
