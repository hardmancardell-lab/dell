-- Faye "memory": the owner's approved notes, the settings that pause learning, a content-free audit trail and a counts-only
-- usage table.   *** DRAFT, NOT RUN. Review first. ***
--
-- Design:   Dellegate/team_audits/2026-10-19/faye-personal-design.md  (section 3, 5.2, 7.2 row F, 7.3 T1 T3 T9)
-- Contract: FAYE_MAILBOX_CONTRACT.md (repo root) section 6 (memory_pack v1) and section 9 (columns the mailbox functions expect).
-- Package:  WP-F (memory backend). Run order for the Faye migrations: 11-faye_mailbox.sql FIRST, then this file, then the lab file.
--
-- What this file creates (additive; nothing existing is altered or dropped; re-running is safe):
--   Tables     faye_memory_items     the notes (only status 'approved' is ever used in a prompt)
--              faye_memory_settings  one row per person: learning_paused, show_used_notes
--              faye_memory_events    audit trail: WHAT happened and WHEN, never the text of a note
--              faye_usage_stats      per-day COUNTS (topics, tickers, hours): numbers only, never question text
--   Browser    faye_memory_is_owner, faye_memory_list, faye_memory_add, faye_memory_edit, faye_memory_decide, faye_memory_delete,
--              faye_memory_restore, faye_memory_delete_all, faye_memory_update_settings, faye_memory_export,
--              faye_memory_candidates, faye_memory_touch, faye_usage_bump, faye_usage_recent, faye_memory_note_dropped, faye_memory_note_erased
--              -> role authenticated only (each one re-checks that the caller is the OWNER)
--   Internal   faye_memory_owner, faye_memory_text_problem, faye_luhn_ok, faye_stats_counts_ok, faye_jsonb_add, faye_memory_purge,
--              faye_memory_supersede, faye_memory_log, faye_memory_item_json, and the trigger functions (no grants at all)
--
-- Security model in one paragraph:
--   * RLS is ON for every table. Role anon has NO privileges. Role authenticated has SELECT only, on its own rows, and only while
--     the caller is the owner (faye_memory_is_owner()). Soft-deleted notes are invisible to that select.
--   * Every write goes through a SECURITY DEFINER function with search_path = '' that takes the person from auth.uid() (never from
--     an argument) and requires role 'owner' in faye_access. So user B cannot read, change or delete user A's rows, by any route.
--   * Defense in depth at WRITE time: a trigger on faye_memory_items screens every note (insert, and edit of the text) with
--     faye_memory_text_problem(): secrets, keys, tokens, long random strings, card and account numbers, SSN-like numbers, exact
--     amounts and share counts, emails, phone numbers, URLs, street addresses, sensitive health and legal topics, markup, hidden
--     characters, and anything that looks like an instruction to Faye (ignore the rules, no disclaimers, tell me what to buy ...).
--     A flagged note is REFUSED, never masked. The worker path (faye_submit_memory_proposals in the mailbox migration) inserts into
--     this table too, so it gets the same trigger. The application code applies the same list first (src/lib/faye/memory/redact.ts).
--   * Held-out exam text must never become a memory note: when the lab table faye_eval_items exists, a note that contains (or is
--     contained in) one of the owner's held-out questions is refused.
--   * The audit trail records actions and counts only. Deleting a note removes its text everywhere; only the fact that something was
--     deleted remains in faye_memory_events (kept 365 days, then removed).
--   * Soft delete with a short undo window: delete sets deleted_at (the note vanishes from every read at once) and the row is
--     purged for good after 'memory_undo_minutes' (default 10) the next time any memory function runs. "Delete permanently",
--     "delete all" and faye_erase_me remove rows immediately.
--
-- Run once in the Supabase SQL editor. To undo: 2026-10-20_faye_memory_down.sql.
--
-- NOT verified against the real project (see the report): behaviour of normalize() and the \U000E0000 regex escape on the
-- project's Postgres build (verified on PGlite = PostgreSQL 16 only), and the lab table's real column names.

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
  ('memory_max_items',             300, 'live notes one person may hold (proposals, approved, rejected and retired all count)'),
  ('memory_undo_minutes',          10,  'minutes a deleted note stays recoverable before it is purged for good'),
  ('memory_proposal_expiry_days',  180, 'a proposal nobody approved is removed after this many days'),
  ('memory_events_retention_days', 365, 'audit events older than this are removed'),
  ('memory_stats_retention_days',  90,  'usage-count rows older than this are removed')
on conflict (key) do nothing;

-- =====================================================================================================================
-- 1. PURE HELPERS (no table access, no grants)
-- =====================================================================================================================

