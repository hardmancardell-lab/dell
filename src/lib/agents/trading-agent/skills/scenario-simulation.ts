import { valuatePortfolio } from "./portfolio-valuation";
import { runPortfolioAnalytics } from "./portfolio-analytics";
import { getDailyBars } from "./daily-bars";
import { mean, stdDev } from "../stats";
import type {
  HoldingBeta,
  MarketScenarioAssumption,
  MarketScenarioLabel,
  PortfolioHolding,
  ScenarioProjection,
  ScenarioProjectionPoint,
  ScenarioSimulationResult,
} from "../types";

/**
 * Projects the *current* portfolio forward through time under real
 * historical market-return regimes — distinct from portfolio-analytics.ts's
 * Monte Carlo, which sweeps portfolio *weight combinations* at a point in
 * time. This reuses that skill's already-computed per-holding beta/alpha
 * rather than re-deriving any regression.
 */

const BENCHMARK = "SPY";
// ~10yr target lookback for deriving real good/bad/average market-return
// scenarios — gracefully degrades (and flags in dataLimitations) if the
// provider returns less.
const SCENARIO_LOOKBACK_DAYS = 3650;
const TRADING_DAYS_PER_YEAR = 252;
const ROLLING_WINDOW_DAYS = TRADING_DAYS_PER_YEAR;
// Rolling 1yr windows overlap heavily day-to-day (autocorrelated); sampling
// every ~21 trading days (~monthly) thins that out without needing a longer
// history than what's already fetched.
const SAMPLE_STRIDE_DAYS = 21;
const MIN_SAMPLE_YEARS = 5;
// 1,000 paths per scenario (3,000 total) — cheap at up to MAX_HORIZON_YEARS
// steps each, dense enough for stable p10/p50/p90 bands.
const SIMULATIONS = 1000;
const DEFAULT_HORIZON_YEARS = 10;
const MAX_HORIZON_YEARS = 25;
// Used only if a live SPY volatility calculation fails outright — SPY's
// long-run annualized volatility is typically in this range.
const FALLBACK_MARKET_VOLATILITY = 0.15;

interface MarketScenarios {
  assumptions: Record<MarketScenarioLabel, MarketScenarioAssumption>;
  annualVolatility: number | null;
  limitation: string | null;
}

async function fetchMarketScenarios(): Promise<MarketScenarios> {
  const bars = await getDailyBars(BENCHMARK, SCENARIO_LOOKBACK_DAYS);
  if (bars.length < ROLLING_WINDOW_DAYS + 1) {
    throw new Error(
      `Only ${bars.length} trading day(s) of ${BENCHMARK} history available — need at least ${ROLLING_WINDOW_DAYS + 1} to derive a single rolling 1-year return, let alone good/bad/average scenarios.`
    );
  }

  const rollingReturns: number[] = [];
  for (let i = ROLLING_WINDOW_DAYS; i < bars.length; i++) {
    const startClose = bars[i - ROLLING_WINDOW_DAYS].close;
    if (startClose === 0) continue;
    rollingReturns.push(bars[i].close / startClose - 1);
  }
  const sampled = rollingReturns.filter((_, idx) => idx % SAMPLE_STRIDE_DAYS === 0);
  const sorted = [...sampled].sort((a, b) => a - b);
  const n = sorted.length;
  const tercileSize = Math.max(1, Math.floor(n / 3));
  const badSlice = sorted.slice(0, tercileSize);
  const goodSlice = sorted.slice(n - tercileSize);
  const avgReturn = mean(sampled) ?? 0;
  const badReturn = mean(badSlice) ?? avgReturn;
  const goodReturn = mean(goodSlice) ?? avgReturn;
  const sampleYears = bars.length / TRADING_DAYS_PER_YEAR;

  const dailyReturns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i - 1].close === 0) continue;
    dailyReturns.push(bars[i].close / bars[i - 1].close - 1);
  }
  const dailyVol = stdDev(dailyReturns);
  const annualVolatility = dailyVol !== null ? dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR) : null;

  return {
    assumptions: {
      good: { label: "good", annualReturn: goodReturn, sampleYears, sampleSize: n },
      average: { label: "average", annualReturn: avgReturn, sampleYears, sampleSize: n },
      bad: { label: "bad", annualReturn: badReturn, sampleYears, sampleSize: n },
    },
    annualVolatility,
    limitation:
      sampleYears < MIN_SAMPLE_YEARS
        ? `Only ${sampleYears.toFixed(1)} years of ${BENCHMARK} history was available (targeted ${(SCENARIO_LOOKBACK_DAYS / 365).toFixed(0)}) — good/bad/average scenario assumptions are based on a shorter, noisier sample than ideal.`
        : null,
  };
}

