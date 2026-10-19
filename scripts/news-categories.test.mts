// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/news-categories.test.mts
// Category map (which feeds make up "About this asset" and "Market and macro" for each asset class) and the two-group
// ticker news built from it. No network: every fetch is a fake and any other URL throws. No key is read or needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

delete process.env.FMP_API_KEY;
process.env.SEC_EDGAR_USER_AGENT = "Test test@example.com";

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

const rss = (items: { title: string; link: string; pubDate?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link>${i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ""}</item>`)
    .join("")}</channel></rss>`;
const xml = (body: string) => new Response(body, { status: 200, headers: { "content-type": "application/xml" } });

const C = await import("../src/lib/news/news-core.ts");
const H = await import("../src/lib/news/news-hub.ts");
const CM = await import("../src/lib/news/category-map.ts");
const TG = await import("../src/lib/news/ticker-groups.ts");
const P = await import("../src/lib/data/provider-http.ts");
P.setProviderSleep(async () => {});

const CLASSES = ["equity", "crypto", "commodity", "future", "forex", "bond", "option"];

test("category map: every asset class has a plan, and every feed id it names exists with an https URL", () => {
  assert.deepEqual([...CM.ALL_ASSET_CLASSES].sort(), [...CLASSES].sort());
  const sample: Record<string, string> = { equity: "AAPL", crypto: "BTC-USD", commodity: "USO", future: "GC", forex: "EUR/USD", bond: "US10Y", option: "AAPL261218C00200000" };
  for (const ac of CLASSES) {
    const plan = CM.planNews(sample[ac], ac);
    assert.ok(plan.topicLabel, ac);
    for (const id of CM.planFeedIds(plan)) assert.ok(CM.FEEDS[id], `${ac}: unknown feed id ${id}`);
    assert.equal(new Set(CM.planFeedIds(plan)).size, CM.planFeedIds(plan).length, `${ac}: duplicate feed ids`);
    assert.ok(plan.macroFeedIds.length >= 3, `${ac} has macro feeds`);
  }
  for (const f of Object.values(CM.FEEDS) as any[]) {
    assert.ok(f.url.startsWith("https://"), f.id);
    assert.ok(f.what.length > 10 && f.name, f.id);
    assert.ok(f.origin === "global-list" || f.origin === "probed-2026-10-18", f.id);
  }
  for (const id of Object.values(CM.TOPIC_FEED_IDS).flat() as string[]) assert.ok(CM.FEEDS[id], id);
  assert.ok(CM.REJECTED_FEEDS.length >= 5);
  const rejected = new Set(CM.REJECTED_FEEDS.map((r: any) => r.name.toLowerCase()));
  for (const f of Object.values(CM.FEEDS) as any[]) assert.ok(!rejected.has(f.name.toLowerCase()), `${f.name} was rejected live`);
});

test("category map: each class gets its own category feeds plus broad macro", () => {
  assert.ok(CM.planNews("BTC-USD", "crypto").categoryFeedIds.includes("coindesk"));
  assert.equal(CM.planNews("USO", "commodity").topic, "energy");
  assert.ok(CM.planNews("USO", "commodity").categoryFeedIds.includes("oilprice"));
  assert.equal(CM.planNews("GLD", "commodity").topic, "metals");
  assert.ok(CM.planNews("GLD", "future").categoryFeedIds.includes("mining"));
  assert.equal(CM.planNews("CORN", "commodity").topic, "agriculture");
  assert.ok(CM.planNews("WEAT", "commodity").categoryFeedIds.includes("usda"));
  assert.equal(CM.planNews("SPY", "future").topic, "equity-index");
  assert.equal(CM.planNews("TLT", "future").topic, "rates");
  assert.ok(CM.planNews("TLT", "future").categoryFeedIds.includes("forexlive"));
  assert.equal(CM.planNews("TLT", "future").matchMacroToo, true, "rates news is also searched for in the broad outlets");
  for (const gone of ["cnbc-bonds", "cnbc-commodities", "investing-commodities", "investing-bonds"]) assert.equal(CM.FEEDS[gone], undefined, `${gone} answers but is off topic, so it is not mapped`);
  assert.ok(CM.planNews("EUR/USD", "forex").categoryFeedIds.includes("fxstreet"));
  const bond = CM.planNews("US10Y", "bond");
  assert.equal(bond.categoryIsAbout, false);
  assert.equal(bond.matchMacroToo, true);
  assert.equal(bond.hasSymbolFeed, false);
  assert.match(bond.aboutNote, /No outlet covers a single bond/);
  const eq = CM.planNews("AAPL", "equity");
  assert.deepEqual(eq.categoryFeedIds, []);
  assert.ok(eq.hasSymbolFeed);
  const unknown = CM.planNews("ZZZ", "commodity");
  assert.equal(unknown.topic, "unknown", "an unmapped commodity still gets feeds and macro, not an error");
  assert.ok(unknown.categoryFeedIds.length > 0);
});

test("category map: options route to the underlying stock; futures roots and contract months are read", () => {
  const p = CM.planNews("aapl261218c00200000", "option");
  assert.equal(p.symbol, "AAPL");
  assert.equal(p.assetClass, "equity");
  assert.match(p.aboutNote, /option/);
  const bad = CM.planNews("WEIRD", "option");
  assert.equal(bad.hasSymbolFeed, false);
  assert.match(bad.aboutNote, /could not be read/);
  assert.equal(CM.futuresRoot("/ES"), "ES");
  assert.equal(CM.futuresRoot("CL=F"), "CL");
  assert.equal(CM.futuresRoot("ESZ6"), "ES");
  assert.equal(CM.planNews("/ES", "future").topic, "equity-index");
  assert.equal(CM.planNews("CL=F", "future").topic, "energy");
});

test("keyword matching is whole-word and asset-aware", () => {
  assert.ok(CM.matchesKeywords("Bitcoin slips as ETF outflows grow", CM.cryptoKeywords("BTC-USD")));
  assert.ok(CM.matchesKeywords("Why ETH is rising", CM.cryptoKeywords("ETH-USD")));
  assert.ok(!CM.matchesKeywords("A new method for payments", CM.cryptoKeywords("ETH-USD")), "eth must not match method");
  assert.ok(!CM.matchesKeywords("Solana network upgrade ships", CM.cryptoKeywords("BTC-USD")));
  assert.ok(CM.matchesKeywords("Euro firms as ECB signals patience", CM.forexKeywords("EUR/USD")));
  assert.ok(!CM.matchesKeywords("Dollar rises against the yen", CM.forexKeywords("EUR/USD")), "a dollar-only headline is not about EUR/USD");
  assert.ok(CM.matchesKeywords("Dollar rises against the yen", CM.forexKeywords("USD/JPY")));
  assert.ok(CM.matchesKeywords("Gold hits a record on safe haven demand", CM.planNews("GLD", "commodity").keywords));
  assert.ok(CM.matchesKeywords("Agricultural exports jump", CM.planNews("DBA", "commodity").keywords), "stem match for agricultur");
  assert.ok(!CM.matchesKeywords("anything", []));
});

// A fake network for every mapped feed: feedItems[id] = items, any other mapped feed answers 503.
function mappedFeeds(feedItems: Record<string, any[]>, extra: Handler[] = []): Handler[] {
  const byUrl = new Map<string, string>(Object.values(CM.FEEDS).map((f: any) => [f.url, f.id]));
  return [
    ...extra,
    (url) => {
      const id = byUrl.get(url);
      if (!id) return null;
      return feedItems[id] ? xml(rss(feedItems[id])) : new Response("down", { status: 503 });
    },
  ];
}
const yahoo = (items: any[]): Handler => (url) => (url.includes("feeds.finance.yahoo.com") ? xml(rss(items)) : null);
const secOff: Handler = (url) => (url.includes("sec.gov") ? new Response("down", { status: 500 }) : null);
const fi = (title: string, n: number, hours = 1) => ({ title, link: `https://example.com/${n}`, pubDate: new Date(Date.now() - hours * 3600_000).toUTCString() });
const urlsIn = (g: any) => g.items.map((i: any) => i.url);

test("two groups for crypto: coin headlines go to About, the rest of crypto news and broad outlets go to Market and macro", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      coindesk: [fi("Bitcoin slips as ETF outflows grow for third day", 1), fi("Solana network upgrade ships on schedule this week", 2)],
      cointelegraph: [fi("Why Bitcoin whales are moving coins to exchanges", 3)],
      cnbc: [fi("Fed minutes show split over pace of rate cuts", 4)],
      marketwatch: [fi("Stocks rally as bond yields ease from highs", 5)],
    },
    [yahoo([fi("Bitcoin struggles above 80K as whale transfers signal mixed outlook", 6)]), secOff]
  );
  const g = await TG.getTickerNewsGroups("BTC-USD", "crypto");
  assert.equal(g.about.title, "About this asset");
  assert.equal(g.macro.title, "Market and macro");
  assert.equal(g.topic, "Crypto");
  const aboutTitles = g.about.items.map((i: any) => i.title);
  assert.ok(aboutTitles.some((t: string) => /Bitcoin slips/.test(t)), "category feed headline naming bitcoin is About");
  assert.ok(aboutTitles.some((t: string) => /whale transfers/.test(t)), "Yahoo symbol feed is About");
  assert.ok(!aboutTitles.some((t: string) => /Solana/.test(t)), "other coins are not About BTC");
  const macroTitles = g.macro.items.map((i: any) => i.title);
  assert.ok(macroTitles.some((t: string) => /Solana/.test(t)), "wider crypto news is Market and macro");
  assert.ok(macroTitles.some((t: string) => /Fed minutes/.test(t)), "broad macro outlet is Market and macro");
  assert.deepEqual(urlsIn(g.about).filter((u: string) => urlsIn(g.macro).includes(u)), [], "no story appears in both groups");
  for (const grp of [g.about, g.macro]) for (const it of grp.items) assert.ok(it.url.startsWith("https://") && it.source && it.publishedAt);
});

