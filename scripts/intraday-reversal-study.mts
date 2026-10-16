// @ts-nocheck
// Intraday timing of session highs/lows (Study A) and key-reversal predictiveness (Study B). Price only.
// Run: node --import ./scripts/ts-loader/register.mjs scripts/intraday-reversal-study.mts
// Definitions are fixed in INTRADAY_REVERSAL_STUDY_NOTES.md (written before any result was looked at).
// Data: Yahoo 5-minute bars (range=60d), regular session 9:30-16:00 ET, cached to the scratchpad so reruns are offline
// (REFETCH=1 forces a fresh download). No app code, no database, no network except Yahoo.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { toEasternParts } from "../src/lib/agents/trading-agent/skills/time-windows.ts";
import * as D from "./intraday-reversal-detect.mts";

const SCRATCH = "C:\\Users\\crdll\\AppData\\Local\\Temp\\claude\\C--Users-crdll--claude\\9b38854b-3055-431d-8794-f3a96c713698\\scratchpad";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAIN = ["SPY", "QQQ", "NVDA", "DELL", "GLD"];
const EXTRA = ["AAPL", "MSFT", "AMD", "TSLA"];
const SYMBOLS = [...MAIN, ...EXTRA];
const P = {
  minBars: 70,
  nShuffles: 10000, // Study A null
  seedA: 20261015,
  nPerm: 10000, // Study B permutation tests
  nBoot: 5000, // Study B date-cluster bootstrap
  seedPerm: 7001,
  seedBoot: 7002,
  seedCtl2: 7003,
  bonferroniBuckets: 13,
  costBp: { SPY: 1, other: 3 },
};
const HORIZONS = ["ret15m", "ret30m", "ret60m", "retClose"];
const HLABEL = { ret15m: "15m", ret30m: "30m", ret60m: "60m", retClose: "to close" };
const NB = 13;

// ------------------------------------------------------------------ utilities
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function wilson(k: number, n: number): [number, number] | null {
  if (n === 0) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x: number, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%");
const num = (x: number, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(d));
const fmtP = (p: number) => (p === null || p === undefined ? "n/a" : p < 0.001 ? "<0.001" : p.toFixed(3));
const wil = (k: number, n: number) => { const w = wilson(k, n); return w ? `${pct(w[0], 0)}-${pct(w[1], 0)}` : "n/a"; };
function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function benjaminiHochberg(ps: number[]) {
  const m = ps.length, idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) { prev = Math.min(prev, (idx[r][0] * m) / (r + 1)); adj[idx[r][1]] = prev; }
  return adj;
}
const bucketLabel = (k: number) => { const m = 570 + 30 * k; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; };

// ------------------------------------------------------------------ data
async function loadRaw(sym: string) {
  const cache = `${SCRATCH}\\intraday_reversal_yahoo_5m_${sym}.json`;
  let json;
  if (existsSync(cache) && process.env.REFETCH !== "1") json = JSON.parse(readFileSync(cache, "utf8"));
  else {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=60d&interval=5m`;
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Yahoo ${sym}: ${res.status}`);
    json = await res.json();
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(cache, JSON.stringify(json));
  }
  const r = json.chart.result[0], q = r.indicators.quote[0];
  const out = [];
  r.timestamp.forEach((ts: number, i: number) => {
    if ([q.open[i], q.high[i], q.low[i], q.close[i]].some((v) => v === null || v === undefined)) return;
    out.push({ ts: ts * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] ?? 0 });
  });
  return out;
}

