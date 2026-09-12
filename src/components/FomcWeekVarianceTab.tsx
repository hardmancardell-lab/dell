"use client";

import { useEffect, useState } from "react";

interface WeekOffsetStats {
  offsetFromDecision: number;
  weekdayLabel: string;
  sampleSize: number;
  meanAbsReturnPct: number | null;
  meanRangePct: number | null;
  stdDevReturnPct: number | null;
}

interface FomcWeekVarianceResult {
  ticker: string;
  fomcWeeksFound: number;
  regularWeeksFound: number;
  fomcWeek: WeekOffsetStats[];
  regularWeek: WeekOffsetStats[];
  dataLimitations: string[];
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v.toFixed(3)}%` : "N/A";
}

function Bar({ value, max, color }: { value: number | null; max: number; color: string }) {
  const widthPct = value !== null && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--ink-800)", borderRadius: 3, height: 6, width: "100%", overflow: "hidden" }}>
      <div style={{ width: `${widthPct}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
}

export function FomcWeekVarianceTab() {
  const [ticker, setTicker] = useState("GLD");
  const [result, setResult] = useState<FomcWeekVarianceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fomc-week-variance?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as FomcWeekVarianceResult);
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

  const maxRange =
    result != null
      ? Math.max(
          0.0001,
          ...result.fomcWeek.map((r) => r.meanRangePct ?? 0),
          ...result.regularWeek.map((r) => r.meanRangePct ?? 0)
        )
      : 1;

  const maxAbsReturn =
    result != null
      ? Math.max(
          0.0001,
          ...result.fomcWeek.map((r) => r.meanAbsReturnPct ?? 0),
          ...result.regularWeek.map((r) => r.meanAbsReturnPct ?? 0)
        )
      : 1;

  return (
    <div className="jarvis flex flex-col gap-6">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Real weekday-by-weekday variance comparison: does this ticker actually get more volatile heading into an FOMC
        decision than in a regular week? Every real FOMC decision date since 2015 is aligned to its real position in
        that trading week (Mon -2 .. Fri +2, decision day = 0) and compared against every non-FOMC week in the same
        history, using mean |return| and mean daily range% as two independent, real volatility proxies.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label className="jv-label block mb-1">Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input" style={{ width: 140 }} />
        </div>
        <button type="submit" disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Study"}
        </button>
      </form>

      {error && <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>}

      {result && (
        <div className="flex flex-col gap-6">
          <div className="jv-card" style={{ borderColor: "var(--verdict)" }}>
            <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>{result.ticker}</div>
            <p className="text-xs" style={{ color: "var(--text-2)" }}>
              {result.fomcWeeksFound} real FOMC weeks vs. {result.regularWeeksFound} real regular weeks in the available
              history.
            </p>
          </div>

          <div className="jv-card">
            <div className="jv-label mb-3">Mean daily range% (high-low ÷ prior close) — a volatility proxy independent of direction</div>
            <div className="flex flex-col gap-3">
              {result.fomcWeek.map((fomcDay, i) => {
                const regDay = result.regularWeek[i];
                return (
                  <div key={fomcDay.offsetFromDecision} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs" style={{ color: "var(--text-1)" }}>
                      <span>{fomcDay.weekdayLabel}</span>
                      <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                        FOMC {fmtPct(fomcDay.meanRangePct)} (n={fomcDay.sampleSize}) · Regular {fmtPct(regDay?.meanRangePct ?? null)} (n={regDay?.sampleSize ?? 0})
                      </span>
                    </div>
                    <Bar value={fomcDay.meanRangePct} max={maxRange} color="var(--signal)" />
                    <Bar value={regDay?.meanRangePct ?? null} max={maxRange} color="var(--text-2)" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="jv-card">
            <div className="jv-label mb-3">Mean |daily return%| — directional-move magnitude, ignoring sign</div>
            <div className="flex flex-col gap-3">
              {result.fomcWeek.map((fomcDay, i) => {
                const regDay = result.regularWeek[i];
                return (
                  <div key={fomcDay.offsetFromDecision} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs" style={{ color: "var(--text-1)" }}>
                      <span>{fomcDay.weekdayLabel}</span>
                      <span className="font-mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                        FOMC {fmtPct(fomcDay.meanAbsReturnPct)} (n={fomcDay.sampleSize}) · Regular {fmtPct(regDay?.meanAbsReturnPct ?? null)} (n={regDay?.sampleSize ?? 0})
                      </span>
                    </div>
                    <Bar value={fomcDay.meanAbsReturnPct} max={maxAbsReturn} color="var(--verdict)" />
                    <Bar value={regDay?.meanAbsReturnPct ?? null} max={maxAbsReturn} color="var(--text-2)" />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="jv-card overflow-x-auto">
            <div className="jv-label mb-2">Full detail table</div>
            <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-2)", borderBottom: "1px solid var(--line)" }} className="text-left">
                  <th className="py-1 pr-3 font-normal">Day</th>
                  <th className="py-1 pr-3 font-normal text-right">FOMC range%</th>
                  <th className="py-1 pr-3 font-normal text-right">Regular range%</th>
                  <th className="py-1 pr-3 font-normal text-right">FOMC |return|%</th>
                  <th className="py-1 pr-3 font-normal text-right">Regular |return|%</th>
                  <th className="py-1 pr-3 font-normal text-right">FOMC stdDev(return)</th>
                  <th className="py-1 pr-3 font-normal text-right">Regular stdDev(return)</th>
                </tr>
              </thead>
              <tbody style={{ fontVariantNumeric: "tabular-nums" }}>
                {result.fomcWeek.map((fomcDay, i) => {
                  const regDay = result.regularWeek[i];
                  return (
                    <tr key={fomcDay.offsetFromDecision} style={{ borderBottom: "1px solid var(--ink-800)" }}>
                      <td className="py-1 pr-3" style={{ color: "var(--text-0)" }}>{fomcDay.weekdayLabel}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--signal)" }}>{fmtPct(fomcDay.meanRangePct)}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(regDay?.meanRangePct ?? null)}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--verdict)" }}>{fmtPct(fomcDay.meanAbsReturnPct)}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(regDay?.meanAbsReturnPct ?? null)}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-1)" }}>{fmtPct(fomcDay.stdDevReturnPct)}</td>
                      <td className="py-1 pr-3 text-right font-mono" style={{ color: "var(--text-2)" }}>{fmtPct(regDay?.stdDevReturnPct ?? null)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
