import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PAL } from "./long-haul-palette";

/**
 * Procedural geometry for "The Long Haul". Nothing here touches the DOM or WebGL, so it runs (and is unit tested) in plain Node.
 * Local car space: +z is forward, +y is up, the car is symmetric in x. Dimensions are in metres.
 */

/** Collects everything that needs `dispose()` so the engine can free every geometry, material and texture, and stay idempotent. */
export class ResourceBin {
  private items = new Set<{ dispose(): void }>();
  add<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    return item;
  }
  get size(): number {
    return this.items.size;
  }
  disposeAll(): void {
    for (const item of this.items) {
      try {
        item.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.items.clear();
  }
}

/** Dispose everything under an object (geometries, materials, the textures the materials hold, instanced buffers). Safe to call twice. */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh & { isInstancedMesh?: boolean };
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) disposeMaterial(m);
    if (mesh.isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).dispose();
  });
}

export function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
  }
  m.dispose();
}

// ---------- small helpers ----------

function ensureAttrs(g: THREE.BufferGeometry, withColor: boolean, colorHex?: number): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out === g) out = g.clone();
  for (const name of Object.keys(out.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv" && name !== "color") out.deleteAttribute(name);
  }
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  if (withColor) {
    const count = out.attributes.position.count;
    const arr = new Float32Array(count * 3);
    const c = new THREE.Color(colorHex ?? 0xffffff);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    out.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  }
  return out;
}

/** Merge geometries into one (normalising index/attributes). Returns a fresh geometry; the inputs are disposed. */
export function mergeAll(parts: { geo: THREE.BufferGeometry; color?: number }[], withColor = false): THREE.BufferGeometry {
  const prepared = parts.map((p) => ensureAttrs(p.geo, withColor, p.color));
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error("mergeAll: geometries are not compatible");
  for (const p of parts) p.geo.dispose();
  for (const p of prepared) p.dispose();
  return merged;
}

function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** A box oriented between two points in the y-z plane (for pillars and bars), centred on x. */
function bar(thickX: number, thickT: number, y0: number, z0: number, y1: number, z1: number, x = 0): THREE.BufferGeometry {
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dy, dz);
  const g = new THREE.BoxGeometry(thickX, len, thickT);
  g.rotateX(Math.atan2(dz, dy));
  g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

/** Extrude a side profile (shape x = forward z, shape y = up) across `width` along the car's x axis, with a small rounded edge. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const t = Math.min(bevel, width / 2 - 0.001);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - 2 * t),
    bevelEnabled: bevel > 0,
    bevelThickness: t,
    bevelSize: bevel * 0.6,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, -(width - 2 * t) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> local +z (forward), extrusion z -> local x
  return g;
}

function poly(points: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

// ---------- the car ----------

export const CAR = {
  length: 4.0,
  width: 1.8,
  height: 1.47,
  wheelRadius: 0.36,
  wheelWidth: 0.27,
  wheelX: 0.8,
  frontAxleZ: 1.25,
  rearAxleZ: -1.25,
  hitchZ: -1.95,
};

export interface CarGeometries {
  /** Teal clear-coat body: lower body, roof, pillars. */
  body: THREE.BufferGeometry;
  /** Dark glass of the cabin. */
  glass: THREE.BufferGeometry;
  /** Dark trim: bumpers, skirts, wheel arches, grille, mirrors, spoiler. */
  trim: THREE.BufferGeometry;
  headlights: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  /** One wheel: tyre, dark rim, five bright spokes and a hub cap, with vertex colours, centred on its axle, axis along x. */
  wheel: THREE.BufferGeometry;
}

