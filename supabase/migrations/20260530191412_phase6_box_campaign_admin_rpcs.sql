-- Phase 6: blind box, box price rule and banner campaign admin RPCs.
--
-- Keep admin writes behind service_role-only RPCs. The API layer performs
-- session and confirmation checks; these RPCs keep validation, idempotency and
-- audit writes in the same database transaction.

begin;

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

  if v_status not in ('draft', 'not_started', 'active', 'paused', 'ended', 'sold_out', 'hidden') then
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

  if v_status not in ('draft', 'not_started', 'active', 'paused', 'ended', 'sold_out', 'hidden') then
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
    or (v_box.status = 'draft' and v_status in ('not_started', 'active', 'paused', 'hidden'))
    or (v_box.status = 'not_started' and v_status in ('active', 'paused', 'ended', 'hidden'))
    or (v_box.status = 'active' and v_status in ('paused', 'sold_out', 'ended', 'hidden'))
    or (v_box.status = 'paused' and v_status in ('active', 'ended', 'hidden'))
    or (v_box.status = 'sold_out' and v_status in ('ended', 'hidden'))
    or (v_box.status = 'ended' and v_status in ('hidden'))
    or (v_box.status = 'hidden' and v_status in ('draft', 'not_started'))
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

create or replace function api.admin_upsert_box_price_rule(
  p_admin_user_id uuid,
  p_box_id uuid,
  p_quantity integer,
  p_discount_bps integer,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_price_rule_id uuid default null,
  p_price_stars_override integer default null,
  p_active boolean default true,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
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
  v_rule gacha.box_price_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_response jsonb;
  v_audit jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_box_price_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_box_id is null then
    raise exception 'ADMIN_BOX_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if p_quantity not in (1, 10) then
    raise exception 'ADMIN_BOX_PRICE_RULE_QUANTITY_INVALID' using errcode = 'P0001';
  end if;

  if p_discount_bps is null or p_discount_bps < 0 or p_discount_bps > 10000 then
    raise exception 'ADMIN_BOX_PRICE_RULE_DISCOUNT_INVALID' using errcode = 'P0001';
  end if;

  if p_price_stars_override is not null and p_price_stars_override <= 0 then
    raise exception 'ADMIN_BOX_PRICE_RULE_PRICE_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_BOX_PRICE_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_starts_at >= p_ends_at then
    raise exception 'ADMIN_BOX_PRICE_RULE_TIME_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if not found then
    raise exception 'ADMIN_BOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_price_rule_id is not null then
    select *
    into v_rule
    from gacha.box_price_rules
    where id = p_price_rule_id
    for update;
  else
    select *
    into v_rule
    from gacha.box_price_rules
    where box_id = p_box_id
      and quantity = p_quantity
      and active = v_active
    for update;
  end if;

  if found then
    if v_rule.box_id <> p_box_id then
      raise exception 'ADMIN_BOX_PRICE_RULE_BOX_MISMATCH' using errcode = 'P0001';
    end if;

    v_before := to_jsonb(v_rule);
  end if;

  if v_active
     and exists (
       select 1
       from gacha.box_price_rules existing
       where existing.box_id = p_box_id
         and existing.quantity = p_quantity
         and existing.active = true
         and (v_rule.id is null or existing.id <> v_rule.id)
         and coalesce(existing.starts_at, '-infinity'::timestamptz) < coalesce(p_ends_at, 'infinity'::timestamptz)
         and coalesce(existing.ends_at, 'infinity'::timestamptz) > coalesce(p_starts_at, '-infinity'::timestamptz)
     ) then
    raise exception 'ADMIN_BOX_PRICE_RULE_WINDOW_CONFLICT' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'price_rule_id', p_price_rule_id,
    'box_id', p_box_id,
    'quantity', p_quantity,
    'discount_bps', p_discount_bps,
    'price_stars_override', p_price_stars_override,
    'active', v_active,
    'starts_at', p_starts_at,
    'ends_at', p_ends_at,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  begin
    if v_rule.id is null then
      insert into gacha.box_price_rules (
        id,
        box_id,
        quantity,
        discount_bps,
        price_stars_override,
        active,
        starts_at,
        ends_at,
        metadata,
        updated_at
      )
      values (
        coalesce(p_price_rule_id, gen_random_uuid()),
        p_box_id,
        p_quantity,
        p_discount_bps,
        p_price_stars_override,
        v_active,
        p_starts_at,
        p_ends_at,
        v_metadata,
        v_now
      )
      returning * into v_rule;
    else
      update gacha.box_price_rules
      set quantity = p_quantity,
          discount_bps = p_discount_bps,
          price_stars_override = p_price_stars_override,
          active = v_active,
          starts_at = p_starts_at,
          ends_at = p_ends_at,
          metadata = v_metadata,
          updated_at = v_now
      where id = v_rule.id
      returning * into v_rule;
    end if;
  exception
    when unique_violation then
      raise exception 'ADMIN_BOX_PRICE_RULE_CONFLICT' using errcode = 'P0001';
  end;

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.box_price_rule.upsert',
    'gacha',
    'box_price_rules',
    v_rule.id,
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
    'box_price_rule_id', v_rule.id,
    'box_id', v_rule.box_id,
    'quantity', v_rule.quantity,
    'discount_bps', v_rule.discount_bps,
    'price_stars_override', v_rule.price_stars_override,
    'active', v_rule.active,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_upsert_banner_campaign(
  p_admin_user_id uuid,
  p_code text,
  p_title text,
  p_image_url text,
  p_placement text,
  p_target_type text,
  p_status text,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_banner_campaign_id uuid default null,
  p_description text default null,
  p_target_ref text default null,
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
  v_campaign catalog.banner_campaigns%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_response jsonb;
  v_audit jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_banner_campaign';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_code text := lower(nullif(trim(coalesce(p_code, '')), ''));
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_image_url text := nullif(trim(coalesce(p_image_url, '')), '');
  v_placement text := lower(nullif(trim(coalesce(p_placement, '')), ''));
  v_target_type text := lower(nullif(trim(coalesce(p_target_type, '')), ''));
  v_target_ref text := nullif(trim(coalesce(p_target_ref, '')), '');
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'catalog:write');

  if v_code is null then
    raise exception 'ADMIN_BANNER_CODE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_code !~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$' then
    raise exception 'ADMIN_BANNER_CODE_INVALID' using errcode = 'P0001';
  end if;

  if v_title is null then
    raise exception 'ADMIN_BANNER_TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  if v_image_url is null then
    raise exception 'ADMIN_BANNER_IMAGE_URL_REQUIRED' using errcode = 'P0001';
  end if;

  if v_image_url !~* '^(https?://[^[:space:]]+|/[^[:space:]]+)$' then
    raise exception 'ADMIN_BANNER_IMAGE_URL_INVALID' using errcode = 'P0001';
  end if;

  if v_placement not in ('market_top', 'box_top', 'task_top', 'album_top', 'home') then
    raise exception 'ADMIN_BANNER_PLACEMENT_INVALID' using errcode = 'P0001';
  end if;

  if v_target_type not in ('none', 'box', 'market_listing', 'shop_product', 'external_url', 'task') then
    raise exception 'ADMIN_BANNER_TARGET_TYPE_INVALID' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'active', 'paused', 'ended') then
    raise exception 'ADMIN_BANNER_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if p_sort_order is null then
    raise exception 'ADMIN_BANNER_SORT_ORDER_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_BANNER_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_starts_at >= p_ends_at then
    raise exception 'ADMIN_BANNER_TIME_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  if v_target_type = 'none' then
    if v_target_ref is not null then
      raise exception 'ADMIN_BANNER_TARGET_REF_NOT_ALLOWED' using errcode = 'P0001';
    end if;
  elsif v_target_ref is null then
    raise exception 'ADMIN_BANNER_TARGET_REF_REQUIRED' using errcode = 'P0001';
  elsif v_target_type = 'box' then
    if not exists (
      select 1
      from gacha.blind_boxes b
      where b.id::text = v_target_ref
        and b.status in ('not_started', 'active', 'paused', 'sold_out')
    ) then
      raise exception 'ADMIN_BANNER_TARGET_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif v_target_type = 'market_listing' then
    if not exists (
      select 1
      from market.listings l
      where l.id::text = v_target_ref
        and l.status in ('active', 'partially_sold')
        and l.remaining_count > 0
    ) then
      raise exception 'ADMIN_BANNER_TARGET_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif v_target_type = 'task' then
    if not exists (
      select 1
      from tasks.task_definitions td
      where (td.id::text = v_target_ref or td.code = v_target_ref)
        and td.active = true
        and (td.starts_at is null or td.starts_at <= v_now)
        and (td.ends_at is null or td.ends_at > v_now)
    ) then
      raise exception 'ADMIN_BANNER_TARGET_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif v_target_type = 'external_url' then
    if v_target_ref !~* '^https://[^[:space:]]+$' then
      raise exception 'ADMIN_BANNER_EXTERNAL_URL_INVALID' using errcode = 'P0001';
    end if;
  elsif v_target_type = 'shop_product' then
    raise exception 'ADMIN_BANNER_TARGET_UNSUPPORTED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'banner_campaign_id', p_banner_campaign_id,
    'code', v_code,
    'title', v_title,
    'description', v_description,
    'image_url', v_image_url,
    'placement', v_placement,
    'target_type', v_target_type,
    'target_ref', v_target_ref,
    'status', v_status,
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

  if p_banner_campaign_id is not null then
    select *
    into v_campaign
    from catalog.banner_campaigns
    where id = p_banner_campaign_id
    for update;
  else
    select *
    into v_campaign
    from catalog.banner_campaigns
    where code = v_code
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_campaign);
  end if;

  begin
    if v_campaign.id is null then
      insert into catalog.banner_campaigns (
        id,
        code,
        title,
        description,
        image_url,
        placement,
        target_type,
        target_ref,
        status,
        starts_at,
        ends_at,
        sort_order,
        metadata,
        updated_at
      )
      values (
        coalesce(p_banner_campaign_id, gen_random_uuid()),
        v_code,
        v_title,
        v_description,
        v_image_url,
        v_placement,
        v_target_type,
        v_target_ref,
        v_status,
        p_starts_at,
        p_ends_at,
        p_sort_order,
        v_metadata,
        v_now
      )
      returning * into v_campaign;
    else
      update catalog.banner_campaigns
      set code = v_code,
          title = v_title,
          description = v_description,
          image_url = v_image_url,
          placement = v_placement,
          target_type = v_target_type,
          target_ref = v_target_ref,
          status = v_status,
          starts_at = p_starts_at,
          ends_at = p_ends_at,
          sort_order = p_sort_order,
          metadata = v_metadata,
          updated_at = v_now
      where id = v_campaign.id
      returning * into v_campaign;
    end if;
  exception
    when unique_violation then
      raise exception 'ADMIN_BANNER_CODE_CONFLICT' using errcode = 'P0001';
  end;

  v_after := to_jsonb(v_campaign);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'catalog.banner_campaign.upsert',
    'catalog',
    'banner_campaigns',
    v_campaign.id,
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
    'banner_campaign_id', v_campaign.id,
    'code', v_campaign.code,
    'placement', v_campaign.placement,
    'target_type', v_campaign.target_type,
    'target_ref', v_campaign.target_ref,
    'status', v_campaign.status,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_upsert_blind_box(
  uuid, text, text, text, text, integer, text, text, jsonb, uuid, text, integer, integer, numeric, text, text, timestamptz, timestamptz, integer, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_update_box_status(
  uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_upsert_box_price_rule(
  uuid, uuid, integer, integer, text, text, jsonb, uuid, integer, boolean, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_upsert_blind_box(
  uuid, text, text, text, text, integer, text, text, jsonb, uuid, text, integer, integer, numeric, text, text, timestamptz, timestamptz, integer, jsonb
) to service_role;
grant execute on function api.admin_update_box_status(
  uuid, uuid, text, text, text, jsonb
) to service_role;
grant execute on function api.admin_upsert_box_price_rule(
  uuid, uuid, integer, integer, text, text, jsonb, uuid, integer, boolean, timestamptz, timestamptz, jsonb
) to service_role;
grant execute on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) to service_role;

comment on function api.admin_upsert_blind_box(
  uuid, text, text, text, text, integer, text, text, jsonb, uuid, text, integer, integer, numeric, text, text, timestamptz, timestamptz, integer, jsonb
) is 'Create or update a blind box with admin permission, validation, idempotency and audit logging.';

comment on function api.admin_update_box_status(
  uuid, uuid, text, text, text, jsonb
) is 'Update blind box lifecycle status through an admin-validated state transition.';

comment on function api.admin_upsert_box_price_rule(
  uuid, uuid, integer, integer, text, text, jsonb, uuid, integer, boolean, timestamptz, timestamptz, jsonb
) is 'Create or update a blind box price rule and reject overlapping active windows.';

comment on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) is 'Create or update a banner campaign with target validation and audit logging.';

commit;
