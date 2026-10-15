import { blackScholesGreeks } from "../black-scholes";
import { classifyQuadrant } from "./gex-sign";
import { fetchOptionsChain, fetchQuote } from "@/lib/data/market-data";
import * as tradier from "@/lib/data/tradier";
import type { MarketOptionsChain } from "@/lib/data/market-data-types";
import type {
  FlowAtWalls,
  GexRegime,
  GexSignalResult,
  QuadrantLabel,
  TermStructureSignal,
} from "../types";

/**
 * Direct TypeScript port of options-signals-project/signal_engine.py.
 * Manually cross-checked this session against that script's own self-test
 * output (total_net_gex=-385489.88, gamma_flip=91.23, regime=negative,
 * bullish-volatile — see METRICS_REPORT.md in the handoff package) to
 * confirm the port is faithful, not just "doesn't crash."
 *
 * Dealer-positioning heuristic — same documented assumption as the Python
 * original: dealers are net SHORT calls and net LONG puts against customer
 * buying pressure. This can be wrong for single names with unusual flow;
 * toggle dealerShortCalls/dealerShortPuts if better information exists.
 *
 * METHOD VERSION "gex-v2" (see GEX_METHOD_NOTES.md). The sign assumption above
 * and the port's per-contract maths are unchanged. What changed from v1:
 *   - Walls are picked BY SIDE: callWall = strike above spot with the most call
 *     gamma, putWall = strike below spot with the most put gamma. v1 picked the
 *     max / min of the sign-adjusted net, which labelled the strike where calls
 *     dominate as the "put wall" (and vice versa) and favoured trivial strikes.
 *   - Open interest from every expiration in a 45-day window is combined, not
 *     only the nearest one, so tomorrow's expiry cannot dominate by itself.
 *   - The gamma flip is a spot sweep: every contract is re-priced at hypothetical
 *     spots and the zero crossing nearest spot is returned, not a sign change
 *     between two adjacent strikes at today's spot.
 *   - Expirations are treated as ending 4pm US Eastern on their date (not
 *     midnight UTC), so today's expiry counts until the close and the final
 *     hours keep a floor on time to expiry.
 * The call/put walls are where gamma is concentrated. They are not a forecast
 * that price will stop there, and the net sign stays an assumption.
 */

export const GEX_METHOD_VERSION = "gex-v2" as const;
/**
 * Net gamma within this percent of gross gamma is called "balanced". A judgement threshold, not a tested one: on a
 * 15-name survey (12 Oct 2026) SPY, GLD, AMD and INTC sat within about 2% and the single-name megacaps sat 20-60% call-heavy.
 */
export const BALANCED_BAND_PCT = 10;
export const GEX_WINDOW_DAYS = 45;
/** Nearest expirations fetched per signal: bounds the Tradier calls when a dashboard scans several tickers. */
export const GEX_MAX_WINDOW_EXPIRATIONS = 12;
const GEX_FETCH_BATCH = 4;
/** The spot sweep for the gamma flip covers spot +/- this fraction, in this many steps of equal size. */
const FLIP_SWEEP_FRACTION = 0.15;
const FLIP_SWEEP_STEPS = 60;
const WALLS_RETURNED = 3;
/** Smallest time to expiry used in the maths (a quarter of a day) so gamma stays finite in the last hours. */
const MIN_T_MS = 6 * 60 * 60 * 1000;

