import { fetchBarsForTimeframe, fetchQuote } from "@/lib/data/market-data";
import { normalizeCryptoSymbol } from "../crypto-symbol";
import type { MarketCandle } from "@/lib/data/market-data-types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** 8 days of hourly candles is 192 rows, under Coinbase's 300-per-request cap, so each coin costs one candle request. */
const LOOKBACK_MS = 8 * DAY_MS;
const MAX_SYMBOLS = 25;

export interface CryptoWatchlistRow {
  symbol: string;
  lastPrice: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  error: string | null;
}

export interface CryptoWatchlistSnapshot {
  asOf: string;
  rows: CryptoWatchlistRow[];
  dataLimitations: string[];
}

/**
 * The close of the latest candle that had already finished by `targetMs`, i.e. the price at that moment. Null when the
 * candles do not reach back that far (a coin listed less than a week ago has no 7-day reference), never a guess.
 */
export function priceAt(bars: MarketCandle[], targetMs: number, bucketMs: number): number | null {
  let best: MarketCandle | null = null;
  for (const b of bars) {
    if (b.datetime + bucketMs <= targetMs && (best === null || b.datetime > best.datetime)) best = b;
  }
  return best && best.close > 0 ? best.close : null;
}

/** Percent change from `reference` to `last`, or null when either side is missing. */
export function pctChange(last: number | null, reference: number | null): number | null {
  if (last === null || reference === null || !(reference > 0)) return null;
  return (last / reference - 1) * 100;
}

/** Last price against the hourly close 24 hours and 7 days earlier. Pure, so it can be tested without a network. */
export function computeChanges(lastPrice: number, hourlyBars: MarketCandle[], nowMs: number): { change24hPct: number | null; change7dPct: number | null } {
  return {
    change24hPct: pctChange(lastPrice, priceAt(hourlyBars, nowMs - DAY_MS, HOUR_MS)),
    change7dPct: pctChange(lastPrice, priceAt(hourlyBars, nowMs - 7 * DAY_MS, HOUR_MS)),
  };
}

export interface CryptoWatchlistDeps {
  quote: (symbol: string) => Promise<{ lastPrice: number }>;
  hourlyBars: (symbol: string, startMs: number, endMs: number) => Promise<MarketCandle[]>;
  now: () => number;
}

const LIVE_DEPS: CryptoWatchlistDeps = {
  quote: (s) => fetchQuote(s),
  hourlyBars: (s, startMs, endMs) => fetchBarsForTimeframe(s, "1Hour", startMs, endMs, 60),
  now: Date.now,
};

/**
 * Last price and 24h / 7d change for each coin from Coinbase's public market data. One coin failing (a delisted or
 * mistyped product id) shows its own error and never blanks the others, the same isolation the equity watchlist scan uses.
 */
export async function getCryptoWatchlistSnapshot(symbols: string[], deps: CryptoWatchlistDeps = LIVE_DEPS): Promise<CryptoWatchlistSnapshot> {
  const dataLimitations: string[] = [
    "Prices are Coinbase's last trade, from one exchange; other venues can differ. Crypto trades 24/7, so 24h and 7d are rolling windows ending now, measured against the hourly candle close at that earlier moment, not a session close.",
  ];
  const pairs: string[] = [];
  for (const raw of symbols) {
    const pair = normalizeCryptoSymbol(raw);
    if (pair && !pairs.includes(pair)) pairs.push(pair);
  }
  if (pairs.length > MAX_SYMBOLS) {
    dataLimitations.push(`Showing the first ${MAX_SYMBOLS} of ${pairs.length} coins.`);
    pairs.length = MAX_SYMBOLS;
  }

  const nowMs = deps.now();
  const rows = await Promise.all(
    pairs.map(async (symbol): Promise<CryptoWatchlistRow> => {
      try {
        const [quote, bars] = await Promise.all([deps.quote(symbol), deps.hourlyBars(symbol, nowMs - LOOKBACK_MS, nowMs)]);
        return { symbol, lastPrice: quote.lastPrice, ...computeChanges(quote.lastPrice, bars, nowMs), error: null };
      } catch (error) {
        return { symbol, lastPrice: null, change24hPct: null, change7dPct: null, error: error instanceof Error ? error.message : "Unknown error" };
      }
    })
  );
  if (rows.some((r) => r.error === null && (r.change7dPct === null || r.change24hPct === null))) {
    dataLimitations.push("A change shows N/A when the coin has no candle that far back (for example a recent listing); it is never estimated.");
  }
  return { asOf: new Date(nowMs).toISOString(), rows, dataLimitations };
}
