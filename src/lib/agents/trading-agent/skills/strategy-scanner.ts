import type { GexSignalResult, StrategyRecommendation } from "../types";
import type { SkewLabel } from "./options-flow-skew";

/**
 * Pure, client-safe (type-only imports, no runtime dependency on
 * server-only code — see the timeframe-presets.ts/top-traded-pairs.ts
 * precedent for why that matters for Turbopack's client bundle).
 *
 * Maps the already-computed GEX regime/term-structure/quadrant signal
 * (gex-signal.ts) plus put/call flow skew (options-flow-skew.ts) to 1-2
 * candidate strategy types. This is a documented, rule-based EXPERT
 * HEURISTIC — the underlying inputs (GEX, skew, term structure) are real
 * computed data, but which strategy "fits" a given combination is domain
 * judgment, not a backtested or statistically validated recommendation. Not
 * investment advice.
 */
export function recommendStrategies(
  gexSignal: GexSignalResult | null,
  skew: SkewLabel | null
): StrategyRecommendation[] {
  if (!gexSignal) return [];

  const regime = gexSignal.gexRegime.regime;
  const termShape = gexSignal.termStructure?.shape ?? null;
  const recs: StrategyRecommendation[] = [];

  if (regime === "positive") {
    if (skew === "bullish") {
      recs.push({
        strategyName: "Cash-Secured Put",
        category: "income",
        rationale:
          "Positive dealer gamma tends to dampen realized volatility (dealer hedging leans against the move), and call-heavy flow shows a bullish lean — conditions commonly associated with selling downside premium to collect income while positioned for a stable-to-higher underlying.",
      });
    } else if (skew === "bearish") {
      recs.push({
        strategyName: "Covered Call",
        category: "income",
        rationale:
          "Positive dealer gamma tends to dampen realized volatility, and put-heavy flow shows a bearish/hedging lean — conditions commonly associated with selling upside premium against existing shares to generate income while volatility is suppressed.",
      });
    } else {
      recs.push({
        strategyName: "Iron Condor",
        category: "income",
        rationale:
          "Positive dealer gamma (dealers buy dips / sell rallies to stay hedged) tends to keep the underlying range-bound, and neutral put/call flow shows no strong directional lean — conditions commonly associated with range-bound, premium-selling strategies like iron condors or credit spreads.",
      });
    }
    if (termShape === "backwardation") {
      recs.push({
        strategyName: "Calendar Spread",
        category: "volatility",
        rationale:
          "Even with positive gamma dampening the underlying, backwardation (near-term IV pricing above far-term) shows the market has a near-dated catalyst priced in — a calendar spread (short the elevated near-dated leg, long the cheaper far-dated leg) is commonly considered to harvest that term-structure gap.",
      });
    }
  } else {
    if (termShape === "backwardation") {
      recs.push({
        strategyName: "Long Straddle / Strangle",
        category: "volatility",
        rationale:
          "Negative dealer gamma means dealer hedging amplifies moves rather than dampens them, and backwardation shows the market pricing a near-term catalyst into front-month IV — conditions commonly associated with buying volatility ahead of an expected large move.",
      });
    }
    if (skew === "bearish") {
      recs.push({
        strategyName: "Protective Put / Bear Put Spread",
        category: "hedging",
        rationale:
          "Negative dealer gamma (hedging amplifies moves) combined with put-heavy flow shows both an unstable regime and a bearish lean — conditions commonly associated with buying downside protection or a directional bear spread.",
      });
    } else if (skew === "bullish") {
      recs.push({
        strategyName: "Bull Call Spread",
        category: "directional",
        rationale:
          "Negative dealer gamma (hedging amplifies moves) combined with call-heavy flow shows both an unstable regime and a bullish lean — conditions commonly associated with a directional long-call-spread bet sized for a bigger potential swing.",
      });
    } else if (recs.length === 0) {
      recs.push({
        strategyName: "Calendar Spread",
        category: "volatility",
        rationale:
          "Negative gamma with no clear term-structure or skew lean is a mixed read — no strong directional or volatility-event signal. A calendar spread, which profits from time-decay differential rather than a directional or big-volatility bet, is a reasonable default to consider until a clearer signal emerges.",
      });
    }
  }

  return recs;
}
