// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/news-impact.test.mts
// News Impact study, pure computation: market model with purge gap, event study (planted effect found, null not found),
// Benjamini-Hochberg over the table, minimum-n refusals, variance split and half-sample stability, SEC filing timing,
// macro days, placebo false-pass rate, plain-language wording. Synthetic seeded data only; no network, no key.
import { mulberry32, benjaminiHochberg } from "../src/lib/agents/trading-agent/skills/stats-tests.ts";
import { makeT } from "./fixtures/fake-fetch.mts";
import { olsFit, scoreRolling, logVolumeRatio, trailingSd, PURGE_GAP } from "../src/lib/news-impact/market-model.ts";
import { alignReturns, cleanBars, firstIndexOnOrAfter } from "../src/lib/news-impact/returns.ts";
import { mapEvents, runEventStudy, batchMeansSe, compareValues, MIN_HEADLINE_EVENTS } from "../src/lib/news-impact/event-study.ts";
import { decomposeVariance } from "../src/lib/news-impact/variance-decomposition.ts";
import { classifyFiling, reactionDate, filingsToEvents, FILING_TYPES } from "../src/lib/news-impact/filing-events.ts";
import { runMacroStudy } from "../src/lib/news-impact/macro-study.ts";
import { placeboTest, powerTest } from "../src/lib/news-impact/placebo.ts";
import { factorPlanFor, sectorEtfFor } from "../src/lib/news-impact/factors.ts";
import { analyzeNewsImpact } from "../src/lib/news-impact/analyze.ts";
import { businessVerdict, systematicVerdict, macroVerdict } from "../src/lib/news-impact/verdict.ts";
import { dailyHeadlineStats, mergeDayCounts, headlineHash, evaluateCountsVsMoves } from "../src/lib/news-impact/headline-log.ts";
import { readingStats } from "./quality/reading-level.mts";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsImpactView } from "../src/components/NewsImpactPanel.tsx";

const { t, summary } = makeT();
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// ---- seeded synthetic data helpers
function normal(rand: () => number) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function weekdays(n: number, start = "2019-01-02"): string[] {
  const out: string[] = [];
  let ms = Date.parse(`${start}T00:00:00Z`);
  while (out.length < n) {
    const dow = new Date(ms).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(ms).toISOString().slice(0, 10));
    ms += 86_400_000;
  }
  return out;
}
interface Synth { dates: string[]; f: number[]; r: number[]; vol: number[]; eventIdx: number[] }
/** asset = beta * factor + eps; eps scaled by `boost` on event days. */
function synth(seed: number, n: number, opts: { beta?: number; boost?: number; nEvents?: number; epsSd?: number } = {}): Synth {
  const rand = mulberry32(seed);
  const beta = opts.beta ?? 1;
  const dates = weekdays(n + 1).slice(1);
  const eventIdx: number[] = [];
  const nEv = opts.nEvents ?? 60;
  const used = new Set<number>();
  let guard = 0;
  while (eventIdx.length < nEv && guard++ < 100000) {
    const i = 150 + Math.floor(rand() * (n - 160));
    if ([...used].some((u) => Math.abs(u - i) < 6)) continue;
    used.add(i);
    eventIdx.push(i);
  }
  eventIdx.sort((a, b) => a - b);
  const f: number[] = [];
  const r: number[] = [];
  const vol: number[] = [];
  for (let i = 0; i < n; i++) {
    const fi = 0.01 * normal(rand);
    const boost = opts.boost && eventIdx.includes(i) ? opts.boost : 1;
    f.push(fi);
    r.push(beta * fi + (opts.epsSd ?? 0.01) * normal(rand) * boost);
    vol.push(1_000_000 * Math.exp(0.2 * normal(rand)) * (boost > 1 ? 1.5 : 1));
  }
  return { dates, f, r, vol, eventIdx };
}
function toSeries(s: Synth) {
  const roll = scoreRolling(s.r, s.f);
  return { dates: s.dates, ar: roll.ar, sd: roll.sd, sar: roll.sar, volLog: logVolumeRatio(s.vol) };
}
const evs = (s: Synth, type = "earnings") => s.eventIdx.map((i) => ({ date: s.dates[i], type, label: type }));

// ---- ols
{
  const x = [1, 2, 3, 4, 5, 6];
  const y = x.map((v) => 2 + 3 * v);
  const f = olsFit(x, y);
  t("olsFit: exact line gives beta 3, alpha 2, R2 1", f && near(f.beta, 3, 1e-9) && near(f.alpha, 2, 1e-9) && near(f.rSquared, 1, 1e-9));
  t("olsFit: fewer than 3 points or no spread is null", olsFit([1, 2], [1, 2]) === null && olsFit([1, 1, 1, 1], [1, 2, 3, 4]) === null);
  const rand = mulberry32(5);
  const xs = Array.from({ length: 4000 }, () => normal(rand));
  const ys = xs.map((v) => 0.5 * v + normal(rand));
  const g = olsFit(xs, ys);
  t("olsFit: recovers beta 0.5 on noisy data and R2 near 0.2", g && near(g.beta, 0.5, 0.05) && near(g.rSquared, 0.2, 0.03), JSON.stringify(g));
  t("olsFit: seBeta is about residSd / sqrt(Sxx)", g && near(g.seBeta, g.residSd / Math.sqrt(g.sxx), 1e-12) && g.seBeta < 0.03);
}

