"use client";

import { useEffect, useRef } from "react";
import Phaser from "phaser";

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
    this.cameras.main.setBackgroundColor("#0f172a");

    this.add.text(20, 16, "Piggy Bank Quest — save $60 for a bike in 6 weeks", {
      fontFamily: "sans-serif",
      fontSize: "16px",
      color: "#e2e8f0",
    });

    this.roundText = this.add.text(20, 48, "", { fontFamily: "sans-serif", fontSize: "14px", color: "#94a3b8" });
    this.savingsText = this.add.text(20, 70, "", { fontFamily: "sans-serif", fontSize: "22px", color: "#4fe8d0", fontStyle: "bold" });

    this.add.rectangle(20, 104, 360, 14, 0x1e293b).setOrigin(0, 0.5);
    this.progressBarFill = this.add.rectangle(20, 104, 0, 14, 0x4fe8d0).setOrigin(0, 0.5);

    this.promptText = this.add.text(20, 140, "", { fontFamily: "sans-serif", fontSize: "15px", color: "#e2e8f0", wordWrap: { width: 360 } });

    this.buttonContainer = this.add.container(0, 0);

    this.renderRound();
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
      { label: "Save it", sub: `+$${ALLOWANCE} to savings`, action: () => this.choose(ALLOWANCE, false) },
      { label: "Spend it", sub: "Buy the want, $0 saved", action: () => this.choose(0, true) },
      { label: "Do a chore too", sub: `+$${ALLOWANCE + CHORE_BONUS} to savings`, action: () => this.choose(ALLOWANCE + CHORE_BONUS, false) },
    ];

    choices.forEach((c, i) => {
      const y = 190 + i * 56;
      const bg = this.add.rectangle(20, y, 360, 44, 0x1e293b).setOrigin(0, 0).setInteractive({ useHandCursor: true });
      const label = this.add.text(34, y + 8, c.label, { fontFamily: "sans-serif", fontSize: "15px", color: "#e2e8f0", fontStyle: "bold" });
      const sub = this.add.text(34, y + 26, c.sub, { fontFamily: "sans-serif", fontSize: "12px", color: "#94a3b8" });
      bg.on("pointerover", () => bg.setFillStyle(0x334155));
      bg.on("pointerout", () => bg.setFillStyle(0x1e293b));
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

    const replayBg = this.add.rectangle(20, 190, 170, 44, 0x1e293b).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const replayLabel = this.add.text(34, 206, "Play again", { fontFamily: "sans-serif", fontSize: "14px", color: "#e2e8f0" });
    replayBg.on("pointerover", () => replayBg.setFillStyle(0x334155));
    replayBg.on("pointerout", () => replayBg.setFillStyle(0x1e293b));
    replayBg.on("pointerdown", () => this.create());
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
      backgroundColor: "#0f172a",
    });
    game.registry.set("onComplete", (xp: number, metGoal: boolean) => {
      // A replay can finish more than once — only the first completion of a
      // session awards XP, so replaying for fun doesn't farm XP.
      if (hasAwardedRef.current) return;
      hasAwardedRef.current = true;
      onComplete(xp, metGoal);
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      // Defensive: guarantee no orphaned canvas survives regardless of
      // Phaser's own cleanup timing.
      container.innerHTML = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800" />;
}
