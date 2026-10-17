// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/paper-order-engine.test.mts
// Paper-trading engine: input validation, atomic order state transitions, per-account serialization, quote failure.
// Uses an in-memory fake of the Supabase REST API with random 1-6 ms latency per request (so concurrent requests
// interleave like real HTTP) and the app's mock market data. Ported from the database-security audit's ledger-race
// experiments (R1 lost cash updates, R2 overdraft, R3 triple fill, H3 side/orderType acceptance, R4 duplicate accounts).
import test from "node:test";
import assert from "node:assert/strict";

process.env.MARKET_DATA_MOCK_MODE = "true";
process.env.SUPABASE_URL = "http://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const ENGINE = await import("../src/lib/agents/trading-agent/skills/paper-trading-engine.ts");
const MD = await import("../src/lib/data/market-data.ts");

let db: Record<string, any[]> = {};
let seq = 0;
let httpCalls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const matches = (row: any, filters: [string, string][]) =>
  filters.every(([k, v]) => {
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    if (op === "eq") return String(row[k]) === val;
    if (op === "neq") return String(row[k]) !== val;
    if (op === "not") return true;
    return true;
  });
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  if (!url.hostname.startsWith("fake.supabase")) throw new Error("blocked non-fake fetch " + url.hostname);
  httpCalls++;
  await sleep(1 + Math.random() * 5);
  const table = url.pathname.split("/").pop()!;
  const rows = (db[table] ??= []);
  const method = init.method ?? "GET";
  const filters = [...url.searchParams.entries()].filter(([k]) => !["order", "limit", "select", "on_conflict"].includes(k));
  const body = init.body ? JSON.parse(init.body) : undefined;
  const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (method === "GET") return json(rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })));
  if (method === "POST") {
    const now = new Date().toISOString();
    if (table === "paper_positions") {
      const i = rows.findIndex((r) => r.account_id === body.account_id && r.symbol === body.symbol && r.asset_class === body.asset_class);
      if (i >= 0) rows[i] = { ...rows[i], ...body }; else rows.push({ ...body });
      return json([body]);
    }
    const row = { id: `${table}-${++seq}`, created_at: now, filled_at: body.status === "filled" || table === "paper_fills" ? now : null, ...body };
    rows.push(row);
    return json([{ ...row }], 201);
  }
  if (method === "PATCH") {
    // The match-and-update below runs in one synchronous step, like a single-statement UPDATE in Postgres.
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

const S = (n: number) => `paper-session-${String(n).padStart(4, "0")}`;
const price = (await MD.fetchQuote("AAPL")).lastPrice;
const buy = (q: number, extra = {}) => ({ symbol: "AAPL", assetClass: "equity", side: "buy", orderType: "market", quantity: q, ...extra });
const fresh = () => { db = {}; seq = 0; httpCalls = 0; };
const cash = () => db.paper_accounts[0].cash_balance;

test("validation rejects bad side, order type, asset class, numbers and symbols before any database write", async () => {
  fresh();
  const bad: [string, any][] = [
    ["side short", buy(100, { side: "short" })],
    ["side missing", { ...buy(1), side: undefined }],
    ["orderType banana", buy(1, { orderType: "banana" })],
    ["assetClass weird", buy(1, { assetClass: "weird" })],
    ["quantity NaN", buy(NaN)],
    ["quantity Infinity", buy(Infinity)],
    ["quantity negative", buy(-5)],
    ["quantity zero", buy(0)],
    ["quantity string", buy("5" as any)],
    ["quantity huge", buy(1e12)],
    ["quantity fractional equity", buy(1.5)],
    ["limit price negative", buy(1, { orderType: "limit", limitPrice: -1 })],
    ["limit price NaN", buy(1, { orderType: "limit", limitPrice: NaN })],
    ["limit price missing", buy(1, { orderType: "limit" })],
    ["limit price huge", buy(1, { orderType: "limit", limitPrice: 1e12 })],
    ["stop price Infinity", buy(1, { orderType: "stop", stopPrice: Infinity })],
    ["trail zero", buy(1, { orderType: "trailing_stop", trailAmount: 0 })],
    ["symbol injection", buy(1, { symbol: "AAPL&select=*" })],
    ["symbol comma", buy(1, { symbol: "A,B" })],
    ["symbol empty", buy(1, { symbol: "  " })],
    ["symbol too long", buy(1, { symbol: "A".repeat(40) })],
    ["oco id hostile", buy(1, { ocoGroupId: "x),(y" })],
    ["option without fields", { symbol: "X", assetClass: "option", side: "buy", orderType: "market", quantity: 1 }],
    ["option bad right", { symbol: "X", assetClass: "option", side: "buy", orderType: "market", quantity: 1, underlyingSymbol: "AAPL", expirationDate: "2026-12-18", optionRight: "straddle", strikePrice: 100 }],
    ["not an object", "buy 100 AAPL"],
  ];
  for (const [name, input] of bad) {
    await assert.rejects(() => ENGINE.placeOrder(S(1), input), (e: any) => e instanceof ENGINE.PaperOrderValidationError || /Quantity|Order|Symbol|Side|Limit|Stop/i.test(e.message), name);
  }
  assert.equal(httpCalls, 0, "validation must run before any database call");
  assert.equal((db.paper_orders ?? []).length, 0);
});

test("a normal whole-share market buy fills and moves cash by the exact notional", async () => {
  fresh();
  const r = await ENGINE.placeOrder(S(2), buy(10));
  assert.equal(r.filled, true);
  const fill = db.paper_fills[0];
  assert.equal(db.paper_positions[0].quantity, 10);
  assert.ok(Math.abs(cash() - (100000 - 10 * fill.fill_price)) < 1e-6);
});

test("R1: 20 concurrent buys of 10 shares keep every cash debit and every share (no lost updates)", async () => {
  fresh();
  await ENGINE.placeOrder(S(3), buy(1)); // create the account
  db.paper_orders = []; db.paper_fills = []; db.paper_positions = []; db.paper_accounts[0].cash_balance = 100000;
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => ENGINE.placeOrder(S(3), buy(10))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 20);
  assert.equal(db.paper_fills.length, 20);
  assert.equal(db.paper_positions[0].quantity, 200, "position must hold all 200 shares");
  const spent = db.paper_fills.reduce((s, f) => s + f.quantity * f.fill_price, 0);
  assert.ok(Math.abs(cash() - (100000 - spent)) < 1e-4, `cash ${cash()} should equal 100000 - ${spent}`);
});

