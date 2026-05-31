-- Phase 6 blind box, price rule and banner campaign admin RPC checks.

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
exception
  when others then
    return sqlerrm like p_pattern;
end;
$$;

select no_plan();

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

insert into ops.admin_users (id, email, display_name, status, metadata)
values (
  '64000000-0000-4000-8000-000000000001',
  'phase6-box-campaign-admin@example.test',
  'Phase 6 Box Campaign Admin',
  'active',
  '{"test":true}'::jsonb
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id, granted_by_admin_id)
select
  '64000000-0000-4000-8000-000000000001'::uuid,
  id,
  '64000000-0000-4000-8000-000000000001'::uuid
from ops.admin_roles
where code = 'OPS'
on conflict (admin_user_id, role_id) do nothing;

insert into _ids (key, id)
values
  ('actor', '64000000-0000-4000-8000-000000000001'),
  ('box', '64000000-0000-4000-8000-000000000101'),
  ('pool', '64000000-0000-4000-8000-000000000102'),
  ('price_rule_conflict', '64000000-0000-4000-8000-000000000103'),
  ('missing_box', '64000000-0000-4000-8000-000000000104'),
  ('banner', '64000000-0000-4000-8000-000000000201'),
  ('listing_banner', '64000000-0000-4000-8000-000000000202'),
  ('payment_banner', '64000000-0000-4000-8000-000000000203'),
  ('external_banner', '64000000-0000-4000-8000-000000000204'),
  ('task', '64000000-0000-4000-8000-000000000301'),
  ('seller', '64000000-0000-4000-8000-000000000401'),
  ('listing', '64000000-0000-4000-8000-000000000501'),
  ('star_order', '64000000-0000-4000-8000-000000000601');

insert into core.users (id, telegram_user_id, username, invite_code)
values (
  (select id from _ids where key = 'seller'),
  6400000401,
  'phase6_banner_seller',
  'P6BANNER01'
)
on conflict (id) do update
set username = excluded.username,
    updated_at = now();

insert into tasks.task_definitions (
  id,
  code,
  title,
  task_type,
  period_type,
  target_count,
  reward,
  active
)
values (
  (select id from _ids where key = 'task'),
  'phase6_box_campaign_task',
  'Phase 6 Box Campaign Task',
  'daily',
  'once',
  1,
  '[]'::jsonb,
  true
)
on conflict (id) do update
set active = excluded.active,
    updated_at = now();

insert into market.listings (
  id,
  seller_user_id,
  template_id,
  rarity_code,
  status,
  item_count,
  remaining_count,
  unit_price_kcoin,
  fee_bps,
  expected_net_amount
)
select
  (select id from _ids where key = 'listing'),
  (select id from _ids where key = 'seller'),
  ct.id,
  ct.rarity_code,
  'active',
  1,
  1,
  100,
  500,
  95
from catalog.collectible_templates ct
order by ct.created_at
limit 1
on conflict (id) do update
set status = excluded.status,
    remaining_count = excluded.remaining_count,
    updated_at = now();

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
  expires_at
)
values (
  (select id from _ids where key = 'star_order'),
  (select id from _ids where key = 'seller'),
  'gacha_open',
  (select id from _ids where key = 'box'),
  'invoice_created',
  10,
  'phase6-banner-target-payment-payload',
  'Phase 6 Banner Payment Target',
  'phase6-banner-payment-target-order',
  now() + interval '1 hour'
)
on conflict (id) do update
set status = excluded.status,
    expires_at = excluded.expires_at,
    updated_at = now();

