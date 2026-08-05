import { runBacktest } from "./historical-backtest";
import { runOrbBacktest } from "./opening-range-breakout";
import { runDayOfWeekBacktest, runTimeOfDayBacktest } from "./calendar-effects";
import { insertHypothesis } from "@/lib/data/hypothesis-ledger-db";
import type {
  AssetClass,
  BacktestHorizonResult,
  DayOfWeekEffectResult,
  EquityBacktestSignalType,
  HypothesisExitType,
  OrbHorizonResult,
  StrategyHypothesis,
  TimeOfDayEffectResult,
} from "../types";

/**
 * Fixed sweep universe — deliberately small so real network calls to
 * Alpaca/OANDA across every symbol x engine combination stay well inside
 * the shared cron route's maxDuration=60 budget. No server-side watchlist
 * exists in this app (confirmed: useWatchlist() is 100% browser
 * localStorage), so this is its own hardcoded list, not a substitute for
 * one.
 */
const SWEEP_EQUITIES = ["AAPL", "MSFT", "SPY"];
const SWEEP_FX = ["EUR/USD", "USD/JPY"];

interface SweepTarget {
  ticker: string;
  assetClass: AssetClass;
}

const SWEEP_UNIVERSE: SweepTarget[] = [
  ...SWEEP_EQUITIES.map((ticker): SweepTarget => ({ ticker, assetClass: "equity" })),
  ...SWEEP_FX.map((ticker): SweepTarget => ({ ticker, assetClass: "forex" })),
];

const MOMENTUM_SIGNAL_TYPES: EquityBacktestSignalType[] = [
  "volumeDisplacement",
  "momentum",
  "meanReversionOversold",
  "meanReversionOverbought",
];

function entryRuleFor(signalType: EquityBacktestSignalType): string {
  switch (signalType) {
    case "volumeDisplacement":
      return "Enter when today's volume is at least 2x the trailing 20-day average volume.";
    case "momentum":
      return "Enter long when the close has risen for 3 consecutive days with volume increasing each day.";
    case "meanReversionOversold":
      return "Enter long when the 20-day rolling z-score of price closes at or below -2 (oversold).";
    case "meanReversionOverbought":
      return "Enter short when the 20-day rolling z-score of price closes at or above +2 (overbought).";
  }
}

function rejectionReasonFor(h: { significantAfterFdr: boolean; ciExcludesZero: boolean; sameSignOutOfSample: boolean | null }): string {
  if (!h.significantAfterFdr) return "Failed FDR-adjusted significance test.";
  if (!h.ciExcludesZero) return "Bootstrap confidence interval includes zero.";
  if (h.sameSignOutOfSample !== true) return "Return sign disagreed between train and out-of-sample periods.";
  return "Did not pass all three statistical bars.";
}

async function logHorizonResult(params: {
  ticker: string;
  assetClass: AssetClass;
  strategyType: string;
  horizonLabel: string;
  entryRule: string;
  exitType: HypothesisExitType;
  exitRule: string;
  sourceEngine: string;
  horizon: BacktestHorizonResult | OrbHorizonResult | DayOfWeekEffectResult | TimeOfDayEffectResult;
}): Promise<void> {
  const { horizon } = params;
  const hypothesis: Omit<StrategyHypothesis, "id" | "createdAt"> = {
    ticker: params.ticker,
    assetClass: params.assetClass,
    strategyType: params.strategyType,
    horizonLabel: params.horizonLabel,
    entryRule: params.entryRule,
    exitType: params.exitType,
    exitRule: params.exitRule,
    sampleSize: horizon.sampleSize,
    winRatePct: horizon.winRate,
    profitFactor: horizon.profitFactor,
    passesThreeBars: horizon.passesAllThreeBars,
    pValueFdr: horizon.pValueFdrAdjusted,
    bootstrapCiLower: horizon.bootstrapCiLower,
    bootstrapCiUpper: horizon.bootstrapCiUpper,
    status: horizon.passesAllThreeBars ? "validated" : "rejected",
    rejectionReason: horizon.passesAllThreeBars ? null : rejectionReasonFor(horizon),
    sourceEngine: params.sourceEngine,
  };
  await insertHypothesis(hypothesis);
}

export interface HypothesisSweepResult {
  symbolsSwept: number;
  hypothesesLogged: number;
  errors: { ticker: string; engine: string; error: string }[];
}

