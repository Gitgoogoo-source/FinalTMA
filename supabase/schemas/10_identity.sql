create table identity.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  language_code text,
  photo_url text,
  status text not null default 'normal' check (status in ('normal', 'banned')),
  referral_code text not null unique,
  invited_by uuid references identity.users(id),
  total_refund_stars bigint not null default 0 check (total_refund_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_invited_by_idx on identity.users (invited_by);

create table identity.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  token_hash text not null unique,
  auth_date timestamptz not null,
  expires_at timestamptz not null,
  new_user boolean not null,
  start_param text,
  referral_processed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (start_param is null or start_param ~ '^TMA[A-F0-9]{20}$')
);

create unique index sessions_one_active_per_user_idx on identity.sessions (user_id) where revoked_at is null;

create table identity.auth_attempts (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('source', 'user', 'init_data')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz not null default now()
);

create index auth_attempts_scope_key_time_idx on identity.auth_attempts (scope, key_hash, attempted_at desc);
create index auth_attempts_time_idx on identity.auth_attempts (attempted_at);

create table identity.login_requests (
  operation_id uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references identity.users(id) on delete cascade,
  account_status text not null check (account_status in ('normal', 'banned')),
  session_id uuid references identity.sessions(id),
  expires_at timestamptz,
  start_param text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_param is null or start_param ~ '^TMA[A-F0-9]{20}$'),
  check (
    (account_status = 'normal' and session_id is not null and expires_at is not null)
    or (account_status = 'banned' and session_id is null and expires_at is null)
  )
);

create index login_requests_user_created_idx on identity.login_requests (user_id, created_at desc);

create table identity.entry_candidates (
  user_id uuid primary key references identity.users(id) on delete cascade,
  code text not null check (code ~ '^TMA[A-F0-9]{20}$'),
  status text not null default 'pending' check (status in ('pending', 'bound', 'rejected')),
  result_code text,
  operation_id uuid unique,
  inviter_id uuid references identity.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  check (expires_at = created_at + interval '10 minutes'),
  check (
    (status = 'pending' and result_code is null and operation_id is null and settled_at is null)
    or (status <> 'pending' and result_code is not null and operation_id is not null and settled_at is not null)
  ),
  check (status <> 'bound' or inviter_id is not null)
);

create or replace function identity.utc_day()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'utc')::date $$;

create or replace function identity.random_basis_points()
returns integer
language sql
volatile
set search_path = ''
as $$
  with bytes as (select extensions.gen_random_bytes(4) value)
  select ((get_byte(value, 0)::bigint << 24) +
          (get_byte(value, 1)::bigint << 16) +
          (get_byte(value, 2)::bigint << 8) +
          get_byte(value, 3)::bigint) % 10000
  from bytes
$$;

