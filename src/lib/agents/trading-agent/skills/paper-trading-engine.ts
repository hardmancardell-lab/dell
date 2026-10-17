import { fetchBarsForTimeframe, fetchLatestCryptoBidAsk, fetchLatestForexBidAsk, fetchMinuteBars, fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";
import { buildOccSymbol } from "./option-symbol";
import { sanitizeAttribution } from "./paper-attribution";
import { normalizeCryptoSymbol, roundCryptoQuantity } from "../crypto-symbol";
import {
  CRYPTO_ORDER_CHECK_TIMEFRAME,
  CRYPTO_PAPER_FEE_RATE,
  cryptoBuyCashNeeded,
  cryptoFee,
  cryptoMarketFill,
  cryptoMarketableLimitFill,
  cryptoTriggeredFill,
} from "../crypto-paper";
import {
  cancelOcoSiblings,
  cancelOrder as dbCancelOrder,
  claimPendingOrder,
  rejectClaimedOrder,
  releaseClaimedOrder,
  createOrder as dbCreateOrder,
  deletePosition,
  getAccountById,
  getAccountBySessionId,
  getAllPendingOrders,
  getFills,
  getOpenOrders,
  getOrCreateAccount,
  getPosition,
  getPositions,
  insertFill,
  insertTradeLog,
  markOrderEvaluated,
  updateAccountCash,
  upsertPosition,
} from "@/lib/data/paper-trading-db";
import { computeWinLossMetrics } from "../stats";
import { ID_PATTERN, SYMBOL_PATTERN } from "@/lib/data/postgrest-safe";
import type {
  AssetClass,
  PaperAccountSummary,
  PaperOptionFields,
  PaperOptionRight,
  PaperOrder,
  PaperOrderCheckResult,
  PaperOrderInput,
  PaperOrderSide,
  PaperOrderType,
  PaperPositionView,
} from "../types";
import type { MarketCandle, MarketOptionContract } from "@/lib/data/market-data-types";

/**
 * Real fees, sell-side only, equities only — SEC Section 31 fee (effective
 * April 4, 2026) and FINRA Trading Activity Fee (effective January 1, 2026),
 * both web-verified against the current published rate sheets, not
 * estimated. No commission is modeled — most real brokers (Robinhood,
 * Schwab, Fidelity) charge $0 commission on equities today, so omitting one
 * is the honest default rather than a fabricated number.
 */
const SEC_FEE_RATE_PER_MILLION = 20.6; // $ per $1,000,000 of transaction value
const FINRA_TAF_PER_SHARE = 0.000195; // $ per share
const FINRA_TAF_CAP = 9.79; // $ per transaction

/**
 * Options-specific regulatory fees, both web-verified this session (not
 * estimated): SEC Section 31 explicitly covers options transactions too,
 * same $20.60/$1,000,000 rate, applied to the ×100-multiplier transaction
 * value, sell-side only (source: OCC's own March 2026 Section 31 rate-update
 * memo, infomemo.theocc.com #58530). OCC's standard per-contract clearing
 * fee is $0.025, charged on BOTH sides (opening and closing) — source:
 * theocc.com/company-information/schedule-of-fees. OCC has periodically run
 * temporary "fee holidays" waiving this via SRO filing (most recently
 * December 2025); this simulator uses the real standard rate rather than
 * guessing whether a holiday is currently active. FINRA TAF does not apply
 * to listed options (it's an equity/OTC-security fee), so no FINRA line is
 * charged here.
 */
const OCC_CLEARING_FEE_PER_CONTRACT = 0.025;
const OPTIONS_CONTRACT_MULTIPLIER = 100;

/**
 * No bid/ask spread is available from this app's equity/commodity/future
 * quote source (MarketQuote only carries lastPrice) — a flat per-share
 * slippage approximates it for market/triggered-stop fills, in the
 * ~$0.01-0.02/share range elite simulators (TradeStation, NinjaTrader)
 * document for liquid names. Limit fills need no separate slippage — they
 * fill at the limit price itself once the market trades through it. Options
 * (Tradier) and forex (OANDA) both have real bid/ask available and use it
 * directly instead of this constant — see resolveTriggeredFillPrice and
 * placeOptionOrder.
 */
const MARKET_SLIPPAGE_PER_SHARE = 0.02;

const STOP_LOOKBACK_CAP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — bounds how far back a very old resting order re-scans

// ---------------------------------------------------------------- input validation

const ASSET_CLASSES: readonly AssetClass[] = ["equity", "bond", "option", "future", "forex", "commodity", "crypto"];
const ORDER_TYPES: readonly PaperOrderType[] = ["market", "limit", "stop", "stop_limit", "trailing_stop"];
const SIDES: readonly PaperOrderSide[] = ["buy", "sell"];
const MAX_PRICE = 10_000_000;
/** Upper bound on one order's quantity, per asset class (shares / contracts / units / coins). Rejects typos and abuse, not real use. */
const MAX_QUANTITY: Record<AssetClass, number> = { equity: 10_000_000, bond: 10_000_000, future: 100_000, commodity: 10_000_000, option: 100_000, forex: 1_000_000_000, crypto: 1_000_000_000 };

export class PaperOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperOrderValidationError";
  }
}

function isPositiveFinite(v: unknown, max = MAX_PRICE): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
}

function optionalPrice(v: unknown, label: string): number | null {
  if (v === undefined || v === null) return null;
  if (!isPositiveFinite(v)) throw new PaperOrderValidationError(`${label} must be a finite positive number no larger than ${MAX_PRICE.toLocaleString("en-US")}.`);
  return v;
}

/**
 * Validates and normalizes an order that arrives from a public, anonymous-session route. Whitelists side, order type
 * and asset class; requires finite, positive, bounded quantity and prices; requires a plausible symbol; whole
 * quantities outside crypto (the quantity columns were integers before the crypto migration). Throws
 * PaperOrderValidationError with a user-readable message; never returns a partially-valid order.
 */
