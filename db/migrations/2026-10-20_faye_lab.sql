-- Faye "Train and Test Lab": the owner's feedback, corrections ("teach me"), practice and exam questions, notes waiting for approval,
-- and the results of test runs.   *** DRAFT, NOT RUN. Review first. ***
--
-- Design:   Dellegate/team_audits/2026-10-19/faye-personal-design.md  (section 5, 7.2 row C2, 7.3 T1)
-- Contract: FAYE_MAILBOX_CONTRACT.md (repo root) section 5.7 (faye_get_approved_eval_items, faye_report_eval_run) and section 9
--           (columns the mailbox functions expect: faye_eval_items(id, user_id, split, suite, question, required_keywords, approved),
--           faye_eval_runs(...), and the tables faye_erase_me clears).
-- Package:  WP-C2 (Lab). Run order for the Faye migrations: 11-faye_mailbox.sql FIRST, then 12-faye_memory.sql, then this file (13).
--
-- What this file creates (additive; nothing existing is altered or dropped; re-running is safe):
--   Tables     faye_feedback       one rating per answer (good, wrong, too_long, off_voice) with an optional short note. Stores a
--                                  HASH and a SHORT EXCERPT (200 characters) of the answer. Never the raw chat.
--              faye_corrections    "teach me": the owner's better answer to a question he typed, with a status
--              faye_eval_items     practice questions (split 'train') and exam questions (split 'heldout')
--              faye_corpus_notes   notes PROPOSED for Faye's corpus: pending, approved, rejected. Approving only marks the row; nothing
--                                  here writes to the corpus (the owner's worker does that later, by hand).
--              faye_eval_runs      results reported by the worker through faye_report_eval_run
--   Browser    faye_lab_is_owner, faye_lab_overview, faye_lab_submit_feedback, faye_lab_list_feedback, faye_lab_save_correction,
--              faye_lab_list_corrections, faye_lab_decide_correction, faye_lab_promote_correction, faye_lab_list_eval_items,
--              faye_lab_update_eval_item, faye_lab_propose_note, faye_lab_list_notes, faye_lab_decide_note, faye_lab_list_runs
--              -> role authenticated only; each one re-checks that the caller is the OWNER
--   Internal   faye_lab_owner, faye_lab_question_key, faye_lab_keywords_ok, faye_lab_wall_hit, and the trigger functions (no grants)
--
-- Column names follow the frozen contract, not the brief: the split column is called `split` with values 'train' and 'heldout'
-- (the mailbox function faye_get_approved_eval_items and the memory trigger both read `e.split = 'heldout'`). The routes and the page
-- say "training" and "held-out" and map to these two values.
--
-- THE HELD-OUT WALL (design 5.3, threat T1). An exam question must never be taught, or the exam stops measuring. The database, not the
-- application, refuses each way it could happen (every refusal is SQLSTATE FL001, so the functions can answer held_out_wall):
--   1. The same question as practice AND exam: unique (user_id, question_key). The key is the question lower-cased with punctuation and
--      spacing removed, so "What is GEX?" and "what is gex" are one question and can sit in one set only.
--   2. The set never changes: a trigger refuses to change split, question or user on an existing item. To move a question you delete
--      it and add it again, which the app does not offer for exam questions.
--   3. A held-out item cannot be marked as used in the corpus: check (not (split = 'heldout' and used_in_corpus)).
--   4. A note cannot come from a held-out item (from_eval_item_id), nor from a correction that an exam question was made from, nor
--      contain (or be contained in) the text of one of the owner's exam questions. Checked on insert and again when a note is approved.
--   5. The other direction: an exam question cannot be added if a note already exists (not rejected) that holds its text or comes
--      from the correction it is made from.
--   Residual (not closed): deleting an exam question and re-adding it as a practice question is the owner's explicit choice.
--
-- Security model: RLS is ON for every table. Role anon has no privileges. Role authenticated has SELECT only, on its own rows, and only
-- while the caller is the owner. Every write goes through a SECURITY DEFINER function with search_path = '' that takes the person from
-- auth.uid() (never an argument) and requires role 'owner' in faye_access. Secret and card screening of text is done by the
-- application (src/lib/faye/lab/screen.ts) before the call; this file checks shape, length and control characters.
--
-- Run once in the Supabase SQL editor. To undo: 2026-10-20_faye_lab_down.sql.

-- =====================================================================================================================
-- 0. PRECONDITION: the mailbox migration must have run
-- =====================================================================================================================
do $$
begin
  if to_regprocedure('public.faye_user_role(uuid)') is null
     or to_regprocedure('public.faye_cfg(text, integer)') is null
     or to_regclass('public.faye_settings') is null then
    raise exception 'Run 11-faye_mailbox.sql first: faye_user_role / faye_cfg / faye_settings are missing.';
  end if;
end $$;

insert into public.faye_settings (key, value, note) values
  ('lab_max_feedback',    5000, 'feedback rows one person may keep (oldest are removed past this)'),
  ('lab_max_corrections', 500,  'corrections one person may keep'),
  ('lab_max_eval_items',  300,  'practice plus exam questions one person may keep'),
  ('lab_max_notes',       200,  'proposed or approved corpus notes one person may keep'),
  ('lab_max_runs',        200,  'test-run rows one person may keep (oldest are removed past this)')
on conflict (key) do nothing;

-- =====================================================================================================================
-- 1. PURE HELPERS (no table access, no grants)
-- =====================================================================================================================

-- The normal form of a question: lower case, every run of non-letters and non-digits collapsed to one space, trimmed.
create or replace function public.faye_lab_question_key(p_text text)
returns text language sql immutable set search_path = '' as $$
  select md5(btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:]]+', ' ', 'g')))
