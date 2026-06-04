begin;

create or replace function api.inventory_get_collection_summary(
  p_user_id uuid,
  p_statuses text[] default array['available', 'listed', 'minting', 'minted']::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statuses text[] := coalesce(
    nullif(p_statuses, array[]::text[]),
    array['available', 'listed', 'minting', 'minted']::text[]
  );
  v_total integer;
  v_group_total integer;
  v_summary jsonb;
  v_groups jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with filtered_items as (
    select
      ii.id,
      ii.owner_user_id,
      ii.template_id,
      ii.form_id,
      ii.serial_no,
      ii.level,
      ii.power,
      ii.status,
      ii.nft_mint_status,
      ii.source_type,
      ii.source_id,
      ii.acquired_at,
      ii.lock_version,
      exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      ) as has_active_lock
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = any(v_statuses)
  ),
  summary_counts as (
    select
      count(*)::integer as total_count,
      count(*) filter (where status = 'available')::integer as available_count,
      count(*) filter (where status = 'listed')::integer as listed_count,
      count(*) filter (where status = 'locked' or has_active_lock)::integer as locked_count,
      count(*) filter (where status = 'minting' or nft_mint_status in ('queued', 'minting'))::integer as minting_count,
      count(*) filter (where status = 'minted' or nft_mint_status = 'minted')::integer as minted_count
    from filtered_items
  ),
  group_counts as (
    select
      fi.template_id,
      fi.form_id,
      count(*)::integer as owned_count,
      count(*) filter (where fi.status = 'available')::integer as available_count,
      count(*) filter (where fi.status = 'listed')::integer as listed_count,
      count(*) filter (where fi.status = 'locked' or fi.has_active_lock)::integer as locked_count,
      count(*) filter (where fi.status = 'minting' or fi.nft_mint_status in ('queued', 'minting'))::integer as minting_count,
      count(*) filter (where fi.status = 'minted' or fi.nft_mint_status = 'minted')::integer as minted_count,
      max(fi.level)::integer as max_level,
      max(fi.power)::integer as max_power,
      max(fi.acquired_at) as latest_obtained_at
    from filtered_items fi
    group by fi.template_id, fi.form_id
  ),
  representative_ranked as (
    select
      fi.*,
      row_number() over (
        partition by fi.template_id, coalesce(fi.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
        order by
          case
            when fi.status = 'available'
              and not fi.has_active_lock
              and fi.nft_mint_status not in ('queued', 'minting') then 0
            when fi.status = 'available' then 1
            when fi.status = 'listed' then 2
            when fi.status = 'minting' then 3
            when fi.status = 'minted' then 4
            else 5
          end,
          fi.level desc,
          fi.power desc,
          fi.acquired_at desc,
          fi.serial_no desc
      ) as representative_rank
    from filtered_items fi
  ),
  representative_rows as (
    select
      rr.id,
      rr.template_id,
      rr.form_id,
      rr.serial_no,
      rr.level,
      rr.power,
      rr.status,
      rr.nft_mint_status,
      rr.source_type,
      rr.source_id,
      rr.acquired_at,
      rr.lock_version,
      ct.slug as template_slug,
      ct.display_name,
      ct.subtitle,
      ct.description,
      ct.rarity_code,
      ct.type_code,
      ct.tradeable,
      ct.upgradeable,
      ct.evolvable,
      ct.decomposable,
      ct.nft_mintable,
      r.display_name as rarity_display_name,
      r.sort_order as rarity_sort_order,
      s.id as series_id,
      s.slug as series_slug,
      s.display_name as series_display_name,
      cf.form_index,
      cf.display_name as form_display_name,
      coalesce(cf.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as image_url,
      coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url) as thumbnail_url,
      coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url, cm_card.url) as avatar_url
    from representative_ranked rr
    join catalog.collectible_templates ct on ct.id = rr.template_id
    join catalog.rarities r on r.code = ct.rarity_code
    left join catalog.series s on s.id = ct.series_id
    left join catalog.collectible_forms cf on cf.id = rr.form_id
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = rr.form_id)
        and m.media_type = 'card'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_card on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = rr.form_id)
        and m.media_type = 'hero'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_hero on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = rr.form_id)
        and m.media_type = 'thumb'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_thumb on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = rr.form_id)
        and m.media_type = 'avatar'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_avatar on true
    where rr.representative_rank = 1
  ),
  grouped_payload as (
    select
      gc.template_id as group_template_id,
      gc.form_id as group_form_id,
      gc.owned_count,
      gc.available_count,
      gc.listed_count,
      gc.locked_count,
      gc.minting_count,
      gc.minted_count,
      gc.max_level,
      gc.max_power,
      gc.latest_obtained_at,
      jsonb_build_object(
        'item_instance_id', rr.id,
        'template_id', rr.template_id,
        'template_slug', rr.template_slug,
        'name', rr.display_name,
        'subtitle', rr.subtitle,
        'description', rr.description,
        'rarity', jsonb_build_object(
          'code', rr.rarity_code,
          'display_name', rr.rarity_display_name,
          'sort_order', rr.rarity_sort_order
        ),
        'series', jsonb_build_object(
          'id', rr.series_id,
          'slug', rr.series_slug,
          'display_name', rr.series_display_name
        ),
        'form', jsonb_build_object(
          'id', rr.form_id,
          'index', rr.form_index,
          'display_name', rr.form_display_name
        ),
        'type_code', rr.type_code,
        'serial_no', rr.serial_no,
        'level', rr.level,
        'power', rr.power,
        'status', rr.status,
        'nft_mint_status', rr.nft_mint_status,
        'item_version', rr.lock_version,
        'lock_version', rr.lock_version,
        'image_url', rr.image_url,
        'thumbnail_url', rr.thumbnail_url,
        'avatar_url', rr.avatar_url,
        'tradeable', rr.tradeable,
        'upgradeable', rr.upgradeable,
        'evolvable', rr.evolvable,
        'decomposable', rr.decomposable,
        'nft_mintable', rr.nft_mintable,
        'source_type', rr.source_type,
        'source_id', rr.source_id,
        'obtained_at', rr.acquired_at
      ) as representative_item
    from group_counts gc
    join representative_rows rr
      on rr.template_id = gc.template_id
     and coalesce(rr.form_id, '00000000-0000-0000-0000-000000000000'::uuid) =
         coalesce(gc.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  select
    coalesce(max(sc.total_count), 0)::integer,
    coalesce(count(gp.group_template_id), 0)::integer,
    jsonb_build_object(
      'total_count', coalesce(max(sc.total_count), 0),
      'available_count', coalesce(max(sc.available_count), 0),
      'listed_count', coalesce(max(sc.listed_count), 0),
      'locked_count', coalesce(max(sc.locked_count), 0),
      'minting_count', coalesce(max(sc.minting_count), 0),
      'minted_count', coalesce(max(sc.minted_count), 0),
      'group_count', coalesce(count(gp.group_template_id), 0)
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'group_key', 'template:' || gp.group_template_id::text || ':form:' || coalesce(gp.group_form_id::text, 'default-form'),
          'template_id', gp.group_template_id,
          'form_id', gp.group_form_id,
          'owned_count', gp.owned_count,
          'available_count', gp.available_count,
          'listed_count', gp.listed_count,
          'locked_count', gp.locked_count,
          'minting_count', gp.minting_count,
          'minted_count', gp.minted_count,
          'max_level', gp.max_level,
          'max_power', gp.max_power,
          'latest_obtained_at', gp.latest_obtained_at,
          'representative_item', gp.representative_item
        )
        order by gp.latest_obtained_at desc, gp.max_power desc, gp.group_template_id, gp.group_form_id
      ) filter (where gp.group_template_id is not null),
      '[]'::jsonb
    )
  into v_total, v_group_total, v_summary, v_groups
  from summary_counts sc
  left join grouped_payload gp on true;

  return jsonb_build_object(
    'groups', v_groups,
    'total', v_total,
    'group_total', v_group_total,
    'summary', v_summary,
    'statuses', v_statuses,
    'server_time', now()
  );
end;
$$;

revoke execute on function api.inventory_get_collection_summary(uuid, text[]) from public, anon, authenticated;
grant execute on function api.inventory_get_collection_summary(uuid, text[]) to service_role;

commit;
