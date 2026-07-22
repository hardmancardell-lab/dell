import { getDailyBars } from "./daily-bars";
import { fetchMinuteBars } from "@/lib/data/market-data";
import {
  computeDayContext,
  groupCandlesByEasternDay,
  highLowInWindow,
  priceAtOrNearWindowEnd,
  priceAtOrNearWindowStart,
} from "./bar-aggregation";
import { buildTimeOfDayFrequency, WINDOWS } from "./time-windows";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type {
  CalendarDayOfWeekResult,
  CalendarTimeOfDayResult,
  DayContextFields,
  DayOfWeekEffectResult,
  DayOfWeekLabel,
  DayOfWeekTradeLogRow,
  SingleWeekdayResult,
  TimeOfDayEffectResult,
  TimeOfDayFrequency,
  TimeOfDayTradeLogRow,
} from "../types";

/**
 * Calendar-effect analytics — reuses historical-backtest.ts's exact
 * BH-FDR/bootstrap/time-split/three-bars statistical pipeline, just
 * segmented by weekday (runDayOfWeekBacktest) or intraday checkpoint
 * (runTimeOfDayBacktest) instead of forward-return horizon.
 */

const DAYS_OF_WEEK: DayOfWeekLabel[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FDR_ALPHA = 0.05;

/**
 * Parses a "YYYY-MM-DD" (already an Eastern calendar date — see
 * daily-bars.ts) into a weekday via an all-UTC round trip. Never
 * `new Date(dateKey).getDay()` — its local-timezone re-render can roll the
 * date depending on the server's TZ; constructing and reading back in UTC
 * only has no such dependency.
 */
function dayOfWeekFromDateKey(dateKey: string): DayOfWeekLabel | null {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const labels: (DayOfWeekLabel | null)[] = [null, "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", null];
  return labels[dow];
}

interface WeekdayOccurrence {
  dateKey: string;
  openPrice: number;
  closePrice: number;
  returnPct: number;
  overnightGapPct: number | null;
  dayHigh: number;
  dayLow: number;
}

export async function runDayOfWeekBacktest(ticker: string, lookbackYears: number): Promise<CalendarDayOfWeekResult> {
  const symbol = ticker.trim().toUpperCase();
  const lookbackDays = Math.round(lookbackYears * 365.25) + 30; // buffer for weekends/holidays, same as historical-backtest.ts
  const bars = await getDailyBars(symbol, lookbackDays);
  if (bars.length === 0) {
    throw new Error(`No daily bar data returned for ${symbol} — check the ticker is valid.`);
  }

  const byDay = new Map<DayOfWeekLabel, WeekdayOccurrence[]>(DAYS_OF_WEEK.map((d) => [d, []]));
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.open === 0) continue;
    const day = dayOfWeekFromDateKey(bar.dateKey);
    if (day === null) continue; // defensive — shouldn't occur for real trading-day data
    const priorClose = i > 0 ? bars[i - 1].close : null;
    const overnightGapPct = priorClose !== null && priorClose !== 0 ? ((bar.open - priorClose) / priorClose) * 100 : null;
    byDay.get(day)!.push({
      dateKey: bar.dateKey,
      openPrice: bar.open,
      closePrice: bar.close,
      returnPct: ((bar.close - bar.open) / bar.open) * 100,
      overnightGapPct,
      dayHigh: bar.high,
      dayLow: bar.low,
    });
  }

  const dataLimitations: string[] = [
    "Return metric is open-to-close (same-session), not prior-close-to-close — this deliberately excludes weekend/overnight gap moves from \"what happened during that weekday's session.\" A prior-close-to-close metric would answer a related but different question and isn't computed here. The trade log's overnightGapPct is reported separately as context, not folded into returnPct.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts) — the same documented approximation historical-backtest.ts uses.",
    "This backtest walks daily bars only, which carry no intraday timestamp — the trade log's day high/low and overnight gap % are real, but the time each high/low occurred isn't available here (dayHighTimeClock/dayLowTimeClock are always null).",
  ];

  const buckets = DAYS_OF_WEEK.map((day) => byDay.get(day)!.map((o) => o.returnPct));

  const rawPValues: (number | null)[] = buckets.map((values) => {
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });
  const validIndices = rawPValues.map((p, i) => (p !== null ? i : -1)).filter((i): i is number => i >= 0);
  const adjustedValid = benjaminiHochberg(validIndices.map((i) => rawPValues[i] as number));
  const fdrByIndex = new Map<number, number>();
  validIndices.forEach((i, k) => fdrByIndex.set(i, adjustedValid[k]));

  const days: DayOfWeekEffectResult[] = DAYS_OF_WEEK.map((day, i) => {
    const values = buckets[i]; // already chronological — daily bars sorted ascending by dateKey
    const splitIndex = Math.floor(values.length * 0.75);
    const trainValues = values.slice(0, splitIndex);
    const testValues = values.slice(splitIndex);

    const pValue = rawPValues[i];
    const pValueFdrAdjusted = fdrByIndex.get(i) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample =
      trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

    return {
      dayOfWeek: day,
      sampleSize: values.length,
      meanReturnPct: mean(values),
      medianReturnPct: median(values),
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

  const minSample = Math.min(...days.map((d) => d.sampleSize));
  if (minSample < 30) {
    dataLimitations.push(
      `At least one weekday bucket has fewer than 30 occurrences for ${symbol} over ${lookbackYears} year(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  const tradeLog: DayOfWeekTradeLogRow[] = DAYS_OF_WEEK.flatMap((day) =>
    byDay.get(day)!.map((o) => ({
      dateKey: o.dateKey,
      dayOfWeek: day,
      openPrice: o.openPrice,
      closePrice: o.closePrice,
      returnPct: o.returnPct,
      isWin: o.returnPct > 0,
      overnightGapPct: o.overnightGapPct,
      dayHigh: o.dayHigh,
      dayLow: o.dayLow,
      dayHighTimeClock: null,
      dayLowTimeClock: null,
    }))
  );

  return { ticker: symbol, lookbackYears, tradingDaysScanned: bars.length, days, tradeLog, dataLimitations };
}

interface TimeOfDayOccurrence {
  dateKey: string;
  windowStartPrice: number;
  windowEndPrice: number;
  returnPct: number;
  dayContext: DayContextFields;
}

const TIME_OF_DAY_CHECKPOINTS: { checkpoint: string; label: string; window: { start: number; end: number } }[] = [
  { checkpoint: "first15min", label: "First 15 Minutes", window: WINDOWS.FIRST_15_MIN },
  { checkpoint: "firstHour", label: "First Hour", window: WINDOWS.FIRST_HOUR },
  { checkpoint: "middayChop", label: "Midday", window: WINDOWS.MIDDAY_CHOP },
  { checkpoint: "powerHour", label: "Last Hour", window: WINDOWS.POWER_HOUR },
  { checkpoint: "last15min", label: "Last 15 Minutes", window: WINDOWS.LAST_15_MIN },
];

export async function runTimeOfDayBacktest(ticker: string, lookbackDays: number): Promise<CalendarTimeOfDayResult> {
  const symbol = ticker.trim().toUpperCase();
  const now = Date.now();
  const startMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const candles = await fetchMinuteBars(symbol, startMs, now, 60 * 30); // 30 min cache, same convention as daily-bars.ts
  if (candles.length === 0) {
    throw new Error(`No minute bar data returned for ${symbol} — check the ticker is valid.`);
  }
  const days = groupCandlesByEasternDay(candles);
  const dayContextByDateKey = new Map<string, DayContextFields>(
    days.map((day, i) => [day.dateKey, computeDayContext(day, i > 0 ? days[i - 1] : null)])
  );

  const dataLimitations: string[] = [
    "Days where a checkpoint window has no available bars (e.g. an early-close/holiday-shortened session, or a feed gap) are excluded from that checkpoint's sample rather than fabricated — no US market holiday calendar is integrated in this app, so this is a defensive fallback, not explicit holiday detection.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts).",
    "Minute-bar depth on this provider's free tier is unverified beyond what's been live-tested — see ALPACA_INTEGRATION_NOTES.md.",
  ];

  let skippedAny = false;
  const buckets: TimeOfDayOccurrence[][] = TIME_OF_DAY_CHECKPOINTS.map(({ window }) => {
    const occurrences: TimeOfDayOccurrence[] = [];
    for (const day of days) {
      const start = priceAtOrNearWindowStart(day.bars, window);
      const end = priceAtOrNearWindowEnd(day.bars, window);
      if (start === null || end === null || start === 0) {
        skippedAny = true;
        continue;
      }
      occurrences.push({
        dateKey: day.dateKey,
        dayContext: dayContextByDateKey.get(day.dateKey)!,
        windowStartPrice: start,
        windowEndPrice: end,
        returnPct: ((end - start) / start) * 100,
      });
    }
    return occurrences;
  });
  if (skippedAny) {
    dataLimitations.push("At least one trading day was skipped for at least one checkpoint due to missing bars in that window.");
  }

  const rawPValues: (number | null)[] = buckets.map((occs) => {
    const values = occs.map((o) => o.returnPct);
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });
  const validIndices = rawPValues.map((p, i) => (p !== null ? i : -1)).filter((i): i is number => i >= 0);
  const adjustedValid = benjaminiHochberg(validIndices.map((i) => rawPValues[i] as number));
  const fdrByIndex = new Map<number, number>();
  validIndices.forEach((i, k) => fdrByIndex.set(i, adjustedValid[k]));

  const checkpoints: TimeOfDayEffectResult[] = TIME_OF_DAY_CHECKPOINTS.map(({ checkpoint, label }, i) => {
    const values = buckets[i].map((o) => o.returnPct);
    const splitIndex = Math.floor(values.length * 0.75);
    const trainValues = values.slice(0, splitIndex);
    const testValues = values.slice(splitIndex);

    const pValue = rawPValues[i];
    const pValueFdrAdjusted = fdrByIndex.get(i) ?? null;
    const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
    const boot = bootstrapCi(values);
    const trainMean = mean(trainValues);
    const testMean = mean(testValues);
    const sameSignOutOfSample =
      trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
    const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
    const winLoss = computeWinLossMetrics(values);

    return {
      checkpoint,
      label,
      sampleSize: values.length,
      meanReturnPct: mean(values),
      medianReturnPct: median(values),
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

  const minSample = Math.min(...checkpoints.map((c) => c.sampleSize));
  if (minSample < 30) {
    dataLimitations.push(
      `At least one checkpoint has fewer than 30 occurrences for ${symbol} over ${lookbackDays} day(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  const tradeLog: TimeOfDayTradeLogRow[] = TIME_OF_DAY_CHECKPOINTS.flatMap(({ checkpoint }, i) =>
    buckets[i].map((o) => ({
      dateKey: o.dateKey,
      checkpoint,
      windowStartPrice: o.windowStartPrice,
      windowEndPrice: o.windowEndPrice,
      returnPct: o.returnPct,
      isWin: o.returnPct > 0,
      ...o.dayContext,
    }))
  );

  return { ticker: symbol, lookbackDays, tradingDaysScanned: days.length, checkpoints, tradeLog, dataLimitations };
}

/**
 * "Last N Fridays" instead of "last N years of all 5 weekdays" —
 * occurrence-count-based so a recent short-term catalyst can be excluded by
 * trimming the count rather than only having a blunt year-based lookback.
 * Also resolves real HOD/LOD timing (minute-bar-driven), which the
 * daily-bar-only runDayOfWeekBacktest can't: minute bars are only fetched
 * for the bounded calendar span covering the resolved occurrence dates, not
 * a continuous multi-year range, keeping it cheap.
 */
interface SingleWeekdayOccurrence {
  dateKey: string;
  openPrice: number;
  closePrice: number;
  returnPct: number;
}

export async function runSingleWeekdayBacktest(
  ticker: string,
  dayOfWeek: DayOfWeekLabel,
  occurrenceCount: number
): Promise<SingleWeekdayResult> {
  const symbol = ticker.trim().toUpperCase();
  const dataLimitations: string[] = [];

  // ~7 calendar days per trading week, +15% buffer for holidays/gaps.
  const calendarDaysNeeded = Math.ceil(occurrenceCount * 7 * 1.15);
  const bars = await getDailyBars(symbol, calendarDaysNeeded);
  if (bars.length === 0) {
    throw new Error(`No daily bar data returned for ${symbol} — check the ticker is valid.`);
  }

  const matches: SingleWeekdayOccurrence[] = [];
  for (const bar of bars) {
    if (bar.open === 0) continue;
    if (dayOfWeekFromDateKey(bar.dateKey) !== dayOfWeek) continue;
    matches.push({
      dateKey: bar.dateKey,
      openPrice: bar.open,
      closePrice: bar.close,
      returnPct: ((bar.close - bar.open) / bar.open) * 100,
    });
  }

  const occurrences = matches.slice(-occurrenceCount);
  if (occurrences.length === 0) {
    throw new Error(`No ${dayOfWeek} sessions found for ${symbol} in the available history.`);
  }
  if (occurrences.length < occurrenceCount) {
    dataLimitations.push(
      `Requested the last ${occurrenceCount} ${dayOfWeek}s but only ${occurrences.length} were found in the available daily-bar history for ${symbol}.`
    );
  }

  const values = occurrences.map((o) => o.returnPct);
  const splitIndex = Math.floor(values.length * 0.75);
  const trainValues = values.slice(0, splitIndex);
  const testValues = values.slice(splitIndex);

  const m = mean(values);
  const sd = stdDev(values);
  const pValue = m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  // Single bucket, single comparison — BH-FDR correction across one
  // p-value is the identity transform, unlike runDayOfWeekBacktest's 5-way case.
  const pValueFdrAdjusted = pValue;
  const significantAfterFdr = pValueFdrAdjusted !== null && pValueFdrAdjusted < FDR_ALPHA;
  const boot = bootstrapCi(values);
  const trainMean = mean(trainValues);
  const testMean = mean(testValues);
  const sameSignOutOfSample =
    trainMean !== null && testMean !== null ? Math.sign(trainMean) === Math.sign(testMean) : null;
  const passesAllThreeBars = significantAfterFdr && boot.ciExcludesZero && sameSignOutOfSample === true;
  const winLoss = computeWinLossMetrics(values);

  const effect: DayOfWeekEffectResult = {
    dayOfWeek,
    sampleSize: values.length,
    meanReturnPct: m,
    medianReturnPct: median(values),
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

  if (occurrences.length < 30) {
    dataLimitations.push(
      `Only ${occurrences.length} ${dayOfWeek} occurrence(s) found — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  // Minute bars only for the span covering these specific occurrence dates.
  const dayContextByDateKey = new Map<string, DayContextFields>();
  const lowMinutes: number[] = [];
  const highMinutes: number[] = [];
  try {
    const startMs = Date.parse(`${occurrences[0].dateKey}T00:00:00Z`);
    const now = Date.now();
    const minuteBars = await fetchMinuteBars(symbol, startMs, now, 60 * 30);
    const days = groupCandlesByEasternDay(minuteBars);
    const daysByDateKey = new Map(days.map((d) => [d.dateKey, d]));
    for (let i = 0; i < days.length; i++) {
      dayContextByDateKey.set(days[i].dateKey, computeDayContext(days[i], i > 0 ? days[i - 1] : null));
    }
    for (const o of occurrences) {
      const dayBars = daysByDateKey.get(o.dateKey);
      if (!dayBars) continue;
      const session = highLowInWindow(dayBars.bars, WINDOWS.REGULAR_SESSION);
      if (session.lowTime !== null) lowMinutes.push(session.lowTime);
      if (session.highTime !== null) highMinutes.push(session.highTime);
    }
    const covered = occurrences.filter((o) => dayContextByDateKey.has(o.dateKey)).length;
    if (covered < occurrences.length) {
      dataLimitations.push(
        `Minute-bar coverage was only available for ${covered} of ${occurrences.length} occurrence dates — high/low timing and overnight gap are based on that subset; returns and win/loss above are unaffected (daily-bar-based).`
      );
    }
  } catch (err) {
    dataLimitations.push(
      `Could not load minute-bar data for high/low-of-day timing: ${err instanceof Error ? err.message : "unknown error"}. Returns and win/loss above are still real (daily-bar-based) — only HOD/LOD timing and overnight-gap columns are affected.`
    );
  }

  const tradeLog: DayOfWeekTradeLogRow[] = occurrences.map((o) => {
    const ctx = dayContextByDateKey.get(o.dateKey) ?? null;
    return {
      dateKey: o.dateKey,
      dayOfWeek,
      openPrice: o.openPrice,
      closePrice: o.closePrice,
      returnPct: o.returnPct,
      isWin: o.returnPct > 0,
      overnightGapPct: ctx?.overnightGapPct ?? null,
      dayHigh: ctx?.dayHigh ?? null,
      dayLow: ctx?.dayLow ?? null,
      dayHighTimeClock: ctx?.dayHighTimeClock ?? null,
      dayLowTimeClock: ctx?.dayLowTimeClock ?? null,
    };
  });

  return {
    ticker: symbol,
    dayOfWeek,
    occurrencesRequested: occurrenceCount,
    effect,
    lowOfDayDistribution: buildTimeOfDayFrequency(lowMinutes, occurrences.length),
    highOfDayDistribution: buildTimeOfDayFrequency(highMinutes, occurrences.length),
    tradeLog,
    dataLimitations,
  };
}
