import { getDailyBars } from "./daily-bars";
import { getFedRateRegimeTimeline, classifyRegimeForDate } from "./macro-regime";
import { bootstrapCi } from "./stats-tests";
import { computeWinLossMetrics } from "../stats";
import type { FedRateRegime } from "./macro-regime";
import type { WinLossMetrics } from "../stats";

/**
 * Real FOMC decision-announcement dates (the second day of each two-day
 * meeting, when the statement/rate decision is actually released at
 * 2:00pm ET) — sourced directly from federalreserve.gov's own
 * fomcpresconf/press-release pages, not memorized or approximated. 2026-09-16
 * is the upcoming meeting and is never included in the historical event
 * study below (it hasn't happened yet) — it's surfaced separately as
 * context only.
 */
export const FOMC_DECISION_DATES: string[] = [
  // 2023
  "2023-02-01", "2023-03-22", "2023-05-03", "2023-06-14", "2023-07-26", "2023-09-20", "2023-11-01", "2023-12-13",
  // 2024
  "2024-01-31", "2024-03-20", "2024-05-01", "2024-06-12", "2024-07-31", "2024-09-18", "2024-11-07", "2024-12-18",
  // 2025
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  // 2026 (through the most recent completed meeting)
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29",
];

export const UPCOMING_FOMC_DATE = "2026-09-16";

export interface FomcMeetingReaction {
  decisionDate: string;
  regime: FedRateRegime | null; // trailing-6-month FEDFUNDS trend as of this date — a regime label, not literally "this meeting hiked/cut"
  day0ReturnPct: number | null;
  day1ReturnPct: number | null;
}

export interface FomcOutcomeBucket extends WinLossMetrics {
  regime: FedRateRegime;
  sampleSize: number;
  day0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
}

export interface FomcTickerReactionResult {
  ticker: string;
  meetings: FomcMeetingReaction[];
  overallSampleSize: number;
  overallDay0: WinLossMetrics;
  overallDay1: WinLossMetrics;
  overallDay0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  byRegime: FomcOutcomeBucket[];
}

export interface FomcReactionStudyResult {
  tickers: FomcTickerReactionResult[];
  upcomingMeeting: { date: string; note: string };
  dataLimitations: string[];
}

async function reactionsForTicker(ticker: string, timeline: Awaited<ReturnType<typeof getFedRateRegimeTimeline>>): Promise<FomcTickerReactionResult> {
  const bars = await getDailyBars(ticker, 1400); // comfortably covers 2023-01-01 through today
  const dateIndex = new Map(bars.map((b, i) => [b.dateKey, i]));
  // FOMC dates don't always land on a real trading day bar exactly (bars use
  // real trading-day dateKeys) — find the bar at or after the decision date.
  const sortedDateKeys = bars.map((b) => b.dateKey);

  function indexOnOrAfter(dateKey: string): number | null {
    for (let i = 0; i < sortedDateKeys.length; i++) {
      if (sortedDateKeys[i] >= dateKey) return i;
    }
    return null;
  }

  const meetings: FomcMeetingReaction[] = [];
  for (const decisionDate of FOMC_DECISION_DATES) {
    const i = indexOnOrAfter(decisionDate);
    if (i === null || i === 0 || i >= bars.length - 1) {
      meetings.push({ decisionDate, regime: null, day0ReturnPct: null, day1ReturnPct: null });
      continue;
    }
    const priorClose = bars[i - 1].close;
    const dayClose = bars[i].close;
    const nextClose = bars[i + 1].close;
    const regime = classifyRegimeForDate(decisionDate, timeline);
    meetings.push({
      decisionDate,
      regime,
      day0ReturnPct: priorClose > 0 ? ((dayClose - priorClose) / priorClose) * 100 : null,
      day1ReturnPct: dayClose > 0 ? ((nextClose - dayClose) / dayClose) * 100 : null,
    });
  }

  const day0Values = meetings.map((m) => m.day0ReturnPct).filter((v): v is number => v !== null);
  const day1Values = meetings.map((m) => m.day1ReturnPct).filter((v): v is number => v !== null);
  const day0Boot = bootstrapCi(day0Values);

  const regimesPresent = [...new Set(meetings.map((m) => m.regime).filter((r): r is FedRateRegime => r !== null))];
  const byRegime: FomcOutcomeBucket[] = regimesPresent.map((regime) => {
    const values = meetings.filter((m) => m.regime === regime).map((m) => m.day0ReturnPct).filter((v): v is number => v !== null);
    const boot = bootstrapCi(values);
    return {
      regime,
      sampleSize: values.length,
      day0BootstrapCi: { lower: boot.lower, upper: boot.upper, ciExcludesZero: boot.ciExcludesZero },
      ...computeWinLossMetrics(values),
    };
  });

  return {
    ticker,
    meetings,
    overallSampleSize: day0Values.length,
    overallDay0: computeWinLossMetrics(day0Values),
    overallDay1: computeWinLossMetrics(day1Values),
    overallDay0BootstrapCi: { lower: day0Boot.lower, upper: day0Boot.upper, ciExcludesZero: day0Boot.ciExcludesZero },
    byRegime,
  };
}

/**
 * Real FOMC-day event study across a basket of tickers — day-of and
 * next-day price reaction on every real decision date since 2023, broken
 * down by the trailing Fed-rate regime active at the time (hiking/cutting/
 * holding — a trend label, not the literal single-meeting decision, since
 * FEDFUNDS itself only updates monthly). The upcoming 2026-09-16 meeting is
 * never included in these stats since it hasn't happened — it's real
 * context, not a data point.
 */
export async function runFomcReactionStudy(tickers: string[]): Promise<FomcReactionStudyResult> {
  const timeline = await getFedRateRegimeTimeline();
  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await reactionsForTicker(ticker, timeline);
      } catch (err) {
        return {
          ticker,
          meetings: [],
          overallSampleSize: 0,
          overallDay0: computeWinLossMetrics([]),
          overallDay1: computeWinLossMetrics([]),
          overallDay0BootstrapCi: { lower: null, upper: null, ciExcludesZero: false },
          byRegime: [],
          error: err instanceof Error ? err.message : "unknown error",
        } as FomcTickerReactionResult & { error: string };
      }
    })
  );

  const dataLimitations: string[] = [
    "Decision dates are the real, sourced second day of each FOMC meeting (federalreserve.gov's own fomcpresconf pages) — not the meeting's first day and not a memorized/approximated list.",
    "\"Regime\" is the trailing-6-month FEDFUNDS trend as of that meeting date (same classifier used elsewhere in this app, e.g. Gap & Calendar Study) — it labels the broader cycle a meeting fell in, not literally whether that single meeting hiked, cut, or held. FEDFUNDS itself only updates monthly, so a single-meeting decision can't be isolated from this series alone.",
    "No historical hiking-regime meeting may appear in this sample if the Fed hasn't been in a real hiking trend since the study's 2023 start — that would itself be a real, meaningful finding (a live hike, if it happens, would have no recent analog in this exact dataset), not a data gap to fill by guessing.",
    "Bootstrap 95% CIs are shown per regime bucket, but small per-regime sample sizes (there are only ~26 real meetings total across 3+ years) mean most buckets should be read as directional, not statistically conclusive.",
  ];

  return {
    tickers: results,
    upcomingMeeting: {
      date: UPCOMING_FOMC_DATE,
      note: "Not included in the stats above — this meeting hasn't happened yet.",
    },
    dataLimitations,
  };
}
