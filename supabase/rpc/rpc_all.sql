-- Combined Supabase RPC SQL for tmaGame.
-- Execute after schema migrations 0001-0019.


-- ============================================================
-- economy_credit.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Public credit RPC plus internal helper used by game RPCs.
-- Credits virtual currency to a user and writes immutable economy.currency_ledger.

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


create or replace function api.economy_credit(
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
begin
  return api._credit_balance(
    p_user_id,
    upper(trim(p_currency_code)),
    p_amount,
    p_source_type,
    p_source_id,
    p_source_ref,
    p_idempotency_key,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;


-- ============================================================
-- economy_debit.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Public debit RPC plus internal helper used by game RPCs.
-- Debits virtual currency from a user and writes immutable economy.currency_ledger.

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


create or replace function api.economy_debit(
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
begin
  return api._debit_balance(
    p_user_id,
    upper(trim(p_currency_code)),
    p_amount,
    p_source_type,
    p_source_id,
    p_source_ref,
    p_idempotency_key,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;


-- ============================================================
-- economy_apply_reward_json.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Applies a JSON reward array to a user.
-- Supported reward element format: {"currency":"KCOIN","amount":500} or {"currency":"FGEMS","amount":50}.
-- Item rewards should be implemented through inventory-specific RPCs, not this currency-only helper.

create or replace function api._apply_reward_json(
  p_user_id uuid,
  p_reward jsonb,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_currency text;
  v_amount numeric(38,0);
  v_results jsonb := '[]'::jsonb;
  v_credit jsonb;
  v_idx integer := 0;
begin
  if p_reward is null or jsonb_typeof(p_reward) <> 'array' then
    return '[]'::jsonb;
  end if;

  for v_item in select * from jsonb_array_elements(p_reward)
  loop
    v_idx := v_idx + 1;
    v_currency := v_item ->> 'currency';
    v_amount := coalesce((v_item ->> 'amount')::numeric, 0);
    if v_currency is not null and v_amount > 0 then
      v_credit := api._credit_balance(
        p_user_id,
        v_currency,
        v_amount,
        p_source_type,
        p_source_id,
        null,
        p_idempotency_prefix || ':' || v_idx::text || ':' || v_currency,
        'reward_json',
        v_item
      );
      v_results := v_results || jsonb_build_array(v_credit);
    end if;
  end loop;

  return v_results;
end;
$$;


create or replace function api.economy_apply_reward_json(
  p_user_id uuid,
  p_reward jsonb,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_prefix text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return api._apply_reward_json(
    p_user_id,
    coalesce(p_reward, '[]'::jsonb),
    p_source_type,
    p_source_id,
    p_idempotency_prefix
  );
end;
$$;


-- ============================================================
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
-- auth_upsert_telegram_user.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.auth_upsert_telegram_user

create or replace function api.auth_upsert_telegram_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_language_code text default null,
  p_is_premium boolean default false,
  p_photo_url text default null,
  p_start_param text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_referrer_id uuid;
  v_invite_code text;
begin
  if p_telegram_user_id is null then
    raise exception 'telegram_user_id is required';
  end if;

  insert into core.users (
    telegram_user_id, username, first_name, last_name, language_code,
    is_premium, photo_url, last_seen_at, last_auth_at, metadata
  ) values (
    p_telegram_user_id, p_username, p_first_name, p_last_name, p_language_code,
    coalesce(p_is_premium, false), p_photo_url, now(), now(), coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (telegram_user_id) do update
  set username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      language_code = excluded.language_code,
      is_premium = excluded.is_premium,
      photo_url = coalesce(excluded.photo_url, core.users.photo_url),
      last_seen_at = now(),
      last_auth_at = now(),
      updated_at = now()
  returning id, invite_code into v_user_id, v_invite_code;

  insert into core.user_profiles (user_id, display_name, avatar_url, selected_language)
  values (
    v_user_id,
    nullif(trim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, '')), ''),
    p_photo_url,
    p_language_code
  )
  on conflict (user_id) do update
  set display_name = coalesce(excluded.display_name, core.user_profiles.display_name),
      avatar_url = coalesce(excluded.avatar_url, core.user_profiles.avatar_url),
      selected_language = coalesce(excluded.selected_language, core.user_profiles.selected_language),
      updated_at = now();

  insert into economy.user_balances (user_id, currency_code)
  values (v_user_id, 'KCOIN'), (v_user_id, 'FGEMS')
  on conflict (user_id, currency_code) do nothing;

  if p_start_param is not null and length(trim(p_start_param)) > 0 then
    select id into v_referrer_id
    from core.users
    where invite_code = upper(trim(p_start_param))
    limit 1;

    if v_referrer_id is not null and v_referrer_id <> v_user_id then
      update core.users
      set referred_by_user_id = coalesce(referred_by_user_id, v_referrer_id),
          updated_at = now()
      where id = v_user_id and referred_by_user_id is null;

      insert into tasks.referrals (inviter_user_id, invitee_user_id, invite_code, status)
      values (v_referrer_id, v_user_id, upper(trim(p_start_param)), 'pending')
      on conflict (invitee_user_id) do nothing;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', v_user_id,
    'telegram_user_id', p_telegram_user_id,
    'invite_code', v_invite_code
  );
end;
$$;


-- ============================================================
-- auth_create_session.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.auth_create_session

create or replace function api.auth_create_session(
  p_user_id uuid,
  p_session_token_hash text,
  p_expires_at timestamptz,
  p_telegram_auth_date timestamptz default null,
  p_init_data_hash text default null,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_device_id text default null,
  p_platform text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  if p_user_id is null or p_session_token_hash is null or p_expires_at is null then
    raise exception 'user_id, token hash and expires_at are required';
  end if;

  insert into core.app_sessions (
    user_id, session_token_hash, expires_at, telegram_auth_date,
    init_data_hash, ip_hash, user_agent, device_id, platform, last_seen_at
  ) values (
    p_user_id, p_session_token_hash, p_expires_at, p_telegram_auth_date,
    p_init_data_hash, p_ip_hash, p_user_agent, p_device_id, p_platform, now()
  ) returning id into v_session_id;

  if p_device_id is not null then
    insert into core.user_devices (user_id, device_key, platform, user_agent, last_seen_at)
    values (p_user_id, p_device_id, p_platform, p_user_agent, now())
    on conflict (user_id, device_key) do update
    set platform = excluded.platform,
        user_agent = excluded.user_agent,
        last_seen_at = now();
  end if;

  return jsonb_build_object('session_id', v_session_id, 'expires_at', p_expires_at);
end;
$$;


-- ============================================================
-- get_user_bootstrap.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.get_user_bootstrap

create or replace function api.get_user_bootstrap(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_balances jsonb;
  v_wallet jsonb;
  v_flags jsonb;
  v_notifications integer;
  v_feature_flags jsonb;
begin
  select jsonb_build_object(
    'id', u.id,
    'telegram_user_id', u.telegram_user_id,
    'username', u.username,
    'first_name', u.first_name,
    'last_name', u.last_name,
    'display_name', p.display_name,
    'avatar_url', coalesce(p.avatar_url, u.photo_url),
    'invite_code', u.invite_code,
    'status', u.status
  ) into v_profile
  from core.users u
  left join core.user_profiles p on p.user_id = u.id
  where u.id = p_user_id;

  if v_profile is null then
    raise exception 'user not found';
  end if;

  select coalesce(jsonb_object_agg(currency_code, jsonb_build_object('available', available_amount, 'locked', locked_amount)), '{}'::jsonb)
  into v_balances
  from economy.user_balances
  where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'chain', chain,
    'network', network,
    'address', address,
    'is_primary', is_primary,
    'status', status,
    'verified_at', verified_at,
    'last_sync_at', last_sync_at
  ) order by is_primary desc, created_at desc), '[]'::jsonb)
  into v_wallet
  from core.user_wallets
  where user_id = p_user_id and status = 'connected';

  select coalesce(jsonb_agg(jsonb_build_object('flag_code', flag_code, 'flag_level', flag_level, 'reason', reason)), '[]'::jsonb)
  into v_flags
  from core.user_flags
  where user_id = p_user_id and active = true and (ends_at is null or ends_at > now());

  select count(*)::integer into v_notifications
  from core.notifications
  where user_id = p_user_id and read_at is null;

  select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb)
  into v_feature_flags
  from ops.feature_flags;

  return jsonb_build_object(
    'profile', v_profile,
    'balances', v_balances,
    'wallets', v_wallet,
    'flags', v_flags,
    'unread_notifications', v_notifications,
    'feature_flags', v_feature_flags,
    'server_time', now()
  );
end;
$$;


-- ============================================================
-- task_daily_check_in.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.task_daily_check_in

create or replace function api.task_daily_check_in(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign tasks.signin_campaigns%rowtype;
  v_existing tasks.user_signins%rowtype;
  v_count integer;
  v_day_index integer;
  v_reward jsonb;
  v_signin_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select * into v_campaign
  from tasks.signin_campaigns
  where active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_campaign.id is null then
    raise exception 'active sign-in campaign not found';
  end if;

  select * into v_existing
  from tasks.user_signins
  where user_id = p_user_id
    and campaign_id = v_campaign.id
    and signin_date = current_date;

  if v_existing.id is not null then
    return jsonb_build_object('signin_id', v_existing.id, 'already_claimed', true, 'day_index', v_existing.day_index, 'reward', v_existing.reward);
  end if;

  select count(*)::integer into v_count
  from tasks.user_signins
  where user_id = p_user_id and campaign_id = v_campaign.id and status = 'claimed';

  v_day_index := least(v_count + 1, v_campaign.cycle_days);

  select reward into v_reward
  from tasks.signin_days
  where campaign_id = v_campaign.id and day_index = v_day_index;

  v_reward := coalesce(v_reward, '[]'::jsonb);

  insert into tasks.user_signins (user_id, campaign_id, day_index, signin_date, reward, status)
  values (p_user_id, v_campaign.id, v_day_index, current_date, v_reward, 'claimed')
  returning id into v_signin_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_reward, 'daily_check_in', v_signin_id, 'daily_check_in:' || v_signin_id::text
  );

  return jsonb_build_object(
    'signin_id', v_signin_id,
    'already_claimed', false,
    'day_index', v_day_index,
    'reward', v_reward,
    'ledger_results', v_rewards_result
  );
end;
$$;


-- ============================================================
-- task_claim_reward.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.task_claim_reward

create or replace function api.task_claim_reward(
  p_user_id uuid,
  p_task_id uuid,
  p_period_key text default 'once'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress tasks.user_task_progress%rowtype;
  v_task tasks.task_definitions%rowtype;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_task_id is null then
    raise exception 'user_id and task_id are required';
  end if;

  select * into v_task from tasks.task_definitions where id = p_task_id and active = true;
  if v_task.id is null then
    raise exception 'task not found';
  end if;

  select * into v_progress
  from tasks.user_task_progress
  where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once')
  for update;

  if v_progress.id is null then
    raise exception 'task progress not found';
  end if;
  if v_progress.status = 'claimed' then
    select id into v_claim_id
    from tasks.task_claims
    where user_id = p_user_id and task_id = p_task_id and period_key = coalesce(p_period_key, 'once');
    return jsonb_build_object('claim_id', v_claim_id, 'status', 'claimed', 'idempotent', true);
  end if;
  if v_progress.status <> 'completed' then
    raise exception 'task is not completed';
  end if;

  insert into tasks.task_claims (user_id, task_id, period_key, reward)
  values (p_user_id, p_task_id, coalesce(p_period_key, 'once'), v_task.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_task.reward, 'task_claim', v_claim_id, 'task_claim:' || v_claim_id::text
  );

  update tasks.user_task_progress
  set status = 'claimed', claimed_at = now(), updated_at = now()
  where id = v_progress.id;

  return jsonb_build_object('claim_id', v_claim_id, 'reward', v_task.reward, 'ledger_results', v_rewards_result);
end;
$$;


-- ============================================================
-- referral_process_first_open.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.referral_process_first_open

create or replace function api.referral_process_first_open(
  p_invitee_user_id uuid,
  p_draw_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_inviter_reward numeric(38,0);
  v_invitee_reward numeric(38,0);
  v_credit_inviter jsonb;
  v_credit_invitee jsonb;
begin
  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status in ('pending', 'qualified')
  for update;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_referral');
  end if;

  select amount into v_inviter_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITER' and active = true;
  select amount into v_invitee_reward from economy.reward_rules where code = 'REFERRAL_FIRST_OPEN_INVITEE' and active = true;
  v_inviter_reward := coalesce(v_inviter_reward, 500);
  v_invitee_reward := coalesce(v_invitee_reward, 500);

  update tasks.referrals
  set status = 'rewarded', first_open_order_id = p_draw_order_id, qualified_at = coalesce(qualified_at, now()), rewarded_at = now(), updated_at = now()
  where id = v_ref.id;

  v_credit_inviter := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_inviter_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:inviter:' || v_ref.id::text,
    'Referral first open inviter reward', jsonb_build_object('invitee_user_id', p_invitee_user_id)
  );

  v_credit_invitee := api._credit_balance(
    v_ref.invitee_user_id, 'KCOIN', v_invitee_reward, 'referral_first_open', v_ref.id, null,
    'referral_first_open:invitee:' || v_ref.id::text,
    'Referral first open invitee reward', jsonb_build_object('inviter_user_id', v_ref.inviter_user_id)
  );

  insert into tasks.referral_rewards (referral_id, user_id, reward_role, currency_code, amount, ledger_id, status)
  values
    (v_ref.id, v_ref.inviter_user_id, 'inviter', 'KCOIN', v_inviter_reward, (v_credit_inviter ->> 'ledger_id')::uuid, 'granted'),
    (v_ref.id, v_ref.invitee_user_id, 'invitee', 'KCOIN', v_invitee_reward, (v_credit_invitee ->> 'ledger_id')::uuid, 'granted')
  on conflict (referral_id, reward_role) do nothing;

  return jsonb_build_object(
    'processed', true,
    'referral_id', v_ref.id,
    'inviter_reward', v_inviter_reward,
    'invitee_reward', v_invitee_reward
  );
end;
$$;


-- ============================================================
-- referral_create_commission.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.referral_create_commission

create or replace function api.referral_create_commission(
  p_invitee_user_id uuid,
  p_source_id uuid,
  p_base_amount_kcoin numeric,
  p_commission_bps integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref tasks.referrals%rowtype;
  v_amount numeric(38,0);
  v_credit jsonb;
  v_commission_id uuid;
  v_existing tasks.referral_commissions%rowtype;
begin
  if p_base_amount_kcoin is null or p_base_amount_kcoin <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'no_base_amount');
  end if;

  select * into v_ref
  from tasks.referrals
  where invitee_user_id = p_invitee_user_id and status = 'rewarded'
  limit 1;

  if v_ref.id is null then
    return jsonb_build_object('processed', false, 'reason', 'no_rewarded_referral');
  end if;

  select * into v_existing
  from tasks.referral_commissions
  where referral_id = v_ref.id
    and source_type = 'gacha_open'
    and source_id = p_source_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'processed', true,
      'commission_id', v_existing.id,
      'amount_kcoin', v_existing.commission_amount_kcoin,
      'idempotent', true
    );
  end if;

  v_amount := floor(p_base_amount_kcoin * coalesce(p_commission_bps, 1000) / 10000);
  if v_amount <= 0 then
    return jsonb_build_object('processed', false, 'reason', 'zero_commission');
  end if;

  insert into tasks.referral_commissions (
    referral_id, inviter_user_id, invitee_user_id, source_type, source_id,
    base_amount_kcoin, commission_bps, commission_amount_kcoin, status
  ) values (
    v_ref.id, v_ref.inviter_user_id, v_ref.invitee_user_id, 'gacha_open', p_source_id,
    p_base_amount_kcoin, coalesce(p_commission_bps, 1000), v_amount, 'pending'
  ) returning id into v_commission_id;

  v_credit := api._credit_balance(
    v_ref.inviter_user_id, 'KCOIN', v_amount, 'referral_commission', v_commission_id, null,
    'referral_commission:' || v_commission_id::text,
    'Referral commission', jsonb_build_object('invitee_user_id', p_invitee_user_id, 'source_id', p_source_id)
  );

  update tasks.referral_commissions
  set ledger_id = (v_credit ->> 'ledger_id')::uuid,
      status = 'granted'
  where id = v_commission_id;

  return jsonb_build_object('processed', true, 'commission_id', v_commission_id, 'amount_kcoin', v_amount, 'idempotent', false);
end;
$$;


-- ============================================================
-- album_claim_milestone.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.album_claim_milestone

create or replace function api.album_claim_milestone(
  p_user_id uuid,
  p_milestone_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone album.milestones%rowtype;
  v_collected_count integer;
  v_claim_id uuid;
  v_rewards_result jsonb;
begin
  if p_user_id is null or p_milestone_id is null then
    raise exception 'user_id and milestone_id are required';
  end if;

  select * into v_milestone
  from album.milestones
  where id = p_milestone_id and active = true;

  if v_milestone.id is null then
    raise exception 'milestone not found';
  end if;

  select id into v_claim_id
  from album.milestone_claims
  where user_id = p_user_id and milestone_id = p_milestone_id;

  if v_claim_id is not null then
    return jsonb_build_object('claim_id', v_claim_id, 'idempotent', true);
  end if;

  select count(*)::integer into v_collected_count
  from album.book_items bi
  join album.user_discoveries ud on ud.template_id = bi.template_id and ud.user_id = p_user_id
  where bi.book_id = v_milestone.book_id;

  if v_collected_count < v_milestone.required_count then
    raise exception 'milestone not reached: collected %, required %', v_collected_count, v_milestone.required_count;
  end if;

  insert into album.milestone_claims (user_id, milestone_id, reward)
  values (p_user_id, p_milestone_id, v_milestone.reward)
  returning id into v_claim_id;

  v_rewards_result := api._apply_reward_json(
    p_user_id, v_milestone.reward, 'album_milestone', v_claim_id, 'album_milestone:' || v_claim_id::text
  );

  return jsonb_build_object(
    'claim_id', v_claim_id,
    'collected_count', v_collected_count,
    'required_count', v_milestone.required_count,
    'reward', v_milestone.reward,
    'ledger_results', v_rewards_result
  );
end;
$$;


-- ============================================================
-- gacha_create_order.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.gacha_create_order

create or replace function api.gacha_create_order(
  p_user_id uuid,
  p_box_id uuid,
  p_quantity integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_pool gacha.drop_pool_versions%rowtype;
  v_unit_price integer;
  v_discount_bps integer;
  v_total_price integer;
  v_draw_order_id uuid := gen_random_uuid();
  v_star_order_id uuid := gen_random_uuid();
  v_payload text;
  v_idempotency_key text;
begin
  if p_user_id is null or p_box_id is null then
    raise exception 'user_id and box_id are required';
  end if;
  if p_quantity not in (1, 10) then
    raise exception 'quantity must be 1 or 10';
  end if;

  v_idempotency_key := nullif(trim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency_key is required';
  end if;

  select * into v_existing_order
  from gacha.draw_orders
  where idempotency_key = v_idempotency_key
  for update;

  if v_existing_order.id is not null then
    if v_existing_order.user_id <> p_user_id
      or v_existing_order.box_id <> p_box_id
      or v_existing_order.quantity <> p_quantity then
      raise exception 'idempotency key conflict';
    end if;

    return jsonb_build_object(
      'draw_order_id', v_existing_order.id,
      'star_order_id', v_existing_order.payment_star_order_id,
      'invoice_payload', v_existing_order.invoice_payload,
      'xtr_amount', v_existing_order.total_price_stars,
      'status', v_existing_order.status,
      'idempotent', true
    );
  end if;

  select * into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if v_box.id is null then
    raise exception 'blind box not found';
  end if;
  if v_box.status <> 'active' then
    raise exception 'blind box is not active: %', v_box.status;
  end if;
  if v_box.starts_at is not null and v_box.starts_at > now() then
    raise exception 'blind box has not started';
  end if;
  if v_box.ends_at is not null and v_box.ends_at <= now() then
    raise exception 'blind box has ended';
  end if;
  if v_box.remaining_stock is not null and v_box.remaining_stock < p_quantity then
    raise exception 'blind box stock is insufficient';
  end if;

  select * into v_pool
  from gacha.drop_pool_versions
  where box_id = p_box_id
    and status = 'active'
    and (effective_from is null or effective_from <= now())
    and (effective_to is null or effective_to > now())
  order by version_no desc
  limit 1;

  if v_pool.id is null then
    raise exception 'active drop pool not found';
  end if;

  select
    coalesce(price_stars_override, v_box.price_stars),
    discount_bps
  into v_unit_price, v_discount_bps
  from gacha.box_price_rules
  where box_id = p_box_id
    and quantity = p_quantity
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  if v_unit_price is null then
    v_unit_price := v_box.price_stars;
    v_discount_bps := case when p_quantity = 10 then 1000 else 0 end;
  end if;

  v_total_price := ceil((v_unit_price * p_quantity)::numeric * (10000 - v_discount_bps)::numeric / 10000)::integer;
  v_payload := 'gacha:' || v_draw_order_id::text;

  insert into payments.star_orders (
    id, user_id, business_type, business_id, status, xtr_amount,
    telegram_invoice_payload, title, description, idempotency_key, expires_at, metadata
  ) values (
    v_star_order_id, p_user_id, 'gacha_open', v_draw_order_id, 'created', v_total_price,
    v_payload, v_box.display_name, 'Open blind box x' || p_quantity::text, v_idempotency_key,
    now() + interval '15 minutes',
    jsonb_build_object('box_id', p_box_id, 'quantity', p_quantity, 'pool_version_id', v_pool.id)
  );

  insert into gacha.draw_orders (
    id, user_id, box_id, pool_version_id, payment_star_order_id, status,
    quantity, unit_price_stars, discount_bps, total_price_stars,
    open_reward_kcoin, invoice_payload, idempotency_key, metadata
  ) values (
    v_draw_order_id, p_user_id, p_box_id, v_pool.id, v_star_order_id, 'invoice_created',
    p_quantity, v_unit_price, v_discount_bps, v_total_price,
    v_box.open_reward_kcoin, v_payload, v_idempotency_key,
    jsonb_build_object('box_slug', v_box.slug, 'box_tier', v_box.tier)
  );

  return jsonb_build_object(
    'draw_order_id', v_draw_order_id,
    'star_order_id', v_star_order_id,
    'invoice_payload', v_payload,
    'xtr_amount', v_total_price,
    'quantity', p_quantity,
    'discount_bps', v_discount_bps,
    'idempotent', false
  );
end;
$$;


-- ============================================================
-- gacha_process_paid_order.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.gacha_process_paid_order

create or replace function api.gacha_process_paid_order(
  p_star_order_id uuid,
  p_telegram_payment_charge_id text,
  p_provider_payment_charge_id text default null,
  p_raw_update jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_star_order payments.star_orders%rowtype;
  v_order gacha.draw_orders%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_draw_i integer;
  v_pity record;
  v_use_pity boolean;
  v_reward record;
  v_total_weight numeric(38,8);
  v_roll numeric(38,8);
  v_form_id uuid;
  v_power integer;
  v_item_id uuid;
  v_should_reset boolean;
  v_reward_kcoin numeric(38,0);
  v_results jsonb;
  v_credit jsonb;
  v_referral_first_open jsonb;
  v_referral_commission jsonb;
begin
  if p_star_order_id is null or p_telegram_payment_charge_id is null then
    raise exception 'star_order_id and telegram_payment_charge_id are required';
  end if;

  select * into v_star_order
  from payments.star_orders
  where id = p_star_order_id
  for update;

  if v_star_order.id is null then
    raise exception 'star order not found';
  end if;

  select * into v_order
  from gacha.draw_orders
  where payment_star_order_id = p_star_order_id
  for update;

  if v_order.id is null then
    raise exception 'draw order not found for star order';
  end if;

  if v_order.status in ('opened', 'completed') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'draw_index', dr.draw_index,
      'template_id', dr.template_id,
      'form_id', dr.form_id,
      'rarity_code', dr.rarity_code,
      'item_instance_id', dr.item_instance_id,
      'was_pity', dr.was_pity
    ) order by dr.draw_index), '[]'::jsonb)
    into v_results
    from gacha.draw_results dr
    where dr.draw_order_id = v_order.id;

    return jsonb_build_object(
      'draw_order_id', v_order.id,
      'status', 'completed',
      'draw_count', v_order.draw_count,
      'quantity', v_order.quantity,
      'results', v_results,
      'idempotent', true
    );
  end if;

  if v_star_order.xtr_amount <> v_order.total_price_stars then
    raise exception 'payment amount mismatch';
  end if;

  insert into payments.star_payments (
    star_order_id, user_id, telegram_payment_charge_id, provider_payment_charge_id,
    xtr_amount, currency, invoice_payload, raw_update
  ) values (
    p_star_order_id, v_order.user_id, p_telegram_payment_charge_id, p_provider_payment_charge_id,
    v_star_order.xtr_amount, 'XTR', v_order.invoice_payload, coalesce(p_raw_update, '{}'::jsonb)
  )
  on conflict (telegram_payment_charge_id) do nothing;

  update payments.star_orders
  set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = p_star_order_id;

  update gacha.draw_orders
  set status = 'opening', paid_at = coalesce(paid_at, now()), updated_at = now()
  where id = v_order.id;

  select * into v_box
  from gacha.blind_boxes
  where id = v_order.box_id
  for update;

  if v_box.remaining_stock is not null and v_box.remaining_stock < v_order.draw_count then
    update gacha.draw_orders set status = 'failed', error_message = 'stock insufficient after payment', updated_at = now() where id = v_order.id;
    raise exception 'blind box stock is insufficient after payment';
  end if;

  if v_box.remaining_stock is not null then
    update gacha.blind_boxes
    set remaining_stock = remaining_stock - v_order.draw_count,
        status = case when remaining_stock - v_order.draw_count <= 0 then 'sold_out' else status end,
        updated_at = now()
    where id = v_box.id;
  end if;

  for v_draw_i in 1..v_order.draw_count loop
    select null::uuid as id into v_reward;
    select null::uuid as id, 0::integer as current_count into v_pity;
    v_use_pity := false;

    select pr.*, coalesce(ups.current_count, 0) as current_count
    into v_pity
    from gacha.pity_rules pr
    left join gacha.user_pity_states ups
      on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
    where pr.box_id = v_order.box_id
      and pr.active = true
      and (pr.pool_version_id is null or pr.pool_version_id = v_order.pool_version_id)
    order by pr.priority asc, pr.created_at asc
    limit 1;

    if v_pity.id is not null then
      insert into gacha.user_pity_states (user_id, box_id, pity_rule_id, current_count, total_draws)
      values (v_order.user_id, v_order.box_id, v_pity.id, 0, 0)
      on conflict (user_id, box_id, pity_rule_id) do nothing;

      select pr.*, ups.current_count
      into v_pity
      from gacha.pity_rules pr
      join gacha.user_pity_states ups
        on ups.pity_rule_id = pr.id and ups.user_id = v_order.user_id and ups.box_id = v_order.box_id
      where pr.id = v_pity.id
      for update of ups;

      v_use_pity := (v_pity.current_count + 1 >= v_pity.threshold);
    end if;

    if v_use_pity and v_pity.guaranteed_template_id is not null then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = v_order.pool_version_id
        and dpi.template_id = v_pity.guaranteed_template_id
        and (v_pity.guaranteed_form_id is null or dpi.form_id = v_pity.guaranteed_form_id)
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by dpi.sort_order asc, random()
      limit 1;
    elsif v_use_pity then
      select dpi.* into v_reward
      from gacha.drop_pool_items dpi
      join catalog.rarities rr on rr.code = dpi.rarity_code
      join catalog.rarities target on target.code = v_pity.target_rarity_code
      where dpi.pool_version_id = v_order.pool_version_id
        and dpi.is_pity_eligible = true
        and rr.sort_order >= target.sort_order
        and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      order by rr.sort_order desc, dpi.drop_weight desc, random()
      limit 1;
    end if;

    if v_reward.id is null then
      select coalesce(sum(drop_weight), 0) into v_total_weight
      from gacha.drop_pool_items
      where pool_version_id = v_order.pool_version_id
        and (stock_remaining is null or stock_remaining > 0);

      if v_total_weight <= 0 then
        raise exception 'drop pool has no available rewards';
      end if;

      v_roll := (random()::numeric * v_total_weight);

      select x.* into v_reward
      from (
        select dpi.*,
               sum(dpi.drop_weight) over (order by dpi.sort_order asc, dpi.id asc) as running_weight
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = v_order.pool_version_id
          and (dpi.stock_remaining is null or dpi.stock_remaining > 0)
      ) x
      where x.running_weight >= v_roll
      order by x.running_weight asc
      limit 1;
    else
      v_roll := null;
    end if;

    if v_reward.id is null then
      raise exception 'failed to select reward';
    end if;

    if v_reward.stock_remaining is not null then
      update gacha.drop_pool_items
      set stock_remaining = stock_remaining - 1,
          updated_at = now()
      where id = v_reward.id and stock_remaining > 0;
    end if;

    v_form_id := v_reward.form_id;
    if v_form_id is null then
      select id into v_form_id
      from catalog.collectible_forms
      where template_id = v_reward.template_id
      order by is_default desc, form_index asc
      limit 1;
    end if;

    select ct.base_power + coalesce(cf.base_power_bonus, 0)
    into v_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_form_id
    where ct.id = v_reward.template_id;

    insert into inventory.item_instances (
      owner_user_id, template_id, form_id, level, power, status,
      source_type, source_id, metadata
    ) values (
      v_order.user_id, v_reward.template_id, v_form_id, 1, coalesce(v_power, 0), 'available',
      'gacha', v_order.id,
      jsonb_build_object('box_id', v_order.box_id, 'draw_order_id', v_order.id, 'drop_pool_item_id', v_reward.id)
    ) returning id into v_item_id;

    insert into inventory.item_instance_events (
      item_instance_id, user_id, event_type, source_type, source_id, after_state
    ) values (
      v_item_id, v_order.user_id, 'obtained_from_gacha', 'gacha', v_order.id,
      jsonb_build_object('template_id', v_reward.template_id, 'form_id', v_form_id, 'rarity_code', v_reward.rarity_code)
    );

    insert into album.user_discoveries (
      user_id, template_id, first_item_instance_id, first_source_type, first_source_id
    ) values (
      v_order.user_id, v_reward.template_id, v_item_id, 'gacha', v_order.id
    ) on conflict (user_id, template_id) do nothing;

    insert into gacha.draw_results (
      draw_order_id, user_id, box_id, pool_version_id, draw_index,
      drop_pool_item_id, item_instance_id, template_id, form_id, rarity_code,
      was_pity, random_roll, metadata
    ) values (
      v_order.id, v_order.user_id, v_order.box_id, v_order.pool_version_id, v_draw_i,
      v_reward.id, v_item_id, v_reward.template_id, v_form_id, v_reward.rarity_code,
      v_use_pity, v_roll,
      jsonb_build_object('serial_item_id', v_item_id)
    );

    if v_pity.id is not null then
      select exists (
        select 1
        from catalog.rarities got
        join catalog.rarities target on target.code = coalesce(v_pity.reset_on_rarity_code, v_pity.target_rarity_code)
        where got.code = v_reward.rarity_code and got.sort_order >= target.sort_order
      ) into v_should_reset;

      update gacha.user_pity_states
      set current_count = case when v_should_reset then 0 else current_count + 1 end,
          total_draws = total_draws + 1,
          last_hit_at = case when v_should_reset then now() else last_hit_at end,
          updated_at = now()
      where user_id = v_order.user_id and box_id = v_order.box_id and pity_rule_id = v_pity.id;
    end if;
  end loop;

  v_reward_kcoin := v_order.open_reward_kcoin * v_order.draw_count;
  if v_reward_kcoin > 0 then
    v_credit := api._credit_balance(
      v_order.user_id,
      'KCOIN',
      v_reward_kcoin,
      'open_box_rebate',
      v_order.id,
      null,
      'open_box_rebate:' || v_order.id::text,
      'Open box rebate',
      jsonb_build_object('draw_order_id', v_order.id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity)
    );
  end if;

  -- Referral growth rules:
  -- 1. If this is the invitee's first qualified paid open, grant both sides the first-open reward.
  -- 2. If the referral is already rewarded, grant inviter 10% commission based on the K-coin open reward.
  v_referral_first_open := api.referral_process_first_open(v_order.user_id, v_order.id);
  if v_reward_kcoin > 0 then
    v_referral_commission := api.referral_create_commission(v_order.user_id, v_order.id, v_reward_kcoin, 1000);
  end if;

  insert into gacha.draw_audit (draw_order_id, user_id, pool_version_id, rules_snapshot)
  values (
    v_order.id,
    v_order.user_id,
    v_order.pool_version_id,
    jsonb_build_object('box_id', v_order.box_id, 'draw_count', v_order.draw_count, 'quantity', v_order.quantity, 'open_reward_kcoin', v_order.open_reward_kcoin)
  );

  update gacha.draw_orders
  set status = 'completed', opened_at = now(), updated_at = now()
  where id = v_order.id;

  update payments.star_orders
  set status = 'fulfilled', fulfilled_at = now(), updated_at = now()
  where id = p_star_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'template_id', dr.template_id,
    'form_id', dr.form_id,
    'rarity_code', dr.rarity_code,
    'item_instance_id', dr.item_instance_id,
    'was_pity', dr.was_pity
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  where dr.draw_order_id = v_order.id;

  return jsonb_build_object(
    'draw_order_id', v_order.id,
    'status', 'completed',
    'draw_count', v_order.draw_count,
    'quantity', v_order.quantity,
    'results', v_results,
    'kcoin_reward', v_reward_kcoin,
    'kcoin_ledger', v_credit,
    'referral_first_open', coalesce(v_referral_first_open, '{}'::jsonb),
    'referral_commission', coalesce(v_referral_commission, '{}'::jsonb)
  );
end;
$$;


-- ============================================================
-- gacha_get_draw_result.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Returns a user's draw order and detailed draw results for result pages and history.
-- This function never creates rewards. It only reads results already produced by gacha_process_paid_order.

create or replace function api.gacha_get_draw_result(
  p_user_id uuid,
  p_draw_order_id uuid default null,
  p_invoice_payload text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_results jsonb;
  v_box jsonb;
  v_payment jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_draw_order_id is null and (p_invoice_payload is null or length(trim(p_invoice_payload)) = 0) then
    raise exception 'draw_order_id or invoice_payload is required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where user_id = p_user_id
    and (
      (p_draw_order_id is not null and id = p_draw_order_id)
      or
      (p_invoice_payload is not null and invoice_payload = p_invoice_payload)
    )
  limit 1;

  if v_order.id is null then
    raise exception 'draw order not found';
  end if;

  select jsonb_build_object(
    'id', b.id,
    'slug', b.slug,
    'display_name', b.display_name,
    'tier', b.tier,
    'cover_image_url', b.cover_image_url,
    'hero_image_url', b.hero_image_url
  ) into v_box
  from gacha.blind_boxes b
  where b.id = v_order.box_id;

  select jsonb_build_object(
    'star_order_id', so.id,
    'status', so.status,
    'xtr_amount', so.xtr_amount,
    'paid_at', so.paid_at,
    'fulfilled_at', so.fulfilled_at
  ) into v_payment
  from payments.star_orders so
  where so.id = v_order.payment_star_order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'draw_index', dr.draw_index,
    'was_pity', dr.was_pity,
    'random_roll', dr.random_roll,
    'item_instance_id', dr.item_instance_id,
    'template_id', dr.template_id,
    'template_slug', ct.slug,
    'display_name', ct.display_name,
    'subtitle', ct.subtitle,
    'description', ct.description,
    'rarity_code', dr.rarity_code,
    'rarity_display_name', r.display_name,
    'type_code', ct.type_code,
    'form_id', dr.form_id,
    'form_index', cf.form_index,
    'form_name', cf.display_name,
    'serial_no', ii.serial_no,
    'level', ii.level,
    'power', ii.power,
    'image_url', coalesce(cf.image_url, cm_hero.url, cm_card.url),
    'thumbnail_url', coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url),
    'avatar_url', coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url)
  ) order by dr.draw_index), '[]'::jsonb)
  into v_results
  from gacha.draw_results dr
  join catalog.collectible_templates ct on ct.id = dr.template_id
  join catalog.rarities r on r.code = dr.rarity_code
  left join catalog.collectible_forms cf on cf.id = dr.form_id
  left join inventory.item_instances ii on ii.id = dr.item_instance_id
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'hero'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_hero on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'card'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_card on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'thumb'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_thumb on true
  left join lateral (
    select url from catalog.collectible_media m
    where m.template_id = ct.id and (m.form_id is null or m.form_id = dr.form_id) and m.media_type = 'avatar'
    order by m.form_id nulls last, m.sort_order asc limit 1
  ) cm_avatar on true
  where dr.draw_order_id = v_order.id;

  return jsonb_build_object(
    'draw_order_id', v_order.id,
    'status', case when v_order.status = 'opened' then 'completed' else v_order.status end,
    'draw_count', v_order.draw_count,
    'quantity', v_order.quantity,
    'unit_price_stars', v_order.unit_price_stars,
    'discount_bps', v_order.discount_bps,
    'total_price_stars', v_order.total_price_stars,
    'open_reward_kcoin', v_order.open_reward_kcoin,
    'invoice_payload', v_order.invoice_payload,
    'paid_at', v_order.paid_at,
    'opened_at', v_order.opened_at,
    'completed_at', v_order.opened_at,
    'box', v_box,
    'payment', v_payment,
    'results', v_results,
    'server_time', now()
  );
