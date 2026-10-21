// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-privacy.test.mts
// Faye privacy tests (WP-E): the checks that decide whether the memory and mailbox libraries may ship.
//
//   1. Planted secrets (keys, a JWT, a card number, a password, an SSN-shaped value) and a planted chat phrase never appear in
//      logs, exports, usage counts, audit events, error responses, or the arguments sent to the database - on the happy path
//      and on every error path (the database throws or returns an error message that contains the secret).
//   2. Cross-user isolation across the memory AND mailbox libraries: another signed-in owner cannot read, edit, decide, delete,
//      restore, export, pause, erase or cancel anything of someone else's, and gets the same "not found" as for a missing id; a
//      signed-in non-owner is refused everywhere before any database call; no call ever carries a user id.
//   3. "Delete all" and "erase" really remove the text (and the chat phrase from the jobs), and are refused without a recent
//      sign-in or without the exact word DELETE.
//   4. Paused learning stores nothing (no notes, no counts) and uses nothing.
//   5. Held-out eval items never appear in the training set, the FAQ, the persona file or the corpus (needs the Faye repo beside
//      this one, otherwise that block is skipped and says so).
//   6. Redaction parity: the 86 shared vectors through the TypeScript list here AND, when the Faye repo is present, through its
//      Python sanitizer (tests/test_redaction_parity.py --dump), plus the pack hash and UTF-16 length with emoji and CJK text.
//   Plus a static lint of the two migrations (no browser-callable function takes a user id; the erase function covers every table
//   that holds a user's rows).
//
// HONEST LIMIT: the database is a fake that mirrors the SQL functions (same checks, scoped by the signed-in user exactly as the
// SQL scopes by auth.uid()). Row-level security itself, the write-time trigger and the real erase are proved by the PGlite
// harnesses (team_audits/2026-10-20/faye-*-pglite-harness.mjs, WP-A 109 checks, WP-F 132 checks), not here. What this file proves is
// that the application code never leaks through its own logs, responses and arguments, never passes a user id, and drives the
// privacy functions with the right words.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeT } from "./fixtures/fake-fetch.mts";

const base = makeT();

const R = await import("../src/lib/faye/memory/redact.ts");
const H = await import("../src/lib/faye/memory/handlers.ts");
const P = await import("../src/lib/faye/memory/pack.ts");
const MH = await import("../src/lib/faye/mailbox/memory-hook.ts");
const MB = await import("../src/lib/faye/mailbox/handlers.ts");
const V = await import("../src/lib/faye/mailbox/validate.ts");
const G = await import("../src/lib/faye/mailbox/output-guard.ts");
const { SlidingWindowLimiter } = await import("../src/lib/access/rate-limit.ts");

// ------------------------------------------------------------------------------------------------ log capture
const logs: string[] = [];
let capturing = true;
const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
const show = (x: unknown) => {
  if (typeof x === "string") return x;
  try { return JSON.stringify(x); } catch { return String(x); }
};
for (const k of Object.keys(orig)) {
  console[k] = (...a: unknown[]) => { if (capturing) logs.push(a.map(show).join(" ")); else orig[k](...a); };
}
const t = (name: string, ok: boolean, detail = "") => {
  capturing = false;
  base.t(name, ok, detail);
  capturing = true;
};
const note = (s: string) => { capturing = false; orig.log(s); capturing = true; };

// ------------------------------------------------------------------------------------------------ planted values
const SECRET = {
  key: "sk-live-PLANTEDKEY1234567890abcdef",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwbGFudGVkIn0.c2lnbmF0dXJlcGxhbnRlZA",
  card: "4111 1111 1111 1111",
  pass: "password hunter2planted",
  ssn: "123-45-6789",
};
const NEEDLES = [SECRET.key, "PLANTEDKEY", SECRET.jwt, "c2lnbmF0dXJl", SECRET.card, "4111", "hunter2planted", SECRET.ssn];
const CHAT = "PLANTEDCHAT zebra marmalade question";
const NOTE_A = "Likes quokka diagrams and marmalade summaries.";
const NOTE_A2 = "Prefers weekly swing setups over day trades.";
const NOTE_B = "Likes walrus tables and plain bullet lists.";
const found = (blob: string, needles = NEEDLES) => needles.filter((n) => blob.includes(n));
const all = (x: unknown) => JSON.stringify(x);

// ------------------------------------------------------------------------------------------------ the world
const DAY = 86_400_000;
const clock = { t: Date.parse("2026-10-20T15:00:00Z") };
const ENV = { FAYE_MEMORY_ENABLED: "1", FAYE_MAILBOX_ENABLED: "1", FAYE_OWNER_EMAILS: "owner@example.com,second@example.com" };
const recent = (u) => ({ ...u, last_sign_in_at: new Date(clock.t - 5 * 60_000).toISOString() });
const stale = (u) => ({ ...u, last_sign_in_at: new Date(clock.t - 3 * DAY).toISOString() });
const mkUser = (n: number, email: string) => ({ id: `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${String(n).repeat(12)}`, email, email_confirmed_at: "2026-10-01T00:00:00Z" });
const A = mkUser(1, "owner@example.com");
const B = mkUser(2, "second@example.com");
const C = mkUser(3, "stranger@example.com"); // signed in, confirmed, but not on the owner list
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const iso = (ms = clock.t) => new Date(ms).toISOString();

