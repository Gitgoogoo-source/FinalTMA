-- Stage 3 growth-system database acceptance tests.
-- This file intentionally keeps a focused end-to-end pgTAP suite for the
-- guide's "第十四步：数据库测试" requirements.

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
    p_first_name := 'Stage3',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'stage3_database_acceptance')
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
  p_rarity_code text default 'COMMON',
  p_tradeable boolean default true,
  p_upgradeable boolean default true,
  p_evolvable boolean default true,
  p_decomposable boolean default true,
  p_nft_mintable boolean default true,
  p_max_level integer default 10,
  p_form2_index integer default 2
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
  values (p_prefix || '-series', 'Stage3 Series ' || p_prefix, 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Stage3 Faction ' || p_prefix)
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template', 'Stage3 Collectible ' || p_prefix, 'fixture', 'stage3 acceptance fixture',
    p_rarity_code, 'CHARACTER', v_series_id, v_faction_id,
    case when p_rarity_code = 'LEGENDARY' then 100 when p_rarity_code = 'EPIC' then 60 when p_rarity_code = 'RARE' then 30 else 10 end,
    p_max_level, 'active',
    p_tradeable, p_upgradeable, p_evolvable, p_decomposable, p_nft_mintable, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      max_level = excluded.max_level,
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
    v_template_id, p_form2_index, 'evolved-' || p_form2_index::text, 'Evolved Form', 'Evolved form',
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
  p_source_type text default 'admin',
  p_acquired_offset interval default interval '0 seconds'
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id, template_id, form_id, level, power, status,
    source_type, acquired_at, metadata
  ) values (
    p_user_id, p_template_id, p_form_id, p_level, p_power, 'available',
    p_source_type, now() + p_acquired_offset,
    jsonb_build_object('fixture', true, 'suite', 'stage3_database_acceptance')
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (
    item_instance_id, user_id, event_type, source_type, source_id, after_state
  ) values (
    v_item_id, p_user_id, 'created', p_source_type, null,
    jsonb_build_object('fixture', true, 'suite', 'stage3_database_acceptance')
  );

  return v_item_id;
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, txt text, payload jsonb) on commit drop;

-- Deterministic growth rules for this acceptance transaction.
insert into inventory.upgrade_rules (rarity_code, form_index, from_level, to_level, cost_fgems, power_gain, active, metadata)
values ('COMMON', 1, 1, 2, 10, 7, true, jsonb_build_object('suite', 'stage3_database_acceptance'))
on conflict (rarity_code, form_index, from_level, to_level, active)
do update set cost_fgems = excluded.cost_fgems,
              power_gain = excluded.power_gain,
              metadata = inventory.upgrade_rules.metadata || excluded.metadata,
              updated_at = now();

insert into inventory.decompose_rules (rarity_code, form_index, min_level, reward_fgems, active, metadata)
values ('COMMON', 1, 1, 5, true, jsonb_build_object('suite', 'stage3_database_acceptance'))
on conflict (rarity_code, form_index, min_level, active)
do update set reward_fgems = excluded.reward_fgems,
              metadata = inventory.decompose_rules.metadata || excluded.metadata,
              updated_at = now();

insert into _ids (key, id) values
  ('upgrade_user', testutil.make_user(13000000001, 'stage3_upgrade_user')),
  ('upgrade_poor_user', testutil.make_user(13000000002, 'stage3_upgrade_poor_user')),
  ('evolve_user', testutil.make_user(13000000003, 'stage3_evolve_user')),
  ('evolve_poor_user', testutil.make_user(13000000004, 'stage3_evolve_poor_user')),
  ('decompose_user', testutil.make_user(13000000005, 'stage3_decompose_user')),
  ('album_user', testutil.make_user(13000000006, 'stage3_album_user')),
  ('leaderboard_user1', testutil.make_user(13000000007, 'stage3_leaderboard_user1')),
  ('leaderboard_user2', testutil.make_user(13000000008, 'stage3_leaderboard_user2'));

do $$
begin
  perform api._credit_balance((select id from _ids where key = 'upgrade_user'), 'FGEMS', 100, 'test_setup', null, null, 'stage3-accept-upgrade-fgems-setup', 'fixture', '{}'::jsonb);
  perform api._credit_balance((select id from _ids where key = 'upgrade_poor_user'), 'FGEMS', 5, 'test_setup', null, null, 'stage3-accept-upgrade-poor-fgems-setup', 'fixture', '{}'::jsonb);
  perform api._credit_balance((select id from _ids where key = 'evolve_user'), 'KCOIN', 1000, 'test_setup', null, null, 'stage3-accept-evolve-kcoin-setup', 'fixture', '{}'::jsonb);
  perform api._credit_balance((select id from _ids where key = 'evolve_poor_user'), 'KCOIN', 50, 'test_setup', null, null, 'stage3-accept-evolve-poor-kcoin-setup', 'fixture', '{}'::jsonb);
end;
$$;

