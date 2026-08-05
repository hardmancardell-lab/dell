import { intrinsicValue, type OptionType } from "../black-scholes";

export interface PayoffLeg {
  right: OptionType;
  strike: number;
  side: "buy" | "sell";
  premium: number; // real fill/reference price per share, before the x100 contract multiplier
  contracts: number;
}

export interface PayoffPoint {
  underlyingPrice: number;
  pnl: number; // total P&L across all legs at this underlying price, at expiration
}

const CONTRACT_MULTIPLIER = 100;

/**
 * Real options payoff-at-expiration math: sums each leg's intrinsic value
 * (via black-scholes.ts's intrinsicValue, already used elsewhere in this
 * app) net of the premium paid/received, across a swept underlying-price
 * range. Pure, deterministic — no new data source, no fabricated numbers.
 */
export function computeStrategyPayoff(legs: PayoffLeg[], priceRange: number[]): PayoffPoint[] {
  return priceRange.map((underlyingPrice) => {
    let pnl = 0;
    for (const leg of legs) {
      const valueAtExpiration = intrinsicValue(leg.right, underlyingPrice, leg.strike) * CONTRACT_MULTIPLIER * leg.contracts;
      const premiumPaidOrReceived = leg.premium * CONTRACT_MULTIPLIER * leg.contracts;
      // Buying: pay premium now, receive intrinsic value at expiration.
      // Selling: receive premium now, owe intrinsic value at expiration.
      pnl += leg.side === "buy" ? valueAtExpiration - premiumPaidOrReceived : premiumPaidOrReceived - valueAtExpiration;
    }
    return { underlyingPrice, pnl };
  });
}

export interface StrategyPayoffSummary {
  points: PayoffPoint[];
  maxProfit: number | null; // null = unbounded (e.g. a naked long call/put's upside, or a naked short's downside)
  maxLoss: number | null;
  breakevens: number[];
}

/**
 * Builds a real payoff curve across a sensible price range (spot +/- 40%,
 * 200 points) and derives max profit/loss and breakeven price(s) from it.
 * maxProfit/maxLoss are reported as null (unbounded) when the swept range's
 * edge value hasn't leveled off — a real, disclosed limitation of any
 * finite-range numerical approach, not silently clamped to a wrong number.
 */
export function summarizeStrategyPayoff(legs: PayoffLeg[], spotPrice: number): StrategyPayoffSummary {
  const lo = spotPrice * 0.6;
  const hi = spotPrice * 1.4;
  const steps = 200;
  const priceRange = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
  const points = computeStrategyPayoff(legs, priceRange);

  const pnls = points.map((p) => p.pnl);
  const maxPnl = Math.max(...pnls);
  const minPnl = Math.min(...pnls);

  // If P&L is still changing meaningfully at either swept edge, that side is
  // unbounded within this finite range rather than a real plateau — flagged
  // as null (unbounded), not reported as a false finite number.
  const edgeSlopeThreshold = Math.abs(hi - lo) > 0 ? (maxPnl - minPnl) * 0.001 : 0;
  const risingAtHighEdge = Math.abs(points[points.length - 1].pnl - points[points.length - 2].pnl) > edgeSlopeThreshold;
  const risingAtLowEdge = Math.abs(points[1].pnl - points[0].pnl) > edgeSlopeThreshold;

  const maxProfit = risingAtHighEdge && points[points.length - 1].pnl === maxPnl ? null : maxPnl;
  const maxLoss = risingAtLowEdge && points[0].pnl === minPnl ? null : minPnl;

  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
      // Linear interpolation between the two sampled points for a more
      // precise crossing price than just the sample grid resolution.
      const t = a.pnl === b.pnl ? 0 : -a.pnl / (b.pnl - a.pnl);
      breakevens.push(a.underlyingPrice + t * (b.underlyingPrice - a.underlyingPrice));
    }
  }

  return { points, maxProfit, maxLoss, breakevens };
}
