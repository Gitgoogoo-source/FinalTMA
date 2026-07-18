-- Generated from supabase/schemas. Edit declarative schemas, then regenerate.

-- source: 00_extensions.sql
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists core;
create schema if not exists catalog;
create schema if not exists economy;
create schema if not exists inventory;
create schema if not exists gameplay;
create schema if not exists market;
create schema if not exists onchain;
create schema if not exists ops;
create schema if not exists api;

-- source: 10_core.sql
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

-- source: 20_catalog.sql
create table catalog.chains (
  id text primary key check (id ~ '^CHAIN-[NAT]-[0-9]{3}$'),
  global_order smallint not null unique check (global_order between 1 and 70),
  chain_type text not null check (chain_type in ('normal', 'advanced', 'top')),
  theme text not null,
  continuity text not null,
  catalog_version text not null
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
  image_path text not null unique,
  draw_weight integer not null default 1 check (draw_weight > 0),
  catalog_version text not null,
  unique (chain_id, stage)
);

create index templates_chain_id_idx on catalog.templates (chain_id, stage);
create index templates_rarity_draw_idx on catalog.templates (rarity, sort_order);

create table catalog.boxes (
  tier text primary key check (tier in ('normal', 'rare', 'legendary')),
  display_name text not null,
  image_path text not null unique,
  single_price bigint not null check (single_price > 0),
  ten_price bigint not null check (ten_price = single_price * 9),
  pity_limit smallint not null check (pity_limit > 0),
  pity_rarity text not null check (pity_rarity in ('rare', 'epic', 'legendary')),
  rarity_weights jsonb not null
);

create table catalog.topup_products (
  amount bigint primary key check (amount > 0),
  sort_order smallint not null unique check (sort_order > 0)
);

