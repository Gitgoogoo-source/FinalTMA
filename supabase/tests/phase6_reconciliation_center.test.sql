-- Phase 6 step 2.6 reconciliation center constraint and RPC checks.

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

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb,
  value text
) on commit drop;

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'economy'
      and c.relname = 'reconciliation_runs'
      and con.conname = 'reconciliation_runs_run_type_check'
      and not exists (
        select 1
        from (
          values
            ('payment_fulfillment'),
            ('mint_queue'),
            ('wallet_sync'),
            ('ledger_balance'),
            ('market_settlement'),
            ('inventory_lock'),
            ('gacha_stock'),
            ('referral_commission')
        ) as expected(run_type)
        where pg_get_constraintdef(con.oid) not like '%' || expected.run_type || '%'
      )
  ),
  'economy.reconciliation_runs_run_type_check includes all reconciliation center run types'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops'
      and c.relname = 'risk_events'
      and con.conname = 'risk_events_status_check'
      and not exists (
        select 1
        from (
          values
            ('open'),
            ('reviewing'),
            ('resolved'),
            ('ignored'),
            ('fixed'),
            ('false_positive'),
            ('escalated')
        ) as expected(status)
        where pg_get_constraintdef(con.oid) not like '%' || expected.status || '%'
      )
  ),
  'ops.risk_events_status_check keeps historical resolved and adds manual reconciliation statuses'
);

