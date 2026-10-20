import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TRACK, VEHICLE, TRAILER, ECONOMY } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import { LongHaulAudio } from "./long-haul-audio";
import { advanceLoan, fuelAfter, NO_LOAN, shouldOfferLoan, stepSpeed, takeLoan, type LoanState } from "@/lib/agents/financial-literacy/skills/long-haul-rules";
import { PAL } from "./long-haul-palette";
import { ResourceBin, disposeObject3D } from "./long-haul-geometry";
import { makeBlobShadowTexture, makeGlowTexture, makeHeadlightPoolTexture } from "./long-haul-textures";
import { LongHaulWorld, FOG_NEAR, FOG_FAR } from "./long-haul-world";
import { LongHaulCar } from "./long-haul-car";
import { DriveEffects } from "./long-haul-effects";
import { FEEL, FrameBudget, approach, fovForSpeed, prefersReducedMotion, roughNoise, shakeAmplitude } from "./long-haul-feel";

/**
 * Three.js + Rapier engine for "The Long Haul", framework-agnostic on
 * purpose (no React in this file) — same separation as curriculum-content.ts
 * vs. FinancialLiteracyTab.tsx elsewhere in this agent. React only owns the
 * HUD/modal/summary overlay via the callbacks below; this class owns the
 * canvas, the physics world, and the driving loop.
 *
 * Ported from a standalone prototype that was actually driven and verified
 * (not just reviewed) before this port — see project memory for the 3 real
 * bugs that surfaced only by testing: inverted steering, a Rapier internal
 * timestep that doesn't track real elapsed time by default, and boundary
 * walls that don't stop the car because this velocity-override controller
 * overwrites the rigid body's velocity every frame regardless of what the
 * collision solver just computed. All three fixes are preserved below.
 *
 * The look (car, road, city, effects) lives in long-haul-car.ts, long-haul-world.ts and
 * long-haul-effects.ts; none of it changes the rules or the physics.
 */

export interface LongHaulHud {
  speedMph: number;
  fuel: number;
  tollPaid: number;
  trailerAttached: boolean;
  debt: number;
}

export interface LongHaulSummary {
  elapsedSeconds: number;
  tollPaid: number;
  tookLoan: boolean;
  /** Total owed at the finish: the original loan plus every rollover fee. */
  debt: number;
  rollovers: number;
}

export interface LongHaulCallbacks {
  onHud: (hud: LongHaulHud) => void;
  onLoanPrompt: () => void;
  onFinish: (summary: LongHaulSummary) => void;
}

type Phase = "driving" | "modal" | "finished";

/** Chase camera: this far BEHIND the car (opposite its heading) and this high, looking this far ahead of it. */
const CAM_BACK = 8;
const CAM_UP = 4.2;
const CAM_LOOK_AHEAD = 14;
const HIST = 64; // ring buffer length for the trailer's lagged heading (power of two)

