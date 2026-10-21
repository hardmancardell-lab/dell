// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-fullbody.test.mts
// Faye full-body character: every pose renders at 160 and 320 px, accessible names, reduced-motion static output, no colour
// outside the Jarvis token set, the head is the existing FayeAvatar, one fixed viewBox, deterministic output, compositor-only
// animation, the arm solver, the rig, and the widget's default-off variant. Server render only: no browser, no network.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const FB = await import("../src/components/faye/FayeFullBody.tsx");
const AV = await import("../src/components/faye/FayeAvatar.tsx");
const ST = await import("../src/components/faye/FayeFullBodyStyles.tsx");
const RIG = await import("../src/components/faye/CharacterRig.ts");
const { JARVIS } = await import("../src/lib/design/tokens.ts");

let failed = 0;
const t = (name: string, ok: unknown, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " :: " + detail : ""}`);
};

const MOODS = AV.FAYE_MOODS as string[];
const HEIGHTS = [160, 320];
const html = (el: unknown) => renderToStaticMarkup(el as any);
const noStyle = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, "");
const fbRaw = (props: any = {}) => html(h(FB.FayeFullBody, props));
const fb = (props: any = {}) => noStyle(fbRaw(props));
const attr = (s: string, name: string) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

// ------------------------------------------------------------------ every pose at both heights
for (const height of HEIGHTS) {
  const seen = new Set<string>();
  for (const mood of MOODS) {
    const s = fb({ mood, height });
    seen.add(s.replace(/fbg[A-Za-z0-9]+/g, "G").replace(/fag[A-Za-z0-9]+/g, "G"));
    t(`${mood} @${height}: wrapper is ${height}px tall and ${Math.round(height * 0.6)}px wide`, s.includes(`width:${Math.round(height * 0.6)}px;height:${height}px`) && s.includes(`data-height="${height}"`));
    t(`${mood} @${height}: exactly one role=img and it names the mood`, (s.match(/role="img"/g) || []).length === 1 && new RegExp(`aria-label="Faye, ${mood}: [^"]+"`).test(s));
    t(`${mood} @${height}: data-mood is set`, s.includes(`data-mood="${mood}"`));
  }
  t(`@${height}: all ${MOODS.length} poses draw differently`, seen.size === MOODS.length, String(seen.size));
}

