import type { MarketCandle, MarketQuote } from "./market-data-types";

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

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OANDA request failed for ${path}: ${res.status} ${body}`);
  }

  return (await res.json()) as T;
}

interface OandaCandle {
  time: string;
  volume: number; // tick count, not traded volume — forex is OTC, no consolidated tape
  complete: boolean;
  mid?: { o: string; h: string; l: string; c: string }; // OANDA returns OHLC as strings
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
  return {
    datetime: Date.parse(c.time),
    open: parseFloat(c.mid?.o ?? "0"),
    high: parseFloat(c.mid?.h ?? "0"),
    low: parseFloat(c.mid?.l ?? "0"),
    close: parseFloat(c.mid?.c ?? "0"),
    volume: c.volume,
  };
}

export async function fetchBarsForTimeframe(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  const granularity = GRANULARITY_MAP[timeframe] ?? "D";
  const instrument = toOandaInstrument(symbol);

  const data = await fetchOanda<OandaCandlesResponse>(
    `/v3/instruments/${instrument}/candles`,
    {
      granularity,
      price: "M", // mid prices
      from: new Date(startMs).toISOString(),
      to: new Date(endMs).toISOString(),
    },
    revalidateSeconds
  );

  // Only fully-closed candles — the in-progress "current" candle (complete:
  // false) would otherwise show a misleading partial bar.
  return (data.candles ?? []).filter((c) => c.complete).map(toCandle);
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
 * Derived from the most recent 1-minute candle's close rather than a
 * separate pricing call — OANDA's real-time pricing endpoint is
 * account-scoped (/v3/accounts/{accountID}/pricing), which would need this
 * app to also store an OANDA account ID for no real benefit here; the last
 * candle's close is a perfectly reasonable "current price" proxy.
 */
export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const now = Date.now();
  const candles = await fetchBarsForTimeframe(symbol, "1Min", now - 10 * 60 * 1000, now, 15);
  const last = candles[candles.length - 1];
  return {
    symbol: symbol.trim().toUpperCase(),
    lastPrice: last?.close ?? 0,
    totalVolume: last?.volume ?? 0,
  };
}
