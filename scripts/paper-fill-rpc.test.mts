// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/paper-fill-rpc.test.mts
// Atomic paper fills through the database function paper_apply_fill (db/migrations/2026-10-16_paper_fill_atomic.sql).
// An in-memory fake of the Supabase REST API (random 1-6 ms latency per request, so concurrent requests interleave) now
// also answers POST /rest/v1/rpc/paper_apply_fill. The fake function is applied in ONE synchronous step, like a single
// Postgres transaction, and mirrors the SQL (its math is checked against real Postgres separately, see the report).
// What this file proves is the WIRING: one call per fill, REJECT rollback, lost race, missing-function fallback with a
// single warning, the kill switch, lost answers, and that the older path still gives the same ledger.
import test from "node:test";
import assert from "node:assert/strict";

process.env.MARKET_DATA_MOCK_MODE = "true";
process.env.SUPABASE_URL = "http://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
delete process.env.PAPER_FILL_RPC;

const ENGINE = await import("../src/lib/agents/trading-agent/skills/paper-trading-engine.ts");
const DB = await import("../src/lib/data/paper-trading-db.ts");
const MD = await import("../src/lib/data/market-data.ts");

// ---------------------------------------------------------------- console capture (one warning, never spam)
const warns: string[] = [];
const infos: string[] = [];
console.warn = (...a: any[]) => { warns.push(a.join(" ")); };
console.info = (...a: any[]) => { infos.push(a.join(" ")); };
console.error = (...a: any[]) => { warns.push("ERROR " + a.join(" ")); };

