// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-transport.test.mts
// Faye transport (WP-C1): the local transport behaves as it always did; the mailbox transport follows
// FAYE_MAILBOX_CONTRACT.md v1.0 section 3 against a FAKE mailbox (no network, no real waiting). Covers create with a
// request id, chunk streaming, long-poll timeout and resume, dropped connections without duplicate text, idempotent
// retry after a lost reply, cancel, retract, every error code, and "the same guards through both transports".
import { readFileSync } from "node:fs";

const TR = await import("../src/lib/faye/transport.ts");

let failed = 0;
const t = (name: string, ok: unknown, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " :: " + String(detail).slice(0, 400) : ""}`);
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rejects = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as any;
  }
};

// ------------------------------------------------------------------ fakes
const jsonRes = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

class FakeClock {
  t = 0;
  sleeps: number[] = [];
  now = () => this.t;
  sleep = async (ms: number) => {
    this.sleeps.push(ms);
    this.t += ms;
  };
}

type Step = { chunks?: string[]; retract?: string; queued?: number | null; idle?: boolean; done?: any; fail?: string; expire?: boolean; cancelled?: boolean };

class FakeMailbox {
  clock = new FakeClock();
  calls: any[] = [];
  jobs = new Map<string, any>();
  byRequest = new Map<string, string>();
  scripts: Step[][] = []; // one per job that gets created
  statusBody: any = { ok: true, enabled: true, allowed: true, online: true, mood: "online", queue_depth: 0, used_today: 3, daily_cap: 150, limits: { question_chars: 4000, state_chars: 1500 } };
  statusHttp = 200;
  submitReply: null | { status: number; body: any } = null; // forced reply to POST /jobs
  failures: { when: "before" | "after"; match: RegExp }[] = [];
  fetchCostMs = 100;
  onReply: null | ((call: any) => void) = null;
  n = 0;

  fetch = async (input: any, init: any = {}) => {
    const url = new URL(String(input), "http://app.test");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const call = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, credentials: init.credentials, headers: init.headers };
    this.calls.push(call);
    this.clock.t += this.fetchCostMs;
    const idx = this.failures.findIndex((f) => f.match.test(`${method} ${url.pathname}`));
    const fail = idx >= 0 ? this.failures.splice(idx, 1)[0] : null;
    if (fail?.when === "before") throw new TypeError("Failed to fetch");
    const res = this.route(method, url, body);
    this.onReply?.(call);
    if (fail?.when === "after") throw new TypeError("Failed to fetch");
    return res;
  };

  route(method: string, url: URL, body: any): Response {
    const p = url.pathname;
    if (method === "GET" && p === "/api/faye/status") return jsonRes(this.statusHttp, this.statusBody);
    if (method === "POST" && p === "/api/faye/jobs") {
      if (this.submitReply) return jsonRes(this.submitReply.status, this.submitReply.body);
      const rid = body?.request_id;
      const existing = this.byRequest.get(rid);
      if (existing) return jsonRes(200, { ok: true, job_id: existing, status: this.jobs.get(existing).status, deduped: true });
      const id = UUID(++this.n);
      this.jobs.set(id, { id, kind: body.kind, request: body, status: "queued", seq: 0, events: [], result: null, error: null, steps: this.scripts.shift() ?? [], queuePos: 0 });
      this.byRequest.set(rid, id);
      return jsonRes(201, { ok: true, job_id: id, status: "queued", deduped: false, queue_ahead: 0, expires_at: "2026-10-20T14:04:00Z" });
    }
    let m = p.match(/^\/api\/faye\/jobs\/([^/]+)\/cancel$/);
    if (method === "POST" && m) {
      const j = this.jobs.get(m[1]);
      if (!j) return jsonRes(404, { ok: false, code: "not_found" });
      if (!["done", "failed", "expired", "cancelled"].includes(j.status)) j.status = "cancelled";
      return jsonRes(200, { ok: true, status: j.status });
    }
    m = p.match(/^\/api\/faye\/jobs\/([^/]+)$/);
    if (method === "GET" && m) {
      const j = this.jobs.get(m[1]);
      if (!j) return jsonRes(404, { ok: false, code: "not_found", error: "x" });
      const after = Number(url.searchParams.get("after") ?? 0);
      const final = ["done", "failed", "expired", "cancelled"].includes(j.status);
      if (!final) this.advance(j);
      const events = j.events.filter((e: any) => e.seq > after);
      const nowFinal = ["done", "failed", "expired", "cancelled"].includes(j.status);
      return jsonRes(200, {
        ok: true, job_id: j.id, kind: j.kind, status: j.status, events, last_seq: j.seq, more: false, queue_position: j.status === "queued" ? j.queuePos : null,
        done: nowFinal, result: j.status === "done" ? j.result : null, error: j.error, retracted: j.status === "done" && !!j.result?.provenance?.retracted,
      });
    }
    return jsonRes(404, { ok: false, code: "not_found" });
  }

  advance(j: any) {
    const s: Step | undefined = j.steps.shift();
    if (!s) return;
    if (s.queued !== undefined) { j.status = "queued"; j.queuePos = s.queued; }
    if (s.chunks) { j.status = "running"; for (const text of s.chunks) j.events.push({ seq: ++j.seq, ev: "chunk", text }); }
    if (s.retract !== undefined) { j.status = "running"; j.events.push({ seq: ++j.seq, ev: "retract", text: s.retract }); }
    if (s.done) { j.status = "done"; j.result = s.done; }
    if (s.fail) { j.status = "failed"; j.error = { code: s.fail, message: "server-built message" }; }
    if (s.expire) { j.status = "expired"; j.error = { code: "expired", message: "x" }; }
    if (s.cancelled) j.status = "cancelled";
  }

  deps() {
    return { fetchImpl: this.fetch as any, now: this.clock.now, sleep: this.clock.sleep, uuid: () => `request-${this.n}-${this.calls.length}` };
  }
}

const result = (text: string, extra: any = {}) => ({ kind: "generated", text, calls: null, state: null, action: null, provenance: { model: "gemma3:1b", memory_ids: [], memory_hash: null }, ...extra });

function collect() {
  const log: any[] = [];
  return {
    log,
    h: {
      onChunk: (d: string) => log.push(["chunk", d]),
      onRetract: (d: string) => log.push(["retract", d]),
      onQueue: (p: any) => log.push(["queue", p]),
      onRunning: () => log.push(["running"]),
    },
    text: () => {
      let s = "";
      for (const e of log) { if (e[0] === "chunk") s += e[1]; else if (e[0] === "retract") s = e[1]; }
      return s;
    },
  };
}

// ------------------------------------------------------------------ choosing the transport
t("transport kind: default is local; only the exact word mailbox turns the mailbox on", TR.resolveTransportKind(undefined) === "local" && TR.resolveTransportKind("") === "local" && TR.resolveTransportKind("true") === "local" && TR.resolveTransportKind("mailboxes") === "local" && TR.resolveTransportKind("local") === "local" && TR.resolveTransportKind(" Mailbox ") === "mailbox" && TR.resolveTransportKind("mailbox") === "mailbox");
t("with the env var unset the build-time kind is local and createTransport() is local", TR.TRANSPORT_KIND === "local" && TR.createTransport().kind === "local" && TR.createTransport("mailbox").kind === "mailbox");

// ------------------------------------------------------------------ mailbox: status
{
  const mb = new FakeMailbox();
  const tp = TR.createMailboxTransport(mb.deps());
  let s = await tp.status();
  t("status: allowed and online = available, with usage and limits", s.state === "available" && s.usedToday === 3 && s.dailyCap === 150 && s.questionChars === 4000, JSON.stringify(s));
  t("status: GET /api/faye/status with the cookie session and no wake by default", mb.calls[0].method === "GET" && mb.calls[0].path === "/api/faye/status" && eq(mb.calls[0].query, {}) && mb.calls[0].credentials === "same-origin");
  await tp.status({ wake: true });
  t("status: wake=1 is sent when asked", mb.calls[1].query.wake === "1");
  mb.statusBody = { ...mb.statusBody, online: false, mood: "offline" };
  t("status: allowed but no worker contact = offline", (await tp.status()).state === "offline");
  mb.statusBody = { ok: true, enabled: true, allowed: false, online: false, mood: "offline" };
  t("status: signed in but not an owner = not_allowed", (await tp.status()).state === "not_allowed");
  mb.statusBody = { ok: true, enabled: false, allowed: false, online: false, mood: "offline" };
  t("status: flag off = hidden", (await tp.status()).state === "hidden");
  mb.statusBody = { ok: false, code: "auth_required" }; mb.statusHttp = 401;
  t("status: 401 = not_allowed (hidden by the widget)", (await tp.status()).state === "not_allowed");
  mb.statusHttp = 404; mb.statusBody = null;
  t("status: 404 (routes not deployed) = hidden", (await tp.status()).state === "hidden");
  mb.statusHttp = 200; mb.statusBody = { ok: true, enabled: true, allowed: true, online: true };
  mb.failures.push({ when: "before", match: /GET \/api\/faye\/status/ });
  t("status: no connection = offline, not a crash", (await tp.status()).state === "offline");
  mb.statusHttp = 500; mb.statusBody = { ok: false, code: "server_error" };
  t("status: a 500 = offline", (await tp.status()).state === "offline");
}

// ------------------------------------------------------------------ mailbox: create a job and stream it
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ queued: 1 }, { queued: 0 }, { chunks: ["Hel"] }, { chunks: ["lo", " there"] }, { done: result("Hello there, friend.") }]);
  const tp = TR.createMailboxTransport(mb.deps());
  const c = collect();
  const state = { page: "Dellegate", portfolio: { positions: [{ symbol: "NVDA", assetClass: "equity", shares: 10, costBasisValue: 1200.5 }] } };
  const r = await tp.chat({ question: "What is GEX?", state }, c.h);
  const post = mb.calls[0];
  t("create: POST /api/faye/jobs as JSON with kind chat, question and state", post.method === "POST" && post.path === "/api/faye/jobs" && post.body.kind === "chat" && post.body.question === "What is GEX?" && eq(post.body.state, state) && post.credentials === "same-origin");
  t("create: sends a request_id of 8 to 64 safe characters and NO memory field", /^[A-Za-z0-9_-]{8,64}$/.test(post.body.request_id) && !("memory" in post.body));
  t("create: sends only request_id, kind, question, state", eq(Object.keys(post.body).sort(), ["kind", "question", "request_id", "state"]));
  t("poll: GET /api/faye/jobs/{id}?after=N&wait=8000", mb.calls.slice(1).every((x) => x.method === "GET" && x.path === `/api/faye/jobs/${UUID(1)}` && x.query.wait === "8000"));
  t("poll: `after` only moves forward (0,0,0,1,3)", eq(mb.calls.slice(1).map((x) => x.query.after), ["0", "0", "0", "1", "3"]), JSON.stringify(mb.calls.slice(1).map((x) => x.query.after)));
  t("stream: chunks arrive in order, once each", eq(c.log.filter((e) => e[0] === "chunk").map((e) => e[1]), ["Hel", "lo", " there"]));
  t("stream: queue position and running are reported", c.log.some((e) => e[0] === "queue" && e[1] === 1) && c.log.some((e) => e[0] === "queue" && e[1] === 0) && c.log.some((e) => e[0] === "running"));
  t("result: the final text is authoritative and the job id is the continue handle", r.text === "Hello there, friend." && r.kind === "generated" && r.ref === UUID(1) && r.retracted === false);
  t("result: only kind, text, calls, state, action, provenance are kept", eq(Object.keys(r).sort(), ["action", "calls", "kind", "provenance", "ref", "retracted", "state", "text"]));
}

// ------------------------------------------------------------------ long poll: empty replies, resume, dropped connections
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ idle: true }, { idle: true }, { chunks: ["one "] }, { idle: true }, { chunks: ["two"] }, { done: result("one two") }]);
  const tp = TR.createMailboxTransport(mb.deps());
  const c = collect();
  const r = await tp.chat({ question: "q", state: {} }, c.h);
  t("long poll: an empty reply (timeout) just asks again with the same `after`", eq(mb.calls.slice(1, 3).map((x) => x.query.after), ["0", "0"]) && c.text() === "one two" && r.text === "one two");
  t("long poll: no sleeping is needed for a normal empty reply", mb.clock.sleeps.length === 0);
}
{
  // Connection dropped BEFORE the server saw the poll, and AFTER the server handled it (the reply was lost).
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["alpha "] }, { chunks: ["beta "] }, { chunks: ["gamma"] }, { done: result("alpha beta gamma") }]);
  mb.failures.push({ when: "after", match: /GET \/api\/faye\/jobs\/.+/ }); // 1st poll: server advanced, reply lost
  const tp = TR.createMailboxTransport(mb.deps());
  const c = collect();
  // second poll fails before reaching the server
  setTimeout(() => {}, 0);
  mb.onReply = (call) => { if (call.method === "GET" && mb.calls.length === 2 && !mb.failures.length) mb.failures.push({ when: "before", match: /GET \/api\/faye\/jobs\/.+/ }); };
  const r = await tp.chat({ question: "q", state: {} }, c.h);
  t("resume: after dropped polls the text is complete and NOT duplicated", c.text() === "alpha beta gamma" && eq(c.log.filter((e) => e[0] === "chunk").map((e) => e[1]), ["alpha ", "beta ", "gamma"]), JSON.stringify(c.log));
  t("resume: the lost reply is asked for again with the same `after`", mb.calls[1].query.after === "0" && mb.calls[2].query.after === "0");
  t("resume: backoff sleeps 1 s then 2 s", eq(mb.clock.sleeps.slice(0, 2), [1000, 2000]), JSON.stringify(mb.clock.sleeps));
  t("resume: result is the final text", r.text === "alpha beta gamma");
}
{
  // A server that ignores `after` and resends old events must not duplicate text.
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["a"] }, { chunks: ["b"] }, { done: result("ab") }]);
  const realRoute = mb.route.bind(mb);
  mb.route = (m: string, u: URL, b: any) => { if (m === "GET") u.searchParams.set("after", "0"); return realRoute(m, u, b); };
  const tp = TR.createMailboxTransport(mb.deps());
  const c = collect();
  await tp.chat({ question: "q", state: {} }, c.h);
  t("resume: events already delivered (seq <= after) are ignored even if the server resends them", c.text() === "ab" && c.log.filter((e) => e[0] === "chunk").length === 2, JSON.stringify(c.log));
}
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ idle: true }]);
  mb.fetchCostMs = 60_000;
  const tp = TR.createMailboxTransport(mb.deps());
  mb.failures = Array.from({ length: 40 }, () => ({ when: "before" as const, match: /GET \/api\/faye\/jobs\/.+/ }));
  mb.fetchCostMs = 5_000;
  const err = await rejects(tp.chat({ question: "q", state: {} }, collect().h));
  t("a connection that stays dead for 45 s gives up with `unreachable`", err?.code === "unreachable", err?.message);
  t("backoff is capped at 4 s", Math.max(...mb.clock.sleeps) === 4000, JSON.stringify(mb.clock.sleeps));
}
{
  const mb = new FakeMailbox();
  mb.scripts.push(Array.from({ length: 200 }, () => ({ idle: true })));
  mb.fetchCostMs = 9_000;
  const tp = TR.createMailboxTransport(mb.deps());
  const err = await rejects(tp.chat({ question: "q", state: {} }, collect().h));
  t("a chat job that runs past 5 minutes is cancelled and reported as worker_lost", err?.code === "worker_lost" && mb.calls.some((c) => c.method === "POST" && c.path.endsWith("/cancel")), err?.message);
}

// ------------------------------------------------------------------ idempotent retry after a lost reply to the create call
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["ok"] }, { done: result("ok") }]);
  mb.failures.push({ when: "after", match: /POST \/api\/faye\/jobs$/ }); // the server created the job, the browser never heard
  const tp = TR.createMailboxTransport(mb.deps());
  const r = await tp.chat({ question: "q", state: {} }, collect().h);
  const posts = mb.calls.filter((c) => c.method === "POST" && c.path === "/api/faye/jobs");
  t("idempotent: the retry reuses the SAME request_id", posts.length === 2 && posts[0].body.request_id === posts[1].body.request_id);
  t("idempotent: the server holds exactly one job and the answer arrives once", mb.jobs.size === 1 && r.text === "ok" && r.ref === UUID(1));
  t("idempotent: the retry waited 1 s first", mb.clock.sleeps[0] === 1000);
}
{
  const mb = new FakeMailbox();
  mb.failures = Array.from({ length: 6 }, () => ({ when: "before" as const, match: /POST \/api\/faye\/jobs$/ }));
  const tp = TR.createMailboxTransport(mb.deps());
  const err = await rejects(tp.chat({ question: "q", state: {} }, collect().h));
  t("idempotent: after 4 failed attempts the create call gives up as `unreachable` (nothing queued)", err?.code === "unreachable" && mb.jobs.size === 0 && mb.calls.filter((c) => c.method === "POST").length === 4);
  const mb2 = new FakeMailbox();
  mb2.submitReply = { status: 502, body: null };
  const err2 = await rejects(TR.createMailboxTransport(mb2.deps()).chat({ question: "q", state: {} }, collect().h));
  t("idempotent: a gateway 502 is retried too, then reported", mb2.calls.length === 4 && err2?.code === "server_error", err2?.code);
}

// ------------------------------------------------------------------ errors from the create call (contract section 8)
{
  const cases: [number, any, string, RegExp][] = [
    [503, { ok: false, code: "faye_offline", error: "ignored server text" }, "faye_offline", /^Faye is resting right now\. Try again in a bit\.$/],
    [429, { ok: false, code: "rate_limited", detail: "daily_cap", retry_after_sec: 12 }, "rate_limited", /^Faye is busy or you hit today's limit\. Wait a moment and try again\. Try again in about 12 seconds\.$/],
    [413, { ok: false, code: "too_large" }, "too_large", /^That request is too large for Faye\. Ask a shorter question\.$/],
    [403, { ok: false, code: "not_allowed" }, "not_allowed", /^Faye is not available for this account\.$/],
    [400, { ok: false, code: "bad_request" }, "bad_request", /could not read that request/],
    [503, { ok: false, code: "disabled" }, "disabled", /switched off/],
    [401, { ok: false, code: "auth_required" }, "auth_required", /Sign in again/],
    [500, { ok: false, code: "server_error" }, "server_error", /went wrong/],
  ];
  for (const [status, body, code, msg] of cases) {
    const mb = new FakeMailbox();
    mb.submitReply = { status, body };
    const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
    const posts = mb.calls.filter((c) => c.method === "POST").length;
    t(`create error ${status} ${code}: code and plain message from the local table`, err?.code === code && msg.test(err.message), err?.message);
    t(`create error ${status} ${code}: ${["server_error"].includes(code) ? "retried" : "not retried"}`, posts === (code === "server_error" ? 4 : 1), String(posts));
  }
  const mb = new FakeMailbox();
  mb.submitReply = { status: 429, body: { ok: false, code: "rate_limited", retry_after_sec: 99999 } };
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
  t("create error: retry_after_sec is clamped", /3600 seconds/.test(err.message) && err.retryAfterSec === 3600, err.message);
  const mb3 = new FakeMailbox();
  mb3.submitReply = { status: 418, body: { ok: false, code: "<script>alert(1)</script>", error: "<img onerror=x>" } };
  const err3 = await rejects(TR.createMailboxTransport(mb3.deps()).chat({ question: "q", state: {} }, collect().h));
  t("create error: an unknown code never puts server text on screen", err3.code === "server_error" && !/script|img/.test(err3.message), err3.message);
}

// ------------------------------------------------------------------ errors that end a job
for (const [step, code, msg] of [
  [{ fail: "worker_lost" }, "worker_lost", /^Faye lost her train of thought\. Please ask again\.$/],
  [{ expire: true }, "expired", /^Faye did not pick that up in time, so I dropped it\. Please ask again\.$/],
  [{ fail: "generation_failed" }, "generation_failed", /Nothing was changed/],
  [{ fail: "too_large" }, "too_large", /too large/],
  [{ fail: "not_allowed" }, "not_allowed", /not available for this account/],
  [{ fail: "something_new" }, "generation_failed", /Nothing was changed/],
] as any) {
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["partial"] }, step]);
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
  t(`job ended ${JSON.stringify(step)}: code ${code} with the contract's friendly text (not the server's)`, err?.code === code && msg.test(err.message) && !/server-built/.test(err.message), err?.message);
}
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ done: { kind: "generated" } }]); // done without text
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
  t("a done job with no text is a failure, not a blank answer", err?.code === "generation_failed");
}

// ------------------------------------------------------------------ retract
{
  const mb = new FakeMailbox();
  const decline = "I can not tell you what to buy or sell. I can explain how each choice works.";
  mb.scripts.push([{ chunks: ["You should buy "] }, { chunks: ["NVDA now"] }, { retract: decline }, { done: result(decline, { kind: "guardrail", provenance: { retracted: true, memory_ids: [] } }) }]);
  const tp = TR.createMailboxTransport(mb.deps());
  const c = collect();
  const r = await tp.chat({ question: "q", state: {} }, c.h);
  t("retract: the handler is told to replace the WHOLE text and what is shown ends as the decline", c.text() === decline && c.log.some((e) => e[0] === "retract" && e[1] === decline));
  t("retract: result is flagged retracted with kind guardrail", r.retracted === true && r.kind === "guardrail" && r.text === decline);
  const out = await TR.runQuestion({ transport: TR.createMailboxTransport((() => { const m = new FakeMailbox(); m.scripts.push([{ chunks: ["Buy it"] }, { retract: decline }, { done: result(decline, { kind: "guardrail", provenance: { retracted: true } }) }]); return m.deps(); })()), question: "q", state: {} });
  t("retract: runQuestion gives the unsure face and a guardrail kind", out.unsure === true && out.retracted === true && out.kind === "guardrail" && out.text === decline);
  const mb2 = new FakeMailbox();
  mb2.scripts.push([{ chunks: ["Buy"] }, { retract: "" }, { done: result("", { kind: "guardrail", provenance: { retracted: true } }) }]);
  const out2 = await TR.runQuestion({ transport: TR.createMailboxTransport(mb2.deps()), question: "q", state: {} });
  t("retract: an empty replacement falls back to a scripted decline, never blank", out2.text === TR.RETRACT_FALLBACK && /can not tell you what to buy or sell/.test(out2.text));
  const mb3 = new FakeMailbox();
  mb3.scripts.push([{ chunks: ["Buy it"] }, { done: result("Redirect text.", { kind: "generated", provenance: {} }) }]);
  mb3.route = ((orig) => (m: string, u: URL, b: any) => { const r2 = orig(m, u, b); return r2; })(mb3.route.bind(mb3));
  const out3 = await TR.runQuestion({ transport: TR.createMailboxTransport(mb3.deps()), question: "q", state: {} });
  t("final text replaces anything streamed (the relay guard may rewrite it)", out3.text === "Redirect text.");
}

// ------------------------------------------------------------------ cancel
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["Part"] }, { chunks: ["ial"] }, { done: result("Partial") }]);
  const ac = new AbortController();
  const tp = TR.createMailboxTransport(mb.deps());
  const err = await rejects(tp.chat({ question: "q", state: {} }, { onChunk: () => ac.abort() }, ac.signal));
  const cancels = mb.calls.filter((c) => c.method === "POST" && c.path === `/api/faye/jobs/${UUID(1)}/cancel`);
  t("cancel: Stop sends POST /cancel with a JSON body and reports `cancelled`", err?.code === "cancelled" && cancels.length === 1 && eq(cancels[0].body, {}));
  t("cancel: polling stops after Stop", mb.calls[mb.calls.length - 1].path.endsWith("/cancel"));
}
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ chunks: ["x"] }]);
  const ac = new AbortController();
  mb.onReply = (call) => { if (call.method === "POST" && call.path === "/api/faye/jobs") ac.abort(); }; // Stop pressed while the create call is in flight
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h, ac.signal));
  t("cancel: Stop pressed while the job is being created still cancels it (no stuck 'one at a time' slot)", err?.code === "cancelled" && mb.jobs.get(UUID(1))?.status === "cancelled");
}
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ cancelled: true }]);
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
  t("cancel: a job the server reports cancelled ends as `cancelled`", err?.code === "cancelled");
}

// ------------------------------------------------------------------ continue (next hop of a tool plan)
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ done: result("Final.", { kind: "final" }) }]);
  const tp = TR.createMailboxTransport(mb.deps());
  const r = await tp.continue({ state: { s: 1 }, results: { c1: { ok: true, status: 200, data: {}, error: null } }, parentRef: UUID(7) }, collect().h);
  const post = mb.calls[0];
  t("continue: POST kind continue with parent_job_id, state and results (no question)", post.body.kind === "continue" && post.body.parent_job_id === UUID(7) && eq(post.body.state, { s: 1 }) && post.body.results.c1.ok === true && !("question" in post.body) && !("memory" in post.body));
  t("continue: result carries kind and text", r.kind === "final" && r.text === "Final.");
  const err = await rejects(tp.continue({ state: {}, results: {} }, collect().h));
  t("continue: a missing or malformed parent handle is refused before any request", err?.code === "bad_request" && mb.calls.length === 2);
  const err2 = await rejects(tp.continue({ state: {}, results: {}, parentRef: "../../etc" }, collect().h));
  t("continue: a parent handle that is not a job id never reaches a URL", err2?.code === "bad_request");
}
{
  const mb = new FakeMailbox();
  mb.scripts.push([{ done: result("x") }]);
  mb.route = ((orig) => (m: string, u: URL, b: any) => { const r = orig(m, u, b); return m === "POST" && u.pathname === "/api/faye/jobs" ? jsonRes(201, { ok: true, job_id: "../../admin", status: "queued" }) : r; })(mb.route.bind(mb));
  const err = await rejects(TR.createMailboxTransport(mb.deps()).chat({ question: "q", state: {} }, collect().h));
  t("a job id from the server that is not a UUID-like string is never put in a URL", err && !mb.calls.some((c) => /admin/.test(c.path)), err?.code);
}

// ------------------------------------------------------------------ local transport: today's behaviour
const enc = new TextEncoder();
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
function sseResponse(parts: string[]) {
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function localWorld(turns: any[], toolLog: string[] = []) {
  const calls: any[] = [];
  let i = 0;
  const fetchImpl = async (url: any, init: any = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? "GET", body: typeof init.body === "string" ? JSON.parse(init.body) : null, headers: init.headers });
    if (u === TR.STATUS_URL) return jsonRes(200, { runtime: { status: "AVAILABLE" } });
    if (u === TR.CHAT_URL) {
      const turn = turns[i++];
      const stream = frame("chunk", { text: turn.chunks?.[0] ?? "" }) + (turn.chunks ?? []).slice(1).map((x: string) => frame("chunk", { text: x })).join("") + frame("done", { kind: turn.kind, calls: turn.calls, state: turn.state, action: turn.action });
      // Split the stream at an awkward place on purpose.
      const cut = Math.floor(stream.length / 2);
      return sseResponse([stream.slice(0, cut), stream.slice(cut)]);
    }
    if (u === TR.CONTINUE_URL) {
      const turn = turns[i++];
      return jsonRes(200, { ok: true, kind: turn.kind, text: turn.text, calls: turn.calls, state: turn.state, action: turn.action });
    }
    if (u.startsWith("/api/")) { toolLog.push(u); return jsonRes(200, { ok: true, data: 1 }); }
    return jsonRes(404, {});
  };
  return { fetchImpl, calls };
}

{
  const w = localWorld([{ kind: "generated", chunks: ["Hello ", "world"] }]);
  const tp = TR.createLocalTransport({ fetchImpl: w.fetchImpl as any });
  t("local status: AVAILABLE = available; GET /pilp/status on 127.0.0.1:7810", (await tp.status()).state === "available" && w.calls[0].url === "http://127.0.0.1:7810/pilp/status");
  const c = collect();
  const r = await tp.chat({ question: "What is GEX?", state: { page: "Dellegate" } }, c.h);
  t("local chat: POST /pilp/chat with exactly {question, state, stream: true}", w.calls[1].url === "http://127.0.0.1:7810/pilp/chat" && w.calls[1].method === "POST" && eq(w.calls[1].body, { question: "What is GEX?", state: { page: "Dellegate" }, stream: true }));
  t("local chat: SSE split mid-event still gives each chunk once and the done kind", c.text() === "Hello world" && r.text === "Hello world" && r.kind === "generated" && r.retracted === false && r.ref === undefined);
  const bad = TR.createLocalTransport({ fetchImpl: (async () => { throw new TypeError("Failed to fetch"); }) as any });
  t("local status: nothing listening = hidden (the widget draws nothing, as before)", (await bad.status()).state === "hidden");
  const e1 = await rejects(bad.chat({ question: "q", state: {} }, collect().h));
  t("local chat: nothing listening = `unreachable`", e1?.code === "unreachable");
  const downStatus = TR.createLocalTransport({ fetchImpl: (async () => jsonRes(200, { runtime: { status: "STARTING" } })) as any });
  t("local status: any status other than AVAILABLE = hidden", (await downStatus.status()).state === "hidden");
  const errStream = TR.createLocalTransport({ fetchImpl: (async () => sseResponse([frame("chunk", { text: "par" }), frame("error", { error: "The model is not loaded." })])) as any });
  const e2 = await rejects(errStream.chat({ question: "q", state: {} }, collect().h));
  t("local chat: a server `error` event shows the server's own message", e2?.code === "generation_failed" && e2.message === "The model is not loaded.");
  const noBody = TR.createLocalTransport({ fetchImpl: (async () => new Response(null, { status: 200 })) as any });
  t("local chat: no response stream is reported", (await rejects(noBody.chat({ question: "q", state: {} }, collect().h)))?.message === "Faye returned no response stream.");
  const endless = TR.createLocalTransport({ fetchImpl: (async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 60; i++) c.enqueue(enc.encode("x".repeat(100_000))); c.close(); } }))) as any });
  t("local chat: a hostile endless stream is cut off", /larger than expected/.test((await rejects(endless.chat({ question: "q", state: {} }, collect().h)))?.message ?? ""));
  const cont = localWorld([{ kind: "final", text: "All done.", action: null }]);
  const rc = await TR.createLocalTransport({ fetchImpl: cont.fetchImpl as any }).continue({ state: { a: 1 }, results: { c: { ok: true } } }, collect().h);
  t("local continue: POST /pilp/continue with exactly {state, results}", cont.calls[0].url === TR.CONTINUE_URL && eq(cont.calls[0].body, { state: { a: 1 }, results: { c: { ok: true } } }) && rc.text === "All done." && rc.kind === "final");
  const notOk = TR.createLocalTransport({ fetchImpl: (async () => jsonRes(200, { ok: false, error: "Run expired." })) as any });
  t("local continue: ok:false shows the server's error", (await rejects(notOk.continue({ state: {}, results: {} }, collect().h)))?.message === "Run expired.");
  const ac = new AbortController();
  const slow = TR.createLocalTransport({ fetchImpl: (async (_u: any, init: any) => { ac.abort(); throw new DOMException("aborted", "AbortError"); }) as any });
  t("local chat: Stop gives `cancelled`", (await rejects(slow.chat({ question: "q", state: {} }, collect().h, ac.signal)))?.code === "cancelled");
}

// ------------------------------------------------------------------ the same guards through BOTH transports
const call = (id: string, extra: any = {}) => ({ id, tool: "macro_overview", agent: "Research", method: "GET", path: "/api/macro-overview", params: {}, ...extra });
const goodOrder = { type: "paper_order", params: { symbol: "qqq", assetClass: "equity", side: "buy", orderType: "market", quantity: 90000, attribution: { strategyLabel: "x" } }, confirm_text: "I'll place a PAPER market buy of 10 share(s) of SPY" };

/** Run one scripted conversation through the local transport and through the mailbox, and return both outcomes plus the tool URLs fetched. */
async function both(turns: any[]) {
  const outcomes: any[] = [];
  for (const kind of ["local", "mailbox"]) {
    const tools: string[] = [];
    let transport: any, fetchImpl: any;
    if (kind === "local") {
      const w = localWorld(turns, tools);
      transport = TR.createLocalTransport({ fetchImpl: w.fetchImpl as any });
      fetchImpl = w.fetchImpl;
    } else {
      const mb = new FakeMailbox();
      for (const turn of turns) {
        const steps: Step[] = [];
        if (turn.chunks) steps.push({ chunks: turn.chunks });
        steps.push({ done: result(turn.chunks ? turn.chunks.join("") : turn.text, { kind: turn.kind, calls: turn.calls ?? null, state: turn.state ?? null, action: turn.action ?? null }) });
        mb.scripts.push(steps);
      }
      transport = TR.createMailboxTransport(mb.deps());
      const base = mb.fetch;
      fetchImpl = async (u: any, init: any) => { if (String(u).startsWith("/api/faye")) return base(u, init); if (String(u).startsWith("/api/")) { tools.push(String(u)); return jsonRes(200, { ok: true, data: 1 }); } return jsonRes(404, {}); };
    }
    let outcome: any;
    try {
      outcome = await TR.runQuestion({ transport, question: "q", state: {}, fetchImpl });
    } catch (e: any) {
      outcome = { thrown: e.message };
    }
    outcomes.push({ kind, outcome, tools });
  }
  return outcomes;
}
const same = (a: any, b: any) => JSON.stringify(a.outcome) === JSON.stringify(b.outcome) && JSON.stringify(a.tools) === JSON.stringify(b.tools);

{
  // Plan: one allowed call and one not on the allowlist, then a final answer that proposes a paper order.
  const turns = [
    { kind: "tool_calls", chunks: ["Let me look."], calls: [call("a"), call("b", { path: "/api/paper-trading/order", method: "POST", body: { entries: [{ symbol: "A", assetClass: "equity" }] } })], state: { s: 1 } },
    { kind: "final", text: "Here is the picture.", action: goodOrder },
  ];
  const [l, m] = await both(turns);
  t("parity: a plan through both transports runs ONLY the allowlisted tool", eq(l.tools, ["/api/macro-overview"]) && eq(m.tools, ["/api/macro-overview"]), JSON.stringify([l.tools, m.tools]));
  t("parity: the blocked call is logged as failed (unsure face) the same way", l.outcome.toolLog?.some((x: string) => /blocked: not an allowed read-only tool/.test(x)) && l.outcome.unsure === true && same(l, m), JSON.stringify([l.outcome, m.outcome]));
  t("parity: the paper-order card is built from the VALIDATED order, not the server's sentence", /90000 share\(s\) of QQQ/.test(l.outcome.action?.summary) && !/SPY/.test(l.outcome.action?.summary) && l.outcome.action.params.attribution.origin === "faye" && same(l, m));
  t("parity: the final turn is kind final and the whole outcome is identical", l.outcome.kind === "final" && JSON.stringify(l.outcome) === JSON.stringify(m.outcome));
}
{
  const [l, m] = await both([{ kind: "tool_calls", text: "x", chunks: ["x"], calls: Array.from({ length: 17 }, (_, i) => call("c" + i)), state: { s: 1 } }]);
  t("parity: a 17-call plan is refused before anything is fetched, through both", /limit 16/.test(l.outcome.thrown) && /limit 16/.test(m.outcome.thrown) && l.tools.length === 0 && m.tools.length === 0, JSON.stringify([l.outcome, m.outcome]));
}
{
  const [l, m] = await both([{ kind: "tool_calls", chunks: ["x"], calls: [call("a"), call("a")], state: { s: 1 } }]);
  t("parity: a plan that reuses a step id is refused through both", /reused a step id/.test(l.outcome.thrown) && /reused a step id/.test(m.outcome.thrown));
}
{
  const [l, m] = await both([{ kind: "generated", chunks: ["Order placed."], action: { type: "paper_order", params: { symbol: "../x", assetClass: "equity", side: "buy", orderType: "market", quantity: 1 } } }]);
  t("parity: a bad first-turn paper order offers no card and says why, through both", l.outcome.action === null && /failed validation/.test(l.outcome.text) && same(l, m), JSON.stringify([l.outcome, m.outcome]));
}
{
  const [l, m] = await both([{ kind: "action_proposal", chunks: ["I can add that."], action: { type: "add_holding", params: { symbol: "voo", assetClass: "equity", shares: 5, costBasisPerShare: 400, acquiredDate: "2026-10-01" } } }]);
  t("parity: a good add_holding proposal is normalised and offered, through both", l.outcome.action?.params.symbol === "VOO" && same(l, m));
}
{
  const [l, m] = await both([{ kind: "tool_calls", chunks: ["x"], calls: [call("a")], state: { s: 1 } }, { kind: "final", text: "Done.", action: { type: "remove_holding", params: { symbol: "VOO" } } }]);
  t("parity: only a paper order can end a run; any other final action is dropped, through both", l.outcome.action === null && m.outcome.action === null && l.outcome.text === "Done." && same(l, m), JSON.stringify([l.outcome, m.outcome]));
}
{
  const [l, m] = await both([{ kind: "generated", chunks: ["I am not sure about that."] }]);
  t("unsure: Faye saying she is unsure wears the unsure face through both", l.outcome.unsure === true && m.outcome.unsure === true);
  const [l2] = await both([{ kind: "generated", chunks: ["The expense ratio is the yearly fee."] }]);
  t("unsure: a plain answer does not", l2.outcome.unsure === false);
}
{
  // Mailbox only: the provenance memory ids count, never memory text.
  const mb = new FakeMailbox();
  mb.scripts.push([{ done: result("Hi.", { provenance: { memory_ids: ["a", "b", 5], memory_hash: "h" } }) }]);
  const out = await TR.runQuestion({ transport: TR.createMailboxTransport(mb.deps()), question: "q", state: {} });
  t("notes used: counts memory_ids from provenance (strings only)", out.notesUsed === 2);
}

// ------------------------------------------------------------------ pure helpers
{
  const base = { status: "available", sending: false, phase: null, typing: false, celebrating: false, errorCode: null, unsure: false };
  const m = (o: any) => TR.deriveMood({ ...base, ...o });
  t("mood: idle by default", m({}) === "idle");
  t("mood: listening while the user types", m({ typing: true }) === "listening");
  t("mood: thinking until the first chunk (queued, thinking, tools)", m({ sending: true, phase: "thinking" }) === "thinking" && m({ sending: true, phase: "queued" }) === "thinking" && m({ sending: true, phase: "tools" }) === "thinking");
  t("mood: speaking while chunks stream", m({ sending: true, phase: "speaking" }) === "speaking");
  t("mood: unsure after an unsure answer or a retract", m({ unsure: true }) === "unsure");
  t("mood: celebrating briefly on a good outcome", m({ celebrating: true }) === "celebrating");
  t("mood: offline when the status says so, over everything", m({ status: "offline", sending: true, phase: "speaking", typing: true }) === "offline");
  t("mood: error after a failed job, but not for offline or Stop", m({ errorCode: "worker_lost" }) === "error" && m({ errorCode: "generation_failed" }) === "error" && m({ errorCode: "faye_offline" }) === "idle" && m({ errorCode: "cancelled" }) === "idle");
  t("mood: typing wins over an old error or unsure face", m({ typing: true, errorCode: "worker_lost", unsure: true }) === "listening");
  t("mood: every result is one of the avatar's eight moods", ["idle", "listening", "thinking", "speaking", "unsure", "celebrating", "offline", "error"].includes(m({ errorCode: "x" })));
  t("looksUnsure: retract, failed tool, uncertainty phrase; not a plain answer", TR.looksUnsure({ text: "x", retracted: true }) && TR.looksUnsure({ text: "x", toolLog: ["a: failed (b)"] }) && TR.looksUnsure({ text: "I'm not sure." }) && TR.looksUnsure({ text: "That is my reading, not a fact." }) && !TR.looksUnsure({ text: "Gamma is the rate of change of delta.", toolLog: ["a: ok"] }));
  t("offline re-check: grows then stops (no endless polling)", TR.nextOfflineRecheckMs(0) === 4000 && TR.nextOfflineRecheckMs(7) === 20000 && TR.nextOfflineRecheckMs(8) === null && TR.nextOfflineRecheckMs(-1) === null);
  t("request ids fit the contract", /^[A-Za-z0-9_-]{8,64}$/.test(TR.newRequestId()) && TR.newRequestId() !== TR.newRequestId());
  t("an offline-ish error never carries notes text unless notes exist", !/notes/.test(new TR.FayeTransportError("faye_offline").message) && /notes are still here/.test(new TR.FayeTransportError("faye_offline", { notesExist: true }).message));
}

// ------------------------------------------------------------------ copy: honest and plain
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
  return 0.39 * (words.length / sentences.length) + 11.8 * (sy / words.length) - 15.59;
}
{
  for (const [name, txt] of Object.entries({ COPY_MAILBOX: TR.COPY_MAILBOX, COPY_MAILBOX_SHORT: TR.COPY_MAILBOX_SHORT, COPY_LOCAL: TR.COPY_LOCAL, COPY_EMPTY: TR.COPY_EMPTY })) {
    t(`copy reading level: ${name} is grade 8 or lower (Flesch-Kincaid ${grade(txt as string).toFixed(1)})`, grade(txt as string) <= 8);
  }
  for (const code of Object.keys(TR.FAYE_MESSAGES)) t(`copy reading level: message ${code} is grade 8 or lower`, grade(TR.FAYE_MESSAGES[code]) <= 8, grade(TR.FAYE_MESSAGES[code]).toFixed(1));
  t("mailbox copy says plainly: educational, not advice; up to 24 hours; then deleted; holdings travel", /educational, not advice/i.test(TR.COPY_MAILBOX) && /up to 24 hours/.test(TR.COPY_MAILBOX) && /deleted/.test(TR.COPY_MAILBOX) && /holdings/.test(TR.COPY_MAILBOX) && /database/.test(TR.COPY_MAILBOX));
  t("mailbox copy no longer claims Faye runs on your own computer or that data is never saved", !/own computer|never saved|never leave/i.test(TR.COPY_MAILBOX + TR.COPY_MAILBOX_SHORT));
  t("local copy keeps its true statements and adds 'educational, not advice'", /own computer/.test(TR.COPY_LOCAL) && /never saved/.test(TR.COPY_LOCAL) && /educational, not advice/i.test(TR.COPY_LOCAL));
  t("the contract's friendly sentences are used word for word", TR.FAYE_MESSAGES.rate_limited === "Faye is busy or you hit today's limit. Wait a moment and try again." && TR.FAYE_MESSAGES.worker_lost === "Faye lost her train of thought. Please ask again." && TR.FAYE_MESSAGES.expired === "Faye did not pick that up in time, so I dropped it. Please ask again." && TR.FAYE_MESSAGES.not_allowed === "Faye is not available for this account." && TR.FAYE_MESSAGES.too_large === "That request is too large for Faye. Ask a shorter question.");
  t("offline text: the contract's sentence without the notes claim", TR.FAYE_MESSAGES.faye_offline === "Faye is resting right now. Try again in a bit.");
}

// ------------------------------------------------------------------ the transport source itself
{
  const src = readFileSync(new URL("../src/lib/faye/transport.ts", import.meta.url), "utf8");
  t("transport: no direct Supabase calls and no service keys", !/supabase|service_role|rest\/v1|rpc\//i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")));
  t("transport: no innerHTML or eval", !/innerHTML|eval\(|new Function/.test(src));
  t("transport: reads NEXT_PUBLIC_FAYE_TRANSPORT as a literal so Next can inline it", /process\.env\.NEXT_PUBLIC_FAYE_TRANSPORT/.test(src));
  t("transport: the mailbox calls only same-origin /api/faye/ paths", [...src.matchAll(/"(\/api\/faye[^"]*)"/g)].every((x) => x[1].startsWith("/api/faye/")));
}

console.log(failed ? `\n${failed} FAILED` : "\nall faye-transport checks passed");
process.exit(failed ? 1 : 0);
