// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/client-research.test.mts
// Client Research section (src/app/api/client/[slug]/research/*, src/lib/client-research/*).
// Access rules (bad slugs, unknown slugs, no cookie, another client's cookie, another client's ticker, arbitrary tickers),
// abuse limits (per-address and per-client rate limits, cap on stocks, hourly fetch budget, cache, stale fallback),
// what leaves the server (no shares, cost, cash, hashes, upstream error text, trading-desk fields) and the wording.
// No network: Supabase and every upstream are in-process fakes, and any other fetch throws. No real key is used.
import test from "node:test";
import assert from "node:assert/strict";

const SUPA = "http://supabase.fake.invalid";
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.ACCESS_COOKIE_KEY = "server-side-signing-key-for-tests";
delete process.env.CLIENT_RESEARCH_ENABLED;

const clients: Record<string, any> = {
  slugAAAA1111: { id: "id-A", slug: "slugAAAA1111", name: "Client A", passcode_hash: "hashA", cash_balance: 987654, linked_email: null, user_id: null, created_at: "2026-01-01" },
  slugBBBB2222: { id: "id-B", slug: "slugBBBB2222", name: "Client B", passcode_hash: "hashB", cash_balance: 1, linked_email: null, user_id: null, created_at: "2026-01-01" },
  slugCCCC3333: { id: "id-C", slug: "slugCCCC3333", name: "Client C", passcode_hash: "hashC", cash_balance: 0, linked_email: null, user_id: null, created_at: "2026-01-01" },
};
const row = (client_id: string, symbol: string, asset_class: string, extra: any = {}) => ({
  id: `${client_id}-${symbol}`, client_id, symbol, asset_class, shares: 1234.5, cost_basis_per_share: 77.77, acquired_date: "2025-01-01",
  option_right: null, strike_price: null, expiration_date: null, underlying_symbol: null, contract_multiplier: null, ...extra,
});
const many = Array.from({ length: 15 }, (_, i) => row("id-C", `ZQ${String.fromCharCode(65 + i)}`, "equity"));
const holdings: Record<string, any[]> = {
  "id-A": [row("id-A", "NVDA", "equity"), row("id-A", "NVDA", "equity"), row("id-A", "aapl", "equity"), row("id-A", "BTC-USD", "crypto"), row("id-A", "NVDA250117C00100000", "option", { underlying_symbol: "NVDA" }), row("id-A", "EUR/USD", "forex")],
  "id-B": [row("id-B", "TSLA", "equity")],
  "id-C": many,
};
let dbCalls = 0;
globalThis.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith(SUPA)) throw new Error("blocked non-mock fetch " + url);
  dbCalls++;
  const json = (o: any) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  let m = url.match(/advisor_clients\?slug=eq\.([^&]+)/);
  if (m) {
    const c = clients[decodeURIComponent(m[1])];
    return json(c ? [c] : []);
  }
  m = url.match(/advisor_client_holdings\?client_id=eq\.([^&]+)/);
  if (m) return json(holdings[decodeURIComponent(m[1])] ?? []);
  throw new Error("unexpected db url " + url);
}) as typeof fetch;

const T = await import("../src/lib/access/tokens.ts");
const INDEX = await import("../src/app/api/client/[slug]/research/route.ts");
const HOLD = await import("../src/app/api/client/[slug]/research/holding/[symbol]/route.ts");
const ENVR = await import("../src/app/api/client/[slug]/research/environment/route.ts");
const METH = await import("../src/app/api/client/[slug]/research/method/route.ts");
const V = await import("../src/lib/client-research/valuation.ts");
const E = await import("../src/lib/client-research/environment.ts");
const C = await import("../src/lib/client-research/cache.ts");
const H = await import("../src/lib/client-research/holdings.ts");
const M = await import("../src/lib/client-research/meaning.ts");
const X = await import("../src/lib/client-research/method.ts");
const RL = await import("../scripts/quality/reading-level.mts");

// ------------------------------------------------------------------ helpers
let ipSeq = 0;
const ip = () => `198.51.100.${++ipSeq % 250}-${Math.floor(ipSeq / 250)}`;
const cookieFor = async (slug: string, hash: string) => `client_session_${slug}=${await T.issueClientCookie(slug, hash)}`;
const req = (path: string, cookie?: string, addr = ip()) => new Request(`http://app.test${path}`, { headers: { ...(cookie ? { cookie } : {}), "x-real-ip": addr } });
const P = (slug: string, symbol?: string) => ({ params: Promise.resolve(symbol === undefined ? { slug } : { slug, symbol }) });

const ckA = await cookieFor("slugAAAA1111", "hashA");
const ckB = await cookieFor("slugBBBB2222", "hashB");
const ckC = await cookieFor("slugCCCC3333", "hashC");

