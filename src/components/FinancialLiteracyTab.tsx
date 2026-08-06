"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import { isTierUnlocked, deriveBadges, useLiteracyProgress } from "@/lib/agents/financial-literacy/literacy-storage";
import { scaffoldedWrongAnswerFeedback, placementExplanation } from "@/lib/agents/financial-literacy/teaching-persona";
import { useTrackEvent } from "@/lib/analytics/use-track";
import {
  GOAL_OPTIONS,
  LITERACY_MODULES,
  PLACEMENT_QUESTIONS,
} from "@/lib/agents/financial-literacy/skills/curriculum-content";
import { LITERACY_TIER_ORDER } from "@/lib/agents/financial-literacy/types";
import type {
  BadgeId,
  CheckQuestion,
  LearnerGoal,
  LiteracyModule,
  LiteracyProgress,
  LiteracyTier,
} from "@/lib/agents/financial-literacy/types";

const TIER_LABEL: Record<LiteracyTier, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  expert: "Expert",
};

const TIER_PREMISE: Record<LiteracyTier, string> = {
  beginner: "Zero assumed knowledge — money, budgeting, debt, first contact with markets.",
  intermediate: "Can read a balance sheet, build a real portfolio, tell signal from noise.",
  expert: "Dealer mechanics, quant rigor, macro-to-position synthesis.",
};

const BADGE_LABEL: Record<BadgeId, string> = {
  "first-module": "First Module",
  "five-day-streak": "5-Day Streak",
  "finished-beginner": "Finished Beginner",
  "finished-intermediate": "Finished Intermediate",
  "finished-expert": "Finished Expert",
  "quiz-perfectionist": "Perfect Round",
};

// A tier's own questions must show real strength (5/6); every tier below it
// must also clear a genuine-grounding bar (4/6) — placement requires
// cumulative evidence, not just performance on the target tier in
// isolation. This is the fix for the false-mastery problem: guessing well
// on a couple of Expert questions with no real grounding below it can no
// longer place someone into Expert. See the psychometric standard-setting
// literature on placement-test cut scores (e.g. NCPR's postsecondary
// placement cut-score working paper) for why a narrow, single-tier bar
// produces exactly this failure mode.
const TARGET_TIER_BAR = 5; // out of 6
const LOWER_TIER_BAR = 4; // out of 6

// Phaser touches window/navigator at module-eval time — ssr:false keeps it
// out of any server-rendered pass of this "use client" file.
const SaveSpendEarnGame = dynamic(
  () => import("@/components/literacy/SaveSpendEarnGame").then((m) => m.SaveSpendEarnGame),
  { ssr: false, loading: () => <div className="text-sm py-6" style={{ color: "var(--text-2)" }}>Loading game…</div> }
);
const SAVE_SPEND_EARN_MODULE_ID = "beginner-game-save-spend-earn";

const DeltaDefenderGame = dynamic(
  () => import("@/components/literacy/DeltaDefenderGame").then((m) => m.DeltaDefenderGame),
  { ssr: false, loading: () => <div className="text-sm py-6" style={{ color: "var(--text-2)" }}>Loading game…</div> }
);
const DELTA_DEFENDER_MODULE_ID = "expert-game-delta-defender";