select lives_ok(
  $$
    insert into economy.reconciliation_runs (run_type, status, result, created_by)
    values
      ('payment_fulfillment', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('mint_queue', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('wallet_sync', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('ledger_balance', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('market_settlement', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('inventory_lock', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('gacha_stock', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test'),
      ('referral_commission', 'success', '{"ok":true}'::jsonb, 'phase6-reconciliation-center-test')
  $$,
  'economy.reconciliation_runs accepts all reconciliation center run types'
);

select is(
  (
    select count(*)::int
    from economy.reconciliation_runs
    where created_by = 'phase6-reconciliation-center-test'
      and run_type in (
        'payment_fulfillment',
        'mint_queue',
        'wallet_sync',
        'ledger_balance',
        'market_settlement',
        'inventory_lock',
        'gacha_stock',
        'referral_commission'
      )
  ),
  8,
  'all reconciliation center run type rows are inserted'
);

select lives_ok(
  $$
    insert into ops.risk_events (
      event_type,
      severity,
      status,
      source_type,
      source_id,
      detail
    )
    values
      (
        'ledger_balance_mismatch',
        'low',
        'fixed',
        'reconciliation_run',
        gen_random_uuid(),
        '{"test":"phase6_reconciliation_center","status":"fixed"}'::jsonb
      ),
      (
        'ledger_balance_mismatch',
        'low',
        'false_positive',
        'reconciliation_run',
        gen_random_uuid(),
        '{"test":"phase6_reconciliation_center","status":"false_positive"}'::jsonb
      ),
      (
        'ledger_balance_mismatch',
        'low',
        'escalated',
        'reconciliation_run',
        gen_random_uuid(),
        '{"test":"phase6_reconciliation_center","status":"escalated"}'::jsonb
      )
  $$,
  'ops.risk_events accepts fixed, false_positive and escalated statuses'
);

select is(
  (
    select count(*)::int
    from ops.risk_events
    where event_type = 'ledger_balance_mismatch'
      and detail ->> 'test' = 'phase6_reconciliation_center'
      and status in ('fixed', 'false_positive', 'escalated')
  ),
  3,
  'all new reconciliation finding status rows are inserted'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'economy'
      and tablename = 'reconciliation_runs'
      and indexname = 'reconciliation_runs_one_running_type_idx'
  ),
  'economy.reconciliation_runs has a same-run-type running lock index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'ops'
      and tablename = 'risk_events'
      and indexname = 'risk_events_open_reconciliation_source_idx'
  ),
  'ops.risk_events has an open/reviewing source dedupe index'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'ops'
      and tablename = 'risk_events'
      and indexname = 'risk_events_reconciliation_findings_query_idx'
  ),
  'ops.risk_events has a reconciliation findings query index'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = '_admin_require_any_permission'
      and pg_get_function_arguments(p.oid) like '%p_permissions text[]%'
  ),
  'api._admin_require_any_permission helper exists'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'admin_resolve_reconciliation_finding'
      and pg_get_function_arguments(p.oid) like '%p_risk_event_id uuid%'
      and pg_get_function_arguments(p.oid) like '%p_resolution_detail jsonb%'
  ),
  'api.admin_resolve_reconciliation_finding RPC exists with expected arguments'
);

insert into ops.admin_users (id, email, display_name, status)
values
  (
    'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
    'phase6-reconciliation-risk@example.invalid',
    'phase6 reconciliation risk admin',
    'active'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000002'::uuid,
    'phase6-reconciliation-ops@example.invalid',
    'phase6 reconciliation ops admin',
    'active'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000003'::uuid,
    'phase6-reconciliation-readonly@example.invalid',
    'phase6 reconciliation readonly admin',
    'active'
  ),
  (
    'aaaaaaaa-1000-4000-8000-000000000004'::uuid,
    'phase6-reconciliation-wildcard@example.invalid',
    'phase6 reconciliation wildcard admin',
    'active'
  )
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values
  ('PHASE6_RECON_RISK', 'Phase 6 Reconciliation Risk', '["risk:write"]'::jsonb),
  ('PHASE6_RECON_OPS', 'Phase 6 Reconciliation Ops', '["ops:write"]'::jsonb),
  ('PHASE6_RECON_READONLY', 'Phase 6 Reconciliation Readonly', '["ops:read"]'::jsonb),
  ('PHASE6_RECON_RISK_WILDCARD', 'Phase 6 Reconciliation Risk Wildcard', '["risk:*"]'::jsonb)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-1000-4000-8000-000000000001'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RECON_RISK'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-1000-4000-8000-000000000002'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RECON_OPS'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-1000-4000-8000-000000000003'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RECON_READONLY'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-1000-4000-8000-000000000004'::uuid, id
from ops.admin_roles
where code = 'PHASE6_RECON_RISK_WILDCARD'
on conflict do nothing;

insert into ops.risk_events (
  id,
  event_type,
  severity,
  status,
  source_type,
  source_id,
  detail
)
values
  (
    'bbbbbbbb-1000-4000-8000-000000000001'::uuid,
    'ledger_balance_mismatch',
    'high',
    'open',
    'manual_risk',
    'cccccccc-1000-4000-8000-000000000001'::uuid,
    '{"test":"ordinary_risk_event"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000002'::uuid,
    'payment_paid_not_fulfilled',
    'high',
    'open',
    'market_order',
    'cccccccc-1000-4000-8000-000000000002'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000002","reconciliation_run_type":"market_settlement"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000003'::uuid,
    'ledger_balance_mismatch',
    'critical',
    'open',
    'market_order',
    'cccccccc-1000-4000-8000-000000000003'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000003","reconciliation_run_type":"market_settlement"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000004'::uuid,
    'gacha_stock_mismatch',
    'high',
    'open',
    'gacha_pool_item',
    'cccccccc-1000-4000-8000-000000000004'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000004","reconciliation_run_type":"gacha_stock"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000005'::uuid,
    'referral_abuse',
    'high',
    'open',
    'referral_commission',
    'cccccccc-1000-4000-8000-000000000005'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000005","reconciliation_run_type":"referral_commission"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000006'::uuid,
    'mint_retry_exceeded',
    'high',
    'open',
    'inventory_lock',
    'cccccccc-1000-4000-8000-000000000006'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000006","reconciliation_run_type":"inventory_lock"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000007'::uuid,
    'mint_confirmed_queue_not_minted',
    'medium',
    'open',
    'mint_queue',
    'cccccccc-1000-4000-8000-000000000007'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000007","reconciliation_run_type":"mint_queue"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000008'::uuid,
    'market_price_manipulation',
    'high',
    'open',
    'market_order',
    'cccccccc-1000-4000-8000-000000000008'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000008","reconciliation_run_type":"market_settlement"}'::jsonb
  ),
  (
    'bbbbbbbb-1000-4000-8000-000000000009'::uuid,
    'market_abnormal_cancel_rate',
    'high',
    'open',
    'market_order',
    'cccccccc-1000-4000-8000-000000000009'::uuid,
    '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000009","reconciliation_run_type":"market_settlement"}'::jsonb
  );

select ok(
  testutil.raises_like(
    $$
      insert into ops.risk_events (
        event_type,
        severity,
        status,
        source_type,
        source_id,
        detail
      )
      values (
        'market_price_manipulation',
        'high',
        'reviewing',
        'market_order',
        'cccccccc-1000-4000-8000-000000000008'::uuid,
        '{"reconciliation_run_id":"dddddddd-1000-4000-8000-000000000099","reconciliation_run_type":"market_settlement"}'::jsonb
      )
    $$,
    '%duplicate key%'
  ),
  'open/reviewing reconciliation source dedupe index rejects duplicate business source findings'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000003'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000002'::uuid,
        p_status => 'ignored',
        p_reason => 'phase6 readonly admin should not close reconciliation findings',
        p_idempotency_key => 'phase6-reconciliation-no-permission',
        p_request_context => '{"request_id":"phase6-reconciliation-no-permission"}'::jsonb,
        p_resolution_detail => '{}'::jsonb
      )
    $$,
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'admin without risk:write cannot resolve a reconciliation finding'
);

select lives_ok(
  $$
    select api.admin_resolve_reconciliation_finding(
      p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000004'::uuid,
      p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000009'::uuid,
      p_status => 'reviewing',
      p_reason => 'phase6 wildcard risk permission should close the API/RPC permission gap',
      p_idempotency_key => 'phase6-reconciliation-wildcard-risk-write',
      p_request_context => '{"request_id":"phase6-reconciliation-wildcard"}'::jsonb,
      p_resolution_detail => '{}'::jsonb
    )
  $$,
  'risk:* wildcard permission can resolve a reconciliation finding'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000001'::uuid,
        p_status => 'ignored',
        p_reason => 'phase6 ordinary risk event must not be handled by reconciliation RPC',
        p_idempotency_key => 'phase6-reconciliation-ordinary-risk-event',
        p_request_context => '{"request_id":"phase6-reconciliation-ordinary"}'::jsonb,
        p_resolution_detail => '{}'::jsonb
      )
    $$,
    '%ADMIN_RECONCILIATION_FINDING_SCOPE_INVALID%'
  ),
  'ordinary risk_event without reconciliation detail cannot be resolved by reconciliation RPC'
);

