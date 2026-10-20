-- Faye "mailbox": the Supabase tables and functions that let the signed-in owner reach Faye from any browser, with the
-- Faye worker (Oracle VM or the owner's PC) only ever making OUTBOUND calls.   *** DRAFT, NOT RUN. Review first. ***
--
-- Design:   Dellegate/team_audits/2026-10-19/faye-personal-design.md  (sections 1, 2, 7)
-- Contract: FAYE_MAILBOX_CONTRACT.md (repo root) - exact names, signatures and JSON shapes. Keep the two in step.
-- Package:  WP-A (mailbox backend). Run order for the Faye migrations: this file first, then the memory file, then the lab file.
--
-- What this file creates (all additive; nothing existing is altered or dropped):
--   Tables      faye_access (who may use Faye; empty until faye_seed_owner is run), faye_settings (tunable caps),
--               faye_runtime (one row: the "wake" hint and the purge clock), faye_worker_tokens (token HASHES only),
--               faye_jobs (the mailbox), faye_job_chunks (streamed pieces of an answer).
--   Browser     faye_status, faye_submit_job, faye_poll_job, faye_cancel_job, faye_erase_me, faye_is_allowed   -> role authenticated
--   Worker      faye_claim_job, faye_append_chunks, faye_complete_job, faye_fail_job, faye_submit_memory_proposals,
--               faye_get_approved_eval_items, faye_report_eval_run                                            -> role anon + token
--   Owner only  faye_seed_owner, faye_revoke_access, faye_create_worker_token, faye_list_worker_tokens, faye_revoke_worker_token
--               (SQL editor only: execute is revoked from anon and authenticated)
--   Internal    faye_cfg, faye_user_role, faye_worker_online, faye_assert_worker, faye_reap (no grants)
--
-- Security model in one paragraph:
--   * RLS is ON for every table. Role anon has NO table privileges at all. Role authenticated has SELECT only, on its own
--     rows of faye_access, faye_jobs and faye_job_chunks, and only while faye_is_allowed() is true.
--   * Every write goes through a SECURITY DEFINER function with search_path = '' that checks the caller itself.
--   * The browser-side functions take the user from auth.uid(); no user id is ever an argument.
--   * "Allowed" means: a faye_access row that is not revoked, the user's email is CONFIRMED in auth.users, and the email in
--     faye_access equals the user's current email. The row is created by faye_seed_owner() from the SQL editor, which ties
--     the email to the user id once (the id is pinned from then on).
--   * The worker presents a random token. Only sha256(token) is stored. A bad or revoked token raises SQLSTATE 28000.
--     A worker can claim jobs and answer the ones it holds; it cannot list jobs, read memory, or see a user id or email.
--
-- Run once in the Supabase SQL editor. Safe to re-run (create ... if not exists / create or replace / drop policy if exists).
-- To undo: 2026-10-20_faye_mailbox_down.sql.
--
-- NOT verified against the real project (see the report): the default statement_timeout for anon, pg_cron, and whether
-- Supabase's default privileges grant EXECUTE to PUBLIC (this file revokes it explicitly either way).

-- =====================================================================================================================
-- 1. TABLES
-- =====================================================================================================================

-- 1a. Who may use Faye. Empty after this file runs. The owner row is created with faye_seed_owner('email') (step 5).
create table if not exists public.faye_access (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  email          text not null check (length(email) between 3 and 320),
  role           text not null check (role in ('owner', 'approved')),
  memory_enabled boolean not null default true,
  daily_cap      integer not null default 40 check (daily_cap between 0 and 1000),   -- chat jobs per rolling 24 hours
  created_by     uuid,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

-- 1b. Tunable limits. One row per key; a missing key falls back to the default written in faye_cfg() calls below.
--     Change with:  update public.faye_settings set value = 8 where key = 'max_queued_global';
create table if not exists public.faye_settings (
  key   text primary key check (key ~ '^[a-z_]{1,48}$'),
  value integer not null check (value between 0 and 100000000),
  note  text
);
insert into public.faye_settings (key, value, note) values
  ('max_in_flight_interactive', 1,    'chat + continue jobs one person may have queued or running at once'),
  ('max_in_flight_background',  1,    'extract + eval jobs one person may have queued or running at once'),
  ('max_queued_global',         5,    'queued jobs across the whole system (continue jobs are exempt)'),
  ('queue_ttl_interactive_sec', 90,   'seconds a chat/continue job may wait for a worker before it expires'),
  ('queue_ttl_background_sec',  1800, 'seconds an extract/eval job may wait for a worker before it expires'),
  ('lease_sec',                 90,   'seconds a claimed job stays reserved; renewed by every append'),
  ('online_window_sec',         45,   'a worker counts as online if it made a valid call within this many seconds'),
  ('wake_window_sec',           300,  'how long opening the Faye panel keeps the worker on its fast (2 s) poll'),
  ('retention_payload_hours',   24,   'request and result payloads and chunks are erased after this many hours'),
  ('retention_meta_days',       30,   'job metadata rows (no text) are deleted after this many days'),
  ('max_attempts',              2,    'times a job may be claimed (requeue only if nothing was streamed)')
on conflict (key) do nothing;

-- 1c. One-row runtime state: the "wake" hint and the clock for the opportunistic purge.
create table if not exists public.faye_runtime (
  id            boolean primary key default true check (id),
  wake_until    timestamptz,
  last_purge_at timestamptz
);
insert into public.faye_runtime (id) values (true) on conflict (id) do nothing;

-- 1d. Worker tokens. Only the SHA-256 hash is stored. Create with faye_create_worker_token(), revoke with faye_revoke_worker_token().
create table if not exists public.faye_worker_tokens (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (length(label) between 1 and 64),
  token_hash     bytea not null unique,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  last_seen_at   timestamptz,
  last_worker_id text
);

-- 1e. The mailbox.
create table if not exists public.faye_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  request_id       text not null check (request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  kind             text not null check (kind in ('chat', 'continue', 'extract', 'eval')),
  status           text not null default 'queued'
                     check (status in ('queued', 'claimed', 'running', 'done', 'failed', 'expired', 'cancelled')),
  request          jsonb,                      -- erased (set null) after the retention window
  result           jsonb,                      -- erased (set null) after the retention window
  error_code       text check (error_code is null or error_code in
                     ('faye_offline', 'rate_limited', 'too_large', 'worker_lost', 'expired', 'not_allowed', 'generation_failed')),
  error_detail     text check (error_detail is null or length(error_detail) <= 300),   -- worker's note; never shown to users
  parent_job_id    uuid references public.faye_jobs (id) on delete set null,
  attempts         integer not null default 0,
  claimed_by       text,
  claimed_at       timestamptz,
  lease_expires_at timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,       -- queue deadline: unclaimed after this = expired
  max_runtime_sec  integer not null,
  last_seq         integer not null default 0,
  cancel_requested boolean not null default false,
  payload_purged_at timestamptz,
  unique (user_id, request_id)
);
create index if not exists faye_jobs_queue_idx   on public.faye_jobs (kind, created_at) where status = 'queued';
create index if not exists faye_jobs_user_idx    on public.faye_jobs (user_id, created_at desc);
create index if not exists faye_jobs_lease_idx   on public.faye_jobs (lease_expires_at) where status in ('claimed', 'running');
create index if not exists faye_jobs_created_idx on public.faye_jobs (created_at);

-- 1f. Streamed pieces of an answer. ev = 'retract' means "replace the whole message text with this text".
create table if not exists public.faye_job_chunks (
  job_id     uuid not null references public.faye_jobs (id) on delete cascade,
  seq        integer not null check (seq >= 1),
  user_id    uuid not null,                    -- copied from the job so the RLS policy needs no join
  ev         text not null default 'chunk' check (ev in ('chunk', 'retract')),
  text       text not null check (length(text) <= 8000),
  created_at timestamptz not null default now(),
  primary key (job_id, seq)
);
create index if not exists faye_job_chunks_created_idx on public.faye_job_chunks (created_at);

-- Row level security on every table, and no default Supabase privileges left behind.
alter table public.faye_access        enable row level security;
alter table public.faye_settings      enable row level security;
alter table public.faye_runtime       enable row level security;
alter table public.faye_worker_tokens enable row level security;
alter table public.faye_jobs          enable row level security;
alter table public.faye_job_chunks    enable row level security;

revoke all on public.faye_access        from anon, authenticated;
revoke all on public.faye_settings      from anon, authenticated;
revoke all on public.faye_runtime       from anon, authenticated;
revoke all on public.faye_worker_tokens from anon, authenticated;
revoke all on public.faye_jobs          from anon, authenticated;
revoke all on public.faye_job_chunks    from anon, authenticated;

-- =====================================================================================================================
-- 2. INTERNAL HELPERS (no grants: only the SECURITY DEFINER functions below call them)
-- =====================================================================================================================

create or replace function public.faye_cfg(p_key text, p_default integer)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value from public.faye_settings s where s.key = p_key), p_default)
$$;

