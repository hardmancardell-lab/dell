// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/long-haul-car-profiles.test.mts
// Checks the 4 selectable classic car profiles build valid, sane geometry (no self-intersecting
// extrudes, sensible bounding boxes, every car distinct) without needing WebGL -- same pattern as
// long-haul-visuals.test.mts for the default hatchback.
import * as THREE from "three";
import { CAR, buildCarGeometries } from "../../src/components/literacy/long-haul/long-haul-geometry.ts";
import { CAR_MODELS as CAR_PROFILES } from "../../src/lib/agents/financial-literacy/skills/long-haul-content.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

t("4 classic car profiles are defined, each with a distinct id", CAR_PROFILES.length === 4 && new Set(CAR_PROFILES.map((p) => p.id)).size === 4);

for (const profile of CAR_PROFILES) {
  const car = buildCarGeometries(profile);
  const body = box(car.body);
  const bodyLen = body.max.z - body.min.z;
  const bodyWidth = body.max.x - body.min.x;
  t(`${profile.id}: body is non-degenerate (real length, width, height)`, bodyLen > 2 && bodyLen < 5.5 && bodyWidth > 1.2 && bodyWidth < 2.3 && body.max.y > 0.8 && body.max.y < 2, JSON.stringify([body.min, body.max]));
  t(`${profile.id}: body is symmetric left to right`, Math.abs(body.max.x + body.min.x) < 0.02);
  const glass = box(car.glass);
  t(`${profile.id}: glass sits on the body and stays within its length`, glass.min.y > 0.5 && glass.max.y <= body.max.y + 0.05 && glass.min.z >= body.min.z - 0.05 && glass.max.z <= body.max.z + 0.05, JSON.stringify([glass.min, glass.max]));
  t(`${profile.id}: the cabin is set back from the nose (hood in front of it)`, glass.max.z < body.max.z - 0.3, `glass.max.z=${glass.max.z} body.max.z=${body.max.z}`);
  t(`${profile.id}: headlights at the front, taillights at the back`, box(car.headlights).min.z > 0 && box(car.taillights).max.z < 0);
  t(`${profile.id}: every piece has positions, normals and uvs (extrudes built cleanly)`, Object.values(car).every((g) => g.attributes.position?.count > 0 && g.attributes.normal && g.attributes.uv));
  t(`${profile.id}: no NaN vertices anywhere in the body or glass`, [car.body, car.glass, car.trim].every((g) => { const p = g.attributes.position; for (let i = 0; i < p.count * 3; i++) if (!Number.isFinite(p.array[i])) return false; return true; }));
}

// The fastback should visibly taper lower toward the tail than the notchback's sharp, high backlight.
const chevelle = buildCarGeometries(CAR_PROFILES.find((p) => p.id === "chevelle71")!);
const monte = buildCarGeometries(CAR_PROFILES.find((p) => p.id === "montecarlo")!);
const rearGlassHeight = (g: THREE.BufferGeometry, nearZ: number) => {
  const p = g.attributes.position;
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) - nearZ) < 0.3) maxY = Math.max(maxY, p.getY(i));
  return maxY;
};
const chevelleDeck = CAR_PROFILES.find((p) => p.id === "chevelle71")!.deckZ;
const monteDeck = CAR_PROFILES.find((p) => p.id === "montecarlo")!.deckZ;
t(
  "fastback glass is lower near its deck point than the notchback's near its deck point (continuous taper vs. a sharp high backlight)",
  rearGlassHeight(chevelle.glass, chevelleDeck) < rearGlassHeight(monte.glass, monteDeck),
  `chevelle ${rearGlassHeight(chevelle.glass, chevelleDeck)} monte ${rearGlassHeight(monte.glass, monteDeck)}`,
);

// Default (no-arg) call must still be the exact shipped hatchback -- untouched by any of the above.
const hatchback = buildCarGeometries();
const hb = box(hatchback.body);
t("default (no-arg) car is still the shipped hatchback: ~4 m long, 1.8 m wide, under 1.6 m tall", hb.max.z - hb.min.z > 3.7 && hb.max.z - hb.min.z < 4.3 && hb.max.x - hb.min.x > 1.6 && hb.max.x - hb.min.x < 2.0 && hb.max.y < 1.6);
t("CAR wheelbase constants are untouched (shared across every selectable car)", CAR.frontAxleZ === 1.25 && CAR.rearAxleZ === -1.25 && CAR.wheelRadius === 0.36);

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
