-- Phase 4 / 8.3 sign-in transaction acceptance checks.

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
    where user_id = p_user_id and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

create or replace function testutil.signin_business_date()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Shanghai')::date;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
create temp table _numbers (key text primary key, amount numeric) on commit drop;
create temp table _repeat_results (attempt integer primary key, payload jsonb) on commit drop;

with campaign as (
  insert into tasks.signin_campaigns (
    code,
    title,
    description,
    cycle_days,
    active,
    starts_at,
    ends_at,
    metadata
  )
  values (
    'SIGNIN_TRANSACTION_8_3_TEST',
    '8.3 Sign-in Transaction Test',
    'pgTAP coverage for sign-in transaction, ledger and duplicate-click guards',
    7,
    true,
    now() - interval '1 day',
    now() + interval '7 days',
    '{"test":"phase4_8_3"}'::jsonb
  )
  on conflict (code) do update
  set active = true,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      cycle_days = excluded.cycle_days,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'campaign', id from campaign;

insert into tasks.signin_days (campaign_id, day_index, reward, title)
select
  (select id from _ids where key = 'campaign'),
  day_index,
  case
    when day_index = 1 then '[{"currency":"KCOIN","amount":88}]'::jsonb
    else '[]'::jsonb
  end,
  'Day ' || day_index::text
from generate_series(1, 7) as gs(day_index)
on conflict (campaign_id, day_index) do update
set reward = excluded.reward,
    title = excluded.title;

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
    'SIGNIN_TRANSACTION_8_3_PROGRESS_TEST',
    'daily',
    '8.3 Check-in Progress Test',
    'pgTAP daily check-in transaction progress task',
    'daily',
    1,
    '[]'::jsonb,
    'none',
    true,
    '{"progress_source":"signin_success","test":"phase4_8_3"}'::jsonb
  )
  on conflict (code) do update
  set active = true,
      target_count = 1,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'signin_task', id from task_row;

insert into _ids (key, id)
values ('user', testutil.make_user(10830000001, 'signin_transaction_user', null));
insert into _numbers (key, amount)
values ('kcoin_before', testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'));
insert into _ids (key, txt) values ('signin_key', 'signin-8-3-tx-001');

insert into _ids (key, payload)
select 'signin_first', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  date '2099-01-01',
  0,
  (select txt from _ids where key = 'signin_key')
);

insert into _ids (key, id)
select 'signin_id', ((select payload from _ids where key = 'signin_first') ->> 'signin_id')::uuid;

select is(((select payload from _ids where key = 'signin_first') ->> 'already_claimed')::boolean, false, 'first sign-in is claimed');
select is(((select payload from _ids where key = 'signin_first') ->> 'day_index')::integer, 1, 'first sign-in uses day 1 reward');
select is(jsonb_array_length((select payload -> 'ledger_results' from _ids where key = 'signin_first')), 1, 'first sign-in returns one ledger result');
select is(
  ((select payload from _ids where key = 'signin_first') #>> '{ledger_results,0,available_after}')::numeric,
  (select amount + 88 from _numbers where key = 'kcoin_before'),
  'first sign-in returns the new KCOIN balance through ledger_results'
);
select is(
  testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'),
  (select amount + 88 from _numbers where key = 'kcoin_before'),
  'first sign-in credits the configured KCOIN reward'
);
select is(
  (
    select count(*)::integer
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = testutil.signin_business_date()
  ),
  1,
  'first sign-in creates one user_signins row'
);
select is(
  (
    select count(*)::integer
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = date '2099-01-01'
  ),
  0,
  'first sign-in ignores the client-supplied date'
);
select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'daily_check_in'
      and source_id = (select id from _ids where key = 'signin_id')
      and amount = 88
  ),
  1,
  'first sign-in creates one daily_check_in ledger row'
);
select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where idempotency_key like 'daily_check_in:' || (select txt from _ids where key = 'signin_key') || ':%'
  ),
  1,
  'first sign-in ledger row uses the request idempotency key'
);
select is(
  (
    select status
    from tasks.user_task_progress
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'signin_task')
      and period_key = testutil.signin_business_date()::text
  ),
  'completed',
  'first sign-in records daily check-in task progress'
);
select is(
  (
    select jsonb_array_length(source_events)
    from tasks.user_task_progress
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'signin_task')
      and period_key = testutil.signin_business_date()::text
  ),
  1,
  'first sign-in stores one task progress source event'
);