// ---------------------------------------------------------------- fake Supabase REST + fake paper_apply_fill
let db: Record<string, any[]> = {};
let seq = 0;
let calls: string[] = []; // "METHOD table" for every non-RPC request
let createdStatuses: string[] = []; // status each order row was created with
const rpc = {
  mode: "present" as "present" | "missing",
  calls: 0,
  bodies: [] as any[],
  fault: null as null | "network-before" | "network-after" | "http500",
  beforeApply: null as null | ((body: any) => void),
  omitOco: false,
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const matches = (row: any, filters: [string, string][]) =>
  filters.every(([k, v]) => {
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    if (op === "eq") return String(row[k]) === val;
    if (op === "neq") return String(row[k]) !== val;
    return true;
  });
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const NOT_FOUND = { code: "PGRST202", details: "Searched for the function public.paper_apply_fill in the schema cache", hint: null, message: "Could not find the function public.paper_apply_fill(p_order_id) in the schema cache" };

/** Mirrors paper_apply_fill: one synchronous step = one transaction. Returns { status, json }. */
function emulateApplyFill(b: any) {
  const err = (message: string) => ({ status: 400, json: { code: "P0001", details: null, hint: null, message } });
  const order = (db.paper_orders ?? []).find((r) => r.id === b.p_order_id);
  if (!order) return { status: 200, json: { applied: false, reason: "order not found" } };
  if (order.status !== "pending") return { status: 200, json: { applied: false, reason: "order is " + order.status } };
  const mult = order.asset_class === "option" ? 100 : 1;
  const intoBasis = order.asset_class === "crypto";
  if (b.p_multiplier != null && b.p_multiplier !== mult) return err(`multiplier ${b.p_multiplier} does not match asset class ${order.asset_class} (expected ${mult})`);
  if (b.p_fee_into_basis != null && b.p_fee_into_basis !== intoBasis) return err(`fee-into-basis ${b.p_fee_into_basis} does not match asset class ${order.asset_class}`);
  if (!(b.p_fill_price > 0) || b.p_fill_price > 10_000_000) return err(`invalid fill price ${b.p_fill_price}`);
  const acct = db.paper_accounts.find((a) => a.id === order.account_id);
  if (!acct) return err(`paper account ${order.account_id} not found`);
  db.paper_positions ??= [];
  const pos = db.paper_positions.find((p) => p.account_id === order.account_id && p.symbol === order.symbol && p.asset_class === order.asset_class);
  const existQty = pos?.quantity ?? 0;
  const existCost = pos?.avg_cost_basis ?? 0;
  const fees = b.p_total_fees ?? 0;
  const gross = order.quantity * mult * b.p_fill_price;
  let newQty: number, newCost: number, newCash: number, realized: number | null = null;
  if (order.side === "buy") {
    const needed = gross + fees;
    if (needed > acct.cash_balance + 1e-9) return err(`REJECT: Insufficient cash at fill time: needs $${needed.toFixed(2)}, account has $${acct.cash_balance.toFixed(2)}.`);
    newCash = acct.cash_balance - needed;
    if (existQty < 0) {
      if (order.quantity > Math.abs(existQty)) return err("REJECT: Cannot buy to close more than the short");
      newQty = existQty + order.quantity;
      realized = (existCost - b.p_fill_price) * order.quantity * mult - fees;
      newCost = existCost;
    } else {
      newQty = existQty + order.quantity;
      newCost = (existQty * existCost + order.quantity * b.p_fill_price + (intoBasis ? fees : 0)) / newQty;
    }
  } else {
    if (order.asset_class !== "option" && existQty < order.quantity - 1e-12) return err(`REJECT: Cannot sell ${order.quantity} ${order.symbol} at fill time: only ${existQty} held.`);
    if (order.asset_class === "option" && existQty > 0 && order.quantity > existQty) return err(`REJECT: Cannot sell ${order.quantity} contract(s) at fill time: only ${existQty} held.`);
    newCash = acct.cash_balance + gross - fees;
    if (existQty > 0) {
      newQty = existQty - order.quantity;
      realized = (b.p_fill_price - existCost) * order.quantity * mult - fees;
      newCost = existCost;
    } else {
      newQty = existQty - order.quantity;
      newCost = (Math.abs(existQty) * existCost + order.quantity * b.p_fill_price) / Math.abs(newQty);
    }
  }
  if (newCash < 0) newCash = 0;
  if (order.asset_class === "crypto") newQty = Math.round(newQty * 1e8) / 1e8;
  if (newQty === 0) db.paper_positions = db.paper_positions.filter((p) => p !== pos);
  else if (pos) Object.assign(pos, { quantity: newQty, avg_cost_basis: newCost });
  else db.paper_positions.push({ account_id: order.account_id, symbol: order.symbol, asset_class: order.asset_class, quantity: newQty, avg_cost_basis: newCost, option_right: order.option_right ?? null, strike_price: order.strike_price ?? null, expiration_date: order.expiration_date ?? null, underlying_symbol: order.underlying_symbol ?? null });
  acct.cash_balance = newCash;
  db.paper_fills ??= [];
  if (db.paper_fills.some((f) => f.order_id === order.id)) return err("duplicate key value violates unique constraint paper_fills_order_id_key");
  const fill = { id: `paper_fills-${++seq}`, order_id: order.id, account_id: order.account_id, symbol: order.symbol, side: order.side, quantity: order.quantity, fill_price: b.p_fill_price, slippage_per_share: b.p_slippage_per_share ?? 0, sec_fee: b.p_sec_fee ?? 0, finra_fee: b.p_finra_fee ?? 0, occ_fee: b.p_occ_fee ?? 0, total_fees: fees, realized_pnl: realized, option_right: order.option_right ?? null, strike_price: order.strike_price ?? null, expiration_date: order.expiration_date ?? null, underlying_symbol: order.underlying_symbol ?? null, filled_at: new Date().toISOString() };
  db.paper_fills.push(fill);
  order.status = "filled"; order.filled_at = fill.filled_at;
  const cancelled: string[] = [];
  if (order.oco_group_id && !rpc.omitOco) {
    for (const o of db.paper_orders) if (o.oco_group_id === order.oco_group_id && o.status === "pending" && o.id !== order.id) { o.status = "cancelled"; o.cancelled_at = new Date().toISOString(); cancelled.push(o.id); }
  }
  const out: any = { applied: true, fill_id: fill.id, fill, cash_balance: newCash, realized_pnl: realized, new_quantity: newQty };
  if (!rpc.omitOco) out.cancelled_oco = cancelled;
  return { status: 200, json: out };
}

globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  if (!url.hostname.startsWith("fake.supabase")) throw new Error("blocked non-fake fetch " + url.hostname);
  const method = init.method ?? "GET";
  if (url.pathname.endsWith("/rpc/paper_apply_fill")) {
    rpc.calls++;
    const body = JSON.parse(init.body);
    rpc.bodies.push(body);
    await sleep(1 + Math.random() * 5);
    if (rpc.mode === "missing") return json(NOT_FOUND, 404);
    if (rpc.fault === "network-before") { rpc.fault = null; throw new TypeError("fetch failed"); }
    if (rpc.fault === "http500") { rpc.fault = null; return json({ message: "boom" }, 500); }
    rpc.beforeApply?.(body);
    const out = emulateApplyFill(body);
    if (rpc.fault === "network-after") { rpc.fault = null; throw new TypeError("fetch failed (response lost after commit)"); }
    return json(out.json, out.status);
  }
  await sleep(1 + Math.random() * 5);
  const table = url.pathname.split("/").pop()!;
  calls.push(`${method} ${table}`);
  const rows = (db[table] ??= []);
  const filters = [...url.searchParams.entries()].filter(([k]) => !["order", "limit", "select", "on_conflict"].includes(k));
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (method === "GET") return json(rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })));
  if (method === "POST") {
    const now = new Date().toISOString();
    if (table === "paper_positions") {
      const i = rows.findIndex((r) => r.account_id === body.account_id && r.symbol === body.symbol && r.asset_class === body.asset_class);
      if (i >= 0) rows[i] = { ...rows[i], ...body }; else rows.push({ ...body });
      return json([body]);
    }
    if (table === "paper_orders") createdStatuses.push(body.status);
    const row = { id: `${table}-${++seq}`, created_at: now, filled_at: body.status === "filled" || table === "paper_fills" ? now : null, ...body };
    rows.push(row);
    return json([{ ...row }], 201);
  }
  if (method === "PATCH") {
    const hit = rows.filter((r) => matches(r, filters));
    hit.forEach((r) => Object.assign(r, body));
    return json(hit.map((r) => ({ ...r })));
  }
  if (method === "DELETE") {
    db[table] = rows.filter((r) => !matches(r, filters));
    return json([]);
  }
  return json([]);
};

