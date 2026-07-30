import { XMLParser } from "fast-xml-parser";
import type { GlobalFinancialNewsResult, GlobalNewsHeadline, GlobalNewsSource, GlobalNewsSourceResult } from "../types";

/**
 * "Highest-viewed financial news program per country" isn't something any
 * API tracks — TV/media viewership rankings are audience-ratings data, not
 * news content, and no free or paid API publishes that as structured data.
 * What's real and buildable instead: multiple real financial-news outlets
 * per country, hand-researched and live-verified (curl'd directly with a
 * real browser User-Agent, not guessed) this session — same standard as
 * every other curated ticker/source list in this app (SECTOR_CONSTITUENTS,
 * MAJOR_PAIR_KEYWORDS). rssUrl is null where no working public feed could be
 * found after real attempts; those render as a reference link only, never
 * fabricated headlines. Coverage is uneven by design — some countries have
 * 5 verified feeds, others have 1-2 because every other candidate tried
 * genuinely failed (bot-blocked, 404, or deprecated). More can be added as
 * real feeds are found.
 */
export const GLOBAL_NEWS_SOURCES: GlobalNewsSource[] = [
  // United States (5)
  { country: "United States", outletName: "CNBC", websiteUrl: "https://www.cnbc.com", rssUrl: "https://www.cnbc.com/id/10001147/device/rss/rss.html" },
  { country: "United States", outletName: "Yahoo Finance", websiteUrl: "https://finance.yahoo.com", rssUrl: "https://finance.yahoo.com/news/rssindex" },
  { country: "United States", outletName: "Fox Business", websiteUrl: "https://www.foxbusiness.com", rssUrl: "https://moxie.foxbusiness.com/google-publisher/latest.xml" },
  { country: "United States", outletName: "MarketWatch", websiteUrl: "https://www.marketwatch.com", rssUrl: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { country: "United States", outletName: "Investing.com", websiteUrl: "https://www.investing.com", rssUrl: "https://www.investing.com/rss/news.rss" },

  // United Kingdom (4)
  { country: "United Kingdom", outletName: "Financial Times", websiteUrl: "https://www.ft.com", rssUrl: "https://www.ft.com/rss/home" },
  { country: "United Kingdom", outletName: "BBC Business", websiteUrl: "https://www.bbc.com/news/business", rssUrl: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { country: "United Kingdom", outletName: "The Guardian — Business", websiteUrl: "https://www.theguardian.com/uk/business", rssUrl: "https://www.theguardian.com/uk/business/rss" },
  { country: "United Kingdom", outletName: "Sky News — Business", websiteUrl: "https://news.sky.com/business", rssUrl: "https://feeds.skynews.com/feeds/rss/business.xml" },

  // Japan (2)
  { country: "Japan", outletName: "Nikkei Asia", websiteUrl: "https://asia.nikkei.com", rssUrl: "https://asia.nikkei.com/rss/feed/nar" },
  { country: "Japan", outletName: "NHK News — Business", websiteUrl: "https://www3.nhk.or.jp/nhkworld/en/news/", rssUrl: "https://www3.nhk.or.jp/rss/news/cat5.xml" },

  // Germany (3)
  { country: "Germany", outletName: "DW Business", websiteUrl: "https://www.dw.com/en/business/s-1431", rssUrl: "https://rss.dw.com/xml/rss-en-bus" },
  { country: "Germany", outletName: "Der Spiegel — Wirtschaft", websiteUrl: "https://www.spiegel.de/wirtschaft/", rssUrl: "https://www.spiegel.de/wirtschaft/index.rss" },
  { country: "Germany", outletName: "Manager Magazin", websiteUrl: "https://www.manager-magazin.de", rssUrl: "https://www.manager-magazin.de/unternehmen/index.rss" },

  // France (2)
  { country: "France", outletName: "France 24 — Business", websiteUrl: "https://www.france24.com/en/business/", rssUrl: "https://www.france24.com/en/business/rss" },
  { country: "France", outletName: "Le Monde — Économie", websiteUrl: "https://www.lemonde.fr/economie/", rssUrl: "https://www.lemonde.fr/economie/rss_full.xml" },

  // Switzerland (2)
  { country: "Switzerland", outletName: "finews", websiteUrl: "https://www.finews.com", rssUrl: "https://www.finews.com/news/english-news?format=feed&type=rss" },
  { country: "Switzerland", outletName: "Le News", websiteUrl: "https://lenews.ch", rssUrl: "https://lenews.ch/feed/" },

  // India (4)
  { country: "India", outletName: "Economic Times Markets", websiteUrl: "https://economictimes.indiatimes.com/markets", rssUrl: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms" },
  { country: "India", outletName: "Mint Markets", websiteUrl: "https://www.livemint.com/market", rssUrl: "https://www.livemint.com/rss/markets" },
  { country: "India", outletName: "The Hindu Business Line", websiteUrl: "https://www.thehindubusinessline.com", rssUrl: "https://www.thehindubusinessline.com/?service=rss" },
  { country: "India", outletName: "NDTV Profit", websiteUrl: "https://www.ndtvprofit.com", rssUrl: "https://prod-qt-images.s3.amazonaws.com/production/bloombergquint/feed.xml" },

  // Hong Kong (2)
  { country: "Hong Kong", outletName: "South China Morning Post — Business", websiteUrl: "https://www.scmp.com/business", rssUrl: "https://www.scmp.com/rss/92/feed" },
  { country: "Hong Kong", outletName: "Hong Kong Free Press — Business", websiteUrl: "https://hongkongfp.com/category/business/", rssUrl: "https://hongkongfp.com/category/business/feed/" },

  // Mainland China (2)
  { country: "China", outletName: "CGTN — Business", websiteUrl: "https://www.cgtn.com/business", rssUrl: "https://www.cgtn.com/subscribe/rss/section/business.xml" },
  { country: "China", outletName: "Sixth Tone", websiteUrl: "https://www.sixthtone.com", rssUrl: "https://www.sixthtone.com/rss" },

  // South Africa (2)
  { country: "South Africa", outletName: "Fin24", websiteUrl: "https://www.news24.com/fin24", rssUrl: "https://feeds.capi24.com/v1/Search/articles/fin24/topstories/rss" },
  { country: "South Africa", outletName: "Moneyweb", websiteUrl: "https://www.moneyweb.co.za", rssUrl: "https://www.moneyweb.co.za/feed/" },

  // Canada (2)
  { country: "Canada", outletName: "Financial Post", websiteUrl: "https://financialpost.com", rssUrl: "https://financialpost.com/feed" },
  { country: "Canada", outletName: "CBC News — Business", websiteUrl: "https://www.cbc.ca/news/business", rssUrl: "https://www.cbc.ca/webfeed/rss/rss-business" },

  // Australia (3)
  { country: "Australia", outletName: "ABC News — Business", websiteUrl: "https://www.abc.net.au/news/business", rssUrl: "https://www.abc.net.au/news/feed/51892/rss.xml" },
  { country: "Australia", outletName: "Business News Australia", websiteUrl: "https://www.businessnews.com.au", rssUrl: "https://www.businessnews.com.au/rssfeed/latest.rss" },
  { country: "Australia", outletName: "International Business Times Australia", websiteUrl: "https://www.ibtimes.com.au", rssUrl: "https://www.ibtimes.com.au/rss" },

  // Singapore (3)
  { country: "Singapore", outletName: "The Business Times", websiteUrl: "https://www.businesstimes.com.sg", rssUrl: "https://www.businesstimes.com.sg/rss/singapore" },
  { country: "Singapore", outletName: "The Straits Times — Business", websiteUrl: "https://www.straitstimes.com/business", rssUrl: "https://www.straitstimes.com/news/business/rss.xml" },
  { country: "Singapore", outletName: "CNA — Business", websiteUrl: "https://www.channelnewsasia.com/business", rssUrl: "https://www.channelnewsasia.com/rssfeeds/8395986" },

  // South Korea (1 — real feed, but its XML doesn't parse cleanly; kept
  // as-is so the real error shows rather than being silently dropped)
  { country: "South Korea", outletName: "The Korea Herald — Business", websiteUrl: "https://www.koreaherald.com/list.php?ct=020000000000", rssUrl: "http://www.koreaherald.com/rss/020000000000.xml" },

  // Brazil — every candidate tried (InfoMoney, Valor Econômico, G1 Economia,
  // Exame, CNN Brasil Business) either 404'd or returned an empty feed body
  // on repeated real requests; reference link only rather than a flaky feed.
  { country: "Brazil", outletName: "Valor Econômico", websiteUrl: "https://valor.globo.com", rssUrl: null },

  // United Arab Emirates (1 — every other candidate tried genuinely 404'd)
  { country: "United Arab Emirates", outletName: "Arabian Business", websiteUrl: "https://www.arabianbusiness.com", rssUrl: "https://www.arabianbusiness.com/feed" },
  { country: "United Arab Emirates", outletName: "Gulf News — Business", websiteUrl: "https://gulfnews.com/business", rssUrl: null },
];

const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// htmlEntities: true — several feeds (MarketWatch's Warsh headline being the
// one that surfaced this) encode apostrophes/quotes as numeric HTML entities
// (&#x2019;) rather than plain XML entities; fast-xml-parser only decodes
// the 5 basic XML entities by default and leaves those as literal text.
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", htmlEntities: true });

const MAX_HEADLINES_PER_SOURCE = 3;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

interface AtomLink {
  "@_href"?: string;
  "@_rel"?: string;
}

function atomLinkHref(rawLink: unknown): string {
  if (typeof rawLink === "string") return rawLink;
  const links = asArray(rawLink as AtomLink | AtomLink[]);
  const alternate = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return alternate?.["@_href"] ?? "";
}

/**
 * Handles the three feed shapes seen live across the sources above: RSS 2.0
 * (<rss><channel><item>), RSS 1.0/RDF (<rdf:RDF><item>, e.g. Nikkei Asia),
 * and Atom (<feed><entry>, e.g. NDTV Profit) — Atom uses <link href="...">
 * (an attribute, possibly multiple <link> tags with different rel values)
 * rather than RSS's plain-text <link>.
 */
function extractHeadlines(xml: string): GlobalNewsHeadline[] {
  const parsed = xmlParser.parse(xml);

  if (parsed?.feed?.entry) {
    const entries = asArray(parsed.feed.entry);
    return entries
      .slice(0, MAX_HEADLINES_PER_SOURCE)
      .map((entry: Record<string, unknown>) => ({
        title: String(entry.title ?? "").trim(),
        url: atomLinkHref(entry.link).trim(),
        publishedAt: entry.published ? String(entry.published) : entry.updated ? String(entry.updated) : null,
      }))
      .filter((h: GlobalNewsHeadline) => h.title && h.url);
  }

  const items = asArray(parsed?.rss?.channel?.item ?? parsed?.["rdf:RDF"]?.item);
  return items
    .slice(0, MAX_HEADLINES_PER_SOURCE)
    .map((item: Record<string, unknown>) => {
      const rawLink = item.link;
      const link = typeof rawLink === "string" ? rawLink : (rawLink as { "@_rdf:resource"?: string } | undefined)?.["@_rdf:resource"] ?? "";
      return {
        title: String(item.title ?? "").trim(),
        url: String(link).trim(),
        publishedAt: item.pubDate ? String(item.pubDate) : item["dc:date"] ? String(item["dc:date"]) : null,
      };
    })
    .filter((h: GlobalNewsHeadline) => h.title && h.url);
}

async function fetchSourceHeadlines(source: GlobalNewsSource): Promise<GlobalNewsSourceResult> {
  if (!source.rssUrl) {
    return { source, headlines: [], error: "No working public RSS feed found for this outlet — reference link only." };
  }
  try {
    const res = await fetch(source.rssUrl, {
      headers: { "User-Agent": REALISTIC_USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      next: { revalidate: 60 * 20 }, // 20 min cache — headline feeds don't need to be sub-minute fresh
    });
    if (!res.ok) {
      return { source, headlines: [], error: `Feed request failed: ${res.status}` };
    }
    const xml = await res.text();
    const headlines = extractHeadlines(xml);
    if (headlines.length === 0) {
      return { source, headlines: [], error: "Feed returned no parseable items." };
    }
    return { source, headlines, error: null };
  } catch (err) {
    return { source, headlines: [], error: err instanceof Error ? err.message : "Unknown fetch error" };
  }
}

export async function getGlobalFinancialNews(): Promise<GlobalFinancialNewsResult> {
  const settled = await Promise.allSettled(GLOBAL_NEWS_SOURCES.map(fetchSourceHeadlines));
  const results: GlobalNewsSourceResult[] = settled.map((r, i) =>
    r.status === "fulfilled" ? r.value : { source: GLOBAL_NEWS_SOURCES[i], headlines: [], error: "Unexpected fetch failure." }
  );

  const countryCount = new Set(GLOBAL_NEWS_SOURCES.map((s) => s.country)).size;
  const referenceOnlyCount = results.filter((r) => r.source.rssUrl === null).length;
  const liveFailedCount = results.filter((r) => r.source.rssUrl !== null && r.error !== null).length;

  const dataLimitations: string[] = [
    `${countryCount} countries, ${GLOBAL_NEWS_SOURCES.length} outlets total — ${GLOBAL_NEWS_SOURCES.length - referenceOnlyCount} with a live, verified RSS feed and ${referenceOnlyCount} as reference-link-only (no working public feed found for that outlet after real attempts). Coverage per country is uneven by design (1-5 outlets) — every candidate feed was actually tested, this isn't a padded or comprehensive directory.`,
    "No source here is ranked by actual TV/media viewership — that's audience-ratings data no free or paid API publishes. Each entry is simply a real, internationally recognized financial-news outlet for that country.",
  ];
  if (liveFailedCount > 0) {
    dataLimitations.push(`${liveFailedCount} source(s) with a known RSS URL failed on this fetch (outlet-side outage, blocked request, or feed format change) — see each card's own error.`);
  }

  return { results, dataLimitations };
}
