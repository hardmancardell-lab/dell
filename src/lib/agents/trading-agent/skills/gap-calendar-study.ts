import { fetchDailyBars, fetchMinuteBars } from "@/lib/data/market-data";
import type { MarketCandle } from "@/lib/data/market-data-types";
import {
  groupCandlesByEasternDay,
  highLowInWindow,
  priceAtOrAfterMinute,
  priceAtOrNearWindowEnd,
  priceAtOrNearWindowStart,
  type DayBars,
} from "./bar-aggregation";
import {
  WINDOWS,
  buildTimeOfDayFrequency,
  formatMinutesAsClock,
  toEasternParts,
} from "./time-windows";
import { mean, median, stdDev } from "../stats";
import { getFedRateRegimeTimeline, classifyRegimeForDate } from "./macro-regime";
import type { FedRateRegime } from "./macro-regime";

/**
 * Shared fetch helper for all three studies below — splits an arbitrary date
 * range into <=30-calendar-day chunks (each safely under Alpaca's ~200k-bar/
 * 20-page pagination ceiling in alpaca.ts, so nothing silently truncates on a
 * long lookback) and fetches them in parallel, then merges + sorts + dedupes
 * by timestamp.
 */
async function fetchMinuteBarsChunked(
  ticker: string,
  startMs: number,
  endMs: number,
  chunkDays = 30
): Promise<MarketCandle[]> {
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  const windows: { s: number; e: number }[] = [];
  for (let s = startMs; s < endMs; s += chunkMs) {
    windows.push({ s, e: Math.min(s + chunkMs, endMs) });
  }
  const chunks = await Promise.all(
    windows.map((w) => fetchMinuteBars(ticker, w.s, w.e, 60 * 60 * 6))
  );
  const byTimestamp = new Map<number, MarketCandle>();
  for (const c of chunks.flat()) byTimestamp.set(c.datetime, c);
  return Array.from(byTimestamp.values()).sort((a, b) => a.datetime - b.datetime);
}

