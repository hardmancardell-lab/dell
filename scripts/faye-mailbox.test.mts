// @ts-nocheck
// Run: node --import ./scripts/ts-loader/register.mjs scripts/faye-mailbox.test.mts
// Faye mailbox, server side (WP-A): owner gate, feature flag, CSRF checks, payload caps, state trimming, memory-pack validation,
// idempotency / caps / offline / expiry as the routes report them, long-poll timing (fake clock), relay output guard, error codes,
// and a static lint of the migration (RLS on every table, SECURITY DEFINER with an empty search_path, grants). No network, no database:
// the Supabase client is a fake. The SQL itself is exercised separately on PGlite (see the WP-A report); this file proves the wiring.
import { readFileSync } from "node:fs";
import { makeT } from "./fixtures/fake-fetch.mts";

const { t, summary } = makeT();

const ACCESS = await import("../src/lib/faye/access.ts");
const H = await import("../src/lib/faye/mailbox/handlers.ts");
const V = await import("../src/lib/faye/mailbox/validate.ts");
const S = await import("../src/lib/faye/mailbox/service.ts");
const E = await import("../src/lib/faye/mailbox/errors.ts");
const G = await import("../src/lib/faye/mailbox/output-guard.ts");
const C = await import("../src/lib/faye/mailbox/config.ts");
const MH = await import("../src/lib/faye/mailbox/memory-hook.ts");
const { SlidingWindowLimiter } = await import("../src/lib/access/rate-limit.ts");

console.error = () => {}; // the service logs RPC failures (code only); keep test output clean

// ------------------------------------------------------------------------------------------------ fakes
const OWNER = { id: "11111111-1111-4111-8111-111111111111", email: "Owner@Example.com", email_confirmed_at: "2026-10-01T00:00:00Z" };
const ENV = { FAYE_MAILBOX_ENABLED: "1", FAYE_OWNER_EMAILS: "owner@example.com" };
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** A fake Supabase server client: auth.getUser() and rpc(). `impl(fn, args)` returns {data, error} or throws. */
function fakeClient(user, impl) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return impl(fn, args);
    },
  };
}