export interface StrikeGexRow {
  strikePrice: number;
  right: "call" | "put";
  openInterest: number;
  volume: number;
  gamma: number;
  dollarGamma: number;
  dealerGex: number;
  /** +1 or -1: the sign this contract's gamma carries in dealerGex (calls -1 and puts +1 under the default assumption). */
  dealerSign?: 1 | -1;
  /** Implied volatility as a decimal and time to expiry in years, kept so the contract can be re-priced at another spot. */
  volatility?: number;
  tYears?: number;
  /** Expiration date (YYYY-MM-DD) when the row came from a multi-expiration window. */
  expiration?: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** signal_engine.py's bs_gamma — reuses black-scholes.ts's already-validated Greeks (identical formula for calls/puts). */
function bsGamma(spot: number, strike: number, tYears: number, sigmaDecimal: number): number {
  if (tYears <= 0 || sigmaDecimal <= 0 || spot <= 0 || strike <= 0) return 0;
  return blackScholesGreeks("call", spot, strike, tYears, sigmaDecimal, 0).gamma;
}

export function computeStrikeGex(
  chain: MarketOptionsChain,
  spot: number,
  valuationDateMs: number,
  expirationDateMs: number,
  contractMultiplier = 100,
  dealerShortCalls = true,
  dealerShortPuts = false
): StrikeGexRow[] {
  const tYears = Math.max(expirationDateMs - valuationDateMs, 0) / ONE_DAY_MS / 365;
  const callSign = dealerShortCalls ? -1 : 1;
  const putSign = dealerShortPuts ? -1 : 1;

  const rows: StrikeGexRow[] = [];
  for (const c of chain.calls) {
    const gamma = bsGamma(spot, c.strikePrice, tYears, c.volatility / 100);
    const dollarGamma = gamma * spot * spot * 0.01 * c.openInterest * contractMultiplier;
    rows.push({
      strikePrice: c.strikePrice,
      right: "call",
      openInterest: c.openInterest,
      volume: c.totalVolume,
      gamma,
      dollarGamma,
      dealerGex: dollarGamma * callSign,
      dealerSign: callSign,
      volatility: c.volatility / 100,
      tYears,
    });
  }
  for (const p of chain.puts) {
    const gamma = bsGamma(spot, p.strikePrice, tYears, p.volatility / 100);
    const dollarGamma = gamma * spot * spot * 0.01 * p.openInterest * contractMultiplier;
    rows.push({
      strikePrice: p.strikePrice,
      right: "put",
      openInterest: p.openInterest,
      volume: p.totalVolume,
      gamma,
      dollarGamma,
      dealerGex: dollarGamma * putSign,
      dealerSign: putSign,
      volatility: p.volatility / 100,
      tYears,
    });
  }
  return rows;
}

export interface NetGexPoint {
  strikePrice: number;
  netGex: number;
}

export function netGexByStrike(rows: StrikeGexRow[]): NetGexPoint[] {
  const byStrike = new Map<number, number>();
  for (const r of rows) {
    byStrike.set(r.strikePrice, (byStrike.get(r.strikePrice) ?? 0) + r.dealerGex);
  }
  return [...byStrike.entries()]
    .map(([strikePrice, netGex]) => ({ strikePrice, netGex }))
    .sort((a, b) => a.strikePrice - b.strikePrice);
}

/** An expiration date ends at 4pm US Eastern (20:00 UTC in summer; one hour early in winter, which is immaterial for gamma). */
export function expiryMs(dateKey: string): number {
  return Date.parse(`${dateKey.slice(0, 10)}T20:00:00Z`);
}

/** Expirations still open at `now` and within `windowDays`, nearest first, at most `maxCount`. */
export function windowExpirations(expirations: string[], now: number, windowDays = GEX_WINDOW_DAYS, maxCount = GEX_MAX_WINDOW_EXPIRATIONS): string[] {
  return [...expirations]
    .filter((e) => {
      const end = expiryMs(e);
      return end > now && (end - now) / ONE_DAY_MS <= windowDays;
    })
    .sort()
    .slice(0, maxCount);
}

export interface GexWindowChain {
  expiration: string;
  chain: MarketOptionsChain;
}

/** One StrikeGexRow per contract across every chain in the window. Time to expiry never falls below MIN_T_MS. */
export function computeWindowRows(chains: GexWindowChain[], spot: number, now: number): StrikeGexRow[] {
  const rows: StrikeGexRow[] = [];
  for (const { expiration, chain } of chains) {
    const end = Math.max(expiryMs(expiration), now + MIN_T_MS);
    for (const r of computeStrikeGex(chain, spot, now, end)) rows.push({ ...r, expiration });
  }
  return rows;
}

/** Strikes ranked by one side's dollar gamma, summed over every expiration in the rows. */
function rankStrikes(rows: StrikeGexRow[], right: "call" | "put", keep: (strike: number) => boolean, n: number): number[] {
  const byStrike = new Map<number, number>();
  for (const r of rows) {
    if (r.right !== right || !keep(r.strikePrice)) continue;
    byStrike.set(r.strikePrice, (byStrike.get(r.strikePrice) ?? 0) + r.dollarGamma);
  }
  return [...byStrike.entries()]
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([strike]) => strike);
}