const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(dateKey: string): number {
  // Noon UTC avoids any DST/timezone edge nudging the date across midnight —
  // dateKey is already an ET calendar date, so day-of-week is timezone-safe here.
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

const DATA_SOURCE_LIMITATION =
  "Minute bars come from Alpaca's free-tier IEX feed (single-exchange, not the consolidated tape) — thinnest in premarket, so isolated prints can occasionally look disconnected from the instrument's real full-tape price on low-liquidity days.";

// ---------------------------------------------------------------------------
// 1. Weekday HOD/LOD timing study (e.g. "last 50 Tuesdays")
// ---------------------------------------------------------------------------

export interface WeekdayHodLodDay {
  dateKey: string;
  overnightGapPct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
  closePct: number | null; // close-to-close % vs prior session's close
}

export interface WeekdayHodLodStudyResult {
  ticker: string;
  weekdayLabel: string;
  requestedOccurrences: number;
  occurrencesFound: number;
  days: WeekdayHodLodDay[]; // chronological, oldest first
  highOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  lowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  mostCommonHighBucket: string | null;
  mostCommonLowBucket: string | null;
  pctHighBefore1030Et: number | null;
  pctLowBefore1030Et: number | null;
  dataLimitations: string[];
}

const TEN_THIRTY_AM_MINUTES = 10 * 60 + 30;

export async function getWeekdayHodLodStudy(
  ticker: string,
  weekday: number = 2, // 0=Sun..6=Sat, default Tuesday
  occurrenceCount = 50
): Promise<WeekdayHodLodStudyResult> {
  const dataLimitations: string[] = [DATA_SOURCE_LIMITATION];
  const now = Date.now();

  // Generous daily-bar lookback to find enough real occurrences of the
  // target weekday, padded 1.7x for holidays/half-days that skip a week.
  const lookbackMs = occurrenceCount * 7 * 24 * 60 * 60 * 1000 * 1.7;
  const daily = await fetchDailyBars(ticker, now - lookbackMs, now, 60 * 60 * 12);
  const dailyDateKeys = daily.map((c) => toEasternParts(c.datetime).dateKey);
  const matchingDateKeys = dailyDateKeys.filter((dk) => weekdayOf(dk) === weekday).slice(-occurrenceCount);

  if (matchingDateKeys.length === 0) {
    return {
      ticker,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      requestedOccurrences: occurrenceCount,
      occurrencesFound: 0,
      days: [],
      highOfDayTimeDistribution: [],
      lowOfDayTimeDistribution: [],
      mostCommonHighBucket: null,
      mostCommonLowBucket: null,
      pctHighBefore1030Et: null,
      pctLowBefore1030Et: null,
      dataLimitations: [...dataLimitations, "No trading days found on this weekday in the available lookback."],
    };
  }

  const earliestMs = new Date(`${matchingDateKeys[0]}T00:00:00Z`).getTime() - 5 * 24 * 60 * 60 * 1000;
  const latestMs = new Date(`${matchingDateKeys[matchingDateKeys.length - 1]}T00:00:00Z`).getTime() + 2 * 24 * 60 * 60 * 1000;
  const minuteBars = await fetchMinuteBarsChunked(ticker, earliestMs, Math.min(latestMs, now));
  const byDay = new Map<string, DayBars>(groupCandlesByEasternDay(minuteBars).map((d) => [d.dateKey, d]));
  const allDayKeysSorted = Array.from(byDay.keys()).sort();

  const days: WeekdayHodLodDay[] = [];
  const highTimes: number[] = [];
  const lowTimes: number[] = [];

  for (const dateKey of matchingDateKeys) {
    const day = byDay.get(dateKey);
    if (!day) continue;
    const priorIdx = allDayKeysSorted.indexOf(dateKey) - 1;
    const priorDay = priorIdx >= 0 ? byDay.get(allDayKeysSorted[priorIdx]) ?? null : null;

    const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    const priorClose = priorDay ? priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION) : null;
    const todayOpen = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);
    const todayClose = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);
    const overnightGapPct =
      priorClose !== null && priorClose !== 0 && todayOpen !== null ? ((todayOpen - priorClose) / priorClose) * 100 : null;
    const closePct =
      priorClose !== null && priorClose !== 0 && todayClose !== null ? ((todayClose - priorClose) / priorClose) * 100 : null;

    if (session.highTime !== null) highTimes.push(session.highTime);
    if (session.lowTime !== null) lowTimes.push(session.lowTime);

    days.push({
      dateKey,
      overnightGapPct,
      dayHigh: session.high,
      dayLow: session.low,
      dayHighTimeClock: session.highTime !== null ? formatMinutesAsClock(session.highTime) : null,
      dayLowTimeClock: session.lowTime !== null ? formatMinutesAsClock(session.lowTime) : null,
      closePct,
    });
  }

  const highDist = buildTimeOfDayFrequency(highTimes, days.length);
  const lowDist = buildTimeOfDayFrequency(lowTimes, days.length);
  const topBucket = (dist: typeof highDist) =>
    dist.length === 0 ? null : dist.reduce((a, b) => (b.count > a.count ? b : a)).bucketLabel;

  if (days.length < matchingDateKeys.length) {
    dataLimitations.push(
      `${matchingDateKeys.length - days.length} of ${matchingDateKeys.length} requested days had no usable minute bars and were skipped.`
    );
  }
  if (days.length < 20) {
    dataLimitations.push(`Only ${days.length} usable occurrence(s) found — treat every stat here as directional only.`);
  }

  return {
    ticker,
    weekdayLabel: WEEKDAY_LABELS[weekday],
    requestedOccurrences: occurrenceCount,
    occurrencesFound: days.length,
    days,
    highOfDayTimeDistribution: highDist,
    lowOfDayTimeDistribution: lowDist,
    mostCommonHighBucket: topBucket(highDist),
    mostCommonLowBucket: topBucket(lowDist),
    pctHighBefore1030Et: highTimes.length > 0 ? (highTimes.filter((t) => t < TEN_THIRTY_AM_MINUTES).length / highTimes.length) * 100 : null,
    pctLowBefore1030Et: lowTimes.length > 0 ? (lowTimes.filter((t) => t < TEN_THIRTY_AM_MINUTES).length / lowTimes.length) * 100 : null,
    dataLimitations,
  };
}

// ---------------------------------------------------------------------------
// 2. Recent-day variance study (last N trading days, gap-up vs gap-down)
// ---------------------------------------------------------------------------

