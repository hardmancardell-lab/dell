import type { MarketCandle } from "@/lib/data/market-data-types";
import { bootstrapCi } from "./stats-tests";
import { mean, median } from "../stats";

/**
 * Pure engine for the intraday VWAP-band study: session VWAP +/- k sigma bands, a time-bucketed volume
 * Z-score, and a simple exit-based trade simulation. No network, no storage: the I/O wrapper is
 * vwap-band-study.ts and the live signal logger sits on top of this.
 *
 * Why this exists next to vwap-reversion-backtest.ts: that file measures fixed-horizon forward returns
 * after a band touch. This one adds (1) the volume Z-score classes from the spec, (2) trades that exit at
 * VWAP, at a stop, or at the close, and (3) the forward range (lower/upper percentile) per horizon.
 *
 * Research only. Nothing here places an order.
 */

// ---------------------------------------------------------------------------------------------------
// Parameters and classification
// ---------------------------------------------------------------------------------------------------

export interface BandParams {
  /** Entry band half-width in session sigmas. The spec uses 1.5 or 2.0. */
  k: number;
  /** Stop distance from VWAP in session sigmas (default 3, i.e. 1 sigma beyond a 2 sigma entry). */
  stopK: number;
  /** Minutes after the session's first bar before a touch counts (sigma is unstable early). */
  warmupMinutes: number;
  /** Prior sessions used for the per-bucket volume baseline. */
  baselineDays: number;
  /** Z-score log volume instead of raw volume. Volume is right-skewed, so log is the safer choice. */
  useLogVolume: boolean;
}

export const DEFAULT_BAND_PARAMS: BandParams = { k: 2, stopK: 3, warmupMinutes: 30, baselineDays: 20, useLogVolume: false };

export type VolumeClass = "climax" | "elevated" | "normal" | "low" | "n/a";

/**
 * climax   Z >= 2.0   (the spec's Scenario A)
 * elevated 1.0 <= Z < 2.0   (the spec has no rule for this band)
 * normal   -1.0 < Z < 1.0
 * low      Z <= -1.0  (what "low-volume drift" should mean; the spec's Z < 1.0 as written includes normal volume)
 */
export function classifyVolumeZ(z: number | null): VolumeClass {
  if (z === null || !Number.isFinite(z)) return "n/a";
  if (z >= 2) return "climax";
  if (z >= 1) return "elevated";
  if (z <= -1) return "low";
  return "normal";
}

export interface SessionBars {
  dateKey: string;
  bars: MarketCandle[];
}

export type BandSide = "upper" | "lower";
/** "open" only appears for a still-running session in a live scan: no exit yet, marked to the latest close. */
export type ExitReason = "target" | "stop" | "time" | "open";

/** Forward-return horizons in 5-minute bars; null means "to the close of the session". */
export const FORWARD_HORIZONS: { label: string; bars: number | null }[] = [
  { label: "5 min", bars: 1 },
  { label: "15 min", bars: 3 },
  { label: "30 min", bars: 6 },
  { label: "1 hour", bars: 12 },
  { label: "2 hours", bars: 24 },
  { label: "to the close", bars: null },
];

export interface BandTrade {
  dateKey: string;
  entryTimeMs: number;
  side: BandSide;
  entryPrice: number;
  vwap: number;
  sigma: number;
  /** Half-width of the entry band at the touch, as a percent of VWAP. */
  bandPct: number;
  volumeZ: number | null;
  volumeClass: VolumeClass;
  /**
   * True when the entry bar already closed at or beyond the stop line (stopK sigma). The stop then sits
   * between the entry and VWAP, so a "stop" exit can actually book a gain. Counted so it is not hidden.
   */
  entryBeyondStop: boolean;
  exitReason: ExitReason;
  exitPrice: number;
  barsHeld: number;
  /** Return of fading the touch (short an upper touch, long a lower one), in percent. */
  fadeReturnPct: number;
  /** Raw price change from the touch close at each horizon, in percent (not sign-adjusted). */
  forward: Record<string, number>;
}

// ---------------------------------------------------------------------------------------------------
// Session bands and volume baseline
// ---------------------------------------------------------------------------------------------------

