"use client";

import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import type { MarketOptionContract } from "@/lib/data/market-data-types";
import { JARVIS, toPhaserColor } from "@/lib/design/tokens";
import { MAX_TARGETS, contractCost, deltaOutcome, planDeltaRound, type DeltaRoundPlan } from "@/lib/agents/financial-literacy/skills/delta-defender-rules";

// Expert-tier arcade game — real computed targets, not placeholders. Fetches
// a real live options chain (same /api/option-expirations +
// /api/option-chain-contracts routes OptionsChainTradeTab already uses) for
// one fixed liquid ticker, picks up to 8 real call contracts spread across
// strikes, and turns their real strike/delta/bid into the game's targets and
// economy. There is no "IV rank" computed anywhere in this codebase (that
// needs a historical-IV-percentile series this app doesn't have) — this
// game uses the real fields that do exist (delta, implied volatility %,
// bid) rather than fabricating one, an explicit, disclosed substitution.
// "Paper-trading capital as ammunition": each shot costs the target's real
// bid x 100 (the same notional-multiplier convention paper-trading options
// orders already use), drawn from a starting capital pool — you can go
// broke and be unable to fire.

const TICKER = "SPY";
const SPAWN_STAGGER_MS = 1400;
const FALL_DURATION_MS = 6500;

// Palette comes from the jarvis tokens (Phaser cannot read CSS variables).
const C = {
  bg: JARVIS.ink950,
  panel: toPhaserColor(JARVIS.ink700),
  panelHover: toPhaserColor(JARVIS.lineBright),
  text: JARVIS.text0,
  muted: JARVIS.text1,
  signal: JARVIS.signal,
  signalNum: toPhaserColor(JARVIS.signal),
  warn: JARVIS.verdict,
};

interface GameOutcome {
  engaged: number;
  total: number;
  score: number;
  capitalRemaining: number;
}

