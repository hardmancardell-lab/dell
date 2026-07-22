import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { buildReversionStats, computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type {
  BacktestHorizonResult,
  DailyBar,
  DaysToRevertBucket,
  EquityBacktestResult,
  EquityBacktestSignalType,
  EquityTradeLogRow,
  ReversionStats,
} from "../types";

/**
 * Real historical backtesting — unlike the options GEX signal (blocked on
 * missing historical open interest, see paper-backtest-log.ts), equities has
 * no data blocker: Alpaca supplies real daily bars going back years. This
 * walks that history day-by-day, computing each signal using only data
 * available as of that day (no lookahead), then measures what actually
 * happened at several forward horizons — with the same statistical rigor
 * options-signals-project/backtest_engine.py established (BH-FDR correction,
 * bootstrap CIs, time-based out-of-sample split), ported to TypeScript.
 */

const HORIZONS_TRADING_DAYS = [1, 3, 5, 10, 20];
const MIN_LOOKBACK_BARS = 21; // enough for the 20-day windows both Volume Displacement and Mean Reversion need
const FDR_ALPHA = 0.05;
const MAX_REVERSION_TRACKING_DAYS = 60; // ~3 months — how far forward to walk looking for a reversion before giving up

function signalFired(barsSoFar: DailyBar[], signalType: EquityBacktestSignalType): boolean {
  switch (signalType) {
    case "volumeDisplacement":
      return computeVolumeDisplacement(barsSoFar).triggered;
    case "momentum":
      return computeMomentum(barsSoFar).triggered;
    case "meanReversionOversold":
      return computeMeanReversion(barsSoFar).direction === "oversold";
    case "meanReversionOverbought":
      return computeMeanReversion(barsSoFar).direction === "overbought";
  }
}

interface Occurrence {
  dateKey: string;
  entryClose: number;
  forwardReturns: (number | null)[]; // indexed same as HORIZONS_TRADING_DAYS
  overnightGapPct: number | null;
  dayHigh: number;
  dayLow: number;
  daysToRevert: number | null;
  maxAdverseExcursionPct: number | null;
}

/**
 * Walks forward from a mean-reversion signal day, recomputing the rolling
 * mean fresh each day (no lookahead — same trailing-window convention
 * computeMeanReversion always uses) rather than holding the signal-day mean
 * fixed, since the mean itself keeps sliding forward as new days arrive.
 * Tracks the worst further move away from that day's mean (the risk side —
 * "how much further" before it turns around) and the first day price closes
 * back at/past the mean ("reverted").
 */
function trackReversion(
  bars: DailyBar[],
  signalIndex: number,
  direction: "oversold" | "overbought"
): { daysToRevert: number | null; maxAdverseExcursionPct: number | null } {
  let worstExcursionPct: number | null = null;
  const trackEnd = Math.min(bars.length - 1, signalIndex + MAX_REVERSION_TRACKING_DAYS);

  for (let j = signalIndex + 1; j <= trackEnd; j++) {
    // Only the trailing MEAN_REVERSION_LOOKBACK_DAYS(20) closes before day j
    // matter to computeMeanReversion — a small fixed-size slice instead of
    // bars.slice(0, j+1) avoids an O(j) copy on every one of these calls.
    const window = bars.slice(Math.max(0, j - 25), j + 1);
    const { rollingMean } = computeMeanReversion(window);
    if (rollingMean === null || rollingMean === 0) continue;

    const close = bars[j].close;
    const excursionPct = ((close - rollingMean) / rollingMean) * 100;
    if (direction === "oversold") {
      if (worstExcursionPct === null || excursionPct < worstExcursionPct) worstExcursionPct = excursionPct;
      if (close >= rollingMean) return { daysToRevert: j - signalIndex, maxAdverseExcursionPct: worstExcursionPct };
    } else {
      if (worstExcursionPct === null || excursionPct > worstExcursionPct) worstExcursionPct = excursionPct;
      if (close <= rollingMean) return { daysToRevert: j - signalIndex, maxAdverseExcursionPct: worstExcursionPct };
    }
  }

  return { daysToRevert: null, maxAdverseExcursionPct: worstExcursionPct };
}

export async function runBacktest(
  ticker: string,
  signalType: EquityBacktestSignalType,
  lookbackYears: number
): Promise<EquityBacktestResult> {
  const symbol = ticker.trim().toUpperCase();
  const lookbackDays = Math.round(lookbackYears * 365.25) + 30; // buffer for weekends/holidays
  const bars = await getDailyBars(symbol, lookbackDays);

  const isMeanReversionSignal = signalType === "meanReversionOversold" || signalType === "meanReversionOverbought";

  const occurrences: Occurrence[] = [];
  for (let i = MIN_LOOKBACK_BARS; i < bars.length - 1; i++) {
    const barsSoFar = bars.slice(0, i + 1); // only data available as of day i — no lookahead
    if (!signalFired(barsSoFar, signalType)) continue;

    const entryClose = bars[i].close;
    const forwardReturns = HORIZONS_TRADING_DAYS.map((h) => {
      const futureIndex = i + h;
      if (futureIndex >= bars.length) return null;
      return ((bars[futureIndex].close - entryClose) / entryClose) * 100;
    });
    const priorClose = bars[i - 1].close;
    const overnightGapPct = priorClose !== 0 ? ((bars[i].open - priorClose) / priorClose) * 100 : null;
    const reversion = isMeanReversionSignal
      ? trackReversion(bars, i, signalType === "meanReversionOversold" ? "oversold" : "overbought")
      : { daysToRevert: null, maxAdverseExcursionPct: null };
    occurrences.push({
      dateKey: bars[i].dateKey,
      entryClose,
      forwardReturns,
      overnightGapPct,
      dayHigh: bars[i].high,
      dayLow: bars[i].low,
      daysToRevert: reversion.daysToRevert,
      maxAdverseExcursionPct: reversion.maxAdverseExcursionPct,
    });
  }

  const dataLimitations: string[] = [
    "Overlapping forward-return windows: if this signal fires on consecutive days, their forward-return periods overlap, introducing autocorrelation the significance tests below don't account for — same category of caveat options-signals-project/backtest_engine.py's README documents for its own data.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts) — the difference is small at the larger sample sizes a multi-year daily backtest typically produces, and grows for small samples.",
    "This backtest walks daily bars only, which carry no intraday timestamp — the trade log's day high/low and overnight gap % are real, but the time each high/low occurred isn't available here (dayHighTimeClock/dayLowTimeClock are always null). Getting that would require a separate minute-bar fetch per occurrence; see the ORB and Calendar Effects Time-of-Day backtests, which already pull minute bars and report it.",
  ];

  // Time-based split on occurrences (not raw calendar days) — matches
  // backtest_engine.py's reasoning: nearby occurrences are correlated, so a
  // random split would leak information a real out-of-sample test shouldn't have.
  const splitIndex = Math.floor(occurrences.length * 0.75);
  const trainOccurrences = occurrences.slice(0, splitIndex);
  const testOccurrences = occurrences.slice(splitIndex);

  const rawPValues: (number | null)[] = HORIZONS_TRADING_DAYS.map((_, h) => {
    const values = occurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });

  // BH-FDR correction across the horizons that actually produced a p-value —
  // same multiple-comparisons reasoning backtest_engine.py applies across
  // its 4 labels x 5 days, here across this signal's 5 horizons.
  const validHorizonIndices = rawPValues
    .map((p, h) => (p !== null ? h : -1))
    .filter((h): h is number => h >= 0);
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

    // Minimum bar before treating this as a real edge, per
    // options-signals-project/README.md: "passes FDR correction in-sample
    // AND holds same sign out-of-sample AND bootstrap CI excludes zero —
    // all three, not one."
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

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

  if (occurrences.length < 30) {
    dataLimitations.push(
      `Only ${occurrences.length} historical occurrence(s) of this signal found for ${symbol} over ${lookbackYears} year(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  const reversionStats = isMeanReversionSignal
    ? buildReversionStats(
        occurrences.map((o) => ({ daysToRevert: o.daysToRevert, maxAdverseExcursionPct: o.maxAdverseExcursionPct })),
        signalType === "meanReversionOversold" ? "min" : "max",
        MAX_REVERSION_TRACKING_DAYS
      )
    : null;
  if (reversionStats) {
    dataLimitations.push(
      `Reversion timing tracks up to ${MAX_REVERSION_TRACKING_DAYS} trading days after each signal fires, recomputing the rolling mean fresh each day (no lookahead) rather than holding the signal-day mean fixed — the mean itself keeps sliding as new days arrive. Occurrences within the last ${MAX_REVERSION_TRACKING_DAYS} trading days of available data may be cut short by running out of bars before reverting, showing up as "not reverted" even if it would have reverted given more time.`
    );
  }

  // Exit prices are intentionally not stored — algebraically recoverable as
  // entryClose * (1 + returnPct/100) if ever needed, avoiding a redundant field.
  const tradeLog: EquityTradeLogRow[] = occurrences.map((o) => {
    const returnsByHorizon = HORIZONS_TRADING_DAYS.map((horizonDays, h) => ({ horizonDays, returnPct: o.forwardReturns[h] }));
    const lastNonNull = [...o.forwardReturns].reverse().find((v) => v !== null) ?? null;
    return {
      dateKey: o.dateKey,
      entryClose: o.entryClose,
      returnsByHorizon,
      isWin: lastNonNull !== null ? lastNonNull > 0 : null,
      overnightGapPct: o.overnightGapPct,
      dayHigh: o.dayHigh,
      dayLow: o.dayLow,
      dayHighTimeClock: null,
      dayLowTimeClock: null,
      daysToRevert: o.daysToRevert,
      maxAdverseExcursionPct: o.maxAdverseExcursionPct,
    };
  });

  return {
    ticker: symbol,
    signalType,
    lookbackYears,
    tradingDaysScanned: bars.length,
    signalOccurrences: occurrences.length,
    horizons,
    reversionStats,
    tradeLog,
    dataLimitations,
  };
}
