import { fetchLatestForexBidAsk, fetchMinuteBars, fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";
import { buildOccSymbol } from "./option-symbol";
import {
  cancelOcoSiblings,
  cancelOrder as dbCancelOrder,
  createOrder as dbCreateOrder,
  deletePosition,
  fillOrder as dbFillOrder,
  getAccountById,
  getAccountBySessionId,
  getAllPendingOrders,
  getFills,
  getOpenOrders,
  getOrCreateAccount,
  getPosition,
  getPositions,
  insertFill,
  markOrderEvaluated,
  updateAccountCash,
  upsertPosition,
} from "@/lib/data/paper-trading-db";
import { computeWinLossMetrics } from "../stats";
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

/** 1 for every asset class except options, where 1 contract = 100 shares of notional exposure. Exported for reuse by portfolio-valuation.ts. */
export function notionalMultiplier(assetClass: AssetClass): number {
  return assetClass === "option" ? OPTIONS_CONTRACT_MULTIPLIER : 1;
}

function computeFees(
  assetClass: AssetClass,
  side: PaperOrderSide,
  quantity: number,
  fillPrice: number
): { secFee: number; finraFee: number; occFee: number; totalFees: number } {
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

  const position = await getPosition(order.accountId, order.symbol, order.assetClass);
  const existingQty = position?.quantity ?? 0;
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

  if (order.side === "buy") {
    if (existingQty < 0) {
      // buy-to-close a short options position
      newQty = existingQty + order.quantity;
      realizedPnl = (existingCost - fillPrice) * order.quantity * multiplier - totalFees;
      newAvgCost = existingCost; // unchanged basis for any remaining short
    } else {
      newQty = existingQty + order.quantity;
      newAvgCost = (existingQty * existingCost + order.quantity * fillPrice) / newQty;
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

  if (newQty === 0) {
    await deletePosition(order.accountId, order.symbol, order.assetClass);
  } else {
    await upsertPosition(order.accountId, order.symbol, order.assetClass, newQty, newAvgCost, optionFields);
  }

  const cashDelta = order.side === "buy" ? -(order.quantity * multiplier * fillPrice) - totalFees : order.quantity * multiplier * fillPrice - totalFees;
  const acct = await requireAccountById(order.accountId);
  await updateAccountCash(order.accountId, acct.cashBalance + cashDelta);

  await insertFill({
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

  await dbFillOrder(order.id);

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
export async function placeOrder(sessionId: string, input: PaperOrderInput): Promise<PlaceOrderResult> {
  if (input.quantity <= 0 || !Number.isFinite(input.quantity)) {
    throw new Error("Quantity must be a positive number.");
  }

  if (input.assetClass === "option") {
    return placeOptionOrder(sessionId, input);
  }

  if ((input.orderType === "limit" || input.orderType === "stop_limit") && !(input.limitPrice && input.limitPrice > 0)) {
    throw new Error("A positive limit price is required for limit/stop-limit orders.");
  }
  if ((input.orderType === "stop" || input.orderType === "stop_limit") && !(input.stopPrice && input.stopPrice > 0)) {
    throw new Error("A positive stop price is required for stop/stop-limit orders.");
  }
  if (input.orderType === "trailing_stop" && !(input.trailAmount && input.trailAmount > 0)) {
    throw new Error("A positive trail amount is required for trailing-stop orders.");
  }

  const account = await getOrCreateAccount(sessionId);
  const symbol = input.symbol.trim().toUpperCase();
  const quote = await fetchQuote(symbol);

  if (input.side === "sell") {
    const position = await getPosition(account.id, symbol, input.assetClass);
    const held = position?.quantity ?? 0;
    if (held < input.quantity) {
      throw new Error(`Cannot sell ${input.quantity} ${symbol} — only ${held} held. This simulator is long-only (no short selling) outside of collateralized options.`);
    }
  } else {
    const worstCasePrice = input.orderType === "limit" ? input.limitPrice! : input.orderType === "market" ? quote.lastPrice : (input.limitPrice ?? input.stopPrice ?? quote.lastPrice);
    const estimatedCost = worstCasePrice * input.quantity;
    if (estimatedCost > account.cashBalance) {
      throw new Error(`Insufficient cash: order needs an estimated $${estimatedCost.toFixed(2)}, account has $${account.cashBalance.toFixed(2)} available.`);
    }
  }

  const ocoGroupId = input.ocoGroupId ?? null;
  const isImmediatelyMarketable =
    input.orderType === "market" ||
    (input.orderType === "limit" && input.side === "buy" && input.limitPrice! >= quote.lastPrice) ||
    (input.orderType === "limit" && input.side === "sell" && input.limitPrice! <= quote.lastPrice);

  const order = await dbCreateOrder({
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
    status: isImmediatelyMarketable ? "filled" : "pending",
    rejectedReason: null,
  });

  if (!isImmediatelyMarketable) {
    return { order, filled: false, rejected: null };
  }

  let fillPrice: number;
  let slippagePerShare: number;

  if (input.orderType === "market" && input.assetClass === "forex") {
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

  await applyFill({ order: { ...order, quantity: input.quantity }, fillPrice, slippagePerShare });

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

  const fillPrice = input.side === "buy" ? contract.ask : contract.bid;
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
    status: "filled",
    rejectedReason: null,
    underlyingSymbol,
    expirationDate,
    optionRight,
    strikePrice,
  });

  await applyFill({ order: { ...order, quantity: input.quantity }, fillPrice, slippagePerShare });

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
async function evaluateOrder(order: PaperOrder): Promise<{ filled: boolean; cancelledOco: string[] }> {
  if (order.assetClass === "option") {
    throw new Error(`Order ${order.id} is an option order and should never be pending — this is a bug if reached.`);
  }

  const createdMs = new Date(order.createdAt).getTime();
  const startMs = Math.max(createdMs, Date.now() - STOP_LOOKBACK_CAP_MS);
  const endMs = Date.now();

  const rawBars = await fetchMinuteBars(order.symbol, startMs, endMs, 60);
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

  await applyFill({ order, fillPrice, slippagePerShare });
  const cancelledOco = order.ocoGroupId ? await cancelOcoSiblings(order.ocoGroupId, order.id) : [];
  return { filled: true, cancelledOco };
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
  await dbCancelOrder(orderId);
}

export type { PaperOrderType };