-- The role of a user, or null when not allowed: row present, not revoked, email confirmed, and the email still matches.
create or replace function public.faye_user_role(p_uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select a.role
    from public.faye_access a
    join auth.users u on u.id = a.user_id
   where a.user_id = p_uid
     and a.revoked_at is null
     and u.email_confirmed_at is not null
     and lower(btrim(u.email)) = lower(btrim(a.email))
   limit 1
$$;

create or replace function public.faye_worker_online()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.faye_worker_tokens t
     where t.revoked_at is null
       and t.last_seen_at > now() - make_interval(secs => public.faye_cfg('online_window_sec', 45))
  )
$$;

-- Validates the worker token (hash lookup, not revoked) and the worker label; stamps the heartbeat. Returns the token id.
create or replace function public.faye_assert_worker(p_token text, p_worker text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9._:-]{1,64}$' then
    raise exception 'faye: bad worker id' using errcode = '28000';
  end if;
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    raise exception 'faye: invalid worker token' using errcode = '28000';
  end if;
  select t.id into v_id
    from public.faye_worker_tokens t
   where t.token_hash = sha256(convert_to(p_token, 'UTF8')) and t.revoked_at is null;
  if v_id is null then
    raise exception 'faye: invalid worker token' using errcode = '28000';
  end if;
  update public.faye_worker_tokens
     set last_seen_at = now(), last_worker_id = p_worker
   where id = v_id and (last_seen_at is null or last_seen_at < now() - interval '5 seconds');
  return v_id;
