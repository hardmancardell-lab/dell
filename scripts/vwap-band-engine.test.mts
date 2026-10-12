// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/vwap-band-engine.test.mts
//
// Checks the pure VWAP-band engine two ways:
//   1. against results computed independently in Python (numpy) on the same real 5-minute bars (fixtures),
//   2. against small hand-built sessions where the right answer is obvious.
import { readFileSync } from "node:fs";
import * as E from "../src/lib/agents/trading-agent/skills/vwap-band-engine.ts";
import { groupCandlesByEasternDay } from "../src/lib/agents/trading-agent/skills/bar-aggregation.ts";
import { WINDOWS, isWithin, toEasternParts } from "../src/lib/agents/trading-agent/skills/time-windows.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const load = (f: string) => JSON.parse(readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8")).bars.map(([datetime, open, high, low, close, volume]) => ({ datetime, open, high, low, close, volume }));

// ---------------------------------------------------------------- small pure pieces
t("volume class boundaries", E.classifyVolumeZ(2) === "climax" && E.classifyVolumeZ(1.99) === "elevated" && E.classifyVolumeZ(1) === "elevated" && E.classifyVolumeZ(0.99) === "normal" && E.classifyVolumeZ(-0.99) === "normal" && E.classifyVolumeZ(-1) === "low" && E.classifyVolumeZ(null) === "n/a" && E.classifyVolumeZ(NaN) === "n/a");
t("percentile matches numpy (linear interpolation)", near(E.percentile([1, 2, 3, 4], 10), 1.3, 1e-9) && near(E.percentile([1, 2, 3, 4], 90), 3.7, 1e-9) && near(E.percentile([5], 50), 5, 1e-9));

const candle = (i: number, o: number, h: number, l: number, c: number, v: number) => ({ datetime: 1_700_000_000_000 + i * 300_000, open: o, high: h, low: l, close: c, volume: v });
// two bars with typical prices 10 and 12; weights (1, 3): VWAP 11.5, sigma sqrt(0.75)
const toy = [candle(0, 10, 10, 10, 10, 1), candle(1, 12, 12, 12, 12, 3)];
const sb = E.sessionBandSeries(toy, true);
t("weighted VWAP and sigma match the spec formulas", near(sb.vwap[1], 11.5, 1e-9) && near(sb.sigma[1], Math.sqrt(0.75), 1e-9), JSON.stringify(sb));
const sbEq = E.sessionBandSeries(toy, false);
t("no-volume mode weights every bar equally", near(sbEq.vwap[1], 11, 1e-9) && near(sbEq.sigma[1], 1, 1e-9), JSON.stringify(sbEq));

