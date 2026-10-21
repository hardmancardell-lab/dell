/**
 * Faye transport (WP-C1): how the chat widget talks to Faye.
 *
 * One interface, two implementations, chosen by NEXT_PUBLIC_FAYE_TRANSPORT:
 *
 *   local    (default)  today's behaviour exactly: the browser talks to Faye's loopback server on this computer
 *                       (127.0.0.1:7810) and reads her Server-Sent Events.
 *   mailbox             the browser talks to this app's own /api/faye/* routes. The question goes into a job in the
 *                       database, the worker (Oracle VM or the owner's PC) answers it, and the browser long-polls for
 *                       the text. The wire format is FAYE_MAILBOX_CONTRACT.md v1.0 section 3 (frozen). Nothing here
 *                       calls Supabase directly.
 *
 * Both transports hand the rest of the widget the SAME normalised events and the SAME result shape, so every guard sits
 * after the transport and is shared: the plan sanitiser, the read-only tool allowlist, and the paper-order validation
 * (see runQuestion below). A forged answer from either side meets the same checks.
 *
 * Everything that touches the network takes an injectable fetch, clock and sleep, so the tests run a fake mailbox with
 * no network and no real waiting. All text from Faye is plain text: the widget renders it as React text nodes only.
 *
 * Roll back: set NEXT_PUBLIC_FAYE_TRANSPORT=local (or remove it). Anything other than the exact word "mailbox" is local.
 */
import { validateProposedAction, type ValidatedAction } from "./action-validation";
import { MAX_CALLS_PER_RUN, MAX_PLAN_TURNS, SseParser, sanitizePlanCalls } from "./plan-guards";

// ------------------------------------------------------------------ which transport

export type TransportKind = "local" | "mailbox";

/** Only the exact word "mailbox" turns the mailbox on. Unset, empty, "Local", "true", a typo: all local. */
export function resolveTransportKind(raw: string | undefined | null): TransportKind {
  return typeof raw === "string" && raw.trim().toLowerCase() === "mailbox" ? "mailbox" : "local";
}

/** Read once; Next inlines the literal expression at build time. */
export const TRANSPORT_KIND: TransportKind = resolveTransportKind(process.env.NEXT_PUBLIC_FAYE_TRANSPORT);

// ------------------------------------------------------------------ shared types

export type TurnKind = "generated" | "conduct" | "guardrail" | "action_proposal" | "tool_calls" | "final";
const TURN_KINDS: readonly string[] = ["generated", "conduct", "guardrail", "action_proposal", "tool_calls", "final"];
const asKind = (v: unknown): TurnKind => (typeof v === "string" && TURN_KINDS.includes(v) ? (v as TurnKind) : "generated");

/** What a transport reports about Faye before a question is asked. */
export interface TransportStatus {
  /**
   * available    ready to answer
   * offline      the owner may use Faye but nobody is home (mailbox: no worker contact; local: lost mid-session)
   * not_allowed  signed in (or not) but not the owner (mailbox only)
   * hidden       Faye is switched off or not installed here: draw nothing (today's behaviour when she is unreachable)
   */
  state: "available" | "offline" | "not_allowed" | "hidden";
  usedToday?: number;
  dailyCap?: number;
  queueDepth?: number;
  questionChars?: number;
}

/** The final result of one turn, the same shape from either transport. */
export interface TurnResult {
  kind: TurnKind;
  /** The complete final text. Authoritative: it replaces anything streamed. */
  text: string;
  calls?: unknown;
  state?: unknown;
  action?: unknown;
  provenance?: Record<string, unknown> | null;
  /** True when the output guard replaced the text with the scripted decline. */
  retracted: boolean;
  /** Opaque handle the next `continue` turn needs (the mailbox job id). Local has none. */
  ref?: string;
}

export interface TurnHandlers {
  onChunk?(delta: string): void;
  /** Replace the WHOLE message text with `text` (the scripted decline). */
  onRetract?(text: string): void;
  /** The job is waiting for Faye to pick it up. position 0 = next. */
  onQueue?(position: number | null): void;
  /** Faye picked the job up and is working. */
  onRunning?(): void;
}

export interface FayeTransport {
  readonly kind: TransportKind;
  status(opts?: { wake?: boolean; signal?: AbortSignal }): Promise<TransportStatus>;
  chat(req: { question: string; state: unknown }, h: TurnHandlers, signal?: AbortSignal): Promise<TurnResult>;
  continue(req: { state: unknown; results: Record<string, ToolResult>; parentRef?: string }, h: TurnHandlers, signal?: AbortSignal): Promise<TurnResult>;
}

// ------------------------------------------------------------------ errors and plain-language messages

