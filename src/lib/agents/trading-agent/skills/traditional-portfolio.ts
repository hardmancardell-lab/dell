import { getSectorRecommendations } from "@/lib/agents/research-agent/skills/sector-recommendations";
import { SECTOR_CONSTITUENTS, UNAVAILABLE_SECTOR_NOTE } from "@/lib/agents/research-agent/skills/sector-fundamentals";
import { getSecurityAnalysis } from "@/lib/agents/research-agent/skills/security-analysis";
import { getMacroOverview } from "@/lib/agents/research-agent/skills/macro-overview";
import type { TraditionalCandidate, TraditionalCandidateGroup, TraditionalCandidatesResult } from "../types";

/**
 * Composes three existing Research Agent pieces that have never been wired
 * together before: getSectorRecommendations() (industry-level stance, zero
 * tickers) -> SECTOR_CONSTITUENTS (the only ticker universe in the
 * codebase, curated bellwethers per FMP sector) -> getSecurityAnalysis()
 * (per-ticker Graham Checklist). This is the "traditional" candidate
 * pipeline: fundamental analysis on individual securities, seeded by the
 * Research Agent's own macro/industry read.
 *
 * Takes just the held symbols (not full PortfolioHolding objects) so the
 * API route can stay GET+query-param, matching /api/sector-recommendations,
 * rather than needing a POST body like the valuation/analytics routes.
 */
export async function getTraditionalCandidates(heldSymbols: string[]): Promise<TraditionalCandidatesResult> {
  const heldSet = new Set(heldSymbols);
  const dataLimitations: string[] = [
    "Candidate tickers are a curated set of large-cap bellwethers per sector (2-6 per sector), not a live market screen — FMP's screener endpoint requires a paid plan (see sector-fundamentals.ts).",
    "Only industries with a mapped FMP sector name (relevantMetrics.fmpSectorName) can produce candidates — some industries in the Research Agent's coverage have no clean FMP sector mapping and are shown with no candidate list.",
  ];

  const matrix = await getMacroOverview();
  const recommendations = await getSectorRecommendations(matrix);

  // Dedup candidate tickers across industries before running the checklist,
  // same dedup-by-symbol idiom as useWatchlist().addEntry.
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

  const groups: TraditionalCandidateGroup[] = recommendations.map((rec) => {
    const sectorName = rec.relevantMetrics.fmpSectorName;
    const constituents = sectorName ? SECTOR_CONSTITUENTS[sectorName] : undefined;

    let note: string | null = null;
    if (!sectorName) {
      note = "No FMP sector mapping exists for this industry — candidates can't be generated automatically.";
    } else if (!constituents || constituents.length === 0) {
      note = UNAVAILABLE_SECTOR_NOTE[sectorName] ?? "No accessible candidate tickers for this sector on the free FMP plan.";
    }

    const candidates: TraditionalCandidate[] = (constituents ?? []).map((ticker): TraditionalCandidate => {
      const result = analysisByTicker.get(ticker);
      if (!result || result.error || !result.analysis) {
        return {
          ticker,
          checklistPassCount: 0,
          checklistTotal: 0,
          alreadyHeld: heldSet.has(ticker),
          error: result?.error ?? "No analysis available.",
        };
      }
      return {
        ticker,
        checklistPassCount: result.analysis.checklist.filter((c) => c.passed).length,
        checklistTotal: result.analysis.checklist.length,
        alreadyHeld: heldSet.has(ticker),
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