-- Upgrade acceptance cases.
insert into _ids (key, payload) values ('upgrade_catalog', testutil.create_catalog_fixture('stage3-accept-upgrade', 'COMMON'));
insert into _ids (key, id) select 'upgrade_template', ((select payload from _ids where key = 'upgrade_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'upgrade_form1', ((select payload from _ids where key = 'upgrade_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'upgrade_item', testutil.create_item((select id from _ids where key = 'upgrade_user'), (select id from _ids where key = 'upgrade_template'), (select id from _ids where key = 'upgrade_form1'), 1, 10);

insert into _ids (key, payload)
select 'upgrade_success', api.inventory_upgrade_item(
  (select id from _ids where key = 'upgrade_user'),
  (select id from _ids where key = 'upgrade_item'),
  'stage3-accept-upgrade-success'
);

select is(((select payload from _ids where key = 'upgrade_success') ->> 'to_level')::integer, 2, 'upgrade success returns level 2');
select is((select level from inventory.item_instances where id = (select id from _ids where key = 'upgrade_item')), 2, 'upgrade success changes item level');
select is((select power from inventory.item_instances where id = (select id from _ids where key = 'upgrade_item')), 17, 'upgrade success changes item power by rule gain');
select is(testutil.balance_of((select id from _ids where key = 'upgrade_user'), 'FGEMS'), 90::numeric, 'upgrade success debits FGEMS');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-success'), 1, 'upgrade success writes one upgrade log');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.upgrade_logs logs on logs.ledger_id = ledger.id
  where logs.idempotency_key = 'stage3-accept-upgrade-success'
    and ledger.entry_type = 'debit'
    and ledger.currency_code = 'FGEMS'
    and ledger.amount = 10
    and ledger.available_before = 100
    and ledger.available_after = 90
), 1, 'upgrade success writes exactly one FGEMS debit ledger with balance snapshots');

insert into _ids (key, payload)
select 'upgrade_repeat', api.inventory_upgrade_item(
  (select id from _ids where key = 'upgrade_user'),
  (select id from _ids where key = 'upgrade_item'),
  'stage3-accept-upgrade-success'
);

select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-success'), 1, 'repeated upgrade idempotency key does not create another log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-upgrade-success'), 1, 'repeated upgrade idempotency key does not create another debit');
select is(testutil.balance_of((select id from _ids where key = 'upgrade_user'), 'FGEMS'), 90::numeric, 'repeated upgrade idempotency key does not debit again');

