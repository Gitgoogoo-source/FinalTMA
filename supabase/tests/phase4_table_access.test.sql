-- Phase 4 4.1 table access level acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, tasks, ops;

select no_plan();

with target(schema_name, table_name, authenticated_can_select) as (
  values
    ('tasks', 'task_definitions', true),
    ('tasks', 'task_periods', true),
    ('tasks', 'user_task_progress', true),
    ('tasks', 'task_claims', true),
    ('tasks', 'signin_campaigns', true),
    ('tasks', 'signin_days', true),
    ('tasks', 'user_signins', true),
    ('tasks', 'referrals', true),
    ('tasks', 'referral_rewards', true),
    ('tasks', 'referral_commissions', true),
    ('tasks', 'share_events', true),
    ('economy', 'user_balances', true),
    ('economy', 'currency_ledger', true),
    ('ops', 'risk_events', false),
    ('ops', 'idempotency_keys', false)
),
missing as (
  select target.*
  from target
  left join pg_namespace n on n.nspname = target.schema_name
  left join pg_class c on c.relnamespace = n.oid
    and c.relname = target.table_name
    and c.relkind in ('r', 'p')
  where c.oid is null
)
select is(
  (select count(*)::integer from missing),
  0,
  'all Phase 4.1 target tables exist'
);

