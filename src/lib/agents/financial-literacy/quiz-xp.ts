/**
 * Quiz Mode XP rules (pure, unit tested in scripts/quality/literacy.test.mts).
 *
 * Quiz Mode pulls from every unlocked check question, including finished
 * modules, so an uncapped "10 XP per correct answer" could be farmed forever
 * (and with a guessable answer key it was). Two limits:
 *   - each question pays XP at most once, ever (its key is remembered);
 *   - at most QUIZ_XP_DAILY_CAP XP can come from Quiz Mode per local day.
 * Round points on the results screen are separate and unaffected.
 */
export const QUIZ_XP_DAILY_CAP = 100;

export interface QuizXpState {
  quizXpDate: string | null; // local YYYY-MM-DD the counter below belongs to
  quizXpToday: number;
  quizXpQuestionKeys: string[];
}

export const EMPTY_QUIZ_XP: QuizXpState = { quizXpDate: null, quizXpToday: 0, quizXpQuestionKeys: [] };

/** Local (not UTC) calendar day, so an evening answer in the US does not count as tomorrow. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function quizQuestionKey(moduleId: string, checkIndex: number): string {
  return `${moduleId}#${checkIndex}`;
}

export function applyQuizXp(
  state: QuizXpState,
  questionKey: string,
  requestedXp: number,
  today: string
): { awarded: number; next: QuizXpState } {
  const sameDay = state.quizXpDate === today;
  const usedToday = sameDay ? state.quizXpToday : 0;
  const seen = state.quizXpQuestionKeys.includes(questionKey);
  const room = Math.max(0, QUIZ_XP_DAILY_CAP - usedToday);
  const awarded = seen ? 0 : Math.max(0, Math.min(Math.round(requestedXp), room));
  return {
    awarded,
    next: {
      quizXpDate: today,
      quizXpToday: usedToday + awarded,
      // A question is only "spent" when it actually paid out, so a capped-out day does not burn it.
      quizXpQuestionKeys: awarded > 0 ? [...state.quizXpQuestionKeys, questionKey] : state.quizXpQuestionKeys,
    },
  };
}