/** A model of the memory and mailbox SQL functions: every function reads the person from the client's session, never from arguments. */
function backend() {
  const users = new Map();
  const jobs = new Map(); // job id -> row with user_id
  const rpcArgs: { uid: string; fn: string; args: unknown }[] = [];
  const U = (uid: string) => {
    if (!users.has(uid)) users.set(uid, { items: [], events: [], stats: new Map(), settings: { learning_paused: false, show_used_notes: true }, memory_enabled: true });
    return users.get(uid);
  };
  const ev = (u, action, item_id = null, extra = {}) => u.events.push({ action, item_id, at: iso(), ...extra }); // never any text
  const live = (u) => u.items.filter((i) => !i.deleted_at);
  const ok = (data) => Promise.resolve({ data, error: null });

  function client(user, { role = "owner" } = {}) {
    const uid = user.id;
    const u = U(uid);
    const c = {
      calls: [] as { fn: string; args: unknown }[],
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc(fn: string, args: Record<string, unknown> = {}) {
        c.calls.push({ fn, args });
        rpcArgs.push({ uid, fn, args });
        return ok(run(fn, args));
      },
    };
    function run(fn: string, a: Record<string, any>) {
      if (fn === "faye_erase_me") {
        if (a.p_confirm !== "DELETE") return { ok: false, code: "bad_request", detail: "confirm_required" };
        const deleted = { faye_memory_items: u.items.length };
        let nj = 0;
        for (const [id, j] of jobs) if (j.user_id === uid) { jobs.delete(id); nj++; }
        u.items = []; u.events = []; u.stats = new Map(); u.settings = { learning_paused: false, show_used_notes: true };
        return { ok: true, deleted: { ...deleted, faye_jobs: nj } };
      }
      if (fn === "faye_memory_note_erased") { ev(u, "erased_all", null, { count: a.p_deleted }); return { ok: true }; }
      if (role !== "owner") return { ok: false, code: "not_allowed" };
      // ---- mailbox
      if (fn === "faye_status") return { ok: true, allowed: true, role, online: true, queue_depth: 0, used_today: 0, daily_cap: 150 };
      if (fn === "faye_submit_job") {
        for (const j of jobs.values()) if (j.user_id === uid && j.request_id === a.p_request_id) return { ok: true, job_id: j.id, status: j.status, deduped: true, queue_ahead: 0, expires_at: null };
        const id = uuid();
        jobs.set(id, { id, user_id: uid, request_id: a.p_request_id, kind: a.p_kind, request: a.p_request, status: "queued" });
        return { ok: true, job_id: id, status: "queued", deduped: false, queue_ahead: 0, expires_at: iso(clock.t + 90_000) };
      }
      if (fn === "faye_poll_job") {
        const j = jobs.get(a.p_job_id);
        if (!j || j.user_id !== uid) return { ok: false, code: "not_found" };
        return { ok: true, job_id: j.id, kind: j.kind, status: j.status, events: [], last_seq: 0, more: false, queue_position: 0, result: null, error: null, purged: false };
      }
      if (fn === "faye_cancel_job") {
        const j = jobs.get(a.p_job_id);
        if (!j || j.user_id !== uid) return { ok: false, code: "not_found" };
        if (j.status === "queued") j.status = "cancelled";
        return { ok: true, status: j.status };
      }
      // ---- memory
      const find = (id, deleted = false) => u.items.find((i) => i.id === id && (deleted ? i.deleted_at : !i.deleted_at));
      if (fn === "faye_memory_list") return { ok: true, items: u.items.filter((i) => a.p_include_deleted || !i.deleted_at).map((i) => ({ ...i })), settings: { ...u.settings } };
      if (fn === "faye_memory_add") {
        if ((a.p_source === "observed" || a.p_status === "proposed") && u.settings.learning_paused) return { ok: false, code: "paused" };
        const s = R.screenMemoryText(a.p_fact);
        if (!s.ok) { ev(u, "dropped", null, { count: 1, source: a.p_source }); return { ok: false, code: "text_rejected", detail: s.reason }; }
        const dup = live(u).find((i) => i.fact.toLowerCase() === s.text.toLowerCase());
        if (dup) return { ok: true, id: dup.id, duplicate: true, superseded: null, item: { ...dup } };
        const item = { id: uuid(), category: a.p_category, slot: a.p_slot, fact: s.text, source: a.p_source, source_ref: a.p_source_ref, confidence: a.p_confidence ?? 95, evidence_count: 1, status: a.p_status, approved_by: a.p_status === "approved" ? "owner" : null, created_at: iso(), updated_at: iso(), approved_at: a.p_status === "approved" ? iso() : null, last_used_at: null, last_observed_at: iso(), use_count: 0, expires_at: null, supersedes: null, usefulness: 0, deleted_at: null };
        u.items.push(item);
        ev(u, item.status === "approved" ? "created" : "proposed", item.id, { source: item.source });
        return { ok: true, id: item.id, duplicate: false, superseded: null, item: { ...item } };
      }
      if (fn === "faye_memory_edit") {
        const i = find(a.p_id); if (!i) return { ok: false, code: "not_found" };
        if (a.p_fact !== null) { const s = R.screenMemoryText(a.p_fact); if (!s.ok) { ev(u, "dropped", null, { count: 1 }); return { ok: false, code: "text_rejected", detail: s.reason }; } i.fact = s.text; }
        if (a.p_category) i.category = a.p_category;
        ev(u, "edited", i.id);
        return { ok: true, item: { ...i } };
      }
      if (fn === "faye_memory_decide") {
        const i = find(a.p_id); if (!i) return { ok: false, code: "not_found" };
        const need = { approve: "proposed", reject: "proposed", retire: "approved", revive: "retired" }[a.p_decision];
        if (i.status !== need) return { ok: false, code: "conflict", detail: "wrong_state" };
        i.status = { approve: "approved", reject: "rejected", retire: "retired", revive: "approved" }[a.p_decision];
        ev(u, a.p_decision, i.id);
        return { ok: true, item: { ...i }, superseded: null };
      }
      if (fn === "faye_memory_delete") {
        const i = find(a.p_id); if (!i) return { ok: false, code: "not_found" };
        if (a.p_permanent) { u.items = u.items.filter((x) => x !== i); ev(u, "purged", i.id, { count: 1 }); return { ok: true, permanent: true }; }
        i.deleted_at = iso(); ev(u, "deleted", i.id);
        return { ok: true, permanent: false, undo_minutes: 10 };
      }
      if (fn === "faye_memory_restore") {
        const i = find(a.p_id, true); if (!i) return { ok: false, code: "not_found" };
        i.deleted_at = null; ev(u, "restored", i.id);
        return { ok: true, item: { ...i } };
      }
      if (fn === "faye_memory_delete_all") {
        if (a.p_confirm !== "DELETE") return { ok: false, code: "bad_request", detail: "confirm_required" };
        const n = u.items.length, s = u.stats.size;
        u.items = []; u.stats = new Map(); ev(u, "deleted_all", null, { count: n });
        return { ok: true, deleted: { faye_memory_items: n, faye_usage_stats: s } };
      }
      if (fn === "faye_memory_update_settings") {
        const was = u.settings.learning_paused;
        if (typeof a.p_learning_paused === "boolean") u.settings.learning_paused = a.p_learning_paused;
        if (typeof a.p_show_used_notes === "boolean") u.settings.show_used_notes = a.p_show_used_notes;
        if (typeof a.p_learning_paused === "boolean" && a.p_learning_paused !== was) ev(u, a.p_learning_paused ? "paused" : "resumed");
        return { ok: true, settings: { ...u.settings } };
      }
      if (fn === "faye_memory_export") {
        ev(u, "exported", null, { count: live(u).length });
        return { ok: true, exported_at: iso(), items: live(u).map((i) => ({ ...i })), settings: { ...u.settings }, usage_stats: [...u.stats.values()], events: u.events.map((e) => ({ ...e })) };
      }
      if (fn === "faye_memory_candidates") return { ok: true, memory_enabled: u.memory_enabled, paused: u.settings.learning_paused, items: live(u).filter((i) => i.status === "approved").map((i) => ({ ...i })) };
      if (fn === "faye_memory_touch") { let n = 0; for (const i of live(u)) if (a.p_ids.includes(i.id) && i.status === "approved") { i.use_count += 1; n++; } return { ok: true, touched: n }; }
      if (fn === "faye_usage_bump") {
        if (u.settings.learning_paused) return { ok: false, code: "paused" };
        const row = u.stats.get(a.p_day) ?? { day: a.p_day, topic_counts: {}, ticker_counts: {}, hour_hist: {}, questions: 0 };
        for (const [k, v] of Object.entries(a.p_topics)) row.topic_counts[k] = (row.topic_counts[k] ?? 0) + (v as number);
        for (const [k, v] of Object.entries(a.p_tickers)) row.ticker_counts[k] = (row.ticker_counts[k] ?? 0) + (v as number);
        row.hour_hist[String(a.p_hour)] = (row.hour_hist[String(a.p_hour)] ?? 0) + 1;
        row.questions += 1; u.stats.set(a.p_day, row);
        return { ok: true, questions: row.questions };
      }
      if (fn === "faye_usage_recent") return { ok: true, rows: [...u.stats.values()] };
      if (fn === "faye_memory_note_dropped") { ev(u, "dropped", null, { count: a.p_count, source: a.p_source }); return { ok: true }; }
      return { ok: false, code: "server_error" };
    }
    return c;
  }
  /** Everything held for one person, as text. Used to prove that erased text is gone. */
  const tables = (uid: string) => all(users.get(uid) ? { ...users.get(uid), stats: [...users.get(uid).stats.values()] } : null);
  const jobText = (uid: string) => all([...jobs.values()].filter((j) => j.user_id === uid));
  const dump = (uid: string) => tables(uid) + jobText(uid);
  return { client, dump, tables, jobText, jobs, users, rpcArgs, U };
}