export function validatePaperOrderInput(raw: unknown): PaperOrderInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PaperOrderValidationError("Order must be an object.");
  const o = raw as Record<string, unknown>;
  if (typeof o.side !== "string" || !(SIDES as readonly string[]).includes(o.side)) throw new PaperOrderValidationError("Side must be 'buy' or 'sell'.");
  if (typeof o.orderType !== "string" || !(ORDER_TYPES as readonly string[]).includes(o.orderType)) throw new PaperOrderValidationError(`Order type must be one of: ${ORDER_TYPES.join(", ")}.`);
  if (typeof o.assetClass !== "string" || !(ASSET_CLASSES as readonly string[]).includes(o.assetClass)) throw new PaperOrderValidationError(`Asset class must be one of: ${ASSET_CLASSES.join(", ")}.`);
  const assetClass = o.assetClass as AssetClass;
  const side = o.side as PaperOrderSide;
  const orderType = o.orderType as PaperOrderType;

  if (typeof o.symbol !== "string") throw new PaperOrderValidationError("Symbol is required.");
  const symbol = o.symbol.trim().toUpperCase();
  if (assetClass !== "option" && !SYMBOL_PATTERN.test(symbol)) throw new PaperOrderValidationError("Symbol must be 1-32 characters: letters, digits, '.', '-', '^', '=' or '/'.");

  const quantity = o.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) throw new PaperOrderValidationError("Quantity must be a positive number.");
  if (quantity > MAX_QUANTITY[assetClass]) throw new PaperOrderValidationError(`Quantity is larger than the ${MAX_QUANTITY[assetClass].toLocaleString("en-US")} allowed for ${assetClass} orders.`);
  if (assetClass !== "crypto" && !Number.isInteger(quantity)) throw new PaperOrderValidationError("Quantity must be a whole number (fractional quantities are only supported for crypto).");

  const limitPrice = optionalPrice(o.limitPrice, "Limit price");
  const stopPrice = optionalPrice(o.stopPrice, "Stop price");
  const trailAmount = optionalPrice(o.trailAmount, "Trail amount");
  if ((orderType === "limit" || orderType === "stop_limit") && limitPrice === null) throw new PaperOrderValidationError("A positive limit price is required for limit/stop-limit orders.");
  if ((orderType === "stop" || orderType === "stop_limit") && stopPrice === null) throw new PaperOrderValidationError("A positive stop price is required for stop/stop-limit orders.");
  if (orderType === "trailing_stop" && trailAmount === null) throw new PaperOrderValidationError("A positive trail amount is required for trailing-stop orders.");

  for (const key of ["ocoGroupId", "strategyGroupId"] as const) {
    const v = o[key];
    if (v !== undefined && v !== null && (typeof v !== "string" || !ID_PATTERN.test(v))) throw new PaperOrderValidationError(`${key} is not a valid id.`);
  }

  const out: PaperOrderInput = {
    symbol,
    assetClass,
    side,
    orderType,
    quantity,
    limitPrice,
    stopPrice,
    trailAmount,
    ocoGroupId: (o.ocoGroupId as string | null | undefined) ?? null,
    strategyGroupId: (o.strategyGroupId as string | null | undefined) ?? null,
    attribution: (o.attribution as PaperOrderInput["attribution"]) ?? null,
  };

  if (assetClass === "option") {
    const underlying = typeof o.underlyingSymbol === "string" ? o.underlyingSymbol.trim().toUpperCase() : "";
    if (!SYMBOL_PATTERN.test(underlying)) throw new PaperOrderValidationError("Options orders require a valid underlyingSymbol.");
    if (typeof o.expirationDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.expirationDate) || Number.isNaN(Date.parse(o.expirationDate))) throw new PaperOrderValidationError("Options orders require expirationDate as YYYY-MM-DD.");
    if (o.optionRight !== "call" && o.optionRight !== "put") throw new PaperOrderValidationError("optionRight must be 'call' or 'put'.");
    if (!isPositiveFinite(o.strikePrice, 1_000_000)) throw new PaperOrderValidationError("strikePrice must be a finite positive number.");
    out.underlyingSymbol = underlying;
    out.expirationDate = o.expirationDate;
    out.optionRight = o.optionRight as PaperOptionRight;
    out.strikePrice = o.strikePrice as number;
  }
  return out;
}

/** A price is usable only if it is finite and above zero. A missing or zero quote must reject the order, never fill at 0. */
export function requireUsablePrice(price: unknown, label: string): number {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`No usable ${label} price right now, so the order was rejected and nothing was filled.`);
  }
  return price;
}

/** fetchQuote now rejects when the provider has no price; turn that (and any zero) into a clear rejection message. */
async function requireQuote(symbol: string): Promise<{ lastPrice: number }> {
  let quote: { lastPrice?: number };
  try {
    quote = await fetchQuote(symbol);
  } catch (err) {
    throw new Error(`Could not get a live price for ${symbol} (${err instanceof Error ? err.message : "unknown error"}). The order was rejected and nothing was filled.`);
  }
  return { lastPrice: requireUsablePrice(quote.lastPrice, symbol) };
}

// ---------------------------------------------------------------- per-account serialization

/**
 * Serializes async work per key inside this process, so overlapping orders / order checks on one account run one
 * after another instead of interleaving their read-modify-write of cash and positions (the audit measured 20
 * concurrent buys losing 23k of cash debits). LIMITATION: this protects one server instance only. Cross-instance
 * atomicity needs the database function in db/migrations/2026-10-16_paper_fill_atomic.sql.
 */
const accountLocks = new Map<string, Promise<unknown>>();
export async function withAccountLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => gate);
  accountLocks.set(key, tail);
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (accountLocks.get(key) === tail) accountLocks.delete(key);
  }
}

class FillRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FillRejectedError";
  }
}

