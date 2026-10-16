// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/option-flow-snapshot.test.mts
// Offline checks of the intraday option-flow snapshot logger: the pure row builder, bucketing, session hours, and the
// service that the cron route runs (with stubbed provider and database, no network).
import * as F from "../src/lib/agents/trading-agent/skills/option-flow-snapshot.ts";
import { runOptionFlowTick } from "../src/lib/agents/trading-agent/skills/option-flow-service.ts";

let bad = 0;
const t = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail);
};
const close = (a: number | null, b: number, eps = 1e-9) => a !== null && Math.abs(a - b) < eps;

const c = (strike: number, totalVolume: number, openInterest: number, bid: number, ask: number, last: number, volatility = 25, expirationDate = "2026-10-16") => ({
  strikePrice: strike, expirationDate, daysToExpiration: 1, bid, ask, last, openInterest, totalVolume, volatility, delta: 0, gamma: 0, theta: 0, vega: 0,
});
const chainOf = (calls, puts) => ({ symbol: "TST", calls, puts });
// 2026-10-15 is a Thursday; 14:00Z = 10:00 EDT.
const T0 = Date.UTC(2026, 9, 15, 14, 0, 7);
const MIN = 60_000;

// ---------------------------------------------------------------- bucketing and session hours
{
  const b = F.bucketStartMs(Date.UTC(2026, 9, 15, 14, 7, 42));
  t("bucket start floors to the 5-minute boundary", new Date(b).toISOString() === "2026-10-15T14:05:00.000Z", new Date(b).toISOString());
  t("a time exactly on the boundary is its own bucket", F.bucketStartMs(Date.UTC(2026, 9, 15, 14, 5, 0)) === Date.UTC(2026, 9, 15, 14, 5, 0));
  t("last second before a boundary stays in the earlier bucket", F.bucketStartMs(Date.UTC(2026, 9, 15, 14, 4, 59, 999)) === Date.UTC(2026, 9, 15, 14, 0, 0));
  // Standard time: ET boundaries are still on whole 5 minutes of UTC.
  t("bucketing is unchanged in winter (EST)", new Date(F.bucketStartMs(Date.UTC(2026, 11, 15, 15, 33, 1))).toISOString() === "2026-12-15T15:30:00.000Z");
  t("session date is the ET date, not the UTC date", F.sessionDateET(Date.UTC(2026, 9, 16, 1, 30)) === "2026-10-15");

  const s = F.isRegularSession;
  // Spring forward: Sunday 8 March 2026. Friday 6 March is EST (UTC-5), Monday 9 March is EDT (UTC-4).
  t("9:30 EST open (Fri 6 Mar, 14:30Z) is in session", s(Date.UTC(2026, 2, 6, 14, 30)));
  t("9:29 EST (14:29Z) is not", !s(Date.UTC(2026, 2, 6, 14, 29)));
  t("9:30 EDT open (Mon 9 Mar, 13:30Z) is in session", s(Date.UTC(2026, 2, 9, 13, 30)));
  t("9:29 EDT (13:29Z) is not", !s(Date.UTC(2026, 2, 9, 13, 29)));
  t("14:30Z on Monday 9 Mar is 10:30 EDT, in session", s(Date.UTC(2026, 2, 9, 14, 30)));
  // Fall back: Sunday 1 November 2026.
  t("Fri 30 Oct (EDT) 13:30Z is in session", s(Date.UTC(2026, 9, 30, 13, 30)));
  t("Mon 2 Nov (EST) 13:30Z is only 8:30 ET, not in session", !s(Date.UTC(2026, 10, 2, 13, 30)));
  t("Mon 2 Nov (EST) 14:30Z is 9:30 ET, in session", s(Date.UTC(2026, 10, 2, 14, 30)));
  t("15:59:59 ET is in session", s(Date.UTC(2026, 9, 15, 19, 59, 59)));
  t("16:00:00 ET is not (end exclusive)", !s(Date.UTC(2026, 9, 15, 20, 0, 0)));
  t("Saturday and Sunday midday are not", !s(Date.UTC(2026, 9, 17, 16, 0)) && !s(Date.UTC(2026, 9, 18, 16, 0)));
  t("a weekday at 3am ET is not", !s(Date.UTC(2026, 9, 15, 7, 0)));
}

