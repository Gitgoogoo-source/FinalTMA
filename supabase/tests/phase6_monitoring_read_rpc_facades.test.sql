-- Phase 6 step 2.8 monitoring read RPC facade checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

insert into ops.admin_users (id, email, display_name, status)
values (
  'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
  'phase6-monitoring-read-rpc@example.invalid',
  'phase6 monitoring read rpc admin',
  'active'
)
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values (
  'PHASE6_MONITORING_READ_RPC_ADMIN',
  'Phase 6 Monitoring Read RPC Admin',
  '["admin:read","ops:read","payments:read","tasks:read","mint:read","onchain:read","users:read","gacha:read","market:read"]'::jsonb
)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2808-4000-8000-000000000001'::uuid, id
from ops.admin_roles
where code = 'PHASE6_MONITORING_READ_RPC_ADMIN'
on conflict do nothing;

select ok(
  to_regprocedure('api.admin_get_operational_monitoring(uuid,integer,jsonb)') is not null,
  'api.admin_get_operational_monitoring RPC exists'
);

select ok(
  to_regprocedure('api.admin_get_business_monitoring(uuid,integer,jsonb)') is not null,
  'api.admin_get_business_monitoring RPC exists'
);

select ok(
  to_regprocedure('api.admin_get_gacha_monitoring(uuid,integer,jsonb)') is not null,
  'api.admin_get_gacha_monitoring RPC exists'
);

select ok(
  to_regprocedure('api.admin_get_market_monitoring(uuid,integer,jsonb)') is not null,
  'api.admin_get_market_monitoring RPC exists'
);

select ok(
  to_regprocedure('api.admin_get_monitoring_thresholds(uuid,jsonb)') is not null,
  'api.admin_get_monitoring_thresholds RPC exists'
);

select ok(
  to_regprocedure('api.get_payment_support_config()') is not null,
  'api.get_payment_support_config RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_get_business_monitoring(uuid,integer,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'service_role can execute business monitoring RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'api.admin_get_business_monitoring(uuid,integer,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'anon cannot execute business monitoring RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'api.admin_get_market_monitoring(uuid,integer,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'authenticated cannot execute market monitoring RPC'
);

select ok(
  (
    api.admin_get_operational_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) ? 'sources'
  ),
  'operational monitoring RPC returns sources'
);

select ok(
  (
    api.admin_get_business_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) ? 'metrics'
  ),
  'business monitoring RPC returns metrics'
);

select ok(
  position(
    'telegram_payment_charge_id' in api.admin_get_business_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    )::text
  ) = 0,
  'business monitoring RPC does not expose payment charge IDs'
);

select is(
  api.admin_get_gacha_monitoring(
    'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
    24,
    '{}'::jsonb
  ) #>> '{sources,drawResults,dimensions,0}',
  'box_id',
  'gacha monitoring RPC returns box and rarity dimensions'
);

select ok(
  position(
    'error_message' in api.admin_get_gacha_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    )::text
  ) = 0,
  'gacha monitoring RPC does not expose internal draw error text'
);

select ok(
  (
    api.admin_get_market_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) ? 'market'
  )
  and
  (
    api.admin_get_market_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    ) ? 'metrics'
  ),
  'market monitoring RPC returns both legacy market and dashboard metrics envelopes'
);

select ok(
  position(
    'seller_user_id' in api.admin_get_market_monitoring(
      'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
      24,
      '{}'::jsonb
    )::text
  ) = 0,
  'market monitoring RPC does not expose seller user ids'
);

select is(
  api.admin_get_monitoring_thresholds(
    'aaaaaaaa-2808-4000-8000-000000000001'::uuid,
    '{}'::jsonb
  ) ->> 'key',
  'monitoring.thresholds',
  'monitoring threshold read RPC returns the setting key'
);

select ok(
  api.get_payment_support_config() ? 'configured',
  'payment support config read RPC returns configured flag'
);

select * from finish();

rollback;
