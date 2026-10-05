import type {
  AssetClass,
  PaperAccount,
  PaperFill,
  PaperOptionFields,
  PaperOrder,
  PaperOrderAttribution,
  PaperOrderSide,
  PaperOrderStatus,
  PaperOrderType,
  PaperPosition,
} from "@/lib/agents/trading-agent/types";

/**
 * Plain-fetch Supabase REST CRUD for paper_accounts/paper_orders/paper_fills/
 * paper_positions — same header/Prefer pattern as alerts-db.ts, kept in its
 * own file for the same reason: real (simulated) per-session financial state,
 * not anonymous analytics.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STARTING_CASH_BALANCE = 100_000;

export function isPaperTradingDbConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase is not configured — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset.");
  }
  return { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };
}

async function supabaseRequest<T>(
  path: string,
  init: { method: string; body?: unknown; prefer?: string }
): Promise<T> {
  const { url, key } = requireConfig();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: init.prefer ?? "return=minimal",
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase request failed (${res.status}) for ${path}: ${text}`);
  }
  if (init.prefer === "return=representation") {
    return (await res.json()) as T;
  }
  return undefined as T;
}

// --- row <-> TS type mappers (Supabase REST returns snake_case columns) ---

interface AccountRow {
  id: string;
  session_id: string;
  cash_balance: number;
  created_at: string;
}

function toAccount(row: AccountRow): PaperAccount {
  return { id: row.id, sessionId: row.session_id, cashBalance: row.cash_balance, createdAt: row.created_at };
}

interface OptionFieldsRow {
  option_right: "call" | "put" | null;
  strike_price: number | null;
  expiration_date: string | null;
  underlying_symbol: string | null;
}

function toOptionFields(row: OptionFieldsRow): PaperOptionFields {
  return {
    optionRight: row.option_right,
    strikePrice: row.strike_price,
    expirationDate: row.expiration_date,
    underlyingSymbol: row.underlying_symbol,
  };
}

function fromOptionFields(fields: Partial<PaperOptionFields> | undefined): OptionFieldsRow {
  return {
    option_right: fields?.optionRight ?? null,
    strike_price: fields?.strikePrice ?? null,
    expiration_date: fields?.expirationDate ?? null,
    underlying_symbol: fields?.underlyingSymbol ?? null,
  };
}

interface OrderRow extends OptionFieldsRow {
  id: string;
  account_id: string;
  symbol: string;
  asset_class: AssetClass;
  side: PaperOrderSide;
  order_type: PaperOrderType;
  quantity: number;
  limit_price: number | null;
  stop_price: number | null;
  trail_amount: number | null;
  trailing_stop_price: number | null;
  oco_group_id: string | null;
  strategy_group_id: string | null;
  status: PaperOrderStatus;
  rejected_reason: string | null;
  last_evaluated_at: string | null;
  created_at: string;
  filled_at: string | null;
  cancelled_at: string | null;
  attribution?: PaperOrderAttribution | null;
}

function toOrder(row: OrderRow): PaperOrder {
  return {
    id: row.id,
    accountId: row.account_id,
    symbol: row.symbol,
    assetClass: row.asset_class,
    side: row.side,
    orderType: row.order_type,
    quantity: row.quantity,
    limitPrice: row.limit_price,
    stopPrice: row.stop_price,
    trailAmount: row.trail_amount,
    trailingStopPrice: row.trailing_stop_price,
    ocoGroupId: row.oco_group_id,
    strategyGroupId: row.strategy_group_id,
    status: row.status,
    rejectedReason: row.rejected_reason,
    lastEvaluatedAt: row.last_evaluated_at,
    createdAt: row.created_at,
    filledAt: row.filled_at,
    cancelledAt: row.cancelled_at,
    attribution: row.attribution ?? null,
    ...toOptionFields(row),
  };
}

interface FillRow extends OptionFieldsRow {
  id: string;
  order_id: string;
  account_id: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  fill_price: number;
  slippage_per_share: number;
  sec_fee: number;
  finra_fee: number;
  occ_fee: number;
  total_fees: number;
  realized_pnl: number | null;
  filled_at: string;
}

function toFill(row: FillRow): PaperFill {
  return {
    id: row.id,
    orderId: row.order_id,
    accountId: row.account_id,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity,
    fillPrice: row.fill_price,
    slippagePerShare: row.slippage_per_share,
    secFee: row.sec_fee,
    finraFee: row.finra_fee,
    occFee: row.occ_fee,
    totalFees: row.total_fees,
    realizedPnl: row.realized_pnl,
    filledAt: row.filled_at,
    ...toOptionFields(row),
  };
}

interface PositionRow extends OptionFieldsRow {
  symbol: string;
  asset_class: AssetClass;
  quantity: number;
  avg_cost_basis: number;
}

function toPosition(row: PositionRow): PaperPosition {
  return {
    symbol: row.symbol,
    assetClass: row.asset_class,
    quantity: row.quantity,
    avgCostBasis: row.avg_cost_basis,
    ...toOptionFields(row),
  };
}

// --- Accounts ---

export async function getAccountBySessionId(sessionId: string): Promise<PaperAccount | null> {
  const rows = await supabaseRequest<AccountRow[]>(`paper_accounts?session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function getAccountById(accountId: string): Promise<PaperAccount | null> {
  const rows = await supabaseRequest<AccountRow[]>(`paper_accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function getOrCreateAccount(sessionId: string): Promise<PaperAccount> {
  const existing = await getAccountBySessionId(sessionId);
  if (existing) return existing;
  const rows = await supabaseRequest<AccountRow[]>("paper_accounts", {
    method: "POST",
    prefer: "return=representation",
    body: { session_id: sessionId, cash_balance: STARTING_CASH_BALANCE },
  });
  return toAccount(rows[0]);
}

export async function updateAccountCash(accountId: string, cashBalance: number): Promise<void> {
  await supabaseRequest(`paper_accounts?id=eq.${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body: { cash_balance: cashBalance },
  });
}

// --- Orders ---

export async function createOrder(order: {
  accountId: string;
  symbol: string;
  assetClass: AssetClass;
  side: PaperOrderSide;
  orderType: PaperOrderType;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  trailAmount: number | null;
  ocoGroupId: string | null;
  strategyGroupId?: string | null;
  attribution?: PaperOrderAttribution | null;
  status: PaperOrderStatus;
  rejectedReason: string | null;
} & Partial<PaperOptionFields>): Promise<PaperOrder> {
  let rows: OrderRow[];
  try {
    rows = await createOrderRequest(order);
  } catch (err) {
    const columnMissing = order.attribution && err instanceof Error && /attribution/i.test(err.message);
    if (columnMissing && !order.attribution!.strategyType) {
      // A plain manual order must never be blocked by a migration that has not
      // been applied yet: place it without the column (the log then records
      // origin "api"). Only a strategy-tagged order needs the column.
      rows = await createOrderRequest({ ...order, attribution: null });
    } else if (columnMissing) {
      throw new Error(
        "Strategy attribution is not set up in the database yet. Apply db/migrations/2026-10-05_paper_trade_log.sql in Supabase, then retry."
      );
    } else {
      throw err;
    }
  }
  return toOrder(rows[0]);
}

async function createOrderRequest(order: Parameters<typeof createOrder>[0]): Promise<OrderRow[]> {
  return supabaseRequest<OrderRow[]>("paper_orders", {
    method: "POST",
    prefer: "return=representation",
    body: {
      // Sent only when present so orders still work before the attribution
      // migration has been applied (the column simply does not exist yet).
      ...(order.attribution ? { attribution: order.attribution } : {}),
      account_id: order.accountId,
      symbol: order.symbol,
      asset_class: order.assetClass,
      side: order.side,
      order_type: order.orderType,
      quantity: order.quantity,
      limit_price: order.limitPrice,
      stop_price: order.stopPrice,
      trail_amount: order.trailAmount,
      oco_group_id: order.ocoGroupId,
      strategy_group_id: order.strategyGroupId ?? null,
      status: order.status,
      rejected_reason: order.rejectedReason,
      filled_at: order.status === "filled" ? new Date().toISOString() : null,
      ...fromOptionFields(order),
    },
  });
}

export async function getOrderById(orderId: string): Promise<PaperOrder | null> {
  const rows = await supabaseRequest<OrderRow[]>(`paper_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function getOpenOrders(accountId: string): Promise<PaperOrder[]> {
  const rows = await supabaseRequest<OrderRow[]>(
    `paper_orders?account_id=eq.${encodeURIComponent(accountId)}&status=eq.pending&order=created_at.desc`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toOrder);
}

/** Every pending order across every account — the daily-cron backstop's main read. */
export async function getAllPendingOrders(): Promise<PaperOrder[]> {
  const rows = await supabaseRequest<OrderRow[]>("paper_orders?status=eq.pending&order=created_at.asc", {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toOrder);
}

export async function markOrderEvaluated(orderId: string, trailingStopPrice: number | null): Promise<void> {
  await supabaseRequest(`paper_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: { last_evaluated_at: new Date().toISOString(), trailing_stop_price: trailingStopPrice },
  });
}

export async function fillOrder(orderId: string): Promise<void> {
  await supabaseRequest(`paper_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: { status: "filled", filled_at: new Date().toISOString() },
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await supabaseRequest(`paper_orders?id=eq.${encodeURIComponent(orderId)}`, {
    method: "PATCH",
    body: { status: "cancelled", cancelled_at: new Date().toISOString() },
  });
}

/** OCO: when one order in a group fills (or is manually cancelled), every other pending order sharing its group is auto-cancelled. */
export async function cancelOcoSiblings(ocoGroupId: string, excludeOrderId: string): Promise<string[]> {
  const rows = await supabaseRequest<OrderRow[]>(
    `paper_orders?oco_group_id=eq.${encodeURIComponent(ocoGroupId)}&status=eq.pending&id=neq.${encodeURIComponent(excludeOrderId)}`,
    { method: "PATCH", prefer: "return=representation", body: { status: "cancelled", cancelled_at: new Date().toISOString() } }
  );
  return rows.map((r) => r.id);
}

// --- Fills ---

export async function insertFill(fill: {
  orderId: string;
  accountId: string;
  symbol: string;
  side: PaperOrderSide;
  quantity: number;
  fillPrice: number;
  slippagePerShare: number;
  secFee: number;
  finraFee: number;
  occFee: number;
  totalFees: number;
  realizedPnl: number | null;
} & Partial<PaperOptionFields>): Promise<PaperFill> {
  const rows = await supabaseRequest<FillRow[]>("paper_fills", {
    method: "POST",
    prefer: "return=representation",
    body: {
      order_id: fill.orderId,
      account_id: fill.accountId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      fill_price: fill.fillPrice,
      slippage_per_share: fill.slippagePerShare,
      sec_fee: fill.secFee,
      finra_fee: fill.finraFee,
      occ_fee: fill.occFee,
      total_fees: fill.totalFees,
      realized_pnl: fill.realizedPnl,
      ...fromOptionFields(fill),
    },
  });
  return toFill(rows[0]);
}

export async function getFills(accountId: string, limit = 100): Promise<PaperFill[]> {
  const rows = await supabaseRequest<FillRow[]>(
    `paper_fills?account_id=eq.${encodeURIComponent(accountId)}&order=filled_at.desc&limit=${limit}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toFill);
}

// --- Positions ---

export async function getPositions(accountId: string): Promise<PaperPosition[]> {
  const rows = await supabaseRequest<PositionRow[]>(`paper_positions?account_id=eq.${encodeURIComponent(accountId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toPosition);
}

export async function getPosition(accountId: string, symbol: string, assetClass: AssetClass): Promise<PaperPosition | null> {
  const rows = await supabaseRequest<PositionRow[]>(
    `paper_positions?account_id=eq.${encodeURIComponent(accountId)}&symbol=eq.${encodeURIComponent(symbol)}&asset_class=eq.${encodeURIComponent(assetClass)}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function upsertPosition(
  accountId: string,
  symbol: string,
  assetClass: AssetClass,
  quantity: number,
  avgCostBasis: number,
  optionFields?: Partial<PaperOptionFields>
): Promise<void> {
  await supabaseRequest("paper_positions?on_conflict=account_id,symbol,asset_class", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: {
      account_id: accountId,
      symbol,
      asset_class: assetClass,
      quantity,
      avg_cost_basis: avgCostBasis,
      ...fromOptionFields(optionFields),
    },
  });
}

export async function deletePosition(accountId: string, symbol: string, assetClass: AssetClass): Promise<void> {
  await supabaseRequest(
    `paper_positions?account_id=eq.${encodeURIComponent(accountId)}&symbol=eq.${encodeURIComponent(symbol)}&asset_class=eq.${encodeURIComponent(assetClass)}`,
    { method: "DELETE" }
  );
}


// --- Trade log (append-only: one row per fill, with the strategy and its KPIs) ---

export interface TradeLogRow {
  id: string;
  logged_at: string;
  account_id: string;
  order_id: string;
  fill_id: string;
  symbol: string;
  asset_class: AssetClass;
  side: PaperOrderSide;
  quantity: number;
  fill_price: number;
  total_fees: number;
  realized_pnl: number | null;
  option_right: "call" | "put" | null;
  strike_price: number | null;
  expiration_date: string | null;
  underlying_symbol: string | null;
  strategy_group_id: string | null;
  origin: string;
  source: string;
  strategy_type: string | null;
  strategy_label: string | null;
  hypothesis_id: string | null;
  kpis: Record<string, unknown> | null;
}

/**
 * Record one fill in the trade log. This must never break a trade: the order
 * and fill are already committed by the time this runs, so any failure here
 * (including the table not existing yet) is swallowed and reported as false.
 */
/**
 * A closing fill carries the realized P&L, but the strategy that earned or lost
 * it is the one that OPENED the position. When the closing order names no
 * strategy of its own, inherit it from the most recent strategy-tagged opening
 * fill on the same instrument. Approximate when a position was built from
 * several strategies (the latest one wins), and said so in the docs.
 */
async function findOpeningStrategy(fill: PaperFill, order: PaperOrder): Promise<TradeLogRow | null> {
  const opposite = fill.side === "sell" ? "buy" : "sell";
  let q =
    `paper_trade_log?account_id=eq.${encodeURIComponent(fill.accountId)}` +
    `&symbol=eq.${encodeURIComponent(fill.symbol)}&asset_class=eq.${encodeURIComponent(order.assetClass)}` +
    `&side=eq.${opposite}&strategy_type=not.is.null&order=logged_at.desc&limit=1`;
  if (fill.optionRight) q += `&option_right=eq.${fill.optionRight}`;
  if (fill.strikePrice !== null && fill.strikePrice !== undefined) q += `&strike_price=eq.${fill.strikePrice}`;
  if (fill.expirationDate) q += `&expiration_date=eq.${encodeURIComponent(fill.expirationDate)}`;
  const rows = await supabaseRequest<TradeLogRow[]>(q, { method: "GET", prefer: "return=representation" });
  return rows[0] ?? null;
}

export async function insertTradeLog(order: PaperOrder, fill: PaperFill): Promise<boolean> {
  try {
    const a = order.attribution;
    let inheritedFrom: TradeLogRow | null = null;
    if (fill.realizedPnl !== null && !a?.strategyType) {
      inheritedFrom = await findOpeningStrategy(fill, order).catch(() => null);
    }
    const strategyType = a?.strategyType ?? inheritedFrom?.strategy_type ?? null;
    await supabaseRequest("paper_trade_log", {
      method: "POST",
      body: {
        account_id: fill.accountId,
        order_id: fill.orderId,
        fill_id: fill.id,
        symbol: fill.symbol,
        asset_class: order.assetClass,
        side: fill.side,
        quantity: fill.quantity,
        fill_price: fill.fillPrice,
        total_fees: fill.totalFees,
        realized_pnl: fill.realizedPnl,
        ...fromOptionFields(fill),
        strategy_group_id: order.strategyGroupId,
        origin: a?.origin ?? "api",
        source: inheritedFrom ? inheritedFrom.source : (a?.source ?? "manual"),
        strategy_type: strategyType,
        strategy_label: a?.strategyLabel ?? inheritedFrom?.strategy_label ?? null,
        hypothesis_id: a?.hypothesisId ?? inheritedFrom?.hypothesis_id ?? null,
        kpis: a?.kpis ?? inheritedFrom?.kpis ?? null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getTradeLog(accountId: string, limit = 500): Promise<TradeLogRow[]> {
  return supabaseRequest<TradeLogRow[]>(
    `paper_trade_log?account_id=eq.${encodeURIComponent(accountId)}&order=logged_at.desc&limit=${limit}`,
    { method: "GET", prefer: "return=representation" }
  );
}