/** 1 for every asset class except options, where 1 contract = 100 shares of notional exposure. Exported for reuse by portfolio-valuation.ts. */
export function notionalMultiplier(assetClass: AssetClass): number {
  return assetClass === "option" ? OPTIONS_CONTRACT_MULTIPLIER : 1;
}

/**
 * Crypto is the one class whose quantity is fractional and whose market never closes, so it gets its own pricing: fills
 * come from the live Coinbase bid/ask (see crypto-paper.ts) and an assumed flat fee is charged on both sides.
 */
export function prepareCryptoOrder(input: PaperOrderInput): PaperOrderInput {
  const symbol = normalizeCryptoSymbol(input.symbol);
  if (!symbol) throw new Error(`${input.symbol.trim().toUpperCase()} is not a Coinbase USD pair — use a symbol like BTC-USD.`);
  const quantity = roundCryptoQuantity(input.quantity);
  if (!(quantity > 0)) throw new Error("Quantity is below one satoshi (0.00000001) once rounded to 8 decimals.");
  return { ...input, symbol, quantity };
}

async function requireCryptoBidAsk(symbol: string): Promise<{ bid: number; ask: number }> {
  const bidAsk = await fetchLatestCryptoBidAsk(symbol);
  if (!bidAsk) throw new Error(`No live two-sided bid/ask for ${symbol} right now, so a fair simulated fill is not possible.`);
  return bidAsk;
}

/** A schema that predates fractional crypto (integer quantity, an asset_class check) fails at the database; say which migration fixes it. */
function explainCryptoDbError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/integer|22P02|check constraint|23514|invalid input/i.test(message)) {
    return new Error(
      `The paper-trading tables rejected a crypto order (${message.slice(0, 160)}). Apply db/migrations/2026-10-14_crypto_paper_trading.sql in the Supabase SQL editor to allow fractional quantities and the crypto asset class.`
    );
  }
  return err instanceof Error ? err : new Error(message);
}

function computeFees(
  assetClass: AssetClass,
  side: PaperOrderSide,
  quantity: number,
  fillPrice: number
): { secFee: number; finraFee: number; occFee: number; totalFees: number } {
  if (assetClass === "crypto") {
    return { secFee: 0, finraFee: 0, occFee: 0, totalFees: cryptoFee(quantity, fillPrice) };
  }
  if (assetClass === "option") {
    const occFee = quantity * OCC_CLEARING_FEE_PER_CONTRACT; // both sides
    if (side !== "sell") return { secFee: 0, finraFee: 0, occFee, totalFees: occFee };
    const transactionValue = quantity * OPTIONS_CONTRACT_MULTIPLIER * fillPrice;
    const secFee = (transactionValue / 1_000_000) * SEC_FEE_RATE_PER_MILLION;
    return { secFee, finraFee: 0, occFee, totalFees: secFee + occFee };
  }
  if (side !== "sell" || assetClass !== "equity") {
    return { secFee: 0, finraFee: 0, occFee: 0, totalFees: 0 };
  }
  const transactionValue = quantity * fillPrice;
  const secFee = (transactionValue / 1_000_000) * SEC_FEE_RATE_PER_MILLION;
  const finraFee = Math.min(quantity * FINRA_TAF_PER_SHARE, FINRA_TAF_CAP);
  return { secFee, finraFee, occFee: 0, totalFees: secFee + finraFee };
}

/**
 * Applies a fill to cash + position state. Handles both this app's original
 * long-only accumulate/reduce math (every asset class except options) AND
 * options' extended open/close-either-direction math (buying can open a new
 * long OR close an existing short; selling can close an existing long OR
 * open a new short — the latter only ever reaches here because placeOrder
 * already collateral-checked it as a covered call or cash-secured put). The
 * position's sign (positive = long, negative = short) is what the branching
 * below reads — equities/commodities/futures/forex can never go negative
 * because placeOrder's sell-side validation caps their sell quantity at
 * shares held, so their path through here is unchanged from before options
 * existed.
 */
