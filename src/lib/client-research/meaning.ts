import type { HoldingResearch, ScorecardSummary } from "./types";

/**
 * The one-line plain-English meaning for a holding card. Pure, so a test can pin the wording. The words describe where
 * today's price sits against the company's own past year. They never say a stock is cheap, a bargain, a buy or a sell.
 */

export function holdingMeaning(card: HoldingResearch): { phaseLine: string | null; valuationLine: string } {
  if (card.status !== "ok") return { phaseLine: null, valuationLine: card.message ?? "Research is not available right now." };

  const phaseLine = card.phase ? `${card.phase.name} phase. ${card.phase.plain}` : null;
  const v = card.valuation;
  if (!v || v.position === null || v.averagePremiumPct === null) {
    return { phaseLine, valuationLine: card.valuationNote ?? "A valuation is not available for this company right now." };
  }
  const pct = Math.abs(v.averagePremiumPct);
  const how = v.position === "near" ? `close to its own average for ${v.window} (${pct.toFixed(0)}% ${v.averagePremiumPct >= 0 ? "above" : "below"})` : `${pct.toFixed(0)}% ${v.averagePremiumPct >= 0 ? "above" : "below"} its own average for ${v.window}`;
  return {
    phaseLine,
    valuationLine: `On the measures that fit its phase, the price is ${how}. That looks back one year. It does not say where the price goes next.`,
  };
}

/** Fewer graded calls than this is too few to say anything about how good the calls are. */
export const MIN_GRADED_TO_JUDGE = 10;

/**
 * The track-record sentence for the forecasting note. Always states the sample size, says plainly when none or only a
 * few calls are graded, and never turns a handful of calls into a percentage.
 */
export function trackRecordText(s: ScorecardSummary): string {
  const calls = `${s.logged} outlook call${s.logged === 1 ? "" : "s"}`;
  if (s.graded === 0) return `We have logged ${calls}, and none has been graded yet. There is no track record to show, so treat the outlook as untested.`;
  const regime = s.regimeRight + s.regimeWrong;
  const path = s.pathRight + s.pathWrong;
  const counts = `On the regime label, ${s.regimeRight} of ${regime} graded were right. On the rate path, ${s.pathRight} of ${path} were right.`;
  if (s.graded < MIN_GRADED_TO_JUDGE) {
    return `We have logged ${calls} and graded only ${s.graded}. ${counts} That is too few to say how good the calls are. Do not read a record into it.`;
  }
  return `We have logged ${calls} and graded ${s.graded}. ${counts} Even with this many, past results do not promise future ones.`;
}