export function buildWheelGeometry(radius = CAR.wheelRadius, width = CAR.wheelWidth): THREE.BufferGeometry {
  const parts: { geo: THREE.BufferGeometry; color: number }[] = [];
  const tyre = new THREE.CylinderGeometry(radius, radius, width, 24, 1);
  tyre.rotateZ(Math.PI / 2);
  parts.push({ geo: tyre, color: PAL.tyre });
  const rimR = radius * 0.68;
  const rim = new THREE.CylinderGeometry(rimR, rimR, width + 0.015, 20, 1);
  rim.rotateZ(Math.PI / 2);
  parts.push({ geo: rim, color: 0x2b333d });
  for (let k = 0; k < 5; k++) {
    const spoke = new THREE.BoxGeometry(width + 0.03, rimR * 0.2, rimR * 0.95);
    spoke.translate(0, 0, rimR * 0.5);
    spoke.rotateX((k * Math.PI * 2) / 5);
    parts.push({ geo: spoke, color: 0xcfd8e2 });
  }
  const cap = new THREE.CylinderGeometry(rimR * 0.2, rimR * 0.2, width + 0.04, 10, 1);
  cap.rotateZ(Math.PI / 2);
  parts.push({ geo: cap, color: PAL.paint });
  return mergeAll(parts, true);
}

export function buildCarGeometries(): CarGeometries {
  // Lower body: nose, long hood, shoulder line, short tail, rounded corners. (shape x = z forward, y = height)
  const lower = new THREE.Shape();
  lower.moveTo(-1.8, 0.3);
  lower.lineTo(1.72, 0.3);
  lower.quadraticCurveTo(1.93, 0.3, 1.94, 0.5);
  lower.quadraticCurveTo(1.95, 0.66, 1.84, 0.72);
  lower.lineTo(0.82, 0.9);
  lower.lineTo(-1.1, 0.93);
  lower.lineTo(-1.74, 0.96);
  lower.quadraticCurveTo(-1.92, 0.94, -1.93, 0.76);
  lower.lineTo(-1.92, 0.52);
  lower.quadraticCurveTo(-1.92, 0.3, -1.8, 0.3);
  const lowerGeo = extrudeProfile(lower, CAR.width - 0.04, 0.07);

  // Roof slab over the glass (slightly proud of it so the glass reads as recessed).
  const roof = poly([[0.3, 1.37], [0.26, 1.45], [-1.0, 1.47], [-1.06, 1.39]]);
  const roofGeo = extrudeProfile(roof, 1.5, 0.04);

  // Pillars in body colour so the cabin does not read as one glass bubble.
  const aL = bar(0.07, 0.1, 0.9, 0.83, 1.4, 0.28, 0.76);
  const aR = bar(0.07, 0.1, 0.9, 0.83, 1.4, 0.28, -0.76);
  const bL = bar(0.07, 0.1, 0.9, -0.28, 1.4, -0.3, 0.77);
  const bR = bar(0.07, 0.1, 0.9, -0.28, 1.4, -0.3, -0.77);
  const cL = bar(0.1, 0.16, 1.42, -1.04, 0.96, -1.6, 0.74);
  const cR = bar(0.1, 0.16, 1.42, -1.04, 0.96, -1.6, -0.74);
  const body = mergeAll([lowerGeo, roofGeo, aL, aR, bL, bR, cL, cR].map((geo) => ({ geo })));

  // Glass: narrower than the body (tumblehome), with the hatch slope at the back.
  const glassShape = poly([[0.85, 0.89], [0.28, 1.4], [-1.02, 1.42], [-1.62, 0.95], [-1.4, 0.9]]);
  const glass = extrudeProfile(glassShape, 1.58, 0.02);

  // Trim: bumpers/splitter, skirts, arches, grille, mirrors, rear spoiler.
  const trimParts: THREE.BufferGeometry[] = [
    box(1.74, 0.14, 0.34, 0, 0.34, 1.88), // front splitter / bumper lip
    box(1.7, 0.16, 0.22, 0, 0.36, -1.9), // rear diffuser
    box(0.06, 0.12, 2.4, 0.9, 0.34, 0), // skirts
    box(0.06, 0.12, 2.4, -0.9, 0.34, 0),
    box(1.1, 0.13, 0.05, 0, 0.58, 1.96), // grille
    box(0.16, 0.1, 0.22, 0.97, 0.98, 0.6), // mirrors
    box(0.16, 0.1, 0.22, -0.97, 0.98, 0.6),
    box(1.46, 0.045, 0.26, 0, 1.5, -1.12), // roof-end spoiler
    box(0.04, 0.12, 0.26, 0.74, 1.46, -1.12),
    box(0.04, 0.12, 0.26, -0.74, 1.46, -1.12),
    box(0.34, 0.1, 0.03, 0, 0.62, -1.945), // plate
  ];
  // Dark discs on the body sides behind each wheel read as wheel arches.
  for (const sx of [1, -1]) {
    for (const z of [CAR.frontAxleZ, CAR.rearAxleZ]) {
      const arch = new THREE.CircleGeometry(CAR.wheelRadius + 0.1, 20);
      arch.rotateY(sx * Math.PI / 2);
      arch.translate(sx * 0.915, CAR.wheelRadius, z);
      trimParts.push(arch);
    }
  }
  const trim = mergeAll(trimParts.map((geo) => ({ geo })));

  const headlights = mergeAll([
    { geo: box(0.4, 0.1, 0.07, 0.62, 0.72, 1.91) },
    { geo: box(0.4, 0.1, 0.07, -0.62, 0.72, 1.91) },
  ]);
  const taillights = mergeAll([
    { geo: box(0.44, 0.13, 0.06, 0.62, 0.84, -1.935) },
    { geo: box(0.44, 0.13, 0.06, -0.62, 0.84, -1.935) },
    { geo: box(0.7, 0.05, 0.05, 0, 0.88, -1.945) },
  ]);

  return { body, glass, trim, headlights, taillights, wheel: buildWheelGeometry() };
}