end $$;

-- The reaper. With a job id it only looks at that job (cheap; used by the browser poll). Without one it sweeps everything
-- and, at most every 10 minutes, purges old payloads (opportunistic: no pg_cron needed).
create or replace function public.faye_reap(p_job_id uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attempts integer := public.faye_cfg('max_attempts', 2);
  v_hours    integer := public.faye_cfg('retention_payload_hours', 24);
  v_days     integer := public.faye_cfg('retention_meta_days', 30);
  v_due      boolean;
begin
  -- 1. Nobody claimed it in time.
  update public.faye_jobs
     set status = 'expired', error_code = 'expired', finished_at = now()
   where status = 'queued' and expires_at < now() and (p_job_id is null or id = p_job_id);

  -- 2. A lease ran out and nothing was streamed yet: put it back once (an honest second try, never two answers).
  update public.faye_jobs
     set status = 'queued', claimed_by = null, claimed_at = null, lease_expires_at = null,
         expires_at = greatest(expires_at, now() + interval '60 seconds')
   where status in ('claimed', 'running') and lease_expires_at < now()
     and attempts < v_attempts and last_seq = 0 and not cancel_requested
     and (p_job_id is null or id = p_job_id);

  -- 3. Lease ran out after output started, or the job ran past its maximum runtime.
  update public.faye_jobs
     set status = 'failed', error_code = 'worker_lost', finished_at = now(), lease_expires_at = null
   where status in ('claimed', 'running')
     and (lease_expires_at < now() or claimed_at + make_interval(secs => max_runtime_sec) < now())
     and (p_job_id is null or id = p_job_id);

  if p_job_id is null then
    update public.faye_runtime set last_purge_at = now()
     where id and (last_purge_at is null or last_purge_at < now() - interval '10 minutes')
    returning true into v_due;
    if coalesce(v_due, false) then
      delete from public.faye_job_chunks where created_at < now() - make_interval(hours => v_hours);
      update public.faye_jobs
         set request = null, result = null, payload_purged_at = now()
       where payload_purged_at is null and created_at < now() - make_interval(hours => v_hours);
      delete from public.faye_jobs where created_at < now() - make_interval(days => v_days);
    end if;
  end if;
end $$;

-- =====================================================================================================================
-- 3. BROWSER-SIDE FUNCTIONS (role authenticated; the user is always auth.uid())
-- =====================================================================================================================

-- Policies call this, so it must be executable by authenticated. It only ever answers for the caller.
create or replace function public.faye_is_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.faye_user_role(auth.uid()) is not null
$$;

create or replace function public.faye_status(p_wake boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_age numeric;
  v_wake timestamptz;
  v_cap integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  v_role := public.faye_user_role(v_uid);
  if v_role is null then return jsonb_build_object('ok', true, 'allowed', false, 'online', false); end if;

  if coalesce(p_wake, false) then
    update public.faye_runtime
       set wake_until = now() + make_interval(secs => public.faye_cfg('wake_window_sec', 300)) where id;
  end if;
  select wake_until into v_wake from public.faye_runtime where id;
  select extract(epoch from (now() - max(t.last_seen_at))) into v_age
    from public.faye_worker_tokens t where t.revoked_at is null;
  select a.daily_cap into v_cap from public.faye_access a where a.user_id = v_uid;

  return jsonb_build_object(
    'ok', true, 'allowed', true, 'role', v_role,
    'online', public.faye_worker_online(),
    'worker_age_sec', case when v_age is null then null else floor(v_age)::int end,
    'queue_depth', (select count(*) from public.faye_jobs where status = 'queued'),
    'in_flight', (select count(*) from public.faye_jobs where user_id = v_uid and status in ('queued', 'claimed', 'running')),
    'used_today', (select count(*) from public.faye_jobs where user_id = v_uid and kind = 'chat' and created_at > now() - interval '24 hours'),
    'daily_cap', v_cap,
    'wake_until', case when v_wake > now() then v_wake else null end,
    'server_time', now());
end $$;

create or replace function public.faye_submit_job(
  p_request_id text, p_kind text, p_request jsonb, p_parent_job_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_existing public.faye_jobs%rowtype;
  v_parent public.faye_jobs%rowtype;
  v_size integer;
  v_class_kinds text[];
  v_in_flight integer;
  v_cap integer;
  v_used integer;
  v_ttl integer;
  v_runtime integer;
  v_id uuid;
  v_retry integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed', 'detail', 'no_session'); end if;
  v_role := public.faye_user_role(v_uid);
  if v_role is null then return jsonb_build_object('ok', false, 'code', 'not_allowed', 'detail', 'not_allowed'); end if;

  if p_kind is null or p_kind not in ('chat', 'continue', 'extract', 'eval') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_kind');
  end if;
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_request_id');
  end if;
  if p_kind in ('extract', 'eval') and v_role <> 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not_allowed', 'detail', 'owner_only');
  end if;
  if p_request is null or jsonb_typeof(p_request) <> 'object' or p_request->'v' is distinct from '1'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
  end if;

  -- Idempotency first: a repeated request_id returns the same job and never counts against a cap.
  select * into v_existing from public.faye_jobs where user_id = v_uid and request_id = p_request_id;
  if found then
    if v_existing.kind <> p_kind then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'kind_mismatch');
    end if;
    return jsonb_build_object('ok', true, 'job_id', v_existing.id, 'status', v_existing.status,
                              'deduped', true, 'queue_ahead', 0, 'expires_at', v_existing.expires_at);
  end if;

  -- Size and shape. The route enforces these too; the database is the last line for a caller that skips the route.
  v_size := octet_length(p_request::text);
  if p_kind = 'chat' then
    if v_size > 300000 then return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'request'); end if;
    if jsonb_typeof(p_request->'question') is distinct from 'string' or length(btrim(p_request->>'question')) < 1 then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
    end if;
    if length(p_request->>'question') > 4000 then
      return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'question');
    end if;
    if p_request ? 'state' and jsonb_typeof(p_request->'state') not in ('object', 'null') then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
    end if;
    if octet_length(coalesce((p_request->'state')::text, '')) > 200000 then
      return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'state');
    end if;
  elsif p_kind = 'continue' then
    if v_size > 1700000 then return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'request'); end if;
    if jsonb_typeof(p_request->'state') is distinct from 'object' or jsonb_typeof(p_request->'results') is distinct from 'object' then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
    end if;
    if octet_length((p_request->'state')::text) > 200000 then
      return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'state');
    end if;
    select * into v_parent from public.faye_jobs where id = p_parent_job_id and user_id = v_uid;
    if p_parent_job_id is null or not found or v_parent.status <> 'done'
       or v_parent.kind not in ('chat', 'continue') or v_parent.result->>'kind' is distinct from 'tool_calls' then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_parent');
    end if;
  elsif p_kind = 'extract' then
    if v_size > 100000 then return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'request'); end if;
    if jsonb_typeof(p_request->'exchanges') is distinct from 'array'
       or jsonb_array_length(p_request->'exchanges') not between 1 and 4 then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
    end if;
  else -- eval
    if v_size > 10000 then return jsonb_build_object('ok', false, 'code', 'too_large', 'detail', 'request'); end if;
    if p_request->>'suite' is null or p_request->>'suite' not in ('guardrail', 'orchestration', 'heldout', 'domain', 'persona', 'full') then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
    end if;
  end if;

  perform public.faye_reap();

  -- Honest fast-fail: nothing is queued while no worker is alive.
  if not public.faye_worker_online() then
    return jsonb_build_object('ok', false, 'code', 'faye_offline');
  end if;

  -- Serialise this user's submissions so the count-then-insert below cannot race with itself.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 7));

  v_class_kinds := case when p_kind in ('chat', 'continue') then array['chat', 'continue'] else array['extract', 'eval'] end;
  v_cap := case when p_kind in ('chat', 'continue') then public.faye_cfg('max_in_flight_interactive', 1)
                else public.faye_cfg('max_in_flight_background', 1) end;
  select count(*) into v_in_flight from public.faye_jobs
   where user_id = v_uid and status in ('queued', 'claimed', 'running') and kind = any (v_class_kinds);
  if v_in_flight >= v_cap then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'detail', 'in_flight', 'retry_after_sec', 5);
  end if;

  if p_kind <> 'continue' and (select count(*) from public.faye_jobs where status = 'queued') >= public.faye_cfg('max_queued_global', 5) then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'detail', 'queue_full', 'retry_after_sec', 10);
  end if;

  if p_kind = 'chat' then
    select a.daily_cap into v_cap from public.faye_access a where a.user_id = v_uid;
    select count(*) into v_used from public.faye_jobs
     where user_id = v_uid and kind = 'chat' and created_at > now() - interval '24 hours';
    if v_used >= coalesce(v_cap, 0) then
      select greatest(1, ceil(extract(epoch from (min(c.created_at) + interval '24 hours' - now())))::int) into v_retry
        from (select created_at from public.faye_jobs
               where user_id = v_uid and kind = 'chat' and created_at > now() - interval '24 hours'
               order by created_at limit 1) c;
      return jsonb_build_object('ok', false, 'code', 'rate_limited', 'detail', 'daily_cap', 'retry_after_sec', coalesce(v_retry, 60));
    end if;
  end if;

  v_ttl := case when p_kind in ('chat', 'continue') then public.faye_cfg('queue_ttl_interactive_sec', 90)
                else public.faye_cfg('queue_ttl_background_sec', 1800) end;
  v_runtime := case p_kind when 'chat' then 180 when 'continue' then 30 when 'extract' then 300 else 3600 end;

  insert into public.faye_jobs (user_id, request_id, kind, request, parent_job_id, expires_at, max_runtime_sec)
  values (v_uid, p_request_id, p_kind, p_request, case when p_kind = 'continue' then p_parent_job_id else null end,
          now() + make_interval(secs => v_ttl), v_runtime)
  on conflict (user_id, request_id) do nothing
  returning id into v_id;

  if v_id is null then  -- lost a race with an identical request_id: return that job
    select * into v_existing from public.faye_jobs where user_id = v_uid and request_id = p_request_id;
    return jsonb_build_object('ok', true, 'job_id', v_existing.id, 'status', v_existing.status,
                              'deduped', true, 'queue_ahead', 0, 'expires_at', v_existing.expires_at);
  end if;

  return jsonb_build_object('ok', true, 'job_id', v_id, 'status', 'queued', 'deduped', false,
    'queue_ahead', (select count(*) from public.faye_jobs where status = 'queued' and id <> v_id),
    'expires_at', now() + make_interval(secs => v_ttl));
