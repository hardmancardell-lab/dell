import type {
  MarketCandle,
  MarketOptionContract,
  MarketOptionsChain,
  MarketQuote,
} from "./market-data-types";

const DATA_BASE_URL = "https://data.alpaca.markets/v2";

/**
 * NOTE: field names and endpoint shapes below are based on Alpaca's current
 * public docs (docs.alpaca.markets), fetched and read directly while
 * building this integration — not recalled from training data alone. Still
 * unverified against a real response (no live keys were available while
 * this was written). See ALPACA_INTEGRATION_NOTES.md for what specifically
 * needs checking on first real use, same treatment SCHWAB_INTEGRATION_NOTES.md
 * gives the Schwab client.
 */

function getCredentials(): { keyId: string; secretKey: string } {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) {
    throw new Error(
      "ALPACA_API_KEY_ID / ALPACA_SECRET_KEY are not set. Sign up at alpaca.markets, generate API keys (a free paper account is enough), and add both to .env.local."
    );
  }
  return { keyId, secretKey };
}

async function fetchAlpaca<T>(
  path: string,
  params: Record<string, string>,
  revalidateSeconds: number
): Promise<T> {
  const { keyId, secretKey } = getCredentials();
  const url = new URL(`${DATA_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey,
    },
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca request failed for ${path}: ${res.status} ${body}`);
  }

  return (await res.json()) as T;
}

interface AlpacaBar {
  t: string; // RFC-3339 timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaBarsResponse {
  bars: AlpacaBar[];
  symbol: string;
  next_page_token: string | null;
}

function toCandle(bar: AlpacaBar): MarketCandle {
  return {
    datetime: Date.parse(bar.t),
    open: bar.o,
    high: bar.h,
    low: bar.l,
    close: bar.c,
    volume: bar.v,
  };
}

// Safety cap on pagination loops — the free tier's 200 req/min limit means a
// long minute-bar backfill (e.g. HISTORICAL_COMPOSITE_LOOKBACK_DAYS=180) could
// otherwise fire dozens of sequential page requests. Unverified how many
// pages that actually costs live; this cap exists so a misconfigured lookback
// window fails loud (returns partial data) rather than hammering the API.
const MAX_PAGES = 20;

/**
 * Alpaca's timeframe param accepts arbitrary "{N}Min"/"{N}Hour"/"1Day"/
 * "1Week"/"{N}Month" strings and aggregates server-side — no client-side
 * bucketing needed for real data (see candle-aggregation.ts, which exists
 * only for mock mode).
 */
async function fetchBars(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  const candles: MarketCandle[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const params: Record<string, string> = {
      timeframe,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      feed: "iex", // only feed available on the free/Basic plan
      adjustment: "raw",
      sort: "asc",
      limit: "10000",
    };
    if (pageToken) params.page_token = pageToken;

    const data = await fetchAlpaca<AlpacaBarsResponse>(
      `/stocks/${encodeURIComponent(symbol)}/bars`,
      params,
      revalidateSeconds
    );
    // Alpaca returns bars: null (not []) for a symbol it doesn't recognize at all.
    candles.push(...(data.bars ?? []).map(toCandle));
    pageToken = data.next_page_token ?? undefined;
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return candles;
}

/**
 * Extended-hours (4:00-9:30am ET premarket) data is included on Alpaca's
 * free plan per their published plan comparison — unlike the equivalent
 * Schwab call, no explicit "give me extended hours" parameter is documented;
 * the IEX feed's regular bars endpoint is expected to include premarket
 * trades since IEX itself operates in that window. Unverified live.
 */
export async function fetchMinuteBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return fetchBars(symbol, "1Min", startDateMs, endDateMs, revalidateSeconds);
}

export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return fetchBars(symbol, "1Day", startDateMs, endDateMs, revalidateSeconds);
}

/** Arbitrary-timeframe entry point for chart-bars.ts — same underlying fetchBars as above. */
export async function fetchBarsForTimeframe(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number
): Promise<MarketCandle[]> {
  return fetchBars(symbol, timeframe, startMs, endMs, revalidateSeconds);
}

interface AlpacaSnapshotResponse {
  latestTrade?: { p?: number };
  dailyBar?: { v?: number };
}

/**
 * Free-tier REST data (including this snapshot) carries a documented
 * 15-minute delay — only Alpaca's websocket stream is true real-time. Worth
 * knowing for anything treated as "right now" (e.g. PM-Volume Tracker).
 */
