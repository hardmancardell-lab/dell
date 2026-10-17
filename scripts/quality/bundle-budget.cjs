// Bundle size check for the home route. Run after `npx next build`:
//   node scripts/quality/bundle-budget.cjs            # print sizes
//   node scripts/quality/bundle-budget.cjs --check    # also fail above the budget
// Method (same as the 2026-10-15 frontend audit): read .next/server/app/page_client-reference-manifest.js, take the JS files
// listed for the page entry and the layout entry plus the build's root main files, and sum their raw and gzip sizes.
// The page entry lists every client chunk the server-rendered payload references, which is what the browser has to fetch for "/".
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const root = path.join(__dirname, "..", "..");
const nextDir = path.join(root, ".next");
const manifestPath = path.join(nextDir, "server", "app", "page_client-reference-manifest.js");
if (!fs.existsSync(manifestPath)) { console.error("No production build found: run `npx next build` first."); process.exit(2); }
const g = {};
new Function("globalThis", fs.readFileSync(manifestPath, "utf8"))(g);
const entry = g.__RSC_MANIFEST["/page"];
const files = new Set();
for (const key of ["[project]/src/app/page", "[project]/src/app/layout"]) for (const f of entry.entryJSFiles[key] || []) files.add(f);
const build = JSON.parse(fs.readFileSync(path.join(nextDir, "build-manifest.json"), "utf8"));
for (const f of build.rootMainFiles || []) files.add(f);
let raw = 0, gz = 0; const rows = [];
for (const f of files) {
  const p = path.join(nextDir, f.replace(/^\/?(_next\/)?/, ""));
  if (!fs.existsSync(p) || !p.endsWith(".js")) continue;
  const b = fs.readFileSync(p); const z = zlib.gzipSync(b).length;
  raw += b.length; gz += z; rows.push([f, b.length, z, /Phaser|WebGLRenderer|rapier/i.test(b.toString("latin1")) ? "HEAVY" : ""]);
}
rows.sort((a, b) => b[1] - a[1]);
for (const r of rows.slice(0, 12)) console.log(`${(r[1] / 1024).toFixed(0).padStart(6)} KB raw ${(r[2] / 1024).toFixed(0).padStart(5)} KB gz  ${r[0]} ${r[3]}`);
console.log(`TOTAL eager JS for "/": ${(raw / 1024).toFixed(0)} KB raw, ${(gz / 1024).toFixed(0)} KB gzip, ${rows.length} files`);
const heavy = rows.filter((r) => r[3]);
if (heavy.length) console.log("game engines in the eager set:", heavy.map((r) => r[0]).join(", "));
if (process.argv.includes("--check")) {
  const BUDGET_GZ_KB = Number(process.env.BUNDLE_BUDGET_GZ_KB || 400);
  if (gz / 1024 > BUDGET_GZ_KB) { console.error(`FAIL: ${(gz / 1024).toFixed(0)} KB gzip is over the ${BUDGET_GZ_KB} KB budget`); process.exit(1); }
  if (heavy.length) { console.error("FAIL: Phaser/Three/Rapier must not be in the home route's eager JS"); process.exit(1); }
  console.log("PASS within budget");
}
