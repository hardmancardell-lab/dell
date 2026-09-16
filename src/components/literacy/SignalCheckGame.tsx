"use client";

import { useState } from "react";
import { SIGNAL_CHECK_LEVELS } from "@/lib/agents/financial-literacy/skills/signal-check-content";
import type { SignalCard, SignalCheckLevel } from "@/lib/agents/financial-literacy/types";

// Intermediate-tier game — see SignalCheckLevel (types.ts) for the full
// design rationale. Deliberately plain DOM (no canvas/Phaser): the decision
// is always "tap one of two buttons," so a lighter, keyboard- and
// screen-reader-friendly implementation is a real accessibility win here,
// not just a smaller bundle. There is intentionally no timer anywhere in
// this component — see signal-check-content.ts's file comment.

const XP_FLOOR_FRACTION = 0.5; // same "never a zero-reward attempt" idea as MIN_XP_FRACTION in FinancialLiteracyTab.tsx, applied to accuracy instead of speed

function xpForRound(xpBase: number, correctCount: number, totalCount: number): number {
  const accuracy = totalCount > 0 ? correctCount / totalCount : 0;
  return Math.round(xpBase * (XP_FLOOR_FRACTION + (1 - XP_FLOOR_FRACTION) * accuracy));
}

type Stage = "menu" | "playing" | "result";

interface RoundState {
  level: SignalCheckLevel;
  cardIndex: number;
  correctCount: number;
  misses: { card: SignalCard; picked: boolean }[];
  selected: boolean | null; // the player's Signal(true)/Noise(false) pick for the current card
  revealed: boolean;
}

