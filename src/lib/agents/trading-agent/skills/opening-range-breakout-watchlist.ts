import { runOrbBacktest } from "./opening-range-breakout";
import type { AssetClass, OrbScanResult, OrbWatchlistSummary, WatchlistEntry } from "../types";

const DEFAULT_ALLOWED_ASSET_CLASSES: AssetClass[] = ["equity"];

/**
 * Watchlist-wide ORB scan — mirrors watchlist-scan.ts's scanOne try/catch
 * isolation exactly (one bad symbol never breaks the batch). Scoped by
 * default to equity entries — the opening range is an NYSE/Nasdaq session
 * concept — but callable with a wider allowedAssetClasses list, since
 * commodity/futures ETF proxies trade on the same NYSE/Nasdaq session and
 * the concept genuinely applies to them too.
 */
async function scanOneOrb(entry: WatchlistEntry, openingRangeMinutes: 5 | 15 | 30, lookbackMonths: number): Promise<OrbScanResult> {
  try {
    const orb = await runOrbBacktest(entry.symbol, openingRangeMinutes, lookbackMonths);
    return { symbol: entry.symbol, assetClass: entry.assetClass, error: null, orb };
  } catch (error) {
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      error: error instanceof Error ? error.message : "Unknown error",
      orb: null,
    };
  }
}

export async function scanWatchlistOrb(
  entries: WatchlistEntry[],
  openingRangeMinutes: 5 | 15 | 30,
  lookbackMonths: number,
  allowedAssetClasses: AssetClass[] = DEFAULT_ALLOWED_ASSET_CLASSES
): Promise<OrbWatchlistSummary> {
  const scopedEntries = entries.filter((e) => allowedAssetClasses.includes(e.assetClass));
  if (scopedEntries.length === 0) {
    throw new Error(
      `No ${allowedAssetClasses.join("/")} symbols on this watchlist — add some on the Dashboard tab first.`
    );
  }

  const results = await Promise.all(scopedEntries.map((e) => scanOneOrb(e, openingRangeMinutes, lookbackMonths)));
  const failedCount = results.filter((r) => r.error !== null).length;
  const tickersWithBreakoutToday = results.filter(
    (r) => r.orb?.todaySnapshot?.breakoutDirection === "long" || r.orb?.todaySnapshot?.breakoutDirection === "short"
  ).length;

  const dataLimitations: string[] = [
    "The opening range is fundamentally an NYSE/Nasdaq session concept (the first N minutes after the 9:30am ET open) — equities and commodity/futures ETF proxies share that session, but forex trades 24/5 with no single daily open, so this reads differently for forex entries (see the note above if this scan includes any).",
    "Minute-bar pulls across an entire watchlist can approach this app's free-tier rate limit (200 req/min on Alpaca, see ALPACA_INTEGRATION_NOTES.md) — a large watchlist with a long lookback is the highest-risk combination for a 429; one rate-limited symbol shows up only in its own error field, it doesn't abort the batch.",
  ];
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${scopedEntries.length} symbol(s) failed to scan — see individual error messages below.`);
  }

  return {
    results,
    openingRangeMinutes,
    lookbackMonths,
    tickersScanned: scopedEntries.length,
    tickersWithBreakoutToday,
    dataLimitations,
  };
}
