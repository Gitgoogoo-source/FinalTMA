-- Phase 6 step 2.12 daily reports / commercial BI checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(25);

select has_table('ops', 'daily_business_reports', 'daily business report table exists');
select has_table('ops', 'daily_economy_reports', 'daily economy report table exists');
select has_table('ops', 'daily_gacha_reports', 'daily gacha report table exists');
select has_table('ops', 'daily_market_reports', 'daily market report table exists');
select has_table('ops', 'daily_referral_reports', 'daily referral report table exists');

select ok(
  (select relrowsecurity from pg_class where oid = 'ops.daily_business_reports'::regclass),
  'daily business reports have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'ops.daily_business_reports', 'select'),
  'anon cannot read daily business reports directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_list_daily_reports(uuid,date,date,jsonb,integer,integer,jsonb)',
    'execute'
  ),
  'service role can execute report read RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'api.admin_list_daily_reports(uuid,date,date,jsonb,integer,integer,jsonb)',
    'execute'
  ),
  'anon cannot execute report read RPC'
);

select ok(
  exists (
    select 1
    from ops.admin_roles
    where code = 'OPS'
      and permissions ? 'reports:read'
      and permissions ? 'reports:export'
  ),
  'OPS role has report read and export permissions'
);

create temp table _ids (
  key text primary key,
  id uuid
) on commit drop;

insert into _ids
select 'admin', '69000000-0000-4000-8000-000000000212'::uuid
union all
select 'user_a', (api.auth_upsert_telegram_user(
  p_telegram_user_id := 6212001,
  p_username := 'reports_user_a',
  p_first_name := 'Reports',
  p_last_name := 'A',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := null,
  p_start_param := null,
  p_metadata := '{"test":true}'::jsonb
) ->> 'user_id')::uuid
union all
select 'user_b', (api.auth_upsert_telegram_user(
  p_telegram_user_id := 6212002,
  p_username := 'reports_user_b',
  p_first_name := 'Reports',
  p_last_name := 'B',
  p_language_code := 'en',
  p_is_premium := false,
  p_photo_url := null,
  p_start_param := null,
  p_metadata := '{"test":true}'::jsonb
) ->> 'user_id')::uuid;

insert into ops.admin_users (id, email, display_name, status, metadata)
values ((select id from _ids where key = 'admin'), 'phase6-reports-admin@example.test', 'Reports Admin', 'active', '{"test":true}'::jsonb)
on conflict (id) do update
set status = 'active',
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select (select id from _ids where key = 'admin'), id
from ops.admin_roles
where code = 'OPS'
on conflict do nothing;

update core.users
set created_at = '2026-05-31 09:00:00+00',
    last_seen_at = '2026-05-31 12:05:00+00',
    last_auth_at = '2026-05-31 12:05:00+00'
where id = (select id from _ids where key = 'user_a');

update core.users
set created_at = '2026-05-30 09:00:00+00',
    last_seen_at = '2026-05-31 12:06:00+00',
    last_auth_at = '2026-05-31 12:06:00+00'
where id = (select id from _ids where key = 'user_b');

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  business_id,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key,
  paid_at,
  created_at,
  updated_at
)
values (
  '69000000-0000-4000-8000-000000000213',
  (select id from _ids where key = 'user_a'),
  'gacha_open',
  null,
  'paid',
  50,
  'reports-invoice-payload',
  'Reports order',
  'reports-order-20260531',
  '2026-05-31 12:00:00+00',
  '2026-05-31 11:59:00+00',
  '2026-05-31 12:00:00+00'
);

insert into payments.star_payments (
  id,
  star_order_id,
  user_id,
  telegram_payment_charge_id,
  xtr_amount,
  invoice_payload,
  paid_at,
  created_at
)
values (
  '69000000-0000-4000-8000-000000000214',
  '69000000-0000-4000-8000-000000000213',
  (select id from _ids where key = 'user_a'),
  'reports-charge-20260531',
  50,
  'reports-invoice-payload',
  '2026-05-31 12:00:00+00',
  '2026-05-31 12:00:00+00'
);

insert into gacha.draw_orders (
  id,
  user_id,
  box_id,
  pool_version_id,
  payment_star_order_id,
  status,
  quantity,
  draw_count,
  unit_price_stars,
  discount_bps,
  total_price_stars,
  open_reward_kcoin,
  invoice_payload,
  idempotency_key,
  telegram_invoice_payload,
  payment_status,
  payment_provider,
  star_amount,
  paid_at,
  opened_at,
  created_at,
  updated_at
)
select
  '69000000-0000-4000-8000-000000000215'::uuid,
  (select id from _ids where key = 'user_a'),
  bb.id,
  dpv.id,
  '69000000-0000-4000-8000-000000000213'::uuid,
  'opened',
  10,
  10,
  5,
  0,
  50,
  100,
  'reports-draw-invoice-payload',
  'reports-draw-order-20260531',
  'reports-invoice-payload',
  'paid',
  'telegram_stars',
  50,
  '2026-05-31 12:00:00+00',
  '2026-05-31 12:04:00+00',
  '2026-05-31 12:00:00+00',
  '2026-05-31 12:04:00+00'
