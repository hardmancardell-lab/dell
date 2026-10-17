import { fetchQuote } from "@/lib/data/market-data";
import { isNoPriceError, isUsablePrice } from "@/lib/data/market-data-types";
import * as tradier from "@/lib/data/tradier";
import {
  GEX_WINDOW_DAYS,
  computeWindowRows,
  expiryMs,
  fetchChains,
  sweepGammaFlip,
  wallsBySide,
  windowExpirations,
  type GexWindowChain,
} from "./gex-signal";

/**
 * Dollar gamma by strike (rows) and expiration (columns) for any optionable ticker, from the same Tradier chains and
 * the same per-contract maths as the GEX signal (method gex-v2). Calls and puts are kept separate and always positive
 * (dollars of stock a 1% move would require hedging, in millions); the sign assumption is applied by the viewer, so
 * the Calls only and Puts only views assume nothing about who holds the other side.
 */

/** Strikes farther than this fraction from spot are not sent to the browser. Totals, walls and the flip use every strike. */
const MAX_STRIKE_BAND = 0.25;
/** An expiration with fewer contracts than this is a stray far-dated listing, not a usable column. */
const MIN_CONTRACTS_PER_EXPIRATION = 3;

export interface HeatMapExpiration {
  date: string;
  /** Calendar days from now to the 4pm ET close of that date (0 on the expiration day itself). */
  days: number;
}

export interface GammaHeatMapResult {
  underlying: string;
  spot: number;
  asOf: string;
  expirations: HeatMapExpiration[];
  /** Strikes high to low, within MAX_STRIKE_BAND of spot. */
  strikes: number[];
  /** [strike][expiration] call and put dollar gamma per 1% move, in millions of dollars. */
  call: number[][];
  put: number[][];
  /** Totals over every strike and every expiration shown, in millions of dollars. */
  callTotalM: number;
  putTotalM: number;
  callWalls: number[];
  putWalls: number[];
  /** Spot level where net gamma crosses zero, within +/-15% of spot, or null. Does not depend on the dealer sign assumption. */
  flip: number | null;
  contractCount: number;
  dataLimitations: string[];
}

export async function computeGammaHeatMap(underlying: string): Promise<GammaHeatMapResult> {
  const symbol = underlying.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(symbol)) throw new Error(`"${underlying}" is not a ticker symbol.`);
  const isMockMode = process.env.MARKET_DATA_MOCK_MODE === "true" || process.env.SCHWAB_MOCK_MODE === "true";
  if (isMockMode || !process.env.TRADIER_ACCESS_TOKEN) {
    throw new Error("The gamma heat map needs real open interest, which only Tradier provides here, and TRADIER_ACCESS_TOKEN is not set.");
  }

  let quote;
  try {
    quote = await fetchQuote(symbol);
  } catch (error) {
    if (isNoPriceError(error)) throw new Error(`No usable spot price for ${symbol} right now (market closed or no recent trade), so the gamma heat map cannot be drawn.`);
    throw error;
  }
  const spot = quote.lastPrice;
  if (!isUsablePrice(spot)) throw new Error(`No usable spot price for ${symbol} right now, so the gamma heat map cannot be drawn.`);
  const now = Date.now();
  const expirations = await tradier.getExpirations(symbol);
  if (expirations.length === 0) throw new Error(`No option expirations found for "${symbol}". Is it optionable?`);

  const dataLimitations: string[] = [];
  const inWindow = windowExpirations(expirations, now);
  const uncapped = windowExpirations(expirations, now, GEX_WINDOW_DAYS, Number.POSITIVE_INFINITY);
  if (inWindow.length === 0) throw new Error(`"${symbol}" has no option expiration within the next ${GEX_WINDOW_DAYS} days.`);

  const loaded = await fetchChains(symbol, inWindow);
  const chains: GexWindowChain[] = [];
  const stray: string[] = [];
  let failed = 0;
  for (const e of inWindow) {
    const chain = loaded.get(e);
    if (!chain) {
      failed++;
      continue;
    }
    if (chain.calls.length + chain.puts.length < MIN_CONTRACTS_PER_EXPIRATION) {
      stray.push(e);
      continue;
    }
    chains.push({ expiration: e, chain });
  }
  if (chains.length === 0) throw new Error(`Could not load a usable option chain for "${symbol}".`);
  if (failed > 0) dataLimitations.push(`${failed} expiration(s) in the window could not be loaded and are left out.`);
  if (stray.length > 0) dataLimitations.push(`Left out because they hold almost no contracts: ${stray.join(", ")}.`);
  if (uncapped.length > inWindow.length) {
    dataLimitations.push(`Showing the nearest ${inWindow.length} expirations; ${uncapped.length - inWindow.length} later one(s) inside ${GEX_WINDOW_DAYS} days are not loaded, to limit data calls.`);
  }

  const rows = computeWindowRows(chains, spot, now);
  const cols = chains.map((c) => c.expiration);
  const colIndex = new Map(cols.map((c, j) => [c, j]));

  const strikeSet = new Set<number>();
  for (const r of rows) if (Math.abs(r.strikePrice - spot) <= MAX_STRIKE_BAND * spot) strikeSet.add(r.strikePrice);
  const strikes = [...strikeSet].sort((a, b) => b - a);
  const rowIndex = new Map(strikes.map((k, i) => [k, i]));
  const call = strikes.map(() => cols.map(() => 0));
  const put = strikes.map(() => cols.map(() => 0));
  let callTotal = 0;
  let putTotal = 0;
  for (const r of rows) {
    const mFromDollars = r.dollarGamma / 1e6;
    if (r.right === "call") callTotal += mFromDollars;
    else putTotal += mFromDollars;
    const i = rowIndex.get(r.strikePrice);
    const j = r.expiration === undefined ? undefined : colIndex.get(r.expiration);
    if (i === undefined || j === undefined) continue;
    (r.right === "call" ? call : put)[i][j] += mFromDollars;
  }

  const { callWalls, putWalls } = wallsBySide(rows, spot);
  if (callTotal + putTotal === 0) dataLimitations.push("Every contract came back with zero open interest or no usable implied volatility, so there is no gamma to draw. This is usual in the first minutes after the open and when the market is closed with stale quotes.");

  return {
    underlying: symbol,
    spot,
    asOf: new Date(now).toISOString(),
    expirations: cols.map((date) => ({ date, days: Math.max(0, (expiryMs(date) - now) / 86_400_000) })),
    strikes,
    call,
    put,
    callTotalM: callTotal,
    putTotalM: putTotal,
    callWalls,
    putWalls,
    flip: sweepGammaFlip(rows, spot),
    contractCount: rows.length,
    dataLimitations,
  };
}
