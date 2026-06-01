-- Phase 6 step 2.8 alert lifecycle tests.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

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

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create temp table _ids (
  key text primary key,
  payload jsonb
) on commit drop;

select ok(
  to_regclass('ops.alerts') is not null
    and to_regprocedure('api.alert_record_event(text,text,text,text,text,uuid,jsonb,text)') is not null
    and to_regprocedure('api.admin_list_alerts(jsonb,text,integer,integer)') is not null
    and to_regprocedure('api.admin_update_alert_status(uuid,uuid,text,text,text,jsonb,text)') is not null,
  'alert table and lifecycle RPCs exist with expected signatures'
);

select ok(
  (
    select bool_and(
      has_function_privilege('service_role', signature, 'EXECUTE')
      and not has_function_privilege('public', signature, 'EXECUTE')
      and not has_function_privilege('anon', signature, 'EXECUTE')
      and not has_function_privilege('authenticated', signature, 'EXECUTE')
    )
    from (
      values
        ('api.alert_record_event(text,text,text,text,text,uuid,jsonb,text)'::regprocedure),
        ('api.admin_list_alerts(jsonb,text,integer,integer)'::regprocedure),
        ('api.admin_update_alert_status(uuid,uuid,text,text,text,jsonb,text)'::regprocedure)
    ) as f(signature)
  ),
  'alert RPCs are service_role-only'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'ops'
      and rel.relname = 'alerts'
      and con.conname = 'alerts_status_check'
      and not exists (
        select 1
        from (
          values
            ('open'),
            ('acknowledged'),
            ('resolved'),
            ('ignored')
        ) as expected(status)
        where pg_get_constraintdef(con.oid) not like '%' || expected.status || '%'
      )
  ),
  'ops.alerts has the required lifecycle status check'
);

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops'
      and c.relname = 'alerts'
  )
  and not has_table_privilege('anon', 'ops.alerts', 'SELECT')
  and not has_table_privilege('authenticated', 'ops.alerts', 'SELECT'),
  'ops.alerts keeps RLS enabled and denies direct browser role access'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'ops'
      and tablename = 'alerts'
      and indexname = 'alerts_active_source_unique_idx'
  ),
  'ops.alerts has active source dedupe index'
);

insert into ops.admin_users (id, email, display_name, status)
values
  ('aaaaaaaa-2800-4000-8000-000000000001'::uuid, 'phase6-alert-write@example.invalid', 'phase6 alert writer', 'active'),
  ('aaaaaaaa-2800-4000-8000-000000000002'::uuid, 'phase6-alert-readonly@example.invalid', 'phase6 alert readonly', 'active')
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values
  ('PHASE6_ALERT_LIFECYCLE_WRITE', 'Phase 6 Alert Lifecycle Write', '["ops:write"]'::jsonb),
  ('PHASE6_ALERT_LIFECYCLE_READONLY', 'Phase 6 Alert Lifecycle Readonly', '["ops:read"]'::jsonb)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2800-4000-8000-000000000001'::uuid, id
from ops.admin_roles
where code = 'PHASE6_ALERT_LIFECYCLE_WRITE'
on conflict do nothing;

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2800-4000-8000-000000000002'::uuid, id
from ops.admin_roles
where code = 'PHASE6_ALERT_LIFECYCLE_READONLY'
on conflict do nothing;

insert into _ids (key, payload)
select
  'record_first',
  api.alert_record_event(
    p_alert_type => 'payment_paid_not_fulfilled',
    p_severity => 'critical',
    p_title => 'Paid order not fulfilled',
    p_message => 'paid order exceeded fulfillment threshold',
    p_source_type => 'star_order',
    p_source_id => 'bbbbbbbb-2800-4000-8000-000000000001'::uuid,
    p_detail => '{"token":"must-not-leak","nested":{"secret":"hidden"},"count":1}'::jsonb,
    p_idempotency_key => 'phase6-alert-record-first'
  );

select is(
  (select payload ->> 'status' from _ids where key = 'record_first'),
  'open',
  'alert_record_event creates an open alert'
);

select ok(
  exists (
    select 1
    from ops.alerts
    where id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
      and source_type = 'star_order'
      and source_id = 'bbbbbbbb-2800-4000-8000-000000000001'::uuid
      and detail ->> 'source_type' = 'star_order'
      and detail ->> 'source_id' = 'bbbbbbbb-2800-4000-8000-000000000001'
      and detail ->> 'token' = '[REDACTED]'
      and detail -> 'nested' ->> 'secret' = '[REDACTED]'
  ),
  'alert detail stores source_type/source_id and redacts sensitive fields'
);

