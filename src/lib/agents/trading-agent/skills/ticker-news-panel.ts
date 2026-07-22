import { fetchProfile, fetchPressReleases, fetchStockNews } from "@/lib/data/fmp";
import { fetchRecentFilings } from "@/lib/data/sec-edgar";
import { getGeopoliticalNews, MAJOR_PAIR_KEYWORDS } from "./geopolitical-news";
import { COMMODITY_FUTURES_NEWS_KEYWORDS, FALLBACK_SECTOR_KEYWORDS, SECTOR_NEWS_KEYWORDS } from "./sector-news-keywords";
import type { AssetClass, CompanyNewsArticle, SecFilingSummary, TickerNewsPanelResult } from "../types";

/**
 * Composes 3 independent sources (FMP company news, FMP press releases, SEC
 * EDGAR filings, plus GDELT macro/sector news) per ticker. Each source fails
 * independently — one source failing degrades into dataLimitations for that
 * section only, never blanks the whole panel. Company news/filings are
 * equity-only (no CIK, not applicable to forex/commodities/futures).
 */
export async function getTickerNewsPanel(ticker: string, assetClass: AssetClass): Promise<TickerNewsPanelResult> {
  const symbol = ticker.trim().toUpperCase();
  const dataLimitations: string[] = [];
  let companyNews: CompanyNewsArticle[] | null = null;
  let secFilings: SecFilingSummary[] | null = null;
  let macroNews: TickerNewsPanelResult["macroNews"] = null;

  if (assetClass === "equity") {
    const [newsResult, prResult, filingsResult] = await Promise.allSettled([
      fetchStockNews(symbol),
      fetchPressReleases(symbol),
      fetchRecentFilings(symbol),
    ]);

    const articles: CompanyNewsArticle[] = [];
    if (newsResult.status === "fulfilled") {
      articles.push(
        ...newsResult.value.map((a) => ({
          title: a.title,
          url: a.url,
          source: a.site,
          publishedDate: a.publishedDate,
          kind: "news" as const,
        }))
      );
    } else {
      dataLimitations.push(`Company news unavailable: ${newsResult.reason instanceof Error ? newsResult.reason.message : "Unknown error"}`);
    }
    if (prResult.status === "fulfilled") {
      articles.push(
        ...prResult.value.map((p) => ({
          title: p.title,
          url: p.url,
          source: "Press Release",
          publishedDate: p.date,
          kind: "press-release" as const,
        }))
      );
    } else {
      dataLimitations.push(`Press releases unavailable: ${prResult.reason instanceof Error ? prResult.reason.message : "Unknown error"}`);
    }
    articles.sort((a, b) => b.publishedDate.localeCompare(a.publishedDate));
    companyNews = articles;

    if (filingsResult.status === "fulfilled") {
      secFilings = filingsResult.value.map((f) => ({ form: f.form, filingDate: f.filingDate, url: f.url }));
    } else {
      dataLimitations.push(`SEC filings unavailable: ${filingsResult.reason instanceof Error ? filingsResult.reason.message : "Unknown error"}`);
    }

    try {
      const profiles = await fetchProfile(symbol);
      const sector = profiles[0]?.sector ?? null;
      const kw = (sector ? SECTOR_NEWS_KEYWORDS[sector] : null) ?? FALLBACK_SECTOR_KEYWORDS;
      macroNews = await getGeopoliticalNews(kw.query, sector, kw.mechanismNote);
    } catch (error) {
      dataLimitations.push(`Sector/macro news unavailable: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  } else {
    const kw = assetClass === "forex" ? MAJOR_PAIR_KEYWORDS.find((p) => p.pair === symbol) : COMMODITY_FUTURES_NEWS_KEYWORDS[symbol];
    if (kw) {
      try {
        macroNews = await getGeopoliticalNews(kw.query, symbol, kw.mechanismNote);
      } catch (error) {
        dataLimitations.push(`Macro news unavailable: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    } else {
      dataLimitations.push(`No macro-news keyword mapping defined for "${symbol}".`);
    }
  }

  return { ticker: symbol, assetClass, companyNews, secFilings, macroNews, dataLimitations };
}
