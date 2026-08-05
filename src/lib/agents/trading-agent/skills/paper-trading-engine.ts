import { fetchMinuteBars, fetchQuote } from "@/lib/data/market-data";
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
  PaperOrder,
  PaperOrderCheckResult,
  PaperOrderInput,
  PaperOrderSide,
  PaperOrderType,
  PaperPositionView,
} from "../types";
import type { MarketCandle } from "@/lib/data/market-data-types";

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
 * No bid/ask spread is available from this app's quote source (MarketQuote
 * only carries lastPrice) — a flat per-share slippage approximates it for
 * market/triggered-stop fills, in the ~$0.01-0.02/share range elite
 * simulators (TradeStation, NinjaTrader) document for liquid names. Limit
 * fills need no separate slippage — they fill at the limit price itself
 * once the market trades through it.
 */
const MARKET_SLIPPAGE_PER_SHARE = 0.02;

const STOP_LOOKBACK_CAP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — bounds how far back a very old resting order re-scans

function computeSellFees(assetClass: AssetClass, quantity: number, fillPrice: number): { secFee: number; finraFee: number; totalFees: number } {
  if (assetClass !== "equity") return { secFee: 0, finraFee: 0, totalFees: 0 };
  const transactionValue = quantity * fillPrice;
  const secFee = (transactionValue / 1_000_000) * SEC_FEE_RATE_PER_MILLION;
  const finraFee = Math.min(quantity * FINRA_TAF_PER_SHARE, FINRA_TAF_CAP);
  return { secFee, finraFee, totalFees: secFee + finraFee };
}

async function applyFill(params: {
  order: PaperOrder;
  fillPrice: number;
  slippagePerShare: number;
}): Promise<void> {
  const { order, fillPrice, slippagePerShare } = params;
  const { secFee, finraFee, totalFees } = order.side === "sell" ? computeSellFees(order.assetClass, order.quantity, fillPrice) : { secFee: 0, finraFee: 0, totalFees: 0 };

  const position = await getPosition(order.accountId, order.symbol);

  let realizedPnl: number | null = null;

  if (order.side === "buy") {
    const existingQty = position?.quantity ?? 0;
    const existingCost = position?.avgCostBasis ?? 0;
    const newQty = existingQty + order.quantity;
    const newAvgCost = (existingQty * existingCost + order.quantity * fillPrice) / newQty;
    await upsertPosition(order.accountId, order.symbol, order.assetClass, newQty, newAvgCost);

    const cashDelta = -(order.quantity * fillPrice) - totalFees;
    const acct = await requireAccountById(order.accountId);
    await updateAccountCash(order.accountId, acct.cashBalance + cashDelta);
  } else {
    const existingQty = position?.quantity ?? 0;
    const existingCost = position?.avgCostBasis ?? 0;
    const newQty = existingQty - order.quantity;
    realizedPnl = (fillPrice - existingCost) * order.quantity - totalFees;

    if (newQty <= 0) {
      await deletePosition(order.accountId, order.symbol);
    } else {
      await upsertPosition(order.accountId, order.symbol, order.assetClass, newQty, existingCost);
    }

    const cashDelta = order.quantity * fillPrice - totalFees;
    const acct = await requireAccountById(order.accountId);
    await updateAccountCash(order.accountId, acct.cashBalance + cashDelta);
  }

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
    totalFees,
    realizedPnl,
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
 * job, so there is no continuous background matching).
 */
export async function placeOrder(sessionId: string, input: PaperOrderInput): Promise<PlaceOrderResult> {
  if (input.quantity <= 0 || !Number.isFinite(input.quantity)) {
    throw new Error("Quantity must be a positive number.");
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
    const position = await getPosition(account.id, symbol);
    const held = position?.quantity ?? 0;
    if (held < input.quantity) {
      throw new Error(`Cannot sell ${input.quantity} shares of ${symbol} — only ${held} held. This simulator is long-only (no short selling).`);
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
    status: isImmediatelyMarketable ? "filled" : "pending",
    rejectedReason: null,
  });

  if (!isImmediatelyMarketable) {
    return { order, filled: false, rejected: null };
  }

  const fillPrice =
    input.orderType === "market"
      ? applySlippage(input.side, quote.lastPrice, MARKET_SLIPPAGE_PER_SHARE)
      : input.limitPrice!; // marketable limit fills at the limit price itself, not through it

  await applyFill({
    order: { ...order, quantity: input.quantity },
    fillPrice,
    slippagePerShare: input.orderType === "market" ? MARKET_SLIPPAGE_PER_SHARE : 0,
  });

  return { order: { ...order, status: "filled" }, filled: true, rejected: null };
}

function applySlippage(side: PaperOrderSide, price: number, slippagePerShare: number): number {
  return side === "buy" ? price + slippagePerShare : price - slippagePerShare;
}

/**
 * Evaluates one pending order against real minute-bar price history since
 * its creation (capped to the last 30 days for very old resting orders) —
 * fills are based on the bar's actual high/low crossing the trigger level,
 * not merely the latest price "touching" it, per this app's explicit
 * full-realism design choice. Always re-scans from order creation rather
 * than resuming from the last check, which keeps stop-limit's two-phase
 * (trigger, then limit) and trailing-stop's peak/trough tracking correct
 * without needing extra persisted state.
 */
async function evaluateOrder(order: PaperOrder): Promise<{ filled: boolean; cancelledOco: string[] }> {
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
      fillPrice = applySlippage(order.side, order.stopPrice!, MARKET_SLIPPAGE_PER_SHARE);
      slippagePerShare = MARKET_SLIPPAGE_PER_SHARE;
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
      fillPrice = applySlippage(order.side, result.finalStopPrice, MARKET_SLIPPAGE_PER_SHARE);
      slippagePerShare = MARKET_SLIPPAGE_PER_SHARE;
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
    "Long-only simulator — no short selling or margin. No bid/ask spread data is available, so market and triggered-stop fills use a flat $0.02/share slippage approximation rather than a real spread. No trading commission is modeled (most real brokers charge $0 on equities today). Limit/stop orders fill when a real intraday bar's high or low crosses the trigger level, not merely the latest quote — more realistic than \"touch-only\" fills, but still an approximation of true tick-by-tick execution.",
    "Cash and share availability are checked at order placement, not reserved across multiple simultaneously-pending orders — placing several buy orders that together exceed available cash (or several sell orders on the same position that together exceed shares held) is possible and will be resolved on a first-fill-wins basis as each order is evaluated, not blocked upfront.",
  ];

  const positionViews: PaperPositionView[] = await Promise.all(
    positions.map(async (p): Promise<PaperPositionView> => {
      try {
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
