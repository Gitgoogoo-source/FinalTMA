-- Phase 6 step 2.8 independent monitoring alert scan tests.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

select ok(
  to_regprocedure('api.monitoring_scan_alerts(text,jsonb,timestamp with time zone)') is not null,
  'api.monitoring_scan_alerts RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.monitoring_scan_alerts(text,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'public',
    'api.monitoring_scan_alerts(text,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.monitoring_scan_alerts(text,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.monitoring_scan_alerts(text,jsonb,timestamp with time zone)'::regprocedure,
    'EXECUTE'
  ),
  'monitoring alert scan RPC is service_role-only'
);

update ops.system_settings
set value = api._monitoring_normalize_thresholds(
      '{
        "paymentFailureRate":{"warning":0.1,"critical":0.2},
        "paidNotFulfilledMinutes":{"critical":1},
        "webhookStuckMinutes":{"warning":1,"critical":2},
        "mintStuckMinutes":{"warning":30,"critical":60},
        "ledgerMismatchCount":{"critical":0},
        "negativeInventoryCount":{"critical":0},
        "kcoinNetIssuance":{"warningAmount":1,"windowHours":24}
      }'::jsonb
    ),
    updated_at = '2026-06-01T05:39:00+00:00'::timestamptz
where key = 'monitoring.thresholds';

insert into core.users (
  id,
  telegram_user_id,
  username,
  status,
  created_at,
  updated_at
)
values (
  'aaaaaaaa-2801-4000-8000-000000000001'::uuid,
  628010001,
  'phase6_alert_scan_user',
  'active',
  '2026-06-01T04:00:00+00:00'::timestamptz,
  '2026-06-01T04:00:00+00:00'::timestamptz
)
on conflict (id) do update
set telegram_user_id = excluded.telegram_user_id,
    username = excluded.username,
    status = excluded.status,
    updated_at = excluded.updated_at;

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at,
  created_at,
  updated_at
)
values
  (
    'bbbbbbbb-2801-4000-8000-000000000001'::uuid,
    'aaaaaaaa-2801-4000-8000-000000000001'::uuid,
    'admin_test',
    'paid',
    10,
    'phase6-alert-scan-paid',
    'phase6 alert scan paid',
    'phase6-alert-scan-paid-key',
    '2026-06-01T05:20:00+00:00'::timestamptz,
    '2026-06-01T05:19:00+00:00'::timestamptz,
    '2026-06-01T05:20:00+00:00'::timestamptz
  ),
  (
    'bbbbbbbb-2801-4000-8000-000000000002'::uuid,
    'aaaaaaaa-2801-4000-8000-000000000001'::uuid,
    'admin_test',
    'failed',
    10,
    'phase6-alert-scan-failed',
    'phase6 alert scan failed',
    'phase6-alert-scan-failed-key',
    null,
    '2026-06-01T05:21:00+00:00'::timestamptz,
    '2026-06-01T05:21:00+00:00'::timestamptz
  )
on conflict (id) do nothing;

insert into payments.telegram_webhook_events (
  id,
  update_id,
  event_type,
  user_id,
  payload,
  process_status,
  created_at
)
values (
  'cccccccc-2801-4000-8000-000000000001'::uuid,
  628010001,
  'successful_payment',
  'aaaaaaaa-2801-4000-8000-000000000001'::uuid,
  '{}'::jsonb,
  'received',
  '2026-06-01T05:30:00+00:00'::timestamptz
)
on conflict (id) do nothing;

insert into economy.reconciliation_runs (
  id,
  run_type,
  status,
  started_at,
  finished_at,
  result,
  created_by
)
values (
  'dddddddd-2801-4000-8000-000000000001'::uuid,
  'ledger_balance',
  'success',
  '2026-06-01T05:00:00+00:00'::timestamptz,
  '2026-06-01T05:01:00+00:00'::timestamptz,
  '{"finding_count":1}'::jsonb,
  'phase6_alert_scan_test'
)
on conflict (id) do nothing;

insert into economy.currency_ledger (
  id,
  user_id,
  currency_code,
  entry_type,
  amount,
  source_type,
  source_ref,
  idempotency_key,
  created_at
)
values (
  'eeeeeeee-2801-4000-8000-000000000001'::uuid,
  'aaaaaaaa-2801-4000-8000-000000000001'::uuid,
  'KCOIN',
  'credit',
  100,
  'phase6_alert_scan_test',
  'kcoin-high',
  'phase6-alert-scan-kcoin-high',
  '2026-06-01T05:10:00+00:00'::timestamptz
)
on conflict (id) do nothing;

create temp table _scan_result (payload jsonb) on commit drop;

insert into _scan_result (payload)
select api.monitoring_scan_alerts(
  'phase6-alert-scan-run-001',
  '{"request_id":"phase6-alert-scan-run-001","authorization":"must-redact"}'::jsonb,
  '2026-06-01T05:40:00+00:00'::timestamptz
);

select cmp_ok(
  ((select payload from _scan_result) ->> 'recorded_count')::integer,
  '>=',
  5,
  'monitoring scan records threshold alerts'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where alert_type = 'payment_failure_rate_high'
      and source_type = 'monitoring_metric'
      and severity = 'critical'
  ),
  'monitoring scan creates payment failure rate alert'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where alert_type = 'payment_paid_not_fulfilled'
      and source_type = 'star_order'
      and source_id = 'bbbbbbbb-2801-4000-8000-000000000001'::uuid
      and severity = 'critical'
  ),
  'monitoring scan creates paid-not-fulfilled alert'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where alert_type = 'telegram_webhook_stuck'
      and source_type = 'telegram_webhook_event'
      and source_id = 'cccccccc-2801-4000-8000-000000000001'::uuid
      and severity = 'critical'
  ),
  'monitoring scan creates stuck webhook alert'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where alert_type = 'ledger_mismatch_count_high'
      and source_type = 'reconciliation_run'
      and source_id = 'dddddddd-2801-4000-8000-000000000001'::uuid
  ),
  'monitoring scan creates ledger mismatch alert'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where alert_type = 'kcoin_net_issuance_high'
      and source_type = 'monitoring_metric'
  ),
  'monitoring scan creates KCOIN net issuance alert'
);

select ok(
  exists (
    select 1
    from ops.app_events
    where event_name = 'monitoring.alert_scan.completed'
      and event_source = 'api.cron.monitoring_alert_scan'
      and payload -> 'request_context' ->> 'authorization' = '[REDACTED]'
  ),
  'monitoring scan writes sanitized ops.app_events summary'
);

select ok(
  (
    api.monitoring_scan_alerts(
      'phase6-alert-scan-run-001',
      '{"request_id":"phase6-alert-scan-run-001","authorization":"must-redact"}'::jsonb,
      '2026-06-01T05:40:00+00:00'::timestamptz
    ) ->> 'idempotent'
  )::boolean,
  'monitoring scan is idempotent for repeated request key'
);

select * from finish();

rollback;
