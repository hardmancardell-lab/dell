import { getSecurityAnalysis } from "./security-analysis";
import { getMacroOverview } from "./macro-overview";
import type { WatchlistOverviewEntry, WatchlistOverviewResult } from "../types";

const STRONG_THRESHOLD = 6; // of 7 Graham criteria

/**
 * The honest version of "alerts" for an app with no background server
 * process anywhere: real flags computed from real data the moment the page
 * loads, not a fake push notification. Runs the Graham Checklist for every
 * watchlisted ticker in parallel (scanOne-style per-ticker isolation, same
 * idiom as watchlist-scan.ts in the trading agent) and reuses
 * getMacroOverview()'s already-computed stance synthesis for a one-line
 * banner — zero new macro logic, just surfaced alongside the user's own
 * tracked tickers instead of only on the separate Stance & Details tab.
 */
export async function getWatchlistOverview(symbols: string[]): Promise<WatchlistOverviewResult> {
  const dataLimitations: string[] = [];

  const [entries, macro] = await Promise.all([
    Promise.all(
      symbols.map(async (symbol): Promise<WatchlistOverviewEntry> => {
        try {
          const analysis = await getSecurityAnalysis(symbol);
          const passCount = analysis.checklist.filter((c) => c.passed).length;
          return {
            symbol,
            checklistPassCount: passCount,
            checklistTotal: analysis.checklist.length,
            isStrong: passCount >= STRONG_THRESHOLD,
            error: null,
          };
        } catch (error) {
          return {
            symbol,
            checklistPassCount: null,
            checklistTotal: 7,
            isStrong: false,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    ),
    getMacroOverview(),
  ]);

  const failedCount = entries.filter((e) => e.error !== null).length;
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${symbols.length} watchlisted ticker(s) failed to analyze — see individual error messages below.`);
  }

  return {
    entries,
    macroStanceLabel: macro.stance.label,
    macroStanceRationale: macro.stance.rationale,
    dataLimitations,
  };
}