end;
$$;


-- ============================================================
-- gacha_process_dev_paid_order.sql
-- ============================================================
-- First-stage DEV payment helper. It verifies order ownership by
-- order_id + user_id, then reuses the formal paid-order fulfillment RPC.

create or replace function api.gacha_process_dev_paid_order(
  p_order_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order gacha.draw_orders%rowtype;
  v_result jsonb;
begin
  if p_order_id is null or p_user_id is null then
    raise exception 'order_id and user_id are required';
  end if;

  select * into v_order
  from gacha.draw_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'draw order not found';
  end if;
  if v_order.user_id <> p_user_id then
    raise exception 'draw order does not belong to user';
  end if;
  if v_order.payment_star_order_id is null then
    raise exception 'draw order has no linked star order';
  end if;

  v_result := api.gacha_process_paid_order(
    v_order.payment_star_order_id,
    'dev:' || v_order.id::text,
    'dev-paid',
    jsonb_build_object(
      'mode', 'DEV_PAID',
      'draw_order_id', v_order.id,
      'user_id', p_user_id
    )
  );

  return v_result || jsonb_build_object(
    'payment_mode', 'DEV_PAID',
    'payment_status', 'dev_paid'
  );
end;
$$;


-- ============================================================
-- inventory_list_user_items.sql
-- ============================================================
-- Lists the current user's inventory items for the first-stage collection page.
-- Defaults to available items only, while allowing backend callers to request
-- explicit status sets for debugging or later UI states.

create or replace function api.inventory_list_user_items(
  p_user_id uuid,
  p_statuses text[] default array['available']::text[],
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statuses text[] := coalesce(nullif(p_statuses, array[]::text[]), array['available']::text[]);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with filtered as (
    select ii.id
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = any(v_statuses)
  )
  select count(*)::integer into v_total
  from filtered;

  with filtered as (
    select
      ii.id,
      ii.template_id,
      ii.form_id,
      ii.serial_no,
      ii.level,
      ii.power,
      ii.status,
      ii.nft_mint_status,
      ii.source_type,
      ii.source_id,
      ii.acquired_at,
      ct.slug as template_slug,
      ct.display_name,
      ct.subtitle,
      ct.description,
      ct.rarity_code,
      ct.type_code,
      ct.tradeable,
      ct.upgradeable,
      ct.evolvable,
      ct.decomposable,
      ct.nft_mintable,
      r.display_name as rarity_display_name,
      r.sort_order as rarity_sort_order,
      s.id as series_id,
      s.slug as series_slug,
      s.display_name as series_display_name,
      cf.form_index,
      cf.display_name as form_display_name,
      coalesce(cf.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as image_url,
      coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url) as thumbnail_url,
      coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url, cm_card.url) as avatar_url
    from inventory.item_instances ii
    join catalog.collectible_templates ct on ct.id = ii.template_id
    join catalog.rarities r on r.code = ct.rarity_code
    left join catalog.series s on s.id = ct.series_id
    left join catalog.collectible_forms cf on cf.id = ii.form_id
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'card'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_card on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'hero'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_hero on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'thumb'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_thumb on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'avatar'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_avatar on true
    where ii.owner_user_id = p_user_id
      and ii.status = any(v_statuses)
    order by ii.acquired_at desc, ii.serial_no desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_instance_id', id,
    'template_id', template_id,
    'template_slug', template_slug,
    'name', display_name,
    'subtitle', subtitle,
    'description', description,
    'rarity', jsonb_build_object(
      'code', rarity_code,
      'display_name', rarity_display_name,
      'sort_order', rarity_sort_order
    ),
    'series', jsonb_build_object(
      'id', series_id,
      'slug', series_slug,
      'display_name', series_display_name
    ),
    'form', jsonb_build_object(
      'id', form_id,
      'index', form_index,
      'display_name', form_display_name
    ),
    'type_code', type_code,
    'serial_no', serial_no,
    'level', level,
    'power', power,
    'status', status,
    'nft_mint_status', nft_mint_status,
    'image_url', image_url,
    'thumbnail_url', thumbnail_url,
    'avatar_url', avatar_url,
    'tradeable', tradeable,
    'upgradeable', upgradeable,
    'evolvable', evolvable,
    'decomposable', decomposable,
    'nft_mintable', nft_mintable,
    'source_type', source_type,
    'source_id', source_id,
    'obtained_at', acquired_at
  ) order by acquired_at desc, serial_no desc), '[]'::jsonb)
  into v_items
  from filtered;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'statuses', v_statuses,
    'server_time', now()
  );