// ---------------------------------------------------------------- helpers
const S = (n: number) => `rpc-session-${String(n).padStart(4, "0")}`;
const price = (await MD.fetchQuote("AAPL")).lastPrice;
const bidAsk = await MD.fetchLatestCryptoBidAsk("BTC-USD");
const buy = (q: number, extra = {}) => ({ symbol: "AAPL", assetClass: "equity", side: "buy", orderType: "market", quantity: q, ...extra });
const sell = (q: number, extra = {}) => buy(q, { side: "sell", ...extra });
const crypto = (q: number, side = "buy", extra = {}) => ({ symbol: "BTC-USD", assetClass: "crypto", side, orderType: "market", quantity: q, ...extra });
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
function fresh() {
  db = {}; seq = 0; calls = []; createdStatuses = [];
  Object.assign(rpc, { mode: "present", calls: 0, bodies: [], fault: null, beforeApply: null, omitOco: false });
  warns.length = 0; infos.length = 0;
  delete process.env.PAPER_FILL_RPC;
  DB.resetPaperFillRpcState();
}
const cash = () => db.paper_accounts[0].cash_balance;
const orderOf = (i = 0) => db.paper_orders[i];
const legacyWrites = () => calls.filter((c) => c === "PATCH paper_accounts" || c === "POST paper_fills" || c === "POST paper_positions" || c === "DELETE paper_positions");
/** Place a resting limit buy, then make the market trade through it. */
async function restingBuy(session: number, q = 5, extra = {}) {
  await ENGINE.placeOrder(S(session), buy(q, { orderType: "limit", limitPrice: price * 0.5, ...extra }));
  const o = db.paper_orders.at(-1);
  o.limit_price = price * 10;
  return o;
}
const tradeLogFor = (fillId: string) => (db.paper_trade_log ?? []).filter((r) => r.fill_id === fillId);

// ---------------------------------------------------------------- RPC present
test("RPC present: a market buy is ONE database call that creates the order pending and fills it", async () => {
  fresh();
  const r = await ENGINE.placeOrder(S(1), buy(10));
  assert.equal(r.filled, true);
  assert.equal(rpc.calls, 1, "exactly one paper_apply_fill call");
  assert.deepEqual(createdStatuses, ["pending"], "the order starts pending; the function flips it");
  assert.deepEqual(legacyWrites(), [], "none of the older per-table writes happen");
  assert.equal(orderOf().status, "filled");
  assert.ok(orderOf().filled_at);
  const fill = db.paper_fills[0];
  assert.equal(db.paper_fills.length, 1);
  assert.equal(db.paper_positions[0].quantity, 10);
  assert.ok(near(cash(), 100000 - 10 * fill.fill_price));
  const body = rpc.bodies[0];
  assert.equal(body.p_order_id, orderOf().id);
  assert.equal(body.p_multiplier, 1);
  assert.equal(body.p_fee_into_basis, false);
  assert.ok(near(body.p_fill_price, fill.fill_price) && near(body.p_slippage_per_share, 0.02));
  assert.equal(tradeLogFor(fill.id).length, 1, "the best-effort trade log row is still written, once");
  assert.equal(warns.length, 0);
});

