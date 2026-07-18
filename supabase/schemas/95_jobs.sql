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
begin
  if p_job_name not in ('reconcile-payments', 'reconcile-mints', 'cleanup-idempotency', 'monitor-invariants') then perform api.raise_business_error('JOB_NOT_FOUND', '后台任务不存在'); end if;
  insert into operations.job_runs (job_name, status) values (p_job_name, 'running') returning id into v_run;
  if p_job_name = 'reconcile-payments' then
    with expired as (
      update payments.orders set status = 'expired', updated_at = now()
      where id in (select id from payments.orders where status = 'pending' and expires_at <= now() order by expires_at limit greatest(1, least(p_limit, 500)) for update skip locked)
      returning operation_id, id
    )
    update operations.operations o set status = 'failed', error_code = 'PAYMENT_EXPIRED', result = jsonb_build_object('payment_id', expired.id, 'status', 'expired'), completed_at = now(), updated_at = now()
    from expired where o.id = expired.operation_id;
    get diagnostics v_count = row_count;
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
        and not exists (select 1 from payments.orders p where p.operation_id = operations.operations.id and p.status in ('pending', 'paid'))
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
      and not exists (select 1 from payments.orders p where p.operation_id = o.id and p.status in ('pending', 'paid'))
      and not exists (select 1 from onchain.mints m where m.operation_id = o.id and m.status in ('reserved', 'submitted', 'unknown'))
    on conflict do nothing;
    get diagnostics v_added = row_count; v_count := v_count + v_added;
  end if;
  update operations.job_runs set status = 'succeeded', processed_count = v_count, finished_at = now() where id = v_run;
  return jsonb_build_object('job_run_id', v_run, 'job_name', p_job_name, 'processed_count', v_count);
exception when others then
  if v_run is not null then update operations.job_runs set status = 'failed', details = jsonb_build_object('error', sqlerrm), finished_at = now() where id = v_run; end if;
  raise;
end;
$$;
