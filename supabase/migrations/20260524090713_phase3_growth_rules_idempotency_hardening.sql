begin;

alter table inventory.upgrade_logs
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

alter table inventory.evolution_attempts
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column inventory.upgrade_logs.idempotency_key is 'Client supplied idempotency key for inventory upgrade writes.';
comment on column inventory.upgrade_logs.request_fingerprint is 'Stable fingerprint of the upgrade request guarded by the idempotency key.';
comment on column inventory.evolution_attempts.idempotency_key is 'Client supplied idempotency key for inventory evolution writes.';
comment on column inventory.evolution_attempts.request_fingerprint is 'Stable fingerprint of the evolution request guarded by the idempotency key.';

with copied_rules as (
  select
    ur.rarity_code,
    target_forms.form_index,
    ur.from_level,
    ur.to_level,
    ur.cost_fgems,
    ur.power_gain
  from inventory.upgrade_rules ur
  cross join (values (2), (3)) as target_forms(form_index)
  where ur.active = true
    and ur.form_index = 1
)
insert into inventory.upgrade_rules (
  rarity_code,
  form_index,
  from_level,
  to_level,
  cost_fgems,
  power_gain,
  active,
  metadata
)
select
  rarity_code,
  form_index,
  from_level,
  to_level,
  cost_fgems,
  power_gain,
  true,
  jsonb_build_object(
    'phase', 'stage_3_growth_system',
    'guide_section', '4.1_upgrade_rules',
    'copied_from_form_index', 1,
    'migration', 'phase3_growth_rules_idempotency_hardening'
  )
from copied_rules
on conflict (rarity_code, form_index, from_level, to_level, active)
do update
set cost_fgems = excluded.cost_fgems,
    power_gain = excluded.power_gain,
    metadata = inventory.upgrade_rules.metadata || excluded.metadata,
    updated_at = now();

create unique index if not exists upgrade_rules_one_active_from_level
  on inventory.upgrade_rules (rarity_code, form_index, from_level)
  where active = true;

create unique index if not exists evolution_rules_one_active_source_form
  on inventory.evolution_rules (from_template_id, from_form_id)
  where active = true;