test("two groups for a stock: company feeds are About, only broad outlets are Market and macro, no category feeds are fetched", async () => {
  H.clearNewsHubCaches();
  calls.length = 0;
  handlers = mappedFeeds({ cnbc: [fi("Treasury yields edge up before inflation data", 1)], ft: [fi("Global growth outlook trimmed by the IMF", 2)] }, [yahoo([fi("Apple unveils new home device with built in assistant", 3)]), secOff]);
  const g = await TG.getTickerNewsGroups("AAPL", "equity");
  assert.equal(g.topic, "Stock");
  assert.deepEqual(g.about.items.map((i: any) => i.provider), ["Yahoo Finance feed"]);
  assert.ok(g.macro.items.length >= 2 && g.macro.items.every((i: any) => i.provider === "RSS"));
  assert.ok(!calls.some((u) => /coindesk|oilprice|fxstreet|mining\.com/.test(u)), "no category feeds for a stock");
});

test("two groups for commodities and futures use the right category sites", async () => {
  H.clearNewsHubCaches();
  calls.length = 0;
  handlers = mappedFeeds(
    {
      mining: [fi("Gold hits a record as investors seek safety", 1), fi("Lithium miners cut output as prices stay weak", 2)],
      "cnbc-commodities": [fi("Gold edges higher while copper slips", 3)],
      "investing-commodities": [fi("Oil prices fall as stockpiles rise", 4)],
      cnbc: [fi("Dollar steadies ahead of jobs report on Friday", 5)],
    },
    [yahoo([fi("GLD sees record inflows as gold climbs", 6)])]
  );
  const gold = await TG.getTickerNewsGroups("GLD", "commodity");
  assert.equal(gold.topic, "Metals");
  assert.ok(gold.about.items.some((i: any) => /record/.test(i.title) && i.provider === "RSS"));
  assert.ok(gold.macro.items.some((i: any) => /Lithium/.test(i.title)), "wider metals news is Market and macro");
  assert.ok(calls.some((u) => u.includes("mining.com")) && !calls.some((u) => u.includes("oilprice")), "metals feeds only");
  H.clearNewsHubCaches();
  calls.length = 0;
  const fut = await TG.getTickerNewsGroups("CL=F", "future");
  assert.equal(fut.topic, "Energy");
  assert.ok(calls.some((u) => u.includes("oilprice")) && calls.some((u) => u.includes("rigzone")) && calls.some((u) => u.includes("eia.gov")));
});

