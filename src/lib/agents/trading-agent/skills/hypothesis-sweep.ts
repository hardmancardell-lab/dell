import { runBacktest } from "./historical-backtest";
import { runOrbBacktest } from "./opening-range-breakout";
import { runDayOfWeekBacktest, runTimeOfDayBacktest } from "./calendar-effects";
import { getDailyBars } from "./daily-bars";
import { computeShannonEntropy, dailyReturnsFromBars } from "./entropy-analyzer";
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
 * Fixed sweep universe. Real network calls to Alpaca/OANDA across every
 * symbol x engine combination must stay well inside the shared cron
 * route's maxDuration=60 budget, so widening this list is split into two
 * tiers rather than just growing the original flat list: a "full sweep"
 * tier (unchanged — every engine, including the two minute-bar-heavy ones,
 * calendar-effects:time-of-day and opening-range-breakout) and a lighter
 * "signals-only" tier (only the 4 historical-backtest signal types —
 * volumeDisplacement/momentum/meanReversionOversold/meanReversionOverbought).
 * The signals-only tier is also the ONLY tier that can ever feed the Guided
 * Trade Signal card (guided-trade-signals.ts) — day-of-week/time-of-day/ORB
 * results have no matching live-trigger check, so sweeping them for tickers
 * that only exist to grow that card's pool would spend real cron budget on
 * results that can never surface there. No server-side watchlist exists in
 * this app (confirmed: useWatchlist() is 100% browser localStorage), so
 * this remains its own hardcoded list, not a substitute for one.
 */
const SWEEP_EQUITIES_FULL = ["AAPL", "MSFT", "SPY"];
const SWEEP_FX_FULL = ["EUR/USD", "USD/JPY"];
const SWEEP_EQUITIES_SIGNALS_ONLY = ["NVDA", "GOOGL", "AMZN", "TSLA", "META", "QQQ"];
const SWEEP_FX_SIGNALS_ONLY = ["GBP/USD", "USD/CAD"];

interface SweepTarget {
  ticker: string;
  assetClass: AssetClass;
  fullSweep: boolean;
}

const SWEEP_UNIVERSE: SweepTarget[] = [
  ...SWEEP_EQUITIES_FULL.map((ticker): SweepTarget => ({ ticker, assetClass: "equity", fullSweep: true })),
  ...SWEEP_FX_FULL.map((ticker): SweepTarget => ({ ticker, assetClass: "forex", fullSweep: true })),
  ...SWEEP_EQUITIES_SIGNALS_ONLY.map((ticker): SweepTarget => ({ ticker, assetClass: "equity", fullSweep: false })),
  ...SWEEP_FX_SIGNALS_ONLY.map((ticker): SweepTarget => ({ ticker, assetClass: "forex", fullSweep: false })),
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

// A result can pass all three statistical bars (FDR significance, bootstrap
// CI excludes zero, out-of-sample sign agreement) and still not be worth
// acting on if it wins less than half the time with a thin edge. Requiring
// a real win-rate floor on top of the three bars is a disclosed tightening
// of what counts as "validated" — logged explicitly in rejectionReason when
// this is the specific reason a statistically-significant result is still
// marked rejected.
const MIN_WIN_RATE_PCT = 60;

function rejectionReasonFor(h: {
  significantAfterFdr: boolean;
  ciExcludesZero: boolean;
  sameSignOutOfSample: boolean | null;
  winRate: number | null;
}): string {
  if (!h.significantAfterFdr) return "Failed FDR-adjusted significance test.";
  if (!h.ciExcludesZero) return "Bootstrap confidence interval includes zero.";
  if (h.sameSignOutOfSample !== true) return "Return sign disagreed between train and out-of-sample periods.";
  if (h.winRate === null || h.winRate < MIN_WIN_RATE_PCT) {
    return `Passed all three statistical bars but win rate (${h.winRate === null ? "unknown" : `${h.winRate.toFixed(1)}%`}) is below the ${MIN_WIN_RATE_PCT}% floor.`;
  }
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
  entropyScore: number | null;
  horizon: BacktestHorizonResult | OrbHorizonResult | DayOfWeekEffectResult | TimeOfDayEffectResult;
}): Promise<void> {
  const { horizon } = params;
  const meetsWinRateFloor = horizon.winRate !== null && horizon.winRate >= MIN_WIN_RATE_PCT;
  const validated = horizon.passesAllThreeBars && meetsWinRateFloor;
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
    status: validated ? "validated" : "rejected",
    rejectionReason: validated ? null : rejectionReasonFor(horizon),
    sourceEngine: params.sourceEngine,
    entropyScore: params.entropyScore,
  };
  await insertHypothesis(hypothesis);
}