-- source: 30_economy.sql
create table economy.balances (
  user_id uuid not null references core.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  available bigint not null default 0 check (available >= 0),
  locked bigint not null default 0 check (locked >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

create table economy.ledger (
  id bigint generated always as identity primary key,
  operation_id uuid references core.operations(id),
  user_id uuid not null references core.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  amount bigint not null check (amount <> 0),
  reason text not null,
  reference text,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index ledger_user_created_idx on economy.ledger (user_id, created_at desc);
create index ledger_operation_idx on economy.ledger (operation_id) where operation_id is not null;

create table economy.entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  kind text not null check (kind in ('free_normal_box', 'free_rare_box')),
  source text not null,
  status text not null default 'unused' check (status in ('unused', 'used', 'void')),
  operation_id uuid references core.operations(id),
  obtained_at timestamptz not null default now(),
  used_at timestamptz
);

create index entitlements_fifo_idx on economy.entitlements (user_id, kind, obtained_at, id) where status = 'unused';

create table economy.payments (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  operation_id uuid not null unique references core.operations(id),
  kind text not null check (kind in ('kcoin_topup', 'vip')),
  stars_amount bigint not null check (stars_amount > 0),
  kcoin_amount bigint check (kcoin_amount is null or kcoin_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'delivered', 'expired', 'cancelled', 'delivery_blocked')),
  invoice_payload text not null unique,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  paid_at timestamptz,
  delivered_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  refund_status text not null default 'none' check (refund_status in ('none', 'partial', 'full')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_pending_idx on economy.payments (expires_at, created_at) where status in ('pending', 'paid');
create index payments_user_created_idx on economy.payments (user_id, created_at desc);
create unique index payments_user_kind_open_idx on economy.payments (user_id, kind) where status in ('pending', 'paid');

create table economy.vip_subscriptions (
  user_id uuid primary key references core.users(id) on delete cascade,
  period_id uuid not null default extensions.gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  renewal_count smallint not null default 0 check (renewal_count between 0 and 2),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table economy.vip_claims (
  user_id uuid not null references core.users(id) on delete cascade,
  benefit_date date not null,
  benefit text not null check (benefit in ('fgems', 'free_rare_box')),
  operation_id uuid not null references core.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, benefit_date, benefit)
);

-- source: 40_inventory.sql
create table inventory.holdings (
  user_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index holdings_template_idx on inventory.holdings (template_id, user_id);

create table inventory.reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
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

create table inventory.album_nodes (
  user_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  first_operation_id uuid references core.operations(id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index album_nodes_template_idx on inventory.album_nodes (template_id, user_id);

create table inventory.album_rewards (
  user_id uuid not null references core.users(id) on delete cascade,
  chain_id text not null references catalog.chains(id),
  operation_id uuid not null references core.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, chain_id)
);

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

-- source: 50_gameplay.sql
create table gameplay.gacha_pity (
  user_id uuid not null references core.users(id) on delete cascade,
  tier text not null references catalog.boxes(tier),
  progress smallint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

create table gameplay.evolution_pity (
  user_id uuid not null references core.users(id) on delete cascade,
  from_template_id text not null references catalog.templates(id),
  failures smallint not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_template_id)
);

create table gameplay.expeditions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  operation_id uuid not null unique references core.operations(id),
  tier text not null check (tier in ('normal', 'intermediate', 'advanced')),
  status text not null default 'running' check (status in ('running', 'claimable', 'claimed')),
  reward_fgems bigint not null check (reward_fgems > 0),
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  claimed_at timestamptz,
  check (completes_at > started_at)
);

create unique index expeditions_user_tier_active_idx on gameplay.expeditions (user_id, tier) where status in ('running', 'claimable');
create index expeditions_due_idx on gameplay.expeditions (completes_at) where status = 'running';

create table gameplay.expedition_items (
  expedition_id uuid not null references gameplay.expeditions(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  primary key (expedition_id, template_id)
);

create index expedition_items_template_idx on gameplay.expedition_items (template_id, expedition_id);

create table gameplay.wheel_daily (
  user_id uuid not null references core.users(id) on delete cascade,
  business_date date not null,
  spin_count smallint not null default 0 check (spin_count between 0 and 20),
  normal_entitlements smallint not null default 0 check (normal_entitlements between 0 and 3),
  rare_entitlements smallint not null default 0 check (rare_entitlements between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

create table gameplay.wheel_results (
  operation_id uuid not null references core.operations(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 10),
  rolled_kind text not null,
  delivered_kind text not null,
  amount bigint not null check (amount > 0),
  replaced boolean not null default false,
  primary key (operation_id, sequence)
);

create table gameplay.task_definitions (
  code text primary key,
  sort_order smallint not null unique,
  category text not null,
  display_name text not null,
  target bigint not null check (target > 0),
  reward_fgems bigint not null check (reward_fgems > 0)
);

create table gameplay.daily_task_progress (
  user_id uuid not null references core.users(id) on delete cascade,
  business_date date not null,
  task_code text not null references gameplay.task_definitions(code),
  progress bigint not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  claim_operation_id uuid references core.operations(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date, task_code)
);

create index daily_task_progress_claimable_idx on gameplay.daily_task_progress (user_id, business_date) where claimed_at is null;

create table gameplay.checkins (
  user_id uuid primary key references core.users(id) on delete cascade,
  current_day smallint not null default 0 check (current_day between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

create table gameplay.referrals (
  invitee_id uuid primary key references core.users(id) on delete cascade,
  inviter_id uuid not null references core.users(id) on delete cascade,
  bound_at timestamptz not null default now(),
  first_recharge_at timestamptz,
  reward_fgems bigint not null default 0 check (reward_fgems in (0, 500)),
  reward_operation_id uuid references core.operations(id),
  unique (inviter_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create index referrals_inviter_bound_idx on gameplay.referrals (inviter_id, bound_at);
create index referrals_inviter_recharge_idx on gameplay.referrals (inviter_id, first_recharge_at) where first_recharge_at is not null;

create table gameplay.referral_milestones (
  user_id uuid not null references core.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null references core.operations(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);

-- source: 60_market.sql
create table market.listings (
  id uuid primary key default extensions.gen_random_uuid(),
  seller_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  unit_price bigint not null check (unit_price > 0),
  quantity bigint not null check (quantity > 0),
  remaining bigint not null check (remaining >= 0 and remaining <= quantity),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  operation_id uuid not null references core.operations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_fifo_idx on market.listings (template_id, created_at, id) where status = 'active' and remaining > 0;
create index listings_seller_active_idx on market.listings (seller_id, template_id, created_at) where status = 'active';

create table market.trades (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  total_price bigint not null check (total_price > 0),
  operation_id uuid not null unique references core.operations(id),
  created_at timestamptz not null default now()
);

create index trades_buyer_created_idx on market.trades (buyer_id, created_at desc);
create index trades_template_created_idx on market.trades (template_id, created_at desc);

create table market.trade_details (
  id bigint generated always as identity primary key,
  trade_id uuid not null references market.trades(id) on delete cascade,
  listing_id uuid not null references market.listings(id),
  seller_id uuid not null references core.users(id),
  quantity bigint not null check (quantity > 0),
  gross bigint not null check (gross > 0),
  fee bigint not null check (fee >= 0),
  seller_net bigint not null check (seller_net >= 0),
  vip_rebate bigint not null default 0 check (vip_rebate >= 0)
);

create index trade_details_trade_idx on market.trade_details (trade_id);
create index trade_details_seller_idx on market.trade_details (seller_id, id desc);

-- source: 70_onchain.sql
create table onchain.wallet_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  challenge text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallet_challenges_user_active_idx on onchain.wallet_challenges (user_id, expires_at desc) where consumed_at is null;

create table onchain.wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
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

create table onchain.mints (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  wallet_id uuid not null references onchain.wallets(id),
  template_id text not null references catalog.templates(id),
  operation_id uuid not null unique references core.operations(id),
  nft_number bigint generated always as identity (start with 0 minvalue 0) unique,
  nonce uuid not null default extensions.gen_random_uuid() unique,
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

create table onchain.nft_metadata (
  nft_number bigint primary key,
  mint_id uuid not null unique references onchain.mints(id),
  snapshot jsonb not null,
  checksum text not null,
  created_at timestamptz not null default now()
);

-- source: 75_ops.sql
create table ops.webhook_events (
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

create table ops.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references economy.payments(id),
  provider_event_id text not null unique,
  stars bigint not null check (stars > 0),
  created_at timestamptz not null default now()
);

create index refunds_payment_idx on ops.refunds (payment_id);

create table ops.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  processed_count integer not null default 0 check (processed_count >= 0),
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index job_runs_name_started_idx on ops.job_runs (job_name, started_at desc);

create table ops.invariant_violations (
  id bigint generated always as identity primary key,
  code text not null,
  subject text not null,
  details jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index invariant_violations_open_idx on ops.invariant_violations (code, detected_at) where resolved_at is null;
create unique index invariant_violations_open_subject_idx on ops.invariant_violations (code, subject) where resolved_at is null;

create table ops.auth_attempts (
  id bigint generated always as identity primary key,
  key_hash text not null,
  attempted_at timestamptz not null default now()
);

create index auth_attempts_key_time_idx on ops.auth_attempts (key_hash, attempted_at desc);

-- source: 80_api.sql
create or replace function catalog.rarity_rank(p_rarity text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case p_rarity when 'common' then 1 when 'rare' then 2 when 'epic' then 3 when 'legendary' then 4 when 'mythic' then 5 else 0 end::smallint
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
    raise exception 'INSUFFICIENT_BALANCE:余额不足';
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

create or replace function inventory.change_holding(p_user_id uuid, p_template_id text, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity bigint;
begin
  insert into inventory.holdings (user_id, template_id) values (p_user_id, p_template_id)
  on conflict (user_id, template_id) do nothing;
  select quantity into v_quantity from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id for update;
  if v_quantity + p_amount < 0 then
    raise exception 'INSUFFICIENT_INVENTORY:藏品数量不足';
  end if;
  v_quantity := v_quantity + p_amount;
  update inventory.holdings set quantity = v_quantity, updated_at = now()
  where user_id = p_user_id and template_id = p_template_id;
  return v_quantity;
end;
$$;

create or replace function inventory.unlock_template(p_user_id uuid, p_template_id text, p_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint;
begin
  insert into inventory.album_nodes (user_id, template_id, first_operation_id)
  values (p_user_id, p_template_id, p_operation_id)
  on conflict (user_id, template_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create or replace function gameplay.progress_task(p_user_id uuid, p_task_code text, p_amount bigint default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into gameplay.daily_task_progress (user_id, business_date, task_code, progress)
  select p_user_id, core.utc_day(), p_task_code, p_amount
  where exists (select 1 from gameplay.task_definitions where code = p_task_code)
  on conflict (user_id, business_date, task_code)
  do update set progress = gameplay.daily_task_progress.progress + excluded.progress, updated_at = now()
$$;

create or replace function api.assert_normal_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from core.users where id = p_user_id and status = 'normal') then
    raise exception 'ACCOUNT_RESTRICTED:账号不可用';
  end if;
end;
$$;

create or replace function api.create_telegram_session(
  p_telegram_id bigint,
  p_username text,
  p_first_name text,
  p_last_name text,
  p_language_code text,
  p_referral_code text,
  p_token_hash text,
  p_auth_date timestamptz,
  p_expires_at timestamptz,
  p_start_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user core.users;
  v_session_id uuid;
  v_new_user boolean;
begin
  insert into core.users (telegram_id, username, first_name, last_name, language_code, referral_code)
  values (p_telegram_id, p_username, p_first_name, p_last_name, p_language_code, p_referral_code)
  on conflict (telegram_id) do nothing
  returning * into v_user;
  v_new_user := v_user.id is not null;
  if not v_new_user then
    update core.users set username = p_username, first_name = p_first_name, last_name = p_last_name, language_code = p_language_code, updated_at = now()
    where telegram_id = p_telegram_id returning * into v_user;
  end if;

  update core.sessions set revoked_at = now()
  where user_id = v_user.id and revoked_at is null;

  insert into core.sessions (user_id, token_hash, auth_date, expires_at, new_user, start_param)
  values (v_user.id, p_token_hash, p_auth_date, p_expires_at, v_new_user, p_start_param)
  returning id into v_session_id;

  insert into economy.balances (user_id, currency) values
    (v_user.id, 'KCOIN'), (v_user.id, 'FGEMS')
  on conflict do nothing;

  return jsonb_build_object(
    'session_id', v_session_id,
    'user_id', v_user.id,
    'account_status', v_user.status,
    'new_user', v_new_user,
    'expires_at', p_expires_at
  );
end;
$$;

create or replace function api.check_auth_rate_limit(p_key_hash text, p_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_limit not between 1 and 1000 then raise exception 'RATE_LIMIT_INVALID:频率限制配置无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash, 0));
  select count(*) into v_count from ops.auth_attempts where key_hash = p_key_hash and attempted_at >= now() - interval '1 minute';
  if v_count >= p_limit then raise exception 'RATE_LIMITED:操作过于频繁，请稍后重试'; end if;
  insert into ops.auth_attempts (key_hash) values (p_key_hash);
end;
$$;

create or replace function api.resolve_session(p_token_hash text)
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
    'session_state', case when s.revoked_at is not null then 'replaced' when s.expires_at <= now() then 'expired' else 'active' end
  )
  from core.sessions s
  join core.users u on u.id = s.user_id
  where s.token_hash = p_token_hash
$$;

create or replace function api.create_wallet_challenge(p_user_id uuid, p_challenge text, p_expires_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform api.assert_normal_user(p_user_id);
  insert into onchain.wallet_challenges (user_id, challenge, expires_at)
  values (p_user_id, p_challenge, p_expires_at) returning id into v_id;
  return jsonb_build_object('id', v_id, 'challenge', p_challenge, 'expires_at', p_expires_at);
end;
$$;

create or replace function api.save_verified_wallet(
  p_user_id uuid,
  p_challenge text,
  p_address text,
  p_network text,
  p_wallet_app_name text,
  p_public_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet onchain.wallets;
  v_operation core.operations%rowtype;
  v_existing core.operations%rowtype;
  v_result jsonb;
begin
  perform api.assert_normal_user(p_user_id);
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 128 then
    raise exception 'IDEMPOTENCY_KEY_INVALID:幂等键无效';
  end if;
  insert into core.operations (user_id, route, idempotency_key, request)
  values (p_user_id, 'wallet.proof', p_idempotency_key, jsonb_build_object('address', p_address, 'network', p_network))
  on conflict (user_id, route, idempotency_key) do nothing returning * into v_operation;
  if v_operation.id is null then
    select * into strict v_existing from core.operations where user_id = p_user_id and route = 'wallet.proof' and idempotency_key = p_idempotency_key;
    if v_existing.status = 'failed' then raise exception '%:%', coalesce(v_existing.error_code, 'WALLET_PROOF_FAILED'), coalesce(v_existing.result->>'message', '钱包验证失败'); end if;
    return coalesce(v_existing.result, '{}'::jsonb) || jsonb_build_object('operation_id', v_existing.id);
  end if;
  update onchain.wallet_challenges set consumed_at = now()
  where user_id = p_user_id and challenge = p_challenge and consumed_at is null and expires_at > now();
  if not found then raise exception 'WALLET_CHALLENGE_INVALID:钱包验证请求已失效'; end if;
  if exists (select 1 from onchain.wallets where address = p_address and user_id <> p_user_id) then
    raise exception 'WALLET_ADDRESS_IN_USE:该钱包已绑定其他账号';
  end if;
  update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now()
  where user_id = p_user_id and status = 'verified';
  insert into onchain.wallets (user_id, address, network, wallet_app_name, public_key)
  values (p_user_id, p_address, p_network, p_wallet_app_name, p_public_key)
  on conflict (address) do update set status = 'verified', disconnected_at = null, verified_at = now(), updated_at = now(), wallet_app_name = excluded.wallet_app_name, public_key = excluded.public_key
  returning * into v_wallet;
  perform gameplay.progress_task(p_user_id, 'wallet_verified');
  v_result := jsonb_build_object('wallet_id', v_wallet.id, 'address', v_wallet.address, 'network', v_wallet.network, 'verified', true, 'verified_at', v_wallet.verified_at);
  update core.operations set status = 'succeeded', result = v_result, updated_at = now() where id = v_operation.id;
  return v_result || jsonb_build_object('operation_id', v_operation.id);
end;
$$;

create or replace function api.query(p_action text, p_user_id uuid, p_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_operation uuid;
begin
  if p_action = 'catalog.get' then
    select jsonb_build_object(
      'version', 'v1',
      'chains', coalesce((select jsonb_agg(to_jsonb(c) order by c.global_order) from catalog.chains c), '[]'::jsonb),
      'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort_order) from catalog.templates t), '[]'::jsonb)
    ) into v_result;
    return v_result;
  end if;

  if p_action = 'nft.metadata' then
    select snapshot into v_result from onchain.nft_metadata where nft_number = (p_input->>'nft_id')::bigint;
    if v_result is null then raise exception 'NFT_METADATA_NOT_FOUND:NFT 元数据不存在'; end if;
    return v_result;
  end if;

  perform api.assert_normal_user(p_user_id);

  if p_action = 'me.assets' then
    select jsonb_build_object(
      'userId', p_user_id,
      'balances', jsonb_build_object(
        'KCOIN', jsonb_build_object('currencyCode', 'KCOIN', 'available', coalesce(max(available) filter (where currency = 'KCOIN'), 0)::text, 'locked', coalesce(max(locked) filter (where currency = 'KCOIN'), 0)::text),
        'FGEMS', jsonb_build_object('currencyCode', 'FGEMS', 'available', coalesce(max(available) filter (where currency = 'FGEMS'), 0)::text, 'locked', coalesce(max(locked) filter (where currency = 'FGEMS'), 0)::text)
      ),
      'assets', jsonb_build_object(
        'kcoin', jsonb_build_object('currencyCode', 'KCOIN', 'available', coalesce(max(available) filter (where currency = 'KCOIN'), 0)::text, 'locked', coalesce(max(locked) filter (where currency = 'KCOIN'), 0)::text),
        'fgems', jsonb_build_object('currencyCode', 'FGEMS', 'available', coalesce(max(available) filter (where currency = 'FGEMS'), 0)::text, 'locked', coalesce(max(locked) filter (where currency = 'FGEMS'), 0)::text)
      ),
      'updatedAt', max(updated_at)
    ) into v_result from economy.balances where user_id = p_user_id;
  elsif p_action = 'me.bootstrap' then
    select jsonb_build_object(
      'user', jsonb_build_object('id', u.id, 'telegram_id', u.telegram_id, 'username', u.username, 'first_name', u.first_name, 'status', u.status, 'referral_code', u.referral_code),
      'assets', api.query('me.assets', p_user_id, '{}'::jsonb),
      'entitlements', jsonb_build_object(
        'free_normal_box', (select count(*) from economy.entitlements where user_id = p_user_id and kind = 'free_normal_box' and status = 'unused'),
        'free_rare_box', (select count(*) from economy.entitlements where user_id = p_user_id and kind = 'free_rare_box' and status = 'unused')
      ),
      'topup_amounts', (select jsonb_agg(amount order by sort_order) from catalog.topup_products),
      'server_time', now()
    ) into v_result from core.users u where u.id = p_user_id;
  elsif p_action = 'boxes.list' then
    select jsonb_build_object('boxes', jsonb_agg(to_jsonb(b) order by case b.tier when 'normal' then 1 when 'rare' then 2 else 3 end)) into v_result from catalog.boxes b;
  elsif p_action = 'boxes.rewards' then
    select jsonb_build_object(
      'tier', b.tier,
      'rarity_weights', b.rarity_weights,
      'templates', coalesce(jsonb_agg(jsonb_build_object(
        'template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'stage', t.stage,
        'image_path', t.image_path
      ) order by t.sort_order) filter (where t.id is not null), '[]'::jsonb)
    ) into v_result
    from catalog.boxes b
    left join catalog.templates t on coalesce((b.rarity_weights->>t.rarity)::integer, 0) > 0
    where b.tier = p_input->>'tier'
    group by b.tier, b.rarity_weights;
    if v_result is null then raise exception 'BOX_NOT_FOUND:盲盒不存在'; end if;
  elsif p_action = 'boxes.pity' then
    select jsonb_build_object('pity', coalesce(jsonb_agg(jsonb_build_object('tier', b.tier, 'progress', coalesce(p.progress, 0), 'limit', b.pity_limit, 'target_rarity', b.pity_rarity) order by b.tier), '[]'::jsonb)) into v_result
    from catalog.boxes b left join gameplay.gacha_pity p on p.user_id = p_user_id and p.tier = b.tier;
  elsif p_action in ('boxes.result', 'wheel.result', 'expeditions.result', 'operations.result') then
    v_operation := (p_input->>'operation_id')::uuid;
    select jsonb_build_object('operation_id', id, 'type', route, 'status', status, 'result', result, 'error_code', error_code) into v_result
    from core.operations where id = v_operation and user_id = p_user_id;
    if v_result is null then raise exception 'OPERATION_NOT_FOUND:操作记录不存在'; end if;
  elsif p_action in ('inventory.list', 'inventory.group_items', 'inventory.summary') then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(jsonb_build_object(
        'template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'stage', t.stage, 'chain_id', t.chain_id,
        'chain_type', c.chain_type, 'image_path', t.image_path, 'combat_power', t.combat_power,
        'expedition_fgems', t.expedition_fgems, 'total', h.quantity,
        'available', inventory.available_quantity(p_user_id, t.id),
        'listed', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'listing' and r.status = 'active'), 0),
        'expedition', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'expedition' and r.status = 'active'), 0),
        'minting', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'mint' and r.status = 'active'), 0)
      ) order by t.sort_order) filter (where h.quantity > 0), '[]'::jsonb),
      'template_count', count(*) filter (where h.quantity > 0),
      'total_quantity', coalesce(sum(h.quantity), 0)
    ) into v_result
    from inventory.holdings h
    join catalog.templates t on t.id = h.template_id
    join catalog.chains c on c.id = t.chain_id
    where h.user_id = p_user_id;
  elsif p_action = 'inventory.detail' then
    select jsonb_build_object('items', jsonb_build_array(jsonb_build_object(
      'template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'stage', t.stage,
      'chain_id', t.chain_id, 'chain_type', c.chain_type, 'image_path', t.image_path,
      'combat_power', t.combat_power, 'expedition_fgems', t.expedition_fgems,
      'total', h.quantity, 'available', inventory.available_quantity(p_user_id, t.id),
      'listed', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'listing' and r.status = 'active'), 0),
      'expedition', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'expedition' and r.status = 'active'), 0),
      'minting', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'mint' and r.status = 'active'), 0)
    ))) into v_result
    from inventory.holdings h
    join catalog.templates t on t.id = h.template_id
    join catalog.chains c on c.id = t.chain_id
    where h.user_id = p_user_id and h.template_id = p_input->>'template_id' and h.quantity > 0;
    if v_result is null then raise exception 'INVENTORY_ITEM_NOT_FOUND:藏品不存在'; end if;
  elsif p_action = 'market.listings' then
    select jsonb_build_object('templates', coalesce(jsonb_agg(jsonb_build_object('template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'image_path', t.image_path, 'unit_price', t.market_price, 'available_quantity', x.quantity) order by t.sort_order), '[]'::jsonb)) into v_result
    from (select l.template_id, sum(l.remaining) quantity from market.listings l join core.users u on u.id = l.seller_id where l.status = 'active' and l.remaining > 0 and u.status = 'normal' and l.seller_id <> p_user_id group by l.template_id) x join catalog.templates t on t.id = x.template_id;
  elsif p_action = 'market.template_detail' then
    select jsonb_build_object(
      'template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'stage', t.stage,
      'image_path', t.image_path, 'unit_price', t.market_price,
      'available_quantity', coalesce((select sum(l.remaining) from market.listings l join core.users u on u.id = l.seller_id where l.template_id = t.id and l.status = 'active' and l.remaining > 0 and u.status = 'normal' and l.seller_id <> p_user_id), 0)
    ) into v_result from catalog.templates t where t.id = p_input->>'template_id';
    if v_result is null then raise exception 'TEMPLATE_NOT_FOUND:藏品模板不存在'; end if;
  elsif p_action = 'market.sellable_items' then
    v_result := api.query('inventory.list', p_user_id, p_input);
  elsif p_action = 'market.sell_rules' then
    v_result := jsonb_build_object('max_active_templates', 50, 'fee_bps', 500, 'vip_rebate_bps', 2000);
  elsif p_action in ('market.my_listings', 'market.my_listing_stats') then
    select jsonb_build_object('listings', coalesce(jsonb_agg(to_jsonb(x) order by x.created_at), '[]'::jsonb)) into v_result
    from (
      select l.template_id, t.name, t.rarity, t.image_path, sum(l.remaining) quantity, max(l.unit_price) unit_price, min(l.created_at) created_at
      from market.listings l join catalog.templates t on t.id = l.template_id
      where l.seller_id = p_user_id and l.status = 'active'
      group by l.template_id, t.name, t.rarity, t.image_path
    ) x;
  elsif p_action in ('album.progress', 'album.items') then
    select jsonb_build_object(
      'unlocked_count', (select count(*) from inventory.album_nodes where user_id = p_user_id),
      'total_count', 210,
      'chains', coalesce(jsonb_agg(jsonb_build_object('chain_id', c.id, 'chain_type', c.chain_type, 'theme', c.theme, 'unlocked', (select count(*) from inventory.album_nodes n join catalog.templates t on t.id = n.template_id where n.user_id = p_user_id and t.chain_id = c.id), 'claimed', exists(select 1 from inventory.album_rewards r where r.user_id = p_user_id and r.chain_id = c.id)) order by c.global_order), '[]'::jsonb)
    ) into v_result from catalog.chains c;
  elsif p_action in ('tasks.list', 'tasks.overview') then
    select jsonb_build_object('business_date', core.utc_day(), 'tasks', coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'category', d.category, 'name', d.display_name, 'target', d.target, 'reward_fgems', d.reward_fgems, 'progress', least(coalesce(p.progress, 0), d.target), 'claimed', p.claimed_at is not null) order by d.sort_order), '[]'::jsonb)) into v_result
    from gameplay.task_definitions d left join gameplay.daily_task_progress p on p.user_id = p_user_id and p.business_date = core.utc_day() and p.task_code = d.code;
  elsif p_action = 'tasks.check_in_status' then
    select jsonb_build_object('current_day', coalesce(current_day, 0), 'claimed_today', last_claim_date = core.utc_day(), 'next_day', case when coalesce(current_day, 0) = 7 then 1 else coalesce(current_day, 0) + 1 end) into v_result from gameplay.checkins where user_id = p_user_id;
    v_result := coalesce(v_result, jsonb_build_object('current_day', 0, 'claimed_today', false, 'next_day', 1));
  elsif p_action in ('tasks.invite_stats', 'tasks.referral_link', 'tasks.prepared_share_message') then
    select jsonb_build_object(
      'referral_code', u.referral_code,
      'link', 'https://t.me/' || (p_input->>'bot_username') || '/' || (p_input->>'mini_app_short_name') || '?startapp=' || u.referral_code,
      'bound_friends', (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id),
      'valid_recharge_friends', (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id and r.first_recharge_at is not null),
      'reward_fgems_total', (select coalesce(sum(r.reward_fgems), 0) from gameplay.referrals r where r.inviter_id = p_user_id),
      'rewarded_today', (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id and r.first_recharge_at::date = core.utc_day() and r.reward_fgems = 500),
      'rewarded_lifetime', (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id and r.reward_fgems = 500),
      'milestone_5_status', coalesce((select case e.status when 'unused' then '已发放' when 'used' then '已使用' else '已作废' end from gameplay.referral_milestones m join economy.entitlements e on e.operation_id = m.operation_id and e.kind = 'free_normal_box' where m.user_id = p_user_id and m.threshold = 5), case when (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id and r.first_recharge_at is not null) >= 5 then '确认中' else '未达成' end),
      'milestone_10_status', coalesce((select case e.status when 'unused' then '已发放' when 'used' then '已使用' else '已作废' end from gameplay.referral_milestones m join economy.entitlements e on e.operation_id = m.operation_id and e.kind = 'free_rare_box' where m.user_id = p_user_id and m.threshold = 10), case when (select count(*) from gameplay.referrals r where r.inviter_id = p_user_id and r.first_recharge_at is not null) >= 10 then '确认中' else '未达成' end),
      'share_text', '邀请好友一起开盲盒。好友通过你的链接加入并完成首次有效充值后，你可获得500 Fgems；累计邀请5位有效充值好友可额外获得1次免费普通盲盒资格，累计邀请10位有效充值好友可额外获得1次免费稀有盲盒资格。'
    ) into v_result from core.users u where u.id = p_user_id;
  elsif p_action = 'vip.status' then
    select jsonb_build_object('active', coalesce(core.utc_day() between starts_on and ends_on, false), 'starts_on', starts_on, 'ends_on', ends_on, 'renewal_count', coalesce(renewal_count, 0), 'fgems_claimed_today', exists(select 1 from economy.vip_claims where user_id = p_user_id and benefit_date = core.utc_day() and benefit = 'fgems'), 'free_box_claimed_today', exists(select 1 from economy.vip_claims where user_id = p_user_id and benefit_date = core.utc_day() and benefit = 'free_rare_box')) into v_result from economy.vip_subscriptions where user_id = p_user_id;
    v_result := coalesce(v_result, jsonb_build_object('active', false, 'renewal_count', 0, 'fgems_claimed_today', false, 'free_box_claimed_today', false));
  elsif p_action = 'expeditions.bootstrap' then
    select jsonb_build_object(
      'business_date', core.utc_day(),
      'rules', jsonb_build_array(
        jsonb_build_object('tier', 'normal', 'rarities', jsonb_build_array('common', 'rare', 'epic'), 'duration_minutes', 30, 'daily_limit', 2),
        jsonb_build_object('tier', 'intermediate', 'rarities', jsonb_build_array('rare', 'epic', 'legendary'), 'duration_minutes', 60, 'daily_limit', 1),
        jsonb_build_object('tier', 'advanced', 'rarities', jsonb_build_array('epic', 'legendary', 'mythic'), 'duration_minutes', 180, 'daily_limit', 1)
      ),
      'active', coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'tier', e.tier, 'status', case when e.status = 'running' and e.completes_at <= now() then 'claimable' else e.status end,
        'reward_fgems', e.reward_fgems, 'started_at', e.started_at, 'completes_at', e.completes_at,
        'items', (select jsonb_agg(jsonb_build_object('template_id', i.template_id, 'name', t.name, 'image_path', t.image_path, 'quantity', i.quantity) order by t.sort_order) from gameplay.expedition_items i join catalog.templates t on t.id = i.template_id where i.expedition_id = e.id)
      ) order by e.started_at) filter (where e.id is not null), '[]'::jsonb),
      'used_today', jsonb_build_object(
        'normal', (select count(*) from gameplay.expeditions x where x.user_id = p_user_id and x.tier = 'normal' and (x.started_at at time zone 'utc')::date = core.utc_day()),
        'intermediate', (select count(*) from gameplay.expeditions x where x.user_id = p_user_id and x.tier = 'intermediate' and (x.started_at at time zone 'utc')::date = core.utc_day()),
        'advanced', (select count(*) from gameplay.expeditions x where x.user_id = p_user_id and x.tier = 'advanced' and (x.started_at at time zone 'utc')::date = core.utc_day())
      )
    ) into v_result
    from gameplay.expeditions e where e.user_id = p_user_id and e.status in ('running', 'claimable');
  elsif p_action = 'expeditions.eligible_items' then
    if p_input->>'tier' not in ('normal', 'intermediate', 'advanced') then raise exception 'EXPEDITION_TIER_INVALID:远征档次无效'; end if;
    select jsonb_build_object('tier', p_input->>'tier', 'items', coalesce(jsonb_agg(jsonb_build_object(
      'template_id', t.id, 'name', t.name, 'rarity', t.rarity, 'stage', t.stage, 'chain_type', c.chain_type,
      'image_path', t.image_path, 'available', inventory.available_quantity(p_user_id, t.id), 'unit_reward_fgems', t.expedition_fgems
    ) order by t.sort_order), '[]'::jsonb)) into v_result
    from inventory.holdings h join catalog.templates t on t.id = h.template_id join catalog.chains c on c.id = t.chain_id
    where h.user_id = p_user_id and inventory.available_quantity(p_user_id, t.id) > 0
      and ((p_input->>'tier' = 'normal' and catalog.rarity_rank(t.rarity) between 1 and 3)
        or (p_input->>'tier' = 'intermediate' and catalog.rarity_rank(t.rarity) between 2 and 4)
        or (p_input->>'tier' = 'advanced' and catalog.rarity_rank(t.rarity) between 3 and 5));
  elsif p_action = 'wheel.bootstrap' then
    select jsonb_build_object('business_date', core.utc_day(), 'spin_count', coalesce(spin_count, 0), 'daily_limit', 20, 'remaining', 20 - coalesce(spin_count, 0), 'single_cost', 20, 'ten_cost', 180, 'normal_entitlements_today', coalesce(normal_entitlements, 0), 'rare_entitlements_today', coalesce(rare_entitlements, 0)) into v_result from gameplay.wheel_daily where user_id = p_user_id and business_date = core.utc_day();
    v_result := coalesce(v_result, jsonb_build_object('business_date', core.utc_day(), 'spin_count', 0, 'daily_limit', 20, 'remaining', 20, 'single_cost', 20, 'ten_cost', 180, 'normal_entitlements_today', 0, 'rare_entitlements_today', 0));
  elsif p_action = 'topup.status' then
    if p_input->>'operation_id' is not null then
      select to_jsonb(p) into v_result from economy.payments p where p.user_id = p_user_id and p.operation_id = (p_input->>'operation_id')::uuid;
    else
      select jsonb_build_object('payments', coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)) into v_result
      from (select * from economy.payments where user_id = p_user_id and status in ('pending', 'paid') order by created_at desc limit 10) p;
    end if;
  elsif p_action = 'wallet.status' then
    select jsonb_strip_nulls(jsonb_build_object(
      'connected', w.status = 'verified', 'verified', w.status = 'verified',
      'status', case when w.status = 'verified' then 'verified' else w.status end,
      'walletId', w.id, 'address', w.address, 'chain', upper(w.network), 'network', w.network,
      'walletAppName', w.wallet_app_name, 'verifiedAt', w.verified_at, 'connectedAt', w.verified_at,
      'disconnectedAt', w.disconnected_at, 'serverTime', now()
    )) into v_result
    from onchain.wallets w where w.user_id = p_user_id order by w.updated_at desc limit 1;
    v_result := coalesce(v_result, jsonb_build_object('connected', false, 'verified', false, 'status', 'not_connected', 'serverTime', now()));
  elsif p_action = 'wallet.mint_status' then
    select jsonb_build_object('mint_id', m.id, 'operation_id', m.operation_id, 'template_id', m.template_id, 'status', m.status, 'transaction_hash', m.transaction_hash, 'nft_address', m.nft_address, 'metadata_uri', m.metadata_uri) into v_result from onchain.mints m where m.user_id = p_user_id and m.operation_id = (p_input->>'operation_id')::uuid;
    if v_result is null then raise exception 'MINT_NOT_FOUND:Mint 操作不存在'; end if;
  else
    raise exception 'API_ROUTE_NOT_FOUND:接口不存在';
  end if;
  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function api.execute(
  p_action text,
  p_user_id uuid,
  p_idempotency_key text,
  p_input jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation core.operations%rowtype;
  v_existing core.operations%rowtype;
  v_template catalog.templates%rowtype;
  v_target catalog.templates%rowtype;
  v_box catalog.boxes%rowtype;
  v_wallet onchain.wallets%rowtype;
  v_session core.sessions%rowtype;
  v_expedition gameplay.expeditions%rowtype;
  v_listing record;
  v_item record;
  v_trade_id uuid;
  v_reference_id uuid;
  v_entitlement_id uuid;
  v_count integer;
  v_random integer;
  v_progress integer;
  v_quantity bigint;
  v_available bigint;
  v_price bigint;
  v_reward bigint;
  v_total bigint;
  v_take bigint;
  v_gross bigint;
  v_fee bigint;
  v_rebate bigint;
  v_daily_count integer;
  v_limit integer;
  v_duration interval;
  v_failures integer;
  v_guarantee integer;
  v_rate integer;
  v_rarity text;
  v_target_rarity text;
  v_kind text;
  v_result jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_free boolean := false;
  v_success boolean := false;
  v_triggered boolean := false;
  v_new_album boolean := false;
  v_error text;
  v_invoice_payload text;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 128 then
    raise exception 'IDEMPOTENCY_KEY_INVALID:幂等键无效';
  end if;
  perform api.assert_normal_user(p_user_id);

  insert into core.operations (id, user_id, route, idempotency_key, request)
  values (
    case
      when p_idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then p_idempotency_key::uuid
      else extensions.gen_random_uuid()
    end,
    p_user_id, p_action, p_idempotency_key, p_input
  )
  on conflict do nothing
  returning * into v_operation;

  if v_operation.id is null then
    select * into v_existing from core.operations
    where user_id = p_user_id and route = p_action and idempotency_key = p_idempotency_key;
    if v_existing.id is null then raise exception 'IDEMPOTENCY_KEY_CONFLICT:幂等键与其他操作冲突'; end if;
    return jsonb_build_object('operation_id', v_existing.id, 'status', v_existing.status, 'result', v_existing.result, 'error_code', v_existing.error_code);
  end if;

  begin
    if p_action = 'boxes.create_open_order' then
      v_kind := p_input->>'box_tier';
      v_count := (p_input->>'draw_count')::integer;
      if v_count not in (1, 10) then raise exception 'DRAW_COUNT_INVALID:开盒次数无效'; end if;
      select * into strict v_box from catalog.boxes where tier = v_kind;

      if v_count = 1 and v_kind in ('normal', 'rare') then
        select id into v_entitlement_id from economy.entitlements
        where user_id = p_user_id and kind = case v_kind when 'normal' then 'free_normal_box' else 'free_rare_box' end and status = 'unused'
        order by obtained_at, id limit 1 for update;
        v_free := v_entitlement_id is not null;
      end if;

      if v_free then
        update economy.entitlements set status = 'used', used_at = now() where id = v_entitlement_id;
      else
        v_price := case when v_count = 10 then v_box.ten_price else v_box.single_price end;
        perform economy.change_balance(p_user_id, 'KCOIN', -v_price, 'gacha', v_operation.id, v_kind);
        insert into gameplay.gacha_pity (user_id, tier) values (p_user_id, v_kind) on conflict do nothing;
        select progress into v_progress from gameplay.gacha_pity where user_id = p_user_id and tier = v_kind for update;
      end if;

      for v_i in 1..v_count loop
        v_random := core.random_basis_points();
        if v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) then v_rarity := 'common';
        elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) then v_rarity := 'rare';
        elsif v_random < coalesce((v_box.rarity_weights->>'common')::integer, 0) + coalesce((v_box.rarity_weights->>'rare')::integer, 0) + coalesce((v_box.rarity_weights->>'epic')::integer, 0) then v_rarity := 'epic';
        elsif v_random < 10000 - coalesce((v_box.rarity_weights->>'mythic')::integer, 0) then v_rarity := 'legendary';
        else v_rarity := 'mythic'; end if;

        v_triggered := false;
        if not v_free then
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

        select * into strict v_template from catalog.templates where rarity = v_rarity order by extensions.gen_random_uuid() limit 1;
        perform inventory.change_holding(p_user_id, v_template.id, 1);
        v_new_album := inventory.unlock_template(p_user_id, v_template.id, v_operation.id);
        if v_new_album then perform gameplay.progress_task(p_user_id, 'album_unlock'); end if;
        v_results := v_results || jsonb_build_array(jsonb_build_object('sequence', v_i, 'template_id', v_template.id, 'name', v_template.name, 'rarity', v_template.rarity, 'image_path', v_template.image_path, 'pity_triggered', v_triggered, 'new', v_new_album));
      end loop;

      if not v_free then
        update gameplay.gacha_pity set progress = v_progress, updated_at = now() where user_id = p_user_id and tier = v_kind;
      end if;
      perform gameplay.progress_task(p_user_id, 'gacha_1', v_count);
      perform gameplay.progress_task(p_user_id, 'gacha_10', v_count);
      if v_count = 10 then perform gameplay.progress_task(p_user_id, 'gacha_ten'); end if;
      v_result := jsonb_build_object('tier', v_kind, 'draw_count', v_count, 'free', v_free, 'results', v_results, 'pity_progress', case when v_free then null else v_progress end);

    elsif p_action = 'inventory.evolve' then
      select * into strict v_template from catalog.templates where id = p_input->>'template_id' for share;
      if v_template.stage = 3 then raise exception 'EVOLUTION_FINAL_STAGE:最终形态不能进化'; end if;
      select * into strict v_target from catalog.templates where chain_id = v_template.chain_id and stage = v_template.stage + 1;
      v_available := inventory.available_quantity(p_user_id, v_template.id);
      if v_available < 3 then raise exception 'INSUFFICIENT_INVENTORY:需要三个可用材料'; end if;
      select case v_target.rarity when 'rare' then 95 when 'epic' then 60 when 'legendary' then 35 else 20 end,
             case v_target.rarity when 'rare' then 30 when 'epic' then 120 when 'legendary' then 500 else 2000 end,
             case v_target.rarity when 'rare' then 2 when 'epic' then 3 when 'legendary' then 5 else 8 end
      into v_rate, v_price, v_guarantee;
      insert into gameplay.evolution_pity (user_id, from_template_id) values (p_user_id, v_template.id) on conflict do nothing;
      select failures into v_failures from gameplay.evolution_pity where user_id = p_user_id and from_template_id = v_template.id for update;
      perform economy.change_balance(p_user_id, 'FGEMS', -v_price, 'evolution', v_operation.id, v_template.id);
      v_success := v_failures + 1 >= v_guarantee or core.random_basis_points() < v_rate * 100;
      if v_success then
        perform inventory.change_holding(p_user_id, v_template.id, -3);
        perform inventory.change_holding(p_user_id, v_target.id, 1);
        v_new_album := inventory.unlock_template(p_user_id, v_target.id, v_operation.id);
        update gameplay.evolution_pity set failures = 0, updated_at = now() where user_id = p_user_id and from_template_id = v_template.id;
        perform gameplay.progress_task(p_user_id, 'evolution_success');
        if v_new_album then perform gameplay.progress_task(p_user_id, 'album_unlock'); end if;
      else
        perform inventory.change_holding(p_user_id, v_template.id, -2);
        update gameplay.evolution_pity set failures = failures + 1, updated_at = now() where user_id = p_user_id and from_template_id = v_template.id;
      end if;
      perform gameplay.progress_task(p_user_id, 'evolution_attempt');
      v_result := jsonb_build_object('success', v_success, 'material_template_id', v_template.id, 'target_template_id', v_target.id, 'materials_consumed', case when v_success then 3 else 2 end, 'fgems_consumed', v_price, 'pity_failures', case when v_success then 0 else v_failures + 1 end, 'new', v_new_album);

    elsif p_action = 'inventory.decompose' then
      select * into strict v_template from catalog.templates where id = p_input->>'template_id';
      v_quantity := (p_input->>'quantity')::bigint;
      if v_quantity <= 0 then raise exception 'QUANTITY_INVALID:数量无效'; end if;
      if inventory.available_quantity(p_user_id, v_template.id) < v_quantity then raise exception 'INSUFFICIENT_INVENTORY:可用藏品不足'; end if;
      perform inventory.change_holding(p_user_id, v_template.id, -v_quantity);
      v_reward := v_template.decompose_fgems * v_quantity;
      perform economy.change_balance(p_user_id, 'FGEMS', v_reward, 'decompose', v_operation.id, v_template.id);
      perform gameplay.progress_task(p_user_id, 'decompose');
      v_result := jsonb_build_object('template_id', v_template.id, 'quantity', v_quantity, 'fgems_received', v_reward);

    elsif p_action = 'market.create_listing' then
      select * into strict v_template from catalog.templates where id = p_input->>'template_id';
      v_quantity := (p_input->>'quantity')::bigint;
      if v_quantity <= 0 or inventory.available_quantity(p_user_id, v_template.id) < v_quantity then raise exception 'INSUFFICIENT_INVENTORY:可用藏品不足'; end if;
      select count(distinct template_id) into v_count from market.listings where seller_id = p_user_id and status = 'active';
      if v_count >= 50 and not exists (select 1 from market.listings where seller_id = p_user_id and template_id = v_template.id and status = 'active') then raise exception 'MARKET_TEMPLATE_LIMIT:在售模板已达五十种'; end if;
      insert into market.listings (seller_id, template_id, unit_price, quantity, remaining, operation_id)
      values (p_user_id, v_template.id, v_template.market_price, v_quantity, v_quantity, v_operation.id) returning id into v_reference_id;
      insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id) values (p_user_id, v_template.id, v_quantity, 'listing', v_reference_id);
      perform gameplay.progress_task(p_user_id, 'market_list');
      v_result := jsonb_build_object('template_id', v_template.id, 'quantity', v_quantity, 'unit_price', v_template.market_price);

    elsif p_action = 'market.cancel_listing' then
      v_kind := p_input->>'template_id';
      for v_listing in select * from market.listings where seller_id = p_user_id and template_id = v_kind and status = 'active' order by created_at, id for update loop
        update market.listings set status = 'cancelled', remaining = 0, updated_at = now() where id = v_listing.id;
        update inventory.reservations set status = 'released', released_at = now() where kind = 'listing' and reference_id = v_listing.id and status = 'active';
        v_total := coalesce(v_total, 0) + v_listing.remaining;
      end loop;
      if coalesce(v_total, 0) = 0 then raise exception 'LISTING_NOT_FOUND:没有可下架数量'; end if;
      v_result := jsonb_build_object('template_id', v_kind, 'cancelled_quantity', v_total);

    elsif p_action = 'market.buy' then
      select * into strict v_template from catalog.templates where id = p_input->>'template_id';
      v_quantity := (p_input->>'quantity')::bigint;
      if v_quantity <= 0 then raise exception 'QUANTITY_INVALID:购买数量无效'; end if;
      perform 1 from market.listings l join core.users u on u.id = l.seller_id where l.template_id = v_template.id and l.status = 'active' and l.remaining > 0 and l.seller_id <> p_user_id and u.status = 'normal' order by l.created_at, l.id for update of l;
      select coalesce(sum(l.remaining), 0) into v_available from market.listings l join core.users u on u.id = l.seller_id where l.template_id = v_template.id and l.status = 'active' and l.remaining > 0 and l.seller_id <> p_user_id and u.status = 'normal';
      if v_available < v_quantity then raise exception 'MARKET_INSUFFICIENT_QUANTITY:市场可买数量不足'; end if;
      v_total := v_template.market_price * v_quantity;
      perform economy.change_balance(p_user_id, 'KCOIN', -v_total, 'market_buy', v_operation.id, v_template.id);
      insert into market.trades (buyer_id, template_id, quantity, total_price, operation_id) values (p_user_id, v_template.id, v_quantity, v_total, v_operation.id) returning id into v_trade_id;
      v_available := v_quantity;
      for v_listing in select l.* from market.listings l join core.users u on u.id = l.seller_id where l.template_id = v_template.id and l.status = 'active' and l.remaining > 0 and l.seller_id <> p_user_id and u.status = 'normal' order by l.created_at, l.id loop
        exit when v_available = 0;
        v_take := least(v_available, v_listing.remaining);
        v_gross := v_take * v_listing.unit_price;
        v_fee := floor(v_gross * 5.0 / 100.0);
        v_rebate := 0;
        if exists (select 1 from economy.vip_subscriptions where user_id = v_listing.seller_id and core.utc_day() between starts_on and ends_on) then v_rebate := floor(v_fee * 20.0 / 100.0); end if;
        perform inventory.change_holding(v_listing.seller_id, v_template.id, -v_take);
        perform economy.change_balance(v_listing.seller_id, 'KCOIN', v_gross - v_fee, 'market_sale', v_operation.id, v_trade_id::text);
        if v_rebate > 0 then perform economy.change_balance(v_listing.seller_id, 'KCOIN', v_rebate, 'vip_market_rebate', v_operation.id, v_trade_id::text); end if;
        insert into market.trade_details (trade_id, listing_id, seller_id, quantity, gross, fee, seller_net, vip_rebate) values (v_trade_id, v_listing.id, v_listing.seller_id, v_take, v_gross, v_fee, v_gross - v_fee, v_rebate);
        if v_take = v_listing.remaining then
          update market.listings set remaining = 0, status = 'sold', updated_at = now() where id = v_listing.id;
          update inventory.reservations set status = 'consumed', released_at = now() where kind = 'listing' and reference_id = v_listing.id;
        else
          update market.listings set remaining = remaining - v_take, updated_at = now() where id = v_listing.id;
          update inventory.reservations set quantity = quantity - v_take where kind = 'listing' and reference_id = v_listing.id and status = 'active';
        end if;
        perform gameplay.progress_task(v_listing.seller_id, 'market_sold');
        v_available := v_available - v_take;
      end loop;
      perform inventory.change_holding(p_user_id, v_template.id, v_quantity);
      v_new_album := inventory.unlock_template(p_user_id, v_template.id, v_operation.id);
      perform gameplay.progress_task(p_user_id, 'market_buy');
      if v_new_album then perform gameplay.progress_task(p_user_id, 'album_unlock'); end if;
      v_result := jsonb_build_object('trade_id', v_trade_id, 'template_id', v_template.id, 'quantity', v_quantity, 'total_price', v_total, 'new', v_new_album);

    elsif p_action = 'album.claim_reward' then
      v_kind := p_input->>'chain_id';
      select case chain_type when 'normal' then 100 when 'advanced' then 300 else 800 end into v_reward from catalog.chains where id = v_kind;
      if v_reward is null then raise exception 'CHAIN_NOT_FOUND:进化链不存在'; end if;
      if (select count(*) from inventory.album_nodes n join catalog.templates t on t.id = n.template_id where n.user_id = p_user_id and t.chain_id = v_kind) <> 3 then raise exception 'ALBUM_CHAIN_INCOMPLETE:进化链尚未完成'; end if;
      insert into inventory.album_rewards (user_id, chain_id, operation_id) values (p_user_id, v_kind, v_operation.id);
      perform economy.change_balance(p_user_id, 'FGEMS', v_reward, 'album_reward', v_operation.id, v_kind);
      perform gameplay.progress_task(p_user_id, 'album_chain');
      v_result := jsonb_build_object('chain_id', v_kind, 'fgems_received', v_reward);

    elsif p_action = 'tasks.claim' then
      v_kind := p_input->>'task_code';
      select d.reward_fgems, d.target into v_reward, v_quantity from gameplay.task_definitions d where d.code = v_kind;
      if v_reward is null then raise exception 'TASK_NOT_FOUND:任务不存在'; end if;
      insert into gameplay.daily_task_progress (user_id, business_date, task_code) values (p_user_id, core.utc_day(), v_kind) on conflict do nothing;
      update gameplay.daily_task_progress set claimed_at = now(), claim_operation_id = v_operation.id, updated_at = now()
      where user_id = p_user_id and business_date = core.utc_day() and task_code = v_kind and claimed_at is null and progress >= v_quantity;
      if not found then raise exception 'TASK_NOT_CLAIMABLE:任务奖励不可领取'; end if;
      perform economy.change_balance(p_user_id, 'FGEMS', v_reward, 'task_reward', v_operation.id, v_kind);
      v_result := jsonb_build_object('task_code', v_kind, 'fgems_received', v_reward);

    elsif p_action = 'tasks.check_in' then
      insert into gameplay.checkins (user_id) values (p_user_id) on conflict do nothing;
      select current_day into v_count from gameplay.checkins where user_id = p_user_id for update;
      if exists (select 1 from gameplay.checkins where user_id = p_user_id and last_claim_date = core.utc_day()) then raise exception 'CHECKIN_ALREADY_CLAIMED:今日已签到'; end if;
      v_count := case when v_count = 7 then 1 else v_count + 1 end;
      update gameplay.checkins set current_day = v_count, last_claim_date = core.utc_day(), updated_at = now() where user_id = p_user_id;
      if v_count = 7 then
        insert into economy.entitlements (user_id, kind, source, operation_id) values (p_user_id, 'free_rare_box', 'checkin_day_7', v_operation.id);
        v_result := jsonb_build_object('day', v_count, 'reward_kind', 'free_rare_box', 'amount', 1);
      else
        v_reward := (array[20,30,50,80,100,150])[v_count];
        perform economy.change_balance(p_user_id, 'FGEMS', v_reward, 'checkin', v_operation.id, v_count::text);
        v_result := jsonb_build_object('day', v_count, 'reward_kind', 'FGEMS', 'amount', v_reward);
      end if;

    elsif p_action = 'tasks.bind_referral' then
      select * into v_session from core.sessions where id = (p_input->>'session_id')::uuid and user_id = p_user_id for update;
      if v_session.id is null or v_session.start_param is distinct from p_input->>'code' then raise exception 'REFERRAL_CANDIDATE_INVALID:邀请候选无效'; end if;
      if v_session.referral_processed_at is not null then
        v_result := jsonb_build_object('status', 'already_processed', 'bound', exists(select 1 from gameplay.referrals where invitee_id = p_user_id));
      elsif v_session.created_at < now() - interval '600 seconds' then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_BIND_WINDOW_EXPIRED', 'bound', false);
      elsif not v_session.new_user then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_OLD_USER', 'bound', false);
      elsif upper(p_input->>'code') !~ '^TMA[0-9A-F]{20}$' then
        v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_CODE_INVALID', 'bound', false);
      else
        select id into v_reference_id from core.users where referral_code = upper(p_input->>'code') and status = 'normal';
        if v_reference_id is null then
          v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_CODE_INVALID', 'bound', false);
        elsif v_reference_id = p_user_id then
          v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_SELF', 'bound', false);
        elsif exists (select 1 from economy.payments where user_id = p_user_id and status = 'delivered') then
          v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_RECHARGE_EXISTS', 'bound', false);
        elsif exists (select 1 from core.users where id = v_reference_id and invited_by is not null) or exists (select 1 from gameplay.referrals where inviter_id = p_user_id) then
          v_result := jsonb_build_object('status', 'rejected', 'reason', 'REFERRAL_MULTI_LEVEL', 'bound', false);
        else
          update core.users set invited_by = v_reference_id, updated_at = now() where id = p_user_id and invited_by is null;
          insert into gameplay.referrals (invitee_id, inviter_id) values (p_user_id, v_reference_id) on conflict do nothing;
          v_result := jsonb_build_object('status', 'bound', 'bound', true);
        end if;
      end if;
      update core.sessions set referral_processed_at = coalesce(referral_processed_at, now()) where id = v_session.id;

    elsif p_action = 'tasks.share_event' then
      v_kind := p_input->>'event';
      if v_kind = 'copy_link' then perform gameplay.progress_task(p_user_id, 'copy_referral');
      elsif v_kind = 'telegram_invite' then perform gameplay.progress_task(p_user_id, 'telegram_invite');
      else raise exception 'SHARE_EVENT_INVALID:分享事件无效'; end if;
      v_result := jsonb_build_object('recorded', true, 'event', v_kind);

    elsif p_action in ('topup.create_order', 'vip.create_order') then
      if p_action = 'vip.create_order' then
        v_price := 199;
        v_kind := 'vip';
      else
        v_price := (p_input->>'amount')::bigint;
        v_kind := 'kcoin_topup';
        if v_price <= 0 or (v_price not in (50, 500, 1000, 5000, 10000) and coalesce((p_input#>>'{intent,required_amount}')::bigint, -1) <> v_price) then raise exception 'TOPUP_AMOUNT_INVALID:充值金额无效'; end if;
      end if;
      v_reference_id := extensions.gen_random_uuid();
      v_invoice_payload := 'pokepets:' || v_reference_id;
      insert into economy.payments (user_id, operation_id, kind, stars_amount, kcoin_amount, invoice_payload, intent, expires_at)
      values (p_user_id, v_operation.id, v_kind, v_price, case when v_kind = 'kcoin_topup' then v_price else null end, v_invoice_payload, coalesce(p_input->'intent', '{}'::jsonb), now() + interval '15 minutes')
      returning id into v_reference_id;
      v_result := jsonb_build_object('payment_id', v_reference_id, 'kind', v_kind, 'stars_amount', v_price, 'invoice_payload', v_invoice_payload, 'expires_at', now() + interval '15 minutes');

    elsif p_action in ('vip.claim_daily', 'vip.claim_free_box') then
      if not exists (select 1 from economy.vip_subscriptions where user_id = p_user_id and core.utc_day() between starts_on and ends_on) then raise exception 'VIP_NOT_ACTIVE:月卡未生效'; end if;
      v_kind := case when p_action = 'vip.claim_daily' then 'fgems' else 'free_rare_box' end;
      insert into economy.vip_claims (user_id, benefit_date, benefit, operation_id) values (p_user_id, core.utc_day(), v_kind, v_operation.id);
      if v_kind = 'fgems' then
        perform economy.change_balance(p_user_id, 'FGEMS', 100, 'vip_daily', v_operation.id, core.utc_day()::text);
        v_result := jsonb_build_object('benefit', v_kind, 'amount', 100);
      else
        insert into economy.entitlements (user_id, kind, source, operation_id) values (p_user_id, 'free_rare_box', 'vip_daily', v_operation.id);
        v_result := jsonb_build_object('benefit', v_kind, 'amount', 1);
      end if;

    elsif p_action = 'expeditions.create' then
      v_kind := p_input->>'tier';
      select case v_kind when 'normal' then 2 else 1 end, case v_kind when 'normal' then interval '30 minutes' when 'intermediate' then interval '1 hour' else interval '3 hours' end into v_limit, v_duration;
      if v_limit is null then raise exception 'EXPEDITION_TIER_INVALID:远征档次无效'; end if;
      select count(*) into v_daily_count from gameplay.expeditions where user_id = p_user_id and tier = v_kind and (started_at at time zone 'utc')::date = core.utc_day();
      if v_daily_count >= v_limit then raise exception 'EXPEDITION_DAILY_LIMIT:今日远征次数已用完'; end if;
      if exists (select 1 from gameplay.expeditions where user_id = p_user_id and tier = v_kind and status in ('running', 'claimable')) then raise exception 'EXPEDITION_SLOT_OCCUPIED:请先领取同档远征'; end if;
      select coalesce(sum((x->>'quantity')::bigint), 0) into v_quantity from jsonb_array_elements(p_input->'items') x;
      if v_quantity <> 3 then raise exception 'EXPEDITION_ITEM_COUNT:每次必须派遣三个藏品单位'; end if;
      v_reward := 0;
      for v_item in select x->>'template_id' template_id, sum((x->>'quantity')::bigint) quantity from jsonb_array_elements(p_input->'items') x group by x->>'template_id' order by x->>'template_id' loop
        select * into strict v_template from catalog.templates where id = v_item.template_id;
        if (v_kind = 'normal' and catalog.rarity_rank(v_template.rarity) not between 1 and 3) or (v_kind = 'intermediate' and catalog.rarity_rank(v_template.rarity) not between 2 and 4) or (v_kind = 'advanced' and catalog.rarity_rank(v_template.rarity) not between 3 and 5) then raise exception 'EXPEDITION_RARITY_INVALID:藏品稀有度不符合远征要求'; end if;
        if inventory.available_quantity(p_user_id, v_template.id) < v_item.quantity then raise exception 'INSUFFICIENT_INVENTORY:远征可用藏品不足'; end if;
        v_reward := v_reward + v_template.expedition_fgems * v_item.quantity;
      end loop;
      insert into gameplay.expeditions (user_id, operation_id, tier, reward_fgems, completes_at) values (p_user_id, v_operation.id, v_kind, v_reward, now() + v_duration) returning * into v_expedition;
      for v_item in select x->>'template_id' template_id, sum((x->>'quantity')::bigint) quantity from jsonb_array_elements(p_input->'items') x group by x->>'template_id' order by x->>'template_id' loop
        insert into gameplay.expedition_items (expedition_id, template_id, quantity) values (v_expedition.id, v_item.template_id, v_item.quantity);
        insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id) values (p_user_id, v_item.template_id, v_item.quantity, 'expedition', v_expedition.id);
      end loop;
      v_result := jsonb_build_object('expedition_id', v_expedition.id, 'tier', v_kind, 'reward_fgems', v_reward, 'completes_at', v_expedition.completes_at);

    elsif p_action = 'expeditions.claim' then
      select * into strict v_expedition from gameplay.expeditions where id = (p_input->>'expedition_id')::uuid and user_id = p_user_id for update;
      if v_expedition.status = 'claimed' then raise exception 'EXPEDITION_ALREADY_CLAIMED:远征奖励已领取'; end if;
      if v_expedition.completes_at > now() then raise exception 'EXPEDITION_NOT_READY:远征尚未完成'; end if;
      update gameplay.expeditions set status = 'claimed', claimed_at = now() where id = v_expedition.id;
      update inventory.reservations set status = 'released', released_at = now() where kind = 'expedition' and reference_id = v_expedition.id and status = 'active';
      perform economy.change_balance(p_user_id, 'FGEMS', v_expedition.reward_fgems, 'expedition', v_operation.id, v_expedition.id::text);
      perform gameplay.progress_task(p_user_id, 'expedition_' || v_expedition.tier);
      v_result := jsonb_build_object('expedition_id', v_expedition.id, 'reward_fgems', v_expedition.reward_fgems);

    elsif p_action = 'wheel.spin' then
      v_count := (p_input->>'count')::integer;
      if v_count not in (1, 10) then raise exception 'WHEEL_COUNT_INVALID:转盘次数无效'; end if;
      insert into gameplay.wheel_daily (user_id, business_date) values (p_user_id, core.utc_day()) on conflict do nothing;
      select spin_count, normal_entitlements, rare_entitlements into v_progress, v_daily_count, v_limit from gameplay.wheel_daily where user_id = p_user_id and business_date = core.utc_day() for update;
      if v_progress + v_count > 20 then raise exception 'WHEEL_DAILY_LIMIT:今日转盘次数不足'; end if;
      v_price := case when v_count = 10 then 180 else 20 end;
      perform economy.change_balance(p_user_id, 'KCOIN', -v_price, 'wheel', v_operation.id, v_count::text);
      for v_i in 1..v_count loop
        v_random := core.random_basis_points();
        if v_random < 2400 then v_kind := 'FGEMS'; v_reward := 20;
        elsif v_random < 4100 then v_kind := 'FGEMS'; v_reward := 30;
        elsif v_random < 4800 then v_kind := 'FGEMS'; v_reward := 50;
        elsif v_random < 4950 then v_kind := 'FGEMS'; v_reward := 100;
        elsif v_random < 7050 then v_kind := 'KCOIN'; v_reward := 10;
        elsif v_random < 8250 then v_kind := 'KCOIN'; v_reward := 20;
        elsif v_random < 8950 then v_kind := 'KCOIN'; v_reward := 30;
        elsif v_random < 9350 then v_kind := 'KCOIN'; v_reward := 50;
        elsif v_random < 9550 then v_kind := 'KCOIN'; v_reward := 100;
        elsif v_random < 9980 then v_kind := 'free_normal_box'; v_reward := 1;
        else v_kind := 'free_rare_box'; v_reward := 1; end if;
        v_target_rarity := v_kind;
        v_triggered := false;
        if v_kind = 'free_normal_box' then
          if v_daily_count >= 3 then v_kind := 'FGEMS'; v_reward := 30; v_triggered := true; else v_daily_count := v_daily_count + 1; end if;
        elsif v_kind = 'free_rare_box' then
          if v_limit >= 1 then v_kind := 'FGEMS'; v_reward := 100; v_triggered := true; else v_limit := v_limit + 1; end if;
        end if;
        if v_kind in ('KCOIN', 'FGEMS') then perform economy.change_balance(p_user_id, v_kind, v_reward, 'wheel_reward', v_operation.id, v_i::text);
        else insert into economy.entitlements (user_id, kind, source, operation_id) values (p_user_id, v_kind, 'wheel', v_operation.id); end if;
        insert into gameplay.wheel_results (operation_id, sequence, rolled_kind, delivered_kind, amount, replaced) values (v_operation.id, v_i, v_target_rarity, v_kind, v_reward, v_triggered);
        v_results := v_results || jsonb_build_array(jsonb_build_object('sequence', v_i, 'rolled_kind', v_target_rarity, 'kind', v_kind, 'amount', v_reward, 'replaced', v_triggered));
      end loop;
      v_reward := 0;
      if v_progress < 10 and v_progress + v_count >= 10 then v_reward := v_reward + 25; end if;
      if v_progress < 20 and v_progress + v_count >= 20 then v_reward := v_reward + 25; end if;
      if v_reward > 0 then perform economy.change_balance(p_user_id, 'FGEMS', v_reward, 'wheel_milestone', v_operation.id, core.utc_day()::text); end if;
      update gameplay.wheel_daily set spin_count = v_progress + v_count, normal_entitlements = v_daily_count, rare_entitlements = v_limit, updated_at = now() where user_id = p_user_id and business_date = core.utc_day();
      perform gameplay.progress_task(p_user_id, 'wheel_spin');
      v_result := jsonb_build_object('count', v_count, 'cost', v_price, 'results', v_results, 'milestone_fgems', v_reward, 'spin_count', v_progress + v_count);

    elsif p_action = 'wallet.connect' then
      v_kind := upper(coalesce(p_input#>>'{account,chain}', p_input->>'chain', 'MAINNET'));
      v_result := jsonb_strip_nulls(jsonb_build_object(
        'connected', true, 'verified', false, 'status', 'connected_unverified',
        'address', coalesce(p_input#>>'{account,address}', p_input->>'address'),
        'chain', case when v_kind in ('TESTNET', '-3') then 'TESTNET' else 'MAINNET' end,
        'network', case when v_kind in ('TESTNET', '-3') then 'testnet' else 'mainnet' end,
        'walletAppName', coalesce(p_input->>'wallet_app_name', p_input->>'walletAppName'),
        'connectedAt', now(), 'serverTime', now()
      ));

    elsif p_action = 'wallet.disconnect' then
      if exists (select 1 from onchain.mints where user_id = p_user_id and status in ('reserved', 'submitted', 'unknown')) then raise exception 'MINT_IN_PROGRESS:上链处理中不能断开钱包'; end if;
      update onchain.wallets set status = 'disconnected', disconnected_at = now(), updated_at = now() where user_id = p_user_id and status = 'verified';
      v_result := api.query('wallet.status', p_user_id, '{}'::jsonb);

    elsif p_action = 'wallet.mint' then
      select * into strict v_template from catalog.templates where id = p_input->>'template_id';
      select * into strict v_wallet from onchain.wallets where user_id = p_user_id and status = 'verified' for share;
      if inventory.available_quantity(p_user_id, v_template.id) < 1 then raise exception 'INSUFFICIENT_INVENTORY:没有可上链藏品'; end if;
      insert into onchain.mints (user_id, wallet_id, template_id, operation_id, permit_expires_at) values (p_user_id, v_wallet.id, v_template.id, v_operation.id, now() + interval '10 minutes') returning id into v_reference_id;
      insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id) values (p_user_id, v_template.id, 1, 'mint', v_reference_id);
      select jsonb_build_object('mint_id', m.id, 'nft_number', m.nft_number, 'nonce', m.nonce, 'receiver', v_wallet.address, 'template_id', m.template_id, 'expires_at', m.permit_expires_at) into v_result from onchain.mints m where m.id = v_reference_id;

    else
      raise exception 'API_ROUTE_NOT_FOUND:接口不存在';
    end if;

    update core.operations
    set status = case when p_action in ('topup.create_order', 'vip.create_order', 'wallet.mint') then 'pending' else 'succeeded' end,
        result = v_result,
        updated_at = now()
    where id = v_operation.id;
  exception when others then
    v_error := sqlerrm;
    update core.operations set status = 'failed', error_code = split_part(v_error, ':', 1), result = jsonb_build_object('message', case when position(':' in v_error) > 0 then substring(v_error from position(':' in v_error) + 1) else '操作失败' end), updated_at = now() where id = v_operation.id;
  end;

  select * into v_operation from core.operations where id = v_operation.id;
  return jsonb_build_object('operation_id', v_operation.id, 'status', v_operation.status, 'result', v_operation.result, 'error_code', v_operation.error_code);
end;
$$;

create or replace function gameplay.process_first_recharge(p_user_id uuid, p_operation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referral gameplay.referrals%rowtype;
  v_daily integer;
  v_lifetime integer;
  v_valid integer;
begin
  select * into v_referral from gameplay.referrals where invitee_id = p_user_id for update;
  if v_referral.invitee_id is null or v_referral.first_recharge_at is not null then return; end if;
  update gameplay.referrals set first_recharge_at = now() where invitee_id = p_user_id;
  select count(*) into v_daily from gameplay.referrals where inviter_id = v_referral.inviter_id and first_recharge_at::date = core.utc_day() and reward_fgems = 500;
  select count(*) into v_lifetime from gameplay.referrals where inviter_id = v_referral.inviter_id and reward_fgems = 500;
  if exists (select 1 from core.users where id = v_referral.inviter_id and status = 'normal') and v_daily < 20 and v_lifetime < 300 then
    perform economy.change_balance(v_referral.inviter_id, 'FGEMS', 500, 'referral_first_recharge', p_operation_id, p_user_id::text);
    update gameplay.referrals set reward_fgems = 500, reward_operation_id = p_operation_id where invitee_id = p_user_id;
  end if;
  select count(*) into v_valid from gameplay.referrals where inviter_id = v_referral.inviter_id and first_recharge_at is not null;
  if v_valid >= 5 then
    insert into gameplay.referral_milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 5, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_normal_box', 'referral_5', p_operation_id); end if;
  end if;
  if v_valid >= 10 then
    insert into gameplay.referral_milestones (user_id, threshold, operation_id) values (v_referral.inviter_id, 10, p_operation_id) on conflict do nothing;
    if found then insert into economy.entitlements (user_id, kind, source, operation_id) values (v_referral.inviter_id, 'free_rare_box', 'referral_10', p_operation_id); end if;
  end if;
end;
$$;

create or replace function economy.deliver_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment economy.payments%rowtype;
  v_user core.users%rowtype;
  v_vip economy.vip_subscriptions%rowtype;
begin
  select * into strict v_payment from economy.payments where id = p_payment_id for update;
  if v_payment.status = 'delivered' then return jsonb_build_object('payment_id', v_payment.id, 'status', 'delivered', 'duplicate', true); end if;
  if v_payment.refund_status <> 'none' then
    update economy.payments set status = 'cancelled', updated_at = now() where id = v_payment.id;
    update core.operations set status = 'failed', error_code = 'PAYMENT_REFUNDED_BEFORE_DELIVERY', result = jsonb_build_object('payment_id', v_payment.id, 'status', 'cancelled', 'refund_status', v_payment.refund_status), updated_at = now() where id = v_payment.operation_id;
    return jsonb_build_object('payment_id', v_payment.id, 'status', 'cancelled', 'refund_status', v_payment.refund_status);
  end if;
  if v_payment.status <> 'paid' then raise exception 'PAYMENT_NOT_DELIVERABLE:支付订单尚不可交付'; end if;
  select * into strict v_user from core.users where id = v_payment.user_id for update;
  if v_user.status <> 'normal' then
    update economy.payments set status = 'delivery_blocked', updated_at = now() where id = v_payment.id;
    update core.operations set status = 'failed', error_code = 'PAYMENT_DELIVERY_BLOCKED', result = jsonb_build_object('payment_id', v_payment.id, 'status', 'delivery_blocked'), updated_at = now() where id = v_payment.operation_id;
    return jsonb_build_object('payment_id', v_payment.id, 'status', 'delivery_blocked');
  end if;
  if v_payment.kind = 'kcoin_topup' then
    perform economy.change_balance(v_payment.user_id, 'KCOIN', v_payment.kcoin_amount, 'stars_topup', v_payment.operation_id, v_payment.id::text);
  else
    select * into v_vip from economy.vip_subscriptions where user_id = v_payment.user_id for update;
    if v_vip.user_id is null or v_vip.ends_on < core.utc_day() then
      insert into economy.vip_subscriptions (user_id, starts_on, ends_on, renewal_count)
      values (v_payment.user_id, core.utc_day(), core.utc_day() + 29, 0)
      on conflict (user_id) do update set period_id = extensions.gen_random_uuid(), starts_on = excluded.starts_on, ends_on = excluded.ends_on, renewal_count = 0, updated_at = now();
    elsif v_vip.renewal_count < 2 then
      update economy.vip_subscriptions set ends_on = ends_on + 30, renewal_count = renewal_count + 1, updated_at = now() where user_id = v_payment.user_id;
    else
      update economy.payments set status = 'delivery_blocked', updated_at = now() where id = v_payment.id;
      update core.operations set status = 'failed', error_code = 'VIP_RENEWAL_LIMIT', result = jsonb_build_object('payment_id', v_payment.id, 'status', 'delivery_blocked'), updated_at = now() where id = v_payment.operation_id;
      return jsonb_build_object('payment_id', v_payment.id, 'status', 'delivery_blocked');
    end if;
  end if;
  update economy.payments set status = 'delivered', delivered_at = now(), updated_at = now() where id = v_payment.id;
  update core.operations set status = 'succeeded', error_code = null, result = jsonb_build_object('payment_id', v_payment.id, 'status', 'delivered', 'kind', v_payment.kind), updated_at = now() where id = v_payment.operation_id;
  perform gameplay.process_first_recharge(v_payment.user_id, v_payment.operation_id);
  return jsonb_build_object('payment_id', v_payment.id, 'status', 'delivered', 'kind', v_payment.kind);
end;
$$;

create or replace function api.apply_successful_payment(
  p_event_id text,
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
declare
  v_payment economy.payments%rowtype;
  v_delivery jsonb;
begin
  insert into ops.webhook_events (provider, event_id, payload) values ('telegram', p_event_id, p_payload)
  on conflict (provider, event_id) do nothing;
  if not found then
    return jsonb_build_object('duplicate', true);
  end if;
  select * into v_payment from economy.payments where invoice_payload = p_invoice_payload for update;
  if v_payment.id is null or v_payment.stars_amount <> p_stars then raise exception 'PAYMENT_MISMATCH:支付订单不匹配'; end if;
  if v_payment.status = 'delivered' then return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id, 'status', v_payment.status); end if;
  update economy.payments set status = 'paid', telegram_payment_charge_id = p_telegram_charge_id, provider_payment_charge_id = p_provider_charge_id, paid_at = now(), updated_at = now() where id = v_payment.id;
  begin
    v_delivery := economy.deliver_payment(v_payment.id);
  exception when others then
    v_delivery := jsonb_build_object('payment_id', v_payment.id, 'status', 'paid', 'delivery_pending', true);
  end;
  update ops.webhook_events set processed_at = now() where provider = 'telegram' and event_id = p_event_id;
  return v_delivery;
end;
$$;

create or replace function api.validate_payment(p_invoice_payload text, p_stars bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('valid', p.status = 'pending' and p.expires_at > now() and p.stars_amount = p_stars and u.status = 'normal', 'payment_id', p.id)
  from economy.payments p join core.users u on u.id = p.user_id
  where p.invoice_payload = p_invoice_payload
$$;

create or replace function api.apply_refund(
  p_event_id text,
  p_telegram_charge_id text,
  p_stars bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment economy.payments%rowtype; v_total bigint; v_refunded bigint;
begin
  select * into strict v_payment from economy.payments where telegram_payment_charge_id = p_telegram_charge_id for update;
  insert into ops.refunds (payment_id, provider_event_id, stars) values (v_payment.id, p_event_id, p_stars) on conflict (provider_event_id) do nothing;
  if not found then return jsonb_build_object('duplicate', true); end if;
  v_refunded := v_payment.refunded_stars + p_stars;
  update economy.payments
  set refunded_stars = v_refunded,
      refund_status = case when v_refunded >= stars_amount then 'full' else 'partial' end,
      status = case when status in ('pending', 'paid') then 'cancelled' else status end,
      updated_at = now()
  where id = v_payment.id;
  update core.users set total_refund_stars = total_refund_stars + p_stars, updated_at = now() where id = v_payment.user_id returning total_refund_stars into v_total;
  if v_total > 100 then
    update core.users set status = 'banned', updated_at = now() where id = v_payment.user_id;
    update core.sessions set revoked_at = now() where user_id = v_payment.user_id and revoked_at is null;
  end if;
  insert into ops.webhook_events (provider, event_id, payload, processed_at) values ('telegram_refund', p_event_id, p_payload, now()) on conflict do nothing;
  return jsonb_build_object('payment_id', v_payment.id, 'total_refund_stars', v_total, 'account_status', case when v_total > 100 then 'banned' else 'normal' end);
end;
$$;

create or replace function api.mark_mint_submitted(p_user_id uuid, p_mint_id uuid, p_transaction_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype;
begin
  select * into strict v_mint from onchain.mints where id = p_mint_id and user_id = p_user_id for update;
  if v_mint.status in ('submitted', 'unknown', 'succeeded') and v_mint.transaction_hash = p_transaction_hash then
    return jsonb_build_object('mint_id', v_mint.id, 'operation_id', v_mint.operation_id, 'status', v_mint.status, 'transaction_hash', v_mint.transaction_hash);
  end if;
  if v_mint.status <> 'reserved' or v_mint.permit_expires_at <= now() then raise exception 'MINT_NOT_SUBMITTABLE:Mint 已不可提交'; end if;
  update onchain.mints set status = 'submitted', transaction_hash = p_transaction_hash, submitted_at = now(), updated_at = now() where id = p_mint_id;
  update core.operations set status = 'pending', result = coalesce(result, '{}'::jsonb) || jsonb_build_object('mint_id', p_mint_id, 'status', 'submitted', 'transaction_hash', p_transaction_hash), updated_at = now() where id = v_mint.operation_id;
  return jsonb_build_object('mint_id', p_mint_id, 'operation_id', v_mint.operation_id, 'status', 'submitted', 'transaction_hash', p_transaction_hash);
end;
$$;

create or replace function api.complete_mint(
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
declare v_mint onchain.mints%rowtype; v_checksum text;
begin
  select * into strict v_mint from onchain.mints where id = p_mint_id for update;
  if v_mint.status in ('succeeded', 'failed', 'cancelled') then return jsonb_build_object('mint_id', v_mint.id, 'status', v_mint.status); end if;
  if p_success then
    if p_nft_address is null or p_metadata_uri is null or p_metadata is null then raise exception 'MINT_RESULT_INCOMPLETE:Mint 成功资料不完整'; end if;
    perform inventory.change_holding(v_mint.user_id, v_mint.template_id, -1);
    update inventory.reservations set status = 'consumed', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    update onchain.mints set status = 'succeeded', nft_address = p_nft_address, metadata_uri = p_metadata_uri, completed_at = now(), updated_at = now() where id = v_mint.id;
    v_checksum := encode(extensions.digest(convert_to(p_metadata::text, 'UTF8'), 'sha256'), 'hex');
    insert into onchain.nft_metadata (nft_number, mint_id, snapshot, checksum) values (v_mint.nft_number, v_mint.id, p_metadata, v_checksum);
    perform gameplay.progress_task(v_mint.user_id, 'mint_success');
  else
    update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
    update onchain.mints set status = 'failed', completed_at = now(), updated_at = now() where id = v_mint.id;
  end if;
  update core.operations set status = case when p_success then 'succeeded' else 'failed' end, result = jsonb_build_object('mint_id', v_mint.id, 'status', case when p_success then 'succeeded' else 'failed' end, 'nft_address', p_nft_address, 'metadata_uri', p_metadata_uri), error_code = case when p_success then null else 'MINT_FAILED' end, updated_at = now() where id = v_mint.operation_id;
  return jsonb_build_object('mint_id', v_mint.id, 'status', case when p_success then 'succeeded' else 'failed' end, 'nft_address', p_nft_address, 'metadata_uri', p_metadata_uri);
end;
$$;

create or replace function api.cancel_mint(p_user_id uuid, p_mint_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_mint onchain.mints%rowtype;
begin
  select * into strict v_mint from onchain.mints where id = p_mint_id and user_id = p_user_id for update;
  if v_mint.status = 'cancelled' then return jsonb_build_object('mint_id', v_mint.id, 'operation_id', v_mint.operation_id, 'status', v_mint.status); end if;
  if v_mint.status <> 'reserved' then raise exception 'MINT_ALREADY_SUBMITTED:Mint 已提交链上，不能取消'; end if;
  update onchain.mints set status = 'cancelled', completed_at = now(), updated_at = now() where id = v_mint.id;
  update inventory.reservations set status = 'released', released_at = now() where kind = 'mint' and reference_id = v_mint.id and status = 'active';
  update core.operations set status = 'failed', error_code = 'MINT_CANCELLED', result = jsonb_build_object('mint_id', v_mint.id, 'status', 'cancelled'), updated_at = now() where id = v_mint.operation_id;
  return jsonb_build_object('mint_id', v_mint.id, 'operation_id', v_mint.operation_id, 'status', 'cancelled');
end;
$$;

create or replace function api.list_mint_reconciliation_candidates(p_limit integer default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.submitted_at), '[]'::jsonb)
  from (
    select m.id mint_id, m.operation_id, m.nft_number, m.template_id, m.transaction_hash, m.submitted_at,
           w.address receiver, t.name, t.rarity, t.stage, t.combat_power, t.image_path
    from onchain.mints m
    join onchain.wallets w on w.id = m.wallet_id
    join catalog.templates t on t.id = m.template_id
    where m.status in ('submitted', 'unknown')
    order by m.submitted_at
    limit greatest(1, least(p_limit, 500))
  ) c
$$;

create or replace function api.run_job(p_job_name text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_run uuid; v_count integer := 0; v_added integer := 0; v_row record;
begin
  insert into ops.job_runs (job_name, status) values (p_job_name, 'running') returning id into v_run;
  if p_job_name = 'reconcile-payments' then
    with expired as (
      update economy.payments set status = 'expired', updated_at = now()
      where id in (select id from economy.payments where status = 'pending' and expires_at <= now() order by expires_at limit p_limit for update skip locked)
      returning operation_id, id
    )
    update core.operations o set status = 'failed', error_code = 'PAYMENT_EXPIRED', result = jsonb_build_object('payment_id', e.id, 'status', 'expired'), updated_at = now()
    from expired e where o.id = e.operation_id;
    get diagnostics v_count = row_count;
    for v_row in select id from economy.payments where status = 'paid' order by paid_at limit p_limit for update skip locked loop
      begin
        perform economy.deliver_payment(v_row.id);
        v_count := v_count + 1;
      exception when others then
        null;
      end;
    end loop;
  elsif p_job_name = 'reconcile-mints' then
    for v_row in select id from onchain.mints where status = 'reserved' and permit_expires_at <= now() order by permit_expires_at limit p_limit for update skip locked loop
      perform api.complete_mint(v_row.id, false);
      v_count := v_count + 1;
    end loop;
  elsif p_job_name = 'cleanup-idempotency' then
    delete from core.operations where id in (select id from core.operations where created_at < now() - interval '90 days' and status in ('succeeded', 'failed') order by created_at limit p_limit) and not exists (select 1 from economy.payments p where p.operation_id = core.operations.id and p.status in ('pending', 'paid')) and not exists (select 1 from onchain.mints m where m.operation_id = core.operations.id and m.status in ('reserved', 'submitted', 'unknown'));
    get diagnostics v_count = row_count;
    delete from ops.auth_attempts where attempted_at < now() - interval '1 day';
  elsif p_job_name = 'monitor-invariants' then
    insert into ops.invariant_violations (code, subject, details)
    select 'NEGATIVE_BALANCE', b.user_id::text || ':' || b.currency, jsonb_build_object('available', b.available, 'locked', b.locked)
    from economy.balances b where b.available < 0 or b.locked < 0
    on conflict do nothing;
    get diagnostics v_count = row_count;
    insert into ops.invariant_violations (code, subject, details)
    select 'NEGATIVE_INVENTORY', h.user_id::text || ':' || h.template_id, jsonb_build_object('quantity', h.quantity)
    from inventory.holdings h where h.quantity < 0
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
    insert into ops.invariant_violations (code, subject, details)
    select 'BALANCE_LEDGER_MISMATCH', b.user_id::text || ':' || b.currency, jsonb_build_object('balance', b.available, 'ledger', coalesce(sum(l.amount), 0))
    from economy.balances b left join economy.ledger l on l.user_id = b.user_id and l.currency = b.currency
    group by b.user_id, b.currency, b.available having b.available <> coalesce(sum(l.amount), 0)
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
    insert into ops.invariant_violations (code, subject, details)
    select 'DUPLICATE_PAYMENT_DELIVERY', l.reference, jsonb_build_object('ledger_entries', count(*))
    from economy.ledger l where l.reason = 'stars_topup'
    group by l.reference having count(*) > 1
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
    insert into ops.invariant_violations (code, subject, details)
    select 'RESERVATION_OVERFLOW', h.user_id::text || ':' || h.template_id, jsonb_build_object('holding', h.quantity, 'reserved', sum(r.quantity))
    from inventory.holdings h join inventory.reservations r on r.user_id = h.user_id and r.template_id = h.template_id and r.status = 'active'
    group by h.user_id, h.template_id, h.quantity having sum(r.quantity) > h.quantity
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
    insert into ops.invariant_violations (code, subject, details)
    select 'ILLEGAL_RESERVATION', r.id::text, jsonb_build_object('kind', r.kind, 'reference_id', r.reference_id)
    from inventory.reservations r
    where r.status = 'active' and (
      (r.kind = 'listing' and not exists (select 1 from market.listings l where l.id = r.reference_id and l.status = 'active' and l.remaining > 0))
      or (r.kind = 'expedition' and not exists (select 1 from gameplay.expeditions e where e.id = r.reference_id and e.status in ('running', 'claimable')))
      or (r.kind = 'mint' and not exists (select 1 from onchain.mints m where m.id = r.reference_id and m.status in ('reserved', 'submitted', 'unknown')))
    )
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
    insert into ops.invariant_violations (code, subject, details)
    select 'OPEN_OPERATION_WITHOUT_SUBJECT', o.id::text, jsonb_build_object('route', o.route, 'status', o.status)
    from core.operations o
    where o.status in ('pending', 'unknown') and o.created_at < now() - interval '1 day'
      and not exists (select 1 from economy.payments p where p.operation_id = o.id and p.status in ('pending', 'paid'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  else
    raise exception 'JOB_NOT_FOUND:后台任务不存在';
  end if;
  update ops.job_runs set status = 'succeeded', processed_count = v_count, finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'processed_count', v_count);
exception when others then
  if v_run is not null then update ops.job_runs set status = 'failed', details = jsonb_build_object('error', sqlerrm), finished_at = now() where id = v_run; end if;
  raise;
end;
$$;
