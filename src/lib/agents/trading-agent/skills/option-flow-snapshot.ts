// Pure, client-safe module (type-only imports plus time-windows.ts, which is itself pure). The server side fetches the
// chains and picks the expiration windows (windowExpirations in gex-signal.ts); this file only turns chains into one row.
import type { MarketOptionContract, MarketOptionsChain } from "@/lib/data/market-data-types";
import { toEasternParts } from "./time-windows";

/**
 * Intraday option-flow snapshot logger: RAW MEASURES ONLY. Nothing in here labels a snapshot bullish or bearish, picks
 * between the flow reading (high put/call is bearish) and the contrarian reading (high put/call is bullish), or
 * produces a trade signal. The rows exist so both readings can be scored later on forward data
 * (see OPTION_FLOW_LOG_NOTES.md). Nothing here depends on the dealer-sign setting.
 */

/** The names that are logged. Change this one list to add or drop a ticker (UI chooser and cron both read it). */
export const OPTION_FLOW_SYMBOLS: readonly string[] = ["SPY", "QQQ", "NVDA", "DELL", "GLD"];

export const OPTION_FLOW_CONFIG = {
  /** One row per symbol per bucket. */
  intervalMinutes: 5,
  /** "Flow window": expirations within this many calendar days, at most flowMaxExpirations, used for the volume measures. */
  flowWindowDays: 10,
  flowMaxExpirations: 6,
  /** "OI window": the app's GEX window (GEX_WINDOW_DAYS / GEX_MAX_WINDOW_EXPIRATIONS in gex-signal.ts), used for open-interest put/call. */
  oiWindowDays: 45,
  oiMaxExpirations: 12,
  /** Per-contract detail: strikes within this share of spot, first N expirations of the flow window. */
  contractBandPct: 0.1,
  contractExpirations: 3,
  /** Retention: the per-contract jsonb is the bulk of each row, so it is dropped first; the scalar columns are kept much longer. */
  detailRetentionDays: 14,
  rowRetentionDays: 400,
  /** A snapshot is "running" if the newest row was fetched within this many minutes (one interval plus GitHub Actions slack). */
  runningMaxAgeMinutes: 9,
} as const;

const MIN_MS = 60_000;
const BUCKET_MS = OPTION_FLOW_CONFIG.intervalMinutes * MIN_MS;
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;

// ---------------------------------------------------------------- time helpers

/** Start of the 5-minute bucket containing `ms`. All US Eastern offsets are whole hours, so flooring epoch time lands on ET :00, :05, ... */
export function bucketStartMs(ms: number): number {
  return Math.floor(ms / BUCKET_MS) * BUCKET_MS;
}

/** The ET calendar date (YYYY-MM-DD) of a timestamp. */
export function sessionDateET(ms: number): string {
  return toEasternParts(ms).dateKey;
}

/** Regular US equity session: Monday-Friday, 9:30 <= ET time < 16:00, DST-safe. Holidays are not known here: the provider returns stale or zero volume and the row is flagged. */
export function isRegularSession(ms: number): boolean {
  const { dateKey, minutesSinceMidnight } = toEasternParts(ms);
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return dow >= 1 && dow <= 5 && minutesSinceMidnight >= OPEN_MIN && minutesSinceMidnight < CLOSE_MIN;
}

// ---------------------------------------------------------------- types

/** [expIdx, strike, right, volume, openInterest, bid, ask, last, iv]. expIdx indexes expirations_used; iv is a fraction (0.2134), null when the provider gave none. */
export type ContractTuple = [number, number, "c" | "p", number, number, number, number, number, number | null];

/** Which Tradier environment a row's data came from. 'sandbox' is delayed about 15 minutes; 'production' is real-time. */
export type DataFeed = "sandbox" | "production";