test("RPC present: a sell realizes P&L net of the SEC/FINRA fees the engine computed", async () => {
  fresh();
  await ENGINE.placeOrder(S(2), buy(10));
  const cost = db.paper_positions[0].avg_cost_basis;
  const cashBefore = cash();
  const r = await ENGINE.placeOrder(S(2), sell(4));
  assert.equal(r.filled, true);
  const fill = db.paper_fills.at(-1);
  const body = rpc.bodies.at(-1);
  assert.ok(body.p_sec_fee > 0 && body.p_finra_fee > 0 && near(body.p_total_fees, body.p_sec_fee + body.p_finra_fee), JSON.stringify(body));
  assert.ok(near(fill.realized_pnl, (fill.fill_price - cost) * 4 - fill.total_fees));
  assert.ok(near(cash(), cashBefore + 4 * fill.fill_price - fill.total_fees));
  assert.equal(db.paper_positions[0].quantity, 6);
  assert.equal(tradeLogFor(fill.id)[0].realized_pnl, fill.realized_pnl);
});

test("RPC present: crypto fractional quantities fill at the bid/ask, the buy fee joins cost basis, a full exit leaves no dust", async () => {
  fresh();
  await ENGINE.placeOrder(S(3), crypto(0.015));
  let body = rpc.bodies[0];
  assert.equal(body.p_fee_into_basis, true);
  assert.equal(body.p_multiplier, 1);
  assert.ok(near(body.p_fill_price, bidAsk.ask), "buys lift the ask");
  assert.ok(near(body.p_slippage_per_share, bidAsk.ask - (bidAsk.bid + bidAsk.ask) / 2));
  const fee = 0.015 * bidAsk.ask * 0.006;
  assert.ok(near(body.p_total_fees, fee) && body.p_sec_fee === 0);
  assert.equal(db.paper_positions[0].quantity, 0.015);
  assert.ok(near(db.paper_positions[0].avg_cost_basis, bidAsk.ask + fee / 0.015), "fee in basis");
  await ENGINE.placeOrder(S(3), crypto(0.1));
  assert.equal(db.paper_positions[0].quantity, 0.115, "no float noise");
  const r = await ENGINE.placeOrder(S(3), crypto(0.115, "sell"));
  assert.equal(r.filled, true);
  assert.ok(near(rpc.bodies.at(-1).p_fill_price, bidAsk.bid), "sells hit the bid");
  assert.equal(db.paper_positions.length, 0, "the position row is gone, no dust");
  assert.equal(db.paper_fills.length, 3);
});

test("RPC present: an option contract carries the x100 multiplier into cash and realized P&L", async () => {
  fresh();
  const chain = await MD.fetchOptionsChain("AAPL");
  const c = chain.calls[5];
  const opt = (side: string, q: number) => ({ symbol: "AAPL", assetClass: "option", side, orderType: "market", quantity: q, underlyingSymbol: "AAPL", expirationDate: c.expirationDate, optionRight: "call", strikePrice: c.strikePrice });
  await ENGINE.placeOrder(S(4), opt("buy", 2));
  let body = rpc.bodies[0];
  assert.equal(body.p_multiplier, 100);
  assert.ok(near(body.p_fill_price, c.ask) && near(body.p_occ_fee, 0.05));
  assert.ok(near(cash(), 100000 - 2 * 100 * c.ask - 0.05), `cash ${cash()}`);
  assert.equal(db.paper_positions[0].quantity, 2);
  assert.equal(db.paper_positions[0].option_right, "call");
  assert.equal(db.paper_positions[0].underlying_symbol, "AAPL");
  const r = await ENGINE.placeOrder(S(4), opt("sell", 2));
  assert.equal(r.filled, true);
  const fill = db.paper_fills.at(-1);
  assert.ok(near(fill.realized_pnl, (c.bid - c.ask) * 2 * 100 - fill.total_fees), `${fill.realized_pnl}`);
  assert.equal(db.paper_positions.length, 0);
  assert.equal(rpc.calls, 2);
});

test("RPC present: a resting limit order fills through the same single call; the older claim/cash/position writes do not happen", async () => {
  fresh();
  const o = await restingBuy(5);
  calls = [];
  const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(res.ordersFilled, 1);
  assert.equal(rpc.calls, 1);
  assert.deepEqual(legacyWrites(), []);
  assert.ok(!calls.includes("PATCH paper_orders"), "no separate claim PATCH");
  assert.equal(o.status, "filled");
  assert.equal(db.paper_positions[0].quantity, 5);
  assert.equal(db.paper_fills.length, 1);
  assert.equal(tradeLogFor(db.paper_fills[0].id).length, 1);
});

