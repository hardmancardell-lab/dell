import { blackScholesGreeks } from "../black-scholes";
import type { HedgeCalculatorInput, HedgeCalculatorResult } from "../types";

/**
 * "How many options does it take to balance/hedge a position" — pure math
 * reusing blackScholesGreeks (already validated, zero I/O) rather than a
 * new pricing model. Client-safe, no API route needed.
 *
 * Derivation: a stock position of `positionShares` has delta exactly equal
 * to its share count (1 share = 1 delta). Adding N option contracts (each
 * with delta `d` and multiplier `m`) changes total delta by N*d*m. Solving
 * for the N that leaves the position at `(1 - targetHedgeRatio)` of its
 * original delta (0 = fully hedged, i.e. delta-neutral, when
 * targetHedgeRatio = 1):
 *   N = -(positionShares * targetHedgeRatio) / (delta * contractMultiplier)
 * Positive N = buy (go long) that many contracts; negative = sell/write.
 */
export function computeHedge(input: HedgeCalculatorInput): HedgeCalculatorResult {
  const T = input.daysToExpiration / 365;
  const sigma = input.impliedVolatilityPercent / 100;
  const r = input.riskFreeRatePercent / 100;

  const { delta } = blackScholesGreeks(input.optionType, input.spot, input.strike, T, sigma, r);

  const sharesHedgedPerContract = delta * input.contractMultiplier;
  const contractsNeeded =
    delta !== 0 ? -(input.positionShares * input.targetHedgeRatio) / (delta * input.contractMultiplier) : 0;

  return {
    delta,
    contractsNeeded,
    contractsNeededRounded: Math.round(contractsNeeded),
    sharesHedgedPerContract,
  };
}
