import { fetchBarsForTimeframe } from "@/lib/data/market-data";
import type { MarketCandle } from "@/lib/data/market-data-types";
import { groupCandlesByEasternDay } from "./bar-aggregation";
import { WINDOWS, isWithin, toEasternParts, formatMinutesAsClock } from "./time-windows";
import { vwapWithBands } from "./technical-indicators";
import { VWAP_REVERSION_STD_DEV_MULT } from "./vwap-mean-reversion";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type {
  VwapBacktestHorizonResult,
  VwapBacktestSignalType,
  VwapReversionBacktestResult,
  VwapReversionStats,
  VwapTradeLogRow,
} from "../types";

/**
 * Real historical backtest for the session-VWAP mean-reversion signal —
 * the intraday counterpart to historical-backtest.ts's runBacktest, same
 * statistical rigor (BH-FDR correction, bootstrap CIs, time-based
 * out-of-sample split) ported to bar-indexed instead of day-indexed
 * occurrences. See types.ts's VWAP Mean Reversion Backtest section for why
 * this is a separate engine rather than folded into the daily one.
 */

// 5-min bars: 15/30/60/120 minutes ahead.
const HORIZON_BARS = [3, 6, 12, 24];
const HORIZON_LABELS = ["15 min", "30 min", "60 min", "120 min"];
const FDR_ALPHA = 0.05;
const DEFAULT_LOOKBACK_DAYS = 90;
const MAX_LOOKBACK_DAYS = 180; // real constraint: 5-min bars over years of history is an impractical fetch/scan volume
const MIN_LOOKBACK_DAYS = 5;
// Bars before a session's own VWAP/bands are considered stable enough to
// evaluate — the first few bars of a session have almost no volume behind
// the running variance, so the bands sit unrealistically tight around price
// and would fire spurious signals right at the open.
const SIGNAL_WARMUP_BARS = 6;
const MIN_SESSION_BARS = SIGNAL_WARMUP_BARS + 6; // skip holiday-shortened/half-days too thin to evaluate

const STRATEGY_DIRECTION: Record<"oversold" | "overbought", "long" | "short"> = {
  oversold: "long",
  overbought: "short",
};

function toStrategyReturnPct(rawReturnPct: number, direction: "long" | "short"): number {
  return direction === "short" ? -rawReturnPct : rawReturnPct;
}

interface VwapOccurrence {
  dateKey: string;
  entryTimeClock: string;
  entryPrice: number;
  entryDeviationPct: number;
  forwardReturns: (number | null)[]; // indexed same as HORIZON_BARS
  barsToRevert: number | null;
  maxAdverseExcursionPct: number | null;
}

/**
 * Walks one session's regular-hours bars looking for `direction` occurrences
 * — the first bar whose close crosses the VWAP band, not yet already inside
 * a tracked excursion. Once found, walks forward within the SAME session
 * (VWAP resets next session, so "reversion" stops meaning anything past the
 * close) for both the reversion point and the fixed-bar-ahead forward
 * returns, then resumes scanning after that reversion (or stops for the day
 * if it never reverted) — so a session can contribute more than one
 * occurrence if price reverts and re-extends.
 */