async function applyFill(params: { order: PaperOrder; fillPrice: number; slippagePerShare: number }): Promise<void> {
  const { order, fillPrice, slippagePerShare } = params;
  const multiplier = notionalMultiplier(order.assetClass);
  const { secFee, finraFee, occFee, totalFees } = computeFees(order.assetClass, order.side, order.quantity, fillPrice);

  requireUsablePrice(fillPrice, order.symbol);
  const position = await getPosition(order.accountId, order.symbol, order.assetClass);
  const existingQty = position?.quantity ?? 0;

  // Re-check at fill time against FRESH state (a pending order may fill days after it was placed, and other fills may
  // have used the cash or shares since). Options keep their own collateral rules from placeOptionOrder.
  const grossValue = order.quantity * multiplier * fillPrice;
  const cashNeeded = order.side === "buy" ? grossValue + totalFees : 0;
  const freshAccount = await requireAccountById(order.accountId);
  if (order.side === "buy" && cashNeeded > freshAccount.cashBalance + 1e-9) {
    throw new FillRejectedError(`Insufficient cash at fill time: needs $${cashNeeded.toFixed(2)}, account has $${freshAccount.cashBalance.toFixed(2)}.`);
  }
  if (order.side === "sell" && order.assetClass !== "option" && existingQty < order.quantity - 1e-12) {
    throw new FillRejectedError(`Cannot sell ${order.quantity} ${order.symbol} at fill time: only ${existingQty} held.`);
  }
  if (order.side === "sell" && order.assetClass === "option" && existingQty > 0 && order.quantity > existingQty) {
    throw new FillRejectedError(`Cannot sell ${order.quantity} contract(s) at fill time: only ${existingQty} held.`);
  }
  const existingCost = position?.avgCostBasis ?? 0;
  const optionFields: Partial<PaperOptionFields> = {
    underlyingSymbol: order.underlyingSymbol,
    expirationDate: order.expirationDate,
    optionRight: order.optionRight,
    strikePrice: order.strikePrice,
  };

  let realizedPnl: number | null = null;
  let newQty: number;
  let newAvgCost: number;

  // Crypto: the fee on a buy is part of what the coins cost (the usual cost-basis treatment), so unrealized P&L is not overstated.
  const buyFeeIntoBasis = order.assetClass === "crypto" ? totalFees : 0;

  if (order.side === "buy") {
    if (existingQty < 0) {
      // buy-to-close a short options position
      newQty = existingQty + order.quantity;
      realizedPnl = (existingCost - fillPrice) * order.quantity * multiplier - totalFees;
      newAvgCost = existingCost; // unchanged basis for any remaining short
    } else {
      newQty = existingQty + order.quantity;
      newAvgCost = (existingQty * existingCost + order.quantity * fillPrice + buyFeeIntoBasis) / newQty;
    }
  } else {
    if (existingQty > 0) {
      // sell-to-close a long
      newQty = existingQty - order.quantity;
      realizedPnl = (fillPrice - existingCost) * order.quantity * multiplier - totalFees;
      newAvgCost = existingCost;
    } else {
      // sell-to-open (or extend) a short — always fully collateral-checked upstream
      const existingShortQty = Math.abs(existingQty);
      newQty = existingQty - order.quantity;
      newAvgCost = (existingShortQty * existingCost + order.quantity * fillPrice) / Math.abs(newQty);
    }
  }

  // Fractional coins leave float noise (0.3 - 0.1 - 0.2 is not 0) that would strand an unsellable dust position.
  if (order.assetClass === "crypto") newQty = roundCryptoQuantity(newQty);

  if (newQty === 0) {
    await deletePosition(order.accountId, order.symbol, order.assetClass);
  } else {
    await upsertPosition(order.accountId, order.symbol, order.assetClass, newQty, newAvgCost, optionFields);
  }

  const cashDelta = order.side === "buy" ? -(order.quantity * multiplier * fillPrice) - totalFees : order.quantity * multiplier * fillPrice - totalFees;
  await updateAccountCash(order.accountId, freshAccount.cashBalance + cashDelta);

  const fill = await insertFill({
    orderId: order.id,
    accountId: order.accountId,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    fillPrice,
    slippagePerShare,
    secFee,
    finraFee,
    occFee,
    totalFees,
    realizedPnl,
    ...optionFields,
  });

  await insertTradeLog(order, fill);
  // The order's pending -> filled transition is made by the caller BEFORE applyFill (claimPendingOrder, or created as
  // filled by placeOrder), so it is never done a second time here.

  if (order.ocoGroupId) {
    await cancelOcoSiblings(order.ocoGroupId, order.id);
  }
}

async function requireAccountById(accountId: string) {
  const acct = await getAccountById(accountId);
  if (!acct) throw new Error(`Paper account ${accountId} not found.`);
  return acct;
}

/** Finds one live contract's real quote — used both to price a new options order and to mark an existing options position to market. */
export async function getOptionContractQuote(
  underlyingSymbol: string,
  expirationDate: string,
  strikePrice: number,
  right: PaperOptionRight
): Promise<MarketOptionContract | null> {
  const chain = await fetchOptionsChain(underlyingSymbol, expirationDate);
  const contracts = right === "call" ? chain.calls : chain.puts;
  return contracts.find((c) => c.strikePrice === strikePrice) ?? null;
}

export interface PlaceOrderResult {
  order: PaperOrder;
  filled: boolean;
  rejected: string | null;
}

/**
 * Validates and places an order. Market orders (and marketable limit/stop
 * orders — ones that would already cross at today's price) fill immediately
 * against a real quote. Everything else rests as "pending" until a later
 * evaluateAllPendingOrders() call (user-triggered "Check Orders" or the
 * once-daily cron backstop — this app's Vercel plan allows only one cron
 * job, so there is no continuous background matching). Options are handled
 * entirely by placeOptionOrder — they're always market-only and never rest.
 */
export async function placeOrder(sessionId: string, rawInput: PaperOrderInput): Promise<PlaceOrderResult> {
  const validated = validatePaperOrderInput(rawInput);
  const isCrypto = validated.assetClass === "crypto";
  const input = isCrypto ? prepareCryptoOrder(validated) : validated;

  // One account-creation at a time per session (no unique constraint is guaranteed in the table), then one order at a
  // time per account so cash/position read-modify-write cycles never interleave inside this instance.
  const account = await withAccountLock(`session:${sessionId}`, () => getOrCreateAccount(sessionId));
  return withAccountLock(`acct:${account.id}`, () => (input.assetClass === "option" ? placeOptionOrder(sessionId, input) : placeStandardOrder(sessionId, input)));
}

