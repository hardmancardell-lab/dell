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
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

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
  return <span className={`jv-badge ${isWin ? "c-signal" : "c-danger"}`}>{isWin ? "win" : "loss"}</span>;
}

function ResultsTable({
  rows,
  labelHeader,
  labelOf,
}: {
  rows: (DayOfWeekEffectResult | TimeOfDayEffectResult)[];
  labelHeader: string;
  labelOf: (row: DayOfWeekEffectResult | TimeOfDayEffectResult) => string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
            <th className={TH_CLASS}>{labelHeader}</th>
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
          {rows.map((r) => (
            <tr key={labelOf(r)} style={{ borderBottom: "1px solid var(--ink-800)" }}>
              <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{labelOf(r)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{r.sampleSize}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(r.meanReturnPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(r.medianReturnPct)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(r.pValue)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(r.pValueFdrAdjusted)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                {r.bootstrapCiLower !== null && r.bootstrapCiUpper !== null
                  ? `[${r.bootstrapCiLower.toFixed(2)}, ${r.bootstrapCiUpper.toFixed(2)}]`
                  : "N/A"}
              </td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                {r.sameSignOutOfSample === null ? "N/A" : r.sameSignOutOfSample ? "yes" : "no"}
              </td>
              <td className={TD_CLASS}>
                <span className={`jv-badge ${r.passesAllThreeBars ? "c-signal" : "c-neutral"}`}>{r.passesAllThreeBars ? "yes" : "no"}</span>
              </td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{r.winRate !== null ? `${r.winRate.toFixed(1)}%` : "N/A"}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtRatio(r.profitFactor)}</td>
              <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{r.maxDrawdownPct !== null ? `${r.maxDrawdownPct.toFixed(2)}%` : "N/A"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Reused across Equities/Currency/Futures/Commodities' own Calendar Effects tabs — a single .jarvis island here upgrades all four. */
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
    <div className="jarvis">
      <p className="jv-lede">
        Does this ticker tend to move on specific days of the week, or at specific times of day — or is any
        apparent pattern just noise? Same statistical rigor as the Backtest tab (Benjamini-Hochberg FDR
        correction, bootstrap confidence intervals, time-based out-of-sample split), applied to weekday and
        intraday-session buckets instead of forward horizons.
      </p>

      <div className="flex gap-2 mb-4">
        {([
          ["dayOfWeek", "Day of Week"],
          ["timeOfDay", "Time of Day"],
          ["singleWeekday", "Single Weekday (Last N)"],
        ] as [Mode, string][]).map(([m, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={mode === m ? "jv-btn" : "jv-btn-outline"}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={runAnalysis} className="flex flex-wrap gap-3 mb-6">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input w-32" />
        {mode === "dayOfWeek" && (
          <select value={years} onChange={(e) => setYears(Number(e.target.value))} className="jv-select">
            {DAY_OF_WEEK_LOOKBACK_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y} year{y > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        )}
        {mode === "timeOfDay" && (
          <select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))} className="jv-select">
            {TIME_OF_DAY_LOOKBACK_DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        )}
        {mode === "singleWeekday" && (
          <>
            <select value={singleWeekday} onChange={(e) => setSingleWeekday(e.target.value as DayOfWeekLabel)} className="jv-select">
              {WEEKDAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select value={occurrences} onChange={(e) => setOccurrences(Number(e.target.value))} className="jv-select">
              {SINGLE_WEEKDAY_OCCURRENCE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </form>

      {error && (
        <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {mode === "dayOfWeek" && dowResult && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {dowResult.ticker} — {dowResult.lookbackYears} year(s): {dowResult.tradingDaysScanned} trading days scanned.
          </div>
          {dowResult.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
          <ResultsTable rows={dowResult.days} labelHeader="Day" labelOf={(r) => (r as DayOfWeekEffectResult).dayOfWeek} />

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({dowResult.tradeLog.length} occurrences)
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Day</th>
                    <th className={TH_CLASS}>Open</th>
                    <th className={TH_CLASS}>Close</th>
                    <th className={TH_CLASS}>Return</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {dowResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${i}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.dayOfWeek}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.openPrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.closePrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(row.returnPct)}</td>
                      <td className={TD_CLASS}><WinLossPill isWin={row.isWin} /></td>
                      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dowResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {dowResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {mode === "timeOfDay" && todResult && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {todResult.ticker} — {todResult.lookbackDays} day(s): {todResult.tradingDaysScanned} trading days scanned.
          </div>
          {todResult.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
          <ResultsTable rows={todResult.checkpoints} labelHeader="Checkpoint" labelOf={(r) => (r as TimeOfDayEffectResult).label} />

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({todResult.tradeLog.length} occurrences)
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Checkpoint</th>
                    <th className={TH_CLASS}>Window Start</th>
                    <th className={TH_CLASS}>Window End</th>
                    <th className={TH_CLASS}>Return</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {todResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${row.checkpoint}-${i}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.checkpoint}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.windowStartPrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.windowEndPrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(row.returnPct)}</td>
                      <td className={TD_CLASS}><WinLossPill isWin={row.isWin} /></td>
                      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {todResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {todResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      {mode === "singleWeekday" && swResult && (
        <div className="flex flex-col gap-6">
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {swResult.ticker} — last {swResult.effect.sampleSize} of {swResult.occurrencesRequested} requested{" "}
            {swResult.dayOfWeek}(s).
          </div>
          {swResult.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}
          <ResultsTable rows={[swResult.effect]} labelHeader="Day" labelOf={(r) => (r as DayOfWeekEffectResult).dayOfWeek} />

          <section>
            <div className="jv-strip-title">High / Low of Day Timing</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>Low of Day</div>
                <div className="flex flex-col gap-1">
                  {swResult.lowOfDayDistribution.length === 0 && (
                    <p className="text-xs" style={{ color: "var(--text-2)" }}>No minute-bar timing data available.</p>
                  )}
                  {swResult.lowOfDayDistribution.map((f) => (
                    <div key={f.bucketLabel} className="jv-stat">
                      <span>{f.bucketLabel}</span>
                      <b>{f.count}</b>
                    </div>
                  ))}
                </div>
              </div>
              <div className="jv-card">
                <div className="jv-br-b" />
                <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>High of Day</div>
                <div className="flex flex-col gap-1">
                  {swResult.highOfDayDistribution.length === 0 && (
                    <p className="text-xs" style={{ color: "var(--text-2)" }}>No minute-bar timing data available.</p>
                  )}
                  {swResult.highOfDayDistribution.map((f) => (
                    <div key={f.bucketLabel} className="jv-stat">
                      <span>{f.bucketLabel}</span>
                      <b>{f.count}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {focusedDate && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  Chart — {swResult.ticker} around {focusedDate}
                </div>
                <button onClick={() => setFocusedDate(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                  ✕ Close
                </button>
              </div>
              <PriceChart key={focusedDate} symbol={swResult.ticker} focusDate={focusedDate} />
            </div>
          )}

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({swResult.tradeLog.length} occurrences) — click a row to jump the chart to that date
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Open</th>
                    <th className={TH_CLASS}>Close</th>
                    <th className={TH_CLASS}>Return</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {swResult.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr
                      key={`${row.dateKey}-${i}`}
                      onClick={() => setFocusedDate(row.dateKey)}
                      style={{
                        borderBottom: "1px solid var(--ink-800)",
                        cursor: "pointer",
                        background: focusedDate === row.dateKey ? "var(--ink-800)" : undefined,
                      }}
                    >
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.openPrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.closePrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(row.returnPct)}</td>
                      <td className={TD_CLASS}><WinLossPill isWin={row.isWin} /></td>
                      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {swResult.tradeLog.length > TRADE_LOG_DISPLAY_LIMIT && (
                <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                  Showing the most recent {TRADE_LOG_DISPLAY_LIMIT} of {swResult.tradeLog.length} occurrences.
                </p>
              )}
            </div>
          </details>
        </div>
      )}

      <p className="text-xs mt-6" style={{ color: "var(--text-2)" }}>
        Minimum bar before treating any bucket as a real edge rather than noise: passes FDR correction AND
        holds the same sign out-of-sample AND has a bootstrap CI that excludes zero — all three, not one.
      </p>
    </div>
  );
}