select ok(
  to_regprocedure('api.admin_upsert_blind_box(uuid,text,text,text,text,integer,text,text,jsonb,uuid,text,integer,integer,numeric,text,text,timestamptz,timestamptz,integer,jsonb)') is not null
    and to_regprocedure('api.admin_update_box_status(uuid,uuid,text,text,text,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_box_price_rule(uuid,uuid,integer,integer,text,text,jsonb,uuid,integer,boolean,timestamptz,timestamptz,jsonb)') is not null
    and to_regprocedure('api.admin_upsert_banner_campaign(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,jsonb,timestamptz,timestamptz,integer,jsonb)') is not null,
  'box and banner admin RPCs exist with p_-prefixed signatures'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'gacha'
      and t.relname = 'blind_boxes'
      and c.conname = 'blind_boxes_status_check'
      and pg_get_constraintdef(c.oid) like '%archived%'
      and pg_get_constraintdef(c.oid) not like '%hidden%'
  ),
  'blind box status constraint uses fixed phase 6 status set'
);

select ok(
  exists (
    select 1
    from pg_attribute a
    join pg_class t on t.oid = a.attrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'catalog'
      and t.relname = 'banner_campaigns'
      and a.attname = 'target_payload'
      and not a.attisdropped
  )
  and exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'catalog'
      and t.relname = 'banner_campaigns'
      and c.conname = 'banner_campaigns_target_type_check'
      and pg_get_constraintdef(c.oid) like '%listing%'
      and pg_get_constraintdef(c.oid) like '%payment%'
      and pg_get_constraintdef(c.oid) like '%external%'
      and pg_get_constraintdef(c.oid) not like '%market_listing%'
      and pg_get_constraintdef(c.oid) not like '%external_url%'
  ),
  'banner campaigns use guide target types and target_payload'
);

with signatures(signature) as (
  values
    ('api.admin_upsert_blind_box(uuid,text,text,text,text,integer,text,text,jsonb,uuid,text,integer,integer,numeric,text,text,timestamptz,timestamptz,integer,jsonb)'),
    ('api.admin_update_box_status(uuid,uuid,text,text,text,jsonb)'),
    ('api.admin_upsert_box_price_rule(uuid,uuid,integer,integer,text,text,jsonb,uuid,integer,boolean,timestamptz,timestamptz,jsonb)'),
    ('api.admin_upsert_banner_campaign(uuid,text,text,text,text,text,text,text,text,jsonb,uuid,text,text,jsonb,timestamptz,timestamptz,integer,jsonb)')
)
select ok(
  not exists (
    select 1
    from signatures
    where not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('public', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
  ),
  'box and banner admin RPCs are service_role only'
);

insert into _ids (key, payload)
values (
  'create_box',
  api.admin_upsert_blind_box(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_slug => 'phase6-admin-box',
    p_display_name => 'Phase 6 Admin Box',
    p_tier => 'normal',
    p_status => 'draft',
    p_price_stars => 12,
    p_total_stock => 100,
    p_remaining_stock => 100,
    p_open_reward_kcoin => 100,
    p_reason => 'phase 6 create blind box',
    p_idempotency_key => 'phase6-box-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'box')),
  'draft',
  'admin_upsert_blind_box creates a draft blind box'
);

insert into _ids (key, payload)
values (
  'create_box_repeat',
  api.admin_upsert_blind_box(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_slug => 'phase6-admin-box',
    p_display_name => 'Phase 6 Admin Box',
    p_tier => 'normal',
    p_status => 'draft',
    p_price_stars => 12,
    p_total_stock => 100,
    p_remaining_stock => 100,
    p_open_reward_kcoin => 100,
    p_reason => 'phase 6 create blind box',
    p_idempotency_key => 'phase6-box-create-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'create_box_repeat'))::boolean,
  'admin_upsert_blind_box returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_update_box_status(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'active',
      'phase 6 active without pool rejected',
      'phase6-box-status-active-no-pool',
      '{}'
    ),
    '%ADMIN_BOX_ACTIVE_POOL_REQUIRED%'
  ),
  'admin_update_box_status rejects active without an active drop pool'
);

insert into gacha.drop_pool_versions (
  id,
  box_id,
  version_no,
  status,
  total_weight,
  published_at,
  effective_from,
  created_by_admin_id
)
values (
  (select id from _ids where key = 'pool'),
  (select id from _ids where key = 'box'),
  1,
  'active',
  1,
  now(),
  now(),
  (select id from _ids where key = 'actor')
)
on conflict (id) do update
set status = excluded.status,
    updated_at = now();

insert into _ids (key, payload)
values (
  'activate_box',
  api.admin_update_box_status(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 activate blind box',
    p_idempotency_key => 'phase6-box-status-active-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'box')),
  'active',
  'admin_update_box_status activates after active pool exists'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_update_box_status(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'draft',
      'phase 6 invalid status transition',
      'phase6-box-status-invalid-transition',
      '{}'
    ),
    '%ADMIN_BOX_STATUS_TRANSITION_INVALID%'
  ),
  'admin_update_box_status rejects illegal status transitions'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_update_box_status(%L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'hidden',
      'phase 6 hidden status rejected',
      'phase6-box-status-hidden-rejected',
      '{}'
    ),
    '%ADMIN_BOX_STATUS_INVALID%'
  ),
  'admin_update_box_status rejects legacy hidden status'
);

