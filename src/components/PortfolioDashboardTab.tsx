"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { usePortfolio, useRealizedPnl } from "@/lib/agents/trading-agent/portfolio-storage";
import { assetClassLabel } from "@/lib/agents/trading-agent/asset-class-label";
import { StatCard } from "./StatCard";
import { PriceChart } from "./PriceChart";
import { AllocationPieChart, withCashSlice } from "./AllocationPieChart";
import { ShockScanEntryCard } from "./ShockScanEntryCard";
import { RealizedPnlPanel } from "./RealizedPnlPanel";
import { checkWashSaleRisk } from "@/lib/agents/trading-agent/skills/wash-sale-check";
import type { AssetClass, PortfolioHolding, PortfolioShockScanResult, PortfolioSummary, RealizedSale } from "@/lib/agents/trading-agent/types";
import type { WashSaleFlag } from "@/lib/agents/trading-agent/skills/wash-sale-check";

const ASSET_CLASSES: AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity"];

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

interface MyPortfolioResponse {
  linked: boolean;
  clientName?: string;
  summary?: PortfolioSummary | null;
  holdingsCount?: number;
  cashBalance?: number;
  sales?: RealizedSale[];
  totalRealizedPnl?: number;
  washSaleFlags?: WashSaleFlag[];
}

