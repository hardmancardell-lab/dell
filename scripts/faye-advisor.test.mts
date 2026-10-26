// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-advisor.test.mts
// The advisor character: every pose at 160 and 320 px, accessible names, reduced-motion static output, one fixed viewBox,
// no colour outside the token set (Jarvis + CHARACTER), FayeFullBody output unchanged (sha256 snapshot taken before this
// work), rig overrides and the owner's choice props, deterministic output, the AgentTrio, and the token-check wiring.
// Server render only: no browser, no network.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const AB = await import("../src/components/faye/AdvisorFullBody.tsx");
const ST = await import("../src/components/faye/AdvisorFullBodyStyles.tsx");
const TR = await import("../src/components/faye/AgentTrio.tsx");
const FB = await import("../src/components/faye/FayeFullBody.tsx");
const AV = await import("../src/components/faye/FayeAvatar.tsx");
const RIG = await import("../src/components/faye/CharacterRig.ts");
const { JARVIS, CHARACTER, CHARACTER_CSS_NAMES } = await import("../src/lib/design/tokens.ts");

let failed = 0;
const t = (name: string, ok: unknown, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " :: " + detail : ""}`);
};

const POSES = RIG.ADVISOR_POSE_NAMES as string[];
const HEIGHTS = [160, 320];
const html = (el: unknown) => renderToStaticMarkup(el as any);
const noStyle = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, "");
const ab = (props: any = {}) => noStyle(html(h(AB.AdvisorFullBody, props)));
const attr = (s: string, name: string) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];
const norm = (s: string) => s.replace(/abg[A-Za-z0-9]+/g, "G").replace(/--ab-blink-o:[^;"]+/g, "B");
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const srcAb = read("../src/components/faye/AdvisorFullBody.tsx");
const srcSt = read("../src/components/faye/AdvisorFullBodyStyles.tsx");
const srcTr = read("../src/components/faye/AgentTrio.tsx");
const srcRig = read("../src/components/faye/CharacterRig.ts");

// ------------------------------------------------------------------ every pose at both heights
for (const height of HEIGHTS) {
  const seen = new Set<string>();
  for (const pose of POSES) {
    const s = ab({ pose, height });
    seen.add(norm(s));
    t(`${pose} @${height}: wrapper is ${height}px tall and ${Math.round(height * 0.6)}px wide`, s.includes(`width:${Math.round(height * 0.6)}px;height:${height}px`) && s.includes(`data-height="${height}"`));
    t(`${pose} @${height}: exactly one role=img with the pose in its name`, (s.match(/role="img"/g) || []).length === 1 && new RegExp(`aria-label="Advisor, ${pose}: [^"]+"`).test(s));
    t(`${pose} @${height}: data-pose and data-character are set`, s.includes(`data-pose="${pose}"`) && s.includes('data-character="advisor"'));
  }
  t(`@${height}: all ${POSES.length} poses draw differently`, seen.size === POSES.length, String(seen.size));
}

