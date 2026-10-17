// Contrast gate for the .jarvis design tokens. Run: node scripts/quality/check-design-tokens-contrast.cjs
// Parses the custom properties out of src/app/globals.css (so a token edit cannot drift from this test) and asserts
//   - every text token reads >= 4.5:1 on every surface token (WCAG 1.4.3),
//   - the control-border and focus-ring tokens are >= 3:1 on the surfaces controls sit on (WCAG 1.4.11).
const fs = require("fs");
const path = require("path");
const css = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "globals.css"), "utf8");
const block = css.slice(css.indexOf("--ink-950:"));
const tok = (n) => {
  const m = block.match(new RegExp("--" + n + ": *(#[0-9a-fA-F]{6})"));
  if (!m) throw new Error("token --" + n + " not found in globals.css");
  return m[1];
};
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const surfaces = ["ink-950", "ink-900", "ink-800", "ink-700"];
const texts = ["text-0", "text-1", "text-2", "signal", "verdict", "danger"];
let bad = 0;
const check = (name, r, min) => { const ok = r >= min; if (!ok) bad++; console.log(ok ? "PASS" : "FAIL", name, r.toFixed(2), ">=", min); };
for (const t of texts) for (const s of surfaces) check(`${t} on ${s}`, ratio(tok(t), tok(s)), 4.5);
for (const s of ["ink-950", "ink-900"]) check(`line-control border on ${s}`, ratio(tok("line-control"), tok(s)), 3);
for (const s of surfaces) check(`focus-ring on ${s}`, ratio(tok("focus-ring"), tok(s)), 3);
if (!/:focus-visible/.test(css)) { bad++; console.log("FAIL no :focus-visible rule in globals.css"); }
if (/\.jv-input:focus[^}]*outline:\s*none/.test(css)) { bad++; console.log("FAIL outline:none on .jv-input:focus"); }
console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