function buildSessions(raw) {
  const byDate = new Map();
  const seen = new Set();
  for (const b of raw.slice().sort((a, b) => a.ts - b.ts)) {
    if (seen.has(b.ts)) continue;
    seen.add(b.ts);
    const p = toEasternParts(b.ts);
    if (p.minutesSinceMidnight < D.KR.sessionOpenMinute || p.minutesSinceMidnight >= D.KR.sessionEndMinute) continue;
    if (!byDate.has(p.dateKey)) byDate.set(p.dateKey, []);
    byDate.get(p.dateKey).push({ minute: p.minutesSinceMidnight, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
  }
  const kept = [], dropped = { short: 0, lateOpen: 0, incomplete: 0 };
  for (const [date, bars] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (bars.length < P.minBars) { dropped.short++; continue; }
    if (bars[0].minute !== D.KR.sessionOpenMinute) { dropped.lateOpen++; continue; }
    if (bars[bars.length - 1].minute < D.KR.sessionEndMinute - 5) { dropped.incomplete++; continue; }
    kept.push({ date, bars });
  }
  return { sessions: kept, dropped };
}

// ------------------------------------------------------------------ Study A
function studyA(all) {
  const B = P.nShuffles;
  const rng = mulberry32(P.seedA);
  // per session: observed high/low bucket, null high/low bucket for each shuffle
  const recs = [];
  for (const { sym, date, bars } of all) {
    const n = bars.length;
    let hi = 0, lo = 0;
    for (let i = 1; i < n; i++) { if (bars[i].high > bars[hi].high) hi = i; if (bars[i].low < bars[lo].low) lo = i; }
    // each bar as a unit: close/open, high/open, low/open (relative to its own open), chained close -> next open
    const a = new Float64Array(n), hh = new Float64Array(n), ll = new Float64Array(n), slotBucket = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      a[i] = bars[i].close / bars[i].open; hh[i] = bars[i].high / bars[i].open; ll[i] = bars[i].low / bars[i].open;
      slotBucket[i] = D.bucketOf(bars[i].minute);
    }
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const nh = new Uint8Array(B), nl = new Uint8Array(B);
    for (let b = 0; b < B; b++) {
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      let s = 1, maxH = -Infinity, minL = Infinity, ih = 0, il = 0;
      for (let i = 0; i < n; i++) {
        const u = order[i];
        const h = s * hh[u], l = s * ll[u];
        if (h > maxH) { maxH = h; ih = i; }
        if (l < minL) { minL = l; il = i; }
        s *= a[u];
      }
      nh[b] = slotBucket[ih]; nl[b] = slotBucket[il];
    }
    // SUPPLEMENTARY null (added alongside, not replacing the pre-registered shuffle): keep every bar in its own time slot with its own
    // size, but flip each bar's direction at random. This keeps the time-of-day pattern of volatility and removes direction timing.
    const nhS = new Uint8Array(B), nlS = new Uint8Array(B);
    for (let b = 0; b < B; b++) {
      let s = 1, maxH = -Infinity, minL = Infinity, ih = 0, il = 0;
      for (let i = 0; i < n; i++) {
        const flip = rng() < 0.5;
        const h = s * (flip ? 1 / ll[i] : hh[i]), l = s * (flip ? 1 / hh[i] : ll[i]);
        if (h > maxH) { maxH = h; ih = i; }
        if (l < minL) { minL = l; il = i; }
        s *= flip ? 1 / a[i] : a[i];
      }
      nhS[b] = slotBucket[ih]; nlS[b] = slotBucket[il];
    }
    recs.push({ sym, date, obsHigh: D.bucketOf(bars[hi].minute), obsLow: D.bucketOf(bars[lo].minute), nh, nl, nhS, nlS });
  }

  function groupStats(rs, side, suffix = "") {
    const nS = rs.length;
    const obsKey = side === "high" ? "obsHigh" : "obsLow", nullKey = (side === "high" ? "nh" : "nl") + suffix;
    const O = new Array(NB).fill(0);
    for (const r of rs) O[r[obsKey]]++;
    // null counts per replicate
    const counts = Array.from({ length: B }, () => new Int32Array(NB));
    for (const r of rs) { const arr = r[nullKey]; for (let b = 0; b < B; b++) counts[b][arr[b]]++; }
    const E = new Array(NB).fill(0);
    for (let b = 0; b < B; b++) for (let k = 0; k < NB; k++) E[k] += counts[b][k] / B;
    const chi = (c) => { let s = 0; for (let k = 0; k < NB; k++) s += ((c[k] - E[k]) ** 2) / E[k]; return s; };
    const obsChi = chi(O);
    let ge = 0;
    for (let b = 0; b < B; b++) if (chi(counts[b]) >= obsChi) ge++;
    const buckets = [];
    for (let k = 0; k < NB; k++) {
      let geK = 0, leK = 0;
      const col = new Float64Array(B);
      for (let b = 0; b < B; b++) { const v = counts[b][k]; col[b] = v; if (v >= O[k]) geK++; if (v <= O[k]) leK++; }
      const sorted = Array.from(col).sort((x, y) => x - y);
      const pOver = (1 + geK) / (B + 1), pUnder = (1 + leK) / (B + 1);
      const w = wilson(O[k], nS);
      const bonf = 0.05 / P.bonferroniBuckets;
      buckets.push({
        bucket: k, label: bucketLabel(k), obs: O[k], obsShare: O[k] / nS, wilson: w,
        nullExpected: E[k], nullShare: E[k] / nS, nullLo: sorted[Math.floor(0.025 * B)] / nS, nullHi: sorted[Math.floor(0.975 * B)] / nS,
        excessPP: (O[k] - E[k]) / nS, pOver, pUnder,
        flag: pOver <= bonf ? "OVER" : pUnder <= bonf ? "UNDER" : "",
      });
    }
    // edges: first 30 min (bucket 0) or last 30 min (bucket 12)
    const edgeObs = O[0] + O[NB - 1];
    const edgeNull = Array.from({ length: B }, (_, b) => counts[b][0] + counts[b][NB - 1]).sort((x, y) => x - y);
    const edgeGe = edgeNull.filter((v) => v >= edgeObs).length;
    return {
      nSessions: nS, chi: obsChi, chiP: (1 + ge) / (B + 1), buckets,
      edge: { obs: edgeObs, obsShare: edgeObs / nS, wilson: wilson(edgeObs, nS), nullShare: edgeNull.reduce((a, b) => a + b, 0) / B / nS, nullLo: edgeNull[Math.floor(0.025 * B)] / nS, nullHi: edgeNull[Math.floor(0.975 * B)] / nS, pOver: (1 + edgeGe) / (B + 1) },
      first30: { obs: O[0], obsShare: O[0] / nS, nullShare: E[0] / nS }, last30: { obs: O[NB - 1], obsShare: O[NB - 1] / nS, nullShare: E[NB - 1] / nS },
    };
  }

  // either extreme (high OR low) in the first or last 30 minutes, per group
  function eitherEdge(rs) {
    const nS = rs.length;
    const edge = (k: number) => k === 0 || k === NB - 1;
    const obs = rs.filter((r) => edge(r.obsHigh) || edge(r.obsLow)).length;
    const nullCounts = new Int32Array(B);
    for (const r of rs) for (let b = 0; b < B; b++) if (edge(r.nh[b]) || edge(r.nl[b])) nullCounts[b]++;
    const sorted = Array.from(nullCounts).sort((x, y) => x - y);
    const ge = sorted.filter((v) => v >= obs).length;
    return { obs, n: nS, obsShare: obs / nS, wilson: wilson(obs, nS), nullShare: sorted.reduce((a, b) => a + b, 0) / B / nS, nullLo: sorted[Math.floor(0.025 * B)] / nS, nullHi: sorted[Math.floor(0.975 * B)] / nS, pOver: (1 + ge) / (B + 1) };
  }

  const groups = {};
  const defs = [...SYMBOLS.map((s) => [s, recs.filter((r) => r.sym === s)]), ["POOLED9", recs]];
  for (const [name, rs] of defs) {
    groups[name] = { nSessions: rs.length, high: groupStats(rs, "high"), low: groupStats(rs, "low"), eitherEdge: eitherEdge(rs), supplementSignFlip: { high: groupStats(rs, "high", "S"), low: groupStats(rs, "low", "S") } };
    console.log(`Study A ${name}: ${rs.length} sessions, chi p high=${groups[name].high.chiP.toFixed(4)} low=${groups[name].low.chiP.toFixed(4)}`);
  }
  return groups;
}

// ------------------------------------------------------------------ Study B
function buildRows(all) {
  // one row per evaluated bar per direction, with outcome labels; kind = reversal | fresh | plain
  const rows = [];
  for (const { sym, date, bars } of all) {
    for (let t = 1; t < bars.length; t++) {
      if (!D.inEvalWindow(bars, t)) continue;
      for (const dir of ["high", "low"]) {
        const fresh = D.isFreshExtreme(bars, t, dir);
        const kind = fresh ? (D.isKeyReversal(bars, t, dir) ? "reversal" : "fresh") : "plain";
        const o = D.outcomeAt(bars, t, dir);
        rows.push({ sym, date, t, minute: bars[t].minute, bucket: D.bucketOf(bars[t].minute), dir, kind, o });
      }
    }
  }
  return rows;
}

function sampleControl2(rows) {
  const rng = mulberry32(P.seedCtl2);
  const cells = new Map();
  for (const r of rows) {
    const key = `${r.sym}|${r.dir}|${r.bucket}`;
    if (!cells.has(key)) cells.set(key, { rev: 0, pool: [] });
    const c = cells.get(key);
    if (r.kind === "reversal") c.rev++; else c.pool.push(r);
  }
  const out = [];
  let shortage = 0;
  for (const [, c] of [...cells.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const k = Math.min(c.rev, c.pool.length);
    if (c.rev > c.pool.length) shortage += c.rev - c.pool.length;
    const pool = c.pool.slice();
    for (let i = 0; i < k; i++) { const j = i + Math.floor(rng() * (pool.length - i)); const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; out.push(pool[i]); }
  }
  return { rows: out, shortage };
}

/**
 * Compare reversal rows with control rows on one outcome.
 * Statistic: stratified (symbol x direction x time bucket) mean difference, weighted by the number of reversal events per cell
 * (so the control is re-weighted to the reversals' time-of-day mix). Permutation: shuffle labels within cells.
 * Bootstrap: resample DATES (all symbols that day move together) with replacement.
 */
function compare(revRows, ctlRows, valFn, opts: { bool?: boolean; seed: number; doPerm?: boolean; doBoot?: boolean }) {
  const isBool = !!opts.bool;
  const val = (r) => { const v = valFn(r); return v === null || v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v; };
  const revV = revRows.map((r) => ({ r, v: val(r) })).filter((x) => x.v !== null);
  const ctlV = ctlRows.map((r) => ({ r, v: val(r) })).filter((x) => x.v !== null);
  const dates = [...new Set([...revRows, ...ctlRows].map((r) => r.date))].sort();
  const dIdx = new Map(dates.map((d, i) => [d, i]));
  const nD = dates.length;
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // cells with both reversal and control values
  const keyOf = (r) => `${r.sym}|${r.dir}|${r.bucket}`;
  const cellMap = new Map();
  for (const x of revV) { const k = keyOf(x.r); if (!cellMap.has(k)) cellMap.set(k, { rev: [], ctl: [] }); cellMap.get(k).rev.push(x); }
  for (const x of ctlV) { const k = keyOf(x.r); if (cellMap.has(k)) cellMap.get(k).ctl.push(x); }
  const cells = [...cellMap.entries()].filter(([, c]) => c.ctl.length > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, c]) => c);
  const nCell = cells.length;
  const nRevM = cells.reduce((s, c) => s + c.rev.length, 0);
  const nCtlM = cells.reduce((s, c) => s + c.ctl.length, 0);
  const matchedCtlMean = nRevM ? cells.reduce((s, c) => s + c.rev.length * mean(c.ctl.map((x) => x.v)), 0) / nRevM : null;
  const revMeanM = nRevM ? cells.reduce((s, c) => s + c.rev.length * mean(c.rev.map((x) => x.v)), 0) / nRevM : null;
  const diff = nRevM ? revMeanM - matchedCtlMean : null;

  const res: any = {
    nRev: revV.length, meanRev: mean(revV.map((x) => x.v)),
    nCtlMatched: nCtlM, nRevMatched: nRevM, matchedCtlMean, diff,
  };
  if (isBool) { const k = revV.filter((x) => x.v === 1).length; res.rate = revV.length ? k / revV.length : null; res.rateWilson = wilson(k, revV.length); const kc = ctlV.filter((x) => x.v === 1).length; res.ctlRawRate = ctlV.length ? kc / ctlV.length : null; res.ctlRawWilson = wilson(kc, ctlV.length); }
  else { const k = revV.filter((x) => x.v > 0).length; res.hit = revV.length ? k / revV.length : null; res.hitWilson = wilson(k, revV.length); const kc = ctlV.filter((x) => x.v > 0).length; res.ctlHit = ctlV.length ? kc / ctlV.length : null; res.ctlHitWilson = wilson(kc, ctlV.length); res.ctlRawMean = mean(ctlV.map((x) => x.v)); }

  // date-cluster bootstrap: CI for the reversal mean and for the matched difference
  if (opts.doBoot !== false && revV.length) {
    const rng = mulberry32(opts.seed + 1);
    const rs = new Float64Array(nD), rn = new Float64Array(nD);
    for (const x of revV) { const d = dIdx.get(x.r.date); rs[d] += x.v; rn[d]++; }
    const cs = cells.map(() => ({ rs: new Float64Array(nD), rn: new Float64Array(nD), cs: new Float64Array(nD), cn: new Float64Array(nD) }));
    cells.forEach((c, i) => {
      for (const x of c.rev) { const d = dIdx.get(x.r.date); cs[i].rs[d] += x.v; cs[i].rn[d]++; }
      for (const x of c.ctl) { const d = dIdx.get(x.r.date); cs[i].cs[d] += x.v; cs[i].cn[d]++; }
    });
    const means = [], diffs = [];
    const m = new Float64Array(nD);
    for (let b = 0; b < P.nBoot; b++) {
      m.fill(0);
      for (let i = 0; i < nD; i++) m[Math.floor(rng() * nD)]++;
      let s = 0, n = 0;
      for (let d = 0; d < nD; d++) if (m[d]) { s += m[d] * rs[d]; n += m[d] * rn[d]; }
      if (n > 0) means.push(s / n);
      let num_ = 0, den = 0;
      for (let i = 0; i < nCell; i++) {
        let a = 0, an = 0, c = 0, cn = 0;
        const q = cs[i];
        for (let d = 0; d < nD; d++) if (m[d]) { a += m[d] * q.rs[d]; an += m[d] * q.rn[d]; c += m[d] * q.cs[d]; cn += m[d] * q.cn[d]; }
        if (an > 0 && cn > 0) { num_ += an * (a / an - c / cn); den += an; }
      }
      if (den > 0) diffs.push(num_ / den);
    }
    means.sort((a, b) => a - b); diffs.sort((a, b) => a - b);
    res.meanRevCI = [quantile(means, 0.025), quantile(means, 0.975)];
    res.diffCI = [quantile(diffs, 0.025), quantile(diffs, 0.975)];
  }

  // stratified label-shuffle permutation test on the matched difference (two-sided)
  if (opts.doPerm !== false && nRevM) {
    const rng = mulberry32(opts.seed);
    const pools = cells.map((c) => { const arr = Float64Array.from([...c.rev, ...c.ctl].map((x) => x.v)); return { arr, n: c.rev.length, m: arr.length, total: arr.reduce((a, b) => a + b, 0) }; });
    let ge = 0;
    const absObs = Math.abs(diff) - 1e-12;
    for (let b = 0; b < P.nPerm; b++) {
      let stat = 0;
      for (const p of pools) {
        const arr = p.arr;
        let pick = 0;
        for (let i = 0; i < p.n; i++) { const j = i + Math.floor(rng() * (p.m - i)); const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp; pick += arr[i]; }
        stat += p.n * (pick / p.n - (p.total - pick) / (p.m - p.n));
      }
      if (Math.abs(stat / nRevM) >= absObs) ge++;
    }
    res.p = (1 + ge) / (P.nPerm + 1);
  }
  return res;
}

