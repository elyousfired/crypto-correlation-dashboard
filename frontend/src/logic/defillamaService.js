// 🦙 Service d'Intégration DeFiLlama Avancé (100% Gratuit, Sans Clé API)
// Mapping intelligent Symbole ➔ Protocole / Parent ➔ Fees & TVL réels

let cachedChains = null;
let cachedProtocols = null;
let cachedFeesList = null;
let lastFetchTimestamp = 0;
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes de cache

// // Dictionnaire étendu de correspondances directes Symbole Bybit -> Nom / Slug / Parent DeFiLlama
const KNOWN_SYMBOL_ALIASES = {
  // Layer 1 / Layer 2 Blockchains
  SOL: { name: 'Solana', type: 'CHAIN', slug: 'solana' },
  ETH: { name: 'Ethereum', type: 'CHAIN', slug: 'ethereum' },
  BTC: { name: 'Bitcoin', type: 'CHAIN', slug: 'bitcoin' },
  NEAR: { name: 'Near', type: 'CHAIN', slug: 'near' },
  AVAX: { name: 'Avalanche', type: 'CHAIN', slug: 'avalanche' },
  SUI: { name: 'Sui', type: 'CHAIN', slug: 'sui' },
  SEI: { name: 'Sei', type: 'CHAIN', slug: 'sei' },
  APT: { name: 'Aptos', type: 'CHAIN', slug: 'aptos' },
  MINA: { name: 'Mina', type: 'CHAIN', slug: 'mina' },
  WAVES: { name: 'Waves', type: 'CHAIN', slug: 'waves' },
  TRX: { name: 'Tron', type: 'CHAIN', slug: 'tron' },
  TON: { name: 'TON', type: 'CHAIN', slug: 'ton' },
  BNB: { name: 'BSC', type: 'CHAIN', slug: 'bsc' },
  ARB: { name: 'Arbitrum', type: 'CHAIN', slug: 'arbitrum' },
  OP: { name: 'Optimism', type: 'CHAIN', slug: 'optimism' },
  MATIC: { name: 'Polygon', type: 'CHAIN', slug: 'polygon' },
  POL: { name: 'Polygon', type: 'CHAIN', slug: 'polygon' },
  FTM: { name: 'Fantom', type: 'CHAIN', slug: 'fantom' },
  S: { name: 'Sonic', type: 'CHAIN', slug: 'sonic' },
  INJ: { name: 'Injective', type: 'CHAIN', slug: 'injective' },
  OSMO: { name: 'Osmosis', type: 'CHAIN', slug: 'osmosis' },
  RON: { name: 'Ronin', type: 'CHAIN', slug: 'ronin' },
  FLOW: { name: 'Flow', type: 'CHAIN', slug: 'flow' },
  ALGO: { name: 'Algorand', type: 'CHAIN', slug: 'algorand' },
  ADA: { name: 'Cardano', type: 'CHAIN', slug: 'cardano' },
  DOT: { name: 'Polkadot', type: 'CHAIN', slug: 'polkadot' },
  KAS: { name: 'Kaspa', type: 'CHAIN', slug: 'kaspa' },
  TIA: { name: 'Celestia', type: 'CHAIN', slug: 'celestia' },
  KAVA: { name: 'Kava', type: 'CHAIN', slug: 'kava' },
  RUNE: { name: 'THORChain', type: 'CHAIN', slug: 'thorchain' },
  LRC: { name: 'Loopring', type: 'PROTOCOL', slug: 'loopring' },
  
  // Protocoles DeFi Majeurs & LSTs (Liaisons aux parents & modules)
  CLOUD: { name: 'Sanctum', type: 'PROTOCOL', slug: 'sanctum', parent: 'sanctum' },
  UNI: { name: 'Uniswap', type: 'PROTOCOL', slug: 'uniswap', parent: 'uniswap' },
  AAVE: { name: 'Aave', type: 'PROTOCOL', slug: 'aave', parent: 'aave' },
  RAY: { name: 'Raydium', type: 'PROTOCOL', slug: 'raydium', parent: 'raydium' },
  JUP: { name: 'Jupiter', type: 'PROTOCOL', slug: 'jupiter', parent: 'jupiter' },
  LDO: { name: 'Lido', type: 'PROTOCOL', slug: 'lido', parent: 'lido' },
  MKR: { name: 'MakerDAO', type: 'PROTOCOL', slug: 'makerdao', parent: 'makerdao' },
  SKY: { name: 'MakerDAO', type: 'PROTOCOL', slug: 'makerdao', parent: 'makerdao' },
  GMX: { name: 'GMX', type: 'PROTOCOL', slug: 'gmx', parent: 'gmx' },
  PENDLE: { name: 'Pendle', type: 'PROTOCOL', slug: 'pendle', parent: 'pendle' },
  ENA: { name: 'Ethena', type: 'PROTOCOL', slug: 'ethena', parent: 'ethena' },
  CRV: { name: 'Curve DEX', type: 'PROTOCOL', slug: 'curve-dex', parent: 'curve-finance' },
  SNX: { name: 'Synthetix', type: 'PROTOCOL', slug: 'synthetix', parent: 'synthetix' },
  COMP: { name: 'Compound', type: 'PROTOCOL', slug: 'compound', parent: 'compound-finance' },
  DYDX: { name: 'dYdX', type: 'PROTOCOL', slug: 'dydx', parent: 'dydx' },
  CAKE: { name: 'PancakeSwap', type: 'PROTOCOL', slug: 'pancakeswap', parent: 'pancakeswap' },
  SUSHI: { name: 'SushiSwap', type: 'PROTOCOL', slug: 'sushiswap', parent: 'sushiswap' },
  JTO: { name: 'Jito', type: 'PROTOCOL', slug: 'jito', parent: 'jito' },
  BLUR: { name: 'Blur', type: 'PROTOCOL', slug: 'blur', parent: 'blur' },
  MORPHO: { name: 'Morpho', type: 'PROTOCOL', slug: 'morpho', parent: 'morpho' },
  SAFE: { name: 'Safe', type: 'PROTOCOL', slug: 'safe', parent: 'safe' },
  EIGEN: { name: 'EigenLayer', type: 'PROTOCOL', slug: 'eigenlayer', parent: 'eigenlayer' },
  ETHFI: { name: 'ether.fi', type: 'PROTOCOL', slug: 'ether.fi', parent: 'ether.fi' },
  REZ: { name: 'Renzo', type: 'PROTOCOL', slug: 'renzo', parent: 'renzo' },
  KMNO: { name: 'Kamino', type: 'PROTOCOL', slug: 'kamino', parent: 'kamino' },
  DRIFT: { name: 'Drift', type: 'PROTOCOL', slug: 'drift', parent: 'drift' },
  ORCA: { name: 'Orca', type: 'PROTOCOL', slug: 'orca', parent: 'orca' },
  COW: { name: 'CoW Swap', type: 'PROTOCOL', slug: 'cow-swap', parent: 'cow-protocol' },
  BR: { name: 'Bedrock', type: 'PROTOCOL', slug: 'bedrock', parent: 'bedrock' }
};