export function PortfolioDashboardTab() {
  const local = usePortfolio();
  const localRealized = useRealizedPnl();
  const [linkedSales, setLinkedSales] = useState<RealizedSale[]>([]);
  const [linkedTotalRealizedPnl, setLinkedTotalRealizedPnl] = useState(0);
  const [linkedWashSaleFlags, setLinkedWashSaleFlags] = useState<WashSaleFlag[]>([]);
  const [sellingHoldingId, setSellingHoldingId] = useState<string | null>(null);
  const [sellShares, setSellShares] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [sellFee, setSellFee] = useState("0");
  const [sellDate, setSellDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sellError, setSellError] = useState<string | null>(null);

  // "checking" avoids a flash of the empty local-tracker form before we
  // know whether this account is linked to a real advisor-managed portfolio.
  const [mode, setMode] = useState<"checking" | "local" | "linked">("checking");
  const [linkedClientName, setLinkedClientName] = useState("");
  const [linkedCashBalance, setLinkedCashBalance] = useState(0);

  const [symbolInput, setSymbolInput] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("equity");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [acquiredDate, setAcquiredDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [optionRight, setOptionRight] = useState<"call" | "put">("call");
  const [strikePrice, setStrikePrice] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [underlyingSymbol, setUnderlyingSymbol] = useState("");
  const [contractMultiplier, setContractMultiplier] = useState("");

  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoValued, setAutoValued] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; assetClass: AssetClass } | null>(null);
  const [shockScan, setShockScan] = useState<PortfolioShockScanResult | null>(null);
  const [shockScanLoading, setShockScanLoading] = useState(false);
  const [shockScanError, setShockScanError] = useState<string | null>(null);

  const refetchLinked = useCallback(async () => {
    const res = await fetch("/api/my-portfolio");
    const json = (await res.json()) as MyPortfolioResponse;
    if (json.linked) {
      setMode("linked");
      setLinkedClientName(json.clientName ?? "");
      setLinkedCashBalance(json.cashBalance ?? 0);
      setSummary(json.summary ?? null);
      setLinkedSales(json.sales ?? []);
      setLinkedTotalRealizedPnl(json.totalRealizedPnl ?? 0);
      setLinkedWashSaleFlags(json.washSaleFlags ?? []);
    } else {
      setMode("local");
    }
  }, []);

  useEffect(() => {
    refetchLinked().catch(() => setMode("local"));
  }, [refetchLinked]);

  const holdings: PortfolioHolding[] = mode === "linked" ? (summary?.valuations.map((v) => v.holding) ?? []) : local.holdings;

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

  function clearAddForm() {
    setSymbolInput("");
    setShares("");
    setCostBasis("");
    setStrikePrice("");
    setExpirationDate("");
    setUnderlyingSymbol("");
    setContractMultiplier("");
  }

  async function handleAdd(e: React.FormEvent) {
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

    if (mode === "linked") {
      setError(null);
      try {
        const res = await fetch("/api/my-portfolio/holdings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: symbolInput.trim(),
            assetClass,
            shares: sharesNum,
            costBasisPerShare: costBasisNum,
            acquiredDate,
            ...extra,
          }),
        });
        const json = await res.json();
        if (!res.ok) setError(json.error ?? "Unknown error");
        else {
          clearAddForm();
          await refetchLinked();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } else {
      local.addHolding(symbolInput, assetClass, sharesNum, costBasisNum, acquiredDate, extra);
      clearAddForm();
    }
  }

  async function handleRemove(holdingId: string) {
    if (mode === "linked") {
      await fetch(`/api/my-portfolio/holdings/${holdingId}`, { method: "DELETE" });
      await refetchLinked();
    } else {
      local.removeHolding(holdingId);
    }
  }

  function startSell(holdingId: string) {
    setSellingHoldingId(holdingId);
    setSellShares("");
    setSellPrice("");
    setSellFee("0");
    setSellDate(new Date().toISOString().slice(0, 10));
    setSellError(null);
  }

  // Sell is local-tracker only — an advisor-managed holding stays
  // admin-initiated (see AdvisorClientsManager), so this never runs in
  // "linked" mode.
  function submitSell(holdingId: string) {
    const sharesNum = Number(sellShares);
    const priceNum = Number(sellPrice);
    const feeNum = Number(sellFee) || 0;
    if (!Number.isFinite(sharesNum) || sharesNum <= 0 || !Number.isFinite(priceNum) || !sellDate) {
      setSellError("Enter a valid share count and sale price.");
      return;
    }
    const sale = local.sellHolding(holdingId, sharesNum, priceNum, feeNum, sellDate);
    if (!sale) {
      setSellError("Couldn't record that sale — check the share count against what's held.");
      return;
    }
    localRealized.refresh();
    setSellingHoldingId(null);
    // Matches add/remove's existing convention: the holdings table updates
    // immediately (derived straight from local.holdings), but summary/
    // allocation stats stay as-is until "Refresh Valuation" is clicked.
  }

  const runValuation = useCallback(async () => {
    if (mode === "linked") {
      await refetchLinked();
      return;
    }
    if (local.holdings.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-valuation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdings: local.holdings }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Unknown error");
      else setSummary(json as PortfolioSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, local.holdings]);

  useEffect(() => {
    if (mode === "local" && local.hydrated && !autoValued && local.holdings.length > 0) {
      setAutoValued(true);
      runValuation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, local.hydrated, autoValued, local.holdings.length]);

  const holdingsValue = summary?.totalValue ?? 0;
  const totalAccountValue = mode === "linked" ? holdingsValue + linkedCashBalance : holdingsValue;

  if (mode === "checking") {
    return <div className="jarvis" style={{ minHeight: 200 }} />;
  }

  return (
    <div className="jarvis flex flex-col gap-8">
      {mode === "linked" ? (
        <>
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-2)" }}>Managed by your advisor</div>
            <p className="jv-lede" style={{ marginBottom: 0 }}>
              {linkedClientName}&apos;s starting allocation is pre-loaded here. Prices and values reflect real-time
              market data, refreshed each time you load this page. You can add your own holdings alongside it, same
              as any investor using this tracker.
            </p>
          </div>
        </>
      ) : (
        <p className="jv-lede" style={{ marginBottom: 0 }}>
          Manually track real holdings — shares, cost basis, and acquisition date — valued against live market data
          (same real providers as the rest of this app: Alpaca for equities, OANDA for forex). No brokerage account
          linking; this is a read-only tracker, consistent with the rest of this app&apos;s data-and-analysis-only scope.
        </p>
      )}

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

      {mode === "local" && local.hydrated && holdings.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Portfolio is empty — add a holding above to get started.</p>
      )}
      {mode === "linked" && holdings.length === 0 && (
        <p className="text-sm" style={{ color: "var(--text-2)" }}>
          No holdings on file yet — the full {fmtUsd(linkedCashBalance)} is held in cash reserves.
        </p>
      )}

      {mode === "linked" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Total Account Value" value={fmtUsd(totalAccountValue)} />
          <StatCard
            label="Cash Reserves"
            value={fmtUsd(linkedCashBalance)}
            sub={totalAccountValue > 0 ? `${((linkedCashBalance / totalAccountValue) * 100).toFixed(1)}% of account` : undefined}
          />
          {summary && (
            <>
              <StatCard label="Invested Cost Basis" value={fmtUsd(summary.totalCostBasis)} />
              <StatCard
                label="Unrealized P&L"
                value={fmtUsd(summary.totalUnrealizedPL)}
                sub={fmtPct(summary.totalUnrealizedPLPercent)}
                tone={summary.totalUnrealizedPL >= 0 ? "up" : "down"}
              />
              <StatCard label="Holdings" value={String(holdings.length)} />
            </>
          )}
        </div>
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
                <th className="text-right">Market Cap</th>
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
                const isSelected = chartSymbol?.symbol === h.symbol;
                return (
                  <Fragment key={h.id}>
                    <tr>
                      <td className="font-medium">
                        <button
                          onClick={() => setChartSymbol(isSelected ? null : { symbol: h.symbol, assetClass: h.assetClass })}
                          className="hover:underline"
                          style={{ color: isSelected ? "var(--signal)" : "inherit" }}
                        >
                          {h.symbol}
                        </button>
                      </td>
                      <td style={{ color: "var(--text-2)" }}>{assetClassLabel(h.assetClass)}</td>
                      <td className="jv-num">{h.shares}</td>
                      <td className="jv-num">{fmtUsd(h.costBasisPerShare)}</td>
                      <td className="jv-num">{v?.error ? <span className="text-xs" style={{ color: "var(--danger)" }}>{v.error}</span> : fmtUsd(v?.currentPrice ?? null)}</td>
                      <td className="jv-num">{fmtUsd(v?.currentValue ?? null)}</td>
                      <td className="jv-num" style={{ color: "var(--text-2)" }}>{fmtMarketCap(v?.marketCapUsd ?? null)}</td>
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
                        <div className="flex items-center gap-2 justify-end">
                          {mode === "local" && (
                            <button
                              onClick={() => (sellingHoldingId === h.id ? setSellingHoldingId(null) : startSell(h.id))}
                              className="text-xs"
                              style={{ color: "var(--text-2)" }}
                            >
                              {sellingHoldingId === h.id ? "Cancel" : "Sell"}
                            </button>
                          )}
                          <button
                            onClick={() => handleRemove(h.id)}
                            aria-label={`Remove ${h.symbol}`}
                            style={{ color: "var(--text-2)" }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-2)")}
                          >
                            &times;
                          </button>
                        </div>
                      </td>
                    </tr>
                    {mode === "local" && sellingHoldingId === h.id && (
                      <tr>
                        <td colSpan={10}>
                          <div className="flex flex-wrap items-end gap-2 py-2">
                            <div>
                              <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Shares sold</label>
                              <input
                                value={sellShares}
                                onChange={(e) => setSellShares(e.target.value)}
                                type="number"
                                step="any"
                                max={h.shares}
                                className="jv-input w-24"
                              />
                            </div>
                            <div>
                              <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Sale price/share</label>
                              <input value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} type="number" step="any" className="jv-input w-28" />
                            </div>
                            <div>
                              <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Fee</label>
                              <input value={sellFee} onChange={(e) => setSellFee(e.target.value)} type="number" step="any" className="jv-input w-20" />
                            </div>
                            <div>
                              <label className="block text-xs mb-1" style={{ color: "var(--text-2)" }}>Sale date</label>
                              <input value={sellDate} onChange={(e) => setSellDate(e.target.value)} type="date" className="jv-input" />
                            </div>
                            <button onClick={() => submitSell(h.id)} className="jv-btn">
                              Record Sale
                            </button>
                          </div>
                          {sellError && <p className="text-xs pb-2" style={{ color: "var(--danger)" }}>{sellError}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {chartSymbol && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="jv-strip-title">{chartSymbol.symbol} Chart</h3>
            <button onClick={() => setChartSymbol(null)} className="text-xs" style={{ color: "var(--text-2)" }}>
              Close ✕
            </button>
          </div>
          <PriceChart symbol={chartSymbol.symbol} assetClass={chartSymbol.assetClass} />
        </div>
      )}

      {mode === "local" && (
        <button
          onClick={runValuation}
          disabled={loading || holdings.length === 0}
          className="jv-btn"
          style={{ width: "fit-content" }}
        >
          {loading ? "Valuing…" : "Refresh Valuation"}
        </button>
      )}

      {error && (
        <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {summary && (
        <div className="flex flex-col gap-6">
          {mode === "local" && (
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
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <AllocationPieChart
              title="Allocation by Asset Class"
              slices={mode === "linked" ? withCashSlice(summary.allocationByAssetClass, linkedCashBalance, totalAccountValue) : summary.allocationByAssetClass}
            />
            <AllocationPieChart
              title="Allocation by Sector"
              slices={mode === "linked" ? withCashSlice(summary.allocationBySector, linkedCashBalance, totalAccountValue) : summary.allocationBySector}
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
                  <ShockScanEntryCard key={e.query} entry={e} />
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

      {mode === "linked" && (
        <RealizedPnlPanel sales={linkedSales} totalRealizedPnl={linkedTotalRealizedPnl} washSaleFlags={linkedWashSaleFlags} />
      )}
      {mode === "local" && localRealized.hydrated && (
        <RealizedPnlPanel
          sales={localRealized.sales}
          totalRealizedPnl={localRealized.sales.reduce((sum, s) => sum + s.realizedPnl, 0)}
          washSaleFlags={checkWashSaleRisk(localRealized.sales, local.holdings)}
        />
      )}
    </div>
  );
}