export interface TrailerGeometries {
  /** Dark steel bed, rails, drawbar, fenders. */
  frame: THREE.BufferGeometry;
  /** Tarp-covered load (amber). */
  load: THREE.BufferGeometry;
  /** Straps across the load. */
  straps: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  wheel: THREE.BufferGeometry;
}

/** The loan trailer in its own space: the hitch is the origin, the trailer extends toward -z. */
export const TRAILER_DIMS = { bedZ: -2.55, bedLength: 2.5, bedWidth: 1.6, wheelX: 0.86, wheelZ: -2.55, wheelRadius: 0.3 };

export function buildTrailerGeometries(): TrailerGeometries {
  const { bedZ, bedLength, bedWidth } = TRAILER_DIMS;
  const front = bedZ + bedLength / 2;
  const back = bedZ - bedLength / 2;
  const frame = mergeAll(
    [
      box(bedWidth, 0.1, bedLength, 0, 0.52, bedZ),
      box(0.12, 0.08, Math.abs(front) + 0.2, 0, 0.5, front / 2 - 0.1), // drawbar
      box(0.12, 0.14, 0.12, 0, 0.58, 0.02), // hitch coupler
      box(0.05, 0.3, bedLength, bedWidth / 2 - 0.025, 0.72, bedZ), // side rails
      box(0.05, 0.3, bedLength, -bedWidth / 2 + 0.025, 0.72, bedZ),
      box(bedWidth, 0.3, 0.05, 0, 0.72, front - 0.025), // headboard
      box(bedWidth, 0.2, 0.05, 0, 0.67, back + 0.025), // tail gate
      box(0.16, 0.05, TRAILER_DIMS.wheelRadius * 2 + 0.3, 0.84, 0.66, TRAILER_DIMS.wheelZ), // fenders
      box(0.16, 0.05, TRAILER_DIMS.wheelRadius * 2 + 0.3, -0.84, 0.66, TRAILER_DIMS.wheelZ),
    ].map((geo) => ({ geo })),
  );
  const loadShape = new THREE.Shape();
  loadShape.moveTo(-0.72, 0);
  loadShape.lineTo(0.72, 0);
  loadShape.lineTo(0.7, 0.55);
  loadShape.quadraticCurveTo(0.6, 0.78, 0.0, 0.8);
  loadShape.quadraticCurveTo(-0.6, 0.78, -0.7, 0.55);
  loadShape.closePath();
  const loadGeo = new THREE.ExtrudeGeometry(loadShape, { depth: bedLength - 0.4, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 });
  loadGeo.translate(0, 0.58, bedZ - (bedLength - 0.4) / 2);
  const load = mergeAll([{ geo: loadGeo }]);
  // Straps: thin slices of the same cross-section, a little bigger than the load, so they hug its curve.
  const strapSlices = [-0.6, 0, 0.6].map((dz) => {
    const slice = new THREE.ExtrudeGeometry(loadShape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.085, bevelSegments: 1, curveSegments: 8 });
    slice.translate(0, 0.58, bedZ + dz - 0.035);
    return { geo: slice };
  });
  const straps = mergeAll(strapSlices);
  const taillights = mergeAll([
    { geo: box(0.2, 0.1, 0.05, 0.66, 0.74, back - 0.01) },
    { geo: box(0.2, 0.1, 0.05, -0.66, 0.74, back - 0.01) },
  ]);
  return { frame, load, straps, taillights, wheel: buildWheelGeometry(TRAILER_DIMS.wheelRadius, 0.22) };
}

