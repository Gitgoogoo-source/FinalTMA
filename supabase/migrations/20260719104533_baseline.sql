-- Generated from supabase/schemas. Edit declarative schemas, then run supabase db diff for future changes.

-- source: 00_foundation.sql
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists identity;
create schema if not exists catalog;
create schema if not exists economy;
create schema if not exists inventory;
create schema if not exists gacha;
create schema if not exists evolution;
create schema if not exists expedition;
create schema if not exists wheel;
create schema if not exists market;
create schema if not exists payments;
create schema if not exists vip;
create schema if not exists tasks;
create schema if not exists referral;
create schema if not exists album;
create schema if not exists onchain;
create schema if not exists operations;
create schema if not exists risk;
create schema if not exists monster_tamer;
create schema if not exists api;

-- source: 10_identity.sql
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
      where o.user_id = v_user_id and (
        o.status in ('pending', 'unknown')
        or (
          o.use_case in ('gacha.open', 'wheel.spin', 'inventory.evolve')
          and o.status in ('succeeded', 'failed')
          and o.result_acknowledged_at is null
        )
      )
    ), '[]'::jsonb),
    'pending_payments', coalesce((
      select jsonb_agg(payments.order_json(p) order by p.created_at desc)
      from payments.orders p
      where p.user_id = v_user_id and (
        p.status in ('processing', 'paid')
        or (p.kind = 'vip' and p.status = 'pending')
      )
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

-- source: 20_catalog.sql
create table catalog.chains (
  id text primary key check (id ~ '^CHAIN-[NAT]-[0-9]{3}$'),
  global_order smallint not null unique check (global_order between 1 and 70),
  chain_type text not null check (chain_type in ('normal', 'advanced', 'top')),
  theme text not null,
  continuity text not null,
  catalog_version text not null check (catalog_version = 'v1')
);

create table catalog.templates (
  id text primary key check (id ~ '^PET-[NAT]-[0-9]{3}-[123]$'),
  chain_id text not null references catalog.chains(id),
  stage smallint not null check (stage between 1 and 3),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  name text not null unique,
  sort_order smallint not null unique check (sort_order between 1 and 210),
  combat_power integer not null check (combat_power > 0),
  market_price bigint not null check (market_price > 0),
  decompose_fgems bigint not null check (decompose_fgems > 0),
  expedition_fgems bigint not null check (expedition_fgems > 0),
  image_thumbnail_path text not null unique check (image_thumbnail_path ~ '^/assets/catalog/v1/thumb/pet-[nat]-[0-9]{3}-[123]\.webp$'),
  image_detail_path text not null unique check (image_detail_path ~ '^/assets/catalog/v1/detail/pet-[nat]-[0-9]{3}-[123]\.webp$'),
  draw_weight integer not null default 1 check (draw_weight > 0),
  catalog_version text not null check (catalog_version = 'v1'),
  unique (chain_id, stage)
);

create index templates_chain_id_idx on catalog.templates (chain_id, stage);
create index templates_rarity_draw_idx on catalog.templates (rarity, sort_order);

create table catalog.versions (
  id text primary key check (id = 'v1'),
  product_checksum text not null check (product_checksum ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz not null default now()
);

create or replace function catalog.rarity_rank(p_rarity text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_rarity when 'common' then 1 when 'rare' then 2 when 'epic' then 3 when 'legendary' then 4 when 'mythic' then 5 else 0 end::smallint
$$;

-- source: 30_operations.sql
create table operations.operations (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  use_case text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result_acknowledged_at timestamptz,
  check (result_acknowledged_at is null or status in ('succeeded', 'failed')),
  unique (user_id, use_case, id)
);

create index operations_user_created_idx on operations.operations (user_id, created_at desc);
create index operations_pending_idx on operations.operations (created_at) where status in ('pending', 'unknown');
create index operations_result_recovery_idx on operations.operations (user_id, use_case, created_at)
where use_case in ('gacha.open', 'wheel.spin', 'inventory.evolve') and result_acknowledged_at is null;

create table operations.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table operations.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  processed_count integer not null default 0 check (processed_count >= 0),
  details jsonb not null default '{}'::jsonb,
  scan_from timestamptz,
  scan_to timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_runs_name_started_idx on operations.job_runs (job_name, started_at desc);

create table operations.invariant_violations (
  id bigint generated always as identity primary key,
  code text not null,
  subject text not null,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index invariant_violations_open_idx on operations.invariant_violations (code, detected_at) where resolved_at is null;
create unique index invariant_violations_open_subject_idx on operations.invariant_violations (code, subject) where resolved_at is null;

create or replace function operations.operation_json(p_operation operations.operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'operation_id', p_operation.id,
    'use_case', p_operation.use_case,
    'status', p_operation.status,
    'result', p_operation.result,
    'error_code', p_operation.error_code,
    'acknowledged_at', p_operation.result_acknowledged_at,
    'created_at', p_operation.created_at,
    'updated_at', p_operation.updated_at
  )
$$;

create or replace function operations.begin_command(
  p_session_id uuid,
  p_use_case text,
  p_operation_id uuid,
  p_request jsonb
)
returns operations.operations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(
    p_session_id,
    p_use_case is not distinct from 'referral.bind'
  );
  v_hash text := encode(extensions.digest(convert_to(p_request::text, 'UTF8'), 'sha256'), 'hex');
  v_operation operations.operations%rowtype;
begin
  insert into operations.operations (id, user_id, use_case, request_hash, request)
  values (p_operation_id, v_user_id, p_use_case, v_hash, p_request)
  on conflict (id) do nothing
  returning * into v_operation;

  if v_operation.id is null then
    select * into v_operation from operations.operations where id = p_operation_id for update;
    if v_operation.user_id <> v_user_id or v_operation.use_case <> p_use_case or v_operation.request_hash <> v_hash then
      perform api.raise_business_error('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
    end if;
  end if;
  return v_operation;
end;
$$;

create or replace function operations.complete_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'succeeded', result = p_result, error_code = null,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.pending_command(p_operation_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'pending', result = p_result, error_code = null, updated_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.fail_command(p_operation_id uuid, p_code text, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update operations.operations
  set status = 'failed', result = p_detail, error_code = p_code,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.replay_if_finished(p_operation operations.operations)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_operation.status <> 'pending' or p_operation.result is not null
    then operations.operation_json(p_operation)
    else null
  end
$$;

create or replace function api.operations_get(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id, true);
  v_entry_handoff_pending boolean;
  v_operation operations.operations%rowtype;
  v_result jsonb;
begin
  select s.referral_processed_at is null into v_entry_handoff_pending
  from identity.sessions s
  where s.id = p_session_id;
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id and o.user_id = v_user_id;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '操作记录不存在');
  end if;
  if v_entry_handoff_pending and v_operation.use_case <> 'referral.bind' then
    perform api.raise_business_error('ENTRY_HANDOFF_PENDING', '邀请绑定结果确认中，请稍后刷新');
  end if;
  v_result := operations.operation_json(v_operation);
  return v_result;
end;
$$;

-- source: 31_economy.sql
create table economy.balances (
  user_id uuid not null references identity.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  available bigint not null default 0 check (available >= 0),
  locked bigint not null default 0 check (locked >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

create table economy.ledger (
  id bigint generated always as identity primary key,
  operation_id uuid references operations.operations(id),
  user_id uuid not null references identity.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  amount bigint not null check (amount <> 0),
  reason text not null,
  reference text,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index ledger_user_created_idx on economy.ledger (user_id, created_at desc);
create index ledger_operation_idx on economy.ledger (operation_id) where operation_id is not null;
create unique index ledger_stars_topup_reference_unique_idx on economy.ledger (reference) where reason = 'stars_topup';

create table economy.entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  kind text not null check (kind in ('free_normal_box', 'free_rare_box')),
  source text not null,
  status text not null default 'unused' check (status in ('unused', 'used', 'void')),
  operation_id uuid references operations.operations(id),
  obtained_at timestamptz not null default now(),
  used_at timestamptz
);

create index entitlements_fifo_idx on economy.entitlements (user_id, kind, obtained_at, id) where status = 'unused';

create or replace function economy.assets(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kcoin', jsonb_build_object(
      'currency', 'KCOIN',
      'available', coalesce(max(available) filter (where currency = 'KCOIN'), 0),
      'locked', coalesce(max(locked) filter (where currency = 'KCOIN'), 0)
    ),
    'fgems', jsonb_build_object(
      'currency', 'FGEMS',
      'available', coalesce(max(available) filter (where currency = 'FGEMS'), 0),
      'locked', coalesce(max(locked) filter (where currency = 'FGEMS'), 0)
    )
  )
  from economy.balances where user_id = p_user_id
$$;

create or replace function economy.change_balance(
  p_user_id uuid,
  p_currency text,
  p_amount bigint,
  p_reason text,
  p_operation_id uuid,
  p_reference text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  insert into economy.balances (user_id, currency) values (p_user_id, p_currency)
  on conflict (user_id, currency) do nothing;
  select available into v_balance
  from economy.balances
  where user_id = p_user_id and currency = p_currency
  for update;
  if v_balance + p_amount < 0 then
    perform api.raise_business_error('INSUFFICIENT_BALANCE', '余额不足');
  end if;
  v_balance := v_balance + p_amount;
  update economy.balances set available = v_balance, updated_at = now()
  where user_id = p_user_id and currency = p_currency;
  if p_amount <> 0 then
    insert into economy.ledger (operation_id, user_id, currency, amount, reason, reference, balance_after)
    values (p_operation_id, p_user_id, p_currency, p_amount, p_reason, p_reference, v_balance);
  end if;
  return v_balance;
end;
$$;

-- source: 32_inventory.sql
create table inventory.holdings (
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index holdings_template_idx on inventory.holdings (template_id, user_id);

create table inventory.reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  kind text not null check (kind in ('listing', 'expedition', 'mint')),
  reference_id uuid not null,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (kind, reference_id, template_id)
);

create index reservations_user_template_active_idx on inventory.reservations (user_id, template_id, kind) where status = 'active';

create or replace function inventory.available_quantity(p_user_id uuid, p_template_id text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((select h.quantity from inventory.holdings h where h.user_id = p_user_id and h.template_id = p_template_id), 0)
    - coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = p_template_id and r.status = 'active'), 0),
    0
  )
$$;

create or replace function inventory.change_holding(p_user_id uuid, p_template_id text, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity bigint;
  v_reserved bigint;
begin
  insert into inventory.holdings (user_id, template_id) values (p_user_id, p_template_id)
  on conflict (user_id, template_id) do nothing;
  select quantity into v_quantity
  from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id
  for update;
  select coalesce(sum(quantity), 0) into v_reserved
  from inventory.reservations
  where user_id = p_user_id and template_id = p_template_id and status = 'active';
  if v_quantity + p_amount < v_reserved then
    perform api.raise_business_error('INSUFFICIENT_INVENTORY', '藏品数量不足');
  end if;
  v_quantity := v_quantity + p_amount;
  update inventory.holdings set quantity = v_quantity, updated_at = now()
  where user_id = p_user_id and template_id = p_template_id;
  return v_quantity;
end;
$$;

create or replace function inventory.reserve(
  p_user_id uuid,
  p_template_id text,
  p_quantity bigint,
  p_kind text,
  p_reference_id uuid
)
returns inventory.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holding bigint;
  v_reserved bigint;
  v_reservation inventory.reservations%rowtype;
begin
  if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '占用数量无效'); end if;
  select quantity into v_holding
  from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id
  for update;
  if v_holding is null then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
  select coalesce(sum(quantity), 0) into v_reserved
  from inventory.reservations
  where user_id = p_user_id and template_id = p_template_id and status = 'active';
  if v_holding - v_reserved < p_quantity then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
  insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id)
  values (p_user_id, p_template_id, p_quantity, p_kind, p_reference_id)
  returning * into v_reservation;
  return v_reservation;
end;
$$;

create or replace function inventory.item_json(p_user_id uuid, p_template_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'chain_id', t.chain_id,
    'chain_type', c.chain_type,
    'image_thumbnail_path', t.image_thumbnail_path,
    'image_detail_path', t.image_detail_path,
    'combat_power', t.combat_power,
    'expedition_fgems', t.expedition_fgems,
    'decompose_fgems', t.decompose_fgems,
    'total', h.quantity,
    'available', inventory.available_quantity(p_user_id, t.id),
    'listed', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'listing' and r.status = 'active'), 0),
    'trading', 0,
    'expedition', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'expedition' and r.status = 'active'), 0),
    'minting', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'mint' and r.status = 'active'), 0)
  )
  from inventory.holdings h
  join catalog.templates t on t.id = h.template_id
  join catalog.chains c on c.id = t.chain_id
  where h.user_id = p_user_id and h.template_id = p_template_id and h.quantity > 0
$$;

create or replace function api.inventory_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(inventory.item_json(v_user_id, h.template_id) order by t.sort_order)
      from inventory.holdings h
      join catalog.templates t on t.id = h.template_id
      where h.user_id = v_user_id
        and h.quantity > 0
        and inventory.available_quantity(v_user_id, h.template_id) > 0
    ), '[]'::jsonb),
    'template_count', (
      select count(*)
      from inventory.holdings h
      where h.user_id = v_user_id
        and h.quantity > 0
        and inventory.available_quantity(v_user_id, h.template_id) > 0
    ),
    'total_quantity', (
      select coalesce(sum(inventory.available_quantity(v_user_id, h.template_id)), 0)
      from inventory.holdings h
      where h.user_id = v_user_id
        and h.quantity > 0
        and inventory.available_quantity(v_user_id, h.template_id) > 0
    )
  );
end;
$$;

create or replace function api.inventory_detail(p_session_id uuid, p_template_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  v_result := inventory.item_json(v_user_id, p_template_id);
  if v_result is null then
    perform api.raise_business_error('INVENTORY_ITEM_NOT_FOUND', '藏品不存在');
  end if;
  return v_result;
end;
$$;

-- source: 33_decomposition.sql
create or replace function api.inventory_decompose(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_template catalog.templates%rowtype;
  v_reward bigint;
  v_remaining bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'inventory.decompose', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 or inventory.available_quantity(v_user_id, p_template_id) < p_quantity then
      perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足');
    end if;
    perform inventory.change_holding(v_user_id, p_template_id, -p_quantity);
    v_reward := v_template.decompose_fgems * p_quantity;
    perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'decompose', p_operation_id, p_template_id);
    perform tasks.progress(v_user_id, 'decompose');
    select quantity into v_remaining from inventory.holdings where user_id = v_user_id and template_id = p_template_id;
    v_result := jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity, 'fgems_earned', v_reward, 'remaining', coalesce(v_remaining, 0), 'assets', economy.assets(v_user_id));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 40_gacha.sql
create table gacha.boxes (
  tier text primary key check (tier in ('normal', 'rare', 'legendary')),
  display_name text not null,
  image_path text not null unique,
  single_price bigint not null check (single_price > 0),
  ten_price bigint not null check (ten_price = single_price * 9),
  pity_limit smallint not null check (pity_limit > 0),
  pity_rarity text not null check (pity_rarity in ('rare', 'epic', 'legendary')),
  rarity_weights jsonb not null
);

create table gacha.pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  tier text not null references gacha.boxes(tier),
  progress smallint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

create or replace function gacha.rules_complete()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (select count(*) = 1 from catalog.versions where id = 'v1')
    and (select
      count(*) = 70
      and count(*) filter (where chain_type = 'normal') = 40
      and count(*) filter (where chain_type = 'advanced') = 20
      and count(*) filter (where chain_type = 'top') = 10
      from catalog.chains where catalog_version = 'v1'
    )
    and (select
      count(*) = 210
      and count(*) filter (where rarity = 'common') = 40
      and count(*) filter (where rarity = 'rare') = 60
      and count(*) filter (where rarity = 'epic') = 70
      and count(*) filter (where rarity = 'legendary') = 30
      and count(*) filter (where rarity = 'mythic') = 10
      from catalog.templates where catalog_version = 'v1'
    )
    and not exists (
      select 1
      from catalog.chains c
      left join catalog.templates t on t.chain_id = c.id
      group by c.id
      having count(t.id) <> 3
    )
    and not exists (
      select 1
      from catalog.templates t
      join catalog.chains c on c.id = t.chain_id
      where t.draw_weight <> 1
        or not case c.chain_type
          when 'normal' then (t.stage = 1 and t.rarity = 'common') or (t.stage = 2 and t.rarity = 'rare') or (t.stage = 3 and t.rarity = 'epic')
          when 'advanced' then (t.stage = 1 and t.rarity = 'rare') or (t.stage = 2 and t.rarity = 'epic') or (t.stage = 3 and t.rarity = 'legendary')
          when 'top' then (t.stage = 1 and t.rarity = 'epic') or (t.stage = 2 and t.rarity = 'legendary') or (t.stage = 3 and t.rarity = 'mythic')
          else false
        end
    )
    and (select count(*) = 3 from gacha.boxes)
    and not exists (
      select 1
      from (values
        ('normal'::text, '普通盲盒'::text, '/assets/boxes/normal.webp'::text, 9::bigint, 81::bigint, 50::smallint, 'rare'::text, '{"common":7200,"rare":2500,"epic":300,"legendary":0,"mythic":0}'::jsonb),
        ('rare', '稀有盲盒', '/assets/boxes/rare.webp', 40, 360, 30, 'epic', '{"common":2000,"rare":5500,"epic":2200,"legendary":300,"mythic":0}'::jsonb),
        ('legendary', '传说盲盒', '/assets/boxes/legendary.webp', 120, 1080, 15, 'legendary', '{"common":0,"rare":1800,"epic":5500,"legendary":2400,"mythic":300}'::jsonb)
      ) expected(tier, display_name, image_path, single_price, ten_price, pity_limit, pity_rarity, rarity_weights)
      left join gacha.boxes b on b.tier = expected.tier
      where b.tier is null
        or b.display_name is distinct from expected.display_name
        or b.image_path is distinct from expected.image_path
        or b.single_price is distinct from expected.single_price
        or b.ten_price is distinct from expected.ten_price
        or b.pity_limit is distinct from expected.pity_limit
        or b.pity_rarity is distinct from expected.pity_rarity
        or b.rarity_weights is distinct from expected.rarity_weights
    )
$$;

create or replace function api.gacha_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'boxes', coalesce((
      select jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes b
    ), '[]'::jsonb),
    'pity', coalesce((
      select jsonb_agg(jsonb_build_object(
        'tier', b.tier,
        'progress', coalesce(p.progress, 0),
        'limit', b.pity_limit,
        'target_rarity', b.pity_rarity
      ) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes b
      left join gacha.pity p on p.user_id = v_user_id and p.tier = b.tier
    ), '[]'::jsonb),
    'entitlements', jsonb_build_object(
      'free_normal_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'),
      'free_rare_box', (select count(*) from economy.entitlements where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused')
    ),
    'rules_complete', gacha.rules_complete()
  );
end;
$$;

create or replace function api.gacha_pool(p_session_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_box gacha.boxes%rowtype;
  v_rarities jsonb;
begin
  perform api.session_user(p_session_id);
  select * into v_box from gacha.boxes where tier = p_tier;
  if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;
  if not gacha.rules_complete() then perform api.raise_business_error('CATALOG_INVALID', '奖池加载失败，请重试'); end if;

  with candidates as (
    select
      t.*,
      (v_box.rarity_weights->>t.rarity)::integer as rarity_probability_basis_points,
      sum(t.draw_weight) over (partition by t.rarity) as catalog_total_weight
    from catalog.templates t
    where t.catalog_version = 'v1'
      and (v_box.rarity_weights->>t.rarity)::integer > 0
  ), rarity_groups as (
    select
      c.rarity,
      max(c.rarity_probability_basis_points) as rarity_probability_basis_points,
      max(c.catalog_total_weight) as catalog_total_weight,
      jsonb_agg(jsonb_build_object(
        'template_id', c.id,
        'name', c.name,
        'rarity', c.rarity,
        'stage', c.stage,
        'image_thumbnail_path', c.image_thumbnail_path,
        'catalog_weight', c.draw_weight,
        'single_probability_percent', round(c.rarity_probability_basis_points::numeric * c.draw_weight / (c.catalog_total_weight * 100), 6)
      ) order by c.sort_order) as items
    from candidates c
    group by c.rarity
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'rarity', rarity,
    'rarity_probability_basis_points', rarity_probability_basis_points,
    'rarity_probability_percent', round(rarity_probability_basis_points::numeric / 100, 2),
    'catalog_total_weight', catalog_total_weight,
    'items', items
  ) order by catalog.rarity_rank(rarity)), '[]'::jsonb)
  into v_rarities
  from rarity_groups;

  return jsonb_build_object(
    'tier', v_box.tier,
    'display_name', v_box.display_name,
    'catalog_version', 'v1',
    'pity', jsonb_build_object('limit', v_box.pity_limit, 'target_rarity', v_box.pity_rarity),
    'rarities', v_rarities
  );
end;
$$;

create or replace function api.gacha_recoverable_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id
        and o.use_case = 'gacha.open'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.gacha_acknowledge_result(
  p_session_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
begin
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id
    and o.user_id = v_user_id
    and o.use_case = 'gacha.open'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '开盒操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '开盒结果尚未确定');
  end if;
  if v_operation.result_acknowledged_at is null then
    update operations.operations
    set result_acknowledged_at = now(), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'acknowledged_at', v_operation.result_acknowledged_at
  );
end;
$$;

create or replace function api.gacha_open(
  p_session_id uuid,
  p_operation_id uuid,
  p_tier text,
  p_draw_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_box gacha.boxes%rowtype;
  v_template catalog.templates%rowtype;
  v_entitlement_id uuid;
  v_entitlement_kind text;
  v_price bigint := 0;
  v_progress integer := 0;
  v_random integer;
  v_rarity text;
  v_results jsonb := '[]'::jsonb;
  v_new_album boolean;
  v_triggered boolean;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id, 'gacha.open', p_operation_id,
    jsonb_build_object('tier', p_tier, 'draw_count', p_draw_count)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;

  begin
    if p_draw_count not in (1, 10) then
      perform api.raise_business_error('DRAW_COUNT_INVALID', '开盒次数无效');
    end if;
    lock table catalog.versions, catalog.chains, catalog.templates, gacha.boxes in share mode;
    select * into v_box from gacha.boxes where tier = p_tier;
    if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;
    if not gacha.rules_complete() then perform api.raise_business_error('CATALOG_INVALID', '开盒规则加载失败，请重新加载'); end if;

    if p_draw_count = 1 and p_tier in ('normal', 'rare') then
      v_entitlement_kind := case p_tier when 'normal' then 'free_normal_box' else 'free_rare_box' end;
      select id into v_entitlement_id
      from economy.entitlements
      where user_id = v_user_id and kind = v_entitlement_kind and status = 'unused'
      order by obtained_at, id limit 1 for update;
    end if;

    if v_entitlement_id is not null then
      update economy.entitlements set status = 'used', used_at = now() where id = v_entitlement_id;
    else
      v_price := case when p_draw_count = 10 then v_box.ten_price else v_box.single_price end;
      perform economy.change_balance(v_user_id, 'KCOIN', -v_price, 'gacha', p_operation_id, p_tier);
      insert into gacha.pity (user_id, tier) values (v_user_id, p_tier) on conflict do nothing;
      select progress into v_progress from gacha.pity where user_id = v_user_id and tier = p_tier for update;
    end if;

    for v_i in 1..p_draw_count loop
      v_random := identity.random_basis_points();
      if v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) then v_rarity := 'common';
      elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) then v_rarity := 'rare';
      elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) + coalesce((v_box.rarity_weights->>'epic')::integer, 0) then v_rarity := 'epic';
      elsif v_random < 10000 - coalesce((v_box.rarity_weights->>'mythic')::integer, 0) then v_rarity := 'legendary';
      else v_rarity := 'mythic';
      end if;

      v_triggered := false;
      if v_entitlement_id is null then
        if catalog.rarity_rank(v_rarity) >= catalog.rarity_rank(v_box.pity_rarity) then
          v_progress := 0;
        elsif v_progress + 1 >= v_box.pity_limit then
          v_rarity := v_box.pity_rarity;
          v_progress := 0;
          v_triggered := true;
        else
          v_progress := v_progress + 1;
        end if;
      end if;

      select * into v_template from catalog.templates
      where catalog_version = 'v1' and rarity = v_rarity
      order by extensions.gen_random_uuid() limit 1;
      if v_template.id is null then perform api.raise_business_error('CATALOG_INVALID', '目录缺少抽取候选'); end if;
      perform inventory.change_holding(v_user_id, v_template.id, 1);
      v_new_album := album.unlock_template(v_user_id, v_template.id, p_operation_id);
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order', v_i, 'template_id', v_template.id, 'name', v_template.name,
        'rarity', v_template.rarity, 'stage', v_template.stage, 'quantity', 1,
        'image_thumbnail_path', v_template.image_thumbnail_path,
        'image_detail_path', v_template.image_detail_path,
        'new_album', v_new_album, 'pity_triggered', v_triggered
      ));
    end loop;

    if v_entitlement_id is null then
      update gacha.pity set progress = v_progress, updated_at = now()
      where user_id = v_user_id and tier = p_tier;
    else
      select p.progress into v_progress from gacha.pity p
      where p.user_id = v_user_id and p.tier = p_tier for share;
      v_progress := coalesce(v_progress, 0);
    end if;
    if p_draw_count = 1 then
      perform tasks.progress(v_user_id, 'gacha_1');
      perform tasks.progress(v_user_id, 'gacha_10');
    else
      perform tasks.progress(v_user_id, 'gacha_ten');
    end if;

    v_result := jsonb_build_object(
      'tier', p_tier,
      'draw_count', p_draw_count,
      'paid_kcoin', v_price,
      'entitlement_used', case when v_entitlement_id is null then null else v_entitlement_kind end,
      'results', v_results,
      'pity', jsonb_build_object('tier', p_tier, 'progress', v_progress, 'limit', v_box.pity_limit, 'target_rarity', v_box.pity_rarity),
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 41_expedition.sql
create table expedition.expeditions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique references operations.operations(id),
  tier text not null check (tier in ('normal', 'intermediate', 'advanced')),
  status text not null default 'running' check (status in ('running', 'claimable', 'claimed')),
  reward_fgems bigint not null check (reward_fgems > 0),
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  claimed_at timestamptz,
  check (completes_at > started_at)
);

