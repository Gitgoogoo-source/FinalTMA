-- Stage 3 E2E acceptance: recommended flow 1, upgrade only.
-- This test intentionally stops at the upgrade path and verifies the database
-- artifacts required by "第十七步：端到端验收流程".

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.stage3_e2e_make_user(
  p_telegram_user_id bigint,
  p_username text
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := p_username,
    p_first_name := 'Stage3',
    p_last_name := 'Upgrade',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := null,
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'stage3_e2e_upgrade')
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.stage3_e2e_balance_of(
  p_user_id uuid,
  p_currency_code text
)
returns numeric
language sql
stable
as $$
  select coalesce((
    select available_amount
    from economy.user_balances
    where user_id = p_user_id
      and currency_code = upper(p_currency_code)
  ), 0)::numeric;
$$;

create or replace function testutil.stage3_e2e_create_catalog_fixture(
  p_prefix text
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
  values (p_prefix || '-series', 'Stage3 E2E Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Stage3 E2E Faction')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id into v_faction_id;

  insert into catalog.collectible_templates (
    slug,
    display_name,
    subtitle,
    description,
    rarity_code,
    type_code,
    series_id,
    faction_id,
    base_power,
    max_level,
    release_status,
    tradeable,
    upgradeable,
    evolvable,
    decomposable,
    nft_mintable,
    sort_order
  ) values (
    p_prefix || '-template',
    'Stage3 E2E Upgrade Item',
    'upgrade fixture',
    'stage3 upgrade e2e fixture',
    'COMMON',
    'CHARACTER',
    v_series_id,
    v_faction_id,
    10,
    10,
    'active',
    true,
    true,
    true,
    true,
    true,
    10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      max_level = excluded.max_level,
      release_status = 'active',
      upgradeable = true,
      updated_at = now()
  returning id into v_template_id;

  insert into catalog.collectible_forms (
    template_id,
    form_index,
    form_slug,
    display_name,
    description,
    image_url,
    thumbnail_url,
    avatar_url,
    base_power_bonus,
    is_default
  ) values (
    v_template_id,
    1,
    'base',
    'Base Form',
    'Base form',
    'https://example.test/stage3-e2e/base.png',
    'https://example.test/stage3-e2e/base-thumb.png',
    'https://example.test/stage3-e2e/base-avatar.png',
    0,
    true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_id;

  return jsonb_build_object(
    'template_id', v_template_id,
    'form_id', v_form_id
  );
end;
$$;

create or replace function testutil.stage3_e2e_create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer,
  p_power integer
)
returns uuid
language plpgsql
as $$
declare
  v_item_id uuid;
begin
  insert into inventory.item_instances (
    owner_user_id,
    template_id,
    form_id,
    level,
    power,
    status,
    source_type,
    metadata
  ) values (
    p_user_id,
    p_template_id,
    p_form_id,
    p_level,
    p_power,
    'available',
    'admin',
    jsonb_build_object('fixture', true, 'suite', 'stage3_e2e_upgrade')
  )
  returning id into v_item_id;

  insert into inventory.item_instance_events (
    item_instance_id,
    user_id,
    event_type,
    source_type,
    source_id,
    after_state
  ) values (
    v_item_id,
    p_user_id,
    'created',
    'admin',
    null,
    jsonb_build_object('level', p_level, 'power', p_power)
  );

  return v_item_id;
end;
$$;

select plan(18);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into inventory.upgrade_rules (
  rarity_code,
  form_index,
  from_level,
  to_level,
  cost_fgems,
  power_gain,
  active,
  metadata
) values (
  'COMMON',
  1,
  1,
  2,
  20,
  8,
  true,
  jsonb_build_object('suite', 'stage3_e2e_upgrade')
)
on conflict (rarity_code, form_index, from_level, to_level, active)
do update set cost_fgems = excluded.cost_fgems,
              power_gain = excluded.power_gain,
              metadata = inventory.upgrade_rules.metadata || excluded.metadata,
              updated_at = now();

insert into _ids (key, id)
values (
  'user',
  testutil.stage3_e2e_make_user(17000000001, 'stage3_e2e_upgrade_user')
);

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'user'),
    'FGEMS',
    80,
    'test_setup',
    null,
    null,
    'stage3-e2e-upgrade-fgems-setup',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
values (
  'catalog',
  testutil.stage3_e2e_create_catalog_fixture('stage3-e2e-upgrade')
);

insert into _ids (key, id)
select
  'item',
  testutil.stage3_e2e_create_item(
    (select id from _ids where key = 'user'),
    ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid,
    ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid,
    1,
    10
  );

insert into _ids (key, payload)
select
  'detail_before',
  api.inventory_get_item_detail(
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'item'),
    true,
    true,
    false,
    false,
    false
  );