/**
 * Running session VWAP and volume-weighted sigma for one session's bars, from the first bar:
 *   VWAP_t   = sum(P_i * V_i) / sum(V_i)
 *   sigma_t  = sqrt( sum(V_i * (P_i - VWAP_t)^2) / sum(V_i) )      with P = (high + low + close) / 3
 * Computed with West's incremental weighted algorithm, which gives exactly the sigma above without the
 * precision loss of sum(P^2 * V) / sum(V) - VWAP^2 (what vwapWithBands does, fine for charting but it can
 * round to zero in the first bars when prices are nearly equal). When there is no volume (spot FX from
 * free feeds) every bar gets weight 1, so VWAP is a plain average of typical price.
 */
export function sessionBandSeries(bars: MarketCandle[], hasVolume: boolean): { vwap: number[]; sigma: number[] } {
  const vwap: number[] = [];
  const sigma: number[] = [];
  let w = 0;
  let m = 0;
  let s = 0;
  for (const b of bars) {
    const x = (b.high + b.low + b.close) / 3;
    const wt = hasVolume ? b.volume : 1;
    if (wt > 0) {
      w += wt;
      const delta = x - m;
      m += (wt / w) * delta;
      s += wt * delta * (x - m);
    }
    vwap.push(w > 0 ? m : b.close);
    sigma.push(w > 0 ? Math.sqrt(Math.max(s / w, 0)) : 0);
  }
  return { vwap, sigma };
}

/** Per-bucket (bar position in the session) mean and sample standard deviation of volume over the prior `n` sessions. */
export function volumeBaseline(
  sessions: SessionBars[],
  index: number,
  n: number,
  useLog: boolean
): { mean: number[]; sd: number[] } | null {
  if (index < n) return null;
  const prior = sessions.slice(index - n, index);
  const len = Math.max(...prior.map((s) => s.bars.length), sessions[index].bars.length);
  const means: number[] = [];
  const sds: number[] = [];
  for (let b = 0; b < len; b++) {
    const vals = prior.map((s) => (useLog ? Math.log((s.bars[b]?.volume ?? 0) + 1) : s.bars[b]?.volume ?? 0));
    const m = vals.reduce((a, c) => a + c, 0) / vals.length;
    const variance = vals.length > 1 ? vals.reduce((a, c) => a + (c - m) ** 2, 0) / (vals.length - 1) : 0;
    means.push(m);
    sds.push(Math.sqrt(variance));
  }
  return { mean: means, sd: sds };
}

// ---------------------------------------------------------------------------------------------------
// Trade simulation
// ---------------------------------------------------------------------------------------------------

/**
 * Simulates fading band touches through one session's bars, one trade at a time:
 *   entry  : close of the first bar beyond VWAP +/- k sigma (after the warm-up)
 *   target : price reaches the live VWAP
 *   stop   : price reaches VWAP -/+ stopK sigma (a gap through it fills at that bar's open)
 *   time   : otherwise the last bar's close
 * If the stop and the target are both inside one bar, the stop is assumed first (conservative).
 * `complete` says whether the session has finished. For a live, still-running session (complete = false) a
 * touch on the newest bar is recorded, and a trade with no exit yet is returned as "open", marked to the
 * latest close, instead of being closed at the session end.
 * `baseline` is the per-bucket volume mean/SD for the Z-score (null when there is no volume feed).
 */