end $$;

create or replace function public.faye_poll_job(p_job_id uuid, p_after integer default 0)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  j public.faye_jobs%rowtype;
  v_events jsonb;
  v_last integer;
  v_after integer := greatest(coalesce(p_after, 0), 0);
  v_more boolean;
  v_pos integer;
begin
  if v_uid is null or public.faye_user_role(v_uid) is null then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  perform public.faye_reap(p_job_id);

  -- Read the job FIRST, then the chunks: if the job is already done, every chunk was committed before it.
  select * into j from public.faye_jobs where id = p_job_id and user_id = v_uid;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  select coalesce(jsonb_agg(jsonb_build_object('seq', c.seq, 'ev', c.ev, 'text', c.text) order by c.seq), '[]'::jsonb),
         coalesce(max(c.seq), v_after)
    into v_events, v_last
    from (select seq, ev, text from public.faye_job_chunks
           where job_id = j.id and seq > v_after order by seq limit 200) c;
  select exists (select 1 from public.faye_job_chunks where job_id = j.id and seq > v_last) into v_more;
  if j.status = 'queued' then
    select count(*) into v_pos from public.faye_jobs q where q.status = 'queued' and q.created_at < j.created_at;
  end if;

  return jsonb_build_object(
    'ok', true, 'job_id', j.id, 'kind', j.kind, 'status', j.status,
    'events', v_events, 'last_seq', v_last, 'more', v_more,
    'queue_position', case when j.status = 'queued' then v_pos else null end,
    'result', case when j.status = 'done' and not v_more then j.result else null end,
    'error', case when j.status in ('failed', 'expired') then jsonb_build_object('code', coalesce(j.error_code, 'generation_failed')) else null end,
    'purged', j.payload_purged_at is not null,
    'server_time', now());