// ---------------------------------------------------------------- put/call by volume, premium and open interest
const E1 = "2026-10-16", E2 = "2026-10-23";
const chain1 = chainOf(
  [c(100, 100, 1000, 1.9, 2.1, 2.0), c(105, 50, 400, 0.4, 0.6, 0.5)],
  [c(100, 60, 800, 1.4, 1.6, 1.5), c(95, 40, 300, 0.2, 0.4, 0.3)],
);
const chain2 = chainOf([c(100, 30, 500, 3.0, 3.2, 3.1, 24, E2)], [c(100, 20, 600, 2.9, 3.1, 3.0, 26, E2)]);
const build = (over = {}) => F.buildOptionFlowRow({
  symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: null,
  flowChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }], ...over,
});
{
  const r = build();
  t("cumulative call and put volume sum over the flow window", r.call_volume === 180 && r.put_volume === 120, `${r.call_volume}/${r.put_volume}`);
  t("P/C by volume = puts / calls", close(r.pc_volume, 120 / 180), String(r.pc_volume));
  // premium: calls 100*2*100 + 50*0.5*100 + 30*3.1*100 ; puts 60*1.5*100 + 40*0.3*100 + 20*3.0*100
  const callPrem = 100 * 2 * 100 + 50 * 0.5 * 100 + 30 * 3.1 * 100, putPrem = 60 * 1.5 * 100 + 40 * 0.3 * 100 + 20 * 3.0 * 100;
  t("premium = volume x mid x 100", close(r.call_premium, callPrem, 0.01) && close(r.put_premium, putPrem, 0.01), `${r.call_premium}/${r.put_premium}`);
  t("P/C by premium", close(r.pc_premium, putPrem / callPrem, 1e-6), String(r.pc_premium));
  t("the snapshot time is the 5-minute bucket and the actual fetch time is kept", r.snapshot_time === "2026-10-15T14:00:00.000Z" && r.actual_fetch_time === new Date(T0).toISOString());
  t("session date is the ET date", r.session_date === "2026-10-15");
  t("expirations used are recorded", r.expirations_used.join() === `${E1},${E2}` && r.expirations_failed.length === 0);

  const withOi = build({ oiChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }] });
  // calls OI 1000+400+500=1900 ; puts 800+300+600=1700
  t("P/C by open interest uses the OI chains", withOi.oi_call === 1900 && withOi.oi_put === 1700 && close(withOi.pc_oi, 1700 / 1900), String(withOi.pc_oi));
  t("no OI pass and no previous leaves OI null", r.pc_oi === null && r.oi_call === null);
}

// ---------------------------------------------------------------- premium price fallbacks
{
  const priced = F.contractPrice({ bid: 1, ask: 2, last: 9 });
  t("mid is used when both sides are positive", priced.source === "mid" && priced.price === 1.5);
  t("no bid: last is used", F.contractPrice({ bid: 0, ask: 2, last: 1.2 }).source === "last");
  t("crossed quote: last is used", F.contractPrice({ bid: 3, ask: 2, last: 1.2 }).source === "last");
  t("nothing usable: unpriced, price 0", F.contractPrice({ bid: 0, ask: 0, last: 0 }).source === "none");
  const r = F.buildOptionFlowRow({
    symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: null,
    flowChains: [{ expiration: E1, chain: chainOf([c(100, 10, 1, 0, 0, 2.0), c(101, 5, 1, 0, 0, 0)], [c(100, 10, 1, 1, 1.2, 0)]) }],
  });
  t("volume priced at last is counted as a fallback, volume with no price as unpriced", r.premium_fallback_volume === 10 && r.premium_unpriced_volume === 5 && close(r.call_premium, 10 * 2 * 100), `${r.premium_fallback_volume}/${r.premium_unpriced_volume}/${r.call_premium}`);
}

