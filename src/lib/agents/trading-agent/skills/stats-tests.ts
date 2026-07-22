import { normCdf } from "../black-scholes";

/**
 * Benjamini-Hochberg FDR correction — direct port of
 * options-signals-project/backtest_engine.py's significance_tests()
 * BH-adjustment logic (rank, scale, reverse-cumulative-min for step-up
 * monotonicity, clip to [0,1]). Returns adjusted p-values in the same order
 * as the input.
 */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];

  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);

  const bhAdj = indexed.map((x, rank) => (x.p * m) / (rank + 1));
  for (let k = bhAdj.length - 2; k >= 0; k--) {
    bhAdj[k] = Math.min(bhAdj[k], bhAdj[k + 1]);
  }
  const clipped = bhAdj.map((v) => Math.min(1, Math.max(0, v)));

  const result = new Array(m).fill(0);
  indexed.forEach((x, rank) => {
    result[x.i] = clipped[rank];
  });
  return result;
}

export interface BootstrapCiResult {
  mean: number | null;
  lower: number | null;
  upper: number | null;
  ciExcludesZero: boolean;
}

/**
 * Percentile bootstrap — direct port of backtest_engine.py's bootstrap_ci().
 * Not seeded (unlike the deterministic mock-data generators elsewhere in
 * this codebase) — this runs against real data, where run-to-run bootstrap
 * variation is expected and fine, not something to hide behind determinism.
 */
export function bootstrapCi(values: number[], nBoot = 5000, ci = 0.95): BootstrapCiResult {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { mean: null, lower: null, upper: null, ciExcludesZero: false };

  const bootMeans: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    for (let i = 0; i < clean.length; i++) {
      sum += clean[Math.floor(Math.random() * clean.length)];
    }
    bootMeans.push(sum / clean.length);
  }
  bootMeans.sort((a, b) => a - b);

  const lowerIdx = Math.floor(((1 - ci) / 2) * nBoot);
  const upperIdx = Math.min(Math.floor(((1 + ci) / 2) * nBoot), nBoot - 1);
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const lower = bootMeans[lowerIdx];
  const upper = bootMeans[upperIdx];

  return { mean, lower, upper, ciExcludesZero: lower > 0 || upper < 0 };
}

/**
 * Two-tailed one-sample z-test p-value against a null mean of zero — a
 * documented approximation of backtest_engine.py's scipy Student's t-test,
 * reusing black-scholes.ts's already-validated normCdf rather than
 * implementing a full t-distribution CDF (needs a numerical incomplete-beta
 * function). The difference from an exact t-test is small at the sample
 * sizes a multi-year daily backtest produces (typically n > 30) and grows
 * for small samples — same "n<30, treat as directional only" caveat
 * backtest_engine.py's own README already states for its t-test.
 */
export function zTestPValue(sampleMean: number, sampleStd: number, n: number): number | null {
  if (n < 2 || sampleStd <= 0) return null;
  const standardError = sampleStd / Math.sqrt(n);
  const z = sampleMean / standardError;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return Math.min(1, Math.max(0, p));
}
