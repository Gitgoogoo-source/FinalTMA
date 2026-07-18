create table inventory.holdings (
  user_id uuid not null references identity.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

create index holdings_template_idx on inventory.holdings (template_id, user_id);

create table inventory.reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
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
  select quantity into v_quantity
  from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id
  for update;
  if v_quantity + p_amount < 0 then
    perform api.raise_business_error('INSUFFICIENT_INVENTORY', '藏品数量不足');
  end if;
  v_quantity := v_quantity + p_amount;
  update inventory.holdings set quantity = v_quantity, updated_at = now()
  where user_id = p_user_id and template_id = p_template_id;
  return v_quantity;
end;
$$;
