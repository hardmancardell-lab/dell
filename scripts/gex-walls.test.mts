// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/gex-walls.test.mts
// Tests the gex-v2 wall, window and gamma-flip logic (no network).
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as G from "../src/lib/agents/trading-agent/skills/gex-signal.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const NOW = Date.UTC(2026, 9, 8, 14, 0); // 8 Oct 2026, 10:00 ET
const contract = (strikePrice: number, openInterest: number, volatility = 20, totalVolume = 0) => ({
  strikePrice, expirationDate: "", daysToExpiration: 0, bid: 0, ask: 0, last: 0, openInterest, totalVolume, volatility, delta: 0, gamma: 0, theta: 0, vega: 0,
});
const chain = (calls: any[], puts: any[]) => ({ symbol: "TST", calls, puts });
const SPOT = 100;

// ---------------------------------------------------------------- expiration window
t("an expiration ends at 4pm Eastern (20:00 UTC in summer)", G.expiryMs("2026-10-08") === Date.UTC(2026, 9, 8, 20, 0));
const exps = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-11-20", "2026-11-23", "2026-12-31"];
const w = G.windowExpirations(exps, NOW);
t("window keeps today's expiry until the close, tomorrow's and anything within 45 days", JSON.stringify(w) === JSON.stringify(["2026-10-08", "2026-10-09", "2026-11-20"]), JSON.stringify(w));
t("after the close today's expiry is gone", !G.windowExpirations(exps, Date.UTC(2026, 9, 8, 21, 0)).includes("2026-10-08"));
t("the window is capped at the nearest N expirations", G.windowExpirations(exps, NOW, 45, 2).length === 2 && G.windowExpirations(exps, NOW, 45, 2)[1] === "2026-10-09");
t("the window length is honoured", !G.windowExpirations(exps, NOW, 10).includes("2026-11-20"));

// ---------------------------------------------------------------- walls are picked by side
{
  // Calls dominate just above spot; puts dominate just below. This is the GLD/SPY situation that v1 mislabelled.
  const c = chain([contract(102, 40000), contract(105, 10000), contract(98, 90000)], [contract(98, 20000), contract(95, 12000), contract(103, 90000)]);
  const rows = G.computeWindowRows([{ expiration: "2026-10-09", chain: c }], SPOT, NOW);
  const { callWalls, putWalls } = G.wallsBySide(rows, SPOT);
  t("call wall is the strike above spot with the most call gamma", callWalls[0] === 102, JSON.stringify(callWalls));
  t("put wall is the strike below spot with the most put gamma", putWalls[0] === 98, JSON.stringify(putWalls));
  t("a huge call position BELOW spot is not a call wall, and a huge put position ABOVE spot is not a put wall", !callWalls.includes(98) && !putWalls.includes(103), JSON.stringify([callWalls, putWalls]));
  const reg = G.classifyGexRegime(rows, SPOT);
  t("regime carries the walls and the runners-up, at most three each", reg.callWall === 102 && reg.putWall === 98 && reg.callWalls.length <= 3 && reg.putWalls.length <= 3 && reg.callWalls[0] === reg.callWall);
}

// The GLD / SPY mismatch the user hit: v1 called the strike where CALLS dominate (above spot) the "put wall".
{
  const c = chain([contract(102, 40000)], [contract(102, 8000), contract(98, 20000)]);
  const rows = G.computeWindowRows([{ expiration: "2026-10-09", chain: c }], SPOT, NOW);
  const net = new Map<number, number>();
  for (const r of rows) net.set(r.strikePrice, (net.get(r.strikePrice) ?? 0) + r.dealerGex);   // calls -, puts +
  const v1PutWall = [...net.entries()].sort((a, b) => a[1] - b[1])[0][0];                       // v1: most negative net
  const v1CallWall = [...net.entries()].sort((a, b) => b[1] - a[1])[0][0];                      // v1: most positive net
  const v2 = G.classifyGexRegime(rows, SPOT);
  t("v1 rule: the 'put wall' lands ABOVE spot, on the strike where calls dominate", v1PutWall === 102 && v1PutWall > SPOT, String(v1PutWall));
  t("v1 rule: the 'call wall' lands on the put-heavy strike BELOW spot", v1CallWall === 98 && v1CallWall < SPOT, String(v1CallWall));
  t("v2 puts them the right way round: call wall 102 above spot, put wall 98 below", v2.callWall === 102 && v2.putWall === 98, JSON.stringify([v2.callWall, v2.putWall]));
}

