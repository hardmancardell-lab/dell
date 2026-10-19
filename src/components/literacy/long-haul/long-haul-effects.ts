import * as THREE from "three";
import type { ResourceBin } from "./long-haul-geometry";

/**
 * Speed lines and dust puffs for The Long Haul. Pooled typed arrays, no per-frame allocation. Both are purely visual and switch off with
 * prefers-reduced-motion (and the low-quality fallback).
 */

const LINE_COUNT = 36;
const LINE_SPAN = 38; // metres of road the streaks cycle through, in car space
const DUST_COUNT = 72;

export class DriveEffects {
  private readonly lines: THREE.LineSegments;
  private readonly linePos: Float32Array;
  private readonly lineX = new Float32Array(LINE_COUNT);
  private readonly lineY = new Float32Array(LINE_COUNT);
  private readonly lineZ = new Float32Array(LINE_COUNT);
  private readonly lineMaterial: THREE.LineBasicMaterial;

  private readonly dust: THREE.Points;
  private readonly dustPos: Float32Array;
  private readonly dustCol: Float32Array;
  private readonly dustVel = new Float32Array(DUST_COUNT * 3);
  private readonly dustLife = new Float32Array(DUST_COUNT);
  private dustCursor = 0;
  private dustCarry = 0;
  private enabled = true;

  constructor(bin: ResourceBin, scene: THREE.Scene, carGroup: THREE.Object3D, soft: THREE.Texture) {
    // Streaks: pairs of vertices in car space (+z is forward). They sit still in the world, so relative to the car they slide backwards.
    this.linePos = new Float32Array(LINE_COUNT * 6);
    for (let i = 0; i < LINE_COUNT; i++) this.respawn(i, Math.random() * LINE_SPAN - 8);
    const lineGeo = bin.add(new THREE.BufferGeometry());
    lineGeo.setAttribute("position", new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lineMaterial = bin.add(new THREE.LineBasicMaterial({ color: 0xcfeff5, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.lines = new THREE.LineSegments(lineGeo, this.lineMaterial);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    carGroup.add(this.lines);

    // Dust: a ring buffer of soft round sprites kicked up by the rear wheels on the dirt lane.
    this.dustPos = new Float32Array(DUST_COUNT * 3);
    this.dustCol = new Float32Array(DUST_COUNT * 4);
    for (let i = 0; i < DUST_COUNT; i++) this.dustPos[i * 3 + 1] = -50;
    const dustGeo = bin.add(new THREE.BufferGeometry());
    dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3).setUsage(THREE.DynamicDrawUsage));
    dustGeo.setAttribute("color", new THREE.BufferAttribute(this.dustCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(
      dustGeo,
      bin.add(new THREE.PointsMaterial({ map: soft, size: 2.4, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false })),
    );
    this.dust.frustumCulled = false;
    scene.add(this.dust);
  }

  /** Place streak i at a fresh random spot beside and above the road, starting at car-space z. */
  private respawn(i: number, z: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    this.lineX[i] = side * (2.4 + Math.random() * 7);
    this.lineY[i] = 0.4 + Math.random() * 3.6;
    this.lineZ[i] = z;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.lines.visible = false;
      this.dust.visible = false;
    }
  }

  reset(): void {
    for (let i = 0; i < DUST_COUNT; i++) {
      this.dustLife[i] = 0;
      this.dustPos[i * 3 + 1] = -50;
      this.dustCol[i * 4 + 3] = 0;
    }
    (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.dust.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * @param speed signed forward speed in m/s
   * @param speedFraction 0..1 of the top speed
   * @param carX,carZ,heading the car's pose; dust spawns at the rear wheels
   */
  update(dt: number, speed: number, speedFraction: number, onDirt: boolean, carX: number, carZ: number, heading: number): void {
    if (!this.enabled) return;

    // ---- speed lines: only visible when going fast
    const show = speedFraction > 0.45;
    this.lines.visible = show;
    if (show) {
      const strength = Math.min(1, (speedFraction - 0.45) / 0.55);
      this.lineMaterial.opacity = 0.1 + 0.42 * strength;
      const len = 0.8 + 5.5 * strength;
      const move = speed * dt;
      for (let i = 0; i < LINE_COUNT; i++) {
        let z = this.lineZ[i] - move;
        if (z < -14) {
          this.respawn(i, z + LINE_SPAN);
          z = this.lineZ[i];
        }
        this.lineZ[i] = z;
        const o = i * 6;
        this.linePos[o] = this.lineX[i];
        this.linePos[o + 1] = this.lineY[i];
        this.linePos[o + 2] = z;
        this.linePos[o + 3] = this.lineX[i];
        this.linePos[o + 4] = this.lineY[i];
        this.linePos[o + 5] = z - len;
      }
      (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // ---- dust on the dirt lane
    let any = false;
    if (onDirt && speed > 3) {
      this.dustCarry += dt * (10 + 36 * speedFraction);
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      while (this.dustCarry >= 1) {
        this.dustCarry -= 1;
        const i = this.dustCursor;
        this.dustCursor = (this.dustCursor + 1) % DUST_COUNT;
        const side = Math.random() < 0.5 ? -1 : 1;
        const rx = Math.cos(heading) * side * 0.8;
        const rz = -Math.sin(heading) * side * 0.8;
        this.dustPos[i * 3] = carX - fx * 1.5 + rx + (Math.random() - 0.5) * 0.4;
        this.dustPos[i * 3 + 1] = 0.15;
        this.dustPos[i * 3 + 2] = carZ - fz * 1.5 + rz + (Math.random() - 0.5) * 0.4;
        this.dustVel[i * 3] = -fx * speed * 0.18 + (Math.random() - 0.5) * 1.6;
        this.dustVel[i * 3 + 1] = 0.6 + Math.random() * 1.2;
        this.dustVel[i * 3 + 2] = -fz * speed * 0.18 + (Math.random() - 0.5) * 1.6;
        this.dustLife[i] = 1;
      }
    } else {
      this.dustCarry = 0;
    }
    for (let i = 0; i < DUST_COUNT; i++) {
      const life = this.dustLife[i];
      if (life <= 0) continue;
      any = true;
      const nl = life - dt * 1.25;
      this.dustLife[i] = nl;
      const o = i * 3;
      if (nl <= 0) {
        this.dustPos[o + 1] = -50;
        this.dustCol[i * 4 + 3] = 0;
        continue;
      }
      const drag = Math.exp(-dt * 1.6);
      this.dustVel[o] *= drag;
      this.dustVel[o + 1] *= drag;
      this.dustVel[o + 2] *= drag;
      this.dustPos[o] += this.dustVel[o] * dt;
      this.dustPos[o + 1] += this.dustVel[o + 1] * dt;
      this.dustPos[o + 2] += this.dustVel[o + 2] * dt;
      const c = i * 4;
      this.dustCol[c] = 0.62;
      this.dustCol[c + 1] = 0.52;
      this.dustCol[c + 2] = 0.38;
      this.dustCol[c + 3] = nl * nl * 0.5;
    }
    this.dust.visible = any;
    if (any) {
      (this.dust.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.dust.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
