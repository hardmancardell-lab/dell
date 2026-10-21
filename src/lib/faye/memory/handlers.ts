/**
 * Request handlers for the Faye memory routes (src/app/api/faye/memory/**). The route files are one-liners that pass the real
 * dependencies; tests pass fakes. Route contracts are written out in team_audits/2026-10-20/faye-wp-f-report.md.
 *
 * Order of checks, always: feature flag (where the action needs it), cheap request checks (JSON content type and Origin on anything
 * that is not a GET), session and owner gate (src/lib/faye/access.ts), best-effort rate limit, "recent sign-in" for the heavy
 * actions, input validation and the redaction list, then the database (which re-checks the owner role and the redaction list).
 *
 * Every mutation is audited by the database in the same transaction (faye_memory_events: what happened and when, never the text).
 * A candidate refused by the redaction list in this file never leaves the server; only a counter ('dropped') is recorded.
 *
 * FAYE_MEMORY_ENABLED (default off). Off means "Faye neither learns nor uses memory": remember/add/edit/approve answer
 * `disabled` (remember answers handled:false so the message just goes to Faye as a question), and no pack is attached. The
 * privacy controls keep working while it is off, because an owner must always be able to see, export and delete what is stored:
 * list, export, delete one, undo, delete all, erase, pause and reject/retire.
 */
import { checkPostRequest, gateOwner, type Env, type GateClient, type GateUser } from "../access";
import { jsonResponse, readJsonBody } from "../mailbox/http";
import { UUID_RE } from "../mailbox/validate";
import { SlidingWindowLimiter } from "@/lib/access/rate-limit";
import { memoryEnabled, MEMORY_LIMITS, recentSessionMinutes } from "./config";
import { effectiveConfidence, isFaded } from "./decay";
import { memError, type MemoryErrorCode } from "./errors";
import { classifyTopics, extractSafePatterns, extractTickers, localClock, noteFromBody, parseCommand, proposeFromStats } from "./extract";
import { tokens } from "./rank";
import { dropMessage, screenMemoryText, type DropReason } from "./redact";
import { MemoryStore } from "./store";
import { MEMORY_CATEGORIES, type MemoryItem, type NoteCandidate } from "./types";

export interface MemoryLimiters {
  read: SlidingWindowLimiter;
  write: SlidingWindowLimiter;
  remember: SlidingWindowLimiter;
  heavy: SlidingWindowLimiter;
}

export interface MemoryDeps {
  env: Env;
  getClient: () => Promise<GateClient>;
  now?: () => number;
  limiters?: MemoryLimiters;
}

const defaultLimiters: MemoryLimiters = {
  read: new SlidingWindowLimiter(MEMORY_LIMITS.readPerMinute, 60_000),
  write: new SlidingWindowLimiter(MEMORY_LIMITS.writePerMinute, 60_000),
  remember: new SlidingWindowLimiter(MEMORY_LIMITS.rememberPerMinute, 60_000),
  heavy: new SlidingWindowLimiter(MEMORY_LIMITS.heavyPerTenMin, 10 * 60_000),
};

type LimiterKey = keyof MemoryLimiters;

interface Opts {
  /** Anything but a GET: JSON content type and same-origin are enforced. */
  mutating: boolean;
  /** Needs FAYE_MEMORY_ENABLED (it adds or approves something that Faye will learn or use). */
  needsFlag: boolean;
  /** Needs a recent sign-in (export, delete all, erase). */
  recent: boolean;
  limiter: LimiterKey;
}

interface Ready {
  ok: true;
  user: GateUser;
  store: MemoryStore;
  now: number;
}
type Gate = Ready | { ok: false; response: Response };

async function begin(request: Request, deps: MemoryDeps, o: Opts): Promise<Gate> {
  if (o.needsFlag && !memoryEnabled(deps.env)) return { ok: false, response: memError("disabled") };
  if (o.mutating) {
    const post = checkPostRequest(request);
    if (!post.ok) return { ok: false, response: memError(post.code) };
  }
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) return { ok: false, response: memError(gate.code) };
  const now = deps.now?.() ?? Date.now();
  const rate = (deps.limiters ?? defaultLimiters)[o.limiter].hit(`${o.limiter}:${gate.user.id}`, now);
  if (!rate.allowed) return { ok: false, response: memError("rate_limited", { retryAfterSec: rate.retryAfterSec, detail: "route" }) };
  if (o.recent && !isRecentSession(gate.user, now, deps.env)) return { ok: false, response: memError("reauth_required") };
  return { ok: true, user: gate.user, store: new MemoryStore(gate.client), now };
}