create unique index expeditions_user_tier_active_idx on expedition.expeditions (user_id, tier) where status in ('running', 'claimable');
create index expeditions_due_idx on expedition.expeditions (completes_at) where status = 'running';

create table expedition.items (
  expedition_id uuid not null references expedition.expeditions(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  primary key (expedition_id, template_id)
);

create index expedition_items_template_idx on expedition.items (template_id, expedition_id);

create or replace function api.expedition_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'rules', jsonb_build_array(
      jsonb_build_object('tier', 'normal', 'duration_minutes', 30, 'daily_limit', 2, 'allowed_rarities', jsonb_build_array('common', 'rare', 'epic')),
      jsonb_build_object('tier', 'intermediate', 'duration_minutes', 60, 'daily_limit', 1, 'allowed_rarities', jsonb_build_array('rare', 'epic', 'legendary')),
      jsonb_build_object('tier', 'advanced', 'duration_minutes', 180, 'daily_limit', 1, 'allowed_rarities', jsonb_build_array('epic', 'legendary', 'mythic'))
    ),
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'tier', e.tier,
        'status', case when e.status = 'running' and e.completes_at <= now() then 'claimable' else e.status end,
        'reward_fgems', e.reward_fgems,
        'started_at', e.started_at,
        'completes_at', e.completes_at,
        'claimed_at', e.claimed_at
      ) order by e.started_at)
      from expedition.expeditions e
      where e.user_id = v_user_id and e.status in ('running', 'claimable')
    ), '[]'::jsonb),
    'used_today', jsonb_build_object(
      'normal', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'normal' and (started_at at time zone 'utc')::date = identity.utc_day()),
      'intermediate', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'intermediate' and (started_at at time zone 'utc')::date = identity.utc_day()),
      'advanced', (select count(*) from expedition.expeditions where user_id = v_user_id and tier = 'advanced' and (started_at at time zone 'utc')::date = identity.utc_day())
    ),
    'server_time', now()
  );
end;
$$;

create or replace function api.expedition_eligible_items(p_session_id uuid, p_tier text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  if p_tier not in ('normal', 'intermediate', 'advanced') then
    perform api.raise_business_error('EXPEDITION_TIER_INVALID', '远征档次无效');
  end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(inventory.item_json(v_user_id, t.id) || jsonb_build_object('unit_reward_fgems', t.expedition_fgems) order by t.sort_order)
    from inventory.holdings h
    join catalog.templates t on t.id = h.template_id
    where h.user_id = v_user_id and inventory.available_quantity(v_user_id, t.id) > 0
      and ((p_tier = 'normal' and catalog.rarity_rank(t.rarity) between 1 and 3)
        or (p_tier = 'intermediate' and catalog.rarity_rank(t.rarity) between 2 and 4)
        or (p_tier = 'advanced' and catalog.rarity_rank(t.rarity) between 3 and 5))
  ), '[]'::jsonb));
end;
$$;

