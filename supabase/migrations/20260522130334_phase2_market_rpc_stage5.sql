-- Phase 2 marketplace RPC stage 5.
-- Scope: complete marketplace read RPCs, require expected-price/idempotency on
-- market write RPCs, and add price/depth refresh support.

create or replace function api._market_price_health(
  p_template_id uuid,
  p_form_id uuid,
  p_rarity_code text,
  p_unit_price_kcoin numeric
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_floor_price numeric(38,0);
  v_min_ratio numeric(10,4) := 0.5000;
  v_max_ratio numeric(10,4) := 2.0000;
begin
  if p_unit_price_kcoin is null or p_unit_price_kcoin <= 0 then
    return 'unknown';
  end if;

  select ps.floor_price_kcoin
    into v_floor_price
  from market.price_snapshots ps
  where ps.template_id = p_template_id
    and ps.form_id is not distinct from p_form_id
  order by ps.snapshot_at desc
  limit 1;

  if v_floor_price is null or v_floor_price <= 0 then
    return 'unknown';
  end if;

  select phr.min_ratio_to_floor, phr.max_ratio_to_floor
    into v_min_ratio, v_max_ratio
  from market.price_health_rules phr
  where phr.active = true
    and (phr.template_id is null or phr.template_id = p_template_id)
    and (phr.rarity_code is null or phr.rarity_code = p_rarity_code)
  order by
    case when phr.template_id = p_template_id then 0 else 1 end,
    case when phr.rarity_code = p_rarity_code then 0 else 1 end,
    phr.created_at desc
  limit 1;

  v_min_ratio := coalesce(v_min_ratio, 0.5000);
  v_max_ratio := coalesce(v_max_ratio, 2.0000);

  if p_unit_price_kcoin < floor(v_floor_price * v_min_ratio) then
    return 'too_low';
  end if;

  if p_unit_price_kcoin > ceiling(v_floor_price * v_max_ratio) then
    return 'too_high';
  end if;

  return 'healthy';
end;
$$;

create or replace function api.market_list_listings(
  p_user_id uuid default null,
  p_rarities text[] default null,
  p_type_codes text[] default null,
  p_series_ids uuid[] default null,
  p_template_ids uuid[] default null,
  p_min_price numeric default null,
  p_max_price numeric default null,
  p_sort text default 'recently_listed',
  p_limit integer default 24,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_items jsonb;
  v_next_cursor text;
begin
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
      l.price_health,
      l.expires_at,
      l.created_at,
      t.display_name as template_name,
      t.type_code,
      t.series_id,
      r.sort_order as rarity_sort_order,
      coalesce(f.display_name, t.display_name) as item_name,
      coalesce(f.thumbnail_url, f.image_url, f.avatar_url, media.url) as image_url,
      coalesce(up.display_name, nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.username::text) as seller_display_name
    from market.listings l
    join catalog.collectible_templates t on t.id = l.template_id
    join catalog.rarities r on r.code = l.rarity_code
    left join catalog.collectible_forms f on f.id = l.form_id
    left join core.users u on u.id = l.seller_user_id
    left join core.user_profiles up on up.user_id = l.seller_user_id
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
    where l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
      and (p_cursor is null or p_sort <> 'recently_listed' or l.created_at < p_cursor::timestamptz)
      and (p_min_price is null or l.unit_price_kcoin >= p_min_price)
      and (p_max_price is null or l.unit_price_kcoin <= p_max_price)
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
      and (p_series_ids is null or t.series_id = any(p_series_ids))
      and (p_template_ids is null or l.template_id = any(p_template_ids))
  ),
  ordered as (
    select
      base.*,
      row_number() over (
        order by
          case when p_sort = 'price_low_to_high' then base.unit_price_kcoin end asc,
          case when p_sort = 'price_high_to_low' then base.unit_price_kcoin end desc,
          case when p_sort = 'rarity_high_to_low' then base.rarity_sort_order end desc,
          base.created_at desc,
          base.listing_id desc
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
          'status', status,
          'seller_display_name', seller_display_name,
          'is_own_listing', p_user_id is not null and seller_user_id = p_user_id,
          'is_buyable', p_user_id is null or seller_user_id <> p_user_id,
          'not_buyable_reason', case
            when p_user_id is not null and seller_user_id = p_user_id then 'own_listing'
            else null
          end,
          'price_health', coalesce(price_health, 'unknown'),
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

create or replace function api.market_get_listing_detail(
  p_user_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing jsonb;
begin
  select jsonb_build_object(
    'listing_id', l.id,
    'seller_user_id', l.seller_user_id,
    'template_id', l.template_id,
    'form_id', l.form_id,
    'name', coalesce(f.display_name, t.display_name),
    'description', coalesce(f.description, t.description),
    'rarity', lower(l.rarity_code),
    'type_code', lower(t.type_code),
    'image_url', coalesce(f.image_url, f.thumbnail_url, f.avatar_url, media.url),
    'seller', jsonb_build_object(
      'user_id', l.seller_user_id,
      'display_name', coalesce(up.display_name, nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.username::text),
      'avatar_url', coalesce(up.avatar_url, u.photo_url)
    ),
    'seller_display_name', coalesce(up.display_name, nullif(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.username::text),
    'unit_price_kcoin', l.unit_price_kcoin,
    'currency_code', 'KCOIN',
    'item_count', l.item_count,
    'remaining_count', l.remaining_count,
    'status', l.status,
    'floor_price_kcoin', ps.floor_price_kcoin,
    'avg_price_kcoin', ps.avg_price_kcoin,
    'last_sale_price_kcoin', ps.last_sale_price_kcoin,
    'reference_price_kcoin', coalesce(ps.floor_price_kcoin, ps.avg_price_kcoin, ps.last_sale_price_kcoin),
    'active_listing_count', coalesce(ps.active_listing_count, 0),
    'sale_count_24h', coalesce(ps.sale_count_24h, 0),
    'volume_24h_kcoin', coalesce(ps.volume_24h_kcoin, 0),
    'snapshot_at', ps.snapshot_at,
    'price_health', coalesce(l.price_health, api._market_price_health(l.template_id, l.form_id, l.rarity_code, l.unit_price_kcoin), 'unknown'),
    'market_depth', coalesce(depth.items, '[]'::jsonb),
    'item_instance_ids', coalesce(items.item_instance_ids, '[]'::jsonb),
    'is_own_listing', p_user_id is not null and l.seller_user_id = p_user_id,
    'can_buy', l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
      and (p_user_id is null or l.seller_user_id <> p_user_id),
    'is_buyable', l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
      and (p_user_id is null or l.seller_user_id <> p_user_id),
    'disabled_reason', case
      when l.id is null then 'listing_not_found'
      when l.status not in ('active', 'partially_sold') then 'listing_not_buyable'
      when l.remaining_count <= 0 then 'listing_sold_out'
      when p_user_id is not null and l.seller_user_id = p_user_id then 'own_listing'
      else null
    end,
    'not_buyable_reason', case
      when l.status not in ('active', 'partially_sold') then 'listing_not_buyable'
      when l.remaining_count <= 0 then 'listing_sold_out'
      when p_user_id is not null and l.seller_user_id = p_user_id then 'own_listing'
      else null
    end,
    'created_at', l.created_at,
    'expires_at', l.expires_at
  )
    into v_listing
  from market.listings l
  join catalog.collectible_templates t on t.id = l.template_id
  left join catalog.collectible_forms f on f.id = l.form_id
  left join core.users u on u.id = l.seller_user_id
  left join core.user_profiles up on up.user_id = l.seller_user_id
  left join lateral (
    select cm.url
    from catalog.collectible_media cm
    where cm.template_id = t.id
      and (cm.form_id is not distinct from l.form_id or cm.form_id is null)
      and cm.media_type in ('card', 'hero', 'thumb', 'avatar')
    order by
      case when cm.form_id is not distinct from l.form_id then 0 else 1 end,
      case cm.media_type when 'card' then 0 when 'hero' then 1 when 'thumb' then 2 else 3 end,
      cm.sort_order asc,
      cm.created_at desc
    limit 1
  ) media on true
  left join lateral (
    select ps.*
    from market.price_snapshots ps
    where ps.template_id = l.template_id
      and ps.form_id is not distinct from l.form_id
    order by ps.snapshot_at desc
    limit 1
  ) ps on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'price_kcoin', d.price_bucket_kcoin,
        'listing_count', d.listing_count,
        'item_count', d.item_count
      )
      order by d.price_bucket_kcoin asc
    ) as items
    from market.depth_snapshots d
    where d.template_id = l.template_id
      and d.form_id is not distinct from l.form_id
      and d.snapshot_at = (
        select max(d2.snapshot_at)
        from market.depth_snapshots d2
        where d2.template_id = l.template_id
          and d2.form_id is not distinct from l.form_id
      )
  ) depth on true
  left join lateral (
    select jsonb_agg(li.item_instance_id order by li.created_at asc) as item_instance_ids
    from market.listing_items li
    where li.listing_id = l.id
      and li.status = 'reserved'
  ) items on true
  where l.id = p_listing_id;

  if v_listing is null then
    raise exception 'listing not found';
  end if;

  return jsonb_build_object('listing', v_listing);
end;
$$;

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
  v_items jsonb;
  v_next_cursor text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
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
      and (p_cursor is null or p_sort <> 'recently_obtained' or ii.acquired_at < p_cursor::timestamptz)
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
  grouped as (
    select
      template_id,
      form_id,
      max(item_name) as name,
      max(rarity_code) as rarity_code,
      max(type_code) as type_code,
      (array_agg(series_id order by acquired_at desc, item_instance_id desc))[1] as series_id,
      max(rarity_sort_order) as rarity_sort_order,
      max(image_url) as image_url,
      count(*)::integer as owned_count,
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
  ordered as (
    select
      grouped.*,
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
          template_id desc
      ) as rn
    from grouped
  ),
  page as (
    select *
    from ordered
    where rn <= v_limit
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
    (
      select ordered.acquired_at::text
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

create or replace function api.market_create_listing(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_rarity_code text;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_active_lock_count integer;
  v_fee_bps integer;
  v_fee_amount numeric(38,0);
  v_expected_net numeric(38,0);
  v_listing_id uuid := gen_random_uuid();
  v_existing_listing_id uuid;
  v_existing_user_id uuid;
  v_existing_status text;
  v_existing_event_type text;
  v_existing_hash text;
  v_request_hash text;
  v_price_health text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_item_instance_ids is null or cardinality(p_item_instance_ids) = 0 then
    raise exception 'item_instance_ids are required';
  end if;
  if p_unit_price_kcoin is null or p_unit_price_kcoin <= 0 then
    raise exception 'unit price must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('market_create_listing'), hashtext(p_idempotency_key));

  select md5(string_agg(x.item_id::text, ',' order by x.item_id::text) || ':' || p_unit_price_kcoin::text)
    into v_request_hash
  from unnest(p_item_instance_ids) as x(item_id);

  select l.id, e.user_id, l.status, e.event_type, e.metadata ->> 'request_hash'
    into v_existing_listing_id, v_existing_user_id, v_existing_status, v_existing_event_type, v_existing_hash
  from market.listings l
  join market.listing_events e on e.listing_id = l.id
  where e.metadata ->> 'idempotency_key' = p_idempotency_key
  order by e.created_at desc, e.id desc
  limit 1;

  if v_existing_listing_id is not null then
    if v_existing_event_type <> 'created'
       or v_existing_user_id is distinct from p_user_id then
      raise exception 'idempotency conflict';
    end if;

    if v_existing_hash is not null and v_existing_hash <> v_request_hash then
      raise exception 'idempotency conflict';
    end if;

    return jsonb_build_object(
      'listing_id', v_existing_listing_id,
      'status', v_existing_status,
      'idempotent', true
    );
  end if;

  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> cardinality(p_item_instance_ids) then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  for update;

  perform 1
  from inventory.inventory_locks il
  where il.item_instance_id = any(p_item_instance_ids)
    and il.status = 'active'
  for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    (array_agg(distinct t.rarity_code))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (
      where ii.owner_user_id is distinct from p_user_id
         or ii.status <> 'available'
         or ii.nft_mint_status in ('queued', 'minting')
         or t.tradeable is distinct from true
    )::integer
  into v_item_count, v_template_id, v_form_id, v_rarity_code, v_distinct_templates, v_distinct_forms, v_bad_count
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_item_count <> cardinality(p_item_instance_ids) then
    raise exception 'some items do not exist';
  end if;
  if v_bad_count > 0 then
    raise exception 'some items are not sellable';
  end if;

  select count(*)::integer
    into v_active_lock_count
  from inventory.inventory_locks il
  where il.item_instance_id = any(p_item_instance_ids)
    and il.status = 'active';

  if coalesce(v_active_lock_count, 0) > 0 then
    raise exception 'some items are already locked';
  end if;

  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'one listing must contain the same collectible and form';
  end if;

  select fee_bps
    into v_fee_bps
  from economy.fee_rules
  where fee_type = 'market_sell'
    and currency_code = 'KCOIN'
    and active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  order by created_at desc
  limit 1;

  v_fee_bps := coalesce(v_fee_bps, 500);
  v_fee_amount := floor((p_unit_price_kcoin * v_item_count) * v_fee_bps / 10000);
  v_expected_net := (p_unit_price_kcoin * v_item_count) - v_fee_amount;
  v_price_health := api._market_price_health(v_template_id, v_form_id, v_rarity_code, p_unit_price_kcoin);

  insert into market.listings (
    id, seller_user_id, template_id, form_id, rarity_code, status,
    item_count, remaining_count, unit_price_kcoin, fee_bps, expected_net_amount,
    price_health, last_price_changed_at
  ) values (
    v_listing_id, p_user_id, v_template_id, v_form_id, v_rarity_code, 'active',
    v_item_count, v_item_count, p_unit_price_kcoin, v_fee_bps, v_expected_net,
    v_price_health, now()
  );

  insert into market.listing_items (listing_id, item_instance_id, status)
  select v_listing_id, x.id, 'reserved'
  from unnest(p_item_instance_ids) as x(id);

  insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, source_id)
  select x.id, p_user_id, 'market_listing', 'market_listing', v_listing_id
  from unnest(p_item_instance_ids) as x(id);

  update inventory.item_instances
  set status = 'listed', updated_at = now(), lock_version = lock_version + 1
  where id = any(p_item_instance_ids);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_user_id, 'listed', 'market_listing', v_listing_id,
         jsonb_build_object('listing_id', v_listing_id, 'unit_price_kcoin', p_unit_price_kcoin)
  from unnest(p_item_instance_ids) as x(id);

  insert into market.listing_events (listing_id, user_id, event_type, after_state, metadata)
  values (
    v_listing_id, p_user_id, 'created',
    jsonb_build_object('unit_price_kcoin', p_unit_price_kcoin, 'item_count', v_item_count),
    jsonb_build_object(
      'idempotency_key', p_idempotency_key,
      'request_hash', v_request_hash,
      'item_instance_ids', to_jsonb(p_item_instance_ids),
      'unit_price_kcoin', p_unit_price_kcoin
    )
  );

  return jsonb_build_object(
    'listing_id', v_listing_id,
    'status', 'active',
    'item_count', v_item_count,
    'remaining_count', v_item_count,
    'unit_price_kcoin', p_unit_price_kcoin,
    'fee_bps', v_fee_bps,
    'expected_net_amount', v_expected_net,
    'price_health', v_price_health,
    'idempotent', false
  );
end;
$$;

drop function if exists api.market_buy_listing(uuid, uuid, integer, text);

create or replace function api.market_buy_listing(
  p_buyer_user_id uuid,
  p_listing_id uuid,
  p_quantity integer,
  p_expected_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_order market.orders%rowtype;
  v_listing market.listings%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_listing_item_ids uuid[];
  v_item_ids uuid[];
  v_purchased_items jsonb;
  v_total numeric(38,0);
  v_fee numeric(38,0);
  v_net numeric(38,0);
  v_debit jsonb;
  v_credit jsonb;
  v_remaining_after integer;
  v_status_after text;
  v_expected_net_after numeric(38,0);
  v_locked_item_count integer;
  v_valid_item_count integer;
  v_active_lock_count integer;
  v_updated_count integer;
begin
  if p_buyer_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_quantity is distinct from 1 then
    raise exception 'quantity must be 1';
  end if;
  if p_expected_unit_price_kcoin is null or p_expected_unit_price_kcoin <= 0 then
    raise exception 'expected_unit_price_kcoin is required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('market_buy_listing'), hashtext(p_idempotency_key));

  select * into v_existing_order
  from market.orders
  where idempotency_key = p_idempotency_key;

  if v_existing_order.id is not null then
    if v_existing_order.buyer_user_id is distinct from p_buyer_user_id
       or v_existing_order.listing_id is distinct from p_listing_id
       or v_existing_order.item_count is distinct from p_quantity
       or v_existing_order.unit_price_kcoin is distinct from p_expected_unit_price_kcoin then
      raise exception 'idempotency conflict';
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_instance_id', oi.item_instance_id,
          'template_id', ii.template_id,
          'form_id', ii.form_id
        )
        order by oi.created_at asc
      ),
      '[]'::jsonb
    )
      into v_purchased_items
    from market.order_items oi
    join inventory.item_instances ii on ii.id = oi.item_instance_id
    where oi.order_id = v_existing_order.id;

    return jsonb_build_object(
      'order_id', v_existing_order.id,
      'listing_id', v_existing_order.listing_id,
      'purchased_items', v_purchased_items,
      'total_price_kcoin', v_existing_order.total_price_kcoin,
      'fee_amount_kcoin', v_existing_order.fee_amount_kcoin,
      'seller_net_amount_kcoin', v_existing_order.seller_net_amount_kcoin,
      'buyer_balance_after', coalesce((
        select available_amount
        from economy.user_balances
        where user_id = p_buyer_user_id and currency_code = 'KCOIN'
      ), 0),
      'status', v_existing_order.status,
      'idempotent', true
    );
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing is not buyable';
  end if;
  if v_listing.remaining_count < p_quantity then
    raise exception 'listing sold out';
  end if;
  if v_listing.seller_user_id = p_buyer_user_id then
    raise exception 'buyer cannot buy own listing';
  end if;
  if v_listing.unit_price_kcoin <> p_expected_unit_price_kcoin then
    raise exception 'listing price changed';
  end if;

  select array_agg(id), array_agg(item_instance_id)
    into v_listing_item_ids, v_item_ids
  from (
    select id, item_instance_id
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    order by created_at asc
    limit p_quantity
    for update
  ) s;

  if v_item_ids is null or cardinality(v_item_ids) <> p_quantity then
    raise exception 'listing sold out';
  end if;

  with locked_items as (
    select ii.id, ii.owner_user_id, ii.status
    from inventory.item_instances ii
    where ii.id = any(v_item_ids)
    for update
  )
  select
    count(*)::integer,
    count(*) filter (
      where owner_user_id = v_listing.seller_user_id
        and status = 'listed'
    )::integer
    into v_locked_item_count, v_valid_item_count
  from locked_items;

  if v_locked_item_count <> p_quantity or v_valid_item_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  with locked_locks as (
    select il.id
    from inventory.inventory_locks il
    where il.item_instance_id = any(v_item_ids)
      and il.user_id = v_listing.seller_user_id
      and il.lock_type = 'market_listing'
      and il.source_type = 'market_listing'
      and il.source_id = p_listing_id
      and il.status = 'active'
    for update
  )
  select count(*)::integer
    into v_active_lock_count
  from locked_locks;

  if v_active_lock_count <> p_quantity then
    raise exception 'listing lock integrity violation';
  end if;

  v_total := v_listing.unit_price_kcoin * p_quantity;
  v_fee := floor(v_total * v_listing.fee_bps / 10000);
  v_net := v_total - v_fee;

  v_debit := api._debit_balance(
    p_buyer_user_id, 'KCOIN', v_total, 'market_buy', v_order_id, null,
    'market_buy:buyer:' || v_order_id::text, 'Buy market listing',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity)
  );

  insert into market.orders (
    id, buyer_user_id, seller_user_id, listing_id, status,
    item_count, unit_price_kcoin, total_price_kcoin, fee_bps,
    fee_amount_kcoin, seller_net_amount_kcoin, buyer_ledger_id,
    idempotency_key, completed_at
  ) values (
    v_order_id, p_buyer_user_id, v_listing.seller_user_id, p_listing_id, 'completed',
    p_quantity, v_listing.unit_price_kcoin, v_total, v_listing.fee_bps,
    v_fee, v_net, (v_debit ->> 'ledger_id')::uuid,
    p_idempotency_key, now()
  );

  v_credit := api._credit_balance(
    v_listing.seller_user_id, 'KCOIN', v_net, 'market_sell', v_order_id, null,
    'market_sell:seller:' || v_order_id::text, 'Marketplace sale proceeds',
    jsonb_build_object('listing_id', p_listing_id, 'quantity', p_quantity, 'fee_amount_kcoin', v_fee)
  );

  update market.orders
  set seller_ledger_id = (v_credit ->> 'ledger_id')::uuid,
      updated_at = now()
  where id = v_order_id;

  insert into market.order_items (order_id, listing_item_id, item_instance_id)
  select v_order_id, li.id, li.item_instance_id
  from market.listing_items li
  where li.id = any(v_listing_item_ids);

  update market.listing_items
  set status = 'sold', buyer_user_id = p_buyer_user_id, sold_order_id = v_order_id, sold_at = now()
  where id = any(v_listing_item_ids)
    and status = 'reserved';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  update inventory.item_instances
  set owner_user_id = p_buyer_user_id,
      status = 'available',
      source_type = 'market',
      source_id = v_order_id,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = any(v_item_ids)
    and owner_user_id = v_listing.seller_user_id
    and status = 'listed';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing item integrity violation';
  end if;

  update inventory.inventory_locks
  set status = 'consumed', released_at = now(), updated_at = now()
  where item_instance_id = any(v_item_ids)
    and user_id = v_listing.seller_user_id
    and lock_type = 'market_listing'
    and source_type = 'market_listing'
    and source_id = p_listing_id
    and status = 'active';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> p_quantity then
    raise exception 'listing lock integrity violation';
  end if;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, v_listing.seller_user_id, 'sold', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id, 'buyer_user_id', p_buyer_user_id)
  from unnest(v_item_ids) as x(id);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id, p_buyer_user_id, 'bought', 'market_order', v_order_id,
         jsonb_build_object('order_id', v_order_id, 'listing_id', p_listing_id, 'seller_user_id', v_listing.seller_user_id)
  from unnest(v_item_ids) as x(id);

  v_remaining_after := v_listing.remaining_count - p_quantity;
  v_status_after := case when v_remaining_after <= 0 then 'sold' else 'partially_sold' end;
  v_expected_net_after := (v_listing.unit_price_kcoin * v_remaining_after) - floor((v_listing.unit_price_kcoin * v_remaining_after) * v_listing.fee_bps / 10000);

  update market.listings
  set remaining_count = v_remaining_after,
      status = v_status_after,
      expected_net_amount = v_expected_net_after,
      updated_at = now()
  where id = p_listing_id;

  insert into market.fee_settlements (market_order_id, currency_code, fee_amount, fee_bps, status, settled_at)
  values (v_order_id, 'KCOIN', v_fee, v_listing.fee_bps, 'settled', now());

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state, metadata)
  values (
    p_listing_id, p_buyer_user_id, v_status_after,
    jsonb_build_object('remaining_count', v_listing.remaining_count, 'status', v_listing.status),
    jsonb_build_object('remaining_count', v_remaining_after, 'status', v_status_after, 'order_id', v_order_id),
    jsonb_build_object('idempotency_key', p_idempotency_key)
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_instance_id', ii.id,
        'template_id', ii.template_id,
        'form_id', ii.form_id
      )
      order by ii.id
    ),
    '[]'::jsonb
  )
    into v_purchased_items
  from inventory.item_instances ii
  where ii.id = any(v_item_ids);

  return jsonb_build_object(
    'order_id', v_order_id,
    'listing_id', p_listing_id,
    'purchased_items', v_purchased_items,
    'total_price_kcoin', v_total,
    'fee_amount_kcoin', v_fee,
    'seller_net_amount_kcoin', v_net,
    'buyer_balance_after', (v_debit ->> 'available')::numeric,
    'idempotent', false
  );
