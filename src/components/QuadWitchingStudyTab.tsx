"use client";

import { useEffect, useState } from "react";

interface WinLossMetrics {
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  maxDrawdownPct: number | null;
  largestWinPct: number | null;
  largestLossPct: number | null;
}

interface QuadWitchingDayOf extends WinLossMetrics {
  sampleSize: number;
  avgVolumeRatio: number | null;
  meanRangePct: number | null;
  bootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  eventDates: string[];
}

interface WeekStats {
  sampleSize: number;
  meanAbsReturnPct: number | null;
  meanRangePct: number | null;
  stdDevReturnPct: number | null;
}

interface QuadWitchingTickerResult {
  ticker: string;
  eventsFound: number;
  dayOf: QuadWitchingDayOf;
  weekBefore: WeekStats;
  weekAfter: WeekStats;
  regularWeek: WeekStats;
  error?: string;
}

interface QuadWitchingStudyResult {
  tickers: QuadWitchingTickerResult[];
  nextWitchingDate: string;
  dataLimitations: string[];
}

const DEFAULT_TICKERS = "SPY,QQQ,NVDA,AAPL,MSFT,AMD,TSLA";

function fmtPct(v: number | null, digits = 2): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "N/A";
}

function fmtRatio(v: number | null): string {
  return v !== null ? `${v.toFixed(2)}x` : "N/A";
}

export function QuadWitchingStudyTab() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [result, setResult] = useState<QuadWitchingStudyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quad-witching-study?tickers=${encodeURIComponent(tickers)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as QuadWitchingStudyResult);
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
        Real event study: quadruple ("quad") witching — the simultaneous expiration of stock index futures, index
        options, and single-stock options on the third Friday of March, June, September, and December. Measures real
        volume/volatility on the witching day itself, then tests whether realized volatility actually differs the
        week before vs. the week after (the "dealer gamma reset" claim), against a regular-week baseline.
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

      {result && (
        <div className="flex flex-col gap-6">
          <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
            <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
              Next quad witching: {result.nextWitchingDate}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {result.tickers.map((t) => (
              <div key={t.ticker} className="jv-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{t.ticker}</div>
                  <div className="text-xs" style={{ color: "var(--text-2)" }}>n={t.eventsFound} real events</div>
                </div>
                {t.error ? (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                      <div>
                        <div className="jv-label">Avg witching-day move</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.dayOf.expectancy)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Avg volume vs 20d avg</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtRatio(t.dayOf.avgVolumeRatio)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Win Rate</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.dayOf.winRate !== null ? `${t.dayOf.winRate.toFixed(0)}%` : "N/A"}</div>
                      </div>
                      <div>
                        <div className="jv-label">Bootstrap 95% CI</div>
                        <div className="font-mono" style={{ color: t.dayOf.bootstrapCi.ciExcludesZero ? "var(--signal)" : "var(--text-2)" }}>
                          {t.dayOf.bootstrapCi.lower !== null && t.dayOf.bootstrapCi.upper !== null
                            ? `[${fmtPct(t.dayOf.bootstrapCi.lower)}, ${fmtPct(t.dayOf.bootstrapCi.upper)}]`
                            : "N/A"}
                        </div>
                      </div>
                    </div>

                    <div className="mb-2">
                      <div className="jv-label mb-1">Realized volatility: before vs. after vs. regular week</div>
                      <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ color: "var(--text-2)" }} className="text-left">
                            <th className="py-1 pr-3 font-normal"></th>
                            <th className="py-1 pr-3 font-normal text-right">Mean |return|</th>
                            <th className="py-1 pr-3 font-normal text-right">Mean range%</th>
                          </tr>
                        </thead>
                        <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                          <tr>
                            <td className="py-1 pr-3" style={{ color: "var(--text-1)" }}>Week before</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.weekBefore.meanAbsReturnPct, 3)}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.weekBefore.meanRangePct, 3)}</td>
                          </tr>
                          <tr>
                            <td className="py-1 pr-3" style={{ color: "var(--verdict)" }}>Week after</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--verdict)" }}>{fmtPct(t.weekAfter.meanAbsReturnPct, 3)}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--verdict)" }}>{fmtPct(t.weekAfter.meanRangePct, 3)}</td>
                          </tr>
                          <tr>
                            <td className="py-1 pr-3" style={{ color: "var(--text-2)" }}>Regular week (baseline)</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(t.regularWeek.meanAbsReturnPct, 3)}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(t.regularWeek.meanRangePct, 3)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <button
                      onClick={() => setExpandedTicker(expandedTicker === t.ticker ? null : t.ticker)}
                      className="text-xs underline"
                      style={{ color: "var(--text-2)" }}
                    >
                      {expandedTicker === t.ticker ? "Hide" : "Show"} event dates
                    </button>

                    {expandedTicker === t.ticker && (
                      <div className="mt-2 text-xs font-mono" style={{ color: "var(--text-2)" }}>
                        {t.dayOf.eventDates.join(", ")}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            {result.dataLimitations.map((d) => (
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