insert into _ids (key, payload)
values (
  'price_rule',
  api.admin_upsert_box_price_rule(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_quantity => 10,
    p_discount_bps => 1000,
    p_reason => 'phase 6 create box price rule',
    p_idempotency_key => 'phase6-box-price-rule-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select discount_bps from gacha.box_price_rules where id = ((select payload ->> 'box_price_rule_id' from _ids where key = 'price_rule'))::uuid),
  1000,
  'admin_upsert_box_price_rule writes the discount'
);

insert into _ids (key, payload)
values (
  'price_rule_repeat',
  api.admin_upsert_box_price_rule(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_quantity => 10,
    p_discount_bps => 1000,
    p_reason => 'phase 6 create box price rule',
    p_idempotency_key => 'phase6-box-price-rule-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'price_rule_repeat'))::boolean,
  'admin_upsert_box_price_rule returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_box_price_rule(p_admin_user_id => %L::uuid, p_box_id => %L::uuid, p_quantity => 10, p_discount_bps => 500, p_reason => %L, p_idempotency_key => %L, p_price_rule_id => %L::uuid)',
      (select id::text from _ids where key = 'actor'),
      (select id::text from _ids where key = 'box'),
      'phase 6 price overlap rejected',
      'phase6-box-price-rule-overlap',
      (select id::text from _ids where key = 'price_rule_conflict')
    ),
    '%ADMIN_BOX_PRICE_RULE_WINDOW_CONFLICT%'
  ),
  'admin_upsert_box_price_rule rejects overlapping active rule windows'
);

insert into _ids (key, payload)
values (
  'banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'banner'),
    p_code => 'phase6-admin-banner',
    p_title => 'Phase 6 Admin Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/banner.png',
    p_placement => 'box_top',
    p_target_type => 'box',
    p_target_ref => (select id::text from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 create banner campaign',
    p_idempotency_key => 'phase6-banner-campaign-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select target_type from catalog.banner_campaigns where id = (select id from _ids where key = 'banner')),
  'box',
  'admin_upsert_banner_campaign writes a valid box target'
);

select is(
  (select placement from catalog.banner_campaigns where id = (select id from _ids where key = 'banner')),
  'box_top',
  'admin_upsert_banner_campaign keeps a valid top placement'
);

select is(
  (select target_payload ->> 'box_id' from catalog.banner_campaigns where id = (select id from _ids where key = 'banner')),
  (select id::text from _ids where key = 'box'),
  'admin_upsert_banner_campaign stores canonical box target payload'
);

insert into _ids (key, payload)
values (
  'listing_banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'listing_banner'),
    p_code => 'phase6-listing-banner',
    p_title => 'Phase 6 Listing Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/listing-banner.png',
    p_placement => 'market_top',
    p_target_type => 'listing',
    p_target_ref => (select id::text from _ids where key = 'listing'),
    p_status => 'active',
    p_reason => 'phase 6 create listing banner target',
    p_idempotency_key => 'phase6-listing-banner-001'
  )
);

