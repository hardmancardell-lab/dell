// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/portfolio-risk.test.mts
// Portfolio and risk fixes (audit 04-portfolio-risk): exact long-only optimiser vs closed forms, deterministic frontier,
// asset cap, short-history symbol named, realized P&L multipliers and input checks, long-term test off-by-one,
// annualised-return guard. Fake fetch only.
import { setFakeEnv, install, json, makeT } from "./fixtures/fake-fetch.mts";
import { minimumVariance, tangencyPortfolio, projectSimplex, portfolioVariance } from "../src/lib/agents/trading-agent/skills/portfolio-optimizer.ts";
import { runPortfolioAnalytics, MAX_ANALYTICS_ASSETS } from "../src/lib/agents/trading-agent/skills/portfolio-analytics.ts";
import { computeRealizedPnl, validateSaleInputs, remainingQuantity } from "../src/lib/agents/trading-agent/skills/realized-pnl.ts";
import { isLongTermHolding, computeTaxLotImpact } from "../src/lib/agents/trading-agent/skills/tax-lot-impact.ts";
import { computeValuationFigures } from "../src/lib/agents/trading-agent/skills/portfolio-valuation.ts";
import { maxDrawdownFromReturns } from "../src/lib/agents/trading-agent/stats.ts";
import { mulberry32 } from "../src/lib/agents/trading-agent/skills/stats-tests.ts";

const { t, summary } = makeT();
setFakeEnv();
console.warn = () => {};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- simplex projection
{
  const p = projectSimplex([0.5, 0.5, 0.5]);
  t("projectSimplex: sums to 1, non-negative", near(p.reduce((s, v) => s + v, 0), 1, 1e-12) && p.every((v) => v >= 0));
  const q = projectSimplex([3, -1, 0]);
  t("projectSimplex: corner case [3,-1,0] -> [1,0,0]", near(q[0], 1, 1e-12) && q[1] === 0 && q[2] === 0);
}

// ---------------------------------------------------------------- 2 assets: closed forms
{
  const s1 = 0.2, s2 = 0.1, rho = 0.3;
  const cov = [[s1 * s1, rho * s1 * s2], [rho * s1 * s2, s2 * s2]];
  const w1 = (s2 * s2 - rho * s1 * s2) / (s1 * s1 + s2 * s2 - 2 * rho * s1 * s2);
  const mv = minimumVariance(cov);
  t(`2-asset minimum variance matches the closed form (w1 ${mv[0].toFixed(8)} vs ${w1.toFixed(8)})`, near(mv[0], w1, 1e-7) && near(mv[1], 1 - w1, 1e-7));
  const mu = [0.1, 0.06];
  const rf = 0.042;
  // tangency closed form: w1 = (e1*v2 - e2*c) / (e1*v2 + e2*v1 - (e1+e2)*c)
  const e1 = mu[0] - rf, e2 = mu[1] - rf, v1 = cov[0][0], v2 = cov[1][1], c = cov[0][1];
  const tw1 = (e1 * v2 - e2 * c) / (e1 * v2 + e2 * v1 - (e1 + e2) * c);
  const tg = tangencyPortfolio(cov, mu, rf);
  t(`2-asset tangency matches the closed form (w1 ${tg?.weights[0].toFixed(8)} vs ${tw1.toFixed(8)})`, tg !== null && near(tg.weights[0], tw1, 1e-6));
}

// ---------------------------------------------------------------- 3 assets: closed forms (interior solutions)
function inv3(m: number[][]) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
{
  const vol = [0.2, 0.15, 0.1];
  const R = [[1, 0.2, 0.1], [0.2, 1, 0.15], [0.1, 0.15, 1]];
  const cov = R.map((row, i) => row.map((r, j) => r * vol[i] * vol[j]));
  const Ci = inv3(cov);
  const ones = [1, 1, 1];
  const Cinv1 = Ci.map((row) => row.reduce((s, v) => s + v, 0));
  const s1 = Cinv1.reduce((s, v) => s + v, 0);
  const wmv = Cinv1.map((v) => v / s1);
  const mv = minimumVariance(cov);
  t("3-asset minimum variance matches the closed form", wmv.every((v) => v > 0) && mv.every((v, i) => near(v, wmv[i], 1e-7)), JSON.stringify({ mv, wmv }));
  const mu = [0.12, 0.09, 0.07];
  const rf = 0.03;
  const ex = mu.map((m) => m - rf);
  const y = Ci.map((row) => row.reduce((s, v, j) => s + v * ex[j], 0));
  const sy = y.reduce((s, v) => s + v, 0);
  const wt = y.map((v) => v / sy);
  const tg = tangencyPortfolio(cov, mu, rf);
  t("3-asset tangency matches the closed form", wt.every((v) => v > 0) && tg !== null && tg.weights.every((v, i) => near(v, wt[i], 1e-6)), JSON.stringify({ tg: tg?.weights, wt }));
}

