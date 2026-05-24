begin;

alter table inventory.decompose_logs
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column inventory.decompose_logs.idempotency_key is 'Client supplied idempotency key for inventory decomposition writes.';
comment on column inventory.decompose_logs.request_fingerprint is 'Stable fingerprint of the decomposition request guarded by the idempotency key.';

create index if not exists decompose_logs_idempotency_key_idx
  on inventory.decompose_logs (idempotency_key)
  where idempotency_key is not null;

create or replace function api._album_normalize_rewards(p_reward jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'reward_type', coalesce(nullif(reward_item.value ->> 'reward_type', ''), nullif(reward_item.value ->> 'currency', ''), nullif(reward_item.value ->> 'type', '')),
          'amount', case when reward_item.value ? 'amount' then (reward_item.value ->> 'amount')::numeric else null end,
          'template_id', nullif(reward_item.value ->> 'template_id', '')::uuid,
          'label', coalesce(
            nullif(reward_item.value ->> 'label', ''),
            nullif(reward_item.value ->> 'reward_label', ''),
            nullif(reward_item.value ->> 'currency', ''),
            nullif(reward_item.value ->> 'reward_type', ''),
            'Reward'
          ),
          'icon_url', nullif(reward_item.value ->> 'icon_url', '')
        )
      )
    ),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p_reward, '[]'::jsonb)) = 'array' then coalesce(p_reward, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as reward_item(value);
$$;

create or replace function api.inventory_get_upgrade_preview(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_target_level integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_rule inventory.upgrade_rules%rowtype;
  v_balance numeric(38,0);
  v_reason text;
  v_next_level integer;
  v_cost_fgems numeric(38,0);
  v_power_after integer;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  select
    ii.id,
    ii.owner_user_id,
    ii.level,
    ii.power,
    ii.status,
    ii.form_id,
    ii.nft_mint_status,
    ct.rarity_code,
    ct.upgradeable,
    ct.max_level,
    coalesce(cf.form_index, 1) as form_index,
    exists (
      select 1
      from inventory.inventory_locks il
      where il.item_instance_id = ii.id
        and il.status = 'active'
        and (il.expires_at is null or il.expires_at > now())
    ) as has_active_lock
  into v_item
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  left join catalog.collectible_forms cf on cf.id = ii.form_id
  where ii.id = p_item_instance_id;

  if not found then
    raise exception 'item not found';
  end if;

  if v_item.owner_user_id is distinct from p_user_id then
    raise exception 'not item owner';
  end if;

  select coalesce((
    select ub.available_amount
    from economy.user_balances ub
    where ub.user_id = p_user_id
      and ub.currency_code = 'FGEMS'
  ), 0)
  into v_balance;

  select *
  into v_rule
  from inventory.upgrade_rules
  where rarity_code = v_item.rarity_code
    and form_index = v_item.form_index
    and from_level = v_item.level
    and active = true
  order by created_at desc
  limit 1;

  v_next_level := v_rule.to_level;
  v_cost_fgems := v_rule.cost_fgems;
  v_power_after := case when v_rule.id is null then null else v_item.power + v_rule.power_gain end;

  v_reason := case
    when v_item.status <> 'available' then 'ITEM_NOT_AVAILABLE'
    when v_item.has_active_lock then 'ITEM_LOCKED'
    when v_item.nft_mint_status in ('queued', 'minting') then 'ITEM_MINTING'
    when not v_item.upgradeable then 'ITEM_NOT_UPGRADEABLE'
    when v_item.level >= v_item.max_level then 'ITEM_MAX_LEVEL'
    when v_rule.id is null then 'UPGRADE_RULE_NOT_FOUND'
    when p_target_level is not null and p_target_level <> v_rule.to_level then 'TARGET_LEVEL_NOT_SUPPORTED'
    when v_balance < v_rule.cost_fgems then 'INSUFFICIENT_FGEMS'
    else null
  end;

  return jsonb_build_object(
    'can_upgrade', v_reason is null,
    'reason', v_reason,
    'current_level', v_item.level,
    'next_level', v_next_level,
    'target_level', coalesce(p_target_level, v_next_level),
    'cost_fgems', v_cost_fgems,
    'fgems_cost', v_cost_fgems,
    'current_power', v_item.power,
    'power_after', v_power_after,
    'user_fgems_balance', v_balance,
    'is_balance_enough', v_rule.id is not null and v_balance >= v_rule.cost_fgems
  );
end;
$$;

create or replace function api.inventory_get_evolution_preview(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_target_form_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_item_id uuid;
  v_input_count integer;
  v_distinct_count integer;
  v_source record;
  v_selected_count integer;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_selected_count integer;
  v_minting_selected_count integer;
  v_available_same_items integer;
  v_selected_item_ids uuid[];
  v_main_return_item_id uuid;
  v_rule record;
  v_balance numeric(38,0);
  v_reason text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_input_count := coalesce(cardinality(p_item_instance_ids), 0);
  if v_input_count < 1 or v_input_count > 3 then
    raise exception 'one to three item ids are required';
  end if;

  select count(distinct x.id)::integer
  into v_distinct_count
  from unnest(p_item_instance_ids) as x(id);

  if v_distinct_count <> v_input_count then
    raise exception 'duplicate item ids are not allowed';
  end if;

  select x.id
  into v_first_item_id
  from unnest(p_item_instance_ids) with ordinality as x(id, ord)
  order by x.ord
  limit 1;

  select
    ii.id,
    ii.owner_user_id,
    ii.template_id,
    ii.form_id,
    ii.level,
    ii.power,
    ii.status,
    ii.nft_mint_status,
    ii.acquired_at,
    ct.evolvable,
    ct.display_name as source_name,
    exists (
      select 1
      from inventory.inventory_locks il
      where il.item_instance_id = ii.id
        and il.status = 'active'
        and (il.expires_at is null or il.expires_at > now())
    ) as has_active_lock
  into v_source
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  where ii.id = v_first_item_id;

  if not found then
    raise exception 'item not found';
  end if;

  if v_source.owner_user_id is distinct from p_user_id then
    raise exception 'not item owner';
  end if;

  select count(*)::integer
  into v_available_same_items
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and ii.template_id = v_source.template_id
    and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_source.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ii.status = 'available'
    and ii.nft_mint_status not in ('queued', 'minting')
    and not exists (
      select 1
      from inventory.inventory_locks il
      where il.item_instance_id = ii.id
        and il.status = 'active'
        and (il.expires_at is null or il.expires_at > now())
    );

  if v_input_count = 3 then
    select
      count(*)::integer,
      count(distinct ii.template_id)::integer,
      count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
      count(*) filter (
        where ii.owner_user_id is distinct from p_user_id
           or ii.status <> 'available'
           or exists (
             select 1
             from inventory.inventory_locks il
             where il.item_instance_id = ii.id
               and il.status = 'active'
               and (il.expires_at is null or il.expires_at > now())
           )
      )::integer,
      count(*) filter (
        where ii.nft_mint_status in ('queued', 'minting')
      )::integer
    into v_selected_count, v_distinct_templates, v_distinct_forms, v_bad_selected_count, v_minting_selected_count
    from inventory.item_instances ii
    where ii.id = any(p_item_instance_ids);

    if v_selected_count = 3 and v_bad_selected_count = 0 and v_distinct_templates = 1 and v_distinct_forms = 1 then
      v_selected_item_ids := p_item_instance_ids;
    else
      v_selected_item_ids := p_item_instance_ids;
    end if;
  else
    select array_agg(id order by id = v_source.id desc, level desc, power desc, acquired_at asc)
    into v_selected_item_ids
    from (
      select ii.id, ii.level, ii.power, ii.acquired_at
      from inventory.item_instances ii
      where ii.owner_user_id = p_user_id
        and ii.template_id = v_source.template_id
        and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_source.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and ii.status = 'available'
        and ii.nft_mint_status not in ('queued', 'minting')
        and not exists (
          select 1
          from inventory.inventory_locks il
          where il.item_instance_id = ii.id
            and il.status = 'active'
            and (il.expires_at is null or il.expires_at > now())
        )
      order by ii.id = v_source.id desc, ii.level desc, ii.power desc, ii.acquired_at asc
      limit 3
    ) available_items;
  end if;

  if coalesce(cardinality(v_selected_item_ids), 0) = 3 then
    select ii.id
    into v_main_return_item_id
    from inventory.item_instances ii
    where ii.id = any(v_selected_item_ids)
    order by ii.level desc, ii.power desc, ii.acquired_at asc
    limit 1;
  end if;

  select
    er.id,
    er.required_count,
    er.cost_kcoin,
    er.success_rate_bps,
    er.to_template_id,
    er.to_form_id,
    target_template.display_name as target_name,
    coalesce(target_form.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as target_image_url
  into v_rule
  from inventory.evolution_rules er
  join catalog.collectible_templates target_template on target_template.id = er.to_template_id
  left join catalog.collectible_forms target_form on target_form.id = er.to_form_id
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = er.to_template_id
      and (m.form_id is null or m.form_id = er.to_form_id)
      and m.media_type = 'card'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_card on true
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = er.to_template_id
      and (m.form_id is null or m.form_id = er.to_form_id)
      and m.media_type = 'hero'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_hero on true
  left join lateral (
    select url
    from catalog.collectible_media m
    where m.template_id = er.to_template_id
      and (m.form_id is null or m.form_id = er.to_form_id)
      and m.media_type = 'thumb'
    order by m.form_id nulls last, m.sort_order asc
    limit 1
  ) cm_thumb on true
  where er.from_template_id = v_source.template_id
    and er.from_form_id = v_source.form_id
    and (p_target_form_id is null or er.to_form_id = p_target_form_id)
    and er.active = true
  order by er.created_at desc
  limit 1;

  select coalesce((
    select ub.available_amount
    from economy.user_balances ub
    where ub.user_id = p_user_id
      and ub.currency_code = 'KCOIN'
  ), 0)
  into v_balance;

  v_reason := case
    when v_source.status <> 'available' then 'ITEM_NOT_AVAILABLE'
    when v_source.has_active_lock then 'ITEM_LOCKED'
    when v_source.nft_mint_status in ('queued', 'minting') then 'ITEM_MINTING'
    when not v_source.evolvable then 'ITEM_NOT_EVOLVABLE'
    when v_input_count = 3 and coalesce(v_selected_count, 0) <> 3 then 'ITEM_NOT_FOUND'
    when v_input_count = 3 and coalesce(v_minting_selected_count, 0) > 0 then 'ITEM_MINTING'
    when v_input_count = 3 and coalesce(v_bad_selected_count, 0) > 0 then 'ITEM_NOT_AVAILABLE'
    when v_input_count = 3 and (coalesce(v_distinct_templates, 0) <> 1 or coalesce(v_distinct_forms, 0) <> 1) then 'EVOLVE_REQUIRES_SAME_TEMPLATE_AND_FORM'
    when v_available_same_items < 3 then 'EVOLVE_NOT_ENOUGH_ITEMS'
    when v_rule.id is null then 'EVOLVE_RULE_NOT_FOUND'
    when v_balance < v_rule.cost_kcoin then 'INSUFFICIENT_KCOIN'
    else null
  end;

  return jsonb_build_object(
    'can_evolve', v_reason is null,
    'reason', v_reason,
    'required_count', coalesce(v_rule.required_count, 3),
    'available_same_items', v_available_same_items,
    'selected_item_ids', coalesce(to_jsonb(v_selected_item_ids), '[]'::jsonb),
    'main_return_item_id', v_main_return_item_id,
    'cost_kcoin', v_rule.cost_kcoin,
    'kcoin_cost', v_rule.cost_kcoin,
    'success_rate_bps', v_rule.success_rate_bps,
    'target_template_id', v_rule.to_template_id,
    'target_form_id', v_rule.to_form_id,
    'target_name', v_rule.target_name,
    'target_image_url', v_rule.target_image_url,
    'user_kcoin_balance', v_balance,
    'is_balance_enough', v_rule.id is not null and v_balance >= v_rule.cost_kcoin
  );
end;
$$;

create or replace function api.inventory_get_decompose_preview(
  p_user_id uuid,
  p_item_instance_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_count integer;
  v_distinct_count integer;
  v_owned_count integer;
  v_items jsonb;
  v_bad_count integer;
  v_total_reward numeric(38,0);
  v_reason text;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_input_count := coalesce(cardinality(p_item_instance_ids), 0);
  if v_input_count < 1 or v_input_count > 100 then
    raise exception 'one to one hundred item ids are required';
  end if;

  select count(distinct x.id)::integer
  into v_distinct_count
  from unnest(p_item_instance_ids) as x(id);

  if v_distinct_count <> v_input_count then
    raise exception 'duplicate item ids are not allowed';
  end if;

  select count(*)::integer
  into v_owned_count
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
    and ii.owner_user_id = p_user_id;

  if v_owned_count <> v_input_count then
    raise exception 'item not found';
  end if;

  with input_items as (
    select x.id, x.ord
    from unnest(p_item_instance_ids) with ordinality as x(id, ord)
  ),
  item_rows as (
    select
      input_items.ord,
      ii.id as item_instance_id,
      ii.owner_user_id,
      ii.template_id,
      ii.form_id,
      ii.status,
      ii.nft_mint_status,
      ii.level,
      ct.decomposable,
      ct.rarity_code,
      coalesce(cf.form_index, 1) as form_index,
      exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      ) as has_active_lock
    from input_items
    join inventory.item_instances ii on ii.id = input_items.id
    join catalog.collectible_templates ct on ct.id = ii.template_id
    left join catalog.collectible_forms cf on cf.id = ii.form_id
  ),
  selected_counts as (
    select
      template_id,
      coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as selected_same_items
    from item_rows
    group by template_id, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  available_counts as (
    select
      ii.template_id,
      coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as available_same_items
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = 'available'
      and ii.nft_mint_status not in ('queued', 'minting')
      and not exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      )
    group by ii.template_id, coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  preview_rows as (
    select
      ir.*,
      coalesce(ac.available_same_items, 0) as duplicate_count,
      coalesce(sc.selected_same_items, 0) as selected_same_items,
      dr.id as rule_id,
      dr.reward_fgems,
      case
        when ir.status <> 'available' then 'ITEM_NOT_AVAILABLE'
        when ir.has_active_lock then 'ITEM_LOCKED'
        when ir.nft_mint_status in ('queued', 'minting') then 'ITEM_MINTING'
        when not ir.decomposable then 'ITEM_NOT_DECOMPOSABLE'
        when coalesce(ac.available_same_items, 0) < 2 then 'DECOMPOSE_REQUIRES_DUPLICATE'
        when coalesce(sc.selected_same_items, 0) >= coalesce(ac.available_same_items, 0) then 'DECOMPOSE_REQUIRES_DUPLICATE'
        when dr.id is null then 'DECOMPOSE_RULE_NOT_FOUND'
        else null
      end as reason
    from item_rows ir
    join selected_counts sc
      on sc.template_id = ir.template_id
     and sc.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join available_counts ac
      on ac.template_id = ir.template_id
     and ac.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join lateral (
      select *
      from inventory.decompose_rules rule_row
      where rule_row.rarity_code = ir.rarity_code
        and rule_row.form_index = ir.form_index
        and rule_row.min_level <= ir.level
        and rule_row.active = true
      order by rule_row.min_level desc, rule_row.created_at desc
      limit 1
    ) dr on true
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_instance_id', item_instance_id,
          'can_decompose', reason is null,
          'reason', reason,
          'duplicate_count', duplicate_count,
          'reward_fgems', case when reason is null then reward_fgems else null end,
          'item_status', status
        )
        order by ord
      ),
      '[]'::jsonb
    ),
    count(*) filter (where reason is not null)::integer,
    coalesce(sum(reward_fgems) filter (where reason is null), 0)::numeric,
    min(reason) filter (where reason is not null)
  into v_items, v_bad_count, v_total_reward, v_reason
  from preview_rows;

  return jsonb_build_object(
    'can_decompose', v_bad_count = 0,
    'reason', v_reason,
    'duplicate_count', nullif(v_items -> 0 ->> 'duplicate_count', '')::integer,
    'reward_fgems', v_total_reward,
    'total_reward_fgems', v_total_reward,
    'item_status', v_items -> 0 ->> 'item_status',
    'item_instance_ids', to_jsonb(p_item_instance_ids),
    'items', v_items
  );
end;
$$;

create or replace function api.inventory_decompose_items(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_count integer;
  v_distinct_count integer;
  v_owned_count integer;
  v_idempotency_key text;
  v_sorted_item_ids uuid[];
  v_request_fingerprint text;
  v_existing_count integer;
  v_existing_fingerprint text;
  v_items jsonb;
  v_bad_reason text;
  v_total_reward numeric(38,0);
  v_credit jsonb;
  v_ledger_id uuid;
  v_result_items jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  v_input_count := coalesce(cardinality(p_item_instance_ids), 0);
  if v_input_count < 1 or v_input_count > 100 then
    raise exception 'one to one hundred item ids are required';
  end if;

  select count(distinct x.id)::integer
  into v_distinct_count
  from unnest(p_item_instance_ids) as x(id);

  if v_distinct_count <> v_input_count then
    raise exception 'duplicate item ids are not allowed';
  end if;

  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  select array_agg(x.id order by x.id)
  into v_sorted_item_ids
  from unnest(p_item_instance_ids) as x(id);

  v_request_fingerprint := md5(jsonb_build_object(
    'operation', 'inventory_decompose',
    'user_id', p_user_id,
    'item_instance_ids', to_jsonb(v_sorted_item_ids)
  )::text);

  perform pg_advisory_xact_lock(hashtext('inventory_growth'), hashtext(v_idempotency_key));

  select count(*)::integer, min(request_fingerprint)
  into v_existing_count, v_existing_fingerprint
  from inventory.decompose_logs
  where idempotency_key = v_idempotency_key;

  if v_existing_count > 0 then
    if v_existing_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency conflict';
    end if;

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_instance_id', item_instance_id,
            'reward_fgems', reward_fgems,
            'ledger_id', ledger_id,
            'log_id', id
          )
          order by item_instance_id
        ),
        '[]'::jsonb
      ),
      coalesce(sum(reward_fgems), 0)::numeric,
      min(ledger_id::text)::uuid
    into v_result_items, v_total_reward, v_ledger_id
    from inventory.decompose_logs
    where idempotency_key = v_idempotency_key;

    return jsonb_build_object(
      'idempotent', true,
      'item_instance_ids', to_jsonb(v_sorted_item_ids),
      'total_reward_fgems', v_total_reward,
      'reward_fgems', v_total_reward,
      'ledger_id', v_ledger_id,
      'items', v_result_items
    );
  end if;

  if exists (
    select 1
    from inventory.upgrade_logs
    where idempotency_key = v_idempotency_key
  ) or exists (
    select 1
    from inventory.evolution_attempts
    where idempotency_key = v_idempotency_key
  ) then
    raise exception 'idempotency conflict';
  end if;

  select count(*)::integer
  into v_owned_count
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
    and ii.owner_user_id = p_user_id;

  if v_owned_count <> v_input_count then
    raise exception 'item not found';
  end if;

  perform 1
  from inventory.item_instances ii
  where ii.id = any(p_item_instance_ids)
  order by ii.id
  for update;

  with input_items as (
    select x.id, x.ord
    from unnest(p_item_instance_ids) with ordinality as x(id, ord)
  ),
  item_rows as (
    select
      input_items.ord,
      ii.id as item_instance_id,
      ii.owner_user_id,
      ii.template_id,
      ii.form_id,
      ii.status,
      ii.nft_mint_status,
      ii.level,
      ct.decomposable,
      ct.rarity_code,
      coalesce(cf.form_index, 1) as form_index,
      exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      ) as has_active_lock
    from input_items
    join inventory.item_instances ii on ii.id = input_items.id
    join catalog.collectible_templates ct on ct.id = ii.template_id
    left join catalog.collectible_forms cf on cf.id = ii.form_id
  ),
  selected_counts as (
    select
      template_id,
      coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as selected_same_items
    from item_rows
    group by template_id, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  available_counts as (
    select
      ii.template_id,
      coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key,
      count(*)::integer as available_same_items
    from inventory.item_instances ii
    where ii.owner_user_id = p_user_id
      and ii.status = 'available'
      and ii.nft_mint_status not in ('queued', 'minting')
      and not exists (
        select 1
        from inventory.inventory_locks il
        where il.item_instance_id = ii.id
          and il.status = 'active'
          and (il.expires_at is null or il.expires_at > now())
      )
    group by ii.template_id, coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ),
  validated_rows as (
    select
      ir.*,
      coalesce(ac.available_same_items, 0) as duplicate_count,
      coalesce(sc.selected_same_items, 0) as selected_same_items,
      dr.id as rule_id,
      dr.reward_fgems,
      case
        when ir.status <> 'available' then 'item is not available'
        when ir.has_active_lock then 'item is locked'
        when ir.nft_mint_status in ('queued', 'minting') then 'item is minting'
        when not ir.decomposable then 'item is not decomposable'
        when coalesce(ac.available_same_items, 0) < 2 then 'only duplicate collectibles can be decomposed'
        when coalesce(sc.selected_same_items, 0) >= coalesce(ac.available_same_items, 0) then 'only duplicate collectibles can be decomposed'
        when dr.id is null then 'decompose rule not found'
        else null
      end as reason
    from item_rows ir
    join selected_counts sc
      on sc.template_id = ir.template_id
     and sc.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join available_counts ac
      on ac.template_id = ir.template_id
     and ac.form_key = coalesce(ir.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    left join lateral (
      select *
      from inventory.decompose_rules rule_row
      where rule_row.rarity_code = ir.rarity_code
        and rule_row.form_index = ir.form_index
        and rule_row.min_level <= ir.level
        and rule_row.active = true
      order by rule_row.min_level desc, rule_row.created_at desc
      limit 1
    ) dr on true
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_instance_id', item_instance_id,
          'owner_user_id', owner_user_id,
          'status', status,
          'rule_id', rule_id,
          'reward_fgems', reward_fgems,
          'reason', reason
        )
        order by ord
      ),
      '[]'::jsonb
    ),
    min(reason) filter (where reason is not null),
    coalesce(sum(reward_fgems) filter (where reason is null), 0)::numeric
  into v_items, v_bad_reason, v_total_reward
  from validated_rows;

  if v_bad_reason is not null then
    raise exception '%', v_bad_reason;
  end if;

  if v_total_reward <= 0 then
    raise exception 'decompose reward must be positive';
  end if;

  v_credit := api._credit_balance(
    p_user_id,
    'FGEMS',
    v_total_reward,
    'inventory_decompose',
    null,
    array_to_string(v_sorted_item_ids, ','),
    v_idempotency_key,
    'Decompose collectibles',
    jsonb_build_object('item_instance_ids', v_sorted_item_ids)
  );
  v_ledger_id := (v_credit ->> 'ledger_id')::uuid;

  if coalesce((v_credit ->> 'idempotent')::boolean, false) then
    raise exception 'idempotency conflict';
  end if;

  update inventory.item_instances
  set status = 'decomposed',
      owner_user_id = null,
      updated_at = now(),
      lock_version = lock_version + 1
  where id in (
    select (item_row.value ->> 'item_instance_id')::uuid
    from jsonb_array_elements(v_items) as item_row(value)
  );

  insert into inventory.decompose_logs (
    user_id,
    item_instance_id,
    rule_id,
    reward_fgems,
    ledger_id,
    idempotency_key,
    request_fingerprint
  )
  select
    p_user_id,
    item_rows.item_instance_id,
    item_rows.rule_id,
    item_rows.reward_fgems,
    v_ledger_id,
    v_idempotency_key,
    v_request_fingerprint
  from jsonb_to_recordset(v_items) as item_rows(
    item_instance_id uuid,
    rule_id uuid,
    reward_fgems numeric
  );

  insert into inventory.item_instance_events (
    item_instance_id,
    user_id,
    event_type,
    source_type,
    source_id,
    before_state,
    after_state
  )
  select
    item_rows.item_instance_id,
    p_user_id,
    'decomposed',
    'inventory_decompose',
    logs.id,
    jsonb_build_object('status', item_rows.status, 'owner_user_id', item_rows.owner_user_id),
    jsonb_build_object('status', 'decomposed', 'reward_fgems', item_rows.reward_fgems)
  from jsonb_to_recordset(v_items) as item_rows(
    item_instance_id uuid,
    owner_user_id uuid,
    status text,
    reward_fgems numeric
  )
  join inventory.decompose_logs logs
    on logs.idempotency_key = v_idempotency_key
   and logs.item_instance_id = item_rows.item_instance_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_instance_id', logs.item_instance_id,
        'reward_fgems', logs.reward_fgems,
        'ledger_id', logs.ledger_id,
        'log_id', logs.id
      )
      order by logs.item_instance_id
    ),
    '[]'::jsonb
  )
  into v_result_items
  from inventory.decompose_logs logs
  where logs.idempotency_key = v_idempotency_key;

  return jsonb_build_object(
    'idempotent', false,
    'item_instance_ids', to_jsonb(v_sorted_item_ids),
    'total_reward_fgems', v_total_reward,
    'reward_fgems', v_total_reward,
    'ledger_id', v_ledger_id,
    'items', v_result_items
  );
