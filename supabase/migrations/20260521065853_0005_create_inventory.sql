-- 0005_create_inventory.sql
-- User-owned collectible instances, locks, upgrade, evolution and decomposition records.

create table if not exists inventory.item_instances (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references core.users(id) on delete set null,
  template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  form_id uuid references catalog.collectible_forms(id) on delete restrict,
  serial_no bigint generated always as identity unique,
  level integer not null default 1 check (level > 0),
  exp integer not null default 0 check (exp >= 0),
  power integer not null default 0 check (power >= 0),
  status text not null default 'available' check (status in ('available', 'locked', 'listed', 'consumed', 'decomposed', 'minting', 'minted', 'transferred', 'burned')),
  source_type text not null default 'unknown' check (source_type in ('gacha', 'market', 'evolution', 'admin', 'onchain_sync', 'airdrop', 'unknown')),
  source_id uuid,
  nft_mint_status text not null default 'not_minted' check (nft_mint_status in ('not_minted', 'queued', 'minting', 'minted', 'failed')),
  minted_nft_item_id uuid,
  lock_version integer not null default 0,
  acquired_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table inventory.item_instances is 'Every user-owned collectible copy. This instance-level model supports trading, upgrades, NFT minting and serial numbers.';

create table if not exists inventory.inventory_locks (
  id uuid primary key default gen_random_uuid(),
  item_instance_id uuid not null references inventory.item_instances(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  lock_type text not null check (lock_type in ('market_listing', 'evolution', 'decompose', 'mint', 'admin_hold')),
  source_type text not null,
  source_id uuid,
  status text not null default 'active' check (status in ('active', 'released', 'consumed', 'expired')),
  locked_at timestamptz not null default now(),
  expires_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table inventory.inventory_locks is 'Prevents the same collectible instance from being sold, decomposed, evolved or minted at the same time.';

create table if not exists inventory.item_instance_events (
  id uuid primary key default gen_random_uuid(),
  item_instance_id uuid not null references inventory.item_instances(id) on delete cascade,
  user_id uuid references core.users(id) on delete set null,
  event_type text not null check (event_type in ('created', 'acquired', 'upgraded', 'evolved_success', 'evolved_failed_returned', 'consumed', 'decomposed', 'listed', 'delisted', 'sold', 'bought', 'mint_queued', 'minted', 'transferred', 'admin_adjusted')),
  source_type text,
  source_id uuid,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists inventory.upgrade_rules (
  id uuid primary key default gen_random_uuid(),
  rarity_code text not null references catalog.rarities(code),
  form_index integer not null default 1,
  from_level integer not null check (from_level > 0),
  to_level integer not null check (to_level > from_level),
  cost_fgems numeric(38,0) not null check (cost_fgems >= 0),
  power_gain integer not null default 1 check (power_gain >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rarity_code, form_index, from_level, to_level, active)
);

comment on table inventory.upgrade_rules is 'Upgrade rules. Upgrade always succeeds and consumes FGEMS.';

create table if not exists inventory.upgrade_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  item_instance_id uuid not null references inventory.item_instances(id) on delete cascade,
  rule_id uuid references inventory.upgrade_rules(id) on delete set null,
  from_level integer not null,
  to_level integer not null,
  from_power integer not null,
  to_power integer not null,
  cost_fgems numeric(38,0) not null default 0,
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists inventory.evolution_rules (
  id uuid primary key default gen_random_uuid(),
  from_template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  from_form_id uuid not null references catalog.collectible_forms(id) on delete cascade,
  to_template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  to_form_id uuid not null references catalog.collectible_forms(id) on delete cascade,
  required_count integer not null default 3 check (required_count > 1),
  cost_kcoin numeric(38,0) not null default 0 check (cost_kcoin >= 0),
  success_rate_bps integer not null default 10000 check (success_rate_bps >= 0 and success_rate_bps <= 10000),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table inventory.evolution_rules is 'Evolution rules. Consumes three same collectibles plus K-coin; failure returns the highest-level main item only.';

create table if not exists inventory.evolution_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  rule_id uuid references inventory.evolution_rules(id) on delete set null,
  main_item_instance_id uuid references inventory.item_instances(id) on delete set null,
  result_item_instance_id uuid references inventory.item_instances(id) on delete set null,
  status text not null check (status in ('success', 'failed')),
  cost_kcoin numeric(38,0) not null default 0,
  success_rate_bps integer not null,
  random_roll_bps integer not null,
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists inventory.evolution_consumed_items (
  attempt_id uuid not null references inventory.evolution_attempts(id) on delete cascade,
  item_instance_id uuid not null references inventory.item_instances(id) on delete restrict,
  role text not null check (role in ('main', 'material')),
  consumed boolean not null default true,
  returned boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (attempt_id, item_instance_id)
);

create table if not exists inventory.decompose_rules (
  id uuid primary key default gen_random_uuid(),
  rarity_code text not null references catalog.rarities(code),
  form_index integer not null default 1,
  min_level integer not null default 1 check (min_level > 0),
  reward_fgems numeric(38,0) not null check (reward_fgems >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rarity_code, form_index, min_level, active)
);

comment on table inventory.decompose_rules is 'Decomposition rules. Duplicate collectibles can be decomposed into FGEMS.';

create table if not exists inventory.decompose_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  item_instance_id uuid not null references inventory.item_instances(id) on delete restrict,
  rule_id uuid references inventory.decompose_rules(id) on delete set null,
  reward_fgems numeric(38,0) not null,
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  created_at timestamptz not null default now()
);