// ---------------------------------------------------------------- zero denominators
{
  const noCalls = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: null, flowChains: [{ expiration: E1, chain: chainOf([], [c(100, 10, 5, 1, 1.2, 1.1)]) }] });
  t("zero call volume gives P/C null, not Infinity", noCalls.pc_volume === null && noCalls.pc_premium === null);
  const empty = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: [{ expiration: E1, chain: chainOf([], []) }], flowChains: [{ expiration: E1, chain: chainOf([], []) }] });
  t("an empty chain gives null ratios and a zero_volume flag", empty.pc_volume === null && empty.pc_oi === null && empty.flags.includes("zero_volume") && empty.call_volume === 0);
  t("pcRatio never returns Infinity or NaN", F.pcRatio(5, 0) === null && F.pcRatio(0, 0) === null && F.pcRatio(NaN, 3) === null && F.pcRatio(0, 3) === 0);
  const allNull = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: null, flowChains: [{ expiration: E1, chain: null }] });
  t("a chain that failed to load is reported, not counted", allNull.expirations_failed.join() === E1 && allNull.expirations_used.length === 0 && allNull.flags.includes("chain_load_failed"));
  let threw = false;
  try { F.buildOptionFlowRow({ symbol: "TST", spot: 0, fetchedAtMs: T0, previous: null, oiChains: null, flowChains: [] }); } catch { threw = true; }
  t("an unusable spot throws", threw);
}

// ---------------------------------------------------------------- deltas between two snapshots
const first = build({ oiChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }] });
{
  t("the first snapshot of a session has no delta, no aggressor split and is flagged", first.new_call_volume === null && first.new_put_volume === null && first.pc_new_volume === null && first.agg_call_buy === null && first.minutes_since_prev === null && first.flags.includes("first_of_session"));
  t("first snapshot: change since first is 0", first.pc_volume_chg === 0 && first.first_pc_volume === first.pc_volume);

  // 5 minutes later: +20 calls @100 (E1), +30 puts @100 (E1), +10 puts @95 (E1), +5 calls (E2)
  const chain1b = chainOf(
    [c(100, 120, 1000, 2.0, 2.2, 2.2), c(105, 50, 400, 0.4, 0.6, 0.5)],
    [c(100, 90, 800, 1.5, 1.7, 1.5), c(95, 50, 300, 0.3, 0.5, 0.3)],
  );
  const chain2b = chainOf([c(100, 35, 500, 3.0, 3.2, 3.1, 24, E2)], [c(100, 20, 600, 2.9, 3.1, 3.0, 26, E2)]);
  const T1 = T0 + 5 * MIN + 3000;
  const second = F.buildOptionFlowRow({ symbol: "TST", spot: 100.5, fetchedAtMs: T1, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1b }, { expiration: E2, chain: chain2b }] });
  t("new volume is the like-for-like difference per side", second.new_call_volume === 25 && second.new_put_volume === 40, `${second.new_call_volume}/${second.new_put_volume}`);
  t("P/C on only the new volume", close(second.pc_new_volume, 40 / 25), String(second.pc_new_volume));
  t("minutes since previous uses the actual fetch times", close(second.minutes_since_prev, 5.05, 0.01), String(second.minutes_since_prev));
  t("change in cumulative P/C since the first snapshot", close(second.pc_volume_chg, (160 / 205) - (120 / 180), 1e-9), String(second.pc_volume_chg));
  t("first_pc_volume is carried forward unchanged", second.first_pc_volume === first.pc_volume);
  t("OI totals are carried from the previous snapshot when no OI pass ran", second.oi_call === 1900 && second.oi_put === 1700 && second.oi_asof === first.oi_asof);
  t("a normal second snapshot is neither stale nor clamped", !second.stale && !second.clamped && !second.flags.includes("gap"));

  // Aggressor proxy: previous snapshot stored these contracts. Deltas: E1 100c +20 (last 2.2 >= ask 2.2: buy), E1 100p +30 (last 1.5 inside 1.5-1.7: bid=1.5 -> last<=bid: sell),
  // E1 95p +10 (last 0.3 <= bid 0.3... bid 0.3 -> sell? 0.3<=0.3 yes sell), E2 100c +5 (last 3.1 inside 3.0-3.2: unclassified)
  t("aggressor proxy: call bought at the ask", second.agg_call_buy === 20, String(second.agg_call_buy));
  t("aggressor proxy: puts hit at the bid", second.agg_put_sell === 40 && second.agg_put_buy === 0, `${second.agg_put_sell}/${second.agg_put_buy}`);
  t("aggressor proxy: a trade between bid and ask is unclassified", second.agg_call_sell === 0 && second.agg_unclassified === 5, String(second.agg_unclassified));
  t("buy + sell + unclassified add back to the new volume", second.agg_call_buy + second.agg_call_sell + second.agg_put_buy + second.agg_put_sell + second.agg_unclassified === 65);

  // Stale: nothing moved
  const same = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T1, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }] });
  t("unchanged cumulative volume is flagged stale, with zero new volume and null new P/C", same.stale && same.new_call_volume === 0 && same.new_put_volume === 0 && same.pc_new_volume === null && same.flags.includes("stale"));

  // A bucket that is not later than the previous one, or another session, is not a usable "previous".
  const sameBucket = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 20_000, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1b }, { expiration: E2, chain: chain2b }] });
  t("a re-run inside the same bucket does not use that bucket's own row as previous", sameBucket.new_call_volume === null && sameBucket.flags.includes("first_of_session"));
  const nextDay = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 86_400_000, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1b }, { expiration: E2, chain: chain2b }] });
  t("a previous row from another session is ignored (volumes reset daily)", nextDay.new_call_volume === null && nextDay.oi_call === null);
}

