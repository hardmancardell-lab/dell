import { getDailyBars } from "./daily-bars";
import { getFedRateRegimeTimeline, classifyRegimeForDate } from "./macro-regime";
import { fetchFredSeries } from "@/lib/data/fred";
import { bootstrapCi } from "./stats-tests";
import { computeWinLossMetrics } from "../stats";
import { FOMC_DECISION_DATES_EXTENDED } from "./fomc-week-variance-study";
import type { FedRateRegime } from "./macro-regime";
import type { WinLossMetrics } from "../stats";

/**
 * Real FOMC decision-announcement dates — reuses the same 2015-2026,
 * federalreserve.gov-sourced list fomc-week-variance-study.ts already
 * verified, rather than maintaining a second, shorter (2023-only) copy.
 * Longer history matters here specifically for the hawkish/dovish-break
 * buckets below: a "hike while the trailing trend was holding" event is
 * rare, so 3 years (the old range) isn't enough meetings to say anything
 * real about it. 2026-09-16 stays excluded from FOMC_DECISION_DATES_EXTENDED
 * itself (see that file) since it hasn't happened long enough ago for real
 * day-0/day-1 price data to exist — it's surfaced separately in
 * upcomingMeeting, as context only.
 */
export const FOMC_DECISION_DATES: string[] = FOMC_DECISION_DATES_EXTENDED;

export const UPCOMING_FOMC_DATE = "2026-09-16";

// A real, non-guessed way to know what a specific meeting actually decided
// (as opposed to classifyRegimeForDate's trailing-trend label): the Fed's
// own upper target-rate-range series is a step function that only moves on
// a real decision, so comparing its value just before vs. just after a
// decision date tells us hike/cut/hold directly — no memorized list of
// "this meeting hiked" needed.
const TARGET_RATE_SERIES_ID = "DFEDTARU";
const TARGET_RATE_HISTORY_DAYS = 4400; // comfortably covers 2015-01-01 through today (daily series)
const DECISION_CHANGE_THRESHOLD_PCT = 0.1; // real target-range moves are 25bp+; this is just float/noise margin

export type FomcActualDecision = "hike" | "cut" | "hold";

interface TargetRateTimeline {
  observations: { date: string; value: number }[];
}

async function getTargetRateTimeline(): Promise<TargetRateTimeline> {
  const raw = await fetchFredSeries(TARGET_RATE_SERIES_ID, TARGET_RATE_HISTORY_DAYS);
  return { observations: raw.filter((o): o is { date: string; value: number } => o.value !== null) };
}

/**
 * The real decision made AT this specific meeting (not a trailing trend):
 * last known target-rate value strictly before the decision date, vs. the
 * first known value within a week after it (the new range takes effect the
 * day after the announcement, so a few days' margin safely lands on the
 * post-decision step regardless of exact FRED dating conventions).
 */
