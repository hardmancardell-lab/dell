"use client";

import { AssetChartsTab } from "./AssetChartsTab";

const COINS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "ADA-USD", "AVAX-USD", "LINK-USD"];

/**
 * Multi-timeframe candlestick chart for any Coinbase USD pair: the shared AssetChartsTab with the crypto watchlist and a
 * row of popular coins. Real exchange trades, 24/7, from Coinbase's public market-data API (no key). Paper trading is
 * the crypto-aware path in the paper-trading engine (fractional coins, real bid/ask, an assumed fee).
 */
export function CryptoChartsTab() {
  return (
    <AssetChartsTab
      assetClass="crypto"
      defaultTicker="BTC-USD"
      placeholder="Coin, e.g. BTC-USD"
      watchlistLabel="Crypto"
      quickPicks={COINS}
    />
  );
}