const limiters = () => ({
  read: new SlidingWindowLimiter(10_000, 60_000), write: new SlidingWindowLimiter(10_000, 60_000),
  remember: new SlidingWindowLimiter(10_000, 60_000), heavy: new SlidingWindowLimiter(10_000, 600_000),
});
const mbLimiters = () => ({ create: new SlidingWindowLimiter(10_000, 60_000), poll: new SlidingWindowLimiter(10_000, 60_000), status: new SlidingWindowLimiter(10_000, 60_000) });
const memDeps = (client, over = {}) => ({ env: ENV, getClient: async () => client, now: () => clock.t, limiters: limiters(), ...over });
const mbDeps = (client, over = {}) => ({ env: ENV, getClient: async () => client, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, limiters: mbLimiters(), ...over });
const post = (path, body, method = "POST", headers = {}) =>
  new Request("https://dell.test" + path, { method, body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", host: "dell.test", origin: "https://dell.test", ...headers } });
const get = (path) => new Request("https://dell.test" + path, { headers: { host: "dell.test" } });
const J = async (res) => res.json();
const typed = (message) => ({ message, from: "typed", tz: "UTC" });
const logsText = () => logs.join("\n");

// ================================================================================================ 1. planted secrets
{
  t("detector: the leak scan itself flags every planted value (so the 'nothing leaked' checks below are not vacuous)",
    Object.values(SECRET).every((v) => found(`line ${v} end`).length > 0) && found(`x ${CHAT}`, ["PLANTEDCHAT"]).length === 1 && found("clean text").length === 0);
  note(`INFO limit: a bare short password typed with no trigger word ("Uses hunter2planted for access") ${R.screenMemoryText("Uses hunter2planted for access").ok ? "IS accepted" : "is refused"} - the list keys on words (password, token, key ...) and on long or key-shaped strings, so it cannot recognize an unlabeled short secret.`);
  const be = backend();
  const c = be.client(recent(A));
  const d = memDeps(c);
  const bodies: string[] = [];
  const seen = async (res) => { const body = await res.clone().text(); bodies.push(body); return res; };

  // 1a. About me: add
  let rejected = 0;
  for (const [label, text] of Object.entries(SECRET)) {
    const res = await seen(await H.handleAdd(post("/api/faye/memory", { fact: `Uses ${text} for access` }), d));
    if (res.status === 422) rejected++;
  }
  t("secrets: About-me add refuses every planted secret (422)", rejected === Object.keys(SECRET).length, `refused ${rejected}`);
  t("secrets: nothing was stored", be.U(A.id).items.length === 0);
  t("secrets: the refusal responses never repeat the secret", found(bodies.join("")).length === 0);
  t("secrets: the arguments sent to the database never held a secret (only counters were logged)", found(all(c.calls)).length === 0 && c.calls.every((k) => k.fn === "faye_memory_note_dropped"));

  // 1b. chat command "remember that ..."
  const rem = async (message) => { const res = await seen(await H.handleRemember(post("/api/faye/memory/remember", typed(message)), d)); return J(res); };
  const results = [];
  for (const text of Object.values(SECRET)) results.push(await rem(`remember that my login is ${text}`));
  t("secrets: 'remember that ...' refuses every planted secret and says why without repeating it", results.every((r) => r.action === "refused" && found(all(r)).length === 0), all(results.map((r) => r.action)));
  t("secrets: still nothing stored", be.U(A.id).items.length === 0);

  // 1c. a normal note, then a secret edit
  const add = await J(await seen(await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A }), d)));
  const noteId = add.id;
  const edit = await seen(await H.handleEdit(post("/api/faye/memory/" + noteId, { fact: `Key is ${SECRET.key}` }, "PATCH"), noteId, d));
  t("secrets: editing a note into a secret is refused and the note keeps its words", edit.status === 422 && be.U(A.id).items[0].fact === NOTE_A);

  // 1d. ordinary chat messages that contain secrets and the planted phrase (the learning path)
  const chatMessages = [`${CHAT} How does gamma work? my token is ${SECRET.key}`, `${CHAT} ${SECRET.jwt} what is a call option on NVDA?`, `${CHAT} card ${SECRET.card} ssn ${SECRET.ssn} and password ${SECRET.pass}`];
  for (const m of chatMessages) await rem(m);
  const stats = [...be.U(A.id).stats.values()];
  t("secrets: usage counts hold numbers only, never the message", stats.length > 0 && found(all(stats), [...NEEDLES, "PLANTEDCHAT", "zebra", "marmalade"]).length === 0, all(stats).slice(0, 200));
  t("secrets: the bump call carries only keys and whole numbers", c.calls.filter((k) => k.fn === "faye_usage_bump").every((k) => found(all(k.args), [...NEEDLES, "PLANTEDCHAT", "zebra"]).length === 0
    && Object.values(k.args.p_topics).every(Number.isInteger) && Object.values(k.args.p_tickers).every(Number.isInteger)));
  t("secrets: no note or proposal was made from a message that held a secret", be.U(A.id).items.every((i) => found(i.fact).length === 0 && !i.fact.includes("PLANTEDCHAT")));

  // 1e. poisoned rows that reached the table another way never reach a pack
  const poisoned = be.client(recent(B));
  const bu = be.U(B.id);
  for (const [i, text] of Object.values(SECRET).entries()) {
    bu.items.push({ id: uuid(), category: "style", slot: null, fact: `Uses ${text} daily`, source: "stated", status: "approved", confidence: 95, created_at: iso(clock.t - DAY), updated_at: iso(clock.t - DAY), approved_at: iso(clock.t - DAY), last_observed_at: iso(clock.t - DAY), usefulness: 0, use_count: 0, deleted_at: null });
  }
  const pk = await P.buildPackFromMemory({ client: poisoned, userId: B.id, question: "How do I use daily access?", env: ENV, now: () => clock.t });
  t("secrets: rows holding secrets never reach a memory pack", pk === null || found(all(pk)).length === 0);

  // 1f. export holds the owner's own note (by design) but no secret and no audit text
  const exp = await J(await H.handleExport(post("/api/faye/memory/export", {}), d));
  t("secrets: the export holds the owner's note", exp.items.some((i) => i.fact === NOTE_A));
  t("secrets: the export holds no planted secret and no chat phrase", found(all(exp), [...NEEDLES, "PLANTEDCHAT", "zebra"]).length === 0);
  t("secrets: audit events carry no text at all", exp.events.every((e) => Object.values(e).every((v) => v === null || typeof v === "number" || /^[a-z_0-9:.\-TZ+]+$/i.test(String(v)))) && !all(exp.events).includes("quokka"));

  // 1g. error paths: the database throws, or answers with an error message that contains the secret
  const hostileErrors = [
    { rpc: async () => { throw new Error(`boom ${SECRET.key} ${CHAT}`); } },
    { rpc: async () => ({ data: null, error: { code: "XX000", message: `bad row ${SECRET.jwt} ${CHAT} ${NOTE_A}` } }) },
    { rpc: async () => ({ data: { ok: false, code: "text_rejected", detail: `contains ${SECRET.pass}` }, error: null }) },
    { rpc: async () => ({ data: { ok: false, code: SECRET.key }, error: null }) },
  ];
  const errBodies: string[] = [];
  for (const h of hostileErrors) {
    const cl = { auth: { getUser: async () => ({ data: { user: recent(A) }, error: null }) }, rpc: h.rpc };
    const dd = memDeps(cl);
    for (const res of [
      await H.handleList(get("/api/faye/memory"), dd),
      await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A2 }), dd),
      await H.handleRemember(post("/api/faye/memory/remember", typed(`remember that ${NOTE_A2}`)), dd),
      await H.handleExport(post("/api/faye/memory/export", {}), dd),
      await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), dd),
      await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-error-0001", kind: "chat", question: `${CHAT} ${SECRET.key}`, state: {} }), mbDeps(cl)),
      await MB.handlePollJob(get("/api/faye/jobs/" + uuid()), uuid(), mbDeps(cl)),
    ]) errBodies.push(await res.text());
  }
  t("secrets: an error from the database never reaches a response (memory and mailbox, 4 failure shapes)", found(errBodies.join(""), [...NEEDLES, "PLANTEDCHAT", "quokka"]).length === 0);

  // 1h. mailbox: the question is carried in the job for the worker (by design) but never logged and never in an error
  const mb = backend();
  const ca = mb.client(recent(A));
  const created = await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-chat-aaaa01", kind: "chat", question: `${CHAT} ${SECRET.key}`, state: {} }), mbDeps(ca));
  const cb = await J(created);
  t("secrets: a chat job is accepted and stored for the worker (the one place the question travels)", created.status === 201 && cb.ok === true && [...mb.jobs.values()].some((j) => j.request.question.includes("PLANTEDCHAT")));
  t("secrets: the create response does not echo the question", found(all(cb), [...NEEDLES, "PLANTEDCHAT"]).length === 0);

  // 1i. nothing was logged, ever
  const L = logsText();
  t("secrets: no log line (console.log/info/warn/error/debug) holds a planted secret, the chat phrase or a note's words", found(L, [...NEEDLES, "PLANTEDCHAT", "zebra", "marmalade", "quokka", "walrus"]).length === 0, L.slice(0, 300));
  t("secrets: the library does log failures (so the previous check is not vacuous), by code only", logs.some((l) => /faye (memory|mailbox)/.test(l)), `${logs.length} lines`);
}