interface WeightedFactor {
  beta: number | null;
  alpha: number | null; // annualized
  usedValue: number;
  excludedValue: number;
}

/** Current-market-value-weighted average of each holding's own beta/alpha vs SPY (already computed by runPortfolioAnalytics — no regression re-derived here). */
function weightedPortfolioFactor(betas: HoldingBeta[], currentValueBySymbol: Map<string, number>): WeightedFactor {
  let weightedBetaSum = 0;
  let weightedAlphaSum = 0;
  let usedValue = 0;
  for (const b of betas) {
    if (b.beta === null || b.alpha === null) continue;
    const v = currentValueBySymbol.get(b.symbol) ?? 0;
    if (v <= 0) continue;
    weightedBetaSum += b.beta * v;
    weightedAlphaSum += b.alpha * TRADING_DAYS_PER_YEAR * v; // daily alpha -> annualized
    usedValue += v;
  }
  const totalValue = [...currentValueBySymbol.values()].reduce((s, v) => s + v, 0);
  if (usedValue === 0) return { beta: null, alpha: null, usedValue, excludedValue: totalValue };
  return { beta: weightedBetaSum / usedValue, alpha: weightedAlphaSum / usedValue, usedValue, excludedValue: totalValue - usedValue };
}

function randNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((p / 100) * sortedValues.length)));
  return sortedValues[idx];
}

function simulateScenario(
  assumption: MarketScenarioAssumption,
  portfolioBeta: number,
  portfolioAlpha: number,
  marketVolatility: number,
  residualVolatility: number,
  currentValue: number,
  horizonYears: number
): ScenarioProjection {
  const paths: number[][] = Array.from({ length: SIMULATIONS }, () => {
    let value = currentValue;
    const path = [value];
    for (let year = 1; year <= horizonYears; year++) {
      const marketReturn = assumption.annualReturn + randNormal() * marketVolatility;
      const idiosyncraticReturn = randNormal() * residualVolatility;
      const portfolioYearReturn = portfolioAlpha + portfolioBeta * marketReturn + idiosyncraticReturn;
      value = Math.max(value * (1 + portfolioYearReturn), 0);
      path.push(value);
    }
    return path;
  });

  const projection: ScenarioProjectionPoint[] = [];
  for (let year = 0; year <= horizonYears; year++) {
    const valuesAtYear = paths.map((p) => p[year]).sort((a, b) => a - b);
    projection.push({
      year,
      p10: percentile(valuesAtYear, 10),
      p50: percentile(valuesAtYear, 50),
      p90: percentile(valuesAtYear, 90),
    });
  }

  const endingValue = { p10: projection[horizonYears].p10, p50: projection[horizonYears].p50, p90: projection[horizonYears].p90 };
  const totalReturnPercent = {
    p10: currentValue > 0 ? ((endingValue.p10 - currentValue) / currentValue) * 100 : 0,
    p50: currentValue > 0 ? ((endingValue.p50 - currentValue) / currentValue) * 100 : 0,
    p90: currentValue > 0 ? ((endingValue.p90 - currentValue) / currentValue) * 100 : 0,
  };

  return { label: assumption.label, assumption, projection, endingValue, totalReturnPercent };
}

