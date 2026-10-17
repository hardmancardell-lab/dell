/**
 * Exact long-only portfolio optimisation (no short sales, weights sum to 1), pure and deterministic.
 *
 *  - minimumVariance(cov): the long-only minimum-variance portfolio.
 *  - tangencyPortfolio(cov, mu, rf): the long-only maximum-Sharpe portfolio, or null when no asset beats the risk-free rate.
 *
 * Method: accelerated projected gradient (FISTA) on the simplex finds the active set, then the equality-constrained KKT
 * system on that support is solved exactly (Gaussian elimination) and accepted when it is feasible and satisfies the
 * optimality conditions of the off-support assets. The result matches the closed-form 2- and 3-asset solutions to about
 * 1e-9 (see scripts/portfolio-risk.test.mts). Replaces picking the best of 2,000 random portfolios, which missed the
 * corner solutions long-only optima usually are (5-16% of Sharpe at 5-12 assets).
 */

/** Euclidean projection of v onto the probability simplex {w >= 0, sum w = 1} (Duchi et al., 2008). */
export function projectSimplex(v: number[]): number[] {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let rho = -1;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    css += u[i];
    const t = (css - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i;
      theta = t;
    }
  }
  if (rho < 0) return v.map(() => 1 / n);
  return v.map((x) => Math.max(x - theta, 0));
}

function matVec(m: number[][], x: number[]): number[] {
  return m.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

/** Largest eigenvalue of a symmetric PSD matrix by power iteration (an upper-bound-ish estimate with a safety factor). */
function largestEigenvalue(m: number[][]): number {
  const n = m.length;
  let x = Array.from({ length: n }, (_, i) => 1 + 0.01 * i);
  let lambda = 0;
  for (let k = 0; k < 100; k++) {
    const y = matVec(m, x);
    const norm = Math.sqrt(dot(y, y));
    if (norm === 0) return 0;
    x = y.map((v) => v / norm);
    lambda = norm;
  }
  return lambda * 1.05;
}

/** Solves A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Variance of weights w under covariance cov. */
export function portfolioVariance(w: number[], cov: number[][]): number {
  return Math.max(dot(w, matVec(cov, w)), 0);
}

/**
 * Minimises 0.5 * gamma * w'Cw - mu'w over the long-only simplex. gamma > 0. Deterministic.
 */
export function solveLongOnlyQP(cov: number[][], mu: number[], gamma: number): number[] {
  const n = cov.length;
  if (n === 1) return [1];
  const L = Math.max(gamma * largestEigenvalue(cov), 1e-12);
  let w = Array.from({ length: n }, () => 1 / n);
  let z = [...w];
  let tk = 1;
  for (let it = 0; it < 20000; it++) {
    const grad = matVec(cov, z).map((v, i) => gamma * v - mu[i]);
    const wNext = projectSimplex(z.map((v, i) => v - grad[i] / L));
    const tNext = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    const zNext = wNext.map((v, i) => v + ((tk - 1) / tNext) * (v - w[i]));
    let diff = 0;
    for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(wNext[i] - w[i]));
    w = wNext;
    z = zNext;
    tk = tNext;
    if (diff < 1e-14) break;
  }
  return polishQP(cov, mu, gamma, w);
}

/** Replaces the iterative solution by the exact KKT solution on its support when that is feasible and optimal. */
function polishQP(cov: number[][], mu: number[], gamma: number, w: number[]): number[] {
  const n = w.length;
  const support = w.map((v, i) => (v > 1e-9 ? i : -1)).filter((i) => i >= 0);
  if (support.length === 0) return w;
  const k = support.length;
  // [gamma*C_SS 1; 1' 0] [w_S; nu] = [mu_S; 1]
  const A = Array.from({ length: k + 1 }, () => new Array<number>(k + 1).fill(0));
  const b = new Array<number>(k + 1).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) A[i][j] = gamma * cov[support[i]][support[j]];
    A[i][k] = 1;
    A[k][i] = 1;
    b[i] = mu[support[i]];
  }
  b[k] = 1;
  const sol = solveLinear(A, b);
  if (!sol) return w;
  const wS = sol.slice(0, k);
  const nu = sol[k];
  if (wS.some((v) => !(v >= -1e-12))) return w;
  const full = new Array<number>(n).fill(0);
  support.forEach((idx, i) => (full[idx] = Math.max(wS[i], 0)));
  const cw = matVec(cov, full);
  for (let j = 0; j < n; j++) {
    if (full[j] > 0) continue;
    if (gamma * cw[j] - mu[j] + nu < -1e-9) return w; // an off-support asset would still improve the objective
  }
  const total = full.reduce((s, v) => s + v, 0);
  return total > 0 ? full.map((v) => v / total) : w;
}