export interface OptionFlowRow {
  symbol: string;
  /** Start of the 5-minute bucket (ISO, UTC). */
  snapshot_time: string;
  /** When the data was actually fetched. Scheduled runs can be late or skipped: analyses must use this, not the bucket. */
  actual_fetch_time: string;
  /** ET calendar date of the session. */
  session_date: string;
  spot: number;
  /** Flow-window expirations that loaded (nearest first); the volume measures cover exactly these. */
  expirations_used: string[];
  /** Flow-window expirations whose chain failed to load. */
  expirations_failed: string[];
  /** Cumulative day volume over the flow window. */
  call_volume: number;
  put_volume: number;
  /** Cumulative volume x mid x 100 (last when there is no valid two-sided quote), priced at snapshot time. */
  call_premium: number;
  put_premium: number;
  premium_fallback_volume: number;
  premium_unpriced_volume: number;
  /** Put divided by call. Null when the denominator is 0. */
  pc_volume: number | null;
  pc_premium: number | null;
  pc_oi: number | null;
  /** Open interest over the OI window (carried forward within the session; OI only changes overnight). */
  oi_call: number | null;
  oi_put: number | null;
  oi_expirations_used: string[] | null;
  oi_asof: string | null;
  /** Cumulative volume per flow-window expiration: { "2026-10-16": [callVolume, putVolume] }. Lets the next snapshot take a like-for-like delta. */
  exp_volumes: Record<string, [number, number]>;
  /** Volume since the previous snapshot of the same session. Null on the first snapshot of a session. */
  new_call_volume: number | null;
  new_put_volume: number | null;
  pc_new_volume: number | null;
  minutes_since_prev: number | null;
  /** First snapshot of the session with a defined put/call, carried forward. */
  first_pc_volume: number | null;
  first_pc_premium: number | null;
  pc_volume_chg: number | null;
  pc_premium_chg: number | null;
  /** CRUDE aggressor proxy on the new volume (last vs bid/ask at snapshot time). Approximate: see classifyAggressor. */
  agg_call_buy: number | null;
  agg_call_sell: number | null;
  agg_put_buy: number | null;
  agg_put_sell: number | null;
  agg_unclassified: number | null;
  /** ATM implied vol (fraction) of the nearest and the next flow-window expiration. */
  iv_atm_near: number | null;
  iv_atm_next: number | null;
  /** Cumulative volume did not change since the previous snapshot (or equals the prior session's close on a session's first snapshot: holiday or no data). */
  stale: boolean;
  /** A cumulative volume fell versus the previous snapshot; the delta was clamped at 0. */
  clamped: boolean;
  flags: string[];
  provider_calls: number | null;
  /** The Tradier environment this row was fetched from. Rows logged before the column existed are 'sandbox'. Filter on this before analysis: delayed and real-time rows must not be mixed. */
  data_feed: DataFeed;
  /** Seconds between the fetch and the newest trade / bid / ask timestamp among near-the-money contracts. Null when the provider sent no timestamps. See quoteLagSeconds. */
  quote_lag_seconds: number | null;
  /** Near-the-money contracts for re-analysis. Dropped after detailRetentionDays. */
  contracts: ContractTuple[] | null;
}

export interface FlowChain {
  expiration: string;
  /** Null when the chain failed to load. */
  chain: MarketOptionsChain | null;
}

export interface SnapshotInput {
  symbol: string;
  spot: number;
  /** When the data was fetched (epoch ms). */
  fetchedAtMs: number;
  /** Flow-window chains, nearest expiration first. */
  flowChains: FlowChain[];
  /** OI-window chains (a superset of the flow ones), or null when the OI pass was not run this time: the OI totals are then carried from `previous`. */
  oiChains: FlowChain[] | null;
  /** The latest earlier snapshot of the same symbol and session, or null. */
  previous: OptionFlowRow | null;
  /** Last snapshot of the previous session; only consulted when `previous` is null, to catch holidays serving yesterday's volume. */
  priorSessionFinal?: OptionFlowRow | null;
  providerCalls?: number | null;
  /** Which Tradier environment the chains came from. Required (no default) so a row can never be labelled by accident. */
  dataFeed: DataFeed;
}

