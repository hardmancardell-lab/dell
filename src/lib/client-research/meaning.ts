import type { HoldingResearch } from "./types";

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
