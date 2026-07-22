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

const SKEW_CLASS: Record<SkewLabel, string> = {
  bearish: "jv-badge c-danger",
  bullish: "jv-badge c-signal",
  neutral: "jv-badge c-neutral",
};

const QUADRANT_CLASS: Record<QuadrantLabel, string> = {
  "bullish-stable": "jv-badge c-signal",
  "bullish-volatile": "jv-badge c-signal",
  "bearish-stable": "jv-badge c-danger",
  "bearish-volatile": "jv-badge c-danger",
};

// Strategy categories aren't good/bad signals — just categorical types — so
// they stay neutral rather than borrowing the semantic signal/danger colors;
// the category name itself is the information, shown as a mono label.
const CATEGORY_LABEL: Record<StrategyCategory, string> = {
  income: "Income",
  directional: "Directional",
  volatility: "Volatility",
  hedging: "Hedging",
};

/** Options' Dashboard tab — embeds TradingDashboardTab (already .jarvis) as a sibling below its own GEX/skew/strategy sections. */
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
    <div className="flex flex-col gap-10">
      <div className="jarvis flex flex-col gap-10">
      <WatchlistSelector />

      <form onSubmit={handleQuickAdd} className="flex flex-wrap gap-3">
        <input value={quickAddSymbol} onChange={(e) => setQuickAddSymbol(e.target.value)} placeholder="Company/ticker to scan, e.g. AAPL" className="jv-input flex-1 min-w-[200px]" />
        <button type="submit" className="jv-btn">
          Scan
        </button>
      </form>

      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="jv-strip-title" style={{ margin: 0 }}>GEX &amp; Dealer Positioning</div>
          <button onClick={runGexCheck} disabled={gexLoading || optionEntries.length === 0} className="jv-btn" style={{ padding: "6px 16px" }}>
            {gexLoading ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Dealer gamma-exposure regime, gamma flip level, call/put walls, IV term structure, and a 4-quadrant
          direction/volatility label — computed from a live options chain with real open interest (via
          Tradier). Each check here also logs a row to the forward paper backtest (see the Paper Backtest Log
          tab) so real outcomes accumulate over time.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Add an underlying to your Options watchlist below to see this signal.
          </p>
        ) : gexRows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{gexLoading ? "Checking…" : "No data yet."}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {gexRows.map((r) => (
              <div key={r.ticker} className="jv-card">
                <div className="jv-br-b" />
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-mono font-medium" style={{ color: "var(--text-0)" }}>{r.ticker}</div>
                  {r.signal?.quadrant && <span className={QUADRANT_CLASS[r.signal.quadrant]}>{r.signal.quadrant}</span>}
                </div>
                {r.error ? (
                  <div className="text-sm" style={{ color: "var(--text-2)" }}>{r.error}</div>
                ) : r.signal ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="jv-label">Regime</div>
                      <div className="font-mono" style={{ color: "var(--text-1)" }}>{r.signal.gexRegime.regime}</div>
                    </div>
                    <div>
                      <div className="jv-label">Gamma Flip</div>
                      <div className="font-mono" style={{ color: "var(--text-1)" }}>{r.signal.gexRegime.gammaFlip !== null ? r.signal.gexRegime.gammaFlip.toFixed(2) : "N/A"}</div>
                    </div>
                    <div>
                      <div className="jv-label">Call Wall</div>
                      <div className="font-mono" style={{ color: "var(--text-1)" }}>{r.signal.gexRegime.callWall.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="jv-label">Put Wall</div>
                      <div className="font-mono" style={{ color: "var(--text-1)" }}>{r.signal.gexRegime.putWall.toFixed(2)}</div>
                    </div>
                    {r.signal.termStructure && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="jv-label">IV Term Structure</div>
                        <div className="font-mono" style={{ color: "var(--text-1)" }}>
                          {r.signal.termStructure.shape} (spread {r.signal.termStructure.spread.toFixed(4)})
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
                {r.signal && r.signal.dataLimitations.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {r.signal.dataLimitations.map((d) => (
                      <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
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
          <div className="jv-strip-title" style={{ margin: 0 }}>Put/Call Flow Skew</div>
          <button onClick={runCheck} disabled={loading || optionEntries.length === 0} className="jv-btn" style={{ padding: "6px 16px" }}>
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Put/call volume ratio per underlying in your Options watchlist — above 1.5 flagged bearish skew,
          below 0.7 flagged bullish skew. A simple directional read on options flow — see GEX &amp; Dealer
          Positioning above for the fuller regime-based signal.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Add an underlying to your Options watchlist below to see flow skew.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>{loading ? "Checking…" : "No data yet."}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.ticker} className="jv-card flex items-center justify-between">
                <div className="jv-br-b" />
                <div className="text-sm font-mono font-medium" style={{ color: "var(--text-0)" }}>{r.ticker}</div>
                {r.error ? (
                  <div className="text-sm" style={{ color: "var(--text-2)" }}>{r.error}</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono" style={{ color: "var(--text-2)" }}>
                      Ratio: {r.ratio !== null ? r.ratio.toFixed(2) : "N/A"}
                    </span>
                    <span className={SKEW_CLASS[r.skew]}>{r.skew}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="jv-strip-title">Strategy Scanner</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Auto-derived from the GEX regime and flow skew already computed above for each Options watchlist
          underlying — no separate fetch. A rule-based heuristic mapping conditions to candidate strategies
          (see the Strategy Guide tab for the full catalog), not a backtested recommendation — treat it as a
          starting framework, not investment advice.
        </p>
        {optionEntries.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Add an underlying to your Options watchlist below to see strategy suggestions.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {strategyRows.map((r) => (
              <div key={r.ticker} className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-mono font-medium mb-2" style={{ color: "var(--text-0)" }}>{r.ticker}</div>
                {r.recommendations.length === 0 ? (
                  <div className="text-sm" style={{ color: "var(--text-2)" }}>
                    {gexLoading || loading
                      ? "Waiting on signals above…"
                      : r.gexError
                        ? "No GEX signal available — see the error above in GEX & Dealer Positioning."
                        : "No clear signal from current conditions."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {r.recommendations.map((rec) => (
                      <div key={rec.strategyName} className="flex items-start gap-3">
                        <span className="jv-badge c-neutral shrink-0">{CATEGORY_LABEL[rec.category]}</span>
                        <div className="text-sm">
                          <span className="font-medium" style={{ color: "var(--text-0)" }}>{rec.strategyName}</span>{" "}
                          <span style={{ color: "var(--text-2)" }}>— {rec.rationale}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      </div>

      <TradingDashboardTab filterAssetClass="option" />
    </div>
  );
}
