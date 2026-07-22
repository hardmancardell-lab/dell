import { fetchQuote } from "@/lib/data/market-data";
import { fetchProfile } from "@/lib/data/fmp";
import { assetClassLabel } from "../asset-class-label";
import type { AllocationSlice, PortfolioHolding, PortfolioSummary, PortfolioValuation } from "../types";

/**
 * Per-holding valuation, same scanOne-style isolation as watchlist-scan.ts —
 * one bad symbol never breaks the whole portfolio's valuation.
 */
async function valuateOne(holding: PortfolioHolding): Promise<PortfolioValuation> {
  const costBasisTotal = holding.shares * holding.costBasisPerShare;

  let currentPrice: number | null = null;
  let sector: string | null = null;

  const holdingPeriodDays = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(holding.acquiredDate)) / (24 * 60 * 60 * 1000))
  );

  try {
    const quote = await fetchQuote(holding.symbol);
    currentPrice = quote.lastPrice;
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
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Sector tagging is best-effort — FMP's /profile endpoint only covers
  // equities, so forex/future/commodity/option holdings simply have no
  // sector (bucketed by asset class instead in allocationBySector below),
  // and a lookup failure here isn't a valuation error.
  try {
    const profiles = await fetchProfile(holding.symbol);
    sector = profiles[0]?.sector ?? null;
  } catch {
    sector = null;
  }

  const currentValue = currentPrice * holding.shares;
  const unrealizedPL = currentValue - costBasisTotal;
  // Holding Period Return — total return over the holding period, no
  // dividends/income factored in (this app has no dividend-history source).
  const unrealizedPLPercent = costBasisTotal !== 0 ? (unrealizedPL / costBasisTotal) * 100 : null;
  // HPR compounded to a 365-day basis (CAGR-style) — undefined for
  // same-day holdings (division by zero) or a negative-100% HPR (total
  // wipeout, (1+hpr) would be 0 or negative, undefined fractional power).
  const annualizedReturnPercent =
    unrealizedPLPercent !== null && holdingPeriodDays > 0 && unrealizedPLPercent > -100
      ? (Math.pow(1 + unrealizedPLPercent / 100, 365 / holdingPeriodDays) - 1) * 100
      : null;

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
    error: null,
  };
}

function buildAllocation(
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

  const totalValue = valuations.reduce((s, v) => s + (v.currentValue ?? 0), 0);
  const totalCostBasis = valuations.reduce((s, v) => s + v.costBasisTotal, 0);
  const totalUnrealizedPL = totalValue - totalCostBasis;
  const totalUnrealizedPLPercent = totalCostBasis !== 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : null;

  const allocationByAssetClass = buildAllocation(
    valuations,
    (v) => assetClassLabel(v.holding.assetClass),
    totalValue
  );
  const allocationBySector = buildAllocation(
    valuations,
    (v) => v.sector ?? `${assetClassLabel(v.holding.assetClass)} (no sector data)`,
    totalValue
  );

  const failedCount = valuations.filter((v) => v.error !== null).length;
  const dataLimitations: string[] = [
    "Sector tagging is best-effort via FMP's free /profile endpoint, which only covers equities — forex, futures, commodities, and options holdings have no sector and are grouped by asset class instead.",
  ];
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${holdings.length} holding(s) failed to price — see individual error messages below.`);
  }

  return {
    valuations,
    totalValue,
    totalCostBasis,
    totalUnrealizedPL,
    totalUnrealizedPLPercent,
    allocationByAssetClass,
    allocationBySector,
    dataLimitations,
  };
}