/** Call walls above spot and put walls below it, each the strikes with the most gamma on that side, largest first. */
export function wallsBySide(rows: StrikeGexRow[], spot: number, n = WALLS_RETURNED): { callWalls: number[]; putWalls: number[] } {
  return {
    callWalls: rankStrikes(rows, "call", (k) => k > spot, n),
    putWalls: rankStrikes(rows, "put", (k) => k < spot, n),
  };
}

/** Total dealer-signed gamma exposure if spot were `s`, re-pricing every contract that carries its own IV and time to expiry. */
export function netGexAtSpot(rows: StrikeGexRow[], s: number): number {
  let total = 0;
  for (const r of rows) {
    if (r.volatility === undefined || r.tYears === undefined || r.dealerSign === undefined) continue;
    const g = bsGamma(s, r.strikePrice, r.tYears, r.volatility) * s * s * 0.01 * r.openInterest * 100;
    total += g * r.dealerSign;
  }
  return total;
}

/**
 * Spot level where total net gamma crosses zero, by sweeping spot over +/-15% and interpolating the crossing
 * nearest the current spot. Null when net gamma keeps one sign across the whole sweep. The crossing level is the same
 * whichever sign convention is used; only which side counts as "positive gamma" changes.
 */
export function sweepGammaFlip(rows: StrikeGexRow[], spot: number): number | null {
  const pts: { s: number; v: number }[] = [];
  for (let i = 0; i <= FLIP_SWEEP_STEPS; i++) {
    const s = spot * (1 - FLIP_SWEEP_FRACTION + (2 * FLIP_SWEEP_FRACTION * i) / FLIP_SWEEP_STEPS);
    pts.push({ s, v: netGexAtSpot(rows, s) });
  }
  const crossings: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.v === 0) crossings.push(a.s);
    else if (Math.sign(a.v) !== Math.sign(b.v) && b.v !== 0) crossings.push(a.s + ((0 - a.v) * (b.s - a.s)) / (b.v - a.v));
  }
  if (crossings.length === 0) return null;
  return crossings.reduce((best, c) => (Math.abs(c - spot) < Math.abs(best - spot) ? c : best));
}

export function classifyGexRegime(rows: StrikeGexRow[], spot: number): GexRegime {
  const totalNetGex = rows.reduce((sum, r) => sum + r.dealerGex, 0);
  const { callWalls, putWalls } = wallsBySide(rows, spot);
  const callGamma = rows.reduce((s, r) => (r.right === "call" ? s + r.dollarGamma : s), 0);
  const putGamma = rows.reduce((s, r) => (r.right === "put" ? s + r.dollarGamma : s), 0);
  const grossGex = callGamma + putGamma;
  const netToGrossPct = grossGex > 0 ? (totalNetGex / grossGex) * 100 : null;
  const regime = totalNetGex > 0 ? "positive" : "negative";
  return {
    totalNetGex,
    gammaFlip: sweepGammaFlip(rows, spot),
    spot,
    regime,
    callWall: callWalls[0] ?? spot,
    putWall: putWalls[0] ?? spot,
    callWalls,
    putWalls,
    callGamma,
    putGamma,
    grossGex,
    netToGrossPct,
    balanced: netToGrossPct !== null && Math.abs(netToGrossPct) <= BALANCED_BAND_PCT,
    regimeOppositeConvention: regime === "positive" ? "negative" : "positive",
  };
}

export function termStructureSignal(ivNear: number, ivFar: number): TermStructureSignal {
  const spread = ivNear - ivFar;
  return { ivNear, ivFar, spread, shape: spread > 0 ? "backwardation" : "contango" };
}

export function flowRatioAtStrike(volumeToday: number, openInterest: number): number | null {
  if (openInterest <= 0) return null;
  return volumeToday / openInterest;
}

