-- Phase 6 step 2.9 market ops completion.
--
-- Completes the remaining admin operations contract without mutating ledger
-- history: form-level price health rules, audited fee rule writes, admin/manual
-- stats rebuild, and cron/job event logging.

begin;

alter table market.price_health_rules
  add column if not exists form_id uuid references catalog.collectible_forms(id) on delete cascade;

create index if not exists price_health_rules_scope_idx
  on market.price_health_rules (active, rarity_code, template_id, form_id, updated_at desc);

drop function if exists api.admin_list_market_health_rules(uuid, boolean, text, uuid, integer, integer, jsonb);
drop function if exists api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb);

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
  v_min_ratio numeric(10,4) := 0.7000;
  v_max_ratio numeric(10,4) := 1.3000;
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
    and (phr.form_id is null or phr.form_id = p_form_id)
    and (phr.template_id is null or phr.template_id = p_template_id)
    and (phr.rarity_code is null or upper(phr.rarity_code) = upper(p_rarity_code))
  order by
    case when phr.form_id is not null and phr.form_id = p_form_id then 0 else 1 end,
    case when phr.template_id is not null and phr.template_id = p_template_id then 0 else 1 end,
    case when phr.rarity_code is not null and upper(phr.rarity_code) = upper(p_rarity_code) then 0 else 1 end,
    phr.updated_at desc,
    phr.created_at desc
  limit 1;

  v_min_ratio := coalesce(v_min_ratio, 0.7000);
  v_max_ratio := coalesce(v_max_ratio, 1.3000);

  if p_unit_price_kcoin < floor(v_floor_price * v_min_ratio) then
    return 'too_low';
  end if;

  if p_unit_price_kcoin > ceiling(v_floor_price * v_max_ratio) then
    return 'too_high';
  end if;

  return 'healthy';
end;
$$;

revoke execute on function api._market_price_health(uuid, uuid, text, numeric) from public, anon, authenticated;

create or replace function api.admin_list_market_health_rules(
  p_admin_user_id uuid,
  p_active boolean default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
  p_form_id uuid default null,
  p_limit integer default 20,
  p_cursor integer default 0,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_cursor, 0), 0);
  v_items jsonb := '[]'::jsonb;
  v_row_count integer := 0;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:read', 'admin:read']);

  with filtered as (
    select phr.*, cf.form_index, cf.display_name as form_name
    from market.price_health_rules phr
    left join catalog.collectible_forms cf on cf.id = phr.form_id
    where (p_active is null or phr.active = p_active)
      and (v_rarity_code is null or upper(phr.rarity_code) = v_rarity_code)
      and (p_template_id is null or phr.template_id = p_template_id)
      and (p_form_id is null or phr.form_id = p_form_id)
    order by phr.active desc, phr.updated_at desc, phr.created_at desc, phr.id desc
    limit v_limit + 1
    offset v_offset
  ),
  page_rows as (
    select *
    from filtered
    limit v_limit
  )
  select
    (select count(*)::integer from filtered),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'templateId', template_id,
        'formId', form_id,
        'formIndex', form_index,
        'formName', form_name,
        'rarityCode', rarity_code,
        'minRatioToFloor', min_ratio_to_floor,
        'maxRatioToFloor', max_ratio_to_floor,
        'lowBps', floor(min_ratio_to_floor * 10000),
        'highBps', ceiling(max_ratio_to_floor * 10000),
        'active', active,
        'metadata', metadata,
        'createdAt', created_at,
        'updatedAt', updated_at
      )
      order by active desc, updated_at desc, created_at desc, id desc
    ), '[]'::jsonb)
  into v_row_count, v_items
  from page_rows;

  return jsonb_build_object(
    'items', v_items,
    'summary', jsonb_build_object('returnedRows', least(v_row_count, v_limit), 'limit', v_limit, 'offset', v_offset),
    'nextCursor', case when v_row_count > v_limit then (v_offset + v_limit)::text else null end,
    'sources', jsonb_build_object(
      'marketPriceHealthRules', jsonb_build_object('schema', 'market', 'table', 'price_health_rules')
    ),
    'serverTime', now()
  );
end;
$$;