export function simulateSession(
  dateKey: string,
  bars: MarketCandle[],
  baseline: { mean: number[]; sd: number[] } | null,
  hasVolume: boolean,
  p: BandParams,
  complete = true
): BandTrade[] {
  const trades: BandTrade[] = [];
  if (bars.length < 2) return trades;
  const { vwap, sigma } = sessionBandSeries(bars, hasVolume);
  const t0 = bars[0].datetime;
  const lastEntry = complete ? bars.length - 1 : bars.length; // exclusive
  let i = 0;
  while (i < lastEntry) {
    if ((bars[i].datetime - t0) / 60000 < p.warmupMinutes || sigma[i] <= 0) {
      i++;
      continue;
    }
    const c = bars[i].close;
    const side: BandSide | null = c >= vwap[i] + p.k * sigma[i] ? "upper" : c <= vwap[i] - p.k * sigma[i] ? "lower" : null;
    if (side === null) {
      i++;
      continue;
    }

    let z: number | null = null;
    if (baseline) {
      const v = p.useLogVolume ? Math.log(bars[i].volume + 1) : bars[i].volume;
      z = baseline.sd[i] > 0 ? (v - baseline.mean[i]) / baseline.sd[i] : 0;
    }

    let exitPrice: number | null = null;
    let exitReason: ExitReason = complete ? "time" : "open";
    let j = i + 1;
    for (; j < bars.length; j++) {
      const b = bars[j];
      const target = vwap[j];
      const stop = side === "upper" ? vwap[j] + p.stopK * sigma[j] : vwap[j] - p.stopK * sigma[j];
      if (side === "lower") {
        if (b.low <= stop) {
          exitPrice = b.open > stop ? stop : b.open;
          exitReason = "stop";
          break;
        }
        if (b.high >= target) {
          exitPrice = target;
          exitReason = "target";
          break;
        }
      } else {
        if (b.high >= stop) {
          exitPrice = b.open < stop ? stop : b.open;
          exitReason = "stop";
          break;
        }
        if (b.low <= target) {
          exitPrice = target;
          exitReason = "target";
          break;
        }
      }
    }
    if (exitPrice === null) {
      exitPrice = bars[bars.length - 1].close;
      j = bars.length - 1;
    }

    const fadeReturnPct = (side === "lower" ? exitPrice / c - 1 : c / exitPrice - 1) * 100;
    const forward: Record<string, number> = {};
    for (const h of FORWARD_HORIZONS) {
      const idx = h.bars === null ? bars.length - 1 : Math.min(bars.length - 1, i + h.bars);
      forward[h.label] = (bars[idx].close / c - 1) * 100;
    }
    trades.push({
      dateKey,
      entryTimeMs: bars[i].datetime,
      side,
      entryPrice: c,
      vwap: vwap[i],
      sigma: sigma[i],
      bandPct: vwap[i] > 0 ? ((p.k * sigma[i]) / vwap[i]) * 100 : 0,
      volumeZ: z,
      volumeClass: classifyVolumeZ(z),
      entryBeyondStop: Math.abs(c - vwap[i]) >= p.stopK * sigma[i],
      exitReason,
      exitPrice,
      barsHeld: j - i,
      fadeReturnPct,
      forward,
    });
    i = j + 1; // one open trade at a time
  }
  return trades;
}

/**
 * Backtest over many complete sessions. With volume, a session needs `baselineDays` prior sessions to get a
 * Z-score, so the earliest sessions are used only as baseline. Without volume (hasVolume = false) every
 * session is tested and Z is null. Sessions should all be full-length (the caller filters half-days) so
 * bucket positions line up.
 */
export function findBandTrades(
  sessions: SessionBars[],
  hasVolume: boolean,
  params: Partial<BandParams> = {}
): { trades: BandTrade[]; sessionsTested: number } {
  const p: BandParams = { ...DEFAULT_BAND_PARAMS, ...params };
  const trades: BandTrade[] = [];
  let sessionsTested = 0;

  sessions.forEach((session, si) => {
    if (session.bars.length < 3) return;
    let baseline: { mean: number[]; sd: number[] } | null = null;
    if (hasVolume) {
      baseline = volumeBaseline(sessions, si, p.baselineDays, p.useLogVolume);
      if (!baseline) return;
    }
    sessionsTested++;
    trades.push(...simulateSession(session.dateKey, session.bars, baseline, hasVolume, p, true));
  });

  return { trades, sessionsTested };
}

/**
 * Live scan: today's bars so far against a baseline built from the prior full sessions. Returns every touch
 * found so far today (earlier ones with their outcome, the latest possibly "open"). Returns null when there
 * are not enough prior sessions for the volume baseline.
 */
export function scanLiveSession(
  priorSessions: SessionBars[],
  today: SessionBars,
  hasVolume: boolean,
  params: Partial<BandParams> = {}
): BandTrade[] | null {
  const p: BandParams = { ...DEFAULT_BAND_PARAMS, ...params };
  let baseline: { mean: number[]; sd: number[] } | null = null;
  if (hasVolume) {
    baseline = volumeBaseline([...priorSessions, { dateKey: today.dateKey, bars: today.bars }], priorSessions.length, p.baselineDays, p.useLogVolume);
    if (!baseline) return null;
  }
  return simulateSession(today.dateKey, today.bars, baseline, hasVolume, p, false);
}

// ---------------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------------

