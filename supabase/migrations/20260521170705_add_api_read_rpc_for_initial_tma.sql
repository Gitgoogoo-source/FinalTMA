-- Move initial TMA read endpoints behind the exposed api schema.
-- These functions are backend-only: Vercel Functions call them with service_role.

create or replace function api.get_user_asset_balances(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balances jsonb;
  v_updated_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  with requested(currency_code) as (
    values ('KCOIN'::text), ('FGEMS'::text), ('STAR_DISPLAY'::text)
  ),
  balance_rows as (
    select
      requested.currency_code,
      coalesce(ub.available_amount, 0)::text as available_amount,
      coalesce(ub.locked_amount, 0)::text as locked_amount
    from requested
    left join economy.user_balances ub
      on ub.user_id = p_user_id
     and ub.currency_code = requested.currency_code
  )
  select jsonb_object_agg(
    currency_code,
    jsonb_build_object(
      'currencyCode', currency_code,
      'available', available_amount,
      'locked', locked_amount
    )
  )
  into v_balances
  from balance_rows;

  select max(updated_at)
  into v_updated_at
  from economy.user_balances
  where user_id = p_user_id
    and currency_code in ('KCOIN', 'FGEMS', 'STAR_DISPLAY');

  return jsonb_build_object(
    'userId', p_user_id,
    'balances', coalesce(v_balances, '{}'::jsonb),
    'assets', jsonb_build_object(
      'kcoin', coalesce(v_balances -> 'KCOIN', jsonb_build_object('currencyCode', 'KCOIN', 'available', '0', 'locked', '0')),
      'fgems', coalesce(v_balances -> 'FGEMS', jsonb_build_object('currencyCode', 'FGEMS', 'available', '0', 'locked', '0')),
      'stars', coalesce(v_balances -> 'STAR_DISPLAY', jsonb_build_object('currencyCode', 'STAR_DISPLAY', 'available', '0', 'locked', '0'))
    ),
    'updatedAt', v_updated_at
  );
end;
$$;

create or replace function api.gacha_list_boxes(
  p_user_id uuid,
  p_statuses text[] default null,
  p_tier text default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select
      p_user_id as user_id,
      coalesce(p_statuses, array['not_started', 'active', 'paused', 'ended', 'sold_out']::text[]) as statuses,
      nullif(p_tier, '') as tier,
      greatest(1, least(coalesce(p_limit, 20), 100)) as row_limit,
      now() as server_now
  ),
  selected_boxes as (
    select b.*
    from gacha.blind_boxes b, params p
    where b.status = any(p.statuses)
      and (p.tier is null or b.tier = p.tier)
    order by b.sort_order asc, b.created_at asc
    limit (select row_limit from params)
  ),
  box_items as (
    select
      b.id,
      b.slug,
      b.display_name,
      b.description,
      b.tier,
      b.status,
      b.price_stars,
      b.total_stock,
      b.remaining_stock,
      b.open_reward_kcoin,
      b.cover_image_url,
      b.hero_image_url,
      b.starts_at,
      b.ends_at,
      b.sort_order,
      b.updated_at,
      pr10.discount_bps as ten_discount_bps,
      coalesce(pr1.price_stars_override, b.price_stars) as single_unit_price,
      coalesce(pr10.price_stars_override, b.price_stars) as ten_unit_price,
      prule.id as pity_rule_id,
      prule.threshold as pity_threshold,
      prule.target_rarity_code as pity_target_rarity_code,
      ps.current_count as pity_current_count,
      ps.total_draws as pity_total_draws,
      ps.updated_at as pity_updated_at,
      p.server_now
    from selected_boxes b
    cross join params p
    left join lateral (
      select pr.price_stars_override, pr.discount_bps
      from gacha.box_price_rules pr
      where pr.box_id = b.id
        and pr.active = true
        and pr.quantity = 1
        and (pr.starts_at is null or pr.starts_at <= p.server_now)
        and (pr.ends_at is null or pr.ends_at > p.server_now)
      order by pr.created_at desc
      limit 1
    ) pr1 on true
    left join lateral (
      select pr.price_stars_override, pr.discount_bps
      from gacha.box_price_rules pr
      where pr.box_id = b.id
        and pr.active = true
        and pr.quantity = 10
        and (pr.starts_at is null or pr.starts_at <= p.server_now)
        and (pr.ends_at is null or pr.ends_at > p.server_now)
      order by pr.created_at desc
      limit 1
    ) pr10 on true
    left join lateral (
      select pr.id, pr.threshold, pr.target_rarity_code
      from gacha.pity_rules pr
      where pr.box_id = b.id
        and pr.active = true
      order by pr.priority asc, pr.created_at asc
      limit 1
    ) prule on true
    left join gacha.user_pity_states ps
      on ps.user_id = p.user_id
     and ps.box_id = b.id
     and ps.pity_rule_id = prule.id
  ),
  mapped_items as (
    select
      sort_order,
      id,
      jsonb_build_object(
        'box_id', id,
        'slug', slug,
        'name', display_name,
        'description', description,
        'tier', case when tier = 'ordinary' then 'normal' else tier end,
        'status', status,
        'single_star_price', ceil((single_unit_price::numeric * (10000 - 0)) / 10000)::integer,
        'ten_draw_price', ceil((ten_unit_price::numeric * 10 * (10000 - coalesce(ten_discount_bps, 1000))) / 10000)::integer,
        'discount_rate', round(((10000 - coalesce(ten_discount_bps, 1000))::numeric / 10000), 4),
        'discount_bps', coalesce(ten_discount_bps, 1000),
        'stock_status',
          case
            when status = 'sold_out' or remaining_stock = 0 then 'sold_out'
            when remaining_stock is null then 'unlimited'
            when remaining_stock <= 10 or (total_stock is not null and remaining_stock::numeric / greatest(total_stock, 1) <= 0.1) then 'low_stock'
            else 'available'
          end,
        'total_stock', total_stock,
        'remaining_stock', remaining_stock,
        'pity_progress',
          case
            when pity_rule_id is null then null
            else jsonb_build_object(
              'rule_id', pity_rule_id,
              'threshold', pity_threshold,
              'current_count', coalesce(pity_current_count, 0),
              'total_draws', coalesce(pity_total_draws, 0),
              'remaining_to_guaranteed', greatest(pity_threshold - coalesce(pity_current_count, 0), 0),
              'target_rarity', pity_target_rarity_code,
              'guaranteed_next', greatest(pity_threshold - coalesce(pity_current_count, 0), 0) <= 0,
              'updated_at', pity_updated_at
            )
          end,
        'hero_image_url', coalesce(hero_image_url, cover_image_url),
        'cover_image_url', cover_image_url,
        'is_openable',
          status = 'active'
          and (starts_at is null or starts_at <= server_now)
          and (ends_at is null or ends_at > server_now)
          and (remaining_stock is null or remaining_stock > 0),
        'disabled_reason',
          case
            when status = 'not_started' then '盲盒活动尚未开始。'
            when status = 'paused' then '盲盒活动已暂停。'
            when status = 'ended' then '盲盒活动已结束。'
            when status = 'sold_out' then '盲盒库存已售罄。'
            when status <> 'active' then '当前盲盒不可开启。'
            when starts_at is not null and starts_at > server_now then '盲盒活动尚未开始。'
            when ends_at is not null and ends_at <= server_now then '盲盒活动已结束。'
            when remaining_stock is not null and remaining_stock <= 0 then '盲盒库存已售罄。'
            else null
          end,
        'kcoin_return_per_draw', open_reward_kcoin,
        'sort_order', sort_order,
        'updated_at', updated_at
      ) as item
    from box_items
  )
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(item order by sort_order asc, id asc), '[]'::jsonb),
    'next_cursor', null,
    'server_time', (select server_now from params)
  )
  from mapped_items;