function studyB(all) {
  const rows = buildRows(all);
  const rev = rows.filter((r) => r.kind === "reversal");
  const ctl1All = rows.filter((r) => r.kind === "fresh");
  const c2 = sampleControl2(rows);
  const dirs = { high: "high", low: "low", pooled: null };
  const sel = (rs, d) => (d === null ? rs : rs.filter((r) => r.dir === d));
  const dates = [...new Set(rev.map((r) => r.date))].sort();

  const out: any = {
    counts: {
      sessions: all.length, distinctDatesAllSessions: new Set(all.map((x) => x.date)).size, distinctDatesWithReversal: dates.length,
      reversals: { high: sel(rev, "high").length, low: sel(rev, "low").length, pooled: rev.length },
      control1Pool: { high: sel(ctl1All, "high").length, low: sel(ctl1All, "low").length },
      control2: { n: c2.rows.length, shortageUnmatched: c2.shortage },
      reversalsBySymbol: Object.fromEntries(SYMBOLS.map((s) => [s, { high: rev.filter((r) => r.sym === s && r.dir === "high").length, low: rev.filter((r) => r.sym === s && r.dir === "low").length }])),
      reversalsPerDateMax: Math.max(...dates.map((d) => rev.filter((r) => r.date === d).length)),
    },
    main: {}, // [dir][horizon][control]
    holds: {},
    realised: {},
    tod: {},
    bySymbol: {},
    family: [],
  };

  const controls = { control1: ctl1All, control2: c2.rows };
  let seedN = 0;
  for (const [dname, d] of Object.entries(dirs)) {
    out.main[dname] = {};
    for (const h of HORIZONS) {
      out.main[dname][h] = {};
      for (const [cname, crs] of Object.entries(controls)) {
        const r = compare(sel(rev, d), sel(crs, d), (x) => x.o[h], { seed: P.seedPerm + 1000 * seedN++ });
        out.main[dname][h][cname] = r;
        if (d !== null) out.family.push({ dir: dname, horizon: h, control: cname, p: r.p });
      }
    }
    out.holds[dname] = {};
    for (const [cname, crs] of Object.entries(controls)) out.holds[dname][cname] = compare(sel(rev, d), sel(crs, d), (x) => x.o.holds30, { bool: true, seed: P.seedPerm + 1000 * seedN++ });
    // how often the reversal / any fresh extreme turned out to be the realised session extreme
    const rr = sel(rev, d), ff = sel(ctl1All, d);
    const kRev = rr.filter((r) => r.o.isRealisedExtreme).length, kFresh = ff.filter((r) => r.o.isRealisedExtreme).length;
    out.realised[dname] = { reversal: { k: kRev, n: rr.length, rate: kRev / rr.length, wilson: wilson(kRev, rr.length) }, freshNonReversal: { k: kFresh, n: ff.length, rate: kFresh / ff.length, wilson: wilson(kFresh, ff.length) } };
  }
  // BH over the 16-test family
  const adj = benjaminiHochberg(out.family.map((f) => f.p));
  out.family.forEach((f, i) => { f.pBH = adj[i]; out.main[f.dir][f.horizon][f.control].pBH = adj[i]; });

  // time-of-day split, descriptive only (buckets align with the windows)
  const windows = [["10:00-11:30", 1, 3], ["11:30-14:00", 4, 8], ["14:00-15:30", 9, 11]];
  for (const [wname, lo, hi] of windows) {
    out.tod[wname] = {};
    for (const [dname, d] of Object.entries(dirs)) {
      const inW = (r) => r.bucket >= lo && r.bucket <= hi;
      const rr = sel(rev, d).filter(inW), c2w = sel(c2.rows, d).filter(inW), c1w = sel(ctl1All, d).filter(inW);
      const cell: any = { nRev: rr.length, realised: { k: rr.filter((r) => r.o.isRealisedExtreme).length, n: rr.length } };
      for (const h of HORIZONS) {
        const a = compare(rr, c2w, (x) => x.o[h], { seed: 1, doPerm: false, doBoot: false });
        cell[h] = { n: a.nRev, mean: a.meanRev, hit: a.hit, ctl2Matched: a.matchedCtlMean, diff2: a.diff };
      }
      cell.nCtl1 = c1w.length;
      out.tod[wname][dname] = cell;
    }
  }
  // per-symbol, descriptive
  for (const s of SYMBOLS) {
    const rr = rev.filter((r) => r.sym === s);
    const row: any = { n: rr.length };
    for (const h of HORIZONS) { const v = rr.map((r) => r.o[h]).filter((x) => x !== null); row[h] = { n: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }; }
    out.bySymbol[s] = row;
  }
  return out;
}

