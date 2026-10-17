// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/access-middleware.test.mts
// Table-driven access-decision test for src/middleware.ts (ported from the gating audit's 48-case proof, with the
// known-defect rows turned into passing assertions), plus unit tests for the signed access cookies, constant-time
// helpers, Twilio signature validation, rate limiters, and the three credential endpoints (lockout).
// No network: Supabase is replaced by an in-process fetch mock and any other fetch throws.
import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";

const REPO = process.env.REPO ?? process.cwd();
const SUPA = "http://supabase.fake.invalid";
const SITE_PW = "test-site-pw";
const ADMIN = "test-admin-secret";
const CRON = "cron-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
process.env.ADMIN_ANALYTICS_SECRET = ADMIN;
process.env.CRON_SECRET = CRON;
process.env.ACCESS_COOKIE_KEY = "server-side-signing-key-for-tests";

globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.startsWith(SUPA)) {
    const auth = String(init?.headers?.Authorization ?? init?.headers?.authorization ?? "");
    const ok = url.includes("/auth/v1/user") && auth.includes("good-access");
    return new Response(
      JSON.stringify(ok ? { id: "u1", aud: "authenticated", email: "t@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } : { message: "invalid" }),
      { status: ok ? 200 : 401, headers: { "content-type": "application/json" } },
    );
  }
  throw new Error("blocked non-mock fetch " + url);
}) as typeof fetch;

const { NextRequest } = (await import(pathToFileURL(REPO + "/node_modules/next/server.js").href)).default;
const mw = await import(pathToFileURL(REPO + "/src/middleware.ts").href);
const T = await import(pathToFileURL(REPO + "/src/lib/access/tokens.ts").href);
const RL = await import(pathToFileURL(REPO + "/src/lib/access/rate-limit.ts").href);
const TW = await import(pathToFileURL(REPO + "/src/lib/access/twilio-signature.ts").href);
const matcherRe = new RegExp("^" + mw.config.matcher[0] + "$");

const sbCookie = (good: boolean) =>
  "sb-supabase-auth-token=base64-" +
  Buffer.from(JSON.stringify({ access_token: good ? "good-access" : "bad-access", refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: "u1" } })).toString("base64url");

const siteTok = await T.issueSiteCookie(SITE_PW);
const adminTok = await T.issueAdminCookie(ADMIN);
const expiredSiteTok = await T.issueAccessToken("site_access", SITE_PW, 60, Date.now() - 3600_000);
const ID: Record<string, { cookies: string[]; bearer?: string }> = {
  anon: { cookies: [] },
  oldRawCookie: { cookies: [`site_access=${SITE_PW}`] }, // pre-fix cookie format must no longer pass
  expiredGate: { cookies: [`site_access=${expiredSiteTok}`] },
  gateOnly: { cookies: [`site_access=${siteTok}`] },
  user: { cookies: [`site_access=${siteTok}`, sbCookie(true)] },
  expired: { cookies: [`site_access=${siteTok}`, sbCookie(false)] },
  admin: { cookies: [`site_access=${siteTok}`, `admin_session=${adminTok}`] },
  viewAs: { cookies: [`site_access=${siteTok}`, `admin_session=${adminTok}`, "admin_view_as=slug"] },
  viewAsRawAdmin: { cookies: [`site_access=${siteTok}`, `admin_session=${ADMIN}`, "admin_view_as=slug"] }, // old raw admin cookie
  viewAsNoAdmin: { cookies: [`site_access=${siteTok}`, "admin_view_as=slug"] },
  cron: { cookies: [], bearer: CRON },
  cronWrong: { cookies: [], bearer: "nope" },
};
type Want = "ALLOW" | "GATE" | "LOGIN" | "401" | "BYPASS";
interface Row { gate: boolean; id: string; method: string; path: string; want: Want; json?: string }
const R = (gate: boolean, id: string, path: string, want: Want, method = "GET", json?: string): Row => ({ gate, id, path, want, method, json });

