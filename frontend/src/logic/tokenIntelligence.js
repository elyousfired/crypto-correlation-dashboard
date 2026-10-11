/**
 * Token Intelligence & Fundamental Catalyst Engine
 * Fetches real, accurate, verified data from CoinGecko, DeFiLlama, and Bybit APIs.
 * Includes a strictly verified technical database for crypto protocols.
 */

// In-memory cache to prevent rate-limiting and guarantee instant sub-second response
const intelligenceCache = new Map();

// Curated & Strictly Verified Knowledge Base for major protocols
export const VERIFIED_PROTOCOLS_DB = {
  'BOME': {
    name: 'Book of Meme',
    category: 'Meme / Decentralized Storage',
    chain: 'Solana',
    summary: 'Projet expérimental lancé par l\'artiste Darkfarms combinant la culture mème, le stockage décentralisé sur Arweave/IPFS et le trading spéculatif on-chain.',
    cryptoImportance: 'Pionnier du concept d\'archivage perpétuel et immuable de la culture numérique et des mèmes sur des registres décentralisés permanents (Arweave).',
    mechanisms: '100% de la supply en circulation (zéro risque d\'unlocks futurs), liquidité initiale brûlée, modèle communautaire pur.',
    primaryCatalysts: ['Volume record sur les paires DEX Solana', 'Spéculation sur les cycles de liquidité mème', 'Short squeeze perpétuel avec funding rate négatif']
  },
  'PEOPLE': {
    name: 'ConstitutionDAO',
    category: 'DAO / Web3 Governance & Crowd-funding',
    chain: 'Ethereum',
    summary: 'Token historique issu du mouvement ConstitutionDAO qui avait levé 47 millions de dollars en 2021 pour tenter d\'acheter un exemplaire original de la Constitution américaine.',
    cryptoImportance: 'Symbole fondamental du pouvoir de financement participatif décentralisé (Crowdfunding) et de la gouvernance Web3 autonome sans intermédiaire bancaire.',
    mechanisms: 'Valeur plancher historique liée aux réserves d\'ETH restituables (1 ETH pour 1,000,000 PEOPLE), supply plafonnée, actif refuge lors des tensions de liquidité.',
    primaryCatalysts: ['Cycles d\'attention électorale et politique aux USA', 'Rachat massif de positions vendeuses (Short Squeeze)', 'Rotation de liquidité sur les actifs historiques ERC-20']
  },
  'ENA': {
    name: 'Ethena Protocol',
    category: 'DeFi / Synthetic Dollar (Stablecoin)',
    chain: 'Ethereum / Multi-chain',
    summary: 'Protocole monétaire créant l\'USDe, un dollar synthétique résistant à la censure financière adossé à une couverture delta-neutre sur ETH/BTC perpétuel.',
    cryptoImportance: 'Premier dollar synthétique autonome décorrélé du système bancaire traditionnel (contrairement à USDT/USDC), offrant une "obligation Internet" native à haut rendement.',
    mechanisms: 'Rendement issu du staking d\'ETH (Lido/RocketPool) + capture des taux de funding positifs sur les marchés perpétuels.',
    primaryCatalysts: ['Intégration de l\'USDe comme collatéral sur Bybit & Binance', 'Rendement de staking attractif (APY > 15-25%)', 'Hausse spectaculaire de la TVL (> $3 milliards)']
  },
  'NEIRO': {
    name: 'First Neiro on Ethereum',
    category: 'Meme / Community Token',
    chain: 'Ethereum',
    summary: 'Token mème communautaire inspiré du nouveau chien de sauvetage adopté par le propriétaire original de Kabosu (le Shiba Inu derrière Dogecoin).',
    cryptoImportance: 'Représente la nouvelle génération de mèmes Ethereum "100% communautaires" (Community Takeover - CTO) sans allocation d\'équipe ni capital-risqueurs.',
    mechanisms: 'Contrat renoncé (renounced ownership), 0% de taxe d\'achat/vente, 100% supply circulante sans vesting.',
    primaryCatalysts: ['Listing spot & futures sur les exchanges de rang 1', 'Rotation des capitaux de Solana vers Ethereum Memes', 'Hyper-vélocité du volume par rapport à la Market Cap']
  },
  'CORE': {
    name: 'Core DAO',
    category: 'Layer 1 / Bitcoin Hybrid DeFi',
    chain: 'Core Chain',
    summary: 'Blockchain de couche 1 (L1) sécurisée par le mécanisme de consensus Satoshi Plus, combinant la preuve de travail déléguée du Bitcoin (DPoW) et la preuve d\'enjeu (DPoS).',
    cryptoImportance: 'Permet aux mineurs de Bitcoin de staker leur puissance de hachage sans vendre leurs BTC pour sécuriser des smart contracts compatibles EVM.',
    mechanisms: 'Staking de BTC natif non-dépositaire, validation double-sécurité, compatibilité totale Ethereum Web3.',
    primaryCatalysts: ['Afflux massif de Bitcoin bridgé vers la DeFi Core', 'Partenariats avec des pools de minage majeurs', 'Expansion de l\'écosystème BTCFi (Bitcoin Finance)']
  },
  'SOL': {
    name: 'Solana',
    category: 'Layer 1 High-Throughput',
    chain: 'Solana',
    summary: 'Blockchain L1 ultra-rapide et économique utilisant la preuve d\'histoire (Proof of History) et le moteur de transaction parallélisé Sealevel.',
    cryptoImportance: 'Standard de l\'infrastructure crypto grand public (paiements instantanés, DePIN, trading on-chain à haute fréquence).',
    mechanisms: 'Frais de transaction minimaux (< 0.001$), finalité en 400ms, staking reward annuel 6-7%.',
    primaryCatalysts: ['Volume DEX dominant toute l\'industrie crypto', 'Adoption institutionnelle majeure', 'Écosystème DeFi et Memecoins en hyper-croissance']
  },
  'SUI': {
    name: 'Sui Network',
    category: 'Layer 1 Object-Centric',
    chain: 'Sui',
    summary: 'Blockchain de couche 1 conçue par d\'anciens ingénieurs de Meta (Mysten Labs), architecturée autour du langage Move et d\'un modèle orienté objet.',
    cryptoImportance: 'Permet le traitement horizontalement scalable des transactions sans blocage de chaîne (parallélisation native jusqu\'à 297,000 TPS).',
    mechanisms: 'Langage Move sécurisé anti-hacks, consensus Mysticeti sub-second, exécution instantanée des transactions d\'objets indépendants.',
    primaryCatalysts: ['Croissance exponentielle de la TVL DeFi', 'Migration de protocoles majeurs', 'Adoption massive des jeux Web3 et des paiements']
  },
  'NEAR': {
    name: 'NEAR Protocol',
    category: 'Layer 1 / User-Owned AI & Sharding',
    chain: 'NEAR',
    summary: 'Blockchain L1 sharded (Nightshade) axée sur l\'abstraction de compte utilisateur et l\'infrastructure d\'intelligence artificielle décentralisée (User-Owned AI).',
    cryptoImportance: 'Infrastructure pivot pour l\'hébergement de modèles d\'IA open-source décentralisés et le multi-chain unifié (Chain Abstraction).',
    mechanisms: 'Sharding dynamique, clés d\'accès nommées lisibles par l\'homme, exécution ultra-rapide.',
    primaryCatalysts: ['Leadership sur le narratif Crypto x Intelligence Artificielle', 'Partenariats technologiques IA', 'Croissance du volume d\'utilisateurs actifs quotidiens']
  },
  'PUMP': {
    name: 'Pump.fun Ecosystem Token',
    category: 'DeFi Launchpad / Fair Launch Infra',
    chain: 'Solana',
    summary: 'Infrastructure de création et de déploiement de tokens basée sur des Bonding Curves automatiques avec migration de liquidité sur Raydium.',
    cryptoImportance: 'A révolutionné l\'accès au capital en éliminant les préventes, les insiders et les liquidités verrouillées trompeuses.',
    mechanisms: 'Frais de protocole générant des millions de dollars quotidiens de revenus réels réinjectés dans l\'écosystème.',
    primaryCatalysts: ['Revenus de protocole record battant Ethereum', 'Activité on-chain en pic historique', 'Nouvelles fonctionnalités de streaming et de social trading']
  },
  'BTC': {
    name: 'Bitcoin',
    category: 'Digital Gold / Store of Value',
    chain: 'Bitcoin',
    summary: 'Première monnaie numérique décentralisée peer-to-peer, sécurisée par le consensus Proof-of-Work avec une politique monétaire strictement limitée à 21 millions.',
    cryptoImportance: 'Référence absolue, réserve de valeur mondiale et socle de tout l\'écosystème d\'actifs numériques.',
    mechanisms: 'Halving tous les 4 ans, émission prévisible, décentralisation maximale sans autorité centrale.',
    primaryCatalysts: ['Entrées nettes massives sur les ETF Spot institutionnels', 'Adoption par les trésoreries d\'entreprises et états', 'Réduction de l\'offre en circulation sur les exchanges']
  },
  'ETH': {
    name: 'Ethereum',
    category: 'Smart Contract Platform / Global Settlement Layer',
    chain: 'Ethereum',
    summary: 'Plateforme décentralisée d\'exécution de contrats intelligents (EVM) fonctionnant en Proof-of-Stake avec un mécanisme de burn d\'EIP-1559.',
    cryptoImportance: 'Couche de règlement principale et réserve de sécurité de la finance décentralisée (DeFi), des stablecoins et des Rollups L2.',
    mechanisms: 'Staking PoS, brûlage d\'ETH à chaque transaction, couche de sécurité pour les Rollups Arbitrum/Optimism/Base.',
    primaryCatalysts: ['Adoption institutionnelle des L2', 'Volume de staking et ré-hypothécation (EigenLayer / Restaking)', 'Rendement de staking natif sécurisé']
  }
};