insert into _repeat_results (attempt, payload)
select
  attempt,
  api.task_daily_check_in(
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'campaign'),
    date '2099-01-02',
    840,
    'signin-8-3-tx-repeat-' || attempt::text
  )
from generate_series(1, 10) as gs(attempt);

select is(
  (
    select count(*)::integer
    from _repeat_results
    where (payload ->> 'already_claimed')::boolean = true
      and (payload ->> 'signin_id')::uuid = (select id from _ids where key = 'signin_id')
  ),
  10,
  'ten same-day retry attempts all return already_claimed for the original sign-in'
);
select is(
  (
    select count(*)::integer
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = testutil.signin_business_date()
  ),
  1,
  'ten same-day retry attempts still leave one user_signins row'
);
select is(
  (
    select count(*)::integer
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'daily_check_in'
      and source_id = (select id from _ids where key = 'signin_id')
      and amount = 88
  ),
  1,
  'ten same-day retry attempts still leave one reward ledger row'
);
select is(
  testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'),
  (select amount + 88 from _numbers where key = 'kcoin_before'),
  'ten same-day retry attempts do not credit the balance again'
);
select is(
  (
    select jsonb_array_length(source_events)
    from tasks.user_task_progress
    where user_id = (select id from _ids where key = 'user')
      and task_id = (select id from _ids where key = 'signin_task')
      and period_key = testutil.signin_business_date()::text
  ),
  1,
  'ten same-day retry attempts do not duplicate task progress source events'
);

insert into _ids (key, payload)
select 'signin_cached', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  date '1999-01-01',
  -840,
  (select txt from _ids where key = 'signin_key')
);

select ok(((select payload from _ids where key = 'signin_cached') ->> 'idempotent')::boolean, 'same idempotency key returns cached response even when client date changes');

select ok(
  (
    select position('for update' in lower(pg_get_functiondef(to_regprocedure('api.task_daily_check_in(uuid,uuid,date,integer,text)')))) > 0
      and position('pg_advisory_xact_lock' in pg_get_functiondef(to_regprocedure('api.task_daily_check_in(uuid,uuid,date,integer,text)'))) > 0
      and position('ops.idempotency_keys' in pg_get_functiondef(to_regprocedure('api.task_daily_check_in(uuid,uuid,date,integer,text)'))) > 0
      and position('api._apply_reward_json' in pg_get_functiondef(to_regprocedure('api.task_daily_check_in(uuid,uuid,date,integer,text)'))) > 0
      and position('api.task_record_progress' in pg_get_functiondef(to_regprocedure('api.task_daily_check_in(uuid,uuid,date,integer,text)'))) > 0
  ),
  'task_daily_check_in keeps transaction locks, idempotency, reward helper and progress update in the function body'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'tasks'
      and tablename = 'user_signins'
      and indexname = 'user_signins_user_id_campaign_id_signin_date_key'
  ),
  'user_signins has the user-campaign-date uniqueness guard'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'economy'
      and tablename = 'currency_ledger'
      and indexname = 'currency_ledger_idempotency_key_key'
  ),
  'currency_ledger has the idempotency uniqueness guard'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'tasks'
      and tablename = 'user_signin_states'
      and indexname = 'user_signin_states_pkey'
  ),
  'user_signin_states has the per-user campaign state lock target'
);
select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'ops'
      and tablename = 'idempotency_keys'
      and indexname = 'idempotency_keys_pkey'
  ),
  'ops.idempotency_keys has the request idempotency uniqueness guard'
);

select * from finish();

rollback;
