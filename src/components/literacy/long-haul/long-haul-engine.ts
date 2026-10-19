import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { CITY, FARES, SHIFT, VEHICLE, TRAILER, ECONOMY, CAR_MODELS } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import type { CarModel, Fare } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import { LongHaulAudio } from "./long-haul-audio";

/**
 * Three.js + Rapier engine for "The Long Haul", framework-agnostic on
 * purpose (no React in this file) — same separation as curriculum-content.ts
 * vs. FinancialLiteracyTab.tsx elsewhere in this agent. React only owns the
 * HUD/modal/summary overlay via the callbacks below; this class owns the
 * canvas, the physics world, and the driving loop.
 *
 * Reworked from a single straight track into a rideshare shift around one
 * real city crossroads, after a direct user report that the original design
 * was broken: the gas-station loan refueled the car to finish a distance it
 * could already finish, so the "decision" cost and bought nothing. Fixed by
 * replacing the fixed finish line with fares (pickup -> dropoff waypoints)
 * and gating the loan offer on a real computed check — remaining fuel range
 * vs. the real remaining driving distance across the rest of the shift —
 * instead of a flat fuel-percentage threshold. See long-haul-content.ts for
 * the full design rationale, including why there's deliberately no shift
 * timer (a countdown adds exactly the kind of real-time pressure the
 * curriculum's own scarcity/bandwidth module argues against).
 *
 * Original 3 bugs from the first prototype pass (inverted steering, Rapier's
 * fixed internal timestep, boundary walls not stopping a velocity-override
 * controller), the 0x0-canvas rendering bug, and the arrow-key page-scroll
 * bug are all still fixed below — this rewrite builds on verified code, not
 * from scratch.
 */

export interface LongHaulHud {
  speedMph: number;
  speedFrac: number;
  fuel: number;
  cashEarned: number;
  cashGoal: number;
  trailerAttached: boolean;
  debt: number;
  fareInstruction: string;
}

export interface LongHaulSummary {
  elapsedSeconds: number;
  cashEarned: number;
  cashGoal: number;
  faresCompleted: number;
  faresTotal: number;
  tookLoan: boolean;
  debt: number;
}

export interface LongHaulCallbacks {
  onHud: (hud: LongHaulHud) => void;
  onLoanPrompt: () => void;
  onFareComplete: (fareLabel: string, payout: number) => void;
  onFinish: (summary: LongHaulSummary) => void;
}

type Phase = "driving" | "modal" | "finished";
type FareStage = "to_pickup" | "to_dropoff";

const BASE_FOV = 62;
const MAX_FOV_BONUS = 14;
const MAX_BANK = 0.16;
const MAX_PITCH = 0.05;
const WHEEL_RADIUS = 0.34;
const DUST_POOL_SIZE = 18;
const DUST_SPAWN_INTERVAL = 0.07;
const TARGET_REACH_RADIUS = 5;

interface DustParticle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

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

