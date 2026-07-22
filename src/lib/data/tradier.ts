import type { MarketOptionContract, MarketOptionsChain } from "./market-data-types";

// Sandbox endpoint, not production (api.tradier.com) — confirmed live this
// session: Tradier's sandbox environment returns real (non-simulated) market
// data identical to production for quotes/chains/expirations (only
// account/trading endpoints are paper there), so the sandbox token is the
// safer, lower-stakes choice for this read-only, no-order-execution app.
// The user also has a production-account token that works against
// api.tradier.com if ever needed, but there's no reason to use it here.
const BASE_URL = "https://sandbox.tradier.com/v1";

/**
 * NOTE: field names below were verified live this session against a real
 * AAPL chain — strike, open_interest, volume, bid, ask, last,
 * expiration_date, option_type, and greeks{delta,gamma,theta,vega,mid_iv}
 * all matched exactly (real open interest of 105/458 seen on real
 * contracts). See TRADIER_INTEGRATION_NOTES.md for the full verification
 * checklist and results.
 */

function getToken(): string {
  const token = process.env.TRADIER_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "TRADIER_ACCESS_TOKEN is not set. Sign up at tradier.com (free, no funding required), generate a sandbox API token at web.tradier.com/user/api, and add it to .env.local."
    );
  }
  return token;
}

async function fetchTradier<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = getToken();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    next: { revalidate: 300 },
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
export async function getExpirations(symbol: string): Promise<string[]> {
  const data = await fetchTradier<TradierExpirationsResponse>("/markets/options/expirations", {
    symbol,
    includeAllRoots: "false",
  });
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
  greeks?: TradierGreeks;
}

interface TradierChainResponse {
  // Tradier's well-known quirk: a single matching contract comes back as a
  // bare object instead of a one-element array. Normalized below.
  options: { option: TradierOptionContract[] | TradierOptionContract } | null;
}

export async function fetchOptionsChain(symbol: string, expirationDate?: string): Promise<MarketOptionsChain> {
  const expiration = expirationDate ?? (await getExpirations(symbol))[0];
  if (!expiration) {
    return { symbol, calls: [], puts: [] };
  }

  const data = await fetchTradier<TradierChainResponse>("/markets/options/chains", {
    symbol,
    expiration,
    greeks: "true",
  });

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
    if (c.option_type === "call") calls.push(contract);
    else puts.push(contract);
  }

  return { symbol, calls, puts };
}