insert into _ids (key, id) select 'upgrade_poor_item', testutil.create_item((select id from _ids where key = 'upgrade_poor_user'), (select id from _ids where key = 'upgrade_template'), (select id from _ids where key = 'upgrade_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_upgrade_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'upgrade_poor_user'), (select id::text from _ids where key = 'upgrade_poor_item'), 'stage3-accept-upgrade-insufficient'), '%insufficient balance%'), 'upgrade rejects insufficient FGEMS');
select is((select level from inventory.item_instances where id = (select id from _ids where key = 'upgrade_poor_item')), 1, 'insufficient-FGEMS upgrade leaves item level unchanged');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-insufficient'), 0, 'insufficient-FGEMS upgrade writes no log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-upgrade-insufficient'), 0, 'insufficient-FGEMS upgrade writes no ledger');

insert into _ids (key, payload) values ('upgrade_max_catalog', testutil.create_catalog_fixture('stage3-accept-upgrade-max', 'COMMON', true, true, true, true, true, 1));
insert into _ids (key, id) select 'upgrade_max_template', ((select payload from _ids where key = 'upgrade_max_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'upgrade_max_form1', ((select payload from _ids where key = 'upgrade_max_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'upgrade_max_item', testutil.create_item((select id from _ids where key = 'upgrade_user'), (select id from _ids where key = 'upgrade_max_template'), (select id from _ids where key = 'upgrade_max_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_upgrade_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'upgrade_user'), (select id::text from _ids where key = 'upgrade_max_item'), 'stage3-accept-upgrade-max'), '%item already at max level%'), 'upgrade rejects max-level item');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-max'), 0, 'max-level upgrade writes no log');

insert into _ids (key, id) select 'upgrade_listed_item', testutil.create_item((select id from _ids where key = 'upgrade_user'), (select id from _ids where key = 'upgrade_template'), (select id from _ids where key = 'upgrade_form1'), 1, 10);
insert into _ids (key, payload)
select 'upgrade_listing', api.market_create_listing(
  (select id from _ids where key = 'upgrade_user'),
  array[(select id from _ids where key = 'upgrade_listed_item')],
  100,
  'stage3-accept-upgrade-listing'
);
select ok(testutil.raises_like(format('select api.inventory_upgrade_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'upgrade_user'), (select id::text from _ids where key = 'upgrade_listed_item'), 'stage3-accept-upgrade-listed'), '%item is not available%'), 'upgrade rejects listed item');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-listed'), 0, 'listed-item upgrade writes no log');

insert into _ids (key, id) select 'upgrade_locked_item', testutil.create_item((select id from _ids where key = 'upgrade_user'), (select id from _ids where key = 'upgrade_template'), (select id from _ids where key = 'upgrade_form1'), 1, 10);
insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, status)
values ((select id from _ids where key = 'upgrade_locked_item'), (select id from _ids where key = 'upgrade_user'), 'admin_hold', 'test_setup', 'active');
select ok(testutil.raises_like(format('select api.inventory_upgrade_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'upgrade_user'), (select id::text from _ids where key = 'upgrade_locked_item'), 'stage3-accept-upgrade-locked'), '%item is not available%'), 'upgrade rejects actively locked item');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-accept-upgrade-locked'), 0, 'locked-item upgrade writes no log');

-- Evolution acceptance cases.
insert into _ids (key, payload) values ('evolve_success_catalog', testutil.create_catalog_fixture('stage3-accept-evolve-success', 'COMMON'));
insert into _ids (key, payload) values ('evolve_success_target_catalog', testutil.create_catalog_fixture('stage3-accept-evolve-success-target', 'RARE'));
insert into _ids (key, id) select 'evolve_success_template', ((select payload from _ids where key = 'evolve_success_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'evolve_success_form1', ((select payload from _ids where key = 'evolve_success_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'evolve_success_form2', ((select payload from _ids where key = 'evolve_success_catalog') ->> 'form2_id')::uuid;
insert into _ids (key, id) select 'evolve_success_target_template', ((select payload from _ids where key = 'evolve_success_target_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'evolve_success_target_form', ((select payload from _ids where key = 'evolve_success_target_catalog') ->> 'form1_id')::uuid;
insert into inventory.evolution_rules (from_template_id, from_form_id, to_template_id, to_form_id, required_count, cost_kcoin, success_rate_bps, active, metadata)
values ((select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), (select id from _ids where key = 'evolve_success_target_template'), (select id from _ids where key = 'evolve_success_target_form'), 3, 120, 10000, true, jsonb_build_object('suite', 'stage3_database_acceptance'))
on conflict (from_template_id, from_form_id) where active = true
do update set cost_kcoin = excluded.cost_kcoin,
              success_rate_bps = excluded.success_rate_bps,
              to_template_id = excluded.to_template_id,
              to_form_id = excluded.to_form_id,
              metadata = inventory.evolution_rules.metadata || excluded.metadata,
              updated_at = now();

insert into _ids (key, id) select 'evolve_s1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10, 'admin', interval '1 seconds');
insert into _ids (key, id) select 'evolve_s2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 2, 20, 'admin', interval '2 seconds');
insert into _ids (key, id) select 'evolve_s3', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 3, 30, 'admin', interval '3 seconds');

insert into _ids (key, payload)
select 'evolve_success', api.inventory_evolve_item(
  (select id from _ids where key = 'evolve_user'),
  array[(select id from _ids where key = 'evolve_s1'), (select id from _ids where key = 'evolve_s2'), (select id from _ids where key = 'evolve_s3')],
  'stage3-accept-evolve-success',
  (select id from _ids where key = 'evolve_success_target_form'),
  120::numeric,
  10000,
  (select id from _ids where key = 'evolve_s3')
);
insert into _ids (key, id) select 'evolve_success_result', ((select payload from _ids where key = 'evolve_success') ->> 'result_item_instance_id')::uuid;

select ok(((select payload from _ids where key = 'evolve_success') ->> 'success')::boolean, 'evolution success returns success=true');
select ok((select id from _ids where key = 'evolve_success_result') is not null, 'evolution success returns result item id');
select is((select count(*)::integer from inventory.item_instances where id in ((select id from _ids where key = 'evolve_s1'), (select id from _ids where key = 'evolve_s2'), (select id from _ids where key = 'evolve_s3')) and status = 'consumed' and owner_user_id is null), 3, 'evolution success consumes all source items and clears owners');
select ok(exists (
  select 1
  from inventory.item_instances
  where id = (select id from _ids where key = 'evolve_success_result')
    and owner_user_id = (select id from _ids where key = 'evolve_user')
    and template_id = (select id from _ids where key = 'evolve_success_target_template')
    and form_id = (select id from _ids where key = 'evolve_success_target_form')
    and status = 'available'
), 'evolution success creates a new available target item');
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-success' and status = 'success' and result_item_instance_id is not null), 1, 'evolution success writes one successful attempt');
select is((select count(*)::integer from inventory.evolution_consumed_items where attempt_id = ((select payload from _ids where key = 'evolve_success') ->> 'attempt_id')::uuid), 3, 'evolution success writes three consumed item rows');
select is(testutil.balance_of((select id from _ids where key = 'evolve_user'), 'KCOIN'), 880::numeric, 'evolution success debits KCOIN');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.evolution_attempts attempts on attempts.ledger_id = ledger.id
  where attempts.idempotency_key = 'stage3-accept-evolve-success'
    and ledger.entry_type = 'debit'
    and ledger.currency_code = 'KCOIN'
    and ledger.amount = 120
    and ledger.available_before = 1000
    and ledger.available_after = 880
), 1, 'evolution success writes exactly one KCOIN debit ledger with balance snapshots');

insert into _ids (key, payload)
select 'evolve_success_repeat', api.inventory_evolve_item(
  (select id from _ids where key = 'evolve_user'),
  array[(select id from _ids where key = 'evolve_s1'), (select id from _ids where key = 'evolve_s2'), (select id from _ids where key = 'evolve_s3')],
  'stage3-accept-evolve-success',
  null::uuid,
  null::numeric,
  null::integer,
  null::uuid
);
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-success'), 1, 'repeated evolution idempotency key does not create another attempt');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-evolve-success'), 1, 'repeated evolution idempotency key does not create another debit');
select is(testutil.balance_of((select id from _ids where key = 'evolve_user'), 'KCOIN'), 880::numeric, 'repeated evolution idempotency key does not debit again');

insert into _ids (key, id) select 'evolve_short1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_short2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid], %L, null::uuid, null::numeric, null::integer, null::uuid)', (select id::text from _ids where key = 'evolve_user'), (select id::text from _ids where key = 'evolve_short1'), (select id::text from _ids where key = 'evolve_short2'), 'stage3-accept-evolve-short'), '%exactly three item ids are required%'), 'evolution rejects fewer than three items');
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-short'), 0, 'short evolution writes no attempt');

select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L, null::uuid, null::numeric, null::integer, null::uuid)', (select id::text from _ids where key = 'evolve_user'), (select id::text from _ids where key = 'evolve_short1'), (select id::text from _ids where key = 'evolve_short1'), (select id::text from _ids where key = 'evolve_short2'), 'stage3-accept-evolve-duplicate'), '%duplicate item ids are not allowed%'), 'evolution rejects duplicate item ids');
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-duplicate'), 0, 'duplicate-id evolution writes no attempt');

