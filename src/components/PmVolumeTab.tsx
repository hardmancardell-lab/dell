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
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
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
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
        isAnomaly
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {isAnomaly ? "Anomaly" : "Normal"}
    </span>
  );
}

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
    <div>
      <p className="text-zinc-500 mb-6">
        Flags when today&apos;s pre-market volume crosses 4x its rolling average,
        then runs a historical composite of how the ticker behaved at key times of
        day the prior times this happened.
      </p>

      <form onSubmit={runCheck} className="flex gap-3">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="Ticker, e.g. AAPL"
          className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {error && (
        <div className="mt-8 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400">
          <div className="font-medium">Could not load data</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      <div className="mt-10 pt-10 border-t border-zinc-200 dark:border-zinc-800">
        <h2 className="text-lg font-semibold mb-1">Sector / Market Scan</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Scans a curated bellwether ticker list (the same one Sector
          Fundamentals uses) for the same 4x pre-market volume anomaly, so
          you don&apos;t have to check tickers one at a time. Not a live
          market-cap screen — see Research Sources for why.
        </p>
        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
          >
            {SCANNABLE_SECTORS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            onClick={runSectorScan}
            disabled={scanLoading}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {scanLoading ? "Scanning…" : "Scan Sector"}
          </button>
          <button
            onClick={runMarketScan}
            disabled={scanLoading}
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {scanLoading ? "Scanning…" : "Scan Market (all sectors)"}
          </button>
        </div>

        {scanError && (
          <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm mb-4">
            {scanError}
          </div>
        )}

        {sectorSummaries && (
          <div className="space-y-6">
            {sectorSummaries.map((summary) => (
              <div key={summary.sector}>
                <div className="font-medium text-sm mb-2">
                  {summary.sector} — {summary.tickersScanned} scanned, {summary.tickersFlagged} flagged
                </div>
                {summary.dataLimitations.map((d) => (
                  <div
                    key={d.slice(0, 30)}
                    className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-400 mb-2"
                  >
                    {d}
                  </div>
                ))}
                {summary.results.filter((r) => r.isAnomaly).length === 0 ? (
                  <p className="text-sm text-zinc-500">No tickers crossed the anomaly threshold.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.results
                      .filter((r) => r.isAnomaly)
                      .map((r) => (
                        <div
                          key={r.ticker}
                          className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 flex items-center justify-between text-sm"
                        >
                          <span className="font-medium">{r.ticker}</span>
                          <span className="text-zinc-500">
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
        <div className="mt-8 space-y-10">
          <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {report.ticker} &mdash; {report.snapshot.asOfDateKey}
              </h2>
              <AnomalyBadge isAnomaly={report.snapshot.isAnomaly} />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <StatCard
                label="Today's PM Volume"
                value={report.snapshot.todayPremarketVolume.toLocaleString()}
              />
              <StatCard
                label="Rolling Average"
                value={
                  report.snapshot.rollingAverageVolume !== null
                    ? Math.round(report.snapshot.rollingAverageVolume).toLocaleString()
                    : "N/A"
                }
                sub={`${report.snapshot.lookbackDays} day(s)`}
              />
              <StatCard
                label="Multiple"
                value={report.snapshot.multiple !== null ? `${report.snapshot.multiple.toFixed(1)}x` : "N/A"}
                sub={`Anomaly threshold: ${report.snapshot.anomalyThreshold}x`}
              />
            </div>
          </section>

          {report.dataLimitations.length > 0 && (
            <div className="space-y-3">
              {report.dataLimitations.map((d) => (
                <div
                  key={d.slice(0, 30)}
                  className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-400"
                >
                  {d}
                </div>
              ))}
            </div>
          )}

          {report.composite && (
            <>
              <section>
                <h2 className="text-xl font-semibold mb-1">
                  Historical Composite ({report.composite.anomalyDaysFound} prior anomaly day(s) found)
                </h2>
                <p className="text-sm text-zinc-500 mb-3">
                  Scanned {report.composite.tradingDaysScanned} trading days over the lookback window.
                </p>
                <div className="space-y-3">
                  {report.composite.checkpoints.map((c) => (
                    <div
                      key={c.checkpoint}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4"
                    >
                      <div className="font-medium text-sm">{c.label}</div>
                      <div className="grid grid-cols-3 gap-4 mt-2">
                        <StatCard
                          label={<GlossaryTerm term="winRate">Probability Up</GlossaryTerm>}
                          value={c.probabilityUp !== null ? `${c.probabilityUp.toFixed(0)}%` : "N/A"}
                        />
                        <StatCard
                          label="Avg Move"
                          value={c.averageMovePct !== null ? `${c.averageMovePct.toFixed(2)}%` : "N/A"}
                        />
                        <StatCard
                          label="Median Move"
                          value={c.medianMovePct !== null ? `${c.medianMovePct.toFixed(2)}%` : "N/A"}
                        />
                      </div>
                      {(c.profitFactor !== null || c.maxDrawdownPct !== null) && (
                        <div className="grid grid-cols-3 gap-4 mt-2">
                          <StatCard label={<GlossaryTerm term="profitFactor">Profit Factor</GlossaryTerm>} value={c.profitFactor !== null ? c.profitFactor.toFixed(2) : "N/A"} />
                          <StatCard label={<GlossaryTerm term="maxDrawdown">Max Drawdown</GlossaryTerm>} value={c.maxDrawdownPct !== null ? `${c.maxDrawdownPct.toFixed(2)}%` : "N/A"} />
                          <StatCard
                            label="Largest Win / Loss"
                            value={`${c.largestWinPct !== null ? `+${c.largestWinPct.toFixed(2)}%` : "N/A"} / ${c.largestLossPct !== null ? `${c.largestLossPct.toFixed(2)}%` : "N/A"}`}
                          />
                        </div>
                      )}
                      <div className="text-xs text-zinc-400 mt-2">
                        Sample size: {c.sampleSize}
                        {c.note ? ` — ${c.note}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {focusedDate && (
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold">Chart — {report.ticker} around {focusedDate}</h3>
                    <button
                      onClick={() => setFocusedDate(null)}
                      className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      ✕ Close
                    </button>
                  </div>
                  <PriceChart key={focusedDate} symbol={report.ticker} focusDate={focusedDate} />
                </div>
              )}

              <details className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
                <summary className="text-sm font-medium cursor-pointer">
                  Trade Log ({report.composite.tradeLog.length} occurrences) — click a row to jump the chart to that date
                </summary>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">Checkpoint</th>
                        <th className="py-2 pr-4">Return</th>
                        <th className="py-2 pr-4">Win/Loss</th>
                        <th className="py-2 pr-4">Overnight Gap / Day Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.composite.tradeLog.slice(-50).map((row, i) => (
                        <tr
                          key={`${row.dateKey}-${row.checkpoint}-${i}`}
                          onClick={() => setFocusedDate(row.dateKey)}
                          className={`border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                            focusedDate === row.dateKey ? "bg-zinc-50 dark:bg-zinc-900" : ""
                          }`}
                        >
                          <td className="py-2 pr-4 font-medium">{row.dateKey}</td>
                          <td className="py-2 pr-4 text-zinc-500">{row.checkpoint}</td>
                          <td className="py-2 pr-4">{row.returnPct >= 0 ? "+" : ""}{row.returnPct.toFixed(2)}%</td>
                          <td className="py-2 pr-4">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                row.isWin
                                  ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                                  : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                              }`}
                            >
                              {row.isWin ? "win" : "loss"}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-zinc-500 text-xs">{fmtDayContext(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.composite.tradeLog.length > 50 && (
                    <p className="text-xs text-zinc-400 mt-2">Showing the most recent 50 of {report.composite.tradeLog.length} occurrences.</p>
                  )}
                </div>
              </details>

              <section>
                <h2 className="text-xl font-semibold mb-3">Low / High of Day Timing</h2>
                <p className="text-sm text-zinc-500 mb-3">
                  Buckets are 30-minute windows across the regular session, listed in time order (not
                  frequency order). % is of all {report.composite.anomalyDaysFound} anomaly day(s) found.
                  {report.composite.highOfDayBefore1030Pct !== null && (
                    <>
                      {" "}
                      High of day landed before 10:30am on{" "}
                      <strong>{report.composite.highOfDayBefore1030Pct.toFixed(0)}%</strong> of those days.
                    </>
                  )}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <div className="text-sm font-medium mb-2">Low of Day</div>
                    <div className="space-y-1">
                      {report.composite.lowOfDayDistribution.map((f) => (
                        <div key={f.bucketLabel} className="flex justify-between text-sm">
                          <span className="text-zinc-500">{f.bucketLabel}</span>
                          <span>
                            {f.count} <span className="text-zinc-400">({f.pctOfTotal.toFixed(0)}%)</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-2">
                      High of Day <span className="text-zinc-400 font-normal">— click a bucket to drill in</span>
                    </div>
                    <div className="space-y-1">
                      {report.composite.highOfDayDistribution.map((f) => (
                        <button
                          key={f.bucketLabel}
                          onClick={() => {
                            setSelectedHighBucket((cur) => (cur === f.bucketLabel ? null : f.bucketLabel));
                            setShowAllDrilldownCharts(false);
                          }}
                          className={`w-full flex justify-between text-sm rounded px-1.5 py-0.5 -mx-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                            selectedHighBucket === f.bucketLabel ? "bg-zinc-100 dark:bg-zinc-900" : ""
                          }`}
                        >
                          <span className="text-zinc-500">{f.bucketLabel}</span>
                          <span>
                            {f.count} <span className="text-zinc-400">({f.pctOfTotal.toFixed(0)}%)</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedHighBucket && (
                  <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4">
                    {(() => {
                      const drilldownDays = report.composite!.dayRecords.filter(
                        (d) => d.highOfDayBucket === selectedHighBucket
                      );
                      const avgPmVolume =
                        drilldownDays.length > 0
                          ? drilldownDays.reduce((s, d) => s + d.premarketVolume, 0) / drilldownDays.length
                          : null;
                      return (
                        <>
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold">
                              High of day {selectedHighBucket} — {drilldownDays.length} day(s)
                            </h3>
                            <button
                              onClick={() => setSelectedHighBucket(null)}
                              className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                            >
                              ✕ Close
                            </button>
                          </div>
                          {avgPmVolume !== null && (
                            <div className="text-sm text-zinc-500 mb-3">
                              Avg pre-market volume for these days:{" "}
                              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                {Math.round(avgPmVolume).toLocaleString()}
                              </span>
                            </div>
                          )}
                          <div className="overflow-x-auto mb-3">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                                  <th className="py-2 pr-4">Date</th>
                                  <th className="py-2 pr-4">Low of Day Time</th>
                                  <th className="py-2 pr-4">High → Low</th>
                                  <th className="py-2 pr-4">High → Close</th>
                                  <th className="py-2 pr-4">PM Volume</th>
                                </tr>
                              </thead>
                              <tbody>
                                {drilldownDays.map((d) => (
                                  <tr
                                    key={d.dateKey}
                                    onClick={() => setFocusedDate(d.dateKey)}
                                    className="border-b border-zinc-100 dark:border-zinc-900 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                  >
                                    <td className="py-2 pr-4 font-medium">{d.dateKey}</td>
                                    <td className="py-2 pr-4 text-zinc-500">{d.dayLowTimeClock ?? "N/A"}</td>
                                    <td className="py-2 pr-4 text-zinc-500">
                                      {d.highToLowPct !== null ? `${d.highToLowPct.toFixed(2)}%` : "N/A"}
                                    </td>
                                    <td className="py-2 pr-4 text-zinc-500">
                                      {d.highToClosePct !== null ? `${d.highToClosePct.toFixed(2)}%` : "N/A"}
                                    </td>
                                    <td className="py-2 pr-4 text-zinc-500">{d.premarketVolume.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <button
                            onClick={() => setShowAllDrilldownCharts((s) => !s)}
                            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium"
                          >
                            {showAllDrilldownCharts ? "Hide" : `Show all ${drilldownDays.length} charts`}
                          </button>
                          {showAllDrilldownCharts && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                              {drilldownDays.map((d) => (
                                <div key={d.dateKey} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                                  <div className="text-xs font-medium text-zinc-500 mb-1">{d.dateKey}</div>
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
                <h2 className="text-xl font-semibold mb-3">Next-Day Follow-Through</h2>
                <div className="grid grid-cols-3 gap-4">
                  <StatCard
                    label="Probability of Continuation"
                    value={
                      report.composite.nextDayFollowThrough.probabilityContinuation !== null
                        ? `${report.composite.nextDayFollowThrough.probabilityContinuation.toFixed(0)}%`
                        : "N/A"
                    }
                    sub={`Sample size: ${report.composite.nextDayFollowThrough.sampleSize}`}
                  />
                  <StatCard
                    label="Avg Overnight Gain (if closed up)"
                    value={
                      report.composite.nextDayFollowThrough.averageOvernightGainPct !== null
                        ? `${report.composite.nextDayFollowThrough.averageOvernightGainPct.toFixed(2)}%`
                        : "N/A"
                    }
                  />
                  <StatCard
                    label="Avg Overnight Move (if closed down)"
                    value={
                      report.composite.nextDayFollowThrough.averageOvernightLossPct !== null
                        ? `${report.composite.nextDayFollowThrough.averageOvernightLossPct.toFixed(2)}%`
                        : "N/A"
                    }
                  />
                </div>
              </section>
            </>
          )}

          {chain && (
            <section>
              <h2 className="text-xl font-semibold mb-3">Options Chain Snapshot</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <StatCard
                  label="Put/Call Volume Ratio"
                  value={chain.putCallVolumeRatio !== null ? chain.putCallVolumeRatio.toFixed(2) : "N/A"}
                />
                <StatCard
                  label="Put/Call OI Ratio"
                  value={
                    chain.putCallOpenInterestRatio !== null
                      ? chain.putCallOpenInterestRatio.toFixed(2)
                      : "N/A"
                  }
                />
              </div>
              {chain.dataLimitations.map((d) => (
                <div
                  key={d.slice(0, 30)}
                  className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 text-sm text-amber-800 dark:text-amber-400 mb-3"
                >
                  {d}
                </div>
              ))}
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mb-3">Not Yet Available</h2>
            <p className="text-sm text-zinc-500 mb-3">
              Order-flow signals that require data beyond what Schwab&apos;s market-data API provides.
            </p>
            <div className="space-y-3">
              {report.notAvailable.map((g) => (
                <div
                  key={g.label}
                  className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4"
                >
                  <div className="font-medium text-sm">{g.label}</div>
                  <div className="text-sm text-zinc-500 mt-1">{g.note}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
