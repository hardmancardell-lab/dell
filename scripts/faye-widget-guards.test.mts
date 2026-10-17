// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-widget-guards.test.mts
// Faye widget guards (privacy audit F3, F5, F10): plan caps and rebuild, SSE splitting across chunk boundaries,
// validation of every proposed action, and the confirm card being built from the VALIDATED order. Pure functions plus a
// few static checks that the widget really uses them. No browser, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PG = await import("../src/lib/faye/plan-guards.ts");
const AV = await import("../src/lib/faye/action-validation.ts");
const POV = await import("../src/lib/faye/paper-order-validation.ts");

const call = (id: any, extra: any = {}) => ({ id, tool: "macro_overview", agent: "Research", method: "GET", path: "/api/macro-overview", params: {}, ...extra });
const many = (n: number) => Array.from({ length: n }, (_, i) => call("c" + i));

// ------------------------------------------------------------------ plan guards
test("a plan within the caps is rebuilt from whitelisted fields only", () => {
  const r = PG.sanitizePlanCalls([call("a", { params: { ticker: "NVDA", n: 3 }, evil: "x", __proto__: { x: 1 } })]);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.calls[0]).sort(), ["agent", "id", "method", "params", "path", "tool"]);
  assert.deepEqual(r.calls[0].params, { ticker: "NVDA", n: 3 });
});

test("calls per turn and per run are capped (5000-call plan from the audit)", () => {
  assert.equal(PG.sanitizePlanCalls(many(PG.MAX_CALLS_PER_TURN)).ok, true);
  const big = PG.sanitizePlanCalls(many(5000));
  assert.equal(big.ok, false);
  assert.match(big.error, /limit 16/);
  assert.equal(PG.sanitizePlanCalls(many(PG.MAX_CALLS_PER_TURN + 1)).ok, false);
  assert.equal(PG.sanitizePlanCalls(many(10), PG.MAX_CALLS_PER_RUN - 5).ok, false, "run-level cap");
  assert.equal(PG.sanitizePlanCalls(many(5), PG.MAX_CALLS_PER_RUN - 5).ok, true);
});

test("duplicate ids, reserved ids, odd ids and malformed elements are rejected", () => {
  assert.equal(PG.sanitizePlanCalls([call("a"), call("a")]).ok, false);
  for (const id of ["__proto__", "constructor", "", "a b", "x".repeat(65), 5, null, ["a"]]) assert.equal(PG.sanitizePlanCalls([call(id)]).ok, false, String(id));
  for (const el of [null, 5, "x", [], undefined]) assert.equal(PG.sanitizePlanCalls([el]).ok, false);
  assert.equal(PG.sanitizePlanCalls("calls").ok, false);
  assert.equal(PG.sanitizePlanCalls([]).ok, false);
  assert.equal(PG.sanitizePlanCalls(null).ok, false);
});

test("array-typed path, bad method and non-scalar params are rejected (the audit's coercion cases)", () => {
  assert.equal(PG.sanitizePlanCalls([call("a", { path: ["/api/macro-overview"] })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { method: "get" })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { method: "DELETE" })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { params: { ticker: null } })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { params: { ticker: ["AAPL"] } })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { params: { ticker: { x: 1 } } })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { params: "ticker=AAPL" })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { params: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["k" + i, "v"])) })]).ok, false);
  assert.equal(PG.sanitizePlanCalls([call("a", { body: { entries: "x" } })]).ok, false);
});

// ------------------------------------------------------------------ SSE splitter
const frame = (event: string, data: any) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

test("SSE: an event split at every possible byte boundary is delivered exactly once", () => {
  const stream = frame("chunk", { text: "hello" }) + frame("done", { kind: "final", calls: many(3), state: { a: "b\ncontains newline" } });
  for (let cut = 1; cut < stream.length; cut++) {
    const p = new PG.SseParser();
    const got = [...p.push(stream.slice(0, cut)), ...p.push(stream.slice(cut))];
    assert.equal(got.length, 2, "cut at " + cut);
    assert.equal(got[0].event, "chunk");
    assert.equal(got[1].data.kind, "final");
  }
});

