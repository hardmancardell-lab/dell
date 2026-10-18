// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/news-hub.test.mts
// News hub: dedupe, time parsing, plain-language errors, empty and error states, caching, caps, and the client route's
// access order. No network: every fetch is a fake and any other URL throws. No key is read or needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
delete process.env.FMP_API_KEY; // the "no key" case
process.env.SEC_EDGAR_USER_AGENT = "Test test@example.com";

const SENTINEL_KEY = "SENTINEL_SECRET_KEY_12345";

// ---- fake network --------------------------------------------------------------------------------------------
type Handler = (url: string) => Response | Promise<Response> | null;
let handlers: Handler[] = [];
const calls: string[] = [];
globalThis.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  calls.push(url);
  for (const h of handlers) {
    const r = await h(url);
    if (r) return r;
  }
  throw new Error("BLOCKED " + url);
}) as any;

const rss = (items: { title: string; link: string; pubDate?: string; description?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ""}<description>${i.description ?? ""}</description></item>`)
    .join("")}</channel></rss>`;
const xml = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } });

const C = await import("../src/lib/news/news-core.ts");
const H = await import("../src/lib/news/news-hub.ts");
const P = await import("../src/lib/data/provider-http.ts");
P.setProviderSleep(async () => {});

const item = (o: any = {}) => ({ title: "Fed holds rates steady as inflation cools", url: "https://a.example/1", source: "A", provider: "RSS", publishedAt: "2026-10-18T12:00:00.000Z", timeKind: "published", kind: "news", ...o });

// ---- core: cleaning and links --------------------------------------------------------------------------------
test("cleanTitle strips tags, entities and control characters and caps the length", () => {
  assert.equal(C.cleanTitle("<b>Stocks</b> &amp; bonds&nbsp;rally\u0007"), "Stocks & bonds rally");
  assert.equal(C.cleanTitle(null), "");
  assert.ok(C.cleanTitle("x".repeat(500)).length <= C.MAX_TITLE_CHARS);
});