test("two groups for currency pairs, bonds and options", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds({ fxstreet: [fi("Euro firms as ECB signals patience on cuts", 1), fi("Yen weakens after Bank of Japan holds", 2)], cnbc: [fi("Markets await the jobs report on Friday", 3)] }, [yahoo([])]);
  const fx = await TG.getTickerNewsGroups("EUR/USD", "forex");
  assert.equal(fx.topic, "Currency");
  assert.ok(fx.about.items.some((i: any) => /Euro firms/.test(i.title)));
  assert.ok(fx.macro.items.some((i: any) => /Yen weakens/.test(i.title)));

  H.clearNewsHubCaches();
  handlers = mappedFeeds({ forexlive: [fi("Ten-year yield climbs as auction demand cools", 1), fi("Eurozone factory output rises in September", 7)], cnbc: [fi("Treasury yields slip as Fed officials urge patience", 2), fi("Markets await the jobs report on Friday", 8)] });
  const bond = await TG.getTickerNewsGroups("US10Y", "bond");
  assert.equal(bond.topic, "Bonds");
  assert.ok(bond.about.items.some((i: any) => /Ten-year yield/.test(i.title)), "bond-market news fills About");
  assert.ok(bond.about.items.some((i: any) => /Treasury yields slip/.test(i.title)), "a broad outlet headline with rates words is also About");
  assert.ok(!bond.about.items.some((i: any) => /Eurozone factory|jobs report/.test(i.title)), "off-topic headlines are not About");
  assert.ok(bond.macro.items.some((i: any) => /jobs report/.test(i.title)));
  assert.ok(bond.notes.some((n: string) => /No outlet covers a single bond/.test(n)));

  H.clearNewsHubCaches();
  handlers = mappedFeeds({ cnbc: [fi("Markets await the jobs report on Friday", 2)] }, [yahoo([fi("Apple unveils new home device with built in assistant", 3)]), secOff]);
  const opt = await TG.getTickerNewsGroups("AAPL261218C00200000", "option");
  assert.equal(opt.symbol, "AAPL261218C00200000", "the caller's symbol is echoed back");
  assert.ok(opt.about.items.some((i: any) => /Apple unveils/.test(i.title)), "news is about the underlying stock");
  assert.ok(opt.notes.some((n: string) => /option/.test(n)));

  H.clearNewsHubCaches();
  handlers = mappedFeeds({});
  const junk = await TG.getTickerNewsGroups("WEIRD", "option");
  assert.match(junk.about.empty, /could not be read/);
});