export interface GroupSummary {
  label: string;
  n: number;
  hitVwapPct: number | null;
  stoppedPct: number | null;
  heldToCloseOutPct: number | null;
  avgReturnPct: number | null;
  ciLowerPct: number | null;
  ciUpperPct: number | null;
  ciExcludesZero: boolean;
  winRatePct: number | null;
  medianHoldBars: number | null;
  meanHoldBars: number | null;
  /** Share of trades whose entry bar was already beyond the stop line (see BandTrade.entryBeyondStop). */
  entryBeyondStopPct: number | null;
  /** Under 15 trades the bootstrap range is too loose to lean on. */
  smallSample: boolean;
}

export const SMALL_SAMPLE_TRADES = 15;

export function summarizeTrades(trades: BandTrade[], label: string): GroupSummary {
  const n = trades.length;
  if (n === 0) {
    return { label, n: 0, hitVwapPct: null, stoppedPct: null, heldToCloseOutPct: null, avgReturnPct: null, ciLowerPct: null, ciUpperPct: null, ciExcludesZero: false, winRatePct: null, medianHoldBars: null, meanHoldBars: null, entryBeyondStopPct: null, smallSample: true };
  }
  const rets = trades.map((t) => t.fadeReturnPct);
  const boot = bootstrapCi(rets);
  const share = (r: ExitReason) => (trades.filter((t) => t.exitReason === r).length / n) * 100; // callers pass resolved trades only
  return {
    label,
    n,
    hitVwapPct: share("target"),
    stoppedPct: share("stop"),
    heldToCloseOutPct: share("time"),
    avgReturnPct: mean(rets),
    ciLowerPct: boot.lower,
    ciUpperPct: boot.upper,
    ciExcludesZero: boot.ciExcludesZero,
    winRatePct: (rets.filter((r) => r > 0).length / n) * 100,
    medianHoldBars: median(trades.map((t) => t.barsHeld)),
    meanHoldBars: mean(trades.map((t) => t.barsHeld)),
    entryBeyondStopPct: (trades.filter((t) => t.entryBeyondStop).length / n) * 100,
    smallSample: n < SMALL_SAMPLE_TRADES,
  };
}

/**
 * The classes the spec cares about, plus the spec's Scenario B "as written" (Z < 1.0) so its overlap with
 * normal volume is visible instead of hidden.
 */
export function summarizeByVolumeClass(trades: BandTrade[]): GroupSummary[] {
  const z = (t: BandTrade) => t.volumeZ;
  return [
    summarizeTrades(trades, "All band touches"),
    summarizeTrades(trades.filter((t) => t.volumeClass === "climax"), "Climax (Z >= 2.0, spec Scenario A)"),
    summarizeTrades(trades.filter((t) => t.volumeClass === "elevated"), "Elevated (1.0 <= Z < 2.0, no spec rule)"),
    summarizeTrades(trades.filter((t) => t.volumeClass === "normal"), "Normal (-1.0 < Z < 1.0)"),
    summarizeTrades(trades.filter((t) => t.volumeClass === "low"), "Low (Z <= -1.0, truly low volume)"),
    summarizeTrades(trades.filter((t) => z(t) !== null && (z(t) as number) < 1), "Spec Scenario B as written (Z < 1.0)"),
  ];
}

export function summarizeBySide(trades: BandTrade[]): GroupSummary[] {
  return [
    summarizeTrades(trades.filter((t) => t.side === "upper"), "Upper-band touches (fade = short)"),
    summarizeTrades(trades.filter((t) => t.side === "lower"), "Lower-band touches (fade = long)"),
  ];
}

/** Linear-interpolated percentile of an unsorted sample (same method as numpy's default). */
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = ((s.length - 1) * p) / 100;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface ForwardRange {
  side: BandSide;
  horizon: string;
  n: number;
  /** 10th percentile of the percent change from the touch close. */
  lowerPct: number;
  medianPct: number;
  meanPct: number;
  /** 90th percentile. */
  upperPct: number;
  /** Share of touches where price moved back toward VWAP over that horizon, in percent. */
  towardVwapPct: number;
}

