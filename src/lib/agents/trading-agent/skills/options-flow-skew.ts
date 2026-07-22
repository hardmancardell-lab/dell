// Pure, zero-dependency helper — safe for client components to import
// directly (same reasoning as asset-class-label.ts). Only type-only imports
// below (OptionsChainSummary), so this stays zero-runtime-dependency.
import type { OptionsChainSummary } from "../types";

export type SkewLabel = "bullish" | "bearish" | "neutral";

const BEARISH_THRESHOLD = 1.5;
const BULLISH_THRESHOLD = 0.7;

export function classifyPutCallSkew(putCallVolumeRatio: number | null): SkewLabel {
  if (putCallVolumeRatio === null) return "neutral";
  if (putCallVolumeRatio > BEARISH_THRESHOLD) return "bearish";
  if (putCallVolumeRatio < BULLISH_THRESHOLD) return "bullish";
  return "neutral";
}

// Same constant-threshold style as BEARISH_THRESHOLD/BULLISH_THRESHOLD above.
// Same-day only — no historical options-volume series exists anywhere in
// this app (Tradier's chain endpoint is a snapshot), so this flags a strike
// whose volume/OI ratio crosses a stated bar today, not a rolling anomaly
// the way the equity-side Volume Displacement signal is.
export const UNUSUAL_VOLUME_OI_RATIO = 2;

export interface UnusualOptionsActivity {
  triggered: boolean;
  maxRatio: number | null;
  strikePrice: number | null;
  side: "call" | "put" | null;
}

/** flowRatioAtStrike (volume/OI) applied across every strike in the chain, not just the two GEX walls. */
export function computeChainWideUnusualActivity(
  chain: OptionsChainSummary,
  threshold: number = UNUSUAL_VOLUME_OI_RATIO
): UnusualOptionsActivity {
  let maxRatio: number | null = null;
  let strikePrice: number | null = null;
  let side: "call" | "put" | null = null;

  for (const row of chain.strikes) {
    const callRatio = row.callOpenInterest > 0 ? row.callVolume / row.callOpenInterest : null;
    const putRatio = row.putOpenInterest > 0 ? row.putVolume / row.putOpenInterest : null;
    if (callRatio !== null && (maxRatio === null || callRatio > maxRatio)) {
      maxRatio = callRatio;
      strikePrice = row.strikePrice;
      side = "call";
    }
    if (putRatio !== null && (maxRatio === null || putRatio > maxRatio)) {
      maxRatio = putRatio;
      strikePrice = row.strikePrice;
      side = "put";
    }
  }

  return { triggered: maxRatio !== null && maxRatio >= threshold, maxRatio, strikePrice, side };
}
