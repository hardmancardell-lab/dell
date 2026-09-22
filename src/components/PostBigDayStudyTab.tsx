"use client";

import { useEffect, useState } from "react";
import { PriceChart } from "./PriceChart";

interface PostBigDayOccurrence {
  triggerDateKey: string;
  triggerDayReturnPct: number;
  triggerDirection: "gain" | "loss";
  nextDateKey: string;
  nextDayOvernightGapPct: number;
  nextDayRangePct: number;
  nextDayFullReturnPct: number;
}

interface GapDownEventDayStats {
  eventGapThresholdPct: number;
  eventCount: number;
  outOfTotalOccurrences: number;
  meanGapPct: number | null;
  medianGapPct: number | null;
  pctThatContinueLower: number | null;
  pctThatRecoverGreen: number | null;
  meanFullDayReturnPct: number | null;
  medianFullDayReturnPct: number | null;
  meanRangePct: number | null;
  medianRangePct: number | null;
  highOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  lowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  minuteBarEventsUsable: number;
}

interface PostBigDayResult {
  ticker: string;
  bigDayThresholdPct: number;
  gapDownThresholdPct: number;
  occurrences: PostBigDayOccurrence[];
  stats: {
    count: number;
    pctGapDownAtAll: number | null;
    pctGapDownAtLeastThreshold: number | null;
    meanNextDayGapPct: number | null;
    medianNextDayGapPct: number | null;
    maxDropPct: number | null;
    meanNextDayRangePct: number | null;
    medianNextDayRangePct: number | null;
  };
  intradayCheckpoints: { label: string; avgPctMoveFromOpen: number | null; sampleSize: number }[];
  minuteBarOccurrencesUsable: number;
  gapDownEventDays: GapDownEventDayStats;
  dataLimitations: string[];
  error?: string;
}

function fmtPct(v: number | null, digits = 2): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "N/A";
}

