"use client";

import { useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { MacroRegimeBanner } from "./MacroRegimeBanner";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { VwapBacktestSignalType, VwapReversionBacktestResult } from "@/lib/agents/trading-agent/types";

const SIGNAL_OPTIONS: { value: VwapBacktestSignalType; label: string }[] = [
  { value: "vwapMeanReversionOversold", label: "VWAP Mean Reversion — Oversold" },
  { value: "vwapMeanReversionOverbought", label: "VWAP Mean Reversion — Overbought" },
];

const DAYS_OPTIONS = [30, 60, 90, 180];

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}

function fmtRatio(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
}

function fmtBars(v: number | null): string {
  return v !== null ? `${v} bar(s)` : "N/A";
}

const TRADE_LOG_DISPLAY_LIMIT = 50;
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

/**
 * Intraday counterpart to HistoricalBacktestTab — same statistical pipeline
 * (BH-FDR, bootstrap CI, out-of-sample split), but horizons are 5-min bars
 * within a single session, not trading days, and there's no stop-loss/
 * liquidity-zone overlay (the session close already bounds every
 * occurrence — see types.ts's VWAP Mean Reversion Backtest section for why
 * this is a separate, smaller component rather than folded into the daily
 * one).
 */
export function VwapReversionBacktestTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [signal, setSignal] = useState<VwapBacktestSignalType>("vwapMeanReversionOversold");
  const [days, setDays] = useState(90);
  const [result, setResult] = useState<VwapReversionBacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  async function runBacktest(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/vwap-reversion-backtest?ticker=${encodeURIComponent(ticker)}&signal=${signal}&days=${days}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Backtest", symbol: ticker, metadata: { endpoint: "vwap-reversion-backtest", status: res.status } });
      } else {
        const r = json as VwapReversionBacktestResult;
        setResult(r);
        const passesAllThreeBars = r.horizons?.some((h) => h.passesAllThreeBars) ?? false;
        track("backtest_run", { tab: "Backtest", symbol: ticker, metadata: { study: "vwap-reversion", signal, days, passesAllThreeBars } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Backtest", symbol: ticker, metadata: { endpoint: "vwap-reversion-backtest", status: 0 } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <MacroRegimeBanner />
      <p className="jv-lede">
        Walks real 5-min intraday bars, session by session, computing when price crosses today&apos;s own
        VWAP &plusmn;2 std-dev band and measuring what actually happened afterward — same statistical rigor as
        the daily Signal Backtest (Benjamini-Hochberg FDR correction, bootstrap confidence intervals,
        time-based out-of-sample split), but bar-indexed within a single session instead of day-indexed.
      </p>

      <form onSubmit={runBacktest} className="flex flex-wrap gap-3 mb-6">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input w-32" />
        <select value={signal} onChange={(e) => setSignal(e.target.value as VwapBacktestSignalType)} className="jv-select">
          {SIGNAL_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="jv-select">
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
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
            {result.lookbackDays} day(s): {result.sessionsScanned} session(s) scanned, {result.signalOccurrences}{" "}
            signal occurrence(s) found.
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
                  <tr key={h.horizonBars} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{h.horizonLabel}</td>
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
            Minimum bar before treating any horizon as a real edge rather than noise: passes FDR correction AND
            holds the same sign out-of-sample AND has a bootstrap CI that excludes zero — all three, not one.
          </p>

          {result.reversionStats && (
            <div className="jv-card">
              <div className="jv-br-b" />
              <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                Reversion Timing (Same Session Only)
              </div>
              <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                Of {result.reversionStats.occurrencesTracked} occurrence(s), {result.reversionStats.occurrencesReverted}{" "}
                reverted back to VWAP before that session&apos;s close; {result.reversionStats.occurrencesNeverReverted}{" "}
                did not — VWAP resets each session, so reversion tracking never crosses into the next day.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="jv-label">Mean Bars to Revert</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>
                    {fmtBars(result.reversionStats.meanBarsToRevert !== null ? Math.round(result.reversionStats.meanBarsToRevert) : null)}
                  </div>
                </div>
                <div>
                  <div className="jv-label">Median Bars to Revert</div>
                  <div className="font-mono" style={{ color: "var(--text-0)" }}>
                    {fmtBars(result.reversionStats.medianBarsToRevert !== null ? Math.round(result.reversionStats.medianBarsToRevert) : null)}
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
              <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                1 bar = 5 minutes. &quot;Further Move&quot; = how much further price drifted from VWAP after the
                signal fired, before turning around (or the session ended).
              </p>
            </div>
          )}

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
                    <th className={TH_CLASS}>Entry Time</th>
                    <th className={TH_CLASS}>Entry Price</th>
                    <th className={TH_CLASS}>Entry Deviation</th>
                    <th className={TH_CLASS}>Returns by Horizon</th>
                    <th className={TH_CLASS}>Win/Loss</th>
                    <th className={TH_CLASS}>Bars to Revert</th>
                    <th className={TH_CLASS}>Max Further Move</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tradeLog.slice(-TRADE_LOG_DISPLAY_LIMIT).map((row, idx) => (
                    <tr key={`${row.dateKey}-${row.entryTimeClock}-${idx}`} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.entryTimeClock}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>${row.entryPrice.toFixed(2)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.entryDeviationPct)}</td>
                      <td className={`${TD_CLASS} text-xs font-mono`} style={{ color: "var(--text-2)" }}>
                        {row.returnsByHorizon.map((r) => `${r.horizonLabel}: ${fmtPct(r.returnPct)}`).join(" · ")}
                      </td>
                      <td className={TD_CLASS}>
                        {row.isWin === null ? (
                          <span style={{ color: "var(--text-2)" }}>N/A</span>
                        ) : (
                          <span className={`jv-badge ${row.isWin ? "c-signal" : "c-danger"}`}>{row.isWin ? "win" : "loss"}</span>
                        )}
                      </td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtBars(row.barsToRevert)}</td>
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
