"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import type { PortfolioAnalyticsResult } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A";
}

function corrColor(v: number | null): string {
  if (v === null) return "";
  if (v >= 0.7) return "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-400";
  if (v >= 0.3) return "bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400";
  if (v <= -0.3) return "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400";
  return "bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400";
}

export function ModernPortfolioTab() {
  const { holdings, hydrated } = usePortfolio();
  const [result, setResult] = useState<PortfolioAnalyticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const runAnalytics = useCallback(async () => {
    if (holdings.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setResult(json as PortfolioAnalyticsResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    if (hydrated && !checked && holdings.length > 0) {
      setChecked(true);
      runAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked, holdings.length]);

  const cloud = result?.frontier.simulatedPortfolios.map((p) => ({ x: p.volatility * 100, y: p.expectedReturn * 100 })) ?? [];
  const maxSharpePt = result?.frontier.maxSharpe
    ? [{ x: result.frontier.maxSharpe.volatility * 100, y: result.frontier.maxSharpe.expectedReturn * 100 }]
    : [];
  const minVolPt = result?.frontier.minVolatility
    ? [{ x: result.frontier.minVolatility.volatility * 100, y: result.frontier.minVolatility.expectedReturn * 100 }]
    : [];
  const currentPt = result?.frontier.current
    ? [{ x: result.frontier.current.volatility * 100, y: result.frontier.current.expectedReturn * 100 }]
    : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <p className="text-zinc-500 flex-1">
          How your holdings move together, not how good any one of them is. Beta measures each holding&apos;s
          sensitivity to the market (via SPY); the correlation matrix and simulated efficient frontier show whether
          your portfolio is actually diversified or just holds a lot of names that move in lockstep.
        </p>
        <button
          onClick={runAnalytics}
          disabled={loading || holdings.length === 0}
          className="shrink-0 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {loading ? "Computing…" : "Refresh"}
        </button>
      </div>

      {holdings.length === 0 && <p className="text-sm text-zinc-500">Add holdings on the Dashboard tab first.</p>}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-8">
          <section>
            <h3 className="text-sm font-semibold mb-3">Beta vs. {result.benchmark} ({result.lookbackDays}-day lookback)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                    <th className="py-2 pr-4">Symbol</th>
                    <th className="py-2 pr-4">Beta</th>
                    <th className="py-2 pr-4">Alpha (daily)</th>
                    <th className="py-2 pr-4">R²</th>
                    <th className="py-2 pr-4">N</th>
                    <th className="py-2 pr-4">Volatility (ann.)</th>
                    <th className="py-2 pr-4">Risk Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {result.betas.map((b) => (
                    <tr key={b.symbol} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-2 pr-4 font-medium">{b.symbol}</td>
                      <td className="py-2 pr-4">{b.beta !== null ? b.beta.toFixed(2) : <span className="text-zinc-500 text-xs">{b.error}</span>}</td>
                      <td className="py-2 pr-4 text-zinc-500">{b.alpha !== null ? b.alpha.toFixed(4) : "N/A"}</td>
                      <td className="py-2 pr-4 text-zinc-500">{b.rSquared !== null ? b.rSquared.toFixed(3) : "N/A"}</td>
                      <td className="py-2 pr-4 text-zinc-500">{b.n}</td>
                      <td className="py-2 pr-4 text-zinc-500">
                        {b.volatilityAnnualizedPercent !== null ? `${b.volatilityAnnualizedPercent.toFixed(1)}%` : "N/A"}
                      </td>
                      <td className="py-2 pr-4">
                        {b.riskTier && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              b.riskTier === "low"
                                ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                                : b.riskTier === "medium"
                                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                                  : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                            }`}
                          >
                            {b.riskTier}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-3">Correlation Matrix</h3>
            {result.correlationMatrix.symbols.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2"></th>
                      {result.correlationMatrix.symbols.map((s) => (
                        <th key={s} className="p-2 text-xs font-medium text-zinc-500">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.correlationMatrix.symbols.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <td className="p-2 text-xs font-medium text-zinc-500">{rowSym}</td>
                        {result.correlationMatrix.matrix[i].map((v, j) => (
                          <td key={j} className={`p-2 text-center text-xs ${corrColor(v)}`}>
                            {v !== null ? v.toFixed(2) : "N/A"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Not enough overlapping history to compute a correlation matrix.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-3">Simulated Efficient Frontier</h3>
            {cloud.length > 0 ? (
              <>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
                  <ScatterChart width={640} height={360} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-zinc-200 dark:stroke-zinc-800" />
                    <XAxis type="number" dataKey="x" name="Volatility" unit="%" tick={{ fontSize: 11 }} />
                    <YAxis type="number" dataKey="y" name="Expected Return" unit="%" tick={{ fontSize: 11 }} />
                    <ZAxis range={[10, 10]} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} formatter={(v) => `${Number(v).toFixed(2)}%`} />
                    <Scatter name="Simulated" data={cloud} fill="#a1a1aa" opacity={0.35} />
                    <Scatter name="Max Sharpe" data={maxSharpePt} fill="#22c55e" shape="star" />
                    <Scatter name="Min Volatility" data={minVolPt} fill="#3b82f6" shape="diamond" />
                    <Scatter name="Current Portfolio" data={currentPt} fill="#ef4444" shape="cross" />
                  </ScatterChart>
                </div>
                {result.frontier.maxSharpe && result.frontier.minVolatility && result.frontier.current && (
                  <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-green-700 dark:text-green-500 mb-1">Max Sharpe</div>
                      <div>Return {fmtPct(result.frontier.maxSharpe.expectedReturn)}, Vol {fmtPct(result.frontier.maxSharpe.volatility)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-500 mb-1">Min Volatility</div>
                      <div>Return {fmtPct(result.frontier.minVolatility.expectedReturn)}, Vol {fmtPct(result.frontier.minVolatility.volatility)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wide text-red-700 dark:text-red-500 mb-1">Your Portfolio</div>
                      <div>Return {fmtPct(result.frontier.current.expectedReturn)}, Vol {fmtPct(result.frontier.current.volatility)}</div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500">Not enough overlapping history to simulate a frontier.</p>
            )}
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