/**
 * "Recent session" check for export, delete all and erase (threat T7, session theft): the user's last SIGN-IN (auth.users.last_sign_in_at,
 * from auth.getUser(), which asks Supabase Auth rather than trusting the cookie) must be within FAYE_RECENT_SESSION_MINUTES
 * (default 30). A token refresh does not count as a sign-in. A missing or unreadable timestamp fails closed.
 */
export function isRecentSession(user: GateUser, now: number, env: Env): boolean {
  const raw = (user as GateUser & { last_sign_in_at?: string | null }).last_sign_in_at;
  if (typeof raw !== "string") return false;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return false;
  const age = now - t;
  return age >= -60_000 && age <= recentSessionMinutes(env) * 60_000;
}

function fail(r: { code: MemoryErrorCode; detail?: string }): Response {
  return memError(r.code, { detail: r.detail });
}

type Body = { ok: true; value: Record<string, unknown> } | { ok: false; response: Response };

async function readBody(request: Request, optional = false): Promise<Body> {
  if (optional && !request.body) return { ok: true, value: {} };
  const b = await readJsonBody(request, MEMORY_LIMITS.bodyBytes);
  if (!b.ok) return { ok: false, response: memError(b.code) };
  if (typeof b.value !== "object" || b.value === null || Array.isArray(b.value)) return { ok: false, response: memError("bad_request", { detail: "bad_payload" }) };
  return { ok: true, value: b.value as Record<string, unknown> };
}

/** What the browser sees of a note: known fields only, plus the decayed confidence and a "faded" flag. */
function publicItem(i: MemoryItem, now: number): Record<string, unknown> {
  const eff = effectiveConfidence(i, now);
  return {
    id: i.id,
    category: i.category,
    slot: i.slot,
    fact: i.fact,
    source: i.source,
    source_ref: i.source_ref,
    status: i.status,
    confidence: i.confidence,
    effective_confidence: Math.round(eff),
    faded: i.status === "approved" ? isFaded(i, now) : false,
    evidence_count: i.evidence_count,
    approved_by: i.approved_by,
    created_at: i.created_at,
    updated_at: i.updated_at,
    approved_at: i.approved_at,
    last_used_at: i.last_used_at,
    use_count: i.use_count,
    expires_at: i.expires_at,
    supersedes: i.supersedes,
    deleted_at: i.deleted_at,
  };
}

// --------------------------------------------------------------------------------------------------------------- list

/** GET /api/faye/memory[?status=proposed|approved|rejected|retired][&include_deleted=1] */
export async function handleList(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: false, needsFlag: false, recent: false, limiter: "read" });
  if (!g.ok) return g.response;
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  if (status !== null && !["proposed", "approved", "rejected", "retired"].includes(status)) return memError("bad_request", { detail: "bad_status" });
  const includeDeleted = url.searchParams.get("include_deleted") === "1";
  const r = await g.store.list(includeDeleted);
  if (!r.ok) return fail(r);
  const all = r.data.items;
  const counts = { proposed: 0, approved: 0, rejected: 0, retired: 0 };
  for (const i of all) if (!i.deleted_at && i.status in counts) counts[i.status] += 1;
  const items = all.filter((i) => (status === null || i.status === status) && (includeDeleted || !i.deleted_at)).map((i) => publicItem(i, g.now));
  return jsonResponse({ ok: true, enabled: memoryEnabled(deps.env), settings: r.data.settings, counts, items });
}

// --------------------------------------------------------------------------------------------------------------- add / edit

const isCategory = (x: unknown): x is NoteCandidate["category"] => typeof x === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(x);

async function refuse(g: Ready, reason: DropReason, source: string): Promise<Response> {
  await g.store.noteDropped(1, source);
  return memError("text_rejected", { detail: reason });
}

