import { getValidAccessToken } from "./schwab-auth";
import {
  generateMockDailyBars,
  generateMockMinuteBars,
  generateMockOptionsChain,
  generateMockQuote,
} from "./schwab-mock";

const BASE_URL = "https://api.schwabapi.com/marketdata/v1";

/**
 * Set SCHWAB_MOCK_MODE=true in .env.local to exercise the trading-agent
 * pipeline with synthetic data before Schwab app approval completes (or any
 * time real OAuth tokens aren't available). Every exported fetch function
 * below checks this first. Remove/unset it once real tokens exist — mock
 * mode takes priority over real credentials if both are present.
 */
function isMockMode(): boolean {
  return process.env.SCHWAB_MOCK_MODE === "true";
}

/**
 * NOTE: exact response field names below are based on Schwab's documented
 * request parameters (confirmed via developer.schwab.com search results)
 * plus the well-established TD Ameritrade API shape Schwab's API is
 * descended from — but could not be live-verified against a real response
 * before OAuth app approval completes. Parsing is written defensively
 * (optional chaining, numeric fallbacks) so a field-name mismatch degrades
 * gracefully instead of throwing. Treat this as provisional — verify field
 * names against a real response the first time this runs, the same way
 * FMP's actual field names were only confirmed by live probing.
 */

async function fetchSchwab<T>(
  path: string,
  params: Record<string, string>,
  revalidateSeconds: number
): Promise<T> {
  const accessToken = await getValidAccessToken();
  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
    next: { revalidate: revalidateSeconds },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Schwab request failed for ${path}: ${res.status} ${body}`);
  }

  return (await res.json()) as T;
}

export interface SchwabCandle {
  datetime: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface PriceHistoryResponse {
  symbol: string;
  candles: SchwabCandle[];
  empty: boolean;
}

/**
 * periodType "day" is the only periodType that supports frequencyType
 * "minute" — that's the combination needed for premarket volume and the
 * historical composite's intraday checkpoints. `period` is how many days
 * back (Schwab's day-periodType only accepts 1/2/3/4/5/10 — NOT an arbitrary
 * number), so multi-month/year backfills likely need explicit
 * startDate/endDate instead of `period`. Verify live: unclear from docs
 * whether minute-level data is available at all beyond the last ~10 days on
 * this periodType, or whether startDate/endDate can extend it further back.
 */
export async function fetchMinuteBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<SchwabCandle[]> {
  if (isMockMode()) return generateMockMinuteBars(symbol, startDateMs, endDateMs);

  const data = await fetchSchwab<PriceHistoryResponse>(
    "/pricehistory",
    {
      symbol,
      periodType: "day",
      frequencyType: "minute",
      frequency: "1",
      startDate: String(startDateMs),
      endDate: String(endDateMs),
      needExtendedHoursData: "true", // required to get premarket bars at all
    },
    revalidateSeconds
  );
  return data.empty ? [] : data.candles;
}

/**
 * Daily OHLCV bars, one call per symbol regardless of lookback length — much
 * cheaper than fetchMinuteBars for anything that doesn't need intraday
 * detail (the watchlist scan signals only need daily closes/volume).
 * periodType="month" + frequencyType="daily" is the combination documented
 * for TDA/Schwab-descended APIs for this granularity; startDate/endDate give
 * explicit control over the window the same way fetchMinuteBars does.
 * Unverified live, same disclaimer as every other Schwab endpoint here.
 */
export async function fetchDailyBars(
  symbol: string,
  startDateMs: number,
  endDateMs: number,
  revalidateSeconds: number
): Promise<SchwabCandle[]> {
  if (isMockMode()) return generateMockDailyBars(symbol, startDateMs, endDateMs);

  const data = await fetchSchwab<PriceHistoryResponse>(
    "/pricehistory",
    {
      symbol,
      periodType: "month",
      frequencyType: "daily",
      frequency: "1",
      startDate: String(startDateMs),
      endDate: String(endDateMs),
    },
    revalidateSeconds
  );
  return data.empty ? [] : data.candles;
}

export interface SchwabQuote {
  symbol: string;
  lastPrice: number;
  totalVolume: number;
}

interface QuotesResponse {
  [symbol: string]: {
    symbol: string;
    quote?: {
      lastPrice?: number;
      totalVolume?: number;
    };
  };
}

export async function fetchQuote(symbol: string): Promise<SchwabQuote> {
  if (isMockMode()) return generateMockQuote(symbol);

  const data = await fetchSchwab<QuotesResponse>(
    "/quotes",
    { symbols: symbol, fields: "quote" },
    30 // live data, short cache
  );
  const entry = data[symbol];
  return {
    symbol,
    lastPrice: entry?.quote?.lastPrice ?? 0,
    totalVolume: entry?.quote?.totalVolume ?? 0,
  };
}

export interface SchwabOptionContract {
  strikePrice: number;
  expirationDate: string;
  daysToExpiration: number;
  bid: number;
  ask: number;
  last: number;
  openInterest: number;
  totalVolume: number;
  volatility: number; // implied volatility, as a percent
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

interface OptionsChainResponse {
  symbol: string;
  status: string;
  // Schwab's documented chain shape nests contracts under
  // "<expirationDate>:<daysToExpiration>" keys, then under strike-price
  // string keys, each holding an array (usually length 1) of contracts —
  // inherited from the TD Ameritrade API this succeeded. Unconfirmed live.
  callExpDateMap?: Record<string, Record<string, Partial<SchwabOptionContract>[]>>;
  putExpDateMap?: Record<string, Record<string, Partial<SchwabOptionContract>[]>>;
}

export interface SchwabOptionsChain {
  symbol: string;
  calls: SchwabOptionContract[];
  puts: SchwabOptionContract[];
}

function flattenExpDateMap(
  map: Record<string, Record<string, Partial<SchwabOptionContract>[]>> | undefined
): SchwabOptionContract[] {
  if (!map) return [];
  const contracts: SchwabOptionContract[] = [];
  for (const strikeMap of Object.values(map)) {
    for (const entries of Object.values(strikeMap)) {
      for (const c of entries) {
        contracts.push({
          strikePrice: c.strikePrice ?? 0,
          expirationDate: c.expirationDate ?? "",
          daysToExpiration: c.daysToExpiration ?? 0,
          bid: c.bid ?? 0,
          ask: c.ask ?? 0,
          last: c.last ?? 0,
          openInterest: c.openInterest ?? 0,
          totalVolume: c.totalVolume ?? 0,
          volatility: c.volatility ?? 0,
          delta: c.delta ?? 0,
          gamma: c.gamma ?? 0,
          theta: c.theta ?? 0,
          vega: c.vega ?? 0,
        });
      }
    }
  }
  return contracts;
}

export async function fetchOptionsChain(
  symbol: string,
  expirationDate?: string
): Promise<SchwabOptionsChain> {
  if (isMockMode()) return generateMockOptionsChain(symbol);

  const params: Record<string, string> = { symbol, contractType: "ALL" };
  if (expirationDate) {
    params.fromDate = expirationDate;
    params.toDate = expirationDate;
  }
  const data = await fetchSchwab<OptionsChainResponse>("/chains", params, 300);
  return {
    symbol,
    calls: flattenExpDateMap(data.callExpDateMap),
    puts: flattenExpDateMap(data.putExpDateMap),
  };
}
