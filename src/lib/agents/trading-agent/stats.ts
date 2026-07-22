export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

export function stdDev(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const m = clean.reduce((s, v) => s + v, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + (v - m) ** 2, 0) / clean.length;
  return Math.sqrt(variance);
}

/** Drops a pair if either side is non-finite — paired series, not independently filtered. */
function cleanPairs(x: number[], y: number[]): [number[], number[]] {
  const cx: number[] = [];
  const cy: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      cx.push(x[i]);
      cy.push(y[i]);
    }
  }
  return [cx, cy];
}

export function covariance(x: number[], y: number[]): number | null {
  const [cx, cy] = cleanPairs(x, y);
  if (cx.length < 2) return null;
  const mx = cx.reduce((s, v) => s + v, 0) / cx.length;
  const my = cy.reduce((s, v) => s + v, 0) / cy.length;
  let sum = 0;
  for (let i = 0; i < cx.length; i++) sum += (cx[i] - mx) * (cy[i] - my);
  return sum / cx.length;
}

export function correlation(x: number[], y: number[]): number | null {
  const [cx, cy] = cleanPairs(x, y);
  const cov = covariance(cx, cy);
  const sdx = stdDev(cx);
  const sdy = stdDev(cy);
  if (cov === null || sdx === null || sdy === null || sdx === 0 || sdy === 0) return null;
  return cov / (sdx * sdy);
}

export interface LinearRegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  n: number;
}

/**
 * Generic simple OLS regression of y on x — not beta-specific. For a beta
 * calculation, pass benchmark returns as x and asset returns as y: slope is
 * beta, intercept is alpha. rSquared is derived from correlation()^2 rather
 * than re-deriving SSE/SST separately (equivalent for simple regression,
 * cheaper).
 */
export function linearRegression(x: number[], y: number[]): LinearRegressionResult | null {
  const [cx, cy] = cleanPairs(x, y);
  if (cx.length < 2) return null;
  const mx = cx.reduce((s, v) => s + v, 0) / cx.length;
  const my = cy.reduce((s, v) => s + v, 0) / cy.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < cx.length; i++) {
    num += (cx[i] - mx) * (cy[i] - my);
    den += (cx[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = my - slope * mx;
  const r = correlation(cx, cy);
  const rSquared = r !== null ? r * r : 0;
  return { slope, intercept, rSquared, n: cx.length };
}

export interface WinLossMetrics {
  winRate: number | null; // 0-100
  avgWinPct: number | null;
  avgLossPct: number | null; // signed (<=0)
  profitFactor: number | null; // sum(wins)/abs(sum(losses)); null if no losses
  expectancy: number | null; // == mean(values) algebraically; kept explicit for UI discoverability
  maxDrawdownPct: number | null; // sequential-compounding equity-curve simulation, order-sensitive
  largestWinPct: number | null;
  largestLossPct: number | null;
}

/** Simulates a compounding equity curve over the array IN ORDER — inherits the same overlapping-window autocorrelation caveat historical-backtest.ts already documents for its forward-return windows. */
function maxDrawdownFromReturns(returnsPct: number[]): number | null {
  if (returnsPct.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returnsPct) {
    equity *= 1 + r / 100;
    peak = Math.max(peak, equity);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - equity) / peak);
  }
  return maxDD * 100;
}

/**
 * Win/loss framing on top of a chronologically-ordered array of percent
 * returns — the same `values` array every backtest engine already builds
 * for mean()/median(). All fields but maxDrawdownPct are order-independent;
 * maxDrawdownPct is not, since it walks the array as a sequential trade path.
 */
const DAYS_TO_REVERT_BUCKET_LABELS = [
  "1-3 trading days",
  "4-5 trading days",
  "6-10 trading days",
  "11-20 trading days",
  "21+ trading days",
];

function daysToRevertBucketLabel(days: number): string {
  if (days <= 3) return DAYS_TO_REVERT_BUCKET_LABELS[0];
  if (days <= 5) return DAYS_TO_REVERT_BUCKET_LABELS[1];
  if (days <= 10) return DAYS_TO_REVERT_BUCKET_LABELS[2];
  if (days <= 20) return DAYS_TO_REVERT_BUCKET_LABELS[3];
  return DAYS_TO_REVERT_BUCKET_LABELS[4];
}