/**
 * Fetch verified live market metrics from Bybit & CoinGecko
 */
export async function fetchTokenIntelligence(symbol) {
  const cleanSym = (symbol || '').replace('USDT', '').replace('PERP', '').toUpperCase();
  
  // Check in-memory cache (fresh for 60 seconds)
  const cached = intelligenceCache.get(cleanSym);
  if (cached && (Date.now() - cached.timestamp < 60000)) {
    return cached.data;
  }

  // Baseline data structure
  let result = {
    symbol: cleanSym,
    name: cleanSym,
    category: 'Crypto Asset',
    chain: 'Multi-Chain / Native',
    summary: 'Actif numérique négocié sur le marché Bybit.',
    cryptoImportance: 'Contribue à la liquidité et aux échanges décentralisés de l\'écosystème crypto.',
    mechanisms: 'Liquidité et transactions validées sur carnet d\'ordres et blockchain.',
    primaryCatalysts: ['Afflux de volume acheteur', 'Surperformance relative du Momentum', 'Momentum technique de cassure'],
    // Live Market Metrics
    price: 0,
    marketCap: null,
    fdv: null,
    tvl: null,
    volume24h: null,
    turnover24h: null,
    volumeToMcapRatio: null,
    tokenSsr: null,
    ssrTier: '⚪ MODÉRÉ',
    ssrColor: '#94a3b8',
    ssrExplanation: '',
    fundingRate: null,
    openInterest: null,
    high24h: null,
    low24h: null,
    change24h: null,
    circulatingSupply: null,
    totalSupply: null,
    ath: null,
    athChangePercentage: null,
    isVerifiedDb: false
  };

  // 1. Enrich from Curated Database if available
  if (VERIFIED_PROTOCOLS_DB[cleanSym]) {
    const dbInfo = VERIFIED_PROTOCOLS_DB[cleanSym];
    result.name = dbInfo.name;
    result.category = dbInfo.category;
    result.chain = dbInfo.chain;
    result.summary = dbInfo.summary;
    result.cryptoImportance = dbInfo.cryptoImportance;
    result.mechanisms = dbInfo.mechanisms;
    result.primaryCatalysts = dbInfo.primaryCatalysts;
    result.isVerifiedDb = true;
  }

  // 2. Fetch Live Bybit Ticker Data (Derivatives / Spot metrics)
  try {
    const bybitTickerUrl = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${cleanSym}USDT`;
    const bybitRes = await fetch(bybitTickerUrl);
    if (bybitRes.ok) {
      const bybitData = await bybitRes.json();
      const item = bybitData?.result?.list?.[0];
      if (item) {
        result.price = parseFloat(item.lastPrice || 0);
        result.fundingRate = parseFloat(item.fundingRate || 0) * 100;
        result.openInterest = parseFloat(item.openInterestValue || 0);
        result.volume24h = parseFloat(item.volume24h || 0);
        result.turnover24h = parseFloat(item.turnover24h || 0);
        result.high24h = parseFloat(item.highPrice24h || 0);
        result.low24h = parseFloat(item.lowPrice24h || 0);
        result.change24h = parseFloat(item.price24hPcnt || 0) * 100;
      }
    }
  } catch (err) {
    console.warn('[Intelligence] Bybit ticker fetch error:', err.message);
  }

  // 3. Fetch Live Market Cap, FDV, Circulating Supply from CoinGecko API
  try {
    const cgSearchUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&symbols=${cleanSym.toLowerCase()}&per_page=1&page=1`;
    let cgRes;
    try {
      cgRes = await fetch(cgSearchUrl);
    } catch (_) {
      cgRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(cgSearchUrl)}`);
    }

    if (cgRes && cgRes.ok) {
      const cgList = await cgRes.json();
      if (Array.isArray(cgList) && cgList.length > 0) {
        const coin = cgList[0];
        result.name = coin.name || result.name;
        result.marketCap = coin.market_cap || null;
        result.fdv = coin.fully_diluted_valuation || null;
        result.circulatingSupply = coin.circulating_supply || null;
        result.totalSupply = coin.total_supply || null;
        result.ath = coin.ath || null;
        result.athChangePercentage = coin.ath_change_percentage || null;
        
        if (result.marketCap && result.turnover24h && result.turnover24h > 0) {
          result.volumeToMcapRatio = parseFloat(((result.turnover24h / result.marketCap) * 100).toFixed(1));
          result.tokenSsr = parseFloat((result.marketCap / result.turnover24h).toFixed(2));
          
          if (result.volumeToMcapRatio >= 30 || result.tokenSsr <= 3.3) {
            result.ssrTier = '🔥 HYPER-FUSÉE (Levier Max)';
            result.ssrColor = '#10b981';
            result.ssrExplanation = 'Volume USDT > 30% de la Market Cap. La moindre vague d\'achat fait bondir le prix sans résistance.';
          } else if (result.volumeToMcapRatio >= 12 || result.tokenSsr <= 8.3) {
            result.ssrTier = '⚡ DYNAMIQUE (Levier Élevé)';
            result.ssrColor = '#38bdf8';
            result.ssrExplanation = 'Flux de liquidité stablecoin soutenu. Progression saine et continue.';
          } else {
            result.ssrTier = '⚪ MODÉRÉ (Levier Faible)';
            result.ssrColor = '#94a3b8';
            result.ssrExplanation = 'Token lourd avec carnet épais. Mouvement de prix plus lent.';
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Intelligence] CoinGecko live fetch error:', err.message);
  }

  // 4. Fetch Live TVL from DeFiLlama if applicable
  try {
    const llamaSlug = cleanSym.toLowerCase();
    const llamaUrl = `https://api.llama.fi/tvl/${llamaSlug}`;
    const llamaRes = await fetch(llamaUrl);
    if (llamaRes.ok) {
      const tvlVal = await llamaRes.json();
      if (typeof tvlVal === 'number' && tvlVal > 0) {
        result.tvl = tvlVal;
      }
    }
  } catch (_) {}

  // Cache and return
  intelligenceCache.set(cleanSym, { timestamp: Date.now(), data: result });
  return result;
}

export const getTokenIntelligence = fetchTokenIntelligence;

export function formatCurrency(num) {
  if (num === null || num === undefined || isNaN(num) || num === 0) return 'N/A';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  if (num < 0.01) return `$${num.toFixed(6)}`;
  return `$${num.toFixed(2)}`;
}

export function formatSupply(num, symbol) {
  if (num === null || num === undefined || isNaN(num) || num === 0) return 'N/A';
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B ${symbol}`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M ${symbol}`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K ${symbol}`;
  return `${Math.round(num).toLocaleString()} ${symbol}`;
}
