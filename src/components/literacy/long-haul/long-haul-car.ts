import * as THREE from "three";
import { PAL } from "./long-haul-palette";
import { CAR, TRAILER_DIMS, buildCarGeometries, buildTrailerGeometries, type ResourceBin } from "./long-haul-geometry";
import { bodyPitch, bodyRoll, roughNoise, steerYaw, wheelSpinDelta, approach } from "./long-haul-feel";

/**
 * The player's small hatchback and the loan trailer, built from procedural geometry (see long-haul-geometry.ts).
 * The car group is positioned and yawed by the engine; inside it the body leans and pitches, the front wheels steer and
 * every wheel spins with speed. Nothing here has a physics body: the Rapier box in the engine is unchanged.
 */

export interface CarTextures {
  shadow: THREE.Texture;
  headlightPool: THREE.Texture;
  glow: THREE.Texture;
  envMap: THREE.Texture | null;
}

export interface CarFrameState {
  speed: number;
  speedFraction: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** -1 (braking hard) .. 1 (full acceleration) */
  accel: number;
  braking: boolean;
  onDirt: boolean;
  /** Seconds, for road-noise bounce. */
  time: number;
  reducedMotion: boolean;
}

export class LongHaulCar {
  readonly group = new THREE.Group();
  readonly trailer = new THREE.Group();

  private readonly bodyPivot = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly wheelMeshes: THREE.Mesh[] = [];
  private readonly trailerWheels: THREE.Mesh[] = [];
  private readonly tailMaterial: THREE.MeshStandardMaterial;
  private readonly tailGlowMaterial: THREE.SpriteMaterial;
  private spin = 0;
  private steerVis = 0;
  private roll = 0;
  private pitch = 0;
  private brakeLevel = 0;