end;
$$;


-- ============================================================
-- market_create_listing.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_create_listing

create or replace function api.market_create_listing(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_rarity_code text;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_fee_bps integer;
  v_fee_amount numeric(38,0);
  v_expected_net numeric(38,0);
  v_listing_id uuid := gen_random_uuid();
  v_existing market.listings%rowtype;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_item_instance_ids is null or cardinality(p_item_instance_ids) = 0 then
    raise exception 'item_instance_ids are required';
  end if;
  if p_unit_price_kcoin is null or p_unit_price_kcoin <= 0 then
    raise exception 'unit price must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select l.* into v_existing
  from market.listings l
  join market.listing_events e on e.listing_id = l.id
  where e.metadata ->> 'idempotency_key' = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object('listing_id', v_existing.id, 'status', v_existing.status, 'idempotent', true);
  end if;

  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> cardinality(p_item_instance_ids) then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    (array_agg(distinct t.rarity_code))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (where ii.owner_user_id <> p_user_id or ii.status <> 'available' or t.tradeable = false)::integer
  into v_item_count, v_template_id, v_form_id, v_rarity_code, v_distinct_templates, v_distinct_forms, v_bad_count
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_item_count <> cardinality(p_item_instance_ids) then
    raise exception 'some items do not exist';
  end if;
  if v_bad_count > 0 then
    raise exception 'some items are not sellable';
  end if;
  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'one listing must contain the same collectible and form';
  end if;

  select fee_bps into v_fee_bps
  from economy.fee_rules
  where code = 'MARKET_SELL_FEE' and active = true
  order by created_at desc
  limit 1;
  v_fee_bps := coalesce(v_fee_bps, 500);
  v_fee_amount := floor((p_unit_price_kcoin * v_item_count) * v_fee_bps / 10000);
  v_expected_net := (p_unit_price_kcoin * v_item_count) - v_fee_amount;

  insert into market.listings (
    id, seller_user_id, template_id, form_id, rarity_code, status,
    item_count, remaining_count, unit_price_kcoin, fee_bps, expected_net_amount,
    price_health, last_price_changed_at
  ) values (
    v_listing_id, p_user_id, v_template_id, v_form_id, v_rarity_code, 'active',
    v_item_count, v_item_count, p_unit_price_kcoin, v_fee_bps, v_expected_net,
    'unknown', now()
  );

  insert into market.listing_items (listing_id, item_instance_id, status)
  select v_listing_id, x.id, 'reserved'
  from unnest(p_item_instance_ids) as x(id);

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  select x.id, p_user_id, 'market_listing', 'market_listing', v_listing_id
  from unnest(p_item_instance_ids) as x(id);

  update inventory.item_instances
  set status = 'listed', updated_at = now(), lock_version = lock_version + 1
  where id = any(p_item_instance_ids);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_user_id, 'listed', 'market_listing', v_listing_id,
         jsonb_build_object('listing_id', v_listing_id, 'unit_price_kcoin', p_unit_price_kcoin)
  from unnest(p_item_instance_ids) as x(id);

  insert into market.listing_events (listing_id, user_id, event_type, after_state, metadata)
  values (
    v_listing_id, p_user_id, 'created',
    jsonb_build_object('unit_price_kcoin', p_unit_price_kcoin, 'item_count', v_item_count),
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  return jsonb_build_object(
    'listing_id', v_listing_id,
    'status', 'active',
    'item_count', v_item_count,
    'unit_price_kcoin', p_unit_price_kcoin,
    'fee_bps', v_fee_bps,
    'expected_net_amount', v_expected_net,
    'idempotent', false
  );
end;
$$;


-- ============================================================
-- market_buy_listing.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_buy_listing

create or replace function api.market_buy_listing(
  p_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order market.orders%rowtype;
  v_listing market.listings%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_listing_item_ids uuid[];
  v_item_ids uuid[];
  v_total numeric(38,0);
  v_fee numeric(38,0);
  v_net numeric(38,0);
  v_debit jsonb;
  v_credit jsonb;
begin
  if p_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  select * into v_existing_order
  from market.orders
  where idempotency_key = p_idempotency_key;

  if v_existing_order.id is not null then
    return jsonb_build_object('order_id', v_existing_order.id, 'status', v_existing_order.status, 'idempotent', true);
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.status not in ('active', 'partially_sold') or v_listing.remaining_count < p_quantity then
    raise exception 'listing is not available';
  end if;
  if v_listing.seller_user_id = p_user_id then
    raise exception 'buyer cannot buy own listing';
  end if;

  select array_agg(id), array_agg(item_instance_id)
  into v_listing_item_ids, v_item_ids
  from (
    select id, item_instance_id
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    order by created_at asc
    limit p_quantity
    for update
  ) s;

  if v_item_ids is null or cardinality(v_item_ids) <> p_quantity then
    raise exception 'not enough reserved items in listing';
  end if;

  v_total := v_listing.unit_price_kcoin * p_quantity;
  v_fee := floor(v_total * v_listing.fee_bps / 10000);
  v_net := v_total - v_fee;

  v_debit := api._debit_balance(
    p_user_id, 'KCOIN', v_total, 'market_buy', v_order_id, null,
    'market_buy:buyer:' || v_order_id::text, 'Buy market listing',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity)
  );

  insert into market.orders (
    id, buyer_user_id, seller_user_id, listing_id, status,
    item_count, unit_price_kcoin, total_price_kcoin, fee_bps,
    fee_amount_kcoin, seller_net_amount_kcoin, buyer_ledger_id,
    idempotency_key, completed_at
  ) values (
    v_order_id, p_user_id, v_listing.seller_user_id, p_listing_id, 'completed',
    p_quantity, v_listing.unit_price_kcoin, v_total, v_listing.fee_bps,
    v_fee, v_net, (v_debit ->> 'ledger_id')::uuid,
    p_idempotency_key, now()
  );

  v_credit := api._credit_balance(
    v_listing.seller_user_id, 'KCOIN', v_net, 'market_sell', v_order_id, null,
    'market_sell:seller:' || v_order_id::text, 'Marketplace sale proceeds',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity, 'fee_amount_kcoin', v_fee)
  );

  update market.orders
  set seller_ledger_id = (v_credit ->> 'ledger_id')::uuid,
      updated_at = now()
  where id = v_order_id;

  insert into market.order_items (order_id, listing_item_id, item_instance_id)
  select v_order_id, li.id, li.item_instance_id
  from market.listing_items li
  where li.id = any(v_listing_item_ids);

  update market.listing_items
  set status = 'sold', buyer_user_id = p_user_id, sold_order_id = v_order_id, sold_at = now()
  where id = any(v_listing_item_ids);

  update inventory.item_instances
  set owner_user_id = p_user_id,
      status = 'available',
      updated_at = now(),
      lock_version = lock_version + 1
  where id = any(v_item_ids);

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = any(v_item_ids)
    and source_type = 'market_listing'
    and source_id = p_listing_id
    and status = 'active';

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_user_id, 'bought', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id)
  from unnest(v_item_ids) as x(id);

  update market.listings
  set remaining_count = remaining_count - p_quantity,
      status = case when remaining_count - p_quantity <= 0 then 'sold' else 'partially_sold' end,
      updated_at = now()
  where id = p_listing_id;

  insert into market.fee_settlements (market_order_id, currency_code, fee_amount, fee_bps, status, settled_at)
  values (v_order_id, 'KCOIN', v_fee, v_listing.fee_bps, 'settled', now());

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id,
    case when v_listing.remaining_count - p_quantity <= 0 then 'sold' else 'partially_sold' end,
    jsonb_build_object('remaining_count', v_listing.remaining_count),
    jsonb_build_object('remaining_count', v_listing.remaining_count - p_quantity, 'order_id', v_order_id)
  );

  return jsonb_build_object(
    'order_id', v_order_id,
    'listing_id', p_listing_id,
    'item_instance_ids', to_jsonb(v_item_ids),
    'total_price_kcoin', v_total,
    'fee_amount_kcoin', v_fee,
    'seller_net_amount_kcoin', v_net,
    'idempotent', false
  );
