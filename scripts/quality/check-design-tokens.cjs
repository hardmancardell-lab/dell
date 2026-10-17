// Design-token ratchet. Run: node scripts/quality/check-design-tokens.cjs [--update] [--verbose]
// Ported from the 2026-10-15 UI audit (scratch/ui-design/check-design-tokens.js). Counts, over src/components and src/app *.tsx:
//   hex       quoted hex colour literals ("#4fe8d0") outside src/lib/design/tokens.ts
//   rgb       rgb()/rgba() literals
//   mixed     files that use jv- classes AND Tailwind zinc/gray/slate/neutral colour classes
//   unlabeled files where fewer than half of the input/select/textarea controls carry a label, aria-label or htmlFor
//   islands   files that open their own className="jarvis" island (nested islands are neutralised in CSS, but each one is debt)
// Fails when any count rises above scripts/quality/check-design-tokens.baseline.json, and ALWAYS fails if
// src/lib/design/tokens.ts drifts from the .jarvis custom properties in globals.css. --update lowers the baseline
// (it refuses to raise a count; edit the file by hand with a reason if that is ever justified).
const fs = require("fs");
const path = require("path");
const rootArg = process.argv.indexOf("--root");
const root = rootArg > 0 ? path.resolve(process.argv[rootArg + 1]) : path.join(__dirname, "..", "..");
const src = path.join(root, "src");
const baselinePath = path.join(__dirname, "check-design-tokens.baseline.json");
const verbose = process.argv.includes("--verbose");

function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = walk(path.join(src, "components"), []).concat(walk(path.join(src, "app"), []));
const viol = { hex: [], rgb: [], mixed: [], unlabeled: [], islands: [] };
for (const f of files) {
  const rel = path.relative(src, f).replace(/\\/g, "/");
  const s = fs.readFileSync(f, "utf8");
  const code = s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  (code.match(/["'`]#[0-9a-fA-F]{3,8}["'`]/g) || []).forEach((h) => viol.hex.push(rel + " " + h));
  (code.match(/\brgba?\(\s*\d+[^)]*\)/g) || []).forEach((r) => viol.rgb.push(rel + " " + r));
  if (/\bjv-[a-z]/.test(code) && /\b(?:bg|text|border)-(?:zinc|gray|slate|neutral)-\d{2,3}\b/.test(code)) viol.mixed.push(rel);
  const ctrls = (code.match(/<(input|select|textarea)\b/g) || []).length;
  const labels = (code.match(/<label\b|aria-label=|aria-labelledby=|htmlFor=/g) || []).length;
  if (ctrls > 0 && labels < ctrls * 0.5) viol.unlabeled.push(`${rel} controls=${ctrls} labels=${labels}`);
  if (/className="jarvis(\s[^"]*)?"/.test(code)) viol.islands.push(rel);
}
const counts = Object.fromEntries(Object.entries(viol).map(([k, v]) => [k, v.length]));

let bad = 0;
// ---- tokens.ts must mirror globals.css
{
  const css = fs.readFileSync(path.join(src, "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf("--ink-950:"));
  const tokens = fs.readFileSync(path.join(src, "lib", "design", "tokens.ts"), "utf8");
  const map = { ink950: "ink-950", ink900: "ink-900", ink800: "ink-800", ink700: "ink-700", line: "line", lineBright: "line-bright", lineControl: "line-control", signal: "signal", signalDim: "signal-dim", verdict: "verdict", verdictDim: "verdict-dim", danger: "danger", text0: "text-0", text1: "text-1", text2: "text-2" };
  for (const [k, cssName] of Object.entries(map)) {
    const a = (block.match(new RegExp("--" + cssName + ": *(#[0-9a-fA-F]{6})")) || [])[1];
    const b = (tokens.match(new RegExp("\\b" + k + ': *"(#[0-9a-fA-F]{6})"')) || [])[1];
    if (!a || !b || a.toLowerCase() !== b.toLowerCase()) { bad++; console.error(`DRIFT tokens.ts ${k} (${b}) != globals.css --${cssName} (${a})`); }
  }
}

console.log(JSON.stringify(counts));
if (verbose) for (const [k, v] of Object.entries(viol)) { console.log(`\n${k} (${v.length})`); v.slice(0, 40).forEach((x) => console.log("  " + x)); }

if (process.argv.includes("--update")) {
  const base = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null;
  const next = {};
  for (const k of Object.keys(counts)) next[k] = base ? Math.min(base[k] ?? counts[k], counts[k]) : counts[k];
  if (base) for (const k of Object.keys(counts)) if (counts[k] > (base[k] ?? Infinity)) console.error(`not raising ${k}: ${counts[k]} > baseline ${base[k]}`);
  fs.writeFileSync(baselinePath, JSON.stringify(next, null, 1) + "\n");
  console.log("baseline written", JSON.stringify(next));
  process.exit(bad ? 1 : 0);
}
if (!fs.existsSync(baselinePath)) { console.error("no baseline: run with --update once"); process.exit(2); }
const base = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
for (const k of Object.keys(counts)) if (counts[k] > (base[k] ?? 0)) { bad++; console.error(`REGRESSION ${k}: ${counts[k]} > baseline ${base[k]}`); }
console.log(bad ? `${bad} problem(s)` : "PASS (no count above its baseline, tokens.ts matches globals.css)");
process.exit(bad ? 1 : 0);
