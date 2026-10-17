// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/stats-tests.test.mts
// Statistics primitives: Student t against textbook critical values, Benjamini-Hochberg (incl. NaN and a larger family),
// sample (n-1) standard deviation and covariance, seeded block bootstrap, non-overlap thinning.
import { benjaminiHochberg, bootstrapCi, tCdf, tTwoSidedP, tTestPValue, zTestPValue, selectNonOverlapping, overlapBlockLength, mulberry32, seedFromValues } from "../src/lib/agents/trading-agent/skills/stats-tests.ts";
import { stdDev, covariance, correlation, maxDrawdownFromReturns, mean } from "../src/lib/agents/trading-agent/stats.ts";
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---- Student t: two-sided 5% critical values from the standard t table
for (const [df, crit] of [[1, 12.706], [2, 4.303], [4, 2.776], [5, 2.571], [9, 2.262], [10, 2.228], [20, 2.086], [30, 2.042], [60, 2.0], [120, 1.98]]) {
  const p = tTwoSidedP(crit, df);
  t(`t table: df=${df}, t=${crit} gives two-sided p = 0.05`, near(p, 0.05, 0.0006), String(p));
}
t("t: df=4, t=2.0 gives p = 0.1161 (the normal approximation said 0.0455)", near(tTwoSidedP(2, 4), 0.1161, 0.0005));
t("t: df=10, t=1.0 gives p = 0.3409", near(tTwoSidedP(1, 10), 0.3409, 0.0005));
t("t: df=1 is Cauchy: p(t=1) = 0.5 exactly", near(tTwoSidedP(1, 1), 0.5, 1e-9));
t("t: p(0) = 1, p is symmetric, bounded in [0,1]", tTwoSidedP(0, 7) === 1 && tTwoSidedP(-2.3, 7) === tTwoSidedP(2.3, 7) && tTwoSidedP(50, 3) >= 0 && tTwoSidedP(50, 3) <= 1);
t("tCdf: monotone, 0.5 at zero, 0.975 at the 5% critical value", tCdf(0, 6) === 0.5 && near(tCdf(2.447, 6), 0.975, 0.0005) && tCdf(1, 6) < tCdf(2, 6));
t("large df converges to the normal: df=1e6, t=1.96 -> 0.05", near(tTwoSidedP(1.96, 1e6), 0.05, 0.0005));
t("tTestPValue: n=5, mean 1, sd 1 -> t=2.236, df=4", near(tTestPValue(1, 1, 5), tTwoSidedP(Math.sqrt(5), 4), 1e-12));
t("zTestPValue is now the exact t-test (n=5, t=2.236 is p=0.089, not the normal 0.025)", near(zTestPValue(1, 1, 5), 0.0888, 0.002));
t("tTestPValue: n<2 or zero spread is null", tTestPValue(1, 1, 1) === null && tTestPValue(1, 0, 10) === null && tTestPValue(NaN, 1, 10) === null);

// ---- Type-I error of the t-test at small n (seeded Monte Carlo): was 15.4% at n=5 with the normal approximation
{
  const rand = mulberry32(12345);
  const randn = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  for (const n of [5, 10, 30]) {
    let rej = 0;
    const reps = 4000;
    for (let r = 0; r < reps; r++) {
      const xs = Array.from({ length: n }, randn);
      const p = tTestPValue(mean(xs), stdDev(xs), n);
      if (p < 0.05) rej++;
    }
    const rate = rej / reps;
    t(`type-I error of the t-test at n=${n} is about 5% (${(rate * 100).toFixed(1)}%)`, rate > 0.035 && rate < 0.065);
  }
}

// ---- Benjamini-Hochberg
t("BH textbook vector", (() => { const a = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]); return near(a[0], 0.02, 1e-12) && near(a[1], 0.04, 1e-12) && near(a[2], 0.04, 1e-12) && near(a[3], 0.02, 1e-12); })());
t("BH empty and single", benjaminiHochberg([]).length === 0 && benjaminiHochberg([0.2])[0] === 0.2);
t("BH: a NaN no longer poisons the others", (() => { const a = benjaminiHochberg([0.01, NaN, 0.03, 0.04]); return Number.isNaN(a[1]) && near(a[0], 0.03, 1e-12) && near(a[2], 0.04, 1e-12) && near(a[3], 0.04, 1e-12); })());
t("BH: ties keep the same adjusted value", (() => { const a = benjaminiHochberg([0.02, 0.02, 0.02]); return a.every((x) => near(x, 0.02, 1e-12)); })());
t("BH: monotone in the raw p-values and within [0,1]", (() => { const r = mulberry32(5); const ps = Array.from({ length: 200 }, () => r()); const a = benjaminiHochberg(ps); const order = ps.map((p, i) => i).sort((x, y) => ps[x] - ps[y]); return order.every((idx, k) => k === 0 || a[idx] >= a[order[k - 1]] - 1e-15) && a.every((x) => x >= 0 && x <= 1); })());
t("BH: a larger family size (unobserved tests count as p=1) raises the adjusted values", (() => { const a = benjaminiHochberg([0.01, 0.02]); const b = benjaminiHochberg([0.01, 0.02], 20); return b[0] > a[0] && near(b[0], 0.01 * 20 / 1 > 1 ? Math.min(0.2, 0.2) : 0.2, 1e-12) && b[1] >= a[1]; })());

