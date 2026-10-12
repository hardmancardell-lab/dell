import { fetchBarsForTimeframe, fetchOptionsChain } from "@/lib/data/market-data";
import * as tradier from "@/lib/data/tradier";
import type { MarketCandle } from "@/lib/data/market-data-types";
import { groupCandlesByEasternDay } from "./bar-aggregation";
import { WINDOWS, isWithin, toEasternParts } from "./time-windows";
import { getDailyBars } from "./daily-bars";
import { computeStrikeGex } from "./gex-signal";
import {
  DEFAULT_BAND_PARAMS,
  bandWidthPct,
  findBandTrades,
  forwardRanges,
  gammaContext,
  summarizeBySide,
  summarizeByVolumeClass,
  summarizeTrades,
  type BandParams,
  type BandTrade,
  type ForwardRange,
  type GammaContext,
  type GroupSummary,
  type SessionBars,
} from "./vwap-band-engine";

/**
 * Research study for the intraday VWAP-band idea: how price behaved after touching session VWAP +/- k sigma,
 * split by the volume Z-score at the touch, with exit-based trades and the lower/upper range per horizon.
 * It reports; it does not trade and it does not recommend. See vwap-band-engine.ts for the maths.
 */

export type StudyAssetKind = "equity" | "forex";

/** "EUR/USD"-shaped symbols are forex, same convention as market-data.ts. */
export function assetKindOf(symbol: string): StudyAssetKind {
  return /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol.trim().toUpperCase()) ? "forex" : "equity";
}

const LONDON_FMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });

/** London local calendar date, minutes since local midnight and weekday for an epoch-ms timestamp (handles BST/GMT). */
export function londonLocal(ms: number): { dateKey: string; minutes: number; weekday: string } {
  const parts: Record<string, string> = {};
  for (const p of LONDON_FMT.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: parts.weekday };
}

const LONDON_SESSION = { start: 8 * 60, end: 17 * 60 }; // 08:00-17:00 London time, reset at the London open

export interface BuiltSessions {
  sessions: SessionBars[];
  /** Sessions dropped for being shorter than a full session (holidays, half days, feed gaps). */
  skippedShort: number;
  barsPerSession: number;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [v, c] of counts) if (c > bestCount || (c === bestCount && v > best)) { best = v; bestCount = c; }
  return best;
}

/**
 * Turns raw 5-minute candles into session-bound bar lists. Equities use the 9:30-16:00 ET regular session;
 * forex uses 08:00-17:00 London time. Only sessions with the usual number of bars are kept so each bar position
 * (bucket) lines up across days for the volume baseline.
 */
export function buildSessions(candles: MarketCandle[], kind: StudyAssetKind): BuiltSessions {
  const raw = rawSessions(candles, kind);
  if (raw.length === 0) return { sessions: [], skippedShort: 0, barsPerSession: 0 };
  const full = mode(raw.map((s) => s.bars.length));
  const sessions = raw.filter((s) => s.bars.length === full);
  return { sessions, skippedShort: raw.length - sessions.length, barsPerSession: full };
}

/** Session-bound bars per day, oldest first, with no length filter (the newest day may still be running). */
export function rawSessions(candles: MarketCandle[], kind: StudyAssetKind): SessionBars[] {
  let raw: SessionBars[];
  if (kind === "equity") {
    raw = groupCandlesByEasternDay(candles)
      .map((d) => ({ dateKey: d.dateKey, bars: d.bars.filter((b) => isWithin(toEasternParts(b.datetime).minutesSinceMidnight, WINDOWS.REGULAR_SESSION)) }))
      .filter((s) => s.bars.length > 0);
  } else {
    const byDate = new Map<string, MarketCandle[]>();
    for (const c of [...candles].sort((a, b) => a.datetime - b.datetime)) {
      const l = londonLocal(c.datetime);
      if (l.weekday === "Sat" || l.weekday === "Sun") continue;
      if (l.minutes < LONDON_SESSION.start || l.minutes >= LONDON_SESSION.end) continue;
      if (!byDate.has(l.dateKey)) byDate.set(l.dateKey, []);
      byDate.get(l.dateKey)!.push(c);
    }
    raw = [...byDate.entries()].map(([dateKey, bars]) => ({ dateKey, bars }));
  }
  raw.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return raw;
}

export { mode as modalLength };

// ---------------------------------------------------------------------------------------------------

