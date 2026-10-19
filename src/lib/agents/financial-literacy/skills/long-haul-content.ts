/**
 * Config for "The Long Haul" (Beginner tier) — a real driving game, not
 * trivia. Reworked from a single point-A-to-B track into a rideshare shift
 * around a small city crossroads, after a direct user report that the
 * original design didn't hold up: the gas-station loan refueled you to
 * finish a distance you could already finish on the fuel you had, so
 * declining it cost nothing and accepting it bought nothing. That's a real
 * design bug, not a tuning number — see long-haul-engine.ts for the fix
 * (the loan now only offers when the real remaining distance to finish the
 * shift's fares genuinely exceeds what the fuel left in the tank can cover).
 *
 * Three numbers below are real, sourced facts, not game-balance choices:
 * - LOAN_APR (391%): the commonly cited average two-week storefront
 *   payday-loan APR (CFPB/Pew: a typical $15-per-$100 two-week fee
 *   annualizes to ~391%) — the same figure already used in the Intermediate
 *   tier's Signal Check content, kept consistent across the app.
 * - ROLLOVER_RATE_TEXT: roughly 80% of payday loans are not paid off within
 *   14 days and are rolled into a new loan (CFPB loan-sequencing data,
 *   already sourced for bp3/bp12 on the business-plan tracker).
 * - The fare/repair framing below mirrors a real, common gig-driver cash-flow
 *   trap (a car expense that can't wait until the next payout) rather than
 *   an arbitrary "you happen to be low on gas" coincidence.
 * Every other number here (fare payouts, fuel-range tuning, vehicle tuning)
 * is a game-balance choice, not a cited fact.
 */

export const LONG_HAUL_MODULE_ID = "beginner-game-long-haul";

// ---- selectable cars --------------------------------------------------
// Stylized, low-poly interpretations of classic body shapes/proportions —
// not an attempt at a licensed, exact reproduction of any real manufacturer
// model, same "closest we can get without copyright" spirit the user asked
// for. Differentiated by proportion/roofline/stance, not just paint color.
export type CarRoofStyle = "formal" | "fastback" | "coupe" | "notchback";

export interface CarModel {
  id: string;
  label: string;
  blurb: string;
  bodyLength: number;
  bodyWidth: number;
  bodyHeight: number;
  roofStyle: CarRoofStyle;
  color: number;
  // Light flavor stat variation — a long formal sedan handles differently
  // than a shorter muscle coupe. Multipliers against VEHICLE's base numbers.
  maxSpeedMult: number;
  turnRateMult: number;
  accelMult: number;
}

export const CAR_MODELS: CarModel[] = [
  {
    id: "caprice89",
    label: "'89 Caprice",
    blurb: "Long, boxy, formal roofline — stable and steady, not quick.",
    bodyLength: 4.1,
    bodyWidth: 1.9,
    bodyHeight: 0.58,
    roofStyle: "formal",
    color: 0x2b3a4a,
    maxSpeedMult: 0.92,
    turnRateMult: 0.85,
    accelMult: 0.85,
  },
  {
    id: "chevelle71",
    label: "'71 Chevelle",
    blurb: "Long hood, fastback roofline — quick off the line.",
    bodyLength: 3.95,
    bodyWidth: 1.86,
    bodyHeight: 0.5,
    roofStyle: "fastback",
    color: 0x8a2e2e,
    maxSpeedMult: 1.05,
    turnRateMult: 0.95,
    accelMult: 1.1,
  },
  {
    id: "challenger",
    label: "Classic Challenger",
    blurb: "Wide stance, short deck, long hood — a real muscle coupe.",
    bodyLength: 3.75,
    bodyWidth: 1.98,
    bodyHeight: 0.48,
    roofStyle: "coupe",
    color: 0xe8a63c,
    maxSpeedMult: 1.08,
    turnRateMult: 1.0,
    accelMult: 1.12,
  },
  {
    id: "montecarlo",
    label: "Monte Carlo",
    blurb: "Personal-luxury coupe — smooth, planted, easy to place.",
    bodyLength: 3.9,
    bodyWidth: 1.88,
    bodyHeight: 0.52,
    roofStyle: "notchback",
    color: 0x3fd8c4,
    maxSpeedMult: 1.0,
    turnRateMult: 1.08,
    accelMult: 1.0,
  },
];

