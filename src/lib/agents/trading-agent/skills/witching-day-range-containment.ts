import { getDailyBars } from "./daily-bars";
import { QUAD_WITCHING_DATES } from "./quad-witching-study";

export interface WitchingRangeOccurrence {
  witchingDate: string;
  entryDate: string;
  entryClose: number;
  exitClose: number;
  changePct: number;
  outcome: "within-range" | "dropped-below-entry" | "exceeded-upper-wing";
}

export interface WitchingRangeContainmentResult {
  ticker: string;
  lowerBoundPct: number;
  upperBoundPct: number;
  lookbackYears: number;
  occurrences: WitchingRangeOccurrence[];
  withinRangeCount: number;
  droppedBelowCount: number;
  exceededAboveCount: number;
  pctWithinRange: number | null;
  dataLimitations: string[];
  error?: string;
}

/**
 * Real price-containment check for a witching-day option spread whose short
 * strike sits at entry price (0%) and whose furthest long leg sits at
 * upperBoundPct above it — e.g. sell 2C @ 100%, buy 1C @ 105%, buy 1C @ 115%
 * means the "stays in range" question is really "did price close between 0%
 * and +15% of where it opened." Deliberately does NOT compute butterfly P&L:
 * no historical options-pricing data exists anywhere for free (see
 * TRADIER_INTEGRATION_NOTES.md) to know the real net debit paid, so this
 * checks only whether the underlying itself stayed inside the strike band —
 * a real, useful precursor question, not the full trade economics.
 */
export async function runWitchingRangeContainmentStudy(
  ticker: string,
  lowerBoundPct: number = 0,
  upperBoundPct: number = 15,
  lookbackYears: number = 3
): Promise<WitchingRangeContainmentResult> {
  const symbol = ticker.trim().toUpperCase();

  const dataLimitations: string[] = [
    "Entry is modeled at the prior real trading day's close, exit at the witching day's own close (open the day before, close on witching day) — the closing print, not a specific intraday \"last hour\" price, since minute bars don't reliably reach back this many years on this app's data provider (only ~3 months) while daily closes do.",
    "This checks price containment only — whether the underlying's close stayed inside the strike band — not actual spread P&L. No historical options-pricing data exists anywhere this app could source for free (see TRADIER_INTEGRATION_NOTES.md), so the real net debit paid to open the spread isn't modeled here.",
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

      occurrences.push({
        witchingDate: eventDate,
        entryDate: priorBar.dateKey,
        entryClose: priorBar.close,
        exitClose: rec.close,
        changePct,
        outcome,
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
