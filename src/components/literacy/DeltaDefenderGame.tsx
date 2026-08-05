"use client";

import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import type { MarketOptionContract } from "@/lib/data/market-data-types";

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
const STARTING_CAPITAL = 2000;
const MAX_TARGETS = 8;
const SPAWN_STAGGER_MS = 1400;
const FALL_DURATION_MS = 6500;
const XP_ON_CLEAR = 30;
const XP_ON_ATTEMPT = 15;

interface GameOutcome {
  engaged: number;
  total: number;
  score: number;
  capitalRemaining: number;
}

class DeltaDefenderScene extends Phaser.Scene {
  private contracts: MarketOptionContract[] = [];
  private capital = STARTING_CAPITAL;
  private score = 0;
  private engaged = 0;
  private resolved = 0;
  private hud!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  constructor() {
    super("DeltaDefender");
  }

  create() {
    this.contracts = this.registry.get("contracts") as MarketOptionContract[];
    this.capital = STARTING_CAPITAL;
    this.score = 0;
    this.engaged = 0;
    this.resolved = 0;
    this.cameras.main.setBackgroundColor("#050814");
    this.showRecon();
  }

  private showRecon() {
    this.add.text(20, 16, `Delta Defender — ${TICKER} real chain, ${this.contracts.length} contracts`, {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#e2e8f0",
    });
    this.add.text(
      20,
      44,
      "Real recon before engagement — top 3 contracts by delta:",
      { fontFamily: "sans-serif", fontSize: "12px", color: "#94a3b8" }
    );
    const top3 = [...this.contracts].sort((a, b) => b.delta - a.delta).slice(0, 3);
    top3.forEach((c, i) => {
      this.add.text(
        30,
        70 + i * 20,
        `$${c.strikePrice} Call · Δ${c.delta.toFixed(2)} · IV ${c.volatility.toFixed(1)}% · bid $${c.bid.toFixed(2)} (cost $${(c.bid * 100).toFixed(0)})`,
        { fontFamily: "sans-serif", fontSize: "12px", color: "#4fe8d0" }
      );
    });
    this.add.text(20, 150, `Starting capital: $${STARTING_CAPITAL}. Click a falling contract to engage it — cost is its real bid x 100.`, {
      fontFamily: "sans-serif",
      fontSize: "12px",
      color: "#e2e8f0",
      wordWrap: { width: 440 },
    });

    const engageBg = this.add.rectangle(20, 190, 160, 44, 0x1e293b).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const engageLabel = this.add.text(48, 206, "Engage", { fontFamily: "sans-serif", fontSize: "15px", color: "#4fe8d0", fontStyle: "bold" });
    engageBg.on("pointerover", () => engageBg.setFillStyle(0x334155));
    engageBg.on("pointerout", () => engageBg.setFillStyle(0x1e293b));
    engageBg.on("pointerdown", () => {
      this.children.removeAll(true);
      this.startWave();
    });
  }

  private startWave() {
    this.hud = this.add.text(20, 12, "", { fontFamily: "sans-serif", fontSize: "13px", color: "#e2e8f0" });
    this.messageText = this.add.text(20, 34, "", { fontFamily: "sans-serif", fontSize: "12px", color: "#f59e0b" });
    this.updateHud();

    this.contracts.forEach((contract, i) => {
      this.time.delayedCall(i * SPAWN_STAGGER_MS, () => this.spawnTarget(contract));
    });
  }

  private updateHud() {
    this.hud.setText(
      `Capital: $${this.capital.toFixed(0)}   Score: ${this.score}   Targets: ${this.resolved}/${this.contracts.length}`
    );
  }

  private spawnTarget(contract: MarketOptionContract) {
    const x = 40 + Math.random() * 400;
    const cost = contract.bid * 100;
    const container = this.add.container(x, -20);
    const bg = this.add.rectangle(0, 0, 130, 40, 0x1e293b).setStrokeStyle(1, 0x4fe8d0).setOrigin(0.5);
    const label = this.add.text(0, -8, `$${contract.strikePrice}C`, { fontFamily: "sans-serif", fontSize: "13px", color: "#e2e8f0" }).setOrigin(0.5);
    const sub = this.add.text(0, 9, `Δ${contract.delta.toFixed(2)} · $${cost.toFixed(0)}`, { fontFamily: "sans-serif", fontSize: "10px", color: "#94a3b8" }).setOrigin(0.5);
    container.add([bg, label, sub]);
    container.setSize(130, 40);
    container.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-65, -20, 130, 40), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });

    let resolved = false;
    container.on("pointerdown", () => {
      if (resolved) return;
      if (this.capital < cost) {
        this.messageText.setText(`Not enough capital for $${contract.strikePrice}C (need $${cost.toFixed(0)}).`);
        this.time.delayedCall(1200, () => this.messageText.setText(""));
        return;
      }
      resolved = true;
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
    });

    this.tweens.add({
      targets: container,
      y: 340,
      duration: FALL_DURATION_MS,
      onComplete: () => {
        if (resolved) return;
        resolved = true;
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
    const cleared = outcome.engaged >= outcome.total;
    this.add.text(
      20,
      160,
      cleared
        ? `All ${outcome.total} contracts engaged — score ${outcome.score}, $${outcome.capitalRemaining.toFixed(0)} capital left.`
        : `Engaged ${outcome.engaged}/${outcome.total} — score ${outcome.score}, $${outcome.capitalRemaining.toFixed(0)} capital left.`,
      { fontFamily: "sans-serif", fontSize: "14px", color: "#e2e8f0", wordWrap: { width: 440 } }
    );

    const replayBg = this.add.rectangle(20, 210, 170, 44, 0x1e293b).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const replayLabel = this.add.text(34, 226, "Play again", { fontFamily: "sans-serif", fontSize: "14px", color: "#e2e8f0" });
    replayBg.on("pointerover", () => replayBg.setFillStyle(0x334155));
    replayBg.on("pointerout", () => replayBg.setFillStyle(0x1e293b));
    replayBg.on("pointerdown", () => this.create());

    const xp = cleared ? XP_ON_CLEAR : XP_ON_ATTEMPT;
    const onComplete = this.registry.get("onComplete") as ((xp: number, cleared: boolean) => void) | undefined;
    onComplete?.(xp, cleared);
  }
}

export function DeltaDefenderGame({ onComplete }: { onComplete: (xpAwarded: number, cleared: boolean) => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<MarketOptionContract[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const hasAwardedRef = useRef(false);

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
      backgroundColor: "#050814",
    });
    game.registry.set("contracts", contracts);
    game.registry.set("onComplete", (xp: number, cleared: boolean) => {
      if (hasAwardedRef.current) return;
      hasAwardedRef.current = true;
      onComplete(xp, cleared);
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
      container.innerHTML = "";
    };
  }, [status, contracts, onComplete]);

  if (status === "loading") {
    return <div className="text-sm text-zinc-400 py-6">Loading a real {TICKER} options chain…</div>;
  }
  if (status === "error") {
    return (
      <div className="text-sm text-amber-700 dark:text-amber-500 py-3">
        Delta Defender needs a real, live options chain to play (this app never fabricates contract data) —{" "}
        {error}
      </div>
    );
  }
  return <div ref={containerRef} className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800" />;
}
