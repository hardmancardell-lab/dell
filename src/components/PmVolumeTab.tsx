"use client";

import { useState, type ReactNode } from "react";
import { SECTOR_CONSTITUENTS } from "@/lib/agents/research-agent/skills/sector-fundamentals";
import { GlossaryTerm } from "./GlossaryTerm";
import { PriceChart } from "./PriceChart";
import type {
  OptionsChainSummary,
  PmVolumeAnomalyReport,
  SectorScanSummary,
} from "@/lib/agents/trading-agent/types";

// Reuses the same curated ticker list Sector Fundamentals/Research Sources
// use (no node:fs-chain dependency, so it's safe to import client-side) —
// filtered to sectors that actually have tickers to scan.
const SCANNABLE_SECTORS = Object.keys(SECTOR_CONSTITUENTS).filter(
  (s) => SECTOR_CONSTITUENTS[s].length > 0
);

function StatCard({ label, value, sub }: { label: ReactNode; value: string; sub?: string }) {
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 18 }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function fmtDayContext(row: {
  overnightGapPct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
}): string {
  const parts: string[] = [];
  if (row.overnightGapPct !== null) parts.push(`Gap: ${row.overnightGapPct >= 0 ? "+" : ""}${row.overnightGapPct.toFixed(2)}%`);
  if (row.dayHigh !== null) parts.push(`High: $${row.dayHigh.toFixed(2)}${row.dayHighTimeClock ? ` @ ${row.dayHighTimeClock}` : ""}`);
  if (row.dayLow !== null) parts.push(`Low: $${row.dayLow.toFixed(2)}${row.dayLowTimeClock ? ` @ ${row.dayLowTimeClock}` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "N/A";
}

function AnomalyBadge({ isAnomaly }: { isAnomaly: boolean }) {
  return <span className={`jv-badge ${isAnomaly ? "c-signal" : "c-neutral"}`}>{isAnomaly ? "Anomaly" : "Normal"}</span>;
}

const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

/** Reused across Equities/Currency/Futures/Commodities' own PM-Volume Tracker tabs — a single .jarvis island here upgrades all four. */
export function PmVolumeTab() {
  const [ticker, setTicker] = useState("");
  const [report, setReport] = useState<PmVolumeAnomalyReport | null>(null);
  const [chain, setChain] = useState<OptionsChainSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [selectedHighBucket, setSelectedHighBucket] = useState<string | null>(null);
  const [showAllDrilldownCharts, setShowAllDrilldownCharts] = useState(false);

  const [selectedSector, setSelectedSector] = useState(SCANNABLE_SECTORS[0] ?? "");
  const [sectorSummaries, setSectorSummaries] = useState<SectorScanSummary[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);

  async function runSectorScan() {
    if (!selectedSector) return;
    setScanLoading(true);
    setScanError(null);
    setSectorSummaries(null);
    try {
      const res = await fetch(`/api/pm-volume-scan?sector=${encodeURIComponent(selectedSector)}`);
      const json = await res.json();
      if (!res.ok) {
        setScanError(json.error ?? "Unknown error");
      } else {
        setSectorSummaries([json as SectorScanSummary]);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanLoading(false);
    }
  }

  async function runMarketScan() {
    setScanLoading(true);
    setScanError(null);
    setSectorSummaries(null);
    try {
      const res = await fetch(`/api/pm-volume-scan?sector=market`);
      const json = await res.json();
      if (!res.ok) {
        setScanError(json.error ?? "Unknown error");
      } else {
        setSectorSummaries(json.summaries as SectorScanSummary[]);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setScanLoading(false);
    }
  }

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setChain(null);
    setFocusedDate(null);
    setSelectedHighBucket(null);
    setShowAllDrilldownCharts(false);
    try {
      const [reportRes, chainRes] = await Promise.all([
        fetch(`/api/pm-volume?ticker=${encodeURIComponent(ticker)}`),
        fetch(`/api/options-chain?ticker=${encodeURIComponent(ticker)}`),
      ]);
      const reportJson = await reportRes.json();
      if (!reportRes.ok) {
        setError(reportJson.error ?? "Unknown error");
      } else {
        setReport(reportJson as PmVolumeAnomalyReport);
      }
      const chainJson = await chainRes.json();
      if (chainRes.ok) {
        setChain(chainJson as OptionsChainSummary);
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
        Flags when today&apos;s pre-market volume crosses 4x its rolling average, then runs a historical
        composite of how the ticker behaved at key times of day the prior times this happened.
      </p>

      <form onSubmit={runCheck} className="flex gap-3">
        <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker, e.g. AAPL" className="jv-input flex-1" />
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {error && (
        <div className="jv-card mt-8" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          <div className="font-medium">Could not load data</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      <div className="mt-10 pt-10" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="jv-strip-title">Sector / Market Scan</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-2)" }}>
          Scans a curated bellwether ticker list (the same one Sector Fundamentals uses) for the same 4x
          pre-market volume anomaly, so you don&apos;t have to check tickers one at a time. Not a live
          market-cap screen — see Research Sources for why.
        </p>
        <div className="flex flex-wrap gap-3 mb-6">
          <select value={selectedSector} onChange={(e) => setSelectedSector(e.target.value)} className="jv-select">
            {SCANNABLE_SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button onClick={runSectorScan} disabled={scanLoading} className="jv-btn">
            {scanLoading ? "Scanning…" : "Scan Sector"}
          </button>
          <button onClick={runMarketScan} disabled={scanLoading} className="jv-btn-outline">
            {scanLoading ? "Scanning…" : "Scan Market (all sectors)"}
          </button>
        </div>

        {scanError && (
          <div className="jv-card mb-4" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {scanError}
          </div>
        )}

        {sectorSummaries && (
          <div className="flex flex-col gap-6">
            {sectorSummaries.map((summary) => (
              <div key={summary.sector}>
                <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
                  {summary.sector} — {summary.tickersScanned} scanned, {summary.tickersFlagged} flagged
                </div>
                {summary.dataLimitations.map((d) => (
                  <div key={d.slice(0, 30)} className="jv-card text-xs mb-2" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                    {d}
                  </div>
                ))}
                {summary.results.filter((r) => r.isAnomaly).length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>
                    No tickers crossed the anomaly threshold.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {summary.results
                      .filter((r) => r.isAnomaly)
                      .map((r) => (
                        <div key={r.ticker} className="flex items-center justify-between text-sm px-3 py-2" style={{ border: "1px solid var(--line)", background: "var(--ink-800)" }}>
                          <span className="font-mono font-medium" style={{ color: "var(--text-0)" }}>{r.ticker}</span>
                          <span style={{ color: "var(--text-2)" }}>
                            {r.multiple !== null ? `${r.multiple.toFixed(1)}x` : "N/A"} (threshold: {r.anomalyThreshold}x)
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {report && (
        <div className="mt-8 flex flex-col gap-10">
          <div className="jv-verdict-panel">
            <div className="flex items-center justify-between">
              <div className="jv-vp-label" style={{ marginBottom: 0 }}>
                <span className="jv-dot" aria-hidden="true" />
                {report.ticker} &mdash; {report.snapshot.asOfDateKey}
              </div>
              <AnomalyBadge isAnomaly={report.snapshot.isAnomaly} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <StatCard label="Today's PM Volume" value={report.snapshot.todayPremarketVolume.toLocaleString()} />
              <StatCard
                label="Rolling Average"
                value={report.snapshot.rollingAverageVolume !== null ? Math.round(report.snapshot.rollingAverageVolume).toLocaleString() : "N/A"}
                sub={`${report.snapshot.lookbackDays} day(s)`}
              />
              <StatCard
                label="Multiple"
                value={report.snapshot.multiple !== null ? `${report.snapshot.multiple.toFixed(1)}x` : "N/A"}
                sub={`Anomaly threshold: ${report.snapshot.anomalyThreshold}x`}
              />
            </div>
          </div>

          {report.dataLimitations.length > 0 && (
            <div className="flex flex-col gap-2">
              {report.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                  {d}
                </div>
              ))}
            </div>
          )}

          {report.composite && (
            <>
              <section>
                <div className="jv-strip-title">
                  Historical Composite ({report.composite.anomalyDaysFound} prior anomaly day(s) found)
                </div>
                <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
                  Scanned {report.composite.tradingDaysScanned} trading days over the lookback window.
                </p>
                <div className="flex flex-col gap-3">
                  {report.composite.checkpoints.map((c) => (
                    <div key={c.checkpoint} className="jv-card">
                      <div className="jv-br-b" />
                      <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{c.label}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                        <StatCard label={<GlossaryTerm term="winRate">Probability Up</GlossaryTerm>} value={c.probabilityUp !== null ? `${c.probabilityUp.toFixed(0)}%` : "N/A"} />
                        <StatCard label="Avg Move" value={c.averageMovePct !== null ? `${c.averageMovePct.toFixed(2)}%` : "N/A"} />
                        <StatCard label="Median Move" value={c.medianMovePct !== null ? `${c.medianMovePct.toFixed(2)}%` : "N/A"} />
                      </div>
                      {(c.profitFactor !== null || c.maxDrawdownPct !== null) && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                          <StatCard label={<GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm>} value={c.profitFactor !== null ? c.profitFactor.toFixed(2) : "N/A"} />
                          <StatCard label={<GlossaryTerm term="maxDrawdown">Max Drawdown</GlossaryTerm>} value={c.maxDrawdownPct !== null ? `${c.maxDrawdownPct.toFixed(2)}%` : "N/A"} />
                          <StatCard
                            label="Largest Win / Loss"
                            value={`${c.largestWinPct !== null ? `+${c.largestWinPct.toFixed(2)}%` : "N/A"} / ${c.largestLossPct !== null ? `${c.largestLossPct.toFixed(2)}%` : "N/A"}`}
                          />
                        </div>
                      )}
                      <div className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                        Sample size: {c.sampleSize}
                        {c.note ? ` — ${c.note}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {focusedDate && (
                <div className="jv-card">
                  <div className="jv-br-b" />
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                      Chart — {report.ticker} around {focusedDate}
                    </div>
                    <button onClick={() => setFocusedDate(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                      ✕ Close
                    </button>
                  </div>
                  <PriceChart key={focusedDate} symbol={report.ticker} focusDate={focusedDate} />
                </div>
              )}

              <details className="jv-card">
                <div className="jv-br-b" />
                <summary className="text-sm font-medium cursor-pointer" style={{ color: "var(--text-0)" }}>
                  Trade Log ({report.composite.tradeLog.length} occurrences) — click a row to jump the chart to that date
                </summary>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                        <th className={TH_CLASS}>Date</th>
                        <th className={TH_CLASS}>Checkpoint</th>
                        <th className={TH_CLASS}>Return</th>
                        <th className={TH_CLASS}>Win/Loss</th>
                        <th className={TH_CLASS}>Overnight Gap / Day Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.composite.tradeLog.slice(-50).map((row, i) => (
                        <tr
                          key={`${row.dateKey}-${row.checkpoint}-${i}`}
                          onClick={() => setFocusedDate(row.dateKey)}
                          style={{
                            borderBottom: "1px solid var(--ink-800)",
                            cursor: "pointer",
                            background: focusedDate === row.dateKey ? "var(--ink-800)" : undefined,
                          }}
                        >
                          <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                          <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.checkpoint}</td>
                          <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-1)" }}>{row.returnPct >= 0 ? "+" : ""}{row.returnPct.toFixed(2)}%</td>
                          <td className={TD_CLASS}>
                            <span className={`jv-badge ${row.isWin ? "c-signal" : "c-danger"}`}>{row.isWin ? "win" : "loss"}</span>
                          </td>
                          <td className={`${TD_CLASS} text-xs`} style={{ color: "var(--text-2)" }}>{fmtDayContext(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.composite.tradeLog.length > 50 && (
                    <p className="text-xs mt-2" style={{ color: "var(--text-2)" }}>
                      Showing the most recent 50 of {report.composite.tradeLog.length} occurrences.
                    </p>
                  )}
                </div>
              </details>

              <section>
                <div className="jv-strip-title">Low / High of Day Timing</div>
                <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
                  Buckets are 30-minute windows across the regular session, listed in time order (not
                  frequency order). % is of all {report.composite.anomalyDaysFound} anomaly day(s) found.
                  {report.composite.highOfDayBefore1030Pct !== null && (
                    <>
                      {" "}
                      High of day landed before 10:30am on{" "}
                      <b style={{ fontFamily: "var(--font-mono)", color: "var(--text-0)" }}>
                        {report.composite.highOfDayBefore1030Pct.toFixed(0)}%
                      </b>{" "}
                      of those days.
                    </>
                  )}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="jv-card">
                    <div className="jv-br-b" />
                    <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>Low of Day</div>
                    <div className="flex flex-col gap-1">
                      {report.composite.lowOfDayDistribution.map((f) => (
                        <div key={f.bucketLabel} className="jv-stat">
                          <span>{f.bucketLabel}</span>
                          <b>
                            {f.count} <span style={{ color: "var(--text-2)", fontWeight: 400 }}>({f.pctOfTotal.toFixed(0)}%)</span>
                          </b>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="jv-card">
                    <div className="jv-br-b" />
                    <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
                      High of Day <span style={{ color: "var(--text-2)", fontWeight: 400 }}>— click a bucket to drill in</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {report.composite.highOfDayDistribution.map((f) => (
                        <button
                          key={f.bucketLabel}
                          onClick={() => {
                            setSelectedHighBucket((cur) => (cur === f.bucketLabel ? null : f.bucketLabel));
                            setShowAllDrilldownCharts(false);
                          }}
                          className="jv-stat w-full text-left"
                          style={{
                            background: selectedHighBucket === f.bucketLabel ? "var(--ink-700)" : undefined,
                            border: "none",
                            borderTop: "1px solid var(--line)",
                          }}
                        >
                          <span>{f.bucketLabel}</span>
                          <b>
                            {f.count} <span style={{ color: "var(--text-2)", fontWeight: 400 }}>({f.pctOfTotal.toFixed(0)}%)</span>
                          </b>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedHighBucket && (
                  <div className="jv-card mt-4">
                    <div className="jv-br-b" />
                    {(() => {
                      const drilldownDays = report.composite!.dayRecords.filter((d) => d.highOfDayBucket === selectedHighBucket);
                      const avgPmVolume =
                        drilldownDays.length > 0
                          ? drilldownDays.reduce((s, d) => s + d.premarketVolume, 0) / drilldownDays.length
                          : null;
                      return (
                        <>
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                              High of day {selectedHighBucket} — {drilldownDays.length} day(s)
                            </div>
                            <button onClick={() => setSelectedHighBucket(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                              ✕ Close
                            </button>
                          </div>
                          {avgPmVolume !== null && (
                            <div className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
                              Avg pre-market volume for these days:{" "}
                              <b className="font-mono" style={{ color: "var(--text-0)" }}>{Math.round(avgPmVolume).toLocaleString()}</b>
                            </div>
                          )}
                          <div className="overflow-x-auto mb-3">
                            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                              <thead>
                                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                                  <th className={TH_CLASS}>Date</th>
                                  <th className={TH_CLASS}>Low of Day Time</th>
                                  <th className={TH_CLASS}>High → Low</th>
                                  <th className={TH_CLASS}>High → Close</th>
                                  <th className={TH_CLASS}>PM Volume</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drilldownDays.map((d) => (
                                  <tr
                                    key={d.dateKey}
                                    onClick={() => setFocusedDate(d.dateKey)}
                                    style={{ borderBottom: "1px solid var(--ink-800)", cursor: "pointer" }}
                                  >
                                    <td className={`${TD_CLASS} font-medium font-mono`} style={{ color: "var(--text-0)" }}>{d.dateKey}</td>
                                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{d.dayLowTimeClock ?? "N/A"}</td>
                                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{d.highToLowPct !== null ? `${d.highToLowPct.toFixed(2)}%` : "N/A"}</td>
                                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{d.highToClosePct !== null ? `${d.highToClosePct.toFixed(2)}%` : "N/A"}</td>
                                    <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{d.premarketVolume.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button onClick={() => setShowAllDrilldownCharts((s) => !s)} className="jv-btn-outline">
                            {showAllDrilldownCharts ? "Hide" : `Show all ${drilldownDays.length} charts`}
                          </button>
                          {showAllDrilldownCharts && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                              {drilldownDays.map((d) => (
                                <div key={d.dateKey} className="jv-card">
                                  <div className="jv-br-b" />
                                  <div className="text-xs font-medium mb-1" style={{ color: "var(--text-2)" }}>{d.dateKey}</div>
                                  <PriceChart key={d.dateKey} symbol={report.ticker} focusDate={d.dateKey} />
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </section>

              <section>
                <div className="jv-strip-title">Next-Day Follow-Through</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatCard
                    label="Probability of Continuation"
                    value={report.composite.nextDayFollowThrough.probabilityContinuation !== null ? `${report.composite.nextDayFollowThrough.probabilityContinuation.toFixed(0)}%` : "N/A"}
                    sub={`Sample size: ${report.composite.nextDayFollowThrough.sampleSize}`}
                  />
                  <StatCard
                    label="Avg Overnight Gain (if closed up)"
                    value={report.composite.nextDayFollowThrough.averageOvernightGainPct !== null ? `${report.composite.nextDayFollowThrough.averageOvernightGainPct.toFixed(2)}%` : "N/A"}
                  />
                  <StatCard
                    label="Avg Overnight Move (if closed down)"
                    value={report.composite.nextDayFollowThrough.averageOvernightLossPct !== null ? `${report.composite.nextDayFollowThrough.averageOvernightLossPct.toFixed(2)}%` : "N/A"}
                  />
                </div>
              </section>
            </>
          )}

          {chain && (
            <section>
              <div className="jv-strip-title">Options Chain Snapshot</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <StatCard label="Put/Call Volume Ratio" value={chain.putCallVolumeRatio !== null ? chain.putCallVolumeRatio.toFixed(2) : "N/A"} />
                <StatCard label="Put/Call OI Ratio" value={chain.putCallOpenInterestRatio !== null ? chain.putCallOpenInterestRatio.toFixed(2) : "N/A"} />
              </div>
              {chain.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card text-sm mb-3" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                  {d}
                </div>
              ))}
            </section>
          )}

          <section>
            <div className="jv-strip-title">Not Yet Available</div>
            <p className="text-sm mb-3" style={{ color: "var(--text-2)" }}>
              Order-flow signals that require data beyond what Schwab&apos;s market-data API provides.
            </p>
            <div className="flex flex-col gap-2">
              {report.notAvailable.map((g) => (
                <div key={g.label} className="jv-card" style={{ borderStyle: "dashed" }}>
                  <div className="jv-br-b" />
                  <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{g.label}</div>
                  <div className="text-sm mt-1" style={{ color: "var(--text-2)" }}>{g.note}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
