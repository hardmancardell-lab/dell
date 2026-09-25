import { getDailyBars } from "./daily-bars";
import { QUAD_WITCHING_DATES } from "./quad-witching-study";

export type PayoffZone = "at-or-below-short" | "short-to-first-long" | "between-longs" | "above-far-long";

export interface WitchingRangeOccurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
  zone: PayoffZone;
  intrinsicPayoffPct: number; // percentage points of entry price, ignoring premium paid/received
  intrinsicPayoffPerShare: number; // same figure priced in real dollars using that date's real entryClose
}

export interface WitchingRangeContainmentResult {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  shortStrikePct: number;
  longStrike1Pct: number;
  longStrike2Pct: number;
  shortContracts: number;
  maxProfitCondition: string;
  maxProfitPayoffPct: number;
  maxLossCondition: string;
  maxLossPayoffPct: number;
  occurrences: WitchingRangeOccurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  dataLimitations: string[];
  error?: string;
}

/**
 * Intrinsic payoff (in percentage points of the entry price) for a
 * sell-shortContracts-calls @ shortStrikePct / buy-1-call @ longStrike1Pct /
 * buy-1-call @ longStrike2Pct structure, given exitPct (the close as % of
 * entry, e.g. 101.17 for a +1.17% day). Piecewise, same math a real options
 * desk would use for the payoff diagram — ignores premium paid/received
 * entirely (see dataLimitations: no historical options-pricing data exists
 * anywhere for free to know the real net debit/credit on a past date).
 */
export function computeIntrinsicPayoffPct(
  exitPct: number,
  shortStrikePct: number,
  longStrike1Pct: number,
  longStrike2Pct: number,
  shortContracts: number
): number {
  const shortLeg = -shortContracts * Math.max(exitPct - shortStrikePct, 0);
  const longLeg1 = Math.max(exitPct - longStrike1Pct, 0);
  const longLeg2 = Math.max(exitPct - longStrike2Pct, 0);
  return shortLeg + longLeg1 + longLeg2;
}

function classifyZone(exitPct: number, shortStrikePct: number, longStrike1Pct: number, longStrike2Pct: number): PayoffZone {
  if (exitPct <= shortStrikePct) return "at-or-below-short";
  if (exitPct <= longStrike1Pct) return "short-to-first-long";
  if (exitPct <= longStrike2Pct) return "between-longs";
  return "above-far-long";
}

/**
 * Real price-containment + intrinsic-payoff check for a witching-day option
 * spread whose short strike sits at entry price (100%) and whose two long
 * legs sit above it — e.g. sell 2C @ 100%, buy 1C @ 105%, buy 1C @ 115%.
 * Deliberately does NOT compute full spread P&L: no historical
 * options-pricing data exists anywhere for free (see
 * TRADIER_INTEGRATION_NOTES.md) to know the real net debit/credit paid on a
 * past date, so intrinsicPayoffPct/intrinsicPayoffPerShare below are the
 * payoff-at-expiration diagram value only — real profit/loss also includes
 * whatever premium changed hands at entry, which this can't source.
 */
