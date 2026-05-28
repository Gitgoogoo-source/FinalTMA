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
insert into _ids (key, id) values ('user', testutil.make_user(10300000001, 'mint_user', null));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('mint-queue', 'LEGENDARY', true, true, true, true, true));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1', ((select payload from _ids where key = 'catalog') ->> 'form1_id')::uuid;

insert into _ids (key, id) select 'item_success', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');
insert into _ids (key, id) select 'item_failed', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');
insert into _ids (key, id) select 'item_conflict', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');
insert into _ids (key, id) select 'item_queued_status_guard', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');
insert into _ids (key, id) select 'item_active_lock_guard', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');
insert into _ids (key, id) select 'item_unverified_wallet_guard', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 100, 'admin');

insert into _ids (key, payload) select 'wallet', api.wallet_save_verified_address((select id from _ids where key = 'user'), 'EQ_TEST_MINT_WALLET_MAIN', 'raw-mint-wallet', 'mainnet', 'Tonkeeper', true);
insert into _ids (key, id) select 'wallet_id', ((select payload from _ids where key = 'wallet') ->> 'wallet_id')::uuid;
with unverified_wallet as (
  insert into core.user_wallets (user_id, chain, network, address, address_raw, wallet_app_name, is_primary, status, verified_at, metadata)
  values ((select id from _ids where key = 'user'), 'TON', 'mainnet', 'EQ_TEST_MINT_WALLET_UNVERIFIED', 'raw-mint-wallet-unverified', 'Tonkeeper', false, 'connected', null, '{"fixture":true}'::jsonb)
  returning id
)
insert into _ids (key, id) select 'wallet_unverified_id', id from unverified_wallet;
select ok(exists (select 1 from core.user_wallets where id = (select id from _ids where key = 'wallet_id') and status = 'connected' and verified_at is not null), 'wallet_save_verified_address stores verified connected wallet');

with collection_row as (
  insert into onchain.nft_collections (code, chain, network, collection_address, owner_address, contract_version, standard, metadata_url, status, deployed_at)
  values ('MINT_TEST_COLLECTION', 'TON', 'mainnet', 'EQ_TEST_COLLECTION_ADDRESS', 'EQ_TEST_OWNER', 'test-v1', 'TEP-62', 'https://example.test/collection.json', 'active', now())
  on conflict (code) do update set status = 'active', collection_address = excluded.collection_address, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'collection', id from collection_row;

insert into _ids (key, payload) select 'queue_success', api.wallet_enqueue_mint((select id from _ids where key = 'user'), (select id from _ids where key = 'item_success'), (select id from _ids where key = 'collection'), (select id from _ids where key = 'wallet_id'), 'mint-queue-success-001');
insert into _ids (key, id) select 'queue_success_id', ((select payload from _ids where key = 'queue_success') ->> 'mint_queue_id')::uuid;
insert into _ids (key, payload) select 'queue_success_repeat', api.wallet_enqueue_mint((select id from _ids where key = 'user'), (select id from _ids where key = 'item_success'), (select id from _ids where key = 'collection'), (select id from _ids where key = 'wallet_id'), 'mint-queue-success-001');
select is((select status from onchain.mint_queue where id = (select id from _ids where key = 'queue_success_id')), 'queued', 'wallet_enqueue_mint creates queued mint row');
select ok(((select payload from _ids where key = 'queue_success_repeat') ->> 'idempotent')::boolean, 'same mint enqueue idempotency key returns cached queue');
select is(((select payload from _ids where key = 'queue_success_repeat') ->> 'mint_queue_id')::uuid, (select id from _ids where key = 'queue_success_id'), 'same mint enqueue idempotency key returns the original queue id');
select is((select count(*)::int from onchain.mint_queue where idempotency_key = 'mint-queue-success-001'), 1, 'same mint enqueue idempotency key does not create another queue row');
select is((select count(*)::int from inventory.inventory_locks where item_instance_id = (select id from _ids where key = 'item_success') and lock_type = 'mint' and status = 'active'), 1, 'same mint enqueue idempotency key does not create another active mint lock');
select is((select count(*)::int from inventory.item_instance_events where item_instance_id = (select id from _ids where key = 'item_success') and event_type = 'mint_queued' and source_type = 'mint_queue'), 1, 'same mint enqueue idempotency key does not create another mint_queued event');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'item_success')), 'minting', 'queued mint changes item status to minting');
select ok(exists (select 1 from inventory.inventory_locks where item_instance_id = (select id from _ids where key = 'item_success') and lock_type = 'mint' and status = 'active'), 'queued mint creates active mint lock');
select ok(testutil.raises_like(format('select api.wallet_enqueue_mint(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item_conflict'), (select id::text from _ids where key = 'collection'), (select id::text from _ids where key = 'wallet_id'), 'mint-queue-success-001'), '%idempotency conflict%'), 'mint enqueue idempotency key cannot be reused for a different item');
select ok(testutil.raises_like(format('select api.wallet_enqueue_mint(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item_success'), (select id::text from _ids where key = 'collection'), (select id::text from _ids where key = 'wallet_id'), 'mint-queue-duplicate-item'), '%item is not available for mint%'), 'same item cannot enter a second active mint queue');
update inventory.item_instances set nft_mint_status = 'queued' where id = (select id from _ids where key = 'item_queued_status_guard');
select ok(testutil.raises_like(format('select api.wallet_enqueue_mint(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item_queued_status_guard'), (select id::text from _ids where key = 'collection'), (select id::text from _ids where key = 'wallet_id'), 'mint-queue-nft-status-guard'), '%item is not available for mint%'), 'item with queued nft_mint_status cannot enter mint queue even if status is available');
insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, status)
values ((select id from _ids where key = 'item_active_lock_guard'), (select id from _ids where key = 'user'), 'admin_hold', 'admin', 'active');
select ok(testutil.raises_like(format('select api.wallet_enqueue_mint(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item_active_lock_guard'), (select id::text from _ids where key = 'collection'), (select id::text from _ids where key = 'wallet_id'), 'mint-queue-active-lock-guard'), '%item has active inventory lock%'), 'item with active inventory lock cannot enter mint queue');
select ok(testutil.raises_like(format('select api.wallet_enqueue_mint(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item_unverified_wallet_guard'), (select id::text from _ids where key = 'collection'), (select id::text from _ids where key = 'wallet_unverified_id'), 'mint-queue-unverified-wallet-guard'), '%wallet is not verified%'), 'unverified wallet cannot create mint queue');

