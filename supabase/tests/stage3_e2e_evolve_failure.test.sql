-- Stage 3 E2E acceptance: recommended flow 3, evolve failure only.
-- This test uses a 0% success rule to force the failure branch and verifies
-- the database artifacts required by "第十七步：端到端验收流程".

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.stage3_e2e_evolve_failure_make_user(
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
    p_last_name := 'EvolveFailure',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := null,
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'stage3_e2e_evolve_failure')
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.stage3_e2e_evolve_failure_balance_of(
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

create or replace function testutil.stage3_e2e_evolve_failure_create_catalog_fixture(
  p_prefix text
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_faction_id uuid;
  v_template_id uuid;
  v_base_form_id uuid;
  v_evolved_form_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Stage3 E2E Evolve Failure Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Stage3 E2E Evolve Failure Faction')
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
    'Stage3 E2E Evolve Failure Item',
    'evolve failure fixture',
    'stage3 evolve failure e2e fixture',
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
      evolvable = true,
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
    'https://example.test/stage3-e2e-evolve-failure/base.png',
    'https://example.test/stage3-e2e-evolve-failure/base-thumb.png',
    'https://example.test/stage3-e2e-evolve-failure/base-avatar.png',
    0,
    true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_base_form_id;

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
    2,
    'evolved',
    'Evolved Form',
    'Evolved form',
    'https://example.test/stage3-e2e-evolve-failure/evolved.png',
    'https://example.test/stage3-e2e-evolve-failure/evolved-thumb.png',
    'https://example.test/stage3-e2e-evolve-failure/evolved-avatar.png',
    20,
    false
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = false,
      updated_at = now()
  returning id into v_evolved_form_id;

  update catalog.collectible_forms
  set next_form_id = v_evolved_form_id,
      updated_at = now()
  where id = v_base_form_id;

  return jsonb_build_object(
    'template_id', v_template_id,
    'base_form_id', v_base_form_id,
    'evolved_form_id', v_evolved_form_id
  );
end;
$$;

create or replace function testutil.stage3_e2e_evolve_failure_create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer,
  p_power integer,
  p_acquired_offset interval
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
    acquired_at,
    metadata
  ) values (
    p_user_id,
    p_template_id,
    p_form_id,
    p_level,
    p_power,
    'available',
    'admin',
    now() + p_acquired_offset,
    jsonb_build_object('fixture', true, 'suite', 'stage3_e2e_evolve_failure')
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

select plan(24);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values (
  'user',
  testutil.stage3_e2e_evolve_failure_make_user(17000000003, 'stage3_e2e_evolve_failure_user')
);

do $$
begin
  perform api._credit_balance(
    (select id from _ids where key = 'user'),
    'KCOIN',
    1000,
    'test_setup',
    null,
    null,
    'stage3-e2e-evolve-failure-kcoin-setup',
    'fixture',
    '{}'::jsonb
  );
end;
$$;

insert into _ids (key, payload)
values (
  'catalog',
  testutil.stage3_e2e_evolve_failure_create_catalog_fixture('stage3-e2e-evolve-failure')
);

insert into _ids (key, payload)
values (
  'target_catalog',
  testutil.stage3_e2e_evolve_failure_create_catalog_fixture('stage3-e2e-evolve-failure-target')
);

insert into inventory.evolution_rules (
  from_template_id,
  from_form_id,
  to_template_id,
  to_form_id,
  required_count,
  cost_kcoin,
  success_rate_bps,
  active,
  metadata
) values (
  ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid,
  ((select payload from _ids where key = 'catalog') ->> 'base_form_id')::uuid,
  ((select payload from _ids where key = 'target_catalog') ->> 'template_id')::uuid,
  ((select payload from _ids where key = 'target_catalog') ->> 'base_form_id')::uuid,
  3,
  200,
  0,
  true,
  jsonb_build_object('suite', 'stage3_e2e_evolve_failure')
);

insert into _ids (key, id)
select
  'source_1',
  testutil.stage3_e2e_evolve_failure_create_item(
    (select id from _ids where key = 'user'),
    ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid,
    ((select payload from _ids where key = 'catalog') ->> 'base_form_id')::uuid,
    1,
    10,
    interval '1 seconds'
  );

insert into _ids (key, id)
select
  'source_2',
  testutil.stage3_e2e_evolve_failure_create_item(
    (select id from _ids where key = 'user'),
    ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid,
    ((select payload from _ids where key = 'catalog') ->> 'base_form_id')::uuid,
    2,
    20,
    interval '2 seconds'
  );

insert into _ids (key, id)
select
  'source_3',
  testutil.stage3_e2e_evolve_failure_create_item(
    (select id from _ids where key = 'user'),
    ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid,
    ((select payload from _ids where key = 'catalog') ->> 'base_form_id')::uuid,
    5,
    50,
    interval '3 seconds'
  );

insert into _ids (key, payload)
select
  'detail_before',
  api.inventory_get_item_detail(
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'source_1'),
    true,
    false,
    true,
    false,
    false
  );

select is((select payload from _ids where key = 'detail_before') ->> 'status', 'available', 'test user can select an available item');
select ok(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'can_evolve')::boolean, 'evolution preview allows the item');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'available_same_items')::integer, 3, 'evolution preview sees three matching available items');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'required_count')::integer, 3, 'evolution preview requires three materials');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'kcoin_cost')::numeric, 200::numeric, 'evolution preview returns KCOIN cost');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'user_kcoin_balance')::numeric, 1000::numeric, 'evolution preview sees enough KCOIN');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'success_rate_bps')::integer, 0, 'evolution preview uses a low success rate rule');
select is(((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'target_form_id')::uuid, ((select payload from _ids where key = 'target_catalog') ->> 'base_form_id')::uuid, 'evolution preview exposes the target form');

insert into _ids (key, payload)
select
  'evolve_result',
  api.inventory_evolve_item(
    (select id from _ids where key = 'user'),
    array[
      (select id from _ids where key = 'source_1'),
      (select id from _ids where key = 'source_2'),
      (select id from _ids where key = 'source_3')
    ],
    'stage3-e2e-evolve-failure',
    ((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'target_form_id')::uuid,
    ((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'kcoin_cost')::numeric,
    ((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'success_rate_bps')::integer,
    ((select payload from _ids where key = 'detail_before') -> 'evolution_preview' ->> 'main_return_item_id')::uuid
  );

insert into _ids (key, id)
select
  'attempt',
  ((select payload from _ids where key = 'evolve_result') ->> 'attempt_id')::uuid;

insert into _ids (key, id)
select
  'main_item',
  ((select payload from _ids where key = 'evolve_result') ->> 'main_item_instance_id')::uuid;

select ok(not ((select payload from _ids where key = 'evolve_result') ->> 'success')::boolean, 'evolution result reports failure');
select is(((select payload from _ids where key = 'evolve_result') ->> 'result_item_instance_id'), null::text, 'evolution failure returns no result item');
select is(((select payload from _ids where key = 'evolve_result') ->> 'kcoin_balance_before')::numeric, 1000::numeric, 'evolution result reports KCOIN before debit');
select is(((select payload from _ids where key = 'evolve_result') ->> 'kcoin_balance_after')::numeric, 800::numeric, 'evolution result reports KCOIN after debit');
select is(((select payload from _ids where key = 'evolve_result') ->> 'cost_kcoin')::numeric, 200::numeric, 'evolution result reports consumed KCOIN');
select is((select id from _ids where key = 'main_item'), (select id from _ids where key = 'source_3'), 'evolution failure returns the highest-level main item');
select ok(exists (
  select 1
  from inventory.item_instances
  where id = (select id from _ids where key = 'source_3')
    and status = 'available'
    and owner_user_id = (select id from _ids where key = 'user')
), 'main item remains available and owned by the user');
select is((
  select count(*)::integer
  from inventory.item_instances
  where id in ((select id from _ids where key = 'source_1'), (select id from _ids where key = 'source_2'))
    and status = 'consumed'
    and owner_user_id is null
), 2, 'the two non-main materials are consumed and ownerless');
select is((
  select count(*)::integer
  from inventory.item_instances
  where source_type = 'evolution'
    and source_id = (
      select rule_id from inventory.evolution_attempts where id = (select id from _ids where key = 'attempt')
    )
), 0, 'failure does not create a target evolved item');
select ok(exists (
  select 1
  from inventory.evolution_attempts
  where id = (select id from _ids where key = 'attempt')
    and user_id = (select id from _ids where key = 'user')
    and main_item_instance_id = (select id from _ids where key = 'source_3')
    and result_item_instance_id is null
    and status = 'failed'
    and cost_kcoin = 200
    and success_rate_bps = 0
    and ledger_id is not null
    and idempotency_key = 'stage3-e2e-evolve-failure'
), 'database writes a failed evolution_attempts row');
select is((
  select count(*)::integer
  from inventory.evolution_consumed_items
  where attempt_id = (select id from _ids where key = 'attempt')
    and item_instance_id = (select id from _ids where key = 'source_3')
    and role = 'main'
    and consumed = false
    and returned = true
), 1, 'consumed-items link marks the main item as returned');
select is((
  select count(*)::integer
  from inventory.evolution_consumed_items
  where attempt_id = (select id from _ids where key = 'attempt')
    and item_instance_id in ((select id from _ids where key = 'source_1'), (select id from _ids where key = 'source_2'))
    and role = 'material'
    and consumed = true
    and returned = false
), 2, 'consumed-items link marks both non-main materials consumed');
select is(testutil.stage3_e2e_evolve_failure_balance_of((select id from _ids where key = 'user'), 'KCOIN'), 800::numeric, 'database balance snapshot debits KCOIN');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.evolution_attempts attempts on attempts.ledger_id = ledger.id
  where attempts.id = (select id from _ids where key = 'attempt')
    and ledger.entry_type = 'debit'
    and ledger.currency_code = 'KCOIN'
    and ledger.amount = 200
    and ledger.available_before = 1000
    and ledger.available_after = 800
), 1, 'database writes one matching KCOIN debit ledger row');
select ok(exists (
  select 1
  from inventory.item_instance_events
  where item_instance_id = (select id from _ids where key = 'source_3')
    and event_type = 'evolved_failed_returned'
    and source_type = 'inventory_evolution'
    and source_id = (select id from _ids where key = 'attempt')
), 'database writes an evolved_failed_returned event for the main item');
select is((
  select count(*)::integer
  from inventory.item_instance_events
  where item_instance_id in ((select id from _ids where key = 'source_1'), (select id from _ids where key = 'source_2'))
    and event_type = 'consumed'
    and source_type = 'inventory_evolution'
    and source_id = (select id from _ids where key = 'attempt')
), 2, 'database writes consumed events for both material items');

select * from finish();

rollback;
