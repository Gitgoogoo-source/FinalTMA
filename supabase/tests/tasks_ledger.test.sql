-- Phase 4 / 11.1 task reward ledger reconciliation acceptance checks.

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

create or replace function testutil.signed_ledger_available(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce(sum(
    case
      when entry_type in ('credit', 'refund', 'unlock', 'adjustment') then amount
      when entry_type in ('debit', 'fee', 'lock', 'reversal') then -amount
      else 0
    end
  ), 0)::numeric
  from economy.currency_ledger
  where user_id = p_user_id
    and currency_code = upper(p_currency_code);
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

insert into ops.system_settings (key, value, description)
values (
  'REFERRAL_COMMISSION_BPS',
  '{"commission_bps":1000}'::jsonb,
  '11.1 ledger test rate.'
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

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
    'SIGNIN_LEDGER_11_1_TEST',
    '11.1 Ledger Sign-in Test',
    'pgTAP sign-in ledger fixture',
    7,
    true,
    now() - interval '1 day',
    now() + interval '7 days',
    '{"test":"phase4_11_1_ledger"}'::jsonb
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
  case when day_index = 1 then '[{"currency":"FGEMS","amount":11}]'::jsonb else '[]'::jsonb end,
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
    'TASKS_LEDGER_11_1_CLAIM_TEST',
    'daily',
    '11.1 Ledger Claim Test',
    'pgTAP task claim ledger fixture',
    'daily',
    1,
    '[{"currency":"KCOIN","amount":33}]'::jsonb,
    'none',
    true,
    '{"test":"phase4_11_1_ledger"}'::jsonb
  )
  on conflict (code) do update
  set reward = excluded.reward,
      active = true,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'task', id from task_row;

insert into _ids (key, id) values
  ('task_user', testutil.make_user(11110500001, 'tasks_ledger_11_1_task_user', null)),
  ('signin_user', testutil.make_user(11110500002, 'tasks_ledger_11_1_signin_user', null)),
  ('inviter', testutil.make_user(11110500003, 'tasks_ledger_11_1_inviter', null)),
  ('invitee', testutil.make_user(11110500004, 'tasks_ledger_11_1_invitee', null));

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
  (select id from _ids where key = 'task_user'),
  (select id from _ids where key = 'task'),
  'tasks-ledger-11-1',
  1,
  1,
  'completed',
  now()
);

insert into _ids (key, payload)
select 'task_claim', api.task_claim_reward(
  (select id from _ids where key = 'task_user'),
  (select id from _ids where key = 'task'),
  'tasks-ledger-11-1',
  'tasks-ledger-11-1-claim'
);
insert into _ids (key, id)
select 'task_claim_id', ((select payload from _ids where key = 'task_claim') ->> 'claim_id')::uuid;

insert into _ids (key, payload)
select 'signin_claim', api.task_daily_check_in(
  (select id from _ids where key = 'signin_user'),
  (select id from _ids where key = 'campaign'),
  date '2099-01-01',
  0,
  'tasks-ledger-11-1-signin'
);
insert into _ids (key, id)
select 'signin_id', ((select payload from _ids where key = 'signin_claim') ->> 'signin_id')::uuid;

insert into _ids (key, txt)
select 'invite_code', invite_code from core.users where id = (select id from _ids where key = 'inviter');
insert into _ids (key, id)
select 'box', id from gacha.blind_boxes where slug = 'starter_egg';

insert into _ids (key, payload)
values (
  'bind_referral',
  api.referral_bind_inviter(
    (select id from _ids where key = 'invitee'),
    (select txt from _ids where key = 'invite_code'),
    'tasks-ledger-11-1-bind',
    '{}'::jsonb
  )
);
insert into _ids (key, id)
select 'referral', id from tasks.referrals where invitee_user_id = (select id from _ids where key = 'invitee');

