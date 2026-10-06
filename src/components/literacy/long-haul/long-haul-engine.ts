import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { TRACK, VEHICLE, TRAILER, ECONOMY } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import { LongHaulAudio } from "./long-haul-audio";

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
 * Revisited after shipping: the canvas rendered nothing in the real app — a
 * real bug found by actually loading it, not by review (see LongHaulGame.tsx
 * for the root cause: the renderer was sized from a hidden container's
 * clientWidth/Height, which reads 0). This pass also takes a real swing at
 * visual/feel quality: a car with rotating wheels instead of a floating box,
 * lane markings and rumble-strip curbs, roadside poles for speed parallax, a
 * gradient sky instead of a flat color, body roll/pitch on steer/throttle,
 * and a speed-reactive camera FOV — standard arcade-racer "juice" techniques,
 * not an attempt at console-AAA fidelity, which a browser/Three.js game
 * built solo in one sitting was never going to hit regardless of effort.
 */

export interface LongHaulHud {
  speedMph: number;
  speedFrac: number; // 0..1 of base max speed — drives the UI speed-sensation vignette
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

const BASE_FOV = 62;
const MAX_FOV_BONUS = 14; // added at top speed, classic "sense of speed" trick
const MAX_BANK = 0.16; // radians, body roll into a turn
const MAX_PITCH = 0.05; // radians, nose dips/lifts under brake/throttle
const WHEEL_RADIUS = 0.34;
const DUST_POOL_SIZE = 18;
const DUST_SPAWN_INTERVAL = 0.07; // seconds between spawns while kicking up dust

interface DustParticle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

/** Small soft-radial-gradient canvas texture — shared recipe for the dust puff and the car's contact shadow, just different colors. */
function makeRadialTexture(innerColor: string, outerColor: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, innerColor);
  gradient.addColorStop(1, outerColor);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export class LongHaulEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private carRigid!: RAPIER.RigidBody;
  private carGroup: THREE.Group;
  private carTiltGroup: THREE.Group; // child of carGroup — carries roll/pitch so heading rotation stays clean
  private wheels: THREE.Mesh[] = [];
  private trailerMesh: THREE.Mesh;
  private trailerHistory: { x: number; z: number; heading: number }[] = [];
  private contactShadow!: THREE.Mesh;
  private headlightSpot!: THREE.SpotLight;
  private headlightTarget!: THREE.Object3D;
  private dustPool: DustParticle[] = [];
  private dustSpawnTimer = 0;
  private readonly audio = new LongHaulAudio();

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

