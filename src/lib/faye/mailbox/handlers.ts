/**
 * Request handlers for the four Faye mailbox routes. The route files in src/app/api/faye/** are one-liners that pass the real
 * dependencies; tests pass fakes. Contract: FAYE_MAILBOX_CONTRACT.md section 3.
 *
 * Order of checks, always: feature flag, cheap request checks (content type and Origin on POST), session and owner gate,
 * best-effort rate limit, input validation, then the database (which re-checks everything and enforces the real caps).
 */
import { checkPostRequest, gateOwner, type Env, type GateClient } from "../access";
import { LIMITS, mailboxEnabled, ROUTE_RATE } from "./config";
import { errorResponse, jsonResponse, readJsonBody } from "./http";
import { attachMemoryPack } from "./memory-hook";
import { cancelJob, getStatus, longPollJob, submitJob } from "./service";
import type { ChatRequestV1, ContinueRequestV1, RpcRefusal } from "./types";
import { UUID_RE, validateChatBody, validateContinueBody } from "./validate";
import { SlidingWindowLimiter } from "@/lib/access/rate-limit";

export interface HandlerDeps {
  env: Env;
  getClient: () => Promise<GateClient>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  limiters?: { create: SlidingWindowLimiter; poll: SlidingWindowLimiter; status: SlidingWindowLimiter };
}

const defaultLimiters = {
  create: new SlidingWindowLimiter(ROUTE_RATE.createPerMinute, 60_000),
  poll: new SlidingWindowLimiter(ROUTE_RATE.pollPerMinute, 60_000),
  status: new SlidingWindowLimiter(ROUTE_RATE.statusPerMinute, 60_000),
};

function limiters(deps: HandlerDeps) {
  return deps.limiters ?? defaultLimiters;
}

function refusal(r: RpcRefusal): Response {
  if (r.infrastructure) return errorResponse(r.code);
  return errorResponse(r.code, { retryAfterSec: r.retryAfterSec, detail: r.detail });
}

function tooMany(retryAfterSec: number): Response {
  return errorResponse("rate_limited", { retryAfterSec, detail: "route" });
}

// ------------------------------------------------------------------------------------------------------------------ status

export async function handleStatus(request: Request, deps: HandlerDeps): Promise<Response> {
  if (!mailboxEnabled(deps.env)) {
    return jsonResponse({ ok: true, enabled: false, allowed: false, online: false, mood: "offline" });
  }
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) {
    if (gate.code === "not_allowed") {
      // Signed in, but not an owner: a plain 200 so the widget just hides itself without console noise.
      return jsonResponse({ ok: true, enabled: true, allowed: false, online: false, mood: "offline" });
    }
    return errorResponse(gate.code);
  }
  const rate = limiters(deps).status.hit(`s:${gate.user.id}`, deps.now?.());
  if (!rate.allowed) return tooMany(rate.retryAfterSec);

  const wake = new URL(request.url).searchParams.get("wake") === "1";
  const st = await getStatus(gate.client, wake);
  if (!st.ok) return refusal(st);
  if (!st.allowed) return jsonResponse({ ok: true, enabled: true, allowed: false, online: false, mood: "offline" });
  return jsonResponse({
    ok: true,
    enabled: true,
    allowed: true,
    online: st.online,
    mood: st.online ? "online" : "offline",
    queue_depth: st.queueDepth,
    used_today: st.usedToday,
    daily_cap: st.dailyCap,
    limits: { question_chars: LIMITS.questionChars, state_chars: LIMITS.stateChars },
  });
}

// ------------------------------------------------------------------------------------------------------------------ create