insert into _ids (key, payload)
select 'first_open_order', api.gacha_create_order(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'box'),
  1,
  'tasks-ledger-11-1-first-open'
);
insert into _ids (key, id)
select 'first_draw_order', ((select payload from _ids where key = 'first_open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'first_process_order', api.gacha_process_dev_paid_order(
  (select id from _ids where key = 'first_draw_order'),
  (select id from _ids where key = 'invitee')
);

insert into _ids (key, payload)
select 'second_open_order', api.gacha_create_order(
  (select id from _ids where key = 'invitee'),
  (select id from _ids where key = 'box'),
  1,
  'tasks-ledger-11-1-second-open'
);
insert into _ids (key, id)
select 'second_draw_order', ((select payload from _ids where key = 'second_open_order') ->> 'draw_order_id')::uuid;
insert into _ids (key, payload)
select 'second_process_order', api.gacha_process_dev_paid_order(
  (select id from _ids where key = 'second_draw_order'),
  (select id from _ids where key = 'invitee')
);
insert into _ids (key, id)
select 'commission', id
from tasks.referral_commissions
where referral_id = (select id from _ids where key = 'referral')
  and source_id = (select id from _ids where key = 'second_draw_order');

insert into _ids (key, payload)
select 'commission_claim', api.referral_claim_commission(
  (select id from _ids where key = 'inviter'),
  array[(select id from _ids where key = 'commission')],
  'tasks-ledger-11-1-commission-claim'
);

select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'task_user')
      and source_type = 'task_claim'
      and source_id = (select id from _ids where key = 'task_claim_id')
      and currency_code = 'KCOIN'
      and amount = 33
  ),
  1,
  'task_claims reward has matching task_claim ledger'
);

select is(
  (
    select count(*)::int
    from economy.currency_ledger
    where user_id = (select id from _ids where key = 'signin_user')
      and source_type = 'daily_check_in'
      and source_id = (select id from _ids where key = 'signin_id')
      and currency_code = 'FGEMS'
      and amount = 11
  ),
  1,
  'user_signins reward has matching daily_check_in ledger'
);

select is(
  (
    select count(*)::int
    from tasks.referral_rewards rr
    join economy.currency_ledger ledger on ledger.id = rr.ledger_id
    where rr.referral_id = (select id from _ids where key = 'referral')
      and rr.status = 'granted'
      and ledger.source_type = 'referral_first_open'
  ),
  2,
  'referral reward records point to valid ledger rows'
);

select is(
  (
    select count(*)::int
    from tasks.referral_commissions rc
    join economy.currency_ledger ledger on ledger.id = rc.ledger_id
    where rc.id = (select id from _ids where key = 'commission')
      and rc.status = 'granted'
      and ledger.source_type = 'referral_commission_claim'
      and ledger.amount = rc.commission_amount_kcoin
  ),
  1,
  'granted referral commission points to matching ledger'
);

select is(
  (
    select count(*)::int
    from tasks.referral_rewards
    where referral_id = (select id from _ids where key = 'referral')
      and status = 'granted'
      and ledger_id is null
  ),
  0,
  'no granted referral reward is missing ledger_id'
);
select is(
  (
    select count(*)::int
    from tasks.referral_commissions
    where id = (select id from _ids where key = 'commission')
      and status = 'granted'
      and ledger_id is null
  ),
  0,
  'no granted referral commission is missing ledger_id'
);

select is(
  testutil.balance_of((select id from _ids where key = 'task_user'), 'KCOIN'),
  testutil.signed_ledger_available((select id from _ids where key = 'task_user'), 'KCOIN'),
  'task reward balance equals signed ledger total'
);
select is(
  testutil.balance_of((select id from _ids where key = 'signin_user'), 'FGEMS'),
  testutil.signed_ledger_available((select id from _ids where key = 'signin_user'), 'FGEMS'),
  'sign-in reward balance equals signed ledger total'
);
select is(
  testutil.balance_of((select id from _ids where key = 'inviter'), 'KCOIN'),
  testutil.signed_ledger_available((select id from _ids where key = 'inviter'), 'KCOIN'),
  'inviter reward and commission balance equals signed ledger total'
);
select is(
  testutil.balance_of((select id from _ids where key = 'invitee'), 'KCOIN'),
  testutil.signed_ledger_available((select id from _ids where key = 'invitee'), 'KCOIN'),
  'invitee reward and open rebate balance equals signed ledger total'
);

select * from finish();

rollback;