test("a category feed with no matching headline is reported as working with zero, not as down", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds({ coindesk: [fi("Solana network upgrade ships on schedule this week", 2)], cnbc: [fi("Markets await the jobs report on Friday", 1)] }, [yahoo([])]);
  const g = await TG.getTickerNewsGroups("ETH-USD", "crypto");
  const cd = g.about.sources.find((s: any) => s.name === "CoinDesk");
  assert.ok(cd && cd.ok === true && cd.count === 0 && /named the asset/.test(cd.note));
});

test("market and macro lists category news first, then broad outlets", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds({ oilprice: [fi("Europe braces for a winter energy crisis as reserves run low", 1, 30)], cnbc: [fi("Evercore names two co presidents in a shake up", 2, 1)], ft: [fi("Macron faces political firestorm after riots", 3, 1)] }, [yahoo([])]);
  const g = await TG.getTickerNewsGroups("USO", "commodity");
  const titles = g.macro.items.map((i: any) => i.title);
  assert.ok(/winter energy crisis/.test(titles[0]), "category news leads even when a broad story is newer");
  assert.ok(titles.length >= 3);
});

test("category feed failures are named in plain words, shown per group, and never cached", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds({ cnbc: [fi("Markets await the jobs report on Friday", 1)] }, [yahoo([])]); // every crypto outlet answers 503
  const g = await TG.getTickerNewsGroups("BTC-USD", "crypto");
  const cd = g.macro.sources.find((s: any) => s.name === "CoinDesk");
  assert.ok(cd && cd.ok === false && /did not answer|limiting|refused|took too long/.test(cd.note), JSON.stringify(cd));
  assert.ok(!JSON.stringify(g).includes("coindesk.com"), "no raw URL in the response");
  assert.equal(g.about.items.length, 0);
  assert.ok(g.about.empty && /No (source returned headlines|headline about)/.test(g.about.empty), "plain empty state for About");
  assert.ok(g.macro.items.length >= 1);
  handlers = mappedFeeds({ coindesk: [fi("Bitcoin rebounds after a sharp sell off", 2)], cnbc: [fi("Markets await the jobs report on Friday", 1)] }, [yahoo([])]);
  const again = await TG.getTickerNewsGroups("BTC-USD", "crypto");
  assert.ok(again.about.items.some((i: any) => /rebounds/.test(i.title)), "the next call recovers");
});

