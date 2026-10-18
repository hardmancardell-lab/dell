import type { DecompositionResult } from "./variance-decomposition";
import type { MacroStudyResult } from "./macro-study";
import type { EventStudyResult } from "./types";

/**
 * Plain-language sentences for the News Impact panel. Pure. Reading grade 8 or lower: short sentences, common words.
 * Rules: say "moves with", never "causes"; never give a verdict when there are too few events; a null is a limit of
 * detection ("we could miss an effect up to about 1.4x"), not "no effect"; no advice wording.
 */

const x = (v: number | null): string => (v === null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(v >= 10 ? 0 : 1)}x`);
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export interface BusinessVerdict {
  kind: "unavailable" | "not-enough" | "no-clear-difference" | "somewhat-larger" | "clearly-larger" | "smaller";
  text: string;
}

export function businessVerdict(symbol: string, study: EventStudyResult | null, unavailableReason: string | null): BusinessVerdict {
  if (!study) return { kind: "unavailable", text: unavailableReason ?? "No dated company events are available for this asset, so this test does not run." };
  const p = study.pooled;
  const n = p.day0.n;
  if (study.effect === "not-enough") {
    return {
      kind: "not-enough",
      text: `Not enough events to say. We found ${p.nEvents} usable filing day${p.nEvents === 1 ? "" : "s"} for ${symbol}. We need at least ${study.minHeadlineEvents} before we show a result.`,
    };
  }
  const r = p.day0.ratio;
  const range = `${x(p.day0.ratioLo)} to ${x(p.day0.ratioHi)}`;
  if (study.effect === "clearly-larger" || study.effect === "somewhat-larger") {
    const how = study.effect === "clearly-larger" ? "much more" : "somewhat more";
    return {
      kind: study.effect,
      text: `${symbol} moved ${how} on days it filed with the SEC: about ${x(r)} the usual size (95% range ${range}, ${n} filing days). It moves with company filings. This does not show the filings caused the moves.`,
    };
  }
  if (study.effect === "smaller") {
    return { kind: "smaller", text: `${symbol} moved less than usual on filing days: about ${x(r)} the usual size (95% range ${range}, ${n} filing days). Filing days were not the big days.` };
  }
  return {
    kind: "no-clear-difference",
    text: `No clear difference. On ${n} filing days, ${symbol} moved about ${x(r)} the usual size (95% range ${range}). This does not prove filings do not matter. With this many events we could miss an effect up to about ${x(p.day0.ratioHi)}.`,
  };
}

export function systematicVerdict(symbol: string, d: DecompositionResult | null, ownLabel: string, reason: string | null): { text: string; stability: string | null } {
  if (!d) return { text: reason ?? "There is not enough price history to split this asset's moves.", stability: null };
  const names = d.slices.map((s) => s.label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const range = d.r2TotalLo !== null && d.r2TotalHi !== null ? ` (95% range ${pct(d.r2TotalLo)} to ${pct(d.r2TotalHi)})` : "";
  const first = d.slices[0];
  const betaText = first.beta !== null ? ` When ${first.label} moved 1%, ${symbol} moved about ${first.beta.toFixed(2)}% on average.` : "";
  const text = `About ${pct(d.systematicShare)} of ${symbol}'s daily ups and downs moved with ${list}${range}. The other ${pct(d.ownShare)} was its own (${ownLabel}).${betaText}`;
  let stability: string | null = null;
  if (d.stable === true) stability = "The split looked about the same in the first and second half of the sample.";
  else if (d.stable === false) stability = "The split changed between the first and second half of the sample, so treat it with care.";
  return { text, stability };
}

export function macroVerdict(symbol: string, m: MacroStudyResult | null, reason: string | null): { kind: "unavailable" | "not-enough" | "larger" | "no-clear-difference"; text: string } {
  if (!m) return { kind: "unavailable", text: reason ?? "Macro release dates could not be loaded." };
  const p = m.pooled;
  if (!p.test.enough) return { kind: "not-enough", text: `Not enough macro days to say (${p.nEvents} found, 10 needed).` };
  const range = `${x(p.test.ratioLo)} to ${x(p.test.ratioHi)}`;
  if (p.test.pAdj !== null && p.test.pAdj < 0.05 && p.test.ratioLo !== null && p.test.ratioLo > 1) {
    return { kind: "larger", text: `${symbol} moved about ${x(p.test.ratio)} the usual size on Fed, inflation and jobs days (95% range ${range}, ${p.nEvents} days). It moves with scheduled macro news.` };
  }
  return {
    kind: "no-clear-difference",
    text: `No clear difference on Fed, inflation and jobs days: about ${x(p.test.ratio)} the usual size (95% range ${range}, ${p.nEvents} days). We could miss an effect up to about ${x(p.test.ratioHi)}.`,
  };
}
