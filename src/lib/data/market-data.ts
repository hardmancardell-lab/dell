import * as alpaca from "./alpaca";
import * as schwab from "./schwab";
import * as tradier from "./tradier";
import * as oanda from "./oanda";
import {
  generateMockDailyBars,
  generateMockMinuteBars,
  generateMockOptionsChain,
  generateMockQuote,
} from "./schwab-mock";
import { aggregateCandles } from "../agents/trading-agent/skills/candle-aggregation";
import type {
  MarketCandle,
  MarketOptionsChain,
  MarketQuote,
} from "./market-data-types";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Parses Alpaca's "{N}Min"/"{N}Hour"/"1Day"/"1Week" timeframe strings into a bucket width in ms. */
function parseTimeframeMs(timeframe: string): number {
  const match = /^(\d+)(Min|Hour|Day|Week)$/.exec(timeframe);
  if (!match) return DAY_MS;
  const n = Number(match[1]);
  switch (match[2]) {
    case "Min":
      return n * MINUTE_MS;
    case "Hour":
      return n * HOUR_MS;
    case "Week":
      return n * 7 * DAY_MS;
    default:
      return n * DAY_MS;
  }
}

/**
 * Single entry point for market data — every trading-agent skill file should
 * import from here, not directly from "./schwab" or "./alpaca". This is the
 * only file that decides which broker (or synthetic data) actually answers
 * a given call, so swapping/adding providers never touches consuming code.
 */

function isMockMode(): boolean {
  // MARKET_DATA_MOCK_MODE is the new neutral flag; SCHWAB_MOCK_MODE is also
  // honored so the existing mock-mode instructions in
  // SCHWAB_INTEGRATION_NOTES.md keep working verbatim, unchanged.
  return process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";
}

function getProvider(): "alpaca" | "schwab" {
  if (process.env.MARKET_DATA_PROVIDER === "schwab") return "schwab";
  if (process.env.MARKET_DATA_PROVIDER === "alpaca") return "alpaca";
  // Default: prefer Alpaca once it's configured (self-serve, no approval
  // wait); otherwise fall back to Schwab, preserving this app's original
  // default behavior until Alpaca keys are actually added.
  return process.env.ALPACA_API_KEY_ID && process.env.ALPACA_SECRET_KEY ? "alpaca" : "schwab";
}

// "EUR/USD"-shaped symbols only — same convention this app already uses in
// watchlist placeholder text and MAJOR_PAIR_KEYWORDS (geopolitical-news.ts).
function isForexSymbol(symbol: string): boolean {
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol.trim().toUpperCase());
}

function hasOandaToken(): boolean {
  return Boolean(process.env.OANDA_API_TOKEN);
}

export async function fetchMinuteBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  if (isMockMode()) return generateMockMinuteBars(symbol, startDateMs, endDateMs);
  if (isForexSymbol(symbol) && hasOandaToken()) {
    return oanda.fetchMinuteBars(symbol, startDateMs, endDateMs, revalidateSeconds);
  }
  return getProvider() === "alpaca"
    ? alpaca.fetchMinuteBars(symbol, startDateMs, endDateMs, revalidateSeconds)
    : schwab.fetchMinuteBars(symbol, startDateMs, endDateMs, revalidateSeconds);
}

export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  if (isMockMode()) return generateMockDailyBars(symbol, startDateMs, endDateMs);
  if (isForexSymbol(symbol) && hasOandaToken()) {
    return oanda.fetchDailyBars(symbol, startDateMs, endDateMs, revalidateSeconds);
  }
  return getProvider() === "alpaca"
    ? alpaca.fetchDailyBars(symbol, startDateMs, endDateMs, revalidateSeconds)
    : schwab.fetchDailyBars(symbol, startDateMs, endDateMs, revalidateSeconds);
}

/**
 * Arbitrary-timeframe charting entry point (chart-bars.ts). Real Alpaca calls
 * pass the timeframe straight through (Alpaca aggregates server-side). Mock
 * mode has no native support for arbitrary granularities — schwab-mock.ts's
 * generators only produce 1-minute or 1-day bars — so it generates the
 * finer of the two and aggregates up via candle-aggregation.ts. Schwab
 * fallback only has 1Min/1Day itself; anything else degrades to whichever
 * of those is closer and lets the caller know via the thrown shape being
 * unchanged (no silent wrong-granularity data — the aggregation step still
 * produces correctly-labeled buckets, just from coarser raw data than Alpaca
 * would supply).
 */
export async function fetchBarsForTimeframe(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  const bucketMs = parseTimeframeMs(timeframe);

  if (isMockMode()) {
    const raw =
      bucketMs < DAY_MS
        ? generateMockMinuteBars(symbol, startMs, endMs)
        : generateMockDailyBars(symbol, startMs, endMs);
    return aggregateCandles(raw, bucketMs);
  }

  if (isForexSymbol(symbol) && hasOandaToken()) {
    return oanda.fetchBarsForTimeframe(symbol, timeframe, startMs, endMs, revalidateSeconds);
  }

  if (getProvider() === "alpaca") {
    return alpaca.fetchBarsForTimeframe(symbol, timeframe, startMs, endMs, revalidateSeconds);
  }

  // Schwab has no arbitrary-timeframe endpoint — use whichever of its two
  // supported granularities is closer, then aggregate to the exact bucket.
  const raw =
    bucketMs < DAY_MS
      ? await schwab.fetchMinuteBars(symbol, startMs, endMs, revalidateSeconds)
      : await schwab.fetchDailyBars(symbol, startMs, endMs, revalidateSeconds);
  return aggregateCandles(raw, bucketMs);
}

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  if (isMockMode()) return generateMockQuote(symbol);
  if (isForexSymbol(symbol) && hasOandaToken()) return oanda.fetchQuote(symbol);
  return getProvider() === "alpaca" ? alpaca.fetchQuote(symbol) : schwab.fetchQuote(symbol);
}

function hasTradierToken(): boolean {
  return Boolean(process.env.TRADIER_ACCESS_TOKEN);
}

/**
 * Options chain has its own preference order, separate from getProvider():
 * Tradier is preferred whenever configured because it's the only provider
 * that actually supplies real open interest (Alpaca hardcodes it to 0;
 * Schwab would have it too, once/if real credentials exist, but stays
 * dormant until then). This doesn't affect fetchMinuteBars/fetchDailyBars/
 * fetchQuote, which stay on Alpaca/Schwab exactly as before — Tradier only
 * ever supplies options-chain data in this app.
 */
export async function fetchOptionsChain(
  symbol: string,
  expirationDate?: string
): Promise<MarketOptionsChain> {
  if (isMockMode()) return generateMockOptionsChain(symbol);
  if (hasTradierToken()) return tradier.fetchOptionsChain(symbol, expirationDate);
  return getProvider() === "alpaca"
    ? alpaca.fetchOptionsChain(symbol, expirationDate)
    : schwab.fetchOptionsChain(symbol, expirationDate);
}
