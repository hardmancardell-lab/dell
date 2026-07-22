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
    <div>
      <p className="text-zinc-500 mb-6">
        Walks real historical daily bars, computing the chosen signal at each
        past day (using only data available as of that day) and measuring
        what actually happened afterward at several horizons — with the same
        statistical rigor options-signals-project/backtest_engine.py
        established (Benjamini-Hochberg FDR correction, bootstrap confidence
        intervals, time-based out-of-sample split).
      </p>

      <form onSubmit={runBacktest} className="flex flex-wrap gap-3 mb-6">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm w-32"
        />
        <select
          value={signal}
          onChange={(e) => setSignal(e.target.value as EquityBacktestSignalType)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {SIGNAL_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>
              {y} year{y > 1 ? "s" : ""}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Run Backtest"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {result.ticker} — {SIGNAL_OPTIONS.find((s) => s.value === result.signalType)?.label} over{" "}
            {result.lookbackYears} year(s): {result.tradingDaysScanned} trading days scanned,{" "}
            {result.signalOccurrences} signal occurrence(s) found.
          </div>

          {result.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4">Horizon</th>
                  <th className="py-2 pr-4">N</th>
                  <th className="py-2 pr-4">Mean Return</th>
                  <th className="py-2 pr-4">Median Return</th>
                  <th className="py-2 pr-4"><GlossaryTerm term="pValue">p-value</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="fdrAdjustedP">FDR-adjusted p</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="bootstrapCi">Bootstrap 95% CI</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="oosSignAgrees">OOS Sign Agrees</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="passesAllThreeBars">Passes All 3 Bars</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="winRate">Win Rate</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm></th>
                  <th className="py-2 pr-4"><GlossaryTerm term="maxDrawdown">Max Drawdown</GlossaryTerm></th>
                </tr>
              </thead>
              <tbody>
                {result.horizons.map((h) => (
                  <tr key={h.horizonDays} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium">{h.horizonDays}d</td>
                    <td className="py-2 pr-4 text-zinc-500">{h.sampleSize}</td>
                    <td className="py-2 pr-4">{fmtPct(h.meanForwardReturnPct)}</td>
                    <td className="py-2 pr-4">{fmtPct(h.medianForwardReturnPct)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtP(h.pValue)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtP(h.pValueFdrAdjusted)}</td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {h.bootstrapCiLower !== null && h.bootstrapCiUpper !== null
                        ? `[${h.bootstrapCiLower.toFixed(2)}, ${h.bootstrapCiUpper.toFixed(2)}]`
                        : "N/A"}
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {h.sameSignOutOfSample === null ? "N/A" : h.sameSignOutOfSample ? "yes" : "no"}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          h.passesAllThreeBars
                            ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {h.passesAllThreeBars ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">{h.winRate !== null ? `${h.winRate.toFixed(1)}%` : "N/A"}</td>
                    <td className="py-2 pr-4 text-zinc-500">{fmtRatio(h.profitFactor)}</td>
                    <td className="py-2 pr-4 text-zinc-500">{h.maxDrawdownPct !== null ? `${h.maxDrawdownPct.toFixed(2)}%` : "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-zinc-400">
            Minimum bar before treating any horizon as a real edge rather than
            noise, per options-signals-project/README.md: passes FDR
            correction AND holds the same sign out-of-sample AND has a
            bootstrap CI that excludes zero — all three, not one.
          </p>

          {result.reversionStats && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <h3 className="text-sm font-semibold mb-1">Reversion Timing</h3>
              <p className="text-xs text-zinc-500 mb-3">
                Of {result.reversionStats.occurrencesTracked} occurrence(s), {result.reversionStats.occurrencesReverted}{" "}
                reverted back to the (day-by-day recomputed) rolling mean within {result.reversionStats.maxTrackingDays}{" "}
                trading days; {result.reversionStats.occurrencesNeverReverted} did not.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Mean Days to Revert</div>
                  <div className="font-medium">{fmtDays(result.reversionStats.meanDaysToRevert !== null ? Math.round(result.reversionStats.meanDaysToRevert) : null)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Median Days to Revert</div>
                  <div className="font-medium">{fmtDays(result.reversionStats.medianDaysToRevert !== null ? Math.round(result.reversionStats.medianDaysToRevert) : null)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Avg Further Move</div>
                  <div className="font-medium">{fmtPct(result.reversionStats.avgMaxAdverseExcursionPct)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-zinc-500">Worst Further Move</div>
                  <div className="font-medium">{fmtPct(result.reversionStats.worstMaxAdverseExcursionPct)}</div>
                </div>
              </div>
              <p className="text-xs text-zinc-500 mb-2">
                &quot;Further Move&quot; = how much further price drifted away from the rolling mean after the signal fired,
                before turning around — the risk side, not the deviation already priced in at signal time.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                      <th className="py-2 pr-4">Days to Revert</th>
                      <th className="py-2 pr-4">Occurrences</th>
                      <th className="py-2 pr-4">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.reversionStats.daysToRevertDistribution.map((b) => (
                      <tr key={b.bucketLabel} className="border-b border-zinc-100 dark:border-zinc-900">
                        <td className="py-2 pr-4 font-medium">{b.bucketLabel}</td>
                        <td className="py-2 pr-4 text-zinc-500">{b.count}</td>
                        <td className="py-2 pr-4 text-zinc-500">{b.pctOfOccurrences.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {focusedDate && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Chart — {result.ticker} around {focusedDate}</h3>
                <button
                  onClick={() => setFocusedDate(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  ✕ Close
                </button>
              </div>
              <PriceChart key={focusedDate} symbol={result.ticker} focusDate={focusedDate} />
            </div>
          )}

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <summary className="text-sm font-medium cursor-pointer">
              Trade Log ({result.tradeLog.length} occurrences) — click a row to jump the chart to that date
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Entry Close</th>
                    <th className="py-2 pr-4">Returns by Horizon</th>
                    <th className="py-2 pr-4">Win/Loss</th>
                    <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                    <th className="py-2 pr-4">Days to Revert</th>
                    <th className="py-2 pr-4">Max Further Move</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row) => (
                    <tr
                      key={row.dateKey}
                      onClick={() => setFocusedDate(row.dateKey)}
                      className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                        focusedDate === row.dateKey ? "bg-zinc-50 dark:bg-zinc-900" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.entryClose.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">
                        {row.returnsByHorizon.map((r) => `${r.horizonDays}d: ${fmtPct(r.returnPct)}`).join(" · ")}
                      </td>
                      <td className="py-2 pr-4">
                        {row.isWin === null ? (
                          "N/A"
                        ) : (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              row.isWin
                                ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                                : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                            }`}
                          >
                            {row.isWin ? "win" : "loss"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">{fmtDayContext(row)}</td>
                      <td className="py-2 pr-4 text-zinc-500">{fmtDays(row.daysToRevert)}</td>
                      <td className="py-2 pr-4 text-zinc-500">{fmtPct(row.maxAdverseExcursionPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs text-zinc-400 mt-2">
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
