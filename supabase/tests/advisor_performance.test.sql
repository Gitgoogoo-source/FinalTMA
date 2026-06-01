-- Verifies targeted Supabase performance advisor fixes.
-- Run after migrations and RLS files have been applied.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(6);

with target(schema_name, table_name, column_name) as (
  values
    ('core', 'app_sessions', 'session_token_hash'),
    ('core', 'app_sessions', 'user_id'),
    ('economy', 'user_balances', 'user_id'),
    ('economy', 'currency_ledger', 'user_id'),
    ('gacha', 'draw_orders', 'user_id'),
    ('gacha', 'draw_orders', 'box_id'),
    ('gacha', 'draw_orders', 'pool_version_id'),
    ('gacha', 'draw_results', 'draw_order_id'),
    ('gacha', 'draw_results', 'user_id'),
    ('gacha', 'draw_results', 'item_instance_id'),
    ('gacha', 'user_pity_states', 'user_id'),
    ('gacha', 'user_pity_states', 'box_id'),
    ('inventory', 'item_instances', 'owner_user_id'),
    ('inventory', 'item_instances', 'template_id'),
    ('inventory', 'item_instance_events', 'item_instance_id'),
    ('inventory', 'item_instance_events', 'user_id'),
    ('inventory', 'upgrade_logs', 'item_instance_id'),
    ('inventory', 'upgrade_logs', 'rule_id'),
    ('inventory', 'upgrade_logs', 'ledger_id'),
    ('inventory', 'decompose_logs', 'item_instance_id'),
    ('inventory', 'decompose_logs', 'rule_id'),
    ('inventory', 'decompose_logs', 'ledger_id'),
    ('inventory', 'evolution_attempts', 'rule_id'),
    ('inventory', 'evolution_attempts', 'main_item_instance_id'),
    ('inventory', 'evolution_attempts', 'result_item_instance_id'),
    ('inventory', 'evolution_attempts', 'ledger_id'),
    ('inventory', 'evolution_consumed_items', 'item_instance_id'),
    ('album', 'book_items', 'template_id'),
    ('album', 'books', 'series_id'),
    ('album', 'books', 'faction_id'),
    ('album', 'books', 'rarity_code'),
    ('album', 'milestone_claims', 'milestone_id'),
    ('album', 'score_rules', 'rarity_code'),
    ('album', 'user_discoveries', 'first_item_instance_id')
),
cols as (
  select
    target.schema_name,
    target.table_name,
    target.column_name,
    c.oid as table_oid,
    a.attnum as column_attnum
  from target
  left join pg_namespace n on n.nspname = target.schema_name
  left join pg_class c on c.relnamespace = n.oid and c.relname = target.table_name
  left join pg_attribute a on a.attrelid = c.oid and a.attname = target.column_name and a.attnum > 0 and not a.attisdropped
),
missing as (
  select schema_name, table_name, column_name
  from cols
  where table_oid is null
     or column_attnum is null
     or not exists (
       select 1
       from pg_index ix
       where ix.indrelid = cols.table_oid
         and ix.indisvalid
         and ix.indisready
         and ix.indkey[0] = cols.column_attnum
     )
)
select is(
  (select count(*)::integer from missing),
  0,
  'targeted advisor columns have leftmost covering indexes'
);

with policy_actions as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    r.role_name,
    a.action
  from pg_policies p
  cross join lateral unnest(p.roles) as r(role_name)
  cross join lateral unnest(
    case
      when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      else array[p.cmd]::text[]
    end
  ) as a(action)
  where p.schemaname in ('core', 'economy', 'catalog', 'gacha', 'inventory', 'market', 'payments', 'tasks', 'album', 'onchain', 'ops')
    and p.permissive = 'PERMISSIVE'
),
duplicate_policy_actions as (
  select schemaname, tablename, role_name, action
  from policy_actions
  group by schemaname, tablename, role_name, action
  having count(*) > 1
)
select is(
  (select count(*)::integer from duplicate_policy_actions),
  0,
  'no multiple permissive RLS policies remain per role/action/table'
);

