// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/long-haul-visuals.test.mts
// The Long Haul's look and feel: pure feel maths, the frame-time fallback, procedural geometry (runs in plain Node, no WebGL),
// resource disposal, and source guards for the rules that must not change (track numbers, no per-frame allocation, reduced motion).
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FEEL, fovForSpeed, shakeAmplitude, wheelSpinDelta, steerYaw, bodyRoll, bodyPitch, approach, roughNoise, FrameBudget } from "../../src/components/literacy/long-haul/long-haul-feel.ts";
import { CAR, FACADE, WALL_UV, ResourceBin, disposeObject3D, buildCarGeometries, buildTrailerGeometries, buildBuildingGeometry, buildBarrierGeometry, buildWheelGeometry } from "../../src/components/literacy/long-haul/long-haul-geometry.ts";
import { TRACK, VEHICLE, TRAILER, ECONOMY } from "../../src/lib/agents/financial-literacy/skills/long-haul-content.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

// ---- feel maths
t("FOV widens with speed", fovForSpeed(1, false) > fovForSpeed(0.5, false) && fovForSpeed(0.5, false) > fovForSpeed(0, false));
t("FOV at rest is the base and never exceeds base + boost", fovForSpeed(0, false) === FEEL.baseFov && fovForSpeed(5, false) <= FEEL.baseFov + FEEL.maxFovBoost + 1e-9);
t("reduced motion: no FOV change", fovForSpeed(1, true) === FEEL.baseFov);
t("FOV survives NaN", fovForSpeed(NaN, false) === FEEL.baseFov);
t("shake only on the dirt lane and grows with speed", shakeAmplitude(0.8, false, false) === 0 && shakeAmplitude(0.8, true, false) > shakeAmplitude(0.3, true, false) && shakeAmplitude(0, true, false) === 0);
t("reduced motion: no shake", shakeAmplitude(1, true, true) === 0);
t("wheels spin forward with speed, none at rest, NaN-safe", wheelSpinDelta(10, 0.1, 0.36) > 0 && wheelSpinDelta(0, 0.1, 0.36) === 0 && wheelSpinDelta(NaN, 0.1, 0.36) === 0 && wheelSpinDelta(-5, 0.1, 0.36) < 0);
t("front wheels steer a few degrees: right input yaws right (negative local), within the limit", steerYaw(1) < 0 && steerYaw(-1) > 0 && Math.abs(steerYaw(1)) <= 0.4 && Math.abs(steerYaw(1)) * 180 / Math.PI > 5 && steerYaw(0) === 0);
t("body leans more with speed and not at all when straight", Math.abs(bodyRoll(1, 1)) > Math.abs(bodyRoll(1, 0.3)) && bodyRoll(0, 1) === 0 && Math.abs(bodyRoll(1, 1)) <= FEEL.maxRoll + 1e-9);
t("body pitches nose up under power, nose down braking", bodyPitch(1) < 0 && bodyPitch(-1) > 0 && bodyPitch(0) === 0);
t("approach moves toward the target without overshooting and ignores bad dt", (() => { const a = approach(0, 1, 5, 0.1); return a > 0 && a < 1 && approach(0.3, 1, 5, NaN) === 0.3 && approach(0.3, 1, 5, 0) === 0.3; })());
t("road noise is bounded", (() => { for (let i = 0; i < 2000; i++) if (Math.abs(roughNoise(i * 0.013, 1.1)) > 1.0001) return false; return true; })());

// ---- the low-quality fallback: average above 25 ms for two seconds
const feed = (b: FrameBudget, ms: number, seconds: number) => { let tripped = false; for (let i = 0; i < Math.ceil((seconds * 1000) / ms); i++) if (b.push(ms)) tripped = true; return tripped; };
t("60 fps never trips the fallback", !feed(new FrameBudget(25, 2000, 250, 0), 16.7, 10));
t("40 fps (25 ms) does not trip (not above the limit)", !feed(new FrameBudget(25, 2000, 250, 0), 25, 10));
t("30 fps for two seconds trips it", feed(new FrameBudget(25, 2000, 250, 0), 33, 2.5));
t("a slow stretch shorter than the window does not trip it", (() => { const b = new FrameBudget(25, 2000, 250, 0); let tr = feed(b, 40, 1.2); tr = feed(b, 10, 1) || tr; return !tr; })());
t("it trips only once", (() => { const b = new FrameBudget(25, 2000, 250, 0); let n = 0; for (let i = 0; i < 400; i++) if (b.push(40)) n++; return n === 1 && b.isTripped; })());
t("stalls longer than 250 ms (hidden tab) never count", !feed(new FrameBudget(25, 2000, 250, 0), 400, 20));
t("the first 3 s (shader compile) are not judged", !feed(new FrameBudget(25, 2000, 250), 100, 2.9));
t("garbage input is ignored", (() => { const b = new FrameBudget(25, 2000, 250, 0); return !b.push(NaN) && !b.push(-5) && !b.push(0); })());

