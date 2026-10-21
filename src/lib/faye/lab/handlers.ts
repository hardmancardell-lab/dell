/**
 * Request handlers for the Lab routes (src/app/api/faye/lab/**). The route files are one-liners that pass the real dependencies;
 * tests pass fakes. The routes are written out in team_audits/2026-10-20/faye-wp-c2-report.md.
 *
 * Order of checks, always: feature flag (FAYE_LAB_ENABLED, default off), cheap request checks (JSON content type and Origin on anything
 * that is not a GET), session and owner gate (src/lib/faye/access.ts), best-effort rate limit, input validation and the secret screen,
 * the held-out wall (library level), then the database (which re-checks the owner role and enforces the wall again with triggers).
 *
 * Plain text and JSON only: every response is JSON with Cache-Control: no-store. Nothing here writes to Faye's corpus. Approving a note
 * only marks it approved; the response says so (corpus_written: false).
 */
import { createHash } from "node:crypto";
import { checkPostRequest, gateOwner, type Env, type GateClient, type GateUser } from "../access";
import { jsonResponse, readJsonBody } from "../mailbox/http";
import { submitJob, getStatus } from "../mailbox/service";
import { UUID_RE, REQUEST_ID_RE } from "../mailbox/validate";
import { SlidingWindowLimiter } from "@/lib/access/rate-limit";
import { EVAL_SUITES, LAB_LIMITS, LAB_RATE, isDefaultSuite, labEnabled, type EvalSuite } from "./config";
import { labError, toLabCode, type LabErrorCode } from "./errors";
import { HIDDEN_EXCERPT, screenLabText } from "./screen";
import { LabStore } from "./store";
import { CORRECTION_KINDS, EXAM_SETS, ITEM_SUITES, RATINGS, type CorrectionKind, type ExamSet, type ItemSuite, type NoteStatus, type Rating } from "./types";
import { heldOutHit, noteTouchesQuestion } from "./wall";

export interface LabLimiters {
  read: SlidingWindowLimiter;
  write: SlidingWindowLimiter;
  evalRun: SlidingWindowLimiter;
  longRun: SlidingWindowLimiter;
}

export interface LabDeps {
  env: Env;
  getClient: () => Promise<GateClient>;
  now?: () => number;
  limiters?: LabLimiters;
  /** For the eval request id when the browser does not send one. Tests pass a fixed one. */
  newId?: () => string;
}

const defaultLimiters: LabLimiters = {
  read: new SlidingWindowLimiter(LAB_RATE.readPerMinute, 60_000),
  write: new SlidingWindowLimiter(LAB_RATE.writePerMinute, 60_000),
  evalRun: new SlidingWindowLimiter(LAB_RATE.evalPerTenMin, 10 * 60_000),
  longRun: new SlidingWindowLimiter(LAB_RATE.longPerDay, 24 * 60 * 60_000),
};

type LimiterKey = "read" | "write" | "evalRun";

interface Opts {
  mutating: boolean;
  limiter: LimiterKey;
}

interface Ready {
  ok: true;
  user: GateUser;
  client: GateClient;
  store: LabStore;
  now: number;
}
type Gate = Ready | { ok: false; response: Response };

async function begin(request: Request, deps: LabDeps, o: Opts): Promise<Gate> {
  if (!labEnabled(deps.env)) return { ok: false, response: labError("disabled") };
  if (o.mutating) {
    const post = checkPostRequest(request);
    if (!post.ok) return { ok: false, response: labError(post.code) };
  }
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) return { ok: false, response: labError(gate.code) };
  const now = deps.now?.() ?? Date.now();
  const rate = (deps.limiters ?? defaultLimiters)[o.limiter].hit(`${o.limiter}:${gate.user.id}`, now);
  if (!rate.allowed) return { ok: false, response: labError("rate_limited", { retryAfterSec: rate.retryAfterSec, detail: "route" }) };
  return { ok: true, user: gate.user, client: gate.client, store: new LabStore(gate.client), now };
}

