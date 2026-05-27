-- Phase 4 / 11.1 task reward claim database acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return lower(sqlerrm) like lower(p_pattern);
end;
$$;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_start_param text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := p_start_param,
    p_metadata := jsonb_build_object('test', true)
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(11110100001, 'tasks_claim_11_1_user', null));

with task_row as (
  insert into tasks.task_definitions (
    code,
    task_type,
    title,
    description,
    period_type,
    target_count,
    reward,
    action_type,
    active,
    metadata
  )
  values (
    'TASKS_CLAIM_11_1_TEST',
    'daily',
    '11.1 Task Claim Test',
    'pgTAP task claim fixture',
    'daily',
    2,
    '[{"currency":"KCOIN","amount":77}]'::jsonb,
    'open_box',
    true,
    '{"test":"phase4_11_1_claim"}'::jsonb
  )
  on conflict (code) do update
  set reward = excluded.reward,
      active = true,
      target_count = excluded.target_count,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'task', id from task_row;

insert into tasks.user_task_progress (
  user_id,
  task_id,
  period_key,
  progress_count,
  target_count,
  status
)
values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  'tasks-claim-11-1-incomplete',
  1,
  2,
  'in_progress'
);

select ok(
  testutil.raises_like(
    format(
      'select api.task_claim_reward(%L::uuid, %L::uuid, %L, %L)',
      (select id::text from _ids where key = 'user'),
      (select id::text from _ids where key = 'task'),
      'tasks-claim-11-1-incomplete',
      'tasks-claim-11-1-incomplete-key'
    ),
    '%task is not completed%'
  ),
  'incomplete task cannot be claimed'
);
select is(
  (
    select count(*)::int
    from tasks.task_claims
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'task')
  ),
  0,
  'incomplete claim does not create task_claims'
);
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'task_claim'
  ),
  0,
  'incomplete claim does not write ledger'
);

insert into tasks.user_task_progress (
  user_id,
  task_id,
  period_key,
  progress_count,
  target_count,
  status,
  completed_at
)
values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  'tasks-claim-11-1-completed',
  2,
  2,
  'completed',
  now()
);

insert into _ids (key, txt) values ('claim_key', 'tasks-claim-11-1-key');
insert into _ids (key, payload)
select 'claim_first', api.task_claim_reward(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  'tasks-claim-11-1-completed',
  (select txt from _ids where key = 'claim_key')
);
insert into _ids (key, id)
select 'claim_id', ((select payload from _ids where key = 'claim_first') ->> 'claim_id')::uuid;

select ok(((select payload from _ids where key = 'claim_first') ? 'claim_id'), 'completed task claim returns claim_id');
select is(
  (
    select status
    from tasks.user_task_progress
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'task')
      and period_key = 'tasks-claim-11-1-completed'
  ),
  'claimed',
  'successful claim marks task progress as claimed'
);
select is(
  (
    select count(*)::int
    from tasks.task_claims
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'task')
      and period_key = 'tasks-claim-11-1-completed'
  ),
  1,
  'successful claim creates one task_claims row'
);
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'successful claim credits KCOIN reward');
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'task_claim'
      and source_id = (select id from _ids where key = 'claim_id')
      and amount = 77
      and idempotency_key like 'task_claim:' || (select txt from _ids where key = 'claim_key') || ':%'
  ),
  1,
  'successful claim writes one reward ledger row'
);

insert into _ids (key, payload)
select 'claim_repeat_same_key', api.task_claim_reward(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  'tasks-claim-11-1-completed',
  (select txt from _ids where key = 'claim_key')
);
select ok(((select payload from _ids where key = 'claim_repeat_same_key') ->> 'idempotent')::boolean, 'same claim idempotency key returns cached response');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'same claim key does not credit again');

insert into _ids (key, payload)
select 'claim_repeat_new_key', api.task_claim_reward(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  'tasks-claim-11-1-completed',
  'tasks-claim-11-1-new-key'
);
select ok(((select payload from _ids where key = 'claim_repeat_new_key') ->> 'idempotent')::boolean, 'already claimed task returns idempotent result with a new key');
select is(
  (
    select count(*)::int
    from tasks.task_claims
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'task')
      and period_key = 'tasks-claim-11-1-completed'
  ),
  1,
  'repeat claim does not duplicate task_claims'
);
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'task_claim'
      and amount = 77
  ),
  1,
  'repeat claim does not duplicate ledger'
);

select ok(
  (
    position('pg_advisory_xact_lock' in pg_get_functiondef(to_regprocedure('api.task_claim_reward(uuid,uuid,text,text)'))) > 0
    and position('for update' in lower(pg_get_functiondef(to_regprocedure('api.task_claim_reward(uuid,uuid,text,text)')))) > 0
    and exists (
      select 1
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'tasks'
        and c.relname = 'task_claims'
        and con.conname = 'task_claims_user_id_task_id_period_key_key'
        and con.contype = 'u'
    )
  ),
  'task claim has transaction locks and unique claim guard for concurrent claims'
);

select * from finish();

rollback;