end;
$$;

create or replace function api.inventory_decompose_item(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_item jsonb;
begin
  v_result := api.inventory_decompose_items(
    p_user_id,
    array[p_item_instance_id]::uuid[],
    p_idempotency_key
  );
  v_item := v_result -> 'items' -> 0;

  return jsonb_build_object(
    'item_instance_id', p_item_instance_id,
    'reward_fgems', nullif(v_item ->> 'reward_fgems', '')::numeric,
    'ledger_id', nullif(v_item ->> 'ledger_id', '')::uuid,
    'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false)
  );
end;
$$;

create or replace function api.inventory_get_item_detail(
  p_user_id uuid,
  p_item_instance_id uuid,
  p_include_market_status boolean default true,
  p_include_upgrade_preview boolean default true,
  p_include_evolution_preview boolean default true,
  p_include_decompose_preview boolean default true,
  p_include_onchain_status boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_active_lock jsonb;
  v_market_status jsonb;
  v_onchain_status jsonb;
  v_upgrade_preview jsonb;
  v_evolution_preview jsonb;
  v_decompose_preview jsonb;
  v_same_item_count integer;
  v_available_same_item_count integer;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  select
    ii.id,
    ii.owner_user_id,
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
    ii.updated_at,
    ii.metadata as item_metadata,
    ct.slug as template_slug,
    ct.display_name,
    ct.subtitle,
    ct.description,
    ct.rarity_code,
    ct.type_code,
    ct.base_power,
    ct.tradeable,
    ct.upgradeable,
    ct.evolvable,
    ct.decomposable,
    ct.nft_mintable,
    ct.metadata as template_metadata,
    r.display_name as rarity_display_name,
    r.sort_order as rarity_sort_order,
    s.id as series_id,
    s.slug as series_slug,
    s.display_name as series_display_name,
    f.id as faction_id,
    f.slug as faction_slug,
    f.display_name as faction_display_name,
    cf.form_index,
    cf.display_name as form_display_name,
    cf.description as form_description,
    coalesce(cf.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as image_url,
    coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url) as thumbnail_url,
    coalesce(cf.avatar_url, cm_avatar.url, cm_thumb.url, cm_card.url) as avatar_url
  into v_item
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  join catalog.rarities r on r.code = ct.rarity_code
  left join catalog.series s on s.id = ct.series_id
  left join catalog.factions f on f.id = ct.faction_id
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
  where ii.id = p_item_instance_id;

  if not found then
    raise exception 'item not found';
  end if;

  if v_item.owner_user_id is distinct from p_user_id then
    raise exception 'not item owner';
  end if;

  select jsonb_build_object(
    'lock_id', il.id,
    'reason', il.lock_type,
    'source_type', il.source_type,
    'source_id', il.source_id,
    'locked_at', il.locked_at,
    'expires_at', il.expires_at
  )
  into v_active_lock
  from inventory.inventory_locks il
  where il.item_instance_id = p_item_instance_id
    and il.status = 'active'
    and (il.expires_at is null or il.expires_at > now())
  order by il.locked_at desc
  limit 1;

  select count(*)::integer
  into v_same_item_count
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and ii.template_id = v_item.template_id
    and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid);

  select count(*)::integer
  into v_available_same_item_count
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and ii.template_id = v_item.template_id
    and coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ii.status = 'available'
    and not exists (
      select 1
      from inventory.inventory_locks il
      where il.item_instance_id = ii.id
        and il.status = 'active'
        and (il.expires_at is null or il.expires_at > now())
    );

  if p_include_market_status then
    select jsonb_build_object(
      'is_listed', true,
      'listing_id', l.id,
      'unit_price', l.unit_price_kcoin,
      'currency', 'KCOIN'
    )
    into v_market_status
    from market.listing_items li
    join market.listings l on l.id = li.listing_id
    where li.item_instance_id = p_item_instance_id
      and li.status = 'reserved'
      and l.status in ('active', 'partially_sold')
    order by l.created_at desc
    limit 1;

    v_market_status := coalesce(
      v_market_status,
      jsonb_build_object('is_listed', false, 'listing_id', null, 'unit_price', null, 'currency', null)
    );
  end if;

  if p_include_onchain_status then
    select jsonb_build_object(
      'is_minted', ni.id is not null and ni.status = 'minted',
      'mint_status', case
        when ni.status = 'minted' then 'minted'
        when mq.status = 'queued' then 'queued'
        when mq.status = 'processing' then 'processing'
        when mq.status = 'failed' then 'failed'
        else 'none'
      end,
      'nft_item_address', ni.item_address,
      'owner_wallet_address', ni.owner_address
    )
    into v_onchain_status
    from inventory.item_instances ii
    left join onchain.nft_items ni on ni.id = ii.minted_nft_item_id or ni.item_instance_id = ii.id
    left join lateral (
      select status
      from onchain.mint_queue queue_row
      where queue_row.item_instance_id = ii.id
      order by queue_row.created_at desc
      limit 1
    ) mq on true
    where ii.id = p_item_instance_id;
  end if;

  if p_include_upgrade_preview then
    v_upgrade_preview := api.inventory_get_upgrade_preview(p_user_id, p_item_instance_id, null);
  end if;

  if p_include_evolution_preview then
    v_evolution_preview := api.inventory_get_evolution_preview(p_user_id, array[p_item_instance_id]::uuid[], null);
  end if;

  if p_include_decompose_preview then
    v_decompose_preview := api.inventory_get_decompose_preview(p_user_id, array[p_item_instance_id]::uuid[]);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'item_instance_id', v_item.id,
    'template_id', v_item.template_id,
    'template_slug', v_item.template_slug,
    'form_id', v_item.form_id,
    'serial_no', v_item.serial_no,
    'name', v_item.display_name,
    'subtitle', v_item.subtitle,
    'description', v_item.description,
    'rarity', jsonb_build_object(
      'code', v_item.rarity_code,
      'display_name', v_item.rarity_display_name,
      'sort_order', v_item.rarity_sort_order
    ),
    'type_code', v_item.type_code,
    'series', jsonb_build_object(
      'id', v_item.series_id,
      'slug', v_item.series_slug,
      'display_name', v_item.series_display_name
    ),
    'faction', jsonb_build_object(
      'id', v_item.faction_id,
      'slug', v_item.faction_slug,
      'display_name', v_item.faction_display_name
    ),
    'form', jsonb_build_object(
      'id', v_item.form_id,
      'index', v_item.form_index,
      'display_name', v_item.form_display_name,
      'description', v_item.form_description
    ),
    'level', v_item.level,
    'power', v_item.power,
    'base_power', v_item.base_power,
    'status', v_item.status,
    'nft_mint_status', v_item.nft_mint_status,
    'image_url', v_item.image_url,
    'thumbnail_url', v_item.thumbnail_url,
    'avatar_url', v_item.avatar_url,
    'is_tradeable', v_item.tradeable,
    'is_upgradeable', v_item.upgradeable,
    'is_evolvable', v_item.evolvable,
    'is_decomposable', v_item.decomposable,
    'is_mintable', v_item.nft_mintable,
    'source_type', v_item.source_type,
    'source_id', v_item.source_id,
    'obtained_at', v_item.acquired_at,
    'updated_at', v_item.updated_at,
    'attributes', coalesce(v_item.item_metadata -> 'attributes', v_item.template_metadata -> 'attributes', '{}'::jsonb),
    'active_lock', v_active_lock,
    'market_status', v_market_status,
    'onchain_status', v_onchain_status,
    'upgrade_preview', v_upgrade_preview,
    'evolution_preview', v_evolution_preview,
    'decompose_preview', v_decompose_preview,
    'same_item_count', v_same_item_count,
    'available_same_item_count', v_available_same_item_count
  ));
