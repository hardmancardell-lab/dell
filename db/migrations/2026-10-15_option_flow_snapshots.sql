-- Intraday option-flow snapshot log: raw put/call flow measures every 5 minutes through the regular session
-- (research data only: no signal, no label). Run once in the Supabase SQL editor. Safe to re-run.
-- See OPTION_FLOW_LOG_NOTES.md for what each column means and the pre-registered evaluation plan.

create table if not exists option_flow_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  symbol text not null,
  snapshot_time timestamptz not null,          -- start of the 5-minute bucket
  actual_fetch_time timestamptz not null,      -- when the data was really fetched (scheduled runs can be late or skipped: analyse on this)
  session_date date not null,                  -- ET calendar date
  spot numeric not null,

  expirations_used jsonb not null,             -- flow-window expirations that loaded (<= 10 calendar days, at most 6)
  expirations_failed jsonb not null default '[]'::jsonb,

  call_volume bigint not null,                 -- cumulative day volume over the flow window
  put_volume bigint not null,
  call_premium numeric not null,               -- cumulative volume x mid x 100 (last when no valid two-sided quote)
  put_premium numeric not null,
  premium_fallback_volume bigint not null default 0,   -- volume priced at last instead of mid
  premium_unpriced_volume bigint not null default 0,   -- volume with no usable price (contributes 0 premium)
  pc_volume numeric,                           -- put / call, null when the denominator is 0
  pc_premium numeric,
  pc_oi numeric,

  oi_call bigint,                              -- open interest over the 45-day window (carried forward within the session)
  oi_put bigint,
  oi_expirations_used jsonb,
  oi_asof timestamptz,

  exp_volumes jsonb not null default '{}'::jsonb,      -- { "YYYY-MM-DD": [callVolume, putVolume] } cumulative per expiration

  new_call_volume bigint,                      -- since the previous snapshot of the same session; null on the first
  new_put_volume bigint,
  pc_new_volume numeric,
  minutes_since_prev numeric,
  first_pc_volume numeric,                     -- first defined put/call of the session, carried forward
  first_pc_premium numeric,
  pc_volume_chg numeric,                       -- cumulative P/C minus the session's first
  pc_premium_chg numeric,

  -- CRUDE aggressor proxy on the new volume (last vs bid/ask at snapshot time). Approximate: not Lee-Ready.
  agg_call_buy bigint,
  agg_call_sell bigint,
  agg_put_buy bigint,
  agg_put_sell bigint,
  agg_unclassified bigint,

  iv_atm_near numeric,                         -- implied vol as a fraction (0.21 = 21%)
  iv_atm_next numeric,

  stale boolean not null default false,        -- cumulative volume unchanged since the previous snapshot (or equal to the prior session close)
  clamped boolean not null default false,      -- a cumulative volume fell versus the previous snapshot; the delta was clamped at 0
  flags jsonb not null default '[]'::jsonb,
  provider_calls integer,

  -- [expIdx, strike, right, volume, oi, bid, ask, last, iv] for strikes within +-10% of spot, first 3 expirations.
  -- About 30 KB per row for SPY/QQQ; nulled after the detail retention period (14 days, OPTION_FLOW_CONFIG) by the prune job.
  contracts jsonb,

  unique (symbol, snapshot_time)
);

create index if not exists option_flow_snapshots_symbol_time_idx on option_flow_snapshots (symbol, snapshot_time desc);
create index if not exists option_flow_snapshots_session_idx on option_flow_snapshots (session_date);

-- The app reads and writes with the service-role key (which bypasses RLS).
-- RLS on with no policies keeps the public anon key out entirely.
alter table option_flow_snapshots enable row level security;