create or replace function api.expedition_create(
  p_session_id uuid,
  p_operation_id uuid,
  p_tier text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_expedition expedition.expeditions%rowtype;
  v_template catalog.templates%rowtype;
  v_item record;
  v_units bigint;
  v_reward bigint := 0;
  v_limit integer;
  v_duration interval;
  v_used integer;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'expedition.create', p_operation_id, jsonb_build_object('tier', p_tier, 'items', p_items));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select case p_tier when 'normal' then 2 when 'intermediate' then 1 when 'advanced' then 1 end,
           case p_tier when 'normal' then interval '30 minutes' when 'intermediate' then interval '1 hour' when 'advanced' then interval '3 hours' end
    into v_limit, v_duration;
    if v_limit is null then perform api.raise_business_error('EXPEDITION_TIER_INVALID', '远征档次无效'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_tier || ':' || identity.utc_day()::text, 0));
    select count(*) into v_used from expedition.expeditions where user_id = v_user_id and tier = p_tier and (started_at at time zone 'utc')::date = identity.utc_day();
    if v_used >= v_limit then perform api.raise_business_error('EXPEDITION_LIMIT_REACHED', '今日远征次数已用完'); end if;
    if exists (select 1 from expedition.expeditions where user_id = v_user_id and tier = p_tier and status in ('running', 'claimable')) then
      perform api.raise_business_error('EXPEDITION_ALREADY_ACTIVE', '同档远征尚未领取');
    end if;
    select coalesce(sum((item->>'quantity')::bigint), 0) into v_units from jsonb_array_elements(p_items) item;
    if v_units <> 3 then perform api.raise_business_error('EXPEDITION_ITEMS_INVALID', '每次必须派遣三个藏品单位'); end if;

    for v_item in
      select item->>'template_id' template_id, sum((item->>'quantity')::bigint) quantity
      from jsonb_array_elements(p_items) item group by item->>'template_id' order by item->>'template_id'
    loop
      select * into v_template from catalog.templates where id = v_item.template_id;
      if v_template.id is null
        or (p_tier = 'normal' and catalog.rarity_rank(v_template.rarity) not between 1 and 3)
        or (p_tier = 'intermediate' and catalog.rarity_rank(v_template.rarity) not between 2 and 4)
        or (p_tier = 'advanced' and catalog.rarity_rank(v_template.rarity) not between 3 and 5) then
        perform api.raise_business_error('EXPEDITION_ITEMS_INVALID', '藏品不符合远征要求');
      end if;
      v_reward := v_reward + v_template.expedition_fgems * v_item.quantity;
    end loop;

    insert into expedition.expeditions (user_id, operation_id, tier, reward_fgems, completes_at)
    values (v_user_id, p_operation_id, p_tier, v_reward, now() + v_duration) returning * into v_expedition;
    for v_item in
      select item->>'template_id' template_id, sum((item->>'quantity')::bigint) quantity
      from jsonb_array_elements(p_items) item group by item->>'template_id' order by item->>'template_id'
    loop
      insert into expedition.items (expedition_id, template_id, quantity) values (v_expedition.id, v_item.template_id, v_item.quantity);
      perform inventory.reserve(v_user_id, v_item.template_id, v_item.quantity::bigint, 'expedition', v_expedition.id);
    end loop;
    v_result := jsonb_build_object(
      'expedition', jsonb_build_object('id', v_expedition.id, 'tier', v_expedition.tier, 'status', 'running', 'reward_fgems', v_expedition.reward_fgems, 'started_at', v_expedition.started_at, 'completes_at', v_expedition.completes_at, 'claimed_at', null),
      'items', p_items, 'total_units', 3
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.expedition_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_expedition_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_expedition expedition.expeditions%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'expedition.claim', p_operation_id, jsonb_build_object('expedition_id', p_expedition_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_expedition from expedition.expeditions where id = p_expedition_id and user_id = v_user_id for update;
    if v_expedition.id is null then perform api.raise_business_error('EXPEDITION_NOT_FOUND', '远征不存在'); end if;
    if v_expedition.status = 'claimed' or v_expedition.completes_at > now() then perform api.raise_business_error('EXPEDITION_NOT_READY', '远征尚不可领取'); end if;
    update expedition.expeditions set status = 'claimed', claimed_at = now() where id = p_expedition_id returning * into v_expedition;
    update inventory.reservations set status = 'released', released_at = now() where kind = 'expedition' and reference_id = p_expedition_id and status = 'active';
    perform economy.change_balance(v_user_id, 'FGEMS', v_expedition.reward_fgems, 'expedition', p_operation_id, p_expedition_id::text);
    perform tasks.progress(v_user_id, 'expedition_' || v_expedition.tier);
    v_result := jsonb_build_object('expedition_id', p_expedition_id, 'reward_fgems', v_expedition.reward_fgems, 'status', 'claimed', 'claimed_at', v_expedition.claimed_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 42_wheel.sql
create table wheel.daily (
  user_id uuid not null references identity.users(id) on delete cascade,
  business_date date not null,
  spin_count smallint not null default 0 check (spin_count between 0 and 20),
  normal_entitlements smallint not null default 0 check (normal_entitlements between 0 and 3),
  rare_entitlements smallint not null default 0 check (rare_entitlements between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

create table wheel.results (
  operation_id uuid not null references operations.operations(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 10),
  rolled_kind text not null,
  delivered_kind text not null,
  amount bigint not null check (amount > 0),
  replaced boolean not null default false,
  primary key (operation_id, sequence)
);

create or replace function api.wheel_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_count integer;
begin
  select coalesce(spin_count, 0) into v_count
  from wheel.daily where user_id = v_user_id and business_date = identity.utc_day();
  v_count := coalesce(v_count, 0);
  return jsonb_build_object(
    'spin_count', v_count,
    'remaining', 20 - v_count,
    'daily_limit', 20,
    'single_cost', 20,
    'ten_cost', 180,
    'milestone_10_claimed', v_count >= 10,
    'milestone_20_claimed', v_count >= 20
  );
end;
$$;

create or replace function api.wheel_recoverable_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id
        and o.use_case = 'wheel.spin'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.wheel_acknowledge_result(
  p_session_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
begin
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id
    and o.user_id = v_user_id
    and o.use_case = 'wheel.spin'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '转盘操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '转盘结果尚未确定');
  end if;
  if v_operation.result_acknowledged_at is null then
    update operations.operations
    set result_acknowledged_at = now(), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'acknowledged_at', v_operation.result_acknowledged_at
  );
end;
$$;

create or replace function api.wheel_spin(
  p_session_id uuid,
  p_operation_id uuid,
  p_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_spin_count integer;
  v_normal integer;
  v_rare integer;
  v_cost bigint;
  v_random integer;
  v_kind text;
  v_rolled text;
  v_amount bigint;
  v_replaced text;
  v_milestone bigint := 0;
  v_reward_fgems bigint := 0;
  v_reward_kcoin bigint := 0;
  v_reward_normal integer := 0;
  v_reward_rare integer := 0;
  v_replaced_normal integer := 0;
  v_replaced_rare integer := 0;
  v_rewards jsonb := '[]'::jsonb;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wheel.spin', p_operation_id, jsonb_build_object('count', p_count));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_count not in (1, 10) then perform api.raise_business_error('WHEEL_COUNT_INVALID', '转盘次数无效'); end if;
    insert into wheel.daily (user_id, business_date) values (v_user_id, identity.utc_day()) on conflict do nothing;
    select spin_count, normal_entitlements, rare_entitlements into v_spin_count, v_normal, v_rare
    from wheel.daily where user_id = v_user_id and business_date = identity.utc_day() for update;
    if v_spin_count + p_count > 20 then perform api.raise_business_error('WHEEL_DAILY_LIMIT', '今日转盘次数不足'); end if;
    v_cost := case when p_count = 10 then 180 else 20 end;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_cost, 'wheel', p_operation_id, p_count::text);
    for v_i in 1..p_count loop
      v_random := identity.random_basis_points();
      if v_random < 2400 then v_kind := 'fgems'; v_amount := 20;
      elsif v_random < 4100 then v_kind := 'fgems'; v_amount := 30;
      elsif v_random < 4800 then v_kind := 'fgems'; v_amount := 50;
      elsif v_random < 4950 then v_kind := 'fgems'; v_amount := 100;
      elsif v_random < 7050 then v_kind := 'kcoin'; v_amount := 10;
      elsif v_random < 8250 then v_kind := 'kcoin'; v_amount := 20;
      elsif v_random < 8950 then v_kind := 'kcoin'; v_amount := 30;
      elsif v_random < 9350 then v_kind := 'kcoin'; v_amount := 50;
      elsif v_random < 9550 then v_kind := 'kcoin'; v_amount := 100;
      elsif v_random < 9980 then v_kind := 'free_normal_box'; v_amount := 1;
      else v_kind := 'free_rare_box'; v_amount := 1;
      end if;
      v_rolled := v_kind;
      v_replaced := null;
      if v_kind = 'free_normal_box' then
        if v_normal >= 3 then v_replaced := v_kind; v_kind := 'fgems'; v_amount := 30; else v_normal := v_normal + 1; end if;
      elsif v_kind = 'free_rare_box' then
        if v_rare >= 1 then v_replaced := v_kind; v_kind := 'fgems'; v_amount := 100; else v_rare := v_rare + 1; end if;
      end if;
      if v_kind in ('kcoin', 'fgems') then
        perform economy.change_balance(v_user_id, upper(v_kind), v_amount, 'wheel_reward', p_operation_id, v_i::text);
      else
        insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, v_kind, 'wheel', p_operation_id);
      end if;
      if v_kind = 'fgems' then v_reward_fgems := v_reward_fgems + v_amount;
      elsif v_kind = 'kcoin' then v_reward_kcoin := v_reward_kcoin + v_amount;
      elsif v_kind = 'free_normal_box' then v_reward_normal := v_reward_normal + v_amount;
      else v_reward_rare := v_reward_rare + v_amount;
      end if;
      if v_replaced = 'free_normal_box' then v_replaced_normal := v_replaced_normal + 1;
      elsif v_replaced = 'free_rare_box' then v_replaced_rare := v_replaced_rare + 1;
      end if;
      insert into wheel.results (operation_id, sequence, rolled_kind, delivered_kind, amount, replaced)
      values (p_operation_id, v_i, v_rolled, v_kind, v_amount, v_replaced is not null);
      v_rewards := v_rewards || jsonb_build_array(jsonb_build_object('order', v_i, 'kind', v_kind, 'amount', v_amount, 'replaced_kind', v_replaced));
    end loop;
    if v_spin_count < 10 and v_spin_count + p_count >= 10 then v_milestone := v_milestone + 25; end if;
    if v_spin_count < 20 and v_spin_count + p_count >= 20 then v_milestone := v_milestone + 25; end if;
    if v_milestone > 0 then perform economy.change_balance(v_user_id, 'FGEMS', v_milestone, 'wheel_milestone', p_operation_id, identity.utc_day()::text); end if;
    update wheel.daily set spin_count = v_spin_count + p_count, normal_entitlements = v_normal, rare_entitlements = v_rare, updated_at = now()
    where user_id = v_user_id and business_date = identity.utc_day();
    perform tasks.progress(v_user_id, 'wheel_spin');
    v_result := jsonb_build_object(
      'count', p_count,
      'cost_kcoin', v_cost,
      'kcoin_returned', v_reward_kcoin,
      'net_kcoin_change', v_reward_kcoin - v_cost,
      'rewards', v_rewards,
      'reward_summary', jsonb_build_object(
        'fgems', v_reward_fgems,
        'kcoin', v_reward_kcoin,
        'free_normal_box', v_reward_normal,
        'free_rare_box', v_reward_rare,
        'replaced_free_normal_box', v_replaced_normal,
        'replaced_free_rare_box', v_replaced_rare
      ),
      'milestone', jsonb_build_object(
        'awarded_fgems', v_milestone,
        'milestone_10_claimed', v_spin_count + p_count >= 10,
        'milestone_20_claimed', v_spin_count + p_count >= 20
      ),
      'entitlements', jsonb_build_object(
        'free_normal_box', (
          select count(*) from economy.entitlements
          where user_id = v_user_id and kind = 'free_normal_box' and status = 'unused'
        ),
        'free_rare_box', (
          select count(*) from economy.entitlements
          where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused'
        )
      ),
      'spin_count', v_spin_count + p_count,
      'remaining', 20 - v_spin_count - p_count,
      'daily_limit', 20,
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 43_evolution.sql
create table evolution.pity (
  user_id uuid not null references identity.users(id) on delete cascade,
  from_template_id text not null references catalog.templates(id),
  failures smallint not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_template_id)
);

create or replace function evolution.template_json(p_template catalog.templates)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', (p_template).id,
    'name', (p_template).name,
    'rarity', (p_template).rarity,
    'stage', (p_template).stage,
    'image_thumbnail_path', (p_template).image_thumbnail_path,
    'image_detail_path', (p_template).image_detail_path
  )
$$;

create or replace function evolution.rule(p_rarity text)
returns table (success_rate_percent integer, fgems_cost bigint, guarantee_attempt integer)
language sql
immutable
set search_path = ''
as $$
  select
    case p_rarity when 'rare' then 95 when 'epic' then 60 when 'legendary' then 35 when 'mythic' then 20 end,
    (case p_rarity when 'rare' then 30 when 'epic' then 120 when 'legendary' then 500 when 'mythic' then 2000 end)::bigint,
    case p_rarity when 'rare' then 2 when 'epic' then 3 when 'legendary' then 5 when 'mythic' then 8 end
  where p_rarity in ('rare', 'epic', 'legendary', 'mythic')
$$;

create or replace function api.inventory_evolution_preview(
  p_session_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_source catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_available bigint;
  v_fgems bigint;
  v_rate integer;
  v_cost bigint;
  v_guarantee integer;
  v_failures integer := 0;
  v_reason text;
begin
  select t.* into v_source
  from catalog.templates t
  join inventory.holdings h on h.template_id = t.id
  where t.id = p_template_id and h.user_id = v_user_id and h.quantity > 0;
  if v_source.id is null then
    perform api.raise_business_error('INVENTORY_ITEM_NOT_FOUND', '藏品不存在');
  end if;

  v_available := inventory.available_quantity(v_user_id, v_source.id);
  select coalesce(b.available, 0) into v_fgems
  from economy.balances b
  where b.user_id = v_user_id and b.currency = 'FGEMS';
  v_fgems := coalesce(v_fgems, 0);

  if v_source.stage >= 3 then
    v_reason := 'final_stage';
  else
    select * into v_target
    from catalog.templates
    where chain_id = v_source.chain_id and stage = v_source.stage + 1;
    if v_target.id is null then
      v_reason := 'target_unavailable';
    else
      select * into v_rate, v_cost, v_guarantee from evolution.rule(v_target.rarity);
      select coalesce(p.failures, 0) into v_failures
      from evolution.pity p
      where p.user_id = v_user_id and p.from_template_id = v_source.id;
      v_failures := coalesce(v_failures, 0);
      if v_rate is null then
        v_reason := 'target_unavailable';
      elsif v_available < 3 then
        v_reason := 'insufficient_materials';
      elsif v_fgems < v_cost then
        v_reason := 'insufficient_fgems';
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'source', evolution.template_json(v_source),
    'target', case when v_target.id is null then null else evolution.template_json(v_target) end,
    'materials', jsonb_build_object(
      'required', 3,
      'available', v_available,
      'failure_consumed', 2,
      'failure_retained', 1
    ),
    'success_rate_percent', v_rate,
    'fgems', jsonb_build_object('cost', v_cost, 'available', v_fgems),
    'pity', case when v_guarantee is null then null else jsonb_build_object(
      'failure_count', v_failures,
      'guarantee_attempt', v_guarantee,
      'failures_until_guaranteed', greatest(v_guarantee - v_failures - 1, 0),
      'guaranteed_this_attempt', v_failures + 1 >= v_guarantee
    ) end,
    'eligibility', jsonb_build_object('eligible', v_reason is null, 'reason', v_reason)
  );
end;
$$;

create or replace function api.inventory_evolution_recoverable_results(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at)
      from operations.operations o
      where o.user_id = v_user_id
        and o.use_case = 'inventory.evolve'
        and o.result_acknowledged_at is null
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.inventory_evolution_acknowledge_result(
  p_session_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
begin
  select * into v_operation
  from operations.operations o
  where o.id = p_operation_id
    and o.user_id = v_user_id
    and o.use_case = 'inventory.evolve'
  for update;
  if v_operation.id is null then
    perform api.raise_business_error('OPERATION_NOT_FOUND', '进化操作记录不存在');
  end if;
  if v_operation.status not in ('succeeded', 'failed') then
    perform api.raise_business_error('OPERATION_NOT_ACKNOWLEDGEABLE', '进化结果尚未确定');
  end if;
  if v_operation.result_acknowledged_at is null then
    update operations.operations
    set result_acknowledged_at = now(), updated_at = now()
    where id = p_operation_id
    returning * into v_operation;
  end if;
  return jsonb_build_object(
    'operation_id', v_operation.id,
    'acknowledged_at', v_operation.result_acknowledged_at
  );
end;
$$;

create or replace function api.inventory_evolve(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_source catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_rate integer;
  v_cost bigint;
  v_guarantee integer;
  v_previous_failures integer;
  v_current_failures integer;
  v_available bigint;
  v_fgems bigint;
  v_fgems_required bigint;
  v_attempts bigint;
  v_attempt bigint := 0;
  v_successes bigint := 0;
  v_failures bigint := 0;
  v_guaranteed_attempts bigint := 0;
  v_materials_consumed bigint;
  v_guaranteed boolean;
  v_success boolean;
  v_new_album boolean := false;
  v_result jsonb;
  v_error_code text;
begin
  v_operation := operations.begin_command(p_session_id, 'inventory.evolve', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_quantity <= 0 or p_quantity % 3 <> 0 then
      perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '进化材料数量必须是 3 的正整数倍');
    end if;
    v_attempts := p_quantity / 3;
    select * into v_source from catalog.templates where id = p_template_id;
    if v_source.id is null or v_source.stage >= 3 then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    select * into v_target from catalog.templates where chain_id = v_source.chain_id and stage = v_source.stage + 1;
    if v_target.id is null then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    select * into v_rate, v_cost, v_guarantee from evolution.rule(v_target.rarity);
    if v_rate is null then perform api.raise_business_error('EVOLUTION_NOT_AVAILABLE', '当前藏品不能进化'); end if;
    perform 1
    from inventory.holdings
    where user_id = v_user_id and template_id = v_source.id
    for update;
    v_available := inventory.available_quantity(v_user_id, v_source.id);
    if v_available < p_quantity then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用进化材料数量不足'); end if;
    select coalesce(b.available, 0) into v_fgems
    from economy.balances b
    where b.user_id = v_user_id and b.currency = 'FGEMS';
    v_fgems := coalesce(v_fgems, 0);
    v_fgems_required := v_cost * v_attempts;
    if v_fgems < v_fgems_required then perform api.raise_business_error('INSUFFICIENT_BALANCE', 'Fgems 不足'); end if;
    insert into evolution.pity (user_id, from_template_id) values (v_user_id, v_source.id) on conflict do nothing;
    select failures into v_previous_failures from evolution.pity where user_id = v_user_id and from_template_id = v_source.id for update;
    v_current_failures := v_previous_failures;
    perform economy.change_balance(v_user_id, 'FGEMS', -v_fgems_required, 'evolution', p_operation_id, v_source.id);
    while v_attempt < v_attempts loop
      v_attempt := v_attempt + 1;
      v_guaranteed := v_current_failures + 1 >= v_guarantee;
      v_success := v_guaranteed or identity.random_basis_points() < v_rate * 100;
      if v_success then
        v_successes := v_successes + 1;
        if v_guaranteed then v_guaranteed_attempts := v_guaranteed_attempts + 1; end if;
        v_current_failures := 0;
      else
        v_failures := v_failures + 1;
        v_current_failures := v_current_failures + 1;
      end if;
    end loop;
    v_materials_consumed := v_successes * 3 + v_failures * 2;
    perform inventory.change_holding(v_user_id, v_source.id, -v_materials_consumed);
    if v_successes > 0 then
      perform inventory.change_holding(v_user_id, v_target.id, v_successes);
      v_new_album := album.unlock_template(v_user_id, v_target.id, p_operation_id);
      perform tasks.progress(v_user_id, 'evolution_success', v_successes);
    end if;
    update evolution.pity set failures = v_current_failures, updated_at = now() where user_id = v_user_id and from_template_id = v_source.id;
    perform tasks.progress(v_user_id, 'evolution_attempt', v_attempts);
    v_result := jsonb_build_object(
      'attempt_count', v_attempts,
      'success_count', v_successes,
      'failure_count', v_failures,
      'source', evolution.template_json(v_source),
      'target', evolution.template_json(v_target),
      'materials', jsonb_build_object(
        'selected', p_quantity,
        'consumed', v_materials_consumed,
        'retained', v_failures
      ),
      'success_rate_percent', v_rate,
      'fgems_cost_per_attempt', v_cost,
      'fgems_spent', v_fgems_required,
      'pity', jsonb_build_object(
        'previous_failure_count', v_previous_failures,
        'current_failure_count', v_current_failures,
        'guarantee_attempt', v_guarantee,
        'failures_until_guaranteed', greatest(v_guarantee - v_current_failures - 1, 0),
        'guaranteed_attempts', v_guaranteed_attempts
      ),
      'target_awarded', v_successes,
      'new_album', v_new_album,
      'assets', economy.assets(v_user_id)
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    v_error_code := case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end;
    return operations.fail_command(p_operation_id, v_error_code, jsonb_build_object(
      'outcome', 'rejected',
      'source_template_id', coalesce(v_source.id, p_template_id),
      'target_template_id', v_target.id,
      'available_quantity', v_available,
      'fgems_available', v_fgems,
      'fgems_cost', v_cost,
      'error_code', v_error_code
    ));
  end;
end;
$$;

-- source: 44_monster_tamer.sql
create table monster_tamer.rulesets (
  id text primary key check (id ~ '^v[0-9]+$'),
  map_checksum text not null check (map_checksum ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index monster_tamer_one_active_ruleset_idx
on monster_tamer.rulesets (active)
where active;

create table monster_tamer.chain_profiles (
  chain_id text primary key references catalog.chains(id) on delete cascade,
  rules_version text not null references monster_tamer.rulesets(id),
  element text not null check (element in ('water', 'fire', 'wood', 'wind', 'lightning'))
);

create table monster_tamer.skill_profiles (
  rules_version text not null references monster_tamer.rulesets(id),
  element text not null check (element in ('water', 'fire', 'wood', 'wind', 'lightning')),
  stage smallint not null check (stage between 1 and 3),
  slot smallint not null check (slot between 1 and 3),
  code text not null,
  name text not null,
  power_bp integer not null check (power_bp between 0 and 30000),
  effect_kind text not null check (
    effect_kind in (
      'none', 'heal_self', 'shield_self', 'burn_enemy', 'attack_up_self',
      'drain_self', 'regen_self', 'weaken_enemy', 'charge_self'
    )
  ),
  effect_value_bp integer not null check (effect_value_bp between 0 and 30000),
  duration_turns smallint not null check (duration_turns between 0 and 10),
  primary key (rules_version, element, stage, slot),
  unique (rules_version, code)
);

create table monster_tamer.regions (
  id text primary key check (
    id in (
      'camp', 'luminous_forest', 'tidal_wetland', 'windswept_highlands',
      'crystal_cavern', 'molten_basin', 'hidden_cave', 'guardian_lair'
    )
  ),
  rules_version text not null references monster_tamer.rulesets(id),
  name text not null,
  sort_order smallint not null unique check (sort_order between 1 and 8),
  element text check (element in ('water', 'fire', 'wood', 'wind', 'lightning')),
  width_tiles smallint not null check (width_tiles between 8 and 128),
  height_tiles smallint not null check (height_tiles between 8 and 128),
  spawn_x smallint not null check (spawn_x >= 0 and spawn_x < width_tiles),
  spawn_y smallint not null check (spawn_y >= 0 and spawn_y < height_tiles),
  environment_effect_code text not null,
  difficulty_min_bp integer not null check (difficulty_min_bp between 5000 and 20000),
  difficulty_max_bp integer not null check (difficulty_max_bp between difficulty_min_bp and 25000)
);

create table monster_tamer.world_cells (
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  cell_id text not null check (cell_id ~ '^[0-9]+:[0-9]+$'),
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  walkable boolean not null,
  primary key (rules_version, region_id, cell_id),
  unique (rules_version, region_id, x, y),
  check (cell_id = x::text || ':' || y::text)
);

create table monster_tamer.world_nodes (
  id text primary key,
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  kind text not null check (
    kind in ('chest', 'gate', 'shortcut', 'supply', 'gather', 'exit', 'rematch')
  ),
  name text not null,
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  required_ability text check (
    required_ability in ('vine_bridge', 'tidal_walk', 'wind_glide', 'lightning_charge', 'heat_shield')
  ),
  target_region text references monster_tamer.regions(id),
  refreshable boolean not null,
  supply_reward integer not null default 0 check (supply_reward between 0 and 20),
  heal_bp integer not null default 0 check (heal_bp between 0 and 10000)
);

create index monster_tamer_world_nodes_region_idx
on monster_tamer.world_nodes (region_id, kind, id);

create table monster_tamer.encounter_definitions (
  id text primary key,
  rules_version text not null references monster_tamer.rulesets(id),
  region_id text not null references monster_tamer.regions(id),
  kind text not null check (kind in ('normal', 'elite', 'boss', 'guardian')),
  template_id text not null references catalog.templates(id),
  x smallint not null check (x >= 0),
  y smallint not null check (y >= 0),
  supply_reward integer not null default 0 check (supply_reward between 0 and 20),
  reward_ability text check (
    reward_ability in ('vine_bridge', 'tidal_walk', 'wind_glide', 'lightning_charge', 'heat_shield')
  ),
  mechanic_code text not null check (
    mechanic_code in (
      'none', 'forest_regrowth', 'wetland_tide_shield',
      'highland_gust_followup', 'cavern_thunder_cycle',
      'basin_scorch', 'guardian_element_cycle'
    )
  ),
  engage_radius smallint not null check (engage_radius between 1 and 5),
  check (
    (kind in ('normal', 'elite') and mechanic_code = 'none')
    or (kind in ('boss', 'guardian') and mechanic_code <> 'none')
  )
);

create index monster_tamer_encounters_region_idx
on monster_tamer.encounter_definitions (region_id, kind, id);

create table monster_tamer.rematch_nodes (
  node_id text primary key references monster_tamer.world_nodes(id) on delete cascade,
  encounter_id text not null unique references monster_tamer.encounter_definitions(id) on delete cascade
);

create table monster_tamer.player_progress (
  user_id uuid primary key references identity.users(id) on delete cascade,
  rules_version text not null references monster_tamer.rulesets(id),
  state_version bigint not null default 0 check (state_version >= 0),
  current_region text not null default 'camp' references monster_tamer.regions(id),
  resume_x smallint not null check (resume_x >= 0),
  resume_y smallint not null check (resume_y >= 0),
  region_entry_serial bigint not null default 0 check (region_entry_serial >= 0),
  party_template_ids text[] not null default '{}'::text[],
  party_state jsonb not null default '[]'::jsonb check (jsonb_typeof(party_state) = 'array'),
  unlocked_regions text[] not null default array['luminous_forest', 'tidal_wetland']::text[],
  abilities text[] not null default '{}'::text[],
  revealed_cells jsonb not null default '{}'::jsonb check (jsonb_typeof(revealed_cells) = 'object'),
  completed_node_ids text[] not null default '{}'::text[],
  defeated_elite_ids text[] not null default '{}'::text[],
  defeated_boss_ids text[] not null default '{}'::text[],
  guardian_completed_at timestamptz,
  supply_count integer not null default 0 check (supply_count between 0 and 999),
  regional_boost_region text references monster_tamer.regions(id),
  last_checkpoint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(party_template_ids) between 0 and 3)
);

create table monster_tamer.refreshable_claims (
  user_id uuid not null references identity.users(id) on delete cascade,
  region_entry_serial bigint not null check (region_entry_serial > 0),
  claim_id text not null,
  claim_kind text not null check (claim_kind in ('encounter', 'supply', 'gather')),
  claimed_at timestamptz not null default now(),
  primary key (user_id, region_entry_serial, claim_kind, claim_id)
);

create index monster_tamer_refreshable_claims_user_serial_idx
on monster_tamer.refreshable_claims (user_id, region_entry_serial);

create table monster_tamer.battles (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  encounter_id text not null references monster_tamer.encounter_definitions(id),
  region_entry_serial bigint not null,
  status text not null default 'active' check (status in ('active', 'won', 'lost')),
  state_version bigint not null default 0 check (state_version >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result_acknowledged_at timestamptz,
  check (result_acknowledged_at is null or status in ('won', 'lost'))
);

create unique index monster_tamer_one_unacknowledged_battle_per_user_idx
on monster_tamer.battles (user_id)
where result_acknowledged_at is null;

create index monster_tamer_battles_user_created_idx
on monster_tamer.battles (user_id, created_at desc);

create or replace function monster_tamer.max_hp(
  p_combat_power integer,
  p_rarity text,
  p_stage smallint,
  p_scale_bp integer default 10000
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    1,
    floor(
      (
        100
        + sqrt(p_combat_power::numeric) * 8
        + p_stage * 20
        + catalog.rarity_rank(p_rarity) * 12
      ) * p_scale_bp / 10000
    )::integer
  )
$$;

create or replace function monster_tamer.attack(
  p_combat_power integer,
  p_rarity text,
  p_stage smallint,
  p_scale_bp integer default 10000
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select greatest(
    1,
    floor(
      (
        15
        + sqrt(p_combat_power::numeric) * 2
        + p_stage * 3
        + catalog.rarity_rank(p_rarity) * 2
      ) * p_scale_bp / 10000
    )::integer
  )
$$;

create or replace function monster_tamer.empty_statuses()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'shield_hp', 0,
    'burn_turns', 0,
    'burn_damage', 0,
    'attack_up_bp', 0,
    'weakened_bp', 0,
    'regen_turns', 0,
    'regen_amount', 0,
    'charge_damage', 0
  )
$$;

create or replace function monster_tamer.template_profile_json(p_template_id text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'chain_id', t.chain_id,
    'image_thumbnail_path', t.image_thumbnail_path,
    'image_detail_path', t.image_detail_path,
    'combat_power', t.combat_power,
    'element', cp.element,
    'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage),
    'attack', monster_tamer.attack(t.combat_power, t.rarity, t.stage),
    'skills', (
      select jsonb_agg(
        jsonb_build_object(
          'slot', sp.slot,
          'code', sp.code,
          'name', sp.name,
          'element', sp.element,
          'power_bp', sp.power_bp,
          'effect_kind', sp.effect_kind,
          'effect_value_bp', sp.effect_value_bp,
          'duration_turns', sp.duration_turns
        )
        order by sp.slot
      )
      from monster_tamer.skill_profiles sp
      where sp.rules_version = cp.rules_version
        and sp.element = cp.element
        and sp.stage = t.stage
    )
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where t.id = p_template_id
$$;

create or replace function monster_tamer.combatant_json(
  p_template_id text,
  p_current_hp integer default null,
  p_scale_bp integer default 10000
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'image_thumbnail_path', t.image_thumbnail_path,
    'image_detail_path', t.image_detail_path,
    'element', cp.element,
    'current_hp', least(
      coalesce(p_current_hp, monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp)),
      monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp)
    ),
    'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage, p_scale_bp),
    'attack', monster_tamer.attack(t.combat_power, t.rarity, t.stage, p_scale_bp),
    'down', coalesce(p_current_hp, 1) <= 0,
    'statuses', monster_tamer.empty_statuses(),
    'skills', monster_tamer.template_profile_json(t.id)->'skills'
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where t.id = p_template_id
$$;

create or replace function monster_tamer.apply_attack_boost(
  p_combatant jsonb,
  p_boost_bp integer
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_boost_bp <= 0 then p_combatant
    else jsonb_set(
      p_combatant,
      '{attack}',
      to_jsonb(
        greatest(
          1,
          floor((p_combatant->>'attack')::numeric * (10000 + p_boost_bp) / 10000)::integer
        )
      ),
      false
    )
  end
$$;

create or replace function monster_tamer.apply_raw_damage(
  p_defender jsonb,
  p_damage integer
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_defender jsonb := p_defender;
  v_statuses jsonb := p_defender->'statuses';
  v_shield integer := (v_statuses->>'shield_hp')::integer;
  v_hp integer := (p_defender->>'current_hp')::integer;
  v_remaining integer := greatest(0, p_damage - v_shield);
begin
  v_statuses := jsonb_set(
    v_statuses,
    '{shield_hp}',
    to_jsonb(greatest(0, v_shield - p_damage))
  );
  v_hp := greatest(0, v_hp - v_remaining);
  v_defender := jsonb_set(v_defender, '{current_hp}', to_jsonb(v_hp));
  v_defender := jsonb_set(v_defender, '{down}', to_jsonb(v_hp <= 0));
  return jsonb_set(v_defender, '{statuses}', v_statuses);
end;
$$;

create or replace function monster_tamer.ensure_progress(p_user_id uuid)
returns monster_tamer.player_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress monster_tamer.player_progress%rowtype;
  v_rules_version text;
begin
  select id into v_rules_version
  from monster_tamer.rulesets
  where active;
  if v_rules_version is null then
    perform api.raise_business_error('INTERNAL_ERROR', 'Monster Tamer 规则未启用');
  end if;
  insert into monster_tamer.player_progress (
    user_id, rules_version, resume_x, resume_y
  )
  select p_user_id, v_rules_version, r.spawn_x, r.spawn_y
  from monster_tamer.regions r
  where r.id = 'camp' and r.rules_version = v_rules_version
  on conflict (user_id) do nothing;
  select * into v_progress
  from monster_tamer.player_progress
  where user_id = p_user_id;
  return v_progress;
end;
$$;

create or replace function monster_tamer.progress_json(
  p_progress monster_tamer.player_progress,
  p_force_reselection boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'state_version', p_progress.state_version,
    'current_region', case when p_force_reselection then 'camp' else p_progress.current_region end,
    'resume_position', jsonb_build_object(
      'x', p_progress.resume_x,
      'y', p_progress.resume_y
    ),
    'region_entry_serial', p_progress.region_entry_serial,
    'party', case when p_force_reselection then '[]'::jsonb else p_progress.party_state end,
    'unlocked_regions', to_jsonb(p_progress.unlocked_regions),
    'abilities', to_jsonb(p_progress.abilities),
    'revealed_cells', p_progress.revealed_cells,
    'completed_node_ids', to_jsonb(p_progress.completed_node_ids),
    'defeated_elite_ids', to_jsonb(p_progress.defeated_elite_ids),
    'defeated_boss_ids', to_jsonb(p_progress.defeated_boss_ids),
    'guardian_completed_at', p_progress.guardian_completed_at,
    'supply_count', p_progress.supply_count,
    'regional_boost', case
      when p_progress.regional_boost_region is null then null
      else jsonb_build_object(
        'region_id', p_progress.regional_boost_region,
        'attack_bp', 1000
      )
    end,
    'last_checkpoint', p_progress.last_checkpoint,
    'current_refreshable_claim_ids', coalesce((
      select jsonb_agg(c.claim_id order by c.claim_id)
      from monster_tamer.refreshable_claims c
      where c.user_id = p_progress.user_id
        and c.region_entry_serial = p_progress.region_entry_serial
    ), '[]'::jsonb)
  )
$$;

create or replace function monster_tamer.battle_json(p_battle monster_tamer.battles)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'battle_id', p_battle.id,
    'encounter_id', p_battle.encounter_id,
    'kind', e.kind,
    'status', p_battle.status,
    'state_version', p_battle.state_version,
    'turn', (p_battle.state->>'turn')::bigint,
    'active_template_id', p_battle.state->>'active_template_id',
    'party', p_battle.state->'party',
    'enemy', p_battle.state->'enemy',
    'environment', p_battle.state->'environment',
    'mechanic_code', e.mechanic_code,
    'mechanic_notice', p_battle.state->>'mechanic_notice'
  )
  from monster_tamer.encounter_definitions e
  where e.id = p_battle.encounter_id
$$;

create or replace function monster_tamer.lock_and_validate_team(
  p_user_id uuid,
  p_template_ids text[]
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_valid_count integer;
begin
  if cardinality(p_template_ids) not between 1 and 3
    or cardinality(p_template_ids) <> (
      select count(distinct value)
      from unnest(p_template_ids) value
    )
  then
    return false;
  end if;
  perform 1
  from inventory.holdings h
  where h.user_id = p_user_id
    and h.template_id = any(p_template_ids)
  order by h.template_id
  for update;
  select count(*) into v_valid_count
  from unnest(p_template_ids) template_id
  where inventory.available_quantity(p_user_id, template_id) > 0
    and exists (
      select 1
      from monster_tamer.chain_profiles cp
      join catalog.templates t on t.chain_id = cp.chain_id
      where t.id = template_id
    );
  return v_valid_count = cardinality(p_template_ids);
end;
$$;

create or replace function monster_tamer.full_party_state(p_template_ids text[])
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'template_id', t.id,
      'current_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage),
      'max_hp', monster_tamer.max_hp(t.combat_power, t.rarity, t.stage)
    )
    order by selected.ordinality
  ), '[]'::jsonb)
  from unnest(p_template_ids) with ordinality selected(template_id, ordinality)
  join catalog.templates t on t.id = selected.template_id
$$;

create or replace function monster_tamer.encounter_available(
  p_progress monster_tamer.player_progress,
  p_encounter monster_tamer.encounter_definitions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_encounter.region_id = any(p_progress.unlocked_regions)
    and case p_encounter.kind
      when 'normal' then not exists (
        select 1
        from monster_tamer.refreshable_claims c
        where c.user_id = p_progress.user_id
          and c.region_entry_serial = p_progress.region_entry_serial
          and c.claim_kind = 'encounter'
          and c.claim_id = p_encounter.id
      )
      when 'elite' then not p_encounter.id = any(p_progress.defeated_elite_ids)
      when 'boss' then not p_encounter.id = any(p_progress.defeated_boss_ids)
      when 'guardian' then p_progress.guardian_completed_at is null
      else false
    end
$$;

create or replace function monster_tamer.cell_traversable(
  p_progress monster_tamer.player_progress,
  p_x smallint,
  p_y smallint
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from monster_tamer.world_cells c
    where c.rules_version = p_progress.rules_version
      and c.region_id = p_progress.current_region
      and c.x = p_x
      and c.y = p_y
      and c.walkable
  )
  and not exists (
    select 1
    from monster_tamer.world_nodes n
    where n.rules_version = p_progress.rules_version
      and n.region_id = p_progress.current_region
      and n.x = p_x
      and n.y = p_y
      and n.kind in ('gate', 'shortcut')
      and not n.id = any(p_progress.completed_node_ids)
  )
  and not exists (
    select 1
    from monster_tamer.encounter_definitions e
    where e.rules_version = p_progress.rules_version
      and e.region_id = p_progress.current_region
      and e.x = p_x
      and e.y = p_y
      and monster_tamer.encounter_available(p_progress, e)
  )
$$;

create or replace function monster_tamer.encounter_reachable(
  p_progress monster_tamer.player_progress,
  p_encounter monster_tamer.encounter_definitions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive reachable(x, y) as (
    select p_progress.resume_x, p_progress.resume_y
    union
    select c.x, c.y
    from reachable current_cell
    join monster_tamer.world_cells c
      on c.rules_version = p_progress.rules_version
     and c.region_id = p_progress.current_region
     and c.walkable
     and abs(c.x - current_cell.x) + abs(c.y - current_cell.y) = 1
    where not exists (
      select 1
      from monster_tamer.world_nodes n
      where n.rules_version = p_progress.rules_version
        and n.region_id = p_progress.current_region
        and n.x = c.x
        and n.y = c.y
        and n.kind in ('gate', 'shortcut')
        and not n.id = any(p_progress.completed_node_ids)
    )
      and not exists (
        select 1
        from monster_tamer.encounter_definitions obstacle
        where obstacle.rules_version = p_progress.rules_version
          and obstacle.region_id = p_progress.current_region
          and obstacle.x = c.x
          and obstacle.y = c.y
          and obstacle.id <> p_encounter.id
          and monster_tamer.encounter_available(p_progress, obstacle)
      )
  )
  select exists (
    select 1
    from reachable
    where x = p_encounter.x and y = p_encounter.y
  )
$$;

create or replace function monster_tamer.world_json(
  p_progress monster_tamer.player_progress,
  p_force_reselection boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'regions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'element', r.element,
          'width_tiles', r.width_tiles,
          'height_tiles', r.height_tiles,
          'spawn', jsonb_build_object('x', r.spawn_x, 'y', r.spawn_y),
          'walkable_cell_ids', coalesce((
            select jsonb_agg(c.cell_id order by c.y, c.x)
            from monster_tamer.world_cells c
            where c.rules_version = r.rules_version
              and c.region_id = r.id
              and c.walkable
          ), '[]'::jsonb),
          'environment', jsonb_build_object(
            'element', r.element,
            'effect_code', r.environment_effect_code
          ),
          'unlocked', r.id = 'camp' or r.id = any(p_progress.unlocked_regions)
        )
        order by r.sort_order
      )
      from monster_tamer.regions r
      where r.rules_version = p_progress.rules_version
    ), '[]'::jsonb),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'region_id', n.region_id,
          'kind', n.kind,
          'name', n.name,
          'position', jsonb_build_object('x', n.x, 'y', n.y),
          'required_ability', n.required_ability,
          'target_region', n.target_region,
          'encounter_id', rematch.encounter_id,
          'refreshable', n.refreshable,
          'available', (
            not p_force_reselection
            and (
              n.kind <> 'rematch'
              or (
                rematch_encounter.kind = 'boss'
                and rematch_encounter.id = any(p_progress.defeated_boss_ids)
              )
              or (
                rematch_encounter.kind = 'guardian'
                and p_progress.guardian_completed_at is not null
              )
            )
          ),
          'completed', n.kind <> 'rematch'
            and n.id = any(p_progress.completed_node_ids),
          'claimed', n.kind <> 'rematch'
            and n.refreshable
            and not p_force_reselection
            and exists (
            select 1
            from monster_tamer.refreshable_claims c
            where c.user_id = p_progress.user_id
              and c.region_entry_serial = p_progress.region_entry_serial
              and c.claim_id = n.id
          )
        )
        order by r.sort_order, n.id
      )
      from monster_tamer.world_nodes n
      join monster_tamer.regions r on r.id = n.region_id
      left join monster_tamer.rematch_nodes rematch on rematch.node_id = n.id
      left join monster_tamer.encounter_definitions rematch_encounter
        on rematch_encounter.id = rematch.encounter_id
      where n.rules_version = p_progress.rules_version
    ), '[]'::jsonb),
    'encounters', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'region_id', e.region_id,
          'kind', e.kind,
          'template_id', e.template_id,
          'name', t.name,
          'image_thumbnail_path', t.image_thumbnail_path,
          'mechanic_code', e.mechanic_code,
          'position', jsonb_build_object('x', e.x, 'y', e.y),
          'engage_radius', e.engage_radius,
          'available', (
            not p_force_reselection
            and monster_tamer.encounter_available(p_progress, e)
          ),
          'claimed', (
            (e.kind = 'elite' and e.id = any(p_progress.defeated_elite_ids))
            or (e.kind = 'boss' and e.id = any(p_progress.defeated_boss_ids))
            or (e.kind = 'guardian' and p_progress.guardian_completed_at is not null)
            or (
              e.kind = 'normal'
              and exists (
                select 1
                from monster_tamer.refreshable_claims c
                where c.user_id = p_progress.user_id
                  and c.region_entry_serial = p_progress.region_entry_serial
                  and c.claim_kind = 'encounter'
                  and c.claim_id = e.id
              )
            )
          )
        )
        order by r.sort_order, e.kind, e.id
      )
      from monster_tamer.encounter_definitions e
      join monster_tamer.regions r on r.id = e.region_id
      join catalog.templates t on t.id = e.template_id
      where e.rules_version = p_progress.rules_version
    ), '[]'::jsonb)
  )
