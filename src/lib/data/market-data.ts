import * as alpaca from "./alpaca";
import * as schwab from "./schwab";
import * as tradier from "./tradier";
import * as oanda from "./oanda";
import * as coinbase from "./coinbase";
import {
  generateMockDailyBars,
  generateMockMinuteBars,
  generateMockOptionsChain,
  generateMockQuote,
} from "./schwab-mock";
import { aggregateCandles } from "../agents/trading-agent/skills/candle-aggregation";
import type {
  MarketBidAsk,
  MarketCandle,
  MarketCandlesResult,
  MarketOptionsChain,
  MarketQuote,
} from "./market-data-types";
import { emptyReport, isProductionRuntime } from "./provider-http";

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
  const flag = process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";
  if (!flag) return false;
  // Synthetic prices must never reach alerts, valuations or paper fills in a production build.
  if (isProductionRuntime()) {
    throw new Error("MARKET_DATA_MOCK_MODE / SCHWAB_MOCK_MODE is set in a production build. Mock data is refused in production: unset it.");
  }
  return true;
}

/** Marks generated candles as synthetic so no consumer can mistake them for market data. */
function synthCandles(candles: MarketCandle[]): MarketCandle[] {
  return candles.map((c) => ({ ...c, feed: "mock", synthetic: true }));
}

function synthQuote(q: MarketQuote): MarketQuote {
  return { ...q, feed: "mock", synthetic: true, delayed: false };
}

function getProvider(): "alpaca" | "schwab" {
  if (process.env.MARKET_DATA_PROVIDER === "schwab") return "schwab";
  if (process.env.MARKET_DATA_PROVIDER === "alpaca") return "alpaca";
  // Default: prefer Alpaca once it's configured (self-serve, no approval
  // wait); otherwise fall back to Schwab, preserving this app's original
  // default behavior until Alpaca keys are actually added.
  return process.env.ALPACA_API_KEY_ID && process.env.ALPACA_SECRET_KEY ? "alpaca" : "schwab";
}

/** ISO-4217 currencies OANDA quotes against each other. A "XXX/USD" pair whose base is not here is a crypto pair, not forex. */
const FIAT_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "CNH", "CNY", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK",
  "TRY", "ZAR", "MXN", "SGD", "HKD", "THB", "ILS", "RUB", "INR", "KRW", "BRL", "TWD", "AED", "SAR",
]);

export type SymbolKind = "crypto" | "forex" | "equity" | "unsupported";

export interface SymbolClass {
  kind: SymbolKind;
  /** The symbol in the form the chosen provider expects ("BTC-USD", "EUR/USD", "BRK.B"); the input trimmed and uppercased when unsupported. */
  symbol: string;
  /** Why the symbol is unsupported (only set when kind is "unsupported"). */
  reason?: string;
}

/**
 * Decides which asset class and provider a symbol belongs to, and normalises it. Pure and exported for the routing test.
 * - "BTC-USD" and "BTC/USD" are both crypto (Coinbase product id BTC-USD); they never go to OANDA.
 * - "EUR/USD" is forex (OANDA).
 * - Plain tickers (letters, digits, "." and "-", up to 10 chars) are equities.
 * - Index/future syntaxes ("^GSPC", "/ES", "ES=F") and crypto quoted in a non-USD currency ("BTC-EUR") are unsupported:
 *   no provider here serves them, so a clear error beats a 4xx from the equity endpoint.
 */