export interface RecentDayRow {
  dateKey: string;
  overnightGapPct: number | null;
  dayReturnPct: number | null; // close-to-close vs prior session's close
  bucket: "gap_up" | "gap_down" | "flat";
  fedRateRegime: FedRateRegime | null; // null when there isn't enough FEDFUNDS history before this date to classify
}

export interface GroupStats {
  count: number;
  meanPct: number | null;
  medianPct: number | null;
  stdDevPct: number | null;
}

export interface RecentDayVarianceResult {
  ticker: string;
  requestedDayCount: number;
  daysAnalyzed: number;
  flatThresholdPct: number;
  days: RecentDayRow[]; // chronological
  all: GroupStats;
  gapUp: GroupStats;
  gapDown: GroupStats;
  gapUpVsGapDownMeanDiffPct: number | null;
  gapUpVsGapDownBootstrap: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  // Same gap-up/gap-down comparison, re-run separately within each Fed
  // rate regime actually present in the window — "this pattern only held
  // during easing cycles" is a materially stronger claim than the
  // unconditioned version above, using the same bootstrap machinery.
  byRegime: {
    regime: FedRateRegime;
    all: GroupStats;
    gapUp: GroupStats;
    gapDown: GroupStats;
    gapUpVsGapDownMeanDiffPct: number | null;
    gapUpVsGapDownBootstrap: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  }[];
  dataLimitations: string[];
}

function groupStatsOf(values: number[]): GroupStats {
  return { count: values.length, meanPct: mean(values), medianPct: median(values), stdDevPct: stdDev(values) };
}

function bootstrapMeanDiffCi(
  a: number[],
  b: number[],
  nBoot = 5000,
  ci = 0.95
): { lower: number | null; upper: number | null; ciExcludesZero: boolean } {
  if (a.length < 2 || b.length < 2) return { lower: null, upper: null, ciExcludesZero: false };
  const diffs: number[] = [];
  for (let i = 0; i < nBoot; i++) {
    let sumA = 0;
    for (let j = 0; j < a.length; j++) sumA += a[Math.floor(Math.random() * a.length)];
    let sumB = 0;
    for (let j = 0; j < b.length; j++) sumB += b[Math.floor(Math.random() * b.length)];
    diffs.push(sumA / a.length - sumB / b.length);
  }
  diffs.sort((x, y) => x - y);
  const lower = diffs[Math.floor(((1 - ci) / 2) * nBoot)];
  const upper = diffs[Math.min(Math.floor(((1 + ci) / 2) * nBoot), nBoot - 1)];
  return { lower, upper, ciExcludesZero: lower > 0 || upper < 0 };
}

/**
 * Buckets the last `dayCount` trading days by whether they opened gapped up,
 * gapped down, or flat (within flatThresholdPct of the prior close), then
 * compares each bucket's mean/median/stdDev close-to-close move and tests
 * whether the gap-up vs. gap-down means genuinely differ via a bootstrap on
 * the difference of means — the same resampling-based significance pattern
 * used throughout this app's other backtests, generalized to a two-sample
 * comparison instead of a one-sample test against zero.
 */