$$;

create or replace function api.monster_tamer_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_progress monster_tamer.player_progress%rowtype;
  v_active_battle monster_tamer.battles%rowtype;
  v_inventory jsonb;
  v_combat_catalog jsonb;
  v_inventory_count integer;
  v_invalid_team boolean := false;
  v_force_reselection boolean := false;
  v_rules monster_tamer.rulesets%rowtype;
begin
  v_progress := monster_tamer.ensure_progress(v_user_id);
  select * into v_progress
  from monster_tamer.player_progress
  where user_id = v_user_id
  for update;
  select * into v_rules
  from monster_tamer.rulesets
  where id = v_progress.rules_version and active;
  if v_rules.id is null then
    perform api.raise_business_error('INTERNAL_ERROR', 'Monster Tamer 规则版本不可用');
  end if;
  select * into v_active_battle
  from monster_tamer.battles
  where user_id = v_user_id
    and result_acknowledged_at is null
  order by created_at desc
  limit 1;
  select coalesce(jsonb_agg(
    monster_tamer.template_profile_json(h.template_id)
      || jsonb_build_object(
        'available_quantity',
        inventory.available_quantity(v_user_id, h.template_id)
      )
    order by t.sort_order
  ), '[]'::jsonb), count(*)
  into v_inventory, v_inventory_count
  from inventory.holdings h
  join catalog.templates t on t.id = h.template_id
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  where h.user_id = v_user_id
    and inventory.available_quantity(v_user_id, h.template_id) > 0;
  select coalesce(
    jsonb_agg(
      monster_tamer.template_profile_json(t.id)
      order by t.sort_order
    ),
    '[]'::jsonb
  )
  into v_combat_catalog
  from catalog.templates t
  join monster_tamer.chain_profiles cp
    on cp.chain_id = t.chain_id
   and cp.rules_version = v_progress.rules_version;
  if v_active_battle.id is null and cardinality(v_progress.party_template_ids) > 0 then
    select exists (
      select 1
      from unnest(v_progress.party_template_ids) template_id
      where inventory.available_quantity(v_user_id, template_id) <= 0
    ) into v_invalid_team;
  end if;
  v_force_reselection := v_invalid_team and v_active_battle.id is null;
  if v_force_reselection then
    update monster_tamer.player_progress
    set current_region = 'camp',
        resume_x = (
          select r.spawn_x
          from monster_tamer.regions r
          where r.id = 'camp' and r.rules_version = v_progress.rules_version
        ),
        resume_y = (
          select r.spawn_y
          from monster_tamer.regions r
          where r.id = 'camp' and r.rules_version = v_progress.rules_version
        ),
        party_template_ids = '{}'::text[],
        party_state = '[]'::jsonb,
        state_version = state_version + 1,
        last_checkpoint = 'team_reselection_required',
        updated_at = now()
    where user_id = v_user_id
    returning * into v_progress;
  end if;
  return jsonb_build_object(
    'rules_version', v_rules.id,
    'map_checksum', v_rules.map_checksum,
    'entry_state', case
      when v_active_battle.id is not null then 'ready'
      when v_inventory_count = 0 then 'no_available_collections'
      when v_force_reselection then 'team_reselection_required'
      else 'ready'
    end,
    'inventory', v_inventory,
    'combat_catalog', v_combat_catalog,
    'progress', monster_tamer.progress_json(v_progress),
    'active_battle', case
      when v_active_battle.id is null then null
      else monster_tamer.battle_json(v_active_battle)
    end,
    'world', monster_tamer.world_json(v_progress)
  );
end;
$$;

create or replace function api.monster_tamer_checkpoint(
  p_session_id uuid,
  p_operation_id uuid,
  p_expected_progress_version bigint,
  p_command jsonb,
  p_revealed_cell_ids jsonb,
  p_traversed_cell_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_progress monster_tamer.player_progress%rowtype;
  v_type text := p_command->>'type';
  v_template_ids text[];
  v_target_region text;
  v_target_template text;
  v_source_node_id text;
  v_node monster_tamer.world_nodes%rowtype;
  v_target_region_row monster_tamer.regions%rowtype;
  v_party jsonb;
  v_existing_cells jsonb;
  v_merged_cells jsonb;
  v_step record;
  v_origin_x smallint;
  v_origin_y smallint;
  v_previous_x smallint;
  v_previous_y smallint;
  v_revealed_count integer := coalesce(jsonb_array_length(p_revealed_cell_ids), 0);
  v_traversed_count integer := coalesce(jsonb_array_length(p_traversed_cell_ids), 0);
  v_claimed integer;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'monster_tamer.checkpoint',
    p_operation_id,
    jsonb_build_object(
      'expected_progress_version', p_expected_progress_version,
      'command', p_command,
      'revealed_cell_ids', coalesce(p_revealed_cell_ids, '[]'::jsonb),
      'traversed_cell_ids', coalesce(p_traversed_cell_ids, '[]'::jsonb)
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform monster_tamer.ensure_progress(v_user_id);
    select * into v_progress
    from monster_tamer.player_progress
    where user_id = v_user_id
    for update;
    if v_progress.state_version <> p_expected_progress_version then
      perform api.raise_business_error(
        'MONSTER_TAMER_STATE_CONFLICT',
        '游戏进度版本已经更新'
      );
    end if;
    if exists (
      select 1
      from monster_tamer.battles
      where user_id = v_user_id
        and result_acknowledged_at is null
    ) then
      perform api.raise_business_error(
        'MONSTER_TAMER_BATTLE_ALREADY_ACTIVE',
        '战斗进行中或终局待确认时不能写入探索进度'
      );
    end if;
    if v_revealed_count > 256 or v_traversed_count > 256 then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '单次数组最多包含 256 个地图格'
      );
    end if;
    if v_type = 'sync_revealed_cells' and v_revealed_count + v_traversed_count = 0 then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '同步地图必须提交经过格或揭示格'
      );
    end if;
    if v_type <> 'sync_revealed_cells'
      and (v_revealed_count > 0 or v_traversed_count > 0)
    then
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '只有地图同步命令可以提交经过格和揭示格'
      );
    end if;
    if v_type = 'sync_revealed_cells' then
      v_origin_x := v_progress.resume_x;
      v_origin_y := v_progress.resume_y;
      v_previous_x := v_origin_x;
      v_previous_y := v_origin_y;
      for v_step in
        select submitted.ordinality, cell.*
        from jsonb_array_elements_text(p_traversed_cell_ids)
          with ordinality submitted(cell_id, ordinality)
        left join monster_tamer.world_cells cell
          on cell.rules_version = v_progress.rules_version
         and cell.region_id = v_progress.current_region
         and cell.cell_id = submitted.cell_id
        order by submitted.ordinality
      loop
        if v_step.cell_id is null
          or abs(v_step.x - v_previous_x) + abs(v_step.y - v_previous_y) <> 1
          or not monster_tamer.cell_traversable(
            v_progress,
            v_step.x::smallint,
            v_step.y::smallint
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '经过路径不连续或包含不可通行格'
          );
        end if;
        v_previous_x := v_step.x;
        v_previous_y := v_step.y;
      end loop;
      v_progress.resume_x := v_previous_x;
      v_progress.resume_y := v_previous_y;

      if exists (
        select 1
        from jsonb_array_elements_text(p_revealed_cell_ids) submitted(cell_id)
        left join monster_tamer.world_cells cell
          on cell.rules_version = v_progress.rules_version
         and cell.region_id = v_progress.current_region
         and cell.cell_id = submitted.cell_id
        where cell.cell_id is null
          or not exists (
            select 1
            from (
              select v_origin_x x, v_origin_y y
              union all
              select path_cell.x, path_cell.y
              from jsonb_array_elements_text(p_traversed_cell_ids)
                with ordinality traversed(cell_id, ordinality)
              join monster_tamer.world_cells path_cell
                on path_cell.rules_version = v_progress.rules_version
               and path_cell.region_id = v_progress.current_region
               and path_cell.cell_id = traversed.cell_id
            ) verified_path
            where abs(verified_path.x - cell.x)
                + abs(verified_path.y - cell.y) <= 2
          )
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_NODE_UNAVAILABLE',
          '揭示格不属于已验证路径两格范围'
        );
      end if;
      if v_revealed_count > 0 then
        v_existing_cells := coalesce(
          v_progress.revealed_cells->v_progress.current_region,
          '[]'::jsonb
        );
        select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
        into v_merged_cells
        from (
          select distinct value
          from (
            select jsonb_array_elements_text(v_existing_cells) value
            union all
            select jsonb_array_elements_text(p_revealed_cell_ids) value
          ) cells
        ) unique_cells;
        v_progress.revealed_cells := jsonb_set(
          v_progress.revealed_cells,
          array[v_progress.current_region],
          v_merged_cells,
          true
        );
      end if;
    end if;

    case v_type
      when 'confirm_team' then
        if v_progress.current_region <> 'camp' then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '只能在中心营地更换队伍'
          );
        end if;
        select array_agg(value order by ordinality)
        into v_template_ids
        from jsonb_array_elements_text(p_command->'template_ids')
        with ordinality selected(value, ordinality);
        if not monster_tamer.lock_and_validate_team(v_user_id, v_template_ids) then
          perform api.raise_business_error(
            'MONSTER_TAMER_TEAM_INVALID',
            '队伍包含不可用藏品'
          );
        end if;
        v_progress.party_template_ids := v_template_ids;
        v_progress.party_state := monster_tamer.full_party_state(v_template_ids);
        v_progress.last_checkpoint := 'confirm_team';

      when 'enter_region' then
        v_target_region := p_command->>'region_id';
        v_source_node_id := p_command->>'source_node_id';
        if v_target_region = v_progress.current_region then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '已经位于目标区域'
          );
        end if;
        select * into v_target_region_row
        from monster_tamer.regions
        where id = v_target_region
          and rules_version = v_progress.rules_version;
        if v_target_region_row.id is null
          or (
            v_target_region <> 'camp'
            and not v_target_region = any(v_progress.unlocked_regions)
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_REGION_LOCKED',
            '目标区域尚未开放'
          );
        end if;
        if v_target_region = 'guardian_lair'
          and not array[
            'vine_bridge', 'tidal_walk', 'wind_glide',
            'lightning_charge', 'heat_shield'
          ]::text[] <@ v_progress.abilities
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_REGION_LOCKED',
            '获得全部五种探索能力后才能进入最终巢穴'
          );
        end if;
        if v_progress.current_region = 'camp' then
          if v_source_node_id is not null then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '从中心营地出发不能指定区域节点'
            );
          end if;
        else
          select * into v_node
          from monster_tamer.world_nodes
          where id = v_source_node_id
            and rules_version = v_progress.rules_version
            and region_id = v_progress.current_region
            and target_region = v_target_region
            and kind in ('exit', 'gate');
          if v_node.id is null
            or abs(v_progress.resume_x - v_node.x)
              + abs(v_progress.resume_y - v_node.y) > 1
            or (
              v_node.required_ability is not null
              and not v_node.required_ability = any(v_progress.abilities)
            )
            or (
              v_node.kind = 'gate'
              and not v_node.id = any(v_progress.completed_node_ids)
            )
          then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '必须在已完成的区域出口或传送门旁进入目标区域'
            );
          end if;
        end if;
        if v_target_region <> 'camp' then
          if not monster_tamer.lock_and_validate_team(
            v_user_id,
            v_progress.party_template_ids
          ) then
            update monster_tamer.player_progress
            set current_region = 'camp',
                resume_x = (
                  select r.spawn_x
                  from monster_tamer.regions r
                  where r.id = 'camp'
                    and r.rules_version = v_progress.rules_version
                ),
                resume_y = (
                  select r.spawn_y
                  from monster_tamer.regions r
                  where r.id = 'camp'
                    and r.rules_version = v_progress.rules_version
                ),
                party_template_ids = '{}'::text[],
                party_state = '[]'::jsonb,
                state_version = state_version + 1,
                last_checkpoint = 'team_reselection_required',
                updated_at = now()
            where user_id = v_user_id
            returning * into v_progress;
            return operations.fail_command(
              p_operation_id,
              'MONSTER_TAMER_TEAM_INVALID',
              jsonb_build_object(
                'message', '进入区域前队伍已失效，已返回中心营地',
                'progress', monster_tamer.progress_json(v_progress)
              )
            );
          end if;
          v_progress.region_entry_serial := v_progress.region_entry_serial + 1;
        else
          v_progress.party_state := monster_tamer.full_party_state(
            v_progress.party_template_ids
          );
        end if;
        v_progress.current_region := v_target_region;
        v_progress.resume_x := v_target_region_row.spawn_x;
        v_progress.resume_y := v_target_region_row.spawn_y;
        v_progress.last_checkpoint := 'enter_region:' || v_target_region;

      when 'complete_world_node' then
        select * into v_node
        from monster_tamer.world_nodes
        where id = p_command->>'node_id'
          and rules_version = v_progress.rules_version
          and region_id = v_progress.current_region;
        if v_node.id is null
          or v_node.kind in ('exit', 'rematch')
          or abs(v_progress.resume_x - v_node.x)
            + abs(v_progress.resume_y - v_node.y) > 1
          or (
            v_node.required_ability is not null
            and not v_node.required_ability = any(v_progress.abilities)
          )
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '探索节点当前不可用'
          );
        end if;
        if v_node.refreshable then
          insert into monster_tamer.refreshable_claims (
            user_id, region_entry_serial, claim_id, claim_kind
          )
          values (
            v_user_id,
            v_progress.region_entry_serial,
            v_node.id,
            v_node.kind
          )
          on conflict do nothing;
          get diagnostics v_claimed = row_count;
          if v_claimed = 0 then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '本次区域探索已经使用该节点'
            );
          end if;
        else
          if v_node.id = any(v_progress.completed_node_ids) then
            perform api.raise_business_error(
              'MONSTER_TAMER_NODE_UNAVAILABLE',
              '探索节点已经完成'
            );
          end if;
          v_progress.completed_node_ids := array_append(
            v_progress.completed_node_ids,
            v_node.id
          );
        end if;
        v_progress.supply_count := least(
          999,
          v_progress.supply_count + v_node.supply_reward
        );
        if v_node.heal_bp > 0 then
          select jsonb_agg(
            jsonb_set(
              member,
              '{current_hp}',
              to_jsonb(least(
                (member->>'max_hp')::integer,
                (member->>'current_hp')::integer
                  + greatest(
                    1,
                    floor((member->>'max_hp')::numeric * v_node.heal_bp / 10000)::integer
                  )
              )),
              false
            )
            order by ordinality
          )
          into v_progress.party_state
          from jsonb_array_elements(v_progress.party_state)
          with ordinality party(member, ordinality);
        end if;
        if v_node.target_region is not null
          and not v_node.target_region = any(v_progress.unlocked_regions)
        then
          v_progress.unlocked_regions := array_append(
            v_progress.unlocked_regions,
            v_node.target_region
          );
        end if;
        if v_node.kind = 'gather' then
          v_progress.regional_boost_region := v_progress.current_region;
        end if;
        v_progress.resume_x := v_node.x;
        v_progress.resume_y := v_node.y;
        v_progress.last_checkpoint := 'world_node:' || v_node.id;

      when 'use_supply' then
        v_target_template := p_command->>'target_template_id';
        if v_progress.supply_count <= 0
          or not v_target_template = any(v_progress.party_template_ids)
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '治疗补给当前不可用'
          );
        end if;
        select jsonb_agg(
          case
            when member->>'template_id' = v_target_template then
              jsonb_set(
                member,
                '{current_hp}',
                to_jsonb(least(
                  (member->>'max_hp')::integer,
                  (member->>'current_hp')::integer
                    + greatest(
                      1,
                      floor((member->>'max_hp')::numeric * 3500 / 10000)::integer
                    )
                )),
                false
              )
            else member
          end
          order by ordinality
        )
        into v_party
        from jsonb_array_elements(v_progress.party_state)
        with ordinality party(member, ordinality);
        if (
          select (member->>'current_hp')::integer >= (member->>'max_hp')::integer
          from jsonb_array_elements(v_progress.party_state) member
          where member->>'template_id' = v_target_template
        ) then
          perform api.raise_business_error(
            'MONSTER_TAMER_NODE_UNAVAILABLE',
            '目标队员不需要恢复'
          );
        end if;
        v_progress.party_state := v_party;
        v_progress.supply_count := v_progress.supply_count - 1;
        v_progress.last_checkpoint := 'use_supply:' || v_target_template;

      when 'sync_revealed_cells' then
        v_progress.last_checkpoint := 'sync_revealed_cells';

      else
        perform api.raise_business_error(
          'REQUEST_INVALID',
          '未知的 Monster Tamer 检查点命令'
        );
    end case;

    v_progress.state_version := v_progress.state_version + 1;
    update monster_tamer.player_progress
    set state_version = v_progress.state_version,
        current_region = v_progress.current_region,
        resume_x = v_progress.resume_x,
        resume_y = v_progress.resume_y,
        region_entry_serial = v_progress.region_entry_serial,
        party_template_ids = v_progress.party_template_ids,
        party_state = v_progress.party_state,
        unlocked_regions = v_progress.unlocked_regions,
        abilities = v_progress.abilities,
        revealed_cells = v_progress.revealed_cells,
        completed_node_ids = v_progress.completed_node_ids,
        defeated_elite_ids = v_progress.defeated_elite_ids,
        defeated_boss_ids = v_progress.defeated_boss_ids,
        guardian_completed_at = v_progress.guardian_completed_at,
        supply_count = v_progress.supply_count,
        regional_boost_region = v_progress.regional_boost_region,
        last_checkpoint = v_progress.last_checkpoint,
        updated_at = now()
    where user_id = v_user_id
    returning * into v_progress;
    return operations.complete_command(
      p_operation_id,
      jsonb_build_object('progress', monster_tamer.progress_json(v_progress))
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(
      p_operation_id,
      case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end,
      jsonb_build_object('detail', coalesce(v_detail, '{}'))
    );
  end;
end;
$$;

create or replace function monster_tamer.skill_json(
  p_template_id text,
  p_slot smallint
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'slot', sp.slot,
    'code', sp.code,
    'name', sp.name,
    'element', sp.element,
    'power_bp', sp.power_bp,
    'effect_kind', sp.effect_kind,
    'effect_value_bp', sp.effect_value_bp,
    'duration_turns', sp.duration_turns
  )
  from catalog.templates t
  join monster_tamer.chain_profiles cp on cp.chain_id = t.chain_id
  join monster_tamer.skill_profiles sp
    on sp.rules_version = cp.rules_version
   and sp.element = cp.element
   and sp.stage = t.stage
   and sp.slot = p_slot
  where t.id = p_template_id
$$;

create or replace function monster_tamer.apply_environment(
  p_combatant jsonb,
  p_environment_element text,
  p_effect_code text
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_statuses jsonb := p_combatant->'statuses';
  v_max_hp integer := (p_combatant->>'max_hp')::integer;
  v_attack integer := (p_combatant->>'attack')::integer;
begin
  if p_environment_element is null
    or p_combatant->>'element' <> p_environment_element
  then
    return p_combatant;
  end if;
  case p_effect_code
    when 'forest_regen' then
      v_statuses := jsonb_set(v_statuses, '{regen_turns}', '2'::jsonb);
      v_statuses := jsonb_set(
        v_statuses,
        '{regen_amount}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 500 / 10000)::integer))
      );
    when 'wetland_shield' then
      v_statuses := jsonb_set(
        v_statuses,
        '{shield_hp}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 800 / 10000)::integer))
      );
    when 'highland_tailwind' then
      v_statuses := jsonb_set(v_statuses, '{attack_up_bp}', '1000'::jsonb);
    when 'cavern_charge' then
      v_statuses := jsonb_set(
        v_statuses,
        '{charge_damage}',
        to_jsonb(greatest(1, floor(v_attack::numeric * 1000 / 10000)::integer))
      );
    when 'basin_heat_guard' then
      v_statuses := jsonb_set(
        v_statuses,
        '{shield_hp}',
        to_jsonb(greatest(1, floor(v_max_hp::numeric * 500 / 10000)::integer))
      );
    else
      null;
  end case;
  return jsonb_set(p_combatant, '{statuses}', v_statuses, false);
end;
$$;

create or replace function monster_tamer.apply_skill(
  p_attacker jsonb,
  p_defender jsonb,
  p_skill jsonb
)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_attacker jsonb := p_attacker;
  v_defender jsonb := p_defender;
  v_attacker_statuses jsonb := p_attacker->'statuses';
  v_defender_statuses jsonb := p_defender->'statuses';
  v_attacker_hp integer := (p_attacker->>'current_hp')::integer;
  v_attacker_max_hp integer := (p_attacker->>'max_hp')::integer;
  v_defender_hp integer := (p_defender->>'current_hp')::integer;
  v_defender_max_hp integer := (p_defender->>'max_hp')::integer;
  v_attack integer := (p_attacker->>'attack')::integer;
  v_regen_turns integer := (v_attacker_statuses->>'regen_turns')::integer;
  v_burn_turns integer := (v_attacker_statuses->>'burn_turns')::integer;
  v_weakened_bp integer := (v_attacker_statuses->>'weakened_bp')::integer;
  v_attack_up_bp integer := (v_attacker_statuses->>'attack_up_bp')::integer;
  v_charge_damage integer := (v_attacker_statuses->>'charge_damage')::integer;
  v_shield integer := (v_defender_statuses->>'shield_hp')::integer;
  v_damage integer := 0;
  v_hp_damage integer := 0;
  v_effect_kind text := p_skill->>'effect_kind';
  v_effect_value_bp integer := (p_skill->>'effect_value_bp')::integer;
  v_duration integer := (p_skill->>'duration_turns')::integer;
begin
  if v_regen_turns > 0 then
    v_attacker_hp := least(
      v_attacker_max_hp,
      v_attacker_hp + (v_attacker_statuses->>'regen_amount')::integer
    );
    v_attacker_statuses := jsonb_set(
      v_attacker_statuses,
      '{regen_turns}',
      to_jsonb(v_regen_turns - 1)
    );
  end if;
  if v_burn_turns > 0 then
    v_attacker_hp := greatest(
      0,
      v_attacker_hp - (v_attacker_statuses->>'burn_damage')::integer
    );
    v_attacker_statuses := jsonb_set(
      v_attacker_statuses,
      '{burn_turns}',
      to_jsonb(v_burn_turns - 1)
    );
  end if;
  v_attacker := jsonb_set(v_attacker, '{current_hp}', to_jsonb(v_attacker_hp));
  v_attacker := jsonb_set(
    v_attacker,
    '{down}',
    to_jsonb(v_attacker_hp <= 0)
  );
  v_attacker := jsonb_set(v_attacker, '{statuses}', v_attacker_statuses);
  if v_attacker_hp <= 0 then
    return jsonb_build_object(
      'attacker', v_attacker,
      'defender', v_defender,
      'damage', 0
    );
  end if;

  v_attack := greatest(
    1,
    floor(
      v_attack::numeric
        * (10000 + v_attack_up_bp)
        * (10000 - least(v_weakened_bp, 9000))
        / 100000000
    )::integer
  );
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{attack_up_bp}', '0'::jsonb);
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{weakened_bp}', '0'::jsonb);
  v_attacker_statuses := jsonb_set(v_attacker_statuses, '{charge_damage}', '0'::jsonb);
  if (p_skill->>'power_bp')::integer > 0 then
    v_damage := greatest(
      1,
      floor(v_attack::numeric * (p_skill->>'power_bp')::integer / 10000)::integer
        + v_charge_damage
    );
  end if;
  if v_damage > 0 and v_shield > 0 then
    v_defender_statuses := jsonb_set(
      v_defender_statuses,
      '{shield_hp}',
      to_jsonb(greatest(0, v_shield - v_damage))
    );
    v_damage := greatest(0, v_damage - v_shield);
  end if;
  v_hp_damage := least(v_defender_hp, v_damage);
  v_defender_hp := greatest(0, v_defender_hp - v_damage);

  case v_effect_kind
    when 'heal_self' then
      v_attacker_hp := least(
        v_attacker_max_hp,
        v_attacker_hp
          + greatest(
            1,
            floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
          )
      );
    when 'shield_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{shield_hp}',
        to_jsonb(
          (v_attacker_statuses->>'shield_hp')::integer
            + greatest(
              1,
              floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
            )
        )
      );
    when 'burn_enemy' then
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{burn_turns}',
        to_jsonb(greatest((v_defender_statuses->>'burn_turns')::integer, v_duration))
      );
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{burn_damage}',
        to_jsonb(greatest(1, floor(v_attack::numeric * v_effect_value_bp / 10000)::integer))
      );
    when 'attack_up_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{attack_up_bp}',
        to_jsonb(greatest((v_attacker_statuses->>'attack_up_bp')::integer, v_effect_value_bp))
      );
    when 'drain_self' then
      v_attacker_hp := least(
        v_attacker_max_hp,
        v_attacker_hp
          + greatest(1, floor(v_hp_damage::numeric * v_effect_value_bp / 10000)::integer)
      );
    when 'regen_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{regen_turns}',
        to_jsonb(v_duration)
      );
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{regen_amount}',
        to_jsonb(
          greatest(
            1,
            floor(v_attacker_max_hp::numeric * v_effect_value_bp / 10000)::integer
          )
        )
      );
    when 'weaken_enemy' then
      v_defender_statuses := jsonb_set(
        v_defender_statuses,
        '{weakened_bp}',
        to_jsonb(greatest((v_defender_statuses->>'weakened_bp')::integer, v_effect_value_bp))
      );
    when 'charge_self' then
      v_attacker_statuses := jsonb_set(
        v_attacker_statuses,
        '{charge_damage}',
        to_jsonb(
          (v_attacker_statuses->>'charge_damage')::integer
            + greatest(1, floor(v_attack::numeric * v_effect_value_bp / 10000)::integer)
        )
      );
    else
      null;
  end case;

  v_attacker := jsonb_set(v_attacker, '{current_hp}', to_jsonb(v_attacker_hp));
  v_attacker := jsonb_set(v_attacker, '{down}', to_jsonb(v_attacker_hp <= 0));
  v_attacker := jsonb_set(v_attacker, '{statuses}', v_attacker_statuses);
  v_defender := jsonb_set(v_defender, '{current_hp}', to_jsonb(v_defender_hp));
  v_defender := jsonb_set(v_defender, '{down}', to_jsonb(v_defender_hp <= 0));
  v_defender := jsonb_set(v_defender, '{statuses}', v_defender_statuses);
  return jsonb_build_object(
    'attacker', v_attacker,
    'defender', v_defender,
    'damage', v_hp_damage
  );
