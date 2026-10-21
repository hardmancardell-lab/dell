// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-lab.test.mts
// Faye Train and Test Lab (package WP-C2): the owner gate and the 404 for everyone else, the feature flag, the held-out wall at the
// library level (and the SQL, linted here and run for real on PGlite by the harness named in the report), "no raw chat in feedback",
// "a note proposal never writes to the corpus", the eval request caps and the confirmation flag, not_ready when the tables are missing,
// the browser client and the page's state machine against the real handlers, the screen rendered to static markup (two sets kept apart,
// hostile text shown as text, bars that start at zero), reading level, and source lint.
// No browser, no network, no Supabase: the database is a small model of the SQL functions (it enforces the same wall rules).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();

const H = await import("../src/lib/faye/lab/handlers.ts");
const CFG = await import("../src/lib/faye/lab/config.ts");
const ER = await import("../src/lib/faye/lab/errors.ts");
const SC = await import("../src/lib/faye/lab/screen.ts");
const WL = await import("../src/lib/faye/lab/wall.ts");
const ST = await import("../src/lib/faye/lab/stats.ts");
const MD = await import("../src/lib/faye/lab/mood.ts");
const CL = await import("../src/lib/faye/lab/client.ts");
const LS = await import("../src/app/faye-lab/labStore.ts");
const LV = await import("../src/app/faye-lab/LabView.tsx");
const LC = await import("../src/app/faye-lab/LabChart.tsx");
const CP = await import("../src/app/faye-lab/copy.ts");
const AC = await import("../src/app/faye-lab/access.ts");
const { SlidingWindowLimiter } = await import("../src/lib/access/rate-limit.ts");