export interface VwapBandStudyResult {
  ticker: string;
  assetKind: StudyAssetKind;
  lookbackDays: number;
  sessionsFetched: number;
  sessionsSkippedShort: number;
  sessionsTested: number;
  params: BandParams;
  overall: GroupSummary;
  byVolumeClass: GroupSummary[];
  bySide: GroupSummary[];
  forwardRanges: ForwardRange[];
  /** Average half-width of the +/- k sigma band, percent of VWAP, over the tested sessions. */
  bandWidth: { meanPct: number; p90Pct: number; bars: number } | null;
  readout: string[];
  /** Newest 100 trades. */
  trades: BandTrade[];
  gamma: GammaContext | { unavailable: string } | null;
  dataLimitations: string[];
}

const MIN_DAYS = 30;
export const MAX_STUDY_DAYS = 180;
const BASELINE_BUFFER_CALENDAR_DAYS = 35;
const TRADE_LOG_LIMIT = 100;

/** Plain-language statements about what the numbers do and do not show. Never a recommendation. */
export function buildReadout(overall: GroupSummary, classes: GroupSummary[], kind: StudyAssetKind): string[] {
  const out: string[] = [];
  if (overall.n === 0) return ["No band touches were found in this window."];
  if (overall.smallSample) {
    out.push(`Only ${overall.n} band touches, too few to judge. Treat everything below as directional.`);
  } else if (overall.ciExcludesZero && overall.avgReturnPct !== null) {
    out.push(
      `Fading band touches averaged ${overall.avgReturnPct >= 0 ? "+" : ""}${overall.avgReturnPct.toFixed(3)}% per trade and the 95% range excludes zero. That is before spread, slippage and fees, which can be larger than this.`
    );
  } else {
    out.push("Fading band touches averaged about zero: the 95% range around the average includes zero, so there is no clear edge in this window.");
  }
  for (const c of classes.slice(1, 5)) {
    if (c.n === 0) continue;
    if (c.smallSample) continue;
    if (c.ciExcludesZero && c.avgReturnPct !== null) {
      out.push(`${c.label}: ${c.n} trades averaged ${c.avgReturnPct >= 0 ? "+" : ""}${c.avgReturnPct.toFixed(3)}% (range excludes zero).`);
    }
  }
  const spec = classes.find((c) => c.label.startsWith("Spec Scenario B"));
  if (spec && overall.n > 0 && spec.n / overall.n > 0.6) {
    out.push(`Z < 1.0 covers ${Math.round((spec.n / overall.n) * 100)}% of touches, so it describes ordinary volume and not a low-volume drift. Only Z at or below -1.0 is truly low volume.`);
  }
  if (overall.entryBeyondStopPct !== null && overall.entryBeyondStopPct > 10) {
    out.push(`${overall.entryBeyondStopPct.toFixed(0)}% of touches already closed beyond the stop line, so for those the stop sits between entry and VWAP.`);
  }
  if (kind === "forex") out.push("Volume here is OANDA tick count (activity), not traded volume: forex has no consolidated tape.");
  return out;
}

