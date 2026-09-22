"use client";

import { useEffect, useState } from "react";

interface DayRow {
  dateKey: string;
  overnightGapPct: number;
  intradayPct: number;
  fullDayPct: number;
}

interface OvernightIntradayResult {
  ticker: string;
  daysAnalyzed: number;
  overnightGap: { meanPct: number | null; medianPct: number | null; stdDevPct: number | null; pctDaysNegative: number | null };
  intraday: { meanPct: number | null; medianPct: number | null; stdDevPct: number | null; pctDaysPositive: number | null };
  correlationGapVsIntraday: number | null;
  gapDownThenGreenPattern: {
    occurrences: number;
    pctOfAllDays: number | null;
    meanOvernightGapPctOnThoseDays: number | null;
    meanIntradayRecoveryPctOnThoseDays: number | null;
    meanFullDayPctOnThoseDays: number | null;
  };
  recentDays: DayRow[];
  error?: string;
}

const DEFAULT_TICKERS = "INTC,AMD,MU,MRVL";

function fmtPct(v: number | null, digits = 2): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "N/A";
}

export function OvernightIntradayPatternTab() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [results, setResults] = useState<OvernightIntradayResult[] | null>(null);
  const [dataLimitations, setDataLimitations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/overnight-intraday-pattern?tickers=${encodeURIComponent(tickers)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else {
        setResults(json.tickers as OvernightIntradayResult[]);
        setDataLimitations(json.dataLimitations ?? []);
      }
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
        Real check for a claimed pattern: does this ticker actually drop overnight and run the rest of the day?
        Splits every real trading day (trailing ~year) into its overnight component (prior close → open) and
        intraday component (open → close) separately, then isolates the exact days that gapped down AND closed
        green.
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
          <input value={tickers} onChange={(e) => setTickers(e.target.value.toUpperCase())} className="jv-input" style={{ width: 320 }} />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Study"}
        </button>
      </form>

      {error && <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}

      {results && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {results.map((t) => (
              <div key={t.ticker} className="jv-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{t.ticker}</div>
                  <div className="text-xs" style={{ color: "var(--text-2)" }}>n={t.daysAnalyzed} real days</div>
                </div>
                {t.error ? (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                      <div>
                        <div className="jv-label">Avg overnight gap</div>
                        <div className="font-mono" style={{ color: (t.overnightGap.meanPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(t.overnightGap.meanPct)}</div>
                        <div className="text-xs" style={{ color: "var(--text-2)" }}>{t.overnightGap.pctDaysNegative?.toFixed(0)}% of nights are down</div>
                      </div>
                      <div>
                        <div className="jv-label">Avg intraday move</div>
                        <div className="font-mono" style={{ color: (t.intraday.meanPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(t.intraday.meanPct)}</div>
                        <div className="text-xs" style={{ color: "var(--text-2)" }}>{t.intraday.pctDaysPositive?.toFixed(0)}% of days run green</div>
                      </div>
                    </div>

                    <div className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                      Correlation (overnight gap vs. intraday move): <span className="font-mono" style={{ color: "var(--text-0)" }}>{t.correlationGapVsIntraday !== null ? t.correlationGapVsIntraday.toFixed(3) : "N/A"}</span>
                      {t.correlationGapVsIntraday !== null && t.correlationGapVsIntraday < -0.15 && <span style={{ color: "var(--signal)" }}> — real fade-and-recover relationship</span>}
                      {t.correlationGapVsIntraday !== null && t.correlationGapVsIntraday >= -0.15 && <span> — weak/no relationship</span>}
                    </div>

                    <div className="jv-card mb-2" style={{ borderColor: "var(--verdict)" }}>
                      <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                        Gap-down-then-green days: {t.gapDownThenGreenPattern.occurrences} of {t.daysAnalyzed} ({t.gapDownThenGreenPattern.pctOfAllDays?.toFixed(0)}%)
                      </div>
                      <div className="text-xs font-mono" style={{ color: "var(--text-1)" }}>
                        On those days: avg overnight drop {fmtPct(t.gapDownThenGreenPattern.meanOvernightGapPctOnThoseDays)}, avg intraday recovery {fmtPct(t.gapDownThenGreenPattern.meanIntradayRecoveryPctOnThoseDays)}, net day {fmtPct(t.gapDownThenGreenPattern.meanFullDayPctOnThoseDays)}
                      </div>
                    </div>

                    <button
                      onClick={() => setExpandedTicker(expandedTicker === t.ticker ? null : t.ticker)}
                      className="text-xs underline"
                      style={{ color: "var(--text-2)" }}
                    >
                      {expandedTicker === t.ticker ? "Hide" : "Show"} last 10 real days
                    </button>

                    {expandedTicker === t.ticker && (
                      <div className="overflow-x-auto mt-2">
                        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                              <th className="py-1 pr-3 font-normal">Date</th>
                              <th className="py-1 pr-3 font-normal text-right">Overnight gap</th>
                              <th className="py-1 pr-3 font-normal text-right">Intraday</th>
                              <th className="py-1 pr-3 font-normal text-right">Full day</th>
                            </tr>
                          </thead>
                          <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                            {t.recentDays.map((d) => (
                              <tr key={d.dateKey} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                                <td className="py-1 pr-3 font-mono" style={{ color: "var(--text-0)" }}>{d.dateKey}</td>
                                <td className="py-1 pr-3 text-right font-mono" style={{ color: d.overnightGapPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(d.overnightGapPct)}</td>
                                <td className="py-1 pr-3 text-right font-mono" style={{ color: d.intradayPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(d.intradayPct)}</td>
                                <td className="py-1 pr-3 text-right font-mono" style={{ color: d.fullDayPct >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(d.fullDayPct)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="jv-card text-xs" style={{ borderColor: "var(--verdict-dim)", color: "var(--verdict)" }}>
                {d}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