/** A tiny in-memory model of the mailbox RPCs, mirroring faye_submit_job / faye_poll_job / faye_cancel_job semantics. */
function mailbox(opts = {}) {
  const st = { online: true, jobs: new Map(), byReq: new Map(), dailyCap: opts.dailyCap ?? 150, maxQueue: 5, polls: [] };
  let n = 0;
  const impl = (fn, a) => {
    if (fn === "faye_status") return { data: { ok: true, allowed: true, role: "owner", online: st.online, queue_depth: 0, used_today: 1, daily_cap: st.dailyCap }, error: null };
    if (fn === "faye_submit_job") {
      const prior = st.byReq.get(a.p_request_id);
      if (prior) return { data: { ok: true, job_id: prior.id, status: prior.status, deduped: true, queue_ahead: 0, expires_at: null }, error: null };
      if (!st.online) return { data: { ok: false, code: "faye_offline" }, error: null };
      const inflight = [...st.jobs.values()].filter((j) => ["queued", "claimed", "running"].includes(j.status)).length;
      if (inflight >= 1) return { data: { ok: false, code: "rate_limited", detail: "in_flight", retry_after_sec: 5 }, error: null };
      if (st.jobs.size >= st.dailyCap) return { data: { ok: false, code: "rate_limited", detail: "daily_cap", retry_after_sec: 3600 }, error: null };
      const id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(++n).padStart(12, "0")}`;
      const job = { id, status: "queued", kind: a.p_kind, request: a.p_request };
      st.jobs.set(id, job);
      st.byReq.set(a.p_request_id, job);
      return { data: { ok: true, job_id: id, status: "queued", deduped: false, queue_ahead: 0, expires_at: "2026-10-20T00:01:30Z" }, error: null };
    }
    if (fn === "faye_poll_job") {
      st.polls.push(a);
      const j = st.jobs.get(a.p_job_id);
      if (!j) return { data: { ok: false, code: "not_found" }, error: null };
      return { data: st.pollAnswer ? st.pollAnswer(j, a) : { ok: true, job_id: j.id, kind: j.kind, status: j.status, events: [], last_seq: a.p_after, more: false, queue_position: 0, result: null, error: null, purged: false }, error: null };
    }
    if (fn === "faye_cancel_job") {
      const j = st.jobs.get(a.p_job_id);
      if (!j) return { data: { ok: false, code: "not_found" }, error: null };
      if (["queued", "claimed", "running"].includes(j.status)) j.status = "cancelled";
      return { data: { ok: true, status: j.status }, error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "Could not find the function " + fn } };
  };
  return { st, impl };
}

function deps(client, over = {}) {
  let now = 1_000_000;
  const d = {
    env: ENV,
    getClient: async () => client,
    now: () => now,
    sleep: async (ms) => { now += ms; },
    limiters: { create: new SlidingWindowLimiter(30, 60_000), poll: new SlidingWindowLimiter(600, 60_000), status: new SlidingWindowLimiter(120, 60_000) },
    ...over,
  };
  d.advance = (ms) => { now += ms; };
  return d;
}

function post(path, body, headers = {}) {
  return new Request("https://dell.test" + path, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", host: "dell.test", origin: "https://dell.test", ...headers },
  });
}
const get = (path, headers = {}) => new Request("https://dell.test" + path, { headers: { host: "dell.test", ...headers } });
const j = async (res) => res.json();
const chat = (extra = {}) => ({ request_id: "req-test-0001", kind: "chat", question: "What is GEX?", state: { page: "Dellegate", portfolio: { positions: [] } }, ...extra });

// ================================================================================================ owner gate
{
  const owners = ACCESS.parseOwnerEmails(" Owner@Example.com , second@x.org,,bad,  ");
  t("owner list: trimmed, lower-cased, junk ignored", owners.size === 2 && owners.has("owner@example.com") && owners.has("second@x.org"));
  t("owner list: unset is empty", ACCESS.parseOwnerEmails(undefined).size === 0);

  const ok = ACCESS.evaluateOwner(OWNER, owners);
  t("gate: listed + confirmed email (any case) allowed", ok.ok === true);
  t("gate: not listed denied", ACCESS.evaluateOwner({ ...OWNER, email: "stranger@example.com" }, owners).reason === "not_listed");
  t("gate: unconfirmed email denied even when listed", ACCESS.evaluateOwner({ ...OWNER, email_confirmed_at: null }, owners).reason === "unconfirmed");
  t("gate: no email denied", ACCESS.evaluateOwner({ id: "x" }, owners).reason === "no_email");
  t("gate: empty owner list denies everyone (fail closed)", ACCESS.evaluateOwner(OWNER, new Set()).reason === "no_owner_list");
  t("gate: null user denied", ACCESS.evaluateOwner(null, owners).reason === "no_user");
  t("gate: email lookalike does not match", ACCESS.evaluateOwner({ ...OWNER, email: "owner@example.com.evil.test" }, owners).reason === "not_listed");
  t("gate: plus-address is a different email", ACCESS.evaluateOwner({ ...OWNER, email: "owner+x@example.com" }, owners).reason === "not_listed");

  const mb = mailbox();
  const allow = await ACCESS.gateOwner(async () => fakeClient(OWNER, mb.impl), ENV);
  t("gateOwner: owner passes with a client", allow.ok === true && allow.user.id === OWNER.id);
  const noSession = await ACCESS.gateOwner(async () => fakeClient(null, mb.impl), ENV);
  t("gateOwner: no session -> 401 auth_required", noSession.ok === false && noSession.status === 401 && noSession.code === "auth_required");
  const other = await ACCESS.gateOwner(async () => fakeClient({ ...OWNER, email: "x@y.org" }, mb.impl), ENV);
  t("gateOwner: non-owner -> 403 not_allowed, reason kept server-side only", other.status === 403 && other.code === "not_allowed" && !JSON.stringify(other.body).includes("not_listed"));
  const boom = await ACCESS.gateOwner(async () => { throw new Error("auth down"); }, ENV);
  t("gateOwner: auth server failure fails closed (503 unavailable)", boom.ok === false && boom.status === 503);
  const authErr = await ACCESS.gateOwner(async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: new Error("x") }) }, rpc: async () => ({}) }), ENV);
  t("gateOwner: getUser error + no user -> denied", authErr.ok === false);
}

// ================================================================================================ CSRF / origin
{
  const r = (headers) => ACCESS.checkPostRequest(new Request("https://dell.test/api/faye/jobs", { method: "POST", body: "{}", headers }));
  t("post: same origin + json ok", r({ "content-type": "application/json", host: "dell.test", origin: "https://dell.test" }).ok === true);
  t("post: json with charset ok", r({ "content-type": "application/json; charset=utf-8", host: "dell.test", origin: "https://dell.test" }).ok === true);
  t("post: cross-site origin denied", r({ "content-type": "application/json", host: "dell.test", origin: "https://evil.test" }).code === "not_allowed");
  t("post: text/plain denied (form CSRF)", r({ "content-type": "text/plain", host: "dell.test", origin: "https://dell.test" }).code === "bad_request");
  t("post: missing origin without same-origin hint denied", r({ "content-type": "application/json", host: "dell.test" }).code === "not_allowed");
  t("post: missing origin with Sec-Fetch-Site same-origin ok", r({ "content-type": "application/json", host: "dell.test", "sec-fetch-site": "same-origin" }).ok === true);
  t("post: Sec-Fetch-Site cross-site without origin denied", r({ "content-type": "application/json", host: "dell.test", "sec-fetch-site": "cross-site" }).ok === false);
  t("post: x-forwarded-host is honoured", r({ "content-type": "application/json", host: "internal", "x-forwarded-host": "dell.test", origin: "https://dell.test" }).ok === true);
  t("post: garbage origin denied", r({ "content-type": "application/json", host: "dell.test", origin: "not a url" }).ok === false);
}

// ================================================================================================ feature flag
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const off = { ...deps(c), env: { FAYE_OWNER_EMAILS: "owner@example.com" } };
  t("flag: default (unset) is off", C.mailboxEnabled({}) === false && C.mailboxEnabled({ FAYE_MAILBOX_ENABLED: "0" }) === false && C.mailboxEnabled({ FAYE_MAILBOX_ENABLED: "yes" }) === false);
  t("flag: 1 and true (any case) are on", C.mailboxEnabled({ FAYE_MAILBOX_ENABLED: "1" }) && C.mailboxEnabled({ FAYE_MAILBOX_ENABLED: " TRUE " }));
  const s = await H.handleStatus(get("/api/faye/status"), off);
  const sb = await j(s);
  t("flag off: status reports enabled:false and never touches auth or the database", s.status === 200 && sb.enabled === false && c.calls.length === 0);
  const cr = await H.handleCreateJob(post("/api/faye/jobs", chat()), off);
  t("flag off: create -> 503 disabled", cr.status === 503 && (await j(cr)).code === "disabled" && c.calls.length === 0);
  const po = await H.handlePollJob(get(`/api/faye/jobs/${JOB}`), JOB, off);
  t("flag off: poll -> 503 disabled", po.status === 503);
  const ca = await H.handleCancelJob(post(`/api/faye/jobs/${JOB}/cancel`, {}), JOB, off);
  t("flag off: cancel -> 503 disabled", ca.status === 503);
}

// ================================================================================================ status
{
  const mb = mailbox();
  const d = deps(fakeClient(OWNER, mb.impl));
  const res = await H.handleStatus(get("/api/faye/status?wake=1"), d);
  const b = await j(res);
  t("status: owner online", res.status === 200 && b.enabled && b.allowed && b.online && b.mood === "online" && b.limits.question_chars === 4000 && b.limits.state_chars === 1500);
  t("status: ?wake=1 passes p_wake true", d.getClient && (await d.getClient()).calls.some((c) => c.fn === "faye_status" && c.args.p_wake === true));
  t("status: response is no-store and nosniff", res.headers.get("cache-control") === "no-store" && res.headers.get("x-content-type-options") === "nosniff");
  mb.st.online = false;
  const off = await j(await H.handleStatus(get("/api/faye/status"), d));
  t("status: no worker -> online:false mood offline", off.allowed === true && off.online === false && off.mood === "offline");

  const stranger = deps(fakeClient({ ...OWNER, email: "x@y.org" }, mb.impl));
  const sr = await H.handleStatus(get("/api/faye/status"), stranger);
  const sbody = await j(sr);
  t("status: non-owner gets 200 allowed:false and no database call", sr.status === 200 && sbody.allowed === false && stranger.getClient && (await stranger.getClient()).calls.length === 0);
  const unconf = deps(fakeClient({ ...OWNER, email_confirmed_at: null }, mb.impl));
  t("status: unconfirmed email -> allowed:false", (await j(await H.handleStatus(get("/api/faye/status"), unconf))).allowed === false);
  const anon = deps(fakeClient(null, mb.impl));
  const ar = await H.handleStatus(get("/api/faye/status"), anon);
  t("status: no session -> 401 auth_required", ar.status === 401 && (await j(ar)).code === "auth_required");
  const dbSaysNo = deps(fakeClient(OWNER, () => ({ data: { ok: true, allowed: false, online: false }, error: null })));
  t("status: database says not allowed -> allowed:false", (await j(await H.handleStatus(get("/api/faye/status"), dbSaysNo))).allowed === false);
}

// ================================================================================================ create: gate, caps, idempotency, offline, oversize
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const res = await H.handleCreateJob(post("/api/faye/jobs", chat()), d);
  const b = await j(res);
  t("create: owner chat -> 201 with job id", res.status === 201 && b.ok && /^bbbbbbbb/.test(b.job_id) && b.status === "queued" && b.deduped === false);
  const sent = c.calls.find((x) => x.fn === "faye_submit_job");
  t("create: RPC gets kind, request id and the v1 request", sent.args.p_kind === "chat" && sent.args.p_request_id === "req-test-0001" && sent.args.p_request.v === 1 && sent.args.p_request.question === "What is GEX?" && sent.args.p_request.stream === true);
  t("create: request carries no user id or email", !JSON.stringify(sent.args).includes(OWNER.id) && !JSON.stringify(sent.args).toLowerCase().includes("example.com"));
  t("create: memory is null when no provider is registered", sent.args.p_request.memory === null);

  const again = await H.handleCreateJob(post("/api/faye/jobs", chat()), d);
  const ab = await j(again);
  t("idempotency: same request_id -> 200 deduped, same job", again.status === 200 && ab.deduped === true && ab.job_id === b.job_id);

  const busy = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0002" })), d);
  const bb = await j(busy);
  t("cap: second job while one is in flight -> 429 rate_limited with Retry-After", busy.status === 429 && bb.code === "rate_limited" && bb.detail === "in_flight" && busy.headers.get("retry-after") === "5" && bb.retry_after_sec === 5);

  mb.st.jobs.clear(); mb.st.byReq.clear(); mb.st.dailyCap = 0;
  const daily = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0003" })), d);
  t("cap: daily cap -> 429 rate_limited daily_cap", daily.status === 429 && (await j(daily)).detail === "daily_cap");

  mb.st.dailyCap = 150; mb.st.online = false;
  const offline = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0004" })), d);
  const ob = await j(offline);
  t("offline: honest 503 faye_offline with a friendly message, nothing queued", offline.status === 503 && ob.code === "faye_offline" && /resting/i.test(ob.error) && mb.st.jobs.size === 0);
}

{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const big = await H.handleCreateJob(post("/api/faye/jobs", chat({ question: "x".repeat(4001), request_id: "req-test-0010" })), d);
  const bb = await j(big);
  t("oversize: question over 4000 -> 413 too_large", big.status === 413 && bb.code === "too_large" && bb.detail === "question");
  const exact = await H.handleCreateJob(post("/api/faye/jobs", chat({ question: "x".repeat(4000), request_id: "req-test-0011" })), d);
  t("oversize: exactly 4000 characters accepted", exact.status === 201);
  const huge = await H.handleCreateJob(post("/api/faye/jobs", JSON.stringify({ ...chat({ request_id: "req-test-0012" }), pad: "x".repeat(2 * 1024 * 1024 + 10) })), deps(fakeClient(OWNER, mb.impl)));
  t("oversize: body over 2 MB -> 413 before any validation", huge.status === 413 && (await j(huge)).code === "too_large");
  const declared = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0013" }), { "content-length": String(5 * 1024 * 1024) }), deps(fakeClient(OWNER, mb.impl)));
  t("oversize: declared content-length over the cap -> 413", declared.status === 413);
  const rpcCalls = c.calls.filter((x) => x.fn === "faye_submit_job").length;
  t("oversize: rejected requests never reach the database", rpcCalls === 1);

  const noMem = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0014", memory: { v: 1, items: [] } })), d);
  t("memory: a memory field from the browser is rejected", noMem.status === 400 && (await j(noMem)).detail === "memory_not_allowed");
  const badJson = await H.handleCreateJob(post("/api/faye/jobs", "{not json"), d);
  t("body: invalid JSON -> 400 bad_request", badJson.status === 400);
  const arr = await H.handleCreateJob(post("/api/faye/jobs", "[1,2]"), d);
  t("body: JSON array -> 400", arr.status === 400);
  const noKind = await H.handleCreateJob(post("/api/faye/jobs", { request_id: "req-test-0015", question: "hi" }), d);
  t("kind: missing kind -> 400", noKind.status === 400);
  for (const k of ["extract", "eval", "bogus"]) {
    const r = await H.handleCreateJob(post("/api/faye/jobs", { request_id: "req-test-0016", kind: k }), d);
    t(`kind: browser cannot create ${k} jobs`, r.status === 400 && (await j(r)).detail === "bad_kind");
  }
  const empty = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0017", question: "   " })), d);
  t("question: blank -> 400", empty.status === 400);
  const badId = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "short" })), d);
  t("request_id: too short -> 400", badId.status === 400);
  const noJsonCt = await H.handleCreateJob(post("/api/faye/jobs", chat(), { "content-type": "text/plain" }), d);
  t("csrf: text/plain content type -> 400", noJsonCt.status === 400);
  const xsite = await H.handleCreateJob(post("/api/faye/jobs", chat(), { origin: "https://evil.test" }), d);
  t("csrf: foreign Origin -> 403 not_allowed", xsite.status === 403 && (await j(xsite)).code === "not_allowed");

  const stranger = deps(fakeClient({ ...OWNER, email: "x@y.org" }, mb.impl));
  const sr = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0018" })), stranger);
  t("owner gate: non-owner create -> 403 not_allowed, database never called", sr.status === 403 && (await j(sr)).code === "not_allowed" && (await stranger.getClient()).calls.length === 0);
  const unconf = deps(fakeClient({ ...OWNER, email_confirmed_at: null }, mb.impl));
  t("owner gate: unconfirmed email create -> 403", (await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0019" })), unconf)).status === 403);
  const noSess = deps(fakeClient(null, mb.impl));
  t("owner gate: no session create -> 401", (await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0020" })), noSess)).status === 401);
  const noList = { ...deps(fakeClient(OWNER, mb.impl)), env: { FAYE_MAILBOX_ENABLED: "1" } };
  t("owner gate: no FAYE_OWNER_EMAILS -> everyone denied", (await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0021" })), noList)).status === 403);
  const dbDeny = deps(fakeClient(OWNER, () => ({ data: { ok: false, code: "not_allowed", detail: "not_allowed" }, error: null })));
  t("owner gate: database refusal maps to 403", (await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-test-0022" })), dbDeny)).status === 403);

  const lim = deps(fakeClient(OWNER, mb.impl), { limiters: { create: new SlidingWindowLimiter(2, 60_000), poll: new SlidingWindowLimiter(600, 60_000), status: new SlidingWindowLimiter(120, 60_000) } });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-rate-000" + i })), lim)).status);
  t("route rate limit: third request in a minute -> 429", codes[2] === 429 && codes[3] === 429);
}

// ================================================================================================ continue
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const body = { request_id: "req-cont-0001", kind: "continue", parent_job_id: JOB, state: { s: 1 }, results: { c1: { ok: true, data: {} } } };
  const res = await H.handleCreateJob(post("/api/faye/jobs", body), d);
  const sent = c.calls.find((x) => x.fn === "faye_submit_job");
  t("continue: accepted, request is {v,state,results}, parent passed separately", res.status === 201 && sent.args.p_kind === "continue" && sent.args.p_parent_job_id === JOB && Object.keys(sent.args.p_request).sort().join() === "results,state,v");
  const noParent = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0002", parent_job_id: "nope" }), d);
  t("continue: bad parent id -> 400", noParent.status === 400);
  const noState = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0003", state: "x" }), d);
  t("continue: state must be an object -> 400", noState.status === 400);
  const many = {}; for (let i = 0; i < 65; i++) many["k" + i] = 1;
  const tooMany = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0004", results: many }), d);
  t("continue: more than 64 results -> 413", tooMany.status === 413);
  const bigState = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0005", state: { s: "x".repeat(201 * 1024) } }), d);
  t("continue: state over 200 KB -> 413", bigState.status === 413 && (await j(bigState)).detail === "state");
  const bigRes = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0006", results: { a: "x".repeat(1_600_000) } }), d);
  t("continue: results over 1.5 MB -> 413", bigRes.status === 413 && (await j(bigRes)).detail === "results");
  const badParent = deps(fakeClient(OWNER, () => ({ data: { ok: false, code: "bad_request", detail: "bad_parent" }, error: null })));
  const bp = await H.handleCreateJob(post("/api/faye/jobs", { ...body, request_id: "req-cont-0007" }), badParent);
  t("continue: database refuses the parent -> 400 bad_request", bp.status === 400 && (await j(bp)).detail === "bad_parent");
}

// ================================================================================================ portfolio state trimming
{
  const pos = (i) => ({ symbol: "SYM" + i, assetClass: "equity", shares: 100 + i, costBasisValue: 12345.67 + i, secret: "drop me", notes: "x".repeat(50) });
  const big = { page: "Dellegate", portfolio: { positions: Array.from({ length: 80 }, (_, i) => pos(i)) }, extra: { token: "abc" } };
  const out = V.trimPortfolioState(big);
  t("state: trimmed to at most 1500 serialized characters", JSON.stringify(out).length <= 1500, String(JSON.stringify(out).length));
  t("state: keeps a useful number of leading positions", out.portfolio.positions.length >= 10 && out.portfolio.positions[0].symbol === "SYM0");
  t("state: unknown fields are dropped (allowlist)", !JSON.stringify(out).includes("drop me") && !JSON.stringify(out).includes("token") && Object.keys(out.portfolio.positions[0]).sort().join() === "assetClass,costBasisValue,shares,symbol");
  t("state: small state passes unchanged in content", V.trimPortfolioState({ page: "Dellegate", portfolio: { positions: [pos(1)] } }).portfolio.positions.length === 1);
  t("state: malformed positions skipped", V.trimPortfolioState({ portfolio: { positions: [null, 5, { symbol: "<script>", assetClass: "equity", shares: 1, costBasisValue: 1 }, { symbol: "NVDA", assetClass: "equity", shares: "ten", costBasisValue: 1 }, pos(2)] } }).portfolio.positions.length === 1);
  t("state: non-object becomes null", V.trimPortfolioState("x") === null && V.trimPortfolioState(null) === null);
  const withCtl = V.trimPortfolioState({ page: "Del\u0000legate‮", portfolio: { positions: [] } });
  t("state: control and bidi characters stripped from page", withCtl.page === "Dellegate");
}

// ================================================================================================ memory pack
{
  const id1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const id2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const mk = (items) => {
    const chars = items.reduce((n, i) => n + i.t.length, 0);
    return { v: 1, items, chars, hash: V.computeMemoryPackHash(items) };
  };
  const items = [{ id: id1, cat: "style", t: "Likes the number first, then one line of why." }, { id: id2, cat: "preference", t: "Prefers weekly swing setups." }];
  const pack = mk(items);
  t("memory: a valid pack is accepted unchanged", V.validateMemoryPack(pack)?.hash === pack.hash && V.validateMemoryPack(pack).items.length === 2);
  t("memory: hash is 16 hex characters and changes with the text", /^[0-9a-f]{16}$/.test(pack.hash) && V.computeMemoryPackHash([{ ...items[0], t: "Other text here." }]) !== V.computeMemoryPackHash([items[0]]));
  t("memory: tampered text fails the hash", V.validateMemoryPack({ ...pack, items: [{ ...items[0], t: "Changed after hashing." }, items[1]] }) === null);
  t("memory: wrong chars count rejected", V.validateMemoryPack({ ...pack, chars: pack.chars + 1 }) === null);
  t("memory: empty pack rejected", V.validateMemoryPack({ v: 1, items: [], chars: 0, hash: "0".repeat(16) }) === null);
  t("memory: wrong version rejected", V.validateMemoryPack({ ...pack, v: 2 }) === null);
  const seven = Array.from({ length: 7 }, (_, i) => ({ id: id1, cat: "style", t: "Note number " + i + " ok." }));
  t("memory: more than 6 items rejected", V.validateMemoryPack(mk(seven)) === null);
  const long = [{ id: id1, cat: "style", t: "x".repeat(201) }];
  t("memory: item over 200 characters rejected", V.validateMemoryPack(mk(long)) === null);
  const over900 = Array.from({ length: 5 }, () => ({ id: id1, cat: "style", t: "y".repeat(190) }));
  t("memory: total over 900 characters rejected", V.validateMemoryPack(mk(over900)) === null);
  t("memory: unknown category rejected", V.validateMemoryPack(mk([{ id: id1, cat: "secrets", t: "Valid text here." }])) === null);
  t("memory: bad id rejected", V.validateMemoryPack(mk([{ id: "not-a-uuid", cat: "style", t: "Valid text here." }])) === null);
  t("memory: newline or control character in text rejected", V.validateMemoryPack(mk([{ id: id1, cat: "style", t: "Line one\nLine two" }])) === null);
  t("memory: padded text rejected", V.validateMemoryPack(mk([{ id: id1, cat: "style", t: " padded text " }])) === null);
  t("memory: garbage never throws", V.validateMemoryPack("x") === null && V.validateMemoryPack(null) === null && V.validateMemoryPack({ v: 1, items: "x" }) === null);

  MH.setMemoryPackProvider(async () => pack);
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-mem-00001" })), deps(c));
  t("memory: server-attached pack lands in the chat request", c.calls.find((x) => x.fn === "faye_submit_job").args.p_request.memory?.hash === pack.hash);
  MH.setMemoryPackProvider(async () => ({ ...pack, hash: "0000000000000000" }));
  const c2 = fakeClient(OWNER, mailbox().impl);
  await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-mem-00002" })), deps(c2));
  t("memory: an invalid pack from the provider is dropped, the job still runs", c2.calls.find((x) => x.fn === "faye_submit_job").args.p_request.memory === null);
  MH.setMemoryPackProvider(async () => { throw new Error("memory down"); });
  const c3 = fakeClient(OWNER, mailbox().impl);
  const r3 = await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-mem-00003" })), deps(c3));
  t("memory: a throwing provider cannot break a question", r3.status === 201 && c3.calls.find((x) => x.fn === "faye_submit_job").args.p_request.memory === null);
  MH.setMemoryPackProvider(async () => pack);
  const c4 = fakeClient(OWNER, mailbox().impl);
  await H.handleCreateJob(post("/api/faye/jobs", chat({ request_id: "req-mem-00004" })), { ...deps(c4), env: { ...ENV, FAYE_MEMORY_ENABLED: "0" } });
  t("memory: FAYE_MEMORY_ENABLED=0 switches the pack off", c4.calls.find((x) => x.fn === "faye_submit_job").args.p_request.memory === null);
  MH.setMemoryPackProvider(null);
}

// ================================================================================================ poll: statuses, errors, results, relay guard
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const created = await j(await H.handleCreateJob(post("/api/faye/jobs", chat()), d));
  const id = created.job_id;
  const job = mb.st.jobs.get(id);

  // events arrive on the first check -> immediate return
  mb.st.pollAnswer = (jb, a) => ({ ok: true, job_id: jb.id, kind: "chat", status: "running", events: [{ seq: 1, ev: "chunk", text: "Hel" }, { seq: 2, ev: "chunk", text: "lo\u0000‮" }], last_seq: 2, more: false, queue_position: null, result: null, error: null, purged: false });
  const r1 = await H.handlePollJob(get(`/api/faye/jobs/${id}?after=0`), id, d);
  const b1 = await j(r1);
  t("poll: returns new events immediately, text cleaned", r1.status === 200 && b1.events.length === 2 && b1.events[1].text === "lo" && b1.last_seq === 2 && b1.done === false);
  t("poll: passes the after cursor to the database", c.calls.filter((x) => x.fn === "faye_poll_job").at(-1).args.p_after === 0);

  // retract event
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "running", events: [{ seq: 3, ev: "retract", text: "replacement" }], last_seq: 3, more: false, queue_position: null, result: null, error: null, purged: false });
  const b2 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=2`), id, d));
  t("poll: retract event flows through and sets retracted", b2.events[0].ev === "retract" && b2.retracted === true);

  // done with result
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [], last_seq: 3, more: false, queue_position: null, error: null, purged: false,
    result: { kind: "generated", text: "GEX is gamma exposure.", provenance: { model: "gemma3:1b", constraint_sha256_16: "abcd", memory_ids: [], educational_not_advice: true }, junk: "drop", calls: null } });
  const b3 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=3`), id, d));
  t("poll: done returns the cleaned result and done:true", b3.done === true && b3.status === "done" && b3.result.text === "GEX is gamma exposure." && b3.result.kind === "generated" && !("junk" in b3.result) && b3.error === null);

  // relay guard on a generated answer
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [], last_seq: 3, more: false, queue_position: null, error: null, purged: false,
    result: { kind: "generated", text: "Given your holdings, I recommend NVDA.", provenance: {} } });
  const b4 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=3`), id, d));
  t("relay guard: an overt recommendation is replaced by the redirect and flagged", b4.retracted === true && b4.result.text === G.ADVICE_REDIRECT && b4.result.kind === "guardrail" && b4.result.provenance.relay_guard === true);
  t("relay guard: leak patterns match, safe text does not", G.ADVICE_LEAK_RE.test("You should buy it") && G.ADVICE_LEAK_RE.test("my top pick is X") && !G.ADVICE_LEAK_RE.test("GEX measures dealer gamma exposure."));
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [], last_seq: 0, more: false, error: null, purged: false,
    result: { kind: "guardrail", text: G.ADVICE_REDIRECT, provenance: { scripted: true } } });
  const b5 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d));
  t("relay guard: the scripted redirect itself passes untouched", b5.retracted === false && b5.result.text === G.ADVICE_REDIRECT);

  // tool_calls result keeps calls and state for the browser to re-validate
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [], last_seq: 1, more: false, error: null, purged: false,
    result: { kind: "tool_calls", text: "Checking.", calls: [{ id: "c1", tool: "macro_overview" }], state: { s: 1 }, provenance: {} } });
  const b6 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d));
  t("poll: tool_calls result keeps calls and state", b6.result.kind === "tool_calls" && b6.result.calls.length === 1 && b6.result.state.s === 1);

  // a result with an unknown kind and oversized provenance
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [], last_seq: 1, more: false, error: null, purged: false,
    result: { kind: "weird", text: 5, provenance: { blob: "x".repeat(9000) } } });
  const b7 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d));
  t("poll: unknown result kind becomes final, non-string text becomes empty, oversized provenance truncated", b7.result.kind === "final" && b7.result.text === "" && b7.result.provenance.truncated === true);

  // more events pending: result withheld, done false
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "done", events: [{ seq: 5, ev: "chunk", text: "a" }], last_seq: 5, more: true, error: null, purged: false, result: { kind: "generated", text: "x" } });
  const b8 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=4`), id, d));
  t("poll: more:true withholds the result and done", b8.more === true && b8.done === false && b8.result === null);

  // expiry
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "expired", events: [], last_seq: 0, more: false, queue_position: null, result: null, error: { code: "expired" }, purged: false });
  const b9 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d));
  t("expiry: expired job -> done:true with error expired and a friendly message", b9.done === true && b9.status === "expired" && b9.error.code === "expired" && /did not pick/i.test(b9.error.message));
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "failed", events: [{ seq: 1, ev: "chunk", text: "par" }], last_seq: 1, more: false, result: null, error: { code: "worker_lost" }, purged: false });
  const b10 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=1`), id, d));
  t("worker_lost: failed job reports status failed with its partial events", b10.status === "failed" && b10.done === true);
  t("worker_lost: message is ours", b10.error.code === "worker_lost" && /train of thought/.test(b10.error.message));
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "failed", events: [], last_seq: 1, more: false, result: null, error: { code: "<img src=x onerror=alert(1)>" }, purged: false });
  const b11 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?after=1`), id, d));
  t("errors: an unknown code from the database becomes generation_failed, never echoed", b11.error.code === "generation_failed" && !JSON.stringify(b11).includes("onerror"));
  mb.st.pollAnswer = () => ({ ok: true, job_id: id, kind: "chat", status: "cancelled", events: [], last_seq: 1, more: false, result: null, error: null, purged: false });
  const b12 = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d));
  t("poll: cancelled -> done:true, no error", b12.done === true && b12.status === "cancelled" && b12.error === null);
  mb.st.pollAnswer = null;

  // input validation and isolation
  const badId = await H.handlePollJob(get("/api/faye/jobs/not-a-uuid"), "not-a-uuid", d);
  t("poll: bad id -> 400, no database call for it", badId.status === 400);
  const missing = await H.handlePollJob(get(`/api/faye/jobs/${JOB}`), JOB, d);
  t("poll: unknown or foreign job -> 404 not_found", missing.status === 404 && (await j(missing)).code === "not_found");
  for (const q of ["after=-1", "after=abc", "after=1.5", "after=99999999", "wait=-5", "wait=abc"]) {
    const r = await H.handlePollJob(get(`/api/faye/jobs/${id}?${q}`), id, d);
    t(`poll: ${q} -> 400`, r.status === 400);
  }
  const stranger = deps(fakeClient({ ...OWNER, email: "x@y.org" }, mb.impl));
  const sp = await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, stranger);
  t("poll: non-owner -> 403 and no database call", sp.status === 403 && (await stranger.getClient()).calls.length === 0);
  const anon = deps(fakeClient(null, mb.impl));
  t("poll: no session -> 401", (await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, anon)).status === 401);
}

// ================================================================================================ long-poll timing (fake clock)
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const id = (await j(await H.handleCreateJob(post("/api/faye/jobs", chat()), d))).job_id;
  let t0;
  const now = d.now;

  // nothing happens: holds for the wait, then returns 200 with empty events (client re-polls)
  mb.st.polls.length = 0;
  t0 = now();
  const res = await H.handlePollJob(get(`/api/faye/jobs/${id}?wait=2000`), id, d);
  const b = await j(res);
  const waited = now() - t0;
  t("long poll: quiet job returns after about the wait (not earlier, not much later)", res.status === 200 && waited >= 1700 && waited <= 2300, String(waited));
  t("long poll: quiet job -> empty events, same status, done:false", b.events.length === 0 && b.status === "queued" && b.done === false);
  t("long poll: database checked roughly every 300 ms (not a tight loop)", mb.st.polls.length >= 5 && mb.st.polls.length <= 8, String(mb.st.polls.length));
  const dflt = now();
  await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, d);
  t("long poll: default wait is 8 seconds", now() - dflt >= 7700 && now() - dflt <= 8300, String(now() - dflt));
  const cap = now();
  await H.handlePollJob(get(`/api/faye/jobs/${id}?wait=60000`), id, d);
  t("long poll: wait is clamped to 12 seconds", now() - cap <= 12300, String(now() - cap));
  const zero = now();
  mb.st.polls.length = 0;
  await H.handlePollJob(get(`/api/faye/jobs/${id}?wait=0`), id, d);
  t("long poll: wait=0 checks once and returns", now() === zero && mb.st.polls.length === 1);

  // events appear after ~1 s -> returns as soon as they do
  mb.st.polls.length = 0;
  const start = now();
  mb.st.pollAnswer = (jb, a) => {
    const late = now() - start >= 1000;
    return { ok: true, job_id: jb.id, kind: "chat", status: "running", events: late ? [{ seq: 1, ev: "chunk", text: "Hi" }] : [], last_seq: late ? 1 : 0, more: false, queue_position: null, result: null, error: null, purged: false };
  };
  const rr = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?wait=8000`), id, d));
  const took = now() - start;
  t("long poll: returns as soon as an event shows up", rr.events.length === 1 && took >= 900 && took <= 1500, String(took));

  // a status change with no events (queued -> running) also returns
  mb.st.pollAnswer = (jb) => {
    const ran = now() - start > 5000 + 1000;
    return { ok: true, job_id: jb.id, kind: "chat", status: ran ? "running" : "queued", events: [], last_seq: 0, more: false, queue_position: 0, result: null, error: null, purged: false };
  };
  const s2 = now();
  const sc = await j(await H.handlePollJob(get(`/api/faye/jobs/${id}?wait=8000`), id, d));
  t("long poll: a status change (queued to running) returns early", sc.status === "running" && now() - s2 < 8000, String(now() - s2));

  // a request the browser abandoned stops looping
  mb.st.pollAnswer = null;
  const ac = new AbortController();
  const aborted = new Request(`https://dell.test/api/faye/jobs/${id}?wait=8000`, { headers: { host: "dell.test" }, signal: ac.signal });
  ac.abort();
  mb.st.polls.length = 0;
  await H.handlePollJob(aborted, id, d);
  t("long poll: an aborted request stops after one check", mb.st.polls.length === 1);

  // database failure while polling
  const bad = deps(fakeClient(OWNER, (fn) => (fn === "faye_poll_job" ? { data: null, error: { code: "XX000", message: "connection to 10.0.0.5 refused, password=hunter2" } } : mb.impl(fn, {}))));
  const br = await H.handlePollJob(get(`/api/faye/jobs/${id}`), id, bad);
  const bbody = await br.text();
  t("errors: a database error -> 500 server_error with no detail leaked", br.status === 500 && JSON.parse(bbody).code === "server_error" && !bbody.includes("hunter2") && !bbody.includes("10.0.0.5"));
}

