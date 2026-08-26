import { createHash, createHmac, randomUUID } from "crypto";
import type { MarketCandle, MarketQuote } from "./market-data-types";

/**
 * Webull OpenAPI market-data client. This is a market-data/trading API, not
 * a news source — it exists to potentially improve on Alpaca's free-tier
 * IEX-only feed (single-exchange, weakest in premarket, already flagged
 * elsewhere in this codebase), not to replace GDELT (geopolitical-news.ts),
 * which does a fundamentally different job (news-coverage volume).
 *
 * The signing algorithm below is verified byte-for-byte against Webull's
 * own published worked example (developer.webull.com/apis/docs/
 * authentication/signature) — not guessed. Given app_secret
 * "0f50a2e853334a9aae1a783bee120c1f", path "/trade/place_order", query
 * params {a1:webull, a2:123, a3:xxx, q1:yyy}, the documented headers, and
 * that exact body, this implementation reproduces the documented signature
 * "kvlS6opdZDhEBo5jq40nHYXaLvM=" exactly.
 *
 * What's still UNVERIFIED against a real response (no live key was
 * available while this was written — see WEBULL_INTEGRATION_NOTES.md):
 * the exact endpoint path for historical bars. Only the quote-snapshot
 * path (/openapi/market-data/stock/snapshot) is directly confirmed from
 * Webull's own docs; fetchDailyBars/fetchMinuteBars use a best-effort path
 * following the same prefix convention and must be checked against a real
 * response before being trusted.
 */

const BASE_URL = "https://api.webull.com";
const HOST = "api.webull.com";

function getCredentials(): { appKey: string; appSecret: string } {
  const appKey = process.env.WEBULL_APP_KEY;
  const appSecret = process.env.WEBULL_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("WEBULL_APP_KEY / WEBULL_APP_SECRET are not set. Add both to .env.local (get them from Webull's OpenAPI Management > App Management).");
  }
  return { appKey, appSecret };
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds the six signing headers + final signature per Webull's documented
 * algorithm: str1 = every query param + the six signing headers (excluding
 * x-signature/x-version), sorted alphabetically by name, joined as
 * "k=v&k=v...". str2 = MD5(body) uppercase hex, if a body exists. str3 =
 * `${path}&${str1}` (+ `&${str2}` if body). encoded = encodeURIComponent
 * applied to the WHOLE str3 (confirmed — component-wise encoding does NOT
 * reproduce the documented test vector). signature =
 * base64(HMAC-SHA1(appSecret + "&", encoded)).
 */
function signRequest(path: string, queryParams: Record<string, string>, bodyStr?: string): SignedRequest {
  const { appKey, appSecret } = getCredentials();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const nonce = randomUUID().replace(/-/g, "");

  const signingHeaders: Record<string, string> = {
    "x-app-key": appKey,
    "x-timestamp": timestamp,
    "x-signature-algorithm": "HMAC-SHA1",
    "x-signature-version": "1.0",
    "x-signature-nonce": nonce,
    host: HOST,
  };

  const allParams: Record<string, string> = { ...queryParams, ...signingHeaders };
  const str1 = Object.keys(allParams)
    .sort()
    .map((k) => `${k}=${allParams[k]}`)
    .join("&");

  let str3 = `${path}&${str1}`;
  if (bodyStr !== undefined) {
    const str2 = createHash("md5").update(bodyStr, "utf8").digest("hex").toUpperCase();
    str3 += `&${str2}`;
  }

  const encoded = encodeURIComponent(str3);
  const signingKey = `${appSecret}&`;
  const signature = createHmac("sha1", signingKey).update(encoded, "utf8").digest("base64");

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, v);

  return {
    url: url.toString(),
    headers: {
      ...signingHeaders,
      "x-signature": signature,
      "x-version": "v2",
    },
  };
}

function withAccessToken(headers: Record<string, string>): Record<string, string> {
  const token = process.env.WEBULL_ACCESS_TOKEN;
  return token ? { ...headers, "x-access-token": token } : headers;
}

async function fetchWebull<T>(path: string, queryParams: Record<string, string>, revalidateSeconds: number): Promise<T> {
  const { url, headers } = signRequest(path, queryParams);
  const res = await fetch(url, { headers: withAccessToken(headers), next: { revalidate: revalidateSeconds } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webull request failed for ${path}: ${res.status} ${body}`);
  }
  return (await res.json()) as T;
}

/** Signed POST — used for the token create/check calls below. No caching (these are one-off account actions, never repeated with the same args). */
async function postWebull<T>(path: string, bodyObj: Record<string, unknown> = {}): Promise<T> {
  const bodyStr = JSON.stringify(bodyObj);
  const { url, headers } = signRequest(path, {}, bodyStr);
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: bodyStr,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Webull request failed for ${path}: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Webull did not return JSON for ${path}: ${text.slice(0, 300)}`);
  }
}