-- Luhn check for 13 to 19 digit strings (card numbers).
create or replace function public.faye_luhn_ok(p text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  n integer := coalesce(length(p), 0);
  i integer;
  d integer;
  s integer := 0;
  alt boolean := false;
begin
  if n < 13 or n > 19 or p !~ '^[0-9]+$' then return false; end if;
  for i in reverse n..1 loop
    d := substr(p, i, 1)::integer;
    if alt then
      d := d * 2;
      if d > 9 then d := d - 9; end if;
    end if;
    s := s + d;
    alt := not alt;
  end loop;
  return s % 10 = 0;
end $$;

-- A counts object: only whitelisted keys, only whole numbers, bounded size. This is what keeps faye_usage_stats "numbers only".
create or replace function public.faye_stats_counts_ok(p jsonb, p_key_re text, p_max_keys integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  r record;
  n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  for r in select key, value from jsonb_each(p) loop
    n := n + 1;
    if n > p_max_keys then return false; end if;
    if r.key !~ p_key_re then return false; end if;
    if jsonb_typeof(r.value) <> 'number' or (r.value)::text !~ '^[0-9]{1,6}$' then return false; end if;
  end loop;
  return true;
end $$;

-- Adds two counts objects key by key.
create or replace function public.faye_jsonb_add(a jsonb, b jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
    from (
      select u.key as k, sum((u.value)::text::bigint) as v
        from (
          select key, value from jsonb_each(coalesce(a, '{}'::jsonb))
          union all
          select key, value from jsonb_each(coalesce(b, '{}'::jsonb))
        ) u
       group by u.key
    ) s
$$;

-- The text screen. Returns NULL when the text is acceptable, otherwise a short reason code. The same list, in the same order,
-- lives in src/lib/faye/memory/redact.ts; scripts/fixtures/faye-memory-vectors.json is run through both.
create or replace function public.faye_memory_text_problem(p_text text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  t   text;   -- lower-case, NFKC, look-alike letters folded
  u   text;   -- t with @ $ ! read as a s i
  s   text;   -- letters and digits only
  l   text;   -- s with common digit-for-letter swaps undone
  m   text[];
  g   text;
  dg  text;
begin
  if p_text is null or btrim(p_text) = '' then return 'empty'; end if;
  if p_text ~ '[[:cntrl:]]'
     or p_text ~ '[\u00AD\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]'
     or p_text ~ '[\U000E0000-\U000E007F]' then
    return 'control';
  end if;
  if p_text ~ '[<>`{}|\\]' then return 'markup'; end if;

  t := lower(normalize(p_text, NFKC));
  -- fold look-alike letters (Cyrillic and Greek)
  t := translate(t, 'аеорсухіјѕһԁӏνοραεικτυχ', 'aeopcyxijshdlvopaeiktux');
  -- u: also undo @ $ ! swaps (p@ssw0rd); s: letters and digits only; l: s with digit-for-letter swaps undone
  u := translate(t, '@$!', 'asi');
  s := regexp_replace(u, '[^a-z0-9]+', '', 'g');
  l := translate(s, '013457', 'oieast');

  -- 1. things that try to change Faye's rules
  if u ~ '\y(ignore|disregard|forget|override|bypass|skip|discard|overrule|circumvent)\y.{0,40}\y(previous|prior|above|earlier|former|preceding|all|any|your|the|these|those|system|safety)\y.{0,40}\y(rules?|instructions?|prompts?|guidelines?|constraints?|guardrails?|policies|policy|restrictions?|directives?|limits?|training|safeguards?)\y'
     or u ~ '\y(system|developer|hidden|initial)\s+(prompt|message|instructions?)\y'
     or u ~ '\yyou\s+(are|will\s+be|shall\s+be)\s+now\y'
     or u ~ '\y(from\s+now\s+on|henceforth|going\s+forward)\y.{0,40}\yyou\y'
     or u ~ '\y(pretend|act|behave|roleplay|role-play|imagine)\y.{0,30}\y(as|to\s+be|you\s+are|like)\y.{0,30}\y(advis[eo]r|broker|analyst|fiduciary|planner|unrestricted|dan|jailbroken)\y'
     or u ~ '\y(always|must|should|may\s+now|are\s+allowed\s+to|are\s+permitted\s+to|will)\y.{0,30}\y(give|giving|offer|provide|say|tell|recommend|suggest|advise)\y.{0,40}\y(advice|buy\w*|sell\w*|hold\w*|trade\w*|what\s+to|which)\y'
     or u ~ '\y(tell|say|give|recommend|suggest|advise|pick|choose)\y.{0,30}\y(what|which)\y.{0,25}\y(buy|sell|hold|trade|invest)\y'
     or u ~ '\ywants?\s+(faye|you|her|it|the\s+assistant)\s+to\s+(just\s+)?(say|tell|recommend|give|pick|choose|decide)\y'
     or u ~ '\ydisclaim\w*'
     or u ~ '\y(no|without|skip|stop|drop|remove|disable|turn\s+off|omit|hide|ignore)\y.{0,25}\y(warnings?|caveats?|educational|guardrails?|filters?|safety|refus\w*|declin\w*)\y'
     or u ~ '\ynot\s+(financial\s+)?advice\y'
     or u ~ '\yguard\s?rails?\y'
     or u ~ '\y(jailbreak|dan\s+mode|developer\s+mode|do\s+anything\s+now|unrestricted|no\s+restrictions|without\s+restrictions|no\s+limits|without\s+limits|sudo|admin\s+mode|god\s+mode)\y'
     or u ~ '\y(system|assistant|user|human|developer)\s*:'
     or u ~ '###'
     or u ~ '\[/?inst\]'
     or u ~ '\y(buy|sell)\y\s+(now|this|that|it|immediately|more|all|everything)\y'
     or u ~ '\yyou\s+(should|must|shall|need\s+to|have\s+to|are\s+to|will|can|may)\y'
     or s ~ '(ignore|disregard|forget|override)(previous|prior|all|the|your|above|any)+(rules|instructions|prompts?|guidelines|constraints)'
     or l ~ '(ignore|disregard|forget|override)(previous|prior|all|the|your|above|any)+(rules|instructions|prompts?|guidelines|constraints)'
     or s ~ '(systemprompt|youarenow|jailbreak|disclaimer|doanythingnow|developermode)'
     or l ~ '(systemprompt|youarenow|jailbreak|disclaimer|doanythingnow|developermode)' then
    return 'instruction';
  end if;

  -- 2. secrets, keys, tokens, passwords
  if t ~ '\y(sk|pk|rk)[-_][a-z0-9_-]{8,}'
     or t ~ '\y(ghp|gho|ghu|ghs|ghr)_[a-z0-9]{20,}'
     or t ~ 'github_pat_|\yxox[baprs]-|\yakia[0-9a-z]{12,}|\yaiza[0-9a-z_-]{20,}|\ysbp_|\ysb_secret|\yfwt_[0-9a-f]{16,}'
     or t ~ 'eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{4,}'
     or t ~ '-----begin'
     or t ~ '\ybearer\s+[a-z0-9._~+/-]{8,}' then
    return 'secret';
  end if;
  for m in select regexp_matches(p_text, '[A-Za-z0-9+/=_-]{24,}', 'g') loop
    g := m[1];
    if g ~ '[0-9]' or (g ~ '[A-Z]' and g ~ '[a-z]') or g ~ '[+/=_]' or (length(g) >= 32 and g !~ '-') then
      return 'secret';
    end if;
  end loop;
  if u ~ '\y(password|passwd|passcode|passphrase|api\s?key|apikey|secret\s?key|private\s?key|access\s?key|seed\s?phrase|recovery\s?phrase|mnemonic|credentials?|2fa|otp|bearer)\y'
     or u ~ '\y(secret|token|pin|code)\s*(is|=|:)\s*\S{4,}'
     or u ~ '\y(api|auth|access|secret)[-_ ]?token\y' then
    return 'credential';
  end if;

  -- 3. card, account, SSN and other long numbers
  if t ~ '\y(ssn|social\s+security|tax\s+id|taxpayer\s+id|itin|passport|driver.?s?\s+licen[sc]e)\y'
     or t ~ '\y[0-9]{3}[ -][0-9]{2}[ -][0-9]{4}\y' then
    return 'ssn';
  end if;
  for m in select regexp_matches(t, '[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}|[0-9]{4}[ -][0-9]{6}[ -][0-9]{4,5}|[0-9]{13,19}', 'g') loop
    dg := regexp_replace(m[1], '[^0-9]', '', 'g');
    if public.faye_luhn_ok(dg) then return 'card'; end if;
  end loop;
  if t ~ '[0-9]{4}[ -][0-9]{4}[ -][0-9]{4}[ -][0-9]{1,7}' or t ~ '[0-9]{4}[ -][0-9]{6}[ -][0-9]{4,5}' or t ~ '[0-9]{9,}' then
    return 'account';
  end if;
  if t ~ '\y(account|acct|routing|iban|swift|aba|sort\s+code)\y[^.]{0,30}[0-9]{4,}'
     or t ~ '\y[a-z]{2}[0-9]{2}[a-z0-9]{11,30}\y' then
    return 'account';
  end if;

  -- 4. contact details and places
  if t ~ '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}'
     or t ~ '(https?:|www\.)'
     or t ~ '\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}'
     or t ~ '\y\+[0-9]{1,3}[ .-]?[0-9]'
  then
    return 'contact';
  end if;
  if t ~ '\y[0-9]{1,6}\s+([a-z0-9.]+\s+){1,4}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|highway|hwy|parkway|pkwy)\y'
     or t ~ '\yp\.?\s?o\.?\s+box\y' then
    return 'address';
  end if;

  -- 5. exact money and position sizes
  if t ~ '[$€£¥]\s?[0-9]'
     or t ~ '[0-9][0-9,.]*\s?(k|m|mm|bn|b)?\s?(usd|dollars?|bucks|eur|euros?|gbp|pounds?|yen)\y'
     or t ~ '\y(net\s+worth|account\s+balance|my\s+balance|balance\s+of|salary|my\s+income|income\s+of|i\s+earn)\y'
     or t ~ '\yportfolio\s+(is|was|worth|value)\y' then
    return 'money';
  end if;
  if t ~ '\y[0-9][0-9,]*\s*(shares?|contracts?|lots?|units?|coins?|tokens?)\y'
     or t ~ '\y(shares?|position\s+size)\s*(of|:|=)?\s*[0-9]' then
    return 'position';
  end if;

  -- 6. sensitive categories
  if t ~ '\y(diagnos\w*|cancer|diabet\w*|depress\w*|anxiety|medicat\w*|prescri\w+|therap\w+|pregnan\w*|hiv|disabilit\w*|lawsuit|sued|divorce|custody|arrest\w*|convict\w*|felony|bankruptcy|immigration|religio\w*|sexual\s+orientation|political\s+(party|affiliation)|surgery|mental\s+health|illness|disease)\y' then
    return 'sensitive_topic';
  end if;

  return null;
end $$;

-- =====================================================================================================================
-- 2. TABLES
-- =====================================================================================================================

create table if not exists public.faye_memory_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  category         text not null check (category in ('style', 'preference', 'habit', 'tendency', 'goal', 'context', 'avoid')),
  slot             text check (slot is null or slot ~ '^[a-z_]{1,40}$'),     -- same slot = the newer approved note replaces the older
  fact             text not null check (char_length(fact) between 3 and 200 and fact = btrim(fact) and fact !~ '[[:cntrl:]]'),
  source           text not null check (source in ('stated', 'taught', 'observed', 'proposed_by_model')),
  source_ref       text check (source_ref is null or (char_length(source_ref) <= 120 and source_ref ~ '^[A-Za-z0-9_:./=,-]*$')),   -- an id or a counter, never raw text
  confidence       smallint not null default 30 check (confidence between 0 and 100),
  evidence_count   integer not null default 1 check (evidence_count between 1 and 100000),
  status           text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'retired')),
  approved_by      text check (approved_by is null or approved_by = 'owner'),
  sensitivity      text not null default 'normal' check (sensitivity in ('low', 'normal')),   -- 'high' is never stored
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  approved_at      timestamptz,
  last_used_at     timestamptz,
  last_observed_at timestamptz not null default now(),
  use_count        integer not null default 0 check (use_count >= 0),
  expires_at       timestamptz,                  -- proposals only: removed if nobody approves them
  supersedes       uuid references public.faye_memory_items (id) on delete set null,
  usefulness       smallint not null default 0 check (usefulness between -100 and 100),
  deleted_at       timestamptz,                  -- soft delete (undo window), then purged
  check (status <> 'approved' or approved_at is not null)
);
-- dedupe (contract section 9). Partial so that a note in the undo window does not block adding the same words again.
create unique index if not exists faye_memory_items_dedupe_idx on public.faye_memory_items (user_id, md5(lower(fact))) where deleted_at is null;
create index if not exists faye_memory_items_user_status_idx on public.faye_memory_items (user_id, status) where deleted_at is null;
create index if not exists faye_memory_items_slot_idx        on public.faye_memory_items (user_id, slot) where deleted_at is null and slot is not null;
create index if not exists faye_memory_items_deleted_idx     on public.faye_memory_items (deleted_at) where deleted_at is not null;

create table if not exists public.faye_memory_settings (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  learning_paused boolean not null default false,
  show_used_notes boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- Audit: what happened and when. Deliberately no text column and no free-form column.
create table if not exists public.faye_memory_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  item_id         uuid,           -- no foreign key: the row stays meaningful after the note itself is gone
  related_item_id uuid,           -- for 'superseded': the note that replaced item_id
  action          text not null check (action in ('created', 'proposed', 'approved', 'rejected', 'retired', 'revived', 'edited',
                    'deleted', 'restored', 'purged', 'superseded', 'dropped', 'faded', 'exported', 'paused', 'resumed',
                    'deleted_all', 'erased_all')),
  source          text check (source is null or source in ('stated', 'taught', 'observed', 'proposed_by_model')),
  count           integer check (count is null or count between 0 and 1000000),
  at              timestamptz not null default now()
);
create index if not exists faye_memory_events_user_idx on public.faye_memory_events (user_id, at desc);

-- Counts only. A note about "asks about options a lot" is proposed from these numbers; the question text itself is never stored.
create table if not exists public.faye_usage_stats (
  user_id       uuid not null references auth.users (id) on delete cascade,
  day           date not null,
  topic_counts  jsonb not null default '{}'::jsonb check (public.faye_stats_counts_ok(topic_counts,  '^[a-z_]{1,24}$', 24)),
  ticker_counts jsonb not null default '{}'::jsonb check (public.faye_stats_counts_ok(ticker_counts, '^[A-Z]{1,5}$', 40)),
  hour_hist     jsonb not null default '{}'::jsonb check (public.faye_stats_counts_ok(hour_hist,     '^([0-9]|1[0-9]|2[0-3])$', 24)),
  questions     integer not null default 0 check (questions between 0 and 100000),
  updated_at    timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.faye_memory_items    enable row level security;
alter table public.faye_memory_settings enable row level security;
alter table public.faye_memory_events   enable row level security;
alter table public.faye_usage_stats     enable row level security;

revoke all on public.faye_memory_items    from anon, authenticated;
revoke all on public.faye_memory_settings from anon, authenticated;
revoke all on public.faye_memory_events   from anon, authenticated;
revoke all on public.faye_usage_stats     from anon, authenticated;

-- =====================================================================================================================
-- 3. WHO IS THE OWNER (used by every function and policy below)
-- =====================================================================================================================

-- Internal: the caller's user id when (and only when) they are the owner, else null.
create or replace function public.faye_memory_owner()
returns uuid language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null and public.faye_user_role(auth.uid()) = 'owner' then auth.uid() end
$$;

-- For RLS policies: the caller may read memory only if they are the owner. Safe for any signed-in user (it reveals only their own status).
create or replace function public.faye_memory_is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.faye_memory_owner() is not null
$$;

-- =====================================================================================================================
-- 4. TRIGGERS: the last line of defense at write time
-- =====================================================================================================================

create or replace function public.faye_memory_items_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_problem text;
  v_max     integer;
  v_n       integer;
  v_hit     boolean := false;
begin
  if tg_op = 'INSERT' then
    new.fact := btrim(regexp_replace(coalesce(new.fact, ''), '\s+', ' ', 'g'));
  elsif new.fact is distinct from old.fact then
    new.fact := btrim(regexp_replace(coalesce(new.fact, ''), '\s+', ' ', 'g'));
  end if;

  if tg_op = 'INSERT' or new.fact is distinct from old.fact then
    v_problem := public.faye_memory_text_problem(new.fact);
    if v_problem is not null then
      raise exception 'faye_memory: text rejected (%)', v_problem using errcode = '23514';
    end if;
    -- held-out exam text must never become a note (the lab tables belong to another package; skip quietly if their shape differs)
    if to_regclass('public.faye_eval_items') is not null then
      begin
        execute 'select exists (select 1 from public.faye_eval_items e where e.user_id = $1 and e.split = ''heldout'' '
                'and char_length(e.question) >= 12 and (position(lower(e.question) in lower($2)) > 0 '
                'or (char_length($2) >= 12 and position(lower($2) in lower(e.question)) > 0)))'
          into v_hit using new.user_id, new.fact;
      exception when undefined_column or undefined_table then
        v_hit := false;
      end;
      if v_hit then
        raise exception 'faye_memory: text rejected (heldout)' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.source = 'proposed_by_model' then
    new.confidence := least(new.confidence, 50);
    if tg_op = 'INSERT' and new.status <> 'proposed' then
      raise exception 'faye_memory: a model proposal must start as proposed' using errcode = '23514';
    end if;
  elsif new.source = 'observed' then
    new.confidence := least(new.confidence, 70);
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_at := coalesce(new.approved_at, now());
    new.expires_at := null;
  end if;
  if new.status = 'proposed' and new.expires_at is null then
    new.expires_at := now() + make_interval(days => public.faye_cfg('memory_proposal_expiry_days', 180));
  end if;

  if tg_op = 'INSERT' and new.deleted_at is null then
    v_max := public.faye_cfg('memory_max_items', 300);
    select count(*) into v_n from public.faye_memory_items where user_id = new.user_id and deleted_at is null;
    if v_n >= v_max then
      raise exception 'faye_memory: limit reached' using errcode = '54000';
    end if;
  end if;

  -- recency is about the note's content; counters such as last_used_at must not make an old note look new
  if tg_op = 'INSERT' then
    new.updated_at := now();
  elsif (new.fact, new.category, new.slot, new.status, new.deleted_at) is distinct from (old.fact, old.category, old.slot, old.status, old.deleted_at) then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists faye_memory_items_guard_trg on public.faye_memory_items;
create trigger faye_memory_items_guard_trg
  before insert or update on public.faye_memory_items
  for each row execute function public.faye_memory_items_guard();

-- Every insert is logged by the database itself, so the worker's proposal path cannot skip the audit trail.
create or replace function public.faye_memory_items_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.faye_memory_events (user_id, item_id, action, source)
  values (new.user_id, new.id, case when new.status = 'approved' then 'created' else 'proposed' end, new.source);
  return null;
end $$;

drop trigger if exists faye_memory_items_audit_trg on public.faye_memory_items;
create trigger faye_memory_items_audit_trg
  after insert on public.faye_memory_items
  for each row execute function public.faye_memory_items_audit();

-- =====================================================================================================================
-- 5. INTERNAL FUNCTIONS (no grants)
-- =====================================================================================================================

create or replace function public.faye_memory_log(p_uid uuid, p_action text, p_item uuid default null, p_related uuid default null,
                                                 p_count integer default null, p_source text default null)
returns void language sql volatile security definer set search_path = '' as $$
  insert into public.faye_memory_events (user_id, item_id, related_item_id, action, count, source)
  values (p_uid, p_item, p_related, p_action, p_count, p_source)
$$;

create or replace function public.faye_memory_item_json(i public.faye_memory_items)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'category', i.category, 'slot', i.slot, 'fact', i.fact, 'source', i.source, 'source_ref', i.source_ref,
    'confidence', i.confidence, 'evidence_count', i.evidence_count, 'status', i.status, 'approved_by', i.approved_by,
    'sensitivity', i.sensitivity, 'created_at', i.created_at, 'updated_at', i.updated_at, 'approved_at', i.approved_at,
    'last_used_at', i.last_used_at, 'last_observed_at', i.last_observed_at, 'use_count', i.use_count,
    'expires_at', i.expires_at, 'supersedes', i.supersedes, 'usefulness', i.usefulness, 'deleted_at', i.deleted_at)
$$;

-- Housekeeping for one person, run opportunistically by every memory function (no pg_cron needed):
-- purge notes past the undo window, drop stale proposals, fade old observed notes, trim old audit and stats rows.
create or replace function public.faye_memory_purge(p_uid uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.faye_memory_items
   where user_id = p_uid and deleted_at is not null
     and deleted_at < now() - make_interval(mins => public.faye_cfg('memory_undo_minutes', 10));
  get diagnostics v_n = row_count;
  if v_n > 0 then perform public.faye_memory_log(p_uid, 'purged', null, null, v_n); end if;

  delete from public.faye_memory_items
   where user_id = p_uid and deleted_at is null and status = 'proposed' and expires_at is not null and expires_at < now();

  -- decay: an observed or model-proposed note loses half its confidence every 90 days without being seen again;
  -- below 25 it is retired (the owner can revive it from "Faded"). Stated and taught notes never decay.
  with faded as (
    update public.faye_memory_items
       set status = 'retired'
     where user_id = p_uid and deleted_at is null and status = 'approved' and source in ('observed', 'proposed_by_model')
       and confidence * power(0.5, extract(epoch from (now() - last_observed_at)) / 86400.0 / 90.0) < 25
    returning 1)
  select count(*) into v_n from faded;
  if v_n > 0 then perform public.faye_memory_log(p_uid, 'faded', null, null, v_n); end if;

  delete from public.faye_memory_events
   where user_id = p_uid and at < now() - make_interval(days => public.faye_cfg('memory_events_retention_days', 365));
  delete from public.faye_usage_stats
   where user_id = p_uid and day < current_date - public.faye_cfg('memory_stats_retention_days', 90);
end $$;

-- A newly approved note with a slot retires the older approved note in the same slot. The old note stays (retired) and is
-- linked through supersedes; the audit trail records the pair of ids and no text.
create or replace function public.faye_memory_supersede(p_uid uuid, p_new uuid, p_slot text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
  v_first uuid;
begin
  if p_slot is null then return null; end if;
  for r in
    update public.faye_memory_items
       set status = 'retired'
     where user_id = p_uid and slot = p_slot and status = 'approved' and deleted_at is null and id <> p_new
    returning id
  loop
    perform public.faye_memory_log(p_uid, 'superseded', r.id, p_new);
    if v_first is null then v_first := r.id; end if;
  end loop;
  if v_first is not null then
    update public.faye_memory_items set supersedes = v_first where id = p_new;
  end if;
  return v_first;
end $$;

-- =====================================================================================================================
-- 6. BROWSER-SIDE FUNCTIONS (role authenticated; every one requires the OWNER)
-- =====================================================================================================================

create or replace function public.faye_memory_list(p_include_deleted boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_items jsonb;
  v_set jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select coalesce(jsonb_agg(public.faye_memory_item_json(i) order by i.created_at desc), '[]'::jsonb) into v_items
    from (select * from public.faye_memory_items x
           where x.user_id = v_uid and (p_include_deleted or x.deleted_at is null)
           order by x.created_at desc limit 500) i;
  select jsonb_build_object('learning_paused', s.learning_paused, 'show_used_notes', s.show_used_notes) into v_set
    from public.faye_memory_settings s where s.user_id = v_uid;
  return jsonb_build_object('ok', true, 'items', v_items,
    'settings', coalesce(v_set, jsonb_build_object('learning_paused', false, 'show_used_notes', true)),
    'server_time', now());
end $$;

-- Adds a note. p_source: 'stated' or 'taught' (the owner wrote it; may be added already approved) or 'observed' (counted from
-- usage; always starts as a proposal). Model proposals do NOT come through here (the worker uses faye_submit_memory_proposals).
create or replace function public.faye_memory_add(p_category text, p_slot text, p_fact text, p_source text,
                                                  p_source_ref text default null, p_confidence integer default null,
                                                  p_status text default 'proposed')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := public.faye_memory_owner();
  v_fact    text;
  v_problem text;
  v_paused  boolean := false;
  v_conf    integer;
  v_row     public.faye_memory_items%rowtype;
  v_new     public.faye_memory_items%rowtype;
  v_old     uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  if p_source is null or p_source not in ('stated', 'taught', 'observed') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_source');
  end if;
  if p_status is null or p_status not in ('proposed', 'approved') or (p_source = 'observed' and p_status <> 'proposed') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_status');
  end if;
  if p_category is null or p_category not in ('style', 'preference', 'habit', 'tendency', 'goal', 'context', 'avoid') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_category');
  end if;
  if p_slot is not null and p_slot !~ '^[a-z_]{1,40}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_slot');
  end if;
  if p_source_ref is not null and (char_length(p_source_ref) > 120 or p_source_ref !~ '^[A-Za-z0-9_:./=,-]*$') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_source_ref');
  end if;

  -- learning (observed counts and pattern proposals) stops the moment it is paused; the owner's own "remember" does not
  if p_source = 'observed' or p_status = 'proposed' then
    select s.learning_paused into v_paused from public.faye_memory_settings s where s.user_id = v_uid;
    if coalesce(v_paused, false) then return jsonb_build_object('ok', false, 'code', 'paused'); end if;
  end if;

  v_fact := btrim(regexp_replace(coalesce(p_fact, ''), '\s+', ' ', 'g'));
  v_problem := public.faye_memory_text_problem(v_fact);
  if v_problem is null and char_length(v_fact) not between 3 and 200 then v_problem := 'length'; end if;
  if v_problem is not null then
    perform public.faye_memory_log(v_uid, 'dropped', null, null, 1, p_source);
    return jsonb_build_object('ok', false, 'code', 'text_rejected', 'detail', v_problem);
  end if;

  -- same words already stored (live): count it as seen again, or approve it if the owner now states it outright
  select * into v_row from public.faye_memory_items
   where user_id = v_uid and deleted_at is null and md5(lower(fact)) = md5(lower(v_fact));
  if found then
    if p_status = 'approved' and v_row.status <> 'approved' then
      update public.faye_memory_items
         set status = 'approved', approved_by = 'owner', approved_at = now(), last_observed_at = now(), expires_at = null
       where id = v_row.id returning * into v_new;
      perform public.faye_memory_log(v_uid, case when v_row.status = 'retired' then 'revived' else 'approved' end, v_new.id);
      v_old := public.faye_memory_supersede(v_uid, v_new.id, v_new.slot);
      select * into v_new from public.faye_memory_items where id = v_row.id;
      return jsonb_build_object('ok', true, 'id', v_new.id, 'duplicate', true, 'superseded', v_old, 'item', public.faye_memory_item_json(v_new));
    end if;
    update public.faye_memory_items
       set evidence_count = least(evidence_count + 1, 100000), last_observed_at = now()
     where id = v_row.id returning * into v_new;
    return jsonb_build_object('ok', true, 'id', v_new.id, 'duplicate', true, 'item', public.faye_memory_item_json(v_new));
  end if;

  -- a pending proposal for the same slot and source is refreshed instead of piling up a second one
  if p_status = 'proposed' and p_slot is not null then
    select * into v_row from public.faye_memory_items
     where user_id = v_uid and deleted_at is null and slot = p_slot and status = 'proposed' and source = p_source limit 1;
    if found then
      update public.faye_memory_items
         set fact = v_fact, source_ref = p_source_ref, evidence_count = least(evidence_count + 1, 100000), last_observed_at = now(),
             confidence = least(coalesce(p_confidence, confidence), 100)
       where id = v_row.id returning * into v_new;
      return jsonb_build_object('ok', true, 'id', v_new.id, 'duplicate', false, 'refreshed', true, 'item', public.faye_memory_item_json(v_new));
    end if;
  end if;

  v_conf := greatest(0, least(100, coalesce(p_confidence, case when p_source in ('stated', 'taught') then 95 else 40 end)));
  begin
    insert into public.faye_memory_items (user_id, category, slot, fact, source, source_ref, confidence, status, approved_by, approved_at)
    values (v_uid, p_category, p_slot, v_fact, p_source, p_source_ref, v_conf, p_status,
            case when p_status = 'approved' then 'owner' end, case when p_status = 'approved' then now() end)
    returning * into v_new;
  exception
    when check_violation then
      perform public.faye_memory_log(v_uid, 'dropped', null, null, 1, p_source);
      return jsonb_build_object('ok', false, 'code', 'text_rejected',
        'detail', coalesce(substring(sqlerrm from 'rejected \(([a-z_]+)\)'), 'check'));
    when program_limit_exceeded then
      return jsonb_build_object('ok', false, 'code', 'limit_reached');
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'conflict');
  end;
  if p_status = 'approved' then
    v_old := public.faye_memory_supersede(v_uid, v_new.id, v_new.slot);
    select * into v_new from public.faye_memory_items where id = v_new.id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_new.id, 'duplicate', false, 'superseded', v_old, 'item', public.faye_memory_item_json(v_new));
end $$;

-- Edit the words or the category of a note in place (the slot is fixed once set).
create or replace function public.faye_memory_edit(p_id uuid, p_fact text default null, p_category text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := public.faye_memory_owner();
  v_fact    text;
  v_problem text;
  v_row     public.faye_memory_items%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select * into v_row from public.faye_memory_items where id = p_id and user_id = v_uid and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if p_category is not null and p_category not in ('style', 'preference', 'habit', 'tendency', 'goal', 'context', 'avoid') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_category');
  end if;
  v_fact := case when p_fact is null then v_row.fact else btrim(regexp_replace(p_fact, '\s+', ' ', 'g')) end;
  if p_fact is not null then
    v_problem := public.faye_memory_text_problem(v_fact);
    if v_problem is null and char_length(v_fact) not between 3 and 200 then v_problem := 'length'; end if;
    if v_problem is not null then
      perform public.faye_memory_log(v_uid, 'dropped', null, null, 1, 'taught');
      return jsonb_build_object('ok', false, 'code', 'text_rejected', 'detail', v_problem);
    end if;
  end if;
  begin
    update public.faye_memory_items
       set fact = v_fact, category = coalesce(p_category, category), last_observed_at = now()
     where id = v_row.id returning * into v_row;
  exception
    when check_violation then
      perform public.faye_memory_log(v_uid, 'dropped', null, null, 1, 'taught');
      return jsonb_build_object('ok', false, 'code', 'text_rejected',
        'detail', coalesce(substring(sqlerrm from 'rejected \(([a-z_]+)\)'), 'check'));
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'conflict');
  end;
  perform public.faye_memory_log(v_uid, 'edited', v_row.id);
  return jsonb_build_object('ok', true, 'item', public.faye_memory_item_json(v_row));
end $$;

-- approve / reject a proposal, retire an approved note, revive a retired one.
create or replace function public.faye_memory_decide(p_id uuid, p_decision text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_row public.faye_memory_items%rowtype;
  v_old uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  if p_decision is null or p_decision not in ('approve', 'reject', 'retire', 'revive') then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_decision');
  end if;
  select * into v_row from public.faye_memory_items where id = p_id and user_id = v_uid and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  if p_decision = 'approve' then
    if v_row.status <> 'proposed' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'not_proposed'); end if;
    update public.faye_memory_items
       set status = 'approved', approved_by = 'owner', approved_at = now(), last_observed_at = now(), expires_at = null
     where id = v_row.id;
    perform public.faye_memory_log(v_uid, 'approved', v_row.id, null, null, v_row.source);
  elsif p_decision = 'revive' then
    if v_row.status <> 'retired' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'not_retired'); end if;
    update public.faye_memory_items
       set status = 'approved', approved_by = 'owner', approved_at = now(), last_observed_at = now(), expires_at = null
     where id = v_row.id;
    perform public.faye_memory_log(v_uid, 'revived', v_row.id, null, null, v_row.source);
  elsif p_decision = 'reject' then
    if v_row.status <> 'proposed' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'not_proposed'); end if;
    update public.faye_memory_items set status = 'rejected', expires_at = null where id = v_row.id;
    perform public.faye_memory_log(v_uid, 'rejected', v_row.id, null, null, v_row.source);
  else
    if v_row.status <> 'approved' then return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'not_approved'); end if;
    update public.faye_memory_items set status = 'retired' where id = v_row.id;
    perform public.faye_memory_log(v_uid, 'retired', v_row.id, null, null, v_row.source);
  end if;
  if p_decision in ('approve', 'revive') then
    v_old := public.faye_memory_supersede(v_uid, v_row.id, v_row.slot);
  end if;
  select * into v_row from public.faye_memory_items where id = v_row.id;
  return jsonb_build_object('ok', true, 'item', public.faye_memory_item_json(v_row), 'superseded', v_old);
