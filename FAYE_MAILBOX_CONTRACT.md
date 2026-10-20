# Faye mailbox contracts (v1.0)

Author: WP-A (Mailbox backend). Date: 2026-10-20. Status: FROZEN for v1. A change needs a version bump here and a note to the coordinator.
A copy lives in the Dellegate repo as `FAYE_MAILBOX_CONTRACT.md` (keep the two in step).

Readers: WP-B (worker and prompt memory), WP-C1 (widget), WP-C2 (Lab), WP-D (persona), WP-E (evals and privacy tests), WP-F (memory backend).
Design source: `team_audits/2026-10-19/faye-personal-design.md` sections 1, 2, 3.5, 4.2, 7.1.

Everything below is the contract. Where this file and the design differ, this file wins (differences are listed in section 11).

---

## 0. Vocabulary

- **Browser**: the signed-in owner's browser. It never talks to Supabase RPCs directly for Faye; it calls the Next routes in section 3.
- **Route**: a Next.js route handler under `/api/faye/*`. It checks the session and the owner gate, then calls the browser-side RPCs below as the user (anon key plus the user's JWT, role `authenticated`).
- **Worker**: the Python process on the Oracle VM (or the owner's PC). It holds only the Supabase URL, the public anon key and one worker token. It calls the worker-side RPCs below with role `anon`.
- **Job**: one unit of work in `faye_jobs`. Kinds: `chat`, `continue`, `extract`, `eval`.
- All timestamps are ISO 8601 UTC strings (`2026-10-20T14:03:11.123Z`). All ids are UUID strings. All text is UTF-8.

---

## 1. Environment variables

| Name | Where | Meaning |
|---|---|---|
| `FAYE_MAILBOX_ENABLED` | Vercel (server only) | `1` or `true` turns the routes on. Anything else (including unset) = off. Default off. |
| `FAYE_OWNER_EMAILS` | Vercel (server only) | Comma-separated list of owner emails (case-insensitive). Empty or unset = nobody is allowed (fail closed). |
| `NEXT_PUBLIC_FAYE_TRANSPORT` | Vercel (public) | `local` or `mailbox`. Read by the widget only (WP-C1). |
| `FAYE_SUPABASE_URL`, `FAYE_SUPABASE_ANON_KEY`, `FAYE_WORKER_TOKEN`, `FAYE_WORKER_ID` | Worker host only | Worker config. The token is secret; the anon key is public. `FAYE_WORKER_ID` is a label such as `oracle-vm` or `owner-pc`, 1 to 64 characters of `A-Z a-z 0-9 . _ : -`. |

Limits are NOT environment variables. A database cannot read Vercel variables and a caller-supplied cap would be bypassable, so caps live in the table `faye_settings` and `faye_access.daily_cap` (section 9) and are changed with one SQL `update`.

---

## 2. Browser-side RPCs (called by the Next routes as the signed-in user)

All are `POST {SUPABASE_URL}/rest/v1/rpc/<name>` with headers `apikey: <anon>` and `Authorization: Bearer <user access token>`, body = JSON object keyed by the parameter names. Each returns one JSON object. Business failures are returned as `{"ok": false, "code": "...", ...}` with HTTP 200 (so the route can map them); only infrastructure problems are HTTP errors.

Granted to role `authenticated` only. `anon` cannot execute any of them.

### 2.1 `faye_status(p_wake boolean default false) -> jsonb`
```json
{ "ok": true, "allowed": true, "role": "owner", "online": true, "worker_age_sec": 3,
  "queue_depth": 0, "in_flight": 0, "used_today": 12, "daily_cap": 150,
  "wake_until": "2026-10-20T14:08:11Z", "server_time": "2026-10-20T14:03:11Z" }
```
- `allowed:false` (not in `faye_access`, revoked, email unconfirmed or email mismatch): `{ "ok": true, "allowed": false, "online": false }`.
- No session (uid null): `{ "ok": false, "code": "not_allowed" }`.
- `p_wake = true` sets `wake_until = now() + 5 minutes` (the worker polls every 2 s until then).
- `online` = some non-revoked worker token made a worker call in the last 45 seconds.

### 2.2 `faye_submit_job(p_request_id text, p_kind text, p_request jsonb, p_parent_job_id uuid default null) -> jsonb`
Atomic. Order of checks: session, allowed, kind and request id shape, role for `extract`/`eval`, **idempotency**, size, opportunistic reap and purge, worker online, per-user lock, caps, insert.

Success:
```json
{ "ok": true, "job_id": "uuid", "status": "queued", "deduped": false, "queue_ahead": 0, "expires_at": "..." }
```
Same `(user, request_id)` again returns the existing job with `"deduped": true` and its current `status`, without counting against any cap.

Failure: `{ "ok": false, "code": "<error code>", "detail": "<sub-code>", "retry_after_sec": 12 }`.

| code | detail values |
|---|---|
| `not_allowed` | `no_session`, `not_allowed`, `owner_only` (extract and eval) |
| `bad_request` | `bad_kind`, `bad_request_id`, `bad_payload`, `bad_parent`, `kind_mismatch` |
| `too_large` | `request`, `question`, `state` |
| `faye_offline` | (none) |
| `rate_limited` | `in_flight`, `queue_full`, `daily_cap` |

Caps (defaults, tunable in `faye_settings`): 1 interactive job in flight per user (`chat` + `continue`) and 1 background job in flight per user (`extract` + `eval`); 5 queued jobs across the whole system (does not apply to `continue`); 150 `chat` jobs per rolling 24 hours for the owner (`faye_access.daily_cap`; 40 default for an approved user); `continue` jobs do not count toward the daily cap.
`request_id`: 8 to 64 characters of `A-Z a-z 0-9 _ -` (a `crypto.randomUUID()` fits).

### 2.3 `faye_poll_job(p_job_id uuid, p_after integer default 0) -> jsonb`
Returns the job's status and any events with `seq > p_after` (at most 200 per call). Also lazily expires an unclaimed job past its queue TTL and fails a job whose lease ran out (`worker_lost`), so the browser sees the truth even when no worker is running.
```json
{ "ok": true, "job_id": "uuid", "kind": "chat", "status": "running",
  "events": [ { "seq": 1, "ev": "chunk", "text": "Hel" }, { "seq": 2, "ev": "chunk", "text": "lo" } ],
  "last_seq": 2, "more": false, "queue_position": null,
  "result": null, "error": null, "purged": false, "server_time": "..." }
```
- `status`: `queued | claimed | running | done | failed | expired | cancelled`.
- `result` is present only when `status = "done"` AND `more = false`. If `more = true` call again with `p_after = last_seq` before reading the result.
- `error` is `{ "code": "worker_lost" }` or `{ "code": "expired" }` or `{ "code": "generation_failed" }` and so on, when `status` is `failed` or `expired`. The message text is built by the route from the code, never taken from the database.
- `queue_position`: 0 means next, only while `queued`.
- Wrong user or unknown id: `{ "ok": false, "code": "not_found" }`. Not allowed: `{ "ok": false, "code": "not_allowed" }`.
- `purged: true` = the 24-hour retention removed the payload; `events` and `result` are empty.

### 2.4 `faye_cancel_job(p_job_id uuid) -> jsonb`
`{ "ok": true, "status": "cancelled" }` for a queued, claimed or running job of the caller. A job already finished returns its own final status (`{ "ok": true, "status": "done" }`). The worker learns of the cancel from `cancel: true` in its next `faye_append_chunks` reply.

### 2.5 `faye_erase_me(p_confirm text) -> jsonb`
`p_confirm` must be exactly `DELETE`. Deletes everything Faye holds about the caller: jobs and chunks, plus, when those tables exist, memory items, memory settings, usage stats, feedback, corrections, eval items, corpus notes and eval runs (tables owned by WP-F and WP-C2). Does NOT delete the `faye_access` row. Returns `{ "ok": true, "deleted": { "faye_jobs": 4, "faye_memory_items": 9, ... } }`. Callable by any signed-in user for their own rows, even if revoked.

### 2.6 `faye_is_allowed() -> boolean`
Whether `auth.uid()` is currently allowed (row present, not revoked, email confirmed, emails match). Used by the RLS policies. Safe for any signed-in user to call; it only reveals their own status.

### 2.7 Table access for `authenticated`
RLS is on for every table. `authenticated` gets `SELECT` only, and only on: `faye_access` (own row), `faye_jobs` (own, and allowed), `faye_job_chunks` (own, and allowed). Everything else is reachable only through the functions above. WP-F and WP-C2 create their own tables and must follow the same rule (RLS on, `user_id = auth.uid()` plus `faye_is_allowed()`, `revoke all ... from anon, authenticated` then grant only what is needed).

---

## 3. HTTP routes (what the widget calls; same origin, cookie session)

Common rules for every route:
- Middleware requires a Supabase session (`/api/faye/*` is NOT in the public prefix list). A missing session gets `401 {"ok":false,"code":"auth_required"}` from middleware.
- Every response has `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- `POST` requires `Content-Type: application/json` and an `Origin` header equal to the site origin (or `Sec-Fetch-Site: same-origin`). Otherwise `403 not_allowed`.
- All text in responses is plain text. Render it as text only (React text nodes); never `innerHTML`.
- The owner gate runs on every request: confirmed email, listed in `FAYE_OWNER_EMAILS`, then the database check inside every RPC.
- Error body shape: `{ "ok": false, "code": "<code>", "error": "<friendly sentence>", "retry_after_sec"?: n, "detail"?: "<sub-code>" }`. `error` is generated from the code on the server; it is safe to show to the user.

### 3.1 `GET /api/faye/status[?wake=1]`
Always `200` for a signed-in user (the widget uses it to decide what to draw):
```json
{ "ok": true, "enabled": true, "allowed": true, "online": true, "mood": "online",
  "queue_depth": 0, "used_today": 3, "daily_cap": 150,
  "limits": { "question_chars": 4000, "state_chars": 1500 } }
```
- Flag off: `{ "ok": true, "enabled": false, "allowed": false, "online": false, "mood": "offline" }`.
- Signed in but not an owner: `{ "ok": true, "enabled": true, "allowed": false, "online": false, "mood": "offline" }` (the widget hides itself).
- `mood`: `"online"` or `"offline"` (the avatar's offline mood). `?wake=1` should be sent when the panel opens.

### 3.2 `POST /api/faye/jobs`
Body for a new question:
```json
{ "request_id": "uuid", "kind": "chat", "question": "What is GEX?", "state": { "page": "Dellegate", "portfolio": { "positions": [] } } }
```
Body for the next hop of a tool plan:
```json
{ "request_id": "uuid", "kind": "continue", "parent_job_id": "uuid", "state": { }, "results": { "<call id>": { } } }
```
Rules:
- Only `chat` and `continue` are accepted from the browser. `extract` and `eval` are created by server code through `submitJob()` in `src/lib/faye/mailbox/service.ts` (WP-F and WP-C2 import it).
- `question`: 1 to 4000 characters after trimming. `state` (chat): optional object; the server rebuilds it from `page` and `portfolio.positions[].{symbol,assetClass,shares,costBasisValue}` only and trims it to 1500 serialized characters by dropping positions from the end.
- `continue`: `state` is the opaque run state from the previous turn (object, at most 200 KB serialized), passed through unchanged; `results` is an object of at most 64 keys (1.5 MB serialized). `parent_job_id` must be the caller's own finished job whose result kind was `tool_calls`.
- The browser MUST NOT send a `memory` field; the server attaches the memory pack (section 6) itself. A `memory` field in the body is rejected with `400 bad_request`.
- Body cap: 2 MB overall (the route reads at most that many bytes). Larger: `413 too_large`.

Responses:
- `201 { "ok": true, "job_id": "uuid", "status": "queued", "deduped": false, "queue_ahead": 0, "expires_at": "..." }`
- `200` with `"deduped": true` when `request_id` was already used.
- Errors: `400 bad_request`, `403 not_allowed`, `413 too_large`, `429 rate_limited` (with `Retry-After` header and `retry_after_sec`), `503 faye_offline` (nothing is queued), `503 disabled` (flag off).

### 3.3 `GET /api/faye/jobs/{id}?after={seq}&wait={ms}`
Long poll. `after` default 0. `wait` default 8000, clamped to 0..12000. The route checks the database about every 300 ms and returns as soon as there is a new event or the job reached a final state. If nothing happens in `wait` ms it returns `200` with an empty `events` array and the same status, and the client simply calls again with the same `after`.
```json
{ "ok": true, "job_id": "uuid", "kind": "chat", "status": "running",
  "events": [ { "seq": 3, "ev": "chunk", "text": " world" } ],
  "last_seq": 3, "more": false, "queue_position": null, "done": false,
  "result": null, "error": null, "retracted": false }
```
- `done: true` means a final state (`done | failed | expired | cancelled`) with no more events to fetch. The client stops polling.
- On `status: "done"`: `result` is the cleaned result (section 4.5). On `failed`/`expired`: `error: { "code", "message" }`. On `cancelled`: `error: null`.
- `events[].ev`: `chunk` (append `text`) or `retract` (replace the WHOLE message text with `text`; see 4.6).
- Mapping to the old SSE events the widget already handles: `chunk` -> `chunk {text}`; `done` with `result` -> `done {...result minus text}`, with the final text in `result.text`; failed -> `error {error: message}`.
- Wrong id or not yours: `404 not_found`. Bad id format: `400 bad_request`.
- A route-level relay guard checks the final text for overt recommendation language (the same pattern as `_ADVICE_LEAK_RE`). On a hit it replaces `result.text` with the redirect sentence and sets `retracted: true`.

### 3.4 `POST /api/faye/jobs/{id}/cancel`
Body: `{}` (must still be JSON). Response `200 { "ok": true, "status": "cancelled" | "done" | "failed" | "expired" }`. Idempotent.

---

## 4. Job request and result JSON

Every request carries `"v": 1`. Unknown fields must be ignored by the worker. The worker gets the request exactly as stored (no user id, no email).

### 4.1 `chat`
Request (stored in `faye_jobs.request`, handed to the worker by `faye_claim_job`):
```json
{ "v": 1, "question": "string, 1..4000", "state": { "page": "Dellegate", "portfolio": { "positions": [ { "symbol": "NVDA", "assetClass": "equity", "shares": 10, "costBasisValue": 1200.5 } ] } },
  "memory": null, "stream": true }
```
- `memory` is `null` or a memory pack (section 6).
- The worker posts to its loopback `POST /pilp/chat` with `{question, state, stream: true, memory}` and relays the SSE as chunks.
Result: section 4.5.

### 4.2 `continue`
Request:
```json
{ "v": 1, "state": { "...opaque, from the previous turn..." }, "results": { "<call id>": { "ok": true, "data": {} } } }
```
The worker posts `{state, results}` to loopback `POST /pilp/continue` unchanged. There are no chunks (no model call); the answer is the result. Result: section 4.5.

### 4.3 `extract` (WP-F, owner only, background, queue TTL 30 min)
Request:
```json
{ "v": 1, "max_items": 3, "exchanges": [ { "q": "redacted question, <=1000", "a": "redacted answer, <=1500" } ] }
```
At most 4 exchanges. Text is redacted by the server before it is queued; the worker must redact again (design 3.6).
The worker proposes memory by calling `faye_submit_memory_proposals` (section 5.5) and then completes the job with `{ "kind": "extract", "accepted": 2, "rejected": 1 }`.

### 4.4 `eval` (WP-C2 and WP-E, owner only, background, queue TTL 30 min, max runtime 1 hour)
Request:
```json
{ "v": 1, "suite": "guardrail", "run_label": "optional <=60 chars" }
```
`suite` is one of `guardrail`, `orchestration`, `heldout`, `domain`, `persona`, `full`. The worker runs `python -m pilp.eval_suite --suite <suite> --json`, calls `faye_get_approved_eval_items` first when it needs owner-added items, reports with `faye_report_eval_run` (section 5.7), and completes with
`{ "kind": "eval", "suite": "guardrail", "passed": 8, "total": 8, "run_id": "uuid-or-null" }`.
Between eval prompts the worker must check `interactive_waiting` (section 5.3) and yield to chat.

### 4.5 Result JSON for `chat` and `continue`
Stored in `faye_jobs.result`, written by `faye_complete_job`:
```json
{ "kind": "generated", "text": "full final answer text",
  "calls": null, "state": null, "action": null,
  "provenance": { "model": "gemma3:1b", "constraint_sha256_16": "abcd...", "persona_sha256_16": "ef01...", "memory_ids": [], "memory_hash": null, "educational_not_advice": true } }
```
- `kind` is exactly one of `generated | conduct | guardrail | action_proposal | tool_calls | final` (the values `server.py` already emits).
- `text` is REQUIRED and is the complete final text (authoritative: it replaces anything streamed). For `tool_calls` it is the narration line.
- `calls` and `state` are present for `tool_calls`. The browser re-validates them (`plan-guards.ts`, the read-only allowlist). `action` is a proposal only (paper order), validated again in the browser, and never executed without the owner's click.
- `provenance` is an opaque object, at most 8 KB serialized. It carries `memory_ids` (array of UUIDs) and `memory_hash`, never memory text.
- Size caps enforced by the database on `faye_complete_job`: chat 256 KB, continue 1.5 MB, extract 20 KB, eval 200 KB. Over the cap: the job fails with `too_large`.
- The relay forwards only `kind, text, calls, state, action, provenance`. Other keys are dropped.

### 4.6 The `retract` event
The runtime output guard (WP-B) finds overt recommendation language in text it already streamed. It appends a chunk with `ev: "retract"` and `text` = the replacement text (the deterministic redirect sentence). The browser replaces the WHOLE message text with it. The worker then sends no more chunks and completes the job with `kind: "guardrail"`, `text` = the same replacement and `provenance.retracted = true`.
Chunk row: `{ "seq": 7, "ev": "retract", "text": "I can not tell you what to buy or sell ..." }`. Sequence numbers are shared with normal chunks.

---

## 5. Worker-side RPCs (anon key plus worker token)

`POST {SUPABASE_URL}/rest/v1/rpc/<name>` with `apikey: <anon>` and `Authorization: Bearer <anon>`; body keyed by parameter names. Granted to role `anon` only. Every function checks `sha256(p_token)` against `faye_worker_tokens` (non-revoked) first; the hash is stored, never the token. A bad or revoked token raises SQLSTATE `28000` (PostgREST HTTP 4xx with `"code":"28000"`): the worker must stop calling for at least 60 seconds and log "worker token rejected" (without printing the token).
`p_worker` is the worker id label (same rules as `FAYE_WORKER_ID`). Every valid call refreshes the worker heartbeat.
Retries: all calls are idempotent. Retry network failures 3 times with 1, 2, 4 seconds of backoff.

### 5.1 `faye_claim_job(p_token text, p_worker text) -> jsonb`
```json
{ "job_id": "uuid", "kind": "chat", "request": { "v": 1 }, "attempts": 1, "lease_sec": 90, "max_runtime_sec": 180,
  "fast_poll_until": "2026-10-20T14:08:11Z", "server_time": "2026-10-20T14:03:11Z" }
```
No job: `{ "job_id": null, "fast_poll_until": null, "server_time": "..." }`.
Priority: `chat`/`continue` first, then oldest first. Claims use `FOR UPDATE SKIP LOCKED`, so two workers never get the same job. Also runs the reaper (expire stale queue entries, requeue or fail expired leases, purge old data).
Poll cadence: every 2 seconds while `now < fast_poll_until` or for 5 minutes after the last job; otherwise every 10 seconds.

### 5.2 Job life cycle
```
queued -> claimed -> running -> done
   |         |          '-----> failed (error_code)
   |         '-----> queued   (lease expired, attempts < 2, nothing streamed yet)
   '-----> expired (queue TTL passed: 90 s chat/continue, 30 min extract/eval)
any non-final -> cancelled (user pressed Stop)
```
Lease 90 s, renewed by every `faye_append_chunks` call (an empty array is a valid heartbeat; send one every 15 s). Max runtime: chat 180 s, continue 30 s, extract 300 s, eval 3600 s. Past either limit the job becomes `failed` with `worker_lost`. A requeue happens only if no chunk was written.

### 5.3 `faye_append_chunks(p_token text, p_worker text, p_job_id uuid, p_chunks jsonb) -> jsonb`
`p_chunks` is an array of `{ "seq": int, "ev": "chunk" | "retract" (default "chunk"), "text": string <= 8000 }`. At most 100 items and 64 KB per call. `seq` starts at 1 and must be consecutive: a `seq` already stored is skipped (idempotent retry); `seq = last + 1` is stored; anything else is rejected with `seq_gap`. At most 5000 chunks per job.
Replies:
```json
{ "ok": true, "cancel": false, "last_seq": 12, "interactive_waiting": false }
```
- `cancel: true` = stop generating now (the user pressed Stop, or the job is no longer yours). Close the Ollama stream; do not call complete.
- `interactive_waiting: true` = a `chat` or `continue` job is queued. Background (`eval`, `extract`) work should pause and claim it.
- `{ "ok": false, "code": "seq_gap", "expected": 5 }` = resend from `expected`.
- `{ "ok": false, "cancel": true, "reason": "not_yours" | "<final status>" }`.
First successful append moves the job from `claimed` to `running`. Flush about every 1 second or 24 characters.

### 5.4 `faye_complete_job(p_token text, p_worker text, p_job_id uuid, p_result jsonb) -> jsonb`
`{ "ok": true, "status": "done" }`, or `{ "ok": true, "status": "done", "already": true }` on a retry, or `{ "ok": true, "status": "cancelled", "cancelled": true }` if the user stopped it (nothing stored). Result too large: the job is failed with `too_large` and the reply is `{ "ok": false, "code": "too_large" }`. A job that is not yours: `{ "ok": false, "code": "not_yours" }`.

### 5.5 `faye_fail_job(p_token text, p_worker text, p_job_id uuid, p_code text, p_message text default null) -> jsonb`
`p_code` is one of `generation_failed`, `worker_lost`, `too_large`, `not_allowed`; anything else is stored as `generation_failed`. `p_message` (at most 300 characters) is stored for the owner's diagnosis and is NEVER shown to a user and must not contain question text or secrets. Reply `{ "ok": true, "status": "failed" }`.

### 5.6 `faye_submit_memory_proposals(p_token text, p_worker text, p_job_id uuid, p_items jsonb) -> jsonb`
Only for an `extract` job claimed by this worker; the user comes from the job, never from arguments. `p_items` is an array of at most 3 objects: `{ "category": "style|preference|habit|tendency|goal|context|avoid", "slot": "string or null", "fact": "3..200 chars", "confidence": 0..50 }`. Each becomes a `faye_memory_items` row with `source = 'proposed_by_model'`, `status = 'proposed'`, `sensitivity = 'normal'`, confidence clamped to 50. Skipped (and counted) when it fails validation, when the table's own checks reject it, when it duplicates an existing fact, or when `faye_memory_settings.learning_paused` is true. Reply `{ "ok": true, "inserted": 1, "skipped": 2 }`.
If the memory tables are not installed yet: `{ "ok": false, "code": "not_ready" }`.

### 5.7 `faye_get_approved_eval_items(p_token text, p_worker text, p_job_id uuid) -> jsonb` and `faye_report_eval_run(p_token text, p_worker text, p_job_id uuid, p_run jsonb) -> jsonb`
Only for an `eval` job claimed by this worker.
- get returns `{ "ok": true, "items": [ { "id": "uuid", "split": "train|heldout", "suite": "guardrail|domain|persona", "question": "...", "required_keywords": ["a|b", "c"] } ] }` (approved items of the job's user).
- report takes `p_run = { "suite": "guardrail", "started_at": "...", "finished_at": "...", "passed": 8, "total": 8, "per_item": [ ... ], "constraint_sha": "...", "persona_sha": "...", "model": "gemma3:1b" }` and inserts a `faye_eval_runs` row (`worker_id` = `p_worker`, `requested_by` = the job's user). Reply `{ "ok": true, "run_id": "uuid" }`.
- Both return `{ "ok": false, "code": "not_ready" }` until WP-C2's tables exist.

### 5.8 What the worker can NOT do
It cannot read or list jobs it does not hold, read memory, see a user id or email, or touch any table. A leaked token can read and answer only the jobs it claims, until revoked.

---

## 6. `memory_pack` v1

Attached by the route at submit time (WP-F produces it; the mailbox validates it). The browser never supplies it.
```json
{ "v": 1,
  "items": [ { "id": "uuid", "cat": "style", "t": "Likes the number first, then one line of why." } ],
  "chars": 47,
  "hash": "0123456789abcdef" }
```
Rules (enforced by `validateMemoryPack`; an invalid pack is dropped, the job still runs with `memory: null`):
- `items`: 1 to 6 entries. An empty pack is never sent (use `memory: null`).
- `id`: UUID of an approved `faye_memory_items` row. `cat`: one of `style, preference, habit, tendency, goal, context, avoid`. `t`: 3 to 200 characters, no control characters or newlines, no leading or trailing space.
- `chars` = sum of the lengths of all `t` (JavaScript string length), at most 900.
- `hash` = first 16 hex characters of `sha256( items.map(i => i.id + ":" + i.cat + ":" + i.t).join("\n") )` (UTF-8). Helper: `computeMemoryPackHash(items)` in `src/lib/faye/mailbox/validate.ts`. The Python side can recompute it to detect tampering.
- Provenance returns `memory_ids` and `memory_hash` only, never the text.
- The worker renders the pack inside the fixed "ABOUT THE PERSON" block (design 3.5) and re-sanitizes. Memory never reaches the orchestrator, the action parser or the guardrail.

---

## 7. `persona` file v1 (WP-D produces, WP-B loads)

File: `persona/faye_persona.json` in the Faye repo (NOT under `corpus/`). UTF-8 JSON object, exactly these keys (unknown keys are rejected by the loader):
```json
{
  "schema_version": 1,
  "persona_version": "2026-10-20.1",
  "name": "Faye",
  "one_line": "The calm, exact one who reads the footnotes ... (<= 200 chars)",
  "prompt_block": "VOICE: You are Faye. ... (<= 600 chars)",
  "exemplars": [ { "user": "<= 200 chars", "faye": "<= 400 chars" } ],
  "scripted_lines": {
    "offline": "<= 160 chars", "thinking": "...", "saved_note": "...", "forgotten": "...", "celebrate": "..."
  },
  "forbidden_phrases": [ "as an ai language model", "!!" ],
  "limits": { "max_words": 120, "max_exclamations": 1, "allow_emoji": false },
  "humour_level": 1
}
```
Validation rules:
- `schema_version` is the integer 1. `persona_version` matches `^\d{4}-\d{2}-\d{2}\.\d+$`. `name` 1 to 40 characters.
- `prompt_block` 1 to 600 characters. `exemplars` 0 to 3 items. All five `scripted_lines` keys are required (`offline, thinking, saved_note, forgotten, celebrate`); additional keys are allowed if they match `^[a-z_]{1,40}$`; each line 1 to 160 characters, at most 1 exclamation mark, no emoji.
- `forbidden_phrases`: up to 50 lowercase strings of 1 to 80 characters. No scripted line or exemplar may contain one.
- `limits.max_words` 20..300, `limits.max_exclamations` 0..3, `allow_emoji` boolean. `humour_level` integer 0..5.
- `persona_sha256_16` = first 16 hex of SHA-256 of the canonical JSON of the whole file: keys sorted at every level, separators `,` and `:` with no spaces, non-ASCII kept as UTF-8 (Python: `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`). It goes into `provenance.persona_sha256_16`, next to `constraint_sha256_16`.
- Existing exact texts (greeting, identity line, the advice redirect) are NOT in this file and do not change.

---

## 8. Error codes

Stable. Each has one HTTP status when it is returned by a route, and one friendly message built on the server.

| code | HTTP | When | Friendly message (sent as `error`) |
|---|---|---|---|
| `faye_offline` | 503 | no worker contact for 45 s; nothing is queued | Faye is resting right now. Your notes are still here. Try again in a bit. |
| `rate_limited` | 429 | in-flight, queue or daily cap (`detail` says which) | Faye is busy or you hit today's limit. Wait a moment and try again. |
| `too_large` | 413 | question, state, results or result over its cap | That request is too large for Faye. Ask a shorter question. |
| `worker_lost` | job final state | lease or max runtime ran out | Faye lost her train of thought. Please ask again. |
| `expired` | job final state | no worker claimed it before the queue TTL | Faye did not pick that up in time, so I dropped it. Please ask again. |
| `not_allowed` | 403 | not an owner, unconfirmed email, bad Origin, DB gate said no | Faye is not available for this account. |

Additional codes (also stable): `auth_required` 401, `bad_request` 400, `not_found` 404, `disabled` 503 (flag off), `generation_failed` (job final state: the model or server failed), `seq_gap` and `not_yours` and `not_ready` (worker-side only), `server_error` 500 (database error, never shows detail), `unavailable` 503 (migration not applied).
A job that ends `failed`/`expired` is reported by the long-poll route as `status` plus `error: { code, message }` with HTTP 200.

---

## 9. Tables and settings (read this before writing your migration)

Owned by WP-A (migration `db/migrations/2026-10-20_faye_mailbox.sql`): `faye_access`, `faye_settings`, `faye_runtime`, `faye_worker_tokens`, `faye_jobs`, `faye_job_chunks`.

`faye_settings` (key, value int). Defaults if a key is missing:
`max_in_flight_interactive` 1, `max_in_flight_background` 1, `max_queued_global` 5, `queue_ttl_interactive_sec` 90, `queue_ttl_background_sec` 1800, `lease_sec` 90, `online_window_sec` 45, `wake_window_sec` 300, `retention_payload_hours` 24, `retention_meta_days` 30, `max_attempts` 2.
Change with: `update public.faye_settings set value = 8 where key = 'max_queued_global';` (insert the row if absent).
The daily cap is per person: `faye_access.daily_cap`.

Cross-package expectations (functions in the mailbox migration reference these tables only if they exist; each guarded by `to_regclass`):
- WP-F `faye_memory_items` must have at least: `user_id uuid, category text, slot text, fact text, source text, source_ref text, confidence smallint, status text, sensitivity text`, with defaults for every other column, and the `(user_id, md5(lower(fact)))` unique index. `faye_memory_settings(user_id, learning_paused boolean)`. Also deleted by `faye_erase_me` when present: `faye_memory_settings`, `faye_memory_events`, `faye_usage_stats` (all with `user_id`).
- WP-C2 `faye_eval_items(id, user_id, split, suite, question, required_keywords text[], approved boolean)`, `faye_eval_runs(id uuid default gen_random_uuid(), suite, started_at, finished_at, passed, total, per_item jsonb, constraint_sha, persona_sha, model, worker_id, requested_by uuid)`. Also deleted by `faye_erase_me` when present: `faye_feedback`, `faye_corrections`, `faye_corpus_notes` (by `user_id`), `faye_eval_runs` (by `requested_by`).

Owner set-up functions (run in the SQL editor; not callable from the app or by the worker): `faye_seed_owner(p_email text)`, `faye_revoke_access(p_email text)`, `faye_create_worker_token(p_label text)`, `faye_list_worker_tokens()`, `faye_revoke_worker_token(p_id uuid)`.

---

## 10. Limits at a glance

| Item | Value |
|---|---|
| Question | 4000 characters |
| Chat state | 1500 serialized characters (rebuilt from an allowlist) |
| Chat request in the database | 300 KB |
| Continue state / results | 200 KB / 1.5 MB (request in the database 1.7 MB) |
| Chunk | 8000 characters; 100 per call; 64 KB per call; 5000 per job |
| Provenance | 8 KB |
| Memory pack | 6 items, 900 characters |
| Online window | 45 s |
| Queue TTL | 90 s interactive, 30 min background |
| Lease | 90 s (heartbeat every 15 s) |
| Retention | payloads and chunks 24 h; job metadata 30 days |
| Caps | 1 interactive + 1 background in flight per user; 5 queued; 150 chat per rolling 24 h (owner) |
| Long poll | wait default 8 s, max 12 s; database check every 300 ms |

---

## 11. Where this file differs from the design (all deliberate)

1. **Owner pinned at seed time, not on first request.** The user id is tied to the email when the owner runs `faye_seed_owner('his@email')` in the SQL editor (it looks the user up in `auth.users` and refuses an unconfirmed address). That removes the first-request race. The database check is id AND email AND confirmed email, on every call.
2. **Limits live in `faye_settings`, not environment variables.** A caller-supplied cap could be bypassed; a database cannot read Vercel variables.
3. **`faye_claim_job` returns one JSON object**, not a table, so "no job" still carries `fast_poll_until`.
4. **Interactive and background jobs have separate in-flight slots**, so a long `extract` or `eval` never blocks the owner's chat.
5. **Worker functions are granted to `anon` only**, not `authenticated`.
6. **Browser reads go through `faye_poll_job`** (and RLS select exists as a second layer), so the poll can lazily expire jobs when no worker is running.
7. **New events and fields:** `retract` rides in the chunk table (`ev`); `interactive_waiting` on append replies lets eval work yield.
8. **Extra error codes** beyond the six: see section 8.