class DeltaDefenderScene extends Phaser.Scene {
  private contracts: MarketOptionContract[] = [];
  private plan: DeltaRoundPlan = { capital: 0, clearTarget: 0 };
  private capital = 0;
  private score = 0;
  private engaged = 0;
  private resolved = 0;
  private hud!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  // One entry per spawned target, in contract order, so number keys 1-8 can engage them without a mouse.
  private engageByIndex: Array<(() => void) | null> = [];
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    super("DeltaDefender");
  }

  create() {
    this.contracts = this.registry.get("contracts") as MarketOptionContract[];
    this.plan = this.registry.get("plan") as DeltaRoundPlan;
    this.capital = this.plan.capital;
    this.score = 0;
    this.engaged = 0;
    this.resolved = 0;
    this.engageByIndex = [];
    this.setKeys(null);
    this.cameras.main.setBackgroundColor(C.bg);
    this.showRecon();
  }

  /** Replace the scene's single keyboard handler (null removes it). Keyboard play is the alternative to the mouse. */
  private setKeys(handler: ((e: KeyboardEvent) => void) | null) {
    const kb = this.input.keyboard;
    if (!kb) return;
    if (this.keyHandler) kb.off("keydown", this.keyHandler);
    this.keyHandler = handler;
    if (handler) kb.on("keydown", handler);
  }

  private showRecon() {
    this.add.text(20, 16, `Delta Defender — ${TICKER} real chain, ${this.contracts.length} contracts`, {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: C.text,
    });
    this.add.text(
      20,
      44,
      "Real recon before engagement — top 3 contracts by delta:",
      { fontFamily: "sans-serif", fontSize: "12px", color: C.muted }
    );
    const top3 = [...this.contracts].sort((a, b) => b.delta - a.delta).slice(0, 3);
    top3.forEach((c, i) => {
      this.add.text(
        30,
        70 + i * 20,
        `$${c.strikePrice} Call · Δ${c.delta.toFixed(2)} · IV ${c.volatility.toFixed(1)}% · bid $${c.bid.toFixed(2)} (cost $${contractCost(c).toFixed(0)})`,
        { fontFamily: "sans-serif", fontSize: "12px", color: C.signal }
      );
    });
    this.add.text(
      20,
      136,
      `Capital this round: $${this.plan.capital}. Goal: engage ${this.plan.clearTarget} contracts. Each one costs its real bid x 100, and high-delta contracts cost the most, so you cannot take them all. Click a falling contract, or press its number key (1-${this.contracts.length}).`,
      { fontFamily: "sans-serif", fontSize: "12px", color: C.text, wordWrap: { width: 440 } }
    );

    const engageBg = this.add.rectangle(20, 206, 160, 44, C.panel).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.add.text(36, 222, "Engage (Enter)", { fontFamily: "sans-serif", fontSize: "15px", color: C.signal, fontStyle: "bold" });
    engageBg.on("pointerover", () => engageBg.setFillStyle(C.panelHover));
    engageBg.on("pointerout", () => engageBg.setFillStyle(C.panel));
    const begin = () => {
      this.children.removeAll(true);
      this.startWave();
    };
    engageBg.on("pointerdown", begin);
    this.setKeys((e) => {
      if (e.key === "Enter" || e.key === " ") begin();
    });
  }

  private startWave() {
    this.hud = this.add.text(20, 12, "", { fontFamily: "sans-serif", fontSize: "13px", color: C.text });
    this.messageText = this.add.text(20, 34, "", { fontFamily: "sans-serif", fontSize: "12px", color: C.warn });
    this.updateHud();
    this.engageByIndex = this.contracts.map(() => null);
    this.setKeys((e) => {
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= this.engageByIndex.length) this.engageByIndex[n - 1]?.();
    });

    this.contracts.forEach((contract, i) => {
      this.time.delayedCall(i * SPAWN_STAGGER_MS, () => this.spawnTarget(contract, i));
    });
  }

  private updateHud() {
    this.hud.setText(
      `Capital: $${this.capital.toFixed(0)}   Engaged: ${this.engaged}/${this.plan.clearTarget} goal   Score: ${this.score}   Targets: ${this.resolved}/${this.contracts.length}`
    );
  }

  private spawnTarget(contract: MarketOptionContract, index: number) {
    const x = 40 + Math.random() * 400;
    const cost = contractCost(contract);
    const container = this.add.container(x, -20);
    const bg = this.add.rectangle(0, 0, 130, 40, C.panel).setStrokeStyle(1, C.signalNum).setOrigin(0.5);
    const label = this.add.text(0, -8, `${index + 1}: $${contract.strikePrice}C`, { fontFamily: "sans-serif", fontSize: "13px", color: C.text }).setOrigin(0.5);
    const sub = this.add.text(0, 9, `Δ${contract.delta.toFixed(2)} · $${cost.toFixed(0)}`, { fontFamily: "sans-serif", fontSize: "10px", color: C.muted }).setOrigin(0.5);
    container.add([bg, label, sub]);
    container.setSize(130, 40);
    container.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-65, -20, 130, 40), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });

    let resolved = false;
    const engage = () => {
      if (resolved) return;
      if (this.capital < cost) {
        this.messageText.setText(`Not enough capital for $${contract.strikePrice}C (need $${cost.toFixed(0)}).`);
        this.time.delayedCall(1200, () => this.messageText.setText(""));
        return;
      }
      resolved = true;
      this.engageByIndex[index] = null;
      this.capital -= cost;
      this.score += Math.round(contract.delta * 100);
      this.engaged += 1;
      this.resolved += 1;
      this.updateHud();
      this.tweens.killTweensOf(container);
      this.tweens.add({
        targets: container,
        scale: 1.4,
        alpha: 0,
        duration: 200,
        onComplete: () => {
          container.destroy();
          this.checkEnd();
        },
      });
    };
    this.engageByIndex[index] = engage;
    container.on("pointerdown", engage);

    this.tweens.add({
      targets: container,
      y: 340,
      duration: FALL_DURATION_MS,
      onComplete: () => {
        if (resolved) return;
        resolved = true;
        this.engageByIndex[index] = null;
        this.resolved += 1;
        this.updateHud();
        container.destroy();
        this.checkEnd();
      },
    });
  }

  private checkEnd() {
    if (this.resolved < this.contracts.length) return;
    const outcome: GameOutcome = {
      engaged: this.engaged,
      total: this.contracts.length,
      score: this.score,
      capitalRemaining: this.capital,
    };
    this.showEnding(outcome);
  }

  private showEnding(outcome: GameOutcome) {
    const result = deltaOutcome(outcome.engaged, this.plan.clearTarget);
    const summary = result.cleared
      ? `Goal met: engaged ${outcome.engaged} of ${outcome.total}, score ${outcome.score}, $${outcome.capitalRemaining.toFixed(0)} capital left.`
      : outcome.engaged > 0
        ? `Engaged ${outcome.engaged} of ${this.plan.clearTarget} needed — score ${outcome.score}, $${outcome.capitalRemaining.toFixed(0)} capital left.`
        : "Nothing engaged, so no XP this round. Try again and engage at least one contract.";
    this.add.text(20, 160, summary, { fontFamily: "sans-serif", fontSize: "14px", color: C.text, wordWrap: { width: 440 } });

    const replayBg = this.add.rectangle(20, 210, 190, 44, C.panel).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.add.text(34, 226, "Play again (R)", { fontFamily: "sans-serif", fontSize: "14px", color: C.text });
    replayBg.on("pointerover", () => replayBg.setFillStyle(C.panelHover));
    replayBg.on("pointerout", () => replayBg.setFillStyle(C.panel));
    replayBg.on("pointerdown", () => this.create());
    this.setKeys((e) => {
      if (e.key === "r" || e.key === "R" || e.key === "Enter") this.create();
    });

    const onComplete = this.registry.get("onComplete") as ((xp: number, cleared: boolean) => void) | undefined;
    if (result.award) onComplete?.(result.xp, result.cleared);
  }
}

