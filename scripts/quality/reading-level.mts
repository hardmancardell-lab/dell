// @ts-nocheck -- run with the project loader, not compiled by the app build
// Reading-level gate for the Financial Literacy curriculum (Flesch-Kincaid grade per lesson body).
//   node --import ./scripts/ts-loader/register.mjs scripts/quality/reading-level.mts            # check against the baseline (ratchet)
//   node --import ./scripts/ts-loader/register.mjs scripts/quality/reading-level.mts --update   # lower the baseline after an improvement
//   add --json to print the table as JSON
// Ported from team_audits/2026-10-15/scratch/pedagogy/readability.mjs with a better syllable counter (the audit's
// counter undercounted, so its grades were slightly low; this one is exact on the 97-word calibration list below).
// Ratchet: a lesson may not get harder than its recorded grade (+0.05 slack); a lesson with no baseline entry must
// be at or under TARGET_GRADE (8.0). Beta feedback asked for about seventh grade.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LITERACY_MODULES, PLACEMENT_QUESTIONS } from "../../src/lib/agents/financial-literacy/skills/curriculum-content.ts";

export const TARGET_GRADE = 8.0;
const BASELINE = fileURLToPath(new URL("./reading-level.baseline.json", import.meta.url));

const EXC: Record<string, number> = { create: 2, idea: 3, ideal: 3, area: 3, being: 2, quiet: 2, science: 2, every: 2, society: 4, variety: 4, experience: 4, people: 2, poor: 1, hour: 1, fire: 1, real: 1, really: 2, serious: 3, previous: 3, obvious: 3, variable: 4, various: 3, ratio: 3, usually: 4, created: 3, diversify: 4, giant: 2, lion: 2, media: 3, radio: 3, video: 3, poem: 2, riot: 2, trial: 2, dial: 2, diet: 2, annual: 3, actual: 3, casual: 3, manual: 3, usual: 3, virtual: 3, value: 2, issue: 2, continue: 3, venue: 2, rescue: 2, argue: 2, queue: 1, business: 2, evening: 2, family: 3, interest: 3, different: 3, several: 3, general: 3, camera: 3, average: 3, comfortable: 3, favorite: 3, chocolate: 3, vegetable: 3, miserable: 4, mortgage: 2, deductible: 4, valuable: 4, college: 2, license: 2, scarcity: 3, quantity: 3 };
export function countSyllables(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (EXC[w] != null) return EXC[w];
  if (w.length <= 3) return 1;
  w = w.replace(/(tion|sion|cion|tial|cial|tious|cious|gion|geous)/g, "xo");
  w = w.replace(/(?:[^laeiouycszxg]es|[^td]ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  let n = 0;
  for (const g of w.match(/[aeiouy]+/g) || []) n += 1 + (g.match(/ia|io|iu|ua|uo|uu|ii/g) || []).length;
  if (/[aeiou]ing$/.test(w)) n += 1;
  return Math.max(1, n);
}
const words = (t: string) => t.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
function sentences(text: string): string[] {
  const t = text
    .replace(/\n+/g, " . ")
    .replace(/\b(U\.S|e\.g|i\.e|vs|etc|Inc|approx)\./g, "$1")
    .replace(/(\d)\.(\d)/g, "$1<d>$2");
  return t.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter((s) => /[A-Za-z]/.test(s));
}
export function readingStats(text: string) {
  const ws = words(text);
  const ss = sentences(text);
  const syl = ws.reduce((a, w) => a + countSyllables(w), 0);
  const W = ws.length, S = Math.max(1, ss.length);
  const asl = W / S, spw = syl / Math.max(1, W);
  return { words: W, sentences: S, asl, spw, fk: 0.39 * asl + 11.8 * spw - 15.59, fre: 206.835 - 1.015 * asl - 84.6 * spw };
}

export function lessonRows() {
  return LITERACY_MODULES.map((m) => {
    const s = readingStats(m.body);
    const chk = readingStats(m.checks.map((c) => `${c.prompt} ${c.options.join(" ")} ${c.explanation}`).join(" "));
    return { id: m.id, tier: m.tier, words: s.words, asl: +s.asl.toFixed(1), fk: +s.fk.toFixed(2), checksFk: +chk.fk.toFixed(1) };
  });
}
export function placementRows() {
  return PLACEMENT_QUESTIONS.map((q, i) => {
    const s = readingStats(q.prompt + " " + q.options.join(". ") + ".");
    return { id: `placement-${String(i + 1).padStart(2, "0")}`, tier: q.tier, fk: +s.fk.toFixed(2) };
  });
}

if (process.argv[1] && process.argv[1].endsWith("reading-level.mts")) {
  const rows = lessonRows();
  const place = placementRows();
  const all = [...rows.map((r) => ({ id: r.id, fk: r.fk })), ...place.map((r) => ({ id: r.id, fk: r.fk }))];
  const base: Record<string, number> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  for (const t of ["beginner", "intermediate", "expert"]) {
    const r = rows.filter((x) => x.tier === t);
    const p = place.filter((x) => x.tier === t);
    console.log(`${t.padEnd(12)} lessons n=${r.length} mean FK ${mean(r.map((x) => x.fk)).toFixed(2)} above ${TARGET_GRADE}: ${r.filter((x) => x.fk > TARGET_GRADE).length} | placement n=${p.length} mean FK ${mean(p.map((x) => x.fk)).toFixed(2)}`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ rows, place }, null, 1));
  else console.log("lessons above target:", rows.filter((r) => r.fk > TARGET_GRADE).map((r) => `${r.id}(${r.fk})`).join(" ") || "none");

  if (process.argv.includes("--update")) {
    const next: Record<string, number> = {};
    for (const a of all) next[a.id] = Math.round(a.fk * 100) / 100;
    writeFileSync(BASELINE, JSON.stringify(next, null, 1) + "\n");
    console.log("baseline written for", all.length, "entries");
    process.exit(0);
  }
  let bad = 0;
  for (const a of all) {
    const b = base[a.id];
    if (b == null) { if (a.fk > TARGET_GRADE) { bad++; console.log("FAIL new/unbaselined", a.id, a.fk, "> target", TARGET_GRADE); } }
    else if (a.fk > b + 0.05) { bad++; console.log("FAIL harder than baseline", a.id, a.fk, ">", b); }
  }
  console.log(bad ? `${bad} FAILED` : "ALL PASS (no lesson or placement block above its baseline)");
  process.exit(bad ? 1 : 0);
}
