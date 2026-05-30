-- Phase 6: keep the user-facing possible rewards endpoint scoped to live
-- drop pool versions only. Scheduled versions become readable only after
-- their effective_from has arrived, so frontend cache refreshes can tolerate
-- delayed publish/activation jobs without exposing drafts or archived pools.

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
    and (
      dpv.status = 'active'
      or (
        dpv.status = 'scheduled'
        and (dpv.effective_from is null or dpv.effective_from <= v_now)
      )
    )
    and (p_pool_version_id is null or dpv.id = p_pool_version_id)
    and (dpv.effective_from is null or dpv.effective_from <= v_now)
    and (dpv.effective_to is null or dpv.effective_to > v_now)
  order by
    case when dpv.status = 'scheduled' then 0 else 1 end,
    dpv.effective_from desc nulls last,
    dpv.version_no desc
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

revoke execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;

grant execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean)
  to service_role;