create or replace function api.raise_business_error(p_code text, p_message text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = p_code,
    detail = jsonb_build_object('code', p_code, 'message', p_message)::text;
end;
$$;

create or replace function identity.session_entry_handoff(p_session_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'entry_handoff_state', case when s.referral_processed_at is null then 'pending' else 'complete' end,
    'entry_handoff_code', coalesce(c.code, s.start_param),
    'entry_handoff_result', case
      when s.referral_processed_at is null then null
      when c.status in ('bound', 'rejected') then c.result_code
      when not s.new_user and s.start_param is not null then 'REFERRAL_OLD_USER'
      else null
    end
  )
  from identity.sessions s
  left join identity.entry_candidates c on c.user_id = s.user_id
  where s.id = p_session_id
$$;

create or replace function api.session_user(
  p_session_id uuid,
  p_allow_pending_entry_handoff boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session identity.sessions%rowtype;
  v_status text;
begin
  select * into v_session from identity.sessions where id = p_session_id;
  if v_session.id is null then
    perform api.raise_business_error('SESSION_REQUIRED', '需要重新进入 Telegram');
  end if;
  if v_session.revoked_at is not null then
    perform api.raise_business_error('SESSION_REPLACED', '会话已被新的登录替换');
  end if;
  if v_session.expires_at <= now() then
    perform api.raise_business_error('SESSION_EXPIRED', '会话已过期');
  end if;
  select status into v_status from identity.users where id = v_session.user_id;
  if v_status <> 'normal' then
    perform api.raise_business_error('ACCOUNT_RESTRICTED', '账号不可用');
  end if;
  if v_session.referral_processed_at is null and not coalesce(p_allow_pending_entry_handoff, false) then
    perform api.raise_business_error('ENTRY_HANDOFF_PENDING', '邀请绑定结果确认中，请稍后刷新');
  end if;
  return v_session.user_id;
end;
$$;

create or replace function api.identity_consume_login_rate_limit(p_scope text, p_key_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_limit integer;
begin
  v_limit := case p_scope
    when 'source' then 30
    when 'user' then 10
    when 'init_data' then 3
    else null
  end;
  if v_limit is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    perform api.raise_business_error('REQUEST_INVALID', '登录限流参数无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_key_hash, 0));
  delete from identity.auth_attempts where attempted_at < now() - interval '5 minutes';
  delete from identity.auth_attempts
  where scope = p_scope and key_hash = p_key_hash and attempted_at < now() - interval '1 minute';
  select count(*) into v_count
  from identity.auth_attempts
  where scope = p_scope and key_hash = p_key_hash and attempted_at >= now() - interval '1 minute';
  if v_count >= v_limit then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;
  insert into identity.auth_attempts (scope, key_hash) values (p_scope, p_key_hash);
end;
$$;

create or replace function api.identity_resolve_session(p_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'session_id', s.id,
    'user_id', s.user_id,
    'account_status', u.status,
    'expires_at', s.expires_at,
    'session_state', case
      when s.revoked_at is not null then 'replaced'
      when s.expires_at <= now() then 'expired'
      else 'active'
    end
  ) || identity.session_entry_handoff(s.id)
  from identity.sessions s
  join identity.users u on u.id = s.user_id
  where s.token_hash = p_token_hash
$$;

create or replace function api.identity_authenticate(
  p_operation_id uuid,
  p_request_hash text,
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_photo_url text,
  p_referral_code text,
  p_token_hash text,
  p_auth_date timestamptz,
  p_start_param text
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
  v_entry_code text;
  v_referral_processed_at timestamptz;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_token_hash !~ '^[0-9a-f]{64}$' then
    perform api.raise_business_error('REQUEST_INVALID', '登录请求摘要无效');
  end if;
  if p_start_param is not null and p_start_param !~ '^TMA[A-F0-9]{20}$' then
    perform api.raise_business_error('TELEGRAM_START_PARAM_INVALID', '入口参数无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identity.login:' || p_operation_id::text, 0));
  select * into v_login from identity.login_requests where operation_id = p_operation_id for update;
  if v_login.operation_id is not null then
    if v_login.request_hash <> p_request_hash then
      perform api.raise_business_error('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同登录请求');
    end if;
    select * into v_user from identity.users where id = v_login.user_id for update;
    if v_user.status = 'banned' then
      update identity.sessions set revoked_at = coalesce(revoked_at, now())
      where user_id = v_user.id and revoked_at is null;
    end if;
    if v_login.account_status = 'banned' or v_user.status = 'banned' then
      return jsonb_build_object('account_status', 'banned');
    end if;
    return jsonb_build_object(
      'session_id', v_login.session_id,
      'user_id', v_login.user_id,
      'account_status', 'normal',
      'expires_at', v_login.expires_at
    ) || identity.session_entry_handoff(v_login.session_id);
  end if;

  perform pg_advisory_xact_lock(p_telegram_id);
  insert into identity.users (telegram_id, username, first_name, last_name, language_code, photo_url, referral_code)
  values (p_telegram_id, p_username, p_first_name, p_last_name, p_language_code, p_photo_url, p_referral_code)
  on conflict (telegram_id) do nothing
  returning * into v_user;
  v_new_user := v_user.id is not null;
  if not v_new_user then
    update identity.users
    set username = p_username, first_name = p_first_name, last_name = p_last_name,
        language_code = p_language_code, photo_url = p_photo_url, updated_at = now()
    where telegram_id = p_telegram_id and status = 'normal'
    returning * into v_user;
    if v_user.id is null then
      select * into v_user from identity.users where telegram_id = p_telegram_id;
    end if;
  end if;

  if v_new_user and p_start_param is not null then
    insert into identity.entry_candidates (user_id, code, expires_at)
    values (v_user.id, p_start_param, now() + interval '10 minutes');
  end if;
  select * into v_candidate
  from identity.entry_candidates
  where user_id = v_user.id
  for update;
  if v_candidate.user_id is not null then
    v_entry_code := v_candidate.code;
    if v_candidate.status = 'pending' then
      v_referral_processed_at := null;
    else
      v_referral_processed_at := coalesce(v_candidate.settled_at, now());
    end if;
  else
    v_entry_code := p_start_param;
    v_referral_processed_at := now();
  end if;
  insert into economy.balances (user_id, currency)
  values (v_user.id, 'KCOIN'), (v_user.id, 'FGEMS')
  on conflict do nothing;

  update identity.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;
  if v_user.status = 'banned' then
    insert into identity.login_requests (
      operation_id, request_hash, user_id, account_status, session_id, expires_at, start_param
    ) values (p_operation_id, p_request_hash, v_user.id, 'banned', null, null, null);
    return jsonb_build_object('account_status', 'banned');
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into identity.sessions (
    user_id, token_hash, auth_date, expires_at, new_user, start_param, referral_processed_at
  ) values (
    v_user.id, p_token_hash, p_auth_date, v_expires_at, v_new_user, v_entry_code,
    v_referral_processed_at
  )
  returning id into v_session_id;
  insert into identity.login_requests (
    operation_id, request_hash, user_id, account_status, session_id, expires_at, start_param
  ) values (
    p_operation_id, p_request_hash, v_user.id, 'normal', v_session_id, v_expires_at, v_entry_code
  );

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'expires_at', v_expires_at
  ) || identity.session_entry_handoff(v_session_id);
end;
$$;

create or replace function api.identity_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'telegram_id', u.telegram_id::text,
      'username', u.username,
      'first_name', u.first_name,
      'last_name', u.last_name,
      'photo_url', u.photo_url,
      'status', u.status,
      'referral_code', u.referral_code
    ),
    'assets', economy.assets(v_user_id),
    'entitlements', jsonb_build_object(
      'free_normal_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'),
      'free_rare_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused')
    ),
    'catalog_version', 'v1',
    'blocking_operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id and o.status in ('pending', 'unknown')
    ), '[]'::jsonb),
    'pending_payments', coalesce((
      select jsonb_agg(payments.order_json(p) order by p.created_at desc)
      from payments.orders p
      where p.user_id = v_user_id and p.status in ('pending', 'paid')
    ), '[]'::jsonb),
    'pending_mints', coalesce((
      select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
      from onchain.mints m
      where m.user_id = v_user_id and m.status in ('reserved', 'submitted', 'unknown')
    ), '[]'::jsonb),
    'server_time', now()
  ) into v_result
  from identity.users u where u.id = v_user_id;
  return v_result;
end;
$$;
