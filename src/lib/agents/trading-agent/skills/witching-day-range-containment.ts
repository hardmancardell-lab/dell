import { getDailyBars } from "./daily-bars";
import { QUAD_WITCHING_DATES } from "./quad-witching-study";

export interface WitchingRangeOccurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
  zoneLabel: string;
  intrinsicPayoffPct: number;
  intrinsicPayoffPerShare: number;
  netPLPerShare: number;
  netPLPct: number;
  isWin: boolean;
}

export interface WitchingRangeContainmentResult {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  shortStrikePct: number;
  lowerLongPct: number;
  upperLongPct: number;
  shortContracts: number;
  maxProfitCondition: string;
  maxProfitPayoffPct: number;
  maxLossCondition: string;
  maxLossPayoffPct: number;
  lowerLongPremium: number;
  shortPremium: number;
  upperLongPremium: number;
  netDebitPerShare: number;
  occurrences: WitchingRangeOccurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  winCount: number;
  totalNetPLPerShare: number;
  dataLimitations: string[];
  error?: string;
}

/**
 * General intrinsic payoff (percentage points of entry price) for
 * sell-shortContracts-calls @ shortStrikePct / buy-1-call @ lowerLongPct /
 * buy-1-call @ upperLongPct, at exitPct (close as % of entry). Works
 * regardless of whether the longs bracket the short strike (a classic
 * symmetric butterfly, e.g. 95/100/105) or both sit on one side (the
 * asymmetric ratio-spread shape tested earlier, e.g. 100/105/115) — the
 * max() terms are order-independent, so no special-casing is needed.
 */
export function computeIntrinsicPayoffPct(
  exitPct: number,
  shortStrikePct: number,
  lowerLongPct: number,
  upperLongPct: number,
  shortContracts: number
): number {
  const shortLeg = -shortContracts * Math.max(exitPct - shortStrikePct, 0);
  const longLegA = Math.max(exitPct - lowerLongPct, 0);
  const longLegB = Math.max(exitPct - upperLongPct, 0);
  return shortLeg + longLegA + longLegB;
}

function zoneLabelFor(exitPct: number, sortedStrikes: number[]): string {
  const [s1, s2, s3] = sortedStrikes;
  if (exitPct <= s1) return `At/below ${s1}%`;
  if (exitPct <= s2) return `${s1}%–${s2}%`;
  if (exitPct <= s3) return `${s2}%–${s3}%`;
  return `Above ${s3}%`;
}

interface Extremum {
  payoffPct: number;
  lowBoundPct: number | null;
  highBoundPct: number | null;
  extendsBelow: boolean;
  extendsAbove: boolean;
}

/**
 * Finds the best/worst intrinsic payoff by evaluating the piecewise-linear
 * function at every strike (the only places its slope can change) plus 1pt
 * outside each end — payoff is provably flat beyond the outermost strike
 * whenever shortContracts equals the total long-contract count (true here:
 * 2 short vs. 1+1 long), so sampling 1pt further out reveals whether an
 * extremum is a single peak or an open-ended plateau.
 */
interface ExtremumRaw {
  payoffPct: number;
  atLowPct: number | null; // set when the extreme value also holds at/below the low end of the sampled range
  atHighPct: number | null; // set when it also holds at/above the high end
  atInteriorPct: number | null; // set when it's a single interior peak/trough, not a plateau touching either end
}

function findExtrema(
  shortStrikePct: number,
  lowerLongPct: number,
  upperLongPct: number,
  shortContracts: number
): { maxProfit: Extremum; maxLoss: Extremum } {
  const strikes = [shortStrikePct, lowerLongPct, upperLongPct].sort((a, b) => a - b);
  const candidates = [strikes[0] - 1, strikes[0], strikes[1], strikes[2], strikes[2] + 1];
  const payoffs = candidates.map((c) => computeIntrinsicPayoffPct(c, shortStrikePct, lowerLongPct, upperLongPct, shortContracts));

  function analyze(extremeValue: number, pickInteriorIdx: (a: number, b: number) => number): ExtremumRaw {
    const EPS = 1e-9;
    const atLow = Math.abs(payoffs[0] - extremeValue) < EPS;
    const atHigh = Math.abs(payoffs[payoffs.length - 1] - extremeValue) < EPS;
    if (atLow || atHigh) {
      return {
        payoffPct: extremeValue,
        atLowPct: atLow ? strikes[0] : null,
        atHighPct: atHigh ? strikes[2] : null,
        atInteriorPct: null,
      };
    }
    // Genuinely interior (e.g. the classic butterfly's single peak at the short strike) — report the first matching sample.
    let idx = 0;
    for (let i = 1; i < payoffs.length; i++) if (pickInteriorIdx(payoffs[i], payoffs[idx]) === payoffs[i]) idx = i;
    return { payoffPct: extremeValue, atLowPct: null, atHighPct: null, atInteriorPct: candidates[idx] };
  }

  const maxValue = Math.max(...payoffs);
  const minValue = Math.min(...payoffs);
  const maxRaw = analyze(maxValue, (a, b) => Math.max(a, b));
  const minRaw = analyze(minValue, (a, b) => Math.min(a, b));

  function toExtremum(raw: ExtremumRaw): Extremum {
    if (raw.atInteriorPct !== null) {
      return { payoffPct: raw.payoffPct, lowBoundPct: raw.atInteriorPct, highBoundPct: null, extendsBelow: false, extendsAbove: false };
    }
    return {
      payoffPct: raw.payoffPct,
      lowBoundPct: raw.atLowPct,
      highBoundPct: raw.atHighPct,
      extendsBelow: raw.atLowPct !== null,
      extendsAbove: raw.atHighPct !== null,
    };
  }

  return { maxProfit: toExtremum(maxRaw), maxLoss: toExtremum(minRaw) };
}

