import { GLOBAL_NEWS_SOURCES } from "@/lib/agents/trading-agent/skills/global-financial-news";
import type { AssetClass } from "@/lib/agents/trading-agent/types";

/**
 * Category map for ticker news. For each asset class it says which feeds make up "About this asset" (specific) news and
 * which make up "Market and macro" news. Server side only (it reads the Global News outlet list).
 *
 * Every feed below was fetched live on 2026-10-18 and returned items with current dates, or comes from the existing Global
 * News list (which answered live the same day). Feeds I tried that failed are listed in REJECTED_FEEDS and are not used.
 *
 * How the two groups are filled for a ticker:
 *   About this asset  = the symbol's own feeds (Yahoo per-symbol feed, FMP, SEC EDGAR for stocks)
 *                       + items from the category feeds whose headline names the asset (keyword match)
 *   Market and macro  = the remaining category-feed items (the wider crypto, energy, metals ... news)
 *                       + the broad market outlets in MACRO_FEED_IDS
 */

export type FeedOrigin = "global-list" | "probed-2026-10-18";

export interface FeedDef {
  id: string;
  /** Outlet name shown to readers. */
  name: string;
  /** One plain sentence on what the source is. */
  what: string;
  url: string;
  origin: FeedOrigin;
}

function fromGlobalList(id: string, outletName: string, what: string): FeedDef {
  const src = GLOBAL_NEWS_SOURCES.find((s) => s.outletName === outletName);
  if (!src || !src.rssUrl) throw new Error(`Global News list has no feed for "${outletName}"`);
  return { id, name: outletName, what, url: src.rssUrl, origin: "global-list" };
}

function probed(id: string, name: string, what: string, url: string): FeedDef {
  return { id, name, what, url, origin: "probed-2026-10-18" };
}