export type FayeErrorCode =
  | "faye_offline" | "rate_limited" | "too_large" | "worker_lost" | "expired" | "not_allowed" // contract section 8
  | "auth_required" | "bad_request" | "not_found" | "disabled" | "generation_failed" | "server_error" | "unavailable" // also stable
  | "unreachable" | "cancelled"; // client side only

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "faye_offline", "rate_limited", "too_large", "worker_lost", "expired", "not_allowed",
  "auth_required", "bad_request", "not_found", "disabled", "generation_failed", "server_error", "unavailable",
]);

/** The contract's friendly sentences (section 8), kept as local constants so the widget never depends on server text. */
export const FAYE_MESSAGES: Record<FayeErrorCode, string> = {
  faye_offline: "Faye is resting right now. Try again in a bit.",
  rate_limited: "Faye is busy or you hit today's limit. Wait a moment and try again.",
  too_large: "That request is too large for Faye. Ask a shorter question.",
  worker_lost: "Faye lost her train of thought. Please ask again.",
  expired: "Faye did not pick that up in time, so I dropped it. Please ask again.",
  not_allowed: "Faye is not available for this account.",
  auth_required: "Your session ended. Sign in again to ask Faye.",
  bad_request: "Faye could not read that request. Please try again.",
  not_found: "Faye lost track of that question. Please ask again.",
  disabled: "Faye is switched off right now.",
  generation_failed: "That did not work. Nothing was changed.",
  server_error: "Something went wrong on the app's side. Please try again.",
  unavailable: "Faye is not set up yet.",
  unreachable: "Faye is not reachable right now.",
  cancelled: "Stopped.",
};

/** Added to the offline line only once Faye really keeps notes (the contract text says "Your notes are still here"). */
export const NOTES_STILL_HERE = " Your notes are still here.";

export class FayeTransportError extends Error {
  readonly code: FayeErrorCode;
  readonly retryAfterSec?: number;
  readonly detail?: string;
  constructor(code: FayeErrorCode, opts: { message?: string; retryAfterSec?: number; detail?: string; notesExist?: boolean } = {}) {
    let message = opts.message ?? FAYE_MESSAGES[code];
    if (opts.message === undefined) {
      if (code === "faye_offline" && opts.notesExist) message += NOTES_STILL_HERE;
      if (code === "rate_limited" && opts.retryAfterSec && opts.retryAfterSec > 0) message += ` Try again in about ${Math.min(Math.ceil(opts.retryAfterSec), 3600)} seconds.`;
    }
    super(message);
    this.name = "FayeTransportError";
    this.code = code;
    this.retryAfterSec = opts.retryAfterSec;
    this.detail = opts.detail;
  }
}

/** Codes that mean "nobody is home": the widget goes to the offline face instead of showing a red error. */
export const OFFLINE_CODES: ReadonlySet<string> = new Set(["faye_offline", "unreachable"]);

// ------------------------------------------------------------------ small utilities (injectable for tests)

export interface TransportDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  uuid?: () => string;
}

const defaultFetch: typeof fetch = (...a) => globalThis.fetch(...a);
const defaultNow = () => Date.now();
const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });

/** A request id for idempotency: 8 to 64 characters of A-Z a-z 0-9 _ - . */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

class NetworkError extends Error {}

