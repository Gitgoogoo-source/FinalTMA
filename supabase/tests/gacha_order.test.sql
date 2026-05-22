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
insert into _ids (key, id) values ('user', testutil.make_user(9300000001, 'gacha_order_user', null));
insert into _ids (key, payload) values ('fixture', testutil.create_gacha_fixture('gacha-order', 10, 100, 100, null, 'EPIC'));
insert into _ids (key, id) select 'box', ((select payload from _ids where key = 'fixture') ->> 'box_id')::uuid;

insert into _ids (key, payload)
select 'order1', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-order-single-001');
insert into _ids (key, id) select 'draw_order1', ((select payload from _ids where key = 'order1') ->> 'draw_order_id')::uuid;
insert into _ids (key, id) select 'star_order1', ((select payload from _ids where key = 'order1') ->> 'star_order_id')::uuid;

select is(((select payload from _ids where key = 'order1') ->> 'xtr_amount')::int, 10, 'single draw uses box price');
select ok(exists (select 1 from gacha.draw_orders d join _ids i on i.id = d.id where i.key = 'draw_order1' and d.status = 'invoice_created' and d.quantity = 1), 'draw order is created with invoice_created status');
select ok(exists (select 1 from payments.star_orders s join _ids i on i.id = s.id where i.key = 'star_order1' and s.business_type = 'gacha_open' and s.xtr_amount = 10), 'Stars order is created for gacha open');
select is((select payment_star_order_id from gacha.draw_orders d join _ids i on i.id = d.id where i.key = 'draw_order1'), (select id from _ids where key = 'star_order1'), 'draw order links to Stars order');

insert into _ids (key, id) values ('other_user', testutil.make_user(9300000002, 'gacha_order_other_user', null));
select ok(testutil.raises_like(format('select api.gacha_create_order(%L::uuid, %L::uuid, 1, %L)', (select id::text from _ids where key = 'other_user'), (select id::text from _ids where key = 'box'), 'gacha-order-single-001'), '%idempotency key conflict%'), 'create order rejects idempotency key reused by another user');
select ok(testutil.raises_like(format('select api.gacha_create_order(%L::uuid, %L::uuid, 10, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'box'), 'gacha-order-single-001'), '%idempotency key conflict%'), 'create order rejects idempotency key reused with a different draw quantity');
select ok(testutil.raises_like(format('select api.gacha_process_dev_paid_order(%L::uuid, %L::uuid)', (select id::text from _ids where key = 'draw_order1'), (select id::text from _ids where key = 'other_user')), '%does not belong to user%'), 'dev paid process rejects another user order');

insert into _ids (key, payload)
select 'order1_dev_process', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order1'), (select id from _ids where key = 'user'));
select is(((select payload from _ids where key = 'order1_dev_process') ->> 'status'), 'opened', 'dev paid process opens order');
select is(((select payload from _ids where key = 'order1_dev_process') ->> 'payment_status'), 'dev_paid', 'dev paid process marks dev payment status');
select is(jsonb_array_length((select payload from _ids where key = 'order1_dev_process') -> 'results'), 1, 'dev paid process creates one draw result for single draw');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 100::numeric, 'dev paid process credits KCOIN reward');
select ok(exists (select 1 from economy.currency_ledger where user_id = (select id from _ids where key = 'user') and source_id = (select id from _ids where key = 'draw_order1') and entry_type = 'credit' and currency_code = 'KCOIN'), 'dev paid process writes KCOIN ledger');
select ok(exists (select 1 from inventory.item_instances ii join gacha.draw_results dr on dr.item_instance_id = ii.id where dr.draw_order_id = (select id from _ids where key = 'draw_order1') and ii.owner_user_id = (select id from _ids where key = 'user') and ii.status = 'available'), 'dev paid process creates available inventory item');

insert into _ids (key, payload)
select 'inventory_after_dev_process', api.inventory_list_user_items((select id from _ids where key = 'user'), array['available']::text[], 20, 0);
select is(((select payload from _ids where key = 'inventory_after_dev_process') ->> 'total')::int, 1, 'inventory list returns item created by dev gacha process');

insert into _ids (key, payload)
select 'order1_dev_process_repeat', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order1'), (select id from _ids where key = 'user'));
select ok(((select payload from _ids where key = 'order1_dev_process_repeat') ->> 'idempotent')::boolean, 'repeated dev paid process is idempotent');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order1')), 1, 'repeated dev paid process does not create duplicate draw results');

insert into _ids (key, payload)
select 'order1_repeat', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 1, 'gacha-order-single-001');
select ok(((select payload from _ids where key = 'order1_repeat') ->> 'idempotent')::boolean, 'repeated create order returns idempotent=true');
select is(((select payload from _ids where key = 'order1_repeat') ->> 'draw_order_id')::uuid, (select id from _ids where key = 'draw_order1'), 'repeated create order returns same draw_order_id');

insert into _ids (key, payload)
select 'order10', api.gacha_create_order((select id from _ids where key = 'user'), (select id from _ids where key = 'box'), 10, 'gacha-order-ten-001');
insert into _ids (key, id) select 'draw_order10', ((select payload from _ids where key = 'order10') ->> 'draw_order_id')::uuid;
select is(((select payload from _ids where key = 'order10') ->> 'xtr_amount')::int, 90, 'ten-draw order applies 9折 discount');
select is(((select payload from _ids where key = 'order10') ->> 'discount_bps')::int, 1000, 'ten-draw response exposes discount_bps=1000');
insert into _ids (key, payload)
select 'order10_dev_process', api.gacha_process_dev_paid_order((select id from _ids where key = 'draw_order10'), (select id from _ids where key = 'user'));
select is(jsonb_array_length((select payload from _ids where key = 'order10_dev_process') -> 'results'), 10, 'dev paid process creates ten draw results for ten draw');
select is((select count(*)::int from gacha.draw_results where draw_order_id = (select id from _ids where key = 'draw_order10')), 10, 'ten-draw order stores 10 draw_results rows');
select is((
  select count(*)::int
  from gacha.draw_results dr
  join inventory.item_instances ii on ii.id = dr.item_instance_id
  where dr.draw_order_id = (select id from _ids where key = 'draw_order10')
    and ii.owner_user_id = (select id from _ids where key = 'user')
    and ii.source_type = 'gacha'
    and ii.source_id = (select id from _ids where key = 'draw_order10')
), 10, 'every ten-draw result has a matching owned gacha item_instance');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 1100::numeric, 'single draw plus ten draw credits KCOIN reward per draw');
select ok(testutil.raises_like(format('select api.gacha_create_order(%L::uuid, %L::uuid, 2, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'box'), 'invalid-quantity'), '%quantity must be 1 or 10%'), 'create order rejects unsupported quantity');

update gacha.blind_boxes set status = 'paused' where id = (select id from _ids where key = 'box');
select ok(testutil.raises_like(format('select api.gacha_create_order(%L::uuid, %L::uuid, 1, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'box'), 'paused-box'), '%blind box is not active%'), 'create order rejects inactive box');

select * from finish();

rollback;