end;
$$;


-- ============================================================
-- market_update_listing_price.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_update_listing_price

create or replace function api.market_update_listing_price(
  p_user_id uuid,
  p_listing_id uuid,
  p_new_unit_price_kcoin numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_fee numeric(38,0);
  v_net numeric(38,0);
begin
  if p_new_unit_price_kcoin is null or p_new_unit_price_kcoin <= 0 then
    raise exception 'new price must be positive';
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.seller_user_id <> p_user_id then
    raise exception 'not listing owner';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing is not editable';
  end if;

  v_fee := floor((p_new_unit_price_kcoin * v_listing.remaining_count) * v_listing.fee_bps / 10000);
  v_net := (p_new_unit_price_kcoin * v_listing.remaining_count) - v_fee;

  update market.listings
  set unit_price_kcoin = p_new_unit_price_kcoin,
      expected_net_amount = v_net,
      last_price_changed_at = now(),
      updated_at = now()
  where id = p_listing_id;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id, 'price_changed',
    jsonb_build_object('unit_price_kcoin', v_listing.unit_price_kcoin),
    jsonb_build_object('unit_price_kcoin', p_new_unit_price_kcoin)
  );

  return jsonb_build_object('listing_id', p_listing_id, 'unit_price_kcoin', p_new_unit_price_kcoin, 'expected_net_amount', v_net);
