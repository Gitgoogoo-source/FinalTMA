create or replace function operations.operation_has_durable_reference(p_operation_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    exists (select 1 from economy.ledger where operation_id = p_operation_id)
    or exists (select 1 from economy.entitlements where operation_id = p_operation_id)
    or exists (select 1 from expedition.expeditions where operation_id = p_operation_id)
    or exists (select 1 from wheel.results where operation_id = p_operation_id)
    or exists (select 1 from battle.rooms where create_operation_id = p_operation_id)
    or exists (select 1 from battle.participants where join_operation_id = p_operation_id)
    or exists (select 1 from battle.actions where operation_id = p_operation_id)
    or exists (select 1 from market.listings where operation_id = p_operation_id)
    or exists (select 1 from market.trades where operation_id = p_operation_id)
    or exists (select 1 from payments.orders where operation_id = p_operation_id)
    or exists (select 1 from vip.claims where operation_id = p_operation_id)
    or exists (select 1 from tasks.daily_progress where claim_operation_id = p_operation_id)
    or exists (select 1 from referral.relationships where reward_operation_id = p_operation_id)
    or exists (select 1 from referral.milestones where operation_id = p_operation_id)
    or exists (select 1 from album.nodes where first_operation_id = p_operation_id)
    or exists (select 1 from album.rewards where operation_id = p_operation_id)
    or exists (select 1 from onchain.mints where operation_id = p_operation_id)
$$;

create or replace function api.run_job(p_job_name text, p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_count integer := 0;
  v_added integer := 0;
  v_compacted integer := 0;
  v_deleted integer := 0;
  v_auth_deleted integer := 0;
  v_row record;
  v_details jsonb;
  v_battle_details jsonb;
  v_scan_from timestamptz;
  v_scan_to timestamptz := now();
  v_active_run operations.job_runs%rowtype;
begin
  if p_job_name not in ('reconcile-payments', 'reconcile-mints', 'cleanup-idempotency', 'monitor-invariants') then perform api.raise_business_error('JOB_NOT_FOUND', '后台任务不存在'); end if;
  select max(finished_at) into v_scan_from from operations.job_runs where job_name = p_job_name and status = 'succeeded';
  if not pg_try_advisory_xact_lock(hashtextextended('pokepets:job:' || p_job_name, 0)) then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (p_job_name, 'skipped', jsonb_build_object('reason', 'already_running'), v_scan_from, v_scan_to, now())
    returning id into v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'skipped', 'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  if p_job_name = 'reconcile-mints' then
    select * into v_active_run from operations.job_runs
    where job_name = p_job_name and status = 'running'
    order by started_at desc limit 1 for update;
    if v_active_run.id is not null and v_active_run.started_at > now() - interval '10 minutes' then
      insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
      values (p_job_name, 'skipped', jsonb_build_object('reason', 'active_lease', 'active_job_run_id', v_active_run.id), v_scan_from, v_scan_to, now())
      returning id into v_run;
      return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'skipped', 'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
    elsif v_active_run.id is not null then
      update operations.job_runs
      set status = 'failed', details = jsonb_build_object('error', 'lease_expired'), finished_at = now()
      where id = v_active_run.id;
    end if;
  end if;
  insert into operations.job_runs (job_name, status, scan_from, scan_to) values (p_job_name, 'running', v_scan_from, v_scan_to) returning id into v_run;
  begin
  if p_job_name = 'reconcile-payments' then
    for v_row in
      update payments.orders
      set status = case when status = 'pending' then 'expired' else 'failed' end,
          failed_at = case when status = 'processing' then now() else failed_at end,
          updated_at = now()
      where id in (
        select id from payments.orders
        where status in ('pending', 'processing') and expires_at <= now()
        order by expires_at limit greatest(1, least(p_limit, 500))
        for update skip locked
      )
      returning operation_id, id, status
    loop
      update operations.operations
      set status = 'failed', error_code = 'PAYMENT_EXPIRED',
          result = jsonb_build_object('payment_id', v_row.id, 'status', v_row.status),
          completed_at = now(), updated_at = now()
      where id = v_row.operation_id and status in ('pending', 'unknown');
      update operations.operations
      set result = (select payments.order_json(p) from payments.orders p where p.id = v_row.id), updated_at = now()
      where id = v_row.operation_id and status = 'succeeded';
      v_count := v_count + 1;
    end loop;
    for v_row in select id from payments.orders where status = 'paid' order by paid_at limit greatest(1, least(p_limit, 500)) for update skip locked loop
      perform payments.deliver(v_row.id);
      v_count := v_count + 1;
    end loop;
  elsif p_job_name = 'reconcile-mints' then
    for v_row in select id from onchain.mints where status = 'reserved' and permit_expires_at <= now() order by permit_expires_at limit greatest(1, least(p_limit, 500)) for update skip locked loop
      perform api.mint_complete(v_row.id, false);
      v_count := v_count + 1;
    end loop;
  elsif p_job_name = 'cleanup-idempotency' then
    with candidates as materialized (
      select o.id
      from operations.operations o
      where o.completed_at < now() - interval '30 days'
        and o.status in ('succeeded', 'failed')
        and o.payload_purged_at is null
        and not (o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null)
        and not exists (
          select 1 from payments.orders p
          where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid', 'payment_identity_conflict')
        )
        and not exists (
          select 1 from onchain.mints m
          where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown')
        )
      order by o.completed_at, o.id
      limit greatest(1, least(p_limit, 5000))
      for update of o skip locked
    ), purged_wheel_results as (
      delete from wheel.results result
      using candidates candidate
      where result.operation_id = candidate.id
      returning result.operation_id
    ), compacted as (
      update operations.operations operation
      set request = null,
          result = null,
          payload_purged_at = now(),
          updated_at = now()
      from candidates candidate
      where operation.id = candidate.id
      returning operation.id
    )
    select count(*)::integer into v_compacted from compacted;

    with candidates as materialized (
      select o.id
      from operations.operations o
      where o.status in ('succeeded', 'failed')
        and (
          (o.status = 'failed' and o.completed_at < now() - interval '7 days')
          or (o.status = 'succeeded' and o.completed_at < now() - interval '37 days')
        )
        and not (o.use_case = 'inventory.evolve' and o.result_acknowledged_at is null)
        and not operations.operation_has_durable_reference(o.id)
      order by o.completed_at, o.id
      limit greatest(1, least(p_limit, 5000))
      for update of o skip locked
    ), deleted as (
      delete from operations.operations operation
      using candidates candidate
      where operation.id = candidate.id
      returning operation.id
    )
    select count(*)::integer into v_deleted from deleted;

    delete from identity.auth_attempts where attempted_at < now() - interval '1 day';
    get diagnostics v_auth_deleted = row_count;
    v_battle_details := battle.cleanup_operational_data(greatest(1, least(p_limit, 5000)));
    v_details := jsonb_build_object(
      'payloads_compacted', v_compacted,
      'operations_deleted', v_deleted,
      'auth_attempts_deleted', v_auth_deleted,
      'battle', v_battle_details
    );
    v_count := v_compacted + v_deleted + v_auth_deleted
      + coalesce((v_battle_details->>'rate_limit_attempts_deleted')::integer, 0)
      + coalesce((v_battle_details->>'published_outbox_deleted')::integer, 0)
      + coalesce((v_battle_details->>'tick_runs_deleted')::integer, 0);
  else
    insert into operations.invariant_violations (code, subject, details)
    select 'BALANCE_LEDGER_MISMATCH', b.user_id::text || ':' || b.currency, jsonb_build_object('balance', b.available, 'ledger', coalesce(sum(l.amount), 0))
    from economy.balances b left join economy.ledger l on l.user_id = b.user_id and l.currency = b.currency
    group by b.user_id, b.currency, b.available having b.available <> coalesce(sum(l.amount), 0)
    on conflict do nothing;
    get diagnostics v_count = row_count;
    insert into operations.invariant_violations (code, subject, details)
    select 'DUPLICATE_PAYMENT_DELIVERY', l.reference, jsonb_build_object('ledger_entries', count(*))
    from economy.ledger l where l.reason = 'stars_topup' group by l.reference having count(*) > 1 on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'PAYMENT_IDENTITY_CONFLICT_DELIVERY', p.id::text, jsonb_build_object('kind', p.kind, 'status', p.status)
    from payments.orders p
    where p.payment_identity_conflict_at is not null
      and (
        p.delivered_at is not null
        or exists (
          select 1 from economy.ledger l
          where l.reason = 'stars_topup' and l.reference = p.id::text
        )
        or exists (
          select 1 from referral.relationships relationship
          where relationship.reward_operation_id = p.operation_id
        )
        or exists (
          select 1 from referral.milestones milestone
          where milestone.operation_id = p.operation_id
        )
      )
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'RESERVATION_OVERFLOW', h.user_id::text || ':' || h.template_id, jsonb_build_object('holding', h.quantity, 'reserved', sum(r.quantity))
    from inventory.holdings h join inventory.reservations r on r.user_id = h.user_id and r.template_id = h.template_id and r.status = 'active'
    group by h.user_id, h.template_id, h.quantity having sum(r.quantity) > h.quantity on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'ILLEGAL_RESERVATION', r.id::text, jsonb_build_object('kind', r.kind, 'reference_id', r.reference_id)
    from inventory.reservations r where r.status = 'active' and (
      (r.kind = 'listing' and not exists (select 1 from market.listings l where l.id = r.reference_id and l.status = 'active' and l.remaining > 0))
      or (r.kind = 'expedition' and not exists (select 1 from expedition.expeditions e where e.id = r.reference_id and e.status in ('running', 'claimable')))
      or (r.kind = 'mint' and not exists (select 1 from onchain.mints m where m.id = r.reference_id and m.status in ('reserved', 'submitted', 'unknown')))
    ) on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    select 'OPEN_OPERATION_WITHOUT_SUBJECT', o.id::text, jsonb_build_object('use_case', o.use_case, 'status', o.status)
    from operations.operations o where o.status in ('pending', 'unknown') and o.created_at < now() - interval '1 day'
      and not exists (select 1 from payments.orders p where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid', 'payment_identity_conflict'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    with authoritative as (
      select seller_id, template_id, sum(remaining)::bigint quantity
      from market.listings
      where status = 'active' and remaining > 0
      group by seller_id, template_id
    )
    select
      'MARKET_SELLER_SUPPLY_MISMATCH',
      coalesce(authoritative.seller_id, derived.seller_id)::text || ':' || coalesce(authoritative.template_id, derived.template_id),
      jsonb_build_object(
        'listing_quantity', coalesce(authoritative.quantity, 0),
        'summary_quantity', coalesce(derived.active_quantity, 0)
      )
    from authoritative
    full join market.seller_template_supply derived
      on derived.seller_id = authoritative.seller_id and derived.template_id = authoritative.template_id
    where coalesce(authoritative.quantity, 0) <> coalesce(derived.active_quantity, 0)
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    insert into operations.invariant_violations (code, subject, details)
    with eligible as (
      select supply.template_id, sum(supply.active_quantity)::bigint quantity
      from market.seller_template_supply supply
      join identity.users users on users.id = supply.seller_id and users.status = 'normal'
      group by supply.template_id
    )
    select
      'MARKET_TEMPLATE_SUPPLY_MISMATCH',
      coalesce(eligible.template_id, derived.template_id),
      jsonb_build_object(
        'eligible_seller_quantity', coalesce(eligible.quantity, 0),
        'summary_quantity', coalesce(derived.eligible_quantity, 0)
      )
    from eligible
    full join market.template_supply derived on derived.template_id = eligible.template_id
    where coalesce(eligible.quantity, 0) <> coalesce(derived.eligible_quantity, 0)
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
    v_added := battle.monitor_tick_health(v_scan_from, v_scan_to);
    v_count := v_count + v_added;
    v_added := battle.monitor_invariants();
    v_count := v_count + v_added;
  end if;
  if p_job_name = 'reconcile-mints' then
    update operations.job_runs set processed_count = v_count, details = jsonb_build_object('phase', 'chain_reconciliation') where id = v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'running', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  update operations.job_runs
  set status = 'succeeded', processed_count = v_count,
      details = coalesce(v_details, '{}'::jsonb), finished_at = now()
  where id = v_run;
  return jsonb_build_object(
    'job_run_id', v_run, 'job_name', p_job_name, 'status', 'succeeded',
    'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to
  ) || case
    when v_details is null then '{}'::jsonb
    else jsonb_build_object('maintenance', v_details)
  end;
exception when others then
  update operations.job_runs set status = 'failed', details = jsonb_build_object('error', sqlerrm), finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'failed', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to, 'error', sqlerrm);
  end;
end;
$$;

create or replace function api.finish_job(
  p_job_run_id uuid,
  p_processed_count integer,
  p_details jsonb,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run operations.job_runs%rowtype;
begin
  select * into v_run from operations.job_runs where id = p_job_run_id for update;
  if v_run.id is null or v_run.status <> 'running' then
    perform api.raise_business_error('JOB_NOT_FOUND', '后台任务运行不存在或已经结束');
  end if;
  update operations.job_runs
  set status = case when p_error is null then 'succeeded' else 'failed' end,
      processed_count = greatest(0, p_processed_count),
      details = coalesce(p_details, '{}'::jsonb) || case when p_error is null then '{}'::jsonb else jsonb_build_object('error', p_error) end,
      finished_at = now()
  where id = p_job_run_id
  returning * into v_run;
  return jsonb_build_object(
    'job_run_id', v_run.id,
    'job_name', v_run.job_name,
    'status', v_run.status,
    'processed_count', v_run.processed_count,
    'scan_from', v_run.scan_from,
    'scan_to', v_run.scan_to
  );
end;
$$;

create or replace function api.catalog_asset_cleanup_claim(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run uuid;
  v_mutation catalog.asset_mutation_runs%rowtype;
  v_scan_from timestamptz;
  v_scan_to timestamptz := now();
  v_active_run operations.job_runs%rowtype;
  v_objects jsonb;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'catalog cleanup limit must be between 1 and 500';
  end if;
  v_mutation := catalog.acquire_asset_mutation('cleanup', null, null);
  if v_mutation.id is null then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (
      'cleanup-catalog-assets', 'skipped',
      jsonb_build_object('reason', 'asset_mutation_busy'),
      null, v_scan_to, now()
    ) returning id into v_run;
    return jsonb_build_object(
      'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'skipped',
      'processed_count', 0, 'scan_from', null, 'scan_to', v_scan_to, 'objects', '[]'::jsonb
    );
  end if;
  select max(finished_at) into v_scan_from
  from operations.job_runs
  where job_name = 'cleanup-catalog-assets' and status = 'succeeded';
  select * into v_active_run
  from operations.job_runs
  where job_name = 'cleanup-catalog-assets' and status = 'running'
  order by started_at desc
  limit 1
  for update;
  if v_active_run.id is not null and v_active_run.started_at > now() - interval '15 minutes' then
    insert into operations.job_runs (job_name, status, details, scan_from, scan_to, finished_at)
    values (
      'cleanup-catalog-assets', 'skipped',
      jsonb_build_object('reason', 'active_lease', 'active_job_run_id', v_active_run.id),
      v_scan_from, v_scan_to, now()
    ) returning id into v_run;
    update catalog.asset_mutation_runs
    set status = 'aborted', finished_at = now(),
        details = jsonb_build_object('reason', 'active_cleanup_job', 'active_job_run_id', v_active_run.id)
    where id = v_mutation.id;
    return jsonb_build_object(
      'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'skipped',
      'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to, 'objects', '[]'::jsonb
    );
  elsif v_active_run.id is not null then
    update catalog.asset_objects
    set status = 'delete_failed', cleanup_claim_id = null, cleanup_claimed_at = null,
        last_error = 'cleanup lease expired'
    where cleanup_claim_id = v_active_run.id and status = 'deleting';
    update operations.job_runs
    set status = 'failed', details = jsonb_build_object('error', 'lease_expired'), finished_at = now()
    where id = v_active_run.id;
  end if;

  insert into operations.job_runs (job_name, status, details, scan_from, scan_to)
  values (
    'cleanup-catalog-assets', 'running',
    jsonb_build_object('mutation_run_id', v_mutation.id, 'mutation_fence', v_mutation.fence),
    v_scan_from, v_scan_to
  )
  returning id into v_run;

  with candidates as materialized (
    select object.id
    from catalog.asset_objects object
    where object.object_class = 'runtime'
      and object.status in ('active', 'delete_failed')
      and exists (
        select 1
        from catalog.asset_release_templates item
        where item.thumbnail_object_id = object.id or item.detail_object_id = object.id
      )
      and not exists (
        select 1
        from catalog.asset_release_templates item
        join catalog.asset_releases release on release.id = item.release_id
        where (item.thumbnail_object_id = object.id or item.detail_object_id = object.id)
          and (
            release.status <> 'retired'
            or release.delete_after is null
            or release.delete_after > now()
            or release.rollback_locked_until > now()
          )
      )
    order by object.created_at, object.id
    limit p_limit
    for update of object skip locked
  ), claimed as (
    update catalog.asset_objects object
    set status = 'deleting', cleanup_claim_id = v_run, cleanup_claimed_at = now(), last_error = null
    from candidates candidate
    where object.id = candidate.id
    returning object.object_key, object.sha256, object.byte_size
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('key', object_key, 'sha256', sha256, 'bytes', byte_size) order by object_key),
    '[]'::jsonb
  ) into v_objects
  from claimed;

  return jsonb_build_object(
    'job_run_id', v_run, 'job_name', 'cleanup-catalog-assets', 'status', 'running',
    'processed_count', 0, 'scan_from', v_scan_from, 'scan_to', v_scan_to,
    'mutation_run_id', v_mutation.id, 'mutation_fence', v_mutation.fence,
    'objects', v_objects
  );
end
$$;

create or replace function api.catalog_asset_cleanup_finish(
  p_job_run_id uuid,
  p_mutation_run_id uuid,
  p_mutation_fence bigint,
  p_deleted_keys jsonb,
  p_failed jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run operations.job_runs%rowtype;
  v_claimed integer;
  v_deleted integer;
  v_failed integer;
  v_mutation catalog.asset_mutation_runs%rowtype;
begin
  select * into v_run
  from operations.job_runs
  where id = p_job_run_id
  for update;
  if v_run.id is null or v_run.job_name <> 'cleanup-catalog-assets' or v_run.status <> 'running' then
    perform api.raise_business_error('JOB_NOT_FOUND', '后台任务运行不存在或已经结束');
  end if;
  v_mutation := catalog.require_asset_mutation(
    p_mutation_run_id, p_mutation_fence, 'cleanup', null, null
  );
  if v_run.details->>'mutation_run_id' is distinct from p_mutation_run_id::text
    or (v_run.details->>'mutation_fence')::bigint is distinct from p_mutation_fence
  then
    raise exception using errcode = '55000', message = 'catalog cleanup mutation lease does not match its job';
  end if;
  if jsonb_typeof(p_deleted_keys) <> 'array' or jsonb_typeof(p_failed) <> 'object' then
    raise exception using errcode = '22023', message = 'catalog cleanup result shape is invalid';
  end if;
  select count(*) into v_claimed
  from catalog.asset_objects
  where cleanup_claim_id = p_job_run_id and status = 'deleting';
  select count(distinct value) into v_deleted from jsonb_array_elements_text(p_deleted_keys);
  select count(*) into v_failed from jsonb_object_keys(p_failed);
  if v_deleted + v_failed <> v_claimed
    or exists (
      select 1
      from catalog.asset_objects object
      where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting'
        and not (p_deleted_keys ? object.object_key)
        and not (p_failed ? object.object_key)
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_deleted_keys) as deleted(key)
      where not exists (
        select 1 from catalog.asset_objects object
        where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting' and object.object_key = deleted.key
      )
    )
    or exists (
      select 1 from jsonb_object_keys(p_failed) as failed(key)
      where not exists (
        select 1 from catalog.asset_objects object
        where object.cleanup_claim_id = p_job_run_id and object.status = 'deleting' and object.object_key = failed.key
      )
    )
  then
    raise exception using errcode = '22023', message = 'catalog cleanup result does not match its claim';
  end if;

  update catalog.asset_objects object
  set status = 'deleted', cleanup_claim_id = null, cleanup_claimed_at = null,
      last_error = null, deleted_at = now()
  where object.cleanup_claim_id = p_job_run_id
    and object.status = 'deleting'
    and p_deleted_keys ? object.object_key;

  update catalog.asset_objects object
  set status = 'delete_failed', cleanup_claim_id = null, cleanup_claimed_at = null,
      last_error = left(p_failed->>object.object_key, 500), deleted_at = null
  where object.cleanup_claim_id = p_job_run_id
    and object.status = 'deleting'
    and p_failed ? object.object_key;

  update operations.job_runs
  set status = case when v_failed = 0 then 'succeeded' else 'failed' end,
      processed_count = v_deleted,
      details = jsonb_build_object('attempted', v_claimed, 'deleted', v_deleted, 'failed', v_failed),
      finished_at = now()
  where id = p_job_run_id
  returning * into v_run;

  update catalog.asset_mutation_runs
  set status = 'committed', finished_at = now(),
      details = jsonb_build_object(
        'job_run_id', p_job_run_id,
        'attempted', v_claimed,
        'deleted', v_deleted,
        'failed', v_failed
      )
  where id = v_mutation.id;

  return jsonb_build_object(
    'job_run_id', v_run.id, 'job_name', v_run.job_name, 'status', v_run.status,
    'processed_count', v_run.processed_count, 'scan_from', v_run.scan_from, 'scan_to', v_run.scan_to
  );
end
$$;