// ---- purge gap: a shock in the last PURGE_GAP days before t must not change the model scored for t
{
  const s = synth(11, 400, { nEvents: 5 });
  const base = scoreRolling(s.r, s.f);
  const shocked = s.r.slice();
  const T = 300;
  for (let k = 1; k <= PURGE_GAP; k++) shocked[T - k] += 0.5; // inside the purge gap
  const sc = scoreRolling(shocked, s.f);
  t("purge gap: a shock within the gap before day t leaves day t's abnormal return unchanged", near(sc.ar[T], base.ar[T], 1e-12));
  const shocked2 = s.r.slice();
  shocked2[T - PURGE_GAP - 1] += 0.5; // just outside the gap: now inside the estimation window
  t("purge gap: a shock just outside the gap does enter the window", Math.abs(scoreRolling(shocked2, s.f).ar[T] - base.ar[T]) > 1e-9);
  t("purge gap: the day itself never enters its own estimation window", (() => { const x = s.r.slice(); x[T] += 0.3; return near(scoreRolling(x, s.f).ar[T], base.ar[T] + 0.3, 1e-12); })());
  t("scoreRolling: nothing scored until the minimum window exists", base.sar.slice(0, 60).every((v) => v === null) && base.sar[200] !== null);
  const sarVals = base.sar.filter((v) => v !== null);
  const sd = Math.sqrt(sarVals.reduce((a, b) => a + b * b, 0) / sarVals.length);
  t("standardized abnormal returns have SD close to 1 on a stable series", near(sd, 1, 0.08), String(sd));
}

// ---- alignment
{
  const mk = (dates: string[], f: (i: number) => number) => dates.map((d, i) => ({ date: d, close: f(i), volume: 100 }));
  const cal = ["2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04", "2024-03-05"]; // crypto: every day
  const wk = ["2024-03-01", "2024-03-04", "2024-03-05"]; // stocks: weekdays
  const a = mk(cal, (i) => 100 * Math.exp(0.01 * i));
  const f = mk(wk, (i) => 50 * Math.exp(0.02 * i));
  const al = alignReturns(a, [f]);
  t("alignReturns: only shared dates, one return per consecutive shared pair", al.dates.join() === "2024-03-04,2024-03-05" && al.ret.length === 2);
  t("alignReturns: the asset return spans the weekend (3 days of drift), same horizon as the factor", near(al.ret[0], 0.03, 1e-12) && near(al.factorRet[0][0], 0.02, 1e-12));
  t("cleanBars: drops bad closes and duplicate dates, sorts", cleanBars([{ date: "2024-01-02", close: 2, volume: 1 }, { date: "2024-01-01", close: 1, volume: 1 }, { date: "2024-01-02", close: 3, volume: 1 }, { date: "bad", close: 1, volume: 1 }, { date: "2024-01-03", close: -1, volume: 1 }, { date: "2024-01-04", close: NaN, volume: 1 }]).map((b) => `${b.date}:${b.close}`).join() === "2024-01-01:1,2024-01-02:3");
  t("firstIndexOnOrAfter: binary search, -1 past the end", firstIndexOnOrAfter(["2024-01-02", "2024-01-04"], "2024-01-03") === 1 && firstIndexOnOrAfter(["2024-01-02"], "2024-01-03") === -1);
}

// ---- event mapping
{
  const dates = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"];
  const m = mapEvents(dates, [
    { date: "2024-01-06", type: "other", label: "" }, // Saturday -> Monday 01-08
    { date: "2024-01-03", type: "other", label: "" },
    { date: "2024-01-03", type: "earnings", label: "" }, // same day: earnings wins
    { date: "2024-03-01", type: "other", label: "" }, // past the data: dropped
  ], ["earnings", "other"]);
  t("mapEvents: weekend event goes to the next trading day, same-day types resolve by priority, past-the-data events drop", m.length === 2 && m[0].idx === 1 && m[0].type === "earnings" && m[1].idx === 4, JSON.stringify(m));
}

