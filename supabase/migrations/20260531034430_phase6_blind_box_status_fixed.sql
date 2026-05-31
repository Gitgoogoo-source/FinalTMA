-- Phase 6: fix blind box lifecycle statuses.
--
-- This migration intentionally does not rewrite existing data. If a database
-- still has legacy blind box statuses such as `hidden`, the migration should
-- fail and force an explicit operator decision before applying remotely.

begin;

do $$
begin
  if exists (
    select 1
    from gacha.blind_boxes
    where status not in (
      'draft',
      'not_started',
      'active',
      'paused',
      'sold_out',
      'ended',
      'archived'
    )
  ) then
    raise exception 'BLIND_BOX_STATUS_OUT_OF_RANGE' using errcode = 'P0001';
  end if;
end;
$$;

alter table gacha.blind_boxes
  drop constraint if exists blind_boxes_status_check;

alter table gacha.blind_boxes
  add constraint blind_boxes_status_check
  check (
    status in (
      'draft',
      'not_started',
      'active',
      'paused',
      'sold_out',
      'ended',
      'archived'
    )
  );

create or replace function api.admin_upsert_blind_box(
  p_admin_user_id uuid,
  p_slug text,
  p_display_name text,
  p_tier text,
  p_status text,
  p_price_stars integer,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_box_id uuid default null,
  p_description text default null,
  p_total_stock integer default null,
  p_remaining_stock integer default null,
  p_open_reward_kcoin numeric default 100,
  p_cover_image_url text default null,
  p_hero_image_url text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_sort_order integer default 100,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_response jsonb;
  v_audit jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_blind_box';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_slug text := lower(nullif(trim(coalesce(p_slug, '')), ''));
  v_display_name text := nullif(trim(coalesce(p_display_name, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_tier text := lower(nullif(trim(coalesce(p_tier, '')), ''));
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_cover_image_url text := nullif(trim(coalesce(p_cover_image_url, '')), '');
  v_hero_image_url text := nullif(trim(coalesce(p_hero_image_url, '')), '');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_open_reward_kcoin numeric := coalesce(p_open_reward_kcoin, 100);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if v_slug is null then
    raise exception 'ADMIN_BOX_SLUG_REQUIRED' using errcode = 'P0001';
  end if;

  if v_slug !~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$' then
    raise exception 'ADMIN_BOX_SLUG_INVALID' using errcode = 'P0001';
  end if;

  if v_display_name is null then
    raise exception 'ADMIN_BOX_DISPLAY_NAME_REQUIRED' using errcode = 'P0001';
  end if;

  if v_tier not in ('normal', 'rare', 'legendary', 'event') then
    raise exception 'ADMIN_BOX_TIER_INVALID' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'not_started', 'active', 'paused', 'sold_out', 'ended', 'archived') then
    raise exception 'ADMIN_BOX_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if p_price_stars is null or p_price_stars <= 0 then
    raise exception 'ADMIN_BOX_PRICE_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_total_stock is not null and p_total_stock < 0 then
    raise exception 'ADMIN_BOX_TOTAL_STOCK_INVALID' using errcode = 'P0001';
  end if;

  if p_remaining_stock is not null and p_remaining_stock < 0 then
    raise exception 'ADMIN_BOX_REMAINING_STOCK_INVALID' using errcode = 'P0001';
  end if;

  if p_total_stock is not null
     and p_remaining_stock is not null
     and p_remaining_stock > p_total_stock then
    raise exception 'ADMIN_BOX_STOCK_INVALID' using errcode = 'P0001';
  end if;

  if v_open_reward_kcoin < 0 then
    raise exception 'ADMIN_BOX_OPEN_REWARD_INVALID' using errcode = 'P0001';
  end if;

  if p_sort_order is null then
    raise exception 'ADMIN_BOX_SORT_ORDER_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_BOX_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_starts_at >= p_ends_at then
    raise exception 'ADMIN_BOX_TIME_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  if v_status = 'active' then
    if p_starts_at is not null and p_starts_at > v_now then
      raise exception 'ADMIN_BOX_ACTIVE_BEFORE_START' using errcode = 'P0001';
    end if;

    if p_ends_at is not null and p_ends_at <= v_now then
      raise exception 'ADMIN_BOX_ACTIVE_AFTER_END' using errcode = 'P0001';
    end if;

    if p_remaining_stock is not null and p_remaining_stock <= 0 then
      raise exception 'ADMIN_BOX_ACTIVE_STOCK_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if v_status = 'sold_out' and coalesce(p_remaining_stock, -1) <> 0 then
    raise exception 'ADMIN_BOX_SOLD_OUT_REQUIRES_ZERO_STOCK' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'box_id', p_box_id,
    'slug', v_slug,
    'display_name', v_display_name,
    'description', v_description,
    'tier', v_tier,
    'status', v_status,
    'price_stars', p_price_stars,
    'total_stock', p_total_stock,
    'remaining_stock', p_remaining_stock,
    'open_reward_kcoin', v_open_reward_kcoin,
    'cover_image_url', v_cover_image_url,
    'hero_image_url', v_hero_image_url,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'sort_order', p_sort_order,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if p_box_id is not null then
    select *
    into v_box
    from gacha.blind_boxes
    where id = p_box_id
    for update;
  else
    select *
    into v_box
    from gacha.blind_boxes
    where slug = v_slug
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_box);

    if not (
      v_box.status = v_status
      or (v_box.status = 'draft' and v_status in ('not_started', 'active'))
      or (v_box.status = 'active' and v_status in ('paused', 'sold_out', 'ended'))
      or (v_box.status = 'ended' and v_status = 'archived')
    ) then
      raise exception 'ADMIN_BOX_STATUS_TRANSITION_INVALID' using errcode = 'P0001';
    end if;
  end if;

  if v_status = 'active'
     and not exists (
       select 1
       from gacha.drop_pool_versions dpv
       where dpv.box_id = coalesce(v_box.id, p_box_id)
         and dpv.status = 'active'
         and (dpv.effective_from is null or dpv.effective_from <= v_now)
         and (dpv.effective_to is null or dpv.effective_to > v_now)
     ) then
    raise exception 'ADMIN_BOX_ACTIVE_POOL_REQUIRED' using errcode = 'P0001';
  end if;

  begin
    if v_box.id is null then
      insert into gacha.blind_boxes (
        id,
        slug,
        display_name,
        description,
        tier,
        status,
        price_stars,
        total_stock,
        remaining_stock,
        open_reward_kcoin,
        cover_image_url,
        hero_image_url,
        starts_at,
        ends_at,
        sort_order,
        metadata,
        updated_at
      )
      values (
        coalesce(p_box_id, gen_random_uuid()),
        v_slug,
        v_display_name,
        v_description,
        v_tier,
        v_status,
        p_price_stars,
        p_total_stock,
        p_remaining_stock,
        v_open_reward_kcoin,
        v_cover_image_url,
        v_hero_image_url,
        p_starts_at,
        p_ends_at,
        p_sort_order,
        v_metadata,
        v_now
      )
      returning * into v_box;
    else
      update gacha.blind_boxes
      set slug = v_slug,
          display_name = v_display_name,
          description = v_description,
          tier = v_tier,
          status = v_status,
          price_stars = p_price_stars,
          total_stock = p_total_stock,
          remaining_stock = p_remaining_stock,
          open_reward_kcoin = v_open_reward_kcoin,
          cover_image_url = v_cover_image_url,
          hero_image_url = v_hero_image_url,
          starts_at = p_starts_at,
          ends_at = p_ends_at,
          sort_order = p_sort_order,
          metadata = v_metadata,
          updated_at = v_now
      where id = v_box.id
      returning * into v_box;
    end if;
  exception
    when unique_violation then
      raise exception 'ADMIN_BOX_SLUG_CONFLICT' using errcode = 'P0001';
  end;

  v_after := to_jsonb(v_box);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    case when jsonb_typeof(v_before) = 'null' then 'gacha.blind_box.create' else 'gacha.blind_box.update' end,
    'gacha',
    'blind_boxes',
    v_box.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', v_box.id,
    'slug', v_box.slug,
    'status', v_box.status,
    'price_stars', v_box.price_stars,
    'total_stock', v_box.total_stock,
    'remaining_stock', v_box.remaining_stock,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_update_box_status(
  p_admin_user_id uuid,
  p_box_id uuid,
  p_status text,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_response jsonb;
  v_audit jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.update_box_status';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_box_id is null then
    raise exception 'ADMIN_BOX_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'not_started', 'active', 'paused', 'sold_out', 'ended', 'archived') then
    raise exception 'ADMIN_BOX_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'box_id', p_box_id,
    'status', v_status,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select *
  into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if not found then
    raise exception 'ADMIN_BOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not (
    v_box.status = v_status
    or (v_box.status = 'draft' and v_status in ('not_started', 'active'))
    or (v_box.status = 'active' and v_status in ('paused', 'sold_out', 'ended'))
    or (v_box.status = 'ended' and v_status = 'archived')
  ) then
    raise exception 'ADMIN_BOX_STATUS_TRANSITION_INVALID' using errcode = 'P0001';
  end if;

  if v_status = 'active' then
    if v_box.starts_at is not null and v_box.starts_at > v_now then
      raise exception 'ADMIN_BOX_ACTIVE_BEFORE_START' using errcode = 'P0001';
    end if;

    if v_box.ends_at is not null and v_box.ends_at <= v_now then
      raise exception 'ADMIN_BOX_ACTIVE_AFTER_END' using errcode = 'P0001';
    end if;

    if v_box.remaining_stock is not null and v_box.remaining_stock <= 0 then
      raise exception 'ADMIN_BOX_ACTIVE_STOCK_REQUIRED' using errcode = 'P0001';
    end if;

    if not exists (
      select 1
      from gacha.drop_pool_versions dpv
      where dpv.box_id = v_box.id
        and dpv.status = 'active'
        and (dpv.effective_from is null or dpv.effective_from <= v_now)
        and (dpv.effective_to is null or dpv.effective_to > v_now)
    ) then
      raise exception 'ADMIN_BOX_ACTIVE_POOL_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if v_status = 'sold_out' and coalesce(v_box.remaining_stock, -1) <> 0 then
    raise exception 'ADMIN_BOX_SOLD_OUT_REQUIRES_ZERO_STOCK' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_box);

  update gacha.blind_boxes
  set status = v_status,
      updated_at = v_now
  where id = v_box.id
  returning * into v_box;

  v_after := to_jsonb(v_box);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.blind_box.status_update',
    'gacha',
    'blind_boxes',
    v_box.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', v_box.id,
    'previous_status', v_before ->> 'status',
    'status', v_box.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
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

  if v_box.id is null or v_box.status in ('draft', 'archived') then
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

revoke execute on function api.admin_upsert_blind_box(uuid, text, text, text, text, integer, text, text, jsonb, uuid, text, integer, integer, numeric, text, text, timestamptz, timestamptz, integer, jsonb)
  from public, anon, authenticated;
grant execute on function api.admin_upsert_blind_box(uuid, text, text, text, text, integer, text, text, jsonb, uuid, text, integer, integer, numeric, text, text, timestamptz, timestamptz, integer, jsonb)
  to service_role;

revoke execute on function api.admin_update_box_status(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function api.admin_update_box_status(uuid, uuid, text, text, text, jsonb)
  to service_role;

revoke execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function api.gacha_get_box_rewards(uuid, uuid, boolean, boolean)
  to service_role;

commit;
