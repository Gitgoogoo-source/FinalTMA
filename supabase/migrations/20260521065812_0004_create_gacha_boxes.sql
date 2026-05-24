-- 0004_create_gacha_boxes.sql
-- Blind boxes, price rules, drop pool versions, pity rules, draw orders and results.

create table if not exists gacha.blind_boxes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  description text,
  tier text not null check (tier in ('normal', 'rare', 'legendary', 'event')),
  status text not null default 'draft' check (status in ('draft', 'not_started', 'active', 'paused', 'ended', 'sold_out', 'hidden')),
  price_stars integer not null check (price_stars > 0),
  total_stock integer check (total_stock is null or total_stock >= 0),
  remaining_stock integer check (remaining_stock is null or remaining_stock >= 0),
  open_reward_kcoin numeric(38,0) not null default 100 check (open_reward_kcoin >= 0),
  cover_image_url text,
  hero_image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remaining_stock is null or total_stock is null or remaining_stock <= total_stock)
);

comment on table gacha.blind_boxes is 'Configurable blind box tiers. Availability is controlled by status, time window and stock.';

create table if not exists gacha.box_price_rules (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references gacha.blind_boxes(id) on delete cascade,
  quantity integer not null check (quantity in (1, 10)),
  discount_bps integer not null default 0 check (discount_bps >= 0 and discount_bps <= 10000),
  price_stars_override integer check (price_stars_override is null or price_stars_override > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (box_id, quantity, active)
);

comment on table gacha.box_price_rules is 'Open price rules. Ten draws can use discount_bps=1000 for 9折.';

create table if not exists gacha.drop_pool_versions (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references gacha.blind_boxes(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  total_weight numeric(38,8) not null default 0 check (total_weight >= 0),
  published_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  config_snapshot jsonb not null default '{}'::jsonb,
  created_by_admin_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (box_id, version_no)
);

comment on table gacha.drop_pool_versions is 'Versioned drop pools. Never overwrite active historical probability data; publish a new version instead.';

create table if not exists gacha.drop_pool_items (
  id uuid primary key default gen_random_uuid(),
  pool_version_id uuid not null references gacha.drop_pool_versions(id) on delete cascade,
  template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  form_id uuid references catalog.collectible_forms(id) on delete restrict,
  rarity_code text not null references catalog.rarities(code),
  drop_weight numeric(38,8) not null check (drop_weight > 0),
  probability_bps integer check (probability_bps is null or (probability_bps >= 0 and probability_bps <= 10000)),
  stock_total integer check (stock_total is null or stock_total >= 0),
  stock_remaining integer check (stock_remaining is null or stock_remaining >= 0),
  is_pity_eligible boolean not null default true,
  is_featured boolean not null default false,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stock_remaining is null or stock_total is null or stock_remaining <= stock_total)
);

comment on table gacha.drop_pool_items is 'Weighted reward entries inside a drop pool version.';

create table if not exists gacha.pity_rules (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references gacha.blind_boxes(id) on delete cascade,
  pool_version_id uuid references gacha.drop_pool_versions(id) on delete cascade,
  rule_name text not null,
  threshold integer not null check (threshold > 0),
  target_rarity_code text not null references catalog.rarities(code),
  reset_on_rarity_code text references catalog.rarities(code),
  guaranteed_template_id uuid references catalog.collectible_templates(id) on delete set null,
  guaranteed_form_id uuid references catalog.collectible_forms(id) on delete set null,
  priority integer not null default 100,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table gacha.pity_rules is 'Per-box pity rules. Each blind box can have independent guaranteed rarity thresholds.';

create table if not exists gacha.user_pity_states (
  user_id uuid not null references core.users(id) on delete cascade,
  box_id uuid not null references gacha.blind_boxes(id) on delete cascade,
  pity_rule_id uuid not null references gacha.pity_rules(id) on delete cascade,
  current_count integer not null default 0 check (current_count >= 0),
  total_draws integer not null default 0 check (total_draws >= 0),
  last_hit_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, box_id, pity_rule_id)
);

create table if not exists gacha.draw_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  box_id uuid not null references gacha.blind_boxes(id) on delete restrict,
  pool_version_id uuid not null references gacha.drop_pool_versions(id) on delete restrict,
  payment_star_order_id uuid,
  status text not null default 'created' check (status in ('created', 'invoice_created', 'paid', 'opening', 'opened', 'cancelled', 'failed', 'expired')),
  quantity integer not null check (quantity in (1, 10)),
  unit_price_stars integer not null check (unit_price_stars > 0),
  discount_bps integer not null default 0 check (discount_bps >= 0 and discount_bps <= 10000),
  total_price_stars integer not null check (total_price_stars > 0),
  open_reward_kcoin numeric(38,0) not null default 100,
  invoice_payload text not null unique,
  idempotency_key text not null unique,
  paid_at timestamptz,
  opened_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table gacha.draw_orders is 'Open-box business orders. Paid Telegram Stars orders are processed into draw_results.';

create table if not exists gacha.draw_results (
  id uuid primary key default gen_random_uuid(),
  draw_order_id uuid not null references gacha.draw_orders(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  box_id uuid not null references gacha.blind_boxes(id) on delete restrict,
  pool_version_id uuid not null references gacha.drop_pool_versions(id) on delete restrict,
  draw_index integer not null check (draw_index > 0),
  drop_pool_item_id uuid references gacha.drop_pool_items(id) on delete set null,
  item_instance_id uuid,
  template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  form_id uuid references catalog.collectible_forms(id) on delete restrict,
  rarity_code text not null references catalog.rarities(code),
  was_pity boolean not null default false,
  random_roll numeric(38,8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (draw_order_id, draw_index)
);

create table if not exists gacha.draw_audit (
  id uuid primary key default gen_random_uuid(),
  draw_order_id uuid not null references gacha.draw_orders(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  pool_version_id uuid not null references gacha.drop_pool_versions(id) on delete restrict,
  random_seed_hash text,
  request_context jsonb not null default '{}'::jsonb,
  rules_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
