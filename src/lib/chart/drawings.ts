// Pure model for chart drawings (horizontal line, trend line, rectangle): types, validation, persistence per symbol and
// timeframe, pixel hit testing, and time <-> bar-index mapping that works beyond the last bar. No chart or DOM access, so
// all of it is unit-tested. Drawings are anchored in chart DATA coordinates (time in epoch seconds, price), so they stay
// on the right bar and level when the chart is zoomed, panned, resized, or the scale mode changes.
import { DEFAULT_DRAWING_COLOR, isDrawingColor } from "./colors";

export type DrawingKind = "hline" | "trend" | "rect";
export const DRAWING_KINDS: readonly DrawingKind[] = ["hline", "trend", "rect"];

export interface AnchorPoint {
  /** Epoch seconds. */
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawingKind;
  color: string;
  /** hline: only `price` of p1 is used. trend and rect: both points are used. */
  p1: AnchorPoint;
  p2?: AnchorPoint;
}

export const KIND_LABELS: Record<DrawingKind, string> = { hline: "Horizontal line", trend: "Trend line", rect: "Rectangle" };

/** Most drawings kept per symbol and timeframe (also the most read back from storage). */
export const MAX_DRAWINGS = 100;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isPoint = (p: unknown): p is AnchorPoint => typeof p === "object" && p !== null && finite((p as AnchorPoint).time) && finite((p as AnchorPoint).price);

/** Returns a clean Drawing or null for anything malformed. Unknown colours fall back to the default drawing colour. */
export function validateDrawing(x: unknown): Drawing | null {
  if (typeof x !== "object" || x === null) return null;
  const d = x as Partial<Drawing>;
  if (typeof d.id !== "string" || d.id.length === 0 || d.id.length > 64) return null;
  if (!DRAWING_KINDS.includes(d.kind as DrawingKind)) return null;
  if (!isPoint(d.p1)) return null;
  const color = isDrawingColor(d.color) ? d.color : DEFAULT_DRAWING_COLOR;
  if (d.kind === "hline") return { id: d.id, kind: "hline", color, p1: { time: d.p1.time, price: d.p1.price } };
  if (!isPoint(d.p2)) return null;
  return { id: d.id, kind: d.kind as DrawingKind, color, p1: { time: d.p1.time, price: d.p1.price }, p2: { time: d.p2.time, price: d.p2.price } };
}

export function validateDrawings(x: unknown): Drawing[] {
  if (!Array.isArray(x)) return [];
  const out: Drawing[] = [];
  const seen = new Set<string>();
  for (const item of x) {
    const d = validateDrawing(item);
    if (d && !seen.has(d.id)) {
      seen.add(d.id);
      out.push(d);
    }
    if (out.length >= MAX_DRAWINGS) break;
  }
  return out;
}

export function drawingsStorageKey(symbol: string, timeframe: string): string {
  return `dellegate.chart.drawings.v1:${String(symbol).trim().toUpperCase()}:${timeframe}`;
}