/** An abort signal that fires when `parent` does OR after `ms`. Call done() to clear the timer. */
function limitedSignal(parent: AbortSignal | undefined, ms: number) {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), ms);
  (timer as { unref?: () => void }).unref?.();
  const onAbort = () => c.abort();
  if (parent) {
    if (parent.aborted) c.abort();
    else parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: c.signal,
    done() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------------ the read-only tool runner (shared by both transports)

// Faye plans multi-step runs; the widget executes them as the signed-in user, because the research and trading routes sit
// behind the app's login. The plan arrives from Faye's server (or, under the mailbox, from the database), so it is never
// trusted to choose a path: only these read-only routes, with the method listed, will ever be called.
export const ALLOWED_TOOLS: Record<string, "GET" | "POST"> = {
  "/api/macro-overview": "GET",
  "/api/sector-recommendations": "GET",
  "/api/research-screener": "GET",
  "/api/security-analysis": "GET",
  "/api/watchlist-scan": "POST",
  "/api/gex-signal": "GET",
  "/api/option-expirations": "GET",
  "/api/option-chain-contracts": "GET",
  "/api/historical-backtest": "GET",
  "/api/guided-trade-signals": "GET",
  "/api/catalyst-calendar": "GET",
  "/api/crypto-regime": "GET",
};
export const SAFE_PARAM = /^[A-Za-z0-9.\-_/ ]{1,40}$/;
export const SAFE_SYMBOL = /^[A-Za-z0-9.\-/]{1,12}$/;
export const TOOL_CONCURRENCY = 4;
export const TOOL_TIMEOUT_MS = 90_000;

export interface PlanCall {
  id: string;
  tool: string;
  agent: string;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, string | number>;
  body?: { entries?: { symbol: string; assetClass: string }[] };
}

export interface ToolResult {
  ok: boolean;
  status: number;
  data: unknown;
  error: string | null;
}

const blocked = (error: string): ToolResult => ({ ok: false, status: 0, data: null, error });

export async function executeCall(c: PlanCall, fetchImpl: typeof fetch = defaultFetch): Promise<ToolResult> {
  if (typeof c.path !== "string" || !Object.prototype.hasOwnProperty.call(ALLOWED_TOOLS, c.path) || ALLOWED_TOOLS[c.path] !== c.method) return blocked("blocked: not an allowed read-only tool");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(c.params ?? {})) {
    if (!/^[A-Za-z]{1,30}$/.test(k) || (typeof v !== "string" && typeof v !== "number") || !SAFE_PARAM.test(String(v))) return blocked("blocked: unsafe parameter");
    qs.set(k, String(v));
  }
  let body: string | undefined;
  if (c.method === "POST") {
    const entries = c.body?.entries;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 10 || !entries.every((e) => SAFE_SYMBOL.test(e?.symbol ?? "") && SAFE_PARAM.test(e?.assetClass ?? ""))) {
      return blocked("blocked: unsafe request body");
    }
    body = JSON.stringify({ entries: entries.map((e) => ({ symbol: e.symbol, assetClass: e.assetClass })) });
  }
  const url = qs.toString() ? `${c.path}?${qs}` : c.path;
  try {
    const res = await fetchImpl(url, {
      method: c.method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });
    if (res.redirected && new URL(res.url).pathname.startsWith("/login")) {
      return { ok: false, status: 401, data: null, error: "not signed in" };
    }
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) {
      return { ok: false, status: res.status, data: null, error: "not signed in, or the app returned a non-JSON response" };
    }
    const data = await res.json();
    if (!res.ok) {
      const msg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: null, error: msg };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (e) {
    return blocked(e instanceof Error ? e.message : "request failed");
  }
}

// A bounded pool: a deep dive asks for a dozen option chains at once, and the
// app's own backend should not be hit with all of them simultaneously.
export async function runCalls(calls: PlanCall[], fetchImpl: typeof fetch = defaultFetch): Promise<Record<string, ToolResult>> {
  const out: Record<string, ToolResult> = Object.create(null);
  let next = 0;
  const worker = async () => {
    while (next < calls.length) {
      const c = calls[next++];
      out[c.id] = await executeCall(c, fetchImpl);
    }
  };
  await Promise.all(Array.from({ length: Math.min(TOOL_CONCURRENCY, calls.length) }, worker));
  return out;
}

// ------------------------------------------------------------------ local transport (today's behaviour)

// Faye's server still lives at the /pilp/* routes (see Documents/Pilp_Assistant): only her displayed name changed.
export const FAYE_BASE_URL = "http://127.0.0.1:7810";
export const STATUS_URL = `${FAYE_BASE_URL}/pilp/status`;
export const CHAT_URL = `${FAYE_BASE_URL}/pilp/chat`;
export const CONTINUE_URL = `${FAYE_BASE_URL}/pilp/continue`;

function abortOrUnreachable(e: unknown, signal?: AbortSignal): FayeTransportError {
  if (signal?.aborted) return new FayeTransportError("cancelled");
  if (e instanceof FayeTransportError) return e;
  return new FayeTransportError("unreachable");
}