insert into _ids (key, payload) values ('evolve_other_catalog', testutil.create_catalog_fixture('stage3-accept-evolve-other', 'COMMON'));
insert into _ids (key, id) select 'evolve_other_template', ((select payload from _ids where key = 'evolve_other_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'evolve_other_form1', ((select payload from _ids where key = 'evolve_other_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'evolve_mix_t1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_mix_t2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_mix_t3', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_other_template'), (select id from _ids where key = 'evolve_other_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L, null::uuid, null::numeric, null::integer, null::uuid)', (select id::text from _ids where key = 'evolve_user'), (select id::text from _ids where key = 'evolve_mix_t1'), (select id::text from _ids where key = 'evolve_mix_t2'), (select id::text from _ids where key = 'evolve_mix_t3'), 'stage3-accept-evolve-mixed-template'), '%same collectible and form%'), 'evolution rejects mixed templates');

insert into _ids (key, id) select 'evolve_mix_f1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_mix_f2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_mix_f3', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form2'), 1, 30);
select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L, null::uuid, null::numeric, null::integer, null::uuid)', (select id::text from _ids where key = 'evolve_user'), (select id::text from _ids where key = 'evolve_mix_f1'), (select id::text from _ids where key = 'evolve_mix_f2'), (select id::text from _ids where key = 'evolve_mix_f3'), 'stage3-accept-evolve-mixed-form'), '%same collectible and form%'), 'evolution rejects mixed forms');

insert into _ids (key, id) select 'evolve_listed1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_listed2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_listed3', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, payload)
select 'evolve_listing', api.market_create_listing(
  (select id from _ids where key = 'evolve_user'),
  array[(select id from _ids where key = 'evolve_listed1')],
  100,
  'stage3-accept-evolve-listing'
);
select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L, null::uuid, null::numeric, null::integer, null::uuid)', (select id::text from _ids where key = 'evolve_user'), (select id::text from _ids where key = 'evolve_listed1'), (select id::text from _ids where key = 'evolve_listed2'), (select id::text from _ids where key = 'evolve_listed3'), 'stage3-accept-evolve-listed'), '%not evolvable or not available%'), 'evolution rejects listed item');
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-listed'), 0, 'listed evolution writes no attempt');

