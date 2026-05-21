-- 0009_create_album_leaderboard.sql
-- Album books, collection progress, milestone rewards and weekly leaderboards.

create table if not exists album.books (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  description text,
  book_type text not null check (book_type in ('all', 'series', 'faction', 'rarity', 'event')),
  series_id uuid references catalog.series(id) on delete set null,
  faction_id uuid references catalog.factions(id) on delete set null,
  rarity_code text references catalog.rarities(code),
  cover_url text,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table album.books is 'Album books can be all collectibles, series-specific, faction-specific, rarity-specific or event-specific.';

create table if not exists album.book_items (
  book_id uuid not null references album.books(id) on delete cascade,
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  primary key (book_id, template_id)
);

create table if not exists album.user_discoveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  template_id uuid not null references catalog.collectible_templates(id) on delete cascade,
  first_item_instance_id uuid references inventory.item_instances(id) on delete set null,
  first_source_type text,
  first_source_id uuid,
  discovered_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, template_id)
);

comment on table album.user_discoveries is 'Permanent collection discovery record. Selling or decomposing an item does not remove discovery progress.';

create table if not exists album.milestones (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references album.books(id) on delete cascade,
  required_count integer not null check (required_count > 0),
  title text not null,
  reward jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id, required_count)
);

create table if not exists album.milestone_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  milestone_id uuid not null references album.milestones(id) on delete cascade,
  reward jsonb not null default '[]'::jsonb,
  claimed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, milestone_id)
);

create table if not exists album.weekly_leaderboards (
  id uuid primary key default gen_random_uuid(),
  week_key text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('scheduled', 'active', 'settled', 'archived')),
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists album.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  leaderboard_id uuid not null references album.weekly_leaderboards(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  rank integer,
  score numeric(38,0) not null default 0,
  collected_count integer not null default 0,
  total_count integer not null default 0,
  completion_percent numeric(6,2) not null default 0,
  rare_count integer not null default 0,
  epic_count integer not null default 0,
  legendary_count integer not null default 0,
  minted_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique (leaderboard_id, user_id)
);

create table if not exists album.score_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  rule_type text not null check (rule_type in ('discovery', 'rarity_bonus', 'mint_bonus', 'completion_bonus')),
  rarity_code text references catalog.rarities(code),
  points numeric(38,0) not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
