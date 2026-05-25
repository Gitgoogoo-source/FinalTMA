-- Stage 3 E2E acceptance: recommended flow 4, decompose only.
-- This test intentionally stops at the decomposition path and verifies the
-- database artifacts required by "第十七步：端到端验收流程".

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.stage3_e2e_decompose_make_user(
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
    p_last_name := 'Decompose',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := null,
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'stage3_e2e_decompose')
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.stage3_e2e_decompose_balance_of(
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

create or replace function testutil.stage3_e2e_decompose_create_catalog_fixture(
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
  values (p_prefix || '-series', 'Stage3 E2E Decompose Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Stage3 E2E Decompose Faction')
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
    'Stage3 E2E Decompose Item',
    'decompose fixture',
    'stage3 decompose e2e fixture',
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
      decomposable = true,
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
    'https://example.test/stage3-e2e-decompose/base.png',
    'https://example.test/stage3-e2e-decompose/base-thumb.png',
    'https://example.test/stage3-e2e-decompose/base-avatar.png',
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

create or replace function testutil.stage3_e2e_decompose_create_item(
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
    jsonb_build_object('fixture', true, 'suite', 'stage3_e2e_decompose')
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

insert into inventory.decompose_rules (
  rarity_code,
  form_index,
  min_level,
  reward_fgems,
  active,
  metadata
) values (
  'COMMON',
  1,
  1,
  5,
  true,
  jsonb_build_object('suite', 'stage3_e2e_decompose')
)
on conflict (rarity_code, form_index, min_level, active)
do update set reward_fgems = excluded.reward_fgems,
              metadata = inventory.decompose_rules.metadata || excluded.metadata,
              updated_at = now();

insert into _ids (key, id)
values (
  'user',
  testutil.stage3_e2e_decompose_make_user(17000000004, 'stage3_e2e_decompose_user')
);

insert into _ids (key, payload)
values (
  'catalog',
  testutil.stage3_e2e_decompose_create_catalog_fixture('stage3-e2e-decompose')
);

insert into _ids (key, id)
select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;

insert into _ids (key, id)
select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('STAGE3_E2E_DECOMPOSE_BOOK', 'Stage3 E2E Decompose Book', 'decompose e2e fixture', 'all', true)
  on conflict (code) do update
  set active = true,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

insert into _ids (key, id)
select 'item_to_decompose',
       testutil.stage3_e2e_decompose_create_item(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'template'),
         (select id from _ids where key = 'form'),
         1,
         10
       );

insert into _ids (key, id)
select 'item_to_keep',
       testutil.stage3_e2e_decompose_create_item(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'template'),
         (select id from _ids where key = 'form'),
         1,
         10
       );

insert into _ids (key, payload)
select 'album_before', api.album_get_progress(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'book')
);

select is(testutil.stage3_e2e_decompose_balance_of((select id from _ids where key = 'user'), 'FGEMS'), 0::numeric, 'test user starts with zero FGEMS');
select is((select count(*)::integer from inventory.item_instances where owner_user_id = (select id from _ids where key = 'user') and template_id = (select id from _ids where key = 'template') and form_id = (select id from _ids where key = 'form') and status = 'available'), 2, 'user owns duplicate available collectibles before decomposition');
select is((select count(*)::integer from album.user_discoveries where user_id = (select id from _ids where key = 'user') and template_id = (select id from _ids where key = 'template')), 1, 'duplicate collectible is already discovered before decomposition');
select is(((select payload from _ids where key = 'album_before') -> 'book' ->> 'collected_count')::integer, 1, 'album progress is lit before decomposition');

insert into _ids (key, payload)
select 'decompose_result', api.inventory_decompose_items(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'item_to_decompose')]::uuid[],
  'stage3-e2e-decompose-success'
);

insert into _ids (key, payload)
select 'album_after', api.album_get_progress(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'book')
);

select ok(not ((select payload from _ids where key = 'decompose_result') ->> 'idempotent')::boolean, 'decomposition executes as a new write');
select is(((select payload from _ids where key = 'decompose_result') ->> 'total_reward_fgems')::numeric, 5::numeric, 'decomposition returns expected FGEMS reward');
select is(((select payload from _ids where key = 'decompose_result') ->> 'fgems_balance_before')::numeric, 0::numeric, 'decomposition returns FGEMS balance before credit');
select is(((select payload from _ids where key = 'decompose_result') ->> 'fgems_balance_after')::numeric, 5::numeric, 'decomposition returns FGEMS balance after credit');
select is(testutil.stage3_e2e_decompose_balance_of((select id from _ids where key = 'user'), 'FGEMS'), 5::numeric, 'database balance snapshot credits FGEMS');
select is((select status from inventory.item_instances where id = (select id from _ids where key = 'item_to_decompose')), 'decomposed', 'decomposed item status becomes decomposed');
select is((select owner_user_id from inventory.item_instances where id = (select id from _ids where key = 'item_to_decompose')), null, 'decomposed item owner is cleared');
select is((select count(*)::integer from inventory.item_instances where id = (select id from _ids where key = 'item_to_decompose') and status = 'available'), 0, 'decomposed item is no longer available');
select ok(exists (select 1 from inventory.item_instances where id = (select id from _ids where key = 'item_to_keep') and status = 'available' and owner_user_id = (select id from _ids where key = 'user')), 'the remaining duplicate stays available');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'stage3-e2e-decompose-success'), 1, 'decomposition writes one decompose log');
select is((
  select count(*)::integer
  from economy.currency_ledger ledger
  join inventory.decompose_logs logs on logs.ledger_id = ledger.id
  where logs.idempotency_key = 'stage3-e2e-decompose-success'
    and ledger.entry_type = 'credit'
    and ledger.currency_code = 'FGEMS'
    and ledger.amount = 5
    and ledger.available_before = 0
    and ledger.available_after = 5
), 1, 'decomposition writes exactly one FGEMS credit ledger with balance snapshots');
select is((select count(*)::integer from album.user_discoveries where user_id = (select id from _ids where key = 'user') and template_id = (select id from _ids where key = 'template')), 1, 'user_discoveries is not deleted after decomposition');
select is(((select payload from _ids where key = 'album_after') -> 'book' ->> 'collected_count')::integer, 1, 'album progress remains collected after decomposition');
select is(((select payload from _ids where key = 'album_after') -> 'book' ->> 'completion_percent')::numeric, 100.00::numeric, 'album completion stays lit after decomposition');

select * from finish();

rollback;
