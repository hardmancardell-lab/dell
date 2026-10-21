/**
 * Browser-side helpers for Faye's memory ("About me"), package WP-C1b.
 *
 * Talks ONLY to this app's own /api/faye/memory/* routes (same origin, cookie session). No Supabase calls, no keys.
 * The route contracts are written out in team_audits/2026-10-20/faye-wp-f-report.md section 2.
 *
 * Rules this file keeps:
 *  - Every note and every reply is plain text. Nothing here builds HTML.
 *  - Nothing here throws to the caller: every function returns a result object, so a failed call never breaks the chat.
 *  - Friendly sentences are written HERE from the error code (grade 8 or lower). A server sentence is never shown as is.
 *  - Note text is never logged.
 */

export const MEMORY_BASE_URL = "/api/faye/memory";

export const MEMORY_CATEGORIES = ["style", "preference", "habit", "tendency", "goal", "context", "avoid"] as const;
export type MemCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemSource = "stated" | "taught" | "observed" | "proposed_by_model";
export type MemStatus = "proposed" | "approved" | "rejected" | "retired";

/** A note as the screen uses it (the route's snake_case fields, checked and trimmed). */
export interface MemItem {
  id: string;
  category: MemCategory;
  slot: string | null;
  fact: string;
  source: MemSource;
  status: MemStatus;
  confidence: number;
  effectiveConfidence: number;
  faded: boolean;
  evidenceCount: number;
  createdAt: string | null;
  approvedAt: string | null;
  lastUsedAt: string | null;
  useCount: number;
  supersedes: string | null;
  deletedAt: string | null;
}

export interface MemSettings {
  learningPaused: boolean;
  showUsedNotes: boolean;
}

export interface MemList {
  /** FAYE_MEMORY_ENABLED on the server. Off: Faye neither learns nor uses notes; privacy controls still work. */
  enabled: boolean;
  settings: MemSettings;
  counts: { proposed: number; approved: number; rejected: number; retired: number };
  items: MemItem[];
}

export type MemFail = { ok: false; code: string; status: number; message: string; detail?: string };
export type MemResult<T> = { ok: true; data: T } | MemFail;

export type Decision = "approve" | "reject" | "retire" | "revive" | "undelete";

export interface ExportFile {
  filename: string;
  text: string;
  count: number;
}

export interface MemoryClient {
  list(opts?: { includeDeleted?: boolean; signal?: AbortSignal }): Promise<MemResult<MemList>>;
  add(fact: string, category?: MemCategory): Promise<MemResult<{ item: MemItem | null; duplicate: boolean }>>;
  edit(id: string, patch: { fact?: string; category?: MemCategory }): Promise<MemResult<{ item: MemItem | null }>>;
  remove(id: string): Promise<MemResult<{ undoMinutes: number }>>;
  decide(id: string, decision: Decision): Promise<MemResult<{ item: MemItem | null }>>;
  setSettings(patch: { learningPaused?: boolean; showUsedNotes?: boolean }): Promise<MemResult<{ settings: MemSettings }>>;
  exportAll(): Promise<MemResult<ExportFile>>;
  deleteAll(): Promise<MemResult<{ deleted: number }>>;
  erase(): Promise<MemResult<{ deleted: number }>>;
  remember(message: string, signal?: AbortSignal): Promise<RememberOutcome | null>;
}

// ------------------------------------------------------------------------------------------------ plain-language copy

export const SAFETY_WINDOW_MINUTES = 30;
export const DEFAULT_UNDO_MINUTES = 10;

const ERROR_TEXT: Record<string, string> = {
  reauth_required: `For your safety, Faye needs you to sign in again first. It must be within the last ${SAFETY_WINDOW_MINUTES} minutes.`,
  disabled: "Notes are not turned on for answers yet, so I could not do that. You can still look, export and delete.",
  limit_reached: "You have reached the limit of notes. Delete a few to add more.",
  conflict: "That change clashes with a note you already have.",
  paused: "Learning is paused. Turn it back on to let Faye suggest notes.",
  auth_required: "Your sign-in ran out. Sign in again, then try once more.",
  not_allowed: "Faye is not available for this account.",
  rate_limited: "That was a lot at once. Wait a moment and try again.",
  not_found: "That note is already gone.",
  unavailable: "Notes are not ready yet. Try again later.",
  too_large: "That is too long. Make it shorter.",
  bad_request: "That did not work. Check the note and try again.",
  network: "I could not reach the app. Nothing was changed. Check your connection and try again.",
  server_error: "Something went wrong. Nothing was changed. Try again.",
};