export function SignalCheckGame({
  completedLevelIds,
  onLevelComplete,
}: {
  completedLevelIds: string[];
  onLevelComplete: (levelId: string, xpAwarded: number) => void;
}) {
  const [stage, setStage] = useState<Stage>("menu");
  const [round, setRound] = useState<RoundState | null>(null);
  const [lastResult, setLastResult] = useState<{
    level: SignalCheckLevel;
    correctCount: number;
    xpAwarded: number;
    misses: { card: SignalCard; picked: boolean }[];
  } | null>(null);

  const nextSuggestedId =
    SIGNAL_CHECK_LEVELS.find((lvl) => !completedLevelIds.includes(lvl.id))?.id ?? SIGNAL_CHECK_LEVELS[0].id;

  function startLevel(level: SignalCheckLevel) {
    setRound({ level, cardIndex: 0, correctCount: 0, misses: [], selected: null, revealed: false });
    setStage("playing");
  }

  function pick(isSignal: boolean) {
    if (!round || round.revealed) return;
    const card = round.level.cards[round.cardIndex];
    const correct = isSignal === card.isSignal;
    setRound({
      ...round,
      selected: isSignal,
      revealed: true,
      correctCount: round.correctCount + (correct ? 1 : 0),
      misses: correct ? round.misses : [...round.misses, { card, picked: isSignal }],
    });
  }

  function next() {
    if (!round) return;
    const isLast = round.cardIndex + 1 >= round.level.cards.length;
    if (!isLast) {
      setRound({ ...round, cardIndex: round.cardIndex + 1, selected: null, revealed: false });
      return;
    }
    const xpAwarded = xpForRound(round.level.xpBase, round.correctCount, round.level.cards.length);
    onLevelComplete(round.level.id, xpAwarded);
    setLastResult({ level: round.level, correctCount: round.correctCount, xpAwarded, misses: round.misses });
    setStage("result");
  }

  if (stage === "menu" || !round) {
    return (
      <div className="flex flex-col gap-2">
        {SIGNAL_CHECK_LEVELS.map((lvl) => {
          const done = completedLevelIds.includes(lvl.id);
          const suggested = !done && lvl.id === nextSuggestedId;
          return (
            <div
              key={lvl.id}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-3"
              style={{
                background: "var(--ink-800)",
                border: suggested ? "1px solid var(--signal)" : "1px solid transparent",
              }}
            >
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>
                  {lvl.title}
                  {done && <span className="text-xs font-mono ml-2" style={{ color: "var(--text-2)" }}>completed</span>}
                </div>
                <div className="text-xs" style={{ color: "var(--text-2)" }}>{lvl.cards.length} cards, self-paced</div>
              </div>
              <button onClick={() => startLevel(lvl)} className={suggested ? "jv-btn" : "jv-btn-outline"}>
                Play
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  if (stage === "result" && lastResult) {
    const total = lastResult.level.cards.length;
    const accuracy = Math.round((lastResult.correctCount / total) * 100);
    return (
      <div className="jv-card">
        <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-0)" }}>{lastResult.level.title} — Complete</h4>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="jv-label">Correct</div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>{lastResult.correctCount}/{total}</div>
          </div>
          <div>
            <div className="jv-label">Accuracy</div>
            <div className="text-xl font-semibold" style={{ color: "var(--text-0)" }}>{accuracy}%</div>
          </div>
          <div>
            <div className="jv-label">XP Earned</div>
            <div className="text-xl font-semibold" style={{ color: "var(--signal)" }}>+{lastResult.xpAwarded}</div>
          </div>
        </div>
        {lastResult.misses.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            <div className="jv-label">What to remember</div>
            {lastResult.misses.map((m, i) => (
              <div key={i} className="text-xs rounded-lg p-3" style={{ background: "var(--ink-800)", color: "var(--text-1)" }}>
                <span className="font-medium" style={{ color: "var(--text-0)" }}>
                  Actually {m.card.isSignal ? "Signal" : "Noise"}:{" "}
                </span>
                {m.card.explanation}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => startLevel(lastResult.level)} className="jv-btn">
            Play Again
          </button>
          <button onClick={() => setStage("menu")} className="jv-btn-outline">
            Choose a Level
          </button>
        </div>
      </div>
    );
  }

  // stage === "playing"
  const card = round.level.cards[round.cardIndex];
  const correct = round.revealed && round.selected === card.isSignal;
  const showExplanation = round.revealed && (round.level.showExplanationsAlways || !correct);
  const isLast = round.cardIndex + 1 >= round.level.cards.length;

  return (
    <div className="jv-card">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-mono" style={{ color: "var(--text-2)" }}>{round.level.title}</div>
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          Card {round.cardIndex + 1} of {round.level.cards.length}
        </div>
      </div>
      {round.cardIndex === 0 && !round.revealed && (
        <p className="text-xs mb-3" style={{ color: "var(--text-2)" }}>{round.level.intro}</p>
      )}

      <div className="p-4 mb-3" style={{ background: "var(--ink-800)" }}>
        <div className="text-sm font-medium" style={{ color: "var(--text-0)" }}>{card.text}</div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <button
          onClick={() => pick(false)}
          disabled={round.revealed}
          className="rounded-lg px-3 py-4 text-sm font-semibold text-white disabled:cursor-default transition-opacity"
          style={{
            background: "var(--danger)",
            // Highlight whichever button is actually correct once revealed,
            // regardless of what was picked — a wrong pick should show where
            // the truth was, not just dim itself.
            opacity: round.revealed && card.isSignal ? 0.4 : 1,
          }}
        >
          Noise
          {round.revealed && round.selected === false && card.isSignal && (
            <span className="block text-xs font-normal mt-1 opacity-90">your answer</span>
          )}
        </button>
        <button
          onClick={() => pick(true)}
          disabled={round.revealed}
          className="rounded-lg px-3 py-4 text-sm font-semibold disabled:cursor-default transition-opacity"
          style={{
            background: "var(--signal)",
            color: "#04201c",
            opacity: round.revealed && !card.isSignal ? 0.4 : 1,
          }}
        >
          Signal
          {round.revealed && round.selected === true && !card.isSignal && (
            <span className="block text-xs font-normal mt-1 opacity-90">your answer</span>
          )}
        </button>
      </div>

      {round.revealed && (
        <div
          className="text-sm rounded-lg p-3 mb-3"
          style={
            correct
              ? { background: "rgba(79, 232, 208, 0.1)", color: "var(--signal)" }
              : { background: "rgba(240, 168, 104, 0.1)", color: "var(--verdict)" }
          }
        >
          <div className="font-medium mb-1">
            {correct ? "Correct" : `Actually ${card.isSignal ? "Signal" : "Noise"}`}
          </div>
          {showExplanation && <div>{card.explanation}</div>}
        </div>
      )}

      {round.revealed && (
        <button onClick={next} className="jv-btn">
          {isLast ? "See Results" : "Next Card"}
        </button>
      )}
    </div>
  );
}