// ------------------------------------------------------------------ markdown tables
function mdA(A) {
  const lines = [];
  const names = [...MAIN, "POOLED9"];
  for (const name of names) {
    const g = A[name];
    lines.push(`### ${name === "POOLED9" ? "All nine symbols pooled" : name} (${g.nSessions} sessions)`);
    lines.push(`Chi-square-style statistic vs the shuffle null: high = ${num(g.high.chi, 1)} (permutation p ${fmtP(g.high.chiP)}), low = ${num(g.low.chi, 1)} (p ${fmtP(g.low.chiP)}).`);
    lines.push("");
    lines.push("| 30-min bucket | HIGH: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag | LOW: observed n | share (Wilson 95%) | null share | excess (pp) | p over | flag |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (let k = 0; k < NB; k++) {
      const h = g.high.buckets[k], l = g.low.buckets[k];
      const cellsOf = (b) => `${b.obs} | ${pct(b.obsShare)} (${wil(b.obs, g.nSessions)}) | ${pct(b.nullShare)} | ${b.excessPP >= 0 ? "+" : ""}${num(b.excessPP * 100, 1)} | ${fmtP(b.pOver)} | ${b.flag}`;
      lines.push(`| ${h.label} | ${cellsOf(h)} | ${cellsOf(l)} |`);
    }
    lines.push("");
    const e = g.eitherEdge;
    lines.push(`First or last 30 minutes (buckets 9:30 and 15:30): high ${pct(g.high.edge.obsShare)} (Wilson ${wil(g.high.edge.obs, g.nSessions)}; null ${pct(g.high.edge.nullShare)}, null 95% range ${pct(g.high.edge.nullLo, 0)}-${pct(g.high.edge.nullHi, 0)}; p over ${fmtP(g.high.edge.pOver)}); low ${pct(g.low.edge.obsShare)} (${wil(g.low.edge.obs, g.nSessions)}; null ${pct(g.low.edge.nullShare)}, ${pct(g.low.edge.nullLo, 0)}-${pct(g.low.edge.nullHi, 0)}; p ${fmtP(g.low.edge.pOver)}); high OR low in an edge bucket ${pct(e.obsShare)} (${wil(e.obs, e.n)}; null ${pct(e.nullShare)}, ${pct(e.nullLo, 0)}-${pct(e.nullHi, 0)}; p ${fmtP(e.pOver)}).`);
    lines.push("");
  }
  // supplementary sign-flip null
  lines.push("### Supplement: same observed data against a null that keeps each slot's volatility (random bar direction)");
  lines.push("The pre-registered shuffle moves the big opening and closing bars to random times, so part of its 'excess' is simply that volatility is highest at the open. This supplement keeps every bar in its own time slot and size and only randomises direction. Share of sessions with the extreme in each edge bucket, observed vs this null; flagged buckets use the same Bonferroni rule (p <= 0.05/13).");
  lines.push("");
  lines.push("| Group | side | 9:30 obs (null) | 15:30 obs (null) | chi p | OVER buckets | UNDER buckets |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const name of names) for (const side of ["high", "low"]) {
    const g = A[name].supplementSignFlip[side];
    const b0 = g.buckets[0], b12 = g.buckets[NB - 1];
    const fl = (f) => g.buckets.filter((b) => b.flag === f).map((b) => b.label).join(", ") || "none";
    lines.push(`| ${name} | ${side} | ${pct(b0.obsShare, 0)} (${pct(b0.nullShare, 0)}) | ${pct(b12.obsShare, 0)} (${pct(b12.nullShare, 0)}) | ${fmtP(g.chiP)} | ${fl("OVER")} | ${fl("UNDER")} |`);
  }
  lines.push("");
  // compact summary of the other four
  lines.push("### Wider pool, individually (summary only)");
  lines.push("| Symbol | sessions | high chi p | low chi p | high flagged buckets | low flagged buckets |");
  lines.push("|---|---|---|---|---|---|");
  for (const s of EXTRA) {
    const g = A[s];
    const fl = (side) => g[side].buckets.filter((b) => b.flag).map((b) => `${b.label} ${b.flag}`).join(", ") || "none";
    lines.push(`| ${s} | ${g.nSessions} | ${fmtP(g.high.chiP)} | ${fmtP(g.low.chiP)} | ${fl("high")} | ${fl("low")} |`);
  }
  lines.push("");
  return lines.join("\n");
}

