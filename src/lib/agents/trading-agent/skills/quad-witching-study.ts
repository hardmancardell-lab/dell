import { getDailyBars } from "./daily-bars";
import { mean, stdDev, computeWinLossMetrics } from "../stats";
import { bootstrapCi } from "./stats-tests";
import type { DailyBar } from "../types";
import type { WinLossMetrics } from "../stats";

/**
 * Real quadruple/triple witching dates: the third Friday of March, June,
 * September, and December — a deterministic calendar rule (unlike FOMC
 * dates, which need sourcing from federalreserve.gov), so these are
 * computed directly rather than hardcoded/researched. "Quadruple" is the
 * name market commentary still uses, though single-stock futures stopped
 * trading in the US after OneChicago closed in 2020 — what actually expires
 * today is really stock index futures, stock index options, and
 * single-stock options (sometimes ETF options counted as an informal
 * fourth).
 */
const WITCHING_MONTHS = [3, 6, 9, 12]; // March, June, September, December
const FIRST_YEAR = 2015;
const LAST_YEAR = 2026;
const HISTORY_DAYS = 4400; // comfortably covers 2015-01-01 through today
const VOLUME_TRAILING_AVG_DAYS = 20;

function thirdFridayOf(year: number, month1To12: number): string {
  const first = new Date(Date.UTC(year, month1To12 - 1, 1));
  const firstDayOfWeek = first.getUTCDay(); // 0=Sun..6=Sat
  const firstFridayDate = 1 + ((5 - firstDayOfWeek + 7) % 7);
  const thirdFridayDate = firstFridayDate + 14;
  return new Date(Date.UTC(year, month1To12 - 1, thirdFridayDate)).toISOString().slice(0, 10);
}

export const QUAD_WITCHING_DATES: string[] = (() => {
  const dates: string[] = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    for (const month of WITCHING_MONTHS) {
      dates.push(thirdFridayOf(year, month));
    }
  }
  return dates.sort();
})();

function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

interface DayRecord {
  dateKey: string;
  returnPct: number | null;
  rangePct: number | null;
  volume: number;
}

function computeDayRecords(bars: DailyBar[]): DayRecord[] {
  return bars.map((b, i) => {
    if (i === 0) return { dateKey: b.dateKey, returnPct: null, rangePct: null, volume: b.volume };
    const priorClose = bars[i - 1].close;
    if (priorClose <= 0) return { dateKey: b.dateKey, returnPct: null, rangePct: null, volume: b.volume };
    return {
      dateKey: b.dateKey,
      returnPct: ((b.close - priorClose) / priorClose) * 100,
      rangePct: ((b.high - b.low) / priorClose) * 100,
      volume: b.volume,
    };
  });
}

export interface WeekStats {
  sampleSize: number;
  meanAbsReturnPct: number | null;
  meanRangePct: number | null;
  stdDevReturnPct: number | null;
}

function summarizeWeek(records: DayRecord[]): WeekStats {
  const absReturns = records.map((r) => (r.returnPct !== null ? Math.abs(r.returnPct) : null)).filter((v): v is number => v !== null);
  const ranges = records.map((r) => r.rangePct).filter((v): v is number => v !== null);
  const rawReturns = records.map((r) => r.returnPct).filter((v): v is number => v !== null);
  return {
    sampleSize: records.length,
    meanAbsReturnPct: mean(absReturns),
    meanRangePct: mean(ranges),
    stdDevReturnPct: stdDev(rawReturns),
  };
}

export interface QuadWitchingDayOf extends WinLossMetrics {
  sampleSize: number;
  avgVolumeRatio: number | null; // witching-day volume ÷ trailing 20-day average volume, mean across events
  meanRangePct: number | null;
  bootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  eventDates: string[];
}

export interface QuadWitchingTickerResult {
  ticker: string;
  eventsFound: number;
  dayOf: QuadWitchingDayOf;
  weekBefore: WeekStats; // the full real trading week immediately preceding the witching week
  weekAfter: WeekStats; // the full real trading week immediately following the witching week
  regularWeek: WeekStats; // baseline: every other week, not adjacent to any witching date
  error?: string;
}