// ---- event study: planted effect found, null not found
{
  const planted = synth(21, 1100, { boost: 3, nEvents: 60 });
  const res = runEventStudy(toSeries(planted), evs(planted), FILING_TYPES);
  const p = res.pooled;
  t("event study: a planted 3x effect gives a ratio near 3 (|SAR| mean ratio between 2 and 3.5)", p.day0.ratio > 2 && p.day0.ratio < 3.5, String(p.day0.ratio));
  t("event study: planted effect is clearly larger, adjusted p < 0.001, interval above 1", res.effect === "clearly-larger" && p.day0.pAdj < 0.001 && p.day0.ratioLo > 1, JSON.stringify(p.day0));
  t("event study: abnormal volume also detected (planted 1.5x volume)", p.volume.p < 0.001 && p.volume.diff > 0.2);
  t("event study: 3-day CAR measure also finds the effect", p.car.p < 0.01 && p.car.ratio > 1);
  t("event study: n reported on every test", p.day0.n === 60 && p.day0.nBase > 700 && p.car.n > 40);
  t("event study: absolute abnormal percent is larger on event days", p.absArPctEvent > 1.8 * p.absArPctBase);
  const nul = synth(22, 1100, { boost: 0, nEvents: 60 });
  const rn = runEventStudy(toSeries(nul), evs(nul), FILING_TYPES);
  t("event study: no planted effect gives no-clear-difference and a ratio near 1", rn.effect === "no-clear-difference" && near(rn.pooled.day0.ratio, 1, 0.3), JSON.stringify(rn.pooled.day0));
  t("event study: a null reports what it cannot rule out (upper ratio above the point estimate)", rn.ratioCannotRuleOut > rn.pooled.day0.ratio);
  const few = synth(23, 1100, { boost: 3, nEvents: 12 });
  const rf = runEventStudy(toSeries(few), evs(few), FILING_TYPES);
  t("event study: 12 events is below the headline minimum, so the answer is not-enough, never a verdict", rf.effect === "not-enough" && rf.pooled.day0.enough === false && MIN_HEADLINE_EVENTS === 20);
  const mixed = [...evs(planted, "earnings").slice(0, 30), ...evs(planted, "deals").slice(30)];
  const rm = runEventStudy(toSeries(planted), mixed, FILING_TYPES);
  const byId = Object.fromEntries(rm.groups.map((g) => [g.id, g]));
  t("event study: types are split, and a type under 10 events is not enough", byId.earnings.day0.enough && byId.deals.day0.enough && byId.leadership.day0.enough === false && byId.leadership.day0.n === 0);
  const ps = [rm.pooled, ...rm.groups].flatMap((g) => [g.day0, g.car, g.volume]).filter((x) => x.p !== null);
  t("event study: every p has a Benjamini-Hochberg adjusted p at least as large", ps.every((x) => x.pAdj !== null && x.pAdj >= x.p - 1e-12));
  t("event study: family size equals the number of tests with a p-value", rm.testsInFamily === ps.length);
  const headlineAdj = benjaminiHochberg([rm.pooled.day0.p, rm.pooled.car.p, rm.pooled.volume.p]);
  t("event study: the pooled headline row is corrected across its own 3 measures only, so the many type rows do not penalise it", near(rm.pooled.day0.pAdj, headlineAdj[0], 1e-12) && near(rm.pooled.car.pAdj, headlineAdj[1], 1e-12) && near(rm.pooled.volume.pAdj, headlineAdj[2], 1e-12));
  const typeTests = rm.groups.flatMap((g) => [g.day0, g.car, g.volume]);
  const typeAdj = benjaminiHochberg(typeTests.map((x) => (x.p === null ? NaN : x.p)));
  t("event study: the by-type rows are corrected together as their own family", typeTests.every((x, i) => (x.p === null ? x.pAdj === null : near(x.pAdj, typeAdj[i], 1e-12))));
}

// ---- baseline excludes every event window
{
  const s = synth(24, 800, { boost: 4, nEvents: 40 });
  const res = runEventStudy(toSeries(s), evs(s), FILING_TYPES);
  const N = 800 - 60; // scored days
  t("baseline: ordinary days exclude day -1..+2 around each event (about 4 per event)", res.pooled.day0.nBase <= N - 40 * 4 + 10 && res.pooled.day0.nBase >= N - 40 * 4 - 80, String(res.pooled.day0.nBase));
}

// ---- compareValues and batch means
{
  const rand = mulberry32(3);
  const base = Array.from({ length: 1000 }, () => Math.abs(normal(rand)));
  const ev = Array.from({ length: 30 }, () => Math.abs(normal(rand)));
  const c = compareValues(ev, base, { mode: "abs", minN: 20, thinBelow: 15 });
  t("compareValues: same distribution gives ratio near 1 and a large p", near(c.ratio, 1, 0.3) && c.p > 0.05);
  const c2 = compareValues(ev.map((v) => v * 2.5), base, { mode: "abs", minN: 20, thinBelow: 15 });
  t("compareValues: 2.5x scale gives a tiny p and ratio near 2.5", c2.p < 1e-4 && near(c2.ratio, 2.5, 0.6));
  t("compareValues: fewer than 5 events has no bootstrap interval and is flagged thin / not enough", (() => { const x = compareValues([1, 2, 3], base, { mode: "abs", minN: 20, thinBelow: 15 }); return x.ratioLo === null && x.thin && !x.enough; })());
  t("compareValues: empty inputs give nulls, not NaN", (() => { const x = compareValues([], base, { mode: "abs", minN: 20, thinBelow: 15 }); return x.p === null && x.eventMean === null; })());
  const iid = Array.from({ length: 2000 }, () => normal(rand));
  const { se } = batchMeansSe(iid);
  t("batchMeansSe: iid data matches sd / sqrt(n)", near(se, 1 / Math.sqrt(2000), 0.008), String(se));
  // clustered data: a slow-moving regime makes the batch SE much larger than the naive SE
  const slow: number[] = [];
  let level = 0;
  for (let i = 0; i < 2000; i++) {
    if (i % 100 === 0) level = normal(rand);
    slow.push(level + 0.1 * normal(rand));
  }
  const naive = Math.sqrt(slow.reduce((a, b) => a + (b - slow.reduce((x, y) => x + y, 0) / 2000) ** 2, 0) / 1999) / Math.sqrt(2000);
  t("batchMeansSe: clustered values give a larger SE than the naive one", batchMeansSe(slow).se > naive, `${batchMeansSe(slow).se} vs ${naive}`);
}

