import { XMLParser } from "fast-xml-parser";
import { providerFetch } from "@/lib/data/provider-http";
import { GLOBAL_NEWS_SOURCES, extractHeadlines } from "@/lib/agents/trading-agent/skills/global-financial-news";
import { getTickerNewsPanel } from "@/lib/agents/trading-agent/skills/ticker-news-panel";
import type { AssetClass } from "@/lib/agents/trading-agent/types";
import {
  TtlCache,
  cleanTitle,
  dedupeNews,
  findTrendingTopics,
  friendlyError,
  hostLabel,
  isHubSymbol,
  looksLikeOpinion,
  parseFeedTime,
  safeHttpUrl,
  stripTracking,
  toYahooSymbol,
  type NewsItem,
  type NewsSection,
  type SourceStatus,
  type TrendingTopic,
} from "./news-core";

/**
 * Server side of the News hub. Three sections, each built from real feeds only:
 *   - market headlines: public RSS feeds of well-known business news outlets
 *   - ticker news: FMP company news (needs a valid key), SEC EDGAR filings, and Yahoo Finance's per-symbol RSS feed
 *     as a keyless second source. GDELT sector background is optional and only on request, because it is slow and
 *     rate limited.
 *   - watchlist news: Yahoo's per-symbol feed for each symbol
 * Only headline, link, outlet name and time are kept. Feed descriptions and article text are dropped at parse time.
 */

/** Outlets used for market headlines. Names must match GLOBAL_NEWS_SOURCES; an unknown name is skipped. */
export const MARKET_OUTLET_NAMES = [
  "CNBC",
  "MarketWatch",
  "Fox Business",
  "Investing.com",
  "BBC Business",
  "The Guardian — Business",
  "Financial Times",
  "CBC News — Business",
];

const PER_OUTLET = 8;
const MARKET_ITEM_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 9_000;
const MARKET_TTL_MS = 5 * 60_000;
const TICKER_TTL_MS = 5 * 60_000;
const SYMBOL_TTL_MS = 10 * 60_000;
export const MAX_WATCHLIST_SYMBOLS = 12;
export const ITEMS_PER_SYMBOL = 6;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const marketCache = new TtlCache<MarketNewsSection>(MARKET_TTL_MS, 4);
const tickerCache = new TtlCache<NewsSection>(TICKER_TTL_MS, 100);
const symbolCache = new TtlCache<SymbolFetch>(SYMBOL_TTL_MS, 300);

/** Clears every hub cache. For tests. */
export function clearNewsHubCaches(): void {
  marketCache.clear();
  tickerCache.clear();
  symbolCache.clear();
}

const rssParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", htmlEntities: true });

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

async function fetchText(url: string, accept: string, revalidateSeconds: number, label: string): Promise<string> {
  const res = await providerFetch(
    url,
    { headers: { "User-Agent": BROWSER_UA, Accept: accept } },
    { provider: label, path: "feed", timeoutMs: REQUEST_TIMEOUT_MS, maxRetries: 1, revalidateSeconds }
  );
  if (!res.ok) throw new Error(`${label} answered ${res.status}`);
  return res.text();
}

