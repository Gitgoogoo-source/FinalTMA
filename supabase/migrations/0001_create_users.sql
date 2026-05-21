-- 0001_create_users.sql
-- Core foundation for Telegram Mini App users, sessions, wallet records and shared helper functions.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gin;
create extension if not exists pg_trgm;

create schema if not exists core;
create schema if not exists economy;
create schema if not exists catalog;
create schema if not exists gacha;
create schema if not exists inventory;
create schema if not exists market;
create schema if not exists payments;
create schema if not exists tasks;
create schema if not exists album;
create schema if not exists onchain;
create schema if not exists ops;
create schema if not exists api;

comment on schema core is 'Telegram user identity, profile, sessions, wallets and user-level state.';
comment on schema economy is 'Virtual currencies, balances, locks, immutable ledgers and fees.';
comment on schema catalog is 'Collectible definitions, rarity, forms, media and game catalog configuration.';
comment on schema gacha is 'Blind boxes, drop pools, pity states, orders and draw results.';
comment on schema inventory is 'User collectible instances, locks, upgrades, evolution and decomposition.';
comment on schema market is 'Marketplace listings, orders, pricing snapshots and fees.';
comment on schema payments is 'Telegram Stars orders, invoices, webhook events and disputes.';
comment on schema tasks is 'Tasks, sign-in campaigns, referrals and commission rewards.';
comment on schema album is 'Collection album, milestones and leaderboards.';
comment on schema onchain is 'TON wallet sync, NFT collection/item mapping, mint queue and transactions.';
comment on schema ops is 'Admin, audit, feature flags, risk and operational tables.';
comment on schema api is 'Security-definer database functions callable by trusted backend API.';

create or replace function core.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function core.request_claims()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

create or replace function core.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(core.request_claims() ->> 'app_user_id', '')::uuid;
$$;

create or replace function core.current_admin_id()
returns uuid
language sql
stable
as $$
  select nullif(core.request_claims() ->> 'admin_user_id', '')::uuid;
$$;

create table if not exists core.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  username citext,
  first_name text,
  last_name text,
  language_code text,
  is_premium boolean not null default false,
  is_bot boolean not null default false,
  photo_url text,
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10)),
  referred_by_user_id uuid references core.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'restricted', 'banned', 'deleted')),
  risk_score integer not null default 0 check (risk_score >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_auth_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table core.users is 'One row per Telegram user. This is the canonical app user identity.';
comment on column core.users.telegram_user_id is 'Telegram user id from verified Mini App initData.';
comment on column core.users.invite_code is 'Stable referral code used in Telegram deep links.';
comment on column core.users.referred_by_user_id is 'Optional inviter user, set once by referral logic.';

create table if not exists core.user_profiles (
  user_id uuid primary key references core.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  bio text,
  selected_item_instance_id uuid,
  selected_language text,
  timezone text,
  ui_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table core.user_profiles is 'User-facing profile and UI preferences.';
comment on column core.user_profiles.selected_item_instance_id is 'Selected showcase collectible. FK added later after inventory exists, if desired.';

create table if not exists core.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  session_token_hash text not null unique,
  telegram_auth_date timestamptz,
  init_data_hash text,
  ip_hash text,
  user_agent text,
  device_id text,
  platform text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table core.app_sessions is 'Short-lived app sessions issued after backend verifies Telegram initData.';

create table if not exists core.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  device_key text not null,
  platform text,
  user_agent text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, device_key)
);

create table if not exists core.user_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  chain text not null default 'TON' check (chain in ('TON')),
  network text not null default 'mainnet' check (network in ('mainnet', 'testnet')),
  address text not null,
  address_raw text,
  wallet_app_name text,
  wallet_device text,
  is_primary boolean not null default true,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'revoked')),
  verified_at timestamptz,
  disconnected_at timestamptz,
  last_sync_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table core.user_wallets is 'Public TON wallet addresses connected through TON Connect. Never stores private keys.';

create table if not exists core.wallet_proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  wallet_id uuid references core.user_wallets(id) on delete cascade,
  challenge text not null unique,
  address text,
  domain text,
  payload jsonb not null default '{}'::jsonb,
  proof_signature text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'failed', 'expired')),
  expires_at timestamptz not null,
  verified_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table core.wallet_proofs is 'TON Connect proof challenges and verification results. Used to prevent replay and fake wallet binding.';

create table if not exists core.user_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  flag_code text not null,
  flag_level text not null default 'info' check (flag_level in ('info', 'warning', 'restriction', 'ban')),
  reason text,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by_admin_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, flag_code, active)
);

create table if not exists core.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  notification_type text not null,
  title text,
  body text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table core.notifications is 'User notifications and red-dot messages for operation feedback.';

create table if not exists core.user_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  token_hash text not null unique,
  token_type text not null default 'app_session' check (token_type in ('app_session', 'admin_session', 'webhook_replay')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- Updated-at triggers are created in 0019_create_constraints.sql after all tables exist.
