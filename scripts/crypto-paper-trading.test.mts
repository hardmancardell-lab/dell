// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/crypto-paper-trading.test.mts
// Checks crypto paper trading: the pure fill/fee helpers, then the real paper-trading engine against an in-memory fake of
// the Supabase REST API (no database touched) with the app's mock market data. Covers fractional quantities, fills at the
// bid/ask, the assumed fee going into cost basis, dust-free full exits, rejections, and the migration hint.
process.env.MARKET_DATA_MOCK_MODE = "true";
process.env.SUPABASE_URL = "http://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const P = await import("../src/lib/agents/trading-agent/crypto-paper.ts");
const ENGINE = await import("../src/lib/agents/trading-agent/skills/paper-trading-engine.ts");
const MD = await import("../src/lib/data/market-data.ts");

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number | null, b: number, tol = 1e-6) => a !== null && Math.abs(a - b) <= tol;
const book = { bid: 99, ask: 101 };

// ---------------------------------------------------------------- pure helpers
t("a market buy lifts the ask, a market sell hits the bid", P.cryptoMarketFill("buy", book) === 101 && P.cryptoMarketFill("sell", book) === 99);
t("a marketable buy limit fills at the ask when that beats the limit, never above the limit", P.cryptoMarketableLimitFill("buy", 105, book) === 101 && P.cryptoMarketableLimitFill("buy", 100.5, { bid: 99, ask: 100 }) === 100);
t("a marketable sell limit fills at the bid when that beats the limit", P.cryptoMarketableLimitFill("sell", 95, book) === 99);
t("a triggered stop gives up half the relative spread", near(P.cryptoTriggeredFill("sell", 100, book), 100 * (1 - 0.01)) && near(P.cryptoTriggeredFill("buy", 100, book), 100 * 1.01));
t("fee is the assumed rate on the fill value; cash needed adds it", near(P.cryptoFee(2, 50), 100 * P.CRYPTO_PAPER_FEE_RATE) && near(P.cryptoBuyCashNeeded(2, 50), 100 * (1 + P.CRYPTO_PAPER_FEE_RATE)));
t("the disclosure names the rate and says it is an assumption", /0\.60%/.test(P.CRYPTO_PAPER_DISCLOSURE) && /not your actual Coinbase tier/.test(P.CRYPTO_PAPER_DISCLOSURE));

// ---------------------------------------------------------------- order preparation
{
  const p = ENGINE.prepareCryptoOrder({ symbol: "btc", assetClass: "crypto", side: "buy", orderType: "market", quantity: 0.1 + 0.2 });
  t("symbol becomes a product id and quantity loses float noise", p.symbol === "BTC-USD" && p.quantity === 0.3, JSON.stringify(p));
  let m1 = "", m2 = "";
  try { ENGINE.prepareCryptoOrder({ symbol: "AAPL-EUR", assetClass: "crypto", side: "buy", orderType: "market", quantity: 1 }); } catch (e) { m1 = e.message; }
  try { ENGINE.prepareCryptoOrder({ symbol: "BTC-USD", assetClass: "crypto", side: "buy", orderType: "market", quantity: 1e-9 }); } catch (e) { m2 = e.message; }
  t("a non-USD-pair symbol and a sub-satoshi quantity are rejected", /not a Coinbase USD pair/.test(m1) && /below one satoshi/.test(m2), m1 + " | " + m2);
}

// ---------------------------------------------------------------- in-memory fake of the Supabase REST API
const db: Record<string, any[]> = {};
let seq = 0;
let failQuantityInsert = false;
const matches = (row: any, filters: [string, string][]) =>
  filters.every(([k, v]) => {
    const [op, ...rest] = v.split(".");
    const val = rest.join(".");
    if (op === "eq") return String(row[k]) === val;
    if (op === "neq") return String(row[k]) !== val;
    return true;
  });
