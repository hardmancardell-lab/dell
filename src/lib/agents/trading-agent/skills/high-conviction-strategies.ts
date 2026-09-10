import { getHighWinRateHypotheses } from "@/lib/data/hypothesis-ledger-db";
import { getOptionStructureForHypothesis } from "./strategy-suggestion";
import { toEasternParts } from "./time-windows";
import type { HighConvictionStrategy, StrategyHypothesis } from "../types";

// Same long/short convention as strategy-suggestion.ts's directionFor —
// meanReversionOverbought is this app's only short-side momentum-family
// signal. Duplicated rather than imported since it's one line and this
// module intentionally doesn't depend on strategy-suggestion.ts's internal
// ledger-writing side effects, only its pure structure-picking helper.
function directionFor(strategyType: string): "long" | "short" {
  return strategyType === "meanReversionOverbought" ? "short" : "long";
}

const MOMENTUM_FAMILY = new Set(["volumeDisplacement", "momentum", "meanReversionOversold", "meanReversionOverbought"]);

/**
 * "Write a trading strategy for every backtest that comes back with an
 * 84% win rate or better" — pulls every real hypothesis-ledger row at or
 * above minWinRatePct (validated or not; passesThreeBars is returned per
 * row so win rate and statistical significance are both visible, never
 * one masking the other), deduped to the most recent sweep per
 * (ticker, strategyType, horizonLabel), and assembles the entry/exit/stop/
 * option pieces this app already computes elsewhere into one real writeup
 * per result. Only sourceEngine "historical-backtest" gets a real option
 * structure + stop-loss verdict — ORB/calendar-effects rows show real
 * entry/exit/win-rate data but disclose that those two pieces aren't built
 * for their engine yet, rather than guessing at a direction/horizon
 * convention that was never designed for them.
 */
export async function getHighConvictionStrategies(minWinRatePct = 84): Promise<HighConvictionStrategy[]> {
  const hypotheses = await getHighWinRateHypotheses(minWinRatePct);

  const bestByKey = new Map<string, StrategyHypothesis>();
  for (const h of hypotheses) {
    const key = `${h.ticker}|${h.strategyType}|${h.horizonLabel}`;
    const existing = bestByKey.get(key);
    if (!existing || new Date(h.createdAt) > new Date(existing.createdAt)) bestByKey.set(key, h);
  }

  const todayDateKey = toEasternParts(Date.now()).dateKey;
  const results: HighConvictionStrategy[] = [];

  for (const h of bestByKey.values()) {
    if (h.winRatePct === null) continue;

    let suggestedOption: HighConvictionStrategy["suggestedOption"] = null;
    let optionStructureNote: string | null = null;

    if (h.sourceEngine === "historical-backtest" && MOMENTUM_FAMILY.has(h.strategyType)) {
      const horizonMatch = h.horizonLabel.match(/(\d+)/);
      const horizonDays = horizonMatch ? Number(horizonMatch[1]) : 20;
      try {
        suggestedOption = await getOptionStructureForHypothesis(h.ticker, horizonDays, directionFor(h.strategyType), todayDateKey);
        if (!suggestedOption) {
          optionStructureNote = `No live options chain/expiration far enough out could be resolved for ${h.ticker} right now.`;
        }
      } catch (err) {
        optionStructureNote = `Could not price a structure: ${err instanceof Error ? err.message : "unknown error"}.`;
      }
    } else {
      optionStructureNote = `Option-structure suggestions are only built for the momentum-family engine (volumeDisplacement/momentum/meanReversionOversold/meanReversionOverbought) — "${h.sourceEngine}" doesn't have a real direction/horizon convention wired to it yet.`;
    }

    results.push({
      hypothesisId: h.id,
      ticker: h.ticker,
      assetClass: h.assetClass,
      strategyType: h.strategyType,
      sourceEngine: h.sourceEngine,
      horizonLabel: h.horizonLabel,
      winRatePct: h.winRatePct,
      sampleSize: h.sampleSize,
      profitFactor: h.profitFactor,
      passesThreeBars: h.passesThreeBars,
      entryRule: h.entryRule,
      exitType: h.exitType,
      exitRule: h.exitRule,
      largestLossPct: h.largestLossPct,
      maxDrawdownPct: h.maxDrawdownPct,
      stopLossVerdict: h.stopLossVerdict,
      suggestedOption,
      optionStructureNote,
    });
  }

  results.sort((a, b) => b.winRatePct - a.winRatePct);
  return results;
}
