"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { useTrackEvent } from "@/lib/analytics/use-track";
import type { PortfolioAnalyticsResult } from "@/lib/agents/trading-agent/types";

function fmtPct(v: number | null): string {
  return v !== null ? `${(v * 100).toFixed(2)}%` : "N/A";
}

function corrStyle(v: number | null): { color: string; background: string } {
  if (v === null) return { color: "var(--text-2)", background: "transparent" };
  if (v >= 0.7) return { color: "var(--danger)", background: "rgba(232, 99, 122, 0.1)" };
  if (v >= 0.3) return { color: "var(--verdict)", background: "rgba(240, 168, 104, 0.1)" };
  if (v <= -0.3) return { color: "var(--signal)", background: "rgba(79, 232, 208, 0.08)" };
  return { color: "var(--text-1)", background: "transparent" };
}

const RISK_TIER_STYLE: Record<string, { color: string; borderColor: string; background: string }> = {
  low: { color: "var(--signal)", borderColor: "var(--signal-dim)", background: "rgba(79, 232, 208, 0.06)" },
  medium: { color: "var(--verdict)", borderColor: "var(--verdict-dim)", background: "rgba(240, 168, 104, 0.08)" },
  high: { color: "var(--danger)", borderColor: "var(--danger)", background: "rgba(232, 99, 122, 0.08)" },
};