export async function getRecentDayVarianceStudy(
  ticker: string,
  dayCount = 21,
  flatThresholdPct = 0.1
): Promise<RecentDayVarianceResult> {
  const dataLimitations: string[] = [
    DATA_SOURCE_LIMITATION,
    "Fed rate regime is classified from FRED's FEDFUNDS series (trailing ~6-month trend, +/-0.2pp threshold to filter noise) as of each day's own date, not today's regime applied retroactively — but it's still just one macro signal among many that could plausibly matter (inflation, employment, geopolitical events aren't factored in here).",
  ];
  const now = Date.now();
  const calendarLookbackMs = (dayCount + 15) * 24 * 60 * 60 * 1000; // buffer for weekends/holidays
  const [bars, regimeTimeline] = await Promise.all([
    fetchMinuteBarsChunked(ticker, now - calendarLookbackMs, now),
    getFedRateRegimeTimeline().catch(() => null), // regime tagging degrades to null, never fails the whole study
  ]);
  const byDay = groupCandlesByEasternDay(bars);
  if (!regimeTimeline) dataLimitations.push("Fed rate regime unavailable this run (FRED lookup failed) — every day shows fedRateRegime: null.");

  const rows: RecentDayRow[] = [];
  for (let i = 1; i < byDay.length; i++) {
    const day = byDay[i];
    const priorDay = byDay[i - 1];
    const priorClose = priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION);
    const todayOpen = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);
    const todayClose = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);
    if (priorClose === null || priorClose === 0 || todayOpen === null || todayClose === null) continue;

    const overnightGapPct = ((todayOpen - priorClose) / priorClose) * 100;
    const dayReturnPct = ((todayClose - priorClose) / priorClose) * 100;
    const bucket: RecentDayRow["bucket"] =
      overnightGapPct > flatThresholdPct ? "gap_up" : overnightGapPct < -flatThresholdPct ? "gap_down" : "flat";
    const fedRateRegime = regimeTimeline ? classifyRegimeForDate(day.dateKey, regimeTimeline) : null;

    rows.push({ dateKey: day.dateKey, overnightGapPct, dayReturnPct, bucket, fedRateRegime });
  }

  const lastN = rows.slice(-dayCount);
  const allReturns = lastN.map((r) => r.dayReturnPct!).filter((v) => Number.isFinite(v));
  const gapUpReturns = lastN.filter((r) => r.bucket === "gap_up").map((r) => r.dayReturnPct!);
  const gapDownReturns = lastN.filter((r) => r.bucket === "gap_down").map((r) => r.dayReturnPct!);

  if (lastN.length < dayCount) {
    dataLimitations.push(`Only ${lastN.length} of the requested ${dayCount} trading days had usable data.`);
  }
  if (gapUpReturns.length < 5 || gapDownReturns.length < 5) {
    dataLimitations.push(
      `Small per-bucket sample (gap-up n=${gapUpReturns.length}, gap-down n=${gapDownReturns.length}) — treat the bucket comparison as directional only.`
    );
  }

  const regimesPresent = [...new Set(lastN.map((r) => r.fedRateRegime).filter((r): r is FedRateRegime => r !== null))];
  const byRegime = regimesPresent.map((regime) => {
    const regimeDays = lastN.filter((r) => r.fedRateRegime === regime);
    const regimeAll = regimeDays.map((r) => r.dayReturnPct!).filter((v) => Number.isFinite(v));
    const regimeUp = regimeDays.filter((r) => r.bucket === "gap_up").map((r) => r.dayReturnPct!);
    const regimeDown = regimeDays.filter((r) => r.bucket === "gap_down").map((r) => r.dayReturnPct!);
    return {
      regime,
      all: groupStatsOf(regimeAll),
      gapUp: groupStatsOf(regimeUp),
      gapDown: groupStatsOf(regimeDown),
      gapUpVsGapDownMeanDiffPct: mean(regimeUp) !== null && mean(regimeDown) !== null ? mean(regimeUp)! - mean(regimeDown)! : null,
      gapUpVsGapDownBootstrap: bootstrapMeanDiffCi(regimeUp, regimeDown),
    };
  });
  if (regimesPresent.length <= 1) {
    dataLimitations.push(
      regimesPresent.length === 0
        ? "No regime-tagged days in this window — regime breakdown is empty."
        : `Every day in this window fell in the same regime (${regimesPresent[0]}) — a per-regime comparison needs a longer dayCount to span more than one Fed cycle.`
    );
  }

  return {
    ticker,
    requestedDayCount: dayCount,
    daysAnalyzed: lastN.length,
    flatThresholdPct,
    days: lastN,
    all: groupStatsOf(allReturns),
    gapUp: groupStatsOf(gapUpReturns),
    gapDown: groupStatsOf(gapDownReturns),
    gapUpVsGapDownMeanDiffPct:
      mean(gapUpReturns) !== null && mean(gapDownReturns) !== null ? mean(gapUpReturns)! - mean(gapDownReturns)! : null,
    gapUpVsGapDownBootstrap: bootstrapMeanDiffCi(gapUpReturns, gapDownReturns),
    byRegime,
    dataLimitations,
  };
}

