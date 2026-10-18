import { NoPriceError, isUsablePrice, DELAYED_AFTER_MS, DEFAULT_BAR_ADJUSTMENT, parseBarAdjustment } from "./market-data-types";
import type {
  BarAdjustment,
  BarFetchOptions,
  MarketCandle,
  MarketCandlesResult,
  MarketOptionContract,
  MarketOptionsChain,
  MarketQuote,
  CorporateEvent,
} from "./market-data-types";
import { normalizeAlpacaActions } from "../chart/events";
import { cleanCandles, logReport, normalizeSymbol, providerJson, snapWindow } from "./provider-http";

const DATA_BASE_URL = "https://data.alpaca.markets/v2";

/**
 * NOTE: field names and endpoint shapes below are based on Alpaca's current
 * public docs (docs.alpaca.markets), fetched and read directly while
 * building this integration — not recalled from training data alone. Still
 * unverified against a real response (no live keys were available while
 * this was written). See ALPACA_INTEGRATION_NOTES.md for what specifically
 * needs checking on first real use, same treatment SCHWAB_INTEGRATION_NOTES.md
 * gives the Schwab client.
 *
 * Every request goes through providerJson (provider-http.ts): 15 s timeout, up to 2 retries on 429/5xx honouring
 * Retry-After, and errors that name the provider and carry at most 160 characters of the response body.
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
  return providerJson<T>(
    url.toString(),
    { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey } },
    { provider: "Alpaca", path, revalidateSeconds }
  );
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
  // Missing fields stay NaN (never 0) so cleanCandles drops the bar instead of treating it as a real price.
  return {
    datetime: Date.parse(bar.t),
    open: Number(bar.o ?? NaN),
    high: Number(bar.h ?? NaN),
    low: Number(bar.l ?? NaN),
    close: Number(bar.c ?? NaN),
    volume: Number(bar.v ?? NaN),
    feed: "iex",
  };
}

// Safety cap on pagination loops (free tier: 200 req/min). Raised from 20 to 100 pages of 10 000 bars. Bars are
// requested newest-first (sort=desc), so if the cap is ever reached the OLDEST bars are the ones missing and the
// newest bars are always kept; the result is then flagged truncated with a warning instead of looking complete.
export const ALPACA_MAX_PAGES = 100;

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
  revalidateSeconds: number,
  adjustment: BarAdjustment = DEFAULT_BAR_ADJUSTMENT
): Promise<MarketCandlesResult> {
  const sym = normalizeSymbol(symbol);
  // Validated here too: a bad value must never reach the URL. The adjustment is part of the URL, so Next's data cache
  // keeps raw / split / all responses apart.
  const adj = parseBarAdjustment(adjustment);
  // Snap the window to the cache window so equal requests build an identical URL and the fetch cache can hit.
  const win = snapWindow(startMs, endMs, revalidateSeconds);
  const raw: MarketCandle[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  let truncated = false;

  do {
    const params: Record<string, string> = {
      timeframe,
      start: new Date(win.startMs).toISOString(),
      end: new Date(win.endMs).toISOString(),
      feed: "iex", // only feed available on the free/Basic plan
      adjustment: adj, // "raw" | "split" | "all": see BarAdjustment; the caller chooses, the default is split
      sort: "desc", // newest first: a pagination cap can only ever lose the oldest bars
      limit: "10000",
    };
    if (pageToken) params.page_token = pageToken;

    const data = await fetchAlpaca<AlpacaBarsResponse>(
      `/stocks/${encodeURIComponent(sym)}/bars`,
      params,
      revalidateSeconds
    );
    // Alpaca returns bars: null (not []) for a symbol it doesn't recognize at all.
    raw.push(...(data.bars ?? []).map(toCandle));
    pageToken = data.next_page_token ?? undefined;
    pages += 1;
    if (pageToken && pages >= ALPACA_MAX_PAGES) {
      truncated = true;
      break;
    }
  } while (pageToken);

  const { candles, report } = cleanCandles(raw, `Alpaca ${sym} ${timeframe}`);
  if (truncated) {
    report.truncated = true;
    report.warnings.push(
      `Alpaca ${sym} ${timeframe}: stopped after ${ALPACA_MAX_PAGES} pages; the oldest bars of the requested range are missing (the newest are complete).`
    );
  }
  logReport(report);
  return { candles, report, adjustment: adj, provider: "Alpaca" };
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
  revalidateSeconds: number,
  opts: BarFetchOptions = {}
): Promise<MarketCandle[]> {
  return (await fetchBars(symbol, "1Min", startDateMs, endDateMs, revalidateSeconds, opts.adjustment)).candles;
}

export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number,
  opts: BarFetchOptions = {}
): Promise<MarketCandle[]> {
  return (await fetchBars(symbol, "1Day", startDateMs, endDateMs, revalidateSeconds, opts.adjustment)).candles;
}

/** Arbitrary-timeframe entry point for chart-bars.ts — same underlying fetchBars as above. */
export async function fetchBarsForTimeframe(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number,
  opts: BarFetchOptions = {}
): Promise<MarketCandle[]> {
  return (await fetchBars(symbol, timeframe, startMs, endMs, revalidateSeconds, opts.adjustment)).candles;
}