test("RPC present: an OCO sibling is cancelled by the function itself; an older function without that is covered by the engine", async () => {
  for (const omitOco of [false, true]) {
    fresh();
    rpc.omitOco = omitOco;
    const a = await restingBuy(6, 2, { ocoGroupId: "oco-test-1" });
    await ENGINE.placeOrder(S(6), buy(2, { orderType: "limit", limitPrice: price * 0.4, ocoGroupId: "oco-test-1" }));
    const b = db.paper_orders[1];
    assert.equal(b.status, "pending");
    calls = [];
    const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
    assert.equal(a.status, "filled");
    assert.equal(b.status, "cancelled", `sibling cancelled (omitOco=${omitOco})`);
    assert.equal(res.ordersCancelledByOco, 1);
    assert.equal(res.ordersFilled, 1);
    if (!omitOco) assert.ok(!calls.includes("PATCH paper_orders"), "no client-side cancel call when the function already did it");
    assert.equal(db.paper_fills.length, 1);
  }
});

// ---------------------------------------------------------------- REJECT, lost race
test("REJECT on an immediate order rolls back and voids the order; nothing is applied", async () => {
  fresh();
  await ENGINE.placeOrder(S(7), buy(1)); // account exists
  db.paper_orders = []; db.paper_fills = []; db.paper_positions = []; db.paper_trade_log = [];
  db.paper_accounts[0].cash_balance = 100000;
  rpc.beforeApply = () => { db.paper_accounts[0].cash_balance = 1; }; // another instance spent the cash after the pre-check
  await assert.rejects(() => ENGINE.placeOrder(S(7), buy(10)), /Insufficient cash at fill time: needs \$[\d.]+, account has \$1\.00\./);
  assert.equal(orderOf().status, "cancelled", "voided, not left pending or filled");
  assert.equal(db.paper_fills.length, 0);
  assert.equal(db.paper_positions.length, 0);
  assert.equal(cash(), 1);
  assert.equal(db.paper_trade_log.length, 0);
});

test("REJECT on a resting order marks it rejected with the reason, exactly like the older path", async () => {
  fresh();
  const o = await restingBuy(8);
  db.paper_accounts[0].cash_balance = 10; // cash gone since placement
  const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(res.ordersFilled, 0);
  assert.equal(o.status, "rejected");
  assert.match(o.rejected_reason, /Insufficient cash at fill time/);
  assert.match(res.errors[0].error, /Order rejected at fill time: Insufficient cash at fill time/);
  assert.equal(db.paper_fills?.length ?? 0, 0);
  assert.equal(cash(), 10);
  assert.equal(rpc.calls, 1);
  const again = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id); // nothing pending any more
  assert.equal(again.ordersEvaluated, 0);
});

test("REJECT for holdings: a resting sell of shares that are gone is rejected, position untouched", async () => {
  fresh();
  await ENGINE.placeOrder(S(9), buy(5));
  await ENGINE.placeOrder(S(9), sell(5, { orderType: "limit", limitPrice: price * 100 }));
  const o = db.paper_orders.at(-1);
  o.limit_price = price * 0.01; // sell limit now below the market: it triggers
  db.paper_positions.length = 0; // shares sold elsewhere meanwhile
  const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(o.status, "rejected");
  assert.match(o.rejected_reason, /Cannot sell 5 AAPL at fill time: only 0 held/);
  assert.equal(res.ordersFilled, 0);
});

test("lost race: another instance filled the order first, so the engine does nothing (no fill, no duplicate trade log)", async () => {
  fresh();
  const o = await restingBuy(10);
  rpc.beforeApply = () => { o.status = "filled"; }; // the winner's transaction committed just before ours
  const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(res.ordersFilled, 0);
  assert.deepEqual(res.errors, []);
  assert.equal(db.paper_fills?.length ?? 0, 0);
  assert.equal((db.paper_trade_log ?? []).length, 0);
  assert.equal(o.status, "filled", "left as the winner set it");
  assert.equal(cash(), 100000);
});

test("concurrent duplicate fills of ONE order straight at the database function: exactly one applies", async () => {
  fresh();
  const o = await restingBuy(11, 5);
  const params = { orderId: o.id, fillPrice: price, slippagePerShare: 0, secFee: 0, finraFee: 0, occFee: 0, totalFees: 0, multiplier: 1, feeIntoBasis: false };
  const results = await Promise.all(Array.from({ length: 8 }, () => DB.applyFillRpc(params)));
  assert.equal(results.filter((r) => r.applied).length, 1);
  assert.ok(results.filter((r) => !r.applied).every((r) => r.reason === "order is filled"));
  assert.equal(db.paper_fills.length, 1);
  assert.equal(db.paper_positions[0].quantity, 5);
  assert.ok(near(cash(), 100000 - 5 * price));
});

test("three overlapping Check Orders calls fill a pending order once and debit once (RPC path)", async () => {
  fresh();
  await restingBuy(12, 5);
  const id = db.paper_accounts[0].id;
  const results = await Promise.all([1, 2, 3].map(() => ENGINE.evaluateAccountOrders(id)));
  assert.equal(results.reduce((s, r) => s + r.ordersFilled, 0), 1);
  assert.equal(db.paper_fills.length, 1);
  assert.ok(near(cash(), 100000 - 5 * db.paper_fills[0].fill_price), "debited once, at the limit price it filled at");
  assert.equal(db.paper_trade_log.length, 1);
});

