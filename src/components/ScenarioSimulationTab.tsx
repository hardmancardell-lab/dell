"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { MarketScenarioLabel, ScenarioSimulationResult } from "@/lib/agents/trading-agent/types";

const HORIZON_OPTIONS = [1, 3, 5, 10, 20];

const SCENARIO_META: Record<MarketScenarioLabel, { title: string; color: string }> = {
  good: { title: "Good Market", color: "var(--signal)" },
  average: { title: "Average Market", color: "var(--verdict)" },
  bad: { title: "Bad Market", color: "var(--danger)" },
};

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function ScenarioSimulationTab() {
  const { holdings, hydrated } = usePortfolio();
  const [horizonYears, setHorizonYears] = useState(10);
  const [result, setResult] = useState<ScenarioSimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const { track } = useTrackEvent();

  const runSimulation = useCallback(
    async (years: number) => {
      if (holdings.length === 0) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/scenario-simulation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holdings, horizonYears: years }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "Unknown error");
          track("api_error", { tab: "Scenario Simulation", metadata: { endpoint: "scenario-simulation", status: res.status } });
        } else {
          setResult(json as ScenarioSimulationResult);
          track("scenario_simulation_run", { tab: "Scenario Simulation", metadata: { horizonYears: years } });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        track("api_error", { tab: "Scenario Simulation", metadata: { endpoint: "scenario-simulation", status: 0 } });
      } finally {
        setLoading(false);
      }
    },
    [holdings]
  );

  useEffect(() => {
    if (hydrated && !checked && holdings.length > 0) {
      setChecked(true);
      runSimulation(horizonYears);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked, holdings.length]);

  const chartData = result
    ? Array.from({ length: horizonYears + 1 }, (_, year) => {
        const row: Record<string, number> = { year };
        for (const scenario of result.scenarios) {
          const point = scenario.projection[year];
          if (!point) continue;
          row[`${scenario.label}P10`] = point.p10;
          row[`${scenario.label}Band`] = point.p90 - point.p10;
          row[`${scenario.label}P50`] = point.p50;
        }
        return row;
      })
    : [];

  return (
    <div className="jarvis flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <p className="jv-lede flex-1" style={{ marginBottom: 0 }}>
          Projects your current portfolio value forward under three real historical market regimes — not portfolio
          weight combinations (that&apos;s the Modern Portfolio Theory tab&apos;s efficient frontier), but your actual
          holdings compounding through time. &quot;Good&quot;, &quot;average&quot;, and &quot;bad&quot; are the mean of
          the top tercile, full-sample mean, and mean of the bottom tercile of real historical SPY rolling 1-year
          returns — never a hardcoded assumption. Each scenario runs 1,000 simulated paths reflecting your
          portfolio&apos;s own beta and volatility, shown as a p10-p90 range, not a single predicted number.
        </p>
        <button
          onClick={() => runSimulation(horizonYears)}
          disabled={loading || holdings.length === 0}
          className="jv-btn-outline shrink-0"
        >
          {loading ? "Simulating…" : "Run Simulation"}
        </button>
      </div>

      {holdings.length === 0 && <p className="text-sm" style={{ color: "var(--text-2)" }}>Add holdings on the Dashboard tab first.</p>}

      <div className="flex items-center gap-2">
        <span className="jv-label" style={{ marginBottom: 0 }}>Horizon</span>
        {HORIZON_OPTIONS.map((y) => (
          <button
            key={y}
            onClick={() => {
              setHorizonYears(y);
              if (holdings.length > 0) runSimulation(y);
            }}
            className={y === horizonYears ? "jv-btn" : "jv-btn-outline"}
            style={{ padding: "4px 12px" }}
          >
            {y}yr
          </button>
        ))}
      </div>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="jv-label">Current Value</div>
              <div style={{ color: "var(--text-0)" }}>{fmtUsd(result.currentPortfolioValue)}</div>
            </div>
            <div>
              <div className="jv-label">Portfolio Beta (vs SPY)</div>
              <div style={{ color: "var(--text-0)" }}>{result.portfolioBeta !== null ? result.portfolioBeta.toFixed(2) : "N/A"}</div>
            </div>
            <div>
              <div className="jv-label">Portfolio Alpha (ann.)</div>
              <div style={{ color: "var(--text-0)" }}>{result.portfolioAlpha !== null ? fmtPct(result.portfolioAlpha * 100) : "N/A"}</div>
            </div>
          </div>

          <section>
            <h3 className="jv-strip-title">Projected Value ({horizonYears}yr, p10-p90 range)</h3>
            <div className="jv-card">
              <div className="jv-br-b" />
              <ComposedChart width={700} height={360} data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis
                  dataKey="year"
                  tick={{ fontSize: 11, fill: "var(--text-2)" }}
                  stroke="var(--line)"
                  label={{ value: "Years", position: "insideBottom", offset: -10, fontSize: 11, fill: "var(--text-2)" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" tickFormatter={(v) => fmtUsd(Number(v))} width={90} />
                <Tooltip
                  formatter={(v) => fmtUsd(Number(v))}
                  labelFormatter={(y) => `Year ${y}`}
                  contentStyle={{ background: "var(--ink-800)", border: "1px solid var(--line-bright)", color: "var(--text-0)", fontSize: 12 }}
                  labelStyle={{ color: "var(--text-1)" }}
                />
                {(["good", "average", "bad"] as MarketScenarioLabel[]).map((label) => (
                  <Area
                    key={`${label}-p10`}
                    type="monotone"
                    dataKey={`${label}P10`}
                    stackId={label}
                    stroke="none"
                    fill="transparent"
                    isAnimationActive={false}
                  />
                ))}
                {(["good", "average", "bad"] as MarketScenarioLabel[]).map((label) => (
                  <Area
                    key={`${label}-band`}
                    type="monotone"
                    dataKey={`${label}Band`}
                    stackId={label}
                    stroke="none"
                    fill={SCENARIO_META[label].color}
                    fillOpacity={0.15}
                    isAnimationActive={false}
                  />
                ))}
                {(["good", "average", "bad"] as MarketScenarioLabel[]).map((label) => (
                  <Line
                    key={`${label}-p50`}
                    type="monotone"
                    dataKey={`${label}P50`}
                    stroke={SCENARIO_META[label].color}
                    strokeWidth={2}
                    dot={false}
                    name={SCENARIO_META[label].title}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </div>
          </section>

          <section>
            <h3 className="jv-strip-title">Scenario Summary</h3>
            <div className="overflow-x-auto">
              <table className="jv-table">
                <thead>
                  <tr>
                    <th className="text-left">Scenario</th>
                    <th className="text-right">Assumed Annual Return</th>
                    <th className="text-left">Basis</th>
                    <th className="text-right">Ending Value (p10 / p50 / p90)</th>
                    <th className="text-right">Total Return (p50)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((s) => (
                    <tr key={s.label}>
                      <td className="font-medium" style={{ color: SCENARIO_META[s.label].color }}>{SCENARIO_META[s.label].title}</td>
                      <td className="jv-num">{fmtPct(s.assumption.annualReturn * 100)}</td>
                      <td className="text-xs" style={{ color: "var(--text-2)" }}>
                        {s.assumption.sampleYears.toFixed(1)}yr history, {s.assumption.sampleSize} samples
                      </td>
                      <td className="jv-num text-xs">
                        {fmtUsd(s.endingValue.p10)} / {fmtUsd(s.endingValue.p50)} / {fmtUsd(s.endingValue.p90)}
                      </td>
                      <td className="jv-num">{fmtPct(s.totalReturnPercent.p50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {result.dataLimitations.length > 0 && (
            <div className="flex flex-col gap-2">
              {result.dataLimitations.map((d) => (
                <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                  <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