end;
$$;

create or replace function api.album_list_books(
  p_user_id uuid,
  p_book_type text default null,
  p_series_ids uuid[] default null,
  p_faction_ids uuid[] default null,
  p_rarities text[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_books jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  with filtered_books as (
    select b.id
    from album.books b
    where b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
      and (p_book_type is null or b.book_type = p_book_type)
      and (p_series_ids is null or cardinality(p_series_ids) = 0 or b.series_id = any(p_series_ids))
      and (p_faction_ids is null or cardinality(p_faction_ids) = 0 or b.faction_id = any(p_faction_ids))
      and (
        p_rarities is null
        or cardinality(p_rarities) = 0
        or exists (
          select 1
          from unnest(p_rarities) as rarity_filter(code)
          where b.rarity_code = upper(rarity_filter.code)
        )
      )
  )
  select count(*)::integer
  into v_total
  from filtered_books;

  with filtered_books as (
    select b.*
    from album.books b
    where b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
      and (p_book_type is null or b.book_type = p_book_type)
      and (p_series_ids is null or cardinality(p_series_ids) = 0 or b.series_id = any(p_series_ids))
      and (p_faction_ids is null or cardinality(p_faction_ids) = 0 or b.faction_id = any(p_faction_ids))
      and (
        p_rarities is null
        or cardinality(p_rarities) = 0
        or exists (
          select 1
          from unnest(p_rarities) as rarity_filter(code)
          where b.rarity_code = upper(rarity_filter.code)
        )
      )
    order by b.sort_order asc, b.created_at asc
    limit v_limit offset v_offset
  ),
  book_counts as (
    select
      fb.*,
      count(bi.template_id)::integer as total_count,
      count(ud.template_id)::integer as collected_count
    from filtered_books fb
    left join album.book_items bi on bi.book_id = fb.id
    left join album.user_discoveries ud
      on ud.user_id = p_user_id
     and ud.template_id = bi.template_id
    group by fb.id, fb.code, fb.display_name, fb.description, fb.book_type, fb.series_id,
             fb.faction_id, fb.rarity_code, fb.cover_url, fb.active, fb.starts_at, fb.ends_at,
             fb.sort_order, fb.metadata, fb.created_at, fb.updated_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'book_id', id,
        'book_type', book_type,
        'name', display_name,
        'description', description,
        'cover_url', cover_url,
        'total_count', total_count,
        'collected_count', collected_count,
        'completion_percent', case when total_count = 0 then 0 else round((collected_count::numeric * 100) / total_count, 2) end,
        'is_event_limited', book_type = 'event',
        'starts_at', starts_at,
        'ends_at', ends_at,
        'code', code,
        'series_id', series_id,
        'faction_id', faction_id,
        'rarity', rarity_code
      )
      order by sort_order asc, created_at asc
    ),
    '[]'::jsonb
  )
  into v_books
  from book_counts;

  return jsonb_build_object(
    'books', v_books,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'next_cursor', case when v_offset + v_limit < v_total then (v_offset + v_limit)::text else null end,
    'server_time', now()
  );
