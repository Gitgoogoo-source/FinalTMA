-- inventory_evolve_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_evolve_item

create or replace function api.inventory_evolve_item(
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
  v_count integer;
  v_template_id uuid;
  v_form_id uuid;
  v_distinct_templates integer;
  v_distinct_forms integer;
  v_bad_count integer;
  v_rule inventory.evolution_rules%rowtype;
  v_main_item_id uuid;
  v_max_level integer;
  v_max_power integer;
  v_roll integer;
  v_success boolean;
  v_debit jsonb;
  v_attempt_id uuid;
  v_result_item_id uuid;
  v_result_power integer;
begin
  if p_user_id is null then
    raise exception 'user_id is required';
  end if;
  if p_item_instance_ids is null or cardinality(p_item_instance_ids) <> 3 then
    raise exception 'exactly three item ids are required';
  end if;
  if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> 3 then
    raise exception 'duplicate item ids are not allowed';
  end if;

  perform 1 from inventory.item_instances where id = any(p_item_instance_ids) for update;

  select
    count(*)::integer,
    (array_agg(distinct ii.template_id))[1],
    (array_agg(distinct ii.form_id))[1],
    count(distinct ii.template_id)::integer,
    count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
    count(*) filter (where ii.owner_user_id <> p_user_id or ii.status <> 'available' or t.evolvable = false)::integer,
    max(ii.level)::integer,
    max(ii.power)::integer
  into v_count, v_template_id, v_form_id, v_distinct_templates, v_distinct_forms, v_bad_count, v_max_level, v_max_power
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = any(p_item_instance_ids);

  if v_count <> 3 then
    raise exception 'some items do not exist';
  end if;
  if v_bad_count > 0 then
    raise exception 'some items are not evolvable or not available';
  end if;
  if v_distinct_templates <> 1 or v_distinct_forms <> 1 then
    raise exception 'evolution requires three copies of the same collectible and form';
  end if;
  if v_form_id is null then
    raise exception 'source form is required for evolution';
  end if;

  select * into v_rule
  from inventory.evolution_rules
  where from_template_id = v_template_id
    and from_form_id = v_form_id
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'evolution rule not found';
  end if;

  select id into v_main_item_id
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  order by level desc, power desc, acquired_at asc
  limit 1;

  v_debit := api._debit_balance(
    p_user_id, 'KCOIN', v_rule.cost_kcoin, 'inventory_evolution', v_rule.id, null,
    coalesce(p_idempotency_key, 'inventory_evolution:' || array_to_string(p_item_instance_ids, ',')),
    'Evolve collectible',
    jsonb_build_object('item_instance_ids', p_item_instance_ids, 'rule_id', v_rule.id)
  );

  v_roll := floor(random() * 10000)::integer + 1;
  v_success := v_roll <= v_rule.success_rate_bps;

  if v_success then
    select ct.base_power + coalesce(cf.base_power_bonus, 0) + greatest(v_max_level - 1, 0)
    into v_result_power
    from catalog.collectible_templates ct
    left join catalog.collectible_forms cf on cf.id = v_rule.to_form_id
    where ct.id = v_rule.to_template_id;

    update inventory.item_instances
    set status = 'consumed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
    where id = any(p_item_instance_ids);

    insert into inventory.item_instances (
      owner_user_id, template_id, form_id, level, power, status, source_type, source_id, metadata
    ) values (
      p_user_id, v_rule.to_template_id, v_rule.to_form_id, greatest(v_max_level, 1), coalesce(v_result_power, v_max_power),
      'available', 'evolution', v_rule.id,
      jsonb_build_object('source_item_instance_ids', p_item_instance_ids, 'main_item_instance_id', v_main_item_id)
    ) returning id into v_result_item_id;

    insert into album.user_discoveries (user_id, template_id, first_item_instance_id, first_source_type, first_source_id)
    values (p_user_id, v_rule.to_template_id, v_result_item_id, 'evolution', v_rule.id)
    on conflict (user_id, template_id) do nothing;
  else
    update inventory.item_instances
    set status = 'consumed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
    where id = any(p_item_instance_ids) and id <> v_main_item_id;

    update inventory.item_instances
    set status = 'available', updated_at = now(), lock_version = lock_version + 1
    where id = v_main_item_id;
  end if;

  insert into inventory.evolution_attempts (
    user_id, rule_id, main_item_instance_id, result_item_instance_id,
    status, cost_kcoin, success_rate_bps, random_roll_bps, ledger_id,
    metadata
  ) values (
    p_user_id, v_rule.id, v_main_item_id, v_result_item_id,
    case when v_success then 'success' else 'failed' end,
    v_rule.cost_kcoin, v_rule.success_rate_bps, v_roll, (v_debit ->> 'ledger_id')::uuid,
    jsonb_build_object('input_item_instance_ids', p_item_instance_ids)
  ) returning id into v_attempt_id;

  insert into inventory.evolution_consumed_items (attempt_id, item_instance_id, role, consumed, returned)
  select v_attempt_id,
         x.id,
         case when x.id = v_main_item_id then 'main' else 'material' end,
         case when v_success then true else x.id <> v_main_item_id end,
         case when v_success then false else x.id = v_main_item_id end
  from unnest(p_item_instance_ids) as x(id);

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  select x.id,
         p_user_id,
         case when v_success then 'consumed' when x.id = v_main_item_id then 'evolved_failed_returned' else 'consumed' end,
         'inventory_evolution',
         v_attempt_id,
         jsonb_build_object('attempt_id', v_attempt_id, 'success', v_success, 'result_item_instance_id', v_result_item_id)
  from unnest(p_item_instance_ids) as x(id);

  if v_success then
    insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
    values (v_result_item_id, p_user_id, 'evolved_success', 'inventory_evolution', v_attempt_id,
            jsonb_build_object('source_item_instance_ids', p_item_instance_ids));
  end if;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'success', v_success,
    'random_roll_bps', v_roll,
    'success_rate_bps', v_rule.success_rate_bps,
    'main_item_instance_id', v_main_item_id,
    'result_item_instance_id', v_result_item_id,
    'cost_kcoin', v_rule.cost_kcoin
  );
end;
$$;


-- ============================================================
