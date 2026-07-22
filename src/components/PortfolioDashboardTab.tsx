"use client";

import { useCallback, useEffect, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import type { AssetClass, PortfolioSummary } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

function fmtUsd(v: number | null): string {
  return v !== null ? v.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "N/A";
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`text-2xl font-semibold mt-1 ${
          tone === "good" ? "text-green-600 dark:text-green-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : ""
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-sm text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function AllocationBars({ title, slices }: { title: string; slices: { label: string; value: number; percent: number }[] }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="space-y-2">
        {slices.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>{s.label}</span>
              <span>{s.percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${Math.min(s.percent, 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PortfolioDashboardTab() {
  const { holdings, hydrated, addHolding, removeHolding } = usePortfolio();
  const [symbolInput, setSymbolInput] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoValued, setAutoValued] = useState(false);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const sharesNum = Number(shares);
    const costBasisNum = Number(costBasis);
    if (!symbolInput.trim() || !Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(costBasisNum)) return;
    addHolding(symbolInput, assetClass, sharesNum, costBasisNum, acquiredDate);
    setSymbolInput("");
    setShares("");
    setCostBasis("");
  }

  const runValuation = useCallback(async () => {
    if (holdings.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-valuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setSummary(json as PortfolioSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    if (hydrated && !autoValued && holdings.length > 0) {
      setAutoValued(true);
      runValuation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, autoValued, holdings.length]);

  return (
    <div className="space-y-8">
      <p className="text-zinc-500">
        Manually track real holdings — shares, cost basis, and acquisition date — valued against live market data
        (same real providers as the rest of this app: Alpaca for equities, OANDA for forex). No brokerage account
        linking; this is a read-only tracker, consistent with the rest of this app's data-and-analysis-only scope.
      </p>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3">
        <input
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          placeholder="Symbol, e.g. AAPL"
          className="w-32 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        >
          {ASSET_CLASSES.map((ac) => (
            <option key={ac} value={ac}>
              {assetClassLabel(ac)}
            </option>
          ))}
        </select>
        <input
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="Shares"
          type="number"
          step="any"
          className="w-28 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <input
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          placeholder="Cost basis / share"
          type="number"
          step="any"
          className="w-40 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <input
          value={acquiredDate}
          onChange={(e) => setAcquiredDate(e.target.value)}
          type="date"
          className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-4 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium">
          Add Holding
        </button>
      </form>

      {hydrated && holdings.length === 0 && (
        <p className="text-sm text-zinc-500">Portfolio is empty — add a holding above to get started.</p>
      )}

      {holdings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4">Symbol</th>
                <th className="py-2 pr-4">Class</th>
                <th className="py-2 pr-4">Shares</th>
                <th className="py-2 pr-4">Cost/Share</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Value</th>
                <th className="py-2 pr-4">P&amp;L (HPR)</th>
                <th className="py-2 pr-4">Annualized</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const v = summary?.valuations.find((val) => val.holding.id === h.id);
                return (
                  <tr key={h.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4 font-medium">{h.symbol}</td>
                    <td className="py-2 pr-4 text-zinc-500">{assetClassLabel(h.assetClass)}</td>
                    <td className="py-2 pr-4">{h.shares}</td>
                    <td className="py-2 pr-4">{fmtUsd(h.costBasisPerShare)}</td>
                    <td className="py-2 pr-4">{v?.error ? <span className="text-red-500 text-xs">{v.error}</span> : fmtUsd(v?.currentPrice ?? null)}</td>
                    <td className="py-2 pr-4">{fmtUsd(v?.currentValue ?? null)}</td>
                    <td className={`py-2 pr-4 ${v?.unrealizedPL !== null && v?.unrealizedPL !== undefined ? (v.unrealizedPL >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400") : ""}`}>
                      {fmtUsd(v?.unrealizedPL ?? null)} ({fmtPct(v?.unrealizedPLPercent ?? null)})
                    </td>
                    <td className="py-2 pr-4 text-zinc-500">
                      {fmtPct(v?.annualizedReturnPercent ?? null)}
                      {v && v.holdingPeriodDays < 365 && v.annualizedReturnPercent !== null && (
                        <span className="text-[10px] block text-zinc-400">{v.holdingPeriodDays}d held</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <button onClick={() => removeHolding(h.id)} className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400" aria-label={`Remove ${h.symbol}`}>
                        &times;
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <button
        onClick={runValuation}
        disabled={loading || holdings.length === 0}
        className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Valuing…" : "Refresh Valuation"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Value" value={fmtUsd(summary.totalValue)} />
            <StatCard label="Cost Basis" value={fmtUsd(summary.totalCostBasis)} />
            <StatCard
              label="Unrealized P&L"
              value={fmtUsd(summary.totalUnrealizedPL)}
              sub={fmtPct(summary.totalUnrealizedPLPercent)}
              tone={summary.totalUnrealizedPL >= 0 ? "good" : "bad"}
            />
            <StatCard label="Holdings" value={String(holdings.length)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <AllocationBars title="Allocation by Asset Class" slices={summary.allocationByAssetClass} />
            <AllocationBars title="Allocation by Sector" slices={summary.allocationBySector} />
          </div>

          {summary.dataLimitations.length > 0 && (
            <div className="space-y-2">
              {summary.dataLimitations.map((d) => (
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
