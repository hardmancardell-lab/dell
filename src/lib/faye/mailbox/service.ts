/**
 * Talks to the mailbox database functions (browser side) as the signed-in user, and turns their answers into typed results.
 * Contract: FAYE_MAILBOX_CONTRACT.md section 2. Everything is dependency-injected (`MailboxClient`) so tests run with fakes.
 *
 * Other server code (WP-F extract jobs, WP-C2 eval jobs) calls submitJob() with kind "extract" or "eval"; the browser-facing
 * route only ever creates "chat" and "continue".
 */
import { LIMITS } from "./config";
import { FRIENDLY, isFayeErrorCode, toKnownCode, type FayeErrorCode } from "./errors";
import { FINAL_STATUSES, type JobEvent, type JobKind, type JobStatus, type PollBody, type RpcRefusal } from "./types";
import { cleanChatResult, cleanText, isPlainObject } from "./validate";

export interface MailboxClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

type RpcOutcome = { ok: true; data: Record<string, unknown> } | RpcRefusal;

/** Calls one database function. Transport and SQL errors become a refusal with a safe code; their text is logged (trimmed), never returned. */
async function callRpc(client: MailboxClient, fn: string, args: Record<string, unknown>): Promise<RpcOutcome> {
  let res: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    res = await client.rpc(fn, args);
  } catch {
    return { ok: false, code: "unavailable", infrastructure: true };
  }
  if (res.error) {
    const msg = String(res.error.message ?? "");
    const missing = res.error.code === "PGRST202" || res.error.code === "42883" || /could not find the function/i.test(msg);
    console.error(`faye mailbox: rpc ${fn} failed (${res.error.code ?? "no code"})`);
    return { ok: false, code: missing ? "unavailable" : "server_error", infrastructure: true };
  }
  if (!isPlainObject(res.data)) return { ok: false, code: "server_error", infrastructure: true };
  if (res.data.ok === false) {
    return {
      ok: false,
      code: toKnownCode(res.data.code, "server_error"),
      detail: typeof res.data.detail === "string" ? res.data.detail : undefined,
      retryAfterSec: typeof res.data.retry_after_sec === "number" ? res.data.retry_after_sec : undefined,
    };
  }
  return { ok: true, data: res.data };
}

export interface SubmitOk {
  ok: true;
  jobId: string;
  status: JobStatus;
  deduped: boolean;
  queueAhead: number;
  expiresAt: string | null;
}

export async function submitJob(
  client: MailboxClient,
  input: { requestId: string; kind: JobKind; request: Record<string, unknown>; parentJobId?: string | null },
): Promise<SubmitOk | RpcRefusal> {
  const out = await callRpc(client, "faye_submit_job", {
    p_request_id: input.requestId,
    p_kind: input.kind,
    p_request: input.request,
    p_parent_job_id: input.parentJobId ?? null,
  });
  if (!out.ok) return out;
  const d = out.data;
  if (typeof d.job_id !== "string") return { ok: false, code: "server_error", infrastructure: true };
  return {
    ok: true,
    jobId: d.job_id,
    status: (typeof d.status === "string" ? d.status : "queued") as JobStatus,
    deduped: d.deduped === true,
    queueAhead: typeof d.queue_ahead === "number" ? d.queue_ahead : 0,
    expiresAt: typeof d.expires_at === "string" ? d.expires_at : null,
  };
}

export async function cancelJob(client: MailboxClient, jobId: string): Promise<{ ok: true; status: JobStatus } | RpcRefusal> {
  const out = await callRpc(client, "faye_cancel_job", { p_job_id: jobId });
  if (!out.ok) return out;
  return { ok: true, status: (typeof out.data.status === "string" ? out.data.status : "cancelled") as JobStatus };
}

export interface StatusOk {
  ok: true;
  allowed: boolean;
  online: boolean;
  queueDepth: number;
  usedToday: number;
  dailyCap: number | null;
}

