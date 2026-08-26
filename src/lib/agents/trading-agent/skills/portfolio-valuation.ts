import { fetchQuote } from "@/lib/data/market-data";
import { fetchProfile } from "@/lib/data/fmp";
import { assetClassLabel } from "../asset-class-label";
import { notionalMultiplier, getOptionContractQuote } from "./paper-trading-engine";
import type { AllocationSlice, PortfolioHolding, PortfolioSummary, PortfolioValuation } from "../types";

/**
 * FMP's /profile sector tag reflects the fund sponsor's own GICS
 * classification (often "Financial Services" for every ETF issuer),
 * which is meaningless for a thematic ETF holding — a CIBR investor cares
 * that it's cybersecurity exposure, not that the fund is issued by a
 * financial company. Overrides take priority over the FMP lookup below.
 */
const THEMATIC_ETF_SECTOR_OVERRIDES: Record<string, string> = {
  CIBR: "Cybersecurity",
  DTCR: "Tech/AI Infrastructure",
  NLR: "Nuclear Energy",
  QTUM: "Quantum",
};

/**
 * Per-holding valuation, same scanOne-style isolation as watchlist-scan.ts —
 * one bad symbol never breaks the whole portfolio's valuation. Reuses the
 * exact notionalMultiplier (options = 100x) and per-contract chain lookup
 * already proven in paper-trading-engine.ts, rather than duplicating them.
 */
async function valuateOne(holding: PortfolioHolding): Promise<PortfolioValuation> {
  const multiplier =
    holding.assetClass === "future" && holding.contractMultiplier ? holding.contractMultiplier : notionalMultiplier(holding.assetClass);
  const costBasisTotal = holding.shares * holding.costBasisPerShare * multiplier;

  let currentPrice: number | null = null;
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
    } else {
      const quote = await fetchQuote(holding.symbol);
      currentPrice = quote.lastPrice;
    }
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
      error: error instanceof Error ? error.message : "Unknown error",
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

  const currentValue = currentPrice * holding.shares * multiplier;
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
    marketCapUsd,
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
    "Equity prices come from Alpaca's free-tier IEX-only feed — a single exchange, not the full consolidated tape. For lower-volume symbols, the last IEX print of the day can differ from the official closing price you'd see on a broker like Webull by anywhere from a penny to tens of cents.",
    "Market cap is FMP's own /profile figure — some ETFs report $0/no figure there (they don't have a traditional market cap the way an individual company does), which shows as N/A rather than a guessed number.",
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
