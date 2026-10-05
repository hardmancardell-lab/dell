-- Paper-trade attribution + append-only trade log.
-- Run once in the Supabase SQL editor. Safe to re-run.

-- 1. Why an order exists (strategy, source, backtested KPIs at decision time).
alter table paper_orders add column if not exists attribution jsonb;

-- 2. One row per fill, copied at fill time so a limit order that fills days
--    later is still attributed to the strategy that created it.
create table if not exists paper_trade_log (
  id uuid primary key default gen_random_uuid(),
  logged_at timestamptz not null default now(),
  account_id uuid not null,
  order_id uuid not null,
  fill_id uuid not null,
  symbol text not null,
  asset_class text not null,
  side text not null,
  quantity numeric not null,
  fill_price numeric not null,
  total_fees numeric not null default 0,
  realized_pnl numeric,
  option_right text,
  strike_price numeric,
  expiration_date date,
  underlying_symbol text,
  strategy_group_id text,
  origin text not null default 'api',          -- ui | faye | api
  source text not null default 'manual',       -- guided_signal | backtest | manual
  strategy_type text,
  strategy_label text,
  hypothesis_id text,
  kpis jsonb                                   -- the signal's backtested numbers at decision time
);

create index if not exists paper_trade_log_account_idx on paper_trade_log (account_id, logged_at desc);
create index if not exists paper_trade_log_strategy_idx on paper_trade_log (strategy_type, symbol);

-- The app reads and writes with the service-role key (which bypasses RLS).
-- Turning RLS on with no policies keeps the public anon key out entirely.
alter table paper_trade_log enable row level security;
