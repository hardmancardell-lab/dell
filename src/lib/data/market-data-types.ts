/**
 * Provider-neutral market-data shapes. Structurally identical to schwab.ts's
 * SchwabCandle/SchwabQuote/SchwabOptionContract/SchwabOptionsChain — kept as
 * separate neutral names now that there are two real providers behind
 * market-data.ts (Alpaca and dormant Schwab), so nothing in this codebase
 * has to say "Schwab" when it might actually be Alpaca data.
 */

export interface MarketCandle {
  datetime: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Which feed produced the bar (for example "iex", "oanda-mid", "coinbase"). Absent when unknown. */
  feed?: string;
  /** True when the provider's data for this bar is known to be delayed. Absent when unknown. */
  delayed?: boolean;
  /** Epoch ms the bar's values are valid as of (the bar's close when the provider gives it). Absent when unknown. */
  asOf?: number;
  /** True for generated (mock-mode) data. Never set on real data. */
  synthetic?: boolean;
}

export interface MarketQuote {
  symbol: string;
  /** Always a finite number above zero: a provider with no usable price throws NoPriceError instead of returning 0. */
  lastPrice: number;
  totalVolume: number;
  /** Epoch ms of the trade / candle this price comes from (the provider's own timestamp, not the poll time). Absent when the provider gave none. */
  asOf?: number;
  /** True when the price is known or observed to be delayed (older than DELAYED_AFTER_MS, or a feed documented as delayed). */
  delayed?: boolean;
  /** Feed name, for example "iex", "coinbase", "oanda-m1-close". */
  feed?: string;
  /** True for generated (mock-mode) data. Never set on real data. */
  synthetic?: boolean;
}

/** A quote older than this is flagged `delayed`. Two minutes is longer than any normal live-feed gap on a liquid symbol. */
export const DELAYED_AFTER_MS = 2 * 60 * 1000;

/**
 * Thrown by every provider's fetchQuote when there is no usable price (missing, not a number, zero or negative).
 * The contract for the whole app: a missing price is an error, never the number 0. Consumers that can degrade
 * (alerts, portfolio valuation, watchlist rows) catch this and show "price unavailable".
 */
export class NoPriceError extends Error {
  readonly code = "NO_PRICE" as const;
  readonly provider: string;
  readonly symbol: string;
  constructor(provider: string, symbol: string, detail?: string) {
    super(`${provider} returned no usable price for ${symbol}${detail ? ` (${detail})` : ""}.`);
    this.name = "NoPriceError";
    this.provider = provider;
    this.symbol = symbol;
  }
}

export function isNoPriceError(e: unknown): e is NoPriceError {
  return e instanceof NoPriceError || (typeof e === "object" && e !== null && (e as { code?: unknown }).code === "NO_PRICE");
}

/** True for a finite number above zero. */
export function isUsablePrice(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** What a candle fetch cleaned or could not return in full. Reported, never silent. */
export interface FetchReport {
  /** Candles dropped because a field was missing, not finite, or not above zero, or high < low. */
  droppedInvalid: number;
  /** Candles dropped because their timestamp repeated an earlier one. */
  droppedDuplicate: number;
  /** True when pagination stopped at a cap, so older bars may be missing (the newest bars are always kept). */
  truncated: boolean;
  /** Plain-language warnings, empty when nothing was cleaned. */
  warnings: string[];
  /** True for generated (mock-mode) data. */
  synthetic?: boolean;
}

export interface MarketCandlesResult {
  candles: MarketCandle[];
  report: FetchReport;
}

/** Real bid/ask close at a point in time — forex only today (via OANDA). */
export interface MarketBidAsk {
  datetime: number; // epoch ms
  bid: number;
  ask: number;
}

export interface MarketOptionContract {
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
  /** Newest of the provider's trade / bid / ask timestamps for this contract (epoch ms). Only Tradier sets it; absent when the provider gave none. */
  quoteTimeMs?: number;
}

export interface MarketOptionsChain {
  symbol: string;
  calls: MarketOptionContract[];
  puts: MarketOptionContract[];
  /** Feed name, for example "tradier-sandbox", "tradier-production", "alpaca-indicative". */
  feed?: string;
  /** True when the chain is known to be delayed (the Tradier sandbox is about 15 minutes behind). */
  delayed?: boolean;
  /** Newest contract quote time in the chain (epoch ms), when the provider gave any. */
  asOf?: number;
  /** True for generated (mock-mode) data. */
  synthetic?: boolean;
}
