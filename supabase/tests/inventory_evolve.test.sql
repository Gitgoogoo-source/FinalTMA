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
insert into _ids (key, id) values ('user', testutil.make_user(9700000001, 'inventory_evolve_user', null));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('inventory-evolve', 'COMMON', true, true, true, true, true));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1', ((select payload from _ids where key = 'catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'form2', ((select payload from _ids where key = 'catalog') ->> 'form2_id')::uuid;

do $$
begin
  perform api._credit_balance((select id from _ids where key = 'user'), 'KCOIN', 1000, 'test_setup', null, null, 'inventory-evolve-kcoin-001', 'fixture', '{}'::jsonb);
  perform api._credit_balance((select id from _ids where key = 'user'), 'FGEMS', 100, 'test_setup', null, null, 'inventory-evolve-fgems-001', 'fixture', '{}'::jsonb);
end;
$$;

insert into inventory.evolution_rules (from_template_id, from_form_id, to_template_id, to_form_id, required_count, cost_kcoin, success_rate_bps, active)
values ((select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form2'), 3, 120, 10000, true);

insert into _ids (key, id) select 's1', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 10, 'admin');
insert into _ids (key, id) select 's2', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 2, 15, 'admin');
insert into _ids (key, id) select 's3', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 5, 30, 'admin');

insert into _ids (key, payload)
select 'evolve_success', api.inventory_evolve_item(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 's1'), (select id from _ids where key = 's2'), (select id from _ids where key = 's3')],
  'inventory-evolve-success-001'
);
insert into _ids (key, id) select 'success_result_item', ((select payload from _ids where key = 'evolve_success') ->> 'result_item_instance_id')::uuid;

select ok(((select payload from _ids where key = 'evolve_success') ->> 'success')::boolean, 'success_rate 10000 always evolves successfully');
select is((select count(*)::int from inventory.item_instances where id in ((select id from _ids where key = 's1'), (select id from _ids where key = 's2'), (select id from _ids where key = 's3')) and status = 'consumed'), 3, 'successful evolution consumes all three source items');
select ok(exists (select 1 from inventory.item_instances ii join _ids i on i.id = ii.id where i.key = 'success_result_item' and ii.owner_user_id = (select id from _ids where key = 'user') and ii.form_id = (select id from _ids where key = 'form2') and ii.status = 'available'), 'successful evolution creates evolved-form item');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 880::numeric, 'successful evolution debits K-coin cost');
select ok(exists (select 1 from inventory.evolution_attempts where result_item_instance_id = (select id from _ids where key = 'success_result_item') and status = 'success'), 'successful evolution attempt is logged');

insert into _ids (key, payload)
select 'evolve_success_repeat', api.inventory_evolve_item(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 's1'), (select id from _ids where key = 's2'), (select id from _ids where key = 's3')],
  'inventory-evolve-success-001'
);

select is(((select payload from _ids where key = 'evolve_success_repeat') ->> 'attempt_id')::uuid, ((select payload from _ids where key = 'evolve_success') ->> 'attempt_id')::uuid, 'repeating evolution with the same idempotency key returns the original attempt');
select is((select count(*)::int from inventory.evolution_attempts where idempotency_key = 'inventory-evolve-success-001'), 1, 'idempotent evolution repeat does not create a second attempt');
select is((select count(*)::int from inventory.item_instances where source_type = 'evolution' and source_id = (select id from inventory.evolution_rules where from_template_id = (select id from _ids where key = 'template') and from_form_id = (select id from _ids where key = 'form1') and active = true limit 1)), 1, 'idempotent evolution repeat does not create a second evolved item');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 880::numeric, 'idempotent evolution repeat does not debit K-coin again');

insert into _ids (key, id) select 'form2_upgrade_item', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form2'), 1, 50, 'admin');

insert into _ids (key, payload)
select 'form2_upgrade', api.inventory_upgrade_item(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'form2_upgrade_item'),
  'inventory-evolve-form2-upgrade-001'
);

select is(((select payload from _ids where key = 'form2_upgrade') ->> 'to_level')::int, 2, 'form_index 2 item can upgrade from level 1 to level 2');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 90::numeric, 'form_index 2 upgrade debits FGEMS once');

insert into _ids (key, payload)
select 'form2_upgrade_repeat', api.inventory_upgrade_item(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'form2_upgrade_item'),
  'inventory-evolve-form2-upgrade-001'
);