const ROWS: Row[] = [
  // beta password screen must be reachable and submittable (was F1)
  R(true, "anon", "/gate", "ALLOW"), R(true, "anon", "/api/gate", "ALLOW", "POST"), R(true, "anon", "/gate/x", "ALLOW"),
  R(false, "anon", "/gate", "ALLOW"),
  R(true, "anon", "/", "GATE"), R(true, "anon", "/login", "GATE"),
  R(true, "gateOnly", "/login", "ALLOW"), R(true, "gateOnly", "/", "LOGIN"), R(true, "user", "/", "ALLOW"),
  // raw-secret and expired gate cookies no longer open the site
  R(true, "oldRawCookie", "/", "GATE"), R(true, "oldRawCookie", "/login", "GATE"), R(true, "expiredGate", "/", "GATE"),
  // API paths without the beta cookie get JSON, not an HTML redirect
  R(true, "anon", "/api/option-flow", "401", "GET", "gate_required"),
  // cron: Bearer CRON_SECRET, no cookies, with or without the site gate (was F2)
  R(true, "cron", "/api/cron/check-alerts", "ALLOW"), R(true, "cron", "/api/cron/option-flow", "ALLOW"), R(false, "cron", "/api/cron/check-alerts", "ALLOW"),
  R(true, "cronWrong", "/api/cron/check-alerts", "401", "GET", "cron_unauthorized"), R(false, "anon", "/api/cron/option-flow", "401", "GET", "cron_unauthorized"),
  R(true, "gateOnly", "/api/cron/check-alerts", "401", "GET", "cron_unauthorized"), // a browser session is not a cron credential
  // webhook / email-link / survey paths work without the beta cookie or a user session (was F2, F3)
  R(true, "anon", "/api/sms-webhook", "ALLOW", "POST"), R(true, "anon", "/api/alerts/unsubscribe", "ALLOW"),
  R(false, "anon", "/api/sms-webhook", "ALLOW", "POST"), R(false, "anon", "/api/alerts/unsubscribe", "ALLOW"),
  R(false, "anon", "/survey", "ALLOW"), R(true, "anon", "/survey", "ALLOW"),
  R(false, "anon", "/api/beta-feedback", "ALLOW", "POST"), R(true, "anon", "/api/beta-feedback", "ALLOW", "POST"),
  // subscribe is NOT public (only unsubscribe is)
  R(true, "gateOnly", "/api/alerts/subscribe", "401", "POST", "auth_required"),
  // admin / view-as
  R(true, "admin", "/", "LOGIN"), R(true, "viewAs", "/", "ALLOW"), R(true, "viewAsNoAdmin", "/", "LOGIN"), R(true, "viewAsRawAdmin", "/", "LOGIN"),
  R(true, "gateOnly", "/admin/clients", "ALLOW"), R(true, "gateOnly", "/client/abc", "ALLOW"),
  R(true, "gateOnly", "/api/admin/login", "ALLOW", "POST"), R(true, "gateOnly", "/api/client/abc/verify", "ALLOW", "POST"),
  // market-data APIs that must need a user session: JSON 401 for /api, redirect for pages
  ...["/api/gamma-heat-map", "/api/anchored-volume-profile", "/api/option-flow", "/api/crypto-watchlist", "/api/my-portfolio", "/api/journal", "/api/assistant/chat"].map((p) => R(true, "gateOnly", p, "401", "GET", "auth_required")),
  ...["/api/gamma-heat-map", "/api/option-flow"].map((p) => R(false, "anon", p, "401", "GET", "auth_required")),
  // expired session on an API call must be a machine-readable 401, not an HTML redirect (was F7)
  R(true, "expired", "/api/journal", "401", "GET", "auth_required"), R(true, "expired", "/api/option-flow", "401", "GET", "auth_required"),
  R(true, "expired", "/trading", "LOGIN"),
  // path tricks must never widen access
  ...["//api/admin/login", "/API/ADMIN/LOGIN", "/Admin", "/%61dmin", "/api/%61dmin/login", "/api/adminx", "/api/cronx", "/clientx/abc", "/api/chart-bars%2f..%2fmy-portfolio", "/api/chart-bars/%2e%2e/my-portfolio", "/login/../api/my-portfolio"].map((p) => R(true, "gateOnly", p, /^\/api\/|^\/login\/\.\.\/api\// .test(p) ? "401" : "LOGIN")),
  // static bypass
  ...["/_next/static/a.js", "/favicon.ico", "/sw.js", "/manifest.webmanifest", "/icons/dellegate-192.png"].map((p) => R(true, "anon", p, "BYPASS")),
];

async function decide(res: Response): Promise<string> {
  const loc = res.headers.get("location");
  if (loc) return new URL(loc).pathname === "/gate" ? "GATE" : new URL(loc).pathname === "/login" ? "LOGIN" : "REDIRECT " + loc;
  if (res.headers.get("x-middleware-next")) return "ALLOW";
  return String(res.status);
}

for (const row of ROWS) {
  const name = `${row.gate ? "gate-on " : "gate-off"} ${row.id.padEnd(14)} ${row.method.padEnd(4)} ${row.path} => ${row.want}`;
  test(name, async () => {
    if (row.gate) process.env.SITE_ACCESS_PASSWORD = SITE_PW; else delete process.env.SITE_ACCESS_PASSWORD;
    const u = new URL("http://localhost:3000" + row.path);
    if (!matcherRe.test(u.pathname)) { assert.equal("BYPASS", row.want); return; }
    const id = ID[row.id];
    const headers = new Headers();
    if (id.cookies.length) headers.set("cookie", id.cookies.join("; "));
    if (id.bearer) headers.set("authorization", `Bearer ${id.bearer}`);
    const res = await mw.middleware(new NextRequest(u.href, { method: row.method, headers }));
    assert.equal(await decide(res), row.want);
    if (row.json) {
      assert.match(res.headers.get("content-type") ?? "", /json/);
      assert.equal((await res.json()).code, row.json);
    }
  });
}

// ------------------------------------------------------------------ cookie tokens
test("access token: issue/verify round trip, label binding, secret binding", async () => {
  const tok = await T.issueAccessToken("site_access", "pw");
  assert.ok(!tok.includes("pw"), "token must not contain the secret");
  assert.equal(await T.verifyAccessToken("site_access", "pw", tok), true);
  assert.equal(await T.verifyAccessToken("admin_session", "pw", tok), false, "token is bound to its label");
  assert.equal(await T.verifyAccessToken("site_access", "pw2", tok), false, "changing the secret revokes the token");
});
test("access token: expiry, tampering, junk, missing secret", async () => {
  const old = await T.issueAccessToken("x", "s", 10, Date.now() - 20_000);
  assert.equal(await T.verifyAccessToken("x", "s", old), false);
  const tok = await T.issueAccessToken("x", "s");
  const [v, exp, mac] = tok.split(".");
  assert.equal(await T.verifyAccessToken("x", "s", `${v}.${Number(exp) + 99999}.${mac}`), false, "extending expiry breaks the MAC");
  for (const bad of ["", "s", "v1.1.zz", "v2." + exp + "." + mac, undefined, null]) assert.equal(await T.verifyAccessToken("x", "s", bad as any), false);
  assert.equal(await T.verifyAccessToken("x", undefined, tok), false);
  assert.equal(await T.verifyAccessToken("x", "", tok), false);
});
test("client cookie is bound to slug and to the stored passcode hash", async () => {
  const c = await T.issueClientCookie("slugA", "hashA");
  assert.equal(await T.verifyClientCookie("slugA", "hashA", c), true);
  assert.equal(await T.verifyClientCookie("slugB", "hashA", c), false);
  assert.equal(await T.verifyClientCookie("slugA", "hashB", c), false, "passcode change revokes");
  assert.equal(await T.verifyClientCookie("slugA", "hashA", "hashA"), false, "the raw hash is not a valid cookie");
});
test("timingSafeEqualStr and bearerMatches", async () => {
  assert.equal(await T.timingSafeEqualStr("abc", "abc"), true);
  assert.equal(await T.timingSafeEqualStr("abc", "abd"), false);
  assert.equal(await T.timingSafeEqualStr("abc", "abcd"), false);
  assert.equal(await T.bearerMatches("Bearer s", "s"), true);
  assert.equal(await T.bearerMatches("Bearer s", "t"), false);
  assert.equal(await T.bearerMatches(null, "s"), false);
  assert.equal(await T.bearerMatches("Bearer ", ""), false, "unset secret never matches");
});

// ------------------------------------------------------------------ Twilio
test("Twilio signature equals an independent Node-crypto HMAC-SHA1 of url + sorted key/value pairs", async () => {
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" };
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const sig = await TW.expectedTwilioSignature("12345", url, params);
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  assert.equal(sig, createHmac("sha1", "12345").update(data).digest("base64"));
  assert.equal(await TW.isValidTwilioSignature("12345", sig, [url], params), true);
  assert.equal(await TW.isValidTwilioSignature("12345", sig, [url], { ...params, Digits: "9999" }), false);
  assert.equal(await TW.isValidTwilioSignature("12345", null, [url], params), false);
  assert.equal(await TW.isValidTwilioSignature("other", sig, [url], params), false);
});

test("sms-webhook route: rejects unsigned/forged when TWILIO_AUTH_TOKEN set, accepts a valid signature", async () => {
  process.env.TWILIO_AUTH_TOKEN = "tw-token";
  delete process.env.SUPABASE_URL; // alerts DB unconfigured: a valid STOP is a no-op, which is all we need to observe the 200
  const route = await import(pathToFileURL(REPO + "/src/app/api/sms-webhook/route.ts").href);
  const url = "https://app.example.test/api/sms-webhook";
  process.env.TWILIO_WEBHOOK_URL = url;
  const params = { Body: "STOP", From: "+15555550100" };
  const mk = (sig?: string) => new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(sig ? { "x-twilio-signature": sig } : {}) }, body: new URLSearchParams(params).toString() });
  assert.equal((await route.POST(mk())).status, 403);
  assert.equal((await route.POST(mk("AAAA"))).status, 403);
  assert.equal((await route.POST(mk(await TW.expectedTwilioSignature("tw-token", url, params)))).status, 200);
  delete process.env.TWILIO_AUTH_TOKEN; delete process.env.TWILIO_WEBHOOK_URL;
});