select is(
  (select target_payload ->> 'listing_id' from catalog.banner_campaigns where id = (select id from _ids where key = 'listing_banner')),
  (select id::text from _ids where key = 'listing'),
  'admin_upsert_banner_campaign accepts a displayable listing target'
);

insert into _ids (key, payload)
values (
  'payment_banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'payment_banner'),
    p_code => 'phase6-payment-banner',
    p_title => 'Phase 6 Payment Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/payment-banner.png',
    p_placement => 'box_top',
    p_target_type => 'payment',
    p_target_payload => jsonb_build_object('star_order_id', (select id::text from _ids where key = 'star_order')),
    p_status => 'draft',
    p_reason => 'phase 6 create payment banner target',
    p_idempotency_key => 'phase6-payment-banner-001'
  )
);

select is(
  (select target_payload ->> 'star_order_id' from catalog.banner_campaigns where id = (select id from _ids where key = 'payment_banner')),
  (select id::text from _ids where key = 'star_order'),
  'admin_upsert_banner_campaign accepts a backend-created payment target'
);

insert into _ids (key, payload)
values (
  'external_banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'external_banner'),
    p_code => 'phase6-external-banner',
    p_title => 'Phase 6 External Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/external-banner.png',
    p_placement => 'home_top',
    p_target_type => 'external',
    p_target_ref => 'https://example.test/event',
    p_status => 'draft',
    p_reason => 'phase 6 create external banner target',
    p_idempotency_key => 'phase6-external-banner-001'
  )
);

select is(
  (select target_payload ->> 'url' from catalog.banner_campaigns where id = (select id from _ids where key = 'external_banner')),
  'https://example.test/event',
  'admin_upsert_banner_campaign accepts an https external target'
);

insert into _ids (key, id)
values ('home_banner', '88888888-8888-4888-8888-888888888888');

insert into _ids (key, payload)
values (
  'home_banner_payload',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'home_banner'),
    p_code => 'phase6-home-top-banner',
    p_title => 'Phase 6 Home Top Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/home-top-banner.png',
    p_placement => 'home_top',
    p_target_type => 'none',
    p_status => 'draft',
    p_reason => 'phase 6 create home top banner campaign',
    p_idempotency_key => 'phase6-home-top-banner-001'
  )
);

select is(
  (select placement from catalog.banner_campaigns where id = (select id from _ids where key = 'home_banner')),
  'home_top',
  'admin_upsert_banner_campaign accepts home_top placement'
);

