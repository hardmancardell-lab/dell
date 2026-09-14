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
  gasStationFuelThreshold: 40,
  finishZ: -320,
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
  fuelDrainAtFullThrottle: 6, // per second
  fuelDrainIdle: 0.5, // per second
  tollCost: 5,
  loanAmount: 50,
  loanAPR: 391, // sourced — see file comment
  rolloverRateText:
    "Real-world rollover rate on loans like this: about 80% aren't paid off within 14 days — most people still owe this again next time.",
};

export const XP = {
  onCleanFinish: 30, // finished without ever taking the loan
  onFinishWithLoan: 15, // finished, but still carrying the debt trailer
};