insert into _ids (key, payload) select 'mint_success', api.onchain_mark_mint_success((select id from _ids where key = 'queue_success_id'), 'EQ_TEST_NFT_ITEM_SUCCESS', 1001, 'EQ_TEST_MINT_WALLET_MAIN', 'tx_mint_success_001', 'https://example.test/item-success.json');
insert into _ids (key, id) select 'nft_item_success', ((select payload from _ids where key = 'mint_success') ->> 'nft_item_id')::uuid;
insert into _ids (key, payload) select 'mint_success_repeat', api.onchain_mark_mint_success((select id from _ids where key = 'queue_success_id'), 'EQ_TEST_NFT_ITEM_SUCCESS', 1001, 'EQ_TEST_MINT_WALLET_MAIN', 'tx_mint_success_001', 'https://example.test/item-success.json');
select is((select status from onchain.mint_queue where id = (select id from _ids where key = 'queue_success_id')), 'minted', 'mint success marks queue minted');
select ok(((select payload from _ids where key = 'mint_success_repeat') ->> 'idempotent')::boolean, 'same mint success callback returns idempotent result');
select is(((select payload from _ids where key = 'mint_success_repeat') ->> 'nft_item_id')::uuid, (select id from _ids where key = 'nft_item_success'), 'same mint success callback returns the original nft item');
select is((select count(*)::int from onchain.nft_items where item_instance_id = (select id from _ids where key = 'item_success')), 1, 'same mint success callback does not create another nft item');
select is((select count(*)::int from inventory.item_instance_events where source_type = 'mint_queue' and source_id = (select id from _ids where key = 'queue_success_id') and event_type = 'minted'), 1, 'same mint success callback does not create another minted event');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'item_success')), 'minted', 'mint success marks inventory item minted');
select is((select nft_mint_status from inventory.item_instances where id = (select id from _ids where key = 'item_success')), 'minted', 'mint success updates nft_mint_status');
select ok(exists (select 1 from onchain.nft_items where id = (select id from _ids where key = 'nft_item_success') and item_address = 'EQ_TEST_NFT_ITEM_SUCCESS' and status = 'minted'), 'mint success creates NFT item mapping');
select ok(exists (select 1 from inventory.inventory_locks where item_instance_id = (select id from _ids where key = 'item_success') and source_id = (select id from _ids where key = 'queue_success_id') and status = 'consumed'), 'mint success consumes mint lock');
select ok(testutil.raises_like(format('select api.onchain_mark_mint_success(%L::uuid, %L, %L::bigint, %L, %L, %L)', (select id::text from _ids where key = 'queue_success_id'), 'EQ_TEST_NFT_ITEM_CONFLICT', '1001', 'EQ_TEST_MINT_WALLET_MAIN', 'tx_mint_success_001', 'https://example.test/item-success.json'), '%mint success idempotency conflict%'), 'mint success repeat with a different NFT address is rejected');