export interface ReversionTrackingPoint {
  daysToRevert: number | null;
  maxAdverseExcursionPct: number | null;
}

export interface DaysToRevertBucketResult {
  bucketLabel: string;
  count: number;
  pctOfOccurrences: number;
}

export interface ReversionStatsResult {
  occurrencesTracked: number;
  occurrencesReverted: number;
  occurrencesNeverReverted: number;
  maxTrackingDays: number;
  meanDaysToRevert: number | null;
  medianDaysToRevert: number | null;
  daysToRevertDistribution: DaysToRevertBucketResult[];
  avgMaxAdverseExcursionPct: number | null;
  worstMaxAdverseExcursionPct: number | null;
}

/**
 * Generic reversion-timing summary — extracted from historical-backtest.ts's
 * original inline version so peg-reversion.ts (and any future reversion-
 * tracking engine) can reuse it instead of duplicating the bucket/summary
 * math. `excursionDirection` replaces the old signalType-based branch: pass
 * "min" when the worst excursion is the most-negative value (price fell
 * furthest below its anchor — e.g. an oversold/below-target read), "max"
 * when it's the most-positive (overbought/above-target).
 */
export function buildReversionStats(
  reversions: ReversionTrackingPoint[],
  excursionDirection: "min" | "max",
  maxTrackingDays: number
): ReversionStatsResult | null {
  if (reversions.length === 0) return null;

  const reverted = reversions.filter((o) => o.daysToRevert !== null);
  const neverReverted = reversions.length - reverted.length;
  const revertedDays = reverted.map((o) => o.daysToRevert as number);

  const notRevertedLabel = `Not reverted within ${maxTrackingDays}d`;
  const counts = new Map<string, number>([...DAYS_TO_REVERT_BUCKET_LABELS, notRevertedLabel].map((l) => [l, 0]));
  for (const d of revertedDays) counts.set(daysToRevertBucketLabel(d), (counts.get(daysToRevertBucketLabel(d)) ?? 0) + 1);
  counts.set(notRevertedLabel, neverReverted);

  const daysToRevertDistribution: DaysToRevertBucketResult[] = [...DAYS_TO_REVERT_BUCKET_LABELS, notRevertedLabel].map(
    (bucketLabel) => ({
      bucketLabel,
      count: counts.get(bucketLabel) ?? 0,
      pctOfOccurrences: ((counts.get(bucketLabel) ?? 0) / reversions.length) * 100,
    })
  );

  const allExcursions = reversions.map((o) => o.maxAdverseExcursionPct).filter((v): v is number => v !== null);
  const worstMaxAdverseExcursionPct =
    allExcursions.length === 0 ? null : excursionDirection === "min" ? Math.min(...allExcursions) : Math.max(...allExcursions);

  return {
    occurrencesTracked: reversions.length,
    occurrencesReverted: reverted.length,
    occurrencesNeverReverted: neverReverted,
    maxTrackingDays,
    meanDaysToRevert: mean(revertedDays),
    medianDaysToRevert: median(revertedDays),
    daysToRevertDistribution,
    avgMaxAdverseExcursionPct: mean(allExcursions),
    worstMaxAdverseExcursionPct,
  };
}

export function computeWinLossMetrics(chronologicalReturnsPct: number[]): WinLossMetrics {
  const clean = chronologicalReturnsPct.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return {
      winRate: null,
      avgWinPct: null,
      avgLossPct: null,
      profitFactor: null,
      expectancy: null,
      maxDrawdownPct: null,
      largestWinPct: null,
      largestLossPct: null,
    };
  }

  const wins = clean.filter((v) => v > 0);
  const losses = clean.filter((v) => v <= 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));

  return {
    winRate: (wins.length / clean.length) * 100,
    avgWinPct: wins.length > 0 ? mean(wins) : null,
    avgLossPct: losses.length > 0 ? mean(losses) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: mean(clean),
    maxDrawdownPct: maxDrawdownFromReturns(clean),
    largestWinPct: wins.length > 0 ? Math.max(...wins) : null,
    largestLossPct: losses.length > 0 ? Math.min(...losses) : null,
  };
}