/** Same as fetchBarsForTimeframe but also returns what was cleaned or truncated (dropped counts, warnings). */
export async function fetchBarsForTimeframeDetailed(
  symbol: string,
  timeframe: string,
  startMs: number,
  endMs: number,
  revalidateSeconds: number,
  opts: BarFetchOptions = {}
): Promise<MarketCandlesResult> {
  return fetchBars(symbol, timeframe, startMs, endMs, revalidateSeconds, opts.adjustment);
}

const ALPACA_CORPORATE_ACTIONS_MAX_PAGES = 5;

/**
 * Splits and cash dividends for a symbol between two dates, from Alpaca's market-data corporate actions endpoint
 * (https://data.alpaca.markets/v1/corporate-actions). Endpoint and response shape follow Alpaca's public docs and are
 * NOT yet checked against a live response (no keys were available): the parser in src/lib/chart/events.ts drops what it
 * cannot read. Throws on missing keys or an HTTP error; the caller (market-data.fetchCorporateEvents) turns that into
 * "no markers" so the chart never breaks over it.
 */
export async function fetchCorporateActions(symbol: string, startMs: number, endMs: number, revalidateSeconds = 6 * 3600): Promise<CorporateEvent[]> {
  const sym = normalizeSymbol(symbol);
  const { keyId, secretKey } = getCredentials();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const events: CorporateEvent[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const url = new URL("https://data.alpaca.markets/v1/corporate-actions");
    url.searchParams.set("symbols", sym);
    url.searchParams.set("types", "forward_split,reverse_split,cash_dividend");
    url.searchParams.set("start", day(startMs));
    url.searchParams.set("end", day(endMs));
    url.searchParams.set("limit", "1000");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const data = await providerJson<{ next_page_token?: string | null }>(
      url.toString(),
      { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey } },
      { provider: "Alpaca", path: "/corporate-actions", revalidateSeconds }
    );
    events.push(...normalizeAlpacaActions(data));
    pageToken = data.next_page_token ?? undefined;
    pages += 1;
  } while (pageToken && pages < ALPACA_CORPORATE_ACTIONS_MAX_PAGES);
  return events.sort((a, b) => a.dateMs - b.dateMs);
}

interface AlpacaSnapshotResponse {
  latestTrade?: { p?: number; t?: string };
  dailyBar?: { v?: number };
}

/**
 * Free-tier REST data (including this snapshot) may carry a delay: only Alpaca's websocket stream is true real-time.
 * The trade's own timestamp (latestTrade.t) is returned as `asOf`, and `delayed` is set when that trade is older than
 * DELAYED_AFTER_MS, so a caller can show "as of 10:32" instead of presenting the price as live.
 * Throws NoPriceError when the snapshot has no usable trade price (never returns 0).
 */
export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const sym = normalizeSymbol(symbol);
  const data = await fetchAlpaca<AlpacaSnapshotResponse>(
    `/stocks/${encodeURIComponent(sym)}/snapshot`,
    { feed: "iex" },
    30
  );
  const price = data.latestTrade?.p;
  if (!isUsablePrice(price)) throw new NoPriceError("Alpaca", sym, "snapshot has no latest trade price");
  const tradeMs = data.latestTrade?.t ? Date.parse(data.latestTrade.t) : NaN;
  const asOf = Number.isFinite(tradeMs) ? tradeMs : undefined;
  const volume = Number(data.dailyBar?.v);
  return {
    symbol: sym,
    lastPrice: price,
    totalVolume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
    feed: "iex",
    ...(asOf !== undefined ? { asOf, delayed: Date.now() - asOf > DELAYED_AFTER_MS } : {}),
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
  return providerJson<T>(
    url.toString(),
    { headers: { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secretKey } },
    { provider: "Alpaca options", path, revalidateSeconds: 300 }
  );
}

/** Cap on option-snapshot pages followed. */
const ALPACA_OPTIONS_MAX_PAGES = 10;

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
 *
 * Follows next_page_token (up to ALPACA_OPTIONS_MAX_PAGES pages) so a chain larger than one page is not cut silently.
 */
export async function fetchOptionsChain(
  symbol: string,
  expirationDate?: string
): Promise<MarketOptionsChain> {
  const sym = normalizeSymbol(symbol);
  const baseParams: Record<string, string> = { feed: "indicative" };
  if (expirationDate) baseParams.expiration_date = expirationDate;

  const snapshots: Record<string, AlpacaOptionSnapshot> = {};
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const params = pageToken ? { ...baseParams, page_token: pageToken } : baseParams;
    const data = await fetchAlpacaOptions<AlpacaOptionSnapshotsResponse>(`/snapshots/${encodeURIComponent(sym)}`, params);
    Object.assign(snapshots, data.snapshots ?? {});
    pageToken = data.next_page_token ?? undefined;
    pages += 1;
  } while (pageToken && pages < ALPACA_OPTIONS_MAX_PAGES);
  if (pageToken) console.warn(`[market-data] Alpaca options ${sym}: stopped after ${ALPACA_OPTIONS_MAX_PAGES} pages; the chain is incomplete.`);

  const calls: MarketOptionContract[] = [];
  const puts: MarketOptionContract[] = [];

  for (const [occSymbol, snap] of Object.entries(snapshots)) {
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

  // The indicative feed is not the real OPRA feed: mark it so a UI can say so.
  return { symbol: sym, calls, puts, feed: "alpaca-indicative", delayed: true };
}
