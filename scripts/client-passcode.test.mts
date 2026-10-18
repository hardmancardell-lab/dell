// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/client-passcode.test.mts
// Client passcode storage: salted scrypt for new and changed passcodes, legacy unsalted SHA-256 still accepted and
// upgraded on the next successful sign-in, old sessions fail safe, passcodes never logged or stored in the clear.
// No network: Supabase is an in-process fake and any other fetch throws. Passcodes below are test values.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SUPA = "http://supabase.fake.invalid";
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.ACCESS_COOKIE_KEY = "server-side-signing-key-for-tests";
delete process.env.CLIENT_RESEARCH_ENABLED;

const PASS = "test-pass-1234";
const sha = (s: string) => createHash("sha256").update(s.trim()).digest("hex");

// One row per scenario, keyed by slug. The fake database applies PATCH filters like PostgREST would.
const rows: Record<string, any> = {};
const writes: { method: string; url: string; body: any }[] = [];
let failPatch = false;
const row = (slug: string, hash: string) => ({ id: "id-" + slug, slug, name: "N " + slug, passcode_hash: hash, cash_balance: 0, linked_email: null, user_id: null, created_at: "2026-01-01" });
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!url.startsWith(SUPA)) throw new Error("blocked non-mock fetch " + url);
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : undefined;
  const slugM = url.match(/advisor_clients\?slug=eq\.([^&]+)/);
  if (method === "PATCH" && slugM) {
    writes.push({ method, url, body });
    if (failPatch) return json({ message: "boom" }, 500);
    const r = rows[decodeURIComponent(slugM[1])];
    const hashM = url.match(/passcode_hash=eq\.([^&]+)/);
    if (!r || (hashM && decodeURIComponent(hashM[1]) !== r.passcode_hash)) return json([]);
    Object.assign(r, body);
    return json([r]);
  }
  if (method === "POST" && url.endsWith("/advisor_clients")) {
    writes.push({ method, url, body });
    return json([{ ...row("created", body.passcode_hash), ...body, id: "new", created_at: "2026-01-01" }]);
  }
  if (slugM) {
    const r = rows[decodeURIComponent(slugM[1])];
    return json(r ? [r] : []);
  }
  if (/advisor_client_holdings|advisor_client_realized_pnl/.test(url)) return json([]);
  throw new Error("unexpected db url " + url);
}) as typeof fetch;

// Passcodes must never be logged: capture every console channel for the whole run.
const logged: string[] = [];
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k].bind(console);
  console[k] = (...a: any[]) => { logged.push(a.map(String).join(" ")); orig(...a); };
}

const P = await import("../src/lib/access/passcode.ts");
const T = await import("../src/lib/access/tokens.ts");
const DB = await import("../src/lib/data/advisor-clients-db.ts");
const VERIFY = await import("../src/app/api/client/[slug]/verify/route.ts");
const RESEARCH = await import("../src/app/api/client/[slug]/research/route.ts");

