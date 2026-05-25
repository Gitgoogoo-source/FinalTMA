-- Phase 4 task field structure checks.
-- Covers 第四阶段规划.md / 2.3 only.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'task_claims'
      and column_name = 'idempotency_key'
      and data_type = 'text'
  ),
  'task_claims has idempotency_key'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'task_claims'
      and column_name = 'request_fingerprint'
      and data_type = 'text'
  ),
  'task_claims has request_fingerprint'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'tasks'
      and tablename = 'task_claims'
      and indexname = 'task_claims_idempotency_key_uidx'
      and indexdef like '%WHERE (idempotency_key IS NOT NULL)%'
  ),
  'task_claims idempotency key is guarded by a partial unique index'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signins'
      and column_name = 'idempotency_key'
      and data_type = 'text'
  ),
  'user_signins has idempotency_key'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signins'
      and column_name = 'request_fingerprint'
      and data_type = 'text'
  ),
  'user_signins has request_fingerprint'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'tasks'
      and tablename = 'user_signins'
      and indexname = 'user_signins_idempotency_key_uidx'
      and indexdef like '%WHERE (idempotency_key IS NOT NULL)%'
  ),
  'user_signins idempotency key is guarded by a partial unique index'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'referral_commissions'
      and column_name = 'claimed_at'
      and data_type = 'timestamp with time zone'
  ),
  'referral_commissions has claimed_at'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'share_events'
      and column_name = 'idempotency_key'
      and data_type = 'text'
  ),
  'share_events has idempotency_key'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'tasks'
      and tablename = 'share_events'
      and indexname = 'share_events_idempotency_key_uidx'
      and indexdef like '%WHERE (idempotency_key IS NOT NULL)%'
  ),
  'share_events idempotency key is guarded by a partial unique index'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_task_progress'
      and column_name = 'source_events'
      and data_type = 'jsonb'
      and is_nullable = 'NO'
      and column_default = '''[]''::jsonb'
  ),
  'user_task_progress has non-null source_events jsonb defaulting to an empty array'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'tasks.user_task_progress'::regclass
      and conname = 'user_task_progress_source_events_array_check'
  ),
  'user_task_progress source_events must be a JSON array'
);

select ok(
  to_regclass('tasks.user_signin_states') is not null,
  'user_signin_states table exists'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'user_id'
      and data_type = 'uuid'
  ),
  'user_signin_states has user_id'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'campaign_id'
      and data_type = 'uuid'
  ),
  'user_signin_states has campaign_id'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'current_streak'
      and data_type = 'integer'
      and column_default = '0'
  ),
  'user_signin_states has current_streak'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'cycle_position'
      and data_type = 'integer'
      and column_default = '0'
  ),
  'user_signin_states has cycle_position'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'last_signin_date'
      and data_type = 'date'
  ),
  'user_signin_states has last_signin_date'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'tasks'
      and table_name = 'user_signin_states'
      and column_name = 'total_signins'
      and data_type = 'integer'
      and column_default = '0'
  ),
  'user_signin_states has total_signins'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'tasks.user_signin_states'::regclass
      and conname = 'user_signin_states_pkey'
      and contype = 'p'
  ),
  'user_signin_states has a primary key'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'tasks.user_signin_states'::regclass),
  'user_signin_states has RLS enabled'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'tasks'
      and tablename = 'user_signin_states'
      and policyname = 'tasks_user_signin_states_select_own'
  ),
  'user_signin_states has owner read policy'
);

select ok(
  has_table_privilege('authenticated', 'tasks.user_signin_states', 'SELECT'),
  'authenticated can select user_signin_states through RLS'
);

select ok(
  not has_table_privilege('authenticated', 'tasks.user_signin_states', 'INSERT'),
  'authenticated cannot insert user_signin_states directly'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'tasks.user_signin_states'::regclass
      and tgname = 'user_signin_states_set_updated_at'
      and not tgisinternal
  ),
  'user_signin_states has updated_at trigger'
);

select * from finish();

rollback;