end;
$$;

create or replace function api.album_get_progress(
  p_user_id uuid,
  p_book_id uuid default null,
  p_book_type text default null,
  p_series_id uuid default null,
  p_faction_id uuid default null,
  p_rarity text default null,
  p_include_items boolean default true,
  p_include_milestones boolean default true,
  p_include_rewards boolean default true,
  p_include_locked_items boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book album.books%rowtype;
  v_total_count integer;
  v_collected_count integer;
  v_book_json jsonb;
  v_items jsonb;
  v_milestones jsonb;
  v_rarity_summary jsonb;
  v_series_summary jsonb;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;

  select *
  into v_book
  from album.books b
  where b.active = true
    and (b.starts_at is null or b.starts_at <= now())
    and (b.ends_at is null or b.ends_at > now())
    and (p_book_id is null or b.id = p_book_id)
    and (p_book_id is not null or p_book_type is null or b.book_type = p_book_type)
    and (p_book_id is not null or p_series_id is null or b.series_id = p_series_id)
    and (p_book_id is not null or p_faction_id is null or b.faction_id = p_faction_id)
    and (p_book_id is not null or p_rarity is null or b.rarity_code = upper(p_rarity))
  order by
    case when p_book_id is not null then 0 when b.book_type = 'all' then 1 else 2 end,
    b.sort_order asc,
    b.created_at asc
  limit 1;

  if not found then
    return jsonb_build_object(
      'book', null,
      'items', '[]'::jsonb,
      'milestones', '[]'::jsonb,
      'rarity_summary', '[]'::jsonb,
      'series_summary', '[]'::jsonb,
      'empty', true,
      'server_time', now()
    );
  end if;

  select
    count(bi.template_id)::integer,
    count(ud.template_id)::integer
  into v_total_count, v_collected_count
  from album.book_items bi
  left join album.user_discoveries ud
    on ud.user_id = p_user_id
   and ud.template_id = bi.template_id
  where bi.book_id = v_book.id;

  v_book_json := jsonb_build_object(
    'book_id', v_book.id,
    'book_type', v_book.book_type,
    'name', v_book.display_name,
    'description', v_book.description,
    'cover_url', v_book.cover_url,
    'total_count', v_total_count,
    'collected_count', v_collected_count,
    'completion_percent', case when v_total_count = 0 then 0 else round((v_collected_count::numeric * 100) / v_total_count, 2) end,
    'is_event_limited', v_book.book_type = 'event',
    'starts_at', v_book.starts_at,
    'ends_at', v_book.ends_at,
    'code', v_book.code
  );

  if p_include_items then
    with item_rows as (
      select
        bi.sort_order as album_order,
        ct.id as template_id,
        cf.id as form_id,
        ct.display_name,
        ct.description,
        ct.rarity_code,
        ct.type_code,
        s.id as series_id,
        s.display_name as series_name,
        f.id as faction_id,
        f.display_name as faction_name,
        coalesce(cf.image_url, cm_card.url, cm_hero.url, cm_thumb.url) as image_url,
        coalesce(cf.thumbnail_url, cm_thumb.url, cm_card.url) as thumb_url,
        ud.discovered_at as first_collected_at
      from album.book_items bi
      join catalog.collectible_templates ct on ct.id = bi.template_id
      left join catalog.collectible_forms cf on cf.template_id = ct.id and cf.is_default = true
      left join catalog.series s on s.id = ct.series_id
      left join catalog.factions f on f.id = ct.faction_id
      left join album.user_discoveries ud
        on ud.user_id = p_user_id
       and ud.template_id = ct.id
      left join lateral (
        select url
        from catalog.collectible_media m
        where m.template_id = ct.id
          and (m.form_id is null or m.form_id = cf.id)
          and m.media_type = 'card'
        order by m.form_id nulls last, m.sort_order asc
        limit 1
      ) cm_card on true
      left join lateral (
        select url
        from catalog.collectible_media m
        where m.template_id = ct.id
          and (m.form_id is null or m.form_id = cf.id)
          and m.media_type = 'hero'
        order by m.form_id nulls last, m.sort_order asc
        limit 1
      ) cm_hero on true
      left join lateral (
        select url
        from catalog.collectible_media m
        where m.template_id = ct.id
          and (m.form_id is null or m.form_id = cf.id)
          and m.media_type = 'thumb'
        order by m.form_id nulls last, m.sort_order asc
        limit 1
      ) cm_thumb on true
      where bi.book_id = v_book.id
        and (p_include_locked_items or ud.template_id is not null)
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'template_id', template_id,
          'form_id', form_id,
          'name', display_name,
          'description', description,
          'rarity', rarity_code,
          'type', type_code,
          'series_id', series_id,
          'series_name', series_name,
          'faction_id', faction_id,
          'faction_name', faction_name,
          'image_url', image_url,
          'thumb_url', thumb_url,
          'is_collected', first_collected_at is not null,
          'first_collected_at', first_collected_at,
          'collected_count', case when first_collected_at is null then 0 else 1 end,
          'album_order', album_order
        )
        order by album_order asc, display_name asc
      ),
      '[]'::jsonb
    )
    into v_items
    from item_rows;
  end if;

  if p_include_milestones then
    with milestone_rows as (
      select
        m.*,
        mc.claimed_at,
        case
          when mc.id is not null then 'claimed'
          when v_collected_count >= m.required_count then 'claimable'
          else 'locked'
        end as milestone_status
      from album.milestones m
      left join album.milestone_claims mc
        on mc.user_id = p_user_id
       and mc.milestone_id = m.id
      where m.book_id = v_book.id
        and m.active = true
      order by m.sort_order asc, m.required_count asc
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'milestone_id', id,
          'book_id', book_id,
          'required_count', required_count,
          'required_percent', case when v_total_count = 0 then 0 else round((required_count::numeric * 100) / v_total_count, 2) end,
          'title', title,
          'status', milestone_status,
          'rewards', case when p_include_rewards then api._album_normalize_rewards(reward) else '[]'::jsonb end,
          'claimed_at', claimed_at,
          'version', case when metadata ? 'version' and (metadata ->> 'version') ~ '^[0-9]+$' then (metadata ->> 'version')::integer else 0 end
        )
        order by sort_order asc, required_count asc
      ),
      '[]'::jsonb
    )
    into v_milestones
    from milestone_rows;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rarity', rarity_code,
        'total_count', total_count,
        'collected_count', collected_count
      )
      order by rarity_sort_order asc
    ),
    '[]'::jsonb
  )
  into v_rarity_summary
  from (
    select
      ct.rarity_code,
      min(r.sort_order) as rarity_sort_order,
      count(*)::integer as total_count,
      count(ud.template_id)::integer as collected_count
    from album.book_items bi
    join catalog.collectible_templates ct on ct.id = bi.template_id
    join catalog.rarities r on r.code = ct.rarity_code
    left join album.user_discoveries ud
      on ud.user_id = p_user_id
     and ud.template_id = ct.id
    where bi.book_id = v_book.id
    group by ct.rarity_code
  ) rarity_rows;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'series_id', series_id,
        'series_name', series_name,
        'total_count', total_count,
        'collected_count', collected_count
      )
      order by series_name asc
    ),
    '[]'::jsonb
  )
  into v_series_summary
  from (
    select
      s.id as series_id,
      coalesce(s.display_name, 'Unknown') as series_name,
      count(*)::integer as total_count,
      count(ud.template_id)::integer as collected_count
    from album.book_items bi
    join catalog.collectible_templates ct on ct.id = bi.template_id
    left join catalog.series s on s.id = ct.series_id
    left join album.user_discoveries ud
      on ud.user_id = p_user_id
     and ud.template_id = ct.id
    where bi.book_id = v_book.id
    group by s.id, s.display_name
  ) series_rows;

  return jsonb_build_object(
    'book', v_book_json,
    'items', coalesce(v_items, '[]'::jsonb),
    'milestones', coalesce(v_milestones, '[]'::jsonb),
    'rarity_summary', v_rarity_summary,
    'series_summary', v_series_summary,
    'server_time', now()
  );