// ------------------------------------------------------------------ upstream fakes
const lifecycleCalls: string[] = [];
const quoteCalls: string[] = [];
const RAW = {
  ticker: "NVDA",
  analysis: { company: "NVIDIA CORP", asOf: "2026-07-26", phase: { phase: 4, name: "Capital return", decidedBy: [], confidence: "medium", note: "Near the line with phase 3.", alsoConsistentWith: [{ phase: 3, reason: "margins are still widening" }] } },
  valuation: {
    phase: 4, phaseName: "Capital return", question: "What is paid per dollar of earnings and cash flow?", caveats: ["Valuation is arithmetic on filed numbers and a price, not a forecast.", "Discount rate 10%, terminal growth 3% and a 10-year window are assumptions.", "page-only caveat"],
    statements: ["On a yield basis you are paying for growth, not income."], inputs: { years: 10 },
    reverseDcf: { impliedGrowthPct: 14.2, currentCashFlowGrowthPct: 62.1 },
  },
  rating: {
    headline: "very attractive", averagePremiumPct: -34.2, window: "the past 12 months",
    perMultiple: [{ label: "Price / earnings", current: 20, average: 30.4, premiumPct: -34.2, rating: "very attractive", percentile: 12.4 }],
    crossChecks: [{ title: "One year is a short window", detail: "The comparison covers the past 12 months.", direction: "context" }],
  },
  historySource: "market-data", sources: { riskFree: "FRED DGS10" }, price: { value: 123.45, source: "provided" },
};
const okResponse = (raw: any = RAW) => new Response(JSON.stringify(raw), { status: 200 });
function installValuation(over: any = {}, opts: any = {}) {
  lifecycleCalls.length = 0;
  quoteCalls.length = 0;
  V.__setValuationDepsForTests(
    {
      quote: async (s) => { quoteCalls.push(s); return { symbol: s, lastPrice: 123.45, totalVolume: 1, asOf: Date.parse("2026-10-18T14:30:00Z"), delayed: true, feed: "iex" }; },
      lifecycle: async (url) => { lifecycleCalls.push(url); return okResponse(); },
      ...over,
    },
    opts,
  );
}
const outlook = () => ({
  meta: { versionId: "v1", asOfDate: "2026-10-12", refreshReason: "cpi_print", priorVersionId: null, nextScheduledRefresh: "2026-11-05" },
  regimeTag: { label: "Late-cycle slowdown", cyclePhase: "late_expansion", dualMandateBalance: "Inflation is the bigger worry.", financialConditionsStance: "tight" },
  dualMandateScorecard: { labor: [{ indicator: "Unemployment rate", currentReading: "4.3%", roleInOutlook: "Slack", howDerived: "SECRET-HOW", source: "BLS", lastChangedMeaningfully: null }], inflation: [] },
  growthAndFinancialConditions: [],
  policyStance: { currentTargetRange: "4.00% to 4.25%", houseViewPath: "One cut by year end", marketImpliedPath: "Two cuts", gapAnalysis: "SECRET-GAP-ANALYSIS" },
  riskBalance: { upsideRisks: [{ scenario: "Faster disinflation", trigger: "Core CPI under 0.2%", marketImplication: "Yields fall" }], downsideRisks: [] },
  selfQa: [{ question: "q", answer: "SECRET-SELF-QA", falsificationTrigger: "SECRET-TRIGGER" }],
  tradingParameters: { volRegime: "elevated_event_risk", calendarEffectsPriority: ["SECRET-CALENDAR"], eventVolCatalysts: [], meanReversionWindowConfidence: "SECRET-MR" },
  outputLayers: { glance: "Growth is slowing while inflation is sticky.", narrativeRef: "SECRET-NARRATIVE", triggerFeed: ["SECRET-FEED"] },
  scorecardLogRef: "x",
  dataLimitations: ["Some inputs are monthly."],
});
const graded = (g: any) => ({ versionId: "v", loggedDate: "2026-09-01", regimeTagAtCall: "x", houseViewPathAtCall: "SECRET-PATH", keyFalsificationTriggers: ["SECRET-KFT"], grading: { gradedDate: "2026-10-10", didTriggersFire: null, actualFedAction: null, actualMarketReaction: null, notesOnWhatBrokeOrHeld: "SECRET-NOTES", lessonForNextVersion: null, ...g } });
const cryptoResult = () => ({
  methodVersion: "crypto-regime-v1", asOf: "2026-10-18T12:00:00Z",
  regime: { checks: [{ key: "us10y", label: "10-yr yield easing", reading: 4.1, unit: "yield", threshold: "Below 5.0%", status: "met" }, { key: "fear-greed", label: "Sentiment not euphoric", reading: null, unit: "index", threshold: "Below 80", status: "unavailable" }], met: 1, notMet: 0, unavailable: 1, total: 2, label: "undetermined", labelRange: { lowest: "range-bound", highest: "mixed" }, verdict: "Conditions favor a breakout" },
  inputs: {}, sources: [{ key: "us10y", label: "10-year yield", status: "ok", source: "Yahoo ^TNX", asOf: "2026-10-18" }, { key: "fear-greed", label: "Fear & Greed", status: "error", source: "alternative.me", detail: "SECRET-PROVIDER-ERROR https://x?key=abc" }],
  dataLimitations: ["type the month-to-date total from farside.co.uk/btc into the box"],
});
let cryptoCalls = 0;
function installEnv(over: any = {}) {
  cryptoCalls = 0;
  E.__setEnvironmentDepsForTests({
    outlookConfigured: () => true,
    outlook: async () => outlook(),
    scorecard: async () => [graded({ wasRegimeTagCorrect: true, wasHouseViewPathCorrect: false }), graded({ wasRegimeTagCorrect: true, wasHouseViewPathCorrect: true }), { ...graded({}), grading: { gradedDate: null } }],
    crypto: async () => { cryptoCalls++; return cryptoResult(); },
    today: () => "2026-10-18",
    ...over,
  });
}
installValuation();
installEnv();

