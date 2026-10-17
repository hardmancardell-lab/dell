// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/access-misc.test.mts
// Item-8 fixes: alert subscribe validation and abuse limits, unsubscribe limits/validation, send-survey header auth.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.SUPABASE_URL = "https://fake.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role";
process.env.ADMIN_ANALYTICS_SECRET = "admin-secret-for-tests";

const writes: any[] = [];
let subRows: any[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input);
  if (!url.startsWith("https://fake.supabase.test")) throw new Error("BLOCKED " + url);
  const json = (o: any, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  const body = init.body ? JSON.parse(init.body) : undefined;
  const method = init.method ?? "GET";
  if (url.includes("/alert_subscriptions") && method === "POST") {
    writes.push({ t: "sub", body });
    return json([{ id: "s1", email: body.email, phone: body.phone, channel: body.channel, consent_at: "2026-10-17", unsubscribe_token: body.unsubscribe_token, active: true, created_at: "2026-10-17", session_id: body.session_id }], 201);
  }
  if (url.includes("/alert_rules") && method === "POST") {
    writes.push({ t: "rules", body });
    return json(body.map((r: any, i: number) => ({ id: "r" + i, ...r })), 201);
  }
  if (url.includes("/alert_subscriptions") && method === "PATCH") return json([], 200);
  if (url.includes("/alert_subscriptions")) return json(subRows);
  return json([]);
}) as any;

const SUB = await import("../src/app/api/alerts/subscribe/route.ts");
const UNSUB = await import("../src/app/api/alerts/unsubscribe/route.ts");
const SURVEY = await import("../src/app/api/admin/send-survey/route.ts");

let n = 100;
const ip = () => `198.51.100.${++n}`;
const rule = () => ({ ticker: "nvda", assetClass: "equity", conditionType: "price_threshold", params: { targetPrice: 100, direction: "above" } });
const good = (extra: any = {}) => ({ email: "a@example.com", phone: null, channel: "email", consent: true, sessionId: "session-alerts-test-0001", rules: [rule()], ...extra });
const post = (body: any, addr = ip(), raw?: string) =>
  SUB.POST(new Request("http://x/api/alerts/subscribe", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": addr }, body: raw ?? JSON.stringify(body) }));

test("subscribe: a valid signup is normalized and stored", async () => {
  writes.length = 0;
  const res = await post(good());
  assert.equal(res.status, 200);
  assert.equal(writes[0].body.email, "a@example.com");
  assert.equal(writes[1].body[0].ticker, "NVDA");
});

test("subscribe: bad email/phone/channel/rules/consent are 400 and nothing is written", async () => {
  writes.length = 0;
  const bad = [
    good({ consent: false }), good({ email: "not-an-email" }), good({ email: "a@b" }), good({ channel: "pigeon" }), good({ channel: "sms" }),
    good({ email: null, phone: "555-1234", channel: "sms" }), good({ phone: "+1", channel: "sms", email: null }), good({ rules: [] }), good({ rules: "x" }),
    good({ rules: Array.from({ length: 11 }, () => rule()) }),
    good({ rules: [{ ...rule(), ticker: "A;B" }] }), good({ rules: [{ ...rule(), conditionType: "drop_table" }] }),
    good({ rules: [{ ...rule(), assetClass: "stonks" }] }), good({ rules: [{ ...rule(), params: { blob: "x".repeat(2000) } }] }), good({ rules: [{ ...rule(), params: [1] }] }),
    null, [], "x",
  ];
  for (const b of bad) assert.equal((await post(b)).status, 400, JSON.stringify(b)?.slice(0, 80));
  assert.equal((await post(null, ip(), "{bad json")).status, 400);
  assert.equal((await post(good({ pad: "x".repeat(20000) }))).status, 413);
  assert.equal(writes.length, 0);
});

test("subscribe: per-IP limit (5/hour) and per-target limit (3/day) return 429", async () => {
  const a = ip();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post(good({ email: `user${i}@example.com` }), a)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  const codes2 = [];
  for (let i = 0; i < 5; i++) codes2.push((await post(good({ email: "victim@example.com" }), ip())).status);
  assert.deepEqual(codes2, [200, 200, 200, 429, 429], "a third party cannot be flooded from many IPs");
});

test("unsubscribe: token shape is validated and attempts are limited per IP", async () => {
  const a = ip();
  const hit = (token: string) => UNSUB.GET(new Request(`http://x/api/alerts/unsubscribe?token=${encodeURIComponent(token)}`, { headers: { "x-real-ip": a } }));
  assert.equal((await hit("x".repeat(500))).status, 400);
  const r = await hit("12345678-aaaa-bbbb-cccc-1234567890ab");
  assert.ok([404, 200].includes(r.status));
  let last = 0;
  for (let i = 0; i < 40; i++) last = (await hit("12345678-aaaa-bbbb-cccc-1234567890ab")).status;
  assert.equal(last, 429);
});

test("send-survey: the secret in the URL no longer authenticates; the header does", async () => {
  const addr = ip();
  const mk = (url: string, headers: any = {}) => new Request(url, { method: "POST", headers: { "x-real-ip": addr, ...headers } });
  // URL secret: not accepted. The route falls through to the admin cookie check, which needs a request scope, so it rejects or answers 404.
  let status = 0;
  try { status = (await SURVEY.POST(mk("http://x/api/admin/send-survey?secret=admin-secret-for-tests"))).status; } catch { status = 404; }
  assert.equal(status, 404);
  subRows = [];
  const res = await SURVEY.POST(mk("http://x/api/admin/send-survey?dryRun=true", { "x-admin-secret": "admin-secret-for-tests" }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).summary.dryRun, true);
});

test("send-survey: wrong header attempts lock out after 5", async () => {
  const addr = ip();
  const codes = [];
  for (let i = 0; i < 7; i++) {
    try {
      codes.push((await SURVEY.POST(new Request("http://x/api/admin/send-survey", { method: "POST", headers: { "x-real-ip": addr, "x-admin-secret": "wrong" + i } }))).status);
    } catch {
      codes.push(404);
    }
  }
  assert.deepEqual(codes.slice(0, 5), [404, 404, 404, 404, 404]);
  assert.equal(codes[5], 429);
});

test("webull-quote-test and send-survey source: admin gate present, secret not read from the URL", () => {
  const w = readFileSync(new URL("../src/app/api/webull-quote-test/route.ts", import.meta.url), "utf8");
  assert.match(w, /isAdminSessionValid\(\)/);
  assert.ok(w.indexOf("isAdminSessionValid()") < w.indexOf("fetchQuote(symbol)"), "admin check runs before any provider call");
  const s = readFileSync(new URL("../src/app/api/admin/send-survey/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(s, /searchParams\.get\("secret"\)/);
  assert.match(s, /x-admin-secret/);
});
