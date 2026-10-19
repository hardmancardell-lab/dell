import { extractHeadlines } from "@/lib/agents/trading-agent/skills/global-financial-news";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import { FEEDS, isMarketRelevant, matchesKeywords, planNews, type FeedDef } from "./category-map";
import {
  GROUP_ABOUT_TITLE,
  GROUP_MACRO_TITLE,
  TtlCache,
  canonicalUrlKey,
  dedupeNews,
  friendlyError,
  titleTokens,
  type NewsGroup,
  type NewsItem,
  type SourceStatus,
  type TickerNewsGroups,
} from "./news-core";
import { fetchText, getTickerNews, nowIso, registerCacheClearer, toItem } from "./news-hub";

/**
 * Two labelled groups for one ticker, chosen by the category map (category-map.ts):
 *   About this asset  symbol feeds (Yahoo, FMP, SEC) plus category-feed headlines that name the asset
 *   Market and macro  the rest of the category feeds plus broad market outlets
 * Each feed is fetched once and cached ten minutes. A failed feed is reported by name and never cached.
 */

const PER_FEED = 20;
const ABOUT_LIMIT = 20;
const MACRO_LIMIT = 15;
const MACRO_CATEGORY_LIMIT = 9;
const MACRO_BROAD_MIN = 6;
const FEED_TTL_MS = 10 * 60_000;
const GROUPS_TTL_MS = 5 * 60_000;

interface FeedFetch {
  items: NewsItem[];
  error: string | null;
}

const feedCache = new TtlCache<FeedFetch>(FEED_TTL_MS, 80);
const groupsCache = new TtlCache<{ result: TickerNewsGroups; feedFailed: boolean }>(GROUPS_TTL_MS, 100);
registerCacheClearer(() => {
  feedCache.clear();
  groupsCache.clear();
});

async function fetchFeed(def: FeedDef): Promise<FeedFetch> {
  try {
    return await feedCache.get(def.id, async () => {
      const xml = await fetchText(def.url, "application/rss+xml, application/atom+xml, application/xml, text/xml", 10 * 60, def.name);
      const now = Date.now();
      const items = extractHeadlines(xml, PER_FEED)
        .map((h) => toItem(h, def.name, "RSS", now))
        .filter((x): x is NewsItem => x !== null);
      if (items.length === 0) throw new Error(`${def.name} sent no usable headlines`);
      return { items, error: null };
    });
  } catch (e) {
    return { items: [], error: friendlyError(e, def.name) };
  }
}

function statusFor(def: FeedDef, r: FeedFetch, count: number, emptyNote = "No headline in this feed named the asset right now."): SourceStatus {
  return { name: def.name, what: def.what, ok: r.error === null, count, note: r.error ?? (count === 0 ? emptyNote : null) };
}

function keysOf(items: NewsItem[]): { urls: Set<string>; titles: Set<string> } {
  return { urls: new Set(items.map((i) => canonicalUrlKey(i.url))), titles: new Set(items.map((i) => titleTokens(i.title).join(" ")).filter(Boolean)) };
}

/** Two-group news for a ticker. includeBackground adds the optional, slow GDELT articles to "About this asset". */
export async function getTickerNewsGroups(ticker: string, assetClass: AssetClass, includeBackground = false): Promise<TickerNewsGroups> {
  const plan = planNews(ticker, assetClass);
  const key = `${plan.symbol}|${assetClass}|${includeBackground ? 1 : 0}`;
  const { result, feedFailed } = await groupsCache.get(key, () => build(ticker.trim().toUpperCase(), assetClass, includeBackground));
  // A total failure, or any category or macro feed that failed, must not be remembered for the whole window.
  // (Each working feed stays cached by itself, so retrying costs little.)
  if (feedFailed || (result.about.items.length === 0 && result.macro.items.length === 0)) groupsCache.clear();
  return result;
}