select lives_ok(
  $$
    select api.admin_resolve_reconciliation_finding(
      p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
      p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000003'::uuid,
      p_status => 'reviewing',
      p_reason => 'phase6 reviewing transition verification',
      p_idempotency_key => 'phase6-reconciliation-reviewing',
      p_request_context => '{"request_id":"phase6-reconciliation-reviewing"}'::jsonb,
      p_resolution_detail => '{}'::jsonb
    )
  $$,
  'risk:write admin can move an open reconciliation finding to reviewing'
);

select is(
  (
    select status
    from ops.risk_events
    where id = 'bbbbbbbb-1000-4000-8000-000000000003'::uuid
  ),
  'reviewing',
  'open -> reviewing status is persisted'
);

select ok(
  exists (
    select 1
    from ops.risk_events
    where id = 'bbbbbbbb-1000-4000-8000-000000000003'::uuid
      and resolved_at is null
      and resolved_by_admin_id is null
  ),
  'reviewing transition does not set resolved_at or resolved_by_admin_id'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000004'::uuid,
        p_status => 'fixed',
        p_reason => 'phase6 fixed must include fix method',
        p_idempotency_key => 'phase6-reconciliation-fixed-missing-method',
        p_request_context => '{"request_id":"phase6-reconciliation-fixed-missing"}'::jsonb,
        p_resolution_detail => '{}'::jsonb
      )
    $$,
    '%ADMIN_RECONCILIATION_FIX_METHOD_REQUIRED%'
  ),
  'fixed resolution requires fix_method'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000005'::uuid,
        p_status => 'escalated',
        p_reason => 'phase6 escalated must include target',
        p_idempotency_key => 'phase6-reconciliation-escalated-missing-target',
        p_request_context => '{"request_id":"phase6-reconciliation-escalated-missing"}'::jsonb,
        p_resolution_detail => '{}'::jsonb
      )
    $$,
    '%ADMIN_RECONCILIATION_ESCALATION_TARGET_REQUIRED%'
  ),
  'escalated resolution requires ticket_id or escalation_owner'
);