end;
$$;

drop function if exists api.market_update_listing_price(uuid, uuid, numeric);

create or replace function api.market_update_listing_price(
  p_user_id uuid,
  p_listing_id uuid,
  p_new_unit_price_kcoin numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_existing_event market.listing_events%rowtype;
  v_fee numeric(38,0);
  v_net numeric(38,0);
  v_price_health text;
begin
  if p_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_new_unit_price_kcoin is null or p_new_unit_price_kcoin <= 0 then
    raise exception 'new price must be positive';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('market_update_listing_price'), hashtext(p_idempotency_key));

  select * into v_existing_event
  from market.listing_events
  where metadata ->> 'idempotency_key' = p_idempotency_key
  order by created_at desc
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'price_changed'
       or v_existing_event.listing_id is distinct from p_listing_id
       or v_existing_event.user_id is distinct from p_user_id
       or (v_existing_event.metadata ->> 'new_unit_price_kcoin')::numeric is distinct from p_new_unit_price_kcoin then
      raise exception 'idempotency conflict';
    end if;

    select * into v_listing
    from market.listings
    where id = p_listing_id;

    return jsonb_build_object(
      'listing_id', p_listing_id,
      'unit_price_kcoin', v_listing.unit_price_kcoin,
      'expected_net_amount', v_listing.expected_net_amount,
      'price_health', coalesce(v_listing.price_health, 'unknown'),
      'status', v_listing.status,
      'idempotent', true
    );
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.seller_user_id <> p_user_id then
    raise exception 'not listing owner';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing is not editable';
  end if;

  v_fee := floor((p_new_unit_price_kcoin * v_listing.remaining_count) * v_listing.fee_bps / 10000);
  v_net := (p_new_unit_price_kcoin * v_listing.remaining_count) - v_fee;
  v_price_health := api._market_price_health(v_listing.template_id, v_listing.form_id, v_listing.rarity_code, p_new_unit_price_kcoin);

  update market.listings
  set unit_price_kcoin = p_new_unit_price_kcoin,
      expected_net_amount = v_net,
      price_health = v_price_health,
      last_price_changed_at = now(),
      updated_at = now()
  where id = p_listing_id;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state, metadata)
  values (
    p_listing_id, p_user_id, 'price_changed',
    jsonb_build_object('unit_price_kcoin', v_listing.unit_price_kcoin, 'expected_net_amount', v_listing.expected_net_amount),
    jsonb_build_object('unit_price_kcoin', p_new_unit_price_kcoin, 'expected_net_amount', v_net, 'price_health', v_price_health),
    jsonb_build_object('idempotency_key', p_idempotency_key, 'new_unit_price_kcoin', p_new_unit_price_kcoin)
  );

  return jsonb_build_object(
    'listing_id', p_listing_id,
    'unit_price_kcoin', p_new_unit_price_kcoin,
    'expected_net_amount', v_net,
    'price_health', v_price_health,
    'status', v_listing.status,
    'idempotent', false
  );
