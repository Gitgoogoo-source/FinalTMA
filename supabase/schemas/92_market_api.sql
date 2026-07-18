create or replace function api.market_bootstrap(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object(
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template_id', t.id,
        'name', t.name,
        'rarity', t.rarity,
        'stage', t.stage,
        'image_path', t.image_path,
        'unit_price', t.market_price,
        'available_quantity', x.quantity
      ) order by t.sort_order)
      from (
        select l.template_id, sum(l.remaining) quantity
        from market.listings l
        join identity.users u on u.id = l.seller_id
        where l.status = 'active' and l.remaining > 0 and u.status = 'normal' and l.seller_id <> v_user_id
        group by l.template_id
      ) x
      join catalog.templates t on t.id = x.template_id
    ), '[]'::jsonb),
    'sellable_items', coalesce((
      select jsonb_agg(inventory.item_json(v_user_id, h.template_id) || jsonb_build_object('unit_price', t.market_price) order by t.sort_order)
      from inventory.holdings h
      join catalog.templates t on t.id = h.template_id
      where h.user_id = v_user_id and inventory.available_quantity(v_user_id, h.template_id) > 0
    ), '[]'::jsonb),
    'vip', vip.status_json(v_user_id),
    'max_active_templates', 50,
    'fee_bps', 500,
    'vip_rebate_bps', 2000
  );
end;
$$;

create or replace function api.market_template(p_session_id uuid, p_template_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
  v_result jsonb;
begin
  select jsonb_build_object(
    'template_id', t.id,
    'name', t.name,
    'rarity', t.rarity,
    'stage', t.stage,
    'image_path', t.image_path,
    'unit_price', t.market_price,
    'available_quantity', coalesce((
      select sum(l.remaining)
      from market.listings l
      join identity.users u on u.id = l.seller_id
      where l.template_id = t.id and l.status = 'active' and l.remaining > 0
        and u.status = 'normal' and l.seller_id <> v_user_id
    ), 0)
  ) into v_result
  from catalog.templates t where t.id = p_template_id;
  if v_result is null then
    perform api.raise_business_error('TEMPLATE_NOT_FOUND', '藏品模板不存在');
  end if;
  return v_result;
end;
$$;

create or replace function api.market_my_listings(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := api.session_user(p_session_id);
begin
  return jsonb_build_object('listings', coalesce((
    select jsonb_agg(jsonb_build_object(
      'listing_id', l.id,
      'template_id', l.template_id,
      'name', t.name,
      'rarity', t.rarity,
      'image_path', t.image_path,
      'quantity', l.remaining,
      'unit_price', l.unit_price,
      'created_at', l.created_at
    ) order by l.created_at)
    from market.listings l
    join catalog.templates t on t.id = l.template_id
    where l.seller_id = v_user_id and l.status = 'active' and l.remaining > 0
  ), '[]'::jsonb));
end;
$$;
