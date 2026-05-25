-- Fourth stage 2.2 constraint acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions;

select no_plan();

with expected_constraints(schema_name, table_name, contype, columns) as (
  values
    ('tasks', 'user_task_progress', 'u', array['user_id', 'task_id', 'period_key']::text[]),
    ('tasks', 'task_claims', 'u', array['user_id', 'task_id', 'period_key']::text[]),
    ('tasks', 'user_signins', 'u', array['user_id', 'campaign_id', 'signin_date']::text[]),
    ('tasks', 'signin_days', 'u', array['campaign_id', 'day_index']::text[]),
    ('tasks', 'referrals', 'u', array['invitee_user_id']::text[]),
    ('tasks', 'referral_rewards', 'u', array['referral_id', 'reward_role']::text[]),
    ('tasks', 'referral_commissions', 'u', array['referral_id', 'source_type', 'source_id']::text[]),
    ('economy', 'currency_ledger', 'u', array['idempotency_key']::text[]),
    ('ops', 'idempotency_keys', 'p', array['key']::text[])
),
actual_constraints as (
  select
    nsp.nspname as schema_name,
    rel.relname as table_name,
    con.contype,
    array_agg(att.attname::text order by key_column.ord)::text[] as columns
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join unnest(con.conkey) with ordinality as key_column(attnum, ord) on true
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = key_column.attnum
  where con.contype in ('p', 'u')
  group by nsp.nspname, rel.relname, con.contype, con.conname
)
select ok(
  exists (
    select 1
    from actual_constraints actual
    where actual.schema_name = expected.schema_name
      and actual.table_name = expected.table_name
      and actual.contype = expected.contype
      and actual.columns = expected.columns
  ),
  format(
    '%s.%s has %s constraint on (%s)',
    expected.schema_name,
    expected.table_name,
    case expected.contype when 'p' then 'primary key' else 'unique' end,
    array_to_string(expected.columns, ', ')
  )
)
from expected_constraints expected;

select * from finish();

rollback;
