-- 0011_create_ops_admin_audit.sql
-- Admin users, roles, audit logs, feature flags, risk events, idempotency and operational records.

create table if not exists ops.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into ops.admin_roles (code, display_name, permissions)
values
  ('SUPER_ADMIN', 'Super Admin', '["*"]'::jsonb),
  ('OPS', 'Operations', '["catalog:read","catalog:write","gacha:read","gacha:write","market:read","tasks:write"]'::jsonb),
  ('SUPPORT', 'Support', '["users:read","payments:read","tickets:write"]'::jsonb),
  ('RISK', 'Risk Control', '["users:read","risk:read","risk:write","market:read"]'::jsonb)
on conflict (code) do nothing;

create table if not exists ops.admin_users (
  id uuid primary key default gen_random_uuid(),
  core_user_id uuid references core.users(id) on delete set null,
  email citext unique,
  telegram_user_id bigint unique,
  display_name text,
  status text not null default 'active' check (status in ('active', 'disabled', 'locked')),
  last_login_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is not null or telegram_user_id is not null or core_user_id is not null)
);

create table if not exists ops.admin_user_roles (
  admin_user_id uuid not null references ops.admin_users(id) on delete cascade,
  role_id uuid not null references ops.admin_roles(id) on delete cascade,
  granted_by_admin_id uuid references ops.admin_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (admin_user_id, role_id)
);

create table if not exists ops.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references ops.admin_users(id) on delete set null,
  action text not null,
  target_schema text,
  target_table text,
  target_id uuid,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  reason text,
  created_at timestamptz not null default now()
);

comment on table ops.admin_audit_logs is 'Every high-risk admin change must be audited: drop pools, rewards, balances, fees, feature flags and user restrictions.';

create table if not exists ops.feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  rollout jsonb not null default '{}'::jsonb,
  updated_by_admin_id uuid references ops.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

insert into ops.feature_flags (key, enabled, description)
values
  ('gacha.open_box', true, 'Allow users to open blind boxes.'),
  ('market.enabled', true, 'Allow marketplace buying and selling.'),
  ('inventory.upgrade', true, 'Allow collectible upgrades.'),
  ('inventory.evolution', true, 'Allow collectible evolution.'),
  ('inventory.decompose', true, 'Allow collectible decomposition.'),
  ('wallet.ton_connect', true, 'Allow TON wallet connection.'),
  ('onchain.mint', false, 'Allow NFT minting.'),
  ('tasks.enabled', true, 'Allow task center and rewards.')
on conflict (key) do nothing;

create table if not exists ops.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by_admin_id uuid references ops.admin_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists ops.risk_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references core.users(id) on delete set null,
  event_type text not null,
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'ignored')),
  source_type text,
  source_id uuid,
  score_delta integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  resolved_by_admin_id uuid references ops.admin_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists ops.idempotency_keys (
  key text primary key,
  user_id uuid references core.users(id) on delete cascade,
  scope text not null,
  request_hash text,
  response jsonb,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ops.api_rate_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  subject_key text not null,
  window_key text not null,
  request_count integer not null default 1 check (request_count >= 0),
  blocked_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope, subject_key, window_key)
);

create table if not exists ops.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references core.users(id) on delete set null,
  ticket_type text not null check (ticket_type in ('payment', 'market', 'inventory', 'wallet', 'bug', 'other')),
  subject text not null,
  message text,
  status text not null default 'open' check (status in ('open', 'pending_user', 'pending_ops', 'resolved', 'closed')),
  related_type text,
  related_id uuid,
  assigned_admin_id uuid references ops.admin_users(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ops.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references core.users(id) on delete set null,
  event_name text not null,
  event_source text not null default 'web',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