// ---------------------------------------------------------------- clamping when cumulative volume drops
{
  const lower = chainOf([c(100, 70, 1000, 1.9, 2.1, 2.0), c(105, 50, 400, 0.4, 0.6, 0.5)], [c(100, 60, 800, 1.4, 1.6, 1.5), c(95, 55, 300, 0.2, 0.4, 0.3)]);
  const r = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 5 * MIN, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: lower }, { expiration: E2, chain: chain2 }] });
  // E1 calls fell 150 -> 120 (clamped to 0), puts rose 100 -> 115 (+15); E2 unchanged
  t("a falling cumulative volume is clamped at 0 and flagged", r.new_call_volume === 0 && r.new_put_volume === 15 && r.clamped && r.flags.includes("volume_dropped"), `${r.new_call_volume}/${r.new_put_volume}/${r.clamped}`);
  t("a clamped snapshot is not marked stale when something else moved", !r.stale);
  const reset = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 5 * MIN, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chainOf([c(100, 3, 1, 1, 1.2, 1.1)], [c(100, 2, 1, 1, 1.2, 1.1)]) }, { expiration: E2, chain: chainOf([], []) }] });
  t("a full reset (volume restarts from a small number) clamps to 0 on both sides", reset.new_call_volume === 0 && reset.new_put_volume === 0 && reset.clamped);
  // An expiration dropping out of the window must not look like negative volume.
  const lost = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 5 * MIN, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: null }] });
  t("a chain that failed to load is left out of the delta, flagged, and not read as a volume drop", lost.new_call_volume === 0 && !lost.clamped && lost.flags.includes("expirations_changed") && lost.flags.includes("chain_load_failed"));
  const gap = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 17 * MIN, previous: first, oiChains: null, flowChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }] });
  t("a long gap since the previous snapshot is flagged", gap.flags.includes("gap") && close(gap.minutes_since_prev, 17, 0.01));
}

// ---------------------------------------------------------------- stale on a holiday (first snapshot equals the prior session's close)
{
  const prior = { ...first, session_date: "2026-10-14", snapshot_time: "2026-10-14T19:55:00.000Z" };
  const r = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, priorSessionFinal: prior, oiChains: null, flowChains: [{ expiration: E1, chain: chain1 }, { expiration: E2, chain: chain2 }] });
  t("a first snapshot identical to the prior session's final is flagged stale", r.stale && r.flags.includes("same_as_prior_session"));
  const normal = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, priorSessionFinal: prior, oiChains: null, flowChains: [{ expiration: E1, chain: chainOf([c(100, 2, 1, 1, 1.2, 1.1)], []) }, { expiration: E2, chain: chain2 }] });
  t("a first snapshot with different volume is not", !normal.stale);
}

