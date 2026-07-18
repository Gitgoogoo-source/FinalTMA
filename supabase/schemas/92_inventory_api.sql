create or replace function inventory.item_json(p_user_id uuid, p_template_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'chain_id', t.chain_id,
    'chain_type', c.chain_type,
    'image_path', t.image_path,
    'combat_power', t.combat_power,
    'expedition_fgems', t.expedition_fgems,
    'total', h.quantity,
    'available', inventory.available_quantity(p_user_id, t.id),
    'listed', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'listing' and r.status = 'active'), 0),
    'expedition', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'expedition' and r.status = 'active'), 0),
    'minting', coalesce((select sum(r.quantity) from inventory.reservations r where r.user_id = p_user_id and r.template_id = t.id and r.kind = 'mint' and r.status = 'active'), 0)
  )
  from inventory.holdings h
  join catalog.templates t on t.id = h.template_id
  join catalog.chains c on c.id = t.chain_id
  where h.user_id = p_user_id and h.template_id = p_template_id and h.quantity > 0
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
  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(inventory.item_json(v_user_id, h.template_id) order by t.sort_order)
      from inventory.holdings h
      join catalog.templates t on t.id = h.template_id
      where h.user_id = v_user_id and h.quantity > 0
    ), '[]'::jsonb),
    'template_count', (select count(*) from inventory.holdings where user_id = v_user_id and quantity > 0),
    'total_quantity', (select coalesce(sum(quantity), 0) from inventory.holdings where user_id = v_user_id)
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