export const FEEDS: Record<string, FeedDef> = Object.fromEntries(
  [
    // Broad market outlets, reused from the Global News list.
    fromGlobalList("cnbc", "CNBC", "CNBC. A US business news channel. Headlines come from its public RSS feed."),
    fromGlobalList("marketwatch", "MarketWatch", "MarketWatch. A US markets news site. Headlines come from its public RSS feed."),
    fromGlobalList("bbc-business", "BBC Business", "BBC Business. The business pages of the BBC. Headlines come from its public RSS feed."),
    fromGlobalList("ft", "Financial Times", "Financial Times. A business newspaper. Headlines come from its public RSS feed."),
    fromGlobalList("guardian-business", "The Guardian — Business", "The Guardian business pages. Headlines come from its public RSS feed."),
    // Crypto.
    probed("coindesk", "CoinDesk", "CoinDesk. A crypto news site.", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    probed("cointelegraph", "Cointelegraph", "Cointelegraph. A crypto news site.", "https://cointelegraph.com/rss"),
    probed("decrypt", "Decrypt", "Decrypt. A crypto and web3 news site.", "https://decrypt.co/feed"),
    probed("theblock", "The Block", "The Block. A crypto news site.", "https://www.theblock.co/rss.xml"),
    probed("beincrypto", "BeInCrypto", "BeInCrypto. A crypto news site.", "https://beincrypto.com/feed/"),
    probed("investing-crypto", "Investing.com crypto", "Investing.com crypto news. Times in this feed have no time zone, so they are read as UTC.", "https://www.investing.com/rss/news_301.rss"),
    // Energy.
    probed("oilprice", "OilPrice.com", "OilPrice.com. An oil and energy news site.", "https://oilprice.com/rss/main"),
    probed("rigzone", "Rigzone", "Rigzone. An oil and gas industry news site.", "https://www.rigzone.com/news/rss/rigzone_latest.aspx"),
    probed("eia", "EIA", "EIA is a US government agency. It posts short reports on energy.", "https://www.eia.gov/rss/todayinenergy.xml"),
    probed("cnbc-energy", "CNBC Energy", "CNBC energy news. Headlines come from its public RSS feed.", "https://www.cnbc.com/id/19836768/device/rss/rss.html"),
    // Metals.
    probed("mining", "Mining.com", "Mining.com. A mining and metals news site.", "https://www.mining.com/feed/"),
    // Agriculture.
    probed("farmprogress", "Farm Progress", "Farm Progress. A farm news site.", "https://www.farmprogress.com/rss.xml"),
    probed("usda", "USDA news", "USDA is a US government agency for farms and food. These are its news releases.", "https://www.usda.gov/rss/latest-releases.xml"),
    // Currencies.
    probed("fxstreet", "FXStreet", "FXStreet. A currency market news site.", "https://www.fxstreet.com/rss/news"),
    probed("forexlive", "ForexLive", "ForexLive. A currency market news site.", "https://www.forexlive.com/feed/news"),
    probed("investing-forex", "Investing.com currencies", "Investing.com currency news. Times in this feed have no time zone, so they are read as UTC.", "https://www.investing.com/rss/news_1.rss"),
  ].map((f) => [f.id, f])
);

/** Tried on 2026-10-18 and not used: each one failed or was stale. Kept so nobody re-tests them by guess. */
export const REJECTED_FEEDS: { name: string; why: string }[] = [
  { name: "Kitco", why: "feed returns HTTP 404" },
  { name: "DTN Progressive Farmer", why: "feed returns HTTP 404" },
  { name: "Successful Farming", why: "request blocked (HTTP 403)" },
  { name: "Brownfield Ag News", why: "request blocked (HTTP 403)" },
  { name: "US Treasury press releases", why: "feed returns HTTP 404" },
  { name: "DailyFX", why: "request timed out" },
  { name: "Bitcoin Magazine", why: "feed stale (latest item two days old)" },
  { name: "Yahoo Finance front-page feed (Global News list)", why: "feed returns HTTP 404" },
  { name: "CNBC Bonds section feed", why: "answers, but its headlines are general stock stories, not bond news" },
  { name: "CNBC Commodities section feed", why: "answers, but its headlines are general stock stories, not commodity news" },
  { name: "Investing.com commodities feed", why: "answers, but its headlines are general world news" },
  { name: "Investing.com bonds feed", why: "answers, but its headlines are general world news" },
];

/** Broad market outlets used for "Market and macro" on every asset class. */
export const MACRO_FEED_IDS = ["cnbc", "marketwatch", "bbc-business", "ft", "guardian-business"];

export type Topic = "stock" | "crypto" | "energy" | "metals" | "agriculture" | "equity-index" | "rates" | "currency" | "bond" | "unknown";

export const TOPIC_LABEL: Record<Topic, string> = {
  stock: "Stock",
  crypto: "Crypto",
  energy: "Energy",
  metals: "Metals",
  agriculture: "Farm goods",
  "equity-index": "Stock index",
  rates: "Interest rates",
  currency: "Currency",
  bond: "Bonds",
  unknown: "Market",
};

/** Category feeds per topic (their own category news). */
export const TOPIC_FEED_IDS: Record<Topic, string[]> = {
  stock: [],
  crypto: ["coindesk", "cointelegraph", "decrypt", "theblock", "beincrypto", "investing-crypto"],
  energy: ["oilprice", "rigzone", "eia", "cnbc-energy"],
  metals: ["mining", "fxstreet"],
  agriculture: ["farmprogress", "usda"],
  "equity-index": [],
  rates: ["forexlive", "investing-forex", "fxstreet"],
  currency: ["fxstreet", "forexlive", "investing-forex"],
  bond: ["forexlive", "investing-forex", "fxstreet"],
  unknown: ["fxstreet", "mining", "oilprice"],
};

/** Words that mark a headline as bond market or interest rate news. */
export const RATES_KEYWORDS = ["bond", "bonds", "yield", "yields", "treasury", "treasuries", "fed", "federal reserve", "interest rate", "interest rates", "rate cut", "rate cuts", "rate hike", "rate hikes", "inflation", "central bank", "debt auction"];

interface CommodityRule {
  topic: Topic;
  keywords: string[];
}

/**
 * Commodity and futures symbols. The app's commodity and futures lists are ETF proxies (GLD, USO, SPY, TLT ...), and the
 * common futures root symbols (CL, GC, ES ...) are covered too so a real futures symbol routes the same way.
 */
const COMMODITY_RULES: Record<string, CommodityRule> = {
  GLD: { topic: "metals", keywords: ["gold"] },
  IAU: { topic: "metals", keywords: ["gold"] },
  GC: { topic: "metals", keywords: ["gold"] },
  SLV: { topic: "metals", keywords: ["silver"] },
  SI: { topic: "metals", keywords: ["silver"] },
  CPER: { topic: "metals", keywords: ["copper"] },
  HG: { topic: "metals", keywords: ["copper"] },
  PPLT: { topic: "metals", keywords: ["platinum"] },
  PALL: { topic: "metals", keywords: ["palladium"] },
  USO: { topic: "energy", keywords: ["oil", "crude", "wti", "brent", "opec"] },
  CL: { topic: "energy", keywords: ["oil", "crude", "wti", "brent", "opec"] },
  BZ: { topic: "energy", keywords: ["oil", "crude", "brent", "opec"] },
  UNG: { topic: "energy", keywords: ["natural gas", "lng"] },
  NG: { topic: "energy", keywords: ["natural gas", "lng"] },
  DBA: { topic: "agriculture", keywords: ["crop", "grain", "corn", "wheat", "soybean", "farm", "agricultur"] },
  WEAT: { topic: "agriculture", keywords: ["wheat"] },
  ZW: { topic: "agriculture", keywords: ["wheat"] },
  CORN: { topic: "agriculture", keywords: ["corn"] },
  ZC: { topic: "agriculture", keywords: ["corn"] },
  ZS: { topic: "agriculture", keywords: ["soybean", "soy"] },
  SPY: { topic: "equity-index", keywords: ["s&p 500", "s&p", "wall street"] },
  ES: { topic: "equity-index", keywords: ["s&p 500", "s&p", "wall street"] },
  QQQ: { topic: "equity-index", keywords: ["nasdaq"] },
  NQ: { topic: "equity-index", keywords: ["nasdaq"] },
  DIA: { topic: "equity-index", keywords: ["dow"] },
  YM: { topic: "equity-index", keywords: ["dow"] },
  IWM: { topic: "equity-index", keywords: ["russell", "small-cap", "small cap"] },
  TLT: { topic: "rates", keywords: RATES_KEYWORDS },
  ZN: { topic: "rates", keywords: RATES_KEYWORDS },
  ZB: { topic: "rates", keywords: RATES_KEYWORDS },
};

const CRYPTO_ALIASES: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "ether", "eth"],
  SOL: ["solana"],
  XRP: ["xrp", "ripple"],
  DOGE: ["dogecoin", "doge"],
  ADA: ["cardano"],
  AVAX: ["avalanche"],
  LINK: ["chainlink"],
  LTC: ["litecoin"],
  BCH: ["bitcoin cash"],
  DOT: ["polkadot"],
  UNI: ["uniswap"],
  SHIB: ["shiba"],
  BNB: ["bnb", "binance coin"],
};

