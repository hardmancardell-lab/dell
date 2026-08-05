import type { LiteracyTier } from "./types";

/**
 * "Finance professor specializing in the art of teaching" voice, applied to
 * wrong-answer feedback and the post-placement explanation. Grounded in
 * Bloom's mastery-learning research — corrective feedback plus a genuine
 * retry (not just being told "wrong") is what drives real learning gains,
 * per Bloom's 1984 "2 sigma problem" findings on tutored mastery learning
 * (https://en.wikipedia.org/wiki/Bloom's_2_sigma_problem). Static content,
 * same pattern as currency-drivers.ts/options-strategies.ts elsewhere in
 * this app — not a live model.
 */

const WRONG_ANSWER_FEEDBACK: Record<LiteracyTier, string> = {
  beginner:
    "Not yet — that's what the module above is for. Go back through it once with this question in mind, then come back and try again.",
  intermediate:
    "Not quite. Before you retry, ask yourself which specific assumption in the answer you picked doesn't actually hold — that's usually where the real understanding is hiding.",
  expert:
    "Off track. At this level the trap is almost always a plausible-sounding answer that skips a step. Re-trace the module's reasoning from the start, not just its conclusion, then try again.",
};

export function scaffoldedWrongAnswerFeedback(tier: LiteracyTier): string {
  return WRONG_ANSWER_FEEDBACK[tier];
}

/**
 * A short "why you placed here" explanation shown after the diagnostic,
 * built from the real per-tier breakdown (not a canned line) — the point is
 * to make the cumulative-mastery placement rule legible, not mysterious.
 */
export function placementExplanation(
  breakdown: Record<LiteracyTier, number>,
  questionsPerTier: number,
  placedTier: LiteracyTier
): string {
  const tierLine = (tier: LiteracyTier, label: string) =>
    `${label} ${breakdown[tier]}/${questionsPerTier}`;
  const summary = `${tierLine("beginner", "Beginner")} · ${tierLine("intermediate", "Intermediate")} · ${tierLine("expert", "Expert")}`;

  if (placedTier === "expert") {
    return `${summary}. You showed real fluency across every tier, not just the hardest questions — that's what earns Expert placement here, not a lucky guess or two on the advanced material.`;
  }
  if (placedTier === "intermediate") {
    return `${summary}. Placement requires solid grounding in a tier and everything below it, not just the tier itself — right now that's Intermediate. Work through Expert's modules and you'll have another shot at placing there for real, rather than skipping straight to it.`;
  }
  return `${summary}. Everyone starts building from a real foundation — Beginner isn't a penalty, it's where the modules actually connect to what you already answered here. Placement only moves up once the fluency is real, at every tier along the way.`;
}
