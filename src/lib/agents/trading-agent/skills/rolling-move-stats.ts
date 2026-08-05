import { getDailyBars } from "./daily-bars";
import type { AssetClass, RollingMoveStatsResult, RollingMoveWindow, RollingMoveWindowStats } from "../types";

const DEFAULT_WINDOWS: RollingMoveWindow[] = [20, 40, 100];

/**
 * Real rolling up-day/down-day/absolute average move, computed from actual
 * daily bars — not the symmetric folded-normal shortcut (E[|R|] =
 * sigma*sqrt(2/pi)), which assumes zero skew and would hide exactly the
 * directional asymmetry a strategy would want to see.
 */
export async function getRollingMoveStats(
  ticker: string,
  assetClass: AssetClass,
  windows: RollingMoveWindow[] = DEFAULT_WINDOWS
): Promise<RollingMoveStatsResult> {
  const symbol = ticker.trim().toUpperCase();
  const maxWindow = Math.max(...windows);
  // Pull comfortably more calendar days than the largest trading-day window
  // needs, so weekends/holidays don't leave the window short.
  const bars = await getDailyBars(symbol, Math.ceil(maxWindow * 1.6) + 10);

  const closes = bars.map((b) => b.close);
  const dailyReturnsPct: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      dailyReturnsPct.push(((closes[i] - closes[i - 1]) / closes[i - 1]) * 100);
    }
  }

  const dataLimitations: string[] = [];
  const windowStats: RollingMoveWindowStats[] = windows.map((windowDays) => {
    const slice = dailyReturnsPct.slice(-windowDays);
    if (slice.length < windowDays) {
      dataLimitations.push(
        `${windowDays}-day window requested but only ${slice.length} trading day(s) of return history were available for ${symbol}.`
      );
    }
    if (slice.length === 0) {
      return { windowDays, tradingDaysUsed: 0, avgAbsMovePct: null, avgUpDayPct: null, upDayCount: 0, avgDownDayPct: null, downDayCount: 0 };
    }

    const upDays = slice.filter((r) => r > 0);
    const downDays = slice.filter((r) => r < 0);
    const avgAbsMovePct = slice.reduce((sum, r) => sum + Math.abs(r), 0) / slice.length;

    return {
      windowDays,
      tradingDaysUsed: slice.length,
      avgAbsMovePct,
      avgUpDayPct: upDays.length > 0 ? upDays.reduce((sum, r) => sum + r, 0) / upDays.length : null,
      upDayCount: upDays.length,
      avgDownDayPct: downDays.length > 0 ? downDays.reduce((sum, r) => sum + r, 0) / downDays.length : null,
      downDayCount: downDays.length,
    };
  });

  return { ticker: symbol, assetClass, windows: windowStats, dataLimitations };
}
