import { getIndicatorSeries } from "./indicator-library";
import { INDUSTRY_IMPACTS, type IndustryImpact } from "./industry-impact";
import { INDICATOR_LIBRARY } from "./indicator-metadata";
import type { IndicatorSignal, MacroMarginMatrix, SectorRecommendation } from "../types";

export type { IndicatorSignal, SectorRecommendation };

// Which industries are meaningfully rate-sensitive / long-duration,
// structurally cyclical, or margin-sensitive-to-input-cost-pass-through —
// used by deriveMacroLinkage/deriveObstaclesOpportunities below. An industry
// can appear in more than one set (e.g. real estate is both rate-sensitive
// and cyclical) — every matching category contributes to the read, none are
// mutually exclusive. This is a documented rule-based classification, not a
// statistically derived one, same honesty framing as gex-signal.ts's
// dealer-positioning heuristic.
const RATE_SENSITIVE_IDS = new Set([
  "technology",
  "software",
  "alt-energy",
  "utilities",
  "real-estate",
  "financials",
]);
const CYCLICAL_IDS = new Set([
  "manufacturing",
  "materials",
  "semiconductors",
  "auto",
  "wholesale",
  "energy",
]);
const MARGIN_SENSITIVE_IDS = new Set([
  "consumer-staples",
  "food-beverage",
  "retail",
  "healthcare",
  "communication-services",
]);

function deriveMacroLinkage(
  industry: IndustryImpact,
  matrix: MacroMarginMatrix
): SectorRecommendation["macroLinkage"] {
  const affectedBy: string[] = [];
  const rationaleParts: string[] = [];

  if (RATE_SENSITIVE_IDS.has(industry.id)) {
    affectedBy.push(`credit: ${matrix.credit.creditCondition}`);
    if (matrix.credit.creditCondition === "tight") {
      rationaleParts.push(
        `${industry.name} is a rate-sensitive/long-duration industry, and credit conditions are currently tight (yield curve ${matrix.credit.yieldCurveInverted ? "inverted" : "not inverted"}, HY OAS ${matrix.credit.highYieldSpread.value.toFixed(2)}%) — this typically compresses valuations and raises financing costs here more than in the broader market.`
      );
    } else if (matrix.credit.creditCondition === "loose") {
      rationaleParts.push(
        `${industry.name} is a rate-sensitive/long-duration industry, and credit conditions are currently loose (HY OAS ${matrix.credit.highYieldSpread.value.toFixed(2)}%) — a tailwind for financing costs and valuation multiples here specifically.`
      );
    } else {
      rationaleParts.push(
        `${industry.name} is a rate-sensitive industry; credit conditions are currently neutral, so this isn't presently a strong tailwind or headwind.`
      );
    }
  }

  if (CYCLICAL_IDS.has(industry.id)) {
    affectedBy.push(`production: ${matrix.production.productionPhase}`);
    if (matrix.production.productionPhase === "trough") {
      rationaleParts.push(
        `Capacity utilization is running below its long-run average (${matrix.production.capacityUtilization.value.toFixed(1)}% vs ~${matrix.production.capacityUtilizationLongRunAvg}%) — a structurally cyclical industry like this typically sees the sharpest volume and margin pressure in a trough.`
      );
    } else if (matrix.production.productionPhase === "overheated") {
      rationaleParts.push(
        `Capacity utilization is running above its long-run average (${matrix.production.capacityUtilization.value.toFixed(1)}%) — a cyclical industry like this is more likely capturing pricing power and strong volumes right now, though overheating also raises the risk of a sharper eventual correction.`
      );
    } else {
      rationaleParts.push(
        "Industrial activity is running close to its long-run average — no strong cyclical tailwind or headwind currently."
      );
    }
  }

  if (MARGIN_SENSITIVE_IDS.has(industry.id)) {
    affectedBy.push(`inflation: ${matrix.inflation.marginPressure}`);
    if (matrix.inflation.marginPressure === "compressing") {
      rationaleParts.push(
        "Producer prices are currently outrunning consumer prices (margin pressure: compressing) — industries with limited pricing power, like this one, are the most exposed to this exact dynamic."
      );
    } else if (matrix.inflation.marginPressure === "expanding") {
      rationaleParts.push(
        "Consumer prices are currently outrunning producer prices (margin pressure: expanding) — a tailwind for margins in an industry like this one."
      );
    } else {
      rationaleParts.push(
        "Producer and consumer price growth are currently close together — margins here are neither being squeezed nor expanded by this dynamic right now."
      );
    }
  }

  if (affectedBy.length === 0) {
    affectedBy.push(`stance: ${matrix.stance.label}`);
    rationaleParts.push(
      `This industry doesn't fit the rate-sensitive, cyclical, or margin-sensitive categories cleanly — the overall market stance (${matrix.stance.label}) is the most relevant top-down context available.`
    );
  }

  return { stanceLabel: matrix.stance.label, affectedBy, rationale: rationaleParts.join(" ") };
}

