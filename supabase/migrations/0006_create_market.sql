-- 0006_create_market.sql
-- Marketplace: listings, listing items, orders, price snapshots, market depth and fee settlements.

create table if not exists market.listings (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references core.users(id) on delete cascade,
  template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  form_id uuid references catalog.collectible_forms(id) on delete restrict,
  rarity_code text not null references catalog.rarities(code),
  status text not null default 'active' check (status in ('active', 'sold', 'partially_sold', 'cancelled', 'expired', 'suspended')),
  item_count integer not null check (item_count > 0),
  remaining_count integer not null check (remaining_count >= 0),
  unit_price_kcoin numeric(38,0) not null check (unit_price_kcoin > 0),
  fee_bps integer not null default 500 check (fee_bps >= 0 and fee_bps <= 10000),
  expected_net_amount numeric(38,0) not null default 0 check (expected_net_amount >= 0),
  price_health text check (price_health in ('too_low', 'healthy', 'too_high', 'unknown')),
  expires_at timestamptz,
  last_price_changed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_count <= item_count)
);

comment on table market.listings is 'Marketplace sell orders. Each listing locks one or more concrete inventory.item_instances.';

create table if not exists market.listing_items (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references market.listings(id) on delete cascade,
  item_instance_id uuid not null references inventory.item_instances(id) on delete restrict,
  status text not null default 'reserved' check (status in ('reserved', 'sold', 'cancelled', 'expired')),
  buyer_user_id uuid references core.users(id) on delete set null,
  sold_order_id uuid,
  sold_at timestamptz,
  created_at timestamptz not null default now(),
  unique (listing_id, item_instance_id)
);

create table if not exists market.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null references core.users(id) on delete cascade,
  seller_user_id uuid not null references core.users(id) on delete cascade,
  listing_id uuid not null references market.listings(id) on delete restrict,
  status text not null default 'completed' check (status in ('pending', 'completed', 'cancelled', 'failed', 'refunded')),
  item_count integer not null check (item_count > 0),
  unit_price_kcoin numeric(38,0) not null check (unit_price_kcoin > 0),
  total_price_kcoin numeric(38,0) not null check (total_price_kcoin > 0),
  fee_bps integer not null default 500 check (fee_bps >= 0 and fee_bps <= 10000),
  fee_amount_kcoin numeric(38,0) not null default 0 check (fee_amount_kcoin >= 0),
  seller_net_amount_kcoin numeric(38,0) not null default 0 check (seller_net_amount_kcoin >= 0),
  buyer_ledger_id uuid references economy.currency_ledger(id) on delete set null,
  seller_ledger_id uuid references economy.currency_ledger(id) on delete set null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table market.orders is 'Completed marketplace purchases. The K-coin transfer and item ownership transfer occur in one transaction.';

create table if not exists market.order_items (
  order_id uuid not null references market.orders(id) on delete cascade,
  listing_item_id uuid not null references market.listing_items(id) on delete restrict,
  item_instance_id uuid not null references inventory.item_instances(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (order_id, item_instance_id)
);

create table if not exists market.listing_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references market.listings(id) on delete cascade,
  user_id uuid references core.users(id) on delete set null,
  event_type text not null check (event_type in ('created', 'price_changed', 'partially_sold', 'sold', 'cancelled', 'expired', 'suspended', 'resumed')),
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists market.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  form_id uuid references catalog.collectible_forms(id) on delete cascade,
  rarity_code text references catalog.rarities(code),
  floor_price_kcoin numeric(38,0),
  avg_price_kcoin numeric(38,0),
  last_sale_price_kcoin numeric(38,0),
  active_listing_count integer not null default 0,
  sale_count_24h integer not null default 0,
  volume_24h_kcoin numeric(38,0) not null default 0,
  snapshot_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists market.depth_snapshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  form_id uuid references catalog.collectible_forms(id) on delete cascade,
  price_bucket_kcoin numeric(38,0) not null,
  listing_count integer not null default 0,
  item_count integer not null default 0,
  snapshot_at timestamptz not null default now()
);

create table if not exists market.price_health_rules (
  id uuid primary key default gen_random_uuid(),
  rarity_code text references catalog.rarities(code),
  template_id uuid references catalog.collectible_templates(id) on delete cascade,
  min_ratio_to_floor numeric(10,4) not null default 0.5000,
  max_ratio_to_floor numeric(10,4) not null default 2.0000,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_ratio_to_floor >= 0),
  check (max_ratio_to_floor >= min_ratio_to_floor)
);

create table if not exists market.fee_settlements (
  id uuid primary key default gen_random_uuid(),
  market_order_id uuid not null references market.orders(id) on delete cascade,
  currency_code text not null references economy.currencies(code),
  fee_amount numeric(38,0) not null check (fee_amount >= 0),
  fee_bps integer not null default 0,
  status text not null default 'settled' check (status in ('pending', 'settled', 'reversed')),
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
