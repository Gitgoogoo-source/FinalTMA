-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

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
  p_username text default null,
  p_start_param text default null
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
    p_start_param := p_start_param,
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

select no_plan();


create or replace function testutil.create_catalog_fixture(
  p_prefix text,
  p_rarity_code text default 'COMMON',
  p_tradeable boolean default true,
  p_upgradeable boolean default true,
  p_evolvable boolean default true,
  p_decomposable boolean default true,
  p_nft_mintable boolean default true
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form1_id uuid;
  v_form2_id uuid;
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
    case when p_rarity_code = 'LEGENDARY' then 100 when p_rarity_code = 'EPIC' then 60 when p_rarity_code = 'RARE' then 30 else 10 end,
    100, 'active', p_tradeable, p_upgradeable, p_evolvable, p_decomposable, p_nft_mintable, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = excluded.tradeable,
      upgradeable = excluded.upgradeable,
      evolvable = excluded.evolvable,
      decomposable = excluded.decomposable,
      nft_mintable = excluded.nft_mintable,
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
  returning id into v_form1_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_id, 2, 'evolved', 'Evolved Form', 'Evolved form',
    'https://example.test/' || p_prefix || '/evolved.png',
    'https://example.test/' || p_prefix || '/evolved-thumb.png',
    'https://example.test/' || p_prefix || '/evolved-avatar.png',
    20, false
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = false,
      updated_at = now()
  returning id into v_form2_id;

  update catalog.collectible_forms
  set next_form_id = v_form2_id,
      updated_at = now()
  where id = v_form1_id;

  return jsonb_build_object(
    'series_id', v_series_id,
    'faction_id', v_faction_id,
    'template_id', v_template_id,
    'form1_id', v_form1_id,
    'form2_id', v_form2_id,
    'rarity_code', p_rarity_code
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer default 1,
  p_power integer default 10,
  p_source_type text default 'admin'
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
    p_user_id, p_template_id, p_form_id, p_level, p_power, 'available', p_source_type,
    jsonb_build_object('fixture', true)
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', p_source_type, null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('seller', testutil.make_user(9900000001, 'market_cancel_seller', null));
insert into _ids (key, id) values ('other', testutil.make_user(9900000002, 'market_cancel_other', null));
insert into _ids (key, id) values ('buyer', testutil.make_user(9900000003, 'market_cancel_buyer', null));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('market-cancel', 'COMMON', true, true, true, true, true));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1', ((select payload from _ids where key = 'catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'item1', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 10, 'admin');
insert into _ids (key, id) select 'item2', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 11, 'admin');
insert into _ids (key, id) select 'partial_item1', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 14, 'admin');
insert into _ids (key, id) select 'partial_item2', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 15, 'admin');

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'buyer'),
    'KCOIN',
    500,
    'test_setup',
    null,
    null,
    'market-cancel-buyer-kcoin-001',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload) select 'listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')], 120, 'market-cancel-listing-001');
insert into _ids (key, id) select 'listing_id', ((select payload from _ids where key = 'listing') ->> 'listing_id')::uuid;

