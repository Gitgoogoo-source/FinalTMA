-- Phase 6: complete the drop-pool publish preflight checks.
--
-- Keep this validation in the database layer because publish, approval
-- execution and direct service-role calls all converge here.

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
  v_computed_probability_sum integer := 0;
  v_probability_tolerance integer := 1;
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
  elsif v_box.status in ('draft', 'hidden', 'archived', 'disabled') then
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

  v_probability_tolerance := greatest(1, ceil(v_item_count::numeric / 2)::integer);

  if v_total_weight > 0 then
    select coalesce(sum(round((drop_weight / v_total_weight) * 10000)::integer), 0)::integer
    into v_computed_probability_sum
    from gacha.drop_pool_items
    where pool_version_id = p_drop_pool_version_id;
  end if;

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

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    where dpi.pool_version_id = p_drop_pool_version_id
      and dpi.drop_weight <= 0
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_ITEM_WEIGHT_INVALID',
      'message', 'Every reward item drop_weight must be greater than zero.',
      'field', 'items.drop_weight',
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
  elsif v_probability_count = v_item_count
    and abs(v_probability_sum - 10000) > v_probability_tolerance then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PROBABILITY_SUM_INVALID',
      'message', 'probability_bps must sum to 10000 within rounding tolerance.',
      'field', 'items.probability_bps',
      'severity', 'error',
      'actual_bps', v_probability_sum,
      'expected_bps', 10000,
      'tolerance_bps', v_probability_tolerance
    ));
  end if;

  if v_total_weight > 0
    and abs(v_computed_probability_sum - 10000) > v_probability_tolerance then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_COMPUTED_PROBABILITY_SUM_INVALID',
      'message', 'Computed probability bps must sum to 10000 within rounding tolerance.',
      'field', 'items.drop_weight',
      'severity', 'error',
      'actual_bps', v_computed_probability_sum,
      'expected_bps', 10000,
      'tolerance_bps', v_probability_tolerance
    ));
  end if;

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    where dpi.pool_version_id = p_drop_pool_version_id
      and not exists (
        select 1
        from catalog.collectible_templates ct
        where ct.id = dpi.template_id
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_TEMPLATE_NOT_FOUND',
      'message', 'Every reward template must exist.',
      'field', 'items.template_id',
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
      and dpi.form_id is null
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_FORM_REQUIRED',
      'message', 'Every reward item must reference a collectible form.',
      'field', 'items.form_id',
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

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    where dpi.pool_version_id = p_drop_pool_version_id
      and (
        dpi.stock_total < 0
        or dpi.stock_remaining < 0
        or (dpi.stock_total is not null and dpi.stock_remaining is null)
        or (dpi.stock_total is not null and dpi.stock_remaining is not null and dpi.stock_remaining > dpi.stock_total)
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_STOCK_INVALID',
      'message', 'Finite stock must be non-negative and include remaining stock not greater than total stock.',
      'field', 'items.stock',
      'severity', 'error'
    ));
  end if;

  if exists (
    select 1
    from gacha.drop_pool_items dpi
    left join lateral (
      select count(*)::integer as issued_count
      from gacha.draw_results dr
      where dr.drop_pool_item_id = dpi.id
    ) issued on true
    where dpi.pool_version_id = p_drop_pool_version_id
      and dpi.stock_total is not null
      and dpi.stock_remaining is not null
      and (dpi.stock_total - dpi.stock_remaining) < coalesce(issued.issued_count, 0)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_STOCK_BELOW_ISSUED',
      'message', 'Finite stock cannot be lower than already issued rewards.',
      'field', 'items.stock_total',
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
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_PITY_RULE_MISSING',
      'message', 'Drop pool must include an active intended pity rule before publish.',
      'field', 'pity_rules',
      'severity', 'error'
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

  if exists (
    select 1
    from gacha.drop_pool_versions other
    where other.box_id = v_version.box_id
      and other.id <> v_version.id
      and other.status = 'scheduled'
      and tstzrange(
        coalesce(v_version.effective_from, '-infinity'::timestamptz),
        coalesce(v_version.effective_to, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(
        coalesce(other.effective_from, '-infinity'::timestamptz),
        coalesce(other.effective_to, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'ADMIN_DROP_POOL_SCHEDULED_WINDOW_CONFLICT',
      'message', 'Only one scheduled drop pool version may cover the same blind box window.',
      'field', 'effective_from',
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
    'computed_probability_bps_sum', v_computed_probability_sum,
    'provided_probability_bps_sum', v_probability_sum,
    'probability_bps_tolerance', v_probability_tolerance,
    'server_time', now()
  );
end;
$$;

revoke all on function api._admin_validate_drop_pool_config(uuid)
  from public, anon, authenticated;
grant execute on function api._admin_validate_drop_pool_config(uuid)
  to service_role;

comment on function api._admin_validate_drop_pool_config(uuid)
  is 'Return complete pre-publish validation errors and warnings for a drop pool version.';