export interface HypothesisSweepResult {
  symbolsSwept: number;
  hypothesesLogged: number;
  errors: { ticker: string; engine: string; error: string }[];
}

interface TickerSweepResult {
  hypothesesLogged: number;
  errors: { ticker: string; engine: string; error: string }[];
}

/**
 * All of one ticker's real work for a sweep run. Extracted so
 * runHypothesisSweep can run every ticker concurrently (Promise.all) rather
 * than sequentially — measured live: sweeping the original 5-ticker
 * universe plus 3 signals-only tickers sequentially used 54.5s of the
 * shared cron route's 60s budget (a real FUNCTION_INVOCATION_TIMEOUT was
 * hit at 8 signals-only tickers), leaving too little margin for real-world
 * variance in a weekly production job. Every ticker's work here is fully
 * independent (its own bars, its own hypotheses) and Alpaca/OANDA's free-
 * tier rate limits comfortably cover this app's whole sweep universe
 * firing at once, so concurrency is the correct fix rather than just
 * shrinking the universe further.
 */
async function sweepOneTicker(target: SweepTarget): Promise<TickerSweepResult> {
  let hypothesesLogged = 0;
  const errors: { ticker: string; engine: string; error: string }[] = [];

  // One real entropy read per ticker per sweep run, from the same 3-year
  // daily-bar history the backtest engines below already pull — reused
  // across every hypothesis logged for this ticker in this run rather
  // than refetched per engine.
  let entropyScore: number | null = null;
  try {
    const entropyBars = await getDailyBars(target.ticker, 3 * 365);
    entropyScore = computeShannonEntropy(dailyReturnsFromBars(entropyBars));
  } catch (err) {
    errors.push({ ticker: target.ticker, engine: "entropy-analyzer", error: err instanceof Error ? err.message : "unknown error" });
  }

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
          entropyScore,
          horizon: h,
        });
        hypothesesLogged++;
      }
    } catch (err) {
      errors.push({ ticker: target.ticker, engine: `historical-backtest:${signalType}`, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  // Day-of-week/time-of-day/ORB — skipped for signals-only tickers (see
  // SWEEP_UNIVERSE comment above).
  if (!target.fullSweep) return { hypothesesLogged, errors };

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
        entropyScore,
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
        entropyScore,
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
          entropyScore,
          horizon: h,
        });
        hypothesesLogged++;
      }
    } catch (err) {
      errors.push({ ticker: target.ticker, engine: "opening-range-breakout", error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return { hypothesesLogged, errors };
}

/**
 * Sweeps this app's own already-validated backtest engines across a fixed
 * ticker universe and logs every result — validated or rejected — to the
 * strategy_hypotheses ledger. Zero new statistics: every field here is read
 * straight off each engine's own BH-FDR/bootstrap/out-of-sample result.
 * Every ticker runs concurrently (see sweepOneTicker) to stay well inside
 * the shared cron route's maxDuration=60 budget.
 */
export async function runHypothesisSweep(): Promise<HypothesisSweepResult> {
  const perTicker = await Promise.all(SWEEP_UNIVERSE.map(sweepOneTicker));
  const hypothesesLogged = perTicker.reduce((sum, r) => sum + r.hypothesesLogged, 0);
  const errors = perTicker.flatMap((r) => r.errors);
  return { symbolsSwept: SWEEP_UNIVERSE.length, hypothesesLogged, errors };
}
