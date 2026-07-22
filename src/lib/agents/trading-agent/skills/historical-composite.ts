import { fetchMinuteBars } from "@/lib/data/market-data";
import {
  groupCandlesByEasternDay,
  highLowInWindow,
  priceAtOrNearWindowEnd,
  priceAtOrNearWindowStart,
  sumVolumeInWindow,
  type DayBars,
} from "./bar-aggregation";
import { buildTimeOfDayFrequency, formatMinutesAsClock, thirtyMinuteBucketLabel, WINDOWS } from "./time-windows";
import { computeWinLossMetrics, mean, median } from "../stats";
import {
  HISTORICAL_COMPOSITE_LOOKBACK_DAYS,
  PM_VOLUME_ANOMALY_MULTIPLE,
  ROLLING_AVERAGE_LOOKBACK_DAYS,
} from "../constants";
import type {
  CheckpointStat,
  DayContextFields,
  DayRecord,
  HistoricalComposite,
  HistoricalCompositeTradeLogRow,
  NextDayFollowThrough,
  TimeOfDayFrequency,
} from "../types";

// Before-10:30am ET, in minutes since midnight — the cutoff the "% of times
// high of day occurred before 10:30" stat is measured against.
const TEN_THIRTY_AM_MINUTES = 10 * 60 + 30;

function pctReturn(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}

function buildCheckpointStat(key: string, label: string, moves: (number | null)[]): CheckpointStat {
  const clean = moves.filter((m): m is number => m !== null && Number.isFinite(m));
  const up = clean.filter((m) => m > 0).length;
  const winLoss = computeWinLossMetrics(clean);
  return {
    checkpoint: key,
    label,
    sampleSize: clean.length,
    probabilityUp: clean.length > 0 ? (up / clean.length) * 100 : null, // this IS the win rate
    averageMovePct: mean(clean),
    medianMovePct: median(clean),
    avgWinPct: winLoss.avgWinPct,
    avgLossPct: winLoss.avgLossPct,
    profitFactor: winLoss.profitFactor,
    expectancy: winLoss.expectancy,
    maxDrawdownPct: winLoss.maxDrawdownPct,
    largestWinPct: winLoss.largestWinPct,
    largestLossPct: winLoss.largestLossPct,
    note:
      clean.length < 5
        ? `Only ${clean.length} sample(s) — directional only, not statistically reliable.`
        : null,
  };
}


/** anomalyDays, moves, and contexts are built in lockstep in the same loop — index i in each array refers to the same day. */
function zipTradeLog(
  checkpoint: string,
  days: DayBars[],
  moves: (number | null)[],
  contexts: DayContextFields[]
): HistoricalCompositeTradeLogRow[] {
  return days
    .map((d, i) =>
      moves[i] !== null
        ? { dateKey: d.dateKey, checkpoint, returnPct: moves[i] as number, isWin: (moves[i] as number) > 0, ...contexts[i] }
        : null
    )
    .filter((r): r is HistoricalCompositeTradeLogRow => r !== null);
}