// ---------- the city ----------

/** Window grid used by the facade textures: one cell is CELL metres square, the texture holds COLS x ROWS cells. */
export const FACADE = { cell: 3.2, cols: 8, rows: 8 };
/** UV (in the first cell's wall margin) used for roofs and undersides so they never show a window. */
export const WALL_UV = 0.004;

/** A building box with its base on y = 0 and facade UVs scaled to real size, so windows stay the same size on every building. */
export function buildBuildingGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const spanU = [d, d, 0, 0, w, w]; // px, nx, py, ny, pz, nz
  for (let face = 0; face < 6; face++) {
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      if (face === 2 || face === 3) {
        uv.setXY(idx, WALL_UV, WALL_UV);
      } else {
        const u = uv.getX(idx);
        const v = uv.getY(idx);
        uv.setXY(idx, u * (spanU[face] / (FACADE.cell * FACADE.cols)), v * (h / (FACADE.cell * FACADE.rows)));
      }
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** A jersey-style road barrier, `length` long, centred on z = 0, base on y = 0, about 0.85 m tall. */
export function buildBarrierGeometry(length: number): THREE.BufferGeometry {
  const s = poly([[-0.35, 0], [0.35, 0], [0.22, 0.34], [0.13, 0.85], [-0.13, 0.85], [-0.22, 0.34]]);
  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false });
  g.translate(0, 0, -length / 2);
  return g;
}

/** Street lamp pole with its arm reaching toward -x (the road side for a lamp on the right of the road). Head is separate (emissive). */
export function buildLampPoleGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.07, 0.12, 8, 6);
  pole.translate(0, 4, 0);
  const arm = box(2.0, 0.09, 0.09, -1.0, 7.95, 0);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 6);
  base.translate(0, 0.25, 0);
  return mergeAll([{ geo: pole }, { geo: arm }, { geo: base }]);
}

export function buildLampHeadGeometry(): THREE.BufferGeometry {
  return box(0.9, 0.12, 0.34, -1.85, 7.86, 0);
}

export function buildTreeGeometries(): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, 2.6, 5);
  trunk.translate(0, 1.3, 0);
  // Two stacked rough balls read as a stylised tree crown.
  const a = new THREE.IcosahedronGeometry(1.7, 0);
  a.translate(0, 3.5, 0);
  const b = new THREE.IcosahedronGeometry(1.2, 0);
  b.translate(0.3, 4.8, 0.2);
  return { trunk: mergeAll([{ geo: trunk }]), crown: mergeAll([{ geo: a }, { geo: b }]) };
}

/** Traffic cone with a white band, vertex-coloured (amber and white). */
export function buildConeGeometry(): THREE.BufferGeometry {
  const cone = new THREE.CylinderGeometry(0.06, 0.2, 0.7, 8);
  cone.translate(0, 0.45, 0);
  const band = new THREE.CylinderGeometry(0.115, 0.14, 0.12, 8);
  band.translate(0, 0.48, 0);
  const foot = box(0.46, 0.05, 0.46, 0, 0.025, 0);
  return mergeAll([{ geo: cone, color: PAL.verdict }, { geo: band, color: PAL.paint }, { geo: foot, color: PAL.ink700 }], true);
}

/** Flexible lane-divider post: white with an amber reflector band. */
export function buildFlexPostGeometry(): THREE.BufferGeometry {
  const post = new THREE.CylinderGeometry(0.035, 0.05, 0.95, 6);
  post.translate(0, 0.475, 0);
  const band = new THREE.CylinderGeometry(0.052, 0.058, 0.18, 6);
  band.translate(0, 0.68, 0);
  return mergeAll([{ geo: post, color: PAL.paint }, { geo: band, color: PAL.verdict }], true);
}