create or replace function api.admin_upsert_market_health_rule(
  p_admin_user_id uuid,
  p_health_rule_id uuid default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
  p_form_id uuid default null,
  p_min_ratio_to_floor numeric default null,
  p_max_ratio_to_floor numeric default null,
  p_active boolean default true,
  p_metadata jsonb default '{}'::jsonb,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_rule market.price_health_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_market_health_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_form_template_id uuid;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_min_ratio_to_floor is null or p_max_ratio_to_floor is null then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_REQUIRED' using errcode = 'P0001';
  end if;

  if not (p_min_ratio_to_floor >= 0 and p_min_ratio_to_floor < 1 and p_max_ratio_to_floor > 1) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_INVALID' using errcode = 'P0001';
  end if;

  if p_min_ratio_to_floor >= p_max_ratio_to_floor then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RATIO_RANGE_INVALID' using errcode = 'P0001';
  end if;

  if p_template_id is not null
     and not exists (select 1 from catalog.collectible_templates where id = p_template_id) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_form_id is not null then
    select template_id
      into v_form_template_id
    from catalog.collectible_forms
    where id = p_form_id;

    if not found then
      raise exception 'ADMIN_MARKET_HEALTH_RULE_FORM_NOT_FOUND' using errcode = 'P0001';
    end if;

    if p_template_id is not null and p_template_id <> v_form_template_id then
      raise exception 'ADMIN_MARKET_HEALTH_RULE_FORM_TEMPLATE_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if v_rarity_code is not null
     and not exists (select 1 from catalog.rarities where code = v_rarity_code) then
    raise exception 'ADMIN_MARKET_HEALTH_RULE_RARITY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_health_rule_id is not null then
    select *
    into v_rule
    from market.price_health_rules
    where id = p_health_rule_id
    for update;
  else
    select *
    into v_rule
    from market.price_health_rules
    where template_id is not distinct from coalesce(p_template_id, v_form_template_id)
      and form_id is not distinct from p_form_id
      and rarity_code is not distinct from v_rarity_code
    order by active desc, updated_at desc, created_at desc
    limit 1
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_rule);
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'health_rule_id', p_health_rule_id,
    'template_id', coalesce(p_template_id, v_form_template_id),
    'form_id', p_form_id,
    'rarity_code', v_rarity_code,
    'min_ratio_to_floor', p_min_ratio_to_floor,
    'max_ratio_to_floor', p_max_ratio_to_floor,
    'active', v_active,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_rule.id is null then
    insert into market.price_health_rules (
      id,
      rarity_code,
      template_id,
      form_id,
      min_ratio_to_floor,
      max_ratio_to_floor,
      active,
      metadata,
      updated_at
    )
    values (
      coalesce(p_health_rule_id, gen_random_uuid()),
      v_rarity_code,
      coalesce(p_template_id, v_form_template_id),
      p_form_id,
      p_min_ratio_to_floor,
      p_max_ratio_to_floor,
      v_active,
      v_metadata,
      v_now
    )
    returning * into v_rule;
  else
    update market.price_health_rules
    set rarity_code = v_rarity_code,
        template_id = coalesce(p_template_id, v_form_template_id),
        form_id = p_form_id,
        min_ratio_to_floor = p_min_ratio_to_floor,
        max_ratio_to_floor = p_max_ratio_to_floor,
        active = v_active,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_rule.id
    returning * into v_rule;
  end if;

  perform api.market_refresh_price_stats();

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.price_health_rule.upsert',
    'market',
    'price_health_rules',
    v_rule.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    'market_price_manipulation',
    'low',
    'open',
    'admin_market_health_rule',
    v_rule.id,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  )
  returning id into v_risk_event_id;

  v_response := jsonb_build_object(
    'health_rule_id', v_rule.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now,
    'rule', jsonb_build_object(
      'id', v_rule.id,
      'templateId', v_rule.template_id,
      'formId', v_rule.form_id,
      'rarityCode', v_rule.rarity_code,
      'minRatioToFloor', v_rule.min_ratio_to_floor,
      'maxRatioToFloor', v_rule.max_ratio_to_floor,
      'lowBps', floor(v_rule.min_ratio_to_floor * 10000),
      'highBps', ceiling(v_rule.max_ratio_to_floor * 10000),
      'active', v_rule.active,
      'metadata', v_rule.metadata,
      'createdAt', v_rule.created_at,
      'updatedAt', v_rule.updated_at
    )
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_upsert_market_fee_rule(
  p_admin_user_id uuid,
  p_fee_rule_id uuid default null,
  p_code text default null,
  p_fee_type text default 'market_sell',
  p_currency_code text default 'KCOIN',
  p_fee_bps integer default null,
  p_min_fee numeric default 0,
  p_max_fee numeric default null,
  p_active boolean default true,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_reason text default null,
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_rule economy.fee_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_market_fee_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_code text := upper(nullif(trim(coalesce(p_code, '')), ''));
  v_fee_type text := lower(nullif(trim(coalesce(p_fee_type, 'market_sell')), ''));
  v_currency_code text := upper(nullif(trim(coalesce(p_currency_code, 'KCOIN')), ''));
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if v_fee_type <> 'market_sell' then
    raise exception 'ADMIN_MARKET_FEE_RULE_TYPE_INVALID' using errcode = 'P0001';
  end if;

  if v_currency_code <> 'KCOIN' then
    raise exception 'ADMIN_MARKET_FEE_RULE_CURRENCY_INVALID' using errcode = 'P0001';
  end if;

  if p_fee_bps is null or p_fee_bps < 0 or p_fee_bps > 3000 then
    raise exception 'ADMIN_MARKET_FEE_RULE_BPS_INVALID' using errcode = 'P0001';
  end if;

  if p_min_fee is null or p_min_fee < 0 then
    raise exception 'ADMIN_MARKET_FEE_RULE_MIN_INVALID' using errcode = 'P0001';
  end if;

  if p_max_fee is not null and p_max_fee < p_min_fee then
    raise exception 'ADMIN_MARKET_FEE_RULE_MAX_INVALID' using errcode = 'P0001';
  end if;

  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'ADMIN_MARKET_FEE_RULE_WINDOW_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_MARKET_FEE_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_fee_rule_id is not null then
    select *
    into v_rule
    from economy.fee_rules
    where id = p_fee_rule_id
    for update;
  elsif v_code is not null then
    select *
    into v_rule
    from economy.fee_rules
    where code = v_code
    for update;
  elsif coalesce(p_starts_at, v_now) <= v_now then
    select *
    into v_rule
    from economy.fee_rules
    where fee_type = v_fee_type
      and currency_code = v_currency_code
      and active = true
      and (starts_at is null or starts_at <= v_now)
      and (ends_at is null or ends_at > v_now)
    order by created_at desc
    limit 1
    for update;
  end if;

  if found then
    v_before := to_jsonb(v_rule);
  end if;

  v_code := coalesce(v_code, nullif(v_rule.code, ''), 'MARKET_SELL_FEE_' || to_char(v_now, 'YYYYMMDDHH24MISSMS'));

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'fee_rule_id', p_fee_rule_id,
    'code', v_code,
    'fee_type', v_fee_type,
    'currency_code', v_currency_code,
    'fee_bps', p_fee_bps,
    'min_fee', p_min_fee,
    'max_fee', p_max_fee,
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

  if v_rule.id is null then
    insert into economy.fee_rules (
      code,
      fee_type,
      currency_code,
      fee_bps,
      min_fee,
      max_fee,
      active,
      starts_at,
      ends_at,
      metadata,
      updated_at
    )
    values (
      v_code,
      v_fee_type,
      v_currency_code,
      p_fee_bps,
      p_min_fee,
      p_max_fee,
      v_active,
      p_starts_at,
      p_ends_at,
      v_metadata,
      v_now
    )
    returning * into v_rule;
  else
    update economy.fee_rules
    set code = v_code,
        fee_type = v_fee_type,
        currency_code = v_currency_code,
        fee_bps = p_fee_bps,
        min_fee = p_min_fee,
        max_fee = p_max_fee,
        active = v_active,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_rule.id
    returning * into v_rule;
  end if;

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.fee_rule.upsert',
    'economy',
    'fee_rules',
    v_rule.id,
    v_before,
    v_after,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    'market_price_manipulation',
    'medium',
    'open',
    'admin_market_fee_rule',
    v_rule.id,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  )
  returning id into v_risk_event_id;

  v_response := jsonb_build_object(
    'fee_rule_id', v_rule.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now,
    'rule', jsonb_build_object(
      'id', v_rule.id,
      'code', v_rule.code,
      'feeType', v_rule.fee_type,
      'currencyCode', v_rule.currency_code,
      'feeBps', v_rule.fee_bps,
      'minFee', v_rule.min_fee,
      'maxFee', v_rule.max_fee,
      'active', v_rule.active,
      'startsAt', v_rule.starts_at,
      'endsAt', v_rule.ends_at,
      'metadata', v_rule.metadata,
      'createdAt', v_rule.created_at,
      'updatedAt', v_rule.updated_at
    )
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.market_rebuild_stats_job(
  p_idempotency_key text default null,
  p_request_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_payload jsonb;
  v_start_event_id uuid;
  v_end_event_id uuid;
  v_risk_event_id uuid;
  v_status text := 'success';
  v_error text;
begin
  insert into ops.app_events (event_name, event_source, payload)
  values (
    'market_stats_rebuild_started',
    'cron.market_rebuild_stats',
    jsonb_build_object(
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'idempotency_key', nullif(trim(coalesce(p_idempotency_key, '')), ''),
      'started_at', v_started_at
    )
  )
  returning id into v_start_event_id;

  begin
    v_payload := api.market_refresh_price_stats();
  exception
    when others then
      v_status := 'failed';
      v_error := sqlerrm;
      v_payload := jsonb_build_object(
        'snapshot_at', null,
        'price_snapshot_count', 0,
        'depth_snapshot_count', 0,
        'price_health_update_count', 0,
        'error', left(v_error, 500)
      );
  end;

  v_finished_at := clock_timestamp();

  insert into ops.app_events (event_name, event_source, payload)
  values (
    case when v_status = 'success' then 'market_stats_rebuild_succeeded' else 'market_stats_rebuild_failed' end,
    'cron.market_rebuild_stats',
    jsonb_build_object(
      'request_context', coalesce(p_request_context, '{}'::jsonb),
      'idempotency_key', nullif(trim(coalesce(p_idempotency_key, '')), ''),
      'status', v_status,
      'started_at', v_started_at,
      'finished_at', v_finished_at,
      'duration_ms', floor(extract(epoch from (v_finished_at - v_started_at)) * 1000),
      'payload', v_payload,
      'error', v_error
    )
  )
  returning id into v_end_event_id;

  if v_status = 'failed' then
    insert into ops.risk_events (
      event_type,
      severity,
      status,
      source_type,
      source_id,
      score_delta,
      detail
    )
    values (
      'market_stats_rebuild_failed',
      'medium',
      'open',
      'app_event',
      v_end_event_id,
      0,
      jsonb_build_object(
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', nullif(trim(coalesce(p_idempotency_key, '')), ''),
        'start_app_event_id', v_start_event_id,
        'end_app_event_id', v_end_event_id,
        'error', left(coalesce(v_error, 'unknown'), 500)
      )
    )
    returning id into v_risk_event_id;
  end if;

  return v_payload || jsonb_build_object(
    'status', v_status,
    'start_app_event_id', v_start_event_id,
    'end_app_event_id', v_end_event_id,
    'failure_risk_event_id', v_risk_event_id,
    'server_time', v_finished_at,
    'duration_ms', floor(extract(epoch from (v_finished_at - v_started_at)) * 1000)
  );
end;
$$;

create or replace function api.admin_rebuild_market_stats(
  p_admin_user_id uuid,
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
  v_payload jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.rebuild_market_stats';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_payload := api.market_rebuild_stats_job(
    v_key,
    coalesce(p_request_context, '{}'::jsonb) || jsonb_build_object(
      'source', 'admin.manual_rebuild_market_stats',
      'admin_user_id', p_admin_user_id
    )
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.stats.rebuild',
    'market',
    'price_snapshots',
    null,
    '{}'::jsonb,
    v_payload,
    p_request_context ->> 'ip_hash',
    coalesce(nullif(p_request_context ->> 'user_agent_hash', ''), nullif(p_request_context ->> 'user_agent', '')),
    v_reason
  );

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    score_delta,
    detail
  )
  values (
    'market_price_manipulation',
    case when v_payload ->> 'status' = 'failed' then 'medium' else 'low' end,
    'open',
    'admin_market_stats_rebuild',
    null,
    0,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'reason', v_reason,
      'result', v_payload
    )
  )
  returning id into v_risk_event_id;

  v_response := v_payload || jsonb_build_object(
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_list_market_health_rules(uuid, boolean, text, uuid, uuid, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_market_fee_rule(uuid, uuid, text, text, text, integer, numeric, numeric, boolean, timestamptz, timestamptz, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.market_rebuild_stats_job(text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_rebuild_market_stats(uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_list_market_health_rules(uuid, boolean, text, uuid, uuid, integer, integer, jsonb) to service_role;
grant execute on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_upsert_market_fee_rule(uuid, uuid, text, text, text, integer, numeric, numeric, boolean, timestamptz, timestamptz, jsonb, text, text, jsonb) to service_role;
grant execute on function api.market_rebuild_stats_job(text, jsonb) to service_role;
grant execute on function api.admin_rebuild_market_stats(uuid, text, text, jsonb) to service_role;

comment on column market.price_health_rules.form_id is
  'Optional form-level override. When set, it outranks template and rarity-level health rules.';
comment on function api.admin_upsert_market_fee_rule(uuid, uuid, text, text, text, integer, numeric, numeric, boolean, timestamptz, timestamptz, jsonb, text, text, jsonb) is
  'Phase 6 audited admin write facade for economy.fee_rules market sell fees.';
comment on function api.market_rebuild_stats_job(text, jsonb) is
  'Phase 6 cron facade for market stats refresh with ops.app_events lifecycle records.';
comment on function api.admin_rebuild_market_stats(uuid, text, text, jsonb) is
  'Phase 6 audited admin manual market stats rebuild.';

commit;