  constructor(bin: ResourceBin, textures: CarTextures) {
    const geo = buildCarGeometries();
    for (const g of Object.values(geo)) bin.add(g);

    const body = bin.add(
      new THREE.MeshPhysicalMaterial({
        color: PAL.signal,
        metalness: 0.5,
        roughness: 0.3,
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMap: textures.envMap,
        envMapIntensity: 1.2,
      }),
    );
    const glass = bin.add(
      new THREE.MeshStandardMaterial({ color: PAL.glass, metalness: 0.7, roughness: 0.1, emissive: 0x07161e, envMap: textures.envMap, envMapIntensity: 1.5 }),
    );
    const trim = bin.add(new THREE.MeshStandardMaterial({ color: PAL.trim, roughness: 0.55, metalness: 0.2 }));
    const headMat = bin.add(new THREE.MeshBasicMaterial({ color: 0xfff2cf }));
    this.tailMaterial = bin.add(new THREE.MeshStandardMaterial({ color: 0x3a0509, emissive: 0xff2b3a, emissiveIntensity: 1.0, roughness: 0.4 }));
    const wheelMat = bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }));

    this.bodyPivot.add(new THREE.Mesh(geo.body, body));
    this.bodyPivot.add(new THREE.Mesh(geo.glass, glass));
    this.bodyPivot.add(new THREE.Mesh(geo.trim, trim));
    this.bodyPivot.add(new THREE.Mesh(geo.headlights, headMat));
    this.bodyPivot.add(new THREE.Mesh(geo.taillights, this.tailMaterial));
    this.group.add(this.bodyPivot);

    for (const sx of [1, -1]) {
      for (const z of [CAR.frontAxleZ, CAR.rearAxleZ]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * CAR.wheelX, CAR.wheelRadius, z);
        const wheel = new THREE.Mesh(geo.wheel, wheelMat);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheelMeshes.push(wheel);
        if (z === CAR.frontAxleZ) this.frontPivots.push(pivot);
      }
    }

    // Soft shadow under the car and the light the headlights throw on the road.
    const shadowMat = bin.add(new THREE.MeshBasicMaterial({ map: textures.shadow, transparent: true, depthWrite: false, opacity: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    const shadowGeo = bin.add(new THREE.PlaneGeometry(2.7, 5.4));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(0, 0.045, 0);
    shadow.renderOrder = 1;
    this.group.add(shadow);

    const poolMat = bin.add(
      new THREE.MeshBasicMaterial({ map: textures.headlightPool, color: 0xfff0d0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const poolGeo = bin.add(new THREE.PlaneGeometry(5.6, 15));
    poolGeo.rotateX(-Math.PI / 2);
    poolGeo.rotateY(Math.PI); // texture "up" is the direction of travel (+z in car space)
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.set(0, 0.055, 2.2 + 7.2);
    pool.renderOrder = 2;
    this.group.add(pool);

    // Red flare behind the tail lights, brighter when braking.
    this.tailGlowMaterial = bin.add(new THREE.SpriteMaterial({ map: textures.glow, color: 0xff2b3a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const sx of [1, -1]) {
      const s = new THREE.Sprite(this.tailGlowMaterial);
      s.position.set(sx * 0.62, 0.84, -2.05);
      s.scale.set(1.3, 0.8, 1);
      this.bodyPivot.add(s);
    }

    this.buildTrailer(bin, wheelMat);
  }

  private buildTrailer(bin: ResourceBin, wheelMat: THREE.Material): void {
    const tg = buildTrailerGeometries();
    for (const g of Object.values(tg)) bin.add(g);
    const frame = bin.add(new THREE.MeshStandardMaterial({ color: PAL.lineBright, roughness: 0.6, metalness: 0.4 }));
    const load = bin.add(new THREE.MeshStandardMaterial({ color: PAL.verdict, roughness: 0.85, metalness: 0.0 }));
    const straps = bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink900, roughness: 0.9 }));
    this.trailer.add(new THREE.Mesh(tg.frame, frame));
    this.trailer.add(new THREE.Mesh(tg.load, load));
    this.trailer.add(new THREE.Mesh(tg.straps, straps));
    this.trailer.add(new THREE.Mesh(tg.taillights, this.tailMaterial));
    for (const sx of [1, -1]) {
      const wheel = new THREE.Mesh(tg.wheel, wheelMat);
      wheel.position.set(sx * TRAILER_DIMS.wheelX, TRAILER_DIMS.wheelRadius, TRAILER_DIMS.wheelZ);
      this.trailer.add(wheel);
      this.trailerWheels.push(wheel);
    }
    this.trailer.visible = false;
  }

  /** Where the trailer hitch is, relative to the car's centre along its heading (metres behind). */
  static readonly HITCH_BACK = -CAR.hitchZ;

  /** Per frame: steering, spin, lean, pitch, bounce on the rough lane, brake lights. Allocation-free. */
  update(dt: number, s: CarFrameState): void {
    this.steerVis = approach(this.steerVis, s.steer, 12, dt);
    const yaw = steerYaw(this.steerVis);
    for (const p of this.frontPivots) p.rotation.y = yaw;

    this.spin = (this.spin + wheelSpinDelta(s.speed, dt, CAR.wheelRadius)) % (Math.PI * 2);
    for (const w of this.wheelMeshes) w.rotation.x = this.spin;
    const trailerSpin = (this.spin * CAR.wheelRadius) / TRAILER_DIMS.wheelRadius;
    for (const w of this.trailerWheels) w.rotation.x = trailerSpin;

    const targetRoll = s.reducedMotion ? 0 : bodyRoll(s.steer, s.speedFraction);
    const targetPitch = s.reducedMotion ? 0 : bodyPitch(s.accel);
    this.roll = approach(this.roll, targetRoll, 7, dt);
    this.pitch = approach(this.pitch, targetPitch, 6, dt);
    this.bodyPivot.rotation.z = this.roll;
    this.bodyPivot.rotation.x = this.pitch;

    // A little bounce on the dirt lane (visual only: the physics body stays on the ground).
    let bob = 0;
    if (s.onDirt && !s.reducedMotion) bob = Math.abs(roughNoise(s.time, 1.3)) * 0.035 * s.speedFraction;
    this.bodyPivot.position.y = bob;
    this.bodyPivot.rotation.z += s.onDirt && !s.reducedMotion ? roughNoise(s.time, 4.1) * 0.012 * s.speedFraction : 0;

    this.brakeLevel = approach(this.brakeLevel, s.braking ? 1 : 0, s.braking ? 30 : 12, dt);
    this.tailMaterial.emissiveIntensity = 1.0 + 2.6 * this.brakeLevel;
    this.tailGlowMaterial.opacity = 0.35 + 0.6 * this.brakeLevel;
  }

  /** Place the trailer at the hitch behind the car, pivoting toward a (lagged) heading. */
  placeTrailer(carX: number, carZ: number, carHeading: number, laggedHeading: number): void {
    const back = LongHaulCar.HITCH_BACK;
    this.trailer.position.set(carX - Math.sin(carHeading) * back, 0, carZ - Math.cos(carHeading) * back);
    this.trailer.rotation.y = laggedHeading;
  }

  setTrailerVisible(visible: boolean): void {
    this.trailer.visible = visible;
  }

  /** Snap the animated state back (Drive Again). */
  reset(): void {
    this.spin = 0;
    this.steerVis = 0;
    this.roll = 0;
    this.pitch = 0;
    this.brakeLevel = 0;
    this.bodyPivot.rotation.set(0, 0, 0);
    this.bodyPivot.position.y = 0;
    this.trailer.visible = false;
  }
}
