// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/quality/ledger-family-size.test.mts
// Strategy ledger family-size column (2026-10-19): row mapping, write that survives a missing column (retry once without
// it, remembered for a few minutes), reads that tolerate the column being absent, the legacy-rule test, and the
// Guided Trade Signals filter that keeps rows judged under the old, weaker rule out. No network, no database.
import { pathToFileURL } from "node:url";
import { makeT, setFakeEnv } from "../fixtures/fake-fetch.mts";

process.env.SUPABASE_URL = "http://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const REPO = process.env.REPO ?? process.cwd();
const imp = (p: string) => import(pathToFileURL(`${REPO}/src/${p}`).href);
const DB = await imp("lib/data/hypothesis-ledger-db.ts");
const RULE = await imp("lib/agents/trading-agent/skills/hypothesis-rule.ts");
const SWEEP = await imp("lib/agents/trading-agent/skills/hypothesis-sweep.ts");
const GUIDED = await imp("lib/agents/trading-agent/skills/guided-trade-signals.ts");
setFakeEnv();
const { t, summary } = makeT();
console.warn = () => {};

const baseRow = (over = {}) => ({
  id: "h1", created_at: "2026-10-19T00:00:00Z", ticker: "NVDA", asset_class: "equity", strategy_type: "momentum", horizon_label: "5d forward",
  entry_rule: "e", exit_type: "time", exit_rule: "Fixed 5-trading-day forward hold. [Corrected for 368 hypotheses tested together in this run.]",
  sample_size: 40, win_rate_pct: 70, profit_factor: 2, passes_three_bars: true, p_value_fdr: 0.01, bootstrap_ci_lower: 1, bootstrap_ci_upper: 3,
  status: "validated", rejection_reason: null, source_engine: "historical-backtest", entropy_score: 0.5, largest_loss_pct: -3, max_drawdown_pct: 5, stop_loss_verdict: null, ...over,
});
const hyp = (over = {}) => ({ ...DB.toHypothesis(baseRow()), ...over });

const candBase = (ticker: string) => ({ ticker, assetClass: "equity", strategyType: "s", horizonLabel: "h", entryRule: "e", exitType: "time", exitRule: "x", sampleSize: 50, winRatePct: 40, profitFactor: 0.9, bootstrapCiLower: 1, bootstrapCiUpper: 2, sourceEngine: "historical-backtest", entropyScore: null, largestLossPct: -3, maxDrawdownPct: 5, stopLossVerdict: null });

// ------------------------------------------------------------------ 1. parsing (same text the SQL backfill reads)
t("parse: reads N from the exit-rule text", RULE.parseFdrFamilySize("x [Corrected for 368 hypotheses tested together in this run.]") === 368);
t("parse: family of 1 is allowed", RULE.parseFdrFamilySize("Corrected for 1 hypotheses tested together") === 1);
t("parse: zero is not a family size", RULE.parseFdrFamilySize("Corrected for 0 hypotheses tested together") === null);
t("parse: no text, null and non-strings give null", RULE.parseFdrFamilySize("Fixed 5-day hold") === null && RULE.parseFdrFamilySize(null) === null && RULE.parseFdrFamilySize(undefined) === null);
t("parse: absurdly long digit strings are not read", RULE.parseFdrFamilySize("Corrected for 12345678901234 hypotheses tested together") === null);
{
  const rows = SWEEP.finalizeCandidates([
    { rawP: 0.0001, ciExcludesZero: true, sameSignOutOfSample: true, base: candBase("X") },
    { rawP: 0.9, ciExcludesZero: true, sameSignOutOfSample: true, base: candBase("Y") },
  ]);
  t("sweep: every row carries fdrFamilySize equal to the run's family", rows.every((r) => r.fdrFamilySize === 2));
  t("sweep: the text the sweep writes is parsed back to the same number", rows.every((r) => RULE.parseFdrFamilySize(r.exitRule) === r.fdrFamilySize));
}