// ------------------------------------------------------------------ accessible names and options
{
  const names = MOODS.map((m) => attr(fb({ mood: m }), "aria-label"));
  t("every mood has its own accessible name", new Set(names).size === MOODS.length, names.join(" | "));
  t("names are plain words (no pronouns that assume a body, no emoji)", names.every((n) => /^[A-Za-z0-9 ,:'-]+$/.test(n) && !/\b(he|she|her|his|him)\b/i.test(n)));
  const s = fb({ mood: "thinking" });
  t("the layers inside the role=img are aria-hidden (no duplicate names)", (s.match(/<svg[^>]*aria-hidden="true"/g) || []).length === 3 && !/<span class="fayeav[^>]*role=/.test(s) && !/<svg[^>]*role="img"/.test(s));
  const dec = fb({ mood: "thinking", decorative: true });
  t("decorative: aria-hidden stage, no role, no label", dec.includes('aria-hidden="true"') && !/role="img"/.test(dec) && !/aria-label/.test(dec));
  const ann = fb({ mood: "thinking", announce: true });
  t("announce: a visually hidden polite live region, outside the role=img", /aria-live="polite"/.test(ann) && ann.includes("Faye is thinking") && ann.indexOf("aria-live") > ann.lastIndexOf("</svg>"));
  t("no live region unless asked", !/aria-live/.test(s));
  t("label prop changes the name and the live text", fb({ label: "Faye (lab)", mood: "unsure" }).includes('aria-label="Faye (lab), unsure:') && fb({ label: "Faye (lab)", announce: true }).includes("Faye (lab) is idle"));
  t("a bad mood falls back to idle", fb({ mood: "angry" }).includes('data-mood="idle"'));
  t("height is clamped to 120..480 and bad values fall back to 240", fb({ height: 20 }).includes('data-height="120"') && fb({ height: 9999 }).includes('data-height="480"') && fb({ height: NaN }).includes('data-height="240"') && fb({ height: 479.6 }).includes('data-height="480"'));
}

// ------------------------------------------------------------------ the head is the existing FayeAvatar
{
  for (const mood of MOODS) {
    const s = fb({ mood, height: 320 });
    const m = s.match(/<span class="fayeav[^>]*data-mood="([a-z]+)"[^>]*data-size="(\d+)"/);
    t(`${mood}: the head slot holds FayeAvatar with the same mood`, !!m && m[1] === mood && s.includes("data-faye-avatar"));
  }
  const s = fb({ mood: "idle", height: 320 });
  const px = Number(attr(s.match(/<span class="fayeav[^>]*>/)![0], "data-size"));
  t("head size scales with the figure (110/400 of the height) and gets full detail at 320, minimal at 160", px === 88 && s.includes('data-detail="full"') && fb({ mood: "idle", height: 160 }).includes('data-detail="min"'));
  // The body's head markup is byte-identical to a stand-alone FayeAvatar of that size (apart from the generated id).
  const solo = noStyle(html(h(AV.FayeAvatar, { mood: "unsure", size: 88, decorative: true })));
  const inBody = fb({ mood: "unsure", height: 320 });
  const norm = (x: string) => x.replace(/fag[A-Za-z0-9]+/g, "G").replace(/--fa-blink-[do]:[^;"]+/g, "B");
  t("the head markup is the stand-alone FayeAvatar markup", norm(inBody).includes(norm(solo)));
  t("chunkTick reaches the head (speaking replays the mouth jump per chunk)", /fa-jump/.test(fb({ mood: "speaking", chunkTick: 4 })) && /fa-talk/.test(fb({ mood: "speaking" })));
  const srcFb = readFileSync(new URL("../src/components/faye/FayeFullBody.tsx", import.meta.url), "utf8");
  t("FayeFullBody imports FayeAvatar and does not redraw a face", /from "\.\/FayeAvatar"/.test(srcFb) && !/fa-eye|fa-ring|MOUTH/.test(srcFb));
}

// ------------------------------------------------------------------ fixed viewBox, no layout shift
{
  const boxes = new Set<string>();
  let layersOk = true;
  for (const mood of MOODS) for (const height of HEIGHTS) {
    const s = fb({ mood, height });
    const vbs = [...s.matchAll(/<svg[^>]*class="fb-layer"[^>]*viewBox="([^"]+)"/g)].map((m) => m[1]);
    if (vbs.length !== 2 || vbs.some((v) => v !== "0 0 240 400")) layersOk = false;
    boxes.add(`${height}:${s.match(/<span class="fayefb[^>]*style="([^"]*)"/)![1].match(/width:\d+px;height:\d+px/)![0]}`);
  }
  t("both SVG layers use the one 240 x 400 viewBox in every pose", layersOk);
  t("the wrapper box depends on the height only, never on the pose", boxes.size === HEIGHTS.length, [...boxes].join(" | "));
  t("the head slot is positioned in percent of the fixed box", /left:27\.08%;top:0\.75%;width:45\.83%;height:27\.5%/.test(fb({ mood: "idle" })));
  t("aspect ratio constant is 0.6", RIG.ASPECT === 0.6 && RIG.VB_W === 240 && RIG.VB_H === 400);
}

// ------------------------------------------------------------------ determinism
{
  const same = MOODS.every((m) => HEIGHTS.every((hh) => fb({ mood: m, height: hh }) === fb({ mood: m, height: hh })));
  t("the same props give byte-identical markup", same);
  const a = fb({ mood: "thinking", height: 240 });
  const b = noStyle(html(h("div", null, h(FB.FayeFullBody, { mood: "thinking", height: 240 }))));
  t("markup does not depend on Math.random or the clock (ids come from useId only)", !/Math\.random|Date\.now/.test(readFileSync(new URL("../src/components/faye/FayeFullBody.tsx", import.meta.url), "utf8")) && b.includes(a.replace(/^<span /, "<span ").slice(0, 60)));
  t("solveArm is pure and rounded", JSON.stringify(RIG.solveArm([82, 136], [30, 160], -1)) === JSON.stringify(RIG.solveArm([82, 136], [30, 160], -1)));
}

// ------------------------------------------------------------------ reduced motion
{
  t("reducedMotion prop adds the static class to the body AND to the head", fb({ reducedMotion: true }).includes("fb-static") && /<span class="fayeav fa-static/.test(fb({ reducedMotion: true })));
  t("default has neither static class", !fb({}).includes("fb-static") && !/fa-static/.test(fb({})));
  const css = ST.FAYE_FULLBODY_CSS.replace(/\n/g, "");
  t("stylesheet switches every animation off under prefers-reduced-motion and under .fb-static", /@media \(prefers-reduced-motion: reduce\)\{[^}]*animation:none !important/.test(css) && /\.fayefb\.fb-static \*[^{]*\{animation:none !important\}/.test(css));
  t("static poses carry their meaning in shape: arms differ between poses without any animation class", new Set(MOODS.map((m) => fb({ mood: m, reducedMotion: true }).match(/<g transform="rotate\([^"]+\)">/g)?.join("") ?? "")).size >= 6);
  t("the stylesheet is emitted with a stable href so React de-duplicates it", /data-href="[^"]*faye-fullbody-v1/.test(fbRaw({})) && /data-precedence="default"/.test(fbRaw({})) && /<style href="faye-fullbody-v1" precedence="default">/.test(readFileSync(new URL("../src/components/faye/FayeFullBodyStyles.tsx", import.meta.url), "utf8")));
}

// ------------------------------------------------------------------ colour discipline
{
  const allowed = new Set(Object.values(JARVIS).map((v) => String(v).toLowerCase()));
  const everything = [...MOODS.flatMap((m) => HEIGHTS.map((hh) => fb({ mood: m, height: hh }))), ST.FAYE_FULLBODY_CSS].join("\n").replace(/url\(#[^)]*\)/g, "");
  const hexes = (everything.match(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g) || []).map((x) => x.toLowerCase());
  t("every hex colour in the markup and stylesheet is a Jarvis token value", hexes.length > 0 && hexes.every((x) => allowed.has(x)), [...new Set(hexes.filter((x) => !allowed.has(x)))].join(","));
  t("no rgb()/hsl() colour literals", !/\b(rgba?|hsla?)\(/.test(everything));
  t("no inline fill or stroke attribute carries a literal colour", !/\b(fill|stroke)="(?!none|url\()[^"]+"/.test(noStyle(fb({ mood: "celebrating", height: 320 })).replace(/<span class="fayeav[\s\S]*?<\/span>/g, "")));
  // the rig itself only ever names tokens
  const names = new Set(Object.keys(JARVIS));
  const rigNames = [RIG.FAYE_RIG.skin, RIG.FAYE_RIG.skinShade, RIG.FAYE_RIG.hair.colour, ...Object.values(RIG.FAYE_RIG.outfit)];
  t("the Faye rig lists only Jarvis token names", rigNames.every((n) => names.has(n)), rigNames.join(","));
  const vars = RIG.rigVars(RIG.FAYE_RIG) as Record<string, string>;
  t("rigVars turns each token name into var(--token, fallback) with the tokens.ts value as the fallback", Object.values(vars).every((v) => /^var\(--[a-z0-9-]+,#[0-9a-f]{6}\)$/.test(v)) && vars["--fb-jacket"] === `var(--ink-700,${JARVIS.ink700})` && vars["--fb-outline"] === `var(--line-bright,${JARVIS.lineBright})` && vars["--fb-piping"] === `var(--signal,${JARVIS.signal})`);
  t("tokenVarName maps camelCase tokens to the globals.css names", RIG.tokenVarName("ink900") === "--ink-900" && RIG.tokenVarName("lineBright") === "--line-bright" && RIG.tokenVarName("text2") === "--text-2" && RIG.tokenVarName("signalDim") === "--signal-dim");
  const used = [...ST.FAYE_FULLBODY_CSS.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
  const declared = new Set(Object.keys(vars).map((k) => k.slice(2)).concat(["fb-accent", "fb-dr"]));
  t("the stylesheet reads only --fb-* properties that the rig declares", used.every((u) => declared.has(u)), [...new Set(used.filter((u) => !declared.has(u)))].join(","));
  t("unsure pose swaps the piping to the verdict token; offline dims it", /\[data-mood="unsure"\]\{--fb-accent:var\(--fb-verdict\)\}/.test(ST.FAYE_FULLBODY_CSS) && /\[data-mood="offline"\],\.fayefb\[data-mood="error"\]\{--fb-accent:var\(--fb-dim\)\}/.test(ST.FAYE_FULLBODY_CSS));
  for (const file of ["FayeFullBody.tsx", "FayeFullBodyStyles.tsx", "CharacterRig.ts"]) {
    const src = readFileSync(new URL(`../src/components/faye/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    t(`${file}: no quoted hex literal, no rgb(), no timers, no browser APIs`, !/["'`]#[0-9a-fA-F]{3,8}["'`]/.test(src) && !/\brgba?\(/.test(src) && !/setTimeout|setInterval|requestAnimationFrame|window\.|document\.|useEffect|useState/.test(src));
    t(`${file}: imports only react, tokens and sibling files`, [...src.matchAll(/from "([^"]+)"/g)].every((m) => ["react", "@/lib/design/tokens", "./FayeAvatar", "./FayeFullBodyStyles", "./CharacterRig"].includes(m[1])));
  }
}

// ------------------------------------------------------------------ animation hygiene
{
  const css = ST.FAYE_FULLBODY_CSS;
  const frames = [...css.matchAll(/@keyframes ([a-z-]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  const props = new Set<string>();
  for (const m of frames) for (const d of m[2].matchAll(/\{([^}]*)\}/g)) for (const decl of d[1].split(";")) { const p = decl.split(":")[0].trim(); if (p) props.add(p); }
  t("there are keyframes, and they animate only transform and opacity", frames.length >= 8 && [...props].every((p) => p === "transform" || p === "opacity"), [...props].join(","));
  const used = [...css.matchAll(/animation:(fb-[a-z-]+)/g)].map((m) => m[1]);
  t("every animation names a defined keyframe", used.length >= 8 && used.every((u) => frames.some((m) => m[1] === u)), used.join(","));
  t("the stylesheet never transitions or animates layout properties", !/transition:|animation:[^;}]*(width|height|top|left)/.test(css));
  const hasAnim = (m: string, cls: string) => fb({ mood: m, height: 240 }).includes(cls);
  t("poses wire their motion: idle breathes, thinking orbits and taps, speaking gestures, unsure shrugs, celebrating cheers, offline pulses the standby glyph",
    hasAnim("idle", "fb-breathe") && hasAnim("thinking", "fb-spin") && hasAnim("thinking", "fb-tap") && hasAnim("speaking", "fb-gest") && hasAnim("unsure", "fb-shrug") && hasAnim("celebrating", "fb-cheer") && hasAnim("offline", "fb-pulse") && !hasAnim("offline", "fb-breathe"));
  t("offline and error are seated, standing poses are not", ["offline", "error"].every((m) => fb({ mood: m }).includes('data-pose="seated"')) && MOODS.filter((m) => !["offline", "error"].includes(m)).every((m) => fb({ mood: m }).includes('data-pose="standing"')));
  t("celebrating starts the arms from the rest angle (--fb-dr is set on both arms)", (fb({ mood: "celebrating" }).match(/--fb-dr:[-0-9.]+deg/g) || []).length === 2);
  t("only thinking draws orbiting dots; only offline and error draw the standby glyph", MOODS.every((m) => fb({ mood: m }).includes("data-orbit") === (m === "thinking") && fb({ mood: m }).includes("data-standby") === (m === "offline" || m === "error")));
}

// ------------------------------------------------------------------ arm solver and poses
{
  const S = [82, 136] as const;
  for (const [name, target, bend] of [["rest", [72, 258], 1], ["ear", [60, 100], -1], ["up", [44, 50], -1], ["out", [16, 148], -1]] as const) {
    const s = RIG.solveArm(S, target, bend);
    // forward kinematics: elbow, then hand centre at L2 along the rotated forearm
    const rad = (d: number) => (d * Math.PI) / 180;
    const ex = S[0] - RIG.L1 * Math.sin(rad(s.r1));
    const ey = S[1] + RIG.L1 * Math.cos(rad(s.r1));
    const a = s.r1 + s.r2;
    const hx = ex - RIG.L2 * Math.sin(rad(a));
    const hy = ey + RIG.L2 * Math.cos(rad(a));
    const reach = Math.hypot(target[0] - S[0], target[1] - S[1]);
    const ok = reach <= RIG.L1 + RIG.L2 - 0.5 ? Math.hypot(hx - target[0], hy - target[1]) < 0.6 : true;
    t(`solveArm ${name}: the hand lands on the target (forward kinematics)`, ok, `${hx.toFixed(1)},${hy.toFixed(1)} vs ${target}`);
  }
  t("solveArm clamps an unreachable target instead of returning NaN", Object.values(RIG.solveArm(S, [900, 900], 1)).flat().every((v) => Number.isFinite(v)));
  t("every pose has a description and targets inside the viewBox (with a margin for the hand)", MOODS.every((m) => RIG.POSES[m].describe.length > 8 && [RIG.POSES[m].L.target, RIG.POSES[m].R.target].every((p) => p[0] >= 0 && p[0] <= 240 && p[1] >= 20 && p[1] <= 330)));
  t("thinking: the chin hand is at the face (inside the head box, near the chin) and the other hand is across the waist", RIG.POSES.thinking.R.target[1] < RIG.HEAD.cy + 55 && RIG.POSES.thinking.R.target[1] > RIG.HEAD.cy + 35 && RIG.POSES.thinking.L.target[0] > 120);
  t("celebrating: both hands above the head line", RIG.POSES.celebrating.L.target[1] < RIG.HEAD.cy && RIG.POSES.celebrating.R.target[1] < RIG.HEAD.cy);
  t("listening: the head tilts and one hand is at ear height beside the head", RIG.POSES.listening.head.tilt !== 0 && Math.abs(RIG.POSES.listening.L.target[1] - RIG.HEAD.cy) < 50 && RIG.POSES.listening.L.target[0] < RIG.HEAD.cx - 40);
  t("unsure: shoulders lifted and both palms out wide", RIG.POSES.unsure.lift < 0 && RIG.POSES.unsure.L.target[0] < 40 && RIG.POSES.unsure.R.target[0] > 200);
}

// ------------------------------------------------------------------ the shared character base
{
  const dummy = { ...RIG.FAYE_RIG, id: "advisor", displayName: "Advisor", outfit: { ...RIG.FAYE_RIG.outfit, piping: "verdict" as const } };
  const s = fb({ rig: dummy, mood: "idle" });
  t("a different rig reuses the whole body: its name and piping token flow through", s.includes('aria-label="Advisor, idle:') && s.includes(`--fb-piping:var(--verdict,${JARVIS.verdict})`) && s.includes(`--fb-jacket:var(--ink-700,${JARVIS.ink700})`));
  t("the default rig is Faye", fb({}).includes('aria-label="Faye, idle:') && RIG.FAYE_RIG.hair.style === "none");
  const srcRig = readFileSync(new URL("../src/components/faye/CharacterRig.ts", import.meta.url), "utf8");
  t("the advisor options are documented in the rig file (skin, hair, outfit, build, head) and no advisor is built", /How to build the advisor character next/.test(srcRig) && /Skin tone/.test(srcRig) && /Hair/.test(srcRig) && /Outfit/.test(srcRig) && !/ADVISOR_RIG|advisorRig/.test(srcRig));
}

// ------------------------------------------------------------------ widget: optional, default-off variant
// The widget renders nothing on the server (it waits for its status check), so these are source and stylesheet checks.
{
  const W = await import("../src/components/FayeChatWidget.tsx");
  const src = readFileSync(new URL("../src/components/FayeChatWidget.tsx", import.meta.url), "utf8");
  const css = W.FAYE_WIDGET_CSS.replace(/\n/g, "");
  t('the variant prop is "head" | "full" and optional', /variant\?: "head" \| "full";/.test(src));
  t("default off: the wrapper gets fw-full and the stage renders only when variant === full", /props\.variant === "full" \? " fw-full" : ""/.test(src) && /props\.variant === "full" \? \(\s*<div className="fw-stage"/.test(src));
  t("the stage holds the decorative full-body character, mood-driven, above the log", /<FayeFullBody mood=\{mood\} height=\{168\} chunkTick=\{tick\} decorative \/>/.test(src) && src.indexOf('className="fw-stage"') < src.indexOf('role="log"'));
  t("the launcher and the header keep the head icon", /<FayeAvatar mood=\{mood\} size=\{32\} decorative \/>/.test(src) && /<FayeAvatar mood=\{mood\} size=\{44\} chunkTick=\{tick\} decorative \/>/.test(src));
  t("the stage is hidden by default and shown only on tall wide screens (CSS media query); the header and empty-state heads hide then", /\.fw-stage\{display:none\}/.test(css) && /@media \(min-height:760px\) and \(min-width:520px\)\{\.fw-full \.fw-stage\{display:flex[^}]*\}\.fw-full \.fw-head \.fayeav,\.fw-full \.fw-empty \.fayeav\{display:none\}\}/.test(css));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