async function placeStandardOrder(sessionId: string, input: PaperOrderInput): Promise<PlaceOrderResult> {
  const isCrypto = input.assetClass === "crypto";
  const account = await getOrCreateAccount(sessionId);
  const symbol = input.symbol.trim().toUpperCase();
  const quote = await requireQuote(symbol);
  const cryptoBook = isCrypto ? await requireCryptoBidAsk(symbol) : null;

  if (input.side === "sell") {
    const position = await getPosition(account.id, symbol, input.assetClass);
    const held = position?.quantity ?? 0;
    if (held < input.quantity) {
      throw new Error(`Cannot sell ${input.quantity} ${symbol} — only ${held} held. This simulator is long-only (no short selling) outside of collateralized options.`);
    }
  } else {
    const worstCasePrice = input.orderType === "limit" ? input.limitPrice! : input.orderType === "market" ? quote.lastPrice : (input.limitPrice ?? input.stopPrice ?? quote.lastPrice);
    // Crypto market buys are worst-cased at the live ask, and the assumed fee is part of the cash an order needs.
    const pricedWorstCase = cryptoBook && input.orderType === "market" ? cryptoBook.ask : worstCasePrice;
    const estimatedCost = isCrypto ? cryptoBuyCashNeeded(input.quantity, pricedWorstCase) : worstCasePrice * input.quantity;
    if (estimatedCost > account.cashBalance) {
      throw new Error(
        `Insufficient cash: order needs an estimated $${estimatedCost.toFixed(2)}${isCrypto ? " (including the assumed fee)" : ""}, account has $${account.cashBalance.toFixed(2)} available.`
      );
    }
  }

  const ocoGroupId = input.ocoGroupId ?? null;
  // Crypto compares a limit against the side of the book it would trade on; everything else against the last price.
  const buyReference = cryptoBook ? cryptoBook.ask : quote.lastPrice;
  const sellReference = cryptoBook ? cryptoBook.bid : quote.lastPrice;
  const isImmediatelyMarketable =
    input.orderType === "market" ||
    (input.orderType === "limit" && input.side === "buy" && input.limitPrice! >= buyReference) ||
    (input.orderType === "limit" && input.side === "sell" && input.limitPrice! <= sellReference);

  const createOrder = isCrypto ? (o: Parameters<typeof dbCreateOrder>[0]) => dbCreateOrder(o).catch((err) => { throw explainCryptoDbError(err); }) : dbCreateOrder;
  const order = await createOrder({
    accountId: account.id,
    symbol,
    assetClass: input.assetClass,
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    limitPrice: input.limitPrice ?? null,
    stopPrice: input.stopPrice ?? null,
    trailAmount: input.trailAmount ?? null,
    ocoGroupId,
    strategyGroupId: input.strategyGroupId ?? null,
    attribution: sanitizeAttribution(input.attribution, "api"),
    status: isImmediatelyMarketable ? "filled" : "pending",
    rejectedReason: null,
  });

  if (!isImmediatelyMarketable) {
    return { order, filled: false, rejected: null };
  }

  let fillPrice: number;
  let slippagePerShare: number;

  if (cryptoBook) {
    // Real two-sided book: a market order crosses the spread; an already-marketable limit fills at the book price when
    // that beats the limit. The spread is the slippage.
    fillPrice = input.orderType === "market" ? cryptoMarketFill(input.side, cryptoBook) : cryptoMarketableLimitFill(input.side, input.limitPrice!, cryptoBook);
    slippagePerShare = Math.abs(fillPrice - (cryptoBook.bid + cryptoBook.ask) / 2);
  } else if (input.orderType === "market" && input.assetClass === "forex") {
    const bidAsk = await fetchLatestForexBidAsk(symbol);
    if (bidAsk) {
      fillPrice = input.side === "buy" ? bidAsk.ask : bidAsk.bid;
      slippagePerShare = Math.abs(fillPrice - (bidAsk.bid + bidAsk.ask) / 2);
    } else {
      fillPrice = applySlippage(input.side, quote.lastPrice, MARKET_SLIPPAGE_PER_SHARE);
      slippagePerShare = MARKET_SLIPPAGE_PER_SHARE;
    }
  } else if (input.orderType === "market") {
    fillPrice = applySlippage(input.side, quote.lastPrice, MARKET_SLIPPAGE_PER_SHARE);
    slippagePerShare = MARKET_SLIPPAGE_PER_SHARE;
  } else {
    fillPrice = input.limitPrice!; // marketable limit fills at the limit price itself, not through it
    slippagePerShare = 0;
  }

  try {
    await applyFill({ order: { ...order, quantity: input.quantity }, fillPrice, slippagePerShare });
  } catch (err) {
    // The order row was already written as filled; do not leave it claiming a fill that never reached the position.
    await dbCancelOrder(order.id, "filled").catch(() => undefined);
    if (!isCrypto) throw err;
    throw explainCryptoDbError(err);
  }

  return { order: { ...order, status: "filled" }, filled: true, rejected: null };
}

/**
 * Options are always market orders filled immediately against a real
 * Tradier bid/ask — no historical intraday bar feed exists for individual
 * contracts in this app, so a resting limit/stop order would have nothing
 * real to evaluate against (see the top-of-file constants comment). Selling
 * to open (writing) is allowed only when fully collateralized: a covered
 * call requires already holding >= 100 * contracts shares of the
 * underlying, a cash-secured put requires reserving strike * 100 * contracts
 * in cash. Anything else ("naked" selling) is rejected, extending — not
 * abandoning — this app's existing no-margin/no-shorting equity rule.
 */
