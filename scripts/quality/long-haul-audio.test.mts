// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/long-haul-audio.test.mts
// The Long Haul's sound maths, plus source-level guards for the two bugs that hid the car: a canvas that stayed 0 x 0 because the
// game's container is hidden while it loads, and a chase camera that sat in front of the car instead of behind it.
import { readFileSync } from "node:fs";
import { engineHz, engineGain, windGain, tyreGain, dirtHumGain, windFilterHz, tyreFilterHz, mixLevels, MASTER_CAP, readSoundPreference, LongHaulAudio } from "../../src/components/literacy/long-haul/long-haul-audio.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };

// Pitch rises with speed and stays in range, even for bad input.
t("pitch at rest is the idle note", engineHz(0) === 52, String(engineHz(0)));
t("pitch at top speed is the top note", engineHz(1) === 150, String(engineHz(1)));
t("pitch rises with speed", engineHz(0.2) < engineHz(0.5) && engineHz(0.5) < engineHz(0.9));
t("pitch is clamped below 0 and above 1", engineHz(-3) === 52 && engineHz(9) === 150);
t("pitch survives NaN and Infinity", engineHz(NaN) === 52 && Number.isFinite(engineHz(Infinity)));

// Loudness: silent when off, SILENT at rest with no throttle (owner feedback: rumble after letting go), louder with throttle and speed, never above the cap.
t("silent when sound is off", engineGain(1, true, false) === 0);
t("at rest with no throttle the engine is exactly silent", engineGain(0, false, true) === 0 && engineGain(0.01, false, true) === 0);
t("pressing the throttle at a standstill revs the engine", engineGain(0, true, true) > 0 && engineGain(0, true, true) < 0.05);
t("throttle makes it louder", engineGain(0.5, true, true) > engineGain(0.5, false, true));
t("speed makes it louder (throttle on)", engineGain(0.9, true, true) > engineGain(0.1, true, true));
t("coasting is much quieter than driving at the same speed", engineGain(0.6, false, true) < engineGain(0.6, true, true) * 0.2, `${engineGain(0.6, false, true)} vs ${engineGain(0.6, true, true)}`);
t("coasting engine fades with speed", engineGain(0.8, false, true) > engineGain(0.2, false, true) && engineGain(0.2, false, true) > engineGain(0.03, false, true));
t("braking is a touch quieter than coasting", engineGain(0.6, false, true, true) < engineGain(0.6, false, true));
t("never above the cap", engineGain(1, true, true) <= 0.07 + 1e-12 && engineGain(5, true, true) <= 0.07 + 1e-12);
t("loudness survives NaN", engineGain(NaN, true, true) <= 0.07 && engineGain(NaN, false, true) === 0 && Number.isFinite(engineGain(Infinity, true, true)));
t("coasting drops the note, braking lowers it a little more",
  engineHz(0.8, false) < engineHz(0.8, true) && engineHz(0.8, true, true) < engineHz(0.8, true) && engineHz(0.8, false, true) <= engineHz(0.8, false));
t("pitch stays in range with coasting and braking", [0, 0.3, 1, NaN].every((f) => [[true, false], [false, false], [true, true], [false, true]].every(([th, br]) => engineHz(f, th, br) >= 52 && engineHz(f, th, br) <= 150)));

// Wind, tyre and dirt hum: zero at rest, rise with speed, dirt only on the dirt lane.
t("wind, tyre and dirt hum are silent at rest", windGain(0, true) === 0 && tyreGain(0, true) === 0 && dirtHumGain(0, true, true) === 0);
t("wind and tyre noise scale with speed", windGain(0.9, true) > windGain(0.4, true) && windGain(0.4, true) > windGain(0.1, true) && tyreGain(0.9, true) > tyreGain(0.2, true) && tyreGain(0.2, true) > 0);
t("coasting hiss is faint compared with the engine under throttle", windGain(0.6, true) + tyreGain(0.6, true) < engineGain(0.6, true, true));
t("dirt hum only on the dirt lane, and grows with speed", dirtHumGain(0.5, false, true) === 0 && dirtHumGain(0.5, true, true) > 0 && dirtHumGain(0.9, true, true) > dirtHumGain(0.2, true, true));
t("wind, tyre and dirt are silent when sound is off", windGain(1, false) === 0 && tyreGain(1, false) === 0 && dirtHumGain(1, true, false) === 0);
t("noise filters open up with speed", windFilterHz(1) > windFilterHz(0) && tyreFilterHz(1) > tyreFilterHz(0) && Number.isFinite(windFilterHz(NaN)));
t("at rest, no throttle: the whole mix is exactly zero", (() => { const m = mixLevels(0, false, false, false, true); return m.engine === 0 && m.wind === 0 && m.tyre === 0 && m.dirt === 0; })());
t("at rest on dirt, no throttle: still zero", (() => { const m = mixLevels(0, false, false, true, true); return m.engine + m.wind + m.tyre + m.dirt === 0; })());
t("coasting mix is quieter than driving at the same speed", (() => { const c = mixLevels(0.7, false, false, false, true); const d = mixLevels(0.7, true, false, false, true); return c.engine + c.wind + c.tyre < d.engine + d.wind + d.tyre; })());
t("the mix never exceeds the master cap, even on dirt at full throttle", (() => {
  for (const f of [0, 0.25, 0.5, 0.75, 1, 3, NaN, Infinity, -2]) for (const th of [true, false]) for (const br of [true, false]) for (const dirt of [true, false]) {
    const m = mixLevels(f, th, br, dirt, true);
    if (m.engine + m.wind + m.tyre + m.dirt > MASTER_CAP + 1e-12) return false;
    if (![m.engine, m.wind, m.tyre, m.dirt, m.engineHz, m.windHz, m.tyreHz].every(Number.isFinite)) return false;
  }
  return true;
})());
t("the whole mix is zero when sound is off", (() => { const m = mixLevels(1, true, false, true, false); return m.engine + m.wind + m.tyre + m.dirt === 0; })());

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
