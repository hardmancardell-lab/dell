/**
 * The .jarvis design tokens as plain values, for places that cannot read CSS custom properties
 * (canvas charts, Phaser games, SVG attributes). globals.css stays the source of truth:
 * scripts/quality/check-design-tokens.cjs fails if any value here drifts from it, and counts hex
 * literals everywhere else so components import from here instead of copying colours.
 */
export const JARVIS = {
  ink950: "#080b10",
  ink900: "#0e131b",
  ink800: "#131a24",
  ink700: "#1a2330",
  line: "#223040",
  lineBright: "#35495e",
  lineControl: "#4a6683",
  signal: "#4fe8d0",
  signalDim: "#2a6e63",
  verdict: "#f0a868",
  verdictDim: "#7a5636",
  danger: "#e8637a",
  text0: "#edf2f7",
  text1: "#9fb0c4",
  text2: "#7b8ca2",
} as const;

/** Hex string to the 0xRRGGBB number Phaser expects for fills and strokes. */
export const toPhaserColor = (hex: string): number => parseInt(hex.slice(1), 16);
