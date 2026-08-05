import type { PaperOptionRight } from "../types";

/**
 * OCC-style option symbol (root + YYMMDD expiration + C/P + 8-digit strike,
 * strike * 1000 zero-padded) without the raw format's space-padding on the
 * root — this is an internal collision-safe identifier, not sent to any real
 * brokerage/OCC system, and unpadded reads better in tables/URLs. Used as
 * PaperOrder/PaperPosition's `symbol` for options — guarantees no collision
 * across strikes/expirations/rights, and never collides with an equity
 * ticker (always ends in a 6-digit date + C/P + 8-digit strike suffix).
 */
export function buildOccSymbol(underlying: string, expirationDate: string, right: PaperOptionRight, strike: number): string {
  const root = underlying.trim().toUpperCase();
  const [y, m, d] = expirationDate.split("-");
  const yy = y.slice(2);
  const strikeCode = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");
  const rightCode = right === "call" ? "C" : "P";
  return `${root}${yy}${m}${d}${rightCode}${strikeCode}`;
}

/** Human-readable label for the UI, e.g. "AAPL $150 Call · exp 2026-09-18". */
export function formatOptionLabel(underlying: string, expirationDate: string, right: PaperOptionRight, strike: number): string {
  const rightLabel = right === "call" ? "Call" : "Put";
  return `${underlying.trim().toUpperCase()} $${strike} ${rightLabel} · exp ${expirationDate}`;
}