export function createLocalTransport(deps: TransportDeps = {}): FayeTransport {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  return {
    kind: "local",

    async status() {
      try {
        const res = await fetchImpl(STATUS_URL, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error("not ok");
        const json = await res.json();
        // Not running on this computer = draw nothing, exactly as before.
        return { state: json?.runtime?.status === "AVAILABLE" ? "available" : "hidden" };
      } catch {
        return { state: "hidden" };
      }
    },

    async chat(req, h, signal) {
      let res: Response;
      try {
        res = await fetchImpl(CHAT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: req.question, state: req.state, stream: true }),
          signal,
        });
      } catch (e) {
        throw abortOrUnreachable(e, signal);
      }
      if (!res.body) throw new FayeTransportError("generation_failed", { message: "Faye returned no response stream." });

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      const parser = new SseParser(); // keeps partial events between chunks, skips corrupt ones, caps total size
      let text = "";
      let done: Record<string, unknown> | null = null;
      try {
        for (;;) {
          const { value, done: finished } = await reader.read();
          if (finished) break;
          for (const { event, data: raw } of parser.push(dec.decode(value, { stream: true }))) {
            const data = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
            if (event === "chunk" && typeof data.text === "string") {
              text += data.text;
              h.onChunk?.(data.text);
            } else if (event === "done") {
              done = data;
            } else if (event === "error") {
              throw new FayeTransportError("generation_failed", { message: typeof data.error === "string" && data.error ? data.error : "Something went wrong." });
            }
          }
        }
      } catch (e) {
        if (e instanceof FayeTransportError) throw e;
        if (signal?.aborted) throw new FayeTransportError("cancelled");
        // A stream that dies part-way (or a hostile oversized one) is shown as the error it is.
        throw new FayeTransportError("generation_failed", { message: e instanceof Error && e.message ? e.message : FAYE_MESSAGES.unreachable });
      }
      if (!done) {
        if (!text) throw new FayeTransportError("generation_failed", { message: "Faye's answer ended before it finished." });
        done = {};
      }
      return {
        kind: asKind(done.kind),
        text: text || (typeof done.text === "string" ? done.text : ""),
        calls: done.calls,
        state: done.state,
        action: done.action,
        retracted: false,
      };
    },

    async continue(req, _h, signal) {
      let json: Record<string, unknown>;
      try {
        const res = await fetchImpl(CONTINUE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: req.state, results: req.results }),
          signal,
        });
        json = (await res.json()) as Record<string, unknown>;
      } catch (e) {
        throw abortOrUnreachable(e, signal);
      }
      if (!json?.ok) throw new FayeTransportError("generation_failed", { message: typeof json?.error === "string" && json.error ? json.error : "Faye couldn't continue that run." });
      return {
        kind: asKind(json.kind),
        text: String(json.text ?? ""),
        calls: json.calls,
        state: json.state,
        action: json.action,
        retracted: false,
      };
    },
  };
}

// ------------------------------------------------------------------ mailbox transport

export const MAILBOX_STATUS_URL = "/api/faye/status";
export const MAILBOX_JOBS_URL = "/api/faye/jobs";
/** Long-poll wait asked of the route (contract: default 8000, clamped to 0..12000). */
export const POLL_WAIT_MS = 8000;
/** A chat job can wait 90 s in the queue and run for 180 s; give up a little after that. */
export const CHAT_MAX_MS = 300_000;
export const CONTINUE_MAX_MS = 120_000;
/** A dropped connection is retried with this backoff (ms); the last value repeats. */
export const RETRY_BACKOFF_MS = [1000, 2000, 4000];
/** How long the poll keeps retrying a dead connection before telling the owner. */
export const GIVE_UP_AFTER_MS = 45_000;
const SUBMIT_ATTEMPTS = 4;
const JOB_ID = /^[0-9a-fA-F-]{32,40}$/;

interface Reply {
  status: number;
  body: Record<string, unknown> | null;
  loginRedirect: boolean;
}

function errorFromReply(r: Reply): FayeTransportError {
  const b = r.body;
  let code: FayeErrorCode;
  if (b && typeof b.code === "string" && KNOWN_CODES.has(b.code)) code = b.code as FayeErrorCode;
  else if (r.loginRedirect || r.status === 401) code = "auth_required";
  else if (r.status === 403) code = "not_allowed";
  else if (r.status === 413) code = "too_large";
  else if (r.status === 429) code = "rate_limited";
  else if (r.status === 404) code = "not_found";
  else if (r.status === 400) code = "bad_request";
  else if (r.status === 503) code = "unavailable";
  else code = "server_error";
  const retry = b && typeof b.retry_after_sec === "number" && Number.isFinite(b.retry_after_sec) ? Math.max(0, Math.min(3600, b.retry_after_sec)) : undefined;
  return new FayeTransportError(code, { retryAfterSec: retry, detail: b && typeof b.detail === "string" ? b.detail.slice(0, 40) : undefined });
}

/** A failure worth retrying with the SAME request id: a gateway error or a platform 503 with no Faye code. */
function isTransient(r: Reply): boolean {
  if (r.status === 500 || r.status === 502 || r.status === 504) return true;
  if (r.status === 503 && !(r.body && typeof r.body.code === "string")) return true;
  return false;
}