let ipN = 0;
const verifyReq = (slug: string, passcode: any) =>
  VERIFY.POST(new Request(`http://app.test/api/client/${slug}/verify`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${++ipN}` }, body: JSON.stringify({ passcode }) }), { params: Promise.resolve({ slug }) });
const cookieOf = (res: Response, slug: string) => {
  const set = res.headers.get("set-cookie") ?? "";
  const m = set.match(new RegExp(`client_session_${slug}=([^;]+)`));
  return m ? `client_session_${slug}=${m[1]}` : null;
};
// The dashboard route reads cookies through next/headers (needs a real request scope), so the session probe is the
// research index route, which checks the same cookie the same way from the request headers.
const dash = (slug: string, cookie?: string) =>
  RESEARCH.GET(new Request(`http://app.test/api/client/${slug}/research`, { headers: { ...(cookie ? { cookie } : {}), "x-real-ip": `203.0.113.${++ipN % 250}` } }), { params: Promise.resolve({ slug }) });

// ------------------------------------------------------------------ the hash itself
test("new hashes are salted scrypt, 48 characters, different every time, and carry no trace of the passcode", async () => {
  const a = await P.hashPasscodeSalted(PASS);
  const b = await P.hashPasscodeSalted(PASS);
  assert.match(a, /^s1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{22}$/);
  assert.equal(a.length, 48, "fits a column sized for the old 64-character hash");
  assert.notEqual(a, b, "random salt");
  assert.ok(!a.includes(PASS));
  assert.notEqual(a, sha(PASS));
});

test("verifyPasscode: current format ok and wrong, legacy ok (needs re-hash) and wrong, junk and edge cases never throw", async () => {
  const cur = await P.hashPasscodeSalted(PASS);
  assert.deepEqual(await P.verifyPasscode(PASS, cur), { ok: true, needsRehash: false });
  assert.deepEqual(await P.verifyPasscode("  " + PASS + "  ", cur), { ok: true, needsRehash: false }, "surrounding spaces are trimmed, as before");
  assert.deepEqual(await P.verifyPasscode("wrong", cur), { ok: false, needsRehash: false });
  const legacy = sha(PASS);
  assert.deepEqual(await P.verifyPasscode(PASS, legacy), { ok: true, needsRehash: true });
  assert.deepEqual(await P.verifyPasscode("wrong", legacy), { ok: false, needsRehash: false });
  assert.deepEqual(await P.verifyPasscode(PASS, null), { ok: false, needsRehash: false }, "unknown client");
  for (const stored of ["", "hashA", "s1$short$short", "s2$" + "A".repeat(22) + "$" + "A".repeat(22), legacy.toUpperCase(), legacy.slice(1), "x".repeat(500)]) {
    assert.equal((await P.verifyPasscode(PASS, stored)).ok, false, String(stored).slice(0, 20));
  }
  for (const pc of ["", "   ", "x".repeat(257), null, undefined, 1234, {}]) assert.equal((await P.verifyPasscode(pc as any, cur)).ok, false);
  assert.equal(P.isLegacyPasscodeHash(legacy), true);
  assert.equal(P.isLegacyPasscodeHash(cur), false);
  await assert.rejects(() => P.hashPasscodeSalted(""), /Invalid/);
  await assert.rejects(() => P.hashPasscodeSalted("x".repeat(300)), /Invalid/);
});

// ------------------------------------------------------------------ the sign-in route
test("legacy client: right passcode signs in, the row is re-hashed once (compare-and-set), and the old passcode still works afterwards", async () => {
  rows.legacy1 = row("legacy1", sha(PASS));
  writes.length = 0;
  const res = await verifyReq("legacy1", PASS);
  assert.equal(res.status, 200);
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /passcode_hash=eq\.[0-9a-f]{64}/, "only replaces the hash that just verified");
  assert.match(writes[0].body.passcode_hash, /^s1\$/);
  assert.deepEqual(Object.keys(writes[0].body), ["passcode_hash"], "nothing but the hash is written");
  assert.ok(!JSON.stringify(writes).includes(PASS), "the passcode is never sent to the database");
  assert.match(rows.legacy1.passcode_hash, /^s1\$/);
  // the cookie that came back is bound to the NEW hash and opens the dashboard
  const ck = cookieOf(res, "legacy1");
  assert.ok(ck);
  assert.equal((await dash("legacy1", ck)).status, 200);
  // the same passcode keeps working against the new hash, without another write
  writes.length = 0;
  const again = await verifyReq("legacy1", PASS);
  assert.equal(again.status, 200);
  assert.equal(writes.length, 0, "no second re-hash");
});

test("wrong passcode: 401, nothing written, no cookie, for legacy and new rows", async () => {
  rows.legacy2 = row("legacy2", sha(PASS));
  rows.fresh2 = row("fresh2", await P.hashPasscodeSalted(PASS));
  writes.length = 0;
  for (const slug of ["legacy2", "fresh2"]) {
    const res = await verifyReq(slug, "not-the-passcode");
    assert.equal(res.status, 401);
    assert.equal(cookieOf(res, slug), null);
    assert.deepEqual(await res.json(), { error: "Incorrect passcode." });
  }
  assert.equal(writes.length, 0);
  assert.match(rows.legacy2.passcode_hash, /^[0-9a-f]{64}$/, "a wrong try does not upgrade or change the row");
  assert.equal((await verifyReq("no-such-client", PASS)).status, 401, "unknown slug looks the same");
  assert.equal((await verifyReq("legacy2", "")).status, 400);
});

test("new-format client signs in and is not rewritten", async () => {
  rows.fresh3 = row("fresh3", await P.hashPasscodeSalted(PASS));
  const before = rows.fresh3.passcode_hash;
  writes.length = 0;
  const res = await verifyReq("fresh3", PASS);
  assert.equal(res.status, 200);
  assert.equal(writes.length, 0);
  assert.equal(rows.fresh3.passcode_hash, before);
  assert.equal((await dash("fresh3", cookieOf(res, "fresh3"))).status, 200);
});

test("existing sessions fail safe: a cookie issued for the legacy hash is refused after the re-hash, with a plain re-prompt and no data (checked on the research route; the dashboard route uses the same check)", async () => {
  rows.legacy4 = row("legacy4", sha(PASS));
  const oldCookie = `client_session_legacy4=${await T.issueClientCookie("legacy4", sha(PASS))}`;
  assert.equal((await dash("legacy4", oldCookie)).status, 200, "before the upgrade the old session works");
  assert.equal((await verifyReq("legacy4", PASS)).status, 200, "someone signs in, which upgrades the row");
  const res = await dash("legacy4", oldCookie);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.requiresPasscode, true);
  assert.deepEqual(Object.keys(body).sort(), ["error", "requiresPasscode"], "nothing else in the answer");
});

