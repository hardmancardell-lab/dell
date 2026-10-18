// @ts-nocheck
// Offline validation run for the News Impact study (not a unit test: it needs the network).
//   node --env-file=.env.local --import ./scripts/ts-loader/register.mjs scripts/news-impact-validate.mts AAPL:equity NVDA:equity ... > out.txt
//
// Prices: Yahoo's public chart endpoint (adjusted close, split-adjusted volume), because the local Alpaca keys are
// placeholders. Filings: SEC EDGAR through the app's own client (needs SEC_EDGAR_USER_AGENT). Release dates: FRED through the
// app's FRED key (if it is a placeholder, CPI and jobs are skipped and the run says so). Nothing here prints a key.
// Output: one JSON blob per ticker in the scratchpad folder (arg OUT=...), plus a compact summary on stdout.
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { analyzeNewsImpact } from "../src/lib/news-impact/analyze.ts";
import { factorPlanFor } from "../src/lib/news-impact/factors.ts";
import { alignReturns } from "../src/lib/news-impact/returns.ts";
import { scoreRolling, logVolumeRatio } from "../src/lib/news-impact/market-model.ts";
import { filingsToEvents } from "../src/lib/news-impact/filing-events.ts";
import { runMacroStudy, MACRO_KINDS } from "../src/lib/news-impact/macro-study.ts";
import { placeboTest, powerTest } from "../src/lib/news-impact/placebo.ts";
import { mapEvents } from "../src/lib/news-impact/event-study.ts";
import { mulberry32 } from "../src/lib/agents/trading-agent/skills/stats-tests.ts";
import { fetchFilingHistory, releaseDates } from "../src/lib/news-impact/data.ts";
import { FOMC_DECISION_DATES_EXTENDED } from "../src/lib/agents/trading-agent/skills/fomc-week-variance-study.ts";

const OUT = process.env.OUT ?? ".";
mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const DAYS = 1850;
const since = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10);
const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