// ================================================================================================ 2. cross-user isolation
{
  const be = backend();
  const cA = be.client(recent(A));
  const cB = be.client(recent(B));
  const cC = be.client(recent(C), { role: null });
  const dA = memDeps(cA), dB = memDeps(cB), dC = memDeps(cC);

  const a1 = await J(await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A }), dA));
  const a2 = await J(await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A2 }), dA));
  await J(await H.handleAdd(post("/api/faye/memory", { fact: NOTE_B }), dB));
  await H.handleRemember(post("/api/faye/memory/remember", typed(`I mostly trade options. ${CHAT}`)), dA);
  const aBefore = be.dump(A.id);

  // reads
  const lb = await J(await H.handleList(get("/api/faye/memory"), dB));
  t("isolation: B's list holds only B's notes", lb.items.length === 1 && lb.items[0].fact === NOTE_B && !all(lb).includes("quokka") && !all(lb).includes("swing"));
  const lb2 = await J(await H.handleList(get("/api/faye/memory?include_deleted=1"), dB));
  t("isolation: include_deleted does not widen the scope", !all(lb2).includes("quokka"));
  const expB = await J(await H.handleExport(post("/api/faye/memory/export", {}), dB));
  t("isolation: B's export holds exactly B's rows (no A text, no A counts)", expB.items.length === 1 && !all(expB).includes("quokka") && !all(expB).includes("swing") && expB.usage_stats.length === 0);
  const packB = await P.buildPackFromMemory({ client: cB, userId: B.id, question: "quokka diagrams marmalade swing setups", env: ENV, now: () => clock.t });
  t("isolation: B's memory pack never contains A's notes", !all(packB).includes("quokka") && !all(packB).includes("swing"));
  t("isolation: a user id passed to the pack builder is never used to widen the query (the call carries no user id)", cB.calls.every((k) => !/user|uid/i.test(Object.keys(k.args ?? {}).join(","))));

  // writes: same status as a missing id
  const ghost = uuid();
  const statusOf = async (res) => res.status;
  const attempts = [
    ["edit", (id) => H.handleEdit(post("/api/faye/memory/" + id, { fact: "Hijacked by B for fun." }, "PATCH"), id, dB)],
    ["delete", (id) => H.handleDelete(post("/api/faye/memory/" + id, {}, "DELETE"), id, dB)],
    ["permanent delete", (id) => H.handleDelete(post("/api/faye/memory/" + id + "?permanent=1", {}, "DELETE"), id, dB)],
    ["retire", (id) => H.handleDecision(post("/api/faye/memory/" + id + "/decision", { decision: "retire" }), id, dB)],
    ["reject", (id) => H.handleDecision(post("/api/faye/memory/" + id + "/decision", { decision: "reject" }), id, dB)],
    ["undelete", (id) => H.handleDecision(post("/api/faye/memory/" + id + "/decision", { decision: "undelete" }), id, dB)],
  ];
  for (const [name, fn] of attempts) {
    const real = await fn(a1.id);
    const miss = await fn(ghost);
    const rb = await real.text();
    t(`isolation: B cannot ${name} A's note (404, identical to a missing id, nothing revealed)`, real.status === 404 && real.status === (await statusOf(miss)) && !rb.includes("quokka"), `${real.status}`);
  }
  t("isolation: A's rows are untouched by all of that", be.dump(A.id) === aBefore);

  // B's wholesale actions leave A alone
  const delAllB = await J(await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), dB));
  t("isolation: B's delete-all removes only B's rows", delAllB.ok === true && be.dump(A.id) === aBefore && be.U(B.id).items.length === 0);
  await H.handleSettings(post("/api/faye/memory/settings", { learning_paused: true }), dB);
  t("isolation: B pausing learning does not pause A", be.U(A.id).settings.learning_paused === false && be.U(B.id).settings.learning_paused === true);
  const eraseB = await J(await H.handleErase(post("/api/faye/memory/erase", { confirm: "DELETE" }), dB));
  t("isolation: B's erase removes only B's rows and jobs", eraseB.ok === true && be.dump(A.id) === aBefore);
  const fg = await J(await H.handleRemember(post("/api/faye/memory/remember", typed("forget that I like quokka diagrams and marmalade summaries")), dB));
  t("isolation: 'forget that ...' typed by B cannot delete A's note", fg.action === "ambiguous" && be.U(A.id).items.find((i) => i.fact === NOTE_A) && !be.U(A.id).items.find((i) => i.fact === NOTE_A).deleted_at);

  // a signed-in stranger (not on the owner list)
  const strangers = [
    await H.handleList(get("/api/faye/memory"), dC),
    await H.handleAdd(post("/api/faye/memory", { fact: NOTE_B }), dC),
    await H.handleRemember(post("/api/faye/memory/remember", typed("remember that I like tables")), dC),
    await H.handleEdit(post("/api/faye/memory/" + a1.id, { fact: "Hijacked." }, "PATCH"), a1.id, dC),
    await H.handleDelete(post("/api/faye/memory/" + a1.id, {}, "DELETE"), a1.id, dC),
    await H.handleExport(post("/api/faye/memory/export", {}), dC),
    await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), dC),
    await H.handleErase(post("/api/faye/memory/erase", { confirm: "DELETE" }), dC),
    await H.handleSettings(post("/api/faye/memory/settings", { learning_paused: true }), dC),
    await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-stranger-01", kind: "chat", question: "hello there", state: {} }), mbDeps(cC)),
    await MB.handlePollJob(get("/api/faye/jobs/" + uuid()), uuid(), mbDeps(cC)),
    await MB.handleCancelJob(post("/api/faye/jobs/" + uuid() + "/cancel", {}), uuid(), mbDeps(cC)),
  ];
  t("isolation: a signed-in non-owner is refused (403) on all 12 memory and mailbox routes", strangers.every((r) => r.status === 403), strangers.map((r) => r.status).join());
  t("isolation: the refusal happens before any database call", cC.calls.length === 0);
  const noSession = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, rpc: async () => { throw new Error("must not be called"); } };
  const anon = [await H.handleList(get("/api/faye/memory"), memDeps(noSession)), await MB.handleStatus(get("/api/faye/status"), mbDeps(noSession))];
  t("isolation: no session -> 401 and no database call", anon.every((r) => r.status === 401));

  // mailbox
  const cA2 = be.client(recent(A));
  const create = await J(await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-shared-0001", kind: "chat", question: `${CHAT} what is gamma?`, state: {} }), mbDeps(cA2)));
  const jobA = create.job_id;
  const pollB = await MB.handlePollJob(get("/api/faye/jobs/" + jobA), jobA, mbDeps(cB));
  const pollGhost = await MB.handlePollJob(get("/api/faye/jobs/" + ghost), ghost, mbDeps(cB));
  const pb = await pollB.text();
  t("isolation: B cannot poll A's job (404 like a missing id, no text)", pollB.status === 404 && pollB.status === pollGhost.status && !pb.includes("PLANTEDCHAT"));
  const cancelB = await MB.handleCancelJob(post("/api/faye/jobs/" + jobA + "/cancel", {}), jobA, mbDeps(cB));
  t("isolation: B cannot cancel A's job and the job stays queued", cancelB.status === 404 && be.jobs.get(jobA).status === "queued");
  const sameReq = await J(await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-shared-0001", kind: "chat", question: "B's own question about bonds", state: {} }), mbDeps(cB)));
  t("isolation: B reusing A's request id gets B's own job, not A's (no dedupe across people)", sameReq.ok === true && sameReq.job_id !== jobA && sameReq.deduped === false);
  t("isolation: B's job carries no memory from A", be.jobs.get(sameReq.job_id).user_id === B.id && !all(be.jobs.get(sameReq.job_id).request).includes("quokka"));
  const pollA = await MB.handlePollJob(get("/api/faye/jobs/" + jobA), jobA, mbDeps(cA2));
  t("isolation: A can still poll A's own job", pollA.status === 200);

  // memory pack inside A's job holds only A's notes
  const cA3 = be.client(recent(A));
  await J(await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-memory-0001", kind: "chat", question: "show quokka diagrams and weekly swing setups", state: {} }), mbDeps(cA3)));
  const jobWithPack = [...be.jobs.values()].find((j) => j.request_id === "req-memory-0001");
  const packText = all(jobWithPack.request.memory);
  t("isolation: A's chat job carries A's relevant notes (the pack) and none of B's", packText.includes("quokka") && !packText.includes("walrus"));

  // no call ever carried a user id
  const userIds = [A.id, B.id, C.id];
  const bad = be.rpcArgs.filter((r) => /user|uid/i.test(Object.keys(r.args ?? {}).join(",")) || userIds.some((id) => all(r.args).includes(id)));
  t(`isolation: none of the ${be.rpcArgs.length} database calls carried a user id (the person comes from the session)`, bad.length === 0, all(bad.slice(0, 2)));
}

// ================================================================================================ 3. delete-all and erase
{
  const be = backend();
  const c = be.client(recent(A));
  const cOther = be.client(recent(B));
  const d = memDeps(c);
  await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A }), d);
  await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A2 }), d);
  await H.handleRemember(post("/api/faye/memory/remember", typed(`${CHAT} how does gamma work on NVDA options?`)), d);
  await H.handleAdd(post("/api/faye/memory", { fact: NOTE_B }), memDeps(cOther));
  await MB.handleCreateJob(post("/api/faye/jobs", { request_id: "req-erase-00001", kind: "chat", question: `${CHAT} private portfolio question`, state: { page: "Dellegate", portfolio: { positions: [{ symbol: "PLNT", assetClass: "equity", shares: 500, costBasisValue: 12345.6 }] } } }), mbDeps(c));
  const bBefore = be.dump(B.id);
  t("erase: setup holds the canary text in notes, a job question, a job pack and the portfolio blob", be.tables(A.id).includes("quokka") && be.jobText(A.id).includes("PLANTEDCHAT") && be.jobText(A.id).includes("PLNT"), be.jobText(A.id).slice(0, 200));

  // refusals first
  const stalePerson = be.client(stale(A));
  let r = await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), memDeps(stalePerson));
  t("delete-all: refused without a recent sign-in (403 reauth_required) and nothing is deleted", r.status === 403 && (await J(r)).code === "reauth_required" && be.dump(A.id).includes("quokka"));
  r = await H.handleErase(post("/api/faye/memory/erase", { confirm: "DELETE" }), memDeps(stalePerson));
  t("erase: refused without a recent sign-in", r.status === 403 && be.dump(A.id).includes("quokka"));
  r = await H.handleExport(post("/api/faye/memory/export", {}), memDeps(stalePerson));
  t("export: refused without a recent sign-in", r.status === 403);
  for (const body of [{}, { confirm: "delete" }, { confirm: "yes" }, { confirm: true }]) {
    const x = await H.handleDeleteAll(post("/api/faye/memory/delete-all", body), d);
    const y = await H.handleErase(post("/api/faye/memory/erase", body), d);
    t(`delete-all and erase: ${JSON.stringify(body)} is not the word DELETE (400, nothing deleted)`, x.status === 400 && y.status === 400 && be.dump(A.id).includes("quokka"));
  }
  const noSession = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, rpc: async () => { throw new Error("no"); } };
  r = await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), memDeps(noSession));
  t("delete-all: no session -> 401", r.status === 401);

  // soft delete hides at once everywhere a person or Faye could read it; permanent removes the row
  const list = await J(await H.handleList(get("/api/faye/memory"), d));
  const first = list.items.find((i) => i.fact === NOTE_A);
  await H.handleDelete(post("/api/faye/memory/" + first.id, {}, "DELETE"), first.id, d);
  const afterSoft = await J(await H.handleList(get("/api/faye/memory"), d));
  const expSoft = await J(await H.handleExport(post("/api/faye/memory/export", {}), d));
  const packSoft = await P.buildPackFromMemory({ client: c, userId: A.id, question: "quokka diagrams marmalade", env: ENV, now: () => clock.t });
  t("delete one: a deleted note disappears from the list, the export and every pack at once", !all(afterSoft).includes("quokka") && !all(expSoft).includes("quokka") && !all(packSoft).includes("quokka"));
  await H.handleDelete(post("/api/faye/memory/" + first.id + "?permanent=1", {}, "DELETE"), first.id, d).catch(() => undefined);
  const second = (await J(await H.handleList(get("/api/faye/memory"), d))).items.find((i) => i.fact === NOTE_A2);
  await H.handleDelete(post("/api/faye/memory/" + second.id + "?permanent=1", {}, "DELETE"), second.id, d);
  t("delete one (permanent): the words are gone from storage immediately", !be.dump(A.id).includes("swing"));

  // delete all removes notes and counts, leaves the jobs (they have their own 24 h purge and the erase)
  await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A2 }), d);
  r = await H.handleDeleteAll(post("/api/faye/memory/delete-all", { confirm: "DELETE" }), d);
  const da = await J(r);
  const tablesAfter = be.tables(A.id);
  t("delete-all: succeeds for a recent session and reports what it removed", r.status === 200 && da.ok === true && da.deleted.faye_memory_items >= 1);
  t("delete-all: no note text and no usage counts remain in the memory tables", !tablesAfter.includes("quokka") && !tablesAfter.includes("swing") && be.U(A.id).stats.size === 0 && be.U(A.id).items.length === 0);
  const inJobs = be.jobText(A.id).includes("quokka");
  note(`INFO delete-all: ${inJobs ? "note text from the memory pack still sits inside the user's earlier job payloads" : "no note text remains in job payloads"} (the database purges payloads after 24 hours; "erase everything" removes them at once). The About-me copy must not promise more than that.`)
  const expAfter = await J(await H.handleExport(post("/api/faye/memory/export", {}), d));
  t("delete-all: the next export holds zero items and zero counts", expAfter.items.length === 0 && expAfter.usage_stats.length === 0);

  // erase removes the jobs (the chat text and the portfolio blob) and leaves one content-free line
  r = await H.handleErase(post("/api/faye/memory/erase", { confirm: "DELETE" }), d);
  const er = await J(r);
  const gone = be.dump(A.id);
  t("erase: succeeds and reports the tables it emptied", r.status === 200 && er.ok === true && typeof er.deleted.faye_jobs === "number" && er.deleted.faye_jobs >= 1);
  t("erase: the chat text, the portfolio blob, the pack copy and all notes are gone", !gone.includes("PLANTEDCHAT") && !gone.includes("PLNT") && !gone.includes("quokka") && [...be.jobs.values()].every((j) => j.user_id !== A.id));
  t("erase: only a content-free 'erased_all' line survives", be.U(A.id).events.length === 1 && be.U(A.id).events[0].action === "erased_all");
  t("erase: the other person's rows are untouched", be.dump(B.id) === bBefore);
  t("erase and delete-all log nothing with text", found(logsText(), ["PLANTEDCHAT", "quokka", "PLNT"]).length === 0);
}

