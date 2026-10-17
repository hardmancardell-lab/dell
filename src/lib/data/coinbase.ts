import { aggregateCandles } from "../agents/trading-agent/skills/candle-aggregation";
import { NoPriceError, isUsablePrice, DELAYED_AFTER_MS } from "./market-data-types";
import type { MarketBidAsk, MarketCandle, MarketQuote } from "./market-data-types";
import { cleanCandles, logReport, providerJson, snapWindow } from "./provider-http";

/**
 * Crypto price history from Coinbase Exchange's public market-data API (no key, real exchange trades, 24/7). Symbols
 * are Coinbase product ids such as "BTC-USD". Volume is Coinbase's own, one venue of many, and is in coins, not dollars.
 * Daily candles open at 00:00 UTC. The API returns at most 300 candles per request, so longer ranges are fetched in
 * windows, a few at a time.
 */

const BASE_URL = "https://api.exchange.coinbase.com";
const MAX_CANDLES_PER_REQUEST = 300;
const PARALLEL_REQUESTS = 4;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Candle sizes Coinbase serves natively, in seconds. Anything else is built by combining a smaller native size. */
const NATIVE_GRANULARITIES_SEC = [60, 300, 900, 3600, 21600, 86400];
/** The epoch (a Thursday) shifted to a Monday 00:00 UTC, so weekly candles start on Mondays. */
const MONDAY_OFFSET_MS = 4 * DAY_MS;

/** "BTC-USD", "ETH-USD": a coin ticker, a dash and USD. No equity or forex symbol has this shape. */
export function isCryptoSymbol(symbol: string): boolean {
  return /^[A-Z0-9]{2,10}-USD$/.test(symbol.trim().toUpperCase());
}

/** Largest native candle size (seconds) that divides the wanted bucket evenly, or null when none does. */
export function pickGranularitySec(bucketMs: number): number | null {
  if (bucketMs >= WEEK_MS) return 86400;
  const fits = NATIVE_GRANULARITIES_SEC.filter((g) => g * 1000 <= bucketMs && bucketMs % (g * 1000) === 0);
  return fits.length > 0 ? Math.max(...fits) : null;
}

/** Consecutive [start, end] windows of at most 300 candles each, oldest first, covering [startMs, endMs]. */
export function planWindows(startMs: number, endMs: number, granularitySec: number): { startMs: number; endMs: number }[] {
  const span = MAX_CANDLES_PER_REQUEST * granularitySec * 1000;
  const windows: { startMs: number; endMs: number }[] = [];
  for (let s = startMs; s < endMs; s += span) windows.push({ startMs: s, endMs: Math.min(s + span, endMs) });
  return windows;
}

/** Coinbase rows are [time(s), low, high, open, close, volume], newest first. */
export function parseCandles(rows: unknown): MarketCandle[] {
  if (!Array.isArray(rows)) return [];
  const out: MarketCandle[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [t, low, high, open, close, volume] = r.map(Number);
    if (![t, low, high, open, close, volume].every(Number.isFinite)) continue;
    if (low <= 0 || high <= 0 || open <= 0 || close <= 0 || volume < 0 || high < low) continue;
    out.push({ datetime: t * 1000, open, high, low, close, volume, feed: "coinbase", delayed: false });
  }
  return out;
}

async function getJson(path: string, revalidateSeconds: number): Promise<unknown> {
  return providerJson<unknown>(
    `${BASE_URL}${path}`,
    { headers: { "User-Agent": "dellegate-research/1.0", Accept: "application/json" } },
    { provider: "Coinbase", path: path.split("?")[0], revalidateSeconds }
  );
}