export async function getStatus(client: MailboxClient, wake: boolean): Promise<StatusOk | RpcRefusal> {
  const out = await callRpc(client, "faye_status", { p_wake: wake });
  if (!out.ok) return out;
  const d = out.data;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return {
    ok: true,
    allowed: d.allowed === true,
    online: d.allowed === true && d.online === true,
    queueDepth: num(d.queue_depth),
    usedToday: num(d.used_today),
    dailyCap: typeof d.daily_cap === "number" ? d.daily_cap : null,
  };
}

// ------------------------------------------------------------------------------------------------------------------ polling

const FINAL = new Set<string>(FINAL_STATUSES);

/** Turns one faye_poll_job answer into the browser-facing body (text cleaned, result rebuilt, relay guard applied). */
export function buildPollBody(d: Record<string, unknown>, jobId: string): PollBody {
  const kind = (["chat", "continue", "extract", "eval"].includes(d.kind as string) ? d.kind : "chat") as JobKind;
  const status = (typeof d.status === "string" ? d.status : "queued") as JobStatus;
  const events: JobEvent[] = [];
  let retractedByEvent = false;
  for (const e of Array.isArray(d.events) ? d.events : []) {
    if (!isPlainObject(e) || typeof e.seq !== "number" || typeof e.text !== "string") continue;
    const ev = e.ev === "retract" ? "retract" : "chunk";
    if (ev === "retract") retractedByEvent = true;
    events.push({ seq: e.seq, ev, text: cleanText(e.text, 8000) });
  }
  const more = d.more === true;
  const done = FINAL.has(status) && !more;

  let result: PollBody["result"] = null;
  let retracted = retractedByEvent;
  if (status === "done" && !more && d.result != null) {
    if (kind === "chat" || kind === "continue") {
      const c = cleanChatResult(d.result);
      result = c.result;
      retracted = retracted || c.retracted;
    } else if (isPlainObject(d.result)) {
      result = d.result;
    }
  }

  let error: PollBody["error"] = null;
  if ((status === "failed" || status === "expired") && isPlainObject(d.error)) {
    const code: FayeErrorCode = isFayeErrorCode(d.error.code) ? d.error.code : "generation_failed";
    error = { code, message: FRIENDLY[code] };
  } else if (status === "failed" || status === "expired") {
    const code: FayeErrorCode = status === "expired" ? "expired" : "generation_failed";
    error = { code, message: FRIENDLY[code] };
  }

  return {
    ok: true,
    job_id: jobId,
    kind,
    status,
    events,
    last_seq: typeof d.last_seq === "number" ? d.last_seq : 0,
    more,
    queue_position: typeof d.queue_position === "number" ? d.queue_position : null,
    done,
    result,
    error,
    retracted,
    purged: d.purged === true,
  };
}

export interface LongPollOptions {
  waitMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  aborted?: () => boolean;
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Holds the request until there is something new: an event, a final state, or a status change (queued to running).
 * The first check is immediate; later checks are `intervalMs` apart. Returns on the deadline with the current state.
 */
export async function longPollJob(
  client: MailboxClient,
  jobId: string,
  after: number,
  opts: LongPollOptions = {},
): Promise<{ ok: true; body: PollBody } | RpcRefusal> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const interval = Math.max(50, opts.intervalMs ?? LIMITS.pollIntervalMs);
  const wait = Math.min(LIMITS.waitMaxMs, Math.max(0, opts.waitMs ?? LIMITS.waitDefaultMs));
  const deadline = now() + wait;
  let firstStatus: string | null = null;
  for (;;) {
    const out = await callRpc(client, "faye_poll_job", { p_job_id: jobId, p_after: after });
    if (!out.ok) return out;
    const body = buildPollBody(out.data, jobId);
    if (firstStatus === null) firstStatus = body.status;
    if (body.events.length > 0 || body.done || body.status !== firstStatus) return { ok: true, body };
    if (opts.aborted?.() || now() + interval > deadline) return { ok: true, body };
    await sleep(interval);
  }
}