// ---- procedural geometry
const car = buildCarGeometries();
const body = box(car.body);
t("car body is a small hatchback: about 4 m long, 1.8 m wide, under 1.6 m tall", body.max.z - body.min.z > 3.7 && body.max.z - body.min.z < 4.3 && body.max.x - body.min.x > 1.6 && body.max.x - body.min.x < 2.0 && body.max.y < 1.6 && body.min.y >= 0.2, JSON.stringify([body.min, body.max]));
t("car is symmetric left to right", Math.abs(body.max.x + body.min.x) < 0.01);
const glass = box(car.glass);
t("glass cabin sits on the body, narrower than it, and is lower than the roof", glass.max.x < body.max.x && glass.min.y > 0.8 && glass.max.y < body.max.y + 0.05);
t("the cabin is set back from the nose (hood in front, tail behind)", glass.max.z < body.max.z - 0.9 && glass.min.z > body.min.z + 0.2);
t("every car piece has positions, normals and uvs", Object.values(car).every((g) => g.attributes.position && g.attributes.normal && g.attributes.uv));
t("headlights are at the front and tail lights at the back", box(car.headlights).min.z > 1.5 && box(car.taillights).max.z < -1.5);
const wheel = box(car.wheel);
t("wheel is a cylinder lying on its side, radius 0.36, centred on its axle", Math.abs(wheel.max.y - CAR.wheelRadius) < 0.01 && Math.abs(wheel.min.y + CAR.wheelRadius) < 0.01 && wheel.max.x - wheel.min.x < 0.4 && !!car.wheel.attributes.color);
t("wheels fit under the body: axle height equals the radius", CAR.wheelRadius > 0.3 && CAR.wheelRadius < 0.45 && CAR.frontAxleZ > 0 && CAR.rearAxleZ < 0);
const tr = buildTrailerGeometries();
const trf = box(tr.frame);
t("trailer extends BEHIND its hitch (toward -z) and is not wider than a lane", trf.min.z < -3 && trf.max.z < 0.2 && trf.max.x - trf.min.x < 2.1);
t("trailer load sits on the bed", box(tr.load).min.y >= trf.min.y && box(tr.load).max.y > 1.2);
const bg = buildBuildingGeometry(12.8, 22.4, 12.8);
const uv = bg.attributes.uv;
t("building has its base on the ground", Math.abs(box(bg).min.y) < 1e-6 && Math.abs(box(bg).max.y - 22.4) < 1e-6);
t("facade UVs keep windows a constant size (12.8 m wide = 4 cells of 8)", (() => { let maxU = 0, maxV = 0; for (let i = 8; i < 12; i++) { } for (let i = 0; i < 4; i++) { maxU = Math.max(maxU, uv.getX(i)); maxV = Math.max(maxV, uv.getY(i)); } return Math.abs(maxU - 12.8 / (FACADE.cell * FACADE.cols)) < 1e-6 && Math.abs(maxV - 22.4 / (FACADE.cell * FACADE.rows)) < 1e-6; })());
t("roofs map to the solid wall texel so they never show windows", (() => { for (let i = 8; i < 16; i++) if (Math.abs(uv.getX(i) - WALL_UV) > 1e-6 || Math.abs(uv.getY(i) - WALL_UV) > 1e-6) return false; return true; })());
t("barrier is a low profile, centred on its length", (() => { const b = box(buildBarrierGeometry(100)); return b.max.y < 1 && b.max.y > 0.6 && Math.abs(b.min.z + 50) < 1e-6 && Math.abs(b.max.z - 50) < 1e-6; })());
t("a second wheel at a different size works (trailer wheel)", box(buildWheelGeometry(0.3, 0.22)).max.y > 0.29);

