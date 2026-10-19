/**
 * Colours for "The Long Haul", taken from the app's design tokens (src/app/globals.css) so the game sits inside the product:
 * ink-950 #080b10, ink-900 #0e131b, ink-800 #131a24, ink-700 #1a2330, line #223040, signal teal #4fe8d0, verdict amber #f0a868,
 * danger #e8637a, text-0 #edf2f7. Everything else here is a tint or shade of those (a dusk-blue sky, asphalt, dirt) so the scene reads
 * as a dark ink-blue city lit by teal and amber.
 */
export const PAL = {
  ink950: 0x080b10,
  ink900: 0x0e131b,
  ink800: 0x131a24,
  ink700: 0x1a2330,
  line: 0x223040,
  lineBright: 0x35495e,
  signal: 0x4fe8d0,
  signalDim: 0x2a6e63,
  verdict: 0xf0a868,
  verdictDim: 0x7a5636,
  danger: 0xe8637a,
  text0: 0xedf2f7,
  // Derived tints
  /** Sky at the horizon and the fog colour (they must match so distant buildings dissolve into the sky). */
  horizon: 0x1b2a3f,
  zenith: 0x05080d,
  asphalt: 0x2c3541,
  asphaltDark: 0x1f2630,
  concrete: 0x3a4757,
  dirt: 0x6b5238,
  paint: 0xe9eef5,
  paintYellow: 0xf2c14e,
  glass: 0x0a1520,
  tyre: 0x12161c,
  trim: 0x10151c,
  lampWarm: 0xffd9a0,
  foliage: 0x1f4a44,
};