// ---------------------------------------------------------------- aggressor proxy on hand cases
{
  const k = F.classifyAggressor;
  t("last at the ask is buy-side", k({ bid: 1.0, ask: 1.2, last: 1.2 }) === "buy");
  t("last above the ask is buy-side", k({ bid: 1.0, ask: 1.2, last: 1.25 }) === "buy");
  t("last at the bid is sell-side", k({ bid: 1.0, ask: 1.2, last: 1.0 }) === "sell");
  t("last below the bid is sell-side", k({ bid: 1.0, ask: 1.2, last: 0.95 }) === "sell");
  t("last between bid and ask is unclassified", k({ bid: 1.0, ask: 1.2, last: 1.1 }) === null);
  t("no quote, crossed quote, locked market or no last are unclassified", k({ bid: 0, ask: 0, last: 1 }) === null && k({ bid: 1.3, ask: 1.2, last: 1.2 }) === null && k({ bid: 1.1, ask: 1.1, last: 1.1 }) === null && k({ bid: 1, ask: 1.2, last: 0 }) === null);
  t("a one-sided quote (bid 0) still classifies a trade at the ask", k({ bid: 0, ask: 0.05, last: 0.05 }) === "buy");

  // Volume outside the previous snapshot's stored contracts cannot be split: it stays unclassified.
  const wide = chainOf([c(100, 10, 5, 1, 1.2, 1.2), c(150, 10, 5, 1, 1.2, 1.2)], []);
  const p1 = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0, previous: null, oiChains: null, flowChains: [{ expiration: E1, chain: wide }] });
  const wide2 = chainOf([c(100, 15, 5, 1, 1.2, 1.2), c(150, 25, 5, 1, 1.2, 1.2)], []);
  const p2 = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 5 * MIN, previous: p1, oiChains: null, flowChains: [{ expiration: E1, chain: wide2 }] });
  t("new volume on a far strike (outside the stored band) is unclassified, near strike classified", p2.new_call_volume === 20 && p2.agg_call_buy === 5 && p2.agg_unclassified === 15, `${p2.agg_call_buy}/${p2.agg_unclassified}`);
  // A near contract that did not exist in the previous snapshot's stored list (no volume or OI then) has a baseline of 0.
  const fresh = chainOf([c(100, 10, 5, 1, 1.2, 1.2), c(101, 8, 0, 1, 1.2, 1.0)], []);
  const p3 = F.buildOptionFlowRow({ symbol: "TST", spot: 100, fetchedAtMs: T0 + 10 * MIN, previous: p1, oiChains: null, flowChains: [{ expiration: E1, chain: fresh }] });
  t("a contract absent from the previous stored list but inside its band counts from 0", p3.agg_call_sell === 8 && p3.agg_call_buy === 0, `${p3.agg_call_sell}/${p3.agg_call_buy}`);
}

// ---------------------------------------------------------------- ATM IV
{
  const ch = chainOf([c(100, 1, 1, 1, 1.2, 1.1, 20), c(105, 1, 1, 1, 1.2, 1.1, 30)], [c(100, 1, 1, 1, 1.2, 1.1, 24)]);
  t("ATM IV is the mean of call and put IV at the strike nearest spot, as a fraction", close(F.atmIv(ch, 101), 0.22, 1e-9), String(F.atmIv(ch, 101)));
  t("ATM IV is null when nothing near spot has an IV", F.atmIv(chainOf([c(100, 1, 1, 1, 1.2, 1.1, 0)], []), 100) === null && F.atmIv(chainOf([c(150, 1, 1, 1, 1.2, 1.1, 20)], []), 100) === null);
  const r = build();
  t("IV is recorded for the nearest and the next expiration", close(r.iv_atm_near, 0.25) && close(r.iv_atm_next, 0.25), `${r.iv_atm_near}/${r.iv_atm_next}`);
}

