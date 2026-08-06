import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { getPmVolumeSnapshot } from "./pm-volume-tracker";
import { VOLUME_DISPLACEMENT_LOOKBACK_DAYS } from "../constants";
import type { PmVolumeSnapshot, ScanResult, WatchlistEntry, WatchlistScanSummary } from "../types";

const LOOKBACK_DAYS = VOLUME_DISPLACEMENT_LOOKBACK_DAYS + 10; // small buffer for weekends/holidays

// PM-Volume needs real minute bars around the premarket window — isolated in
// its own try/catch so a failure there (or an asset class where "premarket"
// doesn't really apply, e.g. 24/5 forex) never blanks the other 3 daily-bar
// signals for the same ticker.
async function scanPmVolume(symbol: string): Promise<{ snapshot: PmVolumeSnapshot | null; error: string | null }> {
  try {
    const { snapshot } = await getPmVolumeSnapshot(symbol);
    return { snapshot, error: null };
  } catch (error) {
    return { snapshot: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function scanOne(entry: WatchlistEntry): Promise<ScanResult> {
  const pmVolume = await scanPmVolume(entry.symbol);
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
        pmVolume: pmVolume.snapshot,
        pmVolumeError: pmVolume.error,
      };
    }
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      error: null,
      volumeDisplacement: computeVolumeDisplacement(bars),
      momentum: computeMomentum(bars),
      meanReversion: computeMeanReversion(bars),
      pmVolume: pmVolume.snapshot,
      pmVolumeError: pmVolume.error,
    };
  } catch (error) {
    return {
      symbol: entry.symbol,
      assetClass: entry.assetClass,
      error: error instanceof Error ? error.message : "Unknown error",
      volumeDisplacement: null,
      momentum: null,
      meanReversion: null,
      pmVolume: pmVolume.snapshot,
      pmVolumeError: pmVolume.error,
    };
  }
}

export async function scanWatchlist(entries: WatchlistEntry[]): Promise<WatchlistScanSummary> {
  if (entries.length === 0) {
    throw new Error("Watchlist is empty — add at least one symbol before scanning.");
  }

  const results = await Promise.all(entries.map(scanOne));
  const tickersFlagged = results.filter(
    (r) => r.volumeDisplacement?.triggered || r.momentum?.triggered || r.meanReversion?.triggered || r.pmVolume?.isAnomaly
  ).length;
  const failedCount = results.filter((r) => r.error !== null).length;
  const pmVolumeFailedCount = results.filter((r) => r.pmVolumeError !== null).length;

  const dataLimitations: string[] = [
    "Watchlist-only scan — scanning the broader market isn't feasible on the free data sources this app uses (would need a paid screener API and heavy quota spend).",
    "Volume Displacement and Momentum are both computed from daily bars via whichever market-data provider is active (see src/lib/data/market-data.ts) — Alpaca by default once configured, Schwab as a dormant fallback. See ALPACA_INTEGRATION_NOTES.md / SCHWAB_INTEGRATION_NOTES.md for what's verified vs. assumed on each. Set MARKET_DATA_MOCK_MODE=true to exercise this with synthetic data instead.",
    "PM-Volume Anomaly compares today's real premarket (4am-9:30am ET) volume against a rolling average of prior days — a session concept built around a single NYSE/Nasdaq open, so it's most meaningful for equities/ETF proxies and reads as an approximation for anything without that same session structure.",
  ];
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${entries.length} symbol(s) failed to fetch — see individual error messages below.`);
  }
  if (pmVolumeFailedCount > 0) {
    dataLimitations.push(`PM-Volume Anomaly could not be computed for ${pmVolumeFailedCount} of ${entries.length} symbol(s) — see individual error messages below.`);
  }

  return {
    results,
    tickersScanned: entries.length,
    tickersFlagged,
    dataLimitations,
  };
}