// ---- variance decomposition
{
  const rand = mulberry32(31);
  const n = 1000;
  const dates = weekdays(n + 1).slice(1);
  const f1 = Array.from({ length: n }, () => 0.01 * normal(rand));
  const f2 = Array.from({ length: n }, () => 0.01 * normal(rand));
  const y = f1.map((v, i) => 0.8 * v + 0.6 * f2[i] + 0.01 * normal(rand));
  const spec = [{ symbol: "A", label: "market", short: "M" }, { symbol: "B", label: "sector", short: "S" }];
  const d = decomposeVariance(dates, y, [f1, f2], spec);
  const var1 = 0.64, var2 = 0.36, vare = 1; // in units of 1e-4
  const expectTotal = (var1 + var2) / (var1 + var2 + vare);
  t("variance split: total R2 matches the design (about 0.5)", d && near(d.r2Total, expectTotal, 0.05), String(d && d.r2Total));
  t("variance split: slices add up to the total, own = 1 - total", d && near(d.slices[0].r2Added + d.slices[1].r2Added, d.r2Total, 1e-9) && near(d.ownShare, 1 - d.systematicShare, 1e-12));
  t("variance split: first factor beta near 0.8 with a standard error", d && near(d.slices[0].beta, 0.8, 0.12) && d.slices[0].seBeta > 0);
  t("variance split: bootstrap interval brackets the estimate", d && d.r2TotalLo < d.r2Total && d.r2Total < d.r2TotalHi && d.r2TotalHi - d.r2TotalLo < 0.15);
  t("variance split: stationary relation is stable across halves", d && d.stable === true);
  const yShift = y.map((v, i) => (i < n / 2 ? f1[i] * 0.2 + 0.015 * normal(rand) : f1[i] * 1.6 + 0.004 * normal(rand)));
  const d2 = decomposeVariance(dates, yShift, [f1], [spec[0]]);
  t("variance split: a relation that changes between halves is flagged not stable", d2 && d2.stable === false, JSON.stringify(d2 && { z: d2.betaZ, gap: d2.r2Gap }));
  t("variance split: too little history returns null", decomposeVariance(dates.slice(0, 30), y.slice(0, 30), [f1.slice(0, 30)], [spec[0]]) === null);
  t("variance split: no factors returns null", decomposeVariance(dates, y, [], []) === null);
}

// ---- SEC filings: classification and timing
{
  t("classifyFiling: 8-K item 2.02 is earnings, 5.02 leadership, 1.01 deals, 7.01 other, 10-Q periodic", classifyFiling({ form: "8-K", items: "2.02,9.01" }) === "earnings" && classifyFiling({ form: "8-K", items: "5.02" }) === "leadership" && classifyFiling({ form: "8-K", items: "1.01,9.01" }) === "deals" && classifyFiling({ form: "8-K", items: "7.01" }) === "other" && classifyFiling({ form: "10-Q" }) === "periodic");
  t("classifyFiling: earnings wins when both 2.02 and 5.02 are listed", classifyFiling({ form: "8-K", items: "5.02,2.02" }) === "earnings");
  t("classifyFiling: insider forms and amendments are ignored", classifyFiling({ form: "4" }) === null && classifyFiling({ form: "8-K/A", items: "2.02" }) === null && classifyFiling({ form: "SC 13G" }) === null);
  t("reactionDate: accepted after the 4 pm close in summer (20:30Z = 16:30 EDT) goes to the next day", reactionDate({ filingDate: "2024-05-02", acceptanceDateTime: "2024-05-02T20:30:46.000Z" }) === "2024-05-03");
  t("reactionDate: accepted 15:59 EDT stays on the same day", reactionDate({ filingDate: "2024-05-02", acceptanceDateTime: "2024-05-02T19:59:00.000Z" }) === "2024-05-02");
  t("reactionDate: winter (EST) boundary: 21:00Z is 16:00 EST -> next day; 20:59Z stays", reactionDate({ filingDate: "2024-01-10", acceptanceDateTime: "2024-01-10T21:00:00.000Z" }) === "2024-01-11" && reactionDate({ filingDate: "2024-01-10", acceptanceDateTime: "2024-01-10T20:59:00.000Z" }) === "2024-01-10");
  t("reactionDate: early-morning filing (08:05 EDT) stays on its day", reactionDate({ filingDate: "2024-05-02", acceptanceDateTime: "2024-05-02T12:05:00.000Z" }) === "2024-05-02");
  t("reactionDate: without an acceptance time, the filing date is used; junk gives null", reactionDate({ filingDate: "2024-05-02" }) === "2024-05-02" && reactionDate({ filingDate: "nope" }) === null);
  const evsOut = filingsToEvents([{ form: "8-K", filingDate: "2024-05-02", acceptanceDateTime: "2024-05-02T20:30:46.000Z", items: "2.02" }, { form: "4", filingDate: "2024-05-02" }]);
  t("filingsToEvents: keeps only the studied forms", evsOut.length === 1 && evsOut[0].date === "2024-05-03" && evsOut[0].type === "earnings");
}