async function placeOptionOrder(sessionId: string, input: PaperOrderInput): Promise<PlaceOrderResult> {
  if (input.orderType !== "market") {
    throw new Error(
      "Only market orders are supported for options — this app has no historical intraday bar feed for individual option contracts to evaluate a resting limit/stop order against."
    );
  }
  if (!input.underlyingSymbol || !input.expirationDate || !input.optionRight || !input.strikePrice) {
    throw new Error("Options orders require underlyingSymbol, expirationDate, optionRight, and strikePrice.");
  }

  const underlyingSymbol = input.underlyingSymbol.trim().toUpperCase();
  const expirationDate = input.expirationDate;
  const optionRight = input.optionRight;
  const strikePrice = input.strikePrice;

  const contract = await getOptionContractQuote(underlyingSymbol, expirationDate, strikePrice, optionRight);
  if (!contract) {
    throw new Error(`No live contract found for ${underlyingSymbol} ${expirationDate} $${strikePrice} ${optionRight}.`);
  }

  const account = await getOrCreateAccount(sessionId);
  const symbol = buildOccSymbol(underlyingSymbol, expirationDate, optionRight, strikePrice);
  const position = await getPosition(account.id, symbol, "option");
  const existingQty = position?.quantity ?? 0;

  const fillPrice = requireUsablePrice(input.side === "buy" ? contract.ask : contract.bid, `${symbol} ${input.side === "buy" ? "ask" : "bid"}`);
  const mid = (contract.bid + contract.ask) / 2;
  const slippagePerShare = Math.abs(fillPrice - mid);
  const { totalFees } = computeFees("option", input.side, input.quantity, fillPrice);

  if (input.side === "buy") {
    if (existingQty < 0) {
      if (input.quantity > Math.abs(existingQty)) {
        throw new Error(`Cannot buy ${input.quantity} contract(s) to close a ${Math.abs(existingQty)}-contract short position in one order.`);
      }
    } else {
      const estimatedCost = contract.ask * OPTIONS_CONTRACT_MULTIPLIER * input.quantity + totalFees;
      if (estimatedCost > account.cashBalance) {
        throw new Error(
          `Insufficient cash: buying ${input.quantity} contract(s) needs an estimated $${estimatedCost.toFixed(2)}, account has $${account.cashBalance.toFixed(2)} available.`
        );
      }
    }
  } else {
    if (existingQty > 0) {
      if (input.quantity > existingQty) {
        throw new Error(`Cannot sell ${input.quantity} contract(s) — only ${existingQty} held.`);
      }
    } else if (optionRight === "call") {
      const underlyingPosition = await getPosition(account.id, underlyingSymbol, "equity");
      const sharesHeld = underlyingPosition?.quantity ?? 0;
      const sharesNeeded = input.quantity * OPTIONS_CONTRACT_MULTIPLIER;
      if (sharesHeld < sharesNeeded) {
        throw new Error(
          `Selling ${input.quantity} call(s) to open requires holding ${sharesNeeded} shares of ${underlyingSymbol} (a covered call) — only ${sharesHeld} held. This simulator has no margin model, so uncovered option selling isn't supported.`
        );
      }
    } else {
      const cashNeeded = strikePrice * OPTIONS_CONTRACT_MULTIPLIER * input.quantity;
      if (cashNeeded > account.cashBalance) {
        throw new Error(
          `Selling ${input.quantity} put(s) to open requires reserving $${cashNeeded.toFixed(2)} in cash (a cash-secured put) — only $${account.cashBalance.toFixed(2)} available. This simulator has no margin model, so uncovered option selling isn't supported.`
        );
      }
    }
  }

  const order = await dbCreateOrder({
    accountId: account.id,
    symbol,
    assetClass: "option",
    side: input.side,
    orderType: "market",
    quantity: input.quantity,
    limitPrice: null,
    stopPrice: null,
    trailAmount: null,
    ocoGroupId: null,
    strategyGroupId: input.strategyGroupId ?? null,
    attribution: sanitizeAttribution(input.attribution, "api"),
    status: "filled",
    rejectedReason: null,
    underlyingSymbol,
    expirationDate,
    optionRight,
    strikePrice,
  });

  try {
    await applyFill({ order: { ...order, quantity: input.quantity }, fillPrice, slippagePerShare });
  } catch (err) {
    await dbCancelOrder(order.id, "filled").catch(() => undefined);
    throw err;
  }

  return { order: { ...order, status: "filled" }, filled: true, rejected: null };
}

function applySlippage(side: PaperOrderSide, price: number, slippagePerShare: number): number {
  return side === "buy" ? price + slippagePerShare : price - slippagePerShare;
}

/** Real bid/ask for forex once a stop/trailing-stop triggers; falls back to the flat slippage constant for every other asset class (unchanged behavior). */
async function resolveTriggeredFillPrice(
  assetClass: AssetClass,
  symbol: string,
  side: PaperOrderSide,
  triggerPrice: number
): Promise<{ fillPrice: number; slippagePerShare: number }> {
  if (assetClass === "forex") {
    const bidAsk = await fetchLatestForexBidAsk(symbol);
    if (bidAsk) {
      const fillPrice = side === "buy" ? bidAsk.ask : bidAsk.bid;
      return { fillPrice, slippagePerShare: Math.abs(fillPrice - (bidAsk.bid + bidAsk.ask) / 2) };
    }
  }
  if (assetClass === "crypto") {
    // The flat $0.02 per share would be meaningless for a coin priced anywhere from $0.00001 to $100,000, so a triggered
    // stop gives up half the current relative spread instead. No live book means the order stays pending, not a guess.
    const fillPrice = cryptoTriggeredFill(side, triggerPrice, await requireCryptoBidAsk(symbol));
    return { fillPrice, slippagePerShare: Math.abs(fillPrice - triggerPrice) };
  }
  return { fillPrice: applySlippage(side, triggerPrice, MARKET_SLIPPAGE_PER_SHARE), slippagePerShare: MARKET_SLIPPAGE_PER_SHARE };
}

/**
 * Evaluates one pending order against real minute-bar price history since
 * its creation (capped to the last 30 days for very old resting orders) —
 * fills are based on the bar's actual high/low crossing the trigger level,
 * not merely the latest price "touching" it, per this app's explicit
 * full-realism design choice. Always re-scans from order creation rather
 * than resuming from the last check, which keeps stop-limit's two-phase
 * (trigger, then limit) and trailing-stop's peak/trough tracking correct
 * without needing extra persisted state. Options are never pending (always
 * filled synchronously in placeOptionOrder) — reaching this function with
 * an option order would be a bug, so it's guarded explicitly rather than
 * silently mishandled.
 */
