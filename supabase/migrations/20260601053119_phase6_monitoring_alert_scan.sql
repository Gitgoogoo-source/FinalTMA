-- Phase 6 step 2.8 independent monitoring alert scan.
--
-- This is the方案 B cron target: it scans monitored thresholds independently
-- from the admin dashboard and records active ops.alerts through the existing
-- alert lifecycle RPC. It does not mutate currency_ledger history.

begin;

create or replace function api._monitoring_metric_source_uuid(p_source text)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    substr(md5(coalesce(p_source, 'monitoring_metric')), 1, 8) || '-' ||
    substr(md5(coalesce(p_source, 'monitoring_metric')), 9, 4) || '-' ||
    substr(md5(coalesce(p_source, 'monitoring_metric')), 13, 4) || '-' ||
    substr(md5(coalesce(p_source, 'monitoring_metric')), 17, 4) || '-' ||
    substr(md5(coalesce(p_source, 'monitoring_metric')), 21, 12)
  )::uuid;
$$;

create or replace function api.monitoring_scan_alerts(
  p_idempotency_key text,
  p_request_context jsonb default '{}'::jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_scope text := 'monitoring.alert_scan';
  v_now timestamptz := coalesce(p_now, now());
  v_request_hash text;
  v_idempotent jsonb;
  v_thresholds jsonb;
  v_window_started_at timestamptz;
  v_kcoin_started_at timestamptz;
  v_payment_total integer := 0;
  v_payment_failed integer := 0;
  v_payment_failure_rate numeric := 0;
  v_payment_failure_severity text;
  v_fulfillment_count integer := 0;
  v_webhook_count integer := 0;
  v_mint_count integer := 0;
  v_ledger_run economy.reconciliation_runs%rowtype;
  v_ledger_finding_count integer;
  v_negative_inventory_count integer := 0;
  v_kcoin_issued numeric := 0;
  v_kcoin_recovered numeric := 0;
  v_kcoin_net numeric := 0;
  v_recorded_count integer := 0;
  v_app_event_id uuid;
  v_response jsonb;
  v_alert jsonb;
  v_row record;
begin
  v_request_hash := jsonb_build_object(
    'action', v_scope
  )::text;

  v_idempotent := api._admin_start_idempotency(v_key, v_scope, v_request_hash, v_now);
  if v_idempotent is not null then
    return v_idempotent;
  end if;

  select api._monitoring_normalize_thresholds(value)
  into v_thresholds
  from ops.system_settings
  where key = 'monitoring.thresholds';

  if v_thresholds is null then
    v_thresholds := api._monitoring_default_thresholds();
  end if;

  v_window_started_at := v_now - interval '24 hours';
  v_kcoin_started_at :=
    v_now - make_interval(
      hours => greatest(
        1,
        least(168, (v_thresholds #>> '{kcoinNetIssuance,windowHours}')::integer)
      )
    );

  select count(*)::integer,
         count(*) filter (
           where status in ('failed', 'expired', 'refunded', 'disputed')
         )::integer
  into v_payment_total, v_payment_failed
  from payments.star_orders
  where created_at >= v_window_started_at
    and created_at <= v_now;

  if v_payment_total > 0 then
    v_payment_failure_rate := v_payment_failed::numeric / v_payment_total::numeric;
  end if;

  if v_payment_total > 0
     and v_payment_failure_rate >= (v_thresholds #>> '{paymentFailureRate,warning}')::numeric then
    v_payment_failure_severity := case
      when v_payment_failure_rate >= (v_thresholds #>> '{paymentFailureRate,critical}')::numeric
        then 'critical'
      else 'warning'
    end;

    v_alert := api.alert_record_event(
      p_alert_type => 'payment_failure_rate_high',
      p_severity => v_payment_failure_severity,
      p_title => 'Payment failure rate exceeded threshold',
      p_message => 'Window payment failure rate crossed monitoring threshold.',
      p_source_type => 'monitoring_metric',
      p_source_id => api._monitoring_metric_source_uuid('payment_failure_rate_high'),
      p_detail => jsonb_build_object(
        'payment_total', v_payment_total,
        'payment_failed', v_payment_failed,
        'failure_rate', v_payment_failure_rate,
        'window_started_at', v_window_started_at,
        'warning_threshold', v_thresholds #>> '{paymentFailureRate,warning}',
        'critical_threshold', v_thresholds #>> '{paymentFailureRate,critical}'
      ),
      p_idempotency_key => v_key || ':payment_failure_rate_high'
    );
    v_recorded_count := v_recorded_count + 1;
  end if;

  for v_row in
    select id, user_id, status, paid_at, fulfilled_at, error_message, created_at, updated_at
    from payments.star_orders
    where status in ('paid', 'fulfilling')
      and paid_at is not null
      and paid_at <= v_now - make_interval(
        mins => (v_thresholds #>> '{paidNotFulfilledMinutes,critical}')::integer
      )
    order by paid_at asc, id asc
    limit 100
  loop
    v_alert := api.alert_record_event(
      p_alert_type => 'payment_paid_not_fulfilled',
      p_severity => 'critical',
      p_title => 'Paid order not fulfilled',
      p_message => 'A paid Telegram Stars order exceeded the fulfillment threshold.',
      p_source_type => 'star_order',
      p_source_id => v_row.id,
      p_detail => jsonb_build_object(
        'user_id', v_row.user_id,
        'order_status', v_row.status,
        'paid_at', v_row.paid_at,
        'fulfilled_at', v_row.fulfilled_at,
        'error_message', v_row.error_message,
        'threshold_minutes', v_thresholds #>> '{paidNotFulfilledMinutes,critical}',
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
      ),
      p_idempotency_key => v_key || ':payment_paid_not_fulfilled:' || v_row.id
    );
    v_fulfillment_count := v_fulfillment_count + 1;
    v_recorded_count := v_recorded_count + 1;
  end loop;

  for v_row in
    select id, update_id, event_type, process_status, retry_count, next_retry_at, error_message, created_at
    from payments.telegram_webhook_events
    where process_status in ('received', 'processing')
      and created_at <= v_now - make_interval(
        mins => (v_thresholds #>> '{webhookStuckMinutes,warning}')::integer
      )
    order by created_at asc, id asc
    limit 100
  loop
    v_alert := api.alert_record_event(
      p_alert_type => 'telegram_webhook_stuck',
      p_severity => case
        when v_row.created_at <= v_now - make_interval(
          mins => (v_thresholds #>> '{webhookStuckMinutes,critical}')::integer
        ) then 'critical'
        else 'warning'
      end,
      p_title => 'Telegram webhook event stuck',
      p_message => 'A Telegram webhook event stayed received/processing beyond threshold.',
      p_source_type => 'telegram_webhook_event',
      p_source_id => v_row.id,
      p_detail => jsonb_build_object(
        'update_id', v_row.update_id,
        'event_type', v_row.event_type,
        'process_status', v_row.process_status,
        'retry_count', v_row.retry_count,
        'next_retry_at', v_row.next_retry_at,
        'error_message', v_row.error_message,
        'warning_threshold_minutes', v_thresholds #>> '{webhookStuckMinutes,warning}',
        'critical_threshold_minutes', v_thresholds #>> '{webhookStuckMinutes,critical}',
        'created_at', v_row.created_at
      ),
      p_idempotency_key => v_key || ':telegram_webhook_stuck:' || v_row.id
    );
    v_webhook_count := v_webhook_count + 1;
    v_recorded_count := v_recorded_count + 1;
  end loop;

  for v_row in
    select id, user_id, status, attempt_count, max_attempts, next_attempt_at, error_message, created_at, updated_at
    from onchain.mint_queue
    where status in ('queued', 'processing', 'submitted', 'confirming', 'retrying')
      and updated_at <= v_now - make_interval(
        mins => (v_thresholds #>> '{mintStuckMinutes,warning}')::integer
      )
    order by updated_at asc, id asc
    limit 100
  loop
    v_alert := api.alert_record_event(
      p_alert_type => 'mint_queue_stuck',
      p_severity => case
        when v_row.updated_at <= v_now - make_interval(
          mins => (v_thresholds #>> '{mintStuckMinutes,critical}')::integer
        ) then 'critical'
        else 'warning'
      end,
      p_title => 'Mint queue item stuck',
      p_message => 'A Mint queue item stayed active beyond threshold.',
      p_source_type => 'mint_queue',
      p_source_id => v_row.id,
      p_detail => jsonb_build_object(
        'user_id', v_row.user_id,
        'mint_status', v_row.status,
        'attempt_count', v_row.attempt_count,
        'max_attempts', v_row.max_attempts,
        'next_attempt_at', v_row.next_attempt_at,
        'error_message', v_row.error_message,
        'warning_threshold_minutes', v_thresholds #>> '{mintStuckMinutes,warning}',
        'critical_threshold_minutes', v_thresholds #>> '{mintStuckMinutes,critical}',
        'created_at', v_row.created_at,
        'updated_at', v_row.updated_at
      ),
      p_idempotency_key => v_key || ':mint_queue_stuck:' || v_row.id
    );
    v_mint_count := v_mint_count + 1;
    v_recorded_count := v_recorded_count + 1;
  end loop;

  select *
  into v_ledger_run
  from economy.reconciliation_runs
  where run_type = 'ledger_balance'
  order by started_at desc, id desc
  limit 1;

  if found then
    v_ledger_finding_count := coalesce(nullif(v_ledger_run.result ->> 'finding_count', '')::integer, 0);

    if v_ledger_finding_count > ((v_thresholds #>> '{ledgerMismatchCount,critical}')::integer) then
      v_alert := api.alert_record_event(
        p_alert_type => 'ledger_mismatch_count_high',
        p_severity => 'critical',
        p_title => 'Ledger reconciliation mismatch count exceeded threshold',
        p_message => 'Latest ledger_balance reconciliation found mismatches.',
        p_source_type => 'reconciliation_run',
        p_source_id => v_ledger_run.id,
        p_detail => jsonb_build_object(
          'run_type', v_ledger_run.run_type,
          'run_status', v_ledger_run.status,
          'finding_count', v_ledger_finding_count,
          'threshold', v_thresholds #>> '{ledgerMismatchCount,critical}',
          'started_at', v_ledger_run.started_at,
          'finished_at', v_ledger_run.finished_at
        ),
        p_idempotency_key => v_key || ':ledger_mismatch_count_high:' || v_ledger_run.id
      );
      v_recorded_count := v_recorded_count + 1;
    end if;
  end if;

  select count(*)::integer
  into v_negative_inventory_count
  from gacha.blind_boxes
  where (remaining_stock is not null and remaining_stock < 0)
     or (total_stock is not null and total_stock < 0);

  if v_negative_inventory_count > ((v_thresholds #>> '{negativeInventoryCount,critical}')::integer) then
    v_alert := api.alert_record_event(
      p_alert_type => 'negative_inventory_count_high',
      p_severity => 'critical',
      p_title => 'Negative inventory count exceeded threshold',
      p_message => 'Blind box stock contains negative values.',
      p_source_type => 'monitoring_metric',
      p_source_id => api._monitoring_metric_source_uuid('negative_inventory_count_high'),
      p_detail => jsonb_build_object(
        'negative_inventory_count', v_negative_inventory_count,
        'threshold', v_thresholds #>> '{negativeInventoryCount,critical}'
      ),
      p_idempotency_key => v_key || ':negative_inventory_count_high'
    );
    v_recorded_count := v_recorded_count + 1;
  end if;

  select
    coalesce(sum(amount) filter (where entry_type in ('credit', 'refund', 'adjustment')), 0),
    coalesce(sum(amount) filter (where entry_type in ('debit', 'fee', 'reversal')), 0)
  into v_kcoin_issued, v_kcoin_recovered
  from economy.currency_ledger
  where currency_code = 'KCOIN'
    and created_at >= v_kcoin_started_at
    and created_at <= v_now;

  v_kcoin_net := coalesce(v_kcoin_issued, 0) - coalesce(v_kcoin_recovered, 0);

  if v_kcoin_net > ((v_thresholds #>> '{kcoinNetIssuance,warningAmount}')::numeric) then
    v_alert := api.alert_record_event(
      p_alert_type => 'kcoin_net_issuance_high',
      p_severity => 'warning',
      p_title => 'KCOIN net issuance exceeded threshold',
      p_message => 'KCOIN issued minus recovered exceeded monitoring threshold.',
      p_source_type => 'monitoring_metric',
      p_source_id => api._monitoring_metric_source_uuid('kcoin_net_issuance_high'),
      p_detail => jsonb_build_object(
        'currency_code', 'KCOIN',
        'issued_amount', v_kcoin_issued::text,
        'recovered_amount', v_kcoin_recovered::text,
        'net_issued_amount', v_kcoin_net::text,
        'threshold', v_thresholds #>> '{kcoinNetIssuance,warningAmount}',
        'window_started_at', v_kcoin_started_at,
        'window_hours', v_thresholds #>> '{kcoinNetIssuance,windowHours}'
      ),
      p_idempotency_key => v_key || ':kcoin_net_issuance_high'
    );
    v_recorded_count := v_recorded_count + 1;
  end if;

  insert into ops.app_events (user_id, event_name, event_source, payload, created_at)
  values (
    null,
    'monitoring.alert_scan.completed',
    'api.cron.monitoring_alert_scan',
    jsonb_build_object(
      'request_context', api._alert_sanitize_detail(coalesce(p_request_context, '{}'::jsonb)),
      'recorded_count', v_recorded_count,
      'payment_failure_rate', v_payment_failure_rate,
      'payment_failed', v_payment_failed,
      'payment_total', v_payment_total,
      'fulfillment_alert_count', v_fulfillment_count,
      'webhook_alert_count', v_webhook_count,
      'mint_alert_count', v_mint_count,
      'negative_inventory_count', v_negative_inventory_count,
      'kcoin_net_issued_amount', v_kcoin_net::text
    ),
    v_now
  )
  returning id into v_app_event_id;

  v_response := jsonb_build_object(
    'server_time', v_now,
    'idempotent', false,
    'recorded_count', v_recorded_count,
    'app_event_id', v_app_event_id,
    'checks', jsonb_build_object(
      'payment_failure_rate', v_payment_failure_rate,
      'payment_failed', v_payment_failed,
      'payment_total', v_payment_total,
      'fulfillment_alert_count', v_fulfillment_count,
      'webhook_alert_count', v_webhook_count,
      'mint_alert_count', v_mint_count,
      'negative_inventory_count', v_negative_inventory_count,
      'kcoin_net_issued_amount', v_kcoin_net::text
    )
  );

  perform api._admin_complete_idempotency(v_key, v_response, v_now);

  return v_response;
end;
$$;

revoke all on function api._monitoring_metric_source_uuid(text) from public, anon, authenticated;
revoke all on function api.monitoring_scan_alerts(text, jsonb, timestamptz) from public, anon, authenticated;

grant execute on function api.monitoring_scan_alerts(text, jsonb, timestamptz) to service_role;

comment on function api.monitoring_scan_alerts(text, jsonb, timestamptz) is
  'Cron-only independent monitoring scanner for Phase 6 business alerts. Service-role only; creates ops.alerts via api.alert_record_event.';

commit;
