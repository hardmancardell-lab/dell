"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { computeRebalancing } from "@/lib/agents/trading-agent/skills/portfolio-rebalancing";
import { computeHedge } from "@/lib/agents/trading-agent/skills/hedge-calculator";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { StatCard } from "./StatCard";
import type { OptionType } from "@/lib/agents/trading-agent/black-scholes";
import type { PortfolioSummary } from "@/lib/agents/trading-agent/types";

function fmtUsd(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function RebalancingSection({ summary }: { summary: PortfolioSummary | null }) {
  const { holdings } = usePortfolio();
  const uniqueSymbols = useMemo(() => [...new Set(holdings.map((h) => h.symbol))], [holdings]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const { track } = useTrackEvent();

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
    return <p className="text-sm" style={{ color: "var(--text-2)" }}>Value your portfolio on the Dashboard tab first.</p>;
  }

  return (
    <div>
      <p className="text-sm mb-4" style={{ color: "var(--text-1)" }}>
        Set a target allocation per holding — this sizes the buy/sell needed to get there, it doesn&apos;t place any
        trades (this app has no order-execution code anywhere).
      </p>
      <div className="overflow-x-auto">
        <table className="jv-table">
          <thead>
            <tr>
              <th className="text-left">Symbol</th>
              <th className="text-right">Current %</th>
              <th className="text-right">Target %</th>
              <th className="text-right">Delta $</th>
              <th className="text-right">Delta Shares</th>
              <th className="text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol}>
                <td className="font-medium">{r.symbol}</td>
                <td className="jv-num" style={{ color: "var(--text-2)" }}>{r.currentPercent.toFixed(1)}%</td>
                <td className="jv-num">
                  <input
                    type="number"
                    step="any"
                    value={targets[r.symbol] ?? ""}
                    onChange={(e) => setTargets((prev) => ({ ...prev, [r.symbol]: e.target.value }))}
                    onBlur={() => track("rebalancing_computed", { tab: "Rebalancing", metadata: { symbolCount: uniqueSymbols.length } })}
                    placeholder="0"
                    className="jv-input w-20 text-right"
                  />
                </td>
                <td className={`jv-num ${r.deltaValue > 0 ? "jv-pnl-up" : r.deltaValue < 0 ? "jv-pnl-down" : "jv-pnl-flat"}`}>
                  {fmtUsd(r.deltaValue)}
                </td>
                <td className="jv-num" style={{ color: "var(--text-2)" }}>{r.deltaShares !== null ? r.deltaShares.toFixed(2) : "N/A"}</td>
                <td>
                  <span
                    className="jv-badge"
                    style={
                      r.action === "buy"
                        ? { color: "var(--signal)", borderColor: "var(--signal-dim)", background: "rgba(79, 232, 208, 0.06)" }
                        : r.action === "sell"
                          ? { color: "var(--danger)", borderColor: "var(--danger)", background: "rgba(232, 99, 122, 0.08)" }
                          : { color: "var(--text-1)", borderColor: "var(--line-bright)" }
                    }
                  >
                    {r.action}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs mt-3" style={{ color: Math.abs(totalTargetPercent - 100) < 0.5 ? "var(--text-2)" : "var(--verdict)" }}>
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
  const { track } = useTrackEvent();

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
      <p className="text-sm mb-4" style={{ color: "var(--text-1)" }}>
        How many option contracts it takes to balance a stock position — reuses this app&apos;s Black-Scholes Greeks
        (Options Calculator) to find the option&apos;s delta, then solves for the contract count that offsets your
        target share of the position&apos;s directional exposure.
      </p>
      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6"
        onBlur={() => track("hedge_calc_used", { tab: "Rebalancing", metadata: { optionType } })}
      >
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Position (shares, + long / - short)</span>
          <input type="number" step="any" value={positionShares} onChange={(e) => setPositionShares(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Option Type</span>
          <select
            value={optionType}
            onChange={(e) => {
              setOptionType(e.target.value as OptionType);
              track("hedge_calc_used", { tab: "Rebalancing", metadata: { optionType: e.target.value } });
            }}
            className="jv-select"
          >
            <option value="put">Put</option>
            <option value="call">Call</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Spot</span>
          <input type="number" step="any" value={spot} onChange={(e) => setSpot(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Strike</span>
          <input type="number" step="any" value={strike} onChange={(e) => setStrike(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Days to Expiration</span>
          <input type="number" step="any" value={dte} onChange={(e) => setDte(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Implied Vol %</span>
          <input type="number" step="any" value={iv} onChange={(e) => setIv(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Risk-Free Rate %</span>
          <input type="number" step="any" value={riskFreeRate} onChange={(e) => setRiskFreeRate(e.target.value)} className="jv-input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="jv-label" style={{ marginBottom: 0 }}>Target Hedge Ratio (1 = full)</span>
          <input type="number" step="any" value={targetHedgeRatio} onChange={(e) => setTargetHedgeRatio(e.target.value)} className="jv-input" />
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Option Delta" value={result.delta.toFixed(3)} />
        <StatCard
          label="Contracts Needed"
          value={String(result.contractsNeededRounded)}
          sub={`${result.contractsNeededRounded >= 0 ? "Buy / go long" : "Sell / write"} (exact: ${result.contractsNeeded.toFixed(2)})`}
        />
        <StatCard label="Shares Hedged / Contract" value={result.sharesHedgedPerContract.toFixed(1)} />
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
    <div className="jarvis flex flex-col gap-10">
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>Rebalancing</h2>
          <button
            onClick={loadValuation}
            disabled={loading || holdings.length === 0}
            className="jv-btn-outline"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <RebalancingSection summary={summary} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4" style={{ color: "var(--text-0)" }}>Options Position Hedge Calculator</h2>
        <HedgeCalculatorSection />
      </section>
    </div>
  );
}
