-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

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
insert into _ids (key, id) values ('user', testutil.make_user(10000000001, 'task_claim_user', null));

with task_row as (
  insert into tasks.task_definitions (code, task_type, title, description, period_type, target_count, reward, action_type, active)
  values ('TAP_TASK_CLAIM_TEST', 'daily', 'Claim Test', 'pgTAP task claim', 'daily', 1, '[{"currency":"KCOIN","amount":77}]'::jsonb, 'open_box', true)
  on conflict (code) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'task', id from task_row;

insert into tasks.user_task_progress (user_id, task_id, period_key, progress_count, target_count, status, completed_at)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), '2026-05-20', 1, 1, 'completed', now())
on conflict (user_id, task_id, period_key) do update set status = 'completed', progress_count = 1, completed_at = now(), updated_at = now();

insert into _ids (key, txt) values ('claim_key', 'task-claim-idem-001');
insert into _ids (key, payload)
select 'claim1', api.task_claim_reward(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  '2026-05-20',
  (select txt from _ids where key = 'claim_key')
);
select ok(((select payload from _ids where key = 'claim1') ? 'claim_id'), 'task claim returns claim_id');
select is((select status from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), 'claimed', 'task progress becomes claimed');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'task reward credits KCOIN');
select is((select count(*)::int from tasks.task_claims where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), 1, 'one task claim row is created');
select is((select idempotency_key from tasks.task_claims where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), (select txt from _ids where key = 'claim_key'), 'task claim stores idempotency_key');
select ok((select request_fingerprint is not null from tasks.task_claims where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), 'task claim stores request_fingerprint');
select is((select count(*)::int from ops.idempotency_keys where key = 'task_claim_reward:' || (select txt from _ids where key = 'claim_key') and status = 'completed'), 1, 'task claim stores completed API idempotency key');
select is((select count(*)::int from economy.currency_ledger where idempotency_key like 'task_claim:' || (select txt from _ids where key = 'claim_key') || ':%'), 1, 'task claim ledger key uses idempotency prefix');