// ---------------------------------------------------------------- small maths

const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const vol = (c: MarketOptionContract): number => Math.max(0, finite(c.totalVolume));
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** put / call, null when the call side is 0 (never Infinity or NaN). */
export function pcRatio(put: number, call: number): number | null {
  if (!Number.isFinite(put) || !Number.isFinite(call) || call <= 0) return null;
  const r = put / call;
  return Number.isFinite(r) ? r : null;
}

/** Price used for premium: the mid when both sides of the quote are positive and not crossed, else the last trade, else none. */
export function contractPrice(c: Pick<MarketOptionContract, "bid" | "ask" | "last">): { price: number; source: "mid" | "last" | "none" } {
  const bid = finite(c.bid), ask = finite(c.ask), last = finite(c.last);
  if (bid > 0 && ask > 0 && ask >= bid) return { price: (bid + ask) / 2, source: "mid" };
  if (last > 0) return { price: last, source: "last" };
  return { price: 0, source: "none" };
}

/**
 * CRUDE aggressor proxy for one contract at snapshot time. `last` at or above the ask counts as buy-side, at or below
 * the bid as sell-side, anything else (inside the spread, no or crossed quote, locked market) is unclassified.
 * This is NOT trade classification: Lee-Ready needs every trade matched to the quote prevailing at that moment, and a
 * snapshot only has the latest trade and the current quote. The last trade may be minutes older than the quote, and a
 * contract with several trades in the interval shows only one of them.
 */
export function classifyAggressor(c: Pick<MarketOptionContract, "bid" | "ask" | "last">): "buy" | "sell" | null {
  const bid = finite(c.bid), ask = finite(c.ask), last = finite(c.last);
  if (!(last > 0) || !(ask > 0) || ask < bid) return null;
  const atAsk = last >= ask, atBid = last <= bid;
  if (atAsk && atBid) return null; // locked market
  return atAsk ? "buy" : atBid ? "sell" : null;
}

/** ATM implied vol (fraction) of one expiration: mean of the positive IVs of the call and put at the strike nearest spot, within 3% of spot. Null if none. */
export function atmIv(chain: MarketOptionsChain, spot: number): number | null {
  const all = [...chain.calls, ...chain.puts].filter((c) => finite(c.volatility) > 0 && Math.abs(c.strikePrice - spot) <= spot * 0.03);
  if (all.length === 0) return null;
  const nearest = all.reduce((best, c) => (Math.abs(c.strikePrice - spot) < Math.abs(best - spot) ? c.strikePrice : best), all[0].strikePrice);
  const ivs = all.filter((c) => c.strikePrice === nearest).map((c) => c.volatility / 100);
  return round(ivs.reduce((a, b) => a + b, 0) / ivs.length, 6);
}

// ---------------------------------------------------------------- quote age

/**
 * How old the newest quote is at fetch time, in whole seconds: fetch time minus the newest `quoteTimeMs` (Tradier's
 * trade_date / bid_date / ask_date) among near-the-money contracts (strike within 3% of spot, the same band atmIv
 * uses) of the loaded flow chains. The newest one is used because individual contracts can sit unchanged for a long
 * time; the most active near-ATM contract tracks the feed's delay. Null when no near-the-money contract carries a
 * timestamp. A timestamp slightly in the future (clock skew) counts as 0. With the 15-minute-delayed sandbox feed
 * expect roughly 900 or more; with the production feed during active trading, a few seconds to a minute or so.
 * A large value late in the day or on a quiet name can also mean "nothing traded near the money", not a slow feed.
 */
