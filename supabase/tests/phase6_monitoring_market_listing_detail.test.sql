-- Phase 6 step 2.8 market-listing monitoring jump target checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select no_plan();

insert into ops.admin_users (id, email, display_name, status)
values (
  'aaaaaaaa-2808-4000-8000-000000000101'::uuid,
  'phase6-market-listing-detail@example.invalid',
  'phase6 market listing detail admin',
  'active'
)
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

insert into ops.admin_roles (code, display_name, permissions)
values (
  'PHASE6_MARKET_LISTING_DETAIL_ADMIN',
  'Phase 6 Market Listing Detail Admin',
  '["market:read"]'::jsonb
)
on conflict (code) do update
set display_name = excluded.display_name,
    permissions = excluded.permissions,
    updated_at = now();

insert into ops.admin_user_roles (admin_user_id, role_id)
select 'aaaaaaaa-2808-4000-8000-000000000101'::uuid, id
from ops.admin_roles
where code = 'PHASE6_MARKET_LISTING_DETAIL_ADMIN'
on conflict do nothing;

insert into core.users (id, telegram_user_id, username, status)
values (
  'aaaaaaaa-2808-4000-8000-000000000201'::uuid,
  2808000201,
  'phase6_market_seller',
  'active'
)
on conflict (id) do update
set telegram_user_id = excluded.telegram_user_id,
    username = excluded.username,
    status = excluded.status;

with chosen as (
  select
    t.id as template_id,
    t.rarity_code,
    (
      select f.id
      from catalog.collectible_forms f
      where f.template_id = t.id
      order by f.is_default desc, f.form_index, f.id
      limit 1
    ) as form_id
  from catalog.collectible_templates t
  order by t.sort_order, t.id
  limit 1
)
insert into inventory.item_instances (
  id,
  owner_user_id,
  template_id,
  form_id,
  level,
  power,
  status,
  source_type,
  source_id
)
select
  'aaaaaaaa-2808-4000-8000-000000000301'::uuid,
  'aaaaaaaa-2808-4000-8000-000000000201'::uuid,
  chosen.template_id,
  chosen.form_id,
  7,
  77,
  'listed',
  'gacha',
  null
from chosen
on conflict (id) do update
set owner_user_id = excluded.owner_user_id,
    template_id = excluded.template_id,
    form_id = excluded.form_id,
    level = excluded.level,
    power = excluded.power,
    status = excluded.status;

with chosen as (
  select
    ii.template_id,
    ii.form_id,
    t.rarity_code
  from inventory.item_instances ii
  join catalog.collectible_templates t on t.id = ii.template_id
  where ii.id = 'aaaaaaaa-2808-4000-8000-000000000301'::uuid
)
insert into market.listings (
  id,
  seller_user_id,
  template_id,
  form_id,
  rarity_code,
  status,
  item_count,
  remaining_count,
  unit_price_kcoin,
  fee_bps,
  expected_net_amount,
  price_health
)
select
  'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
  'aaaaaaaa-2808-4000-8000-000000000201'::uuid,
  chosen.template_id,
  chosen.form_id,
  chosen.rarity_code,
  'active',
  1,
  1,
  120,
  500,
  114,
  'healthy'
from chosen
on conflict (id) do update
set status = excluded.status,
    item_count = excluded.item_count,
    remaining_count = excluded.remaining_count,
    unit_price_kcoin = excluded.unit_price_kcoin,
    fee_bps = excluded.fee_bps,
    expected_net_amount = excluded.expected_net_amount,
    price_health = excluded.price_health;

insert into market.listing_items (
  listing_id,
  item_instance_id,
  status
)
values (
  'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
  'aaaaaaaa-2808-4000-8000-000000000301'::uuid,
  'reserved'
)
on conflict (listing_id, item_instance_id) do update
set status = excluded.status;

insert into market.listing_events (listing_id, user_id, event_type)
values (
  'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
  'aaaaaaaa-2808-4000-8000-000000000201'::uuid,
  'created'
);

select ok(
  to_regprocedure('api.admin_get_market_listing_detail(uuid,uuid,jsonb)') is not null,
  'api.admin_get_market_listing_detail RPC exists'
);

select ok(
  has_function_privilege(
    'service_role',
    'api.admin_get_market_listing_detail(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'service_role can execute market listing detail RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'api.admin_get_market_listing_detail(uuid,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'anon cannot execute market listing detail RPC'
);

select is(
  api.admin_get_market_listing_detail(
    'aaaaaaaa-2808-4000-8000-000000000101'::uuid,
    'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
    '{}'::jsonb
  ) ->> 'id',
  'aaaaaaaa-2808-4000-8000-000000000401',
  'market listing detail returns the requested listing'
);

select is(
  api.admin_get_market_listing_detail(
    'aaaaaaaa-2808-4000-8000-000000000101'::uuid,
    'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
    '{}'::jsonb
  ) #>> '{items,0,itemInstanceId}',
  'aaaaaaaa-2808-4000-8000-000000000301',
  'market listing detail returns bounded item rows'
);

select ok(
  position(
    'seller_user_id' in api.admin_get_market_listing_detail(
      'aaaaaaaa-2808-4000-8000-000000000101'::uuid,
      'aaaaaaaa-2808-4000-8000-000000000401'::uuid,
      '{}'::jsonb
    )::text
  ) = 0,
  'market listing detail does not expose seller user ids'
);

select * from finish();

rollback;
