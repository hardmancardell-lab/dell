"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWatchlist } from "@/lib/agents/trading-agent/watchlist-storage";
import { classifyPutCallSkew, type SkewLabel } from "@/lib/agents/trading-agent/skills/options-flow-skew";
import { recommendStrategies } from "@/lib/agents/trading-agent/skills/strategy-scanner";
import { TradingDashboardTab } from "./TradingDashboardTab";
import { WatchlistSelector } from "./WatchlistSelector";
import type {
  GexSignalResult,
  OptionsChainSummary,
  QuadrantLabel,
  StrategyCategory,
} from "@/lib/agents/trading-agent/types";

interface SkewRow {
  ticker: string;
  ratio: number | null;
  skew: SkewLabel;
  error: string | null;
}

interface GexRow {
  ticker: string;
  signal: GexSignalResult | null;
  error: string | null;
}

const SKEW_STYLES: Record<SkewLabel, string> = {
  bearish: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
  bullish: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const QUADRANT_STYLES: Record<QuadrantLabel, string> = {
  "bullish-stable": "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  "bullish-volatile": "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400",
  "bearish-stable": "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
  "bearish-volatile": "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400",
};

const CATEGORY_STYLES: Record<StrategyCategory, string> = {
  income: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400",
  directional: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400",
  volatility: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400",
  hedging: "bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-400",
};

export function OptionsDashboardTab() {
  const { entries, hydrated, addEntry } = useWatchlist();
  const optionEntries = entries.filter((e) => e.assetClass === "option");
  const [quickAddSymbol, setQuickAddSymbol] = useState("");
  const [rows, setRows] = useState<SkewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const [gexRows, setGexRows] = useState<GexRow[]>([]);
  const [gexLoading, setGexLoading] = useState(false);
  const [gexChecked, setGexChecked] = useState(false);

  const runCheck = useCallback(async () => {
    if (optionEntries.length === 0) return;
    setLoading(true);
    const results = await Promise.all(
      optionEntries.map(async (e): Promise<SkewRow> => {
        try {
          const res = await fetch(`/api/options-chain?ticker=${encodeURIComponent(e.symbol)}`);
          const json = await res.json();
          if (!res.ok) {
            return { ticker: e.symbol, ratio: null, skew: "neutral", error: json.error ?? "Unknown error" };
          }
          const chain = json as OptionsChainSummary;
          return {
            ticker: e.symbol,
            ratio: chain.putCallVolumeRatio,
            skew: classifyPutCallSkew(chain.putCallVolumeRatio),
            error: null,
          };
        } catch (err) {
          return {
            ticker: e.symbol,
            ratio: null,
            skew: "neutral",
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    );
    setRows(results);
    setLoading(false);
  }, [optionEntries]);

  const runGexCheck = useCallback(async () => {
    if (optionEntries.length === 0) return;
    setGexLoading(true);
    const results = await Promise.all(
      optionEntries.map(async (e): Promise<GexRow> => {
        try {
          const res = await fetch(`/api/gex-signal?ticker=${encodeURIComponent(e.symbol)}`);
          const json = await res.json();
          if (!res.ok) {
            return { ticker: e.symbol, signal: null, error: json.error ?? "Unknown error" };
          }
          return { ticker: e.symbol, signal: json as GexSignalResult, error: null };
        } catch (err) {
          return { ticker: e.symbol, signal: null, error: err instanceof Error ? err.message : "Unknown error" };
        }
      })
    );
    setGexRows(results);
    setGexLoading(false);
  }, [optionEntries]);

  useEffect(() => {
    if (hydrated && !checked && optionEntries.length > 0) {
      setChecked(true);
      runCheck();
    }
  }, [hydrated, checked, optionEntries, runCheck]);

  useEffect(() => {
    if (hydrated && !gexChecked && optionEntries.length > 0) {
      setGexChecked(true);
      runGexCheck();
    }
  }, [hydrated, gexChecked, optionEntries, runGexCheck]);

  // Pure derivation from state already fetched by the two checks above — no
  // new network requests. Combines each ticker's GEX signal with its flow
  // skew (both already in memory) into a rule-based strategy suggestion.
  const strategyRows = useMemo(
    () =>
      optionEntries.map((e) => {
        const gexRow = gexRows.find((g) => g.ticker === e.symbol);
        const skewRow = rows.find((r) => r.ticker === e.symbol);
        return {
          ticker: e.symbol,
          recommendations: recommendStrategies(gexRow?.signal ?? null, skewRow?.skew ?? null),
          gexError: gexRow?.error ?? null,
        };
      }),
    [optionEntries, gexRows, rows]
  );

  function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAddSymbol.trim()) return;
    addEntry(quickAddSymbol, "option");
    setQuickAddSymbol("");
  }

  return (
    <div className="space-y-10">
      <WatchlistSelector />

      <form onSubmit={handleQuickAdd} className="flex flex-wrap gap-3">
        <input
          value={quickAddSymbol}
          onChange={(e) => setQuickAddSymbol(e.target.value)}
          placeholder="Company/ticker to scan, e.g. AAPL"
          className="flex-1 min-w-[200px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium"
        >
          Scan
        </button>
      </form>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">GEX &amp; Dealer Positioning</h2>
          <button
            onClick={runGexCheck}
            disabled={gexLoading || optionEntries.length === 0}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {gexLoading ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mb-4">
          Dealer gamma-exposure regime, gamma flip level, call/put walls, IV
          term structure, and a 4-quadrant direction/volatility label —
          computed from a live options chain with real open interest (via
          Tradier). Each check here also logs a row to the forward paper
          backtest (see the Paper Backtest Log tab) so real outcomes
          accumulate over time.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Add an underlying to your Options watchlist below to see this signal.
          </p>
        ) : gexRows.length === 0 ? (
          <p className="text-sm text-zinc-500">{gexLoading ? "Checking…" : "No data yet."}</p>
        ) : (
          <div className="space-y-3">
            {gexRows.map((r) => (
              <div key={r.ticker} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm">{r.ticker}</div>
                  {r.signal?.quadrant && (
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${QUADRANT_STYLES[r.signal.quadrant]}`}>
                      {r.signal.quadrant}
                    </span>
                  )}
                </div>
                {r.error ? (
                  <div className="text-sm text-zinc-500">{r.error}</div>
                ) : r.signal ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">Regime</div>
                      <div>{r.signal.gexRegime.regime}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">Gamma Flip</div>
                      <div>{r.signal.gexRegime.gammaFlip !== null ? r.signal.gexRegime.gammaFlip.toFixed(2) : "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">Call Wall</div>
                      <div>{r.signal.gexRegime.callWall.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-zinc-500">Put Wall</div>
                      <div>{r.signal.gexRegime.putWall.toFixed(2)}</div>
                    </div>
                    {r.signal.termStructure && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="text-xs uppercase tracking-wide text-zinc-500">IV Term Structure</div>
                        <div>
                          {r.signal.termStructure.shape} (spread {r.signal.termStructure.spread.toFixed(4)})
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                {r.signal && r.signal.dataLimitations.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {r.signal.dataLimitations.map((d) => (
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
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Put/Call Flow Skew</h2>
          <button
            onClick={runCheck}
            disabled={loading || optionEntries.length === 0}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm text-zinc-500 mb-4">
          Put/call volume ratio per underlying in your Options watchlist —
          above 1.5 flagged bearish skew, below 0.7 flagged bullish skew. A
          simple directional read on options flow — see GEX &amp; Dealer
          Positioning above for the fuller regime-based signal.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Add an underlying to your Options watchlist below to see flow skew.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-zinc-500">{loading ? "Checking…" : "No data yet."}</p>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div
                key={r.ticker}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 flex items-center justify-between"
              >
                <div className="font-medium text-sm">{r.ticker}</div>
                {r.error ? (
                  <div className="text-sm text-zinc-500">{r.error}</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-zinc-500">
                      Ratio: {r.ratio !== null ? r.ratio.toFixed(2) : "N/A"}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${SKEW_STYLES[r.skew]}`}>
                      {r.skew}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Strategy Scanner</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Auto-derived from the GEX regime and flow skew already computed
          above for each Options watchlist underlying — no separate fetch. A
          rule-based heuristic mapping conditions to candidate strategies
          (see the Strategy Guide tab for the full catalog), not a
          backtested recommendation — treat it as a starting framework, not
          investment advice.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Add an underlying to your Options watchlist below to see strategy suggestions.
          </p>
        ) : (
          <div className="space-y-3">
            {strategyRows.map((r) => (
              <div key={r.ticker} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <div className="font-medium text-sm mb-2">{r.ticker}</div>
                {r.recommendations.length === 0 ? (
                  <div className="text-sm text-zinc-500">
                    {gexLoading || loading
                      ? "Waiting on signals above…"
                      : r.gexError
                        ? "No GEX signal available — see the error above in GEX & Dealer Positioning."
                        : "No clear signal from current conditions."}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {r.recommendations.map((rec) => (
                      <div key={rec.strategyName} className="flex items-start gap-3">
                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${CATEGORY_STYLES[rec.category]}`}
                        >
                          {rec.strategyName}
                        </span>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">{rec.rationale}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <TradingDashboardTab filterAssetClass="option" />
    </div>
  );
}
