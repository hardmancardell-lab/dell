import { getRecentHypotheses } from "@/lib/data/hypothesis-ledger-db";
import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { fetchQuote } from "@/lib/data/market-data";
import type { DailyBar, GuidedTradeSignal, StrategyHypothesis } from "../types";

/**
 * Only these four strategy types have a matching "is it triggering right
 * now" live-check function (scan-signals.ts / mean-reversion.ts) — the
 * ledger's calendar-effect and ORB rows have no live-trigger analog, so
 * they can never surface here regardless of validation status.
 */
const LIVE_CHECKABLE_STRATEGY_TYPES = new Set(["volumeDisplacement", "momentum", "meanReversionOversold", "meanReversionOverbought"]);

function headlineFor(strategyType: string): string {
  switch (strategyType) {
    case "volumeDisplacement":
      return "Volume Surge";
    case "momentum":
      return "Momentum Breakout";
    case "meanReversionOversold":
      return "Oversold Bounce Setup";
    case "meanReversionOverbought":
      return "Overbought Pullback Setup";
    default:
      return "Trading Setup";
  }
}

function isLiveTriggering(strategyType: string, bars: DailyBar[]): boolean {
  if (strategyType === "volumeDisplacement") return computeVolumeDisplacement(bars).triggered;
  if (strategyType === "momentum") return computeMomentum(bars).triggered;
  if (strategyType === "meanReversionOversold") {
    const m = computeMeanReversion(bars);
    return m.triggered && m.direction === "oversold";
  }
  if (strategyType === "meanReversionOverbought") {
    const m = computeMeanReversion(bars);
    return m.triggered && m.direction === "overbought";
  }
  return false;
}

/**
 * The intersection of two already-built real systems: the Strategy
 * Hypothesis Ledger's weekly sweep (real BH-FDR/bootstrap/out-of-sample
 * validation, capped at a small fixed ticker universe) and a live re-check
 * of whether that same signal is triggering today. A card only ever
 * appears here when both are true — never a live trigger without a real
 * validated track record, never a validated result that isn't actionable
 * today. On a quiet day this legitimately returns an empty list.
 */
export async function getGuidedTradeSignals(): Promise<GuidedTradeSignal[]> {
  const hypotheses = await getRecentHypotheses(200);
  const validated = hypotheses.filter(
    (h) => h.status === "validated" && LIVE_CHECKABLE_STRATEGY_TYPES.has(h.strategyType)
  );

  // One card per ticker+strategyType — the most recently-swept result if the
  // ledger has logged that combination more than once.
  const bestByKey = new Map<string, StrategyHypothesis>();
  for (const h of validated) {
    const key = `${h.ticker}|${h.strategyType}`;
    const existing = bestByKey.get(key);
    if (!existing || new Date(h.createdAt) > new Date(existing.createdAt)) bestByKey.set(key, h);
  }

  const results: GuidedTradeSignal[] = [];
  for (const h of bestByKey.values()) {
    try {
      if (h.winRatePct === null) continue; // "validated" always implies a real win rate, but the type is nullable
      const bars = await getDailyBars(h.ticker, 60);
      if (bars.length === 0 || !isLiveTriggering(h.strategyType, bars)) continue;

      const quote = await fetchQuote(h.ticker);
      results.push({
        ticker: h.ticker,
        assetClass: h.assetClass,
        strategyType: h.strategyType,
        headline: headlineFor(h.strategyType),
        currentPrice: quote.lastPrice,
        historicalWinRatePct: h.winRatePct,
        sampleSize: h.sampleSize,
        bootstrapCiLower: h.bootstrapCiLower,
        bootstrapCiUpper: h.bootstrapCiUpper,
        horizonLabel: h.horizonLabel,
        exitType: h.exitType,
        exitRule: h.exitRule,
        entryRule: h.entryRule,
      });
    } catch {
      // Per-ticker isolation, same philosophy as watchlist-scan.ts — one
      // bad symbol never blanks the rest of the day's guided signals.
    }
  }
  return results;
}