test("everything down gives two honest empty groups, not a blank panel, and is not cached", async () => {
  H.clearNewsHubCaches();
  handlers = [() => new Response("down", { status: 503 })];
  const g = await TG.getTickerNewsGroups("GLD", "commodity");
  assert.equal(g.about.items.length + g.macro.items.length, 0);
  assert.ok(g.about.empty && g.macro.empty);
  assert.ok(g.macro.sources.length >= 5 && g.macro.sources.every((s: any) => !s.ok && s.note));
  calls.length = 0;
  await TG.getTickerNewsGroups("GLD", "commodity");
  assert.ok(calls.length > 0, "a total failure is retried, not served from cache");
});

test("each feed is fetched once inside the cache window, even across tickers that share it", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      cnbc: [fi("Markets await the jobs report on Friday", 1)],
      marketwatch: [fi("Stocks drift as traders wait for data", 2)],
      "bbc-business": [fi("UK inflation slows more than expected", 3)],
      ft: [fi("Global growth outlook trimmed by the IMF", 4)],
      "guardian-business": [fi("Retail sales fall as shoppers hold back", 5)],
    },
    [yahoo([fi("Some stock story about a product launch today", 6)]), secOff]
  );
  calls.length = 0;
  await TG.getTickerNewsGroups("AAPL", "equity");
  const first = calls.filter((u) => u.includes("cnbc.com")).length;
  await TG.getTickerNewsGroups("MSFT", "equity");
  assert.equal(calls.filter((u) => u.includes("cnbc.com")).length, first, "the shared CNBC feed was not fetched again for another ticker");
  assert.equal(first, 1);
});

test("hub route returns the two-group shape for a ticker", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds({ cnbc: [fi("Markets await the jobs report on Friday", 1)] }, [yahoo([fi("Apple unveils new home device with built in assistant", 3)]), secOff]);
  const R = await import("../src/app/api/news-hub/route.ts");
  const res = await R.GET(new Request("http://x.test/api/news-hub?section=ticker&ticker=AAPL&assetClass=equity", { headers: { "x-real-ip": "203.0.113.77" } }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.about.title, "About this asset");
  assert.equal(j.macro.title, "Market and macro");
  assert.ok(Array.isArray(j.about.items) && Array.isArray(j.macro.items));
  const opt = await R.GET(new Request("http://x.test/api/news-hub?section=ticker&ticker=AAPL261218C00200000&assetClass=option", { headers: { "x-real-ip": "203.0.113.77" } }));
  assert.equal(opt.status, 200);
});

test("TickerNewsBelowChart fetches only when the symbol or class changes, and leaves a marked slot for the news impact panel", () => {
  const src = readFileSync(new URL("../src/components/TickerNewsBelowChart.tsx", import.meta.url), "utf8");
  assert.match(src, /\}, \[clean, assetClass\]\);/, "the effect depends on the symbol and class only");
  assert.equal((src.match(/useEffect\(/g) ?? []).length, 1);
  assert.ok(!/setInterval|setTimeout/.test(src), "no timers, so nothing refetches on a tick");
  assert.ok(src.includes("NEWS IMPACT SLOT") && src.includes("impactSlot"), "slot is marked");
  assert.ok(!/import .*NewsImpactPanel/.test(src), "the other agent's panel is not built or imported here");
  assert.ok(src.includes("Loading news") && src.includes("EmptyOrError"), "short loading state and plain empty state");
});

