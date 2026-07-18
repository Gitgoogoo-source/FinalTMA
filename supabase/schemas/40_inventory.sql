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