insert into _ids (key, id) select 'evolve_poor1', testutil.create_item((select id from _ids where key = 'evolve_poor_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
insert into _ids (key, id) select 'evolve_poor2', testutil.create_item((select id from _ids where key = 'evolve_poor_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 3, 30);
insert into _ids (key, id) select 'evolve_poor3', testutil.create_item((select id from _ids where key = 'evolve_poor_user'), (select id from _ids where key = 'evolve_success_template'), (select id from _ids where key = 'evolve_success_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_evolve_item(%L::uuid, array[%L::uuid, %L::uuid, %L::uuid], %L, %L::uuid, 120::numeric, 10000, %L::uuid)', (select id::text from _ids where key = 'evolve_poor_user'), (select id::text from _ids where key = 'evolve_poor1'), (select id::text from _ids where key = 'evolve_poor2'), (select id::text from _ids where key = 'evolve_poor3'), 'stage3-accept-evolve-insufficient', (select id::text from _ids where key = 'evolve_success_target_form'), (select id::text from _ids where key = 'evolve_poor2')), '%insufficient balance%'), 'evolution rejects insufficient KCOIN');
select is((select count(*)::integer from inventory.evolution_attempts where idempotency_key = 'stage3-accept-evolve-insufficient'), 0, 'insufficient-KCOIN evolution writes no attempt');
select is(testutil.balance_of((select id from _ids where key = 'evolve_poor_user'), 'KCOIN'), 50::numeric, 'insufficient-KCOIN evolution leaves balance unchanged');

insert into _ids (key, payload) values ('evolve_fail_catalog', testutil.create_catalog_fixture('stage3-accept-evolve-fail', 'COMMON'));
insert into _ids (key, payload) values ('evolve_fail_target_catalog', testutil.create_catalog_fixture('stage3-accept-evolve-fail-target', 'RARE'));
insert into _ids (key, id) select 'evolve_fail_template', ((select payload from _ids where key = 'evolve_fail_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'evolve_fail_form1', ((select payload from _ids where key = 'evolve_fail_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'evolve_fail_form2', ((select payload from _ids where key = 'evolve_fail_catalog') ->> 'form2_id')::uuid;
insert into _ids (key, id) select 'evolve_fail_target_template', ((select payload from _ids where key = 'evolve_fail_target_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'evolve_fail_target_form', ((select payload from _ids where key = 'evolve_fail_target_catalog') ->> 'form1_id')::uuid;
insert into inventory.evolution_rules (from_template_id, from_form_id, to_template_id, to_form_id, required_count, cost_kcoin, success_rate_bps, active, metadata)
values ((select id from _ids where key = 'evolve_fail_template'), (select id from _ids where key = 'evolve_fail_form1'), (select id from _ids where key = 'evolve_fail_target_template'), (select id from _ids where key = 'evolve_fail_target_form'), 3, 80, 0, true, jsonb_build_object('suite', 'stage3_database_acceptance'))
on conflict (from_template_id, from_form_id) where active = true
do update set cost_kcoin = excluded.cost_kcoin,
              success_rate_bps = excluded.success_rate_bps,
              to_template_id = excluded.to_template_id,
              to_form_id = excluded.to_form_id,
              metadata = inventory.evolution_rules.metadata || excluded.metadata,
              updated_at = now();

insert into _ids (key, id) select 'evolve_f1', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_fail_template'), (select id from _ids where key = 'evolve_fail_form1'), 1, 10, 'admin', interval '1 seconds');
insert into _ids (key, id) select 'evolve_f2', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_fail_template'), (select id from _ids where key = 'evolve_fail_form1'), 5, 50, 'admin', interval '2 seconds');
insert into _ids (key, id) select 'evolve_f3', testutil.create_item((select id from _ids where key = 'evolve_user'), (select id from _ids where key = 'evolve_fail_template'), (select id from _ids where key = 'evolve_fail_form1'), 2, 20, 'admin', interval '3 seconds');
insert into _ids (key, payload)
select 'evolve_failed', api.inventory_evolve_item(
  (select id from _ids where key = 'evolve_user'),
  array[(select id from _ids where key = 'evolve_f1'), (select id from _ids where key = 'evolve_f2'), (select id from _ids where key = 'evolve_f3')],
  'stage3-accept-evolve-failed',
  (select id from _ids where key = 'evolve_fail_target_form'),
  80::numeric,
  0,
  (select id from _ids where key = 'evolve_f2')
);
insert into _ids (key, id) select 'evolve_failed_main', ((select payload from _ids where key = 'evolve_failed') ->> 'main_item_instance_id')::uuid;

select ok(not ((select payload from _ids where key = 'evolve_failed') ->> 'success')::boolean, 'evolution failure returns success=false');
select is(((select payload from _ids where key = 'evolve_failed') ->> 'result_item_instance_id'), null, 'evolution failure returns no result item');
select is((select id from _ids where key = 'evolve_failed_main'), (select id from _ids where key = 'evolve_f2'), 'evolution failure returns highest-level main item');
select ok(exists (select 1 from inventory.item_instances where id = (select id from _ids where key = 'evolve_f2') and status = 'available' and owner_user_id = (select id from _ids where key = 'evolve_user')), 'evolution failure keeps main item available and owned');
select is((select count(*)::integer from inventory.item_instances where id in ((select id from _ids where key = 'evolve_f1'), (select id from _ids where key = 'evolve_f3')) and status = 'consumed' and owner_user_id is null), 2, 'evolution failure consumes only material items');
select is((select count(*)::integer from inventory.evolution_consumed_items where attempt_id = ((select payload from _ids where key = 'evolve_failed') ->> 'attempt_id')::uuid and returned = true), 1, 'evolution failure marks one returned main item');
select is(testutil.balance_of((select id from _ids where key = 'evolve_user'), 'KCOIN'), 800::numeric, 'evolution failure still debits KCOIN');

-- Decomposition acceptance cases.
insert into _ids (key, payload) values ('decompose_catalog', testutil.create_catalog_fixture('stage3-accept-decompose', 'COMMON'));
insert into _ids (key, id) select 'decompose_template', ((select payload from _ids where key = 'decompose_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'decompose_form1', ((select payload from _ids where key = 'decompose_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'decompose_item1', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);
insert into _ids (key, id) select 'decompose_item2', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);

insert into _ids (key, payload)
select 'decompose_success', api.inventory_decompose_item(
  (select id from _ids where key = 'decompose_user'),
  (select id from _ids where key = 'decompose_item1'),
  'stage3-accept-decompose-success'
);
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'decompose_item1')), 'decomposed', 'decomposition success marks item decomposed');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'decompose_item1')), null, 'decomposition success clears owner');
select is(testutil.balance_of((select id from _ids where key = 'decompose_user'), 'FGEMS'), 5::numeric, 'decomposition success credits FGEMS');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-success'), 1, 'decomposition success writes one decompose log');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.decompose_logs logs on logs.ledger_id = ledger.id
  where logs.idempotency_key = 'stage3-accept-decompose-success'
    and ledger.entry_type = 'credit'
    and ledger.currency_code = 'FGEMS'
    and ledger.amount = 5
    and ledger.available_before = 0
    and ledger.available_after = 5
), 1, 'decomposition success writes exactly one FGEMS credit ledger with balance snapshots');