/**
 * Sweeps this app's own already-validated backtest engines across a fixed
 * ticker universe and logs every result — validated or rejected — to the
 * strategy_hypotheses ledger. Zero new statistics: every field here is read
 * straight off each engine's own BH-FDR/bootstrap/out-of-sample result.
 */
export async function runHypothesisSweep(): Promise<HypothesisSweepResult> {
  let hypothesesLogged = 0;
  const errors: { ticker: string; engine: string; error: string }[] = [];

  for (const target of SWEEP_UNIVERSE) {
    // Historical backtest — 4 signal types, each with 5 horizons. Exit is
    // time-based: a fixed N-trading-day forward hold, no price trigger.
    for (const signalType of MOMENTUM_SIGNAL_TYPES) {
      try {
        const result = await runBacktest(target.ticker, signalType, 3);
        for (const h of result.horizons) {
          await logHorizonResult({
            ticker: target.ticker,
            assetClass: target.assetClass,
            strategyType: signalType,
            horizonLabel: `${h.horizonDays}d forward`,
            entryRule: entryRuleFor(signalType),
            exitType: "time",
            exitRule: `Fixed ${h.horizonDays}-trading-day forward hold, then exit regardless of price.`,
            sourceEngine: "historical-backtest",
            horizon: h,
          });
          hypothesesLogged++;
        }
      } catch (err) {
        errors.push({ ticker: target.ticker, engine: `historical-backtest:${signalType}`, error: err instanceof Error ? err.message : "unknown error" });
      }
    }

    // Day-of-week effect — exit is time-based (same-session open-to-close).
    try {
      const dow = await runDayOfWeekBacktest(target.ticker, 3);
      for (const d of dow.days) {
        await logHorizonResult({
          ticker: target.ticker,
          assetClass: target.assetClass,
          strategyType: "dayOfWeekEffect",
          horizonLabel: d.dayOfWeek,
          entryRule: `Enter at the open of every ${d.dayOfWeek}.`,
          exitType: "time",
          exitRule: `Exit at the close of the same ${d.dayOfWeek} session.`,
          sourceEngine: "calendar-effects:day-of-week",
          horizon: d,
        });
        hypothesesLogged++;
      }
    } catch (err) {
      errors.push({ ticker: target.ticker, engine: "calendar-effects:day-of-week", error: err instanceof Error ? err.message : "unknown error" });
    }

    // Time-of-day checkpoint effect (e.g. first 15 min, power hour) — exit
    // is time-based (fixed intraday window).
    try {
      const tod = await runTimeOfDayBacktest(target.ticker, 90);
      for (const c of tod.checkpoints) {
        await logHorizonResult({
          ticker: target.ticker,
          assetClass: target.assetClass,
          strategyType: "timeOfDayEffect",
          horizonLabel: c.label,
          entryRule: `Enter at the start of the "${c.label}" window.`,
          exitType: "time",
          exitRule: `Exit at the end of the "${c.label}" window, same session.`,
          sourceEngine: "calendar-effects:time-of-day",
          horizon: c,
        });
        hypothesesLogged++;
      }
    } catch (err) {
      errors.push({ ticker: target.ticker, engine: "calendar-effects:time-of-day", error: err instanceof Error ? err.message : "unknown error" });
    }

    // ORB — equities only (opening range is an NYSE/Nasdaq session concept;
    // same asset-class caveat already established in
    // opening-range-breakout-watchlist.ts for forex). Exit is time-based:
    // every horizon here is a fixed post-breakout time checkpoint
    // (30min/60min/hold-to-EOD), not a stop/target price level.
    if (target.assetClass === "equity") {
      try {
        const orb = await runOrbBacktest(target.ticker, 15, 3);
        for (const h of orb.horizons) {
          await logHorizonResult({
            ticker: target.ticker,
            assetClass: target.assetClass,
            strategyType: `orbBreakout_${h.direction}`,
            horizonLabel: h.horizonLabel,
            entryRule: `Enter ${h.direction} on a 15-minute opening-range breakout.`,
            exitType: "time",
            exitRule: `Exit at the "${h.horizonLabel}" checkpoint after the breakout.`,
            sourceEngine: "opening-range-breakout",
            horizon: h,
          });
          hypothesesLogged++;
        }
      } catch (err) {
        errors.push({ ticker: target.ticker, engine: "opening-range-breakout", error: err instanceof Error ? err.message : "unknown error" });
      }
    }
  }

  return { symbolsSwept: SWEEP_UNIVERSE.length, hypothesesLogged, errors };
}