test("database-level overdraft protection without the in-process lock: 5 orders of 60% of cash, one applies, cash never negative", async () => {
  fresh();
  await ENGINE.placeOrder(S(13), buy(1));
  const acct = db.paper_accounts[0];
  acct.cash_balance = 100000; db.paper_orders = []; db.paper_fills = []; db.paper_positions = [];
  const qty = Math.floor((100000 * 0.6) / price);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await DB.createOrder({ accountId: acct.id, symbol: "AAPL", assetClass: "equity", side: "buy", orderType: "market", quantity: qty, limitPrice: null, stopPrice: null, trailAmount: null, ocoGroupId: null, status: "pending", rejectedReason: null })).id);
  const settled = await Promise.allSettled(ids.map((orderId) => DB.applyFillRpc({ orderId, fillPrice: price, slippagePerShare: 0, secFee: 0, finraFee: 0, occFee: 0, totalFees: 0, multiplier: 1, feeIntoBasis: false })));
  assert.equal(settled.filter((s) => s.status === "fulfilled" && s.value.applied).length, 1);
  assert.equal(settled.filter((s) => s.status === "rejected" && s.reason instanceof DB.PaperFillRpcRejectedError).length, 4);
  assert.ok(acct.cash_balance >= 0);
  assert.equal(db.paper_fills.length, 1);
});

test("20 concurrent market buys through the RPC keep every debit and every share", async () => {
  fresh();
  await ENGINE.placeOrder(S(14), buy(1));
  db.paper_orders = []; db.paper_fills = []; db.paper_positions = []; db.paper_trade_log = []; db.paper_accounts[0].cash_balance = 100000;
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => ENGINE.placeOrder(S(14), buy(10))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(db.paper_fills.length, 20);
  assert.equal(db.paper_positions[0].quantity, 200);
  const spent = db.paper_fills.reduce((s, f) => s + f.quantity * f.fill_price, 0);
  assert.ok(near(cash(), 100000 - spent, 1e-4));
});

// ---------------------------------------------------------------- failures in transit
test("network error BEFORE the function commits: an immediate order is voided, no partial state", async () => {
  fresh();
  await ENGINE.placeOrder(S(15), buy(1));
  const snapshot = JSON.stringify({ cash: cash(), pos: db.paper_positions, fills: db.paper_fills.length, log: db.paper_trade_log.length });
  rpc.fault = "network-before";
  await assert.rejects(() => ENGINE.placeOrder(S(15), buy(10)), /fetch failed/);
  assert.equal(orderOf(1).status, "cancelled");
  assert.equal(JSON.stringify({ cash: cash(), pos: db.paper_positions, fills: db.paper_fills.length, log: db.paper_trade_log.length }), snapshot);
  const ok = await ENGINE.placeOrder(S(15), buy(10)); // the next attempt works
  assert.equal(ok.filled, true);
});

test("network error BEFORE the function commits: a resting order stays pending, and the next check fills it once", async () => {
  fresh();
  const o = await restingBuy(16);
  rpc.fault = "network-before";
  const first = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(first.ordersFilled, 0);
  assert.match(first.errors[0].error, /fetch failed/);
  assert.equal(o.status, "pending");
  assert.equal(db.paper_fills?.length ?? 0, 0);
  assert.equal(cash(), 100000);
  const second = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(second.ordersFilled, 1);
  assert.equal(db.paper_fills.length, 1);
});

test("answer lost AFTER the function committed: an immediate order is still reported filled, once, with its trade log row", async () => {
  fresh();
  rpc.fault = "network-after";
  const r = await ENGINE.placeOrder(S(17), buy(10));
  assert.equal(r.filled, true);
  assert.equal(db.paper_fills.length, 1, "no second fill");
  assert.equal(orderOf().status, "filled");
  assert.equal(db.paper_positions[0].quantity, 10);
  assert.ok(near(cash(), 100000 - 10 * db.paper_fills[0].fill_price));
  assert.equal(tradeLogFor(db.paper_fills[0].id).length, 1, "bookkeeping finished exactly once");
});

test("answer lost AFTER commit on a resting order: counted as filled, no double fill on the next check", async () => {
  fresh();
  await restingBuy(18);
  rpc.fault = "network-after";
  const first = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(first.ordersFilled, 1);
  assert.equal(db.paper_fills.length, 1);
  const again = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(again.ordersEvaluated, 0);
  assert.equal(db.paper_fills.length, 1);
});