insert into _ids (key, payload)
select 'decompose_repeat', api.inventory_decompose_item(
  (select id from _ids where key = 'decompose_user'),
  (select id from _ids where key = 'decompose_item1'),
  'stage3-accept-decompose-success'
);
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-success'), 1, 'repeated decomposition idempotency key does not create another log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-decompose-success'), 1, 'repeated decomposition idempotency key does not create another credit');
select is(testutil.balance_of((select id from _ids where key = 'decompose_user'), 'FGEMS'), 5::numeric, 'repeated decomposition idempotency key does not credit again');

select ok(testutil.raises_like(format('select api.inventory_decompose_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'decompose_user'), (select id::text from _ids where key = 'decompose_item2'), 'stage3-accept-decompose-only-one'), '%only duplicate collectibles can be decomposed%'), 'decomposition rejects user only remaining copy');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-only-one'), 0, 'only-copy decomposition writes no log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-decompose-only-one'), 0, 'only-copy decomposition writes no ledger credit');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'decompose_item2')), 'available', 'only-copy decomposition leaves item status unchanged');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'decompose_item2')), (select id from _ids where key = 'decompose_user'), 'only-copy decomposition leaves item owner unchanged');

insert into _ids (key, id) select 'decompose_listed1', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);
insert into _ids (key, id) select 'decompose_listed2', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);
insert into _ids (key, payload)
select 'decompose_listing', api.market_create_listing(
  (select id from _ids where key = 'decompose_user'),
  array[(select id from _ids where key = 'decompose_listed1')],
  100,
  'stage3-accept-decompose-listing'
);
select ok(testutil.raises_like(format('select api.inventory_decompose_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'decompose_user'), (select id::text from _ids where key = 'decompose_listed1'), 'stage3-accept-decompose-listed'), '%item is not available%'), 'decomposition rejects listed item');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-listed'), 0, 'listed-item decomposition writes no log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-decompose-listed'), 0, 'listed-item decomposition writes no ledger credit');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'decompose_listed1')), 'listed', 'listed-item decomposition leaves item status unchanged');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'decompose_listed1')), (select id from _ids where key = 'decompose_user'), 'listed-item decomposition leaves item owner unchanged');

insert into _ids (key, id) select 'decompose_locked1', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);
insert into _ids (key, id) select 'decompose_locked2', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_template'), (select id from _ids where key = 'decompose_form1'), 1, 10);
insert into inventory.inventory_locks (item_instance_id, user_id, lock_type, source_type, status)
values ((select id from _ids where key = 'decompose_locked1'), (select id from _ids where key = 'decompose_user'), 'admin_hold', 'test_setup', 'active');
select ok(testutil.raises_like(format('select api.inventory_decompose_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'decompose_user'), (select id::text from _ids where key = 'decompose_locked1'), 'stage3-accept-decompose-locked'), '%item is locked%'), 'decomposition rejects actively locked item');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-locked'), 0, 'locked-item decomposition writes no log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-decompose-locked'), 0, 'locked-item decomposition writes no ledger credit');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'decompose_locked1')), 'available', 'locked-item decomposition leaves item status unchanged');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'decompose_locked1')), (select id from _ids where key = 'decompose_user'), 'locked-item decomposition leaves item owner unchanged');

