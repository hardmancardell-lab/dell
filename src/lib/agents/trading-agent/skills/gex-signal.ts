import { blackScholesGreeks } from "../black-scholes";
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
 */

export interface StrikeGexRow {
  strikePrice: number;
  right: "call" | "put";
  openInterest: number;
  volume: number;
  gamma: number;
  dollarGamma: number;
  dealerGex: number;
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

/** Linear interpolation of the zero-gamma crossing, same as signal_engine.py's find_gamma_flip. */
export function findGammaFlip(netGex: NetGexPoint[]): number | null {
  for (let i = 0; i < netGex.length - 1; i++) {
    const s0 = Math.sign(netGex[i].netGex);
    const s1 = Math.sign(netGex[i + 1].netGex);
    if (s0 !== s1 && s0 !== 0) {
      const x0 = netGex[i].strikePrice;
      const x1 = netGex[i + 1].strikePrice;
      const y0 = netGex[i].netGex;
      const y1 = netGex[i + 1].netGex;
      if (y1 === y0) continue;
      return x0 + ((0 - y0) * (x1 - x0)) / (y1 - y0);
    }
  }
  return null;
}

export function classifyGexRegime(netGex: NetGexPoint[], spot: number): GexRegime {
  const totalNetGex = netGex.reduce((sum, p) => sum + p.netGex, 0);
  const gammaFlip = findGammaFlip(netGex);
  const callWall = netGex.reduce((best, p) => (p.netGex > best.netGex ? p : best), netGex[0]);
  const putWall = netGex.reduce((best, p) => (p.netGex < best.netGex ? p : best), netGex[0]);
  return {
    totalNetGex,
    gammaFlip,
    spot,
    regime: totalNetGex > 0 ? "positive" : "negative",
    callWall: callWall?.strikePrice ?? spot,
    putWall: putWall?.strikePrice ?? spot,
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

export function flowDirectionAtWalls(rows: StrikeGexRow[], regime: GexRegime): FlowAtWalls {
  const callRow = rows.find((r) => r.strikePrice === regime.callWall && r.right === "call");
  const putRow = rows.find((r) => r.strikePrice === regime.putWall && r.right === "put");
  return {
    callWallFlowRatio: callRow ? flowRatioAtStrike(callRow.volume, callRow.openInterest) : null,
    putWallFlowRatio: putRow ? flowRatioAtStrike(putRow.volume, putRow.openInterest) : null,
  };
}

export function classifyQuadrant(
  regime: GexRegime,
  term: TermStructureSignal | null,
  flow: FlowAtWalls
): QuadrantLabel {
  const callScore = flow.callWallFlowRatio ?? 0;
  const putScore = flow.putWallFlowRatio ?? 0;
  const direction = callScore >= putScore ? "bullish" : "bearish";

  let volRegime: "stable" | "volatile" = regime.regime === "positive" ? "stable" : "volatile";
  // Backwardation nudges toward "volatile" even in positive GEX, since it
  // signals the market is pricing a near-term catalyst.
  if (term?.shape === "backwardation" && volRegime === "stable") volRegime = "volatile";

  return `${direction}-${volRegime}` as QuadrantLabel;
}

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

/**
 * Orchestrator: fetches near/far expirations + chains + a live quote, then
 * runs the full pipeline above. Requires Tradier specifically (the only
 * provider with real open interest) — throws a distinct, UI-matchable error
 * if it's not configured and mock mode is off, rather than silently
 * producing a degenerate all-zero result.
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
    "Dealer-positioning heuristic: dealers assumed net short calls / net long puts against customer flow — a simplification that can be wrong for single names with unusual order flow (same assumption options-signals-project/signal_engine.py documents).",
  ];

  const quote = await fetchQuote(symbol);
  const now = Date.now();

  let nearExpiration: string | undefined;
  let farExpiration: string | null = null;
  let nearChain: MarketOptionsChain;
  let farChain: MarketOptionsChain | null = null;

  if (isMockMode) {
    // The mock chain (schwab-mock.ts's generateMockOptionsChain) has exactly
    // one fixed expiration and ignores the expirationDate param entirely —
    // there's no real expirations list to query, so it's derived from the
    // chain's own contracts instead of calling Tradier.
    nearChain = await fetchOptionsChain(symbol);
    nearExpiration = nearChain.calls[0]?.expirationDate ?? nearChain.puts[0]?.expirationDate;
  } else {
    const expirations = await tradier.getExpirations(symbol);
    const futureExpirations = expirations.filter((e) => Date.parse(e) >= now);
    nearExpiration = futureExpirations[0] ?? expirations[0];
    farExpiration = futureExpirations[1] ?? null;

    if (!nearExpiration) {
      throw new Error(`No option expirations found for "${symbol}".`);
    }
    nearChain = await fetchOptionsChain(symbol, nearExpiration);
    farChain = farExpiration ? await fetchOptionsChain(symbol, farExpiration) : null;
  }

  if (!nearExpiration) {
    throw new Error(`No option contracts returned for "${symbol}" — can't determine an expiration.`);
  }

  if (!farExpiration) {
    dataLimitations.push("Only one expiration available — IV term structure signal needs a second, further-dated expiration to compare against.");
  }

  const rows = computeStrikeGex(nearChain, quote.lastPrice, now, Date.parse(nearExpiration));
  const netGex = netGexByStrike(rows);
  const gexRegime = classifyGexRegime(netGex, quote.lastPrice);

  const termStructure = farChain
    ? termStructureSignal(findAtmIv(nearChain, quote.lastPrice), findAtmIv(farChain, quote.lastPrice))
    : null;

  const flowAtWalls = flowDirectionAtWalls(rows, gexRegime);
  const quadrant = rows.length > 0 ? classifyQuadrant(gexRegime, termStructure, flowAtWalls) : null;

  if (rows.length === 0) {
    dataLimitations.push(`No option contracts returned for "${symbol}" at expiration ${nearExpiration}.`);
  }

  return {
    underlying: symbol,
    asOfDateKey: toDateKey(now),
    nearExpiration,
    farExpiration,
    gexRegime,
    termStructure,
    flowAtWalls,
    quadrant,
    dataLimitations,
  };
}
