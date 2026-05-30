-- Phase 6: make published drop-pool config snapshots complete enough for
-- probability, stock, pity and draw-audit traceability reviews.

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
  v_total_weight numeric := 0;
  v_item_count integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_stock jsonb := '{}'::jsonb;
  v_pity_rules jsonb := '[]'::jsonb;
  v_pity jsonb := '{}'::jsonb;
  v_validation_hash text;
begin
  select *
  into v_version
  from gacha.drop_pool_versions
  where id = p_drop_pool_version_id;

  if not found then
    raise exception 'ADMIN_DROP_POOL_VERSION_NOT_FOUND' using errcode = 'P0001';
  end if;

  select
    count(*)::integer,
    coalesce(sum(drop_weight), 0)
  into v_item_count, v_total_weight
  from gacha.drop_pool_items
  where pool_version_id = p_drop_pool_version_id;

  v_validation_hash := md5(v_validation::text);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'template_id', item.template_id,
        'form_id', item.form_id,
        'rarity_code', item.rarity_code,
        'drop_weight', item.drop_weight,
        'weight', item.drop_weight,
        'probability_bps', item.probability_bps,
        'configured_probability_bps', item.probability_bps,
        'computed_probability_bps', item.computed_probability_bps,
        'effective_probability_bps', coalesce(item.probability_bps, item.computed_probability_bps),
        'probability_source', case
          when item.probability_bps is null then 'computed_from_weight'
          else 'configured'
        end,
        'stock_total', item.stock_total,
        'stock_remaining', item.stock_remaining,
        'stock', jsonb_build_object(
          'total', item.stock_total,
          'remaining', item.stock_remaining,
          'issued_count', item.issued_count,
          'unlimited', item.stock_total is null
        ),
        'is_pity_eligible', item.is_pity_eligible,
        'is_featured', item.is_featured,
        'sort_order', item.sort_order
      )
      order by item.sort_order, item.created_at, item.id
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      dpi.id,
      dpi.template_id,
      dpi.form_id,
      dpi.rarity_code,
      dpi.drop_weight,
      dpi.probability_bps,
      case
        when v_total_weight > 0 then round((dpi.drop_weight / v_total_weight) * 10000)::integer
        else 0
      end as computed_probability_bps,
      dpi.stock_total,
      dpi.stock_remaining,
      coalesce(issued.issued_count, 0) as issued_count,
      dpi.is_pity_eligible,
      dpi.is_featured,
      dpi.sort_order,
      dpi.created_at
    from gacha.drop_pool_items dpi
    left join lateral (
      select count(*)::integer as issued_count
      from gacha.draw_results dr
      where dr.drop_pool_item_id = dpi.id
    ) issued on true
    where dpi.pool_version_id = p_drop_pool_version_id
  ) item;

  select jsonb_build_object(
    'finite_item_count', count(*) filter (where dpi.stock_total is not null),
    'unlimited_item_count', count(*) filter (where dpi.stock_total is null),
    'total_configured_stock', coalesce(sum(dpi.stock_total), 0),
    'total_remaining_stock', coalesce(sum(dpi.stock_remaining), 0),
    'total_issued_count', coalesce(sum(coalesce(issued.issued_count, 0)), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'drop_pool_item_id', dpi.id,
          'template_id', dpi.template_id,
          'form_id', dpi.form_id,
          'stock_total', dpi.stock_total,
          'stock_remaining', dpi.stock_remaining,
          'issued_count', coalesce(issued.issued_count, 0),
          'unlimited', dpi.stock_total is null
        )
        order by dpi.sort_order, dpi.created_at, dpi.id
      ),
      '[]'::jsonb
    )
  )
  into v_stock
  from gacha.drop_pool_items dpi
  left join lateral (
    select count(*)::integer as issued_count
    from gacha.draw_results dr
    where dr.drop_pool_item_id = dpi.id
  ) issued on true
  where dpi.pool_version_id = p_drop_pool_version_id;

  select coalesce(
    jsonb_agg(
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
    ),
    '[]'::jsonb
  )
  into v_pity_rules
  from gacha.pity_rules pr
  where pr.pool_version_id = p_drop_pool_version_id;

  select jsonb_build_object(
    'rule_count', count(*)::integer,
    'active_rule_count', count(*) filter (where api._admin_drop_pool_intended_rule_active(pr)),
    'rules', v_pity_rules
  )
  into v_pity
  from gacha.pity_rules pr
  where pr.pool_version_id = p_drop_pool_version_id;

  return jsonb_build_object(
    'schema_version', 2,
    'snapshot_type', 'drop_pool_publish_config',
    'generated_at', p_published_at,
    'box_id', v_version.box_id,
    'pool_version_id', v_version.id,
    'version_no', v_version.version_no,
    'status', v_version.status,
    'published_by', p_admin_user_id,
    'published_by_admin_id', p_admin_user_id,
    'published_at', p_published_at,
    'weight', jsonb_build_object(
      'total_weight', v_total_weight,
      'recorded_total_weight', v_version.total_weight,
      'item_count', v_item_count
    ),
    'total_weight', v_total_weight,
    'probability', jsonb_build_object(
      'scale_bps', 10000,
      'source', 'server_computed_from_drop_pool_items',
      'computed_probability_bps_sum', coalesce(v_validation ->> 'computed_probability_bps_sum', '0')::integer,
      'provided_probability_bps_sum', coalesce(v_validation ->> 'provided_probability_bps_sum', '0')::integer,
      'tolerance_bps', coalesce(v_validation ->> 'probability_bps_tolerance', '0')::integer
    ),
    'stock', v_stock,
    'pity', v_pity,
    'validation', v_validation,
    'validation_hash', v_validation_hash,
    'approval_context', coalesce(p_approval_context, '{}'::jsonb),
    'items', v_items,
    'pity_rules', v_pity_rules
  );
end;
$$;

revoke all on function api._admin_build_drop_pool_snapshot(uuid, uuid, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function api._admin_build_drop_pool_snapshot(uuid, uuid, jsonb, jsonb, timestamptz)
  to service_role;

comment on function api._admin_build_drop_pool_snapshot(uuid, uuid, jsonb, jsonb, timestamptz) is
  'Builds the server-side published drop-pool config snapshot: probability, stock, pity rules, publisher, publish time and validation hash.';
