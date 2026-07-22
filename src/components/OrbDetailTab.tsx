"use client";

import { useState } from "react";
import { ORB_LOOKBACK_MONTH_OPTIONS } from "@/lib/agents/trading-agent/constants";
import { GlossaryTerm } from "./GlossaryTerm";
import type { OrbTickerResult } from "@/lib/agents/trading-agent/types";

const RANGE_OPTIONS: (5 | 15 | 30)[] = [5, 15, 30];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

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

/** Reused across Equities/Currency/Futures/Commodities' own ORB Ticker Detail tabs — a single .jarvis island here upgrades all four. */
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
    <div className="jarvis">
      <p className="jv-lede">
        Opening Range Breakout — the high/low of the first N minutes after the open defines the range; a
        breakout fires the first time price closes beyond it. Backtested with the same FDR/bootstrap/
        out-of-sample rigor as the equity Backtest tab, long and short breakouts kept separate since their
        edge is expected to differ.
      </p>

      <form onSubmit={runBacktest} className="flex flex-wrap gap-3 mb-6">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input w-32" />
        <select value={openingRangeMinutes} onChange={(e) => setOpeningRangeMinutes(Number(e.target.value) as 5 | 15 | 30)} className="jv-select">
          {RANGE_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m}min range
            </option>
          ))}
        </select>
        <select value={lookbackMonths} onChange={(e) => setLookbackMonths(Number(e.target.value))} className="jv-select">
          {ORB_LOOKBACK_MONTH_OPTIONS.map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? "s" : ""}
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
          {result.ticker.includes("/") && (
            <div className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              The opening range is built around a single NYSE/Nasdaq session open (9:30am ET). Spot forex
              trades 24/5 with no single daily open, so this concept doesn&apos;t map cleanly onto currency
              pairs — read these results as an approximation using 9:30am ET as an arbitrary anchor time,
              not a true session-open breakout the way it is for equities.
            </div>
          )}
          <div className="text-sm" style={{ color: "var(--text-2)" }}>
            {result.ticker} — {result.openingRangeMinutes}min range over {result.lookbackMonths} month(s):{" "}
            {result.tradingDaysScanned} trading days scanned ({result.longOccurrences} long breakouts,{" "}
            {result.shortOccurrences} short breakouts).
          </div>

          {result.todaySnapshot && (
            <div className="jv-card grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="jv-br-b" />
              <div>
                <div className="jv-label">Session</div>
                <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.todaySnapshot.dateKey}</div>
              </div>
              <div>
                <div className="jv-label">Opening Range</div>
                <div className="font-mono" style={{ color: "var(--text-0)" }}>
                  {fmtPrice(result.todaySnapshot.openingRangeLow)} - {fmtPrice(result.todaySnapshot.openingRangeHigh)}
                </div>
              </div>
              <div>
                <div className="jv-label">Breakout</div>
                <div className="font-mono capitalize" style={{ color: "var(--text-0)" }}>{result.todaySnapshot.breakoutDirection ?? "N/A"}</div>
              </div>
              <div>
                <div className="jv-label">Breakout Time</div>
                <div className="font-mono" style={{ color: "var(--text-0)" }}>{result.todaySnapshot.breakoutTimeClock ?? "N/A"}</div>
              </div>
            </div>
          )}

          {result.dataLimitations.map((d) => (
            <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
              {d}
            </div>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className={TH_CLASS}>Direction</th>
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
                  <tr key={`${h.direction}-${h.horizonLabel}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className={`${TD_CLASS} font-medium font-mono capitalize`} style={{ color: "var(--text-0)" }}>{h.direction}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{HORIZON_LABELS[h.horizonLabel]}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{h.sampleSize}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(h.meanReturnPct)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(h.medianReturnPct)}</td>
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
            Reported returns are strategy returns (positive = profitable for that direction), not raw price
            change. Entry is modeled at the breakout bar&apos;s close — no slippage or intrabar-fill
            assumption.
          </p>

          <details className="jv-card">
            <div className="jv-br-b" />
            <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
              Trade Log ({result.tradeLog.length} occurrences)
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Direction</th>
                    <th className={TH_CLASS}>Entry Price</th>
                    <th className={TH_CLASS}>Breakout Time</th>
                    <th className={TH_CLASS}>+30min</th>
                    <th className={TH_CLASS}>+60min</th>
                    <th className={TH_CLASS}>Hold to EOD</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, i) => (
                    <tr key={`${row.dateKey}-${row.direction}-${i}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono capitalize`} style={{ color: "var(--text-2)" }}>{row.direction}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPrice(row.entryPrice)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.breakoutTimeClock}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.returnPct30min)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.returnPct60min)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(row.returnPctEod)}</td>
                      <td className={TD_CLASS}>
                        {row.isWin === null ? (
                          <span style={{ color: "var(--text-2)" }}>N/A</span>
                        ) : (
                          <span className={`jv-badge ${row.isWin ? "c-signal" : "c-danger"}`}>{row.isWin ? "win" : "loss"}</span>
                        )}
                      </td>
                      <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
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