test("R2: concurrent buys that together exceed cash cannot overdraw (only what fits is accepted)", async () => {
  fresh();
  await ENGINE.placeOrder(S(4), buy(1));
  db.paper_orders = []; db.paper_fills = []; db.paper_positions = []; db.paper_accounts[0].cash_balance = 100000;
  const qty = Math.floor((100000 * 0.6) / price);
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => ENGINE.placeOrder(S(4), buy(qty))));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  assert.equal(ok, 1, "only one 60%-of-cash order fits");
  assert.ok(cash() >= 0, `cash must not go negative, got ${cash()}`);
  assert.equal(db.paper_fills.length, 1);
});

test("R3: one pending order checked by 3 concurrent callers fills exactly once", async () => {
  fresh();
  const placed = await ENGINE.placeOrder(S(5), buy(5, { orderType: "limit", limitPrice: price * 0.5 }));
  assert.equal(placed.filled, false);
  assert.equal(db.paper_orders[0].status, "pending");
  db.paper_orders[0].limit_price = price * 10; // a candle now trades through the limit
  const accountId = db.paper_accounts[0].id;
  const results = await Promise.all([1, 2, 3].map(() => ENGINE.evaluateAccountOrders(accountId)));
  assert.equal(results.reduce((s, r) => s + r.ordersFilled, 0), 1, "exactly one evaluator fills it");
  assert.equal(db.paper_fills.length, 1);
  assert.equal(db.paper_positions[0].quantity, 5);
  assert.equal((db.paper_trade_log ?? []).length <= 1, true);
  assert.equal(db.paper_orders[0].status, "filled");
  // And the hourly cron path racing the user path:
  const again = await Promise.all([ENGINE.evaluateAllPendingOrders(), ENGINE.evaluateAccountOrders(accountId)]);
  assert.equal(again.reduce((s, r) => s + r.ordersFilled, 0), 0);
  assert.equal(db.paper_fills.length, 1);
});