const REJECT_TEXT: Record<string, string> = {
  instruction: "Notes are about you, not rules for Faye. Faye did not save that one.",
  secret: "That looks like a key, a password or an account number. Faye never keeps those.",
  credential: "That looks like a key, a password or an account number. Faye never keeps those.",
  card: "That looks like a key, a password or an account number. Faye never keeps those.",
  account: "That looks like a key, a password or an account number. Faye never keeps those.",
  ssn: "That looks like a key, a password or an account number. Faye never keeps those.",
  money: "Faye does not keep exact amounts, balances or share counts.",
  position: "Faye does not keep exact amounts, balances or share counts.",
  contact: "Faye does not keep contact details or addresses.",
  address: "Faye does not keep contact details or addresses.",
  sensitive_topic: "Faye does not keep health, legal or similar private details.",
  length: "A note must be between 3 and 200 characters.",
  empty: "Write a few words first.",
  markup: "Use plain words only. Faye does not keep links or code.",
  control: "Use plain words only.",
};

/** The sentence for a failed call. Built from the code (and the rule name for a refused note), never from the server's own text. */
export function friendlyError(code: string, detail?: string): string {
  if (code === "text_rejected") return (detail && REJECT_TEXT[detail]) || "That note was not saved because it breaks the rules for what Faye may keep.";
  return ERROR_TEXT[code] ?? ERROR_TEXT.server_error;
}

export const CATEGORY_LABEL: Record<MemCategory, string> = {
  style: "How you like answers",
  preference: "What you prefer",
  habit: "Your habits",
  tendency: "Your tendencies",
  goal: "Your goals",
  context: "About your work",
  avoid: "Things to avoid",
};

export const SOURCE_LABEL: Record<MemSource, string> = {
  stated: "Said by you",
  taught: "Added by you in About me",
  observed: "Noticed from your habits",
  proposed_by_model: "Suggested by Faye",
};

export function confidenceLabel(c: number): string {
  const n = Math.max(0, Math.min(100, Math.round(c)));
  return `${n}% sure`;
}

// ------------------------------------------------------------------------------------------------ parsing (never trust the shape)

const UUID_LIKE = /^[0-9a-fA-F-]{32,40}$/;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
const num = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);
const SOURCES: readonly string[] = ["stated", "taught", "observed", "proposed_by_model"];
const STATUSES: readonly string[] = ["proposed", "approved", "rejected", "retired"];

export function parseItem(x: unknown): MemItem | null {
  if (!isObj(x)) return null;
  const id = str(x.id);
  const fact = str(x.fact);
  if (!id || !UUID_LIKE.test(id) || fact === null) return null;
  const category = (MEMORY_CATEGORIES as readonly string[]).includes(String(x.category)) ? (x.category as MemCategory) : "context";
  const source = SOURCES.includes(String(x.source)) ? (x.source as MemSource) : "observed";
  const status = STATUSES.includes(String(x.status)) ? (x.status as MemStatus) : "proposed";
  return {
    id,
    category,
    slot: str(x.slot),
    fact: fact.slice(0, 400),
    source,
    status,
    confidence: num(x.confidence),
    effectiveConfidence: num(x.effective_confidence, num(x.confidence)),
    faded: x.faded === true,
    evidenceCount: num(x.evidence_count),
    createdAt: str(x.created_at),
    approvedAt: str(x.approved_at),
    lastUsedAt: str(x.last_used_at),
    useCount: num(x.use_count),
    supersedes: str(x.supersedes),
    deletedAt: str(x.deleted_at),
  };
}

function parseSettings(x: unknown): MemSettings {
  const o = isObj(x) ? x : {};
  return { learningPaused: o.learning_paused === true, showUsedNotes: o.show_used_notes !== false };
}

function parseList(body: Record<string, unknown>): MemList {
  const items = Array.isArray(body.items) ? body.items.map(parseItem).filter((i): i is MemItem => i !== null) : [];
  const c = isObj(body.counts) ? body.counts : {};
  return {
    enabled: body.enabled === true,
    settings: parseSettings(body.settings),
    counts: { proposed: num(c.proposed), approved: num(c.approved), retired: num(c.retired), rejected: num(c.rejected) },
    items,
  };
}

// ------------------------------------------------------------------------------------------------ the fetch client

export interface ClientDeps {
  fetchImpl?: typeof fetch;
  /** Milliseconds before a normal call gives up. */
  timeoutMs?: number;
  /** Milliseconds before the "remember" call gives up (it sits in front of the chat, so it must be short). */
  rememberTimeoutMs?: number;
  now?: () => number;
  /** IANA zone for the hour-of-day counter. Default: the browser's. */
  timeZone?: () => string | undefined;
}

interface Raw {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
  text: string;
  disposition: string | null;
  loginRedirect: boolean;
}

function failFrom(code: string, status: number, detail?: string): MemFail {
  return { ok: false, code, status, detail, message: friendlyError(code, detail) };
}

