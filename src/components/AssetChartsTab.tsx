"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { normalizeSymbolForClass } from "@/lib/agents/trading-agent/crypto-symbol";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
import { WatchlistNewsPanel } from "./WatchlistNewsPanel";
import { WatchlistSelector } from "./WatchlistSelector";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

/**
 * The same chart tool EquityChartsTab provides, generalized by asset class
 * so Currency/Futures/Commodities each get their own dedicated Charts tab
 * instead of sharing Equities'. Real data throughout: PriceChart's own
 * assetClass routing already sends "forex" through OANDA, "future"/
 * "commodity" through Alpaca — same provider carve-out this app has used
 * since Phase 3, not anything new. "crypto" routes to Coinbase by product id (BTC-USD), has no news panel (no crypto
 * news source is wired up), and takes optional quickPicks (default coins to click when the watchlist is empty).
 */
export function AssetChartsTab({
  assetClass,
  defaultTicker,
  placeholder,
  watchlistLabel,
  quickPicks,
}: {
  assetClass: AssetClass;
  defaultTicker: string;
  placeholder: string;
  watchlistLabel: string;
  quickPicks?: string[];
}) {
  const { entries, hydrated, addEntry } = useWatchlist();
  const scopedEntries = entries.filter((e) => e.assetClass === assetClass);
  const [input, setInput] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const { track } = useTrackEvent();

  // Mirrors EquityChartsTab's hydration handling, but falls back to a
  // sensible default ticker (matching the Backtest/Calendar Effects tabs'
  // own defaults for this asset class) rather than staying empty, since
  // Currency/Futures/Commodities watchlists are more often empty at first.
  useEffect(() => {
    if (hydrated && symbol === null) {
      setSymbol(scopedEntries.length > 0 ? scopedEntries[0].symbol : defaultTicker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, scopedEntries.length]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = normalizeSymbolForClass(input, assetClass);
    if (input.trim() && !trimmed) {
      setInputError("Enter a Coinbase USD pair such as BTC-USD (or just BTC).");
      return;
    }
    setInputError(null);
    if (trimmed) {
      setSymbol(trimmed);
      track("ticker_analyzed", { agent: "trading", tab: `${watchlistLabel} Charts`, symbol: trimmed });
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        {assetClass === "crypto"
          ? "Multi-timeframe candlestick chart of real Coinbase trades, around the clock. Crypto has no market close, so daily candles run from 00:00 to 24:00 UTC and volume is in coins on this one exchange. Quick-select from your Crypto watchlist, pick a coin, or type any Coinbase USD pair."
          : `Multi-timeframe candlestick chart with real historical data. Quick-select from your ${watchlistLabel} watchlist, or look up any ticker.`}
      </p>

      <WatchlistSelector />

      <form onSubmit={handleSubmit} className="flex gap-3 mb-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} className="jv-input flex-1" aria-label={placeholder} />
        <button type="submit" className="jv-btn">
          Load Chart
        </button>
      </form>
      {inputError && (
        <p className="text-sm mb-3" style={{ color: "var(--danger)" }}>
          {inputError}
        </p>
      )}

      {scopedEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          {assetClass === "crypto" && (
            <span className="jv-label" style={{ marginBottom: 0 }}>
              {watchlistLabel} watchlist
            </span>
          )}
          {scopedEntries.map((e) => (
            <button
              key={e.symbol}
              onClick={() => setSymbol(e.symbol)}
              className={symbol === e.symbol ? "jv-btn" : "jv-btn-outline"}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {e.symbol}
            </button>
          ))}
        </div>
      )}

      {quickPicks && quickPicks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <span className="jv-label" style={{ marginBottom: 0 }}>
            Popular
          </span>
          {quickPicks.map((c) => (
            <button
              key={c}
              onClick={() => {
                setInputError(null);
                setSymbol(c);
              }}
              className={symbol === c ? "jv-btn" : "jv-btn-outline"}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {assetClass === "crypto" && symbol && !scopedEntries.some((e) => e.symbol === symbol) && (
        <div className="mb-3">
          <button onClick={() => addEntry(symbol, assetClass)} className="jv-btn-outline" style={{ padding: "4px 12px", fontSize: 12 }}>
            Add {symbol} to watchlist
          </button>
        </div>
      )}

      {symbol ? (
        <div className="mt-3">
          <PriceChart key={assetClass === "crypto" ? symbol : undefined} symbol={symbol} assetClass={assetClass} readOnly={assetClass === "crypto"} />
          {assetClass !== "crypto" && <TickerNewsPanel symbol={symbol} assetClass={assetClass} />}
        </div>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          {assetClass === "crypto" ? "Enter a coin above to load a chart." : "Enter a ticker above to load a chart."}
        </p>
      )}

      {assetClass === "forex" && <WatchlistNewsPanel kind="currency" entries={entries} />}
    </div>
  );
}
