-- Atomic paper-trading fills.   *** REVIEWED AGAINST THE CODE 2026-10-19. Run 7-paper-schema-check.sql first. ***
--
-- Why: the engine used to apply a fill as 5-6 separate REST calls (position, cash, fill row, trade log, order status).
-- Concurrent requests interleaved those calls: the database-security audit measured lost cash updates (23k of free
-- money across 20 concurrent buys), an overdrawn account and one pending order filled three times. The app now
-- serializes fills per account inside one server instance and claims orders with a conditional PATCH, but only the
-- database can make this atomic across instances. This file adds:
--   1. UNIQUE(session_id) on paper_accounts (one account per anonymous session) and UNIQUE(order_id) on paper_fills
--      (one fill per order; the engine never partially fills). Each is created only when no duplicates exist.
--   2. Sanity constraints (NOT VALID, so existing rows are not rewritten). A constraint is skipped, with a NOTICE, when
--      existing rows already violate it (a NOT VALID check still blocks every UPDATE of a violating row, which would
--      make a bad order impossible to cancel). Clean the rows, re-run this file, then VALIDATE.
--   3. paper_apply_fill(): locks the account, claims the pending order, locks the position, checks funds/holdings,
--      moves cash, writes the position and the fill row, marks the order filled and cancels its OCO siblings, all in
--      ONE transaction.
--
-- The DDL of the paper tables is not kept in this repo, so column names/types come from the application code
-- (src/lib/data/paper-trading-db.ts) and from db/migrations/2026-10-05_paper_trade_log.sql (which stores order/account/
-- fill ids as uuid, strong evidence the source ids are uuid). Where a type is uncertain the function is written so it
-- does not matter:
--   * the order id arrives as TEXT and is converted to whatever type paper_orders.id really is (uuid, bigint or text),
--     so the primary-key index is still used;
--   * rows are handled as paper_orders%rowtype / paper_accounts%rowtype / ..., so no column type is hard-coded;
--   * all money and quantity math is numeric (exact). If a column is double precision the value is converted on write.
-- 7-paper-schema-check.sql prints the live types so they can be confirmed before this file is run.
--
-- Run once in the Supabase SQL editor. Safe to re-run (create or replace / if not exists / guarded constraints).
--
-- HOW THE SERVICE CALLS IT (wired in: src/lib/data/paper-trading-db.ts applyFillRpc, used by paper-trading-engine.ts)
--   Immediate (market / marketable) orders: the engine creates the order with status 'pending', computes the fill price
--   and fees exactly as before (computeFees, slippage, crypto bid/ask), then makes ONE call:
--       POST {SUPABASE_URL}/rest/v1/rpc/paper_apply_fill
--       headers: apikey + Authorization: Bearer <service role key>, Content-Type: application/json
--       body: { "p_order_id": "...", "p_fill_price": 123.45, "p_slippage_per_share": 0.02, "p_sec_fee": 0, "p_finra_fee": 0,
--               "p_occ_fee": 0, "p_total_fees": 0, "p_multiplier": 1, "p_fee_into_basis": false }
--   Resting orders: evaluateOrder() finds the trigger price from bars as before and calls the same RPC instead of
--   claimPendingOrder + applyFill. The function returns jsonb:
--       { "applied": true,  "fill_id": ..., "fill": {the paper_fills row}, "cash_balance": n, "realized_pnl": null | n,
--         "new_quantity": n, "cancelled_oco": [order ids] }
--       { "applied": false, "reason": "order is filled" }     -- lost the race (or order gone): "nothing to do"
--   and raises an exception for a funds/holdings failure (message starts "REJECT: "), in which case the transaction is
--   rolled back and the service marks the order rejected. Any other exception is an infrastructure/input error: the
--   order stays pending. After a successful call the service writes the paper_trade_log row (best effort).
--   p_multiplier and p_fee_into_basis are OPTIONAL cross-checks: the function derives both from the order's asset class
--   (100 for options, 1 otherwise; crypto buy fees go into cost basis) and raises if the caller passes a different value.
--   Grant: the function is SECURITY DEFINER and execute is revoked from public; only the service role may call it.

-- 1a. One account per session --------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from paper_accounts group by session_id having count(*) > 1) then
    raise notice 'paper_accounts has duplicate session_id rows; merge or delete the extras, then re-run to add the unique index.';
  else
    create unique index if not exists paper_accounts_session_id_key on paper_accounts (session_id);
  end if;
end $$;

