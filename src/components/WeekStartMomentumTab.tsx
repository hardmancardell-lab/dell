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

interface WeekStartBucket extends WinLossMetrics {
  label: string;
  minReturnPct: number | null;
  maxReturnPct: number | null;
  sampleSize: number;
  bootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
}

interface WeekStartMomentumResult {
  ticker: string;
  weeksFound: number;
  correlationMondayVsRestOfWeek: number | null;
  buckets: WeekStartBucket[];
  currentWeek: {
    mondayDateKey: string | null;
    firstDayReturnPct: number | null;
    matchingBucketLabel: string | null;
  };
  error?: string;
}

const DEFAULT_TICKERS = "SMH,SOXX,QQQ,XLK";

function fmtPct(v: number | null, digits = 2): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%` : "N/A";
}

export function WeekStartMomentumTab() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [results, setResults] = useState<WeekStartMomentumResult[] | null>(null);
  const [dataLimitations, setDataLimitations] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/week-start-momentum?tickers=${encodeURIComponent(tickers)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else {
        setResults(json.tickers as WeekStartMomentumResult[]);
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
        Real conditional study: given how a ticker's week actually started (its first real trading day's move,
        bucketed into fixed ranges), how has the rest of that week historically turned out — does a strong start tend
        to continue (momentum) or fade (mean reversion)? Also shows which bucket the current week's real move falls
        into right now.
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
                  <div className="text-xs" style={{ color: "var(--text-2)" }}>n={t.weeksFound} real weeks</div>
                </div>
                {t.error ? (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
                ) : (
                  <>
                    <div className="jv-card mb-3" style={{ borderColor: "var(--verdict)" }}>
                      <div className="text-xs" style={{ color: "var(--text-2)" }}>This week&apos;s start ({t.currentWeek.mondayDateKey ?? "N/A"})</div>
                      <div className="text-sm font-mono" style={{ color: "var(--text-0)" }}>
                        {fmtPct(t.currentWeek.firstDayReturnPct)} — bucket: <span style={{ color: "var(--verdict)" }}>{t.currentWeek.matchingBucketLabel ?? "N/A"}</span>
                      </div>
                    </div>

                    <div className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
                      Correlation (first-day move vs. rest-of-week move): <span className="font-mono" style={{ color: "var(--text-0)" }}>{t.correlationMondayVsRestOfWeek !== null ? t.correlationMondayVsRestOfWeek.toFixed(3) : "N/A"}</span>
                      {t.correlationMondayVsRestOfWeek !== null && (
                        <span> — {t.correlationMondayVsRestOfWeek > 0.1 ? "leans momentum" : t.correlationMondayVsRestOfWeek < -0.1 ? "leans mean-reversion" : "weak/no relationship"}</span>
                      )}
                    </div>

                    <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                          <th className="py-1 pr-3 font-normal">First-day bucket</th>
                          <th className="py-1 pr-3 font-normal text-right">n</th>
                          <th className="py-1 pr-3 font-normal text-right">Rest-of-week avg</th>
                          <th className="py-1 pr-3 font-normal text-right">Win rate</th>
                        </tr>
                      </thead>
                      <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                        {t.buckets.map((b) => (
                          <tr
                            key={b.label}
                            style={{
                              borderBottom: "1px solid var(--ink-800)",
                              background: b.label === t.currentWeek.matchingBucketLabel ? "var(--verdict-dim)" : undefined,
                            }}
                          >
                            <td className="py-1 pr-3" style={{ color: "var(--text-0)" }}>{b.label}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{b.sampleSize}</td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: (b.expectancy ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>
                              {fmtPct(b.expectancy)}{b.bootstrapCi.ciExcludesZero ? "*" : ""}
                            </td>
                            <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-1)" }}>{b.winRate !== null ? `${b.winRate.toFixed(0)}%` : "N/A"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>* statistically significant (bootstrap 95% CI excludes zero)</p>
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
