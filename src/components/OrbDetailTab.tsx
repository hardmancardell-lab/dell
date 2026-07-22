"use client";

import { useState } from "react";
import { ORB_LOOKBACK_MONTH_OPTIONS } from "@/lib/agents/trading-agent/constants";
import { GlossaryTerm } from "./GlossaryTerm";
import type { OrbTickerResult } from "@/lib/agents/trading-agent/types";

const RANGE_OPTIONS: (5 | 15 | 30)[] = [5, 15, 30];

const HORIZON_LABELS: Record<string, string> = {
  "30minAfterBreakout": "+30min",
  "60minAfterBreakout": "+60min",
  holdToEod: "Hold to EOD",
};

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}

function fmtPrice(v: number | null): string {
  return v !== null ? `$${v.toFixed(2)}` : "N/A";
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
  if (row.dayHigh !== null) parts.push(`High: ${fmtPrice(row.dayHigh)}${row.dayHighTimeClock ? ` @ ${row.dayHighTimeClock}` : ""}`);
  if (row.dayLow !== null) parts.push(`Low: ${fmtPrice(row.dayLow)}${row.dayLowTimeClock ? ` @ ${row.dayLowTimeClock}` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "N/A";
}

const TRADE_LOG_DISPLAY_LIMIT = 50;

export function OrbDetailTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [openingRangeMinutes, setOpeningRangeMinutes] = useState<5 | 15 | 30>(15);
  const [lookbackMonths, setLookbackMonths] = useState(3);
  const [result, setResult] = useState<OrbTickerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function runBacktest(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/orb-backtest?ticker=${encodeURIComponent(ticker)}&openingRangeMinutes=${openingRangeMinutes}&lookbackMonths=${lookbackMonths}`
      );
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as OrbTickerResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Opening Range Breakout — the high/low of the first N minutes after the open defines the
        range; a breakout fires the first time price closes beyond it. Backtested with the same
        FDR/bootstrap/out-of-sample rigor as the equity Backtest tab, long and short breakouts
        kept separate since their edge is expected to differ.
      </p>

      <form onSubmit={runBacktest} className="flex flex-wrap gap-3 mb-6">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm w-32"
        />
        <select
          value={openingRangeMinutes}
          onChange={(e) => setOpeningRangeMinutes(Number(e.target.value) as 5 | 15 | 30)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {RANGE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}min range
            </option>
          ))}
        </select>
        <select
          value={lookbackMonths}
          onChange={(e) => setLookbackMonths(Number(e.target.value))}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {ORB_LOOKBACK_MONTH_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
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
          {result.ticker.includes("/") && (
            <div className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400">
              The opening range is built around a single NYSE/Nasdaq session open (9:30am ET).
              Spot forex trades 24/5 with no single daily open, so this concept doesn&apos;t map
              cleanly onto currency pairs — read these results as an approximation using 9:30am
              ET as an arbitrary anchor time, not a true session-open breakout the way it is for
              equities.
            </div>
          )}
          <div className="text-sm text-zinc-500">
            {result.ticker} — {result.openingRangeMinutes}min range over {result.lookbackMonths} month(s):{" "}
            {result.tradingDaysScanned} trading days scanned ({result.longOccurrences} long breakouts,{" "}
            {result.shortOccurrences} short breakouts).
          </div>

          {result.todaySnapshot && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Session</div>
                <div className="font-medium">{result.todaySnapshot.dateKey}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Opening Range</div>
                <div className="font-medium">
                  {fmtPrice(result.todaySnapshot.openingRangeLow)} - {fmtPrice(result.todaySnapshot.openingRangeHigh)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Breakout</div>
                <div className="font-medium capitalize">{result.todaySnapshot.breakoutDirection ?? "N/A"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">Breakout Time</div>
                <div className="font-medium">{result.todaySnapshot.breakoutTimeClock ?? "N/A"}</div>
              </div>
            </div>
          )}

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
                  <th className="py-2 pr-4">Direction</th>
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
                  <tr key={`${h.direction}-${h.horizonLabel}`} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium capitalize">{h.direction}</td>
                    <td className="py-2 pr-4">{HORIZON_LABELS[h.horizonLabel]}</td>
                    <td className="py-2 pr-4 text-zinc-500">{h.sampleSize}</td>
                    <td className="py-2 pr-4">{fmtPct(h.meanReturnPct)}</td>
                    <td className="py-2 pr-4">{fmtPct(h.medianReturnPct)}</td>
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
            Reported returns are strategy returns (positive = profitable for that direction), not
            raw price change. Entry is modeled at the breakout bar&apos;s close — no slippage or
            intrabar-fill assumption.
          </p>

          <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
            <summary className="text-sm font-medium cursor-pointer">Trade Log ({result.tradeLog.length} occurrences)</summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Date</th>
                    <th className="py-2 pr-4">Direction</th>
                    <th className="py-2 pr-4">Entry Price</th>
                    <th className="py-2 pr-4">Breakout Time</th>
                    <th className="py-2 pr-4">+30min</th>
                    <th className="py-2 pr-4">+60min</th>
                    <th className="py-2 pr-4">Hold to EOD</th>
                    <th className="py-2 pr-4">Win/Loss</th>
                    <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${row.direction}-${i}`} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                      <td className="py-2 pr-4 text-zinc-500 capitalize">{row.direction}</td>
                      <td className="py-2 pr-4 text-zinc-500">{fmtPrice(row.entryPrice)}</td>
                      <td className="py-2 pr-4 text-zinc-500">{row.breakoutTimeClock}</td>
                      <td className="py-2 pr-4 text-zinc-500">{fmtPct(row.returnPct30min)}</td>
                      <td className="py-2 pr-4 text-zinc-500">{fmtPct(row.returnPct60min)}</td>
                      <td className="py-2 pr-4">{fmtPct(row.returnPctEod)}</td>
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
