import ccxt
import pandas as pd
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import time

app = FastAPI(title="Crypto Correlation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache for correlation data to avoid hitting rate limits
cache = {
    "last_updated": 0,
    "matrix": None,
    "tokens": []
}

def fetch_and_calculate_correlation(limit=30, timeframe='1h', since_days=7):
    print("Fetching market data...")
    exchange = ccxt.binance({
        'enableRateLimit': True,
    })
    
    # Get markets
    markets = exchange.load_markets()
    # Filter USDT spot pairs
    usdt_pairs = [symbol for symbol, market in markets.items() if market['quote'] == 'USDT' and market['spot'] and market['active']]
    
    # Sort by volume (roughly, by fetching tickers - this is heavy if done all at once, so let's simplify by fetching a pre-defined list or top symbols if ccxt supports fetch_tickers)
    tickers = exchange.fetch_tickers(usdt_pairs)
    sorted_pairs = sorted([s for s in usdt_pairs if s in tickers], key=lambda s: tickers[s].get('quoteVolume', 0) or 0, reverse=True)
    
    top_pairs = sorted_pairs[:limit]
    print(f"Top {limit} pairs selected: {top_pairs}")
    
    # Fetch OHLCV for top pairs
    since = exchange.milliseconds() - (since_days * 24 * 60 * 60 * 1000)
    prices = {}
    
    for symbol in top_pairs:
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since)
            # ohlcv format: [timestamp, open, high, low, close, volume]
            closes = [x[4] for x in ohlcv]
            timestamps = [x[0] for x in ohlcv]
            series = pd.Series(closes, index=timestamps, name=symbol.replace('/USDT', ''))
            prices[symbol] = series
        except Exception as e:
            print(f"Failed to fetch {symbol}: {e}")
        time.sleep(exchange.rateLimit / 1000) # Respect rate limits
        
    df = pd.DataFrame(prices)
    
    # Clean symbol names (e.g., BTC/USDT -> BTC)
    df.columns = [c.replace('/USDT', '') for c in df.columns]
    
    # Calculate percentage returns
    returns = df.pct_change().dropna()
    
    # Calculate correlation matrix
    corr_matrix = returns.corr()
    
    # Convert to JSON serializable format
    matrix_dict = corr_matrix.replace({np.nan: None}).to_dict()
    tokens = list(corr_matrix.columns)
    
    return {
        "matrix": matrix_dict,
        "tokens": tokens
    }

@app.get("/api/correlation")
def get_correlation(limit: int = 30, force_refresh: bool = False):
    global cache
    
    # Cache for 1 hour (3600 seconds)
    if cache["matrix"] is None or force_refresh or (time.time() - cache["last_updated"] > 3600):
        try:
            data = fetch_and_calculate_correlation(limit=limit)
            cache["matrix"] = data["matrix"]
            cache["tokens"] = data["tokens"]
            cache["last_updated"] = time.time()
        except Exception as e:
            return {"error": str(e)}
            
    return {
        "tokens": cache["tokens"],
        "matrix": cache["matrix"],
        "last_updated": cache["last_updated"]
    }

@app.get("/api/correlation/{symbol}")
def get_symbol_correlation(symbol: str):
    symbol = symbol.upper()
    if not cache["matrix"]:
        return {"error": "Matrix not generated yet. Call /api/correlation first."}
        
    if symbol not in cache["matrix"]:
        return {"error": f"Symbol {symbol} not found in current data."}
        
    correlations = cache["matrix"][symbol]
    
    # Sort and filter (remove self)
    sorted_corr = sorted(
        [{"symbol": k, "correlation": v} for k, v in correlations.items() if k != symbol and v is not None],
        key=lambda x: x["correlation"],
        reverse=True
    )
    
    top_correlated = sorted_corr[:10]
    least_correlated = sorted_corr[-10:]
    least_correlated.reverse() # Most negative at the top
    
    return {
        "symbol": symbol,
        "top_correlated": top_correlated,
        "least_correlated": least_correlated
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