const CURRENCY_WORDS: Record<string, string[]> = {
  USD: ["dollar", "greenback"],
  EUR: ["euro"],
  GBP: ["pound", "sterling"],
  JPY: ["yen"],
  CHF: ["franc"],
  AUD: ["aussie", "australian dollar"],
  CAD: ["loonie", "canadian dollar"],
  NZD: ["kiwi", "new zealand dollar"],
  CNY: ["yuan", "renminbi"],
  MXN: ["peso"],
};

/** Plain OCC option symbol, for example AAPL261218C00200000. */
const OCC_OPTION_RE = /^([A-Z.]{1,6})\d{6}[CP]\d{8}$/;

export interface NewsPlan {
  /** Symbol to use for the symbol-level feeds (the underlying for an option). */
  symbol: string;
  /** Asset class to use for the symbol-level feeds. */
  assetClass: AssetClass;
  topic: Topic;
  topicLabel: string;
  /** Category feeds, split into About and Macro by keyword match. */
  categoryFeedIds: string[];
  /** Broad market feeds, always "Market and macro". */
  macroFeedIds: string[];
  /** A headline in a category feed that contains one of these goes to "About this asset". */
  keywords: string[];
  /** When true every category-feed item belongs to "About this asset". Not used by any class now; kept for maps that have a feed about exactly one thing. */
  categoryIsAbout: boolean;
  /** When true the keyword match is also applied to the broad market outlets (bonds and rates, which no topic feed covers well). */
  matchMacroToo: boolean;
  /** Plain note to show with the About group when it is not about one named asset. */
  aboutNote: string | null;
  /** True when the symbol-level feeds (Yahoo, FMP, SEC) can be asked about this symbol. */
  hasSymbolFeed: boolean;
}

