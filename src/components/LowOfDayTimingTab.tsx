"use client";

import { useEffect, useState } from "react";

interface Bucket {
  bucketLabel: string;
  count: number;
  pctOfTotal: number;
}

interface LowOfDayTimingResult {
  ticker: string;
  filterDayOfWeekLabel: string | null;
  lateLowCutoffClock: string;
  daysAnalyzed: number;
  pctLowBeforeCutoff: number | null;
  pctLowAtOrAfterCutoff: number | null;
  overallLowOfDayTimeDistribution: Bucket[];
  overallMostCommonLowBucket: string | null;
  overallMedianLowClock: string | null;
  overallHighOfDayTimeDistribution: Bucket[];
  overallMostCommonHighBucket: string | null;
  overallMedianHighClock: string | null;
  lateLowDays: {
    count: number;
    timeDistribution: Bucket[];
    mostCommonBucket: string | null;
    medianLowClock: string | null;
  };
  dataLimitations: string[];
  error?: string;
}

const WEEKDAY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Every trading day" },
  { value: "1", label: "Mondays" },
  { value: "2", label: "Tuesdays" },
  { value: "3", label: "Wednesdays" },
  { value: "4", label: "Thursdays" },
  { value: "5", label: "Fridays" },
];

export function LowOfDayTimingTab() {
  const [tickers, setTickers] = useState("GOOGL");
  const [dayOfWeek, setDayOfWeek] = useState("");
  const [results, setResults] = useState<LowOfDayTimingResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/low-of-day-timing?tickers=${encodeURIComponent(tickers)}${dayOfWeek ? `&dayOfWeek=${dayOfWeek}` : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResults(json.tickers as LowOfDayTimingResult[]);
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
        When does the high and low of the regular session (9:30am-4:00pm ET) typically happen? Plus a real
        conditional check: on the days the session low did NOT form before 10:30am ET, when does it actually
        happen instead? All times ET.
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
          <label className="jv-label block mb-1">Day of week</label>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className="jv-select">
            {WEEKDAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
                <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>
                  {t.ticker}
                  {t.filterDayOfWeekLabel && (
                    <span className="text-xs font-normal ml-2" style={{ color: "var(--text-2)" }}>
                      ({t.filterDayOfWeekLabel}s only)
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>n={t.daysAnalyzed} real days</div>
              </div>
              {t.error ? (
                <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <div className="jv-label">Avg High of Day</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>
                        {t.overallMedianHighClock ?? "N/A"}{" "}
                        <span className="text-xs" style={{ color: "var(--text-2)" }}>(median)</span>
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-2)" }}>Most common: {t.overallMostCommonHighBucket ?? "N/A"}</div>
                    </div>
                    <div>
                      <div className="jv-label">Avg Low of Day</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>
                        {t.overallMedianLowClock ?? "N/A"}{" "}
                        <span className="text-xs" style={{ color: "var(--text-2)" }}>(median)</span>
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-2)" }}>Most common: {t.overallMostCommonLowBucket ?? "N/A"}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div>
                      <div className="jv-label">Low before {t.lateLowCutoffClock}</div>
                      <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.pctLowBeforeCutoff?.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="jv-label">Low at/after {t.lateLowCutoffClock}</div>
                      <div className="font-mono" style={{ color: "var(--verdict)" }}>{t.pctLowAtOrAfterCutoff?.toFixed(0)}%</div>
                    </div>
                  </div>

                  <div className="jv-card mb-3" style={{ borderColor: "var(--verdict)" }}>
                    <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                      On the {t.lateLowDays.count} days it came at/after {t.lateLowCutoffClock}:
                    </div>
                    <div className="text-sm font-mono" style={{ color: "var(--text-0)" }}>
                      Most common window: <span style={{ color: "var(--verdict)" }}>{t.lateLowDays.mostCommonBucket ?? "N/A"}</span>
                      {" · "}Median: <span style={{ color: "var(--verdict)" }}>{t.lateLowDays.medianLowClock ?? "N/A"}</span>
                    </div>
                    <table className="w-full text-xs mt-2" style={{ borderCollapse: "collapse" }}>
                      <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                        {t.lateLowDays.timeDistribution.map((b) => (
                          <tr key={b.bucketLabel} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                            <td className="py-1 pr-3" style={{ color: "var(--text-1)" }}>{b.bucketLabel}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{b.count}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-0)" }}>{b.pctOfTotal.toFixed(0)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-2">
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
        </div>
      )}
    </div>
  );
}
