import { fetchBuybackOperations } from "@/lib/data/treasury-buybacks";
import { getDailyBars } from "./daily-bars";
import { linearRegression, multipleLinearRegression } from "../stats";
import type {
  BetaDriftResult,
  BuybackAnomalyResult,
  BuybackEventRow,
  BuybackRegressionResult,
  DailyBar,
  DummyVariableRegressionResult,
  MarketModelFit,
} from "../types";

const LONG_TERM_MATURITY_BUCKET = "20Y to 30Y";
const LOOKBACK_DAYS = 900; // comfortably covers the buyback program's real history since its 2024 restart
// UUP (Invesco DB US Dollar Index Bullish Fund) — the real, liquid dollar-strength
// proxy already used elsewhere in this app (correlation-matrix.ts's DEFAULT_MATRIX_UNIVERSE),
// not a new ad hoc choice. The actual ICE Dollar Index (DXY) isn't available through
// any provider this app has — UUP is the standard practitioner substitute.
const MARKET_MODEL_BENCHMARK = "UUP";

/** Same percentile-CI construction stats-tests.ts's bootstrapCi uses for a single array, applied here to a resampled-and-refit regression slope instead of a resampled mean — bootstrapCi itself only bootstraps one array, not a paired x/y regression. */
function bootstrapRegressionSlope(x: number[], y: number[], nBoot = 5000, ci = 0.95): { lower: number | null; upper: number | null; ciExcludesZero: boolean } {
  const n = Math.min(x.length, y.length);
  if (n < 4) return { lower: null, upper: null, ciExcludesZero: false };
  const slopes: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const rx: number[] = [];
    const ry: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      rx.push(x[idx]);
      ry.push(y[idx]);
    }
    const reg = linearRegression(rx, ry);
    if (reg) slopes.push(reg.slope);
  }
  return percentileCi(slopes, ci);
}

function percentileCi(values: number[], ci: number): { lower: number | null; upper: number | null; ciExcludesZero: boolean } {
  if (values.length === 0) return { lower: null, upper: null, ciExcludesZero: false };
  const sorted = [...values].sort((a, b) => a - b);
  const loIdx = Math.floor(((1 - ci) / 2) * sorted.length);
  const hiIdx = Math.min(Math.floor(((1 + ci) / 2) * sorted.length), sorted.length - 1);
  const lower = sorted[loIdx];
  const upper = sorted[hiIdx];
  return { lower, upper, ciExcludesZero: lower > 0 || upper < 0 };
}

function buildRegression(x: number[], y: number[]): BuybackRegressionResult | null {
  const reg = linearRegression(x, y);
  if (!reg) return null;
  const { lower, upper, ciExcludesZero } = bootstrapRegressionSlope(x, y);
  return {
    slope: reg.slope,
    intercept: reg.intercept,
    rSquared: reg.rSquared,
    n: reg.n,
    bootstrapSlopeLower: lower,
    bootstrapSlopeUpper: upper,
    ciExcludesZero,
  };
}

/**
 * The real, standard single-pass event-study form (Karafiath 1988; Binder
 * 1985/1998): fits R_t = α + β·R_m,t + γ·D_t + ε across ALL trading days at
 * once — D_t is the buyback $ amount on an event day, 0 elsewhere — rather
 * than estimating the market model on non-event days and subtracting
 * afterward. γ is bootstrapped by resampling (y, R_m, D) rows jointly and
 * refitting the full multiple regression each draw.
 */
function dummyVariableRegression(target: number[], benchmark: number[], dummy: number[], nBoot = 5000, ci = 0.95): DummyVariableRegressionResult | null {
  const reg = multipleLinearRegression(target, [benchmark, dummy]);
  if (!reg) return null;
  const n = target.length;
  const gammas: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const ry: number[] = [];
    const rBench: number[] = [];
    const rDummy: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      ry.push(target[idx]);
      rBench.push(benchmark[idx]);
      rDummy.push(dummy[idx]);
    }
    const r = multipleLinearRegression(ry, [rBench, rDummy]);
    if (r) gammas.push(r.coefficients[1]);
  }
  const { lower, upper, ciExcludesZero } = percentileCi(gammas, ci);
  return {
    gamma: reg.coefficients[1],
    gammaBootstrapLower: lower,
    gammaBootstrapUpper: upper,
    ciExcludesZero,
    marketBeta: reg.coefficients[0],
    rSquared: reg.rSquared,
    n: reg.n,
  };
}

