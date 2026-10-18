// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/long-haul-audio.test.mts
// The Long Haul's sound maths, plus source-level guards for the two bugs that hid the car: a canvas that stayed 0 x 0 because the
// game's container is hidden while it loads, and a chase camera that sat in front of the car instead of behind it.
import { readFileSync } from "node:fs";
import { engineHz, engineGain, readSoundPreference, LongHaulAudio } from "../../src/components/literacy/long-haul/long-haul-audio.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };

// Pitch rises with speed and stays in range, even for bad input.
t("pitch at rest is the idle note", engineHz(0) === 52, String(engineHz(0)));
t("pitch at top speed is the top note", engineHz(1) === 150, String(engineHz(1)));
t("pitch rises with speed", engineHz(0.2) < engineHz(0.5) && engineHz(0.5) < engineHz(0.9));
t("pitch is clamped below 0 and above 1", engineHz(-3) === 52 && engineHz(9) === 150);
t("pitch survives NaN and Infinity", engineHz(NaN) === 52 && Number.isFinite(engineHz(Infinity)));

// Loudness: silent when off, quiet at idle, louder with throttle and speed, never above the cap.
t("silent when sound is off", engineGain(1, true, false) === 0);
t("idle is audible but quiet", engineGain(0, false, true) > 0 && engineGain(0, false, true) < 0.05);
t("throttle makes it louder", engineGain(0.5, true, true) > engineGain(0.5, false, true));
t("speed makes it louder", engineGain(0.9, false, true) > engineGain(0.1, false, true));
t("never above the cap", engineGain(1, true, true) <= 0.07 + 1e-12 && engineGain(5, true, true) <= 0.07 + 1e-12);

// Sound preference: on unless the player turned it off; a blocked localStorage must not throw.
globalThis.window = { localStorage: { getItem: () => null } };
t("sound is on by default", readSoundPreference() === true);
globalThis.window = { localStorage: { getItem: () => "off" } };
t("remembers off", readSoundPreference() === false);
globalThis.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
t("blocked storage falls back to on", readSoundPreference() === true);

// No Web Audio at all (or before a key press): every call is a safe no-op.
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } };
const a = new LongHaulAudio(true);
let threw = false;
try { a.update(0.5, true, 10, 1); a.tollChime(); a.loanPrompt(); a.refuel(); a.finish(); a.unlock(); a.setEnabled(false); a.dispose(); } catch { threw = true; }
t("no Web Audio: nothing throws", !threw);
t("not unlocked without a browser audio context", a.isUnlocked === false);

// Source guards for the visibility bugs.
const engine = readFileSync("src/components/literacy/long-haul/long-haul-engine.ts", "utf8");
t("engine watches its container size", /new ResizeObserver\(/.test(engine) && /resizeObserver\?\.disconnect\(\)/.test(engine));
t("engine ignores a 0 x 0 container", /width <= 0 \|\| height <= 0\) return/.test(engine));
t("chase camera is behind the car", /camOffset = new THREE\.Vector3\(-Math\.sin\(this\.heading\) \* 9, 5\.5, -Math\.cos\(this\.heading\) \* 9\)/.test(engine));
t("audio is stopped on dispose", /this\.audio\.dispose\(\)/.test(engine));
const game = readFileSync("src/components/literacy/long-haul/LongHaulGame.tsx", "utf8");
t("game has a visible sound button", /aria-pressed=\{soundOn\}/.test(game) && /Sound: on/.test(game));

console.log(`\n${passed} passed, ${bad} failed`);
if (bad) process.exit(1);