export function DeltaDefenderGame({ onComplete }: { onComplete: (xpAwarded: number, cleared: boolean) => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<MarketOptionContract[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const hasAwardedRef = useRef(false);
  // The parent passes a fresh arrow function on every render. Keeping the latest one in a ref (and out of the
  // effect dependencies) stops the Phaser game being destroyed and rebuilt whenever the parent re-renders,
  // for example when completing the module updates XP. Audit finding F1.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const expRes = await fetch(`/api/option-expirations?ticker=${TICKER}`);
        const expJson = await expRes.json();
        if (!expRes.ok) throw new Error(expJson.error ?? "Could not load option expirations.");
        const expirations: string[] = expJson.expirations ?? [];
        if (expirations.length === 0) throw new Error("No option expirations available for " + TICKER + ".");
        // The nearest expiration is often same-day (0DTE) — every strike is
        // then deep ITM (delta~1) or deep OTM (delta~0/near-worthless), which
        // makes for uninformative targets. Prefer the next-nearest real
        // expiration when one exists, so real deltas/IV span a meaningful
        // range instead of clustering at the extremes.
        const expiration = expirations[1] ?? expirations[0];

        const chainRes = await fetch(`/api/option-chain-contracts?ticker=${TICKER}&expiration=${expiration}`);
        const chainJson = await chainRes.json();
        if (!chainRes.ok) throw new Error(chainJson.error ?? "Could not load the options chain.");

        const underlyingPrice: number | undefined = chainJson.underlyingPrice;
        const calls = ((chainJson.calls ?? []) as MarketOptionContract[])
          .filter((c) => c.delta > 0 && c.bid > 0)
          .sort((a, b) => a.strikePrice - b.strikePrice);
        if (calls.length === 0) throw new Error("No tradeable call contracts in the current chain.");

        // Center the picked strikes on the real underlying price (rather
        // than striding evenly across the whole chain) so targets span real
        // ITM-through-OTM deltas around the actual spot, not just whatever
        // strikes happen to land on a fixed stride.
        const picked = underlyingPrice
          ? [...calls]
              .sort((a, b) => Math.abs(a.strikePrice - underlyingPrice) - Math.abs(b.strikePrice - underlyingPrice))
              .slice(0, MAX_TARGETS)
              .sort((a, b) => a.strikePrice - b.strikePrice)
          : (() => {
              const stride = Math.max(1, Math.floor(calls.length / MAX_TARGETS));
              return calls.filter((_, i) => i % stride === 0).slice(0, MAX_TARGETS);
            })();

        if (!cancelled) {
          setContracts(picked);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error.");
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !containerRef.current || contracts.length === 0) return;
    const container = containerRef.current;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: 480,
      height: 280,
      parent: container,
      scene: [DeltaDefenderScene],
      backgroundColor: JARVIS.ink950,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
      // Key presses only reach the game while its (focusable) container has focus, so two games on one page
      // do not both react to the same key and typing elsewhere is never captured.
      input: { keyboard: { target: container } },
    });
    game.registry.set("contracts", contracts);
    game.registry.set("plan", planDeltaRound(contracts));
    game.registry.set("onComplete", (xp: number, cleared: boolean) => {
      if (hasAwardedRef.current) return;
      hasAwardedRef.current = true;
      onCompleteRef.current(xp, cleared);
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      container.innerHTML = "";
    };
  }, [status, contracts]);

  if (status === "loading") {
    return <div className="text-sm py-6" style={{ color: "var(--text-2)" }}>Loading a real {TICKER} options chain…</div>;
  }
  if (status === "error") {
    return (
      <div className="text-sm py-3" role="status" style={{ color: "var(--verdict)" }}>
        Delta Defender needs a real, live options chain to play (this app never fabricates contract data) —{" "}
        {error}
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Delta Defender arcade game. Press Enter to start, then press a contract's number key (1 to 8) to engage it as it falls. R plays again. The expert lessons cover the same ideas in text, so this game is optional."
      style={{ maxWidth: 480, borderRadius: 8, overflow: "hidden", border: "1px solid var(--line-control)" }}
    />
  );
}