// ------------------------------------------------------------------ accessible names and options
{
  t('the presenting pose is named exactly "Advisor, presenting: one arm out toward a chart"', attr(ab({ pose: "presenting" }), "aria-label") === "Advisor, presenting: one arm out toward a chart");
  const names = POSES.map((p) => attr(ab({ pose: p }), "aria-label"));
  t("every pose has its own accessible name", new Set(names).size === POSES.length, names.join(" | "));
  t("names are plain words (no pronouns, no emoji)", names.every((n) => /^[A-Za-z0-9 ,:'-]+$/.test(n) && !/\b(he|she|her|his|him)\b/i.test(n)));
  const s = ab({ pose: "thinking" });
  t("the three layers (back, head, front) are aria-hidden: no duplicate names", (s.match(/<svg[^>]*aria-hidden="true"/g) || []).length === 3 && !/<svg[^>]*role="img"/.test(s));
  const dec = ab({ pose: "thinking", decorative: true });
  t("decorative: aria-hidden stage, no role, no label", dec.includes('aria-hidden="true"') && !/role="img"/.test(dec) && !/aria-label/.test(dec));
  const ann = ab({ pose: "presenting", announce: true });
  t("announce: a visually hidden polite live region, outside the role=img", /aria-live="polite"/.test(ann) && ann.includes("Advisor is presenting") && ann.indexOf("aria-live") > ann.lastIndexOf("</svg>"));
  t("no live region unless asked", !/aria-live/.test(s));
  t("label prop changes the name and the live text", ab({ label: "Dr. Hardman", pose: "unsure" }).includes('aria-label="Dr. Hardman, unsure:') && ab({ label: "Coach", announce: true }).includes("Coach is idle"));
  t("a bad pose or mood falls back to idle", ab({ pose: "dancing" }).includes('data-pose="idle"') && ab({ mood: "angry" }).includes('data-pose="idle"') && ab({}).includes('data-pose="idle"'));
  t("height is clamped to 120..480 and bad values fall back to 240", ab({ height: 20 }).includes('data-height="120"') && ab({ height: 9999 }).includes('data-height="480"') && ab({ height: NaN }).includes('data-height="240"') && ab({ height: 479.6 }).includes('data-height="480"'));
  t("mood maps to the pose of that name; offline and error map to idle (a person does not power down)", ["idle", "listening", "thinking", "speaking", "unsure", "celebrating"].every((m) => ab({ mood: m }).includes(`data-pose="${m}"`)) && ab({ mood: "offline" }).includes('data-pose="idle"') && ab({ mood: "error" }).includes('data-pose="idle"'));
  t("pose wins over mood when both are given", ab({ pose: "presenting", mood: "thinking" }).includes('data-pose="presenting"'));
  t("every FayeMood is handled", AV.FAYE_MOODS.every((m) => /data-pose="[a-z]+"/.test(ab({ mood: m }))));
  t("presenting draws the chart card by default and chart={false} removes it; other poses never draw it", ab({ pose: "presenting" }).includes("data-chart") && !ab({ pose: "presenting", chart: false }).includes("data-chart") && POSES.filter((p) => p !== "presenting").every((p) => !ab({ pose: p }).includes("data-chart")));
}

// ------------------------------------------------------------------ the character: afro, glasses, face, pantsuit
{
  const s = ab({ pose: "idle", height: 320 });
  t("the head holds an afro (hair back and hair front groups), a face and glasses", s.includes('data-hair="back"') && s.includes('data-hair="front"') && s.includes('data-glasses="softRect"') && s.includes('data-face=""'));
  t("a real face: eyes, brows and a mouth, not the aperture ring", s.includes("ab-eye-white") && s.includes("ab-brow") && (s.includes("ab-lips") || s.includes("ab-mouth")) && !/fayeav|data-faye-avatar|fa-ring/.test(s));
  const circles = AB.afroCircles("afro");
  const tapered = AB.afroCircles("afroTapered");
  const extent = (cs: any[]) => ({ w: Math.max(...cs.map((c) => c.cx + c.r)) - Math.min(...cs.map((c) => c.cx - c.r)), top: Math.min(...cs.map((c) => c.cy - c.r)) });
  t("the afro is built from overlapping circles (a base plus 11 bumps), round and symmetric", circles.length === 12 && Math.abs(extent(circles).w - 2 * (55 - Math.min(...circles.map((c) => c.cx - c.r)))) < 0.5);
  t("the full afro is wider than the face (about 54 units) by a clear margin, and the tapered one is smaller", extent(circles).w > 95 && extent(tapered).w < extent(circles).w - 15 && extent(tapered).w > 60);
  t("no hair circle hangs below the jaw (it would show in front of the neck)", circles.every((c) => c.cy + c.r <= 100) && tapered.every((c) => c.cy + c.r <= 100));
  t("a pantsuit: jacket, lapels, ivory blouse, matching trousers, flats", s.includes("ab-jacket") && s.includes("ab-lapel") && s.includes("ab-blouse") && s.includes("ab-trousers") && s.includes("ab-shoe"));
  t("different poses change the face (mouth and eyes follow the pose)", norm(ab({ pose: "celebrating" })) !== norm(ab({ pose: "idle" })) && ab({ pose: "celebrating" }).includes("ab-teeth") && ab({ pose: "speaking" }).includes("ab-talk") && !ab({ pose: "idle" }).includes("ab-teeth"));
  t("the head is tilted about the neck per pose (listening tilts, idle does not)", /rotate\(-6deg\)/.test(ab({ pose: "listening" })) && /rotate\(0deg\)/.test(ab({ pose: "idle" })));
}

// ------------------------------------------------------------------ reduced motion, fixed viewBox, no layout shift
{
  const anim = ab({ pose: "celebrating" });
  const stat = ab({ pose: "celebrating", reducedMotion: true });
  t("reducedMotion adds the ab-static class and only that", stat.includes('class="advfb ab-static"') && anim.includes('class="advfb"') && norm(stat).replace(" ab-static", "") === norm(anim));
  t("the stylesheet switches every animation off for the class and for prefers-reduced-motion", /\.advfb\.ab-static \*[^{]*\{animation:none !important\}/.test(ST.ADVISOR_FULLBODY_CSS) && /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:none !important/.test(ST.ADVISOR_FULLBODY_CSS));
  const props = new Set<string>();
  for (const m of ST.ADVISOR_FULLBODY_CSS.matchAll(/@keyframes [\w-]+\{(.*)\}/g)) for (const p of m[1].matchAll(/([a-z-]+):/g)) props.add(p[1]);
  t("keyframes animate only transform and opacity", props.size > 0 && [...props].every((p) => p === "transform" || p === "opacity"), [...props].join(","));
  const sizes = new Set<string>();
  for (const height of HEIGHTS) for (const pose of POSES) sizes.add(`${height}:` + (ab({ pose, height }).match(/<span class="advfb[^>]*style="([^"]*)"/) || [])[1].match(/width:\d+px;height:\d+px/)[0]);
  t("wrapper size depends on height only, never on pose", sizes.size === HEIGHTS.length, [...sizes].join(" | "));
  const boxes = new Set<string>();
  for (const pose of POSES) for (const m of ab({ pose, height: 320 }).matchAll(/<svg[^>]*viewBox="([^"]*)"/g)) boxes.add(m[1]);
  t("one fixed viewBox for the body layers in every pose (240 x 400) plus the 110 x 110 head", [...boxes].sort().join("|") === "0 0 110 110|0 0 240 400", [...boxes].join("|"));
  t("the head slot is positioned in percent of the fixed box", /left:\d+(\.\d+)?%;top:\d+(\.\d+)?%;width:\d+(\.\d+)?%;height:\d+(\.\d+)?%/.test(ab({ pose: "idle" })));
}

// ------------------------------------------------------------------ colour: tokens only
{
  const allowed = new Set([...Object.values(JARVIS), ...Object.values(CHARACTER)].map((x: string) => x.toLowerCase()));
  for (const pose of POSES) {
    const s = html(h(AB.AdvisorFullBody, { pose, height: 160 }));
    const hex = (s.match(/#[0-9a-fA-F]{6}\b/g) || []).map((x) => x.toLowerCase());
    t(`${pose}: every hex colour in the output is a token value (var fallbacks)`, hex.every((x) => allowed.has(x)), hex.filter((x) => !allowed.has(x)).join(","));
    t(`${pose}: no inline literal fill or stroke on any element (only url(#..) gradients and none)`, !/(fill|stroke)="(?!url\(#|none)[^"]*"/.test(s));
  }
  t("the sources hold no colour literal at all (hex, rgb, hsl, named)", [srcAb, srcSt, srcTr].every((src) => !/#[0-9a-fA-F]{3,8}\b(?![^"]*url)/.test(src.replace(/url\(#\$\{gid\}[a-z]\)/g, "")) && !/\brgba?\(|\bhsla?\(/.test(src)));
  t("the stylesheet reads only declared --fb-* properties", [...ST.ADVISOR_FULLBODY_CSS.matchAll(/var\((--[\w-]+)/g)].every((m) => /^--(fb-|ab-)/.test(m[1])) && [...ST.ADVISOR_FULLBODY_CSS.matchAll(/var\((--fb-[\w-]+)/g)].every((m) => ab({}).includes(m[1] + ":") || html(h(AB.AdvisorFullBody, {})).includes(m[1] + ":") || m[1] === "--fb-dr"));
  t("the rig lists only token names (no colour values)", JSON.stringify(RIG.advisorDefault).match(/#[0-9a-f]{3,8}/i) === null);
  const v = RIG.rigVars(RIG.advisorDefault) as Record<string, string>;
  t("rigVars fallbacks equal tokens.ts for every advisor variable (Jarvis and CHARACTER)", Object.values(v).every((val) => { const m = val.match(/^var\((--[a-z0-9-]+),(#[0-9a-f]{6})\)$/i); return !!m && allowed.has(m[2].toLowerCase()); }));
  t("the default skin is the owner's medium-deep brown and the CHARACTER css names are kebab-case of the keys", v["--fb-skin"] === `var(--skin-medium-deep,${CHARACTER.skinMediumDeep})` && Object.entries(CHARACTER_CSS_NAMES).every(([k, n]) => n === k.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase())));
  // contrast on ink-900 (the dark theme panel), computed here
  const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const on = JARVIS.ink900;
  t("silhouette: default skin, all three suits and the blouse reach 3:1 on ink-900", ratio(CHARACTER.skinMediumDeep, on) >= 3 && ratio(CHARACTER.suitPlum, on) >= 3 && ratio(CHARACTER.suitTeal, on) >= 3 && ratio(CHARACTER.suitAmber, on) >= 3 && ratio(CHARACTER.blouseIvory, on) >= 3, [CHARACTER.skinMediumDeep, CHARACTER.suitPlum, CHARACTER.suitTeal].map((c) => ratio(c, on).toFixed(2)).join(" "));
  t("the plum suit is distinct from Faye's ink-blue jacket and teal piping (hue and lightness differ)", ratio(CHARACTER.suitPlum, JARVIS.ink700) > 2.2 && CHARACTER.suitPlum.toLowerCase() !== JARVIS.signal.toLowerCase());
  t("face legibility: iris on eye white and frame on skin keep a clear contrast", ratio(CHARACTER.hairEspresso, CHARACTER.blouseIvory) > 10 && ratio(CHARACTER.frameRose, CHARACTER.skinMediumDeep) > 2);
  // the dark hair does not reach 3:1 against the panel on its own; the silhouette comes from the rim outline token, which the test requires
  t("dark hair is read through a rim outline (outline pass drawn first) because hair alone is under 3:1 on ink-900", ratio(CHARACTER.hairEspresso, on) < 3 && /ab-hair-edge/.test(ab({})) && /\.ab-hair-edge\{fill:var\(--fb-outline\);stroke:var\(--fb-outline\)/.test(ST.ADVISOR_FULLBODY_CSS) && RIG.advisorDefault.outfit.outline === "lineBright");
}

// ------------------------------------------------------------------ FayeFullBody output unchanged
{
  const snap = JSON.parse(read("./fixtures/faye-fullbody-static.snapshot.json"));
  let same = 0, total = 0, bad: string[] = [];
  for (const mood of AV.FAYE_MOODS) for (const height of [160, 320]) {
    const key = `${mood}@${height}`;
    const out = html(h(FB.FayeFullBody, { mood, height, reducedMotion: true }));
    total++;
    const ok = snap[key] && createHash("sha256").update(out).digest("hex") === snap[key].sha256 && out.length === snap[key].length;
    if (ok) same++; else bad.push(key);
  }
  t(`FayeFullBody static output (all 8 moods x 160/320, with its stylesheet) is byte-identical to the snapshot taken before the advisor work (${same}/${total})`, same === total && total === 16, bad.join(","));
  t("FAYE_RIG is untouched: no glasses or face fields, hair none, same tokens", RIG.FAYE_RIG.hair.style === "none" && RIG.FAYE_RIG.glasses === undefined && RIG.FAYE_RIG.face === undefined && RIG.FAYE_RIG.skin === "text1");
  const faye = RIG.rigVars(RIG.FAYE_RIG) as Record<string, string>;
  t("Faye's rigVars carry none of the new advisor properties", !("--fb-glasses" in faye) && !("--fb-lips" in faye) && !("--fb-hair-sheen" in faye) && Object.keys(faye).length === 17);
  t("FayeFullBody.tsx and its stylesheet were not edited by this work (no advisor mention)", !/advisor/i.test(read("../src/components/faye/FayeFullBodyStyles.tsx")) && !/AdvisorFullBody|advisorDefault/.test(read("../src/components/faye/FayeFullBody.tsx")));
  t("the advisor stylesheet has its own href so both stylesheets de-duplicate independently", /href="advisor-fullbody-v1"/.test(srcSt) && /href="faye-fullbody-v1"/.test(read("../src/components/faye/FayeFullBodyStyles.tsx")));
}

// ------------------------------------------------------------------ rig overrides and the owner's choices
{
  const base = html(h(AB.AdvisorFullBody, { pose: "idle" }));
  const hasVar = (s: string, name: string, token: string, value: string) => s.includes(`${name}:var(${token},${value})`);
  t("default look: medium-deep skin, espresso hair, plum suit, rose frames, soft-rectangle glasses", hasVar(base, "--fb-skin", "--skin-medium-deep", CHARACTER.skinMediumDeep) && hasVar(base, "--fb-hair", "--hair-espresso", CHARACTER.hairEspresso) && hasVar(base, "--fb-jacket", "--suit-plum", CHARACTER.suitPlum) && hasVar(base, "--fb-glasses", "--frame-rose", CHARACTER.frameRose) && base.includes('data-glasses="softRect"'));
  const skins = { fair: ["--skin-fair", CHARACTER.skinFair], tan: ["--skin-tan", CHARACTER.skinTan], medium: ["--skin-medium", CHARACTER.skinMedium], mediumDeep: ["--skin-medium-deep", CHARACTER.skinMediumDeep], deep: ["--skin-deep", CHARACTER.skinDeep] };
  t("skin: all five swatches flow through (skin and its shade)", Object.entries(skins).every(([k, [tok, val]]) => hasVar(html(h(AB.AdvisorFullBody, { skin: k })), "--fb-skin", tok, val as string) && html(h(AB.AdvisorFullBody, { skin: k })).includes("--fb-skin-shade:var(" + tok + "-shade,")));
  const suits = { plum: CHARACTER.suitPlum, teal: CHARACTER.suitTeal, amber: CHARACTER.suitAmber };
  t("suit: plum, teal and amber change jacket, trousers, lapel and piping together", Object.entries(suits).every(([k, val]) => { const s = html(h(AB.AdvisorFullBody, { suit: k })); return hasVar(s, "--fb-jacket", "--suit-" + k, val) && hasVar(s, "--fb-trousers", "--suit-" + k, val) && s.includes(`--fb-piping:var(--suit-${k}-light,`) && s.includes(`--fb-lapel:var(--suit-${k}-shade,`); }));
  t("hair colour: black, espresso and chestnut", ["black", "espresso", "chestnut"].every((c) => html(h(AB.AdvisorFullBody, { hairColour: c })).includes(`--fb-hair:var(--hair-${c},`)));
  t("hair style: afroTapered draws fewer or smaller circles than afro; both are 12 circles but the tapered extent is smaller", ab({ hairStyle: "afroTapered" }) !== ab({ hairStyle: "afro" }) && ab({ hairStyle: "afroTapered" }).includes('data-head="afroTapered"') && ab({}).includes('data-head="afro"'));
  t("glasses: round and none draw differently, none draws no frames", ab({ glasses: "round" }).includes('data-glasses="round"') && ab({ glasses: "round" }).includes("<circle class=\"ab-frame\"") && !ab({ glasses: "none" }).includes("data-glasses") && !ab({ glasses: "none" }).includes("ab-frame"));
  t("frame colour: rose, gold and ivory", ["rose", "gold", "ivory"].every((c) => html(h(AB.AdvisorFullBody, { frame: c })).includes(`--fb-glasses:var(--frame-${c},`)));
  {
    const bad = html(h(AB.AdvisorFullBody, { skin: "purple", suit: "neon", hairColour: "blue", frame: "x", glasses: "monocle" }));
    t("a bad choice value falls back to the default instead of breaking", hasVar(bad, "--fb-skin", "--skin-medium-deep", CHARACTER.skinMediumDeep) && hasVar(bad, "--fb-jacket", "--suit-plum", CHARACTER.suitPlum) && hasVar(bad, "--fb-hair", "--hair-espresso", CHARACTER.hairEspresso) && hasVar(bad, "--fb-glasses", "--frame-rose", CHARACTER.frameRose) && bad.includes('data-glasses="softRect"'));
  }
  const custom = { ...RIG.advisorDefault, displayName: "Coach", skin: "skinTan" as const, skinShade: "skinTanShade" as const };
  const s = html(h(AB.AdvisorFullBody, { rig: custom }));
  t("the rig prop is the base: its name and skin flow through", s.includes('aria-label="Coach, idle:') && hasVar(s, "--fb-skin", "--skin-tan", CHARACTER.skinTan));
  const s2 = html(h(AB.AdvisorFullBody, { rig: custom, suit: "teal" }));
  t("choice props are applied on top of the rig prop (suit changes, the rig's skin stays)", hasVar(s2, "--fb-skin", "--skin-tan", CHARACTER.skinTan) && hasVar(s2, "--fb-jacket", "--suit-teal", CHARACTER.suitTeal));
  const r = RIG.advisorRig({ skin: "deep", suit: "amber", hairStyle: "afroTapered", hairColour: "black", glasses: "round", frame: "gold" });
  t("advisorRig builds a full rig from the choices and ignores nonsense", r.skin === "skinDeep" && r.outfit.jacket === "suitAmber" && r.hair.style === "afroTapered" && r.hair.colour === "hairBlack" && r.glasses.style === "round" && r.glasses.colour === "frameGold" && RIG.advisorRig({ skin: "x", suit: "y" } as any).skin === "skinMediumDeep");
  t("advisorDefault equals advisorRig() and has the advisor id and name", JSON.stringify(RIG.advisorDefault) === JSON.stringify(RIG.advisorRig()) && RIG.advisorDefault.id === "advisor" && RIG.advisorDefault.displayName === "Advisor");
  t("three suit options are offered (plum default, teal, amber) and five skin swatches", Object.keys(RIG.ADVISOR_SUITS).join() === "plum,teal,amber" && Object.keys(RIG.ADVISOR_SKINS).length === 5 && Object.keys(RIG.ADVISOR_HAIR).length === 3 && Object.keys(RIG.ADVISOR_FRAMES).length === 3);
  t("the Faye rig still works on FayeFullBody next to the advisor rig (the seam is shared)", html(h(FB.FayeFullBody, { rig: RIG.advisorDefault, mood: "idle" })).includes("--fb-skin:var(--skin-medium-deep,"));
}

// ------------------------------------------------------------------ deterministic, no timers
{
  for (const pose of POSES) t(`${pose}: output is byte-identical on repeat renders`, html(h(AB.AdvisorFullBody, { pose, height: 240 })) === html(h(AB.AdvisorFullBody, { pose, height: 240 })));
  t("no timers, randomness or browser APIs in the sources", [srcAb, srcSt, srcTr].every((src) => !/setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|window\.|document\.|localStorage|fetch\(/.test(src)));
  t("no images, external assets or dependencies (inline SVG only)", [srcAb, srcSt, srcTr].every((src) => !/<img|<image|url\(["']?https?:|@import|href="http/.test(src)) && /^import[^\n]*from "react";/m.test(srcAb));
  t("the blink offset is derived from useId (stable per instance, not random)", /hash32\(uid\)/.test(srcAb));
}

// ------------------------------------------------------------------ the rig: arm solutions and poses
{
  const reach = (side: "L" | "R", spec: any) => { const sol = RIG.solveArm(RIG.SHOULDER[side], spec.target, spec.bend); const d = Math.hypot(sol.hand[0] - spec.target[0], sol.hand[1] - spec.target[1]); return d < 0.6; };
  t("every advisor pose reaches its hand targets with the shared arm solver", POSES.every((p) => reach("L", RIG.ADVISOR_POSES[p].L) && reach("R", RIG.ADVISOR_POSES[p].R)));
  const pr = RIG.ADVISOR_POSES.presenting;
  t("presenting: the right hand is out to the side, beyond the shoulder, at about chest height, with an open palm", pr.R.target[0] > RIG.SHOULDER.R[0] + 50 && pr.R.target[1] > 110 && pr.R.target[1] < 190 && pr.R.open === true);
  t("celebrating: both hands above the head; thinking: one hand near the chin", RIG.ADVISOR_POSES.celebrating.L.target[1] < 70 && RIG.ADVISOR_POSES.celebrating.R.target[1] < 70 && RIG.ADVISOR_POSES.thinking.R.target[1] < 130);
  t("every pose is standing (no seated advisor)", POSES.every((p) => RIG.ADVISOR_POSES[p].seated === false && RIG.ADVISOR_POSES[p].sit === 0));
  t("the Faye POSES table is not modified (the advisor spreads copies)", RIG.POSES.thinking.R.handRot === 20 && RIG.POSES.thinking.describe === "one hand at the chin, the other arm across the waist" && RIG.POSES.speaking.describe === "one open palm raised in a gesture");
}

// ------------------------------------------------------------------ AgentTrio
{
  const tr = (props: any = {}) => noStyle(html(h(TR.AgentTrio, props)));
  const s = tr({ height: 240, advisor: "presenting" });
  t("AgentTrio: a role=group named for all three, holding Faye, the advisor and Claude's mark in that order", /role="group" aria-label="Faye, the advisor and Claude"/.test(s) && s.indexOf('data-trio="faye"') < s.indexOf('data-trio="advisor"') && s.indexOf('data-trio="advisor"') < s.indexOf('data-trio="claude"'));
  t("AgentTrio: each figure keeps its own accessible name", s.includes('aria-label="Faye, idle:') && s.includes('aria-label="Advisor, presenting: one arm out toward a chart"') && s.includes('aria-label="Claude, idle"'));
  t("AgentTrio: Faye and the advisor have the same size (shared floor line)", (s.match(/width:144px;height:240px/g) || []).length >= 3);
  t("AgentTrio: captions on by default and removable", s.includes(">Faye<") && s.includes(">Advisor<") && s.includes(">Claude<") && !tr({ captions: false }).includes(">Advisor<"));
  t("AgentTrio: moods and look are passed through", tr({ faye: "thinking", advisor: "speaking", claude: "thinking" }).includes('aria-label="Faye, thinking:') && tr({ advisor: "speaking" }).includes('aria-label="Advisor, speaking:') && tr({ advisorLook: { suit: "teal" } }).includes("--suit-teal"));
  t("AgentTrio: reducedMotion reaches all three", /fb-static/.test(tr({ reducedMotion: true })) && /ab-static/.test(tr({ reducedMotion: true })) && /fa-static/.test(tr({ reducedMotion: true })));
  t("AgentTrio: height is clamped like the figures", tr({ height: 9999 }).includes('data-height="480"') && tr({ height: 5 }).includes('data-height="120"'));
  t("AgentTrio: deterministic and no colour literal", tr({}) === tr({}) && !/#[0-9a-fA-F]{6}\b/.test(srcTr));
  t("AgentTrio: the advisor wears a colour that is neither Faye's teal nor Claude's amber by default", /suitPlum/.test(srcRig) && RIG.advisorDefault.outfit.jacket === "suitPlum");
}

// ------------------------------------------------------------------ token wiring
{
  const r = spawnSync(process.execPath, ["scripts/quality/check-design-tokens.cjs"], { encoding: "utf8", cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  t("the design-token check passes (CHARACTER palette mirrors globals.css, no baseline raised)", r.status === 0 && /PASS/.test(r.stdout), (r.stdout + r.stderr).slice(-300));
  const css = read("../src/app/globals.css");
  t("every CHARACTER token is declared once as a custom property in globals.css", Object.entries(CHARACTER).every(([k, v]) => (css.match(new RegExp(`--${CHARACTER_CSS_NAMES[k]}: ${v};`, "gi")) || []).length === 1));
  t("the baseline file was not raised by this work", (() => { const b = JSON.parse(read("./quality/check-design-tokens.baseline.json")); return b.hex <= 25 && b.rgb <= 66 && b.mixed <= 2 && b.unlabeled <= 24 && b.islands <= 90; })());
  t("TokenName covers both groups (a CHARACTER token is accepted by tokenRef)", RIG.tokenRef("skinMediumDeep") === `var(--skin-medium-deep,${CHARACTER.skinMediumDeep})` && RIG.tokenRef("ink900") === `var(--ink-900,${JARVIS.ink900})` && RIG.tokenVarName("suitPlumLight") === "--suit-plum-light");
}

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
