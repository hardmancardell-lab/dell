import type {
  AssetClass,
  PaperAccount,
  PaperFill,
  PaperOrder,
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

interface OrderRow {
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
  status: PaperOrderStatus;
  rejected_reason: string | null;
  last_evaluated_at: string | null;
  created_at: string;
  filled_at: string | null;
  cancelled_at: string | null;
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
    status: row.status,
    rejectedReason: row.rejected_reason,
    lastEvaluatedAt: row.last_evaluated_at,
    createdAt: row.created_at,
    filledAt: row.filled_at,
    cancelledAt: row.cancelled_at,
  };
}

interface FillRow {
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
    totalFees: row.total_fees,
    realizedPnl: row.realized_pnl,
    filledAt: row.filled_at,
  };
}

interface PositionRow {
  symbol: string;
  asset_class: AssetClass;
  quantity: number;
  avg_cost_basis: number;
}

function toPosition(row: PositionRow): PaperPosition {
  return { symbol: row.symbol, assetClass: row.asset_class, quantity: row.quantity, avgCostBasis: row.avg_cost_basis };
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
  status: PaperOrderStatus;
  rejectedReason: string | null;
}): Promise<PaperOrder> {
  const rows = await supabaseRequest<OrderRow[]>("paper_orders", {
    method: "POST",
    prefer: "return=representation",
    body: {
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
      status: order.status,
      rejected_reason: order.rejectedReason,
      filled_at: order.status === "filled" ? new Date().toISOString() : null,
    },
  });
  return toOrder(rows[0]);
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
  totalFees: number;
  realizedPnl: number | null;
}): Promise<PaperFill> {
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
      total_fees: fill.totalFees,
      realized_pnl: fill.realizedPnl,
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

export async function getPosition(accountId: string, symbol: string): Promise<PaperPosition | null> {
  const rows = await supabaseRequest<PositionRow[]>(
    `paper_positions?account_id=eq.${encodeURIComponent(accountId)}&symbol=eq.${encodeURIComponent(symbol)}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows[0] ? toPosition(rows[0]) : null;
}

export async function upsertPosition(
  accountId: string,
  symbol: string,
  assetClass: AssetClass,
  quantity: number,
  avgCostBasis: number
): Promise<void> {
  await supabaseRequest("paper_positions?on_conflict=account_id,symbol", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { account_id: accountId, symbol, asset_class: assetClass, quantity, avg_cost_basis: avgCostBasis },
  });
}

export async function deletePosition(accountId: string, symbol: string): Promise<void> {
  await supabaseRequest(
    `paper_positions?account_id=eq.${encodeURIComponent(accountId)}&symbol=eq.${encodeURIComponent(symbol)}`,
    { method: "DELETE" }
  );
}