end;
$$;

create or replace function api.album_get_leaderboard(
  p_user_id uuid default null,
  p_board_id uuid default null,
  p_period text default 'current_week',
  p_scope text default 'global',
  p_series_id uuid default null,
  p_faction_id uuid default null,
  p_rarity text default null,
  p_sort text default 'score_desc',
  p_around_me boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_board album.weekly_leaderboards%rowtype;
  v_entries jsonb;
  v_my_entry jsonb;
  v_total integer;
  v_generated_at timestamptz;
begin
  select *
  into v_board
  from album.weekly_leaderboards wl
  where (p_board_id is null or wl.id = p_board_id)
    and (
      p_board_id is not null
      or (p_period = 'current_week' and now() >= wl.starts_at and now() < wl.ends_at)
      or (p_period = 'last_week' and wl.starts_at = date_trunc('week', now()) - interval '1 week')
    )
  order by wl.starts_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'board_id', null,
      'period', coalesce(p_period, 'current_week'),
      'scope', coalesce(p_scope, 'global'),
      'sort', coalesce(p_sort, 'score_desc'),
      'around_me', coalesce(p_around_me, false),
      'filters', jsonb_build_object(
        'series_id', p_series_id,
        'faction_id', p_faction_id,
        'rarity', p_rarity
      ),
      'entries', '[]'::jsonb,
      'my_entry', null,
      'next_cursor', null,
      'generated_at', now(),
      'empty', true
    );
  end if;

  select count(*)::integer, max(le.calculated_at)
  into v_total, v_generated_at
  from album.leaderboard_entries le
  where le.leaderboard_id = v_board.id;

  with ranked_entries as (
    select
      le.*,
      coalesce(up.display_name, u.username::text, u.first_name, 'Player') as display_name,
      coalesce(up.avatar_url, u.photo_url) as avatar_url
    from album.leaderboard_entries le
    join core.users u on u.id = le.user_id
    left join core.user_profiles up on up.user_id = u.id
    where le.leaderboard_id = v_board.id
    order by
      case when p_sort = 'completion_desc' then le.completion_percent end desc nulls last,
      case when p_sort = 'rare_count_desc' then le.rare_count end desc nulls last,
      case when p_sort = 'mint_count_desc' then le.minted_count end desc nulls last,
      le.rank asc nulls last,
      le.score desc,
      le.user_id asc
    limit v_limit offset v_offset
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', rank,
        'user_id', user_id,
        'display_name', display_name,
        'avatar_url', avatar_url,
        'score', score,
        'completion_percent', completion_percent,
        'collected_count', collected_count,
        'total_count', total_count,
        'rare_count', rare_count,
        'epic_count', epic_count,
        'legendary_count', legendary_count,
        'mint_count', minted_count,
        'generated_at', calculated_at,
        'updated_at', calculated_at
      )
      order by rank asc nulls last, score desc, user_id asc
    ),
    '[]'::jsonb
  )
  into v_entries
  from ranked_entries;

  if p_user_id is not null then
    select jsonb_build_object(
      'rank', le.rank,
      'user_id', le.user_id,
      'display_name', coalesce(up.display_name, u.username::text, u.first_name, 'Player'),
      'avatar_url', coalesce(up.avatar_url, u.photo_url),
      'score', le.score,
      'completion_percent', le.completion_percent,
      'collected_count', le.collected_count,
      'total_count', le.total_count,
      'rare_count', le.rare_count,
      'epic_count', le.epic_count,
      'legendary_count', le.legendary_count,
      'mint_count', le.minted_count,
      'generated_at', le.calculated_at,
      'updated_at', le.calculated_at
    )
    into v_my_entry
    from album.leaderboard_entries le
    join core.users u on u.id = le.user_id
    left join core.user_profiles up on up.user_id = u.id
    where le.leaderboard_id = v_board.id
      and le.user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'board_id', v_board.id,
    'period', coalesce(p_period, 'current_week'),
    'scope', coalesce(p_scope, 'global'),
    'sort', coalesce(p_sort, 'score_desc'),
    'around_me', coalesce(p_around_me, false),
    'filters', jsonb_build_object(
      'series_id', p_series_id,
      'faction_id', p_faction_id,
      'rarity', p_rarity
    ),
    'entries', v_entries,
    'my_entry', v_my_entry,
    'next_cursor', case when v_offset + v_limit < coalesce(v_total, 0) then (v_offset + v_limit)::text else null end,
    'generated_at', coalesce(v_generated_at, v_board.updated_at, v_board.created_at)
  );