select is(((select payload from _ids where key = 'form2_upgrade_repeat') ->> 'to_level')::int, 2, 'repeating upgrade with the same idempotency key returns the original upgrade');
select is((select level from inventory.item_instances where id = (select id from _ids where key = 'form2_upgrade_item')), 2, 'idempotent upgrade repeat does not upgrade the item twice');
select is((select count(*)::int from inventory.upgrade_logs where idempotency_key = 'inventory-evolve-form2-upgrade-001'), 1, 'idempotent upgrade repeat does not create a second upgrade log');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 90::numeric, 'idempotent upgrade repeat does not debit FGEMS again');

update inventory.evolution_rules set active = false where from_template_id = (select id from _ids where key = 'template') and from_form_id = (select id from _ids where key = 'form1');
insert into inventory.evolution_rules (from_template_id, from_form_id, to_template_id, to_form_id, required_count, cost_kcoin, success_rate_bps, active)
values ((select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form2'), 3, 80, 0, true);

insert into _ids (key, id) select 'f1', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 11, 'admin');
insert into _ids (key, id) select 'f2', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 4, 40, 'admin');
insert into _ids (key, id) select 'f3', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 2, 22, 'admin');

select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'f1'), (select id::text from _ids where key = 'f2'), (select id::text from _ids where key = 'f3'), 'inventory-evolve-success-001'), '%idempotency conflict%'), 'reusing an evolution idempotency key for different inputs is rejected');
select ok(testutil.raises_like(format('select api.inventory_upgrade_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'f1'), 'inventory-evolve-form2-upgrade-001'), '%idempotency conflict%'), 'reusing an upgrade idempotency key for a different item is rejected');

insert into _ids (key, payload)
select 'evolve_failed', api.inventory_evolve_item(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'f1'), (select id from _ids where key = 'f2'), (select id from _ids where key = 'f3')],
  'inventory-evolve-failed-001'
);
insert into _ids (key, id) select 'failed_main_item', ((select payload from _ids where key = 'evolve_failed') ->> 'main_item_instance_id')::uuid;

select ok(not ((select payload from _ids where key = 'evolve_failed') ->> 'success')::boolean, 'success_rate 0 always fails');
select is((select count(*)::int from inventory.item_instances where id in ((select id from _ids where key = 'f1'), (select id from _ids where key = 'f2'), (select id from _ids where key = 'f3')) and status = 'available'), 1, 'failed evolution returns exactly one main item');
select ok(exists (select 1 from inventory.item_instances ii join _ids i on i.id = ii.id where i.key = 'failed_main_item' and ii.status = 'available' and ii.owner_user_id = (select id from _ids where key = 'user')), 'returned main item remains owned by user');
select is((select count(*)::int from inventory.item_instances where id in ((select id from _ids where key = 'f1'), (select id from _ids where key = 'f2'), (select id from _ids where key = 'f3')) and status = 'consumed'), 2, 'failed evolution consumes the two material items');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'KCOIN'), 800::numeric, 'failed evolution still debits K-coin cost');
select ok(exists (select 1 from inventory.evolution_attempts where main_item_instance_id = (select id from _ids where key = 'failed_main_item') and status = 'failed'), 'failed evolution attempt is logged');
select ok(exists (select 1 from pg_indexes where schemaname = 'inventory' and indexname = 'upgrade_rules_one_active_from_level'), 'upgrade active-rule uniqueness index exists');
select ok(exists (select 1 from pg_indexes where schemaname = 'inventory' and indexname = 'evolution_rules_one_active_source_form'), 'evolution active-rule uniqueness index exists');
select ok(not has_function_privilege('anon', 'api.inventory_upgrade_item(uuid, uuid, text)', 'execute'), 'anon cannot execute inventory_upgrade_item directly');
select ok(not has_function_privilege('authenticated', 'api.inventory_upgrade_item(uuid, uuid, text)', 'execute'), 'authenticated cannot execute inventory_upgrade_item directly');
select ok(not has_function_privilege('anon', 'api.inventory_evolve_item(uuid, uuid[], text)', 'execute'), 'anon cannot execute inventory_evolve_item directly');
select ok(not has_function_privilege('authenticated', 'api.inventory_evolve_item(uuid, uuid[], text)', 'execute'), 'authenticated cannot execute inventory_evolve_item directly');
select ok(has_function_privilege('service_role', 'api.inventory_upgrade_item(uuid, uuid, text)', 'execute'), 'service_role can execute inventory_upgrade_item');
select ok(has_function_privilege('service_role', 'api.inventory_evolve_item(uuid, uuid[], text)', 'execute'), 'service_role can execute inventory_evolve_item');

select * from finish();

rollback;