export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const data = await fetchAlpaca<AlpacaSnapshotResponse>(
    `/stocks/${encodeURIComponent(symbol)}/snapshot`,
    { feed: "iex" },
    30
  );
  return {
    symbol,
    lastPrice: data.latestTrade?.p ?? 0,
    totalVolume: data.dailyBar?.v ?? 0,
  };
}

// Options market data lives under a different versioned base than stocks
// (v1beta1, not v2) — a real, documented distinction in Alpaca's API, not a
// typo.
const OPTIONS_BASE_URL = "https://data.alpaca.markets/v1beta1/options";

interface AlpacaOptionSnapshot {
  latestQuote?: { bp?: number; ap?: number };
  latestTrade?: { p?: number; s?: number };
  impliedVolatility?: number;
  greeks?: { delta?: number; gamma?: number; theta?: number; vega?: number };
}

interface AlpacaOptionSnapshotsResponse {
  snapshots: Record<string, AlpacaOptionSnapshot>;
  next_page_token: string | null;
}

async function fetchAlpacaOptions<T>(path: string, params: Record<string, string>): Promise<T> {
  const { keyId, secretKey } = getCredentials();
  const url = new URL(`${OPTIONS_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url.toString(), {
    headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey },
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alpaca options request failed for ${path}: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

/**
 * OCC option symbol format: {root, space-padded to 6 chars}{YYMMDD}{C|P}{strike*1000, 8 digits}.
 * Alpaca's option snapshots are keyed by this symbol directly, so contract
 * metadata (strike/expiration/type) is parsed from the key itself rather
 * than fetched from a separate endpoint — avoids depending on a second,
 * less-certain contracts-metadata call.
 */
function parseOccSymbol(occ: string): { expirationDate: string; type: "call" | "put"; strikePrice: number } | null {
  const match = /^[A-Z]{1,6}\s*(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!match) return null;
  const [, dateDigits, cp, strikeDigits] = match;
  const yy = dateDigits.slice(0, 2);
  const mm = dateDigits.slice(2, 4);
  const dd = dateDigits.slice(4, 6);
  return {
    expirationDate: `20${yy}-${mm}-${dd}`,
    type: cp === "C" ? "call" : "put",
    strikePrice: Number(strikeDigits) / 1000,
  };
}

/**
 * HIGHEST-UNCERTAINTY piece of this integration — see ALPACA_INTEGRATION_NOTES.md.
 * Alpaca's free-tier options data is an "indicative pricing feed," not the
 * real OPRA feed, and open interest does not appear anywhere in Alpaca's
 * documented options response shape — it's hardcoded to 0 below rather than
 * guessed, which will make putCallOpenInterestRatio unusable on this
 * provider even if putCallVolumeRatio (used by the Options flow-skew signal)
 * works. The endpoint path, base URL version, and OCC-symbol parsing above
 * are all unverified against a real response.
 */
export async function fetchOptionsChain(
  symbol: string,
  expirationDate?: string
): Promise<MarketOptionsChain> {
  const params: Record<string, string> = { feed: "indicative" };
  if (expirationDate) params.expiration_date = expirationDate;

  const data = await fetchAlpacaOptions<AlpacaOptionSnapshotsResponse>(
    `/snapshots/${encodeURIComponent(symbol)}`,
    params
  );

  const calls: MarketOptionContract[] = [];
  const puts: MarketOptionContract[] = [];

  for (const [occSymbol, snap] of Object.entries(data.snapshots ?? {})) {
    const meta = parseOccSymbol(occSymbol);
    if (!meta) continue;

    const contract: MarketOptionContract = {
      strikePrice: meta.strikePrice,
      expirationDate: meta.expirationDate,
      daysToExpiration: Math.max(
        0,
        Math.round((Date.parse(meta.expirationDate) - Date.now()) / (24 * 60 * 60 * 1000))
      ),
      bid: snap.latestQuote?.bp ?? 0,
      ask: snap.latestQuote?.ap ?? 0,
      last: snap.latestTrade?.p ?? 0,
      openInterest: 0, // not exposed by Alpaca's documented options data — see note above
      totalVolume: snap.latestTrade?.s ?? 0,
      volatility: (snap.impliedVolatility ?? 0) * 100,
      delta: snap.greeks?.delta ?? 0,
      gamma: snap.greeks?.gamma ?? 0,
      theta: snap.greeks?.theta ?? 0,
      vega: snap.greeks?.vega ?? 0,
    };
    if (meta.type === "call") calls.push(contract);
    else puts.push(contract);
  }

  return { symbol, calls, puts };
}
