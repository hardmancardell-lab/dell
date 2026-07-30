import { getEconomicOutlookInputs } from "./inputs";
import { generateEconomicOutlookNarrative } from "./narrative-prompt";
import { getLatestOutlookVersion, saveOutlookVersion } from "./storage";
import type { EconomicOutlook, OutlookIndicator, RefreshReason } from "./types";

function mergeDerivations(
  raw: { indicator: string; currentReading: string; source: string; rawValue: number | null }[],
  derivations: { indicator: string; roleInOutlook: string; howDerived: string }[]
): OutlookIndicator[] {
  return raw.map((r) => {
    const match = derivations.find((d) => d.indicator === r.indicator);
    return {
      indicator: r.indicator,
      currentReading: r.currentReading,
      source: r.source,
      roleInOutlook: match?.roleInOutlook ?? "Not synthesized — the narrative pass did not return a matching entry for this indicator.",
      howDerived: match?.howDerived ?? "Not synthesized — the narrative pass did not return a matching entry for this indicator.",
      lastChangedMeaningfully: null,
    };
  });
}

/** Next FOMC-cycle-style refresh — this app has no live FOMC calendar integrated, so this is a fixed ~6-week cadence from today rather than a real meeting date. Flagged in dataLimitations. */
function estimateNextScheduledRefresh(fromDate: Date): string {
  const next = new Date(fromDate);
  next.setDate(next.getDate() + 42);
  return next.toISOString().slice(0, 10);
}

export async function generateEconomicOutlook(refreshReason: RefreshReason): Promise<EconomicOutlook> {
  const [inputs, priorOutlook] = await Promise.all([getEconomicOutlookInputs(), getLatestOutlookVersion().catch(() => null)]);

  const priorSummary = priorOutlook
    ? { versionId: priorOutlook.meta.versionId, regimeLabel: priorOutlook.regimeTag.label, glance: priorOutlook.outputLayers.glance }
    : null;

  const narrative = await generateEconomicOutlookNarrative(inputs, priorSummary);

  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const versionId = `${asOfDate}-${refreshReason}`;

  const dataLimitations = [
    ...inputs.dataLimitations,
    "event_vol_catalysts is intentionally empty — this app has no live economic-calendar data source integrated (no CME FedWatch, no OIS/futures pricing). Populate manually if you have a real forward calendar.",
    "next_scheduled_refresh is a fixed ~6-week estimate, not pulled from a real FOMC meeting calendar — this app has no live FOMC schedule integrated.",
  ];

  const outlook: EconomicOutlook = {
    meta: {
      versionId,
      asOfDate,
      refreshReason,
      priorVersionId: priorOutlook?.meta.versionId ?? null,
      nextScheduledRefresh: estimateNextScheduledRefresh(now),
    },
    regimeTag: {
      label: narrative.regimeTag.label,
      cyclePhase: narrative.regimeTag.cyclePhase,
      dualMandateBalance: narrative.regimeTag.dualMandateBalance,
      financialConditionsStance: narrative.regimeTag.financialConditionsStance,
    },
    dualMandateScorecard: {
      labor: mergeDerivations(inputs.labor, narrative.laborDerivations),
      inflation: mergeDerivations(inputs.inflation, narrative.inflationDerivations),
    },
    growthAndFinancialConditions: mergeDerivations(inputs.growthAndFinancialConditions, narrative.growthDerivations),
    policyStance: {
      currentTargetRange: narrative.policyStance.currentTargetRange,
      houseViewPath: narrative.policyStance.houseViewPath,
      marketImpliedPath: narrative.policyStance.marketImpliedPath,
      gapAnalysis: narrative.policyStance.gapAnalysis,
    },
    riskBalance: narrative.riskBalance,
    selfQa: narrative.selfQa,
    tradingParameters: {
      volRegime: narrative.tradingParameters.volRegime,
      calendarEffectsPriority: narrative.tradingParameters.calendarEffectsPriority,
      eventVolCatalysts: [],
      meanReversionWindowConfidence: narrative.tradingParameters.meanReversionWindowConfidence,
    },
    outputLayers: {
      glance: narrative.glance,
      narrativeRef: `economic-outlook/${versionId}`,
      triggerFeed: [],
    },
    scorecardLogRef: "economic_outlook_scorecard",
    dataLimitations,
  };

  await saveOutlookVersion(outlook);
  return outlook;
}