// Tokens explicitement identifiés comme Non-DeFi (IA / Meme / CEX / Gaming)
const KNOWN_NON_DEFI = new Set([
  'KII', 'SAHARA', 'PEPE', 'DOGE', 'SHIB', 'BONK', 'WIF', 'FLOKI', 'BRETT', 'POPCAT',
  'BOME', 'NEIRO', 'TAO', 'RENDER', 'FET', 'IO', 'ATH', 'GALA', 'BEAM', 'AXS', 'SAND',
  'WLD', 'NOT', 'PENGU', 'MEME', 'TURBO', 'ACT', 'PNUT', 'GOAT', 'MOODENG'
]);

/**
 * Charge et indexe les données de DeFiLlama
 */
async function ensureDeFiLlamaDataLoaded() {
  const now = Date.now();
  if (cachedChains && cachedFeesList && cachedProtocols && (now - lastFetchTimestamp < CACHE_DURATION_MS)) {
    return;
  }

  try {
    const [chainsRes, feesRes, protocolsRes] = await Promise.allSettled([
      fetch('https://api.llama.fi/v2/chains'),
      fetch('https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true'),
      fetch('https://api.llama.fi/protocols')
    ]);

    if (chainsRes.status === 'fulfilled' && chainsRes.value.ok) {
      cachedChains = await chainsRes.value.json();
    }
    if (feesRes.status === 'fulfilled' && feesRes.value.ok) {
      const json = await feesRes.value.json();
      cachedFeesList = json.protocols || [];
    }
    if (protocolsRes.status === 'fulfilled' && protocolsRes.value.ok) {
      cachedProtocols = await protocolsRes.value.json();
    }
    lastFetchTimestamp = now;
  } catch (err) {
    console.warn('DeFiLlama pre-fetch warning:', err.message);
  }
}