select lives_ok(
  $$
    insert into _ids (key, payload)
    select
      'fixed_first_response',
      api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000003'::uuid,
        p_status => 'fixed',
        p_reason => 'phase6 fixed transition verification',
        p_idempotency_key => 'phase6-reconciliation-fixed-success',
        p_request_context => '{"request_id":"phase6-reconciliation-fixed"}'::jsonb,
        p_resolution_detail => '{"fix_method":"manual_pgTAP_verification"}'::jsonb
      )
  $$,
  'reviewing reconciliation finding can be marked fixed'
);

select ok(
  exists (
    select 1
    from ops.risk_events
    where id = 'bbbbbbbb-1000-4000-8000-000000000003'::uuid
      and status = 'fixed'
      and resolved_at is not null
      and resolved_by_admin_id = 'aaaaaaaa-1000-4000-8000-000000000001'::uuid
  ),
  'terminal resolution sets resolved_at and resolved_by_admin_id'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000003'::uuid,
        p_status => 'fixed',
        p_reason => 'phase6 terminal state must reject a new idempotency key',
        p_idempotency_key => 'phase6-reconciliation-fixed-new-key-after-terminal',
        p_request_context => '{"request_id":"phase6-reconciliation-fixed-new-key"}'::jsonb,
        p_resolution_detail => '{"fix_method":"manual_pgTAP_verification"}'::jsonb
      )
    $$,
    '%ADMIN_RECONCILIATION_FINDING_NOT_OPEN%'
  ),
  'terminal finding cannot be modified again with a new idempotency key'
);

select lives_ok(
  $$
    insert into _ids (key, payload)
    select
      'fixed_replay_response',
      api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000003'::uuid,
        p_status => 'fixed',
        p_reason => 'phase6 fixed transition verification',
        p_idempotency_key => 'phase6-reconciliation-fixed-success',
        p_request_context => '{"request_id":"phase6-reconciliation-fixed"}'::jsonb,
        p_resolution_detail => '{"fix_method":"manual_pgTAP_verification"}'::jsonb
      )
  $$,
  'same idempotency key can replay a completed fixed resolution'
);

select is(
  (
    select payload ->> 'idempotent'
    from _ids
    where key = 'fixed_replay_response'
  ),
  'true',
  'same idempotency key replay returns the cached idempotent response'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where target_schema = 'ops'
      and target_table = 'risk_events'
      and target_id = 'bbbbbbbb-1000-4000-8000-000000000003'::uuid
  ),
  2,
  'same idempotency key replay does not write an additional audit log'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000002'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000006'::uuid,
        p_status => 'fixed',
        p_reason => 'phase6 ops write permission must not close findings',
        p_idempotency_key => 'phase6-reconciliation-ops-write-denied',
        p_request_context => '{"request_id":"phase6-reconciliation-ops-write-denied"}'::jsonb,
        p_resolution_detail => '{"fix_method":"ops_permission_pgTAP_verification"}'::jsonb
      )
    $$,
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'ops:write admin cannot resolve a reconciliation finding without risk:write'
);

select ok(
  testutil.raises_like(
    $$
      select api.admin_resolve_reconciliation_finding(
        p_admin_user_id => 'aaaaaaaa-1000-4000-8000-000000000001'::uuid,
        p_risk_event_id => 'bbbbbbbb-1000-4000-8000-000000000007'::uuid,
        p_status => 'resolved',
        p_reason => 'phase6 resolved remains historical only',
        p_idempotency_key => 'phase6-reconciliation-resolved-status-rejected',
        p_request_context => '{"request_id":"phase6-reconciliation-resolved-rejected"}'::jsonb,
        p_resolution_detail => '{}'::jsonb
      )
    $$,
    '%ADMIN_RECONCILIATION_FINDING_STATUS_INVALID%'
  ),
  'RPC rejects new resolved status writes while the table constraint keeps historical resolved'
);

select ok(
  exists (
    select 1
    from ops.admin_audit_logs
    where action = 'reconciliation.finding.resolve'
      and target_schema = 'ops'
      and target_table = 'risk_events'
      and target_id = 'bbbbbbbb-1000-4000-8000-000000000003'::uuid
  ),
  'reconciliation finding resolutions write admin audit logs'
);

select * from finish();

rollback;
