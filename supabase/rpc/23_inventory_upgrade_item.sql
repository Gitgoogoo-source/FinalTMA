-- inventory_upgrade_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_upgrade_item

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
  v_log_id uuid;
begin
  if p_user_id is null or p_item_instance_id is null then
    raise exception 'user_id and item_instance_id are required';
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

  -- form_index is the item's fixed star form from generation time.
  -- The upgrade rule is matched by rarity + fixed star form + current level;
  -- this RPC changes level and power only, never form_index.
  select * into v_rule
  from inventory.upgrade_rules
  where rarity_code = v_template.rarity_code
    and form_index = coalesce(v_form.form_index, 1)
    and from_level = v_item.level
    and active = true
  order by created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'upgrade rule not found';
  end if;

  v_debit := api._debit_balance(
    p_user_id, 'FGEMS', v_rule.cost_fgems, 'inventory_upgrade', p_item_instance_id, null,
    coalesce(p_idempotency_key, 'inventory_upgrade:' || p_item_instance_id::text || ':' || v_item.level::text),
    'Upgrade collectible',
    jsonb_build_object('item_instance_id', p_item_instance_id, 'from_level', v_item.level, 'to_level', v_rule.to_level)
  );

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
    from_power, to_power, cost_fgems, ledger_id
  ) values (
    p_user_id, p_item_instance_id, v_rule.id, v_item.level, v_new_level,
    v_item.power, v_new_power, v_rule.cost_fgems, (v_debit ->> 'ledger_id')::uuid
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


-- ============================================================