// ---------------------------------------------------------------- corner solution and degenerate cases
{
  // An asset with lower return AND higher volatility than a perfectly correlated better one gets weight 0.
  const cov = [[0.04, 0.06 * 0.2 * 0.3 / 1], [0.06 * 0.2 * 0.3 / 1, 0.09]];
  const tg = tangencyPortfolio(cov, [0.12, 0.05], 0.03);
  t("corner solution: a dominated asset gets exactly zero weight", tg !== null && tg.weights[1] === 0 && near(tg.weights[0], 1, 1e-12));
  t("no asset above the risk-free rate: tangency is null (no maximum-Sharpe portfolio)", tangencyPortfolio([[0.04, 0], [0, 0.09]], [0.02, 0.03], 0.04) === null);
  t("one asset: weight 1", minimumVariance([[0.04]])[0] === 1);
}

// ---------------------------------------------------------------- property check: weights valid, optimum at least as good as 2000 random portfolios
{
  const rand = mulberry32(8);
  let allOk = true;
  let beats = true;
  for (let trial = 0; trial < 12; trial++) {
    const n = 2 + (trial % 6);
    const A = Array.from({ length: n }, () => Array.from({ length: n + 3 }, () => rand() - 0.5));
    const cov = A.map((r1) => A.map((r2) => (r1.reduce((s, v, k) => s + v * r2[k], 0) * 0.5) / (n + 3) + 0.0));
    for (let i = 0; i < n; i++) cov[i][i] += 0.01;
    const mu = Array.from({ length: n }, () => 0.02 + rand() * 0.12);
    const rf = 0.03;
    const tg = tangencyPortfolio(cov, mu, rf);
    const mv = minimumVariance(cov);
    if (!tg) continue;
    const okW = (w) => w.every((v) => v >= -1e-12) && near(w.reduce((s, v) => s + v, 0), 1, 1e-9);
    if (!okW(tg.weights) || !okW(mv)) allOk = false;
    let bestSharpe = -Infinity, bestVar = Infinity;
    for (let k = 0; k < 2000; k++) {
      const d = Array.from({ length: n }, () => -Math.log(Math.max(rand(), 1e-12)));
      const tot = d.reduce((s, v) => s + v, 0);
      const w = d.map((v) => v / tot);
      const vol = Math.sqrt(portfolioVariance(w, cov));
      bestSharpe = Math.max(bestSharpe, (w.reduce((s, v, i) => s + v * mu[i], 0) - rf) / vol);
      bestVar = Math.min(bestVar, vol * vol);
    }
    if (tg.sharpe < bestSharpe - 1e-9 || portfolioVariance(mv, cov) > bestVar + 1e-12) beats = false;
  }
  t("12 random problems: weights are long-only and sum to 1", allOk);
  t("12 random problems: exact optimum is never worse than the best of 2,000 random portfolios", beats);
}

