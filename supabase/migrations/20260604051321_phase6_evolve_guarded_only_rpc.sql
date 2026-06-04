-- Phase 6: make the guarded 7-argument evolution RPC the only public
-- inventory_evolve_item entrypoint. The internal mutation function remains
-- private and is called only after the guarded preview checks pass.

begin;

do $$
begin
  if to_regprocedure('api.inventory_evolve_item_without_balance_fields(uuid,uuid[],text)') is null then
    raise exception 'api.inventory_evolve_item_without_balance_fields(uuid,uuid[],text) is required before guarding inventory evolution';
  end if;

  if to_regprocedure('api.task_record_progress(uuid,text,integer,uuid,text)') is null then
    raise exception 'api.task_record_progress(uuid,text,integer,uuid,text) is required before guarding inventory evolution';
  end if;
end;
$$;

create or replace function api.inventory_evolve_item(
  p_user_id uuid,
  p_item_instance_ids uuid[],
  p_idempotency_key text,
  p_target_form_id uuid,
  p_expected_kcoin_cost numeric,
  p_expected_success_rate_bps integer,
  p_expected_return_item_instance_id uuid
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
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_result jsonb;
  v_attempt_id uuid;
  v_ledger economy.currency_ledger%rowtype;
  v_progress_result jsonb;
begin
  if v_key is null then
    raise exception 'idempotency key is required';
  end if;

  if exists (
    select 1
    from inventory.evolution_attempts attempts
    where attempts.idempotency_key = v_key
  ) then
    v_result := api.inventory_evolve_item_without_balance_fields(
      p_user_id,
      p_item_instance_ids,
      p_idempotency_key
    );
  else
    if p_user_id is null then
      raise exception 'user_id is required';
    end if;

    if p_item_instance_ids is null or cardinality(p_item_instance_ids) <> 3 then
      raise exception 'exactly three item ids are required';
    end if;

    if (select count(*) from (select distinct unnest(p_item_instance_ids) as id) x) <> 3 then
      raise exception 'duplicate item ids are not allowed';
    end if;

    perform 1
    from inventory.item_instances ii
    where ii.id = any(p_item_instance_ids)
    order by ii.id
    for update;

    select
      count(*)::integer,
      (array_agg(distinct ii.template_id))[1],
      (array_agg(distinct ii.form_id))[1],
      count(distinct ii.template_id)::integer,
      count(distinct coalesce(ii.form_id, '00000000-0000-0000-0000-000000000000'::uuid))::integer,
      count(*) filter (
        where ii.owner_user_id <> p_user_id
           or ii.status <> 'available'
           or ii.nft_mint_status in ('queued', 'minting')
           or t.evolvable = false
           or exists (
             select 1
             from inventory.inventory_locks il
             where il.item_instance_id = ii.id
               and il.status = 'active'
           )
      )::integer
    into v_count, v_template_id, v_form_id, v_distinct_templates, v_distinct_forms, v_bad_count
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

    select *
    into v_rule
    from inventory.evolution_rules
    where from_template_id = v_template_id
      and from_form_id = v_form_id
      and active = true
    order by created_at desc
    limit 1;

    if v_rule.id is null then
      raise exception 'evolution rule not found';
    end if;

    select ii.id
    into v_main_item_id
    from inventory.item_instances ii
    where ii.id = any(p_item_instance_ids)
    order by ii.level desc, ii.power desc, ii.acquired_at asc
    limit 1;

    if p_target_form_id is null
       or p_expected_kcoin_cost is null
       or p_expected_success_rate_bps is null
       or p_expected_return_item_instance_id is null then
      raise exception 'evolution preview is required';
    end if;

    if p_target_form_id <> v_rule.to_form_id then
      raise exception 'evolution preview mismatch';
    end if;

    if p_expected_kcoin_cost <> v_rule.cost_kcoin then
      raise exception 'evolution preview mismatch';
    end if;

    if p_expected_success_rate_bps <> v_rule.success_rate_bps then
      raise exception 'evolution preview mismatch';
    end if;

    if p_expected_return_item_instance_id <> v_main_item_id then
      raise exception 'evolution preview mismatch';
    end if;

    v_result := api.inventory_evolve_item_without_balance_fields(
      p_user_id,
      p_item_instance_ids,
      p_idempotency_key
    );
  end if;

  v_attempt_id := nullif(v_result ->> 'attempt_id', '')::uuid;

  select ledger.*
  into v_ledger
  from inventory.evolution_attempts attempts
  join economy.currency_ledger ledger on ledger.id = attempts.ledger_id
  where attempts.user_id = p_user_id
    and attempts.id = v_attempt_id
    and attempts.idempotency_key = v_key
  order by attempts.created_at desc
  limit 1;

  if v_ledger.id is null then
    return v_result;
  end if;

  v_progress_result := api.task_record_progress(
    p_user_id,
    'inventory_evolve_item',
    1,
    v_attempt_id,
    coalesce(v_ledger.created_at, now())::date::text
  );

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
    'evolved_at', v_ledger.created_at,
    'task_progress', v_progress_result
  ));
end;
$$;

revoke execute on function api.inventory_evolve_item(uuid, uuid[], text, uuid, numeric, integer, uuid)
  from public, anon, authenticated;
grant execute on function api.inventory_evolve_item(uuid, uuid[], text, uuid, numeric, integer, uuid)
  to service_role;

revoke execute on function api.inventory_evolve_item_without_balance_fields(uuid, uuid[], text)
  from public, anon, authenticated, service_role;

drop function if exists api.inventory_evolve_item(uuid, uuid[], text);

commit;
