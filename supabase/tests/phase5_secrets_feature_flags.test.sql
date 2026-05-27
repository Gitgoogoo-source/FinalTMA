-- Phase 5 secrets, feature flags and non-sensitive settings checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, ops;

select no_plan();

with required_flags(key, expected_enabled) as (
  values
    ('FEATURE_WALLET_ENABLED', true),
    ('FEATURE_STARS_PAYMENT_ENABLED', false),
    ('FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED', false),
    ('FEATURE_WALLET_PROOF_ENABLED', true),
    ('FEATURE_WALLET_SYNC_ENABLED', true),
    ('FEATURE_TON_MINT_ENABLED', false),
    ('FEATURE_MINT_WORKER_ENABLED', false),
    ('FEATURE_ADMIN_PAYMENT_OPS_ENABLED', false)
),
missing as (
  select required_flags.key
  from required_flags
  left join ops.feature_flags flags on flags.key = required_flags.key
  where flags.key is null
)
select is(
  (select count(*)::integer from missing),
  0,
  'all Phase 5 feature flags exist'
);

with required_flags(key, expected_enabled) as (
  values
    ('FEATURE_WALLET_ENABLED', true),
    ('FEATURE_STARS_PAYMENT_ENABLED', false),
    ('FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED', false),
    ('FEATURE_WALLET_PROOF_ENABLED', true),
    ('FEATURE_WALLET_SYNC_ENABLED', true),
    ('FEATURE_TON_MINT_ENABLED', false),
    ('FEATURE_MINT_WORKER_ENABLED', false),
    ('FEATURE_ADMIN_PAYMENT_OPS_ENABLED', false)
),
mismatch as (
  select required_flags.key
  from required_flags
  join ops.feature_flags flags on flags.key = required_flags.key
  where flags.enabled is distinct from required_flags.expected_enabled
)
select is(
  (select count(*)::integer from mismatch),
  0,
  'Phase 5 feature flags use conservative default enabled states'
);

with required_settings(key) as (
  values
    ('PAYMENT_SUPPORT_CONFIG'),
    ('STARS_OPEN_ORDER_POLICY'),
    ('TON_MINT_RETRY_POLICY'),
    ('WALLET_SYNC_POLICY')
),
missing as (
  select required_settings.key
  from required_settings
  left join ops.system_settings settings on settings.key = required_settings.key
  where settings.key is null
)
select is(
  (select count(*)::integer from missing),
  0,
  'Phase 5 non-sensitive system settings exist'
);

select ok(
  (
    select relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops' and c.relname = 'feature_flags'
  ),
  'ops.feature_flags has RLS enabled'
);

select ok(
  (
    select relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ops' and c.relname = 'system_settings'
  ),
  'ops.system_settings has RLS enabled'
);

select * from finish();

rollback;