with target(schema_name, table_name) as (
  values
    ('tasks', 'task_definitions'),
    ('tasks', 'task_periods'),
    ('tasks', 'user_task_progress'),
    ('tasks', 'task_claims'),
    ('tasks', 'signin_campaigns'),
    ('tasks', 'signin_days'),
    ('tasks', 'user_signins'),
    ('tasks', 'referrals'),
    ('tasks', 'referral_rewards'),
    ('tasks', 'referral_commissions'),
    ('tasks', 'share_events'),
    ('economy', 'user_balances'),
    ('economy', 'currency_ledger'),
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
without_rls as (
  select target.*
  from target
  join pg_namespace n on n.nspname = target.schema_name
  join pg_class c on c.relnamespace = n.oid and c.relname = target.table_name
  where not c.relrowsecurity
)
select is(
  (select count(*)::integer from without_rls),
  0,
  'all Phase 4.1 target tables have RLS enabled'
);

with target(schema_name, table_name, authenticated_can_select) as (
  values
    ('tasks', 'task_definitions', true),
    ('tasks', 'task_periods', true),
    ('tasks', 'user_task_progress', true),
    ('tasks', 'task_claims', true),
    ('tasks', 'signin_campaigns', true),
    ('tasks', 'signin_days', true),
    ('tasks', 'user_signins', true),
    ('tasks', 'referrals', true),
    ('tasks', 'referral_rewards', true),
    ('tasks', 'referral_commissions', true),
    ('tasks', 'share_events', true),
    ('economy', 'user_balances', true),
    ('economy', 'currency_ledger', true),
    ('ops', 'risk_events', false),
    ('ops', 'idempotency_keys', false)
),
mismatch as (
  select *
  from target
  where has_table_privilege(
    'authenticated',
    format('%I.%I', schema_name, table_name),
    'SELECT'
  ) is distinct from authenticated_can_select
)
select is(
  (select count(*)::integer from mismatch),
  0,
  'authenticated SELECT grants match the Phase 4.1 frontend-read matrix'
);

with target(schema_name, table_name) as (
  values
    ('tasks', 'task_definitions'),
    ('tasks', 'task_periods'),
    ('tasks', 'user_task_progress'),
    ('tasks', 'task_claims'),
    ('tasks', 'signin_campaigns'),
    ('tasks', 'signin_days'),
    ('tasks', 'user_signins'),
    ('tasks', 'referrals'),
    ('tasks', 'referral_rewards'),
    ('tasks', 'referral_commissions'),
    ('tasks', 'share_events'),
    ('economy', 'user_balances'),
    ('economy', 'currency_ledger'),
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
direct_writes as (
  select target.schema_name, target.table_name, roles.role_name, privileges.privilege_name
  from target
  cross join (values ('anon'), ('authenticated')) as roles(role_name)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) as privileges(privilege_name)
  where has_table_privilege(
    roles.role_name,
    format('%I.%I', target.schema_name, target.table_name),
    privileges.privilege_name
  )
)
select is(
  (select count(*)::integer from direct_writes),
  0,
  'anon/authenticated have no direct write grants on Phase 4.1 target tables'
);

with target(schema_name, table_name) as (
  values
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
roles(role_name) as (
  values ('anon'), ('authenticated')
),
table_privileges as (
  select target.schema_name, target.table_name, roles.role_name, privileges.privilege_name
  from target
  cross join roles
  cross join (
    values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('DELETE'),
      ('TRUNCATE'),
      ('REFERENCES'),
      ('TRIGGER')
  ) as privileges(privilege_name)
  where has_table_privilege(
    roles.role_name,
    format('%I.%I', target.schema_name, target.table_name),
    privileges.privilege_name
  )
),
column_privileges as (
  select target.schema_name, target.table_name, roles.role_name, privileges.privilege_name
  from target
  cross join roles
  cross join (
    values
      ('SELECT'),
      ('INSERT'),
      ('UPDATE'),
      ('REFERENCES')
  ) as privileges(privilege_name)
  where has_any_column_privilege(
    roles.role_name,
    format('%I.%I', target.schema_name, target.table_name),
    privileges.privilege_name
  )
)
select is(
  (
    select count(*)::integer
    from (
      select * from table_privileges
      union all
      select * from column_privileges
    ) leaked_privileges
  ),
  0,
  'ops risk/idempotency tables are not directly accessible to browser roles'
);

with target(schema_name, table_name) as (
  values
    ('tasks', 'task_definitions'),
    ('tasks', 'task_periods'),
    ('tasks', 'user_task_progress'),
    ('tasks', 'task_claims'),
    ('tasks', 'signin_campaigns'),
    ('tasks', 'signin_days'),
    ('tasks', 'user_signins'),
    ('tasks', 'referrals'),
    ('tasks', 'referral_rewards'),
    ('tasks', 'referral_commissions'),
    ('tasks', 'share_events'),
    ('economy', 'user_balances'),
    ('economy', 'currency_ledger'),
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
missing_service_privileges as (
  select target.schema_name, target.table_name, privileges.privilege_name
  from target
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privileges(privilege_name)
  where not has_table_privilege(
    'service_role',
    format('%I.%I', target.schema_name, target.table_name),
    privileges.privilege_name
  )
)
select is(
  (select count(*)::integer from missing_service_privileges),
  0,
  'service_role keeps backend/API/RPC access to Phase 4.1 target tables'
);

with expected_policy(schema_name, table_name, policy_name, command, permissive, expected_roles) as (
  values
    ('tasks', 'task_definitions', 'tasks_definitions_read_active', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'task_periods', 'tasks_periods_read_active', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'user_task_progress', 'tasks_progress_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'task_claims', 'tasks_claims_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'signin_campaigns', 'tasks_signin_campaigns_read_active', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'signin_days', 'tasks_signin_days_read_active', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'user_signins', 'tasks_user_signins_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'referrals', 'tasks_referrals_select_party', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'referral_rewards', 'tasks_referral_rewards_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'referral_commissions', 'tasks_commissions_select_inviter', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('tasks', 'share_events', 'tasks_share_events_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('economy', 'user_balances', 'economy_balances_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('economy', 'currency_ledger', 'economy_ledger_select_own', 'SELECT', 'PERMISSIVE', array['authenticated']::name[]),
    ('ops', 'risk_events', 'ops_risk_events_deny_client_access', 'ALL', 'RESTRICTIVE', array['anon', 'authenticated']::name[]),
    ('ops', 'idempotency_keys', 'ops_idempotency_keys_deny_client_access', 'ALL', 'RESTRICTIVE', array['anon', 'authenticated']::name[])
),
missing_policy as (
  select expected_policy.*
  from expected_policy
  left join pg_policies p
    on p.schemaname = expected_policy.schema_name
   and p.tablename = expected_policy.table_name
   and p.policyname = expected_policy.policy_name
   and p.cmd = expected_policy.command
   and p.permissive = expected_policy.permissive
   and p.roles @> expected_policy.expected_roles
  where p.policyname is null
)
select is(
  (select count(*)::integer from missing_policy),
  0,
  'Phase 4.1 target tables have the expected read or deny policies'
);

select ok(
  coalesce((
    select p.qual
    from pg_policies p
    where p.schemaname = 'tasks'
      and p.tablename = 'task_definitions'
      and p.policyname = 'tasks_definitions_read_active'
  ), '') like '%starts_at%'
  and coalesce((
    select p.qual
    from pg_policies p
    where p.schemaname = 'tasks'
      and p.tablename = 'task_definitions'
      and p.policyname = 'tasks_definitions_read_active'
  ), '') like '%ends_at%',
  'task_definitions public read is limited to active time windows'
);

select ok(
  coalesce((
    select p.qual
    from pg_policies p
    where p.schemaname = 'tasks'
      and p.tablename = 'signin_days'
      and p.policyname = 'tasks_signin_days_read_active'
  ), '') like '%signin_campaigns%'
  and coalesce((
    select p.qual
    from pg_policies p
    where p.schemaname = 'tasks'
      and p.tablename = 'signin_days'
      and p.policyname = 'tasks_signin_days_read_active'
  ), '') like '%active%',
  'signin_days public read is limited through active campaigns'
);

with forbidden_policy(schema_name, table_name, policy_name) as (
  values
    ('tasks', 'share_events', 'tasks_share_events_insert_own'),
    ('tasks', 'signin_days', 'tasks_signin_days_read')
),
present_policy as (
  select forbidden_policy.*
  from forbidden_policy
  join pg_policies p
    on p.schemaname = forbidden_policy.schema_name
   and p.tablename = forbidden_policy.table_name
   and p.policyname = forbidden_policy.policy_name
)
select is(
  (select count(*)::integer from present_policy),
  0,
  'obsolete direct-write or overly broad Phase 4.1 policies are absent'
);

with target(schema_name, table_name) as (
  values
    ('tasks', 'task_definitions'),
    ('tasks', 'task_periods'),
    ('tasks', 'user_task_progress'),
    ('tasks', 'task_claims'),
    ('tasks', 'signin_campaigns'),
    ('tasks', 'signin_days'),
    ('tasks', 'user_signins'),
    ('tasks', 'referrals'),
    ('tasks', 'referral_rewards'),
    ('tasks', 'referral_commissions'),
    ('tasks', 'share_events'),
    ('economy', 'user_balances'),
    ('economy', 'currency_ledger'),
    ('ops', 'risk_events'),
    ('ops', 'idempotency_keys')
),
admin_policy as (
  select p.*
  from target
  join pg_policies p
    on p.schemaname = target.schema_name
   and p.tablename = target.table_name
  where p.policyname like '%\_admin\_read' escape '\'
     or p.policyname like '%\_admin\_write' escape '\'
)
select is(
  (select count(*)::integer from admin_policy),
  0,
  'Phase 4.1 target tables do not expose direct authenticated admin policies'
);

select * from finish();

rollback;
