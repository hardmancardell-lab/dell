// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/placement.test.mts
// Ported from the 2026-10-15 pedagogy audit (placement.mjs): the placement rule, its monotonicity over all 343
// per-tier score combinations, boundary cases, and the answer-pattern strategies that used to place a guesser in Expert.
import { PLACEMENT_QUESTIONS } from "../../src/lib/agents/financial-literacy/skills/curriculum-content.ts";
import { placeLearner, QUESTIONS_PER_TIER, TARGET_TIER_BAR, LOWER_TIER_BAR } from "../../src/lib/agents/financial-literacy/placement.ts";
import { LITERACY_TIER_ORDER } from "../../src/lib/agents/financial-literacy/types.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };
const P = (b: number, i: number, e: number) => placeLearner({ beginner: b, intermediate: i, expert: e });

// ---- question set shape (the "nine questions" copy was stale: it is 18, six per tier)
const perTier = { beginner: 0, intermediate: 0, expert: 0 };
PLACEMENT_QUESTIONS.forEach((q) => perTier[q.tier]++);
t("18 placement questions", PLACEMENT_QUESTIONS.length === 18, String(PLACEMENT_QUESTIONS.length));
t("6 per tier", LITERACY_TIER_ORDER.every((k) => perTier[k] === QUESTIONS_PER_TIER), JSON.stringify(perTier));
t("every question has 4 distinct options and a valid key", PLACEMENT_QUESTIONS.every((q) => q.options.length === 4 && new Set(q.options).size === 4 && q.correctIndex >= 0 && q.correctIndex <= 3));
t("bars are reachable with the real per-tier count", TARGET_TIER_BAR <= QUESTIONS_PER_TIER && LOWER_TIER_BAR < TARGET_TIER_BAR);

// ---- 343-combination enumeration
const counts = { beginner: 0, intermediate: 0, expert: 0 };
let combos = 0, violations = 0;
for (let b = 0; b <= 6; b++) for (let i = 0; i <= 6; i++) for (let e = 0; e <= 6; e++) {
  combos++;
  const base = LITERACY_TIER_ORDER.indexOf(P(b, i, e));
  counts[P(b, i, e)]++;
  for (const [bb, ii, ee] of [[b + 1, i, e], [b, i + 1, e], [b, i, e + 1]]) {
    if (bb > 6 || ii > 6 || ee > 6) continue;
    if (LITERACY_TIER_ORDER.indexOf(P(bb, ii, ee)) < base) violations++;
  }
}
t("343 combinations enumerated", combos === 343, String(combos));
t("monotonic: raising any tier score never lowers placement (0 violations)", violations === 0, String(violations));
t("distribution matches the audit (295 / 30 / 18)", counts.beginner === 295 && counts.intermediate === 30 && counts.expert === 18, JSON.stringify(counts));

// ---- boundaries
const cases: Array<[number, number, number, string]> = [[6, 0, 0, "beginner"], [6, 3, 0, "beginner"], [3, 6, 6, "beginner"], [4, 4, 4, "beginner"], [4, 5, 0, "intermediate"], [6, 6, 4, "intermediate"], [5, 5, 5, "expert"], [4, 5, 5, "expert"], [4, 4, 5, "expert"], [3, 4, 5, "beginner"], [6, 0, 6, "beginner"], [6, 6, 6, "expert"], [0, 0, 0, "beginner"]];
for (const [b, i, e, want] of cases) t(`boundary ${b}/${i}/${e} -> ${want}`, P(b, i, e) === want, P(b, i, e));

// ---- answer-pattern strategies (the audit's exploit: every key was B and the longest option)
function score(pick: (q: any) => number) {
  const s = { beginner: 0, intermediate: 0, expert: 0 };
  for (const q of PLACEMENT_QUESTIONS) if (pick(q) === q.correctIndex) s[q.tier]++;
  return s;
}
const argmax = (q: any, f: (o: string) => number) => q.options.reduce((bi: number, o: string, i: number) => (f(o) > f(q.options[bi]) ? i : bi), 0);
for (const [label, idx] of [["A", 0], ["B", 1], ["C", 2], ["D", 3]] as const) {
  const s = score(() => idx);
  t(`always-${label} places Beginner`, P(s.beginner, s.intermediate, s.expert) === "beginner", JSON.stringify(s));
  t(`always-${label} scores at most 6 of 18 (no tier of 6 with the same letter)`, s.beginner + s.intermediate + s.expert <= 6, JSON.stringify(s));
}
const longest = score((q) => argmax(q, (o) => o.length));
const shortest = score((q) => argmax(q, (o) => -o.length));
t("longest-option places Beginner (not Expert)", P(longest.beginner, longest.intermediate, longest.expert) === "beginner", JSON.stringify(longest));
t("longest-option scores at most 8 of 18 (chance is 4.5)", longest.beginner + longest.intermediate + longest.expert <= 8, JSON.stringify(longest));
t("shortest-option places Beginner", P(shortest.beginner, shortest.intermediate, shortest.expert) === "beginner", JSON.stringify(shortest));

// ---- exact binomial: pure guessing should almost never reach a higher tier
const choose = (n: number, k: number) => { let r = 1; for (let j = 1; j <= k; j++) r = (r * (n - k + j)) / j; return r; };
const pmf = Array.from({ length: 7 }, (_, k) => choose(6, k) * 0.25 ** k * 0.75 ** (6 - k));
let upper = 0;
for (let b = 0; b <= 6; b++) for (let i = 0; i <= 6; i++) for (let e = 0; e <= 6; e++) if (P(b, i, e) !== "beginner") upper += pmf[b] * pmf[i] * pmf[e];
t("random guessing places above Beginner less than 0.05%", upper < 0.0005, upper.toExponential(2));

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