export async function getHistoricalComposite(ticker: string): Promise<HistoricalComposite> {
  const dataLimitations: string[] = [
    `Historical composite covers ${HISTORICAL_COMPOSITE_LOOKBACK_DAYS} calendar days of lookback — a conservative starting window since Schwab's actual minute-bar historical depth on this API tier hasn't been confirmed live yet.`,
  ];

  const now = Date.now();
  const startMs = now - HISTORICAL_COMPOSITE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const bars = await fetchMinuteBars(ticker, startMs, now, 60 * 60 * 6);
  const days = groupCandlesByEasternDay(bars);

  // A day qualifies as a historical anomaly if its own trailing rolling
  // average (computed the same way the live check does) was crossed.
  const anomalyDays: DayBars[] = [];
  for (let i = ROLLING_AVERAGE_LOOKBACK_DAYS; i < days.length; i++) {
    const day = days[i];
    const priorWindow = days.slice(i - ROLLING_AVERAGE_LOOKBACK_DAYS, i);
    const priorPmVolumes = priorWindow.map((d) => sumVolumeInWindow(d.bars, WINDOWS.PREMARKET));
    const avg = mean(priorPmVolumes);
    const todayPm = sumVolumeInWindow(day.bars, WINDOWS.PREMARKET);
    if (avg && avg > 0 && todayPm / avg >= PM_VOLUME_ANOMALY_MULTIPLE) {
      anomalyDays.push(day);
    }
  }

  const first15MinMoves: (number | null)[] = [];
  const ctRolloffMoves: (number | null)[] = [];
  const powerHourMoves: (number | null)[] = [];
  const middayChopCompressionPct: number[] = [];
  const lowMinutes: number[] = [];
  const highMinutes: number[] = [];
  const closeUpDays: DayBars[] = [];
  const closeDownDays: DayBars[] = [];
  const dayContexts: DayContextFields[] = [];
  const dayRecords: DayRecord[] = [];

  for (const day of anomalyDays) {
    const sessionOpen = priceAtOrNearWindowStart(day.bars, WINDOWS.REGULAR_SESSION);
    const sessionClose = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);

    first15MinMoves.push(
      pctReturn(
        priceAtOrNearWindowStart(day.bars, WINDOWS.FIRST_15_MIN),
        priceAtOrNearWindowEnd(day.bars, WINDOWS.FIRST_15_MIN)
      )
    );
    ctRolloffMoves.push(pctReturn(sessionOpen, priceAtOrNearWindowEnd(day.bars, WINDOWS.CT_10AM_ROLLOFF)));
    powerHourMoves.push(
      pctReturn(
        priceAtOrNearWindowStart(day.bars, WINDOWS.POWER_HOUR),
        priceAtOrNearWindowEnd(day.bars, WINDOWS.POWER_HOUR)
      )
    );

    const fullSession = highLowInWindow(day.bars, WINDOWS.REGULAR_SESSION);
    const midday = highLowInWindow(day.bars, WINDOWS.MIDDAY_CHOP);
    if (fullSession.high !== null && fullSession.low !== null && midday.high !== null && midday.low !== null) {
      const fullRange = fullSession.high - fullSession.low;
      const middayRange = midday.high - midday.low;
      if (fullRange > 0) middayChopCompressionPct.push((middayRange / fullRange) * 100);
    }
    if (fullSession.lowTime !== null) lowMinutes.push(fullSession.lowTime);
    if (fullSession.highTime !== null) highMinutes.push(fullSession.highTime);

    const premarketVolume = sumVolumeInWindow(day.bars, WINDOWS.PREMARKET);
    dayRecords.push({
      dateKey: day.dateKey,
      premarketVolume,
      sessionOpen,
      sessionClose,
      dayHigh: fullSession.high,
      dayLow: fullSession.low,
      dayHighTimeClock: fullSession.highTime !== null ? formatMinutesAsClock(fullSession.highTime) : null,
      dayLowTimeClock: fullSession.lowTime !== null ? formatMinutesAsClock(fullSession.lowTime) : null,
      highOfDayBucket: fullSession.highTime !== null ? thirtyMinuteBucketLabel(fullSession.highTime) : null,
      lowOfDayBucket: fullSession.lowTime !== null ? thirtyMinuteBucketLabel(fullSession.lowTime) : null,
      highToLowPct: pctReturn(fullSession.high, fullSession.low),
      highToClosePct: pctReturn(fullSession.high, sessionClose),
    });

    const anomalyIdx = days.findIndex((d) => d.dateKey === day.dateKey);
    const priorDay = anomalyIdx > 0 ? days[anomalyIdx - 1] : null;
    const priorClose = priorDay ? priceAtOrNearWindowEnd(priorDay.bars, WINDOWS.REGULAR_SESSION) : null;
    const overnightGapPct =
      priorClose !== null && priorClose !== 0 && sessionOpen !== null ? ((sessionOpen - priorClose) / priorClose) * 100 : null;
    dayContexts.push({
      overnightGapPct,
      dayHigh: fullSession.high,
      dayLow: fullSession.low,
      dayHighTimeClock: fullSession.highTime !== null ? formatMinutesAsClock(fullSession.highTime) : null,
      dayLowTimeClock: fullSession.lowTime !== null ? formatMinutesAsClock(fullSession.lowTime) : null,
    });

    const dayReturn = pctReturn(sessionOpen, sessionClose);
    if (dayReturn !== null) {
      if (dayReturn >= 0) closeUpDays.push(day);
      else closeDownDays.push(day);
    }
  }

  const checkpoints: CheckpointStat[] = [
    buildCheckpointStat("first15min", "First 15 Minutes", first15MinMoves),
    buildCheckpointStat("ctRolloff", "10:00am CT / 11:00am ET (Veta Rolloff)", ctRolloffMoves),
    buildCheckpointStat("powerHour", "Power Hour (3-4pm ET)", powerHourMoves),
    {
      checkpoint: "middayChop",
      label: "Midday Chop Range (% of full day's range)",
      sampleSize: middayChopCompressionPct.length,
      probabilityUp: null,
      averageMovePct: mean(middayChopCompressionPct),
      medianMovePct: median(middayChopCompressionPct),
      // A range-compression ratio, not a P&L series — win/loss framing doesn't apply here.
      avgWinPct: null,
      avgLossPct: null,
      profitFactor: null,
      expectancy: null,
      maxDrawdownPct: null,
      largestWinPct: null,
      largestLossPct: null,
      note:
        middayChopCompressionPct.length < 5
          ? `Only ${middayChopCompressionPct.length} sample(s) — directional only, not statistically reliable.`
          : "Lower % = most of the day's range happened outside midday (i.e. real compression during chop).",
    },
  ];

  function nextDayFollowThroughFor(anomalySet: DayBars[]): { gains: number[]; continuations: number } {
    const gains: number[] = [];
    let continuations = 0;
    for (const day of anomalySet) {
      const idx = days.findIndex((d) => d.dateKey === day.dateKey);
      const nextDay = days[idx + 1];
      if (!nextDay) continue;
      const priorClose = priceAtOrNearWindowEnd(day.bars, WINDOWS.REGULAR_SESSION);
      const nextOpen = priceAtOrNearWindowStart(nextDay.bars, WINDOWS.NEXT_DAY_FOLLOW_THROUGH);
      const g = pctReturn(priorClose, nextOpen);
      if (g !== null) {
        gains.push(g);
        if (g >= 0) continuations += 1;
      }
    }
    return { gains, continuations };
  }

  const upFollow = nextDayFollowThroughFor(closeUpDays);
  const downFollow = nextDayFollowThroughFor(closeDownDays);
  const allGains = [...upFollow.gains, ...downFollow.gains];
  const totalContinuations = upFollow.continuations + downFollow.continuations;

  const nextDayFollowThrough: NextDayFollowThrough = {
    sampleSize: allGains.length,
    probabilityContinuation: allGains.length > 0 ? (totalContinuations / allGains.length) * 100 : null,
    averageOvernightGainPct: mean(upFollow.gains),
    averageOvernightLossPct: mean(downFollow.gains),
  };

  if (anomalyDays.length < 5) {
    dataLimitations.push(
      `Only ${anomalyDays.length} prior anomaly day(s) found in the lookback window — small-sample stats are directional only. A longer lookback (once Schwab's real historical depth is confirmed) would improve this.`
    );
  }

  const tradeLog: HistoricalCompositeTradeLogRow[] = [
    ...zipTradeLog("first15min", anomalyDays, first15MinMoves, dayContexts),
    ...zipTradeLog("ctRolloff", anomalyDays, ctRolloffMoves, dayContexts),
    ...zipTradeLog("powerHour", anomalyDays, powerHourMoves, dayContexts),
  ];

  const highOfDayBefore1030Pct =
    highMinutes.length > 0
      ? (highMinutes.filter((m) => m < TEN_THIRTY_AM_MINUTES).length / anomalyDays.length) * 100
      : null;

  return {
    ticker,
    lookbackDays: HISTORICAL_COMPOSITE_LOOKBACK_DAYS,
    tradingDaysScanned: days.length,
    anomalyDaysFound: anomalyDays.length,
    checkpoints,
    lowOfDayDistribution: buildTimeOfDayFrequency(lowMinutes, anomalyDays.length),
    highOfDayDistribution: buildTimeOfDayFrequency(highMinutes, anomalyDays.length),
    highOfDayBefore1030Pct,
    dayRecords,
    nextDayFollowThrough,
    tradeLog,
    dataLimitations,
  };
}
