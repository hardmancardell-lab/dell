"use client";

import { useEffect, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { PriceChart } from "./PriceChart";
import { TickerNewsPanel } from "./TickerNewsPanel";
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
    <div>
      <p className="text-zinc-500 mb-4">
        Multi-timeframe candlestick chart with real historical data. Quick-select
        from your Equities watchlist, or look up any ticker.
      </p>

      <WatchlistSelector />

      <form onSubmit={handleSubmit} className="flex gap-3 mb-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium"
        >
          Load Chart
        </button>
      </form>

      {equityEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {equityEntries.map((e) => (
            <button
              key={e.symbol}
              onClick={() => setSymbol(e.symbol)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                symbol === e.symbol
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
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
        <p className="text-sm text-zinc-500">Enter a ticker above to load a chart.</p>
      )}
    </div>
  );
}