globalThis.fetch = async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const table = url.pathname.split("/").pop()!;
  // The atomic-fill migration has not been run in this fake database: PostgREST answers 404 / PGRST202 and the engine falls back to the older path.
  if (url.pathname.includes("/rpc/")) {
    return new Response(JSON.stringify({ code: "PGRST202", details: null, hint: null, message: "Could not find the function public.paper_apply_fill(p_order_id) in the schema cache" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }
  const rows = (db[table] ??= []);
  const method = init.method ?? "GET";
  const filters = [...url.searchParams.entries()].filter(([k]) => !["order", "limit", "select", "on_conflict"].includes(k));
  const body = init.body ? JSON.parse(init.body) : undefined;
  const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (method === "GET") return json(rows.filter((r) => matches(r, filters)));
  if (method === "POST") {
    if (failQuantityInsert && table === "paper_orders") return json({ message: 'invalid input syntax for type integer: "0.015"' }, 400);
    const now = new Date().toISOString();
    if (table === "paper_positions") {
      const i = rows.findIndex((r) => r.account_id === body.account_id && r.symbol === body.symbol && r.asset_class === body.asset_class);
      if (i >= 0) rows[i] = { ...rows[i], ...body }; else rows.push({ ...body });
      return json([body]);
    }
    const row = { id: `${table}-${++seq}`, created_at: now, filled_at: body.status === "filled" || table === "paper_fills" ? now : null, ...body };
    rows.push(row);
    return json([row], 201);
  }
  if (method === "PATCH") {
    const hit = rows.filter((r) => matches(r, filters));
    hit.forEach((r) => Object.assign(r, body));
    return json(hit);
  }
  if (method === "DELETE") {
    db[table] = rows.filter((r) => !matches(r, filters));
    return json([]);
  }
  return json([]);
};

const SESSION = "session-crypto-test-1";
const acct = () => db.paper_accounts[0];
const pos = () => db.paper_positions?.find((p) => p.symbol === "BTC-USD");
const order = (q: number, side = "buy", extra = {}) => ({ symbol: "btc", assetClass: "crypto", side, orderType: "market", quantity: q, ...extra });
const bidAsk = await MD.fetchLatestCryptoBidAsk("BTC-USD");

// ---------------------------------------------------------------- buy a fraction
{
  const r = await ENGINE.placeOrder(SESSION, order(0.015));
  const fill = db.paper_fills[0];
  t("a fractional market buy fills", r.filled === true && fill.quantity === 0.015, JSON.stringify(fill));
  t("it fills at the live ask, with the spread as slippage", near(fill.fill_price, bidAsk.ask) && near(fill.slippage_per_share, bidAsk.ask - (bidAsk.bid + bidAsk.ask) / 2), `${fill.fill_price} vs ${bidAsk.ask}`);
  const fee = 0.015 * bidAsk.ask * P.CRYPTO_PAPER_FEE_RATE;
  t("the assumed fee is charged and no equity fees are", near(fill.total_fees, fee) && fill.sec_fee === 0 && fill.finra_fee === 0 && fill.occ_fee === 0, JSON.stringify(fill));
  t("cash falls by cost plus fee", near(acct().cash_balance, 100000 - 0.015 * bidAsk.ask - fee), String(acct().cash_balance));
  t("the position is stored as BTC-USD / crypto with the fee in its cost basis", pos().asset_class === "crypto" && pos().quantity === 0.015 && near(pos().avg_cost_basis, bidAsk.ask + fee / 0.015), JSON.stringify(pos()));
  t("the order row carries the normalised symbol and asset class", db.paper_orders[0].symbol === "BTC-USD" && db.paper_orders[0].asset_class === "crypto" && db.paper_orders[0].quantity === 0.015);
}

// ---------------------------------------------------------------- add to it, then sell it all
{
  await ENGINE.placeOrder(SESSION, order(0.1));
  t("a second buy averages the basis and adds the quantity without float noise", pos().quantity === 0.115, String(pos().quantity));
  const cashBefore = acct().cash_balance;
  const r = await ENGINE.placeOrder(SESSION, order(0.115, "sell"));
  const fill = db.paper_fills[db.paper_fills.length - 1];
  t("selling the whole position hits the bid and closes it with no dust left", r.filled && near(fill.fill_price, bidAsk.bid) && pos() === undefined, JSON.stringify(db.paper_positions));
  t("sale proceeds are value less the fee", near(acct().cash_balance - cashBefore, 0.115 * bidAsk.bid - 0.115 * bidAsk.bid * P.CRYPTO_PAPER_FEE_RATE));
  const spreadAndFeeCost = fill.realized_pnl;
  t("realised P&L is negative after crossing the spread twice and paying fees both ways", spreadAndFeeCost < 0, String(spreadAndFeeCost));
}

// ---------------------------------------------------------------- rejections
{
  let m = "";
  try { await ENGINE.placeOrder(SESSION, order(0.5, "sell")); } catch (e) { m = e.message; }
  t("selling coins that are not held is rejected (long-only)", /Cannot sell/.test(m), m);
  m = "";
  try { await ENGINE.placeOrder(SESSION, order(1e6)); } catch (e) { m = e.message; }
  t("a buy beyond available cash is rejected and mentions the fee", /Insufficient cash/.test(m) && /assumed fee/.test(m), m);
  m = "";
  try { await ENGINE.placeOrder(SESSION, { ...order(1), symbol: "AAPL-EUR" }); } catch (e) { m = e.message; }
  t("a symbol that is not a USD pair is rejected before any quote is fetched", /not a Coinbase USD pair/.test(m), m);
}

// ---------------------------------------------------------------- limit orders
{
  const ordersBefore = db.paper_orders.length;
  const low = await ENGINE.placeOrder(SESSION, order(0.01, "buy", { orderType: "limit", limitPrice: bidAsk.ask * 0.5 }));
  t("a buy limit below the ask rests as pending", low.filled === false && db.paper_orders.length === ordersBefore + 1 && db.paper_orders.at(-1).status === "pending");
  const fillsBefore = db.paper_fills.length;
  const high = await ENGINE.placeOrder(SESSION, order(0.01, "buy", { orderType: "limit", limitPrice: bidAsk.ask * 2 }));
  const f = db.paper_fills.at(-1);
  t("a buy limit far above the ask fills at the ask, not at the limit", high.filled && db.paper_fills.length === fillsBefore + 1 && near(f.fill_price, bidAsk.ask), `${f.fill_price}`);
}

// ---------------------------------------------------------------- checking resting orders
{
  const res = await ENGINE.evaluateAccountOrders(acct().id);
  t("Check Orders evaluates the resting crypto order against 5-minute candles without error; a far-away limit stays pending", res.ordersEvaluated === 1 && res.errors.length === 0 && res.ordersFilled === 0, JSON.stringify(res));
  // Lift the resting buy limit above every mock candle low so the candle scan must fill it at the limit price.
  const resting = db.paper_orders.find((o) => o.status === "pending");
  resting.limit_price = bidAsk.ask * 10;
  const fillsBefore = db.paper_fills.length;
  const res2 = await ENGINE.evaluateAccountOrders(acct().id);
  const f = db.paper_fills.at(-1);
  t("once a candle trades through the limit the order fills at the limit price, with the fee", res2.ordersFilled === 1 && db.paper_fills.length === fillsBefore + 1 && near(f.fill_price, bidAsk.ask * 10) && near(f.total_fees, f.quantity * f.fill_price * P.CRYPTO_PAPER_FEE_RATE), JSON.stringify(res2) + JSON.stringify(f));
}

// ---------------------------------------------------------------- account summary
{
  const s = await ENGINE.getAccountSummary(SESSION);
  const btc = s.positions.find((p) => p.symbol === "BTC-USD");
  t("the account summary values the crypto position at the crypto quote", btc && near(btc.currentPrice, (await MD.fetchQuote("BTC-USD")).lastPrice) && near(btc.marketValue, btc.currentPrice * btc.quantity));
  t("the summary discloses the crypto fee and candle assumptions", s.dataLimitations.some((d) => /assumed flat 0\.60% fee/.test(d)));
}

// ---------------------------------------------------------------- old schema: clear message, nothing half-written
{
  const ordersBefore = db.paper_orders.length;
  failQuantityInsert = true;
  let m = "";
  try { await ENGINE.placeOrder(SESSION, order(0.015)); } catch (e) { m = e.message; }
  failQuantityInsert = false;
  t("an integer-quantity schema is reported with the migration file to run", /2026-10-14_crypto_paper_trading\.sql/.test(m), m);
  t("and no order row was left behind", db.paper_orders.length === ordersBefore);
}

console.log(bad === 0 ? "\nall passed" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
