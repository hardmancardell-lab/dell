import { fetchProfile } from "@/lib/data/fmp";
import { getArticlesOnly, MAJOR_PAIR_KEYWORDS } from "./geopolitical-news";
import type { WatchlistEntry, WatchlistNewsItem, WatchlistNewsResult } from "../types";

const GDELT_RATE_LIMIT_GAP_MS = 5500;
const ARTICLES_PER_ENTRY = 5;

/**
 * Real, per-watchlist-entry news — built specifically because FMP's company
 * news endpoint (used by ticker-news-panel.ts) is blocked on the free plan
 * (confirmed live: HTTP 402 "Restricted Endpoint"). This reuses the GDELT
 * pipeline the Global Financial News feature already proved out instead,
 * article-list-only (getArticlesOnly, no coverage-volume timeline) to keep
 * per-entry latency down. GDELT's ~1-req/5s rate limit means N entries take
 * roughly N × 5.5s sequentially — explicitly user-triggered (a button), same
 * "not run automatically" precedent as checkCoverageSpikes().
 */

async function companyNewsFor(symbol: string): Promise<WatchlistNewsItem> {
  let label = symbol;
  try {
    const profiles = await fetchProfile(symbol);
    if (profiles[0]?.companyName) label = profiles[0].companyName;
  } catch {
    // Profile lookup failing (rare — fetchProfile isn't gated the way
    // financial-statement endpoints are) just means we fall back to the
    // bare ticker as the query/label instead of the real company name.
  }
  const query = label !== symbol ? `"${label}" OR ${symbol}` : symbol;
  const { articles, error } = await getArticlesOnly(query, ARTICLES_PER_ENTRY);
  return { symbol, label, curated: false, articles, error };
}

async function currencyNewsFor(pair: string): Promise<WatchlistNewsItem> {
  const curated = MAJOR_PAIR_KEYWORDS.find((p) => p.pair === pair);
  if (curated) {
    const { articles, error } = await getArticlesOnly(curated.query, ARTICLES_PER_ENTRY);
    return { symbol: pair, label: pair, curated: true, articles, error };
  }
  // No hand-tuned keyword mapping for this specific pair — fall back to a
  // generic query built from the pair itself and its two currency codes.
  // Flagged via `curated: false` in the UI rather than presented as being as
  // well-targeted as the 6 majors.
  const codes = pair.split("/");
  const query = codes.length === 2 ? `"${pair}" OR ${codes[0]} OR ${codes[1]}` : `"${pair}"`;
  const { articles, error } = await getArticlesOnly(query, ARTICLES_PER_ENTRY);
  return { symbol: pair, label: pair, curated: false, articles, error };
}

async function runSequential(symbols: string[], fetchOne: (s: string) => Promise<WatchlistNewsItem>): Promise<WatchlistNewsItem[]> {
  const items: WatchlistNewsItem[] = [];
  for (let i = 0; i < symbols.length; i += 1) {
    items.push(await fetchOne(symbols[i]));
    if (i < symbols.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, GDELT_RATE_LIMIT_GAP_MS));
    }
  }
  return items;
}

export async function getWatchlistCompanyNews(entries: WatchlistEntry[]): Promise<WatchlistNewsResult> {
  const symbols = [...new Set(entries.filter((e) => e.assetClass === "equity").map((e) => e.symbol))];
  const dataLimitations = [
    "Real per-company headlines via GDELT (company name + ticker as the search), since FMP's company-news endpoint is blocked on this app's free plan (HTTP 402).",
    `GDELT rate-limits to ~1 request/5s — ${symbols.length} companies took roughly ${Math.max(0, symbols.length - 1) * 5.5 + symbols.length * 2}s to fetch.`,
  ];
  if (symbols.length === 0) {
    return { items: [], dataLimitations: ["No equity symbols on this watchlist."] };
  }
  const items = await runSequential(symbols, companyNewsFor);
  return { items, dataLimitations };
}

export async function getWatchlistCurrencyNews(entries: WatchlistEntry[]): Promise<WatchlistNewsResult> {
  const pairs = [...new Set(entries.filter((e) => e.assetClass === "forex").map((e) => e.symbol))];
  const dataLimitations = [
    `Real per-pair headlines via GDELT. ${MAJOR_PAIR_KEYWORDS.length} major pairs use a hand-tuned query (see the Currency Reference Guide); any other pair on your watchlist falls back to a generic currency-code search, flagged as such.`,
    `GDELT rate-limits to ~1 request/5s — ${pairs.length} pairs took roughly ${Math.max(0, pairs.length - 1) * 5.5 + pairs.length * 2}s to fetch.`,
  ];
  if (pairs.length === 0) {
    return { items: [], dataLimitations: ["No forex pairs on this watchlist."] };
  }
  const items = await runSequential(pairs, currencyNewsFor);
  return { items, dataLimitations };
}
