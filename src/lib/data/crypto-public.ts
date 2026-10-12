import { parseFarsideTotals, monthToDateFlows } from "@/lib/agents/trading-agent/skills/crypto-regime";

/**
 * Keyless public data for the crypto regime read: CoinGecko, DefiLlama, alternative.me, Yahoo Finance and Farside
 * Investors. No API key is needed for any of them, which makes this a fallback for where the app's keys are still
 * placeholders. Every adapter returns {ok: false, error} instead of throwing, so one failed source marks one
 * condition "unavailable" and never fails the whole read.
 *
 * Politeness: CoinGecko's free tier is rate limited, so its calls are spaced at least 3 seconds apart and a 429 is
 * retried with backoff. Results are cached in memory for 15 minutes.
 */

export type SourceResult<T> = { ok: true; value: T; asOf: string; source: string } | { ok: false; error: string; source: string };

export interface CryptoPublicDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const UA = "Mozilla/5.0 (compatible; Dellegate research app)";
const CACHE_TTL_MS = 15 * 60 * 1000;
const COINGECKO_GAP_MS = 3000;
const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createCryptoPublic(deps: CryptoPublicDeps = {}) {
  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? DEFAULT_SLEEP;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();
  let lastCoinGeckoAt = 0;

  async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL_MS) return hit.value as T;
    const value = await fn();
    cache.set(key, { at: now(), value });
    return value;
  }

  /** GET with retries and backoff. Throws a short Error on failure. `raw` returns the body as text. */
  async function get(url: string, opts: { raw?: boolean; coingecko?: boolean; retries?: number } = {}): Promise<unknown> {
    const retries = opts.retries ?? 3;
    let lastError = "request failed";
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.coingecko) {
        const wait = lastCoinGeckoAt + COINGECKO_GAP_MS - now();
        if (wait > 0) await sleep(wait);
        lastCoinGeckoAt = now();
      }
      try {
        const res = await doFetch(url, { headers: { "User-Agent": UA, Accept: opts.raw ? "text/html,*/*" : "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        if (res.status === 429 || res.status >= 500) {
          lastError = `HTTP ${res.status}`;
          if (attempt < retries) await sleep(4000 * (attempt + 1));
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return opts.raw ? await res.text() : await res.json();
      } catch (e) {
        lastError = e instanceof Error ? e.message : "request failed";
        if (/^HTTP 4\d\d$/.test(lastError)) break; // a 4xx other than 429 will not get better on retry
        if (attempt < retries) await sleep(2000 * (attempt + 1));
      }
    }
    throw new Error(lastError);
  }

  const fail = (source: string, e: unknown): { ok: false; error: string; source: string } => ({ ok: false, error: e instanceof Error ? e.message : "failed", source });

  async function btcDominance(): Promise<SourceResult<number>> {
    const source = "CoinGecko /global";
    try {
      const j = (await cached("cg-global", () => get("https://api.coingecko.com/api/v3/global", { coingecko: true }))) as { data?: { market_cap_percentage?: { btc?: number }; updated_at?: number } };
      const pct = j.data?.market_cap_percentage?.btc;
      if (typeof pct !== "number" || !(pct > 0 && pct < 100)) throw new Error("unexpected response");
      return { ok: true, value: pct / 100, asOf: new Date((j.data?.updated_at ?? now() / 1000) * 1000).toISOString(), source };
    } catch (e) {
      return fail(source, e);
    }
  }

  /** Daily BTC closes for about a year, one per UTC day, oldest first (the last entry is today's running price). */
  async function btcDailyCloses(): Promise<SourceResult<{ closes: number[]; lastDay: string }>> {
    const source = "CoinGecko market_chart, 365 days";
    try {
      const j = (await cached("cg-btc-365", () => get("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365&interval=daily", { coingecko: true }))) as { prices?: [number, number][] };
      if (!Array.isArray(j.prices) || j.prices.length < 200) throw new Error("fewer than 200 daily prices returned");
      const byDay = new Map<string, number>();
      for (const [ts, p] of j.prices) byDay.set(new Date(ts).toISOString().slice(0, 10), Math.round(p));
      const days = [...byDay.keys()].sort();
      return { ok: true, value: { closes: days.map((d) => byDay.get(d)!), lastDay: days[days.length - 1] }, asOf: `${days[days.length - 1]}T00:00:00.000Z`, source };
    } catch (e) {
      return fail(source, e);
    }
  }

  /** The last 40 daily stablecoin supply totals in dollars, oldest first. */
  async function stablecoinSupply(): Promise<SourceResult<{ supply: number[]; lastDay: string }>> {
    const source = "DefiLlama stablecoincharts";
    try {
      const j = (await cached("llama-stables", () => get("https://stablecoins.llama.fi/stablecoincharts/all"))) as { date: string | number; totalCirculatingUSD?: { peggedUSD?: number } }[];
      if (!Array.isArray(j) || j.length < 40) throw new Error("unexpected response");
      const tail = j.slice(-40);
      const supply = tail.map((r) => Number(r.totalCirculatingUSD?.peggedUSD));
      if (supply.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error("unexpected values");
      return { ok: true, value: { supply, lastDay: new Date(Number(tail[tail.length - 1].date) * 1000).toISOString().slice(0, 10) }, asOf: new Date(Number(tail[tail.length - 1].date) * 1000).toISOString(), source };
    } catch (e) {
      return fail(source, e);
    }
  }

  async function fearGreed(): Promise<SourceResult<number>> {
    const source = "alternative.me Fear & Greed";
    try {
      const j = (await cached("fng", () => get("https://api.alternative.me/fng/?limit=1"))) as { data?: { value?: string; timestamp?: string }[] };
      const v = Number(j.data?.[0]?.value);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error("unexpected response");
      return { ok: true, value: v, asOf: new Date(Number(j.data?.[0]?.timestamp ?? now() / 1000) * 1000).toISOString(), source };
    } catch (e) {
      return fail(source, e);
    }
  }

  /** The 10-year Treasury yield in percent, from Yahoo's ^TNX (delayed). FRED's keyless CSV was not reachable when tested. */
  async function us10y(): Promise<SourceResult<number>> {
    const source = "Yahoo Finance ^TNX (delayed)";
    try {
      const j = (await cached("yahoo-tnx", () => get("https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=5d&interval=1d"))) as { chart?: { result?: { meta?: { regularMarketPrice?: number; regularMarketTime?: number } }[] } };
      const meta = j.chart?.result?.[0]?.meta;
      const v = meta?.regularMarketPrice;
      if (typeof v !== "number" || !(v > 0 && v < 25)) throw new Error("unexpected response");
      return { ok: true, value: v, asOf: new Date((meta?.regularMarketTime ?? now() / 1000) * 1000).toISOString(), source };
    } catch (e) {
      return fail(source, e);
    }
  }

  /**
   * Net US spot BTC ETF flows ($M) so far in the current UTC month, from Farside's public table. Best effort only: Farside
   * answers scripted requests with HTTP 403 (tested from Node on 12 Oct 2026, while a plain browser-style request worked from
   * another client), and this code does not try to get around that. The regime read therefore also accepts the figure typed in.
   */
  async function etfFlowsMonthToDate(): Promise<SourceResult<{ totalMusd: number; days: number; lastDay: string }>> {
    const source = "Farside Investors (scraped table)";
    try {
      const html = (await cached("farside", () => get("https://farside.co.uk/btc/", { raw: true }))) as string;
      const rows = parseFarsideTotals(html);
      if (rows.length < 5) throw new Error("the table layout was not recognised");
      const month = new Date(now()).toISOString().slice(0, 7);
      const mtd = monthToDateFlows(rows, month);
      if (!mtd) throw new Error(`no trading day of ${month} is posted yet`);
      return { ok: true, value: mtd, asOf: `${mtd.lastDay}T00:00:00.000Z`, source };
    } catch (e) {
      return fail(source, e);
    }
  }

  return { btcDominance, btcDailyCloses, stablecoinSupply, fearGreed, us10y, etfFlowsMonthToDate, clearCache: () => cache.clear() };
}

export type CryptoPublic = ReturnType<typeof createCryptoPublic>;
export const cryptoPublic = createCryptoPublic();