export function createMailboxTransport(deps: TransportDeps = {}): FayeTransport {
  const fetchImpl = deps.fetchImpl ?? defaultFetch;
  const now = deps.now ?? defaultNow;
  const sleep = deps.sleep ?? defaultSleep;
  const uuid = deps.uuid ?? newRequestId;

  /** One same-origin request. Throws NetworkError when the connection fails or times out; the caller's own abort is rethrown as cancelled. */
  async function request(url: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number): Promise<Reply> {
    const lim = limitedSignal(signal, timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, credentials: "same-origin", cache: "no-store", signal: lim.signal });
      let loginRedirect = false;
      try {
        loginRedirect = !!res.redirected && new URL(res.url, "http://x").pathname.startsWith("/login");
      } catch {
        loginRedirect = false;
      }
      let body: Record<string, unknown> | null = null;
      if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        const parsed = await res.json().catch(() => null);
        body = isObj(parsed) ? parsed : null;
      }
      return { status: res.status, body, loginRedirect };
    } catch (e) {
      if (signal?.aborted) throw new FayeTransportError("cancelled");
      throw new NetworkError(e instanceof Error ? e.message : "network");
    } finally {
      lim.done();
    }
  }

  async function postJson(url: string, payload: unknown, signal: AbortSignal | undefined, timeoutMs = 20_000): Promise<Reply> {
    return request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, signal, timeoutMs);
  }

  /** Best effort: tell the server to stop a job. Never throws. */
  async function cancelJob(jobId: string): Promise<void> {
    try {
      await postJson(`${MAILBOX_JOBS_URL}/${jobId}/cancel`, {}, undefined, 6000);
    } catch {
      /* the job will simply expire */
    }
  }

  /**
   * Create a job. The SAME request_id is used for every retry, so a request whose answer was lost on the way back (a phone
   * going through a tunnel) comes back as `deduped: true` with the original job instead of a second question.
   * The caller's abort is deliberately not passed to the POST: if the user presses Stop while the request is in flight we
   * still learn the job id and cancel it, so a stuck job cannot hold the "one answer at a time" slot.
   */
  async function submit(payload: Record<string, unknown>, signal: AbortSignal | undefined): Promise<string> {
    const request_id = uuid();
    let lastErr: FayeTransportError | null = null;
    for (let attempt = 0; attempt < SUBMIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)]);
      let r: Reply;
      try {
        r = await postJson(MAILBOX_JOBS_URL, { request_id, ...payload }, undefined);
      } catch (e) {
        if (e instanceof NetworkError) {
          lastErr = new FayeTransportError("unreachable");
          continue;
        }
        throw e;
      }
      if (r.body && r.body.ok === true && typeof r.body.job_id === "string" && JOB_ID.test(r.body.job_id) && (r.status === 200 || r.status === 201)) {
        const jobId = r.body.job_id;
        if (signal?.aborted) {
          await cancelJob(jobId);
          throw new FayeTransportError("cancelled");
        }
        return jobId;
      }
      if (isTransient(r)) {
        lastErr = errorFromReply(r);
        continue;
      }
      throw errorFromReply(r);
    }
    throw lastErr ?? new FayeTransportError("unreachable");
  }

  /** Long-poll one job to its end. `after` only moves forward past events we have actually delivered, so a dropped response is simply asked for again. */
  async function awaitJob(jobId: string, h: TurnHandlers, signal: AbortSignal | undefined, maxMs: number): Promise<TurnResult> {
    let after = 0;
    let announcedRunning = false;
    const started = now();
    let failingSince: number | null = null;
    let failures = 0;
    const stop = async (): Promise<never> => {
      await cancelJob(jobId);
      throw new FayeTransportError("cancelled");
    };
    for (;;) {
      if (signal?.aborted) await stop();
      if (now() - started > maxMs) {
        await cancelJob(jobId);
        throw new FayeTransportError("worker_lost");
      }
      let r: Reply;
      try {
        r = await request(`${MAILBOX_JOBS_URL}/${jobId}?after=${after}&wait=${POLL_WAIT_MS}`, { method: "GET" }, signal, POLL_WAIT_MS + 9000);
      } catch (e) {
        if (e instanceof FayeTransportError && e.code === "cancelled") return stop();
        // Connection dropped: ask again for the same `after`. Nothing is lost and nothing is shown twice.
        failingSince ??= now();
        if (now() - failingSince > GIVE_UP_AFTER_MS) throw new FayeTransportError("unreachable");
        await sleep(RETRY_BACKOFF_MS[Math.min(failures++, RETRY_BACKOFF_MS.length - 1)], signal);
        continue;
      }
      const b = r.body;
      if (r.status !== 200 || !b || b.ok !== true) {
        if (isTransient(r)) {
          failingSince ??= now();
          if (now() - failingSince > GIVE_UP_AFTER_MS) throw errorFromReply(r);
          await sleep(RETRY_BACKOFF_MS[Math.min(failures++, RETRY_BACKOFF_MS.length - 1)], signal);
          continue;
        }
        throw errorFromReply(r);
      }
      failingSince = null;
      failures = 0;

      const events = Array.isArray(b.events) ? (b.events as unknown[]) : [];
      for (const raw of events) {
        if (!isObj(raw) || typeof raw.seq !== "number" || !Number.isInteger(raw.seq) || raw.seq <= after) continue; // already delivered
        after = raw.seq;
        if (typeof raw.text !== "string") continue;
        if (raw.ev === "retract") h.onRetract?.(raw.text);
        else if (raw.ev === "chunk" || raw.ev === undefined) h.onChunk?.(raw.text);
      }

      const status = typeof b.status === "string" ? b.status : "";
      if (status === "queued") h.onQueue?.(typeof b.queue_position === "number" ? b.queue_position : null);
      else if (!announcedRunning && (status === "claimed" || status === "running")) {
        announcedRunning = true;
        h.onRunning?.();
      }

      if (b.done === true) {
        if (status === "done") {
          const res = b.result;
          if (!isObj(res) || typeof res.text !== "string") throw new FayeTransportError("generation_failed");
          return {
            kind: asKind(res.kind),
            text: res.text, // authoritative: replaces anything streamed
            calls: res.calls ?? undefined,
            state: res.state ?? undefined,
            action: res.action ?? undefined,
            provenance: isObj(res.provenance) ? res.provenance : null,
            retracted: b.retracted === true || (isObj(res.provenance) && res.provenance.retracted === true),
            ref: jobId,
          };
        }
        if (status === "cancelled") throw new FayeTransportError("cancelled");
        const err = isObj(b.error) && typeof b.error.code === "string" && KNOWN_CODES.has(b.error.code) ? (b.error.code as FayeErrorCode) : status === "expired" ? "expired" : "generation_failed";
        throw new FayeTransportError(err);
      }
      // Not final: loop. A `more: true` reply is simply asked again straight away (no sleep): the route returns at once while events exist.
    }
  }

  return {
    kind: "mailbox",

    async status(opts) {
      let r: Reply;
      try {
        r = await request(opts?.wake ? `${MAILBOX_STATUS_URL}?wake=1` : MAILBOX_STATUS_URL, { method: "GET" }, opts?.signal, 6000);
      } catch {
        return { state: "offline" }; // no signal on the owner's phone: the honest answer is "can't reach Faye"
      }
      if (r.loginRedirect || r.status === 401) return { state: "not_allowed" };
      if (r.status === 403) return { state: "not_allowed" };
      if (r.status === 404) return { state: "hidden" }; // routes not deployed
      const b = r.body;
      if (!b || b.ok !== true) return r.status >= 500 && r.status !== 503 ? { state: "offline" } : { state: "hidden" };
      if (b.enabled === false) return { state: "hidden" };
      if (b.allowed !== true) return { state: "not_allowed" };
      const limits = isObj(b.limits) ? b.limits : null;
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      return {
        state: b.online === true ? "available" : "offline",
        usedToday: num(b.used_today),
        dailyCap: num(b.daily_cap),
        queueDepth: num(b.queue_depth),
        questionChars: limits ? num(limits.question_chars) : undefined,
      };
    },

    async chat(req, h, signal) {
      const jobId = await submit({ kind: "chat", question: req.question, state: req.state }, signal);
      return awaitJob(jobId, h, signal, CHAT_MAX_MS);
    },

    async continue(req, h, signal) {
      if (!req.parentRef || !JOB_ID.test(req.parentRef)) throw new FayeTransportError("bad_request");
      const jobId = await submit({ kind: "continue", parent_job_id: req.parentRef, state: req.state, results: req.results }, signal);
      return awaitJob(jobId, h, signal, CONTINUE_MAX_MS);
    },
  };
}

