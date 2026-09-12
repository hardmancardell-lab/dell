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

interface FomcMeetingReaction {
  decisionDate: string;
  regime: "hiking" | "cutting" | "holding" | null;
  day0ReturnPct: number | null;
  day1ReturnPct: number | null;
}

interface FomcOutcomeBucket extends WinLossMetrics {
  regime: "hiking" | "cutting" | "holding";
  sampleSize: number;
  day0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
}

interface FomcTickerReactionResult {
  ticker: string;
  meetings: FomcMeetingReaction[];
  overallSampleSize: number;
  overallDay0: WinLossMetrics;
  overallDay1: WinLossMetrics;
  overallDay0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  byRegime: FomcOutcomeBucket[];
  error?: string;
}

interface FomcReactionStudyResult {
  tickers: FomcTickerReactionResult[];
  upcomingMeeting: { date: string; note: string };
  dataLimitations: string[];
}

const DEFAULT_TICKERS = "GLD,NVDA,GOOGL,AAPL,INTC,AMD,META";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

export function FomcReactionStudyTab() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [result, setResult] = useState<FomcReactionStudyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fomc-reaction-study?tickers=${encodeURIComponent(tickers)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as FomcReactionStudyResult);
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
        Real event study: how each ticker has actually reacted on every FOMC decision day since 2023 (day-of and
        next-day % move), broken down by the trailing Fed-rate regime active at the time. The upcoming{" "}
        {result?.upcomingMeeting.date ?? "next"} meeting is tracked separately below — it isn&apos;t in these stats
        since it hasn&apos;t happened yet.
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
            <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
              Next meeting: {result.upcomingMeeting.date}
            </div>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>{result.upcomingMeeting.note}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {result.tickers.map((t) => (
              <div key={t.ticker} className="jv-card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{t.ticker}</div>
                  <div className="text-xs" style={{ color: "var(--text-2)" }}>n={t.overallSampleSize} real meetings</div>
                </div>
                {t.error ? (
                  <p className="text-xs" style={{ color: "var(--danger)" }}>{t.error}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm mb-2">
                      <div>
                        <div className="jv-label">Avg Day-0 Move</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{fmtPct(t.overallDay0.expectancy)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Win Rate (Day 0)</div>
                        <div className="font-mono" style={{ color: "var(--text-0)" }}>{t.overallDay0.winRate !== null ? `${t.overallDay0.winRate.toFixed(0)}%` : "N/A"}</div>
                      </div>
                      <div>
                        <div className="jv-label">Avg Day+1 Move</div>
                        <div className="font-mono" style={{ color: "var(--text-1)" }}>{fmtPct(t.overallDay1.expectancy)}</div>
                      </div>
                      <div>
                        <div className="jv-label">Bootstrap 95% CI (Day 0)</div>
                        <div className="font-mono" style={{ color: t.overallDay0BootstrapCi.ciExcludesZero ? "var(--signal)" : "var(--text-2)" }}>
                          {t.overallDay0BootstrapCi.lower !== null && t.overallDay0BootstrapCi.upper !== null
                            ? `[${fmtPct(t.overallDay0BootstrapCi.lower)}, ${fmtPct(t.overallDay0BootstrapCi.upper)}]`
                            : "N/A"}
                        </div>
                      </div>
                    </div>

                    {t.byRegime.length > 0 && (
                      <div className="mb-2">
                        <div className="jv-label mb-1">By Fed regime (trailing 6mo trend, day-0 move)</div>
                        {t.byRegime.map((b) => (
                          <div key={b.regime} className="flex justify-between text-xs font-mono" style={{ color: "var(--text-2)" }}>
                            <span className="capitalize">{b.regime} (n={b.sampleSize})</span>
                            <span style={{ color: "var(--text-1)" }}>
                              {fmtPct(b.expectancy)}
                              {b.day0BootstrapCi.ciExcludesZero ? " — significant" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setExpandedTicker(expandedTicker === t.ticker ? null : t.ticker)}
                      className="text-xs underline"
                      style={{ color: "var(--text-2)" }}
                    >
                      {expandedTicker === t.ticker ? "Hide" : "Show"} all {t.meetings.length} meetings
                    </button>

                    {expandedTicker === t.ticker && (
                      <div className="overflow-x-auto mt-2">
                        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                              <th className="py-1 pr-3 font-normal">Date</th>
                              <th className="py-1 pr-3 font-normal">Regime</th>
                              <th className="py-1 pr-3 font-normal text-right">Day 0</th>
                              <th className="py-1 pr-3 font-normal text-right">Day +1</th>
                            </tr>
                          </thead>
                          <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                            {t.meetings.map((m) => (
                              <tr key={m.decisionDate} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                                <td className="py-1 pr-3 font-mono" style={{ color: "var(--text-0)" }}>{m.decisionDate}</td>
                                <td className="py-1 pr-3 capitalize" style={{ color: "var(--text-2)" }}>{m.regime ?? "N/A"}</td>
                                <td className="py-1 pr-3 text-right font-mono" style={{ color: (m.day0ReturnPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(m.day0ReturnPct)}</td>
                                <td className="py-1 pr-3 text-right font-mono" style={{ color: (m.day1ReturnPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>{fmtPct(m.day1ReturnPct)}</td>
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
