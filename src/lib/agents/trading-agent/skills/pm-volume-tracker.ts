import { fetchMinuteBars } from "@/lib/data/market-data";
import { groupCandlesByEasternDay, sumVolumeInWindow } from "./bar-aggregation";
import { WINDOWS } from "./time-windows";
import { mean } from "../stats";
import { getHistoricalComposite } from "./historical-composite";
import { MARKET_STRUCTURE_GAPS } from "./market-structure-gaps";
import { PM_VOLUME_ANOMALY_MULTIPLE, ROLLING_AVERAGE_LOOKBACK_DAYS } from "../constants";
import type { PmVolumeAnomalyReport, PmVolumeSnapshot } from "../types";

export async function getPmVolumeSnapshot(
  ticker: string
): Promise<{ snapshot: PmVolumeSnapshot; dataLimitations: string[] }> {
  const symbol = ticker.trim().toUpperCase();
  const dataLimitations: string[] = [];

  const now = Date.now();
  // *2 buffer accounts for weekends/holidays within the calendar window.
  const lookbackMs = ROLLING_AVERAGE_LOOKBACK_DAYS * 2 * 24 * 60 * 60 * 1000;
  const bars = await fetchMinuteBars(symbol, now - lookbackMs, now, 60);

  const days = groupCandlesByEasternDay(bars);
  if (days.length === 0) {
    throw new Error(`No recent bar data returned for "${symbol}".`);
  }

  const today = days[days.length - 1];
  const priorDays = days.slice(0, -1).slice(-ROLLING_AVERAGE_LOOKBACK_DAYS);

  const todayPremarketVolume = sumVolumeInWindow(today.bars, WINDOWS.PREMARKET);
  const priorPmVolumes = priorDays.map((d) => sumVolumeInWindow(d.bars, WINDOWS.PREMARKET));
  const rollingAverageVolume = mean(priorPmVolumes);

  if (priorDays.length < ROLLING_AVERAGE_LOOKBACK_DAYS) {
    dataLimitations.push(
      `Rolling average is based on ${priorDays.length} prior trading day(s), not the requested ${ROLLING_AVERAGE_LOOKBACK_DAYS} — limited by how much minute-bar history Schwab's API returned for this window.`
    );
  }

  const multiple =
    rollingAverageVolume && rollingAverageVolume > 0 ? todayPremarketVolume / rollingAverageVolume : null;
  const isAnomaly = multiple !== null && multiple >= PM_VOLUME_ANOMALY_MULTIPLE;

  const snapshot: PmVolumeSnapshot = {
    ticker: symbol,
    asOfDateKey: today.dateKey,
    todayPremarketVolume,
    rollingAverageVolume,
    lookbackDays: priorDays.length,
    multiple,
    isAnomaly,
    anomalyThreshold: PM_VOLUME_ANOMALY_MULTIPLE,
  };

  return { snapshot, dataLimitations };
}

export async function getPmVolumeAnomalyReport(ticker: string): Promise<PmVolumeAnomalyReport> {
  const { snapshot, dataLimitations } = await getPmVolumeSnapshot(ticker);
  // Always run the historical composite (including the HOD/LOD timing
  // distribution and per-occurrence trade log), not just when today happens
  // to also be flagged — the point is reviewing the pattern across past
  // anomaly days regardless of today's live status.
  const composite = await getHistoricalComposite(snapshot.ticker);

  return {
    ticker: snapshot.ticker,
    snapshot,
    composite,
    notAvailable: MARKET_STRUCTURE_GAPS,
    dataLimitations,
  };
}
