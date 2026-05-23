-- Verifies Phase 2 stage-5 marketplace RPC contracts.
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
  p_power integer default 10
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

select plan(41);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
insert into _ids (key, id) values ('seller', testutil.make_user(9700000001, 'market_rpc_seller'));
insert into _ids (key, id) values ('buyer', testutil.make_user(9700000002, 'market_rpc_buyer'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('market-rpc-stage5', 'RARE'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'item1', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 30);
insert into _ids (key, id) select 'item2', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 31);
insert into _ids (key, id) select 'minting_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 32);
update inventory.item_instances
set nft_mint_status = 'queued'
where id = (select id from _ids where key = 'minting_item');

do $$
begin
  perform api._credit_balance((select id from _ids where key = 'buyer'), 'KCOIN', 500, 'test_setup', null, null, 'market-rpc-buyer-kcoin-001', 'fixture', '{}'::jsonb);
end;
$$;

select ok(testutil.raises_like(format('select api.market_create_listing(%L::uuid, array[%L::uuid], 100, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'minting_item'), 'market-rpc-create-minting-001'), '%some items are not sellable%'), 'mint queued item cannot be listed');

insert into _ids (key, payload)
select 'sell_rules', api.market_get_sell_rules((select id from _ids where key = 'seller'));
select is(((select payload from _ids where key = 'sell_rules') ->> 'fee_bps')::int, 500, 'sell rules returns active market fee bps');

insert into _ids (key, payload)
select 'listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'item1')], 100, 'market-rpc-create-001');
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

select is(((select payload from _ids where key = 'listing') ->> 'remaining_count')::int, 1, 'create listing returns remaining_count');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'item1')), 'listed', 'created listing marks item listed');
select ok(exists (select 1 from market.listing_events where listing_id = (select id from _ids where key = 'listing_id') and event_type = 'created'), 'created event is recorded');

insert into _ids (key, payload)
select 'listing_repeat', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'item1')], 100, 'market-rpc-create-001');
select ok(((select payload from _ids where key = 'listing_repeat') ->> 'idempotent')::boolean, 'repeated create listing is idempotent');
select is(((select payload from _ids where key = 'listing_repeat') ->> 'expected_net_amount')::numeric, 95::numeric, 'idempotent create listing returns backend expected net amount');
select is(((select payload from _ids where key = 'listing_repeat') ->> 'fee_bps')::int, 500, 'idempotent create listing returns backend fee bps');
select is((
  select count(*)::int
  from ops.app_events
  where user_id = (select id from _ids where key = 'seller')
    and event_name = 'market_listing_created'
    and payload ->> 'task_action_type' = 'sell_market'
    and (payload ->> 'listing_id')::uuid = (select id from _ids where key = 'listing_id')
), 1, 'create listing writes one sell_market app event');
select is((
  select count(*)::int
  from ops.app_events
  where event_name = 'market_listing_created'
    and payload ->> 'idempotency_key' = 'market-rpc-create-001'
), 1, 'repeated create listing does not duplicate sell_market app event');