export class LongHaulEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private carRigid!: RAPIER.RigidBody;
  private readonly bin = new ResourceBin();
  private visuals!: LongHaulWorld;
  private car!: LongHaulCar;
  private effects!: DriveEffects;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private readonly headingHistory = new Float32Array(HIST);
  private historyHead = 0;
  private historyCount = 0;

  private phase: Phase = "driving";
  private heading = Math.PI;
  private speed = 0;
  private fuel = 100;
  private tollPaid = 0;
  private trailerAttached = false;
  private loan: LoanState = NO_LOAN;
  private gasStationResolved = false;
  private tollCharged = false;
  private startTime = performance.now();

  private keys = { up: false, down: false, left: false, right: false };
  private lastT = performance.now();
  private rafId: number | null = null;
  private disposed = false;

  // Look and feel state (all scalars and preallocated vectors: nothing is allocated per frame).
  private reducedMotion = prefersReducedMotion();
  private motionQuery: MediaQueryList | null = null;
  private readonly onMotionChange = () => {
    this.reducedMotion = prefersReducedMotion();
    this.effects?.setEnabled(!this.reducedMotion && !this.lowQuality);
  };
  private fov: number = FEEL.baseFov;
  private readonly camBase = new THREE.Vector3();
  private readonly camTarget = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private cameraSnap = true;
  private readonly frameBudget = new FrameBudget(25, 2000);
  private lowQuality = false;
  private lastHud: LongHaulHud | null = null;
  private prevSpeed = 0;

  // Key handling lives on the (focusable) game container, not on window: arrow keys no longer
  // scroll the page or fire while the player types in another field, and handled keys call
  // preventDefault. Releasing focus clears the keys so the car cannot get stuck on throttle.
  private readonly onKeyDown = (e: KeyboardEvent) => { if (this.setKey(e.code, true)) e.preventDefault(); };
  private readonly onKeyUp = (e: KeyboardEvent) => { if (this.setKey(e.code, false)) e.preventDefault(); };
  private readonly onBlur = () => { this.keys = { up: false, down: false, left: false, right: false }; };
  private readonly onResize = () => this.handleResize();
  // The game's React wrapper keeps the container hidden (display: none) while the engine loads, so the container is 0 x 0 when
  // this class is built. Without watching its size the canvas stayed 0 x 0 and the car never appeared; the observer resizes
  // the canvas the moment the container becomes visible, and again on any later size change.
  private resizeObserver: ResizeObserver | null = null;
  private readonly audio = new LongHaulAudio();
  private readonly onUserGesture = () => this.audio.unlock();

  constructor(private container: HTMLElement, private callbacks: LongHaulCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    // The fog colour is the sky's horizon colour, so distant buildings dissolve into the sky.
    this.scene.background = new THREE.Color(PAL.horizon);
    this.scene.fog = new THREE.Fog(PAL.horizon, FOG_NEAR, FOG_FAR);

    this.camera = new THREE.PerspectiveCamera(FEEL.baseFov, container.clientWidth / container.clientHeight || 1.6, 0.1, 700);
    this.handleResize();

    container.addEventListener("keydown", this.onKeyDown);
    container.addEventListener("keyup", this.onKeyUp);
    container.addEventListener("blur", this.onBlur);
    container.addEventListener("keydown", this.onUserGesture);
    container.addEventListener("pointerdown", this.onUserGesture);
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(container);
    }
    try {
      this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionQuery.addEventListener("change", this.onMotionChange);
    } catch {
      this.motionQuery = null;
    }
  }

  /** Sound on or off (the choice is remembered by the audio module). Turning it on counts as a user action, so it can start sound. */
  setSoundEnabled(enabled: boolean) {
    this.audio.setEnabled(enabled);
  }

  get soundEnabled(): boolean {
    return this.audio.isEnabled;
  }

  /** Lets the page's on-screen controls and buttons start sound too (browsers need a click or key press first). */
  unlockAudio() {
    this.audio.unlock();
  }

  /** Async init (Rapier's WASM must load) — call once before the engine does anything. */
  async init() {
    await RAPIER.init();
    if (this.disposed) return;

    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });

    // Dusk lighting: a cool sky/ground fill and one moon-like directional light. No shadow maps (the car has a blob shadow).
    this.scene.add(new THREE.HemisphereLight(0x8fb2dc, 0x1b2230, 1.5));
    const moon = new THREE.DirectionalLight(0xb9d0f0, 1.4);
    moon.position.set(-30, 60, 40);
    this.scene.add(moon);

    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.visuals = new LongHaulWorld(this.bin, anisotropy);
    this.scene.add(this.visuals.group);

    // Reflections for the car's clear coat and glass come from the sky texture (one-off PMREM bake, freed on dispose).
    let envMap: THREE.Texture | null = null;
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTarget = pmrem.fromEquirectangular(this.visuals.skyTexture);
      envMap = this.envTarget.texture;
      pmrem.dispose();
    } catch {
      envMap = null; // the car still renders, just without sky reflections
    }

    const glow = this.bin.add(makeGlowTexture(2));
    this.car = new LongHaulCar(this.bin, {
      shadow: this.bin.add(makeBlobShadowTexture()),
      headlightPool: this.bin.add(makeHeadlightPoolTexture()),
      glow,
      envMap,
    });
    this.scene.add(this.car.group);
    this.scene.add(this.car.trailer);
    this.effects = new DriveEffects(this.bin, this.scene, this.car.group, glow);
    this.effects.setEnabled(!this.reducedMotion);

    const carRigidDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).lockRotations();
    this.carRigid = this.world.createRigidBody(carRigidDesc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 1.7).setMass(1), this.carRigid);

    this.lastT = performance.now();
    this.animate();
  }

  /** Returns true when the key is one the game uses. */
  private setKey(code: string, val: boolean): boolean {
    if (code === "KeyW" || code === "ArrowUp") this.keys.up = val;
    else if (code === "KeyS" || code === "ArrowDown") this.keys.down = val;
    else if (code === "KeyA" || code === "ArrowLeft") this.keys.left = val;
    else if (code === "KeyD" || code === "ArrowRight") this.keys.right = val;
    else return false;
    return true;
  }

  /** On-screen controls (touch, mouse, switch devices) press and release the same inputs as the keys. */
  setControl(control: "up" | "down" | "left" | "right", pressed: boolean) {
    this.keys[control] = pressed;
  }

  private handleResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width <= 0 || height <= 0) return; // hidden or not laid out yet: keep the last good size until it is visible
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private currentTuning() {
    const mult = this.trailerAttached
      ? { maxSpeed: TRAILER.maxSpeedMult, turn: TRAILER.turnRateMult, accel: TRAILER.accelMult }
      : { maxSpeed: 1, turn: 1, accel: 1 };
    const pos = this.carRigid.translation();
    const inRoughZone = pos.z < TRACK.laneSplitStartZ && pos.z > TRACK.laneSplitEndZ && pos.x < -2;
    const roughMult = inRoughZone ? VEHICLE.roughSurfaceSpeedMult : 1;
    const fuelMult = this.fuel <= 0 ? VEHICLE.outOfFuelSpeedMult : 1;
    return {
      maxSpeed: VEHICLE.baseMaxSpeed * mult.maxSpeed * roughMult * fuelMult,
      turnRate: VEHICLE.baseTurnRate * mult.turn,
      accel: VEHICLE.baseAccel * mult.accel,
    };
  }

  private pauseCar() {
    this.carRigid.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.carRigid.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.speed = 0;
  }

  acceptLoan() {
    if (this.phase !== "modal") return;
    this.trailerAttached = true;
    this.loan = takeLoan();
    this.fuel = 100;
    this.phase = "driving";
    this.audio.refuel();
  }

  declineLoan() {
    if (this.phase !== "modal") return;
    this.phase = "driving";
  }

  reset() {
    if (this.disposed || !this.carRigid) return;
    this.carRigid.setTranslation({ x: 0, y: 1, z: 0 }, true);
    this.carRigid.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.heading = Math.PI;
    this.speed = 0;
    this.prevSpeed = 0;
    this.phase = "driving";
    this.fuel = 100;
    this.tollPaid = 0;
    this.trailerAttached = false;
    this.loan = NO_LOAN;
    this.gasStationResolved = false;
    this.tollCharged = false;
    this.startTime = performance.now();
    this.historyHead = 0;
    this.historyCount = 0;
    this.lastHud = null;
    this.cameraSnap = true;
    this.car.reset();
    this.effects.reset();
  }

  /** Slow machine fallback: fewer buildings and trees, no particles, pixel ratio 1. The player sees the same road, car and rules. */
  private applyLowQuality() {
    if (this.lowQuality) return;
    this.lowQuality = true;
    this.visuals.setLowQuality(true);
    this.effects.setEnabled(false);
    this.renderer.setPixelRatio(1);
    this.handleResize();
  }

  /** Live quality tier, for tests and the report. */
  get qualityTier(): "high" | "low" {
    return this.lowQuality ? "low" : "high";
  }

  /** Renderer statistics (draw calls, triangles, live GPU objects). Used by the verification harness; harmless otherwise. */
  get stats() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 };
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const rawMs = now - this.lastT;
    const dt = Math.min(0.05, rawMs / 1000);
    this.lastT = now;
    if (this.frameBudget.push(rawMs)) this.applyLowQuality();

    let throttle = 0;
    let steer = 0;
    if (this.phase === "driving") {
      const tuning = this.currentTuning();
      if (this.keys.up) throttle = 1;
      else if (this.keys.down) throttle = -1;
      if (this.keys.left) steer = -1;
      else if (this.keys.right) steer = 1;

      this.prevSpeed = this.speed;
      this.speed = stepSpeed(this.speed, throttle as -1 | 0 | 1, tuning, dt);
      // Coasting to a stop: stepSpeed subtracts a fixed amount each frame, so just above zero it can overshoot to the other side and the
      // car would jitter forward and back at about 0.1 m/s forever (visible wheel twitch, and a faint noise floor). Settle it at rest.
      if (throttle === 0 && Math.abs(this.speed) < VEHICLE.coastDecel * dt * 1.5) this.speed = 0;

      const speedFrac = Math.abs(this.speed) / tuning.maxSpeed;
      const turnAmount = steer * tuning.turnRate * Math.max(0.2, Math.min(1, speedFrac + 0.2)) * dt;
      // forward = (sin(heading), cos(heading)) means DECREASING heading
      // swings forward.x positive — steer > 0 (right/+X) must subtract.
      // Caught by driving the prototype toward +X and watching it go -X.
      this.heading -= Math.sign(this.speed || 1) * turnAmount;

      const fwdX = Math.sin(this.heading);
      const fwdZ = Math.cos(this.heading);
      this.carRigid.setLinvel(
        { x: fwdX * this.speed, y: this.carRigid.linvel().y, z: fwdZ * this.speed },
        true
      );

      this.fuel = fuelAfter(this.fuel, throttle > 0, dt);
      // An open loan rolls over every ECONOMY.rolloverIntervalSeconds and adds its fee (long-haul-rules.ts).
      this.loan = advanceLoan(this.loan, dt);

      const pos = this.carRigid.translation();

      if (!this.tollCharged && pos.z <= TRACK.tollZ && pos.x > 2) {
        this.tollCharged = true;
        this.tollPaid += ECONOMY.tollCost;
        this.audio.tollChime();
        this.visuals.flashToll();
      }

      if (!this.gasStationResolved && pos.z <= TRACK.gasStationZ) {
        this.gasStationResolved = true;
        const remainingDistance = pos.z - TRACK.finishZ;
        if (shouldOfferLoan(this.fuel, remainingDistance)) {
          this.pauseCar();
          this.phase = "modal";
          this.audio.loanPrompt();
          this.callbacks.onLoanPrompt();
        }
      }

      if (pos.z <= TRACK.finishZ) {
        this.pauseCar();
        this.phase = "finished";
        this.audio.finish();
        const elapsedSeconds = (now - this.startTime) / 1000;
        this.callbacks.onFinish({
          elapsedSeconds,
          tollPaid: this.tollPaid,
          tookLoan: this.trailerAttached,
          debt: this.loan.debt,
          rollovers: this.loan.rollovers,
        });
      }

      // Rapier's default internal timestep is fixed (~1/60s) regardless of
      // real elapsed time — without this, a throttled/variable frame rate
      // makes simulated time lag real time. Match it to our measured dt.
      this.world.timestep = dt;
      this.world.step();

      // This controller overwrites the rigid body's velocity every frame
      // regardless of what the collision solver just computed from a wall
      // contact, so a physical wall collider alone does not stop the car —
      // confirmed by testing (it drove straight through at x=-20). Clamp
      // track bounds directly instead of fighting the solver.
      const clampPos = this.carRigid.translation();
      const edge = TRACK.halfWidth - 1.2;
      if (Math.abs(clampPos.x) > edge) {
        const clampedX = Math.sign(clampPos.x) * edge;
        this.carRigid.setTranslation({ x: clampedX, y: clampPos.y, z: clampPos.z }, true);
        const lv = this.carRigid.linvel();
        this.carRigid.setLinvel({ x: 0, y: lv.y, z: lv.z }, true);
      }
    }

    const t = this.carRigid.translation();
    const maxSpeed = this.currentTuning().maxSpeed;
    const speedFrac = this.phase === "driving" ? Math.min(1, Math.abs(this.speed) / maxSpeed) : 0;
    const onDirt = t.z < TRACK.laneSplitStartZ && t.z > TRACK.laneSplitEndZ && t.x < -2;
    const braking = this.phase === "driving" && this.keys.down && this.speed > 0.3;
    const seconds = now / 1000;

    this.car.group.position.set(t.x, 0, t.z);
    this.car.group.rotation.y = this.heading;
    this.car.update(dt, {
      speed: this.phase === "driving" ? this.speed : 0,
      speedFraction: speedFrac,
      steer,
      accel: this.phase === "driving" ? Math.max(-1, Math.min(1, (this.speed - this.prevSpeed) / Math.max(dt, 1e-3) / VEHICLE.baseAccel)) : 0,
      braking,
      onDirt: onDirt && this.phase === "driving",
      time: seconds,
      reducedMotion: this.reducedMotion,
    });

    if (this.trailerAttached) {
      this.car.setTrailerVisible(true);
      // The trailer follows the car's heading a few frames late (TRAILER.lagFrames), hinged at the hitch behind the car.
      this.headingHistory[this.historyHead] = this.heading;
      this.historyHead = (this.historyHead + 1) & (HIST - 1);
      this.historyCount = Math.min(HIST, this.historyCount + 1);
      const back = Math.min(TRAILER.lagFrames, this.historyCount - 1);
      const lagged = this.headingHistory[(this.historyHead - 1 - back + HIST * 2) & (HIST - 1)];
      this.car.placeTrailer(t.x, t.z, this.heading, lagged);
    } else {
      this.car.setTrailerVisible(false);
    }

    // Chase camera: BEHIND the car (opposite its forward direction), so the road ahead is in view and +X (the highway lane) is on the
    // screen's right, matching the on-screen text. It was ahead of the car looking back, which hid the road and mirrored left and right.
    this.camTarget.set(t.x - Math.sin(this.heading) * CAM_BACK, CAM_UP, t.z - Math.cos(this.heading) * CAM_BACK);
    if (this.cameraSnap) {
      this.camBase.copy(this.camTarget);
      this.cameraSnap = false;
    } else {
      this.camBase.lerp(this.camTarget, 1 - Math.exp(-dt * 8));
    }
    this.camera.position.copy(this.camBase);
    const shake = shakeAmplitude(speedFrac, onDirt && this.phase === "driving", this.reducedMotion);
    if (shake > 0) {
      this.camera.position.x += roughNoise(seconds, 0.4) * shake;
      this.camera.position.y += roughNoise(seconds, 2.9) * shake * 0.8;
    }
    this.camLook.set(t.x + Math.sin(this.heading) * CAM_LOOK_AHEAD, 0.9, t.z + Math.cos(this.heading) * CAM_LOOK_AHEAD);
    this.camera.lookAt(this.camLook);
    this.fov = approach(this.fov, fovForSpeed(speedFrac, this.reducedMotion), 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.02) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    this.visuals.update(dt, seconds, this.camera);
    this.effects.update(dt, this.phase === "driving" ? this.speed : 0, speedFrac, onDirt && this.phase === "driving", t.x, t.z, this.heading);

    this.audio.update(
      speedFrac,
      this.phase === "driving" && this.keys.up,
      this.fuel,
      seconds,
      braking,
      onDirt && this.phase === "driving",
    );

    // Only tell React when a displayed number changes (it was re-rendering every frame).
    const speedMph = Math.round(Math.abs(this.speed) * 3.2);
    const fuelShown = Math.round(this.fuel);
    const last = this.lastHud;
    if (!last || last.speedMph !== speedMph || last.fuel !== fuelShown || last.tollPaid !== this.tollPaid || last.trailerAttached !== this.trailerAttached || last.debt !== this.loan.debt) {
      this.lastHud = { speedMph, fuel: fuelShown, tollPaid: this.tollPaid, trailerAttached: this.trailerAttached, debt: this.loan.debt };
      this.callbacks.onHud(this.lastHud);
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.container.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("keydown", this.onUserGesture);
    this.container.removeEventListener("pointerdown", this.onUserGesture);
    this.resizeObserver?.disconnect();
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    this.audio.dispose();
    // Free every GPU object: scene geometry and materials (and the textures they hold), the registered extras, the reflection bake.
    disposeObject3D(this.scene);
    this.bin.disposeAll();
    this.envTarget?.dispose();
    this.envTarget = null;
    try {
      this.world?.free();
    } catch {
      /* already freed */
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