/** Pure analysis step (no network): sessions in, study result out. Exposed for tests. */
export function analyzeSessions(
  ticker: string,
  kind: StudyAssetKind,
  built: BuiltSessions,
  lookbackDays: number,
  params: Partial<BandParams> = {}
): VwapBandStudyResult {
  const p: BandParams = { ...DEFAULT_BAND_PARAMS, ...params };
  // A feed with no volume at all (free spot-forex data) gets a plain average instead of a volume-weighted one,
  // and no Z-score, rather than silently producing zero signals.
  const hasVolume = built.sessions.some((s) => s.bars.some((b) => b.volume > 0));
  const { trades, sessionsTested } = findBandTrades(built.sessions, hasVolume, p);
  const overall = summarizeTrades(trades, "All band touches");
  const byVolumeClass = summarizeByVolumeClass(trades);
  const tested = built.sessions.slice(-sessionsTested);
  const dataLimitations = [
    "Hypothetical results on historical bars, before spread, slippage and fees. Not a recommendation.",
    `Entry is the close of the first bar beyond VWAP +/- ${p.k} sigma after a ${p.warmupMinutes}-minute warm-up; the exit is VWAP, a stop at ${p.stopK} sigma, or the session close. If one bar contains both the stop and VWAP, the stop is assumed first. One trade at a time per session.`,
    `The volume Z-score compares each 5-minute bar with the same bar position over the prior ${p.baselineDays} sessions (${p.useLogVolume ? "log volume" : "raw volume"}).`,
    "Averages around zero with a small number of trades cannot be told apart from chance. Under 15 trades the range is flagged as a small sample.",
    kind === "equity"
      ? "Free-tier equity bars come from a single exchange (IEX), so volume is a share of the consolidated tape. The Z-score compares like with like, but absolute volume is understated."
      : "Forex volume is a tick count from the broker feed, not traded volume.",
  ];
  if (built.skippedShort > 0) dataLimitations.push(`${built.skippedShort} short session(s) (holidays or half days) were skipped so bar positions line up.`);
  if (!hasVolume) dataLimitations.unshift("This feed carries no volume, so VWAP is a plain average of typical price and the volume Z-score cannot be computed. Only the band test above is meaningful.");
  return {
    ticker,
    assetKind: kind,
    lookbackDays,
    sessionsFetched: built.sessions.length + built.skippedShort,
    sessionsSkippedShort: built.skippedShort,
    sessionsTested,
    params: p,
    overall,
    byVolumeClass,
    bySide: summarizeBySide(trades),
    forwardRanges: forwardRanges(trades),
    bandWidth: bandWidthPct(tested, true, p.k, p.warmupMinutes),
    readout: buildReadout(overall, byVolumeClass, kind),
    trades: trades.slice(-TRADE_LOG_LIMIT),
    gamma: null,
    dataLimitations,
  };
}

/** Gross dollar gamma against average daily dollar volume, equities with an options provider only. Never throws. */
async function loadGammaContext(symbol: string): Promise<GammaContext | { unavailable: string }> {
  if (!process.env.TRADIER_ACCESS_TOKEN && process.env.MARKET_DATA_MOCK_MODE !== "true" && process.env.SCHWAB_MOCK_MODE !== "true") {
    return { unavailable: "Gamma context needs an options data provider (Tradier) and none is configured." };
  }
  try {
    const now = Date.now();
    const daily = await getDailyBars(symbol, 40);
    const last20 = daily.slice(-20);
    if (last20.length < 5) return { unavailable: "Not enough daily bars to size gamma against dollar volume." };
    const adv = last20.reduce((s, b) => s + b.close * b.volume, 0) / last20.length;
    const spot = last20[last20.length - 1].close;
    const expirations = (await tradier.getExpirations(symbol)).filter((e) => Date.parse(e) >= now).slice(0, 4);
    const rows: { right: "call" | "put"; dollarGamma: number }[] = [];
    for (const exp of expirations) {
      const chain = await fetchOptionsChain(symbol, exp);
      for (const r of computeStrikeGex(chain, spot, now, Date.parse(exp))) rows.push({ right: r.right, dollarGamma: r.dollarGamma });
    }
    return gammaContext(rows, adv) ?? { unavailable: "No option contracts with usable open interest were returned." };
  } catch (e) {
    return { unavailable: e instanceof Error ? e.message.slice(0, 160) : "Gamma lookup failed." };
  }
}

export async function runVwapBandStudy(
  ticker: string,
  lookbackDays: number = 90,
  params: Partial<BandParams> = {},
  includeGamma = true
): Promise<VwapBandStudyResult> {
  const symbol = ticker.trim().toUpperCase();
  const kind = assetKindOf(symbol);
  const days = Math.min(Math.max(Math.round(lookbackDays), MIN_DAYS), MAX_STUDY_DAYS);
  const now = Date.now();
  const startMs = now - (days + BASELINE_BUFFER_CALENDAR_DAYS) * 24 * 60 * 60 * 1000;
  const candles = await fetchBarsForTimeframe(symbol, "5Min", startMs, now, 60 * 15);
  if (candles.length === 0) throw new Error(`No 5-minute bars returned for ${symbol}. Check the symbol (forex uses the EUR/USD form).`);
  const built = buildSessions(candles, kind);
  const result = analyzeSessions(symbol, kind, built, days, params);
  if (result.sessionsTested === 0) {
    result.dataLimitations.unshift(`Not enough sessions to build the ${result.params.baselineDays}-session volume baseline and test any. Try a longer lookback.`);
  }
  result.gamma = includeGamma && kind === "equity" ? await loadGammaContext(symbol) : null;
  return result;
}
