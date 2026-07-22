import { blackScholesGreeks, blackScholesPrice } from "../black-scholes";
import { fetchFredSeries, latest } from "@/lib/data/fred";
import type { BlackScholesInputs, OptionsCalculatorResult, RiskFreeRateResult } from "../types";

const RISK_FREE_RATE_SERIES_ID = "DGS3MO"; // 3-Month Treasury Constant Maturity Rate

/**
 * Live risk-free rate for the options calculator's default — the standard
 * short-dated Treasury-yield proxy, not a hardcoded guess. Callers can still
 * override the field manually; this only sets what it starts at.
 */
export async function getCurrentRiskFreeRate(): Promise<RiskFreeRateResult> {
  const observations = await fetchFredSeries(RISK_FREE_RATE_SERIES_ID, 5);
  const mostRecent = latest(observations);
  if (mostRecent === null) {
    throw new Error(`No recent observations returned for FRED series ${RISK_FREE_RATE_SERIES_ID}.`);
  }
  return {
    ratePercent: mostRecent.value,
    asOfDate: mostRecent.date,
    seriesId: RISK_FREE_RATE_SERIES_ID,
  };
}

export async function getOptionsCalculation(
  inputs: BlackScholesInputs
): Promise<OptionsCalculatorResult> {
  const { spotPrice, strikePrice, daysToExpiration, impliedVolatility, riskFreeRate } = inputs;

  if (spotPrice <= 0) throw new Error("Spot price must be greater than 0.");
  if (strikePrice <= 0) throw new Error("Strike price must be greater than 0.");
  if (daysToExpiration < 0) throw new Error("Days to expiration cannot be negative.");
  if (impliedVolatility <= 0) throw new Error("Implied volatility must be greater than 0.");

  const T = daysToExpiration / 365;
  const sigma = impliedVolatility / 100;
  const r = riskFreeRate / 100;

  const call = {
    price: blackScholesPrice("call", spotPrice, strikePrice, T, sigma, r),
    greeks: blackScholesGreeks("call", spotPrice, strikePrice, T, sigma, r),
  };
  const put = {
    price: blackScholesPrice("put", spotPrice, strikePrice, T, sigma, r),
    greeks: blackScholesGreeks("put", spotPrice, strikePrice, T, sigma, r),
  };

  return { inputs, timeToExpirationYears: T, call, put };
}