export function ModernPortfolioTab() {
  const { holdings, hydrated } = usePortfolio();
  const [result, setResult] = useState<PortfolioAnalyticsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const { track } = useTrackEvent();

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
      if (!res.ok) {
        setError(json.error ?? "Unknown error");
        track("api_error", { tab: "Modern Portfolio Theory", metadata: { endpoint: "portfolio-analytics", status: res.status } });
      } else {
        setResult(json as PortfolioAnalyticsResult);
        track("mpt_analysis_run", { tab: "Modern Portfolio Theory", metadata: { holdingCount: holdings.length } });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      track("api_error", { tab: "Modern Portfolio Theory", metadata: { endpoint: "portfolio-analytics", status: 0 } });
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
    <div className="jarvis flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <p className="jv-lede flex-1" style={{ marginBottom: 0 }}>
          How your holdings move together, not how good any one of them is. Beta measures each holding&apos;s
          sensitivity to the market (via SPY); the correlation matrix and simulated efficient frontier show whether
          your portfolio is actually diversified or just holds a lot of names that move in lockstep.
        </p>
        <button
          onClick={runAnalytics}
          disabled={loading || holdings.length === 0}
          className="jv-btn-outline shrink-0"
        >
          {loading ? "Computing…" : "Refresh"}
        </button>
      </div>

      {holdings.length === 0 && <p className="text-sm" style={{ color: "var(--text-2)" }}>Add holdings on the Dashboard tab first.</p>}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {result && (
        <div className="flex flex-col gap-8">
          <section>
            <h3 className="jv-strip-title">Beta vs. {result.benchmark} ({result.lookbackDays}-day lookback)</h3>
            <div className="overflow-x-auto">
              <table className="jv-table">
                <thead>
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-right">Beta</th>
                    <th className="text-right">Alpha (daily)</th>
                    <th className="text-right">R²</th>
                    <th className="text-right">N</th>
                    <th className="text-right">Volatility (ann.)</th>
                    <th className="text-left">Risk Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {result.betas.map((b) => (
                    <tr key={b.symbol}>
                      <td className="font-medium">{b.symbol}</td>
                      <td className="jv-num">{b.beta !== null ? b.beta.toFixed(2) : <span className="text-xs" style={{ color: "var(--text-2)" }}>{b.error}</span>}</td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>{b.alpha !== null ? b.alpha.toFixed(4) : "N/A"}</td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>{b.rSquared !== null ? b.rSquared.toFixed(3) : "N/A"}</td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>{b.n}</td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>
                        {b.volatilityAnnualizedPercent !== null ? `${b.volatilityAnnualizedPercent.toFixed(1)}%` : "N/A"}
                      </td>
                      <td>
                        {b.riskTier && (
                          <span className="jv-badge" style={RISK_TIER_STYLE[b.riskTier]}>
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
            <h3 className="jv-strip-title">Correlation Matrix</h3>
            {result.correlationMatrix.symbols.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="text-sm" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th className="p-2"></th>
                      {result.correlationMatrix.symbols.map((s) => (
                        <th key={s} className="p-2 text-xs font-medium" style={{ color: "var(--text-2)" }}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.correlationMatrix.symbols.map((rowSym, i) => (
                      <tr key={rowSym}>
                        <td className="p-2 text-xs font-medium" style={{ color: "var(--text-2)" }}>{rowSym}</td>
                        {result.correlationMatrix.matrix[i].map((v, j) => (
                          <td key={j} className="p-2 text-center text-xs" style={corrStyle(v)}>
                            {v !== null ? v.toFixed(2) : "N/A"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>Not enough overlapping history to compute a correlation matrix.</p>
            )}
          </section>

          <section>
            <h3 className="jv-strip-title">Simulated Efficient Frontier</h3>
            {cloud.length > 0 ? (
              <>
                <div className="jv-card">
                  <div className="jv-br-b" />
                  <ScatterChart width={640} height={360} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis type="number" dataKey="x" name="Volatility" unit="%" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
                    <YAxis type="number" dataKey="y" name="Expected Return" unit="%" tick={{ fontSize: 11, fill: "var(--text-2)" }} stroke="var(--line)" />
                    <ZAxis range={[10, 10]} />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3", stroke: "var(--line-bright)" }}
                      formatter={(v) => `${Number(v).toFixed(2)}%`}
                      contentStyle={{ background: "var(--ink-800)", border: "1px solid var(--line-bright)", color: "var(--text-0)", fontSize: 12 }}
                      labelStyle={{ color: "var(--text-1)" }}
                    />
                    <Scatter name="Simulated" data={cloud} fill="var(--line-bright)" opacity={0.35} />
                    <Scatter name="Max Sharpe" data={maxSharpePt} fill="var(--signal)" shape="star" />
                    <Scatter name="Min Volatility" data={minVolPt} fill="var(--verdict)" shape="diamond" />
                    <Scatter name="Current Portfolio" data={currentPt} fill="var(--danger)" shape="cross" />
                  </ScatterChart>
                </div>
                {result.frontier.maxSharpe && result.frontier.minVolatility && result.frontier.current && (
                  <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
                    <div>
                      <div className="jv-label" style={{ color: "var(--signal)" }}>Max Sharpe</div>
                      <div style={{ color: "var(--text-1)" }}>Return {fmtPct(result.frontier.maxSharpe.expectedReturn)}, Vol {fmtPct(result.frontier.maxSharpe.volatility)}</div>
                    </div>
                    <div>
                      <div className="jv-label" style={{ color: "var(--verdict)" }}>Min Volatility</div>
                      <div style={{ color: "var(--text-1)" }}>Return {fmtPct(result.frontier.minVolatility.expectedReturn)}, Vol {fmtPct(result.frontier.minVolatility.volatility)}</div>
                    </div>
                    <div>
                      <div className="jv-label" style={{ color: "var(--danger)" }}>Your Portfolio</div>
                      <div style={{ color: "var(--text-1)" }}>Return {fmtPct(result.frontier.current.expectedReturn)}, Vol {fmtPct(result.frontier.current.volatility)}</div>
                    </div>
                  </div>
                )}
                {(result.portfolioSortinoRatioAnnualized !== null ||
                  result.portfolioMaxDrawdownPct !== null ||
                  result.portfolioHistoricalVaR95Pct !== null) && (
                  <div className="grid grid-cols-3 gap-4 mt-4 pt-4 text-sm" style={{ borderTop: "1px solid var(--line)" }}>
                    <div>
                      <div className="jv-label">Sortino Ratio (ann.)</div>
                      <div style={{ color: "var(--text-0)" }}>{result.portfolioSortinoRatioAnnualized !== null ? result.portfolioSortinoRatioAnnualized.toFixed(2) : "N/A"}</div>
                    </div>
                    <div>
                      <div className="jv-label">Max Drawdown</div>
                      <div style={{ color: "var(--text-0)" }}>{result.portfolioMaxDrawdownPct !== null ? `${result.portfolioMaxDrawdownPct.toFixed(2)}%` : "N/A"}</div>
                    </div>
                    <div>
                      <div className="jv-label">1-Day 95% VaR</div>
                      <div style={{ color: "var(--text-0)" }}>{result.portfolioHistoricalVaR95Pct !== null ? `${result.portfolioHistoricalVaR95Pct.toFixed(2)}%` : "N/A"}</div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--text-2)" }}>Not enough overlapping history to simulate a frontier.</p>
            )}
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
