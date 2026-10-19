// @ts-nocheck
// requires-network (read-only GETs of public RSS feeds; no keys; not part of the offline test run)
// Run: node --import ./scripts/ts-loader/register.mjs scripts/news-category-measure.mts [SYMBOL:class ...]
// Measures the "Market and macro" relevance rule (category-map.ts, RELEVANCE RULE) on the live category feeds:
// how many category-feed headlines the old split would have shown under Market and macro, how many the new rule keeps,
// and which ones it drops.
const CM = await import("../src/lib/news/category-map.ts");
const H = await import("../src/lib/news/news-hub.ts");
const { extractHeadlines } = await import("../src/lib/agents/trading-agent/skills/global-financial-news.ts");

const args = process.argv.slice(2);
const targets = (args.length ? args : ["BTC-USD:crypto", "ETH-USD:crypto", "GC:future", "CL:future", "EUR/USD:forex"]).map((a) => {
  const i = a.lastIndexOf(":");
  return { symbol: a.slice(0, i), cls: a.slice(i + 1) };
});

const cache = new Map();
async function feed(def) {
  if (!cache.has(def.id)) {
    try {
      const xml = await H.fetchText(def.url, "application/rss+xml, application/xml, text/xml", 0, def.name);
      cache.set(def.id, { items: extractHeadlines(xml, 50).map((h) => h.title), error: null });
    } catch (e) {
      cache.set(def.id, { items: [], error: String(e?.message ?? e).slice(0, 80) });
    }
  }
  return cache.get(def.id);
}

for (const t of targets) {
  const plan = CM.planNews(t.symbol, t.cls);
  let about = 0, before = 0, after = 0;
  const dropped = [];
  console.log(`\n== ${t.symbol} (${t.cls}) topic=${plan.topic}`);
  for (const id of plan.categoryFeedIds) {
    const def = CM.FEEDS[id];
    const r = await feed(def);
    let fAbout = 0, fBefore = 0, fAfter = 0;
    for (const title of r.items) {
      if (CM.matchesKeywords(title, plan.keywords)) { fAbout++; continue; }
      fBefore++;
      if (CM.isMarketRelevant(title, plan.topic)) fAfter++;
      else dropped.push(`[${def.name}] ${title}`);
    }
    about += fAbout; before += fBefore; after += fAfter;
    console.log(`  ${def.name.padEnd(26)} items=${String(r.items.length).padStart(2)} about=${fAbout} macro-before=${fBefore} macro-after=${fAfter}${r.error ? "  ERROR " + r.error : ""}`);
  }
  console.log(`  TOTAL category items: about=${about}, Market and macro BEFORE=${before}, AFTER=${after}, dropped=${before - after}`);
  for (const d of dropped.slice(0, 12)) console.log(`    dropped: ${d}`);
  const kept = [];
  for (const id of plan.categoryFeedIds) for (const title of (await feed(CM.FEEDS[id])).items) if (!CM.matchesKeywords(title, plan.keywords) && CM.isMarketRelevant(title, plan.topic)) kept.push(title);
  for (const k of kept.slice(0, 4)) console.log(`    kept:    ${k}`);
}