function mdB(B) {
  const L = [];
  const c = B.counts;
  L.push(`Events: ${c.reversals.high} bearish reversals (fresh high), ${c.reversals.low} bullish reversals (fresh low), ${c.reversals.pooled} pooled, on ${c.distinctDatesWithReversal} distinct dates (${c.distinctDatesAllSessions} dates in the sample); at most ${c.reversalsPerDateMax} reversals fall on a single date. Control 1 pool: ${c.control1Pool.high} fresh highs and ${c.control1Pool.low} fresh lows that were not reversals. Control 2: ${c.control2.n} matched random bars (${c.control2.shortageUnmatched} events had no available unmatched control bar).`);
  L.push("");
  L.push("Reversals by symbol (high / low): " + SYMBOLS.map((s) => `${s} ${c.reversalsBySymbol[s].high}/${c.reversalsBySymbol[s].low}`).join(", "));
  L.push("");
  for (const dname of ["high", "low", "pooled"]) {
    const title = dname === "high" ? "Bearish key reversal at a fresh session high (positive = price fell)" : dname === "low" ? "Bullish key reversal at a fresh session low (positive = price rose)" : "Both directions pooled (positive = reversal worked); p values here are outside the corrected family";
    L.push(`### ${title}`);
    L.push("| Horizon | n | mean signed return, bp (95% boot CI by date) | hit rate (Wilson) | control 1 matched mean, bp | diff vs control 1, bp (CI) | raw p | BH p | control 2 matched mean, bp | diff vs control 2, bp (CI) | raw p | BH p |");
    L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const h of HORIZONS) {
      const a = B.main[dname][h].control1, b = B.main[dname][h].control2;
      const dd = (x) => `${num(x.diff, 2)} (${num(x.diffCI?.[0], 1)} to ${num(x.diffCI?.[1], 1)})`;
      L.push(`| ${HLABEL[h]} | ${a.nRev} | ${num(a.meanRev, 2)} (${num(a.meanRevCI?.[0], 1)} to ${num(a.meanRevCI?.[1], 1)}) | ${pct(a.hit)} (${wil(Math.round(a.hit * a.nRev), a.nRev)}) | ${num(a.matchedCtlMean, 2)} | ${dd(a)} | ${fmtP(a.p)} | ${a.pBH !== undefined ? fmtP(a.pBH) : "-"} | ${num(b.matchedCtlMean, 2)} | ${dd(b)} | ${fmtP(b.p)} | ${b.pBH !== undefined ? fmtP(b.pBH) : "-"} |`);
    }
    L.push("");
    const h1 = B.holds[dname].control1, h2 = B.holds[dname].control2;
    L.push(`Extreme holds for the next 30 minutes (descriptive; uncorrected): reversal ${pct(h1.rate)} (Wilson ${wil(Math.round(h1.rate * h1.nRev), h1.nRev)}, n ${h1.nRev}) vs control 1 matched ${pct(h1.matchedCtlMean)} (diff ${num(h1.diff * 100, 1)} pp, CI ${num(h1.diffCI?.[0] * 100, 1)} to ${num(h1.diffCI?.[1] * 100, 1)}, p ${fmtP(h1.p)}) and control 2 matched ${pct(h2.matchedCtlMean)} (diff ${num(h2.diff * 100, 1)} pp, CI ${num(h2.diffCI?.[0] * 100, 1)} to ${num(h2.diffCI?.[1] * 100, 1)}, p ${fmtP(h2.p)}).`);
    const rl = B.realised[dname];
    L.push(`Was the reversal bar the realised session ${dname === "high" ? "high" : dname === "low" ? "low" : "extreme"}? ${rl.reversal.k} of ${rl.reversal.n} = ${pct(rl.reversal.rate)} (Wilson ${wil(rl.reversal.k, rl.reversal.n)}). For comparison, plain fresh extremes that were not reversals: ${rl.freshNonReversal.k} of ${rl.freshNonReversal.n} = ${pct(rl.freshNonReversal.rate)} (${wil(rl.freshNonReversal.k, rl.freshNonReversal.n)}).`);
    L.push("");
  }
  L.push("### Multiple-testing family (2 directions x 4 horizons x 2 controls = 16)");
  L.push("| Direction | Horizon | Control | raw p | BH-adjusted p |");
  L.push("|---|---|---|---|---|");
  for (const f of B.family) L.push(`| ${f.dir} | ${HLABEL[f.horizon]} | ${f.control === "control1" ? "1 (fresh extreme, no reversal)" : "2 (random bar)"} | ${fmtP(f.p)} | ${fmtP(f.pBH)} |`);
  L.push("");
  L.push("### By time of day (descriptive, not part of the corrected family)");
  L.push("| Window | Direction | n | mean 15m | mean 30m | mean 60m | mean to close | hit rate 30m | control 2 matched mean 30m | diff 30m | realised extreme |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const w of Object.keys(B.tod)) for (const d of ["high", "low", "pooled"]) {
    const x = B.tod[w][d];
    L.push(`| ${w} | ${d} | ${x.nRev} | ${num(x.ret15m.mean, 1)} | ${num(x.ret30m.mean, 1)} | ${num(x.ret60m.mean, 1)} (n ${x.ret60m.n}) | ${num(x.retClose.mean, 1)} | ${pct(x.ret30m.hit, 0)} | ${num(x.ret30m.ctl2Matched, 1)} | ${num(x.ret30m.diff2, 1)} | ${x.realised.k}/${x.realised.n} (${pct(x.realised.k / x.realised.n, 0)}) |`);
  }
  L.push("");
  L.push("### By symbol (descriptive; mean signed return in bp, both directions pooled)");
  L.push("| Symbol | n | 15m | 30m | 60m | to close |");
  L.push("|---|---|---|---|---|---|");
  for (const s of SYMBOLS) { const x = B.bySymbol[s]; L.push(`| ${s} | ${x.n} | ${num(x.ret15m.mean, 1)} | ${num(x.ret30m.mean, 1)} | ${num(x.ret60m.mean, 1)} | ${num(x.retClose.mean, 1)} |`); }
  L.push("");
  const pm = B.main.pooled;
  L.push(`### Cost context (no costs are deducted anywhere above)`);
  L.push(`Assumed round-trip cost: about ${P.costBp.SPY} bp for SPY and about ${P.costBp.other} bp for the other symbols (spread plus slippage at typical liquid-name quotes; your actual fills will differ). Pooled mean signed return of the reversal: ${HORIZONS.map((h) => `${HLABEL[h]} ${num(pm[h].control2.meanRev, 1)} bp`).join(", ")}. Pooled excess over matched random bars (control 2): ${HORIZONS.map((h) => `${HLABEL[h]} ${num(pm[h].control2.diff, 1)} bp`).join(", ")}.`);
  return L.join("\n");
}

