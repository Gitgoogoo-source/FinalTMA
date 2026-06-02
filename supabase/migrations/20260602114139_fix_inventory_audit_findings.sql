-- Fixes from the user-inventory audit:
-- 1. Serialize duplicate decomposition by user/template/form before the hidden
--    mutation function evaluates duplicate counts and credits FGEMS.
-- 2. Add a persistent uniqueness backstop for marketplace listing-event
--    idempotency keys used by inventory sell/cancel flows.
-- 3. Surface item lock_version in inventory detail so frontend upgrade requests
--    can send expected_item_version.

do $$
begin
  if exists (
    select 1
    from (
      select metadata ->> 'idempotency_key' as idempotency_key, count(*)::integer as event_count
      from market.listing_events
      where nullif(btrim(metadata ->> 'idempotency_key'), '') is not null
      group by metadata ->> 'idempotency_key'
      having count(*) > 1
    ) duplicate_keys
  ) then
    raise exception 'duplicate market listing event idempotency keys exist; resolve duplicates before adding uniqueness guard';
  end if;
end;
$$;

create unique index if not exists listing_events_idempotency_key_uidx
  on market.listing_events ((metadata ->> 'idempotency_key'))
  where nullif(btrim(metadata ->> 'idempotency_key'), '') is not null;

comment on index market.listing_events_idempotency_key_uidx
  is 'Unique backstop for marketplace idempotency keys stored in listing event metadata.';

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
  v_decomposed_count integer;
  v_progress_result jsonb;
begin
  -- The hidden mutation checks duplicate counts before crediting FGEMS. Locking
  -- the owned template/form groups here prevents two different item IDs from
  -- each seeing the same duplicate pool and decomposing the last two copies.
  perform pg_advisory_xact_lock(
    hashtext('inventory_decompose_group'),
    hashtext(p_user_id::text || ':' || group_rows.template_id::text || ':' || group_rows.form_key::text)
  )
  from (
    select distinct
      ii.template_id,
      coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key
    from inventory.item_instances ii
    where ii.id = any(p_item_instance_ids)
      and ii.owner_user_id = p_user_id
    order by 1, 2
  ) group_rows;

  perform 1
  from inventory.item_instances ii
  where ii.owner_user_id = p_user_id
    and exists (
      select 1
      from (
        select distinct
          source_items.template_id,
          coalesce(source_items.form_id, '00000000-0000-0000-0000-000000000000'::uuid) as form_key
        from inventory.item_instances source_items
        where source_items.id = any(p_item_instance_ids)
          and source_items.owner_user_id = p_user_id
      ) group_rows
      where group_rows.template_id = ii.template_id
        and group_rows.form_key = coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid)
    )
  order by ii.id
  for update of ii;

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

  v_decomposed_count := greatest(
    coalesce(jsonb_array_length(v_result -> 'items'), cardinality(p_item_instance_ids), 1),
    1
  );

  v_progress_result := api.task_record_progress(
    p_user_id,
    'inventory_decompose_item',
    v_decomposed_count,
    v_ledger.id,
    coalesce(v_ledger.created_at, now())::date::text
  );

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
    'decomposed_at', v_ledger.created_at,
    'task_progress', v_progress_result
  ));
end;
$$;

revoke execute on function api.inventory_decompose_items(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function api.inventory_decompose_items(uuid, uuid[], text) to service_role;

do $$
begin
  if to_regprocedure('api.inventory_get_item_detail_without_item_version(uuid,uuid,boolean,boolean,boolean,boolean,boolean)') is null then
    alter function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean)
      rename to inventory_get_item_detail_without_item_version;
  end if;
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
  v_result jsonb;
  v_lock_version integer;
begin
  v_result := api.inventory_get_item_detail_without_item_version(
    p_user_id,
    p_item_instance_id,
    p_include_market_status,
    p_include_upgrade_preview,
    p_include_evolution_preview,
    p_include_decompose_preview,
    p_include_onchain_status
  );

  select ii.lock_version
  into v_lock_version
  from inventory.item_instances ii
  where ii.id = p_item_instance_id
    and ii.owner_user_id = p_user_id;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'item_version', v_lock_version,
    'lock_version', v_lock_version
  ));
end;
$$;

revoke execute on function api.inventory_get_item_detail_without_item_version(uuid, uuid, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean)
  to service_role;
