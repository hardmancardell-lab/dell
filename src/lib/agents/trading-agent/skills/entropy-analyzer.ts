import type { DailyBar } from "../types";

/**
 * Shannon Information Entropy over a return series —
 * H(X) = -Σ p(xᵢ)·log₂(p(xᵢ)) — a real, standard measure of how random a
 * distribution is (bounded [0, log2(bins)], normalized here to [0,1] by
 * dividing by log2(bins) so scores are comparable across tickers regardless
 * of sample size). Returns are bucketed into a fixed-width histogram over
 * their own observed range, then entropy is computed over the resulting bin
 * probabilities — the same construction used everywhere entropy is applied
 * to a continuous variable in practice, since Shannon entropy is only
 * exactly defined for discrete distributions.
 *
 * Logged on every Strategy Hypothesis Ledger row (validated or rejected)
 * for transparency about the regime a result was found in — NOT used as a
 * live filter. A real historical statistical edge doesn't stop being real
 * just because current entropy happens to be high; silently discarding
 * results on that basis would make the ledger misleadingly empty in choppy
 * markets, which this app's "never fake/never silently hide real data"
 * discipline rules out.
 */
export function computeShannonEntropy(returns: number[], bins = 10): number | null {
  const finite = returns.filter((r) => Number.isFinite(r));
  if (finite.length < bins) return null; // not enough observations for a meaningful histogram

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (min === max) return 0; // zero variance in the sample = zero disorder

  const width = (max - min) / bins;
  const counts = new Array(bins).fill(0) as number[];
  for (const r of finite) {
    let idx = Math.floor((r - min) / width);
    if (idx >= bins) idx = bins - 1; // the max observation falls in the last bin, not a phantom bin+1
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }

  const n = finite.length;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy / Math.log2(bins);
}

export type EntropyRegime = "low" | "medium" | "high";

/** Thresholds are a documented, round-number convention (not a statistically fit boundary) — same honesty framing as this app's other rule-based classifiers (e.g. gex-signal.ts's regime labels). */
export function classifyEntropyRegime(score: number | null): EntropyRegime | null {
  if (score === null) return null;
  if (score < 0.6) return "low";
  if (score < 0.85) return "medium";
  return "high";
}

/** Daily close-to-close percent returns from real bars, chronological order preserved. */
export function dailyReturnsFromBars(bars: DailyBar[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (prev > 0) returns.push((curr - prev) / prev);
  }
  return returns;
}
