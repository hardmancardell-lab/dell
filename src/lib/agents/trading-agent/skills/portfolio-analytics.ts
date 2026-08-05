import { getDailyBars } from "./daily-bars";
import { fetchQuote } from "@/lib/data/market-data";
import { getCurrentRiskFreeRate } from "./options-calculator";
import { valuatePortfolio } from "./portfolio-valuation";
import { correlation, covariance, linearRegression, maxDrawdownFromReturns, mean, stdDev } from "../stats";
import type {
  CorrelationMatrixResult,
  EfficientFrontierPoint,
  HoldingBeta,
  PortfolioAnalyticsResult,
  PortfolioHolding,
  RiskTier,
} from "../types";

/**
 * Beta/correlation/efficient-frontier engine for the Modern Portfolio
 * Theory tab. Self-contained (fetches its own quotes/bars rather than
 * depending on portfolio-valuation.ts's output) — same independence as
 * historical-backtest.ts pulling its own bars rather than depending on
 * watchlist-scan.ts.
 */

const BENCHMARK = "SPY";
const LOOKBACK_DAYS = 395; // ~1yr + buffer for weekends/holidays, same style as historical-backtest.ts
const TRADING_DAYS_PER_YEAR = 252;
// Fallback only — used if the live FRED fetch fails, never presented as a live rate.
const FALLBACK_ANNUAL_RISK_FREE_RATE = 0.04;
const MIN_OVERLAPPING_DAYS = 30;
// A simple, stated heuristic on annualized volatility — not a universal
// standard, just a reasonable equity-market rule of thumb (broad index
// funds run ~12-18%, individual growth/momentum names often 35%+).
const RISK_TIER_LOW_MAX = 15;
const RISK_TIER_MEDIUM_MAX = 30;

function classifyRiskTier(volatilityAnnualizedPercent: number): RiskTier {
  if (volatilityAnnualizedPercent <= RISK_TIER_LOW_MAX) return "low";
  if (volatilityAnnualizedPercent <= RISK_TIER_MEDIUM_MAX) return "medium";
  return "high";
}
// 2,000 keeps the scatter cloud visually dense while keeping the JSON
// response (each point carries a per-symbol weights map) a reasonable size.
const SIMULATIONS = 2000;

export interface SymbolReturns {
  symbol: string;
  returnsByDate: Map<string, number>;
  error: string | null;
}

export async function fetchReturnsFor(symbol: string): Promise<SymbolReturns> {
  try {
    const bars = await getDailyBars(symbol, LOOKBACK_DAYS);
    const returnsByDate = new Map<string, number>();
    for (let i = 1; i < bars.length; i++) {
      const prevClose = bars[i - 1].close;
      if (prevClose === 0) continue;
      returnsByDate.set(bars[i].dateKey, (bars[i].close - prevClose) / prevClose);
    }
    return { symbol, returnsByDate, error: null };
  } catch (error) {
    return { symbol, returnsByDate: new Map(), error: error instanceof Error ? error.message : "Unknown error" };
  }
}

/** Exponential(1)-draw simplex sampling — true Dirichlet(1,...,1), uniform over long-only weights summing to 1. */
function randomWeights(n: number): number[] {
  const draws = Array.from({ length: n }, () => -Math.log(Math.random()));
  const total = draws.reduce((s, v) => s + v, 0);
  return draws.map((v) => v / total);
}

function portfolioReturn(weights: number[], expectedReturns: number[]): number {
  return weights.reduce((sum, w, i) => sum + w * expectedReturns[i], 0);
}

function portfolioVolatility(weights: number[], covMatrix: number[][]): number {
  let variance = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) {
      variance += weights[i] * weights[j] * covMatrix[i][j];
    }
  }
  return Math.sqrt(Math.max(variance, 0));
}

