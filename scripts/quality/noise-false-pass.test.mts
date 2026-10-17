// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/noise-false-pass.test.mts [reps]
//
// Noise false-pass test. Feeds seeded PURE-NOISE price series (zero drift, no signal by construction) through the
// app's own runBacktest and counts how often a signal is certified ("passes all three bars") at ANY of the five
// horizons. A sound gate certifies noise rarely. Before the statistics fix this rate was 12.2% (volume), 14.8%
// (momentum), 34.8% (mean-reversion oversold) and 38.0% (mean-reversion overbought) at 500 reps (audit 03-lead-quant E4).
//
// Threshold: with R = 150 repetitions per signal, a true rate of 5% has a standard error of sqrt(.05*.95/150) = 1.8%.
// The design target is <= 5% (BH over the whole family, then two more bars), so we fail only when the measured rate
// exceeds 8% (about 1.7 standard errors above 5%): a real regression (the old rates were 12-38%) is caught with
// near certainty, while sampling noise at a true 5% rate fails less than 5% of the time. The seed is fixed, so the
// result is deterministic: it never flakes.
//
// Also checks that the signals use no look-ahead: truncating the future of a series must not change a signal that
// was computed at an earlier date (alters every bar after a cutoff and requires identical pre-cutoff signals).
import { runBacktest } from "../../src/lib/agents/trading-agent/skills/historical-backtest.ts";
import { setFakeEnv, install, json, makeT } from "../fixtures/fake-fetch.mts";