test("a failed upgrade write does not lock the client out: sign-in still works on the legacy hash", async () => {
  rows.legacy5 = row("legacy5", sha(PASS));
  failPatch = true;
  const res = await verifyReq("legacy5", PASS);
  failPatch = false;
  assert.equal(res.status, 200);
  assert.equal(rows.legacy5.passcode_hash, sha(PASS), "row unchanged");
  assert.equal((await dash("legacy5", cookieOf(res, "legacy5"))).status, 200, "the cookie matches the hash that is still stored");
  assert.equal((await verifyReq("legacy5", PASS)).status, 200, "and the upgrade is tried again at the next sign-in");
  assert.match(rows.legacy5.passcode_hash, /^s1\$/);
});

test("compare-and-set: a passcode the advisor changed meanwhile is never overwritten by the upgrade", async () => {
  rows.legacy6 = row("legacy6", sha(PASS));
  const changed = await P.hashPasscodeSalted("advisor-set-new");
  rows.legacy6.passcode_hash = changed; // changed between the read and the write
  assert.equal(await DB.replacePasscodeHashIfUnchanged("legacy6", sha(PASS), await P.hashPasscodeSalted(PASS)), false);
  assert.equal(rows.legacy6.passcode_hash, changed);
});

test("creating or changing a client passcode stores a salted hash, never the legacy one or the clear text", async () => {
  writes.length = 0;
  await DB.createAdvisorClient("New Person", PASS, 10, null);
  await DB.createAdvisorClient("New Person Two", PASS, 10, null);
  const [c1, c2] = writes.map((w) => w.body.passcode_hash);
  assert.match(c1, /^s1\$/);
  assert.notEqual(c1, c2, "same passcode, different salt");
  assert.ok(!JSON.stringify(writes).includes(PASS));
  rows.chg = row("chg", sha(PASS));
  writes.length = 0;
  await DB.updateAdvisorClient("chg", { passcode: "a-new-passcode" });
  assert.match(writes[0].body.passcode_hash, /^s1\$/);
  assert.ok(!JSON.stringify(writes).includes("a-new-passcode"));
  assert.equal((await P.verifyPasscode("a-new-passcode", writes[0].body.passcode_hash)).ok, true);
});

test("the legacy export still produces the old format (for reading old rows only)", () => {
  assert.equal(DB.hashPasscode(PASS), sha(PASS));
});

test("no passcode was logged anywhere during this run", () => {
  const all = logged.join("\n");
  for (const secret of [PASS, "a-new-passcode", "advisor-set-new", "not-the-passcode"]) assert.ok(!all.includes(secret), "a passcode appeared in the console output");
});