/** Lower and upper percent change after a touch, per time horizon and side. */
export function forwardRanges(trades: BandTrade[]): ForwardRange[] {
  const out: ForwardRange[] = [];
  for (const side of ["upper", "lower"] as BandSide[]) {
    const sub = trades.filter((t) => t.side === side);
    if (sub.length === 0) continue;
    for (const h of FORWARD_HORIZONS) {
      const v = sub.map((t) => t.forward[h.label]);
      const toward = v.filter((x) => (side === "upper" ? x < 0 : x > 0)).length;
      out.push({
        side,
        horizon: h.label,
        n: v.length,
        lowerPct: percentile(v, 10),
        medianPct: percentile(v, 50),
        meanPct: v.reduce((a, c) => a + c, 0) / v.length,
        upperPct: percentile(v, 90),
        towardVwapPct: (toward / v.length) * 100,
      });
    }
  }
  return out;
}

/**
 * Average half-width of the band as a percent of VWAP, over every bar after the warm-up, for the given
 * sessions. The lower band is the same distance below VWAP.
 */
export function bandWidthPct(
  sessions: SessionBars[],
  hasVolume: boolean,
  k: number = DEFAULT_BAND_PARAMS.k,
  warmupMinutes: number = DEFAULT_BAND_PARAMS.warmupMinutes
): { meanPct: number; p90Pct: number; bars: number } | null {
  const rel: number[] = [];
  for (const s of sessions) {
    if (s.bars.length === 0) continue;
    const { vwap, sigma } = sessionBandSeries(s.bars, hasVolume);
    const t0 = s.bars[0].datetime;
    s.bars.forEach((b, i) => {
      if ((b.datetime - t0) / 60000 >= warmupMinutes && vwap[i] > 0) rel.push((k * sigma[i] / vwap[i]) * 100);
    });
  }
  if (rel.length === 0) return null;
  return { meanPct: rel.reduce((a, c) => a + c, 0) / rel.length, p90Pct: percentile(rel, 90), bars: rel.length };
}

// ---------------------------------------------------------------------------------------------------
// Gamma context (a flag, not a gate)
// ---------------------------------------------------------------------------------------------------

export interface GammaContext {
  /** Dollar gamma per 1% move, calls plus puts. */
  grossPer1PctUsd: number;
  callPer1PctUsd: number;
  putPer1PctUsd: number;
  /** Calls minus puts: the sign if dealers are long calls and short puts (the common convention). */
  netCommonConventionUsd: number;
  /** Puts minus calls: the sign if dealers are short calls and long puts (the rule the GEX tab uses). */
  netAppConventionUsd: number;
  /** Gross dollar gamma as a percent of average daily dollar volume. */
  grossPctOfDailyDollarVolume: number;
  size: "negligible" | "modest" | "material";
  note: string;
}

// Judgment cut-offs, not validated: how big gross dollar gamma per 1% is next to a normal day's dollar volume.
export const GAMMA_NEGLIGIBLE_BELOW_PCT_OF_ADV = 3;
export const GAMMA_MATERIAL_ABOVE_PCT_OF_ADV = 10;

/**
 * Sizes dealer gamma against liquidity and shows both sign conventions. The sign cannot be observed from a
 * public chain (it needs trade-level data on who bought or sold), so this deliberately does not pick a
 * regime or switch anything off. Use it as context next to a signal.
 */
export function gammaContext(rows: { right: "call" | "put"; dollarGamma: number }[], avgDailyDollarVolume: number): GammaContext | null {
  if (rows.length === 0 || !(avgDailyDollarVolume > 0)) return null;
  const call = rows.filter((r) => r.right === "call").reduce((s, r) => s + r.dollarGamma, 0);
  const put = rows.filter((r) => r.right === "put").reduce((s, r) => s + r.dollarGamma, 0);
  const gross = call + put;
  const pct = (gross / avgDailyDollarVolume) * 100;
  const size = pct < GAMMA_NEGLIGIBLE_BELOW_PCT_OF_ADV ? "negligible" : pct < GAMMA_MATERIAL_ABOVE_PCT_OF_ADV ? "modest" : "material";
  return {
    grossPer1PctUsd: gross,
    callPer1PctUsd: call,
    putPer1PctUsd: put,
    netCommonConventionUsd: call - put,
    netAppConventionUsd: put - call,
    grossPctOfDailyDollarVolume: pct,
    size,
    note:
      "Whether dealers hold these options long or short cannot be seen in a public chain, so the two conventions give opposite regimes. Treat this as size context only. Cut-offs for negligible / modest / material are judgment, not validated.",
  };
}