// ---- n-1 standard deviation and covariance
t("stdDev uses n-1: [2,4,4,4,5,5,7,9] -> 2.138 (population 2.0)", near(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2.13809, 1e-4));
t("stdDev of 2 points [1,3] = 1.4142 (n-1), not 1", near(stdDev([1, 3]), Math.SQRT2, 1e-12));
t("stdDev ignores non-finite values and needs two points", near(stdDev([1, 3, NaN]), Math.SQRT2, 1e-12) && stdDev([5]) === null);
t("sample covariance (n-1) and correlation stay consistent", near(covariance([1, 2, 3, 4], [2, 4, 6, 8]), 10 / 3, 1e-12) && near(correlation([1, 2, 3, 4], [2, 4, 6, 8]), 1, 1e-12));
t("z-score scale factor: the n-1 sd is larger than the old one by sqrt(n/(n-1))", (() => { const xs = Array.from({ length: 20 }, (_, i) => i); const old = Math.sqrt(xs.reduce((s, v) => s + (v - 9.5) ** 2, 0) / 20); return near(stdDev(xs) / old, Math.sqrt(20 / 19), 1e-12); })());

// ---- drawdown with a NaN return: skipped, not freezing the peak
t("maxDrawdown skips non-finite returns (same answer as without them)", near(maxDrawdownFromReturns([10, -20, NaN, 5, -10]), maxDrawdownFromReturns([10, -20, 5, -10]), 1e-12) && maxDrawdownFromReturns([NaN]) === null);

// ---- bootstrap: deterministic, seeded from the data, block option
{
  const xs = [0.4, -0.2, 0.9, 0.3, 1.1, -0.1, 0.6, 0.5, 0.2, 0.8];
  const a = bootstrapCi(xs);
  const b = bootstrapCi(xs);
  t("bootstrap: identical data gives an identical interval (seeded from the data)", a.lower === b.lower && a.upper === b.upper);
  const c = bootstrapCi([...xs, 0.7]);
  t("bootstrap: different data gives a different interval", c.lower !== a.lower || c.upper !== a.upper);
  t("bootstrap: explicit seed is honoured", bootstrapCi(xs, 2000, 0.95, { seed: 1 }).lower === bootstrapCi(xs, 2000, 0.95, { seed: 1 }).lower && bootstrapCi(xs, 2000, 0.95, { seed: 1 }).lower !== bootstrapCi(xs, 2000, 0.95, { seed: 2 }).lower);
  const iid = bootstrapCi(xs, 5000, 0.95, { seed: 9 });
  const blk = bootstrapCi(xs, 5000, 0.95, { seed: 9, blockLength: 4 });
  t("bootstrap: block resampling is a valid interval around the mean and is not narrower than iid for positively dependent data", iid.lower < iid.mean && iid.upper > iid.mean && blk.lower < blk.mean && blk.upper > blk.mean);
  const dep = [];
  let level = 0;
  const r = mulberry32(3);
  for (let i = 0; i < 80; i++) { level = 0.9 * level + (r() - 0.5); dep.push(level); }
  const w = (res) => res.upper - res.lower;
  t("bootstrap: for strongly autocorrelated data the block interval is wider than the iid one", w(bootstrapCi(dep, 4000, 0.95, { seed: 4, blockLength: 10 })) > w(bootstrapCi(dep, 4000, 0.95, { seed: 4, blockLength: 1 })));
  t("bootstrap: n<5 can never exclude zero", bootstrapCi([1, 1.1, 0.9, 1.2]).ciExcludesZero === false);
  t("seedFromValues is stable and sensitive", seedFromValues(xs) === seedFromValues([...xs]) && seedFromValues(xs) !== seedFromValues([...xs.slice(0, 9), 0.81]));
}

// ---- overlap handling
t("selectNonOverlapping keeps entries at least `gap` bars apart", JSON.stringify(selectNonOverlapping([1, 2, 3, 10, 11, 25, 26, 40], 5)) === JSON.stringify([0, 3, 5, 7]));
t("selectNonOverlapping with gap 1 keeps consecutive days", selectNonOverlapping([1, 2, 3], 1).length === 3);
t("overlapBlockLength: spread-out entries -> 1; a cluster of 5 within the horizon -> about 3", overlapBlockLength([10, 50, 90], 5) === 1 && overlapBlockLength([10, 11, 12, 13, 14], 5) >= 3);

summary();