end;
$$;

create or replace function api.monster_tamer_battle(
  p_session_id uuid,
  p_operation_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_progress monster_tamer.player_progress%rowtype;
  v_battle monster_tamer.battles%rowtype;
  v_encounter monster_tamer.encounter_definitions%rowtype;
  v_region monster_tamer.regions%rowtype;
  v_source_node monster_tamer.world_nodes%rowtype;
  v_command text := p_command->>'command';
  v_source_node_id text;
  v_party jsonb;
  v_enemy jsonb;
  v_state jsonb;
  v_actor jsonb;
  v_active_template text;
  v_skill jsonb;
  v_enemy_skill jsonb;
  v_resolution jsonb;
  v_scale_bp integer;
  v_average_power numeric;
  v_enemy_power integer;
  v_enemy_slot smallint;
  v_completed_turn integer;
  v_mechanic_state jsonb := '{}'::jsonb;
  v_mechanic_notice text;
  v_environment_element text;
  v_environment_effect_code text;
  v_regional_boost boolean := false;
  v_extra_damage integer;
  v_statuses jsonb;
  v_guardian_index integer;
  v_guardian_elements text[] := array['water', 'fire', 'wood', 'wind', 'lightning'];
  v_guardian_effects text[] := array[
    'wetland_shield', 'basin_heat_guard', 'forest_regen',
    'highland_tailwind', 'cavern_charge'
  ];
  v_terminal text := 'ongoing';
  v_new_status text := 'active';
  v_first_boss boolean := false;
  v_is_rematch boolean := false;
  v_return_x smallint;
  v_return_y smallint;
  v_detail text;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'monster_tamer.battle',
    p_operation_id,
    p_command
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform monster_tamer.ensure_progress(v_user_id);
    select * into v_progress
    from monster_tamer.player_progress
    where user_id = v_user_id
    for update;

    if v_command = 'start' then
      if v_progress.state_version <> (p_command->>'expected_progress_version')::bigint then
        perform api.raise_business_error(
          'MONSTER_TAMER_STATE_CONFLICT',
          '游戏进度版本已经更新'
        );
      end if;
      if exists (
        select 1
        from monster_tamer.battles
        where user_id = v_user_id
          and result_acknowledged_at is null
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_ALREADY_ACTIVE',
          '已有进行中或待确认的战斗'
        );
      end if;
      select * into v_encounter
      from monster_tamer.encounter_definitions
      where id = p_command->>'encounter_id'
        and rules_version = v_progress.rules_version
        and region_id = v_progress.current_region;
      v_source_node_id := p_command->>'source_node_id';
      if v_encounter.id is null
        or v_progress.current_region = 'camp'
        or not v_encounter.region_id = any(v_progress.unlocked_regions)
        or (
          v_encounter.kind = 'guardian'
          and not array[
            'vine_bridge', 'tidal_walk', 'wind_glide',
            'lightning_charge', 'heat_shield'
          ]::text[] <@ v_progress.abilities
        )
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
          '遭遇当前不可用'
        );
      end if;
      v_is_rematch := (
        v_encounter.kind = 'boss'
        and v_encounter.id = any(v_progress.defeated_boss_ids)
      ) or (
        v_encounter.kind = 'guardian'
        and v_progress.guardian_completed_at is not null
      );
      if v_is_rematch then
        select n.* into v_source_node
        from monster_tamer.world_nodes n
        join monster_tamer.rematch_nodes rematch on rematch.node_id = n.id
        where n.id = v_source_node_id
          and n.rules_version = v_progress.rules_version
          and n.region_id = v_progress.current_region
          and n.kind = 'rematch'
          and rematch.encounter_id = v_encounter.id;
        if v_source_node.id is null
          or abs(v_progress.resume_x - v_source_node.x)
            + abs(v_progress.resume_y - v_source_node.y) > 1
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
            '必须在已解锁的再战祭坛旁开始首领再战'
          );
        end if;
        v_return_x := v_source_node.x;
        v_return_y := v_source_node.y;
      else
        if v_source_node_id is not null
          or not monster_tamer.encounter_available(v_progress, v_encounter)
          or abs(v_progress.resume_x - v_encounter.x)
            + abs(v_progress.resume_y - v_encounter.y) > v_encounter.engage_radius
          or not monster_tamer.encounter_reachable(v_progress, v_encounter)
        then
          perform api.raise_business_error(
            'MONSTER_TAMER_ENCOUNTER_UNAVAILABLE',
            '必须从服务器记录的可通行位置接近该遭遇'
          );
        end if;
        v_return_x := v_encounter.x;
        v_return_y := v_encounter.y;
      end if;
      if not monster_tamer.lock_and_validate_team(
        v_user_id,
        v_progress.party_template_ids
      ) then
        update monster_tamer.player_progress
        set current_region = 'camp',
            resume_x = (
              select r.spawn_x
              from monster_tamer.regions r
              where r.id = 'camp'
                and r.rules_version = v_progress.rules_version
            ),
            resume_y = (
              select r.spawn_y
              from monster_tamer.regions r
              where r.id = 'camp'
                and r.rules_version = v_progress.rules_version
            ),
            party_template_ids = '{}'::text[],
            party_state = '[]'::jsonb,
            state_version = state_version + 1,
            last_checkpoint = 'team_reselection_required',
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
        return operations.fail_command(
          p_operation_id,
          'MONSTER_TAMER_TEAM_INVALID',
          jsonb_build_object(
            'message', '开始战斗前队伍已失效，已返回中心营地',
            'progress', monster_tamer.progress_json(v_progress)
          )
        );
      end if;
      if not exists (
        select 1
        from jsonb_array_elements(v_progress.party_state) member
        where (member->>'current_hp')::integer > 0
      ) then
        perform api.raise_business_error(
          'MONSTER_TAMER_TEAM_INVALID',
          '队伍没有可战斗成员'
        );
      end if;
      select * into v_region
      from monster_tamer.regions
      where id = v_progress.current_region;
      v_regional_boost := v_progress.regional_boost_region = v_progress.current_region;
      if v_encounter.mechanic_code = 'guardian_element_cycle' then
        v_environment_element := v_guardian_elements[1];
        v_environment_effect_code := v_guardian_effects[1];
        v_mechanic_state := jsonb_build_object('guardian_index', 0);
      else
        v_environment_element := v_region.element;
        v_environment_effect_code := v_region.environment_effect_code;
        v_mechanic_state := case
          when v_encounter.mechanic_code = 'wetland_tide_shield'
            then jsonb_build_object('tide_shield_triggered', false)
          when v_encounter.mechanic_code = 'cavern_thunder_cycle'
            then jsonb_build_object('thunder_charged', false)
          else '{}'::jsonb
        end;
      end if;
      v_mechanic_notice := case v_encounter.mechanic_code
        when 'forest_regrowth' then '森之守护者每 3 回合恢复生命'
        when 'wetland_tide_shield' then '潮汐守护者首次降至半血时获得潮盾'
        when 'highland_gust_followup' then '高原守护者每 3 回合追加风击'
        when 'cavern_thunder_cycle' then '洞窟守护者每 3 回合蓄雷并在下一回合释放'
        when 'basin_scorch' then '熔火守护者每 2 回合施加灼烧'
        when 'guardian_element_cycle' then '最终守护者从水环境开始逐回合轮换五种属性'
        else null
      end;
      select avg(t.combat_power), enemy.combat_power
      into v_average_power, v_enemy_power
      from unnest(v_progress.party_template_ids) selected(template_id)
      join catalog.templates t on t.id = selected.template_id
      cross join catalog.templates enemy
      where enemy.id = v_encounter.template_id
      group by enemy.combat_power;
      v_scale_bp := greatest(
        v_region.difficulty_min_bp,
        least(
          v_region.difficulty_max_bp,
          10000
            + floor(
              (v_average_power - v_enemy_power)::numeric
                * 1000
                / greatest(v_enemy_power, 1)
            )::integer
        )
      );
      select jsonb_agg(
        monster_tamer.apply_environment(
          monster_tamer.apply_attack_boost(
            monster_tamer.combatant_json(
              member->>'template_id',
              (member->>'current_hp')::integer
            ),
            case when v_regional_boost then 1000 else 0 end
          ),
          v_environment_element,
          v_environment_effect_code
        )
        order by ordinality
      )
      into v_party
      from jsonb_array_elements(v_progress.party_state)
      with ordinality party(member, ordinality);
      v_enemy := monster_tamer.apply_environment(
        monster_tamer.combatant_json(v_encounter.template_id, null, v_scale_bp),
        v_environment_element,
        v_environment_effect_code
      );
      select member->>'template_id' into v_active_template
      from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
      where (member->>'current_hp')::integer > 0
      order by ordinality
      limit 1;
      v_state := jsonb_build_object(
        'turn', 0,
        'active_template_id', v_active_template,
        'party', v_party,
        'enemy', v_enemy,
        'environment', jsonb_build_object(
          'element', v_environment_element,
          'effect_code', v_environment_effect_code
        ),
        'mechanic_state', v_mechanic_state,
        'mechanic_notice', v_mechanic_notice,
        'return_position', jsonb_build_object(
          'x', v_return_x,
          'y', v_return_y
        ),
        'rematch', v_is_rematch
      );
      insert into monster_tamer.battles (
        id, user_id, encounter_id, region_entry_serial, state
      )
      values (
        p_operation_id,
        v_user_id,
        v_encounter.id,
        v_progress.region_entry_serial,
        v_state
      )
      returning * into v_battle;
      if v_regional_boost then
        update monster_tamer.player_progress
        set regional_boost_region = null,
            state_version = state_version + 1,
            last_checkpoint = 'regional_boost_consumed:' || v_progress.current_region,
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
      end if;

    elsif v_command = 'acknowledge' then
      select * into v_battle
      from monster_tamer.battles
      where id = (p_command->>'battle_id')::uuid
        and user_id = v_user_id
      for update;
      if v_battle.id is null
        or v_battle.status = 'active'
        or v_battle.result_acknowledged_at is not null
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_NOT_FOUND',
          '待确认的战斗结果不存在'
        );
      end if;
      if v_battle.state_version
        <> (p_command->>'expected_battle_version')::bigint
      then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '战斗版本已经更新'
        );
      end if;
      update monster_tamer.battles
      set result_acknowledged_at = now(),
          updated_at = now()
      where id = v_battle.id
      returning * into v_battle;
      v_terminal := v_battle.status;

    elsif v_command = 'use_skill' then
      select * into v_battle
      from monster_tamer.battles
      where id = (p_command->>'battle_id')::uuid
        and user_id = v_user_id
      for update;
      if v_battle.id is null or v_battle.status <> 'active' then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_NOT_FOUND',
          '进行中的战斗不存在'
        );
      end if;
      if v_battle.state_version <> (p_command->>'expected_battle_version')::bigint then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '战斗版本已经更新'
        );
      end if;
      if v_battle.state->>'active_template_id' <> p_command->>'actor_template_id' then
        perform api.raise_business_error(
          'MONSTER_TAMER_BATTLE_STATE_CONFLICT',
          '当前出战队员已经变化'
        );
      end if;
      select * into v_encounter
      from monster_tamer.encounter_definitions
      where id = v_battle.encounter_id;
      v_party := v_battle.state->'party';
      v_enemy := v_battle.state->'enemy';
      v_mechanic_state := coalesce(v_battle.state->'mechanic_state', '{}'::jsonb);
      v_mechanic_notice := v_battle.state->>'mechanic_notice';
      v_environment_element := v_battle.state->'environment'->>'element';
      v_environment_effect_code := v_battle.state->'environment'->>'effect_code';
      v_completed_turn := (v_battle.state->>'turn')::integer + 1;
      v_active_template := v_battle.state->>'active_template_id';
      select member into v_actor
      from jsonb_array_elements(v_party) member
      where member->>'template_id' = v_active_template;
      v_skill := monster_tamer.skill_json(
        v_active_template,
        (p_command->>'skill_slot')::smallint
      );
      if v_actor is null or v_skill is null then
        perform api.raise_business_error('REQUEST_INVALID', '战斗技能无效');
      end if;

      v_resolution := monster_tamer.apply_skill(v_actor, v_enemy, v_skill);
      v_actor := v_resolution->'attacker';
      v_enemy := v_resolution->'defender';
      select jsonb_agg(
        case
          when member->>'template_id' = v_active_template then v_actor
          else member
        end
        order by ordinality
      )
      into v_party
      from jsonb_array_elements(v_party)
      with ordinality party(member, ordinality);
      if v_encounter.mechanic_code = 'wetland_tide_shield'
        and (v_enemy->>'current_hp')::integer > 0
        and (v_enemy->>'current_hp')::integer * 2 <= (v_enemy->>'max_hp')::integer
        and not coalesce(
          (v_mechanic_state->>'tide_shield_triggered')::boolean,
          false
        )
      then
        v_statuses := v_enemy->'statuses';
        v_statuses := jsonb_set(
          v_statuses,
          '{shield_hp}',
          to_jsonb(
            (v_statuses->>'shield_hp')::integer
              + greatest(
                1,
                floor((v_enemy->>'max_hp')::numeric * 2000 / 10000)::integer
              )
          )
        );
        v_enemy := jsonb_set(v_enemy, '{statuses}', v_statuses);
        v_mechanic_state := jsonb_set(
          v_mechanic_state,
          '{tide_shield_triggered}',
          'true'::jsonb
        );
        v_mechanic_notice := '潮汐守护者生命首次降至一半，获得 20% 最大生命潮盾';
      end if;
      if (v_actor->>'current_hp')::integer <= 0 then
        select member->>'template_id' into v_active_template
        from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
        where (member->>'current_hp')::integer > 0
        order by ordinality
        limit 1;
      end if;
      if (v_enemy->>'current_hp')::integer <= 0 then
        v_terminal := 'won';
        v_new_status := 'won';
      elsif v_active_template is null then
        v_terminal := 'lost';
        v_new_status := 'lost';
      else
        select member into v_actor
        from jsonb_array_elements(v_party) member
        where member->>'template_id' = v_active_template;
        v_enemy_slot := (((v_battle.state->>'turn')::integer % 3) + 1)::smallint;
        v_enemy_skill := monster_tamer.skill_json(
          v_encounter.template_id,
          v_enemy_slot
        );
        v_resolution := monster_tamer.apply_skill(
          v_enemy,
          v_actor,
          v_enemy_skill
        );
        v_enemy := v_resolution->'attacker';
        v_actor := v_resolution->'defender';
        select jsonb_agg(
          case
            when member->>'template_id' = v_active_template then v_actor
            else member
          end
          order by ordinality
        )
        into v_party
        from jsonb_array_elements(v_party)
        with ordinality party(member, ordinality);
        if (v_enemy->>'current_hp')::integer <= 0 then
          v_terminal := 'won';
          v_new_status := 'won';
        elsif (v_actor->>'current_hp')::integer <= 0 then
          select member->>'template_id' into v_active_template
          from jsonb_array_elements(v_party) with ordinality party(member, ordinality)
          where (member->>'current_hp')::integer > 0
          order by ordinality
          limit 1;
          if v_active_template is null then
            v_terminal := 'lost';
            v_new_status := 'lost';
          end if;
        end if;
      end if;

      if v_terminal = 'ongoing' then
        case v_encounter.mechanic_code
          when 'forest_regrowth' then
            if v_completed_turn % 3 = 0 then
              v_enemy := jsonb_set(
                v_enemy,
                '{current_hp}',
                to_jsonb(
                  least(
                    (v_enemy->>'max_hp')::integer,
                    (v_enemy->>'current_hp')::integer
                      + greatest(
                        1,
                        floor((v_enemy->>'max_hp')::numeric * 800 / 10000)::integer
                      )
                  )
                )
              );
              v_mechanic_notice := '森之守护者触发再生，恢复 8% 最大生命';
            end if;

          when 'highland_gust_followup' then
            if v_completed_turn % 3 = 0 then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_extra_damage := greatest(
                1,
                floor((v_enemy->>'attack')::numeric * 3500 / 10000)::integer
              );
              v_actor := monster_tamer.apply_raw_damage(v_actor, v_extra_damage);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_notice := '高原守护者追加一次 35% 攻击力的风击';
              if (v_actor->>'current_hp')::integer <= 0 then
                select member->>'template_id' into v_active_template
                from jsonb_array_elements(v_party)
                with ordinality party(member, ordinality)
                where (member->>'current_hp')::integer > 0
                order by ordinality
                limit 1;
                if v_active_template is null then
                  v_terminal := 'lost';
                  v_new_status := 'lost';
                end if;
              end if;
            end if;

          when 'cavern_thunder_cycle' then
            if coalesce((v_mechanic_state->>'thunder_charged')::boolean, false) then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_extra_damage := greatest(
                1,
                floor((v_enemy->>'attack')::numeric * 7000 / 10000)::integer
              );
              v_actor := monster_tamer.apply_raw_damage(v_actor, v_extra_damage);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_state := jsonb_set(
                v_mechanic_state,
                '{thunder_charged}',
                'false'::jsonb
              );
              v_mechanic_notice := '洞窟守护者释放蓄雷，造成 70% 攻击力伤害';
              if (v_actor->>'current_hp')::integer <= 0 then
                select member->>'template_id' into v_active_template
                from jsonb_array_elements(v_party)
                with ordinality party(member, ordinality)
                where (member->>'current_hp')::integer > 0
                order by ordinality
                limit 1;
                if v_active_template is null then
                  v_terminal := 'lost';
                  v_new_status := 'lost';
                end if;
              end if;
            elsif v_completed_turn % 3 = 0 then
              v_mechanic_state := jsonb_set(
                v_mechanic_state,
                '{thunder_charged}',
                'true'::jsonb
              );
              v_mechanic_notice := '洞窟守护者开始蓄雷，将在下一回合释放';
            end if;

          when 'basin_scorch' then
            if v_completed_turn % 2 = 0 then
              select member into v_actor
              from jsonb_array_elements(v_party) member
              where member->>'template_id' = v_active_template;
              v_statuses := v_actor->'statuses';
              v_statuses := jsonb_set(
                v_statuses,
                '{burn_turns}',
                to_jsonb(greatest((v_statuses->>'burn_turns')::integer, 2))
              );
              v_statuses := jsonb_set(
                v_statuses,
                '{burn_damage}',
                to_jsonb(
                  greatest(
                    (v_statuses->>'burn_damage')::integer,
                    greatest(
                      1,
                      floor((v_enemy->>'attack')::numeric * 700 / 10000)::integer
                    )
                  )
                )
              );
              v_actor := jsonb_set(v_actor, '{statuses}', v_statuses);
              select jsonb_agg(
                case
                  when member->>'template_id' = v_active_template then v_actor
                  else member
                end
                order by ordinality
              )
              into v_party
              from jsonb_array_elements(v_party)
              with ordinality party(member, ordinality);
              v_mechanic_notice := '熔火守护者施加持续 2 次行动的灼烧';
            end if;

          when 'guardian_element_cycle' then
            v_guardian_index := (
              coalesce((v_mechanic_state->>'guardian_index')::integer, 0) + 1
            ) % 5;
            v_environment_element := v_guardian_elements[v_guardian_index + 1];
            v_environment_effect_code := v_guardian_effects[v_guardian_index + 1];
            v_mechanic_state := jsonb_set(
              v_mechanic_state,
              '{guardian_index}',
              to_jsonb(v_guardian_index)
            );
            select jsonb_agg(
              monster_tamer.apply_environment(
                member,
                v_environment_element,
                v_environment_effect_code
              )
              order by ordinality
            )
            into v_party
            from jsonb_array_elements(v_party)
            with ordinality party(member, ordinality);
            v_enemy := monster_tamer.apply_environment(
              v_enemy,
              v_environment_element,
              v_environment_effect_code
            );
            v_mechanic_notice := '最终守护者将环境切换为'
              || case v_environment_element
                when 'water' then '水'
                when 'fire' then '火'
                when 'wood' then '木'
                when 'wind' then '风'
                else '雷'
              end
              || '属性';

          else
            null;
        end case;
      end if;

      v_state := jsonb_build_object(
        'turn', v_completed_turn,
        'active_template_id', v_active_template,
        'party', v_party,
        'enemy', v_enemy,
        'environment', jsonb_build_object(
          'element', v_environment_element,
          'effect_code', v_environment_effect_code
        ),
        'mechanic_state', v_mechanic_state,
        'mechanic_notice', v_mechanic_notice,
        'return_position', v_battle.state->'return_position',
        'rematch', v_battle.state->'rematch'
      );
      update monster_tamer.battles
      set state = v_state,
          state_version = state_version + 1,
          status = v_new_status,
          updated_at = now(),
          completed_at = case when v_new_status = 'active' then null else now() end
      where id = v_battle.id
      returning * into v_battle;

      if v_terminal = 'won' then
        v_progress.resume_x := (
          v_battle.state->'return_position'->>'x'
        )::smallint;
        v_progress.resume_y := (
          v_battle.state->'return_position'->>'y'
        )::smallint;
        select jsonb_agg(
          jsonb_build_object(
            'template_id', member->>'template_id',
            'current_hp', (member->>'current_hp')::integer,
            'max_hp', (member->>'max_hp')::integer
          )
          order by ordinality
        )
        into v_progress.party_state
        from jsonb_array_elements(v_party)
        with ordinality party(member, ordinality);
        v_progress.supply_count := least(
          999,
          v_progress.supply_count + v_encounter.supply_reward
        );
        if v_encounter.kind = 'normal' then
          insert into monster_tamer.refreshable_claims (
            user_id, region_entry_serial, claim_id, claim_kind
          )
          values (
            v_user_id,
            v_battle.region_entry_serial,
            v_encounter.id,
            'encounter'
          )
          on conflict do nothing;
        elsif v_encounter.kind = 'elite'
          and not v_encounter.id = any(v_progress.defeated_elite_ids)
        then
          v_progress.defeated_elite_ids := array_append(
            v_progress.defeated_elite_ids,
            v_encounter.id
          );
        elsif v_encounter.kind = 'boss' then
          v_first_boss := not v_encounter.id = any(v_progress.defeated_boss_ids);
          if v_first_boss then
            v_progress.defeated_boss_ids := array_append(
              v_progress.defeated_boss_ids,
              v_encounter.id
            );
            if v_encounter.reward_ability is not null
              and not v_encounter.reward_ability = any(v_progress.abilities)
            then
              v_progress.abilities := array_append(
                v_progress.abilities,
                v_encounter.reward_ability
              );
            end if;
            if v_encounter.id = 'boss_luminous_forest'
              and not 'windswept_highlands' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'windswept_highlands'
              );
            elsif v_encounter.id = 'boss_tidal_wetland'
              and not 'crystal_cavern' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'crystal_cavern'
              );
            elsif v_encounter.id = 'boss_molten_basin'
              and not 'guardian_lair' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'guardian_lair'
              );
            end if;
            if 'boss_windswept_highlands' = any(v_progress.defeated_boss_ids)
              and 'boss_crystal_cavern' = any(v_progress.defeated_boss_ids)
              and not 'molten_basin' = any(v_progress.unlocked_regions)
            then
              v_progress.unlocked_regions := array_append(
                v_progress.unlocked_regions,
                'molten_basin'
              );
            end if;
          end if;
        elsif v_encounter.kind = 'guardian'
          and v_progress.guardian_completed_at is null
        then
          v_progress.guardian_completed_at := now();
        end if;
        if v_encounter.kind in ('normal', 'elite') then
          v_progress.regional_boost_region := v_progress.current_region;
        end if;
        v_progress.last_checkpoint := 'battle_won:' || v_encounter.id;
        v_progress.state_version := v_progress.state_version + 1;
      elsif v_terminal = 'lost' then
        v_progress.current_region := 'camp';
        select r.spawn_x, r.spawn_y
        into v_progress.resume_x, v_progress.resume_y
        from monster_tamer.regions r
        where r.id = 'camp'
          and r.rules_version = v_progress.rules_version;
        v_progress.party_state := monster_tamer.full_party_state(
          v_progress.party_template_ids
        );
        v_progress.last_checkpoint := 'battle_lost:' || v_encounter.id;
        v_progress.state_version := v_progress.state_version + 1;
      end if;

      if v_terminal <> 'ongoing' then
        update monster_tamer.player_progress
        set state_version = v_progress.state_version,
            current_region = v_progress.current_region,
            resume_x = v_progress.resume_x,
            resume_y = v_progress.resume_y,
            region_entry_serial = v_progress.region_entry_serial,
            party_template_ids = v_progress.party_template_ids,
            party_state = v_progress.party_state,
            unlocked_regions = v_progress.unlocked_regions,
            abilities = v_progress.abilities,
            revealed_cells = v_progress.revealed_cells,
            completed_node_ids = v_progress.completed_node_ids,
            defeated_elite_ids = v_progress.defeated_elite_ids,
            defeated_boss_ids = v_progress.defeated_boss_ids,
            guardian_completed_at = v_progress.guardian_completed_at,
            supply_count = v_progress.supply_count,
            regional_boost_region = v_progress.regional_boost_region,
            last_checkpoint = v_progress.last_checkpoint,
            updated_at = now()
        where user_id = v_user_id
        returning * into v_progress;
      end if;
    else
      perform api.raise_business_error(
        'REQUEST_INVALID',
        '未知的 Monster Tamer 战斗命令'
      );
    end if;

    return operations.complete_command(
      p_operation_id,
      jsonb_build_object(
        'battle', monster_tamer.battle_json(v_battle),
        'progress', monster_tamer.progress_json(v_progress),
        'terminal', v_terminal
      )
    );
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(
      p_operation_id,
      case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end,
      jsonb_build_object('detail', coalesce(v_detail, '{}'))
    );
  end;
