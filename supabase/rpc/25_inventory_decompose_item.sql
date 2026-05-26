-- inventory_decompose_item.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- RPC: api.inventory_decompose_item

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
  v_item inventory.item_instances%rowtype;
  v_template catalog.collectible_templates%rowtype;
  v_form catalog.collectible_forms%rowtype;
  v_rule inventory.decompose_rules%rowtype;
  v_duplicate_count integer;
  v_credit jsonb;
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
  if not v_template.decomposable then
    raise exception 'item is not decomposable';
  end if;

  select count(*)::integer into v_duplicate_count
  from inventory.item_instances
  where owner_user_id = p_user_id
    and template_id = v_item.template_id
    and coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_item.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status = 'available';

  if v_duplicate_count < 2 then
    raise exception 'only duplicate collectibles can be decomposed';
  end if;

  select * into v_form from catalog.collectible_forms where id = v_item.form_id;

  select * into v_rule
  from inventory.decompose_rules
  where rarity_code = v_template.rarity_code
    and form_index = coalesce(v_form.form_index, 1)
    and min_level <= v_item.level
    and active = true
  order by min_level desc, created_at desc
  limit 1;

  if v_rule.id is null then
    raise exception 'decompose rule not found';
  end if;

  update inventory.item_instances
  set status = 'decomposed', owner_user_id = null, updated_at = now(), lock_version = lock_version + 1
  where id = p_item_instance_id;

  v_credit := api._credit_balance(
    p_user_id, 'FGEMS', v_rule.reward_fgems, 'inventory_decompose', p_item_instance_id, null,
    coalesce(p_idempotency_key, 'inventory_decompose:' || p_item_instance_id::text),
    'Decompose collectible',
    jsonb_build_object('item_instance_id', p_item_instance_id, 'rarity_code', v_template.rarity_code)
  );

  insert into inventory.decompose_logs (user_id, item_instance_id, rule_id, reward_fgems, ledger_id)
  values (p_user_id, p_item_instance_id, v_rule.id, v_rule.reward_fgems, (v_credit ->> 'ledger_id')::uuid)
  returning id into v_log_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, before_state, after_state)
  values (
    p_item_instance_id, p_user_id, 'decomposed', 'inventory_decompose', v_log_id,
    jsonb_build_object('status', v_item.status, 'owner_user_id', v_item.owner_user_id),
    jsonb_build_object('status', 'decomposed', 'reward_fgems', v_rule.reward_fgems)
  );

  return jsonb_build_object('item_instance_id', p_item_instance_id, 'reward_fgems', v_rule.reward_fgems, 'ledger_id', v_credit ->> 'ledger_id');
end;
$$;


-- ============================================================
