-- Phase 4 / 8.2 sign-in streak and break-streak acceptance checks.

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

select no_plan();

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

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
    'SIGNIN_STREAK_8_2_TEST',
    '8.2 Sign-in Streak Test',
    'pgTAP coverage for consecutive, break-streak and cycle rules',
    7,
    true,
    now() - interval '1 day',
    now() + interval '7 days',
    '{"test":"phase4_8_2"}'::jsonb
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
  '[]'::jsonb,
  'Day ' || day_index::text
from generate_series(1, 7) as gs(day_index)
on conflict (campaign_id, day_index) do update
set reward = excluded.reward,
    title = excluded.title;

insert into _ids (key, id) values
  ('continuous_user', testutil.make_user(10820000001, 'signin_continuous_user', null)),
  ('break_user', testutil.make_user(10820000002, 'signin_break_user', null)),
  ('cycle_user', testutil.make_user(10820000003, 'signin_cycle_user', null)),
  ('ended_user', testutil.make_user(10820000004, 'signin_ended_user', null));

insert into tasks.user_signin_states (
  user_id,
  campaign_id,
  current_streak,
  cycle_position,
  last_signin_date,
  total_signins
)
values (
  (select id from _ids where key = 'continuous_user'),
  (select id from _ids where key = 'campaign'),
  2,
  2,
  current_date - 1,
  2
);

insert into _ids (key, payload)
select
  'continuous_signin',
  api.task_daily_check_in(
    (select id from _ids where key = 'continuous_user'),
    (select id from _ids where key = 'campaign'),
    current_date,
    0,
    'signin-8-2-continuous-001'
  );

select is(((select payload from _ids where key = 'continuous_signin') ->> 'already_claimed')::boolean, false, 'user not signed today can claim');
select is(((select payload from _ids where key = 'continuous_signin') ->> 'day_index')::integer, 3, 'yesterday sign-in advances to next campaign day');
select is(((select payload from _ids where key = 'continuous_signin') ->> 'current_streak')::integer, 3, 'yesterday sign-in increments current_streak');
select is(
  (select cycle_position from tasks.user_signin_states where user_id = (select id from _ids where key = 'continuous_user') and campaign_id = (select id from _ids where key = 'campaign')),
  3,
  'continuous sign-in updates cycle_position'
);

insert into _ids (key, payload)
select
  'continuous_repeat',
  api.task_daily_check_in(
    (select id from _ids where key = 'continuous_user'),
    (select id from _ids where key = 'campaign'),
    current_date,
    0,
    'signin-8-2-continuous-002'
  );

select is(((select payload from _ids where key = 'continuous_repeat') ->> 'already_claimed')::boolean, true, 'user signed today receives already_claimed');
select is(
  (
    select count(*)::integer
    from tasks.user_signins
    where user_id = (select id from _ids where key = 'continuous_user')
      and campaign_id = (select id from _ids where key = 'campaign')
      and signin_date = current_date
  ),
  1,
  'same-day repeated sign-in does not insert a second user_signins row'
);
select is(
  (select total_signins from tasks.user_signin_states where user_id = (select id from _ids where key = 'continuous_user') and campaign_id = (select id from _ids where key = 'campaign')),
  3,
  'same-day repeated sign-in does not advance total_signins'
);

insert into tasks.user_signin_states (
  user_id,
  campaign_id,
  current_streak,
  cycle_position,
  last_signin_date,
  total_signins
)
values (
  (select id from _ids where key = 'break_user'),
  (select id from _ids where key = 'campaign'),
  5,
  5,
  current_date - 2,
  5
);

insert into _ids (key, payload)
select
  'break_signin',
  api.task_daily_check_in(
    (select id from _ids where key = 'break_user'),
    (select id from _ids where key = 'campaign'),
    current_date,
    0,
    'signin-8-2-break-001'
  );

select is(((select payload from _ids where key = 'break_signin') ->> 'day_index')::integer, 1, 'missed yesterday resets campaign day to 1');
select is(((select payload from _ids where key = 'break_signin') ->> 'current_streak')::integer, 1, 'missed yesterday resets current_streak to 1');
select is(
  (select last_signin_date from tasks.user_signin_states where user_id = (select id from _ids where key = 'break_user') and campaign_id = (select id from _ids where key = 'campaign')),
  current_date,
  'break-streak sign-in stores today as last_signin_date'
);

insert into tasks.user_signin_states (
  user_id,
  campaign_id,
  current_streak,
  cycle_position,
  last_signin_date,
  total_signins
)
values (
  (select id from _ids where key = 'cycle_user'),
  (select id from _ids where key = 'campaign'),
  7,
  7,
  current_date - 1,
  7
);

insert into _ids (key, payload)
select
  'cycle_signin',
  api.task_daily_check_in(
    (select id from _ids where key = 'cycle_user'),
    (select id from _ids where key = 'campaign'),
    current_date,
    0,
    'signin-8-2-cycle-001'
  );

select is(((select payload from _ids where key = 'cycle_signin') ->> 'day_index')::integer, 1, 'after day 7 the next claim returns to campaign day 1');
select is(((select payload from _ids where key = 'cycle_signin') ->> 'cycle_position')::integer, 1, 'after day 7 the stored cycle_position returns to 1');
select is(((select payload from _ids where key = 'cycle_signin') ->> 'current_streak')::integer, 8, 'after day 7 the consecutive streak continues');

with ended_campaign as (
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
    'SIGNIN_ENDED_8_2_TEST',
    '8.2 Ended Sign-in Test',
    'pgTAP coverage for ended sign-in campaign',
    7,
    true,
    now() - interval '7 days',
    now() - interval '1 minute',
    '{"test":"phase4_8_2"}'::jsonb
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
insert into _ids (key, id) select 'ended_campaign', id from ended_campaign;

select ok(
  testutil.raises_like(
    format(
      'select api.task_daily_check_in(%L::uuid, %L::uuid, current_date, 0, %L)',
      (select id::text from _ids where key = 'ended_user'),
      (select id::text from _ids where key = 'ended_campaign'),
      'signin-8-2-ended-001'
    ),
    '%active sign-in campaign not found%'
  ),
  'ended campaign does not allow sign-in'
);

select * from finish();

rollback;