// ---------------------------------------------------------------- the per-contract jsonb
{
  // SPY-like worst case: $1 strikes, 3 expirations, +-10% of 600.
  const spot = 600;
  const mk = (exp: string) => {
    const calls = [], puts = [];
    for (let k = 400; k <= 800; k++) {
      calls.push(c(k, Math.round(1000 / (1 + Math.abs(k - spot))), 5000, 1.23, 1.25, 1.24, 18.3456, exp));
      puts.push(c(k, Math.round(900 / (1 + Math.abs(k - spot))), 4000, 1.13, 1.15, 1.14, 19.1234, exp));
    }
    return chainOf(calls, puts);
  };
  const loaded = [{ expiration: "2026-10-15", chain: mk("2026-10-15") }, { expiration: "2026-10-16", chain: mk("2026-10-16") }, { expiration: "2026-10-19", chain: mk("2026-10-19") }, { expiration: "2026-10-20", chain: mk("2026-10-20") }];
  const tuples = F.buildNearMoneyContracts(loaded, spot);
  const strikes = tuples.map((x) => x[1]);
  t("only strikes within +-10% of spot are kept", Math.min(...strikes) >= 540 && Math.max(...strikes) <= 660, `${Math.min(...strikes)}..${Math.max(...strikes)}`);
  t("only the first three expirations are kept", Math.max(...tuples.map((x) => x[0])) === 2 && new Set(tuples.map((x) => x[0])).size === 3);
  t("tuple layout is [expIdx, strike, right, volume, oi, bid, ask, last, iv]", tuples[0].length === 9 && tuples[0][2] === "c" && tuples[0][8] === 0.1835, JSON.stringify(tuples[0]));
  const bytes = JSON.stringify(tuples).length;
  // 3 expirations x 121 strikes x 2 rights = 726 contracts at about 45 bytes each.
  t("worst-case SPY-like jsonb stays under 40 KB per row", tuples.length === 726 && bytes < 40_000, `${tuples.length} contracts, ${bytes} bytes`);
  console.log(`INFO  SPY-like per-contract jsonb: ${tuples.length} contracts, ${bytes} bytes`);
  const dead = F.buildNearMoneyContracts([{ expiration: E1, chain: chainOf([c(100, 0, 0, 0, 0, 0), c(101, 0, 7, 1, 1.2, 1.1)], []) }], 100);
  t("contracts with no volume and no open interest are left out", dead.length === 1 && dead[0][1] === 101);
}

// ---------------------------------------------------------------- status chip
{
  const now = Date.UTC(2026, 9, 15, 15, 0, 0); // 11:00 ET Thursday
  t("fresh row during the session: running", F.loggingStatus({ lastFetchMs: now - 4 * MIN, nowMs: now, viewingDate: "2026-10-15" }).state === "running");
  const late = F.loggingStatus({ lastFetchMs: now - 23 * MIN, nowMs: now, viewingDate: "2026-10-15" });
  t("old row during the session: delayed, with the minutes", late.state === "delayed" && late.minutesAgo === 23);
  t("no rows during the session: not running", F.loggingStatus({ lastFetchMs: null, nowMs: now, viewingDate: "2026-10-15" }).state === "not_running");
  t("outside the session: closed", F.loggingStatus({ lastFetchMs: now - 600 * MIN, nowMs: Date.UTC(2026, 9, 15, 22, 0), viewingDate: "2026-10-15" }).state === "closed");
  t("another date: historical", F.loggingStatus({ lastFetchMs: now, nowMs: now, viewingDate: "2026-10-14" }).state === "historical");
}

