"use client";

import { useCallback, useEffect, useState } from "react";
import { usePortfolio } from "@/lib/agents/trading-agent/portfolio-storage";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import { StatCard } from "./StatCard";
import type { AssetClass, PortfolioShockScanResult, PortfolioSummary } from "@/lib/agents/trading-agent/types";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

function fmtUsd(v: number | null): string {
  return v !== null ? v.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "N/A";
}

function fmtPct(v: number | null): string {
  return v !== null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "N/A";
}

function AllocationBars({ title, slices }: { title: string; slices: { label: string; value: number; percent: number }[] }) {
  return (
    <div>
      <h3 className="jv-strip-title">{title}</h3>
      <div className="flex flex-col gap-2">
        {slices.map((s) => (
          <div key={s.label}>
            <div className="flex justify-between text-xs mb-1" style={{ color: "var(--text-1)" }}>
              <span>{s.label}</span>
              <span>{s.percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden" style={{ background: "var(--ink-800)", border: "1px solid var(--line)" }}>
              <div className="h-full" style={{ width: `${Math.min(s.percent, 100)}%`, background: "var(--signal)" }} />
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
  // Asset-class-specific fields — mirrors PaperOrderForm.tsx's branch pattern.
  const [optionRight, setOptionRight] = useState<"call" | "put">("call");
  const [strikePrice, setStrikePrice] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [underlyingSymbol, setUnderlyingSymbol] = useState("");
  const [contractMultiplier, setContractMultiplier] = useState("");

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoValued, setAutoValued] = useState(false);
  const [shockScan, setShockScan] = useState<PortfolioShockScanResult | null>(null);
  const [shockScanLoading, setShockScanLoading] = useState(false);
  const [shockScanError, setShockScanError] = useState<string | null>(null);

  async function runShockScan() {
    setShockScanLoading(true);
    setShockScanError(null);
    setShockScan(null);
    try {
      const res = await fetch("/api/portfolio-shock-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings }),
      });
      const json = await res.json();
      if (!res.ok) setShockScanError(json.error ?? "Unknown error");
      else setShockScan(json as PortfolioShockScanResult);
    } catch (err) {
      setShockScanError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setShockScanLoading(false);
    }
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const sharesNum = Number(shares);
    const costBasisNum = Number(costBasis);
    if (!symbolInput.trim() || !Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(costBasisNum)) return;
    const extra =
      assetClass === "option"
        ? {
            optionRight,
            strikePrice: Number(strikePrice) || null,
            expirationDate: expirationDate || null,
            underlyingSymbol: underlyingSymbol.trim().toUpperCase() || symbolInput.trim().toUpperCase(),
          }
        : assetClass === "future"
          ? { contractMultiplier: Number(contractMultiplier) || null }
          : undefined;
    addHolding(symbolInput, assetClass, sharesNum, costBasisNum, acquiredDate, extra);
    setSymbolInput("");
    setShares("");
    setCostBasis("");
    setStrikePrice("");
    setExpirationDate("");
    setUnderlyingSymbol("");
    setContractMultiplier("");
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
    <div className="jarvis flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        Manually track real holdings — shares, cost basis, and acquisition date — valued against live market data
        (same real providers as the rest of this app: Alpaca for equities, OANDA for forex). No brokerage account
        linking; this is a read-only tracker, consistent with the rest of this app&apos;s data-and-analysis-only scope.
      </p>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-3">
        <input
          value={symbolInput}
          onChange={(e) => setSymbolInput(e.target.value)}
          placeholder="Symbol, e.g. AAPL"
          className="jv-input w-32"
        />
        <select
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value as AssetClass)}
          className="jv-select"
        >
          {ASSET_CLASSES.map((ac) => (
            <option key={ac} value={ac}>
              {assetClassLabel(ac)}
            </option>
          ))}
        </select>
        {assetClass === "option" && (
          <>
            <select
              value={optionRight}
              onChange={(e) => setOptionRight(e.target.value as "call" | "put")}
              className="jv-select"
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
            <input
              value={strikePrice}
              onChange={(e) => setStrikePrice(e.target.value)}
              placeholder="Strike"
              type="number"
              step="any"
              className="jv-input w-24"
            />
            <input
              value={expirationDate}
              onChange={(e) => setExpirationDate(e.target.value)}
              type="date"
              className="jv-input"
            />
            <input
              value={underlyingSymbol}
              onChange={(e) => setUnderlyingSymbol(e.target.value)}
              placeholder="Underlying, e.g. AAPL"
              className="jv-input w-36"
            />
          </>
        )}
        {assetClass === "future" && (
          <input
            value={contractMultiplier}
            onChange={(e) => setContractMultiplier(e.target.value)}
            placeholder="Contract multiplier"
            type="number"
            step="any"
            className="jv-input w-36"
          />
        )}
        <input
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder={assetClass === "option" ? "Contracts" : "Shares"}
          type="number"
          step="any"
          className="jv-input w-28"
        />
        <input
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          placeholder="Cost basis / share"
          type="number"
          step="any"
          className="jv-input w-40"
        />
        <input
          value={acquiredDate}
          onChange={(e) => setAcquiredDate(e.target.value)}
          type="date"
          className="jv-input"
        />
        <button type="submit" className="jv-btn">
          Add Holding
        </button>
      </form>

      {hydrated && holdings.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Portfolio is empty — add a holding above to get started.</p>
      )}

      {holdings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="jv-table">
            <thead>
              <tr>
                <th className="text-left">Symbol</th>
                <th className="text-left">Class</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Cost/Share</th>
                <th className="text-right">Price</th>
                <th className="text-right">Value</th>
                <th className="text-right">P&amp;L (HPR)</th>
                <th className="text-right">Annualized</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h) => {
                const v = summary?.valuations.find((val) => val.holding.id === h.id);
                const pnl = v?.unrealizedPL ?? null;
                const pnlClass = pnl === null ? "" : pnl > 0 ? "jv-pnl-up" : pnl < 0 ? "jv-pnl-down" : "jv-pnl-flat";
                return (
                  <tr key={h.id}>
                    <td className="font-medium">{h.symbol}</td>
                    <td style={{ color: "var(--text-2)" }}>{assetClassLabel(h.assetClass)}</td>
                    <td className="jv-num">{h.shares}</td>
                    <td className="jv-num">{fmtUsd(h.costBasisPerShare)}</td>
                    <td className="jv-num">{v?.error ? <span className="text-xs" style={{ color: "var(--danger)" }}>{v.error}</span> : fmtUsd(v?.currentPrice ?? null)}</td>
                    <td className="jv-num">{fmtUsd(v?.currentValue ?? null)}</td>
                    <td className={`jv-num ${pnlClass}`}>
                      {fmtUsd(pnl)} ({fmtPct(v?.unrealizedPLPercent ?? null)})
                    </td>
                    <td className="jv-num" style={{ color: "var(--text-2)" }}>
                      {fmtPct(v?.annualizedReturnPercent ?? null)}
                      {v && v.holdingPeriodDays < 365 && v.annualizedReturnPercent !== null && (
                        <span className="block text-[10px]" style={{ color: "var(--text-2)" }}>{v.holdingPeriodDays}d held</span>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => removeHolding(h.id)}
                        aria-label={`Remove ${h.symbol}`}
                        style={{ color: "var(--text-2)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-2)")}
                      >
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
        className="jv-btn"
        style={{ width: "fit-content" }}
      >
        {loading ? "Valuing…" : "Refresh Valuation"}
      </button>

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {summary && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Value" value={fmtUsd(summary.totalValue)} />
            <StatCard label="Cost Basis" value={fmtUsd(summary.totalCostBasis)} />
            <StatCard
              label="Unrealized P&L"
              value={fmtUsd(summary.totalUnrealizedPL)}
              sub={fmtPct(summary.totalUnrealizedPLPercent)}
              tone={summary.totalUnrealizedPL >= 0 ? "up" : "down"}
            />
            <StatCard label="Holdings" value={String(holdings.length)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <AllocationBars title="Allocation by Asset Class" slices={summary.allocationByAssetClass} />
            <AllocationBars title="Allocation by Sector" slices={summary.allocationBySector} />
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

          <div className="pt-6" style={{ borderTop: "1px solid var(--line)" }}>
            <h3 className="jv-strip-title">Macro Supply/Demand Shock Scan</h3>
            <p className="text-sm mb-3" style={{ color: "var(--text-1)" }}>
              Maps your real holdings to real news-coverage-spike checks (GDELT), and — where a spike is real and
              confirmed — a PhD-economist-persona read classifying it as a supply-side or demand-side shock. Takes
              real time (GDELT rate-limits to ~1 request/5s); a few seconds per distinct sector/pair/commodity your
              portfolio maps to.
            </p>
            <button
              onClick={runShockScan}
              disabled={shockScanLoading}
              className="jv-btn"
            >
              {shockScanLoading ? "Scanning…" : "Run Shock Scan"}
            </button>

            {shockScanError && (
              <div className="jv-card mt-3" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
                {shockScanError}
              </div>
            )}

            {shockScan && (
              <div className="mt-4 flex flex-col gap-4">
                {shockScan.entries.length === 0 && shockScan.dataLimitations.length === 0 && (
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>No holdings mapped to a real news query (e.g. bond-only portfolios) — nothing to scan.</p>
                )}
                {shockScan.entries.length === 0 && shockScan.dataLimitations.length > 0 && (
                  <p className="text-sm" style={{ color: "var(--text-2)" }}>Real holdings mapped to a query, but the scan couldn&apos;t complete — see the reason below.</p>
                )}
                {shockScan.entries.map((e) => (
                  <div
                    key={e.query}
                    className="jv-card"
                    style={e.triggered ? { borderColor: "var(--verdict-dim)" } : undefined}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-sm font-semibold" style={{ color: "var(--text-0)" }}>{e.symbols.join(", ")}</div>
                      {e.triggered && (
                        <span className="jv-badge" style={{ color: "var(--verdict)", borderColor: "var(--verdict-dim)", background: "rgba(240, 168, 104, 0.08)" }}>
                          Coverage spike: {e.coverageMultiple?.toFixed(1)}x average
                        </span>
                      )}
                    </div>
                    <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>{e.mechanismNote}</p>
                    {e.narrative && <p className="text-sm mb-2 whitespace-pre-wrap" style={{ color: "var(--text-1)" }}>{e.narrative}</p>}
                    {e.headlines.length > 0 && (
                      <ul className="text-xs list-disc pl-4 flex flex-col gap-1" style={{ color: "var(--text-2)" }}>
                        {e.headlines.slice(0, 3).map((h) => (
                          <li key={h.url}>
                            <a href={h.url} target="_blank" rel="noopener noreferrer" className="underline">
                              {h.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
                {shockScan.dataLimitations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {shockScan.dataLimitations.map((d) => (
                      <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                        <div className="text-xs" style={{ color: "var(--verdict)" }}>{d}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