async function evaluateOrder(order: PaperOrder): Promise<{ filled: boolean; cancelledOco: string[]; rejectedReason?: string }> {
  if (order.assetClass === "option") {
    throw new Error(`Order ${order.id} is an option order and should never be pending — this is a bug if reached.`);
  }

  const createdMs = new Date(order.createdAt).getTime();
  const startMs = Math.max(createdMs, Date.now() - STOP_LOOKBACK_CAP_MS);
  const endMs = Date.now();

  // Crypto resting orders are checked against 5-minute candles: a 30-day lookback in 1-minute candles would be ~144 requests.
  const rawBars =
    order.assetClass === "crypto"
      ? await fetchBarsForTimeframe(order.symbol, CRYPTO_ORDER_CHECK_TIMEFRAME, startMs, endMs, 60)
      : await fetchMinuteBars(order.symbol, startMs, endMs, 60, { adjustment: "raw" }); // fills must use the prices actually traded, never back-adjusted ones
  const bars = [...rawBars].sort((a, b) => a.datetime - b.datetime);

  let fillPrice: number | null = null;
  let slippagePerShare = 0;
  let trailingStopPrice = order.trailingStopPrice;

  if (bars.length === 0) {
    await markOrderEvaluated(order.id, trailingStopPrice);
    return { filled: false, cancelledOco: [] };
  }

  if (order.orderType === "limit") {
    fillPrice = scanLimitFill(order.side, order.limitPrice!, bars);
  } else if (order.orderType === "stop") {
    const triggerPrice = scanStopTrigger(order.side, order.stopPrice!, bars);
    if (triggerPrice !== null) {
      const resolved = await resolveTriggeredFillPrice(order.assetClass, order.symbol, order.side, order.stopPrice!);
      fillPrice = resolved.fillPrice;
      slippagePerShare = resolved.slippagePerShare;
    }
  } else if (order.orderType === "stop_limit") {
    const triggerIndex = findStopTriggerIndex(order.side, order.stopPrice!, bars);
    if (triggerIndex !== null) {
      const remainingBars = bars.slice(triggerIndex);
      fillPrice = scanLimitFill(order.side, order.limitPrice!, remainingBars);
    }
  } else if (order.orderType === "trailing_stop") {
    const result = scanTrailingStop(order.side, order.trailAmount!, bars);
    trailingStopPrice = result.finalStopPrice;
    if (result.filled) {
      const resolved = await resolveTriggeredFillPrice(order.assetClass, order.symbol, order.side, result.finalStopPrice);
      fillPrice = resolved.fillPrice;
      slippagePerShare = resolved.slippagePerShare;
    }
  }

  if (fillPrice === null) {
    await markOrderEvaluated(order.id, trailingStopPrice);
    return { filled: false, cancelledOco: [] };
  }

  requireUsablePrice(fillPrice, order.symbol);
  const pendingOrder = order;
  const fillPriceFinal = fillPrice;
  const slippageFinal = slippagePerShare;

  // Claim the order with a conditional PATCH (status=eq.pending) BEFORE touching cash or positions: only one of
  // several overlapping evaluators can win, so one order can never fill twice. The per-account lock keeps the fill's
  // cash/position updates from interleaving with other orders of the same account in this instance.
  return withAccountLock(`acct:${pendingOrder.accountId}`, async () => {
    const claimed = await claimPendingOrder(pendingOrder.id);
    if (!claimed) return { filled: false, cancelledOco: [] as string[] };
    try {
      await applyFill({ order: pendingOrder, fillPrice: fillPriceFinal, slippagePerShare: slippageFinal });
    } catch (err) {
      if (err instanceof FillRejectedError) {
        await rejectClaimedOrder(pendingOrder.id, err.message).catch(() => undefined);
        return { filled: false, cancelledOco: [] as string[], rejectedReason: err.message };
      }
      await releaseClaimedOrder(pendingOrder.id).catch(() => undefined);
      throw err;
    }
    const cancelledOco = pendingOrder.ocoGroupId ? await cancelOcoSiblings(pendingOrder.ocoGroupId, pendingOrder.id) : [];
    return { filled: true, cancelledOco };
  });
}

function scanLimitFill(side: PaperOrderSide, limitPrice: number, bars: MarketCandle[]): number | null {
  for (const bar of bars) {
    if (side === "buy" && bar.low <= limitPrice) return limitPrice;
    if (side === "sell" && bar.high >= limitPrice) return limitPrice;
  }
  return null;
}

function scanStopTrigger(side: PaperOrderSide, stopPrice: number, bars: MarketCandle[]): number | null {
  for (const bar of bars) {
    if (side === "buy" && bar.high >= stopPrice) return stopPrice;
    if (side === "sell" && bar.low <= stopPrice) return stopPrice;
  }
  return null;
}

function findStopTriggerIndex(side: PaperOrderSide, stopPrice: number, bars: MarketCandle[]): number | null {
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (side === "buy" && bar.high >= stopPrice) return i;
    if (side === "sell" && bar.low <= stopPrice) return i;
  }
  return null;
}

/** Sell trailing-stop ratchets up behind the running peak high; buy trailing-stop ratchets down behind the running trough low. */
function scanTrailingStop(
  side: PaperOrderSide,
  trailAmount: number,
  bars: MarketCandle[]
): { filled: boolean; finalStopPrice: number } {
  let extreme = side === "sell" ? bars[0].high : bars[0].low;
  let stopPrice = side === "sell" ? extreme - trailAmount : extreme + trailAmount;

  for (const bar of bars) {
    if (side === "sell") {
      extreme = Math.max(extreme, bar.high);
      stopPrice = Math.max(stopPrice, extreme - trailAmount);
      if (bar.low <= stopPrice) return { filled: true, finalStopPrice: stopPrice };
    } else {
      extreme = Math.min(extreme, bar.low);
      stopPrice = Math.min(stopPrice, extreme + trailAmount);
      if (bar.high >= stopPrice) return { filled: true, finalStopPrice: stopPrice };
    }
  }
  return { filled: false, finalStopPrice: stopPrice };
}

/** Evaluates every pending order for one account — the "Check Orders" button's entry point. */
export async function evaluateAccountOrders(accountId: string): Promise<PaperOrderCheckResult> {
  const orders = await getOpenOrders(accountId);
  return evaluateOrders(orders);
}

/** Evaluates every pending order across every account — the daily-cron backstop's entry point. */
export async function evaluateAllPendingOrders(): Promise<PaperOrderCheckResult> {
  const orders = await getAllPendingOrders();
  return evaluateOrders(orders);
}

