/**
 * Pure "feel" maths for The Long Haul: field-of-view widening, rough-road shake, wheel spin, steering and lean, and the frame-time
 * monitor behind the low-quality fallback. No Three.js, no DOM, so all of it is unit tested in Node.
 */

export const FEEL = {
  baseFov: 62,
  maxFovBoost: 9,
  maxSteerRad: 0.38,
  maxRoll: 0.045,
  maxPitch: 0.03,
  shakeMetres: 0.045,
};

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Camera field of view: widens smoothly with speed. Stays at the base value when reduced motion is on. */
export function fovForSpeed(speedFraction: number, reducedMotion: boolean): number {
  if (reducedMotion) return FEEL.baseFov;
  const f = clamp01(speedFraction);
  return FEEL.baseFov + FEEL.maxFovBoost * f * f * (3 - 2 * f);
}

/** Camera shake size in metres: only on the rough lane, grows with speed, zero with reduced motion or at rest. */
export function shakeAmplitude(speedFraction: number, onDirt: boolean, reducedMotion: boolean): number {
  if (reducedMotion || !onDirt) return 0;
  return FEEL.shakeMetres * clamp01(speedFraction);
}

/** Wheel rotation (radians) for one frame of rolling at `speed` m/s. Positive speed spins the wheel forward. */
export function wheelSpinDelta(speed: number, dt: number, radius: number): number {
  if (!Number.isFinite(speed) || !Number.isFinite(dt) || radius <= 0) return 0;
  return (speed * dt) / radius;
}

/** Front-wheel yaw for a steering input in [-1, 1]; positive input (steer right) yaws the wheels right, which is a negative local angle. */
export function steerYaw(steerInput: number): number {
  const s = Number.isFinite(steerInput) ? Math.min(1, Math.max(-1, steerInput)) : 0;
  return -s * FEEL.maxSteerRad;
}

/** Body roll about the car's forward axis: leans toward the outside of the turn, more with speed. Sign as steerYaw (right turn is negative). */
export function bodyRoll(steerInput: number, speedFraction: number): number {
  const s = Number.isFinite(steerInput) ? Math.min(1, Math.max(-1, steerInput)) : 0;
  return -s * clamp01(speedFraction) * FEEL.maxRoll;
}

/** Body pitch: nose lifts under acceleration (negative), dips under braking (positive). accel is normalised to [-1, 1]. */
export function bodyPitch(accelNormalised: number): number {
  const a = Number.isFinite(accelNormalised) ? Math.min(1, Math.max(-1, accelNormalised)) : 0;
  return a >= 0 ? -a * FEEL.maxPitch * 0.7 : -a * FEEL.maxPitch;
}

/** Move `current` toward `target` with an exponential ease that does not depend on the frame rate. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  if (!Number.isFinite(current)) return Number.isFinite(target) ? target : 0;
  if (!Number.isFinite(target) || !Number.isFinite(dt) || dt <= 0) return current;
  return target + (current - target) * Math.exp(-rate * dt);
}

/** Small smooth "road noise" in [-1, 1] built from incommensurate sines, so shake and bounce never need random numbers per frame. */
export function roughNoise(t: number, seed = 0): number {
  return (Math.sin(t * 37.1 + seed) * 0.5 + Math.sin(t * 61.7 + seed * 1.7) * 0.3 + Math.sin(t * 23.3 + seed * 0.6) * 0.2);
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Watches frame times and trips once when the average over a window stays above the limit (default: above 25 ms for two seconds).
 * A frame longer than `ignoreAboveMs` (the tab was hidden or the page stalled) restarts the window instead of counting.
 */
export class FrameBudget {
  private sum = 0;
  private n = 0;
  private windowMs = 0;
  private tripped = false;

  constructor(
    private readonly limitMs = 25,
    private readonly windowTotalMs = 2000,
    private readonly ignoreAboveMs = 250,
    /** Frames during this much start-up time are not judged: shader compilation and texture upload make the first frames slow everywhere. */
    private readonly warmupMs = 3000,
  ) {}
  private elapsedMs = 0;

  get isTripped(): boolean {
    return this.tripped;
  }

  /** Feed one frame's duration in ms. Returns true exactly once, on the frame that trips the budget. */
  push(frameMs: number): boolean {
    if (this.tripped || !Number.isFinite(frameMs) || frameMs <= 0) return false;
    if (this.elapsedMs < this.warmupMs) {
      this.elapsedMs += Math.min(frameMs, this.ignoreAboveMs);
      return false;
    }
    if (frameMs > this.ignoreAboveMs) {
      this.restartWindow();
      return false;
    }
    this.sum += frameMs;
    this.n += 1;
    this.windowMs += frameMs;
    if (this.windowMs >= this.windowTotalMs) {
      const average = this.sum / this.n;
      this.restartWindow();
      if (average > this.limitMs) {
        this.tripped = true;
        return true;
      }
    }
    return false;
  }

  private restartWindow(): void {
    this.sum = 0;
    this.n = 0;
    this.windowMs = 0;
  }
}