// ------------------------------------------------------------------ 2. mapping
{
  const withCol = DB.toHypothesis(baseRow({ fdr_family_size: 368 }));
  t("read: column value maps to fdrFamilySize", withCol.fdrFamilySize === 368);
  t("read: column absent (before the migration) maps to null without error", DB.toHypothesis(baseRow()).fdrFamilySize === null);
  t("read: a null or bad column value maps to null", DB.toHypothesis(baseRow({ fdr_family_size: null })).fdrFamilySize === null && DB.toHypothesis(baseRow({ fdr_family_size: 0 })).fdrFamilySize === null);
  const h = { ...DB.toHypothesis(baseRow({ fdr_family_size: 368 })) };
  delete h.id;
  delete h.createdAt;
  t("write: the body carries fdr_family_size when asked", DB.hypothesisToRow(h, true).fdr_family_size === 368);
  t("write: the body leaves it out when not asked", !("fdr_family_size" in DB.hypothesisToRow(h, false)));
  t("write: no family size, nothing sent", !("fdr_family_size" in DB.hypothesisToRow({ ...h, fdrFamilySize: null }, true)));
  t(
    "effective size: column first, then the text, then null",
    RULE.effectiveFdrFamilySize({ fdrFamilySize: 12, exitRule: "Corrected for 368 hypotheses tested together" }) === 12 &&
      RULE.effectiveFdrFamilySize({ fdrFamilySize: null, exitRule: "Corrected for 368 hypotheses tested together" }) === 368 &&
      RULE.effectiveFdrFamilySize({ fdrFamilySize: null, exitRule: "Fixed hold" }) === null
  );
}