-- 1b. One fill per order (the engine never fills an order in parts) ---------------------------------------------------
do $$
begin
  if exists (select 1 from paper_fills group by order_id having count(*) > 1) then
    raise notice 'paper_fills has orders with more than one fill row (the old triple-fill race); inspect them, then re-run to add the unique index.';
  else
    create unique index if not exists paper_fills_order_id_key on paper_fills (order_id);
  end if;
end $$;

-- 2. Sanity constraints (NOT VALID, each skipped with a NOTICE if existing rows already break it) --------------------
-- One block per constraint: an exception block rolls back everything inside it, so a type surprise on one constraint
-- (for example an enum column with no 'buy' label) must not undo or block the others, nor the function below.
do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_side_chk') then
    select count(*) into n from paper_orders where not (side::text in ('buy', 'sell'));
    if n > 0 then
      raise notice 'skipped paper_orders_side_chk: % existing order(s) have a side other than buy/sell', n;
    else
      alter table paper_orders add constraint paper_orders_side_chk check (side::text in ('buy', 'sell')) not valid;
    end if;
  end if;
exception when others then raise notice 'skipped paper_orders_side_chk (%): optional, the function does not need it', sqlerrm;
end $$;

do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_type_chk') then
    select count(*) into n from paper_orders where not (order_type::text in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop'));
    if n > 0 then
      raise notice 'skipped paper_orders_type_chk: % existing order(s) have an unknown order_type', n;
    else
      alter table paper_orders add constraint paper_orders_type_chk check (order_type::text in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop')) not valid;
    end if;
  end if;
exception when others then raise notice 'skipped paper_orders_type_chk (%): optional, the function does not need it', sqlerrm;
end $$;

do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_quantity_chk') then
    select count(*) into n from paper_orders where not (quantity > 0);
    if n > 0 then
      raise notice 'skipped paper_orders_quantity_chk: % existing order(s) have quantity <= 0', n;
    else
      alter table paper_orders add constraint paper_orders_quantity_chk check (quantity > 0) not valid;
    end if;
  end if;
exception when others then raise notice 'skipped paper_orders_quantity_chk (%): optional, the function does not need it', sqlerrm;
end $$;

do $$
declare n bigint;
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_accounts_cash_chk') then
    select count(*) into n from paper_accounts where not (cash_balance >= 0);
    if n > 0 then
      raise notice 'skipped paper_accounts_cash_chk: % account(s) already have negative cash (the audit saw -19,881 after a race). For paper money: update paper_accounts set cash_balance = 100000 where cash_balance < 0; then re-run.', n;
    else
      alter table paper_accounts add constraint paper_accounts_cash_chk check (cash_balance >= 0) not valid;
    end if;
  end if;
exception when others then raise notice 'skipped paper_accounts_cash_chk (%): optional, the function does not need it', sqlerrm;
end $$;
-- alter table paper_orders   validate constraint paper_orders_side_chk;
-- alter table paper_orders   validate constraint paper_orders_type_chk;
-- alter table paper_orders   validate constraint paper_orders_quantity_chk;
-- alter table paper_accounts validate constraint paper_accounts_cash_chk;

-- 3. Atomic fill ------------------------------------------------------------------------------------------------------
-- The earlier unrun draft took (uuid, ..., integer, boolean). Drop it so PostgREST never sees two overloads (PGRST203).
drop function if exists public.paper_apply_fill(uuid, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean);

create or replace function public.paper_apply_fill(
  p_order_id text,
  p_fill_price numeric,
  p_slippage_per_share numeric default 0,
  p_sec_fee numeric default 0,
  p_finra_fee numeric default 0,
  p_occ_fee numeric default 0,
  p_total_fees numeric default 0,
  p_multiplier integer default null,       -- optional cross-check: 100 for options, 1 otherwise
  p_fee_into_basis boolean default null    -- optional cross-check: true for crypto (the buy-side fee joins cost basis)
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id paper_orders.id%type;
  v_account_id paper_orders.account_id%type;
  v_order paper_orders%rowtype;
  v_acct paper_accounts%rowtype;
  v_pos paper_positions%rowtype;
  v_fill paper_fills%rowtype;
  v_have_pos boolean;
  v_mult integer;
  v_into_basis boolean;
  v_exist_qty numeric := 0;
  v_exist_cost numeric := 0;
  v_new_qty numeric;
  v_new_cost numeric;
  v_realized numeric := null;
  v_gross numeric;
  v_cash_needed numeric;
  v_new_cash numeric;
  v_cancelled jsonb := '[]'::jsonb;
begin
  -- Input problems are plain errors (no REJECT prefix): the service leaves the order pending instead of rejecting it.
  if p_order_id is null or btrim(p_order_id) = '' then
    raise exception 'missing order id';
  end if;
  if p_fill_price is null or p_fill_price <= 0 or p_fill_price > 10000000 then
    raise exception 'invalid fill price %', p_fill_price;
  end if;
  if coalesce(p_total_fees, 0) < 0 or coalesce(p_slippage_per_share, 0) < 0
     or coalesce(p_sec_fee, 0) < 0 or coalesce(p_finra_fee, 0) < 0 or coalesce(p_occ_fee, 0) < 0 then
    raise exception 'fees and slippage must not be negative';
  end if;
  p_total_fees := coalesce(p_total_fees, 0);

  v_order_id := p_order_id;   -- text -> the real id type by I/O conversion; keeps the primary-key index usable

  -- LOCK ORDER (always this order, so concurrent fills cannot deadlock): account -> order -> position -> OCO siblings.
  -- The account id is read without a lock first, then the account row is locked, then the order is re-read under lock.
  -- Locking the order first would deadlock two OCO siblings filled at the same moment (each would hold its own order
  -- row and wait for the account row while cancelling the other).
  select account_id into v_account_id from paper_orders where id = v_order_id;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'order not found');
  end if;

  select * into v_acct from paper_accounts where id = v_account_id for update;
  if not found then
    raise exception 'paper account % not found', v_account_id;
  end if;

  select * into v_order from paper_orders where id = v_order_id for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'order not found');
  end if;
  if v_order.status::text <> 'pending' then
    return jsonb_build_object('applied', false, 'reason', 'order is ' || v_order.status::text);
  end if;
  if v_order.side::text not in ('buy', 'sell') then
    raise exception 'REJECT: order has an unknown side %', v_order.side;
  end if;
  if v_order.quantity is null or v_order.quantity <= 0 then
    raise exception 'REJECT: order quantity must be positive';
  end if;

  v_mult := case when v_order.asset_class::text = 'option' then 100 else 1 end;
  v_into_basis := (v_order.asset_class::text = 'crypto');
  if p_multiplier is not null and p_multiplier <> v_mult then
    raise exception 'multiplier % does not match asset class % (expected %)', p_multiplier, v_order.asset_class, v_mult;
  end if;
  if p_fee_into_basis is not null and p_fee_into_basis <> v_into_basis then
    raise exception 'fee-into-basis % does not match asset class %', p_fee_into_basis, v_order.asset_class;
  end if;

  select * into v_pos from paper_positions
   where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class
   for update;
  v_have_pos := found;
  if v_have_pos then
    v_exist_qty := v_pos.quantity;
    v_exist_cost := v_pos.avg_cost_basis;
  end if;

  v_gross := v_order.quantity * v_mult * p_fill_price;

  if v_order.side::text = 'buy' then
    v_cash_needed := v_gross + p_total_fees;
    -- Same 1e-9 tolerance as the engine's JavaScript check.
    if v_cash_needed > v_acct.cash_balance + 0.000000001 then
      raise exception 'REJECT: Insufficient cash at fill time: needs $%, account has $%.', round(v_cash_needed, 2), round(v_acct.cash_balance, 2);
    end if;
    v_new_cash := v_acct.cash_balance - v_cash_needed;

    if v_exist_qty < 0 then                       -- buy to close a short option position
      if v_order.quantity > abs(v_exist_qty) then
        raise exception 'REJECT: Cannot buy % contract(s) at fill time to close a %-contract short in one order.', trim_scale(v_order.quantity), trim_scale(abs(v_exist_qty));
      end if;
      v_new_qty := v_exist_qty + v_order.quantity;
      v_realized := (v_exist_cost - p_fill_price) * v_order.quantity * v_mult - p_total_fees;
      v_new_cost := v_exist_cost;                 -- unchanged basis for any remaining short
    else
      v_new_qty := v_exist_qty + v_order.quantity;
      -- Crypto: the buy-side fee is part of what the coins cost (cost basis), so unrealized P&L is not overstated.
      v_new_cost := (v_exist_qty * v_exist_cost + v_order.quantity * p_fill_price
                     + case when v_into_basis then p_total_fees else 0 end) / v_new_qty;
    end if;
  else
    -- Holdings check, same two rules as the engine: everything except options must hold the full quantity (1e-12
    -- tolerance for float dust); an option sell may also open a short, but may not oversell an existing long.
    if v_order.asset_class::text <> 'option' and v_exist_qty < v_order.quantity - 0.000000000001 then
      raise exception 'REJECT: Cannot sell % % at fill time: only % held.', trim_scale(v_order.quantity), v_order.symbol, trim_scale(v_exist_qty);
    end if;
    if v_order.asset_class::text = 'option' and v_exist_qty > 0 and v_order.quantity > v_exist_qty then
      raise exception 'REJECT: Cannot sell % contract(s) at fill time: only % held.', trim_scale(v_order.quantity), trim_scale(v_exist_qty);
    end if;

    v_new_cash := v_acct.cash_balance + v_gross - p_total_fees;
    if v_exist_qty > 0 then                       -- sell to close a long
      v_new_qty := v_exist_qty - v_order.quantity;
      v_realized := (p_fill_price - v_exist_cost) * v_order.quantity * v_mult - p_total_fees;
      v_new_cost := v_exist_cost;
    else                                          -- option only (guarded above): sell to open or extend a short
      v_new_qty := v_exist_qty - v_order.quantity;
      v_new_cost := (abs(v_exist_qty) * v_exist_cost + v_order.quantity * p_fill_price) / abs(v_new_qty);
    end if;
  end if;

  if v_new_cash < 0 then v_new_cash := 0; end if;   -- only reachable inside the 1e-9 tolerance above

  if v_order.asset_class::text = 'crypto' then
    v_new_qty := round(v_new_qty, 8);             -- no float dust (matches roundCryptoQuantity)
  end if;

  if v_new_qty = 0 then
    delete from paper_positions
     where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class;
  elsif v_have_pos then
    update paper_positions
       set quantity = v_new_qty, avg_cost_basis = v_new_cost,
           option_right = v_order.option_right, strike_price = v_order.strike_price,
           expiration_date = v_order.expiration_date, underlying_symbol = v_order.underlying_symbol
     where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class;
  else
    insert into paper_positions (account_id, symbol, asset_class, quantity, avg_cost_basis,
                                 option_right, strike_price, expiration_date, underlying_symbol)
    values (v_order.account_id, v_order.symbol, v_order.asset_class, v_new_qty, v_new_cost,
            v_order.option_right, v_order.strike_price, v_order.expiration_date, v_order.underlying_symbol);
  end if;

  update paper_accounts set cash_balance = v_new_cash where id = v_acct.id;

  insert into paper_fills (order_id, account_id, symbol, side, quantity, fill_price, slippage_per_share,
                           sec_fee, finra_fee, occ_fee, total_fees, realized_pnl,
                           option_right, strike_price, expiration_date, underlying_symbol)
  values (v_order.id, v_order.account_id, v_order.symbol, v_order.side, v_order.quantity, p_fill_price, coalesce(p_slippage_per_share, 0),
          coalesce(p_sec_fee, 0), coalesce(p_finra_fee, 0), coalesce(p_occ_fee, 0), p_total_fees, v_realized,
          v_order.option_right, v_order.strike_price, v_order.expiration_date, v_order.underlying_symbol)
  returning * into v_fill;

  update paper_orders set status = 'filled', filled_at = now() where id = v_order.id;

  -- OCO: the first leg to fill cancels every other pending order of its group, atomically with the fill.
  if v_order.oco_group_id is not null then
    with cancelled as (
      update paper_orders set status = 'cancelled', cancelled_at = now()
       where oco_group_id = v_order.oco_group_id and status::text = 'pending' and id <> v_order.id
      returning id
    )
    select coalesce(jsonb_agg(id), '[]'::jsonb) into v_cancelled from cancelled;
  end if;

  return jsonb_build_object('applied', true, 'fill_id', v_fill.id, 'fill', to_jsonb(v_fill),
                            'cash_balance', v_new_cash, 'realized_pnl', v_realized,
                            'new_quantity', v_new_qty, 'cancelled_oco', v_cancelled);
end;
$$;

revoke all on function public.paper_apply_fill(text, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) from public;
revoke all on function public.paper_apply_fill(text, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) from anon, authenticated;
grant execute on function public.paper_apply_fill(text, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) to service_role;

-- Make PostgREST see the new function immediately (Supabase usually reloads on DDL; this is harmless if it already did).
notify pgrst, 'reload schema';
