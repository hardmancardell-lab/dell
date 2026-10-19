import * as THREE from "three";
import { TRACK, ECONOMY } from "@/lib/agents/financial-literacy/skills/long-haul-content";
import { PAL } from "./long-haul-palette";
import {
  FACADE,
  buildBarrierGeometry,
  buildBuildingGeometry,
  buildConeGeometry,
  buildFlexPostGeometry,
  buildLampHeadGeometry,
  buildLampPoleGeometry,
  buildTreeGeometries,
  mergeAll,
  type ResourceBin,
} from "./long-haul-geometry";
import {
  hex,
  makeAsphaltTexture,
  makeCheckerTexture,
  makeDirtTextures,
  makeFacadeTextures,
  makeFadeTexture,
  makeGlowTexture,
  makeHatchTexture,
  makeSignTexture,
  makeSkyTexture,
  makeStorefrontTexture,
  mulberry32,
} from "./long-haul-textures";

/**
 * The road, the dirt back road, the toll gantry, the gas station, the finish and the dusk city around them.
 *
 * Gameplay geometry is untouched: the road is TRACK.halfWidth (20) either side of x = 0, the split zone runs from TRACK.laneSplitStartZ to
 * laneSplitEndZ with the rough lane at x < -2 and the paved highway lane at x > 2, the toll sits at TRACK.tollZ, the gas station at
 * gasStationZ and the finish at finishZ. Anything solid (posts, signs, buildings) stands outside |x| = 20 or is flat paint on the road, and none
 * of it has a physics body, so nothing can block the car.
 *
 * Performance: every repeated thing is an InstancedMesh or one merged mesh (about 70 draw calls for the whole scene), materials and
 * geometries are shared, and nothing allocates per frame.
 */

export const WORLD = {
  zNear: 90,
  zFar: -450,
  roadHalf: TRACK.halfWidth,
};

const ROAD_LEN = WORLD.zNear - WORLD.zFar;
const ROAD_CENTRE_Z = (WORLD.zNear + WORLD.zFar) / 2;
const SPLIT_MID_Z = (TRACK.laneSplitStartZ + TRACK.laneSplitEndZ) / 2;
const SPLIT_LEN = Math.abs(TRACK.laneSplitEndZ - TRACK.laneSplitStartZ);
const FOG_NEAR = 45;
const FOG_FAR = 270;

const _d = new THREE.Object3D();
const _c = new THREE.Color();

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): void {
  _d.position.set(x, y, z);
  _d.rotation.set(0, ry, 0);
  _d.scale.set(sx, sy, sz);
  _d.updateMatrix();
  mesh.setMatrixAt(i, _d.matrix);
}

function shuffle<T>(arr: T[], rnd: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
  color?: number;
}

export class LongHaulWorld {
  readonly group = new THREE.Group();
  readonly skyTexture: THREE.Texture;
  private readonly sky: THREE.Mesh;
  private readonly reducible: { mesh: THREE.InstancedMesh; full: number }[] = [];
  private readonly tollSignMaterial: THREE.MeshBasicMaterial;
  private readonly beaconMaterial: THREE.PointsMaterial;
  private tollFlash = 0;
  private lowQuality = false;

