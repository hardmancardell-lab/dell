// @ts-nocheck
// Detection and outcome functions for the intraday key-reversal study (scripts/intraday-reversal-study.mts).
// Pure functions, no I/O. A "bar" is { minute, open, high, low, close } where `minute` is the bar START in
// Eastern minutes since midnight (9:30 = 570); bars are in time order and 5 minutes wide.
//
// REAL-TIME RULE: every detection function reads bars[0..t] only. The bar's close is the decision time.
// The realised session high or low (and anything after t) is used only by outcomeAt(), which produces labels.

export const KR = {
  sessionOpenMinute: 570, // 9:30 ET
  sessionEndMinute: 960, // 16:00 ET (exclusive bar start)
  firstEvalMinute: 600, // first evaluated bar STARTS at 10:00 (skips the first 30 minutes)
  lastEvalMinute: 925, // last evaluated bar STARTS at 15:25, so its close is 15:30
  closeFraction: 0.25, // closes in the lowest (highest) 25% of its own range
  bucketMinutes: 30,
  horizonsBars: { ret15m: 3, ret30m: 6, ret60m: 12 },
  holdBars: 6, // the extreme must not be exceeded over the following 30 minutes
};

export const bucketOf = (minute: number) => Math.floor((minute - KR.sessionOpenMinute) / KR.bucketMinutes);

/** Direction "high": fresh session high, bearish reversal expected (sign -1). Direction "low": fresh session low, bullish (sign +1). */
export const dirSign = (dir: "high" | "low") => (dir === "high" ? -1 : 1);

/** True if bar t is evaluated at all: its start is within 10:00 .. 15:25 ET. */
export function inEvalWindow(bars, t: number): boolean {
  const m = bars[t]?.minute;
  return m !== undefined && m >= KR.firstEvalMinute && m <= KR.lastEvalMinute;
}

/** Bar t sets a strictly fresh session high (low): beyond every EARLIER bar of the session. Needs t >= 1. */
export function isFreshExtreme(bars, t: number, dir: "high" | "low"): boolean {
  if (t < 1) return false;
  if (dir === "high") {
    for (let i = 0; i < t; i++) if (!(bars[t].high > bars[i].high)) return false;
    return true;
  }
  for (let i = 0; i < t; i++) if (!(bars[t].low < bars[i].low)) return false;
  return true;
}

/**
 * Key reversal at bar t (reads bars[0..t] only).
 * "high": fresh session high AND close within the lowest 25% of bar t's own range AND close strictly below the previous bar's low.
 * "low":  mirror: fresh session low AND close within the top 25% of range AND close strictly above the previous bar's high.
 * A zero-range bar has no defined close position and is never a reversal.
 */
export function isKeyReversal(bars, t: number, dir: "high" | "low"): boolean {
  if (t < 1 || !isFreshExtreme(bars, t, dir)) return false;
  const b = bars[t], prev = bars[t - 1];
  const range = b.high - b.low;
  if (!(range > 0)) return false;
  if (dir === "high") return b.close <= b.low + KR.closeFraction * range && b.close < prev.low;
  return b.close >= b.high - KR.closeFraction * range && b.close > prev.high;
}

/**
 * Walk a session and list every evaluated bar that sets a fresh extreme, labelled "reversal" (meets the full
 * definition) or "fresh" (fresh extreme, not a reversal: the control-1 pool). Reads only bars up to each t.
 */
export function detectSession(bars) {
  const events = [];
  for (let t = 1; t < bars.length; t++) {
    if (!inEvalWindow(bars, t)) continue;
    for (const dir of ["high", "low"] as const) {
      if (!isFreshExtreme(bars, t, dir)) continue;
      events.push({ t, dir, kind: isKeyReversal(bars, t, dir) ? "reversal" : "fresh", minute: bars[t].minute, bucket: bucketOf(bars[t].minute) });
    }
  }
  return events;
}

/** Index of the bar k slots after t if it starts exactly 5*k minutes later (no data gap), else null. */
function barAfter(bars, t: number, k: number) {
  const j = t + k;
  if (j >= bars.length) return null;
  return bars[j].minute === bars[t].minute + 5 * k ? j : null;
}

/**
 * Outcomes for a bar t in direction dir. Uses the FUTURE by design (labels, not signals).
 * Returns are basis points from bar t's close, signed so that positive means the reversal direction worked
 * (down after a high, up after a low). A horizon that runs past the session (or across a data gap) is null.
 */
export function outcomeAt(bars, t: number, dir: "high" | "low") {
  const s = dirSign(dir), c0 = bars[t].close;
  const sgn = (c: number) => s * (c / c0 - 1) * 1e4;
  const out: any = {};
  for (const [name, k] of Object.entries(KR.horizonsBars)) {
    const j = barAfter(bars, t, k as number);
    out[name] = j === null ? null : sgn(bars[j].close);
  }
  out.retClose = sgn(bars[bars.length - 1].close);
  const jEnd = barAfter(bars, t, KR.holdBars);
  if (jEnd === null) out.holds30 = null;
  else {
    let held = true;
    for (let j = t + 1; j <= jEnd; j++) {
      if (dir === "high" ? bars[j].high > bars[t].high : bars[j].low < bars[t].low) { held = false; break; }
    }
    out.holds30 = held;
  }
  // Was bar t the realised session extreme? Earlier bars are beyond-exceeded by construction (fresh extreme); check later bars.
  let real = true;
  for (let j = t + 1; j < bars.length; j++) {
    if (dir === "high" ? bars[j].high > bars[t].high : bars[j].low < bars[t].low) { real = false; break; }
  }
  out.isRealisedExtreme = real;
  return out;
}