select ok(testutil.raises_like(format('select api.market_cancel_listing(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'other'), (select id::text from _ids where key = 'listing_id'), 'market-cancel-other-001'), '%not listing owner%'), 'non-owner cannot cancel listing');

insert into _ids (key, payload) select 'cancel', api.market_cancel_listing((select id from _ids where key = 'seller'), (select id from _ids where key = 'listing_id'), 'market-cancel-cancel-001');
select is(((select payload from _ids where key = 'cancel') ->> 'status'), 'cancelled', 'cancel RPC returns cancelled status');
select is((select status from market.listings where id = (select id from _ids where key = 'listing_id')), 'cancelled', 'listing status becomes cancelled');
select is((select remaining_count from market.listings where id = (select id from _ids where key = 'listing_id')), 0, 'cancelled listing has zero remaining_count');
select is((select count(*)::int from market.listing_items where listing_id = (select id from _ids where key = 'listing_id') and status = 'cancelled'), 2, 'reserved listing items become cancelled');
select is((select count(*)::int from inventory.item_instances where id in ((select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')) and status = 'available'), 2, 'cancel releases listed items back to available');
select is((select count(*)::int from inventory.inventory_locks where source_id = (select id from _ids where key = 'listing_id') and source_type = 'market_listing' and status = 'released'), 2, 'cancel releases active inventory locks');
select ok(exists (select 1 from market.listing_events where listing_id = (select id from _ids where key = 'listing_id') and event_type = 'cancelled'), 'cancel listing event is recorded');
insert into _ids (key, payload) select 'cancel_repeat', api.market_cancel_listing((select id from _ids where key = 'seller'), (select id from _ids where key = 'listing_id'), 'market-cancel-cancel-001');
select ok(((select payload from _ids where key = 'cancel_repeat') ->> 'idempotent')::boolean, 'repeated cancel with same idempotency key returns idempotent=true');
select ok(testutil.raises_like(format('select api.market_cancel_listing(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'listing_id'), 'market-cancel-listing-002'), '%listing cannot be cancelled%'), 'already cancelled listing cannot be cancelled again with a new key');

insert into _ids (key, payload) select 'partial_listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'partial_item1'), (select id from _ids where key = 'partial_item2')], 100, 'market-cancel-partial-listing-001');
insert into _ids (key, id) select 'partial_listing_id', ((select payload from _ids where key = 'partial_listing') ->> 'listing_id')::uuid;
insert into _ids (key, payload) select 'partial_buy', api.market_buy_listing((select id from _ids where key = 'buyer'), (select id from _ids where key = 'partial_listing_id'), 1, 100, 'market-cancel-partial-buy-001');
insert into _ids (key, id) select 'partial_order_id', ((select payload from _ids where key = 'partial_buy') ->> 'order_id')::uuid;
insert into _ids (key, id)
select 'partial_sold_item', item_instance_id
from market.order_items
where order_id = (select id from _ids where key = 'partial_order_id');
insert into _ids (key, id)
select 'partial_remaining_item', li.item_instance_id
from market.listing_items li
where li.listing_id = (select id from _ids where key = 'partial_listing_id')
  and li.status = 'reserved';
insert into _ids (key, payload) select 'partial_cancel', api.market_cancel_listing((select id from _ids where key = 'seller'), (select id from _ids where key = 'partial_listing_id'), 'market-cancel-partial-cancel-001');
select is((select status from market.listings where id = (select id from _ids where key = 'partial_listing_id')), 'cancelled', 'partially sold listing can be cancelled');
select is((select count(*)::int from market.listing_items where listing_id = (select id from _ids where key = 'partial_listing_id') and status = 'sold'), 1, 'cancel keeps sold listing item sold');
select is((select count(*)::int from market.listing_items where listing_id = (select id from _ids where key = 'partial_listing_id') and status = 'cancelled'), 1, 'cancel only cancels remaining reserved listing item');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'partial_sold_item')), (select id from _ids where key = 'buyer'), 'cancel does not return sold item ownership to seller');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'partial_sold_item')), 'available', 'sold item remains available in buyer inventory');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'partial_remaining_item')), (select id from _ids where key = 'seller'), 'cancel keeps unsold item owned by seller');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'partial_remaining_item')), 'available', 'cancel restores unsold item to available');
select is((select count(*)::int from inventory.inventory_locks where source_id = (select id from _ids where key = 'partial_listing_id') and status = 'consumed'), 1, 'cancel leaves sold item lock consumed');
select is((select count(*)::int from inventory.inventory_locks where source_id = (select id from _ids where key = 'partial_listing_id') and status = 'released'), 1, 'cancel releases only unsold item lock');

insert into _ids (key, id) select 'bad_status_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 12, 'admin');
insert into _ids (key, payload) select 'bad_status_listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'bad_status_item')], 120, 'market-cancel-bad-status-listing-001');
insert into _ids (key, id) select 'bad_status_listing_id', ((select payload from _ids where key = 'bad_status_listing') ->> 'listing_id')::uuid;
update inventory.item_instances
set status = 'available'
where id = (select id from _ids where key = 'bad_status_item');
select ok(testutil.raises_like(format('select api.market_cancel_listing(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'bad_status_listing_id'), 'market-cancel-bad-status-001'), '%listing item integrity violation%'), 'cancel rejects listing item that is no longer listed');

insert into _ids (key, id) select 'missing_lock_item', testutil.create_item((select id from _ids where key = 'seller'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 13, 'admin');
insert into _ids (key, payload) select 'missing_lock_listing', api.market_create_listing((select id from _ids where key = 'seller'), array[(select id from _ids where key = 'missing_lock_item')], 120, 'market-cancel-missing-lock-listing-001');
insert into _ids (key, id) select 'missing_lock_listing_id', ((select payload from _ids where key = 'missing_lock_listing') ->> 'listing_id')::uuid;
update inventory.inventory_locks
set status = 'released', released_at = now(), updated_at = now()
where item_instance_id = (select id from _ids where key = 'missing_lock_item')
  and source_type = 'market_listing'
  and source_id = (select id from _ids where key = 'missing_lock_listing_id')
  and status = 'active';
select ok(testutil.raises_like(format('select api.market_cancel_listing(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'seller'), (select id::text from _ids where key = 'missing_lock_listing_id'), 'market-cancel-missing-lock-001'), '%listing lock integrity violation%'), 'cancel rejects listing item without an active market lock');

select * from finish();

rollback;
