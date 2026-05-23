-- Verifies Phase 2 stage 15.1 marketplace create-listing database behavior.
-- Each file wraps fixture data in a transaction and rolls back at the end.

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
  p_username text default null
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
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.create_catalog_fixture(
  p_prefix text,
  p_rarity_code text default 'RARE',
  p_tradeable boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Test Series ' || p_prefix, 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Test Faction ' || p_prefix)
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template', 'Test Collectible ' || p_prefix, 'fixture', 'test fixture collectible',
    p_rarity_code, 'CHARACTER', v_series_id, v_faction_id,
    30, 100, 'active', p_tradeable, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = excluded.tradeable,
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_id, 1, 'base', 'Base Form', 'Base form',
    'https://example.test/' || p_prefix || '/base.png',
    'https://example.test/' || p_prefix || '/base-thumb.png',
    'https://example.test/' || p_prefix || '/base-avatar.png',
    0, true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'faction_id', v_faction_id,
    'template_id', v_template_id,
    'form_id', v_form_id,
    'rarity_code', p_rarity_code
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_power integer default 30
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id, template_id, form_id, level, power, status, source_type, metadata
  ) values (
    p_user_id, p_template_id, p_form_id, 1, p_power, 'available', 'admin',
    jsonb_build_object('fixture', true)
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', 'admin', null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

select plan(10);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
insert into _ids (key, id) values ('seller', testutil.make_user(9815000001, 'market_create_seller'));
insert into _ids (key, id) values ('other', testutil.make_user(9815000002, 'market_create_other'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('market-create-listing', 'RARE', true));
insert into _ids (key, payload) values ('blocked_catalog', testutil.create_catalog_fixture('market-create-listing-blocked', 'RARE', false));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'blocked_template', ((select payload from _ids where key = 'blocked_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'blocked_form', ((select payload from _ids where key = 'blocked_catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'seller_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 31);
insert into _ids (key, id) select 'other_item', testutil.create_item((select id from _ids where key = 'other'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 32);
insert into _ids (key, id) select 'non_tradeable_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'blocked_template'), (select id from _ids where key = 'blocked_form'), 33);

insert into _ids (key, payload)
select 'listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'seller_item')], 120, 'market-create-listing-001');
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

select is(((select payload from _ids where key = 'listing') ->> 'status'), 'active', 'available item can create an active listing');
select is(((select payload from _ids where key = 'listing') ->> 'remaining_count')::int, 1, 'create listing returns one remaining item');
select is((select status from market.listings where id = (select id from _ids where key = 'listing_id')), 'active', 'listing row is active after create');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'seller_item')), 'listed', 'created listing marks item status as listed');
select ok(exists (
  select 1
  from inventory.inventory_locks
  where item_instance_id = (select id from _ids where key = 'seller_item')
    and user_id = (select id from _ids where key = 'seller')
    and lock_type = 'market_listing'
    and source_type = 'market_listing'
    and source_id = (select id from _ids where key = 'listing_id')
    and status = 'active'
), 'created listing creates an active market inventory lock');
select ok(exists (
  select 1
  from market.listing_items
  where listing_id = (select id from _ids where key = 'listing_id')
    and item_instance_id = (select id from _ids where key = 'seller_item')
    and status = 'reserved'
), 'created listing reserves the concrete item instance');
select ok(exists (
  select 1
  from inventory.item_instance_events
  where item_instance_id = (select id from _ids where key = 'seller_item')
    and user_id = (select id from _ids where key = 'seller')
    and event_type = 'listed'
    and source_type = 'market_listing'
    and source_id = (select id from _ids where key = 'listing_id')
), 'created listing records a listed item event');
select ok(testutil.raises_like(format(
  'select api.market_create_listing(%L::uuid, array[%L::uuid], 120, %L)',
  (select id::text from _ids where key = 'seller'),
  (select id::text from _ids where key = 'seller_item'),
  'market-create-listing-duplicate-item-001'
), '%some items are not sellable%'), 'same item cannot be listed again with a new idempotency key');
select ok(testutil.raises_like(format(
  'select api.market_create_listing(%L::uuid, array[%L::uuid], 120, %L)',
  (select id::text from _ids where key = 'seller'),
  (select id::text from _ids where key = 'other_item'),
  'market-create-listing-other-owner-001'
), '%some items are not sellable%'), 'seller cannot list another user item');
select ok(testutil.raises_like(format(
  'select api.market_create_listing(%L::uuid, array[%L::uuid], 120, %L)',
  (select id::text from _ids where key = 'seller'),
  (select id::text from _ids where key = 'non_tradeable_item'),
  'market-create-listing-non-tradeable-001'
), '%some items are not sellable%'), 'non-tradeable template item cannot be listed');

select * from finish();

rollback;