  constructor(
    private readonly bin: ResourceBin,
    anisotropy: number,
  ) {
    const glow = bin.add(makeGlowTexture(2));
    const mat = <T extends THREE.Material>(m: T): T => bin.add(m);

    // ----- sky -----
    this.skyTexture = bin.add(makeSkyTexture());
    const skyGeo = bin.add(new THREE.SphereGeometry(480, 48, 24));
    this.sky = new THREE.Mesh(skyGeo, mat(new THREE.MeshBasicMaterial({ map: this.skyTexture, side: THREE.BackSide, fog: false, depthWrite: false })));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // ----- ground and tarmac -----
    const asphalt = bin.add(makeAsphaltTexture(anisotropy));
    const groundTex = asphalt.clone();
    bin.add(groundTex);
    groundTex.repeat.set(110, 110);
    groundTex.needsUpdate = true;
    const ground = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(1500, 1500)), mat(new THREE.MeshStandardMaterial({ color: 0x1a2330, map: groundTex, roughness: 1 })));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.06, ROAD_CENTRE_Z);
    this.group.add(ground);

    asphalt.repeat.set((TRACK.halfWidth * 2) / 8, ROAD_LEN / 8);
    asphalt.needsUpdate = true;
    const road = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(TRACK.halfWidth * 2, ROAD_LEN)), mat(new THREE.MeshStandardMaterial({ color: 0xb8c4d2, map: asphalt, roughness: 0.92, metalness: 0 })));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0, ROAD_CENTRE_Z);
    this.group.add(road);

    this.buildSidewalksAndBarriers();
    this.buildMarkings();
    this.buildDirtLane(anisotropy);
    this.buildMedian(anisotropy);
    this.buildCones();

    const tollSign = this.buildTollGantry(anisotropy);
    this.tollSignMaterial = tollSign;
    this.buildSplitSigns(anisotropy);
    this.buildGasStation(anisotropy);
    this.buildFinish(anisotropy);

    this.buildLamps(glow);
    this.buildTrees();
    this.buildBillboards(anisotropy);
    this.beaconMaterial = this.buildCity(glow, anisotropy);
  }

  // ---------------------------------------------------------------- road furniture

  private buildSidewalksAndBarriers(): void {
    const { bin, group } = this;
    const slab = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, z);
      return { geo: g, color };
    };
    const parts = [] as { geo: THREE.BufferGeometry; color: number }[];
    for (const s of [1, -1]) {
      parts.push(slab(7.4, 0.16, ROAD_LEN, s * 24.3, 0.08, ROAD_CENTRE_Z, 0x232d3a));
      parts.push(slab(0.36, 0.2, ROAD_LEN, s * 20.8, 0.1, ROAD_CENTRE_Z, 0x46566a));
    }
    // Concrete apron in front of the gas station.
    parts.push(slab(26, 0.17, 40, 33.6, 0.085, TRACK.gasStationZ, 0x2b3644));
    const walkGeo = bin.add(mergeAll(parts, true));
    group.add(new THREE.Mesh(walkGeo, bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))));

    // Low jersey barriers along both road edges (visual only; the car is clamped to the road by the engine). Gap at the gas station.
    const barMat = bin.add(new THREE.MeshStandardMaterial({ color: 0x4a5b70, roughness: 0.85 }));
    const segments: { x: number; z0: number; z1: number }[] = [
      { x: -20.25, z0: WORLD.zNear, z1: WORLD.zFar },
      { x: 20.25, z0: WORLD.zNear, z1: TRACK.gasStationZ + 17 },
      { x: 20.25, z0: TRACK.gasStationZ - 17, z1: WORLD.zFar },
    ];
    for (const seg of segments) {
      const len = seg.z0 - seg.z1;
      const mesh = new THREE.Mesh(bin.add(buildBarrierGeometry(len)), barMat);
      mesh.position.set(seg.x, 0, (seg.z0 + seg.z1) / 2);
      group.add(mesh);
    }
    // Reflector studs along the barrier tops: amber on the right, white on the left. They also give a strong sense of speed.
    const studGeo = bin.add(new THREE.BoxGeometry(0.05, 0.1, 0.36));
    const studMat = bin.add(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const studs: Inst[] = [];
    const colors: number[] = [];
    for (let z = WORLD.zNear - 2; z > WORLD.zFar; z -= 7) {
      studs.push({ x: -19.86, y: 0.7, z, sx: 1, sy: 1, sz: 1, ry: 0 });
      colors.push(0xdfe9f5);
      if (z > TRACK.gasStationZ + 17 || z < TRACK.gasStationZ - 17) {
        studs.push({ x: 19.86, y: 0.7, z, sx: 1, sy: 1, sz: 1, ry: 0 });
        colors.push(PAL.verdict);
      }
    }
    const studMesh = new THREE.InstancedMesh(studGeo, studMat, studs.length);
    studs.forEach((s, i) => {
      place(studMesh, i, s.x, s.y, s.z);
      studMesh.setColorAt(i, _c.setHex(colors[i]));
    });
    studMesh.instanceMatrix.needsUpdate = true;
    group.add(studMesh);
  }

  /** Painted lines: solid edge lines, double yellow centre line, dashed lane lines. One instanced mesh. */
  private buildMarkings(): void {
    const { bin, group } = this;
    const geo = bin.add(new THREE.PlaneGeometry(1, 1));
    geo.rotateX(-Math.PI / 2);
    const material = bin.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x20262e, polygonOffset: true, polygonOffsetFactor: -1 }));
    const insts: Inst[] = [];
    const white = PAL.paint;
    const yellow = PAL.paintYellow;
    const y = 0.03;
    const inSplit = (z: number) => z < TRACK.laneSplitStartZ + 4 && z > TRACK.laneSplitEndZ - 4;

    const line = (x: number, w: number, z0: number, z1: number, color: number) => {
      insts.push({ x, y, z: (z0 + z1) / 2, sx: w, sy: 1, sz: Math.abs(z0 - z1), ry: 0, color });
    };
    // Edge lines
    line(19, 0.24, WORLD.zNear, WORLD.zFar, white);
    line(-19, 0.24, WORLD.zNear, TRACK.laneSplitStartZ + 4, white);
    line(-19, 0.24, TRACK.laneSplitEndZ - 4, WORLD.zFar, white);
    // Double yellow centre line, except through the painted gore of the split.
    for (const dx of [-0.16, 0.16]) {
      line(dx, 0.12, WORLD.zNear, TRACK.laneSplitStartZ + 6, yellow);
      line(dx, 0.12, TRACK.laneSplitEndZ - 6, WORLD.zFar, yellow);
    }
    // Dashed lane lines (4 m paint, 4 m gap).
    for (let z = WORLD.zNear - 1; z > WORLD.zFar; z -= 8) {
      for (const x of [-12.7, -6.4]) if (!inSplit(z)) insts.push({ x, y, z: z - 2, sx: 0.18, sy: 1, sz: 4, ry: 0, color: white });
      for (const x of [6.4, 12.7]) insts.push({ x, y, z: z - 2, sx: 0.18, sy: 1, sz: 4, ry: 0, color: white });
    }
    // Stop-bar style dashes at the split mouth.
    const mesh = new THREE.InstancedMesh(geo, material, insts.length);
    insts.forEach((s, i) => {
      place(mesh, i, s.x, s.y, s.z, s.sx, 1, s.sz);
      mesh.setColorAt(i, _c.setHex(s.color ?? white));
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  /** The rough back road: x from -20 to -2 between laneSplitStartZ and laneSplitEndZ, with a bumpy surface and gravel that spills onto the tarmac at each end. */
  private buildDirtLane(anisotropy: number): void {
    const { bin, group } = this;
    const { map, bump } = makeDirtTextures(anisotropy);
    bin.add(map);
    bin.add(bump);
    map.repeat.set(3, SPLIT_LEN / 6);
    bump.repeat.set(3, SPLIT_LEN / 6);
    const w = TRACK.halfWidth - 2;
    const segX = 24;
    const segZ = Math.round(SPLIT_LEN / 1.5);
    const geo = bin.add(new THREE.PlaneGeometry(w, SPLIT_LEN, segX, segZ));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const rnd = mulberry32(77);
    const phase = rnd() * 10;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const n = 0.5 + 0.5 * Math.sin(x * 1.7 + phase) * Math.sin(z * 0.9 + phase * 0.5) + 0.25 * Math.sin(x * 5.1 + z * 3.3);
      const edge = Math.min(1, (w / 2 - Math.abs(x)) / 1.5);
      // lift only (never below the tarmac under it), plus a ridge down the middle of the lane
      pos.setY(i, 0.015 + Math.max(0, n) * 0.055 * Math.max(0, edge));
    }
    geo.computeVertexNormals();
    const material = bin.add(new THREE.MeshStandardMaterial({ color: 0xc9b9a0, map, bumpMap: bump, bumpScale: 3, roughness: 1, metalness: 0 }));
    const dirt = new THREE.Mesh(geo, material);
    dirt.position.set(-TRACK.halfWidth / 2 - 1, 0, SPLIT_MID_Z);
    group.add(dirt);

    const fade = bin.add(makeFadeTexture());
    const rampMat = bin.add(new THREE.MeshStandardMaterial({ color: 0xc9b9a0, map, alphaMap: fade, transparent: true, roughness: 1, depthWrite: false }));
    const rampGeo = bin.add(new THREE.PlaneGeometry(w, 7));
    rampGeo.rotateX(-Math.PI / 2);
    const rampA = new THREE.Mesh(rampGeo, rampMat); // fades out toward +z (before the split)
    rampA.position.set(-TRACK.halfWidth / 2 - 1, 0.018, TRACK.laneSplitStartZ + 3.5);
    rampA.rotation.y = Math.PI; // alpha map is opaque at one end: the end touching the dirt
    rampA.renderOrder = 1;
    group.add(rampA);
    const rampB = new THREE.Mesh(rampGeo, rampMat);
    rampB.position.set(-TRACK.halfWidth / 2 - 1, 0.018, TRACK.laneSplitEndZ - 3.5);
    rampB.renderOrder = 1;
    group.add(rampB);

    // Rocks and scrub on the verge outside the barrier (instanced).
    const rockGeo = bin.add(new THREE.DodecahedronGeometry(0.8, 0));
    const rockMat = bin.add(new THREE.MeshStandardMaterial({ color: 0x5b5648, roughness: 1, flatShading: true }));
    const rocks: Inst[] = [];
    const r2 = mulberry32(13);
    for (let z = TRACK.laneSplitStartZ + 6; z > TRACK.laneSplitEndZ - 6; z -= 3.2 + r2() * 4) {
      const s = 0.5 + r2() * 1.1;
      rocks.push({ x: -(21.4 + r2() * 5), y: 0.3 * s, z, sx: s * (0.8 + r2() * 0.6), sy: s * 0.7, sz: s * (0.8 + r2() * 0.6), ry: r2() * 6 });
    }
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
    rocks.forEach((r, i) => {
      place(rockMesh, i, r.x, r.y, r.z, r.sx, r.sy, r.sz, r.ry);
      rockMesh.setColorAt(i, _c.setHSL(0.08 + r2() * 0.04, 0.12, 0.3 + r2() * 0.15));
    });
    group.add(rockMesh);
  }

  /** The divider between the lanes: a painted, hatched gore (4 m wide) with flexible posts, not a solid kerb. */
  private buildMedian(anisotropy: number): void {
    const { bin, group } = this;
    const hatch = bin.add(makeHatchTexture(anisotropy));
    const len = SPLIT_LEN + 12;
    hatch.repeat.set(1, len / 8);
    const geo = bin.add(new THREE.PlaneGeometry(4, len));
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, bin.add(new THREE.MeshStandardMaterial({ map: hatch, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 })));
    mesh.position.set(0, 0.025, SPLIT_MID_Z);
    group.add(mesh);

    const postGeo = bin.add(buildFlexPostGeometry());
    const postMat = bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0x161a20 }));
    const posts: Inst[] = [];
    for (let z = TRACK.laneSplitStartZ - 4; z > TRACK.laneSplitEndZ + 4; z -= 9) {
      posts.push({ x: -1.85, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
      posts.push({ x: 1.85, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
    }
    const pm = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach((p, i) => place(pm, i, p.x, p.y, p.z));
    group.add(pm);
  }

  /** Cones tapering into the split, so the fork reads as a road change. */
  private buildCones(): void {
    const { bin, group } = this;
    const coneGeo = bin.add(buildConeGeometry());
    const coneMat = bin.add(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x2a1a0a }));
    const cones: Inst[] = [];
    for (let k = 0; k < 7; k++) {
      const z = TRACK.laneSplitStartZ + 14 - k * 2.2;
      const spread = 0.8 + (6 - k) * 0.55;
      cones.push({ x: -spread, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
      cones.push({ x: spread, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
    }
    // Cones where the lanes rejoin
    for (let k = 0; k < 5; k++) {
      const z = TRACK.laneSplitEndZ - 3 - k * 2.2;
      const spread = 0.8 + k * 0.55;
      cones.push({ x: -spread, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
      cones.push({ x: spread, y: 0.02, z, sx: 1, sy: 1, sz: 1, ry: 0 });
    }
    const m = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
    cones.forEach((c, i) => place(m, i, c.x, c.y, c.z));
    group.add(m);
  }

  // ---------------------------------------------------------------- gantries and signs

  /** Overhead toll gantry across the highway lanes with a sign showing TOLL and the cost. Returns the sign material (it flashes when the toll is charged). */
  private buildTollGantry(anisotropy: number): THREE.MeshBasicMaterial {
    const { bin, group } = this;
    const z = TRACK.tollZ;
    const steel = bin.add(new THREE.MeshStandardMaterial({ color: 0x3a4859, roughness: 0.6, metalness: 0.5 }));
    const box = (w: number, h: number, d: number, x: number, y: number, zz: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, zz);
      return { geo: g };
    };
    const frame = bin.add(
      mergeAll([
        box(0.7, 7.2, 0.7, 0, 3.6, z), // median-side post (on the painted gore, not in a lane)
        box(0.7, 7.2, 0.7, 21.4, 3.6, z), // outer post, behind the barrier
        box(1.5, 0.5, 1.5, 0, 0.25, z),
        box(1.5, 0.5, 1.5, 21.4, 0.25, z),
        box(22.1, 0.9, 0.9, 10.7, 6.6, z), // beam
        box(0.25, 1.6, 0.25, 6.5, 7.9, z - 0.1), // sign supports
        box(0.25, 1.6, 0.25, 14.9, 7.9, z - 0.1),
      ]),
    );
    group.add(new THREE.Mesh(frame, steel));

    const signTex = bin.add(
      makeSignTexture(768, 256, hex(PAL.ink800), hex(PAL.signal), [
        { text: "TOLL", size: 130, color: hex(PAL.text0), y: 100, weight: 800, align: "left", x: 56 },
        { text: `$${ECONOMY.tollCost}`, size: 150, color: hex(PAL.verdict), y: 100, weight: 800, align: "right", x: 712 },
        { text: "HIGHWAY  -  SMOOTH & FAST", size: 44, color: hex(PAL.signal), y: 205, weight: 600 },
      ], anisotropy),
    );
    const signMat = bin.add(new THREE.MeshBasicMaterial({ map: signTex }));
    const signGeo = bin.add(new THREE.PlaneGeometry(9.6, 3.2));
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(10.7, 8.3, z + 0.2);
    group.add(sign);
    const back = new THREE.Mesh(bin.add(new THREE.BoxGeometry(9.9, 3.5, 0.2)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink700, roughness: 0.8 })));
    back.position.set(10.7, 8.3, z + 0.02);
    group.add(back);

    // Lane signals under the beam: a green light per lane.
    const lampGeo = bin.add(new THREE.BoxGeometry(0.7, 0.18, 0.7));
    const lampMat = bin.add(new THREE.MeshBasicMaterial({ color: PAL.signal }));
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 3);
    [5.4, 11.2, 16.8].forEach((x, i) => place(lamps, i, x, 6.05, z));
    group.add(lamps);
    // A light pool on the road under the gantry.
    const pool = this.lightPool(bin.add(makeGlowTexture(1.6)), 0xffc98a, 24, 12, 0.35);
    pool.position.set(11, 0.05, z);
    group.add(pool);
    return signMat;
  }

  private buildSplitSigns(anisotropy: number): void {
    const { bin, group } = this;
    const z = TRACK.laneSplitStartZ + 16;
    const postMat = bin.add(new THREE.MeshStandardMaterial({ color: 0x3a4859, roughness: 0.6, metalness: 0.5 }));
    const defs = [
      { x: -23.5, rot: 0.38, lines: [{ text: "BACK ROADS", size: 84, color: hex(PAL.verdict), y: 90, weight: 800 }, { text: "FREE  -  ROUGH", size: 46, color: hex(PAL.text0), y: 175, weight: 600 }], border: hex(PAL.verdict) },
      { x: 23.5, rot: -0.38, lines: [{ text: "HIGHWAY", size: 90, color: hex(PAL.signal), y: 90, weight: 800 }, { text: "TOLL  -  SMOOTH", size: 46, color: hex(PAL.text0), y: 175, weight: 600 }], border: hex(PAL.signal) },
    ];
    const posts: { geo: THREE.BufferGeometry }[] = [];
    for (const d of defs) {
      const tex = bin.add(makeSignTexture(512, 224, hex(PAL.ink800), d.border, d.lines, anisotropy));
      const panel = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(6.4, 2.8)), bin.add(new THREE.MeshBasicMaterial({ map: tex })));
      panel.position.set(d.x, 4.3, z);
      panel.rotation.y = d.rot;
      group.add(panel);
      const backing = new THREE.Mesh(bin.add(new THREE.BoxGeometry(6.6, 3.0, 0.15)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink700, roughness: 0.8 })));
      backing.position.copy(panel.position);
      backing.rotation.y = d.rot;
      backing.translateZ(-0.09);
      group.add(backing);
      const p = new THREE.BoxGeometry(0.25, 4.4, 0.25);
      p.translate(d.x, 2.2, z - 0.2);
      posts.push({ geo: p });
    }
    group.add(new THREE.Mesh(bin.add(mergeAll(posts)), postMat));
  }

  private lightPool(texture: THREE.Texture, color: number, w: number, d: number, opacity: number): THREE.Mesh {
    const geo = this.bin.add(new THREE.PlaneGeometry(w, d));
    geo.rotateX(-Math.PI / 2);
    const m = this.bin.add(new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Gas station beside the road at TRACK.gasStationZ: canopy, pumps, price pylon, shop. All of it stands outside the road (x > 21). */
  private buildGasStation(anisotropy: number): void {
    const { bin, group } = this;
    const z = TRACK.gasStationZ;
    const cx = 28;
    const dark = bin.add(new THREE.MeshStandardMaterial({ color: 0x2a3441, roughness: 0.7, metalness: 0.3 }));
    const bx = (w: number, h: number, d: number, x: number, y: number, zz: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, zz);
      return { geo: g };
    };
    const canopyParts = [bx(12, 0.4, 18, cx, 5.8, z), ...[-8, 0, 8].flatMap((dz) => [bx(0.5, 5.6, 0.5, cx - 5, 2.8, z + dz), bx(0.5, 5.6, 0.5, cx + 5, 2.8, z + dz)])];
    group.add(new THREE.Mesh(bin.add(mergeAll(canopyParts)), dark));
    // Glowing teal fascia and the bright underside
    const fascia = new THREE.Mesh(bin.add(new THREE.BoxGeometry(12.4, 0.8, 18.4)), bin.add(new THREE.MeshBasicMaterial({ color: PAL.signal })));
    fascia.position.set(cx, 6.2, z);
    group.add(fascia);
    const under = new THREE.Mesh(bin.add(new THREE.BoxGeometry(11.6, 0.06, 17.4)), bin.add(new THREE.MeshBasicMaterial({ color: 0xfff1d6 })));
    under.position.set(cx, 5.57, z);
    group.add(under);
    const pool = this.lightPool(bin.add(makeGlowTexture(1.3)), 0xfff1d6, 16, 22, 0.5);
    pool.position.set(cx, 0.2, z);
    group.add(pool);

    // Pumps on islands
    const pumpParts: { geo: THREE.BufferGeometry }[] = [];
    const screenParts: { geo: THREE.BufferGeometry }[] = [];
    for (const dz of [-6, 0, 6]) {
      pumpParts.push(bx(0.9, 1.6, 0.6, cx, 1.0, z + dz), bx(1.6, 0.18, 4.2, cx, 0.2, z + dz));
      screenParts.push(bx(0.5, 0.32, 0.04, cx - 0.4, 1.45, z + dz));
      screenParts.push(bx(0.5, 0.32, 0.04, cx + 0.4, 1.45, z + dz));
    }
    group.add(new THREE.Mesh(bin.add(mergeAll(pumpParts)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.lineBright, roughness: 0.5, metalness: 0.4 }))));
    // Pump faces point along the road: the screens face the camera side (-x faces the road).
    const screens = new THREE.Mesh(bin.add(mergeAll(screenParts)), bin.add(new THREE.MeshBasicMaterial({ color: PAL.verdict })));
    group.add(screens);

    // Convenience store
    const shop = new THREE.Mesh(bin.add(new THREE.BoxGeometry(12, 4.4, 9)), bin.add(new THREE.MeshStandardMaterial({ color: 0x2a3646, roughness: 0.85 })));
    shop.position.set(45, 2.2, z);
    group.add(shop);
    const frontTex = bin.add(makeStorefrontTexture());
    const front = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(10.5, 3.2)), bin.add(new THREE.MeshBasicMaterial({ map: frontTex })));
    front.position.set(38.98, 2.2, z);
    front.rotation.y = -Math.PI / 2;
    group.add(front);

    // Price pylon at the near end, easy to see from far down the road
    const pylonZ = z + 17;
    const pole = new THREE.Mesh(bin.add(new THREE.BoxGeometry(0.4, 9, 0.4)), dark);
    pole.position.set(23.4, 4.5, pylonZ);
    group.add(pole);
    const priceTex = bin.add(
      makeSignTexture(384, 512, hex(PAL.ink800), hex(PAL.signal), [
        { text: "GAS", size: 120, color: hex(PAL.signal), y: 90, weight: 800 },
        { text: "REG   3.49", size: 50, color: hex(PAL.text0), y: 205, weight: 700 },
        { text: "PLUS  3.79", size: 50, color: hex(PAL.text0), y: 270, weight: 700 },
        { text: "DIESEL  3.89", size: 50, color: hex(PAL.text0), y: 335, weight: 700 },
        { text: "QUICK CASH", size: 54, color: hex(PAL.verdict), y: 430, weight: 800 },
      ], anisotropy),
    );
    const priceMat = bin.add(new THREE.MeshBasicMaterial({ map: priceTex }));
    const price = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(3.3, 4.4)), priceMat);
    price.position.set(23.4, 10.6, pylonZ + 0.22);
    price.rotation.y = -0.18;
    group.add(price);
    const backing = new THREE.Mesh(bin.add(new THREE.BoxGeometry(3.5, 4.6, 0.3)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink700, roughness: 0.8 })));
    backing.position.set(23.4, 10.6, pylonZ);
    backing.rotation.y = -0.18;
    group.add(backing);
  }

  /** Checkered line across the whole road at TRACK.finishZ, with a gantry and banner on posts outside the road. */
  private buildFinish(anisotropy: number): void {
    const { bin, group } = this;
    const z = TRACK.finishZ;
    const checker = bin.add(makeCheckerTexture(40, 3, anisotropy));
    const strip = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(TRACK.halfWidth * 2, 3)), bin.add(new THREE.MeshBasicMaterial({ map: checker, color: 0xe6edf5, polygonOffset: true, polygonOffsetFactor: -2 })));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.04, z);
    group.add(strip);

    const steel = bin.add(new THREE.MeshStandardMaterial({ color: 0x3a4859, roughness: 0.6, metalness: 0.5 }));
    const bx = (w: number, h: number, d: number, x: number, y: number, zz: number) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, y, zz);
      return { geo: g };
    };
    group.add(
      new THREE.Mesh(
        bin.add(mergeAll([bx(0.9, 10, 0.9, -21.6, 5, z), bx(0.9, 10, 0.9, 21.6, 5, z), bx(44, 1.0, 1.0, 0, 9.5, z), bx(1.6, 0.5, 1.6, -21.6, 0.25, z), bx(1.6, 0.5, 1.6, 21.6, 0.25, z)])),
        steel,
      ),
    );
    const bannerTex = bin.add(
      makeSignTexture(1024, 256, hex(PAL.ink900), hex(PAL.text0), [{ text: "FINISH", size: 170, color: hex(PAL.text0), y: 135, weight: 800 }], anisotropy),
    );
    const banner = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(18, 4.5)), bin.add(new THREE.MeshBasicMaterial({ map: bannerTex })));
    banner.position.set(0, 6.5, z + 0.55);
    group.add(banner);
    const ban2 = new THREE.Mesh(bin.add(new THREE.BoxGeometry(18.4, 4.9, 0.2)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink700 })));
    ban2.position.set(0, 6.5, z + 0.4);
    group.add(ban2);
    const flagTex = bin.add(makeCheckerTexture(2, 8, anisotropy));
    const flagGeo = bin.add(new THREE.PlaneGeometry(1.6, 6.4));
    const flagMat = bin.add(new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    for (const x of [-20.6, 20.6]) {
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(x, 5.5, z + 0.6);
      group.add(flag);
    }
    const pool = this.lightPool(bin.add(makeGlowTexture(1.5)), 0xfff1d6, 44, 14, 0.25);
    pool.position.set(0, 0.06, z + 3);
    group.add(pool);
  }

  // ---------------------------------------------------------------- city dressing

  /** Street lamps with glow and a pool of light on the road. The back road (left side of the split) is deliberately unlit. */
  private buildLamps(glow: THREE.Texture): void {
    const { bin, group } = this;
    const poleGeo = bin.add(buildLampPoleGeometry());
    const headGeo = bin.add(buildLampHeadGeometry());
    const poleMat = bin.add(new THREE.MeshStandardMaterial({ color: 0x26303d, roughness: 0.6, metalness: 0.5 }));
    const headMat = bin.add(new THREE.MeshBasicMaterial({ color: PAL.lampWarm }));
    const lamps: { side: number; z: number }[] = [];
    for (let z = WORLD.zNear - 10; z > WORLD.zFar + 10; z -= 30) {
      lamps.push({ side: 1, z });
      const darkRoad = z < TRACK.laneSplitStartZ + 10 && z > TRACK.laneSplitEndZ - 10;
      if (!darkRoad) lamps.push({ side: -1, z: z - 15 });
      else lamps.push({ side: 1, z: z - 15 });
    }
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
    lamps.forEach((l, i) => {
      // The pole's arm reaches toward -x, so left-hand lamps are turned around.
      place(poles, i, l.side * 22.6, 0.16, l.z, 1, 1, 1, l.side > 0 ? 0 : Math.PI);
      place(heads, i, l.side * 22.6, 0.16, l.z, 1, 1, 1, l.side > 0 ? 0 : Math.PI);
    });
    group.add(poles, heads);

    // Flares: one additive Points object (one draw call)
    const positions = new Float32Array(lamps.length * 3);
    lamps.forEach((l, i) => {
      positions[i * 3] = l.side * 20.7;
      positions[i * 3 + 1] = 8.0;
      positions[i * 3 + 2] = l.z;
    });
    const glowGeo = bin.add(new THREE.BufferGeometry());
    glowGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const glowPts = new THREE.Points(glowGeo, bin.add(new THREE.PointsMaterial({ map: glow, color: 0xffcf90, size: 7, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    glowPts.frustumCulled = false;
    group.add(glowPts);

    // Pools of light on the road under each lamp
    const poolGeo = bin.add(new THREE.PlaneGeometry(1, 1));
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = bin.add(new THREE.MeshBasicMaterial({ map: glow, color: 0xffc58a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }));
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, lamps.length);
    lamps.forEach((l, i) => place(pools, i, l.side * 16.5, 0.045, l.z, 17, 1, 17));
    pools.renderOrder = 2;
    group.add(pools);
  }

  private buildTrees(): void {
    const { bin, group } = this;
    const { trunk, crown } = buildTreeGeometries();
    bin.add(trunk);
    bin.add(crown);
    const trunkMat = bin.add(new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }));
    const crownMat = bin.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }));
    const rnd = mulberry32(41);
    const trees: Inst[] = [];
    for (let z = WORLD.zNear - 4; z > WORLD.zFar; z -= 11 + rnd() * 9) {
      for (const side of [1, -1]) {
        if (rnd() < 0.25) continue;
        const s = 0.8 + rnd() * 0.6;
        trees.push({ x: side * (26.2 + rnd() * 1.6), y: 0.16, z, sx: s, sy: s, sz: s, ry: rnd() * 6, color: [0x1f4a44, 0x24574b, 0x1b3f3f, 0x2a5a4c][Math.floor(rnd() * 4)] });
      }
    }
    const trunkMesh = new THREE.InstancedMesh(trunk, trunkMat, trees.length);
    const crownMesh = new THREE.InstancedMesh(crown, crownMat, trees.length);
    shuffle(trees, rnd).forEach((t, i) => {
      place(trunkMesh, i, t.x, t.y, t.z, t.sx, t.sy, t.sz, t.ry);
      place(crownMesh, i, t.x, t.y, t.z, t.sx, t.sy, t.sz, t.ry);
      crownMesh.setColorAt(i, _c.setHex(t.color ?? PAL.foliage));
    });
    group.add(trunkMesh, crownMesh);
    this.reducible.push({ mesh: trunkMesh, full: trees.length }, { mesh: crownMesh, full: trees.length });
  }

  private buildBillboards(anisotropy: number): void {
    const { bin, group } = this;
    const defs = [
      { x: -34, z: -26, rot: 0.42, lines: [{ text: "DELLEGATE", size: 120, color: hex(PAL.signal), y: 90, weight: 800 }, { text: "Delegate the research. Own the decision.", size: 36, color: hex(PAL.text0), y: 175, weight: 500 }], border: hex(PAL.signal) },
      { x: 35, z: -150, rot: -0.42, lines: [{ text: "OPEN ROAD", size: 120, color: hex(PAL.verdict), y: 90, weight: 800 }, { text: "the long way round, or the fast way", size: 38, color: hex(PAL.text0), y: 175, weight: 500 }], border: hex(PAL.verdict) },
      { x: -36, z: -280, rot: 0.42, lines: [{ text: "THE LONG HAUL", size: 100, color: hex(PAL.text0), y: 95, weight: 800 }, { text: "nearly there", size: 44, color: hex(PAL.signal), y: 178, weight: 600 }], border: hex(PAL.lineBright) },
    ];
    const postParts: { geo: THREE.BufferGeometry }[] = [];
    for (const d of defs) {
      const tex = bin.add(makeSignTexture(768, 288, hex(PAL.ink900), d.border, d.lines, anisotropy));
      const w = 14;
      const h = (w * 288) / 768;
      const panel = new THREE.Mesh(bin.add(new THREE.PlaneGeometry(w, h)), bin.add(new THREE.MeshBasicMaterial({ map: tex })));
      panel.position.set(d.x, 10, d.z);
      panel.rotation.y = d.rot;
      group.add(panel);
      const frame = new THREE.Mesh(bin.add(new THREE.BoxGeometry(w + 0.5, h + 0.5, 0.3)), bin.add(new THREE.MeshStandardMaterial({ color: PAL.ink700, roughness: 0.8 })));
      frame.position.copy(panel.position);
      frame.rotation.y = d.rot;
      frame.translateZ(-0.18);
      group.add(frame);
      for (const off of [-4, 4]) {
        const p = new THREE.BoxGeometry(0.4, 8, 0.4);
        const dx = Math.cos(d.rot) * off;
        const dz = -Math.sin(d.rot) * off;
        p.translate(d.x + dx, 4, d.z + dz - 0.3);
        postParts.push({ geo: p });
      }
    }
    group.add(new THREE.Mesh(bin.add(mergeAll(postParts)), bin.add(new THREE.MeshStandardMaterial({ color: 0x26303d, roughness: 0.7, metalness: 0.4 }))));
  }

  /** Low-poly city: instanced buildings (a few archetype sizes, each its own InstancedMesh) with lit-window textures, rooftop clutter and tower beacons. */
  private buildCity(glow: THREE.Texture, anisotropy: number): THREE.PointsMaterial {
    const { bin, group } = this;
    const { diffuse, emissive } = makeFacadeTextures(anisotropy);
    bin.add(diffuse);
    emissive.forEach((e) => bin.add(e));
    const mats = emissive.map((em) => bin.add(new THREE.MeshStandardMaterial({ color: 0xffffff, map: diffuse, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: 1.0, roughness: 0.85, metalness: 0.05 })));

    const widths = [9.6, 12.8, 16];
    const heights = [12.8, 22.4, 32, 44.8, 64, 96];
    const rnd = mulberry32(2026);
    const tints = [0x3a4c64, 0x2f4056, 0x44586f, 0x2a394d, 0x4a5d78, 0x35465c, 0x4a4a58];
    const buckets = new Map<string, Inst[]>();
    const roofs: Inst[] = [];
    const beaconPts: number[] = [];

    interface Row {
      inner: number;
      heights: number[];
      gapMin: number;
      gapMax: number;
      widthPick: number[];
    }
    const rows: Row[] = [
      { inner: 31, heights: [0, 0, 1, 1, 2], gapMin: 1.5, gapMax: 6, widthPick: [0, 1, 1, 2] },
      { inner: 60, heights: [1, 2, 2, 3, 3, 4], gapMin: 2, gapMax: 9, widthPick: [1, 2, 2] },
      { inner: 104, heights: [3, 4, 4, 5], gapMin: 3, gapMax: 14, widthPick: [1, 2, 2] },
    ];
    const blocked = (side: number, row: number, z: number, half: number): boolean => {
      if (row === 0 && side > 0 && z - half < TRACK.gasStationZ + 24 && z + half > TRACK.gasStationZ - 24) return true; // gas station
      if (row === 0 && side < 0 && z - half < -12 && z + half > -42) return true; // first billboard
      if (row <= 1 && side > 0 && z - half < -138 && z + half > -164) return true;
      if (row <= 1 && side < 0 && z - half < -268 && z + half > -296) return true;
      return false;
    };
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx];
      for (const side of [1, -1]) {
        let z = WORLD.zNear + 25;
        let sinceGap = 0;
        while (z > WORLD.zFar - 40) {
          const wi = row.widthPick[Math.floor(rnd() * row.widthPick.length)];
          const hi = row.heights[Math.floor(rnd() * row.heights.length)];
          const w = widths[wi];
          const zc = z - w / 2;
          const xc = side * (row.inner + w / 2 + rnd() * 3 + (rowIdx > 0 ? rnd() * 10 : 0));
          if (!blocked(side, rowIdx, zc, w / 2)) {
            const key = `${wi}-${hi}`;
            if (!buckets.has(key)) buckets.set(key, []);
            const tint = tints[Math.floor(rnd() * tints.length)];
            buckets.get(key)!.push({ x: xc, y: 0, z: zc, sx: 1, sy: 1, sz: 1, ry: rnd() < 0.5 ? 0 : Math.PI, color: tint });
            const H = heights[hi];
            if (rnd() < 0.55) roofs.push({ x: xc + (rnd() - 0.5) * w * 0.4, y: H, z: zc + (rnd() - 0.5) * w * 0.4, sx: 1.6 + rnd() * 2.2, sy: 0.7 + rnd() * 1.1, sz: 1.6 + rnd() * 2, ry: rnd() * 3, color: 0x232d3a });
            if (H >= 64) beaconPts.push(xc, H + 1.3, zc);
          }
          z -= w + row.gapMin + rnd() * (row.gapMax - row.gapMin);
          sinceGap++;
          if (sinceGap > 3 + Math.floor(rnd() * 4)) {
            z -= 10 + rnd() * 8; // a cross street
            sinceGap = 0;
          }
        }
      }
    }
    let variant = 0;
    for (const [key, list] of buckets) {
      const [wi, hi] = key.split("-").map(Number);
      const w = widths[wi];
      const geo = bin.add(buildBuildingGeometry(w, heights[hi], w));
      const mesh = new THREE.InstancedMesh(geo, mats[variant++ % mats.length], list.length);
      shuffle(list, rnd).forEach((b, i) => {
        place(mesh, i, b.x, 0, b.z, 1, 1, 1, b.ry);
        mesh.setColorAt(i, _c.setHex(b.color ?? 0x3a4c64));
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      this.reducible.push({ mesh, full: list.length });
    }
    // Rooftop machinery
    const roofGeo = bin.add(new THREE.BoxGeometry(1, 1, 1));
    roofGeo.translate(0, 0.5, 0);
    const roofMesh = new THREE.InstancedMesh(roofGeo, bin.add(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })), roofs.length);
    roofs.forEach((r, i) => {
      place(roofMesh, i, r.x, r.y, r.z, r.sx, r.sy, r.sz, r.ry);
      roofMesh.setColorAt(i, _c.setHex(r.color ?? 0x232d3a));
    });
    group.add(roofMesh);

    // Red aircraft beacons on the tallest towers
    const beaconGeo = bin.add(new THREE.BufferGeometry());
    beaconGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beaconPts), 3));
    const beaconMat = bin.add(new THREE.PointsMaterial({ map: glow, color: PAL.danger, size: 9, sizeAttenuation: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const beacons = new THREE.Points(beaconGeo, beaconMat);
    beacons.frustumCulled = false;
    group.add(beacons);
    return beaconMat;
  }

  // ---------------------------------------------------------------- runtime

  /** Called every frame. `camera` keeps the sky sphere centred on the viewer. */
  update(dt: number, timeSeconds: number, camera: THREE.Camera): void {
    this.sky.position.copy(camera.position);
    if (this.tollFlash > 0) {
      this.tollFlash = Math.max(0, this.tollFlash - dt * 1.6);
      // flash the sign amber, then settle back to normal
      this.tollSignMaterial.color.setRGB(1, 1 - 0.45 * this.tollFlash, 1 - 0.8 * this.tollFlash);
    }
    this.beaconMaterial.opacity = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(timeSeconds * 2.2));
  }

  /** The toll gantry sign blinks when the toll is charged. */
  flashToll(): void {
    this.tollFlash = 1;
  }

  /** Quick fallback for slow machines: fewer buildings and trees. */
  setLowQuality(low: boolean): void {
    if (this.lowQuality === low) return;
    this.lowQuality = low;
    for (const r of this.reducible) r.mesh.count = low ? Math.max(1, Math.ceil(r.full * 0.45)) : r.full;
  }

  get isLowQuality(): boolean {
    return this.lowQuality;
  }
}

export { FACADE, FOG_NEAR, FOG_FAR };
