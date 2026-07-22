"use client";

import { useCallback, useEffect, useState } from "react";
import { useResearchWatchlist } from "@/lib/agents/research-agent/watchlist-storage";
import type { WatchlistOverviewResult } from "@/lib/agents/research-agent/types";

export function ResearchWatchlistTab() {
  const { symbols, hydrated, removeSymbol } = useResearchWatchlist();
  const [result, setResult] = useState<WatchlistOverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const watchlistedSymbols = symbols.map((s) => s.symbol);

  const runCheck = useCallback(async () => {
    if (watchlistedSymbols.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist-overview?symbols=${encodeURIComponent(watchlistedSymbols.join(","))}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as WatchlistOverviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistedSymbols.join(",")]);

  useEffect(() => {
    if (hydrated && !checked && watchlistedSymbols.length > 0) {
      setChecked(true);
      runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked, watchlistedSymbols.length]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-zinc-500 flex-1">
          Tickers saved from Analyze Ticker or the Screener, with a fresh Graham Checklist run the moment this page
          loads — the honest version of &quot;alerts&quot; for an app with no background server process: real flags
          computed from real data on load, not a push notification.
        </p>
        <button
          onClick={runCheck}
          disabled={loading || watchlistedSymbols.length === 0}
          className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {hydrated && watchlistedSymbols.length === 0 && (
        <p className="text-sm text-zinc-500">
          Watchlist is empty — save a ticker from Analyze Ticker or the Screener to get started.
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Macro Stance</div>
            <div className="text-lg font-semibold mb-2">{result.macroStanceLabel}</div>
            <div className="space-y-1">
              {result.macroStanceRationale.map((r) => (
                <p key={r.slice(0, 30)} className="text-sm text-zinc-500">
                  {r}
                </p>
              ))}
            </div>
          </section>

          <div className="space-y-2">
            {result.entries.map((e) => (
              <div
                key={e.symbol}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between gap-3"
              >
                <div className="font-medium text-sm">{e.symbol}</div>
                {e.error ? (
                  <div className="text-sm text-zinc-500 flex-1 text-right">{e.error}</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500">
                      Graham Checklist: {e.checklistPassCount}/{e.checklistTotal}
                    </span>
                    {e.isStrong && (
                      <span className="rounded-full px-3 py-1 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400">
                        Strong
                      </span>
                    )}
                  </div>
                )}
                <button
                  onClick={() => removeSymbol(e.symbol)}
                  className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  aria-label={`Remove ${e.symbol}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {result.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
