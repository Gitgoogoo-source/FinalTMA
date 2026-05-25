-- Fourth stage 2.5: seed the default active 7-day sign-in campaign.

begin;

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
    'SIGNIN_7_DAY_DEFAULT',
    '7 Day Sign-In',
    'Default active 7-day sign-in campaign.',
    7,
    true,
    null,
    null,
    jsonb_build_object(
      'phase', 'stage_4_tasks',
      'guide_section', '2.5_signin_seed',
      'source', '20260525171608_phase4_signin_seed',
      'reward_version', 'signin_default_v1'
    )
  )
  on conflict (code) do update
  set title = excluded.title,
      description = excluded.description,
      cycle_days = excluded.cycle_days,
      active = excluded.active,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      metadata = tasks.signin_campaigns.metadata || excluded.metadata,
      updated_at = now()
  returning id
),
signin_rewards(day_index, title, reward, reward_label) as (
  values
    (1, 'Day 1', jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 100)), '100 KCOIN'),
    (2, 'Day 2', jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 150)), '150 KCOIN'),
    (3, 'Day 3', jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 20)), '20 FGEMS'),
    (4, 'Day 4', jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 200)), '200 KCOIN'),
    (5, 'Day 5', jsonb_build_array(jsonb_build_object('currency', 'FGEMS', 'amount', 30)), '30 FGEMS'),
    (6, 'Day 6', jsonb_build_array(jsonb_build_object('currency', 'KCOIN', 'amount', 300)), '300 KCOIN'),
    (
      7,
      'Day 7',
      jsonb_build_array(
        jsonb_build_object('currency', 'KCOIN', 'amount', 500),
        jsonb_build_object('currency', 'FGEMS', 'amount', 50)
      ),
      '500 KCOIN + 50 FGEMS'
    )
)
insert into tasks.signin_days (
  campaign_id,
  day_index,
  reward,
  title,
  metadata
)
select
  campaign.id,
  signin_rewards.day_index,
  signin_rewards.reward,
  signin_rewards.title,
  jsonb_build_object(
    'phase', 'stage_4_tasks',
    'guide_section', '2.5_signin_seed',
    'source', '20260525171608_phase4_signin_seed',
    'reward_label', signin_rewards.reward_label,
    'reward_version', 'signin_default_v1'
  )
from campaign
cross join signin_rewards
on conflict (campaign_id, day_index) do update
set reward = excluded.reward,
    title = excluded.title,
    metadata = tasks.signin_days.metadata || excluded.metadata;

commit;