export function quoteLagSeconds(chains: { chain: MarketOptionsChain }[], spot: number, fetchedAtMs: number): number | null {
  let newest: number | null = null;
  for (const { chain } of chains) {
    for (const c of [...chain.calls, ...chain.puts]) {
      const q = c.quoteTimeMs;
      if (typeof q !== "number" || !Number.isFinite(q) || Math.abs(c.strikePrice - spot) > spot * 0.03) continue;
      if (newest === null || q > newest) newest = q;
    }
  }
  return newest === null ? null : Math.max(0, Math.round((fetchedAtMs - newest) / 1000));
}

// ---------------------------------------------------------------- per-contract jsonb

/** Near-the-money contracts of the first `contractExpirations` flow expirations, as compact tuples. Contracts with no volume and no open interest are left out. */
export function buildNearMoneyContracts(loaded: { expiration: string; chain: MarketOptionsChain }[], spot: number): ContractTuple[] {
  const { contractBandPct, contractExpirations } = OPTION_FLOW_CONFIG;
  const lo = spot * (1 - contractBandPct), hi = spot * (1 + contractBandPct);
  const out: ContractTuple[] = [];
  loaded.slice(0, contractExpirations).forEach(({ chain }, expIdx) => {
    for (const [right, list] of [["c", chain.calls], ["p", chain.puts]] as const) {
      for (const c of list) {
        if (c.strikePrice < lo || c.strikePrice > hi) continue;
        const v = vol(c), oi = Math.max(0, finite(c.openInterest));
        if (v === 0 && oi === 0) continue;
        out.push([expIdx, c.strikePrice, right, v, oi, round(finite(c.bid), 2), round(finite(c.ask), 2), round(finite(c.last), 2), finite(c.volatility) > 0 ? round(c.volatility / 100, 4) : null]);
      }
    }
  });
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : 1));
}

const contractKey = (exp: string, strike: number, right: string) => `${exp}|${strike}|${right}`;

// ---------------------------------------------------------------- row builder

interface SideTotals {
  callVol: number;
  putVol: number;
  callPrem: number;
  putPrem: number;
  fallbackVol: number;
  unpricedVol: number;
  expVol: Record<string, [number, number]>;
}

function flowTotals(loaded: { expiration: string; chain: MarketOptionsChain }[]): SideTotals {
  const t: SideTotals = { callVol: 0, putVol: 0, callPrem: 0, putPrem: 0, fallbackVol: 0, unpricedVol: 0, expVol: {} };
  for (const { expiration, chain } of loaded) {
    let cv = 0, pv = 0;
    for (const [isCall, list] of [[true, chain.calls], [false, chain.puts]] as const) {
      for (const c of list) {
        const v = vol(c);
        if (v === 0) continue;
        const { price, source } = contractPrice(c);
        const prem = v * price * 100;
        if (source === "last") t.fallbackVol += v;
        if (source === "none") t.unpricedVol += v;
        if (isCall) { cv += v; t.callPrem += prem; } else { pv += v; t.putPrem += prem; }
      }
    }
    t.expVol[expiration] = [cv, pv];
    t.callVol += cv;
    t.putVol += pv;
  }
  return t;
}

const oiTotals = (loaded: { chain: MarketOptionsChain }[]) => {
  let call = 0, put = 0;
  for (const { chain } of loaded) {
    for (const c of chain.calls) call += Math.max(0, finite(c.openInterest));
    for (const c of chain.puts) put += Math.max(0, finite(c.openInterest));
  }
  return { call, put };
};

const loadedOnly = (chains: FlowChain[]) => chains.flatMap((c) => (c.chain ? [{ expiration: c.expiration, chain: c.chain }] : []));

