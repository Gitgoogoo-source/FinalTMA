-- Verifies Phase 2 stage 15.2 and 15.3 marketplace buy-listing behavior.
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

create or replace function testutil.balance_of(p_user_id uuid, p_currency_code text)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id and currency_code = upper(p_currency_code)
  ), 0)::numeric;
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

select plan(30);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
insert into _ids (key, id) values ('seller', testutil.make_user(9816000001, 'market_buy_listing_seller'));
insert into _ids (key, id) values ('buyer', testutil.make_user(9816000002, 'market_buy_listing_buyer'));
insert into _ids (key, id) values ('low_buyer', testutil.make_user(9816000003, 'market_buy_listing_low_buyer'));
insert into _ids (key, id) values ('rival_buyer', testutil.make_user(9816000004, 'market_buy_listing_rival_buyer'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('market-buy-listing', 'RARE'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;
insert into _ids (key, id) select 'item1', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 31);
insert into _ids (key, id) select 'item2', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 32);
insert into _ids (key, id) select 'self_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 33);
insert into _ids (key, id) select 'poor_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 34);
insert into _ids (key, id) select 'cancel_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 35);
insert into _ids (key, id) select 'race_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form'), 36);

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'buyer'),
    'KCOIN',
    500,
    'test_setup',
    null,
    null,
    'market-buy-listing-buyer-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
  perform api._credit_balance(
    (select id from _ids where key = 'rival_buyer'),
    'KCOIN',
    200,
    'test_setup',
    null,
    null,
    'market-buy-listing-rival-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
select 'listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')],
  100,
  'market-buy-listing-create-001'
);
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

insert into _ids (key, payload)
select 'buy', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'listing_id'),
  1,
  100,
  'market-buy-listing-order-001'
);
insert into _ids (key, id) select 'order_id', ((select payload from _ids where key = 'buy') ->> 'order_id')::uuid;
insert into _ids (key, id)
select 'purchased_item', item_instance_id
from market.order_items
where order_id = (select id from _ids where key = 'order_id');

select isnt((select id from _ids where key = 'order_id'), null::uuid, 'buyer with enough balance can create a completed order');
select is(((select payload from _ids where key = 'buy') ->> 'total_price_kcoin')::numeric, 100::numeric, 'buy RPC returns total price');
select is(((select payload from _ids where key = 'buy') ->> 'buyer_balance_after')::numeric, 400::numeric, 'buy RPC returns buyer balance after debit');
select is(testutil.balance_of((select id from _ids where key = 'buyer'), 'KCOIN'), 400::numeric, 'buyer balance decreases by listing price');
select is(testutil.balance_of((select id from _ids where key = 'seller'), 'KCOIN'), 95::numeric, 'seller balance increases by net proceeds');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'purchased_item')), (select id from _ids where key = 'buyer'), 'purchased item owner changes to buyer');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'purchased_item')), 'available', 'purchased item returns to available inventory status');
select is((select count(*)::int from market.orders where id = (select id from _ids where key = 'order_id') and status = 'completed'), 1, 'completed order row is written');
select is((select item_count from market.orders where id = (select id from _ids where key = 'order_id')), 1, 'order records purchased quantity');
select is((select count(*)::int from market.order_items where order_id = (select id from _ids where key = 'order_id')), 1, 'order_items row is written');
select is((select count(*)::int from market.order_items oi join market.listing_items li on li.id = oi.listing_item_id where oi.order_id = (select id from _ids where key = 'order_id') and li.status = 'sold'), 1, 'sold listing_item is linked to the order_item');
select is((select fee_amount_kcoin from market.orders where id = (select id from _ids where key = 'order_id')), 5::numeric, 'order records market fee amount');
select ok(exists (
  select 1
  from market.fee_settlements
  where market_order_id = (select id from _ids where key = 'order_id')
    and currency_code = 'KCOIN'
    and fee_amount = 5
    and status = 'settled'
), 'fee settlement row exists');
select is((select remaining_count from market.listings where id = (select id from _ids where key = 'listing_id')), 1, 'listing remaining_count decreases after buying one item');
select is((select status from market.listings where id = (select id from _ids where key = 'listing_id')), 'partially_sold', 'multi-item listing becomes partially_sold after one purchase');
select is((select count(*)::int from market.listing_items where listing_id = (select id from _ids where key = 'listing_id') and status = 'reserved'), 1, 'unbought listing item remains reserved');

insert into _ids (key, payload)
select 'buy_repeat', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'listing_id'),
  1,
  100,
  'market-buy-listing-order-001'
);
select ok(((select payload from _ids where key = 'buy_repeat') ->> 'idempotent')::boolean, 'repeated buy with same idempotency_key returns idempotent=true');
select is((select count(*)::int from market.orders where idempotency_key = 'market-buy-listing-order-001'), 1, 'repeated buy does not create a duplicate order');
select is(testutil.balance_of((select id from _ids where key = 'buyer'), 'KCOIN'), 400::numeric, 'repeated buy does not charge buyer twice');

