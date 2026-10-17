import { NoPriceError, isUsablePrice, DELAYED_AFTER_MS } from "./market-data-types";
import type { MarketBidAsk, MarketCandle, MarketCandlesResult, MarketQuote } from "./market-data-types";
import { cleanCandles, logReport, providerJson, snapWindow } from "./provider-http";

// LIVE account endpoint — confirmed live this session: the user's token
// returned 401 against the practice environment (api-fxpractice.oanda.com)
// and 200 with real data against this one, meaning it's a live-account
// token, not a practice/demo one. Explicitly confirmed with the user before
// wiring this in. IMPORTANT: this app has zero order-placement code
// anywhere — every function in this file is a read-only GET against
// instrument/candle data. Never add trade-execution code against this base
// URL without a fresh, explicit safety conversation — it is a real-money
// account, not a sandbox.
const BASE_URL = "https://api-fxtrade.oanda.com";

/**
 * NOTE: field names/endpoint shapes were verified live this session (see
 * OANDA_INTEGRATION_NOTES.md for the real confirmed response shape) — no
 * longer purely docs-based assumptions like the rest of this file's history.
 */

function getToken(): string {
  const token = process.env.OANDA_API_TOKEN;
  if (!token) {
    throw new Error(
      "OANDA_API_TOKEN is not set. Sign up for a free practice account at hub.oanda.com/apply/demo (no funding required), generate a v20 API token, and add it to .env.local."
    );
  }
  return token;
}

/** "EUR/USD" (this app's convention) -> "EUR_USD" (OANDA's instrument format). */
function toOandaInstrument(symbol: string): string {
  return symbol.trim().toUpperCase().replace("/", "_");
}

async function fetchOanda<T>(
  path: string,
  params: Record<string, string>,
  revalidateSeconds: number
): Promise<T> {
  const token = getToken();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return providerJson<T>(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, { provider: "OANDA", path, revalidateSeconds });
}

interface OandaCandle {
  time: string;
  volume: number; // tick count, not traded volume — forex is OTC, no consolidated tape
  complete: boolean;
  mid?: { o: string; h: string; l: string; c: string }; // OANDA returns OHLC as strings
  bid?: { o: string; h: string; l: string; c: string };
  ask?: { o: string; h: string; l: string; c: string };
}

interface OandaCandlesResponse {
  instrument: string;
  granularity: string;
  candles: OandaCandle[];
}

// This app's timeframe strings -> OANDA's granularity codes. OANDA also
// supports S5/S10/S15/S30 (down to 5-second candles) — finer than anything
// this app currently requests — deliberately not exposed yet (see the Phase
// 3 plan's "deliberately not built" note on per-asset-class timeframe presets).
const GRANULARITY_MAP: Record<string, string> = {
  "1Min": "M1",
  "5Min": "M5",
  "10Min": "M10",
  "15Min": "M15",
  "30Min": "M30",
  "1Hour": "H1",
  "4Hour": "H4",
  "1Day": "D",
  "1Week": "W",
};

function toCandle(c: OandaCandle): MarketCandle {
  // A missing mid price stays NaN (never 0) so cleanCandles drops the candle instead of treating it as a real price.
  const datetime = Date.parse(c.time);
  return {
    datetime,
    open: parseFloat(c.mid?.o ?? "NaN"),
    high: parseFloat(c.mid?.h ?? "NaN"),
    low: parseFloat(c.mid?.l ?? "NaN"),
    close: parseFloat(c.mid?.c ?? "NaN"),
    volume: Number(c.volume),
    feed: "oanda-mid",
    delayed: false,
  };
}

// OANDA's real, documented cap: at most 5000 candles per request (confirmed
// live — a from/to range implying more than this returns a 400 "Maximum
// value for 'count' exceeded"). GRANULARITY_MS lets fetchBarsForTimeframe
// chunk a wide date range into multiple sequential requests instead of
// silently failing on e.g. a 90-day 1-minute request (129,600 implied bars).
const GRANULARITY_MS: Record<string, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M10: 10 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 3_600_000,
  H4: 4 * 3_600_000,
  D: 86_400_000,
  W: 7 * 86_400_000,
};
const MAX_CANDLES_PER_REQUEST = 5000;