end $$;

-- Soft delete (undo possible for 'memory_undo_minutes'), or p_permanent = true to remove the row at once.
create or replace function public.faye_memory_delete(p_id uuid, p_permanent boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_row public.faye_memory_items%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select * into v_row from public.faye_memory_items where id = p_id and user_id = v_uid and deleted_at is null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if coalesce(p_permanent, false) then
    delete from public.faye_memory_items where id = v_row.id;
    perform public.faye_memory_log(v_uid, 'purged', v_row.id, null, 1);
    return jsonb_build_object('ok', true, 'permanent', true);
  end if;
  update public.faye_memory_items set deleted_at = now() where id = v_row.id;
  perform public.faye_memory_log(v_uid, 'deleted', v_row.id);
  return jsonb_build_object('ok', true, 'permanent', false, 'undo_minutes', public.faye_cfg('memory_undo_minutes', 10));
end $$;

create or replace function public.faye_memory_restore(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_row public.faye_memory_items%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select * into v_row from public.faye_memory_items where id = p_id and user_id = v_uid and deleted_at is not null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  begin
    update public.faye_memory_items set deleted_at = null where id = v_row.id returning * into v_row;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'conflict');
  end;
  perform public.faye_memory_log(v_uid, 'restored', v_row.id);
  return jsonb_build_object('ok', true, 'item', public.faye_memory_item_json(v_row));
end $$;

-- Delete every note and every usage count of the caller, at once. Settings and the audit trail stay.
create or replace function public.faye_memory_delete_all(p_confirm text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_items integer;
  v_stats integer;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_confirm is distinct from 'DELETE' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'confirm_required');
  end if;
  delete from public.faye_memory_items where user_id = v_uid;
  get diagnostics v_items = row_count;
  delete from public.faye_usage_stats where user_id = v_uid;
  get diagnostics v_stats = row_count;
  perform public.faye_memory_log(v_uid, 'deleted_all', null, null, v_items);
  return jsonb_build_object('ok', true, 'deleted', jsonb_build_object('faye_memory_items', v_items, 'faye_usage_stats', v_stats));
end $$;

create or replace function public.faye_memory_update_settings(p_learning_paused boolean default null, p_show_used_notes boolean default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_old public.faye_memory_settings%rowtype;
  v_new public.faye_memory_settings%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select * into v_old from public.faye_memory_settings where user_id = v_uid;
  insert into public.faye_memory_settings (user_id, learning_paused, show_used_notes, updated_at)
  values (v_uid, coalesce(p_learning_paused, coalesce(v_old.learning_paused, false)), coalesce(p_show_used_notes, coalesce(v_old.show_used_notes, true)), now())
  on conflict (user_id) do update
     set learning_paused = excluded.learning_paused, show_used_notes = excluded.show_used_notes, updated_at = now()
  returning * into v_new;
  if p_learning_paused is not null and p_learning_paused is distinct from coalesce(v_old.learning_paused, false) then
    perform public.faye_memory_log(v_uid, case when p_learning_paused then 'paused' else 'resumed' end);
  end if;
  return jsonb_build_object('ok', true, 'settings',
    jsonb_build_object('learning_paused', v_new.learning_paused, 'show_used_notes', v_new.show_used_notes));
end $$;

-- Everything the owner's memory holds, as one document.
create or replace function public.faye_memory_export()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_items jsonb;
  v_set jsonb;
  v_stats jsonb;
  v_events jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select coalesce(jsonb_agg(public.faye_memory_item_json(i) order by i.created_at), '[]'::jsonb) into v_items
    from public.faye_memory_items i where i.user_id = v_uid and i.deleted_at is null;
  select jsonb_build_object('learning_paused', s.learning_paused, 'show_used_notes', s.show_used_notes, 'updated_at', s.updated_at) into v_set
    from public.faye_memory_settings s where s.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('day', u.day, 'topic_counts', u.topic_counts, 'ticker_counts', u.ticker_counts,
                   'hour_hist', u.hour_hist, 'questions', u.questions) order by u.day), '[]'::jsonb) into v_stats
    from public.faye_usage_stats u where u.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'item_id', e.item_id, 'related_item_id', e.related_item_id,
                   'source', e.source, 'count', e.count, 'at', e.at) order by e.at), '[]'::jsonb) into v_events
    from (select * from public.faye_memory_events x where x.user_id = v_uid order by x.at desc limit 2000) e;
  perform public.faye_memory_log(v_uid, 'exported', null, null, jsonb_array_length(v_items));
  return jsonb_build_object('ok', true, 'exported_at', now(), 'items', v_items,
    'settings', coalesce(v_set, jsonb_build_object('learning_paused', false, 'show_used_notes', true)),
    'usage_stats', v_stats, 'events', v_events);