// ================================================================================================ 4. paused learning
{
  const be = backend();
  const c = be.client(recent(A));
  const d = memDeps(c);
  const rem = async (message) => J(await H.handleRemember(post("/api/faye/memory/remember", typed(message)), d));
  await H.handleAdd(post("/api/faye/memory", { fact: NOTE_A }), d);
  await rem("I'd like short answers. NVDA options?");
  const itemsBefore = be.U(A.id).items.length;
  const statsBefore = all([...be.U(A.id).stats.values()]);
  const eventsBefore = be.U(A.id).events.length;

  const pause = await H.handleSettings(post("/api/faye/memory/settings", { learning_paused: true }), d);
  t("pause: accepted", pause.status === 200 && (await J(pause)).settings.learning_paused === true);
  const callsBefore = c.calls.length;
  const messages = ["I mostly trade futures. I'd like detailed answers. AMD gamma?", "I usually open Faye on weekday mornings and my goal is to pass the CFA", `${CHAT} SPY volatility earnings macro`, "I'd like the number first. I mostly trade options."];
  const replies = [];
  for (const m of messages) replies.push(await rem(m));
  t("pause: every message is answered 'learning paused, proposed 0'", replies.every((x) => x.learning_paused === true && x.proposed === 0), all(replies));
  t("pause: no note, no proposal and no count was stored", be.U(A.id).items.length === itemsBefore && all([...be.U(A.id).stats.values()]) === statsBefore);
  t("pause: nothing was written to the audit trail either (no dropped, proposed or created lines)", be.U(A.id).events.slice(eventsBefore).every((e) => e.action === "paused"));
  t("pause: the only calls made while paused are the refused count bumps", c.calls.slice(callsBefore).every((k) => k.fn === "faye_usage_bump"), all(c.calls.slice(callsBefore).map((k) => k.fn)));
  const memUsed = await P.buildPackFromMemory({ client: c, userId: A.id, question: "quokka diagrams marmalade", env: ENV, now: () => clock.t });
  t("pause: no memory is used in answers while paused", memUsed === null);
  const hookUsed = await MH.attachMemoryPack({ client: c, userId: A.id, question: "quokka diagrams marmalade", env: ENV });
  t("pause: the chat-job hook attaches no pack while paused", hookUsed === null);
  const explicit = await rem("remember that I like the number first");
  t("pause: the owner's explicit 'remember' still saves (the design keeps that working)", explicit.action === "saved");
  const resume = await H.handleSettings(post("/api/faye/memory/settings", { learning_paused: false }), d);
  const after = await rem("I mostly trade futures.");
  t("resume: learning works again", resume.status === 200 && after.proposed >= 1);

  // direct attempts to write learned data while paused are refused by the (fake) database function as the SQL does
  await H.handleSettings(post("/api/faye/memory/settings", { learning_paused: true }), d);
  const direct = await c.rpc("faye_memory_add", { p_category: "habit", p_slot: null, p_fact: "Often asks about options.", p_source: "observed", p_source_ref: "stats:x", p_confidence: 60, p_status: "proposed" });
  t("pause: an observed proposal written straight to the database function is refused (paused)", direct.data.ok === false && direct.data.code === "paused");
}

