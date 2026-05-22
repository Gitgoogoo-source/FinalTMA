create or replace function api.market_list_my_listings(
  p_user_id uuid,
  p_statuses text[] default null,
  p_rarities text[] default null,
  p_type_codes text[] default null,
  p_template_ids uuid[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_sort text default 'recently_listed',
  p_limit integer default 30,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_items jsonb;
  v_next_cursor text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with base as (
    select
      l.id as listing_id,
      l.seller_user_id,
      l.template_id,
      l.form_id,
      l.rarity_code,
      l.status,
      l.item_count,
      l.remaining_count,
      l.unit_price_kcoin,
      l.expected_net_amount,
      l.price_health,
      l.last_price_changed_at,
      l.expires_at,
      l.created_at,
      t.type_code,
      r.sort_order as rarity_sort_order,
      coalesce(f.display_name, t.display_name) as item_name,
      coalesce(f.thumbnail_url, f.image_url, f.avatar_url, media.url) as image_url
    from market.listings l
    join catalog.collectible_templates t on t.id = l.template_id
    join catalog.rarities r on r.code = l.rarity_code
    left join catalog.collectible_forms f on f.id = l.form_id
    left join lateral (
      select cm.url
      from catalog.collectible_media cm
      where cm.template_id = t.id
        and (cm.form_id is not distinct from l.form_id or cm.form_id is null)
        and cm.media_type in ('card', 'thumb', 'avatar', 'hero')
      order by
        case when cm.form_id is not distinct from l.form_id then 0 else 1 end,
        case cm.media_type when 'card' then 0 when 'thumb' then 1 when 'avatar' then 2 else 3 end,
        cm.sort_order asc,
        cm.created_at desc
      limit 1
    ) media on true
    where l.seller_user_id = p_user_id
      and (p_cursor is null or p_sort <> 'recently_listed' or l.created_at < p_cursor::timestamptz)
      and (p_min_price is null or l.unit_price_kcoin >= p_min_price)
      and (p_max_price is null or l.unit_price_kcoin <= p_max_price)
      and (
        p_statuses is null
        or exists (
          select 1 from unnest(p_statuses) as ps(value)
          where l.status = ps.value
        )
      )
      and (
        p_rarities is null
        or exists (
          select 1 from unnest(p_rarities) as pr(value)
          where lower(l.rarity_code) = lower(pr.value)
        )
      )
      and (
        p_type_codes is null
        or exists (
          select 1 from unnest(p_type_codes) as pt(value)
          where lower(t.type_code) = lower(pt.value)
        )
      )
      and (p_template_ids is null or l.template_id = any(p_template_ids))
  ),
  ordered as (
    select
      base.*,
      row_number() over (
        order by
          case when p_sort = 'price_low_to_high' or p_sort = 'value_low_to_high' then unit_price_kcoin end asc,
          case when p_sort = 'price_high_to_low' or p_sort = 'value_high_to_low' then unit_price_kcoin end desc,
          case when p_sort = 'rarity_high_to_low' then rarity_sort_order end desc,
          created_at desc,
          listing_id desc
      ) as rn
    from base
  ),
  page as (
    select *
    from ordered
    where rn <= v_limit
  )
  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'listing_id', listing_id,
          'seller_user_id', seller_user_id,
          'template_id', template_id,
          'form_id', form_id,
          'name', item_name,
          'rarity', lower(rarity_code),
          'type_code', lower(type_code),
          'image_url', image_url,
          'unit_price_kcoin', unit_price_kcoin,
          'currency_code', 'KCOIN',
          'item_count', item_count,
          'remaining_count', remaining_count,
          'expected_net_amount', expected_net_amount,
          'status', status,
          'is_own_listing', true,
          'is_buyable', false,
          'not_buyable_reason', 'own_listing',
          'price_health', coalesce(price_health, 'unknown'),
          'last_price_changed_at', last_price_changed_at,
          'created_at', created_at,
          'expires_at', expires_at
        )
        order by rn
      ),
      '[]'::jsonb
    ),
    (
      select ordered.created_at::text
      from ordered
      where ordered.rn = v_limit + 1
    )
    into v_items, v_next_cursor
  from page;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor
  );
end;
$$;

grant execute on function api.market_list_my_listings(uuid, text[], text[], text[], uuid[], numeric, numeric, text, integer, text) to service_role;
revoke execute on function api.market_list_my_listings(uuid, text[], text[], text[], uuid[], numeric, numeric, text, integer, text) from public, anon, authenticated;