// ---------------------------------------------------------------- simulation on hand-built sessions
// 12 bars whose typical price alternates 99.5 / 100.5 (sigma 0.5, every bar exactly 1 sigma from VWAP, so
// noise cannot touch a 2 sigma band), then a spike bar that lands just past 2 sigma, then the "tail" bars.
const flat = (i: number) => { const c = i % 2 ? 100.5 : 99.5; return candle(i, c, c + 0.001, c - 0.001, c, 1000); };
function session(dateKey: string, spike: number, tail: number[][]) {
  const bars = [];
  for (let i = 0; i < 12; i++) bars.push(flat(i));
  bars.push(candle(12, spike, spike + 0.001, spike - 0.001, spike, 1000));
  tail.forEach((r, k) => bars.push(candle(13 + k, r[0], r[1], r[2], r[3], 1000)));
  return { dateKey, bars };
}
const P = { warmupMinutes: 30, k: 2, stopK: 3 };
// spike up to 101.3 (about 2.03 sigma), then price falls through VWAP without reaching the stop line
const r1 = E.findBandTrades([session("A", 101.3, [[101.0, 101.5, 99.8, 100.1], [100.1, 100.3, 100, 100.2]])], false, P);
t("upper touch that falls back to VWAP exits at the target with a gain", r1.trades.length === 1 && r1.trades[0].side === "upper" && r1.trades[0].exitReason === "target" && r1.trades[0].fadeReturnPct > 0, JSON.stringify(r1.trades));
t("trade records the touch details", r1.trades[0].barsHeld === 1 && near(r1.trades[0].entryPrice, 101.3, 1e-9) && r1.trades[0].bandPct > 0 && r1.trades[0].volumeZ === null && r1.trades[0].volumeClass === "n/a" && r1.trades[0].entryBeyondStop === false, JSON.stringify(r1.trades[0]));
// price keeps running through the stop line
const r2 = E.findBandTrades([session("B", 101.3, [[101.4, 102.6, 101.4, 102.5], [102.5, 102.6, 102.4, 102.5]])], false, P);
t("a touch that keeps running is stopped out with a loss", r2.trades[0].exitReason === "stop" && r2.trades[0].fadeReturnPct < 0, JSON.stringify(r2.trades[0]));
// gap straight through the stop: fills at that bar's open, not at the stop price
const r3 = E.findBandTrades([session("C", 101.3, [[105, 105.5, 104.5, 105.2], [105, 105.5, 104.5, 105]])], false, P);
t("a gap through the stop fills at the open", r3.trades[0].exitReason === "stop" && r3.trades[0].exitPrice === 105 && r3.trades[0].fadeReturnPct < 0, JSON.stringify(r3.trades[0]));
// stop and target both inside one bar: the stop is assumed first
const r4 = E.findBandTrades([session("D", 101.3, [[101.0, 103, 99, 101]])], false, P);
t("stop is assumed before target when one bar contains both", r4.trades[0].exitReason === "stop", JSON.stringify(r4.trades[0]));
// lower side mirrors
const r5 = E.findBandTrades([session("E", 98.7, [[99.0, 100.3, 99.2, 100.1], [100.1, 100.3, 100, 100.2]])], false, P);
t("lower touch that rises to VWAP exits at the target with a gain", r5.trades[0].side === "lower" && r5.trades[0].exitReason === "target" && r5.trades[0].fadeReturnPct > 0, JSON.stringify(r5.trades[0]));
// nothing resolves: scored at the session's last close
const r6 = E.findBandTrades([session("F", 101.3, [[101.3, 101.7, 101.2, 101.6], [101.6, 101.8, 101.5, 101.7]])], false, P);
t("an unresolved touch exits at the session close", r6.trades[0].exitReason === "time" && r6.trades[0].exitPrice === 101.7 && r6.trades[0].barsHeld === 2, JSON.stringify(r6.trades[0]));
// a spike that is already beyond the 3 sigma stop line on the entry bar is flagged
// (one outlier among 13 equal-weight points can reach about 3.46 sigma at most, so it takes a big spike)
const r7 = E.findBandTrades([session("G", 120, [[119, 119.5, 100, 100.5]])], false, P);
t("an entry already beyond the stop line is flagged", r7.trades.length >= 1 && r7.trades[0].entryBeyondStop === true, JSON.stringify(r7.trades[0]));
// warm-up: the same kind of spike inside the first 30 minutes is ignored
const early = { dateKey: "H", bars: [flat(0), flat(1), candle(2, 101.3, 101.301, 101.299, 101.3, 1000), flat(3), flat(4)] };
t("touches inside the warm-up window are ignored", E.findBandTrades([early], false, P).trades.length === 0);
// forward returns and ranges
const fr = E.forwardRanges(r1.trades);
t("forward ranges cover every horizon for the side that traded", fr.length === 6 && fr.every((x) => x.side === "upper") && fr[0].horizon === "5 min" && fr[5].horizon === "to the close", JSON.stringify(fr));
const sm1 = E.summarizeTrades(r1.trades, "x");
t("summaries mark a one-trade sample as small and report the exit mix", sm1.smallSample === true && sm1.hitVwapPct === 100 && sm1.stoppedPct === 0 && sm1.n === 1);
t("empty summary is safe", E.summarizeTrades([], "none").n === 0 && E.summarizeTrades([], "none").avgReturnPct === null);