end $$;

-- What the prompt builder may rank: approved, live, unexpired notes, plus whether memory is switched on for this person.
create or replace function public.faye_memory_candidates(p_limit integer default 80)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_enabled boolean;
  v_paused boolean;
  v_items jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_purge(v_uid);
  select a.memory_enabled into v_enabled from public.faye_access a where a.user_id = v_uid;
  select s.learning_paused into v_paused from public.faye_memory_settings s where s.user_id = v_uid;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'category', i.category, 'slot', i.slot, 'fact', i.fact, 'source', i.source, 'confidence', i.confidence,
           'created_at', i.created_at, 'updated_at', i.updated_at, 'approved_at', i.approved_at, 'last_used_at', i.last_used_at,
           'last_observed_at', i.last_observed_at, 'usefulness', i.usefulness, 'use_count', i.use_count)), '[]'::jsonb) into v_items
    from (select * from public.faye_memory_items x
           where x.user_id = v_uid and x.status = 'approved' and x.deleted_at is null and x.sensitivity in ('low', 'normal')
             and (x.expires_at is null or x.expires_at > now())
           order by x.updated_at desc limit greatest(1, least(coalesce(p_limit, 80), 200))) i;
  return jsonb_build_object('ok', true, 'memory_enabled', coalesce(v_enabled, false), 'paused', coalesce(v_paused, false), 'items', v_items);