// ---- macro days
{
  const s = synth(41, 1200, { boost: 2.5, nEvents: 60, beta: 1 });
  const macro = s.eventIdx.map((i, k) => ({ date: s.dates[i], type: k % 3 === 0 ? "fomc" : k % 3 === 1 ? "cpi" : "jobs", label: "" }));
  const res = runMacroStudy(s.dates, s.r, macro);
  t("macro days: a planted 2.5x effect on scheduled days is detected on the pooled test", res.pooled.test.p < 0.001 && res.pooled.test.ratio > 1.5, JSON.stringify(res.pooled.test));
  t("macro days: each kind has about 20 days and is reported", res.groups.length === 3 && res.groups.every((g) => g.nEvents >= 15));
  t("macro days: raw percent is larger on macro days", res.pooled.absRetPctEvent > res.pooled.absRetPctBase);
  const nul = synth(42, 1200, { boost: 0, nEvents: 60 });
  const rn = runMacroStudy(nul.dates, nul.r, nul.eventIdx.map((i) => ({ date: nul.dates[i], type: "fomc", label: "" })), undefined, {});
  t("macro days: no planted effect gives no detection", rn.pooled.test.pAdj > 0.05 || rn.pooled.test.ratioLo <= 1, JSON.stringify(rn.pooled.test));
}

// ---- placebo (false pass) and power, on synthetic null data
{
  const rates: number[] = [];
  let hits = 0;
  let total = 0;
  for (const seed of [51, 52, 53]) {
    const s = synth(seed, 1000, { boost: 0, nEvents: 40 });
    const series = toSeries(s);
    for (const kind of ["random", "shifted"] as const) {
      const pb = placeboTest(series, evs(s), { runs: 100, seed: seed * 7, kind });
      if (pb.falsePass.day0 !== null) {
        hits += pb.falsePass.day0 * pb.valid;
        total += pb.valid;
        rates.push(pb.falsePass.day0);
      }
    }
  }
  const rate = hits / total;
  t(`placebo: day-0 false-pass rate on fake events is at most 8% (got ${(rate * 100).toFixed(1)}% over ${total} runs)`, rate <= 0.08, String(rate));
  t("placebo: and not implausibly low either (above 1%)", rate >= 0.01, String(rate));
  const s = synth(54, 1000, { boost: 0, nEvents: 40 });
  const pw = powerTest(toSeries(s), evs(s), [1, 1.5, 2.5], { runs: 60 });
  t("power: factor 1 (no effect) fires at about the false-pass rate; 2.5x is detected almost always", pw[0].detectDay0 <= 0.12 && pw[2].detectDay0 >= 0.9 && pw[1].detectDay0 > pw[0].detectDay0, JSON.stringify(pw));
}

// ---- factor plans
{
  const names = (sym: string, cls: string) => factorPlanFor(sym, cls).factors.map((f) => f.symbol).join();
  t("factors: AAPL = SPY then XLK (curated sector)", names("AAPL", "equity") === "SPY,XLK");
  t("factors: unlisted stock = SPY only, and the note says so", names("ZZZZ", "equity") === "SPY" && /short list/.test(factorPlanFor("ZZZZ", "equity").notes.join(" ")));
  t("factors: SPY has no benchmark left (it is the market) and no company events", names("SPY", "equity") === "" && factorPlanFor("SPY", "equity").hasOwnEvents === false);
  t("factors: a fund such as GLD is market-only with no filings", names("GLD", "equity") === "SPY" && factorPlanFor("GLD", "equity").hasOwnEvents === false);
  t("factors: alt coin = BTC then SPY; BTC itself = SPY", names("ETH-USD", "crypto") === "BTC-USD,SPY" && names("BTC-USD", "crypto") === "SPY");
  t("factors: commodity = DBC then SPY; forex = UUP then SPY", names("USO", "commodity") === "DBC,SPY" && names("EUR/USD", "forex") === "UUP,SPY");
  t("factors: only equities have company events", ["crypto", "commodity", "future", "forex"].every((c) => factorPlanFor("X", c).hasOwnEvents === false));
  t("factors: sectorEtfFor is case-insensitive and null for unknown", sectorEtfFor("dell").symbol === "XLK" && sectorEtfFor("NOPE") === null);
}

