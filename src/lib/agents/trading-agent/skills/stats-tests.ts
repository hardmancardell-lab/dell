/**
 * Significance helpers shared by every backtest and study engine.
 *
 * - benjaminiHochberg: FDR step-up correction; ignores non-finite p-values (they no longer poison the others) and can
 *   scale to a larger family than the p-values passed in.
 * - tCdf / tTestPValue / zTestPValue: Student's t distribution (regularised incomplete beta); zTestPValue is kept as the
 *   name every engine already imports, and now returns the exact t-test p-value for the sample size.
 * - bootstrapCi: percentile bootstrap of the mean, SEEDED deterministically from the data (same data, same interval)
 *   with an optional block length for serially dependent values.
 * - selectNonOverlapping: greedy thinning so forward windows do not overlap.
 */

// --------------------------------------------------------------------------------------------- Benjamini-Hochberg

/**
 * Benjamini-Hochberg FDR correction — direct port of options-signals-project/backtest_engine.py's significance_tests()
 * BH-adjustment logic (rank, scale, reverse-cumulative-min for step-up monotonicity, clip to [0,1]). Returns adjusted
 * p-values in the same order as the input.
 *
 * Non-finite inputs (NaN, Infinity) are excluded from the family and returned as NaN, so one bad value no longer
 * contaminates the valid ones. `familySize` (default: the number of valid p-values) is the number of hypotheses in the
 * whole family; when it is larger than what is passed in, the unobserved tests count as p = 1 (conservative).
 */
export function benjaminiHochberg(pValues: number[], familySize?: number): number[] {
  const result = new Array<number>(pValues.length).fill(NaN);
  const indexed: { p: number; i: number }[] = [];
  pValues.forEach((p, i) => {
    if (typeof p === "number" && Number.isFinite(p)) indexed.push({ p: Math.min(1, Math.max(0, p)), i });
  });
  const m = Math.max(indexed.length, familySize ?? 0);
  if (indexed.length === 0) return result;

  indexed.sort((a, b) => a.p - b.p);
  const bhAdj = indexed.map((x, rank) => (x.p * m) / (rank + 1));
  for (let k = bhAdj.length - 2; k >= 0; k--) {
    bhAdj[k] = Math.min(bhAdj[k], bhAdj[k + 1]);
  }
  indexed.forEach((x, rank) => {
    result[x.i] = Math.min(1, Math.max(0, bhAdj[rank]));
  });
  return result;
}

// ---------------------------------------------------------------------------------------------- seeded randomness

/** Small fast seeded PRNG (mulberry32): same seed, same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 32-bit seed from the numbers themselves (FNV-1a over their rounded values), so equal data gives equal results. */
export function seedFromValues(values: number[]): number {
  let h = 2166136261 >>> 0;
  for (const v of values) {
    const q = Math.round(v * 1e6);
    h ^= q & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= Math.floor(q / 4294967296) & 0xffffffff;
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= values.length;
  h = Math.imul(h, 16777619) >>> 0;
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------- bootstrap

export interface BootstrapCiResult {
  mean: number | null;
  lower: number | null;
  upper: number | null;
  ciExcludesZero: boolean;
}

// A percentile bootstrap resamples WITH REPLACEMENT from the sample itself —
// with fewer than this many real points, every resample just reshuffles the
// same handful of values, so the interval collapses toward a single point
// rather than approximating a real sampling distribution. Below this floor,
// ciExcludesZero is forced false regardless of what the (meaningless)
// interval shows — real bug found live: an n=1 bucket's bootstrap always
// resamples that one value, so lower===upper===that value, and
// ciExcludesZero came out true whenever the value happened to be nonzero,
// even though n=1 can say nothing about statistical significance.
const MIN_BOOTSTRAP_SAMPLE_SIZE = 5;

export interface BootstrapOptions {
  /**
   * Block length for a (circular) moving-block bootstrap. 1 (default) is the ordinary iid bootstrap. Use a length of
   * about the number of consecutive values whose forward windows overlap when the values are serially dependent.
   */
  blockLength?: number;
  /** Seed for the resampling. Default: derived from the data itself, so the same data always gives the same interval. */
  seed?: number;
}

/**
 * Percentile bootstrap of the mean — port of backtest_engine.py's bootstrap_ci(), now (a) SEEDED from the data so a
 * borderline `ciExcludesZero` no longer flips between page loads, and (b) optionally a circular moving-block bootstrap
 * (blockLength > 1) so serial dependence between overlapping forward windows widens the interval instead of being ignored.
 */
export function bootstrapCi(values: number[], nBoot = 5000, ci = 0.95, options: BootstrapOptions = {}): BootstrapCiResult {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { mean: null, lower: null, upper: null, ciExcludesZero: false };

  const n = clean.length;
  const block = Math.max(1, Math.min(n, Math.round(options.blockLength ?? 1)));
  const rand = mulberry32(options.seed ?? seedFromValues(clean));
  const bootMeans: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    let sum = 0;
    let taken = 0;
    while (taken < n) {
      const start = Math.floor(rand() * n);
      const len = Math.min(block, n - taken);
      for (let k = 0; k < len; k++) sum += clean[(start + k) % n];
      taken += len;
    }
    bootMeans.push(sum / n);
  }
  bootMeans.sort((a, b) => a - b);

  const lowerIdx = Math.floor(((1 - ci) / 2) * nBoot);
  const upperIdx = Math.min(Math.floor(((1 + ci) / 2) * nBoot), nBoot - 1);
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const lower = bootMeans[lowerIdx];
  const upper = bootMeans[upperIdx];
  const ciExcludesZero = n >= MIN_BOOTSTRAP_SAMPLE_SIZE && (lower > 0 || upper < 0);

  return { mean, lower, upper, ciExcludesZero };
}

// ---------------------------------------------------------------------------------------------- Student t

/** log Gamma by the Lanczos approximation (g = 7, 9 coefficients): relative error below 1e-13 for x > 0. */
function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0];
  const t = xx + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (modified Lentz). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAX_ITER = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta function I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betaContinuedFraction(a, b, x)) / a : 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Two-sided tail probability P(|T| >= |t|) of Student's t with `df` degrees of freedom. */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || !(df > 0)) return NaN;
  if (t === 0) return 1;
  return Math.min(1, Math.max(0, regularizedIncompleteBeta(df / (df + t * t), df / 2, 0.5)));
}