$$;

create or replace function api.gacha_get_box_rewards(
  p_box_id uuid,
  p_pool_version_id uuid default null,
  p_include_inactive boolean default false,
  p_include_sold_out boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_box record;
  v_pool record;
  v_total_weight numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_pity_rule jsonb;
begin
  select b.id, b.slug, b.display_name, b.status
  into v_box
  from gacha.blind_boxes b
  where b.id = p_box_id;

  if v_box.id is null or v_box.status in ('draft', 'hidden') then
    return jsonb_build_object('not_found', true, 'reason', 'box');
  end if;

  if not p_include_inactive and v_box.status = 'hidden' then
    return jsonb_build_object('not_found', true, 'reason', 'box');
  end if;

  select
    dpv.id,
    dpv.box_id,
    dpv.version_no,
    dpv.status,
    dpv.total_weight,
    dpv.effective_from,
    dpv.effective_to,
    dpv.updated_at
  into v_pool
  from gacha.drop_pool_versions dpv
  where dpv.box_id = p_box_id
    and dpv.status = 'active'
    and (p_pool_version_id is null or dpv.id = p_pool_version_id)
    and (dpv.effective_from is null or dpv.effective_from <= v_now)
    and (dpv.effective_to is null or dpv.effective_to > v_now)
  order by dpv.version_no desc
  limit 1;

  if v_pool.id is null then
    return jsonb_build_object('not_found', true, 'reason', 'pool');
  end if;

  v_total_weight := coalesce(v_pool.total_weight, 0);

  with reward_rows as (
    select
      dpi.id as pool_item_id,
      dpi.template_id,
      dpi.form_id,
      coalesce(cf.display_name, ct.display_name, 'Unknown reward') as reward_name,
      ct.description,
      dpi.rarity_code,
      coalesce(r.display_name, dpi.rarity_code) as rarity_label,
      ct.type_code,
      coalesce(it.display_name, ct.type_code) as item_type_label,
      coalesce(cf.image_url, cf.thumbnail_url, cf.avatar_url) as image_url,
      coalesce(
        dpi.probability_bps,
        case
          when v_total_weight > 0 then round((dpi.drop_weight::numeric / v_total_weight) * 10000)
          else 0
        end
      )::integer as probability_bps,
      dpi.stock_remaining,
      dpi.is_pity_eligible,
      dpi.is_featured,
      dpi.sort_order
    from gacha.drop_pool_items dpi
    join catalog.collectible_templates ct on ct.id = dpi.template_id
    left join catalog.collectible_forms cf on cf.id = dpi.form_id
    left join catalog.rarities r on r.code = dpi.rarity_code
    left join catalog.item_types it on it.code = ct.type_code
    where dpi.pool_version_id = v_pool.id
      and (p_include_sold_out or dpi.stock_remaining is null or dpi.stock_remaining <> 0)
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'pool_item_id', pool_item_id,
        'template_id', template_id,
        'form_id', form_id,
        'name', reward_name,
        'description', description,
        'rarity', rarity_code,
        'rarity_label', rarity_label,
        'item_type', type_code,
        'item_type_label', item_type_label,
        'image_url', image_url,
        'display_probability', trim(trailing '.' from trim(trailing '0' from to_char(probability_bps::numeric / 100, 'FM999999990.00'))) || '%',
        'probability_bps', probability_bps,
        'remaining_stock', stock_remaining,
        'is_limited', stock_remaining is not null,
        'is_pity_eligible', is_pity_eligible,
        'is_featured', is_featured
      )
      order by sort_order asc, pool_item_id asc
    ),
    '[]'::jsonb
  )
  into v_items
  from reward_rows;

  select jsonb_build_object(
    'threshold', pr.threshold,
    'target_rarity', pr.target_rarity_code,
    'description', '累计未命中达到 ' || pr.threshold || ' 次后，保底 ' || pr.target_rarity_code || '。'
  )
  into v_pity_rule
  from gacha.pity_rules pr
  where pr.box_id = v_box.id
    and pr.pool_version_id = v_pool.id
    and pr.active = true
  order by pr.priority asc
  limit 1;

  return jsonb_build_object(
    'box_id', v_box.id,
    'box_slug', v_box.slug,
    'box_name', v_box.display_name,
    'box_status', v_box.status,
    'pool_version_id', v_pool.id,
    'pool_version', v_pool.version_no,
    'items', v_items,
    'pity_rule', v_pity_rule,
    'generated_at', now()
  );
end;
$$;

revoke execute on function api.get_user_asset_balances(uuid) from public, anon, authenticated;
revoke execute on function api.gacha_list_boxes(uuid, text[], text, integer) from public, anon, authenticated;
revoke execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean) from public, anon, authenticated;

grant execute on function api.get_user_asset_balances(uuid) to service_role;
grant execute on function api.gacha_list_boxes(uuid, text[], text, integer) to service_role;
grant execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean) to service_role;
