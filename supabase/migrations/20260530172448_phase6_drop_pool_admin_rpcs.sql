-- Phase 6: drop pool draft, validation, publish and archive admin RPCs.
--
-- The admin UI already calls these RPC names. Keep every write behind the
-- api schema, service_role-only grants, idempotency, and admin audit logs.

create or replace function api._admin_require_permission(
  p_admin_user_id uuid,
  p_permission text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(trim(coalesce(p_permission, '')), '') is null then
    raise exception 'ADMIN_PERMISSION_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from ops.admin_user_roles aur
    join ops.admin_roles ar on ar.id = aur.role_id
    where aur.admin_user_id = p_admin_user_id
      and (
        ar.permissions ? '*'
        or ar.permissions ? p_permission
      )
  ) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function api._admin_drop_pool_intended_rule_active(
  p_rule gacha.pity_rules
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(p_rule.metadata #>> '{admin_draft,intended_active}', '')::boolean,
    p_rule.active
  );
$$;

create or replace function api._admin_validate_drop_pool_config(
  p_drop_pool_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version gacha.drop_pool_versions%rowtype;
  v_box gacha.blind_boxes%rowtype;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_total_weight numeric := 0;
  v_probability_count integer := 0;
  v_probability_sum integer := 0;
  v_intended_pity_count integer := 0;
begin
  if p_drop_pool_version_id is null then
    raise exception 'ADMIN_DROP_POOL_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_version
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select *
  into v_box
  from gacha.blind_boxes
  where id = v_version.box_id;

  if not found then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_BOX_NOT_FOUND',
      'message', 'Drop pool version references a missing blind box.',
      'field', 'box_id',
      'severity', 'error'
    ));
  elsif v_box.status in ('draft', 'hidden') then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_BOX_NOT_PUBLISHABLE',
      'message', 'Blind box is not publishable.',
      'field', 'box_id',
      'severity', 'error'
    ));
  end if;

  select
    count(*)::integer,
    coalesce(sum(drop_weight), 0),
    count(probability_bps)::integer,
    coalesce(sum(probability_bps), 0)::integer
  into v_item_count, v_total_weight, v_probability_count, v_probability_sum
  from gacha.drop_pool_items
  where pool_version_id = p_drop_pool_version_id;

  if v_item_count = 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_ITEMS_REQUIRED',
      'message', 'Drop pool must contain at least one reward item.',
      'field', 'items',
      'severity', 'error'
    ));
  end if;

  if v_total_weight <= 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_WEIGHT_INVALID',
      'message', 'Drop pool total weight must be greater than zero.',
      'field', 'total_weight',
      'severity', 'error'
    ));
  end if;

  if v_probability_count > 0 and v_probability_count <> v_item_count then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PROBABILITY_INCOMPLETE',
      'message', 'Either provide probability_bps for every item or for none.',
      'field', 'items.probability_bps',
      'severity', 'error'
    ));
  elsif v_probability_count = v_item_count and v_probability_sum <> 10000 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PROBABILITY_SUM_INVALID',
      'message', 'probability_bps must sum to 10000.',
      'field', 'items.probability_bps',
      'severity', 'error'
    ));
  end if;

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    join catalog.collectible_templates ct on ct.id = dpi.template_id
    where dpi.pool_version_id = p_drop_pool_version_id
      and ct.release_status <> 'active'
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_TEMPLATE_NOT_ACTIVE',
      'message', 'Every reward template must be active.',
      'field', 'items.template_id',
      'severity', 'error'
    ));
  end if;

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    join catalog.collectible_templates ct on ct.id = dpi.template_id
    where dpi.pool_version_id = p_drop_pool_version_id
      and dpi.rarity_code <> ct.rarity_code
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_RARITY_MISMATCH',
      'message', 'Reward rarity_code must match the collectible template rarity.',
      'field', 'items.rarity_code',
      'severity', 'error'
    ));
  end if;

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    where dpi.pool_version_id = p_drop_pool_version_id
      and dpi.form_id is not null
      and not exists (
        select 1
        from catalog.collectible_forms cf
        where cf.id = dpi.form_id
          and cf.template_id = dpi.template_id
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_FORM_TEMPLATE_MISMATCH',
      'message', 'Reward form must belong to the selected template.',
      'field', 'items.form_id',
      'severity', 'error'
    ));
  end if;

  if not exists (
    select 1
    from gacha.drop_pool_items
    where pool_version_id = p_drop_pool_version_id
      and is_pity_eligible = true
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PITY_ELIGIBLE_REQUIRED',
      'message', 'Drop pool must contain at least one pity eligible reward.',
      'field', 'items.is_pity_eligible',
      'severity', 'error'
    ));
  end if;

  select count(*)::integer
  into v_intended_pity_count
  from gacha.pity_rules pr
  where pr.pool_version_id = p_drop_pool_version_id
    and api._admin_drop_pool_intended_rule_active(pr);

  if v_intended_pity_count = 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PITY_RULE_MISSING',
      'message', 'Drop pool has no active intended pity rule.',
      'field', 'pity_rules',
      'severity', 'warning'
    ));
  elsif v_intended_pity_count > 1 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PITY_RULE_LIMIT',
      'message', 'Current schema allows only one active pity rule per box.',
      'field', 'pity_rules.active',
      'severity', 'error'
    ));
  end if;

  if exists (
    select 1
    from gacha.pity_rules pr
    join catalog.rarities target on target.code = pr.target_rarity_code
    where pr.pool_version_id = p_drop_pool_version_id
      and api._admin_drop_pool_intended_rule_active(pr)
      and not exists (
        select 1
        from gacha.drop_pool_items dpi
        join catalog.rarities got on got.code = dpi.rarity_code
        where dpi.pool_version_id = p_drop_pool_version_id
          and dpi.is_pity_eligible = true
          and got.sort_order >= target.sort_order
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PITY_TARGET_UNSATISFIED',
      'message', 'Pity rule target rarity has no eligible reward item.',
      'field', 'pity_rules.target_rarity_code',
      'severity', 'error'
    ));
  end if;

  return jsonb_build_object(
    'valid', jsonb_array_length(v_errors) = 0,
    'validation_errors', v_errors,
    'warnings', v_warnings,
    'item_count', v_item_count,
    'total_weight', v_total_weight,
    'computed_probability_bps', case when v_total_weight > 0 then 10000 else 0 end,
    'server_time', now()
  );
