import { getDailyBars } from "./daily-bars";
import { computeMomentum, computeVolumeDisplacement } from "./scan-signals";
import { computeMeanReversion } from "./mean-reversion";
import { computeVwapMeanReversion } from "./vwap-mean-reversion";
import { getPmVolumeSnapshot } from "./pm-volume-tracker";
import { fetchMinuteBars } from "@/lib/data/market-data";
import { groupCandlesByEasternDay } from "./bar-aggregation";
import { WINDOWS, isWithin, toEasternParts } from "./time-windows";
import { VOLUME_DISPLACEMENT_LOOKBACK_DAYS } from "../constants";
import type { PmVolumeSnapshot, ScanResult, VwapMeanReversionSignal, WatchlistEntry, WatchlistScanSummary } from "../types";

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

// Same isolation pattern as scanPmVolume — a fetch failure or a session with
// no regular-hours bars yet (e.g. scanned right at market open) never blanks
// the other 3 signals for the same ticker. Only today's regular-session
// minute bars are used, same reasoning vwap-mean-reversion.ts's own doc
// comment gives for excluding thin premarket/afterhours volume.
async function scanVwapReversion(symbol: string): Promise<{ signal: VwapMeanReversionSignal | null; error: string | null }> {
  try {
    const now = Date.now();
    const bars = await fetchMinuteBars(symbol, now - 2 * 24 * 60 * 60 * 1000, now, 60);
    const days = groupCandlesByEasternDay(bars);
    if (days.length === 0) return { signal: null, error: "No recent minute-bar data returned for this symbol." };

    const today = days[days.length - 1];
    const regularBars = today.bars.filter((b) => isWithin(toEasternParts(b.datetime).minutesSinceMidnight, WINDOWS.REGULAR_SESSION));
    return { signal: computeVwapMeanReversion(regularBars), error: null };
  } catch (error) {
    return { signal: null, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function scanOne(entry: WatchlistEntry): Promise<ScanResult> {
  const pmVolume = await scanPmVolume(entry.symbol);
  const vwapReversion = await scanVwapReversion(entry.symbol);
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
        vwapMeanReversion: vwapReversion.signal,
        vwapMeanReversionError: vwapReversion.error,
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
      vwapMeanReversion: vwapReversion.signal,
      vwapMeanReversionError: vwapReversion.error,
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
      vwapMeanReversion: vwapReversion.signal,
      vwapMeanReversionError: vwapReversion.error,
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
    (r) =>
      r.volumeDisplacement?.triggered ||
      r.momentum?.triggered ||
      r.meanReversion?.triggered ||
      r.vwapMeanReversion?.triggered ||
      r.pmVolume?.isAnomaly
  ).length;
  const failedCount = results.filter((r) => r.error !== null).length;
  const pmVolumeFailedCount = results.filter((r) => r.pmVolumeError !== null).length;
  const vwapReversionFailedCount = results.filter((r) => r.vwapMeanReversionError !== null).length;

  const dataLimitations: string[] = [
    "Watchlist-only scan — scanning the broader market isn't feasible on the free data sources this app uses (would need a paid screener API and heavy quota spend).",
    "Volume Displacement and Momentum are both computed from daily bars via whichever market-data provider is active (see src/lib/data/market-data.ts) — Alpaca by default once configured, Schwab as a dormant fallback. See ALPACA_INTEGRATION_NOTES.md / SCHWAB_INTEGRATION_NOTES.md for what's verified vs. assumed on each. Set MARKET_DATA_MOCK_MODE=true to exercise this with synthetic data instead.",
    "VWAP Mean Reversion is computed from today's real regular-session (9:30am-4:00pm ET) minute bars against a session-anchored VWAP — a live intraday reading, not a backtest; see the VWAP Reversion Backtest tab for whether reversion actually followed historically.",
    "PM-Volume Anomaly compares today's real premarket (4am-9:30am ET) volume against a rolling average of prior days — a session concept built around a single NYSE/Nasdaq open, so it's most meaningful for equities/ETF proxies and reads as an approximation for anything without that same session structure.",
  ];
  if (failedCount > 0) {
    dataLimitations.push(`${failedCount} of ${entries.length} symbol(s) failed to fetch — see individual error messages below.`);
  }
  if (vwapReversionFailedCount > 0) {
    dataLimitations.push(`VWAP Mean Reversion could not be computed for ${vwapReversionFailedCount} of ${entries.length} symbol(s) — see individual error messages below.`);
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
