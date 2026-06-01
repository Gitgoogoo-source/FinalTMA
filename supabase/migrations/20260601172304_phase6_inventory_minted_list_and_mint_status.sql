-- Keep collection inventory visible after Mint and expose all supported Mint
-- queue states in item detail.

create or replace function api.inventory_list_user_items(
  p_user_id uuid,
  p_statuses text[] default array['available', 'minting', 'minted']::text[],
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statuses text[] := coalesce(nullif(p_statuses, array[]::text[]), array['available', 'minting', 'minted']::text[]);
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_items jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with filtered as (
    select ii.id
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = any(v_statuses)
  )
  select count(*)::integer into v_total
  from filtered;

  with filtered as (
    select
      ii.id,
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
    from inventory.item_instances ii
    join catalog.collectible_templates ct on ct.id = ii.template_id
    join catalog.rarities r on r.code = ct.rarity_code
    left join catalog.series s on s.id = ct.series_id
    left join catalog.collectible_forms cf on cf.id = ii.form_id
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'card'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_card on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'hero'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_hero on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'thumb'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_thumb on true
    left join lateral (
      select url
      from catalog.collectible_media m
      where m.template_id = ct.id
        and (m.form_id is null or m.form_id = ii.form_id)
        and m.media_type = 'avatar'
      order by m.form_id nulls last, m.sort_order asc
      limit 1
    ) cm_avatar on true
    where ii.owner_user_id = p_user_id
      and ii.status = any(v_statuses)
    order by ii.acquired_at desc, ii.serial_no desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_instance_id', id,
    'template_id', template_id,
    'template_slug', template_slug,
    'name', display_name,
    'subtitle', subtitle,
    'description', description,
    'rarity', jsonb_build_object(
      'code', rarity_code,
      'display_name', rarity_display_name,
      'sort_order', rarity_sort_order
    ),
    'series', jsonb_build_object(
      'id', series_id,
      'slug', series_slug,
      'display_name', series_display_name
    ),
    'form', jsonb_build_object(
      'id', form_id,
      'index', form_index,
      'display_name', form_display_name
    ),
    'type_code', type_code,
    'serial_no', serial_no,
    'level', level,
    'power', power,
    'status', status,
    'nft_mint_status', nft_mint_status,
    'image_url', image_url,
    'thumbnail_url', thumbnail_url,
    'avatar_url', avatar_url,
    'tradeable', tradeable,
    'upgradeable', upgradeable,
    'evolvable', evolvable,
    'decomposable', decomposable,
    'nft_mintable', nft_mintable,
    'source_type', source_type,
    'source_id', source_id,
    'obtained_at', acquired_at
  ) order by acquired_at desc, serial_no desc), '[]'::jsonb)
  into v_items
  from filtered;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'statuses', v_statuses,
    'server_time', now()
  );
end;
$$;

