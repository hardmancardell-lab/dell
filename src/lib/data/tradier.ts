import type { MarketOptionContract, MarketOptionsChain } from "./market-data-types";
import { normalizeSymbol, providerJson } from "./provider-http";

// Sandbox endpoint, not production (api.tradier.com) — confirmed live this
// session: Tradier's sandbox environment returns real (non-simulated) market
// data identical to production for quotes/chains/expirations (only
// account/trading endpoints are paper there), so the sandbox token is the
// safer, lower-stakes choice for this read-only, no-order-execution app.
// The user also has a production-account token that works against
// api.tradier.com if ever needed, but there's no reason to use it here.
//
// Exception, added for the intraday option-flow logger ONLY: an explicit, opt-in
// "production" feed (api.tradier.com, real-time for account holders) that is
// selected by passing `feed: "production"` on a call. The sandbox stays the
// default for every caller that does not pass a feed. See "Production mode" in
// TRADIER_INTEGRATION_NOTES.md.
const SANDBOX_BASE_URL = "https://sandbox.tradier.com/v1";
const PRODUCTION_BASE_URL = "https://api.tradier.com/v1";

export type TradierFeed = "sandbox" | "production";

/** Base URL per feed. Exported so tests can assert exactly which host each mode talks to. */
export const TRADIER_BASE_URLS: Readonly<Record<TradierFeed, string>> = {
  sandbox: SANDBOX_BASE_URL,
  production: PRODUCTION_BASE_URL,
};

/**
 * The only paths this client will ever request. Market data only: this app is read-only and must never reach
 * Tradier's account, order or watchlist endpoints, even if a future caller passes a different path by mistake.
 */
export const TRADIER_ALLOWED_PATHS: readonly string[] = ["/markets/options/expirations", "/markets/options/chains"];

/**
 * NOTE: field names below were verified live this session against a real
 * AAPL chain — strike, open_interest, volume, bid, ask, last,
 * expiration_date, option_type, and greeks{delta,gamma,theta,vega,mid_iv}
 * all matched exactly (real open interest of 105/458 seen on real
 * contracts). See TRADIER_INTEGRATION_NOTES.md for the full verification
 * checklist and results.
 */

function getToken(feed: TradierFeed): string {
  if (feed === "production") {
    // Never falls back to TRADIER_ACCESS_TOKEN (the sandbox token): a silent switch would mix delayed and real-time data.
    const token = process.env.TRADIER_PRODUCTION_TOKEN;
    if (!token) {
      throw new Error("TRADIER_PRODUCTION_TOKEN is not set, so the production Tradier feed cannot be used. Set it, or set OPTION_FLOW_TRADIER_MODE=sandbox.");
    }
    return token;
  }
  const token = process.env.TRADIER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "TRADIER_ACCESS_TOKEN is not set. Sign up at tradier.com (free, no funding required), generate a sandbox API token at web.tradier.com/user/api, and add it to .env.local."
    );
  }
  return token;
}

/**
 * Which Tradier feed the option-flow logger should use, from the environment. Pure (takes the env as a parameter).
 *
 * - OPTION_FLOW_TRADIER_MODE unset or empty: "sandbox" (the default; delayed about 15 minutes).
 * - "sandbox": sandbox.
 * - "production": production, but only when TRADIER_PRODUCTION_TOKEN is also set. If it is not, this returns an
 *   error and the caller must stop and write nothing. It never falls back to sandbox: a silent fallback would put
 *   delayed rows into a log the user believes is real-time.
 * - Any other value (a typo such as "prod"): an error as well, for the same reason. Treating it as sandbox would hand
 *   the user delayed data while they believe they switched to real-time. Matching ignores case and surrounding spaces.
 */
export type OptionFlowFeedChoice = { ok: true; feed: TradierFeed } | { ok: false; error: string };