from gacha.drop_pool_versions dpv
join gacha.blind_boxes bb on bb.id = dpv.box_id
order by dpv.created_at asc
limit 1;

insert into economy.currency_ledger (
  user_id,
  currency_code,
  entry_type,
  amount,
  available_after,
  locked_after,
  source_type,
  source_id,
  idempotency_key,
  created_at
)
values
  ((select id from _ids where key = 'user_a'), 'KCOIN', 'credit', 100, 100, 0, 'gacha_open_reward', null, 'reports-ledger-credit-20260531', '2026-05-31 12:01:00+00'),
  ((select id from _ids where key = 'user_a'), 'KCOIN', 'debit', 25, 75, 0, 'market_buy', null, 'reports-ledger-debit-20260531', '2026-05-31 12:02:00+00');

insert into tasks.referrals (
  inviter_user_id,
  invitee_user_id,
  invite_code,
  status,
  qualified_at,
  metadata,
  created_at,
  updated_at
)
values (
  (select id from _ids where key = 'user_a'),
  (select id from _ids where key = 'user_b'),
  'reports-referral-code',
  'qualified',
  '2026-05-31 12:03:00+00',
  '{"test":true}'::jsonb,
  '2026-05-31 12:03:00+00',
  '2026-05-31 12:03:00+00'
);

select lives_ok(
  $$select api.worker_build_daily_reports('2026-05-31'::date, '{"request_id":"reports-test"}'::jsonb)$$,
  'daily reports worker builds snapshots'
);

select is(
  (select (metrics ->> 'starsGmv')::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  50,
  'Stars GMV matches raw payments'
);

select is(
  (select (metrics ->> 'paymentOrderCount')::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  1,
  'payment order count matches raw orders'
);

select is(
  (select (metrics ->> 'newUserCount')::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  1,
  'new user count matches core users created that day'
);

select is(
  (select (metrics ->> 'activeUserCount')::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  2,
  'active user count matches users seen that day'
);

select is(
  (select (metrics ->> 'day1RetainedUserCount')::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  1,
  'day one retained user count matches prior-day active cohort'
);

select is(
  (select (metrics ->> 'day1RetentionRate')::numeric from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  1.0000,
  'day one retention rate is derived from retained cohort size'
);

select is(
  (select (metrics ->> 'tenDrawOrderCount')::integer from ops.daily_gacha_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all|rarity=all|series=all|template=all'),
  1,
  'gacha report captures ten-draw order count'
);

select is(
  (select (metrics ->> 'revenueStars')::integer from ops.daily_gacha_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all|rarity=all|series=all|template=all'),
  50,
  'gacha report captures Stars revenue for the day'
);

select is(
  (select (metrics ->> 'issuedAmount')::integer from ops.daily_economy_reports where report_date = '2026-05-31' and currency_code = 'KCOIN' and source_type = 'all'),
  100,
  'K-coin issued amount uses credit-style ledger entries'
);

select is(
  (select (metrics ->> 'spentAmount')::integer from ops.daily_economy_reports where report_date = '2026-05-31' and currency_code = 'KCOIN' and source_type = 'all'),
  25,
  'K-coin spent amount uses debit-style ledger entries even when amount is positive'
);

select is(
  (select (metrics ->> 'invitedCount')::integer from ops.daily_referral_reports where report_date = '2026-05-31' and scope_key = 'campaign=all|cohort=all'),
  1,
  'referral report matches raw referral inserts'
);

select lives_ok(
  $$select api.worker_build_daily_reports('2026-05-31'::date, '{"request_id":"reports-test-replay"}'::jsonb)$$,
  'daily reports worker can rerun the same day idempotently'
);

select is(
  (select count(*)::integer from ops.daily_business_reports where report_date = '2026-05-31' and scope_key = 'box=all|campaign=all|cohort=all'),
  1,
  'rerunning same date keeps one business snapshot row'
);

select ok(
  jsonb_array_length(
    api.admin_list_daily_reports(
      (select id from _ids where key = 'admin'),
      '2026-05-31'::date,
      '2026-05-31'::date,
      '{}'::jsonb,
      100,
      0,
      '{"request_id":"reports-read-test"}'::jsonb
    ) -> 'items'
  ) >= 1,
  'admin read RPC returns report snapshots'
);

select * from finish();

rollback;
