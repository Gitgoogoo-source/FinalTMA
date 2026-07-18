create table core.users (
  id uuid primary key default extensions.gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  first_name text not null,
  last_name text,
  language_code text,
  status text not null default 'normal' check (status in ('normal', 'banned')),
  referral_code text not null unique,
  invited_by uuid references core.users(id),
  total_refund_stars bigint not null default 0 check (total_refund_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_invited_by_idx on core.users (invited_by);

create table core.sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
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

create index sessions_user_active_idx on core.sessions (user_id, expires_at desc) where revoked_at is null;

create table core.operations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  route text not null,
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, route, idempotency_key)
);

create index operations_user_created_idx on core.operations (user_id, created_at desc);
create index operations_pending_idx on core.operations (created_at) where status in ('pending', 'unknown');

create or replace function core.utc_day()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'utc')::date $$;

create or replace function core.random_basis_points()
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