export function createTransport(kind: TransportKind = TRANSPORT_KIND, deps: TransportDeps = {}): FayeTransport {
  return kind === "mailbox" ? createMailboxTransport(deps) : createLocalTransport(deps);
}

// ------------------------------------------------------------------ the shared conversation engine (all the guards live here)

export interface RunEvents {
  /** Faye is thinking (also fires again when a tool step starts). "queued" means she has not picked the job up yet. */
  onPhase?(phase: "queued" | "thinking" | "tools", info?: { position?: number | null }): void;
  /** Streamed text so far, and a counter that goes up on every real chunk (drives the avatar's mouth). */
  onText?(textSoFar: string, tick: number): void;
  /** The output guard replaced the text with the scripted decline. */
  onRetract?(replacement: string): void;
  /** A tool step finished: Faye's narration line and the tool log so far. */
  onStep?(text: string, toolLog: string[]): void;
}

export interface RunOutcome {
  text: string;
  kind: TurnKind;
  /** Rebuilt by validateProposedAction(): the card text and the executed values both come from this, never from server text. */
  action: ValidatedAction | null;
  toolLog: string[];
  retracted: boolean;
  unsure: boolean;
  notesUsed: number;
  /** Ids of the notes the answer used (provenance.memory_ids; ids only, never note text). The widget looks the text up in About me. */
  noteIds: string[];
}

export interface RunOptions {
  transport: FayeTransport;
  question: string;
  state: unknown;
  signal?: AbortSignal;
  events?: RunEvents;
  fetchImpl?: typeof fetch;
}

/** The scripted decline used if a retract arrives with no text. Mirrors the contract's example wording. */
export const RETRACT_FALLBACK = "I can not tell you what to buy or sell. I can explain how each choice works.";

