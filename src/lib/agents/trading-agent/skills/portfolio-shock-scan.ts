import { fetchProfile } from "@/lib/data/fmp";
import { getGeopoliticalNews, computeCoverageSpike, MAJOR_PAIR_KEYWORDS } from "./geopolitical-news";
import { SECTOR_NEWS_KEYWORDS, FALLBACK_SECTOR_KEYWORDS, COMMODITY_FUTURES_NEWS_KEYWORDS } from "./sector-news-keywords";
import { isAnthropicConfigured } from "@/lib/agents/assistant/anthropic-client";
import { generateSupplyDemandShockRead } from "@/lib/agents/assistant/supply-demand-shock-prompt";
import type { AssetClass, PortfolioHolding, PortfolioShockScanEntry, PortfolioShockScanResult } from "../types";

// Real, bounded scan — GDELT rate-limits to ~1 request/5s and each query
// needs 2 sequential calls (~6s), so this is deliberately capped and
// deduped by query string (multiple holdings can share one sector/pair
// query), same "group by distinct query" precedent already established in
// the alerts cron. Meant to be triggered explicitly by the user, matching
// checkCoverageSpikes()'s own precedent, not run automatically.
const MAX_DISTINCT_QUERIES = 5;

interface QueryTarget {
  query: string;
  mechanismNote: string;
  symbols: string[];
  assetClass: AssetClass;
}

async function resolveQueryForHolding(holding: PortfolioHolding): Promise<{ query: string; mechanismNote: string } | null> {
  if (holding.assetClass === "equity" || (holding.assetClass === "option" && holding.underlyingSymbol)) {
    const symbol = holding.assetClass === "option" ? holding.underlyingSymbol! : holding.symbol;
    try {
      const profiles = await fetchProfile(symbol);
      const sector = profiles[0]?.sector ?? null;
      const mapped = sector ? SECTOR_NEWS_KEYWORDS[sector] : null;
      return mapped ?? FALLBACK_SECTOR_KEYWORDS;
    } catch {
      return FALLBACK_SECTOR_KEYWORDS;
    }
  }
  if (holding.assetClass === "forex") {
    const match = MAJOR_PAIR_KEYWORDS.find((p) => p.pair === holding.symbol);
    return match ? { query: match.query, mechanismNote: match.mechanismNote } : null;
  }
  if (holding.assetClass === "commodity" || holding.assetClass === "future") {
    const match = COMMODITY_FUTURES_NEWS_KEYWORDS[holding.symbol];
    return match ?? null;
  }
  // Bonds have no direct GDELT keyword mapping built — a real, disclosed gap
  // rather than a guessed query.
  return null;
}

export async function runPortfolioShockScan(holdings: PortfolioHolding[]): Promise<PortfolioShockScanResult> {
  const dataLimitations: string[] = [
    "GDELT is a global news-coverage index, not a curated 'this caused that' feed — a coverage spike means a topic is suddenly getting more attention, which correlates with market-moving events but isn't a guaranteed causal signal.",
    "Bond holdings have no direct news-query mapping built and are skipped — a real, disclosed gap, not a guessed query.",
  ];

  const targetsByQuery = new Map<string, QueryTarget>();
  for (const holding of holdings) {
    const resolved = await resolveQueryForHolding(holding);
    if (!resolved) continue;
    const existing = targetsByQuery.get(resolved.query);
    if (existing) {
      existing.symbols.push(holding.symbol);
    } else {
      targetsByQuery.set(resolved.query, {
        query: resolved.query,
        mechanismNote: resolved.mechanismNote,
        symbols: [holding.symbol],
        assetClass: holding.assetClass,
      });
    }
  }

  let targets = [...targetsByQuery.values()];
  if (targets.length > MAX_DISTINCT_QUERIES) {
    dataLimitations.push(
      `Portfolio maps to ${targets.length} distinct news queries — capped to the first ${MAX_DISTINCT_QUERIES} to keep this scan's real GDELT round-trip time bounded (GDELT rate-limits to ~1 request/5s).`
    );
    targets = targets.slice(0, MAX_DISTINCT_QUERIES);
  }

  const entries: PortfolioShockScanEntry[] = [];
  for (const target of targets) {
    try {
      const news = await getGeopoliticalNews(target.query, target.symbols.join("/"), target.mechanismNote);
      const spike = computeCoverageSpike(news.coverageVolume);

      let narrative: string | null = null;
      if (spike.triggered && isAnthropicConfigured()) {
        try {
          narrative = await generateSupplyDemandShockRead(target.symbols.join("/"), target.assetClass, news.articles, target.mechanismNote, spike.multiple);
        } catch (err) {
          dataLimitations.push(`Could not generate a persona narrative for ${target.symbols.join("/")}: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }

      entries.push({
        symbols: target.symbols,
        assetClass: target.assetClass,
        query: target.query,
        mechanismNote: target.mechanismNote,
        latestCoverageValue: spike.latestValue,
        averageCoverageValue: spike.averageValue,
        coverageMultiple: spike.multiple,
        triggered: spike.triggered,
        headlines: news.articles,
        narrative,
      });
    } catch (err) {
      dataLimitations.push(`Could not scan ${target.symbols.join("/")}: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  if (!isAnthropicConfigured()) {
    dataLimitations.push("ANTHROPIC_API_KEY is not set — real coverage-spike flags and headlines still show below, but no persona narrative is generated.");
  }

  return { entries, dataLimitations };
}