// ---- city layout --------------------------------------------------------
// One real crossroads, not an open unbounded city — a deliberately scoped
// first slice (buildings, sidewalks, a couple of turns, a few pedestrians)
// rather than promising GTA-scale and half-building it. See project memory
// for the fuller multi-block vision this is step one of.
export const CITY = {
  streetHalfWidth: 5, // the N-S corridor spans x in [-5, 5]
  crossStreetZ: -120, // center line of the E-W cross street
  crossStreetHalfWidth: 5, // spans z in [crossStreetZ-5, crossStreetZ+5]
  corridorStartZ: 20,
  corridorEndZ: -260,
  crossStreetHalfLength: 70, // spans x in [-70, 70]
  gasStationZ: -160, // landmark along the south leg, after the turn back onto the corridor
};

// ---- the shift: fares replace the old single finish line -----------------
// Each fare is pickup -> dropoff; `legDistance` is the real driving distance
// for that leg (pickup-to-dropoff), used by the engine's reachability check
// — the actual fix for "the loan let me finish a distance I could already
// finish." No hard shift timer, deliberately: a countdown adds real-time
// pressure on top of a driving task, which cuts against the same
// cognitive-bandwidth research the curriculum itself teaches (beginner-18).
// The real stakes come from the fuel-reachability math, not a clock.
export interface Fare {
  id: string;
  label: string;
  pickup: { x: number; z: number };
  dropoff: { x: number; z: number };
  legDistance: number;
  payout: number;
}

export const FARES: Fare[] = [
  {
    id: "f1",
    label: "Fare 1 — across town",
    pickup: { x: 0, z: -20 },
    dropoff: { x: 0, z: -90 },
    legDistance: 70,
    payout: 18,
  },
  {
    id: "f2",
    label: "Fare 2 — turn at the crossroads",
    pickup: { x: 0, z: -95 },
    dropoff: { x: 45, z: -120 },
    legDistance: 70, // ~25 to the intersection + ~45 east
    payout: 24,
  },
  {
    id: "f3",
    label: "Fare 3 — the long leg south",
    pickup: { x: 45, z: -120 },
    dropoff: { x: 0, z: -230 },
    legDistance: 155, // ~45 back to the intersection + ~110 south, past the gas station
    payout: 30,
  },
];

export const SHIFT = {
  cashGoal: FARES.reduce((sum, f) => sum + f.payout, 0), // 72 — complete every fare
};

export const VEHICLE = {
  baseMaxSpeed: 32,
  baseAccel: 22,
  brakeDecel: 40,
  coastDecel: 10,
  baseTurnRate: 2.0,
  roughSurfaceSpeedMult: 0.75, // unused on the city crossroads layout, kept for a future rural leg
  outOfFuelSpeedMult: 0.35, // "limp mode" — declining the loan doesn't hard-stop the run, it costs real time
  // Distance (units) one percentage point of fuel can cover — calibrated so
  // a clean, efficient run (no wrong turns, minimal idling) can finish the
  // whole ~295-unit shift on one tank without ever needing the loan. The
  // loan is a real rescue for inefficient play, not a scripted inevitability.
  fuelRangePerPercent: 3.3,
};

export const TRAILER = {
  maxSpeedMult: 0.68,
  turnRateMult: 0.65,
  accelMult: 0.6,
  lagFrames: 34,
};

export const ECONOMY = {
  fuelDrainAtFullThrottle: 6, // per second
  fuelDrainIdle: 0.5, // per second
  loanAmount: 50,
  loanAPR: 391, // sourced — see file comment
  rolloverRateText:
    "Real-world rollover rate on loans like this: about 80% aren't paid off within 14 days — most people still owe this again next time.",
};

export const XP = {
  onCleanFinish: 30, // completed every fare, never took the loan
  onFinishWithLoan: 15, // completed every fare, but still carrying the debt
};
