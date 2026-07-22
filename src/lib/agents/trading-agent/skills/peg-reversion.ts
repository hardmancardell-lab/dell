import { getDailyBars } from "./daily-bars";
import { fetchQuote } from "@/lib/data/market-data";
import { getCurrencyPeg } from "./currency-pegs";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { buildReversionStats, computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type {
  BacktestHorizonResult,
  CurrencyPeg,
  DailyBar,
  PegDeviationSnapshot,
  PegReversionDirection,
  PegReversionDirectionResult,
  PegReversionResult,
  PegReversionTradeLogRow,
} from "../types";

/**
 * Its own strategy, distinct from mean-reversion.ts's rolling-mean version:
 * the "mean" here is a real, officially-announced peg rate (fixed or
 * band-centered), not a statistically-estimated rolling average. Mirrors
 * historical-backtest.ts's exact statistical pipeline (BH-FDR, bootstrap CI,
 * time-based OOS split, three-bars gate) via the shared helpers in
 * stats.ts/stats-tests.ts, so this gets the same rigor without duplicating
 * the math — only the signal-firing and reversion-target logic differ,
 * since the anchor here is fixed rather than sliding.
 */

const HORIZONS_TRADING_DAYS = [1, 3, 5, 10, 20];
const FDR_ALPHA = 0.05;
const MAX_REVERSION_TRACKING_DAYS = 60;
// Only used for hard-fixed pegs with no official band — a chosen parameter,
// not an official rule (unlike band pegs, where "outside the band" IS the
// real, officially-defended trigger).
export const DEFAULT_PEG_DEVIATION_THRESHOLD_PCT = 0.1;

function pegTargetRate(peg: CurrencyPeg): number {
  if (peg.bandLowerBound !== null && peg.bandUpperBound !== null) {
    return (peg.bandLowerBound + peg.bandUpperBound) / 2;
  }
  return peg.targetRate;
}

export async function getPegDeviationSnapshot(pair: string): Promise<PegDeviationSnapshot> {
  const peg = getCurrencyPeg(pair);
  if (!peg) throw new Error(`No documented peg found for "${pair}". See the Currency Pegs tab for the full registry.`);
  if (!peg.liveDataAvailable) {
    throw new Error(
      `"${pair}" is a real, documented peg, but this app has no live spot-price feed for it (OANDA doesn't quote this instrument, or returns no data) — see currency-pegs.ts.`
    );
  }
  const quote = await fetchQuote(pair);
  const target = pegTargetRate(peg);
  const deviationPct = ((quote.lastPrice - target) / target) * 100;
  const outsideBand =
    peg.bandLowerBound !== null && peg.bandUpperBound !== null
      ? quote.lastPrice < peg.bandLowerBound || quote.lastPrice > peg.bandUpperBound
      : null;
  return {
    pair: peg.pair,
    currentRate: quote.lastPrice,
    asOfDate: new Date().toISOString().slice(0, 10),
    targetRate: target,
    deviationPct,
    outsideBand,
  };
}

function signalFired(rate: number, peg: CurrencyPeg, direction: PegReversionDirection, thresholdPct: number): boolean {
  if (peg.bandLowerBound !== null && peg.bandUpperBound !== null) {
    return direction === "aboveTarget" ? rate > peg.bandUpperBound : rate < peg.bandLowerBound;
  }
  const deviationPct = ((rate - peg.targetRate) / peg.targetRate) * 100;
  return direction === "aboveTarget" ? deviationPct >= thresholdPct : deviationPct <= -thresholdPct;
}

/**
 * Simpler than historical-backtest.ts's trackReversion: the target here is
 * fixed (or a fixed band center), so it never needs recomputing day-by-day
 * the way a rolling mean does.
 */
function trackPegReversion(
  bars: DailyBar[],
  signalIndex: number,
  target: number,
  direction: PegReversionDirection
): { daysToRevert: number | null; maxAdverseExcursionPct: number | null } {
  let worst: number | null = null;
  const trackEnd = Math.min(bars.length - 1, signalIndex + MAX_REVERSION_TRACKING_DAYS);
  for (let j = signalIndex + 1; j <= trackEnd; j++) {
    const close = bars[j].close;
    const dev = ((close - target) / target) * 100;
    if (direction === "aboveTarget") {
      if (worst === null || dev > worst) worst = dev;
      if (close <= target) return { daysToRevert: j - signalIndex, maxAdverseExcursionPct: worst };
    } else {
      if (worst === null || dev < worst) worst = dev;
      if (close >= target) return { daysToRevert: j - signalIndex, maxAdverseExcursionPct: worst };
    }
  }
  return { daysToRevert: null, maxAdverseExcursionPct: worst };
}

interface PegOccurrence {
  dateKey: string;
  entryClose: number;
  deviationPctAtEntry: number;
  forwardReturns: (number | null)[];
  daysToRevert: number | null;
  maxAdverseExcursionPct: number | null;
}

function runOneDirection(
  bars: DailyBar[],
  peg: CurrencyPeg,
  direction: PegReversionDirection,
  thresholdPct: number
): { occurrences: PegOccurrence[]; result: PegReversionDirectionResult } {
  const target = pegTargetRate(peg);
  const occurrences: PegOccurrence[] = [];

  for (let i = 0; i < bars.length - 1; i++) {
    const rate = bars[i].close;
    if (!signalFired(rate, peg, direction, thresholdPct)) continue;

    const entryClose = rate;
    const forwardReturns = HORIZONS_TRADING_DAYS.map((h) => {
      const futureIndex = i + h;
      if (futureIndex >= bars.length) return null;
      return ((bars[futureIndex].close - entryClose) / entryClose) * 100;
    });
    const reversion = trackPegReversion(bars, i, target, direction);
    occurrences.push({
      dateKey: bars[i].dateKey,
      entryClose,
      deviationPctAtEntry: ((rate - target) / target) * 100,
      forwardReturns,
      daysToRevert: reversion.daysToRevert,
      maxAdverseExcursionPct: reversion.maxAdverseExcursionPct,
    });
  }

  const splitIndex = Math.floor(occurrences.length * 0.75);
  const trainOccurrences = occurrences.slice(0, splitIndex);
  const testOccurrences = occurrences.slice(splitIndex);

  const rawPValues: (number | null)[] = HORIZONS_TRADING_DAYS.map((_, h) => {
    const values = occurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });

  const validHorizonIndices = rawPValues.map((p, h) => (p !== null ? h : -1)).filter((h): h is number => h >= 0);
  const adjustedValid = benjaminiHochberg(validHorizonIndices.map((h) => rawPValues[h] as number));
  const fdrByHorizonIndex = new Map<number, number>();
  validHorizonIndices.forEach((h, k) => fdrByHorizonIndex.set(h, adjustedValid[k]));

  const horizons: BacktestHorizonResult[] = HORIZONS_TRADING_DAYS.map((horizonDays, h) => {
    const values = occurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);
    const trainValues = trainOccurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);
    const testValues = testOccurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);

    const pValue = rawPValues[h];
    const pValueFdrAdjusted = fdrByHorizonIndex.get(h) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample =
      trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    // computeWinLossMetrics treats a positive return as a "win" — correct
    // for a below-target signal (expects price to rise) but backwards for
    // an above-target signal (expects price to fall back toward the peg),
    // where a real win is a NEGATIVE forward return. Feed it the negated
    // series for "aboveTarget" so win rate / profit factor / avg win-loss
    // reflect this strategy's actual directional thesis, not raw price
    // direction. meanForwardReturnPct/medianForwardReturnPct above are
    // computed from the real, un-negated `values` and stay correctly signed.
    const winLoss = computeWinLossMetrics(direction === "aboveTarget" ? values.map((v) => -v) : values);

    return {
      horizonDays,
      sampleSize: values.length,
      meanForwardReturnPct: mean(values),
      medianForwardReturnPct: median(values),
      pValue,
      pValueFdrAdjusted,
      significantAfterFdr,
      bootstrapCiLower: boot.lower,
      bootstrapCiUpper: boot.upper,
      ciExcludesZero: boot.ciExcludesZero,
      trainMeanReturnPct: trainMean,
      testMeanReturnPct: testMean,
      sameSignOutOfSample,
      passesAllThreeBars,
      ...winLoss,
    };
  });

  const reversionStats = buildReversionStats(
    occurrences.map((o) => ({ daysToRevert: o.daysToRevert, maxAdverseExcursionPct: o.maxAdverseExcursionPct })),
    direction === "aboveTarget" ? "max" : "min",
    MAX_REVERSION_TRACKING_DAYS
  );

  // Unlike historical-backtest.ts's isWin (raw "did price go up"), a peg-
  // reversion trade's win condition is direction-aware: an above-target
  // signal expects reversion DOWN (win = negative forward return), a
  // below-target signal expects reversion UP (win = positive forward
  // return) — this is a real strategy with a stated directional thesis, not
  // a neutral price-direction measurement.
  const tradeLog: PegReversionTradeLogRow[] = occurrences.map((o) => {
    const returnsByHorizon = HORIZONS_TRADING_DAYS.map((horizonDays, h) => ({ horizonDays, returnPct: o.forwardReturns[h] }));
    const lastNonNull = [...o.forwardReturns].reverse().find((v) => v !== null) ?? null;
    const isWin =
      lastNonNull === null ? null : direction === "aboveTarget" ? lastNonNull < 0 : lastNonNull > 0;
    return {
      dateKey: o.dateKey,
      entryClose: o.entryClose,
      deviationPctAtEntry: o.deviationPctAtEntry,
      returnsByHorizon,
      isWin,
      daysToRevert: o.daysToRevert,
      maxAdverseExcursionPct: o.maxAdverseExcursionPct,
    };
  });

  return { occurrences, result: { signalOccurrences: occurrences.length, horizons, reversionStats, tradeLog } };
}