test("a cancel that loses the race to a fill does not overwrite the fill; a fill after a cancel does not happen", async () => {
  fresh();
  await ENGINE.placeOrder(S(6), buy(2, { orderType: "limit", limitPrice: price * 0.5 }));
  const orderId = db.paper_orders[0].id;
  const accountId = db.paper_accounts[0].id;
  // cancel first: order is cancelled, later check fills nothing
  await ENGINE.cancelUserOrder(orderId, S(6));
  assert.equal(db.paper_orders[0].status, "cancelled");
  db.paper_orders[0].status = "pending"; db.paper_orders[0].limit_price = price * 10; // simulate: fill claims it first
  const [ev, cancelRes] = await Promise.allSettled([ENGINE.evaluateAccountOrders(accountId), ENGINE.cancelUserOrder(orderId, S(6))]);
  const filled = db.paper_orders[0].status === "filled";
  const cancelled = db.paper_orders[0].status === "cancelled";
  assert.ok(filled !== cancelled, "exactly one terminal state");
  if (filled) assert.equal(cancelRes.status, "rejected", "cancel must report failure when the fill won");
  assert.equal(db.paper_fills.length, filled ? 1 : 0);
});

test("R4: concurrent first requests for one session create one account", async () => {
  fresh();
  await Promise.allSettled(Array.from({ length: 10 }, () => ENGINE.getAccountSummary(S(7))));
  assert.equal(db.paper_accounts.length, 1);
});

test("a fill that would overdraw at fill time is rejected, not applied (pending order, cash spent elsewhere)", async () => {
  fresh();
  await ENGINE.placeOrder(S(8), buy(5, { orderType: "limit", limitPrice: price * 0.5 }));
  db.paper_orders[0].limit_price = price * 10;
  db.paper_accounts[0].cash_balance = 10; // cash gone since the order was placed
  const res = await ENGINE.evaluateAccountOrders(db.paper_accounts[0].id);
  assert.equal(res.ordersFilled, 0);
  assert.equal(db.paper_orders[0].status, "rejected");
  assert.match(res.errors[0].error, /Insufficient cash at fill time/);
  assert.equal(db.paper_fills?.length ?? 0, 0);
  assert.equal(cash(), 10);
});

test("a quote failure rejects the order with a clear message and fills nothing (never at 0)", async () => {
  fresh();
  process.env.MARKET_DATA_MOCK_MODE = "false"; // real providers: no keys configured here, so fetchQuote rejects
  try {
    await assert.rejects(() => ENGINE.placeOrder(S(9), buy(10)), /Could not get a live price for AAPL.*nothing was filled/);
  } finally {
    process.env.MARKET_DATA_MOCK_MODE = "true";
  }
  assert.equal(db.paper_fills?.length ?? 0, 0);
  assert.equal(db.paper_orders?.length ?? 0, 0);
  for (const bad of [0, -1, NaN, undefined, null, "12"]) assert.throws(() => ENGINE.requireUsablePrice(bad, "X"), /No usable X price/);
  assert.equal(ENGINE.requireUsablePrice(12.5, "X"), 12.5);
});

test("a failed fill write voids the order row instead of leaving a phantom 'filled' order", async () => {
  fresh();
  await ENGINE.placeOrder(S(10), buy(1));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input: any, init: any = {}) => {
    if (String(input).includes("paper_fills") && init.method === "POST") return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    return realFetch(input, init);
  };
  try {
    await assert.rejects(() => ENGINE.placeOrder(S(10), buy(3)), /Supabase request failed/);
  } finally {
    globalThis.fetch = realFetch;
  }
  const last = db.paper_orders.at(-1);
  assert.equal(last.status, "cancelled", "order must not stay 'filled' without a fill");
});

test("withAccountLock runs same-key tasks strictly in order and different keys in parallel", async () => {
  const order: string[] = [];
  const mk = (key: string, name: string, ms: number) => ENGINE.withAccountLock(key, async () => { order.push(name + ":start"); await sleep(ms); order.push(name + ":end"); });
  await Promise.all([mk("a", "a1", 20), mk("a", "a2", 1), mk("b", "b1", 5)]);
  assert.ok(order.indexOf("a1:end") < order.indexOf("a2:start"));
  assert.ok(order.indexOf("b1:start") < order.indexOf("a1:end"), "other key is not blocked");
});