// ------------------------------------------------------------------ access: bad slugs, unknown slugs, cookies
const routes = [
  ["index", (s: string, ck?: string, a?: string) => INDEX.GET(req(`/api/client/${s}/research`, ck, a), P(s))],
  ["holding", (s: string, ck?: string, a?: string) => HOLD.GET(req(`/api/client/${s}/research/holding/NVDA`, ck, a), P(s, "NVDA"))],
  ["environment", (s: string, ck?: string, a?: string) => ENVR.GET(req(`/api/client/${s}/research/environment`, ck, a), P(s))],
  ["method", (s: string, ck?: string, a?: string) => METH.GET(req(`/api/client/${s}/research/method`, ck, a), P(s))],
] as const;

test("bad slugs are rejected with 404 before any database call, on every route", async () => {
  const bad = ["", " ", "a b", "../x", "a;b", "x".repeat(200), "a%2Fb", "slug'--", "a,b", "a(b)"];
  dbCalls = 0;
  for (const [name, call] of routes) for (const s of bad) assert.equal((await call(s, ckA)).status, 404, `${name} ${JSON.stringify(s).slice(0, 30)}`);
  assert.equal(dbCalls, 0, "junk slugs never reach the database");
});

test("an unknown slug is 404 and a known slug without a valid cookie is 401, on every route", async () => {
  for (const [name, call] of routes) {
    assert.equal((await call("slugZZZZ9999", ckA)).status, 404, `${name} unknown`);
    for (const ck of [undefined, "", "client_session_slugAAAA1111=", "client_session_slugAAAA1111=garbage", "client_session_slugAAAA1111=v1.9999999999.00", `other=${ckA}`]) {
      const res = await call("slugAAAA1111", ck);
      assert.equal(res.status, 401, `${name} ${String(ck).slice(0, 40)}`);
      const body = await res.json();
      assert.equal(body.requiresPasscode, true);
      assert.ok(!JSON.stringify(body).includes("NVDA"));
    }
  }
  assert.equal(lifecycleCalls.length, 0, "no upstream work for an unauthenticated caller");
});

test("another client's cookie does not open this client's research, on every route, and nothing upstream runs", async () => {
  lifecycleCalls.length = 0;
  for (const [name, call] of routes) {
    // B's valid cookie presented for A's slug, in both spellings of the cookie name.
    assert.equal((await call("slugAAAA1111", ckB)).status, 401, `${name} B cookie`);
    assert.equal((await call("slugAAAA1111", `client_session_slugAAAA1111=${ckB.split("=")[1]}`)).status, 401, `${name} B token under A name`);
    assert.equal((await call("slugBBBB2222", ckA)).status, 401, `${name} A cookie on B`);
  }
  // A cookie issued before a passcode change (different stored hash) is revoked.
  const stale = await cookieFor("slugAAAA1111", "oldHashA");
  for (const [name, call] of routes) assert.equal((await call("slugAAAA1111", stale)).status, 401, `${name} revoked`);
  assert.equal(lifecycleCalls.length, 0);
});

test("the client's own cookie works on every route", async () => {
  for (const [name, call] of routes) assert.equal((await call("slugAAAA1111", ckA)).status, 200, name);
});

// ------------------------------------------------------------------ what a client may ask for
test("index lists only this client's holdings and carries no shares, cost, cash, hash or id", async () => {
  const res = await INDEX.GET(req("/api/client/slugAAAA1111/research", ckA), P("slugAAAA1111"));
  const text = await res.text();
  const body = JSON.parse(text);
  const symbols = body.holdings.map((h: any) => h.symbol);
  assert.deepEqual(symbols.sort(), ["AAPL", "BTC-USD", "EUR/USD", "NVDA", "NVDA250117C00100000"].sort(), "NVDA appears once though held in two lots; symbols are upper case");
  assert.ok(!symbols.includes("TSLA"), "B's stock is not in A's list");
  assert.equal(body.holdsCrypto, true);
  const valued = body.holdings.filter((h: any) => h.researchable).map((h: any) => h.symbol).sort();
  assert.deepEqual(valued, ["AAPL", "NVDA"]);
  for (const bad of ["1234.5", "77.77", "987654", "hashA", "id-A", "passcode", "shares", "cost"]) assert.ok(!text.includes(bad), `leaked ${bad}`);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
});