insert into _ids (key, payload) values ('decompose_blocked_catalog', testutil.create_catalog_fixture('stage3-accept-decompose-blocked', 'COMMON', true, true, true, false, true));
insert into _ids (key, id) select 'decompose_blocked_template', ((select payload from _ids where key = 'decompose_blocked_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'decompose_blocked_form1', ((select payload from _ids where key = 'decompose_blocked_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'decompose_blocked1', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_blocked_template'), (select id from _ids where key = 'decompose_blocked_form1'), 1, 10);
insert into _ids (key, id) select 'decompose_blocked2', testutil.create_item((select id from _ids where key = 'decompose_user'), (select id from _ids where key = 'decompose_blocked_template'), (select id from _ids where key = 'decompose_blocked_form1'), 1, 10);
select ok(testutil.raises_like(format('select api.inventory_decompose_item(%L::uuid, %L::uuid, %L)', (select id::text from _ids where key = 'decompose_user'), (select id::text from _ids where key = 'decompose_blocked1'), 'stage3-accept-decompose-not-decomposable'), '%item is not decomposable%'), 'decomposition rejects non-decomposable template');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-accept-decompose-not-decomposable'), 0, 'non-decomposable-template decomposition writes no log');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'stage3-accept-decompose-not-decomposable'), 0, 'non-decomposable-template decomposition writes no ledger credit');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'decompose_blocked1')), 'available', 'non-decomposable-template decomposition leaves item status unchanged');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'decompose_blocked1')), (select id from _ids where key = 'decompose_user'), 'non-decomposable-template decomposition leaves item owner unchanged');

-- Album progress and milestone reward acceptance cases.
insert into _ids (key, payload) values ('album_catalog_a', testutil.create_catalog_fixture('stage3-accept-album-a', 'COMMON'));
insert into _ids (key, payload) values ('album_catalog_b', testutil.create_catalog_fixture('stage3-accept-album-b', 'COMMON'));
insert into _ids (key, id) select 'album_template_a', ((select payload from _ids where key = 'album_catalog_a') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'album_template_b', ((select payload from _ids where key = 'album_catalog_b') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'album_form_a', ((select payload from _ids where key = 'album_catalog_a') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'album_form_b', ((select payload from _ids where key = 'album_catalog_b') ->> 'form1_id')::uuid;

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('STAGE3_ACCEPT_ALBUM_BOOK', 'Stage3 Accept Album Book', 'acceptance fixture', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'album_book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values
  ((select id from _ids where key = 'album_book'), (select id from _ids where key = 'album_template_a'), 1),
  ((select id from _ids where key = 'album_book'), (select id from _ids where key = 'album_template_b'), 2)
on conflict (book_id, template_id) do nothing;

insert into _ids (key, id) select 'album_item_a', testutil.create_item((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_template_a'), (select id from _ids where key = 'album_form_a'), 1, 10);
select ok(exists (
  select 1 from album.user_discoveries
  where user_id = (select id from _ids where key = 'album_user')
    and template_id = (select id from _ids where key = 'album_template_a')
), 'obtaining an item records album discovery');

insert into _ids (key, payload)
select 'album_progress_one', api.album_get_progress((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_book'));
select is(((select payload from _ids where key = 'album_progress_one') -> 'book' ->> 'total_count')::integer, 2, 'album progress total_count is based on book_items');
select is(((select payload from _ids where key = 'album_progress_one') -> 'book' ->> 'collected_count')::integer, 1, 'album progress collected_count is based on user_discoveries');
select is(((select payload from _ids where key = 'album_progress_one') -> 'book' ->> 'completion_percent')::numeric, 50.00::numeric, 'album progress completion_percent is correct');

insert into _ids (key, payload)
select 'album_listing', api.market_create_listing(
  (select id from _ids where key = 'album_user'),
  array[(select id from _ids where key = 'album_item_a')],
  100,
  'stage3-accept-album-listing'
);
insert into _ids (key, payload)
select 'album_progress_after_listing', api.album_get_progress((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_book'));
select is(((select payload from _ids where key = 'album_progress_after_listing') -> 'book' ->> 'collected_count')::integer, 1, 'album progress does not decrease after listing/selling flow changes inventory status');

insert into _ids (key, id) select 'album_decompose_item_a1', testutil.create_item((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_template_b'), (select id from _ids where key = 'album_form_b'), 1, 10);
insert into _ids (key, id) select 'album_decompose_item_a2', testutil.create_item((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_template_b'), (select id from _ids where key = 'album_form_b'), 1, 10);
insert into _ids (key, payload)
select 'album_decompose', api.inventory_decompose_item(
  (select id from _ids where key = 'album_user'),
  (select id from _ids where key = 'album_decompose_item_a1'),
  'stage3-accept-album-decompose'
);
insert into _ids (key, payload)
select 'album_progress_after_decompose', api.album_get_progress((select id from _ids where key = 'album_user'), (select id from _ids where key = 'album_book'));
select is(((select payload from _ids where key = 'album_progress_after_decompose') -> 'book' ->> 'collected_count')::integer, 2, 'album progress does not decrease after decomposition');
select is(((select payload from _ids where key = 'album_progress_after_decompose') -> 'book' ->> 'completion_percent')::numeric, 100.00::numeric, 'album completion reaches 100 percent after two discoveries');

with claimable_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order, metadata)
  values ((select id from _ids where key = 'album_book'), 1, 'Collect 1', '[{"currency":"FGEMS","amount":11}]'::jsonb, true, 1, jsonb_build_object('version', 0))
  on conflict (book_id, required_count) do update
  set reward = excluded.reward,
      active = true,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'album_milestone_claimable', id from claimable_row;

with unreached_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order, metadata)
  values ((select id from _ids where key = 'album_book'), 3, 'Collect 3', '[{"currency":"KCOIN","amount":22}]'::jsonb, true, 2, jsonb_build_object('version', 0))
  on conflict (book_id, required_count) do update
  set reward = excluded.reward,
      active = true,
      metadata = excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'album_milestone_unreached', id from unreached_row;

select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, %L, 0)', (select id::text from _ids where key = 'album_user'), (select id::text from _ids where key = 'album_milestone_unreached'), 'stage3-accept-album-unreached'), '%milestone not reached%'), 'album reward rejects unreached milestone');
select is((select count(*)::integer from album.milestone_claims where milestone_id = (select id from _ids where key = 'album_milestone_unreached')), 0, 'unreached album reward writes no claim');

insert into _ids (key, payload)
select 'album_claim', api.album_claim_milestone(
  (select id from _ids where key = 'album_user'),
  (select id from _ids where key = 'album_milestone_claimable'),
  'stage3-accept-album-claim',
  0
);
select is((select count(*)::integer from album.milestone_claims where user_id = (select id from _ids where key = 'album_user') and milestone_id = (select id from _ids where key = 'album_milestone_claimable')), 1, 'album reward success writes one milestone claim');
select is(testutil.balance_of((select id from _ids where key = 'album_user'), 'FGEMS'), 16::numeric, 'album reward success credits FGEMS on top of decomposition reward');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'album_milestone:stage3-accept-album-claim:1:FGEMS' and entry_type = 'credit' and amount = 11 and currency_code = 'FGEMS'), 1, 'album reward success writes one FGEMS credit ledger');

insert into _ids (key, payload)
select 'album_claim_repeat', api.album_claim_milestone(
  (select id from _ids where key = 'album_user'),
  (select id from _ids where key = 'album_milestone_claimable'),
  'stage3-accept-album-claim',
  0
);
select ok(((select payload from _ids where key = 'album_claim_repeat') ->> 'idempotent')::boolean, 'repeated album reward claim returns idempotent=true');
select is((select count(*)::integer from economy.currency_ledger where idempotency_key = 'album_milestone:stage3-accept-album-claim:1:FGEMS'), 1, 'repeated album reward claim does not create another ledger row');
select is(testutil.balance_of((select id from _ids where key = 'album_user'), 'FGEMS'), 16::numeric, 'repeated album reward claim does not credit again');

-- Leaderboard acceptance cases.
insert into _ids (key, payload) values ('leaderboard_catalog_a', testutil.create_catalog_fixture('stage3-accept-leaderboard-a', 'COMMON'));
insert into _ids (key, payload) values ('leaderboard_catalog_b', testutil.create_catalog_fixture('stage3-accept-leaderboard-b', 'RARE'));
insert into _ids (key, id) select 'leaderboard_template_a', ((select payload from _ids where key = 'leaderboard_catalog_a') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'leaderboard_template_b', ((select payload from _ids where key = 'leaderboard_catalog_b') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'leaderboard_form_a', ((select payload from _ids where key = 'leaderboard_catalog_a') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'leaderboard_form_b', ((select payload from _ids where key = 'leaderboard_catalog_b') ->> 'form1_id')::uuid;
select testutil.create_item((select id from _ids where key = 'leaderboard_user1'), (select id from _ids where key = 'leaderboard_template_a'), (select id from _ids where key = 'leaderboard_form_a'), 1, 10);
select testutil.create_item((select id from _ids where key = 'leaderboard_user2'), (select id from _ids where key = 'leaderboard_template_a'), (select id from _ids where key = 'leaderboard_form_a'), 1, 10);
select testutil.create_item((select id from _ids where key = 'leaderboard_user2'), (select id from _ids where key = 'leaderboard_template_b'), (select id from _ids where key = 'leaderboard_form_b'), 1, 30);

insert into _ids (key, payload)
select 'leaderboard_refresh', api.album_refresh_weekly_leaderboard();

select ok(((select payload from _ids where key = 'leaderboard_refresh') ->> 'entry_count')::integer >= 2, 'leaderboard refresh generates entries');
select is((
  select count(*)::integer
  from (
    select rank
    from album.leaderboard_entries
    where leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
      and rank is not null
    group by rank
    having count(*) > 1
  ) duplicate_rank_rows
), 0, 'leaderboard ranks are unique');
select is((
  select count(*)::integer
  from (
    select user_id
    from album.leaderboard_entries
    where leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
    group by user_id
    having count(*) > 1
  ) duplicate_user_rows
), 0, 'leaderboard has at most one entry per user per board');
select ok((
  select user2_entry.score > user1_entry.score
  from album.leaderboard_entries user1_entry
  join album.leaderboard_entries user2_entry
    on user2_entry.leaderboard_id = user1_entry.leaderboard_id
  where user1_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
    and user1_entry.user_id = (select id from _ids where key = 'leaderboard_user1')
    and user2_entry.user_id = (select id from _ids where key = 'leaderboard_user2')
), 'higher discovery score is greater on leaderboard');
select ok((
  select user2_entry.rank < user1_entry.rank
  from album.leaderboard_entries user1_entry
  join album.leaderboard_entries user2_entry
    on user2_entry.leaderboard_id = user1_entry.leaderboard_id
  where user1_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
    and user1_entry.user_id = (select id from _ids where key = 'leaderboard_user1')
    and user2_entry.user_id = (select id from _ids where key = 'leaderboard_user2')
), 'higher score ranks ahead');

insert into _ids (key, payload)
select 'leaderboard_query', api.album_get_leaderboard(
  (select id from _ids where key = 'leaderboard_user2'),
  ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid,
  'current_week',
  'global',
  null,
  null,
  null,
  'score_desc',
  false,
  50,
  0
);
select ok(jsonb_array_length((select payload from _ids where key = 'leaderboard_query') -> 'entries') >= 2, 'leaderboard query returns generated entries');
select is(((select payload from _ids where key = 'leaderboard_query') -> 'my_entry' ->> 'user_id')::uuid, (select id from _ids where key = 'leaderboard_user2'), 'leaderboard query returns my_entry for current user');

select * from finish();

rollback;