function deriveObstaclesOpportunities(
  industry: IndustryImpact,
  signals: IndicatorSignal[],
  matrix: MacroMarginMatrix
): { obstacles: string[]; opportunities: string[] } {
  const obstacles: string[] = [];
  const opportunities: string[] = [];

  if (RATE_SENSITIVE_IDS.has(industry.id) && matrix.credit.creditCondition === "tight") {
    obstacles.push("Tight credit conditions raise financing costs and compress valuation multiples for this rate-sensitive industry.");
  }
  if (RATE_SENSITIVE_IDS.has(industry.id) && matrix.credit.creditCondition === "loose") {
    opportunities.push("Loose credit conditions are a tailwind for financing costs and valuation multiples in this rate-sensitive industry.");
  }
  if (CYCLICAL_IDS.has(industry.id) && matrix.production.productionPhase === "trough") {
    obstacles.push("Below-trend capacity utilization signals weak current demand and pricing power for this cyclical industry.");
    if (matrix.valuation.valuationCondition === "cheap" || matrix.valuation.valuationCondition === "fair") {
      opportunities.push(
        "Cyclical trough plus a fair-to-cheap broad market valuation is the classic setup for finding asset-rich, low-leverage names trading near book or NCAV — worth screening this industry specifically."
      );
    }
  }
  if (CYCLICAL_IDS.has(industry.id) && matrix.production.productionPhase === "overheated") {
    opportunities.push("Above-trend capacity utilization signals strong current demand and likely pricing power for this cyclical industry.");
    obstacles.push("Overheating raises the risk of a sharper correction once the cycle turns — position sizing and margin of safety matter more than usual here.");
  }
  if (MARGIN_SENSITIVE_IDS.has(industry.id) && matrix.inflation.marginPressure === "compressing") {
    obstacles.push("Producer costs are currently outrunning what this industry can pass through to consumers — margins are the thing to watch, not just revenue growth.");
  }
  if (MARGIN_SENSITIVE_IDS.has(industry.id) && matrix.inflation.marginPressure === "expanding") {
    opportunities.push("Consumer prices are currently outrunning producer costs — a margin tailwind for this industry.");
  }

  const favorableSignals = signals.filter((s) => s.isFavorable === true);
  const unfavorableSignals = signals.filter((s) => s.isFavorable === false);
  if (favorableSignals.length > 0) {
    opportunities.push(
      `${favorableSignals.length} of this industry's own tracked driver(s) are trending favorably: ${favorableSignals.map((s) => s.label).join(", ")}.`
    );
  }
  if (unfavorableSignals.length > 0) {
    obstacles.push(
      `${unfavorableSignals.length} of this industry's own tracked driver(s) are trending unfavorably: ${unfavorableSignals.map((s) => s.label).join(", ")}.`
    );
  }

  if (obstacles.length === 0) obstacles.push("No strong macro headwind currently identified for this industry from the tracked signals.");
  if (opportunities.length === 0) opportunities.push("No strong macro tailwind currently identified for this industry from the tracked signals.");

  return { obstacles, opportunities };
}

