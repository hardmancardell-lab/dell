// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/sweep-family.test.mts
// The weekly hypothesis sweep: ONE false-discovery-rate correction over every hypothesis of the run, the family size is
// recorded, and the old post-hoc 60% win-rate filter no longer decides "validated". On pure noise a run should validate
// (almost) nothing; the old design validated about 15 false signals per run (audit 03-lead-quant F3/E5).
import { runHypothesisSweep, finalizeCandidates } from "../../src/lib/agents/trading-agent/skills/hypothesis-sweep.ts";
import { setFakeEnv, install, json, makeT } from "../fixtures/fake-fetch.mts";

const { t, summary } = makeT();
setFakeEnv();
console.warn = () => {};

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

// ------------------------------------------------------------------ 1. the correction itself, on pure-noise p-values
{
  const rand = mulberry32(2026);
  const REPS = 300;
  const FAMILY = 368;
  let validatedTotal = 0;
  let runsWithAny = 0;
  for (let r = 0; r < REPS; r++) {
    const cands = Array.from({ length: FAMILY }, (_, i) => ({
      rawP: rand(),
      ciExcludesZero: true, // worst case: the other two bars agree every time, so only the run-wide FDR protects us
      sameSignOutOfSample: true,
      base: { ticker: "X", assetClass: "equity", strategyType: "s" + i, horizonLabel: "h", entryRule: "e", exitType: "time", exitRule: "x", sampleSize: 50, winRatePct: 75, profitFactor: 2, bootstrapCiLower: 1, bootstrapCiUpper: 2, sourceEngine: "historical-backtest", entropyScore: null, largestLossPct: -3, maxDrawdownPct: 5, stopLossVerdict: null },
    }));
    const rows = finalizeCandidates(cands);
    const v = rows.filter((x) => x.status === "validated").length;
    validatedTotal += v;
    if (v > 0) runsWithAny++;
  }
  const avg = validatedTotal / REPS;
  console.log(`  noise p-values: average validated per run ${avg.toFixed(3)}; runs with any validated ${(100 * runsWithAny / REPS).toFixed(1)}%`);
  t(`pure-noise run of 368 hypotheses validates less than 1 on average (${avg.toFixed(3)}; the old per-5 family gave about 15)`, avg < 1);
  t(`at most about 10% of pure-noise runs validate anything (${(100 * runsWithAny / REPS).toFixed(1)}%)`, runsWithAny / REPS <= 0.1);
}

// ------------------------------------------------------------------ 2. rule details
{
  const base = { ticker: "X", assetClass: "equity", strategyType: "s", horizonLabel: "h", entryRule: "e", exitType: "time", exitRule: "x", sampleSize: 50, winRatePct: 40, profitFactor: 0.9, bootstrapCiLower: 1, bootstrapCiUpper: 2, sourceEngine: "historical-backtest", entropyScore: null, largestLossPct: -3, maxDrawdownPct: 5, stopLossVerdict: null };
  const strong = { rawP: 0.00001, ciExcludesZero: true, sameSignOutOfSample: true, base };
  const rows = finalizeCandidates([strong, { ...strong, rawP: 0.9 }, { ...strong, rawP: null }]);
  t("a strong result with a LOW win rate (40%) is still validated: win rate is descriptive only", rows[0].status === "validated" && rows[0].winRatePct === 40);
  t("a weak p-value is rejected with the family size in the reason", rows[1].status === "rejected" && /3 hypotheses/.test(rows[1].rejectionReason));
  t("a hypothesis with no p-value counts in the family and is rejected", rows[2].status === "rejected" && rows[2].pValueFdr === null);
  t("every row records the family size", rows.every((r) => /Corrected for 3 hypotheses/.test(r.exitRule)));
  const noCi = finalizeCandidates([{ ...strong, ciExcludesZero: false }, { ...strong, sameSignOutOfSample: null }, { ...strong, sameSignOutOfSample: false }]);
  t("a CI that includes zero, or no/negative out-of-sample agreement, is rejected", noCi.every((r) => r.status === "rejected"));
}

// ------------------------------------------------------------------ 3. the real sweep on noise, in-memory ledger, fake provider
{
  const rand = mulberry32(99);
  const randn = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
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
  const ts = weekdays(800);
  const seriesBySymbol = new Map<string, any[]>();
  function series(sym: string) {
    if (!seriesBySymbol.has(sym)) {
      let p = 100;
      seriesBySymbol.set(
        sym,
        ts.map((t0) => {
          const o = p;
          const c = o * (1 + 0.012 * randn());
          p = c;
          return { t: new Date(t0).toISOString(), o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c, v: Math.round(1e6 * Math.exp(0.4 * randn())) };
        })
      );
    }
    return seriesBySymbol.get(sym);
  }
  install((url) => {
    const u = new URL(url);
    if (u.hostname === "data.alpaca.markets") {
      const sym = decodeURIComponent(u.pathname.split("/")[3]);
      if (u.searchParams.get("timeframe") === "1Day") return json({ bars: series(sym), next_page_token: null });
      return json({ bars: [], next_page_token: null }); // minute bars: none, so only the daily-bar signals produce hypotheses
    }
    if (u.hostname === "api-fxtrade.oanda.com") {
      const inst = u.pathname.split("/")[3];
      if (u.searchParams.get("granularity") === "D") {
        return json({ candles: series(inst).map((b) => ({ time: b.t, volume: b.v, complete: true, mid: { o: String(b.o), h: String(b.h), l: String(b.l), c: String(b.c) } })) });
      }
      return json({ candles: [] });
    }
    return json({}, 404);
  });
  const rows: any[] = [];
  const res = await runHypothesisSweep(async (h) => {
    rows.push(h);
  });
  const validated = rows.filter((r) => r.status === "validated").length;
  console.log(`  real sweep on noise: ${rows.length} hypotheses logged, ${validated} validated, ${res.errors.length} engine errors (minute-bar engines have no data in this fake)`);
  t("sweep logs every daily-bar hypothesis: 15 tickers x 4 signals x 5 horizons = 300, plus 5 full-sweep tickers x 5 weekdays = 25", rows.length === 325 && res.hypothesesLogged === 325, String(rows.length));
  t("every row of the run carries the same family size (the run hypothesis count, 325)", rows.every((r) => r.exitRule.includes("Corrected for 325 hypotheses")));
  t("pure-noise sweep validates at most 1 hypothesis (old design: about 15)", validated <= 1, String(validated));
  t("no row was validated because of its win rate", rows.filter((r) => r.status === "validated").every((r) => r.passesThreeBars));
}

summary();