/** Today's volume over open interest on the wall strike, one side, summed over every expiration in the rows. */
function flowAtStrike(rows: StrikeGexRow[], strike: number, right: "call" | "put"): number | null {
  const side = rows.filter((r) => r.strikePrice === strike && r.right === right);
  if (side.length === 0) return null;
  return flowRatioAtStrike(side.reduce((s, r) => s + r.volume, 0), side.reduce((s, r) => s + r.openInterest, 0));
}

export function flowDirectionAtWalls(rows: StrikeGexRow[], regime: GexRegime): FlowAtWalls {
  return {
    callWallFlowRatio: flowAtStrike(rows, regime.callWall, "call"),
    putWallFlowRatio: flowAtStrike(rows, regime.putWall, "put"),
  };
}

// The quadrant rule lives in gex-sign.ts (pure and client-safe) so the dashboard can re-read it under the other dealer assumption.
export { classifyQuadrant };

function findAtmIv(chain: MarketOptionsChain, spot: number): number {
  const all = [...chain.calls, ...chain.puts];
  if (all.length === 0) return 0;
  const strikes = [...new Set(all.map((c) => c.strikePrice))];
  const closestStrike = strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best));
  const ivs = all
    .filter((c) => c.strikePrice === closestStrike)
    .map((c) => c.volatility / 100)
    .filter((v) => v > 0);
  if (ivs.length === 0) return 0;
  return ivs.reduce((a, b) => a + b, 0) / ivs.length;
}

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Fetches option chains for the given expirations, a few at a time. A failed fetch is returned as null rather than thrown. */
export async function fetchChains(symbol: string, expirations: string[]): Promise<Map<string, MarketOptionsChain | null>> {
  const out = new Map<string, MarketOptionsChain | null>();
  for (let i = 0; i < expirations.length; i += GEX_FETCH_BATCH) {
    const batch = expirations.slice(i, i + GEX_FETCH_BATCH);
    const results = await Promise.all(batch.map((e) => fetchOptionsChain(symbol, e).catch(() => null)));
    batch.forEach((e, k) => out.set(e, results[k]));
  }
  return out;
}

/**
 * Orchestrator: fetches the expirations in the 45-day window plus a live quote, then runs the full pipeline above.
 * The near/far expirations (the first two on or after today) still drive the IV term structure and key the paper
 * log; walls, gamma flip and regime combine every expiration in the window. Requires Tradier specifically (the only
 * provider with real open interest) — throws a distinct, UI-matchable error if it's not configured and mock mode is
 * off, rather than silently producing a degenerate all-zero result.
 */
