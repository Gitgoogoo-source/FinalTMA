-- 008_tasks.seed.sql
-- Fourth stage 2.4 task definition seed and 2.5 sign-in seed.

begin;

with task_seed (
  code,
  task_type,
  title,
  description,
  period_type,
  target_count,
  reward,
  action_type,
  sort_order,
  metadata
) as (
  values
    (
      'DAILY_CHECK_IN',
      'daily',
      'Daily check-in',
      'Check in once today.',
      'daily',
      1,
      '[{"currency":"KCOIN","amount":10},{"currency":"FGEMS","amount":10}]'::jsonb,
      'none',
      10,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"signin_success"}'::jsonb
    ),
    (
      'DAILY_OPEN_BOX_1',
      'daily',
      'Open 1 box',
      'Open one blind box today.',
      'daily',
      1,
      '[{"currency":"KCOIN","amount":10}]'::jsonb,
      'open_box',
      20,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"gacha_open_success"}'::jsonb
    ),
    (
      'DAILY_OPEN_BOX_10',
      'daily',
      'Open 10 boxes',
      'Open ten blind boxes today.',
      'daily',
      10,
      '[{"currency":"FGEMS","amount":10}]'::jsonb,
      'open_box',
      30,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"gacha_open_success"}'::jsonb
    ),
    (
      'DAILY_SHARE_INVITE',
      'social',
      'Share invite',
      'Share an invite link today.',
      'daily',
      1,
      '[{"currency":"KCOIN","amount":10}]'::jsonb,
      'share',
      40,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"share_event_recorded"}'::jsonb
    ),
    (
      'REFERRAL_FIRST_OPEN',
      'referral',
      'Referral first open',
      'Invite a friend to complete their first box open.',
      'event',
      1,
      '[{"currency":"KCOIN","amount":10}]'::jsonb,
      'invite',
      50,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"referral_first_open"}'::jsonb
    ),
    (
      'TRADE_BUY_1',
      'trade',
      'Buy 1 market item',
      'Complete one market purchase today.',
      'daily',
      1,
      '[{"currency":"FGEMS","amount":10}]'::jsonb,
      'buy_market',
      60,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"market_order_completed"}'::jsonb
    ),
    (
      'TRADE_LIST_1',
      'trade',
      'List 1 market item',
      'Create one market listing today.',
      'daily',
      1,
      '[{"currency":"KCOIN","amount":10}]'::jsonb,
      'sell_market',
      70,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"market_listing_created"}'::jsonb
    ),
    (
      'WALLET_CONNECT',
      'onchain',
      'Connect wallet',
      'Verify and connect a TON wallet.',
      'once',
      1,
      '[{"currency":"FGEMS","amount":10}]'::jsonb,
      'connect_wallet',
      80,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"wallet_verified"}'::jsonb
    ),
    (
      'SYNC_NFT',
      'onchain',
      'Sync NFT',
      'Complete one on-chain NFT sync this week.',
      'weekly',
      1,
      '[{"currency":"FGEMS","amount":10}]'::jsonb,
      'sync_nft',
      90,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"nft_sync_success"}'::jsonb
    ),
    (
      'UPGRADE_ITEM_1',
      'daily',
      'Upgrade 1 collectible',
      'Upgrade one collectible today.',
      'daily',
      1,
      '[{"currency":"FGEMS","amount":10}]'::jsonb,
      'none',
      100,
      '{"phase":"fourth_stage","guide_section":"2.4_task_definition_seed","progress_source":"inventory_upgrade_success"}'::jsonb
    )
)
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
  starts_at,
  ends_at,
  sort_order,
  metadata
)
select
  code,
  task_type,
  title,
  description,
  period_type,
  target_count,
  reward,
  action_type,
  true,
  null,
  null,
  sort_order,
  metadata
from task_seed
on conflict (code) do update
set task_type = excluded.task_type,
    title = excluded.title,
    description = excluded.description,
    period_type = excluded.period_type,
    target_count = excluded.target_count,
    reward = excluded.reward,
    action_type = excluded.action_type,
    active = true,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    sort_order = excluded.sort_order,
    metadata = tasks.task_definitions.metadata || excluded.metadata,
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
      'source', '008_tasks_seed',
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
    'source', '008_tasks_seed',
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