const { t, summary } = makeT();
const REPS = Number(process.argv[2] ?? 150);
const N = 800; // about 3.1 years of weekdays
const MAX_RATE = 0.08;
const SIGNALS = ["volumeDisplacement", "momentum", "meanReversionOversold", "meanReversionOverbought"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRandn(rand: () => number) {
  return () => {
    let u = 0;
    while (u === 0) u = rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}
function weekdays(n: number, endMs: number) {
  const out: number[] = [];
  const d = new Date(endMs);
  d.setUTCHours(5, 0, 0, 0);
  let ms = d.getTime();
  while (out.length < n) {
    const w = new Date(ms).getUTCDay();
    if (w !== 0 && w !== 6) out.push(ms);
    ms -= 86400000;
  }
  return out.reverse();
}
/** Zero-drift random-walk daily bars with independent lognormal volume: nothing in them predicts anything. */
function noiseBars(randn: () => number, n = N, drift = 0, stochVol = false) {
  const ts = weekdays(n, Date.now() - 86400000);
  let p = 100;
  let lv = Math.log(0.012);
  return ts.map((t0) => {
    if (stochVol) lv = 0.97 * lv + 0.03 * Math.log(0.012) + 0.12 * randn(); // volatility clustering, volume independent of returns
    const sigma = stochVol ? Math.exp(lv) : 0.012;
    const o = p * (1 + 0.002 * randn());
    const c = o * (1 + drift + sigma * randn());
    const h = Math.max(o, c) * (1 + Math.abs(0.003 * randn()));
    const l = Math.min(o, c) * (1 - Math.abs(0.003 * randn()));
    p = c;
    return { t: new Date(t0).toISOString(), o, h, l, c, v: Math.round(1e6 * Math.exp(0.4 * randn())) };
  });
}
function serve(bars: any[]) {
  install(() => json({ bars, next_page_token: null }));
}

setFakeEnv();
const origWarn = console.warn;
console.warn = () => {};

// ------------------------------------------------------------------ the Monte Carlo
const SCENARIOS = [
  { name: "zero drift", drift: 0, stochVol: false },
  { name: "stochastic volatility", drift: 0, stochVol: true },
  { name: "+10%/yr drift", drift: 0.0004, stochVol: false },
];
const randn = makeRandn(mulberry32(20261015));
for (const scn of SCENARIOS) {
  const rates: Record<string, { any: number; perHorizon: number[] }> = {};
  for (const sig of SIGNALS) rates[sig] = { any: 0, perHorizon: [0, 0, 0, 0, 0] };
  const started = Date.now();
  for (let r = 0; r < REPS; r++) {
    serve(noiseBars(randn, N, scn.drift, scn.stochVol));
    for (const sig of SIGNALS) {
      const res = await runBacktest("NOISE", sig, 3);
      let any = false;
      res.horizons.forEach((h, i) => {
        if (h.passesAllThreeBars) {
          any = true;
          rates[sig].perHorizon[i]++;
        }
      });
      if (any) rates[sig].any++;
    }
  }
  console.log(`(${scn.name}: ${REPS} reps x ${SIGNALS.length} signals in ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  for (const sig of SIGNALS) {
    const rate = rates[sig].any / REPS;
    console.log(`  ${sig}: any-horizon false-pass ${(rate * 100).toFixed(1)}%  per horizon (1,3,5,10,20d) ${rates[sig].perHorizon.map((x) => ((100 * x) / REPS).toFixed(1) + "%").join(" / ")}`);
    t(`noise false-pass (${scn.name}): ${sig} any-horizon rate ${(rate * 100).toFixed(1)}% <= ${(MAX_RATE * 100).toFixed(0)}%`, rate <= MAX_RATE);
  }
}
console.warn = origWarn;

// ------------------------------------------------------------------ power: the gate must not be so strict it never passes a real edge
{
  const rr0 = mulberry32(31337);
  const rr = rr0;
  const rr_n = makeRandn(rr0);
  const POWER_REPS = 40;
  let detected = 0;
  console.warn = () => {};
  for (let r = 0; r < POWER_REPS; r++) {
    const base = noiseBars(rr_n);
    // Plant an edge: on volume spikes (about 4% of days) the next 5 days each earn an extra 1.0%, signalled by the volume itself.
    let boost = 0;
    let prev = 100;
    const planted = base.map((b) => {
      const spike = rr() < 0.04;
      const o = prev;
      const c = o * (1 + 0.012 * rr_n() + (boost > 0 ? 0.01 : 0));
      if (boost > 0) boost--;
      if (spike) boost = 5;
      prev = c;
      return { t: b.t, o, c, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, v: Math.round(b.v * (spike ? 4 : 1)) };
    });
    serve(planted);
    const res = await runBacktest("EDGE", "volumeDisplacement", 3);
    if (res.horizons.some((h) => h.passesAllThreeBars)) detected++;
  }
  console.warn = origWarn;
  console.log(`  planted edge detected in ${detected}/${POWER_REPS} series`);
  t(`power: a planted +1%/day x 5 days volume-spike edge is certified in at least 60% of series (${detected}/${POWER_REPS})`, detected / POWER_REPS >= 0.6);
}

// ------------------------------------------------------------------ determinism: same data, same answer (the bootstrap is seeded from the data)
{
  const rr = makeRandn(mulberry32(99));
  serve(noiseBars(rr));
  const a = await runBacktest("NOISE", "meanReversionOversold", 3);
  const b = await runBacktest("NOISE", "meanReversionOversold", 3);
  t("deterministic: two runs on the same data give identical intervals and p-values", JSON.stringify(a.horizons) === JSON.stringify(b.horizons));
}

// ------------------------------------------------------------------ no look-ahead (truncation test)
{
  const rr = makeRandn(mulberry32(777));
  const bars = noiseBars(rr);
  const CUT = 600;
  serve(bars);
  const full: Record<string, string[]> = {};
  for (const sig of SIGNALS) full[sig] = (await runBacktest("NOISE", sig, 3)).tradeLog.map((x) => x.dateKey);
  // Replace every bar after the cutoff with a violent different future: any signal dated before the cutoff must not move.
  const altered = bars.map((b, i) => (i < CUT ? b : { ...b, o: b.o * 3, h: b.h * 3.1, l: b.l * 2.9, c: b.c * 2.7, v: b.v * 20 }));
  serve(altered);
  const cutKey = new Date(bars[CUT - 1].t).toISOString().slice(0, 10);
  for (const sig of SIGNALS) {
    const alt = (await runBacktest("NOISE", sig, 3)).tradeLog.map((x) => x.dateKey);
    const before = (xs: string[]) => xs.filter((d) => d < cutKey);
    const same = JSON.stringify(before(full[sig])) === JSON.stringify(before(alt));
    t(`no look-ahead: ${sig} signal dates before the cutoff are identical when the future is altered (${before(full[sig]).length} signals)`, same);
  }
}

summary();
