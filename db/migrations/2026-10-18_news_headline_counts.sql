-- Daily headline-count log: how many headlines the app's news feeds carried for a symbol on each Eastern calendar date
-- (research data only: counts, outlet names and short hashes; no headline text and no links are stored).
-- Run once in the Supabase SQL editor AFTER you decide to turn the logger on. Safe to re-run.
-- Why it exists: see src/lib/news-impact/headline-log.ts and the News Impact design notes. There is no archive of past
-- headlines, so a "busier news day, bigger move" test can only be run on counts collected from now on.

create table if not exists news_headline_counts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  symbol text not null,
  asset_class text not null,
  count_date date not null,                    -- Eastern calendar date the headlines were published on

  headline_count integer not null default 0,   -- distinct stories (same story from several outlets counts once)
  filing_count integer not null default 0,     -- SEC filings dated that day (kept apart from headlines)
  opinion_count integer not null default 0,    -- headlines the app labels as opinion or promotion
  source_counts jsonb not null default '{}'::jsonb,   -- { "outlet name": count }

  -- Short hashes of the stories already counted for this date, each with its outlet and flags, so several captures a day
  -- never double count. Shape: { "<12 hex>": "<n|f><o|->|<outlet>" }. No titles, no links.
  seen jsonb not null default '{}'::jsonb,

  feed_capped boolean not null default false,  -- the symbol's feed hit its item cap, so this day's count may be too low
  first_captured_at timestamptz not null default now(),
  last_captured_at timestamptz not null default now(),
  captures integer not null default 1,

  unique (symbol, count_date)
);

create index if not exists news_headline_counts_symbol_date_idx on news_headline_counts (symbol, count_date desc);

-- The app reads and writes with the service-role key (which bypasses RLS).
-- RLS on with no policies keeps the public anon key out entirely.
alter table news_headline_counts enable row level security;
