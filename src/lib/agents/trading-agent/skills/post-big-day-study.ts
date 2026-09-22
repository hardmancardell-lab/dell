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
import { WINDOWS, buildTimeOfDayFrequency, formatMinutesAsClock, toEasternParts } from "./time-windows";
import { mean, median } from "../stats";

const DAILY_HISTORY_DAYS = 900; // ~2.5 real years — enough real occurrences of a big day for a modest ticker
const MINUTE_BAR_LOOKBACK_MONTHS = 3; // same real Alpaca free-tier depth limit disclosed elsewhere in this app
const DEFAULT_BIG_DAY_THRESHOLD_PCT = 5; // disclosed default — caller can override, but the value used is always echoed back, never silently fit to an occurrence
const GAP_DOWN_THRESHOLD_PCT = -1.2; // the specific threshold asked about
const EVENT_GAP_THRESHOLD_PCT = -1; // the narrower "which next-days do we actually care about" cut, real and disclosed, distinct from GAP_DOWN_THRESHOLD_PCT above

const CHECKPOINTS = [
  { label: "9:45am (first 15m)", minutesSinceMidnight: WINDOWS.FIRST_15_MIN.end },
  { label: "10:30am (first hour)", minutesSinceMidnight: WINDOWS.FIRST_HOUR.end },
  { label: "1:30pm (midday)", minutesSinceMidnight: WINDOWS.MIDDAY_CHOP.end },
  { label: "3:00pm (power hour start)", minutesSinceMidnight: WINDOWS.POWER_HOUR.start },
  { label: "4:00pm (close)", minutesSinceMidnight: WINDOWS.REGULAR_SESSION.end },
];

async function fetchMinuteBarsChunked(ticker: string, startMs: number, endMs: number, chunkDays = 30): Promise<MarketCandle[]> {
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  const windows: { s: number; e: number }[] = [];
  for (let s = startMs; s < endMs; s += chunkMs) windows.push({ s, e: Math.min(s + chunkMs, endMs) });
  const chunks = await Promise.all(windows.map((w) => fetchMinuteBars(ticker, w.s, w.e, 60 * 60 * 6)));
  const byTimestamp = new Map<number, MarketCandle>();
  for (const c of chunks.flat()) byTimestamp.set(c.datetime, c);
  return Array.from(byTimestamp.values()).sort((a, b) => a.datetime - b.datetime);
}

export interface PostBigDayOccurrence {
  triggerDateKey: string; // the real abnormal-move day itself
  triggerDayReturnPct: number;
  triggerDirection: "gain" | "loss"; // which abnormal move actually preceded this next-day gap
  nextDateKey: string;
  nextDayOvernightGapPct: number;
  nextDayRangePct: number; // (high-low) / trigger day's close
  nextDayFullReturnPct: number;
}

export interface GapDownEventDayStats {
  eventGapThresholdPct: number;
  eventCount: number;
  outOfTotalOccurrences: number;
  meanGapPct: number | null; // how deep the qualifying gaps actually ran, on average
  medianGapPct: number | null;
  pctThatContinueLower: number | null; // gapped down AND closed the day red too
  pctThatRecoverGreen: number | null; // gapped down but closed the day green anyway
  meanFullDayReturnPct: number | null;
  medianFullDayReturnPct: number | null;
  meanRangePct: number | null;
  medianRangePct: number | null;
  highOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  lowOfDayTimeDistribution: { bucketLabel: string; count: number; pctOfTotal: number }[];
  minuteBarEventsUsable: number;
}

export interface PostBigDayResult {
  ticker: string;
  bigDayThresholdPct: number;
  gapDownThresholdPct: number;
  occurrences: PostBigDayOccurrence[]; // most recent first
  stats: {
    count: number;
    pctGapDownAtAll: number | null;
    pctGapDownAtLeastThreshold: number | null;
    meanNextDayGapPct: number | null;
    medianNextDayGapPct: number | null;
    maxDropPct: number | null; // the single worst next-day gap down observed (most negative)
    meanNextDayRangePct: number | null;
    medianNextDayRangePct: number | null;
  };
  intradayCheckpoints: { label: string; avgPctMoveFromOpen: number | null; sampleSize: number }[];
  minuteBarOccurrencesUsable: number; // how many of `occurrences` actually had usable minute bars for the checkpoint section
  gapDownEventDays: GapDownEventDayStats;
  dataLimitations: string[];
  error?: string;
}

