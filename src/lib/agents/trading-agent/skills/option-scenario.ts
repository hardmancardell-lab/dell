import { blackScholesPrice } from "../black-scholes";
import type { PaperOptionRight } from "../types";

// Underlying-price scenarios tested at the chosen date, held against the
// SAME implied volatility captured at suggestion time — "all volatility the
// same," per the user's own framing, so this isolates the price-move
// question from the (separate, real, unmodeled) question of whether IV
// itself changes between now and then.
const SCENARIO_PCT_MOVES = [-10, -5, -2, 0, 2, 5, 10];

export interface OptionScenarioRow {
  underlyingPricePct: number;
  underlyingPrice: number;
  theoreticalValue: number; // per-share option price (not x100)
  profitPerContract: number; // (theoreticalValue - entryDebit) * 100
  profitPct: number; // relative to entryDebit paid
}

export interface OptionScenarioAnalysis {
  scenarioDate: string;
  daysToExpirationAtScenario: number;
  impliedVolatilityPct: number;
  riskFreeRatePct: number;
  breakevenUnderlyingPrice: number | null;
  rows: OptionScenarioRow[];
  dataLimitations: string[];
}

function netValueAt(
  S: number,
  optionRight: PaperOptionRight,
  longStrike: number,
  shortStrike: number | null,
  T: number,
  sigma: number,
  r: number
): number {
  const longValue = blackScholesPrice(optionRight, S, longStrike, T, sigma, r);
  if (shortStrike === null) return longValue;
  const shortValue = blackScholesPrice(optionRight, S, shortStrike, T, sigma, r);
  return longValue - shortValue;
}

/**
 * Bisection root-find for the underlying price where the contract's (or
 * spread's) theoretical value equals the entry debit — the real breakeven
 * at this specific scenario date, not just at expiration. Works because a
 * single option's value is monotonic in S, and a debit spread's net value
 * is monotonic between its strikes (flat outside them) — a real, disclosed
 * limitation if entryDebit falls outside the range the search covers.
 */
function findBreakeven(
  optionRight: PaperOptionRight,
  longStrike: number,
  shortStrike: number | null,
  T: number,
  sigma: number,
  r: number,
  entryDebit: number,
  spotPrice: number
): number | null {
  let lo = spotPrice * 0.3;
  let hi = spotPrice * 3;
  const f = (S: number) => netValueAt(S, optionRight, longStrike, shortStrike, T, sigma, r) - entryDebit;

  const isCall = optionRight === "call";
  const fLo = f(lo);
  const fHi = f(hi);
  // A call's value increases with S, a put's decreases — orient the search
  // so we're always bisecting a real sign change, not assuming one exists.
  if ((isCall && fLo > 0) || (!isCall && fHi > 0)) return null; // even the widest range never reaches entryDebit
  if ((isCall && fHi < 0) || (!isCall && fLo < 0)) return null; // entryDebit exceeds the max value achievable in range

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 0.0005) return mid;
    const goRight = isCall ? fMid < 0 : fMid > 0;
    if (goRight) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function computeOptionScenarioAnalysis(input: {
  optionRight: PaperOptionRight;
  longStrike: number;
  shortStrike: number | null;
  spotPrice: number;
  entryDebit: number;
  scenarioDate: string;
  expirationDate: string;
  impliedVolatilityPct: number;
  riskFreeRatePct: number;
}): OptionScenarioAnalysis {
  const { optionRight, longStrike, shortStrike, spotPrice, entryDebit, scenarioDate, expirationDate, impliedVolatilityPct, riskFreeRatePct } = input;
  const daysToExpirationAtScenario = Math.max(
    0,
    Math.round((new Date(`${expirationDate}T00:00:00`).getTime() - new Date(`${scenarioDate}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24))
  );
  const T = daysToExpirationAtScenario / 365;
  const sigma = impliedVolatilityPct / 100;
  const r = riskFreeRatePct / 100;

  const rows: OptionScenarioRow[] = SCENARIO_PCT_MOVES.map((pct) => {
    const underlyingPrice = spotPrice * (1 + pct / 100);
    const theoreticalValue = netValueAt(underlyingPrice, optionRight, longStrike, shortStrike, T, sigma, r);
    const profitPerContract = (theoreticalValue - entryDebit) * 100;
    return {
      underlyingPricePct: pct,
      underlyingPrice,
      theoreticalValue,
      profitPerContract,
      profitPct: entryDebit !== 0 ? (profitPerContract / (entryDebit * 100)) * 100 : 0,
    };
  });

  const breakevenUnderlyingPrice = findBreakeven(optionRight, longStrike, shortStrike, T, sigma, r, entryDebit, spotPrice);

  const dataLimitations: string[] = [
    "Implied volatility is held fixed at the level captured when this suggestion was made — real IV moves over time (often dropping after the setup's catalyst plays out, a real headwind for a long option even if the underlying moves the right way), and that effect isn't modeled here.",
    "Uses the Black-Scholes-Merton model (European-style, no early exercise/dividend adjustment) — a standard, disclosed approximation for real American-style equity options, same convention as this app's Options Calculator.",
  ];
  if (breakevenUnderlyingPrice === null) {
    dataLimitations.push("No breakeven price found within a 0.3x-3x range of the current underlying price at this scenario date — the position may already be showing a value below/above what's achievable in a plausible price range.");
  }

  return {
    scenarioDate,
    daysToExpirationAtScenario,
    impliedVolatilityPct,
    riskFreeRatePct,
    breakevenUnderlyingPrice,
    rows,
    dataLimitations,
  };
}