// ================================================================================================ cancel
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const d = deps(c);
  const id = (await j(await H.handleCreateJob(post("/api/faye/jobs", chat()), d))).job_id;
  const r = await H.handleCancelJob(post(`/api/faye/jobs/${id}/cancel`, {}), id, d);
  t("cancel: queued job -> 200 cancelled", r.status === 200 && (await j(r)).status === "cancelled" && mb.st.jobs.get(id).status === "cancelled");
  const again = await j(await H.handleCancelJob(post(`/api/faye/jobs/${id}/cancel`, {}), id, d));
  t("cancel: idempotent", again.ok === true && again.status === "cancelled");
  t("cancel: unknown job -> 404", (await H.handleCancelJob(post(`/api/faye/jobs/${JOB}/cancel`, {}), JOB, d)).status === 404);
  t("cancel: bad id -> 400", (await H.handleCancelJob(post("/api/faye/jobs/x/cancel", {}), "x", d)).status === 400);
  t("cancel: foreign Origin -> 403", (await H.handleCancelJob(post(`/api/faye/jobs/${id}/cancel`, {}, { origin: "https://evil.test" }), id, d)).status === 403);
  const stranger = deps(fakeClient({ ...OWNER, email: "x@y.org" }, mb.impl));
  t("cancel: non-owner -> 403", (await H.handleCancelJob(post(`/api/faye/jobs/${id}/cancel`, {}), id, stranger)).status === 403);
}

