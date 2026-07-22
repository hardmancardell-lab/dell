import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { VOLUME_DISPLACEMENT_LOOKBACK_DAYS } from "../constants";
import type { ScanResult, WatchlistEntry, WatchlistScanSummary } from "../types";

const LOOKBACK_DAYS = VOLUME_DISPLACEMENT_LOOKBACK_DAYS + 10; // small buffer for weekends/holidays

async function scanOne(entry: WatchlistEntry): Promise<ScanResult> {
  try {
    const bars = await getDailyBars(entry.symbol, LOOKBACK_DAYS);
    if (bars.length === 0) {
      return {
        symbol: entry.symbol,
        assetClass: entry.assetClass,
        error: "No daily bar data returned for this symbol.",
        volumeDisplacement: null,
        momentum: null,
        meanReversion: null,
      };
    }
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      error: null,
      volumeDisplacement: computeVolumeDisplacement(bars),
      momentum: computeMomentum(bars),
      meanReversion: computeMeanReversion(bars),
    };
  } catch (error) {
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      error: error instanceof Error ? error.message : "Unknown error",
      volumeDisplacement: null,
      momentum: null,
      meanReversion: null,
    };
  }
}

export async function scanWatchlist(entries: WatchlistEntry[]): Promise<WatchlistScanSummary> {
  if (entries.length === 0) {
    throw new Error("Watchlist is empty — add at least one symbol before scanning.");
  }

  const results = await Promise.all(entries.map(scanOne));
  const tickersFlagged = results.filter(
    (r) => r.volumeDisplacement?.triggered || r.momentum?.triggered || r.meanReversion?.triggered
  ).length;
  const failedCount = results.filter((r) => r.error !== null).length;

  const dataLimitations: string[] = [
    "Watchlist-only scan — scanning the broader market isn't feasible on the free data sources this app uses (would need a paid screener API and heavy quota spend).",
    "Volume Displacement and Momentum are both computed from daily bars via whichever market-data provider is active (see src/lib/data/market-data.ts) — Alpaca by default once configured, Schwab as a dormant fallback. See ALPACA_INTEGRATION_NOTES.md / SCHWAB_INTEGRATION_NOTES.md for what's verified vs. assumed on each. Set MARKET_DATA_MOCK_MODE=true to exercise this with synthetic data instead.",
  ];
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${entries.length} symbol(s) failed to fetch — see individual error messages below.`);
  }

  return {
    results,
    tickersScanned: entries.length,
    tickersFlagged,
    dataLimitations,
  };
}
