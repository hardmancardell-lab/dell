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
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="jv-lede flex-1" style={{ marginBottom: 0 }}>
          Tickers saved from Analyze Ticker or the Screener, with a fresh Graham Checklist run the moment this
          page loads — the honest version of &quot;alerts&quot; for an app with no background server process:
          real flags computed from real data on load, not a push notification.
        </p>
        <button
          onClick={runCheck}
          disabled={loading || watchlistedSymbols.length === 0}
          className="shrink-0 px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--signal)", color: "var(--ink-950)" }}
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {hydrated && watchlistedSymbols.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          Watchlist is empty — save a ticker from Analyze Ticker or the Screener to get started.
        </p>
      )}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="jv-verdict-panel">
            <div className="jv-vp-label">
              <span className="jv-dot" aria-hidden="true" />
              Macro Stance
            </div>
            <h3>{result.macroStanceLabel}</h3>
            <div className="flex flex-col gap-1">
              {result.macroStanceRationale.map((r) => (
                <p key={r.slice(0, 30)} style={{ marginBottom: 0 }}>
                  {r}
                </p>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {result.entries.map((e) => (
              <div key={e.symbol} className="jv-card flex items-center justify-between gap-3">
                <div className="jv-br-b" />
                <div className="font-mono font-medium text-sm" style={{ color: "var(--text-0)" }}>
                  {e.symbol}
                </div>
                {e.error ? (
                  <div className="text-sm flex-1 text-right" style={{ color: "var(--text-2)" }}>
                    {e.error}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm" style={{ color: "var(--text-2)" }}>
                      Graham Checklist: {e.checklistPassCount}/{e.checklistTotal}
                    </span>
                    {e.isStrong && <span className="jv-badge c-signal">Strong</span>}
                  </div>
                )}
                <button
                  onClick={() => removeSymbol(e.symbol)}
                  style={{ color: "var(--text-2)" }}
                  aria-label={`Remove ${e.symbol}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
