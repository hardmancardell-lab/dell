// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/journal-filter-injection.test.mts
// PostgREST filter-injection tests for the *-db.ts data layer, against an in-memory fake PostgREST that decodes the
// query string BEFORE parsing or=(...) (the way the real server does) and honours double-quoted values.
// Ported from the database-security audit (scratch/06-database-security/ledger-race-and-filter.mts, experiment E2).
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

process.env.SUPABASE_URL = "http://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const REPO = process.env.REPO ?? process.cwd();
const imp = (p: string) => import(pathToFileURL(`${REPO}/src/${p}`).href);
const SAFE = await imp("lib/data/postgrest-safe.ts");
const JDB = await imp("lib/data/journal-db.ts");
const PDB = await imp("lib/data/paper-trading-db.ts");
const ADB = await imp("lib/data/advisor-clients-db.ts");
const ALDB = await imp("lib/data/alerts-db.ts");

let db: Record<string, any[]> = {};
let calls: string[] = [];

/** Split a PostgREST logical-operator body on top-level commas, honouring "double quotes" with backslash escapes. */
function splitTop(inner: string): string[] {
  const out: string[] = [];
  let cur = "", inq = false, depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inq) {
      cur += ch;
      if (ch === "\\") { cur += inner[++i] ?? ""; } else if (ch === '"') inq = false;
    } else if (ch === '"') { inq = true; cur += ch; }
    else if (ch === "(") { depth++; cur += ch; }
    else if (ch === ")") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
const unquote = (v: string) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v);
function cond(row: any, c: string): boolean {
  const m = /^([a-z_]+)\.(eq|neq|is|not\.is)\.(.*)$/s.exec(c);
  if (!m) return true;
  const [, col, op, rawVal] = m;
  const v = unquote(rawVal);
  if (op === "is") return v === "null" ? row[col] == null : true;
  if (op === "not.is") return v === "null" ? row[col] != null : true;
  if (op === "eq") return String(row[col]) === v;
  if (op === "neq") return String(row[col]) !== v;
  return true;
}
function matches(row: any, params: [string, string][]): boolean {
  return params.every(([k, v]) => {
    if (k === "or") return splitTop(v.replace(/^\(/, "").replace(/\)$/, "")).some((c) => cond(row, c));
    return cond(row, `${k}.${v}`);
  });
}
globalThis.fetch = async (input: any, init: any = {}) => {
  calls.push(String(input));
  const url = new URL(String(input)); // searchParams percent-decodes, like PostgREST
  const table = url.pathname.split("/").pop()!;
  const rows = (db[table] ??= []);
  const method = init.method ?? "GET";
  const params = [...url.searchParams.entries()].filter(([k]) => !["order", "limit", "select"].includes(k));
  const body = init.body ? JSON.parse(init.body) : undefined;
  const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
  if (method === "GET") return json(rows.filter((r) => matches(r, params)).map((r) => ({ ...r })));
  if (method === "POST") { const row = { id: `${table}-${rows.length + 1}`, created_at: "2026-10-16T00:00:00Z", ...body }; rows.push(row); return json([row], 201); }
  if (method === "PATCH") { const hit = rows.filter((r) => matches(r, params)); hit.forEach((r) => Object.assign(r, body)); return json(hit); }
  if (method === "DELETE") { const keep = rows.filter((r) => !matches(r, params)); db[table] = keep; return json([]); }
  return json([]);
};