// ---------------------------------------------------------------- volume baseline
const sessions4 = [1, 2, 3, 4].map((m) => ({ dateKey: "d" + m, bars: [candle(0, 1, 1, 1, 1, 100 * m), candle(1, 1, 1, 1, 1, 200 * m)] }));
t("baseline needs the prior sessions", E.volumeBaseline(sessions4, 1, 3, false) === null);
const bl = E.volumeBaseline(sessions4, 3, 3, false);
t("baseline is the per-bucket mean and sample SD of the prior sessions", near(bl.mean[0], 200, 1e-9) && near(bl.sd[0], 100, 1e-9) && near(bl.mean[1], 400, 1e-9), JSON.stringify(bl));
const bll = E.volumeBaseline(sessions4, 3, 3, true);
t("log baseline uses log(volume + 1)", near(bll.mean[0], (Math.log(101) + Math.log(201) + Math.log(301)) / 3, 1e-9));

// ---------------------------------------------------------------- gamma context
const rows = [{ right: "call", dollarGamma: 3e6 }, { right: "put", dollarGamma: 1e6 }, { right: "call", dollarGamma: 2e6 }];
const g = E.gammaContext(rows, 200e6);
t("gamma context: gross, both sign conventions, and size", g && g.grossPer1PctUsd === 6e6 && g.netCommonConventionUsd === 4e6 && g.netAppConventionUsd === -4e6 && near(g.grossPctOfDailyDollarVolume, 3, 1e-9) && g.size === "modest", JSON.stringify(g));
t("gamma context: small gamma against big volume is negligible, big is material", E.gammaContext(rows, 2e9).size === "negligible" && E.gammaContext(rows, 20e6).size === "material");
t("gamma context: no rows or no volume gives null (never a made-up flag)", E.gammaContext([], 1e8) === null && E.gammaContext(rows, 0) === null);

// ---------------------------------------------------------------- parity with Python on real bars
const spy = load("spy_5m_regular_session.json");
const spySessions = groupCandlesByEasternDay(spy)
  .map((d) => ({ dateKey: d.dateKey, bars: d.bars.filter((b) => isWithin(toEasternParts(b.datetime).minutesSinceMidnight, WINDOWS.REGULAR_SESSION)) }))
  .filter((s) => s.bars.length === 78);
t("SPY fixture: 60 full sessions", spySessions.length === 60, String(spySessions.length));
// sigma from the engine equals the spec's definition computed the slow, direct way (two passes), on every bar
let worstSigma = 0, worstVwap = 0;
for (const sess of spySessions.slice(0, 10)) {
  const sb2 = E.sessionBandSeries(sess.bars, true);
  sess.bars.forEach((b, i) => {
    let cv = 0, cpv = 0;
    for (let k = 0; k <= i; k++) { const tp = (sess.bars[k].high + sess.bars[k].low + sess.bars[k].close) / 3; cv += sess.bars[k].volume; cpv += tp * sess.bars[k].volume; }
    const v = cpv / cv; let ss = 0;
    for (let k = 0; k <= i; k++) { const tp = (sess.bars[k].high + sess.bars[k].low + sess.bars[k].close) / 3; ss += sess.bars[k].volume * (tp - v) ** 2; }
    worstVwap = Math.max(worstVwap, Math.abs(sb2.vwap[i] - v)); worstSigma = Math.max(worstSigma, Math.abs(sb2.sigma[i] - Math.sqrt(ss / cv)));
  });
}
t("engine VWAP and sigma match the direct two-pass spec formulas on real bars", worstVwap < 1e-9 && worstSigma < 1e-9, `${worstVwap} ${worstSigma}`);

