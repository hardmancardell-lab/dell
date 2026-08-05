import type { MarketOptionContract, MarketOptionsChain } from "@/lib/data/market-data-types";

export interface StrategyLegPrefill {
  right: "call" | "put";
  side: "buy" | "sell";
  strike: number;
  expirationDate: string;
  contract: MarketOptionContract;
}

/**
 * Documented, rule-based (not ML) contract-selection heuristic — same
 * "expert heuristic, not investment advice" framing already established for
 * strategy-scanner.ts, which this maps onto real contracts. Every strike
 * picked here is a real row from the live chain (bid/ask/delta/OI already
 * returned by fetchOptionsChain) — this never invents a strike.
 */

function nearestByDelta(contracts: MarketOptionContract[], targetAbsDelta: number): MarketOptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) => (Math.abs(Math.abs(c.delta) - targetAbsDelta) < Math.abs(Math.abs(best.delta) - targetAbsDelta) ? c : best));
}

function nearestByStrike(contracts: MarketOptionContract[], spotPrice: number): MarketOptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) => (Math.abs(c.strikePrice - spotPrice) < Math.abs(best.strikePrice - spotPrice) ? c : best));
}

function otmCalls(chain: MarketOptionsChain, spotPrice: number): MarketOptionContract[] {
  return chain.calls.filter((c) => c.strikePrice > spotPrice);
}
function otmPuts(chain: MarketOptionsChain, spotPrice: number): MarketOptionContract[] {
  return chain.puts.filter((c) => c.strikePrice < spotPrice);
}

function toLeg(right: "call" | "put", side: "buy" | "sell", contract: MarketOptionContract, expirationDate: string): StrategyLegPrefill {
  return { right, side, strike: contract.strikePrice, expirationDate, contract };
}

export function mapStrategyToLegs(
  strategyName: string,
  spotPrice: number,
  chain: MarketOptionsChain,
  expirationDate: string
): StrategyLegPrefill[] | null {
  switch (strategyName) {
    case "Covered Call": {
      const c = nearestByDelta(otmCalls(chain, spotPrice), 0.3);
      return c ? [toLeg("call", "sell", c, expirationDate)] : null;
    }
    case "Cash-Secured Put": {
      const p = nearestByDelta(otmPuts(chain, spotPrice), 0.3);
      return p ? [toLeg("put", "sell", p, expirationDate)] : null;
    }
    case "Bull Call Spread": {
      const longLeg = nearestByStrike(chain.calls, spotPrice);
      const shortLeg = nearestByDelta(otmCalls(chain, spotPrice), 0.25);
      if (!longLeg || !shortLeg || longLeg.strikePrice === shortLeg.strikePrice) return null;
      return [toLeg("call", "buy", longLeg, expirationDate), toLeg("call", "sell", shortLeg, expirationDate)];
    }
    case "Protective Put / Bear Put Spread": {
      const longLeg = nearestByStrike(chain.puts, spotPrice);
      return longLeg ? [toLeg("put", "buy", longLeg, expirationDate)] : null;
    }
    case "Long Straddle / Strangle": {
      const call = nearestByStrike(chain.calls, spotPrice);
      const put = nearestByStrike(chain.puts, spotPrice);
      if (!call || !put) return null;
      return [toLeg("call", "buy", call, expirationDate), toLeg("put", "buy", put, expirationDate)];
    }
    case "Iron Condor": {
      const shortCall = nearestByDelta(otmCalls(chain, spotPrice), 0.16);
      const shortPut = nearestByDelta(otmPuts(chain, spotPrice), 0.16);
      const longCall = otmCalls(chain, spotPrice)
        .filter((c) => shortCall && c.strikePrice > shortCall.strikePrice)
        .sort((a, b) => a.strikePrice - b.strikePrice)[0];
      const longPut = otmPuts(chain, spotPrice)
        .filter((c) => shortPut && c.strikePrice < shortPut.strikePrice)
        .sort((a, b) => b.strikePrice - a.strikePrice)[0];
      if (!shortCall || !shortPut || !longCall || !longPut) return null;
      return [
        toLeg("call", "sell", shortCall, expirationDate),
        toLeg("call", "buy", longCall, expirationDate),
        toLeg("put", "sell", shortPut, expirationDate),
        toLeg("put", "buy", longPut, expirationDate),
      ];
    }
    case "Calendar Spread":
      // Calendar spreads need two different expirations on the same strike
      // — this app's chain fetch is single-expiration, so a calendar
      // spread can't be safely auto-mapped from one chain snapshot without
      // a second fetch the caller hasn't requested. Not mapped here rather
      // than guessing a second expiration.
      return null;
    default:
      return null;
  }
}
