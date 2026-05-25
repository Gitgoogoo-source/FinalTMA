-- Fourth stage 2.5 sign-in seed acceptance checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions;

select no_plan();

select is(
  (
    select count(*)::integer
    from tasks.signin_campaigns
    where code = 'SIGNIN_7_DAY_DEFAULT'
      and active = true
      and cycle_days = 7
  ),
  1,
  'default 7-day sign-in campaign exists and is active'
);

select is(
  (
    select count(*)::integer
    from tasks.signin_days sd
    join tasks.signin_campaigns sc on sc.id = sd.campaign_id
    where sc.code = 'SIGNIN_7_DAY_DEFAULT'
  ),
  7,
  'default sign-in campaign has 7 reward days'
);

with expected(day_index, reward) as (
  values
    (1, jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 100))),
    (2, jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 150))),
    (3, jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 20))),
    (4, jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 200))),
    (5, jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 30))),
    (6, jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 300))),
    (
      7,
      jsonb_build_array(
        jsonb_build_object('currency', 'KCOIN', 'amount', 500),
        jsonb_build_object('currency', 'FGEMS', 'amount', 50)
      )
    )
),
actual as (
  select sd.day_index, sd.reward
  from tasks.signin_days sd
  join tasks.signin_campaigns sc on sc.id = sd.campaign_id
  where sc.code = 'SIGNIN_7_DAY_DEFAULT'
)
select ok(
  not exists (
    select day_index, reward from expected
    except
    select day_index, reward from actual
  )
  and not exists (
    select day_index, reward from actual
    except
    select day_index, reward from expected
  ),
  'default sign-in rewards match the stage 4 plan'
);

with reward_items as (
  select reward_item.value ->> 'currency' as currency_code
  from tasks.signin_days sd
  join tasks.signin_campaigns sc on sc.id = sd.campaign_id
  cross join lateral jsonb_array_elements(sd.reward) as reward_item(value)
  where sc.code = 'SIGNIN_7_DAY_DEFAULT'
)
select ok(
  not exists (
    select 1
    from reward_items ri
    left join economy.currencies c on c.code = ri.currency_code
    where c.code is null
  ),
  'all default sign-in reward currencies exist'
);

select * from finish();

rollback;
