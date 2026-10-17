import type { AssetClass } from "../types";

/**
 * Pure realized-P&L arithmetic for selling part of a holding. One place for the rules so the local (browser) and any
 * server-side ledger can use the same ones:
 *  - an option contract controls 100 shares and a future controls its contractMultiplier, so realized P&L must be scaled
 *    the same way unrealized P&L already is (before this, one option contract bought at 2.00 and sold at 3.00 booked +$1
 *    realized but showed +$100 unrealized);
 *  - NaN or infinite inputs are rejected instead of writing a NaN P&L row and a NaN lot;
 *  - quantities are rounded to 8 decimals for every asset class so 0.1 + 0.2 sold as 0.1 then 0.2 leaves no dust lot.
 */

export const OPTIONS_CONTRACT_MULTIPLIER = 100;

export function holdingMultiplier(h: { assetClass: AssetClass; contractMultiplier?: number | null }): number {
  if (h.assetClass === "option") return OPTIONS_CONTRACT_MULTIPLIER;
  if (h.assetClass === "future" && typeof h.contractMultiplier === "number" && Number.isFinite(h.contractMultiplier) && h.contractMultiplier > 0) {
    return h.contractMultiplier;
  }
  return 1;
}

/** Realized P&L in dollars for selling `sharesSold` of a holding at `salePricePerShare`, net of `fee`. */
export function computeRealizedPnl(
  holding: { assetClass: AssetClass; costBasisPerShare: number; contractMultiplier?: number | null },
  sharesSold: number,
  salePricePerShare: number,
  fee: number
): number {
  return (salePricePerShare - holding.costBasisPerShare) * sharesSold * holdingMultiplier(holding) - fee;
}

/** Null when the sale inputs are acceptable, otherwise the reason they are not. */
export function validateSaleInputs(sharesSold: number, salePricePerShare: number, fee: number): string | null {
  if (!Number.isFinite(sharesSold) || sharesSold <= 0) return "Shares sold must be a positive number.";
  if (!Number.isFinite(salePricePerShare) || salePricePerShare < 0) return "Sale price must be a number of zero or more.";
  if (!Number.isFinite(fee) || fee < 0) return "Fee must be a number of zero or more.";
  return null;
}

/** Remaining quantity after a sale, rounded to 8 decimals so float noise never strands a dust lot. */
export function remainingQuantity(held: number, sold: number): number {
  const raw = Math.round((held - sold) * 1e8) / 1e8;
  return raw < 1e-8 ? 0 : raw;
}
