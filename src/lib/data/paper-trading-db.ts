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
import { assertSessionId, pgId, pgSession, pgSymbol, assertDate, assertOneOf, assertFiniteNumber, clampLimit } from "@/lib/data/postgrest-safe";

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
  const rows = await supabaseRequest<AccountRow[]>(`paper_accounts?session_id=eq.${pgSession(sessionId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function getAccountById(accountId: string): Promise<PaperAccount | null> {
  const rows = await supabaseRequest<AccountRow[]>(`paper_accounts?id=eq.${pgId(accountId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toAccount(rows[0]) : null;
}

// Concurrent first requests for one session share a single create (otherwise each sees "no account" and inserts its
// own: the audit measured 10 rows for 1 session). In-process only; a UNIQUE(session_id) constraint is the durable fix
// (see db/migrations/2026-10-16_paper_fill_atomic.sql).
const inflightAccounts = new Map<string, Promise<PaperAccount>>();

export function getOrCreateAccount(sessionId: string): Promise<PaperAccount> {
  assertSessionId(sessionId);
  const running = inflightAccounts.get(sessionId);
  if (running) return running;
  const p = createAccountIfMissing(sessionId).finally(() => inflightAccounts.delete(sessionId));
  inflightAccounts.set(sessionId, p);
  return p;
}

async function createAccountIfMissing(sessionId: string): Promise<PaperAccount> {
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
  await supabaseRequest(`paper_accounts?id=eq.${pgId(accountId)}`, {
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
  const rows = await supabaseRequest<OrderRow[]>(`paper_orders?id=eq.${pgId(orderId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toOrder(rows[0]) : null;
}

export async function getOpenOrders(accountId: string): Promise<PaperOrder[]> {
  const rows = await supabaseRequest<OrderRow[]>(
    `paper_orders?account_id=eq.${pgId(accountId)}&status=eq.pending&order=created_at.desc`,
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
  await supabaseRequest(`paper_orders?id=eq.${pgId(orderId)}`, {
    method: "PATCH",
    body: { last_evaluated_at: new Date().toISOString(), trailing_stop_price: trailingStopPrice },
  });
}

/**
 * Conditional (compare-and-set) order state transitions. Each PATCH carries a status filter and asks for the
 * updated rows back, so exactly one caller can win a transition: a second concurrent caller matches zero rows and
 * gets false. This is what stops one pending order from being filled by three overlapping "Check Orders" calls.
 */
async function transitionOrder(orderId: string, from: PaperOrderStatus, body: Record<string, unknown>): Promise<boolean> {
  const rows = await supabaseRequest<OrderRow[]>(`paper_orders?id=eq.${pgId(orderId)}&status=eq.${from}`, {
    method: "PATCH",
    prefer: "return=representation",
    body,
  });
  return Array.isArray(rows) && rows.length > 0;
}

/** pending -> filled. True only for the single caller that wins the claim. */
export async function claimPendingOrder(orderId: string): Promise<boolean> {
  return transitionOrder(orderId, "pending", { status: "filled", filled_at: new Date().toISOString() });
}

/** Back-compat name: marks a pending order filled; returns false when it was no longer pending. */
export async function fillOrder(orderId: string): Promise<boolean> {
  return claimPendingOrder(orderId);
}

/** filled -> pending: undo a claim whose fill could not be applied (transient error), so a later check can retry it. */
export async function releaseClaimedOrder(orderId: string): Promise<boolean> {
  return transitionOrder(orderId, "filled", { status: "pending", filled_at: null });
}

/**
 * filled -> rejected: a claimed order whose fill failed a funds/holdings check at fill time. When the atomic database
 * function rolled the fill back, the order was never claimed and is still "pending", so that caller passes from="pending".
 */
export async function rejectClaimedOrder(orderId: string, reason: string, from: PaperOrderStatus = "filled"): Promise<boolean> {
  return transitionOrder(orderId, from, { status: "rejected", rejected_reason: reason.slice(0, 500), filled_at: null });
}

/** pending -> cancelled by default (a filled order can no longer be cancelled). Pass "filled" only to void an order row whose fill never landed. */
export async function cancelOrder(orderId: string, from: PaperOrderStatus = "pending"): Promise<boolean> {
  return transitionOrder(orderId, from, { status: "cancelled", cancelled_at: new Date().toISOString() });
}

/** OCO: when one order in a group fills (or is manually cancelled), every other pending order sharing its group is auto-cancelled. */
export async function cancelOcoSiblings(ocoGroupId: string, excludeOrderId: string): Promise<string[]> {
  const rows = await supabaseRequest<OrderRow[]>(
    `paper_orders?oco_group_id=eq.${pgId(ocoGroupId)}&status=eq.pending&id=neq.${pgId(excludeOrderId)}`,
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
    `paper_fills?account_id=eq.${pgId(accountId)}&order=filled_at.desc&limit=${clampLimit(limit)}`,
    { method: "GET", prefer: "return=representation" }
  );
  return rows.map(toFill);
}

/** The fill row of one order (an order has at most one), or null. Used to finish bookkeeping when an RPC answer was lost after it committed. */
export async function getFillByOrderId(orderId: string): Promise<PaperFill | null> {
  const rows = await supabaseRequest<FillRow[]>(`paper_fills?order_id=eq.${pgId(orderId)}&limit=1`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows[0] ? toFill(rows[0]) : null;
}

/** True when a trade-log row already exists for this fill (used to avoid a duplicate row when finishing bookkeeping after a lost answer). */
export async function tradeLogExistsForFill(fillId: string): Promise<boolean> {
  const rows = await supabaseRequest<{ id: string }[]>(`paper_trade_log?fill_id=eq.${pgId(fillId)}&select=id&limit=1`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.length > 0;
}

// --- Atomic fill: the database function paper_apply_fill (db/migrations/2026-10-16_paper_fill_atomic.sql) ---

/**
 * One transaction in the database applies a whole fill (lock account, claim the pending order, check funds/holdings,
 * move cash, write the position and the fill row, mark the order filled, cancel OCO siblings). The function may not
 * exist yet (the migration is run by hand), so this module learns whether it is there and remembers the answer:
 * - missing (PostgREST 404 / PGRST202): skip the RPC for RPC_RECHECK_MS, then try again once, so applying the migration
 *   takes effect with no redeploy; one warning per process, not one per fill;
 * - PAPER_FILL_RPC=off forces the old multi-call path.
 */
const RPC_RECHECK_MS = 5 * 60 * 1000;
let rpcMissingUntil = 0;
let rpcMissingWarned = false;

export function paperFillRpcEnabled(now: number = Date.now()): boolean {
  const flag = (process.env.PAPER_FILL_RPC ?? "").trim().toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false" || flag === "no") return false;
  return now >= rpcMissingUntil;
}

/** Test hook: forget what was learned about the function. */
export function resetPaperFillRpcState(): void {
  rpcMissingUntil = 0;
  rpcMissingWarned = false;
}

function noteRpcMissing(detail: string): void {
  rpcMissingUntil = Date.now() + RPC_RECHECK_MS;
  if (!rpcMissingWarned) {
    rpcMissingWarned = true;
    console.warn(
      `[paper-trading] The database function paper_apply_fill() was not found (${detail.slice(0, 160)}). Fills use the older multi-step path, which is only safe within one server instance. ` +
        "Run db/migrations/2026-10-16_paper_fill_atomic.sql in the Supabase SQL editor to make fills atomic; no redeploy is needed, the app re-checks every few minutes."
    );
  }
}

function noteRpcWorking(): void {
  if (rpcMissingWarned) console.info("[paper-trading] paper_apply_fill() is now available; fills are atomic.");
  rpcMissingWarned = false;
  rpcMissingUntil = 0;
}

/** PostgREST answers 404 + PGRST202 for an unknown function; 42883 is Postgres' own "function does not exist". */
export function isRpcFunctionMissing(status: number, code: string, message: string): boolean {
  if (code === "PGRST202" || code === "42883") return true;
  if (status === 404) return true;
  return /paper_apply_fill/i.test(message) && /could not find|does not exist|schema cache/i.test(message);
}

export class PaperFillRpcMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperFillRpcMissingError";
  }
}

/** The function refused the fill for lack of cash or holdings and rolled everything back (message began "REJECT:"). */
export class PaperFillRpcRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaperFillRpcRejectedError";
  }
}

export interface AtomicFillParams {
  orderId: string;
  fillPrice: number;
  slippagePerShare: number;
  secFee: number;
  finraFee: number;
  occFee: number;
  totalFees: number;
  /** 100 for options, 1 otherwise: the function cross-checks it against the order's asset class. */
  multiplier: number;
  /** Crypto buy fee joins cost basis: the function cross-checks it too. */
  feeIntoBasis: boolean;
}

export type AtomicFillResult =
  | { applied: true; fill: PaperFill; cashBalance: number; realizedPnl: number | null; newQuantity: number; cancelledOco: string[] | null }
  | { applied: false; reason: string };

/**
 * Calls paper_apply_fill once. Resolves with the outcome; throws PaperFillRpcMissingError when the function is not
 * installed (nothing was applied), PaperFillRpcRejectedError on a funds/holdings failure (rolled back, order still
 * pending), and a plain Error for anything else (network failure, 5xx, bad input). A network failure is AMBIGUOUS:
 * the call may or may not have committed, so callers re-read the order before deciding (the function is idempotent
 * per order: a second call on a filled order returns applied=false).
 */
export async function applyFillRpc(p: AtomicFillParams): Promise<AtomicFillResult> {
  const { url, key } = requireConfig();
  const res = await fetch(`${url}/rest/v1/rpc/paper_apply_fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      p_order_id: p.orderId,
      p_fill_price: p.fillPrice,
      p_slippage_per_share: p.slippagePerShare,
      p_sec_fee: p.secFee,
      p_finra_fee: p.finraFee,
      p_occ_fee: p.occFee,
      p_total_fees: p.totalFees,
      p_multiplier: p.multiplier,
      p_fee_into_basis: p.feeIntoBasis,
    }),
  });
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};

  if (!res.ok) {
    const message = typeof obj.message === "string" ? obj.message : text.slice(0, 300);
    const code = typeof obj.code === "string" ? obj.code : "";
    if (isRpcFunctionMissing(res.status, code, message)) {
      noteRpcMissing(message || `HTTP ${res.status}`);
      throw new PaperFillRpcMissingError(message || `HTTP ${res.status}`);
    }
    const rejected = /^REJECT:\s*([\s\S]*)$/.exec(message);
    if (rejected) {
      noteRpcWorking();
      throw new PaperFillRpcRejectedError(rejected[1]);
    }
    throw new Error(`Supabase request failed (${res.status}) for rpc/paper_apply_fill: ${text.slice(0, 500)}`);
  }

  noteRpcWorking();
  if (typeof obj.applied !== "boolean") throw new Error("paper_apply_fill returned an unexpected response.");
  if (!obj.applied) return { applied: false, reason: typeof obj.reason === "string" ? obj.reason : "not applied" };
  if (!obj.fill || typeof obj.fill !== "object") throw new Error("paper_apply_fill applied the fill but returned no fill row.");
  return {
    applied: true,
    fill: toFill(obj.fill as FillRow),
    cashBalance: Number(obj.cash_balance),
    realizedPnl: obj.realized_pnl === null || obj.realized_pnl === undefined ? null : Number(obj.realized_pnl),
    newQuantity: Number(obj.new_quantity),
    cancelledOco: Array.isArray(obj.cancelled_oco) ? obj.cancelled_oco.map(String) : null,
  };
}