const UNSURE_RE = /\b(?:i am not sure|i'm not sure|i do not know|i don't know|not a fact|so i will not guess|the tool did not answer)\b/i;

/** True when the answer should wear the "unsure" face: a retract, a failed tool, or Faye saying she is unsure. */
export function looksUnsure(o: { text: string; retracted?: boolean; toolLog?: readonly string[] }): boolean {
  if (o.retracted) return true;
  if (o.toolLog?.some((l) => l.includes("failed"))) return true;
  return UNSURE_RE.test(o.text);
}

function notesCount(p: Record<string, unknown> | null | undefined): number {
  const ids = p && Array.isArray(p.memory_ids) ? p.memory_ids : [];
  return ids.filter((x) => typeof x === "string").length;
}

/** The note ids from provenance, strings only, at most 6 (the memory pack's cap), de-duplicated. */
export function noteIdList(p: Record<string, unknown> | null | undefined): string[] {
  const ids = p && Array.isArray(p.memory_ids) ? p.memory_ids : [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length <= 64))].slice(0, 6);
}

export async function runQuestion(o: RunOptions): Promise<RunOutcome> {
  const { transport, signal } = o;
  const ev = o.events ?? {};
  const fetchImpl = o.fetchImpl ?? defaultFetch;
  let text = "";
  let tick = 0;
  const handlers: TurnHandlers = {
    onChunk(d) {
      text += d;
      ev.onText?.(text, ++tick);
    },
    onRetract(t) {
      text = t || RETRACT_FALLBACK;
      ev.onRetract?.(text);
      ev.onText?.(text, ++tick);
    },
    onQueue(position) {
      ev.onPhase?.("queued", { position });
    },
    onRunning() {
      ev.onPhase?.("thinking");
    },
  };

  ev.onPhase?.("thinking");
  const first = await transport.chat({ question: o.question, state: o.state }, handlers, signal);
  const firstText = first.retracted ? first.text || RETRACT_FALLBACK : first.text;

  // First-turn actions come from Faye's parse of the user's own words; each one is validated and the card is
  // built from the validated values. Anything unrecognised or out of range is dropped with a note.
  const check = first.action ? validateProposedAction(first.action) : null;
  const action = check && check.ok ? check.action : null;
  const rejectedNote = check && !check.ok ? `\n\n(Faye proposed an action that failed validation, so none is offered: ${check.error})` : "";
  let plan: { calls: PlanCall[]; state: unknown } | null = null;
  if (first.kind === "tool_calls" && Array.isArray(first.calls) && first.state) {
    const planCheck = sanitizePlanCalls(first.calls, 0);
    if (!planCheck.ok) throw new Error(planCheck.error);
    plan = { calls: planCheck.calls as PlanCall[], state: first.state };
  }
  const firstOutcome = { text: firstText + rejectedNote, kind: first.kind };
  ev.onText?.(firstOutcome.text, tick);

  if (!plan) {
    return finish({ text: firstOutcome.text, kind: first.kind, action, toolLog: [], retracted: first.retracted, provenance: first.provenance });
  }

  // Executes a multi-step plan: run the turn's calls as the user, hand the raw results back to Faye with her opaque
  // state, repeat until she returns the final answer. Faye holds no tool access of her own and no model is involved
  // in planning, so each hop is quick and deterministic.
  let calls: PlanCall[] | null = plan.calls;
  let state: unknown = plan.state;
  let ref = first.ref;
  let callsRun = 0;
  const log: string[] = [];
  const label = (c: PlanCall) => {
    const p = Object.values(c.params ?? {});
    return `${c.agent} · ${c.tool}${p.length ? ` (${p.join(", ")})` : ""}`;
  };
  for (let turn = 0; calls && turn < MAX_PLAN_TURNS; turn++) {
    ev.onPhase?.("tools");
    // Every turn's calls are rebuilt from whitelisted fields and capped (per turn and per run) before anything is fetched.
    const checked = sanitizePlanCalls(calls, callsRun);
    if (!checked.ok) throw new Error(checked.error);
    calls = checked.calls as PlanCall[];
    callsRun += calls.length;
    const results = await runCalls(calls, fetchImpl);
    for (const c of calls) {
      const r = results[c.id];
      log.push(`${label(c)}: ${r?.ok ? "ok" : `failed (${r?.error ?? "no result"})`}`);
    }
    if (signal?.aborted) throw new FayeTransportError("cancelled");
    const res = await transport.continue({ state, results, parentRef: ref }, handlers, signal);
    ref = res.ref;
    const snapshot = [...log];
    if (res.kind === "tool_calls") {
      calls = res.calls as PlanCall[]; // checked at the top of the next turn
      state = res.state;
      ev.onStep?.(String(res.text ?? ""), snapshot);
      continue;
    }
    // A final turn may end in a proposal (e.g. a paper order for a signal). It is
    // shown as a confirm card and does nothing until the user clicks Confirm.
    // Only a paper order can end a run; it is re-validated, and the card shows the validated order.
    const finalCheck = isObj(res.action) && res.action.type === "paper_order" ? validateProposedAction(res.action) : null;
    const finalAction = finalCheck && finalCheck.ok ? finalCheck.action : null;
    const finalNote = finalCheck && !finalCheck.ok ? `\n\n(Faye proposed an order that failed validation, so none is offered: ${finalCheck.error})` : "";
    const finalText = (res.retracted ? res.text || RETRACT_FALLBACK : String(res.text ?? "")) + finalNote;
    ev.onText?.(finalText, ++tick);
    return finish({ text: finalText, kind: res.retracted ? "guardrail" : "final", action: finalAction, toolLog: snapshot, retracted: res.retracted, provenance: res.provenance });
  }
  throw new Error(`That run took more than ${MAX_PLAN_TURNS} steps or ${MAX_CALLS_PER_RUN} tool calls, so I stopped it.`);

  function finish(p: { text: string; kind: TurnKind; action: ValidatedAction | null; toolLog: string[]; retracted: boolean; provenance?: Record<string, unknown> | null }): RunOutcome {
    return {
      text: p.text,
      kind: p.kind,
      action: p.action,
      toolLog: p.toolLog,
      retracted: p.retracted,
      unsure: looksUnsure({ text: p.text, retracted: p.retracted, toolLog: p.toolLog }),
      notesUsed: notesCount(p.provenance),
      noteIds: noteIdList(p.provenance),
    };
  }
}

