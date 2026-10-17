// @ts-nocheck -- run with the project loader, not compiled by the app build
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/literacy.test.mts
// Financial Literacy integrity checks: answer-key pattern simulations (always-A..D, longest, shortest, absolute-word
// avoidance) over the lesson checks, content shape, and the Quiz Mode XP caps.
import { LITERACY_MODULES, PLACEMENT_QUESTIONS } from "../../src/lib/agents/financial-literacy/skills/curriculum-content.ts";
import { SIGNAL_CHECK_LEVELS } from "../../src/lib/agents/financial-literacy/skills/signal-check-content.ts";
import { planDeltaRound, deltaOutcome, contractCost, CLEAR_TARGET, XP_ON_CLEAR, XP_ON_ATTEMPT } from "../../src/lib/agents/financial-literacy/skills/delta-defender-rules.ts";
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

// ---------- Signal Check: order and cue balance (audit: N,S,N,S order; an urgency-word rule scored 84%)
const URG = /(act now|right now|\bnow\b|before|don.t miss|miss out|guaranteed|sure thing|secret|trick|congratulations|immediately|instantly|press 1|no risk|never loses|proven|erase|pennies|expires?|\bDM\b|follow|whales|insiders|too late|loading up|everyone|limited|urgent|today|hurry|last chance|free)/i;
let scTotal = 0, urgOk = 0, digitOk = 0;
for (const lvl of SIGNAL_CHECK_LEVELS) {
  const seq = lvl.cards.map((c) => (c.isSignal ? "S" : "N")).join("");
  const n = lvl.cards.length, sig = lvl.cards.filter((c) => c.isSignal).length;
  t(`signal check L${lvl.order}: half Signal, half Noise (${sig}/${n})`, sig * 2 === n);
  const alt = [...seq].filter((ch, i) => i > 0 && ch !== seq[i - 1]).length / (n - 1);
  t(`signal check L${lvl.order}: order ${seq} is not alternating (flip rate ${(alt * 100).toFixed(0)}%)`, alt <= 0.75 && !/^(NS)+N?$|^(SN)+S?$/.test(seq));
  t(`signal check L${lvl.order}: no run of more than 2 identical answers`, !/(S{3}|N{3})/.test(seq));
  const alternator = lvl.cards.filter((c, i) => c.isSignal === (i % 2 === 1)).length / n;
  t(`signal check L${lvl.order}: an alternate-guess bot scores at most 70% (${(alternator * 100).toFixed(0)}%)`, Math.max(alternator, 1 - alternator) <= 0.7);
  for (const c of lvl.cards) { scTotal++; if (!URG.test(c.text) === c.isSignal) urgOk++; if (/\d/.test(c.text) === c.isSignal) digitOk++; }
  t(`signal check L${lvl.order}: every card has an explanation and a domain`, lvl.cards.every((c) => c.explanation.length > 10 && !!c.domain));
}
t(`signal check: the urgency-word rule scores ${(100 * urgOk / scTotal).toFixed(0)}% over ${scTotal} cards (was 84%; limit 62%)`, urgOk / scTotal <= 0.62);
t(`signal check: the has-a-number rule scores ${(100 * digitOk / scTotal).toFixed(0)}% (limit 62%)`, digitOk / scTotal <= 0.62);

// ---------- Delta Defender: the clear bonus must be affordable (audit: 8 contracts cost $2,330-$5,764 vs $2,000)
const Ncdf = (x: number) => { const sgn = Math.sign(x); const ax = Math.abs(x) / Math.SQRT2; const tt = 1 / (1 + 0.3275911 * ax); const y = 1 - (((((1.061405429 * tt - 1.453152027) * tt) + 1.421413741) * tt - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-ax * ax); return 0.5 * (1 + sgn * y); };
const bsCall = (S: number, K: number, T: number, r: number, v: number) => { const d1 = (Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)); const d2 = d1 - v * Math.sqrt(T); return { price: S * Ncdf(d1) - K * Math.exp(-r * T) * Ncdf(d2), delta: Ncdf(d1) }; };
let scen = 0, reachable = 0, notAll = 0;
for (const S of [450, 520, 600, 680]) for (const v of [0.12, 0.14, 0.2, 0.3]) for (const days of [2, 7, 14, 30]) {
  scen++;
  const chain = []; for (let k = Math.round(S) - 4; k <= Math.round(S) + 3; k++) { const c = bsCall(S, k, days / 365, 0.04, v); if (c.price * 0.98 > 0) chain.push({ bid: c.price * 0.98, delta: c.delta }); }
  const plan = planDeltaRound(chain);
  const costs = chain.map(contractCost).sort((a, b) => a - b);
  if (costs.slice(0, plan.clearTarget).reduce((a, b) => a + b, 0) <= plan.capital) reachable++;
  if (costs.reduce((a, b) => a + b, 0) > plan.capital) notAll++;
}
t(`delta defender: the goal (${CLEAR_TARGET} contracts) is affordable in ${reachable}/${scen} modeled chains`, reachable === scen);
t(`delta defender: engaging all 8 is NOT affordable in most modeled chains (${notAll}/${scen}), so cost still forces choices`, notAll / scen >= 0.6);
t("delta defender: zero engaged pays no XP and does not complete the module", deltaOutcome(0, 5).award === false && deltaOutcome(0, 5).xp === 0);
t("delta defender: reaching the goal pays the clear XP, fewer pays the attempt XP", deltaOutcome(5, 5).xp === XP_ON_CLEAR && deltaOutcome(5, 5).cleared && deltaOutcome(2, 5).xp === XP_ON_ATTEMPT && !deltaOutcome(2, 5).cleared);
t("delta defender: a 3-contract chain sets its goal to 3", planDeltaRound([{ bid: 1 }, { bid: 2 }, { bid: 3 }]).clearTarget === 3);

console.log(bad ? `${bad} FAILED, ${passed} passed` : `ALL PASS (${passed} checks)`);
process.exit(bad ? 1 : 0);