test("an unexpected HTTP 500 from the function is an error, not a 'missing function': no fallback, no warning, RPC is tried again next time", async () => {
  fresh();
  rpc.fault = "http500";
  await assert.rejects(() => ENGINE.placeOrder(S(19), buy(10)), /Supabase request failed \(500\) for rpc\/paper_apply_fill/);
  assert.equal(orderOf().status, "cancelled");
  assert.equal(warns.length, 0);
  const ok = await ENGINE.placeOrder(S(19), buy(10));
  assert.equal(ok.filled, true);
  assert.equal(rpc.calls, 2);
});

// ---------------------------------------------------------------- RPC missing: fallback, one warning, memory, recheck
test("RPC missing: every fill falls back to the older path, ONE clear warning, and the answer is remembered", async () => {
  fresh();
  rpc.mode = "missing";
  const a = await ENGINE.placeOrder(S(20), buy(10));
  assert.equal(a.filled, true);
  assert.equal(rpc.calls, 1, "the first fill discovers the function is missing");
  assert.equal(warns.length, 1);
  assert.match(warns[0], /paper_apply_fill\(\) was not found/);
  assert.match(warns[0], /2026-10-16_paper_fill_atomic\.sql/);
  assert.equal(db.paper_fills.length, 1);
  assert.equal(orderOf().status, "filled");
  assert.ok(near(cash(), 100000 - 10 * db.paper_fills[0].fill_price));
  assert.equal(db.paper_positions[0].quantity, 10);
  for (let i = 0; i < 5; i++) await ENGINE.placeOrder(S(20), buy(1));
  await restingBuy(20, 2);
  await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(rpc.calls, 1, "no further failed calls while the answer is remembered");
  assert.equal(warns.length, 1, "no warning spam");
  assert.equal(db.paper_fills.length, 7);
  assert.deepEqual(createdStatuses.slice(1, 6), ["filled", "filled", "filled", "filled", "filled"], "orders are created the old way (already filled)");
});

test("RPC missing: after the recheck window the app tries again, and once the migration is applied the RPC takes over with no redeploy", async () => {
  fresh();
  rpc.mode = "missing";
  await ENGINE.placeOrder(S(21), buy(1));
  assert.equal(rpc.calls, 1);
  rpc.mode = "present"; // the owner ran the migration
  await ENGINE.placeOrder(S(21), buy(1));
  assert.equal(rpc.calls, 1, "still inside the window: not retried yet");
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    calls = [];
    const r = await ENGINE.placeOrder(S(21), buy(1));
    assert.equal(r.filled, true);
    assert.equal(rpc.calls, 2, "re-checked after 5 minutes");
    assert.deepEqual(legacyWrites(), [], "and this fill went through the function");
    await ENGINE.placeOrder(S(21), buy(1));
    assert.equal(rpc.calls, 3);
  } finally {
    Date.now = realNow;
  }
  assert.equal(infos.length, 1);
  assert.match(infos[0], /now available/);
  assert.equal(warns.length, 1, "still only the original warning");
  assert.equal(db.paper_fills.length, 4);
});

test("RPC missing, still missing at the recheck: stays on the older path and does not warn again", async () => {
  fresh();
  rpc.mode = "missing";
  await ENGINE.placeOrder(S(22), buy(1));
  const realNow = Date.now;
  Date.now = () => realNow() + 6 * 60 * 1000;
  try {
    await ENGINE.placeOrder(S(22), buy(1));
  } finally {
    Date.now = realNow;
  }
  assert.equal(rpc.calls, 2);
  assert.equal(warns.length, 1);
  assert.equal(db.paper_fills.length, 2);
});

test("kill switch PAPER_FILL_RPC=off forces the older path: no RPC call at all, no warning", async () => {
  for (const flag of ["off", "OFF", "false", "0"]) {
    fresh();
    process.env.PAPER_FILL_RPC = flag;
    await ENGINE.placeOrder(S(23), buy(10));
    const o = await restingBuy(23, 3);
    await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
    assert.equal(rpc.calls, 0, `flag ${flag}`);
    assert.equal(warns.length, 0);
    assert.equal(db.paper_fills.length, 2);
    assert.equal(o.status, "filled");
    assert.equal(createdStatuses[0], "filled");
  }
  process.env.PAPER_FILL_RPC = "on"; // anything else leaves the RPC on
  fresh();
  process.env.PAPER_FILL_RPC = "on";
  await ENGINE.placeOrder(S(24), buy(1));
  assert.equal(rpc.calls, 1);
  delete process.env.PAPER_FILL_RPC;
});

