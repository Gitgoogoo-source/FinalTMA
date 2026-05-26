-- Phase 4 4.2 RPC-only operation boundary checks.
-- These tests lock the client-facing boundary: browser roles cannot directly
-- mutate the tables behind these operations, and the operation RPCs are only
-- executable by the trusted service role.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, tasks, ops, api;

select no_plan();

with required_rpc(operation_name, signature) as (
  values
    ('signin', 'api.task_daily_check_in(uuid)'),
    ('signin', 'api.task_daily_check_in(uuid,uuid,date,integer,text)'),
    ('task_progress_update', 'api.task_record_progress(uuid,text,integer,uuid,text)'),
    ('task_reward_claim', 'api.task_claim_reward(uuid,uuid,text,text)'),
    ('referral_bind', 'api.referral_bind_inviter(uuid,text,text,jsonb)'),
    ('first_open_reward', 'api.referral_process_first_open(uuid,uuid)'),
    ('commission_generate', 'api.referral_create_commission(uuid,uuid,numeric,integer)'),
    ('commission_claim', 'api.referral_claim_commission(uuid,uuid[],text)')
),
resolved_rpc as (
  select operation_name, signature, to_regprocedure(signature) as regprocedure
  from required_rpc
),
missing_rpc as (
  select *
  from resolved_rpc
  where regprocedure is null
)
select is(
  (select count(*)::integer from missing_rpc),
  0,
  'all Phase 4.2 operation RPCs exist'
);

with required_rpc(operation_name, signature) as (
  values
    ('signin', 'api.task_daily_check_in(uuid)'),
    ('signin', 'api.task_daily_check_in(uuid,uuid,date,integer,text)'),
    ('task_progress_update', 'api.task_record_progress(uuid,text,integer,uuid,text)'),
    ('task_reward_claim', 'api.task_claim_reward(uuid,uuid,text,text)'),
    ('referral_bind', 'api.referral_bind_inviter(uuid,text,text,jsonb)'),
    ('first_open_reward', 'api.referral_process_first_open(uuid,uuid)'),
    ('commission_generate', 'api.referral_create_commission(uuid,uuid,numeric,integer)'),
    ('commission_claim', 'api.referral_claim_commission(uuid,uuid[],text)')
),
resolved_rpc as (
  select operation_name, signature, to_regprocedure(signature) as regprocedure
  from required_rpc
),
privilege_mismatch as (
  select operation_name, signature
  from resolved_rpc
  where regprocedure is not null
    and (
      not has_function_privilege('service_role', regprocedure, 'EXECUTE')
      or has_function_privilege('public', regprocedure, 'EXECUTE')
      or has_function_privilege('anon', regprocedure, 'EXECUTE')
      or has_function_privilege('authenticated', regprocedure, 'EXECUTE')
    )
)
select is(
  (select count(*)::integer from privilege_mismatch),
  0,
  'Phase 4.2 operation RPCs are service-role only'
);

with target_table(operation_name, schema_name, table_name) as (
  values
    ('signin', 'tasks', 'user_signins'),
    ('signin', 'tasks', 'user_signin_states'),
    ('signin', 'economy', 'currency_ledger'),
    ('signin', 'economy', 'user_balances'),
    ('signin', 'ops', 'idempotency_keys'),
    ('task_progress_update', 'tasks', 'user_task_progress'),
    ('task_progress_update', 'ops', 'idempotency_keys'),
    ('task_reward_claim', 'tasks', 'user_task_progress'),
    ('task_reward_claim', 'tasks', 'task_claims'),
    ('task_reward_claim', 'economy', 'currency_ledger'),
    ('task_reward_claim', 'economy', 'user_balances'),
    ('task_reward_claim', 'ops', 'idempotency_keys'),
    ('referral_bind', 'tasks', 'referrals'),
    ('referral_bind', 'ops', 'risk_events'),
    ('referral_bind', 'ops', 'idempotency_keys'),
    ('first_open_reward', 'tasks', 'referrals'),
    ('first_open_reward', 'tasks', 'referral_rewards'),
    ('first_open_reward', 'economy', 'currency_ledger'),
    ('first_open_reward', 'economy', 'user_balances'),
    ('commission_generate', 'tasks', 'referral_commissions'),
    ('commission_claim', 'tasks', 'referral_commissions'),
    ('commission_claim', 'economy', 'currency_ledger'),
    ('commission_claim', 'economy', 'user_balances'),
    ('commission_claim', 'ops', 'idempotency_keys'),
    ('risk_event_write', 'ops', 'risk_events')
),
resolved_table as (
  select
    operation_name,
    schema_name,
    table_name,
    to_regclass(format('%I.%I', schema_name, table_name)) as regclass
  from target_table
),
missing_table as (
  select *
  from resolved_table
  where regclass is null
)
select is(
  (select count(*)::integer from missing_table),
  0,
  'all Phase 4.2 operation backing tables exist'
);

with target_table(operation_name, schema_name, table_name) as (
  values
    ('signin', 'tasks', 'user_signins'),
    ('signin', 'tasks', 'user_signin_states'),
    ('signin', 'economy', 'currency_ledger'),
    ('signin', 'economy', 'user_balances'),
    ('signin', 'ops', 'idempotency_keys'),
    ('task_progress_update', 'tasks', 'user_task_progress'),
    ('task_progress_update', 'ops', 'idempotency_keys'),
    ('task_reward_claim', 'tasks', 'user_task_progress'),
    ('task_reward_claim', 'tasks', 'task_claims'),
    ('task_reward_claim', 'economy', 'currency_ledger'),
    ('task_reward_claim', 'economy', 'user_balances'),
    ('task_reward_claim', 'ops', 'idempotency_keys'),
    ('referral_bind', 'tasks', 'referrals'),
    ('referral_bind', 'ops', 'risk_events'),
    ('referral_bind', 'ops', 'idempotency_keys'),
    ('first_open_reward', 'tasks', 'referrals'),
    ('first_open_reward', 'tasks', 'referral_rewards'),
    ('first_open_reward', 'economy', 'currency_ledger'),
    ('first_open_reward', 'economy', 'user_balances'),
    ('commission_generate', 'tasks', 'referral_commissions'),
    ('commission_claim', 'tasks', 'referral_commissions'),
    ('commission_claim', 'economy', 'currency_ledger'),
    ('commission_claim', 'economy', 'user_balances'),
    ('commission_claim', 'ops', 'idempotency_keys'),
    ('risk_event_write', 'ops', 'risk_events')
),
resolved_table as (
  select
    operation_name,
    schema_name,
    table_name,
    to_regclass(format('%I.%I', schema_name, table_name)) as regclass
  from target_table
),
direct_write_leak as (
  select distinct
    resolved_table.operation_name,
    resolved_table.schema_name,
    resolved_table.table_name,
    roles.role_name,
    privileges.privilege_name
  from resolved_table
  cross join (values ('anon'), ('authenticated')) as roles(role_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as privileges(privilege_name)
  where resolved_table.regclass is not null
    and has_table_privilege(roles.role_name, resolved_table.regclass, privileges.privilege_name)
)
select is(
  (select count(*)::integer from direct_write_leak),
  0,
  'anon/authenticated cannot directly write Phase 4.2 operation backing tables'
);

select * from finish();

rollback;