/** Student's t cumulative distribution function. */
export function tCdf(t: number, df: number): number {
  const twoSided = tTwoSidedP(t, df);
  return t >= 0 ? 1 - twoSided / 2 : twoSided / 2;
}

/**
 * Two-tailed one-sample t-test p-value against a null mean of zero, with n - 1 degrees of freedom. `sampleStd` must be
 * the SAMPLE standard deviation (divisor n - 1, which is what stats.ts stdDev now returns). The exact t distribution
 * replaces the old normal approximation: at n = 5 the normal reported p = 0.019 where the true value is 0.104.
 * Returns null when n < 2 or the spread is zero.
 */
export function tTestPValue(sampleMean: number, sampleStd: number, n: number): number | null {
  if (n < 2 || !(sampleStd > 0) || !Number.isFinite(sampleMean) || !Number.isFinite(sampleStd)) return null;
  const t = sampleMean / (sampleStd / Math.sqrt(n));
  return tTwoSidedP(t, n - 1);
}

/** Name kept for the existing engines: now the exact Student's t-test p-value (see tTestPValue). */
export function zTestPValue(sampleMean: number, sampleStd: number, n: number): number | null {
  return tTestPValue(sampleMean, sampleStd, n);
}

// ---------------------------------------------------------------------------------------------- overlap handling

/**
 * Greedy thinning: from entry indices in ascending order, keeps the positions whose entry is at least `gap` bars after
 * the previously kept one, so forward windows of length `gap` do not overlap. Returns the kept positions (indexes into
 * `entryIndices`). Consecutive-day signals with a 20-day horizon collapse to one independent observation per window.
 */
export function selectNonOverlapping(entryIndices: number[], gap: number): number[] {
  const kept: number[] = [];
  let last = -Infinity;
  entryIndices.forEach((idx, pos) => {
    if (idx - last >= gap) {
      kept.push(pos);
      last = idx;
    }
  });
  return kept;
}

/**
 * Expected number of entries that share one forward window of `horizon` bars: the average, over entries, of how many
 * entries (itself included) start within `horizon` bars of it. 1 means no overlap; used as the block length for the
 * block bootstrap of overlapping windows.
 */
export function overlapBlockLength(entryIndices: number[], horizon: number): number {
  if (entryIndices.length === 0) return 1;
  let total = 0;
  for (let a = 0; a < entryIndices.length; a++) {
    let count = 0;
    for (let b = a; b < entryIndices.length && entryIndices[b] - entryIndices[a] < horizon; b++) count++;
    total += count;
  }
  return Math.max(1, Math.round(total / entryIndices.length));
}

// ---------------------------------------------------------------------------------------------- train / test helpers

/** Fraction of chronological values used for training (bars 1 and 2); the rest is held out for the sign check (bar 3). */
export const TRAIN_FRACTION = 0.75;
/** Fewest held-out values for the same-sign check to mean anything. */
export const MIN_TEST_VALUES = 3;

/**
 * Two-sided t-test p-value of the TRAINING part (first TRAIN_FRACTION) of chronological values against a mean of zero.
 * Bars 1 and 2 use training data only, so the held-out part is not used twice. Values must not overlap in time
 * (same-session returns, one observation per day or per event); for overlapping forward windows thin them first.
 */
export function trainTTestPValue(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  const train = clean.slice(0, Math.floor(clean.length * TRAIN_FRACTION));
  if (train.length < 2) return null;
  const m = train.reduce((s, v) => s + v, 0) / train.length;
  const sd = Math.sqrt(train.reduce((s, v) => s + (v - m) ** 2, 0) / (train.length - 1));
  return tTestPValue(m, sd, train.length);
}
