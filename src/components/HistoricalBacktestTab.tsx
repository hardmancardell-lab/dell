"use client";

import { useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { PriceChart } from "./PriceChart";
import type { EquityBacktestResult, EquityBacktestSignalType } from "@/lib/agents/trading-agent/types";

const SIGNAL_OPTIONS: { value: EquityBacktestSignalType; label: string }[] = [
  { value: "volumeDisplacement", label: "Volume Displacement" },
  { value: "momentum", label: "Momentum" },
  { value: "meanReversionOversold", label: "Mean Reversion — Oversold" },
  { value: "meanReversionOverbought", label: "Mean Reversion — Overbought" },
];

const YEAR_OPTIONS = [1, 2, 3, 5];

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}

function fmtRatio(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
}

function fmtDays(v: number | null): string {
  return v !== null ? `${v}d` : "N/A";
}

function fmtDayContext(row: {
  overnightGapPct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
}): string {
  const parts: string[] = [];
  if (row.overnightGapPct !== null) parts.push(`Gap: ${fmtPct(row.overnightGapPct)}`);
  if (row.dayHigh !== null) parts.push(`High: $${row.dayHigh.toFixed(2)}${row.dayHighTimeClock ? ` @ ${row.dayHighTimeClock}` : ""}`);
  if (row.dayLow !== null) parts.push(`Low: $${row.dayLow.toFixed(2)}${row.dayLowTimeClock ? ` @ ${row.dayLowTimeClock}` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "N/A";
}

const TRADE_LOG_DISPLAY_LIMIT = 50;
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

/** Reused across Equities/Currency/Futures/Commodities' own Backtest tabs — a single .jarvis island here upgrades all four. */
export function HistoricalBacktestTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [signal, setSignal] = useState<EquityBacktestSignalType>("momentum");
  const [years, setYears] = useState(3);
  const [result, setResult] = useState<EquityBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  async function runBacktest(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setFocusedDate(null);
    try {
      const res = await fetch(
        `/api/historical-backtest?ticker=${encodeURIComponent(ticker)}&signal=${signal}&years=${years}`
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
      } else {
        setResult(json as EquityBacktestResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Walks real historical daily bars, computing the chosen signal at each past day (using only data
        available as of that day) and measuring what actually happened afterward at several horizons — with
        the same statistical rigor options-signals-project/backtest_engine.py established (Benjamini-Hochberg
        FDR correction, bootstrap confidence intervals, time-based out-of-sample split).
      </p>

      <form onSubmit={runBacktest} className="flex flex-wrap gap-3 mb-6">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input w-32" />
        <select value={signal} onChange={(e) => setSignal(e.target.value as EquityBacktestSignalType)} className="jv-select">
          {SIGNAL_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="jv-select">
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y} year{y > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Backtest"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {result.ticker} — {SIGNAL_OPTIONS.find((s) => s.value === result.signalType)?.label} over{" "}
            {result.lookbackYears} year(s): {result.tradingDaysScanned} trading days scanned,{" "}
            {result.signalOccurrences} signal occurrence(s) found.
          </div>

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className={TH_CLASS}>Horizon</th>
                  <th className={TH_CLASS}>N</th>
                  <th className={TH_CLASS}>Mean Return</th>
                  <th className={TH_CLASS}>Median Return</th>
                  <th className={TH_CLASS}><GlossaryTerm term="pValue">p-value</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="fdrAdjustedP">FDR-adjusted p</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="bootstrapCi">Bootstrap 95% CI</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="oosSignAgrees">OOS Sign Agrees</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="passesAllThreeBars">Passes All 3 Bars</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="winRate">Win Rate</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm></th>
                  <th className={TH_CLASS}><GlossaryTerm term="maxDrawdown">Max Drawdown</GlossaryTerm></th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {result.horizons.map((h) => (
                  <tr key={h.horizonDays} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{h.horizonDays}d</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{h.sampleSize}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(h.meanForwardReturnPct)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(h.medianForwardReturnPct)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(h.pValue)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(h.pValueFdrAdjusted)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                      {h.bootstrapCiLower !== null && h.bootstrapCiUpper !== null
                        ? `[${h.bootstrapCiLower.toFixed(2)}, ${h.bootstrapCiUpper.toFixed(2)}]`
                        : "N/A"}
                    </td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                      {h.sameSignOutOfSample === null ? "N/A" : h.sameSignOutOfSample ? "yes" : "no"}
                    </td>
                    <td className={TD_CLASS}>
                      <span className={`jv-badge ${h.passesAllThreeBars ? "c-signal" : "c-neutral"}`}>{h.passesAllThreeBars ? "yes" : "no"}</span>
                    </td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{h.winRate !== null ? `${h.winRate.toFixed(1)}%` : "N/A"}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtRatio(h.profitFactor)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{h.maxDrawdownPct !== null ? `${h.maxDrawdownPct.toFixed(2)}%` : "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            Minimum bar before treating any horizon as a real edge rather than noise, per
            options-signals-project/README.md: passes FDR correction AND holds the same sign out-of-sample
            AND has a bootstrap CI that excludes zero — all three, not one.
          </p>

          {result.reversionStats && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                Reversion Timing
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                Of {result.reversionStats.occurrencesTracked} occurrence(s), {result.reversionStats.occurrencesReverted}{" "}
                reverted back to the (day-by-day recomputed) rolling mean within {result.reversionStats.maxTrackingDays}{" "}
                trading days; {result.reversionStats.occurrencesNeverReverted} did not.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                <div>
                  <div className="jv-label">Mean Days to Revert</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>
                    {fmtDays(result.reversionStats.meanDaysToRevert !== null ? Math.round(result.reversionStats.meanDaysToRevert) : null)}
                  </div>
                </div>
                <div>
                  <div className="jv-label">Median Days to Revert</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>
                    {fmtDays(result.reversionStats.medianDaysToRevert !== null ? Math.round(result.reversionStats.medianDaysToRevert) : null)}
                  </div>
                </div>
                <div>
                  <div className="jv-label">Avg Further Move</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(result.reversionStats.avgMaxAdverseExcursionPct)}</div>
                </div>
                <div>
                  <div className="jv-label">Worst Further Move</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(result.reversionStats.worstMaxAdverseExcursionPct)}</div>
                </div>
              </div>
              <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                &quot;Further Move&quot; = how much further price drifted away from the rolling mean after the signal
                fired, before turning around — the risk side, not the deviation already priced in at signal time.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                      <th className={TH_CLASS}>Days to Revert</th>
                      <th className={TH_CLASS}>Occurrences</th>
                      <th className={TH_CLASS}>% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.reversionStats.daysToRevertDistribution.map((b) => (
                      <tr key={b.bucketLabel} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                        <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{b.bucketLabel}</td>
                        <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{b.count}</td>
                        <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{b.pctOfOccurrences.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {focusedDate && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  Chart — {result.ticker} around {focusedDate}
                </div>
                <button onClick={() => setFocusedDate(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                  ✕ Close
                </button>
              </div>
              {/* PriceChart itself is still on the old light/dark theme — a dedicated redesign pass, not yet done. */}
              <PriceChart key={focusedDate} symbol={result.ticker} focusDate={focusedDate} />
            </div>
          )}

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({result.tradeLog.length} occurrences) — click a row to jump the chart to that date
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Entry Close</th>
                    <th className={TH_CLASS}>Returns by Horizon</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                    <th className={TH_CLASS}>Days to Revert</th>
                    <th className={TH_CLASS}>Max Further Move</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row) => (
                    <tr
                      key={row.dateKey}
                      onClick={() => setFocusedDate(row.dateKey)}
                      style={{
                        borderBottom: "1px solid var(--ink-800)",
                        cursor: "pointer",
                        background: focusedDate === row.dateKey ? "var(--ink-800)" : undefined,
                      }}
                    >
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.entryClose.toFixed(2)}</td>
                      <td className={`${TD_CLASS} text-xs font-mono`} style={{ color: "var(--text-2)" }}>
                        {row.returnsByHorizon.map((r) => `${r.horizonDays}d: ${fmtPct(r.returnPct)}`).join(" · ")}
                      </td>
                      <td className={TD_CLASS}>
                        {row.isWin === null ? (
                          <span style={{ color: "var(--text-2)" }}>N/A</span>
                        ) : (
                          <span className={`jv-badge ${row.isWin ? "c-signal" : "c-danger"}`}>{row.isWin ? "win" : "loss"}</span>
                        )}
                      </td>
                      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtDays(row.daysToRevert)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.maxAdverseExcursionPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {result.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
