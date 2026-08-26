"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { StatCard } from "./StatCard";
import type { BetaDriftResult, BuybackAnomalyResult, BuybackRegressionResult, DummyVariableRegressionResult } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}%` : "N/A";
}

function DummyRegressionCard({ title, reg }: { title: string; reg: DummyVariableRegressionResult | null }) {
  if (!reg) return <p className="text-sm" style={{ color: "var(--text-2)" }}>{title}: not enough data to fit.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
      <StatCard label={`${title} — γ`} value={`${reg.gamma >= 0 ? "+" : ""}${reg.gamma.toFixed(4)}%/$B`} />
      <StatCard label="Market β (same fit)" value={reg.marketBeta.toFixed(3)} />
      <StatCard label="R²" value={reg.rSquared.toFixed(3)} />
      <StatCard
        label="Bootstrap 95% CI (γ)"
        value={reg.gammaBootstrapLower !== null && reg.gammaBootstrapUpper !== null
          ? `${reg.gammaBootstrapLower.toFixed(4)} to ${reg.gammaBootstrapUpper.toFixed(4)}`
          : "N/A"}
        sub={reg.ciExcludesZero ? "excludes zero" : "includes zero — not significant"}
        tone={reg.ciExcludesZero ? "up" : "neutral"}
      />
      <StatCard label="n (all trading days)" value={String(reg.n)} />
    </div>
  );
}

function BetaDriftCard({ drift }: { drift: BetaDriftResult | null }) {
  if (!drift) return <p className="text-sm" style={{ color: "var(--text-2)" }}>Not enough non-event trading days to split-sample test.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <StatCard label={`Early β (n=${drift.earlyN})`} value={drift.earlyBeta.toFixed(3)} sub={`through ${drift.splitDateKey}`} />
      <StatCard label={`Late β (n=${drift.lateN})`} value={drift.lateBeta.toFixed(3)} sub={`since ${drift.splitDateKey}`} />
      <StatCard label="β Difference (late − early)" value={`${drift.betaDiff >= 0 ? "+" : ""}${drift.betaDiff.toFixed(3)}`} />
      <StatCard
        label="Bootstrap 95% CI (diff)"
        value={drift.diffBootstrapLower !== null && drift.diffBootstrapUpper !== null
          ? `${drift.diffBootstrapLower.toFixed(3)} to ${drift.diffBootstrapUpper.toFixed(3)}`
          : "N/A"}
        sub={drift.ciExcludesZero ? "excludes zero — real shift" : "includes zero — beta looks stable"}
        tone={drift.ciExcludesZero ? "down" : "neutral"}
      />
    </div>
  );
}

function RegressionCard({ title, reg }: { title: string; reg: BuybackRegressionResult | null }) {
  if (!reg) return <p className="text-sm" style={{ color: "var(--text-2)" }}>{title}: not enough matched events to regress.</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <StatCard label={`${title} — Slope`} value={`${reg.slope >= 0 ? "+" : ""}${reg.slope.toFixed(4)}%/$B`} />
      <StatCard label="R²" value={reg.rSquared.toFixed(3)} />
      <StatCard
        label="Bootstrap 95% CI (slope)"
        value={reg.bootstrapSlopeLower !== null && reg.bootstrapSlopeUpper !== null
          ? `${reg.bootstrapSlopeLower.toFixed(4)} to ${reg.bootstrapSlopeUpper.toFixed(4)}`
          : "N/A"}
        sub={reg.ciExcludesZero ? "excludes zero" : "includes zero — not significant"}
        tone={reg.ciExcludesZero ? "up" : "neutral"}
      />
      <StatCard label="Sample Size" value={String(reg.n)} />
    </div>
  );
}

function RegressionScatter({ title, data }: { title: string; data: { x: number; y: number }[] }) {
  if (data.length === 0) return null;
  return (
    <div>
      <h3 className="jv-strip-title mb-2">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis type="number" dataKey="x" name="Amount Accepted" unit="B" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
          <YAxis type="number" dataKey="y" name="Return" unit="%" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
          <Tooltip
            contentStyle={{ background: "var(--ink-900)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 12 }}
            formatter={(value, name) => [name === "Return" ? `${Number(value).toFixed(3)}%` : `$${Number(value).toFixed(2)}B`, name]}
          />
          <Scatter data={data} fill="var(--signal)" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BuybackAnomalyTab() {
  const [ticker, setTicker] = useState("GLD");
  const [result, setResult] = useState<BuybackAnomalyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/buyback-anomaly?ticker=${encodeURIComponent(ticker)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as BuybackAnomalyResult);
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
        Real event study: does the dollar size of a U.S. Treasury long-term ("20Y to 30Y" bucket) bond buyback
        operation predict {ticker}&apos;s % move on the operation day and the following day? Operation dates and
        accepted amounts come from Treasury&apos;s own public Fiscal Data API; price reactions come from this app&apos;s
        existing market-data pipeline. Every real return is reported three ways, cross-checking each other: a raw
        (naive) % move; a two-step market-model <strong>abnormal</strong> return (MacKinlay 1997); and the real
        single-pass event-study regression form <code>R_t = α + β·R_m,t + γ·D_t + ε</code> (Karafiath 1988; Binder
        1985/1998), where γ should land close to the two-step slope as a genuine cross-check. A time-varying-beta
        check (concept: Chow 1960) tests whether {ticker}&apos;s relationship to the dollar has structurally
        shifted over the sample. The raw figure is shown only for comparison, never as the primary result.
      </p>

      <div className="flex items-end gap-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Ticker</label>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} className="jv-input w-28" />
        </div>
        <button onClick={run} disabled={loading} className="jv-btn">
          {loading ? "Running…" : "Run Analysis"}
        </button>
      </div>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          {result.marketModel && (
            <div>
              <h3 className="jv-strip-title mb-2">Market Model</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard label="Benchmark" value={result.marketModel.benchmarkTicker} sub="dollar-strength proxy" />
                <StatCard label="Beta" value={result.marketModel.beta.toFixed(3)} />
                <StatCard label="Alpha" value={`${result.marketModel.alpha >= 0 ? "+" : ""}${result.marketModel.alpha.toFixed(4)}%/day`} />
                <StatCard label="R² / n" value={`${result.marketModel.rSquared.toFixed(3)} / ${result.marketModel.n}`} />
              </div>
            </div>
          )}

          <div>
            <h3 className="jv-strip-title mb-2">Time-Varying Beta / Structural Break Check</h3>
            <BetaDriftCard drift={result.betaDrift} />
          </div>

          <div>
            <h3 className="jv-strip-title mb-2">Day 0 — Abnormal Return (two-step, MacKinlay 1997)</h3>
            <RegressionCard title="Day 0 Abnormal" reg={result.day0AbnormalRegression} />
          </div>
          <RegressionScatter
            title="Amount Accepted vs. Day 0 Abnormal Return"
            data={result.events.filter((e) => e.day0AbnormalReturnPct !== null).map((e) => ({ x: e.amountAcceptedUsdBillions, y: e.day0AbnormalReturnPct as number }))}
          />
          <div>
            <h3 className="jv-strip-title mb-2">Day 0 — Single-Pass Dummy-Variable Regression (Karafiath 1988; Binder 1985/1998)</h3>
            <DummyRegressionCard title="Day 0" reg={result.day0DummyRegression} />
          </div>
          <div>
            <h3 className="jv-strip-title mb-2" style={{ color: "var(--text-2)" }}>Day 0 — Raw Return (naive, for comparison)</h3>
            <RegressionCard title="Day 0 Raw" reg={result.day0Regression} />
          </div>

          <div>
            <h3 className="jv-strip-title mb-2">Day +1 — Abnormal Return (two-step, MacKinlay 1997)</h3>
            <RegressionCard title="Day +1 Abnormal" reg={result.day1AbnormalRegression} />
          </div>
          <RegressionScatter
            title="Amount Accepted vs. Day +1 Abnormal Return"
            data={result.events.filter((e) => e.day1AbnormalReturnPct !== null).map((e) => ({ x: e.amountAcceptedUsdBillions, y: e.day1AbnormalReturnPct as number }))}
          />
          <div>
            <h3 className="jv-strip-title mb-2">Day +1 — Single-Pass Dummy-Variable Regression (Karafiath 1988; Binder 1985/1998)</h3>
            <DummyRegressionCard title="Day +1" reg={result.day1DummyRegression} />
          </div>
          <div>
            <h3 className="jv-strip-title mb-2" style={{ color: "var(--text-2)" }}>Day +1 — Raw Return (naive, for comparison)</h3>
            <RegressionCard title="Day +1 Raw" reg={result.day1Regression} />
          </div>

          <div className="overflow-x-auto">
            <h3 className="jv-strip-title mb-2">Matched Events ({result.events.length})</h3>
            <table className="jv-table">
              <thead>
                <tr>
                  <th className="text-left">Operation Date</th>
                  <th className="text-right">Amount Accepted</th>
                  <th className="text-right">Day 0 Raw</th>
                  <th className="text-right">Day 0 Abnormal</th>
                  <th className="text-right">Day +1 Raw</th>
                  <th className="text-right">Day +1 Abnormal</th>
                </tr>
              </thead>
              <tbody>
                {result.events.map((e) => (
                  <tr key={e.operationDate}>
                    <td>{e.operationDate}</td>
                    <td className="jv-num">${e.amountAcceptedUsdBillions.toFixed(2)}B</td>
                    <td className={`jv-num ${e.day0ReturnPct >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day0ReturnPct)}</td>
                    <td className={`jv-num ${(e.day0AbnormalReturnPct ?? 0) >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day0AbnormalReturnPct)}</td>
                    <td className={`jv-num ${e.day1ReturnPct >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day1ReturnPct)}</td>
                    <td className={`jv-num ${(e.day1AbnormalReturnPct ?? 0) >= 0 ? "jv-pnl-up" : "jv-pnl-down"}`}>{fmtPct(e.day1AbnormalReturnPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2">
            {result.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