// --- Positions ---

export async function getPositions(accountId: string): Promise<PaperPosition[]> {
  const rows = await supabaseRequest<PositionRow[]>(`paper_positions?account_id=eq.${pgId(accountId)}`, {
    method: "GET",
    prefer: "return=representation",
  });
  return rows.map(toPosition);
}

export async function getPosition(accountId: string, symbol: string, assetClass: AssetClass): Promise<PaperPosition | null> {
  const rows = await supabaseRequest<PositionRow[]>(
    `paper_positions?account_id=eq.${pgId(accountId)}&symbol=eq.${pgSymbol(symbol)}&asset_class=eq.${pgId(assetClass, "assetClass")}`,
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
    `paper_positions?account_id=eq.${pgId(accountId)}&symbol=eq.${pgSymbol(symbol)}&asset_class=eq.${pgId(assetClass, "assetClass")}`,
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
    `paper_trade_log?account_id=eq.${pgId(fill.accountId)}` +
    `&symbol=eq.${pgSymbol(fill.symbol)}&asset_class=eq.${pgId(order.assetClass, "assetClass")}` +
    `&side=eq.${opposite}&strategy_type=not.is.null&order=logged_at.desc&limit=1`;
  if (fill.optionRight) q += `&option_right=eq.${assertOneOf(fill.optionRight, ["call", "put"], "optionRight")}`;
  if (fill.strikePrice !== null && fill.strikePrice !== undefined) q += `&strike_price=eq.${assertFiniteNumber(fill.strikePrice, "strikePrice")}`;
  if (fill.expirationDate) q += `&expiration_date=eq.${encodeURIComponent(assertDate(fill.expirationDate, "expirationDate"))}`;
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
    `paper_trade_log?account_id=eq.${pgId(accountId)}&order=logged_at.desc&limit=${clampLimit(limit)}`,
    { method: "GET", prefer: "return=representation" }
  );
}