insert into _ids (key, payload)
select
  'record_replay',
  api.alert_record_event(
    p_alert_type => 'payment_paid_not_fulfilled',
    p_severity => 'critical',
    p_title => 'Paid order not fulfilled',
    p_message => 'paid order exceeded fulfillment threshold',
    p_source_type => 'star_order',
    p_source_id => 'bbbbbbbb-2800-4000-8000-000000000001'::uuid,
    p_detail => '{"token":"must-not-leak","nested":{"secret":"hidden"},"count":1}'::jsonb,
    p_idempotency_key => 'phase6-alert-record-first'
  );

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'record_replay'))::boolean
    and (select payload ->> 'alert_id' from _ids where key = 'record_replay')
      = (select payload ->> 'alert_id' from _ids where key = 'record_first'),
  'alert_record_event replays completed idempotency key'
);

select ok(
  testutil.raises_like(
    format(
      $$
        select api.admin_update_alert_status(
          p_admin_user_id => %L::uuid,
          p_alert_id => %L::uuid,
          p_status => 'acknowledged',
          p_reason => '',
          p_idempotency_key => 'phase6-alert-ack-missing-reason',
          p_request_context => '{"request_id":"phase6-alert-ack-missing-reason"}'::jsonb
        )
      $$,
      'aaaaaaaa-2800-4000-8000-000000000001',
      (select payload ->> 'alert_id' from _ids where key = 'record_first')
    ),
    '%ADMIN_REASON_REQUIRED%'
  ),
  'acknowledge requires reason'
);

select ok(
  testutil.raises_like(
    format(
      $$
        select api.admin_update_alert_status(
          p_admin_user_id => %L::uuid,
          p_alert_id => %L::uuid,
          p_status => 'acknowledged',
          p_reason => 'readonly cannot ack alerts',
          p_idempotency_key => 'phase6-alert-ack-readonly',
          p_request_context => '{"request_id":"phase6-alert-ack-readonly"}'::jsonb
        )
      $$,
      'aaaaaaaa-2800-4000-8000-000000000002',
      (select payload ->> 'alert_id' from _ids where key = 'record_first')
    ),
    '%ADMIN_PERMISSION_DENIED%'
  ),
  'readonly admin cannot acknowledge alerts'
);

insert into _ids (key, payload)
select
  'ack_first',
  api.admin_update_alert_status(
    p_admin_user_id => 'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
    p_alert_id => (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first'),
    p_status => 'acknowledged',
    p_reason => 'ops has seen the alert',
    p_idempotency_key => 'phase6-alert-ack-first',
    p_request_context => '{"request_id":"phase6-alert-ack-first"}'::jsonb
  );

select ok(
  exists (
    select 1
    from ops.alerts
    where id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
      and status = 'acknowledged'
      and status_reason = 'ops has seen the alert'
      and acknowledged_by_admin_id = 'aaaaaaaa-2800-4000-8000-000000000001'::uuid
      and acknowledged_at is not null
      and resolution_result is null
  ),
  'acknowledge sets acknowledged state without requiring business resolution'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'alert.acknowledge'
      and target_schema = 'ops'
      and target_table = 'alerts'
      and target_id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
  ),
  1,
  'acknowledge writes audit log'
);

insert into _ids (key, payload)
select
  'ack_replay',
  api.admin_update_alert_status(
    p_admin_user_id => 'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
    p_alert_id => (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first'),
    p_status => 'acknowledged',
    p_reason => 'ops has seen the alert',
    p_idempotency_key => 'phase6-alert-ack-first',
    p_request_context => '{"request_id":"phase6-alert-ack-first"}'::jsonb
  );

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'ack_replay'))::boolean,
  'admin_update_alert_status replays completed ack idempotency key'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'alert.acknowledge'
      and target_id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
  ),
  1,
  'ack replay does not duplicate audit logs'
);