// ---------------------------------------------------------------- analytics end to end (fake provider)
function weekdays(n: number) {
  const out: number[] = [];
  const d = new Date(Date.now() - 86400000);
  d.setUTCHours(5, 0, 0, 0);
  let ms = d.getTime();
  while (out.length < n) {
    const w = new Date(ms).getUTCDay();
    if (w !== 0 && w !== 6) out.push(ms);
    ms -= 86400000;
  }
  return out.reverse();
}
{
  const rand = mulberry32(77);
  const randn = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const ts = weekdays(270);
  const cache = new Map<string, any[]>();
  const bars = (sym: string, len: number) => {
    const key = sym + len;
    if (!cache.has(key)) {
      let p = 100;
      cache.set(key, ts.slice(ts.length - len).map((t0) => {
        const o = p;
        const c = o * (1 + 0.0004 + 0.011 * randn());
        p = c;
        return { t: new Date(t0).toISOString(), o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: 1e6 };
      }));
    }
    return cache.get(key);
  };
  const SHORT = new Set(["NEWIPO"]);
  const handler = (url: string) => {
    const u = new URL(url);
    if (u.hostname === "data.alpaca.markets") {
      const parts = u.pathname.split("/");
      const sym = decodeURIComponent(parts[3]);
      if (parts[4] === "snapshot") return json({ latestTrade: { p: 100, t: new Date().toISOString() }, dailyBar: { v: 1 } });
      return json({ bars: bars(sym, SHORT.has(sym) ? 40 : 260), next_page_token: null });
    }
    return json({}, 404); // FRED / FMP unavailable: fallback rate, no sector data
  };
  const holding = (symbol: string, shares = 10) => ({ id: symbol, symbol, assetClass: "equity", shares, costBasisPerShare: 100, acquiredDate: "2025-01-02" });

  install(handler);
  const r1 = await runPortfolioAnalytics([holding("AAA"), holding("BBB"), holding("CCC")]);
  const r2 = await runPortfolioAnalytics([holding("AAA"), holding("BBB"), holding("CCC")]);
  t("analytics: identical inputs give an identical frontier (seeded cloud, exact optima)", JSON.stringify(r1.frontier) === JSON.stringify(r2.frontier));
  const f = r1.frontier;
  t("analytics: min-volatility and max-Sharpe weights are long-only and sum to 1", [f.minVolatility, f.maxSharpe].filter(Boolean).every((p) => { const w = Object.values(p.weights); return w.every((v) => v >= -1e-12) && near(w.reduce((s, v) => s + v, 0), 1, 1e-9); }));
  t("analytics: no cloud point has lower volatility than the exact minimum-variance portfolio", f.simulatedPortfolios.every((p) => p.volatility >= f.minVolatility.volatility - 1e-9));
  t("analytics: cloud points carry no per-symbol weights (payload cut)", f.simulatedPortfolios.every((p) => Object.keys(p.weights).length === 0));
  t("analytics: limitations say the optima are exact and in-sample", r1.dataLimitations.some((x) => /exact long-only optimisation/.test(x) && /in-sample/.test(x)));
  t("analytics: no limitation still claims the frontier is a Monte Carlo approximation", !r1.dataLimitations.some((x) => /Monte Carlo approximation/.test(x)));

  const rs = await runPortfolioAnalytics([holding("AAA"), holding("BBB"), holding("CCC"), holding("NEWIPO")]);
  t("short history: the short symbol is named in a warning, not silently shrinking the set", rs.dataLimitations.some((x) => /NEWIPO/.test(x) && /Short price history/.test(x)));
  t("short history: the other symbols keep their full overlap (about 259 days, not 39)", rs.dataLimitations.some((x) => /use 25\d common trading days across 3 symbol/.test(x)), rs.dataLimitations.filter((x) => /common trading days/.test(x)).join("|"));
  t("short history: the short symbol keeps its own beta row but is not in the correlation matrix", !rs.correlationMatrix.symbols.includes("NEWIPO") && rs.betas.some((b) => b.symbol === "NEWIPO"));

  const many = Array.from({ length: MAX_ANALYTICS_ASSETS + 5 }, (_, i) => holding("S" + String(i).padStart(2, "0")));
  const big = await runPortfolioAnalytics(many);
  t(`asset cap: ${MAX_ANALYTICS_ASSETS + 5} symbols are cut to ${MAX_ANALYTICS_ASSETS} with a message naming the rest`, big.betas.length === MAX_ANALYTICS_ASSETS && big.dataLimitations.some((x) => /Too many distinct symbols/.test(x) && /S40/.test(x)), String(big.betas.length));
}

// ---------------------------------------------------------------- NaN guards
t("drawdown: a NaN return no longer freezes the peak", near(maxDrawdownFromReturns([5, -10, NaN, 3, -8]), maxDrawdownFromReturns([5, -10, 3, -8]), 1e-12));