export async function fetchBarsForTimeframeDetailed(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandlesResult> {
  const granularity = GRANULARITY_MAP[timeframe] ?? "D";
  const instrument = toOandaInstrument(symbol);
  const barMs = GRANULARITY_MS[granularity] ?? 86_400_000;
  const chunkMs = MAX_CANDLES_PER_REQUEST * barMs;
  // Snap to the cache window so equal requests build an identical URL (callers pass Date.now()-based windows).
  const win = snapWindow(startMs, endMs, revalidateSeconds);

  const allCandles: OandaCandle[] = [];
  let chunkStart = win.startMs;
  while (chunkStart < win.endMs) {
    const chunkEnd = Math.min(chunkStart + chunkMs, win.endMs);
    const data = await fetchOanda<OandaCandlesResponse>(
      `/v3/instruments/${instrument}/candles`,
      {
        granularity,
        price: "M", // mid prices
        from: new Date(chunkStart).toISOString(),
        to: new Date(chunkEnd).toISOString(),
      },
      revalidateSeconds
    );
    allCandles.push(...(data.candles ?? []));
    chunkStart = chunkEnd;
  }

  // Only fully-closed candles — the in-progress "current" candle (complete:
  // false) would otherwise show a misleading partial bar.
  const { candles, report } = cleanCandles(allCandles.filter((c) => c.complete).map(toCandle), `OANDA ${instrument} ${granularity}`);
  logReport(report);
  return { candles, report };
}

export async function fetchBarsForTimeframe(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return (await fetchBarsForTimeframeDetailed(symbol, timeframe, startMs, endMs, revalidateSeconds)).candles;
}

export async function fetchMinuteBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return fetchBarsForTimeframe(symbol, "1Min", startDateMs, endDateMs, revalidateSeconds);
}

export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return fetchBarsForTimeframe(symbol, "1Day", startDateMs, endDateMs, revalidateSeconds);
}

/**
 * Real bid/ask candles (price="BA", confirmed supported by OANDA's own API
 * alongside the mid-only "M" this app otherwise requests) over an arbitrary
 * date range — works for both a live "current" quote (see fetchLatestBidAsk
 * below) and for re-pricing a historical evaluation window (a resting paper
 * order that triggers against yesterday's bars should fill at that moment's
 * real spread, not today's). Read-only GET, same as every other function in
 * this file — never wired to any order-placement endpoint.
 */
export async function fetchBidAsk(symbol: string, startMs: number, endMs: number, revalidateSeconds: number): Promise<MarketBidAsk[]> {
  const instrument = toOandaInstrument(symbol);
  const win = snapWindow(startMs, endMs, revalidateSeconds);
  const data = await fetchOanda<OandaCandlesResponse>(
    `/v3/instruments/${instrument}/candles`,
    {
      granularity: "M1",
      price: "BA",
      from: new Date(win.startMs).toISOString(),
      to: new Date(win.endMs).toISOString(),
    },
    revalidateSeconds
  );
  return (data.candles ?? [])
    .filter((c) => c.complete && c.bid && c.ask)
    .map((c) => ({ datetime: Date.parse(c.time), bid: parseFloat(c.bid!.c), ask: parseFloat(c.ask!.c) }))
    .filter((b) => Number.isFinite(b.datetime) && isUsablePrice(b.bid) && isUsablePrice(b.ask) && b.ask >= b.bid)
    .sort((a, b) => a.datetime - b.datetime);
}

/** The most recent real bid/ask, for a market order filling right now. */
export async function fetchLatestBidAsk(symbol: string): Promise<MarketBidAsk | null> {
  const now = Date.now();
  const bars = await fetchBidAsk(symbol, now - 10 * 60 * 1000, now, 15);
  return bars.length > 0 ? bars[bars.length - 1] : null;
}

/**
 * Derived from the most recent 1-minute candle's close rather than a
 * separate pricing call — OANDA's real-time pricing endpoint is
 * account-scoped (/v3/accounts/{accountID}/pricing), which would need this
 * app to also store an OANDA account ID for no real benefit here; the last
 * candle's close is a perfectly reasonable "current price" proxy.
 */
export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const now = Date.now();
  const sym = symbol.trim().toUpperCase();
  const candles = await fetchBarsForTimeframe(symbol, "1Min", now - 10 * 60 * 1000, now, 15);
  const last = candles[candles.length - 1];
  // Weekend, holiday, or the gap before the first complete candle: no candle means no price, not a price of 0.
  if (!last || !isUsablePrice(last.close)) throw new NoPriceError("OANDA", sym, "no complete 1-minute candle in the last 10 minutes (market closed?)");
  const asOf = last.datetime + 60_000; // the candle's close time: its open time plus one minute
  return {
    symbol: sym,
    lastPrice: last.close,
    totalVolume: last.volume,
    asOf,
    delayed: now - asOf > DELAYED_AFTER_MS,
    feed: "oanda-m1-close",
  };
}
