-- 0013_create_rpc_auth.sql
-- Security-definer helpers for economy mutation, Telegram auth, app sessions and bootstrap data.

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

-- Keep helper functions callable by service_role. Public roles are revoked in 0018.