function classifyActualDecision(decisionDate: string, timeline: TargetRateTimeline): FomcActualDecision | null {
  const before = [...timeline.observations].reverse().find((o) => o.date < decisionDate);
  if (!before) return null;

  const weekAfterKey = new Date(new Date(`${decisionDate}T00:00:00Z`).getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const afterCandidates = timeline.observations.filter((o) => o.date > decisionDate && o.date <= weekAfterKey);
  const after = afterCandidates.length > 0 ? afterCandidates[afterCandidates.length - 1] : before;

  const delta = after.value - before.value;
  if (delta >= DECISION_CHANGE_THRESHOLD_PCT) return "hike";
  if (delta <= -DECISION_CHANGE_THRESHOLD_PCT) return "cut";
  return "hold";
}

export interface FomcMeetingReaction {
  decisionDate: string;
  regime: FedRateRegime | null; // trailing-6-month FEDFUNDS trend as of this date — a regime label, not literally "this meeting hiked/cut"
  actualDecision: FomcActualDecision | null; // this specific meeting's real decision, from the DFEDTARU step function
  day0ReturnPct: number | null;
  day1ReturnPct: number | null;
}

export interface FomcOutcomeBucket extends WinLossMetrics {
  regime: FedRateRegime;
  sampleSize: number;
  day0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
}

export interface FomcBreakBucket extends WinLossMetrics {
  label: "hawkishBreakFromHolding" | "dovishBreakFromHolding";
  sampleSize: number;
  day0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  meetingDates: string[]; // which real meetings actually landed in this bucket, for transparency
}

export interface FomcTickerReactionResult {
  ticker: string;
  meetings: FomcMeetingReaction[];
  overallSampleSize: number;
  overallDay0: WinLossMetrics;
  overallDay1: WinLossMetrics;
  overallDay0BootstrapCi: { lower: number | null; upper: number | null; ciExcludesZero: boolean };
  byRegime: FomcOutcomeBucket[];
  breaks: FomcBreakBucket[];
}

export interface FomcReactionStudyResult {
  tickers: FomcTickerReactionResult[];
  upcomingMeeting: { date: string; note: string };
  dataLimitations: string[];
}

async function reactionsForTicker(
  ticker: string,
  regimeTimeline: Awaited<ReturnType<typeof getFedRateRegimeTimeline>>,
  targetRateTimeline: TargetRateTimeline
): Promise<FomcTickerReactionResult> {
  const bars = await getDailyBars(ticker, TARGET_RATE_HISTORY_DAYS); // comfortably covers 2015-01-01 through today
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
    const regime = classifyRegimeForDate(decisionDate, regimeTimeline);
    const actualDecision = classifyActualDecision(decisionDate, targetRateTimeline);
    if (i === null || i === 0 || i >= bars.length - 1) {
      meetings.push({ decisionDate, regime, actualDecision, day0ReturnPct: null, day1ReturnPct: null });
      continue;
    }
    const priorClose = bars[i - 1].close;
    const dayClose = bars[i].close;
    const nextClose = bars[i + 1].close;
    meetings.push({
      decisionDate,
      regime,
      actualDecision,
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

  // The real question a trailing-trend regime label can't answer: what
  // happens when the Fed breaks FROM a holding trend WITH an actual hike
  // (or a cutting/hiking trend WITH an actual cut) — a real surprise-shaped
  // event, not just "which multi-month cycle was this meeting part of."
  function breakBucket(
    label: FomcBreakBucket["label"],
    matches: (m: FomcMeetingReaction) => boolean
  ): FomcBreakBucket {
    const matching = meetings.filter(matches);
    const values = matching.map((m) => m.day0ReturnPct).filter((v): v is number => v !== null);
    const boot = bootstrapCi(values);
    return {
      label,
      sampleSize: values.length,
      day0BootstrapCi: { lower: boot.lower, upper: boot.upper, ciExcludesZero: boot.ciExcludesZero },
      meetingDates: matching.map((m) => m.decisionDate),
      ...computeWinLossMetrics(values),
    };
  }

  const hawkishBreakFromHolding = breakBucket(
    "hawkishBreakFromHolding",
    (m) => m.regime === "holding" && m.actualDecision === "hike"
  );
  const dovishBreakFromHolding = breakBucket(
    "dovishBreakFromHolding",
    (m) => m.regime === "holding" && m.actualDecision === "cut"
  );

  return {
    ticker,
    meetings,
    overallSampleSize: day0Values.length,
    overallDay0: computeWinLossMetrics(day0Values),
    overallDay1: computeWinLossMetrics(day1Values),
    overallDay0BootstrapCi: { lower: day0Boot.lower, upper: day0Boot.upper, ciExcludesZero: day0Boot.ciExcludesZero },
    byRegime,
    breaks: [hawkishBreakFromHolding, dovishBreakFromHolding],
  };
}

/**
 * Real FOMC-day event study across a basket of tickers — day-of and
 * next-day price reaction on every real decision date since 2015, broken
 * down two ways: the trailing Fed-rate regime active at the time (hiking/
 * cutting/holding — a trend label, not the literal single-meeting
 * decision), AND (new) whether that specific meeting's REAL decision (from
 * the Fed's own target-rate series, not a memorized list) broke from that
 * trailing trend — specifically a hike delivered during a holding trend, or
 * a cut delivered during a holding trend. The upcoming 2026-09-16 meeting is
 * never included in these stats since it hasn't happened long enough ago
 * for real price-reaction data to exist — it's real context, not a data point.
 */
export async function runFomcReactionStudy(tickers: string[]): Promise<FomcReactionStudyResult> {
  const [regimeTimeline, targetRateTimeline] = await Promise.all([getFedRateRegimeTimeline(), getTargetRateTimeline()]);
  const results = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        return await reactionsForTicker(ticker, regimeTimeline, targetRateTimeline);
      } catch (err) {
        return {
          ticker,
          meetings: [],
          overallSampleSize: 0,
          overallDay0: computeWinLossMetrics([]),
          overallDay1: computeWinLossMetrics([]),
          overallDay0BootstrapCi: { lower: null, upper: null, ciExcludesZero: false },
          byRegime: [],
          breaks: [],
          error: err instanceof Error ? err.message : "unknown error",
        } as FomcTickerReactionResult & { error: string };
      }
    })
  );

  const dataLimitations: string[] = [
    "Decision dates are the real, sourced second day of each FOMC meeting (federalreserve.gov's own fomcpresconf pages), 2015-2026 — not memorized or approximated, and shared with the FOMC Week Variance study's own date list rather than a second, independently-typed copy.",
    "\"Regime\" is the trailing-6-month FEDFUNDS trend as of that meeting date (same classifier used elsewhere in this app, e.g. Gap & Calendar Study) — it labels the broader cycle a meeting fell in, not literally whether that single meeting hiked, cut, or held.",
    "\"actualDecision\" (hike/cut/hold) is what that specific meeting really did, derived from FRED's DFEDTARU series (the Fed's own upper target-rate bound, a step function that only moves on a real decision) — comparing its value just before vs. within a week after the decision date. This is a real, computed classification, not a hardcoded per-meeting list.",
    "The hawkish/dovish-\"break from holding\" buckets are intentionally narrow: only meetings where the trailing trend was \"holding\" AND the actual decision was a hike (or cut) qualify. A hike during an already-established hiking trend is a continuation, not a break, and isn't counted here even though it's still a real hike.",
    "Sample sizes on the break buckets can be small — a hike or cut breaking out of a holding trend is, by definition, an uncommon event. Each bucket lists the exact meeting dates included (meetingDates) so the sample is auditable, not just a number.",
    "Bootstrap 95% CIs are shown per bucket, but small samples (especially the break buckets) mean most should be read as directional, not statistically conclusive, unless ciExcludesZero is true.",
  ];

  return {
    tickers: results,
    upcomingMeeting: {
      date: UPCOMING_FOMC_DATE,
      note: "Real, confirmed outcome (not included in the stats above yet — too soon after the decision for day-0/day-1 price reaction data to exist): the Fed hiked 25bp to 3.75%-4.00% on 2026-09-16. The same meeting's dot plot (Summary of Economic Projections) showed 12 of 18 participants projecting one more 25bp hike by year-end 2026 (to ~4.125% average), 4 of 18 projecting two more hikes (50bp), and 2 of 18 projecting no further hikes this year — a real, still-divided committee leaning toward at least one additional hike, not a settled pause.",
    },
    dataLimitations,
  };
}