/** Builds one snapshot row. Throws only on an unusable spot; everything else degrades to null fields and flags. */
export function buildOptionFlowRow(input: SnapshotInput): OptionFlowRow {
  const { symbol, spot, fetchedAtMs } = input;
  if (input.dataFeed !== "sandbox" && input.dataFeed !== "production") throw new Error(`Option-flow row for ${symbol} needs dataFeed "sandbox" or "production".`);
  if (!(spot > 0) || !Number.isFinite(spot)) throw new Error(`No usable spot price for ${symbol}.`);
  const bucketMs = bucketStartMs(fetchedAtMs);
  const sessionDate = sessionDateET(fetchedAtMs);
  const flags: string[] = [];

  const loaded = loadedOnly(input.flowChains);
  const failed = input.flowChains.filter((c) => !c.chain).map((c) => c.expiration);
  if (failed.length) flags.push("chain_load_failed");
  const totals = flowTotals(loaded);
  if (totals.callVol + totals.putVol === 0) flags.push("zero_volume");

  // Only a snapshot from the same session and an earlier bucket counts as "previous".
  const prev = input.previous && input.previous.session_date === sessionDate && Date.parse(input.previous.snapshot_time) < bucketMs ? input.previous : null;

  // ---- open interest: this run's OI pass, else carried from the previous snapshot of the session
  let oiCall: number | null = null, oiPut: number | null = null, oiExps: string[] | null = null, oiAsof: string | null = null;
  if (input.oiChains) {
    const oiLoaded = loadedOnly(input.oiChains);
    if (oiLoaded.length) {
      const o = oiTotals(oiLoaded);
      oiCall = o.call; oiPut = o.put; oiExps = oiLoaded.map((c) => c.expiration); oiAsof = new Date(fetchedAtMs).toISOString();
      if (oiLoaded.length < input.oiChains.length) flags.push("oi_chain_load_failed");
    }
  } else if (prev && prev.oi_call !== null) {
    oiCall = prev.oi_call; oiPut = prev.oi_put; oiExps = prev.oi_expirations_used; oiAsof = prev.oi_asof;
  }

  // ---- new volume since the previous snapshot, like for like per expiration
  let newCall: number | null = null, newPut: number | null = null, clamped = false, stale = false, minutesSincePrev: number | null = null;
  if (prev) {
    const common = Object.keys(totals.expVol).filter((e) => e in prev.exp_volumes);
    if (common.length !== Object.keys(totals.expVol).length || common.length !== Object.keys(prev.exp_volumes).length) flags.push("expirations_changed");
    let nc = 0, np = 0, moved = false;
    for (const e of common) {
      const dc = totals.expVol[e][0] - prev.exp_volumes[e][0];
      const dp = totals.expVol[e][1] - prev.exp_volumes[e][1];
      if (dc < 0 || dp < 0) clamped = true;
      nc += Math.max(0, dc); np += Math.max(0, dp);
      if (dc !== 0 || dp !== 0) moved = true;
    }
    newCall = nc; newPut = np;
    if (common.length > 0 && !moved) stale = true;
    minutesSincePrev = round((fetchedAtMs - Date.parse(prev.actual_fetch_time)) / MIN_MS, 2);
    if (minutesSincePrev > OPTION_FLOW_CONFIG.intervalMinutes * 1.5) flags.push("gap");
  } else {
    flags.push("first_of_session");
    // A holiday (or a feed that has not rolled) serves the last session's final volume as "today's".
    const pf = input.priorSessionFinal;
    if (pf && pf.session_date < sessionDate) {
      const common = Object.keys(totals.expVol).filter((e) => e in pf.exp_volumes);
      const same = common.length > 0 && common.every((e) => totals.expVol[e][0] === pf.exp_volumes[e][0] && totals.expVol[e][1] === pf.exp_volumes[e][1]);
      if (same && totals.callVol + totals.putVol > 0) { stale = true; flags.push("same_as_prior_session"); }
    }
  }
  // A mid-session switch of feed makes the volume delta span both feeds: cumulative totals stay right, the delta is lumpy.
  if (prev && prev.data_feed !== input.dataFeed) flags.push("feed_changed");
  if (stale) flags.push("stale");
  if (clamped) flags.push("volume_dropped");

  // ---- crude aggressor proxy, contract level, on the near-the-money contracts the previous snapshot also stored
  const contracts = buildNearMoneyContracts(loaded, spot);
  let aggCallBuy: number | null = null, aggCallSell: number | null = null, aggPutBuy: number | null = null, aggPutSell: number | null = null, aggUnclassified: number | null = null;
  if (prev && newCall !== null && newPut !== null) {
    aggCallBuy = aggCallSell = aggPutBuy = aggPutSell = 0;
    if (prev.contracts) {
      const prevVol = new Map<string, number>();
      for (const t of prev.contracts) prevVol.set(contractKey(prev.expirations_used[t[0]] ?? "?", t[1], t[2]), t[3]);
      const pLo = prev.spot * (1 - OPTION_FLOW_CONFIG.contractBandPct), pHi = prev.spot * (1 + OPTION_FLOW_CONFIG.contractBandPct);
      const prevCovered = new Set(prev.expirations_used.slice(0, OPTION_FLOW_CONFIG.contractExpirations));
      let contractDrop = false;
      for (const t of contracts) {
        const [expIdx, strike, right, v, , bid, ask, last] = t;
        const exp = loaded[expIdx].expiration;
        const known = prevVol.get(contractKey(exp, strike, right));
        // Absent from the previous snapshot: if it was inside that snapshot's coverage it simply had no volume or interest (0), else unknown.
        const base = known ?? (prevCovered.has(exp) && strike >= pLo && strike <= pHi ? 0 : null);
        if (base === null) continue;
        const d = v - base;
        if (d < 0) { contractDrop = true; continue; }
        if (d === 0) continue;
        const side = classifyAggressor({ bid, ask, last });
        if (side === null) continue;
        if (right === "c") { if (side === "buy") aggCallBuy += d; else aggCallSell += d; }
        else if (side === "buy") aggPutBuy += d; else aggPutSell += d;
      }
      if (contractDrop) flags.push("contract_volume_dropped");
    } else {
      flags.push("no_prev_contract_detail");
    }
    const classified = aggCallBuy + aggCallSell + aggPutBuy + aggPutSell;
    const totalNew = newCall + newPut;
    if (classified > totalNew) flags.push("agg_exceeds_new_volume");
    aggUnclassified = Math.max(0, totalNew - classified);
  }

  // ---- put/call measures and the change since the session's first defined value
  const pcVol = pcRatio(totals.putVol, totals.callVol);
  const pcPrem = pcRatio(totals.putPrem, totals.callPrem);
  const firstVol = prev ? (prev.first_pc_volume ?? pcVol) : pcVol;
  const firstPrem = prev ? (prev.first_pc_premium ?? pcPrem) : pcPrem;

  return {
    symbol,
    snapshot_time: new Date(bucketMs).toISOString(),
    actual_fetch_time: new Date(fetchedAtMs).toISOString(),
    session_date: sessionDate,
    spot,
    expirations_used: loaded.map((l) => l.expiration),
    expirations_failed: failed,
    call_volume: totals.callVol,
    put_volume: totals.putVol,
    call_premium: round(totals.callPrem, 2),
    put_premium: round(totals.putPrem, 2),
    premium_fallback_volume: totals.fallbackVol,
    premium_unpriced_volume: totals.unpricedVol,
    pc_volume: pcVol,
    pc_premium: pcPrem,
    pc_oi: oiCall !== null && oiPut !== null ? pcRatio(oiPut, oiCall) : null,
    oi_call: oiCall,
    oi_put: oiPut,
    oi_expirations_used: oiExps,
    oi_asof: oiAsof,
    exp_volumes: totals.expVol,
    new_call_volume: newCall,
    new_put_volume: newPut,
    pc_new_volume: newCall !== null && newPut !== null ? pcRatio(newPut, newCall) : null,
    minutes_since_prev: minutesSincePrev,
    first_pc_volume: firstVol,
    first_pc_premium: firstPrem,
    pc_volume_chg: pcVol !== null && firstVol !== null ? pcVol - firstVol : null,
    pc_premium_chg: pcPrem !== null && firstPrem !== null ? pcPrem - firstPrem : null,
    agg_call_buy: aggCallBuy,
    agg_call_sell: aggCallSell,
    agg_put_buy: aggPutBuy,
    agg_put_sell: aggPutSell,
    agg_unclassified: aggUnclassified,
    iv_atm_near: loaded[0] ? atmIv(loaded[0].chain, spot) : null,
    iv_atm_next: loaded[1] ? atmIv(loaded[1].chain, spot) : null,
    stale,
    clamped,
    flags,
    provider_calls: input.providerCalls ?? null,
    data_feed: input.dataFeed,
    quote_lag_seconds: quoteLagSeconds(loaded, spot, fetchedAtMs),
    contracts,
  };
}