function fail(r: { code: LabErrorCode; detail?: string }): Response {
  return labError(r.code, { detail: r.detail });
}

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

async function readBody(request: Request): Promise<Body> {
  const b = await readJsonBody(request, LAB_LIMITS.bodyBytes);
  if (!b.ok) return { ok: false, response: labError(b.code) };
  if (typeof b.value !== "object" || b.value === null || Array.isArray(b.value)) return { ok: false, response: labError("bad_request", { detail: "bad_payload" }) };
  return { ok: true, value: b.value as Record<string, unknown> };
}

const isRating = (x: unknown): x is Rating => typeof x === "string" && (RATINGS as readonly string[]).includes(x);
const isKind = (x: unknown): x is CorrectionKind => typeof x === "string" && (CORRECTION_KINDS as readonly string[]).includes(x);
const isSuite = (x: unknown): x is ItemSuite => typeof x === "string" && (ITEM_SUITES as readonly string[]).includes(x);
const isSet = (x: unknown): x is ExamSet => typeof x === "string" && (EXAM_SETS as readonly string[]).includes(x);
const isEvalSuite = (x: unknown): x is EvalSuite => typeof x === "string" && (EVAL_SUITES as readonly string[]).includes(x);

const bad = (detail: string) => labError("bad_request", { detail });
const refused = (reason: string) => labError("text_rejected", { detail: reason });

// --------------------------------------------------------------------------------------------------------------- overview

/** GET /api/faye/lab - counts for the page header plus whether Faye's worker is online. 200 with ready:false when the migration has not run. */
export async function handleOverview(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const r = await g.store.overview();
  let online = false;
  let queueDepth = 0;
  const st = await getStatus(g.client, false);
  if (st.ok) {
    online = st.online;
    queueDepth = st.queueDepth;
  }
  if (!r.ok) {
    if (r.code === "not_ready") return jsonResponse({ ok: true, enabled: true, ready: false, counts: null, worker: { online, queueDepth } });
    return fail(r);
  }
  return jsonResponse({ ok: true, enabled: true, ready: true, counts: r.data.counts, worker: { online, queueDepth } });
}

// --------------------------------------------------------------------------------------------------------------- feedback

/** GET /api/faye/lab/feedback */
export async function handleFeedbackList(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const r = await g.store.listFeedback(100);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, items: r.data.items, summary: r.data.summary });
}

const HEX16 = /^[0-9a-f]{1,16}$/;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;

/** Only these provenance keys survive, each with a strict shape. Never text. */
function cleanProvenance(x: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof x !== "object" || x === null || Array.isArray(x)) return out;
  const o = x as Record<string, unknown>;
  if (typeof o.model === "string" && MODEL_RE.test(o.model)) out.model = o.model;
  for (const k of ["constraint_sha256_16", "persona_sha256_16", "memory_hash"]) {
    const v = o[k];
    if (typeof v === "string" && HEX16.test(v)) out[k] = v;
  }
  if (typeof o.memory_count === "number" && Number.isInteger(o.memory_count) && o.memory_count >= 0 && o.memory_count <= 6) out.memory_count = o.memory_count;
  return out;
}

/** The first `n` characters by code point (never splits a surrogate pair). */
function firstChars(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join("");
}

/**
 * POST /api/faye/lab/feedback  { rating, answer_text, note?, job_id?, provenance? }
 * The server hashes the answer and keeps a 200-character excerpt. The answer text itself is NOT passed to the database, logged or echoed.
 */