// ================================================================================================ 5. held-out never in training or corpus
const FAYE = process.env.FAYE_REPO || join(homedir(), "Documents", "Pilp_Assistant");
const PY = process.platform === "win32" ? join(FAYE, ".venv", "Scripts", "python.exe") : join(FAYE, ".venv", "bin", "python");
const fayePresent = existsSync(join(FAYE, "pilp", "eval_suite.py")) && existsSync(PY);
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function py(args: string[]) {
  const r = spawnSync(PY, args, { cwd: FAYE, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, timeout: 120_000 });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
{
  const sql = readFileSync("db/migrations/2026-10-20_faye_memory.sql", "utf8");
  t("held-out: the memory write-time trigger refuses a note that contains an owner's held-out question", /split = ''heldout''/.test(sql) && /text rejected \(heldout\)/.test(sql));
  const labFiles = readdirSync("db/migrations").filter((f) => /faye_lab/.test(f));
  if (labFiles.length === 0) {
    note("PENDING held-out: no Lab migration yet (WP-C2). When it lands, this file asserts its check (split = 'heldout' and used_in_corpus) and the corpus-note trigger.");
  } else {
    const lab = labFiles.map((f) => readFileSync(join("db/migrations", f), "utf8")).join("\n");
    t("held-out: the Lab migration refuses used_in_corpus on a held-out item", /heldout/.test(lab) && /used_in_corpus/.test(lab) && /check\s*\(\s*not\s*\(\s*split\s*=\s*'heldout'\s+and\s+used_in_corpus/i.test(lab));
    t("held-out: the Lab migration blocks linking a held-out item to a corpus note", /faye_corpus_notes/.test(lab) && /heldout/.test(lab) && /trigger/i.test(lab));
  }

  if (!fayePresent) {
    note("SKIP held-out vs corpus: the Faye repo with its venv was not found (set FAYE_REPO).");
  } else {
    const sets = JSON.parse(py(["-m", "pilp.eval_suite", "--list"]).out);
    const heldout = sets.heldout.map((x) => x.question);
    t("held-out: the built-in held-out set is 8 questions", heldout.length === 8);
    const trainSets = [...sets.guardrail, ...sets.model_advice, ...sets.domain.map((x) => x.question), ...Object.values(sets.persona).flat()];
    const trainNorm = new Set(trainSets.map(norm));
    t("held-out: no held-out question is in the guardrail, domain, model-probe or persona sets", heldout.every((q) => !trainNorm.has(norm(q))));
    const files = [join(FAYE, "corpus", "data", "faye-app-faq.md"), join(FAYE, "persona", "faye_persona.json")];
    const notesDir = join(FAYE, "corpus", "data", "user-notes");
    if (existsSync(notesDir)) for (const f of readdirSync(notesDir)) files.push(join(notesDir, f));
    const texts = files.filter(existsSync).map((f) => norm(readFileSync(f, "utf8")));
    t("held-out: no held-out question appears in the FAQ, the persona file or any user note", heldout.every((q) => texts.every((x) => !x.includes(norm(q)))));
    const packNotes = Object.values(sets.packs).flat().map(norm).join(" ");
    t("held-out: no held-out question appears in the synthetic memory packs", heldout.every((q) => !packNotes.includes(norm(q))));
    // a memory note equal to a held-out question is also a training leak; the app's list would accept the words, the DB trigger refuses them
    const asNotes = heldout.map((q) => R.screenMemoryText(q));
    note(`INFO held-out as memory notes: ${asNotes.filter((x) => x.ok).length} of ${heldout.length} would pass the TypeScript list (the database trigger is what refuses them once the Lab table exists)`);
  }
}

// ================================================================================================ 6. redaction parity
{
  const vectors = JSON.parse(readFileSync(new URL("./fixtures/faye-memory-vectors.json", import.meta.url), "utf8"));
  const verdict = (text) => { const r = R.screenMemoryText(text); return r.ok ? null : r.reason; };
  t("parity: the TypeScript list gives the recorded verdict on all 86 vectors", vectors.length === 86 && vectors.every((v) => verdict(v.text) === v.expect));

  // pack hash and UTF-16 length with emoji, CJK and combining accents: against hashes the TypeScript side wrote into the Faye fixture
  const shared = [
    { id: "00000000-0000-0000-0000-000000000001", cat: "style", t: "Likes the number first." },
    { id: "00000000-0000-0000-0000-000000000002", cat: "goal", t: "Wants a d" + String.fromCharCode(0xe9) + "tail " + String.fromCharCode(0x2713) + " note." },
  ];
  t("parity: the shared contract vector (45, db55033eba1c6040)", V.computeMemoryPackHash(shared) === "db55033eba1c6040" && shared.reduce((a, i) => a + i.t.length, 0) === 45);

  if (!fayePresent) {
    note("SKIP parity against Python and the Faye fixtures: the Faye repo with its venv was not found (set FAYE_REPO).");
  } else {
    const copy = JSON.parse(readFileSync(join(FAYE, "tests", "fixtures", "faye-memory-vectors.json"), "utf8"));
    t("parity: the Faye copy of the vector list is identical to this repo's list", JSON.stringify(copy) === JSON.stringify(vectors));
    const packs = JSON.parse(readFileSync(join(FAYE, "tests", "fixtures", "faye-pack-vectors.json"), "utf8"));
    const badPack = packs.filter((p) => V.computeMemoryPackHash(p.items) !== p.hash || p.items.reduce((a, i) => a + i.t.length, 0) !== p.chars
      || (V.validateMemoryPack({ v: 1, items: p.items, chars: p.chars, hash: p.hash }) !== null) !== p.ts_accepts);
    t(`parity: ${packs.length} packs (emoji, CJK, combining accents, 900 characters) hash and measure the same here as in the Faye fixture`, packs.length >= 8 && badPack.length === 0, badPack.map((p) => p.name).join());

    const dump = py(["-m", "tests.test_redaction_parity", "--dump"]);
    let table = null;
    try { table = JSON.parse(dump.out); } catch { /* reported below */ }
    t("parity: the Python sanitizer's verdict table could be produced", table !== null && table.vectors.length === 86, dump.err.slice(-200));
    if (table) {
      const live = new Map(vectors.map((v) => [v.text, verdict(v.text)]));
      t("parity: the TypeScript verdicts here equal the ones the Python table was compared against", table.vectors.every((r) => live.get(r.text) === r.ts_expect));
      const exact = new Set(table.exact_parity_reasons);
      const exactBad = table.vectors.filter((r) => exact.has(r.ts_expect) && r.gap);
      t("parity: exact on instruction, control, card, ssn, length and empty notes (zero disagreements)", exactBad.length === 0, all(exactBad.map((r) => r.ts_expect)));
      const clean = table.vectors.filter((r) => r.ts_expect === null);
      t("parity: every clean note is kept by Python too (except the one pinned newline case)", clean.filter((r) => r.python !== "kept" && !r.known_gap).length === 0);
      const unpinned = table.vectors.filter((r) => r.gap && r.known_gap !== r.gap);
      const stale = table.vectors.filter((r) => !r.gap && r.known_gap);
      t("parity: every disagreement between the two sides is a pinned, known one", unpinned.length === 0 && stale.length === 0, all(unpinned.map((r) => r.text)));
      const keeps = table.vectors.filter((r) => r.gap === "python_keeps_what_typescript_refuses");
      note(`INFO parity: ${keeps.length} of ${vectors.filter((v) => v.expect).length} refused vectors are kept by the Python render-time sanitizer (secrets, credentials, contact, address, amounts, shares, health/legal words, markup). They cannot arrive through the normal path: rank.ts and the database screen first.`);
    }
  }

  // relay guard vs the Python runtime guard (information only: WP-B tightened the Python one, WP-A has not copied it yet)
  const original = ["I recommend NVDA", "my top pick is GLD", "you should buy it", "I would buy this", "the best choice is cash", "definitely sell", "go with NVDA"];
  t("relay guard: catches every phrase in the eval's original leak pattern", original.every((p) => G.applyRelayGuard(p).tripped));
  const tightening = ["I'd buy NVDA now", "I would sell it", "I suggest you buy it", "my recommendation is NVDA", "we recommend VOO", "you ought to buy gold", "buy it now"];
  const missed = tightening.filter((p) => !G.applyRelayGuard(p).tripped);
  note(`INFO relay guard: ${missed.length} of ${tightening.length} phrases that the Python runtime guard now catches are NOT caught by src/lib/faye/mailbox/output-guard.ts (${missed.join(" | ")})`);
}

// ================================================================================================ static lint of the migrations
{
  const files = ["db/migrations/2026-10-20_faye_mailbox.sql", "db/migrations/2026-10-20_faye_memory.sql"];
  const sql = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const params = new Map<string, string>();
  for (const m of sql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns/g)) params.set(m[1], m[2]);
  const callable = new Map<string, string[]>();
  for (const m of sql.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\)\s+to\s+([a-z_,\s]+);/gi)) {
    callable.set(m[1], m[3].split(",").map((x) => x.trim()));
  }
  const browserCallable = [...callable].filter(([, roles]) => roles.some((r) => r === "authenticated" || r === "anon")).map(([n]) => n);
  t(`lint: ${browserCallable.length} functions are callable by a browser or worker role`, browserCallable.length >= 25, String(browserCallable.length));
  const withUser = browserCallable.filter((n) => /\b(p_uid|p_user\w*|user_id|uid)\b/i.test(params.get(n) ?? ""));
  t("lint: none of them takes a user id (the person always comes from auth.uid() or the worker token's job)", withUser.length === 0, withUser.join());
  const definers = [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\$\$/g)].length;
  t("lint: every function that takes a user id (internal helpers) is not granted to a browser or worker role", ["faye_user_role", "faye_memory_purge", "faye_memory_log", "faye_memory_supersede"].every((n) => !browserCallable.includes(n)));

  const eraseBody = sql.slice(sql.indexOf("create or replace function public.faye_erase_me"), sql.indexOf("-- 4. WORKER-SIDE FUNCTIONS"));
  const eraseList = new Set([...(eraseBody.match(/'faye_[a-z_]+'/g) ?? []).map((s) => s.replace(/'/g, ""))]);
  const holders: string[] = [];
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
    if (/\buser_id\b|\brequested_by\b/.test(m[2])) holders.push(m[1]);
  }
  const cascades = new Set<string>();
  for (const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) if (/references public\.faye_jobs[^,\n]*on delete cascade/.test(m[2])) cascades.add(m[1]);
  const uncovered = holders.filter((h) => h !== "faye_access" && h !== "faye_jobs" && !cascades.has(h) && !eraseList.has(h));
  t(`lint: faye_erase_me covers every table that holds a person's rows (${holders.length} tables; faye_access is kept on purpose, job chunks go with their job)`, holders.includes("faye_jobs") && holders.includes("faye_memory_items") && uncovered.length === 0, uncovered.join());
  t("lint: faye_erase_me deletes jobs first (chunks cascade) and asks for the exact word DELETE", /delete from public\.faye_jobs where user_id = v_uid/.test(eraseBody) && /p_confirm is distinct from 'DELETE'/.test(eraseBody));
  t("lint: erase and delete-all are granted to signed-in users only, never to anon", callable.get("faye_erase_me")?.join() === "authenticated" && callable.get("faye_memory_delete_all")?.join() === "authenticated");
  const evBody = sql.slice(sql.indexOf("create table if not exists public.faye_memory_events"), sql.indexOf("create index if not exists faye_memory_events_user_idx"));
  const cols = [...evBody.matchAll(/^\s{2}(\w+)\s+(uuid|text|integer|timestamptz)/gm)].map((m) => m[1]);
  t("lint: the audit table has no text column (only ids, an action word, a count and a time)", cols.length >= 7 && cols.every((c) => ["id", "user_id", "item_id", "related_item_id", "action", "source", "count", "at"].includes(c)), cols.join());
}

// ================================================================================================ the final sweep
{
  const L = logsText();
  t("final: nothing the whole run logged contains a planted secret, the chat phrase, a note's words or the portfolio blob", found(L, [...NEEDLES, "PLANTEDCHAT", "PLNT", "zebra", "marmalade", "quokka", "walrus", "swing"]).length === 0);
}
capturing = false;
base.summary();
