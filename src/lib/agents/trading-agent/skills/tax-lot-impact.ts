import type { PortfolioValuation, TaxLotImpact, TaxLotConsumption } from "../types";

const LONG_TERM_THRESHOLD_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
    const isLongTerm = holdingPeriodDays >= LONG_TERM_THRESHOLD_DAYS;
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