// ------------------------------------------------------------------ rate limiters
test("sliding window limiter", () => {
  const l = new RL.SlidingWindowLimiter(3, 1000);
  assert.ok(l.hit("a", 0).allowed && l.hit("a", 1).allowed && l.hit("a", 2).allowed);
  const d = l.hit("a", 3);
  assert.equal(d.allowed, false);
  assert.ok(d.retryAfterSec >= 1);
  assert.ok(l.hit("b", 3).allowed, "keys are independent");
  assert.ok(l.hit("a", 1100).allowed, "window slides");
});
test("lockout limiter: locks after N failures, delay doubles, success clears", () => {
  const l = new RL.LockoutLimiter(3, 60_000, 1000, 8000);
  assert.ok(l.check("k", 0).allowed);
  l.fail("k", 0); l.fail("k", 1);
  assert.ok(l.check("k", 2).allowed);
  const third = l.fail("k", 2);
  assert.equal(third.allowed, false);
  assert.ok(third.retryAfterSec <= 1 && third.retryAfterSec >= 1);
  assert.ok(l.check("k", 1100).allowed, "first lock is 1s");
  l.fail("k", 1100); l.fail("k", 1101); const second = l.fail("k", 1102);
  assert.ok(second.retryAfterSec >= 2, "second lock is 2s");
  l.succeed("k");
  assert.ok(l.check("k", 1103).allowed);
});

