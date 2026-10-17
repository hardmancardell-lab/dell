import { fetchQuote } from "@/lib/data/market-data";
import { isUsablePrice } from "@/lib/data/market-data-types";
import { fetchProfile } from "@/lib/data/fmp";
import { assetClassLabel } from "../asset-class-label";
import { normalizeCryptoSymbol } from "../crypto-symbol";
import { notionalMultiplier, getOptionContractQuote } from "./paper-trading-engine";
import { THEMATIC_ETF_SECTOR_OVERRIDES } from "./sector-lookup";
import type { AllocationSlice, PortfolioHolding, PortfolioSummary, PortfolioValuation } from "../types";

/** The figures that follow from a price: pure, so the fractional-quantity maths can be tested without any network call. */
export function computeValuationFigures(holding: PortfolioHolding, currentPrice: number, holdingPeriodDays: number) {
  const multiplier =
    holding.assetClass === "future" && holding.contractMultiplier ? holding.contractMultiplier : notionalMultiplier(holding.assetClass);
  const costBasisTotal = holding.shares * holding.costBasisPerShare * multiplier;
  const currentValue = currentPrice * holding.shares * multiplier;
  const unrealizedPL = currentValue - costBasisTotal;
  // Holding Period Return — total return over the holding period, no
  // dividends/income factored in (this app has no dividend-history source).
  // Divide by the size of the cost basis: a short position (negative basis) that gained must not print a negative percent.
  const unrealizedPLPercent = costBasisTotal !== 0 ? (unrealizedPL / Math.abs(costBasisTotal)) * 100 : null;
  // HPR compounded to a 365-day basis (CAGR-style) — undefined for
  // same-day holdings (division by zero) or a negative-100% HPR (total
  // wipeout, (1+hpr) would be 0 or negative, undefined fractional power).
  const annualizedReturnPercent =
    // Annualising a gain over a few days prints absurd numbers (+5% in one day is 5e9 %), so it needs at least 30 days.
    unrealizedPLPercent !== null && holdingPeriodDays >= 30 && unrealizedPLPercent > -100
      ? (Math.pow(1 + unrealizedPLPercent / 100, 365 / holdingPeriodDays) - 1) * 100
      : null;
  return { costBasisTotal, currentValue, unrealizedPL, unrealizedPLPercent, annualizedReturnPercent };
}

/**
 * Per-holding valuation, same scanOne-style isolation as watchlist-scan.ts —
 * one bad symbol never breaks the whole portfolio's valuation. Reuses the
 * exact notionalMultiplier (options = 100x) and per-contract chain lookup
 * already proven in paper-trading-engine.ts, rather than duplicating them.
 */