const s = E.findBandTrades(spySessions, true, {});
t("SPY: 40 sessions tested after the 20-day baseline", s.sessionsTested === 40);
t("SPY: 100 band touches, 39 upper and 61 lower (Python: 100, 39, 61)", s.trades.length === 100 && s.trades.filter((x) => x.side === "upper").length === 39 && s.trades.filter((x) => x.side === "lower").length === 61, String(s.trades.length));
const ex = (r: string) => s.trades.filter((x) => x.exitReason === r).length;
t("SPY: exits 47 target, 37 stop, 16 close (Python: 47, 37, 16)", ex("target") === 47 && ex("stop") === 37 && ex("time") === 16, `${ex("target")} ${ex("stop")} ${ex("time")}`);
const sum = E.summarizeTrades(s.trades, "all");
t("SPY: average fade return +0.011% (Python +0.011%)", near(sum.avgReturnPct, 0.011, 0.003), String(sum.avgReturnPct));
t("SPY: win rate 49% and median hold 4 bars", near(sum.winRatePct, 49, 1) && sum.medianHoldBars === 4, `${sum.winRatePct} ${sum.medianHoldBars}`);
const cls = Object.fromEntries(E.summarizeByVolumeClass(s.trades).map((c) => [c.label.split(" ")[0], c]));
const byClass = (c: string) => s.trades.filter((x) => x.volumeClass === c).length;
t("SPY: volume classes 11 climax, 12 elevated, 71 normal, 6 low (Python: 11, 12, 77-6, 6)", byClass("climax") === 11 && byClass("elevated") === 12 && byClass("normal") === 71 && byClass("low") === 6, `${byClass("climax")} ${byClass("elevated")} ${byClass("normal")} ${byClass("low")}`);
const all6 = E.summarizeByVolumeClass(s.trades);
t("SPY: Scenario B as written (Z < 1.0) holds 77 touches, more than three quarters of them", all6[5].n === 77, String(all6[5].n));
const climax = all6[1];
t("SPY: climax touches average -0.026% (Python -0.026%) and are flagged a small sample", near(climax.avgReturnPct, -0.026, 0.004) && climax.smallSample === true, JSON.stringify(climax));
const rng = E.forwardRanges(s.trades);
const pick = (side: string, h: string) => rng.find((x) => x.side === side && x.horizon === h);
t("SPY: after an upper touch, 5 min range -0.068% to +0.062% (Python)", near(pick("upper", "5 min").lowerPct, -0.068, 0.003) && near(pick("upper", "5 min").upperPct, 0.062, 0.003), JSON.stringify(pick("upper", "5 min")));
t("SPY: after an upper touch, to the close -0.552% to +0.233% and 72% moved toward VWAP (Python)", near(pick("upper", "to the close").lowerPct, -0.552, 0.003) && near(pick("upper", "to the close").upperPct, 0.233, 0.003) && near(pick("upper", "to the close").towardVwapPct, 72, 1.5), JSON.stringify(pick("upper", "to the close")));
t("SPY: after a lower touch, 1 hour range -0.216% to +0.253% (Python)", near(pick("lower", "1 hour").lowerPct, -0.216, 0.003) && near(pick("lower", "1 hour").upperPct, 0.253, 0.003), JSON.stringify(pick("lower", "1 hour")));
t("SPY: k = 1.5 gives 140 touches (Python 140)", E.findBandTrades(spySessions, true, { k: 1.5 }).trades.length === 140);
// Python found 157 with no warm-up, but 2 of those are first-bar "touches" where sigma is really zero (one data
// point) and only rounding noise (about 1e-14) made it positive. The engine correctly skips them: 155.
t("SPY: no warm-up gives 155 touches (Python 157 minus 2 first-bar rounding artifacts)", E.findBandTrades(spySessions, true, { warmupMinutes: 0 }).trades.length === 155);
const bw = E.bandWidthPct(spySessions.slice(-21), true, 2, 30);
t("SPY: one-month +-2 sigma band is about 0.26% of VWAP (Python 0.261%)", bw && near(bw.meanPct, 0.261, 0.01), JSON.stringify(bw));