export function classifySymbol(input: string): SymbolClass {
  const symbol = String(input ?? "").trim().toUpperCase();
  if (symbol === "") return { kind: "unsupported", symbol, reason: "empty symbol" };
  if (/^[A-Z0-9]{2,10}-USD$/.test(symbol)) return { kind: "crypto", symbol };
  const slash = /^([A-Z0-9]{2,10})\/([A-Z]{3})$/.exec(symbol);
  if (slash) {
    const base = slash[1];
    const quote = slash[2];
    if (FIAT_CODES.has(base) && FIAT_CODES.has(quote)) return { kind: "forex", symbol };
    if (quote === "USD") return { kind: "crypto", symbol: `${base}-USD` };
    return { kind: "unsupported", symbol, reason: `${symbol} is not a forex pair or a USD crypto pair` };
  }
  if (/^[A-Z0-9]{2,10}-(EUR|GBP|JPY|USDT|USDC|BTC|ETH|CAD|AUD)$/.test(symbol)) {
    return { kind: "unsupported", symbol, reason: `${symbol}: crypto is supported only against USD (for example BTC-USD)` };
  }
  if (/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(symbol)) return { kind: "equity", symbol };
  return {
    kind: "unsupported",
    symbol,
    reason: `${symbol} is not a stock, ETF, forex pair or USD crypto symbol (index and futures syntaxes are not supported)`,
  };
}

function hasOandaToken(): boolean {
  return Boolean(process.env.OANDA_API_TOKEN);
}

/** Throws a clear error for symbols no provider serves, and for forex without an OANDA token (never falls through to the stock endpoint). */
function routeOrThrow(symbol: string): SymbolClass {
  const c = classifySymbol(symbol);
  if (c.kind === "unsupported") throw new Error(`Unsupported symbol: ${c.reason}.`);
  if (c.kind === "forex" && !hasOandaToken()) {
    throw new Error(`${c.symbol} is a forex pair and OANDA_API_TOKEN is not set, so there is no source for it (it is not sent to the stock feed).`);
  }
  return c;
}

export async function fetchMinuteBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  if (isMockMode()) return synthCandles(generateMockMinuteBars(symbol, startDateMs, endDateMs));
  const c = routeOrThrow(symbol);
  if (c.kind === "crypto") return coinbase.fetchMinuteBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
  if (c.kind === "forex") return oanda.fetchMinuteBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
  return getProvider() === "alpaca"
    ? alpaca.fetchMinuteBars(c.symbol, startDateMs, endDateMs, revalidateSeconds)
    : schwab.fetchMinuteBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
}

export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  if (isMockMode()) return synthCandles(generateMockDailyBars(symbol, startDateMs, endDateMs));
  const c = routeOrThrow(symbol);
  if (c.kind === "crypto") return coinbase.fetchDailyBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
  if (c.kind === "forex") return oanda.fetchDailyBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
  return getProvider() === "alpaca"
    ? alpaca.fetchDailyBars(c.symbol, startDateMs, endDateMs, revalidateSeconds)
    : schwab.fetchDailyBars(c.symbol, startDateMs, endDateMs, revalidateSeconds);
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
  return (await fetchBarsForTimeframeDetailed(symbol, timeframe, startMs, endMs, revalidateSeconds)).candles;
}