end $$;

create or replace function public.faye_cancel_job(p_job_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  j public.faye_jobs%rowtype;
begin
  if v_uid is null or public.faye_user_role(v_uid) is null then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into j from public.faye_jobs where id = p_job_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if j.status in ('queued', 'claimed', 'running') then
    update public.faye_jobs
       set status = 'cancelled', cancel_requested = true, finished_at = now(), lease_expires_at = null
     where id = j.id;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;
  return jsonb_build_object('ok', true, 'status', j.status);
end $$;

-- "Delete everything Faye holds about me." Works for any signed-in user on their own rows, even if access was revoked.
-- Tables owned by the memory and lab migrations are included only when they exist. The faye_access row is kept.
create or replace function public.faye_erase_me(p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_n bigint;
  t text;
  v_tables text[] := array['faye_corpus_notes', 'faye_eval_items', 'faye_corrections', 'faye_feedback',
                           'faye_memory_events', 'faye_memory_items', 'faye_memory_settings', 'faye_usage_stats'];
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_confirm is distinct from 'DELETE' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'confirm_required');
  end if;

  delete from public.faye_jobs where user_id = v_uid;   -- chunks go with them (on delete cascade)
  get diagnostics v_n = row_count;
  v_out := v_out || jsonb_build_object('faye_jobs', v_n);

  foreach t in array v_tables loop
    if to_regclass('public.' || t) is not null then
      execute format('delete from public.%I where user_id = $1', t) using v_uid;
      get diagnostics v_n = row_count;
      v_out := v_out || jsonb_build_object(t, v_n);
    end if;
  end loop;
  if to_regclass('public.faye_eval_runs') is not null then
    execute 'delete from public.faye_eval_runs where requested_by = $1' using v_uid;
    get diagnostics v_n = row_count;
    v_out := v_out || jsonb_build_object('faye_eval_runs', v_n);
  end if;
  return jsonb_build_object('ok', true, 'deleted', v_out);
end $$;

-- =====================================================================================================================
-- 4. WORKER-SIDE FUNCTIONS (role anon + worker token)
-- =====================================================================================================================

create or replace function public.faye_claim_job(p_token text, p_worker text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  v_wake timestamptz;
  v_lease integer := public.faye_cfg('lease_sec', 90);
begin
  perform public.faye_assert_worker(p_token, p_worker);
  perform public.faye_reap();
  select wake_until into v_wake from public.faye_runtime where id;
  if v_wake is not null and v_wake <= now() then v_wake := null; end if;

  select * into j from public.faye_jobs
   where status = 'queued' and expires_at > now()
   order by (kind in ('chat', 'continue')) desc, created_at
   for update skip locked limit 1;
  if not found then
    return jsonb_build_object('job_id', null, 'fast_poll_until', v_wake, 'server_time', now());
  end if;

  update public.faye_jobs
     set status = 'claimed', claimed_by = p_worker, claimed_at = now(),
         lease_expires_at = now() + make_interval(secs => v_lease), attempts = attempts + 1
   where id = j.id;
  return jsonb_build_object('job_id', j.id, 'kind', j.kind, 'request', j.request, 'attempts', j.attempts + 1,
                            'lease_sec', v_lease, 'max_runtime_sec', j.max_runtime_sec,
                            'fast_poll_until', v_wake, 'server_time', now());
end $$;

create or replace function public.faye_append_chunks(p_token text, p_worker text, p_job_id uuid, p_chunks jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  e jsonb;
  v_last integer;
  v_seq integer;
  v_ev text;
  v_text text;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id for update;
  if not found or j.claimed_by is distinct from p_worker then
    return jsonb_build_object('ok', false, 'cancel', true, 'reason', 'not_yours');
  end if;
  if j.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'cancel', true, 'last_seq', j.last_seq, 'interactive_waiting', false);
  end if;
  if j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', false, 'cancel', true, 'reason', j.status);
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) > 100
     or octet_length(p_chunks::text) > 65536 then
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;

  v_last := j.last_seq;
  for e in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'seq') <> 'number' or e->>'seq' !~ '^[0-9]{1,9}$'
       or jsonb_typeof(e->'text') <> 'string' then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_chunk');
    end if;
    v_seq := (e->>'seq')::integer;
    v_ev := coalesce(e->>'ev', 'chunk');
    v_text := e->>'text';
    if v_ev not in ('chunk', 'retract') or length(v_text) > 8000 then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_chunk');
    end if;
    if v_seq <= v_last then
      continue;                                    -- a retry of a chunk we already hold
    elsif v_seq = v_last + 1 then
      if v_seq > 5000 then
        update public.faye_jobs set status = 'failed', error_code = 'too_large', finished_at = now(), lease_expires_at = null
         where id = j.id;
        return jsonb_build_object('ok', false, 'cancel', true, 'reason', 'too_large');
      end if;
      insert into public.faye_job_chunks (job_id, seq, user_id, ev, text) values (j.id, v_seq, j.user_id, v_ev, v_text);
      v_last := v_seq;
    else
      return jsonb_build_object('ok', false, 'code', 'seq_gap', 'expected', v_last + 1);
    end if;
  end loop;

  update public.faye_jobs
     set status = 'running', started_at = coalesce(started_at, now()), last_seq = v_last,
         lease_expires_at = now() + make_interval(secs => public.faye_cfg('lease_sec', 90))
   where id = j.id;
  return jsonb_build_object('ok', true, 'cancel', false, 'last_seq', v_last,
    'interactive_waiting', exists (select 1 from public.faye_jobs q
                                    where q.status = 'queued' and q.kind in ('chat', 'continue') and q.expires_at > now()));