// ------------------------------------------------------------------ view helpers (pure, so they can be tested without a browser)

export type WidgetStatus = "checking" | TransportStatus["state"];
export type RunPhase = "queued" | "thinking" | "speaking" | "tools" | null;
export type AvatarMood = "idle" | "listening" | "thinking" | "speaking" | "unsure" | "celebrating" | "offline" | "error";

export interface MoodInput {
  status: WidgetStatus;
  sending: boolean;
  phase: RunPhase;
  typing: boolean;
  celebrating: boolean;
  errorCode: string | null;
  unsure: boolean;
}

/**
 * The avatar's mood is a function of real state (design 6.3):
 * offline when the status says so; thinking until the first chunk (and while tools run); speaking while chunks stream;
 * a short celebration on a good outcome; listening while the user types; error after a failed job; unsure after a
 * retract, a failed tool or an unsure answer; idle otherwise.
 */
export function deriveMood(i: MoodInput): AvatarMood {
  if (i.status === "offline") return "offline";
  if (i.sending) return i.phase === "speaking" ? "speaking" : "thinking";
  if (i.celebrating) return "celebrating";
  if (i.typing) return "listening";
  if (i.errorCode && !OFFLINE_CODES.has(i.errorCode) && i.errorCode !== "cancelled") return "error";
  if (i.unsure) return "unsure";
  return "idle";
}

/** While the panel is open and Faye is offline, check again at these gaps (ms), then stop and offer a button. */
export const OFFLINE_RECHECK_MS = [4000, 6000, 8000, 12000, 15000, 20000, 20000, 20000];
export function nextOfflineRecheckMs(attempt: number): number | null {
  return attempt >= 0 && attempt < OFFLINE_RECHECK_MS.length ? OFFLINE_RECHECK_MS[attempt] : null;
}

// ------------------------------------------------------------------ plain-language copy (grade 8 or lower; checked by a test)

/** Header copy, true for each transport. Under the mailbox the old "runs on your own computer" lines would be false. */
export const COPY_LOCAL =
  "Faye is educational, not advice. She runs on your own computer. When she runs the app's tools, your browser calls the app as you. Your questions are logged with amounts and account details removed. Your portfolio data is never saved.";
export const COPY_MAILBOX =
  "Faye is educational, not advice. Your question and your holdings (symbols, shares and cost) travel through this app's database for up to 24 hours, then they are deleted. Faye also keeps a short log with amounts and account details removed. When she runs the app's tools, your browser calls the app as you.";
/** One visible line above the full text, which opens under it. Each is true for its transport. */
export const COPY_LOCAL_SHORT = "Educational, not advice. Runs on your own computer.";
export const COPY_MAILBOX_SHORT = "Educational, not advice. Questions are kept up to 24 hours, then deleted.";
export const COPY_EMPTY = "Ask about your portfolio, fees, risk, or any investing idea. Faye explains. She never tells you what to buy or sell.";
export const COPY_OFFLINE = FAYE_MESSAGES.faye_offline;
export const COPY_NOT_ALLOWED = FAYE_MESSAGES.not_allowed;