export async function runPegReversionBacktest(
  pair: string,
  lookbackYears: number,
  deviationThresholdPct: number = DEFAULT_PEG_DEVIATION_THRESHOLD_PCT
): Promise<PegReversionResult> {
  const peg = getCurrencyPeg(pair);
  if (!peg) throw new Error(`No documented peg found for "${pair}". See the Currency Pegs tab for the full registry.`);
  if (!peg.liveDataAvailable) {
    throw new Error(
      `"${pair}" is a real, documented peg, but this app has no live price-history feed for it — OANDA doesn't quote this instrument (or returns no candle data). See the Currency Pegs tab for the full registry and why.`
    );
  }

  const lookbackDays = Math.round(lookbackYears * 365.25) + 30;
  const bars = await getDailyBars(pair, lookbackDays);

  const aboveRun = runOneDirection(bars, peg, "aboveTarget", deviationThresholdPct);
  const belowRun = runOneDirection(bars, peg, "belowTarget", deviationThresholdPct);

  const dataLimitations: string[] = [
    "Overlapping forward-return windows: if the deviation signal fires on consecutive days, their forward-return periods overlap, introducing autocorrelation the significance tests don't account for — same caveat as every other backtest engine in this app.",
    "Significance uses a z-test approximation, not an exact Student's t-test — small difference at larger sample sizes, grows for small samples.",
    peg.pegType === "band"
      ? `Signal triggers when price moves outside the official ${peg.bandLowerBound}-${peg.bandUpperBound} band — a real, officially-defended trigger, not a chosen parameter.`
      : `This peg has no official trading band — the signal triggers at a ${deviationThresholdPct}% deviation from the fixed target, a chosen parameter, not an official rule.`,
  ];
  if (aboveRun.occurrences.length < 30) {
    dataLimitations.push(
      `Only ${aboveRun.occurrences.length} above-target occurrence(s) found over ${lookbackYears} year(s) — treat as directional only (n<30).`
    );
  }
  if (belowRun.occurrences.length < 30) {
    dataLimitations.push(
      `Only ${belowRun.occurrences.length} below-target occurrence(s) found over ${lookbackYears} year(s) — treat as directional only (n<30).`
    );
  }

  return {
    pair: peg.pair,
    peg,
    lookbackYears,
    deviationThresholdPct,
    tradingDaysScanned: bars.length,
    aboveTarget: aboveRun.result,
    belowTarget: belowRun.result,
    dataLimitations,
  };
}
