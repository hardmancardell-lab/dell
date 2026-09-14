import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TRACK, VEHICLE, TRAILER, ECONOMY, XP } from "@/lib/agents/financial-literacy/skills/long-haul-content";

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
  debt: number;
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
  private debt = 0;
  private gasStationResolved = false;
  private tollCharged = false;
  private startTime = performance.now();

  private keys = { up: false, down: false, left: false, right: false };
  private lastT = performance.now();
  private rafId: number | null = null;
  private disposed = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.setKey(e.code, true);
  private readonly onKeyUp = (e: KeyboardEvent) => this.setKey(e.code, false);
  private readonly onResize = () => this.handleResize();

  constructor(private container: HTMLElement, private callbacks: LongHaulCallbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

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

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("resize", this.onResize);
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

  private setKey(code: string, val: boolean) {
    if (code === "KeyW" || code === "ArrowUp") this.keys.up = val;
    if (code === "KeyS" || code === "ArrowDown") this.keys.down = val;
    if (code === "KeyA" || code === "ArrowLeft") this.keys.left = val;
    if (code === "KeyD" || code === "ArrowRight") this.keys.right = val;
  }

  private handleResize() {
    this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
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
    this.debt = ECONOMY.loanAmount;
    this.fuel = 100;
    this.phase = "driving";
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
    this.debt = 0;
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

      if (throttle > 0) this.speed += tuning.accel * dt;
      else if (throttle < 0) this.speed -= VEHICLE.brakeDecel * dt;
      else this.speed -= Math.sign(this.speed) * VEHICLE.coastDecel * dt;
      this.speed = Math.max(-tuning.maxSpeed * 0.5, Math.min(tuning.maxSpeed, this.speed));
      if (Math.abs(this.speed) < 0.05) this.speed = 0;

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

      const drain = ECONOMY.fuelDrainIdle + (throttle > 0 ? ECONOMY.fuelDrainAtFullThrottle : 0);
      this.fuel = Math.max(0, this.fuel - drain * dt);

      const pos = this.carRigid.translation();

      if (!this.tollCharged && pos.z <= TRACK.tollZ && pos.x > 2) {
        this.tollCharged = true;
        this.tollPaid += ECONOMY.tollCost;
      }

      if (!this.gasStationResolved && pos.z <= TRACK.gasStationZ) {
        this.gasStationResolved = true;
        if (this.fuel < TRACK.gasStationFuelThreshold) {
          this.pauseCar();
          this.phase = "modal";
          this.callbacks.onLoanPrompt();
        }
      }

      if (pos.z <= TRACK.finishZ) {
        this.pauseCar();
        this.phase = "finished";
        const elapsedSeconds = (now - this.startTime) / 1000;
        this.callbacks.onFinish({
          elapsedSeconds,
          tollPaid: this.tollPaid,
          tookLoan: this.trailerAttached,
          debt: this.debt,
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

    const camOffset = new THREE.Vector3(Math.sin(this.heading) * 9, 5.5, Math.cos(this.heading) * 9);
    const desiredCamPos = new THREE.Vector3(t.x, 0, t.z).add(camOffset);
    this.camera.position.lerp(desiredCamPos, 0.12);
    this.camera.lookAt(t.x, 1, t.z);

    this.callbacks.onHud({
      speedMph: Math.round(Math.abs(this.speed) * 3.2),
      fuel: Math.round(this.fuel),
      tollPaid: this.tollPaid,
      trailerAttached: this.trailerAttached,
      debt: this.debt,
    });

    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
