create unique index entitlements_new_user_welcome_unique_idx
on economy.entitlements (user_id)
where kind = 'free_normal_box' and source = 'new_user_welcome';

create or replace function api.identity_authenticate(
  p_operation_id uuid,
  p_request_hash text,
  p_user_key_hash text,
  p_init_data_key_hash text,
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_referral_code text,
  p_session_id uuid,
  p_token_hash text,
  p_auth_date timestamptz,
  p_entry_kind text,
  p_entry_referral_code text,
  p_battle_invite_token_hash text,
  p_entry_source_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user identity.users%rowtype;
  v_login identity.login_requests%rowtype;
  v_session_id uuid;
  v_new_user boolean;
  v_expires_at timestamptz;
  v_candidate identity.entry_candidates%rowtype;
  v_referral_processed_at timestamptz;
  v_rate_allowed boolean;
  v_source_code text;
  v_session_new_user boolean;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or p_user_key_hash is null or p_user_key_hash !~ '^[0-9a-f]{64}$'
    or p_init_data_key_hash is null or p_init_data_key_hash !~ '^[0-9a-f]{64}$'
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_session_id is null
    or p_telegram_id is null
  then
    perform api.raise_business_error('REQUEST_INVALID', '登录请求摘要无效');
  end if;
  if p_entry_kind is null
    or p_entry_kind not in ('direct', 'referral', 'battle', 'invalid')
    or (
      p_entry_kind = 'direct'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is not null
        or (
          p_entry_source_param is not null
          and p_entry_source_param <> 'listed_on_tg_app'
          and p_entry_source_param !~ '^SRC_[A-F0-9]{20}$'
        )
      )
    )
    or (
      p_entry_kind = 'referral'
      and (
        p_entry_referral_code is null
        or p_entry_referral_code !~ '^TMA[A-F0-9]{20}$'
        or p_battle_invite_token_hash is not null
        or p_entry_source_param is not null
      )
    )
    or (
      p_entry_kind = 'battle'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is null
        or p_battle_invite_token_hash !~ '^[0-9a-f]{64}$'
        or p_entry_source_param is not null
      )
    )
    or (
      p_entry_kind = 'invalid'
      and (
        p_entry_referral_code is not null
        or p_battle_invite_token_hash is not null
        or p_entry_source_param is not null
      )
    )
  then
    perform api.raise_business_error('REQUEST_INVALID', '登录入口参数无效');
  end if;

  v_rate_allowed := identity.consume_login_rate_limit('user', p_user_key_hash);
  if not v_rate_allowed then
    return jsonb_build_object('error_code', 'RATE_LIMITED');
  end if;
  v_rate_allowed := identity.consume_login_rate_limit('init_data', p_init_data_key_hash);
  if not v_rate_allowed then
    return jsonb_build_object('error_code', 'RATE_LIMITED');
  end if;
  if p_entry_kind = 'invalid' then
    return jsonb_build_object('error_code', 'TELEGRAM_START_PARAM_INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('identity.login:' || p_operation_id::text, 0));
  select * into v_login from identity.login_requests where operation_id = p_operation_id for update;
  if v_login.operation_id is not null then
    if v_login.request_hash <> p_request_hash then
      return jsonb_build_object('error_code', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    select * into v_user from identity.users where id = v_login.user_id for update;
    if v_user.status = 'banned' then
      update identity.sessions set revoked_at = coalesce(revoked_at, now())
      where user_id = v_user.id and revoked_at is null;
    end if;
    if v_login.account_status = 'banned' or v_user.status = 'banned' then
      return jsonb_build_object('account_status', 'banned');
    end if;
    select s.new_user into v_session_new_user
    from identity.sessions s
    where s.id = v_login.session_id;
    return jsonb_build_object(
      'session_id', v_login.session_id,
      'user_id', v_login.user_id,
      'account_status', 'normal',
      'preferred_language', v_user.preferred_language,
      'entry_kind', v_login.entry_kind,
      'expires_at', v_login.expires_at,
      'welcome_reward', case
        when coalesce(v_session_new_user, false) and exists (
          select 1
          from economy.entitlements entitlement
          where entitlement.user_id = v_login.user_id
            and entitlement.kind = 'free_normal_box'
            and entitlement.source = 'new_user_welcome'
        ) then jsonb_build_object('kind', 'free_normal_box', 'amount', 1)
        else null
      end
    ) || identity.session_entry_handoff(v_login.session_id);
  end if;

  if p_entry_kind = 'direct' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.status = 'active'
      and (
        (p_entry_source_param is null and source.source_code = 'telegram_direct')
        or source.start_param = p_entry_source_param
      )
    for share;
  elsif p_entry_kind = 'referral' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.source_code = 'player_referral' and source.status = 'active'
    for share;
  elsif p_entry_kind = 'battle' then
    select source.source_code into v_source_code
    from acquisition.sources source
    where source.source_code = 'battle_share' and source.status = 'active'
    for share;
  end if;
  if v_source_code is null then
    if p_entry_kind = 'direct' and p_entry_source_param is not null then
      return jsonb_build_object('error_code', 'TELEGRAM_START_PARAM_INVALID');
    end if;
    raise exception using
      errcode = 'P0001',
      message = 'ACQUISITION_SOURCE_CONFIGURATION_INVALID';
  end if;

  perform pg_advisory_xact_lock(p_telegram_id);
  insert into identity.users (
    telegram_id, username, first_name, last_name, language_code, referral_code,
    first_source_code
  )
  values (
    p_telegram_id, p_username, p_first_name, p_last_name, p_language_code,
    p_referral_code, v_source_code
  )
  on conflict (telegram_id) do nothing
  returning * into v_user;
  v_new_user := v_user.id is not null;
  if not v_new_user then
    update identity.users
    set username = p_username, first_name = p_first_name, last_name = p_last_name,
        language_code = p_language_code, updated_at = now()
    where telegram_id = p_telegram_id and status = 'normal'
    returning * into v_user;
    if v_user.id is null then
      select * into v_user from identity.users where telegram_id = p_telegram_id;
    end if;
  end if;

  if v_new_user and p_entry_kind = 'referral' then
    insert into identity.entry_candidates (user_id, code, expires_at)
    values (v_user.id, p_entry_referral_code, now() + interval '10 minutes');
  end if;
  select * into v_candidate
  from identity.entry_candidates
  where user_id = v_user.id
  for update;
  if v_candidate.user_id is not null then
    if v_candidate.status = 'pending' then
      v_referral_processed_at := null;
    else
      v_referral_processed_at := coalesce(v_candidate.settled_at, now());
    end if;
  else
    v_referral_processed_at := now();
  end if;
  insert into economy.balances (user_id, currency)
  values (v_user.id, 'KCOIN'), (v_user.id, 'FGEMS')
  on conflict do nothing;
  if v_new_user then
    insert into economy.entitlements (user_id, kind, source)
    values (v_user.id, 'free_normal_box', 'new_user_welcome');
  end if;

  update identity.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;
  if v_user.status = 'banned' then
    insert into identity.login_requests (
      operation_id, request_hash, user_id, account_status, session_id, expires_at,
      entry_kind, referral_code, battle_invite_token_hash, source_code
    ) values (
      p_operation_id, p_request_hash, v_user.id, 'banned', null, null,
      p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash, v_source_code
    );
    return jsonb_build_object('account_status', 'banned');
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into identity.sessions (
    id, user_id, token_hash, auth_date, expires_at, new_user, entry_kind,
    referral_code, battle_invite_token_hash, referral_processed_at, source_code
  ) values (
    p_session_id, v_user.id, p_token_hash, p_auth_date, v_expires_at, v_new_user, p_entry_kind,
    p_entry_referral_code, p_battle_invite_token_hash, v_referral_processed_at,
    v_source_code
  )
  returning id into v_session_id;
  insert into identity.login_requests (
    operation_id, request_hash, user_id, account_status, session_id, expires_at,
    entry_kind, referral_code, battle_invite_token_hash, source_code
  ) values (
    p_operation_id, p_request_hash, v_user.id, 'normal', v_session_id, v_expires_at,
    p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash, v_source_code
  );

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'preferred_language', v_user.preferred_language,
    'entry_kind', p_entry_kind,
    'expires_at', v_expires_at,
    'welcome_reward', case
      when v_new_user then jsonb_build_object(
        'kind', 'free_normal_box',
        'amount', 1
      )
      else null
    end
  ) || identity.session_entry_handoff(v_session_id);
end;
$$;

revoke execute on function api.identity_authenticate(
  uuid, text, text, text, bigint, text, text, text, text, text, uuid, text,
  timestamptz, text, text, text, text
) from public, anon, authenticated;
grant execute on function api.identity_authenticate(
  uuid, text, text, text, bigint, text, text, text, text, text, uuid, text,
  timestamptz, text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
