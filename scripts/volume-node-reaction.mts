// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/volume-node-reaction.mts
//
// Does price react at the prior session's volume-profile nodes, and is that different from a random level?
// PRE-REGISTERED (written before any result was seen; not tuned afterwards):
//
//   Data      Yahoo 5-minute bars, range=60d, regular session 9:30-16:00 ET (Yahoo volume is roughly 78% of consolidated).
//   Symbols   SPY QQQ NVDA DELL AAPL MSFT AMD TSLA
//   Levels    For session D-1 only (regular hours, only that session's bars, no look-ahead): POC, VAH, VAL, HVN, LVN from
//             buildProfile() with its defaults (60 bins, uniform volume spread, 1-bin Gaussian smoothing, 15% prominence).
//             Groups: POC | VA (VAH and VAL together) | HVN | LVN.
//   Touch     Walk session D's bars. The FIRST touch of each level is the first bar, from the 9:45 bar on (first 15 minutes
//             skipped), whose low..high contains the level. Arrival side = sign(previous bar's close - level); if that is
//             exactly zero, the touch bar's open; if still zero the touch is dropped. A touch needs 6 full bars after it.
//   Outcome   X = 0.25 x the average 30-minute range of session D-1 (mean over its 30-minute buckets of high-low).
//             Over the 6 bars (30 minutes) AFTER the touch bar: REJECT = price gets X away from the level on the side it
//             came from before it gets X through the level; BREAK = the reverse; NEITHER = neither within 30 minutes. A bar
//             that reaches both thresholds is AMBIGUOUS (order inside a bar is unknown) and counted as not-reject, the
//             conservative choice. Signed excursion = (close of the 6th bar - level) x arrival side / X: positive means price
//             ended the window on the side it came from.
//   Control   For every real level, one uniformly random level inside session D-1's low..high (same count per group, seeded
//             RNG), with exactly the same touch and outcome rules.
//   Tests     (1) naive: touch labels (real/control) shuffled, 10,000 permutations. (2) cluster: touches on one symbol-day
//             are not independent, so each symbol-day's real and control touch sets are swapped as a block with probability
//             1/2, 10,000 permutations; this is the headline p. Both two-sided on the difference in reject rate.
//   Also      One touch per group per symbol-day (the earliest) with its own cluster test, and counts of independent days.
//
// Nothing here includes costs or an entry rule; it measures reaction only.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { buildProfile, listLevels } from "../src/lib/agents/trading-agent/skills/anchored-volume-profile.ts";
import { toEasternParts, WINDOWS, isWithin } from "../src/lib/agents/trading-agent/skills/time-windows.ts";

const SYMBOLS = ["SPY", "QQQ", "NVDA", "DELL", "AAPL", "MSFT", "AMD", "TSLA"];
const SCRATCH = "C:\\Users\\crdll\\AppData\\Local\\Temp\\claude\\C--Users-crdll--claude\\9b38854b-3055-431d-8794-f3a96c713698\\scratchpad";
const OUT = `${SCRATCH}\\node_reaction_results.json`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PARAMS = {
  skipFirstBars: 3, // 15 minutes
  outcomeBars: 6, // 30 minutes
  xFractionOfAvg30mRange: 0.25,
  minBarsPerSession: 70,
  permutations: 10000,
  seed: 20261015,
  groups: ["POC", "VA", "HVN", "LVN"],
};
const GROUP_OF = { POC: "POC", VAH: "VA", VAL: "VA", HVN: "HVN", LVN: "LVN" };

// ------------------------------------------------------------------ rng, stats
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wilson(k: number, n: number) {
  if (n === 0) return [null, null];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ------------------------------------------------------------------ data
async function loadBars(sym: string) {
  const cache = `${SCRATCH}\\yahoo_5m_${sym}.json`;
  let json;
  if (existsSync(cache) && process.env.REFETCH !== "1") {
    json = JSON.parse(readFileSync(cache, "utf8"));
  } else {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=60d&interval=5m`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Yahoo ${sym}: ${res.status}`);
    json = await res.json();
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(cache, JSON.stringify(json));
  }
  const r = json.chart.result[0];
  const q = r.indicators.quote[0];
  const bars = [];
  r.timestamp.forEach((ts: number, i: number) => {
    if ([q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i]].some((v) => v === null || v === undefined)) return;
    bars.push({ datetime: ts * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] });
  });
  return bars;
}

