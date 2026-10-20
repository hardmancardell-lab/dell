import { ECONOMY, TRACK, VEHICLE } from "./long-haul-content";

/**
 * The pure rules of "The Long Haul": speed integration, fuel burn, the
 * gas-station loan offer and the loan's rollover fees. long-haul-engine.ts
 * (Three.js + Rapier, not runnable headless) calls these every frame, and
 * scripts/quality/long-haul.test.mts runs the SAME functions in a 1-D replica
 * of the track, so the modeled runs cannot drift from the shipped game.
 *
 * Why this file exists (2026-10 audit): with the old constants the loan offer
 * never appeared on the highway lane (a full-throttle run reached the gas
 * station with 48.6 fuel against a threshold of 40) and the loan never cost
 * more than its flat $50, so the lesson was told, not shown.
 *
 * Real-user bug fix (2026-10-20): shouldOfferLoan() used to compare fuel
 * against a flat percentage (gasStationFuelThreshold) regardless of how much
 * road was actually left — so the loan could refuel the car for a distance
 * it could already finish on the fuel it had. Declining then cost nothing
 * and accepting bought nothing, which defeats the whole point of the
 * decision. Fixed below: the offer is now gated on real reachability (the
 * distance the remaining fuel can cover at full throttle vs. the real
 * remaining distance to the finish), not a fuel percentage.
 */

export interface SpeedTuning {
  maxSpeed: number;
  accel: number;
}

/** One integration step of the car's speed. throttle: 1 forward, -1 brake/reverse, 0 coast. */
export function stepSpeed(speed: number, throttle: -1 | 0 | 1, tuning: SpeedTuning, dt: number): number {
  let s = speed;
  if (throttle > 0) s += tuning.accel * dt;
  else if (throttle < 0) s -= VEHICLE.brakeDecel * dt;
  else s -= Math.sign(s) * VEHICLE.coastDecel * dt;
  s = Math.max(-tuning.maxSpeed * 0.5, Math.min(tuning.maxSpeed, s));
  if (Math.abs(s) < 0.05) s = 0;
  return s;
}

export function fuelAfter(fuel: number, throttleOn: boolean, dt: number): number {
  const drain = ECONOMY.fuelDrainIdle + (throttleOn ? ECONOMY.fuelDrainAtFullThrottle : 0);
  return Math.max(0, fuel - drain * dt);
}

/** Distance the remaining fuel can cover driving the rest of the way at full throttle — the real "can I make it on this tank" number. */
export function fuelRange(fuel: number): number {
  return fuel * (VEHICLE.baseMaxSpeed / ECONOMY.fuelDrainAtFullThrottle);
}

/** The gas station offers the quick-cash loan only when the fuel left genuinely cannot cover the real remaining distance to the finish. */
export function shouldOfferLoan(fuel: number, remainingDistance: number): boolean {
  return fuelRange(fuel) < remainingDistance;
}

/** Fee charged each time a payday-style loan rolls over: principal x APR x 14/365 ($7.50 on $50 at 391%). */
export const ROLLOVER_FEE = Math.round(ECONOMY.loanAmount * (ECONOMY.loanAPR / 100) * (14 / 365) * 100) / 100;

export interface LoanState {
  /** Total owed: the original loan plus every rollover fee so far (principal never shrinks). */
  debt: number;
  rollovers: number;
  clock: number;
}

export const NO_LOAN: LoanState = { debt: 0, rollovers: 0, clock: 0 };

export function takeLoan(): LoanState {
  return { debt: ECONOMY.loanAmount, rollovers: 0, clock: 0 };
}

/**
 * Each ECONOMY.rolloverIntervalSeconds of driving stands in for the 14-day loan
 * term. When it passes and the loan is not repaid it rolls over: a new fee is
 * added and the principal is untouched, which is exactly how the real product
 * accumulates its cost.
 */
export function advanceLoan(state: LoanState, dt: number): LoanState {
  if (state.debt <= 0) return state;
  let clock = state.clock + dt;
  let { debt, rollovers } = state;
  while (clock >= ECONOMY.rolloverIntervalSeconds) {
    clock -= ECONOMY.rolloverIntervalSeconds;
    debt = Math.round((debt + ROLLOVER_FEE) * 100) / 100;
    rollovers += 1;
  }
  return { debt, rollovers, clock };
}