$$;

-- Keyword list for an exam item: up to 8 entries of 1 to 80 characters, no control characters ("a|b" alternatives are allowed).
create or replace function public.faye_lab_keywords_ok(p text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if p is null then return false; end if;
  if cardinality(p) > 8 then return false; end if;
  foreach k in array p loop
    if k is null or char_length(k) not between 1 and 80 or k ~ '[[:cntrl:]]' or k <> btrim(k) then return false; end if;
  end loop;
  return true;
end $$;

-- =====================================================================================================================
-- 2. TABLES
-- =====================================================================================================================

create table if not exists public.faye_feedback (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  job_id         uuid,                                      -- no foreign key: job rows are purged after 30 days, the rating stays
  rating         text not null check (rating in ('good', 'wrong', 'too_long', 'off_voice')),
  note           text check (note is null or (char_length(note) between 1 and 300 and note !~ '[[:cntrl:]]')),
  answer_hash    text not null check (answer_hash ~ '^[0-9a-f]{64}$'),    -- sha256 of the answer, computed by the server
  answer_excerpt text not null check (char_length(answer_excerpt) between 1 and 200 and answer_excerpt !~ '[[:cntrl:]]'),
  provenance     jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object' and octet_length(provenance::text) <= 1024),
  created_at     timestamptz not null default now(),
  unique (user_id, answer_hash)                              -- one rating per answer; a new rating replaces the old one
);
create index if not exists faye_feedback_user_idx on public.faye_feedback (user_id, created_at desc);

create table if not exists public.faye_corrections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  job_id          uuid,
  kind            text not null check (kind in ('answer', 'fact', 'voice', 'guardrail')),
  question_text   text not null check (char_length(question_text) between 8 and 500 and question_text = btrim(question_text) and question_text !~ '[[:cntrl:]]'),
  bad_excerpt     text check (bad_excerpt is null or (char_length(bad_excerpt) between 1 and 200 and bad_excerpt !~ '[[:cntrl:]]')),
  better_answer   text not null check (char_length(better_answer) between 5 and 1500 and better_answer = btrim(better_answer)
                                       and better_answer !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
  status          text not null default 'new' check (status in ('new', 'promoted_eval', 'promoted_note', 'rejected')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists faye_corrections_user_idx on public.faye_corrections (user_id, created_at desc);

create table if not exists public.faye_eval_items (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  split                text not null check (split in ('train', 'heldout')),
  suite                text not null check (suite in ('guardrail', 'domain', 'persona')),
  question             text not null check (char_length(question) between 8 and 500 and question = btrim(question) and question !~ '[[:cntrl:]]'),
  question_key         text not null,                       -- set by the trigger; the "same question" test across both sets
  required_keywords    text[] not null default '{}' check (public.faye_lab_keywords_ok(required_keywords)),
  source_correction_id uuid references public.faye_corrections (id) on delete set null,
  approved             boolean not null default true,       -- false = paused: the worker does not receive it
  used_in_corpus       boolean not null default false,
  created_at           timestamptz not null default now(),
  check (not (split = 'heldout' and used_in_corpus))        -- wall rule 3
);
-- wall rule 1: one question, one set.
create unique index if not exists faye_eval_items_key_idx on public.faye_eval_items (user_id, question_key);
create index if not exists faye_eval_items_user_idx on public.faye_eval_items (user_id, split, created_at desc);

create table if not exists public.faye_corpus_notes (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  title                text not null check (char_length(title) between 3 and 80 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  body                 text not null check (char_length(body) between 20 and 1500 and body = btrim(body)
                                            and body !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  from_correction_id   uuid references public.faye_corrections (id) on delete set null,
  from_eval_item_id    uuid references public.faye_eval_items (id) on delete set null,
  decided_at           timestamptz,
  created_at           timestamptz not null default now(),
  check (status = 'pending' or decided_at is not null)
);
create unique index if not exists faye_corpus_notes_dedupe_idx on public.faye_corpus_notes (user_id, md5(lower(body))) where status <> 'rejected';
create index if not exists faye_corpus_notes_user_idx on public.faye_corpus_notes (user_id, status, created_at desc);

-- Written by faye_report_eval_run (mailbox migration); the insert there names exactly these columns.
create table if not exists public.faye_eval_runs (
  id             uuid primary key default gen_random_uuid(),
  suite          text not null check (suite ~ '^[a-z_]{1,40}$'),
  started_at     timestamptz,
  finished_at    timestamptz,
  passed         integer not null check (passed >= 0),
  total          integer not null check (total >= 0 and total <= 100000),
  per_item       jsonb not null default '[]'::jsonb check (octet_length(per_item::text) <= 200000),
  constraint_sha text check (constraint_sha is null or char_length(constraint_sha) <= 64),
  persona_sha    text check (persona_sha is null or char_length(persona_sha) <= 64),
  model          text check (model is null or char_length(model) <= 80),
  worker_id      text check (worker_id is null or char_length(worker_id) <= 64),
  requested_by   uuid not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  check (passed <= total)
);
create index if not exists faye_eval_runs_user_idx on public.faye_eval_runs (requested_by, suite, created_at desc);

alter table public.faye_feedback    enable row level security;
alter table public.faye_corrections enable row level security;
alter table public.faye_eval_items  enable row level security;
alter table public.faye_corpus_notes enable row level security;
alter table public.faye_eval_runs   enable row level security;

revoke all on public.faye_feedback     from anon, authenticated;
revoke all on public.faye_corrections  from anon, authenticated;
revoke all on public.faye_eval_items   from anon, authenticated;
revoke all on public.faye_corpus_notes from anon, authenticated;
revoke all on public.faye_eval_runs    from anon, authenticated;

-- =====================================================================================================================
-- 3. WHO IS THE OWNER
-- =====================================================================================================================

create or replace function public.faye_lab_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and public.faye_user_role(auth.uid()) = 'owner' then auth.uid() end
$$;

create or replace function public.faye_lab_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.faye_lab_owner() is not null
$$;

-- =====================================================================================================================
-- 4. THE WALL AND THE OTHER TRIGGERS
-- =====================================================================================================================

-- Does this text (a note's title plus body, or an exam question) overlap an exam question of the same person, or share its source
-- correction? Used in both directions. p_exclude_item lets an update ignore the row being checked.
create or replace function public.faye_lab_wall_hit(p_user uuid, p_text text, p_correction uuid, p_item uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v boolean := false;
begin
  -- 1. the note comes from an exam question, or from the correction an exam question was made from
  if p_item is not null then
    select true into v from public.faye_eval_items i where i.id = p_item and i.user_id = p_user and i.split = 'heldout';
    if coalesce(v, false) then return true; end if;
  end if;
  if p_correction is not null then
    select true into v from public.faye_eval_items i where i.user_id = p_user and i.split = 'heldout' and i.source_correction_id = p_correction;
    if coalesce(v, false) then return true; end if;
  end if;
  -- 2. the text itself contains an exam question (or is a piece of one)
  if p_text is not null and char_length(btrim(p_text)) > 0 then
    select true into v from public.faye_eval_items i
     where i.user_id = p_user and i.split = 'heldout' and char_length(i.question) >= 12
       and (position(lower(i.question) in lower(p_text)) > 0
            or (char_length(btrim(p_text)) >= 12 and position(lower(btrim(p_text)) in lower(i.question)) > 0));
    if coalesce(v, false) then return true; end if;
  end if;
  return false;
end $$;

create or replace function public.faye_lab_eval_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    new.question := btrim(regexp_replace(coalesce(new.question, ''), '\s+', ' ', 'g'));
    new.question_key := public.faye_lab_question_key(new.question);
    if new.source_correction_id is not null then
      select c.user_id into v_owner from public.faye_corrections c where c.id = new.source_correction_id;
      if v_owner is distinct from new.user_id then
        raise exception 'faye_lab: correction belongs to someone else' using errcode = '23514';
      end if;
    end if;
    if new.split = 'heldout' then
      -- wall rule 5: something already taught this question (or its source correction)
      if exists (select 1 from public.faye_corpus_notes n
                  where n.user_id = new.user_id and n.status <> 'rejected'
                    and ((new.source_correction_id is not null and n.from_correction_id = new.source_correction_id)
                         or (char_length(new.question) >= 12
                             and position(lower(new.question) in lower(n.title || ' ' || n.body)) > 0))) then
        raise exception 'faye_lab: held_out_wall' using errcode = 'FL001';
      end if;
    end if;
    return new;
  end if;
  -- UPDATE: wall rule 2. Only approved and used_in_corpus may change (and the correction link may be cleared when the correction goes).
  if new.user_id is distinct from old.user_id
     or new.split is distinct from old.split
     or new.suite is distinct from old.suite
     or new.question is distinct from old.question
     or new.question_key is distinct from old.question_key
     or new.created_at is distinct from old.created_at
     or (new.source_correction_id is distinct from old.source_correction_id and new.source_correction_id is not null) then
    raise exception 'faye_lab: held_out_wall (an exam or practice question cannot be changed; delete it and add a new one)' using errcode = 'FL001';
  end if;
  return new;
end $$;

drop trigger if exists faye_lab_eval_items_guard_trg on public.faye_eval_items;
create trigger faye_lab_eval_items_guard_trg before insert or update on public.faye_eval_items
  for each row execute function public.faye_lab_eval_items_guard();

create or replace function public.faye_lab_notes_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if tg_op = 'INSERT' then
    new.title := btrim(regexp_replace(coalesce(new.title, ''), '\s+', ' ', 'g'));
    new.body := btrim(coalesce(new.body, ''));
    if new.status <> 'pending' then
      raise exception 'faye_lab: a note starts as pending' using errcode = '23514';
    end if;
    if new.from_correction_id is not null then
      select c.user_id into v_owner from public.faye_corrections c where c.id = new.from_correction_id;
      if v_owner is distinct from new.user_id then raise exception 'faye_lab: correction belongs to someone else' using errcode = '23514'; end if;
    end if;
    if new.from_eval_item_id is not null then
      select i.user_id into v_owner from public.faye_eval_items i where i.id = new.from_eval_item_id;
      if v_owner is distinct from new.user_id then raise exception 'faye_lab: item belongs to someone else' using errcode = '23514'; end if;
    end if;
    if public.faye_lab_wall_hit(new.user_id, new.title || ' ' || new.body, new.from_correction_id, new.from_eval_item_id) then
      raise exception 'faye_lab: held_out_wall' using errcode = 'FL001';
    end if;
    return new;
  end if;
  -- UPDATE: the text and the person never change; links may only be cleared (their row was deleted)
  if new.user_id is distinct from old.user_id or new.title is distinct from old.title or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at
     or (new.from_correction_id is distinct from old.from_correction_id and new.from_correction_id is not null)
     or (new.from_eval_item_id is distinct from old.from_eval_item_id and new.from_eval_item_id is not null) then
    raise exception 'faye_lab: a note cannot be edited' using errcode = '23514';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'faye_lab: already decided' using errcode = '23514';
  end if;
  if new.status = 'approved' and old.status is distinct from 'approved'
     and public.faye_lab_wall_hit(new.user_id, new.title || ' ' || new.body, new.from_correction_id, new.from_eval_item_id) then
    raise exception 'faye_lab: held_out_wall' using errcode = 'FL001';
  end if;
  return new;
end $$;

drop trigger if exists faye_lab_notes_guard_trg on public.faye_corpus_notes;
create trigger faye_lab_notes_guard_trg before insert or update on public.faye_corpus_notes
  for each row execute function public.faye_lab_notes_guard();

-- =====================================================================================================================
-- 5. BROWSER-SIDE FUNCTIONS (role authenticated; every one requires the OWNER)
-- =====================================================================================================================

create or replace function public.faye_lab_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.faye_lab_owner();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  return jsonb_build_object('ok', true, 'ready', true,
    'counts', jsonb_build_object(
      'feedback',          (select count(*) from public.faye_feedback where user_id = v_uid),
      'feedback_to_review', (select count(*) from public.faye_feedback where user_id = v_uid and rating <> 'good'),
      'corrections_new',   (select count(*) from public.faye_corrections where user_id = v_uid and status = 'new'),
      'train',             (select count(*) from public.faye_eval_items where user_id = v_uid and split = 'train'),
      'heldout',           (select count(*) from public.faye_eval_items where user_id = v_uid and split = 'heldout'),
      'notes_pending',     (select count(*) from public.faye_corpus_notes where user_id = v_uid and status = 'pending'),
      'runs',              (select count(*) from public.faye_eval_runs where requested_by = v_uid)),
    'server_time', now());
end $$;

-- One rating per answer: a second rating of the same answer replaces the first. The server computes the hash and the excerpt.
create or replace function public.faye_lab_submit_feedback(p_job_id uuid, p_rating text, p_note text, p_answer_hash text,
                                                           p_excerpt text, p_provenance jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.faye_feedback%rowtype;
  v_max integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_rating is null or p_rating not in ('good', 'wrong', 'too_long', 'off_voice') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_rating');
  end if;
  if p_answer_hash is null or p_answer_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_hash');
  end if;
  begin
    insert into public.faye_feedback (user_id, job_id, rating, note, answer_hash, answer_excerpt, provenance)
    values (v_uid, p_job_id, p_rating, v_note, p_answer_hash, btrim(coalesce(p_excerpt, '')), coalesce(p_provenance, '{}'::jsonb))
    on conflict (user_id, answer_hash) do update
      set rating = excluded.rating, note = excluded.note, job_id = coalesce(excluded.job_id, public.faye_feedback.job_id),
          provenance = excluded.provenance, created_at = now()
    returning * into v_row;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'rejected');
  end;
  -- keep the newest N
  v_max := public.faye_cfg('lab_max_feedback', 5000);
  delete from public.faye_feedback f where f.user_id = v_uid
     and f.id in (select x.id from public.faye_feedback x where x.user_id = v_uid order by x.created_at desc offset v_max);
  return jsonb_build_object('ok', true, 'id', v_row.id, 'rating', v_row.rating);
end $$;

create or replace function public.faye_lab_list_feedback(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_items jsonb;
  v_sum jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'job_id', f.job_id, 'rating', f.rating, 'note', f.note,
           'answer_excerpt', f.answer_excerpt, 'provenance', f.provenance, 'created_at', f.created_at) order by f.created_at desc), '[]'::jsonb)
    into v_items
    from (select * from public.faye_feedback x where x.user_id = v_uid order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 200))) f;
  select jsonb_build_object('good', count(*) filter (where rating = 'good'), 'wrong', count(*) filter (where rating = 'wrong'),
                            'too_long', count(*) filter (where rating = 'too_long'), 'off_voice', count(*) filter (where rating = 'off_voice'),
                            'total', count(*))
    into v_sum from public.faye_feedback where user_id = v_uid;
  return jsonb_build_object('ok', true, 'items', v_items, 'summary', v_sum);
end $$;

create or replace function public.faye_lab_save_correction(p_kind text, p_question text, p_bad_excerpt text, p_better text, p_job_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_row public.faye_corrections%rowtype;
  v_q text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_b text := nullif(btrim(coalesce(p_bad_excerpt, '')), '');
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_kind is null or p_kind not in ('answer', 'fact', 'voice', 'guardrail') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_kind');
  end if;
  if (select count(*) from public.faye_corrections where user_id = v_uid) >= public.faye_cfg('lab_max_corrections', 500) then
    return jsonb_build_object('ok', false, 'code', 'limit_reached');
  end if;
  begin
    insert into public.faye_corrections (user_id, job_id, kind, question_text, bad_excerpt, better_answer)
    values (v_uid, p_job_id, p_kind, v_q, v_b, btrim(coalesce(p_better, ''))) returning * into v_row;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'rejected');
  end;
  return jsonb_build_object('ok', true, 'id', v_row.id);
end $$;

create or replace function public.faye_lab_list_corrections(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_items jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'question', c.question_text, 'bad_excerpt', c.bad_excerpt,
           'better_answer', c.better_answer, 'status', c.status, 'created_at', c.created_at,
           'exam_made', exists (select 1 from public.faye_eval_items i where i.source_correction_id = c.id and i.split = 'heldout'),
           'practice_made', exists (select 1 from public.faye_eval_items i where i.source_correction_id = c.id and i.split = 'train'),
           'note_made', exists (select 1 from public.faye_corpus_notes n where n.from_correction_id = c.id and n.status <> 'rejected'))
         order by c.created_at desc), '[]'::jsonb)
    into v_items
    from (select * from public.faye_corrections x where x.user_id = v_uid order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 200))) c;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