// Best-effort mapping from industry-impact.ts ids to the FRED industry
// groups (sector-overview.ts) and FMP sectors (sector-fundamentals.ts)
// already built elsewhere in the app. Not every industry has a clean
// mapping to either — left null rather than forced into an ill-fitting one.
const FRED_GROUP_LABEL_MAP: Record<string, string> = {
  manufacturing: "Manufacturing",
};

const FMP_SECTOR_MAP: Record<string, string> = {
  technology: "Technology",
  software: "Technology",
  semiconductors: "Technology",
  energy: "Energy",
  manufacturing: "Industrials",
  auto: "Consumer Cyclical",
  retail: "Consumer Cyclical",
  "consumer-staples": "Consumer Defensive",
  "food-beverage": "Consumer Defensive",
};

function computeTrend(points: { date: string; value: number }[]): "rising" | "falling" | "flat" {
  if (points.length < 2) return "flat";
  const recent = points.slice(-3);
  const first = recent[0].value;
  const last = recent[recent.length - 1].value;
  const diff = last - first;
  const threshold = Math.abs(first) * 0.005; // 0.5% move to count as a real trend, not noise
  if (threshold === 0 || Math.abs(diff) < threshold) return "flat";
  return diff > 0 ? "rising" : "falling";
}

export async function getSectorRecommendations(matrix: MacroMarginMatrix): Promise<SectorRecommendation[]> {
  const neededIds = new Set<string>();
  for (const industry of INDUSTRY_IMPACTS) {
    for (const id of industry.primaryDrivers) neededIds.add(id);
  }

  const entries = await Promise.all(
    Array.from(neededIds).map(async (id) => {
      const result = await getIndicatorSeries(id, 6);
      return [id, result] as const;
    })
  );
  const seriesMap = new Map(entries);

  return INDUSTRY_IMPACTS.map((industry) => {
    const signals: IndicatorSignal[] = industry.primaryDrivers.map((id) => {
      const series = seriesMap.get(id);
      const meta = INDICATOR_LIBRARY.find((i) => i.id === id);
      const points = series?.points ?? [];
      const latest = points[points.length - 1];
      const trend = computeTrend(points);
      const isFavorable =
        trend === "flat" || !meta
          ? null
          : (trend === "rising") === (meta.favorableTrend === "up");

      return {
        indicatorId: id,
        label: meta?.label ?? id,
        latestValue: latest?.value ?? 0,
        latestDate: latest?.date ?? "",
        unit: meta?.unit ?? "",
        classification: meta?.classification ?? "coincident",
        trend,
        isFavorable,
      };
    });

    const favorableCount = signals.filter((s) => s.isFavorable === true).length;
    const unfavorableCount = signals.filter((s) => s.isFavorable === false).length;
    const overallRead: SectorRecommendation["overallRead"] =
      favorableCount > unfavorableCount
        ? "constructive"
        : unfavorableCount > favorableCount
          ? "cautious"
          : "mixed";

    const { obstacles, opportunities } = deriveObstaclesOpportunities(industry, signals, matrix);

    return {
      industryId: industry.id,
      industryName: industry.name,
      analysis: industry.analysis,
      signals,
      favorableCount,
      unfavorableCount,
      overallRead,
      macroLinkage: deriveMacroLinkage(industry, matrix),
      obstacles,
      opportunities,
      relevantMetrics: {
        fredIndustryGroupLabel: FRED_GROUP_LABEL_MAP[industry.id] ?? null,
        fmpSectorName: FMP_SECTOR_MAP[industry.id] ?? null,
      },
    };
  });
}