// ---------------------------------------------------------------- UI status

export type LoggingState = "running" | "delayed" | "not_running" | "closed" | "historical";

/**
 * Status chip logic. `lastFetchMs` is the newest row's ACTUAL fetch time, or null when there are no rows.
 * For today's date during the session: running if the newest row is recent, otherwise delayed (with minutes), or
 * not running when there is no row at all. Outside the session (nothing is expected): closed. For an earlier date: historical.
 */
export function loggingStatus(opts: { lastFetchMs: number | null; nowMs: number; viewingDate: string }): { state: LoggingState; minutesAgo: number | null } {
  const { lastFetchMs, nowMs, viewingDate } = opts;
  const minutesAgo = lastFetchMs === null ? null : Math.max(0, Math.round((nowMs - lastFetchMs) / MIN_MS));
  if (viewingDate !== sessionDateET(nowMs)) return { state: "historical", minutesAgo };
  if (!isRegularSession(nowMs)) return { state: "closed", minutesAgo };
  if (lastFetchMs === null) return { state: "not_running", minutesAgo };
  return { state: minutesAgo !== null && minutesAgo <= OPTION_FLOW_CONFIG.runningMaxAgeMinutes ? "running" : "delayed", minutesAgo };
}

// ---------------------------------------------------------------- UI text for the data feed