select is((select payload from _ids where key = 'detail_before') ->> 'status', 'available', 'test user can select an available item');
select is(((select payload from _ids where key = 'detail_before') ->> 'level')::integer, 1, 'selected item starts at level 1');
select ok(((select payload from _ids where key = 'detail_before') -> 'upgrade_preview' ->> 'can_upgrade')::boolean, 'upgrade preview allows the item');
select is(((select payload from _ids where key = 'detail_before') -> 'upgrade_preview' ->> 'user_fgems_balance')::numeric, 80::numeric, 'upgrade preview sees enough FGEMS');
select is(((select payload from _ids where key = 'detail_before') -> 'upgrade_preview' ->> 'fgems_cost')::numeric, 20::numeric, 'upgrade preview returns the FGEMS cost');

insert into _ids (key, payload)
select
  'upgrade_result',
  api.inventory_upgrade_item(
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'item'),
    'stage3-e2e-upgrade-success'
  );

select is(((select payload from _ids where key = 'upgrade_result') ->> 'from_level')::integer, 1, 'upgrade result reports the previous level');
select is(((select payload from _ids where key = 'upgrade_result') ->> 'to_level')::integer, 2, 'upgrade result reports level 2');
select is(((select payload from _ids where key = 'upgrade_result') ->> 'from_power')::integer, 10, 'upgrade result reports previous power');
select is(((select payload from _ids where key = 'upgrade_result') ->> 'to_power')::integer, 18, 'upgrade result reports increased power');
select is(((select payload from _ids where key = 'upgrade_result') ->> 'fgems_balance_before')::numeric, 80::numeric, 'upgrade result reports FGEMS before debit');
select is(((select payload from _ids where key = 'upgrade_result') ->> 'fgems_balance_after')::numeric, 60::numeric, 'upgrade result reports FGEMS after debit');
select is((select level from inventory.item_instances where id = (select id from _ids where key = 'item')), 2, 'database item_instances level is updated');
select is((select power from inventory.item_instances where id = (select id from _ids where key = 'item')), 18, 'database item_instances power is updated');
select is(testutil.stage3_e2e_balance_of((select id from _ids where key = 'user'), 'FGEMS'), 60::numeric, 'database balance snapshot debits FGEMS');
select is((select count(*)::integer from inventory.upgrade_logs where idempotency_key = 'stage3-e2e-upgrade-success'), 1, 'database writes one upgrade_logs row');
select is((
  select count(*)::integer
  from inventory.upgrade_logs
  where idempotency_key = 'stage3-e2e-upgrade-success'
    and item_instance_id = (select id from _ids where key = 'item')
    and from_level = 1
    and to_level = 2
    and from_power = 10
    and to_power = 18
    and cost_fgems = 20
    and ledger_id is not null
), 1, 'database upgrade_logs row records the level, power, cost and ledger link');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.upgrade_logs logs on logs.ledger_id = ledger.id
  where logs.idempotency_key = 'stage3-e2e-upgrade-success'
    and ledger.entry_type = 'debit'
    and ledger.currency_code = 'FGEMS'
    and ledger.amount = 20
    and ledger.available_before = 80
    and ledger.available_after = 60
), 1, 'database writes one matching FGEMS debit ledger row');
select ok(exists (
  select 1
  from inventory.item_instance_events
  where item_instance_id = (select id from _ids where key = 'item')
    and event_type = 'upgraded'
), 'database writes an upgraded item event');

select * from finish();

rollback;