test("holding route: only this client's own stocks; another client's ticker, arbitrary tickers and odd input are 404 with no upstream call", async () => {
  installValuation();
  const ask = async (s: string, symbol: string, ck: string) => HOLD.GET(req(`/api/client/${s}/research/holding/${encodeURIComponent(symbol)}`, ck), P(s, encodeURIComponent(symbol)));
  for (const symbol of ["TSLA", "MSFT", "ZZZZ", "A;B", "../x", "NVDA%00", "<script>", "a b", "N".repeat(40), "", "BTC-USD", "NVDA250117C00100000", "EUR/USD", "1ABC", "-X"]) {
    assert.equal((await ask("slugAAAA1111", symbol, ckA)).status, 404, `A asks ${JSON.stringify(symbol)}`);
  }
  assert.equal((await ask("slugBBBB2222", "NVDA", ckB)).status, 404, "A's stock is not B's");
  assert.equal(lifecycleCalls.length, 0, "no upstream call for any refused ticker");
  assert.equal(quoteCalls.length, 0);
  const ok = await ask("slugAAAA1111", "nvda", ckA);
  assert.equal(ok.status, 200);
  const card = await ok.json();
  assert.equal(card.symbol, "NVDA");
  assert.equal(card.status, "ok");
  assert.equal(lifecycleCalls.length, 1);
  assert.match(lifecycleCalls[0], /ticker=NVDA/);
});

test("the browser cannot steer the upstream call: no query parameter is passed through", async () => {
  installValuation();
  const res = await HOLD.GET(req("/api/client/slugAAAA1111/research/holding/NVDA?ticker=TSLA&price=1&phase=5&rate=3&avgPE=1", ckA), P("slugAAAA1111", "NVDA"));
  assert.equal(res.status, 200);
  assert.equal(lifecycleCalls.length, 1);
  const u = new URL(lifecycleCalls[0]);
  assert.equal(u.searchParams.get("ticker"), "NVDA");
  assert.equal(u.searchParams.get("price"), "123.45", "the price is the server's own quote");
  for (const k of ["phase", "rate", "avgPE", "terminal", "years", "rule"]) assert.equal(u.searchParams.get(k), null, k);
});

test("count cap: only 12 stocks are valued per client, the rest are listed as not valued and cannot be asked for", async () => {
  installValuation();
  const idx = await (await INDEX.GET(req("/api/client/slugCCCC3333/research", ckC), P("slugCCCC3333"))).json();
  assert.equal(idx.cap, 12);
  assert.equal(idx.holdings.length, 15);
  assert.equal(idx.holdings.filter((h: any) => h.researchable).length, 12);
  const over = idx.holdings.filter((h: any) => !h.researchable);
  assert.equal(over.length, 3);
  assert.match(over[0].reason, /12/);
  assert.equal((await HOLD.GET(req(`/api/client/slugCCCC3333/research/holding/${over[0].symbol}`, ckC), P("slugCCCC3333", over[0].symbol))).status, 404);
  assert.equal((await HOLD.GET(req(`/api/client/slugCCCC3333/research/holding/${idx.holdings[0].symbol}`, ckC), P("slugCCCC3333", idx.holdings[0].symbol))).status, 200);
});

test("holdings reduction: options and crypto are not valued, an option's underlying only feeds the calendar", () => {
  const t = H.researchTargets(holdings["id-A"].map((r: any) => ({ id: r.id, symbol: r.symbol, assetClass: r.asset_class, underlyingSymbol: r.underlying_symbol })));
  assert.deepEqual(t.valuable.sort(), ["AAPL", "NVDA"]);
  assert.equal(t.holdsCrypto, true);
  assert.ok(t.catalystSymbols.equity.includes("NVDA"));
  assert.deepEqual(t.catalystSymbols.crypto, ["BTC-USD"]);
  assert.deepEqual(t.catalystSymbols.forex, ["EUR/USD"]);
  assert.equal(H.isResearchableFor(t, "TSLA"), false);
});

