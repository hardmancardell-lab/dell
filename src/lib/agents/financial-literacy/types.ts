export type LiteracyTier = "beginner" | "intermediate" | "expert";

export const LITERACY_TIER_ORDER: LiteracyTier[] = ["beginner", "intermediate", "expert"];

export type LearnerGoal =
  | "personal-finance"
  | "evaluate-companies"
  | "build-portfolio"
  | "trade-with-signals";

export interface CheckQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string; // shown after answering, right or wrong
}

/** A pointer to a real, already-built tab in the app — descriptive only, not a deep link (no cross-tab navigation infra exists yet). */
export interface TryItPointer {
  label: string; // e.g. "Security Analysis · Analyze Ticker"
}

export interface LiteracyModule {
  id: string; // e.g. "beginner-01"
  tier: LiteracyTier;
  order: number; // 1-based position within its tier
  title: string;
  body: string; // teaching content, plain text paragraphs separated by \n\n
  tryIt: TryItPointer | null;
  // 3 applied-comprehension questions per module. checks[0] is the in-place
  // learning check shown on the module card; all 3 feed the Quiz Mode
  // question pool (review questions can be pulled from any of the 3, not
  // just the one used in the learn flow).
  checks: CheckQuestion[];
}

/** One of the 9 placement-quiz questions — 3 per tier, concept-recognition style, not vocabulary recall. */
export interface PlacementQuestion {
  tier: LiteracyTier; // which tier this question probes fluency in
  prompt: string;
  options: string[];
  correctIndex: number;
}

export interface GoalOption {
  id: LearnerGoal;
  label: string;
  description: string;
}

export interface PlacementResult {
  tier: LiteracyTier;
  goal: LearnerGoal;
  placedAt: string; // ISO date
  // Per-tier correct-answer counts from the diagnostic, for the "why you
  // placed here" explanation. Optional so results saved before this field
  // existed still hydrate cleanly (no explanation shown until retaken).
  breakdown?: Record<LiteracyTier, number>;
}

export interface LiteracyProgress {
  completedModuleIds: string[];
  xp: number;
  streakDays: number;
  lastActivityDateKey: string | null; // YYYY-MM-DD, Eastern-agnostic (client-local is fine here, not a market-data concern)
  // Kahoot-style consecutive-correct-answer streak across check questions,
  // distinct from streakDays (daily-activity streak) above — broken by any
  // wrong or timed-out answer, not by a day gap. Shared between the
  // per-module learn flow and Quiz Mode rounds — one running streak.
  answerStreak: number;
  longestAnswerStreak: number;
  // Quiz Mode (multi-question timed rounds, pulled from the same checks[]
  // pool as the learn flow) — separate from module-completion progress
  // since a round can revisit already-completed modules' questions.
  roundsPlayed: number;
  bestRoundScore: number;
  hasPerfectRound: boolean;
}

export type BadgeId =
  | "finished-beginner"
  | "finished-intermediate"
  | "finished-expert"
  | "first-module"
  | "five-day-streak"
  | "quiz-perfectionist"
  | "signal-sorter";

export type SignalCardDomain = "investing" | "credit-debt" | "budgeting" | "scams";

/**
 * One card in the Signal Check game (Intermediate tier) — a single, real-
 * world money claim the player sorts into Signal (real, checkable,
 * actionable) or Noise (hype, pressure, or a trap). Deliberately one binary
 * decision per card, never a multi-part question — see SignalCheckLevel for
 * why difficulty ramps through variety/pace/scaffolding instead of through
 * per-card complexity.
 */
export interface SignalCard {
  text: string;
  isSignal: boolean;
  domain: SignalCardDomain;
  explanation: string; // one sentence; shown always at low levels, only on a miss at higher levels
}

/**
 * A round of Signal Check. The four levels ramp in scenario variety (single
 * domain -> all four mixed), phrasing pace (full sentence -> headline/text-
 * snippet), and hand-holding (explanations always shown -> only on a miss) —
 * never in how much has to be held in mind at once for any single card. This
 * is the direct design response to the scarcity/cognitive-bandwidth research
 * in beginner-18 ("The scarcity trap"): financial stress already consumes
 * the bandwidth a harder *individual* decision would need, so the ramp has
 * to come from somewhere else.
 */
export interface SignalCheckLevel {
  id: string; // e.g. "intermediate-game-signal-check-1" — an XP-bearing pseudo-module id, same pattern as the other tier games' *_MODULE_ID constants
  order: number;
  title: string;
  intro: string;
  showExplanationsAlways: boolean;
  xpBase: number;
  cards: SignalCard[];
}