// ---------------------------------------------------------------------------
// 3. Gap-analog scan: "when it gapped up/down X% as of a given time, what
//    happened the rest of that day, historically?"
// ---------------------------------------------------------------------------

export interface GapAnalogCheckpoint {
  label: string;
  minutesSinceMidnight: number;
}

// A handful of standard intraday checkpoints, reused from time-windows.ts's
// own checkpoint conventions (FIRST_15_MIN/FIRST_HOUR/MIDDAY_CHOP/POWER_HOUR)
// plus the close, so "how it acts at key times of day" reads the same way
// the rest of this app already segments a session.
const CHECKPOINTS: GapAnalogCheckpoint[] = [
  { label: "9:45am (first 15m)", minutesSinceMidnight: WINDOWS.FIRST_15_MIN.end },
  { label: "10:30am (first hour)", minutesSinceMidnight: WINDOWS.FIRST_HOUR.end },
  { label: "1:30pm (midday)", minutesSinceMidnight: WINDOWS.MIDDAY_CHOP.end },
  { label: "3:00pm (power hour start)", minutesSinceMidnight: WINDOWS.POWER_HOUR.start },
  { label: "4:00pm (close)", minutesSinceMidnight: WINDOWS.REGULAR_SESSION.end },
];

export interface GapAnalogDay {
  dateKey: string;
  priorClose: number;
  priceAtAsOfTime: number | null;
  gapAtAsOfTimePct: number | null;
  premarketHigh: number | null;
  premarketLow: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  dayHighTimeClock: string | null;
  dayLowTimeClock: string | null;
  close: number | null;
  closePct: number | null;
  finishedGreen: boolean | null;
  extendedBeyondGap: boolean | null;
  pctMoveFromPmHighToClose: number | null;
  pctMoveFromPmLowToClose: number | null;
  checkpointPctFromAsOfTime: { label: string; pct: number | null }[];
}

export interface GapAnalogScanResult {
  ticker: string;
  asOfTimeEt: string;
  gapThresholdPct: number;
  direction: "up" | "down";
  requestedLookbackDays: number;
  tradingDaysScanned: number;
  matchingDays: GapAnalogDay[]; // most recent first
  occurrences: number;
  finishedGreenCount: number;
  finishedRedCount: number;
  extendedBeyondGapCount: number;
  fadedBackCount: number;
  avgCloseMovePct: number | null;
  medianCloseMovePct: number | null;
  highOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  lowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  avgPctMoveFromPmHighToClose: number | null;
  avgPctMoveFromPmLowToClose: number | null;
  checkpointAverages: { label: string; avgPct: number | null; sampleSize: number }[];
  dataLimitations: string[];
}

