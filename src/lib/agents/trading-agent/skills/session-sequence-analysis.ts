import { fetchMinuteBars } from "@/lib/data/market-data";
import { toUtcParts, SESSIONS } from "./time-windows";
import { benjaminiHochberg, bootstrapCi, zTestPValue } from "./stats-tests";
import { computeWinLossMetrics, mean, median, stdDev } from "../stats";
import type { MarketCandle } from "@/lib/data/market-data-types";
import type {
  PriorSessionDirection,
  SessionAnalysisResult,
  SessionId,
  SessionSequenceBucketResult,
  SessionSequenceEdgeId,
  SessionSequenceTradeLogRow,
  SessionStats,
} from "../types";

/**
 * Tests whether trading sessions behave as a linear sequence — does the
 * Asian session's real direction predict London's return, does London
 * predict New York's, does New York predict the next day's Asian session —
 * using the exact same BH-FDR/bootstrap/out-of-sample statistical pipeline
 * as calendar-effects.ts, just bucketed by the prior session's real
 * direction instead of by weekday/checkpoint. A genuine sequential-pattern
 * backtest, not a fabricated edge: every occurrence comes from real minute
 * bars, and a null/insignificant result is reported as such, not hidden.
 */

const FDR_ALPHA = 0.05;

const SESSION_DEFS: { id: SessionId; label: string; window: { start: number; end: number } }[] = [
  { id: "asian", label: "Asian", window: SESSIONS.ASIAN },
  { id: "london", label: "London", window: SESSIONS.LONDON },
  { id: "newYork", label: "New York", window: SESSIONS.NEW_YORK },
];

const EDGE_DEFS: { id: SessionSequenceEdgeId; label: string; priorSession: SessionId; followOnSession: SessionId; sameUtcDate: boolean }[] = [
  { id: "asianToLondon", label: "Asian → London", priorSession: "asian", followOnSession: "london", sameUtcDate: true },
  { id: "londonToNewYork", label: "London → New York", priorSession: "london", followOnSession: "newYork", sameUtcDate: true },
  { id: "newYorkToNextAsian", label: "New York → Next Asian", priorSession: "newYork", followOnSession: "asian", sameUtcDate: false },
];

interface SessionOccurrence {
  dateKey: string; // UTC calendar date the session window fell on
  openPrice: number;
  closePrice: number;
  high: number;
  low: number;
  returnPct: number;
  rangePct: number;
}

/** Buckets real minute bars into {utcDateKey -> {sessionId -> occurrence}} using each session's real UTC window. */
function buildSessionOccurrences(candles: MarketCandle[]): Map<string, Map<SessionId, SessionOccurrence>> {
  const barsByDateAndSession = new Map<string, Map<SessionId, MarketCandle[]>>();
  for (const c of candles) {
    const { dateKey, minutesSinceMidnight } = toUtcParts(c.datetime);
    for (const s of SESSION_DEFS) {
      if (minutesSinceMidnight >= s.window.start && minutesSinceMidnight < s.window.end) {
        if (!barsByDateAndSession.has(dateKey)) barsByDateAndSession.set(dateKey, new Map());
        const dayMap = barsByDateAndSession.get(dateKey)!;
        if (!dayMap.has(s.id)) dayMap.set(s.id, []);
        dayMap.get(s.id)!.push(c);
      }
    }
  }

  const result = new Map<string, Map<SessionId, SessionOccurrence>>();
  for (const [dateKey, dayMap] of barsByDateAndSession) {
    const occBySession = new Map<SessionId, SessionOccurrence>();
    for (const [sessionId, bars] of dayMap) {
      if (bars.length === 0) continue;
      const sorted = [...bars].sort((a, b) => a.datetime - b.datetime);
      const openPrice = sorted[0].open;
      const closePrice = sorted[sorted.length - 1].close;
      const high = Math.max(...sorted.map((b) => b.high));
      const low = Math.min(...sorted.map((b) => b.low));
      if (openPrice === 0) continue;
      occBySession.set(sessionId, {
        dateKey,
        openPrice,
        closePrice,
        high,
        low,
        returnPct: ((closePrice - openPrice) / openPrice) * 100,
        rangePct: ((high - low) / openPrice) * 100,
      });
    }
    result.set(dateKey, occBySession);
  }
  return result;
}

function nextUtcDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export async function runSessionSequenceAnalysis(ticker: string, lookbackDays: number): Promise<SessionAnalysisResult> {
  const symbol = ticker.trim().toUpperCase();
  const now = Date.now();
  const startMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const candles = await fetchMinuteBars(symbol, startMs, now, 60 * 30); // 30 min cache, same convention as calendar-effects.ts
  if (candles.length === 0) {
    throw new Error(`No minute bar data returned for ${symbol} — check the ticker is valid.`);
  }

  const byDate = buildSessionOccurrences(candles);
  const dataLimitations: string[] = [
    "Sessions are defined in UTC (00:00-09:00 Asian, 08:00-17:00 London, 13:00-22:00 New York) — the standard industry convention, not this app's Eastern-Time equity-session windows.",
    "A day/session is only counted if real bars fell inside that session's window — no session is fabricated or interpolated for a symbol/period without coverage.",
    "Significance uses a z-test approximation, not an exact Student's t-test (see stats-tests.ts), same documented approximation used throughout this app's other calendar-effect engines.",
  ];

  // Per-session descriptive stats (real, unconditional).
  const sessionStats: SessionStats[] = SESSION_DEFS.map(({ id, label }) => {
    const occs: SessionOccurrence[] = [];
    for (const dayMap of byDate.values()) {
      const occ = dayMap.get(id);
      if (occ) occs.push(occ);
    }
    return {
      sessionId: id,
      label,
      sampleSize: occs.length,
      meanReturnPct: mean(occs.map((o) => o.returnPct)),
      meanRangePct: mean(occs.map((o) => o.rangePct)),
    };
  });

  // Sequence buckets: for each edge, split the follow-on session's real
  // return by whether the prior session closed up or down.
  interface RawBucket {
    edgeId: SessionSequenceEdgeId;
    edgeLabel: string;
    priorDirection: PriorSessionDirection;
    rows: SessionSequenceTradeLogRow[];
  }
  const rawBuckets: RawBucket[] = [];
  for (const edge of EDGE_DEFS) {
    const up: SessionSequenceTradeLogRow[] = [];
    const down: SessionSequenceTradeLogRow[] = [];
    for (const [dateKey, dayMap] of byDate) {
      const prior = dayMap.get(edge.priorSession);
      if (!prior) continue;
      const followOnDateKey = edge.sameUtcDate ? dateKey : nextUtcDateKey(dateKey);
      const followOnDayMap = byDate.get(followOnDateKey);
      const followOn = followOnDayMap?.get(edge.followOnSession);
      if (!followOn) continue;
      const row: SessionSequenceTradeLogRow = {
        dateKey: followOnDateKey,
        edgeId: edge.id,
        priorDirection: prior.returnPct >= 0 ? "up" : "down",
        followOnReturnPct: followOn.returnPct,
        isWin: followOn.returnPct > 0,
      };
      (row.priorDirection === "up" ? up : down).push(row);
    }
    rawBuckets.push({ edgeId: edge.id, edgeLabel: edge.label, priorDirection: "up", rows: up });
    rawBuckets.push({ edgeId: edge.id, edgeLabel: edge.label, priorDirection: "down", rows: down });
  }

  const rawPValues: (number | null)[] = rawBuckets.map((b) => {
    const values = b.rows.map((r) => r.followOnReturnPct);
    const m = mean(values);
    const sd = stdDev(values);
    return m !== null && sd !== null ? zTestPValue(m, sd, values.length) : null;
  });
  const validIndices = rawPValues.map((p, i) => (p !== null ? i : -1)).filter((i): i is number => i >= 0);
  const adjustedValid = benjaminiHochberg(validIndices.map((i) => rawPValues[i] as number));
  const fdrByIndex = new Map<number, number>();
  validIndices.forEach((i, k) => fdrByIndex.set(i, adjustedValid[k]));

  const sequenceBuckets: SessionSequenceBucketResult[] = rawBuckets.map((b, i) => {
    const values = b.rows.map((r) => r.followOnReturnPct);
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
      edgeId: b.edgeId,
      edgeLabel: b.edgeLabel,
      priorDirection: b.priorDirection,
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

  const minSample = Math.min(...sequenceBuckets.map((b) => b.sampleSize));
  if (minSample < 30) {
    dataLimitations.push(
      `At least one session-sequence bucket has fewer than 30 occurrences for ${symbol} over ${lookbackDays} day(s) — treat results as directional only, not statistically reliable (n<30).`
    );
  }

  const tradeLog: SessionSequenceTradeLogRow[] = rawBuckets.flatMap((b) => b.rows);

  return { ticker: symbol, lookbackDays, sessionStats, sequenceBuckets, tradeLog, dataLimitations };
}
