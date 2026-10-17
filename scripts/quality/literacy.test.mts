// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/literacy.test.mts
// Financial Literacy integrity checks: answer-key pattern simulations (always-A..D, longest, shortest, absolute-word
// avoidance) over the lesson checks, content shape, and the Quiz Mode XP caps.
import { LITERACY_MODULES, PLACEMENT_QUESTIONS } from "../../src/lib/agents/financial-literacy/skills/curriculum-content.ts";
import { applyQuizXp, EMPTY_QUIZ_XP, QUIZ_XP_DAILY_CAP, localDateKey, quizQuestionKey } from "../../src/lib/agents/financial-literacy/quiz-xp.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };

// ---------- content shape
const checks = LITERACY_MODULES.flatMap((m) => m.checks.map((c, i) => ({ id: `${m.id}#${i}`, tier: m.tier, c })));
t("48 lessons, 3 checks each", LITERACY_MODULES.length === 48 && LITERACY_MODULES.every((m) => m.checks.length === 3));
t("ids unique and ordered inside each tier", new Set(LITERACY_MODULES.map((m) => m.id)).size === 48 && ["beginner", "intermediate", "expert"].every((tier) => LITERACY_MODULES.filter((m) => m.tier === tier).every((m, i) => m.order === i + 1)));
t("every check has 4 distinct non-empty options and a valid key", checks.every(({ c }) => c.options.length === 4 && new Set(c.options).size === 4 && c.options.every((o) => o.trim().length > 0) && Number.isInteger(c.correctIndex) && c.correctIndex >= 0 && c.correctIndex <= 3));
t("no option points at other options (None/All of the above, Both A and B)", checks.every(({ c }) => c.options.every((o) => !/\b(none|all) of (these|the above)\b|\bboth (a|b)\b/i.test(o))));

// ---------- answer-key position and length parity
const sets: Array<[string, any[]]> = [["lesson checks", checks.map((x) => x.c)], ["placement", PLACEMENT_QUESTIONS], ...(["beginner", "intermediate", "expert"] as const).map((tier): [string, any[]] => [tier + " checks", checks.filter((x) => x.tier === tier).map((x) => x.c)])];
for (const [name, items] of sets) {
  const pos = [0, 0, 0, 0]; items.forEach((q) => pos[q.correctIndex]++);
  const share = pos.map((n) => n / items.length);
  const limit = items.length >= 80 ? [0.18, 0.32] : items.length >= 24 ? [0.12, 0.38] : [0.1, 0.4];
  t(`${name}: key positions A-D = ${pos.join("/")} each within ${limit[0] * 100}-${limit[1] * 100}%`, share.every((s) => s >= limit[0] && s <= limit[1]));
  let run = 1, maxRun = 1; for (let i = 1; i < items.length; i++) { run = items[i].correctIndex === items[i - 1].correctIndex ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  t(`${name}: no key repeats more than twice in a row`, maxRun <= 2, String(maxRun));
}
const allItems = [...checks.map((x) => x.c), ...PLACEMENT_QUESTIONS];
const longestCount = allItems.filter((q) => { const L = q.options.map((o: string) => o.length); const others = L.filter((_: number, i: number) => i !== q.correctIndex); return L[q.correctIndex] > Math.max(...others); }).length;
t(`correct option is strictly the longest in at most 33% of items (${longestCount}/${allItems.length})`, longestCount / allItems.length <= 0.33);
const ratio = allItems.reduce((a, q) => { const L = q.options.map((o: string) => o.length); const o = L.filter((_: number, i: number) => i !== q.correctIndex); return a + L[q.correctIndex] / (o.reduce((x: number, y: number) => x + y, 0) / 3); }, 0) / allItems.length;
t(`mean correct/wrong length ratio <= 1.3 (${ratio.toFixed(2)})`, ratio <= 1.3);

// ---------- answer-pattern simulations (expected accuracy, ties split evenly); chance is 25%
const ABS = /\b(always|never|guaranteed|exactly|completely|definitely|entirely|forever|surely|certainly|impossible|every|none|nothing|nobody|no one)\b/i;
function acc(items: any[], pick: (q: any) => number[]) {
  let s = 0; for (const q of items) { const w = pick(q); if (w.includes(q.correctIndex)) s += 1 / w.length; } return s / items.length;
}
const best = (q: any, f: (o: string) => number) => { const v = q.options.map(f); const m = Math.max(...v); return v.map((x: number, i: number) => (x === m ? i : -1)).filter((i: number) => i >= 0); };
const strategies: Array<[string, (q: any) => number[]]> = [
  ["always A", () => [0]], ["always B", () => [1]], ["always C", () => [2]], ["always D", () => [3]],
  ["longest option", (q) => best(q, (o) => o.length)],
  ["shortest option", (q) => best(q, (o) => -o.length)],
  ["avoid absolute words, then longest", (q) => { const ok = q.options.map((o: string, i: number) => (ABS.test(o) ? -1 : i)).filter((i: number) => i >= 0); const pool = ok.length ? ok : [0, 1, 2, 3]; const m = Math.max(...pool.map((i: number) => q.options[i].length)); return pool.filter((i: number) => q.options[i].length === m); }],
  ["has the most digits", (q) => best(q, (o) => (o.match(/\d/g) || []).length)],
];
for (const [name, pick] of strategies) {
  const a = acc(allItems, pick);
  t(`strategy "${name}" scores ${(a * 100).toFixed(1)}% over all ${allItems.length} items (limit 36%)`, a <= 0.36);
  for (const [label, items] of [["lesson checks", checks.map((x) => x.c)], ["beginner", checks.filter((x) => x.tier === "beginner").map((x) => x.c)]] as const) {
    const a2 = acc(items, pick);
    t(`  ${name} on ${label}: ${(a2 * 100).toFixed(1)}% (limit 38%)`, a2 <= 0.38);
  }
}

// ---------- Quiz Mode XP caps
const today = "2026-10-17";
let st = { ...EMPTY_QUIZ_XP }, total = 0;
const award = (key: string, xp = 10, day = today) => { const r = applyQuizXp(st, key, xp, day); st = r.next; total += r.awarded; return r.awarded; };
t("first correct answer to a question pays XP", award("beginner-01#0") === 10);
t("the same question never pays twice", award("beginner-01#0") === 0);
let n = 1; while (award(quizQuestionKey("m", n)) > 0) n++;
t(`per-day cap stops payouts at ${QUIZ_XP_DAILY_CAP} XP`, total === QUIZ_XP_DAILY_CAP, String(total));
t("a capped-out question is not burned (pays on a later day)", award("late#0", 10, "2026-10-18") === 10);
t("a new day resets the daily counter", st.quizXpToday === 10 && st.quizXpDate === "2026-10-18");
const partial = applyQuizXp({ quizXpDate: today, quizXpToday: 95, quizXpQuestionKeys: [] }, "x#0", 10, today);
t("the last XP of the day is trimmed to fit the cap", partial.awarded === 5 && partial.next.quizXpToday === 100);
t("negative or zero requests award nothing", applyQuizXp(EMPTY_QUIZ_XP, "y#0", -5, today).awarded === 0);
t("localDateKey is the local calendar day", localDateKey(new Date(2026, 9, 17, 23, 30)) === "2026-10-17");
t("a lifetime of 144 questions can never pay more than 1440 XP from quiz answers", 144 * 10 === 1440);

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