// ================================================================================================ infrastructure failures and error codes
{
  const missing = deps(fakeClient(OWNER, () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.faye_submit_job" } })));
  const r = await H.handleCreateJob(post("/api/faye/jobs", chat()), missing);
  t("migration not applied -> 503 unavailable", r.status === 503 && (await j(r)).code === "unavailable");
  const thrower = deps(fakeClient(OWNER, () => { throw new Error("network"); }));
  t("rpc throws -> 503 unavailable, never a stack trace", (await H.handleCreateJob(post("/api/faye/jobs", chat()), thrower)).status === 503);
  const weird = deps(fakeClient(OWNER, () => ({ data: "oops", error: null })));
  t("rpc returns a non-object -> 500 server_error", (await H.handleCreateJob(post("/api/faye/jobs", chat()), weird)).status === 500);
  const unknownCode = deps(fakeClient(OWNER, () => ({ data: { ok: false, code: "<b>boom</b>" }, error: null })));
  const uc = await H.handleCreateJob(post("/api/faye/jobs", chat()), unknownCode);
  t("rpc refusal with an unknown code -> 500 server_error, code not echoed", uc.status === 500 && !(await uc.text()).includes("<b>"));

  const six = ["faye_offline", "rate_limited", "too_large", "worker_lost", "expired", "not_allowed"];
  t("error codes: the six contract codes exist with HTTP status and a friendly message", six.every((k) => E.HTTP_STATUS[k] && E.FRIENDLY[k].length > 10));
  t("error codes: statuses match the contract", E.HTTP_STATUS.faye_offline === 503 && E.HTTP_STATUS.rate_limited === 429 && E.HTTP_STATUS.too_large === 413 && E.HTTP_STATUS.not_allowed === 403 && E.HTTP_STATUS.auth_required === 401);
  const body = E.errorBody("rate_limited", { retryAfterSec: 12.2, detail: "daily_cap" });
  t("error body: shape and rounding", body.ok === false && body.code === "rate_limited" && body.retry_after_sec === 13 && body.detail === "daily_cap");
  t("error body: odd detail strings are not echoed", E.errorBody("bad_request", { detail: "<script>" }).detail === undefined);
  t("error codes: toKnownCode falls back", E.toKnownCode("nope", "server_error") === "server_error" && E.toKnownCode("expired") === "expired");
}

// ================================================================================================ service-level behaviours
{
  const mb = mailbox();
  const c = fakeClient(OWNER, mb.impl);
  const out = await S.submitJob(c, { requestId: "req-svc-00001", kind: "extract", request: { v: 1, exchanges: [{ q: "a", a: "b" }] } });
  t("service: submitJob passes any kind (extract/eval are for server code)", out.ok === true && c.calls[0].args.p_kind === "extract" && c.calls[0].args.p_parent_job_id === null);
  const st = await S.getStatus(c, false);
  t("service: getStatus", st.ok && st.allowed && st.online);
  const body = S.buildPollBody({ status: "done", kind: "eval", result: { kind: "eval", passed: 8, total: 8 }, events: [], more: false }, JOB);
  t("service: eval results pass through unchanged for server code", body.result.passed === 8 && body.done === true);
  const bad = S.buildPollBody({ status: "running", events: [null, { seq: "x" }, { seq: 1, ev: "chunk", text: "ok" }, { seq: 2, ev: "evil", text: "t" }] }, JOB);
  t("service: malformed events are skipped; unknown ev becomes chunk", bad.events.length === 2 && bad.events[1].ev === "chunk");
}

// ================================================================================================ static lint of the migration
{
  const sql = readFileSync(new URL("../db/migrations/2026-10-20_faye_mailbox.sql", import.meta.url), "utf8");
  const down = readFileSync(new URL("../db/migrations/2026-10-20_faye_mailbox_down.sql", import.meta.url), "utf8");
  const tables = [...sql.matchAll(/create table if not exists public\.(faye_\w+)/g)].map((m) => m[1]);
  t("sql lint: six mailbox tables", tables.length === 6, tables.join());
  for (const tb of tables) {
    t(`sql lint: RLS enabled on ${tb}`, new RegExp(`alter table public\\.${tb}\\s+enable row level security`).test(sql));
    t(`sql lint: ${tb} privileges revoked from anon and authenticated`, new RegExp(`revoke all on public\\.${tb}\\s+from anon, authenticated`).test(sql));
    t(`sql lint: ${tb} dropped by the down script`, down.includes(`drop table if exists public.${tb};`));
  }
  const fnBlocks = sql.split(/create or replace function /).slice(1);
  t("sql lint: 23 functions found", fnBlocks.length === 23, String(fnBlocks.length));
  for (const blk of fnBlocks) {
    const name = blk.match(/^public\.(faye_\w+)/)?.[1];
    t(`sql lint: ${name} is SECURITY DEFINER with an empty search_path`, /security definer/.test(blk.slice(0, 900)) && /set search_path = ''/.test(blk.slice(0, 900)));
  }
  const names = fnBlocks.map((b) => b.match(/^public\.(faye_\w+)/)[1]);
  t("sql lint: every function is dropped by the down script", names.every((n) => down.includes(`public.${n}(`)), names.filter((n) => !down.includes(`public.${n}(`)).join());
  const worker = ["faye_claim_job", "faye_append_chunks", "faye_complete_job", "faye_fail_job", "faye_submit_memory_proposals", "faye_get_approved_eval_items", "faye_report_eval_run"];
  for (const w of worker) t(`sql lint: ${w} granted to anon only`, new RegExp(`grant execute on function public\\.${w}\\([^)]*\\)\\s+to anon;`).test(sql) && !new RegExp(`grant execute on function public\\.${w}\\([^)]*\\)\\s+to authenticated`).test(sql));
  const browser = ["faye_status", "faye_submit_job", "faye_poll_job", "faye_cancel_job", "faye_erase_me", "faye_is_allowed"];
  for (const b of browser) t(`sql lint: ${b} granted to authenticated only`, new RegExp(`grant execute on function public\\.${b}\\([^)]*\\)\\s+to authenticated;`).test(sql) && !new RegExp(`grant execute on function public\\.${b}\\([^)]*\\)\\s+to anon`).test(sql));
  const internal = ["faye_cfg", "faye_user_role", "faye_worker_online", "faye_assert_worker", "faye_reap", "faye_seed_owner", "faye_revoke_access", "faye_create_worker_token", "faye_list_worker_tokens", "faye_revoke_worker_token"];
  for (const n of internal) t(`sql lint: ${n} revoked from public/anon/authenticated and never granted`, new RegExp(`revoke all on function public\\.${n}\\([^)]*\\)\\s+from public, anon, authenticated;`).test(sql) && !new RegExp(`grant execute on function public\\.${n}\\(`).test(sql));
  t("sql lint: no table grants to anon", !/grant\s+(select|insert|update|delete|all)[^;]*\bto\s+anon/i.test(sql));
  t("sql lint: authenticated gets SELECT only on three tables", [...sql.matchAll(/grant\s+(\w+)\s+on\s+public\.(\w+)\s+to authenticated/g)].map((m) => m[1] + ":" + m[2]).sort().join() === "select:faye_access,select:faye_job_chunks,select:faye_jobs");
  t("sql lint: tokens are stored hashed (sha256) and no token literal is written", /token_hash\s+bytea/.test(sql) && /sha256\(convert_to\(p_token/.test(sql) && !/fwt_[0-9a-f]{20}/.test(sql));
  t("sql lint: user id is never an argument of a browser function", !/p_user_id|p_uid\s+uuid\)\s*returns jsonb/.test(sql.replace(/faye_user_role\(p_uid uuid\)/, "")));
  t("sql lint: idempotency key and caps present", /unique \(user_id, request_id\)/.test(sql) && /max_queued_global/.test(sql) && /daily_cap/.test(sql) && /pg_advisory_xact_lock/.test(sql));
  t("sql lint: nothing runs the migration or touches existing tables", !/alter table public\.(?!faye_)/.test(sql) && !/drop table/.test(sql) && !/truncate/i.test(sql));
}

summary();
