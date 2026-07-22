"use client";

import { useCallback, useEffect, useState } from "react";
import { LITERACY_MODULES } from "./skills/curriculum-content";
import { LITERACY_TIER_ORDER } from "./types";
import type { BadgeId, LearnerGoal, LiteracyProgress, LiteracyTier, PlacementResult } from "./types";

const PLACEMENT_KEY = "financial-literacy-placement";
const PROGRESS_KEY = "financial-literacy-progress";
const XP_PER_TIER_COMPLETE = 25;

const EMPTY_PROGRESS: LiteracyProgress = {
  completedModuleIds: [],
  xp: 0,
  streakDays: 0,
  lastActivityDateKey: null,
  answerStreak: 0,
  longestAnswerStreak: 0,
  roundsPlayed: 0,
  bestRoundScore: 0,
  hasPerfectRound: false,
};

function readRaw<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function todayDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function moduleIdsForTier(tier: LiteracyTier): string[] {
  return LITERACY_MODULES.filter((m) => m.tier === tier).map((m) => m.id);
}

/** Every tier strictly before `tier` in LITERACY_TIER_ORDER must be fully completed. */
export function isTierUnlocked(tier: LiteracyTier, completedModuleIds: string[]): boolean {
  const idx = LITERACY_TIER_ORDER.indexOf(tier);
  if (idx <= 0) return true;
  const priorTiers = LITERACY_TIER_ORDER.slice(0, idx);
  return priorTiers.every((t) => moduleIdsForTier(t).every((id) => completedModuleIds.includes(id)));
}

/** Derived from progress state rather than stored separately, so it can never drift out of sync. */
export function deriveBadges(progress: LiteracyProgress): BadgeId[] {
  const badges: BadgeId[] = [];
  if (progress.completedModuleIds.length >= 1) badges.push("first-module");
  if (progress.streakDays >= 5) badges.push("five-day-streak");
  if (progress.hasPerfectRound) badges.push("quiz-perfectionist");
  for (const tier of LITERACY_TIER_ORDER) {
    const allDone = moduleIdsForTier(tier).every((id) => progress.completedModuleIds.includes(id));
    if (allDone) {
      badges.push(
        tier === "beginner" ? "finished-beginner" : tier === "intermediate" ? "finished-intermediate" : "finished-expert"
      );
    }
  }
  return badges;
}

/** The daily-activity-streak + XP + answer-streak bump shared by module completion and Quiz Mode's per-question scoring — the only difference between the two call sites is whether completedModuleIds also changes. */
function bumpForCorrectAnswer(current: LiteracyProgress, xpAwarded: number): LiteracyProgress {
  const today = todayDateKey();
  let streakDays = current.streakDays;
  if (current.lastActivityDateKey === null) {
    streakDays = 1;
  } else if (current.lastActivityDateKey !== today) {
    const prior = new Date(current.lastActivityDateKey + "T00:00:00");
    const now = new Date(today + "T00:00:00");
    const dayGap = Math.round((now.getTime() - prior.getTime()) / (24 * 60 * 60 * 1000));
    streakDays = dayGap === 1 ? current.streakDays + 1 : 1;
  }
  const answerStreak = current.answerStreak + 1;
  const longestAnswerStreak = Math.max(current.longestAnswerStreak, answerStreak);
  return {
    ...current,
    xp: current.xp + xpAwarded,
    streakDays,
    lastActivityDateKey: today,
    answerStreak,
    longestAnswerStreak,
  };
}

export function useLiteracyProgress() {
  const [placement, setPlacement] = useState<PlacementResult | null>(null);
  const [progress, setProgress] = useState<LiteracyProgress>(EMPTY_PROGRESS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPlacement(readRaw<PlacementResult>(PLACEMENT_KEY));
    // Spread over EMPTY_PROGRESS defaults so a progress object saved before
    // answerStreak/longestAnswerStreak existed still hydrates with real 0s
    // instead of undefined.
    const stored = readRaw<Partial<LiteracyProgress>>(PROGRESS_KEY);
    setProgress(stored ? { ...EMPTY_PROGRESS, ...stored } : EMPTY_PROGRESS);
    setHydrated(true);
  }, []);

  const recordPlacement = useCallback((tier: LiteracyTier, goal: LearnerGoal) => {
    const result: PlacementResult = { tier, goal, placedAt: new Date().toISOString() };
    setPlacement(result);
    window.localStorage.setItem(PLACEMENT_KEY, JSON.stringify(result));
  }, []);

  const resetPlacement = useCallback(() => {
    setPlacement(null);
    window.localStorage.removeItem(PLACEMENT_KEY);
  }, []);

  /**
   * No-op if already completed — safe to call repeatedly (e.g. re-viewing a
   * finished module). `xpAwarded` is the Kahoot-style speed-scaled XP
   * computed by the question UI (faster correct answer = more XP), not a
   * flat constant — the ceiling per module is still the same as before.
   */
  const completeModule = useCallback((moduleId: string, xpAwarded: number) => {
    setProgress((current) => {
      if (current.completedModuleIds.includes(moduleId)) return current;

      const mod = LITERACY_MODULES.find((m) => m.id === moduleId);
      const bumped = bumpForCorrectAnswer(current, xpAwarded);
      const completedModuleIds = [...current.completedModuleIds, moduleId];
      let xp = bumped.xp;
      if (mod && moduleIdsForTier(mod.tier).every((id) => completedModuleIds.includes(id))) {
        xp += XP_PER_TIER_COMPLETE;
      }

      const next: LiteracyProgress = { ...bumped, completedModuleIds, xp };
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** A wrong or timed-out answer breaks the Kahoot-style answer streak — doesn't touch XP or completed modules. Shared by the module learn flow and Quiz Mode. */
  const recordWrongAnswer = useCallback(() => {
    setProgress((current) => {
      if (current.answerStreak === 0) return current;
      const next: LiteracyProgress = { ...current, answerStreak: 0 };
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** A correct Quiz Mode answer — same XP/streak/daily-activity bump as completing a module's check, without touching completedModuleIds (a round can revisit already-completed modules' questions for review). */
  const recordQuizAnswer = useCallback((xpAwarded: number) => {
    setProgress((current) => {
      const next = bumpForCorrectAnswer(current, xpAwarded);
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /** Called once at the end of a Quiz Mode round. Per-question XP/streak already posted via recordQuizAnswer/recordWrongAnswer during play — this just records round-level stats. */
  const recordQuizRoundResult = useCallback(
    (result: { correctCount: number; totalCount: number; pointsScored: number }) => {
      setProgress((current) => {
        const next: LiteracyProgress = {
          ...current,
          roundsPlayed: current.roundsPlayed + 1,
          bestRoundScore: Math.max(current.bestRoundScore, result.pointsScored),
          hasPerfectRound: current.hasPerfectRound || (result.totalCount > 0 && result.correctCount === result.totalCount),
        };
        window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  return {
    placement,
    progress,
    hydrated,
    recordPlacement,
    resetPlacement,
    completeModule,
    recordWrongAnswer,
    recordQuizAnswer,
    recordQuizRoundResult,
  };
}