create or replace function public.faye_lab_decide_correction(p_id uuid, p_decision text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  c public.faye_corrections%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_decision is null or p_decision not in ('dismiss', 'reopen') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_decision');
  end if;
  select * into c from public.faye_corrections where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if p_decision = 'dismiss' then
    if c.status <> 'new' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'already_used'); end if;
    update public.faye_corrections set status = 'rejected', updated_at = now() where id = c.id;
  else
    if c.status <> 'rejected' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'not_dismissed'); end if;
    update public.faye_corrections set status = 'new', updated_at = now() where id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'dismiss' then 'rejected' else 'new' end);
end $$;

-- "Save as practice question" (p_split 'train') or "Save as exam question" (p_split 'heldout').
create or replace function public.faye_lab_promote_correction(p_id uuid, p_split text, p_suite text, p_keywords text[] default '{}')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  c public.faye_corrections%rowtype;
  v_item public.faye_eval_items%rowtype;
  v_other text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_split is null or p_split not in ('train', 'heldout') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_split');
  end if;
  if p_suite is null or p_suite not in ('guardrail', 'domain', 'persona') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_suite');
  end if;
  if not public.faye_lab_keywords_ok(coalesce(p_keywords, '{}')) then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_keywords');
  end if;
  select * into c from public.faye_corrections where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if c.status = 'rejected' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'dismissed'); end if;
  if (select count(*) from public.faye_eval_items where user_id = v_uid) >= public.faye_cfg('lab_max_eval_items', 300) then
    return jsonb_build_object('ok', false, 'code', 'limit_reached');
  end if;
  begin
    insert into public.faye_eval_items (user_id, split, suite, question, required_keywords, source_correction_id)
    values (v_uid, p_split, p_suite, c.question_text, coalesce(p_keywords, '{}'), c.id) returning * into v_item;
  exception
    when sqlstate 'FL001' then
      return jsonb_build_object('ok', false, 'code', 'held_out_wall');
    when unique_violation then
      select i.split into v_other from public.faye_eval_items i
       where i.user_id = v_uid and i.question_key = public.faye_lab_question_key(c.question_text);
      return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', case when v_other = 'heldout' then 'already_heldout' else 'already_train' end);
    when check_violation then
      return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'rejected');
  end;
  update public.faye_corrections set status = 'promoted_eval', updated_at = now() where id = c.id and status = 'new';
  return jsonb_build_object('ok', true, 'id', v_item.id, 'split', v_item.split);