// ------------------------------------------------------------------ main
async function main() {
  const all = [];
  const meta = {};
  for (const sym of SYMBOLS) {
    const raw = await loadRaw(sym);
    const { sessions, dropped } = buildSessions(raw);
    meta[sym] = { rawBars: raw.length, sessions: sessions.length, dropped, first: sessions[0]?.date, last: sessions[sessions.length - 1]?.date };
    console.log(sym, JSON.stringify(meta[sym]));
    for (const s of sessions) all.push({ sym, date: s.date, bars: s.bars });
  }
  console.log("Total sessions:", all.length);
  const A = studyA(all);
  console.log("Study A done; building Study B");
  const B = studyB(all);
  const results = { generated: new Date().toISOString(), params: P, data: meta, studyA: A, studyB: B };
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(`${SCRATCH}\\intraday_reversal_results.json`, JSON.stringify(results, null, 1));
  const md = `<!-- generated by scripts/intraday-reversal-study.mts on ${results.generated} -->\n## Study A tables\n\n${mdA(A)}\n## Study B tables\n\n${mdB(B)}\n`;
  writeFileSync(`${SCRATCH}\\intraday_reversal_tables.md`, md);
  console.log("Wrote results JSON and tables to the scratchpad.");
}
main().catch((e) => { console.error(e); process.exit(1); });