console.error = () => {}; // the store logs RPC failures (code only); keep test output clean

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ------------------------------------------------------------------------------------------------ fixtures
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ENV_ON = { FAYE_LAB_ENABLED: "1", FAYE_OWNER_EMAILS: "owner@example.com" };
const ENV_OFF = { FAYE_OWNER_EMAILS: "owner@example.com" };
const A = { id: UUID(1), email: "Owner@Example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const B = { id: UUID(2), email: "owner@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" }; // same listed e-mail, different person (two-owner isolation)
const STRANGER = { id: UUID(3), email: "stranger@example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const UNCONFIRMED = { id: UUID(4), email: "owner@example.com", email_confirmed_at: null };

let nid = 1000;
const newId = () => UUID(++nid);
const clock = { t: Date.parse("2026-10-20T15:00:00Z") };
const iso = (ms = clock.t) => new Date(ms).toISOString();
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A model of the Lab SQL functions (same checks, same wall) plus the two mailbox functions the Lab calls. */
function fakeDb({ strict = true, installed = true } = {}) {
  const users = new Map();
  const U = (id: string) => {
    if (!users.has(id)) users.set(id, { role: "owner", online: true, feedback: [], corrections: [], items: [], notes: [], runs: [], jobs: [] });
    return users.get(id);
  };
  const log: { uid: string; fn: string; args: any }[] = [];
  const db: any = { users, U, log, strict, installed };

  function wallHit(u: any, text: string | null, correction: string | null, item: string | null) {
    if (item && u.items.some((i: any) => i.id === item && i.split === "heldout")) return true;
    if (correction && u.items.some((i: any) => i.split === "heldout" && i.source_correction_id === correction)) return true;
    const tx = (text ?? "").toLowerCase();
    if (tx.trim()) {
      for (const i of u.items) {
        if (i.split !== "heldout" || i.question.length < 12) continue;
        const q = i.question.toLowerCase();
        if (tx.includes(q) || (tx.trim().length >= 12 && q.includes(tx.trim()))) return true;
      }
    }
    return false;
  }

  function run(fn: string, a: any, uid: string) {
    const u = U(uid);
    if (fn === "faye_status") return { ok: true, allowed: u.role === "owner", role: u.role, online: u.online, worker_age_sec: 3, queue_depth: u.jobs.filter((j: any) => j.status === "queued").length, in_flight: 0, used_today: 0, daily_cap: 150 };
    if (fn === "faye_submit_job") {
      if (u.role !== "owner") return { ok: false, code: "not_allowed", detail: "owner_only" };
      const dup = u.jobs.find((j: any) => j.request_id === a.p_request_id);
      if (dup) return { ok: true, job_id: dup.id, status: dup.status, deduped: true, queue_ahead: 0, expires_at: iso(clock.t + 1_800_000) };
      if (!u.online) return { ok: false, code: "faye_offline" };
      if (u.jobs.some((j: any) => j.kind === "eval" && ["queued", "claimed", "running"].includes(j.status))) return { ok: false, code: "rate_limited", detail: "in_flight", retry_after_sec: 30 };
      const job = { id: newId(), request_id: a.p_request_id, kind: a.p_kind, request: a.p_request, status: "queued", created_at: iso() };
      u.jobs.push(job);
      return { ok: true, job_id: job.id, status: "queued", deduped: false, queue_ahead: 0, expires_at: iso(clock.t + 1_800_000) };
    }
    if (!fn.startsWith("faye_lab_")) return { ok: false, code: "not_found" };
    if (u.role !== "owner") return { ok: false, code: "not_allowed" };
    switch (fn) {
      case "faye_lab_overview":
        return { ok: true, ready: true, counts: { feedback: u.feedback.length, feedback_to_review: u.feedback.filter((f: any) => f.rating !== "good").length, corrections_new: u.corrections.filter((c: any) => c.status === "new").length, train: u.items.filter((i: any) => i.split === "train").length, heldout: u.items.filter((i: any) => i.split === "heldout").length, notes_pending: u.notes.filter((n: any) => n.status === "pending").length, runs: u.runs.length } };
      case "faye_lab_submit_feedback": {
        if (!["good", "wrong", "too_long", "off_voice"].includes(a.p_rating)) return { ok: false, code: "bad_request", detail: "bad_rating" };
        if (a.p_excerpt.length > 200 || (a.p_note && a.p_note.length > 300)) return { ok: false, code: "bad_request", detail: "rejected" };
        const old = u.feedback.find((f: any) => f.answer_hash === a.p_answer_hash);
        const row = old ?? { id: newId(), answer_hash: a.p_answer_hash };
        Object.assign(row, { job_id: a.p_job_id, rating: a.p_rating, note: a.p_note, answer_excerpt: a.p_excerpt, provenance: a.p_provenance, created_at: iso() });
        if (!old) u.feedback.unshift(row);
        return { ok: true, id: row.id, rating: row.rating };
      }
      case "faye_lab_list_feedback": {
        const s = { good: 0, wrong: 0, too_long: 0, off_voice: 0, total: u.feedback.length };
        for (const f of u.feedback) s[f.rating]++;
        return { ok: true, items: u.feedback.map((f: any) => ({ id: f.id, job_id: f.job_id, rating: f.rating, note: f.note, answer_excerpt: f.answer_excerpt, provenance: f.provenance, created_at: f.created_at })), summary: s };
      }
      case "faye_lab_save_correction": {
        if (!["answer", "fact", "voice", "guardrail"].includes(a.p_kind)) return { ok: false, code: "bad_request", detail: "bad_kind" };
        const c = { id: newId(), kind: a.p_kind, question_text: a.p_question, bad_excerpt: a.p_bad_excerpt, better_answer: a.p_better, status: "new", created_at: iso() };
        u.corrections.unshift(c);
        return { ok: true, id: c.id };
      }
      case "faye_lab_list_corrections":
        return { ok: true, items: u.corrections.map((c: any) => ({ id: c.id, kind: c.kind, question: c.question_text, bad_excerpt: c.bad_excerpt, better_answer: c.better_answer, status: c.status, created_at: c.created_at, exam_made: u.items.some((i: any) => i.source_correction_id === c.id && i.split === "heldout"), practice_made: u.items.some((i: any) => i.source_correction_id === c.id && i.split === "train"), note_made: u.notes.some((n: any) => n.from_correction_id === c.id && n.status !== "rejected") })) };
      case "faye_lab_decide_correction": {
        const c = u.corrections.find((x: any) => x.id === a.p_id);
        if (!c) return { ok: false, code: "not_found" };
        if (a.p_decision === "dismiss") { if (c.status !== "new") return { ok: false, code: "conflict", detail: "already_used" }; c.status = "rejected"; } else { if (c.status !== "rejected") return { ok: false, code: "conflict", detail: "not_dismissed" }; c.status = "new"; }
        return { ok: true, status: c.status };
      }
      case "faye_lab_promote_correction": {
        const c = u.corrections.find((x: any) => x.id === a.p_id);
        if (!c) return { ok: false, code: "not_found" };
        if (c.status === "rejected") return { ok: false, code: "conflict", detail: "dismissed" };
        if (!["train", "heldout"].includes(a.p_split)) return { ok: false, code: "bad_request", detail: "bad_split" };
        if (db.strict && a.p_split === "heldout" && u.notes.some((n: any) => n.status !== "rejected" && (n.from_correction_id === c.id || `${n.title} ${n.body}`.toLowerCase().includes(c.question_text.toLowerCase())))) return { ok: false, code: "held_out_wall" };
        const same = u.items.find((i: any) => norm(i.question) === norm(c.question_text));
        if (same) return { ok: false, code: "conflict", detail: same.split === "heldout" ? "already_heldout" : "already_train" };
        const item = { id: newId(), split: a.p_split, suite: a.p_suite, question: c.question_text, required_keywords: a.p_keywords, approved: true, used_in_corpus: false, source_correction_id: c.id, created_at: iso() };
        u.items.unshift(item);
        if (c.status === "new") c.status = "promoted_eval";
        return { ok: true, id: item.id, split: item.split };
      }
      case "faye_lab_list_eval_items":
        return { ok: true, items: u.items.map((i: any) => ({ ...i })) };
      case "faye_lab_update_eval_item": {
        const i = u.items.find((x: any) => x.id === a.p_id);
        if (!i) return { ok: false, code: "not_found" };
        if (a.p_action === "delete") u.items = u.items.filter((x: any) => x !== i); else i.approved = a.p_action === "resume";
        return { ok: true, action: a.p_action };
      }
      case "faye_lab_propose_note": {
        if (!a.p_correction_id && !a.p_eval_item_id) return { ok: false, code: "bad_request", detail: "no_source" };
        if (db.strict && wallHit(u, `${a.p_title} ${a.p_body}`, a.p_correction_id, a.p_eval_item_id)) return { ok: false, code: "held_out_wall" };
        if (u.notes.some((n: any) => n.status !== "rejected" && n.body.toLowerCase() === a.p_body.toLowerCase())) return { ok: false, code: "conflict", detail: "duplicate" };
        const n = { id: newId(), title: a.p_title, body: a.p_body, status: "pending", from_correction_id: a.p_correction_id, from_eval_item_id: a.p_eval_item_id, decided_at: null, created_at: iso() };
        u.notes.unshift(n);
        return { ok: true, id: n.id, status: "pending" };
      }
      case "faye_lab_list_notes":
        return { ok: true, items: u.notes.filter((n: any) => !a.p_status || n.status === a.p_status).map((n: any) => ({ ...n })) };
      case "faye_lab_decide_note": {
        const n = u.notes.find((x: any) => x.id === a.p_id);
        if (!n) return { ok: false, code: "not_found" };
        if (n.status !== "pending") return { ok: false, code: "conflict", detail: "already_decided" };
        if (db.strict && a.p_decision === "approve" && wallHit(u, `${n.title} ${n.body}`, n.from_correction_id, n.from_eval_item_id)) return { ok: false, code: "held_out_wall" };
        n.status = a.p_decision === "approve" ? "approved" : "rejected";
        n.decided_at = iso();
        return { ok: true, status: n.status };
      }
      case "faye_lab_list_runs":
        return { ok: true, runs: u.runs.filter((r: any) => !a.p_suite || r.suite === a.p_suite), pending: u.jobs.filter((j: any) => j.kind === "eval" && ["queued", "claimed", "running"].includes(j.status)).map((j: any) => ({ job_id: j.id, status: j.status, suite: j.request?.suite ?? null, created_at: j.created_at })) };
    }
    return { ok: false, code: "not_found" };
  }

  db.client = (user: any, opts: { role?: string; online?: boolean } = {}) => {
    const u = U(user.id);
    if (opts.role !== undefined) u.role = opts.role;
    if (opts.online !== undefined) u.online = opts.online;
    return {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      rpc(fn: string, a: any = {}) {
        log.push({ uid: user.id, fn, args: a });
        if (!db.installed && fn.startsWith("faye_lab_")) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
        return Promise.resolve({ data: run(fn, a, user.id), error: null });
      },
    };
  };
  db.calls = (name: string | RegExp) => log.filter((l) => (typeof name === "string" ? l.fn === name : name.test(l.fn)));
  return db;
}

const noSession = { auth: { getUser: async () => ({ data: { user: null }, error: null }) }, rpc: () => Promise.resolve({ data: null, error: null }) };

function mkDeps(db: any, user: any, over: any = {}) {
  const client = over.client ?? db.client(user, { role: "owner", online: true, ...over.clientOpts });
  return {
    env: over.env ?? ENV_ON,
    getClient: async () => client,
    now: () => clock.t,
    newId,
    limiters: over.limiters ?? freshLimiters(),
  };
}
function freshLimiters() {
  return {
    read: new SlidingWindowLimiter(CFG.LAB_RATE.readPerMinute, 60_000),
    write: new SlidingWindowLimiter(CFG.LAB_RATE.writePerMinute, 60_000),
    evalRun: new SlidingWindowLimiter(CFG.LAB_RATE.evalPerTenMin, 10 * 60_000),
    longRun: new SlidingWindowLimiter(CFG.LAB_RATE.longPerDay, 24 * 60 * 60_000),
  };
}

const BASE = "https://app.test";
function req(method: string, path: string, body?: any, headers: Record<string, string> = {}) {
  const init: any = { method, headers: { ...(method === "POST" ? { "content-type": "application/json", origin: BASE } : {}), ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${BASE}${path}`, init);
}
async function J(res: Response) {
  return { status: res.status, body: await res.json(), headers: res.headers };
}

// ------------------------------------------------------------------------------------------------ flag, gate, headers
{
  const db = fakeDb();
  const d = mkDeps(db, A, { env: ENV_OFF });
  const all = [
    H.handleOverview(req("GET", "/api/faye/lab"), d),
    H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), d),
    H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "hello there" }), d),
    H.handleCorrectionsList(req("GET", "/api/faye/lab/corrections"), d),
    H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", {}), d),
    H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${UUID(9)}`, { action: "dismiss" }), UUID(9), d),
    H.handleExamsList(req("GET", "/api/faye/lab/exams"), d),
    H.handleExamAction(req("POST", `/api/faye/lab/exams/${UUID(9)}`, { action: "delete" }), UUID(9), d),
    H.handleNotesList(req("GET", "/api/faye/lab/notes"), d),
    H.handleNoteCreate(req("POST", "/api/faye/lab/notes", {}), d),
    H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${UUID(9)}`, { decision: "approve" }), UUID(9), d),
    H.handleRunsList(req("GET", "/api/faye/lab/eval"), d),
    H.handleEvalRequest(req("POST", "/api/faye/lab/eval", { suite: "guardrail" }), d),
  ];
  const out = await Promise.all(all.map((p) => p.then(J)));
  t("flag off (FAYE_LAB_ENABLED unset): all 13 handlers answer 503 disabled, even for the owner", out.every((o) => o.status === 503 && o.body.code === "disabled"), JSON.stringify(out.map((o) => o.status)));
  t("flag off: not a single database call was made", db.log.length === 0);
  t("flag values: only 1 or true (any case) turn the Lab on", CFG.labEnabled({ FAYE_LAB_ENABLED: "TRUE" }) && CFG.labEnabled({ FAYE_LAB_ENABLED: "1" }) && !CFG.labEnabled({ FAYE_LAB_ENABLED: "yes" }) && !CFG.labEnabled({ FAYE_LAB_ENABLED: "0" }) && !CFG.labEnabled({}));
  t("flag off message is the Lab's own sentence", /Lab is switched off/.test(out[0].body.error));
}
{
  const db = fakeDb();
  // signed out
  let r = await J(await H.handleOverview(req("GET", "/api/faye/lab"), mkDeps(db, A, { client: noSession })));
  t("no session: 401 auth_required, no database call", r.status === 401 && r.body.code === "auth_required" && db.log.length === 0);
  // signed in, not on the owner list
  r = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), mkDeps(db, STRANGER)));
  t("signed-in stranger (not in FAYE_OWNER_EMAILS): 403 not_allowed, no database call", r.status === 403 && r.body.code === "not_allowed" && db.log.length === 0);
  r = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), mkDeps(db, UNCONFIRMED)));
  t("owner e-mail but unconfirmed: 403", r.status === 403 && db.log.length === 0);
  r = await J(await H.handleExamsList(req("GET", "/api/faye/lab/exams"), mkDeps(db, A, { env: { FAYE_LAB_ENABLED: "1" } })));
  t("FAYE_OWNER_EMAILS unset: nobody is the owner (fail closed)", r.status === 403 && db.log.length === 0);
  // the database says no even if the app gate was wrong
  r = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), mkDeps(db, A, { clientOpts: { role: "approved" } })));
  t("database refuses a non-owner role even after the app gate passed (maps to 403)", r.status === 403 && r.body.code === "not_allowed");
  r = await J(await H.handleOverview(req("GET", "/api/faye/lab"), mkDeps(db, A)));
  t("owner: overview is 200 and ready", r.status === 200 && r.body.ok && r.body.ready === true && r.body.enabled === true);
  t("responses carry no-store, nosniff and JSON", r.headers.get("cache-control") === "no-store" && r.headers.get("x-content-type-options") === "nosniff" && /application\/json/.test(r.headers.get("content-type")));
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "x" }, { origin: "https://evil.example" }), mkDeps(db, A)));
  t("POST from another origin: 403 not_allowed", r.status === 403 && r.body.code === "not_allowed");
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", "rating=good", { "content-type": "text/plain" }), mkDeps(db, A)));
  t("POST that is not JSON: 400", r.status === 400);
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", "{not json"), mkDeps(db, A)));
  t("POST with broken JSON: 400 bad_request", r.status === 400 && r.body.code === "bad_request");
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", JSON.stringify(["x"])), mkDeps(db, A)));
  t("POST with a JSON array body: 400", r.status === 400);
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", "x".repeat(60 * 1024)), mkDeps(db, A)));
  t("POST over 48 KB: 413 too_large", r.status === 413 && r.body.code === "too_large");
}
{
  // the page answers 404 to anyone but the owner
  const mk = (user: any, env: any = ENV_ON) => AC.labPageAccess(async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) }, rpc: async () => ({ data: null, error: null }) }), env);
  t("page: owner sees the Lab", (await mk(A)) === "owner");
  t("page: signed-out visitor is hidden (404)", (await mk(null)) === "hidden");
  t("page: signed-in stranger is hidden (404)", (await mk(STRANGER)) === "hidden");
  t("page: unconfirmed owner e-mail is hidden", (await mk(UNCONFIRMED)) === "hidden");
  t("page: no FAYE_OWNER_EMAILS means hidden", (await mk(A, {})) === "hidden");
  t("page: an auth server failure is hidden, not an error page", (await AC.labPageAccess(async () => { throw new Error("down"); }, ENV_ON)) === "hidden");
  t("page: an auth error object is hidden", (await AC.labPageAccess(async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: "x" } }) }, rpc: async () => ({}) }), ENV_ON)) === "hidden");
  const page = read("../src/app/faye-lab/page.tsx");
  t("page source: calls notFound() unless the access check says owner", /access !== "owner"\)\s*notFound\(\)/.test(page) && /from "next\/navigation"/.test(page));
  t("page source: noindex", /index: false/.test(page));
  t("page source: renders nothing before the access check", page.indexOf("labPageAccess(") < page.indexOf("<Lab"));
}

// ------------------------------------------------------------------------------------------------ rate limits
{
  const db = fakeDb();
  const d = mkDeps(db, A);
  let last: any;
  for (let i = 0; i < CFG.LAB_RATE.writePerMinute + 1; i++) last = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: `answer number ${i}` }), d));
  t(`write limiter: request ${CFG.LAB_RATE.writePerMinute + 1} in a minute is 429 with Retry-After`, last.status === 429 && last.body.code === "rate_limited" && Number(last.headers.get("retry-after")) > 0);
  const d2 = mkDeps(db, B, { limiters: d.limiters });
  const other = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "another person" }), d2));
  t("limits are per person: another owner is not throttled", other.status === 201);
}

// ------------------------------------------------------------------------------------------------ feedback: no raw chat
{
  const db = fakeDb();
  const d = mkDeps(db, A);
  const long = ("Gamma exposure shows where dealers must hedge. " + "More words follow about strikes and expiries. ").repeat(60); // about 2,800 characters
  const hash = createHash("sha256").update(long.trim(), "utf8").digest("hex");
  let r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "wrong", answer_text: long, note: "Missed the point.", job_id: UUID(77), provenance: { model: "gemma3:1b", constraint_sha256_16: "abcd1234abcd1234", text: long, evil: "<script>", memory_count: 2, memory_hash: "NOTHEX!!" } }), d));
  t("feedback saved (201)", r.status === 201 && r.body.ok && r.body.rating === "wrong", JSON.stringify(r.body));
  const call = db.calls("faye_lab_submit_feedback")[0].args;
  t("the database gets the sha-256 of the answer", call.p_answer_hash === hash);
  t("the excerpt is at most 200 characters and starts the answer", call.p_excerpt.length <= 200 && long.replace(/\s+/g, " ").startsWith(call.p_excerpt.trimEnd().slice(0, 40)));
  const allArgs = JSON.stringify(db.log.map((l) => l.args));
  t("the full answer text is in NO database argument", !allArgs.includes(long.trim().slice(0, 300)) && Math.max(...db.log.flatMap((l) => Object.values(l.args).map((v) => (typeof v === "string" ? v.length : 0)))) <= 300);
  t("the response never echoes the answer", !JSON.stringify(r.body).includes("Gamma exposure"));
  t("provenance keeps only whitelisted, well-shaped keys (no text, no markup, no bad hex)", JSON.stringify(call.p_provenance) === JSON.stringify({ model: "gemma3:1b", constraint_sha256_16: "abcd1234abcd1234", memory_count: 2 }), JSON.stringify(call.p_provenance));
  t("job id is passed when it is a UUID", call.p_job_id === UUID(77));
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "off_voice", answer_text: long, note: "Too chatty." }), d));
  const list = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), d));
  t("the same answer rated twice is one row (the newer rating replaces the older)", list.body.items.length === 1 && list.body.items[0].rating === "off_voice" && list.body.summary.total === 1);
  t("the list holds an excerpt, never the whole answer", list.body.items[0].answerExcerpt.length <= 200 && !JSON.stringify(list.body).includes(long.slice(0, 400)));
  const keys = Object.keys(list.body.items[0]).sort().join();
  t("a feedback row has exactly these fields (no raw text field)", keys === "answerExcerpt,createdAt,id,jobId,note,rating", keys);
  // private data in the answer: the rating is still saved, the excerpt is replaced
  const secret = "Your key is sk-live-abcdefghijklmnop1234 so keep it safe and do not share it with anyone at all.";
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "wrong", answer_text: secret }), d));
  t("a secret inside the answer: rating saved, excerpt replaced by the hidden marker", r.status === 201 && db.calls("faye_lab_submit_feedback").at(-1).args.p_excerpt === SC.HIDDEN_EXCERPT && !JSON.stringify(db.log.at(-1).args).includes("sk-live"));
  r = await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "wrong", answer_text: "Fine answer here.", note: "my password is hunter22 ok" }), d));
  t("a secret inside the NOTE is refused (422 text_rejected) and nothing is stored", r.status === 422 && r.body.code === "text_rejected" && !JSON.stringify(r.body).includes("hunter22"));
  t("bad rating 400", (await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "great", answer_text: "x" }), d))).status === 400);
  t("missing answer 400", (await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good" }), d))).status === 400);
  t("answer over 8,000 characters 413", (await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "a".repeat(8001) }), d))).status === 413);
  t("note over 300 characters 413", (await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "x", note: "n".repeat(301) }), d))).status === 413);
  t("bad job id 400", (await J(await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "x", job_id: "nope" }), d))).status === 400);
  // two owners
  const dB = mkDeps(db, B);
  await H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: long }), dB);
  const la = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), d));
  const lb = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), dB));
  t("two owners: each sees only their own ratings, and the same answer text does not collide", la.body.summary.total === 2 && lb.body.summary.total === 1 && lb.body.items[0].rating === "good");
}

// ------------------------------------------------------------------------------------------------ corrections and the two sets
const Q1 = "What does a negative GEX regime usually mean for intraday moves?";
const Q2 = "How do dealers hedge a short call position they sold to a customer?";
const BETTER1 = "Dealers are short gamma, so their hedging can add to moves in either direction.";
const BETTER2 = "They buy the underlying so that their delta stays close to zero.";
let ctx: any;
{
  const db = fakeDb();
  const d = mkDeps(db, A);
  const save = async (q: string, b: string, kind = "answer") => (await J(await H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", { kind, question: q, better_answer: b, bad_excerpt: "Wrong thing Faye said." }), d)));
  let r = await save(Q1, BETTER1);
  t("correction saved (201)", r.status === 201 && r.body.ok);
  const c1 = r.body.id;
  r = await save(Q2, BETTER2, "fact");
  const c2 = r.body.id;
  t("question under 8 characters 400", (await save("Why?", BETTER1)).status === 400);
  t("better answer under 5 characters 400", (await save(Q1, "no")).status === 400);
  t("secret in the better answer 422 and not stored", (await save("What is my account for trading?", "Your password is hunter22 for the broker.")).status === 422);
  t("a card number in the question is refused", (await save("Is 4111 1111 1111 1111 a real card number?", BETTER1)).status === 422);
  t("a credential WORD in a teaching question is fine", (await save("What is a password manager and why use one?", "A tool that stores passwords for you in an encrypted vault.")).status === 201);
  t("a guardrail question about buying is fine (Lab text may talk about advice)", (await save("Should I buy NVDA calls before earnings tomorrow?", "I can not tell you what to buy or sell. Here is how calls behave.", "guardrail")).status === 201);
  t("bad kind 400", (await J(await H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", { kind: "rant", question: Q1, better_answer: BETTER1 }), d))).status === 400);
  const lst = await J(await H.handleCorrectionsList(req("GET", "/api/faye/lab/corrections"), d));
  t("list shows the corrections with no exam/practice yet", lst.body.items.length === 4 && lst.body.items.every((c) => !c.examMade && !c.practiceMade && c.status === "new"));

  const act = async (id: string, body: any) => J(await H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${id}`, body), id, d));
  r = await act(c1, { action: "promote", target: "training", suite: "domain", keywords: ["dealer|short gamma", "hedg"] });
  t("promote to TRAINING (201)", r.status === 201 && r.body.set === "training", JSON.stringify(r.body));
  t("the database got split 'train' and the keywords", db.calls("faye_lab_promote_correction")[0].args.p_split === "train" && db.calls("faye_lab_promote_correction")[0].args.p_keywords.join("/") === "dealer|short gamma/hedg");
  r = await act(c1, { action: "promote", target: "held_out", suite: "domain" });
  t("THE SAME correction cannot ALSO be an exam question: 409 conflict, says already training", r.status === 409 && r.body.code === "conflict" && r.body.detail === "already_train" && /already a training question/.test(r.body.error), JSON.stringify(r.body));
  r = await act(c2, { action: "promote", target: "held_out", suite: "domain", keywords: ["buy", "delta"] });
  t("promote to HELD_OUT (201)", r.status === 201 && r.body.set === "held_out");
  t("the database got split 'heldout'", db.calls("faye_lab_promote_correction").at(-1).args.p_split === "heldout");
  r = await act(c2, { action: "promote", target: "training", suite: "domain" });
  t("an exam question cannot ALSO be re-added as a training question: 409 already_heldout", r.status === 409 && r.body.detail === "already_heldout");
  t("bad target 400", (await act(c1, { action: "promote", target: "both", suite: "domain" })).status === 400);
  t("bad suite 400", (await act(c1, { action: "promote", target: "training", suite: "memory" })).status === 400);
  t("9 keywords 400", (await act(c1, { action: "promote", target: "training", suite: "domain", keywords: Array(9).fill("a") })).status === 400);
  t("a keyword over 80 characters 400", (await act(c1, { action: "promote", target: "training", suite: "domain", keywords: ["k".repeat(81)] })).status === 400);
  t("a secret as a keyword is refused", (await act(c1, { action: "promote", target: "training", suite: "domain", keywords: ["sk-abcdefghij1234567"] })).status === 422);
  t("bad id 400", (await J(await H.handleCorrectionAction(req("POST", "/api/faye/lab/corrections/nope", { action: "dismiss" }), "nope", d))).status === 400);
  t("bad action 400", (await act(c1, { action: "delete" })).status === 400);
  t("unknown correction 404", (await act(UUID(555), { action: "dismiss" })).status === 404);
  // the sets, apart
  const ex = await J(await H.handleExamsList(req("GET", "/api/faye/lab/exams"), d));
  t("exams list keeps the sets in separate arrays", ex.body.training.length === 1 && ex.body.held_out.length === 1 && ex.body.training[0].set === "training" && ex.body.held_out[0].set === "held_out" && ex.body.counts.held_out === 1);
  t("no item is in both arrays", ex.body.training.every((i) => !ex.body.held_out.some((j) => j.id === i.id || WL.normalizeQuestion(j.question) === WL.normalizeQuestion(i.question))));
  r = await J(await H.handleExamAction(req("POST", `/api/faye/lab/exams/${ex.body.training[0].id}`, { action: "pause" }), ex.body.training[0].id, d));
  t("pause an item", r.status === 200 && r.body.action === "pause");
  t("bad exam action 400", (await J(await H.handleExamAction(req("POST", `/api/faye/lab/exams/${ex.body.training[0].id}`, { action: "promote" }), ex.body.training[0].id, d))).status === 400);
  // dismiss / reopen
  const c3 = (await save("Explain what vanna measures in plain words", "Vanna is how delta changes when implied volatility changes.")).body.id;
  r = await act(c3, { action: "dismiss" });
  t("dismiss", r.status === 200 && r.body.status === "rejected");
  t("a dismissed correction cannot be promoted", (await act(c3, { action: "promote", target: "training", suite: "domain" })).body.detail === "dismissed");
  t("reopen", (await act(c3, { action: "reopen" })).body.status === "new");
  // two owners
  const dB = mkDeps(db, B);
  t("another owner cannot see these corrections", (await J(await H.handleCorrectionsList(req("GET", "/api/faye/lab/corrections"), dB))).body.items.length === 0);
  t("another owner cannot promote them (404)", (await J(await H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${c1}`, { action: "promote", target: "training", suite: "domain" }), c1, dB))).status === 404);
  t("another owner sees no exam questions", (await J(await H.handleExamsList(req("GET", "/api/faye/lab/exams"), dB))).body.counts.held_out === 0);
  ctx = { db, d, c1, c2, c3, exam: ex.body.held_out[0], train: ex.body.training[0] };
}

// ------------------------------------------------------------------------------------------------ the held-out wall, library level
{
  const { db, d, c1, c2, exam, train } = ctx;
  const post = async (body: any) => J(await H.handleNoteCreate(req("POST", "/api/faye/lab/notes", body), d));
  const goodBody = "A negative GEX regime means dealers are short gamma. Their hedging can add to moves in either direction.";
  const before = db.calls("faye_lab_propose_note").length;
  let r = await post({ exam_id: exam.id, title: "Hedging a short call", body: "Dealers buy the underlying to hedge a short call position and keep delta near zero." });
  t("WALL: a note from a held-out exam question is refused (409 held_out_wall)", r.status === 409 && r.body.code === "held_out_wall" && /never be taught/.test(r.body.error), JSON.stringify(r.body));
  r = await post({ correction_id: c2, title: "Hedging a short call", body: "Dealers buy the underlying to hedge a short call position and keep delta near zero." });
  t("WALL: a note from the correction an exam question was made from is refused", r.status === 409 && r.body.code === "held_out_wall");
  r = await post({ correction_id: c1, title: "Pasted exam text", body: `Remember this one: ${Q2.toLowerCase()} They buy shares.` });
  t("WALL: a note that holds the text of an exam question is refused, even from a clean source", r.status === 409 && r.body.code === "held_out_wall");
  r = await post({ correction_id: c1, title: Q2, body: "Study this question carefully before the next test please." });
  t("WALL: the exam question inside the TITLE is refused too", r.status === 409 && r.body.code === "held_out_wall");
  t("WALL: the library refused all four BEFORE the database (no propose call was made)", db.calls("faye_lab_propose_note").length === before);
  // the library check alone stops it: a database that does not enforce the wall still never receives the call
  const weak = fakeDb({ strict: false });
  const dW = mkDeps(weak, A);
  const cs = (await J(await H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", { kind: "fact", question: Q2, better_answer: BETTER2 }), dW))).body.id;
  const promoted = (await J(await H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${cs}`, { action: "promote", target: "held_out", suite: "domain" }), cs, dW))).body;
  r = await J(await H.handleNoteCreate(req("POST", "/api/faye/lab/notes", { exam_id: promoted.id, title: "Exam leak", body: "This tries to teach the answer to the exam directly." }), dW));
  t("WALL: with a database that does NOT enforce the wall, the library check alone still refuses", r.status === 409 && weak.calls("faye_lab_propose_note").length === 0);
  // and the database refusal maps to the same answer
  const store = new (await import("../src/lib/faye/lab/store.ts")).LabStore(db.client(A));
  const direct = await store.proposeNote({ correctionId: null, examId: exam.id, title: "Direct", body: "Direct attempt to teach the exam answer text." });
  t("WALL: the database's own refusal (store level) comes back as held_out_wall", direct.ok === false && direct.code === "held_out_wall");
  // allowed paths
  r = await post({ correction_id: c1, exam_id: train.id, title: "Negative GEX regimes", body: goodBody });
  t("a note from a correction + a TRAINING question is accepted as PENDING", r.status === 201 && r.body.status === "pending" && r.body.corpus_written === false, JSON.stringify(r.body));
  const noteId = r.body.id;
  t("nothing is auto-approved: the new note is pending in the list", (await J(await H.handleNotesList(req("GET", "/api/faye/lab/notes?status=pending"), d))).body.items.some((n) => n.id === noteId && n.status === "pending"));
  r = await post({ correction_id: c1, title: "Same words again", body: goodBody });
  t("the same body twice is a conflict", r.status === 409 && r.body.detail === "duplicate");
  t("no source 400", (await post({ title: "Some title", body: "A body that is long enough to pass the check." })).status === 400);
  t("title under 3 characters 400", (await post({ correction_id: c1, title: "ab", body: "A body that is long enough to pass the check." })).status === 400);
  t("body under 20 characters 400", (await post({ correction_id: c1, title: "A title", body: "short body" })).status === 400);
  t("secret in a note body 422", (await post({ correction_id: c1, title: "A title", body: "The api key is sk-live-abcdefghijklmnop1234 for later use." })).status === 422);
  t("bad ids 400", (await post({ correction_id: "nope", title: "A title", body: goodBody + " More." })).status === 400);
  // approve: only marks
  const corpusBefore = JSON.stringify(db.U(A.id).items.map((i) => i.used_in_corpus));
  r = await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${noteId}`, { decision: "approve" }), noteId, d));
  t("approving a note marks it approved and says corpus_written: false", r.status === 200 && r.body.status === "approved" && r.body.corpus_written === false);
  t("approving calls ONE decide function and nothing else writes (no corpus call exists)", db.calls("faye_lab_decide_note").length === 1 && !db.log.some((l) => /corpus|ingest|write/i.test(l.fn.replace("faye_lab_decide_note", "")) && l.fn !== "faye_lab_list_notes"));
  t("an exam question is untouched by approval", JSON.stringify(db.U(A.id).items.map((i) => i.used_in_corpus)) === corpusBefore);
  r = await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${noteId}`, { decision: "approve" }), noteId, d));
  t("deciding twice is a conflict", r.status === 409 && r.body.detail === "already_decided");
  t("bad decision 400", (await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${noteId}`, { decision: "publish" }), noteId, d))).status === 400);
  t("unknown note 404", (await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${UUID(999)}`, { decision: "approve" }), UUID(999), d))).status === 404);
  // approval-time wall: an exam question appears AFTER a note was proposed
  const n2 = (await post({ correction_id: ctx.c3, title: "Vanna basics", body: `Vanna links delta and volatility. ${"Vanna is how delta changes when implied volatility changes".toLowerCase()}.` })).body.id;
  db.U(A.id).items.unshift({ id: newId(), split: "heldout", suite: "domain", question: "vanna links delta and volatility.", required_keywords: [], approved: true, used_in_corpus: false, source_correction_id: null, created_at: iso() });
  const decides = db.calls("faye_lab_decide_note").length;
  r = await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${n2}`, { decision: "approve" }), n2, d));
  t("WALL: approving a note that now holds an exam question's words is refused before the database", r.status === 409 && r.body.code === "held_out_wall" && db.calls("faye_lab_decide_note").length === decides);
  r = await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${n2}`, { decision: "reject" }), n2, d));
  t("...but rejecting it is always allowed", r.status === 200 && r.body.status === "rejected");
  // other direction
  const c5 = (await J(await H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", { kind: "fact", question: "Negative GEX regimes", better_answer: BETTER1 }), d))).body.id;
  r = await J(await H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${c5}`, { action: "promote", target: "held_out", suite: "domain" }), c5, d));
  t("WALL (other direction): a question already inside an existing note cannot become an exam question", r.status === 409 && r.body.code === "held_out_wall", JSON.stringify(r.body));
  r = await J(await H.handleCorrectionAction(req("POST", `/api/faye/lab/corrections/${c5}`, { action: "promote", target: "training", suite: "domain" }), c5, d));
  t("...it can still be a training question", r.status === 201);
  // two owners
  const dB = mkDeps(db, B);
  t("another owner sees none of these notes", (await J(await H.handleNotesList(req("GET", "/api/faye/lab/notes"), dB))).body.items.length === 0);
  t("another owner cannot approve my note", (await J(await H.handleNoteDecision(req("POST", `/api/faye/lab/notes/${noteId}`, { decision: "reject" }), noteId, dB))).status === 404);
  t("bad status filter 400", (await J(await H.handleNotesList(req("GET", "/api/faye/lab/notes?status=ingested"), d))).status === 400);
}

// pure wall functions
{
  const items = [
    { id: "h1", set: "held_out", question: "How do dealers hedge a short call position?", sourceCorrectionId: "c9" },
    { id: "t1", set: "training", question: "What is gamma exposure anywhere?", sourceCorrectionId: "c8" },
    { id: "h2", set: "held_out", question: "Short?", sourceCorrectionId: null },
  ];
  t("wall: exam id", WL.heldOutHit(items, { examId: "h1" }) && !WL.heldOutHit(items, { examId: "t1" }));
  t("wall: correction id", WL.heldOutHit(items, { correctionId: "c9" }) && !WL.heldOutHit(items, { correctionId: "c8" }));
  t("wall: text contains an exam question (any case)", WL.heldOutHit(items, { text: "Notes: HOW DO DEALERS HEDGE A SHORT CALL POSITION? They buy." }));
  t("wall: text that is a piece of an exam question (12+ characters)", WL.heldOutHit(items, { text: "dealers hedge a short call" }));
  t("wall: a short question (under 12) never matches by text", !WL.heldOutHit(items, { text: "Short? yes" }));
  t("wall: unrelated text passes", !WL.heldOutHit(items, { text: "Gamma exposure shows where hedging is concentrated." }));
  t("wall: training questions never trigger by text", !WL.heldOutHit(items, { text: "What is gamma exposure anywhere? It is a measure." }));
  t("wall: normalizeQuestion ignores case and punctuation", WL.normalizeQuestion("What is GEX?!") === WL.normalizeQuestion("what   is gex"));
  t("wall: noteTouchesQuestion by source and by text, skipping rejected", WL.noteTouchesQuestion([{ status: "pending", fromCorrectionId: "c1", title: "t", body: "b" }], { question: "A new question here ok?", correctionId: "c1" }) && WL.noteTouchesQuestion([{ status: "approved", fromCorrectionId: null, title: "t", body: "Explains a new question here ok? fully" }], { question: "A new question here ok?" }) && !WL.noteTouchesQuestion([{ status: "rejected", fromCorrectionId: "c1", title: "t", body: "b" }], { question: "A new question here ok?", correctionId: "c1" }));
}

// ------------------------------------------------------------------------------------------------ eval requests
{
  const db = fakeDb();
  const d = mkDeps(db, A);
  const post = async (body: any, dd = d) => J(await H.handleEvalRequest(req("POST", "/api/faye/lab/eval", body), dd));
  let r = await post({ suite: "guardrail" });
  t("guardrail starts with one plain request (201)", r.status === 201 && r.body.ok && r.body.status === "queued" && r.body.suite === "guardrail", JSON.stringify(r.body));
  const sub = db.calls("faye_submit_job")[0].args;
  t("the job is kind 'eval' with request {v:1, suite}", sub.p_kind === "eval" && JSON.stringify(sub.p_request) === JSON.stringify({ v: 1, suite: "guardrail" }) && /^[A-Za-z0-9_-]{8,64}$/.test(sub.p_request_id));
  r = await post({ suite: "orchestration" });
  t("a second test while one is waiting: 429 and the Lab's own sentence", r.status === 429 && r.body.detail === "in_flight" && /already waiting or running/.test(r.body.error), JSON.stringify(r.body));
  db.U(A.id).jobs.forEach((j) => (j.status = "done"));
  r = await post({ suite: "orchestration" });
  t("after it finishes, orchestration starts", r.status === 201);
  db.U(A.id).jobs.forEach((j) => (j.status = "done"));
  for (const s of ["heldout", "domain", "persona", "full"]) {
    const before = db.calls("faye_submit_job").length;
    d.limiters.evalRun.reset(`evalRun:${A.id}`);
    r = await post({ suite: s });
    t(`${s}: refused without the confirmation flag (409 confirm_required), nothing submitted`, r.status === 409 && r.body.code === "confirm_required" && db.calls("faye_submit_job").length === before);
    d.limiters.evalRun.reset(`evalRun:${A.id}`);
    r = await post({ suite: s, confirm_long: "yes" });
    t(`${s}: a string is not a confirmation`, r.status === 409 && r.body.code === "confirm_required");
    d.limiters.evalRun.reset(`evalRun:${A.id}`);
    r = await post({ suite: s, confirm_long: true });
    t(`${s}: starts with confirm_long: true`, r.status === 201, JSON.stringify(r.body));
    db.U(A.id).jobs.forEach((j) => (j.status = "done"));
    // the evalRun limiter allows only 4 per 10 minutes; reset between suites for this loop
    d.limiters.evalRun.reset(`evalRun:${A.id}`);
  }
  t("the confirmation text says 30 to 40 minutes and shared model", /30 to 40 minutes/.test(ER.labSentence("confirm_required", "long")) && /same model as chat/.test(ER.labSentence("confirm_required", "long")));
  t("bad suite 400", (await post({ suite: "everything" })).status === 400 && (await post({})).status === 400);
  t("default suites are exactly guardrail and orchestration", CFG.DEFAULT_SUITES.join() === "guardrail,orchestration" && CFG.isDefaultSuite("guardrail") && !CFG.isDefaultSuite("full"));
  // request cap
  const db2 = fakeDb();
  const d2 = mkDeps(db2, A);
  let last: any;
  for (let i = 0; i < CFG.LAB_RATE.evalPerTenMin + 1; i++) {
    db2.U(A.id).jobs.forEach((j) => (j.status = "done"));
    last = await post({ suite: "orchestration" }, d2);
  }
  t(`eval requests are capped at ${CFG.LAB_RATE.evalPerTenMin} per 10 minutes (the next is 429 with Retry-After)`, last.status === 429 && last.body.code === "rate_limited" && Number(last.headers.get("retry-after")) > 0);
  // long-run daily cap
  const db3 = fakeDb();
  const d3 = mkDeps(db3, A);
  let lastLong: any;
  for (let i = 0; i < CFG.LAB_RATE.longPerDay + 1; i++) {
    db3.U(A.id).jobs.forEach((j) => (j.status = "done"));
    d3.limiters.evalRun.reset(`evalRun:${A.id}`);
    lastLong = await post({ suite: "full", confirm_long: true }, d3);
  }
  t(`long tests are capped at ${CFG.LAB_RATE.longPerDay} a day`, lastLong.status === 429 && lastLong.body.detail === "long_runs" && /enough long tests/.test(lastLong.body.error));
  // idempotency
  const db4 = fakeDb();
  const d4 = mkDeps(db4, A);
  const one = await post({ suite: "guardrail", request_id: "lab-req-0001" }, d4);
  const two = await post({ suite: "guardrail", request_id: "lab-req-0001" }, d4);
  t("same request_id twice: the second is the same job, deduped, 200", one.status === 201 && two.status === 200 && two.body.deduped === true && two.body.job_id === one.body.job_id);
  t("bad request_id 400", (await post({ suite: "guardrail", request_id: "a b" }, d4)).status === 400);
  t("run_label is passed and screened (a secret label is refused)", (await post({ suite: "guardrail", request_id: "lab-req-0002", label: "after persona change" }, mkDeps(fakeDb(), A))).status === 201 && (await post({ suite: "guardrail", label: "sk-abcdefghij1234567" }, mkDeps(fakeDb(), A))).status === 400);
  // offline and not owner
  const off = await post({ suite: "guardrail" }, mkDeps(fakeDb(), A, { clientOpts: { online: false } }));
  t("worker offline: 503 faye_offline with the Lab's own sentence, nothing queued", off.status === 503 && off.body.code === "faye_offline" && /resting/.test(off.body.error));
  const nonOwner = await post({ suite: "guardrail" }, mkDeps(fakeDb(), A, { clientOpts: { role: "approved" } }));
  t("not the owner in the database: 403 (eval is owner only)", nonOwner.status === 403);
  t("signed out: 401", (await post({ suite: "guardrail" }, mkDeps(fakeDb(), A, { client: noSession }))).status === 401);
  // runs list
  const db5 = fakeDb();
  db5.U(A.id).runs.push({ id: UUID(70), suite: "guardrail", passed: 8, total: 8, created_at: iso() });
  const d5 = mkDeps(db5, A);
  await post({ suite: "guardrail" }, d5);
  const rl = await J(await H.handleRunsList(req("GET", "/api/faye/lab/eval"), d5));
  t("runs list: finished runs, the waiting test, and the worker state", rl.status === 200 && rl.body.runs.length === 1 && rl.body.pending.length === 1 && rl.body.pending[0].suite === "guardrail" && rl.body.worker.online === true, JSON.stringify(rl.body));
  t("runs list: suite filter and bad suite", (await J(await H.handleRunsList(req("GET", "/api/faye/lab/eval?suite=domain"), d5))).body.runs.length === 0 && (await J(await H.handleRunsList(req("GET", "/api/faye/lab/eval?suite=Bad%20One"), d5))).status === 400);
  t("another owner sees none of my runs or waiting tests", (await J(await H.handleRunsList(req("GET", "/api/faye/lab/eval"), mkDeps(db5, B)))).body.pending.length === 0);
}

// ------------------------------------------------------------------------------------------------ not_ready when the tables are missing
{
  const db = fakeDb({ installed: false });
  const d = mkDeps(db, A);
  const ov = await J(await H.handleOverview(req("GET", "/api/faye/lab"), d));
  t("tables missing: overview is 200 with ready:false (the page shows the setup message)", ov.status === 200 && ov.body.ok && ov.body.ready === false && ov.body.counts === null);
  const outs = await Promise.all([
    H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), d),
    H.handleFeedbackSubmit(req("POST", "/api/faye/lab/feedback", { rating: "good", answer_text: "hi there" }), d),
    H.handleCorrectionsList(req("GET", "/api/faye/lab/corrections"), d),
    H.handleCorrectionSave(req("POST", "/api/faye/lab/corrections", { kind: "answer", question: Q1, better_answer: BETTER1 }), d),
    H.handleExamsList(req("GET", "/api/faye/lab/exams"), d),
    H.handleNotesList(req("GET", "/api/faye/lab/notes"), d),
    H.handleRunsList(req("GET", "/api/faye/lab/eval"), d),
  ].map((p) => p.then(J)));
  t("tables missing: every data route answers 503 not_ready, honestly", outs.every((o) => o.status === 503 && o.body.code === "not_ready" && /not set up yet/.test(o.body.error)), JSON.stringify(outs.map((o) => [o.status, o.body.code])));
  t("not_ready is its own code, not a vague server error", ER.labStatus("not_ready") === 503 && ER.isExtraCode("not_ready"));
  t("database error without a missing-table code stays a plain server_error (no detail leaked)", await (async () => {
    const bad = { auth: { getUser: async () => ({ data: { user: A }, error: null }) }, rpc: () => Promise.resolve({ data: null, error: { code: "XX000", message: "secret internal detail" } }) };
    const r = await J(await H.handleFeedbackList(req("GET", "/api/faye/lab/feedback"), mkDeps(db, A, { client: bad })));
    return r.status === 500 && r.body.code === "server_error" && !JSON.stringify(r.body).includes("secret internal");
  })());
  const throwing = { auth: { getUser: async () => ({ data: { user: A }, error: null }) }, rpc: () => { throw new Error("boom"); } };
  const tr = await J(await H.handleExamsList(req("GET", "/api/faye/lab/exams"), mkDeps(db, A, { client: throwing })));
  t("a throwing database client becomes 503 unavailable, never an unhandled error", tr.status === 503 && tr.body.code === "unavailable");
}

// ------------------------------------------------------------------------------------------------ screen
{
  const S = (s: string, o: any = { max: 200 }) => SC.screenLabText(s, o);
  const reasons: [string, string][] = [
    ["my key is sk-live-abcdefghijklmnop1234", "secret"],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123456789", "secret"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc", "secret"],
    ["-----BEGIN PRIVATE KEY-----", "secret"],
    ["Authorization: Bearer abcdefgh12345678", "secret"],
    ["AbCdEfGhIjKlMnOpQrStUvWxYz012345", "secret"],
    ["the password is hunter2xyz", "credential"],
    ["api key = abcd1234", "credential"],
    ["card 4111 1111 1111 1111", "card"],
    ["ssn 123-45-6789", "ssn"],
    ["wire to account number 123456789012", "account"],
    ["write me at someone@example.com", "contact"],
    ["hidden\u200Bchar", "control"],
    ["bell\u0007char", "control"],
    ["   ", "empty"],
  ];
  for (const [text, why] of reasons) t(`screen refuses (${why}): ${text.slice(0, 36).replace(/[^\x20-\x7e]/g, "?")}`, (() => { const r = S(text); return r.ok === false && r.reason === why; })(), JSON.stringify(S(text)));
  const fine = ["What is a password manager?", "Should I buy NVDA calls before earnings?", "Tell me which stock to buy now.", "GEX is gamma exposure; dealers hedge it.", "Is the S&P 500 up 2.5% today?"];
  for (const text of fine) t(`screen allows Lab text: ${text}`, S(text).ok === true);
  t("screen collapses whitespace on one line", S("  two   words \n here ").text === "two words here");
  t("screen keeps paragraphs when multiline", S("a line\n\n\n\nnext   line", { max: 100, multiline: true }).text === "a line\n\nnext line");
  t("screen length bounds", S("abc", { min: 5, max: 10 }).reason === "length" && S("a".repeat(11), { max: 10 }).reason === "length");
  t("screen refuses non-strings", S(42 as any).ok === false && S(null as any).ok === false);
}

// ------------------------------------------------------------------------------------------------ stats, mood, chart
{
  const w8 = ST.wilson(8, 8);
  t("wilson 8 of 8: the lower end is about 68% (a perfect score on 8 questions is still a wide range)", Math.abs(w8.low - 0.676) < 0.01 && w8.high === 1 && w8.rate === 1, JSON.stringify(w8));
  const w = ST.wilson(0, 10);
  t("wilson 0 of 10 stays inside 0 and 1", w.low === 0 && w.high > 0 && w.high < 0.4);
  t("wilson handles empty input", ST.wilson(0, 0).high === 0 && ST.wilson(NaN, 5).rate === 0);
  const runs = [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, suite: "guardrail", passed: n < 5 ? 8 : 7, total: 8, createdAt: iso(clock.t + n * 3_600_000), finishedAt: iso(clock.t + n * 3_600_000) }));
  runs.push({ id: "o1", suite: "orchestration", passed: 200, total: 208, createdAt: iso(), finishedAt: iso() });
  const s = ST.seriesFor(runs, "guardrail", 3);
  t("seriesFor: last 3 of a suite, oldest first, other suites excluded", s.length === 3 && s.map((p) => p.id).join() === "r3,r4,r5" && s[2].passed === 7);
  t("seriesFor skips empty runs", ST.seriesFor([{ id: "z", suite: "guardrail", passed: 0, total: 0, createdAt: iso() }], "guardrail").length === 0);
  t("date helpers are UTC", ST.shortDate("2026-10-20T23:59:00Z") === "Oct 20" && ST.shortTime("2026-10-20T07:05:00Z") === "07:05" && ST.shortDate(null) === "");

  const R = (suite: string, passed: number, total: number, at: number) => ({ id: `${suite}${at}`, suite, passed, total, createdAt: iso(clock.t + at * 60_000), finishedAt: null });
  const pend = [{ jobId: "j", status: "queued", suite: "guardrail", createdAt: iso() }];
  t("mood: worker stale -> offline (beats everything)", MD.labMood({ online: false, pending: pend, runs: [R("guardrail", 8, 8, 1)] }).mood === "offline");
  t("mood: a queued or running test -> thinking", MD.labMood({ online: true, pending: pend, runs: [R("guardrail", 8, 8, 1)] }).mood === "thinking");
  t("mood: guardrail 8 of 8 -> celebrating", MD.labMood({ online: true, pending: [], runs: [R("guardrail", 8, 8, 1)] }).mood === "celebrating");
  t("mood: guardrail 7 of 8 and no earlier run -> idle", MD.labMood({ online: true, pending: [], runs: [R("guardrail", 7, 8, 1)] }).mood === "idle");
  const dropped = MD.labMood({ online: true, pending: [], runs: [R("guardrail", 8, 8, 1), R("guardrail", 7, 8, 2)] });
  t("mood: the newest score is lower than the one before -> unsure (names the suite)", dropped.mood === "unsure" && dropped.suite === "guardrail");
  t("mood: unsure beats celebrating (orchestration dropped while guardrail is 8 of 8)", MD.labMood({ online: true, pending: [], runs: [R("guardrail", 8, 8, 1), R("orchestration", 208, 208, 1), R("orchestration", 200, 208, 2)] }).mood === "unsure");
  t("mood: a score that went UP is not a drop", MD.labMood({ online: true, pending: [], runs: [R("guardrail", 6, 8, 1), R("guardrail", 8, 8, 2)] }).mood === "celebrating");
  t("mood: no runs -> idle", MD.labMood({ online: true, pending: [], runs: [] }).mood === "idle");
  t("mood: 8 of 8 means exactly 8 of 8 (4 of 4 does not celebrate)", MD.labMood({ online: true, pending: [], runs: [R("guardrail", 4, 4, 1)] }).mood === "idle");

  // chart: bars start at zero
  const pts = ST.seriesFor(runs, "guardrail", 10);
  const svg = renderToStaticMarkup(h(LC.PassChart, { id: "c1", suite: "guardrail", title: "Guardrail pass rate", points: pts, strict: true, emptyText: "No runs yet." }));
  const rects = [...svg.matchAll(/<rect class="fl-bar" data-tone="(\w+)" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)];
  const base = Number(svg.match(/class="fl-svg-base" x1="\d+" x2="\d+" y1="([\d.]+)"/)[1]);
  t("chart: one bar per run", rects.length === pts.length);
  t("chart: every bar starts at the zero line (y + height equals the baseline)", rects.every((m) => Math.abs(Number(m[2]) + Number(m[3]) - base) < 0.2), JSON.stringify(rects.map((m) => [m[2], m[3]])) + " base " + base);
  t("chart: a 100% bar is as tall as the plot, a 7 of 8 bar is shorter and a guardrail miss is drawn bad", Number(rects[0][3]) > Number(rects[4][3]) && rects[4][1] === "bad" && rects[0][1] === "ok");
  t("chart: the scale is fixed at 0, 50 and 100 percent, one axis", /0%/.test(svg) && /50%/.test(svg) && /100%/.test(svg) && (svg.match(/<text class="fl-svg-t" x="\d+" y="[\d.]+" text-anchor="end"/g) ?? []).length === 3);
  t("chart: n is on screen (passed/total on each bar and an 'n =' caption)", /8\/8/.test(svg) && /7\/8/.test(svg) && /n = 8 questions per run/.test(svg));
  t("chart: has a title, a description with every run and an accessible name", /<title id="c1-t">/.test(svg) && /run 5: 7 of 8/.test(svg) && /role="img"/.test(svg));
  t("chart: empty state is text, not an empty plot", /No runs yet\./.test(renderToStaticMarkup(h(LC.PassChart, { id: "c2", suite: "orchestration", title: "t", points: [], emptyText: "No runs yet." }))));
  t("chart: mixed totals say 'to'", /n = 8 to 208 questions per run/.test(renderToStaticMarkup(h(LC.PassChart, { id: "c3", suite: "x", title: "t", points: [{ id: "a", at: iso(), passed: 8, total: 8, rate: 1, low: 0.7, high: 1 }, { id: "b", at: iso(), passed: 200, total: 208, rate: 0.96, low: 0.93, high: 0.98 }], emptyText: "x" }))));
}

// ------------------------------------------------------------------------------------------------ the browser client + state machine against the real handlers
function routeFetch(db: any, user: any, env: any = ENV_ON, over: any = {}) {
  const limiters = freshLimiters();
  const calls: { method: string; path: string; body: any }[] = [];
  const f = async (url: string, init: any = {}) => {
    const method = init.method ?? "GET";
    const u = new URL(url, BASE);
    const path = u.pathname.replace("/api/faye/lab", "") || "/";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    const rq = new Request(`${BASE}${u.pathname}${u.search}`, { method, headers: method === "POST" ? { "content-type": "application/json", origin: BASE } : {}, body: init.body });
    const d = { env, getClient: async () => (over.client ?? db.client(user)), now: () => clock.t, newId, limiters };
    const id = path.split("/")[2];
    if (path === "/") return H.handleOverview(rq, d);
    if (path === "/feedback") return method === "POST" ? H.handleFeedbackSubmit(rq, d) : H.handleFeedbackList(rq, d);
    if (path === "/corrections") return method === "POST" ? H.handleCorrectionSave(rq, d) : H.handleCorrectionsList(rq, d);
    if (path.startsWith("/corrections/")) return H.handleCorrectionAction(rq, id, d);
    if (path === "/exams") return H.handleExamsList(rq, d);
    if (path.startsWith("/exams/")) return H.handleExamAction(rq, id, d);
    if (path === "/notes") return method === "POST" ? H.handleNoteCreate(rq, d) : H.handleNotesList(rq, d);
    if (path.startsWith("/notes/")) return H.handleNoteDecision(rq, id, d);
    if (path === "/eval") return method === "POST" ? H.handleEvalRequest(rq, d) : H.handleRunsList(rq, d);
    return new Response("{}", { status: 404 });
  };
  f.calls = calls;
  return f;
}

let state1: any;
{
  const db = fakeDb();
  const fetchImpl = routeFetch(db, A);
  const client = CL.createLabClient(fetchImpl as any);
  const store = LS.createLabStore({ client });
  t("store: starts idle and offline (figure rests until the first load)", store.getState().load === "idle" && store.getState().mood.mood === "offline");
  t("store: load() reads overview + five lists", (await store.load()) === true && store.getState().load === "ready" && fetchImpl.calls.length === 6, String(fetchImpl.calls.length));
  t("store: ready, online, idle mood", store.getState().online === true && store.getState().mood.mood === "idle");
  t("store: saveCorrection -> notice + list reloaded", (await store.saveCorrection({ kind: "answer", question: Q1, betterAnswer: BETTER1, badExcerpt: "" })) && store.getState().corrections.length === 1 && store.getState().notice.text === CP.LAB_COPY.notice.correctionSaved);
  const cid = store.getState().corrections[0].id;
  t("store: an empty 'what Faye said' field is not sent", fetchImpl.calls.find((c) => c.method === "POST" && c.path === "/corrections").body.bad_excerpt === undefined);
  t("store: promote to the exam set (keywords parsed from text)", (await store.promote(cid, "held_out", "domain", "buy, delta|gamma ,\n hedge")) && store.getState().heldOut.length === 1 && store.getState().notice.text === CP.LAB_COPY.notice.examSaved);
  t("store: the keywords reach the server as a clean list", JSON.stringify(fetchImpl.calls.find((c) => c.body?.action === "promote").body.keywords) === JSON.stringify(["buy", "delta|gamma", "hedge"]));
  t("store: the exam question is in heldOut and NOT in training", store.getState().training.length === 0 && store.getState().heldOut[0].set === "held_out");
  const wall = await store.proposeNote({ examId: store.getState().heldOut[0].id, title: "Leak attempt", body: "Trying to turn the exam into a note for Faye." });
  t("store: a note from the exam is refused with the wall sentence and the list is reloaded", wall === false && /never be taught/.test(store.getState().notice.text) && store.getState().notice.tone === "error" && store.getState().notes.length === 0);
  t("store: a long test needs the box ticked (no call made)", (await store.requestEval("full", false)) === false && store.getState().notice.text === CP.LAB_COPY.notice.confirmFirst && !fetchImpl.calls.some((c) => c.method === "POST" && c.path === "/eval"));
  t("store: guardrail request -> pending -> thinking mood", (await store.requestEval("guardrail", false)) && store.getState().pending.length === 1 && store.getState().mood.mood === "thinking" && store.getState().notice.text === CP.LAB_COPY.notice.testQueued);
  db.U(A.id).jobs.forEach((j) => (j.status = "done"));
  db.U(A.id).runs.push({ id: UUID(80), suite: "guardrail", started_at: iso(), finished_at: iso(), passed: 8, total: 8, constraint_sha: "abc", persona_sha: "def", model: "gemma3:1b", created_at: iso() });
  await store.refreshRuns();
  t("store: the test finished -> notice, 8 of 8 -> celebrating", store.getState().pending.length === 0 && store.getState().notice.text === CP.LAB_COPY.notice.testDone && store.getState().mood.mood === "celebrating");
  db.U(A.id).runs.push({ id: UUID(81), suite: "guardrail", started_at: iso(), finished_at: iso(), passed: 7, total: 8, constraint_sha: "abc", persona_sha: "def", model: "gemma3:1b", created_at: iso(clock.t + 1000) });
  await store.refreshRuns();
  t("store: a lower score -> unsure", store.getState().mood.mood === "unsure");
  db.U(A.id).online = false;
  await store.refreshRuns();
  t("store: worker went stale -> offline", store.getState().mood.mood === "offline");
  db.U(A.id).online = true;
  t("store: one call at a time per row (a double click makes one request)", await (async () => {
    const before = fetchImpl.calls.length;
    const p1 = store.dismissCorrection(cid);
    const p2 = store.dismissCorrection(cid);
    await Promise.all([p1, p2]);
    return fetchImpl.calls.slice(before).filter((c) => c.method === "POST").length === 1;
  })());
  t("store: parseKeywords", LS.parseKeywords(" a, b|c ,,\n d ").join("/") === "a/b|c/d" && LS.parseKeywords("").length === 0);

  // flag off: the page shows the switched-off state and makes no call
  const off = routeFetch(db, A, ENV_OFF);
  const sOff = LS.createLabStore({ client: CL.createLabClient(off as any), enabled: false });
  await sOff.load();
  t("store: enabled=false shows 'disabled' and makes no call", sOff.getState().load === "disabled" && off.calls.length === 0);
  const sOff2 = LS.createLabStore({ client: CL.createLabClient(off as any) });
  await sOff2.load();
  t("store: the server says disabled -> 'disabled' state", sOff2.getState().load === "disabled");
  // tables missing
  const nr = LS.createLabStore({ client: CL.createLabClient(routeFetch(fakeDb({ installed: false }), A) as any) });
  await nr.load();
  t("store: tables missing -> 'not_ready' state with the setup message in the view", nr.getState().load === "not_ready" && /13-faye_lab\.sql/.test(renderToStaticMarkup(h(LV.LabView, { state: nr.getState(), store: nr }))));
  // network failure
  const down = LS.createLabStore({ client: CL.createLabClient((async () => { throw new TypeError("offline"); }) as any) });
  await down.load();
  t("store: network failure -> error state with the friendly sentence and a retry button", down.getState().load === "error" && down.getState().loadError === CL.NETWORK_SENTENCE && /Try again/.test(renderToStaticMarkup(h(LV.LabView, { state: down.getState(), store: down }))));
  // sign-in lost
  const nos = LS.createLabStore({ client: CL.createLabClient(routeFetch(db, A, ENV_ON, { client: noSession }) as any) });
  await nos.load();
  t("store: signed out -> the sign-in sentence", nos.getState().loadError === CL.SIGN_IN_SENTENCE, nos.getState().loadError);
  state1 = { store, db };
}

// client: the server's own sentence is never shown
{
  const f = async () => new Response(JSON.stringify({ ok: false, code: "text_rejected", error: "SERVER SENTENCE WITH <b>markup</b>", detail: "secret" }), { status: 422, headers: { "content-type": "application/json" } });
  const r = await CL.createLabClient(f as any).saveCorrection({ kind: "answer", question: Q1, betterAnswer: "x".repeat(10) });
  t("client: the friendly sentence comes from the code, not from the server text", r.ok === false && r.message === ER.labSentence("text_rejected") && !/SERVER SENTENCE/.test(r.message));
  const f2 = async () => new Response("<html>502</html>", { status: 502 });
  const r2 = await CL.createLabClient(f2 as any).exams();
  t("client: a non-JSON error page becomes a plain server_error sentence", r2.ok === false && r2.code === "server_error");
  const f3 = async () => new Response("{}", { status: 401 });
  t("client: a 401 from the middleware is the sign-in sentence", (await CL.createLabClient(f3 as any).exams()).message === CL.SIGN_IN_SENTENCE);
}

// ------------------------------------------------------------------------------------------------ the screen
const STORE_STUB = new Proxy({}, { get: () => async () => true });
const baseState = () => ({ ...LS.initialState(), load: "ready", online: true, counts: { feedback: 2, feedbackToReview: 1, correctionsNew: 1, train: 1, heldout: 1, notesPending: 1, runs: 2 }, mood: MD.labMood({ online: true, pending: [], runs: [] }) });
const EVIL = '<img src=x onerror=alert(1)> "quoted" & <script>alert(2)</script>';
function richState(over: any = {}) {
  const s = baseState();
  s.feedback = [
    { id: UUID(201), jobId: null, rating: "wrong", note: EVIL, answerExcerpt: `Faye said ${EVIL}`, createdAt: iso() },
    { id: UUID(202), jobId: null, rating: "good", note: null, answerExcerpt: "A fine answer.", createdAt: iso() },
  ];
  s.feedbackSummary = { good: 1, wrong: 1, too_long: 0, off_voice: 0, total: 2 };
  s.corrections = [
    { id: UUID(211), kind: "answer", question: `${Q1} ${EVIL}`, badExcerpt: "bad", betterAnswer: BETTER1, status: "new", createdAt: iso(), examMade: false, practiceMade: false, noteMade: false },
    { id: UUID(212), kind: "fact", question: Q2, badExcerpt: null, betterAnswer: BETTER2, status: "promoted_eval", createdAt: iso(), examMade: true, practiceMade: false, noteMade: false },
  ];
  s.training = [{ id: UUID(221), set: "training", suite: "domain", question: "What is gamma exposure in plain words?", requiredKeywords: ["dealer", "a|b"], approved: true, usedInCorpus: false, sourceCorrectionId: null, createdAt: iso() }];
  s.heldOut = [{ id: UUID(222), set: "held_out", suite: "domain", question: Q2, requiredKeywords: ["buy"], approved: false, usedInCorpus: false, sourceCorrectionId: UUID(212), createdAt: iso() }];
  s.notes = [
    { id: UUID(231), title: `Note ${EVIL}`, body: "A negative GEX regime means dealers are short gamma.", status: "pending", fromCorrectionId: UUID(211), fromEvalItemId: null, decidedAt: null, createdAt: iso() },
    { id: UUID(232), title: "Old note", body: "An approved note body that is long enough.", status: "approved", fromCorrectionId: null, fromEvalItemId: UUID(221), decidedAt: iso(), createdAt: iso() },
  ];
  s.runs = [
    { id: UUID(241), suite: "guardrail", startedAt: iso(), finishedAt: iso(clock.t + 60_000), passed: 7, total: 8, constraintSha: "a", personaSha: "b", model: "gemma3:1b", createdAt: iso(clock.t + 60_000) },
    { id: UUID(242), suite: "guardrail", startedAt: iso(), finishedAt: iso(), passed: 8, total: 8, constraintSha: "a", personaSha: "b", model: "gemma3:1b", createdAt: iso() },
    { id: UUID(243), suite: "orchestration", startedAt: iso(), finishedAt: iso(), passed: 207, total: 208, constraintSha: "a", personaSha: "b", model: null, createdAt: iso() },
  ];
  s.pending = [{ jobId: UUID(251), status: "running", suite: "domain", createdAt: iso() }];
  s.mood = MD.labMood({ online: s.online, pending: s.pending, runs: s.runs });
  return Object.assign(s, over);
}
{
  const html = renderToStaticMarkup(h(LV.LabView, { state: richState(), store: STORE_STUB }));
  const noStyle = html.replace(/<style>[\s\S]*?<\/style>/g, "");
  t("view: renders (one h1, five h2 sections in order)", (noStyle.match(/<h1\b/g) ?? []).length === 1 && (noStyle.match(/<h2\b/g) ?? []).length === 5 && ["Feedback inbox", "Teach me", "Exams", "Notes to approve", "Test console"].every((x, i, a) => i === 0 || noStyle.indexOf(a[i - 1]) < noStyle.indexOf(x, noStyle.indexOf(a[i - 1]))));
  t("view: hostile text is escaped, never markup", !/<img src=x/.test(noStyle) && !/<script>alert/.test(noStyle) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(noStyle));
  t("view: the Faye figure shows the Lab's mood (a test is running -> thinking)", /data-mood="thinking"/.test(noStyle));
  const sets = [...noStyle.matchAll(/<div class="fl-set" data-set="(\w+)" role="group" aria-label="([^"]+)"/g)];
  t("view: exams are in TWO separate groups, training first, labelled", sets.length === 2 && sets[0][1] === "training" && sets[1][1] === "held_out" && /Training, 1/.test(sets[0][2]) && /Held-out exam, 1/.test(sets[1][2]), JSON.stringify(sets.map((s) => s.slice(1))));
  const trainHtml = noStyle.slice(noStyle.indexOf('data-set="training"'), noStyle.indexOf('data-set="held_out"'));
  const heldHtml = noStyle.slice(noStyle.indexOf('data-set="held_out"'), noStyle.indexOf('id="' + noStyle.match(/id="([^"]+-notes)"/)[1]));
  t("view: the held-out question is only in the held-out group, the training question only in training", heldHtml.includes(Q2) && !trainHtml.includes(Q2) && trainHtml.includes("gamma exposure in plain words") && !heldHtml.includes("gamma exposure in plain words"));
  t("view: the warning that exam questions must never reach Faye or her notes is on screen", /must never be shown to Faye or added to her notes/.test(noStyle));
  t("view: the held-out group has NO 'Propose as a note' button and says why", !/Propose as a note: What do dealers hedge|aria-label="Propose as a note: How do dealers/.test(heldHtml) && /can never become notes/.test(heldHtml));
  t("view: the training group offers 'Propose as a note'", /aria-label="Propose as a note: What is gamma exposure/.test(trainHtml));
  t("view: a correction that made an exam question hides 'Propose as a note' and says why", /This is an exam question, so it can never become a note/.test(noStyle) && !new RegExp(`aria-label="Propose as a note: ${Q2.slice(0, 20)}`).test(noStyle));
  t("view: a paused exam item says Paused; an in-use item says In use", /Paused/.test(heldHtml) && /In use/.test(trainHtml));
  t("view: held-out styling hooks are distinct (dashed edge is in the stylesheet, label is in the markup)", /\.fl-set\[data-set="held_out"\]\{border:2px dashed/.test(html) && /\.fl-set\[data-set="training"\]\{border:1px solid[^}]*border-left:6px solid/.test(html) && /HELD-OUT|Held-out exam/.test(heldHtml));
  t("view: 'Approve' and 'Reject' name their note", /aria-label="Approve: Note &lt;img/.test(noStyle) && /aria-label="Reject: Note /.test(noStyle));
  t("view: the notes hint says approving writes nothing to Faye's notes", /Nothing is added to Faye&#x27;s notes from this page|Nothing is added to Faye's notes from this page/.test(noStyle));
  t("view: BLOCKED shows when the latest guardrail run missed a question", /BLOCKED: the guardrail missed a question/.test(noStyle) && /role="alert"/.test(noStyle) && /7 of 8 BLOCKED/.test(noStyle));
  t("view: two charts (guardrail, orchestration), n visible", (noStyle.match(/<figure class="fl-chart"/g) ?? []).length === 2 && /n = 8 questions per run/.test(noStyle) && /n = 208 questions per run/.test(noStyle));
  t("view: the runs table has a caption, column headers with scope, and a likely range", /<caption>Recent runs<\/caption>/.test(noStyle) && (noStyle.match(/<th scope="col">/g) ?? []).length === 5 && /Likely range/.test(noStyle) && /68% to 100%/.test(noStyle));
  t("view: long tests are behind a details block with the 30 to 40 minutes warning, and their buttons are disabled until the box is ticked", /<details class="fl-more"><summary>Longer tests<\/summary>/.test(noStyle) && /30 to 40 minutes/.test(noStyle) && ["Held-out exam", "Domain", "Voice", "Full run"].every((n) => new RegExp(`<button type="button" class="fl-btn" disabled="">${n}</button>`).test(noStyle)));
  t("view: quick-test buttons are disabled while a test is running", /<button type="button" class="fl-btn fl-btn-primary" disabled="">Run guardrail \(8 questions\)<\/button>/.test(noStyle));
  t("view: a live region (status, polite) exists and the skip link points at main", /role="status" aria-live="polite"/.test(noStyle) && /class="fl-skip" href="#[^"]+-main"/.test(noStyle) && /<main class="fl-main" id="[^"]+-main"/.test(noStyle));
  t("view: every form control has a visible label", (() => { const ctrls = (noStyle.match(/<(input|select|textarea)\b/g) ?? []).length; const labels = (noStyle.match(/<label\b/g) ?? []).length; return labels >= ctrls; })());
  {
    // The Faye figure (WP-D, not this package) carries its own token fallbacks; cut it out and check everything else.
    const mine = noStyle.replace(/<span class="fayefb"[\s\S]*?<\/span><\/span>(?=<\/div><div class="fl-hero-text">)/, "").replace(/&#x27;|&quot;|href="#[^"]*"|id="[^"]*"|for="[^"]*"/gi, "");
    const hits = [...mine.matchAll(/.{20}#[0-9a-f]{3,8}.{6}/gi)].map((m) => m[0]);
    t("view: no colour literals of our own in the markup, no images", hits.length === 0 && !/<img/.test(mine.replace(/&lt;img/g, "")), hits.slice(0, 3).join(" | "));
  }
  const idle = renderToStaticMarkup(h(LV.LabView, { state: baseState(), store: STORE_STUB }));
  t("view: empty lists have friendly empty states", /No ratings yet/.test(idle) && /No corrections yet/.test(idle) && /None yet/.test(idle) && /No notes are waiting/.test(idle) && /No runs yet/.test(idle) && /Nothing is running/.test(idle));
  t("view: offline worker -> offline figure and the 'resting' sentence; quick tests disabled", (() => { const s = baseState(); s.online = false; s.mood = MD.labMood({ online: false, pending: [], runs: [] }); const m = renderToStaticMarkup(h(LV.LabView, { state: s, store: STORE_STUB })); return /data-mood="offline"/.test(m) && /Faye is resting/.test(m) && /disabled="">Run guardrail/.test(m); })());
  t("view: guardrail 8 of 8 -> celebrating figure and the sentence", (() => { const s = baseState(); s.runs = [richState().runs[1]]; s.mood = MD.labMood({ online: true, pending: [], runs: s.runs }); const m = renderToStaticMarkup(h(LV.LabView, { state: s, store: STORE_STUB })); return /data-mood="celebrating"/.test(m) && /passed 8 of 8/.test(m) && /every question passed/.test(m); })());
  t("view: loading state", /Loading the Lab/.test(renderToStaticMarkup(h(LV.LabView, { state: { ...LS.initialState(), load: "loading" }, store: STORE_STUB }))));
  t("view: disabled state names the variable", /FAYE_LAB_ENABLED/.test(renderToStaticMarkup(h(LV.LabView, { state: { ...LS.initialState(), load: "disabled" }, store: STORE_STUB }))));
  t("view: notice text is rendered as text in the live region", /<span>Saved\. It is in your list\.<\/span>/.test(renderToStaticMarkup(h(LV.LabView, { state: { ...baseState(), notice: { seq: 1, tone: "ok", text: CP.LAB_COPY.notice.correctionSaved } }, store: STORE_STUB }))));
}

// ------------------------------------------------------------------------------------------------ plain language: grade 8 or lower
function grade(text: string) {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const words = text.match(/[A-Za-z']+/g) ?? [];
  const syl = (w: string) => {
    w = w.toLowerCase().replace(/'/g, "");
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    return Math.max(1, (w.match(/[aeiouy]{1,2}/g) ?? []).length);
  };
  const sy = words.reduce((s, w) => s + syl(w), 0);
  return 0.39 * (words.length / Math.max(1, sentences.length)) + 11.8 * (sy / Math.max(1, words.length)) - 15.59;
}
{
  const texts: Record<string, string> = {};
  const walk = (o: any, p: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") texts[`${p}.${k}`] = v as string;
      else if (v && typeof v === "object") walk(v, `${p}.${k}`);
    }
  };
  walk(CP.LAB_COPY, "copy");
  for (const code of ["not_ready", "held_out_wall", "confirm_required", "text_rejected", "conflict", "limit_reached", "disabled", "not_found", "rate_limited", "too_large", "bad_request", "faye_offline", "unavailable", "not_allowed", "auth_required", "server_error"]) texts[`error.${code}`] = ER.labSentence(code);
  for (const d of ["conflict:already_train", "conflict:already_heldout", "conflict:duplicate", "conflict:dismissed", "conflict:already_used", "conflict:already_decided", "conflict:not_dismissed", "rate_limited:in_flight", "rate_limited:queue_full", "rate_limited:long_runs", "bad_request:rejected", "confirm_required:long"]) { const [c, x] = d.split(":"); texts[`detail.${d}`] = ER.labSentence(c, x); }
  texts.network = CL.NETWORK_SENTENCE;
  texts.signin = CL.SIGN_IN_SENTENCE;
  const syllables = (w: string) => Math.max(1, (w.toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").match(/[aeiouy]{1,2}/g) ?? []).length);
  let worst = 0;
  const bad: string[] = [];
  for (const [k, v] of Object.entries(texts)) {
    const words = v.match(/[A-Za-z']+/g) ?? [];
    if (words.length <= 5) {
      // "orchestration" is the name of a test suite (the owner's own word, also on the contract), so it is allowed as a label.
      if (words.some((w) => syllables(w) > 3 && w.toLowerCase() !== "orchestration")) bad.push(`${k} has a long word`);
      continue;
    }
    const g = grade(v);
    worst = Math.max(worst, g);
    if (g > 8) bad.push(`${k} ${g.toFixed(1)}`);
  }
  t(`reading level: all ${Object.keys(texts).length} fixed texts are plain (sentences grade 8 or lower, worst ${worst.toFixed(1)}; labels have no long words)`, bad.length === 0, bad.join("; "));
  const all = Object.values(texts).join(" ");
  t("copy: no emoji and no jargon (JSON, API, RLS, token, endpoint, payload)", !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(all) && !/\b(JSON|API|RLS|token|endpoint|payload)\b/i.test(all));
  t("copy: the warning names both ways the exam can be spoiled (shown to Faye, added to her notes)", /never be shown to Faye or added to her notes/.test(CP.LAB_COPY.exams.warn));
  t("copy: approving is described as marking only", /Approving here only marks it as OK/.test(CP.LAB_COPY.notes.hint) && /Nothing is added to Faye's notes from this page/.test(CP.LAB_COPY.notes.hint));
}

// ------------------------------------------------------------------------------------------------ labHref hookup and sources
{
  t("labHref: unset -> no link anywhere", CFG.labHrefFor({}) === undefined && CFG.labHrefFor({ NEXT_PUBLIC_FAYE_LAB_HREF: "" }) === undefined);
  t("labHref: only the exact Lab path is accepted (no open redirects)", CFG.labHrefFor({ NEXT_PUBLIC_FAYE_LAB_HREF: "/faye-lab" }) === "/faye-lab" && CFG.labHrefFor({ NEXT_PUBLIC_FAYE_LAB_HREF: "https://evil.example" }) === undefined && CFG.labHrefFor({ NEXT_PUBLIC_FAYE_LAB_HREF: "//evil.example" }) === undefined);
  const widget = read("../src/components/FayeChatWidget.tsx");
  t("labHref: the widget renders the link only when its labHref prop is set (unchanged by this package)", /props\.labHref \? \(/.test(widget));
  const pageTsx = read("../src/app/page.tsx");
  t("labHref: nothing links to /faye-lab unless the prop is passed (page.tsx has no hard-coded link)", !/href=["']\/faye-lab/.test(pageTsx));
  const walk = (dir: string, out: string[] = []) => {
    for (const e of readdirSync(new URL(dir, import.meta.url))) {
      const p = `${dir}/${e}`;
      if (statSync(new URL(p, import.meta.url)).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const labFiles = [...walk("../src/app/faye-lab"), ...walk("../src/lib/faye/lab"), ...walk("../src/app/api/faye/lab")];
  const src = labFiles.map((f) => ({ f, s: read(f) }));
  t(`lint: ${labFiles.length} Lab source files; none uses innerHTML or dangerouslySetInnerHTML`, src.every(({ s }) => !/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/.test(stripComments(s))));
  t("lint: no colour literals in the Lab UI (Jarvis tokens only; the values come from tokens.ts)", src.filter(({ f }) => /faye-lab\/.*\.(tsx|ts)$/.test(f)).every(({ s }) => !/["'`]#[0-9a-fA-F]{3,8}["'`]/.test(stripComments(s)) && !/\brgba?\(\s*\d/.test(stripComments(s))));
  t("lint: only client.ts calls fetch", src.filter(({ s }) => /\bfetch\(/.test(stripComments(s))).map(({ f }) => f).join() === "../src/lib/faye/lab/client.ts", src.filter(({ s }) => /\bfetch\(/.test(stripComments(s))).map(({ f }) => f).join());
  t("lint: the Lab never reads or writes the corpus (no file system, no corpus path, no ingest call)", src.every(({ s }) => !/node:fs|corpus\/|\/pilp\/ingest|writeFile/.test(stripComments(s))));
  t("lint: the Lab UI has no timers beyond the one results poll, no animation", src.filter(({ f }) => /faye-lab\//.test(f)).every(({ f, s }) => (/setInterval/.test(s) ? /Lab\.tsx$/.test(f) : true) && !/@keyframes|animation:|transition:/.test(stripComments(s))));
  const routes = src.filter(({ f }) => /api\/faye\/lab\/.*route\.ts$/.test(f));
  t(`lint: ${routes.length} route files; each is a thin wrapper (force-dynamic, handler import, no logic)`, routes.length === 9 && routes.every(({ s }) => /force-dynamic/.test(s) && /from "@\/lib\/faye\/lab\/handlers"/.test(s) && !/\bif \(/.test(stripComments(s))));
  t("lint: every handler checks the flag, the owner gate and a limiter in begin()", (() => { const hs = read("../src/lib/faye/lab/handlers.ts"); const b = hs.slice(hs.indexOf("async function begin"), hs.indexOf("function fail")); return /labEnabled/.test(b) && /gateOwner/.test(b) && /\.hit\(/.test(b) && /checkPostRequest/.test(b); })());
  t("lint: every exported handler calls begin() first", (() => { const hs = read("../src/lib/faye/lab/handlers.ts"); const fns = [...hs.matchAll(/export async function (handle\w+)\([^)]*\)[^{]*\{\n\s*const g = await begin/g)]; return fns.length === 13; })());
}

// ------------------------------------------------------------------------------------------------ the migration (static lint; the SQL runs on PGlite in the harness named in the report)
{
  const sql = read("../db/migrations/2026-10-20_faye_lab.sql");
  const down = read("../db/migrations/2026-10-20_faye_lab_down.sql");
  const code = sql.replace(/^\s*--.*$/gm, "");
  const tables = ["faye_feedback", "faye_corrections", "faye_eval_items", "faye_corpus_notes", "faye_eval_runs"];
  t("sql: refuses to run before the mailbox migration", /Run 11-faye_mailbox\.sql first/.test(sql));
  t("sql: every table is created if not exists, has RLS on, and is revoked from anon and authenticated", tables.every((x) => new RegExp(`create table if not exists public\\.${x}\\b`).test(code) && new RegExp(`alter table public\\.${x}\\s+enable row level security`).test(code) && new RegExp(`revoke all on public\\.${x}\\s+from anon, authenticated`).test(code)));
  t("sql: every table has an owner-only select policy by user_id (runs by requested_by)", tables.every((x) => new RegExp(`create policy ${x}_select_own on public\\.${x}`).test(code)) && (code.match(/faye_lab_is_owner\(\)/g) ?? []).length >= 5);
  t("sql: authenticated gets SELECT only (no insert, update or delete grant on any table)", !/grant (insert|update|delete|all)[^;]*public\.faye_(feedback|corrections|eval_items|corpus_notes|eval_runs)/i.test(code) && /grant select on public\.faye_feedback/.test(code));
  const fnDefs = [...code.matchAll(/create or replace function public\.(faye_\w+)\(([^)]*)\)\s*returns[^$]*\$\$/g)];
  t(`sql: all ${fnDefs.length} functions are security definer (or pure and immutable) with an empty search_path`, fnDefs.length >= 20 && fnDefs.every((m) => /(security definer|immutable) set search_path = ''/.test(m[0])), fnDefs.filter((m) => !/(security definer|immutable) set search_path = ''/.test(m[0])).map((m) => m[1]).join());
  t("sql: the person always comes from auth.uid() through faye_lab_owner (no function takes a user id)", !/p_user_id|p_uid\s+uuid/.test(code.replace(/faye_lab_wall_hit\(p_user uuid/g, "")) && (code.match(/v_uid uuid := public\.faye_lab_owner\(\)/g) ?? []).length >= 12);
  t("sql: the column is `split` with 'train' | 'heldout' (what the frozen contract and the memory trigger read)", /split\s+text not null check \(split in \('train', 'heldout'\)\)/.test(code));
  t("sql wall 1: one question, one set (unique key on user and normalised question)", /create unique index if not exists faye_eval_items_key_idx on public\.faye_eval_items \(user_id, question_key\)/.test(code));
  t("sql wall 3: check (not (split = 'heldout' and used_in_corpus))", /check \(not \(split = 'heldout' and used_in_corpus\)\)/.test(code));
  t("sql wall 2: a trigger refuses to change split, question or user", /new\.split is distinct from old\.split/.test(code) && /faye_lab_eval_items_guard_trg before insert or update/.test(code));
  t("sql wall 4: a trigger refuses a note from a held-out item, from its correction, or holding its text (insert and approve)", /faye_lab_notes_guard_trg before insert or update/.test(code) && /faye_lab_wall_hit\(new\.user_id/.test(code) && /i\.split = 'heldout'/.test(code) && /errcode = 'FL001'/.test(code));
  t("sql wall 5: adding an exam question that a note already holds is refused", /n\.status <> 'rejected'/.test(code) && /held_out_wall/.test(code));
  t("sql: a note can only start as pending and cannot be edited; approval only changes the status", /a note starts as pending/.test(code) && /a note cannot be edited/.test(code) && !/insert into public\.faye_corpus_notes[^;]*status\s*=\s*'approved'/.test(code));
  t("sql: nothing in the migration writes anywhere outside the five lab tables, settings and the job reads", !/insert into public\.(faye_memory|faye_jobs|faye_access)|update public\.(faye_memory|faye_jobs|faye_access)|delete from public\.(faye_memory|faye_jobs|faye_access)/.test(code));
  t("sql: feedback keeps a hash and a 200-character excerpt, no raw text column", /answer_hash\s+text not null check \(answer_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(code) && /answer_excerpt text not null check \(char_length\(answer_excerpt\) between 1 and 200/.test(code) && !/raw_|full_answer|chat_text|answer_text/.test(code));
  t("sql: eval_runs has the exact columns faye_report_eval_run inserts", ["suite", "started_at", "finished_at", "passed", "total", "per_item", "constraint_sha", "persona_sha", "model", "worker_id", "requested_by"].every((c) => new RegExp(`\\b${c}\\b`).test(code.slice(code.indexOf("create table if not exists public.faye_eval_runs"), code.indexOf("alter table public.faye_feedback")))));
  t("sql: re-runnable (drop policy/trigger if exists before create; create or replace; if not exists)", /drop policy if exists/.test(code) && /drop trigger if exists/.test(code) && !/create table public\./.test(code) && !/create function /.test(code));
  t("sql: additive (no drop table, no alter of an existing table other than enabling RLS on its own tables)", !/drop table|drop column|truncate/i.test(code));
  t("down: drops all five tables and every lab function, and the settings keys", tables.every((x) => new RegExp(`drop table if exists public\\.${x} cascade`).test(down)) && fnDefs.every((m) => new RegExp(`drop function if exists public\\.${m[1]}\\(`).test(down)) && /lab_max_runs/.test(down), fnDefs.filter((m) => !new RegExp(`drop function if exists public\\.${m[1]}\\(`).test(down)).map((m) => m[1]).join());
  t("down: leaves mailbox and memory objects alone", !/faye_memory|faye_jobs|faye_access|faye_mailbox/.test(down.replace(/^\s*--.*$/gm, "")));
  const setup = (() => { try { return readFileSync("C:/Users/crdll/Documents/Dellegate/setup/13-faye_lab.sql", "utf8"); } catch { return null; } })();
  t("setup copy 13-faye_lab.sql is identical to the migration (skipped when the Dellegate setup folder is not on this machine)", setup === null || setup === sql);
  const contract = read("../src/lib/faye/mailbox/service.ts");
  const mbx = read("../db/migrations/2026-10-20_faye_mailbox.sql");
  t("contract: the mailbox functions read the columns this migration creates (split, suite, question, required_keywords, approved, user_id)", ["i.split", "i.suite", "i.question", "i.required_keywords", "i.approved", "i.user_id"].every((c) => mbx.includes(c)) && /split\s+text/.test(code) && /required_keywords\s+text\[\]/.test(code) && /approved\s+boolean/.test(code));
  t("contract: faye_erase_me clears the tables by the names used here", ["faye_corpus_notes", "faye_eval_items", "faye_corrections", "faye_feedback"].every((x) => mbx.includes(`'${x}'`)) && /faye_eval_runs where requested_by/.test(mbx));
  void contract;
}

summary();