export interface MarketNewsSection extends NewsSection {
  trending: TrendingTopic[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function toItem(
  h: { title: string; url: string; publishedAt: string | null },
  source: string,
  provider: string,
  now: number
): NewsItem | null {
  const title = cleanTitle(h.title);
  const url = safeHttpUrl(h.url);
  if (!title || !url) return null;
  const t = parseFeedTime(h.publishedAt, now);
  return {
    title,
    url: stripTracking(url),
    source,
    provider,
    publishedAt: t?.iso ?? null,
    timeKind: t ? (t.dateOnly ? "date" : "published") : "published",
    kind: "news",
    ...(looksLikeOpinion(title) ? { opinion: true } : {}),
  };
}

/** Market headlines from public business-news RSS feeds. A feed that fails is reported, never hidden. */
export async function getMarketNews(): Promise<MarketNewsSection> {
  const section = await marketCache.get("market", loadMarketNews);
  // A total failure must not be remembered for the whole cache window.
  if (section.error) marketCache.clear();
  return section;
}

async function loadMarketNews(): Promise<MarketNewsSection> {
  const now = Date.now();
  const outlets = MARKET_OUTLET_NAMES.map((n) => GLOBAL_NEWS_SOURCES.find((s) => s.outletName === n)).filter(
    (s): s is NonNullable<typeof s> => !!s && !!s.rssUrl
  );
  const settled = await Promise.allSettled(
    outlets.map(async (o) => {
      const xml = await fetchText(o.rssUrl!, "application/rss+xml, application/atom+xml, application/xml, text/xml", 20 * 60, o.outletName);
      return extractHeadlines(xml, PER_OUTLET);
    })
  );
  const all: NewsItem[] = [];
  const sources: SourceStatus[] = [];
  settled.forEach((r, i) => {
    const o = outlets[i];
    const what = `${o.outletName} (${o.country}). A news outlet. Headlines are read from its public RSS feed.`;
    if (r.status === "fulfilled") {
      const items = r.value.map((h) => toItem(h, o.outletName, "RSS", now)).filter((x): x is NewsItem => x !== null);
      all.push(...items);
      sources.push({
        name: o.outletName,
        what,
        ok: items.length > 0,
        count: items.length,
        note: items.length > 0 ? null : `${o.outletName} sent a feed with no usable headlines.`,
      });
    } else {
      sources.push({ name: o.outletName, what, ok: false, count: 0, note: friendlyError(r.reason, o.outletName) });
    }
  });
  const items = dedupeNews(all).slice(0, MARKET_ITEM_LIMIT);
  const working = sources.filter((s) => s.ok).length;
  const notes: string[] = [];
  let error: string | null = null;
  if (items.length === 0) {
    error = "No outlet answered right now, so there are no headlines to show. Try again in a few minutes.";
  } else if (working < sources.length) {
    notes.push(`${working} of ${sources.length} outlets answered. The rest are listed below with the reason.`);
  }
  const trending = items.length > 0 ? findTrendingTopics(items, { minOutlets: 3, limit: 6 }) : [];
  return { items, sources, asOf: nowIso(), notes, error, trending };
}

interface SymbolFetch {
  items: NewsItem[];
  error: string | null;
}

const YAHOO_WHAT =
  "Yahoo Finance headline feed for one symbol. A public feed from Yahoo, not a documented product, so it can change or stop without notice. The outlet shown is the website the link goes to.";

/** Headlines for one symbol from Yahoo's public per-symbol RSS feed. Descriptions are never read. */
async function fetchYahooSymbol(yahooSymbol: string): Promise<SymbolFetch> {
  // A failure throws inside the cached loader so it is never cached; it is turned into an error result outside.
  try {
    return await symbolCache.get(yahooSymbol, async () => {
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSymbol)}&region=US&lang=en-US`;
      const xml = await fetchText(url, "application/rss+xml, application/xml, text/xml", 10 * 60, "Yahoo Finance feed");
      const parsed = rssParser.parse(xml);
      const rows = asArray(parsed?.rss?.channel?.item) as Record<string, unknown>[];
      const now = Date.now();
      const items: NewsItem[] = [];
      for (const row of rows) {
        const link = typeof row.link === "string" ? row.link : "";
        const safe = safeHttpUrl(link);
        if (!safe) continue;
        const item = toItem(
          { title: String(row.title ?? ""), url: safe, publishedAt: row.pubDate ? String(row.pubDate) : null },
          hostLabel(safe),
          "Yahoo Finance feed",
          now
        );
        if (item) items.push(item);
      }
      return { items, error: null };
    });
  } catch (e) {
    return { items: [], error: friendlyError(e, "The Yahoo Finance feed") };
  }
}

function sourceFromFetch(r: SymbolFetch): SourceStatus {
  return {
    name: "Yahoo Finance feed",
    what: YAHOO_WHAT,
    ok: r.error === null && r.items.length > 0,
    count: r.items.length,
    note: r.error ?? (r.items.length === 0 ? "The feed answered but had no headlines for this symbol." : null),
  };
}

const FMP_WHAT = "Financial Modeling Prep company news and press releases. A paid data service that needs a valid key.";
const SEC_WHAT = "SEC EDGAR. The US government's public filing database. Shows the form type and date, with a link to the filing.";
const GDELT_WHAT =
  "GDELT. A free index that scans news sites around the world and matches them to keywords. It only lists articles it found. It does not read or explain them, and its time is when it first saw the article, not when it was published.";

export type HubAssetClass = AssetClass;

/** Plain reason for an empty background list. The sector lookup for a stock uses FMP, so an FMP failure is not a GDELT failure. */
export function backgroundNote(macroLimit: string | undefined, gdeltFail: string | undefined): string {
  if (macroLimit?.startsWith("No macro-news keyword")) return "There is no background topic set up for this symbol.";
  if (macroLimit?.startsWith("Sector/macro news unavailable")) {
    return "The sector lookup for this stock uses FMP, which is off right now, so background articles cannot be loaded for it.";
  }
  if (macroLimit) return friendlyError(new Error(macroLimit), "GDELT");
  if (gdeltFail) return friendlyError(new Error(gdeltFail), "GDELT");
  return "GDELT had nothing for this topic right now.";
}

/**
 * News for one symbol. Equities combine FMP, SEC EDGAR and the Yahoo feed; other asset classes use the Yahoo feed.
 * includeBackground adds GDELT sector or macro articles (slow and rate limited, so it is opt in).
 */
export async function getTickerNews(ticker: string, assetClass: AssetClass, includeBackground = false): Promise<NewsSection> {
  const symbol = ticker.trim().toUpperCase();
  const section = await tickerCache.get(`${symbol}|${assetClass}|${includeBackground ? 1 : 0}`, () => loadTickerNews(symbol, assetClass, includeBackground));
  if (section.error) tickerCache.clear();
  return section;
}

async function loadTickerNews(symbol: string, assetClass: AssetClass, includeBackground: boolean): Promise<NewsSection> {
  const sources: SourceStatus[] = [];
  const notes: string[] = [];
  const all: NewsItem[] = [];
  const now = Date.now();

  const yahooSupported = assetClass === "equity" || assetClass === "crypto" || assetClass === "forex" || assetClass === "future" || assetClass === "commodity";
  if (!yahooSupported) {
    return {
      items: [],
      sources: [],
      asOf: nowIso(),
      notes: [],
      error: `There is no news source for ${assetClass} symbols in this app. Try the stock or fund the contract is based on.`,
    };
  }

  const wantPanel = assetClass === "equity" || includeBackground;
  const [yahooR, panelR] = await Promise.allSettled([
    fetchYahooSymbol(toYahooSymbol(symbol, assetClass)),
    wantPanel ? getTickerNewsPanel(symbol, assetClass, { includeMacro: includeBackground }) : Promise.resolve(null),
  ]);

  if (yahooR.status === "fulfilled") {
    all.push(...yahooR.value.items);
    sources.push(sourceFromFetch(yahooR.value));
  } else {
    sources.push({ name: "Yahoo Finance feed", what: YAHOO_WHAT, ok: false, count: 0, note: friendlyError(yahooR.reason, "The Yahoo Finance feed") });
  }

  if (panelR.status === "rejected") {
    sources.push({ name: assetClass === "equity" ? "Company news and filings" : "GDELT", what: assetClass === "equity" ? FMP_WHAT : GDELT_WHAT, ok: false, count: 0, note: friendlyError(panelR.reason, "This source") });
  } else if (panelR.value) {
    const panel = panelR.value;
    const limitation = (prefix: string) => panel.dataLimitations.find((d) => d.startsWith(prefix));

    if (assetClass === "equity") {
      const newsLimit = limitation("Company news unavailable");
      const prLimit = limitation("Press releases unavailable");
      const fmpItems = (panel.companyNews ?? [])
        .map((a): NewsItem | null => {
          // FMP does not say which time zone its timestamps use, so only the date part is trusted and shown.
          const it = toItem({ title: a.title, url: a.url, publishedAt: String(a.publishedDate ?? "").slice(0, 10) }, a.kind === "press-release" ? "Company press release" : a.source || "FMP", "FMP", now);
          return it ? { ...it, kind: a.kind } : null;
        })
        .filter((x): x is NewsItem => x !== null);
      all.push(...fmpItems);
      const fmpBad = newsLimit ?? prLimit;
      sources.push({
        name: "FMP company news",
        what: FMP_WHAT,
        ok: !fmpBad && fmpItems.length > 0,
        count: fmpItems.length,
        note: fmpBad ? friendlyError(new Error(fmpBad), "FMP") : fmpItems.length === 0 ? "FMP answered but had no recent company news." : null,
      });

      const secLimit = limitation("SEC filings unavailable");
      const filings = (panel.secFilings ?? [])
        .map((f): NewsItem | null => {
          const url = safeHttpUrl(f.url);
          const t = parseFeedTime(f.filingDate, now);
          if (!url) return null;
          return {
            title: `${cleanTitle(f.form)} filing`,
            url,
            source: "SEC EDGAR",
            provider: "SEC EDGAR",
            publishedAt: t?.iso ?? null,
            timeKind: "date" as const,
            kind: "filing" as const,
          };
        })
        .filter((x): x is NewsItem => x !== null);
      all.push(...filings);
      sources.push({
        name: "SEC EDGAR filings",
        what: SEC_WHAT,
        ok: !secLimit && filings.length > 0,
        count: filings.length,
        note: secLimit ? friendlyError(new Error(secLimit), "SEC EDGAR") : filings.length === 0 ? "No recent 10-K, 10-Q or 8-K filings found." : null,
      });
    }

    if (includeBackground) {
      const macro = panel.macroNews;
      const bgItems = (macro?.articles ?? [])
        .map((a) => toItem({ title: a.title, url: a.url, publishedAt: a.date }, a.domain || "unknown", "GDELT", now))
        .filter((x): x is NewsItem => x !== null)
        .map((x) => ({ ...x, timeKind: "seen" as const }));
      all.push(...bgItems);
      const macroLimit = limitation("Sector/macro news unavailable") ?? limitation("Macro news unavailable") ?? limitation("No macro-news keyword");
      const gdeltFail = macro?.dataLimitations.find((d) => d.startsWith("Article list unavailable"));
      sources.push({
        name: "GDELT background",
        what: GDELT_WHAT,
        ok: bgItems.length > 0,
        count: bgItems.length,
        note: bgItems.length > 0 ? null : backgroundNote(macroLimit, gdeltFail),
      });
    }
  }

  const items = dedupeNews(all);
  if (items.length === 0 && sources.every((s) => !s.ok)) {
    return {
      items: [],
      sources,
      asOf: nowIso(),
      notes,
      error: "No source returned headlines for this symbol right now. That can mean a quiet day, a wrong symbol, or sources that are off. The list below says which.",
    };
  }
  const fmp = sources.find((s) => s.name === "FMP company news");
  if (fmp && !fmp.ok && fmp.note && /refused|not set up/.test(fmp.note)) {
    notes.push("Company news from FMP is off, so the Yahoo Finance feed and SEC filings are shown instead.");
  }
  return { items, sources, asOf: nowIso(), notes, error: null };
}

export interface WatchlistGroup {
  symbol: string;
  assetClass: AssetClass;
  items: NewsItem[];
  /** Headlines (after merging repeats) published in the last 24 hours, counted before the list is cut to its display size. */
  last24h: number;
  note: string | null;
}

export interface WatchlistNewsSection {
  groups: WatchlistGroup[];
  sources: SourceStatus[];
  asOf: string;
  notes: string[];
  error: string | null;
  /** Symbols dropped because of the cap, a bad format or an unsupported asset class. */
  skipped: { symbol: string; reason: string }[];
}

const WATCHLIST_ASSET_CLASSES: AssetClass[] = ["equity", "crypto", "forex", "future", "commodity"];

export interface WatchlistInput {
  symbol: string;
  assetClass: AssetClass;
}

/**
 * Headlines for each symbol on a list. At most 12 distinct symbols are used. Symbols are fetched four at a time from
 * the Yahoo feed (cached 10 minutes per symbol), so one slow symbol cannot hold up the rest.
 */
export async function getWatchlistNews(entries: WatchlistInput[]): Promise<WatchlistNewsSection> {
  const skipped: WatchlistNewsSection["skipped"] = [];
  const seen = new Set<string>();
  const wanted: WatchlistInput[] = [];
  for (const e of entries) {
    if (!e || !isHubSymbol(e.symbol)) {
      skipped.push({ symbol: String((e as { symbol?: unknown })?.symbol ?? "").slice(0, 20), reason: "Not a valid symbol." });
      continue;
    }
    const symbol = e.symbol.trim().toUpperCase();
    if (!WATCHLIST_ASSET_CLASSES.includes(e.assetClass)) {
      skipped.push({ symbol, reason: `No news source for ${e.assetClass} symbols.` });
      continue;
    }
    const key = `${symbol}|${e.assetClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (wanted.length >= MAX_WATCHLIST_SYMBOLS) {
      skipped.push({ symbol, reason: `Only the first ${MAX_WATCHLIST_SYMBOLS} symbols are shown.` });
      continue;
    }
    wanted.push({ symbol, assetClass: e.assetClass });
  }

  if (wanted.length === 0) {
    return {
      groups: [],
      sources: [],
      asOf: nowIso(),
      notes: [],
      error: entries.length === 0 ? "The list is empty, so there is no news to show. Add symbols first." : "None of the symbols on the list have a news source.",
      skipped,
    };
  }

  const results: SymbolFetch[] = new Array(wanted.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(4, wanted.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= wanted.length) return;
      results[i] = await fetchYahooSymbol(toYahooSymbol(wanted[i].symbol, wanted[i].assetClass));
    }
  });
  await Promise.all(workers);

  const groups: WatchlistGroup[] = wanted.map((w, i) => {
    const r = results[i];
    const merged = dedupeNews(r.items);
    const cutoff = Date.now() - 24 * 3600_000;
    const last24h = merged.filter((i) => i.publishedAt !== null && Date.parse(i.publishedAt) >= cutoff).length;
    const items = merged.slice(0, ITEMS_PER_SYMBOL);
    return {
      symbol: w.symbol,
      assetClass: w.assetClass,
      items,
      last24h,
      note: r.error ?? (items.length === 0 ? "No recent headlines for this symbol." : null),
    };
  });
  const failures = results.filter((r) => r.error !== null).length;
  const withNews = groups.filter((g) => g.items.length > 0).length;
  const sources: SourceStatus[] = [
    {
      name: "Yahoo Finance feed",
      what: YAHOO_WHAT,
      ok: failures < results.length,
      count: groups.reduce((n, g) => n + g.items.length, 0),
      note: failures === 0 ? null : `${failures} of ${results.length} symbols could not be loaded.`,
    },
  ];
  const notes: string[] = [];
  if (withNews === 0 && failures === results.length) {
    return { groups, sources, asOf: nowIso(), notes, error: "The news feed did not answer for any symbol. Try again in a few minutes.", skipped };
  }
  return { groups, sources, asOf: nowIso(), notes, error: null, skipped };
}