export async function computeGexSignal(underlying: string): Promise<GexSignalResult> {
  const symbol = underlying.trim().toUpperCase();
  const isMockMode =
    process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";

  if (!isMockMode && !process.env.TRADIER_ACCESS_TOKEN) {
    throw new Error(
      "GEX signal requires Tradier — TRADIER_ACCESS_TOKEN is not set. This is the only configured provider with real open interest; without it, dollar-GEX would compute to a permanent zero (see TRADIER_INTEGRATION_NOTES.md)."
    );
  }

  const dataLimitations: string[] = [
    "Dealer-positioning heuristic: dealers assumed net short calls / net long puts against customer flow — a simplification that can be wrong for single names with unusual order flow (same assumption options-signals-project/signal_engine.py documents). It affects the regime label and the sign of total net GEX; the walls and the gamma flip level do not depend on it.",
    "Call wall = the strike above spot with the most call gamma; put wall = the strike below spot with the most put gamma, summed over the expirations in the window. They show where option positioning is concentrated, not where price will stop. Open interest is the prior day's figure.",
  ];

  const quote = await fetchQuote(symbol);
  const now = Date.now();

  let nearExpiration: string | undefined;
  let farExpiration: string | null = null;
  let nearChain: MarketOptionsChain;
  let farChain: MarketOptionsChain | null = null;
  let windowChains: GexWindowChain[] = [];

  if (isMockMode) {
    // The mock chain (schwab-mock.ts's generateMockOptionsChain) has exactly
    // one fixed expiration and ignores the expirationDate param entirely —
    // there's no real expirations list to query, so it's derived from the
    // chain's own contracts instead of calling Tradier.
    nearChain = await fetchOptionsChain(symbol);
    nearExpiration = nearChain.calls[0]?.expirationDate ?? nearChain.puts[0]?.expirationDate;
    if (nearExpiration) windowChains = [{ expiration: nearExpiration, chain: nearChain }];
  } else {
    const expirations = await tradier.getExpirations(symbol);
    const futureExpirations = expirations.filter((e) => Date.parse(e) >= now);
    nearExpiration = futureExpirations[0] ?? expirations[0];
    farExpiration = futureExpirations[1] ?? null;

    if (!nearExpiration) {
      throw new Error(`No option expirations found for "${symbol}".`);
    }

    const inWindow = windowExpirations(expirations, now);
    const uncapped = windowExpirations(expirations, now, GEX_WINDOW_DAYS, Number.POSITIVE_INFINITY);
    const wanted = [...new Set([nearExpiration, ...(farExpiration ? [farExpiration] : []), ...inWindow])];
    const chains = await fetchChains(symbol, wanted);

    const near = chains.get(nearExpiration);
    if (!near) throw new Error(`Could not load the option chain for "${symbol}" at expiration ${nearExpiration}.`);
    nearChain = near;
    farChain = farExpiration ? (chains.get(farExpiration) ?? null) : null;

    windowChains = inWindow.flatMap((e) => {
      const chain = chains.get(e);
      return chain ? [{ expiration: e, chain }] : [];
    });
    const failed = inWindow.length - windowChains.length;
    if (failed > 0) dataLimitations.push(`${failed} expiration(s) in the window could not be loaded and are left out of the walls, flip and regime.`);
    if (uncapped.length > inWindow.length) {
      dataLimitations.push(`The window is capped at the nearest ${GEX_MAX_WINDOW_EXPIRATIONS} expirations (through ${inWindow[inWindow.length - 1]}) to limit data calls; ${uncapped.length - inWindow.length} later expiration(s) within ${GEX_WINDOW_DAYS} days are not included.`);
    }
    if (windowChains.length === 0) {
      // Nothing in the window loaded: fall back to the single near chain rather than return nothing.
      windowChains = [{ expiration: nearExpiration, chain: nearChain }];
      dataLimitations.push("No expiration inside the 45-day window could be used, so only the nearest expiration was analysed.");
    }
  }

  if (!nearExpiration) {
    throw new Error(`No option contracts returned for "${symbol}" — can't determine an expiration.`);
  }

  if (!farExpiration) {
    dataLimitations.push("Only one expiration available — IV term structure signal needs a second, further-dated expiration to compare against.");
  }

  const rows = computeWindowRows(windowChains, quote.lastPrice, now);
  const gexRegime = classifyGexRegime(rows, quote.lastPrice);

  const termStructure = farChain
    ? termStructureSignal(findAtmIv(nearChain, quote.lastPrice), findAtmIv(farChain, quote.lastPrice))
    : null;

  const flowAtWalls = flowDirectionAtWalls(rows, gexRegime);
  const quadrant = rows.length > 0 ? classifyQuadrant(gexRegime, termStructure, flowAtWalls) : null;

  if (rows.length === 0) {
    dataLimitations.push(`No option contracts returned for "${symbol}" at expiration ${nearExpiration}.`);
  }
  if (gexRegime.balanced && gexRegime.netToGrossPct !== null && gexRegime.netToGrossPct !== undefined) {
    dataLimitations.push(
      `Call and put gamma are within ${BALANCED_BAND_PCT}% of each other (net is ${gexRegime.netToGrossPct >= 0 ? "+" : ""}${gexRegime.netToGrossPct.toFixed(1)}% of total), so the ${gexRegime.regime} label is close to a coin flip. Read it as balanced.`
    );
  }

  return {
    underlying: symbol,
    asOfDateKey: toDateKey(now),
    nearExpiration,
    farExpiration,
    methodVersion: GEX_METHOD_VERSION,
    expirationsUsed: windowChains.map((c) => c.expiration),
    windowDays: GEX_WINDOW_DAYS,
    gexRegime,
    termStructure,
    flowAtWalls,
    quadrant,
    dataLimitations,
  };
}