// ------------------------------------------------------------------ abuse limits
test("rate limits: per address and per client both answer 429 with Retry-After", async () => {
  const addr = "192.0.2.77";
  let last = 200;
  let first429 = -1;
  for (let i = 0; i < 100; i++) {
    const res = await METH.GET(req("/api/client/slugBBBB2222/research/method", ckB, addr), P("slugBBBB2222"));
    last = res.status;
    if (res.status === 429 && first429 < 0) {
      first429 = i;
      assert.ok(Number(res.headers.get("retry-after")) >= 1);
    }
  }
  assert.equal(last, 429);
  assert.ok(first429 > 0 && first429 <= 91, `per-address limit kicked in at request ${first429 + 1}`);

  // Per client: many addresses, one client link.
  let got429 = false;
  for (let i = 0; i < 140 && !got429; i++) {
    const res = await METH.GET(req("/api/client/slugCCCC3333/research/method", ckC, `192.0.2.${100 + (i % 100)}-${i}`), P("slugCCCC3333"));
    if (res.status === 429) got429 = true;
  }
  assert.ok(got429, "the per-client limit stops a spread-out flood");
});

test("rate limit runs before the database lookup, so junk traffic from one address cannot hammer the database", async () => {
  const addr = "192.0.2.201";
  for (let i = 0; i < 95; i++) await INDEX.GET(req("/api/client/slugGUESS" + i + "/research", undefined, addr), P("slugGUESS" + i));
  dbCalls = 0;
  for (let i = 0; i < 20; i++) assert.equal((await INDEX.GET(req("/api/client/slugGUESSX/research", undefined, addr), P("slugGUESSX"))).status, 429);
  assert.equal(dbCalls, 0);
});

test("kill switch: CLIENT_RESEARCH_ENABLED=false turns every route off with 503 before any work", async () => {
  process.env.CLIENT_RESEARCH_ENABLED = "false";
  dbCalls = 0;
  for (const [name, call] of routes) {
    const res = await call("slugAAAA1111", ckA);
    assert.equal(res.status, 503, name);
    assert.equal((await res.json()).disabled, true, "the page uses this flag to hide the whole section");
  }
  assert.equal(dbCalls, 0);
  delete process.env.CLIENT_RESEARCH_ENABLED;
});

test("cache: a ticker is fetched once for many clients and many requests; a second client holding it costs nothing", async () => {
  installValuation();
  holdings["id-B"].push(row("id-B", "NVDA", "equity"));
  for (let i = 0; i < 5; i++) await HOLD.GET(req("/api/client/slugAAAA1111/research/holding/NVDA", ckA), P("slugAAAA1111", "NVDA"));
  await HOLD.GET(req("/api/client/slugBBBB2222/research/holding/NVDA", ckB), P("slugBBBB2222", "NVDA"));
  assert.equal(lifecycleCalls.length, 1);
  holdings["id-B"].pop();
});

test("hourly budget: beyond the budget a new ticker answers 'busy' (never a silent blank) and a cached one still answers", async () => {
  installValuation({}, { budgetPerHour: 2 });
  const a = await V.getHoldingResearch("AAAA");
  const b = await V.getHoldingResearch("BBBB");
  const c = await V.getHoldingResearch("CCCC");
  assert.equal(a.status, "ok");
  assert.equal(b.status, "ok");
  assert.equal(c.status, "busy");
  assert.match(c.message, /busy/i);
  assert.equal(lifecycleCalls.length, 2);
  assert.equal((await V.getHoldingResearch("AAAA")).status, "ok", "cached ticker still served");
  installValuation();
});

test("failed upstream: a plain fixed message, never provider text; a failure is remembered briefly so a down provider is not hammered", async () => {
  installValuation({ lifecycle: async (url) => { lifecycleCalls.push(url); return new Response(JSON.stringify({ error: "SEC company facts request failed: <html>SECRET-KEY=abc</html>" }), { status: 500 }); } });
  const r1 = await V.getHoldingResearch("DOWN");
  const r2 = await V.getHoldingResearch("DOWN");
  assert.equal(r1.status, "unavailable");
  assert.ok(!JSON.stringify(r1).includes("SECRET"));
  assert.equal(r2.status, "unavailable");
  assert.equal(lifecycleCalls.length, 1, "the second ask did not call upstream again");

  installValuation({ lifecycle: async () => new Response(JSON.stringify({ error: "No SEC listing found for QQQ. Foreign or very new tickers may not have XBRL filings." }), { status: 500 }) });
  const f = await V.getHoldingResearch("QQQ");
  assert.equal(f.status, "no_filings");
  assert.match(f.message, /fund/i);

  installValuation({ lifecycle: async () => { throw new Error("socket hang up key=SECRET"); } });
  const t = await V.getHoldingResearch("BOOM");
  assert.equal(t.status, "unavailable");
  assert.ok(!JSON.stringify(t).includes("SECRET"));
  installValuation();
});