// ---- disposal
t("ResourceBin disposes everything once and survives a second call", (() => {
  const bin = new ResourceBin(); let n = 0;
  const mk = () => bin.add({ dispose() { n++; } });
  mk(); mk(); mk();
  bin.disposeAll(); bin.disposeAll();
  return n === 3 && bin.size === 0;
})());
t("ResourceBin keeps going when one dispose throws", (() => { const bin = new ResourceBin(); let n = 0; bin.add({ dispose() { throw new Error("x"); } }); bin.add({ dispose() { n++; } }); bin.disposeAll(); return n === 1; })());
t("disposeObject3D frees geometry, material and the textures the material holds, twice without error", (() => {
  const log: string[] = [];
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.addEventListener("dispose", () => log.push("geo"));
  const tex = new THREE.Texture(); tex.addEventListener("dispose", () => log.push("tex"));
  const mat = new THREE.MeshStandardMaterial({ map: tex }); mat.addEventListener("dispose", () => log.push("mat"));
  const inst = new THREE.InstancedMesh(geo, mat, 4); inst.addEventListener("dispose", () => log.push("inst"));
  const root = new THREE.Group(); root.add(new THREE.Mesh(geo, mat)); root.add(inst);
  disposeObject3D(root); disposeObject3D(root);
  return log.includes("geo") && log.includes("tex") && log.includes("mat") && log.includes("inst");
})());

// ---- source guards
const engine = readFileSync("src/components/literacy/long-haul/long-haul-engine.ts", "utf8");
const world = readFileSync("src/components/literacy/long-haul/long-haul-world.ts", "utf8");
const animate = engine.slice(engine.indexOf("private animate = ()"), engine.indexOf("  dispose() {"));
t("the render loop allocates no vectors, colours or objects", !/new THREE\./.test(animate), (animate.match(/new THREE\.\w+/g) ?? []).join(","));
t("dispose is idempotent and frees the scene, the bin and the reflection bake", /if \(this\.disposed\) return;\s*this\.disposed = true;/.test(engine) && /disposeObject3D\(this\.scene\)/.test(engine) && /this\.bin\.disposeAll\(\)/.test(engine) && /envTarget\?\.dispose\(\)/.test(engine));
t("dispose releases the physics world and the GL context", /this\.world\?\.free\(\)/.test(engine) && /forceContextLoss\(\)/.test(engine));
t("pixel ratio is capped at 2", /Math\.min\(window\.devicePixelRatio, 2\)/.test(engine));
t("reduced motion is respected (query, change listener, FOV and shake gates)", /prefers-reduced-motion/.test(readFileSync("src/components/literacy/long-haul/long-haul-feel.ts", "utf8")) && /onMotionChange/.test(engine) && /reducedMotion/.test(engine));
t("the low-quality fallback is wired to the frame budget", /frameBudget\.push\(rawMs\)\) this\.applyLowQuality\(\)/.test(engine) && /setLowQuality\(true\)/.test(engine));
t("no real-time shadow maps", !/castShadow|shadowMap\.enabled/.test(engine + world));
t("the physics box and the clamp are unchanged", /cuboid\(0\.9, 0\.5, 1\.7\)/.test(engine) && /TRACK\.halfWidth - 1\.2/.test(engine) && /pos\.x > 2\)/.test(engine) && /pos\.x < -2/.test(engine));
t("the world is laid out from TRACK (not hard-coded) for split, toll, gas station and finish", /TRACK\.tollZ/.test(world) && /TRACK\.gasStationZ/.test(world) && /TRACK\.finishZ/.test(world) && /TRACK\.laneSplitStartZ/.test(world) && /TRACK\.laneSplitEndZ/.test(world));
t("the toll sign shows the real toll cost", /ECONOMY\.tollCost/.test(world));

// ---- gameplay numbers must not have moved
t("track and vehicle numbers are the shipped ones", TRACK.halfWidth === 20 && TRACK.laneSplitStartZ === -60 && TRACK.laneSplitEndZ === -190 && TRACK.tollZ === -100 && TRACK.gasStationZ === -230 && TRACK.finishZ === -320 && VEHICLE.baseMaxSpeed === 32 && VEHICLE.roughSurfaceSpeedMult === 0.75 && TRAILER.lagFrames === 14 && ECONOMY.tollCost === 5 && ECONOMY.loanAmount === 50 && ECONOMY.loanAPR === 391);

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
