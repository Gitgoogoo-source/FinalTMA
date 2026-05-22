-- Verifies first-stage Supabase performance advisor fixes.
-- Run after migrations and RLS files have been applied.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(3);

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
    ('inventory', 'item_instance_events', 'user_id')
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
  'high-priority advisor columns have leftmost covering indexes'
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

select * from finish();

rollback;