// no strike on one side: wall falls back to spot, never crashes
{
  const rows = G.computeWindowRows([{ expiration: "2026-10-09", chain: chain([contract(95, 1000)], [contract(105, 1000)]) }], SPOT, NOW);
  const reg = G.classifyGexRegime(rows, SPOT);
  t("with no call strike above spot (and no put below) the walls fall back to spot", reg.callWall === SPOT && reg.putWall === SPOT && reg.callWalls.length === 0);
}

// ---------------------------------------------------------------- several expirations are combined
{
  // Tomorrow's chain has its call gamma at 104. Two later expirations stack far more open interest on 106.
  const near1 = chain([contract(104, 20000), contract(106, 1000)], []);
  const mk = (oi: number) => chain([contract(106, oi)], []);
  const single = G.wallsBySide(G.computeWindowRows([{ expiration: "2026-10-09", chain: near1 }], SPOT, NOW), SPOT);
  const combined = G.wallsBySide(
    G.computeWindowRows([
      { expiration: "2026-10-09", chain: near1 },
      { expiration: "2026-10-16", chain: mk(200000) },
      { expiration: "2026-10-23", chain: mk(200000) },
    ], SPOT, NOW), SPOT);
  t("on tomorrow's expiration alone the call wall is 104", single.callWalls[0] === 104, JSON.stringify(single));
  t("adding later expirations moves the call wall to 106, where the gamma really stacks", combined.callWalls[0] === 106, JSON.stringify(combined));
  const rows = G.computeWindowRows([{ expiration: "2026-10-09", chain: near1 }, { expiration: "2026-10-16", chain: mk(40000) }], SPOT, NOW);
  t("rows remember which expiration they came from", rows.some((r) => r.expiration === "2026-10-16") && rows.some((r) => r.expiration === "2026-10-09"));
}

// ---------------------------------------------------------------- time to expiry never collapses
{
  const rows = G.computeWindowRows([{ expiration: "2026-10-08", chain: chain([contract(100, 1000)], []) }], SPOT, Date.UTC(2026, 9, 8, 19, 59));
  const floorYears = (6 * 3600 * 1000) / (365 * 24 * 3600 * 1000);
  t("one minute before the close gamma is priced on a quarter-day floor, not zero", rows[0].tYears >= floorYears - 1e-12 && rows[0].gamma > 0 && Number.isFinite(rows[0].dollarGamma), JSON.stringify(rows[0]));
}

// ---------------------------------------------------------------- gamma flip by spot sweep
{
  const c = chain([contract(100, 1000)], [contract(90, 1000)]);
  const exp = { expiration: "2026-11-06", chain: c };
  const rows = G.computeWindowRows([exp], 95, NOW);
  const flip = G.sweepGammaFlip(rows, 95);
  t("the flip lies between the two strikes", flip !== null && flip > 90 && flip < 100, String(flip));
  t("net gamma at the flip is about zero compared with net gamma at spot", flip !== null && Math.abs(G.netGexAtSpot(rows, flip)) < 0.02 * Math.max(Math.abs(G.netGexAtSpot(rows, 90)), Math.abs(G.netGexAtSpot(rows, 100))), String(flip && G.netGexAtSpot(rows, flip)));
  t("net gamma has opposite signs on either side of the flip", flip !== null && Math.sign(G.netGexAtSpot(rows, flip - 1)) !== Math.sign(G.netGexAtSpot(rows, flip + 1)));
  // the crossing level does not depend on the sign convention
  const exp2 = Date.parse("2026-11-06T20:00:00Z");
  const flipped = G.computeStrikeGex(c, 95, NOW, exp2, 100, false, true);
  const orig = G.computeStrikeGex(c, 95, NOW, exp2, 100, true, false);
  const f1 = G.sweepGammaFlip(flipped, 95), f2 = G.sweepGammaFlip(orig, 95);
  t("the flip level is the same under the opposite sign convention", f1 !== null && f2 !== null && near(f1, f2, 1e-6), `${f1} ${f2}`);
  const onlyCalls = G.computeWindowRows([{ expiration: "2026-11-06", chain: chain([contract(100, 1000), contract(105, 500)], []) }], 100, NOW);
  t("with one side only there is no crossing, so no flip", G.sweepGammaFlip(onlyCalls, 100) === null);
}