end;
$$;


-- ============================================================
-- market_cancel_listing.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.market_cancel_listing

create or replace function api.market_cancel_listing(
  p_user_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_item_ids uuid[];
begin
  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.seller_user_id <> p_user_id then
    raise exception 'not listing owner';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing cannot be cancelled';
  end if;

  select array_agg(item_instance_id)
  into v_item_ids
  from (
    select item_instance_id
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    for update
  ) s;

  update market.listings
  set status = 'cancelled', remaining_count = 0, updated_at = now()
  where id = p_listing_id;

  update market.listing_items
  set status = 'cancelled'
  where listing_id = p_listing_id and status = 'reserved';

  if v_item_ids is not null then
    update inventory.item_instances
    set status = 'available', updated_at = now(), lock_version = lock_version + 1
    where id = any(v_item_ids);

    update inventory.inventory_locks
    set status = 'released', released_at = now(), updated_at = now()
    where item_instance_id = any(v_item_ids)
      and source_type = 'market_listing'
      and source_id = p_listing_id
      and status = 'active';

    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    select x.id, p_user_id, 'delisted', 'market_listing', p_listing_id,
           jsonb_build_object('listing_id', p_listing_id)
    from unnest(v_item_ids) as x(id);
  end if;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state)
  values (
    p_listing_id, p_user_id, 'cancelled',
    jsonb_build_object('status', v_listing.status, 'remaining_count', v_listing.remaining_count),
    jsonb_build_object('status', 'cancelled', 'remaining_count', 0)
  );

  return jsonb_build_object('listing_id', p_listing_id, 'status', 'cancelled', 'released_item_ids', coalesce(to_jsonb(v_item_ids), '[]'::jsonb));
