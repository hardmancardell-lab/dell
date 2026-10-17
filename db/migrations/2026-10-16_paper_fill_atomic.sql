-- Atomic paper-trading fills.   *** DRAFT - NOT RUN. Review in a staging project first. ***
--
-- Why: the engine used to apply a fill as 5-6 separate REST calls (position, cash, fill row, trade log, order status).
-- Concurrent requests interleaved those calls: the database-security audit measured lost cash updates (23k of free
-- money across 20 concurrent buys), an overdrawn account and one pending order filled three times. The app now
-- serializes fills per account inside one server instance and claims orders with a conditional PATCH, but only the
-- database can make this atomic across instances. This file adds:
--   1. UNIQUE(session_id) on paper_accounts (one account per anonymous session).
--   2. Sanity constraints (NOT VALID, so existing rows are not rewritten; VALIDATE them after cleaning data).
--   3. paper_apply_fill(): claims the pending order, locks the account and position rows, checks funds/holdings,
--      debits or credits cash, writes the position and the fill row, all in ONE transaction.
--
-- The DDL of the paper tables is not kept in this repo, so column names/types below come from the application code
-- (src/lib/data/paper-trading-db.ts). If an id column is not uuid, change the uuid parameter type and the casts.
-- Run once in the Supabase SQL editor. Safe to re-run (create or replace / if not exists).
--
-- HOW THE SERVICE WOULD CALL IT (not wired in yet: needs this migration applied and staged testing first)
--   Immediate (market / marketable) orders: create the order with status 'pending' instead of 'filled', compute the
--   fill price and fees exactly as applyFill() does today (computeFees, slippage, crypto bid/ask), then
--       POST {SUPABASE_URL}/rest/v1/rpc/paper_apply_fill
--       headers: apikey + Authorization: Bearer <service role key>, Content-Type: application/json
--       body: { "p_order_id": "...", "p_fill_price": 123.45, "p_slippage_per_share": 0.02, "p_sec_fee": 0, "p_finra_fee": 0,
--               "p_occ_fee": 0, "p_total_fees": 0, "p_multiplier": 1, "p_fee_into_basis": false }
--   Resting orders: evaluateOrder() finds the trigger price from bars as now and calls the same RPC instead of
--   claimPendingOrder + applyFill. The function returns jsonb:
--       { "applied": true,  "fill_id": "...", "cash_balance": 1234.5, "realized_pnl": null | number, "new_quantity": n }
--       { "applied": false, "reason": "order is filled" }          -- lost the race: treat as "nothing to do"
--   and raises an exception for a funds/holdings failure (message starts "REJECT:"), in which case the transaction
--   is rolled back and the service marks the order rejected (rejectClaimedOrder). After a successful call the service
--   still writes the trade log row (best effort, as today) and cancels OCO siblings.
--   Grant: the function is SECURITY DEFINER and execute is revoked from public; only the service role may call it.

-- 1. One account per session --------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from paper_accounts group by session_id having count(*) > 1) then
    raise notice 'paper_accounts has duplicate session_id rows; merge or delete the extras, then re-run to add the unique index.';
  else
    create unique index if not exists paper_accounts_session_id_key on paper_accounts (session_id);
  end if;
end $$;

