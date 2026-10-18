"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { StatCard } from "./StatCard";
import { PriceChart } from "./PriceChart";
import { AllocationPieChart, withCashSlice } from "./AllocationPieChart";
import { RealizedPnlPanel } from "./RealizedPnlPanel";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import type { AssetClass, PortfolioSummary, RealizedSale } from "@/lib/agents/trading-agent/types";
import type { WashSaleFlag } from "@/lib/agents/trading-agent/skills/wash-sale-check";

// Loaded after the portfolio itself, so the figures above are not held up by the research code.
const ClientResearchView = dynamic(() => import("./ClientResearchView").then((m) => m.ClientResearchView), {
  ssr: false,
  loading: () => <p className="text-xs" style={{ color: "var(--text-2)" }}>Loading research…</p>,
});

const ClientNewsPanel = dynamic(() => import("./ClientNewsPanel").then((m) => m.ClientNewsPanel), { ssr: false });

function fmtUsd(v: number | null): string {
  return v !== null ? v.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "N/A";
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function fmtMarketCap(v: number | null): string {
  if (!v || v <= 0) return "N/A";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toLocaleString()}`;
}

interface DashboardResponse {
  clientName: string;
  summary: PortfolioSummary | null;
  holdingsCount: number;
  cashBalance: number;
  sales: RealizedSale[];
  totalRealizedPnl: number;
  washSaleFlags: WashSaleFlag[];
}

/** "as of 10:32 AM ET" text for the price notice, from the quote times the providers returned (not the page-load time). */
function priceAsOfText(oldest: number | null | undefined, delayed: boolean | undefined): string {
  if (typeof oldest !== "number") return "Quote times were not provided by the data source for these prices.";
  const when = new Date(oldest).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `The oldest price shown is as of ${when} ET${delayed ? " and some prices are delayed" : ""}.`;
}

export function ClientDashboardView({ slug }: { slug: string }) {
  const [state, setState] = useState<"loading" | "needs-passcode" | "ready" | "not-found" | "load-error">("loading");
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [passcode, setPasscode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; assetClass: AssetClass } | null>(null);
  // A research request answered 401 (the session ended or the passcode changed): ask for the passcode again.
  const sessionExpired = useCallback(() => setState("needs-passcode"), []);

  async function loadDashboard() {
    try {
      const res = await fetch(`/api/client/${slug}/dashboard`);
      if (res.status === 404) {
        setState("not-found");
        return;
      }
      if (res.status === 401) {
        setState("needs-passcode");
        return;
      }
      if (!res.ok) {
        setState("load-error");
        return;
      }
      const json = (await res.json()) as DashboardResponse;
      setData(json);
      setState("ready");
    } catch {
      setState("load-error");
    }
  }

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function submitPasscode(e: React.FormEvent) {
    e.preventDefault();
    if (!passcode.trim()) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: passcode.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? "Incorrect passcode.");
      } else {
        setPasscode("");
        await loadDashboard();
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setVerifying(false);
    }
  }

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--ink-950)" }} />;
  }

  if (state === "not-found") {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--ink-950)" }}>
        <p className="text-sm" style={{ color: "var(--text-2)" }}>This link isn&apos;t valid.</p>
      </div>
    );
  }

  if (state === "load-error") {
    return (
      <div className="jarvis min-h-screen flex items-center justify-center px-6" style={{ background: "var(--ink-950)" }}>
        <div className="w-full max-w-xs flex flex-col items-center gap-3 text-center">
          <p className="text-sm" style={{ color: "var(--text-1)" }}>
            Couldn&apos;t load this dashboard — check your connection and try again.
          </p>
          <button onClick={() => { setState("loading"); loadDashboard(); }} className="jv-btn">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state === "needs-passcode") {
    return (
      <div className="jarvis min-h-screen flex items-center justify-center px-6" style={{ background: "var(--ink-950)" }}>
        <form onSubmit={submitPasscode} className="w-full max-w-xs flex flex-col gap-3">
          <h1 className="text-sm font-semibold text-center mb-2" style={{ color: "var(--text-0)" }}>Enter Passcode</h1>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            autoFocus
            className="jv-input"
          />
          {error && <p className="text-xs text-center" style={{ color: "var(--danger)" }}>{error}</p>}
          <button type="submit" disabled={verifying || !passcode.trim()} className="jv-btn">
            {verifying ? "Checking…" : "View Dashboard"}
          </button>
        </form>
      </div>
    );
  }

  const { clientName, summary, holdingsCount, cashBalance, sales, totalRealizedPnl, washSaleFlags } = data!;
  const holdingsValue = summary?.totalValue ?? 0;
  const totalAccountValue = holdingsValue + cashBalance;

  return (
    <div className="jarvis min-h-screen px-6 py-10" style={{ background: "var(--ink-950)" }}>
      <div className="max-w-4xl mx-auto flex flex-col gap-8">
        <div>
          <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-2)" }}>Portfolio Dashboard</div>
          <h1 className="text-2xl font-semibold mt-1" style={{ color: "var(--text-0)" }}>{clientName}</h1>
        </div>

        <div className="jv-card" style={{ borderColor: "var(--signal-dim)" }}>
          <div className="text-xs" style={{ color: "var(--signal)" }}>
            Prices are fetched each time you load this page and are shown as of the quote time given by the data source. They may be delayed,
            and a price that could not be fetched is shown as unavailable and left out of the totals. {priceAsOfText(summary?.oldestPriceAsOf, summary?.anyPriceDelayed)}
            {summary && (summary.unpricedCount ?? 0) > 0 && (
              <span style={{ color: "var(--danger)" }}> {summary.unpricedCount} holding(s) have no price right now and are excluded from the totals.</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total Account Value" value={fmtUsd(totalAccountValue)} />
          <StatCard label="Cash Reserves" value={fmtUsd(cashBalance)} sub={totalAccountValue > 0 ? `${((cashBalance / totalAccountValue) * 100).toFixed(1)}% of account` : undefined} />
          {summary && (
            <>
              <StatCard label="Invested Cost Basis" value={fmtUsd(summary.totalCostBasis)} />
              <StatCard
                label="Unrealized P&L"
                value={fmtUsd(summary.totalUnrealizedPL)}
                sub={fmtPct(summary.totalUnrealizedPLPercent)}
                tone={summary.totalUnrealizedPL >= 0 ? "up" : "down"}
              />
              <StatCard label="Holdings" value={String(holdingsCount)} />
            </>
          )}
        </div>

        {holdingsCount === 0 || !summary ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            No holdings on file yet — the full {fmtUsd(cashBalance)} is held in cash reserves.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="overflow-x-auto">
              <table className="jv-table">
                <thead>
                  <tr>
                    <th className="text-left">Symbol</th>
                    <th className="text-left">Class</th>
                    <th className="text-right">Shares</th>
                    <th className="text-right">Avg Cost/Share</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">Value</th>
                    <th className="text-right">Market Cap</th>
                    <th className="text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.valuations.map((v) => {
                    const pnl = v.unrealizedPL;
                    const pnlClass = pnl === null ? "" : pnl > 0 ? "jv-pnl-up" : pnl < 0 ? "jv-pnl-down" : "jv-pnl-flat";
                    const isSelected = chartSymbol?.symbol === v.holding.symbol;
                    return (
                      <tr key={v.holding.id}>
                        <td className="font-medium">
                          <button
                            onClick={() =>
                              setChartSymbol(isSelected ? null : { symbol: v.holding.symbol, assetClass: v.holding.assetClass })
                            }
                            className="hover:underline"
                            style={{ color: isSelected ? "var(--signal)" : "inherit" }}
                          >
                            {v.holding.symbol}
                          </button>
                        </td>
                        <td style={{ color: "var(--text-2)" }}>{assetClassLabel(v.holding.assetClass)}</td>
                        <td className="jv-num">{v.holding.shares}</td>
                        <td className="jv-num" style={{ color: "var(--text-2)" }}>{fmtUsd(v.holding.costBasisPerShare)}</td>
                        <td className="jv-num">{v.error ? <span className="text-xs" style={{ color: "var(--danger)" }}>{v.error}</span> : fmtUsd(v.currentPrice)}</td>
                        <td className="jv-num">{fmtUsd(v.currentValue)}</td>
                        <td className="jv-num" style={{ color: "var(--text-2)" }}>{fmtMarketCap(v.marketCapUsd)}</td>
                        <td className={`jv-num ${pnlClass}`}>{fmtUsd(pnl)} ({fmtPct(v.unrealizedPLPercent)})</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {chartSymbol && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="jv-strip-title">{chartSymbol.symbol} Chart</h3>
                  <button onClick={() => setChartSymbol(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
                    Close ✕
                  </button>
                </div>
                <PriceChart symbol={chartSymbol.symbol} assetClass={chartSymbol.assetClass} readOnly />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <AllocationPieChart
                title="Allocation by Asset Class"
                slices={withCashSlice(summary.allocationByAssetClass, cashBalance, totalAccountValue)}
              />
              <AllocationPieChart
                title="Allocation by Sector"
                slices={withCashSlice(summary.allocationBySector, cashBalance, totalAccountValue)}
              />
            </div>

            {summary.dataLimitations.length > 0 && (
              <div className="flex flex-col gap-2">
                {summary.dataLimitations.map((d) => (
                  <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                    <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <RealizedPnlPanel sales={sales} totalRealizedPnl={totalRealizedPnl} washSaleFlags={washSaleFlags} />

        {/* Research: a section of the Portfolio view, not a separate tab. It hides itself when the owner switches it off (CLIENT_RESEARCH_ENABLED=false). */}
        <ClientResearchView slug={slug} onSessionExpired={sessionExpired} />

        {/* News on the client's holdings (the News agent's panel), directly under the research. */}
        <ClientNewsPanel slug={slug} />

        <p className="text-xs pt-6" style={{ color: "var(--text-2)", borderTop: "1px solid var(--line)" }}>
          Real market data, no fabricated figures. This is a portfolio snapshot, not investment advice.
        </p>
      </div>
    </div>
  );
}