// ---- end to end on synthetic bars
{
  const s = synth(61, 1000, { boost: 3, nEvents: 50, beta: 1.2 });
  const closeFrom = (rets: number[], start = 100) => { let p = start; return rets.map((r) => (p *= Math.exp(r))); };
  const asOfDates = ["2018-12-31", ...s.dates];
  const mkBars = (rets: number[], vol?: number[]) => { const c = closeFrom(rets); return [{ date: asOfDates[0], close: 100, volume: 1 }, ...c.map((cl, i) => ({ date: s.dates[i], close: cl, volume: vol ? vol[i] : 1000 }))]; };
  const filings = s.eventIdx.map((i) => ({ form: "8-K", filingDate: s.dates[i], acceptanceDateTime: `${s.dates[i]}T14:00:00.000Z`, items: "2.02" }));
  const input = {
    symbol: "TEST", assetClass: "equity", asOf: "2026-10-18T00:00:00.000Z",
    assetBars: mkBars(s.r, s.vol),
    factorBars: { SPY: mkBars(s.f) },
    filings,
    macroDates: { fomc: s.eventIdx.slice(0, 20).map((i) => s.dates[i]), cpi: null, jobs: null },
  };
  const out = analyzeNewsImpact(input);
  t("analyze: equity with filings runs the company-event test and calls the planted effect clearly larger", out.business.study && out.business.verdict.kind === "clearly-larger", out.business.verdict.text);
  t("analyze: variance split present with SPY beta near 1.2", out.systematic.decomposition && near(out.systematic.decomposition.slices[0].beta, 1.2, 0.1));
  t("analyze: macro test runs with only FOMC dates and names the missing kinds", out.macro.study && out.macro.missingKinds.length === 2 && out.notes.some((n) => /could not be loaded/.test(n)));
  t("analyze: dataThrough is the last price date", out.dataThrough === s.dates[s.dates.length - 1]);
  const noFilings = analyzeNewsImpact({ ...input, filings: null });
  t("analyze: filings that failed to load are named, no company verdict is invented", noFilings.business.study === null && noFilings.business.verdict.kind === "unavailable" && /could not be loaded/.test(noFilings.business.verdict.text));
  const crypto = analyzeNewsImpact({ ...input, symbol: "ETH-USD", assetClass: "crypto", factorBars: { "BTC-USD": mkBars(s.f), SPY: mkBars(s.f.map((_, i) => s.f[(i + 7) % s.f.length] * 0.5)) } });
  t("analyze: crypto skips the company-event test and says why, still splits variance", crypto.business.study === null && /headline log/.test(crypto.business.verdict.text) && crypto.systematic.decomposition.slices.length === 2);
  const dropped = analyzeNewsImpact({ ...input, factorBars: {} });
  t("analyze: a missing benchmark is named in the notes and the study does not crash", dropped.notes.some((n) => /SPY/.test(n)) && dropped.systematic.decomposition === null);
  const tiny = analyzeNewsImpact({ ...input, assetBars: input.assetBars.slice(0, 60), factorBars: { SPY: input.factorBars.SPY.slice(0, 60) } });
  t("analyze: too little history gives a plain refusal", tiny.business.study === null && /Only \d+ days/.test(tiny.systematic.text));
}

// ---- wording: plain, no cause claims, no advice
{
  const s = synth(71, 1100, { boost: 3, nEvents: 60 });
  const study = runEventStudy(toSeries(s), evs(s), FILING_TYPES);
  const few = runEventStudy(toSeries(synth(72, 1100, { boost: 3, nEvents: 8 })), evs(synth(72, 1100, { boost: 3, nEvents: 8 })), FILING_TYPES);
  const nul = synth(73, 1100, { boost: 0, nEvents: 60 });
  const nulStudy = runEventStudy(toSeries(nul), evs(nul), FILING_TYPES);
  const texts = [
    businessVerdict("ABC", study, null).text,
    businessVerdict("ABC", few, null).text,
    businessVerdict("ABC", nulStudy, null).text,
    businessVerdict("ABC", null, "x").text,
    systematicVerdict("ABC", decomposeVariance(s.dates, s.r, [s.f], [{ symbol: "SPY", label: "the US stock market", short: "M" }]), "company-specific", null).text,
    macroVerdict("ABC", runMacroStudy(s.dates, s.r, evs(s, "fomc")), null).text,
  ];
  t("wording: too few events says 'Not enough events to say' and shows no ratio", /^Not enough events to say/.test(texts[1]) && !/\dx/.test(texts[1]));
  t("wording: a null is a limit of detection, not 'no effect'", /No clear difference/.test(texts[2]) && /could miss an effect up to about/.test(texts[2]) && !/no effect/i.test(texts[2]));
  t("wording: a found effect says 'moves with' and that this does not show cause", /moves with/.test(texts[0]) && /does not show/.test(texts[0]));
  const banned = /\b(buy|sell|should|recommend|advice|guarantee|will rise|will fall)\b/i;
  t("wording: no advice words in any verdict", texts.every((x) => !banned.test(x)), texts.find((x) => banned.test(x)) ?? "");
  t("wording: the word 'cause' appears only in a negation ('did not cause' / 'does not show ... caused')", texts.every((x) => !/\bcauses?\b|\bcaused\b/i.test(x) || /not show[^.]*caused/.test(x)));
}