end $$;

create or replace function public.faye_complete_job(p_token text, p_worker text, p_job_id uuid, p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  v_cap integer;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id for update;
  if not found or j.claimed_by is distinct from p_worker then
    return jsonb_build_object('ok', false, 'code', 'not_yours');
  end if;
  if j.status = 'done' then return jsonb_build_object('ok', true, 'status', 'done', 'already', true); end if;
  if j.status = 'cancelled' then return jsonb_build_object('ok', true, 'status', 'cancelled', 'cancelled', true); end if;
  if j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_yours', 'detail', j.status);
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
  end if;
  v_cap := case j.kind when 'chat' then 262144 when 'continue' then 1572864 when 'extract' then 20000 else 200000 end;
  if octet_length(p_result::text) > v_cap then
    update public.faye_jobs set status = 'failed', error_code = 'too_large', finished_at = now(), lease_expires_at = null
     where id = j.id;
    return jsonb_build_object('ok', false, 'code', 'too_large');
  end if;
  update public.faye_jobs
     set status = 'done', result = p_result, finished_at = now(), lease_expires_at = null
   where id = j.id;
  return jsonb_build_object('ok', true, 'status', 'done');
end $$;

create or replace function public.faye_fail_job(p_token text, p_worker text, p_job_id uuid, p_code text, p_message text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  v_code text;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id for update;
  if not found or j.claimed_by is distinct from p_worker then
    return jsonb_build_object('ok', false, 'code', 'not_yours');
  end if;
  if j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', true, 'status', j.status, 'already', true);
  end if;
  v_code := case when p_code in ('generation_failed', 'worker_lost', 'too_large', 'not_allowed') then p_code else 'generation_failed' end;
  update public.faye_jobs
     set status = 'failed', error_code = v_code, error_detail = left(p_message, 300),
         finished_at = now(), lease_expires_at = null
   where id = j.id;
  return jsonb_build_object('ok', true, 'status', 'failed');
end $$;

-- Memory proposals from an `extract` job. The user comes from the job. Writes into the memory migration's table, so it
-- reports not_ready until that table exists. Every item is validated here and again by that table's own checks.
create or replace function public.faye_submit_memory_proposals(p_token text, p_worker text, p_job_id uuid, p_items jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  e jsonb;
  v_n integer;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_paused boolean := false;
  v_fact text;
  v_cat text;
  v_slot text;
  v_conf integer;
  v_seen integer := 0;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id;
  if not found or j.claimed_by is distinct from p_worker or j.kind <> 'extract' or j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_yours');
  end if;
  if to_regclass('public.faye_memory_items') is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or octet_length(p_items::text) > 20000 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
  end if;
  if to_regclass('public.faye_memory_settings') is not null then
    execute 'select learning_paused from public.faye_memory_settings where user_id = $1' into v_paused using j.user_id;
  end if;
  if coalesce(v_paused, false) then
    return jsonb_build_object('ok', true, 'inserted', 0, 'skipped', jsonb_array_length(p_items), 'paused', true);
  end if;

  for e in select value from jsonb_array_elements(p_items) loop
    v_seen := v_seen + 1;
    if v_seen > 3 then v_skipped := v_skipped + 1; continue; end if;
    v_fact := case when jsonb_typeof(e->'fact') = 'string' then btrim(e->>'fact') else null end;
    v_cat  := case when jsonb_typeof(e->'category') = 'string' then e->>'category' else null end;
    v_slot := case when jsonb_typeof(e->'slot') = 'string' then e->>'slot' else null end;
    v_conf := case when jsonb_typeof(e->'confidence') = 'number' and e->>'confidence' ~ '^[0-9]{1,3}$'
                   then least((e->>'confidence')::integer, 50) else 30 end;
    if v_fact is null or length(v_fact) not between 3 and 200 or v_fact ~ '[[:cntrl:]]'
       or v_cat is null or v_cat not in ('style', 'preference', 'habit', 'tendency', 'goal', 'context', 'avoid')
       or (v_slot is not null and v_slot !~ '^[a-z_]{1,40}$') then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    begin
      execute 'insert into public.faye_memory_items (user_id, category, slot, fact, source, source_ref, confidence, status, sensitivity) '
              'values ($1, $2, $3, $4, ''proposed_by_model'', $5, $6, ''proposed'', ''normal'') on conflict do nothing'
        using j.user_id, v_cat, v_slot, v_fact, j.id::text, v_conf;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_inserted := v_inserted + v_n; else v_skipped := v_skipped + 1; end if;
    exception when others then
      v_skipped := v_skipped + 1;                  -- the memory table's own checks said no (for example an injection phrase)
    end;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'skipped', v_skipped);
end $$;

create or replace function public.faye_get_approved_eval_items(p_token text, p_worker text, p_job_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  v_items jsonb;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id;
  if not found or j.claimed_by is distinct from p_worker or j.kind <> 'eval' or j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_yours');
  end if;
  if to_regclass('public.faye_eval_items') is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;
  execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'', i.id, ''split'', i.split, ''suite'', i.suite, '
          '''question'', i.question, ''required_keywords'', to_jsonb(i.required_keywords)) order by i.id), ''[]''::jsonb) '
          'from public.faye_eval_items i where i.user_id = $1 and i.approved'
    into v_items using j.user_id;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

create or replace function public.faye_report_eval_run(p_token text, p_worker text, p_job_id uuid, p_run jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  j public.faye_jobs%rowtype;
  v_id uuid;
begin
  perform public.faye_assert_worker(p_token, p_worker);
  select * into j from public.faye_jobs where id = p_job_id;
  if not found or j.claimed_by is distinct from p_worker or j.kind <> 'eval' or j.status not in ('claimed', 'running') then
    return jsonb_build_object('ok', false, 'code', 'not_yours');
  end if;
  if to_regclass('public.faye_eval_runs') is null then
    return jsonb_build_object('ok', false, 'code', 'not_ready');
  end if;
  if p_run is null or jsonb_typeof(p_run) <> 'object' or octet_length(p_run::text) > 200000 then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
  end if;
  begin
    execute 'insert into public.faye_eval_runs (suite, started_at, finished_at, passed, total, per_item, constraint_sha, persona_sha, model, worker_id, requested_by) '
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id'
      into v_id
      using left(p_run->>'suite', 40),
            (p_run->>'started_at')::timestamptz, (p_run->>'finished_at')::timestamptz,
            (p_run->>'passed')::integer, (p_run->>'total')::integer,
            coalesce(p_run->'per_item', '[]'::jsonb),
            left(p_run->>'constraint_sha', 64), left(p_run->>'persona_sha', 64), left(p_run->>'model', 80),
            p_worker, j.user_id;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_run');
  end;
  return jsonb_build_object('ok', true, 'run_id', v_id);
end $$;

-- =====================================================================================================================
-- 5. OWNER SET-UP FUNCTIONS (SQL editor only)
-- =====================================================================================================================

-- Ties an email to its user id, once. Refuses an address that has no account or is not confirmed.
create or replace function public.faye_seed_owner(p_email text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  u record;
begin
  select id, email, email_confirmed_at into u from auth.users where lower(btrim(email)) = v_email;
  if not found then raise exception 'faye_seed_owner: no Supabase user has that email'; end if;
  if u.email_confirmed_at is null then raise exception 'faye_seed_owner: that email is not confirmed in Supabase Auth'; end if;
  insert into public.faye_access (user_id, email, role, daily_cap, created_by)
  values (u.id, v_email, 'owner', 150, u.id)
  on conflict (user_id) do update set email = excluded.email, role = 'owner', revoked_at = null;
  return jsonb_build_object('ok', true, 'user_id', u.id, 'email', v_email, 'role', 'owner');
end $$;

create or replace function public.faye_revoke_access(p_email text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  update public.faye_access set revoked_at = now() where lower(btrim(email)) = lower(btrim(p_email)) and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Returns the token ONCE. Only its SHA-256 hash is stored. About 244 random bits (two version-4 UUIDs).
create or replace function public.faye_create_worker_token(p_label text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_token text;
begin
  if p_label is null or length(btrim(p_label)) not between 1 and 64 then
    raise exception 'faye_create_worker_token: give a label of 1 to 64 characters, for example oracle-vm';
  end if;
  v_token := 'fwt_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.faye_worker_tokens (label, token_hash) values (btrim(p_label), sha256(convert_to(v_token, 'UTF8')));
  return v_token;
end $$;

create or replace function public.faye_list_worker_tokens()
returns table (id uuid, label text, created_at timestamptz, last_seen_at timestamptz, last_worker_id text, revoked_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.label, t.created_at, t.last_seen_at, t.last_worker_id, t.revoked_at
    from public.faye_worker_tokens t order by t.created_at
$$;

create or replace function public.faye_revoke_worker_token(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  update public.faye_worker_tokens set revoked_at = now() where id = p_id and revoked_at is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- =====================================================================================================================
-- 6. PRIVILEGES (explicit, because Supabase's default privileges would otherwise grant EXECUTE broadly)
-- =====================================================================================================================

-- Internal helpers: nobody but the function owner.
revoke all on function public.faye_cfg(text, integer)           from public, anon, authenticated;
revoke all on function public.faye_user_role(uuid)              from public, anon, authenticated;
revoke all on function public.faye_worker_online()              from public, anon, authenticated;
revoke all on function public.faye_assert_worker(text, text)    from public, anon, authenticated;
revoke all on function public.faye_reap(uuid)                   from public, anon, authenticated;

-- Browser side: authenticated only.
revoke all on function public.faye_is_allowed()                                     from public, anon, authenticated;
revoke all on function public.faye_status(boolean)                                  from public, anon, authenticated;
revoke all on function public.faye_submit_job(text, text, jsonb, uuid)              from public, anon, authenticated;
revoke all on function public.faye_poll_job(uuid, integer)                          from public, anon, authenticated;
revoke all on function public.faye_cancel_job(uuid)                                 from public, anon, authenticated;
revoke all on function public.faye_erase_me(text)                                   from public, anon, authenticated;
grant execute on function public.faye_is_allowed()                                  to authenticated;
grant execute on function public.faye_status(boolean)                               to authenticated;
grant execute on function public.faye_submit_job(text, text, jsonb, uuid)           to authenticated;
grant execute on function public.faye_poll_job(uuid, integer)                       to authenticated;
grant execute on function public.faye_cancel_job(uuid)                              to authenticated;
grant execute on function public.faye_erase_me(text)                                to authenticated;

-- Worker side: anon only (each function checks the token itself).
revoke all on function public.faye_claim_job(text, text)                            from public, anon, authenticated;
revoke all on function public.faye_append_chunks(text, text, uuid, jsonb)           from public, anon, authenticated;
revoke all on function public.faye_complete_job(text, text, uuid, jsonb)            from public, anon, authenticated;
revoke all on function public.faye_fail_job(text, text, uuid, text, text)           from public, anon, authenticated;
revoke all on function public.faye_submit_memory_proposals(text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.faye_get_approved_eval_items(text, text, uuid)        from public, anon, authenticated;
revoke all on function public.faye_report_eval_run(text, text, uuid, jsonb)         from public, anon, authenticated;
grant execute on function public.faye_claim_job(text, text)                         to anon;
grant execute on function public.faye_append_chunks(text, text, uuid, jsonb)        to anon;
grant execute on function public.faye_complete_job(text, text, uuid, jsonb)         to anon;
grant execute on function public.faye_fail_job(text, text, uuid, text, text)        to anon;
grant execute on function public.faye_submit_memory_proposals(text, text, uuid, jsonb) to anon;
grant execute on function public.faye_get_approved_eval_items(text, text, uuid)     to anon;
grant execute on function public.faye_report_eval_run(text, text, uuid, jsonb)      to anon;

-- Owner set-up: SQL editor (the postgres role) only.
revoke all on function public.faye_seed_owner(text)             from public, anon, authenticated;
revoke all on function public.faye_revoke_access(text)          from public, anon, authenticated;
revoke all on function public.faye_create_worker_token(text)    from public, anon, authenticated;
revoke all on function public.faye_list_worker_tokens()         from public, anon, authenticated;
revoke all on function public.faye_revoke_worker_token(uuid)    from public, anon, authenticated;

-- =====================================================================================================================
-- 7. ROW LEVEL SECURITY POLICIES (browser reads of its own rows only; there are no insert/update/delete policies)
-- =====================================================================================================================

grant select on public.faye_access     to authenticated;
grant select on public.faye_jobs       to authenticated;
grant select on public.faye_job_chunks to authenticated;

drop policy if exists faye_access_select_own on public.faye_access;
create policy faye_access_select_own on public.faye_access
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists faye_jobs_select_own on public.faye_jobs;
create policy faye_jobs_select_own on public.faye_jobs
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_is_allowed()));

drop policy if exists faye_job_chunks_select_own on public.faye_job_chunks;
create policy faye_job_chunks_select_own on public.faye_job_chunks
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_is_allowed()));

-- faye_settings, faye_runtime and faye_worker_tokens: RLS on, no policies, no grants. Only the functions above touch them.
