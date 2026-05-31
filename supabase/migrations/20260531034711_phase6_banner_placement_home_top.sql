-- Phase 6: align activity banner placements with the admin guide.
-- Existing deployments used `home`; the user-facing contract now requires
-- `home_top` alongside market/task/box/album top placements.

update catalog.banner_campaigns
set placement = 'home_top',
    updated_at = now()
where placement = 'home';

alter table catalog.banner_campaigns
  drop constraint if exists banner_campaigns_placement_check;

alter table catalog.banner_campaigns
  add constraint banner_campaigns_placement_check
  check (placement in ('market_top', 'task_top', 'box_top', 'home_top', 'album_top'));

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

  if v_placement not in ('market_top', 'task_top', 'box_top', 'home_top', 'album_top') then
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

revoke all on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) from public, anon, authenticated;

grant execute on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) to service_role;

comment on function api.admin_upsert_banner_campaign(
  uuid, text, text, text, text, text, text, text, text, jsonb, uuid, text, text, timestamptz, timestamptz, integer, jsonb
) is 'Create or update a banner campaign with target validation, phase 6 placement validation and audit logging.';
