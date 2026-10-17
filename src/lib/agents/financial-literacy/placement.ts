import { LITERACY_TIER_ORDER } from "./types";
import type { LiteracyTier } from "./types";

/**
 * Pure placement rule, pulled out of the React handler so it can be unit
 * tested (scripts/quality/placement.test.mts runs all 343 score combinations
 * and checks monotonicity).
 *
 * A tier's own questions must show real strength (TARGET_TIER_BAR of 6); every
 * tier below it must also clear a genuine-grounding bar (LOWER_TIER_BAR of 6) —
 * placement requires cumulative evidence, not just performance on the target
 * tier in isolation. Guessing well on a couple of Expert questions with no real
 * grounding below it cannot place someone into Expert. See the psychometric
 * standard-setting literature on placement-test cut scores (e.g. NCPR's
 * postsecondary placement cut-score working paper) for why a narrow,
 * single-tier bar produces exactly that failure mode.
 */
export const TARGET_TIER_BAR = 5; // out of QUESTIONS_PER_TIER
export const LOWER_TIER_BAR = 4; // out of QUESTIONS_PER_TIER
export const QUESTIONS_PER_TIER = 6;

export function placeLearner(correctByTier: Record<LiteracyTier, number>): LiteracyTier {
  let placed: LiteracyTier = "beginner";
  LITERACY_TIER_ORDER.forEach((tier, tierIndex) => {
    const meetsTarget = correctByTier[tier] >= TARGET_TIER_BAR;
    const meetsEveryLowerTier = LITERACY_TIER_ORDER.slice(0, tierIndex).every(
      (lower) => correctByTier[lower] >= LOWER_TIER_BAR
    );
    if (meetsTarget && meetsEveryLowerTier) placed = tier;
  });
  return placed;
}
