// Chart colours for the new chart layers. Everything derives from the shared jarvis tokens (src/lib/design/tokens.ts) so
// there are no hex or rgb literals in components; canvas drawing cannot read CSS variables, hence the helper below.
import { JARVIS, INDICATOR_COLORS } from "@/lib/design/tokens";

/** "#rrggbb" plus an alpha 0..1 to an rgba() string. Bad input returns the hex unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const a = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Colours a user can give a drawing. Order is the picker order; the first is the default. Names are shown as button labels. */
export const DRAWING_COLORS: readonly { id: string; label: string; hex: string }[] = [
  { id: "signal", label: "Teal", hex: JARVIS.signal },
  { id: "verdict", label: "Amber", hex: JARVIS.verdict },
  { id: "danger", label: "Rose", hex: JARVIS.danger },
  { id: "text", label: "Light grey", hex: JARVIS.text0 },
  { id: "blue", label: "Blue", hex: INDICATOR_COLORS.ichimokuTenkan },
  { id: "violet", label: "Violet", hex: INDICATOR_COLORS.ema20 },
];

export const DEFAULT_DRAWING_COLOR = DRAWING_COLORS[0].hex;

export function isDrawingColor(hex: unknown): hex is string {
  return typeof hex === "string" && DRAWING_COLORS.some((c) => c.hex.toLowerCase() === hex.toLowerCase());
}

/** Palette for the chart chrome (extended-session shading, event markers, compare line). */
export const CHART_CHROME = {
  extendedShade: withAlpha(JARVIS.text2, 0.1),
  selection: JARVIS.text0,
  split: JARVIS.verdict,
  dividend: JARVIS.signal,
  compare: INDICATOR_COLORS.keltner,
  legendBg: withAlpha(JARVIS.ink950, 0.75),
} as const;
