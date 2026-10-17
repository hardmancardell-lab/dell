/**
 * Validation for every action Faye can propose, so the confirm card shows what will REALLY happen and an odd proposal
 * cannot corrupt the user's local ledger (privacy audit F3). Each validator rebuilds the action from whitelisted,
 * range-checked fields and returns a plain-language summary built from those validated values, never from server text.
 */

import { validatePaperOrder, type ValidatedPaperOrder } from "./paper-order-validation";

const SYMBOL = /^[A-Za-z][A-Za-z0-9.-]{0,14}$/; // BRK.B, BF-B, BTC-USD
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOLDING_ASSET_CLASSES = ["equity", "bond", "option", "future", "forex", "commodity", "crypto"] as const;
export const MAX_HOLDING_SHARES = 1_000_000_000;
export const MAX_PRICE = 10_000_000;
export const MAX_FEE = 1_000_000;

export interface AddHoldingParams { symbol: string; assetClass: (typeof HOLDING_ASSET_CLASSES)[number]; shares: number; costBasisPerShare: number; acquiredDate: string }
export interface SellHoldingParams { symbol: string; sharesSold: number; salePricePerShare: number; fee: number; saleDate: string }
export interface RemoveHoldingParams { symbol: string }

export type ValidatedAction =
  | { type: "add_holding"; params: AddHoldingParams; summary: string }
  | { type: "sell_holding"; params: SellHoldingParams; summary: string }
  | { type: "remove_holding"; params: RemoveHoldingParams; summary: string }
  | { type: "paper_order"; params: ValidatedPaperOrder; summary: string };

export type ActionCheck = { ok: true; action: ValidatedAction } | { ok: false; error: string };

const bad = (error: string): ActionCheck => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A real calendar date (rejects 2026-13-45 and 2026-02-30). */
export function isRealIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 1990;
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const qty = (n: number) => String(Number(n.toFixed(8)));

export function describePaperOrder(o: ValidatedPaperOrder): string {
  const what =
    o.assetClass === "option"
      ? `${qty(o.quantity)} contract(s) of ${o.underlyingSymbol} ${o.expirationDate} ${o.strikePrice} ${o.optionRight?.toUpperCase()}`
      : `${qty(o.quantity)} share(s) of ${o.symbol}`;
  return `PAPER ${o.side.toUpperCase()} (market order, simulated account, no real money): ${what}.`;
}

export function validateProposedAction(raw: unknown): ActionCheck {
  if (!isObj(raw) || typeof raw.type !== "string" || !isObj(raw.params)) return bad("The proposal was malformed, so nothing was offered.");
  const p = raw.params;

  switch (raw.type) {
    case "paper_order": {
      const v = validatePaperOrder(p);
      if (!v.ok) return bad(v.error);
      return { ok: true, action: { type: "paper_order", params: v.order, summary: describePaperOrder(v.order) } };
    }
    case "add_holding": {
      if (typeof p.symbol !== "string" || !SYMBOL.test(p.symbol)) return bad("The holding had an invalid symbol.");
      if (!(HOLDING_ASSET_CLASSES as readonly string[]).includes(p.assetClass as string)) return bad("The holding had an invalid asset class.");
      if (!finite(p.shares) || p.shares <= 0 || p.shares > MAX_HOLDING_SHARES) return bad("The holding had an invalid number of shares.");
      if (!finite(p.costBasisPerShare) || p.costBasisPerShare <= 0 || p.costBasisPerShare > MAX_PRICE) return bad("The holding had an invalid cost basis.");
      if (!isRealIsoDate(p.acquiredDate)) return bad("The holding had an invalid acquired date.");
      const params: AddHoldingParams = {
        symbol: p.symbol.toUpperCase(),
        assetClass: p.assetClass as AddHoldingParams["assetClass"],
        shares: p.shares,
        costBasisPerShare: p.costBasisPerShare,
        acquiredDate: p.acquiredDate,
      };
      return {
        ok: true,
        action: { type: "add_holding", params, summary: `ADD to your local portfolio: ${qty(params.shares)} share(s) of ${params.symbol} (${params.assetClass}) at a cost basis of ${usd(params.costBasisPerShare)} per share, acquired ${params.acquiredDate}.` },
      };
    }
    case "sell_holding": {
      if (typeof p.symbol !== "string" || !SYMBOL.test(p.symbol)) return bad("The sale had an invalid symbol.");
      if (!finite(p.sharesSold) || p.sharesSold <= 0 || p.sharesSold > MAX_HOLDING_SHARES) return bad("The sale had an invalid number of shares.");
      if (!finite(p.salePricePerShare) || p.salePricePerShare < 0 || p.salePricePerShare > MAX_PRICE) return bad("The sale had an invalid price.");
      const fee = p.fee === undefined || p.fee === null ? 0 : p.fee;
      if (!finite(fee) || fee < 0 || fee > MAX_FEE) return bad("The sale had an invalid fee.");
      if (!isRealIsoDate(p.saleDate)) return bad("The sale had an invalid date.");
      const params: SellHoldingParams = { symbol: p.symbol.toUpperCase(), sharesSold: p.sharesSold, salePricePerShare: p.salePricePerShare, fee, saleDate: p.saleDate };
      return {
        ok: true,
        action: { type: "sell_holding", params, summary: `RECORD A SALE in your local portfolio: ${qty(params.sharesSold)} share(s) of ${params.symbol} at ${usd(params.salePricePerShare)} per share, fee ${usd(params.fee)}, on ${params.saleDate}.` },
      };
    }
    case "remove_holding": {
      if (typeof p.symbol !== "string" || !SYMBOL.test(p.symbol)) return bad("The removal had an invalid symbol.");
      const params: RemoveHoldingParams = { symbol: p.symbol.toUpperCase() };
      return { ok: true, action: { type: "remove_holding", params, summary: `REMOVE ${params.symbol} from your local portfolio (the holding entry is deleted, no sale is recorded).` } };
    }
    default:
      return bad("Faye proposed an action this app does not support, so nothing was offered.");
  }
}
