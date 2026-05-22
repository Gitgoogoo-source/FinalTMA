-- Add before/after balance snapshots to the immutable currency ledger.
-- Existing ledger rows are intentionally not backfilled here; new writes from
-- the balance RPC helpers record both available and locked balances directly.

alter table economy.currency_ledger
  add column if not exists available_before numeric(38,0) check (available_before >= 0),
  add column if not exists locked_before numeric(38,0) check (locked_before >= 0);

comment on column economy.currency_ledger.available_before is 'Available balance immediately before this ledger entry.';
comment on column economy.currency_ledger.available_after is 'Available balance immediately after this ledger entry.';
comment on column economy.currency_ledger.locked_before is 'Locked balance immediately before this ledger entry.';
comment on column economy.currency_ledger.locked_after is 'Locked balance immediately after this ledger entry.';

create or replace function api._credit_balance(
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_source_type text,
  p_source_id uuid default null,
  p_source_ref text default null,
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
  v_available_before numeric(38,0);
  v_available_after numeric(38,0);
  v_locked_before numeric(38,0);
  v_locked_after numeric(38,0);
  v_ledger_id uuid;
  v_existing uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'credit amount must be positive';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from economy.currency_ledger where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('ledger_id', v_existing, 'idempotent', true);
    end if;
  end if;

  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, p_currency_code)
  on conflict (user_id, currency_code) do nothing;

  select available_amount, locked_amount
    into v_available_before, v_locked_before
  from economy.user_balances
  where user_id = p_user_id and currency_code = p_currency_code
  for update;

  update economy.user_balances
  set available_amount = available_amount + p_amount,
      total_earned = total_earned + p_amount,
      updated_at = now()
  where user_id = p_user_id and currency_code = p_currency_code
  returning available_amount, locked_amount into v_available_after, v_locked_after;

  insert into economy.currency_ledger (
    user_id, currency_code, entry_type, amount,
    available_before, available_after, locked_before, locked_after,
    source_type, source_id, source_ref, idempotency_key, note, metadata
  ) values (
    p_user_id, p_currency_code, 'credit', p_amount,
    v_available_before, v_available_after, v_locked_before, v_locked_after,
    p_source_type, p_source_id, p_source_ref, p_idempotency_key, p_note, p_metadata
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'currency_code', p_currency_code,
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

create or replace function api._debit_balance(
  p_user_id uuid,
  p_currency_code text,
  p_amount numeric,
  p_source_type text,
  p_source_id uuid default null,
  p_source_ref text default null,
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
  v_available_before numeric(38,0);
  v_available_after numeric(38,0);
  v_locked_before numeric(38,0);
  v_locked_after numeric(38,0);
  v_ledger_id uuid;
  v_existing uuid;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'debit amount must be positive';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from economy.currency_ledger where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return jsonb_build_object('ledger_id', v_existing, 'idempotent', true);
    end if;
  end if;

  insert into economy.user_balances (user_id, currency_code)
  values (p_user_id, p_currency_code)
  on conflict (user_id, currency_code) do nothing;

  select available_amount, locked_amount
    into v_available_before, v_locked_before
  from economy.user_balances
  where user_id = p_user_id and currency_code = p_currency_code
  for update;

  if v_available_before < p_amount then
    raise exception 'insufficient balance: currency %, available %, required %', p_currency_code, v_available_before, p_amount;
  end if;

  update economy.user_balances
  set available_amount = available_amount - p_amount,
      total_spent = total_spent + p_amount,
      updated_at = now()
  where user_id = p_user_id and currency_code = p_currency_code
  returning available_amount, locked_amount into v_available_after, v_locked_after;

  insert into economy.currency_ledger (
    user_id, currency_code, entry_type, amount,
    available_before, available_after, locked_before, locked_after,
    source_type, source_id, source_ref, idempotency_key, note, metadata
  ) values (
    p_user_id, p_currency_code, 'debit', p_amount,
    v_available_before, v_available_after, v_locked_before, v_locked_after,
    p_source_type, p_source_id, p_source_ref, p_idempotency_key, p_note, p_metadata
  ) returning id into v_ledger_id;

  return jsonb_build_object(
    'ledger_id', v_ledger_id,
    'user_id', p_user_id,
    'currency_code', p_currency_code,
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