async function yahooBars(sym: string) {
  const cache = `${OUT}/yahoo_${sym.replace(/[^A-Za-z0-9]/g, "_")}.json`;
  let j;
  if (existsSync(cache)) j = JSON.parse(readFileSync(cache, "utf8"));
  else {
    const p2 = Math.floor(Date.now() / 1000);
    const p1 = p2 - DAYS * 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplits`;
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (!res.ok) throw new Error(`Yahoo ${sym}: ${res.status}`);
    j = await res.json();
    writeFileSync(cache, JSON.stringify(j));
    await new Promise((r) => setTimeout(r, 400));
  }
  const r = j.chart.result[0];
  const ts = r.timestamp;
  const q = r.indicators.quote[0];
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const utcDate = /-USD$|=X$/.test(sym);
  // split-adjust volume: multiply by the product of later split ratios
  const splits = Object.values(r.events?.splits ?? {}).map((s: any) => ({ t: s.date, f: s.numerator / s.denominator }));
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const close = adj ? adj[i] : q.close[i];
    if (!(close > 0)) continue;
    const date = utcDate ? new Date(ts[i] * 1000).toISOString().slice(0, 10) : ET.format(new Date(ts[i] * 1000));
    let vol = q.volume[i] ?? 0;
    for (const s of splits) if (s.t > ts[i]) vol *= s.f;
    bars.push({ date, close, volume: vol });
  }
  return bars;
}

const args = process.argv.slice(2).filter((a) => /^[^=]+:[a-z]+$/.test(a));
const tickers = args.map((a) => { const [symbol, assetClass] = a.split(":"); return { symbol, assetClass }; });

// macro dates (once)
let cpi = null, jobs = null;
cpi = await releaseDates("cpi", since); jobs = await releaseDates("jobs", since);
const fomc = FOMC_DECISION_DATES_EXTENDED.filter((d) => d >= since);
console.log(`macro dates since ${since}: FOMC ${fomc.length}, CPI ${cpi ? cpi.length : "n/a"}, jobs ${jobs ? jobs.length : "n/a"}`);

const toYahoo = (sym: string, cls: string) => (cls === "forex" ? sym.replace("/", "") + "=X" : sym);
const summary = [];
for (const { symbol, assetClass } of tickers) {
  const plan = factorPlanFor(symbol, assetClass);
  const asset = await yahooBars(toYahoo(symbol, assetClass));
  const factorBars = {};
  for (const f of plan.factors) factorBars[f.symbol] = await yahooBars(f.symbol);
  let filings = null;
  if (plan.hasOwnEvents) { try { filings = await fetchFilingHistory(symbol, since); } catch (e) { console.log(symbol, "filings failed:", String(e.message).slice(0, 120)); } }
  const asOf = new Date().toISOString();
  const res = analyzeNewsImpact({ symbol, assetClass, asOf, assetBars: asset, factorBars, filings: plan.hasOwnEvents ? filings : [], macroDates: { fomc, cpi, jobs }, loadNotes: ["Validation run on Yahoo prices."] });

  // series for the placebo
  const loaded = plan.factors.filter((f) => factorBars[f.symbol]);
  const al = alignReturns(asset, loaded.map((f) => factorBars[f.symbol]));
  const out = { symbol, assetClass, result: res, placebo: {}, power: null };
  if (loaded.length && res.business.study) {
    const roll = scoreRolling(al.ret, al.factorRet[0]);
    const series = { dates: al.dates, ar: roll.ar, sd: roll.sd, sar: roll.sar, volLog: logVolumeRatio(al.volume) };
    const events = filingsToEvents(filings);
    out.placebo.random = placeboTest(series, events, { runs: 200, kind: "random", seed: 1018 });
    out.placebo.shifted = placeboTest(series, events, { runs: 200, kind: "shifted", seed: 2018 });
    out.power = powerTest(series, events, [1, 1.25, 1.5, 2], { runs: 150, seed: 99 });
  }
  // macro placebo: fake dates (same count) on non-macro days, real macro days kept out of the baseline
  const macroEvents = [];
  for (const k of MACRO_KINDS) for (const d of ({ fomc, cpi, jobs })[k.id] ?? []) macroEvents.push({ date: d, type: k.id, label: k.label });
  if (macroEvents.length >= 20) {
    const realIdx = new Set(mapEvents(al.dates, macroEvents, ["fomc", "cpi", "jobs"], 4).map((m) => m.idx));
    const cand = []; for (let i = 0; i < al.dates.length; i++) if (!realIdx.has(i)) cand.push(i);
    const rand = mulberry32(555); let fp = 0, valid = 0;
    for (let r = 0; r < 200; r++) {
      const pool = cand.slice(); const pick = [];
      for (let k = 0; k < realIdx.size; k++) { const j = k + Math.floor(rand() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; pick.push(pool[k]); }
      const fake = pick.map((i) => ({ date: al.dates[i], type: "fomc", label: "x" }));
      const real = [...realIdx].map((i) => ({ date: al.dates[i], type: "real", label: "r" }));
      const m = runMacroStudy(al.dates, al.ret, [...fake, ...real], [{ id: "fomc", label: "x" }, { id: "real", label: "r" }], { skipCi: true, pooledOnly: false });
      const g = m.groups.find((x) => x.id === "fomc");
      if (g.test.p !== null) { valid++; if (g.test.p < 0.05) fp++; }
    }
    out.placebo.macro = { runs: 200, valid, falsePass: valid ? fp / valid : null, nFake: realIdx.size };
  }
  writeFileSync(`${OUT}/impact_${symbol.replace(/[^A-Za-z0-9]/g, "_")}.json`, JSON.stringify(out, null, 1));
  const s = res.business.study;
  summary.push({
    symbol, cls: assetClass, returns: res.sample.returns, from: res.sample.from, to: res.sample.to,
    filings: res.business.filingsFound, businessN: s ? s.pooled.day0.n : null, effect: s ? s.effect : "n/a",
    ratio: s ? s.pooled.day0.ratio : null, lo: s ? s.pooled.day0.ratioLo : null, hi: s ? s.pooled.day0.ratioHi : null, pAdj: s ? s.pooled.day0.pAdj : null,
    systematic: res.systematic.decomposition ? res.systematic.decomposition.systematicShare : null,
    stable: res.systematic.decomposition ? res.systematic.decomposition.stable : null,
    macro: res.macro.study ? { n: res.macro.study.pooled.nEvents, ratio: res.macro.study.pooled.test.ratio, lo: res.macro.study.pooled.test.ratioLo, hi: res.macro.study.pooled.test.ratioHi, pAdj: res.macro.study.pooled.test.pAdj } : null,
    placeboRandom: out.placebo.random?.falsePass.day0 ?? null, placeboShifted: out.placebo.shifted?.falsePass.day0 ?? null, placeboMacro: out.placebo.macro?.falsePass ?? null,
  });
  console.log(JSON.stringify(summary[summary.length - 1]));
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 1));
