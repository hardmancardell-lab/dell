import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TRACK, VEHICLE, TRAILER, ECONOMY } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import { LongHaulAudio } from "./long-haul-audio";
import { advanceLoan, fuelAfter, NO_LOAN, shouldOfferLoan, stepSpeed, takeLoan, type LoanState } from "@/lib/agents/financial-literacy/skills/long-haul-rules";

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

export class LongHaulEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private carRigid!: RAPIER.RigidBody;
  private carGroup: THREE.Group;
  private trailerMesh: THREE.Mesh;
  private trailerHistory: { x: number; z: number; heading: number }[] = [];

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
    this.handleResize();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e12);
    this.scene.fog = new THREE.Fog(0x0b0e12, 60, 220);

    this.camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.1, 500);

    this.carGroup = new THREE.Group();
    this.trailerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xe8724f })
    );
    this.trailerMesh.visible = false;

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

    const hemi = new THREE.HemisphereLight(0xaeb8c2, 0x1a1d22, 1.1);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(30, 50, 10);
    this.scene.add(dir);

    this.buildTrack();
    this.buildCar();

    this.scene.add(this.carGroup);
    this.scene.add(this.trailerMesh);

    this.lastT = performance.now();
    this.animate();
  }

  private buildTrack() {
    const trackLen = Math.abs(TRACK.finishZ) + 20;
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.halfWidth * 2, trackLen), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -trackLen / 2 + 20);
    this.scene.add(ground);

    const roughMat = new THREE.MeshStandardMaterial({ color: 0x4a3f2c, roughness: 1 });
    const roughLen = Math.abs(TRACK.laneSplitEndZ - TRACK.laneSplitStartZ);
    const rough = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.halfWidth - 2, roughLen), roughMat);
    rough.rotation.x = -Math.PI / 2;
    rough.position.set(-TRACK.halfWidth / 2 - 1, 0.01, (TRACK.laneSplitStartZ + TRACK.laneSplitEndZ) / 2);
    this.scene.add(rough);

    const curbMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c0 });
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, roughLen), curbMat);
    curb.position.set(0, 0.2, (TRACK.laneSplitStartZ + TRACK.laneSplitEndZ) / 2);
    this.scene.add(curb);

    const tollMat = new THREE.MeshStandardMaterial({ color: 0xe8724f, emissive: 0x331100 });
    const tollGate = new THREE.Mesh(new THREE.BoxGeometry(TRACK.halfWidth, 6, 0.6), tollMat);
    tollGate.position.set(TRACK.halfWidth / 4 + 2, 3, TRACK.tollZ);
    this.scene.add(tollGate);

    const stationMat = new THREE.MeshStandardMaterial({ color: 0xf0c419 });
    const station = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), stationMat);
    station.position.set(TRACK.halfWidth - 8, 2.5, TRACK.gasStationZ);
    this.scene.add(station);

    const finishMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const finishLine = new THREE.Mesh(new THREE.BoxGeometry(TRACK.halfWidth * 2, 0.2, 1), finishMat);
    finishLine.position.set(0, 0.1, TRACK.finishZ);
    this.scene.add(finishLine);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47 });
    [-TRACK.halfWidth, TRACK.halfWidth].forEach((x) => {
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 3, trackLen), wallMat);
      wallMesh.position.set(x, 1.5, -trackLen / 2 + 20);
      this.scene.add(wallMesh);
    });
  }

  private buildCar() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4fe8d0 });
    const carBody = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 3.4), bodyMat);
    carBody.position.y = 0.55;
    this.carGroup.add(carBody);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x1e222a }));
    cabin.position.set(0, 1.1, -0.2);
    this.carGroup.add(cabin);

    const carRigidDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).lockRotations();
    this.carRigid = this.world.createRigidBody(carRigidDesc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 1.7).setMass(1), this.carRigid);
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
    this.carRigid.setTranslation({ x: 0, y: 1, z: 0 }, true);
    this.carRigid.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.heading = Math.PI;
    this.speed = 0;
    this.phase = "driving";
    this.fuel = 100;
    this.tollPaid = 0;
    this.trailerAttached = false;
    this.loan = NO_LOAN;
    this.gasStationResolved = false;
    this.tollCharged = false;
    this.startTime = performance.now();
    this.trailerMesh.visible = false;
    this.trailerHistory = [];
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    if (this.phase === "driving") {
      const tuning = this.currentTuning();
      let throttle = 0;
      let steer = 0;
      if (this.keys.up) throttle = 1;
      else if (this.keys.down) throttle = -1;
      if (this.keys.left) steer = -1;
      else if (this.keys.right) steer = 1;

      this.speed = stepSpeed(this.speed, throttle as -1 | 0 | 1, tuning, dt);

      const speedFrac = Math.abs(this.speed) / tuning.maxSpeed;
      const turnAmount = steer * tuning.turnRate * Math.max(0.2, Math.min(1, speedFrac + 0.2)) * dt;
      // forward = (sin(heading), cos(heading)) means DECREASING heading
      // swings forward.x positive — steer > 0 (right/+X) must subtract.
      // Caught by driving the prototype toward +X and watching it go -X.
      this.heading -= Math.sign(this.speed || 1) * turnAmount;

      const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      this.carRigid.setLinvel(
        { x: forward.x * this.speed, y: this.carRigid.linvel().y, z: forward.z * this.speed },
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
      }

      if (!this.gasStationResolved && pos.z <= TRACK.gasStationZ) {
        this.gasStationResolved = true;
        if (shouldOfferLoan(this.fuel)) {
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
    this.carGroup.position.set(t.x, 0, t.z);
    this.carGroup.rotation.y = this.heading;

    if (this.trailerAttached) {
      this.trailerMesh.visible = true;
      this.trailerHistory.push({ x: t.x, z: t.z, heading: this.heading });
      if (this.trailerHistory.length > 60) this.trailerHistory.shift();
      const sampleIdx = Math.max(0, this.trailerHistory.length - TRAILER.lagFrames);
      const sample = this.trailerHistory[sampleIdx];
      this.trailerMesh.position.set(sample.x, 0.6, sample.z);
      this.trailerMesh.rotation.y = sample.heading;
    }

    // Chase camera: BEHIND the car (opposite its forward direction), so the road ahead is in view and +X (the highway lane) is on the
    // screen's right, matching the on-screen text. It was ahead of the car looking back, which hid the road and mirrored left and right.
    const camOffset = new THREE.Vector3(-Math.sin(this.heading) * 9, 5.5, -Math.cos(this.heading) * 9);
    const desiredCamPos = new THREE.Vector3(t.x, 0, t.z).add(camOffset);
    this.camera.position.lerp(desiredCamPos, 0.12);
    this.camera.lookAt(t.x, 1, t.z);

    this.audio.update(
      this.phase === "driving" ? Math.min(1, Math.abs(this.speed) / this.currentTuning().maxSpeed) : 0,
      this.phase === "driving" && this.keys.up,
      this.fuel,
      now / 1000,
      this.phase === "driving" && this.keys.down && this.speed > 0.3,
      t.z < TRACK.laneSplitStartZ && t.z > TRACK.laneSplitEndZ && t.x < -2,
    );

    this.callbacks.onHud({
      speedMph: Math.round(Math.abs(this.speed) * 3.2),
      fuel: Math.round(this.fuel),
      tollPaid: this.tollPaid,
      trailerAttached: this.trailerAttached,
      debt: this.loan.debt,
    });

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.container.removeEventListener("keydown", this.onKeyDown);
    this.container.removeEventListener("keyup", this.onKeyUp);
    this.container.removeEventListener("blur", this.onBlur);
    window.removeEventListener("resize", this.onResize);
    this.container.removeEventListener("keydown", this.onUserGesture);
    this.container.removeEventListener("pointerdown", this.onUserGesture);
    this.resizeObserver?.disconnect();
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