export async function runWitchingRangeContainmentStudy(
  ticker: string,
  lowerBoundPct: number = 0,
  upperBoundPct: number = 15,
  lookbackYears: number = 3,
  shortStrikePct: number = 100,
  longStrike1Pct: number = 105,
  longStrike2Pct: number = 115,
  shortContracts: number = 2
): Promise<WitchingRangeContainmentResult> {
  const symbol = ticker.trim().toUpperCase();

  // Beyond longStrike2Pct the payoff is flat whenever shortContracts equals
  // the total long-contract count (delta-neutral past the far strike, true
  // for this 2-short/1-long/1-long structure) — evaluating exactly at
  // longStrike2Pct already lands on that flat plateau.
  const maxProfitPayoffPct = computeIntrinsicPayoffPct(shortStrikePct, shortStrikePct, longStrike1Pct, longStrike2Pct, shortContracts);
  const maxLossPayoffPct = computeIntrinsicPayoffPct(longStrike2Pct, shortStrikePct, longStrike1Pct, longStrike2Pct, shortContracts);

  const dataLimitations: string[] = [
    "Entry is modeled at the prior real trading day's close, exit at the witching day's own close (open the day before, close on witching day) — the closing print, not a specific intraday \"last hour\" price, since minute bars don't reliably reach back this many years on this app's data provider (only ~3 months) while daily closes do.",
    "intrinsicPayoffPct/intrinsicPayoffPerShare are the payoff-at-expiration diagram value only (in percentage points of entry price, and priced in real dollars off that date's real entry close) — they exclude the premium paid/received at entry. No historical options-pricing data exists anywhere this app could source for free (see TRADIER_INTEGRATION_NOTES.md), so real net P&L (premium collected/paid, netted against this payoff) isn't modeled here.",
    `Max profit condition assumes the position is held to expiration with the underlying at or below the short strike (${shortStrikePct}% of entry) — intrinsic payoff is flat at ${maxProfitPayoffPct.toFixed(2)} points regardless of how far below. Max loss condition assumes the underlying finishes at or above the far long strike (${longStrike2Pct}% of entry), where the payoff caps at ${maxLossPayoffPct.toFixed(2)} points (delta-neutral beyond that point since ${shortContracts} short contract(s) are fully offset by ${shortContracts} long contracts total).`,
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

      const exitPct = 100 + changePct; // entry always treated as the 100% reference point, matching shortStrikePct's convention
      const zone = classifyZone(exitPct, shortStrikePct, longStrike1Pct, longStrike2Pct);
      const intrinsicPayoffPct = computeIntrinsicPayoffPct(exitPct, shortStrikePct, longStrike1Pct, longStrike2Pct, shortContracts);
      const intrinsicPayoffPerShare = (intrinsicPayoffPct / 100) * priorBar.close;

      occurrences.push({
        witchingDate: eventDate,
        entryDate: priorBar.dateKey,
        entryClose: priorBar.close,
        exitClose: rec.close,
        changePct,
        outcome,
        zone,
        intrinsicPayoffPct,
        intrinsicPayoffPerShare,
      });
    }

    if (skipped > 0) {
      dataLimitations.push(`${skipped} witching date(s) in the requested window were skipped — no real bar found on/around that date (before the ticker's listing, or a data gap).`);
    }

    const withinRangeCount = occurrences.filter((o) => o.outcome === "within-range").length;
    const droppedBelowCount = occurrences.filter((o) => o.outcome === "dropped-below-entry").length;
    const exceededAboveCount = occurrences.filter((o) => o.outcome === "exceeded-upper-wing").length;

    return {
      ticker: symbol,
      lowerBoundPct,
      upperBoundPct,
      lookbackYears,
      shortStrikePct,
      longStrike1Pct,
      longStrike2Pct,
      shortContracts,
      maxProfitCondition: `Close at or below ${shortStrikePct}% of entry (flat or down)`,
      maxProfitPayoffPct,
      maxLossCondition: `Close at or above ${longStrike2Pct}% of entry (up ${(longStrike2Pct - 100).toFixed(0)}%+)`,
      maxLossPayoffPct,
      occurrences,
      withinRangeCount,
      droppedBelowCount,
      exceededAboveCount,
      pctWithinRange: occurrences.length > 0 ? (withinRangeCount / occurrences.length) * 100 : null,
      dataLimitations,
    };
  } catch (err) {
    return {
      ticker: symbol,
      lowerBoundPct,
      upperBoundPct,
      lookbackYears,
      shortStrikePct,
      longStrike1Pct,
      longStrike2Pct,
      shortContracts,
      maxProfitCondition: `Close at or below ${shortStrikePct}% of entry (flat or down)`,
      maxProfitPayoffPct,
      maxLossCondition: `Close at or above ${longStrike2Pct}% of entry (up ${(longStrike2Pct - 100).toFixed(0)}%+)`,
      maxLossPayoffPct,
      occurrences: [],
      withinRangeCount: 0,
      droppedBelowCount: 0,
      exceededAboveCount: 0,
      pctWithinRange: null,
      dataLimitations,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
