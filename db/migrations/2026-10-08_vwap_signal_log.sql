-- Forward-test log for the intraday VWAP-band research tool (research / paper only, no orders).
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists vwap_signal_log (
  id uuid primary key default gen_random_uuid(),
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  symbol text not null,
  asset_kind text not null,                    -- equity | forex
  session_date text not null,                  -- local session date, YYYY-MM-DD
  entry_time timestamptz not null,             -- open time of the 5-minute bar whose close was beyond the band
  side text not null,                          -- upper | lower (price beyond the upper/lower band; the trade fades it)
  k numeric not null,                          -- band width in standard deviations
  stop_k numeric not null,
  entry_price numeric not null,
  vwap numeric not null,
  sigma numeric not null,
  band_pct numeric not null,
  volume_z numeric,
  volume_class text not null,
  status text not null default 'open',         -- open | closed
  exit_reason text not null,                   -- open | target | stop | time
  exit_price numeric not null,                 -- latest close while open
  bars_held integer not null,
  fade_return_pct numeric not null,            -- marked to the latest close while open
  detected_lag_min integer not null,           -- minutes between the entry bar closing and the scan that first saw it
  source text not null,                        -- live | backfill
  unique (symbol, session_date, entry_time, side, k)
);

create index if not exists vwap_signal_log_symbol_idx on vwap_signal_log (symbol, entry_time desc);

-- The app reads and writes with the service-role key (which bypasses RLS).
-- RLS on with no policies keeps the public anon key out entirely.
alter table vwap_signal_log enable row level security;