insert into _ids (key, payload)
select 'buyer_list', api.market_list_listings(p_user_id := (select id from _ids where key = 'buyer'), p_limit := 10);
select is(jsonb_array_length((select payload from _ids where key = 'buyer_list') -> 'items'), 1, 'market list returns active listing');
select ok((((select payload from _ids where key = 'buyer_list') #>> '{items,0,is_buyable}')::boolean), 'buyer can buy listing from list');

insert into _ids (key, payload)
select 'seller_list', api.market_list_listings(p_user_id := (select id from _ids where key = 'seller'), p_limit := 10);
select ok(not (((select payload from _ids where key = 'seller_list') #>> '{items,0,is_buyable}')::boolean), 'seller cannot buy own listing from list');

insert into _ids (key, payload)
select 'detail_buyer', api.market_get_listing_detail((select id from _ids where key = 'buyer'), (select id from _ids where key = 'listing_id'));
select ok((((select payload from _ids where key = 'detail_buyer') #>> '{listing,can_buy}')::boolean), 'listing detail says buyer can buy');
select is(((select payload from _ids where key = 'detail_buyer') #>> '{listing,price_health}'), 'unknown', 'missing price stats falls back to unknown health');

insert into _ids (key, payload)
select 'sellable_after', api.market_list_sellable_items(p_user_id := (select id from _ids where key = 'seller'), p_limit := 10);
select ok((select payload::text from _ids where key = 'sellable_after') not like '%' || (select id::text from _ids where key = 'item1') || '%', 'listed item is removed from sellable items');
select ok((select payload::text from _ids where key = 'sellable_after') like '%' || (select id::text from _ids where key = 'item2') || '%', 'available item remains sellable');

insert into _ids (key, payload)
select 'stats_before', api.market_get_my_listing_stats((select id from _ids where key = 'seller'));
select is(((select payload from _ids where key = 'stats_before') ->> 'active_listing_count')::int, 1, 'my listing stats counts active listing');
select is(((select payload from _ids where key = 'stats_before') ->> 'active_item_count')::int, 1, 'my listing stats counts active item');

insert into _ids (key, payload)
select 'update_price', api.market_update_listing_price((select id from _ids where key = 'seller'), (select id from _ids where key = 'listing_id'), 150, 'market-rpc-update-001');
select is(((select payload from _ids where key = 'update_price') ->> 'unit_price_kcoin')::numeric, 150::numeric, 'update price returns new price');
select is((select unit_price_kcoin from market.listings where id = (select id from _ids where key = 'listing_id')), 150::numeric, 'listing row stores new price');
select ok(exists (select 1 from market.listing_events where listing_id = (select id from _ids where key = 'listing_id') and event_type = 'price_changed'), 'price_changed event is recorded');

insert into _ids (key, payload)
select 'update_repeat', api.market_update_listing_price((select id from _ids where key = 'seller'), (select id from _ids where key = 'listing_id'), 150, 'market-rpc-update-001');
select ok(((select payload from _ids where key = 'update_repeat') ->> 'idempotent')::boolean, 'repeated price update is idempotent');
select ok(testutil.raises_like(format('select api.market_update_listing_price(%L::uuid, %L::uuid, 160, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'listing_id'), 'market-rpc-update-001'), '%idempotency conflict%'), 'same update key with different price is rejected');
select ok(testutil.raises_like(format('select api.market_create_listing(%L::uuid, array[%L::uuid], 180, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'item2'), 'market-rpc-update-001'), '%idempotency conflict%'), 'create listing cannot reuse a price update idempotency key');

insert into _ids (key, payload)
select 'refresh_before_buy', api.market_refresh_price_stats();
select ok(((select payload from _ids where key = 'refresh_before_buy') ->> 'price_snapshot_count')::int >= 1, 'refresh writes price snapshot');
select is((
  select floor_price_kcoin
  from market.price_snapshots
  where template_id = (select id from _ids where key = 'template')
    and form_id = (select id from _ids where key = 'form')
  order by snapshot_at desc
  limit 1
), 150::numeric, 'price stats floor follows updated listing price');
select is((
  select price_bucket_kcoin
  from market.depth_snapshots
  where template_id = (select id from _ids where key = 'template')
    and form_id = (select id from _ids where key = 'form')
  order by snapshot_at desc, price_bucket_kcoin asc
  limit 1
), 100::numeric, 'market depth uses fixed 100-499 bucket for 150 KCOIN listing');

select ok(testutil.raises_like(format('select api.market_buy_listing(%L::uuid, %L::uuid, 1, 100, %L)', (select id::text from _ids where key = 'buyer'), (select id::text from _ids where key = 'listing_id'), 'market-rpc-buy-old-price-001'), '%listing price changed%'), 'buy with stale expected price is rejected');

insert into _ids (key, payload)
select 'buy', api.market_buy_listing((select id from _ids where key = 'buyer'), (select id from _ids where key = 'listing_id'), 1, 150, 'market-rpc-buy-001');
insert into _ids (key, id) select 'order_id', ((select payload from _ids where key = 'buy') ->> 'order_id')::uuid;

select is((select status from market.listings where id = (select id from _ids where key = 'listing_id')), 'sold', 'listing becomes sold after buy');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'item1')), (select id from _ids where key = 'buyer'), 'buy transfers item owner');
select ok(exists (select 1 from inventory.item_instance_events where item_instance_id = (select id from _ids where key = 'item1') and event_type = 'sold'), 'seller sold item event is recorded');
select ok(exists (select 1 from inventory.item_instance_events where item_instance_id = (select id from _ids where key = 'item1') and event_type = 'bought'), 'buyer bought item event is recorded');
select ok(exists (select 1 from market.fee_settlements where market_order_id = (select id from _ids where key = 'order_id')), 'fee settlement is recorded');

insert into _ids (key, payload)
select 'buy_repeat', api.market_buy_listing((select id from _ids where key = 'buyer'), (select id from _ids where key = 'listing_id'), 1, 150, 'market-rpc-buy-001');
select ok(((select payload from _ids where key = 'buy_repeat') ->> 'idempotent')::boolean, 'repeated buy is idempotent');
select is((
  select count(*)::int
  from ops.app_events
  where user_id = (select id from _ids where key = 'buyer')
    and event_name = 'market_order_completed'
    and payload ->> 'task_action_type' = 'buy_market'
    and (payload ->> 'order_id')::uuid = (select id from _ids where key = 'order_id')
), 1, 'buy listing writes one buy_market app event');
select is((
  select count(*)::int
  from ops.app_events
  where event_name = 'market_order_completed'
    and payload ->> 'idempotency_key' = 'market-rpc-buy-001'
), 1, 'repeated buy does not duplicate buy_market app event');

insert into _ids (key, payload)
select 'refresh_after_buy', api.market_refresh_price_stats();
select ok(((select payload from _ids where key = 'refresh_after_buy') ->> 'price_snapshot_count')::int >= 1, 'refresh after buy writes sale snapshot');
select is((
  select last_sale_price_kcoin
  from market.price_snapshots
  where template_id = (select id from _ids where key = 'template')
    and form_id = (select id from _ids where key = 'form')
  order by snapshot_at desc
  limit 1
), 150::numeric, 'price stats records last sale price');

insert into _ids (key, payload)
select 'stats_after', api.market_get_my_listing_stats((select id from _ids where key = 'seller'));
select is(((select payload from _ids where key = 'stats_after') ->> 'active_listing_count')::int, 0, 'sold listing is removed from active stats');
select is(((select payload from _ids where key = 'stats_after') ->> 'sold_24h_count')::int, 1, 'seller stats counts 24h sale');

select * from finish();

rollback;
