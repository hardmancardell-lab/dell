"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { JARVIS, toPhaserColor } from "@/lib/design/tokens";

// A real save/spend/earn simulation for the Beginner tier — a simulation-
// style game, not more trivia, per the game-based-learning literature cited
// in the Phase 18 plan (SAGE 2025 rural-China quasi-experiment, the
// multi-country Financial Escape Room RCT, the Colombian field experiment):
// all three point at simulation-style play, not quiz repetition, as the
// format that actually moves the needle for younger learners.
//
// Mechanic: 6 weekly rounds. Each week the player gets a $10 allowance and
// chooses Save (+$10 to savings), Spend (a want is fulfilled, $0 saved), or
// Chore (+$15 to savings — allowance plus a $5 bonus, at the cost of extra
// effort). Goal: $60 saved by round 6, to "buy a bike" — a concrete,
// achievable delayed-gratification tradeoff a real 8-12 year old can reason
// about, not an abstract percentage.

const ROUNDS = 6;
const ALLOWANCE = 10;
const CHORE_BONUS = 5;
const GOAL = 60;
const XP_ON_GOAL_MET = 20;
const XP_ON_ATTEMPT = 10;

interface GameState {
  round: number;
  savings: number;
  wantsFulfilled: number;
}

// Palette comes from the jarvis tokens (Phaser cannot read CSS variables).
const C = {
  bg: JARVIS.ink950,
  panel: toPhaserColor(JARVIS.ink700),
  panelHover: toPhaserColor(JARVIS.lineBright),
  track: toPhaserColor(JARVIS.ink700),
  text: JARVIS.text0,
  muted: JARVIS.text1,
  signal: JARVIS.signal,
  signalNum: toPhaserColor(JARVIS.signal),
};

const WANTS = ["a comic book", "a video game skin", "candy at the store", "a toy from the vending machine", "a movie ticket", "stickers"];

class SaveSpendEarnScene extends Phaser.Scene {
  private state: GameState = { round: 1, savings: 0, wantsFulfilled: 0 };
  private savingsText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private progressBarFill!: Phaser.GameObjects.Rectangle;
  private buttonContainer!: Phaser.GameObjects.Container;

  constructor() {
    super("SaveSpendEarn");
  }

  create() {
    this.state = { round: 1, savings: 0, wantsFulfilled: 0 };
    this.setKeys(null);
    this.cameras.main.setBackgroundColor(C.bg);

    this.add.text(20, 16, "Piggy Bank Quest — save $60 for a bike in 6 weeks", {
      fontFamily: "sans-serif",
      fontSize: "16px",
      color: C.text,
    });

    this.roundText = this.add.text(20, 48, "", { fontFamily: "sans-serif", fontSize: "14px", color: C.muted });
    this.savingsText = this.add.text(20, 70, "", { fontFamily: "sans-serif", fontSize: "22px", color: C.signal, fontStyle: "bold" });

    this.add.rectangle(20, 104, 360, 14, C.track).setOrigin(0, 0.5);
    this.progressBarFill = this.add.rectangle(20, 104, 0, 14, C.signalNum).setOrigin(0, 0.5);

    this.promptText = this.add.text(20, 140, "", { fontFamily: "sans-serif", fontSize: "15px", color: C.text, wordWrap: { width: 360 } });

    this.buttonContainer = this.add.container(0, 0);

    this.renderRound();
  }

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Keyboard alternative to the mouse: replace the single key handler (null removes it). */
  private setKeys(handler: ((e: KeyboardEvent) => void) | null) {
    const kb = this.input.keyboard;
    if (!kb) return;
    if (this.keyHandler) kb.off("keydown", this.keyHandler);
    this.keyHandler = handler;
    if (handler) kb.on("keydown", handler);
  }