export function resolveOptionFlowFeed(env: Record<string, string | undefined> = process.env): OptionFlowFeedChoice {
  const raw = (env.OPTION_FLOW_TRADIER_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "sandbox") return { ok: true, feed: "sandbox" };
  if (raw === "production") {
    if (!env.TRADIER_PRODUCTION_TOKEN) {
      return { ok: false, error: "OPTION_FLOW_TRADIER_MODE is \"production\" but TRADIER_PRODUCTION_TOKEN is not set. Nothing was fetched or written. Add TRADIER_PRODUCTION_TOKEN, or set OPTION_FLOW_TRADIER_MODE=sandbox." };
    }
    return { ok: true, feed: "production" };
  }
  return { ok: false, error: `OPTION_FLOW_TRADIER_MODE has an unrecognised value ("${(env.OPTION_FLOW_TRADIER_MODE ?? "").slice(0, 30)}"). Use "sandbox" or "production". Nothing was fetched or written.` };
}

/**
 * `fresh` skips Next's data cache (the default 5-minute revalidate would make consecutive intraday snapshots return the same cached chain) and bounds the request time.
 * `feed` picks the Tradier environment; omitted means "sandbox", exactly as before. The production feed is always fetched fresh.
 */
export interface TradierFetchOptions {
  fresh?: boolean;
  feed?: TradierFeed;
}

