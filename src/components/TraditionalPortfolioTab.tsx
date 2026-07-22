"use client";

import { useCallback, useEffect, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import type { TraditionalCandidatesResult } from "@/lib/agents/trading-agent/types";

const READ_STYLES: Record<string, string> = {
  constructive: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  cautious: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
  mixed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function TraditionalPortfolioTab() {
  const { holdings, hydrated, addHolding } = usePortfolio();
  const [result, setResult] = useState<TraditionalCandidatesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const heldSymbols = holdings.map((h) => h.symbol);

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const heldParam = heldSymbols.length > 0 ? `?held=${encodeURIComponent(heldSymbols.join(","))}` : "";
      const res = await fetch(`/api/traditional-candidates${heldParam}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as TraditionalCandidatesResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldSymbols.join(",")]);

  useEffect(() => {
    if (hydrated && !checked) {
      setChecked(true);
      runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-zinc-500 flex-1">
          Candidate securities seeded from the Research Agent&apos;s own Sector Recommendations (real macro-indicator
          trends per industry) and scored against the Graham Checklist (7 fundamental criteria) — the same checklist
          used standalone in Security Analysis. Fundamental analysis on individual securities, not a market screen.
        </p>
        <button
          onClick={runCheck}
          disabled={loading}
          className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result?.dataLimitations.map((d) => (
        <div
          key={d.slice(0, 30)}
          className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
        >
          {d}
        </div>
      ))}

      {result && (
        <div className="space-y-6">
          {result.groups.map((g) => (
            <section key={g.industryId} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{g.industryName}</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${READ_STYLES[g.overallRead]}`}>{g.overallRead}</span>
              </div>

              {g.note && <p className="text-xs text-zinc-500 mb-2">{g.note}</p>}

              {g.candidates.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {g.candidates.map((c) => (
                    <div
                      key={c.ticker}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {c.ticker}
                          {c.alreadyHeld && (
                            <span className="text-[10px] uppercase tracking-wide text-zinc-400">Held</span>
                          )}
                        </div>
                        {c.error ? (
                          <div className="text-xs text-zinc-500">{c.error}</div>
                        ) : (
                          <div className="text-xs text-zinc-500">
                            Graham Checklist: {c.checklistPassCount}/{c.checklistTotal}
                          </div>
                        )}
                      </div>
                      {!c.error && !c.alreadyHeld && (
                        <button
                          onClick={() => addHolding(c.ticker, "equity", 1, 0, new Date().toISOString().slice(0, 10))}
                          className="shrink-0 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 px-3 py-1 text-xs font-medium"
                        >
                          + Add
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

      <p className="text-xs text-zinc-400">
        For a full breakdown of any candidate&apos;s Graham Checklist (earning power, NCAV, liquidity, solvency,
        dividends, valuation), use Top-Down Economic Analysis → Security Analysis directly. Adding a candidate here
        adds a 1-share placeholder holding at $0 cost basis — there&apos;s no in-place edit yet, so remove it on the
        Dashboard tab and re-add with real shares/cost basis once you&apos;ve actually bought in.
      </p>
    </div>
  );
}