end $$;

create or replace function public.faye_lab_list_eval_items()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_items jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'split', i.split, 'suite', i.suite, 'question', i.question,
           'required_keywords', to_jsonb(i.required_keywords), 'approved', i.approved, 'used_in_corpus', i.used_in_corpus,
           'from_correction', i.source_correction_id is not null, 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    into v_items from (select * from public.faye_eval_items x where x.user_id = v_uid order by x.created_at desc limit 300) i;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- p_action: 'pause' (the worker stops receiving it), 'resume', 'delete'.
create or replace function public.faye_lab_update_eval_item(p_id uuid, p_action text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  i public.faye_eval_items%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_action is null or p_action not in ('pause', 'resume', 'delete') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_action');
  end if;
  select * into i from public.faye_eval_items where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if p_action = 'delete' then
    delete from public.faye_eval_items where id = i.id;
  else
    update public.faye_eval_items set approved = (p_action = 'resume') where id = i.id;
  end if;
  return jsonb_build_object('ok', true, 'action', p_action);
end $$;

-- A note PROPOSAL. Nothing is learned until the owner approves it, and approving only marks the row (the worker adds files by hand later).
create or replace function public.faye_lab_propose_note(p_correction_id uuid, p_eval_item_id uuid, p_title text, p_body text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_row public.faye_corpus_notes%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_correction_id is null and p_eval_item_id is null then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'no_source');
  end if;
  if p_correction_id is not null and not exists (select 1 from public.faye_corrections where id = p_correction_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_eval_item_id is not null and not exists (select 1 from public.faye_eval_items where id = p_eval_item_id and user_id = v_uid) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if (select count(*) from public.faye_corpus_notes where user_id = v_uid and status <> 'rejected') >= public.faye_cfg('lab_max_notes', 200) then
    return jsonb_build_object('ok', false, 'code', 'limit_reached');
  end if;
  begin
    insert into public.faye_corpus_notes (user_id, title, body, from_correction_id, from_eval_item_id)
    values (v_uid, btrim(coalesce(p_title, '')), btrim(coalesce(p_body, '')), p_correction_id, p_eval_item_id) returning * into v_row;
  exception
    when sqlstate 'FL001' then return jsonb_build_object('ok', false, 'code', 'held_out_wall');
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'duplicate');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'rejected');
  end;
  update public.faye_corrections set status = 'promoted_note', updated_at = now()
   where id = p_correction_id and user_id = v_uid and status = 'new';
  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
