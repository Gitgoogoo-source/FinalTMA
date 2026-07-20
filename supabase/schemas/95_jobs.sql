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
  v_row record;
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
    delete from operations.operations where id in (
      select id from operations.operations where created_at < now() - interval '30 days' and status in ('succeeded', 'failed')
        and not exists (select 1 from payments.orders p where p.operation_id = operations.operations.id and p.status in ('pending', 'processing', 'paid'))
        and not exists (select 1 from onchain.mints m where m.operation_id = operations.operations.id and m.status in ('reserved', 'submitted', 'unknown'))
      order by created_at limit greatest(1, least(p_limit, 500))
    );
    get diagnostics v_count = row_count;
    delete from identity.auth_attempts where attempted_at < now() - interval '1 day';
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
      and not exists (select 1 from payments.orders p where p.operation_id = o.id and p.status in ('pending', 'processing', 'paid'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
  end if;
  if p_job_name = 'reconcile-mints' then
    update operations.job_runs set processed_count = v_count, details = jsonb_build_object('phase', 'chain_reconciliation') where id = v_run;
    return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'running', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
  end if;
  update operations.job_runs set status = 'succeeded', processed_count = v_count, finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'status', 'succeeded', 'processed_count', v_count, 'scan_from', v_scan_from, 'scan_to', v_scan_to);
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