function toPoint(
  symbols: string[],
  weights: number[],
  expectedReturns: number[],
  covMatrix: number[][],
  annualRiskFreeRate: number
): EfficientFrontierPoint {
  const expectedReturn = portfolioReturn(weights, expectedReturns);
  const volatility = portfolioVolatility(weights, covMatrix);
  const sharpeRatio = volatility > 0 ? (expectedReturn - annualRiskFreeRate) / volatility : 0;
  const weightsRecord: Record<string, number> = {};
  symbols.forEach((s, i) => (weightsRecord[s] = weights[i]));
  return { weights: weightsRecord, expectedReturn, volatility, sharpeRatio };
}

export async function runPortfolioAnalytics(holdings: PortfolioHolding[]): Promise<PortfolioAnalyticsResult> {
  if (holdings.length === 0) {
    throw new Error("Portfolio is empty — add at least one holding before running analytics.");
  }

  const dataLimitations: string[] = [
    `Efficient frontier is a Monte Carlo approximation (${SIMULATIONS} random long-only portfolios), not an exact quadratic-programming solve — the true analytical frontier may sit slightly above the sampled cloud, especially with more holdings.`,
    `Beta/correlation use ~1 year of daily returns — short-history assumptions apply the same way they do elsewhere in this app (n<${MIN_OVERLAPPING_DAYS * 2} treat as directional only).`,
    `Risk tier is a stated heuristic on annualized volatility (Low <=${RISK_TIER_LOW_MAX}%, Medium <=${RISK_TIER_MEDIUM_MAX}%, High above), not a universal standard.`,
  ];

  const uniqueSymbols = [...new Set(holdings.map((h) => h.symbol))];

  const [benchmarkReturns, riskFreeRateResult, ...symbolReturnsList] = await Promise.all([
    fetchReturnsFor(BENCHMARK),
    getCurrentRiskFreeRate().catch(() => null),
    ...uniqueSymbols.map(fetchReturnsFor),
  ]);

  const annualRiskFreeRate = riskFreeRateResult ? riskFreeRateResult.ratePercent / 100 : FALLBACK_ANNUAL_RISK_FREE_RATE;
  dataLimitations.push(
    riskFreeRateResult
      ? `Sharpe ratio uses the live ${riskFreeRateResult.ratePercent}% 3-month Treasury yield as the risk-free rate (as of ${riskFreeRateResult.asOfDate}, FRED series ${riskFreeRateResult.seriesId}).`
      : `Could not load the live risk-free rate — Sharpe ratio falls back to an assumed ${(FALLBACK_ANNUAL_RISK_FREE_RATE * 100).toFixed(0)}% annual rate.`
  );

  const failedSymbols = symbolReturnsList.filter((s) => s.error !== null);
  if (failedSymbols.length > 0) {
    dataLimitations.push(
      `Could not fetch return history for: ${failedSymbols.map((s) => s.symbol).join(", ")} — excluded from beta/correlation/frontier.`
    );
  }
  if (benchmarkReturns.error) {
    throw new Error(`Could not fetch benchmark (${BENCHMARK}) data: ${benchmarkReturns.error}`);
  }

  // Per-holding beta vs SPY, aligned by dateKey (not array position), plus
  // annualized volatility / a simple risk-tier read (independent of the
  // benchmark, computed straight from the symbol's own return series).
  const betas: HoldingBeta[] = symbolReturnsList.map((s) => {
    if (s.error) {
      return {
        symbol: s.symbol,
        beta: null,
        alpha: null,
        rSquared: null,
        n: 0,
        volatilityAnnualizedPercent: null,
        riskTier: null,
        error: s.error,
      };
    }

    const ownReturns = [...s.returnsByDate.values()];
    const ownStdDev = stdDev(ownReturns);
    const volatilityAnnualizedPercent = ownStdDev !== null ? ownStdDev * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100 : null;
    const riskTier = volatilityAnnualizedPercent !== null ? classifyRiskTier(volatilityAnnualizedPercent) : null;

    const commonDates = [...s.returnsByDate.keys()].filter((d) => benchmarkReturns.returnsByDate.has(d));
    const assetSeries = commonDates.map((d) => s.returnsByDate.get(d) as number);
    const benchSeries = commonDates.map((d) => benchmarkReturns.returnsByDate.get(d) as number);
    const reg = linearRegression(benchSeries, assetSeries);
    if (!reg || reg.n < MIN_OVERLAPPING_DAYS) {
      return {
        symbol: s.symbol,
        beta: null,
        alpha: null,
        rSquared: null,
        n: reg?.n ?? 0,
        volatilityAnnualizedPercent,
        riskTier,
        error: `Only ${reg?.n ?? 0} overlapping trading day(s) with ${BENCHMARK} — insufficient for a regression.`,
      };
    }
    return {
      symbol: s.symbol,
      beta: reg.slope,
      alpha: reg.intercept,
      rSquared: reg.rSquared,
      n: reg.n,
      volatilityAnnualizedPercent,
      riskTier,
      error: null,
    };
  });

  // Symbols usable for the correlation matrix / frontier: fetched OK and
  // have enough overlapping history against every other included symbol,
  // determined via a common-date intersection across all of them at once.
  const usable = symbolReturnsList.filter((s) => !s.error);
  let commonDates = usable.length > 0 ? [...usable[0].returnsByDate.keys()] : [];
  for (const s of usable.slice(1)) {
    commonDates = commonDates.filter((d) => s.returnsByDate.has(d));
  }
  const includedSymbols = usable
    .filter((s) => commonDates.length >= MIN_OVERLAPPING_DAYS)
    .map((s) => s.symbol);
  if (usable.length > 0 && commonDates.length < MIN_OVERLAPPING_DAYS) {
    dataLimitations.push(
      `Only ${commonDates.length} trading day(s) overlap across all held symbols — too few for a reliable correlation matrix or efficient frontier (need ${MIN_OVERLAPPING_DAYS}+). Beta figures above are still per-symbol and unaffected.`
    );
  }

  const returnSeriesBySymbol = new Map<string, number[]>();
  for (const symbol of includedSymbols) {
    const s = usable.find((u) => u.symbol === symbol)!;
    returnSeriesBySymbol.set(symbol, commonDates.map((d) => s.returnsByDate.get(d) as number));
  }

  const correlationMatrix: CorrelationMatrixResult = {
    symbols: includedSymbols,
    matrix: includedSymbols.map((a) =>
      includedSymbols.map((b) => correlation(returnSeriesBySymbol.get(a)!, returnSeriesBySymbol.get(b)!))
    ),
  };

  // Frontier requires at least one included symbol with return data.
  let frontier: PortfolioAnalyticsResult["frontier"] = {
    simulatedPortfolios: [],
    maxSharpe: null,
    minVolatility: null,
    current: null,
  };
  let portfolioSortinoRatioAnnualized: number | null = null;
  let portfolioMaxDrawdownPct: number | null = null;
  let portfolioHistoricalVaR95Pct: number | null = null;

  if (includedSymbols.length > 0) {
    const expectedReturns = includedSymbols.map((s) => (mean(returnSeriesBySymbol.get(s)!) ?? 0) * TRADING_DAYS_PER_YEAR);
    const covMatrix = includedSymbols.map((a) =>
      includedSymbols.map((b) => (covariance(returnSeriesBySymbol.get(a)!, returnSeriesBySymbol.get(b)!) ?? 0) * TRADING_DAYS_PER_YEAR)
    );

    const simulatedPortfolios: EfficientFrontierPoint[] = Array.from({ length: SIMULATIONS }, () =>
      toPoint(includedSymbols, randomWeights(includedSymbols.length), expectedReturns, covMatrix, annualRiskFreeRate)
    );

    const maxSharpe = simulatedPortfolios.reduce((best, p) => (p.sharpeRatio > best.sharpeRatio ? p : best), simulatedPortfolios[0]);
    const minVolatility = simulatedPortfolios.reduce((best, p) => (p.volatility < best.volatility ? p : best), simulatedPortfolios[0]);

    // Current portfolio's actual weights, restricted to the included
    // symbols — weighted by real live market value (reusing
    // portfolio-valuation.ts's already-proven valuation, same request) for
    // an accurate current-allocation read rather than a cost-basis
    // approximation. Falls back to cost-basis weighting if the live
    // valuation call fails, so a pricing hiccup doesn't blank the frontier.
    let marketValueBySymbol = new Map<string, number>();
    try {
      const valuation = await valuatePortfolio(holdings);
      for (const v of valuation.valuations) {
        if (!includedSymbols.includes(v.holding.symbol) || v.currentValue === null) continue;
        marketValueBySymbol.set(v.holding.symbol, (marketValueBySymbol.get(v.holding.symbol) ?? 0) + v.currentValue);
      }
    } catch {
      dataLimitations.push("Could not load live market values for current-allocation weighting — fell back to cost basis.");
    }
    if (marketValueBySymbol.size === 0) {
      const costBasisBySymbol = new Map<string, number>();
      for (const h of holdings) {
        if (!includedSymbols.includes(h.symbol)) continue;
        costBasisBySymbol.set(h.symbol, (costBasisBySymbol.get(h.symbol) ?? 0) + h.shares * h.costBasisPerShare);
      }
      marketValueBySymbol = costBasisBySymbol;
    }
    const includedMarketValue = [...marketValueBySymbol.values()].reduce((s, v) => s + v, 0);
    const currentWeights = includedSymbols.map((s) => (marketValueBySymbol.get(s) ?? 0) / includedMarketValue);
    const current = includedMarketValue > 0 ? toPoint(includedSymbols, currentWeights, expectedReturns, covMatrix, annualRiskFreeRate) : null;
    if (includedSymbols.length < uniqueSymbols.length) {
      dataLimitations.push(
        "\"Current\" portfolio point and frontier are weighted by live market value across symbols with sufficient return history only — symbols excluded above aren't represented."
      );
    }

    frontier = { simulatedPortfolios, maxSharpe, minVolatility, current };

    // Real portfolio-level risk metrics, built from the same current-weights
    // synthetic daily-return series (Σ weight_i * return_i per common date)
    // — no new data source, same aligned-returns matrix used for the
    // covariance matrix above.
    if (includedMarketValue > 0) {
      const portfolioDailyReturnsPct = commonDates.map((_, dateIdx) =>
        includedSymbols.reduce((sum, s, symIdx) => sum + currentWeights[symIdx] * (returnSeriesBySymbol.get(s)![dateIdx] ?? 0), 0) * 100
      );

      portfolioMaxDrawdownPct = maxDrawdownFromReturns(portfolioDailyReturnsPct);

      const downsideReturns = portfolioDailyReturnsPct.filter((r) => r < 0);
      const downsideDeviation = downsideReturns.length > 0 ? stdDev(downsideReturns) : null;
      const meanDailyReturnPct = mean(portfolioDailyReturnsPct);
      if (downsideDeviation !== null && downsideDeviation > 0 && meanDailyReturnPct !== null) {
        const annualizedReturn = (meanDailyReturnPct / 100) * TRADING_DAYS_PER_YEAR;
        const annualizedDownsideDeviation = (downsideDeviation / 100) * Math.sqrt(TRADING_DAYS_PER_YEAR);
        portfolioSortinoRatioAnnualized = (annualizedReturn - annualRiskFreeRate) / annualizedDownsideDeviation;
      }

      // Historical-simulation VaR — the empirical 5th percentile of the
      // real daily-return sample (not a parametric/normal-distribution
      // approximation), reported as a positive percent of portfolio value.
      const sorted = [...portfolioDailyReturnsPct].sort((a, b) => a - b);
      if (sorted.length >= MIN_OVERLAPPING_DAYS) {
        const idx = Math.floor(sorted.length * 0.05);
        portfolioHistoricalVaR95Pct = -sorted[idx];
      } else {
        dataLimitations.push(`Only ${sorted.length} overlapping trading day(s) — too few for a reliable historical VaR (need ${MIN_OVERLAPPING_DAYS}+).`);
      }
    }
  }

  return {
    benchmark: BENCHMARK,
    lookbackDays: LOOKBACK_DAYS,
    betas,
    correlationMatrix,
    frontier,
    portfolioSortinoRatioAnnualized,
    portfolioMaxDrawdownPct,
    portfolioHistoricalVaR95Pct,
    dataLimitations,
  };
}