end $$;

create or replace function public.faye_lab_list_notes(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_items jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_status');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'status', n.status,
           'from_correction', n.from_correction_id is not null, 'from_practice', n.from_eval_item_id is not null,
           'decided_at', n.decided_at, 'created_at', n.created_at) order by n.created_at desc), '[]'::jsonb)
    into v_items from (select * from public.faye_corpus_notes x where x.user_id = v_uid and (p_status is null or x.status = p_status)
                       order by x.created_at desc limit 200) n;
  return jsonb_build_object('ok', true, 'items', v_items);
end $$;

-- p_decision 'approve' or 'reject'. Approve only marks the note approved (and the practice question it came from as used in the corpus).
create or replace function public.faye_lab_decide_note(p_id uuid, p_decision text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  n public.faye_corpus_notes%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_decision');
  end if;
  select * into n from public.faye_corpus_notes where id = p_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if n.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'already_decided'); end if;
  begin
    update public.faye_corpus_notes
       set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, decided_at = now()
     where id = n.id;
  exception when sqlstate 'FL001' then
    return jsonb_build_object('ok', false, 'code', 'held_out_wall');
  end;
  if p_decision = 'approve' and n.from_eval_item_id is not null then
    update public.faye_eval_items set used_in_corpus = true where id = n.from_eval_item_id and user_id = v_uid and split = 'train';
  end if;
  return jsonb_build_object('ok', true, 'status', case when p_decision = 'approve' then 'approved' else 'rejected' end);