function describeCondition(e: Extremum): string {
  if (e.extendsBelow && e.extendsAbove) return `Close at or below ${e.lowBoundPct}% of entry, or at or above ${e.highBoundPct}% of entry`;
  if (e.extendsBelow) return `Close at or below ${e.lowBoundPct}% of entry`;
  if (e.extendsAbove) return `Close at or above ${e.highBoundPct}% of entry`;
  return `Close exactly at ${e.lowBoundPct}% of entry`;
}

/**
 * Real price-containment + intrinsic-payoff check for a witching-day option
 * spread — defaults to the classic symmetric butterfly (buy 1C @ 95%, sell
 * 2C @ 100%, buy 1C @ 105%) but works for any 3-strike shape. Deliberately
 * does NOT compute full spread P&L: no historical options-pricing data
 * exists anywhere for free (see TRADIER_INTEGRATION_NOTES.md) to know the
 * real net debit/credit paid on a past date, so intrinsicPayoffPct/
 * intrinsicPayoffPerShare are the payoff-at-expiration diagram value only.
 */
export async function runWitchingRangeContainmentStudy(
  ticker: string,
  lowerBoundPct: number = 0,
  upperBoundPct: number = 15,
  lookbackYears: number = 3,
  shortStrikePct: number = 100,
  lowerLongPct: number = 95,
  upperLongPct: number = 105,
  shortContracts: number = 2,
  lowerLongPremium: number = 7,
  shortPremium: number = 4,
  upperLongPremium: number = 2
): Promise<WitchingRangeContainmentResult> {
  const symbol = ticker.trim().toUpperCase();
  const sortedStrikes = [shortStrikePct, lowerLongPct, upperLongPct].sort((a, b) => a - b);
  const netDebitPerShare = lowerLongPremium + upperLongPremium - shortContracts * shortPremium;

  const { maxProfit, maxLoss } = findExtrema(shortStrikePct, lowerLongPct, upperLongPct, shortContracts);
  const maxProfitCondition = describeCondition(maxProfit);
  const maxLossCondition = describeCondition(maxLoss);

  const dataLimitations: string[] = [
    "Entry is modeled at the prior real trading day's close, exit at the witching day's own close (open the day before, close on witching day) — the closing print, not a specific intraday \"last hour\" price, since minute bars don't reliably reach back this many years on this app's data provider (only ~3 months) while daily closes do.",
    "intrinsicPayoffPct/intrinsicPayoffPerShare are the payoff-at-expiration diagram value only (in percentage points of entry price, and priced in real dollars off that date's real entry close) — they exclude the premium paid/received at entry.",
    `netPLPerShare/netPLPct apply the SAME fixed premiums (buy 1C @ $${lowerLongPremium.toFixed(2)}, sell ${shortContracts}C @ $${shortPremium.toFixed(2)} each, buy 1C @ $${upperLongPremium.toFixed(2)} — net debit $${netDebitPerShare.toFixed(2)}/share) to every historical date, regardless of that date's real stock price or implied volatility. No historical options-pricing data exists anywhere this app could source for free (see TRADIER_INTEGRATION_NOTES.md), so real premiums from those actual dates aren't recoverable — this is a fixed, user-specified assumption applied uniformly, not what the spread would really have cost each time. A $${netDebitPerShare.toFixed(2)} debit is trivial against a $880 stock (2024-03-15) but meaningful against a $118 one (2025-03-21) — netPLPct normalizes for that by expressing the result as a % of that date's own entry price.`,
    `Strikes: sell ${shortContracts}C @ ${shortStrikePct}%, buy 1C @ ${lowerLongPct}%, buy 1C @ ${upperLongPct}% of entry. Max profit condition (intrinsic): ${maxProfitCondition} (${maxProfit.payoffPct.toFixed(2)} pts). Max loss condition (intrinsic): ${maxLossCondition} (${maxLoss.payoffPct.toFixed(2)} pts).`,
  ];

  try {
    const bars = await getDailyBars(symbol, Math.round(lookbackYears * 365 + 30));
    if (bars.length < 2) {
      throw new Error(`No real daily bar history returned for ${symbol}.`);
    }
    const sortedDateKeys = bars.map((b) => b.dateKey);

    function indexOnOrAfter(dateKey: string): number | null {
      for (let i = 0; i < sortedDateKeys.length; i++) {
        if (sortedDateKeys[i] >= dateKey) return i;
      }
      return null;
    }

    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - lookbackYears);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const pastWitchingDates = QUAD_WITCHING_DATES.filter((d) => d < today && d >= cutoffKey);

    const occurrences: WitchingRangeOccurrence[] = [];
    let skipped = 0;

    for (const eventDate of pastWitchingDates) {
      const i = indexOnOrAfter(eventDate);
      if (i === null || i === 0) {
        skipped++;
        continue;
      }
      const rec = bars[i];
      if (rec.dateKey !== eventDate) {
        skipped++;
        continue;
      }
      const priorBar = bars[i - 1];
      if (priorBar.close <= 0) {
        skipped++;
        continue;
      }

      const changePct = ((rec.close - priorBar.close) / priorBar.close) * 100;
      const outcome: WitchingRangeOccurrence["outcome"] =
        changePct < lowerBoundPct ? "dropped-below-entry" : changePct > upperBoundPct ? "exceeded-upper-wing" : "within-range";

      const exitPct = 100 + changePct;
      const zoneLabel = zoneLabelFor(exitPct, sortedStrikes);
      const intrinsicPayoffPct = computeIntrinsicPayoffPct(exitPct, shortStrikePct, lowerLongPct, upperLongPct, shortContracts);
      const intrinsicPayoffPerShare = (intrinsicPayoffPct / 100) * priorBar.close;
      const netPLPerShare = intrinsicPayoffPerShare - netDebitPerShare;
      const netPLPct = (netPLPerShare / priorBar.close) * 100;

      occurrences.push({
        witchingDate: eventDate,
        entryDate: priorBar.dateKey,
        entryClose: priorBar.close,
        exitClose: rec.close,
        changePct,
        outcome,
        zoneLabel,
        intrinsicPayoffPct,
        intrinsicPayoffPerShare,
        netPLPerShare,
        netPLPct,
        isWin: netPLPerShare > 0,
      });
    }

    if (skipped > 0) {
      dataLimitations.push(`${skipped} witching date(s) in the requested window were skipped — no real bar found on/around that date (before the ticker's listing, or a data gap).`);
    }

    const withinRangeCount = occurrences.filter((o) => o.outcome === "within-range").length;
    const droppedBelowCount = occurrences.filter((o) => o.outcome === "dropped-below-entry").length;
    const exceededAboveCount = occurrences.filter((o) => o.outcome === "exceeded-upper-wing").length;
    const winCount = occurrences.filter((o) => o.isWin).length;
    const totalNetPLPerShare = occurrences.reduce((s, o) => s + o.netPLPerShare, 0);

    return {
      ticker: symbol,
      lowerBoundPct,
      upperBoundPct,
      lookbackYears,
      shortStrikePct,
      lowerLongPct,
      upperLongPct,
      shortContracts,
      maxProfitCondition,
      maxProfitPayoffPct: maxProfit.payoffPct,
      maxLossCondition,
      maxLossPayoffPct: maxLoss.payoffPct,
      lowerLongPremium,
      shortPremium,
      upperLongPremium,
      netDebitPerShare,
      occurrences,
      withinRangeCount,
      droppedBelowCount,
      exceededAboveCount,
      pctWithinRange: occurrences.length > 0 ? (withinRangeCount / occurrences.length) * 100 : null,
      winCount,
      totalNetPLPerShare,
      dataLimitations,
    };
  } catch (err) {
    return {
      ticker: symbol,
      lowerBoundPct,
      upperBoundPct,
      lookbackYears,
      shortStrikePct,
      lowerLongPct,
      upperLongPct,
      shortContracts,
      maxProfitCondition,
      maxProfitPayoffPct: maxProfit.payoffPct,
      maxLossCondition,
      maxLossPayoffPct: maxLoss.payoffPct,
      lowerLongPremium,
      shortPremium,
      upperLongPremium,
      netDebitPerShare,
      occurrences: [],
      withinRangeCount: 0,
      droppedBelowCount: 0,
      exceededAboveCount: 0,
      pctWithinRange: null,
      winCount: 0,
      totalNetPLPerShare: 0,
      dataLimitations,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
