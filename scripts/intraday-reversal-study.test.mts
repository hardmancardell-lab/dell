// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/intraday-reversal-study.test.mts
// Hand-built bar sequences for the key-reversal detection and outcome functions (no network).
import * as D from "./intraday-reversal-detect.mts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};

const bar = (minute, open, high, low, close) => ({ minute, open, high, low, close });
// All prices are multiples of 0.25 so the arithmetic is exact in floating point. One tick = 0.25.

/** `n` quiet bars from 9:30 (high 100.5, low 99), then a previous bar, then the candidate bar (index n + 1). The candidate's low ties the earlier low of 99 so it is only ever a fresh HIGH. */
function bearish({ n = 8, high = 102, low = 99, close = 99.25, prevLow = 100.25 } = {}) {
  const bars = [];
  for (let i = 0; i < n; i++) bars.push(bar(570 + 5 * i, 99.75, 100.5, 99, 100));
  bars.push(bar(570 + 5 * n, 100.25, 100.5, prevLow, 100.25)); // previous bar (low = prevLow)
  bars.push(bar(570 + 5 * (n + 1), 100, high, low, close)); // candidate
  return bars;
}
/** Mirror: earlier lows 99.5 and highs 101; the candidate's high ties 101 so it is only ever a fresh LOW. */
function bullish({ n = 8, high = 101, low = 98, close = 100.75, prevHigh = 99.75 } = {}) {
  const bars = [];
  for (let i = 0; i < n; i++) bars.push(bar(570 + 5 * i, 100, 101, 99.5, 100));
  bars.push(bar(570 + 5 * n, 99.5, prevHigh, 99.5, 99.5));
  bars.push(bar(570 + 5 * (n + 1), 100, high, low, close));
  return bars;
}
const rev = (bars, dir = "high") => D.isKeyReversal(bars, bars.length - 1, dir);

// ---- fresh extreme without a reversal
{
  const bars = bearish({ close: 101.5 }); // new high 102, closes near the top: continuation
  t("fresh high without reversal: fresh yes, reversal no", D.isFreshExtreme(bars, 9, "high") && !rev(bars));
  const ev = D.detectSession(bars);
  t("fresh high without reversal is labelled 'fresh' (control 1 pool)", ev.length === 1 && ev[0].kind === "fresh" && ev[0].dir === "high" && ev[0].t === 9, JSON.stringify(ev));
}

// ---- bearish: all conditions met, then each condition failed by one tick
{
  const bars = bearish();
  const ev = D.detectSession(bars);
  t("bearish key reversal: meets all conditions", rev(bars) && ev.length === 1 && ev[0].kind === "reversal" && ev[0].dir === "high");
  t("bearish: close exactly on the lowest-25% boundary still qualifies", rev(bearish({ close: 99.75 })));
  t("bearish fails by one tick: close just above the lowest 25%", !rev(bearish({ close: 100 })));
  t("bearish fails by one tick: close equals previous bar's low (not below)", !rev(bearish({ close: 99.5, prevLow: 99.5 })));
  t("bearish passes when close is one tick below the previous low", rev(bearish({ close: 99.5, prevLow: 99.75 })));
  t("bearish fails by one tick: high only ties the earlier session high", !rev(bearish({ high: 100.5, low: 99, close: 99.25 })));
  t("bearish passes when the high is one tick above the earlier session high", rev(bearish({ high: 100.75, low: 99, close: 99.25 })));
  t("zero-range bar is never a reversal", !rev(bearish({ high: 102, low: 102, close: 102 })));
}

// ---- bullish mirror
{
  const bars = bullish();
  const ev = D.detectSession(bars);
  t("bullish key reversal: meets all conditions", rev(bars, "low") && ev.length === 1 && ev[0].kind === "reversal" && ev[0].dir === "low");
  t("bullish: close exactly on the top-25% boundary still qualifies", rev(bullish({ close: 100.25 }), "low"));
  t("bullish fails by one tick: close just below the top 25%", !rev(bullish({ close: 100 }), "low"));
  t("bullish fails by one tick: close equals previous bar's high (not above)", !rev(bullish({ close: 100.5, prevHigh: 100.5 }), "low"));
  t("bullish passes when close is one tick above the previous high", rev(bullish({ close: 100.5, prevHigh: 100.25 }), "low"));
  t("bullish fails by one tick: low only ties the earlier session low", !rev(bullish({ high: 101, low: 99.5, close: 100.75 }), "low"));
  t("bullish passes when the low is one tick below the earlier session low", rev(bullish({ high: 101, low: 99.25, close: 100.75 }), "low"));
  t("a bullish pattern is not a bearish reversal", !rev(bars, "high"));
}