end $$;

-- Runs (newest first) and the owner's eval jobs that are still waiting or running. Also trims runs past the keep limit.
create or replace function public.faye_lab_list_runs(p_suite text default null, p_limit integer default 50)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_lab_owner();
  v_runs jsonb;
  v_pending jsonb;
  v_max integer := public.faye_cfg('lab_max_runs', 200);
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_suite is not null and p_suite !~ '^[a-z_]{1,40}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_suite');
  end if;
  delete from public.faye_eval_runs r where r.requested_by = v_uid
     and r.id in (select x.id from public.faye_eval_runs x where x.requested_by = v_uid order by x.created_at desc offset v_max);
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'suite', r.suite, 'started_at', r.started_at, 'finished_at', r.finished_at,
           'passed', r.passed, 'total', r.total, 'constraint_sha', r.constraint_sha, 'persona_sha', r.persona_sha, 'model', r.model,
           'created_at', r.created_at) order by r.created_at desc), '[]'::jsonb)
    into v_runs
    from (select * from public.faye_eval_runs x where x.requested_by = v_uid and (p_suite is null or x.suite = p_suite)
          order by x.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))) r;
  select coalesce(jsonb_agg(jsonb_build_object('job_id', j.id, 'status', j.status, 'suite', j.request->>'suite', 'created_at', j.created_at)
                            order by j.created_at desc), '[]'::jsonb)
    into v_pending
    from public.faye_jobs j where j.user_id = v_uid and j.kind = 'eval' and j.status in ('queued', 'claimed', 'running');
  return jsonb_build_object('ok', true, 'runs', v_runs, 'pending', v_pending, 'server_time', now());
