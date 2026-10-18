import { mulberry32, seedFromValues } from "@/lib/agents/trading-agent/skills/stats-tests";
import { multipleLinearRegression } from "@/lib/agents/trading-agent/stats";
import { olsFit } from "./market-model";
import type { FactorSpec } from "./types";

/**
 * Systematic versus own (business) share of an asset's variance. Pure.
 *
 * Factors are added in order. The first factor's slice is its one-factor R-squared; each later factor's slice is the
 * R-squared it adds beyond the earlier ones (the order is disclosed because it matters when factors move together).
 * Systematic share = R-squared of all factors together. Own share = 1 minus that. A seeded circular block bootstrap
 * gives an interval for the total, and the same fit on each half of the sample says whether the split is stable.
 */

export const MIN_DECOMP_RETURNS = 60;
const BOOT_REPS = 400;
const BOOT_BLOCK = 5;
export const STABLE_R2_GAP = 0.15;
export const STABLE_BETA_Z = 2;

export interface FactorSlice {
  symbol: string;
  label: string;
  short: string;
  /** One-factor beta (asset move per 1% move in the factor) and its standard error. */
  beta: number | null;
  seBeta: number | null;
  /** R-squared of this factor on its own. */
  r2Alone: number | null;
  /** R-squared added beyond the factors before it. */
  r2Added: number | null;
}

export interface HalfFit {
  n: number;
  from: string;
  to: string;
  r2Total: number | null;
  beta1: number | null;
  seBeta1: number | null;
}

export interface DecompositionResult {
  n: number;
  from: string;
  to: string;
  slices: FactorSlice[];
  r2Total: number;
  r2TotalLo: number | null;
  r2TotalHi: number | null;
  /** Share of variance that moves with the factors. */
  systematicShare: number;
  /** Share left over (the asset's own). */
  ownShare: number;
  halves: [HalfFit, HalfFit] | null;
  /** Beta difference in standard errors between the halves (first factor). */
  betaZ: number | null;
  r2Gap: number | null;
  /** True when the two halves agree; null when a half is too short to judge. */
  stable: boolean | null;
}

function r2Of(y: number[], xs: number[][]): number | null {
  if (xs.length === 0) return 0;
  const fit = multipleLinearRegression(y, xs);
  return fit ? Math.max(0, Math.min(1, fit.rSquared)) : null;
}

function cumulativeR2(y: number[], xs: number[][]): (number | null)[] {
  return xs.map((_, k) => r2Of(y, xs.slice(0, k + 1)));
}

export function decomposeVariance(dates: string[], ret: number[], factorRet: number[][], factors: FactorSpec[]): DecompositionResult | null {
  const n = Math.min(ret.length, ...factorRet.map((f) => f.length));
  if (factors.length === 0 || n < MIN_DECOMP_RETURNS) return null;
  const y = ret.slice(0, n);
  const xs = factorRet.map((f) => f.slice(0, n));

  const cum = cumulativeR2(y, xs);
  if (cum.some((c) => c === null)) return null;
  const cumN = cum as number[];
  const slices: FactorSlice[] = factors.map((f, k) => {
    const fit = olsFit(xs[k], y);
    return {
      symbol: f.symbol,
      label: f.label,
      short: f.short,
      beta: fit ? fit.beta : null,
      seBeta: fit ? fit.seBeta : null,
      r2Alone: fit ? fit.rSquared : null,
      r2Added: k === 0 ? cumN[0] : Math.max(0, cumN[k] - cumN[k - 1]),
    };
  });
  const r2Total = cumN[cumN.length - 1];

  // Seeded circular block bootstrap of the total R-squared.
  const rand = mulberry32(seedFromValues(y.slice(0, 200)));
  const boots: number[] = [];
  for (let b = 0; b < BOOT_REPS; b++) {
    const idx: number[] = [];
    while (idx.length < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < BOOT_BLOCK && idx.length < n; k++) idx.push((start + k) % n);
    }
    const r = r2Of(idx.map((i) => y[i]), xs.map((x) => idx.map((i) => x[i])));
    if (r !== null) boots.push(r);
  }
  boots.sort((a, c) => a - c);
  const lo = boots.length >= 50 ? boots[Math.floor(0.025 * boots.length)] : null;
  const hi = boots.length >= 50 ? boots[Math.min(boots.length - 1, Math.floor(0.975 * boots.length))] : null;

  // Stability across the two halves of the sample.
  const mid = Math.floor(n / 2);
  const half = (from: number, to: number): HalfFit => {
    const yy = y.slice(from, to);
    const xx = xs.map((x) => x.slice(from, to));
    const m = yy.length;
    const r2 = m >= MIN_DECOMP_RETURNS / 2 ? r2Of(yy, xx) : null;
    const f1 = m >= MIN_DECOMP_RETURNS / 2 ? olsFit(xx[0], yy) : null;
    return { n: m, from: dates[from], to: dates[to - 1], r2Total: r2, beta1: f1 ? f1.beta : null, seBeta1: f1 ? f1.seBeta : null };
  };
  const h1 = half(0, mid);
  const h2 = half(mid, n);
  let betaZ: number | null = null;
  let r2Gap: number | null = null;
  let stable: boolean | null = null;
  if (h1.beta1 !== null && h2.beta1 !== null && h1.seBeta1 !== null && h2.seBeta1 !== null && h1.r2Total !== null && h2.r2Total !== null) {
    const se = Math.sqrt(h1.seBeta1 ** 2 + h2.seBeta1 ** 2);
    betaZ = se > 0 ? (h1.beta1 - h2.beta1) / se : null;
    r2Gap = Math.abs(h1.r2Total - h2.r2Total);
    stable = betaZ !== null && Math.abs(betaZ) < STABLE_BETA_Z && r2Gap < STABLE_R2_GAP;
  }

  return {
    n,
    from: dates[0],
    to: dates[n - 1],
    slices,
    r2Total,
    r2TotalLo: lo,
    r2TotalHi: hi,
    systematicShare: r2Total,
    ownShare: 1 - r2Total,
    halves: [h1, h2],
    betaZ,
    r2Gap,
    stable,
  };
}