// ---- headline log: counts, merge, evaluation
{
  const items = [
    { title: "Apple unveils new chip", url: "https://a.example/1", source: "a.example", provider: "Yahoo Finance feed", publishedAt: "2026-10-16T14:00:00.000Z", timeKind: "published", kind: "news" },
    { title: "Apple unveils new chip", url: "https://b.example/1", source: "b.example", provider: "Yahoo Finance feed", publishedAt: "2026-10-16T15:00:00.000Z", timeKind: "published", kind: "news" },
    { title: "Should you buy Apple now?", url: "https://c.example/9", source: "c.example", provider: "Yahoo Finance feed", publishedAt: "2026-10-16T16:00:00.000Z", timeKind: "published", kind: "news", opinion: true },
    { title: "8-K filing", url: "https://sec.example/1", source: "SEC EDGAR", provider: "SEC EDGAR", publishedAt: "2026-10-16T00:00:00.000Z", timeKind: "date", kind: "filing" },
    { title: "Old story", url: "https://d.example/2", source: "d.example", provider: "RSS", publishedAt: "2026-10-15T14:00:00.000Z", timeKind: "published", kind: "news" },
    { title: "No date", url: "https://e.example/3", source: "e.example", provider: "RSS", publishedAt: null, timeKind: "published", kind: "news" },
  ];
  const days = dailyHeadlineStats(items, 20);
  const d16 = days.find((d) => d.countDate === "2026-10-16");
  t("headline log: items are grouped by Eastern publication date; undated items are not counted", days.length === 2 && d16 && days.find((d) => d.countDate === "2026-10-15").headlineCount === 1);
  t("headline log: the same story from two outlets counts once; filings are counted apart; opinion-labelled counted", d16.headlineCount === 2 && d16.filingCount === 1 && d16.opinionCount === 1, JSON.stringify(d16));
  t("headline log: counts by outlet are kept, no titles or links are stored", d16.sourceCounts["a.example"] === 1 && !JSON.stringify(d16).includes("unveils") && !JSON.stringify(d16).includes("https"));
  const m1 = mergeDayCounts(null, d16);
  const m2 = mergeDayCounts(m1, d16);
  t("merge: capturing the same headlines twice does not double count", m2.headlineCount === m1.headlineCount && Object.keys(m2.seen).length === Object.keys(m1.seen).length);
  const extra = { ...d16, seen: { ...d16.seen, newhash00001: "n-|z.example" } };
  const m3 = mergeDayCounts(m2, extra);
  t("merge: a genuinely new headline adds one and its outlet", m3.headlineCount === m1.headlineCount + 1 && m3.sourceCounts["z.example"] === 1);
  t("headlineHash: stable, case and punctuation insensitive, 12 hex characters", headlineHash("Apple unveils NEW chip!") === headlineHash("apple unveils new chip") && /^[0-9a-f]{12}$/.test(headlineHash("x")));
  t("feed cap: flagged on the oldest Yahoo day when the feed returned its cap or more items", dailyHeadlineStats(items, 3).find((d) => d.countDate === "2026-10-16").feedCapped === true && dailyHeadlineStats(items, 20).every((d) => d.feedCapped === false));
  // evaluation: counts that really track |SAR| give a positive rank correlation; unrelated counts do not
  const rand = mulberry32(81);
  const N = 120;
  const sarAbs = Array.from({ length: N }, () => Math.abs(normal(rand)));
  const dates = weekdays(N);
  const tracking = sarAbs.map((v) => Math.max(0, Math.round(3 * v + normal(rand))));
  const unrelated = Array.from({ length: N }, () => Math.round(3 + 2 * normal(rand)));
  const ev1 = evaluateCountsVsMoves(dates, tracking, sarAbs);
  const ev2 = evaluateCountsVsMoves(dates, unrelated, sarAbs);
  t("evaluation: counts that track the move show a positive rank correlation with an interval above zero", ev1.status === "ok" && ev1.rho > 0.3 && ev1.lo > 0, JSON.stringify(ev1));
  t("evaluation: unrelated counts show an interval that includes zero", ev2.status === "ok" && ev2.lo <= 0 && ev2.hi >= 0, JSON.stringify(ev2));
  t("evaluation: under 60 days it refuses", evaluateCountsVsMoves(dates.slice(0, 30), tracking.slice(0, 30), sarAbs.slice(0, 30)).status === "not-enough");
}