// FX: London session, no volume, equal-weight VWAP
const fx = load("gbpjpy_5m_london_session.json");
const byDate = new Map();
for (const c of fx) {
  const k = new Date(c.datetime).toISOString().slice(0, 10);
  if (!byDate.has(k)) byDate.set(k, []);
  byDate.get(k).push(c);
}
const fxSessions = [...byDate.entries()].filter(([, b]) => b.length >= 100).map(([dateKey, bars]) => ({ dateKey, bars }));
t("GBP/JPY fixture: 59 London sessions", fxSessions.length === 59, String(fxSessions.length));
const f = E.findBandTrades(fxSessions, false, {});
const fe = (r: string) => f.trades.filter((x) => x.exitReason === r).length;
t("GBP/JPY: 259 touches, 100 upper and 159 lower (Python 259, 100, 159)", f.trades.length === 259 && f.trades.filter((x) => x.side === "upper").length === 100 && f.trades.filter((x) => x.side === "lower").length === 159, String(f.trades.length));
t("GBP/JPY: exits 103 target, 122 stop, 34 close (Python)", fe("target") === 103 && fe("stop") === 122 && fe("time") === 34, `${fe("target")} ${fe("stop")} ${fe("time")}`);
const fs = E.summarizeTrades(f.trades, "fx");
t("GBP/JPY: average fade return is about zero (Python -0.002%)", near(fs.avgReturnPct, -0.002, 0.003), String(fs.avgReturnPct));
t("GBP/JPY: no volume means no Z-scores", f.trades.every((x) => x.volumeZ === null && x.volumeClass === "n/a"));
const fr2 = E.forwardRanges(f.trades);
const pf = fr2.find((x) => x.side === "lower" && x.horizon === "1 hour");
t("GBP/JPY: after a lower touch, 1 hour range -0.143% to +0.199% (Python)", near(pf.lowerPct, -0.143, 0.004) && near(pf.upperPct, 0.199, 0.004), JSON.stringify(pf));

// ---------------------------------------------------------------- live scan on a still-running session
{
  // pick a real SPY trade that took at least 3 bars to resolve
  const full = E.findBandTrades(spySessions, true, {}).trades;
  const pickT = full.find((x) => x.barsHeld >= 3 && (x.exitReason === "target" || x.exitReason === "stop"));
  const si = spySessions.findIndex((x) => x.dateKey === pickT.dateKey);
  const prior = spySessions.slice(0, si);
  const bars = spySessions[si].bars;
  const entryIdx = bars.findIndex((b) => b.datetime === pickT.entryTimeMs);
  const scanAt = (n: number) => E.scanLiveSession(prior, { dateKey: pickT.dateKey, bars: bars.slice(0, n) }, true, {});
  const same = (res: any[]) => res.find((x) => x.entryTimeMs === pickT.entryTimeMs);

  const atTouch = scanAt(entryIdx + 1);
  const tAtTouch = same(atTouch);
  t("live: a touch on the newest bar is recorded, open, with nothing yet held", !!tAtTouch && tAtTouch.exitReason === "open" && tAtTouch.barsHeld === 0 && tAtTouch.entryPrice === pickT.entryPrice, JSON.stringify(tAtTouch));
  const midway = same(scanAt(entryIdx + 2));
  t("live: one bar later the trade is still open, marked to the latest close", !!midway && (midway.exitReason === "open" || midway.barsHeld === 1) && midway.entryPrice === pickT.entryPrice, JSON.stringify(midway));
  const resolved = same(scanAt(entryIdx + pickT.barsHeld + 1));
  t("live: once the exit bar has arrived the outcome equals the backtest's", !!resolved && resolved.exitReason === pickT.exitReason && near(resolved.exitPrice, pickT.exitPrice, 1e-9) && resolved.barsHeld === pickT.barsHeld, JSON.stringify(resolved) + " vs " + JSON.stringify(pickT));
  t("live: the volume Z-score equals the backtest's for the same touch", resolved && near(resolved.volumeZ, pickT.volumeZ, 1e-9), `${resolved?.volumeZ} ${pickT.volumeZ}`);
  const noBase = E.scanLiveSession(prior.slice(0, 5), { dateKey: "x", bars: bars.slice(0, 40) }, true, {});
  t("live: too few prior sessions for the volume baseline returns null, not a made-up Z", noBase === null);
  const noVol = E.scanLiveSession([], { dateKey: "x", bars: bars.slice(0, 40).map((b) => ({ ...b, volume: 1 })) }, false, {});
  t("live: a no-volume feed needs no baseline", Array.isArray(noVol));
}


console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