/**
 * Time-varying-beta / structural-break check (concept: Chow 1960; Bai &
 * Perron 1998) — does the market model's beta differ between the first and
 * second half of the real non-event sample? Implemented via bootstrap on
 * the beta difference rather than a parametric F-test, consistent with
 * this app's existing bootstrap-first convention (stats-tests.ts).
 */
function betaDriftCheck(dateKeys: string[], benchmark: number[], target: number[], nBoot = 3000, ci = 0.95): BetaDriftResult | null {
  const n = dateKeys.length;
  if (n < 40) return null; // need a real sample on both sides of the split
  const splitIdx = Math.floor(n / 2);
  const earlyBench = benchmark.slice(0, splitIdx);
  const earlyTarget = target.slice(0, splitIdx);
  const lateBench = benchmark.slice(splitIdx);
  const lateTarget = target.slice(splitIdx);

  const earlyReg = linearRegression(earlyBench, earlyTarget);
  const lateReg = linearRegression(lateBench, lateTarget);
  if (!earlyReg || !lateReg) return null;

  const diffs: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const rEarlyX: number[] = [];
    const rEarlyY: number[] = [];
    for (let i = 0; i < earlyBench.length; i++) {
      const idx = Math.floor(Math.random() * earlyBench.length);
      rEarlyX.push(earlyBench[idx]);
      rEarlyY.push(earlyTarget[idx]);
    }
    const rLateX: number[] = [];
    const rLateY: number[] = [];
    for (let i = 0; i < lateBench.length; i++) {
      const idx = Math.floor(Math.random() * lateBench.length);
      rLateX.push(lateBench[idx]);
      rLateY.push(lateTarget[idx]);
    }
    const e = linearRegression(rEarlyX, rEarlyY);
    const l = linearRegression(rLateX, rLateY);
    if (e && l) diffs.push(l.slope - e.slope);
  }
  const { lower, upper, ciExcludesZero } = percentileCi(diffs, ci);

  return {
    splitDateKey: dateKeys[splitIdx],
    earlyBeta: earlyReg.slope,
    earlyN: earlyReg.n,
    lateBeta: lateReg.slope,
    lateN: lateReg.n,
    betaDiff: lateReg.slope - earlyReg.slope,
    diffBootstrapLower: lower,
    diffBootstrapUpper: upper,
    ciExcludesZero,
  };
}

/** dateKey -> single-day % return, built from a dateKey-sorted DailyBar[] (same alignment discipline portfolio-analytics.ts uses for multi-symbol return series — never assume two symbols' bars line up by array index). */
function returnsByDate(bars: DailyBar[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < bars.length; i++) {
    const prior = bars[i - 1].close;
    if (prior > 0) map.set(bars[i].dateKey, ((bars[i].close - prior) / prior) * 100);
  }
  return map;
}

/**
 * Event study: does the real dollar size of a Treasury long-term-bond
 * buyback operation predict the operation-day and next-day % move in a
 * gold ETF? All sides are real, sourced data — Treasury's own Fiscal Data
 * API for operation dates/accepted amounts, this app's existing market-data
 * pipeline for both GLD's and the market-model benchmark's daily bars. No
 * fabricated observations; operations with no real matching price data are
 * dropped, not padded.
 *
 * Reports three real, cross-checking methods: (1) a raw (naive) % move,
 * (2) a two-step market-model abnormal return (MacKinlay 1997), and (3) the
 * real single-pass dummy-variable event regression (Karafiath 1988; Binder
 * 1985/1998) — plus a time-varying-beta/structural-break check on the
 * market model itself.
 */