// ---- reading level of the plain-language text (grade 8 or lower), and the panel as rendered
{
  const s = synth(91, 1100, { boost: 3, nEvents: 60 });
  const study = runEventStudy(toSeries(s), evs(s, "earnings").slice(0, 30).concat(evs(s, "other").slice(30)), FILING_TYPES);
  const nul = synth(92, 1100, { boost: 0, nEvents: 60 });
  const nulStudy = runEventStudy(toSeries(nul), evs(nul), FILING_TYPES);
  const decomp = decomposeVariance(s.dates, s.r, [s.f], [{ symbol: "SPY", label: "the US stock market", short: "M" }]);
  const macro = runMacroStudy(s.dates, s.r, evs(s, "fomc"));
  const samples = [
    businessVerdict("ABC", study, null).text,
    businessVerdict("ABC", nulStudy, null).text,
    businessVerdict("ABC", null, "No dated company-type events exist for crypto in this app, so this test does not run.").text,
    systematicVerdict("ABC", decomp, "company-specific", null).text,
    macroVerdict("ABC", macro, null).text,
  ];
  const grade = readingStats(samples.join(" ")).fk;
  t(`reading level: the verdict sentences read at grade 8 or lower (got ${grade.toFixed(1)})`, grade <= 8.0, String(grade));
  const src = readFileSync(new URL("../src/components/NewsImpactPanel.tsx", import.meta.url), "utf8");
  const intro = /Two questions:([\s\S]*?)causes a move\./.exec(src);
  t("reading level: the panel's own introduction is grade 8 or lower", !!intro && readingStats(("Two questions:" + intro[1] + "causes a move.").replace(/\s+/g, " ").replace(/\{"[^}]*"\}/g, "")).fk <= 8.0);
  t("panel source: shows the research notice, never calls a price chart, never claims cause", /ResearchNotice/.test(src) && !/PriceChart/.test(src) && !/causes a (price )?move(?!\.)/.test(src.replace("does not show that news causes a move", "")));

  const data = {
    symbol: "ABC", assetClass: "equity", asOf: "2026-10-18T12:00:00.000Z", dataThrough: "2026-10-16", sample: { from: "2021-09-27", to: "2026-10-16", returns: 1100 },
    plan: { factors: [{ symbol: "SPY", label: "the US stock market", short: "Stock market", loaded: true }], ownLabel: "company-specific", notes: ["Compared with the US stock market first."] },
    business: { study, verdict: businessVerdict("ABC", study, null), filingsFound: 60, acceptanceTimeShare: 1 },
    systematic: { decomposition: decomp, text: systematicVerdict("ABC", decomp, "company-specific", null).text, stability: null },
    macro: { study: macro, kind: "x", text: macroVerdict("ABC", macro, null).text, missingKinds: [] },
    notes: ["A note."],
  };
  const html = renderToStaticMarkup(createElement(NewsImpactView, { data }));
  t("panel render: every bar row shows its n", (html.match(/\(n = \d+\)/g) ?? []).length >= 6, String((html.match(/\(n = \d+\)/g) ?? []).length));
  t("panel render: a type with too few events says so instead of drawing a bar", /Not enough events to say \(need 10\)/.test(html));
  t("panel render: the split bar is labelled with shares that add to 100%", (() => { const m = /Share of ABC&#x27;s daily variance: ([^"]*)\./.exec(html); if (!m) return false; const nums = [...m[1].matchAll(/(\d+)%/g)].map((x) => Number(x[1])); return Math.abs(nums.reduce((a, b) => a + b, 0) - 100) <= 2; })());
  t("panel render: units and the 1x reference are stated, as-of and interval wording present", /dashed line, 1x/.test(html) && /95% range/.test(html) && /1100 daily returns/.test(html) && /Oct 16, 2026/.test(html));
  const thin = { ...data, business: { ...data.business, study: runEventStudy(toSeries(synth(93, 1100, { boost: 3, nEvents: 8 })), evs(synth(93, 1100, { boost: 3, nEvents: 8 })), FILING_TYPES) } };
  thin.business.verdict = businessVerdict("ABC", thin.business.study, null);
  const htmlThin = renderToStaticMarkup(createElement(NewsImpactView, { data: thin }));
  t("panel render: with too few filings the headline row says 'Not enough events to say (need 20)' and no verdict word appears", /Not enough events to say \(need 20\)/.test(htmlThin) && !/much more|somewhat more|No clear difference\. On/.test(htmlThin.split("2. How much")[0]));
  const un = { ...data, business: { study: null, verdict: businessVerdict("ABC", null, "No dated company-type events exist for crypto in this app, so this test does not run."), filingsFound: 0, acceptanceTimeShare: null } };
  t("panel render: when the company test does not run, the reason is shown and no chart is drawn for it", /does not run/.test(renderToStaticMarkup(createElement(NewsImpactView, { data: un })).split("2. How much")[0]) && !/dashed line/.test(renderToStaticMarkup(createElement(NewsImpactView, { data: un })).split("2. How much")[0]));
}

summary();