// ------------------------------------------------------------------ credential endpoints (lockout, constant-time, signed cookies)
const jsonReq = (url: string, body: unknown, ip: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: JSON.stringify(body) });

test("/api/gate: wrong passwords lock out after 5; right password sets a signed cookie, not the password", async () => {
  process.env.SITE_ACCESS_PASSWORD = SITE_PW;
  const route = await import(pathToFileURL(REPO + "/src/app/api/gate/route.ts").href);
  const ip = "198.51.100.7";
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await route.POST(jsonReq("http://x/api/gate", { password: "wrong" + i }, ip))).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 429, 429]);
  assert.equal((await route.POST(jsonReq("http://x/api/gate", { password: SITE_PW }, ip))).status, 429, "even the right password waits out the lockout");
  const ok = await route.POST(jsonReq("http://x/api/gate", { password: SITE_PW }, "198.51.100.8"));
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get("set-cookie") ?? "";
  assert.ok(setCookie.startsWith("site_access=v1."), setCookie);
  assert.ok(!setCookie.includes(SITE_PW));
  assert.match(setCookie, /HttpOnly/i);
  assert.equal((await route.POST(jsonReq("http://x/api/gate", { password: 12345 }, "198.51.100.9"))).status, 401, "non-string password rejected");
});
test("/api/admin/login: same lockout, signed cookie", async () => {
  const route = await import(pathToFileURL(REPO + "/src/app/api/admin/login/route.ts").href);
  const ip = "198.51.100.20";
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await route.POST(jsonReq("http://x/api/admin/login", { secret: "bad" + i }, ip))).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 429]);
  const ok = await route.POST(jsonReq("http://x/api/admin/login", { secret: ADMIN }, "198.51.100.21"));
  assert.equal(ok.status, 200);
  const c = ok.headers.get("set-cookie") ?? "";
  assert.ok(c.startsWith("admin_session=v1.") && !c.includes(ADMIN));
});
test("/api/beta-feedback: validation, size caps, rate limit (no DB configured so stored:false)", async () => {
  delete process.env.SUPABASE_URL;
  const route = await import(pathToFileURL(REPO + "/src/app/api/beta-feedback/route.ts").href);
  const post = (body: unknown, ip: string, raw?: string) => route.POST(new Request("http://x/api/beta-feedback", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": ip }, body: raw ?? JSON.stringify(body) }));
  assert.equal((await post({ sessionId: "s", message: "hi" }, "203.0.113.1")).status, 200);
  assert.equal((await post({ message: "hi" }, "203.0.113.1")).status, 400);
  assert.equal((await post({ sessionId: "s", message: "x".repeat(4001) }, "203.0.113.1")).status, 400);
  assert.equal((await post(null, "203.0.113.1", "{not json")).status, 400);
  assert.equal((await post({ sessionId: "s", message: "x".repeat(20000) }, "203.0.113.1")).status, 413);
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await post({ sessionId: "s", message: "hi" }, "203.0.113.50")).status);
  assert.equal(codes.filter((c) => c === 429).length, 2, "10 per hour per IP");
});