// ---------------------------------------------------------------- regime sign and flow at walls
{
  const putHeavy = G.computeWindowRows([{ expiration: "2026-10-09", chain: chain([contract(102, 1000)], [contract(98, 5000)]) }], SPOT, NOW);
  const callHeavy = G.computeWindowRows([{ expiration: "2026-10-09", chain: chain([contract(102, 5000)], [contract(98, 1000)]) }], SPOT, NOW);
  t("regime follows the stated dealer assumption (short calls, long puts): put-heavy is positive, call-heavy is negative", G.classifyGexRegime(putHeavy, SPOT).regime === "positive" && G.classifyGexRegime(callHeavy, SPOT).regime === "negative");
  const a = chain([contract(102, 1000, 20, 500)], [contract(98, 1000, 20, 100)]);
  const b = chain([contract(102, 3000, 20, 1500)], [contract(98, 1000, 20, 100)]);
  const rows = G.computeWindowRows([{ expiration: "2026-10-09", chain: a }, { expiration: "2026-10-16", chain: b }], SPOT, NOW);
  const flow = G.flowDirectionAtWalls(rows, G.classifyGexRegime(rows, SPOT));
  t("flow ratio at a wall adds volume and open interest across expirations", near(flow.callWallFlowRatio, 2000 / 4000) && near(flow.putWallFlowRatio, 200 / 2000), JSON.stringify(flow));
}

// ---------------------------------------------------------------- paper log: methods are kept apart
{
  const dir = mkdtempSync(path.join(tmpdir(), "gexlog-"));
  process.chdir(dir);
  const L = await import("../src/lib/agents/trading-agent/skills/paper-backtest-log.ts?x=" + Date.now());
  const legacy = { underlying: "SPY", expirationDate: "2026-10-09", signalLabel: "bullish-stable", signalDate: "2026-10-08", monRet: null, tueRet: null, wedRet: null, thuRet: null, friRet: null, weekRangePct: null, pinnedNearWall: null, gammaFlip: 770, callWall: 767, putWall: 780, totalNetGex: 1 };
  writeFileSync(path.join(dir, "gex-paper-backtest-log.json"), JSON.stringify([legacy]));
  t("a row without a stamp counts as gex-v1", L.methodOf(legacy) === "gex-v1" && L.methodOf({ ...legacy, methodVersion: "gex-v2" }) === "gex-v2");
  const signal = (version) => ({ underlying: "SPY", asOfDateKey: "2026-10-08", nearExpiration: "2026-10-09", farExpiration: "2026-10-12", methodVersion: version, gexRegime: { totalNetGex: 5, gammaFlip: 776, spot: 775, regime: "positive", callWall: 780, putWall: 775 }, termStructure: null, flowAtWalls: { callWallFlowRatio: 1, putWallFlowRatio: 1 }, quadrant: "bullish-stable", dataLimitations: [] });
  const added = await L.logSignal(signal("gex-v2"));
  t("a v2 signal is logged even though a v1 row exists for the same expiration", added !== null && added.methodVersion === "gex-v2");
  t("the same v2 signal is not logged twice", (await L.logSignal(signal("gex-v2"))) === null);
  const onDisk = JSON.parse(readFileSync(path.join(dir, "gex-paper-backtest-log.json"), "utf8"));
  t("the log now holds the old row untouched and the new stamped row", onDisk.length === 2 && onDisk[0].methodVersion === undefined && onDisk[0].callWall === 767 && onDisk[1].methodVersion === "gex-v2");
  t("a signal with no version is treated as v1 and is blocked by the existing v1 row", (await L.logSignal(signal(undefined))) === null);
}

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