create or replace function api.inventory_get_item_detail(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_include_market_status boolean default true,
  p_include_upgrade_preview boolean default true,
  p_include_evolution_preview boolean default true,
  p_include_decompose_preview boolean default true,
  p_include_onchain_status boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_active_lock jsonb;
  v_market_status jsonb;
  v_onchain_status jsonb;
  v_upgrade_preview jsonb;
  v_evolution_preview jsonb;
  v_decompose_preview jsonb;
  v_same_item_count integer;
  v_available_same_item_count integer;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

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
    ii.updated_at,
    ii.metadata as item_metadata,
    ct.slug as template_slug,
    ct.display_name,
    ct.subtitle,
    ct.description,
    ct.rarity_code,
    ct.type_code,
    ct.base_power,
    ct.tradeable,
    ct.upgradeable,
    ct.evolvable,
    ct.decomposable,
    ct.nft_mintable,
    ct.metadata as template_metadata,
    r.display_name as rarity_display_name,
    r.sort_order as rarity_sort_order,
    s.id as series_id,
    s.slug as series_slug,
    s.display_name as series_display_name,
    f.id as faction_id,
    f.slug as faction_slug,
    f.display_name as faction_display_name,
    cf.form_index,
    cf.display_name as form_display_name,
    cf.description as form_description,
    coalesce(cf.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as image_url,
    coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url) as thumbnail_url,
    coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url, cm_card.url) as avatar_url
  into v_item
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  join catalog.rarities r on r.code = ct.rarity_code
  left join catalog.series s on s.id = ct.series_id
  left join catalog.factions f on f.id = ct.faction_id
  left join catalog.collectible_forms cf on cf.id = ii.form_id
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = ct.id
      and (m.form_id is null or m.form_id = ii.form_id)
      and m.media_type = 'card'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_card on true
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = ct.id
      and (m.form_id is null or m.form_id = ii.form_id)
      and m.media_type = 'hero'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_hero on true
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = ct.id
      and (m.form_id is null or m.form_id = ii.form_id)
      and m.media_type = 'thumb'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_thumb on true
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = ct.id
      and (m.form_id is null or m.form_id = ii.form_id)
      and m.media_type = 'avatar'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_avatar on true
  where ii.id = p_item_instance_id;

  if not found then
    raise exception 'item not found';
  end if;

  if v_item.owner_user_id is distinct from p_user_id then
    raise exception 'not item owner';
  end if;

  select jsonb_build_object(
    'lock_id', il.id,
    'reason', il.lock_type,
    'source_type', il.source_type,
    'source_id', il.source_id,
    'locked_at', il.locked_at,
    'expires_at', il.expires_at
  )
  into v_active_lock
  from inventory.inventory_locks il
  where il.item_instance_id = p_item_instance_id
    and il.status = 'active'
    and (il.expires_at is null or il.expires_at > now())
  order by il.locked_at desc
  limit 1;

  select count(*)::integer
  into v_same_item_count
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and ii.template_id = v_item.template_id
    and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select count(*)::integer
  into v_available_same_item_count
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and ii.template_id = v_item.template_id
    and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ii.status = 'available'
    and not exists (
      select 1
      from inventory.inventory_locks il
      where il.item_instance_id = ii.id
        and il.status = 'active'
        and (il.expires_at is null or il.expires_at > now())
    );

  if p_include_market_status then
    select jsonb_build_object(
      'is_listed', true,
      'listing_id', l.id,
      'unit_price', l.unit_price_kcoin,
      'currency', 'KCOIN'
    )
    into v_market_status
    from market.listing_items li
    join market.listings l on l.id = li.listing_id
    where li.item_instance_id = p_item_instance_id
      and li.status = 'reserved'
      and l.status in ('active', 'partially_sold')
    order by l.created_at desc
    limit 1;

    v_market_status := coalesce(
      v_market_status,
      jsonb_build_object('is_listed', false, 'listing_id', null, 'unit_price', null, 'currency', null)
    );
  end if;

  if p_include_onchain_status then
    select jsonb_build_object(
      'is_minted', ni.id is not null and ni.status = 'minted',
      'mint_status', case
        when ni.status = 'minted' then 'minted'
        when mq.status in (
          'queued',
          'processing',
          'submitted',
          'confirming',
          'retrying',
          'manual_review',
          'minted',
          'failed',
          'cancelled'
        ) then mq.status
        else 'none'
      end,
      'nft_item_address', ni.item_address,
      'owner_wallet_address', ni.owner_address
    )
    into v_onchain_status
    from inventory.item_instances ii
    left join onchain.nft_items ni on ni.id = ii.minted_nft_item_id or ni.item_instance_id = ii.id
    left join lateral (
      select status
      from onchain.mint_queue queue_row
      where queue_row.item_instance_id = ii.id
      order by queue_row.created_at desc
      limit 1
    ) mq on true
    where ii.id = p_item_instance_id;
  end if;

  if p_include_upgrade_preview then
    v_upgrade_preview := api.inventory_get_upgrade_preview(p_user_id, p_item_instance_id, null);
  end if;

  if p_include_evolution_preview then
    v_evolution_preview := api.inventory_get_evolution_preview(p_user_id, array[p_item_instance_id]::uuid[], null);
  end if;

  if p_include_decompose_preview then
    v_decompose_preview := api.inventory_get_decompose_preview(p_user_id, array[p_item_instance_id]::uuid[]);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'item_instance_id', v_item.id,
    'template_id', v_item.template_id,
    'template_slug', v_item.template_slug,
    'form_id', v_item.form_id,
    'serial_no', v_item.serial_no,
    'name', v_item.display_name,
    'subtitle', v_item.subtitle,
    'description', v_item.description,
    'rarity', jsonb_build_object(
      'code', v_item.rarity_code,
      'display_name', v_item.rarity_display_name,
      'sort_order', v_item.rarity_sort_order
    ),
    'type_code', v_item.type_code,
    'series', jsonb_build_object(
      'id', v_item.series_id,
      'slug', v_item.series_slug,
      'display_name', v_item.series_display_name
    ),
    'faction', jsonb_build_object(
      'id', v_item.faction_id,
      'slug', v_item.faction_slug,
      'display_name', v_item.faction_display_name
    ),
    'form', jsonb_build_object(
      'id', v_item.form_id,
      'index', v_item.form_index,
      'display_name', v_item.form_display_name,
      'description', v_item.form_description
    ),
    'level', v_item.level,
    'power', v_item.power,
    'base_power', v_item.base_power,
    'status', v_item.status,
    'nft_mint_status', v_item.nft_mint_status,
    'image_url', v_item.image_url,
    'thumbnail_url', v_item.thumbnail_url,
    'avatar_url', v_item.avatar_url,
    'is_tradeable', v_item.tradeable,
    'is_upgradeable', v_item.upgradeable,
    'is_evolvable', v_item.evolvable,
    'is_decomposable', v_item.decomposable,
    'is_mintable', v_item.nft_mintable,
    'source_type', v_item.source_type,
    'source_id', v_item.source_id,
    'obtained_at', v_item.acquired_at,
    'updated_at', v_item.updated_at,
    'attributes', coalesce(v_item.item_metadata -> 'attributes', v_item.template_metadata -> 'attributes', '{}'::jsonb),
    'active_lock', v_active_lock,
    'market_status', v_market_status,
    'onchain_status', v_onchain_status,
    'upgrade_preview', v_upgrade_preview,
    'evolution_preview', v_evolution_preview,
    'decompose_preview', v_decompose_preview,
    'same_item_count', v_same_item_count,
    'available_same_item_count', v_available_same_item_count
  ));
end;
$$;

revoke execute on function api.inventory_list_user_items(uuid, text[], integer, integer) from public, anon, authenticated;
grant execute on function api.inventory_list_user_items(uuid, text[], integer, integer) to service_role;

revoke execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean) to service_role;
