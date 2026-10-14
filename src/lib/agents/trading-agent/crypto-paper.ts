// Pure, zero-dependency pieces of crypto paper trading, shared by the engine and the order form so the numbers the form
// discloses are the numbers the engine charges. No network, no database.

/**
 * Assumed fee charged on every simulated crypto fill, as a fraction of the fill's dollar value. This is a stated
 * assumption, not Coinbase's schedule: the real rate depends on a 30-day volume tier and on maker versus taker, and the
 * current table could not be verified from public data, so one flat conservative rate (no maker discount) is used and
 * disclosed instead of a guessed tier.
 */
export const CRYPTO_PAPER_FEE_RATE = 0.006;

/** Candle size used to check resting crypto limit and stop orders (one 30-day pull is ~8,600 candles, ~29 requests). */
export const CRYPTO_ORDER_CHECK_TIMEFRAME = "5Min";

export const CRYPTO_PAPER_DISCLOSURE =
  "Crypto paper orders trade around the clock in fractional coins and fill at Coinbase's live ask (buy) or bid (sell), so the spread is the slippage. " +
  `An assumed flat fee of ${(CRYPTO_PAPER_FEE_RATE * 100).toFixed(2)}% of each fill is charged, which is not your actual Coinbase tier. ` +
  "Resting limit and stop orders are checked against 5-minute candles when you press Check Orders. Prices are from one exchange.";

export interface CryptoBidAsk {
  bid: number;
  ask: number;
}

/** Fee in dollars for one fill. */
export function cryptoFee(quantity: number, fillPrice: number): number {
  return quantity * fillPrice * CRYPTO_PAPER_FEE_RATE;
}

/** A market order crosses the spread: buys at the ask, sells at the bid. */
export function cryptoMarketFill(side: "buy" | "sell", q: CryptoBidAsk): number {
  return side === "buy" ? q.ask : q.bid;
}

/**
 * A limit order that is already marketable fills at the book price when that is better than the limit (a buy limit above
 * the ask fills at the ask), never worse than the limit itself.
 */
export function cryptoMarketableLimitFill(side: "buy" | "sell", limitPrice: number, q: CryptoBidAsk): number {
  return side === "buy" ? Math.min(limitPrice, q.ask) : Math.max(limitPrice, q.bid);
}

/**
 * A stop that triggered in the past became a market order at the trigger price, so it gives up half the current relative
 * spread (taken from the live book, as the past book is not available). Buys fill above the trigger, sells below.
 */
export function cryptoTriggeredFill(side: "buy" | "sell", triggerPrice: number, q: CryptoBidAsk): number {
  const mid = (q.bid + q.ask) / 2;
  const halfSpreadFraction = mid > 0 ? (q.ask - q.bid) / 2 / mid : 0;
  return side === "buy" ? triggerPrice * (1 + halfSpreadFraction) : triggerPrice * (1 - halfSpreadFraction);
}

/** Cash a crypto buy needs up front: the dollar cost at the worst-case price plus the assumed fee. */
export function cryptoBuyCashNeeded(quantity: number, worstCasePrice: number): number {
  return quantity * worstCasePrice * (1 + CRYPTO_PAPER_FEE_RATE);
}
