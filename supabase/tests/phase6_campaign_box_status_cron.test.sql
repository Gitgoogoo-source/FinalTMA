-- Phase 6 campaign and blind-box lifecycle cron RPC checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

insert into _ids (key, id)
values
  ('due_box', '65000000-0000-4000-8000-000000000101'),
  ('due_pool', '65000000-0000-4000-8000-000000000102'),
  ('expired_box', '65000000-0000-4000-8000-000000000201'),
  ('sold_out_box', '65000000-0000-4000-8000-000000000301'),
  ('blocked_box', '65000000-0000-4000-8000-000000000401'),
  ('future_box', '65000000-0000-4000-8000-000000000501'),
  ('expired_banner', '65000000-0000-4000-8000-000000000601');

select ok(
  to_regprocedure('api.sync_campaign_box_statuses(jsonb,timestamptz)') is not null,
  'sync_campaign_box_statuses exists with p_-prefixed cron signature'
);

select ok(
  has_function_privilege('service_role', 'api.sync_campaign_box_statuses(jsonb,timestamptz)', 'EXECUTE')
    and not has_function_privilege('public', 'api.sync_campaign_box_statuses(jsonb,timestamptz)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.sync_campaign_box_statuses(jsonb,timestamptz)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.sync_campaign_box_statuses(jsonb,timestamptz)', 'EXECUTE'),
  'sync_campaign_box_statuses is service_role only'
);

insert into gacha.blind_boxes (
  id,
  slug,
  display_name,
  tier,
  status,
  price_stars,
  total_stock,
  remaining_stock,
  starts_at,
  ends_at
)
values
  (
    (select id from _ids where key = 'due_box'),
    'phase6-cron-due-box',
    'Phase 6 Cron Due Box',
    'normal',
    'not_started',
    10,
    100,
    20,
    '2026-05-31T00:00:00+00',
    '2026-06-01T00:00:00+00'
  ),
  (
    (select id from _ids where key = 'expired_box'),
    'phase6-cron-expired-box',
    'Phase 6 Cron Expired Box',
    'normal',
    'active',
    10,
    100,
    20,
    '2026-05-30T00:00:00+00',
    '2026-05-31T01:00:00+00'
  ),
  (
    (select id from _ids where key = 'sold_out_box'),
    'phase6-cron-sold-out-box',
    'Phase 6 Cron Sold Out Box',
    'normal',
    'active',
    10,
    100,
    0,
    '2026-05-30T00:00:00+00',
    '2026-06-01T00:00:00+00'
  ),
  (
    (select id from _ids where key = 'blocked_box'),
    'phase6-cron-blocked-box',
    'Phase 6 Cron Blocked Box',
    'normal',
    'not_started',
    10,
    100,
    20,
    '2026-05-31T00:00:00+00',
    '2026-06-01T00:00:00+00'
  ),
  (
    (select id from _ids where key = 'future_box'),
    'phase6-cron-future-box',
    'Phase 6 Cron Future Box',
    'normal',
    'not_started',
    10,
    100,
    20,
    '2026-06-01T00:00:00+00',
    '2026-06-02T00:00:00+00'
  );

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  published_at,
  effective_from
)
values (
  (select id from _ids where key = 'due_pool'),
  (select id from _ids where key = 'due_box'),
  1,
  'active',
  1,
  '2026-05-30T00:00:00+00',
  '2026-05-30T00:00:00+00'
);

insert into catalog.banner_campaigns (
  id,
  code,
  title,
  image_url,
  placement,
  target_type,
  status,
  starts_at,
  ends_at
)
values (
  (select id from _ids where key = 'expired_banner'),
  'phase6-cron-expired-banner',
  'Phase 6 Cron Expired Banner',
  '/storage/v1/object/public/banners/phase6/cron-expired-banner.png',
  'box_top',
  'none',
  'active',
  '2026-05-30T00:00:00+00',
  '2026-05-31T01:00:00+00'
);

insert into _ids (key, payload)
values (
  'cron_result',
  api.sync_campaign_box_statuses(
    p_request_context => jsonb_build_object('request_id', 'phase6-cron-status-sync-test'),
    p_now => '2026-05-31T02:00:00+00'::timestamptz
  )
);

select is(
  (select status from catalog.banner_campaigns where id = (select id from _ids where key = 'expired_banner')),
  'ended',
  'cron ends expired active banner campaigns'
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'due_box')),
  'active',
  'cron activates due not_started blind boxes with an active pool'
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'expired_box')),
  'ended',
  'cron ends expired blind boxes'
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'sold_out_box')),
  'active',
  'cron ignores legacy zero stock because blind boxes are unlimited'
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'blocked_box')),
  'not_started',
  'cron does not activate due blind boxes without an active pool'
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'future_box')),
  'not_started',
  'cron leaves future not_started blind boxes unchanged'
);

select is(
  ((select payload ->> 'campaigns_ended_count' from _ids where key = 'cron_result'))::int,
  1,
  'cron result includes ended campaign count'
);

select is(
  ((select payload ->> 'boxes_activated_count' from _ids where key = 'cron_result'))::int,
  1,
  'cron result includes activated blind box count'
);

select is(
  ((select payload ->> 'boxes_ended_count' from _ids where key = 'cron_result'))::int,
  1,
  'cron result includes ended blind box count'
);

select is(
  ((select payload ->> 'boxes_sold_out_count' from _ids where key = 'cron_result'))::int,
  0,
  'cron result does not include stock-based sold_out blind boxes'
);

select is(
  ((select payload ->> 'box_activation_blocked_count' from _ids where key = 'cron_result'))::int,
  1,
  'cron result includes blocked activation count'
);

select is(
  (
    select count(*)::int
    from ops.risk_events
    where event_type = 'cron_box_activation_blocked'
      and source_type = 'blind_box'
      and source_id = (select id from _ids where key = 'blocked_box')
      and status = 'open'
  ),
  1,
  'cron writes one risk event for a blocked due activation'
);

select is(
  (
    select count(*)::int
    from ops.app_events
    where event_name = 'cron.sync_campaign_box_statuses.completed'
      and event_source = 'cron.sync_campaign_box_statuses'
      and payload ->> 'request_context' is not null
  ),
  1,
  'cron writes one app event for the job run'
);

select finish();

rollback;