end;
$$;

create or replace function api.album_refresh_weekly_leaderboard(
  p_week_start timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts_at timestamptz := coalesce(date_trunc('week', p_week_start), date_trunc('week', now()));
  v_ends_at timestamptz := coalesce(date_trunc('week', p_week_start), date_trunc('week', now())) + interval '1 week';
  v_week_key text;
  v_board_id uuid;
  v_total_templates integer;
  v_discovery_points numeric(38,0);
  v_completion_rule_count integer;
  v_mint_points numeric(38,0);
  v_entry_count integer;
begin
  v_week_key := to_char(v_starts_at, 'IYYY-"W"IW');

  insert into album.weekly_leaderboards (week_key, starts_at, ends_at, status, metadata)
  values (
    v_week_key,
    v_starts_at,
    v_ends_at,
    case when now() >= v_ends_at then 'settled' else 'active' end,
    jsonb_build_object('source', 'album_refresh_weekly_leaderboard')
  )
  on conflict (week_key) do update
  set starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      status = case when album.weekly_leaderboards.status = 'archived' then album.weekly_leaderboards.status else excluded.status end,
      updated_at = now()
  returning id into v_board_id;

  select count(*)::integer
  into v_total_templates
  from catalog.collectible_templates ct
  where ct.release_status = 'active';

  select coalesce(sum(points), 0)
  into v_discovery_points
  from album.score_rules
  where active = true
    and rule_type = 'discovery';

  select count(*)::integer
  into v_completion_rule_count
  from album.score_rules
  where active = true
    and rule_type = 'completion_bonus';

  select coalesce(sum(points), 0)
  into v_mint_points
  from album.score_rules
  where active = true
    and rule_type = 'mint_bonus';

  if coalesce(v_discovery_points, 0) <= 0 then
    raise exception 'leaderboard score rules not configured';
  end if;

  delete from album.leaderboard_entries
  where leaderboard_id = v_board_id;

  with user_stats as (
    select
      ud.user_id,
      count(distinct ud.template_id)::integer as collected_count,
      count(distinct ud.template_id) filter (where ct.rarity_code = 'RARE')::integer as rare_count,
      count(distinct ud.template_id) filter (where ct.rarity_code = 'EPIC')::integer as epic_count,
      count(distinct ud.template_id) filter (where ct.rarity_code = 'LEGENDARY')::integer as legendary_count,
      coalesce(sum(coalesce(rarity_rule.points, 0)), 0)::numeric as rarity_bonus
    from album.user_discoveries ud
    join catalog.collectible_templates ct on ct.id = ud.template_id
    left join album.score_rules rarity_rule
      on rarity_rule.active = true
     and rarity_rule.rule_type = 'rarity_bonus'
     and rarity_rule.rarity_code = ct.rarity_code
    where ct.release_status = 'active'
    group by ud.user_id
  ),
  mint_stats as (
    select
      owner_user_id as user_id,
      count(*)::integer as mint_count
    from onchain.nft_items
    where status = 'minted'
      and owner_user_id is not null
    group by owner_user_id
  ),
  scored as (
    select
      us.user_id,
      (
        us.collected_count * v_discovery_points
        + us.rarity_bonus
        + coalesce(ms.mint_count, 0) * v_mint_points
        + completion_bonus.points
      )::numeric(38,0) as score,
      us.collected_count,
      v_total_templates as total_count,
      case when v_total_templates = 0 then 0 else round((us.collected_count::numeric * 100) / v_total_templates, 2) end as completion_percent,
      us.rare_count,
      us.epic_count,
      us.legendary_count,
      coalesce(ms.mint_count, 0)::integer as minted_count
    from user_stats us
    left join mint_stats ms on ms.user_id = us.user_id
    left join lateral (
      select coalesce(sum(sr.points), 0)::numeric as points
      from album.score_rules sr
      where sr.active = true
        and sr.rule_type = 'completion_bonus'
        and (
          case
            when v_total_templates = 0 then 0
            else round((us.collected_count::numeric * 100) / v_total_templates, 2)
          end
        ) >= coalesce(nullif(sr.metadata ->> 'required_percent', '')::numeric, 100)
    ) completion_bonus on true
  ),
  ranked as (
    select
      row_number() over (
        order by score desc, completion_percent desc, legendary_count desc, epic_count desc, rare_count desc, minted_count desc, user_id asc
      )::integer as rank,
      *
    from scored
  )
  insert into album.leaderboard_entries (
    leaderboard_id,
    user_id,
    rank,
    score,
    collected_count,
    total_count,
    completion_percent,
    rare_count,
    epic_count,
    legendary_count,
    minted_count,
    metadata,
    calculated_at
  )
  select
    v_board_id,
    user_id,
    rank,
    score,
    collected_count,
    total_count,
    completion_percent,
    rare_count,
    epic_count,
    legendary_count,
    minted_count,
    jsonb_build_object(
      'discovery_points', v_discovery_points,
      'completion_rule_count', v_completion_rule_count,
      'mint_points', v_mint_points,
      'generated_by', 'album_refresh_weekly_leaderboard'
    ),
    now()
  from ranked;

  get diagnostics v_entry_count = row_count;

  return jsonb_build_object(
    'board_id', v_board_id,
    'week_key', v_week_key,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at,
    'entry_count', v_entry_count,
    'generated_at', now()
  );
end;
$$;

revoke execute on function api._album_normalize_rewards(jsonb) from public, anon, authenticated;
revoke execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke execute on function api.inventory_get_upgrade_preview(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function api.inventory_get_evolution_preview(uuid, uuid[], uuid) from public, anon, authenticated;
revoke execute on function api.inventory_get_decompose_preview(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function api.inventory_decompose_items(uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function api.inventory_decompose_item(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function api.album_get_progress(uuid, uuid, text, uuid, uuid, text, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke execute on function api.album_list_books(uuid, text, uuid[], uuid[], text[], integer, integer) from public, anon, authenticated;
revoke execute on function api.album_get_leaderboard(uuid, uuid, text, text, uuid, uuid, text, text, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function api.album_refresh_weekly_leaderboard(timestamptz) from public, anon, authenticated;
revoke execute on function api.album_claim_milestone(uuid, uuid) from public, anon, authenticated;

grant execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean) to service_role;
grant execute on function api.inventory_get_upgrade_preview(uuid, uuid, integer) to service_role;
grant execute on function api.inventory_get_evolution_preview(uuid, uuid[], uuid) to service_role;
grant execute on function api.inventory_get_decompose_preview(uuid, uuid[]) to service_role;
grant execute on function api.inventory_decompose_items(uuid, uuid[], text) to service_role;
grant execute on function api.inventory_decompose_item(uuid, uuid, text) to service_role;
grant execute on function api.album_get_progress(uuid, uuid, text, uuid, uuid, text, boolean, boolean, boolean, boolean) to service_role;
grant execute on function api.album_list_books(uuid, text, uuid[], uuid[], text[], integer, integer) to service_role;
grant execute on function api.album_get_leaderboard(uuid, uuid, text, text, uuid, uuid, text, text, boolean, integer, integer) to service_role;
grant execute on function api.album_refresh_weekly_leaderboard(timestamptz) to service_role;
grant execute on function api.album_claim_milestone(uuid, uuid) to service_role;

commit;
