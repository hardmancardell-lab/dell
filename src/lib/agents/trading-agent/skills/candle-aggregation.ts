import type { MarketCandle } from "@/lib/data/market-data-types";

/**
 * Buckets candles into larger OHLCV candles by a fixed-width time bucket.
 * Only needed for mock mode — schwab-mock.ts's generators only produce
 * 1-minute or 1-day granularity, so anything else (5min, 4hour, 1week, ...)
 * needs client/server-side aggregation. Real Alpaca calls skip this entirely
 * since Alpaca aggregates arbitrary timeframes server-side.
 *
 * Bucket boundaries are plain epoch-ms multiples of bucketMs — a reasonable
 * approximation for synthetic test data (not calendar/timezone-aware), same
 * tolerance already accepted elsewhere in this codebase for mock-only paths.
 */
export function aggregateCandles(candles: MarketCandle[], bucketMs: number): MarketCandle[] {
  if (candles.length === 0 || bucketMs <= 0) return [];

  const sorted = [...candles].sort((a, b) => a.datetime - b.datetime);
  const buckets = new Map<number, MarketCandle[]>();

  for (const c of sorted) {
    const bucketStart = Math.floor(c.datetime / bucketMs) * bucketMs;
    if (!buckets.has(bucketStart)) buckets.set(bucketStart, []);
    buckets.get(bucketStart)!.push(c);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([datetime, bucketCandles]) => ({
      datetime,
      open: bucketCandles[0].open,
      high: Math.max(...bucketCandles.map((c) => c.high)),
      low: Math.min(...bucketCandles.map((c) => c.low)),
      close: bucketCandles[bucketCandles.length - 1].close,
      volume: bucketCandles.reduce((sum, c) => sum + c.volume, 0),
    }));
}