  private renderRound() {
    this.buttonContainer.removeAll(true);
    this.roundText.setText(`Week ${this.state.round} of ${ROUNDS}`);
    this.savingsText.setText(`Saved: $${this.state.savings}`);
    this.progressBarFill.width = Math.min(360, (this.state.savings / GOAL) * 360);

    if (this.state.round > ROUNDS) {
      this.showEnding();
      return;
    }

    const want = WANTS[(this.state.round - 1) % WANTS.length];
    this.promptText.setText(
      `Your $${ALLOWANCE} allowance came in. There's ${want} you could buy right now — what do you do?`
    );

    const choices: { label: string; sub: string; action: () => void }[] = [
      { label: "1. Save it", sub: `+$${ALLOWANCE} to savings`, action: () => this.choose(ALLOWANCE, false) },
      { label: "2. Spend it", sub: "Buy the want, $0 saved", action: () => this.choose(0, true) },
      { label: "3. Do a chore too", sub: `+$${ALLOWANCE + CHORE_BONUS} to savings`, action: () => this.choose(ALLOWANCE + CHORE_BONUS, false) },
    ];

    this.setKeys((e) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) choices[n - 1].action();
    });

    choices.forEach((c, i) => {
      const y = 190 + i * 56;
      const bg = this.add.rectangle(20, y, 360, 44, C.panel).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      const label = this.add.text(34, y + 8, c.label, { fontFamily: "sans-serif", fontSize: "15px", color: C.text, fontStyle: "bold" });
      const sub = this.add.text(34, y + 26, c.sub, { fontFamily: "sans-serif", fontSize: "12px", color: C.muted });
      bg.on("pointerover", () => bg.setFillStyle(C.panelHover));
      bg.on("pointerout", () => bg.setFillStyle(C.panel));
      bg.on("pointerdown", () => c.action());
      this.buttonContainer.add([bg, label, sub]);
    });
  }

  private choose(savedAmount: number, wasWant: boolean) {
    this.state.savings += savedAmount;
    if (wasWant) this.state.wantsFulfilled += 1;
    this.state.round += 1;
    this.renderRound();
  }

  private showEnding() {
    this.promptText.setText("");
    const metGoal = this.state.savings >= GOAL;
    const summary = metGoal
      ? `You saved $${this.state.savings} — enough for the bike! You fulfilled ${this.state.wantsFulfilled} want(s) along the way.`
      : `You saved $${this.state.savings} — short of the $${GOAL} goal. You fulfilled ${this.state.wantsFulfilled} want(s), which meant less saved for the bike.`;
    this.promptText.setText(summary);

    const replayBg = this.add.rectangle(20, 190, 170, 44, C.panel).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const replayLabel = this.add.text(34, 206, "Play again (R)", { fontFamily: "sans-serif", fontSize: "14px", color: C.text });
    replayBg.on("pointerover", () => replayBg.setFillStyle(C.panelHover));
    replayBg.on("pointerout", () => replayBg.setFillStyle(C.panel));
    replayBg.on("pointerdown", () => this.create());
    this.setKeys((e) => {
      if (e.key === "r" || e.key === "R" || e.key === "Enter") this.create();
    });
    this.buttonContainer.add([replayBg, replayLabel]);

    const xp = metGoal ? XP_ON_GOAL_MET : XP_ON_ATTEMPT;
    const onComplete = this.registry.get("onComplete") as ((xp: number, metGoal: boolean) => void) | undefined;
    onComplete?.(xp, metGoal);
  }
}

export function SaveSpendEarnGame({ onComplete }: { onComplete: (xpAwarded: number, metGoal: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const hasAwardedRef = useRef(false);
  // Latest callback in a ref so a parent re-render never rebuilds the game (the effect below only runs once).
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Treat every effect invocation as independent and fully self-cleaning
    // (React 19 StrictMode double-invokes effects in dev) rather than
    // relying on a ref-based dedup guard, which left an orphaned canvas
    // behind under double-invoke during testing.
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: 400,
      height: 260,
      parent: container,
      scene: [SaveSpendEarnScene],
      backgroundColor: JARVIS.ink950,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
      // Key presses only reach the game while its (focusable) container has focus, so two games on one page
      // do not both react to the same key and typing elsewhere is never captured.
      input: { keyboard: { target: container } },
    });
    game.registry.set("onComplete", (xp: number, metGoal: boolean) => {
      // A replay can finish more than once — only the first completion of a
      // session awards XP, so replaying for fun doesn't farm XP.
      if (hasAwardedRef.current) return;
      hasAwardedRef.current = true;
      onCompleteRef.current(xp, metGoal);
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      // Defensive: guarantee no orphaned canvas survives regardless of
      // Phaser's own cleanup timing.
      container.innerHTML = "";
    };
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Piggy Bank Quest. Press 1 to save, 2 to spend, or 3 to do a chore each week, and R to play again. The lessons cover the same ideas in text, so this game is optional."
      style={{ maxWidth: 400, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-control)" }}
    />
  );
}