/** POST /api/faye/memory   { fact, category? }  -> a note the owner typed in About me; saved already approved (source "taught"). */
export async function handleAdd(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: true, recent: false, limiter: "write" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  if (typeof b.value.fact !== "string") return memError("bad_request", { detail: "bad_fact" });
  if (b.value.category !== undefined && !isCategory(b.value.category)) return memError("bad_request", { detail: "bad_category" });
  const made = noteFromBody(b.value.fact);
  if (!made) return memError("bad_request", { detail: "bad_fact" });
  const s = screenMemoryText(made.fact);
  if (!s.ok) return refuse(g, s.reason, "taught");
  const category = isCategory(b.value.category) ? b.value.category : made.category;
  const r = await g.store.add({ category, slot: made.slot, fact: s.text, source: "taught", sourceRef: "about_me", confidence: 95 }, "approved");
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, id: r.data.id, duplicate: r.data.duplicate, superseded: r.data.superseded, item: r.data.item ? publicItem(r.data.item, g.now) : null }, r.data.duplicate ? 200 : 201);
}

/** PATCH /api/faye/memory/{id}   { fact?, category? } */
export async function handleEdit(request: Request, id: string, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: true, recent: false, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return memError("bad_request", { detail: "bad_id" });
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const hasFact = b.value.fact !== undefined;
  const hasCat = b.value.category !== undefined;
  if (!hasFact && !hasCat) return memError("bad_request", { detail: "nothing_to_change" });
  if (hasCat && !isCategory(b.value.category)) return memError("bad_request", { detail: "bad_category" });
  let fact: string | null = null;
  if (hasFact) {
    if (typeof b.value.fact !== "string") return memError("bad_request", { detail: "bad_fact" });
    const s = screenMemoryText(b.value.fact);
    if (!s.ok) return refuse(g, s.reason, "taught");
    fact = s.text;
  }
  const r = await g.store.edit(id, fact, hasCat ? (b.value.category as string) : null);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, item: r.data.item ? publicItem(r.data.item, g.now) : null });
}

// --------------------------------------------------------------------------------------------------------------- delete / decide

/** DELETE /api/faye/memory/{id}[?permanent=1]   (send Content-Type: application/json; the body may be empty or {}) */
export async function handleDelete(request: Request, id: string, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: false, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return memError("bad_request", { detail: "bad_id" });
  const permanent = new URL(request.url).searchParams.get("permanent") === "1";
  const r = await g.store.remove(id, permanent);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, permanent: r.data.permanent, undo_minutes: r.data.undoMinutes });
}

const DECISIONS = ["approve", "reject", "retire", "revive", "undelete"] as const;

/** POST /api/faye/memory/{id}/decision   { decision: "approve" | "reject" | "retire" | "revive" | "undelete" } */
export async function handleDecision(request: Request, id: string, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: false, limiter: "write" });
  if (!g.ok) return g.response;
  if (!UUID_RE.test(id)) return memError("bad_request", { detail: "bad_id" });
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const d = b.value.decision;
  if (typeof d !== "string" || !(DECISIONS as readonly string[]).includes(d)) return memError("bad_request", { detail: "bad_decision" });
  // approve and revive make a note usable by Faye, so they need the flag; reject, retire and undelete never add anything
  if ((d === "approve" || d === "revive") && !memoryEnabled(deps.env)) return memError("disabled");
  if (d === "undelete") {
    const r = await g.store.restore(id);
    if (!r.ok) return fail(r);
    return jsonResponse({ ok: true, item: r.data.item ? publicItem(r.data.item, g.now) : null });
  }
  const r = await g.store.decide(id, d as "approve" | "reject" | "retire" | "revive");
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, item: r.data.item ? publicItem(r.data.item, g.now) : null, superseded: r.data.superseded });
}

// --------------------------------------------------------------------------------------------------------------- heavy actions

function confirmed(body: Record<string, unknown>): boolean {
  return body.confirm === "DELETE";
}

/** POST /api/faye/memory/delete-all   { confirm: "DELETE" }   - needs a recent sign-in. Deletes every note and usage count. */
export async function handleDeleteAll(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: true, limiter: "heavy" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  if (!confirmed(b.value)) return memError("bad_request", { detail: "confirm_required" });
  const r = await g.store.deleteAll();
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, deleted: r.data.deleted });
}

/** POST /api/faye/memory/erase   { confirm: "DELETE" }   - needs a recent sign-in. Everything Faye holds about the person (memory, jobs, lab). */
export async function handleErase(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: true, limiter: "heavy" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  if (!confirmed(b.value)) return memError("bad_request", { detail: "confirm_required" });
  const r = await g.store.erase();
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, deleted: r.data.deleted });
}

