"use client";

import { useCallback, useEffect, useState } from "react";
import { getOrCreateSessionId } from "@/lib/analytics/use-track";
import { PaperOrderForm } from "./PaperOrderForm";
import { formatOptionLabel } from "@/lib/agents/trading-agent/skills/option-symbol";
import type { PaperAccountSummary, PaperOptionFields } from "@/lib/agents/trading-agent/types";

function displaySymbol(row: PaperOptionFields & { symbol: string }): string {
  if (row.optionRight && row.strikePrice !== null && row.expirationDate && row.underlyingSymbol) {
    return formatOptionLabel(row.underlyingSymbol, row.expirationDate, row.optionRight, row.strikePrice);
  }
  return row.symbol;
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" | "neutral" }) {
  const color = tone === "up" ? "var(--signal)" : tone === "down" ? "var(--danger)" : "var(--text-0)";
  return (
    <div className="jv-card">
      <div className="jv-br-b" />
      <div className="jv-label">{label}</div>
      <div className="jv-cond c-neutral" style={{ fontSize: 18, color }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function PaperTradingTab() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PaperAccountSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkResultMsg, setCheckResultMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setSessionId(getOrCreateSessionId());
  }, []);

  const loadAccount = useCallback(async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/paper-trading/account?sessionId=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load account.");
      setSummary(data as PaperAccountSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) loadAccount(sessionId);
  }, [sessionId, loadAccount]);

  async function handleCheckOrders() {
    if (!sessionId) return;
    setChecking(true);
    setCheckResultMsg(null);
    try {
      const res = await fetch("/api/paper-trading/check-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to check orders.");
      setCheckResultMsg(`Evaluated ${data.ordersEvaluated} order(s) — ${data.ordersFilled} filled, ${data.ordersCancelledByOco} cancelled by OCO.`);
      await loadAccount(sessionId);
    } catch (err) {
      setCheckResultMsg(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setChecking(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/paper-trading/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, orderId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel order.");
      await loadAccount(sessionId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  if (!sessionId || loading) {
    return <p style={{ color: "var(--text-2)" }}>Loading paper trading account…</p>;
  }

  if (error) {
    return (
      <div className="jv-card" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
        <div className="font-medium">Could not load paper trading account</div>
        <div className="text-sm mt-1">{error}</div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-8">
      <p className="jv-lede" style={{ marginBottom: 0 }}>
        A long-only paper trading simulator on real quotes and real intraday price action — market, limit, stop,
        stop-limit, and trailing-stop orders, real slippage, and real SEC/FINRA regulatory fees on sells. No fake
        fills: limit/stop orders only execute when a real bar&apos;s high or low actually crosses the trigger level.
      </p>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Equity" value={fmtUsd(summary.totalEquity)} />
        <StatCard label="Cash Balance" value={fmtUsd(summary.cashBalance)} />
        <StatCard
          label="Unrealized P&L"
          value={fmtUsd(summary.totalUnrealizedPnl)}
          tone={summary.totalUnrealizedPnl > 0 ? "up" : summary.totalUnrealizedPnl < 0 ? "down" : "neutral"}
        />
        <StatCard
          label="Realized P&L"
          value={fmtUsd(summary.totalRealizedPnl)}
          tone={summary.totalRealizedPnl > 0 ? "up" : summary.totalRealizedPnl < 0 ? "down" : "neutral"}
        />
      </section>

      {summary.winLoss && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Win Rate" value={summary.winLoss.winRate !== null ? `${summary.winLoss.winRate.toFixed(0)}%` : "N/A"} />
          <StatCard label="Profit Factor" value={summary.winLoss.profitFactor !== null ? summary.winLoss.profitFactor.toFixed(2) : "N/A"} />
          <StatCard label="Avg Win" value={fmtPct(summary.winLoss.avgWinPct)} tone="up" />
          <StatCard label="Avg Loss" value={fmtPct(summary.winLoss.avgLossPct)} tone="down" />
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            Place Order
          </div>
        </div>
        <PaperOrderForm sessionId={sessionId} onFilled={() => loadAccount(sessionId)} />
      </section>

      <section>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            Positions
          </div>
        </div>
        {summary.positions.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            No open positions.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Symbol", "Qty", "Avg Cost", "Current", "Market Value", "Unrealized P&L", "P&L %"].map((h) => (
                    <th key={h} className="text-left py-2 px-2" style={{ color: "var(--text-2)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.positions.map((p) => (
                  <tr key={`${p.symbol}-${p.assetClass}`} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="py-2 px-2 font-medium">{displaySymbol(p)}</td>
                    <td className="py-2 px-2">{p.quantity}</td>
                    <td className="py-2 px-2">{fmtUsd(p.avgCostBasis)}</td>
                    <td className="py-2 px-2">{fmtUsd(p.currentPrice)}</td>
                    <td className="py-2 px-2">{fmtUsd(p.marketValue)}</td>
                    <td className="py-2 px-2" style={{ color: (p.unrealizedPnl ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>
                      {fmtUsd(p.unrealizedPnl)}
                    </td>
                    <td className="py-2 px-2" style={{ color: (p.unrealizedPnlPct ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>
                      {fmtPct(p.unrealizedPnlPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="jv-strip-title" style={{ marginBottom: 0 }}>
            Open Orders
          </div>
          <button
            onClick={handleCheckOrders}
            disabled={checking}
            className="shrink-0 px-3 py-1 text-xs font-medium disabled:opacity-50"
            style={{ border: "1px solid var(--line-bright)", color: "var(--text-1)" }}
          >
            {checking ? "Checking…" : "Check Orders"}
          </button>
        </div>
        {checkResultMsg && (
          <p className="text-xs mb-2" style={{ color: "var(--text-2)" }}>
            {checkResultMsg}
          </p>
        )}
        {submitError && (
          <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
            {submitError}
          </p>
        )}
        {summary.openOrders.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            No open orders. Pending orders are also re-checked automatically once a day.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Symbol", "Side", "Type", "Qty", "Limit", "Stop", "Trail", "Placed", ""].map((h) => (
                    <th key={h} className="text-left py-2 px-2" style={{ color: "var(--text-2)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.openOrders.map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="py-2 px-2 font-medium">{displaySymbol(o)}</td>
                    <td className="py-2 px-2" style={{ textTransform: "capitalize" }}>
                      {o.side}
                    </td>
                    <td className="py-2 px-2" style={{ textTransform: "capitalize" }}>
                      {o.orderType.replace("_", " ")}
                    </td>
                    <td className="py-2 px-2">{o.quantity}</td>
                    <td className="py-2 px-2">{o.limitPrice !== null ? fmtUsd(o.limitPrice) : "—"}</td>
                    <td className="py-2 px-2">{o.stopPrice !== null ? fmtUsd(o.stopPrice) : "—"}</td>
                    <td className="py-2 px-2">{o.trailAmount !== null ? fmtUsd(o.trailAmount) : "—"}</td>
                    <td className="py-2 px-2 text-xs" style={{ color: "var(--text-2)" }}>
                      {new Date(o.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 px-2">
                      <button
                        onClick={() => handleCancelOrder(o.id)}
                        className="text-xs px-2 py-1"
                        style={{ border: "1px solid var(--line-bright)", color: "var(--danger)" }}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="jv-strip-title">Recent Fills</div>
        {summary.recentFills.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            No fills yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  {["Symbol", "Side", "Qty", "Fill Price", "Fees", "Realized P&L", "Filled"].map((h) => (
                    <th key={h} className="text-left py-2 px-2" style={{ color: "var(--text-2)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.recentFills.map((f) => (
                  <tr key={f.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="py-2 px-2 font-medium">{displaySymbol(f)}</td>
                    <td className="py-2 px-2" style={{ textTransform: "capitalize" }}>
                      {f.side}
                    </td>
                    <td className="py-2 px-2">{f.quantity}</td>
                    <td className="py-2 px-2">{fmtUsd(f.fillPrice)}</td>
                    <td className="py-2 px-2">{fmtUsd(f.totalFees)}</td>
                    <td className="py-2 px-2" style={{ color: (f.realizedPnl ?? 0) >= 0 ? "var(--signal)" : "var(--danger)" }}>
                      {f.realizedPnl !== null ? fmtUsd(f.realizedPnl) : "—"}
                    </td>
                    <td className="py-2 px-2 text-xs" style={{ color: "var(--text-2)" }}>
                      {new Date(f.filledAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {summary.dataLimitations.length > 0 && (
        <section>
          <div className="jv-strip-title">Data Limitations</div>
          <div className="flex flex-col gap-2">
            {summary.dataLimitations.map((d) => (
              <div key={d.slice(0, 30)} className="jv-card" style={{ borderColor: "var(--verdict-dim)" }}>
                <div className="text-sm" style={{ color: "var(--verdict)" }}>
                  {d}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
