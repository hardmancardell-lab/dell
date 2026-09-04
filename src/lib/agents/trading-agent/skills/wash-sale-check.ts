import type { PortfolioHolding, RealizedSale } from "../types";

const WASH_SALE_WINDOW_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WashSaleFlag {
  saleId: string;
  symbol: string;
  saleDate: string;
  realizedPnl: number;
  matchingHoldingId: string;
  matchingAcquiredDate: string;
  daysBetween: number; // signed: negative = bought before the sale, positive = bought after
}

/**
 * A real, deterministic proximity check against the two data sets this app
 * already has (realized_pnl + current holdings) — not a full implementation
 * of the IRS wash-sale rule (which also covers "substantially identical"
 * securities, not just an exact ticker match, and applies per-lot rather
 * than per-symbol). Flags a realized LOSS on a symbol where a current
 * holding of that same symbol was acquired within 30 days either side of
 * the sale date — the single most common real-world wash-sale pattern
 * (sold at a loss, bought back too soon). Directional, not tax advice; see
 * dataLimitations on the caller side.
 */
export function checkWashSaleRisk(sales: RealizedSale[], holdings: PortfolioHolding[]): WashSaleFlag[] {
  const flags: WashSaleFlag[] = [];
  const lossSales = sales.filter((s) => s.realizedPnl < 0);

  for (const sale of lossSales) {
    const saleTime = Date.parse(sale.saleDate);
    const sameSymbolHoldings = holdings.filter((h) => h.symbol.toUpperCase() === sale.symbol.toUpperCase());
    for (const holding of sameSymbolHoldings) {
      const acquiredTime = Date.parse(holding.acquiredDate);
      const daysBetween = Math.round((acquiredTime - saleTime) / MS_PER_DAY);
      if (Math.abs(daysBetween) <= WASH_SALE_WINDOW_DAYS) {
        flags.push({
          saleId: sale.id,
          symbol: sale.symbol,
          saleDate: sale.saleDate,
          realizedPnl: sale.realizedPnl,
          matchingHoldingId: holding.id,
          matchingAcquiredDate: holding.acquiredDate,
          daysBetween,
        });
      }
    }
  }

  return flags;
}