export async function handleFeedbackSubmit(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = b.value;
  if (!isRating(v.rating)) return bad("bad_rating");
  if (typeof v.answer_text !== "string") return bad("bad_answer");
  const answer = v.answer_text.trim();
  if (answer.length === 0 || answer.length > LAB_LIMITS.answerChars) return answer.length === 0 ? bad("bad_answer") : labError("too_large", { detail: "answer" });
  let jobId: string | null = null;
  if (v.job_id !== undefined && v.job_id !== null) {
    if (typeof v.job_id !== "string" || !UUID_RE.test(v.job_id)) return bad("bad_job");
    jobId = v.job_id;
  }
  let note: string | null = null;
  if (v.note !== undefined && v.note !== null && v.note !== "") {
    const s = screenLabText(v.note, { min: 1, max: LAB_LIMITS.noteChars });
    if (!s.ok) return s.reason === "length" ? labError("too_large", { detail: "note" }) : refused(s.reason);
    note = s.text;
  }
  const hash = createHash("sha256").update(answer, "utf8").digest("hex");
  const squashed = firstChars(answer.replace(/\s+/g, " "), LAB_LIMITS.excerptChars).trim();
  const ex = screenLabText(squashed, { min: 1, max: LAB_LIMITS.excerptChars });
  const excerpt = ex.ok ? ex.text : HIDDEN_EXCERPT;
  const r = await g.store.submitFeedback({ jobId, rating: v.rating, note, answerHash: hash, excerpt, provenance: cleanProvenance(v.provenance) });
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, id: r.data.id, rating: r.data.rating }, 201);
}

// --------------------------------------------------------------------------------------------------------------- corrections

/** GET /api/faye/lab/corrections */
export async function handleCorrectionsList(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const r = await g.store.listCorrections(100);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, items: r.data.items });
}

/** POST /api/faye/lab/corrections  { kind, question, better_answer, bad_excerpt?, job_id? } */
export async function handleCorrectionSave(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = b.value;
  if (!isKind(v.kind)) return bad("bad_kind");
  const q = screenLabText(v.question, { min: LAB_LIMITS.questionMin, max: LAB_LIMITS.questionMax });
  if (!q.ok) return q.reason === "length" || q.reason === "empty" ? bad("bad_question") : refused(q.reason);
  const better = screenLabText(v.better_answer, { min: LAB_LIMITS.betterMin, max: LAB_LIMITS.betterMax, multiline: true });
  if (!better.ok) return better.reason === "length" || better.reason === "empty" ? bad("bad_answer") : refused(better.reason);
  let bad_excerpt: string | null = null;
  if (typeof v.bad_excerpt === "string" && v.bad_excerpt.trim() !== "") {
    const e = screenLabText(firstChars(v.bad_excerpt.replace(/\s+/g, " ").trim(), LAB_LIMITS.badExcerptChars), { min: 1, max: LAB_LIMITS.badExcerptChars });
    bad_excerpt = e.ok ? e.text : null; // a quoted answer that looks private is simply not kept
  }
  let jobId: string | null = null;
  if (v.job_id !== undefined && v.job_id !== null) {
    if (typeof v.job_id !== "string" || !UUID_RE.test(v.job_id)) return bad("bad_job");
    jobId = v.job_id;
  }
  const r = await g.store.saveCorrection({ kind: v.kind, question: q.text, badExcerpt: bad_excerpt, better: better.text, jobId });
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, id: r.data.id }, 201);
}

/** Keywords are the same "a|b" alternative syntax as eval_suite.py. At most 8, each 1 to 80 characters, one line. */
function cleanKeywords(x: unknown): { ok: true; value: string[] } | { ok: false; response: Response } {
  if (x === undefined || x === null) return { ok: true, value: [] };
  if (!Array.isArray(x) || x.length > LAB_LIMITS.keywordMax) return { ok: false, response: bad("bad_keywords") };
  const out: string[] = [];
  for (const k of x) {
    const s = screenLabText(k, { min: 1, max: LAB_LIMITS.keywordChars });
    if (!s.ok) return { ok: false, response: s.reason === "length" || s.reason === "empty" ? bad("bad_keywords") : refused(s.reason) };
    out.push(s.text);
  }
  return { ok: true, value: out };
}

/**
 * POST /api/faye/lab/corrections/{id}
 *   { action: "dismiss" } | { action: "reopen" }
 *   { action: "promote", target: "training" | "held_out", suite: "guardrail" | "domain" | "persona", keywords?: string[] }
 * "promote" makes ONE question in ONE set. The same question can never sit in both sets (the database refuses it).
 */
