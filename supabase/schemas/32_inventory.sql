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
  kind text not null check (kind in ('listing', 'expedition', 'mint', 'battle')),
  reference_id uuid not null,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique (kind, reference_id, template_id)
);

create index reservations_user_template_active_idx
on inventory.reservations (user_id, template_id, kind)
include (quantity)
where status = 'active';

create view inventory.quantity_read_model
with (security_invoker = true)
as
select
  h.user_id,
  h.template_id,
  h.quantity::bigint as total,
  greatest(h.quantity - coalesce(sum(r.quantity), 0), 0)::bigint as available,
  coalesce(sum(r.quantity) filter (where r.kind = 'listing'), 0)::bigint as listed,
  0::bigint as trading,
  coalesce(sum(r.quantity) filter (where r.kind = 'expedition'), 0)::bigint as expedition,
  coalesce(sum(r.quantity) filter (where r.kind = 'mint'), 0)::bigint as minting,
  coalesce(sum(r.quantity) filter (where r.kind = 'battle'), 0)::bigint as battling
from inventory.holdings h
left join inventory.reservations r
  on r.user_id = h.user_id
  and r.template_id = h.template_id
  and r.status = 'active'
group by h.user_id, h.template_id, h.quantity;

create view inventory.item_read_model
with (security_invoker = true)
as
select
  quantity.user_id,
  template.id as template_id,
  template.name,
  template.rarity,
  template.stage,
  template.chain_id,
  chain.chain_type,
  case
    when thumbnail.id is null
      or thumbnail.object_class <> 'runtime'
      or thumbnail.bucket is distinct from delivery.public_bucket
      or thumbnail.status <> 'active'
    then null
    else delivery.public_origin || '/' || delivery.public_bucket || '/' || thumbnail.object_key
  end as image_thumbnail_url,
  case
    when detail.id is null
      or detail.object_class <> 'runtime'
      or detail.bucket is distinct from delivery.public_bucket
      or detail.status <> 'active'
    then null
    else delivery.public_origin || '/' || delivery.public_bucket || '/' || detail.object_key
  end as image_detail_url,
  template.combat_power,
  template.expedition_fgems,
  template.decompose_fgems,
  quantity.total,
  quantity.available,
  quantity.listed,
  quantity.trading,
  quantity.minting,
  quantity.expedition,
  quantity.battling,
  template.sort_order,
  template.market_price
from inventory.quantity_read_model quantity
join catalog.templates template on template.id = quantity.template_id
join catalog.chains chain on chain.id = template.chain_id
left join catalog.current_asset_release current_release on current_release.singleton
left join catalog.asset_release_templates release_item
  on release_item.release_id = current_release.release_id
  and release_item.template_id = template.id
left join catalog.asset_delivery_config delivery on delivery.singleton
left join catalog.asset_objects thumbnail on thumbnail.id = release_item.thumbnail_object_id
left join catalog.asset_objects detail on detail.id = release_item.detail_object_id
where quantity.total > 0;

create or replace function inventory.present_item(p_item inventory.item_read_model)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select to_jsonb(p_item) - array['user_id', 'sort_order', 'market_price']::text[]
$$;

create or replace function inventory.available_quantity(p_user_id uuid, p_template_id text)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select quantity.available
    from inventory.quantity_read_model quantity
    where quantity.user_id = p_user_id and quantity.template_id = p_template_id
  ), 0)
$$;

create or replace function inventory.change_holding(p_user_id uuid, p_template_id text, p_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quantity bigint;
  v_reserved bigint;
begin
  insert into inventory.holdings (user_id, template_id) values (p_user_id, p_template_id)
  on conflict (user_id, template_id) do nothing;
  select quantity into v_quantity
  from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id
  for update;
  select coalesce(sum(quantity), 0) into v_reserved
  from inventory.reservations
  where user_id = p_user_id and template_id = p_template_id and status = 'active';
  if v_quantity + p_amount < v_reserved then
    perform api.raise_business_error('INSUFFICIENT_INVENTORY', '藏品数量不足');
  end if;
  v_quantity := v_quantity + p_amount;
  update inventory.holdings set quantity = v_quantity, updated_at = now()
  where user_id = p_user_id and template_id = p_template_id;
  return v_quantity;
end;
$$;

create or replace function inventory.reserve(
  p_user_id uuid,
  p_template_id text,
  p_quantity bigint,
  p_kind text,
  p_reference_id uuid
)
returns inventory.reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holding bigint;
  v_reserved bigint;
  v_reservation inventory.reservations%rowtype;
begin
  if p_quantity <= 0 then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '占用数量无效'); end if;
  select quantity into v_holding
  from inventory.holdings
  where user_id = p_user_id and template_id = p_template_id
  for update;
  if v_holding is null then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
  select coalesce(sum(quantity), 0) into v_reserved
  from inventory.reservations
  where user_id = p_user_id and template_id = p_template_id and status = 'active';
  if v_holding - v_reserved < p_quantity then perform api.raise_business_error('INSUFFICIENT_INVENTORY', '可用藏品不足'); end if;
  insert into inventory.reservations (user_id, template_id, quantity, kind, reference_id)
  values (p_user_id, p_template_id, p_quantity, p_kind, p_reference_id)
  returning * into v_reservation;
  return v_reservation;
end;
$$;

create or replace function inventory.item_json(p_user_id uuid, p_template_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select inventory.present_item(item)
  from inventory.item_read_model item
  where item.user_id = p_user_id and item.template_id = p_template_id
$$;

create or replace function api.inventory_list(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return (
    with user_items as materialized (
      select item.*
      from inventory.item_read_model item
      where item.user_id = v_user_id
    )
    select jsonb_build_object(
      'items', coalesce(
        jsonb_agg(inventory.present_item(item) order by item.sort_order)
          filter (where item.available > 0),
        '[]'::jsonb
      ),
      'template_count', count(*) filter (where item.available > 0),
      'total_quantity', coalesce(sum(item.available) filter (where item.available > 0), 0)
    )
    from user_items item
  );
end;
$$;

create or replace function api.inventory_detail(p_session_id uuid, p_template_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  v_result := inventory.item_json(v_user_id, p_template_id);
  if v_result is null then
    perform api.raise_business_error('INVENTORY_ITEM_NOT_FOUND', '藏品不存在');
  end if;
  return v_result;
end;
$$;
