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


create or replace function testutil.create_gacha_fixture(
  p_prefix text,
  p_price integer default 10,
  p_stock integer default 100,
  p_open_reward_kcoin numeric default 100,
  p_pity_threshold integer default null,
  p_pity_target_rarity text default 'EPIC'
)
returns jsonb
language plpgsql
as $$
declare
  v_common jsonb;
  v_epic jsonb;
  v_box_id uuid;
  v_pool_id uuid;
  v_pity_id uuid;
  v_common_item_id uuid;
  v_epic_item_id uuid;
begin
  v_common := testutil.create_catalog_fixture(p_prefix || '-common', 'COMMON', true, true, true, true, true);
  v_epic := testutil.create_catalog_fixture(p_prefix || '-epic', 'EPIC', true, true, true, true, true);

  insert into gacha.blind_boxes (
    slug, display_name, description, tier, status, price_stars,
    total_stock, remaining_stock, open_reward_kcoin, starts_at, ends_at, sort_order
  ) values (
    p_prefix || '-box', 'Test Box ' || p_prefix, 'pgTAP gacha fixture', 'normal', 'active', p_price,
    p_stock, p_stock, p_open_reward_kcoin, now() - interval '1 hour', now() + interval '1 day', 1
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
    v_pool_id, (v_common ->> 'template_id')::uuid, (v_common ->> 'form1_id')::uuid, 'COMMON', 100,
    9000, null, null, false, 10
  ) returning id into v_common_item_id;

  insert into gacha.drop_pool_items (
    pool_version_id, template_id, form_id, rarity_code, drop_weight,
    probability_bps, stock_total, stock_remaining, is_pity_eligible, sort_order
  ) values (
    v_pool_id, (v_epic ->> 'template_id')::uuid, (v_epic ->> 'form1_id')::uuid, 'EPIC', 1,
    1000, null, null, true, 20
  ) returning id into v_epic_item_id;

  if p_pity_threshold is not null then
    insert into gacha.pity_rules (
      box_id, pool_version_id, rule_name, threshold, target_rarity_code,
      reset_on_rarity_code, guaranteed_template_id, guaranteed_form_id, priority, active
    ) values (
      v_box_id, v_pool_id, p_prefix || ' pity', p_pity_threshold, p_pity_target_rarity,
      p_pity_target_rarity, (v_epic ->> 'template_id')::uuid, (v_epic ->> 'form1_id')::uuid, 1, true
    ) returning id into v_pity_id;
  end if;

  return jsonb_build_object(
    'box_id', v_box_id,
    'pool_id', v_pool_id,
    'pity_rule_id', v_pity_id,
    'common_template_id', (v_common ->> 'template_id')::uuid,
    'common_form_id', (v_common ->> 'form1_id')::uuid,
    'epic_template_id', (v_epic ->> 'template_id')::uuid,
    'epic_form_id', (v_epic ->> 'form1_id')::uuid,
    'common_drop_item_id', v_common_item_id,
    'epic_drop_item_id', v_epic_item_id
  );
end;
$$;

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;
insert into _ids (key, id) values ('user', testutil.make_user(9400000001, 'gacha_pity_user', null));
insert into _ids (key, payload) values ('fixture', testutil.create_gacha_fixture('gacha-pity', 10, 10, 100, 1, 'EPIC'));
insert into _ids (key, id) select 'box', ((select payload from _ids where key = 'fixture') ->> 'box_id')::uuid;
insert into _ids (key, id) select 'pity_rule', ((select payload from _ids where key = 'fixture') ->> 'pity_rule_id')::uuid;

insert into _ids (key, payload) select 'order', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-pity-order-001');
insert into _ids (key, id) select 'draw_order', ((select payload from _ids where key = 'order') ->> 'draw_order_id')::uuid;
insert into _ids (key, id) select 'star_order', ((select payload from _ids where key = 'order') ->> 'star_order_id')::uuid;

insert into _ids (key, payload)
select 'process', api.gacha_process_paid_order((select id from _ids where key = 'star_order'), 'tg-charge-gacha-pity-001', null, '{"test":"gacha_pity"}'::jsonb);

select is(((select payload from _ids where key = 'process') ->> 'status'), 'opened', 'paid order is fulfilled and opened');
select is((select status from gacha.draw_orders d join _ids i on i.id = d.id where i.key = 'draw_order'), 'opened', 'draw order status is opened');
select is((select status from payments.star_orders s join _ids i on i.id = s.id where i.key = 'star_order'), 'fulfilled', 'Stars order status is fulfilled');
select is((select count(*)::int from payments.star_payments where telegram_payment_charge_id = 'tg-charge-gacha-pity-001'), 1, 'successful payment row is recorded exactly once');
select is((select count(*)::int from gacha.draw_results dr join _ids i on i.id = dr.draw_order_id where i.key = 'draw_order'), 1, 'one draw result is generated');
select is((select rarity_code from gacha.draw_results dr join _ids i on i.id = dr.draw_order_id where i.key = 'draw_order'), 'EPIC', 'threshold=1 pity guarantees EPIC reward');
select ok((select was_pity from gacha.draw_results dr join _ids i on i.id = dr.draw_order_id where i.key = 'draw_order'), 'draw result records was_pity=true');
select is((select current_count from gacha.user_pity_states ups join _ids u on u.id = ups.user_id join _ids p on p.id = ups.pity_rule_id where u.key = 'user' and p.key = 'pity_rule'), 0, 'pity counter resets after guaranteed hit');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 100::numeric, 'paid open returns 100 K-coin');
select is((select remaining_stock from gacha.blind_boxes b join _ids i on i.id = b.id where i.key = 'box'), 9, 'box stock decreases by draw quantity');
select ok(exists (select 1 from inventory.item_instances ii join gacha.draw_results dr on dr.item_instance_id = ii.id join _ids i on i.id = dr.draw_order_id where i.key = 'draw_order' and ii.owner_user_id = (select id from _ids where key = 'user') and ii.status = 'available'), 'gacha creates an available inventory item for user');
select ok(exists (select 1 from album.user_discoveries ud where ud.user_id = (select id from _ids where key = 'user') and ud.template_id = ((select payload from _ids where key = 'fixture') ->> 'epic_template_id')::uuid), 'gacha reward creates album discovery');

select * from finish();

rollback;
