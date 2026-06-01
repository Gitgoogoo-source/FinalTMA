-- Align remote function argument defaults with the checked-in Phase 6 market
-- ops API migration. The first admin id argument must remain required.

begin;

drop function if exists api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb);
drop function if exists api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb);

create or replace function api.admin_upsert_market_price_rule(
  p_admin_user_id uuid,
  p_price_rule_id uuid default null,
  p_template_id uuid default null,
  p_rarity_code text default null,
  p_form_index integer default null,
  p_min_price_kcoin numeric default null,
  p_max_price_kcoin numeric default null,
  p_suggested_price_kcoin numeric default null,
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
  v_rule catalog.market_price_rules%rowtype;
  v_before jsonb := 'null'::jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_risk_event_id uuid;
  v_response jsonb;
  v_now timestamptz := now();
  v_scope text := 'admin.upsert_market_price_rule';
  v_request_hash text;
  v_idempotent jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_rarity_code text := upper(nullif(trim(coalesce(p_rarity_code, '')), ''));
  v_active boolean := coalesce(p_active, true);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_any_permission(v_admin.id, array['market:write', 'admin:write']);

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'ADMIN_MARKET_PRICE_RULE_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_form_index is not null and p_form_index < 1 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_FORM_INVALID' using errcode = 'P0001';
  end if;

  if p_min_price_kcoin is null or p_min_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_MIN_INVALID' using errcode = 'P0001';
  end if;

  if p_max_price_kcoin is not null and p_max_price_kcoin < p_min_price_kcoin then
    raise exception 'ADMIN_MARKET_PRICE_RULE_MAX_INVALID' using errcode = 'P0001';
  end if;

  if p_suggested_price_kcoin is not null and p_suggested_price_kcoin < 0 then
    raise exception 'ADMIN_MARKET_PRICE_RULE_SUGGESTED_INVALID' using errcode = 'P0001';
  end if;

  if p_template_id is not null
     and not exists (select 1 from catalog.collectible_templates where id = p_template_id) then
    raise exception 'ADMIN_MARKET_PRICE_RULE_TEMPLATE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_rarity_code is not null
     and not exists (select 1 from catalog.rarities where code = v_rarity_code) then
    raise exception 'ADMIN_MARKET_PRICE_RULE_RARITY_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_price_rule_id is not null then
    select *
    into v_rule
    from catalog.market_price_rules
    where id = p_price_rule_id
    for update;
  else
    select *
    into v_rule
    from catalog.market_price_rules
    where template_id is not distinct from p_template_id
      and rarity_code is not distinct from v_rarity_code
      and form_index is not distinct from p_form_index
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
    'price_rule_id', p_price_rule_id,
    'template_id', p_template_id,
    'rarity_code', v_rarity_code,
    'form_index', p_form_index,
    'min_price_kcoin', p_min_price_kcoin,
    'max_price_kcoin', p_max_price_kcoin,
    'suggested_price_kcoin', p_suggested_price_kcoin,
    'active', v_active,
    'metadata', v_metadata,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_rule.id is null then
    insert into catalog.market_price_rules (
      id,
      template_id,
      rarity_code,
      form_index,
      min_price_kcoin,
      max_price_kcoin,
      suggested_price_kcoin,
      active,
      metadata,
      updated_at
    )
    values (
      coalesce(p_price_rule_id, gen_random_uuid()),
      p_template_id,
      v_rarity_code,
      p_form_index,
      p_min_price_kcoin,
      p_max_price_kcoin,
      p_suggested_price_kcoin,
      v_active,
      v_metadata,
      v_now
    )
    returning * into v_rule;
  else
    update catalog.market_price_rules
    set template_id = p_template_id,
        rarity_code = v_rarity_code,
        form_index = p_form_index,
        min_price_kcoin = p_min_price_kcoin,
        max_price_kcoin = p_max_price_kcoin,
        suggested_price_kcoin = p_suggested_price_kcoin,
        active = v_active,
        metadata = v_metadata,
        updated_at = v_now
    where id = v_rule.id
    returning * into v_rule;
  end if;

  v_after := to_jsonb(v_rule);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'market.price_rule.upsert',
    'catalog',
    'market_price_rules',
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
    'admin_market_price_rule',
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
    'price_rule_id', v_rule.id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'risk_event_id', v_risk_event_id,
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_upsert_market_health_rule(
  p_admin_user_id uuid,
  p_health_rule_id uuid default null,
  p_rarity_code text default null,
  p_template_id uuid default null,
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
    where template_id is not distinct from p_template_id
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
    'template_id', p_template_id,
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
      min_ratio_to_floor,
      max_ratio_to_floor,
      active,
      metadata,
      updated_at
    )
    values (
      coalesce(p_health_rule_id, gen_random_uuid()),
      v_rarity_code,
      p_template_id,
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
        template_id = p_template_id,
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
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) from public, anon, authenticated;

grant execute on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) to service_role;

comment on function api.admin_upsert_market_price_rule(uuid, uuid, uuid, text, integer, numeric, numeric, numeric, boolean, jsonb, text, text, jsonb) is
  'Phase 6 audited admin write facade for catalog.market_price_rules.';
comment on function api.admin_upsert_market_health_rule(uuid, uuid, text, uuid, numeric, numeric, boolean, jsonb, text, text, jsonb) is
  'Phase 6 audited admin write facade for market.price_health_rules.';

commit;