test("SSE: one-character chunks, CRLF line endings, corrupt events skipped, no crash", () => {
  const stream = (frame("chunk", { text: "a" }) + "event: chunk\ndata: {not json\n\n" + frame("done", { kind: "final" })).replace(/\n/g, "\r\n");
  const p = new PG.SseParser();
  const got = [];
  for (const ch of stream) got.push(...p.push(ch));
  assert.deepEqual(got.map((g) => g.event), ["chunk", "done"]);
});

test("SSE: a trailing partial event is held back, not parsed", () => {
  const p = new PG.SseParser();
  assert.deepEqual(p.push('event: done\ndata: {"kind":"fin'), []);
  assert.equal(p.push('al"}\n\n')[0].data.kind, "final");
});

test("SSE: a hostile endless stream is cut off", () => {
  const p = new PG.SseParser();
  assert.throws(() => { for (let i = 0; i < 100; i++) p.push("x".repeat(100_000)); }, /larger than expected/);
});

// ------------------------------------------------------------------ action validation
const order = (extra: any = {}) => ({ symbol: "NVDA", assetClass: "equity", side: "buy", orderType: "market", quantity: 10, attribution: { strategyLabel: "x" }, ...extra });
const opt = (extra: any = {}) => ({ symbol: "AAPL", assetClass: "option", side: "buy", orderType: "market", quantity: 2, underlyingSymbol: "AAPL", expirationDate: "2026-12-18", optionRight: "call", strikePrice: 250, attribution: {}, ...extra });

test("the confirm summary is built from the VALIDATED order, not from server text", () => {
  // A tampered server says "10 shares of SPY" in its text but the params carry something else.
  const proposal = { type: "paper_order", params: order({ symbol: "qqq", quantity: 90000, orderType: "market" }), confirm_text: "I'll place a PAPER market buy of 10 share(s) of SPY" };
  const r = AV.validateProposedAction(proposal);
  assert.equal(r.ok, true);
  assert.match(r.action.summary, /90000 share\(s\) of QQQ/);
  assert.doesNotMatch(r.action.summary, /SPY/);
  assert.equal(r.action.params.attribution.origin, "faye", "origin forced");
  assert.ok(!("confirm_text" in r.action));
});

test("paper orders: whole shares, real dates, symbol must equal underlying, strike bounded, extra fields dropped", () => {
  for (const bad of [order({ quantity: 2.5 }), order({ quantity: 0 }), order({ quantity: NaN }), order({ quantity: 100001 }), order({ side: "short" }), order({ orderType: "limit" }), order({ symbol: "../x" }), order({ assetClass: "crypto" }), null, [], "x"]) {
    assert.equal(AV.validateProposedAction({ type: "paper_order", params: bad }).ok, false, JSON.stringify(bad));
  }
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt() }).ok, true);
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt({ expirationDate: "2026-13-45" }) }).ok, false, "format-only date check is gone");
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt({ expirationDate: "2026-02-30" }) }).ok, false);
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt({ symbol: "TSLA" }) }).ok, false, "symbol must match underlying");
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt({ strikePrice: 1e300 }) }).ok, false);
  assert.equal(AV.validateProposedAction({ type: "paper_order", params: opt({ quantity: 1.5 }) }).ok, false);
  const ok = AV.validateProposedAction({ type: "paper_order", params: order({ userId: "u", limitPrice: 1, ocoGroupId: "g" }) });
  assert.deepEqual(Object.keys(ok.action.params).sort(), ["assetClass", "attribution", "orderType", "quantity", "side", "symbol"]);
  assert.match(AV.validateProposedAction({ type: "paper_order", params: opt() }).action.summary, /2 contract\(s\) of AAPL 2026-12-18 250 CALL/);
});

