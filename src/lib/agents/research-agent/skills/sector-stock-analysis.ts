import { SECTOR_CONSTITUENTS, UNAVAILABLE_SECTOR_NOTE, getSectorFundamentals } from "./sector-fundamentals";
import { getSecurityAnalysis } from "./security-analysis";
import { isAnthropicConfigured } from "@/lib/agents/assistant/anthropic-client";
import { generateSecurityForecast } from "@/lib/agents/assistant/security-forecast-prompt";
import type { BusinessCycleTag, MacroMarginMatrix, SectorStockAnalysisResult, SectorStockCandidate } from "../types";

/**
 * Documented rule-based heuristic (production phase + credit condition from
 * the macro matrix), not an economic model — same honesty framing as
 * sector-recommendations.ts's macroLinkage classification.
 */
function deriveCycleTag(matrix: MacroMarginMatrix): { tag: BusinessCycleTag; rationale: string } {
  const { productionPhase, capacityUtilization, capacityUtilizationLongRunAvg } = matrix.production;
  const { creditCondition } = matrix.credit;

  if (productionPhase === "trough" && creditCondition === "tight") {
    return {
      tag: "contraction",
      rationale: `Capacity utilization is below its long-run average (${capacityUtilization.value.toFixed(1)}% vs ~${capacityUtilizationLongRunAvg}%) and credit is tight — the classic contraction combination of weak demand and expensive/unavailable financing.`,
    };
  }
  if (productionPhase === "trough") {
    return {
      tag: "early-cycle",
      rationale: `Capacity utilization is below its long-run average (${capacityUtilization.value.toFixed(1)}% vs ~${capacityUtilizationLongRunAvg}%) but credit conditions (${creditCondition}) aren't tight — consistent with an early-cycle bottoming read rather than active contraction.`,
    };
  }
  if (productionPhase === "overheated") {
    return {
      tag: "late-cycle",
      rationale: `Capacity utilization is running above its long-run average (${capacityUtilization.value.toFixed(1)}% vs ~${capacityUtilizationLongRunAvg}%) — a late-cycle read where the risk of a demand or credit-driven correction rises the longer this persists.`,
    };
  }
  return {
    tag: "expansion",
    rationale: `Capacity utilization is running close to its long-run average (${capacityUtilization.value.toFixed(1)}% vs ~${capacityUtilizationLongRunAvg}%) with credit conditions read as "${creditCondition}" — consistent with a steady expansion phase, neither a trough nor overheated.`,
  };
}

/**
 * Whether a specific company's own recent operating-margin trend agrees with
 * the sector-level cycle read — e.g. a company with a rising margin trend
 * during a broad "contraction" tag is bucking the sector-wide pattern, worth
 * flagging either way. Returns null (not false) when there's too little
 * margin history to judge, rather than defaulting to a potentially
 * misleading answer.
 */
function ownTrendSupportsCycle(operatingMarginByYear: number[], tag: BusinessCycleTag): boolean | null {
  if (operatingMarginByYear.length < 2) return null;
  const [mostRecent, ...prior] = operatingMarginByYear; // most-recent-first, per sector-fundamentals.ts
  const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
  const rising = mostRecent > priorAvg;
  const expansionaryTags: BusinessCycleTag[] = ["early-cycle", "expansion"];
  return expansionaryTags.includes(tag) ? rising : !rising;
}

export async function getSectorStockAnalysis(
  sector: string,
  matrix: MacroMarginMatrix,
  forecast: boolean
): Promise<SectorStockAnalysisResult> {
  const tickers = SECTOR_CONSTITUENTS[sector];
  if (!tickers) {
    throw new Error(`No curated ticker list defined for sector "${sector}".`);
  }

  const { tag: cycleTag, rationale: cycleRationale } = deriveCycleTag(matrix);
  const dataLimitations: string[] = [
    "Candidate tickers are a curated set of large-cap bellwethers per sector (2-6 per sector), not a live market screen — FMP's screener endpoint requires a paid plan (see sector-fundamentals.ts). Never padded to a fixed count.",
  ];

  if (tickers.length === 0) {
    const detail = UNAVAILABLE_SECTOR_NOTE[sector] ?? "No accessible tickers found for this sector.";
    dataLimitations.push(`"${sector}" has zero accessible tickers on the free FMP plan. ${detail}`);
    return {
      sector,
      candidates: [],
      sampleNote: "0 companies available",
      forecastEnabled: forecast && isAnthropicConfigured(),
      dataLimitations,
    };
  }

  // Reuses getSectorFundamentals's own already-computed operatingMarginByYear
  // per company rather than re-fetching statements a second time.
  const fundamentals = await getSectorFundamentals(sector).catch(() => null);
  const marginByTicker = new Map<string, number[]>(
    (fundamentals?.companiesAnalyzed ?? []).map((c) => [c.ticker, c.operatingMarginByYear])
  );
  if (fundamentals) dataLimitations.push(...fundamentals.dataLimitations);

  const forecastEnabled = forecast && isAnthropicConfigured();
  if (forecast && !isAnthropicConfigured()) {
    dataLimitations.push(
      "Forecast mode requires a real ANTHROPIC_API_KEY in .env.local — showing real checklist/cycle data without generated narratives."
    );
  }

  const candidates: SectorStockCandidate[] = await Promise.all(
    tickers.map(async (ticker): Promise<SectorStockCandidate> => {
      try {
        const analysis = await getSecurityAnalysis(ticker);
        const marginHistory = marginByTicker.get(ticker) ?? [];
        let candidateForecast: string | null = null;
        if (forecastEnabled) {
          try {
            candidateForecast = await generateSecurityForecast(analysis, cycleTag, matrix);
          } catch (error) {
            candidateForecast = null;
            dataLimitations.push(
              `Forecast generation failed for ${ticker}: ${error instanceof Error ? error.message : "unknown error"}.`
            );
          }
        }
        return {
          ticker,
          companyName: analysis.companyName,
          checklistPassCount: analysis.checklist.filter((c) => c.passed).length,
          checklistTotal: analysis.checklist.length,
          cycleTag,
          cycleRationale,
          ownTrendSupportsRead: ownTrendSupportsCycle(marginHistory, cycleTag),
          forecast: candidateForecast,
          error: null,
        };
      } catch (error) {
        return {
          ticker,
          companyName: ticker,
          checklistPassCount: null,
          checklistTotal: 7,
          cycleTag,
          cycleRationale,
          ownTrendSupportsRead: null,
          forecast: null,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    })
  );

  return {
    sector,
    candidates,
    sampleNote: `${candidates.filter((c) => c.error === null).length} of ${tickers.length} curated tickers analyzed`,
    forecastEnabled,
    dataLimitations,
  };
}
