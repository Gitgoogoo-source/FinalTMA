-- Fix phase 10 sell-page read model:
-- 1. owned_count is the user's true owned count for the visible template/form.
-- 2. sellable filters can be pushed into the API/RPC path, including price.
-- 3. pagination cursor is a stable row-number offset for every supported sort.

drop function if exists api.market_list_sellable_items(
  uuid,
  text[],
  text[],
  uuid[],
  uuid[],
  boolean,
  integer,
  integer,
  text,
  text,
  integer,
  text
);

create or replace function api.market_list_sellable_items(
  p_user_id uuid,
  p_rarities text[] default null,
  p_type_codes text[] default null,
  p_series_ids uuid[] default null,
  p_template_ids uuid[] default null,
  p_only_duplicates boolean default false,
  p_min_level integer default null,
  p_max_level integer default null,
  p_keyword text default null,
  p_min_price_kcoin numeric default null,
  p_max_price_kcoin numeric default null,
  p_sort text default 'recently_obtained',
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
  v_offset integer := case
    when coalesce(p_cursor, '') ~ '^[0-9]+$'
      then least(greatest(p_cursor::integer, 0), 1000000)
    else 0
  end;
  v_items jsonb;
  v_next_cursor text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_min_price_kcoin is not null and p_min_price_kcoin < 0 then
    raise exception 'min_price must be non-negative';
  end if;
  if p_max_price_kcoin is not null and p_max_price_kcoin < 0 then
    raise exception 'max_price must be non-negative';
  end if;
  if p_min_price_kcoin is not null
     and p_max_price_kcoin is not null
     and p_min_price_kcoin > p_max_price_kcoin then
    raise exception 'min_price cannot be greater than max_price';
  end if;

  with item_base as (
    select
      ii.id as item_instance_id,
      ii.template_id,
      ii.form_id,
      ii.serial_no,
      ii.level,
      ii.power,
      ii.acquired_at,
      t.display_name as template_name,
      t.rarity_code,
      t.type_code,
      t.series_id,
      r.sort_order as rarity_sort_order,
      f.form_index,
      coalesce(f.display_name, t.display_name) as item_name,
      coalesce(f.thumbnail_url, f.image_url, f.avatar_url, media.url) as image_url,
      pr.suggested_price_kcoin,
      pr.min_price_kcoin,
      pr.max_price_kcoin
    from inventory.item_instances ii
    join catalog.collectible_templates t on t.id = ii.template_id
    join catalog.rarities r on r.code = t.rarity_code
    left join catalog.collectible_forms f on f.id = ii.form_id
    left join lateral (
      select cm.url
      from catalog.collectible_media cm
      where cm.template_id = t.id
        and (cm.form_id is not distinct from ii.form_id or cm.form_id is null)
        and cm.media_type in ('card', 'thumb', 'avatar', 'hero')
      order by
        case when cm.form_id is not distinct from ii.form_id then 0 else 1 end,
        case cm.media_type when 'card' then 0 when 'thumb' then 1 when 'avatar' then 2 else 3 end,
        cm.sort_order asc,
        cm.created_at desc
      limit 1
    ) media on true
    left join lateral (
      select mpr.suggested_price_kcoin, mpr.min_price_kcoin, mpr.max_price_kcoin
      from catalog.market_price_rules mpr
      where mpr.active = true
        and (mpr.template_id is null or mpr.template_id = t.id)
        and (mpr.rarity_code is null or mpr.rarity_code = t.rarity_code)
        and (mpr.form_index is null or mpr.form_index = f.form_index)
      order by
        case when mpr.template_id = t.id then 0 else 1 end,
        case when mpr.form_index = f.form_index then 0 else 1 end,
        case when mpr.rarity_code = t.rarity_code then 0 else 1 end,
        mpr.created_at desc
      limit 1
    ) pr on true
    where ii.owner_user_id = p_user_id
      and ii.status = 'available'
      and ii.nft_mint_status not in ('queued', 'minting')
      and t.tradeable = true
      and not exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
      )
      and (p_min_level is null or ii.level >= p_min_level)
      and (p_max_level is null or ii.level <= p_max_level)
      and (
        p_rarities is null
        or exists (
          select 1 from unnest(p_rarities) as prarity(value)
          where lower(t.rarity_code) = lower(prarity.value)
        )
      )
      and (
        p_type_codes is null
        or exists (
          select 1 from unnest(p_type_codes) as ptype(value)
          where lower(t.type_code) = lower(ptype.value)
        )
      )
      and (p_series_ids is null or t.series_id = any(p_series_ids))
      and (p_template_ids is null or t.id = any(p_template_ids))
      and (
        p_keyword is null
        or trim(p_keyword) = ''
        or t.display_name ilike '%' || trim(p_keyword) || '%'
        or coalesce(f.display_name, '') ilike '%' || trim(p_keyword) || '%'
      )
  ),
  available_groups as (
    select
      template_id,
      form_id,
      max(item_name) as name,
      max(rarity_code) as rarity_code,
      max(type_code) as type_code,
      (array_agg(series_id order by acquired_at desc, item_instance_id desc))[1] as series_id,
      max(rarity_sort_order) as rarity_sort_order,
      max(image_url) as image_url,
      count(*)::integer as available_count,
      array_agg(item_instance_id order by acquired_at desc, item_instance_id desc) as item_instance_ids,
      (array_agg(item_instance_id order by acquired_at desc, item_instance_id desc))[1] as item_instance_id,
      max(serial_no) as serial_no,
      max(level) as level,
      max(power) as power,
      max(acquired_at) as acquired_at,
      max(suggested_price_kcoin) as suggested_price,
      max(min_price_kcoin) as min_price,
      max(max_price_kcoin) as max_price
    from item_base
    group by template_id, form_id
    having p_only_duplicates is distinct from true or count(*) > 1
  ),
  owned_counts as (
    select
      ii.template_id,
      ii.form_id,
      count(*)::integer as owned_count
    from inventory.item_instances ii
    join available_groups ag
      on ag.template_id = ii.template_id
     and ag.form_id is not distinct from ii.form_id
    where ii.owner_user_id = p_user_id
      and ii.status not in ('consumed', 'decomposed', 'transferred', 'burned')
    group by ii.template_id, ii.form_id
  ),
  grouped as (
    select
      ag.*,
      coalesce(oc.owned_count, ag.available_count) as owned_count,
      coalesce(ag.suggested_price, ag.min_price, ag.max_price) as reference_price
    from available_groups ag
    left join owned_counts oc
      on oc.template_id = ag.template_id
     and oc.form_id is not distinct from ag.form_id
  ),
  filtered_groups as (
    select *
    from grouped
    where (p_min_price_kcoin is null or reference_price >= p_min_price_kcoin)
      and (p_max_price_kcoin is null or reference_price <= p_max_price_kcoin)
  ),
  ordered as (
    select
      filtered_groups.*,
      row_number() over (
        order by
          case when p_sort = 'rarity_high_to_low' then rarity_sort_order end desc,
          case when p_sort = 'rarity_low_to_high' then rarity_sort_order end asc,
          case when p_sort = 'level_high_to_low' then level end desc,
          case when p_sort = 'level_low_to_high' then level end asc,
          case when p_sort = 'power_high_to_low' then power end desc,
          case when p_sort = 'power_low_to_high' then power end asc,
          case when p_sort = 'name_a_to_z' then name end asc,
          acquired_at desc,
          template_id desc,
          form_id desc nulls last
      ) as rn
    from filtered_groups
  ),
  page as (
    select *
    from ordered
    where rn > v_offset
      and rn <= v_offset + v_limit
  )
  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_instance_id', item_instance_id,
          'item_instance_ids', to_jsonb(item_instance_ids),
          'template_id', template_id,
          'form_id', form_id,
          'serial_no', serial_no,
          'name', name,
          'rarity', lower(rarity_code),
          'type_code', lower(type_code),
          'image_url', image_url,
          'level', level,
          'power', power,
          'owned_count', owned_count,
          'available_count', available_count,
          'suggested_price', suggested_price,
          'min_price', min_price,
          'max_price', max_price,
          'acquired_at', acquired_at,
          'is_tradeable', true
        )
        order by rn
      ),
      '[]'::jsonb
    ),
    case
      when exists (select 1 from ordered where rn > v_offset + v_limit)
        then (v_offset + v_limit)::text
      else null
    end
    into v_items, v_next_cursor
  from page;

  return jsonb_build_object(
    'items', v_items,
    'next_cursor', v_next_cursor
  );
end;
$$;

revoke execute on function api.market_list_sellable_items(uuid, text[], text[], uuid[], uuid[], boolean, integer, integer, text, numeric, numeric, text, integer, text)
  from public, anon, authenticated;
grant execute on function api.market_list_sellable_items(uuid, text[], text[], uuid[], uuid[], boolean, integer, integer, text, numeric, numeric, text, integer, text)
  to service_role;