/**
 * Récupère les métriques pour un symbole unique avec résolution multi-niveaux et agrégation
 * @param {string} rawSymbol - Ex: "CLOUD", "WAVES", "MINA", "AAVE", "KII"
 * @param {number} turnover24h - Volume Bybit 24h
 */
export function matchDeFiLlamaToken(rawSymbol, turnover24h = 0) {
  if (!rawSymbol) return null;
  const sym = rawSymbol.toUpperCase().replace('USDT', '').replace('PERP', '');
  const alias = KNOWN_SYMBOL_ALIASES[sym];

  // 1. Actif reconnu comme non-DeFi (Spéculatif CEX / IA / Meme)
  if (KNOWN_NON_DEFI.has(sym)) {
    return {
      symbol: sym,
      name: sym,
      category: 'Hors-DeFi (Spéculatif CEX / IA / Meme)',
      isChain: false,
      fees24h: 0,
      fees7d: 0,
      tvl: 0,
      volToFeesRatio: null,
      hasFinancialData: false,
      isNonDefi: true,
      note: "Actif d'infrastructure IA ou spéculatif CEX sans smart contracts DeFi on-chain."
    };
  }

  // 2. Vérification s'il s'agit d'une Blockchain Layer 1 / Layer 2
  let matchedChain = null;
  if (cachedChains) {
    matchedChain = cachedChains.find(c => 
      (c.tokenSymbol && c.tokenSymbol.toUpperCase() === sym) || 
      (c.name && c.name.toUpperCase() === sym)
    );
    if (!matchedChain && alias && alias.type === 'CHAIN') {
      matchedChain = cachedChains.find(c => c.name && c.name.toLowerCase() === alias.name.toLowerCase());
    }
  }

  if (matchedChain) {
    const cName = matchedChain.name.toLowerCase();
    let fees24h = 0;
    let fees7d = 0;
    if (cachedFeesList) {
      const chainFees = cachedFeesList.filter(f => 
        (f.name && f.name.toLowerCase() === cName) || 
        (f.slug && f.slug.toLowerCase() === cName) ||
        (f.displayName && f.displayName.toLowerCase() === cName)
      );
      fees24h = chainFees.reduce((sum, f) => sum + (f.total24h || 0), 0);
      fees7d = chainFees.reduce((sum, f) => sum + (f.total7d || 0), 0);
    }
    const tvl = matchedChain.tvl || 0;
    const volToFeesRatio = fees24h > 0 && turnover24h > 0 ? parseFloat((turnover24h / fees24h).toFixed(1)) : null;

    return {
      symbol: sym,
      name: matchedChain.name,
      category: 'Blockchain L1/L2',
      isChain: true,
      fees24h,
      fees7d,
      tvl,
      volToFeesRatio,
      hasFinancialData: tvl > 0 || fees24h > 0,
      isNonDefi: false,
      gasTracked: fees24h > 0 || fees7d > 0
    };
  }

  // 3. Vérification des Protocoles DeFi & dApps avec agrégation multi-produits
  const searchSlug = alias ? alias.slug.toLowerCase() : sym.toLowerCase();
  const searchParent = alias?.parent ? alias.parent.toLowerCase() : null;

  let matchingProtos = [];
  if (cachedProtocols) {
    matchingProtos = cachedProtocols.filter(p => {
      const pSym = (p.symbol || '').toUpperCase();
      const pSlug = (p.slug || '').toLowerCase();
      const pParent = p.parentProtocol ? p.parentProtocol.replace('parent#', '').toLowerCase() : null;
      if (pSym === sym) return true;
      if (searchParent && pParent === searchParent) return true;
      if (pSlug === searchSlug) return true;
      return false;
    });
  }

  if (matchingProtos.length > 0) {
    const primary = matchingProtos.find(p => p.symbol?.toUpperCase() === sym) || matchingProtos[0];
    const parentId = searchParent || (primary.parentProtocol ? primary.parentProtocol.replace('parent#', '').toLowerCase() : null);

    // Frais agrégés sur tous les modules du protocole (ex: Sanctum Validator LSTs + Reserve + Infinity)
    let fees24h = 0;
    let fees7d = 0;
    if (cachedFeesList) {
      const matchedFees = cachedFeesList.filter(f => {
        const fParent = f.parentProtocol ? f.parentProtocol.replace('parent#', '').toLowerCase() : null;
        const fSlug = (f.slug || '').toLowerCase();
        const fMod = (f.module || '').toLowerCase();
        const fName = (f.name || '').toLowerCase();
        if (parentId && fParent === parentId) return true;
        if (parentId && (fSlug.includes(parentId) || fMod.includes(parentId))) return true;
        if (searchSlug.length >= 3 && (fSlug === searchSlug || fMod === searchSlug || fName === searchSlug)) return true;
        return false;
      });

      fees24h = matchedFees.reduce((sum, f) => sum + (f.total24h || 0), 0);
      fees7d = matchedFees.reduce((sum, f) => sum + (f.total7d || 0), 0);
    }

    // TVL agrégée
    let totalTvl = 0;
    if (parentId && cachedProtocols) {
      const parentProtos = cachedProtocols.filter(p => p.parentProtocol && p.parentProtocol.replace('parent#', '').toLowerCase() === parentId);
      totalTvl = parentProtos.reduce((sum, p) => sum + (p.tvl || 0), 0);
    }
    if (totalTvl === 0) {
      totalTvl = matchingProtos.reduce((sum, p) => Math.max(sum, p.tvl || 0), 0);
    }

    // Filtrage des faux positifs (protocoles inactifs ou avec < 1000$ de TVL)
    if (totalTvl < 1000 && fees24h === 0 && fees7d === 0) {
      return {
        symbol: sym,
        name: sym,
        category: 'Hors-DeFi (Spéculatif CEX / IA / Meme)',
        isChain: false,
        fees24h: 0,
        fees7d: 0,
        tvl: 0,
        volToFeesRatio: null,
        hasFinancialData: false,
        isNonDefi: true,
        note: "Actif non-DeFi ou liquidité on-chain insignifiante."
      };
    }

    const volToFeesRatio = fees24h > 0 && turnover24h > 0 ? parseFloat((turnover24h / fees24h).toFixed(1)) : null;

    return {
      symbol: sym,
      name: alias?.name || primary.name,
      category: primary.category || 'Protocole DeFi',
      isChain: false,
      fees24h,
      fees7d,
      tvl: totalTvl,
      volToFeesRatio,
      hasFinancialData: fees24h > 0 || totalTvl > 0,
      isNonDefi: false
    };
  }

  // 4. Par défaut : Actif Hors-DeFi
  return {
    symbol: sym,
    name: sym,
    category: 'Hors-DeFi (Spéculatif CEX / IA / Meme)',
    isChain: false,
    fees24h: 0,
    fees7d: 0,
    tvl: 0,
    volToFeesRatio: null,
    hasFinancialData: false,
    isNonDefi: true,
    note: "Actif spéculatif CEX sans smart contracts DeFi on-chain."
  };
}

/**
 * Récupère en lot les métriques pour une liste de symboles
 */
export async function getDeFiLlamaMetricsForSymbols(symbols = [], tokensData = []) {
  if (!symbols || symbols.length === 0) return {};

  await ensureDeFiLlamaDataLoaded();

  const volumeMap = {};
  if (Array.isArray(tokensData)) {
    tokensData.forEach(t => {
      if (t.cleanSymbol) volumeMap[t.cleanSymbol] = t.turnover24h || 0;
    });
  }

  const result = {};
  symbols.forEach(sym => {
    const vol = volumeMap[sym] || 0;
    const match = matchDeFiLlamaToken(sym, vol);
    if (match) {
      result[sym] = match;
    }
  });

  return result;
}

/**
 * Formate un montant en dollars de manière compacte
 */
export function formatCurrencyUSD(val) {
  if (val == null || isNaN(val) || val === 0) return '$0';
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}
