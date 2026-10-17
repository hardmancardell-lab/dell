import type { PortfolioValuation, TaxLotImpact, TaxLotConsumption } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * U.S. rule: a gain is long-term only if the asset was held for MORE than one year. The holding period starts the day
 * after acquisition, so a sale exactly on the one-year anniversary is still short-term; the first long-term day is the day
 * after the anniversary. The test is calendar-date based (a 365-day count was wrong across a leap year, and `>= 365` was
 * off by one). Acquired on Feb 29: the anniversary is taken as Mar 1 (the conservative reading).
 * Dates are YYYY-MM-DD strings (or anything Date.parse reads in UTC).
 */
export function isLongTermHolding(acquiredDate: string, saleDate: string): boolean {
  const a = new Date(Date.parse(acquiredDate));
  const s = Date.parse(saleDate);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(s)) return false;
  const anniversary = Date.UTC(a.getUTCFullYear() + 1, a.getUTCMonth(), a.getUTCDate());
  return s > anniversary;
}

/**
 * Pure math, zero I/O — same "sizes the trade, never executes it" spirit as
 * portfolio-rebalancing.ts, one level deeper: a rebalancing "sell $X of
 * SYMBOL" recommendation is symbol-level, but real execution consumes
 * specific lots, each with its own cost basis and holding period. This
 * walks a symbol's lots FIFO (oldest first — the IRS default absent a
 * specific-identification election) and reports which lots a sell of that
 * size would actually touch, and whether each portion is short- or
 * long-term. An estimate for planning, not a booked trade or tax advice —
 * the real gain/loss depends on the fill price actually received.
 */
export function computeTaxLotImpact(
  symbol: string,
  dollarAmountToSell: number,
  valuations: PortfolioValuation[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): TaxLotImpact | null {
  const lots = valuations
    .filter((v) => v.holding.symbol.toUpperCase() === symbol.toUpperCase() && v.currentPrice !== null)
    .sort((a, b) => Date.parse(a.holding.acquiredDate) - Date.parse(b.holding.acquiredDate)); // FIFO

  if (lots.length === 0 || dollarAmountToSell <= 0) return null;

  const currentPrice = lots[0].currentPrice as number;
  let sharesRemaining = dollarAmountToSell / currentPrice;
  const consumed: TaxLotConsumption[] = [];

  for (const lot of lots) {
    if (sharesRemaining <= 0) break;
    const sharesFromLot = Math.min(lot.holding.shares, sharesRemaining);
    const holdingPeriodDays = Math.floor((Date.parse(asOfDate) - Date.parse(lot.holding.acquiredDate)) / MS_PER_DAY);
    const isLongTerm = isLongTermHolding(lot.holding.acquiredDate, asOfDate);
    const estimatedGainLoss = sharesFromLot * (currentPrice - lot.holding.costBasisPerShare);

    consumed.push({
      holdingId: lot.holding.id,
      acquiredDate: lot.holding.acquiredDate,
      sharesFromLot,
      holdingPeriodDays,
      isLongTerm,
      estimatedGainLoss,
    });
    sharesRemaining -= sharesFromLot;
  }

  const totalSharesAvailable = lots.reduce((s, l) => s + l.holding.shares, 0);
  const shortfall = sharesRemaining > 0.0001; // sell request exceeds total shares held

  return {
    symbol: symbol.toUpperCase(),
    currentPrice,
    dollarAmountRequested: dollarAmountToSell,
    totalSharesAvailable,
    lots: consumed,
    totalEstimatedGainLoss: consumed.reduce((s, c) => s + c.estimatedGainLoss, 0),
    shortTermGainLoss: consumed.filter((c) => !c.isLongTerm).reduce((s, c) => s + c.estimatedGainLoss, 0),
    longTermGainLoss: consumed.filter((c) => c.isLongTerm).reduce((s, c) => s + c.estimatedGainLoss, 0),
    exceedsAvailableShares: shortfall,
  };
}
