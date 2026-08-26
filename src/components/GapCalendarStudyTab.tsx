"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type {
  WeekdayHodLodStudyResult,
  RecentDayRow,
  RecentDayVarianceResult,
  GapAnalogScanResult,
} from "@/lib/agents/trading-agent/skills/gap-calendar-study";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TH_CLASS = "py-2 pr-4 font-mono text-xs uppercase tracking-wider font-normal whitespace-nowrap";
const TD_CLASS = "py-2 pr-4 whitespace-nowrap";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function bucketColor(bucket: RecentDayRow["bucket"]): string {
  if (bucket === "gap_up") return "var(--signal)";
  if (bucket === "gap_down") return "var(--danger)";
  return "var(--text-2)";
}

function DistributionList({ label, dist }: { label: string; dist: { bucketLabel: string; count: number; pctOfTotal: number }[] }) {
  return (
    <div>
      <div className="jv-label mb-1">{label}</div>
      {dist.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>No data.</div>
      ) : (
        dist.map((b) => (
          <div key={b.bucketLabel} className="flex justify-between text-xs font-mono" style={{ color: "var(--text-2)" }}>
            <span>{b.bucketLabel}</span>
            <span>{b.count} ({b.pctOfTotal.toFixed(1)}%)</span>
          </div>
        ))
      )}
    </div>
  );
}

