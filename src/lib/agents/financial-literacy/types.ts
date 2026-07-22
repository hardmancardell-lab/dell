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
  check: CheckQuestion;
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
}

export interface LiteracyProgress {
  completedModuleIds: string[];
  xp: number;
  streakDays: number;
  lastActivityDateKey: string | null; // YYYY-MM-DD, Eastern-agnostic (client-local is fine here, not a market-data concern)
  // Kahoot-style consecutive-correct-answer streak across check questions,
  // distinct from streakDays (daily-activity streak) above — broken by any
  // wrong or timed-out answer, not by a day gap.
  answerStreak: number;
  longestAnswerStreak: number;
}

export type BadgeId =
  | "finished-beginner"
  | "finished-intermediate"
  | "finished-expert"
  | "first-module"
  | "five-day-streak";
