-- Phase 4 / 9.1 remaining task progress source wiring.
-- Scope: connect the documented inventory evolve/decompose and album claim
-- business events to api.task_record_progress without adding new active task
-- definitions or changing user-facing reward seed data.

begin;

do $$
begin
  if to_regprocedure('api.task_record_progress(uuid,text,integer,uuid,text)') is null then
    raise exception 'api.task_record_progress(uuid,text,integer,uuid,text) is required before wiring remaining task progress sources';
  end if;
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
  v_progress_result jsonb;
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
  v_ledger_id uuid;
  v_progress_result jsonb;
begin
  v_result := api.inventory_decompose_items(
    p_user_id,
    array[p_item_instance_id]::uuid[],
    p_idempotency_key
  );
  v_item := v_result -> 'items' -> 0;
  v_progress_result := v_result -> 'task_progress';

  if v_progress_result is null then
    v_ledger_id := nullif(v_result ->> 'ledger_id', '')::uuid;

    if v_ledger_id is not null then
      v_progress_result := api.task_record_progress(
        p_user_id,
        'inventory_decompose_item',
        1,
        v_ledger_id,
        coalesce(nullif(v_result ->> 'decomposed_at', '')::timestamptz, now())::date::text
      );
    end if;
  end if;

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
    'idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'task_progress', v_progress_result
  ));
end;
$$;

create or replace function api.album_claim_milestone(
  p_user_id uuid,
  p_milestone_id uuid,
  p_idempotency_key text,
  p_expected_milestone_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_milestone album.milestones%rowtype;
  v_claim album.milestone_claims%rowtype;
  v_collected_count integer;
  v_milestone_version integer;
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_request_fingerprint text;
  v_rewards_result jsonb := '[]'::jsonb;
  v_progress_result jsonb;
begin
  if p_user_id is null or p_milestone_id is null then
    raise exception 'user_id and milestone_id are required';
  end if;

  if v_idempotency_key is null then
    raise exception 'idempotency key is required';
  end if;

  v_request_fingerprint := p_user_id::text || ':' || p_milestone_id::text;

  select * into v_claim
  from album.milestone_claims
  where idempotency_key = v_idempotency_key
  for update;

  if v_claim.id is not null then
    if v_claim.user_id <> p_user_id or v_claim.milestone_id <> p_milestone_id then
      raise exception 'idempotency conflict';
    end if;

    select * into v_milestone
    from album.milestones
    where id = v_claim.milestone_id;

    v_progress_result := api.task_record_progress(
      p_user_id,
      'album_claim_milestone',
      1,
      v_claim.id,
      coalesce(v_claim.claimed_at, now())::date::text
    );

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'milestone_id', v_claim.milestone_id,
      'book_id', v_milestone.book_id,
      'status', 'claimed',
      'required_count', v_milestone.required_count,
      'reward', v_claim.reward,
      'rewards', api._album_normalize_rewards(v_claim.reward),
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true,
      'task_progress', v_progress_result
    );
  end if;

  select * into v_milestone
  from album.milestones
  where id = p_milestone_id and active = true;

  if v_milestone.id is null then
    raise exception 'milestone not found';
  end if;

  v_milestone_version := case
    when (v_milestone.metadata ->> 'version') ~ '^[0-9]+$'
      then (v_milestone.metadata ->> 'version')::integer
    else 0
  end;

  select * into v_claim
  from album.milestone_claims
  where user_id = p_user_id and milestone_id = p_milestone_id
  for update;

  if v_claim.id is not null then
    if v_claim.idempotency_key is null then
      update album.milestone_claims
      set idempotency_key = v_idempotency_key,
          request_fingerprint = v_request_fingerprint,
          metadata = metadata || jsonb_build_object('idempotency_key_backfilled_at', now())
      where id = v_claim.id
      returning * into v_claim;
    end if;

    v_progress_result := api.task_record_progress(
      p_user_id,
      'album_claim_milestone',
      1,
      v_claim.id,
      coalesce(v_claim.claimed_at, now())::date::text
    );

    return jsonb_build_object(
      'claim_id', v_claim.id,
      'milestone_id', v_claim.milestone_id,
      'book_id', v_milestone.book_id,
      'status', 'claimed',
      'required_count', v_milestone.required_count,
      'reward', v_claim.reward,
      'rewards', api._album_normalize_rewards(v_claim.reward),
      'ledger_results', '[]'::jsonb,
      'claimed_at', v_claim.claimed_at,
      'idempotent', true,
      'task_progress', v_progress_result
    );
  end if;

  if p_expected_milestone_version is not null
     and p_expected_milestone_version <> v_milestone_version then
    raise exception 'milestone version mismatch: expected %, current %',
      p_expected_milestone_version,
      v_milestone_version;
  end if;

  select count(*)::integer into v_collected_count
  from album.book_items bi
  join album.user_discoveries ud
    on ud.template_id = bi.template_id
   and ud.user_id = p_user_id
  where bi.book_id = v_milestone.book_id;

  if v_collected_count < v_milestone.required_count then
    raise exception 'milestone not reached: collected %, required %', v_collected_count, v_milestone.required_count;
  end if;

  insert into album.milestone_claims (
    user_id,
    milestone_id,
    reward,
    idempotency_key,
    request_fingerprint,
    metadata
  )
  values (
    p_user_id,
    p_milestone_id,
    v_milestone.reward,
    v_idempotency_key,
    v_request_fingerprint,
    jsonb_build_object(
      'idempotency_key_source', 'api',
      'expected_milestone_version', p_expected_milestone_version,
      'milestone_version', v_milestone_version
    )
  )
  returning * into v_claim;

  v_rewards_result := api._apply_reward_json(
    p_user_id,
    v_milestone.reward,
    'album_milestone',
    v_claim.id,
    'album_milestone:' || v_idempotency_key
  );

  v_progress_result := api.task_record_progress(
    p_user_id,
    'album_claim_milestone',
    1,
    v_claim.id,
    coalesce(v_claim.claimed_at, now())::date::text
  );

  return jsonb_build_object(
    'claim_id', v_claim.id,
    'milestone_id', v_claim.milestone_id,
    'book_id', v_milestone.book_id,
    'status', 'claimed',
    'collected_count', v_collected_count,
    'required_count', v_milestone.required_count,
    'reward', v_milestone.reward,
    'rewards', api._album_normalize_rewards(v_milestone.reward),
    'ledger_results', v_rewards_result,
    'claimed_at', v_claim.claimed_at,
    'idempotent', false,
    'milestone_version', v_milestone_version,
    'task_progress', v_progress_result
  );
end;
$$;

revoke execute on function api.inventory_evolve_item(uuid, uuid[], text)
  from public, anon, authenticated;
revoke execute on function api.inventory_decompose_items(uuid, uuid[], text)
  from public, anon, authenticated;
revoke execute on function api.inventory_decompose_item(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function api.album_claim_milestone(uuid, uuid, text, integer)
  from public, anon, authenticated;

grant execute on function api.inventory_evolve_item(uuid, uuid[], text)
  to service_role;
grant execute on function api.inventory_decompose_items(uuid, uuid[], text)
  to service_role;
grant execute on function api.inventory_decompose_item(uuid, uuid, text)
  to service_role;
grant execute on function api.album_claim_milestone(uuid, uuid, text, integer)
  to service_role;

commit;