function parseEtTimeToMinutes(hhmm: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) throw new Error(`Invalid time "${hhmm}" — expected "HH:MM" in 24h ET, e.g. "07:00".`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Scans real history for days that gapped by at least `gapThresholdPct` (as
 * measured at `asOfTimeEt`, vs. the prior regular session's close), then
 * reports how those days actually played out — the same "find real historical
 * analogs, then report the honest distribution of outcomes" approach as
 * premarket-gap-hodlod.ts, generalized to an arbitrary time-of-day gap check
 * and either direction (that file is gap-down-only).
 */
export async function getGapAnalogScan(
  ticker: string,
  asOfTimeEt: string,
  gapThresholdPct: number,
  lookbackDays = 400
): Promise<GapAnalogScanResult> {
  const dataLimitations: string[] = [DATA_SOURCE_LIMITATION];
  const direction: "up" | "down" = gapThresholdPct >= 0 ? "up" : "down";
  const asOfMinutes = parseEtTimeToMinutes(asOfTimeEt);

  const now = Date.now();
  const bars = await fetchMinuteBarsChunked(ticker, now - lookbackDays * 24 * 60 * 60 * 1000, now);
  const byDay = groupCandlesByEasternDay(bars);

  const matches: GapAnalogDay[] = [];
  const matchHighTimes: number[] = [];
  const matchLowTimes: number[] = [];
  for (let i = 1; i < byDay.length; i++) {
    const day = byDay[i];
    const priorDay = byDay[i - 1];
    const priorClose = priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION);
    if (priorClose === null || priorClose === 0) continue;

    const priceAtAsOfTime = priceAtOrAfterMinute(day.bars, asOfMinutes);
    if (priceAtAsOfTime === null) continue;
    const gapAtAsOfTimePct = ((priceAtAsOfTime - priorClose) / priorClose) * 100;

    const isMatch = direction === "up" ? gapAtAsOfTimePct >= gapThresholdPct : gapAtAsOfTimePct <= gapThresholdPct;
    if (!isMatch) continue;

    const pm = highLowInWindow(day.bars, WINDOWS.PREMARKET);
    const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    const close = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);
    const closePct = close !== null ? ((close - priorClose) / priorClose) * 100 : null;
    const finishedGreen = closePct !== null ? closePct > 0 : null;
    const extendedBeyondGap =
      closePct !== null
        ? direction === "up"
          ? closePct >= gapThresholdPct
          : closePct <= gapThresholdPct
        : null;

    const checkpointPctFromAsOfTime = CHECKPOINTS.map((cp) => {
      const px = priceAtOrAfterMinute(day.bars, cp.minutesSinceMidnight);
      return { label: cp.label, pct: px !== null ? ((px - priceAtAsOfTime) / priceAtAsOfTime) * 100 : null };
    });

    if (session.highTime !== null) matchHighTimes.push(session.highTime);
    if (session.lowTime !== null) matchLowTimes.push(session.lowTime);

    matches.push({
      dateKey: day.dateKey,
      priorClose,
      priceAtAsOfTime,
      gapAtAsOfTimePct,
      premarketHigh: pm.high,
      premarketLow: pm.low,
      dayHigh: session.high,
      dayLow: session.low,
      dayHighTimeClock: session.highTime !== null ? formatMinutesAsClock(session.highTime) : null,
      dayLowTimeClock: session.lowTime !== null ? formatMinutesAsClock(session.lowTime) : null,
      close,
      closePct,
      finishedGreen,
      extendedBeyondGap,
      pctMoveFromPmHighToClose: pm.high !== null && close !== null ? ((close - pm.high) / pm.high) * 100 : null,
      pctMoveFromPmLowToClose: pm.low !== null && close !== null ? ((close - pm.low) / pm.low) * 100 : null,
      checkpointPctFromAsOfTime,
    });
  }

  matches.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const closeMoves = matches.map((m) => m.closePct).filter((v): v is number => v !== null);
  const highTimes = matchHighTimes;
  const lowTimes = matchLowTimes;

  const checkpointAverages = CHECKPOINTS.map((cp) => {
    const vals = matches
      .map((m) => m.checkpointPctFromAsOfTime.find((c) => c.label === cp.label)?.pct)
      .filter((v): v is number => v !== undefined && v !== null);
    return { label: cp.label, avgPct: mean(vals), sampleSize: vals.length };
  });

  if (matches.length < 5) {
    dataLimitations.push(`Only ${matches.length} historical match(es) found in the ${lookbackDays}-day lookback — treat every stat here as directional only, not a reliable base rate.`);
  }

  return {
    ticker,
    asOfTimeEt,
    gapThresholdPct,
    direction,
    requestedLookbackDays: lookbackDays,
    tradingDaysScanned: byDay.length,
    matchingDays: matches,
    occurrences: matches.length,
    finishedGreenCount: matches.filter((m) => m.finishedGreen === true).length,
    finishedRedCount: matches.filter((m) => m.finishedGreen === false).length,
    extendedBeyondGapCount: matches.filter((m) => m.extendedBeyondGap === true).length,
    fadedBackCount: matches.filter((m) => m.extendedBeyondGap === false).length,
    avgCloseMovePct: mean(closeMoves),
    medianCloseMovePct: median(closeMoves),
    highOfDayTimeDistribution: buildTimeOfDayFrequency(highTimes, matches.length),
    lowOfDayTimeDistribution: buildTimeOfDayFrequency(lowTimes, matches.length),
    avgPctMoveFromPmHighToClose: mean(matches.map((m) => m.pctMoveFromPmHighToClose).filter((v): v is number => v !== null)),
    avgPctMoveFromPmLowToClose: mean(matches.map((m) => m.pctMoveFromPmLowToClose).filter((v): v is number => v !== null)),
    checkpointAverages,
    dataLimitations,
  };
}