/**
 * Creates a new access token — required in addition to the app key/secret
 * for actual data access (confirmed live: a correctly-signed request without
 * one gets a real 401 "x-access-token is missing or invalid"). The returned
 * token starts in "Pending Verification" status and can ONLY be activated
 * by the account holder approving an SMS code sent to their own Webull App
 * — there is no way to complete that step programmatically, by design (it's
 * real 2FA). Exact request/response field names are UNVERIFIED (Webull's
 * docs site is JS-rendered and didn't yield a concrete schema) — this
 * returns the raw parsed JSON alongside best-effort extracted fields so the
 * real shape is visible on first live call rather than guessed blind.
 */
export interface WebullTokenResult {
  raw: unknown;
  tokenId: string | null;
  status: string | null;
  expiresAt: string | null;
}

function extractTokenFields(raw: Record<string, unknown>): WebullTokenResult {
  const tokenId =
    (raw.token as string) ?? (raw.tokenId as string) ?? (raw.token_id as string) ?? (raw.access_token as string) ?? null;
  const status = (raw.status as string) ?? (raw.token_status as string) ?? null;
  const expiresAt = (raw.expireTime as string) ?? (raw.expires_at as string) ?? (raw.expiration as string) ?? null;
  return { raw, tokenId, status, expiresAt };
}

export async function createToken(): Promise<WebullTokenResult> {
  const raw = await postWebull<Record<string, unknown>>("/auth/tokens/create");
  return extractTokenFields(raw);
}

export async function checkToken(tokenId?: string): Promise<WebullTokenResult> {
  const raw = await postWebull<Record<string, unknown>>("/auth/tokens/check", tokenId ? { token: tokenId } : {});
  return extractTokenFields(raw);
}

interface WebullSnapshot {
  symbol: string;
  price?: number;
  last_price?: number;
  volume?: number;
  total_volume?: number;
}

interface WebullSnapshotResponse {
  data?: WebullSnapshot[];
}

export async function fetchQuote(symbol: string): Promise<MarketQuote> {
  const data = await fetchWebull<WebullSnapshotResponse>(
    "/openapi/market-data/stock/snapshot",
    { symbols: symbol, category: "US_STOCK" },
    30 // 30s cache — this is the one endpoint meant to be near-real-time
  );
  const row = data.data?.[0];
  if (!row) throw new Error(`No snapshot data returned for ${symbol}`);
  return {
    symbol,
    lastPrice: row.price ?? row.last_price ?? 0,
    totalVolume: row.volume ?? row.total_volume ?? 0,
  };
}

interface WebullBar {
  timestamp: number; // assumed epoch seconds — UNVERIFIED
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface WebullHistoryBarResponse {
  data?: WebullBar[];
}

/**
 * UNVERIFIED endpoint path/shape — best-effort extrapolation from the
 * confirmed snapshot path's "/openapi/market-data/stock/" prefix, since
 * Webull's docs site is JS-rendered and didn't yield a concrete history-bar
 * path/response-shape example. Do not treat this as trustworthy until
 * tested against a real key — see WEBULL_INTEGRATION_NOTES.md.
 */
export async function fetchDailyBars(symbol: string, startMs: number, endMs: number): Promise<MarketCandle[]> {
  const data = await fetchWebull<WebullHistoryBarResponse>(
    "/openapi/market-data/stock/history_bar",
    {
      symbol,
      category: "US_STOCK",
      timespan: "D1",
      start: String(Math.floor(startMs / 1000)),
      end: String(Math.floor(endMs / 1000)),
    },
    60 * 30
  );
  return (data.data ?? []).map((b) => ({
    datetime: b.timestamp * 1000,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export async function fetchMinuteBars(symbol: string, startMs: number, endMs: number): Promise<MarketCandle[]> {
  const data = await fetchWebull<WebullHistoryBarResponse>(
    "/openapi/market-data/stock/history_bar",
    {
      symbol,
      category: "US_STOCK",
      timespan: "M1",
      start: String(Math.floor(startMs / 1000)),
      end: String(Math.floor(endMs / 1000)),
    },
    60 * 5
  );
  return (data.data ?? []).map((b) => ({
    datetime: b.timestamp * 1000,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

export function isWebullConfigured(): boolean {
  return Boolean(process.env.WEBULL_APP_KEY && process.env.WEBULL_APP_SECRET);
}