export async function handleCreateJob(request: Request, deps: HandlerDeps): Promise<Response> {
  if (!mailboxEnabled(deps.env)) return errorResponse("disabled");
  const post = checkPostRequest(request);
  if (!post.ok) return errorResponse(post.code);
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) return errorResponse(gate.code);
  const rate = limiters(deps).create.hit(`c:${gate.user.id}`, deps.now?.());
  if (!rate.allowed) return tooMany(rate.retryAfterSec);

  const body = await readJsonBody(request, LIMITS.bodyBytes);
  if (!body.ok) return errorResponse(body.code);
  const raw = body.value;
  const kind = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).kind : undefined;

  if (kind === "chat") {
    const v = validateChatBody(raw);
    if (!v.ok) return errorResponse(v.code, { detail: v.detail });
    const memory = await attachMemoryPack({ client: gate.client, userId: gate.user.id, question: v.value.question, env: deps.env });
    const req: ChatRequestV1 = { v: 1, question: v.value.question, state: v.value.state, memory, stream: true };
    const out = await submitJob(gate.client, { requestId: v.value.requestId, kind: "chat", request: req as unknown as Record<string, unknown> });
    return submitResponse(out);
  }
  if (kind === "continue") {
    const v = validateContinueBody(raw);
    if (!v.ok) return errorResponse(v.code, { detail: v.detail });
    const req: ContinueRequestV1 = { v: 1, state: v.value.state, results: v.value.results };
    const out = await submitJob(gate.client, {
      requestId: v.value.requestId,
      kind: "continue",
      request: req as unknown as Record<string, unknown>,
      parentJobId: v.value.parentJobId,
    });
    return submitResponse(out);
  }
  return errorResponse("bad_request", { detail: "bad_kind" });
}

function submitResponse(out: Awaited<ReturnType<typeof submitJob>>): Response {
  if (!out.ok) return refusal(out);
  return jsonResponse(
    { ok: true, job_id: out.jobId, status: out.status, deduped: out.deduped, queue_ahead: out.queueAhead, expires_at: out.expiresAt },
    out.deduped ? 200 : 201,
  );
}

// ------------------------------------------------------------------------------------------------------------------ poll

export async function handlePollJob(request: Request, id: string, deps: HandlerDeps): Promise<Response> {
  if (!mailboxEnabled(deps.env)) return errorResponse("disabled");
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) return errorResponse(gate.code);
  if (!UUID_RE.test(id)) return errorResponse("bad_request", { detail: "bad_id" });
  const rate = limiters(deps).poll.hit(`p:${gate.user.id}`, deps.now?.());
  if (!rate.allowed) return tooMany(rate.retryAfterSec);

  const url = new URL(request.url);
  const afterRaw = url.searchParams.get("after");
  const after = afterRaw === null || afterRaw === "" ? 0 : Number(afterRaw);
  if (!Number.isInteger(after) || after < 0 || after > 1_000_000) return errorResponse("bad_request", { detail: "bad_after" });
  const waitRaw = url.searchParams.get("wait");
  const wait = waitRaw === null || waitRaw === "" ? LIMITS.waitDefaultMs : Number(waitRaw);
  if (!Number.isFinite(wait) || wait < 0) return errorResponse("bad_request", { detail: "bad_wait" });

  const out = await longPollJob(gate.client, id, after, {
    waitMs: Math.min(wait, LIMITS.waitMaxMs),
    now: deps.now,
    sleep: deps.sleep,
    aborted: () => request.signal?.aborted === true,
  });
  if (!out.ok) return refusal(out);
  return jsonResponse(out.body);
}

// ------------------------------------------------------------------------------------------------------------------ cancel

export async function handleCancelJob(request: Request, id: string, deps: HandlerDeps): Promise<Response> {
  if (!mailboxEnabled(deps.env)) return errorResponse("disabled");
  const post = checkPostRequest(request);
  if (!post.ok) return errorResponse(post.code);
  const gate = await gateOwner(deps.getClient, deps.env);
  if (!gate.ok) return errorResponse(gate.code);
  if (!UUID_RE.test(id)) return errorResponse("bad_request", { detail: "bad_id" });
  const rate = limiters(deps).create.hit(`c:${gate.user.id}`, deps.now?.());
  if (!rate.allowed) return tooMany(rate.retryAfterSec);
  const out = await cancelJob(gate.client, id);
  if (!out.ok) return refusal(out);
  return jsonResponse({ ok: true, status: out.status });
}