// ---- time window: first 30 minutes excluded, evaluation 10:00 .. 15:25 start
{
  // candidate at index n+1; its minute = 570 + 5*(n+1). n=4 -> minute 595 (9:55), n=5 -> 600 (10:00)
  const early = D.detectSession(bearish({ n: 4 }));
  t("candidate in the first 30 minutes (9:55 bar) is excluded", early.length === 0, JSON.stringify(early));
  const first = D.detectSession(bearish({ n: 5 }));
  t("candidate on the 10:00 bar is evaluated", first.length === 1 && first[0].minute === 600 && first[0].kind === "reversal", JSON.stringify(first));
  const lastOk = D.detectSession(bearish({ n: 70 }));
  t("candidate on the 15:25 bar (closes 15:30) is evaluated", lastOk.length === 1 && lastOk[0].minute === 925, JSON.stringify(lastOk));
  const tooLate = D.detectSession(bearish({ n: 71 }));
  t("candidate on the 15:30 bar is excluded (no room for the 30-minute outcome)", tooLate.length === 0, JSON.stringify(tooLate));
  t("bucket numbering: 9:30 -> 0, 10:00 -> 1, 15:30 -> 12", D.bucketOf(570) === 0 && D.bucketOf(600) === 1 && D.bucketOf(929) === 11 && D.bucketOf(930) === 12);
}

// ---- no look-ahead: truncating future bars never changes an earlier detection
{
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let totalRev = 0, totalFresh = 0, mismatches = 0, garbageMismatches = 0;
  for (let sim = 0; sim < 40; sim++) {
    const bars = [];
    let px = 100;
    for (let i = 0; i < 78; i++) {
      const o = px, c = o + (rnd() - 0.5) * 0.8, h = Math.max(o, c) + rnd() * 0.3, l = Math.min(o, c) - rnd() * 0.3;
      bars.push(bar(570 + 5 * i, o, h, l, c));
      px = c;
    }
    const full = D.detectSession(bars);
    totalRev += full.filter((e) => e.kind === "reversal").length;
    totalFresh += full.filter((e) => e.kind === "fresh").length;
    for (let k = 1; k <= bars.length; k++) {
      const truncated = D.detectSession(bars.slice(0, k));
      const expected = full.filter((e) => e.t < k);
      if (JSON.stringify(truncated) !== JSON.stringify(expected)) mismatches++;
      // stronger: replace everything after k with garbage; detections before k must not move
      const garbage = bars.slice(0, k).concat(bars.slice(k).map((b) => bar(b.minute, 1000, 2000, 1, 1500)));
      const g = D.detectSession(garbage).filter((e) => e.t < k);
      if (JSON.stringify(g) !== JSON.stringify(expected)) garbageMismatches++;
    }
  }
  t("no look-ahead: truncating future bars never changes an earlier detection (40 random sessions x 78 cut points)", mismatches === 0, `${mismatches} mismatches`);
  t("no look-ahead: replacing future bars with garbage never changes an earlier detection", garbageMismatches === 0, `${garbageMismatches} mismatches`);
  t("the random sessions actually contain reversals and plain fresh extremes (test has power)", totalRev > 5 && totalFresh > 20, `${totalRev} reversals, ${totalFresh} fresh`);
}

// ---- outcomes (labels, allowed to use the future)
{
  // bearish reversal at index 9 (10:15), then a drift down of 0.25 per bar, to the end of a 20-bar session
  const bars = bearish();
  let px = bars[9].close;
  for (let i = 10; i < 20; i++) {
    px -= 0.25;
    bars.push(bar(570 + 5 * i, px + 0.25, px + 0.25, px - 0.25, px));
  }
  const o = D.outcomeAt(bars, 9, "high");
  const c0 = 99.25;
  t("outcome: signed return at 15 minutes is positive for a down move after a bearish reversal", Math.abs(o.ret15m - ((c0 - (c0 - 0.75)) / c0) * 1e4) < 1e-6, String(o.ret15m));
  t("outcome: 60-minute horizon is missing when the session ends first", o.ret60m === null);
  t("outcome: return to the close uses the last bar", Math.abs(o.retClose - ((c0 - bars[19].close) / c0) * 1e4) < 1e-6);
  t("outcome: extreme holds when no later bar exceeds the high, and the reversal is the realised high", o.holds30 === true && o.isRealisedExtreme === true);
  // add a new high in the following 30 minutes
  const broken = bars.map((b, i) => (i === 12 ? { ...b, high: 103 } : b));
  const ob = D.outcomeAt(broken, 9, "high");
  t("outcome: a later higher high breaks 'holds' and the realised-extreme flag", ob.holds30 === false && ob.isRealisedExtreme === false);
  // a higher high only AFTER 30 minutes: holds30 stays true but it was not the realised high
  const late = bars.map((b, i) => (i === 17 ? { ...b, high: 103 } : b));
  const ol = D.outcomeAt(late, 9, "high");
  t("outcome: a new high after 30 minutes leaves holds30 true but not the realised high", ol.holds30 === true && ol.isRealisedExtreme === false);
  // bullish sign: up move is positive
  const bb = bullish();
  bb.push(bar(570 + 5 * 10, 100.75, 101.25, 100.75, 101.25));
  bb.push(bar(570 + 5 * 11, 101.25, 101.5, 101.25, 101.5));
  bb.push(bar(570 + 5 * 12, 101.5, 102, 101.5, 102));
  const ou = D.outcomeAt(bb, 9, "low");
  t("outcome: bullish reversal signs an up move positive", ou.ret15m > 0 && Math.abs(ou.ret15m - ((102 - 100.75) / 100.75) * 1e4) < 1e-6, String(ou.ret15m));
}

console.log(bad === 0 ? "\nALL PASSED" : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