test("isRpcFunctionMissing recognises PostgREST and Postgres 'no such function' answers and nothing else", () => {
  assert.equal(DB.isRpcFunctionMissing(404, "PGRST202", "Could not find the function public.paper_apply_fill(...) in the schema cache"), true);
  assert.equal(DB.isRpcFunctionMissing(404, "", ""), true);
  assert.equal(DB.isRpcFunctionMissing(400, "42883", "function public.paper_apply_fill(text) does not exist"), true);
  assert.equal(DB.isRpcFunctionMissing(400, "", "Could not find the function paper_apply_fill in the schema cache"), true);
  assert.equal(DB.isRpcFunctionMissing(400, "P0001", "REJECT: Insufficient cash at fill time"), false);
  assert.equal(DB.isRpcFunctionMissing(500, "", "boom"), false);
  assert.equal(DB.isRpcFunctionMissing(400, "23514", "new row violates check constraint"), false);
});

// ---------------------------------------------------------------- same ledger either way
test("the RPC path and the older path produce the same ledger for the same scripted orders", async () => {
  const chain = await MD.fetchOptionsChain("AAPL");
  const c = chain.calls[5];
  const opt = (side: string, q: number) => ({ symbol: "AAPL", assetClass: "option", side, orderType: "market", quantity: q, underlyingSymbol: "AAPL", expirationDate: c.expirationDate, optionRight: "call", strikePrice: c.strikePrice });
  const script: [string, any][] = [
    ["a", buy(10)], ["a", buy(5)], ["a", sell(7)], ["a", crypto(0.4)], ["a", crypto(0.15)], ["a", crypto(0.3, "sell")], ["a", opt("buy", 3)],
    ["a", opt("sell", 1)], ["a", buy(4, { symbol: "MSFT" })], ["a", sell(4, { symbol: "MSFT" })], ["a", crypto(0.25, "sell")],
  ];
  /** Independent reference ledger from the fill rows alone (the older path's formulas). */
  function reference() {
    let cashRef = 100000;
    const positions = new Map<string, { q: number; c: number }>();
    for (const f of db.paper_fills) {
      const o = db.paper_orders.find((x) => x.id === f.order_id);
      const mult = o.asset_class === "option" ? 100 : 1;
      const key = `${o.asset_class}:${o.symbol}`;
      const p = positions.get(key) ?? { q: 0, c: 0 };
      if (f.side === "buy") {
        cashRef -= f.quantity * mult * f.fill_price + f.total_fees;
        const nq = p.q + f.quantity;
        positions.set(key, { q: nq, c: (p.q * p.c + f.quantity * f.fill_price + (o.asset_class === "crypto" ? f.total_fees : 0)) / nq });
      } else {
        cashRef += f.quantity * mult * f.fill_price - f.total_fees;
        assert.ok(near(f.realized_pnl, (f.fill_price - p.c) * f.quantity * mult - f.total_fees, 1e-6), "realized P&L");
        let nq = p.q - f.quantity;
        if (o.asset_class === "crypto") nq = Math.round(nq * 1e8) / 1e8;
        if (nq === 0) positions.delete(key); else positions.set(key, { q: nq, c: p.c });
      }
    }
    return { cashRef, positions };
  }
  const outcomes: Record<string, any> = {};
  for (const mode of ["rpc", "legacy"]) {
    fresh();
    if (mode === "legacy") process.env.PAPER_FILL_RPC = "off";
    for (const [, order] of script) assert.equal((await ENGINE.placeOrder(S(30), order)).filled, true, mode);
    assert.equal(rpc.calls, mode === "rpc" ? script.length : 0);
    const { cashRef, positions } = reference();
    assert.ok(near(cash(), cashRef, 1e-6), `${mode}: cash ${cash()} vs reference ${cashRef}`);
    assert.equal(db.paper_positions.length, positions.size, mode);
    for (const p of db.paper_positions) {
      const ref = positions.get(`${p.asset_class}:${p.symbol}`);
      assert.ok(ref && near(p.quantity, ref.q, 1e-9) && near(p.avg_cost_basis, ref.c, 1e-6), `${mode}: ${p.symbol} ${JSON.stringify(p)} vs ${JSON.stringify(ref)}`);
    }
    assert.equal(db.paper_fills.length, script.length, mode);
    assert.equal(db.paper_orders.every((o) => o.status === "filled"), true, mode);
    assert.equal(db.paper_trade_log.length, script.length, mode);
    outcomes[mode] = { positions: db.paper_positions.map((p) => `${p.asset_class}:${p.symbol}:${p.quantity}`).sort(), fillCount: db.paper_fills.length };
  }
  assert.deepEqual(outcomes.rpc, outcomes.legacy);
  delete process.env.PAPER_FILL_RPC;
});
