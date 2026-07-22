"use client";

import { useEffect, useState } from "react";
import { isTierUnlocked, deriveBadges, useLiteracyProgress } from "@/lib/agents/financial-literacy/literacy-storage";
import {
  GOAL_OPTIONS,
  LITERACY_MODULES,
  PLACEMENT_QUESTIONS,
} from "@/lib/agents/financial-literacy/skills/curriculum-content";
import { LITERACY_TIER_ORDER } from "@/lib/agents/financial-literacy/types";
import type { BadgeId, LearnerGoal, LiteracyModule, LiteracyTier } from "@/lib/agents/financial-literacy/types";

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
};

function PlacementFlow({ onComplete }: { onComplete: (tier: LiteracyTier, goal: LearnerGoal) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [goal, setGoal] = useState<LearnerGoal | null>(null);
  const [showValidation, setShowValidation] = useState(false);

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
    for (const tier of LITERACY_TIER_ORDER) {
      if (correctByTier[tier] >= 2) placedTier = tier;
    }
    onComplete(placedTier, goal);
  }

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        Two quick things before your curriculum: 9 questions to find where you're already
        fluent (not a test to pass or fail — just placement), and what you actually want out
        of this. Both can be retaken any time.
      </p>

      <div className="space-y-6 mb-8">
        {PLACEMENT_QUESTIONS.map((q, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="text-sm font-medium mb-3">{q.prompt}</div>
            <div className="space-y-2">
              {q.options.map((opt, oi) => (
                <label key={oi} className="flex items-center gap-2 text-sm cursor-pointer">
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

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 mb-6">
        <div className="text-sm font-medium mb-3">What brings you here?</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GOAL_OPTIONS.map((g) => (
            <label
              key={g.id}
              className={`rounded-lg border p-3 cursor-pointer text-sm ${
                goal === g.id
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <input type="radio" name="goal" className="mr-2" checked={goal === g.id} onChange={() => setGoal(g.id)} />
              <span className="font-medium">{g.label}</span>
              <p className="text-xs text-zinc-500 mt-1 ml-5">{g.description}</p>
            </label>
          ))}
        </div>
      </div>

      {showValidation && (!allAnswered || !goal) && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-4">
          Answer all 9 questions and pick a goal to continue.
        </p>
      )}

      <button
        onClick={submit}
        className="rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-black px-5 py-2 text-sm font-medium"
      >
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

/** Kahoot-style speed scoring: answering instantly earns full XP, answering right at the buzzer earns half. */
function speedScaledXp(secondsRemaining: number): number {
  const fraction = Math.max(0, Math.min(1, secondsRemaining / QUESTION_TIME_SECONDS));
  return Math.round(MAX_XP_PER_MODULE * (MIN_XP_FRACTION + (1 - MIN_XP_FRACTION) * fraction));
}

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
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME_SECONDS);
  const [awardedXp, setAwardedXp] = useState<number | null>(null);

  // A fresh, timed round only runs for a not-yet-completed module while
  // open and not yet answered — an already-completed module just reviews
  // the question statically, no clock, no re-scoring.
  const roundActive = open && !completed && !submitted;
  const revealed = submitted || completed;
  const isCorrect = revealed && !timedOut && selected === mod.check.correctIndex;

  useEffect(() => {
    if (!roundActive) return;
    if (timeLeft <= 0) {
      setSubmitted(true);
      setTimedOut(true);
      onWrongAnswer();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundActive, timeLeft]);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next && !completed) {
        setSelected(null);
        setSubmitted(false);
        setTimedOut(false);
        setAwardedXp(null);
        setTimeLeft(QUESTION_TIME_SECONDS);
      }
      return next;
    });
  }

  function pickAnswer(oi: number) {
    if (!roundActive) return;
    setSelected(oi);
    setSubmitted(true);
    if (oi === mod.check.correctIndex) {
      const xp = speedScaledXp(timeLeft);
      setAwardedXp(xp);
      onComplete(xp);
    } else {
      onWrongAnswer();
    }
  }

  function retry() {
    setSelected(null);
    setSubmitted(false);
    setTimedOut(false);
    setAwardedXp(null);
    setTimeLeft(QUESTION_TIME_SECONDS);
  }

  const timerPct = (timeLeft / QUESTION_TIME_SECONDS) * 100;

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
      <button onClick={toggleOpen} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-medium shrink-0 ${
              completed
                ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
            }`}
          >
            {completed ? "✓" : mod.order}
          </span>
          <span className="text-sm font-medium">{mod.title}</span>
        </div>
        <span className="text-zinc-400 text-xs">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-zinc-100 dark:border-zinc-900 pt-4">
          {mod.body.split("\n\n").map((para, i) => (
            <p key={i} className="text-sm text-zinc-600 dark:text-zinc-400 mb-3">
              {para}
            </p>
          ))}
          {mod.tryIt && (
            <div className="inline-block mb-4 text-xs font-mono text-zinc-500 border border-zinc-200 dark:border-zinc-800 rounded px-2 py-1">
              → Try it: {mod.tryIt.label}
            </div>
          )}

          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="text-sm font-medium">{mod.check.prompt}</div>
              {roundActive && (
                <div className="shrink-0 text-right">
                  <div className={`text-lg font-mono font-bold leading-none ${timeLeft <= 5 ? "text-red-600 dark:text-red-400" : ""}`}>
                    {timeLeft}s
                  </div>
                </div>
              )}
            </div>
            {roundActive && (
              <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                    timeLeft <= 5 ? "bg-red-500" : "bg-zinc-900 dark:bg-zinc-100"
                  }`}
                  style={{ width: `${timerPct}%` }}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
              {mod.check.options.map((opt, oi) => {
                const style = ANSWER_STYLES[oi];
                const isSelected = selected === oi;
                const showCorrect = revealed && oi === mod.check.correctIndex;
                const showWrongSelected = revealed && isSelected && oi !== mod.check.correctIndex;
                const dimmed = revealed && !showCorrect && !showWrongSelected;
                return (
                  <button
                    key={oi}
                    onClick={() => pickAnswer(oi)}
                    disabled={revealed || !open}
                    className={`flex items-center gap-2 rounded-lg px-3 py-3 text-sm font-medium text-white text-left transition-opacity ${style.bg} ${
                      dimmed ? "opacity-40" : ""
                    } ${showCorrect ? "ring-4 ring-zinc-900 dark:ring-white" : ""} disabled:cursor-default`}
                  >
                    <span className="text-base leading-none shrink-0">{style.shape}</span>
                    <span className="flex-1">{opt}</span>
                    {showCorrect && <span className="shrink-0">✓</span>}
                    {showWrongSelected && <span className="shrink-0">✕</span>}
                  </button>
                );
              })}
            </div>

            {submitted && !completed && (
              <div
                className={`text-sm rounded-lg p-3 ${
                  isCorrect
                    ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400"
                    : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                }`}
              >
                <div className="font-medium mb-1">
                  {isCorrect ? `Correct! +${awardedXp} XP` : timedOut ? "Time's up!" : "Not quite — try again"}
                </div>
                {isCorrect ? (
                  <div>{mod.check.explanation}</div>
                ) : (
                  <button
                    onClick={retry}
                    className="mt-1 text-xs font-medium underline underline-offset-2 hover:no-underline"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
            {completed && (
              <div className="text-sm rounded-lg p-3 bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400">
                <div className="font-medium mb-1">Completed</div>
                <div>{mod.check.explanation}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CurriculumView({
  placementTier,
  progress,
  completeModule,
  onWrongAnswer,
  resetPlacement,
}: {
  placementTier: LiteracyTier;
  progress: ReturnType<typeof useLiteracyProgress>["progress"];
  completeModule: (id: string, xpAwarded: number) => void;
  onWrongAnswer: () => void;
  resetPlacement: () => void;
}) {
  const badges = deriveBadges(progress);
  const placedIndex = LITERACY_TIER_ORDER.indexOf(placementTier);

  return (
    <div>
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">XP</div>
            <div className="text-2xl font-semibold">{progress.xp}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Streak</div>
            <div className="text-2xl font-semibold">{progress.streakDays}d</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Answer Streak</div>
            <div className="text-2xl font-semibold">
              {progress.answerStreak}
              {progress.longestAnswerStreak > progress.answerStreak && (
                <span className="text-xs text-zinc-400 font-normal ml-1">best {progress.longestAnswerStreak}</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Modules Done</div>
            <div className="text-2xl font-semibold">
              {progress.completedModuleIds.length}/{LITERACY_MODULES.length}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-500">Placed At</div>
            <div className="text-2xl font-semibold">{TIER_LABEL[placementTier]}</div>
          </div>
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {badges.map((b) => (
              <span
                key={b}
                className="text-xs font-mono border border-zinc-200 dark:border-zinc-800 rounded-full px-3 py-1 text-zinc-600 dark:text-zinc-400"
              >
                {BADGE_LABEL[b]}
              </span>
            ))}
          </div>
        )}
        <button onClick={resetPlacement} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          Retake placement
        </button>
      </div>

      {LITERACY_TIER_ORDER.map((tier, tierIndex) => {
        const unlocked = tierIndex <= placedIndex || isTierUnlocked(tier, progress.completedModuleIds);
        const modules = LITERACY_MODULES.filter((m) => m.tier === tier);
        return (
          <section key={tier} className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold">{TIER_LABEL[tier]}</h2>
              {!unlocked && (
                <span className="text-xs font-mono text-zinc-400 border border-zinc-200 dark:border-zinc-800 rounded-full px-2 py-0.5">
                  locked — finish {TIER_LABEL[LITERACY_TIER_ORDER[tierIndex - 1]]} first
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-500 mb-4">{TIER_PREMISE[tier]}</p>
            {unlocked ? (
              <div className="space-y-2">
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
              <div className="rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-400">
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
  const { placement, progress, hydrated, recordPlacement, resetPlacement, completeModule, recordWrongAnswer } =
    useLiteracyProgress();

  if (!hydrated) return null;

  return (
    <div>
      <p className="text-zinc-500 mb-6">
        A three-tier financial literacy curriculum — every module points at the real tool
        elsewhere in this app that demonstrates the concept. Placement is a starting point,
        not a gate; every tier stays visible, just locked until the one before it is done.
      </p>
      {!placement ? (
        <PlacementFlow onComplete={recordPlacement} />
      ) : (
        <CurriculumView
          placementTier={placement.tier}
          progress={progress}
          completeModule={completeModule}
          onWrongAnswer={recordWrongAnswer}
          resetPlacement={resetPlacement}
        />
      )}
    </div>
  );
}
