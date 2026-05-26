-- economy_lock_balance.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Locks user currency into economy.balance_locks.
-- This is reserved for escrow-like flows. Existing marketplace purchase is instant settlement,
-- but this RPC supports future order reservations, admin holds and refund holds.

create or replace function api.economy_lock_balance(
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_lock_type text,
  p_source_type text,
  p_source_id uuid default null,
  p_expires_at timestamptz default null,
  p_idempotency_key text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text := upper(trim(p_currency_code));
  v_available_before numeric(38,0);
  v_available_after numeric(38,0);
  v_locked_before numeric(38,0);
  v_locked_after numeric(38,0);
  v_lock_id uuid;
  v_ledger_id uuid;
  v_existing_ledger economy.currency_ledger%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if v_currency is null or v_currency = '' then
    raise exception 'currency_code is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'lock amount must be positive';
  end if;
  if p_lock_type not in ('market_buy', 'admin_hold', 'event_hold', 'refund_hold') then
    raise exception 'invalid lock_type: %', p_lock_type;
  end if;

  if p_idempotency_key is not null then
    select * into v_existing_ledger
    from economy.currency_ledger
    where idempotency_key = p_idempotency_key;

    if v_existing_ledger.id is not null then
      select id into v_lock_id
      from economy.balance_locks
      where source_type = p_source_type
        and (p_source_id is null or source_id = p_source_id)
        and user_id = p_user_id
        and currency_code = v_currency
      order by created_at desc
      limit 1;

      return jsonb_build_object(
        'lock_id', v_lock_id,
        'ledger_id', v_existing_ledger.id,
        'available', v_existing_ledger.available_after,
        'locked', v_existing_ledger.locked_after,
        'available_before', v_existing_ledger.available_before,
        'available_after', v_existing_ledger.available_after,
        'locked_before', v_existing_ledger.locked_before,
        'locked_after', v_existing_ledger.locked_after,
        'idempotent', true
      );
    end if;
  end if;

  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, v_currency)
  on conflict (user_id, currency_code) do nothing;

  select available_amount, locked_amount
    into v_available_before, v_locked_before
  from economy.user_balances
  where user_id = p_user_id and currency_code = v_currency
  for update;

  if v_available_before < p_amount then
    raise exception 'insufficient balance to lock: currency %, available %, required %', v_currency, v_available_before, p_amount;
  end if;

  update economy.user_balances
  set available_amount = available_amount - p_amount,
      locked_amount = locked_amount + p_amount,
      total_locked = total_locked + p_amount,
      updated_at = now()
  where user_id = p_user_id and currency_code = v_currency
  returning available_amount, locked_amount into v_available_after, v_locked_after;

  insert into economy.balance_locks (
    user_id, currency_code, amount, lock_type, source_type, source_id, status, expires_at, metadata
  ) values (
    p_user_id, v_currency, p_amount, p_lock_type, p_source_type, p_source_id, 'active', p_expires_at, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_lock_id;

  insert into economy.currency_ledger (
    user_id, currency_code, entry_type, amount,
    available_before, available_after, locked_before, locked_after,
    source_type, source_id, source_ref, idempotency_key, note, metadata
  ) values (
    p_user_id, v_currency, 'lock', p_amount,
    v_available_before, v_available_after, v_locked_before, v_locked_after,
    p_source_type, coalesce(p_source_id, v_lock_id), null, p_idempotency_key, p_note, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'lock_id', v_lock_id,
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'currency_code', v_currency,
    'amount', p_amount,
    'available', v_available_after,
    'locked', v_locked_after,
    'available_before', v_available_before,
    'available_after', v_available_after,
    'locked_before', v_locked_before,
    'locked_after', v_locked_after,
    'idempotent', false
  );
end;
$$;


-- ============================================================