/** Long-only minimum-variance weights. */
export function minimumVariance(cov: number[][]): number[] {
  return solveLongOnlyQP(cov, cov.map(() => 0), 1);
}

export interface Tangency {
  weights: number[];
  expectedReturn: number;
  volatility: number;
  sharpe: number;
}

/**
 * Long-only maximum-Sharpe (tangency) portfolio for annual expected returns `mu`, covariance `cov` and risk-free rate `rf`.
 * Returns null when no asset has an expected return above rf (a "maximum Sharpe" would then be meaningless).
 */
export function tangencyPortfolio(cov: number[][], mu: number[], rf: number): Tangency | null {
  const n = cov.length;
  const excess = mu.map((m) => m - rf);
  if (!excess.some((e) => e > 1e-12)) return null;
  const evaluate = (w: number[]): Tangency => {
    const expectedReturn = dot(w, mu);
    const volatility = Math.sqrt(portfolioVariance(w, cov));
    return { weights: w, expectedReturn, volatility, sharpe: volatility > 0 ? (expectedReturn - rf) / volatility : 0 };
  };
  if (n === 1) return evaluate([1]);

  // Sharpe along the mean-variance path w(gamma) rises, peaks and falls as gamma grows, but it is FLAT where the solution is
  // a single corner asset, which defeats a plain golden-section search. So: a coarse grid over log10(gamma) finds the right
  // region, then golden-section refines inside the bracket around the best grid point (where the curve is unimodal).
  const sharpeAt = (logGamma: number) => evaluate(solveLongOnlyQP(cov, excess, Math.pow(10, logGamma)));
  const LOG_LO = -3;
  const LOG_HI = 5;
  const STEPS = 32;
  const step = (LOG_HI - LOG_LO) / STEPS;
  let bestIdx = 0;
  let bestEval = sharpeAt(LOG_LO);
  for (let i = 1; i <= STEPS; i++) {
    const e = sharpeAt(LOG_LO + i * step);
    if (e.sharpe > bestEval.sharpe + 1e-13) {
      bestEval = e;
      bestIdx = i;
    }
  }
  let lo = LOG_LO + Math.max(bestIdx - 1, 0) * step;
  let hi = LOG_LO + Math.min(bestIdx + 1, STEPS) * step;
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = sharpeAt(x1);
  let f2 = sharpeAt(x2);
  for (let i = 0; i < 30; i++) {
    if (f1.sharpe < f2.sharpe) {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = sharpeAt(x2);
    } else {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = sharpeAt(x1);
    }
  }
  let best = f1.sharpe >= f2.sharpe ? f1 : f2;
  if (bestEval.sharpe > best.sharpe) best = bestEval;

  // Exact polish: on the support S the tangency is C_SS y = excess_S, w = y / sum(y).
  const support = best.weights.map((v, i) => (v > 1e-7 ? i : -1)).filter((i) => i >= 0);
  const k = support.length;
  const CS = support.map((i) => support.map((j) => cov[i][j]));
  const y = solveLinear(CS, support.map((i) => excess[i]));
  if (y) {
    const s = y.reduce((a, v) => a + v, 0);
    if (s > 0 && y.every((v) => v >= -1e-12)) {
      const w = new Array<number>(n).fill(0);
      support.forEach((idx, i) => (w[idx] = Math.max(y[i], 0) / s));
      const cand = evaluate(w);
      const lambda = cand.volatility > 0 ? (dot(w, excess)) / (cand.volatility * cand.volatility) : 0;
      const cw = matVec(cov, w);
      let ok = true;
      for (let j = 0; j < n; j++) if (w[j] === 0 && lambda * cw[j] - excess[j] < -1e-9) ok = false;
      if (ok && cand.sharpe >= best.sharpe - 1e-12) return cand;
    }
  }
  void k;
  return best;
}