end;
$$;


-- ============================================================
-- inventory_upgrade_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_upgrade_item

create or replace function api.inventory_upgrade_item(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_form catalog.collectible_forms%rowtype;
  v_rule inventory.upgrade_rules%rowtype;
  v_debit jsonb;
  v_new_level integer;
  v_new_power integer;
  v_log_id uuid;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.upgradeable then
    raise exception 'item is not upgradeable';
  end if;
  if v_item.level >= v_template.max_level then
    raise exception 'item already at max level';
  end if;

  select * into v_form from catalog.collectible_forms where id = v_item.form_id;

  select * into v_rule
  from inventory.upgrade_rules
  where rarity_code = v_template.rarity_code
    and form_index = coalesce(v_form.form_index, 1)
    and from_level = v_item.level
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'upgrade rule not found';
  end if;

  v_debit := api._debit_balance(
    p_user_id, 'FGEMS', v_rule.cost_fgems, 'inventory_upgrade', p_item_instance_id, null,
    coalesce(p_idempotency_key, 'inventory_upgrade:' || p_item_instance_id::text || ':' || v_item.level::text),
    'Upgrade collectible',
    jsonb_build_object('item_instance_id', p_item_instance_id, 'from_level', v_item.level, 'to_level', v_rule.to_level)
  );

  v_new_level := v_rule.to_level;
  v_new_power := v_item.power + v_rule.power_gain;

  update inventory.item_instances
  set level = v_new_level,
      power = v_new_power,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = p_item_instance_id;

  insert into inventory.upgrade_logs (
    user_id, item_instance_id, rule_id, from_level, to_level,
    from_power, to_power, cost_fgems, ledger_id
  ) values (
    p_user_id, p_item_instance_id, v_rule.id, v_item.level, v_new_level,
    v_item.power, v_new_power, v_rule.cost_fgems, (v_debit ->> 'ledger_id')::uuid
  ) returning id into v_log_id;

  insert into inventory.item_instance_events (
    item_instance_id, user_id, event_type, source_type, source_id, before_state, after_state
  ) values (
    p_item_instance_id, p_user_id, 'upgraded', 'inventory_upgrade', v_log_id,
    jsonb_build_object('level', v_item.level, 'power', v_item.power),
    jsonb_build_object('level', v_new_level, 'power', v_new_power)
  );

  return jsonb_build_object(
    'item_instance_id', p_item_instance_id,
    'from_level', v_item.level,
    'to_level', v_new_level,
    'from_power', v_item.power,
    'to_power', v_new_power,
    'cost_fgems', v_rule.cost_fgems
  );
end;
$$;


-- ============================================================
-- inventory_evolve_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_evolve_item

create or replace function api.inventory_evolve_item(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_rule inventory.evolution_rules%rowtype;
  v_main_item_id uuid;
  v_max_level integer;
  v_max_power integer;
  v_roll integer;
  v_success boolean;
  v_debit jsonb;
  v_attempt_id uuid;
  v_result_item_id uuid;
  v_result_power integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_item_instance_ids is null or cardinality(p_item_instance_ids) <> 3 then
    raise exception 'exactly three item ids are required';
  end if;
  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> 3 then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1 from inventory.item_instances where id = any(p_item_instance_ids) for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (where ii.owner_user_id <> p_user_id or ii.status <> 'available' or t.evolvable = false)::integer,
    max(ii.level)::integer,
    max(ii.power)::integer
  into v_count, v_template_id, v_form_id, v_distinct_templates, v_distinct_forms, v_bad_count, v_max_level, v_max_power
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_count <> 3 then
    raise exception 'some items do not exist';
  end if;
  if v_bad_count > 0 then
    raise exception 'some items are not evolvable or not available';
  end if;
  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'evolution requires three copies of the same collectible and form';
  end if;
  if v_form_id is null then
    raise exception 'source form is required for evolution';
  end if;

  select * into v_rule
  from inventory.evolution_rules
  where from_template_id = v_template_id
    and from_form_id = v_form_id
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'evolution rule not found';
  end if;

  select id into v_main_item_id
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  order by level desc, power desc, acquired_at asc
  limit 1;

  v_debit := api._debit_balance(
    p_user_id, 'KCOIN', v_rule.cost_kcoin, 'inventory_evolution', v_rule.id, null,
    coalesce(p_idempotency_key, 'inventory_evolution:' || array_to_string(p_item_instance_ids, ',')),
    'Evolve collectible',
    jsonb_build_object('item_instance_ids', p_item_instance_ids, 'rule_id', v_rule.id)
  );

  v_roll := floor(random() * 10000)::integer + 1;
  v_success := v_roll <= v_rule.success_rate_bps;

  if v_success then
    select ct.base_power + coalesce(cf.base_power_bonus, 0) + greatest(v_max_level - 1, 0)
    into v_result_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_rule.to_form_id
    where ct.id = v_rule.to_template_id;

    update inventory.item_instances
    set status = 'consumed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
    where id = any(p_item_instance_ids);

    insert into inventory.item_instances (
      owner_user_id, template_id, form_id, level, power, status, source_type, source_id, metadata
    ) values (
      p_user_id, v_rule.to_template_id, v_rule.to_form_id, greatest(v_max_level, 1), coalesce(v_result_power, v_max_power),
      'available', 'evolution', v_rule.id,
      jsonb_build_object('source_item_instance_ids', p_item_instance_ids, 'main_item_instance_id', v_main_item_id)
    ) returning id into v_result_item_id;

    insert into album.user_discoveries (user_id, template_id, first_item_instance_id, first_source_type, first_source_id)
    values (p_user_id, v_rule.to_template_id, v_result_item_id, 'evolution', v_rule.id)
    on conflict (user_id, template_id) do nothing;
  else
    update inventory.item_instances
    set status = 'consumed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
    where id = any(p_item_instance_ids) and id <> v_main_item_id;

    update inventory.item_instances
    set status = 'available', updated_at = now(), lock_version = lock_version + 1
    where id = v_main_item_id;
  end if;

  insert into inventory.evolution_attempts (
    user_id, rule_id, main_item_instance_id, result_item_instance_id,
    status, cost_kcoin, success_rate_bps, random_roll_bps, ledger_id,
    metadata
  ) values (
    p_user_id, v_rule.id, v_main_item_id, v_result_item_id,
    case when v_success then 'success' else 'failed' end,
    v_rule.cost_kcoin, v_rule.success_rate_bps, v_roll, (v_debit ->> 'ledger_id')::uuid,
    jsonb_build_object('input_item_instance_ids', p_item_instance_ids)
  ) returning id into v_attempt_id;

  insert into inventory.evolution_consumed_items (attempt_id, item_instance_id, role, consumed, returned)
  select v_attempt_id,
         x.id,
         case when x.id = v_main_item_id then 'main' else 'material' end,
         case when v_success then true else x.id <> v_main_item_id end,
         case when v_success then false else x.id = v_main_item_id end
  from unnest(p_item_instance_ids) as x(id);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id,
         p_user_id,
         case when v_success then 'consumed' when x.id = v_main_item_id then 'evolved_failed_returned' else 'consumed' end,
         'inventory_evolution',
         v_attempt_id,
         jsonb_build_object('attempt_id', v_attempt_id, 'success', v_success, 'result_item_instance_id', v_result_item_id)
  from unnest(p_item_instance_ids) as x(id);

  if v_success then
    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    values (v_result_item_id, p_user_id, 'evolved_success', 'inventory_evolution', v_attempt_id,
            jsonb_build_object('source_item_instance_ids', p_item_instance_ids));
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'success', v_success,
    'random_roll_bps', v_roll,
    'success_rate_bps', v_rule.success_rate_bps,
    'main_item_instance_id', v_main_item_id,
    'result_item_instance_id', v_result_item_id,
    'cost_kcoin', v_rule.cost_kcoin
  );
end;
$$;


-- ============================================================
-- inventory_decompose_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_decompose_item

create or replace function api.inventory_decompose_item(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_form catalog.collectible_forms%rowtype;
  v_rule inventory.decompose_rules%rowtype;
  v_duplicate_count integer;
  v_credit jsonb;
  v_log_id uuid;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.decomposable then
    raise exception 'item is not decomposable';
  end if;

  select count(*)::integer into v_duplicate_count
  from inventory.item_instances
  where owner_user_id = p_user_id
    and template_id = v_item.template_id
    and coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status = 'available';

  if v_duplicate_count < 2 then
    raise exception 'only duplicate collectibles can be decomposed';
  end if;

  select * into v_form from catalog.collectible_forms where id = v_item.form_id;

  select * into v_rule
  from inventory.decompose_rules
  where rarity_code = v_template.rarity_code
    and form_index = coalesce(v_form.form_index, 1)
    and min_level <= v_item.level
    and active = true
  order by min_level desc, created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'decompose rule not found';
  end if;

  update inventory.item_instances
  set status = 'decomposed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
  where id = p_item_instance_id;

  v_credit := api._credit_balance(
    p_user_id, 'FGEMS', v_rule.reward_fgems, 'inventory_decompose', p_item_instance_id, null,
    coalesce(p_idempotency_key, 'inventory_decompose:' || p_item_instance_id::text),
    'Decompose collectible',
    jsonb_build_object('item_instance_id', p_item_instance_id, 'rarity_code', v_template.rarity_code)
  );

  insert into inventory.decompose_logs (user_id, item_instance_id, rule_id, reward_fgems, ledger_id)
  values (p_user_id, p_item_instance_id, v_rule.id, v_rule.reward_fgems, (v_credit ->> 'ledger_id')::uuid)
  returning id into v_log_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, before_state, after_state)
  values (
    p_item_instance_id, p_user_id, 'decomposed', 'inventory_decompose', v_log_id,
    jsonb_build_object('status', v_item.status, 'owner_user_id', v_item.owner_user_id),
    jsonb_build_object('status', 'decomposed', 'reward_fgems', v_rule.reward_fgems)
  );

  return jsonb_build_object('item_instance_id', p_item_instance_id, 'reward_fgems', v_rule.reward_fgems, 'ledger_id', v_credit ->> 'ledger_id');
end;
$$;


-- ============================================================
-- wallet_save_verified_address.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.wallet_save_verified_address

create or replace function api.wallet_save_verified_address(
  p_user_id uuid,
  p_address text,
  p_address_raw text default null,
  p_network text default 'mainnet',
  p_wallet_app_name text default null,
  p_is_primary boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
begin
  if p_user_id is null or p_address is null then
    raise exception 'user_id and address are required';
  end if;

  if coalesce(p_is_primary, true) then
    update core.user_wallets
    set is_primary = false, updated_at = now()
    where user_id = p_user_id and chain = 'TON' and network = coalesce(p_network, 'mainnet');
  end if;

  insert into core.user_wallets (
    user_id, chain, network, address, address_raw, wallet_app_name,
    is_primary, status, verified_at
  ) values (
    p_user_id, 'TON', coalesce(p_network, 'mainnet'), p_address, p_address_raw, p_wallet_app_name,
    coalesce(p_is_primary, true), 'connected', now()
  )
  on conflict (user_id, chain, network, address) do update
  set address_raw = excluded.address_raw,
      wallet_app_name = excluded.wallet_app_name,
      is_primary = excluded.is_primary,
      status = 'connected',
      verified_at = now(),
      disconnected_at = null,
      updated_at = now()
  returning id into v_wallet_id;

  return jsonb_build_object('wallet_id', v_wallet_id, 'address', p_address, 'network', coalesce(p_network, 'mainnet'));
end;
$$;


-- ============================================================
-- wallet_enqueue_mint.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.wallet_enqueue_mint

create or replace function api.wallet_enqueue_mint(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_collection_id uuid,
  p_wallet_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_collection onchain.nft_collections%rowtype;
  v_queue_id uuid;
begin
  if p_user_id is null or p_item_instance_id is null or p_collection_id is null or p_idempotency_key is null then
    raise exception 'user_id, item_instance_id, collection_id and idempotency_key are required';
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available for mint';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.nft_mintable then
    raise exception 'item is not mintable';
  end if;

  select * into v_collection from onchain.nft_collections where id = p_collection_id and status = 'active';
  if v_collection.id is null then
    raise exception 'active NFT collection not found';
  end if;

  insert into onchain.mint_queue (
    user_id, wallet_id, collection_id, item_instance_id, template_id, form_id,
    status, next_attempt_at, idempotency_key
  ) values (
    p_user_id, p_wallet_id, p_collection_id, p_item_instance_id, v_item.template_id, v_item.form_id,
    'queued', now(), p_idempotency_key
  )
  on conflict (idempotency_key) do update set updated_at = now()
  returning id into v_queue_id;

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  values (p_item_instance_id, p_user_id, 'mint', 'mint_queue', v_queue_id)
  on conflict do nothing;

  update inventory.item_instances
  set status = 'minting', nft_mint_status = 'queued', updated_at = now(), lock_version = lock_version + 1
  where id = p_item_instance_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (p_item_instance_id, p_user_id, 'mint_queued', 'mint_queue', v_queue_id,
          jsonb_build_object('collection_id', p_collection_id));

  return jsonb_build_object('mint_queue_id', v_queue_id, 'status', 'queued');
end;
$$;


-- ============================================================
-- onchain_mark_mint_success.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.onchain_mark_mint_success

create or replace function api.onchain_mark_mint_success(
  p_mint_queue_id uuid,
  p_item_address text,
  p_item_index bigint,
  p_owner_address text,
  p_tx_hash text,
  p_metadata_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue onchain.mint_queue%rowtype;
  v_nft_item_id uuid;
begin
  select * into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'mint queue not found';
  end if;

  insert into onchain.nft_items (
    collection_id, item_instance_id, template_id, form_id, item_index, item_address,
    owner_address, owner_user_id, metadata_url, status, minted_tx_hash, minted_at
  ) values (
    v_queue.collection_id, v_queue.item_instance_id, v_queue.template_id, v_queue.form_id, p_item_index, p_item_address,
    p_owner_address, v_queue.user_id, p_metadata_url, 'minted', p_tx_hash, now()
  )
  on conflict (item_instance_id) do update
  set item_index = excluded.item_index,
      item_address = excluded.item_address,
      owner_address = excluded.owner_address,
      metadata_url = excluded.metadata_url,
      status = 'minted',
      minted_tx_hash = excluded.minted_tx_hash,
      minted_at = coalesce(onchain.nft_items.minted_at, now()),
      updated_at = now()
  returning id into v_nft_item_id;

  update onchain.mint_queue
  set status = 'minted', nft_item_id = v_nft_item_id, tx_hash = p_tx_hash, completed_at = now(), updated_at = now()
  where id = p_mint_queue_id;

  update inventory.item_instances
  set status = 'minted', nft_mint_status = 'minted', minted_nft_item_id = v_nft_item_id, updated_at = now(), lock_version = lock_version + 1
  where id = v_queue.item_instance_id;

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = v_queue.item_instance_id and source_type = 'mint_queue' and source_id = p_mint_queue_id and status = 'active';

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_queue.item_instance_id, v_queue.user_id, 'minted', 'mint_queue', p_mint_queue_id,
          jsonb_build_object('nft_item_id', v_nft_item_id, 'item_address', p_item_address, 'tx_hash', p_tx_hash));

  return jsonb_build_object('nft_item_id', v_nft_item_id, 'status', 'minted', 'item_address', p_item_address);
end;
$$;


-- ============================================================
-- onchain_mark_mint_failed.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Marks a mint queue item as failed and optionally releases the game item back to the user.
-- Use release_item=false only if an external retry worker will continue processing immediately.

create or replace function api.onchain_mark_mint_failed(
  p_mint_queue_id uuid,
  p_error_message text,
  p_tx_hash text default null,
  p_release_item boolean default true,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue onchain.mint_queue%rowtype;
  v_attempt_count integer;
begin
  if p_mint_queue_id is null then
    raise exception 'mint_queue_id is required';
  end if;

  select * into v_queue
  from onchain.mint_queue
  where id = p_mint_queue_id
  for update;

  if v_queue.id is null then
    raise exception 'mint queue not found';
  end if;

  v_attempt_count := v_queue.attempt_count + 1;

  update onchain.mint_queue
  set status = 'failed',
      attempt_count = v_attempt_count,
      tx_hash = coalesce(p_tx_hash, tx_hash),
      error_message = coalesce(nullif(p_error_message, ''), 'mint failed'),
      next_attempt_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      completed_at = now(),
      updated_at = now()
  where id = p_mint_queue_id;

  if coalesce(p_tx_hash, '') <> '' then
    insert into onchain.transactions (
      chain, network, tx_hash, user_id, wallet_id, related_type, related_id,
      direction, status, payload, error_message, submitted_at
    ) values (
      'TON',
      coalesce((select network from onchain.nft_collections where id = v_queue.collection_id), 'mainnet'),
      p_tx_hash,
      v_queue.user_id,
      v_queue.wallet_id,
      'mint_queue',
      p_mint_queue_id,
      'outbound',
      'failed',
      coalesce(p_metadata, '{}'::jsonb),
      p_error_message,
      now()
    )
    on conflict (tx_hash) do update
    set status = 'failed',
        error_message = excluded.error_message,
        payload = onchain.transactions.payload || excluded.payload,
        updated_at = now();
  end if;

  if coalesce(p_release_item, true) then
    update inventory.item_instances
    set status = 'available',
        nft_mint_status = 'failed',
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_queue.item_instance_id;

    update inventory.inventory_locks
    set status = 'released',
        released_at = now(),
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('mint_failed', true, 'error_message', p_error_message)
    where item_instance_id = v_queue.item_instance_id
      and source_type = 'mint_queue'
      and source_id = p_mint_queue_id
      and status = 'active';
  else
    update inventory.item_instances
    set nft_mint_status = 'failed',
        updated_at = now(),
        lock_version = lock_version + 1
    where id = v_queue.item_instance_id;
  end if;

  insert into inventory.item_instance_events (
    item_instance_id, user_id, event_type, source_type, source_id, after_state, metadata
  ) values (
    v_queue.item_instance_id,
    v_queue.user_id,
    'admin_adjusted',
    'mint_queue',
    p_mint_queue_id,
    jsonb_build_object(
      'mint_status', 'failed',
      'released', coalesce(p_release_item, true),
      'tx_hash', p_tx_hash,
      'error_message', p_error_message
    ),
    coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'mint_queue_id', p_mint_queue_id,
    'status', 'failed',
    'attempt_count', v_attempt_count,
    'released_item', coalesce(p_release_item, true),
    'item_instance_id', v_queue.item_instance_id,
    'tx_hash', p_tx_hash
  );
end;
$$;


-- ============================================================
-- admin_write_audit_log.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Writes an admin audit log entry for every high-risk operation.
-- Call this from admin API handlers after validating admin permissions.

create or replace function api.admin_write_audit_log(
  p_admin_user_id uuid,
  p_action text,
  p_target_schema text default null,
  p_target_table text default null,
  p_target_id uuid default null,
  p_before_state jsonb default '{}'::jsonb,
  p_after_state jsonb default '{}'::jsonb,
  p_ip_hash text default null,
  p_user_agent text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_audit_id uuid;
begin
  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'action is required';
  end if;

  select * into v_admin
  from ops.admin_users
  where id = p_admin_user_id
  for update;

  if v_admin.id is null then
    raise exception 'admin user not found';
  end if;
  if v_admin.status <> 'active' then
    raise exception 'admin user is not active';
  end if;

  insert into ops.admin_audit_logs (
    admin_user_id,
    action,
    target_schema,
    target_table,
    target_id,
    before_state,
    after_state,
    ip_hash,
    user_agent,
    reason
  ) values (
    p_admin_user_id,
    trim(p_action),
    nullif(trim(coalesce(p_target_schema, '')), ''),
    nullif(trim(coalesce(p_target_table, '')), ''),
    p_target_id,
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb),
    p_ip_hash,
    p_user_agent,
    p_reason
  ) returning id into v_audit_id;

  update ops.admin_users
  set last_login_at = coalesce(last_login_at, now()),
      updated_at = now()
  where id = p_admin_user_id;

  return jsonb_build_object(
    'audit_log_id', v_audit_id,
    'admin_user_id', p_admin_user_id,
    'action', trim(p_action),
    'target_schema', p_target_schema,
    'target_table', p_target_table,
    'target_id', p_target_id,
    'created_at', now()
  );
end;
$$;


-- ============================================================
-- gacha_require_paid_star_payment_before_opened.sql
-- ============================================================
-- Guard first-phase gacha fulfillment against payment charge id reuse.

create or replace function gacha.require_paid_star_payment_before_opened()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('opened', 'completed')
     and old.status not in ('opened', 'completed') then
    if new.payment_star_order_id is null then
      raise exception 'draw order payment_star_order_id is required before opening';
    end if;

    if not exists (
      select 1
      from payments.star_payments sp
      where sp.star_order_id = new.payment_star_order_id
    ) then
      raise exception 'successful payment not recorded for draw order';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function gacha.require_paid_star_payment_before_opened()
  from public, anon, authenticated;

drop trigger if exists require_paid_star_payment_before_opened on gacha.draw_orders;
create trigger require_paid_star_payment_before_opened
before update of status on gacha.draw_orders
for each row
execute function gacha.require_paid_star_payment_before_opened();


-- ============================================================
-- _rpc_permissions.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Execute this after loading all RPC files.
-- Frontend anon/authenticated roles must not call trusted business mutation RPCs directly.
-- Vercel API should call these functions using the Supabase service_role key.

revoke usage on schema api from public, anon, authenticated;
grant usage on schema api to service_role;

revoke execute on all functions in schema api from public, anon, authenticated;
grant execute on all functions in schema api to service_role;

alter default privileges in schema api
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema api
  grant execute on functions to service_role;