end;
$$;

drop function if exists api.market_cancel_listing(uuid, uuid);

create or replace function api.market_cancel_listing(
  p_user_id uuid,
  p_listing_id uuid,
  p_idempotency_key text,
  p_reason text default 'user_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing market.listings%rowtype;
  v_existing_event market.listing_events%rowtype;
  v_item_ids uuid[];
  v_locked_item_count integer;
  v_valid_item_count integer;
  v_active_lock_count integer;
  v_updated_count integer;
begin
  if p_user_id is null or p_listing_id is null then
    raise exception 'user_id and listing_id are required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('market_cancel_listing'), hashtext(p_idempotency_key));

  select * into v_existing_event
  from market.listing_events
  where metadata ->> 'idempotency_key' = p_idempotency_key
  order by created_at desc
  limit 1;

  if v_existing_event.id is not null then
    if v_existing_event.event_type <> 'cancelled'
       or v_existing_event.listing_id is distinct from p_listing_id
       or v_existing_event.user_id is distinct from p_user_id then
      raise exception 'idempotency conflict';
    end if;

    select coalesce(array_agg(li.item_instance_id order by li.created_at), '{}'::uuid[])
      into v_item_ids
    from market.listing_items li
    where li.listing_id = p_listing_id
      and li.status = 'cancelled';

    return jsonb_build_object(
      'listing_id', p_listing_id,
      'status', 'cancelled',
      'released_item_instance_ids', to_jsonb(v_item_ids),
      'released_item_ids', to_jsonb(v_item_ids),
      'cancelled_at', v_existing_event.created_at,
      'idempotent', true
    );
  end if;

  select * into v_listing
  from market.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'listing not found';
  end if;
  if v_listing.seller_user_id <> p_user_id then
    raise exception 'not listing owner';
  end if;
  if v_listing.status not in ('active', 'partially_sold') then
    raise exception 'listing cannot be cancelled';
  end if;

  select array_agg(item_instance_id order by created_at)
    into v_item_ids
  from (
    select item_instance_id, created_at
    from market.listing_items
    where listing_id = p_listing_id and status = 'reserved'
    for update
  ) s;

  v_item_ids := coalesce(v_item_ids, '{}'::uuid[]);

  if v_listing.remaining_count <= 0 or cardinality(v_item_ids) <> v_listing.remaining_count then
    raise exception 'listing item integrity violation';
  end if;

  with locked_items as (
    select ii.id, ii.owner_user_id, ii.status
    from inventory.item_instances ii
    where ii.id = any(v_item_ids)
    for update
  )
  select
    count(*)::integer,
    count(*) filter (
      where owner_user_id = v_listing.seller_user_id
        and status = 'listed'
    )::integer
    into v_locked_item_count, v_valid_item_count
  from locked_items;

  if v_locked_item_count <> cardinality(v_item_ids)
     or v_valid_item_count <> cardinality(v_item_ids) then
    raise exception 'listing item integrity violation';
  end if;

  with locked_locks as (
    select il.id
    from inventory.inventory_locks il
    where il.item_instance_id = any(v_item_ids)
      and il.user_id = v_listing.seller_user_id
      and il.lock_type = 'market_listing'
      and il.source_type = 'market_listing'
      and il.source_id = p_listing_id
      and il.status = 'active'
    for update
  )
  select count(*)::integer
    into v_active_lock_count
  from locked_locks;

  if v_active_lock_count <> cardinality(v_item_ids) then
    raise exception 'listing lock integrity violation';
  end if;

  update market.listings
  set status = 'cancelled',
      remaining_count = 0,
      expected_net_amount = 0,
      updated_at = now()
  where id = p_listing_id;

  update market.listing_items
  set status = 'cancelled'
  where listing_id = p_listing_id and status = 'reserved';
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> cardinality(v_item_ids) then
    raise exception 'listing item integrity violation';
  end if;

  if cardinality(v_item_ids) > 0 then
    update inventory.item_instances
    set status = 'available', updated_at = now(), lock_version = lock_version + 1
    where id = any(v_item_ids)
      and owner_user_id = v_listing.seller_user_id
      and status = 'listed';
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> cardinality(v_item_ids) then
      raise exception 'listing item integrity violation';
    end if;

    update inventory.inventory_locks
    set status = 'released', released_at = now(), updated_at = now()
    where item_instance_id = any(v_item_ids)
      and user_id = v_listing.seller_user_id
      and lock_type = 'market_listing'
      and source_type = 'market_listing'
      and source_id = p_listing_id
      and status = 'active';
    get diagnostics v_updated_count = row_count;
    if v_updated_count <> cardinality(v_item_ids) then
      raise exception 'listing lock integrity violation';
    end if;

    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    select x.id, p_user_id, 'delisted', 'market_listing', p_listing_id,
           jsonb_build_object('listing_id', p_listing_id, 'reason', coalesce(p_reason, 'user_cancelled'))
    from unnest(v_item_ids) as x(id);
  end if;

  insert into market.listing_events (listing_id, user_id, event_type, before_state, after_state, metadata)
  values (
    p_listing_id, p_user_id, 'cancelled',
    jsonb_build_object('status', v_listing.status, 'remaining_count', v_listing.remaining_count),
    jsonb_build_object('status', 'cancelled', 'remaining_count', 0),
    jsonb_build_object('idempotency_key', p_idempotency_key, 'reason', coalesce(p_reason, 'user_cancelled'))
  );

  return jsonb_build_object(
    'listing_id', p_listing_id,
    'status', 'cancelled',
    'released_item_instance_ids', to_jsonb(v_item_ids),
    'released_item_ids', to_jsonb(v_item_ids),
    'cancelled_at', now(),
    'idempotent', false
  );
end;
$$;

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

create or replace function api.market_get_my_listing_stats(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stats jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select jsonb_build_object(
    'active_listing_count', coalesce(count(*) filter (where status in ('active', 'partially_sold') and remaining_count > 0), 0),
    'active_count', coalesce(count(*) filter (where status in ('active', 'partially_sold') and remaining_count > 0), 0),
    'active_item_count', coalesce(sum(remaining_count) filter (where status in ('active', 'partially_sold') and remaining_count > 0), 0),
    'total_listing_value_kcoin', coalesce(sum(unit_price_kcoin * remaining_count) filter (where status in ('active', 'partially_sold') and remaining_count > 0), 0),
    'expected_net_amount_kcoin', coalesce(sum((unit_price_kcoin * remaining_count) - floor((unit_price_kcoin * remaining_count) * fee_bps / 10000)) filter (where status in ('active', 'partially_sold') and remaining_count > 0), 0),
    'sold_24h_count', coalesce((
      select sum(o.item_count)
      from market.orders o
      where o.seller_user_id = p_user_id
        and o.status = 'completed'
        and o.completed_at >= now() - interval '24 hours'
    ), 0),
    'sold_24h_value_kcoin', coalesce((
      select sum(o.total_price_kcoin)
      from market.orders o
      where o.seller_user_id = p_user_id
        and o.status = 'completed'
        and o.completed_at >= now() - interval '24 hours'
    ), 0)
  )
    into v_stats
  from market.listings
  where seller_user_id = p_user_id;

  return v_stats;
end;
$$;

create or replace function api.market_refresh_price_stats()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price_rows integer := 0;
  v_depth_rows integer := 0;
  v_snapshot_at timestamptz := clock_timestamp();
begin
  with active_stats as (
    select
      l.template_id,
      l.form_id,
      max(l.rarity_code) as rarity_code,
      min(l.unit_price_kcoin) as floor_price_kcoin,
      count(*)::integer as active_listing_count
    from market.listings l
    where l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
    group by l.template_id, l.form_id
  ),
  sale_stats as (
    select
      l.template_id,
      l.form_id,
      max(l.rarity_code) as rarity_code,
      avg(o.unit_price_kcoin)::numeric(38,0) as avg_price_kcoin,
      (
        array_agg(o.unit_price_kcoin order by o.completed_at desc, o.created_at desc)
      )[1] as last_sale_price_kcoin,
      count(*) filter (where o.completed_at >= v_snapshot_at - interval '24 hours')::integer as sale_count_24h,
      coalesce(sum(o.total_price_kcoin) filter (where o.completed_at >= v_snapshot_at - interval '24 hours'), 0) as volume_24h_kcoin
    from market.orders o
    join market.listings l on l.id = o.listing_id
    where o.status = 'completed'
    group by l.template_id, l.form_id
  ),
  combined as (
    select
      coalesce(a.template_id, s.template_id) as template_id,
      coalesce(a.form_id, s.form_id) as form_id,
      coalesce(a.rarity_code, s.rarity_code) as rarity_code,
      a.floor_price_kcoin,
      s.avg_price_kcoin,
      s.last_sale_price_kcoin,
      coalesce(a.active_listing_count, 0) as active_listing_count,
      coalesce(s.sale_count_24h, 0) as sale_count_24h,
      coalesce(s.volume_24h_kcoin, 0) as volume_24h_kcoin
    from active_stats a
    full join sale_stats s
      on s.template_id = a.template_id
     and s.form_id is not distinct from a.form_id
  ),
  inserted as (
    insert into market.price_snapshots (
      template_id, form_id, rarity_code, floor_price_kcoin, avg_price_kcoin,
      last_sale_price_kcoin, active_listing_count, sale_count_24h,
      volume_24h_kcoin, snapshot_at
    )
    select
      template_id, form_id, rarity_code, floor_price_kcoin, avg_price_kcoin,
      last_sale_price_kcoin, active_listing_count, sale_count_24h,
      volume_24h_kcoin, v_snapshot_at
    from combined
    returning 1
  )
  select count(*)::integer into v_price_rows
  from inserted;

  with depth as (
    select
      l.template_id,
      l.form_id,
      l.unit_price_kcoin as price_bucket_kcoin,
      count(*)::integer as listing_count,
      coalesce(sum(l.remaining_count), 0)::integer as item_count
    from market.listings l
    where l.status in ('active', 'partially_sold')
      and l.remaining_count > 0
    group by l.template_id, l.form_id, l.unit_price_kcoin
  ),
  inserted as (
    insert into market.depth_snapshots (
      template_id, form_id, price_bucket_kcoin, listing_count, item_count, snapshot_at
    )
    select
      template_id, form_id, price_bucket_kcoin, listing_count, item_count, v_snapshot_at
    from depth
    returning 1
  )
  select count(*)::integer into v_depth_rows
  from inserted;

  update market.listings l
  set price_health = api._market_price_health(l.template_id, l.form_id, l.rarity_code, l.unit_price_kcoin),
      updated_at = now()
  where l.status in ('active', 'partially_sold')
    and l.remaining_count > 0;

  return jsonb_build_object(
    'snapshot_at', v_snapshot_at,
    'price_snapshot_count', v_price_rows,
    'depth_snapshot_count', v_depth_rows
  );
end;
$$;

revoke execute on function api._market_price_health(uuid, uuid, text, numeric) from public, anon, authenticated;

grant execute on function api.market_list_listings(uuid, text[], text[], uuid[], uuid[], numeric, numeric, text, integer, text) to service_role;
grant execute on function api.market_get_listing_detail(uuid, uuid) to service_role;
grant execute on function api.market_list_sellable_items(uuid, text[], text[], uuid[], uuid[], boolean, integer, integer, text, text, integer, text) to service_role;
grant execute on function api.market_create_listing(uuid, uuid[], numeric, text) to service_role;
grant execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) to service_role;
grant execute on function api.market_update_listing_price(uuid, uuid, numeric, text) to service_role;
grant execute on function api.market_cancel_listing(uuid, uuid, text, text) to service_role;
grant execute on function api.market_list_my_listings(uuid, text[], text[], text[], uuid[], numeric, numeric, text, integer, text) to service_role;
grant execute on function api.market_get_my_listing_stats(uuid) to service_role;
grant execute on function api.market_refresh_price_stats() to service_role;

revoke execute on function api.market_list_listings(uuid, text[], text[], uuid[], uuid[], numeric, numeric, text, integer, text) from public, anon, authenticated;
revoke execute on function api.market_get_listing_detail(uuid, uuid) from public, anon, authenticated;
revoke execute on function api.market_list_sellable_items(uuid, text[], text[], uuid[], uuid[], boolean, integer, integer, text, text, integer, text) from public, anon, authenticated;
revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text) from public, anon, authenticated;
revoke execute on function api.market_buy_listing(uuid, uuid, integer, numeric, text) from public, anon, authenticated;
revoke execute on function api.market_update_listing_price(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function api.market_cancel_listing(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function api.market_list_my_listings(uuid, text[], text[], text[], uuid[], numeric, numeric, text, integer, text) from public, anon, authenticated;
revoke execute on function api.market_get_my_listing_stats(uuid) from public, anon, authenticated;
revoke execute on function api.market_refresh_price_stats() from public, anon, authenticated;