function sessionsOf(bars) {
  const m = new Map();
  for (const b of bars.sort((a, b) => a.datetime - b.datetime)) {
    const p = toEasternParts(b.datetime);
    if (!isWithin(p.minutesSinceMidnight, WINDOWS.REGULAR_SESSION)) continue;
    if (!m.has(p.dateKey)) m.set(p.dateKey, []);
    m.get(p.dateKey).push(b);
  }
  return [...m.entries()].filter(([, v]) => v.length >= PARAMS.minBarsPerSession).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Average 30-minute high-low range of a session (buckets of 6 bars from the open). */
function avg30mRange(bars) {
  const buckets = new Map();
  for (const b of bars) {
    const p = toEasternParts(b.datetime);
    const k = Math.floor((p.minutesSinceMidnight - 570) / 30);
    const cur = buckets.get(k);
    if (!cur) buckets.set(k, { hi: b.high, lo: b.low });
    else {
      cur.hi = Math.max(cur.hi, b.high);
      cur.lo = Math.min(cur.lo, b.low);
    }
  }
  return mean([...buckets.values()].map((v) => v.hi - v.lo));
}

/** First touch of `level` in the next session and its 30-minute outcome, or null. */
function firstTouch(next, level: number, X: number) {
  for (let i = PARAMS.skipFirstBars; i < next.length; i++) {
    const b = next[i];
    if (!(b.low <= level && level <= b.high)) continue;
    let side = Math.sign(next[i - 1].close - level);
    if (side === 0) side = Math.sign(b.open - level);
    if (side === 0) return { dropped: "no-side" };
    if (i + PARAMS.outcomeBars >= next.length) return { dropped: "window-cut" };
    let outcome = "neither";
    for (let j = i + 1; j <= i + PARAMS.outcomeBars; j++) {
      const w = next[j];
      const away = side > 0 ? w.high >= level + X : w.low <= level - X;
      const through = side > 0 ? w.low <= level - X : w.high >= level + X;
      if (away && through) { outcome = "ambiguous"; break; }
      if (away) { outcome = "reject"; break; }
      if (through) { outcome = "break"; break; }
    }
    const last = next[i + PARAMS.outcomeBars];
    return { barIndex: i, minute: toEasternParts(b.datetime).minutesSinceMidnight, side, outcome, reject: outcome === "reject", excursionX: ((last.close - level) * side) / X, excursionPct: (((last.close - level) * side) / level) * 100 };
  }
  return { dropped: "untouched" };
}

// ------------------------------------------------------------------ collect touches
const touches = []; // {sym, day, group, kind: real|control, reject, outcome, excursionX, excursionPct, type, minute}
const meta = { perSymbol: {}, levelCounts: {}, dropped: { real: {}, control: {} } };
const rng = mulberry32(PARAMS.seed);

for (const sym of SYMBOLS) {
  const sessions = sessionsOf(await loadBars(sym));
  meta.perSymbol[sym] = { sessions: sessions.length, first: sessions[0]?.[0], last: sessions[sessions.length - 1]?.[0], pairs: 0 };
  for (let s = 1; s < sessions.length; s++) {
    const [prevDay, prev] = sessions[s - 1];
    const [day, next] = sessions[s];
    // consecutive trading sessions only (a gap over 5 calendar days means missing data)
    if ((Date.parse(day) - Date.parse(prevDay)) / 86400000 > 5) continue;
    const X = PARAMS.xFractionOfAvg30mRange * avg30mRange(prev);
    if (!(X > 0)) continue;
    meta.perSymbol[sym].pairs++;
    const profile = buildProfile(prev);
    const levels = listLevels(profile);
    const pLow = Math.min(...prev.map((b) => b.low));
    const pHigh = Math.max(...prev.map((b) => b.high));
    for (const lv of levels) {
      const group = GROUP_OF[lv.type];
      meta.levelCounts[lv.type] = (meta.levelCounts[lv.type] ?? 0) + 1;
      for (const kind of ["real", "control"]) {
        const price = kind === "real" ? lv.price : pLow + rng() * (pHigh - pLow);
        const t = firstTouch(next, price, X);
        if (t.dropped) {
          meta.dropped[kind][t.dropped] = (meta.dropped[kind][t.dropped] ?? 0) + 1;
          continue;
        }
        touches.push({ sym, day, group, kind, type: lv.type, ...t });
      }
    }
  }
}

// ------------------------------------------------------------------ summaries and tests
function rate(rows) {
  const n = rows.length, k = rows.filter((r) => r.reject).length;
  const [lo, hi] = wilson(k, n);
  return { n, k, rate: n ? k / n : null, lo, hi, meanExcursionX: mean(rows.map((r) => r.excursionX)), meanExcursionPct: mean(rows.map((r) => r.excursionPct)), breakRate: n ? rows.filter((r) => r.outcome === "break").length / n : null, ambiguous: rows.filter((r) => r.outcome === "ambiguous").length };
}

/** Naive permutation: shuffle real/control labels across touches. Two-sided on the difference in reject rate. */
function naivePerm(real, ctl, seed) {
  if (!real.length || !ctl.length) return null;
  const r = mulberry32(seed);
  const all = [...real, ...ctl].map((x) => (x.reject ? 1 : 0));
  const nR = real.length;
  const obs = real.filter((x) => x.reject).length / nR - ctl.filter((x) => x.reject).length / ctl.length;
  let ge = 0;
  const idx = all.map((_, i) => i);
  for (let b = 0; b < PARAMS.permutations; b++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    let kr = 0;
    for (let i = 0; i < nR; i++) kr += all[idx[i]];
    let kc = 0;
    for (let i = nR; i < all.length; i++) kc += all[idx[i]];
    const d = kr / nR - kc / (all.length - nR);
    if (Math.abs(d) >= Math.abs(obs) - 1e-12) ge++;
  }
  return (1 + ge) / (1 + PARAMS.permutations);
}

/** Cluster permutation: each symbol-day's real and control touch sets are swapped as a block with probability 1/2. */
function clusterPerm(real, ctl, seed) {
  if (!real.length || !ctl.length) return null;
  const r = mulberry32(seed);
  const days = new Map();
  const slot = (key) => { if (!days.has(key)) days.set(key, { rk: 0, rn: 0, ck: 0, cn: 0 }); return days.get(key); };
  for (const x of real) { const d = slot(x.sym + x.day); d.rn++; d.rk += x.reject ? 1 : 0; }
  for (const x of ctl) { const d = slot(x.sym + x.day); d.cn++; d.ck += x.reject ? 1 : 0; }
  const list = [...days.values()];
  const stat = (swap) => {
    let rk = 0, rn = 0, ck = 0, cn = 0;
    list.forEach((d, i) => { if (swap[i]) { rk += d.ck; rn += d.cn; ck += d.rk; cn += d.rn; } else { rk += d.rk; rn += d.rn; ck += d.ck; cn += d.cn; } });
    return rn && cn ? rk / rn - ck / cn : 0;
  };
  const obs = stat(list.map(() => false));
  let ge = 0;
  const swap = new Array(list.length).fill(false);
  for (let b = 0; b < PARAMS.permutations; b++) {
    for (let i = 0; i < list.length; i++) swap[i] = r() < 0.5;
    if (Math.abs(stat(swap)) >= Math.abs(obs) - 1e-12) ge++;
  }
  return { p: (1 + ge) / (1 + PARAMS.permutations), days: list.length };
}

/** Earliest touch per group per symbol-day. */
function onePerDay(rows) {
  const best = new Map();
  for (const x of rows) {
    const key = x.sym + x.day + x.group;
    if (!best.has(key) || x.barIndex < best.get(key).barIndex) best.set(key, x);
  }
  return [...best.values()];
}

function analyse(subset, label, seedBase) {
  const out = { label, groups: {} };
  const gs = [...PARAMS.groups];
  gs.forEach((g, gi) => {
    const real = subset.filter((x) => x.kind === "real" && x.group === g);
    const ctl = subset.filter((x) => x.kind === "control" && x.group === g);
    const R = rate(real), Cn = rate(ctl);
    const real1 = onePerDay(real), ctl1 = onePerDay(ctl);
    const R1 = rate(real1), C1 = rate(ctl1);
    const cl = clusterPerm(real, ctl, seedBase + gi * 7 + 1);
    const cl1 = clusterPerm(real1, ctl1, seedBase + gi * 7 + 2);
    out.groups[g] = {
      real: R, control: Cn,
      diff: R.rate !== null && Cn.rate !== null ? R.rate - Cn.rate : null,
      pNaive: naivePerm(real, ctl, seedBase + gi * 7 + 3),
      pCluster: cl?.p ?? null,
      symbolDays: cl?.days ?? 0,
      onePerDay: { real: R1, control: C1, diff: R1.rate !== null && C1.rate !== null ? R1.rate - C1.rate : null, pCluster: cl1?.p ?? null, symbolDays: cl1?.days ?? 0 },
    };
  });
  const realAll = subset.filter((x) => x.kind === "real"), ctlAll = subset.filter((x) => x.kind === "control");
  const cl = clusterPerm(realAll, ctlAll, seedBase + 99);
  out.allLevels = { real: rate(realAll), control: rate(ctlAll), pNaive: naivePerm(realAll, ctlAll, seedBase + 98), pCluster: cl?.p ?? null, symbolDays: cl?.days ?? 0 };
  out.distinctDates = new Set(subset.map((x) => x.day)).size;
  return out;
}

const results = { params: PARAMS, generatedAt: new Date().toISOString(), meta, pooled: analyse(touches, "pooled", 1000), perSymbol: {} };
SYMBOLS.forEach((s, i) => { results.perSymbol[s] = analyse(touches.filter((x) => x.sym === s), s, 5000 + i * 100); });
mkdirSync(SCRATCH, { recursive: true });
writeFileSync(OUT, JSON.stringify(results, null, 1));

// ------------------------------------------------------------------ print
const pc = (v) => (v === null || v === undefined ? "  n/a" : (v * 100).toFixed(1).padStart(5) + "%");
const ci = (r) => (r.n ? `[${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}]` : "[-]");
const pv = (p) => (p === null || p === undefined ? "  n/a" : p.toFixed(3));
function table(a) {
  console.log(`\n== ${a.label} (${a.distinctDates} distinct dates) ==`);
  console.log("group   | real n   rej%  95% Wilson   excX   | ctrl n  rej%  95% Wilson   excX   | diff     p_naive p_clust | 1/day: real n ctrl n  real% ctrl%  p_clust | symbol-days");
  for (const g of [...PARAMS.groups]) {
    const x = a.groups[g];
    const f = (r) => `${String(r.n).padStart(5)} ${pc(r.rate)} ${ci(r).padEnd(10)} ${r.meanExcursionX === null ? "  n/a" : r.meanExcursionX.toFixed(2).padStart(5)}`;
    const d = x.diff === null ? "  n/a" : ((x.diff >= 0 ? "+" : "") + (x.diff * 100).toFixed(1)).padStart(6) + "pp";
    console.log(`${g.padEnd(7)} | ${f(x.real)} | ${f(x.control)} | ${d} ${pv(x.pNaive).padStart(8)} ${pv(x.pCluster).padStart(7)} | ${String(x.onePerDay.real.n).padStart(6)} ${String(x.onePerDay.control.n).padStart(6)} ${pc(x.onePerDay.real.rate)} ${pc(x.onePerDay.control.rate)} ${pv(x.onePerDay.pCluster).padStart(7)} | ${x.symbolDays}`);
  }
  const al = a.allLevels;
  console.log(`ALL     | ${String(al.real.n).padStart(5)} ${pc(al.real.rate)} ${ci(al.real).padEnd(10)} ${al.real.meanExcursionX?.toFixed(2).padStart(5)} | ${String(al.control.n).padStart(5)} ${pc(al.control.rate)} ${ci(al.control).padEnd(10)} ${al.control.meanExcursionX?.toFixed(2).padStart(5)} |  p_naive ${pv(al.pNaive)} p_clust ${pv(al.pCluster)} | ${al.symbolDays}`);
}
console.log("Parameters:", JSON.stringify(PARAMS));
console.log("Sessions:", JSON.stringify(meta.perSymbol));
console.log("Levels listed by type (all pairs):", JSON.stringify(meta.levelCounts));
console.log("Dropped real:", JSON.stringify(meta.dropped.real), " control:", JSON.stringify(meta.dropped.control));
table(results.pooled);
for (const s of SYMBOLS) table(results.perSymbol[s]);
console.log("\nSaved", OUT);
