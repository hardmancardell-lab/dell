import { fetchReturnsFor } from "./portfolio-analytics";
import { linearRegression, correlation } from "../stats";

export interface PairRegressionResult {
  xSymbol: string;
  ySymbol: string;
  lookbackDays: number;
  sampleSize: number;
  slope: number | null; // beta of y on x: y's expected move per 1 unit (100%) move in x
  intercept: number | null; // daily alpha (as a decimal return), annualized separately by the caller if needed
  rSquared: number | null;
  correlation: number | null;
  dataLimitations: string[];
}

const LOOKBACK_DAYS = 395;
const MIN_OVERLAPPING_DAYS = 30;

/**
 * Real pairwise OLS regression (y regressed on x) between any two tickers,
 * generalizing portfolio-analytics.ts's beta-vs-SPY regression to an
 * arbitrary pair — same fetchReturnsFor/linearRegression primitives, same
 * dateKey-aligned-overlap discipline as correlation-finder.ts.
 */
export async function getPairRegression(xSymbol: string, ySymbol: string): Promise<PairRegressionResult> {
  const x = xSymbol.trim().toUpperCase();
  const y = ySymbol.trim().toUpperCase();
  if (!x || !y) throw new Error("Both tickers are required.");
  if (x === y) throw new Error("Tickers must be different.");

  const dataLimitations: string[] = [
    "Regression uses ~1 year of daily returns (n<30 treated as unreliable) — an OLS fit over this specific window, not a structural or forward-looking relationship.",
  ];

  const [xReturns, yReturns] = await Promise.all([fetchReturnsFor(x), fetchReturnsFor(y)]);
  if (xReturns.error) throw new Error(`Could not fetch data for ${x}: ${xReturns.error}`);
  if (yReturns.error) throw new Error(`Could not fetch data for ${y}: ${yReturns.error}`);

  const commonDates = [...xReturns.returnsByDate.keys()].filter((d) => yReturns.returnsByDate.has(d));
  if (commonDates.length < MIN_OVERLAPPING_DAYS) {
    dataLimitations.push(`Only ${commonDates.length} overlapping trading day(s) — below the ${MIN_OVERLAPPING_DAYS}-day reliability floor used elsewhere in this app.`);
    return {
      xSymbol: x,
      ySymbol: y,
      lookbackDays: LOOKBACK_DAYS,
      sampleSize: commonDates.length,
      slope: null,
      intercept: null,
      rSquared: null,
      correlation: null,
      dataLimitations,
    };
  }

  const xSeries = commonDates.map((d) => xReturns.returnsByDate.get(d) as number);
  const ySeries = commonDates.map((d) => yReturns.returnsByDate.get(d) as number);
  const reg = linearRegression(xSeries, ySeries);
  const corr = correlation(xSeries, ySeries);

  return {
    xSymbol: x,
    ySymbol: y,
    lookbackDays: LOOKBACK_DAYS,
    sampleSize: commonDates.length,
    slope: reg?.slope ?? null,
    intercept: reg?.intercept ?? null,
    rSquared: reg?.rSquared ?? null,
    correlation: corr,
    dataLimitations,
  };
}