/** POST /api/faye/memory/export   {}   - needs a recent sign-in. A JSON download of everything the memory holds. */
export async function handleExport(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: true, limiter: "heavy" });
  if (!g.ok) return g.response;
  const b = await readBody(request, true);
  if (!b.ok) return b.response;
  const r = await g.store.exportAll();
  if (!r.ok) return fail(r);
  const day = new Date(g.now).toISOString().slice(0, 10);
  const rest: Record<string, unknown> = { ...r.data };
  delete rest.ok;
  delete rest.exported_at;
  const doc = { format: "faye-memory-export", version: 1, exported_at: new Date(g.now).toISOString(), ...rest };
  return jsonResponse(doc, 200, { "content-disposition": `attachment; filename="faye-memory-${day}.json"` });
}

// --------------------------------------------------------------------------------------------------------------- settings

/** POST /api/faye/memory/settings   { learning_paused?: boolean, show_used_notes?: boolean } - pause or resume learning takes effect at once. */
export async function handleSettings(request: Request, deps: MemoryDeps): Promise<Response> {
  const g = await begin(request, deps, { mutating: true, needsFlag: false, recent: false, limiter: "write" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  const patch: { learning_paused?: boolean; show_used_notes?: boolean } = {};
  for (const k of ["learning_paused", "show_used_notes"] as const) {
    if (b.value[k] === undefined) continue;
    if (typeof b.value[k] !== "boolean") return memError("bad_request", { detail: "bad_setting" });
    patch[k] = b.value[k] as boolean;
  }
  if (Object.keys(patch).length === 0) return memError("bad_request", { detail: "nothing_to_change" });
  const r = await g.store.updateSettings(patch);
  if (!r.ok) return fail(r);
  return jsonResponse({ ok: true, settings: r.data.settings });
}

// --------------------------------------------------------------------------------------------------------------- remember

const REPLY = {
  saved: (fact: string) => `Saved: ${fact} Undo?`,
  updated: (fact: string) => `Updated: ${fact} Undo?`,
  already: "I already have that note.",
  forgotten: "Gone. You can undo that for a few minutes in About me.",
  nothing: "Tell me what to remember, for example: remember that I like the number first.",
  ambiguous: "I could not tell which note you mean. Open About me to pick it.",
  wipe: "I will not wipe my notes from a chat message. Open About me and choose Delete all.",
  full: "I am holding as many notes as I can. Delete a few in About me first.",
};

interface RememberReply {
  ok: true;
  handled: boolean;
  enabled: boolean;
  action?: "saved" | "updated" | "duplicate" | "refused" | "forgotten" | "ambiguous" | "nothing" | "wipe_refused";
  reply?: string;
  item?: Record<string, unknown> | null;
  undo?: { id: string; decision?: "undelete" };
  reason?: DropReason | "limit_reached";
  proposed?: number;
  dropped?: number;
  learning_paused?: boolean;
}

/**
 * POST /api/faye/memory/remember   { message, from: "typed", tz? }
 *
 * Call this with every message the owner TYPES, before queuing a chat job. `from: "typed"` is required: only the owner's own typed words
 * may be passed here, never model output, tool output or page text.
 *  - "remember that ..." / "that is wrong, I actually ..." saves at once (handled: true, reply: text to show instead of asking Faye).
 *  - "forget that ..." removes the one note it clearly matches (soft delete, undo possible). "forget everything" is refused here on purpose.
 *  - Anything else (handled: false): counts the topic, tickers and hour (numbers only) and proposes notes from safe patterns and
 *    from the counts - unless learning is paused, in which case nothing at all is extracted or proposed.
 * With FAYE_MEMORY_ENABLED off this answers { handled: false, enabled: false } and does nothing.
 */
export async function handleRemember(request: Request, deps: MemoryDeps): Promise<Response> {
  if (!memoryEnabled(deps.env)) return jsonResponse({ ok: true, handled: false, enabled: false });
  const g = await begin(request, deps, { mutating: true, needsFlag: true, recent: false, limiter: "remember" });
  if (!g.ok) return g.response;
  const b = await readBody(request);
  if (!b.ok) return b.response;
  if (b.value.from !== "typed") return memError("bad_request", { detail: "from_required" });
  if (typeof b.value.message !== "string" || b.value.message.length === 0 || b.value.message.length > 4000) return memError("bad_request", { detail: "bad_message" });
  const message = b.value.message;

  const cmd = parseCommand(message);
  const out: RememberReply = { ok: true, handled: false, enabled: true };

  if (cmd.kind === "forget_all") return jsonResponse({ ...out, handled: true, action: "wipe_refused", reply: REPLY.wipe });

  if (cmd.kind === "remember" || cmd.kind === "correct") {
    const made = noteFromBody(cmd.body);
    if (!made) return jsonResponse({ ...out, handled: true, action: "nothing", reply: REPLY.nothing });
    const s = screenMemoryText(made.fact);
    if (!s.ok) {
      await g.store.noteDropped(1, "stated");
      return jsonResponse({ ...out, handled: true, action: "refused", reason: s.reason, reply: dropMessage(s.reason) });
    }
    const r = await g.store.add(
      { category: made.category, slot: made.slot, fact: s.text, source: "stated", sourceRef: cmd.kind === "correct" ? "cmd:correct" : "cmd:remember", confidence: 95 },
      "approved",
    );
    if (!r.ok) {
      if (r.code === "text_rejected") return jsonResponse({ ...out, handled: true, action: "refused", reason: (r.detail as DropReason) ?? "instruction", reply: dropMessage((r.detail as DropReason) ?? "instruction") });
      if (r.code === "limit_reached") return jsonResponse({ ...out, handled: true, action: "refused", reason: "limit_reached", reply: REPLY.full });
      return fail(r);
    }
    const item = r.data.item ? publicItem(r.data.item, g.now) : null;
    if (r.data.duplicate) return jsonResponse({ ...out, handled: true, action: "duplicate", reply: REPLY.already, item });
    return jsonResponse({
      ...out,
      handled: true,
      action: r.data.superseded || cmd.kind === "correct" ? "updated" : "saved",
      reply: r.data.superseded || cmd.kind === "correct" ? REPLY.updated(s.text) : REPLY.saved(s.text),
      item,
      undo: { id: r.data.id },
    });
  }

  if (cmd.kind === "forget") {
    const list = await g.store.list(false);
    if (!list.ok) return fail(list);
    const target = tokens(cmd.target);
    const scored = list.data.items
      .filter((i) => !i.deleted_at && i.status !== "rejected")
      .map((i) => {
        const it = tokens(i.fact);
        let hit = 0;
        for (const w of target) if (it.has(w)) hit++;
        return { i, s: target.size === 0 ? 0 : hit / target.size };
      })
      .sort((a, b2) => b2.s - a.s);
    const best = scored[0];
    if (!best || best.s < 0.6 || (scored[1] && scored[1].s >= best.s)) return jsonResponse({ ...out, handled: true, action: "ambiguous", reply: REPLY.ambiguous });
    const r = await g.store.remove(best.i.id, false);
    if (!r.ok) return fail(r);
    return jsonResponse({ ...out, handled: true, action: "forgotten", reply: REPLY.forgotten, undo: { id: best.i.id, decision: "undelete" } });
  }

  // ---- not a command: learn from the owner's own sentence, unless learning is paused
  const clock = localClock(g.now, b.value.tz);
  const topics: Record<string, number> = {};
  for (const t of classifyTopics(message)) topics[t] = 1;
  const tickers: Record<string, number> = {};
  for (const t of extractTickers(message)) tickers[t] = 1;
  const bump = await g.store.usageBump(clock.day, topics, tickers, clock.hour);
  if (!bump.ok) {
    if (bump.code === "paused") return jsonResponse({ ...out, learning_paused: true, proposed: 0 });
    if (bump.code === "unavailable") return fail(bump);
    // a counts problem must never stop the owner's message: carry on without observed counters
  }

  let proposed = 0;
  let dropped = 0;
  const propose = async (c: NoteCandidate): Promise<void> => {
    const s = screenMemoryText(c.fact);
    if (!s.ok) {
      dropped += 1;
      return;
    }
    const r = await g.store.add({ ...c, fact: s.text }, "proposed");
    if (r.ok && !r.data.duplicate) proposed += 1;
  };
  for (const c of extractSafePatterns(message)) await propose(c);

  const questionsToday = bump.ok && typeof bump.data.questions === "number" ? bump.data.questions : 0;
  if (bump.ok && (questionsToday === 1 || questionsToday % 5 === 0)) {
    const recent = await g.store.usageRecent(30);
    if (recent.ok) for (const c of proposeFromStats(recent.data.rows, clock.tz)) await propose(c);
  }
  if (dropped > 0) await g.store.noteDropped(dropped, "stated");
  return jsonResponse({ ...out, proposed, ...(dropped > 0 ? { dropped } : {}) });
}