async function studyOneTicker(ticker: string, bigDayThresholdPct: number): Promise<PostBigDayResult> {
  const now = Date.now();
  const dailyBars = await fetchDailyBars(ticker, now - DAILY_HISTORY_DAYS * 24 * 60 * 60 * 1000, now, 60 * 60 * 12);
  const daily = dailyBars
    .map((c) => ({ dateKey: toEasternParts(c.datetime).dateKey, open: c.open, high: c.high, low: c.low, close: c.close }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  const occurrences: PostBigDayOccurrence[] = [];
  for (let i = 1; i < daily.length - 1; i++) {
    const prior = daily[i - 1];
    const trigger = daily[i];
    if (prior.close <= 0 || trigger.close <= 0) continue;
    const triggerDayReturnPct = ((trigger.close - prior.close) / prior.close) * 100;
    // "Abnormal" cuts both ways — a big gain and a big loss are both real,
    // disclosed trigger conditions here, not just the gain side.
    if (Math.abs(triggerDayReturnPct) < bigDayThresholdPct) continue;
    const triggerDirection: "gain" | "loss" = triggerDayReturnPct >= 0 ? "gain" : "loss";

    const next = daily[i + 1];
    occurrences.push({
      triggerDateKey: trigger.dateKey,
      triggerDayReturnPct,
      triggerDirection,
      nextDateKey: next.dateKey,
      nextDayOvernightGapPct: ((next.open - trigger.close) / trigger.close) * 100,
      nextDayRangePct: ((next.high - next.low) / trigger.close) * 100,
      nextDayFullReturnPct: ((next.close - trigger.close) / trigger.close) * 100,
    });
  }
  occurrences.reverse(); // most recent first

  const gaps = occurrences.map((o) => o.nextDayOvernightGapPct);
  const ranges = occurrences.map((o) => o.nextDayRangePct);
  const gapDowns = gaps.filter((g) => g < 0);
  const bigGapDowns = gaps.filter((g) => g <= GAP_DOWN_THRESHOLD_PCT);

  const stats = {
    count: occurrences.length,
    pctGapDownAtAll: occurrences.length > 0 ? (gapDowns.length / occurrences.length) * 100 : null,
    pctGapDownAtLeastThreshold: occurrences.length > 0 ? (bigGapDowns.length / occurrences.length) * 100 : null,
    meanNextDayGapPct: mean(gaps),
    medianNextDayGapPct: median(gaps),
    maxDropPct: gaps.length > 0 ? Math.min(...gaps) : null,
    meanNextDayRangePct: mean(ranges),
    medianNextDayRangePct: median(ranges),
  };

  // Real minute bars only reach back ~3 months, so only recent occurrences
  // can ever contribute intraday detail, regardless of how far back the
  // daily-bar occurrence list itself goes. One shared minute-bar fetch
  // covers both the general intraday-checkpoint section and the
  // gap-down-event HOD/LOD section below, rather than fetching twice.
  const minuteWindowStartMs = now - MINUTE_BAR_LOOKBACK_MONTHS * 30.44 * 24 * 60 * 60 * 1000;
  const recentOccurrences = occurrences.filter((o) => new Date(`${o.nextDateKey}T00:00:00Z`).getTime() >= minuteWindowStartMs);

  const checkpointValues: number[][] = CHECKPOINTS.map(() => []);
  let minuteBarOccurrencesUsable = 0;
  let byDay = new Map<string, DayBars>();

  if (recentOccurrences.length > 0) {
    const earliestMs = Math.min(...recentOccurrences.map((o) => new Date(`${o.nextDateKey}T00:00:00Z`).getTime())) - 2 * 24 * 60 * 60 * 1000;
    const latestMs = Math.min(now, Math.max(...recentOccurrences.map((o) => new Date(`${o.nextDateKey}T00:00:00Z`).getTime())) + 2 * 24 * 60 * 60 * 1000);
    const minuteBars = await fetchMinuteBarsChunked(ticker, earliestMs, latestMs);
    byDay = new Map<string, DayBars>(groupCandlesByEasternDay(minuteBars).map((d) => [d.dateKey, d]));

    for (const occ of recentOccurrences) {
      const day = byDay.get(occ.nextDateKey);
      if (!day) continue;
      const openPrice = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);
      if (openPrice === null || openPrice === 0) continue;
      minuteBarOccurrencesUsable++;
      CHECKPOINTS.forEach((cp, idx) => {
        const priceAtCp = priceAtOrAfterMinute(day.bars, cp.minutesSinceMidnight);
        if (priceAtCp !== null) checkpointValues[idx].push(((priceAtCp - openPrice) / openPrice) * 100);
      });
    }
  }

  const intradayCheckpoints = CHECKPOINTS.map((cp, idx) => ({
    label: cp.label,
    avgPctMoveFromOpen: mean(checkpointValues[idx]),
    sampleSize: checkpointValues[idx].length,
  }));

  // The specific population asked about: not every next-day, only the ones
  // that actually gapped down at least EVENT_GAP_THRESHOLD_PCT — and,
  // critically, this whole population is ALREADY conditioned on the prior
  // day being an abnormal (big gain OR big loss) day, not a general
  // unconditioned gap-down study. That conditioning is real and load-bearing
  // for interpreting these numbers, not incidental.
  const gapDownEvents = occurrences.filter((o) => o.nextDayOvernightGapPct <= EVENT_GAP_THRESHOLD_PCT);
  const eventGaps = gapDownEvents.map((o) => o.nextDayOvernightGapPct);
  const eventFullReturns = gapDownEvents.map((o) => o.nextDayFullReturnPct);
  const eventRanges = gapDownEvents.map((o) => o.nextDayRangePct);
  const continueLower = gapDownEvents.filter((o) => o.nextDayFullReturnPct < 0);
  const recoverGreen = gapDownEvents.filter((o) => o.nextDayFullReturnPct >= 0);

  const eventHighTimes: number[] = [];
  const eventLowTimes: number[] = [];
  let minuteBarEventsUsable = 0;
  for (const evt of gapDownEvents) {
    const day = byDay.get(evt.nextDateKey);
    if (!day) continue;
    const session = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    if (session.highTime === null && session.lowTime === null) continue;
    minuteBarEventsUsable++;
    if (session.highTime !== null) eventHighTimes.push(session.highTime);
    if (session.lowTime !== null) eventLowTimes.push(session.lowTime);
  }

  const gapDownEventDays: GapDownEventDayStats = {
    eventGapThresholdPct: EVENT_GAP_THRESHOLD_PCT,
    eventCount: gapDownEvents.length,
    outOfTotalOccurrences: occurrences.length,
    meanGapPct: mean(eventGaps),
    medianGapPct: median(eventGaps),
    pctThatContinueLower: gapDownEvents.length > 0 ? (continueLower.length / gapDownEvents.length) * 100 : null,
    pctThatRecoverGreen: gapDownEvents.length > 0 ? (recoverGreen.length / gapDownEvents.length) * 100 : null,
    meanFullDayReturnPct: mean(eventFullReturns),
    medianFullDayReturnPct: median(eventFullReturns),
    meanRangePct: mean(eventRanges),
    medianRangePct: median(eventRanges),
    highOfDayTimeDistribution: buildTimeOfDayFrequency(eventHighTimes, minuteBarEventsUsable),
    lowOfDayTimeDistribution: buildTimeOfDayFrequency(eventLowTimes, minuteBarEventsUsable),
    minuteBarEventsUsable,
  };

  const dataLimitations: string[] = [
    `"Big day" = a real close-to-close move of at least ${bigDayThresholdPct}% in EITHER direction (gain or loss) — the threshold used is always echoed back here, never silently fit to any single occurrence (including the specific day that prompted this check). Each occurrence's triggerDirection says which side it actually was.`,
    `Daily-bar stats (gap %, range %, max drop) use up to ~${Math.round(DAILY_HISTORY_DAYS / 365.25 * 10) / 10} years of real daily bars — as long a real history as this ticker's data actually supports.`,
    `Intraday checkpoint moves (9:45am/10:30am/1:30pm/3pm/close, as % from that day's own open) require real minute bars, which only reliably reach back about ${MINUTE_BAR_LOOKBACK_MONTHS} months on this app's data provider — so this section uses a smaller, separately-reported sample (minuteBarOccurrencesUsable) than the daily-bar stats above it, even though both are drawn from the same occurrence list.`,
    "maxDropPct is the single worst real next-day gap observed in this sample, not a theoretical worst case — a larger drop is always possible with more history or bad luck.",
    `gapDownEventDays is a further-filtered subset of the SAME occurrence list — only the next-days that actually gapped down at least ${Math.abs(EVENT_GAP_THRESHOLD_PCT)}%. It is not an unconditioned "how does this ticker behave on any gap-down day" study — every single row in it followed an abnormal (big gain or big loss) prior day by construction, and that conditioning should be read as part of the result, not a footnote.`,
  ];

  return {
    ticker,
    bigDayThresholdPct,
    gapDownThresholdPct: GAP_DOWN_THRESHOLD_PCT,
    occurrences,
    stats,
    intradayCheckpoints,
    minuteBarOccurrencesUsable,
    gapDownEventDays,
    dataLimitations,
  };
}

/**
 * Real conditional study, directly answering: "after a day like yesterday
 * (a big real gain), how does the next day actually behave?" Finds every
 * real historical day matching the same big-gain threshold, then reports
 * the next real trading day's overnight gap (how often down at all, how
 * often down at least a specific threshold, the worst ever observed), its
 * typical intraday range, and — for the subset with usable minute bars —
 * the average intraday move at several standard checkpoints through the
 * session. Trigger-day dates are listed so each real occurrence can be
 * pulled up and visually compared via this app's own chart (focusDate).
 */
export async function runPostBigDayStudy(
  tickers: string[],
  bigDayThresholdPct: number = DEFAULT_BIG_DAY_THRESHOLD_PCT
): Promise<PostBigDayResult[]> {
  return Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await studyOneTicker(ticker, bigDayThresholdPct);
      } catch (err) {
        return {
          ticker,
          bigDayThresholdPct,
          gapDownThresholdPct: GAP_DOWN_THRESHOLD_PCT,
          occurrences: [],
          stats: {
            count: 0,
            pctGapDownAtAll: null,
            pctGapDownAtLeastThreshold: null,
            meanNextDayGapPct: null,
            medianNextDayGapPct: null,
            maxDropPct: null,
            meanNextDayRangePct: null,
            medianNextDayRangePct: null,
          },
          intradayCheckpoints: [],
          minuteBarOccurrencesUsable: 0,
          gapDownEventDays: {
            eventGapThresholdPct: EVENT_GAP_THRESHOLD_PCT,
            eventCount: 0,
            outOfTotalOccurrences: 0,
            meanGapPct: null,
            medianGapPct: null,
            pctThatContinueLower: null,
            pctThatRecoverGreen: null,
            meanFullDayReturnPct: null,
            medianFullDayReturnPct: null,
            meanRangePct: null,
            medianRangePct: null,
            highOfDayTimeDistribution: [],
            lowOfDayTimeDistribution: [],
            minuteBarEventsUsable: 0,
          },
          dataLimitations: [],
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );
}

// Re-exported so a UI can format bucket labels consistently if it ever needs to.
export { formatMinutesAsClock, buildTimeOfDayFrequency };