end $$;

-- Bookkeeping only (last used, use count). Not an audit event: no note changes.
create or replace function public.faye_memory_touch(p_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_n integer := 0;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 or array_length(p_ids, 1) > 12 then
    return jsonb_build_object('ok', true, 'touched', 0);
  end if;
  update public.faye_memory_items set last_used_at = now(), use_count = use_count + 1
   where user_id = v_uid and id = any (p_ids) and status = 'approved' and deleted_at is null;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'touched', v_n);
end $$;

-- Adds one question's COUNTS to today's row. Nothing else is accepted (the table's checks refuse anything that is not a counter).
create or replace function public.faye_usage_bump(p_day date, p_topics jsonb, p_tickers jsonb, p_hour integer)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_paused boolean := false;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select s.learning_paused into v_paused from public.faye_memory_settings s where s.user_id = v_uid;
  if coalesce(v_paused, false) then return jsonb_build_object('ok', false, 'code', 'paused'); end if;
  if p_day is null or p_day < current_date - 2 or p_day > current_date + 2 or p_hour is null or p_hour not between 0 and 23
     or p_topics is null or jsonb_typeof(p_topics) <> 'object' or p_tickers is null or jsonb_typeof(p_tickers) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'bad_payload');
  end if;
  begin
    insert into public.faye_usage_stats as u (user_id, day, topic_counts, ticker_counts, hour_hist, questions)
    values (v_uid, p_day, p_topics, p_tickers, jsonb_build_object(p_hour::text, 1), 1)
    on conflict (user_id, day) do update
       set topic_counts  = public.faye_jsonb_add(u.topic_counts,  excluded.topic_counts),
           ticker_counts = public.faye_jsonb_add(u.ticker_counts, excluded.ticker_counts),
           hour_hist     = public.faye_jsonb_add(u.hour_hist,     excluded.hour_hist),
           questions     = least(u.questions + 1, 100000),
           updated_at    = now();
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'bad_request', 'detail', 'counts_rejected');
  end;
  return jsonb_build_object('ok', true, 'questions',
    (select u.questions from public.faye_usage_stats u where u.user_id = v_uid and u.day = p_day));
