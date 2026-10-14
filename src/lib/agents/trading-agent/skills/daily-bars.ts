import { fetchDailyBars } from "@/lib/data/market-data";
import { isCryptoSymbol } from "@/lib/data/coinbase";
import { toEasternParts } from "./time-windows";
import type { DailyBar } from "../types";

/**
 * Fetches and shapes daily OHLCV bars for a symbol, most recent last.
 * Shared by both watchlist scan signals so they see identical bar data.
 */
export async function getDailyBars(symbol: string, lookbackDays: number): Promise<DailyBar[]> {
  const now = Date.now();
  const startMs = now - lookbackDays * 24 * 60 * 60 * 1000;
  const candles = await fetchDailyBars(symbol, startMs, now, 60 * 30); // 30 min cache

  // Crypto trades around the clock and its daily candles open at 00:00 UTC, so a day is the UTC date; converting that
  // instant to Eastern would label every candle with the previous day.
  const crypto = isCryptoSymbol(symbol);
  return candles
    .map((c) => ({
      dateKey: crypto ? new Date(c.datetime).toISOString().slice(0, 10) : toEasternParts(c.datetime).dateKey,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
