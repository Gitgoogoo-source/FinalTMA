-- Verifies Phase 2 stage 15.4 marketplace update-price database behavior.
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
  p_rarity_code text default 'RARE'
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
    30, 100, 'active', true, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = true,
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

select plan(12);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
insert into _ids (key, id) values ('seller', testutil.make_user(9817000001, 'market_update_seller'));
insert into _ids (key, id) values ('other', testutil.make_user(9817000002, 'market_update_other'));
insert into _ids (key, id) values ('buyer', testutil.make_user(9817000003, 'market_update_buyer'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('market-update-price', 'RARE'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'item1', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 31);
insert into _ids (key, id) select 'item2', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 32);
insert into _ids (key, id) select 'sold_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 33);

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'buyer'),
    'KCOIN',
    500,
    'test_setup',
    null,
    null,
    'market-update-price-buyer-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
select 'listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')],
  120,
  'market-update-price-create-001'
);
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

insert into _ids (key, payload)
select 'update', api.market_update_listing_price(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'listing_id'),
  150,
  'market-update-price-update-001'
);

select is(((select payload from _ids where key = 'update') ->> 'unit_price_kcoin')::numeric, 150::numeric, 'seller can update listing price');
select is((select unit_price_kcoin from market.listings where id = (select id from _ids where key = 'listing_id')), 150::numeric, 'listing row stores updated price');
select is((select expected_net_amount from market.listings where id = (select id from _ids where key = 'listing_id')), 285::numeric, 'update recalculates expected net amount for remaining items');
select isnt((select last_price_changed_at from market.listings where id = (select id from _ids where key = 'listing_id')), null::timestamptz, 'update sets last_price_changed_at');
select ok(exists (
  select 1
  from market.listing_events
  where listing_id = (select id from _ids where key = 'listing_id')
    and user_id = (select id from _ids where key = 'seller')
    and event_type = 'price_changed'
    and metadata ->> 'idempotency_key' = 'market-update-price-update-001'
    and (after_state ->> 'unit_price_kcoin')::numeric = 150
), 'update writes price_changed listing event');

insert into _ids (key, payload)
select 'update_repeat', api.market_update_listing_price(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'listing_id'),
  150,
  'market-update-price-update-001'
);
select ok(((select payload from _ids where key = 'update_repeat') ->> 'idempotent')::boolean, 'repeated update with same idempotency key is idempotent');
select ok(testutil.raises_like(format(
  'select api.market_update_listing_price(%L::uuid, %L::uuid, 175, %L)',
  (select id::text from _ids where key = 'other'),
  (select id::text from _ids where key = 'listing_id'),
  'market-update-price-other-001'
), '%not listing owner%'), 'non-seller cannot update listing price');
select is((select unit_price_kcoin from market.listings where id = (select id from _ids where key = 'listing_id')), 150::numeric, 'failed non-seller update does not change price');

insert into _ids (key, payload)
select 'sold_listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'sold_item')],
  100,
  'market-update-price-sold-create-001'
);
insert into _ids (key, id) select 'sold_listing_id', ((select payload from _ids where key = 'sold_listing') ->> 'listing_id')::uuid;
insert into _ids (key, payload)
select 'sold_buy', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'sold_listing_id'),
  1,
  100,
  'market-update-price-sold-buy-001'
);
insert into _ids (key, id) select 'sold_order_id', ((select payload from _ids where key = 'sold_buy') ->> 'order_id')::uuid;

select is((select status from market.listings where id = (select id from _ids where key = 'sold_listing_id')), 'sold', 'single-item listing is sold after purchase');
select ok(testutil.raises_like(format(
  'select api.market_update_listing_price(%L::uuid, %L::uuid, 130, %L)',
  (select id::text from _ids where key = 'seller'),
  (select id::text from _ids where key = 'sold_listing_id'),
  'market-update-price-sold-update-001'
), '%listing is not editable%'), 'sold listing cannot be updated');
select is((select unit_price_kcoin from market.orders where id = (select id from _ids where key = 'sold_order_id')), 100::numeric, 'historical order price remains unchanged');
select is((select unit_price_kcoin from market.listings where id = (select id from _ids where key = 'sold_listing_id')), 100::numeric, 'failed sold-listing update leaves listing price unchanged');

select * from finish();

rollback;
