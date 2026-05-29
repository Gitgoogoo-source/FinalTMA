-- Phase 5 step 15 admin ops audit and feature flag RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(19);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

with admin_row as (
  insert into ops.admin_users (email, display_name, status, metadata)
  values ('phase5-admin-ops@example.test', 'Phase 5 Admin Ops', 'active', '{"test":true}'::jsonb)
  returning id
)
insert into _ids (key, id)
select 'admin', id from admin_row;

select is(
  (
    select count(*)::int
    from ops.admin_roles
    where code in ('SUPER_ADMIN', 'SUPPORT', 'OPS', 'RISK')
  ),
  4,
  'admin roles are seeded for backend ops permissions'
);

select ok(
  exists (
    select 1
    from ops.admin_roles
    where code = 'SUPPORT'
      and permissions ? 'payments:read'
  ),
  'support role can read payment operations'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'payments'
      and tablename = 'star_orders'
      and indexname = 'star_orders_status_created_idx'
  ),
  'star order status/created admin query index exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'payments'
      and tablename = 'star_orders'
      and indexname = 'star_orders_user_status_idx'
  ),
  'star order user/status/created admin query index exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'payments'
      and tablename = 'star_orders'
      and indexname = 'star_orders_payload_idx'
  ),
  'star order invoice payload admin query index exists'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'onchain'
      and tablename = 'mint_queue'
      and indexname = 'mint_queue_status_attempt_next_created_idx'
  ),
  'mint queue status/attempt retry index exists'
);

insert into _ids (key, payload)
values (
  'feature_flag_update',
  api.admin_update_feature_flag(
    (select id from _ids where key = 'admin'),
    'FEATURE_ADMIN_TEST_FLAG',
    false,
    'test flag',
    'pause flag for admin ops test',
    'phase5-admin-ops-flag-001',
    jsonb_build_object('ip_hash', 'test-ip-hash', 'user_agent_hash', 'test-ua-hash')
  )
);

select is(
  (select payload ->> 'key' from _ids where key = 'feature_flag_update'),
  'FEATURE_ADMIN_TEST_FLAG',
  'feature flag RPC returns updated key'
);

select is(
  (select enabled from ops.feature_flags where key = 'FEATURE_ADMIN_TEST_FLAG'),
  false,
  'feature flag RPC writes enabled=false'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'admin')
      and action = 'feature_flag.update'
      and target_schema = 'ops'
      and target_table = 'feature_flags'
      and reason = 'pause flag for admin ops test'
  ),
  1,
  'feature flag RPC writes one admin audit log'
);

select ok(
  exists (
    select 1
    from ops.risk_events
    where event_type = 'admin_feature_flag_update'
      and source_type = 'feature_flag'
      and detail ->> 'key' = 'FEATURE_ADMIN_TEST_FLAG'
      and detail ->> 'idempotency_key' = 'phase5-admin-ops-flag-001'
  ),
  'feature flag RPC writes risk event context'
);

insert into _ids (key, payload)
values (
  'feature_flag_update_repeat',
  api.admin_update_feature_flag(
    (select id from _ids where key = 'admin'),
    'FEATURE_ADMIN_TEST_FLAG',
    false,
    'test flag',
    'pause flag for admin ops test',
    'phase5-admin-ops-flag-001',
    jsonb_build_object('ip_hash', 'test-ip-hash', 'user_agent_hash', 'test-ua-hash')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'feature_flag_update_repeat'))::boolean,
  'feature flag RPC returns idempotent repeat'
);

select is(
  (
    select count(*)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'admin')
      and action = 'feature_flag.update'
      and reason = 'pause flag for admin ops test'
  ),
  1,
  'idempotent repeat does not duplicate admin audit log'
);

select ok(
  lower(
    coalesce(
      (
        select proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api'
          and p.proname = 'admin_retry_mint_queue'
        limit 1
      ),
      ''
    )
  ) = 'admin_retry_mint_queue',
  'admin retry mint RPC exists'
);

select ok(
  lower(
    coalesce(
      (
        select proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'api'
          and p.proname = 'admin_retry_payment_fulfillment'
        limit 1
      ),
      ''
    )
  ) = 'admin_retry_payment_fulfillment',
  'admin retry payment fulfillment RPC exists'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname = 'admin_write_audit_log'
      and p.prosecdef
      and p.proconfig @> array['search_path=""']
  ),
  'admin audit RPC is security definer with fixed empty search_path'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'api'
      and p.proname in (
        'admin_write_audit_log',
        'admin_retry_mint_queue',
        'admin_retry_payment_fulfillment',
        'admin_update_feature_flag'
      )
      and (
        not p.prosecdef
        or not (p.proconfig @> array['search_path=""'])
      )
  ),
  'admin write RPCs are security definer with fixed empty search_path'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_update_feature_flag(uuid,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.admin_update_feature_flag(uuid,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.admin_update_feature_flag(uuid,text,boolean,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'feature flag update RPC is service_role only'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_retry_mint_queue(uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.admin_retry_mint_queue(uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.admin_retry_mint_queue(uuid,uuid,text,text,text,jsonb)',
    'EXECUTE'
  ),
  'retry mint RPC is service_role only'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_retry_payment_fulfillment(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'api.admin_retry_payment_fulfillment(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'api.admin_retry_payment_fulfillment(uuid,uuid,text,text,jsonb)',
    'EXECUTE'
  ),
  'retry payment fulfillment RPC is service_role only'
);

select * from finish();

rollback;