insert into _ids (key, payload)
select 'claim_repeat', api.task_claim_reward(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'task'),
  '2026-05-20',
  (select txt from _ids where key = 'claim_key')
);
select ok(((select payload from _ids where key = 'claim_repeat') ->> 'idempotent')::boolean, 'second task claim returns idempotent=true');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'second task claim does not credit again');
select ok(testutil.raises_like(format('select api.task_claim_reward(%L::uuid, %L::uuid, %L, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'task'), 'different-period', (select txt from _ids where key = 'claim_key')), '%idempotency conflict%'), 'task claim idempotency key cannot be reused for different inputs');

insert into tasks.user_task_progress (user_id, task_id, period_key, progress_count, target_count, status)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), 'incomplete-period', 0, 1, 'in_progress')
on conflict (user_id, task_id, period_key) do update set status = 'in_progress', progress_count = 0, updated_at = now();
select ok(testutil.raises_like(format('select api.task_claim_reward(%L::uuid, %L::uuid, %L, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'task'), 'incomplete-period', 'task-claim-incomplete-001'), '%task is not completed%'), 'cannot claim incomplete task');

with campaign as (
  insert into tasks.signin_campaigns (code, title, description, cycle_days, active, starts_at, ends_at)
  values ('SIGNIN_TEST_7D', '7 Day Signin Test', 'pgTAP signin', 7, true, now() - interval '1 day', now() + interval '7 days')
  on conflict (code) do update set active = true, starts_at = excluded.starts_at, ends_at = excluded.ends_at, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'signin_campaign', id from campaign;

insert into tasks.signin_days (campaign_id, day_index, reward, title)
values ((select id from _ids where key = 'signin_campaign'), 1, '[{"currency":"FGEMS","amount":9}]'::jsonb, 'Day 1')
on conflict (campaign_id, day_index) do update set reward = excluded.reward, title = excluded.title;

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
    'TAP_DAILY_CHECK_IN_PROGRESS_TEST',
    'daily',
    'Check In Progress Test',
    'pgTAP daily check-in progress task',
    'daily',
    1,
    '[{"currency":"KCOIN","amount":1}]'::jsonb,
    'none',
    true,
    '{"progress_source":"signin_success"}'::jsonb
  )
  on conflict (code) do update
  set active = true,
      target_count = 1,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'signin_task', id from task_row;

insert into _ids (key, txt) values ('signin_key', 'task-signin-idem-001');
insert into _ids (key, payload)
select 'signin1', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'signin_campaign'),
  date '2099-01-01',
  0,
  (select txt from _ids where key = 'signin_key')
);
select is(((select payload from _ids where key = 'signin1') ->> 'day_index')::int, 1, 'first daily sign-in claims day 1');
select is(((select payload from _ids where key = 'signin1') ->> 'current_streak')::int, 1, 'first daily sign-in returns current_streak=1');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 9::numeric, 'daily sign-in credits configured FGEMS reward');
select is((select signin_date from tasks.user_signins where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign')), testutil.signin_business_date(), 'daily sign-in ignores client date and stores the business date');
select is((select count(*)::int from tasks.user_signins where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign') and signin_date = date '2099-01-01'), 0, 'daily sign-in never stores the forged client date');
select is((select idempotency_key from tasks.user_signins where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign') and signin_date = testutil.signin_business_date()), (select txt from _ids where key = 'signin_key'), 'daily sign-in stores idempotency_key');
select ok((select request_fingerprint is not null from tasks.user_signins where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign') and signin_date = testutil.signin_business_date()), 'daily sign-in stores request_fingerprint');
select is((select current_streak from tasks.user_signin_states where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign')), 1, 'daily sign-in updates user_signin_states.current_streak');
select is((select cycle_position from tasks.user_signin_states where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign')), 1, 'daily sign-in updates user_signin_states.cycle_position');
select is((select last_signin_date from tasks.user_signin_states where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign')), testutil.signin_business_date(), 'daily sign-in updates user_signin_states.last_signin_date');
select ok(((select payload from _ids where key = 'signin1') ? 'progress_result'), 'daily sign-in returns task progress result');
select is((select progress_count from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'signin_task') and period_key = testutil.signin_business_date()::text), 1, 'daily sign-in records task progress');
select is((select status from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'signin_task') and period_key = testutil.signin_business_date()::text), 'completed', 'daily sign-in completes the check-in task');
select is((select jsonb_array_length(source_events) from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'signin_task') and period_key = testutil.signin_business_date()::text), 1, 'daily sign-in stores one task progress source event');
select is((select count(*)::int from ops.idempotency_keys where key = 'task_daily_check_in:' || (select txt from _ids where key = 'signin_key') and status = 'completed'), 1, 'daily sign-in stores completed API idempotency key');
select is((select count(*)::int from economy.currency_ledger where idempotency_key like 'daily_check_in:' || (select txt from _ids where key = 'signin_key') || ':%'), 1, 'daily sign-in ledger key uses idempotency prefix');

insert into _ids (key, payload)
select 'signin_repeat', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'signin_campaign'),
  date '1999-01-01',
  -840,
  (select txt from _ids where key = 'signin_key')
);
select ok(((select payload from _ids where key = 'signin_repeat') ->> 'idempotent')::boolean, 'same sign-in idempotency key returns cached response even when client date changes');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 9::numeric, 'same idempotency key does not credit again');

insert into _ids (key, payload)
select 'signin_same_day_new_key', api.task_daily_check_in(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'signin_campaign'),
  date '2099-01-02',
  840,
  'task-signin-idem-002'
);
select ok(((select payload from _ids where key = 'signin_same_day_new_key') ->> 'already_claimed')::boolean, 'same-day repeated sign-in with a new key returns already_claimed=true');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 9::numeric, 'same-day repeated sign-in with a new key does not credit again');
select is((select count(*)::int from tasks.user_signins where user_id = (select id from _ids where key = 'user') and campaign_id = (select id from _ids where key = 'signin_campaign')), 1, 'forged client dates still leave only one business-day sign-in row');
select is((select jsonb_array_length(source_events) from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'signin_task') and period_key = testutil.signin_business_date()::text), 1, 'same-day repeated sign-in does not duplicate task progress source events');

insert into _ids (key, id) values ('legacy_user', testutil.make_user(10000000002, 'task_claim_legacy_user', null));
insert into _ids (key, payload) select 'legacy_signin', api.task_daily_check_in((select id from _ids where key = 'legacy_user'));
select ok(((select payload from _ids where key = 'legacy_signin') ? 'signin_id'), 'legacy sign-in wrapper still works');

select * from finish();

rollback;
