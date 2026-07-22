"use client";

import { useState } from "react";
import {
  DAY_OF_WEEK_LOOKBACK_YEAR_OPTIONS,
  SINGLE_WEEKDAY_OCCURRENCE_OPTIONS,
  TIME_OF_DAY_LOOKBACK_DAY_OPTIONS,
} from "@/lib/agents/trading-agent/constants";
import { GlossaryTerm } from "./GlossaryTerm";
import { PriceChart } from "./PriceChart";
import type {
  CalendarDayOfWeekResult,
  CalendarTimeOfDayResult,
  DayOfWeekEffectResult,
  DayOfWeekLabel,
  SingleWeekdayResult,
  TimeOfDayEffectResult,
} from "@/lib/agents/trading-agent/types";

type Mode = "dayOfWeek" | "timeOfDay" | "singleWeekday";
const TRADE_LOG_DISPLAY_LIMIT = 50;
const WEEKDAY_OPTIONS: DayOfWeekLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}

function fmtRatio(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
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

function WinLossPill({ isWin }: { isWin: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        isWin
          ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
          : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
      }`}
    >
      {isWin ? "win" : "loss"}
    </span>
  );
}

function ResultsTable({ rows, labelHeader, labelOf }: { rows: (DayOfWeekEffectResult | TimeOfDayEffectResult)[]; labelHeader: string; labelOf: (row: DayOfWeekEffectResult | TimeOfDayEffectResult) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
            <th className="py-2 pr-4">{labelHeader}</th>
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
          {rows.map((r) => (
            <tr key={labelOf(r)} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4 font-medium">{labelOf(r)}</td>
              <td className="py-2 pr-4 text-zinc-500">{r.sampleSize}</td>
              <td className="py-2 pr-4">{fmtPct(r.meanReturnPct)}</td>
              <td className="py-2 pr-4">{fmtPct(r.medianReturnPct)}</td>
              <td className="py-2 pr-4 text-zinc-500">{fmtP(r.pValue)}</td>
              <td className="py-2 pr-4 text-zinc-500">{fmtP(r.pValueFdrAdjusted)}</td>
              <td className="py-2 pr-4 text-zinc-500">
                {r.bootstrapCiLower !== null && r.bootstrapCiUpper !== null
                  ? `[${r.bootstrapCiLower.toFixed(2)}, ${r.bootstrapCiUpper.toFixed(2)}]`
                  : "N/A"}
              </td>
              <td className="py-2 pr-4 text-zinc-500">
                {r.sameSignOutOfSample === null ? "N/A" : r.sameSignOutOfSample ? "yes" : "no"}
              </td>
              <td className="py-2 pr-4">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.passesAllThreeBars
                      ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {r.passesAllThreeBars ? "yes" : "no"}
                </span>
              </td>
              <td className="py-2 pr-4 text-zinc-500">{r.winRate !== null ? `${r.winRate.toFixed(1)}%` : "N/A"}</td>
              <td className="py-2 pr-4 text-zinc-500">{fmtRatio(r.profitFactor)}</td>
              <td className="py-2 pr-4 text-zinc-500">{r.maxDrawdownPct !== null ? `${r.maxDrawdownPct.toFixed(2)}%` : "N/A"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CalendarEffectsTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [mode, setMode] = useState<Mode>("dayOfWeek");
  const [years, setYears] = useState(3);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [singleWeekday, setSingleWeekday] = useState<DayOfWeekLabel>("Friday");
  const [occurrences, setOccurrences] = useState(50);
  const [dowResult, setDowResult] = useState<CalendarDayOfWeekResult | null>(null);
  const [todResult, setTodResult] = useState<CalendarTimeOfDayResult | null>(null);
  const [swResult, setSwResult] = useState<SingleWeekdayResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setDowResult(null);
    setTodResult(null);
    setSwResult(null);
    setFocusedDate(null);
    try {
      if (mode === "dayOfWeek") {
        const res = await fetch(`/api/calendar-day-of-week?ticker=${encodeURIComponent(ticker)}&years=${years}`);
        const json = await res.json();
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setDowResult(json as CalendarDayOfWeekResult);
      } else if (mode === "timeOfDay") {
        const res = await fetch(`/api/calendar-time-of-day?ticker=${encodeURIComponent(ticker)}&lookbackDays=${lookbackDays}`);
        const json = await res.json();
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setTodResult(json as CalendarTimeOfDayResult);
      } else {
        const res = await fetch(
          `/api/calendar-single-weekday?ticker=${encodeURIComponent(ticker)}&dayOfWeek=${singleWeekday}&occurrences=${occurrences}`
        );
        const json = await res.json();
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setSwResult(json as SingleWeekdayResult);
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
        Does this ticker tend to move on specific days of the week, or at specific times of day —
        or is any apparent pattern just noise? Same statistical rigor as the Backtest tab
        (Benjamini-Hochberg FDR correction, bootstrap confidence intervals, time-based
        out-of-sample split), applied to weekday and intraday-session buckets instead of forward
        horizons.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("dayOfWeek")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mode === "dayOfWeek"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          Day of Week
        </button>
        <button
          onClick={() => setMode("timeOfDay")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mode === "timeOfDay"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          Time of Day
        </button>
        <button
          onClick={() => setMode("singleWeekday")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            mode === "singleWeekday"
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black"
              : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          }`}
        >
          Single Weekday (Last N)
        </button>
      </div>

      <form onSubmit={runAnalysis} className="flex flex-wrap gap-3 mb-6">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm w-32"
        />
        {mode === "dayOfWeek" && (
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
          >
            {DAY_OF_WEEK_LOOKBACK_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y} year{y > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        )}
        {mode === "timeOfDay" && (
          <select
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value))}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
          >
            {TIME_OF_DAY_LOOKBACK_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        )}
        {mode === "singleWeekday" && (
          <>
            <select
              value={singleWeekday}
              onChange={(e) => setSingleWeekday(e.target.value as DayOfWeekLabel)}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
            >
              {WEEKDAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              value={occurrences}
              onChange={(e) => setOccurrences(Number(e.target.value))}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
            >
              {SINGLE_WEEKDAY_OCCURRENCE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </form>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {mode === "dayOfWeek" && dowResult && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {dowResult.ticker} — {dowResult.lookbackYears} year(s): {dowResult.tradingDaysScanned} trading days scanned.
          </div>
          {dowResult.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
          <ResultsTable rows={dowResult.days} labelHeader="Day" labelOf={(r) => (r as DayOfWeekEffectResult).dayOfWeek} />

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <summary className="text-sm font-medium cursor-pointer">Trade Log ({dowResult.tradeLog.length} occurrences)</summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Day</th>
                    <th className="py-2 pr-4">Open</th>
                    <th className="py-2 pr-4">Close</th>
                    <th className="py-2 pr-4">Return</th>
                    <th className="py-2 pr-4">Win/Loss</th>
                    <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {dowResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${i}`} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                      <td className="py-2 pr-4 text-zinc-500">{row.dayOfWeek}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.openPrice.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.closePrice.toFixed(2)}</td>
                      <td className="py-2 pr-4">{fmtPct(row.returnPct)}</td>
                      <td className="py-2 pr-4">
                        <WinLossPill isWin={row.isWin} />
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dowResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs text-zinc-400 mt-2">
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {dowResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {mode === "timeOfDay" && todResult && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {todResult.ticker} — {todResult.lookbackDays} day(s): {todResult.tradingDaysScanned} trading days scanned.
          </div>
          {todResult.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
          <ResultsTable rows={todResult.checkpoints} labelHeader="Checkpoint" labelOf={(r) => (r as TimeOfDayEffectResult).label} />

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <summary className="text-sm font-medium cursor-pointer">Trade Log ({todResult.tradeLog.length} occurrences)</summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Checkpoint</th>
                    <th className="py-2 pr-4">Window Start</th>
                    <th className="py-2 pr-4">Window End</th>
                    <th className="py-2 pr-4">Return</th>
                    <th className="py-2 pr-4">Win/Loss</th>
                    <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {todResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${row.checkpoint}-${i}`} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                      <td className="py-2 pr-4 text-zinc-500">{row.checkpoint}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.windowStartPrice.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.windowEndPrice.toFixed(2)}</td>
                      <td className="py-2 pr-4">{fmtPct(row.returnPct)}</td>
                      <td className="py-2 pr-4">
                        <WinLossPill isWin={row.isWin} />
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {todResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs text-zinc-400 mt-2">
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {todResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {mode === "singleWeekday" && swResult && (
        <div className="space-y-6">
          <div className="text-sm text-zinc-500">
            {swResult.ticker} — last {swResult.effect.sampleSize} of {swResult.occurrencesRequested} requested{" "}
            {swResult.dayOfWeek}(s).
          </div>
          {swResult.dataLimitations.map((d) => (
            <div
              key={d.slice(0, 30)}
              className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400"
            >
              {d}
            </div>
          ))}
          <ResultsTable rows={[swResult.effect]} labelHeader="Day" labelOf={(r) => (r as DayOfWeekEffectResult).dayOfWeek} />

          <section>
            <h3 className="text-sm font-semibold mb-3">High / Low of Day Timing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium mb-2">Low of Day</div>
                <div className="space-y-1">
                  {swResult.lowOfDayDistribution.length === 0 && (
                    <p className="text-xs text-zinc-400">No minute-bar timing data available.</p>
                  )}
                  {swResult.lowOfDayDistribution.map((f) => (
                    <div key={f.bucketLabel} className="flex justify-between text-sm">
                      <span className="text-zinc-500">{f.bucketLabel}</span>
                      <span>{f.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium mb-2">High of Day</div>
                <div className="space-y-1">
                  {swResult.highOfDayDistribution.length === 0 && (
                    <p className="text-xs text-zinc-400">No minute-bar timing data available.</p>
                  )}
                  {swResult.highOfDayDistribution.map((f) => (
                    <div key={f.bucketLabel} className="flex justify-between text-sm">
                      <span className="text-zinc-500">{f.bucketLabel}</span>
                      <span>{f.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {focusedDate && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Chart — {swResult.ticker} around {focusedDate}</h3>
                <button
                  onClick={() => setFocusedDate(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  ✕ Close
                </button>
              </div>
              <PriceChart key={focusedDate} symbol={swResult.ticker} focusDate={focusedDate} />
            </div>
          )}

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <summary className="text-sm font-medium cursor-pointer">
              Trade Log ({swResult.tradeLog.length} occurrences) — click a row to jump the chart to that date
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Open</th>
                    <th className="py-2 pr-4">Close</th>
                    <th className="py-2 pr-4">Return</th>
                    <th className="py-2 pr-4">Win/Loss</th>
                    <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {swResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr
                      key={`${row.dateKey}-${i}`}
                      onClick={() => setFocusedDate(row.dateKey)}
                      className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                        focusedDate === row.dateKey ? "bg-zinc-50 dark:bg-zinc-900" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.openPrice.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-zinc-500">${row.closePrice.toFixed(2)}</td>
                      <td className="py-2 pr-4">{fmtPct(row.returnPct)}</td>
                      <td className="py-2 pr-4">
                        <WinLossPill isWin={row.isWin} />
                      </td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {swResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs text-zinc-400 mt-2">
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {swResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      <p className="text-xs text-zinc-400 mt-6">
        Minimum bar before treating any bucket as a real edge rather than noise: passes FDR
        correction AND holds the same sign out-of-sample AND has a bootstrap CI that excludes
        zero — all three, not one.
      </p>
    </div>
  );
}