/** Same as fetchBarsForTimeframe, plus what was cleaned or truncated (dropped counts, warnings) and whether the data is synthetic. */
export async function fetchBarsForTimeframeDetailed(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandlesResult> {
  const bucketMs = parseTimeframeMs(timeframe);

  if (isMockMode()) {
    const raw =
      bucketMs < DAY_MS
        ? generateMockMinuteBars(symbol, startMs, endMs)
        : generateMockDailyBars(symbol, startMs, endMs);
    return {
      candles: synthCandles(aggregateCandles(raw, bucketMs)),
      report: { ...emptyReport(), synthetic: true, warnings: ["Synthetic mock data (MARKET_DATA_MOCK_MODE): these are not market prices."] },
    };
  }

  const c = routeOrThrow(symbol);

  if (c.kind === "crypto") {
    return { candles: await coinbase.fetchBarsForBucket(c.symbol, bucketMs, startMs, endMs, revalidateSeconds), report: emptyReport() };
  }

  if (c.kind === "forex") {
    return oanda.fetchBarsForTimeframeDetailed(c.symbol, timeframe, startMs, endMs, revalidateSeconds);
  }

  if (getProvider() === "alpaca") {
    return alpaca.fetchBarsForTimeframeDetailed(c.symbol, timeframe, startMs, endMs, revalidateSeconds);
  }

  // Schwab has no arbitrary-timeframe endpoint — use whichever of its two
  // supported granularities is closer, then aggregate to the exact bucket.
  const raw =
    bucketMs < DAY_MS
      ? await schwab.fetchMinuteBars(c.symbol, startMs, endMs, revalidateSeconds)
      : await schwab.fetchDailyBars(c.symbol, startMs, endMs, revalidateSeconds);
  return { candles: aggregateCandles(raw, bucketMs), report: emptyReport() };
}

/**
 * Latest price. Contract: resolves to a quote whose lastPrice is a finite number above zero, or REJECTS (NoPriceError
 * when the provider had no usable price). It never returns 0 for "unknown". `asOf`, `delayed` and `feed` describe how
 * fresh the price is; mock-mode quotes carry `synthetic: true`.
 */
export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  if (isMockMode()) return synthQuote(generateMockQuote(symbol));
  const c = routeOrThrow(symbol);
  if (c.kind === "crypto") return coinbase.fetchQuote(c.symbol);
  if (c.kind === "forex") return oanda.fetchQuote(c.symbol);
  return getProvider() === "alpaca" ? alpaca.fetchQuote(c.symbol) : schwab.fetchQuote(c.symbol);
}

/**
 * Real bid/ask for forex — used by the paper trading engine so a forex fill
 * prices off the actual spread instead of a flat guessed slippage constant.
 * No equivalent exists for equities (no provider here supplies bid/ask for
 * stocks) — that's a real, disclosed data gap, not something faked here.
 */
function generateMockBidAsk(symbol: string): MarketBidAsk {
  const quote = generateMockQuote(symbol);
  const halfSpread = quote.lastPrice * 0.0001; // synthetic, mock mode only
  return { datetime: Date.now(), bid: quote.lastPrice - halfSpread, ask: quote.lastPrice + halfSpread };
}

export async function fetchForexBidAsk(
  symbol: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketBidAsk[]> {
  if (isMockMode()) return [generateMockBidAsk(symbol)];
  const c = classifySymbol(symbol);
  if (c.kind === "forex" && hasOandaToken()) {
    return oanda.fetchBidAsk(c.symbol, startMs, endMs, revalidateSeconds);
  }
  throw new Error(`No real bid/ask source for ${symbol} — requires a forex pair and OANDA_API_TOKEN.`);
}

export async function fetchLatestForexBidAsk(symbol: string): Promise<MarketBidAsk | null> {
  if (isMockMode()) return generateMockBidAsk(symbol);
  const c = classifySymbol(symbol);
  if (c.kind === "forex" && hasOandaToken()) return oanda.fetchLatestBidAsk(c.symbol);
  return null;
}

/**
 * Live bid/ask for a crypto product from Coinbase — used by the paper trading engine so a crypto fill prices off the
 * real spread. Null when the book is not two-sided; mock mode uses the same synthetic half-spread as forex's mock.
 */
export async function fetchLatestCryptoBidAsk(symbol: string): Promise<MarketBidAsk | null> {
  if (isMockMode()) return generateMockBidAsk(symbol);
  const c = classifySymbol(symbol);
  if (c.kind === "crypto") return coinbase.fetchBidAsk(c.symbol);
  return null;
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
  if (isMockMode()) return { ...generateMockOptionsChain(symbol), feed: "mock", synthetic: true };
  const c = routeOrThrow(symbol);
  if (c.kind !== "equity") throw new Error(`Options chains exist only for stocks and ETFs, not ${c.symbol}.`);
  if (hasTradierToken()) return tradier.fetchOptionsChain(c.symbol, expirationDate);
  return getProvider() === "alpaca"
    ? alpaca.fetchOptionsChain(c.symbol, expirationDate)
    : schwab.fetchOptionsChain(c.symbol, expirationDate);
}
