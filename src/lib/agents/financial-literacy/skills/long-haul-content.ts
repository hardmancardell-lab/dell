/**
 * Config for "The Long Haul" (Beginner tier) — a real driving game, not
 * trivia. Route choice, the quick-loan gas station, and the debt trailer are
 * the same theme-as-mechanic design locked with the user on the business-
 * plan tracker (ft1): debt is rendered as a physical, felt handling penalty,
 * not a stat card. This is the vertical-slice track (one loop, one lane
 * fork) — see LongHaulTrackConfig for what a second/third track would vary.
 *
 * Two numbers below are real, sourced facts, not game-balance choices:
 * - LOAN_APR (391%): the commonly cited average two-week storefront
 *   payday-loan APR (CFPB/Pew: a typical $15-per-$100 two-week fee
 *   annualizes to ~391%) — the same figure already used in the Intermediate
 *   tier's Signal Check content, kept consistent across the app.
 * - ROLLOVER_RATE_TEXT: roughly 80% of payday loans are not paid off within
 *   14 days and are rolled into a new loan (CFPB loan-sequencing data,
 *   already sourced for bp3/bp12 on the business-plan tracker).
 * Every other number here (toll cost, loan amount, fuel drain rate, vehicle
 * tuning) is a game-balance choice, not a cited fact.
 */

export const LONG_HAUL_MODULE_ID = "beginner-game-long-haul";

export const TRACK = {
  halfWidth: 20,
  laneSplitStartZ: -60,
  laneSplitEndZ: -190,
  tollZ: -100,
  gasStationZ: -230,
  finishZ: -320,
};

/**
 * One real, turnable cross street, early on the main corridor -- between the
 * car's spawn (z = 0, heading toward -z) and TRACK.laneSplitStartZ (-60), so
 * it doesn't touch the fork/toll/gas-station/finish economy already tuned
 * and tested against the straight corridor. The car's heading-based
 * steering already supports a real turn -- this is purely a world-geometry
 * and boundary-clamp change (long-haul-world.ts, long-haul-engine.ts), not a
 * physics or rules change. Continuing straight through it costs effectively
 * no extra distance (halfWidth is small relative to the ~90+ unit legs
 * already tuned), so it doesn't require re-tuning ECONOMY; turning onto it
 * is a real, explorable detour with buildings and sidewalks down both
 * sides, not a scored shortcut.
 */
export const CITY_CROSS = {
  z: -25,
  halfWidth: 14, // z-span of the open intersection (no buildings, clamp relaxed) on the main corridor
  streetHalfLength: 55, // how far the cross street reaches to each side (x)
  streetHalfWidth: 9, // the cross street's own drivable half-width
};

export const VEHICLE = {
  baseMaxSpeed: 32,
  baseAccel: 22,
  brakeDecel: 40,
  coastDecel: 10,
  baseTurnRate: 2.0,
  roughSurfaceSpeedMult: 0.75, // back-roads lane
  outOfFuelSpeedMult: 0.35, // "limp mode" — declining the loan and running dry doesn't hard-stop the run
};

export const TRAILER = {
  maxSpeedMult: 0.68,
  turnRateMult: 0.65,
  accelMult: 0.6,
  lagFrames: 14,
};

export const ECONOMY = {
  // Raised from 6 to 9 so that holding the throttle on the HIGHWAY reaches the
  // gas station with too little range left to finish (fuelRange() in
  // long-haul-rules.ts) and the loan offer is actually shown on both lanes; a
  // lighter foot (about half throttle) still finishes clean, so fuel
  // management is a real choice. Checked by scripts/quality/long-haul.test.mts.
  fuelDrainAtFullThrottle: 9, // per second
  fuelDrainIdle: 0.5, // per second
  tollCost: 5,
  loanAmount: 50,
  loanAPR: 391, // sourced — see file comment
  // Game-balance choice: this many seconds of driving stand in for one 14-day
  // loan term. If the loan is still open when it passes, it rolls over and the
  // fee ($7.50 on $50 at 391%) is added again (long-haul-rules.ts).
  rolloverIntervalSeconds: 3,
  rolloverRateText:
    "Real-world rollover rate on loans like this: about 80% aren't paid off within 14 days — most people still owe this again next time.",
};

export const XP = {
  onCleanFinish: 30, // finished without ever taking the loan
  onFinishWithLoan: 15, // finished, but still carrying the debt trailer
};

/**
 * A selectable classic car's silhouette, in the same car-space (shape x = z
 * forward, y = height) long-haul-geometry.ts's default hatchback uses.
 * hoodZ/deckZ mark the front and back of the glazed greenhouse: everything
 * ahead of hoodZ is hood, everything behind deckZ is trunk/deck. All 4 share
 * the hatchback's fixed wheelbase (long-haul-geometry.ts's CAR.frontAxleZ/
 * rearAxleZ/wheelX) -- only the visible body overhang and roofline change,
 * the same way real cars on a shared platform differ.
 *
 * Kept here (not in long-haul-geometry.ts, which imports three.js at module
 * scope) so LongHaulGame.tsx can show the car-picker screen's id/label/
 * blurb/color before the Three.js-touching engine module is ever imported --
 * same lazy-load discipline as that component's dynamic engine import.
 *
 * Tuned against real reference photos: an Impala SS confirmed the boxy,
 * upright 4-light formal roofline for the Caprice; a Chevelle SS 454 photo
 * is why the Chevelle gets a true continuous taper (no flat roof cap) instead
 * of a boxy cabin with a slight tilt; Challenger/Monte Carlo photos drove the
 * long-hood/short-deck coupe vs. sharp-notch-into-a-short-deck distinction.
 */
export interface CarModel {
  id: string;
  label: string;
  blurb: string;
  color: number;
  length: number;
  width: number;
  rockerY: number;
  beltlineY: number;
  roofY: number;
  hoodZ: number;
  deckZ: number;
  roofStyle: "formal" | "fastback" | "coupe" | "notchback";
}

export const CAR_MODELS: CarModel[] = [
  {
    id: "caprice89",
    label: "'89 Caprice",
    blurb: "Long, boxy, formal roofline — stable and steady, not quick.",
    color: 0x2b3a4a,
    length: 4.3,
    width: 1.86,
    rockerY: 0.28,
    beltlineY: 0.84,
    roofY: 1.46,
    hoodZ: 0.55,
    deckZ: -0.75,
    roofStyle: "formal",
  },
  {
    id: "chevelle71",
    label: "'71 Chevelle",
    blurb: "Long hood, roofline tapers straight down into the deck.",
    color: 0x8a2e2e,
    length: 4.15,
    width: 1.82,
    rockerY: 0.26,
    beltlineY: 0.78,
    roofY: 1.22,
    hoodZ: 0.75,
    deckZ: -0.85,
    roofStyle: "fastback",
  },
  {
    id: "challenger",
    label: "Classic Challenger",
    blurb: "Wide stance, short deck, long hood — a real muscle coupe.",
    color: 0xe8a63c,
    length: 3.95,
    width: 1.92,
    rockerY: 0.26,
    beltlineY: 0.8,
    roofY: 1.18,
    hoodZ: 0.65,
    deckZ: -1.15,
    roofStyle: "coupe",
  },
  {
    id: "montecarlo",
    label: "Monte Carlo",
    blurb: "Personal-luxury coupe — sharp notch into a short, flat deck.",
    color: 0x3fd8c4,
    length: 4.1,
    width: 1.84,
    rockerY: 0.27,
    beltlineY: 0.82,
    roofY: 1.3,
    hoodZ: 0.5,
    deckZ: -0.75,
    roofStyle: "notchback",
  },
];
