-- Phase 6 step 2.8 economy monitoring and threshold RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception
  when others then
    return lower(sqlerrm) like lower(p_pattern);
end;
$$;

select no_plan();

select ok(
  exists (
    select 1
    from ops.system_settings
    where key = 'monitoring.thresholds'
      and value ? 'paymentFailureRate'
      and value ? 'kcoinNetIssuance'
  ),
  'ops.system_settings contains monitoring.thresholds defaults'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'economy'
      and tablename = 'currency_ledger'
      and indexname = 'currency_ledger_currency_created_entry_idx'
  ),
  'economy.currency_ledger has a currency/window aggregation index'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'admin_get_economy_monitoring'
      and pg_get_function_arguments(p.oid) like '%p_admin_user_id uuid%'
      and pg_get_function_arguments(p.oid) like '%p_window_hours integer%'
  ),
  'api.admin_get_economy_monitoring RPC exists with expected arguments'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'admin_update_monitoring_thresholds'
      and pg_get_function_arguments(p.oid) like '%p_thresholds jsonb%'
      and pg_get_function_arguments(p.oid) like '%p_idempotency_key text%'
  ),
  'api.admin_update_monitoring_thresholds RPC exists with expected arguments'
);

select ok(
  testutil.raises_like(
    $$
      select api._monitoring_normalize_thresholds(
        '{"paymentFailureRate":{"warning":0.2,"critical":0.1}}'::jsonb
      )
    $$,
    '%ADMIN_MONITORING_THRESHOLDS_INVALID_PAYMENT_FAILURE_RATE%'
  ),
  'monitoring threshold normalizer rejects critical below warning'
);

insert into ops.admin_users (id, email, display_name, status)
values (
  'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
  'phase6-monitoring-admin@example.invalid',
  'phase6 monitoring admin',
  'active'
)
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values (
  'PHASE6_MONITORING_ADMIN',
  'Phase 6 Monitoring Admin',
  '["ops:read","ops:write"]'::jsonb
)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2800-4000-8000-000000000001'::uuid, id
from ops.admin_roles
where code = 'PHASE6_MONITORING_ADMIN'
on conflict do nothing;

insert into economy.currency_ledger (
  id,
  currency_code,
  entry_type,
  amount,
  source_type,
  source_ref,
  idempotency_key,
  created_at
)
values
  (
    'bbbbbbbb-2800-4000-8000-000000000001'::uuid,
    'KCOIN',
    'credit',
    1000,
    'phase6_monitoring_test',
    'kcoin-credit',
    'phase6-monitoring-kcoin-credit',
    now()
  ),
  (
    'bbbbbbbb-2800-4000-8000-000000000002'::uuid,
    'KCOIN',
    'debit',
    250,
    'phase6_monitoring_test',
    'kcoin-debit',
    'phase6-monitoring-kcoin-debit',
    now()
  ),
  (
    'bbbbbbbb-2800-4000-8000-000000000003'::uuid,
    'FGEMS',
    'credit',
    50,
    'phase6_monitoring_test',
    'fgems-credit',
    'phase6-monitoring-fgems-credit',
    now()
  )
on conflict (id) do nothing;

select ok(
  (
    api.admin_get_economy_monitoring(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) ? 'serverTime'
  ),
  'economy monitoring RPC returns serverTime'
);

select cmp_ok(
  (
    api.admin_get_economy_monitoring(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) #>> '{metrics,currencies,KCOIN,issuedAmount}'
  )::numeric,
  '>=',
  1000::numeric,
  'KCOIN issued amount is aggregated by ledger entry type'
);

select cmp_ok(
  (
    api.admin_get_economy_monitoring(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) #>> '{metrics,currencies,KCOIN,recoveredAmount}'
  )::numeric,
  '>=',
  250::numeric,
  'KCOIN recovered amount is aggregated by ledger entry type'
);

select cmp_ok(
  (
    api.admin_get_economy_monitoring(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) #>> '{metrics,currencies,FGEMS,issuedAmount}'
  )::numeric,
  '>=',
  50::numeric,
  'FGEMS issued amount is aggregated by ledger'
);

select is(
  jsonb_typeof(
    api.admin_get_economy_monitoring(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) #> '{sources}'
  ),
  'object',
  'economy monitoring RPC returns sources'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_get_economy_monitoring(
        'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
        169,
        '{}'::jsonb
      )
    $$,
    '%ADMIN_MONITORING_WINDOW_INVALID%'
  ),
  'economy monitoring RPC rejects windows above 168 hours'
);

select ok(
  (
    api.admin_update_monitoring_thresholds(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      '{"kcoinNetIssuance":{"warningAmount":1,"windowHours":6}}'::jsonb,
      'phase6 monitoring threshold test',
      'phase6-monitoring-threshold-update-001',
      '{}'::jsonb
    ) ? 'audit_log_id'
  ),
  'monitoring threshold update returns audit_log_id'
);

select is(
  (
    select value #>> '{kcoinNetIssuance,warningAmount}'
    from ops.system_settings
    where key = 'monitoring.thresholds'
  ),
  '1',
  'monitoring threshold update stores normalized KCOIN warning amount'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where action = 'monitoring.thresholds.update'
      and target_schema = 'ops'
      and target_table = 'system_settings'
      and reason = 'phase6 monitoring threshold test'
  ),
  'monitoring threshold update writes admin audit log'
);

select ok(
  (
    api.admin_update_monitoring_thresholds(
      'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
      '{"kcoinNetIssuance":{"warningAmount":1,"windowHours":6}}'::jsonb,
      'phase6 monitoring threshold test',
      'phase6-monitoring-threshold-update-001',
      '{}'::jsonb
    ) ->> 'idempotent'
  )::boolean,
  'monitoring threshold update is idempotent for identical requests'
);

select * from finish();

rollback;
