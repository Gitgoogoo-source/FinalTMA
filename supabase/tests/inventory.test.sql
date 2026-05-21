-- This pgTAP test is designed for the Telegram Mini App blind-box game schema.
-- Run after migrations, RPC files and RLS files have been applied.
-- Each file wraps its fixture data in a transaction and rolls back at the end.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

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

create or replace function testutil.create_inventory_gacha_fixture(p_prefix text)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_form_id uuid;
  v_box_id uuid;
  v_pool_id uuid;
  v_drop_item_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Inventory Test Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Inventory Test Faction')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template', 'Inventory Test Collectible', 'fixture', 'test fixture collectible',
    'COMMON', 'CHARACTER', v_series_id, v_faction_id, 10, 100, 'active',
    true, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      release_status = 'active',
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_id, 1, 'base', 'Inventory Base Form', 'Base form',
    'https://example.test/inventory/base.png',
    'https://example.test/inventory/base-thumb.png',
    'https://example.test/inventory/base-avatar.png',
    0, true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_id;

  insert into gacha.blind_boxes (
    slug, display_name, description, tier, status, price_stars,
    total_stock, remaining_stock, open_reward_kcoin, starts_at, ends_at, sort_order
  ) values (
    p_prefix || '-box', 'Inventory Test Box', 'pgTAP inventory fixture', 'normal', 'active', 10,
    100, 100, 100, now() - interval '1 hour', now() + interval '1 day', 1
  )
  on conflict (slug) do update
  set status = 'active',
      price_stars = excluded.price_stars,
      total_stock = excluded.total_stock,
      remaining_stock = excluded.remaining_stock,
      open_reward_kcoin = excluded.open_reward_kcoin,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      updated_at = now()
  returning id into v_box_id;

  insert into gacha.box_price_rules (box_id, quantity, discount_bps, active)
  values (v_box_id, 10, 1000, true)
  on conflict (box_id, quantity, active) do update
  set discount_bps = excluded.discount_bps,
      updated_at = now();

  insert into gacha.drop_pool_versions (box_id, version_no, status, published_at, effective_from, effective_to)
  values (v_box_id, 1, 'active', now(), now() - interval '1 hour', now() + interval '1 day')
  on conflict (box_id, version_no) do update
  set status = 'active',
      published_at = now(),
      effective_from = now() - interval '1 hour',
      effective_to = now() + interval '1 day',
      updated_at = now()
  returning id into v_pool_id;

  insert into gacha.drop_pool_items (
    pool_version_id, template_id, form_id, rarity_code, drop_weight,
    probability_bps, stock_total, stock_remaining, is_pity_eligible, sort_order
  ) values (
    v_pool_id, v_template_id, v_form_id, 'COMMON', 100,
    10000, null, null, false, 10
  ) returning id into v_drop_item_id;

  return jsonb_build_object(
    'box_id', v_box_id,
    'pool_id', v_pool_id,
    'drop_item_id', v_drop_item_id,
    'template_id', v_template_id,
    'form_id', v_form_id
  );
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('user', testutil.make_user(9500000001, 'inventory_user', null));
insert into _ids (key, payload) values ('fixture', testutil.create_inventory_gacha_fixture('inventory-write'));
insert into _ids (key, id) select 'box', ((select payload from _ids where key = 'fixture') ->> 'box_id')::uuid;

insert into _ids (key, payload)
select 'order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 10, 'inventory-write-ten-001');
insert into _ids (key, id) select 'draw_order', ((select payload from _ids where key = 'order') ->> 'draw_order_id')::uuid;

insert into _ids (key, payload)
select 'process', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order'), (select id from _ids where key = 'user'));

select is(jsonb_array_length((select payload from _ids where key = 'process') -> 'results'), 10, 'ten draw process returns 10 result payload items');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order')), 10, 'ten draw stores 10 draw_results rows');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order') and item_instance_id is null), 0, 'every draw_result has an item_instance_id');
select is((
  select count(*)::int
  from gacha.draw_results dr
  join inventory.item_instances ii on ii.id = dr.item_instance_id
  where dr.draw_order_id = (select id from _ids where key = 'draw_order')
    and ii.owner_user_id = (select id from _ids where key = 'user')
    and ii.template_id = dr.template_id
    and ii.form_id = dr.form_id
    and ii.status = 'available'
    and ii.source_type = 'gacha'
    and ii.source_id = dr.draw_order_id
), 10, 'every draw_result maps to an available owned gacha item_instance');
select is((
  select count(*)::int
  from inventory.item_instance_events e
  join gacha.draw_results dr on dr.item_instance_id = e.item_instance_id
  where dr.draw_order_id = (select id from _ids where key = 'draw_order')
    and e.event_type = 'created'
    and e.source_type = 'gacha'
    and e.source_id = (select id from _ids where key = 'draw_order')
), 10, 'every gacha-created item_instance has a created inventory event');

insert into _ids (key, payload)
select 'inventory_list', api.inventory_list_user_items((select id from _ids where key = 'user'), array['available']::text[], 40, 0);

select is(((select payload from _ids where key = 'inventory_list') ->> 'total')::int, 10, 'inventory list exposes all ten generated items');
select is(jsonb_array_length((select payload from _ids where key = 'inventory_list') -> 'items'), 10, 'inventory list returns ten available items');

insert into _ids (key, payload)
select 'process_repeat', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order'), (select id from _ids where key = 'user'));

select ok(((select payload from _ids where key = 'process_repeat') ->> 'idempotent')::boolean, 'repeating dev paid processing is idempotent');
select is((select count(*)::int from inventory.item_instances where source_id = (select id from _ids where key = 'draw_order') and source_type = 'gacha'), 10, 'idempotent reprocessing does not duplicate inventory items');

select * from finish();

rollback;