async function evaluateOrders(orders: PaperOrder[]): Promise<PaperOrderCheckResult> {
  let ordersFilled = 0;
  let ordersCancelledByOco = 0;
  const errors: { orderId: string; error: string }[] = [];
  const alreadyCancelled = new Set<string>();

  for (const order of orders) {
    if (alreadyCancelled.has(order.id)) continue;
    try {
      const result = await evaluateOrder(order);
      if (result.rejectedReason) errors.push({ orderId: order.id, error: `Order rejected at fill time: ${result.rejectedReason}` });
      if (result.filled) ordersFilled++;
      for (const id of result.cancelledOco) {
        alreadyCancelled.add(id);
        ordersCancelledByOco++;
      }
    } catch (err) {
      errors.push({ orderId: order.id, error: err instanceof Error ? err.message : "unknown error" });
    }
  }

  return { ordersEvaluated: orders.length, ordersFilled, ordersCancelledByOco, errors };
}

export async function getAccountSummary(sessionId: string): Promise<PaperAccountSummary> {
  const account = await getOrCreateAccount(sessionId);
  const [positions, openOrders, recentFills] = await Promise.all([
    getPositions(account.id),
    getOpenOrders(account.id),
    getFills(account.id, 200),
  ]);

  const dataLimitations: string[] = [
    "No margin or short selling outside of fully-collateralized options — covered calls require already holding the underlying shares, cash-secured puts require reserving the strike value in cash. This simulator has no margin/borrow model, so anything beyond that is rejected rather than faked.",
    "No bid/ask spread data is available for equities/commodities/futures, so their market and triggered-stop fills use a flat $0.02/share slippage approximation. Options (Tradier) and forex (OANDA) fill at real bid/ask instead — no separate slippage constant for those two.",
    "Options only support market orders — no historical intraday bar feed exists for individual option contracts in this app, so a resting limit/stop order would have nothing real to evaluate against.",
    ...(positions.some((p) => p.assetClass === "crypto") || openOrders.some((o) => o.assetClass === "crypto") || recentFills.some((f) => f.symbol.endsWith("-USD"))
      ? [
          `Crypto fills use Coinbase's live bid/ask in fractional coins around the clock, with an assumed flat ${(CRYPTO_PAPER_FEE_RATE * 100).toFixed(2)}% fee per fill (not your actual Coinbase tier; the buy-side fee is added to cost basis). Resting crypto limit and stop orders are checked against 5-minute candles, so a brief spike inside one candle can be missed or ordered differently from the real market.`,
        ]
      : []),
    "Cash and share/contract availability are checked at order placement, not reserved across multiple simultaneously-pending orders — placing several orders that together exceed available cash, shares, or collateral is possible and resolved on a first-fill-wins basis as each is evaluated, not blocked upfront.",
  ];

  const positionViews: PaperPositionView[] = await Promise.all(
    positions.map(async (p): Promise<PaperPositionView> => {
      try {
        if (p.assetClass === "option" && p.underlyingSymbol && p.expirationDate && p.optionRight && p.strikePrice !== null) {
          const contract = await getOptionContractQuote(p.underlyingSymbol, p.expirationDate, p.strikePrice, p.optionRight);
          if (!contract) throw new Error("contract not found");
          const mid = (contract.bid + contract.ask) / 2;
          const marketValue = mid * OPTIONS_CONTRACT_MULTIPLIER * p.quantity;
          const costValue = p.avgCostBasis * OPTIONS_CONTRACT_MULTIPLIER * p.quantity;
          return {
            ...p,
            currentPrice: mid,
            marketValue,
            unrealizedPnl: marketValue - costValue,
            unrealizedPnlPct: costValue !== 0 ? ((marketValue - costValue) / Math.abs(costValue)) * 100 : null,
          };
        }
        const quote = await fetchQuote(p.symbol);
        const marketValue = quote.lastPrice * p.quantity;
        const costValue = p.avgCostBasis * p.quantity;
        return {
          ...p,
          currentPrice: quote.lastPrice,
          marketValue,
          unrealizedPnl: marketValue - costValue,
          unrealizedPnlPct: costValue > 0 ? ((marketValue - costValue) / costValue) * 100 : null,
        };
      } catch {
        dataLimitations.push(`Could not fetch a current quote for ${p.symbol} — its market value is excluded from totals below.`);
        return { ...p, currentPrice: null, marketValue: null, unrealizedPnl: null, unrealizedPnlPct: null };
      }
    })
  );

  const positionsValue = positionViews.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  const totalUnrealizedPnl = positionViews.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0);
  const totalRealizedPnl = recentFills.reduce((sum, f) => sum + (f.realizedPnl ?? 0), 0);

  const closingFillReturnsPct = recentFills
    .filter((f) => f.side === "sell" && f.realizedPnl !== null)
    .map((f) => {
      const costBasis = f.fillPrice * f.quantity - f.realizedPnl!;
      return costBasis > 0 ? (f.realizedPnl! / costBasis) * 100 : 0;
    });

  return {
    account,
    positions: positionViews,
    openOrders,
    recentFills,
    cashBalance: account.cashBalance,
    positionsValue,
    totalEquity: account.cashBalance + positionsValue,
    totalUnrealizedPnl,
    totalRealizedPnl,
    winLoss: closingFillReturnsPct.length > 0 ? computeWinLossMetrics(closingFillReturnsPct) : null,
    dataLimitations,
  };
}

export async function cancelUserOrder(orderId: string, sessionId: string): Promise<void> {
  const account = await getAccountBySessionId(sessionId);
  if (!account) throw new Error("No paper trading account found for this session.");
  const orders = await getOpenOrders(account.id);
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found, already filled, or already cancelled.");
  // Conditional on status=pending: if a fill won the race a moment ago, the cancel must lose, not overwrite it.
  const cancelled = await dbCancelOrder(orderId);
  if (!cancelled) throw new Error("Order not found, already filled, or already cancelled.");
}

export type { PaperOrderType };