select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname in ('core', 'economy', 'catalog', 'gacha', 'inventory', 'market', 'payments', 'tasks', 'album', 'onchain', 'ops')
      and (
        policyname like '%\_admin\_read' escape '\'
        or policyname like '%\_admin\_write' escape '\'
      )
  ),
  0,
  'direct authenticated admin read/write RLS policies are removed'
);

with target(schema_name, table_name, policy_name) as (
  values
    ('economy', 'reconciliation_runs', 'economy_reconciliation_runs_deny_client_access'),
    ('gacha', 'draw_audit', 'gacha_draw_audit_deny_client_access'),
    ('ops', 'admin_audit_logs', 'ops_admin_audit_logs_deny_client_access'),
    ('ops', 'admin_roles', 'ops_admin_roles_deny_client_access'),
    ('ops', 'admin_user_roles', 'ops_admin_user_roles_deny_client_access'),
    ('ops', 'api_rate_limits', 'ops_api_rate_limits_deny_client_access'),
    ('ops', 'feature_flags', 'ops_feature_flags_deny_client_access'),
    ('ops', 'idempotency_keys', 'ops_idempotency_keys_deny_client_access'),
    ('ops', 'risk_events', 'ops_risk_events_deny_client_access'),
    ('ops', 'system_settings', 'ops_system_settings_deny_client_access'),
    ('ops', 'telegram_init_data_consumptions', 'ops_telegram_init_data_consumptions_deny_client_access'),
    ('payments', 'telegram_webhook_events', 'payments_telegram_webhook_events_deny_client_access')
),
missing_explicit_deny as (
  select target.*
  from target
  left join pg_policies p
    on p.schemaname = target.schema_name
   and p.tablename = target.table_name
   and p.policyname = target.policy_name
   and p.permissive = 'RESTRICTIVE'
   and p.cmd = 'ALL'
   and p.roles @> array['anon', 'authenticated']::name[]
   and p.qual = 'false'
   and p.with_check = 'false'
  where p.policyname is null
)
select is(
  (select count(*)::integer from missing_explicit_deny),
  0,
  'advisor RLS no-policy targets have explicit restrictive deny policies'
);

with target(schema_name, table_name) as (
  values
    ('economy', 'reconciliation_runs'),
    ('gacha', 'draw_audit'),
    ('ops', 'admin_audit_logs'),
    ('ops', 'admin_roles'),
    ('ops', 'admin_user_roles'),
    ('ops', 'api_rate_limits'),
    ('ops', 'feature_flags'),
    ('ops', 'idempotency_keys'),
    ('ops', 'risk_events'),
    ('ops', 'system_settings'),
    ('ops', 'telegram_init_data_consumptions'),
    ('payments', 'telegram_webhook_events')
),
target_state as (
  select
    target.schema_name,
    target.table_name,
    c.relrowsecurity as rls_enabled,
    (
      select count(*)::integer
      from pg_policies p
      where p.schemaname = target.schema_name
        and p.tablename = target.table_name
    ) as policy_count
  from target
  join pg_namespace n on n.nspname = target.schema_name
  join pg_class c on c.relnamespace = n.oid and c.relname = target.table_name
)
select is(
  (
    select count(*)::integer
    from target_state
    where not rls_enabled
       or policy_count = 0
  ),
  0,
  'advisor targets keep RLS enabled and no longer have zero policies'
);

with target(schema_name, table_name) as (
  values
    ('economy', 'reconciliation_runs'),
    ('gacha', 'draw_audit'),
    ('ops', 'admin_audit_logs'),
    ('ops', 'admin_roles'),
    ('ops', 'admin_user_roles'),
    ('ops', 'api_rate_limits'),
    ('ops', 'feature_flags'),
    ('ops', 'idempotency_keys'),
    ('ops', 'risk_events'),
    ('ops', 'system_settings'),
    ('ops', 'telegram_init_data_consumptions'),
    ('payments', 'telegram_webhook_events')
),
table_privileges as (
  select target.schema_name, target.table_name, roles.role_name, privileges.privilege_name
  from target
  cross join (values ('anon'), ('authenticated')) as roles(role_name)
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
  cross join (values ('anon'), ('authenticated')) as roles(role_name)
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
  'anon/authenticated have no direct table or column privileges on internal advisor targets'
);

select * from finish();

rollback;