end $$;

create or replace function public.faye_usage_recent(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
  v_rows jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('day', u.day, 'topic_counts', u.topic_counts, 'ticker_counts', u.ticker_counts,
                   'hour_hist', u.hour_hist, 'questions', u.questions) order by u.day desc), '[]'::jsonb) into v_rows
    from public.faye_usage_stats u
   where u.user_id = v_uid and u.day >= current_date - greatest(1, least(coalesce(p_days, 30), 90));
  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

-- The application refused a candidate note BEFORE sending it anywhere (the text never reaches the database). Records only that
-- it happened. Rate-limited by the route; bounded by the 365-day audit retention.
create or replace function public.faye_memory_note_dropped(p_count integer default 1, p_source text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  perform public.faye_memory_log(v_uid, 'dropped', null, null, greatest(1, least(coalesce(p_count, 1), 100)),
    case when p_source in ('stated', 'taught', 'observed', 'proposed_by_model') then p_source end);
  return jsonb_build_object('ok', true);
end $$;

-- Called by the "erase everything" route right AFTER faye_erase_me(). Leaves a single content-free line saying that it happened,
-- and only when nothing is left.
create or replace function public.faye_memory_note_erased(p_deleted integer default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := public.faye_memory_owner();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'code', 'not_allowed'); end if;
  if exists (select 1 from public.faye_memory_items where user_id = v_uid) then
    return jsonb_build_object('ok', false, 'code', 'conflict', 'detail', 'items_remain');
  end if;
  perform public.faye_memory_log(v_uid, 'erased_all', null, null, greatest(0, least(coalesce(p_deleted, 0), 1000000)));
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================================================================
-- 7. PRIVILEGES AND POLICIES
-- =====================================================================================================================

revoke all on function public.faye_luhn_ok(text)                                      from public, anon, authenticated;
revoke all on function public.faye_stats_counts_ok(jsonb, text, integer)              from public, anon, authenticated;
revoke all on function public.faye_jsonb_add(jsonb, jsonb)                            from public, anon, authenticated;
revoke all on function public.faye_memory_text_problem(text)                          from public, anon, authenticated;
revoke all on function public.faye_memory_owner()                                     from public, anon, authenticated;
revoke all on function public.faye_memory_items_guard()                               from public, anon, authenticated;
revoke all on function public.faye_memory_items_audit()                               from public, anon, authenticated;
revoke all on function public.faye_memory_log(uuid, text, uuid, uuid, integer, text)  from public, anon, authenticated;
revoke all on function public.faye_memory_item_json(public.faye_memory_items)         from public, anon, authenticated;
revoke all on function public.faye_memory_purge(uuid)                                 from public, anon, authenticated;
revoke all on function public.faye_memory_supersede(uuid, uuid, text)                 from public, anon, authenticated;

revoke all on function public.faye_memory_is_owner()                                  from public, anon, authenticated;
revoke all on function public.faye_memory_list(boolean)                               from public, anon, authenticated;
revoke all on function public.faye_memory_add(text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.faye_memory_edit(uuid, text, text)                      from public, anon, authenticated;
revoke all on function public.faye_memory_decide(uuid, text)                          from public, anon, authenticated;
revoke all on function public.faye_memory_delete(uuid, boolean)                       from public, anon, authenticated;
revoke all on function public.faye_memory_restore(uuid)                               from public, anon, authenticated;
revoke all on function public.faye_memory_delete_all(text)                            from public, anon, authenticated;
revoke all on function public.faye_memory_update_settings(boolean, boolean)           from public, anon, authenticated;
revoke all on function public.faye_memory_export()                                    from public, anon, authenticated;
revoke all on function public.faye_memory_candidates(integer)                         from public, anon, authenticated;
revoke all on function public.faye_memory_touch(uuid[])                               from public, anon, authenticated;
revoke all on function public.faye_usage_bump(date, jsonb, jsonb, integer)            from public, anon, authenticated;
revoke all on function public.faye_usage_recent(integer)                              from public, anon, authenticated;
revoke all on function public.faye_memory_note_erased(integer)                        from public, anon, authenticated;
revoke all on function public.faye_memory_note_dropped(integer, text)                 from public, anon, authenticated;

grant execute on function public.faye_memory_is_owner()                                to authenticated;
grant execute on function public.faye_memory_list(boolean)                             to authenticated;
grant execute on function public.faye_memory_add(text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.faye_memory_edit(uuid, text, text)                    to authenticated;
grant execute on function public.faye_memory_decide(uuid, text)                        to authenticated;
grant execute on function public.faye_memory_delete(uuid, boolean)                     to authenticated;
grant execute on function public.faye_memory_restore(uuid)                             to authenticated;
grant execute on function public.faye_memory_delete_all(text)                          to authenticated;
grant execute on function public.faye_memory_update_settings(boolean, boolean)         to authenticated;
grant execute on function public.faye_memory_export()                                  to authenticated;
grant execute on function public.faye_memory_candidates(integer)                       to authenticated;
grant execute on function public.faye_memory_touch(uuid[])                             to authenticated;
grant execute on function public.faye_usage_bump(date, jsonb, jsonb, integer)          to authenticated;
grant execute on function public.faye_usage_recent(integer)                            to authenticated;
grant execute on function public.faye_memory_note_erased(integer)                      to authenticated;
grant execute on function public.faye_memory_note_dropped(integer, text)               to authenticated;

-- SELECT only, own rows, owner only. The soft-deleted rows are not visible even to their owner.
grant select on public.faye_memory_items, public.faye_memory_settings, public.faye_memory_events, public.faye_usage_stats to authenticated;

drop policy if exists faye_memory_items_select_own on public.faye_memory_items;
create policy faye_memory_items_select_own on public.faye_memory_items
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_memory_is_owner()) and deleted_at is null);
drop policy if exists faye_memory_settings_select_own on public.faye_memory_settings;
create policy faye_memory_settings_select_own on public.faye_memory_settings
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_memory_is_owner()));
drop policy if exists faye_memory_events_select_own on public.faye_memory_events;
create policy faye_memory_events_select_own on public.faye_memory_events
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_memory_is_owner()));
drop policy if exists faye_usage_stats_select_own on public.faye_usage_stats;
create policy faye_usage_stats_select_own on public.faye_usage_stats
  for select to authenticated using (user_id = (select auth.uid()) and (select public.faye_memory_is_owner()));