// ---------------------------------------------------------------- the service the cron route runs (stubbed provider and database)
{
  const stored = new Map<string, any>();
  const calls = { expirations: 0, chains: 0, quotes: 0, oiExpirations: [] as string[][] };
  const chainFor = (exp: string) => chainOf(
    [c(100, 100 + Number(exp.slice(-2)), 500, 1.9, 2.1, 2.0, 25, exp)],
    [c(100, 80, 500, 1.4, 1.6, 1.5, 26, exp)],
  );
  const mkDeps = (over = {}) => ({
    getExpirations: async (_s: string) => { calls.expirations++; return ["2026-10-15", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-20", "2026-12-18", "2027-03-19"]; },
    fetchChain: async (_s: string, exp: string) => { calls.chains++; return chainFor(exp); },
    fetchQuote: async (s: string) => { calls.quotes++; if (s === "BAD") throw new Error("quote down"); return { lastPrice: 100 }; },
    getPrevious: async (s: string, date: string, before: string) => [...stored.values()].filter((r) => r.symbol === s && r.session_date === date && r.snapshot_time < before).sort((a, b) => (a.snapshot_time < b.snapshot_time ? 1 : -1))[0] ?? null,
    getPriorSessionFinal: async () => null,
    upsert: async (row: any) => { stored.set(`${row.symbol}|${row.snapshot_time}`, row); },
    ...over,
  });

  const r1 = await runOptionFlowTick({ nowMs: T0, symbols: ["SPY", "BAD", "QQQ"], deps: mkDeps(), concurrency: 2, maxOiPassesPerRun: 1 });
  t("one failing symbol does not fail the others", r1.results.length === 3 && r1.results.find((x) => x.symbol === "BAD")?.ok === false && r1.results.filter((x) => x.ok).length === 2, JSON.stringify(r1.results.map((x) => [x.symbol, x.ok])));
  t("rows are written per symbol and bucket", stored.has("SPY|2026-10-15T14:00:00.000Z") && stored.has("QQQ|2026-10-15T14:00:00.000Z") && !stored.has("BAD|2026-10-15T14:00:00.000Z"));
  const spy = stored.get("SPY|2026-10-15T14:00:00.000Z");
  t("the flow window is capped to 10 days and 6 expirations", spy.expirations_used.join() === "2026-10-15,2026-10-16,2026-10-23", spy.expirations_used.join());
  t("only the first symbol in line got the OI pass (budget 1 per run)", spy.oi_call !== null && stored.get("QQQ|2026-10-15T14:00:00.000Z").oi_call === null);
  t("the OI pass covers the 45-day window", spy.oi_expirations_used.join() === "2026-10-15,2026-10-16,2026-10-23,2026-10-30,2026-11-20", spy.oi_expirations_used.join());
  t("each symbol reports its provider calls", r1.results[0].providerCalls === 1 + 1 + 5 && r1.results[2].providerCalls === 1 + 1 + 3, JSON.stringify(r1.results.map((x) => x.providerCalls)));

  const r2 = await runOptionFlowTick({ nowMs: T0 + 5 * MIN, symbols: ["SPY", "QQQ"], deps: mkDeps(), concurrency: 2, maxOiPassesPerRun: 1 });
  const spy2 = stored.get("SPY|2026-10-15T14:05:00.000Z"), qqq2 = stored.get("QQQ|2026-10-15T14:05:00.000Z");
  t("the second tick builds on the stored previous row (SPY carries OI, QQQ now gets its OI pass)", spy2.oi_call === spy.oi_call && spy2.new_call_volume === 0 && spy2.stale && qqq2.oi_call !== null, JSON.stringify([spy2.stale, qqq2.oi_call]));
  const again = await runOptionFlowTick({ nowMs: T0 + 5 * MIN + 20_000, symbols: ["SPY"], deps: mkDeps(), concurrency: 1, maxOiPassesPerRun: 1 });
  t("re-running the same bucket overwrites it (idempotent key symbol + bucket)", [...stored.keys()].filter((k) => k.startsWith("SPY|")).length === 2 && again.results[0].ok);

  const bad = await runOptionFlowTick({ nowMs: T0, symbols: ["SPY"], deps: mkDeps({ getExpirations: async () => [] }), concurrency: 1, maxOiPassesPerRun: 1 });
  t("no expirations is reported as an error for that symbol", bad.results[0].ok === false && /expiration/i.test(bad.results[0].error ?? ""));
  const allFail = await runOptionFlowTick({ nowMs: T0, symbols: ["SPY"], deps: mkDeps({ fetchChain: async () => { throw new Error("boom"); } }), concurrency: 1, maxOiPassesPerRun: 1 });
  t("every chain failing writes nothing and reports an error", allFail.results[0].ok === false);
}

console.log(bad === 0 ? "\nAll checks passed." : `\n${bad} check(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