export function PostBigDayStudyTab() {
  const [tickers, setTickers] = useState("INTC");
  const [threshold, setThreshold] = useState("5");
  const [results, setResults] = useState<PostBigDayResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedTicker, setFocusedTicker] = useState<string | null>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/post-big-day-study?tickers=${encodeURIComponent(tickers)}&threshold=${encodeURIComponent(threshold)}`
      );
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResults(json.tickers as PostBigDayResult[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real conditional study: after a day that moved at least the threshold shown — gain OR loss — how does the
        NEXT real trading day actually behave? Highlighted rows are the specific event days that gapped down at
        least 1%, broken out separately below since that&apos;s the population that actually matters here. Click any
        trigger date to jump the chart straight to it.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label className="jv-label block mb-1">Tickers (comma-separated)</label>
          <input value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} className="jv-input" style={{ width: 260 }} />
        </div>
        <div>
          <label className="jv-label block mb-1">Big-day threshold (%)</label>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} className="jv-input" style={{ width: 100 }} />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Study"}
        </button>
      </form>

      {error && <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}

      {results && (
        <div className="flex flex-col gap-6">
          {results.map((t) => (
            <div key={t.ticker} className="jv-card">
              <div className="flex items-center justify-between mb-2">
                <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{t.ticker}</div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>
                  n={t.stats.count} real days ≥{t.bigDayThresholdPct}% gain
                </div>
              </div>
              {t.error ? (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-4">
                    <div>
                      <div className="jv-label">Gaps down at all</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.stats.pctGapDownAtAll?.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="jv-label">Gaps down ≥{Math.abs(t.gapDownThresholdPct)}%</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.stats.pctGapDownAtLeastThreshold?.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="jv-label">Avg next-day gap</div>
                      <div className="font-mono" style={{ color: (t.stats.meanNextDayGapPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(t.stats.meanNextDayGapPct)}</div>
                    </div>
                    <div>
                      <div className="jv-label">Max drop ever seen</div>
                      <div className="font-mono" style={{ color: "var(--danger)" }}>{fmtPct(t.stats.maxDropPct)}</div>
                    </div>
                    <div>
                      <div className="jv-label">Median next-day gap</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.stats.medianNextDayGapPct)}</div>
                    </div>
                    <div>
                      <div className="jv-label">Usual next-day range</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.stats.meanNextDayRangePct)}</div>
                    </div>
                    <div>
                      <div className="jv-label">Median next-day range</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.stats.medianNextDayRangePct)}</div>
                    </div>
                  </div>

                  {t.intradayCheckpoints.length > 0 && (
                    <div className="mb-4">
                      <div className="jv-label mb-1">Intraday move from open, at key times (n={t.minuteBarOccurrencesUsable} recent occurrences with real minute bars)</div>
                      <div className="flex flex-wrap gap-3 text-xs font-mono">
                        {t.intradayCheckpoints.map((c) => (
                          <div key={c.label} className="jv-card" style={{ padding: "4px 8px" }}>
                            <div style={{ color: "var(--text-2)" }}>{c.label}</div>
                            <div style={{ color: (c.avgPctMoveFromOpen ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>
                              {fmtPct(c.avgPctMoveFromOpen)} (n={c.sampleSize})
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="jv-card mb-4" style={{ borderColor: "var(--verdict)" }}>
                    <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                      Gap-down event days (next-day gap ≤ {t.gapDownEventDays.eventGapThresholdPct}%): {t.gapDownEventDays.eventCount} of {t.gapDownEventDays.outOfTotalOccurrences} occurrences
                    </div>
                    <p className="text-xs mb-2" style={{ color: "var(--verdict)" }}>
                      Every row in this subset already followed an abnormal (≥{t.bigDayThresholdPct}%) prior-day gain or loss — this is not a general gap-down study.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="jv-label">Avg gap on those days</div>
                        <div className="font-mono" style={{ color: "var(--danger)" }}>{fmtPct(t.gapDownEventDays.meanGapPct)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Continues lower (closes red)</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.gapDownEventDays.pctThatContinueLower?.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="jv-label">Recovers green</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.gapDownEventDays.pctThatRecoverGreen?.toFixed(0)}%</div>
                      </div>
                      <div>
                        <div className="jv-label">Avg full-day return</div>
                        <div className="font-mono" style={{ color: (t.gapDownEventDays.meanFullDayReturnPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(t.gapDownEventDays.meanFullDayReturnPct)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Avg range that day</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.gapDownEventDays.meanRangePct)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Median range that day</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.gapDownEventDays.medianRangePct)}</div>
                      </div>
                    </div>
                    {t.gapDownEventDays.minuteBarEventsUsable > 0 && (
                      <div className="mt-2 text-xs" style={{ color: "var(--text-2)" }}>
                        Real intraday timing (n={t.gapDownEventDays.minuteBarEventsUsable} with usable minute bars): most common high-of-day{" "}
                        {t.gapDownEventDays.highOfDayTimeDistribution.length > 0
                          ? t.gapDownEventDays.highOfDayTimeDistribution.reduce((a, b) => (b.count > a.count ? b : a)).bucketLabel
                          : "N/A"}
                        , most common low-of-day{" "}
                        {t.gapDownEventDays.lowOfDayTimeDistribution.length > 0
                          ? t.gapDownEventDays.lowOfDayTimeDistribution.reduce((a, b) => (b.count > a.count ? b : a)).bucketLabel
                          : "N/A"}
                        .
                      </div>
                    )}
                  </div>

                  <div className="jv-label mb-1">Trigger days (click to jump the chart to it)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                          <th className="py-1 pr-3 font-normal">Trigger day</th>
                          <th className="py-1 pr-3 font-normal text-right">Trigger move</th>
                          <th className="py-1 pr-3 font-normal">Next day</th>
                          <th className="py-1 pr-3 font-normal text-right">Gap</th>
                          <th className="py-1 pr-3 font-normal text-right">Range</th>
                          <th className="py-1 pr-3 font-normal text-right">Full day</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                        {t.occurrences.map((o) => (
                          <tr
                            key={o.triggerDateKey}
                            style={{
                              borderBottom: "1px solid var(--ink-800)",
                              cursor: "pointer",
                              background: o.nextDayOvernightGapPct <= t.gapDownEventDays.eventGapThresholdPct ? "var(--verdict-dim)" : undefined,
                            }}
                            onClick={() => {
                              setFocusedTicker(t.ticker);
                              setFocusedDate(o.triggerDateKey);
                            }}
                          >
                            <td className="py-1 pr-3 font-mono underline" style={{ color: "var(--verdict)" }}>{o.triggerDateKey}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: o.triggerDirection === "gain" ? "var(--signal)" : "var(--danger)" }}>
                              {fmtPct(o.triggerDayReturnPct)} ({o.triggerDirection})
                            </td>
                            <td className="py-1 pr-3 font-mono" style={{ color: "var(--text-0)" }}>{o.nextDateKey}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: o.nextDayOvernightGapPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(o.nextDayOvernightGapPct)}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(o.nextDayRangePct)}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: o.nextDayFullReturnPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(o.nextDayFullReturnPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2 mt-3">
                    {t.dataLimitations.map((d) => (
                      <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                        {d}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}

          {focusedTicker && focusedDate && (
            <div className="jv-card">
              <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>
                {focusedTicker} around {focusedDate}
              </div>
              <PriceChart key={`${focusedTicker}-${focusedDate}`} symbol={focusedTicker} focusDate={focusedDate} assetClass="equity" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