function findSessionOccurrences(regularBars: MarketCandle[], dateKey: string, direction: "oversold" | "overbought"): VwapOccurrence[] {
  if (regularBars.length < MIN_SESSION_BARS) return [];

  const { vwap, upper, lower } = vwapWithBands(regularBars, VWAP_REVERSION_STD_DEV_MULT);
  const occurrences: VwapOccurrence[] = [];
  let i = SIGNAL_WARMUP_BARS;

  while (i < regularBars.length) {
    const v = vwap[i];
    const u = upper[i];
    const l = lower[i];
    if (v === null || u === null || l === null) {
      i++;
      continue;
    }

    const close = regularBars[i].close;
    const fires = direction === "oversold" ? close <= l : close >= u;
    if (!fires) {
      i++;
      continue;
    }

    const entryPrice = close;
    const entryDeviationPct = v !== 0 ? ((entryPrice - v) / v) * 100 : 0;
    const entryTimeClock = formatMinutesAsClock(toEasternParts(regularBars[i].datetime).minutesSinceMidnight);

    let barsToRevert: number | null = null;
    let worstExcursionPct: number | null = null;
    for (let j = i + 1; j < regularBars.length; j++) {
      const vj = vwap[j];
      if (vj === null || vj === 0) continue;
      const closeJ = regularBars[j].close;
      const excursionPct = ((closeJ - vj) / vj) * 100;
      if (direction === "oversold") {
        if (worstExcursionPct === null || excursionPct < worstExcursionPct) worstExcursionPct = excursionPct;
        if (closeJ >= vj) {
          barsToRevert = j - i;
          break;
        }
      } else {
        if (worstExcursionPct === null || excursionPct > worstExcursionPct) worstExcursionPct = excursionPct;
        if (closeJ <= vj) {
          barsToRevert = j - i;
          break;
        }
      }
    }

    const forwardReturns = HORIZON_BARS.map((h) => {
      const idx = i + h;
      if (idx >= regularBars.length) return null;
      return ((regularBars[idx].close - entryPrice) / entryPrice) * 100;
    });

    occurrences.push({
      dateKey,
      entryTimeClock,
      entryPrice,
      entryDeviationPct,
      forwardReturns,
      barsToRevert,
      maxAdverseExcursionPct: worstExcursionPct,
    });

    i = barsToRevert !== null ? i + barsToRevert + 1 : regularBars.length;
  }

  return occurrences;
}

function buildReversionStats(occurrences: VwapOccurrence[]): VwapReversionStats | null {
  if (occurrences.length === 0) return null;

  const reverted = occurrences.filter((o) => o.barsToRevert !== null);
  const revertedBars = reverted.map((o) => o.barsToRevert as number);
  const excursions = occurrences.map((o) => o.maxAdverseExcursionPct).filter((v): v is number => v !== null);
  const worst =
    excursions.length === 0
      ? null
      : excursions.reduce((worstSoFar, v) => (Math.abs(v) > Math.abs(worstSoFar) ? v : worstSoFar), excursions[0]);

  return {
    occurrencesTracked: occurrences.length,
    occurrencesReverted: reverted.length,
    occurrencesNeverReverted: occurrences.length - reverted.length,
    meanBarsToRevert: mean(revertedBars),
    medianBarsToRevert: median(revertedBars),
    avgMaxAdverseExcursionPct: mean(excursions),
    worstMaxAdverseExcursionPct: worst,
  };
}