end $$;

-- =====================================================================================================================
-- 6. PRIVILEGES AND POLICIES
-- =====================================================================================================================

revoke all on function public.faye_lab_question_key(text)                                 from public, anon, authenticated;
revoke all on function public.faye_lab_keywords_ok(text[])                                from public, anon, authenticated;
revoke all on function public.faye_lab_owner()                                            from public, anon, authenticated;
revoke all on function public.faye_lab_wall_hit(uuid, text, uuid, uuid)                   from public, anon, authenticated;
revoke all on function public.faye_lab_eval_items_guard()                                 from public, anon, authenticated;
revoke all on function public.faye_lab_notes_guard()                                      from public, anon, authenticated;

revoke all on function public.faye_lab_is_owner()                                         from public, anon, authenticated;
revoke all on function public.faye_lab_overview()                                         from public, anon, authenticated;
revoke all on function public.faye_lab_submit_feedback(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.faye_lab_list_feedback(integer)                             from public, anon, authenticated;
revoke all on function public.faye_lab_save_correction(text, text, text, text, uuid)      from public, anon, authenticated;
revoke all on function public.faye_lab_list_corrections(integer)                          from public, anon, authenticated;
revoke all on function public.faye_lab_decide_correction(uuid, text)                      from public, anon, authenticated;
revoke all on function public.faye_lab_promote_correction(uuid, text, text, text[])       from public, anon, authenticated;
revoke all on function public.faye_lab_list_eval_items()                                  from public, anon, authenticated;
revoke all on function public.faye_lab_update_eval_item(uuid, text)                       from public, anon, authenticated;
revoke all on function public.faye_lab_propose_note(uuid, uuid, text, text)               from public, anon, authenticated;
revoke all on function public.faye_lab_list_notes(text)                                   from public, anon, authenticated;
revoke all on function public.faye_lab_decide_note(uuid, text)                            from public, anon, authenticated;
revoke all on function public.faye_lab_list_runs(text, integer)                           from public, anon, authenticated;

grant execute on function public.faye_lab_is_owner()                                      to authenticated;
grant execute on function public.faye_lab_overview()                                      to authenticated;
grant execute on function public.faye_lab_submit_feedback(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.faye_lab_list_feedback(integer)                          to authenticated;
grant execute on function public.faye_lab_save_correction(text, text, text, text, uuid)   to authenticated;
grant execute on function public.faye_lab_list_corrections(integer)                       to authenticated;
grant execute on function public.faye_lab_decide_correction(uuid, text)                   to authenticated;
grant execute on function public.faye_lab_promote_correction(uuid, text, text, text[])    to authenticated;
grant execute on function public.faye_lab_list_eval_items()                               to authenticated;
grant execute on function public.faye_lab_update_eval_item(uuid, text)                    to authenticated;
grant execute on function public.faye_lab_propose_note(uuid, uuid, text, text)            to authenticated;
grant execute on function public.faye_lab_list_notes(text)                                to authenticated;
grant execute on function public.faye_lab_decide_note(uuid, text)                         to authenticated;
grant execute on function public.faye_lab_list_runs(text, integer)                        to authenticated;

-- SELECT only, own rows, owner only.
grant select on public.faye_feedback, public.faye_corrections, public.faye_eval_items, public.faye_corpus_notes, public.faye_eval_runs to authenticated;

drop policy if exists faye_feedback_select_own on public.faye_feedback;
create policy faye_feedback_select_own on public.faye_feedback
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_lab_is_owner()));
drop policy if exists faye_corrections_select_own on public.faye_corrections;
create policy faye_corrections_select_own on public.faye_corrections
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_lab_is_owner()));
drop policy if exists faye_eval_items_select_own on public.faye_eval_items;
create policy faye_eval_items_select_own on public.faye_eval_items
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_lab_is_owner()));
drop policy if exists faye_corpus_notes_select_own on public.faye_corpus_notes;
create policy faye_corpus_notes_select_own on public.faye_corpus_notes
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_lab_is_owner()));
drop policy if exists faye_eval_runs_select_own on public.faye_eval_runs;
create policy faye_eval_runs_select_own on public.faye_eval_runs
  for select to authenticated using (requested_by = (select auth.uid()) and (select public.faye_lab_is_owner()));
