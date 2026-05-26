-- inventory_list_user_items.sql
-- ============================================================
-- Lists the current user's inventory items for the first-stage collection page.
-- Defaults to available items only, while allowing backend callers to request
-- explicit status sets for debugging or later UI states.

create or replace function api.inventory_list_user_items(
  p_user_id uuid,
  p_statuses text[] default array['available']::text[],
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_statuses text[] := coalesce(nullif(p_statuses, array[]::text[]), array['available']::text[]);
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


-- ============================================================