export function loadDrawings(key: string, store: Pick<Storage, "getItem"> | null = safeLocal()): Drawing[] {
  try {
    const raw = store?.getItem(key);
    return raw ? validateDrawings(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Saves the list (an empty list removes the key). Never throws. Returns false when storage refused. */
export function saveDrawings(key: string, drawings: readonly Drawing[], store: Pick<Storage, "setItem" | "removeItem"> | null = safeLocal()): boolean {
  try {
    if (!store) return false;
    if (drawings.length === 0) store.removeItem(key);
    else store.setItem(key, JSON.stringify(drawings.slice(0, MAX_DRAWINGS)));
    return true;
  } catch {
    return false;
  }
}

function safeLocal(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

let counter = 0;
export function newDrawingId(): string {
  counter += 1;
  return `d${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Translates a drawing by a time and a price delta. An hline ignores the time delta. */
export function translateDrawing(d: Drawing, dTime: number, dPrice: number): Drawing {
  const mv = (p: AnchorPoint): AnchorPoint => ({ time: p.time + dTime, price: p.price + dPrice });
  if (d.kind === "hline") return { ...d, p1: { time: d.p1.time, price: d.p1.price + dPrice } };
  return { ...d, p1: mv(d.p1), p2: d.p2 ? mv(d.p2) : undefined };
}

/** Replaces one endpoint (1 or 2). An hline only takes the price. */
export function moveEndpoint(d: Drawing, which: 1 | 2, to: AnchorPoint): Drawing {
  if (d.kind === "hline") return { ...d, p1: { time: d.p1.time, price: to.price } };
  return which === 1 ? { ...d, p1: { ...to } } : { ...d, p2: { ...to } };
}

// ---------------------------------------------------------------- pixel geometry

export interface PixelGeometry {
  kind: DrawingKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Plot width, so a horizontal line spans the pane. */
  width: number;
}

export type HitPart = "p1" | "p2" | "body";

/** Distance from a point to a segment. A zero-length segment is the distance to the point. */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * What the pointer is over, or null. Endpoint handles win over the body. The body of a rectangle is its four edges (not
 * its inside, so a big rectangle never blocks panning the chart). `tol` is the pick radius in CSS pixels.
 */
export function hitGeometry(g: PixelGeometry, x: number, y: number, tol = 7): HitPart | null {
  if (g.kind === "hline") return Math.abs(y - g.y1) <= tol ? "body" : null;
  if (Math.hypot(x - g.x1, y - g.y1) <= tol + 2) return "p1";
  if (Math.hypot(x - g.x2, y - g.y2) <= tol + 2) return "p2";
  if (g.kind === "trend") return distToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= tol ? "body" : null;
  const l = Math.min(g.x1, g.x2), r = Math.max(g.x1, g.x2), tp = Math.min(g.y1, g.y2), b = Math.max(g.y1, g.y2);
  const near = Math.min(
    distToSegment(x, y, l, tp, r, tp),
    distToSegment(x, y, r, tp, r, b),
    distToSegment(x, y, r, b, l, b),
    distToSegment(x, y, l, b, l, tp)
  );
  return near <= tol ? "body" : null;
}

// ---------------------------------------------------------------- time <-> bar index

/** Typical bar spacing in seconds, from the newest bars (an overnight gap does not inflate it: the smallest positive gap wins). */
export function barSpacingSec(times: readonly number[]): number {
  let best = Infinity;
  for (let i = Math.max(1, times.length - 20); i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < best) best = gap;
  }
  return Number.isFinite(best) ? best : 86_400;
}

/**
 * Continuous bar index of a time: whole numbers are bar positions, fractions are linear between two bars, and times
 * before the first or after the last bar extend at the typical spacing so a trend line can run into the future.
 */
export function timeToBarIndex(times: readonly number[], sec: number): number | null {
  const n = times.length;
  if (n === 0 || !Number.isFinite(sec)) return null;
  const sp = barSpacingSec(times);
  if (sec <= times[0]) return (sec - times[0]) / sp;
  if (sec >= times[n - 1]) return n - 1 + (sec - times[n - 1]) / sp;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= sec) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return lo + (span > 0 ? (sec - times[lo]) / span : 0);
}

/** Inverse of timeToBarIndex. */
export function barIndexToTime(times: readonly number[], idx: number): number | null {
  const n = times.length;
  if (n === 0 || !Number.isFinite(idx)) return null;
  const sp = barSpacingSec(times);
  if (idx <= 0) return times[0] + idx * sp;
  if (idx >= n - 1) return times[n - 1] + (idx - (n - 1)) * sp;
  const lo = Math.floor(idx);
  return times[lo] + (idx - lo) * (times[lo + 1] - times[lo]);
}

/** Snaps a time to the nearest bar open inside the data (outside the data it is kept as is). */
export function snapToBar(times: readonly number[], sec: number): number {
  const idx = timeToBarIndex(times, sec);
  if (idx === null || idx < 0 || idx > times.length - 1) return sec;
  return times[Math.round(idx)];
}

/** Nudge size for keyboard moves: 0.25% of the price, never below 0.01. */
export function keyboardPriceStep(price: number): number {
  return Math.max(0.01, Math.abs(price) * 0.0025);
}