export async function handleCorrectionAction(request: Request, id: string, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return bad("bad_id");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = b.value;
  if (v.action === "dismiss" || v.action === "reopen") {
    const r = await g.store.decideCorrection(id, v.action);
    if (!r.ok) return fail(r);
    return jsonResponse({ ok: true, status: r.data.status });
  }
  if (v.action !== "promote") return bad("bad_action");
  if (!isSet(v.target)) return bad("bad_target");
  if (!isSuite(v.suite)) return bad("bad_suite");
  const kw = cleanKeywords(v.keywords);
  if (!kw.ok) return kw.response;
  if (v.target === "held_out") {
    // library-level wall, direction 2: something already taught this question
    const corrections = await g.store.listCorrections(200);
    if (!corrections.ok) return fail(corrections);
    const c = corrections.data.items.find((x) => x.id === id);
    if (!c) return labError("not_found");
    const notes = await g.store.listNotes(null);
    if (!notes.ok) return fail(notes);
    if (c.noteMade || noteTouchesQuestion(notes.data.items, { question: c.question, correctionId: id })) return labError("held_out_wall");
  }
  const r = await g.store.promoteCorrection(id, v.target, v.suite, kw.value);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, id: r.data.id, set: r.data.set }, 201);
}

// --------------------------------------------------------------------------------------------------------------- exams

/** GET /api/faye/lab/exams - the two sets, kept apart in the answer. */
export async function handleExamsList(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const r = await g.store.listItems();
  if (!r.ok) return fail(r);
  const training = r.data.items.filter((i) => i.set === "training");
  const heldOut = r.data.items.filter((i) => i.set === "held_out");
  return jsonResponse({ ok: true, training, held_out: heldOut, counts: { training: training.length, held_out: heldOut.length } });
}

/** POST /api/faye/lab/exams/{id}  { action: "pause" | "resume" | "delete" } */
export async function handleExamAction(request: Request, id: string, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return bad("bad_id");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const a = b.value.action;
  if (a !== "pause" && a !== "resume" && a !== "delete") return bad("bad_action");
  const r = await g.store.updateItem(id, a);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, action: r.data.action });
}

// --------------------------------------------------------------------------------------------------------------- notes

/** GET /api/faye/lab/notes[?status=pending|approved|rejected] */
export async function handleNotesList(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const status = new URL(request.url).searchParams.get("status");
  if (status !== null && !["pending", "approved", "rejected"].includes(status)) return bad("bad_status");
  const r = await g.store.listNotes(status as NoteStatus | null);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, items: r.data.items });
}

/**
 * POST /api/faye/lab/notes  { correction_id?, exam_id?, title, body }
 * A PROPOSAL. It starts as pending. A note can never come from an exam question, from the correction an exam question was made from,
 * or hold an exam question's words (library check here, database trigger behind it).
 */
export async function handleNoteCreate(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = b.value;
  const ids: { correction: string | null; exam: string | null } = { correction: null, exam: null };
  for (const [key, slot] of [["correction_id", "correction"], ["exam_id", "exam"]] as const) {
    const x = v[key];
    if (x === undefined || x === null) continue;
    if (typeof x !== "string" || !UUID_RE.test(x)) return bad("bad_id");
    ids[slot] = x;
  }
  if (!ids.correction && !ids.exam) return bad("no_source");
  const title = screenLabText(v.title, { min: LAB_LIMITS.titleMin, max: LAB_LIMITS.titleMax });
  if (!title.ok) return title.reason === "length" || title.reason === "empty" ? bad("bad_title") : refused(title.reason);
  const body = screenLabText(v.body, { min: LAB_LIMITS.bodyMin, max: LAB_LIMITS.bodyMax, multiline: true });
  if (!body.ok) return body.reason === "length" || body.reason === "empty" ? bad("bad_body") : refused(body.reason);

  const items = await g.store.listItems();
  if (!items.ok) return fail(items);
  if (heldOutHit(items.data.items, { text: `${title.text} ${body.text}`, correctionId: ids.correction, examId: ids.exam })) return labError("held_out_wall");

  const r = await g.store.proposeNote({ correctionId: ids.correction, examId: ids.exam, title: title.text, body: body.text });
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, id: r.data.id, status: r.data.status, corpus_written: false }, 201);
}