async function fetchTradier<T>(path: string, params: Record<string, string>, opts: TradierFetchOptions = {}): Promise<T> {
  if (!TRADIER_ALLOWED_PATHS.includes(path)) {
    throw new Error(`Tradier path not allowed (this app only reads option market data): ${path}`);
  }
  const feed: TradierFeed = opts.feed === "production" ? "production" : "sandbox";
  const token = getToken(feed);
  const url = new URL(`${TRADIER_BASE_URLS[feed]}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const fresh = opts.fresh || feed === "production";
  // 15 s timeout and up to 2 retries on 429/5xx (Retry-After honoured) on every call, fresh or cached.
  return providerJson<T>(
    url.toString(),
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    { provider: "Tradier", path, ...(fresh ? { noStore: true } : { revalidateSeconds: 300 }) }
  );
}

interface TradierExpirationsResponse {
  expirations: { date: string[] | string } | null;
}

/** Returns available expiration dates for an underlying, soonest first. */
export async function getExpirations(symbol: string, opts: TradierFetchOptions = {}): Promise<string[]> {
  const data = await fetchTradier<TradierExpirationsResponse>(
    "/markets/options/expirations",
    { symbol: normalizeSymbol(symbol), includeAllRoots: "false" },
    opts
  );
  const raw = data.expirations?.date;
  if (!raw) return [];
  const dates = Array.isArray(raw) ? raw : [raw];
  // Keep only well-formed YYYY-MM-DD dates, de-duplicated, soonest first.
  return [...new Set(dates.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

interface TradierGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  mid_iv?: number;
}

interface TradierOptionContract {
  strike: number;
  expiration_date: string;
  option_type: string;
  bid?: number;
  ask?: number;
  last?: number;
  open_interest?: number;
  volume?: number;
  /** Epoch-ms timestamps of the last trade and the last bid / ask update (documented Tradier chain fields; not yet verified live here, see TRADIER_INTEGRATION_NOTES.md). */
  trade_date?: number;
  bid_date?: number;
  ask_date?: number;
  greeks?: TradierGreeks;
}

/** Newest of the contract's trade / bid / ask epoch-ms timestamps, or undefined when none is a plausible epoch-ms value (guards against 0, seconds, or garbage). */
export function newestQuoteTimeMs(c: { trade_date?: unknown; bid_date?: unknown; ask_date?: unknown }): number | undefined {
  let best: number | undefined;
  for (const v of [c.trade_date, c.bid_date, c.ask_date]) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 1e12 && v < 1e14 && (best === undefined || v > best)) best = v;
  }
  return best;
}

interface TradierChainResponse {
  // Tradier's well-known quirk: a single matching contract comes back as a
  // bare object instead of a one-element array. Normalized below.
  options: { option: TradierOptionContract[] | TradierOptionContract } | null;
}

/** Largest implied volatility (percent) accepted as real; anything above is treated as a bad value and stored as 0 (unknown). */
const MAX_PLAUSIBLE_IV_PERCENT = 1000;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function fetchOptionsChain(symbol: string, expirationDate?: string, opts: TradierFetchOptions = {}): Promise<MarketOptionsChain> {
  const sym = normalizeSymbol(symbol);
  const feed: TradierFeed = opts.feed === "production" ? "production" : "sandbox";
  const feedLabel = `tradier-${feed}`;
  // The sandbox is delayed about 15 minutes; the production feed is real-time for account holders.
  const delayed = feed === "sandbox";
  const expiration = expirationDate ?? (await getExpirations(sym, opts))[0];
  if (!expiration) {
    return { symbol: sym, calls: [], puts: [], feed: feedLabel, delayed };
  }

  const data = await fetchTradier<TradierChainResponse>(
    "/markets/options/chains",
    { symbol: sym, expiration, greeks: "true" },
    opts
  );

  const raw = data.options?.option;
  const contracts: TradierOptionContract[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];

  const calls: MarketOptionContract[] = [];
  const puts: MarketOptionContract[] = [];
  const seen = new Set<string>();
  let newestMs: number | undefined;

  for (const c of contracts) {
    // Strict option_type: only "call" or "put" (any case). Anything else is skipped, never filed as a put.
    const type = typeof c.option_type === "string" ? c.option_type.trim().toLowerCase() : "";
    if (type !== "call" && type !== "put") continue;
    const strike = num(c.strike);
    if (strike === null || strike <= 0) continue;
    const expirationMs = typeof c.expiration_date === "string" ? Date.parse(c.expiration_date) : NaN;
    if (!Number.isFinite(expirationMs)) continue;
    const key = `${type}|${strike}|${c.expiration_date}`;
    if (seen.has(key)) continue; // duplicate contract rows would double-count open interest and gamma
    seen.add(key);

    // Negative or non-numeric quotes become 0 (unknown); a crossed market (ask < bid) is zeroed on both sides.
    let bid = num(c.bid) ?? 0;
    let ask = num(c.ask) ?? 0;
    if (bid < 0) bid = 0;
    if (ask < 0) ask = 0;
    if (bid > 0 && ask > 0 && ask < bid) {
      bid = 0;
      ask = 0;
    }
    const ivPercent = (num(c.greeks?.mid_iv) ?? 0) * 100;
    const contract: MarketOptionContract = {
      strikePrice: strike,
      expirationDate: c.expiration_date,
      daysToExpiration: Math.max(0, Math.round((expirationMs - Date.now()) / (24 * 60 * 60 * 1000))),
      bid,
      ask,
      last: Math.max(0, num(c.last) ?? 0),
      openInterest: Math.max(0, num(c.open_interest) ?? 0), // real, unlike Alpaca's hardcoded 0
      totalVolume: Math.max(0, num(c.volume) ?? 0),
      volatility: ivPercent >= 0 && ivPercent <= MAX_PLAUSIBLE_IV_PERCENT ? ivPercent : 0,
      delta: num(c.greeks?.delta) ?? 0,
      gamma: num(c.greeks?.gamma) ?? 0,
      theta: num(c.greeks?.theta) ?? 0,
      vega: num(c.greeks?.vega) ?? 0,
    };
    const quoteTimeMs = newestQuoteTimeMs(c);
    if (quoteTimeMs !== undefined) {
      contract.quoteTimeMs = quoteTimeMs;
      if (newestMs === undefined || quoteTimeMs > newestMs) newestMs = quoteTimeMs;
    }
    if (type === "call") calls.push(contract);
    else puts.push(contract);
  }

  return { symbol: sym, calls, puts, feed: feedLabel, delayed, ...(newestMs !== undefined ? { asOf: newestMs } : {}) };
}
