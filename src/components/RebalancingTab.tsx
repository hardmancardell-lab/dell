"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { computeRebalancing } from "@/lib/agents/trading-agent/skills/portfolio-rebalancing";
import { computeHedge } from "@/lib/agents/trading-agent/skills/hedge-calculator";
import type { OptionType } from "@/lib/agents/trading-agent/black-scholes";
import type { PortfolioSummary } from "@/lib/agents/trading-agent/types";

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function RebalancingSection({ summary }: { summary: PortfolioSummary | null }) {
  const { holdings } = usePortfolio();
  const uniqueSymbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const currentValues = useMemo(() => {
    const bySymbol = new Map<string, { currentValue: number; currentPrice: number | null }>();
    for (const v of summary?.valuations ?? []) {
      const prev = bySymbol.get(v.holding.symbol) ?? { currentValue: 0, currentPrice: v.currentPrice };
      bySymbol.set(v.holding.symbol, { currentValue: prev.currentValue + (v.currentValue ?? 0), currentPrice: v.currentPrice });
    }
    return uniqueSymbols.map((symbol) => ({ symbol, ...(bySymbol.get(symbol) ?? { currentValue: 0, currentPrice: null }) }));
  }, [summary, uniqueSymbols]);

  const totalTargetPercent = uniqueSymbols.reduce((s, sym) => s + (Number(targets[sym]) || 0), 0);

  const rows = useMemo(
    () =>
      computeRebalancing(
        currentValues,
        uniqueSymbols.map((symbol) => ({ symbol, targetPercent: Number(targets[symbol]) || 0 }))
      ),
    [currentValues, uniqueSymbols, targets]
  );

  if (!summary) {
    return <p className="text-sm text-zinc-500">Value your portfolio on the Dashboard tab first.</p>;
  }

  return (
    <div>
      <p className="text-zinc-500 mb-4">
        Set a target allocation per holding — this sizes the buy/sell needed to get there, it doesn&apos;t place any
        trades (this app has no order-execution code anywhere).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-4">Symbol</th>
              <th className="py-2 pr-4">Current %</th>
              <th className="py-2 pr-4">Target %</th>
              <th className="py-2 pr-4">Delta $</th>
              <th className="py-2 pr-4">Delta Shares</th>
              <th className="py-2 pr-4">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4 font-medium">{r.symbol}</td>
                <td className="py-2 pr-4 text-zinc-500">{r.currentPercent.toFixed(1)}%</td>
                <td className="py-2 pr-4">
                  <input
                    type="number"
                    step="any"
                    value={targets[r.symbol] ?? ""}
                    onChange={(e) => setTargets((prev) => ({ ...prev, [r.symbol]: e.target.value }))}
                    placeholder="0"
                    className="w-20 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2 py-1 text-sm"
                  />
                </td>
                <td className={`py-2 pr-4 ${r.deltaValue > 0 ? "text-green-600 dark:text-green-400" : r.deltaValue < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                  {fmtUsd(r.deltaValue)}
                </td>
                <td className="py-2 pr-4 text-zinc-500">{r.deltaShares !== null ? r.deltaShares.toFixed(2) : "N/A"}</td>
                <td className="py-2 pr-4">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.action === "buy"
                        ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                        : r.action === "sell"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400"
                          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {r.action}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`text-xs mt-3 ${Math.abs(totalTargetPercent - 100) < 0.5 ? "text-zinc-400" : "text-amber-600 dark:text-amber-400"}`}>
        Targets sum to {totalTargetPercent.toFixed(1)}% (should total 100% for a fully-allocated rebalance).
      </p>
    </div>
  );
}

function HedgeCalculatorSection() {
  const [positionShares, setPositionShares] = useState("500");
  const [optionType, setOptionType] = useState<OptionType>("put");
  const [spot, setSpot] = useState("100");
  const [strike, setStrike] = useState("100");
  const [dte, setDte] = useState("30");
  const [iv, setIv] = useState("30");
  const [riskFreeRate, setRiskFreeRate] = useState("4");
  const [targetHedgeRatio, setTargetHedgeRatio] = useState("1");

  const result = useMemo(
    () =>
      computeHedge({
        positionShares: Number(positionShares) || 0,
        optionType,
        spot: Number(spot) || 0,
        strike: Number(strike) || 0,
        daysToExpiration: Number(dte) || 0,
        impliedVolatilityPercent: Number(iv) || 0,
        riskFreeRatePercent: Number(riskFreeRate) || 0,
        targetHedgeRatio: Number(targetHedgeRatio) || 0,
        contractMultiplier: 100,
      }),
    [positionShares, optionType, spot, strike, dte, iv, riskFreeRate, targetHedgeRatio]
  );

  return (
    <div>
      <p className="text-zinc-500 mb-4">
        How many option contracts it takes to balance a stock position — reuses this app&apos;s Black-Scholes Greeks
        (Options Calculator) to find the option&apos;s delta, then solves for the contract count that offsets your
        target share of the position&apos;s directional exposure.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Position (shares, + long / - short)</span>
          <input type="number" step="any" value={positionShares} onChange={(e) => setPositionShares(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Option Type</span>
          <select value={optionType} onChange={(e) => setOptionType(e.target.value as OptionType)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm">
            <option value="put">Put</option>
            <option value="call">Call</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Spot</span>
          <input type="number" step="any" value={spot} onChange={(e) => setSpot(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Strike</span>
          <input type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Days to Expiration</span>
          <input type="number" step="any" value={dte} onChange={(e) => setDte(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Implied Vol %</span>
          <input type="number" step="any" value={iv} onChange={(e) => setIv(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Risk-Free Rate %</span>
          <input type="number" step="any" value={riskFreeRate} onChange={(e) => setRiskFreeRate(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">Target Hedge Ratio (1 = full)</span>
          <input type="number" step="any" value={targetHedgeRatio} onChange={(e) => setTargetHedgeRatio(e.target.value)} className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Option Delta</div>
          <div className="text-2xl font-semibold mt-1">{result.delta.toFixed(3)}</div>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Contracts Needed</div>
          <div className="text-2xl font-semibold mt-1">{result.contractsNeededRounded}</div>
          <div className="text-sm text-zinc-500 mt-1">{result.contractsNeededRounded >= 0 ? "Buy / go long" : "Sell / write"} (exact: {result.contractsNeeded.toFixed(2)})</div>
        </div>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Shares Hedged / Contract</div>
          <div className="text-2xl font-semibold mt-1">{result.sharesHedgedPerContract.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

export function RebalancingTab() {
  const { holdings, hydrated } = usePortfolio();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);

  const loadValuation = useCallback(async () => {
    if (holdings.length === 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio-valuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      const json = await res.json();
      if (res.ok) setSummary(json as PortfolioSummary);
    } finally {
      setLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    if (hydrated && !checked && holdings.length > 0) {
      setChecked(true);
      loadValuation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, checked, holdings.length]);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Rebalancing</h2>
          <button
            onClick={loadValuation}
            disabled={loading || holdings.length === 0}
            className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-4 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <RebalancingSection summary={summary} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Options Position Hedge Calculator</h2>
        <HedgeCalculatorSection />
      </section>
    </div>
  );
}
