-- Crypto as an asset class: fractional quantities and the 'crypto' value in asset_class.
-- Run once in the Supabase SQL editor. Safe to re-run, and a no-op for anything already numeric / already allowing 'crypto'.
--
-- Why it exists: the DDL for the paper-trading tables is not kept in this repo, so it cannot be checked from here whether
-- paper_orders / paper_positions / paper_fills store quantity as an integer, or whether asset_class is guarded by a
-- check constraint or an enum. Crypto orders are fractional (0.015 BTC) and carry asset_class = 'crypto'. If your tables
-- already use numeric and have no such guard, running this changes nothing. Until it has been run (if needed), a crypto
-- paper order is rejected with an error that names this file; nothing else in the app is affected.
--
-- Covers: paper_orders, paper_positions, paper_fills (paper trading); advisor_client_holdings and
-- advisor_client_realized_pnl (a client's own or advisor-entered crypto holding); alert_rules (crypto price alerts).
-- paper_trade_log already uses numeric quantity and a free-text asset_class.

do $$
declare
  c record;
  t text;
begin
  -- 1. Whole-number quantity columns become numeric (existing values are preserved exactly).
  for c in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('integer', 'smallint', 'bigint')
      and (table_name::text, column_name::text) in (
        values ('paper_orders', 'quantity'), ('paper_positions', 'quantity'), ('paper_fills', 'quantity'),
               ('advisor_client_holdings', 'shares'), ('advisor_client_realized_pnl', 'shares_sold')
      )
  loop
    execute format('alter table public.%I alter column %I type numeric', c.table_name, c.column_name);
    raise notice 'made %.% numeric', c.table_name, c.column_name;
  end loop;

  -- 2. asset_class must accept 'crypto'.
  foreach t in array array['paper_orders', 'paper_positions', 'alert_rules', 'advisor_client_holdings'] loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    -- 2a. A check constraint that is purely a list of allowed asset classes is replaced by the same list plus 'crypto'.
    --     Constraints that mention other columns are left alone.
    for c in
      select conname
      from pg_constraint
      where conrelid = ('public.' || t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ~ '^CHECK \(+asset_class'
        and pg_get_constraintdef(oid) !~ '(option_right|strike_price|expiration_date|underlying_symbol|quantity|shares)'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
      execute format(
        'alter table public.%I add constraint %I check (asset_class in (''equity'', ''bond'', ''option'', ''future'', ''forex'', ''commodity'', ''crypto''))',
        t, c.conname
      );
      raise notice 'widened % on %', c.conname, t;
    end loop;

    -- 2b. An enum column gets the new value.
    for c in
      select udt_name
      from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'asset_class' and data_type = 'USER-DEFINED'
    loop
      execute format('alter type public.%I add value if not exists ''crypto''', c.udt_name);
      raise notice 'added crypto to enum % (column %.asset_class)', c.udt_name, t;
    end loop;
  end loop;
end $$;
