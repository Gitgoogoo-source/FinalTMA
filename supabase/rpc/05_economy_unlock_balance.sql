-- economy_unlock_balance.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Releases or consumes an active economy.balance_locks row.
-- p_mode = 'release' returns locked funds to available balance.
-- p_mode = 'consume' removes locked funds without returning them, used for escrow consumption.

create or replace function api.economy_unlock_balance(
  p_lock_id uuid,
  p_mode text default 'release',
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
  v_lock economy.balance_locks%rowtype;
  v_available_before numeric(38,0);
  v_available_after numeric(38,0);
  v_locked_before numeric(38,0);
  v_locked_after numeric(38,0);
  v_ledger_id uuid;
  v_existing_ledger economy.currency_ledger%rowtype;
  v_new_lock_status text;
begin
  if p_lock_id is null then
    raise exception 'lock_id is required';
  end if;
  if p_mode not in ('release', 'consume') then
    raise exception 'mode must be release or consume';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing_ledger
    from economy.currency_ledger
    where idempotency_key = p_idempotency_key;

    if v_existing_ledger.id is not null then
      return jsonb_build_object(
        'lock_id', p_lock_id,
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

  select * into v_lock
  from economy.balance_locks
  where id = p_lock_id
  for update;

  if v_lock.id is null then
    raise exception 'balance lock not found';
  end if;
  if v_lock.status <> 'active' then
    raise exception 'balance lock is not active: %', v_lock.status;
  end if;

  select available_amount, locked_amount
    into v_available_before, v_locked_before
  from economy.user_balances
  where user_id = v_lock.user_id and currency_code = v_lock.currency_code
  for update;

  if v_locked_before < v_lock.amount then
    raise exception 'locked balance integrity error: locked %, lock amount %', v_locked_before, v_lock.amount;
  end if;

  if p_mode = 'release' then
    update economy.user_balances
    set available_amount = available_amount + v_lock.amount,
        locked_amount = locked_amount - v_lock.amount,
        total_unlocked = total_unlocked + v_lock.amount,
        updated_at = now()
    where user_id = v_lock.user_id and currency_code = v_lock.currency_code
    returning available_amount, locked_amount into v_available_after, v_locked_after;

    v_new_lock_status := 'released';
  else
    update economy.user_balances
    set locked_amount = locked_amount - v_lock.amount,
        total_spent = total_spent + v_lock.amount,
        updated_at = now()
    where user_id = v_lock.user_id and currency_code = v_lock.currency_code
    returning available_amount, locked_amount into v_available_after, v_locked_after;

    v_new_lock_status := 'consumed';
  end if;

  update economy.balance_locks
  set status = v_new_lock_status,
      released_at = case when p_mode = 'release' then now() else released_at end,
      consumed_at = case when p_mode = 'consume' then now() else consumed_at end,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
  where id = p_lock_id;

  insert into economy.currency_ledger (
    user_id, currency_code, entry_type, amount,
    available_before, available_after, locked_before, locked_after,
    source_type, source_id, idempotency_key, note, metadata
  ) values (
    v_lock.user_id,
    v_lock.currency_code,
    case when p_mode = 'release' then 'unlock' else 'debit' end,
    v_lock.amount,
    v_available_before,
    v_available_after,
    v_locked_before,
    v_locked_after,
    'balance_lock_' || p_mode,
    p_lock_id,
    p_idempotency_key,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'lock_id', p_lock_id,
    'status', v_new_lock_status,
    'ledger_id', v_ledger_id,
    'user_id', v_lock.user_id,
    'currency_code', v_lock.currency_code,
    'amount', v_lock.amount,
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
