create table identity.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  language_code text,
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
  check (expires_at > created_at)
);

create index sessions_user_active_idx on identity.sessions (user_id, expires_at desc) where revoked_at is null;

create table identity.auth_attempts (
  id bigint generated always as identity primary key,
  key_hash text not null,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_key_time_idx on identity.auth_attempts (key_hash, attempted_at desc);

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

create or replace function api.session_user(p_session_id uuid)
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
  return v_session.user_id;
end;
$$;

create or replace function api.identity_check_rate_limit(p_key_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select count(*) into v_count
  from identity.auth_attempts
  where key_hash = p_key_hash and attempted_at >= now() - interval '1 minute';
  if v_count >= 3 then
    perform api.raise_business_error('RATE_LIMITED', '操作过于频繁，请稍后重试');
  end if;
  insert into identity.auth_attempts (key_hash) values (p_key_hash);
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
  )
  from identity.sessions s
  join identity.users u on u.id = s.user_id
  where s.token_hash = p_token_hash
$$;