end;
$$;

create or replace function api._admin_build_drop_pool_snapshot(
  p_drop_pool_version_id uuid,
  p_admin_user_id uuid default null,
  p_validation jsonb default null,
  p_approval_context jsonb default '{}'::jsonb,
  p_published_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version gacha.drop_pool_versions%rowtype;
  v_validation jsonb := coalesce(p_validation, api._admin_validate_drop_pool_config(p_drop_pool_version_id));
begin
  select *
  into v_version
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'box_id', v_version.box_id,
    'pool_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', v_version.status,
    'published_by', p_admin_user_id,
    'published_at', p_published_at,
    'total_weight', v_version.total_weight,
    'validation', v_validation,
    'validation_hash', md5(v_validation::text),
    'approval_context', coalesce(p_approval_context, '{}'::jsonb),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', dpi.id,
            'template_id', dpi.template_id,
            'form_id', dpi.form_id,
            'rarity_code', dpi.rarity_code,
            'drop_weight', dpi.drop_weight,
            'probability_bps', dpi.probability_bps,
            'computed_probability_bps', case
              when v_version.total_weight > 0
                then round((dpi.drop_weight / v_version.total_weight) * 10000)::integer
              else 0
            end,
            'stock_total', dpi.stock_total,
            'stock_remaining', dpi.stock_remaining,
            'is_pity_eligible', dpi.is_pity_eligible,
            'is_featured', dpi.is_featured,
            'sort_order', dpi.sort_order
          )
          order by dpi.sort_order, dpi.created_at, dpi.id
        )
        from gacha.drop_pool_items dpi
        where dpi.pool_version_id = p_drop_pool_version_id
      ),
      '[]'::jsonb
    ),
    'pity_rules', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', pr.id,
            'rule_name', pr.rule_name,
            'threshold', pr.threshold,
            'target_rarity_code', pr.target_rarity_code,
            'reset_on_rarity_code', pr.reset_on_rarity_code,
            'guaranteed_template_id', pr.guaranteed_template_id,
            'guaranteed_form_id', pr.guaranteed_form_id,
            'priority', pr.priority,
            'active', api._admin_drop_pool_intended_rule_active(pr)
          )
          order by pr.priority, pr.created_at, pr.id
        )
        from gacha.pity_rules pr
        where pr.pool_version_id = p_drop_pool_version_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function api.admin_create_drop_pool_draft(
  p_admin_user_id uuid,
  p_box_id uuid,
  p_source_version_id uuid default null,
  p_version_name text default null,
  p_items jsonb default null,
  p_pity_rules jsonb default null,
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
  v_box gacha.blind_boxes%rowtype;
  v_source gacha.drop_pool_versions%rowtype;
  v_version gacha.drop_pool_versions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_version_name text := nullif(trim(coalesce(p_version_name, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.create_drop_pool_draft';
  v_request_hash text;
  v_idempotent jsonb;
  v_next_version_no integer;
  v_items jsonb;
  v_pity_rules jsonb;
  v_audit jsonb;
  v_validation jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_box_id is null then
    raise exception 'ADMIN_BOX_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_box
  from gacha.blind_boxes
  where id = p_box_id
  for update;

  if not found then
    raise exception 'ADMIN_BOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_source_version_id is not null then
    select *
    into v_source
    from gacha.drop_pool_versions
    where id = p_source_version_id;

    if not found then
      raise exception 'ADMIN_DROP_POOL_SOURCE_NOT_FOUND' using errcode = 'P0001';
    end if;

    if v_source.box_id <> p_box_id then
      raise exception 'ADMIN_DROP_POOL_SOURCE_BOX_MISMATCH' using errcode = 'P0001';
    end if;

    if v_source.status not in ('active', 'archived') then
      raise exception 'ADMIN_DROP_POOL_SOURCE_STATUS_INVALID' using errcode = 'P0001';
    end if;
  end if;

  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'ADMIN_DROP_POOL_ITEMS_INVALID' using errcode = 'P0001';
  end if;

  if p_pity_rules is not null and jsonb_typeof(p_pity_rules) <> 'array' then
    raise exception 'ADMIN_DROP_POOL_PITY_RULES_INVALID' using errcode = 'P0001';
  end if;

  v_items := p_items;
  v_pity_rules := p_pity_rules;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'box_id', p_box_id,
    'source_version_id', p_source_version_id,
    'version_name', v_version_name,
    'items', coalesce(v_items, 'null'::jsonb),
    'pity_rules', coalesce(v_pity_rules, 'null'::jsonb),
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select coalesce(max(version_no), 0) + 1
  into v_next_version_no
  from gacha.drop_pool_versions
  where box_id = p_box_id;

  insert into gacha.drop_pool_versions (
    box_id,
    version_no,
    status,
    total_weight,
    config_snapshot,
    created_by_admin_id
  )
  values (
    p_box_id,
    v_next_version_no,
    'draft',
    0,
    jsonb_build_object(
      'draft', jsonb_build_object(
        'version_name', v_version_name,
        'source_version_id', p_source_version_id,
        'created_by_admin_id', p_admin_user_id,
        'created_at', v_now
      )
    ),
    p_admin_user_id
  )
  returning * into v_version;

  if v_items is not null then
    insert into gacha.drop_pool_items (
      id,
      pool_version_id,
      template_id,
      form_id,
      rarity_code,
      drop_weight,
      probability_bps,
      stock_total,
      stock_remaining,
      is_pity_eligible,
      is_featured,
      sort_order,
      metadata
    )
    select
      coalesce(item.id, gen_random_uuid()),
      v_version.id,
      item.template_id,
      item.form_id,
      upper(trim(item.rarity_code)),
      item.drop_weight,
      item.probability_bps,
      item.stock_total,
      item.stock_remaining,
      coalesce(item.is_pity_eligible, true),
      coalesce(item.is_featured, false),
      coalesce(item.sort_order, 100),
      coalesce(item.metadata, '{}'::jsonb)
    from jsonb_to_recordset(v_items) as item(
      id uuid,
      template_id uuid,
      form_id uuid,
      rarity_code text,
      drop_weight numeric,
      probability_bps integer,
      stock_total integer,
      stock_remaining integer,
      is_pity_eligible boolean,
      is_featured boolean,
      sort_order integer,
      metadata jsonb
    );
  elsif p_source_version_id is not null then
    insert into gacha.drop_pool_items (
      pool_version_id,
      template_id,
      form_id,
      rarity_code,
      drop_weight,
      probability_bps,
      stock_total,
      stock_remaining,
      is_pity_eligible,
      is_featured,
      sort_order,
      metadata
    )
    select
      v_version.id,
      template_id,
      form_id,
      rarity_code,
      drop_weight,
      probability_bps,
      stock_total,
      stock_remaining,
      is_pity_eligible,
      is_featured,
      sort_order,
      metadata || jsonb_build_object('source_drop_pool_item_id', id)
    from gacha.drop_pool_items
    where pool_version_id = p_source_version_id
    order by sort_order, created_at, id;
  end if;

  if v_pity_rules is not null then
    insert into gacha.pity_rules (
      id,
      box_id,
      pool_version_id,
      rule_name,
      threshold,
      target_rarity_code,
      reset_on_rarity_code,
      guaranteed_template_id,
      guaranteed_form_id,
      priority,
      active,
      metadata
    )
    select
      coalesce(rule.id, gen_random_uuid()),
      p_box_id,
      v_version.id,
      rule.rule_name,
      rule.threshold,
      upper(trim(rule.target_rarity_code)),
      nullif(upper(trim(coalesce(rule.reset_on_rarity_code, ''))), ''),
      rule.guaranteed_template_id,
      rule.guaranteed_form_id,
      coalesce(rule.priority, 100),
      false,
      coalesce(rule.metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_draft',
        jsonb_build_object('intended_active', coalesce(rule.active, true))
      )
    from jsonb_to_recordset(v_pity_rules) as rule(
      id uuid,
      rule_name text,
      threshold integer,
      target_rarity_code text,
      reset_on_rarity_code text,
      guaranteed_template_id uuid,
      guaranteed_form_id uuid,
      priority integer,
      active boolean,
      metadata jsonb
    );
  elsif p_source_version_id is not null then
    insert into gacha.pity_rules (
      box_id,
      pool_version_id,
      rule_name,
      threshold,
      target_rarity_code,
      reset_on_rarity_code,
      guaranteed_template_id,
      guaranteed_form_id,
      priority,
      active,
      metadata
    )
    select
      p_box_id,
      v_version.id,
      rule_name,
      threshold,
      target_rarity_code,
      reset_on_rarity_code,
      guaranteed_template_id,
      guaranteed_form_id,
      priority,
      false,
      metadata || jsonb_build_object(
        'source_pity_rule_id', id,
        'admin_draft', jsonb_build_object('intended_active', active)
      )
    from gacha.pity_rules
    where pool_version_id = p_source_version_id
    order by priority, created_at, id;
  end if;

  select *
  into v_version
  from gacha.drop_pool_versions
  where id = v_version.id;

  v_validation := api._admin_validate_drop_pool_config(v_version.id);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.draft_create',
    'gacha',
    'drop_pool_versions',
    v_version.id,
    jsonb_build_object('source_version_id', p_source_version_id),
    jsonb_build_object(
      'version', to_jsonb(v_version),
      'validation', v_validation
    ),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', p_box_id,
    'drop_pool_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', v_version.status,
    'item_count', (select count(*) from gacha.drop_pool_items where pool_version_id = v_version.id),
    'total_weight', v_version.total_weight,
    'validation', v_validation,
    'validation_errors', v_validation -> 'validation_errors',
    'warnings', v_validation -> 'warnings',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_update_drop_pool_item(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
  p_box_id uuid default null,
  p_version_name text default null,
  p_items jsonb default '[]'::jsonb,
  p_pity_rules jsonb default '[]'::jsonb,
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
  v_before gacha.drop_pool_versions%rowtype;
  v_after gacha.drop_pool_versions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_version_name text := nullif(trim(coalesce(p_version_name, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.update_drop_pool_item';
  v_request_hash text;
  v_idempotent jsonb;
  v_before_state jsonb;
  v_after_state jsonb;
  v_validation jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_drop_pool_version_id is null then
    raise exception 'ADMIN_DROP_POOL_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'ADMIN_DROP_POOL_ITEMS_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_pity_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'ADMIN_DROP_POOL_PITY_RULES_INVALID' using errcode = 'P0001';
  end if;

  select *
  into v_before
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_box_id is not null and v_before.box_id <> p_box_id then
    raise exception 'ADMIN_DROP_POOL_BOX_MISMATCH' using errcode = 'P0001';
  end if;

  if v_before.status not in ('draft', 'validating') then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'box_id', p_box_id,
    'version_name', v_version_name,
    'items', coalesce(p_items, '[]'::jsonb),
    'pity_rules', coalesce(p_pity_rules, '[]'::jsonb),
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_before_state := jsonb_build_object(
    'version', to_jsonb(v_before),
    'items', coalesce((
      select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at, dpi.id)
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb),
    'pity_rules', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.priority, pr.created_at, pr.id)
      from gacha.pity_rules pr
      where pr.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb)
  );

  delete from gacha.drop_pool_items
  where pool_version_id = p_drop_pool_version_id;

  insert into gacha.drop_pool_items (
    id,
    pool_version_id,
    template_id,
    form_id,
    rarity_code,
    drop_weight,
    probability_bps,
    stock_total,
    stock_remaining,
    is_pity_eligible,
    is_featured,
    sort_order,
    metadata
  )
  select
    coalesce(item.id, gen_random_uuid()),
    p_drop_pool_version_id,
    item.template_id,
    item.form_id,
    upper(trim(item.rarity_code)),
    item.drop_weight,
    item.probability_bps,
    item.stock_total,
    item.stock_remaining,
    coalesce(item.is_pity_eligible, true),
    coalesce(item.is_featured, false),
    coalesce(item.sort_order, 100),
    coalesce(item.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item(
    id uuid,
    template_id uuid,
    form_id uuid,
    rarity_code text,
    drop_weight numeric,
    probability_bps integer,
    stock_total integer,
    stock_remaining integer,
    is_pity_eligible boolean,
    is_featured boolean,
    sort_order integer,
    metadata jsonb
  );

  delete from gacha.pity_rules
  where pool_version_id = p_drop_pool_version_id;

  insert into gacha.pity_rules (
    id,
    box_id,
    pool_version_id,
    rule_name,
    threshold,
    target_rarity_code,
    reset_on_rarity_code,
    guaranteed_template_id,
    guaranteed_form_id,
    priority,
    active,
    metadata
  )
  select
    coalesce(rule.id, gen_random_uuid()),
    v_before.box_id,
    p_drop_pool_version_id,
    rule.rule_name,
    rule.threshold,
    upper(trim(rule.target_rarity_code)),
    nullif(upper(trim(coalesce(rule.reset_on_rarity_code, ''))), ''),
    rule.guaranteed_template_id,
    rule.guaranteed_form_id,
    coalesce(rule.priority, 100),
    false,
    coalesce(rule.metadata, '{}'::jsonb) || jsonb_build_object(
      'admin_draft',
      jsonb_build_object('intended_active', coalesce(rule.active, true))
    )
  from jsonb_to_recordset(coalesce(p_pity_rules, '[]'::jsonb)) as rule(
    id uuid,
    rule_name text,
    threshold integer,
    target_rarity_code text,
    reset_on_rarity_code text,
    guaranteed_template_id uuid,
    guaranteed_form_id uuid,
    priority integer,
    active boolean,
    metadata jsonb
  );

  update gacha.drop_pool_versions
  set config_snapshot = config_snapshot || jsonb_build_object(
        'draft',
        coalesce(config_snapshot -> 'draft', '{}'::jsonb) || jsonb_build_object(
          'version_name', v_version_name,
          'updated_by_admin_id', p_admin_user_id,
          'updated_at', v_now
        )
      ),
      updated_at = v_now
  where id = p_drop_pool_version_id
  returning * into v_after;

  v_validation := api._admin_validate_drop_pool_config(p_drop_pool_version_id);

  v_after_state := jsonb_build_object(
    'version', to_jsonb(v_after),
    'items', coalesce((
      select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at, dpi.id)
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb),
    'pity_rules', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.priority, pr.created_at, pr.id)
      from gacha.pity_rules pr
      where pr.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb),
    'validation', v_validation
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.draft_update',
    'gacha',
    'drop_pool_versions',
    p_drop_pool_version_id,
    v_before_state,
    v_after_state,
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', v_after.box_id,
    'drop_pool_version_id', v_after.id,
    'version_no', v_after.version_no,
    'status', v_after.status,
    'item_count', (select count(*) from gacha.drop_pool_items where pool_version_id = v_after.id),
    'total_weight', v_after.total_weight,
    'validation', v_validation,
    'validation_errors', v_validation -> 'validation_errors',
    'warnings', v_validation -> 'warnings',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_validate_drop_pool(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
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
  v_version gacha.drop_pool_versions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.validate_drop_pool';
  v_request_hash text;
  v_idempotent jsonb;
  v_validation jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_drop_pool_version_id is null then
    raise exception 'ADMIN_DROP_POOL_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_version
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_validation := api._admin_validate_drop_pool_config(p_drop_pool_version_id);

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.validate',
    'gacha',
    'drop_pool_versions',
    p_drop_pool_version_id,
    jsonb_build_object('version', to_jsonb(v_version)),
    jsonb_build_object('validation', v_validation),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := v_validation || jsonb_build_object(
    'drop_pool_version_id', p_drop_pool_version_id,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

drop function if exists api.admin_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb);
drop function if exists api._admin_execute_publish_drop_pool_version(uuid, uuid, jsonb, text, text, jsonb, jsonb);

create or replace function api._admin_execute_publish_drop_pool_version(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin ops.admin_users%rowtype;
  v_version gacha.drop_pool_versions%rowtype;
  v_active_version gacha.drop_pool_versions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.publish_drop_pool_version';
  v_request_hash text;
  v_idempotent jsonb;
  v_validation jsonb;
  v_snapshot jsonb;
  v_before jsonb;
  v_after jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_drop_pool_version_id is null then
    raise exception 'ADMIN_DROP_POOL_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_version
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_version.status not in ('draft', 'validating', 'scheduled') then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_PUBLISHABLE' using errcode = 'P0001';
  end if;

  select *
  into v_active_version
  from gacha.drop_pool_versions
  where box_id = v_version.box_id
    and status = 'active'
  for update;

  if v_active_version.id = v_version.id then
    raise exception 'ADMIN_DROP_POOL_VERSION_ALREADY_ACTIVE' using errcode = 'P0001';
  end if;

  v_validation := api._admin_validate_drop_pool_config(p_drop_pool_version_id);
  if not coalesce((v_validation ->> 'valid')::boolean, false) then
    raise exception 'ADMIN_DROP_POOL_VALIDATION_FAILED' using errcode = 'P0001';
  end if;

  v_before := jsonb_build_object(
    'active_version', case
      when v_active_version.id is null then 'null'::jsonb
      else to_jsonb(v_active_version)
    end,
    'draft_version', to_jsonb(v_version),
    'draft_items', coalesce((
      select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at, dpi.id)
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb),
    'draft_pity_rules', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.priority, pr.created_at, pr.id)
      from gacha.pity_rules pr
      where pr.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb)
  );

  update gacha.drop_pool_versions
  set status = 'archived',
      effective_to = coalesce(effective_to, v_now),
      updated_at = v_now
  where box_id = v_version.box_id
    and status = 'active'
    and id <> p_drop_pool_version_id;

  update gacha.pity_rules
  set active = false,
      updated_at = v_now
  where box_id = v_version.box_id
    and active = true
    and coalesce(pool_version_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_drop_pool_version_id;

  update gacha.pity_rules pr
  set active = api._admin_drop_pool_intended_rule_active(pr),
      updated_at = v_now,
      metadata = pr.metadata || jsonb_build_object(
        'published_by_admin_id', p_admin_user_id,
        'published_at', v_now
      )
  where pr.pool_version_id = p_drop_pool_version_id;

  update gacha.drop_pool_versions
  set status = 'active',
      published_at = coalesce(published_at, v_now),
      effective_from = coalesce(effective_from, v_now),
      effective_to = null,
      created_by_admin_id = coalesce(created_by_admin_id, p_admin_user_id),
      updated_at = v_now
  where id = p_drop_pool_version_id
  returning * into v_version;

  v_snapshot := api._admin_build_drop_pool_snapshot(
    p_drop_pool_version_id,
    p_admin_user_id,
    v_validation,
    p_approval_context,
    v_now
  );

  update gacha.drop_pool_versions
  set config_snapshot = config_snapshot || jsonb_build_object(
        'published', v_snapshot,
        'reason', v_reason,
        'idempotency_key', v_key,
        'previous_version_id', v_active_version.id
      ),
      updated_at = v_now
  where id = p_drop_pool_version_id
  returning * into v_version;

  insert into ops.risk_events (
    event_type,
    severity,
    status,
    source_type,
    source_id,
    detail
  )
  values (
    'admin_drop_pool_published',
    'high',
    'reviewing',
    'drop_pool_version',
    p_drop_pool_version_id,
    jsonb_build_object(
      'admin_user_id', p_admin_user_id,
      'box_id', v_version.box_id,
      'previous_version_id', v_active_version.id,
      'new_version_id', v_version.id,
      'version_no', v_version.version_no,
      'total_weight', v_version.total_weight,
      'reason', v_reason,
      'idempotency_key', v_key,
      'approval_context', coalesce(p_approval_context, '{}'::jsonb)
    )
  );

  v_after := jsonb_build_object(
    'published_version', to_jsonb(v_version),
    'snapshot', v_snapshot,
    'items', coalesce((
      select jsonb_agg(to_jsonb(dpi) order by dpi.sort_order, dpi.created_at, dpi.id)
      from gacha.drop_pool_items dpi
      where dpi.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb),
    'pity_rules', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.priority, pr.created_at, pr.id)
      from gacha.pity_rules pr
      where pr.pool_version_id = p_drop_pool_version_id
    ), '[]'::jsonb)
  );

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.publish',
    'gacha',
    'drop_pool_versions',
    p_drop_pool_version_id,
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
    'box_id', v_version.box_id,
    'previous_version_id', v_active_version.id,
    'drop_pool_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', v_version.status,
    'item_count', (select count(*) from gacha.drop_pool_items where pool_version_id = v_version.id),
    'total_weight', v_version.total_weight,
    'validation', v_validation,
    'validation_errors', v_validation -> 'validation_errors',
    'warnings', v_validation -> 'warnings',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_publish_drop_pool_version(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_approval_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if api._admin_requires_approval(p_approval_context) then
    return api.admin_create_approval_request(
      p_admin_user_id => p_admin_user_id,
      p_action => 'gacha.drop_pool.publish',
      p_target_schema => 'gacha',
      p_target_table => 'drop_pool_versions',
      p_target_id => p_drop_pool_version_id,
      p_payload => jsonb_build_object(
        'rpc', 'admin_publish_drop_pool_version',
        'drop_pool_version_id', p_drop_pool_version_id,
        'request_context', coalesce(p_request_context, '{}'::jsonb),
        'idempotency_key', p_idempotency_key
      ),
      p_reason => p_reason,
      p_idempotency_key => 'approval_request:' || nullif(trim(coalesce(p_idempotency_key, '')), ''),
      p_request_context => p_request_context
    );
  end if;

  return api._admin_execute_publish_drop_pool_version(
    p_admin_user_id,
    p_drop_pool_version_id,
    p_reason,
    p_idempotency_key,
    p_request_context,
    p_approval_context
  );
end;
$$;

create or replace function api.admin_archive_drop_pool_version(
  p_admin_user_id uuid,
  p_drop_pool_version_id uuid,
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
  v_before gacha.drop_pool_versions%rowtype;
  v_after gacha.drop_pool_versions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_now timestamptz := now();
  v_scope text := 'admin.archive_drop_pool_version';
  v_request_hash text;
  v_idempotent jsonb;
  v_open_order_count integer := 0;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);
  perform api._admin_require_permission(v_admin.id, 'gacha:write');

  if p_drop_pool_version_id is null then
    raise exception 'ADMIN_DROP_POOL_VERSION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_reason is null then
    raise exception 'ADMIN_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_before
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id
  for update;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'action', v_scope,
    'admin_user_id', p_admin_user_id,
    'drop_pool_version_id', p_drop_pool_version_id,
    'reason', v_reason
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  if v_before.status = 'archived' then
    v_audit := api.admin_write_audit_log(
      p_admin_user_id,
      'gacha.drop_pool.archive',
      'gacha',
      'drop_pool_versions',
      p_drop_pool_version_id,
      to_jsonb(v_before),
      to_jsonb(v_before),
      p_request_context ->> 'ip_hash',
      coalesce(
        nullif(p_request_context ->> 'user_agent_hash', ''),
        nullif(p_request_context ->> 'user_agent', '')
      ),
      v_reason
    );

    v_response := jsonb_build_object(
      'box_id', v_before.box_id,
      'drop_pool_version_id', v_before.id,
      'version_no', v_before.version_no,
      'status', v_before.status,
      'audit_log_id', v_audit ->> 'audit_log_id',
      'idempotent', false,
      'server_time', v_now
    );

    perform api._admin_complete_idempotency(v_key, v_response, v_now);
    return v_response;
  end if;

  if v_before.status = 'active' then
    select count(*)::integer
    into v_open_order_count
    from gacha.draw_orders
    where pool_version_id = p_drop_pool_version_id
      and status not in ('opened', 'completed', 'cancelled', 'failed', 'expired');

    if v_open_order_count > 0 then
      raise exception 'ADMIN_DROP_POOL_ACTIVE_HAS_OPEN_ORDERS' using errcode = 'P0001';
    end if;
  end if;

  update gacha.drop_pool_versions
  set status = 'archived',
      effective_to = coalesce(effective_to, v_now),
      updated_at = v_now,
      config_snapshot = config_snapshot || jsonb_build_object(
        'archived', jsonb_build_object(
          'archived_by_admin_id', p_admin_user_id,
          'archived_at', v_now,
          'reason', v_reason,
          'open_order_count', v_open_order_count
        )
      )
  where id = p_drop_pool_version_id
  returning * into v_after;

  if v_before.status = 'active' then
    update gacha.pity_rules
    set active = false,
        updated_at = v_now
    where pool_version_id = p_drop_pool_version_id
      and active = true;
  end if;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'gacha.drop_pool.archive',
    'gacha',
    'drop_pool_versions',
    p_drop_pool_version_id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    v_reason
  );

  v_response := jsonb_build_object(
    'box_id', v_after.box_id,
    'drop_pool_version_id', v_after.id,
    'version_no', v_after.version_no,
    'status', v_after.status,
    'open_order_count', v_open_order_count,
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

create or replace function api.admin_execute_approval_request(
  p_admin_user_id uuid,
  p_approval_request_id uuid,
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
  v_before ops.admin_approval_requests%rowtype;
  v_after ops.admin_approval_requests%rowtype;
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_scope text := 'admin.approval.execute';
  v_request_hash text;
  v_idempotent jsonb;
  v_now timestamptz := now();
  v_approval_context jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_audit jsonb;
  v_response jsonb;
begin
  v_admin := api._admin_require_active(p_admin_user_id);

  if p_approval_request_id is null then
    raise exception 'ADMIN_APPROVAL_REQUEST_REQUIRED' using errcode = 'P0001';
  end if;

  if v_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  select *
  into v_before
  from ops.admin_approval_requests
  where id = p_approval_request_id
  for update;

  if not found then
    raise exception 'ADMIN_APPROVAL_REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.status = 'executed' and v_before.execution_result is not null then
    return v_before.execution_result || jsonb_build_object('idempotent', true);
  end if;

  if v_before.status <> 'approved' then
    raise exception 'ADMIN_APPROVAL_NOT_APPROVED' using errcode = 'P0001';
  end if;

  if v_before.approver_admin_user_id is null then
    raise exception 'ADMIN_APPROVER_REQUIRED' using errcode = 'P0001';
  end if;

  if v_before.approver_admin_user_id <> p_admin_user_id then
    raise exception 'ADMIN_APPROVAL_EXECUTOR_MUST_BE_APPROVER' using errcode = 'P0001';
  end if;

  v_request_hash := jsonb_build_object(
    'approval_request_id', p_approval_request_id,
    'executor_admin_user_id', p_admin_user_id,
    'action', v_before.action,
    'operation_idempotency_key', v_before.operation_idempotency_key
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  v_payload := coalesce(v_before.payload, '{}'::jsonb);
  v_approval_context := jsonb_build_object(
    'approvalStatus', 'approved',
    'approvalRequestId', v_before.id,
    'requestedByAdminId', v_before.requester_admin_user_id,
    'approvedByAdminId', v_before.approver_admin_user_id,
    'executedByAdminId', p_admin_user_id,
    'reviewReason', v_before.review_reason,
    'originalRequestContext', coalesce(v_payload -> 'request_context', '{}'::jsonb)
  );

  case v_before.action
    when 'asset.compensate' then
      v_result := api._admin_execute_compensate_asset(
        p_admin_user_id => p_admin_user_id,
        p_user_id => nullif(v_payload ->> 'user_id', '')::uuid,
        p_currency_code => v_payload ->> 'currency_code',
        p_amount => nullif(v_payload ->> 'amount', '')::numeric,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_metadata => coalesce(v_payload -> 'metadata', '{}'::jsonb),
        p_approval_context => v_approval_context
      );
    when 'user.ban' then
      v_result := api._admin_execute_ban_user(
        p_admin_user_id => p_admin_user_id,
        p_user_id => nullif(v_payload ->> 'user_id', '')::uuid,
        p_status => v_payload ->> 'status',
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'payment.refund.request' then
      v_result := api._admin_execute_request_star_refund(
        p_admin_user_id => p_admin_user_id,
        p_star_order_id => nullif(v_payload ->> 'star_order_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'inventory.lock.release' then
      v_result := api._admin_execute_release_inventory_lock(
        p_admin_user_id => p_admin_user_id,
        p_lock_id => nullif(v_payload ->> 'lock_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    when 'gacha.drop_pool.publish' then
      v_result := api._admin_execute_publish_drop_pool_version(
        p_admin_user_id => p_admin_user_id,
        p_drop_pool_version_id => nullif(v_payload ->> 'drop_pool_version_id', '')::uuid,
        p_reason => v_before.reason,
        p_idempotency_key => v_before.operation_idempotency_key,
        p_request_context => p_request_context,
        p_approval_context => v_approval_context
      );
    else
      raise exception 'ADMIN_APPROVAL_ACTION_UNSUPPORTED' using errcode = 'P0001';
  end case;

  update ops.admin_approval_requests
  set status = 'executed',
      executed_by_admin_user_id = p_admin_user_id,
      executed_at = v_now,
      execution_result = v_result,
      updated_at = v_now
  where id = v_before.id
  returning * into v_after;

  v_audit := api.admin_write_audit_log(
    p_admin_user_id,
    'approval.execute',
    'ops',
    'admin_approval_requests',
    v_after.id,
    to_jsonb(v_before),
    to_jsonb(v_after) || jsonb_build_object('business_result', v_result),
    p_request_context ->> 'ip_hash',
    coalesce(
      nullif(p_request_context ->> 'user_agent_hash', ''),
      nullif(p_request_context ->> 'user_agent', '')
    ),
    coalesce(v_before.review_reason, v_before.reason)
  );

  update ops.admin_approval_requests
  set execute_audit_log_id = nullif(v_audit ->> 'audit_log_id', '')::uuid,
      updated_at = v_now
  where id = v_after.id
  returning * into v_after;

  v_response := jsonb_build_object(
    'approval_request_id', v_after.id,
    'status', v_after.status,
    'action', v_after.action,
    'business_result', v_result,
    'business_audit_log_id', v_result ->> 'audit_log_id',
    'audit_log_id', v_audit ->> 'audit_log_id',
    'idempotent', false,
    'server_time', v_now
  );

  update ops.admin_approval_requests
  set execution_result = v_response,
      updated_at = v_now
  where id = v_after.id;

  perform api._admin_complete_idempotency(v_key, v_response, v_now);
  return v_response;
end;
$$;

revoke all on function api._admin_require_permission(uuid, text) from public, anon, authenticated;
revoke all on function api._admin_drop_pool_intended_rule_active(gacha.pity_rules) from public, anon, authenticated;
revoke all on function api._admin_validate_drop_pool_config(uuid) from public, anon, authenticated;
revoke all on function api._admin_build_drop_pool_snapshot(uuid, uuid, jsonb, jsonb, timestamptz) from public, anon, authenticated;

revoke all on function api.admin_create_drop_pool_draft(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_update_drop_pool_item(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb) from public, anon, authenticated;
revoke all on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function api._admin_execute_publish_drop_pool_version(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_publish_drop_pool_version(uuid, uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function api.admin_archive_drop_pool_version(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

grant execute on function api._admin_require_permission(uuid, text) to service_role;
grant execute on function api._admin_drop_pool_intended_rule_active(gacha.pity_rules) to service_role;
grant execute on function api._admin_validate_drop_pool_config(uuid) to service_role;
grant execute on function api._admin_build_drop_pool_snapshot(uuid, uuid, jsonb, jsonb, timestamptz) to service_role;

grant execute on function api.admin_create_drop_pool_draft(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_update_drop_pool_item(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb) to service_role;
grant execute on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function api._admin_execute_publish_drop_pool_version(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_publish_drop_pool_version(uuid, uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function api.admin_archive_drop_pool_version(uuid, uuid, text, text, jsonb) to service_role;

comment on function api.admin_create_drop_pool_draft(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb)
  is 'Create a drop pool draft from an active/archived source version or from supplied items.';

comment on function api.admin_update_drop_pool_item(uuid, uuid, uuid, text, jsonb, jsonb, text, text, jsonb)
  is 'Replace editable draft drop pool items and pity rules; active/archived versions are immutable.';

comment on function api.admin_validate_drop_pool(uuid, uuid, text, text, jsonb)
  is 'Validate a drop pool version and write admin audit without changing active production state.';

comment on function api.admin_publish_drop_pool_version(uuid, uuid, text, text, jsonb, jsonb)
  is 'Publish an editable drop pool version, archive the previous active version, snapshot configuration and audit the change.';

comment on function api.admin_archive_drop_pool_version(uuid, uuid, text, text, jsonb)
  is 'Archive a drop pool version. Active versions with unfinished orders are rejected.';
