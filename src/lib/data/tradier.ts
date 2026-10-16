import type { MarketOptionContract, MarketOptionsChain } from "./market-data-types";

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
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    ...(fresh ? { cache: "no-store" as const, signal: AbortSignal.timeout(15_000) } : { next: { revalidate: 300 } }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tradier request failed for ${path}: ${res.status} ${body}`);
  }

  return (await res.json()) as T;
}

interface TradierExpirationsResponse {
  expirations: { date: string[] | string } | null;
}

/** Returns available expiration dates for an underlying, soonest first. */
export async function getExpirations(symbol: string, opts: TradierFetchOptions = {}): Promise<string[]> {
  const data = await fetchTradier<TradierExpirationsResponse>(
    "/markets/options/expirations",
    { symbol, includeAllRoots: "false" },
    opts
  );
  const raw = data.expirations?.date;
  if (!raw) return [];
  const dates = Array.isArray(raw) ? raw : [raw];
  return [...dates].sort();
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
  option_type: "call" | "put";
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

export async function fetchOptionsChain(symbol: string, expirationDate?: string, opts: TradierFetchOptions = {}): Promise<MarketOptionsChain> {
  const expiration = expirationDate ?? (await getExpirations(symbol, opts))[0];
  if (!expiration) {
    return { symbol, calls: [], puts: [] };
  }

  const data = await fetchTradier<TradierChainResponse>(
    "/markets/options/chains",
    { symbol, expiration, greeks: "true" },
    opts
  );

  const raw = data.options?.option;
  const contracts: TradierOptionContract[] = !raw ? [] : Array.isArray(raw) ? raw : [raw];

  const calls: MarketOptionContract[] = [];
  const puts: MarketOptionContract[] = [];

  for (const c of contracts) {
    const contract: MarketOptionContract = {
      strikePrice: c.strike,
      expirationDate: c.expiration_date,
      daysToExpiration: Math.max(
        0,
        Math.round((Date.parse(c.expiration_date) - Date.now()) / (24 * 60 * 60 * 1000))
      ),
      bid: c.bid ?? 0,
      ask: c.ask ?? 0,
      last: c.last ?? 0,
      openInterest: c.open_interest ?? 0, // real, unlike Alpaca's hardcoded 0
      totalVolume: c.volume ?? 0,
      volatility: (c.greeks?.mid_iv ?? 0) * 100,
      delta: c.greeks?.delta ?? 0,
      gamma: c.greeks?.gamma ?? 0,
      theta: c.greeks?.theta ?? 0,
      vega: c.greeks?.vega ?? 0,
    };
    const quoteTimeMs = newestQuoteTimeMs(c);
    if (quoteTimeMs !== undefined) contract.quoteTimeMs = quoteTimeMs;
    if (c.option_type === "call") calls.push(contract);
    else puts.push(contract);
  }

  return { symbol, calls, puts };
}
