"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
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
 * since Phase 3, not anything new.
 */
export function AssetChartsTab({
  assetClass,
  defaultTicker,
  placeholder,
  watchlistLabel,
}: {
  assetClass: AssetClass;
  defaultTicker: string;
  placeholder: string;
  watchlistLabel: string;
}) {
  const { entries, hydrated } = useWatchlist();
  const scopedEntries = entries.filter((e) => e.assetClass === assetClass);
  const [input, setInput] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
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
    const trimmed = input.trim().toUpperCase();
    if (trimmed) {
      setSymbol(trimmed);
      track("ticker_analyzed", { agent: "trading", tab: `${watchlistLabel} Charts`, symbol: trimmed });
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Multi-timeframe candlestick chart with real historical data. Quick-select from your {watchlistLabel} watchlist,
        or look up any ticker.
      </p>

      <WatchlistSelector />

      <form onSubmit={handleSubmit} className="flex gap-3 mb-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} className="jv-input flex-1" />
        <button type="submit" className="jv-btn">
          Load Chart
        </button>
      </form>

      {scopedEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
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

      {symbol ? (
        <>
          <PriceChart symbol={symbol} assetClass={assetClass} />
          <TickerNewsPanel symbol={symbol} assetClass={assetClass} />
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          Enter a ticker above to load a chart.
        </p>
      )}

      {assetClass === "forex" && <WatchlistNewsPanel kind="currency" entries={entries} />}
    </div>
  );
}