insert into _ids (key, payload) select 'queue_failed', api.wallet_enqueue_mint((select id from _ids where key = 'user'), (select id from _ids where key = 'item_failed'), (select id from _ids where key = 'collection'), (select id from _ids where key = 'wallet_id'), 'mint-queue-failed-001');
insert into _ids (key, id) select 'queue_failed_id', ((select payload from _ids where key = 'queue_failed') ->> 'mint_queue_id')::uuid;
insert into _ids (key, payload) select 'mint_failed', api.onchain_mark_mint_failed((select id from _ids where key = 'queue_failed_id'), 'simulated mint failure', 'tx_mint_failed_001', true, '{"case":"mint_failure"}'::jsonb);
insert into _ids (key, payload) select 'mint_failed_repeat', api.onchain_mark_mint_failed((select id from _ids where key = 'queue_failed_id'), 'simulated mint failure', 'tx_mint_failed_001', true, '{"case":"mint_failure"}'::jsonb);
select is((select status from onchain.mint_queue where id = (select id from _ids where key = 'queue_failed_id')), 'failed', 'mint failure marks queue failed');
select ok(((select payload from _ids where key = 'mint_failed_repeat') ->> 'idempotent')::boolean, 'same mint failure callback returns idempotent result');
select is(((select payload from _ids where key = 'mint_failed_repeat') ->> 'attempt_count')::integer, 1, 'same mint failure callback returns the original attempt count');
select is((select attempt_count from onchain.mint_queue where id = (select id from _ids where key = 'queue_failed_id')), 1, 'same mint failure callback does not increment attempt_count twice');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'item_failed')), 'available', 'mint failure with release_item=true returns item to available');
select is((select nft_mint_status from inventory.item_instances where id = (select id from _ids where key = 'item_failed')), 'failed', 'mint failure marks nft_mint_status failed');
select ok(exists (select 1 from inventory.inventory_locks where item_instance_id = (select id from _ids where key = 'item_failed') and source_id = (select id from _ids where key = 'queue_failed_id') and status = 'released'), 'mint failure releases mint lock');
select ok(exists (select 1 from onchain.transactions where tx_hash = 'tx_mint_failed_001' and related_type = 'mint_queue' and status = 'failed'), 'mint failure records failed onchain transaction');
select is((select count(*)::int from onchain.transactions where tx_hash = 'tx_mint_failed_001' and related_type = 'mint_queue'), 1, 'same mint failure callback does not create another transaction row');
select is((select count(*)::int from inventory.item_instance_events where source_type = 'mint_queue' and source_id = (select id from _ids where key = 'queue_failed_id') and event_type = 'admin_adjusted'), 1, 'same mint failure callback does not create another failure event');
select ok(testutil.raises_like(format('select api.onchain_mark_mint_failed(%L::uuid, %L, %L, true, %L::jsonb)', (select id::text from _ids where key = 'queue_failed_id'), 'simulated mint failure', 'tx_mint_failed_conflict', '{"case":"mint_failure"}'), '%mint failure idempotency conflict%'), 'mint failure repeat with a different tx hash is rejected');
select ok(testutil.raises_like(format('select api.onchain_mark_mint_failed(%L::uuid, %L, %L, true, %L::jsonb)', (select id::text from _ids where key = 'queue_success_id'), 'should not downgrade minted queue', 'tx_mint_after_success', '{"case":"mint_after_success"}'), '%mint queue already minted%'), 'mint failure cannot downgrade a minted queue');

select * from finish();

rollback;