/** POST /api/faye/lab/notes/{id}  { decision: "approve" | "reject" }. Approving only marks the note; nothing is written to Faye's corpus here. */
export async function handleNoteDecision(request: Request, id: string, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return bad("bad_id");
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const d = b.value.decision;
  if (d !== "approve" && d !== "reject") return bad("bad_decision");
  if (d === "approve") {
    // the wall again at the moment it matters: an exam question may have been added since the note was proposed
    const notes = await g.store.listNotes(null);
    if (!notes.ok) return fail(notes);
    const note = notes.data.items.find((n) => n.id === id);
    if (!note) return labError("not_found");
    const items = await g.store.listItems();
    if (!items.ok) return fail(items);
    if (heldOutHit(items.data.items, { text: `${note.title} ${note.body}`, correctionId: note.fromCorrectionId, examId: note.fromEvalItemId })) return labError("held_out_wall");
  }
  const r = await g.store.decideNote(id, d);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, status: r.data.status, corpus_written: false });
}

// --------------------------------------------------------------------------------------------------------------- test runs

/** GET /api/faye/lab/eval[?suite=guardrail] - finished runs (newest first) and the owner's tests that are still waiting or running. */
export async function handleRunsList(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, limiter: "read" });
  if (!g.ok) return g.response;
  const suite = new URL(request.url).searchParams.get("suite");
  if (suite !== null && !/^[a-z_]{1,40}$/.test(suite)) return bad("bad_suite");
  const r = await g.store.listRuns(suite, 60);
  if (!r.ok) return fail(r);
  const st = await getStatus(g.client, false);
  return jsonResponse({ ok: true, runs: r.data.runs, pending: r.data.pending, worker: { online: st.ok ? st.online : false, queueDepth: st.ok ? st.queueDepth : 0 } });
}

/**
 * POST /api/faye/lab/eval  { suite, confirm_long?: true, request_id?, label? }
 * Only "guardrail" and "orchestration" start on a plain request. "heldout", "domain", "persona" and "full" take 30 to 40 minutes and share
 * the model with chat, so they need confirm_long: true. The job is created through the mailbox (kind "eval", owner only, one in flight).
 */
export async function handleEvalRequest(request: Request, deps: LabDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, limiter: "evalRun" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const v = b.value;
  if (!isEvalSuite(v.suite)) return bad("bad_suite");
  const suite = v.suite;
  if (!isDefaultSuite(suite)) {
    if (v.confirm_long !== true) return labError("confirm_required", { detail: "long" });
    const long = (deps.limiters ?? defaultLimiters).longRun.hit(`long:${g.user.id}`, g.now);
    if (!long.allowed) return labError("rate_limited", { retryAfterSec: long.retryAfterSec, detail: "long_runs" });
  }
  let requestId = deps.newId ? deps.newId() : globalThis.crypto.randomUUID();
  if (v.request_id !== undefined && v.request_id !== null) {
    if (typeof v.request_id !== "string" || !REQUEST_ID_RE.test(v.request_id)) return bad("bad_request_id");
    requestId = v.request_id;
  }
  const req: Record<string, unknown> = { v: 1, suite };
  if (v.label !== undefined && v.label !== null && v.label !== "") {
    const s = screenLabText(v.label, { min: 1, max: LAB_LIMITS.runLabelChars });
    if (!s.ok) return bad("bad_label");
    req.run_label = s.text;
  }
  const r = await submitJob(g.client, { requestId, kind: "eval", request: req });
  if (!r.ok) return labError(toLabCode(r.code), { detail: r.detail, retryAfterSec: r.retryAfterSec });
  return jsonResponse({ ok: true, job_id: r.jobId, status: r.status, deduped: r.deduped, queue_ahead: r.queueAhead, suite }, r.deduped ? 200 : 201);
}