// ------------------------------------------------------------------ cache class
test("ResearchCache: in-flight sharing, ttl, stale fallback, negative cache, budget", async () => {
  let now = 1_000_000;
  const budget = new C.FetchBudget(3);
  const cache = new C.ResearchCache(1000, 10_000, budget, new C.Semaphore(2), () => now, 500);
  let calls = 0;
  const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return calls; };
  const [x, y, z] = await Promise.all([cache.get("k", slow), cache.get("k", slow), cache.get("k", slow)]);
  assert.equal(calls, 1, "three simultaneous asks share one fetch");
  assert.deepEqual([x.value, y.value, z.value], [1, 1, 1]);
  now += 500;
  assert.equal((await cache.get("k", slow)).value, 1, "fresh within ttl");
  now += 600;
  const fail = async () => { calls++; throw new Error("down"); };
  const s1 = await cache.get("k", fail);
  assert.equal(s1.stale, true, "failed refresh serves the last good value, marked stale");
  assert.equal(s1.value, 1);
  const callsAfterFail = calls;
  await cache.get("k", fail);
  assert.equal(calls, callsAfterFail, "failure remembered for the negative-cache window");
  now += 20_000;
  await assert.rejects(() => cache.get("k", fail), /down/, "too old to serve stale");
  await assert.rejects(() => cache.get("j", slow), (e: any) => e instanceof C.BusyError || /down/.test(String(e)), "budget of 3 is used up");
  const sem = new C.Semaphore(1);
  let running = 0;
  let peak = 0;
  await Promise.all([1, 2, 3, 4].map(() => sem.run(async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; })));
  assert.equal(peak, 1, "semaphore limits concurrency");
});

// ------------------------------------------------------------------ what leaves the server
test("holding card: client wording only (no 'attractive', no 'you', no statements), honest nulls, as-of and delay carried", async () => {
  installValuation();
  const card = V.shapeLifecycle("NVDA", RAW, { symbol: "NVDA", lastPrice: 123.45, totalVolume: 1, asOf: Date.parse("2026-10-18T14:30:00Z"), delayed: true, feed: "iex" }, Date.parse("2026-10-18T15:00:00Z"));
  const text = JSON.stringify(card);
  assert.equal(card.valuation.position, "well below");
  assert.equal(card.valuation.measures[0].position, "well below");
  assert.equal(card.phase.name, "Capital return");
  assert.equal(card.price.delayed, true);
  assert.equal(card.price.asOf, "2026-10-18T14:30:00.000Z");
  assert.equal(card.isEstimate, true);
  assert.equal(card.valuation.assumptions.length, 2, "only the two generic assumptions");
  for (const banned of [/attractive/i, /you are paying/i, /\bbuy\b/i, /\bsell\b/i, /undervalued/i, /overvalued/i, /bargain/i, /page-only/]) assert.ok(!banned.test(text), String(banned));
  const m = M.holdingMeaning(card);
  assert.match(m.valuationLine, /34% below its own average for the past 12 months/);
  assert.match(m.valuationLine, /does not say where the price goes next/);
  assert.match(m.phaseLine, /^Capital return phase\./);

  // Missing price history: no rating, a plain note, never a zero.
  const noHist = V.shapeLifecycle("NVDA", { ...RAW, rating: { ...RAW.rating, headline: null, averagePremiumPct: null, perMultiple: [], crossChecks: [] } }, null, 0);
  assert.equal(noHist.valuation.position, null);
  assert.match(M.holdingMeaning(noHist).valuationLine, /No price history/);
  const none = V.shapeLifecycle("NVDA", { ...RAW, valuation: null, rating: null, valuationNote: "No live price: Alpaca 401 <html>SECRET</html>. Add &price=" }, null, 0);
  assert.equal(none.valuation, null);
  assert.match(none.valuationNote, /No price is available/);
  assert.ok(!JSON.stringify(none).includes("SECRET"));
  assert.equal(none.price.asOf, null, "no quote time is claimed when the quote was not read here");
});

test("synthetic (mock-mode) prices never produce a valuation", () => {
  const card = V.shapeLifecycle("NVDA", RAW, { symbol: "NVDA", lastPrice: 1, totalVolume: 0, synthetic: true }, 0);
  assert.equal(card.valuation, null);
  assert.equal(card.price, null);
  assert.match(card.valuationNote, /not connected/);
});

