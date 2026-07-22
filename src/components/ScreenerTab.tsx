"use client";

import { useCallback, useEffect, useState } from "react";
import { useResearchWatchlist } from "@/lib/agents/research-agent/watchlist-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { ScreenerResult } from "@/lib/agents/research-agent/types";

const READ_CLASS: Record<string, string> = {
  constructive: "jv-badge c-signal",
  cautious: "jv-badge c-danger",
  mixed: "jv-badge c-neutral",
};

export function ScreenerTab() {
  const { symbols, hydrated, addSymbol } = useResearchWatchlist();
  const { track } = useTrackEvent();
  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const watchlistedSymbols = symbols.map((s) => s.symbol);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const watchlistedParam =
        watchlistedSymbols.length > 0 ? `?watchlisted=${encodeURIComponent(watchlistedSymbols.join(","))}` : "";
      const res = await fetch(`/api/research-screener${watchlistedParam}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as ScreenerResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistedSymbols.join(",")]);

  useEffect(() => {
    if (hydrated && !checked) {
      setChecked(true);
      runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="jv-lede flex-1" style={{ marginBottom: 0 }}>
          Candidate securities seeded from the Research Agent&apos;s own Sector Recommendations (real
          macro-indicator trends per industry) and scored against the Graham Checklist (7 fundamental criteria)
          — the same checklist used above in Analyze Ticker. A curated set of bellwether tickers per sector, not
          a live market screen (FMP&apos;s real screener needs a paid plan).
        </p>
        <button
          onClick={runCheck}
          disabled={loading}
          className="shrink-0 px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ background: "var(--signal)", color: "var(--ink-950)" }}
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result?.dataLimitations.map((d) => (
        <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
          {d}
        </div>
      ))}

      {result && (
        <div className="flex flex-col gap-6">
          {result.groups.map((g) => (
            <section key={g.industryId} className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  {g.industryName}
                </h3>
                <span className={READ_CLASS[g.overallRead]}>{g.overallRead}</span>
              </div>

              {g.note && (
                <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                  {g.note}
                </p>
              )}

              {g.candidates.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.candidates.map((c) => (
                    <div
                      key={c.ticker}
                      className="flex items-center justify-between gap-2 px-3 py-2"
                      style={{ border: "1px solid var(--line)", background: "var(--ink-800)" }}
                    >
                      <div>
                        <div className="text-sm font-mono font-medium flex items-center gap-2" style={{ color: "var(--text-0)" }}>
                          {c.ticker}
                          {c.alreadyWatchlisted && (
                            <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-2)" }}>
                              Watchlisted
                            </span>
                          )}
                        </div>
                        {c.error ? (
                          <div className="text-xs" style={{ color: "var(--text-2)" }}>
                            {c.error}
                          </div>
                        ) : (
                          <div className="text-xs" style={{ color: "var(--text-2)" }}>
                            Graham Checklist: {c.checklistPassCount}/{c.checklistTotal}
                          </div>
                        )}
                      </div>
                      {!c.error && !c.alreadyWatchlisted && (
                        <button
                          onClick={() => {
                            addSymbol(c.ticker);
                            track("ticker_analyzed", { agent: "research", tab: "Screener", symbol: c.ticker });
                          }}
                          className="shrink-0 px-3 py-1 text-xs font-medium"
                          style={{ border: "1px solid var(--line-bright)", color: "var(--text-1)" }}
                        >
                          + Save
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--text-2)" }}>
        For a full breakdown of any candidate&apos;s Graham Checklist (earning power, NCAV, liquidity, solvency,
        dividends, valuation), type its ticker into Analyze Ticker above.
      </p>
    </div>
  );
}
