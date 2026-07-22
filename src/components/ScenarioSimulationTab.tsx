"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import type { MarketScenarioLabel, ScenarioSimulationResult } from "@/lib/agents/trading-agent/types";

const HORIZON_OPTIONS = [1, 3, 5, 10, 20];

const SCENARIO_META: Record<MarketScenarioLabel, { title: string; color: string; textClass: string }> = {
  good: { title: "Good Market", color: "#22c55e", textClass: "text-green-700 dark:text-green-500" },
  average: { title: "Average Market", color: "#3b82f6", textClass: "text-blue-700 dark:text-blue-500" },
  bad: { title: "Bad Market", color: "#ef4444", textClass: "text-red-700 dark:text-red-500" },
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
        if (!res.ok) setError(json.error ?? "Unknown error");
        else setResult(json as ScenarioSimulationResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
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
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <p className="text-zinc-500 flex-1">
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
          className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Simulating…" : "Run Simulation"}
        </button>
      </div>

      {holdings.length === 0 && <p className="text-sm text-zinc-500">Add holdings on the Dashboard tab first.</p>}

      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Horizon</span>
        {HORIZON_OPTIONS.map((y) => (
          <button
            key={y}
            onClick={() => {
              setHorizonYears(y);
              if (holdings.length > 0) runSimulation(y);
            }}
            className={`rounded-lg px-3 py-1 text-xs font-medium ${
              y === horizonYears
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
            }`}
          >
            {y}yr
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-8">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Current Value</div>
              <div className="font-medium">{fmtUsd(result.currentPortfolioValue)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Portfolio Beta (vs SPY)</div>
              <div className="font-medium">{result.portfolioBeta !== null ? result.portfolioBeta.toFixed(2) : "N/A"}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-1">Portfolio Alpha (ann.)</div>
              <div className="font-medium">{result.portfolioAlpha !== null ? fmtPct(result.portfolioAlpha * 100) : "N/A"}</div>
            </div>
          </div>

          <section>
            <h3 className="text-sm font-semibold mb-3">Projected Value ({horizonYears}yr, p10-p90 range)</h3>
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
              <ComposedChart width={700} height={360} data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} label={{ value: "Years", position: "insideBottom", offset: -10, fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtUsd(Number(v))} width={90} />
                <Tooltip formatter={(v) => fmtUsd(Number(v))} labelFormatter={(y) => `Year ${y}`} />
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
            <h3 className="text-sm font-semibold mb-3">Scenario Summary</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Scenario</th>
                    <th className="py-2 pr-4">Assumed Annual Return</th>
                    <th className="py-2 pr-4">Basis</th>
                    <th className="py-2 pr-4">Ending Value (p10 / p50 / p90)</th>
                    <th className="py-2 pr-4">Total Return (p50)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.scenarios.map((s) => (
                    <tr key={s.label} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className={`py-2 pr-4 font-medium ${SCENARIO_META[s.label].textClass}`}>{SCENARIO_META[s.label].title}</td>
                      <td className="py-2 pr-4">{fmtPct(s.assumption.annualReturn * 100)}</td>
                      <td className="py-2 pr-4 text-zinc-500 text-xs">
                        {s.assumption.sampleYears.toFixed(1)}yr history, {s.assumption.sampleSize} samples
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {fmtUsd(s.endingValue.p10)} / {fmtUsd(s.endingValue.p50)} / {fmtUsd(s.endingValue.p90)}
                      </td>
                      <td className="py-2 pr-4">{fmtPct(s.totalReturnPercent.p50)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {result.dataLimitations.length > 0 && (
            <div className="space-y-2">
              {result.dataLimitations.map((d) => (
                <div
                  key={d.slice(0, 30)}
                  className="rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-2 text-xs text-amber-800 dark:text-amber-400"
                >
                  {d}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