insert into _ids (key, payload)
select 'self_listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'self_item')],
  100,
  'market-buy-listing-self-create-001'
);
insert into _ids (key, id) select 'self_listing_id', ((select payload from _ids where key = 'self_listing') ->> 'listing_id')::uuid;
select ok(testutil.raises_like(format(
  'select api.market_buy_listing(%L::uuid, %L::uuid, 1, 100, %L)',
  (select id::text from _ids where key = 'seller'),
  (select id::text from _ids where key = 'self_listing_id'),
  'market-buy-listing-self-buy-001'
), '%buyer cannot buy own listing%'), 'seller cannot buy own listing');

insert into _ids (key, payload)
select 'poor_listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'poor_item')],
  250,
  'market-buy-listing-poor-create-001'
);
insert into _ids (key, id) select 'poor_listing_id', ((select payload from _ids where key = 'poor_listing') ->> 'listing_id')::uuid;
select ok(testutil.raises_like(format(
  'select api.market_buy_listing(%L::uuid, %L::uuid, 1, 250, %L)',
  (select id::text from _ids where key = 'low_buyer'),
  (select id::text from _ids where key = 'poor_listing_id'),
  'market-buy-listing-poor-buy-001'
), '%insufficient balance:%'), 'buyer with insufficient KCOIN cannot buy listing');
select is((select count(*)::int from market.orders where idempotency_key = 'market-buy-listing-poor-buy-001'), 0, 'insufficient balance does not create an order');

insert into _ids (key, payload)
select 'cancel_listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'cancel_item')],
  100,
  'market-buy-listing-cancel-create-001'
);
insert into _ids (key, id) select 'cancel_listing_id', ((select payload from _ids where key = 'cancel_listing') ->> 'listing_id')::uuid;
insert into _ids (key, payload)
select 'cancel_listing_result', api.market_cancel_listing(
  (select id from _ids where key = 'seller'),
  (select id from _ids where key = 'cancel_listing_id'),
  'market-buy-listing-cancel-001'
);
select ok(testutil.raises_like(format(
  'select api.market_buy_listing(%L::uuid, %L::uuid, 1, 100, %L)',
  (select id::text from _ids where key = 'buyer'),
  (select id::text from _ids where key = 'cancel_listing_id'),
  'market-buy-listing-cancelled-buy-001'
), '%listing is not buyable%'), 'cancelled listing cannot be bought');
select is((select count(*)::int from market.orders where idempotency_key = 'market-buy-listing-cancelled-buy-001'), 0, 'cancelled listing buy does not create an order');

insert into _ids (key, payload)
select 'race_listing', api.market_create_listing(
  (select id from _ids where key = 'seller'),
  array[(select id from _ids where key = 'race_item')],
  100,
  'market-buy-listing-race-create-001'
);
insert into _ids (key, id) select 'race_listing_id', ((select payload from _ids where key = 'race_listing') ->> 'listing_id')::uuid;
insert into _ids (key, payload)
select 'race_buy_one', api.market_buy_listing(
  (select id from _ids where key = 'buyer'),
  (select id from _ids where key = 'race_listing_id'),
  1,
  100,
  'market-buy-listing-race-buy-001'
);
insert into _ids (key, id) select 'race_order_id', ((select payload from _ids where key = 'race_buy_one') ->> 'order_id')::uuid;
select isnt((select id from _ids where key = 'race_order_id'), null::uuid, 'first final-item buy creates an order');
select ok(testutil.raises_like(format(
  'select api.market_buy_listing(%L::uuid, %L::uuid, 1, 100, %L)',
  (select id::text from _ids where key = 'rival_buyer'),
  (select id::text from _ids where key = 'race_listing_id'),
  'market-buy-listing-race-buy-002'
), '%listing is not buyable%'), 'sold-out final item cannot be bought by a competing buyer');
select is((select count(*)::int from market.orders where listing_id = (select id from _ids where key = 'race_listing_id')), 1, 'competing final-item buy attempts create only one order');
select is((
  select count(*)::int
  from market.order_items oi
  join market.orders o on o.id = oi.order_id
  where o.listing_id = (select id from _ids where key = 'race_listing_id')
), 1, 'competing final-item buy attempts transfer only one item');
select is(testutil.balance_of((select id from _ids where key = 'rival_buyer'), 'KCOIN'), 200::numeric, 'failed competing buyer is not charged');
select is((select status from market.listings where id = (select id from _ids where key = 'race_listing_id')), 'sold', 'final-item listing is sold after the only successful buy');

select * from finish();

rollback;
