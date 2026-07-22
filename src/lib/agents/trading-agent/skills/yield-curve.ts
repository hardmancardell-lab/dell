import { fetchFredSeries, latest } from "@/lib/data/fred";
import type { FredSeriesPoint, YieldCurveInversion, YieldCurvePoint, YieldCurveResult } from "../types";

// The full standard Treasury constant-maturity curve — bond-macro.ts and
// macro-overview.ts only ever fetch T10Y2Y (a spread, not a level) and
// DGS3MO (scoped to the options calculator's risk-free rate); no other part
// of this app fetches individual tenor levels, so this is genuinely new
// wiring, not a reuse of an existing series set.
const TREASURY_TENORS: { label: string; seriesId: string }[] = [
  { label: "1 Month", seriesId: "DGS1MO" },
  { label: "3 Month", seriesId: "DGS3MO" },
  { label: "6 Month", seriesId: "DGS6MO" },
  { label: "1 Year", seriesId: "DGS1" },
  { label: "2 Year", seriesId: "DGS2" },
  { label: "3 Year", seriesId: "DGS3" },
  { label: "5 Year", seriesId: "DGS5" },
  { label: "7 Year", seriesId: "DGS7" },
  { label: "10 Year", seriesId: "DGS10" },
  { label: "20 Year", seriesId: "DGS20" },
  { label: "30 Year", seriesId: "DGS30" },
];

// BAMLH0A0HYM2 (high yield) is already used by bond-macro.ts/macro-overview.ts;
// BAMLC0A0CM (investment grade) is new.
const CREDIT_SPREAD_SERIES: { label: string; seriesId: string }[] = [
  { label: "ICE BofA US High Yield Index OAS", seriesId: "BAMLH0A0HYM2" },
  { label: "ICE BofA US Corporate Index OAS (Investment Grade)", seriesId: "BAMLC0A0CM" },
];

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "unknown error";
}

/**
 * Uses Promise.allSettled rather than macro-overview.ts's fail-fast pattern —
 * one missing tenor (a thin/discontinued series, a transient FRED hiccup)
 * shouldn't blank the whole curve. Each failure is recorded in
 * dataLimitations and that point's value is left null rather than fabricated.
 */
export async function getYieldCurve(): Promise<YieldCurveResult> {
  const dataLimitations: string[] = [];

  const tenorResults = await Promise.allSettled(TREASURY_TENORS.map((t) => fetchFredSeries(t.seriesId, 5)));

  const points: YieldCurvePoint[] = TREASURY_TENORS.map((t, i) => {
    const result = tenorResults[i];
    if (result.status === "rejected") {
      dataLimitations.push(`${t.label} (${t.seriesId}) failed to fetch: ${reasonMessage(result.reason)}.`);
      return { tenorLabel: t.label, seriesId: t.seriesId, date: "", value: null };
    }
    const mostRecent = latest(result.value);
    if (!mostRecent) {
      dataLimitations.push(`${t.label} (${t.seriesId}) returned no recent observations.`);
      return { tenorLabel: t.label, seriesId: t.seriesId, date: "", value: null };
    }
    return { tenorLabel: t.label, seriesId: t.seriesId, date: mostRecent.date, value: mostRecent.value };
  });

  if (points.every((p) => p.value === null)) {
    throw new Error("Every Treasury tenor failed to fetch — check FRED_API_KEY and series availability.");
  }

  // Full-curve generalization of the single T10Y2Y check used elsewhere:
  // flag every adjacent pair (in ascending tenor order) where the longer
  // tenor currently yields less than the shorter one.
  const inversions: YieldCurveInversion[] = [];
  const validPoints = points.filter((p): p is YieldCurvePoint & { value: number } => p.value !== null);
  for (let i = 0; i < validPoints.length - 1; i++) {
    const shorter = validPoints[i];
    const longer = validPoints[i + 1];
    if (longer.value < shorter.value) {
      inversions.push({ fromTenor: shorter.tenorLabel, toTenor: longer.tenorLabel });
    }
  }

  const spreadResults = await Promise.allSettled(CREDIT_SPREAD_SERIES.map((s) => fetchFredSeries(s.seriesId, 5)));
  const creditSpreads: FredSeriesPoint[] = [];
  CREDIT_SPREAD_SERIES.forEach((s, i) => {
    const result = spreadResults[i];
    if (result.status === "rejected") {
      dataLimitations.push(`${s.label} (${s.seriesId}) failed to fetch: ${reasonMessage(result.reason)}.`);
      return;
    }
    const mostRecent = latest(result.value);
    if (!mostRecent) {
      dataLimitations.push(`${s.label} (${s.seriesId}) returned no recent observations.`);
      return;
    }
    creditSpreads.push({ seriesId: s.seriesId, label: s.label, date: mostRecent.date, value: mostRecent.value });
  });

  dataLimitations.push(
    'An "inverted" segment is any adjacent tenor pair (in ascending order) where the longer tenor currently yields less than the shorter one — a full-curve generalization of the single 10Y-2Y check used on the Bonds Overview tab and the Macro tab.'
  );

  return { points, inversions, creditSpreads, dataLimitations };
}