test("reader-facing copy of the two-group view is at or below grade 8", async () => {
  const { readingStats, TARGET_GRADE } = await import("./quality/reading-level.mts");
  const texts: string[] = [];
  for (const f of ["../src/components/TickerNewsBelowChart.tsx", "../src/components/NewsParts.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/>\s*([^<>{}\n][^<>{}]*?)\s*</g)) {
      const t = m[1].replace(/\s+/g, " ").trim();
      if (t.split(/\s+/).length >= 6 && !/;|=>|\bconst\b|useState/.test(t)) texts.push(t);
    }
  }
  for (const f of Object.values(CM.FEEDS) as any[]) texts.push(f.what);
  H.clearNewsHubCaches();
  handlers = [() => new Response("down", { status: 503 })];
  const g = await TG.getTickerNewsGroups("BTC-USD", "crypto");
  texts.push(g.about.description, g.macro.description, g.about.empty, g.macro.empty, CM.planNews("US10Y", "bond").aboutNote, CM.planNews("AAPL261218C00200000", "option").aboutNote);
  for (const s of [...g.macro.sources, ...g.about.sources]) if (s.note) texts.push(s.note);
  assert.ok(texts.length >= 15, `found ${texts.length} copy blocks`);
  // One short line that is mostly an outlet name (Cointelegraph did not answer.) scores high on its own, so the cap per
  // line is looser and the whole body of copy must meet the project target.
  const bad = texts.map((t) => ({ t, fk: readingStats(t).fk })).filter((r) => r.fk > 12);
  assert.deepEqual(bad.map((b) => `${b.fk.toFixed(1)} ${b.t.slice(0, 70)}`), []);
  assert.ok(readingStats(texts.join(" ")).fk <= TARGET_GRADE, `whole copy grade ${readingStats(texts.join(" ")).fk.toFixed(2)}`);
});

// ---- Relevance rule for "Market and macro" (added 2026-10-19) ----

test("relevance rule: off-topic stories from category feeds are dropped, market and regulation stories are kept", () => {
  const R = (t: string, topic = "crypto") => CM.isMarketRelevant(t, topic);
  // Real off-topic headlines seen in crypto feeds on 2026-10-19, plus the pink-diamond example from the owner.
  for (const t of [
    "MapQuest Now Shows Drivers Where Flock Cameras Are Watching",
    "Rare pink diamond sells at auction for a record sum",
    "Tesla Roadster Rocket Is the Cool 'Flying' Car You Can’t Have",
    "Hackers Jailbreak iPhone 18 Pro on Stage, and It Survives a Reboot",
    "Romanian F-16s shoot down two drones over Black Sea, NATO council to meet Tuesday",
  ]) assert.equal(R(t), false, t);
  for (const t of [
    "Crypto vault deposits top $10 billion as lending risks draw regulatory scrutiny", // stem: regulat*
    "SEC delays decision on a spot Solana fund",
    "JPMorgan brings JPM Coin, representing dollar deposits, to Ethereum",
    "BingX, YouHodler added to ESMA MiCA register in latest update",
    "Fed minutes show split over pace of rate cuts",
    "Stablecoin bill clears Senate committee",
  ]) assert.equal(R(t), true, t);
});

test("relevance rule: whole-word matching, stems only where marked, topic lists apply to their topic", () => {
  assert.equal(CM.matchesAnyTerm("A secret recipe for sourdough", ["sec"]), false, "sec must not match secret");
  assert.equal(CM.matchesAnyTerm("SEC sues an exchange", ["sec"]), true);
  assert.equal(CM.matchesAnyTerm("New regulatory framework", ["regulat*"]), true, "a trailing * is a prefix match");
  assert.equal(CM.matchesAnyTerm("Marketing team hires a chef", ["market*"]), true, "market* is a prefix, so it also matches marketing");
  assert.equal(CM.matchesAnyTerm("Marketing team hires a chef", ["market"]), false);
  assert.equal(CM.matchesAnyTerm("The ether of the universe", ["eth"]), false);
  assert.equal(CM.matchesAnyTerm("Fed holds, yields climb", ["yields"]), true);
  // topic lists: a crypto word is on topic for crypto but a plain farm story is not market news for crypto
  assert.equal(CM.isMarketRelevant("Zcash developers plan a fix for private swaps", "crypto"), true);
  assert.equal(CM.isMarketRelevant("Zcash developers plan a fix for private swaps", "agriculture"), false);
  assert.equal(CM.isMarketRelevant("Corn harvest runs ahead of last year", "agriculture"), true);
  assert.equal(CM.isMarketRelevant("Strait of Hormuz tanker attacks raise shipping costs", "energy"), true);
  assert.equal(CM.isMarketRelevant("Silver miners lift output at a Peru mine", "metals"), true);
  assert.equal(CM.isMarketRelevant("Turkish Lira: Policy pause and MSCI risk weigh", "currency"), true);
  assert.equal(CM.isMarketRelevant("Anything at all", "unknown"), false, "no term, no match");
  // every list is real words, no empty strings, no duplicates inside one list
  for (const [name, list] of Object.entries({ MARKET_MACRO_TERMS: CM.MARKET_MACRO_TERMS, ...CM.TOPIC_TERMS }) as [string, string[]][]) {
    assert.ok(list.every((w) => w.trim().length >= 2 && w === w.toLowerCase()), `${name}: terms are lower case words`);
    assert.equal(new Set(list).size, list.length, `${name}: no duplicate terms`);
  }
});

