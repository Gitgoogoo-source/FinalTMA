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

insert into _ids (key, payload) select 'claim1', api.task_claim_reward((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), '2026-05-20');
select ok(((select payload from _ids where key = 'claim1') ? 'claim_id'), 'task claim returns claim_id');
select is((select status from tasks.user_task_progress where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), 'claimed', 'task progress becomes claimed');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'task reward credits KCOIN');
select is((select count(*)::int from tasks.task_claims where user_id = (select id from _ids where key = 'user') and task_id = (select id from _ids where key = 'task') and period_key = '2026-05-20'), 1, 'one task claim row is created');

insert into _ids (key, payload) select 'claim_repeat', api.task_claim_reward((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), '2026-05-20');
select ok(((select payload from _ids where key = 'claim_repeat') ->> 'idempotent')::boolean, 'second task claim returns idempotent=true');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 77::numeric, 'second task claim does not credit again');

insert into tasks.user_task_progress (user_id, task_id, period_key, progress_count, target_count, status)
values ((select id from _ids where key = 'user'), (select id from _ids where key = 'task'), 'incomplete-period', 0, 1, 'in_progress')
on conflict (user_id, task_id, period_key) do update set status = 'in_progress', progress_count = 0, updated_at = now();
select ok(testutil.raises_like(format('select api.task_claim_reward(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'task'), 'incomplete-period'), '%task is not completed%'), 'cannot claim incomplete task');

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

insert into _ids (key, payload) select 'signin1', api.task_daily_check_in((select id from _ids where key = 'user'));
select is(((select payload from _ids where key = 'signin1') ->> 'day_index')::int, 1, 'first daily sign-in claims day 1');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 9::numeric, 'daily sign-in credits configured FGEMS reward');

insert into _ids (key, payload) select 'signin_repeat', api.task_daily_check_in((select id from _ids where key = 'user'));
select ok(((select payload from _ids where key = 'signin_repeat') ->> 'already_claimed')::boolean, 'second sign-in on same day returns already_claimed=true');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 9::numeric, 'same-day repeated sign-in does not credit again');

select * from finish();

rollback;
