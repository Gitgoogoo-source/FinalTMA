-- Phase 4 / 11.1 task sign-in database acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

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

create or replace function testutil.signin_business_date()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Shanghai')::date;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

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
    'SIGNIN_11_1_DB_TEST',
    '11.1 Sign-in DB Test',
    'pgTAP coverage for 7-day sign-in, break-streak, duplicate sign-in and ledger',
    7,
    true,
    now() - interval '1 day',
    now() + interval '7 days',
    '{"test":"phase4_11_1_signin"}'::jsonb
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
    when day_index = 1 then '[{"currency":"KCOIN","amount":42}]'::jsonb
    when day_index = 2 then '[{"currency":"FGEMS","amount":7}]'::jsonb
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
    'SIGNIN_11_1_PROGRESS_TEST',
    'daily',
    '11.1 Sign-in Progress Test',
    'pgTAP daily check-in progress fixture',
    'daily',
    1,
    '[]'::jsonb,
    'none',
    true,
    '{"progress_source":"signin_success","test":"phase4_11_1_signin"}'::jsonb
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
values ('user', testutil.make_user(11110000001, 'tasks_signin_11_1_user', null));

insert into tasks.user_signin_states (
  user_id,
  campaign_id,
  current_streak,
  cycle_position,
  last_signin_date,
  total_signins
)
values (
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  4,
  4,
  testutil.signin_business_date() - 2,
  4
);

insert into _ids (key, txt) values ('signin_key', 'tasks-signin-11-1-001');
insert into _ids (key, payload)
select 'signin_first', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  date '2099-01-01',
  840,
  (select txt from _ids where key = 'signin_key')
);

select is((select count(*)::int from tasks.signin_days where campaign_id = (select id from _ids where key = 'campaign')), 7, 'sign-in campaign has 7 configured days');
select is(((select payload from _ids where key = 'signin_first') ->> 'day_index')::int, 1, 'break-streak sign-in resets to day 1');
select is(((select payload from _ids where key = 'signin_first') ->> 'current_streak')::int, 1, 'break-streak sign-in resets current streak');
select is(((select payload from _ids where key = 'signin_first') ->> 'already_claimed')::boolean, false, 'first sign-in is newly claimed');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 42::numeric, 'first sign-in credits configured KCOIN reward');
select is(
  (
    select count(*)::int
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = testutil.signin_business_date()
  ),
  1,
  'first sign-in writes one business-day user_signins row'
);
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'daily_check_in'
      and amount = 42
      and idempotency_key like 'daily_check_in:' || (select txt from _ids where key = 'signin_key') || ':%'
  ),
  1,
  'first sign-in writes one reward ledger row'
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
  'successful sign-in records daily task progress'
);

insert into _ids (key, payload)
select 'signin_cached', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  date '1999-01-01',
  -840,
  (select txt from _ids where key = 'signin_key')
);

select ok(((select payload from _ids where key = 'signin_cached') ->> 'idempotent')::boolean, 'same sign-in idempotency key returns cached response');

insert into _ids (key, payload)
select 'signin_duplicate', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'campaign'),
  testutil.signin_business_date(),
  0,
  'tasks-signin-11-1-duplicate'
);

select ok(((select payload from _ids where key = 'signin_duplicate') ->> 'already_claimed')::boolean, 'same-day sign-in with a new key returns already_claimed');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 42::numeric, 'duplicate sign-in does not credit balance again');
select is(
  (
    select count(*)::int
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = testutil.signin_business_date()
  ),
  1,
  'duplicate sign-in leaves one user_signins row'
);
select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'user')
      and source_type = 'daily_check_in'
      and amount = 42
  ),
  1,
  'duplicate sign-in leaves one reward ledger row'
);

select * from finish();

rollback;