async function valuateOne(holding: PortfolioHolding): Promise<PortfolioValuation> {
  const costBasisTotal = computeValuationFigures(holding, 0, 0).costBasisTotal;

  let currentPrice: number | null = null;
  let priceAsOf: number | null = null;
  let priceDelayed = false;
  let sector: string | null = null;
  let marketCapUsd: number | null = null;

  const holdingPeriodDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(holding.acquiredDate)) / (24 * 60 * 60 * 1000))
  );

  try {
    if (holding.assetClass === "option" && holding.underlyingSymbol && holding.expirationDate && holding.strikePrice && holding.optionRight) {
      const contract = await getOptionContractQuote(holding.underlyingSymbol, holding.expirationDate, holding.strikePrice, holding.optionRight);
      if (!contract) throw new Error(`No matching contract found for ${holding.symbol} (may have expired).`);
      currentPrice = (contract.bid + contract.ask) / 2;
      // Option quotes come from the chain provider (Tradier sandbox is about 15 minutes behind), so treat them as delayed.
      priceDelayed = true;
      if (!isUsablePrice(currentPrice)) throw new Error(`No two-sided quote for ${holding.symbol} (bid and ask are both zero).`);
    } else if (holding.assetClass === "crypto") {
      // A crypto holding is priced only from Coinbase. A symbol that is not a USD product id (for example a stock ticker
      // entered under Crypto) must not fall through to the equity quote path and come back with an unrelated price.
      const pair = normalizeCryptoSymbol(holding.symbol);
      if (!pair) throw new Error(`${holding.symbol} is not a Coinbase USD pair (use a symbol like BTC-USD).`);
      const q = await fetchQuote(pair);
      currentPrice = q.lastPrice;
      priceAsOf = q.asOf ?? null;
      priceDelayed = q.delayed ?? false;
    } else {
      const quote = await fetchQuote(holding.symbol);
      currentPrice = quote.lastPrice;
      priceAsOf = quote.asOf ?? null;
      priceDelayed = quote.delayed ?? false;
    }
    if (!isUsablePrice(currentPrice)) throw new Error("Price unavailable.");
  } catch (error) {
    return {
      holding,
      currentPrice: null,
      currentValue: null,
      costBasisTotal,
      unrealizedPL: null,
      unrealizedPLPercent: null,
      holdingPeriodDays,
      annualizedReturnPercent: null,
      sector: null,
      marketCapUsd: null,
      error: `Price unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
      priceUnavailable: true,
      priceAsOf: null,
      priceDelayed: false,
    };
  }

  // Sector tagging + market cap are both best-effort via FMP's /profile
  // endpoint, which only covers equities — forex/future/commodity/option
  // holdings simply have neither (bucketed by asset class instead in
  // allocationBySector below), and a lookup failure here isn't a valuation
  // error. Always fetched (even for thematic-ETF sector overrides below) so
  // market cap is still captured for those tickers.
  if (holding.assetClass === "equity") {
    const override = THEMATIC_ETF_SECTOR_OVERRIDES[holding.symbol.toUpperCase()];
    try {
      const profiles = await fetchProfile(holding.symbol);
      sector = override ?? profiles[0]?.sector ?? null;
      marketCapUsd = profiles[0]?.marketCap && profiles[0].marketCap > 0 ? profiles[0].marketCap : null;
    } catch {
      sector = override ?? null;
      marketCapUsd = null;
    }
  }

  const { currentValue, unrealizedPL, unrealizedPLPercent, annualizedReturnPercent } = computeValuationFigures(holding, currentPrice, holdingPeriodDays);

  return {
    holding,
    currentPrice,
    currentValue,
    costBasisTotal,
    unrealizedPL,
    unrealizedPLPercent,
    holdingPeriodDays,
    annualizedReturnPercent,
    sector,
    marketCapUsd,
    error: null,
    priceUnavailable: false,
    priceAsOf,
    priceDelayed,
  };
}

/** Sector-chart bucket for a holding with no sector: crypto gets its own "Crypto" slice, matching the asset-class chart. */
export function sectorBucketLabel(v: { sector: string | null; holding: { assetClass: PortfolioHolding["assetClass"] } }): string {
  if (v.sector) return v.sector;
  return v.holding.assetClass === "crypto" ? assetClassLabel("crypto") : `${assetClassLabel(v.holding.assetClass)} (no sector data)`;
}

export function buildAllocation(
  valuations: PortfolioValuation[],
  keyFn: (v: PortfolioValuation) => string,
  totalValue: number
): AllocationSlice[] {
  const byKey = new Map<string, number>();
  for (const v of valuations) {
    if (v.currentValue === null) continue;
    const key = keyFn(v);
    byKey.set(key, (byKey.get(key) ?? 0) + v.currentValue);
  }
  return [...byKey.entries()]
    .map(([label, value]) => ({ label, value, percent: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

export async function valuatePortfolio(holdings: PortfolioHolding[]): Promise<PortfolioSummary> {
  if (holdings.length === 0) {
    throw new Error("Portfolio is empty — add at least one holding before valuing it.");
  }

  const valuations = await Promise.all(holdings.map(valuateOne));

  // An unpriced holding is left out of EVERY total (value, cost and P/L), never booked as a 100% loss.
  const priced = valuations.filter((v) => v.currentValue !== null);
  const unpriced = valuations.filter((v) => v.currentValue === null);
  const totalValue = priced.reduce((s, v) => s + (v.currentValue ?? 0), 0);
  const totalCostBasis = priced.reduce((s, v) => s + v.costBasisTotal, 0);
  const unpricedCostBasis = unpriced.reduce((s, v) => s + v.costBasisTotal, 0);
  const asOfTimes = priced.map((v) => v.priceAsOf).filter((t): t is number => typeof t === "number");
  const totalUnrealizedPL = totalValue - totalCostBasis;
  const totalUnrealizedPLPercent = totalCostBasis !== 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : null;

  const allocationByAssetClass = buildAllocation(
    valuations,
    (v) => assetClassLabel(v.holding.assetClass),
    totalValue
  );
  const allocationBySector = buildAllocation(
    valuations,
    sectorBucketLabel,
    totalValue
  );

  const failedCount = valuations.filter((v) => v.error !== null).length;
  const dataLimitations: string[] = [
    "Sector tagging is best-effort via FMP's free /profile endpoint, which only covers equities — forex, futures, commodities, and options holdings have no sector and are grouped by asset class instead.",
    "Equity prices come from Alpaca's free-tier IEX-only feed — a single exchange, not the full consolidated tape. For lower-volume symbols, the last IEX print of the day can differ from the official closing price you'd see on a broker like Webull by anywhere from a penny to tens of cents.",
    "Market cap is FMP's own /profile figure — some ETFs report $0/no figure there (they don't have a traditional market cap the way an individual company does), which shows as N/A rather than a guessed number.",
  ];
  if (holdings.some((h) => h.assetClass === "crypto")) {
    dataLimitations.push(
      "Crypto is priced at Coinbase's last trade (one exchange, 24/7, so the value moves outside market hours), in whole and fractional coins. It has no sector or market-cap figure here and sits in its own Crypto slice in both allocation charts."
    );
  }
  if (failedCount > 0) {
    dataLimitations.push(
      `${failedCount} of ${holdings.length} holding(s) have no price available and are EXCLUDED from the totals below (value, cost basis and gain/loss cover the priced holdings only). See the individual messages.`
    );
  }
  if (priced.some((v) => v.priceDelayed)) {
    dataLimitations.push("Some prices are delayed (free-tier equity quotes and the options sandbox feed can be many minutes old). Each price is as of the quote time shown, not necessarily now.");
  }

  return {
    valuations,
    totalValue,
    totalCostBasis,
    totalUnrealizedPL,
    totalUnrealizedPLPercent,
    unpricedCount: unpriced.length,
    unpricedCostBasis,
    oldestPriceAsOf: asOfTimes.length > 0 ? Math.min(...asOfTimes) : null,
    anyPriceDelayed: priced.some((v) => v.priceDelayed),
    allocationByAssetClass,
    allocationBySector,
    dataLimitations,
  };
}
