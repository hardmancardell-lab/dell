"use client";

import { useState } from "react";
import { GlossaryTerm } from "./GlossaryTerm";
import { StatCard } from "./StatCard";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { SessionAnalysisResult, SessionSequenceBucketResult } from "@/lib/agents/trading-agent/types";

const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";
const LOOKBACK_OPTIONS = [30, 60, 90, 180];

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}%` : "N/A";
}
function fmtP(v: number | null): string {
  return v !== null ? v.toFixed(4) : "N/A";
}
function fmtRatio(v: number | null): string {
  return v !== null ? v.toFixed(2) : "N/A";
}

function bucketLabel(b: SessionSequenceBucketResult): string {
  return `${b.edgeLabel} (prior ${b.priorDirection})`;
}

/**
 * Real trading-session boundaries (Asian/London/New York, defined in UTC —
 * see time-windows.ts's SESSIONS) plus a genuine test of whether sessions
 * behave as a linear sequence: does a session's real direction predict the
 * next session's return. Same BH-FDR/bootstrap/out-of-sample statistical
 * pipeline as Calendar Effects, applied to session-sequence buckets.
 */
export function SessionAnalysisTab({ defaultTicker = "EUR/USD" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const [lookbackDays, setLookbackDays] = useState(90);
  const [result, setResult] = useState<SessionAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { track } = useTrackEvent();

  async function runAnalysis(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/session-analysis?ticker=${encodeURIComponent(ticker)}&lookbackDays=${lookbackDays}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Session Analysis", symbol: ticker, metadata: { endpoint: "session-analysis", status: res.status } });
      } else {
        const r = json as SessionAnalysisResult;
        setResult(r);
        track("session_analysis_run", {
          tab: "Session Analysis",
          symbol: ticker,
          metadata: { lookbackDays, passesAllThreeBars: r.sequenceBuckets.some((b) => b.passesAllThreeBars) },
        });
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
        Real trading-session boundaries (Asian 00:00-09:00 UTC, London 08:00-17:00 UTC, New York 13:00-22:00
        UTC — the standard industry convention, not this app&apos;s Eastern-Time equity-session windows) plus a
        genuine test of whether sessions behave as a linear sequence: does a session&apos;s real direction
        predict the next session&apos;s return. Same Benjamini-Hochberg FDR correction, bootstrap confidence
        intervals, and time-based out-of-sample split used everywhere else in this app.
      </p>

      <form onSubmit={runAnalysis} className="flex flex-wrap gap-3 items-end my-4">
        <div>
          <label className="jv-label block mb-1">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value)} className="jv-input" placeholder="EUR/USD" />
        </div>
        <div>
          <label className="jv-label block mb-1">Lookback (days)</label>
          <select value={lookbackDays} onChange={(e) => setLookbackDays(Number(e.target.value))} className="jv-select">
            {LOOKBACK_OPTIONS.map((d) => (
              <option key={d} value={d}>
                {d}d
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </form>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="text-sm">{error}</div>
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {result.sessionStats.map((s) => (
              <StatCard
                key={s.sessionId}
                label={s.label}
                value={fmtPct(s.meanReturnPct)}
                sub={`avg range ${s.meanRangePct !== null ? s.meanRangePct.toFixed(3) + "%" : "N/A"} · n=${s.sampleSize}`}
                tone={s.meanReturnPct === null ? "neutral" : s.meanReturnPct >= 0 ? "up" : "down"}
              />
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className={TH_CLASS}>Sequence Edge</th>
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
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {result.sequenceBuckets.map((b) => (
                  <tr key={bucketLabel(b)} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                    <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{bucketLabel(b)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{b.sampleSize}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(b.meanReturnPct)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{fmtPct(b.medianReturnPct)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(b.pValue)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtP(b.pValueFdrAdjusted)}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                      {b.bootstrapCiLower !== null && b.bootstrapCiUpper !== null
                        ? `[${b.bootstrapCiLower.toFixed(2)}, ${b.bootstrapCiUpper.toFixed(2)}]`
                        : "N/A"}
                    </td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>
                      {b.sameSignOutOfSample === null ? "N/A" : b.sameSignOutOfSample ? "yes" : "no"}
                    </td>
                    <td className={TD_CLASS}>
                      <span className={`jv-badge ${b.passesAllThreeBars ? "c-signal" : "c-neutral"}`}>{b.passesAllThreeBars ? "yes" : "no"}</span>
                    </td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{b.winRate !== null ? `${b.winRate.toFixed(1)}%` : "N/A"}</td>
                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtRatio(b.profitFactor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.dataLimitations.length > 0 && (
            <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
              <div className="jv-label" style={{ color: "var(--verdict)" }}>Data Limitations</div>
              <ul className="text-sm mt-1 list-disc pl-5" style={{ color: "var(--text-1)" }}>
                {result.dataLimitations.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