async function build(displaySymbol: string, assetClass: AssetClass, includeBackground: boolean): Promise<{ result: TickerNewsGroups; feedFailed: boolean }> {
  const plan = planNews(displaySymbol, assetClass);
  const categoryDefs = plan.categoryFeedIds.map((id) => FEEDS[id]).filter(Boolean);
  const macroDefs = plan.macroFeedIds.map((id) => FEEDS[id]).filter(Boolean);

  const [baseR, categoryR, macroR] = await Promise.all([
    plan.hasSymbolFeed ? getTickerNews(plan.symbol, plan.assetClass, includeBackground).catch((e) => ({ items: [], sources: [], asOf: nowIso(), notes: [], error: friendlyError(e, "News") })) : Promise.resolve(null),
    Promise.all(categoryDefs.map(fetchFeed)),
    Promise.all(macroDefs.map(fetchFeed)),
  ]);

  // Split the category feeds: headlines naming the asset go to About, the rest are market news for the category.
  const aboutExtra: NewsItem[] = [];
  const macroCategory: NewsItem[] = [];
  const aboutSources: SourceStatus[] = baseR ? [...baseR.sources] : [];
  const macroSources: SourceStatus[] = [];
  categoryDefs.forEach((def, i) => {
    const r = categoryR[i];
    let matched = 0;
    let kept = 0;
    for (const it of r.items) {
      if (plan.categoryIsAbout || matchesKeywords(it.title, plan.keywords)) {
        aboutExtra.push(it);
        matched += 1;
      } else if (isMarketRelevant(it.title, plan.topic)) {
        macroCategory.push(it);
        kept += 1;
      } else {
        // Off topic (not about the asset, markets, money, rates, the economy or regulation): dropped from both groups.
      }
    }
    if (plan.categoryIsAbout) {
      aboutSources.push(statusFor(def, r, r.items.length));
    } else {
      macroSources.push(statusFor(def, r, kept, "No market or macro headline in this feed right now."));
      if (plan.keywords.length > 0) aboutSources.push(statusFor(def, r, matched));
    }
  });
  macroDefs.forEach((def, i) => macroSources.push(statusFor(def, macroR[i], macroR[i].items.length)));

  // Bonds and rates: no topic feed covers them well, so broad outlets are also searched for rates words.
  const macroBroad: NewsItem[] = [];
  macroDefs.forEach((def, i) => {
    let matched = 0;
    for (const it of macroR[i].items) {
      if (plan.matchMacroToo && matchesKeywords(it.title, plan.keywords)) {
        aboutExtra.push(it);
        matched += 1;
      } else {
        macroBroad.push(it);
      }
    }
    if (plan.matchMacroToo) aboutSources.push(statusFor(def, macroR[i], matched));
  });

  const aboutItems = dedupeNews([...(baseR?.items ?? []), ...aboutExtra]).slice(0, ABOUT_LIMIT);
  const seen = keysOf(aboutItems);
  const notSeen = (i: NewsItem) => !seen.urls.has(canonicalUrlKey(i.url)) && !seen.titles.has(titleTokens(i.title).join(" "));
  // Category news first (it is about the same market), then broad outlets, each newest first.
  const categoryPart = dedupeNews(macroCategory).filter(notSeen).slice(0, MACRO_CATEGORY_LIMIT);
  const catKeys = keysOf(categoryPart);
  const broadPart = dedupeNews(macroBroad)
    .filter(notSeen)
    .filter((i) => !catKeys.urls.has(canonicalUrlKey(i.url)) && !catKeys.titles.has(titleTokens(i.title).join(" ")))
    .slice(0, Math.max(MACRO_BROAD_MIN, MACRO_LIMIT - categoryPart.length));
  const macroItems = [...categoryPart, ...broadPart];

  const notes: string[] = [...(baseR?.notes ?? [])];
  if (plan.aboutNote) notes.unshift(plan.aboutNote);

  const aboutEmpty =
    aboutItems.length > 0
      ? null
      : !plan.hasSymbolFeed && !plan.categoryIsAbout
        ? plan.aboutNote ?? "No source covers this asset by name."
        : baseR?.error ?? `No headline about ${plan.symbol} came back right now. That can mean a quiet day or sources that are off. The list below says which.`;

  const about: NewsGroup = {
    title: GROUP_ABOUT_TITLE,
    description: plan.categoryIsAbout
      ? "News about bonds and interest rates, not one single bond."
      : `Headlines that name ${plan.symbol}${plan.keywords.length > 0 ? " or its topic" : ""}, from its own feeds and from ${plan.topicLabel.toLowerCase()} news sites.`,
    items: aboutItems,
    sources: aboutSources,
    empty: aboutEmpty,
  };
  const macro: NewsGroup = {
    title: GROUP_MACRO_TITLE,
    description:
      plan.categoryFeedIds.length > 0
        ? `More ${plan.topicLabel.toLowerCase()} news, plus general business headlines.`
        : "General business and economy headlines that can matter to any asset.",
    items: macroItems,
    sources: macroSources,
    empty: macroItems.length > 0 ? null : "No market headlines came back right now. Try again in a few minutes.",
  };

  const feedFailed = [...categoryR, ...macroR].some((r) => r.error !== null);
  return { result: { symbol: displaySymbol, assetClass, topic: plan.topicLabel, about, macro, asOf: nowIso(), notes }, feedFailed };
}