/** Badge text for one feed. The sandbox feed is the delayed one. */
export function feedBadgeText(feed: DataFeed): string {
  return feed === "production" ? "Real-time feed" : "Delayed feed (about 15 min)";
}

/** "Newest quote is 14 minutes old", or null when the row carries no quote timestamp. Under 90 s it is shown in seconds. */
export function quoteAgeText(lagSeconds: number | null | undefined): string | null {
  if (lagSeconds === null || lagSeconds === undefined || !Number.isFinite(lagSeconds)) return null;
  if (lagSeconds < 90) return `Newest quote is ${Math.round(lagSeconds)} second${Math.round(lagSeconds) === 1 ? "" : "s"} old`;
  const m = Math.round(lagSeconds / 60);
  return `Newest quote is ${m} minute${m === 1 ? "" : "s"} old`;
}

/**
 * What the tab shows about the feed for one session's rows: the newest row's feed and quote age, plus whether the
 * session mixes feeds (a switch part way through the day). Rows from before the column existed read as 'sandbox'.
 */
export function feedSummary(rows: readonly Pick<OptionFlowRow, "data_feed" | "quote_lag_seconds">[]): { latestFeed: DataFeed | null; mixed: boolean; ageText: string | null } {
  if (rows.length === 0) return { latestFeed: null, mixed: false, ageText: null };
  const latest = rows[rows.length - 1];
  return { latestFeed: latest.data_feed, mixed: new Set(rows.map((r) => r.data_feed)).size > 1, ageText: quoteAgeText(latest.quote_lag_seconds) };
}