export async function runBuybackAnomalyStudy(ticker = "GLD"): Promise<BuybackAnomalyResult> {
  const [operations, targetBars, benchmarkBars] = await Promise.all([
    fetchBuybackOperations(LONG_TERM_MATURITY_BUCKET),
    getDailyBars(ticker, LOOKBACK_DAYS),
    getDailyBars(MARKET_MODEL_BENCHMARK, LOOKBACK_DAYS),
  ]);

  const dateIndex = new Map(targetBars.map((b, i) => [b.dateKey, i]));
  const benchmarkReturns = returnsByDate(benchmarkBars);

  interface RawEvent {
    operationDate: string;
    amountAcceptedUsdBillions: number;
    day0DateKey: string;
    day1DateKey: string;
    day0ReturnPct: number;
    day1ReturnPct: number;
  }

  const rawEvents: RawEvent[] = [];
  let skippedNoBarData = 0;

  for (const op of operations) {
    const i = dateIndex.get(op.operationDate);
    if (i === undefined || i === 0 || i >= targetBars.length - 1) {
      skippedNoBarData++;
      continue;
    }
    const priorClose = targetBars[i - 1].close;
    const dayClose = targetBars[i].close;
    const nextClose = targetBars[i + 1].close;
    if (priorClose <= 0 || dayClose <= 0) {
      skippedNoBarData++;
      continue;
    }
    rawEvents.push({
      operationDate: op.operationDate,
      amountAcceptedUsdBillions: op.totalParAmtAccepted / 1_000_000_000,
      day0DateKey: targetBars[i].dateKey,
      day1DateKey: targetBars[i + 1].dateKey,
      day0ReturnPct: ((dayClose - priorClose) / priorClose) * 100,
      day1ReturnPct: ((nextClose - dayClose) / dayClose) * 100,
    });
  }

  const eventDateKeys = new Set(rawEvents.flatMap((e) => [e.day0DateKey, e.day1DateKey]));
  const targetReturns = returnsByDate(targetBars);

  // Every real trading day both series have a return for, in chronological
  // order — the shared base for the market model, the dummy-variable
  // regression, and the beta-drift split.
  const alignedDateKeys: string[] = [];
  const alignedBenchmark: number[] = [];
  const alignedTarget: number[] = [];
  for (const bar of benchmarkBars) {
    const bReturn = benchmarkReturns.get(bar.dateKey);
    const tReturn = targetReturns.get(bar.dateKey);
    if (bReturn === undefined || tReturn === undefined) continue;
    alignedDateKeys.push(bar.dateKey);
    alignedBenchmark.push(bReturn);
    alignedTarget.push(tReturn);
  }

  // Two-step market model, fit on non-event days only (excluding event days
  // is what keeps it from being circular). Pooled over the full lookback
  // window rather than a separate pre-event-only window per event —
  // disclosed as a simplification below.
  const nonEventIdx = alignedDateKeys.map((d, i) => (eventDateKeys.has(d) ? -1 : i)).filter((i) => i >= 0);
  const modelX = nonEventIdx.map((i) => alignedBenchmark[i]);
  const modelY = nonEventIdx.map((i) => alignedTarget[i]);
  const marketModelReg = linearRegression(modelX, modelY);
  const marketModel: MarketModelFit | null = marketModelReg
    ? { benchmarkTicker: MARKET_MODEL_BENCHMARK, beta: marketModelReg.slope, alpha: marketModelReg.intercept, rSquared: marketModelReg.rSquared, n: marketModelReg.n }
    : null;

  const events: BuybackEventRow[] = rawEvents.map((e) => {
    const bench0 = benchmarkReturns.get(e.day0DateKey);
    const bench1 = benchmarkReturns.get(e.day1DateKey);
    const day0AbnormalReturnPct =
      marketModel && bench0 !== undefined ? e.day0ReturnPct - (marketModel.alpha + marketModel.beta * bench0) : null;
    const day1AbnormalReturnPct =
      marketModel && bench1 !== undefined ? e.day1ReturnPct - (marketModel.alpha + marketModel.beta * bench1) : null;
    return {
      operationDate: e.operationDate,
      amountAcceptedUsdBillions: e.amountAcceptedUsdBillions,
      day0ReturnPct: e.day0ReturnPct,
      day1ReturnPct: e.day1ReturnPct,
      day0AbnormalReturnPct,
      day1AbnormalReturnPct,
    };
  });

  const x = events.map((e) => e.amountAcceptedUsdBillions);
  const day0Regression = buildRegression(x, events.map((e) => e.day0ReturnPct));
  const day1Regression = buildRegression(x, events.map((e) => e.day1ReturnPct));
  const abnormalEvents = events.filter((e) => e.day0AbnormalReturnPct !== null && e.day1AbnormalReturnPct !== null);
  const day0AbnormalRegression = buildRegression(
    abnormalEvents.map((e) => e.amountAcceptedUsdBillions),
    abnormalEvents.map((e) => e.day0AbnormalReturnPct as number)
  );
  const day1AbnormalRegression = buildRegression(
    abnormalEvents.map((e) => e.amountAcceptedUsdBillions),
    abnormalEvents.map((e) => e.day1AbnormalReturnPct as number)
  );

  // Single-pass dummy-variable regression — D_t = amount accepted on that
  // event's day (0/1) date, 0 on every other real trading day.
  const day0DateAmount = new Map(rawEvents.map((e) => [e.day0DateKey, e.amountAcceptedUsdBillions]));
  const day1DateAmount = new Map(rawEvents.map((e) => [e.day1DateKey, e.amountAcceptedUsdBillions]));
  const day0Dummy = alignedDateKeys.map((d) => day0DateAmount.get(d) ?? 0);
  const day1Dummy = alignedDateKeys.map((d) => day1DateAmount.get(d) ?? 0);
  const day0DummyRegression = dummyVariableRegression(alignedTarget, alignedBenchmark, day0Dummy);
  const day1DummyRegression = dummyVariableRegression(alignedTarget, alignedBenchmark, day1Dummy);

  // Time-varying-beta check, on the same non-event sample the two-step
  // market model was fit on (chronological order preserved).
  const nonEventDateKeys = nonEventIdx.map((i) => alignedDateKeys[i]);
  const betaDrift = betaDriftCheck(nonEventDateKeys, modelX, modelY);

  const nearCapCount = events.filter((e) => e.amountAcceptedUsdBillions >= 1.9).length;

  const dataLimitations: string[] = [
    `Abnormal returns use a market model (${ticker} regressed on ${MARKET_MODEL_BENCHMARK}, a real liquid dollar-strength ETF — the actual ICE Dollar Index isn't available through any provider this app has) fit once, pooled, over the full lookback window with every event day excluded from the fit. This is a disclosed simplification of MacKinlay's standard event-study method, which normally fits a separate pre-event-only estimation window per event — with buybacks landing roughly monthly over just ~2.4 years of real history, per-event pre-only windows would leave too few observations to fit a reliable beta for the earliest events.`,
    `The dummy-variable regression (Karafiath 1988; Binder 1985/1998) is the real standard single-pass form of this same test — γ should land close to the two-step abnormal-return slope above; a large divergence between them is itself worth noticing, not just the individual numbers.`,
    `The beta-drift check splits the non-event sample chronologically in half and bootstraps the difference in market-model beta between the two halves — a real check for whether ${ticker}'s relationship to the dollar has structurally shifted, not a parametric Chow-test p-value.`,
    `Treasury's own stated purpose for these operations (its "operation_type" field) reads "Liquidity Support" on nearly every real record in this sample — not "yield suppression." This test measures gold's empirical price reaction only; it makes no claim about Treasury's actual motive.`,
    `The accepted amount is capped near $2B on ${nearCapCount} of ${events.length} operations in this sample — most operations hit the same ceiling, so most of this regression's usable variation in buyback size comes from the handful of undersubscribed operations, not a wide natural range.`,
    `Every regression here is bivariate (plus the one dummy term) — none control for real yields, other macro releases, or geopolitical events that might coincide with any given operation date.`,
    `n=${events.length} real matched events (long-term "${LONG_TERM_MATURITY_BUCKET}" bucket only, since 2024) — a real but modest sample; treat any single-digit-observation result as directional, not conclusive.`,
  ];
  if (skippedNoBarData > 0) {
    dataLimitations.push(`${skippedNoBarData} operation(s) skipped — no matching ${ticker} trading-day bar available (edge of history or data gap).`);
  }

  return {
    ticker,
    maturityBucket: LONG_TERM_MATURITY_BUCKET,
    events,
    marketModel,
    day0Regression,
    day1Regression,
    day0AbnormalRegression,
    day1AbnormalRegression,
    day0DummyRegression,
    day1DummyRegression,
    betaDrift,
    dataLimitations,
  };
}
