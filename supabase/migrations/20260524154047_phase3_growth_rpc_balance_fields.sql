begin;

alter function api.inventory_upgrade_item(uuid, uuid, text)
  rename to inventory_upgrade_item_without_balance_fields;

alter function api.inventory_evolve_item(uuid, uuid[], text)
  rename to inventory_evolve_item_without_balance_fields;

alter function api.inventory_decompose_items(uuid, uuid[], text)
  rename to inventory_decompose_items_without_balance_fields;

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
  v_result jsonb;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_ledger economy.currency_ledger%rowtype;
begin
  v_result := api.inventory_upgrade_item_without_balance_fields(
    p_user_id,
    p_item_instance_id,
    p_idempotency_key
  );

  select ledger.*
  into v_ledger
  from inventory.upgrade_logs logs
  join economy.currency_ledger ledger on ledger.id = logs.ledger_id
  where logs.user_id = p_user_id
    and logs.item_instance_id = p_item_instance_id
    and logs.idempotency_key = v_idempotency_key
  order by logs.created_at desc
  limit 1;

  if v_ledger.id is null then
    return v_result;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'ledger_id', v_ledger.id,
    'currency_code', v_ledger.currency_code,
    'fgems_balance_before', v_ledger.available_before,
    'fgems_balance_after', v_ledger.available_after,
    'balance_before', v_ledger.available_before,
    'balance_after', v_ledger.available_after,
    'available_before', v_ledger.available_before,
    'available_after', v_ledger.available_after,
    'balance_delta', -abs(v_ledger.amount),
    'upgraded_at', v_ledger.created_at
  ));
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
  v_result jsonb;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_attempt_id uuid;
  v_ledger economy.currency_ledger%rowtype;
begin
  v_result := api.inventory_evolve_item_without_balance_fields(
    p_user_id,
    p_item_instance_ids,
    p_idempotency_key
  );

  v_attempt_id := nullif(v_result ->> 'attempt_id', '')::uuid;

  select ledger.*
  into v_ledger
  from inventory.evolution_attempts attempts
  join economy.currency_ledger ledger on ledger.id = attempts.ledger_id
  where attempts.user_id = p_user_id
    and attempts.id = v_attempt_id
    and attempts.idempotency_key = v_idempotency_key
  order by attempts.created_at desc
  limit 1;

  if v_ledger.id is null then
    return v_result;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'ledger_id', v_ledger.id,
    'currency_code', v_ledger.currency_code,
    'kcoin_balance_before', v_ledger.available_before,
    'kcoin_balance_after', v_ledger.available_after,
    'balance_before', v_ledger.available_before,
    'balance_after', v_ledger.available_after,
    'available_before', v_ledger.available_before,
    'available_after', v_ledger.available_after,
    'balance_delta', -abs(v_ledger.amount),
    'evolved_at', v_ledger.created_at
  ));
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
  v_result jsonb;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_ledger economy.currency_ledger%rowtype;
begin
  v_result := api.inventory_decompose_items_without_balance_fields(
    p_user_id,
    p_item_instance_ids,
    p_idempotency_key
  );

  select ledger.*
  into v_ledger
  from inventory.decompose_logs logs
  join economy.currency_ledger ledger on ledger.id = logs.ledger_id
  where logs.user_id = p_user_id
    and logs.idempotency_key = v_idempotency_key
  order by logs.created_at desc
  limit 1;

  if v_ledger.id is null then
    return v_result;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'ledger_id', v_ledger.id,
    'currency_code', v_ledger.currency_code,
    'fgems_balance_before', v_ledger.available_before,
    'fgems_balance_after', v_ledger.available_after,
    'balance_before', v_ledger.available_before,
    'balance_after', v_ledger.available_after,
    'available_before', v_ledger.available_before,
    'available_after', v_ledger.available_after,
    'balance_delta', abs(v_ledger.amount),
    'decomposed_at', v_ledger.created_at
  ));
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

  return jsonb_strip_nulls(jsonb_build_object(
    'item_instance_id', p_item_instance_id,
    'reward_fgems', nullif(v_item ->> 'reward_fgems', '')::numeric,
    'ledger_id', nullif(v_result ->> 'ledger_id', '')::uuid,
    'fgems_balance_before', nullif(v_result ->> 'fgems_balance_before', '')::numeric,
    'fgems_balance_after', nullif(v_result ->> 'fgems_balance_after', '')::numeric,
    'balance_before', nullif(v_result ->> 'balance_before', '')::numeric,
    'balance_after', nullif(v_result ->> 'balance_after', '')::numeric,
    'available_before', nullif(v_result ->> 'available_before', '')::numeric,
    'available_after', nullif(v_result ->> 'available_after', '')::numeric,
    'balance_delta', nullif(v_result ->> 'balance_delta', '')::numeric,
    'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false)
  ));
end;
$$;

revoke execute on function api.inventory_upgrade_item_without_balance_fields(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function api.inventory_evolve_item_without_balance_fields(uuid, uuid[], text) from public, anon, authenticated, service_role;
revoke execute on function api.inventory_decompose_items_without_balance_fields(uuid, uuid[], text) from public, anon, authenticated, service_role;

revoke execute on function api.inventory_upgrade_item(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function api.inventory_evolve_item(uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function api.inventory_decompose_items(uuid, uuid[], text) from public, anon, authenticated;
revoke execute on function api.inventory_decompose_item(uuid, uuid, text) from public, anon, authenticated;

grant execute on function api.inventory_upgrade_item(uuid, uuid, text) to service_role;
grant execute on function api.inventory_evolve_item(uuid, uuid[], text) to service_role;
grant execute on function api.inventory_decompose_items(uuid, uuid[], text) to service_role;
grant execute on function api.inventory_decompose_item(uuid, uuid, text) to service_role;

commit;