export async function runVwapReversionBacktest(
  ticker: string,
  signalType: VwapBacktestSignalType,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<VwapReversionBacktestResult> {
  const symbol = ticker.trim().toUpperCase();
  const days = Math.min(Math.max(Math.round(lookbackDays), MIN_LOOKBACK_DAYS), MAX_LOOKBACK_DAYS);
  const direction: "oversold" | "overbought" = signalType === "vwapMeanReversionOversold" ? "oversold" : "overbought";
  const strategyDirection = STRATEGY_DIRECTION[direction];

  const now = Date.now();
  const startMs = now - days * 24 * 60 * 60 * 1000;
  const candles = await fetchBarsForTimeframe(symbol, "5Min", startMs, now, 60 * 15); // 15-min cache

  const sessions = groupCandlesByEasternDay(candles);

  const occurrences: VwapOccurrence[] = [];
  let sessionsScanned = 0;
  for (const session of sessions) {
    const regularBars = session.bars.filter((b) => isWithin(toEasternParts(b.datetime).minutesSinceMidnight, WINDOWS.REGULAR_SESSION));
    if (regularBars.length < MIN_SESSION_BARS) continue;
    sessionsScanned++;
    occurrences.push(...findSessionOccurrences(regularBars, session.dateKey, direction));
  }

  const dataLimitations: string[] = [
    "Session-bound: forward returns and reversion tracking never cross a session boundary, since VWAP resets each session — an occurrence that hasn't reverted by the close is scored as 'not reverted', even if price would have crossed VWAP a few minutes into the next session.",
    "5-min bars only, regular session (9:30am-4:00pm ET) — extended-hours bars are excluded so thin premarket/afterhours volume can't distort the VWAP bands.",
    `The first ${SIGNAL_WARMUP_BARS} bars of every session are skipped before evaluating a signal — with almost no volume behind the running VWAP variance that early, the bands sit unrealistically tight and would fire spurious signals right at the open.`,
    "Overlapping forward-return windows: if this signal re-fires later the same session (price reverts, then re-extends), those windows can overlap, introducing autocorrelation the significance tests below don't account for — same caveat historical-backtest.ts documents for its own daily occurrences.",
    "Significance uses a z-test approximation, not an exact Student's t-test — the difference is small at larger sample sizes and grows for small samples.",
  ];

  const splitIndex = Math.floor(occurrences.length * 0.75);
  const trainOccurrences = occurrences.slice(0, splitIndex);
  const testOccurrences = occurrences.slice(splitIndex);

  const rawPValues: (number | null)[] = HORIZON_BARS.map((_, h) => {
    const values = occurrences.map((o) => o.forwardReturns[h]).filter((v): v is number => v !== null);
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });

  const validHorizonIndices = rawPValues.map((p, h) => (p !== null ? h : -1)).filter((h): h is number => h >= 0);
  const adjustedValid = benjaminiHochberg(validHorizonIndices.map((h) => rawPValues[h] as number));
  const fdrByHorizonIndex = new Map<number, number>();
  validHorizonIndices.forEach((h, k) => fdrByHorizonIndex.set(h, adjustedValid[k]));

  const horizons: VwapBacktestHorizonResult[] = HORIZON_BARS.map((horizonBars, h) => {
    const values = occurrences
      .map((o) => o.forwardReturns[h])
      .filter((v): v is number => v !== null)
      .map((v) => toStrategyReturnPct(v, strategyDirection));
    const trainValues = trainOccurrences
      .map((o) => o.forwardReturns[h])
      .filter((v): v is number => v !== null)
      .map((v) => toStrategyReturnPct(v, strategyDirection));
    const testValues = testOccurrences
      .map((o) => o.forwardReturns[h])
      .filter((v): v is number => v !== null)
      .map((v) => toStrategyReturnPct(v, strategyDirection));

    const pValue = rawPValues[h];
    const pValueFdrAdjusted = fdrByHorizonIndex.get(h) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;

    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample = trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

    return {
      horizonBars,
      horizonLabel: HORIZON_LABELS[h],
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
      `Only ${occurrences.length} historical occurrence(s) of this signal found for ${symbol} over ${days} day(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  const reversionStats = buildReversionStats(occurrences);

  const tradeLog: VwapTradeLogRow[] = occurrences.map((o) => {
    const returnsByHorizon = HORIZON_BARS.map((horizonBars, h) => ({ horizonLabel: HORIZON_LABELS[h], returnPct: o.forwardReturns[h] }));
    const lastNonNull = [...o.forwardReturns].reverse().find((v) => v !== null) ?? null;
    return {
      dateKey: o.dateKey,
      entryTimeClock: o.entryTimeClock,
      entryPrice: o.entryPrice,
      entryDeviationPct: o.entryDeviationPct,
      returnsByHorizon,
      isWin: lastNonNull !== null ? toStrategyReturnPct(lastNonNull, strategyDirection) > 0 : null,
      barsToRevert: o.barsToRevert,
      maxAdverseExcursionPct: o.maxAdverseExcursionPct,
    };
  });

  return {
    ticker: symbol,
    signalType,
    lookbackDays: days,
    sessionsScanned,
    signalOccurrences: occurrences.length,
    horizons,
    reversionStats,
    tradeLog,
    dataLimitations,
  };
}
