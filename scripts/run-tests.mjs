// Runs every offline test in scripts/*.test.mts and scripts/quality/*.test.mts through the TypeScript loader.
//
//   node scripts/run-tests.mjs            run all offline tests
//   LIVE=1 node scripts/run-tests.mjs     also run the tests that need the network / real keys
//   node scripts/run-tests.mjs vwap       only files whose path contains "vwap"
//
// A test file is treated as needing the network when its first 10 lines contain the marker "requires-network".
// Exit code is non-zero when any test fails or crashes. No secrets are needed: every offline test uses fakes.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.env.LIVE === "1";
const filter = process.argv[2] ?? "";
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS ?? 600_000);

function discover() {
  const out = [];
  for (const dir of ["scripts", "scripts/quality"]) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).sort()) if (f.endsWith(".test.mts")) out.push(join(dir, f).replaceAll("\\", "/"));
  }
  return out;
}

const files = discover().filter((f) => f.includes(filter));
const results = [];
for (const rel of files) {
  const head = readFileSync(join(ROOT, rel), "utf8").split("\n").slice(0, 10).join("\n");
  if (/requires-network/.test(head) && !LIVE) {
    results.push({ rel, status: "SKIP", note: "needs network (set LIVE=1)", ms: 0 });
    continue;
  }
  const started = Date.now();
  const r = spawnSync(process.execPath, ["--import", "./scripts/ts-loader/register.mjs", rel], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const ms = Date.now() - started;
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const fails = (text.match(/^FAIL\b/gm) ?? []).length;
  const passes = (text.match(/^PASS\b/gm) ?? []).length;
  const ok = r.status === 0 && fails === 0;
  results.push({ rel, status: ok ? "PASS" : "FAIL", note: `${passes} pass${fails ? `, ${fails} FAIL` : ""}${r.status !== 0 ? `, exit ${r.status ?? r.signal}` : ""}`, ms });
  if (!ok) {
    const lines = text.split("\n").filter((l) => /^FAIL\b|Error|error:/.test(l)).slice(0, 12);
    console.log(`--- ${rel} failed:\n${lines.join("\n") || text.slice(-1500)}\n`);
  }
}

console.log("\nTest summary");
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.rel.padEnd(52)} ${r.note}${r.ms ? ` (${(r.ms / 1000).toFixed(1)}s)` : ""}`);
const failed = results.filter((r) => r.status === "FAIL").length;
const passed = results.filter((r) => r.status === "PASS").length;
const skipped = results.filter((r) => r.status === "SKIP").length;
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped, ${results.length} files`);
process.exit(failed > 0 ? 1 : 0);
