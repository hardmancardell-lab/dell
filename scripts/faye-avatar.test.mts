// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-avatar.test.mts
// Faye avatar (WP-D): every state renders at 32 and 160 px, accessible names, reduced-motion static output, no colour
// outside the Jarvis token set, the Claude mark, no layout shift between states, compositor-only animation, contrast
// of the three accent colours on the ink background. Server render only: no browser, no network.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

const AV = await import("../src/components/faye/FayeAvatar.tsx");
const AM = await import("../src/components/faye/AgentMark.tsx");
const ST = await import("../src/components/faye/FayeAvatarStyles.tsx");
const { JARVIS } = await import("../src/lib/design/tokens.ts");

let failed = 0;
const t = (name: string, ok: unknown, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " :: " + detail : ""}`);
};

const MOODS = AV.FAYE_MOODS as string[];
const SIZES = [32, 160];
const html = (el: unknown) => renderToStaticMarkup(el as any);
// The stylesheet is inlined in static markup; strip it so class-name checks look at the SVG only.
const noStyle = (s: string) => s.replace(/<style[\s\S]*?<\/style>/g, "");
const avRaw = (props: any = {}) => html(h(AV.FayeAvatar, props));
const av = (props: any = {}) => noStyle(avRaw(props));
const mark = (props: any = {}) => noStyle(html(h(AM.AgentMark, props)));
const attr = (s: string, name: string) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

t("there are exactly eight mood names: the seven design states with error as the failed-job flavour of offline", MOODS.join(",") === "idle,listening,thinking,speaking,unsure,celebrating,offline,error");

// ------------------------------------------------------------------ every state at both sizes
for (const size of SIZES) {
  const seen = new Set<string>();
  for (const mood of MOODS) {
    const s = av({ mood, size });
    seen.add(s.replace(/fag[A-Za-z0-9]+/g, "G"));
    t(`${mood} @${size}: renders an svg of exactly ${size}px with the 64 viewBox`, /<svg\b/.test(s) && attr(s, "width") === String(size) && s.includes('viewBox="0 0 64 64"') && s.includes(`width:${size}px;height:${size}px`));
    t(`${mood} @${size}: role=img and aria-label "Faye, ${mood}"`, s.includes('role="img"') && s.includes(`aria-label="Faye, ${mood}"`));
    t(`${mood} @${size}: data-mood is set`, s.includes(`data-mood="${mood}"`));
  }
  t(`@${size}: all ${MOODS.length} states draw differently`, seen.size === MOODS.length, String(seen.size));
}

// ------------------------------------------------------------------ detail turns on at 56 px
{
  const small = av({ mood: "idle", size: 32 });
  const big = av({ mood: "idle", size: 160 });
  t("32 px drops bezel ticks, glow and brows", !/fa-bezel/.test(small) && !/radialGradient/.test(small) && !/fa-thin/.test(small));
  t("160 px adds bezel ticks, glow and brows", /fa-bezel/.test(big) && /radialGradient/.test(big) && /fa-thin/.test(big));
  t("data-detail is min below 56 and full from 56", small.includes('data-detail="min"') && big.includes('data-detail="full"') && av({ size: 55 }).includes('data-detail="min"') && av({ size: 56 }).includes('data-detail="full"'));
  t("celebrating burst ticks only at full detail", !/fa-burst/.test(av({ mood: "celebrating", size: 32 })) && /fa-burst/.test(av({ mood: "celebrating", size: 160 })));
}

// ------------------------------------------------------------------ shapes carry the meaning (static, no motion needed)
{
  const g = (mood: string, size = 160) => av({ mood, size, reducedMotion: true });
  t("unsure: tilted head, tilde mouth, broken ring, one lowered lid", /rotate\(6 32 32\)/.test(g("unsure")) && g("unsure").includes("21,45 26.5,41.5 32,45 37.5,48.5 43,45") && g("unsure").includes('stroke-dasharray="55 6 28 11"') && /height="5.4"/.test(g("unsure")));
  t("unsure is amber by the token, not by a literal", g("unsure").includes('data-mood="unsure"') && /\[data-mood="unsure"\][^{]*\{--fa-c:var\(--fa-verdict\)/.test(ST.FAYE_AVATAR_CSS.replace(/\n/g, "")));
  t("thinking: gap in the ring, looking up-right, three dots", g("thinking").includes('stroke-dasharray="84 16"') && g("thinking").includes("translate(2.2 -2.6)") && (g("thinking").match(/fa-dot"/g) || []).length === 3);
  t("speaking: sparkline mouth with several vertices", g("speaking").includes("20,44 25,42 30,45.5 35,42.5 40,45 44,43.5"));
  t("listening: tightened ring and an orbit arc", g("listening").includes('r="25"') && /fa-orbit/.test(g("listening")));
  t("celebrating: happy-arc eyes, smile, six ticks (shown, not hidden, when static)", g("celebrating").includes("M19.8 31 Q23.5 24.5 27.2 31") && g("celebrating").includes("21,41.5 25.5,46 32,48 38.5,46 43,41.5") && (g("celebrating").match(/class="fa-tick"/g) || []).length === 6);
  t("celebrating @32 still reads differently from idle: happy arcs and a smile", av({ mood: "celebrating", size: 32 }).includes("M19.8 31 Q23.5 24.5 27.2 31") && av({ mood: "celebrating", size: 32 }).includes("21,41.5 25.5,46 32,48 38.5,46 43,41.5"));
  t("offline: dashed dim ring, closed-line eyes, no brows, no glow", g("offline").includes('stroke-dasharray="2.2 2.8"') && g("offline").includes('y1="30" x2="26.5"') && !/fa-thin/.test(g("offline")) && !/fa-breathe/.test(g("offline")));
  t("error: offline face plus the danger marker; no other state has the marker", g("error").includes("data-error-marker") && MOODS.filter((m) => m !== "error").every((m) => !g(m).includes("data-error-marker")));
}

// ------------------------------------------------------------------ reduced motion
{
  t("reducedMotion prop adds the static class; default does not", av({ reducedMotion: true }).includes("fa-static") && !av({}).includes("fa-static"));
  t("stylesheet switches every animation off under prefers-reduced-motion and under .fa-static", /@media \(prefers-reduced-motion: reduce\)\{[^}]*animation:none !important/.test(ST.FAYE_AVATAR_CSS.replace(/\n/g, "")) && /\.fayeav\.fa-static \*[^{]*\{animation:none !important\}/.test(ST.FAYE_AVATAR_CSS.replace(/\n/g, "")));
  t("the stylesheet is emitted with a stable href so React de-duplicates it", /href="faye-avatar-v1"/.test(avRaw({})) && /data-precedence="default"/.test(avRaw({})));
}

// ------------------------------------------------------------------ colour discipline
{
  const allowed = new Set(Object.values(JARVIS).map((v) => String(v).toLowerCase()));
  const everything = [...MOODS.flatMap((m) => SIZES.flatMap((sz) => [av({ mood: m, size: sz }), mark({ kind: "claude", mood: m, size: sz })])), ST.FAYE_AVATAR_CSS].join("\n").replace(/url\(#[^)]*\)/g, "");
  const hexes = (everything.match(/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])/g) || []).map((x) => x.toLowerCase());
  t("every hex colour in the markup and stylesheet is a Jarvis token value", hexes.length > 0 && hexes.every((x) => allowed.has(x)), [...new Set(hexes.filter((x) => !allowed.has(x)))].join(","));
  t("no rgb()/hsl() colour literals", !/\b(rgba?|hsla?)\(/.test(everything));
  const vars = [...ST.FAYE_AVATAR_CSS.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]);
  const okVars = new Set(["signal", "verdict", "ink-900", "line-bright", "text-2", "danger", "fa-signal", "fa-verdict", "fa-ink", "fa-bezel", "fa-dim", "fa-danger", "fa-c", "fa-sw", "fa-mw", "fa-blink-d", "fa-blink-o"]);
  t("the stylesheet reads only the Jarvis custom properties it declares", vars.every((v) => okVars.has(v)), [...new Set(vars.filter((v) => !okVars.has(v)))].join(","));
  for (const file of ["FayeAvatar.tsx", "FayeAvatarStyles.tsx", "AgentMark.tsx"]) {
    const src = readFileSync(new URL(`../src/components/faye/${file}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    t(`${file}: no quoted hex literal, no rgb(), no timers, no browser APIs`, !/["'`]#[0-9a-fA-F]{3,8}["'`]/.test(src) && !/\brgba?\(/.test(src) && !/setTimeout|setInterval|requestAnimationFrame|window\.|document\./.test(src));
    t(`${file}: imports only react, the tokens file and its siblings`, [...src.matchAll(/from "([^"]+)"/g)].every((m) => ["react", "@/lib/design/tokens", "./FayeAvatarStyles", "./FayeAvatar"].includes(m[1])));
  }
}

// ------------------------------------------------------------------ contrast of the accents on the ink background
{
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const r = { signal: ratio(JARVIS.signal, JARVIS.ink900), verdict: ratio(JARVIS.verdict, JARVIS.ink900), dim: ratio(JARVIS.text2, JARVIS.ink900), danger: ratio(JARVIS.danger, JARVIS.ink900) };
  console.log("INFO contrast on ink-900:", Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(2)}:1`).join(", "));
  t("signal, verdict, dim and danger all clear 3:1 (WCAG non-text) on ink-900", Object.values(r).every((v) => v >= 3), JSON.stringify(r));
  t("signal and verdict clear 4.5:1 too", r.signal >= 4.5 && r.verdict >= 4.5);
}

// ------------------------------------------------------------------ animation hygiene: transform and opacity only
{
  const css = ST.FAYE_AVATAR_CSS;
  const frames = [...css.matchAll(/@keyframes ([a-z-]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g)];
  const props = new Set<string>();
  for (const m of frames) for (const d of m[2].matchAll(/\{([^}]*)\}/g)) for (const decl of d[1].split(";")) { const p = decl.split(":")[0].trim(); if (p) props.add(p); }
  t("there are keyframes, and they animate only transform and opacity", frames.length >= 8 && [...props].every((p) => p === "transform" || p === "opacity"), [...props].join(","));
  const used = [...css.matchAll(/animation:(fa-[a-z-]+)/g)].map((m) => m[1]);
  t("every animation names a defined keyframe", used.every((u) => frames.some((m) => m[1] === u)), used.join(","));
  t("blink duration sits in 5.0 to 7.0 s", (() => { const d = parseFloat((avRaw({}).match(/--fa-blink-d:([0-9.]+)s/) || [])[1]); return d >= 5 && d <= 7.01; })());
  t("hash32 spreads different ids to different blink rhythms", new Set(["a", "b", "c", "d", "e", "f"].map((x) => AV.hash32(x) % 21)).size >= 4);
}

// ------------------------------------------------------------------ speaking: driven by chunk timing
{
  const withClock = av({ mood: "speaking", size: 48, chunkTick: 3 });
  const noClock = av({ mood: "speaking", size: 48 });
  t("speaking with chunkTick plays one jump and one pulse per change", /class="fa-jump"/.test(withClock) && /fa-pulse/.test(withClock) && !/fa-talk/.test(withClock));
  t("speaking without a chunk clock falls back to a gentle loop", /fa-talk/.test(noClock) && !/fa-pulse/.test(noClock));
  t("chunkTick is ignored outside speaking", !/fa-jump|fa-pulse/.test(av({ mood: "idle", chunkTick: 5 })));
}

// ------------------------------------------------------------------ accessibility options
{
  const dec = av({ mood: "thinking", decorative: true });
  t("decorative: aria-hidden, no role, no label", dec.includes('aria-hidden="true"') && !/role="img"/.test(dec) && !/aria-label/.test(dec));
  const ann = av({ mood: "thinking", announce: true });
  t("announce: a visually hidden polite live region with the state in words", /aria-live="polite"/.test(ann) && ann.includes("Faye is thinking") && /class="fa-sr"/.test(ann));
  t("no live region unless asked", !/aria-live/.test(av({ mood: "thinking" })));
  t("label prop changes the accessible name", av({ label: "Faye (lab)", mood: "unsure" }).includes('aria-label="Faye (lab), unsure"'));
  t("a bad mood falls back to idle; a bad size falls back to 48", av({ mood: "angry" }).includes('data-mood="idle"') && av({ size: NaN }).includes('width="48"') && av({ size: -4 }).includes('width="48"'));
}

// ------------------------------------------------------------------ no layout shift
{
  for (const size of SIZES) {
    const boxes = new Set(MOODS.map((m) => `${attr(av({ mood: m, size }), "viewBox")}|${(av({ mood: m, size }).match(/width:\d+px;height:\d+px/) || [])[0]}`));
    t(`@${size}: every state has the same wrapper box and viewBox`, boxes.size === 1, [...boxes].join(" / "));
  }
}

// ------------------------------------------------------------------ AgentMark
{
  for (const size of SIZES) {
    for (const mood of MOODS) {
      const s = mark({ kind: "claude", mood, size });
      t(`claude ${mood} @${size}: role=img, "Claude, ${mood}", ${size}px`, s.includes('role="img"') && s.includes(`aria-label="Claude, ${mood}"`) && attr(s, "width") === String(size) && s.includes('data-kind="claude"'));
    }
  }
  const cs = (m: string, sz = 160) => mark({ kind: "claude", mood: m, size: sz, reducedMotion: true });
  t("claude: a diamond (rect turned 45 degrees), a centre dot and an orbit tick", /rotate\(45 32 32\)/.test(cs("idle")) && /<circle class="fa-dot[^"]*" cx="32" cy="32" r="4"/.test(cs("idle")) && /class="fa-tick"/.test(cs("idle")));
  t("claude: working states orbit the tick", /fa-tick fa-orbit/.test(cs("thinking")) && /fa-tick fa-orbit/.test(cs("speaking")) && !/fa-orbit/.test(cs("idle")));
  t("claude: unsure and offline swap the dot for a hollow ring and break the outline (not colour alone)", ["unsure", "offline"].every((m) => /fa-hollow/.test(cs(m)) && /stroke-dasharray=/.test(cs(m))) && !/fa-hollow/.test(cs("idle")));
  t("claude: amber by default through the token, dim when offline", /\.agentmark\{--fa-c:var\(--fa-verdict\)\}/.test(ST.FAYE_AVATAR_CSS.replace(/\n/g, "")) && /\.agentmark\[data-mood="offline"\]/.test(ST.FAYE_AVATAR_CSS));
  t("claude: error has the danger marker, nothing else does", cs("error").includes("data-error-marker") && !cs("offline").includes("data-error-marker"));
  t("claude is not a circle face: no eyes or mouth classes", !/fa-eye|fa-line/.test(cs("idle")));
  t("32 px drops the inner diamond and bezel ticks; 160 px has them", !/fa-bezel/.test(mark({ kind: "claude", size: 32 })) && /fa-bezel/.test(mark({ kind: "claude", size: 160 })));
  t("kind faye renders the face, default kind is faye", mark({ kind: "faye", mood: "idle" }).includes("data-faye-avatar") && mark({}).includes("data-faye-avatar"));
  t("claude decorative and announce behave like Faye's", mark({ kind: "claude", decorative: true }).includes('aria-hidden="true"') && mark({ kind: "claude", announce: true, mood: "thinking" }).includes("Claude is thinking"));
  const pair = html(h(AM.AgentPair, { faye: "thinking", claude: "idle", size: 32 }));
  t("AgentPair renders Faye and Claude side by side", pair.includes("Faye, thinking") && pair.includes("Claude, idle") && pair.indexOf("Faye, thinking") < pair.indexOf("Claude, idle"));
}

console.log(failed ? `\n${failed} FAILED` : "\nall faye-avatar checks passed");
process.exit(failed ? 1 : 0);