end;
$$;

-- source: 50_market.sql
create table market.listings (
  id uuid primary key default extensions.gen_random_uuid(),
  seller_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  unit_price bigint not null check (unit_price > 0),
  quantity bigint not null check (quantity > 0),
  remaining bigint not null check (remaining >= 0 and remaining <= quantity),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  operation_id uuid not null references operations.operations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_fifo_idx on market.listings (template_id, created_at, id) where status = 'active' and remaining > 0;
create index listings_seller_active_idx on market.listings (seller_id, template_id, created_at) where status = 'active';

create table market.trades (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  total_price bigint not null check (total_price > 0),
  operation_id uuid not null unique references operations.operations(id),
  created_at timestamptz not null default now()
);

create index trades_buyer_created_idx on market.trades (buyer_id, created_at desc);
create index trades_template_created_idx on market.trades (template_id, created_at desc);

create table market.trade_details (
  id bigint generated always as identity primary key,
  trade_id uuid not null references market.trades(id) on delete cascade,
  listing_id uuid not null references market.listings(id),
  seller_id uuid not null references identity.users(id),
  quantity bigint not null check (quantity > 0),
  gross bigint not null check (gross > 0),
  fee bigint not null check (fee >= 0),
  seller_net bigint not null check (seller_net >= 0),
  vip_rebate bigint not null default 0 check (vip_rebate >= 0)
);

create index trade_details_trade_idx on market.trade_details (trade_id);
create index trade_details_seller_idx on market.trade_details (seller_id, id desc);

create or replace function api.market_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_path', t.image_thumbnail_path,
        'unit_price', t.market_price,
        'available_quantity', x.available_quantity,
        'own_listed_quantity', x.own_listed_quantity
      ) order by t.sort_order)
      from catalog.templates t
      join (
        select
          l.template_id,
          coalesce(sum(l.remaining) filter (where l.seller_id <> v_user_id), 0) available_quantity,
          coalesce(sum(l.remaining) filter (where l.seller_id = v_user_id), 0) own_listed_quantity
        from market.listings l
        join identity.users u on u.id = l.seller_id
        where l.status = 'active' and l.remaining > 0 and u.status = 'normal'
        group by l.template_id
      ) x on x.template_id = t.id
    ), '[]'::jsonb),
    'sellable_items', coalesce((
      select jsonb_agg(inventory.item_json(v_user_id, h.template_id) || jsonb_build_object('unit_price', t.market_price) order by t.sort_order)
      from inventory.holdings h
      join catalog.templates t on t.id = h.template_id
      where h.user_id = v_user_id and inventory.available_quantity(v_user_id, h.template_id) > 0
    ), '[]'::jsonb),
    'vip', vip.status_json(v_user_id),
    'max_active_templates', 10,
    'fee_bps', 500,
    'vip_rebate_bps', 2000
  );
end;
$$;

create or replace function api.market_template(p_session_id uuid, p_template_id text)
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
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'image_thumbnail_path', t.image_thumbnail_path,
    'unit_price', t.market_price,
    'available_quantity', coalesce(x.available_quantity, 0),
    'own_listed_quantity', coalesce(x.own_listed_quantity, 0)
  ) into v_result
  from catalog.templates t
  left join (
    select
      l.template_id,
      coalesce(sum(l.remaining) filter (where l.seller_id <> v_user_id), 0) available_quantity,
      coalesce(sum(l.remaining) filter (where l.seller_id = v_user_id), 0) own_listed_quantity
    from market.listings l
    join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and u.status = 'normal'
    group by l.template_id
  ) x on x.template_id = t.id
  where t.id = p_template_id;
  if v_result is null then
    perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.market_my_listings(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object('listings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'template_id', a.template_id,
      'name', t.name,
      'rarity', t.rarity,
      'stage', t.stage,
      'image_thumbnail_path', t.image_thumbnail_path,
      'listed_quantity', a.listed_quantity,
      'sold_quantity', coalesce(s.sold_quantity, 0),
      'unit_price', t.market_price,
      'estimated_gross', a.listed_quantity * t.market_price,
      'estimated_fee', floor(a.listed_quantity * t.market_price * 500.0 / 10000.0),
      'estimated_net', a.listed_quantity * t.market_price - floor(a.listed_quantity * t.market_price * 500.0 / 10000.0),
      'estimated_vip_rebate', case
        when exists (
          select 1 from vip.subscriptions v
          where v.user_id = v_user_id and identity.utc_day() between v.starts_on and v.ends_on
        )
        then floor(floor(a.listed_quantity * t.market_price * 500.0 / 10000.0) * 2000.0 / 10000.0)
        else 0
      end,
      'status', case when coalesce(s.sold_quantity, 0) > 0 then 'partially_sold' else 'active' end,
      'first_listed_at', a.first_listed_at
    ) order by t.sort_order)
    from (
      select l.template_id, sum(l.remaining) listed_quantity, min(l.created_at) first_listed_at
      from market.listings l
      where l.seller_id = v_user_id and l.status = 'active' and l.remaining > 0
      group by l.template_id
    ) a
    join catalog.templates t on t.id = a.template_id
    left join (
      select l.template_id, sum(l.quantity - l.remaining) sold_quantity
      from market.listings l
      where l.seller_id = v_user_id and l.quantity > l.remaining
      group by l.template_id
    ) s on s.template_id = a.template_id
  ), '[]'::jsonb));
end;
$$;

create or replace function api.market_create_listing(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_template catalog.templates%rowtype;
  v_listing market.listings%rowtype;
  v_active_count integer;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.create_listing', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    select count(distinct template_id) into v_active_count
    from market.listings
    where seller_id = v_user_id and status = 'active' and remaining > 0;
    if v_active_count >= 10 and not exists (
      select 1 from market.listings
      where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0
    ) then
      perform api.raise_business_error('MARKET_ACTIVE_TEMPLATE_LIMIT', '最多同时出售 10 种藏品，请先售罄或下架一种藏品');
    end if;
    insert into market.listings (seller_id, template_id, unit_price, quantity, remaining, operation_id)
    values (v_user_id, p_template_id, v_template.market_price, p_quantity, p_quantity, p_operation_id) returning * into v_listing;
    perform inventory.reserve(v_user_id, p_template_id, p_quantity, 'listing', v_listing.id);
    perform tasks.progress(v_user_id, 'market_list');
    v_result := jsonb_build_object('listing_id', v_listing.id, 'template_id', p_template_id, 'name', v_template.name, 'rarity', v_template.rarity, 'image_thumbnail_path', v_template.image_thumbnail_path, 'quantity', p_quantity, 'unit_price', v_template.market_price, 'created_at', v_listing.created_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.market_cancel_template_listings(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_released bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.cancel_template_listings', p_operation_id, jsonb_build_object('template_id', p_template_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if not exists (select 1 from catalog.templates where id = p_template_id) then
      perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
    end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    perform 1
    from market.listings
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0
    order by created_at, id
    for update;
    select coalesce(sum(remaining), 0) into v_released
    from market.listings
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0;
    update inventory.reservations r
    set status = 'released', released_at = now()
    where r.kind = 'listing' and r.status = 'active' and exists (
      select 1
      from market.listings l
      where l.id = r.reference_id and l.seller_id = v_user_id and l.template_id = p_template_id
        and l.status = 'active' and l.remaining > 0
    );
    update market.listings
    set status = 'cancelled', remaining = 0, updated_at = now()
    where seller_id = v_user_id and template_id = p_template_id and status = 'active' and remaining > 0;
    v_result := jsonb_build_object('template_id', p_template_id, 'status', 'cancelled', 'released_quantity', v_released);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.market_purchase(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text,
  p_quantity bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_template catalog.templates%rowtype;
  v_listing market.listings%rowtype;
  v_trade_id uuid;
  v_available bigint;
  v_remaining bigint;
  v_take bigint;
  v_gross bigint;
  v_fee bigint;
  v_rebate bigint;
  v_total bigint;
  v_details jsonb := '[]'::jsonb;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.purchase', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    perform 1 from market.listings l join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
    order by l.created_at, l.id for update of l;
    select coalesce(sum(l.remaining), 0) into v_available from market.listings l join identity.users u on u.id = l.seller_id
    where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal';
    if p_quantity <= 0 or v_available < p_quantity then perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足'); end if;
    v_total := v_template.market_price * p_quantity;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_total, 'market_buy', p_operation_id, p_template_id);
    insert into market.trades (buyer_id, template_id, quantity, total_price, operation_id)
    values (v_user_id, p_template_id, p_quantity, v_total, p_operation_id) returning id into v_trade_id;
    v_remaining := p_quantity;
    for v_listing in
      select l.* from market.listings l join identity.users u on u.id = l.seller_id
      where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
      order by l.created_at, l.id
    loop
      exit when v_remaining = 0;
      v_take := least(v_remaining, v_listing.remaining);
      v_gross := v_take * v_listing.unit_price;
      v_fee := floor(v_gross * 500.0 / 10000.0);
      v_rebate := case when exists (select 1 from vip.subscriptions where user_id = v_listing.seller_id and identity.utc_day() between starts_on and ends_on) then floor(v_fee * 2000.0 / 10000.0) else 0 end;
      if v_take = v_listing.remaining then
        update market.listings set remaining = 0, status = 'sold', updated_at = now() where id = v_listing.id;
        update inventory.reservations set status = 'consumed', released_at = now() where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      else
        update market.listings set remaining = remaining - v_take, updated_at = now() where id = v_listing.id;
        update inventory.reservations set quantity = quantity - v_take where kind = 'listing' and reference_id = v_listing.id and status = 'active';
      end if;
      perform inventory.change_holding(v_listing.seller_id, p_template_id, -v_take);
      perform economy.change_balance(v_listing.seller_id, 'KCOIN', v_gross - v_fee + v_rebate, 'market_sale', p_operation_id, v_trade_id::text);
      insert into market.trade_details (trade_id, listing_id, seller_id, quantity, gross, fee, seller_net, vip_rebate)
      values (v_trade_id, v_listing.id, v_listing.seller_id, v_take, v_gross, v_fee, v_gross - v_fee, v_rebate);
      v_details := v_details || jsonb_build_array(jsonb_build_object('quantity', v_take, 'unit_price', v_listing.unit_price, 'gross', v_gross, 'fee', v_fee));
      perform tasks.progress(v_listing.seller_id, 'market_sold');
      v_remaining := v_remaining - v_take;
    end loop;
    perform inventory.change_holding(v_user_id, p_template_id, p_quantity);
    perform album.unlock_template(v_user_id, p_template_id, p_operation_id);
    perform tasks.progress(v_user_id, 'market_buy');
    v_result := jsonb_build_object('trade_id', v_trade_id, 'template_id', p_template_id, 'quantity', p_quantity, 'unit_price', v_template.market_price, 'total_price', v_total, 'details', v_details, 'assets', economy.assets(v_user_id));
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 60_payments.sql
create table payments.topup_products (
  amount bigint primary key check (amount > 0),
  sort_order smallint not null unique check (sort_order > 0)
);

create table payments.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique references operations.operations(id),
  kind text not null check (kind in ('kcoin_topup', 'vip')),
  stars_amount bigint not null check (stars_amount > 0),
  kcoin_amount bigint not null default 0 check (kcoin_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'delivered', 'failed', 'cancelled', 'expired', 'refunded', 'rejected')),
  invoice_payload text not null unique,
  invoice_url text,
  pre_checkout_query_id text unique,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  checkout_started_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_orders_pending_idx on payments.orders (expires_at, created_at) where status in ('pending', 'processing', 'paid');
create index payment_orders_user_created_idx on payments.orders (user_id, created_at desc);
create unique index payment_orders_user_kind_open_idx on payments.orders (user_id, kind) where status in ('pending', 'processing', 'paid');

create or replace function payments.order_json(p_order payments.orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'kind', p_order.kind,
    'status', p_order.status,
    'stars_amount', p_order.stars_amount,
    'kcoin_amount', p_order.kcoin_amount,
    'invoice_url', p_order.invoice_url,
    'expires_at', p_order.expires_at,
    'checkout_started_at', p_order.checkout_started_at,
    'paid_at', p_order.paid_at,
    'delivered_at', p_order.delivered_at,
    'failed_at', p_order.failed_at,
    'cancelled_at', p_order.cancelled_at,
    'intent', nullif(p_order.intent, '{}'::jsonb)
  )
$$;

create or replace function api.topup_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'products', coalesce((select jsonb_agg(amount order by sort_order) from payments.topup_products), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(payments.order_json(p) order by p.created_at desc)
      from (
        select * from payments.orders
        where user_id = v_user_id
        order by created_at desc
        limit 10
      ) p
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.topup_order(p_session_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select payments.order_json(p) into v_result
  from payments.orders p where p.id = p_order_id and p.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.topup_create_order(
  p_session_id uuid,
  p_operation_id uuid,
  p_mode text,
  p_amount bigint,
  p_intent jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_balance bigint;
  v_required bigint;
  v_tier text;
  v_count integer;
  v_template catalog.templates%rowtype;
  v_box gacha.boxes%rowtype;
  v_order payments.orders%rowtype;
  v_stale payments.orders%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.create_order', p_operation_id, jsonb_strip_nulls(jsonb_build_object('mode', p_mode, 'amount', p_amount, 'intent', p_intent)));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    for v_stale in
      select * from payments.orders
      where user_id = v_user_id and kind = 'kcoin_topup' and status = 'pending' and checkout_started_at is null
      for update
    loop
      update payments.orders
      set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_stale.id
      returning * into v_stale;
      if exists (select 1 from operations.operations where id = v_stale.operation_id and status in ('pending', 'unknown')) then
        perform operations.fail_command(v_stale.operation_id, 'PAYMENT_CANCELLED', payments.order_json(v_stale));
      else
        update operations.operations set result = payments.order_json(v_stale), updated_at = now()
        where id = v_stale.operation_id;
      end if;
    end loop;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'kcoin_topup' and status in ('processing', 'paid')) then
      perform api.raise_business_error('PAYMENT_ALREADY_PROCESSING', '已有已提交支付的充值订单');
    end if;
    if p_intent is not null and p_intent <> '{}'::jsonb then
      select available into v_balance from economy.balances where user_id = v_user_id and currency = 'KCOIN' for update;
      if p_intent->>'kind' = 'gacha' then
        v_tier := p_intent->>'tier'; v_count := (p_intent->>'draw_count')::integer;
        select * into v_box from gacha.boxes where tier = v_tier;
        if v_box.tier is null or v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '开盒补差意图无效'); end if;
        v_required := case when v_count = 10 then v_box.ten_price else v_box.single_price end;
        if v_count = 1 and v_tier in ('normal', 'rare') and exists (
          select 1 from economy.entitlements where user_id = v_user_id and kind = case v_tier when 'normal' then 'free_normal_box' else 'free_rare_box' end and status = 'unused'
        ) then v_required := 0; end if;
      elsif p_intent->>'kind' = 'market' then
        select * into v_template from catalog.templates where id = p_intent->>'template_id';
        v_count := (p_intent->>'quantity')::integer;
        if v_template.id is null or v_count <= 0 then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '市场补差意图无效'); end if;
        v_required := v_template.market_price * v_count;
      elsif p_intent->>'kind' = 'wheel' then
        v_count := (p_intent->>'count')::integer;
        if v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '转盘补差意图无效'); end if;
        v_required := case when v_count = 10 then 180 else 20 end;
      else
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      v_required := greatest(v_required - coalesce(v_balance, 0), 0);
      if v_required = 0 then perform api.raise_business_error('TOPUP_NOT_REQUIRED', '当前余额无需补差'); end if;
    end if;
    if p_mode = 'fixed' then
      if p_amount is null or not exists (select 1 from payments.topup_products where amount = p_amount) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值档位无效'); end if;
      if p_intent is not null and p_intent <> '{}'::jsonb and p_amount < v_required then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值档位不足以覆盖最新差额'); end if;
      v_required := p_amount;
    elsif p_mode = 'exact_gap' then
      if p_intent is null or p_intent = '{}'::jsonb then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效'); end if;
    else
      perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '充值模式无效');
    end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, kcoin_amount, invoice_payload, intent, expires_at)
    values (v_user_id, p_operation_id, 'kcoin_topup', v_required, v_required, 'pokepets:' || extensions.gen_random_uuid(), coalesce(p_intent, '{}'::jsonb), now() + interval '15 minutes')
    returning * into v_order;
    v_result := payments.order_json(v_order);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function payments.vip_stars_price()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 199
$$;

