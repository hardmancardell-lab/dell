import { getSectorRecommendations } from "./sector-recommendations";
import { SECTOR_CONSTITUENTS, UNAVAILABLE_SECTOR_NOTE } from "./sector-fundamentals";
import { getSecurityAnalysis } from "./security-analysis";
import { getMacroOverview } from "./macro-overview";
import type { ScreenerCandidate, ScreenerCandidateGroup, ScreenerResult } from "../types";

/**
 * Research-Agent-owned equivalent of
 * trading-agent/skills/traditional-portfolio.ts's candidate pipeline —
 * same composition (getSectorRecommendations() -> SECTOR_CONSTITUENTS ->
 * getSecurityAnalysis() per candidate), deliberately not imported from
 * trading-agent to avoid a cross-agent dependency; both agents own their
 * own instance of this pattern over the same underlying primitives.
 *
 * This is the honest answer to "multi-stock screener" for an app on FMP's
 * free tier: a curated set of bellwether tickers per sector, not a live
 * market screen (FMP's real /company-screener endpoint requires a paid
 * plan — see sector-fundamentals.ts).
 */
export async function getScreenerCandidates(watchlistedSymbols: string[]): Promise<ScreenerResult> {
  const watchlistedSet = new Set(watchlistedSymbols);
  const dataLimitations: string[] = [
    "Candidate tickers are a curated set of large-cap bellwethers per sector (2-6 per sector), not a live market screen — FMP's screener endpoint requires a paid plan (see sector-fundamentals.ts).",
    "Only industries with a mapped FMP sector name (relevantMetrics.fmpSectorName) can produce candidates — some industries in the Research Agent's coverage have no clean FMP sector mapping and are shown with no candidate list.",
  ];

  const matrix = await getMacroOverview();
  const recommendations = await getSectorRecommendations(matrix);

  const tickerToIndustries = new Map<string, string[]>();
  for (const rec of recommendations) {
    const sectorName = rec.relevantMetrics.fmpSectorName;
    if (!sectorName) continue;
    const tickers = SECTOR_CONSTITUENTS[sectorName];
    if (!tickers || tickers.length === 0) continue;
    for (const ticker of tickers) {
      const list = tickerToIndustries.get(ticker) ?? [];
      list.push(rec.industryId);
      tickerToIndustries.set(ticker, list);
    }
  }

  const uniqueTickers = [...tickerToIndustries.keys()];
  const analyses = await Promise.all(
    uniqueTickers.map(async (ticker) => {
      try {
        const analysis = await getSecurityAnalysis(ticker);
        return { ticker, analysis, error: null as string | null };
      } catch (error) {
        return { ticker, analysis: null, error: error instanceof Error ? error.message : "Unknown error" };
      }
    })
  );
  const analysisByTicker = new Map(analyses.map((a) => [a.ticker, a]));

  const failedTickers = analyses.filter((a) => a.error !== null);
  if (failedTickers.length > 0) {
    dataLimitations.push(
      `Could not run the Graham Checklist for: ${failedTickers.map((a) => a.ticker).join(", ")} — likely restricted on the free FMP tier.`
    );
  }

  const groups: ScreenerCandidateGroup[] = recommendations.map((rec) => {
    const sectorName = rec.relevantMetrics.fmpSectorName;
    const constituents = sectorName ? SECTOR_CONSTITUENTS[sectorName] : undefined;

    let note: string | null = null;
    if (!sectorName) {
      note = "No FMP sector mapping exists for this industry — candidates can't be generated automatically.";
    } else if (!constituents || constituents.length === 0) {
      note = UNAVAILABLE_SECTOR_NOTE[sectorName] ?? "No accessible candidate tickers for this sector on the free FMP plan.";
    }

    const candidates: ScreenerCandidate[] = (constituents ?? []).map((ticker): ScreenerCandidate => {
      const result = analysisByTicker.get(ticker);
      if (!result || result.error || !result.analysis) {
        return {
          ticker,
          checklistPassCount: 0,
          checklistTotal: 0,
          alreadyWatchlisted: watchlistedSet.has(ticker),
          error: result?.error ?? "No analysis available.",
        };
      }
      return {
        ticker,
        checklistPassCount: result.analysis.checklist.filter((c) => c.passed).length,
        checklistTotal: result.analysis.checklist.length,
        alreadyWatchlisted: watchlistedSet.has(ticker),
        error: null,
      };
    });

    return {
      industryId: rec.industryId,
      industryName: rec.industryName,
      overallRead: rec.overallRead,
      fmpSectorName: sectorName,
      candidates,
      note,
    };
  });

  return { groups, dataLimitations };
}
