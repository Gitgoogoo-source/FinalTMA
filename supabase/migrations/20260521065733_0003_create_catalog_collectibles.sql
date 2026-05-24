-- 0003_create_catalog_collectibles.sql
-- Static and configurable catalog: rarity, series, item types, collectible templates, forms and media.

create table if not exists catalog.rarities (
  code text primary key,
  display_name text not null,
  sort_order integer not null unique,
  color_token text,
  label_bg_token text,
  min_power integer not null default 0,
  pity_eligible boolean not null default false,
  default_decompose_fgems numeric(38,0) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into catalog.rarities (code, display_name, sort_order, color_token, label_bg_token, min_power, pity_eligible, default_decompose_fgems)
values
  ('COMMON', 'Common', 10, 'rarity-common', 'rarity-common-bg', 0, false, 5),
  ('RARE', 'Rare', 20, 'rarity-rare', 'rarity-rare-bg', 20, false, 15),
  ('EPIC', 'Epic', 30, 'rarity-epic', 'rarity-epic-bg', 50, true, 50),
  ('LEGENDARY', 'Legendary', 40, 'rarity-legendary', 'rarity-legendary-bg', 100, true, 150)
on conflict (code) do nothing;

create table if not exists catalog.item_types (
  code text primary key,
  display_name text not null,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into catalog.item_types (code, display_name, sort_order)
values
  ('CHARACTER', 'Character', 10),
  ('PET', 'Pet', 20),
  ('EGG', 'Egg', 30),
  ('DECORATION', 'Decoration', 40),
  ('MATERIAL', 'Material', 50)
on conflict (code) do nothing;

create table if not exists catalog.series (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  description text,
  cover_url text,
  sort_order integer not null default 100,
  status text not null default 'active' check (status in ('draft', 'active', 'hidden', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists catalog.factions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  description text,
  icon_url text,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists catalog.collectible_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  subtitle text,
  description text,
  rarity_code text not null references catalog.rarities(code),
  type_code text not null references catalog.item_types(code),
  series_id uuid references catalog.series(id) on delete set null,
  faction_id uuid references catalog.factions(id) on delete set null,
  base_power integer not null default 0 check (base_power >= 0),
  max_level integer not null default 100 check (max_level > 0),
  supply_limit integer check (supply_limit is null or supply_limit >= 0),
  release_status text not null default 'draft' check (release_status in ('draft', 'active', 'hidden', 'retired')),
  tradeable boolean not null default true,
  upgradeable boolean not null default true,
  evolvable boolean not null default true,
  decomposable boolean not null default true,
  nft_mintable boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table catalog.collectible_templates is 'Base definition of a collectible. User-owned copies are stored in inventory.item_instances.';

create table if not exists catalog.collectible_forms (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  form_index integer not null check (form_index >= 1),
  form_slug text not null,
  display_name text not null,
  description text,
  image_url text,
  thumbnail_url text,
  avatar_url text,
  base_power_bonus integer not null default 0,
  is_default boolean not null default false,
  next_form_id uuid references catalog.collectible_forms(id) on delete set null deferrable initially deferred,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, form_index),
  unique (template_id, form_slug)
);

comment on table catalog.collectible_forms is 'Collectible evolution forms. A series can have low, middle and high form like Pokémon evolution.';

create table if not exists catalog.collectible_media (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  form_id uuid references catalog.collectible_forms(id) on delete cascade,
  media_type text not null check (media_type in ('avatar', 'thumb', 'card', 'hero', 'animation', 'nft_image', 'metadata')),
  url text not null,
  storage_bucket text,
  storage_path text,
  mime_type text,
  width integer,
  height integer,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists catalog.power_rules (
  id uuid primary key default gen_random_uuid(),
  rarity_code text not null references catalog.rarities(code),
  form_index integer not null default 1,
  level_min integer not null default 1,
  level_max integer not null default 100,
  base_power_multiplier numeric(10,4) not null default 1,
  level_power_step integer not null default 1,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (level_min > 0 and level_max >= level_min)
);

create table if not exists catalog.market_price_rules (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references catalog.collectible_templates(id) on delete cascade,
  rarity_code text references catalog.rarities(code),
  form_index integer,
  min_price_kcoin numeric(38,0) not null default 1,
  max_price_kcoin numeric(38,0),
  suggested_price_kcoin numeric(38,0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_price_kcoin >= 0),
  check (max_price_kcoin is null or max_price_kcoin >= min_price_kcoin)
);

create table if not exists catalog.item_tags (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists catalog.template_tags (
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  tag_id uuid not null references catalog.item_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (template_id, tag_id)
);

create table if not exists catalog.banner_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  image_url text not null,
  placement text not null check (placement in ('market_top', 'box_top', 'task_top', 'album_top', 'home')),
  target_type text not null default 'none' check (target_type in ('none', 'box', 'market_listing', 'shop_product', 'external_url', 'task')),
  target_ref text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table catalog.banner_campaigns is 'Configurable activity images shown in marketplace, task center and other pages.';
