-- Generated from supabase/schemas. Edit declarative schemas, then run supabase db diff for future changes.

-- source: 00_foundation.sql
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

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
create schema if not exists battle;
create schema if not exists admin;
create schema if not exists api;

-- source: 10_identity.sql
create table identity.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  language_code text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'zh-CN')),
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
  entry_kind text not null check (entry_kind in ('direct', 'referral', 'battle')),
  referral_code text,
  battle_invite_token_hash text,
  referral_processed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (referral_code is null or referral_code ~ '^TMA[A-F0-9]{20}$'),
  check (battle_invite_token_hash is null or battle_invite_token_hash ~ '^[0-9a-f]{64}$'),
  check (
    (entry_kind = 'direct' and referral_code is null and battle_invite_token_hash is null)
    or (entry_kind = 'referral' and referral_code is not null and battle_invite_token_hash is null)
    or (entry_kind = 'battle' and referral_code is null and battle_invite_token_hash is not null)
  )
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

create table identity.auth_maintenance (
  task text primary key check (task = 'auth_attempts_cleanup'),
  last_run_at timestamptz not null
);

insert into identity.auth_maintenance (task, last_run_at)
values ('auth_attempts_cleanup', '-infinity'::timestamptz);

create table identity.login_requests (
  operation_id uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references identity.users(id) on delete cascade,
  account_status text not null check (account_status in ('normal', 'banned')),
  session_id uuid references identity.sessions(id),
  expires_at timestamptz,
  entry_kind text not null check (entry_kind in ('direct', 'referral', 'battle')),
  referral_code text,
  battle_invite_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referral_code is null or referral_code ~ '^TMA[A-F0-9]{20}$'),
  check (battle_invite_token_hash is null or battle_invite_token_hash ~ '^[0-9a-f]{64}$'),
  check (
    (entry_kind = 'direct' and referral_code is null and battle_invite_token_hash is null)
    or (entry_kind = 'referral' and referral_code is not null and battle_invite_token_hash is null)
    or (entry_kind = 'battle' and referral_code is null and battle_invite_token_hash is not null)
  ),
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
    'entry_handoff_code', case
      when s.referral_processed_at is null then coalesce(c.code, s.referral_code)
      when s.entry_kind = 'referral' then coalesce(c.code, s.referral_code)
      else null
    end,
    'entry_handoff_result', case
      when s.referral_processed_at is null then null
      when s.entry_kind <> 'referral' then null
      when c.status in ('bound', 'rejected') then c.result_code
      when not s.new_user and s.referral_code is not null then 'REFERRAL_OLD_USER'
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
  if v_session.referral_processed_at is null
    and not coalesce(p_allow_pending_entry_handoff, false)
  then
    perform api.raise_business_error('ENTRY_HANDOFF_PENDING', '邀请绑定结果确认中，请稍后刷新');
  end if;
  return v_session.user_id;
end;
$$;

create or replace function api.identity_consume_login_source_rate_limit(p_key_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_should_cleanup boolean;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    perform api.raise_business_error('REQUEST_INVALID', '登录限流参数无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identity.rate.source:' || p_key_hash, 0));
  select count(*) into v_count
  from identity.auth_attempts
  where scope = 'source' and key_hash = p_key_hash and attempted_at >= now() - interval '1 minute';
  if v_count >= 30 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;
  insert into identity.auth_attempts (scope, key_hash) values ('source', p_key_hash);

  if pg_try_advisory_xact_lock(hashtextextended('identity.maintenance:auth_attempts_cleanup', 0)) then
    update identity.auth_maintenance
    set last_run_at = now()
    where task = 'auth_attempts_cleanup'
      and last_run_at <= now() - interval '1 minute'
    returning true into v_should_cleanup;
    if coalesce(v_should_cleanup, false) then
      delete from identity.auth_attempts
      where attempted_at < now() - interval '5 minutes';
    end if;
  end if;
end;
$$;

create or replace function identity.consume_login_rate_limit(p_scope text, p_key_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_limit integer;
begin
  v_limit := case p_scope
    when 'user' then 10
    when 'init_data' then 3
    else null
  end;
  if v_limit is null or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    perform api.raise_business_error('REQUEST_INVALID', '登录限流参数无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('identity.rate.' || p_scope || ':' || p_key_hash, 0));
  select count(*) into v_count
  from identity.auth_attempts
  where scope = p_scope
    and key_hash = p_key_hash
    and attempted_at >= now() - interval '1 minute';
  if v_count >= v_limit then
    return false;
  end if;
  insert into identity.auth_attempts (scope, key_hash) values (p_scope, p_key_hash);
  return true;
end;
$$;

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
  p_battle_invite_token_hash text
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
    or (p_entry_kind = 'direct' and (p_entry_referral_code is not null or p_battle_invite_token_hash is not null))
    or (p_entry_kind = 'referral' and (p_entry_referral_code is null or p_entry_referral_code !~ '^TMA[A-F0-9]{20}$' or p_battle_invite_token_hash is not null))
    or (p_entry_kind = 'battle' and (p_entry_referral_code is not null or p_battle_invite_token_hash is null or p_battle_invite_token_hash !~ '^[0-9a-f]{64}$'))
    or (p_entry_kind = 'invalid' and (p_entry_referral_code is not null or p_battle_invite_token_hash is not null))
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
    return jsonb_build_object(
      'session_id', v_login.session_id,
      'user_id', v_login.user_id,
      'account_status', 'normal',
      'preferred_language', v_user.preferred_language,
      'entry_kind', v_login.entry_kind,
      'expires_at', v_login.expires_at
    ) || identity.session_entry_handoff(v_login.session_id);
  end if;

  perform pg_advisory_xact_lock(p_telegram_id);
  insert into identity.users (telegram_id, username, first_name, last_name, language_code, referral_code)
  values (p_telegram_id, p_username, p_first_name, p_last_name, p_language_code, p_referral_code)
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

  update identity.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;
  if v_user.status = 'banned' then
    insert into identity.login_requests (
      operation_id, request_hash, user_id, account_status, session_id, expires_at,
      entry_kind, referral_code, battle_invite_token_hash
    ) values (
      p_operation_id, p_request_hash, v_user.id, 'banned', null, null,
      p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash
    );
    return jsonb_build_object('account_status', 'banned');
  end if;

  v_expires_at := now() + interval '15 minutes';
  insert into identity.sessions (
    id, user_id, token_hash, auth_date, expires_at, new_user, entry_kind,
    referral_code, battle_invite_token_hash, referral_processed_at
  ) values (
    p_session_id, v_user.id, p_token_hash, p_auth_date, v_expires_at, v_new_user, p_entry_kind,
    p_entry_referral_code, p_battle_invite_token_hash, v_referral_processed_at
  )
  returning id into v_session_id;
  insert into identity.login_requests (
    operation_id, request_hash, user_id, account_status, session_id, expires_at,
    entry_kind, referral_code, battle_invite_token_hash
  ) values (
    p_operation_id, p_request_hash, v_user.id, 'normal', v_session_id, v_expires_at,
    p_entry_kind, p_entry_referral_code, p_battle_invite_token_hash
  );

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'preferred_language', v_user.preferred_language,
    'entry_kind', p_entry_kind,
    'expires_at', v_expires_at
  ) || identity.session_entry_handoff(v_session_id);
end;
$$;

create or replace function api.identity_set_preferred_language(
  p_session_id uuid,
  p_preferred_language text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_preferred_language text;
begin
  if p_preferred_language not in ('en', 'zh-CN') then
    perform api.raise_business_error('REQUEST_INVALID', 'Unsupported language');
  end if;
  update identity.users
  set preferred_language = p_preferred_language,
      updated_at = case
        when preferred_language is distinct from p_preferred_language then now()
        else updated_at
      end
  where id = v_user_id
    and status = 'normal'
  returning preferred_language into v_preferred_language;
  if v_preferred_language is null then
    perform api.raise_business_error('ACCOUNT_RESTRICTED', 'Account unavailable');
  end if;
  return jsonb_build_object('preferred_language', v_preferred_language);
end;
$$;

create or replace function api.identity_summary(p_session_id uuid)
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
      'status', u.status,
      'preferred_language', u.preferred_language,
      'referral_code', u.referral_code
    ),
    'assets', economy.assets(v_user_id)
  ) into v_result
  from identity.users u where u.id = v_user_id;
  return v_result;
end;
$$;

create or replace function api.identity_initial(p_session_id uuid)
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
    'summary', jsonb_build_object(
      'user', jsonb_build_object(
        'id', u.id,
        'telegram_id', u.telegram_id::text,
        'username', u.username,
        'first_name', u.first_name,
        'last_name', u.last_name,
        'status', u.status,
        'preferred_language', u.preferred_language,
        'referral_code', u.referral_code
      ),
      'assets', economy.assets(v_user_id)
    ),
    'recovery', jsonb_build_object(
      'authority_cursor', coalesce((
        select sequence.last_sequence::text
        from operations.user_authority_sequences sequence
        where sequence.user_id = v_user_id
      ), '0'),
      'blocking_operations', coalesce((
        select jsonb_agg(operations.operation_json(o) order by o.created_at, o.id)
        from operations.operations o
        join (
          select candidate.id
          from operations.operations candidate
          where candidate.user_id = v_user_id
            and candidate.use_case <> 'gacha.open'
            and candidate.status in ('pending', 'unknown')
          union all
          select terminal.id
          from (
            select candidate.id
            from operations.operations candidate
            where candidate.user_id = v_user_id
              and candidate.use_case = 'inventory.evolve'
              and candidate.status in ('succeeded', 'failed')
              and candidate.result_acknowledged_at is null
            order by candidate.created_at, candidate.id
            limit 1
          ) terminal
        ) recoverable on recoverable.id = o.id
      ), '[]'::jsonb),
      'payment_recovery_orders', coalesce((
        select jsonb_agg(payments.order_json(p) order by p.created_at desc)
        from payments.orders p
        where p.user_id = v_user_id and (
          p.status in ('processing', 'paid', 'payment_identity_conflict')
          or (p.kind = 'vip' and p.status = 'pending')
        )
      ), '[]'::jsonb),
      'pending_mints', coalesce((
        select jsonb_agg(onchain.mint_json(m) order by m.created_at desc)
        from onchain.mints m
        where m.user_id = v_user_id and m.status in ('reserved', 'submitted', 'unknown')
      ), '[]'::jsonb),
      'battle_participation', battle.participation_json(v_user_id)
    )
  ) into v_result
  from identity.users u
  where u.id = v_user_id;
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

create table catalog.asset_delivery_config (
  singleton boolean primary key default true check (singleton),
  public_origin text not null check (public_origin ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public$'),
  public_bucket text not null check (public_bucket = 'pet-runtime'),
  updated_at timestamptz not null default now()
);

create table catalog.asset_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  object_class text not null check (object_class in ('master', 'runtime')),
  bucket text not null check (
    (object_class = 'master' and bucket = 'art-masters')
    or (object_class = 'runtime' and bucket = 'pet-runtime')
  ),
  object_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 2097152),
  width integer not null check (width in (256, 768)),
  height integer not null check (height = width),
  mime_type text not null check (mime_type = 'image/webp'),
  status text not null default 'active' check (status in ('active', 'deleting', 'deleted', 'delete_failed')),
  cleanup_claim_id uuid,
  cleanup_claimed_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, object_key),
  check (
    (object_class = 'master' and object_key ~ '^catalog/pet-[nat]-[0-9]{3}-[123]/[0-9a-f]{64}\.webp$' and width = 768)
    or (object_class = 'runtime' and object_key ~ '^catalog/v[12]/(thumb|detail)/pet-[nat]-[0-9]{3}-[123]\.[0-9a-f]{64}\.webp$')
  ),
  check (
    (status = 'deleting' and cleanup_claim_id is not null and cleanup_claimed_at is not null and deleted_at is null)
    or (status = 'deleted' and cleanup_claim_id is null and cleanup_claimed_at is null and deleted_at is not null)
    or (status in ('active', 'delete_failed') and cleanup_claim_id is null and cleanup_claimed_at is null and deleted_at is null)
  )
);

create index asset_objects_cleanup_idx on catalog.asset_objects (status, cleanup_claimed_at, id)
where object_class = 'runtime' and status in ('active', 'deleting', 'delete_failed');

create table catalog.asset_releases (
  id uuid primary key default extensions.gen_random_uuid(),
  release_key text not null unique check (release_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  git_commit text not null check (git_commit ~ '^[0-9a-f]{40}$'),
  status text not null check (status in ('staging', 'active', 'retired')),
  published_at timestamptz not null default now(),
  retired_at timestamptz,
  delete_after timestamptz,
  rollback_locked_until timestamptz,
  created_at timestamptz not null default now(),
  check (
    (status in ('staging', 'active') and retired_at is null and delete_after is null)
    or (status = 'retired' and retired_at is not null and delete_after = retired_at + interval '90 days')
  )
);

create unique index asset_releases_one_active_idx on catalog.asset_releases (status)
where status = 'active';
create index asset_releases_cleanup_idx on catalog.asset_releases (delete_after, rollback_locked_until)
where status = 'retired';

create table catalog.asset_release_templates (
  release_id uuid not null references catalog.asset_releases(id) on delete restrict,
  template_id text not null references catalog.templates(id) on delete restrict,
  master_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  thumbnail_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  detail_object_id uuid not null references catalog.asset_objects(id) on delete restrict,
  primary key (release_id, template_id),
  unique (release_id, master_object_id),
  unique (release_id, thumbnail_object_id),
  unique (release_id, detail_object_id)
);

create index asset_release_templates_master_idx on catalog.asset_release_templates (master_object_id);
create index asset_release_templates_thumbnail_idx on catalog.asset_release_templates (thumbnail_object_id);
create index asset_release_templates_detail_idx on catalog.asset_release_templates (detail_object_id);

create table catalog.current_asset_release (
  singleton boolean primary key default true check (singleton),
  release_id uuid not null unique references catalog.asset_releases(id) on delete restrict,
  revision bigint not null check (revision > 0),
  switched_at timestamptz not null default now()
);

create table catalog.asset_rollback_commands (
  idempotency_key uuid primary key,
  release_id uuid not null references catalog.asset_releases(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table catalog.asset_mutation_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  fence bigint generated always as identity unique,
  kind text not null check (kind in ('publish', 'rollback', 'cleanup')),
  release_key text check (release_key is null or release_key ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'committed', 'aborted', 'expired')),
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  finished_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  check (
    (kind = 'cleanup' and release_key is null and manifest_sha256 is null)
    or (kind in ('publish', 'rollback') and release_key is not null and manifest_sha256 is not null)
  ),
  check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  )
);

create unique index asset_mutation_runs_one_running_idx
on catalog.asset_mutation_runs (status)
where status = 'running';

create index asset_mutation_runs_acquired_idx
on catalog.asset_mutation_runs (acquired_at desc);

create or replace function catalog.acquire_asset_mutation(
  p_kind text,
  p_release_key text,
  p_manifest_sha256 text
)
returns catalog.asset_mutation_runs
language plpgsql
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  if p_kind not in ('publish', 'rollback', 'cleanup')
    or (p_kind = 'cleanup' and (p_release_key is not null or p_manifest_sha256 is not null))
    or (p_kind in ('publish', 'rollback') and (
      p_release_key is null
      or p_manifest_sha256 is null
      or p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
      or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    ))
  then
    raise exception using errcode = '22023', message = 'asset mutation metadata is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('evomypet:catalog-asset-mutation', 0));
  update catalog.asset_mutation_runs
  set status = 'expired', finished_at = now(),
      details = details || jsonb_build_object('reason', 'lease_expired')
  where status = 'running' and expires_at <= now();
  if exists (select 1 from catalog.asset_mutation_runs where status = 'running') then
    return null;
  end if;
  insert into catalog.asset_mutation_runs (kind, release_key, manifest_sha256)
  values (p_kind, p_release_key, p_manifest_sha256)
  returning * into v_run;
  return v_run;
end
$$;

create or replace function catalog.require_asset_mutation(
  p_run_id uuid,
  p_fence bigint,
  p_kind text,
  p_release_key text,
  p_manifest_sha256 text
)
returns catalog.asset_mutation_runs
language plpgsql
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  select * into v_run
  from catalog.asset_mutation_runs
  where id = p_run_id
  for update;
  if v_run.id is null
    or v_run.fence <> p_fence
    or v_run.kind <> p_kind
    or v_run.release_key is distinct from p_release_key
    or v_run.manifest_sha256 is distinct from p_manifest_sha256
    or v_run.status <> 'running'
    or v_run.expires_at <= now()
  then
    raise exception using errcode = '55000', message = 'asset mutation lease is missing, expired, or fenced';
  end if;
  return v_run;
end
$$;

create or replace function api.catalog_asset_mutation_acquire(
  p_kind text,
  p_release_key text default null,
  p_manifest_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
  v_active catalog.asset_mutation_runs%rowtype;
begin
  v_run := catalog.acquire_asset_mutation(p_kind, p_release_key, p_manifest_sha256);
  if v_run.id is null then
    select * into v_active
    from catalog.asset_mutation_runs
    where status = 'running';
    return jsonb_build_object(
      'status', 'busy',
      'active_kind', v_active.kind,
      'retry_after', v_active.expires_at
    );
  end if;
  return jsonb_build_object(
    'status', 'running',
    'run_id', v_run.id,
    'fence', v_run.fence,
    'expires_at', v_run.expires_at
  );
end
$$;

create or replace function api.catalog_asset_mutation_renew(
  p_run_id uuid,
  p_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  update catalog.asset_mutation_runs
  set heartbeat_at = now(), expires_at = now() + interval '5 minutes'
  where id = p_run_id and fence = p_fence and status = 'running' and expires_at > now()
  returning * into v_run;
  if v_run.id is null then
    raise exception using errcode = '55000', message = 'asset mutation lease cannot be renewed';
  end if;
  return jsonb_build_object('status', 'running', 'run_id', v_run.id, 'fence', v_run.fence, 'expires_at', v_run.expires_at);
end
$$;

create or replace function api.catalog_asset_mutation_abort(
  p_run_id uuid,
  p_fence bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run catalog.asset_mutation_runs%rowtype;
begin
  update catalog.asset_mutation_runs
  set status = 'aborted', finished_at = now(),
      details = details || jsonb_build_object('reason', left(coalesce(p_reason, 'operator_aborted'), 500))
  where id = p_run_id and fence = p_fence and status = 'running'
  returning * into v_run;
  return jsonb_build_object(
    'status', coalesce(v_run.status, 'unchanged'),
    'run_id', p_run_id,
    'fence', p_fence
  );
end
$$;

create or replace function catalog.rarity_rank(p_rarity text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_rarity when 'common' then 1 when 'rare' then 2 when 'epic' then 3 when 'legendary' then 4 when 'mythic' then 5 else 0 end::smallint
$$;

create or replace function catalog.asset_public_url(p_object_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select config.public_origin || '/' || config.public_bucket || '/' || object.object_key
  from catalog.asset_objects object
  cross join catalog.asset_delivery_config config
  where config.singleton
    and object.id = p_object_id
    and object.object_class = 'runtime'
    and object.bucket = config.public_bucket
    and object.status = 'active'
$$;

create or replace function catalog.template_thumbnail_url(p_template_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select catalog.asset_public_url(item.thumbnail_object_id)
  from catalog.current_asset_release current_release
  join catalog.asset_release_templates item on item.release_id = current_release.release_id
  where current_release.singleton and item.template_id = p_template_id
$$;

create or replace function catalog.template_detail_url(p_template_id text)
returns text
language sql
stable
set search_path = ''
as $$
  select catalog.asset_public_url(item.detail_object_id)
  from catalog.current_asset_release current_release
  join catalog.asset_release_templates item on item.release_id = current_release.release_id
  where current_release.singleton and item.template_id = p_template_id
$$;

create or replace function catalog.asset_release_ready()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((
    select
      release.status = 'active'
      and (
        select count(*) = 210
        from catalog.asset_release_templates mapped
        where mapped.release_id = release.id
      )
      and not exists (
        select 1
        from catalog.templates template
        left join catalog.asset_release_templates mapped
          on mapped.release_id = release.id
          and mapped.template_id = template.id
        where template.catalog_version = 'v1'
          and mapped.template_id is null
      )
      and not exists (
        select 1
        from catalog.asset_release_templates mapped
        join catalog.asset_objects master on master.id = mapped.master_object_id
        join catalog.asset_objects thumbnail on thumbnail.id = mapped.thumbnail_object_id
        join catalog.asset_objects detail on detail.id = mapped.detail_object_id
        where mapped.release_id = release.id
          and (
            master.object_class <> 'master'
            or master.bucket <> 'art-masters'
            or master.status <> 'active'
            or master.width <> 768
            or thumbnail.object_class <> 'runtime'
            or thumbnail.bucket <> config.public_bucket
            or thumbnail.status <> 'active'
            or thumbnail.width <> 256
            or detail.object_class <> 'runtime'
            or detail.bucket <> config.public_bucket
            or detail.status <> 'active'
            or detail.width <> 768
          )
      )
    from catalog.current_asset_release current_release
    join catalog.asset_releases release on release.id = current_release.release_id
    cross join catalog.asset_delivery_config config
    where current_release.singleton and config.singleton
  ), false)
$$;

create or replace function catalog.register_asset_object(
  p_object_class text,
  p_bucket text,
  p_object jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_existing catalog.asset_objects%rowtype;
begin
  select * into v_existing
  from catalog.asset_objects
  where bucket = p_bucket and object_key = p_object->>'key'
  for update;
  if v_existing.id is not null then
    if v_existing.object_class is distinct from p_object_class
      or v_existing.sha256 is distinct from p_object->>'sha256'
      or v_existing.byte_size is distinct from (p_object->>'bytes')::integer
      or v_existing.width is distinct from (p_object->>'width')::integer
      or v_existing.height is distinct from (p_object->>'height')::integer
      or v_existing.mime_type is distinct from p_object->>'mime_type'
    then
      raise exception using errcode = '22023', message = 'immutable asset object metadata mismatch';
    end if;
    if v_existing.status <> 'active' then
      raise exception using errcode = '55000', message = 'asset object is not publishable while deletion is pending or complete';
    end if;
    return v_existing.id;
  end if;
  insert into catalog.asset_objects (
    object_class, bucket, object_key, sha256, byte_size, width, height, mime_type
  ) values (
    p_object_class, p_bucket, p_object->>'key', p_object->>'sha256',
    (p_object->>'bytes')::integer, (p_object->>'width')::integer,
    (p_object->>'height')::integer, p_object->>'mime_type'
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function api.catalog_asset_publish(
  p_release_key text,
  p_manifest_sha256 text,
  p_git_commit text,
  p_public_origin text,
  p_assets jsonb,
  p_mutation_run_id uuid,
  p_mutation_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release catalog.asset_releases%rowtype;
  v_current catalog.current_asset_release%rowtype;
  v_asset jsonb;
  v_master uuid;
  v_thumbnail uuid;
  v_detail uuid;
  v_revision bigint;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_result jsonb;
begin
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'publish', p_release_key, p_manifest_sha256
  );
  if p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_git_commit !~ '^[0-9a-f]{40}$'
    or p_public_origin !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public$'
    or jsonb_typeof(p_assets) <> 'array'
    or jsonb_array_length(p_assets) <> 210
  then
    raise exception using errcode = '22023', message = 'asset release metadata is invalid';
  end if;
  if (
    select count(*) <> 210
      or count(distinct asset->>'template_id') <> 210
      or count(*) filter (where template.id is null) <> 0
    from jsonb_array_elements(p_assets) asset
    left join catalog.templates template on template.id = asset->>'template_id'
  ) then
    raise exception using errcode = '22023', message = 'asset release must cover every catalog template exactly once';
  end if;

  insert into catalog.asset_delivery_config (singleton, public_origin, public_bucket)
  values (true, p_public_origin, 'pet-runtime')
  on conflict (singleton) do nothing;
  if exists (
    select 1
    from catalog.asset_delivery_config
    where singleton and (public_origin <> p_public_origin or public_bucket <> 'pet-runtime')
  ) then
    raise exception using errcode = '22023', message = 'asset delivery origin is immutable within one environment';
  end if;

  select * into v_release from catalog.asset_releases where release_key = p_release_key for update;
  if v_release.id is not null then
    if v_release.manifest_sha256 is distinct from p_manifest_sha256
      or v_release.git_commit is distinct from p_git_commit
    then
      raise exception using errcode = '22023', message = 'release key already belongs to different content';
    end if;
    select * into v_current from catalog.current_asset_release where singleton for update;
    if v_current.release_id = v_release.id then
      v_result := jsonb_build_object(
        'release_key', v_release.release_key,
        'manifest_sha256', v_release.manifest_sha256,
        'revision', v_current.revision,
        'status', 'active',
        'idempotent_replay', true
      );
      update catalog.asset_mutation_runs
      set status = 'committed', finished_at = now(), details = v_result
      where id = v_mutation.id;
      return v_result;
    end if;
    raise exception using errcode = '22023', message = 'retired release keys can only be selected by rollback';
  end if;

  insert into catalog.asset_releases (release_key, manifest_sha256, git_commit, status)
  values (p_release_key, p_manifest_sha256, p_git_commit, 'staging')
  returning * into v_release;

  for v_asset in select value from jsonb_array_elements(p_assets)
  loop
    v_master := catalog.register_asset_object('master', 'art-masters', v_asset->'master');
    v_thumbnail := catalog.register_asset_object('runtime', 'pet-runtime', v_asset->'thumbnail');
    v_detail := catalog.register_asset_object('runtime', 'pet-runtime', v_asset->'detail');
    insert into catalog.asset_release_templates (
      release_id, template_id, master_object_id, thumbnail_object_id, detail_object_id
    ) values (
      v_release.id, v_asset->>'template_id', v_master, v_thumbnail, v_detail
    );
  end loop;

  select * into v_current from catalog.current_asset_release where singleton for update;
  if v_current.release_id is not null then
    update catalog.asset_releases
    set status = 'retired', retired_at = now(), delete_after = now() + interval '90 days'
    where id = v_current.release_id;
    v_revision := v_current.revision + 1;
    update catalog.current_asset_release
    set release_id = v_release.id, revision = v_revision, switched_at = now()
    where singleton;
  else
    v_revision := 1;
    insert into catalog.current_asset_release (singleton, release_id, revision)
    values (true, v_release.id, v_revision);
  end if;

  update catalog.asset_releases set status = 'active' where id = v_release.id;

  v_result := jsonb_build_object(
    'release_key', v_release.release_key,
    'manifest_sha256', v_release.manifest_sha256,
    'revision', v_revision,
    'status', 'active',
    'idempotent_replay', false
  );
  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(), details = v_result
  where id = v_mutation.id;
  return v_result;
end
$$;

create or replace function api.catalog_asset_current()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'release_key', release.release_key,
    'manifest_sha256', release.manifest_sha256,
    'git_commit', release.git_commit,
    'revision', current_release.revision,
    'published_at', release.published_at,
    'template_count', (select count(*) from catalog.asset_release_templates item where item.release_id = release.id),
    'public_origin', config.public_origin,
    'public_bucket', config.public_bucket
  )
  from catalog.current_asset_release current_release
  join catalog.asset_releases release on release.id = current_release.release_id
  cross join catalog.asset_delivery_config config
  where current_release.singleton and config.singleton
$$;

create or replace function api.catalog_asset_release_get(p_release_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'private_bucket', 'art-masters',
    'public_bucket', 'pet-runtime',
    'manifest_sha256', release.manifest_sha256,
    'release', jsonb_build_object('key', release.release_key, 'git_commit', release.git_commit),
    'templates', coalesce(jsonb_agg(jsonb_build_object(
      'template_id', item.template_id,
      'master', jsonb_build_object('key', master.object_key, 'sha256', master.sha256, 'bytes', master.byte_size, 'width', master.width, 'height', master.height, 'mime_type', master.mime_type),
      'thumbnail', jsonb_build_object('key', thumbnail.object_key, 'sha256', thumbnail.sha256, 'bytes', thumbnail.byte_size, 'width', thumbnail.width, 'height', thumbnail.height, 'mime_type', thumbnail.mime_type),
      'detail', jsonb_build_object('key', detail.object_key, 'sha256', detail.sha256, 'bytes', detail.byte_size, 'width', detail.width, 'height', detail.height, 'mime_type', detail.mime_type)
    ) order by template.sort_order), '[]'::jsonb)
  )
  from catalog.asset_releases release
  join catalog.asset_release_templates item on item.release_id = release.id
  join catalog.templates template on template.id = item.template_id
  join catalog.asset_objects master on master.id = item.master_object_id
  join catalog.asset_objects thumbnail on thumbnail.id = item.thumbnail_object_id
  join catalog.asset_objects detail on detail.id = item.detail_object_id
  where release.release_key = p_release_key
  group by release.id
$$;

create or replace function api.catalog_asset_lock(p_release_key text, p_locked_until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release catalog.asset_releases%rowtype;
begin
  if p_locked_until <= now() or p_locked_until > now() + interval '10 years' then
    raise exception using errcode = '22023', message = 'rollback lock expiry is invalid';
  end if;
  update catalog.asset_releases
  set rollback_locked_until = greatest(coalesce(rollback_locked_until, p_locked_until), p_locked_until)
  where release_key = p_release_key
  returning * into v_release;
  if v_release.id is null then
    raise exception using errcode = '22023', message = 'asset release was not found';
  end if;
  return jsonb_build_object('release_key', v_release.release_key, 'rollback_locked_until', v_release.rollback_locked_until);
end
$$;

create or replace function api.catalog_asset_rollback(
  p_release_key text,
  p_idempotency_key uuid,
  p_mutation_run_id uuid,
  p_mutation_fence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target catalog.asset_releases%rowtype;
  v_current catalog.current_asset_release%rowtype;
  v_existing catalog.asset_rollback_commands%rowtype;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_result jsonb;
begin
  select * into v_target from catalog.asset_releases where release_key = p_release_key;
  if v_target.id is null then raise exception using errcode = '22023', message = 'asset release was not found'; end if;
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'rollback', p_release_key, v_target.manifest_sha256
  );
  select * into v_existing from catalog.asset_rollback_commands where idempotency_key = p_idempotency_key for update;
  if v_existing.idempotency_key is not null then
    if v_target.id is distinct from v_existing.release_id then
      raise exception using errcode = '22023', message = 'rollback idempotency key was reused';
    end if;
    update catalog.asset_mutation_runs
    set status = 'committed', finished_at = now(), details = v_existing.result
    where id = v_mutation.id;
    return v_existing.result;
  end if;
  select * into v_target from catalog.asset_releases where release_key = p_release_key for update;
  if (select count(*) from catalog.asset_release_templates where release_id = v_target.id) <> 210
    or exists (
      select 1 from catalog.asset_release_templates item
      join catalog.asset_objects thumbnail on thumbnail.id = item.thumbnail_object_id
      join catalog.asset_objects detail on detail.id = item.detail_object_id
      where item.release_id = v_target.id and (thumbnail.status <> 'active' or detail.status <> 'active')
    )
  then
    raise exception using errcode = '22023', message = 'asset release is incomplete or no longer rollback-safe';
  end if;
  select * into v_current from catalog.current_asset_release where singleton for update;
  if v_current.release_id <> v_target.id then
    update catalog.asset_releases
    set status = 'retired', retired_at = now(), delete_after = now() + interval '90 days'
    where id = v_current.release_id;
    update catalog.asset_releases
    set status = 'active', retired_at = null, delete_after = null
    where id = v_target.id;
    update catalog.current_asset_release
    set release_id = v_target.id, revision = revision + 1, switched_at = now()
    where singleton
    returning revision into v_current.revision;
  end if;
  v_result := jsonb_build_object(
    'release_key', v_target.release_key,
    'manifest_sha256', v_target.manifest_sha256,
    'revision', v_current.revision,
    'status', 'active'
  );
  insert into catalog.asset_rollback_commands (idempotency_key, release_id, result)
  values (p_idempotency_key, v_target.id, v_result);
  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(), details = v_result
  where id = v_mutation.id;
  return v_result;
end
$$;

-- source: 30_operations.sql
create table operations.user_authority_sequences (
  user_id uuid primary key references identity.users(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table operations.user_admission_counters (
  user_id uuid primary key references identity.users(id) on delete cascade,
  minute_window_started_at timestamptz not null,
  minute_count integer not null default 0 check (minute_count between 0 and 60),
  day_window_started_at timestamptz not null,
  day_count integer not null default 0 check (day_count between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table operations.operations (
  id uuid primary key,
  user_id uuid not null references identity.users(id) on delete cascade,
  use_case text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  request jsonb,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  result jsonb,
  error_code text,
  authority_sequence bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  result_acknowledged_at timestamptz,
  payload_purged_at timestamptz,
  check (substr(id::text, 15, 1) = '7' and substr(id::text, 20, 1) in ('8', '9', 'a', 'b')),
  check (
    result_acknowledged_at is null
    or (use_case = 'inventory.evolve' and status in ('succeeded', 'failed'))
  ),
  check (
    (status in ('pending', 'unknown') and authority_sequence is null)
    or (
      status in ('succeeded', 'failed')
      and authority_sequence is not null
      and authority_sequence > 0
    )
  ),
  check (
    (payload_purged_at is null and request is not null)
    or (
      payload_purged_at is not null
      and status in ('succeeded', 'failed')
      and request is null
      and result is null
      and completed_at is not null
      and payload_purged_at >= completed_at
    )
  ),
  unique (user_id, use_case, id)
);

create index operations_user_created_idx on operations.operations (user_id, created_at desc);
create index operations_pending_idx on operations.operations (created_at) where status in ('pending', 'unknown');
create index operations_open_user_idx
on operations.operations (user_id, created_at, id)
where status in ('pending', 'unknown');
create index operations_failed_user_idx
on operations.operations (user_id, completed_at desc)
where status = 'failed';
create unique index operations_user_authority_sequence_idx
on operations.operations (user_id, authority_sequence)
where authority_sequence is not null;
create unique index operations_one_blocking_evolution_per_user_idx
on operations.operations (user_id)
where use_case = 'inventory.evolve' and result_acknowledged_at is null;
create index operations_payload_cleanup_idx
on operations.operations (completed_at, id)
where status in ('succeeded', 'failed') and payload_purged_at is null;
create index operations_user_recovery_idx
on operations.operations (user_id, created_at, id)
where use_case <> 'gacha.open'
  and (
    status in ('pending', 'unknown')
    or (
      use_case = 'inventory.evolve'
      and status in ('succeeded', 'failed')
      and result_acknowledged_at is null
    )
  );

create or replace function operations.operation_id_timestamp_ms(p_operation_id uuid)
returns bigint
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  with value as (
    select decode(substr(replace(p_operation_id::text, '-', ''), 1, 12), 'hex') bytes
  )
  select get_byte(bytes, 0)::bigint * 1099511627776
    + get_byte(bytes, 1)::bigint * 4294967296
    + get_byte(bytes, 2)::bigint * 16777216
    + get_byte(bytes, 3)::bigint * 65536
    + get_byte(bytes, 4)::bigint * 256
    + get_byte(bytes, 5)::bigint
  from value
$$;

create or replace function operations.assert_new_operation_id(p_operation_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_text text := p_operation_id::text;
  v_timestamp_ms bigint;
  v_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_operation_id is null
    or substr(v_text, 15, 1) <> '7'
    or substr(v_text, 20, 1) not in ('8', '9', 'a', 'b')
  then
    perform api.raise_business_error('IDEMPOTENCY_KEY_INVALID', '幂等键必须是 UUIDv7');
  end if;
  v_timestamp_ms := operations.operation_id_timestamp_ms(p_operation_id);
  if v_timestamp_ms < v_now_ms - 86400000
    or v_timestamp_ms > v_now_ms + 300000
  then
    perform api.raise_business_error('IDEMPOTENCY_KEY_INVALID', '幂等键时间无效');
  end if;
end;
$$;

create or replace function operations.admit_new_command(p_user_id uuid, p_use_case text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_counter operations.user_admission_counters%rowtype;
  v_failed_count integer;
  v_open_count integer;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended('operations.admission:' || p_user_id::text, 0));
  insert into operations.user_admission_counters (
    user_id, minute_window_started_at, day_window_started_at
  ) values (p_user_id, v_now, v_now)
  on conflict (user_id) do nothing;
  select * into v_counter
  from operations.user_admission_counters
  where user_id = p_user_id
  for update;

  if p_use_case = 'inventory.evolve' and exists (
    select 1
    from operations.operations o
    where o.user_id = p_user_id
      and o.use_case = 'inventory.evolve'
      and o.result_acknowledged_at is null
  ) then
    perform api.raise_business_error(
      'ACK_REQUIRED',
      '请先确认上一次进化结果'
    );
  end if;

  if v_counter.minute_window_started_at <= v_now - interval '60 seconds' then
    v_counter.minute_window_started_at := v_now;
    v_counter.minute_count := 0;
  end if;
  if v_counter.day_window_started_at <= v_now - interval '24 hours' then
    v_counter.day_window_started_at := v_now;
    v_counter.day_count := 0;
  end if;
  if v_counter.minute_count >= 60 or v_counter.day_count >= 1000 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  select count(*)::integer into v_failed_count
  from operations.operations
  where user_id = p_user_id
    and status = 'failed'
    and completed_at >= v_now - interval '24 hours';
  if v_failed_count >= 100 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  select count(*)::integer into v_open_count
  from operations.operations
  where user_id = p_user_id
    and status in ('pending', 'unknown');
  if v_open_count >= 20 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;

  update operations.user_admission_counters
  set minute_window_started_at = v_counter.minute_window_started_at,
      minute_count = v_counter.minute_count + 1,
      day_window_started_at = v_counter.day_window_started_at,
      day_count = v_counter.day_count + 1,
      updated_at = v_now
  where user_id = p_user_id;
end;
$$;

create or replace function operations.assign_authority_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('succeeded', 'failed') and new.authority_sequence is null then
    insert into operations.user_authority_sequences (user_id, last_sequence)
    values (new.user_id, 1)
    on conflict (user_id) do update
    set last_sequence = operations.user_authority_sequences.last_sequence + 1,
        updated_at = now()
    returning last_sequence into new.authority_sequence;
  end if;
  return new;
end;
$$;

create trigger operations_assign_authority_sequence
before insert or update of status on operations.operations
for each row execute function operations.assign_authority_sequence();

create table operations.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table operations.telegram_chat_onboarding (
  user_id uuid primary key references identity.users(id) on delete cascade,
  telegram_id bigint not null unique
    check (telegram_id between 1 and 9007199254740991),
  first_update_id bigint not null unique
    check (first_update_id between 0 and 9007199254740991),
  delivery_status text not null default 'unknown'
    check (delivery_status in ('unknown', 'sent', 'failed')),
  welcome_message_id bigint check (welcome_message_id > 0),
  attempted_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  error_code text check (error_code is null or error_code = 'TELEGRAM_API_FAILED'),
  updated_at timestamptz not null default clock_timestamp(),
  check (completed_at is null or completed_at >= attempted_at),
  check (
    (completed_at is null
      and delivery_status = 'unknown'
      and welcome_message_id is null
      and error_code is null)
    or
    (completed_at is not null
      and (
        (delivery_status = 'sent'
          and welcome_message_id is not null
          and error_code is null)
        or
        (delivery_status in ('unknown', 'failed')
          and welcome_message_id is null
          and error_code = 'TELEGRAM_API_FAILED')
      ))
  )
);

create or replace function api.telegram_chat_onboarding_claim(
  p_update_id bigint,
  p_telegram_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_preferred_language text;
  v_claimed_user_id uuid;
begin
  if p_update_id is null
    or p_update_id < 0
    or p_update_id > 9007199254740991
    or p_telegram_id is null
    or p_telegram_id <= 0
    or p_telegram_id > 9007199254740991
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Telegram 授权通知无效');
  end if;

  insert into operations.webhook_events (provider, event_id, payload)
  values ('telegram_write_access', p_update_id::text, p_payload)
  on conflict do nothing;
  if not found then
    return jsonb_build_object(
      'should_send', false,
      'user_id', null,
      'preferred_language', null
    );
  end if;

  select u.id, u.preferred_language
  into v_user_id, v_preferred_language
  from identity.users u
  where u.telegram_id = p_telegram_id
    and u.status = 'normal'
  for update;

  if v_user_id is null then
    update operations.webhook_events
    set processed_at = clock_timestamp()
    where provider = 'telegram_write_access'
      and event_id = p_update_id::text;
    return jsonb_build_object(
      'should_send', false,
      'user_id', null,
      'preferred_language', null
    );
  end if;

  insert into operations.telegram_chat_onboarding (
    user_id,
    telegram_id,
    first_update_id
  ) values (
    v_user_id,
    p_telegram_id,
    p_update_id
  )
  on conflict do nothing
  returning user_id into v_claimed_user_id;

  update operations.webhook_events
  set processed_at = clock_timestamp()
  where provider = 'telegram_write_access'
    and event_id = p_update_id::text;

  return jsonb_build_object(
    'should_send', v_claimed_user_id is not null,
    'user_id', v_user_id,
    'preferred_language', v_preferred_language
  );
end;
$$;

create or replace function api.telegram_chat_onboarding_finish(
  p_user_id uuid,
  p_update_id bigint,
  p_delivery_status text,
  p_welcome_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_user_id is null
    or p_update_id is null
    or p_update_id < 0
    or p_update_id > 9007199254740991
    or p_delivery_status is null
    or p_delivery_status not in ('unknown', 'sent', 'failed')
    or (p_delivery_status = 'sent' and (p_welcome_message_id is null or p_welcome_message_id <= 0))
    or (p_delivery_status <> 'sent' and p_welcome_message_id is not null)
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Telegram 欢迎消息结果无效');
  end if;

  update operations.telegram_chat_onboarding
  set delivery_status = p_delivery_status,
      welcome_message_id = p_welcome_message_id,
      completed_at = clock_timestamp(),
      error_code = case
        when p_delivery_status = 'sent' then null
        else 'TELEGRAM_API_FAILED'
      end,
      updated_at = clock_timestamp()
  where user_id = p_user_id
    and first_update_id = p_update_id
    and completed_at is null;
  v_updated := found;

  return jsonb_build_object('updated', v_updated);
end;
$$;

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

create or replace function operations.strip_pet_urls(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
  v_template_id text;
  v_url text;
  v_variants jsonb := '[]'::jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return p_value; end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(operations.strip_pet_urls(item.value) order by item.ordinality), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;

  v_result := '{}'::jsonb;
  for v_key, v_item in select key, value from jsonb_each(p_value)
  loop
    if v_key not in ('image_thumbnail_url', 'image_detail_url') then
      v_result := v_result || jsonb_build_object(v_key, operations.strip_pet_urls(v_item));
    end if;
  end loop;
  if p_value ? 'image_thumbnail_url' then
    v_variants := v_variants || jsonb_build_array('thumbnail');
  end if;
  if p_value ? 'image_detail_url' then
    v_variants := v_variants || jsonb_build_array('detail');
  end if;
  if jsonb_array_length(v_variants) > 0 then
    v_template_id := p_value->>'template_id';
    if v_template_id is null then
      v_url := coalesce(p_value->>'image_detail_url', p_value->>'image_thumbnail_url');
      v_template_id := upper((regexp_match(
        v_url,
        '/(pet-[nat]-[0-9]{3}-[123])\.[0-9a-f]{64}\.webp$'
      ))[1]);
    end if;
    if v_template_id is null or v_template_id !~ '^PET-[NAT]-[0-9]{3}-[123]$' then
      raise exception using errcode = '22023', message = 'pet image URL cannot be reduced to a template reference';
    end if;
    v_result := v_result || jsonb_build_object('_pet_image_variants', v_variants);
    if not (v_result ? 'template_id') then
      v_result := v_result || jsonb_build_object('_pet_image_template_id', v_template_id);
    end if;
  end if;
  return v_result;
end
$$;

create or replace function operations.present_pet_urls(p_value jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
  v_template_id text;
  v_variants jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then return p_value; end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(operations.present_pet_urls(item.value) order by item.ordinality), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality item(value, ordinality);
    return v_result;
  end if;
  if jsonb_typeof(p_value) <> 'object' then return p_value; end if;

  v_result := '{}'::jsonb;
  for v_key, v_item in select key, value from jsonb_each(p_value)
  loop
    if v_key not in ('_pet_image_template_id', '_pet_image_variants') then
      v_result := v_result || jsonb_build_object(v_key, operations.present_pet_urls(v_item));
    end if;
  end loop;
  v_variants := p_value->'_pet_image_variants';
  if jsonb_typeof(v_variants) = 'array' then
    v_template_id := coalesce(p_value->>'template_id', p_value->>'_pet_image_template_id');
    if v_variants ? 'thumbnail' then
      v_result := v_result || jsonb_build_object(
        'image_thumbnail_url', catalog.template_thumbnail_url(v_template_id)
      );
    end if;
    if v_variants ? 'detail' then
      v_result := v_result || jsonb_build_object(
        'image_detail_url', catalog.template_detail_url(v_template_id)
      );
    end if;
  end if;
  return v_result;
end
$$;

create or replace function operations.present_result(p_use_case text, p_result jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select operations.present_pet_urls(operations.strip_pet_urls(p_result))
$$;

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
    'result', operations.present_result(p_operation.use_case, p_operation.result),
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
  v_evolution_quantity numeric;
begin
  if p_operation_id is null or p_use_case is null or btrim(p_use_case) = '' or p_request is null then
    perform api.raise_business_error('REQUEST_INVALID', '操作请求无效');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('operations.command:' || p_operation_id::text, 0));
  select * into v_operation
  from operations.operations
  where id = p_operation_id
  for update;
  if v_operation.id is not null then
    if v_operation.user_id <> v_user_id or v_operation.use_case <> p_use_case or v_operation.request_hash <> v_hash then
      perform api.raise_business_error('IDEMPOTENCY_KEY_REUSED', '幂等键已用于不同请求');
    end if;
    if v_operation.payload_purged_at is not null then
      perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
    end if;
    return v_operation;
  end if;

  if p_use_case = 'inventory.evolve' then
    if jsonb_typeof(p_request) <> 'object' then
      perform api.raise_business_error('REQUEST_INVALID', '进化请求无效');
    end if;
    if p_request <> jsonb_build_object(
        'template_id', p_request->'template_id',
        'quantity', p_request->'quantity'
      )
      or p_request->>'template_id' is null
      or p_request->>'template_id' !~ '^PET-[NAT]-[0-9]{3}-[123]$'
      or jsonb_typeof(p_request->'quantity') <> 'number'
      or p_request->>'quantity' !~ '^[0-9]+$'
      or length(p_request->>'quantity') > 19
    then
      perform api.raise_business_error('REQUEST_INVALID', '进化请求无效');
    end if;
    v_evolution_quantity := (p_request->>'quantity')::numeric;
    if v_evolution_quantity <= 0
      or v_evolution_quantity > 9223372036854775807
      or mod(v_evolution_quantity, 3) <> 0
    then
      perform api.raise_business_error('REQUEST_INVALID', '进化请求无效');
    end if;
  end if;

  perform operations.assert_new_operation_id(p_operation_id);
  perform operations.admit_new_command(v_user_id, p_use_case);
  insert into operations.operations (id, user_id, use_case, request_hash, request)
  values (p_operation_id, v_user_id, p_use_case, v_hash, p_request)
  returning * into v_operation;
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
  set status = 'succeeded', result = operations.strip_pet_urls(p_result), error_code = null,
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
  set status = 'pending', result = operations.strip_pet_urls(p_result), error_code = null, updated_at = now()
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
  set status = 'failed', result = operations.strip_pet_urls(p_detail), error_code = p_code,
      updated_at = now(), completed_at = now()
  where id = p_operation_id;
  return (select operations.operation_json(o) from operations.operations o where o.id = p_operation_id);
end;
$$;

create or replace function operations.replay_if_finished(p_operation operations.operations)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_operation.payload_purged_at is not null then
    perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
  end if;
  if p_operation.status <> 'pending' or p_operation.result is not null then
    return operations.operation_json(p_operation);
  end if;
  return null;
end;
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
  if v_operation.payload_purged_at is not null then
    perform api.raise_business_error('OPERATION_RESULT_EXPIRED', '操作结果已超过可恢复期限');
  end if;
  v_result := operations.operation_json(v_operation);
  return v_result;
end;
$$;

create or replace function api.operations_recoverable(
  p_session_id uuid,
  p_after_authority_cursor bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  if p_after_authority_cursor is null or p_after_authority_cursor < 0 then
    perform api.raise_business_error('REQUEST_INVALID', '权威状态游标无效');
  end if;
  select jsonb_build_object(
    'operations', coalesce((
      select jsonb_agg(operations.operation_json(o) order by o.created_at, o.id)
      from operations.operations o
      join (
        select candidate.id
        from operations.operations candidate
        where candidate.user_id = v_user_id
          and candidate.use_case in ('wheel.spin', 'inventory.evolve')
          and candidate.status in ('pending', 'unknown')
        union all
        select terminal.id
        from (
          select candidate.id
          from operations.operations candidate
          where candidate.user_id = v_user_id
            and candidate.use_case = 'inventory.evolve'
            and candidate.status in ('succeeded', 'failed')
            and candidate.result_acknowledged_at is null
          order by candidate.created_at, candidate.id
          limit 1
        ) terminal
      ) recoverable on recoverable.id = o.id
    ), '[]'::jsonb),
    'authority_refresh_routes', coalesce((
      select jsonb_agg(marker.use_case order by marker.first_sequence)
      from (
        select o.use_case, min(o.authority_sequence) as first_sequence
        from operations.operations o
        where o.user_id = v_user_id
          and o.authority_sequence > p_after_authority_cursor
        group by o.use_case
      ) marker
    ), '[]'::jsonb),
    'next_authority_cursor', coalesce((
      select sequence.last_sequence::text
      from operations.user_authority_sequences sequence
      where sequence.user_id = v_user_id
    ), '0')
  ) into v_result;
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
create unique index ledger_battle_reference_unique_idx on economy.ledger (reason, reference)
where reason in ('battle_stake_lock', 'battle_stake_refund', 'battle_win_payout');
create unique index ledger_battle_fixture_reference_unique_idx on economy.ledger (reference)
where reason = 'battle_acceptance_fixture';

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
create index entitlements_operation_idx
on economy.entitlements (operation_id)
where operation_id is not null;

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

create or replace function economy.lock_kcoin(
  p_user_id uuid,
  p_amount bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  if p_amount <= 0 or p_reference is null then
    perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
  end if;
  insert into economy.balances (user_id, currency) values (p_user_id, 'KCOIN')
  on conflict (user_id, currency) do nothing;
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.available < p_amount then
    perform api.raise_business_error('INSUFFICIENT_BALANCE', '余额不足');
  end if;
  update economy.balances
  set available = available - p_amount, locked = locked + p_amount, updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  insert into economy.ledger (
    operation_id, user_id, currency, amount, reason, reference, balance_after
  ) values (
    p_operation_id, p_user_id, 'KCOIN', -p_amount, 'battle_stake_lock',
    p_reference, v_balance.available
  ) returning id into v_ledger_id;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
end;
$$;

create or replace function economy.refund_battle_kcoin(
  p_user_id uuid,
  p_amount bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.user_id is null or p_amount <= 0 or v_balance.locked < p_amount then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'locked_refund', 'user_id', p_user_id, 'amount', p_amount)::text;
  end if;
  update economy.balances
  set available = available + p_amount, locked = locked - p_amount, updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  insert into economy.ledger (
    operation_id, user_id, currency, amount, reason, reference, balance_after
  ) values (
    p_operation_id, p_user_id, 'KCOIN', p_amount, 'battle_stake_refund',
    p_reference, v_balance.available
  ) returning id into v_ledger_id;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
end;
$$;

create or replace function economy.settle_battle_kcoin(
  p_user_id uuid,
  p_locked_amount bigint,
  p_payout bigint,
  p_operation_id uuid,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance economy.balances%rowtype;
  v_ledger_id bigint;
begin
  select * into v_balance
  from economy.balances
  where user_id = p_user_id and currency = 'KCOIN'
  for update;
  if v_balance.user_id is null or p_locked_amount <= 0 or p_payout < 0
    or v_balance.locked < p_locked_amount
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'locked_settlement',
        'user_id', p_user_id,
        'locked_amount', p_locked_amount,
        'payout', p_payout
      )::text;
  end if;
  update economy.balances
  set available = available + p_payout,
      locked = locked - p_locked_amount,
      updated_at = now()
  where user_id = p_user_id and currency = 'KCOIN'
  returning * into v_balance;
  if p_payout > 0 then
    insert into economy.ledger (
      operation_id, user_id, currency, amount, reason, reference, balance_after
    ) values (
      p_operation_id, p_user_id, 'KCOIN', p_payout, 'battle_win_payout',
      p_reference, v_balance.available
    ) returning id into v_ledger_id;
  end if;
  return jsonb_build_object(
    'available', v_balance.available,
    'locked', v_balance.locked,
    'ledger_id', v_ledger_id
  );
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
  kind text not null check (kind in ('listing', 'expedition', 'mint', 'battle')),
  reference_id uuid not null,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (kind, reference_id, template_id)
);

create index reservations_user_template_active_idx
on inventory.reservations (user_id, template_id, kind)
include (quantity)
where status = 'active';

create view inventory.quantity_read_model
with (security_invoker = true)
as
select
  h.user_id,
  h.template_id,
  h.quantity::bigint as total,
  greatest(h.quantity - coalesce(sum(r.quantity), 0), 0)::bigint as available,
  coalesce(sum(r.quantity) filter (where r.kind = 'listing'), 0)::bigint as listed,
  0::bigint as trading,
  coalesce(sum(r.quantity) filter (where r.kind = 'expedition'), 0)::bigint as expedition,
  coalesce(sum(r.quantity) filter (where r.kind = 'mint'), 0)::bigint as minting,
  coalesce(sum(r.quantity) filter (where r.kind = 'battle'), 0)::bigint as battling
from inventory.holdings h
left join inventory.reservations r
  on r.user_id = h.user_id
  and r.template_id = h.template_id
  and r.status = 'active'
group by h.user_id, h.template_id, h.quantity;

create view inventory.item_read_model
with (security_invoker = true)
as
select
  quantity.user_id,
  template.id as template_id,
  template.name,
  template.rarity,
  template.stage,
  template.chain_id,
  chain.chain_type,
  case
    when thumbnail.id is null
      or thumbnail.object_class <> 'runtime'
      or thumbnail.bucket is distinct from delivery.public_bucket
      or thumbnail.status <> 'active'
    then null
    else delivery.public_origin || '/' || delivery.public_bucket || '/' || thumbnail.object_key
  end as image_thumbnail_url,
  case
    when detail.id is null
      or detail.object_class <> 'runtime'
      or detail.bucket is distinct from delivery.public_bucket
      or detail.status <> 'active'
    then null
    else delivery.public_origin || '/' || delivery.public_bucket || '/' || detail.object_key
  end as image_detail_url,
  template.combat_power,
  template.expedition_fgems,
  template.decompose_fgems,
  quantity.total,
  quantity.available,
  quantity.listed,
  quantity.trading,
  quantity.minting,
  quantity.expedition,
  quantity.battling,
  template.sort_order,
  template.market_price
from inventory.quantity_read_model quantity
join catalog.templates template on template.id = quantity.template_id
join catalog.chains chain on chain.id = template.chain_id
left join catalog.current_asset_release current_release on current_release.singleton
left join catalog.asset_release_templates release_item
  on release_item.release_id = current_release.release_id
  and release_item.template_id = template.id
left join catalog.asset_delivery_config delivery on delivery.singleton
left join catalog.asset_objects thumbnail on thumbnail.id = release_item.thumbnail_object_id
left join catalog.asset_objects detail on detail.id = release_item.detail_object_id
where quantity.total > 0;

create or replace function inventory.present_item(p_item inventory.item_read_model)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(p_item) - array['user_id', 'sort_order', 'market_price']::text[]
$$;

create or replace function inventory.available_quantity(p_user_id uuid, p_template_id text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select quantity.available
    from inventory.quantity_read_model quantity
    where quantity.user_id = p_user_id and quantity.template_id = p_template_id
  ), 0)
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
  select inventory.present_item(item)
  from inventory.item_read_model item
  where item.user_id = p_user_id and item.template_id = p_template_id
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
  return (
    with user_items as materialized (
      select item.*
      from inventory.item_read_model item
      where item.user_id = v_user_id
    )
    select jsonb_build_object(
      'items', coalesce(
        jsonb_agg(inventory.present_item(item) order by item.sort_order)
          filter (where item.available > 0),
        '[]'::jsonb
      ),
      'template_count', count(*) filter (where item.available > 0),
      'total_quantity', coalesce(sum(item.available) filter (where item.available > 0), 0)
    )
    from user_items item
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
    lock table
      catalog.versions,
      catalog.chains,
      catalog.templates,
      gacha.boxes,
      catalog.asset_delivery_config,
      catalog.asset_objects,
      catalog.asset_releases,
      catalog.asset_release_templates,
      catalog.current_asset_release
    in share mode;
    select * into v_box from gacha.boxes where tier = p_tier;
    if v_box.tier is null then perform api.raise_business_error('BOX_TIER_INVALID', '盲盒档次无效'); end if;
    if not gacha.rules_complete() then perform api.raise_business_error('CATALOG_INVALID', '开盒规则加载失败，请重新加载'); end if;
    if not catalog.asset_release_ready() then
      perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
    end if;

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
        'image_thumbnail_url', catalog.template_thumbnail_url(v_template.id),
        'image_detail_url', catalog.template_detail_url(v_template.id),
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
    with user_items as materialized (
      select item.*
      from inventory.item_read_model item
      where item.user_id = v_user_id and item.available > 0
    )
    select jsonb_agg(
      inventory.present_item(item)
        || jsonb_build_object('unit_reward_fgems', item.expedition_fgems)
      order by item.sort_order
    )
    from user_items item
    where ((p_tier = 'normal' and catalog.rarity_rank(item.rarity) between 1 and 3)
        or (p_tier = 'intermediate' and catalog.rarity_rank(item.rarity) between 2 and 4)
        or (p_tier = 'advanced' and catalog.rarity_rank(item.rarity) between 3 and 5))
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
  spin_count smallint not null default 0 check (spin_count between 0 and 50),
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
    'remaining', 50 - v_count,
    'daily_limit', 50,
    'single_cost', 20,
    'ten_cost', 180,
    'milestone_10_claimed', v_count >= 10,
    'milestone_20_claimed', v_count >= 20
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
    if v_spin_count + p_count > 50 then perform api.raise_business_error('WHEEL_DAILY_LIMIT', '今日转盘次数不足'); end if;
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
      'remaining', 50 - v_spin_count - p_count,
      'daily_limit', 50,
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
    'image_thumbnail_url', catalog.template_thumbnail_url((p_template).id),
    'image_detail_url', catalog.template_detail_url((p_template).id)
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('operations.admission:' || v_user_id::text, 0)
  );
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
    if v_fgems < v_fgems_required then perform api.raise_business_error('INSUFFICIENT_BALANCE', 'Gems 不足'); end if;
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

-- source: 44_battle.sql
create table battle.rulesets (
  id text primary key check (id ~ '^battle-v[1-9][0-9]*$'),
  checksum text not null unique check (checksum ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'retired')),
  parameters jsonb not null,
  source_version text not null check (source_version = 'v1'),
  activated_at timestamptz not null default now(),
  unique (id, checksum),
  check ((parameters->>'waiting_timeout_seconds')::integer = 1800),
  check ((parameters->>'matchmaking_wait_seconds')::integer = 120),
  check ((parameters->>'heartbeat_interval_seconds')::integer = 5),
  check ((parameters->>'presence_online_window_seconds')::integer = 10),
  check ((parameters->>'offline_reconnect_seconds')::integer = 90),
  check ((parameters->>'lobby_timeout_seconds')::integer = 300),
  check ((parameters->>'lobby_countdown_seconds')::integer = 3),
  check ((parameters->>'action_timeout_seconds')::integer = 15),
  check ((parameters->>'actions_per_round')::integer = 2),
  check ((parameters->>'timeout_skill_position')::integer = 1),
  check (parameters->>'initiative_rule' = 'opening_speed_creator_tie'),
  check ((parameters->>'max_normal_turns')::integer = 20),
  check (parameters->'outbox_retry_seconds' = '[1, 2, 5, 10, 30]'::jsonb)
);

create unique index battle_one_active_ruleset_idx on battle.rulesets ((status)) where status = 'active';

create table battle.entry_tiers (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^tier-[0-9]+$'),
  entry_fee bigint not null check (entry_fee in (20, 100, 500)),
  pool bigint not null,
  winner_payout bigint not null,
  fee bigint not null,
  primary key (ruleset_id, id),
  unique (ruleset_id, entry_fee),
  check (pool = entry_fee * 2),
  check (winner_payout = pool * 9 / 10),
  check (fee = pool - winner_payout)
);

create table battle.rarity_factors (
  ruleset_id text not null references battle.rulesets(id),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  factor_bps integer not null check (factor_bps > 0),
  target_budget integer not null check (target_budget > 0),
  primary key (ruleset_id, rarity),
  check (factor_bps = target_budget * 25)
);

create table battle.type_matchups (
  ruleset_id text not null references battle.rulesets(id),
  attacker text not null check (attacker in ('fire', 'grass', 'earth', 'lightning', 'water')),
  defender text not null check (defender in ('fire', 'grass', 'earth', 'lightning', 'water')),
  multiplier_bps integer not null check (multiplier_bps in (7500, 10000, 15000)),
  primary key (ruleset_id, attacker, defender)
);

create table battle.skill_slots (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^S(0[1-9]|10)$'),
  power integer not null check (power > 0),
  accuracy_bps integer not null check (accuracy_bps between 1 and 10000),
  trajectory text not null check (btrim(trajectory) <> ''),
  primary key (ruleset_id, id)
);

create table battle.skills (
  ruleset_id text not null references battle.rulesets(id),
  id text not null,
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  slot_id text not null,
  name text not null,
  effect_key text not null,
  primary key (ruleset_id, id),
  unique (ruleset_id, name),
  unique (ruleset_id, effect_key),
  foreign key (ruleset_id, slot_id) references battle.skill_slots(ruleset_id, id),
  check (
    effect_key ~ '^(fire|grass|earth|lightning|water)-(0[1-9]|10)$'
    and effect_key = element || '-' || substr(slot_id, 2)
  )
);

create table battle.role_profiles (
  ruleset_id text not null references battle.rulesets(id),
  id text not null check (id ~ '^P(0[1-9]|1[0-4])$'),
  sort_order smallint not null check (sort_order between 1 and 14),
  name text not null,
  base_hp integer not null check (base_hp > 0),
  base_attack integer not null check (base_attack > 0),
  base_defense integer not null check (base_defense > 0),
  base_speed integer not null check (base_speed > 0),
  loadout_id text not null check (loadout_id ~ '^L(0[1-9]|1[0-4])$'),
  primary key (ruleset_id, id),
  unique (ruleset_id, sort_order),
  unique (ruleset_id, loadout_id),
  check (base_hp / 3 + base_attack + base_defense + base_speed = 400)
);

create table battle.profile_loadouts (
  ruleset_id text not null references battle.rulesets(id),
  loadout_id text not null check (loadout_id ~ '^L(0[1-9]|1[0-4])$'),
  position smallint not null check (position between 1 and 4),
  slot_id text not null,
  primary key (ruleset_id, loadout_id, position),
  unique (ruleset_id, loadout_id, slot_id),
  foreign key (ruleset_id, slot_id) references battle.skill_slots(ruleset_id, id)
);

create table battle.chain_configs (
  ruleset_id text not null references battle.rulesets(id),
  chain_id text not null references catalog.chains(id),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  profile_id text not null,
  primary key (ruleset_id, chain_id),
  foreign key (ruleset_id, profile_id) references battle.role_profiles(ruleset_id, id)
);

create table battle.template_configs (
  ruleset_id text not null references battle.rulesets(id),
  template_id text not null references catalog.templates(id),
  chain_id text not null references catalog.chains(id),
  stage smallint not null check (stage between 1 and 3),
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  profile_id text not null,
  max_hp integer not null check (max_hp > 0),
  attack integer not null check (attack > 0),
  defense integer not null check (defense > 0),
  speed integer not null check (speed > 0),
  skill_1_id text not null,
  skill_1_power integer not null check (skill_1_power > 0),
  skill_2_id text not null,
  skill_2_power integer not null check (skill_2_power > 0),
  skill_3_id text,
  skill_3_power integer check (skill_3_power is null or skill_3_power > 0),
  skill_4_id text,
  skill_4_power integer check (skill_4_power is null or skill_4_power > 0),
  primary key (ruleset_id, template_id),
  foreign key (ruleset_id, chain_id) references battle.chain_configs(ruleset_id, chain_id),
  foreign key (ruleset_id, profile_id) references battle.role_profiles(ruleset_id, id),
  foreign key (ruleset_id, skill_1_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_2_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_3_id) references battle.skills(ruleset_id, id),
  foreign key (ruleset_id, skill_4_id) references battle.skills(ruleset_id, id),
  check (
    (
      stage = 1
      and skill_3_id is null and skill_3_power is null
      and skill_4_id is null and skill_4_power is null
    )
    or (
      stage = 2
      and skill_3_id is not null and skill_3_power is not null
      and skill_4_id is null and skill_4_power is null
    )
    or (
      stage = 3
      and skill_3_id is not null and skill_3_power is not null
      and skill_4_id is not null and skill_4_power is not null
    )
  ),
  check (
    skill_1_power <= skill_2_power
    and (skill_3_power is null or skill_2_power <= skill_3_power)
    and (skill_4_power is null or skill_3_power <= skill_4_power)
  ),
  check (
    skill_1_id <> skill_2_id
    and (
      skill_3_id is null
      or (skill_3_id <> skill_1_id and skill_3_id <> skill_2_id)
    )
    and (
      skill_4_id is null
      or (
        skill_4_id <> skill_1_id
        and skill_4_id <> skill_2_id
        and skill_4_id <> skill_3_id
      )
    )
  )
);

create index battle_template_configs_chain_idx on battle.template_configs (ruleset_id, chain_id, stage);

create table battle.rooms (
  id uuid primary key,
  creator_user_id uuid not null references identity.users(id),
  create_operation_id uuid not null unique references operations.operations(id),
  ruleset_id text not null,
  ruleset_checksum text not null,
  entry_tier_id text not null,
  room_mode text not null check (room_mode in ('friend_invite', 'public_match')),
  invite_token_hash text unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in (
    'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown',
    'active_turn',
    'finished', 'draw', 'cancelled', 'expired', 'voided'
  )),
  state_version bigint not null default 1 check (state_version > 0),
  first_actor_side text check (first_actor_side in ('creator', 'opponent')),
  active_actor_side text check (active_actor_side in ('creator', 'opponent')),
  current_round_no smallint not null default 0 check (current_round_no between 0 and 20),
  current_action_ordinal smallint not null default 0 check (current_action_ordinal between 0 and 2),
  latest_action_sequence bigint not null default 0 check (latest_action_sequence >= 0),
  private_seed bytea,
  seed_commitment text check (seed_commitment is null or seed_commitment ~ '^[0-9a-f]{64}$'),
  prepare_deadline timestamptz,
  waiting_started_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  lobby_expires_at timestamptz,
  lobby_start_deadline timestamptz,
  phase_deadline timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (ruleset_id, ruleset_checksum) references battle.rulesets(id, checksum),
  foreign key (ruleset_id, entry_tier_id) references battle.entry_tiers(ruleset_id, id),
  check (
    (
      room_mode = 'friend_invite'
      and invite_token_hash is not null
      and prepare_deadline = created_at + interval '60 seconds'
    )
    or (
      room_mode = 'public_match'
      and invite_token_hash is null
      and prepare_deadline is null
      and status <> 'preparing_share'
      and waiting_started_at is not null
      and expires_at = waiting_started_at + interval '120 seconds'
    )
  ),
  check (private_seed is null or octet_length(private_seed) = 32),
  check (
    (status = 'preparing_share' and waiting_started_at is null and expires_at is null)
    or status <> 'preparing_share'
  ),
  check (
    status <> 'waiting'
    or (waiting_started_at is not null and expires_at is not null)
  ),
  check (
    status not in ('lobby_waiting', 'lobby_countdown')
    or (
      accepted_at is not null
      and lobby_expires_at is not null
      and lobby_expires_at = accepted_at + interval '5 minutes'
      and current_round_no = 0
      and current_action_ordinal = 0
      and private_seed is not null
      and seed_commitment is not null
    )
  ),
  check (
    (status = 'lobby_countdown') = (lobby_start_deadline is not null)
  ),
  check (
    status not in ('active_turn', 'finished', 'draw')
    or (private_seed is not null and seed_commitment is not null and current_round_no >= 1)
  ),
  check (
    status <> 'active_turn'
    or (
      first_actor_side is not null
      and active_actor_side is not null
      and current_round_no between 1 and 20
      and current_action_ordinal between 1 and 2
      and phase_deadline is not null
    )
  ),
  check (
    (status in ('finished', 'draw', 'cancelled', 'expired', 'voided'))
    = (finished_at is not null)
  ),
  check ((first_actor_side is null) = (current_round_no = 0))
);

create index battle_rooms_prepare_due_idx on battle.rooms (prepare_deadline)
where status = 'preparing_share';
create index battle_rooms_waiting_due_idx on battle.rooms (expires_at)
where status = 'waiting';
create index battle_rooms_public_match_candidate_idx
on battle.rooms (ruleset_id, entry_tier_id, expires_at, id)
where room_mode = 'public_match' and status = 'waiting';
create index battle_rooms_lobby_due_idx
on battle.rooms (lobby_expires_at, lobby_start_deadline)
where status in ('lobby_waiting', 'lobby_countdown');
create index battle_rooms_phase_due_idx on battle.rooms (phase_deadline)
where status = 'active_turn';

create table battle.prepared_shares (
  room_id uuid primary key references battle.rooms(id),
  status text not null default 'pending' check (status in ('pending', 'active', 'failed')),
  prepared_message_id text unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  telegram_expires_at timestamptz,
  last_error text,
  activated_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    prepared_message_id is null
    or (
      prepared_message_id = btrim(prepared_message_id)
      and char_length(prepared_message_id) between 1 and 256
    )
  ),
  check ((status = 'active') = (prepared_message_id is not null and activated_at is not null))
);

create index battle_prepared_shares_due_idx on battle.prepared_shares (next_attempt_at)
where status = 'pending';

create table battle.participants (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  user_id uuid not null references identity.users(id),
  side text not null check (side in ('creator', 'opponent')),
  status text not null check (status in (
    'preparing_share', 'waiting', 'lobby', 'active', 'finished', 'draw',
    'cancelled', 'expired', 'voided'
  )),
  join_operation_id uuid not null unique references operations.operations(id),
  last_heartbeat_at timestamptz,
  offline_since timestamptz,
  presence_deadline timestamptz,
  presence_lifecycle_version bigint not null default 0
    check (presence_lifecycle_version >= 0),
  presence_lease_id uuid,
  presence_command_seq bigint not null default 0
    check (presence_command_seq >= 0),
  presence_lease_active boolean not null default false,
  joined_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (room_id, side),
  unique (room_id, user_id),
  unique (room_id, id),
  check (
    (status in ('finished', 'draw', 'cancelled', 'expired', 'voided'))
    = (finished_at is not null)
  ),
  check (
    (offline_since is null and presence_deadline is null)
    or (offline_since is not null and presence_deadline is not null)
  ),
  check (
    (
      presence_lifecycle_version = 0
      and presence_lease_id is null
      and presence_command_seq = 0
      and not presence_lease_active
    )
    or (
      presence_lifecycle_version > 0
      and presence_lease_id is not null
      and presence_command_seq > 0
    )
  ),
  check (status <> 'lobby' or last_heartbeat_at is not null)
);

create unique index battle_participants_one_active_per_user_idx
on battle.participants (user_id)
where status in ('preparing_share', 'waiting', 'lobby', 'active');

create index battle_participants_room_idx on battle.participants (room_id, side);
create index battle_participants_presence_due_idx
on battle.participants (presence_deadline, room_id)
where status = 'lobby' and presence_deadline is not null;
create table battle.team_members (
  id uuid primary key default extensions.gen_random_uuid(),
  participant_id uuid not null references battle.participants(id),
  slot smallint not null check (slot between 1 and 3),
  template_id text not null references catalog.templates(id),
  template_name text not null,
  rarity text not null check (rarity in ('common', 'rare', 'epic', 'legendary', 'mythic')),
  stage smallint not null check (stage between 1 and 3),
  element text not null check (element in ('fire', 'grass', 'earth', 'lightning', 'water')),
  max_hp integer not null check (max_hp > 0),
  current_hp integer not null check (current_hp between 0 and max_hp),
  attack integer not null check (attack > 0),
  defense integer not null check (defense > 0),
  speed integer not null check (speed > 0),
  skill_1_id text not null,
  skill_1_power integer not null check (skill_1_power > 0),
  skill_2_id text not null,
  skill_2_power integer not null check (skill_2_power > 0),
  skill_3_id text,
  skill_3_power integer check (skill_3_power is null or skill_3_power > 0),
  skill_4_id text,
  skill_4_power integer check (skill_4_power is null or skill_4_power > 0),
  alive boolean not null default true,
  active boolean not null default false,
  unique (participant_id, slot),
  unique (participant_id, template_id),
  check (alive = (current_hp > 0)),
  check (not active or alive),
  check (
    (
      stage = 1
      and skill_3_id is null and skill_3_power is null
      and skill_4_id is null and skill_4_power is null
    )
    or (
      stage = 2
      and skill_3_id is not null and skill_3_power is not null
      and skill_4_id is null and skill_4_power is null
    )
    or (
      stage = 3
      and skill_3_id is not null and skill_3_power is not null
      and skill_4_id is not null and skill_4_power is not null
    )
  ),
  check (
    skill_1_power <= skill_2_power
    and (skill_3_power is null or skill_2_power <= skill_3_power)
    and (skill_4_power is null or skill_3_power <= skill_4_power)
  ),
  check (
    skill_1_id <> skill_2_id
    and (
      skill_3_id is null
      or (skill_3_id <> skill_1_id and skill_3_id <> skill_2_id)
    )
    and (
      skill_4_id is null
      or (
        skill_4_id <> skill_1_id
        and skill_4_id <> skill_2_id
        and skill_4_id <> skill_3_id
      )
    )
  )
);

create unique index battle_team_members_one_active_idx on battle.team_members (participant_id)
where active;

create table battle.stakes (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  participant_id uuid not null unique,
  user_id uuid not null references identity.users(id),
  amount bigint not null check (amount in (20, 100, 500)),
  status text not null default 'locked' check (status in ('locked', 'refunded', 'settled')),
  lock_ledger_id bigint not null unique references economy.ledger(id),
  refund_ledger_id bigint unique references economy.ledger(id),
  payout_ledger_id bigint unique references economy.ledger(id),
  locked_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (room_id, user_id),
  foreign key (room_id, participant_id) references battle.participants(room_id, id),
  check (
    (status = 'locked' and settled_at is null and refund_ledger_id is null and payout_ledger_id is null)
    or (status = 'refunded' and settled_at is not null and refund_ledger_id is not null and payout_ledger_id is null)
    or (status = 'settled' and settled_at is not null and refund_ledger_id is null)
  )
);

create table battle.turns (
  room_id uuid not null references battle.rooms(id),
  round_no smallint not null check (round_no between 1 and 20),
  start_snapshot_hash text not null check (start_snapshot_hash ~ '^[0-9a-f]{64}$'),
  resolution_hash text check (resolution_hash is null or resolution_hash ~ '^[0-9a-f]{64}$'),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (room_id, round_no),
  check ((resolution_hash is null) = (resolved_at is null))
);

create table battle.actions (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  round_no smallint not null check (round_no between 1 and 20),
  action_ordinal smallint not null check (action_ordinal between 1 and 2),
  participant_id uuid not null,
  kind text not null check (kind in ('attack', 'switch', 'replace_attack')),
  source text not null check (source in ('player', 'timeout')),
  skill_position smallint check (skill_position between 1 and 4),
  skill_id text,
  target_slot smallint check (target_slot between 1 and 3),
  operation_id uuid references operations.operations(id),
  locked_at timestamptz not null default now(),
  unique (room_id, round_no, action_ordinal),
  unique (operation_id),
  foreign key (room_id, round_no) references battle.turns(room_id, round_no),
  foreign key (room_id, participant_id) references battle.participants(room_id, id),
  check (
    (kind = 'attack' and skill_position is not null and skill_id is not null and target_slot is null)
    or (kind = 'switch' and skill_position is null and skill_id is null and target_slot is not null)
    or (kind = 'replace_attack' and skill_position is not null and skill_id is not null and target_slot is not null)
  )
);

create table battle.events (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  sequence bigint not null check (sequence > 0),
  state_version bigint not null check (state_version > 0),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  kind text not null,
  public_payload jsonb not null,
  private_payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, sequence)
);

create table battle.audit_heads (
  room_id uuid primary key references battle.rooms(id),
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_hash text not null default repeat('0', 64) check (last_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

create table battle.audit_entries (
  id bigint generated always as identity primary key,
  room_id uuid not null references battle.rooms(id),
  sequence bigint not null check (sequence > 0),
  kind text not null,
  payload jsonb not null,
  prior_hash text not null check (prior_hash ~ '^[0-9a-f]{64}$'),
  entry_hash text not null check (entry_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (room_id, sequence),
  unique (room_id, entry_hash)
);

create table battle.settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  room_id uuid not null unique references battle.rooms(id),
  result text not null check (result in ('winner', 'draw', 'void')),
  winner_participant_id uuid,
  pool bigint not null check (pool >= 0),
  winner_payout bigint not null check (winner_payout >= 0),
  fee bigint not null check (fee >= 0),
  ledger_ids jsonb not null,
  reason text not null,
  audit_hash text not null check (audit_hash ~ '^[0-9a-f]{64}$'),
  settled_at timestamptz not null default now(),
  foreign key (room_id, winner_participant_id)
    references battle.participants(room_id, id),
  check (
    (result = 'winner' and winner_participant_id is not null and winner_payout > 0 and fee > 0)
    or (result in ('draw', 'void') and winner_participant_id is null and winner_payout = 0 and fee = 0)
  )
);

create table battle.summaries (
  participant_id uuid primary key,
  room_id uuid not null references battle.rooms(id),
  user_id uuid not null references identity.users(id),
  opponent_display_name text not null,
  result text not null check (result in ('win', 'loss', 'draw', 'void')),
  entry_fee bigint not null,
  payout bigint not null check (payout >= 0),
  net_change bigint not null,
  fee bigint not null check (fee >= 0),
  reason text not null,
  finished_at timestamptz not null,
  unique (room_id, user_id),
  foreign key (room_id, participant_id) references battle.participants(room_id, id)
);

create table battle.outbox (
  id uuid primary key default extensions.gen_random_uuid(),
  event_id uuid not null unique default extensions.gen_random_uuid(),
  room_id uuid not null references battle.rooms(id),
  state_version bigint not null check (state_version > 0),
  event_kind text not null,
  status text not null default 'pending' check (status in ('pending', 'leased', 'published')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (room_id, state_version, event_kind),
  check (
    (status = 'pending' and lease_owner is null and lease_expires_at is null and published_at is null)
    or (status = 'leased' and lease_owner is not null and lease_expires_at is not null and published_at is null)
    or (status = 'published' and published_at is not null
      and lease_owner is null and lease_expires_at is null)
  )
);

create index battle_outbox_due_idx on battle.outbox (next_attempt_at, created_at)
where status in ('pending', 'leased') and published_at is null;

create table battle.rate_limit_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references identity.users(id),
  action text not null check (action in (
    'create', 'matchmake', 'invite_preview', 'accept', 'combat_action', 'heartbeat', 'realtime_token', 'share'
  )),
  invite_hash text,
  attempted_at timestamptz not null default now(),
  check (invite_hash is null or invite_hash ~ '^[0-9a-f]{64}$')
);

create index battle_rate_limit_user_action_time_idx
on battle.rate_limit_attempts (user_id, action, attempted_at desc);

create or replace function battle.reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'immutable Battle data cannot be changed';
end;
$$;

create or replace function battle.reject_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'permanent Battle data cannot be deleted';
end;
$$;

create trigger battle_rulesets_immutable before update or delete on battle.rulesets
for each row execute function battle.reject_mutation();
create trigger battle_entry_tiers_immutable before update or delete on battle.entry_tiers
for each row execute function battle.reject_mutation();
create trigger battle_rarity_factors_immutable before update or delete on battle.rarity_factors
for each row execute function battle.reject_mutation();
create trigger battle_type_matchups_immutable before update or delete on battle.type_matchups
for each row execute function battle.reject_mutation();
create trigger battle_skill_slots_immutable before update or delete on battle.skill_slots
for each row execute function battle.reject_mutation();
create trigger battle_skills_immutable before update or delete on battle.skills
for each row execute function battle.reject_mutation();
create trigger battle_role_profiles_immutable before update or delete on battle.role_profiles
for each row execute function battle.reject_mutation();
create trigger battle_profile_loadouts_immutable before update or delete on battle.profile_loadouts
for each row execute function battle.reject_mutation();
create trigger battle_chain_configs_immutable before update or delete on battle.chain_configs
for each row execute function battle.reject_mutation();
create trigger battle_template_configs_immutable before update or delete on battle.template_configs
for each row execute function battle.reject_mutation();
create trigger battle_events_immutable before update or delete on battle.events
for each row execute function battle.reject_mutation();
create trigger battle_audit_entries_immutable before update or delete on battle.audit_entries
for each row execute function battle.reject_mutation();
create trigger battle_settlements_immutable before update or delete on battle.settlements
for each row execute function battle.reject_mutation();
create trigger battle_summaries_immutable before update or delete on battle.summaries
for each row execute function battle.reject_mutation();
create trigger battle_rooms_no_delete before delete on battle.rooms
for each row execute function battle.reject_delete();
create trigger battle_participants_no_delete before delete on battle.participants
for each row execute function battle.reject_delete();
create trigger battle_team_members_no_delete before delete on battle.team_members
for each row execute function battle.reject_delete();
create trigger battle_stakes_no_delete before delete on battle.stakes
for each row execute function battle.reject_delete();
create trigger battle_turns_no_delete before delete on battle.turns
for each row execute function battle.reject_delete();
create trigger battle_actions_no_delete before delete on battle.actions
for each row execute function battle.reject_delete();
create trigger battle_audit_heads_no_delete before delete on battle.audit_heads
for each row execute function battle.reject_delete();

create or replace function battle.rules_complete(p_ruleset_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    exists (
      select 1 from battle.rulesets r
      where r.id = p_ruleset_id and r.status = 'active'
    )
    and (select count(*) = 3 from battle.entry_tiers where ruleset_id = p_ruleset_id)
    and (select count(*) = 5 from battle.rarity_factors where ruleset_id = p_ruleset_id)
    and (select count(*) = 25 from battle.type_matchups where ruleset_id = p_ruleset_id)
    and (select count(*) = 10 from battle.skill_slots where ruleset_id = p_ruleset_id)
    and (select count(*) = 50 from battle.skills where ruleset_id = p_ruleset_id)
    and (select count(*) = 14 from battle.role_profiles where ruleset_id = p_ruleset_id)
    and (select count(*) = 56 from battle.profile_loadouts where ruleset_id = p_ruleset_id)
    and (select count(*) = 70 from battle.chain_configs where ruleset_id = p_ruleset_id)
    and (select count(*) = 210 from battle.template_configs where ruleset_id = p_ruleset_id)
    and (select count(*) = 70 from battle.template_configs where ruleset_id = p_ruleset_id and stage = 1)
    and (select count(*) = 70 from battle.template_configs where ruleset_id = p_ruleset_id and stage = 2)
    and (select count(*) = 70 from battle.template_configs where ruleset_id = p_ruleset_id and stage = 3)
    and (
      select coalesce(sum(num_nonnulls(skill_1_id, skill_2_id, skill_3_id, skill_4_id)), 0) = 630
      from battle.template_configs
      where ruleset_id = p_ruleset_id
    )
    and (
      select coalesce(sum(num_nonnulls(
        skill_1_power, skill_2_power, skill_3_power, skill_4_power
      )), 0) = 630
      from battle.template_configs
      where ruleset_id = p_ruleset_id
    )
    and not exists (
      select 1
      from battle.template_configs bc
      join catalog.templates ct on ct.id = bc.template_id
      left join battle.chain_configs cc
        on cc.ruleset_id = bc.ruleset_id and cc.chain_id = bc.chain_id
      where bc.ruleset_id = p_ruleset_id
        and (
          bc.chain_id <> ct.chain_id
          or bc.stage <> ct.stage
          or bc.rarity <> ct.rarity
          or cc.chain_id is null
          or bc.element <> cc.element
          or bc.profile_id <> cc.profile_id
          or num_nonnulls(
            bc.skill_1_id, bc.skill_2_id, bc.skill_3_id, bc.skill_4_id
          ) <> bc.stage + 1
          or num_nonnulls(
            bc.skill_1_power, bc.skill_2_power, bc.skill_3_power, bc.skill_4_power
          ) <> bc.stage + 1
          or (bc.skill_3_id is null and bc.skill_4_id is not null)
          or (
            select count(*) <> count(distinct skill.skill_id)
            from unnest(array[
              bc.skill_1_id, bc.skill_2_id, bc.skill_3_id, bc.skill_4_id
            ]) skill(skill_id)
            where skill.skill_id is not null
          )
        )
    )
    and not exists (
      select 1
      from battle.role_profiles rp
      where rp.ruleset_id = p_ruleset_id
        and (
          select count(*) <> 4
          from battle.profile_loadouts pl
          where pl.ruleset_id = rp.ruleset_id and pl.loadout_id = rp.loadout_id
        )
    )
    and not exists (
      select 1
      from battle.profile_loadouts current_loadout
      join battle.profile_loadouts next_loadout
        on next_loadout.ruleset_id = current_loadout.ruleset_id
       and next_loadout.loadout_id = current_loadout.loadout_id
       and next_loadout.position = current_loadout.position + 1
      join battle.skill_slots current_slot
        on current_slot.ruleset_id = current_loadout.ruleset_id
       and current_slot.id = current_loadout.slot_id
      join battle.skill_slots next_slot
        on next_slot.ruleset_id = next_loadout.ruleset_id
       and next_slot.id = next_loadout.slot_id
      where current_loadout.ruleset_id = p_ruleset_id
        and current_slot.power > next_slot.power
    )
    and not exists (
      select 1
      from battle.template_configs bc
      join battle.role_profiles rp
        on rp.ruleset_id = bc.ruleset_id and rp.id = bc.profile_id
      join battle.profile_loadouts pl
        on pl.ruleset_id = rp.ruleset_id
       and pl.loadout_id = rp.loadout_id
       and pl.position <= bc.stage + 1
      left join battle.skills expected_skill
        on expected_skill.ruleset_id = bc.ruleset_id
       and expected_skill.element = bc.element
       and expected_skill.slot_id = pl.slot_id
      left join battle.skill_slots expected_slot
        on expected_slot.ruleset_id = expected_skill.ruleset_id
       and expected_slot.id = expected_skill.slot_id
      where bc.ruleset_id = p_ruleset_id
        and (
          expected_skill.id is null
          or case pl.position
            when 1 then bc.skill_1_id
            when 2 then bc.skill_2_id
            when 3 then bc.skill_3_id
            when 4 then bc.skill_4_id
          end is distinct from expected_skill.id
          or case pl.position
            when 1 then bc.skill_1_power
            when 2 then bc.skill_2_power
            when 3 then bc.skill_3_power
            when 4 then bc.skill_4_power
          end < expected_slot.power
        )
    )
    and not exists (
      select 1
      from battle.template_configs lower_stage
      join battle.template_configs higher_stage
        on higher_stage.ruleset_id = lower_stage.ruleset_id
       and higher_stage.chain_id = lower_stage.chain_id
       and higher_stage.stage = lower_stage.stage + 1
      where lower_stage.ruleset_id = p_ruleset_id
        and (
          lower_stage.skill_1_power is distinct from higher_stage.skill_1_power
          or lower_stage.skill_2_power is distinct from higher_stage.skill_2_power
          or (
            lower_stage.stage >= 2
            and lower_stage.skill_3_power is distinct from higher_stage.skill_3_power
          )
        )
    )
    and not exists (
      select 1
      from battle.template_configs lower_rarity
      join battle.template_configs higher_rarity
        on higher_rarity.ruleset_id = lower_rarity.ruleset_id
       and higher_rarity.stage = lower_rarity.stage
       and catalog.rarity_rank(higher_rarity.rarity)
         = catalog.rarity_rank(lower_rarity.rarity) + 1
      cross join lateral (values
        (1, lower_rarity.skill_1_power),
        (2, lower_rarity.skill_2_power),
        (3, lower_rarity.skill_3_power),
        (4, lower_rarity.skill_4_power)
      ) lower_skill(position, power)
      cross join lateral (values
        (1, higher_rarity.skill_1_power),
        (2, higher_rarity.skill_2_power),
        (3, higher_rarity.skill_3_power),
        (4, higher_rarity.skill_4_power)
      ) higher_skill(position, power)
      where lower_rarity.ruleset_id = p_ruleset_id
        and lower_skill.position = higher_skill.position
        and lower_skill.position <= lower_rarity.stage + 1
        and higher_skill.power <= lower_skill.power
    )
$$;

create or replace function battle.rule_int(p_ruleset_id text, p_key text)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_value integer;
begin
  select (r.parameters->>p_key)::integer into v_value
  from battle.rulesets r
  where r.id = p_ruleset_id;
  if v_value is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'ruleset_parameter_missing',
        'ruleset_id', p_ruleset_id,
        'parameter', p_key
      )::text;
  end if;
  return v_value;
end;
$$;

create or replace function battle.retry_interval(p_room_id uuid, p_attempt integer)
returns interval
language plpgsql
stable
set search_path = ''
as $$
declare
  v_seconds integer;
begin
  select coalesce(
    (
      r.parameters->'outbox_retry_seconds'
        ->> (least(greatest(p_attempt, 1), 5) - 1)
    )::integer,
    30
  ) into v_seconds
  from battle.rooms room
  join battle.rulesets r on r.id = room.ruleset_id
  where room.id = p_room_id;
  if v_seconds is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT';
  end if;
  return make_interval(secs => v_seconds);
end;
$$;

create or replace function battle.consume_rate_limit(
  p_user_id uuid,
  p_action text,
  p_invite_hash text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
  v_ruleset_id text;
  v_window integer;
  v_retention integer;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  v_window := battle.rule_int(v_ruleset_id, 'rate_limit_window_seconds');
  v_retention := battle.rule_int(v_ruleset_id, 'rate_limit_retention_seconds');
  v_limit := case p_action
    when 'create' then 3
    when 'matchmake' then 6
    when 'invite_preview' then 60
    when 'accept' then 10
    when 'combat_action' then 30
    when 'heartbeat' then 30
    when 'realtime_token' then 10
    when 'share' then 10
    else null
  end;
  if v_limit is null or (p_invite_hash is not null and p_invite_hash !~ '^[0-9a-f]{64}$') then
    perform api.raise_business_error('REQUEST_INVALID', 'Battle 限流参数无效');
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('battle-rate:' || p_user_id::text || ':' || p_action, 0)
  );
  delete from battle.rate_limit_attempts
  where attempted_at < now() - make_interval(secs => v_retention);
  select count(*) into v_count
  from battle.rate_limit_attempts
  where user_id = p_user_id
    and action = p_action
    and attempted_at >= now() - make_interval(secs => v_window);
  if v_count >= v_limit then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;
  insert into battle.rate_limit_attempts (user_id, action, invite_hash)
  values (p_user_id, p_action, p_invite_hash);
end;
$$;

create or replace function battle.append_audit(
  p_room_id uuid,
  p_kind text,
  p_payload jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head battle.audit_heads%rowtype;
  v_sequence bigint;
  v_hash text;
  v_created_at timestamptz := clock_timestamp();
begin
  insert into battle.audit_heads (room_id) values (p_room_id)
  on conflict (room_id) do nothing;
  select * into v_head from battle.audit_heads where room_id = p_room_id for update;
  v_sequence := v_head.last_sequence + 1;
  v_hash := encode(
    extensions.digest(
      convert_to(
        v_head.last_hash || jsonb_build_object(
          'room_id', p_room_id,
          'sequence', v_sequence,
          'kind', p_kind,
          'payload', coalesce(p_payload, '{}'::jsonb),
          'created_at', v_created_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  insert into battle.audit_entries (
    room_id, sequence, kind, payload, prior_hash, entry_hash, created_at
  ) values (
    p_room_id, v_sequence, p_kind, coalesce(p_payload, '{}'::jsonb),
    v_head.last_hash, v_hash, v_created_at
  );
  update battle.audit_heads
  set last_sequence = v_sequence, last_hash = v_hash, updated_at = v_created_at
  where room_id = p_room_id;
  return v_hash;
end;
$$;

create or replace function battle.wake_integration(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
begin
  if p_kind not in ('outbox', 'share') then return null; end if;
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = case p_kind
    when 'outbox' then 'battle_outbox_callback_url'
    else 'battle_share_callback_url'
  end
  order by created_at desc
  limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'battle_outbox_secret'
  order by created_at desc
  limit 1;
  if v_url is null or v_url !~ '^https://'
     or v_secret is null or length(v_secret) < 32 then
    return null;
  end if;
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('wake', true, 'kind', p_kind),
    timeout_milliseconds := 2000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function battle.record_event(
  p_room_id uuid,
  p_kind text,
  p_public_payload jsonb,
  p_audit_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state_version bigint;
  v_sequence bigint;
  v_state_hash text;
begin
  update battle.rooms
  set state_version = state_version + 1, updated_at = now()
  where id = p_room_id
  returning state_version into v_state_version;
  if v_state_version is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'room_missing', 'room_id', p_room_id)::text;
  end if;
  select coalesce(max(sequence), 0) + 1 into v_sequence
  from battle.events
  where room_id = p_room_id;
  if p_kind = 'action_resolved' then
    update battle.rooms
    set latest_action_sequence = v_sequence
    where id = p_room_id;
  end if;
  v_state_hash := battle.room_snapshot_hash(p_room_id);
  insert into battle.events (
    room_id, sequence, state_version, state_hash, kind, public_payload, private_payload
  ) values (
    p_room_id, v_sequence, v_state_version, v_state_hash, p_kind,
    coalesce(p_public_payload, '{}'::jsonb),
    coalesce(p_audit_payload, '{}'::jsonb)
  );
  perform battle.append_audit(
    p_room_id, p_kind,
    coalesce(p_audit_payload, '{}'::jsonb)
      || jsonb_build_object('state_version', v_state_version, 'state_hash', v_state_hash)
  );
  insert into battle.outbox (room_id, state_version, event_kind)
  values (p_room_id, v_state_version, p_kind)
  on conflict (room_id, state_version, event_kind) do nothing;
  perform battle.wake_integration('outbox');
  return v_state_version;
end;
$$;

create or replace function battle.room_snapshot_hash(p_room_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'room_id', r.id,
          'status', r.status,
          'state_version', r.state_version,
          'first_actor_side', r.first_actor_side,
          'active_actor_side', r.active_actor_side,
          'current_round_no', r.current_round_no,
          'current_action_ordinal', r.current_action_ordinal,
          'latest_action_sequence', r.latest_action_sequence,
          'seed_commitment', r.seed_commitment,
          'accepted_at', r.accepted_at,
          'lobby_expires_at', r.lobby_expires_at,
          'lobby_start_deadline', r.lobby_start_deadline,
          'phase_deadline', r.phase_deadline,
          'presence', coalesce((
            select jsonb_agg(jsonb_build_object(
              'participant_id', p.id,
              'side', p.side,
              'offline_since', p.offline_since,
              'presence_deadline', p.presence_deadline
            ) order by p.side)
            from battle.participants p
            where p.room_id = r.id
          ), '[]'::jsonb),
          'teams', coalesce((
            select jsonb_agg(jsonb_build_object(
              'participant_id', tm.participant_id,
              'slot', tm.slot,
              'current_hp', tm.current_hp,
              'alive', tm.alive,
              'active', tm.active
            ) order by p.side, tm.slot)
            from battle.participants p
            join battle.team_members tm on tm.participant_id = p.id
            where p.room_id = r.id
          ), '[]'::jsonb),
          'actions', coalesce((
            select jsonb_agg(jsonb_build_object(
              'round_no', a.round_no,
              'action_ordinal', a.action_ordinal,
              'participant_id', a.participant_id,
              'kind', a.kind,
              'source', a.source,
              'skill_id', a.skill_id,
              'target_slot', a.target_slot
            ) order by a.round_no, a.action_ordinal)
            from battle.actions a
            where a.room_id = r.id
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from battle.rooms r
  where r.id = p_room_id
$$;

create or replace function battle.skill_for_position(
  p_member battle.team_members,
  p_position integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_position
    when 1 then p_member.skill_1_id
    when 2 then p_member.skill_2_id
    when 3 then p_member.skill_3_id
    when 4 then p_member.skill_4_id
  end
$$;

create or replace function battle.skill_power_for_position(
  p_member battle.team_members,
  p_position integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_position
    when 1 then p_member.skill_1_power
    when 2 then p_member.skill_2_power
    when 3 then p_member.skill_3_power
    when 4 then p_member.skill_4_power
  end
$$;

create or replace function battle.hit_roll(
  p_private_seed bytea,
  p_room_id uuid,
  p_round_no integer,
  p_actor_side text,
  p_action_ordinal integer,
  p_skill_id text,
  p_modulus integer
)
returns integer
language sql
immutable
set search_path = ''
as $$
  with digest_value as (
    select extensions.hmac(
      convert_to(
        p_room_id::text || '|' || p_round_no::text || '|' || p_actor_side || '|'
        || p_action_ordinal::text || '|' || p_skill_id,
        'UTF8'
      ),
      p_private_seed,
      'sha256'
    ) value
  )
  select (
    (
      (get_byte(value, 0)::bigint << 24)
      + (get_byte(value, 1)::bigint << 16)
      + (get_byte(value, 2)::bigint << 8)
      + get_byte(value, 3)::bigint
    ) % p_modulus
  )::integer
  from digest_value
$$;

create or replace function battle.attack_result(
  p_room battle.rooms,
  p_round_no integer,
  p_side text,
  p_action battle.actions,
  p_attacker battle.team_members,
  p_defender battle.team_members
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_slot battle.skill_slots%rowtype;
  v_skill battle.skills%rowtype;
  v_power integer;
  v_multiplier integer;
  v_roll integer;
  v_raw bigint;
  v_cap bigint;
  v_damage bigint;
  v_applied bigint;
begin
  select s.* into v_skill
  from battle.skills s
  where s.ruleset_id = p_room.ruleset_id and s.id = p_action.skill_id;
  select ss.* into v_slot
  from battle.skill_slots ss
  where ss.ruleset_id = p_room.ruleset_id and ss.id = v_skill.slot_id;
  v_power := battle.skill_power_for_position(p_attacker, p_action.skill_position);
  select multiplier_bps into v_multiplier
  from battle.type_matchups
  where ruleset_id = p_room.ruleset_id
    and attacker = p_attacker.element
    and defender = p_defender.element;
  if v_slot.id is null or v_power is null or v_multiplier is null then
    raise exception using errcode = 'P0001', message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object('kind', 'attack_config_missing', 'action_id', p_action.id)::text;
  end if;
  v_roll := battle.hit_roll(
    p_room.private_seed, p_room.id, p_round_no, p_side,
    p_action.action_ordinal, p_action.skill_id,
    battle.rule_int(p_room.ruleset_id, 'random_modulus')
  );
  if v_roll < v_slot.accuracy_bps then
    v_raw := (
      2::bigint * v_power::bigint * p_attacker.attack::bigint
      * p_attacker.attack::bigint * v_multiplier::bigint
    ) / (
      (p_attacker.attack::bigint + p_defender.defense::bigint) * 100::bigint * 10000::bigint
    );
    v_cap := greatest(
      1,
      p_defender.max_hp::bigint
        * battle.rule_int(p_room.ruleset_id, 'single_hit_cap_bps')
        / 10000
    );
    v_damage := least(v_cap, greatest(1, v_raw));
    v_applied := least(p_defender.current_hp::bigint, v_damage);
  else
    v_raw := 0;
    v_cap := greatest(
      1,
      p_defender.max_hp::bigint
        * battle.rule_int(p_room.ruleset_id, 'single_hit_cap_bps')
        / 10000
    );
    v_damage := 0;
    v_applied := 0;
  end if;
  return jsonb_build_object(
    'actor_side', p_side,
    'attacker_member_id', p_attacker.id,
    'defender_member_id', p_defender.id,
    'skill_id', v_skill.id,
    'skill_name', v_skill.name,
    'effect_key', v_skill.effect_key,
    'power', v_power,
    'accuracy_bps', v_slot.accuracy_bps,
    'roll', v_roll,
    'hit', v_roll < v_slot.accuracy_bps,
    'multiplier_bps', v_multiplier,
    'raw_damage', v_raw,
    'damage', v_damage,
    'applied_damage', v_applied,
    'defender_current_hp', p_defender.current_hp,
    'defender_max_hp', p_defender.max_hp
  );
end;
$$;

create or replace function battle.rarity_summary(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rarity', rarity,
    'count', quantity
  ) order by rarity_order), '[]'::jsonb)
  from (
    select
      tm.rarity,
      count(*)::integer quantity,
      catalog.rarity_rank(tm.rarity) rarity_order
    from battle.participants p
    join battle.team_members tm on tm.participant_id = p.id
    where p.room_id = p_room_id and p.side = 'creator'
    group by tm.rarity
  ) values_by_rarity
$$;

create or replace function battle.challenge_card_json(p_room_id uuid)
returns jsonb
language sql
volatile
set search_path = ''
as $$
  select jsonb_build_object(
    'creator_display_name', btrim(concat_ws(' ', u.first_name, u.last_name)),
    'entry_fee', tier.entry_fee,
    'rarity_summary', battle.rarity_summary(r.id),
    'expires_at', r.expires_at,
    'server_time', clock_timestamp(),
    'creator_online', r.status = 'waiting'
      and p.offline_since is null
      and p.last_heartbeat_at > now() - make_interval(
        secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
      )
  )
  from battle.rooms r
  join identity.users u on u.id = r.creator_user_id
  join battle.participants p on p.room_id = r.id and p.side = 'creator'
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id
  where r.id = p_room_id
$$;

create or replace function battle.lobby_json(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when r.status not in ('lobby_waiting', 'lobby_countdown') then null
    else jsonb_build_object(
      'phase', r.status,
      'expires_at', r.lobby_expires_at,
      'start_deadline', r.lobby_start_deadline,
      'presence', jsonb_build_object(
        'creator', jsonb_build_object(
          'online',
            creator.offline_since is null
            and creator.last_heartbeat_at > now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ),
          'reconnect_deadline', case
            when creator.offline_since is not null then creator.presence_deadline
            when creator.last_heartbeat_at <= now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ) then creator.last_heartbeat_at + make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
                    + battle.rule_int(r.ruleset_id, 'offline_reconnect_seconds')
            )
            else null
          end
        ),
        'opponent', jsonb_build_object(
          'online',
            opponent.offline_since is null
            and opponent.last_heartbeat_at > now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ),
          'reconnect_deadline', case
            when opponent.offline_since is not null then opponent.presence_deadline
            when opponent.last_heartbeat_at <= now() - make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
            ) then opponent.last_heartbeat_at + make_interval(
              secs => battle.rule_int(r.ruleset_id, 'presence_online_window_seconds')
                    + battle.rule_int(r.ruleset_id, 'offline_reconnect_seconds')
            )
            else null
          end
        )
      )
    )
  end
  from battle.rooms r
  join battle.participants creator
    on creator.room_id = r.id and creator.side = 'creator'
  join battle.participants opponent
    on opponent.room_id = r.id and opponent.side = 'opponent'
  where r.id = p_room_id
$$;

create or replace function battle.skill_json(
  p_ruleset_id text,
  p_skill_id text,
  p_position integer,
  p_power integer
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'position', p_position,
    'skill_id', s.id,
    'name', s.name,
    'power', p_power,
    'accuracy_bps', ss.accuracy_bps,
    'effect_key', s.effect_key
  )
  from battle.skills s
  join battle.skill_slots ss
    on ss.ruleset_id = s.ruleset_id and ss.id = s.slot_id
  where s.ruleset_id = p_ruleset_id and s.id = p_skill_id and p_power > 0
$$;

create or replace function battle.skills_json(
  p_ruleset_id text,
  p_skill_ids text[],
  p_skill_powers integer[]
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      battle.skill_json(
        p_ruleset_id, skill.skill_id, skill.position::integer, skill.power
      )
      order by skill.position
    ),
    '[]'::jsonb
  )
  from unnest(p_skill_ids, p_skill_powers)
    with ordinality skill(skill_id, power, position)
  join battle.skills s
    on s.ruleset_id = p_ruleset_id and s.id = skill.skill_id
  join battle.skill_slots ss
    on ss.ruleset_id = s.ruleset_id and ss.id = s.slot_id
  where skill.skill_id is not null and skill.power is not null
$$;

create or replace function battle.self_team_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'template_id', tm.template_id,
    'name', tm.template_name,
    'image_thumbnail_url', catalog.template_thumbnail_url(tm.template_id),
    'image_detail_url', catalog.template_detail_url(tm.template_id),
    'rarity', tm.rarity,
    'stage', tm.stage,
    'element', tm.element,
    'current_hp', tm.current_hp,
    'max_hp', tm.max_hp,
    'attack', tm.attack,
    'defense', tm.defense,
    'speed', tm.speed,
    'alive', tm.alive,
    'active', tm.active,
    'skills', battle.skills_json(
      r.ruleset_id,
      array[tm.skill_1_id, tm.skill_2_id, tm.skill_3_id, tm.skill_4_id],
      array[
        tm.skill_1_power, tm.skill_2_power, tm.skill_3_power, tm.skill_4_power
      ]
    )
  ) order by tm.slot), '[]'::jsonb)
  from battle.team_members tm
  join battle.participants p on p.id = tm.participant_id
  join battle.rooms r on r.id = p.room_id
  where p.room_id = p_room_id and p.id = p_participant_id
$$;

create or replace function battle.opponent_team_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', tm.slot,
    'name', tm.template_name,
    'image_thumbnail_url', catalog.template_thumbnail_url(tm.template_id),
    'image_detail_url', catalog.template_detail_url(tm.template_id),
    'rarity', tm.rarity,
    'stage', tm.stage,
    'hp_percent', round(tm.current_hp::numeric * 100 / tm.max_hp::numeric, 2),
    'alive', tm.alive,
    'active', tm.active
  ) order by tm.slot), '[]'::jsonb)
  from battle.team_members tm
  join battle.participants p on p.id = tm.participant_id
  where p.room_id = p_room_id and p.id <> p_participant_id
$$;

create or replace function battle.action_event_json(
  p_event_id uuid,
  p_participant_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event battle.events%rowtype;
  v_self_side text;
  v_actions jsonb;
  v_self_hp jsonb;
  v_opponent_hp jsonb;
begin
  select * into v_event
  from battle.events
  where id = p_event_id and kind = 'action_resolved';
  select side into v_self_side
  from battle.participants
  where id = p_participant_id and room_id = v_event.room_id;
  if v_event.id is null or v_self_side is null then return null; end if;

  select coalesce(jsonb_agg(
    case
      when action->>'kind' = 'attack'
        and action->>'actor_side' = v_self_side
      then jsonb_build_object(
        'actor', 'self',
        'kind', 'attack',
        'skill_name', action->>'skill_name',
        'effect_key', action->>'effect_key',
        'hit', (action->>'hit')::boolean,
        'effectiveness', case (action->>'multiplier_bps')::integer
          when 15000 then 'super_effective'
          when 7500 then 'not_effective'
          else 'normal'
        end,
        'target_hp_percent_before', round(
          (action->>'target_hp_before')::numeric * 100
            / (action->>'target_max_hp')::numeric,
          2
        ),
        'target_hp_percent_after', round(
          (action->>'target_hp_after')::numeric * 100
            / (action->>'target_max_hp')::numeric,
          2
        ),
        'knockout', (action->>'knockout')::boolean
      )
      when action->>'kind' = 'attack'
      then jsonb_build_object(
        'actor', 'opponent',
        'kind', 'attack',
        'skill_name', action->>'skill_name',
        'effect_key', action->>'effect_key',
        'hit', (action->>'hit')::boolean,
        'effectiveness', case (action->>'multiplier_bps')::integer
          when 15000 then 'super_effective'
          when 7500 then 'not_effective'
          else 'normal'
        end,
        'target_current_hp_before', (action->>'target_hp_before')::integer,
        'target_current_hp_after', (action->>'target_hp_after')::integer,
        'knockout', (action->>'knockout')::boolean
      )
      else jsonb_build_object(
        'actor', case
          when action->>'actor_side' = v_self_side then 'self'
          else 'opponent'
        end,
        'kind', 'switch',
        'switch_to', action->'switch_to'
      )
    end
    order by display_ordinal
  ), '[]'::jsonb) into v_actions
  from jsonb_array_elements(v_event.private_payload->'actions')
    with ordinality as displayed_actions(action, display_ordinal);

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', (team_member->>'slot')::smallint,
    'current_hp', (team_member->>'current_hp')::integer,
    'max_hp', (team_member->>'max_hp')::integer,
    'alive', (team_member->>'alive')::boolean
  ) order by (team_member->>'slot')::smallint), '[]'::jsonb)
  into v_self_hp
  from jsonb_array_elements(v_event.private_payload->'teams') team(team_member)
  where team_member->>'side' = v_self_side;

  select coalesce(jsonb_agg(jsonb_build_object(
    'slot', (team_member->>'slot')::smallint,
    'hp_percent', round(
      (team_member->>'current_hp')::numeric * 100
        / (team_member->>'max_hp')::numeric,
      2
    ),
    'alive', (team_member->>'alive')::boolean
  ) order by (team_member->>'slot')::smallint), '[]'::jsonb)
  into v_opponent_hp
  from jsonb_array_elements(v_event.private_payload->'teams') team(team_member)
  where team_member->>'side' <> v_self_side;

  return jsonb_build_object(
    'sequence', v_event.sequence,
    'event_id', v_event.id,
    'state_version', v_event.state_version,
    'round_no', (v_event.private_payload->>'round_no')::smallint,
    'action_ordinal', (v_event.private_payload->>'action_ordinal')::smallint,
    'actor', case
      when v_event.private_payload->>'actor_side' = v_self_side then 'self'
      else 'opponent'
    end,
    'actions', v_actions,
    'self_hp', v_self_hp,
    'opponent_hp', v_opponent_hp
  );
end;
$$;

create or replace function battle.action_events_json(
  p_room_id uuid,
  p_participant_id uuid,
  p_after_action_sequence bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_after_action_sequence is null then '[]'::jsonb
    else coalesce(jsonb_agg(
      battle.action_event_json(action_event.id, p_participant_id)
      order by action_event.sequence
    ), '[]'::jsonb)
  end
  from (
    select e.id, e.sequence
    from battle.events e
    where p_after_action_sequence is not null
      and e.room_id = p_room_id
      and e.kind = 'action_resolved'
      and e.sequence > p_after_action_sequence
    order by e.sequence
    limit 16
  ) action_event
$$;

create or replace function battle.has_more_action_events(
  p_room_id uuid,
  p_after_action_sequence bigint
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_after_action_sequence is not null and count(*) > 16
  from battle.events e
  where e.room_id = p_room_id
    and e.kind = 'action_resolved'
    and e.sequence > coalesce(p_after_action_sequence, 9223372036854775807)
$$;

create or replace function battle.participation_json(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room_id', p.room_id,
    'participant_id', p.id,
    'side', p.side,
    'room_mode', r.room_mode,
    'status', r.status,
    'state_version', r.state_version,
    'entry_fee', tier.entry_fee,
    'expires_at', coalesce(r.lobby_expires_at, r.expires_at),
    'phase_deadline', r.phase_deadline
  )
  from battle.participants p
  join battle.rooms r on r.id = p.room_id
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id
  where p.user_id = p_user_id
    and p.status in ('preparing_share', 'waiting', 'lobby', 'active')
  order by p.joined_at desc
  limit 1
$$;

create or replace function battle.terminal_result_json(
  p_room_id uuid,
  p_participant_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'room_id', s.room_id,
    'result', s.result,
    'opponent_display_name', s.opponent_display_name,
    'entry_fee', s.entry_fee,
    'payout', s.payout,
    'net_change', s.net_change,
    'fee', s.fee,
    'reason', s.reason,
    'finished_at', s.finished_at
  )
  from battle.summaries s
  where s.room_id = p_room_id
    and s.participant_id = p_participant_id
$$;

create or replace function battle.viewer_action_state(
  p_room_id uuid,
  p_participant_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p.status = 'active'
      and r.status = 'active_turn'
      and r.active_actor_side = p.side
      and r.phase_deadline > now()
      and exists (
        select 1
        from battle.team_members tm
        where tm.participant_id = p.id and tm.alive
      )
    then 'available'
    else 'not_applicable'
  end
  from battle.rooms r
  join battle.participants p
    on p.room_id = r.id and p.id = p_participant_id
  where r.id = p_room_id
$$;

create or replace function battle.room_snapshot_json(
  p_room_id uuid,
  p_participant_id uuid,
  p_after_action_sequence bigint default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_opponent_id uuid;
begin
  select * into v_room from battle.rooms where id = p_room_id;
  select * into v_participant
  from battle.participants
  where id = p_participant_id and room_id = p_room_id;
  if v_participant.id is null then return null; end if;
  select id into v_opponent_id
  from battle.participants
  where room_id = p_room_id and id <> p_participant_id;
  return jsonb_build_object(
    'room_id', v_room.id,
    'room_mode', v_room.room_mode,
    'status', v_room.status,
    'state_version', v_room.state_version,
    'side', v_participant.side,
    'round_no', v_room.current_round_no,
    'action_ordinal', v_room.current_action_ordinal,
    'first_actor', case
      when v_room.first_actor_side is null then null
      when v_room.first_actor_side = v_participant.side then 'self'
      else 'opponent'
    end,
    'active_actor', case
      when v_room.active_actor_side is null then null
      when v_room.active_actor_side = v_participant.side then 'self'
      else 'opponent'
    end,
    'active_action_mode', case
      when v_room.status = 'active_turn'
        and not exists (
          select 1
          from battle.participants active_participant
          join battle.team_members active_member
            on active_member.participant_id = active_participant.id
          where active_participant.room_id = v_room.id
            and active_participant.side = v_room.active_actor_side
            and active_member.active
        )
      then 'replace_attack'
      else 'normal'
    end,
    'phase_deadline', v_room.phase_deadline,
    'prepare_deadline', case
      when v_participant.side = 'creator' and v_room.status = 'preparing_share'
      then v_room.prepare_deadline
      else null
    end,
    'prepared_message_id', case
      when v_participant.side = 'creator'
        and v_room.room_mode = 'friend_invite'
        and v_room.status = 'waiting'
      then (
        select ps.prepared_message_id
        from battle.prepared_shares ps
        where ps.room_id = v_room.id and ps.status = 'active'
      )
      else null
    end,
    'presence_lifecycle', jsonb_build_object(
      'version', v_participant.presence_lifecycle_version,
      'lease_id', v_participant.presence_lease_id,
      'last_command_seq', v_participant.presence_command_seq,
      'active', v_participant.presence_lease_active
    ),
    'viewer_action_state',
      battle.viewer_action_state(p_room_id, p_participant_id),
    'server_time', clock_timestamp(),
    'lobby', battle.lobby_json(p_room_id),
    'self_team', battle.self_team_json(p_room_id, p_participant_id),
    'opponent_team', case
      when v_opponent_id is null
        or v_room.status in ('lobby_waiting', 'lobby_countdown')
      then '[]'::jsonb
      else battle.opponent_team_json(p_room_id, p_participant_id)
    end,
    'latest_action_sequence', v_room.latest_action_sequence,
    'action_events', battle.action_events_json(
      p_room_id, p_participant_id, p_after_action_sequence
    ),
    'has_more_action_events', battle.has_more_action_events(
      p_room_id, p_after_action_sequence
    ),
    'terminal_result', battle.terminal_result_json(p_room_id, p_participant_id)
  );
end;
$$;

create or replace function api.battle_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_participation jsonb := battle.participation_json(v_user_id);
  v_ruleset_id text;
begin
  select id into v_ruleset_id
  from battle.rulesets
  where status = 'active' and battle.rules_complete(id);
  if v_ruleset_id is null then
    perform api.raise_business_error(
      'BATTLE_RULESET_UNAVAILABLE',
      'Battle 规则暂不可用，请稍后重试'
    );
  end if;
  return jsonb_build_object(
    'ruleset', (
      select jsonb_build_object(
        'id', r.id,
        'checksum', r.checksum,
        'matchmaking_wait_seconds', (r.parameters->>'matchmaking_wait_seconds')::integer,
        'heartbeat_interval_seconds', (r.parameters->>'heartbeat_interval_seconds')::integer,
        'presence_online_window_seconds', (r.parameters->>'presence_online_window_seconds')::integer,
        'offline_reconnect_seconds', (r.parameters->>'offline_reconnect_seconds')::integer,
        'lobby_timeout_seconds', (r.parameters->>'lobby_timeout_seconds')::integer,
        'lobby_countdown_seconds', (r.parameters->>'lobby_countdown_seconds')::integer,
        'action_timeout_seconds', (r.parameters->>'action_timeout_seconds')::integer,
        'actions_per_round', (r.parameters->>'actions_per_round')::integer,
        'timeout_skill_position', (r.parameters->>'timeout_skill_position')::integer,
        'initiative_rule', r.parameters->>'initiative_rule',
        'max_normal_turns', (r.parameters->>'max_normal_turns')::integer
      )
      from battle.rulesets r where r.id = v_ruleset_id
    ),
    'entry_tiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'entry_fee', t.entry_fee,
        'pool', t.pool,
        'winner_payout', t.winner_payout,
        'fee', t.fee
      ) order by t.entry_fee)
      from battle.entry_tiers t
      where t.ruleset_id = v_ruleset_id
    ), '[]'::jsonb),
    'participation', v_participation,
    'room', case
      when v_participation is null then null
      else battle.room_snapshot_json(
        (v_participation->>'room_id')::uuid,
        (v_participation->>'participant_id')::uuid
      )
    end,
    'server_time', clock_timestamp()
  );
end;
$$;

create or replace function api.battle_team_options(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_ruleset_id text;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  if v_ruleset_id is null or not battle.rules_complete(v_ruleset_id) then
    perform api.raise_business_error('BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试');
  end if;
  return jsonb_build_object(
    'items', coalesce((
      with user_items as materialized (
        select item.*
        from inventory.item_read_model item
        where item.user_id = v_user_id and item.available > 0
      )
      select jsonb_agg(jsonb_build_object(
        'template_id', item.template_id,
        'name', item.name,
        'image_thumbnail_url', item.image_thumbnail_url,
        'image_detail_url', item.image_detail_url,
        'rarity', item.rarity,
        'stage', item.stage,
        'available_quantity', item.available,
        'element', bc.element,
        'max_hp', bc.max_hp,
        'attack', bc.attack,
        'defense', bc.defense,
        'speed', bc.speed,
        'skills', battle.skills_json(
          v_ruleset_id,
          array[bc.skill_1_id, bc.skill_2_id, bc.skill_3_id, bc.skill_4_id],
          array[
            bc.skill_1_power, bc.skill_2_power, bc.skill_3_power, bc.skill_4_power
          ]
        )
      ) order by item.sort_order)
      from user_items item
      join battle.template_configs bc
        on bc.ruleset_id = v_ruleset_id and bc.template_id = item.template_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function api.battle_current_invite(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_session identity.sessions%rowtype;
  v_room battle.rooms%rowtype;
  v_card jsonb;
begin
  select * into v_session from identity.sessions where id = p_session_id;
  if v_session.entry_kind <> 'battle' then
    return jsonb_build_object(
      'invite_status', 'none', 'server_time', clock_timestamp()
    );
  end if;
  perform battle.consume_rate_limit(v_user_id, 'invite_preview', v_session.battle_invite_token_hash);
  select * into v_room
  from battle.rooms
  where room_mode = 'friend_invite'
    and invite_token_hash = v_session.battle_invite_token_hash;
  if v_room.id is null then
    return jsonb_build_object(
      'invite_status', 'invalid', 'server_time', clock_timestamp()
    );
  end if;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided')
    and exists (
      select 1 from battle.participants
      where room_id = v_room.id and user_id = v_user_id
    )
  then
    return jsonb_build_object(
      'invite_status', 'none', 'server_time', clock_timestamp()
    );
  end if;
  v_card := battle.challenge_card_json(v_room.id);
  return jsonb_build_object(
    'room_id', v_room.id,
    'invite_status', case
      when v_room.status = 'waiting' and v_room.expires_at <= now() then 'expired'
      when v_room.status = 'waiting' and v_room.creator_user_id = v_user_id then 'self'
      when v_room.status = 'waiting' then 'available'
      when v_room.status in ('cancelled', 'expired', 'voided') then v_room.status
      else 'accepted'
    end,
    'remaining_seconds', greatest(
      0, floor(extract(epoch from (v_room.expires_at - now())))::integer
    )
  ) || v_card;
end;
$$;

create or replace function api.battle_room(
  p_session_id uuid,
  p_room_id uuid,
  p_after_action_sequence bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_participant_id uuid;
  v_result jsonb;
begin
  select id into v_participant_id
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id;
  if v_participant_id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if p_after_action_sequence is not null and p_after_action_sequence < 0 then
    perform api.raise_business_error('REQUEST_INVALID', '动作事件游标无效');
  end if;
  v_result := battle.room_snapshot_json(
    p_room_id, v_participant_id, p_after_action_sequence
  );
  if v_result is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.battle_realtime_context(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_session identity.sessions%rowtype;
  v_participation jsonb;
  v_invite_hash text;
begin
  perform battle.consume_rate_limit(v_user_id, 'realtime_token');
  select * into v_session from identity.sessions where id = p_session_id;
  v_participation := battle.participation_json(v_user_id);
  select r.invite_token_hash into v_invite_hash
  from battle.rooms r
  where v_session.entry_kind = 'battle'
    and v_session.battle_invite_token_hash is not null
    and r.room_mode = 'friend_invite'
    and r.invite_token_hash = v_session.battle_invite_token_hash
    and r.status = 'waiting'
    and r.expires_at > now();
  return jsonb_build_object(
    'user_id', v_user_id,
    'user_channel', 'battle:user:' || v_user_id::text,
    'room_channel', case when v_participation is null then null else
      'battle:room:' || (v_participation->>'room_id') end,
    'invite_channel', case
      when v_invite_hash is not null
      then 'battle:invite:' || v_invite_hash
      else null
    end
  );
end;
$$;

create or replace function battle.validate_team_selection(
  p_user_id uuid,
  p_ruleset_id text,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_distinct integer;
  v_total integer;
begin
  if p_template_ids is null or jsonb_typeof(p_template_ids) <> 'array' then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if jsonb_array_length(p_template_ids) <> 3
     or exists (
       select 1
       from jsonb_array_elements(p_template_ids) item
       where jsonb_typeof(item) <> 'string'
     ) then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  select count(distinct value), count(*) into v_distinct, v_total
  from jsonb_array_elements_text(p_template_ids);
  if v_total <> 3 then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if v_distinct <> 3 then
    perform api.raise_business_error(
      'BATTLE_TEAM_TEMPLATE_DUPLICATE',
      'Battle 队伍中的藏品模板不能重复'
    );
  end if;
  if (
    select count(*) <> 3
    from jsonb_array_elements_text(p_template_ids) selected(template_id)
    join catalog.templates template on template.id = selected.template_id
    join battle.template_configs config
      on config.ruleset_id = p_ruleset_id
     and config.template_id = selected.template_id
  ) then
    perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(p_template_ids) selected(template_id)
    where inventory.available_quantity(p_user_id, selected.template_id) < 1
  ) then
    perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品数量不足');
  end if;
  return p_template_ids;
end;
$$;

create or replace function battle.create_team(
  p_participant_id uuid,
  p_user_id uuid,
  p_ruleset_id text,
  p_template_ids jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_template catalog.templates%rowtype;
  v_config battle.template_configs%rowtype;
begin
  perform battle.validate_team_selection(
    p_user_id, p_ruleset_id, p_template_ids
  );
  perform 1
  from inventory.holdings h
  join (
    select value template_id
    from jsonb_array_elements_text(p_template_ids)
  ) selected on selected.template_id = h.template_id
  where h.user_id = p_user_id
  order by h.template_id
  for update of h;
  for v_item in
    select value template_id, ordinality::smallint slot
    from jsonb_array_elements_text(p_template_ids) with ordinality
    order by ordinality
  loop
    select * into v_template from catalog.templates where id = v_item.template_id;
    select * into v_config
    from battle.template_configs
    where ruleset_id = p_ruleset_id and template_id = v_item.template_id;
    if v_template.id is null or v_config.template_id is null then
      perform api.raise_business_error('BATTLE_TEAM_INVALID', '请选择三个可用且不同的藏品');
    end if;
    if inventory.available_quantity(p_user_id, v_item.template_id) < 1 then
      perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品数量不足');
    end if;
    insert into battle.team_members (
      participant_id, slot, template_id, template_name,
      rarity, stage, element,
      max_hp, current_hp, attack, defense, speed,
      skill_1_id, skill_1_power, skill_2_id, skill_2_power,
      skill_3_id, skill_3_power, skill_4_id, skill_4_power,
      alive, active
    ) values (
      p_participant_id, v_item.slot, v_template.id, v_template.name,
      v_template.rarity, v_template.stage, v_config.element,
      v_config.max_hp, v_config.max_hp, v_config.attack, v_config.defense, v_config.speed,
      v_config.skill_1_id, v_config.skill_1_power,
      v_config.skill_2_id, v_config.skill_2_power,
      v_config.skill_3_id, v_config.skill_3_power,
      v_config.skill_4_id, v_config.skill_4_power,
      true, v_item.slot = 1
    );
    perform inventory.reserve(
      p_user_id, v_item.template_id, 1, 'battle', p_participant_id
    );
  end loop;
end;
$$;

create or replace function battle.refund_locked_stakes(
  p_room_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stake battle.stakes%rowtype;
  v_balance jsonb;
  v_ledger_ids jsonb := '[]'::jsonb;
begin
  perform 1
  from economy.balances b
  join battle.stakes s
    on s.user_id = b.user_id and s.room_id = p_room_id and s.status = 'locked'
  where b.currency = 'KCOIN'
  order by b.user_id
  for update of b;
  for v_stake in
    select * from battle.stakes
    where room_id = p_room_id and status = 'locked'
    order by user_id
    for update
  loop
    v_balance := economy.refund_battle_kcoin(
      v_stake.user_id,
      v_stake.amount,
      (
        select join_operation_id
        from battle.participants
        where id = v_stake.participant_id
      ),
      p_room_id::text || ':' || v_stake.user_id::text || ':' || p_reason
    );
    update battle.stakes
    set status = 'refunded',
        refund_ledger_id = (v_balance->>'ledger_id')::bigint,
        settled_at = now()
    where id = v_stake.id;
    v_ledger_ids := v_ledger_ids || jsonb_build_array((v_balance->>'ledger_id')::bigint);
  end loop;
  return v_ledger_ids;
end;
$$;

create or replace function battle.release_reservations(p_room_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update inventory.reservations r
  set status = 'released', released_at = now()
  where r.kind = 'battle'
    and r.status = 'active'
    and exists (
      select 1
      from battle.participants p
      where p.room_id = p_room_id and p.id = r.reference_id
    )
$$;

create or replace function battle.close_unstarted_room(
  p_room_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_ledgers jsonb;
begin
  if p_status not in ('cancelled', 'expired', 'voided') then
    raise exception 'invalid unstarted Battle terminal status';
  end if;
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status in ('cancelled', 'expired', 'voided') then
    return jsonb_build_object('room_id', v_room.id, 'status', v_room.status);
  end if;
  if v_room.status not in (
    'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown'
  ) then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  v_ledgers := battle.refund_locked_stakes(p_room_id, p_reason);
  perform battle.release_reservations(p_room_id);
  update battle.participants
  set status = p_status, finished_at = now()
  where room_id = p_room_id
    and status in ('preparing_share', 'waiting', 'lobby');
  update battle.rooms
  set status = p_status, finished_at = now(), phase_deadline = null,
      lobby_start_deadline = null, updated_at = now()
  where id = p_room_id;
  perform battle.record_event(
    p_room_id,
    p_status,
    jsonb_build_object('reason', p_reason),
    jsonb_build_object('reason', p_reason, 'refund_ledger_ids', v_ledgers)
  );
  return jsonb_build_object('room_id', p_room_id, 'status', p_status, 'reason', p_reason);
end;
$$;

create or replace function battle.lobby_terminal_reason(p_room_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when r.status = 'lobby_waiting'
      and r.lobby_expires_at <= now() then 'lobby_expired'
    when r.status = 'lobby_waiting'
      and exists (
      select 1
      from battle.participants p
      join identity.users u on u.id = p.user_id
      where p.room_id = r.id and p.status = 'lobby' and u.status = 'banned'
    ) then 'lobby_participant_banned'
    when r.status = 'lobby_waiting'
      and exists (
      select 1
      from battle.participants p
      where p.room_id = r.id
        and p.status = 'lobby'
        and (
          p.presence_deadline <= now()
          or (
            p.offline_since is null
            and p.last_heartbeat_at + make_interval(
              secs => battle.rule_int(
                r.ruleset_id, 'presence_online_window_seconds'
              ) + battle.rule_int(
                r.ruleset_id, 'offline_reconnect_seconds'
              )
            ) <= now()
          )
        )
    ) then 'lobby_presence_timeout'
    else null
  end
  from battle.rooms r
  where r.id = p_room_id
    and r.status in ('lobby_waiting', 'lobby_countdown')
$$;

create or replace function battle.lobby_invariant_error(p_room_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_tier battle.entry_tiers%rowtype;
begin
  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.id is null
    or v_room.status not in ('lobby_waiting', 'lobby_countdown')
  then
    return null;
  end if;

  if not exists (
    select 1
    from battle.rulesets r
    where r.id = v_room.ruleset_id
      and r.checksum = v_room.ruleset_checksum
      and battle.rules_complete(r.id)
  ) then
    return 'lobby_ruleset_invalid';
  end if;
  select * into v_tier
  from battle.entry_tiers
  where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
  if v_tier.id is null then
    return 'lobby_entry_tier_invalid';
  end if;
  if v_room.waiting_started_at is null
    or v_room.expires_at is null
    or (
      v_room.room_mode = 'friend_invite'
      and v_room.expires_at is distinct from (
        v_room.waiting_started_at + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'waiting_timeout_seconds')
        )
      )
    )
    or (
      v_room.room_mode = 'public_match'
      and v_room.expires_at is distinct from (
        v_room.waiting_started_at + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'matchmaking_wait_seconds')
        )
      )
    )
    or v_room.accepted_at is null
    or v_room.accepted_at < v_room.waiting_started_at
    or v_room.accepted_at >= v_room.expires_at
    or v_room.lobby_expires_at is distinct from (
      v_room.accepted_at + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'lobby_timeout_seconds')
      )
    )
    or v_room.current_round_no <> 0
    or v_room.current_action_ordinal <> 0
    or v_room.first_actor_side is not null
    or v_room.active_actor_side is not null
    or v_room.latest_action_sequence <> 0
    or v_room.private_seed is null
    or octet_length(v_room.private_seed) <> 32
    or v_room.seed_commitment is distinct from encode(
      extensions.digest(v_room.private_seed, 'sha256'), 'hex'
    )
    or v_room.phase_deadline is not null
    or v_room.finished_at is not null
    or (
      v_room.status = 'lobby_waiting'
      and v_room.lobby_start_deadline is not null
    )
    or (
      v_room.status = 'lobby_countdown'
      and (
        v_room.lobby_start_deadline is null
        or v_room.lobby_start_deadline > v_room.lobby_expires_at
      )
    )
    or (
      v_room.room_mode = 'friend_invite'
      and not exists (
        select 1
        from battle.prepared_shares ps
        where ps.room_id = p_room_id
          and ps.status = 'active'
          and ps.activated_at = v_room.waiting_started_at
          and ps.telegram_expires_at >= v_room.expires_at
      )
    )
    or (
      v_room.room_mode = 'public_match'
      and exists (
        select 1
        from battle.prepared_shares ps
        where ps.room_id = p_room_id
      )
    )
    or exists (select 1 from battle.turns where room_id = p_room_id)
    or exists (select 1 from battle.actions where room_id = p_room_id)
    or exists (select 1 from battle.settlements where room_id = p_room_id)
    or exists (select 1 from battle.summaries where room_id = p_room_id)
  then
    return 'lobby_room_startup_invalid';
  end if;

  if (
    select not (
      count(*) = 2
      and count(*) filter (where p.side = 'creator') = 1
      and count(*) filter (where p.side = 'opponent') = 1
      and count(*) filter (
        where p.side = 'creator' and p.user_id = v_room.creator_user_id
      ) = 1
      and count(*) filter (
        where p.side = 'opponent' and p.user_id <> v_room.creator_user_id
      ) = 1
      and count(*) filter (where p.status = 'lobby') = 2
    )
    from battle.participants p
    where p.room_id = p_room_id
  ) then
    return 'lobby_participants_invalid';
  end if;

  if (select count(*) from battle.stakes where room_id = p_room_id) <> 2
    or exists (
      select 1
      from battle.participants p
      left join battle.stakes s
        on s.room_id = p.room_id and s.participant_id = p.id
      left join economy.ledger l on l.id = s.lock_ledger_id
      where p.room_id = p_room_id
        and (
          s.id is null
          or s.user_id <> p.user_id
          or s.amount <> v_tier.entry_fee
          or s.status <> 'locked'
          or l.id is null
          or l.operation_id is distinct from p.join_operation_id
          or l.user_id is distinct from p.user_id
          or l.currency is distinct from 'KCOIN'
          or l.amount is distinct from -v_tier.entry_fee
          or l.reason is distinct from 'battle_stake_lock'
          or l.reference is distinct from (
            p_room_id::text || ':' || p.user_id::text || ':lock'
          )
        )
    )
  then
    return 'lobby_stakes_invalid';
  end if;

  if exists (
    select 1
    from battle.participants p
    left join battle.team_members tm on tm.participant_id = p.id
    left join catalog.templates t on t.id = tm.template_id
    left join battle.template_configs c
      on c.ruleset_id = v_room.ruleset_id and c.template_id = tm.template_id
    where p.room_id = p_room_id
    group by p.id
    having count(tm.id) <> 3
      or count(tm.id) filter (where tm.active) <> 1
      or count(tm.id) filter (where tm.slot = 1 and tm.active) <> 1
      or count(tm.id) filter (
        where t.id is null
          or c.template_id is null
          or tm.template_name is distinct from t.name
          or tm.rarity is distinct from t.rarity
          or tm.rarity is distinct from c.rarity
          or tm.stage is distinct from t.stage
          or tm.stage is distinct from c.stage
          or c.chain_id is distinct from t.chain_id
          or tm.element is distinct from c.element
          or tm.max_hp is distinct from c.max_hp
          or tm.current_hp is distinct from c.max_hp
          or tm.attack is distinct from c.attack
          or tm.defense is distinct from c.defense
          or tm.speed is distinct from c.speed
          or tm.skill_1_id is distinct from c.skill_1_id
          or tm.skill_1_power is distinct from c.skill_1_power
          or tm.skill_2_id is distinct from c.skill_2_id
          or tm.skill_2_power is distinct from c.skill_2_power
          or tm.skill_3_id is distinct from c.skill_3_id
          or tm.skill_3_power is distinct from c.skill_3_power
          or tm.skill_4_id is distinct from c.skill_4_id
          or tm.skill_4_power is distinct from c.skill_4_power
          or not tm.alive
          or tm.active is distinct from (tm.slot = 1)
      ) > 0
  ) then
    return 'lobby_team_snapshots_invalid';
  end if;

  if (
    select count(*)
    from inventory.reservations r
    join battle.participants p on p.id = r.reference_id
    where p.room_id = p_room_id
      and r.kind = 'battle'
      and r.status = 'active'
  ) <> 6
    or exists (
      select 1
      from battle.participants p
      join battle.team_members tm on tm.participant_id = p.id
      left join inventory.reservations r
        on r.kind = 'battle'
       and r.reference_id = p.id
       and r.template_id = tm.template_id
       and r.status = 'active'
      where p.room_id = p_room_id
        and (
          r.id is null
          or r.user_id <> p.user_id
          or r.quantity <> 1
        )
    )
  then
    return 'lobby_reservations_invalid';
  end if;
  return null;
end;
$$;

create or replace function battle.reconcile_lobby_presence(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_offline_since timestamptz;
  v_both_online boolean;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  for v_participant in
    select *
    from battle.participants
    where room_id = p_room_id
      and status = 'lobby'
      and offline_since is null
      and last_heartbeat_at <= now() - make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
      )
    order by side
    for update
  loop
    v_offline_since := v_participant.last_heartbeat_at + make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
    );
    update battle.participants
    set offline_since = v_offline_since,
        presence_deadline = v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
    where id = v_participant.id;
    perform battle.record_event(
      p_room_id,
      'participant_offline',
      jsonb_build_object(
        'side', v_participant.side,
        'reconnect_deadline', v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
      ),
      jsonb_build_object(
        'participant_id', v_participant.id,
        'offline_since', v_offline_since
      )
    );
  end loop;

  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.status = 'lobby_countdown' then return; end if;

  select count(*) = 2
    and bool_and(
      p.offline_since is null
      and p.last_heartbeat_at > now() - make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'presence_online_window_seconds')
      )
    )
  into v_both_online
  from battle.participants p
  where p.room_id = p_room_id and p.status = 'lobby';

  if v_room.status = 'lobby_waiting'
    and v_both_online
    and battle.lobby_terminal_reason(p_room_id) is null
    and now() + make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'lobby_countdown_seconds')
    ) <= v_room.lobby_expires_at
  then
    update battle.rooms
    set status = 'lobby_countdown',
        lobby_start_deadline = now() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'lobby_countdown_seconds')
        ),
        updated_at = now()
    where id = p_room_id
    returning * into v_room;
    perform battle.record_event(
      p_room_id,
      'lobby_countdown_started',
      jsonb_build_object('start_deadline', v_room.lobby_start_deadline),
      '{}'::jsonb
    );
  end if;
end;
$$;

create or replace function battle.advance_lobby(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_reason text;
  v_invariant_error text;
  v_creator battle.participants%rowtype;
  v_opponent battle.participants%rowtype;
  v_creator_lead battle.team_members%rowtype;
  v_opponent_lead battle.team_members%rowtype;
  v_first_actor_side text;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  v_invariant_error := battle.lobby_invariant_error(p_room_id);
  if v_invariant_error is not null then
    perform battle.void_room_after_invariant(
      p_room_id, 'lobby_startup:' || v_invariant_error
    );
    return;
  end if;

  v_reason := battle.lobby_terminal_reason(p_room_id);
  if v_reason is not null then
    perform battle.close_unstarted_room(p_room_id, 'cancelled', v_reason);
    return;
  end if;

  perform battle.reconcile_lobby_presence(p_room_id);
  select * into v_room from battle.rooms where id = p_room_id;
  if v_room.status not in ('lobby_waiting', 'lobby_countdown') then return; end if;

  v_reason := battle.lobby_terminal_reason(p_room_id);
  if v_reason is not null then
    perform battle.close_unstarted_room(p_room_id, 'cancelled', v_reason);
    return;
  end if;
  if v_room.status <> 'lobby_countdown'
    or v_room.lobby_start_deadline > now()
  then
    return;
  end if;

  v_invariant_error := battle.lobby_invariant_error(p_room_id);
  if v_invariant_error is not null then
    perform battle.void_room_after_invariant(
      p_room_id, 'lobby_startup:' || v_invariant_error
    );
    return;
  end if;

  update battle.participants
  set status = 'active'
  where room_id = p_room_id and status = 'lobby';

  select * into v_creator
  from battle.participants
  where room_id = p_room_id and side = 'creator';
  select * into v_opponent
  from battle.participants
  where room_id = p_room_id and side = 'opponent';
  select * into v_creator_lead
  from battle.team_members
  where participant_id = v_creator.id and slot = 1 and active and alive;
  select * into v_opponent_lead
  from battle.team_members
  where participant_id = v_opponent.id and slot = 1 and active and alive;
  if v_creator_lead.id is null or v_opponent_lead.id is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'opening_lead_missing',
        'room_id', p_room_id
      )::text;
  end if;
  v_first_actor_side := case
    when v_opponent_lead.speed > v_creator_lead.speed then 'opponent'
    else 'creator'
  end;

  update battle.rooms
  set status = 'active_turn',
      first_actor_side = v_first_actor_side,
      active_actor_side = v_first_actor_side,
      current_round_no = 1,
      current_action_ordinal = 1,
      lobby_start_deadline = null,
      phase_deadline = clock_timestamp() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
      ),
      updated_at = clock_timestamp()
  where id = p_room_id
  returning * into v_room;
  insert into battle.turns (
    room_id, round_no, start_snapshot_hash
  ) values (
    p_room_id, 1, battle.room_snapshot_hash(p_room_id)
  );
  perform battle.record_event(
    p_room_id,
    'battle_started',
    jsonb_build_object(
      'round_no', 1,
      'action_ordinal', 1,
      'first_actor_side', v_first_actor_side,
      'active_actor_side', v_first_actor_side,
      'deadline', v_room.phase_deadline,
      'seed_commitment', v_room.seed_commitment
    ),
    jsonb_build_object(
      'ruleset_checksum', v_room.ruleset_checksum,
      'creator_lead_speed', v_creator_lead.speed,
      'opponent_lead_speed', v_opponent_lead.speed,
      'initiative_rule', 'opening_speed_creator_tie'
    )
  );
end;
$$;

create or replace function api.battle_prepare_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid,
  p_invite_token_hash text,
  p_entry_tier_id text,
  p_template_ids jsonb
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
  v_ruleset battle.rulesets%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_participant_id uuid;
  v_balance jsonb;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id,
    'battle.create',
    p_operation_id,
    jsonb_build_object('entry_tier_id', p_entry_tier_id, 'template_ids', p_template_ids)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_room_id is null or p_invite_token_hash !~ '^[0-9a-f]{64}$' then
      perform api.raise_business_error('REQUEST_INVALID', 'Battle 创建参数无效');
    end if;
    perform battle.consume_rate_limit(v_user_id, 'create');
    perform pg_advisory_xact_lock(hashtextextended('battle-user:' || v_user_id::text, 0));
    if exists (
      select 1 from battle.participants
      where user_id = v_user_id and status = 'preparing_share'
    ) then
      perform api.raise_business_error(
        'BATTLE_SHARE_PREPARING',
        '挑战卡正在准备，请勿重复创建'
      );
    elsif exists (
      select 1 from battle.participants
      where user_id = v_user_id and status in ('waiting', 'active')
    ) then
      perform api.raise_business_error('BATTLE_ALREADY_PARTICIPATING', '当前已有未结束的 Battle');
    end if;
    select * into v_ruleset from battle.rulesets where status = 'active';
    if v_ruleset.id is null or not battle.rules_complete(v_ruleset.id) then
      perform api.raise_business_error('BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试');
    end if;
    select * into v_tier
    from battle.entry_tiers
    where ruleset_id = v_ruleset.id and id = p_entry_tier_id;
    if v_tier.id is null then
      perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
    end if;
    insert into battle.rooms (
      id, creator_user_id, create_operation_id, ruleset_id, ruleset_checksum,
      entry_tier_id, room_mode, invite_token_hash, status, prepare_deadline
    ) values (
      p_room_id, v_user_id, p_operation_id, v_ruleset.id, v_ruleset.checksum,
      v_tier.id, 'friend_invite', p_invite_token_hash, 'preparing_share',
      now() + make_interval(
        secs => battle.rule_int(v_ruleset.id, 'share_prepare_timeout_seconds')
      )
    );
    insert into battle.prepared_shares (room_id) values (p_room_id);
    insert into battle.participants (
      room_id, user_id, side, status, join_operation_id
    ) values (
      p_room_id, v_user_id, 'creator', 'preparing_share', p_operation_id
    ) returning id into v_participant_id;
    perform battle.create_team(
      v_participant_id, v_user_id, v_ruleset.id, p_template_ids
    );
    v_balance := economy.lock_kcoin(
      v_user_id, v_tier.entry_fee, p_operation_id,
      p_room_id::text || ':' || v_user_id::text || ':lock'
    );
    insert into battle.stakes (
      room_id, participant_id, user_id, amount, lock_ledger_id
    ) values (
      p_room_id, v_participant_id, v_user_id, v_tier.entry_fee,
      (v_balance->>'ledger_id')::bigint
    );
    perform battle.record_event(
      p_room_id,
      'room_prepared',
      '{}'::jsonb,
      jsonb_build_object(
        'creator_user_id', v_user_id,
        'participant_id', v_participant_id,
        'ruleset_id', v_ruleset.id,
        'ruleset_checksum', v_ruleset.checksum,
        'entry_tier_id', v_tier.id,
        'template_ids', p_template_ids,
        'stake_lock_ledger_id', (v_balance->>'ledger_id')::bigint
      )
    );
    perform battle.wake_integration('share');
    v_result := jsonb_build_object(
      'room_id', p_room_id,
      'status', 'preparing_share',
      'create_operation_id', p_operation_id,
      'prepare_deadline', (
        select prepare_deadline from battle.rooms where id = p_room_id
      )
    );
    return operations.pending_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ALREADY_PARTICIPATING',
        jsonb_build_object('error_code', 'BATTLE_ALREADY_PARTICIPATING')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function api.battle_activate_share(
  p_room_id uuid,
  p_prepared_message_id text,
  p_telegram_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status = 'waiting' then
    return (select operations.operation_json(o) from operations.operations o where o.id = v_room.create_operation_id);
  end if;
  if v_room.status <> 'preparing_share'
    or p_prepared_message_id is null
    or btrim(p_prepared_message_id) = ''
    or p_prepared_message_id <> btrim(p_prepared_message_id)
    or char_length(p_prepared_message_id) > 256
    or p_telegram_expires_at is null
    or p_telegram_expires_at < now() + make_interval(
      secs => battle.rule_int(v_room.ruleset_id, 'waiting_timeout_seconds')
    )
    or now() >= v_room.prepare_deadline
  then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  update battle.prepared_shares
  set status = 'active', prepared_message_id = p_prepared_message_id,
      telegram_expires_at = p_telegram_expires_at, activated_at = now(),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where room_id = p_room_id;
  update battle.rooms
  set status = 'waiting',
      waiting_started_at = now(),
      expires_at = now() + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'waiting_timeout_seconds')
      ),
      updated_at = now()
  where id = p_room_id
  returning * into v_room;
  update battle.participants
  set status = 'waiting',
      last_heartbeat_at = now(),
      offline_since = null,
      presence_deadline = null
  where room_id = p_room_id and side = 'creator';
  perform battle.record_event(
    p_room_id, 'share_activated',
    jsonb_build_object('expires_at', v_room.expires_at),
    jsonb_build_object(
      'prepared_message_id', p_prepared_message_id,
      'telegram_expires_at', p_telegram_expires_at,
      'expires_at', v_room.expires_at
    )
  );
  v_result := jsonb_build_object(
    'room_id', p_room_id,
    'status', 'waiting',
    'prepared_message_id', p_prepared_message_id,
    'expires_at', v_room.expires_at
  );
  return operations.complete_command(v_room.create_operation_id, v_result);
end;
$$;

create or replace function api.battle_abort_share(
  p_room_id uuid,
  p_error text default 'BATTLE_SHARE_FAILED'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  end if;
  if v_room.status = 'voided' then
    return (select operations.operation_json(o) from operations.operations o where o.id = v_room.create_operation_id);
  end if;
  if v_room.status <> 'preparing_share' then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;
  update battle.prepared_shares
  set status = 'failed',
      last_error = case
        when coalesce(p_error, '') ~ '^[A-Z0-9_]{1,100}$' then p_error
        else 'BATTLE_SHARE_FAILED'
      end,
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where room_id = p_room_id;
  v_result := battle.close_unstarted_room(p_room_id, 'voided', 'share_failed');
  return operations.fail_command(
    v_room.create_operation_id,
    'BATTLE_SHARE_FAILED',
    v_result || jsonb_build_object('error_code', 'BATTLE_SHARE_FAILED')
  );
end;
$$;

create or replace function api.battle_cancel_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_room battle.rooms%rowtype;
  v_result jsonb;
begin
  v_operation := operations.begin_command(
    p_session_id, 'battle.cancel', p_operation_id, jsonb_build_object('room_id', p_room_id)
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_room from battle.rooms where id = p_room_id for update;
    if v_room.id is null or v_room.creator_user_id <> v_operation.user_id then
      perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
    end if;
    if v_room.status = 'expired' then
      perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
    elsif v_room.status = 'cancelled' then
      perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    elsif v_room.status not in ('preparing_share', 'waiting') then
      perform api.raise_business_error('BATTLE_ROOM_ALREADY_ACCEPTED', '挑战已被其他玩家接受');
    end if;
    v_result := battle.close_unstarted_room(
      p_room_id,
      'cancelled',
      case
        when v_room.room_mode = 'public_match' then 'match_cancelled'
        else 'creator_cancelled'
      end
    );
    return operations.complete_command(p_operation_id, v_result);
  exception when sqlstate 'P0001' then
    if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
    return operations.fail_command(
      p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
    );
  end;
end;
$$;

create or replace function api.battle_heartbeat(
  p_session_id uuid,
  p_room_id uuid,
  p_presence_lease_id uuid,
  p_presence_lifecycle_version bigint,
  p_presence_command_seq bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_now timestamptz := now();
  v_was_online boolean;
  v_is_new_lifecycle boolean;
begin
  if p_presence_lease_id is null
    or p_presence_lifecycle_version is null
    or p_presence_lifecycle_version < 1
    or p_presence_command_seq is null
    or p_presence_command_seq < 1
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Presence 命令无效');
  end if;
  select * into v_room from battle.rooms where id = p_room_id for update;
  select * into v_participant
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id
  for update;
  if v_room.id is null or v_participant.id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided') then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status = 'waiting' and v_participant.side <> 'creator' then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  elsif v_room.status not in ('waiting', 'lobby_waiting', 'lobby_countdown') then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;

  v_is_new_lifecycle :=
    p_presence_lifecycle_version = v_participant.presence_lifecycle_version + 1
    and p_presence_command_seq = 1;
  if not v_is_new_lifecycle
    and not (
      p_presence_lifecycle_version = v_participant.presence_lifecycle_version
      and p_presence_lease_id = v_participant.presence_lease_id
      and v_participant.presence_lease_active
      and p_presence_command_seq > v_participant.presence_command_seq
    )
  then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  end if;

  perform battle.consume_rate_limit(v_user_id, 'heartbeat');
  if v_room.status = 'waiting' then
    if v_room.expires_at <= v_now then
      perform battle.close_unstarted_room(
        p_room_id,
        'expired',
        case
          when v_room.room_mode = 'public_match' then 'match_timeout'
          else 'waiting_expired'
        end
      );
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
  else
    perform battle.advance_lobby(p_room_id);
    select * into v_room from battle.rooms where id = p_room_id;
    if v_room.status not in ('lobby_waiting', 'lobby_countdown') then
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
    select * into v_participant
    from battle.participants
    where id = v_participant.id
    for update;
  end if;

  v_was_online := coalesce(
    v_participant.offline_since is null
      and v_participant.last_heartbeat_at > v_now - make_interval(
        secs => battle.rule_int(
          v_room.ruleset_id, 'presence_online_window_seconds'
        )
      ),
    false
  );
  update battle.participants
  set last_heartbeat_at = greatest(
        coalesce(last_heartbeat_at, '-infinity'::timestamptz), v_now
      ),
      offline_since = null,
      presence_deadline = null,
      presence_lifecycle_version = p_presence_lifecycle_version,
      presence_lease_id = p_presence_lease_id,
      presence_command_seq = p_presence_command_seq,
      presence_lease_active = true
  where id = v_participant.id
  returning * into v_participant;
  if not v_was_online then
    perform battle.record_event(
      p_room_id,
      'participant_online',
      jsonb_build_object('side', v_participant.side),
      jsonb_build_object('participant_id', v_participant.id)
    );
  end if;
  if v_room.status in ('lobby_waiting', 'lobby_countdown') then
    perform battle.advance_lobby(p_room_id);
  end if;
  return battle.room_snapshot_json(p_room_id, v_participant.id);
end;
$$;

create or replace function api.battle_mark_offline(
  p_session_id uuid,
  p_room_id uuid,
  p_presence_lease_id uuid,
  p_presence_lifecycle_version bigint,
  p_presence_command_seq bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_offline_since timestamptz;
  v_terminal_reason text;
  v_invariant_error text;
  v_is_new_lifecycle boolean;
begin
  if p_presence_lease_id is null
    or p_presence_lifecycle_version is null
    or p_presence_lifecycle_version < 1
    or p_presence_command_seq is null
    or p_presence_command_seq < 1
  then
    perform api.raise_business_error('REQUEST_INVALID', 'Presence 命令无效');
  end if;
  select * into v_room from battle.rooms where id = p_room_id for update;
  select * into v_participant
  from battle.participants
  where room_id = p_room_id and user_id = v_user_id
  for update;
  if v_room.id is null or v_participant.id is null then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  end if;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided') then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status = 'waiting' and v_participant.side <> 'creator' then
    perform api.raise_business_error('BATTLE_NOT_PARTICIPANT', '当前账号不是该 Battle 的参与者');
  elsif v_room.status not in ('waiting', 'lobby_waiting', 'lobby_countdown') then
    perform api.raise_business_error('BATTLE_STATE_CONFLICT', 'Battle 状态已更新');
  end if;

  v_is_new_lifecycle :=
    p_presence_lifecycle_version = v_participant.presence_lifecycle_version + 1;
  if not v_is_new_lifecycle
    and not (
      p_presence_lifecycle_version = v_participant.presence_lifecycle_version
      and p_presence_lease_id = v_participant.presence_lease_id
      and v_participant.presence_lease_active
      and p_presence_command_seq > v_participant.presence_command_seq
    )
  then
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  end if;

  perform battle.consume_rate_limit(v_user_id, 'heartbeat');
  if v_room.status = 'waiting' and v_room.expires_at <= now() then
    perform battle.close_unstarted_room(
      p_room_id,
      'expired',
      case
        when v_room.room_mode = 'public_match' then 'match_timeout'
        else 'waiting_expired'
      end
    );
    return battle.room_snapshot_json(p_room_id, v_participant.id);
  elsif v_room.status in ('lobby_waiting', 'lobby_countdown') then
    v_invariant_error := battle.lobby_invariant_error(p_room_id);
    if v_invariant_error is not null then
      perform battle.void_room_after_invariant(
        p_room_id, 'lobby_presence:' || v_invariant_error
      );
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
    v_terminal_reason := battle.lobby_terminal_reason(p_room_id);
    if v_terminal_reason is not null then
      perform battle.close_unstarted_room(
        p_room_id, 'cancelled', v_terminal_reason
      );
      return battle.room_snapshot_json(p_room_id, v_participant.id);
    end if;
  end if;

  update battle.participants
  set presence_lifecycle_version = p_presence_lifecycle_version,
      presence_lease_id = p_presence_lease_id,
      presence_command_seq = p_presence_command_seq,
      presence_lease_active = false
  where id = v_participant.id
  returning * into v_participant;
  if v_participant.offline_since is null then
    v_offline_since := now();
    update battle.participants
    set offline_since = v_offline_since,
        presence_deadline = v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
    where id = v_participant.id;
    perform battle.record_event(
      p_room_id, 'participant_offline',
      jsonb_build_object(
        'side', v_participant.side,
        'reconnect_deadline',
        v_offline_since + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'offline_reconnect_seconds')
        )
      ),
      jsonb_build_object(
        'participant_id', v_participant.id,
        'offline_since', v_offline_since
      )
    );
  end if;
  if v_room.status in ('lobby_waiting', 'lobby_countdown') then
    perform battle.advance_lobby(p_room_id);
  end if;
  return battle.room_snapshot_json(p_room_id, v_participant.id);
end;
$$;

create or replace function battle.attach_opponent_and_start_lobby(
  p_room_id uuid,
  p_user_id uuid,
  p_operation_id uuid,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_creator identity.users%rowtype;
  v_creator_participant battle.participants%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_participant_id uuid := extensions.gen_random_uuid();
  v_seed bytea := extensions.gen_random_bytes(32);
  v_ledger_id bigint;
  v_result jsonb;
  v_creator_online boolean;
  v_start_countdown boolean;
  v_now timestamptz := now();
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.id is null then
    perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
  elsif v_room.creator_user_id = p_user_id then
    perform api.raise_business_error(
      'BATTLE_SELF_ACCEPT_FORBIDDEN', '不能接受自己创建的挑战'
    );
  elsif v_room.status = 'expired' or v_room.expires_at <= v_now then
    perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
  elsif v_room.status = 'cancelled' then
    perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
  elsif v_room.status = 'voided' then
    perform api.raise_business_error(
      'BATTLE_VOIDED', 'Battle 已安全作废，入场费和藏品已恢复'
    );
  elsif v_room.status <> 'waiting' then
    perform api.raise_business_error(
      'BATTLE_ROOM_ALREADY_ACCEPTED', '挑战已被其他玩家接受'
    );
  end if;
  select * into v_creator
  from identity.users
  where id = v_room.creator_user_id
  for update;
  if v_creator.status = 'banned' then
    perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
  end if;
  select * into v_creator_participant
  from battle.participants
  where room_id = v_room.id and side = 'creator'
  for update;
  if v_creator_participant.id is null or v_creator_participant.status <> 'waiting' then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'waiting_creator_missing', 'room_id', v_room.id
      )::text;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('battle-user:' || p_user_id::text, 0)
  );
  if exists (
    select 1 from battle.participants p
    where p.user_id = p_user_id
      and p.status in ('preparing_share', 'waiting', 'lobby', 'active')
  ) then
    perform api.raise_business_error(
      'BATTLE_ALREADY_PARTICIPATING', '当前已有进行中的 Battle'
    );
  end if;
  select * into v_tier
  from battle.entry_tiers
  where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
  if v_tier.id is null then
    perform api.raise_business_error(
      'BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试'
    );
  end if;
  insert into battle.participants (
    id, room_id, user_id, side, status, join_operation_id, last_heartbeat_at
  ) values (
    v_participant_id, v_room.id, p_user_id, 'opponent', 'lobby',
    p_operation_id, v_now
  );
  perform battle.create_team(
    v_participant_id, p_user_id, v_room.ruleset_id, p_template_ids
  );
  v_ledger_id := (
    economy.lock_kcoin(
      p_user_id, v_tier.entry_fee, p_operation_id,
      v_room.id::text || ':' || p_user_id::text || ':lock'
    )->>'ledger_id'
  )::bigint;
  insert into battle.stakes (
    room_id, participant_id, user_id, amount, lock_ledger_id
  ) values (
    v_room.id, v_participant_id, p_user_id, v_tier.entry_fee, v_ledger_id
  );
  v_creator_online := v_creator_participant.offline_since is null
    and v_creator_participant.last_heartbeat_at > v_now - make_interval(
      secs => battle.rule_int(
        v_room.ruleset_id, 'presence_online_window_seconds'
      )
    );
  v_start_countdown := v_room.room_mode = 'public_match' or v_creator_online;
  update battle.participants
  set status = 'lobby',
      offline_since = case when v_creator_online then null else v_now end,
      presence_deadline = case
        when v_creator_online then null
        else v_now + make_interval(
          secs => battle.rule_int(
            v_room.ruleset_id, 'offline_reconnect_seconds'
          )
        )
      end
  where id = v_creator_participant.id;
  update battle.rooms
  set status = case
        when v_start_countdown then 'lobby_countdown'
        else 'lobby_waiting'
      end,
      private_seed = v_seed,
      seed_commitment = encode(extensions.digest(v_seed, 'sha256'), 'hex'),
      accepted_at = v_now,
      lobby_expires_at = v_now + make_interval(
        secs => battle.rule_int(v_room.ruleset_id, 'lobby_timeout_seconds')
      ),
      lobby_start_deadline = case
        when v_start_countdown then v_now + make_interval(
          secs => battle.rule_int(
            v_room.ruleset_id, 'lobby_countdown_seconds'
          )
        )
        else null
      end,
      current_round_no = 0,
      current_action_ordinal = 0,
      phase_deadline = null,
      updated_at = v_now
  where id = v_room.id
  returning * into v_room;
  perform battle.append_audit(
    v_room.id, 'seed_commitment',
    jsonb_build_object('commitment', v_room.seed_commitment)
  );
  perform battle.record_event(
    v_room.id, 'lobby_started',
    jsonb_build_object(
      'phase', v_room.status,
      'expires_at', v_room.lobby_expires_at,
      'start_deadline', v_room.lobby_start_deadline
    ),
    jsonb_build_object(
      'opponent_participant_id', v_participant_id,
      'ruleset_checksum', v_room.ruleset_checksum,
      'room_mode', v_room.room_mode
    )
  );
  if v_start_countdown then
    perform battle.record_event(
      v_room.id,
      'lobby_countdown_started',
      jsonb_build_object('start_deadline', v_room.lobby_start_deadline),
      '{}'::jsonb
    );
  end if;
  v_result := battle.room_snapshot_json(v_room.id, v_participant_id);
  if v_result is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'join_snapshot_missing',
        'room_id', v_room.id,
        'participant_id', v_participant_id
      )::text;
  end if;
  return v_result;
end;
$$;

create or replace function api.battle_accept_room(
  p_session_id uuid,
  p_operation_id uuid,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_invite_hash text;
  v_room battle.rooms%rowtype;
  v_creator identity.users%rowtype;
  v_result jsonb;
  v_terminal jsonb;
begin
  select s.battle_invite_token_hash into v_invite_hash
  from identity.sessions s
  where s.id = p_session_id and s.user_id = v_user_id
    and s.revoked_at is null and s.expires_at > now();
  select * into v_room
  from battle.rooms r
  where r.room_mode = 'friend_invite'
    and r.invite_token_hash = v_invite_hash;
  if v_room.status = 'waiting'
    and v_room.expires_at > now()
    and v_room.creator_user_id = v_user_id
  then
    perform api.raise_business_error(
      'BATTLE_SELF_ACCEPT_FORBIDDEN', '不能接受自己创建的挑战'
    );
  end if;
  v_operation := operations.begin_command(
    p_session_id,
    'battle.accept',
    p_operation_id,
    jsonb_build_object(
      'invite_token_hash', v_invite_hash,
      'template_ids', p_template_ids
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select s.battle_invite_token_hash into v_invite_hash
    from identity.sessions s
    where s.id = p_session_id and s.user_id = v_operation.user_id
      and s.revoked_at is null and s.expires_at > now()
    for update;
    if v_invite_hash is null then
      perform api.raise_business_error('BATTLE_INVITE_INVALID', 'Battle 邀请无效');
    end if;
    select * into v_room
    from battle.rooms r
    where r.room_mode = 'friend_invite'
      and r.invite_token_hash = v_invite_hash
    for update;
    if v_room.id is null then
      perform api.raise_business_error('BATTLE_INVITE_INVALID', 'Battle 邀请无效');
    end if;
    if v_room.creator_user_id = v_operation.user_id then
      perform api.raise_business_error(
        'BATTLE_SELF_ACCEPT_FORBIDDEN', '不能接受自己创建的挑战'
      );
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'accept', v_invite_hash);
    select * into v_creator
    from identity.users
    where id = v_room.creator_user_id
    for update;
    if v_room.status = 'expired' then
      perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
    elsif v_room.status = 'cancelled' then
      perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED', 'Battle 已安全作废，入场费和藏品已恢复'
      );
    elsif v_room.status <> 'waiting' then
      perform api.raise_business_error(
        'BATTLE_ROOM_ALREADY_ACCEPTED', '挑战已被其他玩家接受'
      );
    end if;
    if v_room.expires_at <= now() then
      v_terminal := battle.close_unstarted_room(
        v_room.id, 'expired', 'waiting_expired'
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ROOM_EXPIRED',
        v_terminal || jsonb_build_object('error_code', 'BATTLE_ROOM_EXPIRED')
      );
    elsif v_creator.status = 'banned' then
      v_terminal := battle.close_unstarted_room(
        v_room.id, 'cancelled', 'creator_banned'
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ROOM_CANCELLED',
        v_terminal || jsonb_build_object('error_code', 'BATTLE_ROOM_CANCELLED')
      );
    end if;
    v_result := battle.attach_opponent_and_start_lobby(
      v_room.id, v_operation.user_id, p_operation_id, p_template_ids
    );
    return operations.complete_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id,
        'BATTLE_STATE_CONFLICT',
        jsonb_build_object('error_code', 'BATTLE_STATE_CONFLICT')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function api.battle_matchmake(
  p_session_id uuid,
  p_operation_id uuid,
  p_new_room_id uuid,
  p_entry_tier_id text,
  p_template_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_ruleset battle.rulesets%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_room battle.rooms%rowtype;
  v_participant_id uuid;
  v_balance jsonb;
  v_result jsonb;
  v_now timestamptz := now();
begin
  v_operation := operations.begin_command(
    p_session_id,
    'battle.matchmake',
    p_operation_id,
    jsonb_build_object(
      'entry_tier_id', p_entry_tier_id,
      'template_ids', p_template_ids
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    if p_new_room_id is null then
      perform api.raise_business_error('REQUEST_INVALID', 'Battle 匹配参数无效');
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'matchmake');
    perform pg_advisory_xact_lock(
      hashtextextended('battle-user:' || v_operation.user_id::text, 0)
    );
    if exists (
      select 1 from battle.participants
      where user_id = v_operation.user_id
        and status in ('preparing_share', 'waiting', 'lobby', 'active')
    ) then
      perform api.raise_business_error(
        'BATTLE_ALREADY_PARTICIPATING', '当前已有未结束的 Battle'
      );
    end if;
    select * into v_ruleset from battle.rulesets where status = 'active';
    if v_ruleset.id is null or not battle.rules_complete(v_ruleset.id) then
      perform api.raise_business_error(
        'BATTLE_RULESET_UNAVAILABLE', 'Battle 规则暂不可用，请稍后重试'
      );
    end if;
    select * into v_tier
    from battle.entry_tiers
    where ruleset_id = v_ruleset.id and id = p_entry_tier_id;
    if v_tier.id is null then
      perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
    end if;
    perform battle.validate_team_selection(
      v_operation.user_id, v_ruleset.id, p_template_ids
    );
    perform pg_advisory_xact_lock(
      hashtextextended(
        'battle-match:' || v_ruleset.id || ':' || v_tier.id,
        0
      )
    );
    select r.* into v_room
    from battle.rooms r
    join identity.users creator on creator.id = r.creator_user_id
    where r.room_mode = 'public_match'
      and r.ruleset_id = v_ruleset.id
      and r.entry_tier_id = v_tier.id
      and r.status = 'waiting'
      and r.expires_at > v_now
      and r.creator_user_id <> v_operation.user_id
      and creator.status = 'normal'
    order by random()
    limit 1
    for update of r;
    if v_room.id is not null then
      v_result := battle.attach_opponent_and_start_lobby(
        v_room.id,
        v_operation.user_id,
        p_operation_id,
        p_template_ids
      );
      return operations.complete_command(p_operation_id, v_result);
    end if;
    insert into battle.rooms (
      id, creator_user_id, create_operation_id, ruleset_id, ruleset_checksum,
      entry_tier_id, room_mode, invite_token_hash, status,
      prepare_deadline, waiting_started_at, expires_at
    ) values (
      p_new_room_id, v_operation.user_id, p_operation_id,
      v_ruleset.id, v_ruleset.checksum, v_tier.id, 'public_match', null,
      'waiting', null, v_now,
      v_now + make_interval(
        secs => battle.rule_int(v_ruleset.id, 'matchmaking_wait_seconds')
      )
    ) returning * into v_room;
    insert into battle.participants (
      room_id, user_id, side, status, join_operation_id, last_heartbeat_at
    ) values (
      v_room.id, v_operation.user_id, 'creator', 'waiting',
      p_operation_id, v_now
    ) returning id into v_participant_id;
    perform battle.create_team(
      v_participant_id, v_operation.user_id, v_ruleset.id, p_template_ids
    );
    v_balance := economy.lock_kcoin(
      v_operation.user_id,
      v_tier.entry_fee,
      p_operation_id,
      v_room.id::text || ':' || v_operation.user_id::text || ':lock'
    );
    insert into battle.stakes (
      room_id, participant_id, user_id, amount, lock_ledger_id
    ) values (
      v_room.id,
      v_participant_id,
      v_operation.user_id,
      v_tier.entry_fee,
      (v_balance->>'ledger_id')::bigint
    );
    perform battle.record_event(
      v_room.id,
      'match_waiting',
      jsonb_build_object(
        'entry_tier_id', v_tier.id,
        'expires_at', v_room.expires_at
      ),
      jsonb_build_object(
        'creator_user_id', v_operation.user_id,
        'participant_id', v_participant_id,
        'ruleset_checksum', v_ruleset.checksum,
        'template_ids', p_template_ids,
        'stake_lock_ledger_id', (v_balance->>'ledger_id')::bigint
      )
    );
    v_result := battle.room_snapshot_json(v_room.id, v_participant_id);
    if v_result is null then
      raise exception using
        errcode = 'P0001',
        message = 'BATTLE_INVARIANT',
        detail = jsonb_build_object(
          'kind', 'match_waiting_snapshot_missing',
          'room_id', v_room.id,
          'participant_id', v_participant_id
        )::text;
    end if;
    return operations.complete_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id,
        'BATTLE_ALREADY_PARTICIPATING',
        jsonb_build_object('error_code', 'BATTLE_ALREADY_PARTICIPATING')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id, sqlerrm, jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function battle.active_member(p_participant_id uuid)
returns battle.team_members
language sql
stable
security definer
set search_path = ''
as $$
  select tm from battle.team_members tm
  where tm.participant_id = p_participant_id and tm.active
$$;

create or replace function battle.choose_timeout_skill(
  p_ruleset_id text,
  p_member battle.team_members
)
returns table (skill_position smallint, skill_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select 1::smallint, p_member.skill_1_id
  where p_member.skill_1_id is not null
    and exists (
      select 1
      from battle.skills s
      where s.ruleset_id = p_ruleset_id and s.id = p_member.skill_1_id
    )
$$;

create or replace function battle.lock_timeout_action(
  p_room_id uuid
)
returns battle.actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_member battle.team_members%rowtype;
  v_choice record;
  v_participant battle.participants%rowtype;
  v_action battle.actions%rowtype;
begin
  select * into v_room
  from battle.rooms
  where id = p_room_id and status = 'active_turn'
  for update;
  if v_room.id is null or v_room.phase_deadline > clock_timestamp() then
    return null;
  end if;
  select * into v_participant
  from battle.participants
  where room_id = p_room_id
    and side = v_room.active_actor_side
    and status = 'active';
  if v_participant.id is null then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  select * into v_action
  from battle.actions
  where room_id = p_room_id
    and round_no = v_room.current_round_no
    and action_ordinal = v_room.current_action_ordinal;
  if v_action.id is not null then return v_action; end if;
  v_member := battle.active_member(v_participant.id);
  if v_member.id is not null then
    select * into v_choice from battle.choose_timeout_skill(v_room.ruleset_id, v_member);
    insert into battle.actions (
      room_id, round_no, action_ordinal, participant_id, kind, source,
      skill_position, skill_id
    ) values (
      p_room_id, v_room.current_round_no, v_room.current_action_ordinal,
      v_participant.id, 'attack', 'timeout',
      v_choice.skill_position, v_choice.skill_id
    ) returning * into v_action;
  else
    select * into v_member
    from battle.team_members
    where participant_id = v_participant.id and alive
    order by slot
    limit 1;
    if v_member.id is null then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    select * into v_choice from battle.choose_timeout_skill(v_room.ruleset_id, v_member);
    insert into battle.actions (
      room_id, round_no, action_ordinal, participant_id, kind, source,
      skill_position, skill_id, target_slot
    ) values (
      p_room_id, v_room.current_round_no, v_room.current_action_ordinal,
      v_participant.id, 'replace_attack', 'timeout',
      v_choice.skill_position, v_choice.skill_id, v_member.slot
    ) returning * into v_action;
  end if;
  perform battle.append_audit(
    p_room_id, 'automatic_action',
    jsonb_build_object(
      'round_no', v_room.current_round_no,
      'action_ordinal', v_room.current_action_ordinal,
      'participant_id', v_participant.id,
      'action_id', v_action.id,
      'kind', v_action.kind,
      'target_slot', v_action.target_slot,
      'skill_position', v_action.skill_position
    )
  );
  return v_action;
end;
$$;

create or replace function battle.public_attack_result(p_result jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'attack',
    'actor_side', p_result->'actor_side',
    'attacker_member_id', p_result->'attacker_member_id',
    'defender_member_id', p_result->'defender_member_id',
    'skill_id', p_result->'skill_id',
    'skill_name', p_result->'skill_name',
    'effect_key', p_result->'effect_key',
    'hit', p_result->'hit',
    'multiplier_bps', p_result->'multiplier_bps',
    'target_hp_before', p_result->'defender_current_hp',
    'target_hp_after', greatest(
      0,
      (p_result->>'defender_current_hp')::integer
        - (p_result->>'applied_damage')::integer
    ),
    'target_max_hp', p_result->'defender_max_hp',
    'knockout',
    (p_result->>'applied_damage')::integer > 0
      and (p_result->>'applied_damage')::integer
        = (p_result->>'defender_current_hp')::integer
  )
$$;

create or replace function battle.public_switch_target(
  p_participant_id uuid,
  p_slot smallint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'slot', tm.slot,
    'name', tm.template_name,
    'image_thumbnail_url', catalog.template_thumbnail_url(tm.template_id),
    'image_detail_url', catalog.template_detail_url(tm.template_id),
    'rarity', tm.rarity,
    'stage', tm.stage
  )
  from battle.team_members tm
  where tm.participant_id = p_participant_id and tm.slot = p_slot
$$;

create or replace function battle.switch_active_member(
  p_participant_id uuid,
  p_target_slot smallint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update battle.team_members
  set active = false
  where participant_id = p_participant_id and active;
  update battle.team_members
  set active = true
  where participant_id = p_participant_id
    and slot = p_target_slot
    and alive;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_INVARIANT',
      detail = jsonb_build_object(
        'kind', 'switch_target_unavailable',
        'participant_id', p_participant_id,
        'target_slot', p_target_slot
      )::text;
  end if;
end;
$$;

create or replace function battle.action_teams_payload(p_room_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'side', p.side,
    'slot', tm.slot,
    'current_hp', tm.current_hp,
    'max_hp', tm.max_hp,
    'alive', tm.alive
  ) order by p.side, tm.slot), '[]'::jsonb)
  from battle.participants p
  join battle.team_members tm on tm.participant_id = p.id
  where p.room_id = p_room_id
$$;

create or replace function battle.resolve_active_action(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_action battle.actions%rowtype;
  v_actor battle.participants%rowtype;
  v_target battle.participants%rowtype;
  v_actor_member battle.team_members%rowtype;
  v_target_member battle.team_members%rowtype;
  v_attack_result jsonb;
  v_display_actions jsonb := '[]'::jsonb;
  v_audit_payload jsonb;
  v_round_no smallint;
  v_action_ordinal smallint;
  v_target_alive integer;
  v_creator battle.participants%rowtype;
  v_opponent battle.participants%rowtype;
  v_creator_alive integer;
  v_opponent_alive integer;
  v_creator_hp numeric;
  v_opponent_hp numeric;
  v_terminal_result text;
  v_winner uuid;
  v_reason text;
begin
  select * into v_room
  from battle.rooms
  where id = p_room_id
  for update;
  if v_room.status <> 'active_turn' then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  v_round_no := v_room.current_round_no;
  v_action_ordinal := v_room.current_action_ordinal;
  select * into v_action
  from battle.actions
  where room_id = p_room_id
    and round_no = v_round_no
    and action_ordinal = v_action_ordinal;
  select * into v_actor
  from battle.participants
  where room_id = p_room_id
    and side = v_room.active_actor_side
    and status = 'active'
  for update;
  select * into v_target
  from battle.participants
  where room_id = p_room_id
    and side <> v_room.active_actor_side
    and status = 'active'
  for update;
  if v_action.id is null
    or v_actor.id is null
    or v_target.id is null
    or v_action.participant_id <> v_actor.id
  then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;

  v_actor_member := battle.active_member(v_actor.id);
  if v_action.kind = 'switch' then
    if v_actor_member.id is null then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    perform battle.switch_active_member(v_actor.id, v_action.target_slot);
    v_display_actions := jsonb_build_array(jsonb_build_object(
      'kind', 'switch',
      'actor_side', v_actor.side,
      'switch_to', battle.public_switch_target(v_actor.id, v_action.target_slot)
    ));
  else
    if v_action.kind = 'replace_attack' then
      if v_actor_member.id is not null then
        raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
      end if;
      perform battle.switch_active_member(v_actor.id, v_action.target_slot);
      v_display_actions := v_display_actions || jsonb_build_array(jsonb_build_object(
        'kind', 'switch',
        'actor_side', v_actor.side,
        'switch_to', battle.public_switch_target(v_actor.id, v_action.target_slot)
      ));
    end if;
    v_actor_member := battle.active_member(v_actor.id);
    v_target_member := battle.active_member(v_target.id);
    if v_actor_member.id is null
      or v_target_member.id is null
      or battle.skill_for_position(v_actor_member, v_action.skill_position)
        is distinct from v_action.skill_id
    then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    v_attack_result := battle.attack_result(
      v_room,
      v_round_no,
      v_actor.side,
      v_action,
      v_actor_member,
      v_target_member
    );
    update battle.team_members
    set current_hp = greatest(
          0,
          current_hp - (v_attack_result->>'applied_damage')::integer
        ),
        alive = current_hp - (v_attack_result->>'applied_damage')::integer > 0,
        active = active
          and current_hp - (v_attack_result->>'applied_damage')::integer > 0
    where id = v_target_member.id;
    v_display_actions := v_display_actions
      || jsonb_build_array(battle.public_attack_result(v_attack_result));
  end if;

  update battle.team_members
  set alive = current_hp > 0,
      active = active and current_hp > 0
  where participant_id in (v_actor.id, v_target.id);
  select count(*) filter (where alive) into v_target_alive
  from battle.team_members
  where participant_id = v_target.id;

  if v_target_alive = 0 then
    v_terminal_result := 'winner';
    v_winner := v_actor.id;
    v_reason := 'team_knockout';
  elsif v_action_ordinal = 1 then
    update battle.rooms
    set active_actor_side = case active_actor_side
          when 'creator' then 'opponent'
          else 'creator'
        end,
        current_action_ordinal = 2,
        phase_deadline = clock_timestamp() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
        ),
        updated_at = clock_timestamp()
    where id = p_room_id;
  elsif v_round_no < battle.rule_int(
    v_room.ruleset_id, 'max_normal_turns'
  ) then
    update battle.turns
    set resolution_hash = battle.room_snapshot_hash(p_room_id),
        resolved_at = clock_timestamp()
    where room_id = p_room_id and round_no = v_round_no;
    update battle.rooms
    set active_actor_side = first_actor_side,
        current_round_no = current_round_no + 1,
        current_action_ordinal = 1,
        phase_deadline = clock_timestamp() + make_interval(
          secs => battle.rule_int(v_room.ruleset_id, 'action_timeout_seconds')
        ),
        updated_at = clock_timestamp()
    where id = p_room_id
    returning * into v_room;
    insert into battle.turns (room_id, round_no, start_snapshot_hash)
    values (
      p_room_id,
      v_room.current_round_no,
      battle.room_snapshot_hash(p_room_id)
    );
  else
    select * into v_creator
    from battle.participants
    where room_id = p_room_id and side = 'creator';
    select * into v_opponent
    from battle.participants
    where room_id = p_room_id and side = 'opponent';
    select count(*) filter (where alive),
           sum(current_hp::numeric / max_hp::numeric)
    into v_creator_alive, v_creator_hp
    from battle.team_members
    where participant_id = v_creator.id;
    select count(*) filter (where alive),
           sum(current_hp::numeric / max_hp::numeric)
    into v_opponent_alive, v_opponent_hp
    from battle.team_members
    where participant_id = v_opponent.id;
    if v_creator_alive > v_opponent_alive
      or (v_creator_alive = v_opponent_alive and v_creator_hp > v_opponent_hp)
    then
      v_terminal_result := 'winner';
      v_winner := v_creator.id;
    elsif v_opponent_alive > v_creator_alive
      or (v_opponent_alive = v_creator_alive and v_opponent_hp > v_creator_hp)
    then
      v_terminal_result := 'winner';
      v_winner := v_opponent.id;
    else
      v_terminal_result := 'draw';
    end if;
    v_reason := 'turn_limit';
  end if;

  if v_terminal_result is not null then
    update battle.turns
    set resolution_hash = battle.room_snapshot_hash(p_room_id),
        resolved_at = clock_timestamp()
    where room_id = p_room_id and round_no = v_round_no;
  end if;

  v_audit_payload := jsonb_build_object(
    'round_no', v_round_no,
    'action_ordinal', v_action_ordinal,
    'actor_side', v_actor.side,
    'actions', v_display_actions,
    'teams', battle.action_teams_payload(p_room_id),
    'action', to_jsonb(v_action),
    'attack_result', v_attack_result,
    'terminal_result', v_terminal_result,
    'winner_participant_id', v_winner,
    'reason', v_reason
  );
  perform battle.record_event(
    p_room_id,
    'action_resolved',
    jsonb_build_object(
      'round_no', v_round_no,
      'action_ordinal', v_action_ordinal,
      'actor_side', v_actor.side
    ),
    v_audit_payload
  );

  if v_terminal_result is not null then
    perform battle.finalize_room(
      p_room_id, v_terminal_result, v_winner, v_reason
    );
  end if;
end;
$$;

create or replace function battle.void_room_after_invariant(
  p_room_id uuid,
  p_error_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_ledgers jsonb;
  v_audit_hash text;
  v_entry_fee bigint;
  v_pool bigint;
  v_error_hash text := encode(
    extensions.digest(
      convert_to(coalesce(p_error_detail, ''), 'UTF8'),
      'sha256'
    ),
    'hex'
  );
begin
  select * into v_room from battle.rooms where id = p_room_id for update;
  if v_room.status in ('finished', 'draw', 'cancelled', 'expired', 'voided') then
    return;
  end if;
  select coalesce(sum(amount), 0) into v_pool
  from battle.stakes
  where room_id = p_room_id;
  v_ledgers := battle.refund_locked_stakes(p_room_id, 'battle_invariant_void');
  perform battle.release_reservations(p_room_id);
  update battle.participants
  set status = 'voided', finished_at = now()
  where room_id = p_room_id;
  for v_participant in
    select * from battle.participants where room_id = p_room_id order by side
  loop
    select coalesce((
      select amount
      from battle.stakes
      where participant_id = v_participant.id
    ), 0) into v_entry_fee;
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    values (
      v_participant.id, p_room_id, v_participant.user_id,
      coalesce(
        (
          select nullif(
            btrim(opponent.first_name || ' ' || coalesce(opponent.last_name, '')),
            ''
          )
          from battle.participants other
          join identity.users opponent on opponent.id = other.user_id
          where other.room_id = p_room_id and other.id <> v_participant.id
          order by other.side
          limit 1
        ),
        'Battle'
      ),
      'void', v_entry_fee, v_entry_fee, 0, 0,
      'system_invariant_void', now()
    )
    on conflict (participant_id) do update
    set result = 'void',
        entry_fee = excluded.entry_fee,
        payout = excluded.payout,
        net_change = 0,
        fee = 0,
        reason = 'system_invariant_void',
        finished_at = excluded.finished_at;
  end loop;
  insert into operations.invariant_violations (code, subject, details)
  values (
    'BATTLE_INVARIANT',
    p_room_id::text,
    jsonb_build_object(
      'room_status', v_room.status,
      'error_detail_sha256', v_error_hash
    )
  )
  on conflict do nothing;
  v_audit_hash := battle.append_audit(
    p_room_id, 'invariant_void',
    jsonb_build_object(
      'error_detail_sha256', v_error_hash,
      'refund_ledger_ids', v_ledgers
    )
  );
  insert into battle.settlements (
    room_id, result, pool, winner_payout, fee, ledger_ids, reason, audit_hash
  ) values (
    p_room_id, 'void', v_pool, 0, 0, v_ledgers,
    'system_invariant_void', v_audit_hash
  )
  on conflict (room_id) do update
  set result = 'void',
      winner_participant_id = null,
      pool = excluded.pool,
      winner_payout = 0,
      fee = 0,
      ledger_ids = excluded.ledger_ids,
      reason = 'system_invariant_void',
      audit_hash = excluded.audit_hash,
      settled_at = excluded.settled_at;
  update battle.rooms
  set status = 'voided', finished_at = now(), phase_deadline = null,
      lobby_start_deadline = null,
      updated_at = now()
  where id = p_room_id;
  perform battle.record_event(
    p_room_id, 'battle_voided',
    jsonb_build_object('reason', 'system_invariant_void'),
    jsonb_build_object('audit_hash', v_audit_hash, 'refund_ledger_ids', v_ledgers)
  );
end;
$$;

create or replace function battle.finalize_room(
  p_room_id uuid,
  p_result text,
  p_winner_participant_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_tier battle.entry_tiers%rowtype;
  v_stake battle.stakes%rowtype;
  v_participant battle.participants%rowtype;
  v_winner battle.participants%rowtype;
  v_loser battle.participants%rowtype;
  v_balance jsonb;
  v_ledger_ids jsonb := '[]'::jsonb;
  v_audit_hash text;
  v_payout bigint;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'battle_finished');
begin
  select * into v_room
  from battle.rooms
  where id = p_room_id
  for update;
  if v_room.status in ('finished', 'draw', 'voided') then return; end if;
  if v_room.status <> 'active_turn'
    or p_result not in ('winner', 'draw')
    or (p_result = 'winner') <> (p_winner_participant_id is not null)
  then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  select * into v_tier
  from battle.entry_tiers
  where ruleset_id = v_room.ruleset_id and id = v_room.entry_tier_id;
  if v_tier.id is null
     or (
       select count(*)
       from battle.stakes
       where room_id = p_room_id and status = 'locked'
     ) <> 2
  then
    raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
  end if;
  perform 1
  from economy.balances b
  join battle.stakes s
    on s.user_id = b.user_id
   and s.room_id = p_room_id
   and s.status = 'locked'
  where b.currency = 'KCOIN'
  order by b.user_id
  for update of b;

  if p_result = 'draw' then
    v_ledger_ids := battle.refund_locked_stakes(p_room_id, 'battle_draw');
    update battle.participants
    set status = 'draw', finished_at = now()
    where room_id = p_room_id;
    for v_participant in
      select *
      from battle.participants
      where room_id = p_room_id
      order by side
    loop
      insert into battle.summaries (
        participant_id, room_id, user_id, opponent_display_name,
        result, entry_fee, payout, net_change, fee, reason, finished_at
      )
      select
        v_participant.id, p_room_id, v_participant.user_id,
        coalesce(
          nullif(
            btrim(opponent.first_name || ' ' || coalesce(opponent.last_name, '')),
            ''
          ),
          'Battle'
        ),
        'draw', v_tier.entry_fee, v_tier.entry_fee, 0, 0,
        v_reason, now()
      from battle.participants other
      join identity.users opponent on opponent.id = other.user_id
      where other.room_id = p_room_id and other.id <> v_participant.id;
    end loop;
    v_audit_hash := battle.append_audit(
      p_room_id, 'settlement_draw',
      jsonb_build_object(
        'pool', v_tier.pool,
        'refund_ledger_ids', v_ledger_ids,
        'seed_reveal', encode(v_room.private_seed, 'hex'),
        'seed_commitment', v_room.seed_commitment,
        'reason', v_reason
      )
    );
    insert into battle.settlements (
      room_id, result, pool, winner_payout, fee, ledger_ids, reason, audit_hash
    ) values (
      p_room_id, 'draw', v_tier.pool, 0, 0, v_ledger_ids,
      v_reason, v_audit_hash
    );
    update battle.rooms
    set status = 'draw', finished_at = now(), phase_deadline = null,
        updated_at = now()
    where id = p_room_id;
  else
    select * into v_winner
    from battle.participants
    where id = p_winner_participant_id and room_id = p_room_id;
    select * into v_loser
    from battle.participants
    where room_id = p_room_id and id <> v_winner.id;
    if v_winner.id is null or v_loser.id is null then
      raise exception 'BATTLE_INVARIANT' using errcode = 'P0001';
    end if;
    for v_stake in
      select *
      from battle.stakes
      where room_id = p_room_id and status = 'locked'
      order by user_id
      for update
    loop
      v_payout := case
        when v_stake.participant_id = v_winner.id then v_tier.winner_payout
        else 0
      end;
      v_balance := economy.settle_battle_kcoin(
        v_stake.user_id,
        v_stake.amount,
        v_payout,
        (
          select join_operation_id
          from battle.participants
          where id = v_stake.participant_id
        ),
        p_room_id::text || ':' || v_stake.user_id::text || ':settlement'
      );
      update battle.stakes
      set status = 'settled',
          payout_ledger_id = (v_balance->>'ledger_id')::bigint,
          settled_at = now()
      where id = v_stake.id;
      if v_balance->>'ledger_id' is not null then
        v_ledger_ids := v_ledger_ids
          || jsonb_build_array((v_balance->>'ledger_id')::bigint);
      end if;
    end loop;
    update battle.participants
    set status = 'finished', finished_at = now()
    where room_id = p_room_id;
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    select
      v_winner.id, p_room_id, v_winner.user_id,
      coalesce(
        nullif(
          btrim(loser_user.first_name || ' ' || coalesce(loser_user.last_name, '')),
          ''
        ),
        'Battle'
      ),
      'win', v_tier.entry_fee, v_tier.winner_payout,
      v_tier.winner_payout - v_tier.entry_fee, v_tier.fee,
      v_reason, now()
    from identity.users loser_user
    where loser_user.id = v_loser.user_id;
    insert into battle.summaries (
      participant_id, room_id, user_id, opponent_display_name,
      result, entry_fee, payout, net_change, fee, reason, finished_at
    )
    select
      v_loser.id, p_room_id, v_loser.user_id,
      coalesce(
        nullif(
          btrim(winner_user.first_name || ' ' || coalesce(winner_user.last_name, '')),
          ''
        ),
        'Battle'
      ),
      'loss', v_tier.entry_fee, 0, -v_tier.entry_fee, 0,
      v_reason, now()
    from identity.users winner_user
    where winner_user.id = v_winner.user_id;
    v_audit_hash := battle.append_audit(
      p_room_id, 'settlement_winner',
      jsonb_build_object(
        'winner_participant_id', v_winner.id,
        'pool', v_tier.pool,
        'winner_payout', v_tier.winner_payout,
        'fee', v_tier.fee,
        'ledger_ids', v_ledger_ids,
        'seed_reveal', encode(v_room.private_seed, 'hex'),
        'seed_commitment', v_room.seed_commitment,
        'reason', v_reason
      )
    );
    insert into battle.settlements (
      room_id, result, winner_participant_id, pool, winner_payout,
      fee, ledger_ids, reason, audit_hash
    ) values (
      p_room_id, 'winner', v_winner.id, v_tier.pool, v_tier.winner_payout,
      v_tier.fee, v_ledger_ids, v_reason, v_audit_hash
    );
    update battle.rooms
    set status = 'finished', finished_at = now(), phase_deadline = null,
        updated_at = now()
    where id = p_room_id;
  end if;

  perform battle.release_reservations(p_room_id);
  perform battle.record_event(
    p_room_id, 'battle_finished',
    jsonb_build_object('result', p_result, 'reason', v_reason),
    jsonb_build_object(
      'result', p_result,
      'winner_participant_id', p_winner_participant_id,
      'reason', v_reason,
      'settlement_audit_hash', v_audit_hash,
      'ledger_ids', v_ledger_ids
    )
  );
end;
$$;

create or replace function battle.safe_resolve_active_action(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail text;
  v_message text;
  v_state text;
begin
  begin
    perform battle.resolve_active_action(p_room_id);
    return true;
  exception
    when others then
      v_state := sqlstate;
      v_message := sqlerrm;
      get stacked diagnostics v_detail = pg_exception_detail;
  end;
  perform battle.void_room_after_invariant(
    p_room_id,
    coalesce(v_state, '')
      || ':'
      || coalesce(v_message, '')
      || ':'
      || coalesce(v_detail, '')
  );
  return false;
end;
$$;

create or replace function api.battle_submit_action(
  p_session_id uuid,
  p_operation_id uuid,
  p_room_id uuid,
  p_round_no smallint,
  p_action_ordinal smallint,
  p_kind text,
  p_skill_position smallint default null,
  p_target_slot smallint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation operations.operations%rowtype;
  v_replay jsonb;
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_member battle.team_members%rowtype;
  v_selected_member battle.team_members%rowtype;
  v_skill_id text;
  v_result jsonb;
  v_after_sequence bigint;
begin
  v_operation := operations.begin_command(
    p_session_id, 'battle.action', p_operation_id,
    jsonb_build_object(
      'room_id', p_room_id,
      'round_no', p_round_no,
      'action_ordinal', p_action_ordinal,
      'kind', p_kind,
      'skill_position', p_skill_position,
      'target_slot', p_target_slot
    )
  );
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  begin
    select * into v_room
    from battle.rooms
    where id = p_room_id
    for update;
    if v_room.id is null then
      perform api.raise_business_error('BATTLE_ROOM_NOT_FOUND', 'Battle 房间不存在');
    elsif v_room.status = 'voided' then
      perform api.raise_business_error(
        'BATTLE_VOIDED',
        'Battle 已安全作废，入场费和藏品已恢复'
      );
    end if;
    select * into v_participant
    from battle.participants
    where room_id = p_room_id and user_id = v_operation.user_id;
    if v_participant.id is null then
      perform api.raise_business_error(
        'BATTLE_NOT_PARTICIPANT',
        '当前账号不是该 Battle 的参与者'
      );
    end if;
    if v_room.status <> 'active_turn' or v_participant.status <> 'active' then
      perform api.raise_business_error(
        'BATTLE_ACTION_PHASE_INVALID',
        '当前阶段不能提交该动作'
      );
    end if;
    perform battle.consume_rate_limit(v_operation.user_id, 'combat_action');
    v_after_sequence := v_room.latest_action_sequence;

    if clock_timestamp() >= v_room.phase_deadline then
      perform battle.lock_timeout_action(p_room_id);
      if not battle.safe_resolve_active_action(p_room_id) then
        v_result := battle.room_snapshot_json(
          p_room_id, v_participant.id, v_after_sequence
        );
        return operations.fail_command(
          p_operation_id,
          'BATTLE_VOIDED',
          coalesce(v_result, '{}'::jsonb)
            || jsonb_build_object('error_code', 'BATTLE_VOIDED')
        );
      end if;
      v_result := battle.room_snapshot_json(
        p_room_id, v_participant.id, v_after_sequence
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_STATE_CONFLICT',
        coalesce(v_result, '{}'::jsonb)
          || jsonb_build_object('error_code', 'BATTLE_STATE_CONFLICT')
      );
    end if;
    if v_room.current_round_no <> p_round_no
      or v_room.current_action_ordinal <> p_action_ordinal
    then
      perform api.raise_business_error(
        'BATTLE_STATE_CONFLICT',
        'Battle 状态已更新'
      );
    end if;
    if v_participant.side <> v_room.active_actor_side then
      perform api.raise_business_error(
        'BATTLE_NOT_YOUR_TURN',
        '当前不是你的行动时间'
      );
    end if;

    v_member := battle.active_member(v_participant.id);
    if p_kind = 'attack'
      and v_member.id is not null
      and p_skill_position between 1 and 4
      and p_target_slot is null
    then
      v_skill_id := battle.skill_for_position(v_member, p_skill_position);
      if v_skill_id is null then
        perform api.raise_business_error(
          'BATTLE_ACTION_INVALID',
          'Battle 动作无效'
        );
      end if;
      insert into battle.actions (
        room_id, round_no, action_ordinal, participant_id, kind, source,
        skill_position, skill_id, operation_id
      ) values (
        p_room_id, p_round_no, p_action_ordinal, v_participant.id,
        'attack', 'player', p_skill_position, v_skill_id, p_operation_id
      );
    elsif p_kind = 'switch'
      and v_member.id is not null
      and p_skill_position is null
      and p_target_slot between 1 and 3
    then
      select * into v_selected_member
      from battle.team_members
      where participant_id = v_participant.id
        and slot = p_target_slot
        and alive
        and not active;
      if v_selected_member.id is null then
        perform api.raise_business_error(
          'BATTLE_SWITCH_TARGET_INVALID',
          '换宠目标无效'
        );
      end if;
      insert into battle.actions (
        room_id, round_no, action_ordinal, participant_id, kind, source,
        target_slot, operation_id
      ) values (
        p_room_id, p_round_no, p_action_ordinal, v_participant.id,
        'switch', 'player', p_target_slot, p_operation_id
      );
    elsif p_kind = 'replace_attack'
      and v_member.id is null
      and p_skill_position between 1 and 4
      and p_target_slot between 1 and 3
    then
      select * into v_selected_member
      from battle.team_members
      where participant_id = v_participant.id
        and slot = p_target_slot
        and alive
        and not active;
      v_skill_id := battle.skill_for_position(
        v_selected_member,
        p_skill_position
      );
      if v_selected_member.id is null or v_skill_id is null then
        perform api.raise_business_error(
          'BATTLE_ACTION_INVALID',
          'Battle 动作无效'
        );
      end if;
      insert into battle.actions (
        room_id, round_no, action_ordinal, participant_id, kind, source,
        skill_position, skill_id, target_slot, operation_id
      ) values (
        p_room_id, p_round_no, p_action_ordinal, v_participant.id,
        'replace_attack', 'player', p_skill_position, v_skill_id,
        p_target_slot, p_operation_id
      );
    else
      perform api.raise_business_error(
        'BATTLE_ACTION_INVALID',
        'Battle 动作无效'
      );
    end if;

    perform battle.append_audit(
      p_room_id, 'player_action_locked',
      jsonb_build_object(
        'round_no', p_round_no,
        'action_ordinal', p_action_ordinal,
        'participant_id', v_participant.id,
        'kind', p_kind,
        'skill_id', v_skill_id,
        'target_slot', p_target_slot,
        'operation_id', p_operation_id
      )
    );
    if not battle.safe_resolve_active_action(p_room_id) then
      v_result := battle.room_snapshot_json(
        p_room_id, v_participant.id, v_after_sequence
      );
      return operations.fail_command(
        p_operation_id,
        'BATTLE_VOIDED',
        coalesce(v_result, '{}'::jsonb)
          || jsonb_build_object('error_code', 'BATTLE_VOIDED')
      );
    end if;
    v_result := battle.room_snapshot_json(
      p_room_id, v_participant.id, v_after_sequence
    );
    return operations.complete_command(p_operation_id, v_result);
  exception
    when unique_violation then
      return operations.fail_command(
        p_operation_id,
        'BATTLE_STATE_CONFLICT',
        jsonb_build_object('error_code', 'BATTLE_STATE_CONFLICT')
      );
    when sqlstate 'P0001' then
      if sqlerrm = 'BATTLE_INVARIANT' then raise; end if;
      return operations.fail_command(
        p_operation_id,
        sqlerrm,
        jsonb_build_object('error_code', sqlerrm)
      );
  end;
end;
$$;

create or replace function battle.process_due(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room battle.rooms%rowtype;
  v_participant battle.participants%rowtype;
  v_processed integer := 0;
  v_ruleset_id text;
  v_error_state text;
  v_error_message text;
  v_error_detail text;
begin
  if not pg_try_advisory_xact_lock(
    hashtextextended('evomypet:battle:process_due:v1', 0)
  ) then
    return 0;
  end if;
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  if p_limit < 1
     or p_limit > battle.rule_int(v_ruleset_id, 'tick_batch_limit') then
    raise exception 'invalid Battle tick batch';
  end if;
  if exists (
    select 1 from battle.prepared_shares
    where status = 'pending' and next_attempt_at <= now()
      and (lease_expires_at is null or lease_expires_at <= now())
  ) then
    perform battle.wake_integration('share');
  end if;
  if exists (
    select 1
    from battle.outbox
    where published_at is null
      and next_attempt_at <= now()
      and (
        status = 'pending'
        or (status = 'leased' and lease_expires_at <= now())
      )
  ) then
    perform battle.wake_integration('outbox');
  end if;
  for v_room in
    select r.*
    from battle.rooms r
    where (
      (r.status = 'preparing_share' and r.prepare_deadline <= now())
      or (
        r.status = 'waiting'
        and (
          r.expires_at <= now()
          or exists (
            select 1
            from battle.participants p
            where p.room_id = r.id
              and p.side = 'creator'
              and p.status = 'waiting'
              and p.offline_since is null
              and p.last_heartbeat_at <= now() - make_interval(
                secs => battle.rule_int(
                  r.ruleset_id, 'presence_online_window_seconds'
                )
              )
          )
          or exists (
            select 1 from identity.users u
            where u.id = r.creator_user_id and u.status = 'banned'
          )
        )
      )
      or (
        r.status in ('lobby_waiting', 'lobby_countdown')
        and (
          r.lobby_expires_at <= now()
          or r.lobby_start_deadline <= now()
          or exists (
            select 1
            from battle.participants p
            where p.room_id = r.id
              and p.status = 'lobby'
              and (
                p.presence_deadline <= now()
                or (
                  p.offline_since is null
                  and p.last_heartbeat_at <= now() - make_interval(
                    secs => battle.rule_int(
                      r.ruleset_id, 'presence_online_window_seconds'
                    )
                  )
                )
              )
          )
          or exists (
            select 1
            from battle.participants p
            join identity.users u on u.id = p.user_id
            where p.room_id = r.id
              and p.status = 'lobby'
              and u.status = 'banned'
          )
        )
      )
      or (r.status = 'active_turn' and r.phase_deadline <= now())
    )
    order by least(
      coalesce(r.prepare_deadline, 'infinity'::timestamptz),
      coalesce(r.expires_at, 'infinity'::timestamptz),
      coalesce(r.lobby_expires_at, 'infinity'::timestamptz),
      coalesce(r.lobby_start_deadline, 'infinity'::timestamptz),
      coalesce((
        select p.last_heartbeat_at + make_interval(
          secs => battle.rule_int(
            r.ruleset_id, 'presence_online_window_seconds'
          )
        )
        from battle.participants p
        where p.room_id = r.id
          and p.side = 'creator'
          and p.status = 'waiting'
          and p.offline_since is null
      ), 'infinity'::timestamptz),
      coalesce((
        select min(coalesce(
          p.presence_deadline,
          p.last_heartbeat_at + make_interval(
            secs => battle.rule_int(
              r.ruleset_id, 'presence_online_window_seconds'
            )
          )
        ))
        from battle.participants p
        where p.room_id = r.id and p.status = 'lobby'
      ), 'infinity'::timestamptz),
      coalesce(r.phase_deadline, 'infinity'::timestamptz)
    ), r.id
    limit p_limit
    for update skip locked
  loop
    begin
      begin
        if v_room.status = 'preparing_share' then
          perform api.battle_abort_share(v_room.id, 'share_timeout');
        elsif v_room.status = 'waiting' then
          if v_room.expires_at <= now()
            or exists (
              select 1 from identity.users
              where id = v_room.creator_user_id and status = 'banned'
            )
          then
            perform battle.close_unstarted_room(
              v_room.id,
              case when v_room.expires_at <= now() then 'expired' else 'cancelled' end,
              case
                when v_room.expires_at <= now()
                  and v_room.room_mode = 'public_match'
                then 'match_timeout'
                when v_room.expires_at <= now() then 'waiting_expired'
                else 'creator_banned'
              end
            );
          else
            select * into v_participant
            from battle.participants
            where room_id = v_room.id and side = 'creator' and status = 'waiting'
            for update;
            if v_participant.offline_since is null then
              update battle.participants
              set offline_since = v_participant.last_heartbeat_at + make_interval(
                    secs => battle.rule_int(
                      v_room.ruleset_id, 'presence_online_window_seconds'
                    )
                  ),
                  presence_deadline = v_participant.last_heartbeat_at
                    + make_interval(
                      secs => battle.rule_int(
                        v_room.ruleset_id, 'presence_online_window_seconds'
                      ) + battle.rule_int(
                        v_room.ruleset_id, 'offline_reconnect_seconds'
                      )
                    )
              where id = v_participant.id
              returning * into v_participant;
              perform battle.record_event(
                v_room.id,
                'participant_offline',
                jsonb_build_object(
                  'side', 'creator',
                  'reconnect_deadline', v_participant.presence_deadline
                ),
                jsonb_build_object(
                  'participant_id', v_participant.id,
                  'offline_since', v_participant.offline_since,
                  'display_only', true
                )
              );
            end if;
          end if;
        elsif v_room.status in ('lobby_waiting', 'lobby_countdown') then
          perform battle.advance_lobby(v_room.id);
        elsif v_room.status = 'active_turn' then
          perform battle.lock_timeout_action(v_room.id);
          perform battle.safe_resolve_active_action(v_room.id);
        end if;
        v_processed := v_processed + 1;
      exception
        when sqlstate 'P0001' then
          if sqlerrm <> 'BATTLE_INVARIANT' then raise; end if;
          v_error_message := sqlerrm;
          get stacked diagnostics v_error_detail = pg_exception_detail;
          perform battle.void_room_after_invariant(
            v_room.id,
            coalesce(v_error_message, '') || ':' || coalesce(v_error_detail, '')
          );
          v_processed := v_processed + 1;
      end;
    exception
      when others then
        v_error_state := sqlstate;
        v_error_message := sqlerrm;
        get stacked diagnostics v_error_detail = pg_exception_detail;
        insert into operations.invariant_violations (code, subject, details)
        values (
          'BATTLE_TICK_ROOM_FAILURE',
          v_room.id::text,
          jsonb_build_object(
            'sqlstate', v_error_state,
            'error_sha256',
            encode(
              extensions.digest(
                convert_to(
                  coalesce(v_error_message, '')
                    || ':'
                    || coalesce(v_error_detail, ''),
                  'UTF8'
                ),
                'sha256'
              ),
              'hex'
            )
          )
        )
        on conflict do nothing;
    end;
  end loop;
  return v_processed;
end;
$$;

create or replace function api.battle_claim_prepared_shares(
  p_lease_owner text,
  p_limit integer default 25,
  p_room_id uuid default null
)
returns table (
  room_id uuid,
  create_operation_id uuid,
  creator_telegram_id bigint,
  creator_display_name text,
  preferred_language text,
  rarity_summary jsonb,
  entry_fee bigint,
  invite_token_hash text,
  attempt_count integer,
  prepare_deadline timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' or length(p_lease_owner) > 128
     or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid prepared-share lease';
  end if;
  return query
  with claimed as (
    select ps.room_id
    from battle.prepared_shares ps
    join battle.rooms r on r.id = ps.room_id
    where ps.status = 'pending'
      and ps.next_attempt_at <= now()
      and r.status = 'preparing_share'
      and r.prepare_deadline > now()
      and (p_room_id is null or ps.room_id = p_room_id)
      and (ps.lease_expires_at is null or ps.lease_expires_at <= now())
    order by ps.next_attempt_at, ps.room_id
    limit p_limit
    for update of ps skip locked
  ), leased as (
    update battle.prepared_shares ps
    set lease_owner = p_lease_owner,
        lease_expires_at = now() + interval '30 seconds',
        attempt_count = ps.attempt_count + 1,
        updated_at = now()
    from claimed c
    where ps.room_id = c.room_id
    returning ps.*
  )
  select
    r.id, r.create_operation_id, u.telegram_id,
    btrim(u.first_name || ' ' || coalesce(u.last_name, '')),
    u.preferred_language,
    battle.rarity_summary(r.id), tier.entry_fee, r.invite_token_hash,
    leased.attempt_count, r.prepare_deadline
  from leased
  join battle.rooms r on r.id = leased.room_id
  join identity.users u on u.id = r.creator_user_id
  join battle.entry_tiers tier
    on tier.ruleset_id = r.ruleset_id and tier.id = r.entry_tier_id;
end;
$$;

create or replace function api.battle_nack_prepared_share(
  p_room_id uuid,
  p_lease_owner text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt integer;
begin
  update battle.prepared_shares
  set lease_owner = null,
      lease_expires_at = null,
      last_error = case
        when coalesce(p_error_code, '') ~ '^[A-Z0-9_]{1,100}$' then p_error_code
        else 'INTEGRATION_FAILURE'
      end,
      next_attempt_at = now() + battle.retry_interval(p_room_id, attempt_count),
      updated_at = now()
  where room_id = p_room_id and status = 'pending'
    and lease_owner = p_lease_owner
  returning attempt_count into v_attempt;
  return v_attempt is not null;
end;
$$;

create or replace function battle.invalidation_channels(p_room_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(channel order by channel), array[]::text[])
  from (
    select 'battle:room:' || r.id::text channel
    from battle.rooms r
    where r.id = p_room_id
    union
    select 'battle:invite:' || r.invite_token_hash
    from battle.rooms r
    where r.id = p_room_id and r.room_mode = 'friend_invite'
    union
    select 'battle:user:' || p.user_id::text
    from battle.participants p
    where p.room_id = p_room_id
  ) permitted_channels
$$;

create or replace function api.battle_claim_outbox(
  p_lease_owner text,
  p_limit integer default 100
)
returns table (
  outbox_id uuid,
  event_id uuid,
  room_id uuid,
  state_version bigint,
  event_kind text,
  attempt_count integer,
  channels text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' or length(p_lease_owner) > 128
     or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid outbox lease';
  end if;
  return query
  with claimed as (
    select o.id
    from battle.outbox o
    where o.published_at is null
      and o.next_attempt_at <= now()
      and (o.status = 'pending' or o.lease_expires_at <= now())
    order by o.next_attempt_at, o.created_at, o.id
    limit p_limit
    for update skip locked
  )
  update battle.outbox o
  set status = 'leased',
      lease_owner = p_lease_owner,
      lease_expires_at = now() + interval '30 seconds',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
  from claimed c
  where o.id = c.id
  returning
    o.id,
    o.event_id,
    o.room_id,
    o.state_version,
    o.event_kind,
    o.attempt_count,
    battle.invalidation_channels(o.room_id);
end;
$$;

create or replace function api.battle_ack_outbox(
  p_outbox_id uuid,
  p_lease_owner text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with acknowledged as (
    update battle.outbox o
    set status = 'published', published_at = coalesce(published_at, now()),
        lease_owner = null, lease_expires_at = null, last_error = null,
        updated_at = now()
    where id = p_outbox_id
      and (status = 'published' or (status = 'leased' and lease_owner = p_lease_owner))
    returning 1
  )
  select exists (select 1 from acknowledged)
$$;

create or replace function api.battle_nack_outbox(
  p_outbox_id uuid,
  p_lease_owner text,
  p_error_code text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with rejected as (
    update battle.outbox o
    set status = 'pending',
        lease_owner = null,
        lease_expires_at = null,
        last_error = case
          when coalesce(p_error_code, '') ~ '^[A-Z0-9_]{1,100}$' then p_error_code
          else 'INTEGRATION_FAILURE'
        end,
        next_attempt_at = now() + battle.retry_interval(o.room_id, o.attempt_count),
        updated_at = now()
    where id = p_outbox_id and status = 'leased' and lease_owner = p_lease_owner
    returning 1
  )
  select exists (select 1 from rejected)
$$;

create or replace function api.battle_complete_outbox(
  p_outbox_id uuid,
  p_lease_owner text,
  p_success boolean,
  p_error_code text default null
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select case
    when p_success then api.battle_ack_outbox(p_outbox_id, p_lease_owner)
    else api.battle_nack_outbox(p_outbox_id, p_lease_owner, p_error_code)
  end
$$;

create or replace function api.battle_process_due(p_limit integer default 100)
returns integer
language sql
security definer
set search_path = ''
as $$
  select battle.process_due(p_limit)
$$;

create or replace function api.battle_validate_recovery_context(
  p_session_id uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_invite_hash text;
  v_room battle.rooms%rowtype;
begin
  if p_kind in ('create', 'matchmake') then
    return jsonb_build_object(
      'kind', p_kind,
      'assets', economy.assets(v_user_id),
      'participation', battle.participation_json(v_user_id)
    );
  elsif p_kind <> 'accept' then
    perform api.raise_business_error('REQUEST_INVALID', '充值恢复上下文无效');
  end if;
  select battle_invite_token_hash into v_invite_hash
  from identity.sessions
  where id = p_session_id and user_id = v_user_id
    and entry_kind = 'battle' and revoked_at is null and expires_at > now();
  select * into v_room
  from battle.rooms
  where room_mode = 'friend_invite' and invite_token_hash = v_invite_hash;
  return jsonb_build_object(
    'kind', 'accept',
    'assets', economy.assets(v_user_id),
    'participation', battle.participation_json(v_user_id),
    'challenge', case
      when v_room.id is null then null
      else battle.challenge_card_json(v_room.id)
    end,
    'acceptable', v_room.id is not null
      and v_room.status = 'waiting'
      and v_room.expires_at > now()
      and v_room.creator_user_id <> v_user_id
  );
end;
$$;

create or replace function battle.monitor_invariants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_added integer;
  v_room battle.rooms%rowtype;
  v_invariant_error text;
begin
  for v_room in
    select r.*
    from battle.rooms r
    where r.status in ('lobby_waiting', 'lobby_countdown')
    order by r.id
    for update skip locked
  loop
    v_invariant_error := battle.lobby_invariant_error(v_room.id);
    if v_invariant_error is not null then
      perform battle.void_room_after_invariant(
        v_room.id, 'lobby_monitor:' || v_invariant_error
      );
      v_count := v_count + 1;
    end if;
  end loop;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_BALANCE_LOCK_MISMATCH', b.user_id::text,
    jsonb_build_object(
      'balance_locked', b.locked,
      'battle_locked', coalesce(sum(s.amount) filter (where s.status = 'locked'), 0)
    )
  from economy.balances b
  left join battle.stakes s on s.user_id = b.user_id
  where b.currency = 'KCOIN'
  group by b.user_id, b.locked
  having b.locked < coalesce(sum(s.amount) filter (where s.status = 'locked'), 0)
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_STAKE_SETTLEMENT_MISMATCH', r.id::text,
    jsonb_build_object(
      'room_status', r.status,
      'locked_stakes', count(distinct s.id) filter (where s.status = 'locked'),
      'refunded_stakes',
        count(distinct s.id) filter (where s.status = 'refunded'),
      'settled_stakes',
        count(distinct s.id) filter (where s.status = 'settled'),
      'participant_count', count(distinct p.id),
      'settlement_count', count(distinct st.id),
      'settlement_result', min(st.result)
    )
  from battle.rooms r
  left join battle.participants p on p.room_id = r.id
  left join battle.stakes s on s.room_id = r.id
  left join battle.settlements st on st.room_id = r.id
  group by r.id, r.status
  having (
    r.status in ('finished', 'draw')
    and (
      count(distinct s.id) filter (where s.status = 'locked') > 0
      or count(distinct st.id) <> 1
    )
  ) or (
    r.status = 'voided'
    and not exists (
      select 1
      from battle.events e
      where e.room_id = r.id
        and e.kind = 'voided'
        and e.public_payload->>'reason' = 'share_failed'
    )
    and (
      count(distinct p.id) <> 2
      or count(distinct s.id) <> count(distinct p.id)
      or count(distinct s.id) <> count(distinct s.id) filter (
        where s.status = 'refunded'
      )
      or count(distinct st.id) <> 1
      or count(distinct st.id) filter (where st.result = 'void') <> 1
      or count(distinct p.id) <> count(distinct p.id) filter (
        where p.status = 'voided'
      )
      or exists (
        select 1
        from battle.stakes void_stake
        join battle.participants void_participant
          on void_participant.id = void_stake.participant_id
        left join battle.entry_tiers void_tier
          on void_tier.ruleset_id = r.ruleset_id
         and void_tier.id = r.entry_tier_id
        left join economy.ledger void_refund
          on void_refund.id = void_stake.refund_ledger_id
        where void_stake.room_id = r.id
          and (
            void_tier.id is null
            or void_stake.user_id <> void_participant.user_id
            or void_stake.amount <> void_tier.entry_fee
            or void_refund.id is null
            or void_refund.operation_id is distinct from
              void_participant.join_operation_id
            or void_refund.user_id is distinct from void_participant.user_id
            or void_refund.currency is distinct from 'KCOIN'
            or void_refund.amount is distinct from void_stake.amount
            or void_refund.reason is distinct from 'battle_stake_refund'
          )
      )
      or exists (
        select 1
        from inventory.reservations void_reservation
        join battle.participants void_participant
          on void_participant.id = void_reservation.reference_id
        where void_participant.room_id = r.id
          and void_reservation.kind = 'battle'
          and void_reservation.status <> 'released'
      )
    )
  ) or (
    r.status in (
      'lobby_waiting', 'lobby_countdown',
      'active_turn'
    )
    and count(distinct s.id) filter (where s.status = 'locked') <> 2
  ) or (
    r.status in ('preparing_share', 'waiting')
    and count(distinct s.id) filter (where s.status = 'locked') <> 1
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_UNSTARTED_TERMINAL_MISMATCH', r.id::text,
    jsonb_build_object(
      'room_status', r.status,
      'share_failed', exists (
        select 1
        from battle.events e
        where e.room_id = r.id
          and e.kind = 'voided'
          and e.public_payload->>'reason' = 'share_failed'
      ),
      'stake_count', count(distinct s.id),
      'refunded_stakes',
        count(distinct s.id) filter (where s.status = 'refunded'),
      'active_reservations',
        count(distinct ir.id) filter (where ir.status = 'active'),
      'released_reservations',
        count(distinct ir.id) filter (where ir.status = 'released'),
      'reservation_count', count(distinct ir.id),
      'settlement_count', count(distinct st.id),
      'participant_count', count(distinct p.id),
      'terminal_participants', count(distinct p.id) filter (
        where p.status = r.status
      )
    )
  from battle.rooms r
  left join battle.prepared_shares ps on ps.room_id = r.id
  left join battle.participants p on p.room_id = r.id
  left join battle.stakes s on s.room_id = r.id
  left join inventory.reservations ir
    on ir.kind = 'battle' and ir.reference_id = p.id
  left join battle.settlements st on st.room_id = r.id
  where r.status in ('cancelled', 'expired')
    or (
      r.status = 'voided'
      and exists (
        select 1
        from battle.events e
        where e.room_id = r.id
          and e.kind = 'voided'
          and e.public_payload->>'reason' = 'share_failed'
      )
    )
  group by r.id, r.status
  having count(distinct s.id) = 0
    or count(distinct p.id) not in (1, 2)
    or count(distinct s.id) <> count(distinct p.id)
    or count(distinct s.id) <> count(distinct s.id) filter (
      where s.status = 'refunded'
    )
    or exists (
      select 1
      from battle.stakes terminal_stake
      join battle.participants terminal_participant
        on terminal_participant.id = terminal_stake.participant_id
      left join battle.entry_tiers terminal_tier
        on terminal_tier.ruleset_id = r.ruleset_id
       and terminal_tier.id = r.entry_tier_id
      left join economy.ledger terminal_refund
        on terminal_refund.id = terminal_stake.refund_ledger_id
      where terminal_stake.room_id = r.id
        and (
          terminal_tier.id is null
          or terminal_stake.user_id <> terminal_participant.user_id
          or terminal_stake.amount <> terminal_tier.entry_fee
          or terminal_refund.id is null
          or terminal_refund.operation_id is distinct from
            terminal_participant.join_operation_id
          or terminal_refund.user_id is distinct from terminal_participant.user_id
          or terminal_refund.currency is distinct from 'KCOIN'
          or terminal_refund.amount is distinct from terminal_stake.amount
          or terminal_refund.reason is distinct from 'battle_stake_refund'
        )
    )
    or count(distinct ir.id) <> 3 * count(distinct p.id)
    or count(distinct ir.id) <> count(distinct ir.id) filter (
      where ir.status = 'released'
    )
    or count(distinct st.id) <> 0
    or count(distinct p.id) <> count(distinct p.id) filter (
      where p.status = r.status
    )
    or (
      r.status = 'voided'
      and (
        count(distinct ps.room_id) filter (where ps.status = 'failed') <> 1
        or
        count(distinct p.id) <> 1
        or count(distinct s.id) <> 1
      )
    )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_RESERVATION_MISMATCH', p.id::text,
    jsonb_build_object(
      'participant_status', p.status,
      'active_reservations', count(distinct r.id) filter (where r.status = 'active'),
      'team_members', count(distinct tm.id)
    )
  from battle.participants p
  left join battle.team_members tm on tm.participant_id = p.id
  left join inventory.reservations r
    on r.kind = 'battle' and r.reference_id = p.id
  group by p.id, p.status
  having (
    p.status in ('preparing_share', 'waiting', 'lobby', 'active')
    and (
      count(distinct r.id) filter (where r.status = 'active') <> 3
      or count(distinct tm.id) <> 3
    )
  ) or (
    p.status in ('finished', 'draw', 'cancelled', 'expired', 'voided')
    and count(distinct r.id) filter (where r.status = 'active') <> 0
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_ROOM_STATE_MISMATCH', r.id::text,
    jsonb_build_object(
      'status', r.status,
      'participants', count(distinct p.id),
      'current_round_no', r.current_round_no,
      'current_action_ordinal', r.current_action_ordinal,
      'unresolved_rounds',
      count(distinct (t.room_id, t.round_no)) filter (
        where t.room_id is not null and t.resolved_at is null
      )
    )
  from battle.rooms r
  left join battle.participants p on p.room_id = r.id
  left join battle.turns t on t.room_id = r.id
  group by r.id, r.status, r.current_round_no, r.current_action_ordinal
  having (
    r.status in (
      'lobby_waiting', 'lobby_countdown',
      'active_turn'
    )
    and count(distinct p.id) <> 2
  ) or (
    r.status in ('lobby_waiting', 'lobby_countdown')
    and (
      r.current_round_no <> 0
      or r.current_action_ordinal <> 0
      or count(distinct (t.room_id, t.round_no)) filter (
        where t.room_id is not null
      ) <> 0
    )
  ) or (
    r.status = 'active_turn'
    and (
      r.first_actor_side is null
      or r.active_actor_side is null
      or r.current_round_no not between 1 and 20
      or r.current_action_ordinal not between 1 and 2
      or r.phase_deadline is null
      or count(distinct (t.room_id, t.round_no)) filter (
        where t.round_no = r.current_round_no and t.resolved_at is null
      ) <> 1
    )
  )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_OUTBOX_STUCK', o.id::text,
    jsonb_build_object(
      'room_id', o.room_id,
      'attempt_count', o.attempt_count,
      'next_attempt_at', o.next_attempt_at
    )
  from battle.outbox o
  where o.published_at is null and o.attempt_count >= 5
    and o.next_attempt_at < now() - interval '5 minutes'
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_AUDIT_CHAIN_MISMATCH', h.room_id::text,
    jsonb_build_object(
      'head_sequence', h.last_sequence,
      'actual_sequence', coalesce(max(e.sequence), 0),
      'head_hash', h.last_hash,
      'actual_hash', coalesce(
        (array_agg(e.entry_hash order by e.sequence desc))[1],
        repeat('0', 64)
      )
    )
  from battle.audit_heads h
  left join battle.audit_entries e on e.room_id = h.room_id
  group by h.room_id, h.last_sequence, h.last_hash
  having h.last_sequence <> coalesce(max(e.sequence), 0)
    or h.last_hash <> coalesce(
      (array_agg(e.entry_hash order by e.sequence desc))[1],
      repeat('0', 64)
    )
    or exists (
      select 1
      from battle.audit_entries current_entry
      left join battle.audit_entries previous_entry
        on previous_entry.room_id = current_entry.room_id
       and previous_entry.sequence = current_entry.sequence - 1
      where current_entry.room_id = h.room_id
        and (
          current_entry.prior_hash <> case
            when current_entry.sequence = 1 then repeat('0', 64)
            else previous_entry.entry_hash
          end
          or current_entry.entry_hash <> encode(
            extensions.digest(
              convert_to(
                current_entry.prior_hash || jsonb_build_object(
                  'room_id', current_entry.room_id,
                  'sequence', current_entry.sequence,
                  'kind', current_entry.kind,
                  'payload', current_entry.payload,
                  'created_at', current_entry.created_at
                )::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
        )
    )
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;

  insert into operations.invariant_violations (code, subject, details)
  select
    'BATTLE_RULESET_CHECKSUM_MISMATCH', r.id,
    jsonb_build_object(
      'checksum', r.checksum,
      'rules_complete', battle.rules_complete(r.id)
    )
  from battle.rulesets r
  where r.status = 'active' and not battle.rules_complete(r.id)
  on conflict do nothing;
  get diagnostics v_added = row_count; v_count := v_count + v_added;
  return v_count;
end;
$$;

create or replace function battle.tick_health()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with configured_jobs as (
    select *
    from cron.job
    where jobname = 'battle-tick-v1'
  ),
  current_job as (
    select *
    from configured_jobs
    order by jobid desc
    limit 1
  ),
  latest_run as (
    select r.*
    from cron.job_run_details r
    join current_job j on j.jobid = r.jobid
    order by r.runid desc
    limit 1
  ),
  latest_success as (
    select r.*
    from cron.job_run_details r
    join current_job j on j.jobid = r.jobid
    where r.status = 'succeeded'
    order by r.runid desc
    limit 1
  ),
  latest_failure as (
    select r.*
    from cron.job_run_details r
    join current_job j on j.jobid = r.jobid
    where r.status = 'failed'
    order by r.runid desc
    limit 1
  ),
  scheduler as (
    select count(*)::integer as worker_count
    from pg_catalog.pg_stat_activity
    where application_name = 'pg_cron scheduler'
  )
  select jsonb_build_object(
    'job_name', 'battle-tick-v1',
    'observed_at', clock_timestamp(),
    'configured_job_count', (select count(*) from configured_jobs),
    'configured_correctly', (
      select count(*) = 1
        and bool_and(
          schedule = '1 second'
          and command = 'select battle.process_due(100);'
          and database = current_database()
          and username = 'postgres'
          and active
        )
      from configured_jobs
    ),
    'jobid', (select jobid from current_job),
    'schedule', (select schedule from current_job),
    'command', (select command from current_job),
    'database', (select database from current_job),
    'worker', (select username from current_job),
    'scheduler_count', (select worker_count from scheduler),
    'stale_after_seconds', 5,
    'retention_days', 7,
    'latest_run', (
      select jsonb_build_object(
        'runid', runid,
        'status', status,
        'return_summary', left(coalesce(return_message, ''), 240),
        'start_time', start_time,
        'end_time', end_time
      )
      from latest_run
    ),
    'latest_success', (
      select jsonb_build_object(
        'runid', runid,
        'start_time', start_time,
        'end_time', end_time
      )
      from latest_success
    ),
    'latest_failure', (
      select jsonb_build_object(
        'runid', runid,
        'status', status,
        'error_summary', left(coalesce(return_message, ''), 240),
        'error_sha256', encode(
          extensions.digest(
            convert_to(coalesce(return_message, ''), 'UTF8'),
            'sha256'
          ),
          'hex'
        ),
        'start_time', start_time,
        'end_time', end_time
      )
      from latest_failure
    ),
    'healthy', (
      select count(*) = 1
        and bool_and(
          schedule = '1 second'
          and command = 'select battle.process_due(100);'
          and database = current_database()
          and username = 'postgres'
          and active
        )
        and (select worker_count = 1 from scheduler)
        and exists (
          select 1
          from latest_success
          where end_time >= clock_timestamp() - interval '5 seconds'
        )
      from configured_jobs
    )
  )
$$;

create or replace function battle.monitor_tick_health(
  p_scan_from timestamptz,
  p_scan_to timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_health jsonb := battle.tick_health();
  v_failure cron.job_run_details%rowtype;
  v_failure_details jsonb;
  v_current_jobid bigint;
  v_last_detected_at timestamptz;
  v_recent_completed_count integer := 0;
  v_recent_success_count integer := 0;
  v_recent_failure_count integer := 0;
  v_latest_success_runid bigint;
  v_latest_success_end_time timestamptz;
  v_resolved_at timestamptz;
  v_count integer := 0;
  v_added integer := 0;
  v_updated integer := 0;
begin
  v_current_jobid := nullif(v_health->>'jobid', '')::bigint;

  if not coalesce((v_health->>'healthy')::boolean, false) then
    insert into operations.invariant_violations (code, subject, details)
    values ('BATTLE_TICK_UNHEALTHY', 'battle-tick-v1', v_health)
    on conflict do nothing;
    get diagnostics v_count = row_count;
  else
    update operations.invariant_violations
    set resolved_at = now()
    where code = 'BATTLE_TICK_UNHEALTHY'
      and subject = 'battle-tick-v1'
      and resolved_at is null;
  end if;

  select *
  into v_failure
  from cron.job_run_details
  where command = 'select battle.process_due(100);'
    and status = 'failed'
    and start_time >= coalesce(p_scan_from, p_scan_to - interval '10 minutes')
    and start_time < p_scan_to
  order by runid desc
  limit 1;

  if v_failure.runid is not null then
    v_failure_details := jsonb_build_object(
      'jobid', v_failure.jobid,
      'runid', v_failure.runid,
      'status', v_failure.status,
      'error_summary', left(coalesce(v_failure.return_message, ''), 240),
      'error_sha256', encode(
        extensions.digest(
          convert_to(coalesce(v_failure.return_message, ''), 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      'start_time', v_failure.start_time,
      'end_time', v_failure.end_time,
      'current_jobid', v_current_jobid,
      'source_is_current', v_failure.jobid = v_current_jobid
    );

    update operations.invariant_violations
    set details = (
      case
        when details ? 'first_failure' then details
        else details || jsonb_build_object('first_failure', details)
      end
    ) || jsonb_build_object(
      'latest_failure', v_failure_details,
      'last_detected_at', p_scan_to
    )
    where code = 'BATTLE_TICK_RUN_FAILED'
      and subject = 'battle-tick-v1'
      and resolved_at is null;
    get diagnostics v_updated = row_count;

    if v_updated = 0 then
      insert into operations.invariant_violations (code, subject, details)
      values (
        'BATTLE_TICK_RUN_FAILED',
        'battle-tick-v1',
        v_failure_details || jsonb_build_object(
          'first_failure', v_failure_details,
          'latest_failure', v_failure_details,
          'last_detected_at', p_scan_to
        )
      )
      on conflict do nothing;
      get diagnostics v_added = row_count;
      v_count := v_count + v_added;
    end if;
  else
    select coalesce(
      nullif(details->>'last_detected_at', '')::timestamptz,
      nullif(details->'latest_failure'->>'end_time', '')::timestamptz,
      nullif(details->>'end_time', '')::timestamptz,
      detected_at
    )
    into v_last_detected_at
    from operations.invariant_violations
    where code = 'BATTLE_TICK_RUN_FAILED'
      and subject = 'battle-tick-v1'
      and resolved_at is null
    order by detected_at
    limit 1;

    if v_last_detected_at is not null and v_current_jobid is not null then
      select
        count(*)::integer,
        count(*) filter (where recent.status = 'succeeded')::integer,
        max(recent.runid) filter (where recent.status = 'succeeded'),
        max(recent.end_time) filter (where recent.status = 'succeeded')
      into
        v_recent_completed_count,
        v_recent_success_count,
        v_latest_success_runid,
        v_latest_success_end_time
      from (
        select runid, status, end_time
        from cron.job_run_details
        where jobid = v_current_jobid
          and end_time is not null
        order by runid desc
        limit 2
      ) recent;

      select count(*)::integer
      into v_recent_failure_count
      from cron.job_run_details
      where jobid = v_current_jobid
        and status = 'failed'
        and end_time >= p_scan_to - interval '5 minutes'
        and end_time < p_scan_to;

      if coalesce((v_health->>'healthy')::boolean, false)
        and p_scan_to >= v_last_detected_at + interval '5 minutes'
        and v_recent_completed_count = 2
        and v_recent_success_count = 2
        and v_recent_failure_count = 0
      then
        v_resolved_at := clock_timestamp();
        update operations.invariant_violations
        set resolved_at = v_resolved_at,
            details = details || jsonb_build_object(
              'resolution', jsonb_build_object(
                'reason', 'current_job_stable',
                'jobid', v_current_jobid,
                'latest_success_runid', v_latest_success_runid,
                'latest_success_end_time', v_latest_success_end_time,
                'clean_window_seconds', 300,
                'resolved_at', v_resolved_at
              )
            )
        where code = 'BATTLE_TICK_RUN_FAILED'
          and subject = 'battle-tick-v1'
          and resolved_at is null;
      end if;
    end if;
  end if;
  return v_count;
end;
$$;

create or replace function battle.cleanup_operational_data(p_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits integer;
  v_outbox integer;
  v_tick_runs integer;
  v_ruleset_id text;
begin
  select id into v_ruleset_id from battle.rulesets where status = 'active';
  delete from battle.rate_limit_attempts
  where id in (
    select id from battle.rate_limit_attempts
    where attempted_at < now() - make_interval(
      secs => battle.rule_int(v_ruleset_id, 'rate_limit_retention_seconds')
    )
    order by attempted_at
    limit greatest(1, least(p_limit, 5000))
  );
  get diagnostics v_rate_limits = row_count;
  delete from battle.outbox
  where id in (
    select id from battle.outbox
    where status = 'published' and published_at < now() - interval '30 days'
    order by published_at
    limit greatest(1, least(p_limit, 5000))
  );
  get diagnostics v_outbox = row_count;
  delete from cron.job_run_details
  where runid in (
    select runid
    from cron.job_run_details
    where command = 'select battle.process_due(100);'
      and end_time < now() - interval '7 days'
    order by end_time
    limit 100000
  );
  get diagnostics v_tick_runs = row_count;
  return jsonb_build_object(
    'rate_limit_attempts_deleted', v_rate_limits,
    'published_outbox_deleted', v_outbox,
    'tick_runs_deleted', v_tick_runs
  );
end;
$$;

-- source: 50_market.sql
create table market.seller_listing_quotas (
  seller_id uuid primary key references identity.users(id) on delete cascade,
  business_date date not null default identity.utc_day(),
  daily_count integer not null default 0 check (daily_count between 0 and 200),
  lifetime_count integer not null default 0 check (lifetime_count between 0 and 20000),
  updated_at timestamptz not null default now(),
  check (daily_count <= lifetime_count)
);

create or replace function market.lock_listing_quota(p_seller_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_date date := identity.utc_day();
  v_quota market.seller_listing_quotas%rowtype;
begin
  insert into market.seller_listing_quotas (seller_id, business_date)
  values (p_seller_id, v_business_date)
  on conflict (seller_id) do nothing;

  select * into strict v_quota
  from market.seller_listing_quotas
  where seller_id = p_seller_id
  for update;

  if v_quota.business_date <> v_business_date then
    update market.seller_listing_quotas
    set business_date = v_business_date,
        daily_count = 0,
        updated_at = now()
    where seller_id = p_seller_id
    returning * into strict v_quota;
  end if;

  if v_quota.lifetime_count >= 20000 then
    perform api.raise_business_error(
      'MARKET_LIFETIME_LISTING_LIMIT',
      '账号累计上架次数已达上限'
    );
  end if;
  if v_quota.daily_count >= 200 then
    perform api.raise_business_error(
      'MARKET_DAILY_LISTING_LIMIT',
      '今日上架次数已用完'
    );
  end if;
end;
$$;

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
create index listings_operation_idx on market.listings (operation_id);

create or replace function market.purchase_quantity_limit()
returns bigint
language sql
immutable
security invoker
set search_path = ''
as $$
  select 100::bigint
$$;

revoke execute on function market.purchase_quantity_limit() from public, anon, authenticated, service_role;

create or replace function market.consume_listing_quota()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform market.lock_listing_quota(new.seller_id);
  update market.seller_listing_quotas
  set daily_count = daily_count + 1,
      lifetime_count = lifetime_count + 1,
      updated_at = now()
  where seller_id = new.seller_id;
  if not found then
    raise exception using errcode = '23514', message = 'MARKET_LISTING_QUOTA_MISSING';
  end if;
  return new;
end;
$$;

create trigger listings_quota_consume
before insert on market.listings
for each row execute function market.consume_listing_quota();

create table market.seller_template_supply (
  seller_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  active_quantity bigint not null check (active_quantity > 0),
  updated_at timestamptz not null default now(),
  primary key (seller_id, template_id)
);

create index seller_template_supply_template_idx on market.seller_template_supply (template_id, seller_id);

create table market.template_supply (
  template_id text primary key references catalog.templates(id),
  eligible_quantity bigint not null check (eligible_quantity > 0),
  updated_at timestamptz not null default now()
);

create or replace function market.change_positive_supply(
  p_scope text,
  p_seller_id uuid,
  p_template_id text,
  p_delta bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  if p_delta = 0 then
    return;
  end if;

  if p_scope = 'seller' then
    if p_delta > 0 then
      insert into market.seller_template_supply (seller_id, template_id, active_quantity)
      values (p_seller_id, p_template_id, p_delta)
      on conflict (seller_id, template_id) do update
      set active_quantity = market.seller_template_supply.active_quantity + excluded.active_quantity,
          updated_at = now();
      return;
    end if;

    select active_quantity into v_quantity
    from market.seller_template_supply
    where seller_id = p_seller_id and template_id = p_template_id
    for update;
    if v_quantity is null or v_quantity < -p_delta then
      raise exception using
        errcode = '23514',
        message = 'MARKET_SELLER_SUPPLY_UNDERFLOW',
        detail = jsonb_build_object(
          'seller_id', p_seller_id,
          'template_id', p_template_id,
          'current_quantity', v_quantity,
          'delta', p_delta
        )::text;
    elsif v_quantity = -p_delta then
      delete from market.seller_template_supply
      where seller_id = p_seller_id and template_id = p_template_id;
    else
      update market.seller_template_supply
      set active_quantity = active_quantity + p_delta, updated_at = now()
      where seller_id = p_seller_id and template_id = p_template_id;
    end if;
    return;
  end if;

  if p_scope <> 'template' or p_seller_id is not null then
    raise exception using errcode = '22023', message = 'MARKET_SUPPLY_SCOPE_INVALID';
  end if;
  if p_delta > 0 then
    insert into market.template_supply (template_id, eligible_quantity)
    values (p_template_id, p_delta)
    on conflict (template_id) do update
    set eligible_quantity = market.template_supply.eligible_quantity + excluded.eligible_quantity,
        updated_at = now();
    return;
  end if;

  select eligible_quantity into v_quantity
  from market.template_supply
  where template_id = p_template_id
  for update;
  if v_quantity is null or v_quantity < -p_delta then
    raise exception using
      errcode = '23514',
      message = 'MARKET_TEMPLATE_SUPPLY_UNDERFLOW',
      detail = jsonb_build_object(
        'template_id', p_template_id,
        'current_quantity', v_quantity,
        'delta', p_delta
      )::text;
  elsif v_quantity = -p_delta then
    delete from market.template_supply where template_id = p_template_id;
  else
    update market.template_supply
    set eligible_quantity = eligible_quantity + p_delta, updated_at = now()
    where template_id = p_template_id;
  end if;
end;
$$;

create or replace function market.change_listing_supply(
  p_seller_id uuid,
  p_template_id text,
  p_delta bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seller_is_eligible boolean;
begin
  if p_delta = 0 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('market.template-supply:' || p_template_id, 0));
  perform market.change_positive_supply('seller', p_seller_id, p_template_id, p_delta);
  select status = 'normal' into v_seller_is_eligible
  from identity.users
  where id = p_seller_id;
  if coalesce(v_seller_is_eligible, false) then
    perform market.change_positive_supply('template', null, p_template_id, p_delta);
  end if;
end;
$$;

create or replace function market.sync_listing_supply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_quantity bigint := 0;
  v_new_quantity bigint := 0;
begin
  if tg_op <> 'INSERT' and old.status = 'active' and old.remaining > 0 then
    v_old_quantity := old.remaining;
  end if;
  if tg_op <> 'DELETE' and new.status = 'active' and new.remaining > 0 then
    v_new_quantity := new.remaining;
  end if;

  if tg_op = 'UPDATE'
    and (old.seller_id is distinct from new.seller_id or old.template_id is distinct from new.template_id)
  then
    raise exception using errcode = '23514', message = 'MARKET_LISTING_SUPPLY_KEY_IMMUTABLE';
  end if;

  perform market.change_listing_supply(
    coalesce(new.seller_id, old.seller_id),
    coalesce(new.template_id, old.template_id),
    v_new_quantity - v_old_quantity
  );
  return coalesce(new, old);
end;
$$;

create trigger listings_supply_sync
after insert or delete or update of seller_id, template_id, remaining, status on market.listings
for each row execute function market.sync_listing_supply();

create or replace function market.recompute_template_supply(p_template_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('market.template-supply:' || p_template_id, 0));
  select coalesce(sum(s.active_quantity), 0)::bigint into v_quantity
  from market.seller_template_supply s
  join identity.users u on u.id = s.seller_id and u.status = 'normal'
  where s.template_id = p_template_id;
  if v_quantity = 0 then
    delete from market.template_supply where template_id = p_template_id;
  else
    insert into market.template_supply (template_id, eligible_quantity)
    values (p_template_id, v_quantity)
    on conflict (template_id) do update
    set eligible_quantity = excluded.eligible_quantity, updated_at = now();
  end if;
end;
$$;

create or replace function market.sync_user_status_supply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template_id text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;
  for v_template_id in
    select affected.template_id
    from (
      select supply.template_id
      from market.seller_template_supply supply
      where supply.seller_id = new.id
      union
      select listing.template_id
      from market.listings listing
      where listing.seller_id = new.id and listing.status = 'active' and listing.remaining > 0
    ) affected
    order by affected.template_id
  loop
    perform market.recompute_template_supply(v_template_id);
  end loop;
  return new;
end;
$$;

create trigger users_market_supply_status_sync
after update of status on identity.users
for each row
when (old.status is distinct from new.status)
execute function market.sync_user_status_supply();

create or replace function market.rebuild_supply()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller_rows integer;
  v_template_rows integer;
begin
  lock table identity.users in share mode;
  lock table market.listings in share mode;
  lock table market.seller_template_supply in access exclusive mode;
  lock table market.template_supply in access exclusive mode;

  delete from market.template_supply;
  delete from market.seller_template_supply;

  insert into market.seller_template_supply (seller_id, template_id, active_quantity)
  select seller_id, template_id, sum(remaining)::bigint
  from market.listings
  where status = 'active' and remaining > 0
  group by seller_id, template_id;
  get diagnostics v_seller_rows = row_count;

  insert into market.template_supply (template_id, eligible_quantity)
  select supply.template_id, sum(supply.active_quantity)::bigint
  from market.seller_template_supply supply
  join identity.users users on users.id = supply.seller_id and users.status = 'normal'
  group by supply.template_id;
  get diagnostics v_template_rows = row_count;

  return jsonb_build_object(
    'seller_template_rows', v_seller_rows,
    'template_rows', v_template_rows
  );
end;
$$;

revoke execute on function market.rebuild_supply() from public, anon, authenticated, service_role;

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

create table market.seller_sale_sequences (
  seller_id uuid primary key references identity.users(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  updated_at timestamptz not null default now()
);

create table market.seller_sale_events (
  seller_id uuid not null references identity.users(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  trade_id uuid not null references market.trades(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  unit_price bigint not null check (unit_price > 0),
  sold_at timestamptz not null default now(),
  primary key (seller_id, sequence),
  unique (seller_id, trade_id)
);

create index seller_sale_events_trade_idx on market.seller_sale_events (trade_id);
create index seller_sale_events_template_idx on market.seller_sale_events (template_id);

create or replace function api.market_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_business_date date := identity.utc_day();
  v_daily_used integer;
  v_lifetime_used integer;
begin
  select
    coalesce(max(case when quota.business_date = v_business_date then quota.daily_count else 0 end), 0),
    coalesce(max(quota.lifetime_count), 0)
  into v_daily_used, v_lifetime_used
  from market.seller_listing_quotas quota
  where quota.seller_id = v_user_id;

  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'unit_price', t.market_price,
        'available_quantity', greatest(supply.eligible_quantity - coalesce(own.active_quantity, 0), 0),
        'own_listed_quantity', coalesce(own.active_quantity, 0)
      ) order by t.sort_order)
      from market.template_supply supply
      join catalog.templates t on t.id = supply.template_id
      left join market.seller_template_supply own
        on own.seller_id = v_user_id and own.template_id = supply.template_id
    ), '[]'::jsonb),
    'sellable_items', coalesce((
      with user_items as materialized (
        select item.*
        from inventory.item_read_model item
        where item.user_id = v_user_id and item.available > 0
      )
      select jsonb_agg(
        inventory.present_item(item)
          || jsonb_build_object('unit_price', item.market_price)
        order by item.sort_order
      )
      from user_items item
    ), '[]'::jsonb),
    'vip', vip.status_json(v_user_id),
    'listing_quota', jsonb_build_object(
      'business_date', v_business_date,
      'daily_used', v_daily_used,
      'daily_limit', 200,
      'daily_remaining', 200 - v_daily_used,
      'lifetime_used', v_lifetime_used,
      'lifetime_limit', 20000,
      'lifetime_remaining', 20000 - v_lifetime_used
    ),
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
    'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
    'unit_price', t.market_price,
    'available_quantity', greatest(coalesce(supply.eligible_quantity, 0) - coalesce(own.active_quantity, 0), 0),
    'own_listed_quantity', coalesce(own.active_quantity, 0)
  ) into v_result
  from catalog.templates t
  left join market.template_supply supply on supply.template_id = t.id
  left join market.seller_template_supply own
    on own.seller_id = v_user_id and own.template_id = t.id
  where t.id = p_template_id;
  if v_result is null then
    perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.market_my_listings(
  p_session_id uuid,
  p_after_sale_sequence bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_latest_sequence bigint;
  v_after_sequence bigint;
  v_sale_cursor bigint;
  v_sold_events jsonb := '[]'::jsonb;
  v_has_more boolean := false;
begin
  select coalesce(last_sequence, 0)
  into v_latest_sequence
  from market.seller_sale_sequences
  where seller_id = v_user_id
  for share;
  v_latest_sequence := coalesce(v_latest_sequence, 0);

  if p_after_sale_sequence is null then
    v_sale_cursor := v_latest_sequence;
  else
    v_after_sequence := least(greatest(p_after_sale_sequence, 0), v_latest_sequence);
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'sale_sequence', e.sequence::text,
        'template_id', e.template_id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'quantity', e.quantity,
        'unit_price', e.unit_price,
        'sold_at', e.sold_at
      ) order by e.sequence), '[]'::jsonb),
      coalesce(max(e.sequence), v_after_sequence)
    into v_sold_events, v_sale_cursor
    from (
      select *
      from market.seller_sale_events
      where seller_id = v_user_id and sequence > v_after_sequence
      order by sequence
      limit 100
    ) e
    join catalog.templates t on t.id = e.template_id;
    select exists (
      select 1
      from market.seller_sale_events
      where seller_id = v_user_id and sequence > v_sale_cursor
    ) into v_has_more;
  end if;

  return jsonb_build_object(
    'listings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', supply.template_id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
        'listed_quantity', supply.active_quantity,
        'unit_price', t.market_price
      ) order by t.sort_order)
      from market.seller_template_supply supply
      join catalog.templates t on t.id = supply.template_id
      where supply.seller_id = v_user_id
    ), '[]'::jsonb),
    'sold_events', v_sold_events,
    'sale_cursor', v_sale_cursor::text,
    'has_more', v_has_more
  );
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
  perform market.lock_listing_quota(v_user_id);
  begin
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
    perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':market-listings', 0));
    select count(*) into v_active_count
    from market.seller_template_supply
    where seller_id = v_user_id;
    if v_active_count >= 10 and not exists (
      select 1 from market.seller_template_supply
      where seller_id = v_user_id and template_id = p_template_id
    ) then
      perform api.raise_business_error('MARKET_ACTIVE_TEMPLATE_LIMIT', '最多同时出售 10 种藏品，请先售罄或下架一种藏品');
    end if;
    insert into market.seller_sale_sequences (seller_id)
    values (v_user_id)
    on conflict (seller_id) do nothing;
    insert into market.listings (seller_id, template_id, unit_price, quantity, remaining, operation_id)
    values (v_user_id, p_template_id, v_template.market_price, p_quantity, p_quantity, p_operation_id) returning * into v_listing;
    perform inventory.reserve(v_user_id, p_template_id, p_quantity, 'listing', v_listing.id);
    perform tasks.progress(v_user_id, 'market_list');
    v_result := jsonb_build_object('listing_id', v_listing.id, 'template_id', p_template_id, 'name', v_template.name, 'rarity', v_template.rarity, 'image_thumbnail_url', catalog.template_thumbnail_url(v_template.id), 'quantity', p_quantity, 'unit_price', v_template.market_price, 'created_at', v_listing.created_at);
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
  v_candidate_ids uuid[] := array[]::uuid[];
  v_trade_id uuid;
  v_available bigint;
  v_remaining bigint;
  v_take bigint;
  v_gross bigint;
  v_fee bigint;
  v_rebate bigint;
  v_total bigint;
  v_details jsonb := '[]'::jsonb;
  v_sale record;
  v_sale_sequence bigint;
  v_result jsonb;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'market.purchase', p_operation_id, jsonb_build_object('template_id', p_template_id, 'quantity', p_quantity));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    if p_quantity is null
      or p_quantity < 1
      or p_quantity > market.purchase_quantity_limit()
    then
      perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场单次购买数量必须在 1 到 100 之间');
    end if;
    select * into v_template from catalog.templates where id = p_template_id;
    if v_template.id is null then perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在'); end if;
    perform pg_advisory_xact_lock(hashtextextended('market.purchase:' || p_template_id, 0));
    v_available := 0;
    for v_listing in
      select l.* from market.listings l join identity.users u on u.id = l.seller_id
      where l.template_id = p_template_id and l.status = 'active' and l.remaining > 0 and l.seller_id <> v_user_id and u.status = 'normal'
      order by l.created_at, l.id
      limit p_quantity
      for update of l
    loop
      v_candidate_ids := array_append(v_candidate_ids, v_listing.id);
      v_available := v_available + v_listing.remaining;
    end loop;
    if v_available < p_quantity then perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足'); end if;
    v_total := v_template.market_price * p_quantity;
    perform economy.change_balance(v_user_id, 'KCOIN', -v_total, 'market_buy', p_operation_id, p_template_id);
    insert into market.trades (buyer_id, template_id, quantity, total_price, operation_id)
    values (v_user_id, p_template_id, p_quantity, v_total, p_operation_id) returning id into v_trade_id;
    v_remaining := p_quantity;
    for v_listing in
      select l.* from market.listings l
      where l.id = any(v_candidate_ids)
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
    if v_remaining <> 0 then
      perform api.raise_business_error('MARKET_STOCK_INSUFFICIENT', '市场可购买数量不足');
    end if;
    for v_sale in
      select seller_id, sum(quantity)::bigint quantity
      from market.trade_details
      where trade_id = v_trade_id
      group by seller_id
      order by seller_id
    loop
      insert into market.seller_sale_sequences (seller_id)
      values (v_sale.seller_id)
      on conflict (seller_id) do nothing;
      update market.seller_sale_sequences
      set last_sequence = last_sequence + 1, updated_at = now()
      where seller_id = v_sale.seller_id
      returning last_sequence into v_sale_sequence;
      insert into market.seller_sale_events (
        seller_id,
        sequence,
        trade_id,
        template_id,
        quantity,
        unit_price
      ) values (
        v_sale.seller_id,
        v_sale_sequence,
        v_trade_id,
        p_template_id,
        v_sale.quantity,
        v_template.market_price
      );
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
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'delivered', 'failed', 'cancelled', 'expired', 'refunded', 'rejected', 'payment_identity_conflict')),
  invoice_payload text not null unique check (btrim(invoice_payload) <> ''),
  invoice_url text,
  pre_checkout_query_id text unique check (pre_checkout_query_id is null or btrim(pre_checkout_query_id) <> ''),
  verified_payer_telegram_id bigint check (verified_payer_telegram_id > 0),
  telegram_payment_charge_id text unique check (telegram_payment_charge_id is null or btrim(telegram_payment_charge_id) <> ''),
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  checkout_started_at timestamptz,
  paid_at timestamptz,
  delivered_at timestamptz,
  payment_identity_conflict_at timestamptz,
  payment_identity_conflict_reason text check (
    payment_identity_conflict_reason in (
      'successful_payment_payer_missing',
      'successful_payment_payer_mismatch'
    )
  ),
  failed_at timestamptz,
  cancelled_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status not in ('processing', 'paid', 'delivered', 'payment_identity_conflict', 'refunded')
    or (
      pre_checkout_query_id is not null
      and verified_payer_telegram_id is not null
      and checkout_started_at is not null
    )
  ),
  check (
    status not in ('paid', 'delivered', 'payment_identity_conflict', 'refunded')
    or (telegram_payment_charge_id is not null and paid_at is not null)
  ),
  check (status <> 'delivered' or delivered_at is not null),
  check (
    (payment_identity_conflict_at is null and payment_identity_conflict_reason is null)
    or (
      payment_identity_conflict_at is not null
      and payment_identity_conflict_reason is not null
      and status in ('payment_identity_conflict', 'refunded')
      and delivered_at is null
    )
  ),
  check (
    status <> 'payment_identity_conflict'
    or (
      payment_identity_conflict_at is not null
      and payment_identity_conflict_reason is not null
      and delivered_at is null
    )
  )
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
    'intent', nullif(
      p_order.intent - 'battle_invite_token_hash',
      '{}'::jsonb
    )
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
  v_battle_ruleset battle.rulesets%rowtype;
  v_battle_tier battle.entry_tiers%rowtype;
  v_battle_room battle.rooms%rowtype;
  v_battle_session identity.sessions%rowtype;
  v_battle_creator identity.users%rowtype;
  v_battle_room_id uuid;
  v_order payments.orders%rowtype;
  v_stale payments.orders%rowtype;
  v_result jsonb;
  v_normalized_intent jsonb := coalesce(p_intent, '{}'::jsonb);
  v_market_quantity bigint;
  v_detail text;
begin
  v_operation := operations.begin_command(p_session_id, 'topup.create_order', p_operation_id, jsonb_strip_nulls(jsonb_build_object('mode', p_mode, 'amount', p_amount, 'intent', p_intent)));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('evomypet:payment:' || v_user_id::text || ':kcoin_topup', 0));
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
      if jsonb_typeof(p_intent) <> 'object' then
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      if p_intent->>'kind' = 'gacha' then
        v_tier := p_intent->>'tier'; v_count := (p_intent->>'draw_count')::integer;
        select * into v_box from gacha.boxes where tier = v_tier;
        if v_box.tier is null or v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '开盒补差意图无效'); end if;
        v_required := case when v_count = 10 then v_box.ten_price else v_box.single_price end;
        if v_count = 1 and v_tier in ('normal', 'rare') and exists (
          select 1 from economy.entitlements where user_id = v_user_id and kind = case v_tier when 'normal' then 'free_normal_box' else 'free_rare_box' end and status = 'unused'
        ) then v_required := 0; end if;
      elsif p_intent->>'kind' = 'market' then
        if jsonb_typeof(p_intent->'quantity') is distinct from 'number'
           or (p_intent->>'quantity') !~ '^[1-9][0-9]{0,2}$'
        then
          perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '市场补差意图无效');
        end if;
        v_market_quantity := (p_intent->>'quantity')::bigint;
        if v_market_quantity > market.purchase_quantity_limit() then
          perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '市场补差意图无效');
        end if;
        v_count := v_market_quantity::integer;
        select * into v_template from catalog.templates where id = p_intent->>'template_id';
        if v_template.id is null then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '市场补差意图无效'); end if;
        v_required := v_template.market_price * v_count;
        v_normalized_intent := jsonb_build_object(
          'kind', 'market',
          'template_id', v_template.id,
          'quantity', v_count
        );
      elsif p_intent->>'kind' = 'wheel' then
        v_count := (p_intent->>'count')::integer;
        if v_count not in (1, 10) then perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '转盘补差意图无效'); end if;
        v_required := case when v_count = 10 then 180 else 20 end;
      elsif p_intent->>'kind' in ('battle_create', 'battle_matchmaking') then
        select * into v_battle_ruleset
        from battle.rulesets
        where status = 'active';
        if v_battle_ruleset.id is null
           or not battle.rules_complete(v_battle_ruleset.id) then
          perform api.raise_business_error(
            'BATTLE_RULESET_UNAVAILABLE',
            'Battle 规则暂不可用，请稍后重试'
          );
        end if;
        select * into v_battle_tier
        from battle.entry_tiers
        where ruleset_id = v_battle_ruleset.id
          and id = p_intent->>'tier';
        if v_battle_tier.id is null then
          perform api.raise_business_error('BATTLE_TIER_INVALID', 'Battle 入场档位无效');
        end if;
        perform pg_advisory_xact_lock(
          hashtextextended('battle-user:' || v_user_id::text, 0)
        );
        if exists (
          select 1
          from battle.participants
          where user_id = v_user_id
            and status in ('preparing_share', 'waiting', 'lobby', 'active')
        ) then
          perform api.raise_business_error(
            'BATTLE_ALREADY_PARTICIPATING',
            '当前已有未结束的 Battle'
          );
        end if;
        perform battle.validate_team_selection(
          v_user_id,
          v_battle_ruleset.id,
          p_intent->'template_ids'
        );
        v_required := v_battle_tier.entry_fee;
        v_normalized_intent := jsonb_build_object(
          'kind', p_intent->>'kind',
          'tier', v_battle_tier.id,
          'template_ids', p_intent->'template_ids'
        );
      elsif p_intent->>'kind' = 'battle_accept' then
        if p_intent->>'room_id' is null
           or p_intent->>'room_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        v_battle_room_id := (p_intent->>'room_id')::uuid;
        select * into v_battle_session
        from identity.sessions
        where id = p_session_id
          and user_id = v_user_id
          and entry_kind = 'battle'
          and battle_invite_token_hash is not null
          and revoked_at is null
          and expires_at > now();
        if v_battle_session.id is null then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        select * into v_battle_room
        from battle.rooms
        where id = v_battle_room_id
          and invite_token_hash = v_battle_session.battle_invite_token_hash
        for update;
        if v_battle_room.id is null then
          perform api.raise_business_error('BATTLE_INVITE_INVALID', '挑战已失效');
        end if;
        select * into v_battle_creator
        from identity.users
        where id = v_battle_room.creator_user_id
        for update;
        if v_battle_room.status = 'expired' then
          perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
        elsif v_battle_room.status = 'cancelled' then
          perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
        elsif v_battle_room.status = 'voided' then
          perform api.raise_business_error(
            'BATTLE_VOIDED',
            'Battle 已安全作废，入场费和藏品已恢复'
          );
        elsif v_battle_room.status <> 'waiting' then
          perform api.raise_business_error(
            'BATTLE_ROOM_ALREADY_ACCEPTED',
            '挑战已被其他玩家接受'
          );
        elsif v_battle_room.expires_at <= now() then
          perform api.raise_business_error('BATTLE_ROOM_EXPIRED', '挑战已过期');
        elsif v_battle_creator.status = 'banned' then
          perform api.raise_business_error('BATTLE_ROOM_CANCELLED', '挑战已取消');
        elsif v_battle_room.creator_user_id = v_user_id then
          perform api.raise_business_error(
            'BATTLE_SELF_ACCEPT_FORBIDDEN',
            '不能接受自己创建的挑战'
          );
        end if;
        if exists (
          select 1
          from battle.participants
          where user_id = v_user_id
            and status in ('preparing_share', 'waiting', 'lobby', 'active')
        ) then
          perform api.raise_business_error(
            'BATTLE_ALREADY_PARTICIPATING',
            '当前已有未结束的 Battle'
          );
        end if;
        perform battle.validate_team_selection(
          v_user_id,
          v_battle_room.ruleset_id,
          p_intent->'template_ids'
        );
        select * into v_battle_tier
        from battle.entry_tiers
        where ruleset_id = v_battle_room.ruleset_id
          and id = v_battle_room.entry_tier_id;
        if v_battle_tier.id is null then
          perform api.raise_business_error(
            'BATTLE_RULESET_UNAVAILABLE',
            'Battle 规则暂不可用，请稍后重试'
          );
        end if;
        v_required := v_battle_tier.entry_fee;
        v_normalized_intent := jsonb_build_object(
          'kind', 'battle_accept',
          'room_id', v_battle_room.id,
          'template_ids', p_intent->'template_ids',
          'battle_invite_token_hash',
          v_battle_session.battle_invite_token_hash
        );
      else
        perform api.raise_business_error('TOPUP_AMOUNT_INVALID', '补差意图无效');
      end if;
      select available into v_balance
      from economy.balances
      where user_id = v_user_id and currency = 'KCOIN'
      for update;
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
    values (v_user_id, p_operation_id, 'kcoin_topup', v_required, v_required, 'evomypet:' || extensions.gen_random_uuid(), v_normalized_intent, now() + interval '15 minutes')
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
    perform pg_advisory_xact_lock(hashtextextended('evomypet:payment:' || v_user_id::text || ':vip', 0));
    v_status := vip.status_json(v_user_id);
    if not coalesce((v_status->>'can_purchase')::boolean, false) and not coalesce((v_status->>'can_renew')::boolean, false) then perform api.raise_business_error('VIP_RENEWAL_LIMIT', '月卡续费次数已达上限'); end if;
    if exists (select 1 from payments.orders where user_id = v_user_id and kind = 'vip' and status in ('pending', 'processing', 'paid')) then perform api.raise_business_error('PAYMENT_ALREADY_PENDING', '已有待处理月卡订单'); end if;
    insert into payments.orders (user_id, operation_id, kind, stars_amount, invoice_payload, expires_at)
    values (v_user_id, p_operation_id, 'vip', payments.vip_stars_price(), 'evomypet:' || extensions.gen_random_uuid(), now() + interval '15 minutes') returning * into v_order;
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
    perform pg_advisory_xact_lock(hashtextextended('evomypet:payment:' || v_user_id::text || ':kcoin_topup', 0));
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

create or replace function api.vip_cancel_order(p_session_id uuid, p_operation_id uuid, p_order_id uuid)
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
  v_operation := operations.begin_command(p_session_id, 'vip.cancel_order', p_operation_id, jsonb_build_object('order_id', p_order_id));
  v_replay := operations.replay_if_finished(v_operation);
  if v_replay is not null then return v_replay; end if;
  v_user_id := v_operation.user_id;
  begin
    perform pg_advisory_xact_lock(hashtextextended('evomypet:payment:' || v_user_id::text || ':vip', 0));
    select * into v_order from payments.orders
    where id = p_order_id and user_id = v_user_id and kind = 'vip'
    for update;
    if v_order.id is null then perform api.raise_business_error('PAYMENT_NOT_FOUND', '支付订单不存在'); end if;
    if v_order.status = 'pending' and v_order.checkout_started_at is null then
      update payments.orders set status = 'cancelled', cancelled_at = now(), updated_at = now()
      where id = v_order.id returning * into v_order;
    elsif v_order.status in ('pending', 'processing', 'paid') then
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
    perform pg_advisory_xact_lock(hashtextextended('evomypet:payment:' || v_user_id::text || ':kcoin_topup', 0));
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

create index vip_claims_operation_idx on vip.claims (operation_id);

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
  where p.user_id = v_user_id and p.kind = 'vip' and p.status in ('pending', 'processing', 'paid', 'payment_identity_conflict')
  order by p.created_at desc limit 1;
  return vip.status_json(v_user_id) || jsonb_build_object(
    'stars_price', payments.vip_stars_price(),
    'free_rare_box_available', (
      select count(*) from economy.entitlements
      where user_id = v_user_id and kind = 'free_rare_box' and status = 'unused'
    ),
    'payment_attention_order', v_pending
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
  sort_order smallint not null unique check (sort_order between 1 and 17),
  category text not null check (category in ('gacha', 'daily', 'market', 'inventory', 'expedition', 'album', 'wallet', 'mint')),
  title text not null check (btrim(title) <> ''),
  description text not null check (btrim(description) <> ''),
  completion_action text not null check (completion_action in ('gacha_single', 'gacha_ten', 'wheel', 'market_buy', 'market_sell', 'market_manage', 'inventory_evolution', 'inventory_decomposition', 'expedition_normal', 'expedition_intermediate', 'expedition_advanced', 'album', 'wallet', 'inventory_mint')),
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
create index task_progress_claim_operation_idx
on tasks.daily_progress (claim_operation_id)
where claim_operation_id is not null;

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
create index referrals_reward_operation_idx
on referral.relationships (reward_operation_id)
where reward_operation_id is not null;

create table referral.milestones (
  user_id uuid not null references identity.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null references operations.operations(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);

create index referral_milestones_operation_idx on referral.milestones (operation_id);

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
    'share_text', '邀请好友一起开盲盒。好友通过你的链接加入并完成首次有效充值后，你可获得500 Gems；累计邀请5位有效充值好友可额外获得1次免费普通盲盒资格，累计邀请10位有效充值好友可额外获得1次免费稀有盲盒资格。',
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
  where user_id = p_user_id
    and (id = p_session_id or revoked_at is null);
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
      where user_id = v_operation.user_id
        and (id = p_session_id or revoked_at is null);
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
  where user_id = v_user_id
    and (id = p_session_id or revoked_at is null);
  v_result := jsonb_build_object('bound', true, 'referral_code', p_code);
  return operations.complete_command(p_operation_id, v_result);
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
create index album_nodes_first_operation_idx
on album.nodes (first_operation_id)
where first_operation_id is not null;

create table album.rewards (
  user_id uuid not null references identity.users(id) on delete cascade,
  chain_id text not null references catalog.chains(id),
  operation_id uuid not null references operations.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, chain_id)
);

create index album_rewards_operation_idx on album.rewards (operation_id);

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
          'image_thumbnail_url', catalog.template_thumbnail_url(t.id),
          'image_detail_url', catalog.template_detail_url(t.id),
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
create or replace function api.catalog_current()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', version.product_checksum,
    'asset_revision', current_release.revision,
    'release_key', release.release_key
  )
  into v_result
  from catalog.current_asset_release current_release
  join catalog.asset_releases release
    on release.id = current_release.release_id
   and release.status = 'active'
  cross join catalog.versions version
  where current_release.singleton
    and version.id = 'v1';

  if v_result is null then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  return v_result;
end
$$;

create or replace function api.catalog_release(
  p_product_checksum text,
  p_release_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_result jsonb;
begin
  if p_product_checksum is null
    or p_product_checksum !~ '^[0-9a-f]{64}$'
    or p_release_key is null
    or p_release_key !~ '^[a-z0-9][a-z0-9._-]{2,127}$'
    or not exists (
      select 1
      from catalog.versions version
      where version.id = 'v1'
        and version.product_checksum = p_product_checksum
    )
  then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  select release.id
  into v_release_id
  from catalog.asset_releases release
  where release.release_key = p_release_key
    and release.status in ('active', 'retired');

  if v_release_id is null then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  select jsonb_build_object(
    'version', 'v1',
    'product_checksum', p_product_checksum,
    'release_key', p_release_key,
    'chains', coalesce((
      select jsonb_agg(to_jsonb(chain) order by chain.global_order)
      from catalog.chains chain
      where chain.catalog_version = 'v1'
    ), '[]'::jsonb),
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', template.id,
        'chain_id', template.chain_id,
        'stage', template.stage,
        'rarity', template.rarity,
        'name', template.name,
        'sort_order', template.sort_order,
        'combat_power', template.combat_power,
        'market_price', template.market_price,
        'decompose_fgems', template.decompose_fgems,
        'expedition_fgems', template.expedition_fgems,
        'image_thumbnail_url', config.public_origin || '/' || config.public_bucket || '/' || thumbnail.object_key,
        'image_detail_url', config.public_origin || '/' || config.public_bucket || '/' || detail.object_key,
        'draw_weight', template.draw_weight,
        'catalog_version', template.catalog_version
      ) order by template.sort_order)
      from catalog.asset_release_templates item
      join catalog.templates template
        on template.id = item.template_id
       and template.catalog_version = 'v1'
      join catalog.asset_objects thumbnail
        on thumbnail.id = item.thumbnail_object_id
       and thumbnail.object_class = 'runtime'
       and thumbnail.status = 'active'
       and thumbnail.width = 256
       and thumbnail.object_key ~ '^catalog/v[12]/thumb/'
      join catalog.asset_objects detail
        on detail.id = item.detail_object_id
       and detail.object_class = 'runtime'
       and detail.status = 'active'
       and detail.width = 768
       and detail.object_key ~ '^catalog/v[12]/detail/'
      cross join catalog.asset_delivery_config config
      where item.release_id = v_release_id
        and config.singleton
        and thumbnail.bucket = config.public_bucket
        and detail.bucket = config.public_bucket
    ), '[]'::jsonb),
    'boxes', coalesce((
      select jsonb_agg(to_jsonb(box) order by case box.tier when 'normal' then 1 when 'rare' then 2 else 3 end)
      from gacha.boxes box
    ), '[]'::jsonb),
    'topup_products', coalesce((
      select jsonb_agg(product.amount order by product.sort_order)
      from payments.topup_products product
    ), '[]'::jsonb)
  )
  into v_result;

  if jsonb_array_length(v_result->'chains') <> 70
    or jsonb_array_length(v_result->'templates') <> 210
    or jsonb_array_length(v_result->'boxes') <> 3
    or jsonb_array_length(v_result->'topup_products') <> 5
  then
    perform api.raise_business_error('CATALOG_UNAVAILABLE', '图鉴数据暂时不可用');
  end if;

  return v_result;
end
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
    perform pg_advisory_xact_lock(hashtextextended('evomypet:mint:' || v_user_id::text || ':' || p_template_id, 0));
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
  perform pg_advisory_xact_lock(hashtextextended('evomypet:referral-reward:' || v_referral.inviter_id::text, 0));
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
  if v_order.status = 'payment_identity_conflict' then perform api.raise_business_error('PAYMENT_NOT_DELIVERABLE', '支付身份校验异常，订单不可交付'); end if;
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
  select jsonb_build_object(
    'id', o.id,
    'invoice_payload', o.invoice_payload,
    'stars_amount', o.stars_amount,
    'kind', o.kind,
    'preferred_language', u.preferred_language
  )
  from payments.orders o
  join identity.users u on u.id = o.user_id
  where o.id = p_order_id and o.status = 'pending'
$$;

create or replace function api.payment_begin_checkout(
  p_pre_checkout_query_id text,
  p_invoice_payload text,
  p_stars bigint,
  p_payer_telegram_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_user identity.users%rowtype;
  v_preferred_language text := 'en';
begin
  select u.preferred_language
  into v_preferred_language
  from identity.users u
  where u.telegram_id = p_payer_telegram_id;
  v_preferred_language := coalesce(v_preferred_language, 'en');
  if p_pre_checkout_query_id is null
     or btrim(p_pre_checkout_query_id) = ''
     or p_invoice_payload is null
     or btrim(p_invoice_payload) = ''
     or p_stars is null
     or p_stars <= 0
  then
    return jsonb_build_object('valid', false, 'payment_id', null, 'preferred_language', v_preferred_language);
  end if;
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null or v_order.stars_amount <> p_stars then
    return jsonb_build_object('valid', false, 'payment_id', null, 'preferred_language', v_preferred_language);
  end if;
  select * into v_user from identity.users where id = v_order.user_id for update;
  v_preferred_language := v_user.preferred_language;
  if p_payer_telegram_id is null
     or p_payer_telegram_id <= 0
     or v_user.telegram_id <> p_payer_telegram_id
  then
    return jsonb_build_object('valid', false, 'payment_id', v_order.id, 'preferred_language', v_preferred_language);
  end if;
  if v_order.status = 'processing'
     and v_order.pre_checkout_query_id = p_pre_checkout_query_id
     and v_order.verified_payer_telegram_id = p_payer_telegram_id
  then
    return jsonb_build_object('valid', true, 'payment_id', v_order.id, 'preferred_language', v_preferred_language);
  end if;
  if v_order.status <> 'pending' or v_order.pre_checkout_query_id is not null or v_order.expires_at <= now() or v_user.status <> 'normal' then
    return jsonb_build_object('valid', false, 'payment_id', v_order.id, 'preferred_language', v_preferred_language);
  end if;
  update payments.orders
  set status = 'processing', pre_checkout_query_id = p_pre_checkout_query_id,
      verified_payer_telegram_id = p_payer_telegram_id,
      checkout_started_at = now(), updated_at = now()
  where id = v_order.id;
  return jsonb_build_object('valid', true, 'payment_id', v_order.id, 'preferred_language', v_preferred_language);
end;
$$;

create or replace function api.payment_apply_success(
  p_update_id text,
  p_invoice_payload text,
  p_telegram_charge_id text,
  p_provider_charge_id text,
  p_stars bigint,
  p_payer_telegram_id bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order payments.orders%rowtype;
  v_event_payload jsonb;
begin
  if p_update_id is null
     or btrim(p_update_id) = ''
     or p_invoice_payload is null
     or btrim(p_invoice_payload) = ''
     or p_telegram_charge_id is null
     or btrim(p_telegram_charge_id) = ''
     or p_stars is null
     or p_stars <= 0
     or p_payload is null
  then
    perform api.raise_business_error('PAYMENT_MISMATCH', '支付通知参数不完整');
  end if;
  insert into operations.webhook_events (provider, event_id, payload) values ('telegram_update', p_update_id, p_payload) on conflict do nothing;
  if not found then
    select payload into v_event_payload
    from operations.webhook_events
    where provider = 'telegram_update' and event_id = p_update_id;
    if v_event_payload is distinct from p_payload then
      perform api.raise_business_error('PAYMENT_MISMATCH', '支付通知内容不一致');
    end if;
    select * into v_order
    from payments.orders
    where invoice_payload = p_invoice_payload
    for update;
    if v_order.id is null
       or v_order.stars_amount <> p_stars
       or v_order.telegram_payment_charge_id is distinct from p_telegram_charge_id
    then
      perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单不匹配');
    end if;
    return jsonb_build_object(
      'duplicate', true,
      'order', case
        when v_order.status = 'paid' then payments.deliver(v_order.id)
        else payments.order_json(v_order)
      end
    );
  end if;
  select * into v_order from payments.orders where invoice_payload = p_invoice_payload for update;
  if v_order.id is null
     or v_order.stars_amount <> p_stars
     or v_order.pre_checkout_query_id is null
     or v_order.verified_payer_telegram_id is null
     or v_order.checkout_started_at is null
  then
    perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单不匹配');
  end if;
  if v_order.telegram_payment_charge_id = p_telegram_charge_id then
    update operations.webhook_events set processed_at = now() where provider = 'telegram_update' and event_id = p_update_id;
    return jsonb_build_object('duplicate', true, 'order', case when v_order.status = 'paid' then payments.deliver(v_order.id) else payments.order_json(v_order) end);
  end if;
  if v_order.telegram_payment_charge_id is not null then perform api.raise_business_error('PAYMENT_MISMATCH', '支付订单已绑定其他付款凭据'); end if;
  if p_payer_telegram_id is null
     or p_payer_telegram_id <> v_order.verified_payer_telegram_id
  then
    update payments.orders
    set status = 'payment_identity_conflict',
        telegram_payment_charge_id = p_telegram_charge_id,
        provider_payment_charge_id = p_provider_charge_id,
        paid_at = now(),
        payment_identity_conflict_at = now(),
        payment_identity_conflict_reason = case
          when p_payer_telegram_id is null then 'successful_payment_payer_missing'
          else 'successful_payment_payer_mismatch'
        end,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;
    update operations.operations
    set result = payments.order_json(v_order), updated_at = now()
    where id = v_order.operation_id;
    update operations.webhook_events
    set processed_at = now()
    where provider = 'telegram_update' and event_id = p_update_id;
    return jsonb_build_object('duplicate', false, 'order', payments.order_json(v_order));
  end if;
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
           w.address receiver, t.name, t.rarity, t.stage, t.combat_power,
           catalog.template_detail_url(t.id) image_detail_url
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
create or replace function operations.operation_has_durable_reference(p_operation_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (select 1 from economy.ledger where operation_id = p_operation_id)
    or exists (select 1 from economy.entitlements where operation_id = p_operation_id)
    or exists (select 1 from expedition.expeditions where operation_id = p_operation_id)
    or exists (select 1 from wheel.results where operation_id = p_operation_id)
    or exists (select 1 from battle.rooms where create_operation_id = p_operation_id)
    or exists (select 1 from battle.participants where join_operation_id = p_operation_id)
    or exists (select 1 from battle.actions where operation_id = p_operation_id)
    or exists (select 1 from market.listings where operation_id = p_operation_id)
    or exists (select 1 from market.trades where operation_id = p_operation_id)
    or exists (select 1 from payments.orders where operation_id = p_operation_id)
    or exists (select 1 from vip.claims where operation_id = p_operation_id)
    or exists (select 1 from tasks.daily_progress where claim_operation_id = p_operation_id)
    or exists (select 1 from referral.relationships where reward_operation_id = p_operation_id)
    or exists (select 1 from referral.milestones where operation_id = p_operation_id)
    or exists (select 1 from album.nodes where first_operation_id = p_operation_id)
    or exists (select 1 from album.rewards where operation_id = p_operation_id)
    or exists (select 1 from onchain.mints where operation_id = p_operation_id)
$$;

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
  v_compacted integer := 0;
  v_deleted integer := 0;
  v_auth_deleted integer := 0;
  v_row record;
  v_details jsonb;
  v_battle_details jsonb;
  v_scan_from timestamptz;
  v_scan_to timestamptz := now();
  v_active_run operations.job_runs%rowtype;
begin
  if p_job_name not in ('reconcile-payments', 'reconcile-mints', 'cleanup-idempotency', 'monitor-invariants') then perform api.raise_business_error('JOB_NOT_FOUND', '后台任务不存在'); end if;
  select max(finished_at) into v_scan_from from operations.job_runs where job_name = p_job_name and status = 'succeeded';
  if not pg_try_advisory_xact_lock(hashtextextended('evomypet:job:' || p_job_name, 0)) then
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
    with candidates as materialized (
      select o.id
      from operations.operations o
      where o.completed_at < now() - interval '30 days'
        and o.status in ('succeeded', 'failed')
        and o.payload_purged_at is null
        and not (o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null)
        and not exists (
          select 1 from payments.orders p
          where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid', 'payment_identity_conflict')
        )
        and not exists (
          select 1 from onchain.mints m
          where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown')
        )
      order by o.completed_at, o.id
      limit greatest(1, least(p_limit, 5000))
      for update of o skip locked
    ), purged_wheel_results as (
      delete from wheel.results result
      using candidates candidate
      where result.operation_id = candidate.id
      returning result.operation_id
    ), compacted as (
      update operations.operations operation
      set request = null,
          result = null,
          payload_purged_at = now(),
          updated_at = now()
      from candidates candidate
      where operation.id = candidate.id
      returning operation.id
    )
    select count(*)::integer into v_compacted from compacted;

    with candidates as materialized (
      select o.id
      from operations.operations o
      where o.status in ('succeeded', 'failed')
        and (
          (o.status = 'failed' and o.completed_at < now() - interval '7 days')
          or (o.status = 'succeeded' and o.completed_at < now() - interval '37 days')
        )
        and not (o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null)
        and not operations.operation_has_durable_reference(o.id)
      order by o.completed_at, o.id
      limit greatest(1, least(p_limit, 5000))
      for update of o skip locked
    ), deleted as (
      delete from operations.operations operation
      using candidates candidate
      where operation.id = candidate.id
      returning operation.id
    )
    select count(*)::integer into v_deleted from deleted;

    delete from identity.auth_attempts where attempted_at < now() - interval '1 day';
    get diagnostics v_auth_deleted = row_count;
    v_battle_details := battle.cleanup_operational_data(greatest(1, least(p_limit, 5000)));
    v_details := jsonb_build_object(
      'payloads_compacted', v_compacted,
      'operations_deleted', v_deleted,
      'auth_attempts_deleted', v_auth_deleted,
      'battle', v_battle_details
    );
    v_count := v_compacted + v_deleted + v_auth_deleted
      + coalesce((v_battle_details->>'rate_limit_attempts_deleted')::integer, 0)
      + coalesce((v_battle_details->>'published_outbox_deleted')::integer, 0)
      + coalesce((v_battle_details->>'tick_runs_deleted')::integer, 0);
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
    select 'PAYMENT_IDENTITY_CONFLICT_DELIVERY', p.id::text, jsonb_build_object('kind', p.kind, 'status', p.status)
    from payments.orders p
    where p.payment_identity_conflict_at is not null
      and (
        p.delivered_at is not null
        or exists (
          select 1 from economy.ledger l
          where l.reason = 'stars_topup' and l.reference = p.id::text
        )
        or exists (
          select 1 from referral.relationships relationship
          where relationship.reward_operation_id = p.operation_id
        )
        or exists (
          select 1 from referral.milestones milestone
          where milestone.operation_id = p.operation_id
        )
      )
    on conflict do nothing;
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
      and not exists (select 1 from payments.orders p where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid', 'payment_identity_conflict'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    with authoritative as (
      select seller_id, template_id, sum(remaining)::bigint quantity
      from market.listings
      where status = 'active' and remaining > 0
      group by seller_id, template_id
    )
    select
      'MARKET_SELLER_SUPPLY_MISMATCH',
      coalesce(authoritative.seller_id, derived.seller_id)::text || ':' || coalesce(authoritative.template_id, derived.template_id),
      jsonb_build_object(
        'listing_quantity', coalesce(authoritative.quantity, 0),
        'summary_quantity', coalesce(derived.active_quantity, 0)
      )
    from authoritative
    full join market.seller_template_supply derived
      on derived.seller_id = authoritative.seller_id and derived.template_id = authoritative.template_id
    where coalesce(authoritative.quantity, 0) <> coalesce(derived.active_quantity, 0)
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    with eligible as (
      select supply.template_id, sum(supply.active_quantity)::bigint quantity
      from market.seller_template_supply supply
      join identity.users users on users.id = supply.seller_id and users.status = 'normal'
      group by supply.template_id
    )
    select
      'MARKET_TEMPLATE_SUPPLY_MISMATCH',
      coalesce(eligible.template_id, derived.template_id),
      jsonb_build_object(
        'eligible_seller_quantity', coalesce(eligible.quantity, 0),
        'summary_quantity', coalesce(derived.eligible_quantity, 0)
      )
    from eligible
    full join market.template_supply derived on derived.template_id = eligible.template_id
    where coalesce(eligible.quantity, 0) <> coalesce(derived.eligible_quantity, 0)
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    v_added := battle.monitor_tick_health(v_scan_from, v_scan_to);
    v_count := v_count + v_added;
    v_added := battle.monitor_invariants();
    v_count := v_count + v_added;
  end if;
  if p_job_name = 'reconcile-mints' then
    update operations.job_runs set processed_count = v_count, details = jsonb_build_object('phase', 'chain_reconciliation') where id = v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'running', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  update operations.job_runs
  set status = 'succeeded', processed_count = v_count,
      details = coalesce(v_details, '{}'::jsonb), finished_at = now()
  where id = v_run;
  return jsonb_build_object(
    'job_run_id', v_run, 'job_name', p_job_name, 'status', 'succeeded',
    'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to
  ) || case
    when v_details is null then '{}'::jsonb
    else jsonb_build_object('maintenance', v_details)
  end;
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

create or replace function api.catalog_asset_cleanup_claim(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_scan_from timestamptz;
  v_scan_to timestamptz := now();
  v_active_run operations.job_runs%rowtype;
  v_objects jsonb;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'catalog cleanup limit must be between 1 and 500';
  end if;
  v_mutation := catalog.acquire_asset_mutation('cleanup', null, null);
  if v_mutation.id is null then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (
      'cleanup-catalog-assets', 'skipped',
      jsonb_build_object('reason', 'asset_mutation_busy'),
      null, v_scan_to, now()
    ) returning id into v_run;
    return jsonb_build_object(
      'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'skipped',
      'processed_count', 0, 'scan_from', null, 'scan_to', v_scan_to, 'objects', '[]'::jsonb
    );
  end if;
  select max(finished_at) into v_scan_from
  from operations.job_runs
  where job_name = 'cleanup-catalog-assets' and status = 'succeeded';
  select * into v_active_run
  from operations.job_runs
  where job_name = 'cleanup-catalog-assets' and status = 'running'
  order by started_at desc
  limit 1
  for update;
  if v_active_run.id is not null and v_active_run.started_at > now() - interval '15 minutes' then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (
      'cleanup-catalog-assets', 'skipped',
      jsonb_build_object('reason', 'active_lease', 'active_job_run_id', v_active_run.id),
      v_scan_from, v_scan_to, now()
    ) returning id into v_run;
    update catalog.asset_mutation_runs
    set status = 'aborted', finished_at = now(),
        details = jsonb_build_object('reason', 'active_cleanup_job', 'active_job_run_id', v_active_run.id)
    where id = v_mutation.id;
    return jsonb_build_object(
      'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'skipped',
      'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to, 'objects', '[]'::jsonb
    );
  elsif v_active_run.id is not null then
    update catalog.asset_objects
    set status = 'delete_failed', cleanup_claim_id = null, cleanup_claimed_at = null,
        last_error = 'cleanup lease expired'
    where cleanup_claim_id = v_active_run.id and status = 'deleting';
    update operations.job_runs
    set status = 'failed', details = jsonb_build_object('error', 'lease_expired'), finished_at = now()
    where id = v_active_run.id;
  end if;

  insert into operations.job_runs (job_name, status, details, scan_from, scan_to)
  values (
    'cleanup-catalog-assets', 'running',
    jsonb_build_object('mutation_run_id', v_mutation.id, 'mutation_fence', v_mutation.fence),
    v_scan_from, v_scan_to
  )
  returning id into v_run;

  with candidates as materialized (
    select object.id
    from catalog.asset_objects object
    where object.object_class = 'runtime'
      and object.status in ('active', 'delete_failed')
      and exists (
        select 1
        from catalog.asset_release_templates item
        where item.thumbnail_object_id = object.id or item.detail_object_id = object.id
      )
      and not exists (
        select 1
        from catalog.asset_release_templates item
        join catalog.asset_releases release on release.id = item.release_id
        where (item.thumbnail_object_id = object.id or item.detail_object_id = object.id)
          and (
            release.status <> 'retired'
            or release.delete_after is null
            or release.delete_after > now()
            or release.rollback_locked_until > now()
          )
      )
    order by object.created_at, object.id
    limit p_limit
    for update of object skip locked
  ), claimed as (
    update catalog.asset_objects object
    set status = 'deleting', cleanup_claim_id = v_run, cleanup_claimed_at = now(), last_error = null
    from candidates candidate
    where object.id = candidate.id
    returning object.object_key, object.sha256, object.byte_size
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('key', object_key, 'sha256', sha256, 'bytes', byte_size) order by object_key),
    '[]'::jsonb
  ) into v_objects
  from claimed;

  return jsonb_build_object(
    'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'running',
    'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to,
    'mutation_run_id', v_mutation.id, 'mutation_fence', v_mutation.fence,
    'objects', v_objects
  );
end
$$;

create or replace function api.catalog_asset_cleanup_finish(
  p_job_run_id uuid,
  p_mutation_run_id uuid,
  p_mutation_fence bigint,
  p_deleted_keys jsonb,
  p_failed jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run operations.job_runs%rowtype;
  v_claimed integer;
  v_deleted integer;
  v_failed integer;
  v_mutation catalog.asset_mutation_runs%rowtype;
begin
  select * into v_run
  from operations.job_runs
  where id = p_job_run_id
  for update;
  if v_run.id is null or v_run.job_name <> 'cleanup-catalog-assets' or v_run.status <> 'running' then
    perform api.raise_business_error('JOB_NOT_FOUND', '后台任务运行不存在或已经结束');
  end if;
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'cleanup', null, null
  );
  if v_run.details->>'mutation_run_id' is distinct from p_mutation_run_id::text
    or (v_run.details->>'mutation_fence')::bigint is distinct from p_mutation_fence
  then
    raise exception using errcode = '55000', message = 'catalog cleanup mutation lease does not match its job';
  end if;
  if jsonb_typeof(p_deleted_keys) <> 'array' or jsonb_typeof(p_failed) <> 'object' then
    raise exception using errcode = '22023', message = 'catalog cleanup result shape is invalid';
  end if;
  select count(*) into v_claimed
  from catalog.asset_objects
  where cleanup_claim_id = p_job_run_id and status = 'deleting';
  select count(distinct value) into v_deleted from jsonb_array_elements_text(p_deleted_keys);
  select count(*) into v_failed from jsonb_object_keys(p_failed);
  if v_deleted + v_failed <> v_claimed
    or exists (
      select 1
      from catalog.asset_objects object
      where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting'
        and not (p_deleted_keys ? object.object_key)
        and not (p_failed ? object.object_key)
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_deleted_keys) as deleted(key)
      where not exists (
        select 1 from catalog.asset_objects object
        where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting' and object.object_key = deleted.key
      )
    )
    or exists (
      select 1 from jsonb_object_keys(p_failed) as failed(key)
      where not exists (
        select 1 from catalog.asset_objects object
        where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting' and object.object_key = failed.key
      )
    )
  then
    raise exception using errcode = '22023', message = 'catalog cleanup result does not match its claim';
  end if;

  update catalog.asset_objects object
  set status = 'deleted', cleanup_claim_id = null, cleanup_claimed_at = null,
      last_error = null, deleted_at = now()
  where object.cleanup_claim_id = p_job_run_id
    and object.status = 'deleting'
    and p_deleted_keys ? object.object_key;

  update catalog.asset_objects object
  set status = 'delete_failed', cleanup_claim_id = null, cleanup_claimed_at = null,
      last_error = left(p_failed->>object.object_key, 500), deleted_at = null
  where object.cleanup_claim_id = p_job_run_id
    and object.status = 'deleting'
    and p_failed ? object.object_key;

  update operations.job_runs
  set status = case when v_failed = 0 then 'succeeded' else 'failed' end,
      processed_count = v_deleted,
      details = jsonb_build_object('attempted', v_claimed, 'deleted', v_deleted, 'failed', v_failed),
      finished_at = now()
  where id = p_job_run_id
  returning * into v_run;

  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(),
      details = jsonb_build_object(
        'job_run_id', p_job_run_id,
        'attempted', v_claimed,
        'deleted', v_deleted,
        'failed', v_failed
      )
  where id = v_mutation.id;

  return jsonb_build_object(
    'job_run_id', v_run.id, 'job_name', v_run.job_name, 'status', v_run.status,
    'processed_count', v_run.processed_count, 'scan_from', v_run.scan_from, 'scan_to', v_run.scan_to
  );
end
$$;

-- source: 96_admin.sql
create table admin.database_identity (
  singleton boolean primary key default true check (singleton),
  environment text not null check (environment in ('local', 'real_development', 'production')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  bound_at timestamptz not null default now(),
  bound_by text not null
);

create table admin.environment_controls (
  capability text primary key check (capability = 'battle_acceptance_fixture'),
  environment text not null check (environment in ('local', 'real_development', 'production')),
  project_ref text not null check (project_ref ~ '^[a-z]{20}$'),
  enabled boolean not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table admin.fixture_commands (
  request_id uuid primary key,
  fixture_version text not null check (fixture_version = 'battle-v1'),
  ordered_user_ids uuid[] not null check (
    array_ndims(ordered_user_ids) = 1
    and array_lower(ordered_user_ids, 1) = 1
    and cardinality(ordered_user_ids) = 4
  ),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  run_key text not null unique check (run_key ~ '^[0-9a-f]{64}$'),
  status text not null default 'running' check (status in ('running', 'succeeded')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table admin.fixture_user_bindings (
  role text primary key check (role in ('A', 'B', 'C', 'D')),
  fixture_version text not null check (fixture_version = 'battle-v1'),
  user_id uuid not null unique references identity.users(id) on delete cascade,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  bound_at timestamptz not null default now()
);

create table admin.fixture_run_audit (
  run_key text primary key check (run_key ~ '^[0-9a-f]{64}$'),
  fixture_version text not null check (fixture_version = 'battle-v1'),
  fixture_definition_hash text not null check (fixture_definition_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  ordered_user_ids uuid[] not null check (
    array_ndims(ordered_user_ids) = 1
    and array_lower(ordered_user_ids, 1) = 1
    and cardinality(ordered_user_ids) = 4
  ),
  before_aggregate jsonb not null,
  after_aggregate jsonb not null,
  result text not null check (result in ('applied', 'noop')),
  executed_at timestamptz not null default now(),
  executed_by text not null
);

create table admin.fixture_asset_ownership (
  user_id uuid not null references identity.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('KCOIN', 'PET')),
  asset_key text not null,
  fixture_version text not null check (fixture_version = 'battle-v1'),
  available_quantity bigint not null default 0 check (available_quantity >= 0),
  locked_quantity bigint not null default 0 check (locked_quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_kind, asset_key),
  check (
    (asset_kind = 'KCOIN' and asset_key = 'KCOIN')
    or (asset_kind = 'PET' and asset_key ~ '^PET-[NAT]-[0-9]{3}-[123]$')
  ),
  check (asset_kind = 'KCOIN' or locked_quantity = 0)
);

create table admin.fixture_asset_changes (
  id bigint generated always as identity primary key,
  run_key text not null references admin.fixture_run_audit(run_key) on delete restrict,
  role text not null check (role in ('A', 'B', 'C', 'D')),
  user_id uuid not null references identity.users(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('KCOIN', 'PET')),
  asset_key text not null,
  available_delta bigint not null,
  locked_delta bigint not null default 0,
  aggregate_before jsonb not null,
  aggregate_after jsonb not null,
  fixture_owned_before jsonb not null,
  fixture_owned_after jsonb not null,
  created_at timestamptz not null default now(),
  check (available_delta <> 0 or locked_delta <> 0)
);

create index fixture_commands_payload_idx on admin.fixture_commands (payload_hash, created_at);
create index fixture_run_audit_payload_idx on admin.fixture_run_audit (payload_hash, executed_at);
create index fixture_asset_changes_run_idx on admin.fixture_asset_changes (run_key, id);
create index fixture_asset_changes_user_idx on admin.fixture_asset_changes (user_id, id);

create or replace function admin.assert_owner_call()
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_owner oid;
begin
  select n.nspowner into v_owner
  from pg_catalog.pg_namespace n
  where n.nspname = 'admin';
  if v_owner is null or not pg_catalog.pg_has_role(current_user, v_owner, 'USAGE') then
    raise exception using
      errcode = '42501',
      message = 'BATTLE_FIXTURE_OWNER_REQUIRED';
  end if;
end;
$$;

create or replace function admin.bind_database_identity(
  p_environment text,
  p_project_ref text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity admin.database_identity%rowtype;
begin
  perform admin.assert_owner_call();
  if p_environment not in ('local', 'real_development', 'production')
    or p_project_ref !~ '^[a-z]{20}$'
  then
    raise exception using
      errcode = '22023',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_INVALID';
  end if;

  insert into admin.database_identity (
    singleton, environment, project_ref, bound_by
  ) values (
    true, p_environment, p_project_ref, current_user
  )
  on conflict (singleton) do nothing
  returning * into v_identity;
  if v_identity.singleton is null then
    select * into v_identity
    from admin.database_identity
    where singleton
    for update;
    if v_identity.environment <> p_environment or v_identity.project_ref <> p_project_ref then
      raise exception using
        errcode = 'P0001',
        message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_IMMUTABLE';
    end if;
  end if;

  return jsonb_build_object(
    'environment', v_identity.environment,
    'project_ref', v_identity.project_ref,
    'bound_at', v_identity.bound_at
  );
end;
$$;

create or replace function admin.configure_battle_fixture_gate(
  p_environment text,
  p_project_ref text,
  p_enabled boolean,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity admin.database_identity%rowtype;
begin
  perform admin.assert_owner_call();
  if p_environment not in ('local', 'real_development', 'production')
    or p_project_ref !~ '^[a-z]{20}$'
    or p_enabled is null
    or p_expires_at is null
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_GATE_INVALID';
  end if;
  select * into v_identity
  from admin.database_identity
  where singleton
  for update;
  if v_identity.singleton is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISSING';
  end if;
  if p_environment <> v_identity.environment or p_project_ref <> v_identity.project_ref then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISMATCH';
  end if;
  if p_enabled and p_environment <> 'real_development' then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_ENVIRONMENT_INVALID';
  end if;
  if p_enabled and (p_expires_at <= now() or p_expires_at > now() + interval '24 hours') then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_EXPIRY_INVALID';
  end if;

  insert into admin.environment_controls (
    capability, environment, project_ref, enabled, expires_at, updated_at, updated_by
  ) values (
    'battle_acceptance_fixture', p_environment, p_project_ref, p_enabled,
    p_expires_at, now(), current_user
  )
  on conflict (capability) do update
  set environment = excluded.environment,
      project_ref = excluded.project_ref,
      enabled = excluded.enabled,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return jsonb_build_object(
    'capability', 'battle_acceptance_fixture',
    'environment', p_environment,
    'project_ref', p_project_ref,
    'enabled', p_enabled,
    'expires_at', p_expires_at
  );
end;
$$;

create or replace function admin.battle_fixture_definition()
returns table (
  fixture_version text,
  role text,
  target_kcoin bigint,
  template_id text,
  target_quantity bigint,
  element text,
  skill_slots text[]
)
language sql
immutable
security invoker
set search_path = ''
as $$
  select *
  from (values
    ('battle-v1', 'A', 500::bigint, 'PET-N-001-1', 2::bigint, 'grass', array['S01','S04']::text[]),
    ('battle-v1', 'A', 500::bigint, 'PET-N-033-2', 1::bigint, 'lightning', array['S05','S08','S03']::text[]),
    ('battle-v1', 'A', 500::bigint, 'PET-A-020-3', 1::bigint, 'earth', array['S04','S02','S06','S10']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-N-003-2', 2::bigint, 'earth', array['S01','S04','S06']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-N-039-3', 1::bigint, 'fire', array['S05','S08','S03','S07']::text[]),
    ('battle-v1', 'B', 500::bigint, 'PET-A-018-1', 1::bigint, 'fire', array['S04','S02']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-N-004-3', 2::bigint, 'water', array['S01','S04','S06','S09']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-N-040-1', 1::bigint, 'earth', array['S05','S08']::text[]),
    ('battle-v1', 'C', 500::bigint, 'PET-A-019-2', 1::bigint, 'lightning', array['S04','S02','S06']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-N-005-1', 2::bigint, 'lightning', array['S01','S04']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-N-036-2', 1::bigint, 'water', array['S05','S08','S03']::text[]),
    ('battle-v1', 'D', 100::bigint, 'PET-A-016-3', 1::bigint, 'grass', array['S04','S02','S06','S10']::text[])
  ) definition(
    fixture_version, role, target_kcoin, template_id, target_quantity, element, skill_slots
  )
$$;

create or replace function admin.battle_fixture_definition_hash()
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'fixture_version', 'battle-v1',
          'catalog_version', 'v1',
          'catalog_checksum', 'ec8d89aec0a700bfb504285401bf6327ed2a4c48c94d4d8bb92559bdae2ee61e',
          'battle_checksum', '448212ef370d96ee871cf5f0d486a4a47263c7aabf77651b228b6330e99e0dac',
          'matrix', jsonb_agg(
            jsonb_build_object(
              'role', d.role,
              'target_kcoin', d.target_kcoin,
              'template_id', d.template_id,
              'target_quantity', d.target_quantity,
              'element', d.element,
              'skill_slots', to_jsonb(d.skill_slots)
            )
            order by d.role, d.template_id
          )
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from admin.battle_fixture_definition() d
$$;

create or replace function admin.track_fixture_balance_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_available_owned bigint;
  v_locked_owned bigint;
  v_available_to_locked bigint := 0;
  v_locked_to_available bigint := 0;
  v_available_consumed bigint := 0;
  v_locked_consumed bigint := 0;
begin
  if old.currency <> 'KCOIN' then
    return new;
  end if;
  select available_quantity, locked_quantity
  into v_available_owned, v_locked_owned
  from admin.fixture_asset_ownership
  where user_id = old.user_id and asset_kind = 'KCOIN' and asset_key = 'KCOIN'
  for update;
  if not found then
    return new;
  end if;

  if new.available < old.available and new.locked > old.locked then
    v_available_to_locked := least(
      old.available - new.available,
      new.locked - old.locked,
      v_available_owned
    );
  elsif new.locked < old.locked and new.available > old.available then
    v_locked_to_available := least(
      old.locked - new.locked,
      new.available - old.available,
      v_locked_owned
    );
  end if;

  v_available_owned := v_available_owned - v_available_to_locked + v_locked_to_available;
  v_locked_owned := v_locked_owned + v_available_to_locked - v_locked_to_available;
  v_available_consumed := least(
    greatest(old.available - new.available - v_available_to_locked, 0),
    v_available_owned
  );
  v_locked_consumed := least(
    greatest(old.locked - new.locked - v_locked_to_available, 0),
    v_locked_owned
  );

  update admin.fixture_asset_ownership
  set available_quantity = v_available_owned - v_available_consumed,
      locked_quantity = v_locked_owned - v_locked_consumed,
      updated_at = now()
  where user_id = old.user_id and asset_kind = 'KCOIN' and asset_key = 'KCOIN';
  return new;
end;
$$;

create trigger fixture_balance_ownership_trigger
after update of available, locked on economy.balances
for each row
execute function admin.track_fixture_balance_ownership();

create or replace function admin.track_fixture_holding_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quantity < old.quantity then
    update admin.fixture_asset_ownership
    set available_quantity = greatest(
          available_quantity - (old.quantity - new.quantity),
          0
        ),
        updated_at = now()
    where user_id = old.user_id
      and asset_kind = 'PET'
      and asset_key = old.template_id;
  end if;
  return new;
end;
$$;

create trigger fixture_holding_ownership_trigger
after update of quantity on inventory.holdings
for each row
execute function admin.track_fixture_holding_ownership();

create or replace function admin.battle_fixture_state(
  p_fixture_version text,
  p_ordered_user_ids uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with role_users(role, user_id) as (
    values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
  ),
  fixture_quantities as materialized (
    select quantity.*
    from inventory.quantity_read_model quantity
    where quantity.user_id = any(p_ordered_user_ids)
  ),
  role_targets as (
    select d.role, max(d.target_kcoin) as target_kcoin
    from admin.battle_fixture_definition() d
    where d.fixture_version = p_fixture_version
    group by d.role
  ),
  pet_state as (
    select
      ru.role,
      jsonb_agg(
        jsonb_build_object(
          'template_id', d.template_id,
          'target_quantity', d.target_quantity,
          'fixture_owned_quantity', coalesce(o.available_quantity, 0),
          'aggregate_quantity', coalesce(quantity.total, 0),
          'active_reserved', coalesce(
            quantity.listed + quantity.expedition + quantity.minting + quantity.battling,
            0
          ),
          'available_quantity', coalesce(quantity.available, 0)
        )
        order by d.template_id
      ) as pets,
      bool_and(
        coalesce(o.available_quantity, 0) = d.target_quantity
        and coalesce(o.locked_quantity, 0) = 0
        and coalesce(quantity.total, 0) >= coalesce(o.available_quantity, 0)
      ) as pets_aligned
    from role_users ru
    join admin.battle_fixture_definition() d
      on d.fixture_version = p_fixture_version and d.role = ru.role
    left join admin.fixture_asset_ownership o
      on o.user_id = ru.user_id
      and o.asset_kind = 'PET'
      and o.asset_key = d.template_id
      and o.fixture_version = p_fixture_version
    left join fixture_quantities quantity
      on quantity.user_id = ru.user_id and quantity.template_id = d.template_id
    group by ru.role
  ),
  role_state as (
    select
      ru.role,
      ru.user_id,
      rt.target_kcoin,
      coalesce(ko.available_quantity, 0) as fixture_kcoin_available,
      coalesce(ko.locked_quantity, 0) as fixture_kcoin_locked,
      coalesce(b.available, 0) as aggregate_kcoin_available,
      coalesce(b.locked, 0) as aggregate_kcoin_locked,
      ps.pets,
      fb.user_id is not null as binding_aligned,
      (
        fb.user_id is not null
        and coalesce(ko.available_quantity, 0) = rt.target_kcoin
        and coalesce(ko.locked_quantity, 0) = 0
        and coalesce(b.available, 0) >= coalesce(ko.available_quantity, 0)
        and ps.pets_aligned
      ) as aligned
    from role_users ru
    join role_targets rt on rt.role = ru.role
    join pet_state ps on ps.role = ru.role
    left join admin.fixture_asset_ownership ko
      on ko.user_id = ru.user_id
      and ko.asset_kind = 'KCOIN'
      and ko.asset_key = 'KCOIN'
      and ko.fixture_version = p_fixture_version
    left join economy.balances b
      on b.user_id = ru.user_id and b.currency = 'KCOIN'
    left join admin.fixture_user_bindings fb
      on fb.role = ru.role
      and fb.fixture_version = p_fixture_version
      and fb.user_id = ru.user_id
  )
  select jsonb_build_object(
    'fixture_version', p_fixture_version,
    'fixture_definition_hash', admin.battle_fixture_definition_hash(),
    'aligned', bool_and(aligned),
    'roles', jsonb_agg(
      jsonb_build_object(
        'role', role,
        'user_id', user_id,
        'target_kcoin', target_kcoin,
        'fixture_owned_kcoin', jsonb_build_object(
          'available', fixture_kcoin_available,
          'locked', fixture_kcoin_locked
        ),
        'aggregate_kcoin', jsonb_build_object(
          'available', aggregate_kcoin_available,
          'locked', aggregate_kcoin_locked
        ),
        'binding_aligned', binding_aligned,
        'pets', pets,
        'aligned', aligned
      )
      order by role
    )
  )
  from role_state
$$;

create or replace function admin.battle_fixture_status(
  p_fixture_version text,
  p_ordered_user_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_payload_hash text;
  v_state jsonb;
  v_last_run jsonb;
begin
  perform admin.assert_owner_call();
  if p_fixture_version <> 'battle-v1'
    or array_ndims(p_ordered_user_ids) <> 1
    or array_lower(p_ordered_user_ids, 1) <> 1
    or cardinality(p_ordered_user_ids) <> 4
    or exists (
      select 1
      from unnest(p_ordered_user_ids) u
      group by u
      having count(*) > 1
    )
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_PAYLOAD_INVALID';
  end if;

  v_payload := jsonb_build_object(
    'fixture_version', p_fixture_version,
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'A', 'user_id', p_ordered_user_ids[1]),
      jsonb_build_object('role', 'B', 'user_id', p_ordered_user_ids[2]),
      jsonb_build_object('role', 'C', 'user_id', p_ordered_user_ids[3]),
      jsonb_build_object('role', 'D', 'user_id', p_ordered_user_ids[4])
    )
  );
  v_payload_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_state := admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids);
  select jsonb_build_object(
    'run_key', a.run_key,
    'payload_hash', a.payload_hash,
    'result', a.result,
    'executed_at', a.executed_at
  )
  into v_last_run
  from admin.fixture_run_audit a
  where a.payload_hash = v_payload_hash
  order by a.executed_at desc
  limit 1;
  return v_state || jsonb_build_object(
    'payload_hash', v_payload_hash,
    'last_run', v_last_run
  );
end;
$$;

create or replace function admin.reconcile_battle_fixture(
  p_fixture_version text,
  p_request_id uuid,
  p_ordered_user_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gate admin.environment_controls%rowtype;
  v_identity admin.database_identity%rowtype;
  v_payload jsonb;
  v_payload_hash text;
  v_definition_hash text;
  v_run_key text;
  v_command admin.fixture_commands%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_role_user record;
  v_asset record;
  v_target bigint;
  v_current_available bigint;
  v_current_locked bigint;
  v_owned_available bigint;
  v_owned_locked bigint;
  v_delta bigint;
  v_change_count integer := 0;
  v_catalog_checksum text;
  v_battle_checksum text;
  v_matrix_count integer;
  v_matrix_element_count integer;
  v_matrix_skill_slot_count integer;
  v_binding_count integer;
  v_binding_matches integer;
  v_binding_changed boolean;
  v_previous_user_ids uuid[];
begin
  perform admin.assert_owner_call();
  if p_fixture_version <> 'battle-v1' or p_request_id is null
    or array_ndims(p_ordered_user_ids) <> 1
    or array_lower(p_ordered_user_ids, 1) <> 1
    or cardinality(p_ordered_user_ids) <> 4
    or exists (
      select 1
      from unnest(p_ordered_user_ids) u
      group by u
      having count(*) > 1
    )
  then
    raise exception using errcode = '22023', message = 'BATTLE_FIXTURE_PAYLOAD_INVALID';
  end if;

  v_payload := jsonb_build_object(
    'fixture_version', p_fixture_version,
    'roles', jsonb_build_array(
      jsonb_build_object('role', 'A', 'user_id', p_ordered_user_ids[1]),
      jsonb_build_object('role', 'B', 'user_id', p_ordered_user_ids[2]),
      jsonb_build_object('role', 'C', 'user_id', p_ordered_user_ids[3]),
      jsonb_build_object('role', 'D', 'user_id', p_ordered_user_ids[4])
    )
  );
  v_payload_hash := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_definition_hash := admin.battle_fixture_definition_hash();
  v_run_key := encode(
    extensions.digest(
      convert_to('battle-acceptance-fixture-run|' || p_request_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into admin.fixture_commands (
    request_id, fixture_version, ordered_user_ids, payload_hash, run_key
  ) values (
    p_request_id, p_fixture_version, p_ordered_user_ids, v_payload_hash, v_run_key
  )
  on conflict (request_id) do nothing;
  select * into v_command
  from admin.fixture_commands
  where request_id = p_request_id
  for update;
  if v_command.payload_hash <> v_payload_hash then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_IDEMPOTENCY_CONFLICT';
  end if;
  if v_command.status = 'succeeded' then
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_gate
  from admin.environment_controls
  where capability = 'battle_acceptance_fixture'
  for update;
  if v_gate.capability is null or not v_gate.enabled then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_GATE_DISABLED';
  end if;
  select * into v_identity
  from admin.database_identity
  where singleton
  for update;
  if v_identity.singleton is null then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISSING';
  end if;
  if v_gate.environment <> v_identity.environment
    or v_gate.project_ref <> v_identity.project_ref
  then
    raise exception using
      errcode = 'P0001',
      message = 'BATTLE_FIXTURE_DATABASE_IDENTITY_MISMATCH';
  end if;
  if v_gate.environment <> 'real_development'
    or v_identity.environment <> 'real_development'
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_ENVIRONMENT_MISMATCH';
  end if;
  if v_gate.project_ref !~ '^[a-z]{20}$' then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_PROJECT_REF_INVALID';
  end if;
  if v_gate.expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_GATE_EXPIRED';
  end if;

  lock table
    identity.users,
    operations.operations,
    operations.invariant_violations,
    economy.balances,
    economy.ledger,
    inventory.holdings,
    inventory.reservations,
    battle.rooms,
    battle.participants,
    battle.stakes,
    battle.outbox,
    market.listings,
    expedition.expeditions,
    payments.orders,
    onchain.mints
  in share row exclusive mode;

  if exists (
      select 1 from battle.rooms
      where status in (
        'preparing_share', 'waiting', 'lobby_waiting', 'lobby_countdown',
        'active_turn'
      )
    )
    or exists (
      select 1 from battle.participants
      where status in ('preparing_share', 'waiting', 'lobby', 'active')
    )
    or exists (select 1 from battle.stakes where status = 'locked')
    or exists (
      select 1 from inventory.reservations
      where status = 'active'
    )
    or exists (
      select 1 from battle.outbox
      where status in ('pending', 'leased')
    )
    or exists (
      select 1 from operations.invariant_violations
      where resolved_at is null
    )
    or exists (
      select 1 from market.listings
      where status = 'active' and remaining > 0
    )
    or exists (
      select 1 from expedition.expeditions
      where status in ('running', 'claimable')
    )
    or exists (
      select 1 from payments.orders
      where status in ('pending', 'processing', 'paid', 'payment_identity_conflict')
    )
    or exists (
      select 1 from onchain.mints
      where status in ('reserved', 'submitted', 'unknown')
    )
    or exists (
      select 1 from operations.operations
      where status in ('pending', 'unknown')
    )
    or exists (
      select 1 from economy.balances
      where locked <> 0
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_BUSINESS_STATE_ACTIVE';
  end if;

  select product_checksum into v_catalog_checksum
  from catalog.versions where id = 'v1';
  select checksum into v_battle_checksum
  from battle.rulesets where id = 'battle-v1' and status = 'active';
  select
    count(*),
    count(distinct d.element),
    count(distinct skill_slot)
  into v_matrix_count, v_matrix_element_count, v_matrix_skill_slot_count
  from admin.battle_fixture_definition() d
  cross join lateral unnest(d.skill_slots) skill_slot
  where d.fixture_version = p_fixture_version;
  if v_catalog_checksum <> 'ec8d89aec0a700bfb504285401bf6327ed2a4c48c94d4d8bb92559bdae2ee61e'
    or v_battle_checksum <> '448212ef370d96ee871cf5f0d486a4a47263c7aabf77651b228b6330e99e0dac'
    or not battle.rules_complete('battle-v1')
    or v_matrix_count <> 36
    or v_matrix_element_count <> 5
    or v_matrix_skill_slot_count <> 10
    or exists (
      select 1
      from admin.battle_fixture_definition() d
      left join catalog.templates t on t.id = d.template_id and t.catalog_version = 'v1'
      left join battle.template_configs c
        on c.ruleset_id = d.fixture_version and c.template_id = d.template_id
      where d.fixture_version = p_fixture_version
        and (
          t.id is null
          or c.template_id is null
          or c.element <> d.element
          or array_remove(
            array[c.skill_1_id, c.skill_2_id, c.skill_3_id, c.skill_4_id],
            null
          ) <> (
            select array_agg(s.id order by x.ordinality)
            from unnest(d.skill_slots) with ordinality x(slot_id, ordinality)
            join battle.skills s
              on s.ruleset_id = d.fixture_version
              and s.element = d.element
              and s.slot_id = x.slot_id
          )
        )
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_PRODUCT_DATA_DRIFT';
  end if;

  if (
    select count(*) = 4 and bool_and(status = 'normal')
    from identity.users
    where id = any(p_ordered_user_ids)
  ) is not true then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_USERS_INVALID';
  end if;
  perform 1
  from identity.users
  where id = any(p_ordered_user_ids)
  order by id
  for update;

  select count(*) into v_binding_count
  from admin.fixture_user_bindings
  where fixture_version = p_fixture_version;
  select array_agg(user_id order by role) into v_previous_user_ids
  from admin.fixture_user_bindings
  where fixture_version = p_fixture_version;
  if v_binding_count not in (0, 4)
    or exists (
      select 1
      from admin.fixture_asset_ownership o
      left join admin.fixture_user_bindings b
        on b.fixture_version = o.fixture_version and b.user_id = o.user_id
      where b.user_id is null
        and (o.available_quantity <> 0 or o.locked_quantity <> 0)
    )
  then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
  end if;
  select count(*) into v_binding_matches
  from admin.fixture_user_bindings b
  join (values
    ('A', p_ordered_user_ids[1]),
    ('B', p_ordered_user_ids[2]),
    ('C', p_ordered_user_ids[3]),
    ('D', p_ordered_user_ids[4])
  ) requested(role, user_id)
    on requested.role = b.role and requested.user_id = b.user_id
  where b.fixture_version = p_fixture_version;
  v_binding_changed := v_binding_count = 0 or v_binding_matches <> 4;

  v_before := jsonb_build_object(
    'requested_binding',
    admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids),
    'previous_binding',
    case
      when v_binding_count = 4
        then admin.battle_fixture_state(p_fixture_version, v_previous_user_ids)
      else null
    end
  );
  insert into admin.fixture_run_audit (
    run_key, fixture_version, fixture_definition_hash, payload_hash,
    ordered_user_ids, before_aggregate, after_aggregate, result, executed_by
  ) values (
    v_run_key, p_fixture_version, v_definition_hash, v_payload_hash,
    p_ordered_user_ids, v_before, '{}'::jsonb, 'noop', current_user
  );

  for v_role_user in
    select *
    from (values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
    ) role_user(role, user_id)
    order by user_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('battle-fixture-user:' || v_role_user.user_id::text, 0)
    );
  end loop;

  if v_binding_count = 4 and v_binding_changed then
    for v_role_user in
      select role, user_id
      from admin.fixture_user_bindings
      where fixture_version = p_fixture_version
      order by role
    loop
      v_current_available := null;
      select available, locked
      into v_current_available, v_current_locked
      from economy.balances
      where user_id = v_role_user.user_id and currency = 'KCOIN'
      for update;
      select available_quantity, locked_quantity
      into v_owned_available, v_owned_locked
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id
        and asset_kind = 'KCOIN'
        and asset_key = 'KCOIN'
      for update;
      if found and (
        v_current_available is null
        or v_owned_locked <> 0
        or v_owned_available > v_current_available
      ) then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      if found and v_owned_available > 0 then
        update economy.balances
        set available = available - v_owned_available, updated_at = now()
        where user_id = v_role_user.user_id and currency = 'KCOIN';
        insert into economy.ledger (
          operation_id, user_id, currency, amount, reason, reference, balance_after
        ) values (
          null, v_role_user.user_id, 'KCOIN', -v_owned_available,
          'battle_acceptance_fixture',
          v_run_key || ':unbind:' || v_role_user.role,
          v_current_available - v_owned_available
        );
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'KCOIN', 'KCOIN',
          -v_owned_available,
          jsonb_build_object('available', v_current_available, 'locked', v_current_locked),
          jsonb_build_object('available', v_current_available - v_owned_available, 'locked', v_current_locked),
          jsonb_build_object('available', v_owned_available, 'locked', v_owned_locked),
          jsonb_build_object('available', 0, 'locked', 0)
        );
        v_change_count := v_change_count + 1;
      end if;

      for v_asset in
        select o.asset_key as template_id, o.available_quantity
        from admin.fixture_asset_ownership o
        where o.user_id = v_role_user.user_id
          and o.asset_kind = 'PET'
          and o.available_quantity > 0
        order by o.asset_key
        for update
      loop
        select quantity into v_current_available
        from inventory.holdings
        where user_id = v_role_user.user_id and template_id = v_asset.template_id
        for update;
        if not found or v_asset.available_quantity > v_current_available then
          raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
        end if;
        update inventory.holdings
        set quantity = quantity - v_asset.available_quantity, updated_at = now()
        where user_id = v_role_user.user_id and template_id = v_asset.template_id;
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'PET', v_asset.template_id,
          -v_asset.available_quantity,
          jsonb_build_object('quantity', v_current_available),
          jsonb_build_object('quantity', v_current_available - v_asset.available_quantity),
          jsonb_build_object('quantity', v_asset.available_quantity),
          jsonb_build_object('quantity', 0)
        );
        v_change_count := v_change_count + 1;
      end loop;
      delete from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id and fixture_version = p_fixture_version;
    end loop;
    delete from admin.fixture_user_bindings
    where fixture_version = p_fixture_version;
  end if;

  if v_binding_changed then
    insert into admin.fixture_user_bindings (
      role, fixture_version, user_id, payload_hash
    ) values
      ('A', p_fixture_version, p_ordered_user_ids[1], v_payload_hash),
      ('B', p_fixture_version, p_ordered_user_ids[2], v_payload_hash),
      ('C', p_fixture_version, p_ordered_user_ids[3], v_payload_hash),
      ('D', p_fixture_version, p_ordered_user_ids[4], v_payload_hash);
  end if;

  for v_role_user in
    select *
    from (values
      ('A', p_ordered_user_ids[1]),
      ('B', p_ordered_user_ids[2]),
      ('C', p_ordered_user_ids[3]),
      ('D', p_ordered_user_ids[4])
    ) role_user(role, user_id)
    order by role
  loop
    select max(target_kcoin) into v_target
    from admin.battle_fixture_definition() d
    where d.fixture_version = p_fixture_version and d.role = v_role_user.role;
    insert into economy.balances (user_id, currency)
    values (v_role_user.user_id, 'KCOIN')
    on conflict (user_id, currency) do nothing;
    select available, locked
    into v_current_available, v_current_locked
    from economy.balances
    where user_id = v_role_user.user_id and currency = 'KCOIN'
    for update;
    insert into admin.fixture_asset_ownership (
      user_id, asset_kind, asset_key, fixture_version
    ) values (
      v_role_user.user_id, 'KCOIN', 'KCOIN', p_fixture_version
    )
    on conflict (user_id, asset_kind, asset_key) do nothing;
    select available_quantity, locked_quantity
    into v_owned_available, v_owned_locked
    from admin.fixture_asset_ownership
    where user_id = v_role_user.user_id
      and asset_kind = 'KCOIN'
      and asset_key = 'KCOIN'
    for update;
    if v_owned_locked <> 0 or v_owned_available > v_current_available then
      raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
    end if;
    v_delta := v_target - v_owned_available;
    if v_delta <> 0 then
      if v_current_available + v_delta < 0 then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      update economy.balances
      set available = available + v_delta, updated_at = now()
      where user_id = v_role_user.user_id and currency = 'KCOIN';
      if v_delta > 0 then
        update admin.fixture_asset_ownership
        set fixture_version = p_fixture_version,
            available_quantity = available_quantity + v_delta,
            updated_at = now()
        where user_id = v_role_user.user_id
          and asset_kind = 'KCOIN'
          and asset_key = 'KCOIN';
      end if;
      insert into economy.ledger (
        operation_id, user_id, currency, amount, reason, reference, balance_after
      ) values (
        null, v_role_user.user_id, 'KCOIN', v_delta,
        'battle_acceptance_fixture',
        v_run_key || ':' || v_role_user.role,
        v_current_available + v_delta
      )
      ;
      insert into admin.fixture_asset_changes (
        run_key, role, user_id, asset_kind, asset_key, available_delta,
        aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
      ) values (
        v_run_key, v_role_user.role, v_role_user.user_id, 'KCOIN', 'KCOIN', v_delta,
        jsonb_build_object('available', v_current_available, 'locked', v_current_locked),
        jsonb_build_object('available', v_current_available + v_delta, 'locked', v_current_locked),
        jsonb_build_object('available', v_owned_available, 'locked', v_owned_locked),
        jsonb_build_object('available', v_target, 'locked', 0)
      );
      v_change_count := v_change_count + 1;
    end if;

    for v_asset in
      select asset_key as template_id
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id and asset_kind = 'PET'
      union
      select d.template_id
      from admin.battle_fixture_definition() d
      where d.fixture_version = p_fixture_version and d.role = v_role_user.role
      order by template_id
    loop
      select coalesce(max(d.target_quantity), 0) into v_target
      from admin.battle_fixture_definition() d
      where d.fixture_version = p_fixture_version
        and d.role = v_role_user.role
        and d.template_id = v_asset.template_id;
      insert into inventory.holdings (user_id, template_id)
      values (v_role_user.user_id, v_asset.template_id)
      on conflict (user_id, template_id) do nothing;
      select quantity into v_current_available
      from inventory.holdings
      where user_id = v_role_user.user_id and template_id = v_asset.template_id
      for update;
      insert into admin.fixture_asset_ownership (
        user_id, asset_kind, asset_key, fixture_version
      ) values (
        v_role_user.user_id, 'PET', v_asset.template_id, p_fixture_version
      )
      on conflict (user_id, asset_kind, asset_key) do nothing;
      select available_quantity, locked_quantity
      into v_owned_available, v_owned_locked
      from admin.fixture_asset_ownership
      where user_id = v_role_user.user_id
        and asset_kind = 'PET'
        and asset_key = v_asset.template_id
      for update;
      if v_owned_locked <> 0 or v_owned_available > v_current_available then
        raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
      end if;
      v_delta := v_target - v_owned_available;
      if v_delta <> 0 then
        if v_current_available + v_delta < 0 then
          raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_OWNERSHIP_INVARIANT';
        end if;
        update inventory.holdings
        set quantity = quantity + v_delta, updated_at = now()
        where user_id = v_role_user.user_id and template_id = v_asset.template_id;
        if v_delta > 0 then
          update admin.fixture_asset_ownership
          set fixture_version = p_fixture_version,
              available_quantity = available_quantity + v_delta,
              updated_at = now()
          where user_id = v_role_user.user_id
            and asset_kind = 'PET'
            and asset_key = v_asset.template_id;
        end if;
        insert into admin.fixture_asset_changes (
          run_key, role, user_id, asset_kind, asset_key, available_delta,
          aggregate_before, aggregate_after, fixture_owned_before, fixture_owned_after
        ) values (
          v_run_key, v_role_user.role, v_role_user.user_id, 'PET', v_asset.template_id, v_delta,
          jsonb_build_object('quantity', v_current_available),
          jsonb_build_object('quantity', v_current_available + v_delta),
          jsonb_build_object('quantity', v_owned_available),
          jsonb_build_object('quantity', v_target)
        );
        v_change_count := v_change_count + 1;
      end if;
    end loop;
  end loop;

  v_after := admin.battle_fixture_state(p_fixture_version, p_ordered_user_ids);
  if coalesce((v_after->>'aligned')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'BATTLE_FIXTURE_RECONCILIATION_FAILED';
  end if;
  v_result := jsonb_build_object(
    'run_key', v_run_key,
    'fixture_version', p_fixture_version,
    'fixture_definition_hash', v_definition_hash,
    'payload_hash', v_payload_hash,
    'result', case when v_change_count = 0 then 'noop' else 'applied' end,
    'asset_change_count', v_change_count,
    'state', v_after,
    'replayed', false
  );
  update admin.fixture_run_audit
  set after_aggregate = v_after,
      result = case when v_change_count = 0 then 'noop' else 'applied' end
  where run_key = v_run_key;
  update admin.fixture_commands
  set status = 'succeeded', result = v_result, completed_at = now()
  where request_id = p_request_id;
  return v_result;
end;
$$;