test("environment: client-safe fields only; trading-desk fields, provider errors and grading notes never leave", async () => {
  installEnv();
  const res = await ENVR.GET(req("/api/client/slugAAAA1111/research/environment", ckA), P("slugAAAA1111"));
  assert.equal(res.status, 200);
  const text = await res.text();
  const env = JSON.parse(text);
  assert.equal(env.outlook.regime.label, "Late-cycle slowdown");
  assert.equal(env.outlook.regime.cyclePhase, "late expansion");
  assert.equal(env.outlook.glance, "Growth is slowing while inflation is sticky.");
  assert.equal(env.outlook.indicators[0].source, "BLS");
  assert.equal(env.outlook.policy.houseViewPath, "One cut by year end");
  assert.equal(env.outlook.upsideRisks[0].trigger, "Core CPI under 0.2%");
  assert.equal(env.stale, false);
  assert.ok(!/SECRET/.test(text), "no SECRET-* marker (tradingParameters, selfQa, gapAnalysis, feed, narrative, how-derived, notes, provider error) in the payload");
  assert.ok(!/tradingParameters|selfQa|falsification|triggerFeed|gapAnalysis|howDerived/.test(text));
  // scorecard: counts only
  assert.deepEqual(env.scorecard, { logged: 3, graded: 2, regimeRight: 2, regimeWrong: 0, pathRight: 1, pathWrong: 1 });
  // crypto: only because this client holds crypto; readings are formatted, errors are not passed on
  assert.equal(env.crypto.labelPlain, "Some inputs are missing, so the read is not clear.");
  assert.equal(env.crypto.sources.find((s: any) => s.label === "Fear & Greed").status, "not read");
  assert.equal(env.crypto.checks[1].reading, "not available");
  assert.ok(!/favor a breakout|farside/i.test(text));
  assert.equal(cryptoCalls, 1);
  // catalysts: from the checked-in calendar, for this client's kinds of holdings
  assert.ok(env.catalysts.events.length > 0);
  assert.ok(env.catalysts.events.every((e: any) => e.impact !== "low"));
  assert.ok(env.catalysts.events.some((e: any) => e.appliesTo.includes("NVDA")));
});

test("environment: a client without crypto never triggers the crypto fetch; upstream failures become plain notes", async () => {
  installEnv({ outlook: async () => { throw new Error("db password=SECRET"); }, crypto: async () => { cryptoCalls++; throw new Error("x"); } });
  const res = await ENVR.GET(req("/api/client/slugBBBB2222/research/environment", ckB), P("slugBBBB2222"));
  const env = await res.json();
  assert.equal(env.outlook, null);
  assert.match(env.outlookNote, /not available/);
  assert.equal(env.crypto, null);
  assert.equal(cryptoCalls, 0, "TSLA-only client does not cost a crypto read");
  assert.ok(!JSON.stringify(env).includes("SECRET"));
  assert.ok(env.catalysts.events.every((e: any) => e.appliesTo.includes("TSLA")));
  installEnv({ crypto: async () => { cryptoCalls++; throw new Error("boom SECRET"); } });
  const env2 = await (await ENVR.GET(req("/api/client/slugAAAA1111/research/environment", ckA), P("slugAAAA1111"))).json();
  assert.match(env2.cryptoNote, /not available/);
  assert.ok(!JSON.stringify(env2).includes("SECRET"));
  installEnv();
});

test("scorecard with nothing graded says so instead of inventing a record", () => {
  assert.deepEqual(E.summarizeScorecard([]), { logged: 0, graded: 0, regimeRight: 0, regimeWrong: 0, pathRight: 0, pathWrong: 0 });
  assert.equal(E.summarizeScorecard([{ ...graded({}), grading: { gradedDate: null } }]).graded, 0);
});

// ------------------------------------------------------------------ wording
test("method explainer is built from the tools' own constants and holds no advice words; plain text reads at grade 8 or lower", () => {
  const m = X.buildMethodExplainer();
  const all = JSON.stringify(m);
  assert.match(all, /9% discount rate/, "DISCOUNT_RATE_PCT from valuation-methods.ts");
  assert.match(all, /2\.5% growth after year 5/, "TERMINAL_GROWTH_PCT and DCF_PROJECTION_YEARS");
  assert.match(all, /capped at 15% a year/, "MAX_GROWTH_ASSUMPTION_PCT");
  assert.equal(m.phases.length, 5);
  assert.equal(m.methods.length, 5);
  assert.equal(m.positions.length, 5);
  assert.ok(m.words.some((w: any) => w.fullDefinition), "glossary definitions are carried");
  // Text written for clients gets the full set. The glossary's own definitions (collapsed, from glossary.ts) say "cheap" about borrowing, so they get the stock-advice words only.
  const written = JSON.stringify({ ...m, words: m.words.map((w: any) => ({ term: w.term, plain: w.plain })) });
  for (const banned of [/attractive/i, /undervalued/i, /overvalued/i, /\bbargain/i, /\bcheap/i, /should invest/i, /\brecommend/i, /\bbuy\b/i, /\bsell\b/i]) assert.ok(!banned.test(written), String(banned));
  for (const banned of [/attractive/i, /undervalued/i, /overvalued/i, /should invest/i, /\brecommend/i]) assert.ok(!banned.test(all), String(banned));
  assert.ok(m.open.some((o: string) => /Volatility forecasts/.test(o)), "the blocked volatility model is listed as open, not faked");
  assert.ok(!/VRP|implied volatility.*coming/i.test(all.replace(/past implied volatility/i, "")));
  // Reading level of the text written for clients (the glossary's own definitions are the tools' text and are collapsed).
  const prose = [...m.steps.map((s: any) => s.title + ". " + s.body), ...m.phases.map((p: any) => p.plain), ...m.methods.map((x: any) => x.plain + " " + x.assumes), ...m.words.map((w: any) => w.plain), ...m.limits, ...m.open];
  const stats = RL.readingStats(prose.join(" "));
  assert.ok(stats.fk <= 8.0, `method text FK grade ${stats.fk.toFixed(2)} must be 8.0 or lower`);
});