export async function runScenarioSimulation(
  holdings: PortfolioHolding[],
  horizonYears: number = DEFAULT_HORIZON_YEARS
): Promise<ScenarioSimulationResult> {
  if (holdings.length === 0) {
    throw new Error("Portfolio is empty — add at least one holding before running a scenario simulation.");
  }
  const clampedHorizon = Math.min(MAX_HORIZON_YEARS, Math.max(1, Math.round(horizonYears)));

  const [valuation, analytics, marketScenarios] = await Promise.all([
    valuatePortfolio(holdings),
    runPortfolioAnalytics(holdings),
    fetchMarketScenarios(),
  ]);

  const dataLimitations: string[] = [
    "Each scenario's market-return assumption is derived from real historical SPY performance (rolling 1-year windows over the available lookback), not a hardcoded projection.",
    "Portfolio-level return under each scenario uses a single-factor (CAPM) approximation — portfolioReturn ≈ alpha + beta × marketReturn — where alpha/beta are the current-market-value-weighted average of each holding's own regression against SPY (already computed for the Modern Portfolio Theory tab, reused here as-is). This is a simplification, not a guarantee.",
    `Each scenario runs ${SIMULATIONS} simulated paths using the portfolio's own historical volatility (market-driven plus idiosyncratic) — shown as p10/p50/p90 bands, not a single predicted outcome.`,
    ...valuation.dataLimitations,
    ...analytics.dataLimitations,
  ];
  if (marketScenarios.limitation) dataLimitations.push(marketScenarios.limitation);

  const currentValueBySymbol = new Map<string, number>();
  for (const v of valuation.valuations) {
    if (v.currentValue === null) continue;
    currentValueBySymbol.set(v.holding.symbol, (currentValueBySymbol.get(v.holding.symbol) ?? 0) + v.currentValue);
  }

  const factor = weightedPortfolioFactor(analytics.betas, currentValueBySymbol);
  if (factor.beta === null || factor.alpha === null) {
    throw new Error(
      "Could not estimate portfolio beta/alpha against SPY — every holding either failed to price or had insufficient overlapping history for a regression. Add holdings with more trading history and try again."
    );
  }
  const beta = factor.beta;
  const alpha = factor.alpha;
  if (Math.abs(alpha) > 0.03) {
    dataLimitations.push(
      `Portfolio alpha (${(alpha * 100).toFixed(1)}% annualized) is compounded every simulated year alongside the scenario's market return. Alpha here is each holding's own backward-looking outperformance (or underperformance) against ${BENCHMARK} over the beta lookback — it is not guaranteed to persist, and compounding it unchanged over a multi-year horizon can produce extreme results, especially for individual stocks that outran the market recently. Treat the beta-driven, market-anchored part of each projection as the more durable signal than the alpha-driven part.`
    );
  }
  if (factor.excludedValue > 0) {
    dataLimitations.push(
      `$${factor.excludedValue.toFixed(2)} of current portfolio value has no usable beta against ${BENCHMARK} and is excluded from the beta/alpha estimate — scenario projections are still applied to the full portfolio value, but the underlying beta only reflects the $${factor.usedValue.toFixed(2)} that has one.`
    );
  }

  let totalPortfolioVolatility = analytics.frontier.current?.volatility ?? null;
  if (totalPortfolioVolatility === null) {
    let weighted = 0;
    let usedValue = 0;
    for (const b of analytics.betas) {
      if (b.volatilityAnnualizedPercent === null) continue;
      const v = currentValueBySymbol.get(b.symbol) ?? 0;
      weighted += (b.volatilityAnnualizedPercent / 100) * v;
      usedValue += v;
    }
    if (usedValue > 0) {
      totalPortfolioVolatility = weighted / usedValue;
      dataLimitations.push(
        "Total portfolio volatility could not be computed from the full covariance matrix (insufficient overlapping history across holdings) — falling back to a value-weighted average of individual holding volatilities, which ignores diversification and likely overstates risk."
      );
    }
  }

  const marketVolatility = marketScenarios.annualVolatility ?? FALLBACK_MARKET_VOLATILITY;
  if (marketScenarios.annualVolatility === null) {
    dataLimitations.push(
      `Could not compute ${BENCHMARK}'s historical volatility from fetched data — falling back to a ${(FALLBACK_MARKET_VOLATILITY * 100).toFixed(0)}% assumption for the simulation's market-return noise term.`
    );
  }

  const marketVariance = beta ** 2 * marketVolatility ** 2;
  const portfolioVariance = totalPortfolioVolatility !== null ? totalPortfolioVolatility ** 2 : marketVariance;
  const residualVolatility = Math.sqrt(Math.max(portfolioVariance - marketVariance, 0));

  const currentPortfolioValue = valuation.totalValue;

  const scenarios: ScenarioProjection[] = (["good", "average", "bad"] as MarketScenarioLabel[]).map((label) =>
    simulateScenario(
      marketScenarios.assumptions[label],
      beta,
      alpha,
      marketVolatility,
      residualVolatility,
      currentPortfolioValue,
      clampedHorizon
    )
  );

  return {
    currentPortfolioValue,
    portfolioBeta: beta,
    portfolioAlpha: alpha,
    horizonYears: clampedHorizon,
    scenarios,
    dataLimitations,
  };
}