const A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const jrow = (id: string, session: string | null, ticker: string) => ({ id, session_id: session, ticker, instrument_type: "shares", source: "manual", strategy: "x", status: "open", opened_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", fills: [] });
function seed() {
  db = { journal_positions: [jrow("p1", A, "AAA"), jrow("p2", B, "BBB"), jrow("p3", null, "LEGACY")], paper_accounts: [{ id: "acc1", session_id: A, cash_balance: 1 }, { id: "acc2", session_id: B, cash_balance: 2 }], advisor_clients: [] };
  calls = [];
}

const HOSTILE = [
  "x,session_id.not.is.null",
  `${A}),session_id.not.is.null,(x`,
  `${A},session_id.neq.zzzz`,
  `"${A}"`,
  `${A}\\`,
  `${A}&or=(id.not.is.null)`,
  `${A}%2Csession_id.not.is.null`,
  "a b c d e f g h",
  "short",
  "",
  `${A}\n`,
  "x".repeat(101),
];

test("the audit's injectable shape would leak every row in the fake (proves the fake models PostgREST)", () => {
  seed();
  const naive = `or=(session_id.eq.${encodeURIComponent("x,session_id.not.is.null")},session_id.is.null)`;
  const u = new URL(`http://h/rest/v1/journal_positions?${naive}`);
  const hit = db.journal_positions.filter((r) => matches(r, [...u.searchParams.entries()]));
  assert.equal(hit.length, 3, "unvalidated, unquoted id exposes rows of every session");
});

test("legit session sees only its own rows: never another session's and never the old NULL-session rows", async () => {
  seed();
  const rowsA = await JDB.getJournalPositions(A);
  assert.deepEqual(rowsA.map((p: any) => p.ticker).sort(), ["AAA"]);
  const rowsB = await JDB.getJournalPositions(B);
  assert.deepEqual(rowsB.map((p: any) => p.ticker).sort(), ["BBB"]);
});

test("old NULL-session rows are hidden from everyone, by id too, and cannot be edited or deleted through the app", async () => {
  seed();
  assert.equal(await JDB.getJournalPositionById("p3", A), null);
  assert.equal(await JDB.getJournalPositionById("p3", B), null);
  await assert.rejects(() => JDB.updateJournalPosition("p3", A, { notes: "x" }), /not found/i);
  await JDB.deleteJournalPosition("p3", A);
  assert.equal(db.journal_positions.length, 3, "nothing is deleted: the old row is still in the database");
  assert.ok(db.journal_positions.some((r: any) => r.session_id == null));
});

test("legacy NULL-session visibility is an explicit named constant, now false (owner decision 2026-10-19)", () => {
  assert.equal(SAFE.LEGACY_NULL_SESSION_ROWS_VISIBLE_TO_EVERYONE, false);
  const f = SAFE.sessionOwnershipFilter(A);
  assert.ok(!/is\.null/.test(decodeURIComponent(f)), "the filter must not mention NULL rows");
  assert.equal(f, `session_id=eq.${A}`);
});

for (const bad of HOSTILE) {
  test(`hostile session id ${JSON.stringify(bad).slice(0, 48)} is rejected before any request is made`, async () => {
    seed();
    assert.equal(SAFE.isValidSessionId(bad), false);
    await assert.rejects(() => JDB.getJournalPositions(bad), /Invalid sessionId/);
    await assert.rejects(() => JDB.getJournalPositionById("p1", bad), /Invalid sessionId/);
    await assert.rejects(() => JDB.updateJournalPosition("p1", bad, { notes: "pwn" }), /Invalid sessionId/);
    await assert.rejects(() => JDB.deleteJournalPosition("p1", bad), /Invalid sessionId/);
    await assert.rejects(() => PDB.getAccountBySessionId(bad), /Invalid sessionId/);
    assert.equal(calls.length, 0, "no HTTP call may be issued");
    assert.equal(db.journal_positions.length, 3);
  });
}

test("hostile row ids and symbols are rejected in every data module", async () => {
  seed();
  for (const bad of ["1&select=*", "x,y", "a.b", "../x", "a b", "", "x".repeat(200)]) {
    await assert.rejects(() => JDB.getJournalPositionById(bad, A), /Invalid id/);
    await assert.rejects(() => PDB.getAccountById(bad), /Invalid id/);
    await assert.rejects(() => PDB.getPositions(bad), /Invalid id/);
    await assert.rejects(() => ADB.getAdvisorClientBySlug(bad), /Invalid id/);
  }
  for (const bad of ["AAPL&x=1", "A,B", "", "a b", "x".repeat(40)]) {
    await assert.rejects(() => PDB.getPosition("acc1", bad, "equity"), /Invalid symbol/);
  }
  await assert.rejects(() => PDB.getPosition("acc1", "AAPL", "equity&x=1"), /Invalid assetClass/);
  await assert.rejects(() => ALDB.deactivateSubscriptionByToken("x&active=eq.true"), /Invalid token/);
  await assert.rejects(() => ALDB.deactivateSubscriptionsByPhone("1 or 1=1"), /Invalid phone/);
  assert.equal(calls.length, 0);
});

test("legitimate values still work: tickers with dot/dash, uuid ids, E.164 phones", async () => {
  seed();
  assert.equal(await PDB.getPosition("acc1", "BRK.B", "equity"), null);
  assert.equal(await PDB.getPosition("acc1", "BTC-USD", "crypto"), null);
  assert.equal((await PDB.getAccountBySessionId(A))?.id, "acc1");
  assert.equal(await ALDB.deactivateSubscriptionsByPhone("+15555550100"), 0);
});

test("pgQuote escapes quotes and backslashes so a value stays one literal inside or=(...)", () => {
  seed();
  for (const nasty of ['a"b', "a\\b", 'x",session_id.not.is.null,"y', "a),(b", "a,b"]) {
    const q = SAFE.pgQuote(nasty);
    const u = new URL(`http://h/t?or=(session_id.eq.${encodeURIComponent(q)},session_id.is.null)`);
    const parts = splitTop(u.searchParams.get("or")!.replace(/^\(/, "").replace(/\)$/, ""));
    assert.equal(parts.length, 2, `value ${nasty} must not add conditions`);
    assert.equal(unquote(parts[0].replace(/^session_id\.eq\./, "")), nasty);
  }
});

test("routes answer 400 for hostile session ids (no database call)", async () => {
  seed();
  const route = await imp("app/api/journal/route.ts");
  for (const bad of [HOSTILE[0], HOSTILE[2], "short"]) {
    const res = await route.GET(new Request(`http://x/api/journal?sessionId=${encodeURIComponent(bad)}`));
    assert.equal(res.status, 400);
  }
  const res = await route.GET(new Request(`http://x/api/journal?sessionId=${A}`));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).positions.length, 1, "own row only: the old NULL-session row is hidden");
  const idRoute = await imp("app/api/journal/[id]/route.ts");
  const res2 = await idRoute.DELETE(new Request(`http://x/api/journal/x?sessionId=${A}`), { params: Promise.resolve({ id: "1&select=*" }) });
  assert.equal(res2.status, 400);
  assert.equal(db.journal_positions.length, 3);
});