-- 2. Sanity constraints (NOT VALID: enforced for new writes; run the VALIDATE lines yourself after cleaning rows) ----
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_side_chk') then
    alter table paper_orders add constraint paper_orders_side_chk check (side in ('buy', 'sell')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_type_chk') then
    alter table paper_orders add constraint paper_orders_type_chk check (order_type in ('market', 'limit', 'stop', 'stop_limit', 'trailing_stop')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paper_orders_quantity_chk') then
    alter table paper_orders add constraint paper_orders_quantity_chk check (quantity > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'paper_accounts_cash_chk') then
    alter table paper_accounts add constraint paper_accounts_cash_chk check (cash_balance >= 0) not valid;
  end if;
end $$;
-- alter table paper_orders   validate constraint paper_orders_side_chk;
-- alter table paper_orders   validate constraint paper_orders_type_chk;
-- alter table paper_orders   validate constraint paper_orders_quantity_chk;
-- alter table paper_accounts validate constraint paper_accounts_cash_chk;   -- fails if any account is already negative (the audit saw -19,881 after a race)

-- 3. Atomic fill ------------------------------------------------------------------------------------------------------
create or replace function public.paper_apply_fill(
  p_order_id uuid,
  p_fill_price numeric,
  p_slippage_per_share numeric default 0,
  p_sec_fee numeric default 0,
  p_finra_fee numeric default 0,
  p_occ_fee numeric default 0,
  p_total_fees numeric default 0,
  p_multiplier integer default 1,          -- 100 for options, 1 otherwise
  p_fee_into_basis boolean default false   -- crypto: the buy-side fee is part of cost basis
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order paper_orders%rowtype;
  v_acct paper_accounts%rowtype;
  v_pos paper_positions%rowtype;
  v_have_pos boolean;
  v_exist_qty numeric := 0;
  v_exist_cost numeric := 0;
  v_new_qty numeric;
  v_new_cost numeric;
  v_realized numeric := null;
  v_gross numeric;
  v_cash_delta numeric;
  v_fill_id uuid;
begin
  if p_fill_price is null or p_fill_price <= 0 or p_fill_price > 10000000 then
    raise exception 'REJECT: invalid fill price %', p_fill_price;
  end if;

  -- Lock order row, then account row, then position row (always this order, so concurrent fills cannot deadlock).
  select * into v_order from paper_orders where id = p_order_id for update;
  if not found then
    raise exception 'REJECT: order % not found', p_order_id;
  end if;
  if v_order.status <> 'pending' then
    return jsonb_build_object('applied', false, 'reason', 'order is ' || v_order.status);
  end if;

  select * into v_acct from paper_accounts where id = v_order.account_id for update;
  select * into v_pos from paper_positions
   where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class
   for update;
  v_have_pos := found;
  if v_have_pos then
    v_exist_qty := v_pos.quantity;
    v_exist_cost := v_pos.avg_cost_basis;
  end if;

  v_gross := v_order.quantity * p_multiplier * p_fill_price;

  if v_order.side = 'buy' then
    v_cash_delta := -(v_gross) - p_total_fees;
    if v_acct.cash_balance + v_cash_delta < 0 then
      raise exception 'REJECT: insufficient cash (needs %, has %)', round(v_gross + p_total_fees, 2), round(v_acct.cash_balance, 2);
    end if;
    if v_exist_qty < 0 then                       -- buy to close a short option position
      v_new_qty := v_exist_qty + v_order.quantity;
      v_realized := (v_exist_cost - p_fill_price) * v_order.quantity * p_multiplier - p_total_fees;
      v_new_cost := v_exist_cost;
    else
      v_new_qty := v_exist_qty + v_order.quantity;
      v_new_cost := (v_exist_qty * v_exist_cost + v_order.quantity * p_fill_price
                     + case when p_fee_into_basis then p_total_fees else 0 end) / v_new_qty;
    end if;
  else
    v_cash_delta := v_gross - p_total_fees;
    if v_exist_qty > 0 then                       -- sell to close a long
      if v_order.quantity > v_exist_qty then
        raise exception 'REJECT: cannot sell % of %, only % held', v_order.quantity, v_order.symbol, v_exist_qty;
      end if;
      v_new_qty := v_exist_qty - v_order.quantity;
      v_realized := (p_fill_price - v_exist_cost) * v_order.quantity * p_multiplier - p_total_fees;
      v_new_cost := v_exist_cost;
    elsif v_order.asset_class = 'option' then     -- sell to open a (collateral-checked upstream) short
      v_new_qty := v_exist_qty - v_order.quantity;
      v_new_cost := (abs(v_exist_qty) * v_exist_cost + v_order.quantity * p_fill_price) / abs(v_new_qty);
    else
      raise exception 'REJECT: cannot sell % % - none held (long-only simulator)', v_order.quantity, v_order.symbol;
    end if;
  end if;

  if v_order.asset_class = 'crypto' then
    v_new_qty := round(v_new_qty, 8);             -- no float dust
  end if;

  if v_new_qty = 0 then
    delete from paper_positions
     where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class;
  elsif v_have_pos then
    update paper_positions set quantity = v_new_qty, avg_cost_basis = v_new_cost
     where account_id = v_order.account_id and symbol = v_order.symbol and asset_class = v_order.asset_class;
  else
    insert into paper_positions (account_id, symbol, asset_class, quantity, avg_cost_basis,
                                 option_right, strike_price, expiration_date, underlying_symbol)
    values (v_order.account_id, v_order.symbol, v_order.asset_class, v_new_qty, v_new_cost,
            v_order.option_right, v_order.strike_price, v_order.expiration_date, v_order.underlying_symbol);
  end if;

  update paper_accounts set cash_balance = cash_balance + v_cash_delta where id = v_order.account_id
  returning * into v_acct;

  insert into paper_fills (order_id, account_id, symbol, side, quantity, fill_price, slippage_per_share,
                           sec_fee, finra_fee, occ_fee, total_fees, realized_pnl,
                           option_right, strike_price, expiration_date, underlying_symbol)
  values (v_order.id, v_order.account_id, v_order.symbol, v_order.side, v_order.quantity, p_fill_price, p_slippage_per_share,
          p_sec_fee, p_finra_fee, p_occ_fee, p_total_fees, v_realized,
          v_order.option_right, v_order.strike_price, v_order.expiration_date, v_order.underlying_symbol)
  returning id into v_fill_id;

  update paper_orders set status = 'filled', filled_at = now() where id = v_order.id;

  return jsonb_build_object('applied', true, 'fill_id', v_fill_id, 'cash_balance', v_acct.cash_balance,
                            'realized_pnl', v_realized, 'new_quantity', v_new_qty);
end;
$$;

revoke all on function public.paper_apply_fill(uuid, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) from public;
revoke all on function public.paper_apply_fill(uuid, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) from anon, authenticated;
grant execute on function public.paper_apply_fill(uuid, numeric, numeric, numeric, numeric, numeric, numeric, integer, boolean) to service_role;
