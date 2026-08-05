"use client";

import { useState } from "react";
import { useTrackEvent } from "@/lib/analytics/use-track";
import { formatOptionLabel } from "@/lib/agents/trading-agent/skills/option-symbol";
import type { AssetClass, PaperOptionRight, PaperOrderSide, PaperOrderType } from "@/lib/agents/trading-agent/types";

const ORDER_TYPES: { value: PaperOrderType; label: string }[] = [
  { value: "market", label: "Market" },
  { value: "limit", label: "Limit" },
  { value: "stop", label: "Stop" },
  { value: "stop_limit", label: "Stop-Limit" },
  { value: "trailing_stop", label: "Trailing Stop" },
];

const inputStyle = {
  background: "var(--ink-900)",
  border: "1px solid var(--line)",
  color: "var(--text-0)",
  fontFamily: "var(--font-mono)",
} as const;

const selectStyle = { background: "var(--ink-900)", border: "1px solid var(--line)", color: "var(--text-0)" } as const;

export interface PrefillOption {
  underlyingSymbol: string;
  expirationDate: string;
  optionRight: PaperOptionRight;
  strikePrice: number;
  referenceBid?: number;
  referenceAsk?: number;
}

/**
 * The order-entry form, extracted from PaperTradingTab so both the full
 * Paper Trading page (unprefilled) and compact prefilled tickets — the
 * chart click-to-trade panel, the options chain's per-contract Trade
 * button — submit through the exact same validated path, no duplicated
 * order logic. When prefillOption is set the form locks to a market order
 * on that exact contract (options are always market-only, see
 * paper-trading-engine.ts) and hides the fields that don't apply.
 */
export function PaperOrderForm({
  sessionId,
  prefillSymbol,
  prefillAssetClass,
  prefillPrice,
  prefillOption,
  compact,
  onFilled,
}: {
  sessionId: string;
  prefillSymbol?: string;
  prefillAssetClass?: AssetClass;
  prefillPrice?: number;
  prefillOption?: PrefillOption;
  compact?: boolean;
  onFilled?: () => void;
}) {
  const { track } = useTrackEvent();
  const isOption = Boolean(prefillOption);

  const [symbol, setSymbol] = useState(prefillSymbol ?? "");
  const [assetClass, setAssetClass] = useState<AssetClass>(prefillAssetClass ?? "equity");
  const [side, setSide] = useState<PaperOrderSide>("buy");
  const [orderType, setOrderType] = useState<PaperOrderType>("market");
  const [quantity, setQuantity] = useState(isOption ? "1" : "10");
  const [limitPrice, setLimitPrice] = useState(prefillPrice !== undefined ? String(prefillPrice) : "");
  const [stopPrice, setStopPrice] = useState("");
  const [trailAmount, setTrailAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitMsg(null);
    try {
      const qty = Number(quantity);
      const order = isOption
        ? {
            symbol: prefillOption!.underlyingSymbol,
            assetClass: "option" as AssetClass,
            side,
            orderType: "market" as PaperOrderType,
            quantity: qty,
            underlyingSymbol: prefillOption!.underlyingSymbol,
            expirationDate: prefillOption!.expirationDate,
            optionRight: prefillOption!.optionRight,
            strikePrice: prefillOption!.strikePrice,
          }
        : {
            symbol: symbol.trim().toUpperCase(),
            assetClass,
            side,
            orderType,
            quantity: qty,
            limitPrice: limitPrice ? Number(limitPrice) : null,
            stopPrice: stopPrice ? Number(stopPrice) : null,
            trailAmount: trailAmount ? Number(trailAmount) : null,
          };
      const res = await fetch("/api/paper-trading/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, order }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to place order.");
      track("paper_order_placed", { tab: "Paper Trading", symbol: order.symbol, metadata: { side, orderType: order.orderType, filled: data.filled } });
      setSubmitMsg(data.filled ? `Filled ${qty} ${isOption ? "contract(s) of " : ""}${order.symbol} @ market.` : `Order placed — resting as pending (${order.orderType}).`);
      if (!isOption) setSymbol("");
      setLimitPrice("");
      setStopPrice("");
      setTrailAmount("");
      onFilled?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {isOption && (
        <p className="text-sm mb-3" style={{ color: "var(--text-1)" }}>
          {formatOptionLabel(prefillOption!.underlyingSymbol, prefillOption!.expirationDate, prefillOption!.optionRight, prefillOption!.strikePrice)}
          {prefillOption!.referenceBid !== undefined && prefillOption!.referenceAsk !== undefined && (
            <span style={{ color: "var(--text-2)" }}>
              {" "}
              — bid {prefillOption!.referenceBid.toFixed(2)} / ask {prefillOption!.referenceAsk.toFixed(2)}
            </span>
          )}
          . Market order only.
        </p>
      )}
      <form onSubmit={handleSubmit} className={compact ? "grid grid-cols-2 gap-3" : "grid grid-cols-2 sm:grid-cols-4 gap-3"}>
        {!isOption && (
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Ticker, e.g. AAPL"
            required
            className="px-3 py-2 text-sm"
            style={inputStyle}
          />
        )}
        {!isOption && (
          <select value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass)} className="px-3 py-2 text-sm" style={selectStyle}>
            <option value="equity">Equity</option>
            <option value="commodity">Commodity</option>
            <option value="future">Future</option>
            <option value="forex">Forex</option>
          </select>
        )}
        <select value={side} onChange={(e) => setSide(e.target.value as PaperOrderSide)} className="px-3 py-2 text-sm" style={selectStyle}>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          type="number"
          min="1"
          step="1"
          placeholder={isOption ? "Contracts" : "Quantity"}
          required
          className="px-3 py-2 text-sm"
          style={inputStyle}
        />
        {!isOption && (
          <select value={orderType} onChange={(e) => setOrderType(e.target.value as PaperOrderType)} className="px-3 py-2 text-sm" style={selectStyle}>
            {ORDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        {!isOption && (orderType === "limit" || orderType === "stop_limit") && (
          <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} type="number" step="0.01" placeholder="Limit price" required className="px-3 py-2 text-sm" style={inputStyle} />
        )}
        {!isOption && (orderType === "stop" || orderType === "stop_limit") && (
          <input value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} type="number" step="0.01" placeholder="Stop price" required className="px-3 py-2 text-sm" style={inputStyle} />
        )}
        {!isOption && orderType === "trailing_stop" && (
          <input value={trailAmount} onChange={(e) => setTrailAmount(e.target.value)} type="number" step="0.01" placeholder="Trail amount ($)" required className="px-3 py-2 text-sm" style={inputStyle} />
        )}
        <button type="submit" disabled={submitting} className="px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--signal)", color: "var(--ink-950)" }}>
          {submitting ? "Placing…" : "Place Order"}
        </button>
      </form>
      {submitError && (
        <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
          {submitError}
        </p>
      )}
      {submitMsg && (
        <p className="text-sm mt-2" style={{ color: "var(--signal)" }}>
          {submitMsg}
        </p>
      )}
    </div>
  );
}
