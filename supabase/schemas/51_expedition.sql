create table expedition.expeditions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique,
  tier text not null check (tier in ('normal', 'intermediate', 'advanced')),
  status text not null default 'running' check (status in ('running', 'claimable', 'claimed')),
  reward_fgems bigint not null check (reward_fgems > 0),
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  claimed_at timestamptz,
  check (completes_at > started_at)
);

create unique index expeditions_user_tier_active_idx on expedition.expeditions (user_id, tier) where status in ('running', 'claimable');
create index expeditions_due_idx on expedition.expeditions (completes_at) where status = 'running';

create table expedition.items (
  expedition_id uuid not null references expedition.expeditions(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  primary key (expedition_id, template_id)
);

create index expedition_items_template_idx on expedition.items (template_id, expedition_id);