export function GapCalendarStudyTab({ defaultTicker = "AAPL" }: { defaultTicker?: string }) {
  const [ticker, setTicker] = useState(defaultTicker);
  const { track } = useTrackEvent();

  // --- Study 1: weekday HOD/LOD ---
  const [weekday, setWeekday] = useState("tuesday");
  const [occurrenceCount, setOccurrenceCount] = useState(50);
  const [weekdayResult, setWeekdayResult] = useState<WeekdayHodLodStudyResult | null>(null);
  const [weekdayError, setWeekdayError] = useState<string | null>(null);
  const [weekdayLoading, setWeekdayLoading] = useState(false);

  async function runWeekdayStudy(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setWeekdayLoading(true);
    setWeekdayError(null);
    setWeekdayResult(null);
    try {
      const res = await fetch(
        `/api/gap-calendar-study/weekday-hodlod?ticker=${encodeURIComponent(ticker)}&weekday=${weekday}&occurrenceCount=${occurrenceCount}`
      );
      const json = await res.json();
      if (!res.ok) {
        setWeekdayError(json.error ?? "Unknown error");
        track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "weekday-hodlod", status: res.status } });
      } else {
        setWeekdayResult(json as WeekdayHodLodStudyResult);
        track("backtest_run", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { study: "weekday-hodlod", weekday, occurrenceCount } });
      }
    } catch (err) {
      setWeekdayError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "weekday-hodlod", status: 0 } });
    } finally {
      setWeekdayLoading(false);
    }
  }

  // --- Study 2: recent-day variance ---
  const [dayCount, setDayCount] = useState(21);
  const [varianceResult, setVarianceResult] = useState<RecentDayVarianceResult | null>(null);
  const [varianceError, setVarianceError] = useState<string | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);

  async function runVarianceStudy(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setVarianceLoading(true);
    setVarianceError(null);
    setVarianceResult(null);
    try {
      const res = await fetch(`/api/gap-calendar-study/recent-variance?ticker=${encodeURIComponent(ticker)}&dayCount=${dayCount}`);
      const json = await res.json();
      if (!res.ok) {
        setVarianceError(json.error ?? "Unknown error");
        track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "recent-variance", status: res.status } });
      } else {
        setVarianceResult(json as RecentDayVarianceResult);
        track("backtest_run", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { study: "recent-variance", dayCount } });
      }
    } catch (err) {
      setVarianceError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "recent-variance", status: 0 } });
    } finally {
      setVarianceLoading(false);
    }
  }

  // --- Study 3: gap-analog scan ---
  const [asOfTimeEt, setAsOfTimeEt] = useState("07:00");
  const [gapThresholdPct, setGapThresholdPct] = useState(2);
  const [lookbackDays, setLookbackDays] = useState(400);
  const [gapResult, setGapResult] = useState<GapAnalogScanResult | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [gapLoading, setGapLoading] = useState(false);

  async function runGapScan(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setGapLoading(true);
    setGapError(null);
    setGapResult(null);
    try {
      const res = await fetch(
        `/api/gap-calendar-study/gap-analog?ticker=${encodeURIComponent(ticker)}&asOfTimeEt=${encodeURIComponent(asOfTimeEt)}&gapThresholdPct=${gapThresholdPct}&lookbackDays=${lookbackDays}`
      );
      const json = await res.json();
      if (!res.ok) {
        setGapError(json.error ?? "Unknown error");
        track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "gap-analog", status: res.status } });
      } else {
        setGapResult(json as GapAnalogScanResult);
        track("backtest_run", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { study: "gap-analog", asOfTimeEt, gapThresholdPct, lookbackDays } });
      }
    } catch (err) {
      setGapError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Gap & Calendar Study", symbol: ticker, metadata: { endpoint: "gap-analog", status: 0 } });
    } finally {
      setGapLoading(false);
    }
  }

  return (
    <div className="jarvis">
      <p className="jv-lede">
        Three real-data studies for any ticker: when a given weekday&apos;s high/low of day actually
        happens, how gap-up vs. gap-down days differ over a recent window, and how the stock has
        historically played out after a specific premarket gap at a given time. All computed from
        real Alpaca minute bars — see the disclosures below each study.
      </p>

      <div className="jv-card mb-6">
        <label className="jv-label block mb-1">Ticker (shared across all three studies below)</label>
        <input
          className="jv-input"
          style={{ width: 140 }}
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="AAPL"
        />
      </div>

      {/* ================= Study 1: Weekday HOD/LOD ================= */}
      <div className="jv-card mb-6">
        <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>
          Study 1 &middot; Weekday High/Low-of-Day Timing
        </div>
        <form onSubmit={runWeekdayStudy} className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="jv-label block mb-1">Weekday</label>
            <select className="jv-select" value={weekday} onChange={(e) => setWeekday(e.target.value)}>
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="jv-label block mb-1">Occurrences</label>
            <input
              type="number"
              className="jv-input"
              style={{ width: 90 }}
              value={occurrenceCount}
              onChange={(e) => setOccurrenceCount(Number(e.target.value))}
            />
          </div>
          <button type="submit" disabled={weekdayLoading} className="jv-btn" style={{ padding: "8px 16px" }}>
            {weekdayLoading ? "Running…" : "Run Study"}
          </button>
        </form>

        {weekdayError && (
          <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{weekdayError}</div>
        )}

        {weekdayResult && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="jv-label">Occurrences found</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{weekdayResult.occurrencesFound} / {weekdayResult.requestedOccurrences}</div>
              </div>
              <div>
                <div className="jv-label">Most common high window</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{weekdayResult.mostCommonHighBucket ?? "N/A"}</div>
              </div>
              <div>
                <div className="jv-label">Most common low window</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{weekdayResult.mostCommonLowBucket ?? "N/A"}</div>
              </div>
              <div>
                <div className="jv-label">High / Low before 10:30am</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>
                  {weekdayResult.pctHighBefore1030Et?.toFixed(0) ?? "N/A"}% / {weekdayResult.pctLowBefore1030Et?.toFixed(0) ?? "N/A"}%
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DistributionList label="High-of-Day timing" dist={weekdayResult.highOfDayTimeDistribution} />
              <DistributionList label="Low-of-Day timing" dist={weekdayResult.lowOfDayTimeDistribution} />
            </div>
            {weekdayResult.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
            ))}
          </div>
        )}
      </div>

      {/* ================= Study 2: Recent-day variance ================= */}
      <div className="jv-card mb-6">
        <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>
          Study 2 &middot; Gap-Up vs. Gap-Down Day Variance
        </div>
        <form onSubmit={runVarianceStudy} className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="jv-label block mb-1">Trading days</label>
            <input
              type="number"
              className="jv-input"
              style={{ width: 90 }}
              value={dayCount}
              onChange={(e) => setDayCount(Number(e.target.value))}
            />
          </div>
          <button type="submit" disabled={varianceLoading} className="jv-btn" style={{ padding: "8px 16px" }}>
            {varianceLoading ? "Running…" : "Run Study"}
          </button>
        </form>

        {varianceError && (
          <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{varianceError}</div>
        )}

        {varianceResult && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="jv-label">All {varianceResult.daysAnalyzed} days &middot; mean</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{fmtPct(varianceResult.all.meanPct)}</div>
              </div>
              <div>
                <div className="jv-label">Gap-up (n={varianceResult.gapUp.count}) &middot; mean</div>
                <div className="jv-stat" style={{ color: "var(--signal)" }}>{fmtPct(varianceResult.gapUp.meanPct)}</div>
              </div>
              <div>
                <div className="jv-label">Gap-down (n={varianceResult.gapDown.count}) &middot; mean</div>
                <div className="jv-stat" style={{ color: "var(--danger)" }}>{fmtPct(varianceResult.gapDown.meanPct)}</div>
              </div>
              <div>
                <div className="jv-label">Bootstrap 95% CI on the gap</div>
                <div className="jv-stat" style={{ color: varianceResult.gapUpVsGapDownBootstrap.ciExcludesZero ? "var(--signal)" : "var(--text-0)" }}>
                  [{fmtPct(varianceResult.gapUpVsGapDownBootstrap.lower)}, {fmtPct(varianceResult.gapUpVsGapDownBootstrap.upper)}]
                  {varianceResult.gapUpVsGapDownBootstrap.ciExcludesZero ? " — significant" : ""}
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Overnight Gap</th>
                    <th className={TH_CLASS}>Close-to-Close Move</th>
                    <th className={TH_CLASS}>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {varianceResult.days.map((row) => (
                    <tr key={row.dateKey} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.overnightGapPct)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: bucketColor(row.bucket) }}>{fmtPct(row.dayReturnPct)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: bucketColor(row.bucket) }}>{row.bucket.replace("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {varianceResult.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
            ))}
          </div>
        )}
      </div>

      {/* ================= Study 3: Gap-analog scan ================= */}
      <div className="jv-card mb-6">
        <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>
          Study 3 &middot; Gap-Analog Scan
        </div>
        <form onSubmit={runGapScan} className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="jv-label block mb-1">As-of time (ET)</label>
            <input
              className="jv-input"
              style={{ width: 90 }}
              value={asOfTimeEt}
              onChange={(e) => setAsOfTimeEt(e.target.value)}
              placeholder="07:00"
            />
          </div>
          <div>
            <label className="jv-label block mb-1">Gap threshold % (signed)</label>
            <input
              type="number"
              step="0.05"
              className="jv-input"
              style={{ width: 100 }}
              value={gapThresholdPct}
              onChange={(e) => setGapThresholdPct(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="jv-label block mb-1">Lookback (days)</label>
            <input
              type="number"
              className="jv-input"
              style={{ width: 100 }}
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
            />
          </div>
          <button type="submit" disabled={gapLoading} className="jv-btn" style={{ padding: "8px 16px" }}>
            {gapLoading ? "Scanning…" : "Run Scan"}
          </button>
        </form>
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
          Positive threshold = gap up at least that much; negative = gap down at least that much
          (e.g. -0.85 for &quot;down 0.85% or more&quot;), measured vs. the prior session&apos;s close at the given ET time.
        </p>

        {gapError && (
          <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>{gapError}</div>
        )}

        {gapResult && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="jv-label">Historical matches</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{gapResult.occurrences} of {gapResult.tradingDaysScanned} days</div>
              </div>
              <div>
                <div className="jv-label">Finished green / red</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{gapResult.finishedGreenCount} / {gapResult.finishedRedCount}</div>
              </div>
              <div>
                <div className="jv-label">Extended / faded back</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{gapResult.extendedBeyondGapCount} / {gapResult.fadedBackCount}</div>
              </div>
              <div>
                <div className="jv-label">Avg close-to-close move</div>
                <div className="jv-stat" style={{ color: gapResult.direction === "up" ? "var(--signal)" : "var(--danger)" }}>
                  {fmtPct(gapResult.avgCloseMovePct)}
                </div>
              </div>
              <div>
                <div className="jv-label">Median close-to-close move</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{fmtPct(gapResult.medianCloseMovePct)}</div>
              </div>
              <div>
                <div className="jv-label">Avg move, PM high &rarr; close</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{fmtPct(gapResult.avgPctMoveFromPmHighToClose)}</div>
              </div>
              <div>
                <div className="jv-label">Avg move, PM low &rarr; close</div>
                <div className="jv-stat" style={{ color: "var(--text-0)" }}>{fmtPct(gapResult.avgPctMoveFromPmLowToClose)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DistributionList label="High-of-Day timing on matching days" dist={gapResult.highOfDayTimeDistribution} />
              <DistributionList label="Low-of-Day timing on matching days" dist={gapResult.lowOfDayTimeDistribution} />
            </div>

            <div>
              <div className="jv-label mb-1">Avg % move from the as-of price, by checkpoint</div>
              {gapResult.checkpointAverages.map((c) => (
                <div key={c.label} className="flex justify-between text-xs font-mono" style={{ color: "var(--text-2)" }}>
                  <span>{c.label}</span>
                  <span>{fmtPct(c.avgPct)} (n={c.sampleSize})</span>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                    <th className={TH_CLASS}>Date</th>
                    <th className={TH_CLASS}>Gap @ {gapResult.asOfTimeEt}</th>
                    <th className={TH_CLASS}>Close Move</th>
                    <th className={TH_CLASS}>HOD</th>
                    <th className={TH_CLASS}>LOD</th>
                  </tr>
                </thead>
                <tbody>
                  {gapResult.matchingDays.map((row) => (
                    <tr key={row.dateKey} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-0)" }}>{row.dateKey}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{fmtPct(row.gapAtAsOfTimePct)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: row.finishedGreen ? "var(--signal)" : "var(--danger)" }}>{fmtPct(row.closePct)}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.dayHighTimeClock ?? "N/A"}</td>
                      <td className={`${TD_CLASS} font-mono`} style={{ color: "var(--text-2)" }}>{row.dayLowTimeClock ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gapResult.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