export interface QuadWitchingStudyResult {
  tickers: QuadWitchingTickerResult[];
  nextWitchingDate: string;
  dataLimitations: string[];
}

async function studyOneTicker(ticker: string): Promise<QuadWitchingTickerResult> {
  const bars = await getDailyBars(ticker, HISTORY_DAYS);
  const records = computeDayRecords(bars);
  const dateIndex = new Map(records.map((r, i) => [r.dateKey, i]));
  const sortedDateKeys = records.map((r) => r.dateKey);

  function indexOnOrAfter(dateKey: string): number | null {
    for (let i = 0; i < sortedDateKeys.length; i++) {
      if (sortedDateKeys[i] >= dateKey) return i;
    }
    return null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const pastWitchingDates = QUAD_WITCHING_DATES.filter((d) => d < today);

  const dayOfValues: number[] = [];
  const volumeRatios: number[] = [];
  const rangeValues: number[] = [];
  const eventDatesUsed: string[] = [];

  const witchingWeekMondays = new Set<string>();

  for (const eventDate of pastWitchingDates) {
    const i = indexOnOrAfter(eventDate);
    if (i === null || i === 0) continue;
    const rec = records[i];
    if (rec.dateKey !== eventDate) continue; // witching Friday itself must be a real trading day
    witchingWeekMondays.add(mondayOf(eventDate));

    if (rec.returnPct !== null) dayOfValues.push(rec.returnPct);
    if (rec.rangePct !== null) rangeValues.push(rec.rangePct);

    const trailingStart = Math.max(0, i - VOLUME_TRAILING_AVG_DAYS);
    const trailingVolumes = records.slice(trailingStart, i).map((r) => r.volume);
    const avgTrailingVolume = mean(trailingVolumes);
    if (avgTrailingVolume !== null && avgTrailingVolume > 0) {
      volumeRatios.push(rec.volume / avgTrailingVolume);
    }
    eventDatesUsed.push(eventDate);
  }

  const boot = bootstrapCi(dayOfValues);
  const dayOf: QuadWitchingDayOf = {
    sampleSize: dayOfValues.length,
    avgVolumeRatio: mean(volumeRatios),
    meanRangePct: mean(rangeValues),
    bootstrapCi: { lower: boot.lower, upper: boot.upper, ciExcludesZero: boot.ciExcludesZero },
    eventDates: eventDatesUsed,
    ...computeWinLossMetrics(dayOfValues),
  };

  // Group every real trading day into its own Monday-keyed week.
  const weeks = new Map<string, DayRecord[]>();
  for (const r of records) {
    const wk = mondayOf(r.dateKey);
    if (!weeks.has(wk)) weeks.set(wk, []);
    weeks.get(wk)!.push(r);
  }

  const weekBeforeRecords: DayRecord[] = [];
  const weekAfterRecords: DayRecord[] = [];
  const adjacentMondays = new Set<string>(); // witching week + the week before + the week after — excluded from the "regular" baseline

  for (const witchingMonday of witchingWeekMondays) {
    adjacentMondays.add(witchingMonday);

    const beforeMonday = new Date(`${witchingMonday}T00:00:00Z`);
    beforeMonday.setUTCDate(beforeMonday.getUTCDate() - 7);
    const beforeKey = beforeMonday.toISOString().slice(0, 10);
    adjacentMondays.add(beforeKey);
    if (weeks.has(beforeKey)) weekBeforeRecords.push(...(weeks.get(beforeKey) as DayRecord[]));

    const afterMonday = new Date(`${witchingMonday}T00:00:00Z`);
    afterMonday.setUTCDate(afterMonday.getUTCDate() + 7);
    const afterKey = afterMonday.toISOString().slice(0, 10);
    adjacentMondays.add(afterKey);
    if (weeks.has(afterKey)) weekAfterRecords.push(...(weeks.get(afterKey) as DayRecord[]));
  }

  const regularWeekRecords: DayRecord[] = [];
  for (const [wk, weekRecords] of weeks.entries()) {
    if (!adjacentMondays.has(wk) && weekRecords.length >= 4) {
      regularWeekRecords.push(...weekRecords);
    }
  }

  return {
    ticker,
    eventsFound: eventDatesUsed.length,
    dayOf,
    weekBefore: summarizeWeek(weekBeforeRecords),
    weekAfter: summarizeWeek(weekAfterRecords),
    regularWeek: summarizeWeek(regularWeekRecords),
  };
}

/**
 * Real event study: how much does volume and volatility actually spike on a
 * real quadruple/triple witching Friday, and does realized volatility differ
 * in the week before vs. the week after — the dealer-gamma-reset question
 * (a lot of vol commentary claims the week after opex trades differently
 * once large options positions roll off and market-maker hedging pressure
 * changes) tested against real daily bars rather than asserted.
 */
export async function runQuadWitchingStudy(tickers: string[]): Promise<QuadWitchingStudyResult> {
  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await studyOneTicker(ticker);
      } catch (err) {
        return {
          ticker,
          eventsFound: 0,
          dayOf: {
            sampleSize: 0,
            avgVolumeRatio: null,
            meanRangePct: null,
            bootstrapCi: { lower: null, upper: null, ciExcludesZero: false },
            eventDates: [],
            ...computeWinLossMetrics([]),
          },
          weekBefore: { sampleSize: 0, meanAbsReturnPct: null, meanRangePct: null, stdDevReturnPct: null },
          weekAfter: { sampleSize: 0, meanAbsReturnPct: null, meanRangePct: null, stdDevReturnPct: null },
          regularWeek: { sampleSize: 0, meanAbsReturnPct: null, meanRangePct: null, stdDevReturnPct: null },
          error: err instanceof Error ? err.message : "unknown error",
        } as QuadWitchingTickerResult;
      }
    })
  );

  const today = new Date().toISOString().slice(0, 10);
  const nextWitchingDate = QUAD_WITCHING_DATES.find((d) => d >= today) ?? QUAD_WITCHING_DATES[QUAD_WITCHING_DATES.length - 1];

  const dataLimitations: string[] = [
    "Witching dates (third Friday of March/June/September/December) are computed directly from the calendar, not sourced/memorized — this is a fixed, deterministic rule (unlike FOMC meeting dates, which the Fed sets independently each cycle), so there's no research-verification step needed here.",
    "\"Quadruple\" is the name market commentary still uses, but single-stock futures stopped trading in the US after OneChicago closed in 2020 — what actually expires on these dates today is really stock index futures, stock index options, and single-stock options (ETF options are sometimes counted as an informal fourth).",
    "avgVolumeRatio compares the witching day's real volume against that same ticker's own trailing 20-trading-day average volume as of just before the event — a ratio above 1 means real above-average volume, not a guessed or index-wide figure.",
    "weekBefore/weekAfter are the full real trading weeks immediately adjacent to each witching week (not the witching week itself) — this directly tests whether realized volatility genuinely differs after a witching event (the \"dealer gamma reset\" claim) rather than asserting it. regularWeek is every other week in the same history, excluded from being adjacent to any witching date, as the baseline both are compared against.",
    "Real, confirmed data-coverage limit (same as this app's other long-history event studies): the daily-bar provider doesn't reliably return price history back to 2015 for every ticker despite the longer requested lookback — eventsFound will typically be well under the full 48-event list for tickers without that much real history (including any ticker that simply didn't exist yet, e.g. a recent IPO).",
    "Bootstrap 95% CIs on the day-of return require at least 5 real data points to ever report significant (ciExcludesZero) — a known fix applied across this app's event studies, since fewer points make a percentile bootstrap unreliable.",
  ];

  return { tickers: results, nextWitchingDate, dataLimitations };
}
