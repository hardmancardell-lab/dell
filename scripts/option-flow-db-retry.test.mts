// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/option-flow-db-retry.test.mts
// Regression test (2026-10-26): about one run in four lost SPY's option-flow snapshot to a one-off Supabase 401. The database helper now
// retries transient answers (401, 408, 429, 5xx, dropped connections) a couple of times, never retries a missing table (404) or a
// bad request (400), and gives up after the last delay. Fake fetch and fake keys only; no network.
import { setFakeEnv, install, json, calls } from "./fixtures/fake-fetch.mts";
import * as db from "../src/lib/data/option-flow-db.ts";

let bad = 0, passed = 0;
const t = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else bad++; console.log(ok ? "PASS" : "FAIL", name, ok ? "" : detail); };

setFakeEnv({ SUPABASE_URL: "https://fake.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "fake-service-key-0000000000000000000000000000000000" });
const reply = (status: number, body: unknown = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A one-off 401 then success: the read works and costs two requests.
install((_u, _i, n) => (n === 1 ? reply(401, { message: "Invalid API key" }) : json([])));
let r = await db.getLastSnapshotBeforeSession("SPY", "2026-10-26");
t("a one-off 401 is retried and the read succeeds", r === null && calls.length === 2, String(calls.length));

// The same for a write (idempotent upsert): 401, 503, then success on the third try.
install((_u, _i, n) => (n === 1 ? reply(401) : n === 2 ? reply(503, "upstream") : reply(201)));
let threw = false;
try {
  await db.upsertSnapshot({ symbol: "SPY", snapshot_time: "2026-10-26T18:20:00.000Z", actual_fetch_time: "2026-10-26T18:20:03.000Z", session_date: "2026-10-26", spot: 1, expirations_used: [], expirations_failed: [], call_volume: 0, put_volume: 0, call_premium: 0, put_premium: 0 } as any);
} catch { threw = true; }
t("an upsert survives a 401 then a 503 (three requests)", !threw && calls.length === 3, `threw=${threw} calls=${calls.length}`);

// A dropped connection is retried too.
install((_u, _i, n) => { if (n === 1) throw new TypeError("fetch failed"); return json([]); });
r = await db.getLastSnapshotBeforeSession("SPY", "2026-10-26");
t("a dropped connection is retried", r === null && calls.length === 2, String(calls.length));

// A persistent 401 gives up after the last delay with the original error (3 requests in total).
install(() => reply(401, { message: "Invalid API key" }));
let msg = "";
try { await db.getLastSnapshotBeforeSession("SPY", "2026-10-26"); } catch (e) { msg = String(e?.message ?? e); }
t("a persistent 401 is reported after 3 requests", /Supabase request failed \(401\)/.test(msg) && calls.length === 3, `${msg.slice(0, 80)} calls=${calls.length}`);

// A missing table (404) and a bad request (400) are never retried.
install(() => reply(404, { code: "PGRST205", message: "Could not find the table" }));
msg = "";
try { await db.getLastSnapshotBeforeSession("SPY", "2026-10-26"); } catch (e) { msg = String(e?.message ?? e); }
t("a missing table is reported at once, no retry", /does not exist yet/.test(msg) && calls.length === 1, `${msg.slice(0, 80)} calls=${calls.length}`);
install(() => reply(400, { message: "bad filter" }));
msg = "";
try { await db.getLastSnapshotBeforeSession("SPY", "2026-10-26"); } catch (e) { msg = String(e?.message ?? e); }
t("a bad request is reported at once, no retry", /\(400\)/.test(msg) && calls.length === 1, `${msg.slice(0, 80)} calls=${calls.length}`);

t("the retry delays are short (under 2 seconds in total)", db.RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) < 2000);

console.log(`\n${passed} passed, ${bad} failed`);
if (bad) process.exit(1);
