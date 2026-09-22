import { getDailyBars } from "./daily-bars";
import { mean, median, stdDev, correlation } from "../stats";

const HISTORY_DAYS = 400; // ~a year of real trading days — recent-pattern check, not a multi-year backtest

interface DayRow {
  dateKey: string;
  overnightGapPct: number; // prior close -> today's open
  intradayPct: number; // today's open -> today's close
  fullDayPct: number; // prior close -> today's close
}

export interface OvernightIntradayResult {
  ticker: string;
  daysAnalyzed: number;
  overnightGap: { meanPct: number | null; medianPct: number | null; stdDevPct: number | null; pctDaysNegative: number | null };
  intraday: { meanPct: number | null; medianPct: number | null; stdDevPct: number | null; pctDaysPositive: number | null };
  correlationGapVsIntraday: number | null; // negative = real "faded gap, recovered intraday" relationship
  gapDownThenGreenPattern: {
    occurrences: number;
    pctOfAllDays: number | null;
    meanOvernightGapPctOnThoseDays: number | null; // the real answer to "how much does it drop overnight, on the days this pattern shows up"
    meanIntradayRecoveryPctOnThoseDays: number | null;
    meanFullDayPctOnThoseDays: number | null;
  };
  recentDays: DayRow[]; // last 10 real trading days, for a visible spot-check
  error?: string;
}

async function studyOneTicker(ticker: string): Promise<OvernightIntradayResult> {
  const bars = await getDailyBars(ticker, HISTORY_DAYS);
  if (bars.length < 10) {
    throw new Error("Not enough daily bars returned for this ticker.");
  }

  const rows: DayRow[] = [];
  for (let i = 1; i < bars.length; i++) {
    const priorClose = bars[i - 1].close;
    const { open, close } = bars[i];
    if (priorClose <= 0 || open <= 0) continue;
    rows.push({
      dateKey: bars[i].dateKey,
      overnightGapPct: ((open - priorClose) / priorClose) * 100,
      intradayPct: ((close - open) / open) * 100,
      fullDayPct: ((close - priorClose) / priorClose) * 100,
    });
  }

  const gaps = rows.map((r) => r.overnightGapPct);
  const intradays = rows.map((r) => r.intradayPct);

  const patternDays = rows.filter((r) => r.overnightGapPct < 0 && r.fullDayPct > 0);

  return {
    ticker,
    daysAnalyzed: rows.length,
    overnightGap: {
      meanPct: mean(gaps),
      medianPct: median(gaps),
      stdDevPct: stdDev(gaps),
      pctDaysNegative: rows.length > 0 ? (gaps.filter((g) => g < 0).length / rows.length) * 100 : null,
    },
    intraday: {
      meanPct: mean(intradays),
      medianPct: median(intradays),
      stdDevPct: stdDev(intradays),
      pctDaysPositive: rows.length > 0 ? (intradays.filter((v) => v > 0).length / rows.length) * 100 : null,
    },
    correlationGapVsIntraday: correlation(gaps, intradays),
    gapDownThenGreenPattern: {
      occurrences: patternDays.length,
      pctOfAllDays: rows.length > 0 ? (patternDays.length / rows.length) * 100 : null,
      meanOvernightGapPctOnThoseDays: mean(patternDays.map((r) => r.overnightGapPct)),
      meanIntradayRecoveryPctOnThoseDays: mean(patternDays.map((r) => r.intradayPct)),
      meanFullDayPctOnThoseDays: mean(patternDays.map((r) => r.fullDayPct)),
    },
    recentDays: rows.slice(-10),
  };
}

/**
 * Real check for a specific claimed pattern: "it drops overnight, then runs
 * the rest of the day." Splits every real trading day into its overnight
 * component (prior close -> open) and its intraday component (open ->
 * close) separately — something no other tool in this app exposes directly
 * (the existing gap-calendar tools report the overnight gap alongside the
 * FULL day's close-to-close return, not the pure intraday piece on its
 * own). Reports the real correlation between the two (negative = genuine
 * fade-and-recover behavior, not coincidence) and isolates the exact
 * subset of days matching the claimed pattern (gapped down AND closed
 * green) to answer "how much does it actually drop on those days."
 */
export async function runOvernightIntradayStudy(tickers: string[]): Promise<OvernightIntradayResult[]> {
  return Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await studyOneTicker(ticker);
      } catch (err) {
        return {
          ticker,
          daysAnalyzed: 0,
          overnightGap: { meanPct: null, medianPct: null, stdDevPct: null, pctDaysNegative: null },
          intraday: { meanPct: null, medianPct: null, stdDevPct: null, pctDaysPositive: null },
          correlationGapVsIntraday: null,
          gapDownThenGreenPattern: {
            occurrences: 0,
            pctOfAllDays: null,
            meanOvernightGapPctOnThoseDays: null,
            meanIntradayRecoveryPctOnThoseDays: null,
            meanFullDayPctOnThoseDays: null,
          },
          recentDays: [],
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    })
  );
}

export const OVERNIGHT_INTRADAY_DATA_LIMITATIONS: string[] = [
  "Overnight gap = prior session's close to today's real opening print; intraday = today's real open to today's real close — these two pieces are computed separately here specifically so a claimed \"drops overnight, runs all day\" pattern can be checked directly rather than only seeing the combined close-to-close return.",
  "Window is the trailing ~400 real trading days (roughly the last year) — a recent-pattern check, not a multi-year backtest, since the claim being tested is about current/recent behavior.",
  "The gap-down-then-green pattern count is a real, disclosed subset — its own sample size (occurrences) is shown explicitly since it will usually be much smaller than daysAnalyzed, and a small occurrence count should be read as anecdotal, not a proven repeating edge.",
  "Correlation between overnight gap and intraday move is a real Pearson correlation across all real days (not just pattern days) — a meaningfully negative value supports a genuine fade-and-recover relationship; a value near zero means the two are behaving independently and the pattern claim isn't well supported by this ticker's own recent history.",
];