test("clientWords: price words become neutral, 'this page' becomes 'our', sentences that speak to 'you' are dropped, numbers untouched", () => {
  assert.equal(V.clientWords("A low P/E on peak margins can look cheaper than it is."), "A low P/E on peak margins can look lower priced than it is.");
  assert.equal(V.clientWords("can look cheap or dear against a year that was itself unusual."), "can look high or low against a year that was itself unusual.");
  assert.equal(V.clientWords("on this page's bands (under 6% low)"), "on our bands (under 6% low)");
  assert.equal(V.clientWords("On a yield basis you are paying for growth, not income."), null);
  assert.equal(V.clientWords("Your shares are worth 12.5% more."), null);
  const card = V.shapeLifecycle("NVDA", { ...RAW, rating: { ...RAW.rating, crossChecks: [
    { title: "What growth the price assumes", detail: "The price needs about 3.1% a year (low demand on this page's bands).", direction: "context" },
    { title: "Margins above their own average", detail: "If margins fell back, the P/E would be 30.0x instead of 20.0x. A low P/E on peak margins can look cheaper than it is.", direction: "tempers" },
    { title: "Spoken to the reader", detail: "You should look at this.", direction: "context" },
  ] } }, null, 0);
  assert.deepEqual(card.valuation.otherThings.map((o: any) => o.title), ["Margins above their own average"], "duplicate and 'you' checks are not listed");
  assert.match(card.valuation.otherThings[0].detail, /lower priced than it is/);
  assert.match(card.valuation.otherThings[0].detail, /30\.0x instead of 20\.0x/);
});

test("track record text: always states the sample size; none graded and few graded are said plainly; no percentages from a handful", () => {
  const base = { logged: 0, graded: 0, regimeRight: 0, regimeWrong: 0, pathRight: 0, pathWrong: 0 };
  const none = M.trackRecordText({ ...base, logged: 2 });
  assert.match(none, /2 outlook calls, and none has been graded yet/);
  assert.match(none, /untested/);
  const few = M.trackRecordText({ logged: 4, graded: 3, regimeRight: 2, regimeWrong: 1, pathRight: 1, pathWrong: 2 });
  assert.match(few, /graded only 3/);
  assert.match(few, /2 of 3 graded were right/);
  assert.match(few, /too few to say/);
  assert.ok(!/%/.test(few), "no percentage from three calls");
  const one = M.trackRecordText({ ...base, logged: 1 });
  assert.match(one, /1 outlook call,/);
  const many = M.trackRecordText({ logged: 14, graded: 12, regimeRight: 9, regimeWrong: 3, pathRight: 6, pathWrong: 6 });
  assert.match(many, /graded 12/);
  assert.match(many, /9 of 12/);
  assert.doesNotMatch(many, /too few/);
  assert.match(many, /do not promise future ones/);
  assert.ok(RL.readingStats([none, few, many].join(" ")).fk <= 8.0, "reads at grade 8 or lower");
});

test("ClientResearchView source: the model-written rate path is labelled as a model estimate with an as-of date and not-advice wording", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/components/ClientResearchView.tsx", import.meta.url), "utf8");
  assert.match(src, /Model estimate/);
  assert.match(src, /Our model&rsquo;s estimate of the rate path/);
  assert.match(src, /It is not a promise, it can be wrong, and it is not advice/);
  assert.match(src, /Model estimate as of \{o\.asOfDate\}/);
  assert.ok(!/Our own estimate of the path/.test(src), "the old unlabelled wording is gone");
});

test("ClientDashboardView source: Research is a section of the Portfolio view (no tab), the News panel sits under it, kill switch hides the section", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/components/ClientDashboardView.tsx", import.meta.url), "utf8");
  assert.ok(!/role="tab/.test(src) && !/role="tablist"/.test(src), "no tabs");
  const iPnl = src.indexOf("<RealizedPnlPanel");
  const iRes = src.indexOf("<ClientResearchView");
  const iNews = src.indexOf("<ClientNewsPanel");
  const iFoot = src.indexOf("not investment advice");
  assert.ok(iPnl > 0 && iPnl < iRes && iRes < iNews && iNews < iFoot, "order: portfolio, research, news, footer");
  const comp = readFileSync(new URL("../src/components/ClientResearchView.tsx", import.meta.url), "utf8");
  assert.match(comp, /index\.state === "disabled"\) return null/);
});