function PlacementFlow({
  onComplete,
}: {
  onComplete: (tier: LiteracyTier, goal: LearnerGoal, breakdown: Record<LiteracyTier, number>) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [goal, setGoal] = useState<LearnerGoal | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const { track } = useTrackEvent();

  const allAnswered = PLACEMENT_QUESTIONS.every((_, i) => answers[i] !== undefined);

  function submit() {
    if (!allAnswered || !goal) {
      setShowValidation(true);
      return;
    }
    const correctByTier: Record<LiteracyTier, number> = { beginner: 0, intermediate: 0, expert: 0 };
    PLACEMENT_QUESTIONS.forEach((q, i) => {
      if (answers[i] === q.correctIndex) correctByTier[q.tier] += 1;
    });
    let placedTier: LiteracyTier = "beginner";
    LITERACY_TIER_ORDER.forEach((tier, tierIndex) => {
      const meetsTarget = correctByTier[tier] >= TARGET_TIER_BAR;
      const meetsEveryLowerTier = LITERACY_TIER_ORDER.slice(0, tierIndex).every(
        (lower) => correctByTier[lower] >= LOWER_TIER_BAR
      );
      if (meetsTarget && meetsEveryLowerTier) placedTier = tier;
    });
    track("literacy_placement_completed", {
      agent: "literacy",
      tab: "Placement",
      metadata: { tier: placedTier, goal, breakdown: correctByTier },
    });
    onComplete(placedTier, goal, correctByTier);
  }

  return (
    <div>
      <p className="jv-lede">
        Two quick things before your curriculum: {PLACEMENT_QUESTIONS.length} questions to find
        where you're already fluent (not a test to pass or fail — just placement, though placing
        into a tier now requires real grounding in everything below it too, not just a good guess
        on the tier itself), and what you actually want out of this. Both can be retaken any time.
      </p>

      <div className="flex flex-col gap-4 mb-8">
        {PLACEMENT_QUESTIONS.map((q, i) => (
          <div key={i} className="jv-card">
            <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>{q.prompt}</div>
            <div className="flex flex-col gap-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--text-1)" }}>
                  <input
                    type="radio"
                    name={`placement-${i}`}
                    checked={answers[i] === oi}
                    onChange={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                  />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="jv-card mb-6">
        <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>What brings you here?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GOAL_OPTIONS.map((g) => (
            <label
              key={g.id}
              className="rounded-none border p-3 cursor-pointer text-sm"
              style={{
                borderColor: goal === g.id ? "var(--signal)" : "var(--line)",
                background: goal === g.id ? "rgba(79, 232, 208, 0.06)" : "transparent",
              }}
            >
              <input type="radio" name="goal" className="mr-2" checked={goal === g.id} onChange={() => setGoal(g.id)} />
              <span className="font-medium" style={{ color: "var(--text-0)" }}>{g.label}</span>
              <p className="text-xs mt-1 ml-5" style={{ color: "var(--text-2)" }}>{g.description}</p>
            </label>
          ))}
        </div>
      </div>

      {showValidation && (!allAnswered || !goal) && (
        <p className="text-sm mb-4" style={{ color: "var(--danger)" }}>
          Answer all 9 questions and pick a goal to continue.
        </p>
      )}

      <button onClick={submit} className="jv-btn">
        See My Curriculum
      </button>
    </div>
  );
}

// Kahoot's own 4-answer shape/color scheme — options in curriculum-content.ts
// are always exactly 4, so this maps 1:1 with no fallback needed.
const ANSWER_STYLES = [
  { shape: "▲", bg: "bg-red-600" },
  { shape: "◆", bg: "bg-blue-600" },
  { shape: "●", bg: "bg-amber-500" },
  { shape: "■", bg: "bg-green-600" },
];

const QUESTION_TIME_SECONDS = 20;
const MAX_XP_PER_MODULE = 10; // same ceiling as the old flat award — now the fastest-correct-answer case
const MIN_XP_FRACTION = 0.5; // slowest still-correct answer within time keeps at least half

/**
 * Kahoot-style speed scoring — answering instantly earns full XP, answering
 * right at the buzzer earns half. Used ONLY by Quiz Mode (a fast, no-retry
 * review/practice round pulled from already-completed modules, explicitly
 * not a mastery gate). The module learn flow below deliberately does NOT
 * use this anymore — see MIN_THINK_SECONDS.
 */
function speedScaledXp(secondsRemaining: number): number {
  const fraction = Math.max(0, Math.min(1, secondsRemaining / QUESTION_TIME_SECONDS));
  return Math.round(MAX_XP_PER_MODULE * (MIN_XP_FRACTION + (1 - MIN_XP_FRACTION) * fraction));
}

// The module learn flow (unlike Quiz Mode above) is where mastery is
// actually earned and tier progression happens — rewarding fast answers
// here directly encouraged guessing, which is the same false-mastery
// failure mode the placement-exam fix above targets. Per Bloom's
// mastery-learning research (real learning gains come from genuine
// engagement + corrective feedback, not speed), a correct answer here
// requires a real minimum think time, and a wrong answer requires a real
// cooldown before retrying — no upper time limit, no reward for speed.
const MIN_THINK_SECONDS = 60;
const WRONG_ANSWER_LOCKOUT_SECONDS = 120;
const XP_PER_CORRECT_ANSWER = 10; // flat — speed is no longer measured or rewarded

function ModuleCard({
  mod,
  completed,
  onComplete,
  onWrongAnswer,
}: {
  mod: LiteracyModule;
  completed: boolean;
  onComplete: (xpAwarded: number) => void;
  onWrongAnswer: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalXpEarned, setTotalXpEarned] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [thinkSecondsElapsed, setThinkSecondsElapsed] = useState(0);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
  const { track } = useTrackEvent();

  // A fresh round only runs for a not-yet-completed module while open and
  // not yet answered — an already-completed module reviews every question
  // in the set statically instead of just the first one.
  const roundActive = open && !completed && !submitted;
  const revealed = submitted || completed;
  const question = mod.checks[questionIndex];
  const isLastQuestion = questionIndex === mod.checks.length - 1;
  const isCorrect = revealed && selected === question.correctIndex;
  const canAnswer = roundActive && thinkSecondsElapsed >= MIN_THINK_SECONDS && lockoutSecondsLeft <= 0;

  // Think-gate: counts up to MIN_THINK_SECONDS while the question is live
  // and not in a wrong-answer lockout.
  useEffect(() => {
    if (!roundActive || lockoutSecondsLeft > 0 || thinkSecondsElapsed >= MIN_THINK_SECONDS) return;
    const timer = setTimeout(() => setThinkSecondsElapsed((s) => s + 1), 1000);
    return () => clearTimeout(timer);
  }, [roundActive, lockoutSecondsLeft, thinkSecondsElapsed]);

  // Wrong-answer lockout: counts down independently of the think-gate.
  useEffect(() => {
    if (lockoutSecondsLeft <= 0) return;
    const timer = setTimeout(() => setLockoutSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [lockoutSecondsLeft]);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next && !completed) {
        setQuestionIndex(0);
        setTotalXpEarned(0);
        setSelected(null);
        setSubmitted(false);
        setThinkSecondsElapsed(0);
        setLockoutSecondsLeft(0);
      }
      if (next) {
        track("literacy_module_opened", { agent: "literacy", tab: "Learn", metadata: { moduleId: mod.id, tier: mod.tier, alreadyCompleted: completed } });
      }
      return next;
    });
  }

  function pickAnswer(oi: number) {
    if (!canAnswer) return;
    setSelected(oi);
    setSubmitted(true);
    if (oi === question.correctIndex) {
      track("literacy_answer", { agent: "literacy", tab: "Learn", metadata: { mode: "module-check", moduleId: mod.id, tier: mod.tier, questionIndex, correct: true, xpAwarded: XP_PER_CORRECT_ANSWER } });
      if (isLastQuestion) {
        onComplete(totalXpEarned + XP_PER_CORRECT_ANSWER);
      }
    } else {
      track("literacy_answer", { agent: "literacy", tab: "Learn", metadata: { mode: "module-check", moduleId: mod.id, tier: mod.tier, questionIndex, correct: false } });
      setLockoutSecondsLeft(WRONG_ANSWER_LOCKOUT_SECONDS);
      onWrongAnswer();
    }
  }

  function nextQuestion() {
    setTotalXpEarned((t) => t + XP_PER_CORRECT_ANSWER);
    setQuestionIndex((i) => i + 1);
    setSelected(null);
    setSubmitted(false);
    setThinkSecondsElapsed(0);
    setLockoutSecondsLeft(0);
  }

  function retry() {
    if (lockoutSecondsLeft > 0) return;
    setSelected(null);
    setSubmitted(false);
    setThinkSecondsElapsed(0); // a genuine retry requires thinking again, not just re-clicking
  }

  const thinkPct = (Math.min(thinkSecondsElapsed, MIN_THINK_SECONDS) / MIN_THINK_SECONDS) * 100;
  const lockoutPct = (lockoutSecondsLeft / WRONG_ANSWER_LOCKOUT_SECONDS) * 100;

  return (
    <div style={{ border: "1px solid var(--line)", overflow: "hidden" }}>
      <button onClick={toggleOpen} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-medium shrink-0"
            style={
              completed
                ? { background: "rgba(79, 232, 208, 0.12)", color: "var(--signal)" }
                : { background: "var(--ink-800)", color: "var(--text-2)" }
            }
          >
            {completed ? "✓" : mod.order}
          </span>
          <span className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{mod.title}</span>
        </div>
        <span className="text-xs" style={{ color: "var(--text-2)" }}>{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-4" style={{ borderTop: "1px solid var(--line)" }}>
          {mod.body.split("\n\n").map((para, i) => (
            <p key={i} className="text-sm mb-3" style={{ color: "var(--text-1)" }}>
              {para}
            </p>
          ))}
          {mod.tryIt && (
            <div className="inline-block mb-4 text-xs font-mono rounded px-2 py-1" style={{ color: "var(--text-2)", border: "1px solid var(--line)" }}>
              → Try it: {mod.tryIt.label}
            </div>
          )}

          {completed ? (
            <div className="flex flex-col gap-3">
              {mod.checks.map((q, qi) => (
                <div key={qi} className="p-4" style={{ background: "var(--ink-800)" }}>
                  {mod.checks.length > 1 && (
                    <div className="text-xs mb-1" style={{ color: "var(--text-2)" }}>Question {qi + 1} of {mod.checks.length}</div>
                  )}
                  <div className="text-sm font-medium mb-3" style={{ color: "var(--text-0)" }}>{q.prompt}</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                    {q.options.map((opt, oi) => {
                      const style = ANSWER_STYLES[oi];
                      const showCorrect = oi === q.correctIndex;
                      return (
                        <div
                          key={oi}
                          className={`flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-white ${style.bg} ${
                            showCorrect ? "ring-4" : "opacity-40"
                          }`}
                          style={showCorrect ? ({ "--tw-ring-color": "var(--signal)" } as CSSProperties) : undefined}
                        >
                          <span className="text-base leading-none shrink-0">{style.shape}</span>
                          <span className="flex-1">{opt}</span>
                          {showCorrect && <span className="shrink-0">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-sm rounded-lg p-3" style={{ background: "rgba(79, 232, 208, 0.1)", color: "var(--signal)" }}>
                    <div className="font-medium mb-1">Completed</div>
                    <div>{q.explanation}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4" style={{ background: "var(--ink-800)" }}>
              {mod.checks.length > 1 && (
                <div className="text-xs mb-1" style={{ color: "var(--text-2)" }}>Question {questionIndex + 1} of {mod.checks.length}</div>
              )}
              <div className="mb-3">
                <div className="text-sm font-medium mb-2" style={{ color: "var(--text-0)" }}>{question.prompt}</div>
                {roundActive && lockoutSecondsLeft > 0 && (
                  <div className="text-xs mb-1" style={{ color: "var(--verdict)" }}>
                    Take a beat — {lockoutSecondsLeft}s before you can try again
                  </div>
                )}
                {roundActive && lockoutSecondsLeft <= 0 && thinkSecondsElapsed < MIN_THINK_SECONDS && (
                  <div className="text-xs mb-1" style={{ color: "var(--text-2)" }}>
                    Think it through — {MIN_THINK_SECONDS - thinkSecondsElapsed}s before you can answer
                  </div>
                )}
                {roundActive && (
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "var(--ink-700)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-linear"
                      style={{ width: `${lockoutSecondsLeft > 0 ? lockoutPct : thinkPct}%`, background: lockoutSecondsLeft > 0 ? "var(--verdict)" : "var(--signal)" }}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                {question.options.map((opt, oi) => {
                  const style = ANSWER_STYLES[oi];
                  const isSelected = selected === oi;
                  const showCorrect = revealed && oi === question.correctIndex;
                  const showWrongSelected = revealed && isSelected && oi !== question.correctIndex;
                  const dimmed = revealed && !showCorrect && !showWrongSelected;
                  return (
                    <button
                      key={oi}
                      onClick={() => pickAnswer(oi)}
                      disabled={revealed || !open || !canAnswer}
                      className={`flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-white text-left transition-opacity ${style.bg} ${
                        dimmed ? "opacity-40" : ""
                      } ${showCorrect ? "ring-4" : ""} disabled:cursor-default ${
                        roundActive && !canAnswer ? "opacity-50" : ""
                      }`}
                      style={showCorrect ? ({ "--tw-ring-color": "var(--signal)" } as CSSProperties) : undefined}
                    >
                      <span className="text-base leading-none shrink-0">{style.shape}</span>
                      <span className="flex-1">{opt}</span>
                      {showCorrect && <span className="shrink-0">✓</span>}
                      {showWrongSelected && <span className="shrink-0">✕</span>}
                    </button>
                  );
                })}
              </div>

              {submitted && (
                <div
                  className="text-sm rounded-lg p-3"
                  style={
                    isCorrect
                      ? { background: "rgba(79, 232, 208, 0.1)", color: "var(--signal)" }
                      : { background: "rgba(240, 168, 104, 0.1)", color: "var(--verdict)" }
                  }
                >
                  <div className="font-medium mb-1">{isCorrect ? `Correct! +${XP_PER_CORRECT_ANSWER} XP` : "Not quite"}</div>
                  {isCorrect ? (
                    <>
                      <div>{question.explanation}</div>
                      {!isLastQuestion && (
                        <button
                          onClick={nextQuestion}
                          className="mt-2 text-xs font-medium underline underline-offset-2 hover:no-underline"
                        >
                          Next question →
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div>{scaffoldedWrongAnswerFeedback(mod.tier)}</div>
                      {lockoutSecondsLeft > 0 ? (
                        <div className="mt-1 text-xs" style={{ color: "var(--verdict)" }}>
                          Try again in {lockoutSecondsLeft}s
                        </div>
                      ) : (
                        <button
                          onClick={retry}
                          className="mt-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
                        >
                          Try again
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface QuizPoolItem {
  moduleId: string;
  moduleTitle: string;
  question: CheckQuestion;
}

const QUIZ_ROUND_LENGTH = 10;
const QUIZ_SCOPE_LABEL: Record<LiteracyTier | "all", string> = {
  beginner: "Beginner only",
  intermediate: "Intermediate only",
  expert: "Expert only",
  all: "All unlocked tiers",
};

function buildQuizPool(scope: LiteracyTier | "all", unlockedTiers: LiteracyTier[]): QuizPoolItem[] {
  const modules = LITERACY_MODULES.filter((m) => (scope === "all" ? unlockedTiers.includes(m.tier) : m.tier === scope));
  const pool: QuizPoolItem[] = [];
  modules.forEach((m) => m.checks.forEach((q) => pool.push({ moduleId: m.id, moduleTitle: m.title, question: q })));
  return pool;
}

/** Fisher-Yates shuffle, then take the first n — used to pull a fresh, order-randomized round each time. */
function shuffledSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

type QuizStage = "setup" | "playing" | "results";

function QuizMode({
  unlockedTiers,
  progress,
  recordQuizAnswer,
  recordWrongAnswer,
  recordQuizRoundResult,
}: {
  unlockedTiers: LiteracyTier[];
  progress: LiteracyProgress;
  recordQuizAnswer: (xpAwarded: number) => void;
  recordWrongAnswer: () => void;
  recordQuizRoundResult: (result: { correctCount: number; totalCount: number; pointsScored: number }) => void;
}) {
  const [stage, setStage] = useState<QuizStage>("setup");
  const [scope, setScope] = useState<LiteracyTier | "all">("all");
  const [questions, setQuestions] = useState<QuizPoolItem[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_SECONDS);
  const [roundScore, setRoundScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [roundStreak, setRoundStreak] = useState(0);
  const [bestRoundStreak, setBestRoundStreak] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const { track } = useTrackEvent();

  const availableScopes: (LiteracyTier | "all")[] = ["all", ...unlockedTiers];
  const poolPreview = buildQuizPool(scope, unlockedTiers);

  function startRound() {
    const picked = shuffledSample(poolPreview, QUIZ_ROUND_LENGTH);
    setQuestions(picked);
    setQIndex(0);
    setSelected(null);
    setSubmitted(false);
    setTimedOut(false);
    setTimeLeft(QUESTION_TIME_SECONDS);
    setRoundScore(0);
    setCorrectCount(0);
    setRoundStreak(0);
    setBestRoundStreak(0);
    setIsNewBest(false);
    setStage("playing");
  }

  const current = questions[qIndex];
  const roundActive = stage === "playing" && !submitted;
  const revealed = submitted;

  useEffect(() => {
    if (!roundActive) return;
    if (timeLeft <= 0) {
      setSubmitted(true);
      setTimedOut(true);
      setRoundStreak(0);
      if (current) {
        track("literacy_answer", { agent: "literacy", tab: "Quiz Mode", metadata: { mode: "quiz", moduleId: current.moduleId, correct: false, timedOut: true } });
      }
      recordWrongAnswer();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundActive, timeLeft]);

  function pickAnswer(oi: number) {
    if (!roundActive || !current) return;
    setSelected(oi);
    setSubmitted(true);
    if (oi === current.question.correctIndex) {
      const pts = speedScaledXp(timeLeft);
      setRoundScore((s) => s + pts);
      setCorrectCount((c) => c + 1);
      setRoundStreak((s) => {
        const next = s + 1;
        setBestRoundStreak((b) => Math.max(b, next));
        return next;
      });
      track("literacy_answer", { agent: "literacy", tab: "Quiz Mode", metadata: { mode: "quiz", moduleId: current.moduleId, correct: true, timedOut: false, xpAwarded: pts } });
      recordQuizAnswer(pts);
    } else {
      setRoundStreak(0);
      track("literacy_answer", { agent: "literacy", tab: "Quiz Mode", metadata: { mode: "quiz", moduleId: current.moduleId, correct: false, timedOut: false } });
      recordWrongAnswer();
    }
  }

  function nextQuestion() {
    if (qIndex + 1 >= questions.length) {
      const finalCorrect = correctCount;
      const finalScore = roundScore;
      setIsNewBest(finalScore > progress.bestRoundScore);
      track("literacy_quiz_round_completed", { agent: "literacy", tab: "Quiz Mode", metadata: { scope, correctCount: finalCorrect, totalCount: questions.length, pointsScored: finalScore } });
      recordQuizRoundResult({ correctCount: finalCorrect, totalCount: questions.length, pointsScored: finalScore });
      setStage("results");
      return;
    }
    setQIndex((i) => i + 1);
    setSelected(null);
    setSubmitted(false);
    setTimedOut(false);
    setTimeLeft(QUESTION_TIME_SECONDS);
  }

  const timerPct = (timeLeft / QUESTION_TIME_SECONDS) * 100;

  if (stage === "setup") {
    return (
      <div className="jv-card">
        <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>Quiz Mode</h3>
        <p className="text-sm mb-4" style={{ color: "var(--text-1)" }}>
          A timed {QUIZ_ROUND_LENGTH}-question round pulled from every check question in scope —
          including modules you've already finished, since this is review/practice, not a gate.
          Same speed-scored points as the learn flow; no retries mid-round.
        </p>
        <div className="mb-4">
          <div className="jv-label" style={{ marginBottom: 8 }}>Question scope</div>
          <div className="flex flex-wrap gap-2">
            {availableScopes.map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={scope === s ? "jv-btn" : "jv-btn-outline"}
                style={{ borderRadius: 9999, padding: "6px 14px" }}
              >
                {QUIZ_SCOPE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
          <div>
            <div className="jv-label">Questions Available</div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>{poolPreview.length}</div>
          </div>
          <div>
            <div className="jv-label">Rounds Played</div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>{progress.roundsPlayed}</div>
          </div>
          <div>
            <div className="jv-label">Best Round Score</div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>{progress.bestRoundScore}</div>
          </div>
        </div>
        <button onClick={startRound} disabled={poolPreview.length === 0} className="jv-btn">
          Start Round
        </button>
      </div>
    );
  }

  if (stage === "results") {
    const total = questions.length;
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <div className="jv-card">
        <h3 className="text-lg font-semibold mb-1" style={{ color: "var(--text-0)" }}>Round Complete</h3>
        {isNewBest && (
          <div className="jv-badge c-signal" style={{ borderRadius: 9999, marginBottom: 12 }}>
            New personal best!
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
          <div>
            <div className="jv-label">Score</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{roundScore}</div>
          </div>
          <div>
            <div className="jv-label">Correct</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>
              {correctCount}/{total}
            </div>
          </div>
          <div>
            <div className="jv-label">Accuracy</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{accuracy}%</div>
          </div>
          <div>
            <div className="jv-label">Best Streak</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{bestRoundStreak}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <button onClick={startRound} className="jv-btn">
            Play Again
          </button>
          <button onClick={() => setStage("setup")} className="jv-btn-outline">
            Change Scope
          </button>
        </div>
      </div>
    );
  }

  // stage === "playing"
  if (!current) return null;
  const isCorrect = revealed && !timedOut && selected === current.question.correctIndex;

  return (
    <div className="jv-card">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
          Question {qIndex + 1} of {questions.length}
        </div>
        <div className="flex items-center gap-4 text-sm" style={{ color: "var(--text-1)" }}>
          <span>
            Score <span className="font-mono font-semibold" style={{ color: "var(--text-0)" }}>{roundScore}</span>
          </span>
          <span>
            Streak <span className="font-mono font-semibold" style={{ color: "var(--text-0)" }}>{roundStreak}</span>
          </span>
        </div>
      </div>

      <div className="text-xs font-mono mb-2" style={{ color: "var(--text-2)" }}>{current.moduleTitle}</div>

      <div className="p-4" style={{ background: "var(--ink-800)" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{current.question.prompt}</div>
          {roundActive && (
            <div className="shrink-0 text-right">
              <div className="text-lg font-mono font-bold leading-none" style={{ color: timeLeft <= 5 ? "var(--danger)" : "var(--text-0)" }}>
                {timeLeft}s
              </div>
            </div>
          )}
        </div>
        {roundActive && (
          <div className="h-1.5 w-full rounded-full overflow-hidden mb-3" style={{ background: "var(--ink-700)" }}>
            <div
              className="h-full rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${timerPct}%`, background: timeLeft <= 5 ? "var(--danger)" : "var(--signal)" }}
            />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {current.question.options.map((opt, oi) => {
            const style = ANSWER_STYLES[oi];
            const isSelected = selected === oi;
            const showCorrect = revealed && oi === current.question.correctIndex;
            const showWrongSelected = revealed && isSelected && oi !== current.question.correctIndex;
            const dimmed = revealed && !showCorrect && !showWrongSelected;
            return (
              <button
                key={oi}
                onClick={() => pickAnswer(oi)}
                disabled={revealed}
                className={`flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-white text-left transition-opacity ${style.bg} ${
                  dimmed ? "opacity-40" : ""
                } ${showCorrect ? "ring-4" : ""} disabled:cursor-default`}
                style={showCorrect ? ({ "--tw-ring-color": "var(--signal)" } as CSSProperties) : undefined}
              >
                <span className="text-base leading-none shrink-0">{style.shape}</span>
                <span className="flex-1">{opt}</span>
                {showCorrect && <span className="shrink-0">✓</span>}
                {showWrongSelected && <span className="shrink-0">✕</span>}
              </button>
            );
          })}
        </div>

        {submitted && (
          <div
            className="text-sm rounded-lg p-3 mb-3"
            style={
              isCorrect
                ? { background: "rgba(79, 232, 208, 0.1)", color: "var(--signal)" }
                : { background: "rgba(240, 168, 104, 0.1)", color: "var(--verdict)" }
            }
          >
            <div className="font-medium mb-1">
              {isCorrect ? "Correct!" : timedOut ? "Time's up!" : "Not quite"}
            </div>
            <div>{current.question.explanation}</div>
          </div>
        )}

        {submitted && (
          <button onClick={nextQuestion} className="jv-btn">
            {qIndex + 1 >= questions.length ? "See Results" : "Next Question"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Tiers currently visible/playable — same rule CurriculumView applies per-tier, computed once for Quiz Mode's scope picker. */
function unlockedTiersFor(placementTier: LiteracyTier, completedModuleIds: string[]): LiteracyTier[] {
  const placedIndex = LITERACY_TIER_ORDER.indexOf(placementTier);
  return LITERACY_TIER_ORDER.filter(
    (tier, tierIndex) => tierIndex <= placedIndex || isTierUnlocked(tier, completedModuleIds)
  );
}

function CurriculumView({
  placementTier,
  placementBreakdown,
  progress,
  completeModule,
  onWrongAnswer,
  resetPlacement,
}: {
  placementTier: LiteracyTier;
  placementBreakdown?: Record<LiteracyTier, number>;
  progress: ReturnType<typeof useLiteracyProgress>["progress"];
  completeModule: (id: string, xpAwarded: number) => void;
  onWrongAnswer: () => void;
  resetPlacement: () => void;
}) {
  const badges = deriveBadges(progress);
  const placedIndex = LITERACY_TIER_ORDER.indexOf(placementTier);

  return (
    <div>
      <div className="jv-card mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
          <div>
            <div className="jv-label">XP</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{progress.xp}</div>
          </div>
          <div>
            <div className="jv-label">Streak</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{progress.streakDays}d</div>
          </div>
          <div>
            <div className="jv-label">Answer Streak</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>
              {progress.answerStreak}
              {progress.longestAnswerStreak > progress.answerStreak && (
                <span className="text-xs font-normal ml-1" style={{ color: "var(--text-2)" }}>best {progress.longestAnswerStreak}</span>
              )}
            </div>
          </div>
          <div>
            <div className="jv-label">Modules Done</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>
              {progress.completedModuleIds.length}/{LITERACY_MODULES.length}
            </div>
          </div>
          <div>
            <div className="jv-label">Placed At</div>
            <div className="text-2xl font-semibold" style={{ color: "var(--text-0)" }}>{TIER_LABEL[placementTier]}</div>
          </div>
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {badges.map((b) => (
              <span key={b} className="jv-badge c-neutral" style={{ borderRadius: 9999 }}>
                {BADGE_LABEL[b]}
              </span>
            ))}
          </div>
        )}
        {placementBreakdown && (
          <p className="text-xs mb-3 max-w-2xl" style={{ color: "var(--text-2)" }}>
            <span className="font-medium" style={{ color: "var(--text-1)" }}>Why here? </span>
            {placementExplanation(placementBreakdown, 6, placementTier)}
          </p>
        )}
        <button onClick={resetPlacement} className="text-xs" style={{ color: "var(--text-2)" }}>
          Retake placement
        </button>
      </div>

      {LITERACY_TIER_ORDER.map((tier, tierIndex) => {
        const unlocked = tierIndex <= placedIndex || isTierUnlocked(tier, progress.completedModuleIds);
        const modules = LITERACY_MODULES.filter((m) => m.tier === tier);
        return (
          <section key={tier} className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold" style={{ color: "var(--text-0)" }}>{TIER_LABEL[tier]}</h2>
              {!unlocked && (
                <span className="jv-badge c-neutral" style={{ borderRadius: 9999 }}>
                  locked — finish {TIER_LABEL[LITERACY_TIER_ORDER[tierIndex - 1]]} first
                </span>
              )}
            </div>
            <p className="text-sm mb-4" style={{ color: "var(--text-1)" }}>{TIER_PREMISE[tier]}</p>
            {unlocked ? (
              <div className="flex flex-col gap-2">
                {tier === "beginner" && (
                  <div className="jv-card mb-2">
                    <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                      Piggy Bank Quest {progress.completedModuleIds.includes(SAVE_SPEND_EARN_MODULE_ID) && (
                        <span className="text-xs font-mono ml-2" style={{ color: "var(--text-2)" }}>completed</span>
                      )}
                    </div>
                    <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                      A save/spend/earn simulation, not another quiz — make 6 weekly choices and see whether they add up to the goal.
                    </p>
                    <SaveSpendEarnGame
                      onComplete={(xp) => completeModule(SAVE_SPEND_EARN_MODULE_ID, xp)}
                    />
                  </div>
                )}
                {tier === "expert" && (
                  <div className="jv-card mb-2">
                    <div className="text-sm font-medium mb-1" style={{ color: "var(--text-0)" }}>
                      Market Vector: Delta Defender {progress.completedModuleIds.includes(DELTA_DEFENDER_MODULE_ID) && (
                        <span className="text-xs font-mono ml-2" style={{ color: "var(--text-2)" }}>completed</span>
                      )}
                    </div>
                    <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>
                      A real-data arcade defense — targets are real live SPY option contracts (strike, delta, IV, bid), and each shot spends real paper-trading capital priced at the contract&apos;s own bid.
                    </p>
                    <DeltaDefenderGame
                      onComplete={(xp) => completeModule(DELTA_DEFENDER_MODULE_ID, xp)}
                    />
                  </div>
                )}
                {modules.map((m) => (
                  <ModuleCard
                    key={m.id}
                    mod={m}
                    completed={progress.completedModuleIds.includes(m.id)}
                    onComplete={(xp) => completeModule(m.id, xp)}
                    onWrongAnswer={onWrongAnswer}
                  />
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm" style={{ border: "1px dashed var(--line)", color: "var(--text-2)" }}>
                {modules.length} module(s) — unlocks once the prior tier is complete.
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function FinancialLiteracyTab() {
  const {
    placement,
    progress,
    hydrated,
    recordPlacement,
    resetPlacement,
    completeModule,
    recordWrongAnswer,
    recordQuizAnswer,
    recordQuizRoundResult,
  } = useLiteracyProgress();
  const [view, setView] = useState<"learn" | "quiz">("learn");

  if (!hydrated) return null;

  return (
    <div className="jarvis">
      <p className="jv-lede">
        A three-tier financial literacy curriculum — every module points at the real tool
        elsewhere in this app that demonstrates the concept. Placement is a starting point,
        not a gate; every tier stays visible, just locked until the one before it is done.
      </p>
      {!placement ? (
        <PlacementFlow onComplete={recordPlacement} />
      ) : (
        <>
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setView("learn")}
              className={view === "learn" ? "jv-btn" : "jv-btn-outline"}
            >
              Learn
            </button>
            <button
              onClick={() => setView("quiz")}
              className={view === "quiz" ? "jv-btn" : "jv-btn-outline"}
            >
              Quiz Mode
            </button>
          </div>
          {view === "learn" ? (
            <CurriculumView
              placementTier={placement.tier}
              placementBreakdown={placement.breakdown}
              progress={progress}
              completeModule={completeModule}
              onWrongAnswer={recordWrongAnswer}
              resetPlacement={resetPlacement}
            />
          ) : (
            <QuizMode
              unlockedTiers={unlockedTiersFor(placement.tier, progress.completedModuleIds)}
              progress={progress}
              recordQuizAnswer={recordQuizAnswer}
              recordWrongAnswer={recordWrongAnswer}
              recordQuizRoundResult={recordQuizRoundResult}
            />
          )}
        </>
      )}
    </div>
  );
}
