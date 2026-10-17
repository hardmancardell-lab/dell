/**
 * Validation for a paper-order proposal that arrives from Faye's server.
 *
 * The plan comes from a process outside this app, so it is never trusted: the
 * widget rebuilds the order from whitelisted, range-checked fields and forces
 * the attribution origin to "faye". The paper-trading route sanitizes again on
 * the server; this layer exists so a bad proposal never reaches the network and
 * so the confirm card can only ever place what it displays: the card text is built from the object this validator
 * returns (see action-validation.ts describePaperOrder), not from anything the server wrote.
 */

export const MAX_SHARES = 100_000;
export const MAX_CONTRACTS = 1_000;
export const MAX_STRIKE = 1_000_000;

/** A real calendar date: rejects 2026-13-45 and 2026-02-30. */
function realDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 1990;
}

const SYMBOL = /^[A-Za-z][A-Za-z0-9.-]{0,9}$/; // BRK.B, BF-B; no slashes (stock and option underlyings only)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidatedPaperOrder {
  symbol: string;
  assetClass: "equity" | "option";
  side: "buy" | "sell";
  orderType: "market";
  quantity: number;
  underlyingSymbol?: string;
  expirationDate?: string;
  optionRight?: "call" | "put";
  strikePrice?: number;
  attribution: Record<string, unknown>;
}

export type PaperOrderValidation = { ok: true; order: ValidatedPaperOrder } | { ok: false; error: string };

const bad = (error: string): PaperOrderValidation => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validatePaperOrder(raw: unknown): PaperOrderValidation {
  if (!isObj(raw)) return bad("The proposal was malformed, so nothing was placed.");
  const { symbol, assetClass, side, orderType, quantity } = raw;
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) return bad("The proposal had an invalid symbol.");
  if (side !== "buy" && side !== "sell") return bad("The proposal had an invalid side.");
  if (orderType !== "market") return bad("Faye can only propose market paper orders.");
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) return bad("The proposal had an invalid quantity.");
  if (assetClass !== "equity" && assetClass !== "option") return bad("Faye can only propose stock or option paper orders.");

  const attr = isObj(raw.attribution) ? raw.attribution : {};
  // Forced, never taken from the proposal: this order came through Faye.
  const attribution = { ...attr, origin: "faye" };

  if (assetClass === "equity") {
    if (!Number.isInteger(quantity)) return bad("Stock paper orders are whole shares.");
    if (quantity > MAX_SHARES) return bad(`A paper order is limited to ${MAX_SHARES.toLocaleString()} shares.`);
    return { ok: true, order: { symbol: symbol.toUpperCase(), assetClass, side, orderType, quantity, attribution } };
  }

  const { underlyingSymbol, expirationDate, optionRight, strikePrice } = raw;
  if (!Number.isInteger(quantity) || quantity > MAX_CONTRACTS) return bad(`Option paper orders are 1 to ${MAX_CONTRACTS} whole contracts.`);
  if (typeof underlyingSymbol !== "string" || !SYMBOL.test(underlyingSymbol)) return bad("The option had an invalid underlying.");
  if (typeof expirationDate !== "string" || !ISO_DATE.test(expirationDate) || !realDate(expirationDate)) return bad("The option had an invalid expiration.");
  if (symbol.toUpperCase() !== underlyingSymbol.toUpperCase()) return bad("The option's symbol did not match its underlying.");
  if (optionRight !== "call" && optionRight !== "put") return bad("The option had an invalid right.");
  if (typeof strikePrice !== "number" || !Number.isFinite(strikePrice) || strikePrice <= 0 || strikePrice > MAX_STRIKE) return bad("The option had an invalid strike.");
  return {
    ok: true,
    order: {
      symbol: symbol.toUpperCase(),
      assetClass,
      side,
      orderType,
      quantity,
      underlyingSymbol: underlyingSymbol.toUpperCase(),
      expirationDate,
      optionRight,
      strikePrice,
      attribution,
    },
  };
}