test("add_holding: validated, normalized, bad values rejected before they reach the local ledger", () => {
  const good = { symbol: "voo", assetClass: "equity", shares: 5, costBasisPerShare: 400, acquiredDate: "2026-10-01" };
  const r = AV.validateProposedAction({ type: "add_holding", params: good });
  assert.equal(r.ok, true);
  assert.equal(r.action.params.symbol, "VOO");
  assert.match(r.action.summary, /5 share\(s\) of VOO.*\$400\.00/);
  for (const patch of [{ shares: -1 }, { shares: 0 }, { shares: Infinity }, { shares: "5" }, { shares: 1e12 }, { costBasisPerShare: -5 }, { costBasisPerShare: 0 }, { costBasisPerShare: NaN }, { costBasisPerShare: 1e9 }, { acquiredDate: "yesterday" }, { acquiredDate: "2026-02-30" }, { assetClass: "../x" }, { assetClass: "stonks" }, { symbol: "A B" }, { symbol: "" }]) {
    assert.equal(AV.validateProposedAction({ type: "add_holding", params: { ...good, ...patch } }).ok, false, JSON.stringify(patch));
  }
});

test("sell_holding: price and fee must be finite and non-negative, date real", () => {
  const good = { symbol: "VOO", sharesSold: 2, salePricePerShare: 410.5, fee: 1, saleDate: "2026-10-16" };
  assert.equal(AV.validateProposedAction({ type: "sell_holding", params: good }).ok, true);
  assert.equal(AV.validateProposedAction({ type: "sell_holding", params: { ...good, fee: undefined } }).action.params.fee, 0);
  for (const patch of [{ sharesSold: 0 }, { sharesSold: -1 }, { salePricePerShare: "abc" }, { salePricePerShare: NaN }, { salePricePerShare: -1 }, { fee: -1 }, { fee: "x" }, { fee: 1e9 }, { saleDate: "2026-99-99" }]) {
    assert.equal(AV.validateProposedAction({ type: "sell_holding", params: { ...good, ...patch } }).ok, false, JSON.stringify(patch));
  }
});

test("remove_holding and unknown action types", () => {
  const r = AV.validateProposedAction({ type: "remove_holding", params: { symbol: "fees" } });
  assert.equal(r.ok, true);
  assert.match(r.action.summary, /REMOVE FEES.*no sale is recorded/);
  assert.equal(AV.validateProposedAction({ type: "remove_holding", params: { symbol: "" } }).ok, false);
  for (const t of ["delete_everything", "transfer_funds", "", 5, null, undefined]) assert.equal(AV.validateProposedAction({ type: t, params: {} }).ok, false);
  assert.equal(AV.validateProposedAction({ type: "add_holding" }).ok, false);
  assert.equal(AV.validateProposedAction(null).ok, false);
});

test("isRealIsoDate", () => {
  assert.equal(AV.isRealIsoDate("2026-02-28"), true);
  assert.equal(AV.isRealIsoDate("2028-02-29"), true);
  assert.equal(AV.isRealIsoDate("2027-02-29"), false);
  assert.equal(AV.isRealIsoDate("2026-1-1"), false);
  assert.equal(AV.isRealIsoDate(20261001), false);
});

test("POV still accepts what the orchestrator really proposes (stock buy, option buy)", () => {
  assert.equal(POV.validatePaperOrder(order()).ok, true);
  assert.equal(POV.validatePaperOrder(opt()).ok, true);
});

// ------------------------------------------------------------------ the widget really uses them
test("widget wiring: plan sanitizer before running, validated action on the card, SseParser instead of ad hoc parsing", () => {
  const src = readFileSync(new URL("../src/components/FayeChatWidget.tsx", import.meta.url), "utf8");
  assert.match(src, /sanitizePlanCalls\(calls, callsRun\)/, "every turn's calls are checked");
  assert.match(src, /sanitizePlanCalls\(data\.calls, 0\)/, "the first plan is checked");
  assert.match(src, /validateProposedAction\(data\.action\)/, "first-turn actions are validated");
  assert.match(src, /validateProposedAction\(json\.action\)/, "final-turn actions are validated");
  assert.match(src, /m\.action\.summary/, "the card renders the validated summary");
  assert.match(src, /new SseParser\(\)/);
  assert.doesNotMatch(src, /JSON\.parse\(dataMatch/, "the unguarded SSE parse is gone");
  assert.doesNotMatch(src, /as ProposedAction/, "no unvalidated cast of a server action");
  assert.match(src, /Object\.create\(null\)/, "result map has no prototype");
  assert.match(src, /hasOwnProperty\.call\(ALLOWED_TOOLS/, "allowlist lookup cannot be fooled by prototype keys");
});