/** Strips a leading slash and a trailing "=F" or contract month, for futures root lookup ("/ES", "CL=F", "ESZ6"). */
export function futuresRoot(symbol: string): string {
  let s = symbol.trim().toUpperCase().replace(/^\//, "").replace(/=F$/, "");
  const m = /^([A-Z]{1,3})[FGHJKMNQUVXZ]\d{1,2}$/.exec(s);
  if (m && COMMODITY_RULES[m[1]]) s = m[1];
  return s;
}

/** Coin keywords for a crypto symbol like "BTC-USD" or "ETH/USD". */
export function cryptoKeywords(symbol: string): string[] {
  const up = symbol.trim().toUpperCase();
  const stripped = up.replace(/[-/_]?(USDT|USDC|USD)$/, "");
  const base = stripped.length >= 2 ? stripped : up;
  if (CRYPTO_ALIASES[base]) return CRYPTO_ALIASES[base];
  return base.length >= 3 ? [base.toLowerCase()] : [];
}

/** Keywords for a currency pair: the pair text, plus the names of the non-dollar currency (or both, for a cross). */
export function forexKeywords(symbol: string): string[] {
  const flat = symbol.trim().toUpperCase().replace(/[/_-]/g, "");
  if (!/^[A-Z]{6}$/.test(flat)) return [];
  const a = flat.slice(0, 3);
  const b = flat.slice(3);
  const out = [`${a}/${b}`.toLowerCase(), flat.toLowerCase()];
  const codes = a === "USD" ? [b] : b === "USD" ? [a] : [a, b];
  for (const c of codes) out.push(c.toLowerCase(), ...(CURRENCY_WORDS[c] ?? []));
  return out;
}

/** Whether a headline names the asset. Whole-word match, so "eth" does not match "method". */
export function matchesKeywords(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const t = title.toLowerCase();
  return keywords.some((k) => {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A keyword ending in a letter must end at a word edge, except stems like "agricultur" that are meant as prefixes.
    const tail = k === "agricultur" ? "" : "\\b";
    return new RegExp(`(^|[^a-z0-9])${esc}${tail}`, "i").test(t);
  });
}

/** Decides which feeds and keywords a symbol uses. Pure; no network. */
export function planNews(symbolIn: string, assetClass: AssetClass): NewsPlan {
  const symbol = symbolIn.trim().toUpperCase();
  const base = { macroFeedIds: MACRO_FEED_IDS, aboutNote: null as string | null, matchMacroToo: false };

  if (assetClass === "option") {
    const m = OCC_OPTION_RE.exec(symbol);
    if (m) {
      const inner = planNews(m[1], "equity");
      return { ...inner, aboutNote: `This is an option. The news is about its stock, ${m[1]}.` };
    }
    return {
      symbol,
      assetClass,
      topic: "unknown",
      topicLabel: TOPIC_LABEL.unknown,
      categoryFeedIds: [],
      macroFeedIds: MACRO_FEED_IDS,
      keywords: [],
      categoryIsAbout: false,
      matchMacroToo: false,
      aboutNote: "This option symbol could not be read, so there is no stock to look up. Try the stock it is based on.",
      hasSymbolFeed: false,
    };
  }

  if (assetClass === "equity") {
    return { ...base, symbol, assetClass, topic: "stock", topicLabel: TOPIC_LABEL.stock, categoryFeedIds: [], keywords: [], categoryIsAbout: false, hasSymbolFeed: true };
  }

  if (assetClass === "crypto") {
    return { ...base, symbol, assetClass, topic: "crypto", topicLabel: TOPIC_LABEL.crypto, categoryFeedIds: TOPIC_FEED_IDS.crypto, keywords: cryptoKeywords(symbol), categoryIsAbout: false, hasSymbolFeed: true };
  }

  if (assetClass === "forex") {
    return { ...base, symbol, assetClass, topic: "currency", topicLabel: TOPIC_LABEL.currency, categoryFeedIds: TOPIC_FEED_IDS.currency, keywords: forexKeywords(symbol), categoryIsAbout: false, hasSymbolFeed: true };
  }

  if (assetClass === "bond") {
    return {
      ...base,
      symbol,
      assetClass,
      topic: "bond",
      topicLabel: TOPIC_LABEL.bond,
      categoryFeedIds: TOPIC_FEED_IDS.bond,
      keywords: RATES_KEYWORDS,
      categoryIsAbout: false,
      matchMacroToo: true,
      aboutNote: "No outlet covers a single bond. This is bond market and interest rate news.",
      hasSymbolFeed: false,
    };
  }

  // commodity and future
  const rule = COMMODITY_RULES[futuresRoot(symbol)];
  const topic: Topic = rule?.topic ?? "unknown";
  return {
    ...base,
    symbol,
    assetClass,
    topic,
    topicLabel: TOPIC_LABEL[topic],
    categoryFeedIds: TOPIC_FEED_IDS[topic],
    keywords: rule?.keywords ?? [],
    categoryIsAbout: false,
    matchMacroToo: topic === "rates",
    hasSymbolFeed: true,
  };
}

/** Every feed id a plan uses, checked by the tests so a typo in a map cannot reach production. */
export function planFeedIds(plan: NewsPlan): string[] {
  return [...plan.categoryFeedIds, ...plan.macroFeedIds];
}

export const ALL_ASSET_CLASSES: AssetClass[] = ["equity", "crypto", "commodity", "future", "forex", "bond", "option"];
