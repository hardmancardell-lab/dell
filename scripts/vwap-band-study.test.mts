// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/vwap-band-study.test.mts
// Tests the session building and the pure analysis step of the VWAP band study (no network).
import { readFileSync } from "node:fs";
import * as S from "../src/lib/agents/trading-agent/skills/vwap-band-study.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const load = (f: string) => JSON.parse(readFileSync(new URL("./fixtures/" + f, import.meta.url), "utf8")).bars.map(([datetime, open, high, low, close, volume]) => ({ datetime, open, high, low, close, volume }));

t("asset kind: EUR/USD shape is forex, tickers are equity", S.assetKindOf("gbp/jpy") === "forex" && S.assetKindOf("GBP/JPY") === "forex" && S.assetKindOf("SPY") === "equity" && S.assetKindOf("BRK.B") === "equity");

// London local time handles summer (BST, UTC+1) and winter (GMT, UTC)
const summer = S.londonLocal(Date.UTC(2026, 6, 15, 7, 0));
const winter = S.londonLocal(Date.UTC(2026, 11, 15, 8, 0));
t("London time: 07:00 UTC in July is 08:00 local", summer.dateKey === "2026-07-15" && summer.minutes === 480, JSON.stringify(summer));
t("London time: 08:00 UTC in December is 08:00 local", winter.dateKey === "2026-12-15" && winter.minutes === 480, JSON.stringify(winter));
t("London time: reports the weekday", S.londonLocal(Date.UTC(2026, 9, 10, 12, 0)).weekday === "Sat", S.londonLocal(Date.UTC(2026, 9, 10, 12, 0)).weekday);

// equities
const spy = load("spy_5m_regular_session.json");
const built = S.buildSessions(spy, "equity");
t("equity sessions: 60 full sessions of 78 bars, none skipped", built.sessions.length === 60 && built.barsPerSession === 78 && built.skippedShort === 0, `${built.sessions.length} ${built.barsPerSession} ${built.skippedShort}`);
const half = { dateKey: "2026-11-27", bars: built.sessions[0].bars.slice(0, 42) };
// a half day added as raw candles: shift its timestamps to a new date so grouping sees a separate short session
const shifted = half.bars.map((b) => ({ ...b, datetime: b.datetime + 200 * 86_400_000 }));
const withHalf = S.buildSessions([...spy, ...shifted], "equity");
t("a half day is skipped and counted", withHalf.sessions.length === 60 && withHalf.skippedShort === 1, `${withHalf.sessions.length} ${withHalf.skippedShort}`);

const res = S.analyzeSessions("SPY", "equity", built, 90);
t("analysis: 40 sessions tested, 100 touches", res.sessionsTested === 40 && res.overall.n === 100, `${res.sessionsTested} ${res.overall.n}`);
t("analysis: six volume-class rows, with the spec's Scenario B row", res.byVolumeClass.length === 6 && res.byVolumeClass[5].label.startsWith("Spec Scenario B") && res.byVolumeClass[5].n === 77, JSON.stringify(res.byVolumeClass.map((c) => c.n)));
t("analysis: two side rows add up to the total", res.bySide.length === 2 && res.bySide[0].n + res.bySide[1].n === 100);
t("analysis: forward ranges for both sides and six horizons", res.forwardRanges.length === 12);
t("analysis: band width is about 0.26% over the tested sessions", res.bandWidth && res.bandWidth.meanPct > 0.2 && res.bandWidth.meanPct < 0.35, JSON.stringify(res.bandWidth));
t("analysis: readout says the average is about zero and flags the Z < 1.0 overlap", res.readout.some((r) => /about zero/.test(r)) && res.readout.some((r) => /Z < 1\.0 covers 77%/.test(r)), JSON.stringify(res.readout));
t("analysis: readout never recommends anything", !res.readout.concat(res.dataLimitations).some((r) => /\b(buy|sell short|you should|we recommend|go long|go short)\b/i.test(r)), JSON.stringify(res.readout));
t("analysis: trade list is capped and newest-last", res.trades.length === 100 && res.trades[0].entryTimeMs < res.trades[99].entryTimeMs);
t("analysis: states hypothetical, costs and the stop-versus-target assumption", res.dataLimitations.some((d) => /before spread, slippage and fees/.test(d)) && res.dataLimitations.some((d) => /stop is assumed first/.test(d)));
t("analysis: default parameters are the spec's (2 sigma, 3 sigma stop, 30 minutes, 20 days)", res.params.k === 2 && res.params.stopK === 3 && res.params.warmupMinutes === 30 && res.params.baselineDays === 20 && res.params.useLogVolume === false);
const log = S.analyzeSessions("SPY", "equity", built, 90, { useLogVolume: true });
t("log-volume option changes the volume classes but not the touches", log.overall.n === 100 && JSON.stringify(log.byVolumeClass.map((c) => c.n)) !== JSON.stringify(res.byVolumeClass.map((c) => c.n)));
const k15 = S.analyzeSessions("SPY", "equity", built, 90, { k: 1.5 });
t("k = 1.5 widens the net (more touches, narrower band)", k15.overall.n === 140 && k15.bandWidth.meanPct < res.bandWidth.meanPct, `${k15.overall.n}`);

// forex with no volume feed (the free GBP/JPY fixture): London session, plain average, no Z
const fx = load("gbpjpy_5m_london_session.json");
const fxBuilt = S.buildSessions(fx, "forex");
t("forex sessions: 59 London sessions of 108 bars", fxBuilt.sessions.length === 59 && fxBuilt.barsPerSession === 108, `${fxBuilt.sessions.length} ${fxBuilt.barsPerSession}`);
const fxRes = S.analyzeSessions("GBP/JPY", "forex", fxBuilt, 90);
t("forex with no volume: 259 touches and no Z-scores", fxRes.sessionsTested === 59 && fxRes.overall.n === 259 && fxRes.trades.every((x) => x.volumeZ === null), `${fxRes.sessionsTested} ${fxRes.overall.n}`);
t("forex with no volume: says so, and the readout notes tick volume for forex", fxRes.dataLimitations[0].startsWith("This feed carries no volume") && fxRes.readout.some((r) => /tick count/.test(r)));
// give the same forex bars a tick count: Z-scores come back
const ticks = fx.map((b, i) => ({ ...b, volume: 50 + ((i * 7) % 40) }));
const fxTick = S.analyzeSessions("GBP/JPY", "forex", S.buildSessions(ticks, "forex"), 90);
t("forex with a tick-count feed gets Z-scores after the baseline sessions", fxTick.sessionsTested === 39 && fxTick.trades.length > 0 && fxTick.trades.every((x) => x.volumeZ !== null), `${fxTick.sessionsTested}`);

// empty and tiny inputs
const empty = S.analyzeSessions("X", "equity", { sessions: [], skippedShort: 0, barsPerSession: 0 }, 60);
t("no sessions gives an empty, safe result", empty.sessionsTested === 0 && empty.overall.n === 0 && empty.readout[0].startsWith("No band touches"));

console.log(bad ? `\n${bad} FAILED` : "\nall checks passed");
process.exit(bad ? 1 : 0);