test("Market and macro drops off-topic category-feed stories for crypto, metals, energy and currency, but never filters the broad outlets", async () => {
  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      coindesk: [fi("Bitcoin slips as ETF outflows grow for third day", 1), fi("Ether fund inflows climb as regulators watch stablecoins", 2)],
      decrypt: [fi("MapQuest Now Shows Drivers Where Flock Cameras Are Watching", 3), fi("Rare pink diamond sells at auction for a record sum", 4)],
      cointelegraph: [fi("Chinese suspect in $75M international crime network arrested in Bangkok", 5)],
      // Broad outlets are not filtered: a story with none of the rule's words still shows.
      cnbc: [fi("Evercore names two co presidents in a shake up", 6)],
    },
    [yahoo([]), secOff]
  );
  const g = await TG.getTickerNewsGroups("BTC-USD", "crypto");
  const all = [...g.about.items, ...g.macro.items].map((i: any) => i.title).join(" | ");
  assert.ok(!/MapQuest|pink diamond|crime network/.test(all), "off-topic crypto-site stories are in neither group: " + all);
  assert.ok(g.macro.items.some((i: any) => /Ether fund inflows/.test(i.title)), "a market and regulation story stays");
  assert.ok(g.macro.items.some((i: any) => /Evercore/.test(i.title)), "the broad outlet is never filtered");
  const dec = g.macro.sources.find((s: any) => s.name === "Decrypt");
  assert.ok(dec && dec.ok === true && dec.count === 0 && /No market or macro headline/.test(dec.note), "a feed with nothing relevant is working with zero, not down: " + JSON.stringify(dec));
  const cd = g.macro.sources.find((s: any) => s.name === "CoinDesk");
  assert.equal(cd.count, 1, "count is the number kept in the macro group");

  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      mining: [fi("Gold hits a record as investors seek safety", 1), fi("Copper-hungry US buyers circle Ivanhoe Electric mine", 2), fi("Lawrence Tech launches $100,000 innovation challenge for students", 3)],
      fxstreet: [fi("Oil: High prices seen easing only gradually – Commerzbank", 4), fi("Indian Rupee extends last week’s outperformance into the new week", 5)],
    },
    [yahoo([])]
  );
  const gold = await TG.getTickerNewsGroups("GC", "future");
  const goldMacro = gold.macro.items.map((i: any) => i.title);
  assert.ok(goldMacro.some((t: string) => /Copper-hungry/.test(t)) && goldMacro.some((t: string) => /Oil: High prices/.test(t)));
  assert.ok(!goldMacro.some((t: string) => /Lawrence Tech/.test(t)), "off-topic mining-site story dropped");

  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      oilprice: [fi("America Needs 48,000 Tons of Rare Earth Magnets. It Only Makes 300", 1), fi("Qatari LNG cargo heads through Red Sea to Europe", 2)],
      eia: [fi("PJM, ERCOT, and SWPP all set peak load records this summer", 3)],
    },
    [yahoo([])]
  );
  const oil = await TG.getTickerNewsGroups("CL", "future");
  const oilMacro = oil.macro.items.map((i: any) => i.title);
  assert.ok(oilMacro.some((t: string) => /LNG/.test(t)) && oilMacro.some((t: string) => /ERCOT/.test(t)));
  assert.ok(!oilMacro.some((t: string) => /Rare Earth Magnets/.test(t)));

  H.clearNewsHubCaches();
  handlers = mappedFeeds(
    {
      forexlive: [fi("US September import price index +1.1% vs +0.8% expected", 1), fi("Romanian F-16s shoot down two drones over Black Sea, NATO council to meet Tuesday", 2)],
      fxstreet: [fi("Euro firms as ECB signals patience on cuts", 3)],
    },
    [yahoo([])]
  );
  const fx = await TG.getTickerNewsGroups("EUR/USD", "forex");
  const fxAll = [...fx.about.items, ...fx.macro.items].map((i: any) => i.title);
  assert.ok(fxAll.some((t: string) => /import price index/.test(t)));
  assert.ok(!fxAll.some((t: string) => /Romanian F-16s/.test(t)));
});