create or replace function api.vip_create_order(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_status jsonb;
  v_order payments.orders%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'vip.create_order', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':vip', 0));
    v_status := vip.status_json(v_user_id);
    if not coalesce((v_status->>'can_purchase')::boolean, false) and not coalesce((v_status->>'can_renew')::boolean, false) then perform api.raise_business_error('VIP_RENEWAL_LIMIT', '月卡续费次数已达上限'); end if;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'vip' and status in ('pending', 'processing', 'paid')) then perform api.raise_business_error('PAYMENT_ALREADY_PENDING', '已有待处理月卡订单'); end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, invoice_payload, expires_at)
    values (v_user_id, p_operation_id, 'vip', payments.vip_stars_price(), 'pokepets:' || extensions.gen_random_uuid(), now() + interval '15 minutes') returning * into v_order;
    v_result := payments.order_json(v_order);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.payment_set_invoice_url(p_order_id uuid, p_invoice_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype; v_result jsonb;
begin
  update payments.orders set invoice_url = coalesce(invoice_url, p_invoice_url), updated_at = now()
  where id = p_order_id and status = 'pending' returning * into v_order;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  v_result := payments.order_json(v_order);
  return operations.complete_command(v_order.operation_id, v_result);
end;
$$;

create or replace function api.payment_fail_invoice_creation(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype;
begin
  select * into v_order from payments.orders where id = p_order_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  if v_order.status = 'pending' and v_order.invoice_url is null then
    update payments.orders set status = 'failed', failed_at = now(), updated_at = now()
    where id = v_order.id returning * into v_order;
    return operations.fail_command(v_order.operation_id, 'TELEGRAM_API_FAILED', payments.order_json(v_order));
  end if;
  return (select operations.operation_json(o) from operations.operations o where o.id = v_order.operation_id);
end;
$$;

create or replace function api.topup_cancel_order(p_session_id uuid, p_operation_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_order payments.orders%rowtype;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.cancel_order', p_operation_id, jsonb_build_object('order_id', p_order_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    select * into v_order from payments.orders
    where id = p_order_id and user_id = v_user_id and kind = 'kcoin_topup'
    for update;
    if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
    if v_order.status = 'pending' and v_order.checkout_started_at is null then
      update payments.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id returning * into v_order;
    elsif v_order.status in ('processing', 'paid') then
      perform api.raise_business_error('PAYMENT_ALREADY_PROCESSING', '支付已经提交，当前不能取消');
    end if;
    update operations.operations set result = payments.order_json(v_order), updated_at = now()
    where id = v_order.operation_id;
    return operations.complete_command(p_operation_id, payments.order_json(v_order));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.topup_fail_order(p_session_id uuid, p_operation_id uuid, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_order payments.orders%rowtype;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.fail_order', p_operation_id, jsonb_build_object('order_id', p_order_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('pokepets:payment:' || v_user_id::text || ':kcoin_topup', 0));
    select * into v_order from payments.orders
    where id = p_order_id and user_id = v_user_id and kind = 'kcoin_topup'
    for update;
    if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
    if v_order.status in ('pending', 'processing') and v_order.telegram_payment_charge_id is null then
      update payments.orders set status = 'failed', failed_at = now(), updated_at = now()
      where id = v_order.id returning * into v_order;
    end if;
    update operations.operations set result = payments.order_json(v_order), updated_at = now()
    where id = v_order.operation_id;
    return operations.complete_command(p_operation_id, payments.order_json(v_order));
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 61_vip.sql
create table vip.subscriptions (
  user_id uuid primary key references identity.users(id) on delete cascade,
  period_id uuid not null default extensions.gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  renewal_count smallint not null default 0 check (renewal_count between 0 and 2),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table vip.claims (
  user_id uuid not null references identity.users(id) on delete cascade,
  benefit_date date not null,
  benefit text not null check (benefit in ('fgems', 'free_rare_box')),
  operation_id uuid not null references operations.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, benefit_date, benefit)
);

create or replace function vip.status_json(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_subscription vip.subscriptions%rowtype;
  v_active boolean;
begin
  select * into v_subscription from vip.subscriptions where user_id = p_user_id;
  v_active := v_subscription.user_id is not null and identity.utc_day() between v_subscription.starts_on and v_subscription.ends_on;
  return jsonb_build_object(
    'active', v_active,
    'benefit_date', identity.utc_day(),
    'starts_on', case when v_subscription.user_id is null then null else v_subscription.starts_on end,
    'ends_on', case when v_subscription.user_id is null then null else v_subscription.ends_on end,
    'remaining_days', case when v_active then v_subscription.ends_on - identity.utc_day() + 1 else 0 end,
    'renewals_used', coalesce(v_subscription.renewal_count, 0),
    'can_purchase', not v_active,
    'can_renew', v_active and v_subscription.renewal_count < 2,
    'fgems_claimed_today', exists(select 1 from vip.claims where user_id = p_user_id and benefit_date = identity.utc_day() and benefit = 'fgems'),
    'free_box_claimed_today', exists(select 1 from vip.claims where user_id = p_user_id and benefit_date = identity.utc_day() and benefit = 'free_rare_box'),
    'free_box_used_today', exists(
      select 1
      from vip.claims c
      join economy.entitlements e on e.user_id = c.user_id and e.operation_id = c.operation_id and e.kind = 'free_rare_box'
      where c.user_id = p_user_id and c.benefit_date = identity.utc_day() and c.benefit = 'free_rare_box' and e.status = 'used'
    )
  );
end;
$$;

create or replace function api.vip_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_pending jsonb;
begin
  select payments.order_json(p) into v_pending
  from payments.orders p
  where p.user_id = v_user_id and p.kind = 'vip' and p.status in ('pending', 'processing', 'paid')
  order by p.created_at desc limit 1;
  return vip.status_json(v_user_id) || jsonb_build_object(
    'stars_price', payments.vip_stars_price(),
    'free_rare_box_available', (
      select count(*) from economy.entitlements
      where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused'
    ),
    'pending_order', v_pending
  );
end;
$$;

create or replace function api.vip_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_benefit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_result jsonb;
  v_detail text;
begin
  if p_benefit not in ('fgems', 'free_rare_box') then perform api.raise_business_error('VIP_BENEFIT_INVALID', '月卡权益无效'); end if;
  v_operation := operations.begin_command(
    p_session_id,
    case p_benefit when 'fgems' then 'vip.claim_fgems' else 'vip.claim_free_box' end,
    p_operation_id,
    '{}'::jsonb
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if not exists (select 1 from vip.subscriptions where user_id = v_user_id and identity.utc_day() between starts_on and ends_on) then perform api.raise_business_error('VIP_INACTIVE', '月卡未生效'); end if;
    insert into vip.claims (user_id, benefit_date, benefit, operation_id)
    values (v_user_id, identity.utc_day(), p_benefit, p_operation_id)
    on conflict do nothing;
    if not found then perform api.raise_business_error('VIP_ALREADY_CLAIMED', '今日权益已领取'); end if;
    if p_benefit = 'fgems' then
      perform economy.change_balance(v_user_id, 'FGEMS', 100, 'vip_daily', p_operation_id, identity.utc_day()::text);
      v_result := jsonb_build_object('kind', 'fgems', 'amount', 100, 'claimed', true);
    else
      insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, 'free_rare_box', 'vip_daily', p_operation_id);
      v_result := jsonb_build_object('kind', 'free_rare_box', 'amount', 1, 'claimed', true);
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 62_tasks.sql
create table tasks.definitions (
  code text primary key,
  sort_order smallint not null unique check (sort_order between 1 and 19),
  category text not null check (category in ('gacha', 'daily', 'social', 'market', 'inventory', 'expedition', 'album', 'wallet', 'mint')),
  title text not null check (btrim(title) <> ''),
  description text not null check (btrim(description) <> ''),
  completion_action text not null check (completion_action in ('gacha_single', 'gacha_ten', 'wheel', 'referral_copy', 'referral_telegram', 'market_buy', 'market_sell', 'market_manage', 'inventory_evolution', 'inventory_decomposition', 'expedition_normal', 'expedition_intermediate', 'expedition_advanced', 'album', 'wallet', 'inventory_mint')),
  target bigint not null check (target > 0),
  reward_fgems bigint not null check (reward_fgems > 0)
);

create table tasks.daily_progress (
  user_id uuid not null references identity.users(id) on delete cascade,
  business_date date not null,
  task_code text not null references tasks.definitions(code),
  progress bigint not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  claim_operation_id uuid references operations.operations(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date, task_code)
);

create index task_progress_claimable_idx on tasks.daily_progress (user_id, business_date) where claimed_at is null;

create table tasks.checkins (
  user_id uuid primary key references identity.users(id) on delete cascade,
  current_day smallint not null default 0 check (current_day between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

create or replace function tasks.progress(p_user_id uuid, p_task_code text, p_amount bigint default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tasks.daily_progress (user_id, business_date, task_code, progress)
  select p_user_id, identity.utc_day(), p_task_code, p_amount
  where exists (select 1 from tasks.definitions where code = p_task_code)
  on conflict (user_id, business_date, task_code)
  do update set progress = tasks.daily_progress.progress + excluded.progress, updated_at = now()
$$;

create or replace function tasks.checkin_json(p_user_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row tasks.checkins%rowtype;
begin
  select * into v_row from tasks.checkins where user_id = p_user_id;
  return jsonb_build_object(
    'next_day', case when coalesce(v_row.current_day, 0) = 7 then 1 else coalesce(v_row.current_day, 0) + 1 end,
    'claimed_today', coalesce(v_row.last_claim_date = identity.utc_day(), false),
    'cycle_progress', coalesce(v_row.current_day, 0)
  );
end;
$$;

create or replace function api.tasks_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', d.code,
        'order', d.sort_order,
        'category', d.category,
        'title', d.title,
        'description', d.description,
        'completion_action', d.completion_action,
        'target', d.target,
        'progress', least(coalesce(p.progress, 0), d.target),
        'reward_fgems', d.reward_fgems,
        'status', case
          when p.claimed_at is not null then 'claimed'
          when coalesce(p.progress, 0) >= d.target then 'claimable'
          when coalesce(p.progress, 0) > 0 then 'in_progress'
          else 'not_started'
        end
      ) order by d.sort_order)
      from tasks.definitions d
      left join tasks.daily_progress p
        on p.user_id = v_user_id and p.business_date = identity.utc_day() and p.task_code = d.code
    ), '[]'::jsonb),
    'checkin', tasks.checkin_json(v_user_id)
  );
end;
$$;

create or replace function api.tasks_check_in(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_day integer;
  v_reward bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'tasks.check_in', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    insert into tasks.checkins (user_id) values (v_user_id) on conflict do nothing;
    select current_day into v_day from tasks.checkins where user_id = v_user_id for update;
    if exists (select 1 from tasks.checkins where user_id = v_user_id and last_claim_date = identity.utc_day()) then perform api.raise_business_error('CHECKIN_ALREADY_CLAIMED', '今日已签到'); end if;
    v_day := case when v_day = 7 then 1 else v_day + 1 end;
    update tasks.checkins set current_day = v_day, last_claim_date = identity.utc_day(), updated_at = now() where user_id = v_user_id;
    if v_day = 7 then
      insert into economy.entitlements (user_id, kind, source, operation_id) values (v_user_id, 'free_rare_box', 'checkin_day_7', p_operation_id);
      v_result := jsonb_build_object('day', v_day, 'reward_kind', 'free_rare_box', 'reward_amount', 1, 'claimed', true);
    else
      v_reward := (array[20,30,50,80,100,150])[v_day];
      perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'checkin', p_operation_id, v_day::text);
      v_result := jsonb_build_object('day', v_day, 'reward_kind', 'fgems', 'reward_amount', v_reward, 'claimed', true);
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.tasks_claim(p_session_id uuid, p_operation_id uuid, p_task_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_definition tasks.definitions%rowtype;
  v_progress tasks.daily_progress%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'tasks.claim', p_operation_id, jsonb_build_object('task_code', p_task_code));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_definition from tasks.definitions where code = p_task_code;
    if v_definition.code is null then perform api.raise_business_error('TASK_NOT_FOUND', '任务不存在'); end if;
    insert into tasks.daily_progress (user_id, business_date, task_code) values (v_user_id, identity.utc_day(), p_task_code) on conflict do nothing;
    select * into v_progress from tasks.daily_progress where user_id = v_user_id and business_date = identity.utc_day() and task_code = p_task_code for update;
    if v_progress.claimed_at is not null then perform api.raise_business_error('TASK_ALREADY_CLAIMED', '任务奖励已领取'); end if;
    if v_progress.progress < v_definition.target then perform api.raise_business_error('TASK_NOT_COMPLETE', '任务尚未完成'); end if;
    update tasks.daily_progress set claimed_at = now(), claim_operation_id = p_operation_id, updated_at = now()
    where user_id = v_user_id and business_date = identity.utc_day() and task_code = p_task_code;
    perform economy.change_balance(v_user_id, 'FGEMS', v_definition.reward_fgems, 'task_reward', p_operation_id, p_task_code);
    v_result := jsonb_build_object('task_code', p_task_code, 'reward_fgems', v_definition.reward_fgems, 'claimed', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 63_referral.sql
create table referral.relationships (
  invitee_id uuid primary key references identity.users(id) on delete cascade,
  inviter_id uuid not null references identity.users(id) on delete cascade,
  bound_at timestamptz not null default now(),
  first_recharge_at timestamptz,
  reward_fgems bigint not null default 0 check (reward_fgems in (0, 500)),
  reward_operation_id uuid references operations.operations(id),
  unique (inviter_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create index referrals_inviter_bound_idx on referral.relationships (inviter_id, bound_at);
create index referrals_inviter_recharge_idx on referral.relationships (inviter_id, first_recharge_at) where first_recharge_at is not null;

create table referral.milestones (
  user_id uuid not null references identity.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null references operations.operations(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);

create or replace function api.referral_get(p_session_id uuid, p_bot_username text, p_mini_app_short_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_code text;
begin
  select referral_code into v_code from identity.users where id = v_user_id;
  return jsonb_build_object(
    'referral_code', v_code,
    'link', 'https://t.me/' || p_bot_username || '/' || p_mini_app_short_name || '?startapp=' || v_code,
    'share_text', '邀请好友一起开盲盒。好友通过你的链接加入并完成首次有效充值后，你可获得500 Fgems；累计邀请5位有效充值好友可额外获得1次免费普通盲盒资格，累计邀请10位有效充值好友可额外获得1次免费稀有盲盒资格。',
    'bound_friends', (select count(*) from referral.relationships where inviter_id = v_user_id),
    'valid_recharge_friends', (select count(*) from referral.relationships where inviter_id = v_user_id and first_recharge_at is not null),
    'reward_fgems_total', (select coalesce(sum(reward_fgems), 0) from referral.relationships where inviter_id = v_user_id),
    'rewarded_today', (select count(*) from referral.relationships where inviter_id = v_user_id and first_recharge_at::date = identity.utc_day() and reward_fgems = 500),
    'rewarded_lifetime', (select count(*) from referral.relationships where inviter_id = v_user_id and reward_fgems = 500),
    'milestone_5_status', case when exists(select 1 from referral.milestones where user_id = v_user_id and threshold = 5) then 'granted' else 'pending' end,
    'milestone_10_status', case when exists(select 1 from referral.milestones where user_id = v_user_id and threshold = 10) then 'granted' else 'pending' end
  );
end;
$$;

create or replace function referral.reject_bind(
  p_session_id uuid,
  p_operation_id uuid,
  p_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update identity.entry_candidates
  set status = 'rejected', result_code = p_code, operation_id = p_operation_id,
      settled_at = now()
  where user_id = p_user_id and status = 'pending';
  update identity.sessions
  set referral_processed_at = coalesce(referral_processed_at, now())
  where id = p_session_id and user_id = p_user_id;
  return operations.fail_command(p_operation_id, p_code, '{}'::jsonb);
end;
$$;

create or replace function api.referral_bind(
  p_session_id uuid,
  p_operation_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_candidate identity.entry_candidates%rowtype;
  v_inviter_id uuid;
  v_inviter_status text;
  v_result jsonb;
begin
  v_operation := operations.begin_command(p_session_id, 'referral.bind', p_operation_id, jsonb_build_object('code', p_code));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then
    if v_operation.status in ('succeeded', 'failed') then
      update identity.sessions
      set referral_processed_at = coalesce(referral_processed_at, now())
      where id = p_session_id and user_id = v_operation.user_id;
    end if;
    return v_replay;
  end if;
  v_user_id := v_operation.user_id;
  select * into v_candidate from identity.entry_candidates where user_id = v_user_id for update;

  if exists (select 1 from referral.relationships where invitee_id = v_user_id) then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_ALREADY_BOUND');
  end if;
  if v_candidate.user_id is null then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_OLD_USER');
  end if;
  if v_candidate.code is distinct from p_code then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_INELIGIBLE');
  end if;
  if v_candidate.status = 'rejected' then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, v_candidate.result_code);
  end if;
  if v_candidate.status = 'bound' then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_ALREADY_BOUND');
  end if;
  if now() > v_candidate.expires_at then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_CANDIDATE_EXPIRED');
  end if;
  if exists (select 1 from payments.orders where user_id = v_user_id and status = 'delivered') then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_ALREADY_RECHARGED');
  end if;

  select id, status into v_inviter_id, v_inviter_status
  from identity.users where referral_code = p_code;
  if v_inviter_id is null then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_CODE_INVALID');
  end if;
  if v_inviter_id = v_user_id then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_SELF_BIND');
  end if;
  if v_inviter_status <> 'normal' then
    return referral.reject_bind(p_session_id, p_operation_id, v_user_id, 'REFERRAL_INVITER_UNAVAILABLE');
  end if;

  update identity.users set invited_by = v_inviter_id, updated_at = now()
  where id = v_user_id and invited_by is null;
  insert into referral.relationships (invitee_id, inviter_id) values (v_user_id, v_inviter_id);
  update identity.entry_candidates
  set status = 'bound', result_code = 'REFERRAL_BOUND', operation_id = p_operation_id,
      inviter_id = v_inviter_id, settled_at = now()
  where user_id = v_user_id;
  update identity.sessions
  set referral_processed_at = coalesce(referral_processed_at, now())
  where id = p_session_id and user_id = v_user_id;
  v_result := jsonb_build_object('bound', true, 'referral_code', p_code);
  return operations.complete_command(p_operation_id, v_result);
end;
$$;

create or replace function api.referral_share_event(
  p_session_id uuid,
  p_operation_id uuid,
  p_event text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'referral.share_event', p_operation_id, jsonb_build_object('event', p_event));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    if p_event = 'copy_link' then perform tasks.progress(v_operation.user_id, 'copy_referral');
    elsif p_event = 'telegram_invite' then perform tasks.progress(v_operation.user_id, 'telegram_invite');
    else perform api.raise_business_error('SHARE_EVENT_INVALID', '分享事件无效'); end if;
    v_result := jsonb_build_object('recorded', true, 'event', p_event);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 64_album.sql
create table album.nodes (
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  first_operation_id uuid references operations.operations(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index album_nodes_template_idx on album.nodes (template_id, user_id);

create table album.rewards (
  user_id uuid not null references identity.users(id) on delete cascade,
  chain_id text not null references catalog.chains(id),
  operation_id uuid not null references operations.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, chain_id)
);

create or replace function album.unlock_template(p_user_id uuid, p_template_id text, p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
  v_chain_id text;
begin
  insert into album.nodes (user_id, template_id, first_operation_id)
  values (p_user_id, p_template_id, p_operation_id)
  on conflict (user_id, template_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    select chain_id into v_chain_id from catalog.templates where id = p_template_id;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text || ':' || v_chain_id, 0));
    perform tasks.progress(p_user_id, 'album_unlock');
    if (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = p_user_id and t.chain_id = v_chain_id) = 3 then
      perform tasks.progress(p_user_id, 'album_chain');
    end if;
  end if;
  return v_rows = 1;
end;
$$;

create or replace function api.album_get(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return (
    with chain_rows as (
      select
        c.id,
        c.global_order,
        c.chain_type,
        c.theme,
        case c.chain_type when 'normal' then 100 when 'advanced' then 300 else 800 end reward_fgems,
        count(n.template_id)::integer unlocked_count,
        exists(select 1 from album.rewards r where r.user_id = v_user_id and r.chain_id = c.id) claimed,
        jsonb_agg(jsonb_build_object(
          'template_id', t.id,
          'name', t.name,
          'image_thumbnail_path', t.image_thumbnail_path,
          'image_detail_path', t.image_detail_path,
          'rarity', t.rarity,
          'stage', t.stage,
          'unlocked', n.template_id is not null,
          'owned_count', coalesce(h.quantity, 0)
        ) order by t.stage) nodes
      from catalog.chains c
      join catalog.templates t on t.chain_id = c.id
      left join album.nodes n on n.user_id = v_user_id and n.template_id = t.id
      left join inventory.holdings h on h.user_id = v_user_id and h.template_id = t.id
      group by c.id, c.global_order, c.chain_type, c.theme
    )
    select jsonb_build_object(
      'unlocked_count', coalesce(sum(unlocked_count), 0),
      'total_count', 210,
      'completed_chain_count', count(*) filter (where unlocked_count = 3),
      'total_chain_count', 70,
      'claimable_count', count(*) filter (where unlocked_count = 3 and not claimed),
      'chains', coalesce(jsonb_agg(jsonb_build_object(
        'chain_id', id,
        'chain_type', chain_type,
        'theme', theme,
        'unlocked_count', unlocked_count,
        'completed', unlocked_count = 3,
        'claimable', unlocked_count = 3 and not claimed,
        'claimed', claimed,
        'reward_fgems', reward_fgems,
        'nodes', nodes
      ) order by global_order), '[]'::jsonb)
    )
    from chain_rows
  );
end;
$$;

create or replace function api.album_claim(
  p_session_id uuid,
  p_operation_id uuid,
  p_chain_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_chain catalog.chains%rowtype;
  v_reward bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'album.claim', p_operation_id, jsonb_build_object('chain_id', p_chain_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_chain from catalog.chains where id = p_chain_id;
    v_reward := case v_chain.chain_type when 'normal' then 100 when 'advanced' then 300 when 'top' then 800 end;
    if v_reward is null or (select count(*) from album.nodes n join catalog.templates t on t.id = n.template_id where n.user_id = v_user_id and t.chain_id = p_chain_id) <> 3 then perform api.raise_business_error('ALBUM_CHAIN_INCOMPLETE', '进化链尚未完成'); end if;
    insert into album.rewards (user_id, chain_id, operation_id) values (v_user_id, p_chain_id, p_operation_id) on conflict do nothing;
    if not found then perform api.raise_business_error('ALBUM_REWARD_ALREADY_CLAIMED', '图鉴奖励已领取'); end if;
    perform economy.change_balance(v_user_id, 'FGEMS', v_reward, 'album_reward', p_operation_id, p_chain_id);
    v_result := jsonb_build_object('chain_id', p_chain_id, 'chain_type', v_chain.chain_type, 'theme', v_chain.theme, 'reward_fgems', v_reward, 'claimed', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 65_catalog_api.sql
create or replace function api.catalog_get()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', (select product_checksum from catalog.versions where id = 'v1'),
    'chains', coalesce((select jsonb_agg(to_jsonb(c) order by c.global_order) from catalog.chains c), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from catalog.templates t), '[]'::jsonb),
    'boxes', coalesce((select jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end) from gacha.boxes b), '[]'::jsonb),
    'topup_products', coalesce((select jsonb_agg(p.amount order by p.sort_order) from payments.topup_products p), '[]'::jsonb)
  )
$$;

-- source: 70_wallet.sql
create table onchain.wallet_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  challenge text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallet_challenges_user_active_idx on onchain.wallet_challenges (user_id, expires_at desc) where consumed_at is null;

create table onchain.wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  address text not null unique,
  network text not null check (network in ('mainnet', 'testnet')),
  wallet_app_name text,
  public_key text not null,
  status text not null default 'verified' check (status in ('verified', 'disconnected', 'revoked')),
  verified_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index wallets_user_verified_idx on onchain.wallets (user_id) where status = 'verified';

create or replace function api.wallet_get(p_session_id uuid)
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
    'connected', true,
    'address', w.address,
    'network', w.network,
    'wallet_app_name', w.wallet_app_name,
    'verified_at', w.verified_at
  ) into v_result
  from onchain.wallets w where w.user_id = v_user_id and w.status = 'verified';
  return coalesce(v_result, jsonb_build_object(
    'connected', false,
    'address', null,
    'network', null,
    'wallet_app_name', null,
    'verified_at', null
  ));
end;
$$;

create or replace function api.wallet_create_challenge(
  p_session_id uuid,
  p_payload text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  delete from onchain.wallet_challenges
  where user_id = v_user_id and consumed_at is null and expires_at <= now();
  insert into onchain.wallet_challenges (user_id, challenge, expires_at)
  values (v_user_id, p_payload, p_expires_at);
  return jsonb_build_object('payload', p_payload, 'expires_at', p_expires_at);
end;
$$;

create or replace function api.wallet_save_verified(
  p_session_id uuid,
  p_operation_id uuid,
  p_challenge text,
  p_address text,
  p_network text,
  p_wallet_app_name text,
  p_public_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_challenge onchain.wallet_challenges%rowtype;
  v_wallet onchain.wallets%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wallet.verify', p_operation_id, jsonb_build_object('address', p_address, 'network', p_network, 'wallet_app_name', p_wallet_app_name));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_network not in ('mainnet', 'testnet') then perform api.raise_business_error('WALLET_PROOF_INVALID', '钱包网络无效'); end if;
    select * into v_challenge from onchain.wallet_challenges
    where user_id = v_user_id and challenge = p_challenge and consumed_at is null and expires_at > now() for update;
    if v_challenge.id is null then perform api.raise_business_error('WALLET_CHALLENGE_INVALID', '钱包挑战已失效'); end if;
    if exists (select 1 from onchain.wallets where address = p_address and user_id <> v_user_id and status = 'verified') then perform api.raise_business_error('WALLET_ADDRESS_IN_USE', '该地址已绑定其他账号'); end if;
    update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where user_id = v_user_id and status = 'verified';
    insert into onchain.wallets (user_id, address, network, wallet_app_name, public_key)
    values (v_user_id, p_address, p_network, p_wallet_app_name, p_public_key)
    on conflict (address) do update set network = excluded.network, wallet_app_name = excluded.wallet_app_name, public_key = excluded.public_key, status = 'verified', verified_at = now(), disconnected_at = null, updated_at = now()
    returning * into v_wallet;
    update onchain.wallet_challenges set consumed_at = now() where id = v_challenge.id;
    perform tasks.progress(v_user_id, 'wallet_verified');
    v_result := jsonb_build_object('connected', true, 'address', v_wallet.address, 'network', v_wallet.network, 'wallet_app_name', v_wallet.wallet_app_name, 'verified_at', v_wallet.verified_at);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.wallet_disconnect(p_session_id uuid, p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_wallet onchain.wallets%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'wallet.disconnect', p_operation_id, '{}'::jsonb);
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_wallet from onchain.wallets where user_id = v_user_id and status = 'verified' for update;
    if v_wallet.id is null then perform api.raise_business_error('WALLET_NOT_CONNECTED', '钱包未连接'); end if;
    if exists (select 1 from onchain.mints where user_id = v_user_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_IN_PROGRESS', 'Mint 处理中不能断开钱包'); end if;
    update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where id = v_wallet.id;
    v_result := jsonb_build_object('disconnected', true);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 71_mint.sql
create table onchain.mints (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  wallet_id uuid not null references onchain.wallets(id),
  template_id text not null references catalog.templates(id),
  operation_id uuid not null unique references operations.operations(id),
  nft_number bigint generated always as identity (start with 0 minvalue 0) unique,
  nonce uuid not null default extensions.gen_random_uuid() unique,
  permit text,
  status text not null default 'reserved' check (status in ('reserved', 'submitted', 'succeeded', 'failed', 'cancelled', 'unknown')),
  permit_expires_at timestamptz not null,
  transaction_hash text unique,
  nft_address text unique,
  metadata_uri text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mints_pending_idx on onchain.mints (status, created_at) where status in ('reserved', 'submitted', 'unknown');
create index mints_user_created_idx on onchain.mints (user_id, created_at desc);
create unique index mints_user_template_active_idx on onchain.mints (user_id, template_id) where status in ('reserved', 'submitted', 'unknown');

create table onchain.nft_metadata (
  nft_number bigint primary key,
  mint_id uuid not null unique references onchain.mints(id),
  snapshot jsonb not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

create or replace function onchain.mint_json(p_mint onchain.mints)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_mint.id,
    'template_id', p_mint.template_id,
    'status', p_mint.status,
    'nft_number', p_mint.nft_number,
    'transaction_hash', p_mint.transaction_hash,
    'permit_expires_at', p_mint.permit_expires_at,
    'submitted_at', p_mint.submitted_at,
    'completed_at', p_mint.completed_at
  )
$$;

create or replace function api.mint_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object('mints', coalesce((
    select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
    from onchain.mints m where m.user_id = v_user_id
  ), '[]'::jsonb));
end;
$$;

create or replace function api.mint_get(p_session_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select onchain.mint_json(m) into v_result
  from onchain.mints m where m.id = p_mint_id and m.user_id = v_user_id;
  if v_result is null then
    perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.mint_metadata(p_nft_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select snapshot into v_result from onchain.nft_metadata where nft_number = p_nft_id;
  if v_result is null then
    perform api.raise_business_error('NFT_METADATA_NOT_FOUND', 'NFT 元数据不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.mint_reserve(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_user_id uuid;
  v_wallet onchain.wallets%rowtype;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.reserve', p_operation_id, jsonb_build_object('template_id', p_template_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    select * into v_wallet from onchain.wallets where user_id = v_user_id and status = 'verified' for share;
    if v_wallet.id is null then perform api.raise_business_error('WALLET_NOT_VERIFIED', '钱包尚未验证'); end if;
    perform pg_advisory_xact_lock(hashtextextended('pokepets:mint:' || v_user_id::text || ':' || p_template_id, 0));
    if exists (select 1 from onchain.mints where user_id = v_user_id and template_id = p_template_id and status in ('reserved', 'submitted', 'unknown')) then perform api.raise_business_error('MINT_ALREADY_ACTIVE', '该藏品已有进行中的 Mint'); end if;
    if inventory.available_quantity(v_user_id, p_template_id) < 1 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '没有可 Mint 的藏品'); end if;
    insert into onchain.mints (user_id, wallet_id, template_id, operation_id, permit_expires_at)
    values (v_user_id, v_wallet.id, p_template_id, p_operation_id, now() + interval '10 minutes') returning * into v_mint;
    perform inventory.reserve(v_user_id, p_template_id, 1, 'mint', v_mint.id);
    v_result := jsonb_build_object('mint', onchain.mint_json(v_mint), 'receiver', v_wallet.address, 'permit_payload', jsonb_build_object('mint_id', v_mint.id, 'nft_number', v_mint.nft_number, 'nonce', v_mint.nonce, 'receiver', v_wallet.address, 'template_id', p_template_id, 'valid_until', v_mint.permit_expires_at), 'valid_until', v_mint.permit_expires_at);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.mint_attach_permit(p_mint_id uuid, p_permit text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype; v_receiver text; v_result jsonb;
begin
  select * into v_mint from onchain.mints where id = p_mint_id for update;
  if v_mint.id is null or v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() then perform api.raise_business_error('MINT_NOT_SUBMITTABLE', 'Mint 预留已失效'); end if;
  select address into v_receiver from onchain.wallets where id = v_mint.wallet_id;
  update onchain.mints set permit = p_permit, updated_at = now() where id = p_mint_id returning * into v_mint;
  v_result := jsonb_build_object('mint', onchain.mint_json(v_mint), 'receiver', v_receiver, 'permit', p_permit, 'valid_until', v_mint.permit_expires_at);
  return operations.complete_command(v_mint.operation_id, v_result);
end;
$$;

create or replace function api.mint_submit(
  p_session_id uuid,
  p_operation_id uuid,
  p_mint_id uuid,
  p_transaction_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.submit', p_operation_id, jsonb_build_object('mint_id', p_mint_id, 'transaction_hash', p_transaction_hash));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_mint from onchain.mints where id = p_mint_id and user_id = v_operation.user_id for update;
    if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
    if v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() or v_mint.permit is null then perform api.raise_business_error('MINT_NOT_SUBMITTABLE', 'Mint 已不可提交'); end if;
    if exists (select 1 from onchain.mints where transaction_hash = p_transaction_hash and id <> p_mint_id) then perform api.raise_business_error('TRANSACTION_ALREADY_USED', '交易哈希已被使用'); end if;
    update onchain.mints set status = 'submitted', transaction_hash = p_transaction_hash, submitted_at = now(), updated_at = now() where id = p_mint_id returning * into v_mint;
    v_result := onchain.mint_json(v_mint);
    return operations.pending_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

create or replace function api.mint_cancel(p_session_id uuid, p_operation_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_mint onchain.mints%rowtype;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'mint.cancel', p_operation_id, jsonb_build_object('mint_id', p_mint_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_mint from onchain.mints where id = p_mint_id and user_id = v_operation.user_id for update;
    if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
    if v_mint.status <> 'reserved' then perform api.raise_business_error('MINT_NOT_CANCELLABLE', 'Mint 已提交链上，不能取消'); end if;
    update onchain.mints set status = 'cancelled', completed_at = now(), updated_at = now() where id = p_mint_id returning * into v_mint;
    update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = p_mint_id and status = 'active';
    v_result := onchain.mint_json(v_mint);
    return operations.complete_command(p_operation_id, v_result);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    return operations.fail_command(p_operation_id, case when sqlstate = 'P0001' then sqlerrm else 'INTERNAL_ERROR' end, jsonb_build_object('detail', coalesce(v_detail, '{}')));
  end;
end;
$$;

-- source: 80_risk.sql
create table risk.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references payments.orders(id),
  provider_event_id text not null unique,
  stars bigint not null check (stars > 0),
  created_at timestamptz not null default now()
);

create index refunds_payment_idx on risk.refunds (payment_id);

-- source: 90_payment_callbacks.sql
create or replace function payments.process_first_recharge(p_user_id uuid, p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral referral.relationships%rowtype;
  v_daily integer;
  v_lifetime integer;
  v_valid integer;
begin
  select * into v_referral from referral.relationships where invitee_id = p_user_id for update;
  if v_referral.invitee_id is null or v_referral.first_recharge_at is not null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('pokepets:referral-reward:' || v_referral.inviter_id::text, 0));
  update referral.relationships set first_recharge_at = now() where invitee_id = p_user_id;
  select count(*) into v_daily from referral.relationships where inviter_id = v_referral.inviter_id and (first_recharge_at at time zone 'utc')::date = identity.utc_day() and reward_fgems = 500;
  select count(*) into v_lifetime from referral.relationships where inviter_id = v_referral.inviter_id and reward_fgems = 500;
  if exists (select 1 from identity.users where id = v_referral.inviter_id and status = 'normal') and v_daily < 20 and v_lifetime < 300 then
    perform economy.change_balance(v_referral.inviter_id, 'FGEMS', 500, 'referral_first_recharge', p_operation_id, p_user_id::text);
    update referral.relationships set reward_fgems = 500, reward_operation_id = p_operation_id where invitee_id = p_user_id;
  end if;
  select count(*) into v_valid from referral.relationships where inviter_id = v_referral.inviter_id and first_recharge_at is not null;
  if v_valid >= 5 then
    insert into referral.milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 5, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_normal_box', 'referral_5', p_operation_id); end if;
  end if;
  if v_valid >= 10 then
    insert into referral.milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 10, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_rare_box', 'referral_10', p_operation_id); end if;
  end if;
end;
$$;

create or replace function payments.deliver(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_user identity.users%rowtype;
  v_subscription vip.subscriptions%rowtype;
  v_result jsonb;
begin
  select * into v_order from payments.orders where id = p_order_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
  if v_order.status = 'delivered' then return payments.order_json(v_order); end if;
  if v_order.status <> 'paid' then perform api.raise_business_error('PAYMENT_NOT_DELIVERABLE', '支付订单尚不可交付'); end if;
  select * into v_user from identity.users where id = v_order.user_id for update;
  if v_order.kind = 'vip' and v_user.status <> 'normal' then
    update payments.orders set status = 'rejected', updated_at = now() where id = p_order_id returning * into v_order;
    perform operations.fail_command(v_order.operation_id, 'PAYMENT_DELIVERY_BLOCKED', payments.order_json(v_order));
    return payments.order_json(v_order);
  end if;
  if v_order.kind = 'kcoin_topup' then
    perform economy.change_balance(v_order.user_id, 'KCOIN', v_order.kcoin_amount, 'stars_topup', v_order.operation_id, v_order.id::text);
  else
    select * into v_subscription from vip.subscriptions where user_id = v_order.user_id for update;
    if v_subscription.user_id is null or v_subscription.ends_on < identity.utc_day() then
      insert into vip.subscriptions (user_id, starts_on, ends_on, renewal_count)
      values (v_order.user_id, identity.utc_day(), identity.utc_day() + 29, 0)
      on conflict (user_id) do update set period_id = extensions.gen_random_uuid(), starts_on = excluded.starts_on, ends_on = excluded.ends_on, renewal_count = 0, updated_at = now();
    elsif v_subscription.renewal_count < 2 then
      update vip.subscriptions set ends_on = ends_on + 30, renewal_count = renewal_count + 1, updated_at = now() where user_id = v_order.user_id;
    else
      update payments.orders set status = 'rejected', updated_at = now() where id = p_order_id returning * into v_order;
      perform operations.fail_command(v_order.operation_id, 'VIP_RENEWAL_LIMIT', payments.order_json(v_order));
      return payments.order_json(v_order);
    end if;
  end if;
  update payments.orders set status = 'delivered', delivered_at = now(), updated_at = now() where id = p_order_id returning * into v_order;
  perform payments.process_first_recharge(v_order.user_id, v_order.operation_id);
  v_result := payments.order_json(v_order);
  perform operations.complete_command(v_order.operation_id, v_result);
  return v_result;
end;
$$;

create or replace function api.payment_invoice_details(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', id, 'invoice_payload', invoice_payload, 'stars_amount', stars_amount, 'kind', kind)
  from payments.orders where id = p_order_id and status = 'pending'
$$;

create or replace function api.payment_begin_checkout(p_pre_checkout_query_id text, p_invoice_payload text, p_stars bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_user identity.users%rowtype;
begin
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null or v_order.stars_amount <> p_stars then
    return jsonb_build_object('valid', false, 'payment_id', null);
  end if;
  if v_order.status = 'processing' and v_order.pre_checkout_query_id = p_pre_checkout_query_id then
    return jsonb_build_object('valid', true, 'payment_id', v_order.id);
  end if;
  select * into v_user from identity.users where id = v_order.user_id for update;
  if v_order.status <> 'pending' or v_order.pre_checkout_query_id is not null or v_order.expires_at <= now() or v_user.status <> 'normal' then
    return jsonb_build_object('valid', false, 'payment_id', v_order.id);
  end if;
  update payments.orders
  set status = 'processing', pre_checkout_query_id = p_pre_checkout_query_id,
      checkout_started_at = now(), updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('valid', true, 'payment_id', v_order.id);
end;
$$;

create or replace function api.payment_apply_success(
  p_update_id text,
  p_invoice_payload text,
  p_telegram_charge_id text,
  p_provider_charge_id text,
  p_stars bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype;
begin
  insert into operations.webhook_events (provider, event_id, payload) values ('telegram_update', p_update_id, p_payload) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null or v_order.stars_amount <> p_stars then perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单不匹配'); end if;
  if v_order.telegram_payment_charge_id = p_telegram_charge_id then
    update operations.webhook_events set processed_at = now() where provider = 'telegram_update' and event_id = p_update_id;
    return jsonb_build_object('duplicate', true, 'order', case when v_order.status = 'paid' then payments.deliver(v_order.id) else payments.order_json(v_order) end);
  end if;
  if v_order.telegram_payment_charge_id is not null then perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单已绑定其他付款凭据'); end if;
  update payments.orders
  set status = 'paid', telegram_payment_charge_id = p_telegram_charge_id,
      provider_payment_charge_id = p_provider_charge_id, paid_at = now(), updated_at = now()
  where id = v_order.id;
  update operations.webhook_events set processed_at = now() where provider = 'telegram_update' and event_id = p_update_id;
  return jsonb_build_object('duplicate', false, 'order', payments.deliver(v_order.id));
end;
$$;

create or replace function api.payment_apply_refund(
  p_update_id text,
  p_telegram_charge_id text,
  p_stars bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_order payments.orders%rowtype; v_total bigint;
begin
  insert into operations.webhook_events (provider, event_id, payload) values ('telegram_refund', p_update_id, p_payload) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  select * into v_order from payments.orders where telegram_payment_charge_id = p_telegram_charge_id for update;
  if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '退款订单不存在'); end if;
  insert into risk.refunds (payment_id, provider_event_id, stars) values (v_order.id, p_update_id, p_stars) on conflict do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  update payments.orders set refunded_stars = least(stars_amount, refunded_stars + p_stars), status = 'refunded', updated_at = now() where id = v_order.id;
  update identity.users set total_refund_stars = total_refund_stars + p_stars, updated_at = now() where id = v_order.user_id returning total_refund_stars into v_total;
  if v_total > 100 then
    update identity.users set status = 'banned', updated_at = now() where id = v_order.user_id;
    update identity.sessions set revoked_at = now() where user_id = v_order.user_id and revoked_at is null;
  end if;
  update operations.webhook_events set processed_at = now() where provider = 'telegram_refund' and event_id = p_update_id;
  return jsonb_build_object('duplicate', false, 'payment_id', v_order.id, 'total_refund_stars', v_total, 'account_status', case when v_total > 100 then 'banned' else 'normal' end);
end;
$$;

-- source: 91_mint_reconciliation.sql
create or replace function api.mint_reconciliation_candidates(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate.submitted_at), '[]'::jsonb)
  from (
    select m.id mint_id, m.nft_number, m.template_id, m.transaction_hash, m.submitted_at,
           w.address receiver, t.name, t.rarity, t.stage, t.combat_power, t.image_detail_path
    from onchain.mints m
    join onchain.wallets w on w.id = m.wallet_id
    join catalog.templates t on t.id = m.template_id
    where m.status in ('submitted', 'unknown')
    order by m.submitted_at
    limit greatest(1, least(p_limit, 500))
  ) candidate
$$;

create or replace function api.mint_complete(
  p_mint_id uuid,
  p_success boolean,
  p_nft_address text default null,
  p_metadata_uri text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype; v_checksum text; v_result jsonb;
begin
  select * into v_mint from onchain.mints where id = p_mint_id for update;
  if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
  if v_mint.status in ('succeeded', 'failed', 'cancelled') then return onchain.mint_json(v_mint); end if;
  if p_success then
    if p_nft_address is null or p_metadata_uri is null or p_metadata is null then perform api.raise_business_error('MINT_RESULT_INCOMPLETE', 'Mint 成功资料不完整'); end if;
    update inventory.reservations set status = 'consumed', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    perform inventory.change_holding(v_mint.user_id, v_mint.template_id, -1);
    update onchain.mints set status = 'succeeded', nft_address = p_nft_address, metadata_uri = p_metadata_uri, completed_at = now(), updated_at = now() where id = v_mint.id returning * into v_mint;
    v_checksum := encode(extensions.digest(convert_to(p_metadata::text, 'UTF8'), 'sha256'), 'hex');
    insert into onchain.nft_metadata (nft_number, mint_id, snapshot, checksum) values (v_mint.nft_number, v_mint.id, p_metadata, v_checksum) on conflict (nft_number) do nothing;
    perform tasks.progress(v_mint.user_id, 'mint_success');
  else
    update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    update onchain.mints set status = 'failed', completed_at = now(), updated_at = now() where id = v_mint.id returning * into v_mint;
  end if;
  v_result := onchain.mint_json(v_mint);
  update operations.operations set status = case when p_success then 'succeeded' else 'failed' end,
    result = v_result, error_code = case when p_success then null else 'MINT_FAILED' end,
    completed_at = now(), updated_at = now()
  where use_case = 'mint.submit' and result->>'id' = v_mint.id::text and status in ('pending', 'unknown');
  return v_result;
end;
$$;

create or replace function api.mint_mark_unknown(p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype;
begin
  update onchain.mints set status = 'unknown', updated_at = now()
  where id = p_mint_id and status = 'submitted' returning * into v_mint;
  if v_mint.id is null then select * into v_mint from onchain.mints where id = p_mint_id; end if;
  if v_mint.id is null then perform api.raise_business_error('MINT_NOT_FOUND', 'Mint 记录不存在'); end if;
  update operations.operations set status = 'unknown', updated_at = now()
  where use_case = 'mint.submit' and result->>'id' = p_mint_id::text and status = 'pending';
  return onchain.mint_json(v_mint);
end;
$$;

-- source: 95_jobs.sql
create or replace function api.run_job(p_job_name text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_count integer := 0;
  v_added integer := 0;
  v_row record;
  v_scan_from timestamptz;
  v_scan_to timestamptz := now();
  v_active_run operations.job_runs%rowtype;
begin
  if p_job_name not in ('reconcile-payments', 'reconcile-mints', 'cleanup-idempotency', 'monitor-invariants') then perform api.raise_business_error('JOB_NOT_FOUND', '后台任务不存在'); end if;
  select max(finished_at) into v_scan_from from operations.job_runs where job_name = p_job_name and status = 'succeeded';
  if not pg_try_advisory_xact_lock(hashtextextended('pokepets:job:' || p_job_name, 0)) then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (p_job_name, 'skipped', jsonb_build_object('reason', 'already_running'), v_scan_from, v_scan_to, now())
    returning id into v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'skipped', 'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  if p_job_name = 'reconcile-mints' then
    select * into v_active_run from operations.job_runs
    where job_name = p_job_name and status = 'running'
    order by started_at desc limit 1 for update;
    if v_active_run.id is not null and v_active_run.started_at > now() - interval '10 minutes' then
      insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
      values (p_job_name, 'skipped', jsonb_build_object('reason', 'active_lease', 'active_job_run_id', v_active_run.id), v_scan_from, v_scan_to, now())
      returning id into v_run;
      return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'skipped', 'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
    elsif v_active_run.id is not null then
      update operations.job_runs
      set status = 'failed', details = jsonb_build_object('error', 'lease_expired'), finished_at = now()
      where id = v_active_run.id;
    end if;
  end if;
  insert into operations.job_runs (job_name, status, scan_from, scan_to) values (p_job_name, 'running', v_scan_from, v_scan_to) returning id into v_run;
  begin
  if p_job_name = 'reconcile-payments' then
    for v_row in
      update payments.orders
      set status = case when status = 'pending' then 'expired' else 'failed' end,
          failed_at = case when status = 'processing' then now() else failed_at end,
          updated_at = now()
      where id in (
        select id from payments.orders
        where status in ('pending', 'processing') and expires_at <= now()
        order by expires_at limit greatest(1, least(p_limit, 500))
        for update skip locked
      )
      returning operation_id, id, status
    loop
      update operations.operations
      set status = 'failed', error_code = 'PAYMENT_EXPIRED',
          result = jsonb_build_object('payment_id', v_row.id, 'status', v_row.status),
          completed_at = now(), updated_at = now()
      where id = v_row.operation_id and status in ('pending', 'unknown');
      update operations.operations
      set result = (select payments.order_json(p) from payments.orders p where p.id = v_row.id), updated_at = now()
      where id = v_row.operation_id and status = 'succeeded';
      v_count := v_count + 1;
    end loop;
    for v_row in select id from payments.orders where status = 'paid' order by paid_at limit greatest(1, least(p_limit, 500)) for update skip locked loop
      perform payments.deliver(v_row.id);
      v_count := v_count + 1;
    end loop;
  elsif p_job_name = 'reconcile-mints' then
    for v_row in select id from onchain.mints where status = 'reserved' and permit_expires_at <= now() order by permit_expires_at limit greatest(1, least(p_limit, 500)) for update skip locked loop
      perform api.mint_complete(v_row.id, false);
      v_count := v_count + 1;
    end loop;
  elsif p_job_name = 'cleanup-idempotency' then
    delete from operations.operations where id in (
      select id from operations.operations where created_at < now() - interval '30 days' and status in ('succeeded', 'failed')
        and not (use_case in ('gacha.open', 'wheel.spin', 'inventory.evolve') and result_acknowledged_at is null)
        and not exists (select 1 from payments.orders p where p.operation_id = operations.operations.id and p.status in ('pending', 'processing', 'paid'))
        and not exists (select 1 from onchain.mints m where m.operation_id = operations.operations.id and m.status in ('reserved', 'submitted', 'unknown'))
      order by created_at limit greatest(1, least(p_limit, 500))
    );
    get diagnostics v_count = row_count;
    delete from identity.auth_attempts where attempted_at < now() - interval '1 day';
  else
    insert into operations.invariant_violations (code, subject, details)
    select 'BALANCE_LEDGER_MISMATCH', b.user_id::text || ':' || b.currency, jsonb_build_object('balance', b.available, 'ledger', coalesce(sum(l.amount), 0))
    from economy.balances b left join economy.ledger l on l.user_id = b.user_id and l.currency = b.currency
    group by b.user_id, b.currency, b.available having b.available <> coalesce(sum(l.amount), 0)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    insert into operations.invariant_violations (code, subject, details)
    select 'DUPLICATE_PAYMENT_DELIVERY', l.reference, jsonb_build_object('ledger_entries', count(*))
    from economy.ledger l where l.reason = 'stars_topup' group by l.reference having count(*) > 1 on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'RESERVATION_OVERFLOW', h.user_id::text || ':' || h.template_id, jsonb_build_object('holding', h.quantity, 'reserved', sum(r.quantity))
    from inventory.holdings h join inventory.reservations r on r.user_id = h.user_id and r.template_id = h.template_id and r.status = 'active'
    group by h.user_id, h.template_id, h.quantity having sum(r.quantity) > h.quantity on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'ILLEGAL_RESERVATION', r.id::text, jsonb_build_object('kind', r.kind, 'reference_id', r.reference_id)
    from inventory.reservations r where r.status = 'active' and (
      (r.kind = 'listing' and not exists (select 1 from market.listings l where l.id = r.reference_id and l.status = 'active' and l.remaining > 0))
      or (r.kind = 'expedition' and not exists (select 1 from expedition.expeditions e where e.id = r.reference_id and e.status in ('running', 'claimable')))
      or (r.kind = 'mint' and not exists (select 1 from onchain.mints m where m.id = r.reference_id and m.status in ('reserved', 'submitted', 'unknown')))
    ) on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'OPEN_OPERATION_WITHOUT_SUBJECT', o.id::text, jsonb_build_object('use_case', o.use_case, 'status', o.status)
    from operations.operations o where o.status in ('pending', 'unknown') and o.created_at < now() - interval '1 day'
      and not exists (select 1 from payments.orders p where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
  end if;
  if p_job_name = 'reconcile-mints' then
    update operations.job_runs set processed_count = v_count, details = jsonb_build_object('phase', 'chain_reconciliation') where id = v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'running', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  update operations.job_runs set status = 'succeeded', processed_count = v_count, finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'succeeded', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
exception when others then
  update operations.job_runs set status = 'failed', details = jsonb_build_object('error', sqlerrm), finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'failed', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to, 'error', sqlerrm);
  end;
end;
$$;

create or replace function api.finish_job(
  p_job_run_id uuid,
  p_processed_count integer,
  p_details jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run operations.job_runs%rowtype;
begin
  select * into v_run from operations.job_runs where id = p_job_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    perform api.raise_business_error('JOB_NOT_FOUND', '后台任务运行不存在或已经结束');
  end if;
  update operations.job_runs
  set status = case when p_error is null then 'succeeded' else 'failed' end,
      processed_count = greatest(0, p_processed_count),
      details = coalesce(p_details, '{}'::jsonb) || case when p_error is null then '{}'::jsonb else jsonb_build_object('error', p_error) end,
      finished_at = now()
  where id = p_job_run_id
  returning * into v_run;
  return jsonb_build_object(
    'job_run_id', v_run.id,
    'job_name', v_run.job_name,
    'status', v_run.status,
    'processed_count', v_run.processed_count,
    'scan_from', v_run.scan_from,
    'scan_to', v_run.scan_to
  );
end;
$$;