  constructor(
    private container: HTMLElement,
    private vw: number,
    private vh: number,
    private callbacks: LongHaulCallbacks
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // Fixed, explicit size — never measure container.clientWidth/Height.
    // This component is hidden (display:none) until status flips to
    // "ready", and a hidden element's clientWidth/Height reads 0, which is
    // exactly what produced the blank-canvas bug this pass fixes. The
    // wrapper scales the canvas down via CSS max-width on narrow screens;
    // the renderer's internal resolution stays fixed.
    this.renderer.setSize(vw, vh);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x141824, 55, 210);
    this.scene.add(this.buildSky());

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, vw / vh, 0.1, 500);

    this.carGroup = new THREE.Group();
    this.carTiltGroup = new THREE.Group();
    this.carGroup.add(this.carTiltGroup);

    this.trailerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.2, 2.2),
      new THREE.MeshStandardMaterial({ color: 0xe8724f, roughness: 0.6, metalness: 0.2 })
    );
    this.trailerMesh.castShadow = true;
    this.trailerMesh.visible = false;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Async init (Rapier's WASM must load) — call once before the engine does anything. */
  async init() {
    await RAPIER.init();
    if (this.disposed) return;

    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });

    const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x11141a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d9, 1.35);
    sun.position.set(40, 60, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 150;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5a6b8c, 0.35);
    fill.position.set(-30, 20, 30);
    this.scene.add(fill);

    this.buildTrack();
    this.buildCar();
    this.buildContactShadow();
    this.buildHeadlight();
    this.buildDustPool();

    this.scene.add(this.carGroup);
    this.scene.add(this.trailerMesh);

    this.lastT = performance.now();
    this.animate();
  }

  /** A soft dark blob just under the car — cheap, but it's what actually sells the car as sitting ON the road instead of floating above it. */
  private buildContactShadow() {
    const texture = makeRadialTexture("rgba(0,0,0,0.45)", "rgba(0,0,0,0)");
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), mat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.02;
    this.scene.add(this.contactShadow);
  }

  /** One forward-facing spotlight (no shadow — the sun's shadow map already covers the budget) for real headlight illumination on the road at night. */
  private buildHeadlight() {
    this.headlightSpot = new THREE.SpotLight(0xfff0cf, 6, 28, Math.PI / 6, 0.6, 1.2);
    this.headlightTarget = new THREE.Object3D();
    this.scene.add(this.headlightSpot);
    this.scene.add(this.headlightTarget);
    this.headlightSpot.target = this.headlightTarget;
  }

  private buildDustPool() {
    const texture = makeRadialTexture("rgba(196,178,140,0.9)", "rgba(196,178,140,0)");
    for (let i = 0; i < DUST_POOL_SIZE; i++) {
      const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.6, 0.6, 1);
      sprite.visible = false;
      this.scene.add(sprite);
      this.dustPool.push({ sprite, velocity: new THREE.Vector3(), life: 0, maxLife: 1, active: false });
    }
  }

  /** Spawns one dust puff near a rear wheel, reusing the oldest free pool slot. */
  private spawnDust(carX: number, carZ: number) {
    const slot = this.dustPool.find((p) => !p.active) ?? this.dustPool[0];
    const backward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const sideJitter = (Math.random() - 0.5) * 1.2;
    slot.sprite.position.set(
      carX + backward.x * 1.6 + sideJitter,
      0.15,
      carZ + backward.z * 1.6 + sideJitter
    );
    slot.sprite.scale.set(0.5, 0.5, 1);
    slot.velocity.set(backward.x * 1.5 + (Math.random() - 0.5), 1.2 + Math.random() * 0.8, backward.z * 1.5 + (Math.random() - 0.5));
    slot.maxLife = 0.5 + Math.random() * 0.35;
    slot.life = slot.maxLife;
    slot.active = true;
    slot.sprite.visible = true;
    (slot.sprite.material as THREE.SpriteMaterial).opacity = 0.65;
  }

  private updateDust(dt: number) {
    for (const p of this.dustPool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.velocity.y -= dt * 1.5; // gentle gravity so puffs settle rather than float forever
      const lifeFrac = p.life / p.maxLife;
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.65 * lifeFrac;
      const scale = 0.5 + (1 - lifeFrac) * 0.9;
      p.sprite.scale.set(scale, scale, 1);
    }
  }

  /** A large inverted sphere with a vertical gradient — cheap stand-in for a real sky, much better than a flat fill. */
  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(300, 24, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x1b2338) },
        bottomColor: { value: new THREE.Color(0x3a4a6b) },
        offset: { value: 10 },
        exponent: { value: 0.65 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    return new THREE.Mesh(geo, mat);
  }

  private buildTrack() {
    const trackLen = Math.abs(TRACK.finishZ) + 20;
    const centerZ = -trackLen / 2 + 20;

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.88, metalness: 0.05 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.halfWidth * 2, trackLen), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, centerZ);
    ground.receiveShadow = true;
    this.scene.add(ground);

    const roughMat = new THREE.MeshStandardMaterial({ color: 0x463c2b, roughness: 1 });
    const roughLen = Math.abs(TRACK.laneSplitEndZ - TRACK.laneSplitStartZ);
    const rough = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.halfWidth - 2, roughLen), roughMat);
    rough.rotation.x = -Math.PI / 2;
    rough.position.set(-TRACK.halfWidth / 2 - 1, 0.01, (TRACK.laneSplitStartZ + TRACK.laneSplitEndZ) / 2);
    rough.receiveShadow = true;
    this.scene.add(rough);

    const laneCurbMat = new THREE.MeshStandardMaterial({ color: 0xd6d0c0 });
    const laneCurb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, roughLen), laneCurbMat);
    laneCurb.position.set(0, 0.2, (TRACK.laneSplitStartZ + TRACK.laneSplitEndZ) / 2);
    this.scene.add(laneCurb);

    this.buildDashedCenterline(0, -trackLen / 2 + 20, TRACK.laneSplitStartZ);
    this.buildDashedCenterline(0, TRACK.laneSplitEndZ, TRACK.finishZ + 20);
    this.buildRumbleStrips(trackLen, centerZ);
    this.buildRoadsidePoles(trackLen, centerZ);

    const tollMat = new THREE.MeshStandardMaterial({ color: 0xe8724f, emissive: 0x6b2200, emissiveIntensity: 0.6 });
    const tollGate = new THREE.Mesh(new THREE.BoxGeometry(TRACK.halfWidth, 6, 0.6), tollMat);
    tollGate.position.set(TRACK.halfWidth / 4 + 2, 3, TRACK.tollZ);
    tollGate.castShadow = true;
    this.scene.add(tollGate);

    const stationMat = new THREE.MeshStandardMaterial({ color: 0xf0c419, emissive: 0x4a3a00, emissiveIntensity: 0.5 });
    const station = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), stationMat);
    station.position.set(TRACK.halfWidth - 8, 2.5, TRACK.gasStationZ);
    station.castShadow = true;
    this.scene.add(station);

    const finishMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 });
    const finishLine = new THREE.Mesh(new THREE.BoxGeometry(TRACK.halfWidth * 2, 0.2, 1), finishMat);
    finishLine.position.set(0, 0.1, TRACK.finishZ);
    this.scene.add(finishLine);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });
    [-TRACK.halfWidth, TRACK.halfWidth].forEach((x) => {
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 3, trackLen), wallMat);
      wallMesh.position.set(x, 1.5, centerZ);
      wallMesh.castShadow = true;
      this.scene.add(wallMesh);
    });
  }

  /** Dashed white centerline for a single-lane stretch from startZ down to endZ (startZ > endZ). */
  private buildDashedCenterline(_x: number, startZ: number, endZ: number) {
    const dashLen = 3;
    const gapLen = 4;
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, emissive: 0x151310 });
    let z = startZ;
    while (z > endZ) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, dashLen), mat);
      dash.position.set(0, 0.03, z - dashLen / 2);
      this.scene.add(dash);
      z -= dashLen + gapLen;
    }
  }

  /** Classic alternating red/white rumble-strip curbs along both track edges, full length. */
  private buildRumbleStrips(trackLen: number, centerZ: number) {
    const segLen = 2;
    const redMat = new THREE.MeshStandardMaterial({ color: 0xb8302a, roughness: 0.6 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9e5da, roughness: 0.6 });
    const startZ = centerZ + trackLen / 2;
    const count = Math.ceil(trackLen / segLen);
    for (const side of [-1, 1]) {
      const edgeX = side * (TRACK.halfWidth - 0.6);
      for (let i = 0; i < count; i++) {
        const mat = i % 2 === 0 ? redMat : whiteMat;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, segLen), mat);
        seg.position.set(edgeX, 0.06, startZ - i * segLen - segLen / 2);
        this.scene.add(seg);
      }
    }
  }

  /** Thin roadside poles outside the walls — parallax cue for a real sense of speed while driving. */
  private buildRoadsidePoles(trackLen: number, centerZ: number) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.5, metalness: 0.3 });
    const spacing = 14;
    const startZ = centerZ + trackLen / 2 - 6;
    const count = Math.floor(trackLen / spacing);
    for (const side of [-1, 1]) {
      const x = side * (TRACK.halfWidth + 3);
      for (let i = 0; i < count; i++) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 6), poleMat);
        pole.position.set(x, 2.25, startZ - i * spacing);
        pole.castShadow = true;
        this.scene.add(pole);
      }
    }
  }

  private buildCar() {
    const paintMat = new THREE.MeshStandardMaterial({ color: 0x3fd8c4, roughness: 0.35, metalness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.15, metalness: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });

    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 3.6), paintMat);
    lowerBody.position.y = 0.42;
    lowerBody.castShadow = true;
    this.carTiltGroup.add(lowerBody);

    // Tapered nose — a single wedge-shaped box (scaled + shifted) reads as a
    // hood far better than a flat front face, at near-zero extra cost.
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 1.0), paintMat);
    nose.position.set(0, 0.46, 1.9);
    nose.rotation.x = -0.12;
    nose.castShadow = true;
    this.carTiltGroup.add(nose);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.5, 1.7), glassMat);
    cabin.position.set(0, 0.92, -0.25);
    cabin.castShadow = true;
    this.carTiltGroup.add(cabin);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1.2), paintMat);
    roof.position.set(0, 1.21, -0.3);
    this.carTiltGroup.add(roof);

    // Mirrors — tiny, but a car silhouette reads as "a car" much faster with them.
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), trimMat);
      mirror.position.set(side * 0.95, 0.85, 0.5);
      this.carTiltGroup.add(mirror);
    }

    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 1.1 });
    const taillightMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 1.1 });
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), headlightMat);
      headlight.position.set(side * 0.65, 0.5, 2.38);
      this.carTiltGroup.add(headlight);
      const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06), taillightMat);
      taillight.position.set(side * 0.68, 0.55, -1.78);
      this.carTiltGroup.add(taillight);
    }

    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const wheelPositions: [number, number][] = [
      [-0.95, 1.15],
      [0.95, 1.15],
      [-0.95, -1.15],
      [0.95, -1.15],
    ];
    for (const [x, z] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, WHEEL_RADIUS, z);
      wheel.castShadow = true;
      this.carTiltGroup.add(wheel);
      this.wheels.push(wheel);
    }

    const carRigidDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 1, 0).lockRotations();
    this.carRigid = this.world.createRigidBody(carRigidDesc);
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.5, 1.7).setMass(1), this.carRigid);
  }

  private setKey(code: string, val: boolean) {
    // Browsers require a real user gesture before audio can play — the
    // first drive key is as natural a gesture as this game has. start() is
    // idempotent, so calling it on every keydown costs nothing after the
    // first real one.
    if (val) this.audio.start();
    if (code === "KeyW" || code === "ArrowUp") this.keys.up = val;
    if (code === "KeyS" || code === "ArrowDown") this.keys.down = val;
    if (code === "KeyA" || code === "ArrowLeft") this.keys.left = val;
    if (code === "KeyD" || code === "ArrowRight") this.keys.right = val;
  }

  setMuted(muted: boolean) {
    this.audio.setMuted(muted);
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
    this.audio.playAccept();
  }

  declineLoan() {
    if (this.phase !== "modal") return;
    this.phase = "driving";
    this.audio.playDecline();
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
    this.carTiltGroup.rotation.set(0, 0, 0);
    this.dustSpawnTimer = 0;
    for (const p of this.dustPool) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    let throttle = 0;
    let steer = 0;

    if (this.phase === "driving") {
      const tuning = this.currentTuning();
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
        this.audio.playToll();
      }

      if (!this.gasStationResolved && pos.z <= TRACK.gasStationZ) {
        this.gasStationResolved = true;
        if (this.fuel < TRACK.gasStationFuelThreshold) {
          this.pauseCar();
          this.phase = "modal";
          this.audio.playLoanAlert();
          this.callbacks.onLoanPrompt();
        }
      }

      // Engine note + tire noise react to real state every driving frame.
      const inRoughZoneNow = pos.z < TRACK.laneSplitStartZ && pos.z > TRACK.laneSplitEndZ && pos.x < -2;
      this.audio.setEngineState(speedFrac, throttle > 0);
      this.audio.setSurfaceNoise(inRoughZoneNow, speedFrac);

      this.dustSpawnTimer -= dt;
      const kickingUpDust = Math.abs(this.speed) > 4 && (inRoughZoneNow || Math.abs(steer) > 0.6);
      if (kickingUpDust && this.dustSpawnTimer <= 0) {
        this.dustSpawnTimer = DUST_SPAWN_INTERVAL;
        this.spawnDust(pos.x, pos.z);
      }

      if (pos.z <= TRACK.finishZ) {
        this.pauseCar();
        this.phase = "finished";
        this.audio.playFinish();
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

    // Body roll into turns + pitch under throttle/brake — arcade "juice"
    // that makes the car feel alive even with a kinematic velocity-override
    // controller instead of real suspension physics. Lerped so key taps
    // (not sustained holds) don't make it snap.
    const targetBank = -steer * MAX_BANK;
    const targetPitch = throttle * MAX_PITCH;
    this.carTiltGroup.rotation.z += (targetBank - this.carTiltGroup.rotation.z) * 0.15;
    this.carTiltGroup.rotation.x += (targetPitch - this.carTiltGroup.rotation.x) * 0.15;

    // Wheel spin, purely visual — radians per frame from real linear speed.
    const wheelSpin = (this.speed * dt) / WHEEL_RADIUS;
    for (const wheel of this.wheels) wheel.rotation.x += wheelSpin;

    if (this.trailerAttached) {
      this.trailerMesh.visible = true;
      this.trailerHistory.push({ x: t.x, z: t.z, heading: this.heading });
      if (this.trailerHistory.length > 60) this.trailerHistory.shift();
      const sampleIdx = Math.max(0, this.trailerHistory.length - TRAILER.lagFrames);
      const sample = this.trailerHistory[sampleIdx];
      this.trailerMesh.position.set(sample.x, 0.6, sample.z);
      this.trailerMesh.rotation.y = sample.heading;
    }

    const camOffset = new THREE.Vector3(Math.sin(this.heading) * 8.5, 5.2, Math.cos(this.heading) * 8.5);
    const desiredCamPos = new THREE.Vector3(t.x, 0, t.z).add(camOffset);
    this.camera.position.lerp(desiredCamPos, 0.12);
    this.camera.lookAt(t.x, 1, t.z);

    // Speed-reactive FOV — a classic racing-game trick for conveying velocity
    // that a static camera can't: widen the lens as speed climbs.
    const maxSpeedForFov = VEHICLE.baseMaxSpeed;
    const speedFracForFov = Math.min(1, Math.abs(this.speed) / maxSpeedForFov);
    const targetFov = BASE_FOV + speedFracForFov * MAX_FOV_BONUS;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.1;
      this.camera.updateProjectionMatrix();
    }

    // Contact shadow and headlight track the car every frame regardless of
    // phase, so they're still correct the instant a paused run resumes.
    this.contactShadow.position.set(t.x, 0.02, t.z);
    this.contactShadow.rotation.z = -this.heading;
    const forwardForLight = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.headlightSpot.position.set(t.x, 0.9, t.z);
    this.headlightTarget.position.set(t.x + forwardForLight.x * 14, 0, t.z + forwardForLight.z * 14);

    this.updateDust(dt);

    this.callbacks.onHud({
      speedMph: Math.round(Math.abs(this.speed) * 3.2),
      speedFrac: speedFracForFov,
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
    this.audio.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