select ok(
  testutil.raises_like(
    format(
      $$
        select api.admin_update_alert_status(
          p_admin_user_id => %L::uuid,
          p_alert_id => %L::uuid,
          p_status => 'resolved',
          p_reason => 'missing resolution result',
          p_idempotency_key => 'phase6-alert-resolve-missing-result',
          p_request_context => '{"request_id":"phase6-alert-resolve-missing-result"}'::jsonb
        )
      $$,
      'aaaaaaaa-2800-4000-8000-000000000001',
      (select payload ->> 'alert_id' from _ids where key = 'record_first')
    ),
    '%ADMIN_ALERT_RESOLUTION_RESULT_REQUIRED%'
  ),
  'resolved requires resolution result'
);

insert into _ids (key, payload)
select
  'resolve_first',
  api.admin_update_alert_status(
    p_admin_user_id => 'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
    p_alert_id => (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first'),
    p_status => 'resolved',
    p_reason => 'fulfillment queue drained',
    p_idempotency_key => 'phase6-alert-resolve-first',
    p_request_context => '{"request_id":"phase6-alert-resolve-first"}'::jsonb,
    p_resolution_result => 'order fulfilled after retry'
  );

select ok(
  exists (
    select 1
    from ops.alerts
    where id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
      and status = 'resolved'
      and status_reason = 'fulfillment queue drained'
      and resolution_result = 'order fulfilled after retry'
      and resolved_by_admin_id = 'aaaaaaaa-2800-4000-8000-000000000001'::uuid
      and resolved_at is not null
  ),
  'resolve stores processing result and resolver fields'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'alert.resolve'
      and target_id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_first')
  ),
  1,
  'resolve writes audit log'
);

insert into _ids (key, payload)
select
  'record_ignore',
  api.alert_record_event(
    p_alert_type => 'mint_queue_stuck',
    p_severity => 'warning',
    p_title => 'Mint queue stuck',
    p_source_type => 'mint_queue',
    p_source_id => 'bbbbbbbb-2800-4000-8000-000000000002'::uuid,
    p_detail => '{"mint_queue_id":"bbbbbbbb-2800-4000-8000-000000000002"}'::jsonb,
    p_idempotency_key => 'phase6-alert-record-ignore'
  );

insert into _ids (key, payload)
select
  'ignore_alert',
  api.admin_update_alert_status(
    p_admin_user_id => 'aaaaaaaa-2800-4000-8000-000000000001'::uuid,
    p_alert_id => (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_ignore'),
    p_status => 'ignored',
    p_reason => 'test alert generated by known maintenance',
    p_idempotency_key => 'phase6-alert-ignore',
    p_request_context => '{"request_id":"phase6-alert-ignore"}'::jsonb
  );

select ok(
  exists (
    select 1
    from ops.alerts
    where id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_ignore')
      and status = 'ignored'
      and ignored_by_admin_id = 'aaaaaaaa-2800-4000-8000-000000000001'::uuid
      and ignored_at is not null
  ),
  'ignore closes alert with reason and ignored fields'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where action = 'alert.ignore'
      and target_id = (select (payload ->> 'alert_id')::uuid from _ids where key = 'record_ignore')
  ),
  1,
  'ignore writes audit log'
);

insert into _ids (key, payload)
select
  'record_active',
  api.alert_record_event(
    p_alert_type => 'webhook_stuck',
    p_severity => 'warning',
    p_title => 'Webhook stuck',
    p_source_type => 'webhook_event',
    p_source_id => 'bbbbbbbb-2800-4000-8000-000000000003'::uuid,
    p_detail => '{"webhook_event_id":"bbbbbbbb-2800-4000-8000-000000000003"}'::jsonb,
    p_idempotency_key => 'phase6-alert-record-active'
  );

select is(
  (
    api.admin_list_alerts(
      p_filters => '{"statuses":["open","acknowledged"]}'::jsonb,
      p_sort => 'last_seen_at',
      p_limit => 20,
      p_offset => 0
    ) ->> 'total_count'
  ),
  '1',
  'list alerts can return only active open/acknowledged alerts'
);

select ok(
  testutil.raises_like(
    $$
      insert into ops.alerts (
        alert_type,
        severity,
        status,
        title,
        source_type,
        source_id,
        status_reason,
        detail
      )
      values (
        'direct_invalid_resolved',
        'warning',
        'resolved',
        'direct invalid resolved',
        'star_order',
        gen_random_uuid(),
        'missing result',
        '{}'::jsonb
      )
    $$,
    '%alerts_resolution_result_check%'
  ),
  'direct resolved alert requires resolution_result by table constraint'
);

select * from finish();

rollback;