create unique index if not exists upgrade_logs_idempotency_key_unique
  on inventory.upgrade_logs (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists evolution_attempts_idempotency_key_unique
  on inventory.evolution_attempts (idempotency_key)
  where idempotency_key is not null;

create or replace function api.inventory_upgrade_item(
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
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_form catalog.collectible_forms%rowtype;
  v_rule inventory.upgrade_rules%rowtype;
  v_debit jsonb;
  v_new_level integer;
  v_new_power integer;
  v_log inventory.upgrade_logs%rowtype;
  v_log_id uuid;
  v_idempotency_key text;
  v_request_fingerprint text;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
  end if;

  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  v_request_fingerprint := md5(jsonb_build_object(
    'operation', 'inventory_upgrade',
    'user_id', p_user_id,
    'item_instance_id', p_item_instance_id
  )::text);

  perform pg_advisory_xact_lock(hashtext('inventory_growth'), hashtext(v_idempotency_key));

  select * into v_log
  from inventory.upgrade_logs
  where idempotency_key = v_idempotency_key;

  if v_log.id is not null then
    if v_log.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency conflict';
    end if;

    return jsonb_build_object(
      'item_instance_id', v_log.item_instance_id,
      'from_level', v_log.from_level,
      'to_level', v_log.to_level,
      'from_power', v_log.from_power,
      'to_power', v_log.to_power,
      'cost_fgems', v_log.cost_fgems
    );
  end if;

  if exists (
    select 1
    from inventory.evolution_attempts
    where idempotency_key = v_idempotency_key
  ) then
    raise exception 'idempotency conflict';
  end if;

  select * into v_item
  from inventory.item_instances
  where id = p_item_instance_id
  for update;

  if v_item.id is null then
    raise exception 'item not found';
  end if;
  if v_item.owner_user_id <> p_user_id then
    raise exception 'not item owner';
  end if;
  if v_item.status <> 'available' then
    raise exception 'item is not available';
  end if;

  select * into v_template from catalog.collectible_templates where id = v_item.template_id;
  if not v_template.upgradeable then
    raise exception 'item is not upgradeable';
  end if;
  if v_item.level >= v_template.max_level then
    raise exception 'item already at max level';
  end if;

  select * into v_form from catalog.collectible_forms where id = v_item.form_id;

  select * into v_rule
  from inventory.upgrade_rules
  where rarity_code = v_template.rarity_code
    and form_index = coalesce(v_form.form_index, 1)
    and from_level = v_item.level
    and active = true
  limit 1;

  if v_rule.id is null then
    raise exception 'upgrade rule not found';
  end if;

  v_debit := api._debit_balance(
    p_user_id, 'FGEMS', v_rule.cost_fgems, 'inventory_upgrade', p_item_instance_id, null,
    v_idempotency_key,
    'Upgrade collectible',
    jsonb_build_object('item_instance_id', p_item_instance_id, 'from_level', v_item.level, 'to_level', v_rule.to_level)
  );

  if coalesce((v_debit ->> 'idempotent')::boolean, false) then
    select * into v_log
    from inventory.upgrade_logs
    where idempotency_key = v_idempotency_key;

    if v_log.id is not null and v_log.request_fingerprint = v_request_fingerprint then
      return jsonb_build_object(
        'item_instance_id', v_log.item_instance_id,
        'from_level', v_log.from_level,
        'to_level', v_log.to_level,
        'from_power', v_log.from_power,
        'to_power', v_log.to_power,
        'cost_fgems', v_log.cost_fgems
      );
    end if;

    raise exception 'idempotency conflict';
  end if;

  v_new_level := v_rule.to_level;
  v_new_power := v_item.power + v_rule.power_gain;

  update inventory.item_instances
  set level = v_new_level,
      power = v_new_power,
      updated_at = now(),
      lock_version = lock_version + 1
  where id = p_item_instance_id;

  insert into inventory.upgrade_logs (
    user_id, item_instance_id, rule_id, from_level, to_level,
    from_power, to_power, cost_fgems, ledger_id,
    idempotency_key, request_fingerprint
  ) values (
    p_user_id, p_item_instance_id, v_rule.id, v_item.level, v_new_level,
    v_item.power, v_new_power, v_rule.cost_fgems, (v_debit ->> 'ledger_id')::uuid,
    v_idempotency_key, v_request_fingerprint
  ) returning id into v_log_id;

  insert into inventory.item_instance_events (
    item_instance_id, user_id, event_type, source_type, source_id, before_state, after_state
  ) values (
    p_item_instance_id, p_user_id, 'upgraded', 'inventory_upgrade', v_log_id,
    jsonb_build_object('level', v_item.level, 'power', v_item.power),
    jsonb_build_object('level', v_new_level, 'power', v_new_power)
  );

  return jsonb_build_object(
    'item_instance_id', p_item_instance_id,
    'from_level', v_item.level,
    'to_level', v_new_level,
    'from_power', v_item.power,
    'to_power', v_new_power,
    'cost_fgems', v_rule.cost_fgems
  );
end;
$$;

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
  v_attempt inventory.evolution_attempts%rowtype;
  v_attempt_id uuid;
  v_result_item_id uuid;
  v_result_power integer;
  v_idempotency_key text;
  v_sorted_item_ids uuid[];
  v_request_fingerprint text;
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

  v_idempotency_key := nullif(btrim(p_idempotency_key), '');
  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  select array_agg(x.id order by x.id)
  into v_sorted_item_ids
  from unnest(p_item_instance_ids) as x(id);

  v_request_fingerprint := md5(jsonb_build_object(
    'operation', 'inventory_evolution',
    'user_id', p_user_id,
    'item_instance_ids', to_jsonb(v_sorted_item_ids)
  )::text);

  perform pg_advisory_xact_lock(hashtext('inventory_growth'), hashtext(v_idempotency_key));

  select * into v_attempt
  from inventory.evolution_attempts
  where idempotency_key = v_idempotency_key;

  if v_attempt.id is not null then
    if v_attempt.request_fingerprint is distinct from v_request_fingerprint then
      raise exception 'idempotency conflict';
    end if;

    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'success', v_attempt.status = 'success',
      'random_roll_bps', v_attempt.random_roll_bps,
      'success_rate_bps', v_attempt.success_rate_bps,
      'main_item_instance_id', v_attempt.main_item_instance_id,
      'result_item_instance_id', v_attempt.result_item_instance_id,
      'cost_kcoin', v_attempt.cost_kcoin
    );
  end if;

  if exists (
    select 1
    from inventory.upgrade_logs
    where idempotency_key = v_idempotency_key
  ) then
    raise exception 'idempotency conflict';
  end if;

  perform 1
  from inventory.item_instances
  where id = any(p_item_instance_ids)
  order by id
  for update;

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
    v_idempotency_key,
    'Evolve collectible',
    jsonb_build_object('item_instance_ids', p_item_instance_ids, 'rule_id', v_rule.id)
  );

  if coalesce((v_debit ->> 'idempotent')::boolean, false) then
    select * into v_attempt
    from inventory.evolution_attempts
    where idempotency_key = v_idempotency_key;

    if v_attempt.id is not null and v_attempt.request_fingerprint = v_request_fingerprint then
      return jsonb_build_object(
        'attempt_id', v_attempt.id,
        'success', v_attempt.status = 'success',
        'random_roll_bps', v_attempt.random_roll_bps,
        'success_rate_bps', v_attempt.success_rate_bps,
        'main_item_instance_id', v_attempt.main_item_instance_id,
        'result_item_instance_id', v_attempt.result_item_instance_id,
        'cost_kcoin', v_attempt.cost_kcoin
      );
    end if;

    raise exception 'idempotency conflict';
  end if;

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
    metadata, idempotency_key, request_fingerprint
  ) values (
    p_user_id, v_rule.id, v_main_item_id, v_result_item_id,
    case when v_success then 'success' else 'failed' end,
    v_rule.cost_kcoin, v_rule.success_rate_bps, v_roll, (v_debit ->> 'ledger_id')::uuid,
    jsonb_build_object('input_item_instance_ids', p_item_instance_ids),
    v_idempotency_key, v_request_fingerprint
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

grant execute on function api.inventory_upgrade_item(uuid, uuid, text) to service_role;
grant execute on function api.inventory_evolve_item(uuid, uuid[], text) to service_role;
revoke execute on function api.inventory_upgrade_item(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function api.inventory_evolve_item(uuid, uuid[], text) from public, anon, authenticated;

commit;
