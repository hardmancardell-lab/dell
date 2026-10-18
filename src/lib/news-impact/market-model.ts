import { median } from "@/lib/agents/trading-agent/stats";

/**
 * One-factor market model with a rolling estimation window and a purge gap. Pure.
 *
 * Every day t is scored the same way, event or not: the model is fitted on the L days that END (gap + 1) days before t,
 * so the estimate never sees day t or the run-up to it. That is the project's purge-gap rule, and it means the event
 * days and the ordinary days are measured with identical machinery.
 */

export const ESTIMATION_WINDOW = 120;
export const MIN_ESTIMATION_WINDOW = 60;
export const PURGE_GAP = 5;
export const VOLUME_WINDOW = 60;

export interface OlsFit {
  alpha: number;
  beta: number;
  n: number;
  /** Residual standard deviation with n - 2 degrees of freedom. */
  residSd: number;
  meanX: number;
  sxx: number;
  rSquared: number;
  /** Standard error of beta. */
  seBeta: number;
}

/** Simple regression y = alpha + beta x. Null when there are fewer than 3 points or x has no spread. */
export function olsFit(x: number[], y: number[]): OlsFit | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (!(sxx > 0)) return null;
  const beta = sxy / sxx;
  const alpha = my - beta * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const e = y[i] - alpha - beta * x[i];
    ssr += e * e;
  }
  const residSd = Math.sqrt(ssr / (n - 2));
  const rSquared = syy > 0 ? Math.max(0, Math.min(1, 1 - ssr / syy)) : 0;
  return { alpha, beta, n, residSd, meanX: mx, sxx, rSquared, seBeta: residSd / Math.sqrt(sxx) };
}

export interface RollingScore {
  /** Abnormal log return AR_t = r_t - (alpha + beta f_t); null when no valid window. */
  ar: (number | null)[];
  /** Prediction-error SD for that day (residual SD with the leverage term). */
  sd: (number | null)[];
  /** Standardized abnormal return AR_t / sd_t. */
  sar: (number | null)[];
  /** Beta used for that day. */
  beta: (number | null)[];
}

export interface RollingOptions {
  window?: number;
  minWindow?: number;
  gap?: number;
}

export function scoreRolling(ret: number[], factor: number[], opts: RollingOptions = {}): RollingScore {
  const window = opts.window ?? ESTIMATION_WINDOW;
  const minWindow = opts.minWindow ?? MIN_ESTIMATION_WINDOW;
  const gap = opts.gap ?? PURGE_GAP;
  const n = Math.min(ret.length, factor.length);
  const ar: (number | null)[] = new Array(n).fill(null);
  const sd: (number | null)[] = new Array(n).fill(null);
  const sar: (number | null)[] = new Array(n).fill(null);
  const beta: (number | null)[] = new Array(n).fill(null);
  for (let t = 0; t < n; t++) {
    const end = t - gap - 1; // inclusive
    const start = Math.max(0, end - window + 1);
    if (end - start + 1 < minWindow) continue;
    const fit = olsFit(factor.slice(start, end + 1), ret.slice(start, end + 1));
    if (!fit || !(fit.residSd > 0)) continue;
    const a = ret[t] - (fit.alpha + fit.beta * factor[t]);
    const lev = 1 + 1 / fit.n + (factor[t] - fit.meanX) ** 2 / fit.sxx;
    const s = fit.residSd * Math.sqrt(lev);
    if (!Number.isFinite(a) || !(s > 0)) continue;
    ar[t] = a;
    sd[t] = s;
    sar[t] = a / s;
    beta[t] = fit.beta;
  }
  return { ar, sd, sar, beta };
}

/** ln(volume / median volume of the VOLUME_WINDOW days that end gap + 1 days before). Null when volume is missing. */
export function logVolumeRatio(volume: number[], opts: { window?: number; gap?: number } = {}): (number | null)[] {
  const window = opts.window ?? VOLUME_WINDOW;
  const gap = opts.gap ?? PURGE_GAP;
  const out: (number | null)[] = new Array(volume.length).fill(null);
  for (let t = 0; t < volume.length; t++) {
    const end = t - gap - 1;
    const start = Math.max(0, end - window + 1);
    if (end - start + 1 < Math.min(30, window) || !(volume[t] > 0)) continue;
    const base = volume.slice(start, end + 1).filter((v) => v > 0);
    if (base.length < Math.min(30, window) * 0.8) continue;
    const med = median(base);
    if (med === null || !(med > 0)) continue;
    out[t] = Math.log(volume[t] / med);
  }
  return out;
}

/** Trailing sample SD (n-1) of the returns that end gap + 1 days before each day. Null until the window is full enough. */
export function trailingSd(ret: number[], opts: { window?: number; minWindow?: number; gap?: number } = {}): (number | null)[] {
  const window = opts.window ?? 60;
  const minWindow = opts.minWindow ?? 40;
  const gap = opts.gap ?? PURGE_GAP;
  const out: (number | null)[] = new Array(ret.length).fill(null);
  for (let t = 0; t < ret.length; t++) {
    const end = t - gap - 1;
    const start = Math.max(0, end - window + 1);
    const m = end - start + 1;
    if (m < minWindow) continue;
    let s = 0;
    for (let i = start; i <= end; i++) s += ret[i];
    const mean = s / m;
    let ss = 0;
    for (let i = start; i <= end; i++) ss += (ret[i] - mean) ** 2;
    const sdv = Math.sqrt(ss / (m - 1));
    if (sdv > 0) out[t] = sdv;
  }
  return out;
}