insert into _ids (key, payload)
values (
  'banner_repeat',
  api.admin_upsert_banner_campaign(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_banner_campaign_id => (select id from _ids where key = 'banner'),
    p_code => 'phase6-admin-banner',
    p_title => 'Phase 6 Admin Banner',
    p_image_url => '/storage/v1/object/public/banners/phase6/banner.png',
    p_placement => 'box_top',
    p_target_type => 'box',
    p_target_ref => (select id::text from _ids where key = 'box'),
    p_status => 'active',
    p_reason => 'phase 6 create banner campaign',
    p_idempotency_key => 'phase6-banner-campaign-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select ok(
  ((select payload ->> 'idempotent' from _ids where key = 'banner_repeat'))::boolean,
  'admin_upsert_banner_campaign returns idempotent repeat'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_ref => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-missing-target-banner',
      'Phase 6 Missing Target Banner',
      '/storage/v1/object/public/banners/phase6/missing-target-banner.png',
      'box_top',
      'box',
      (select id::text from _ids where key = 'missing_box'),
      'active',
      'phase 6 missing banner target rejected',
      'phase6-banner-missing-target'
    ),
    '%ADMIN_BANNER_TARGET_NOT_FOUND%'
  ),
  'admin_upsert_banner_campaign rejects missing target references'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_ref => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-non-storage-banner',
      'Phase 6 Non Storage Banner',
      'https://cdn.example.test/banner.png',
      'box_top',
      'box',
      (select id::text from _ids where key = 'box'),
      'draft',
      'phase 6 non storage banner rejected',
      'phase6-banner-non-storage'
    ),
    '%banner_campaigns_image_url_storage_check%'
  ),
  'admin_upsert_banner_campaign rejects non-Storage image_url values'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_ref => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-legacy-listing-target-banner',
      'Phase 6 Legacy Listing Target Banner',
      '/storage/v1/object/public/banners/phase6/legacy-listing-target-banner.png',
      'market_top',
      'market_listing',
      (select id::text from _ids where key = 'listing'),
      'draft',
      'phase 6 legacy target rejected',
      'phase6-banner-legacy-target'
    ),
    '%ADMIN_BANNER_TARGET_TYPE_INVALID%'
  ),
  'admin_upsert_banner_campaign rejects legacy market_listing target type'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_ref => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-external-http-banner',
      'Phase 6 External HTTP Banner',
      '/storage/v1/object/public/banners/phase6/external-http-banner.png',
      'home_top',
      'external',
      'http://example.test/event',
      'draft',
      'phase 6 external protocol rejected',
      'phase6-banner-external-http'
    ),
    '%ADMIN_BANNER_EXTERNAL_URL_INVALID%'
  ),
  'admin_upsert_banner_campaign rejects non-whitelisted external URL protocols'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_target_payload => %L::jsonb, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-payment-status-banner',
      'Phase 6 Payment Status Banner',
      '/storage/v1/object/public/banners/phase6/payment-status-banner.png',
      'box_top',
      'payment',
      jsonb_build_object('star_order_id', (select id::text from _ids where key = 'star_order'), 'payment_status', 'paid')::text,
      'draft',
      'phase 6 payment status payload rejected',
      'phase6-banner-payment-status'
    ),
    '%ADMIN_BANNER_PAYMENT_TARGET_PAYLOAD_INVALID%'
  ),
  'admin_upsert_banner_campaign rejects hard-coded payment success state'
);

select ok(
  testutil.raises_like(
    format(
      'select api.admin_upsert_banner_campaign(p_admin_user_id => %L::uuid, p_code => %L, p_title => %L, p_image_url => %L, p_placement => %L, p_target_type => %L, p_status => %L, p_reason => %L, p_idempotency_key => %L)',
      (select id::text from _ids where key = 'actor'),
      'phase6-legacy-home-banner',
      'Phase 6 Legacy Home Banner',
      '/storage/v1/object/public/banners/phase6/legacy-home-banner.png',
      'home',
      'none',
      'draft',
      'phase 6 legacy home placement rejected',
      'phase6-legacy-home-banner'
    ),
    '%ADMIN_BANNER_PLACEMENT_INVALID%'
  ),
  'admin_upsert_banner_campaign rejects legacy home placement'
);

insert into _ids (key, payload)
values (
  'end_box',
  api.admin_update_box_status(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_status => 'ended',
    p_reason => 'phase 6 end blind box',
    p_idempotency_key => 'phase6-box-status-ended-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

insert into _ids (key, payload)
values (
  'archive_box',
  api.admin_update_box_status(
    p_admin_user_id => (select id from _ids where key = 'actor'),
    p_box_id => (select id from _ids where key = 'box'),
    p_status => 'archived',
    p_reason => 'phase 6 archive blind box',
    p_idempotency_key => 'phase6-box-status-archived-001',
    p_request_context => jsonb_build_object('ip_hash', 'phase6-ip', 'user_agent_hash', 'phase6-ua')
  )
);

select is(
  (select status from gacha.blind_boxes where id = (select id from _ids where key = 'box')),
  'archived',
  'admin_update_box_status allows ended to archived'
);

select is(
  (
    select count(distinct action)::int
    from ops.admin_audit_logs
    where admin_user_id = (select id from _ids where key = 'actor')
      and action in (
        'gacha.blind_box.create',
        'gacha.blind_box.status_update',
        'gacha.box_price_rule.upsert',
        'catalog.banner_campaign.upsert'
      )
  ),
  4,
  'all box and banner admin RPCs write audit logs'
);

select finish();

rollback;
