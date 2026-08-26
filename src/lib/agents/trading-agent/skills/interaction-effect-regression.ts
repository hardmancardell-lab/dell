import { fetchReturnsFor } from "./portfolio-analytics";
import { multipleLinearRegression } from "../stats";

const MIN_OVERLAPPING_DAYS = 30;

export interface InteractionEffectResult {
  targetSymbol: string;
  predictor1Symbol: string;
  predictor2Symbol: string;
  sampleSize: number;
  beta1: number | null; // predictor1's own linear effect on the target, holding the interaction term fixed
  beta2: number | null; // predictor2's own linear effect
  interactionBeta: number | null; // coefficient on (predictor1 x predictor2) — the actual interaction effect
  interactionBootstrapLower: number | null;
  interactionBootstrapUpper: number | null;
  interactionSignificant: boolean; // bootstrap 95% CI excludes zero
  rSquared: number | null;
  error: string | null;
}

export interface InteractionEffectMatrixResult {
  symbols: string[];
  results: InteractionEffectResult[];
  dataLimitations: string[];
}

/** Same percentile-CI bootstrap construction used elsewhere (stats-tests.ts's bootstrapCi, buyback-gld-event-study.ts's dummy-variable regression) — resamples (target, x1, x2) rows jointly and refits, rather than bootstrapping a single array. */
function bootstrapInteractionCi(target: number[], x1: number[], x2: number[], nBoot = 5000, ci = 0.95): { lower: number | null; upper: number | null; ciExcludesZero: boolean } {
  const n = target.length;
  if (n < 4) return { lower: null, upper: null, ciExcludesZero: false };
  const betas: number[] = [];
  for (let b = 0; b < nBoot; b++) {
    const ry: number[] = [];
    const rx1: number[] = [];
    const rx2: number[] = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * n);
      ry.push(target[idx]);
      rx1.push(x1[idx]);
      rx2.push(x2[idx]);
    }
    const rInteraction = rx1.map((v, i) => v * rx2[i]);
    const reg = multipleLinearRegression(ry, [rx1, rx2, rInteraction]);
    if (reg) betas.push(reg.coefficients[2]);
  }
  if (betas.length === 0) return { lower: null, upper: null, ciExcludesZero: false };
  betas.sort((a, b) => a - b);
  const loIdx = Math.floor(((1 - ci) / 2) * betas.length);
  const hiIdx = Math.min(Math.floor(((1 + ci) / 2) * betas.length), betas.length - 1);
  const lower = betas[loIdx];
  const upper = betas[hiIdx];
  return { lower, upper, ciExcludesZero: lower > 0 || upper < 0 };
}

/**
 * Tests whether two holdings have a real INTERACTION effect on a third
 * holding's return — a genuinely different question from correlation or a
 * simple pairwise regression. Fits:
 *   target_t = β0 + β1·x1_t + β2·x2_t + β3·(x1_t × x2_t) + ε_t
 * via the same general multiple-regression primitive built for the
 * Treasury buyback dummy-variable regression (stats.ts's
 * multipleLinearRegression). β3 (the interaction term) is what's new here:
 * it answers "does the combined/joint movement of x1 and x2 move the
 * target by more or less than their individual effects alone would
 * predict?" — β1/β2 are each holding's own effect net of the interaction.
 */
export async function getInteractionEffect(targetSymbol: string, predictor1Symbol: string, predictor2Symbol: string): Promise<InteractionEffectResult> {
  const target = targetSymbol.trim().toUpperCase();
  const p1 = predictor1Symbol.trim().toUpperCase();
  const p2 = predictor2Symbol.trim().toUpperCase();

  const [targetReturns, p1Returns, p2Returns] = await Promise.all([
    fetchReturnsFor(target),
    fetchReturnsFor(p1),
    fetchReturnsFor(p2),
  ]);
  if (targetReturns.error) return emptyResult(target, p1, p2, `Could not fetch ${target}: ${targetReturns.error}`);
  if (p1Returns.error) return emptyResult(target, p1, p2, `Could not fetch ${p1}: ${p1Returns.error}`);
  if (p2Returns.error) return emptyResult(target, p1, p2, `Could not fetch ${p2}: ${p2Returns.error}`);

  const commonDates = [...targetReturns.returnsByDate.keys()].filter(
    (d) => p1Returns.returnsByDate.has(d) && p2Returns.returnsByDate.has(d)
  );
  if (commonDates.length < MIN_OVERLAPPING_DAYS) {
    return emptyResult(target, p1, p2, `Only ${commonDates.length} overlapping trading day(s) across all three symbols — below the ${MIN_OVERLAPPING_DAYS}-day reliability floor.`);
  }

  const y = commonDates.map((d) => targetReturns.returnsByDate.get(d) as number);
  const x1 = commonDates.map((d) => p1Returns.returnsByDate.get(d) as number);
  const x2 = commonDates.map((d) => p2Returns.returnsByDate.get(d) as number);
  const interaction = x1.map((v, i) => v * x2[i]);

  const reg = multipleLinearRegression(y, [x1, x2, interaction]);
  if (!reg) return emptyResult(target, p1, p2, "Regression could not be fit (insufficient variation in the data).");

  const { lower, upper, ciExcludesZero } = bootstrapInteractionCi(y, x1, x2);

  return {
    targetSymbol: target,
    predictor1Symbol: p1,
    predictor2Symbol: p2,
    sampleSize: reg.n,
    beta1: reg.coefficients[0],
    beta2: reg.coefficients[1],
    interactionBeta: reg.coefficients[2],
    interactionBootstrapLower: lower,
    interactionBootstrapUpper: upper,
    interactionSignificant: ciExcludesZero,
    rSquared: reg.rSquared,
    error: null,
  };
}

function emptyResult(target: string, p1: string, p2: string, error: string): InteractionEffectResult {
  return {
    targetSymbol: target,
    predictor1Symbol: p1,
    predictor2Symbol: p2,
    sampleSize: 0,
    beta1: null,
    beta2: null,
    interactionBeta: null,
    interactionBootstrapLower: null,
    interactionBootstrapUpper: null,
    interactionSignificant: false,
    rSquared: null,
    error,
  };
}

/**
 * Runs the interaction-effect test for every (target, pair-of-others)
 * combination across a small symbol set — for n symbols, each one takes a
 * turn as the target against every unordered pair of the rest
 * (C(n-1, 2) combinations per target).
 */
export async function getInteractionEffectMatrix(symbols: string[]): Promise<InteractionEffectMatrixResult> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (unique.length < 3) throw new Error("At least 3 symbols are required (one target + a pair of predictors).");

  const jobs: { target: string; p1: string; p2: string }[] = [];
  for (const target of unique) {
    const others = unique.filter((s) => s !== target);
    for (let i = 0; i < others.length; i++) {
      for (let j = i + 1; j < others.length; j++) {
        jobs.push({ target, p1: others[i], p2: others[j] });
      }
    }
  }

  const results = await Promise.all(jobs.map((j) => getInteractionEffect(j.target, j.p1, j.p2)));

  return {
    symbols: unique,
    results,
    dataLimitations: [
      "Interaction effect (β3 on x1×x2) is estimated from ~1 year of daily returns via OLS with a bootstrapped confidence interval — a real statistical test, not a causal claim. A significant interaction means the two predictors' joint movement explains the target's return beyond what each explains alone over this specific historical window; it does not by itself explain a economic mechanism.",
      "Every symbol takes a turn as the target against every pair of the others — with 4 symbols that's 4 targets x 3 predictor-pairs = 12 regressions, each independently tested.",
    ],
  };
}