/** A simple lit/unlit window-grid pattern, tiled across a building face. */
function makeWindowTexture(litColor: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1c1f26";
  ctx.fillRect(0, 0, size, size);
  const cell = 16;
  for (let y = 4; y < size; y += cell) {
    for (let x = 4; x < size; x += cell) {
      ctx.fillStyle = Math.random() > 0.35 ? litColor : "#12141a";
      ctx.fillRect(x, y, cell - 6, cell - 8);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

export class LongHaulEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private world!: RAPIER.World;
  private carRigid!: RAPIER.RigidBody;
  private carGroup: THREE.Group;
  private carTiltGroup: THREE.Group;
  private wheels: THREE.Mesh[] = [];
  private trailerMesh: THREE.Mesh;
  private trailerHistory: { x: number; z: number; heading: number }[] = [];
  private contactShadow!: THREE.Mesh;
  private headlightSpot!: THREE.SpotLight;
  private headlightTarget!: THREE.Object3D;
  private dustPool: DustParticle[] = [];
  private dustSpawnTimer = 0;
  private readonly audio = new LongHaulAudio();
  private readonly car: CarModel;

  private targetBeacon!: THREE.Mesh;
  private pedestrians: { group: THREE.Group; baseX: number; baseZ: number; axis: "x" | "z"; range: number; speedPhase: number }[] = [];

  private phase: Phase = "driving";
  private heading = Math.PI;
  private speed = 0;
  private fuel = 100;
  private cashEarned = 0;
  private trailerAttached = false;
  private debt = 0;
  private gasStationResolved = false;
  private activeFareIndex = 0;
  private fareStage: FareStage = "to_pickup";
  private startTime = performance.now();

  private keys = { up: false, down: false, left: false, right: false };
  private lastT = performance.now();
  private rafId: number | null = null;
  private disposed = false;

  private readonly onKeyDown = (e: KeyboardEvent) => this.setKey(e.code, true, e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.setKey(e.code, false, e);

  private static readonly DRIVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

  constructor(
    private container: HTMLElement,
    private vw: number,
    private vh: number,
    carModelId: string,
    private callbacks: LongHaulCallbacks
  ) {
    this.car = CAR_MODELS.find((c) => c.id === carModelId) ?? CAR_MODELS[0];

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(vw, vh);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x141824, 55, 220);
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
    sun.shadow.camera.left = -90;
    sun.shadow.camera.right = 90;
    sun.shadow.camera.top = 90;
    sun.shadow.camera.bottom = -90;
    sun.shadow.camera.far = 220;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x5a6b8c, 0.35);
    fill.position.set(-30, 20, 30);
    this.scene.add(fill);

    this.buildStreets();
    this.buildBuildings();
    this.buildPedestrians();
    this.buildGasStation();
    this.buildTargetBeacon();
    this.buildCar();
    this.buildContactShadow();
    this.buildHeadlight();
    this.buildDustPool();

    this.scene.add(this.carGroup);
    this.scene.add(this.trailerMesh);
    this.updateBeaconForCurrentTarget();

    this.lastT = performance.now();
    this.animate();
  }

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

  /** The "+" crossroads: one N-S corridor, one E-W cross street. */
  private buildStreets() {
    const corridorLen = CITY.corridorStartZ - CITY.corridorEndZ;
    const corridorCenterZ = (CITY.corridorStartZ + CITY.corridorEndZ) / 2;
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.88, metalness: 0.05 });

    const corridor = new THREE.Mesh(new THREE.PlaneGeometry(CITY.streetHalfWidth * 2, corridorLen), roadMat);
    corridor.rotation.x = -Math.PI / 2;
    corridor.position.set(0, 0, corridorCenterZ);
    corridor.receiveShadow = true;
    this.scene.add(corridor);

    const crossLen = CITY.crossStreetHalfLength * 2;
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(crossLen, CITY.crossStreetHalfWidth * 2), roadMat);
    cross.rotation.x = -Math.PI / 2;
    cross.position.set(0, 0.005, CITY.crossStreetZ);
    cross.receiveShadow = true;
    this.scene.add(cross);

    // Dashed centerlines on both streets.
    this.buildDashedLine(0, CITY.corridorStartZ, CITY.crossStreetZ + CITY.crossStreetHalfWidth + 6, "z");
    this.buildDashedLine(0, CITY.crossStreetZ - CITY.crossStreetHalfWidth - 6, CITY.corridorEndZ, "z");
    this.buildDashedLine(-CITY.crossStreetHalfLength, CITY.crossStreetZ, -CITY.streetHalfWidth - 6, "x");
    this.buildDashedLine(CITY.streetHalfWidth + 6, CITY.crossStreetZ, CITY.crossStreetHalfLength, "x");

    // Boundary walls along the outer edges of the whole district, matching
    // the old track's "clamp bounds directly" fix (see animate()).
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });
    [-CITY.streetHalfWidth, CITY.streetHalfWidth].forEach((x) => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, corridorLen), wallMat);
      wall.position.set(x, 1.5, corridorCenterZ);
      wall.castShadow = true;
      this.scene.add(wall);
    });
  }

  private buildDashedLine(x1: number, z1: number, x2OrZ2: number, axis: "x" | "z") {
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, emissive: 0x151310 });
    const dashLen = 3;
    const gapLen = 4;
    if (axis === "z") {
      let z = z1;
      const end = x2OrZ2;
      const dir = end > z ? 1 : -1;
      while (dir > 0 ? z < end : z > end) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, dashLen), mat);
        dash.position.set(x1, 0.03, z + (dir * dashLen) / 2);
        this.scene.add(dash);
        z += dir * (dashLen + gapLen);
      }
    } else {
      let x = x1;
      const end = x2OrZ2;
      while (x < end) {
        const dash = new THREE.Mesh(new THREE.BoxGeometry(dashLen, 0.05, 0.25), mat);
        dash.position.set(x + dashLen / 2, 0.03, z1);
        this.scene.add(dash);
        x += dashLen + gapLen;
      }
    }
  }

  /** Buildings line both streets, skipping the intersection so it stays open to turn through. */
  private buildBuildings() {
    const windowTex = makeWindowTexture("#f0c419");
    const intersectionClearance = CITY.crossStreetHalfWidth + 10;

    const colorPalette = [0x3a4252, 0x4a3f3a, 0x2f3a3f, 0x463c4a, 0x3f4a3f];
    let paletteIdx = 0;
    const nextColor = () => colorPalette[paletteIdx++ % colorPalette.length];

    // Along the N-S corridor.
    for (let z = CITY.corridorStartZ - 10; z > CITY.corridorEndZ + 10; z -= 16) {
      if (Math.abs(z - CITY.crossStreetZ) < intersectionClearance) continue;
      for (const side of [-1, 1]) {
        this.addBuilding(side * (CITY.streetHalfWidth + 6), z, nextColor(), windowTex, "z");
      }
    }

    // Along the E-W cross street.
    for (let x = -CITY.crossStreetHalfLength + 10; x < CITY.crossStreetHalfLength - 10; x += 16) {
      if (Math.abs(x) < intersectionClearance) continue;
      for (const side of [-1, 1]) {
        this.addBuilding(x, CITY.crossStreetZ + side * (CITY.crossStreetHalfWidth + 6), nextColor(), windowTex, "x");
      }
    }
  }

  private addBuilding(x: number, z: number, color: number, windowTex: THREE.CanvasTexture, streetAxis: "x" | "z") {
    const width = 8 + Math.random() * 3;
    const depth = 8 + Math.random() * 3;
    const height = 6 + Math.random() * 16; // mix of houses, apartments, stores
    const sideMat = new THREE.MeshStandardMaterial({ map: windowTex, color, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.95 });
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [sideMat, sideMat, roofMat, roofMat, sideMat, sideMat]);
    building.position.set(x, height / 2, z);
    building.castShadow = true;
    building.receiveShadow = true;
    this.scene.add(building);

    // A raised sidewalk/curb strip between street and building.
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x6b6f76 });
    const curbWidth = streetAxis === "z" ? 3 : depth + 2;
    const curbDepth = streetAxis === "z" ? depth + 2 : 3;
    const curb = new THREE.Mesh(new THREE.BoxGeometry(curbWidth, 0.2, curbDepth), curbMat);
    const inward = streetAxis === "z" ? (x > 0 ? -1 : 1) : x; // offset toward the street
    if (streetAxis === "z") curb.position.set(x + inward * (width / 2 + 1.2), 0.1, z);
    else curb.position.set(x, 0.1, z + (z > CITY.crossStreetZ ? -1 : 1) * (depth / 2 + 1.2));
    this.scene.add(curb);
  }

  private buildPedestrians() {
    const spots: { x: number; z: number; axis: "x" | "z" }[] = [
      { x: -CITY.streetHalfWidth - 3, z: -10, axis: "z" },
      { x: CITY.streetHalfWidth + 3, z: -40, axis: "z" },
      { x: -CITY.streetHalfWidth - 3, z: -70, axis: "z" },
      { x: 20, z: CITY.crossStreetZ - CITY.crossStreetHalfWidth - 3, axis: "x" },
      { x: -20, z: CITY.crossStreetZ + CITY.crossStreetHalfWidth + 3, axis: "x" },
      { x: CITY.streetHalfWidth + 3, z: -180, axis: "z" },
      { x: -CITY.streetHalfWidth - 3, z: -210, axis: "z" },
    ];
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a5568, roughness: 0.8 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.7 });

    for (const spot of spots) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.75, 4, 8), bodyMat);
      body.position.y = 0.72;
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 10), skinMat);
      head.position.y = 1.28;
      head.castShadow = true;
      group.add(head);
      group.position.set(spot.x, 0, spot.z);
      this.scene.add(group);
      this.pedestrians.push({
        group,
        baseX: spot.x,
        baseZ: spot.z,
        axis: spot.axis,
        range: 2.5 + Math.random() * 2,
        speedPhase: Math.random() * Math.PI * 2,
      });
    }
  }

  private buildGasStation() {
    const stationMat = new THREE.MeshStandardMaterial({ color: 0xf0c419, emissive: 0x4a3a00, emissiveIntensity: 0.5 });
    const station = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), stationMat);
    station.position.set(CITY.streetHalfWidth + 9, 2.5, CITY.gasStationZ);
    station.castShadow = true;
    this.scene.add(station);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, emissive: 0x222222 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 8), canopyMat);
    canopy.position.set(CITY.streetHalfWidth + 6, 4.5, CITY.gasStationZ);
    this.scene.add(canopy);
  }

  /** One glowing beacon, repositioned to whatever the current fare target is — one thing to drive toward at a time. */
  private buildTargetBeacon() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4fe8d0, emissive: 0x4fe8d0, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 });
    this.targetBeacon = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 10), mat);
    this.targetBeacon.position.y = 2.5;
    this.scene.add(this.targetBeacon);
  }

  private currentTarget(): { x: number; z: number } {
    const fare = FARES[this.activeFareIndex];
    return this.fareStage === "to_pickup" ? fare.pickup : fare.dropoff;
  }

  private updateBeaconForCurrentTarget() {
    if (this.activeFareIndex >= FARES.length) {
      this.targetBeacon.visible = false;
      return;
    }
    const target = this.currentTarget();
    this.targetBeacon.visible = true;
    this.targetBeacon.position.set(target.x, 2.5, target.z);
    const isPickup = this.fareStage === "to_pickup";
    (this.targetBeacon.material as THREE.MeshStandardMaterial).color.setHex(isPickup ? 0x4fe8d0 : 0xf0c419);
    (this.targetBeacon.material as THREE.MeshStandardMaterial).emissive.setHex(isPickup ? 0x4fe8d0 : 0xf0c419);
  }

  private fareInstructionText(): string {
    if (this.activeFareIndex >= FARES.length) return "Shift complete";
    const fare = FARES[this.activeFareIndex];
    return this.fareStage === "to_pickup" ? `Pick up: ${fare.label}` : `Drop off: ${fare.label}`;
  }

  /** The real fix: remaining distance across the REST of the shift, not just "is fuel below a flat %." */
  private remainingShiftDistance(carX: number, carZ: number): number {
    if (this.activeFareIndex >= FARES.length) return 0;
    const fare = FARES[this.activeFareIndex];
    const target = this.currentTarget();
    let remaining = dist2D(carX, carZ, target.x, target.z);
    if (this.fareStage === "to_pickup") remaining += fare.legDistance;
    for (let i = this.activeFareIndex + 1; i < FARES.length; i++) remaining += FARES[i].legDistance;
    return remaining;
  }

  private buildContactShadow() {
    const texture = makeRadialTexture("rgba(0,0,0,0.45)", "rgba(0,0,0,0)");
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 4.6), mat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.02;
    this.scene.add(this.contactShadow);
  }

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

  private spawnDust(carX: number, carZ: number) {
    const slot = this.dustPool.find((p) => !p.active) ?? this.dustPool[0];
    const backward = new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading));
    const sideJitter = (Math.random() - 0.5) * 1.2;
    slot.sprite.position.set(carX + backward.x * 1.6 + sideJitter, 0.15, carZ + backward.z * 1.6 + sideJitter);
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
      p.velocity.y -= dt * 1.5;
      const lifeFrac = p.life / p.maxLife;
      (p.sprite.material as THREE.SpriteMaterial).opacity = 0.65 * lifeFrac;
      const scale = 0.5 + (1 - lifeFrac) * 0.9;
      p.sprite.scale.set(scale, scale, 1);
    }
  }

  private buildCar() {
    const paintMat = new THREE.MeshStandardMaterial({ color: this.car.color, roughness: 0.35, metalness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x11161f, roughness: 0.15, metalness: 0.4 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });

    const L = this.car.bodyLength;
    const W = this.car.bodyWidth;
    const H = this.car.bodyHeight;

    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), paintMat);
    lowerBody.position.y = H / 2 + 0.1;
    lowerBody.castShadow = true;
    this.carTiltGroup.add(lowerBody);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, H * 0.75, L * 0.26), paintMat);
    nose.position.set(0, H / 2 + 0.14, L / 2 - 0.1);
    nose.rotation.x = -0.12;
    nose.castShadow = true;
    this.carTiltGroup.add(nose);

    // Roof style drives cabin length/position/rake — the real differentiator
    // between the 4 selectable cars beyond paint color. Tuned against real
    // reference photos the user sent: an Impala SS (confirms the Caprice's
    // boxy formal 4-light greenhouse), a Chevelle SS 454 (continuous sloped
    // fastback line running into the trunk, not a boxy cabin with a slight
    // tilt), and a Challenger/Monte Carlo pair (flat long-hood/short-deck
    // coupe vs. a notchback with a sharp B-pillar kick into a short flat deck).
    let cabinLen = L * 0.46;
    let cabinZ = -L * 0.07;
    let roofH = H + 0.5;
    let cabinRotX = 0;
    let skipRoofCap = false;
    if (this.car.roofStyle === "formal") {
      cabinLen = L * 0.5;
      roofH = H + 0.56;
    } else if (this.car.roofStyle === "fastback") {
      // Long, low, and raked hard enough that the glass box itself reads as
      // the sloping roofline running down into the deck — a flat cap on top
      // would contradict that, so it's skipped for this style.
      cabinLen = L * 0.56;
      cabinZ = -L * 0.16;
      roofH = H + 0.36;
      cabinRotX = 0.24;
      skipRoofCap = true;
    } else if (this.car.roofStyle === "coupe") {
      // Cabin pushed toward the tail (not centered) so there's a long gap
      // ahead of it to the nose (long hood) and almost none behind it to the
      // tail (short deck) — the classic muscle-coupe proportion.
      cabinLen = L * 0.32;
      cabinZ = -L * 0.18;
      roofH = H + 0.36;
      cabinRotX = 0.04;
    } else {
      cabinLen = L * 0.4;
      cabinZ = -L * 0.08;
      roofH = H + 0.48;
    }

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, roofH - H, cabinLen), glassMat);
    cabin.position.set(0, H / 2 + 0.1 + (roofH - H) / 2 + 0.26, cabinZ);
    cabin.rotation.x = cabinRotX;
    cabin.castShadow = true;
    this.carTiltGroup.add(cabin);

    if (!skipRoofCap) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.65, 0.08, cabinLen * 0.75), paintMat);
      roof.position.set(0, H / 2 + 0.1 + (roofH - H) + 0.2, cabinZ - (this.car.roofStyle === "coupe" ? 0.1 : 0));
      this.carTiltGroup.add(roof);
    }

    if (this.car.roofStyle === "notchback") {
      // The Monte Carlo's signature: a short, flat, stepped-down rear-glass
      // panel (a sharp B-pillar kick), not a smooth taper — then a short flat
      // deck lip right behind it. Two distinct steps down, not one gradient.
      const backlight = new THREE.Mesh(new THREE.BoxGeometry(W * 0.68, (roofH - H) * 0.55, cabinLen * 0.22), glassMat);
      backlight.position.set(0, H / 2 + 0.1 + (roofH - H) * 0.32 + 0.26, cabinZ - cabinLen / 2 - cabinLen * 0.08);
      backlight.rotation.x = 0.55;
      backlight.castShadow = true;
      this.carTiltGroup.add(backlight);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 0.16, 0.45), paintMat);
      deck.position.set(0, H / 2 + 0.1 + 0.1, cabinZ - cabinLen / 2 - cabinLen * 0.22);
      this.carTiltGroup.add(deck);
    }

    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), trimMat);
      mirror.position.set((side * W) / 2, H + 0.3, cabinZ + cabinLen / 2 - 0.1);
      this.carTiltGroup.add(mirror);
    }

    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xfff4d6, emissiveIntensity: 1.1 });
    const taillightMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 1.1 });
    for (const side of [-1, 1]) {
      const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), headlightMat);
      headlight.position.set((side * W) / 2.9, H / 2 + 0.2, L / 2 + 0.28);
      this.carTiltGroup.add(headlight);
      const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.06), taillightMat);
      taillight.position.set((side * W) / 2.9, H / 2 + 0.25, -L / 2 - 0.18);
      this.carTiltGroup.add(taillight);
    }

    const wheelGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.28, 14);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 });
    const wheelX = W / 2 - 0.05;
    const wheelZ = L / 2 - 0.65;
    const wheelPositions: [number, number][] = [
      [-wheelX, wheelZ],
      [wheelX, wheelZ],
      [-wheelX, -wheelZ],
      [wheelX, -wheelZ],
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
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(W / 2, H / 2, L / 2).setMass(1), this.carRigid);
  }

  private setKey(code: string, val: boolean, e?: KeyboardEvent) {
    if (!LongHaulEngine.DRIVE_KEYS.has(code)) return;
    const active = document.activeElement;
    const isEditable =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (!isEditable) e?.preventDefault();

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
    const trailerMult = this.trailerAttached
      ? { maxSpeed: TRAILER.maxSpeedMult, turn: TRAILER.turnRateMult, accel: TRAILER.accelMult }
      : { maxSpeed: 1, turn: 1, accel: 1 };
    const fuelMult = this.fuel <= 0 ? VEHICLE.outOfFuelSpeedMult : 1;
    return {
      maxSpeed: VEHICLE.baseMaxSpeed * this.car.maxSpeedMult * trailerMult.maxSpeed * fuelMult,
      turnRate: VEHICLE.baseTurnRate * this.car.turnRateMult * trailerMult.turn,
      accel: VEHICLE.baseAccel * this.car.accelMult * trailerMult.accel,
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
    this.cashEarned = 0;
    this.trailerAttached = false;
    this.debt = 0;
    this.gasStationResolved = false;
    this.activeFareIndex = 0;
    this.fareStage = "to_pickup";
    this.startTime = performance.now();
    this.trailerMesh.visible = false;
    this.trailerHistory = [];
    this.carTiltGroup.rotation.set(0, 0, 0);
    this.dustSpawnTimer = 0;
    for (const p of this.dustPool) {
      p.active = false;
      p.sprite.visible = false;
    }
    this.updateBeaconForCurrentTarget();
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
      this.heading -= Math.sign(this.speed || 1) * turnAmount;

      // No ground collider exists (or is needed) for this velocity-override
      // controller — every distance/reach check below uses X/Z only, and the
      // visual car mesh hardcodes y=0 when synced from the rigid body further
      // down. Without zeroing Y here, world gravity free-falls the rigid body
      // forever (harmless today, but bad physics hygiene over a long session).
      const forward = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
      this.carRigid.setLinvel({ x: forward.x * this.speed, y: 0, z: forward.z * this.speed }, true);

      const drain = ECONOMY.fuelDrainIdle + (throttle > 0 ? ECONOMY.fuelDrainAtFullThrottle : 0);
      this.fuel = Math.max(0, this.fuel - drain * dt);

      const pos = this.carRigid.translation();

      // Fare pickup/dropoff reached?
      if (this.activeFareIndex < FARES.length) {
        const target = this.currentTarget();
        if (dist2D(pos.x, pos.z, target.x, target.z) < TARGET_REACH_RADIUS) {
          if (this.fareStage === "to_pickup") {
            this.fareStage = "to_dropoff";
            this.audio.playPickup();
          } else {
            const fare = FARES[this.activeFareIndex];
            this.cashEarned += fare.payout;
            this.callbacks.onFareComplete(fare.label, fare.payout);
            this.audio.playCashIn();
            this.activeFareIndex += 1;
            this.fareStage = "to_pickup";
          }
          this.updateBeaconForCurrentTarget();
        }
      }

      // The actual fix: only offer the loan if fuel genuinely can't cover
      // what's left. Reusing the gas-station landmark as the trigger point
      // (narrative "pull in here"), but the decision math is real.
      if (!this.gasStationResolved && pos.z <= CITY.gasStationZ) {
        this.gasStationResolved = true;
        const remaining = this.remainingShiftDistance(pos.x, pos.z);
        const rangeLeft = this.fuel * VEHICLE.fuelRangePerPercent;
        if (rangeLeft < remaining) {
          this.pauseCar();
          this.phase = "modal";
          this.audio.playLoanAlert();
          this.callbacks.onLoanPrompt();
        }
      }

      const inRoughZoneNow = false; // no rough-surface lane on the city layout yet
      this.audio.setEngineState(speedFrac, throttle > 0);
      this.audio.setSurfaceNoise(inRoughZoneNow, speedFrac);

      this.dustSpawnTimer -= dt;
      const kickingUpDust = Math.abs(this.speed) > 10 && Math.abs(steer) > 0.6;
      if (kickingUpDust && this.dustSpawnTimer <= 0) {
        this.dustSpawnTimer = DUST_SPAWN_INTERVAL;
        this.spawnDust(pos.x, pos.z);
      }

      if (this.activeFareIndex >= FARES.length) {
        this.pauseCar();
        this.phase = "finished";
        this.audio.playFinish();
        const elapsedSeconds = (now - this.startTime) / 1000;
        this.callbacks.onFinish({
          elapsedSeconds,
          cashEarned: this.cashEarned,
          cashGoal: SHIFT.cashGoal,
          faresCompleted: FARES.length,
          faresTotal: FARES.length,
          tookLoan: this.trailerAttached,
          debt: this.debt,
        });
      }

      this.world.timestep = dt;
      this.world.step();

      const clampPos = this.carRigid.translation();
      const corridorEdge = CITY.streetHalfWidth - 1.2;
      const nearCrossStreet = Math.abs(clampPos.z - CITY.crossStreetZ) < CITY.crossStreetHalfWidth + 2;
      if (!nearCrossStreet && Math.abs(clampPos.x) > corridorEdge) {
        const clampedX = Math.sign(clampPos.x) * corridorEdge;
        this.carRigid.setTranslation({ x: clampedX, y: clampPos.y, z: clampPos.z }, true);
        const lv = this.carRigid.linvel();
        this.carRigid.setLinvel({ x: 0, y: lv.y, z: lv.z }, true);
      }
    }

    const t = this.carRigid.translation();
    this.carGroup.position.set(t.x, 0, t.z);
    this.carGroup.rotation.y = this.heading;

    const targetBank = -steer * MAX_BANK;
    const targetPitch = throttle * MAX_PITCH;
    this.carTiltGroup.rotation.z += (targetBank - this.carTiltGroup.rotation.z) * 0.15;
    this.carTiltGroup.rotation.x += (targetPitch - this.carTiltGroup.rotation.x) * 0.15;

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

    const speedFracForFov = Math.min(1, Math.abs(this.speed) / VEHICLE.baseMaxSpeed);
    const targetFov = BASE_FOV + speedFracForFov * MAX_FOV_BONUS;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * 0.1;
      this.camera.updateProjectionMatrix();
    }

    this.contactShadow.position.set(t.x, 0.02, t.z);
    this.contactShadow.rotation.z = -this.heading;
    const forwardForLight = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.headlightSpot.position.set(t.x, 0.9, t.z);
    this.headlightTarget.position.set(t.x + forwardForLight.x * 14, 0, t.z + forwardForLight.z * 14);

    if (this.targetBeacon.visible) {
      this.targetBeacon.position.y = 2.3 + Math.sin(now / 300) * 0.3;
      this.targetBeacon.rotation.y += dt * 2;
    }

    for (const ped of this.pedestrians) {
      const offset = Math.sin(now / 900 + ped.speedPhase) * ped.range;
      if (ped.axis === "x") ped.group.position.x = ped.baseX + offset;
      else ped.group.position.z = ped.baseZ + offset;
      ped.group.position.y = Math.abs(Math.sin(now / 180 + ped.speedPhase)) * 0.04;
    }

    this.updateDust(dt);

    this.callbacks.onHud({
      speedMph: Math.round(Math.abs(this.speed) * 3.2),
      speedFrac: speedFracForFov,
      fuel: Math.round(this.fuel),
      cashEarned: this.cashEarned,
      cashGoal: SHIFT.cashGoal,
      trailerAttached: this.trailerAttached,
      debt: this.debt,
      fareInstruction: this.fareInstructionText(),
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