test("safeHttpUrl accepts http(s) only and drops javascript:, data:, file: and credentials", () => {
  assert.ok(C.safeHttpUrl("https://example.com/a?b=1"));
  assert.equal(C.safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(C.safeHttpUrl("data:text/html,hi"), null);
  assert.equal(C.safeHttpUrl("file:///etc/passwd"), null);
  assert.equal(C.safeHttpUrl("https://user:pw@example.com/"), null);
  assert.equal(C.safeHttpUrl(""), null);
  assert.equal(C.safeHttpUrl("not a url"), null);
});

test("stripTracking removes tracking parameters and keeps real ones", () => {
  assert.equal(C.stripTracking("https://x.com/a?id=5&utm_source=z&.tsrc=rss"), "https://x.com/a?id=5");
});

// ---- core: times -----------------------------------------------------------------------------------------------
test("parseFeedTime reads RFC 822, ISO, GDELT compact and date-only; rejects junk, far future and pre-2000", () => {
  const now = Date.parse("2026-10-18T15:00:00Z");
  assert.equal(C.parseFeedTime("Sat, 17 Oct 2026 20:07:00 +0000", now).iso, "2026-10-17T20:07:00.000Z");
  assert.equal(C.parseFeedTime("Sat, 17 Oct 2026 20:07:00 GMT", now).iso, "2026-10-17T20:07:00.000Z");
  assert.equal(C.parseFeedTime("2026-10-17T20:07:00-04:00", now).iso, "2026-10-18T00:07:00.000Z");
  assert.equal(C.parseFeedTime("20261017T200700Z", now).iso, "2026-10-17T20:07:00.000Z");
  assert.deepEqual(C.parseFeedTime("2026-10-17", now), { iso: "2026-10-17T00:00:00.000Z", dateOnly: true });
  assert.equal(C.parseFeedTime("2026-10-17 14:05:00", now).iso, "2026-10-17T14:05:00.000Z", "no zone is read as UTC, not server local time");
  for (const bad of [null, undefined, "", "yesterday", "2027-03-01T00:00:00Z", "1999-01-01T00:00:00Z"]) assert.equal(C.parseFeedTime(bad, now), null, String(bad));
});

test("describeNewsTime says what the time means", () => {
  const now = Date.parse("2026-10-18T15:00:00Z");
  const base = item({ publishedAt: "2026-10-18T12:00:00.000Z" });
  assert.match(C.describeNewsTime(base, now, "America/New_York"), /^Oct 18, 8:00 AM EDT \(3 h ago\)$/);
  assert.match(C.describeNewsTime({ ...base, timeKind: "seen", provider: "GDELT" }, now, "UTC"), /^First seen by GDELT /);
  assert.equal(C.describeNewsTime({ ...base, timeKind: "date", publishedAt: "2026-10-17T00:00:00.000Z" }, now), "Oct 17, 2026 (date only)");
  assert.equal(C.describeNewsTime({ ...base, publishedAt: null }, now), "Time not given");
  assert.equal(C.relativeAge("2026-10-18T14:59:30.000Z", now), "just now");
  assert.equal(C.relativeAge("2026-10-18T14:30:00.000Z", now), "30 min ago");
  assert.equal(C.relativeAge("2026-10-10T14:30:00.000Z", now), "8 days ago");
});

// ---- core: dedupe ----------------------------------------------------------------------------------------------
test("dedupe merges the same story across outlets and records who else carried it", () => {
  const out = C.dedupeNews([
    item({ source: "A", url: "https://a.example/1", title: "Fed holds rates steady as inflation cools", publishedAt: "2026-10-18T10:00:00.000Z" }),
    item({ source: "B", url: "https://b.example/9", title: "Fed holds rates steady as inflation cools - B News", publishedAt: "2026-10-18T11:00:00.000Z" }),
    item({ source: "C", url: "https://c.example/7", title: "Fed Holds Rates Steady As Inflation Cools", publishedAt: "2026-10-18T09:00:00.000Z" }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].source, "B", "newest copy is the main entry");
  assert.deepEqual(new Set(out[0].alsoFrom), new Set(["A", "C"]));
});

test("dedupe merges near-identical wording (similarity at or above 0.8) but not different stories", () => {
  const a = item({ title: "Apple unveils new iPhone with faster chip and better camera", url: "https://a.example/a" });
  const b = item({ source: "B", title: "Apple unveils new iPhone with faster chip, better camera", url: "https://b.example/b" });
  const c = item({ source: "C", title: "Apple faces antitrust ruling in Europe over App Store fees", url: "https://c.example/c" });
  const out = C.dedupeNews([a, b, c]);
  assert.equal(out.length, 2);
  assert.ok(out.some((x) => x.alsoFrom?.includes("B")));
  assert.ok(out.some((x) => x.source === "C"));
});

test("dedupe merges the same page reached with and without tracking parameters or www", () => {
  const out = C.dedupeNews([
    item({ title: "Oil jumps on supply worries", url: "https://www.x.com/news/oil/?utm_source=a" }),
    item({ source: "B", title: "Totally different words here today", url: "https://x.com/news/oil" }),
  ]);
  assert.equal(out.length, 1);
});

test("dedupe never fuzzy-merges short titles, and keeps genuinely different headlines", () => {
  const out = C.dedupeNews([
    item({ title: "Oil rises", url: "https://a.example/1" }),
    item({ title: "Oil falls", url: "https://a.example/2" }),
    item({ title: "Gold hits record", url: "https://a.example/3" }),
  ]);
  assert.equal(out.length, 3);
});

test("dedupe drops items with no title or an unsafe link, sorts newest first and puts undated last", () => {
  const out = C.dedupeNews([
    item({ title: "Older story about copper prices and mines", url: "https://a.example/o", publishedAt: "2026-10-01T00:00:00.000Z" }),
    item({ title: "Undated story about wheat harvest and exports", url: "https://a.example/u", publishedAt: null }),
    item({ title: "Newest story about chip export rules and tariffs", url: "https://a.example/n", publishedAt: "2026-10-18T00:00:00.000Z" }),
    item({ title: "Bad link story about banks and capital rules here", url: "javascript:alert(1)" }),
    item({ title: "", url: "https://a.example/empty" }),
  ]);
  assert.deepEqual(out.map((i) => i.url), ["https://a.example/n", "https://a.example/o", "https://a.example/u"]);
});

test("dedupe of an empty list is an empty list", () => assert.deepEqual(C.dedupeNews([]), []));

// ---- core: what's moving ---------------------------------------------------------------------------------------
test("findTrendingTopics needs 3 outlets, ignores generic words, and counts merged outlets", () => {
  const items = [
    item({ source: "A", url: "https://a.example/1", title: "Nvidia chip export curbs rattle suppliers" }),
    item({ source: "B", url: "https://b.example/2", title: "Why Nvidia shares slid after the export curbs" }),
    item({ source: "C", url: "https://c.example/3", title: "Nvidia earnings loom as investors weigh export curbs" }),
    item({ source: "D", url: "https://d.example/4", title: "Gold edges higher in quiet trading" }),
  ];
  const t = C.findTrendingTopics(items, { minOutlets: 3 });
  assert.ok(t.length >= 1);
  assert.ok(t.some((x) => /nvidia|export/.test(x.term)));
  assert.ok(t.every((x) => x.outlets >= 3));
  assert.ok(!t.some((x) => ["stock", "market", "the"].includes(x.term)));
  assert.ok(t[0].examples.length > 0 && t[0].examples.every((e) => e.url && e.source));
  assert.deepEqual(C.findTrendingTopics(items.slice(0, 2), { minOutlets: 3 }), [], "two outlets is not enough");
  assert.deepEqual(C.findTrendingTopics([]), []);
});

// ---- core: errors never leak ----------------------------------------------------------------------------------
test("friendlyError gives one plain sentence and never repeats the raw message, a path or a key", () => {
  const raw = new Error(`FMP request failed for /news/stock?apikey=${SENTINEL_KEY}: 401 {"Error Message":"Invalid API KEY"}`);
  const msg = C.friendlyError(raw, "FMP");
  assert.ok(!msg.includes(SENTINEL_KEY) && !msg.includes("/news") && !msg.includes("{"));
  assert.match(msg, /valid key or a paid plan/);
  assert.match(C.friendlyError(new Error("FMP_API_KEY is not set. Add your key to .env.local"), "FMP"), /not set up yet/);
  assert.match(C.friendlyError(new Error("GDELT request failed: 429 Please limit requests"), "GDELT"), /limiting requests/);
  assert.match(C.friendlyError(new Error("request timed out after 9 s"), "X"), /too long/);
  assert.match(C.friendlyError(new Error("answered 404"), "Feed"), /no longer has/);
  assert.equal(C.friendlyError(new Error("weird"), "Thing"), "Thing did not answer.");
  assert.ok(!/\.env/.test(C.friendlyError(new Error("FMP_API_KEY is not set. Add your key to .env.local"), "FMP")), "no developer instructions for end users");
});

test("toYahooSymbol and isHubSymbol", () => {
  assert.equal(C.toYahooSymbol("EUR/USD", "forex"), "EURUSD=X");
  assert.equal(C.toYahooSymbol("btc/usd", "crypto"), "BTC-USD");
  assert.equal(C.toYahooSymbol("aapl", "equity"), "AAPL");
  for (const ok of ["AAPL", "BRK.B", "EUR/USD", "^GSPC", "GC=F", "BTC-USD"]) assert.ok(C.isHubSymbol(ok), ok);
  for (const bad of ["", " ", "A B", "AAPL;DROP", "x".repeat(30), "../etc", "<script>", null, 5]) assert.ok(!C.isHubSymbol(bad), String(bad));
});

test("TtlCache serves a hit, shares an in-flight load, expires, and does not cache a failure", async () => {
  let t = 0;
  const now = () => t;
  const cache = new C.TtlCache(1000);
  let loads = 0;
  const load = async () => {
    loads += 1;
    return loads;
  };
  const [a, b] = await Promise.all([cache.get("k", load, now), cache.get("k", load, now)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(loads, 1, "two simultaneous callers share one load");
  assert.equal(await cache.get("k", load, now), 1);
  t = 1500;
  assert.equal(await cache.get("k", load, now), 2, "expired");
  let boom = true;
  const flaky = async () => {
    if (boom) throw new Error("down");
    return "ok";
  };
  await assert.rejects(cache.get("f", flaky, now));
  boom = false;
  assert.equal(await cache.get("f", flaky, now), "ok", "a failure was not remembered");
});

// ---- hub: market -----------------------------------------------------------------------------------------------
const feedFor = (hosts: Record<string, Response | (() => Response)>): Handler => (url) => {
  for (const [needle, r] of Object.entries(hosts)) if (url.includes(needle)) return typeof r === "function" ? r() : r.clone();
  return null;
};

test("market: every outlet down gives an honest error state, lists each reason, and is not cached", async () => {
  H.clearNewsHubCaches();
  handlers = [() => new Response("nope", { status: 503 })];
  const s = await H.getMarketNews();
  assert.equal(s.items.length, 0);
  assert.match(s.error, /No outlet answered/);
  assert.ok(s.sources.length >= 5 && s.sources.every((x) => !x.ok && x.note));
  assert.ok(s.sources.every((x) => !/https?:|\.xml|feed\b.*503/.test(x.note)), "no raw URLs or status lines in notes");
  // recovery: a later success must not be blocked by a cached failure
  handlers = [(url) => xml(rss([{ title: "Markets open higher on jobs data and earnings", link: "https://cnbc.example/a", pubDate: "Sun, 18 Oct 2026 13:00:00 GMT" }]))];
  const again = await H.getMarketNews();
  assert.equal(again.error, null);
  assert.ok(again.items.length >= 1);
});

test("market: partial outage still shows headlines, says how many outlets answered, and keeps only headline, link, outlet and time", async () => {
  H.clearNewsHubCaches();
  handlers = [
    feedFor({
      "cnbc.com": xml(
        rss([
          { title: "Fed holds rates steady as inflation cools", link: "https://www.cnbc.com/a?utm_source=x", pubDate: "Sun, 18 Oct 2026 13:00:00 GMT", description: "FULL ARTICLE BODY SHOULD NEVER APPEAR" },
          { title: "Bad scheme", link: "javascript:alert(1)", pubDate: "Sun, 18 Oct 2026 12:00:00 GMT" },
        ])
      ),
      "dowjones.io": xml(rss([{ title: "Fed holds rates steady as inflation cools - MarketWatch", link: "https://www.marketwatch.com/b", pubDate: "Sun, 18 Oct 2026 13:30:00 GMT" }])),
    }),
    () => new Response("down", { status: 500 }),
  ];
  const s = await H.getMarketNews();
  assert.equal(s.error, null);
  assert.equal(s.items.length, 1, "same story from two outlets is shown once");
  assert.ok(s.items[0].alsoFrom?.length === 1);
  assert.ok(s.notes.some((n) => /outlets answered/.test(n)));
  const json = JSON.stringify(s);
  assert.ok(!json.includes("FULL ARTICLE BODY"), "article text is dropped");
  assert.ok(!json.includes("javascript:"));
  assert.ok(!json.includes("utm_source"), "tracking removed from the outbound link");
  for (const it of s.items) {
    assert.ok(it.title && it.url.startsWith("http") && it.source && it.provider);
    assert.ok(it.publishedAt === null || !Number.isNaN(Date.parse(it.publishedAt)));
  }
  assert.ok(s.sources.every((x) => typeof x.what === "string" && x.what.length > 10), "each source says what it is");
  assert.ok(Array.isArray(s.trending));
});

test("market: a second call inside the cache window does not call the network again", async () => {
  H.clearNewsHubCaches();
  handlers = [(url) => xml(rss([{ title: "Oil slips as stockpiles build more than forecast", link: "https://x.example/o", pubDate: "Sun, 18 Oct 2026 13:00:00 GMT" }]))];
  calls.length = 0;
  await H.getMarketNews();
  const first = calls.length;
  await H.getMarketNews();
  assert.ok(first > 0);
  assert.equal(calls.length, first);
});

// ---- hub: ticker -----------------------------------------------------------------------------------------------
const yahoo = (items: any[]) => (url: string) => (url.includes("feeds.finance.yahoo.com") ? xml(rss(items)) : null);
const secOff: Handler = (url) => (url.includes("sec.gov") ? new Response("down", { status: 500 }) : null);

test("ticker with no FMP key: Yahoo headlines still show, FMP is reported off in plain words, no developer text", async () => {
  H.clearNewsHubCaches();
  handlers = [yahoo([{ title: "Apple unveils new home device with built in assistant", link: "https://www.fool.com/a?.tsrc=rss", pubDate: "Sat, 17 Oct 2026 20:07:00 +0000" }]), secOff];
  const s = await H.getTickerNews("aapl", "equity");
  assert.equal(s.error, null);
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].source, "fool.com");
  assert.equal(s.items[0].provider, "Yahoo Finance feed");
  const fmp = s.sources.find((x) => x.name === "FMP company news");
  assert.equal(fmp.ok, false);
  assert.match(fmp.note, /not set up yet/);
  assert.ok(!JSON.stringify(s).includes(".env"));
  assert.ok(s.notes.some((n) => /FMP is off/.test(n)));
  assert.ok(s.sources.every((x) => x.what.length > 10));
});

test("ticker with a refused FMP key (401) says it needs a valid key, and never echoes the key or the provider body", async () => {
  H.clearNewsHubCaches();
  process.env.FMP_API_KEY = SENTINEL_KEY;
  try {
    handlers = [
      (url) => (url.includes("financialmodelingprep.com") ? new Response(JSON.stringify({ "Error Message": "Invalid API KEY." }), { status: 401 }) : null),
      yahoo([{ title: "Microsoft cloud demand lifts outlook for the next quarter", link: "https://example.com/m", pubDate: "Sat, 17 Oct 2026 18:00:00 +0000" }]),
      secOff,
    ];
    const s = await H.getTickerNews("MSFT", "equity");
    const fmp = s.sources.find((x) => x.name === "FMP company news");
    assert.equal(fmp.ok, false);
    assert.match(fmp.note, /valid key or a paid plan/);
    const json = JSON.stringify(s);
    assert.ok(!json.includes(SENTINEL_KEY), "key must never appear in a response");
    assert.ok(!json.includes("apikey"));
    assert.equal(s.items.length, 1);
  } finally {
    delete process.env.FMP_API_KEY;
  }
});

test("ticker: FMP news and SEC filings merge in, filings are date-only, FMP times are date-only", async () => {
  H.clearNewsHubCaches();
  process.env.FMP_API_KEY = SENTINEL_KEY;
  try {
    handlers = [
      (url) => (url.includes("/news/stock") ? new Response(JSON.stringify([{ symbol: "NVDA", publishedDate: "2026-10-17 14:05:00", title: "Nvidia supplier warns on demand for older chips", site: "reuters.com", url: "https://reuters.com/x" }]), { status: 200 }) : null),
      (url) => (url.includes("/news/press-releases") ? new Response(JSON.stringify([]), { status: 200 }) : null),
      (url) => (url.includes("company_tickers.json") ? new Response(JSON.stringify({ 0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA" } }), { status: 200 }) : null),
      (url) =>
        url.includes("data.sec.gov/submissions")
          ? new Response(JSON.stringify({ filings: { recent: { form: ["8-K"], filingDate: ["2026-10-16"], accessionNumber: ["0001045810-26-000001"], primaryDocument: ["a.htm"] } } }), { status: 200 })
          : null,
      yahoo([]),
    ];
    const s = await H.getTickerNews("NVDA", "equity");
    assert.equal(s.error, null);
    const fmp = s.items.find((i) => i.provider === "FMP");
    const sec = s.items.find((i) => i.provider === "SEC EDGAR");
    assert.ok(fmp && sec, JSON.stringify(s.sources));
    assert.equal(fmp.timeKind, "date");
    assert.equal(fmp.publishedAt, "2026-10-17T00:00:00.000Z");
    assert.equal(sec.timeKind, "date");
    assert.equal(sec.kind, "filing");
    assert.equal(sec.source, "SEC EDGAR");
    assert.ok(sec.url.startsWith("https://"));
    assert.ok(!JSON.stringify(s).includes(SENTINEL_KEY));
  } finally {
    delete process.env.FMP_API_KEY;
  }
});

test("ticker: nothing anywhere gives an honest empty-or-off message, not a blank list", async () => {
  H.clearNewsHubCaches();
  handlers = [yahoo([]), secOff];
  const s = await H.getTickerNews("ZZZZQQ", "equity");
  assert.equal(s.items.length, 0);
  assert.match(s.error, /No source returned headlines/);
  assert.ok(s.sources.length >= 2);
});

test("ticker: Yahoo down gives a plain reason", async () => {
  H.clearNewsHubCaches();
  handlers = [(url) => (url.includes("yahoo") ? new Response("x", { status: 503 }) : null), secOff];
  const s = await H.getTickerNews("SPY", "equity");
  assert.ok(s.error);
  const y = s.sources.find((x) => x.name === "Yahoo Finance feed");
  assert.equal(y.ok, false);
  assert.ok(y.note && !/https?:/.test(y.note));
});

test("ticker: unsupported asset class and crypto/forex without background make no GDELT call", async () => {
  H.clearNewsHubCaches();
  calls.length = 0;
  handlers = [yahoo([{ title: "Euro firms against the dollar after ECB comments today", link: "https://example.com/e", pubDate: "Sat, 17 Oct 2026 18:00:00 +0000" }])];
  const bond = await H.getTickerNews("US10Y", "bond");
  assert.match(bond.error, /no news source for bond/i);
  const fx = await H.getTickerNews("EUR/USD", "forex");
  assert.equal(fx.items.length, 1);
  assert.ok(calls.some((u) => u.includes("EURUSD%3DX")));
  assert.ok(!calls.some((u) => u.includes("gdeltproject")), "GDELT is only called when background is requested");
});

test("ticker background: GDELT rate limit shows a plain note, items are labelled 'first seen'", async () => {
  H.clearNewsHubCaches();
  handlers = [yahoo([]), (url) => (url.includes("gdeltproject") ? new Response("Please limit requests to one every 5 seconds", { status: 429 }) : null)];
  const t0 = Date.now();
  const s = await H.getTickerNews("EUR/USD", "forex", true);
  assert.ok(Date.now() - t0 < 60_000);
  const g = s.sources.find((x) => x.name === "GDELT background");
  assert.ok(g, JSON.stringify(s.sources));
  assert.equal(g.ok, false);
  assert.match(g.note, /limiting requests|did not answer|nothing/i);
  assert.match(g.what, /not when it was published/);
});

// ---- hub: watchlist --------------------------------------------------------------------------------------------
test("watchlist: empty list, only-unsupported list, and invalid symbols give clear states", async () => {
  H.clearNewsHubCaches();
  handlers = [];
  const empty = await H.getWatchlistNews([]);
  assert.match(empty.error, /list is empty/);
  const bonds = await H.getWatchlistNews([{ symbol: "US10Y", assetClass: "bond" }]);
  assert.match(bonds.error, /None of the symbols/);
  assert.equal(bonds.skipped.length, 1);
  const bad = await H.getWatchlistNews([{ symbol: "AAPL;DROP", assetClass: "equity" }, { symbol: "<x>", assetClass: "equity" }]);
  assert.equal(bad.groups.length, 0);
  assert.equal(bad.skipped.length, 2);
  assert.equal(calls.filter((u) => u.includes("AAPL%3BDROP")).length, 0, "a bad symbol never reaches the network");
});

test("watchlist: caps at 12 symbols, dedupes repeats, and runs at most 4 requests at once", async () => {
  H.clearNewsHubCaches();
  let active = 0;
  let peak = 0;
  handlers = [
    async (url) => {
      if (!url.includes("yahoo")) return null;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      const sym = decodeURIComponent(new URL(url).searchParams.get("s"));
      return xml(rss([{ title: `${sym} announces quarterly results and new product line`, link: `https://example.com/${sym}`, pubDate: "Sat, 17 Oct 2026 18:00:00 +0000" }]));
    },
  ];
  const entries = Array.from({ length: 20 }, (_, i) => ({ symbol: `T${i}`, assetClass: "equity" }));
  entries.push({ symbol: "t0", assetClass: "equity" });
  const s = await H.getWatchlistNews(entries);
  assert.equal(s.groups.length, 12);
  assert.equal(s.skipped.length, 8);
  assert.ok(peak <= 4, `peak concurrency ${peak}`);
  assert.ok(s.groups.every((g) => g.items.length === 1 && g.items[0].url.startsWith("https://example.com/")));
});

test("watchlist: one failing symbol does not hide the others; all failing gives an error state", async () => {
  H.clearNewsHubCaches();
  handlers = [(url) => (url.includes("s=BAD") ? new Response("x", { status: 503 }) : url.includes("yahoo") ? xml(rss([{ title: "Good symbol posts steady growth in new quarter", link: "https://example.com/g", pubDate: "Sat, 17 Oct 2026 18:00:00 +0000" }])) : null)];
  const mixed = await H.getWatchlistNews([{ symbol: "GOOD", assetClass: "equity" }, { symbol: "BAD", assetClass: "equity" }]);
  assert.equal(mixed.error, null);
  assert.equal(mixed.groups.find((g) => g.symbol === "GOOD").items.length, 1);
  const bad = mixed.groups.find((g) => g.symbol === "BAD");
  assert.equal(bad.items.length, 0);
  assert.ok(bad.note && !/https?:/.test(bad.note));
  H.clearNewsHubCaches();
  handlers = [() => new Response("x", { status: 503 })];
  const all = await H.getWatchlistNews([{ symbol: "BAD", assetClass: "equity" }, { symbol: "BAD2", assetClass: "crypto" }]);
  assert.match(all.error, /did not answer for any symbol/);
});

// ---- routes ----------------------------------------------------------------------------------------------------
test("hub route validates input and rate limits", async () => {
  const R = await import("../src/app/api/news-hub/route.ts");
  const mk = (qs: string, ip: string) => new Request("http://x.test/api/news-hub?" + qs, { headers: { "x-real-ip": ip } });
  assert.equal((await R.GET(mk("section=nope", "203.0.113.1"))).status, 400);
  assert.equal((await R.GET(mk("section=ticker&ticker=AAPL;x&assetClass=equity", "203.0.113.1"))).status, 400);
  assert.equal((await R.GET(mk("section=ticker&ticker=AAPL&assetClass=banana", "203.0.113.1"))).status, 400);
  const post = (body: any, ip = "203.0.113.2") => R.POST(new Request("http://x.test/api/news-hub", { method: "POST", headers: { "x-real-ip": ip, "content-type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ entries: Array.from({ length: 500 }, () => ({ symbol: "A", assetClass: "equity" })) })).status, 400);
  let last = 200;
  for (let i = 0; i < 45; i += 1) last = (await R.GET(mk("section=nope", "203.0.113.9"))).status;
  assert.equal(last, 429, "40 per minute per address");
});

test("client news route: bad link id and unknown client are 404 and read no holdings", async () => {
  const R = await import("../src/app/api/client/[slug]/news/route.ts");
  const seen: string[] = [];
  handlers = [
    (url) => {
      if (!url.startsWith("https://fake.supabase.test")) return null;
      seen.push(url);
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    },
  ];
  const req = (ip: string) => new Request("http://x.test/api/client/x/news", { headers: { "x-real-ip": ip } });
  const bad = await R.GET(req("198.51.100.1"), { params: Promise.resolve({ slug: "../../etc" }) });
  assert.equal(bad.status, 404);
  assert.equal(seen.length, 0, "an invalid id never reaches the database");
  const unknown = await R.GET(req("198.51.100.2"), { params: Promise.resolve({ slug: "validslug123" }) });
  assert.equal(unknown.status, 404);
  assert.ok(seen.every((u) => u.includes("advisor_clients?slug=")), "only the client lookup ran");
  assert.ok(!seen.some((u) => u.includes("advisor_client_holdings")));
});

test("client news route: access checks run in the same order as the dashboard route, before any holding is read", () => {
  const src = readFileSync(new URL("../src/app/api/client/[slug]/news/route.ts", import.meta.url), "utf8");
  const dash = readFileSync(new URL("../src/app/api/client/[slug]/dashboard/route.ts", import.meta.url), "utf8");
  const order = (s: string, needles: string[]) => needles.map((n) => s.indexOf(n));
  const a = order(src, ["isValidId(slug)", "getAdvisorClientBySlug(slug)", "verifyClientCookie(slug, client.passcodeHash", "listClientHoldings(client.id)"]);
  assert.ok(a.every((i) => i >= 0), JSON.stringify(a));
  assert.deepEqual([...a].sort((x, y) => x - y), a, "validate id, load client, verify cookie, then read holdings");
  for (const needle of ["isValidId(slug)", "getAdvisorClientBySlug(slug)", "verifyClientCookie(slug, client.passcodeHash", "client_session_${slug}"]) {
    assert.ok(dash.includes(needle) && src.includes(needle), needle);
  }
  assert.ok(src.includes("requiresPasscode: true") && src.includes("status: 401"));
  assert.ok(!/costBasis|shares|acquiredDate|cashBalance|passcode_hash|passcodeHash\b(?!,)/.test(src.replace("client.passcodeHash", "")), "no holding quantities, prices or secrets in the response");
  assert.ok(src.includes("private, no-store"));
});

test("no source file in the news code contains a key, and user-facing copy has no advice wording", () => {
  const files = ["../src/lib/news/news-core.ts", "../src/lib/news/news-hub.ts", "../src/components/NewsHubTab.tsx", "../src/components/ClientNewsPanel.tsx", "../src/components/NewsParts.tsx"];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/apikey=|api_key=|Bearer [A-Za-z0-9]/.test(src), f);
    assert.ok(!/\b(you should (buy|sell)|buy now|sell now|we recommend|guaranteed|can't lose|will rise|will fall)\b/i.test(src), f);
  }
  const ui = readFileSync(new URL("../src/components/NewsHubTab.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes("Headlines are information, not advice."), "the plain-language note is on the hub");
  assert.equal(C.HUB_NOTE_NOT_ADVICE, "Headlines are information, not advice.");
});

// ---- reading level (project target: grade 8 or lower) ----------------------------------------------------------
test("reader-facing copy is at or below grade 8 (same Flesch-Kincaid counter as the curriculum gate)", async () => {
  const { readingStats, TARGET_GRADE } = await import("./quality/reading-level.mts");
  const texts: string[] = [];
  for (const f of ["../src/components/NewsHubTab.tsx", "../src/components/ClientNewsPanel.tsx", "../src/components/NewsParts.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) {
      const t = m[1].replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
      if (t.split(/\s+/).length >= 6 && !/;|=>|\bconst\b|useState/.test(t)) texts.push(t); // skip generics like <AssetClass> that look like text
    }
    // plain sentences held in string attributes or props (message="...")
    for (const m of src.matchAll(/(?:message|aria-label|placeholder)="([^"]{30,})"/g)) texts.push(m[1]);
  }
  // sentences the server sends: source descriptions, notes and error states
  H.clearNewsHubCaches();
  handlers = [yahoo([]), secOff];
  const s = await H.getTickerNews("ZZZZQQ", "equity");
  for (const x of s.sources) texts.push(x.what, ...(x.note ? [x.note] : []));
  if (s.error) texts.push(s.error);
  texts.push(C.friendlyError(new Error("401"), "FMP"), C.friendlyError(new Error("429"), "GDELT"), C.friendlyError(new Error("timeout"), "The feed"));
  assert.ok(texts.length >= 12, `found ${texts.length} copy blocks`);
  const bad = texts.map((t) => ({ t, fk: readingStats(t).fk })).filter((r) => r.fk > TARGET_GRADE);
  assert.deepEqual(bad.map((b) => `${b.fk.toFixed(1)} ${b.t.slice(0, 70)}`), []);
  assert.ok(readingStats(texts.join(" ")).fk <= TARGET_GRADE);
});

test("background note blames the right source: FMP sector lookup for stocks, GDELT for rate limits", async () => {
  assert.match(H.backgroundNote("Sector/macro news unavailable: FMP_API_KEY is not set", undefined), /uses FMP, which is off/);
  assert.match(H.backgroundNote(undefined, "Article list unavailable: GDELT request failed: 429 Please limit requests"), /GDELT is limiting requests/);
  assert.match(H.backgroundNote("No macro-news keyword mapping defined for \"X\".", undefined), /no background topic/);
  assert.match(H.backgroundNote(undefined, undefined), /nothing for this topic/);
  // end to end for a stock with no FMP key: GDELT is never even reached, and the note says why
  H.clearNewsHubCaches();
  handlers = [yahoo([]), secOff];
  calls.length = 0;
  const s = await H.getTickerNews("AAPL", "equity", true);
  const g = s.sources.find((x) => x.name === "GDELT background");
  assert.equal(g.ok, false);
  assert.match(g.note, /uses FMP, which is off/);
  assert.ok(!calls.some((u) => u.includes("gdeltproject")));
});

test("watchlist counts headlines from the last 24 hours before cutting the list", async () => {
  H.clearNewsHubCaches();
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toUTCString();
  const stories = ["Alpha unveils product line with new battery pack", "Beta posts record quarterly revenue on strong demand", "Gamma names new chief operating officer after search", "Delta settles lawsuit over patent claims for modest sum", "Epsilon expands factory footprint across three states now", "Zeta announces dividend increase for shareholders this year", "Eta recalls older models over minor safety concern", "Theta wins large contract from federal agency this week"];
  handlers = [yahoo(stories.map((t, i) => ({ title: t, link: `https://example.com/${i}`, pubDate: hoursAgo(i < 7 ? i + 1 : 60) })))];
  const s = await H.getWatchlistNews([{ symbol: "BUSY", assetClass: "equity" }]);
  const g = s.groups[0];
  assert.equal(g.items.length, H.ITEMS_PER_SYMBOL, "display list is cut");
  assert.equal(g.last24h, 7, "but the count uses every merged headline from the last day, not just the ones shown");
});

test("opinion-style label: flags advice-like wording and leaves ordinary news alone (label only, never hides)", async () => {
  for (const t of [
    "The Best Growth Stock to Invest $10,000 in Right Now",
    "Prediction: IonQ Could 10x by 2035",
    "AMC Is Up 83% in 2026: Take Profits, or Hold On for the Ride?",
    "Archer Aviation Stock Is Down Roughly 50% This Year. Here's Why I'm Still Buying.",
    "Tech Sell-Off: 2 Growth Stocks Investors Might Regret Not Buying on the Dip",
    "Should you buy Nvidia before earnings?",
  ]) assert.ok(C.looksLikeOpinion(t), t);
  for (const t of [
    "Fed holds rates steady as inflation cools",
    "Microsoft to buy startup for $2 billion in cash deal",
    "Mid Penn Bancorp director Albert Evans buys $9,982 in shares",
    "Apple unveils new home device with built-in assistant",
    "Company announces share buyback program",
  ]) assert.ok(!C.looksLikeOpinion(t), t);
  H.clearNewsHubCaches();
  handlers = [yahoo([{ title: "Prediction: IonQ Could 10x by 2035", link: "https://example.com/p", pubDate: "Sat, 17 Oct 2026 18:00:00 +0000" }, { title: "Quantum firm signs supply deal with national lab", link: "https://example.com/q", pubDate: "Sat, 17 Oct 2026 17:00:00 +0000" }])];
  const s = await H.getWatchlistNews([{ symbol: "IONQ", assetClass: "equity" }]);
  const items = s.groups[0].items;
  assert.equal(items.length, 2, "nothing is hidden");
  assert.equal(items.find((i) => i.url.endsWith("/p")).opinion, true);
  assert.equal(items.find((i) => i.url.endsWith("/q")).opinion, undefined);
});
