"use client";

import { useState } from "react";
import { StatCard } from "./StatCard";
import type { CorporateBuybackOfferingResult } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}%` : "N/A";
}

function fmtUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

export function CorporateBuybackOfferingTab() {
  const [ticker, setTicker] = useState("AAPL");
  const [result, setResult] = useState<CorporateBuybackOfferingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/corporate-buyback-offering?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as CorporateBuybackOfferingResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Two separate real event studies for {ticker || "a ticker"}: (1) how the stock has actually reacted to its own
        real, filed securities offerings (SEC EDGAR 424B-series/S-1/S-3 filings), and (2) its real quarterly buyback
        disclosures (FMP&apos;s cash-flow statement) alongside that filing date&apos;s price move. Deliberately
        simpler statistics than the Treasury Buyback Anomaly tool — see the disclosures below for exactly why.
      </p>
      <div className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
        Confirmed against real data: these SEC form types register equity <strong>or</strong> debt securities — a
        company that regularly issues corporate bonds will show real bond offerings here, not equity dilution. Click
        into a filing before treating any event as a real dilution event.
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input w-28" />
        </div>
        <button onClick={run} disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </div>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          {result.marketModel && (
            <div>
              <h3 className="jv-strip-title mb-2">Market Model</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard label="Benchmark" value={result.marketModel.benchmarkTicker} sub="broad equity-market proxy" />
                <StatCard label="Beta" value={result.marketModel.beta.toFixed(3)} />
                <StatCard label="Alpha" value={`${result.marketModel.alpha >= 0 ? "+" : ""}${result.marketModel.alpha.toFixed(4)}%/day`} />
                <StatCard label="R² / n" value={`${result.marketModel.rSquared.toFixed(3)} / ${result.marketModel.n}`} />
              </div>
            </div>
          )}

          <div>
            <h3 className="jv-strip-title mb-2">Secondary/Follow-On Offerings — Average Reaction</h3>
            <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
              Bootstrap 95% CI on the mean % move across every real matched offering filing — not a regression against
              offering size, since SEC filings don&apos;t disclose a structured dollar amount for the raise.
            </p>
            {result.offeringEvents.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>No matched offering filings — see disclosures below.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Day 0 (raw)", stats: result.offeringDay0Stats },
                  { label: "Day 0 (abnormal)", stats: result.offeringDay0AbnormalStats },
                  { label: "Day +1 (raw)", stats: result.offeringDay1Stats },
                  { label: "Day +1 (abnormal)", stats: result.offeringDay1AbnormalStats },
                ].map(({ label, stats }) => (
                  <StatCard
                    key={label}
                    label={label}
                    value={stats?.mean !== null && stats?.mean !== undefined ? fmtPct(stats.mean) : "N/A"}
                    sub={
                      stats?.lower !== null && stats?.lower !== undefined && stats.upper !== null
                        ? `95% CI: ${fmtPct(stats.lower)} to ${fmtPct(stats.upper)}${stats.ciExcludesZero ? " — significant" : ""}`
                        : undefined
                    }
                    tone={stats?.ciExcludesZero ? (stats.mean! >= 0 ? "up" : "down") : "neutral"}
                  />
                ))}
              </div>
            )}
          </div>

          {result.offeringEvents.length > 0 && (
            <div className="overflow-x-auto">
              <h3 className="jv-strip-title mb-2">Matched Offering Filings ({result.offeringEvents.length})</h3>
              <table className="jv-table">
                <thead>
                  <tr>
                    <th className="text-left">Filing Date</th>
                    <th className="text-left">Form</th>
                    <th className="text-right">Day 0 Raw</th>
                    <th className="text-right">Day 0 Abnormal</th>
                    <th className="text-right">Day +1 Raw</th>
                    <th className="text-right">Day +1 Abnormal</th>
                    <th className="text-left">Filing</th>
                  </tr>
                </thead>
                <tbody>
                  {result.offeringEvents.map((e) => (
                    <tr key={e.filingDate + e.formType}>
                      <td>{e.filingDate}</td>
                      <td style={{ color: "var(--text-2)" }}>{e.formType}</td>
                      <td className={`jv-num ${e.day0ReturnPct >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day0ReturnPct)}</td>
                      <td className={`jv-num ${(e.day0AbnormalReturnPct ?? 0) >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day0AbnormalReturnPct)}</td>
                      <td className={`jv-num ${e.day1ReturnPct >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day1ReturnPct)}</td>
                      <td className={`jv-num ${(e.day1AbnormalReturnPct ?? 0) >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day1AbnormalReturnPct)}</td>
                      <td>
                        <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline text-xs" style={{ color: "var(--text-2)" }}>
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 className="jv-strip-title mb-2">Quarterly Buyback Disclosures</h3>
            <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
              Real repurchase dollar amounts from {ticker}&apos;s own quarterly cash-flow statement, shown plainly
              (no regression — too few periods on FMP&apos;s free tier for a reliable fit).
            </p>
            {result.buybackDisclosures.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>No repurchase activity found in the available quarters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="jv-table">
                  <thead>
                    <tr>
                      <th className="text-left">Period End</th>
                      <th className="text-left">Filing Date</th>
                      <th className="text-right">Repurchased</th>
                      <th className="text-right">Filing-Day Move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.buybackDisclosures.map((d) => (
                      <tr key={d.periodEndDate}>
                        <td>{d.periodEndDate}</td>
                        <td style={{ color: "var(--text-2)" }}>{d.filingDate}</td>
                        <td className="jv-num">{fmtUsd(d.repurchasedUsd)}</td>
                        <td className={`jv-num ${d.day0ReturnPct === null ? "" : d.day0ReturnPct >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>
                          {d.day0ReturnPct !== null ? fmtPct(d.day0ReturnPct) : "N/A"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {result.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