// ---------------------------------------------------------------- realized P&L
{
  const opt = { assetClass: "option", costBasisPerShare: 2 };
  t("realized P&L: one option contract bought at 2.00 and sold at 3.00 is +$100 (x100), minus fee", near(computeRealizedPnl(opt, 1, 3, 0), 100, 1e-9) && near(computeRealizedPnl(opt, 1, 3, 1.5), 98.5, 1e-9));
  t("realized P&L: equity unchanged; future uses its contract multiplier", near(computeRealizedPnl({ assetClass: "equity", costBasisPerShare: 10 }, 5, 12, 1), 9, 1e-9) && near(computeRealizedPnl({ assetClass: "future", costBasisPerShare: 4500, contractMultiplier: 50 }, 1, 4510, 0), 500, 1e-9));
  t("realized equals unrealized for the same prices (option)", near(computeRealizedPnl(opt, 1, 3, 0), computeValuationFigures({ assetClass: "option", shares: 1, costBasisPerShare: 2 }, 3, 40).unrealizedPL, 1e-9));
  t("sale input validation rejects NaN, Infinity, zero, negative", ["NaN", "Infinity", "0", "-1"].every((v) => validateSaleInputs(Number(v), 10, 0) !== null) && validateSaleInputs(1, NaN, 0) !== null && validateSaleInputs(1, 10, NaN) !== null && validateSaleInputs(1, 10, -1) !== null && validateSaleInputs(1, 10, 0) === null);
  const lot = 0.1 + 0.2;
  const rem1 = remainingQuantity(lot, 0.1);
  t("fractional equity sold to zero leaves no dust lot (0.1+0.2 sold as 0.1 then 0.2)", remainingQuantity(rem1, 0.2) === 0, String(remainingQuantity(rem1, 0.2)));
}

// ---------------------------------------------------------------- long-term holding test
{
  t("long-term: acquired 2025-03-10, sold 2026-03-10 (exactly one year) is SHORT-term", isLongTermHolding("2025-03-10", "2026-03-10") === false);
  t("long-term: sold 2026-03-11 (more than one year) is LONG-term", isLongTermHolding("2025-03-10", "2026-03-11") === true);
  t("long-term: 364 days is short", isLongTermHolding("2025-03-10", "2026-03-09") === false);
  t("long-term across a leap year: acquired 2023-03-10, 2024-03-10 short, 2024-03-11 long", isLongTermHolding("2023-03-10", "2024-03-10") === false && isLongTermHolding("2023-03-10", "2024-03-11") === true);
  t("long-term: acquired Feb 29 2024, sold Mar 1 2025 is short, Mar 2 2025 is long", isLongTermHolding("2024-02-29", "2025-03-01") === false && isLongTermHolding("2024-02-29", "2025-03-02") === true);
  const val = (acq) => ({ holding: { id: "x", symbol: "ZZ", assetClass: "equity", shares: 10, costBasisPerShare: 50, acquiredDate: acq }, currentPrice: 60, currentValue: 600, costBasisTotal: 500, unrealizedPL: 100, unrealizedPLPercent: 20, holdingPeriodDays: 365, annualizedReturnPercent: 20, sector: null, marketCapUsd: null, error: null });
  const imp = computeTaxLotImpact("ZZ", 600, [val("2025-03-10")], "2026-03-10");
  t("tax-lot impact uses the same rule (365 days is short-term)", imp !== null && imp.lots[0].isLongTerm === false);
}

// ---------------------------------------------------------------- valuation guards
{
  const h = { assetClass: "equity", shares: 1, costBasisPerShare: 100 };
  const oneDay = computeValuationFigures(h, 105, 1);
  t("annualised return is null for holds under 30 days (was 5e9 %)", oneDay.annualizedReturnPercent === null);
  t("annualised return still computed after 30+ days", computeValuationFigures(h, 105, 90).annualizedReturnPercent !== null);
  const short = computeValuationFigures({ assetClass: "equity", shares: -10, costBasisPerShare: 100 }, 90, 40);
  t("short position that gained shows a positive percent (denominator is the size of the basis)", short.unrealizedPL > 0 && short.unrealizedPLPercent > 0, JSON.stringify(short));
}

summary();