async function fetchCandles(symbol: string, granularitySec: number, startMs: number, endMs: number, revalidateSeconds: number): Promise<MarketCandle[]> {
  const product = symbol.trim().toUpperCase();
  const win = snapWindow(startMs, endMs, revalidateSeconds); // stable URLs inside one cache window
  const windows = planWindows(win.startMs, win.endMs, granularitySec);
  const byTime = new Map<number, MarketCandle>();
  for (let i = 0; i < windows.length; i += PARALLEL_REQUESTS) {
    const batch = windows.slice(i, i + PARALLEL_REQUESTS);
    const results = await Promise.all(
      batch.map((w) =>
        getJson(
          `/products/${encodeURIComponent(product)}/candles?granularity=${granularitySec}&start=${new Date(w.startMs).toISOString()}&end=${new Date(w.endMs).toISOString()}`,
          revalidateSeconds,
        ),
      ),
    );
    for (const rows of results) for (const c of parseCandles(rows)) byTime.set(c.datetime, c);
  }
  const { candles, report } = cleanCandles([...byTime.values()], `Coinbase ${product} ${granularitySec}s`);
  logReport(report);
  return candles;
}

export async function fetchDailyBars(symbol: string, startMs: number, endMs: number, revalidateSeconds: number): Promise<MarketCandle[]> {
  return fetchCandles(symbol, 86400, startMs, endMs, revalidateSeconds);
}

export async function fetchMinuteBars(symbol: string, startMs: number, endMs: number, revalidateSeconds: number): Promise<MarketCandle[]> {
  return fetchCandles(symbol, 60, startMs, endMs, revalidateSeconds);
}

/** Combines candles into wider ones; weekly buckets start on Monday 00:00 UTC rather than on the epoch's Thursday. */
export function aggregateCryptoCandles(candles: MarketCandle[], bucketMs: number): MarketCandle[] {
  if (bucketMs === WEEK_MS) {
    const shifted = candles.map((c) => ({ ...c, datetime: c.datetime - MONDAY_OFFSET_MS }));
    return aggregateCandles(shifted, bucketMs).map((c) => ({ ...c, datetime: c.datetime + MONDAY_OFFSET_MS }));
  }
  return aggregateCandles(candles, bucketMs);
}

/** Any bucket width the chart presets ask for (5, 10, 15, 30 min, 1h, 4h, 1d, 1w), built from the largest native size that fits. */
export async function fetchBarsForBucket(symbol: string, bucketMs: number, startMs: number, endMs: number, revalidateSeconds: number): Promise<MarketCandle[]> {
  const g = pickGranularitySec(bucketMs);
  if (g === null) throw new Error(`Coinbase has no candle size that builds a ${Math.round(bucketMs / 60000)}-minute bucket.`);
  const base = await fetchCandles(symbol, g, startMs, endMs, revalidateSeconds);
  return g * 1000 === bucketMs ? base : aggregateCryptoCandles(base, bucketMs);
}

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const product = symbol.trim().toUpperCase();
  const j = (await getJson(`/products/${encodeURIComponent(product)}/ticker`, 15)) as { price?: string; volume?: string; time?: string };
  const price = Number(j.price);
  if (!isUsablePrice(price)) throw new NoPriceError("Coinbase", product);
  const t = j.time ? Date.parse(j.time) : NaN;
  const asOf = Number.isFinite(t) ? t : undefined;
  return {
    symbol: product,
    lastPrice: price,
    totalVolume: Number(j.volume) || 0,
    feed: "coinbase",
    ...(asOf !== undefined ? { asOf, delayed: Date.now() - asOf > DELAYED_AFTER_MS } : {}),
  };
}

/** Live best bid and ask from the same ticker endpoint; null when Coinbase returns no usable two-sided book. */
export async function fetchBidAsk(symbol: string): Promise<MarketBidAsk | null> {
  const product = symbol.trim().toUpperCase();
  const j = (await getJson(`/products/${encodeURIComponent(product)}/ticker`, 5)) as { bid?: string; ask?: string };
  const bid = Number(j.bid);
  const ask = Number(j.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) return null;
  return { datetime: Date.now(), bid, ask };
}
