"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
import { WatchlistNewsPanel } from "./WatchlistNewsPanel";
import { WatchlistSelector } from "./WatchlistSelector";

export function EquityChartsTab() {
  const { entries, hydrated } = useWatchlist();
  const equityEntries = entries.filter((e) => e.assetClass === "equity");
  const [input, setInput] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const { track } = useTrackEvent();

  // useWatchlist() hydrates localStorage asynchronously after mount, so the
  // watchlist is always empty on first render — a useState initializer can't
  // pick up a default symbol from it. Set one once hydration completes, but
  // only if the user hasn't already typed/selected something.
  useEffect(() => {
    if (hydrated && symbol === null && equityEntries.length > 0) {
      setSymbol(equityEntries[0].symbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, equityEntries.length]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim().toUpperCase();
    if (trimmed) {
      setSymbol(trimmed);
      track("ticker_analyzed", { agent: "trading", tab: "Charts", symbol: trimmed });
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Multi-timeframe candlestick chart with real historical data. Quick-select
        from your Equities watchlist, or look up any ticker.
      </p>

      <WatchlistSelector />

      <form onSubmit={handleSubmit} className="flex gap-3 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="jv-input flex-1"
        />
        <button type="submit" className="jv-btn">
          Load Chart
        </button>
      </form>

      {equityEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {equityEntries.map((e) => (
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
          <PriceChart symbol={symbol} />
          <TickerNewsPanel symbol={symbol} assetClass="equity" />
        </>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Enter a ticker above to load a chart.</p>
      )}

      <WatchlistNewsPanel kind="company" entries={entries} />
    </div>
  );
}