// ------------------------------------------------------------------ 3. write fallback when the column does not exist
const NOW0 = 1_800_000_000_000;
let clock = NOW0;
Date.now = () => clock;
let calls: { method: string; url: string; body: any }[] = [];
function fakeServer(handler: (call: any, n: number) => Response) {
  calls = [];
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const call = { method: init.method ?? "GET", url: String(input), body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return handler(call, calls.length);
  }) as typeof fetch;
}
const resp = (body: any, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const missingCol = () => resp({ code: "42703", message: 'column "fdr_family_size" of relation "strategy_hypotheses" does not exist' }, 400);
const hasCol = (c) => "fdr_family_size" in (c.body ?? {});
const toInsert = () => {
  const h = DB.toHypothesis(baseRow({ fdr_family_size: 368 }));
  delete h.id;
  delete h.createdAt;
  return h;
};

{
  DB.resetFdrColumnMemory();
  fakeServer((c) => (hasCol(c) ? missingCol() : resp([], 201)));
  await DB.insertHypothesis(toInsert());
  t("fallback: first write tries the column, fails, and retries ONCE without it", calls.length === 2 && hasCol(calls[0]) && !hasCol(calls[1]));
  t("fallback: the retried row is otherwise identical", calls[1].body.exit_rule === calls[0].body.exit_rule && calls[1].body.ticker === "NVDA");
  fakeServer(() => resp([], 201));
  await DB.insertHypothesis(toInsert());
  await DB.insertHypothesis(toInsert());
  t("memory: the next writes within the window skip the column and make exactly one call each", calls.length === 2 && calls.every((c) => !hasCol(c)));
  clock = NOW0 + DB.MISSING_COLUMN_MEMORY_MS + 1000;
  fakeServer(() => resp([], 201));
  await DB.insertHypothesis(toInsert());
  t("memory: after a few minutes the column is tried again (so the app notices once the migration is run)", calls.length === 1 && calls[0].body.fdr_family_size === 368);
  clock = NOW0;
}
{
  DB.resetFdrColumnMemory();
  fakeServer((c) =>
    hasCol(c)
      ? resp({ code: "PGRST204", message: "Could not find the 'fdr_family_size' column of 'strategy_hypotheses' in the schema cache" }, 400)
      : resp([], 201)
  );
  await DB.insertHypothesis(toInsert());
  t("fallback: also works for the PostgREST schema-cache wording (PGRST204)", calls.length === 2 && !hasCol(calls[1]));
}
{
  DB.resetFdrColumnMemory();
  fakeServer(() => resp({ code: "42703", message: 'column "something_else" of relation "strategy_hypotheses" does not exist' }, 400));
  let threw = false;
  try {
    await DB.insertHypothesis(toInsert());
  } catch {
    threw = true;
  }
  t("fallback: an error about some OTHER column is not retried and is thrown", threw && calls.length === 1);
  fakeServer(() => resp("boom", 500));
  threw = false;
  try {
    await DB.insertHypothesis(toInsert());
  } catch {
    threw = true;
  }
  t("fallback: an unrelated server error is thrown, not retried, and not remembered", threw && calls.length === 1);
  fakeServer(() => resp([], 201));
  await DB.insertHypothesis(toInsert());
  t("fallback: after those errors the column is still tried", calls[0].body.fdr_family_size === 368);
  DB.resetFdrColumnMemory();
  fakeServer((c) => (hasCol(c) ? missingCol() : resp("down", 503)));
  threw = false;
  try {
    await DB.insertHypothesis(toInsert());
  } catch {
    threw = true;
  }
  t("fallback: if the retry also fails the error is thrown (one retry only)", threw && calls.length === 2);
}
{
  DB.resetFdrColumnMemory();
  fakeServer(() => resp([], 201));
  await DB.insertHypothesis(toInsert());
  t("column present: one call, with the family size", calls.length === 1 && calls[0].body.fdr_family_size === 368);
}
{
  fakeServer(() => resp([baseRow(), baseRow({ id: "h2", fdr_family_size: 368 })]));
  const rows = await DB.getRecentHypotheses(10);
  t(
    "reads: a table without the column still loads (no reference to the new column in the query)",
    rows.length === 2 && !/fdr_family_size/.test(calls[0].url) && rows[0].fdrFamilySize === null && rows[1].fdrFamilySize === 368
  );
}

// ------------------------------------------------------------------ 4. legacy rule + Guided Trade Signals
{
  const current = hyp({ fdrFamilySize: 368 });
  const currentByText = hyp({ fdrFamilySize: null });
  const legacy = hyp({ fdrFamilySize: null, exitRule: "Fixed 5-trading-day forward hold, then exit regardless of price." });
  t("legacy: no family size anywhere means older rule", RULE.isLegacyRuleHypothesis(legacy) && !RULE.isLegacyRuleHypothesis(current) && !RULE.isLegacyRuleHypothesis(currentByText));
  t(
    "legacy: a validated legacy row is not validated under the current rule",
    !RULE.isValidatedUnderCurrentRule(legacy) && RULE.isValidatedUnderCurrentRule(current) && RULE.isValidatedUnderCurrentRule(currentByText)
  );
  t("legacy: rejected rows are never validated, current or not", !RULE.isValidatedUnderCurrentRule(hyp({ status: "rejected", fdrFamilySize: 368 })));
}
{
  const legacyRow = baseRow({ id: "L1", ticker: "OLDX", exit_rule: "Fixed 5-trading-day forward hold, then exit regardless of price." });
  const currentRow = baseRow({ id: "C1", ticker: "NEWX", fdr_family_size: 368 });
  const touched: string[] = [];
  const server = (rows) => (call) => {
    if (call.url.startsWith("http://fake.supabase.test")) return resp(rows);
    touched.push(call.url);
    return resp({ error: "no data in tests" }, 400);
  };
  fakeServer(server([legacyRow]));
  const none = await GUIDED.getGuidedTradeSignals();
  t("guided signals: a ledger holding only a legacy-validated row yields no card and never looks up its market data", none.length === 0 && touched.length === 0, touched.join(" | "));
  fakeServer(server([legacyRow, currentRow]));
  touched.length = 0;
  await GUIDED.getGuidedTradeSignals();
  const lookedUp = touched.join(" ");
  t("guided signals: a current-rule validated row is still considered (its market data is looked up)", touched.length > 0, "no market-data lookups happened");
  t("guided signals: only the current-rule row's ticker is looked up, never the legacy one", /NEWX/.test(lookedUp) && !/OLDX/.test(lookedUp), lookedUp.slice(0, 300));
}

summary();