export function createMemoryClient(deps: ClientDeps = {}): MemoryClient {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((...a) => fetch(...a));
  const timeoutMs = deps.timeoutMs ?? 15_000;
  const rememberMs = deps.rememberTimeoutMs ?? 4_000;
  const now = deps.now ?? (() => Date.now());

  async function raw(method: string, path: string, body: unknown, ms: number, signal?: AbortSignal): Promise<Raw | MemFail> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    const onAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) ac.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const init: RequestInit = { method, credentials: "same-origin", cache: "no-store", signal: ac.signal };
      if (method !== "GET") {
        init.headers = { "Content-Type": "application/json" };
        init.body = JSON.stringify(body ?? {});
      }
      const res = await fetchImpl(MEMORY_BASE_URL + path, init);
      let loginRedirect = false;
      try {
        loginRedirect = !!res.redirected && new URL(res.url, "http://x").pathname.startsWith("/login");
      } catch {
        loginRedirect = false;
      }
      const text = await res.text();
      let parsed: Record<string, unknown> | null = null;
      try {
        const j = JSON.parse(text);
        parsed = isObj(j) ? j : null;
      } catch {
        parsed = null;
      }
      return { ok: res.ok, status: res.status, body: parsed, text, disposition: res.headers?.get?.("content-disposition") ?? null, loginRedirect };
    } catch {
      return failFrom("network", 0);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  const isFail = (r: Raw | MemFail): r is MemFail => (r as MemFail).ok === false && "code" in r;

  function errorOf(r: Raw): MemFail {
    const b = r.body;
    const code =
      b && typeof b.code === "string" && /^[a-z_]{1,32}$/.test(b.code)
        ? b.code
        : r.loginRedirect || r.status === 401
          ? "auth_required"
          : r.status === 403
            ? "not_allowed"
            : r.status === 429
              ? "rate_limited"
              : r.status === 404
                ? "not_found"
                : r.status === 400
                  ? "bad_request"
                  : r.status === 413
                    ? "too_large"
                    : r.status === 503
                      ? "unavailable"
                      : "server_error";
    const detail = b && typeof b.detail === "string" && /^[a-z_]{1,32}$/.test(b.detail) ? b.detail : undefined;
    return failFrom(code, r.status, detail);
  }

  async function run<T>(method: string, path: string, body: unknown, pick: (b: Record<string, unknown>, r: Raw) => T, opts: { ms?: number; signal?: AbortSignal } = {}): Promise<MemResult<T>> {
    const r = await raw(method, path, body, opts.ms ?? timeoutMs, opts.signal);
    if (isFail(r)) return r;
    if (r.loginRedirect) return failFrom("auth_required", r.status);
    if (!r.ok || !r.body || r.body.ok === false) return errorOf(r);
    return { ok: true, data: pick(r.body, r) };
  }

  const itemOf = (b: Record<string, unknown>) => (b.item === undefined || b.item === null ? null : parseItem(b.item));

  return {
    list(opts = {}) {
      return run("GET", opts.includeDeleted ? "?include_deleted=1" : "", undefined, (b) => parseList(b), { signal: opts.signal });
    },
    add(fact, category) {
      return run("POST", "", category ? { fact, category } : { fact }, (b) => ({ item: itemOf(b), duplicate: b.duplicate === true }));
    },
    edit(id, patch) {
      return run("PATCH", `/${encodeURIComponent(id)}`, patch, (b) => ({ item: itemOf(b) }));
    },
    remove(id) {
      return run("DELETE", `/${encodeURIComponent(id)}`, {}, (b) => ({ undoMinutes: Math.max(1, Math.min(60, Math.round(num(b.undo_minutes, DEFAULT_UNDO_MINUTES)))) }));
    },
    decide(id, decision) {
      return run("POST", `/${encodeURIComponent(id)}/decision`, { decision }, (b) => ({ item: itemOf(b) }));
    },
    setSettings(patch) {
      const body: Record<string, boolean> = {};
      if (patch.learningPaused !== undefined) body.learning_paused = patch.learningPaused;
      if (patch.showUsedNotes !== undefined) body.show_used_notes = patch.showUsedNotes;
      return run("POST", "/settings", body, (b) => ({ settings: parseSettings(b.settings) }));
    },
    async exportAll() {
      // The export route answers with a JSON file (Content-Disposition: attachment). Error answers are JSON with ok:false.
      const r = await raw("POST", "/export", {}, timeoutMs);
      if (isFail(r)) return r;
      if (r.loginRedirect) return failFrom("auth_required", r.status);
      if (!r.ok || !r.body || r.body.ok === false) return errorOf(r);
      const items = Array.isArray(r.body.items) ? r.body.items.length : 0;
      const m = r.disposition ? /filename="([A-Za-z0-9._-]{1,80})"/.exec(r.disposition) : null;
      const filename = m ? m[1] : `faye-memory-${new Date(now()).toISOString().slice(0, 10)}.json`;
      return { ok: true, data: { filename, text: r.text, count: items } };
    },
    deleteAll() {
      return run("POST", "/delete-all", { confirm: "DELETE" }, (b) => ({ deleted: sumDeleted(b.deleted) }));
    },
    erase() {
      return run("POST", "/erase", { confirm: "DELETE" }, (b) => ({ deleted: sumDeleted(b.deleted) }));
    },
    async remember(message, signal) {
      try {
        let tz: string | undefined;
        try {
          tz = deps.timeZone ? deps.timeZone() : Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch {
          tz = undefined;
        }
        const body: Record<string, unknown> = { message, from: "typed" };
        if (tz && /^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) body.tz = tz;
        const r = await raw("POST", "/remember", body, rememberMs, signal);
        if (isFail(r) || r.loginRedirect || !r.ok || !r.body || r.body.ok === false) return null;
        return parseRemember(r.body);
      } catch {
        return null;
      }
    },
  };
}

function sumDeleted(x: unknown): number {
  if (!isObj(x)) return 0;
  let n = 0;
  for (const v of Object.values(x)) n += num(v);
  return n;
}

// ------------------------------------------------------------------------------------------------ remember (the chat hook)

export type RememberAction = "saved" | "updated" | "duplicate" | "refused" | "forgotten" | "ambiguous" | "nothing" | "wipe_refused";
const REMEMBER_ACTIONS: readonly string[] = ["saved", "updated", "duplicate", "refused", "forgotten", "ambiguous", "nothing", "wipe_refused"];

export interface RememberOutcome {
  /** True: show `reply` as Faye's line and do NOT queue a chat job. */
  handled: boolean;
  enabled: boolean;
  action?: RememberAction;
  reply?: string;
  /** Saved or updated: remove the note again. Forgotten: bring it back with decision "undelete". */
  undo?: { id: string; decision?: "undelete" };
  /** Notes proposed from this message (waiting for the owner's OK). */
  proposed: number;
  learningPaused: boolean;
}

export function parseRemember(b: Record<string, unknown>): RememberOutcome {
  const action = typeof b.action === "string" && REMEMBER_ACTIONS.includes(b.action) ? (b.action as RememberAction) : undefined;
  const reply = typeof b.reply === "string" ? b.reply.slice(0, 600) : undefined;
  let undo: RememberOutcome["undo"];
  if (isObj(b.undo) && typeof b.undo.id === "string" && UUID_LIKE.test(b.undo.id)) {
    undo = b.undo.decision === "undelete" ? { id: b.undo.id, decision: "undelete" } : { id: b.undo.id };
  }
  const handled = b.handled === true && !!reply;
  return {
    handled,
    enabled: b.enabled === true,
    action,
    reply,
    undo,
    proposed: Math.max(0, Math.min(99, Math.round(num(b.proposed)))),
    learningPaused: b.learning_paused === true,
  };
}

/** The small line under the owner's message after the remember call. Empty when there is nothing to say. */
export function rememberNote(o: RememberOutcome | null): string {
  if (!o || !o.enabled) return "";
  if (o.handled) return o.action === "saved" ? "Saved a note." : o.action === "updated" ? "Updated a note." : "";
  if (o.proposed > 0) return o.proposed === 1 ? "Proposed a note for you to approve." : `Proposed ${o.proposed} notes for you to approve.`;
  return "";
}

// ------------------------------------------------------------------------------------------------ pure view helpers

export function groupByCategory(items: readonly MemItem[]): { category: MemCategory; items: MemItem[] }[] {
  const out: { category: MemCategory; items: MemItem[] }[] = [];
  for (const category of MEMORY_CATEGORIES) {
    const list = items.filter((i) => i.category === category);
    if (list.length) out.push({ category, items: list });
  }
  return out;
}

/** Whole seconds left in the undo window (0 when it has passed or the time is unreadable). */
export function undoSecondsLeft(deletedAt: string | null, undoMinutes: number, nowMs: number): number {
  if (!deletedAt) return 0;
  const t = Date.parse(deletedAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t + undoMinutes * 60_000 - nowMs) / 1000));
}

export function undoLabel(seconds: number): string {
  if (seconds <= 0) return "Time to undo has passed";
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "You can undo this for about 1 more minute" : `You can undo this for about ${m} more minutes`;
}

/** Starts a file download of `text` in the browser. Returns false when the browser would not allow it. */
export function saveTextFile(filename: string, text: string, doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  try {
    if (!doc) return false;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
