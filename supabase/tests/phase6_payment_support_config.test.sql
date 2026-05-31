-- Phase 6 payment support config RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, ops;

select no_plan();

insert into ops.admin_users (
  id,
  telegram_user_id,
  display_name,
  status
)
values (
  '22222222-2222-4222-8222-222222222222',
  7001001,
  'Payment Support Admin',
  'active'
)
on conflict (id) do update
set status = excluded.status,
    display_name = excluded.display_name;

select has_function(
  'api',
  'admin_update_payment_support_config',
  array['uuid', 'text', 'text', 'text', 'text', 'jsonb'],
  'api.admin_update_payment_support_config exists'
);

select lives_ok(
  $$
    select api.admin_update_payment_support_config(
      '22222222-2222-4222-8222-222222222222'::uuid,
      'https://t.me/tma_support',
      'pay@example.test',
      'configure payment support',
      'test-payment-support-config-001',
      '{"ip_hash":"ip-test","user_agent_hash":"ua-test"}'::jsonb
    );
  $$,
  'admin can update payment support config'
);

select is(
  (
    select value ->> 'configured'
    from ops.system_settings
    where key = 'PAYMENT_SUPPORT_CONFIG'
  ),
  'true',
  'PAYMENT_SUPPORT_CONFIG is marked configured'
);

select is(
  (
    select value ->> 'support_url'
    from ops.system_settings
    where key = 'PAYMENT_SUPPORT_CONFIG'
  ),
  'https://t.me/tma_support',
  'PAYMENT_SUPPORT_CONFIG stores support URL'
);

select is(
  (
    select count(*)::integer
    from ops.admin_audit_logs
    where action = 'payment.support_config.update'
  ),
  1,
  'payment support config update writes admin audit log'
);

select throws_ok(
  $$
    select api.admin_update_payment_support_config(
      '22222222-2222-4222-8222-222222222222'::uuid,
      'http://example.test/support',
      null,
      'reject insecure support url',
      'test-payment-support-config-002',
      '{}'::jsonb
    );
  $$,
  'P0001',
  'ADMIN_PAYMENT_SUPPORT_URL_INVALID',
  'payment support URL must be HTTPS'
);

select * from finish();

rollback;
