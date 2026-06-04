begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

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
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.create_summary_catalog_fixture(
  p_prefix text
)
returns jsonb
language plpgsql
as $$
declare
  v_series_id uuid;
  v_template_a_id uuid;
  v_template_b_id uuid;
  v_form_a_id uuid;
  v_form_b_id uuid;
begin
  insert into catalog.series (slug, display_name, status)
  values (p_prefix || '-series', 'Summary Test Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template-a', 'Summary Test A', 'fixture', 'summary fixture a',
    'COMMON', 'CHARACTER', v_series_id, 10, 100, 'active',
    true, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      release_status = 'active',
      updated_at = now()
  returning id into v_template_a_id;

  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  ) values (
    p_prefix || '-template-b', 'Summary Test B', 'fixture', 'summary fixture b',
    'RARE', 'CHARACTER', v_series_id, 20, 100, 'active',
    true, true, true, true, true, 20
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      release_status = 'active',
      updated_at = now()
  returning id into v_template_b_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_a_id, 1, 'base', 'Summary Base A', 'Base form A',
    'https://example.test/summary/a.png',
    'https://example.test/summary/a-thumb.png',
    'https://example.test/summary/a-avatar.png',
    0, true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_a_id;

  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  ) values (
    v_template_b_id, 1, 'base', 'Summary Base B', 'Base form B',
    'https://example.test/summary/b.png',
    'https://example.test/summary/b-thumb.png',
    'https://example.test/summary/b-avatar.png',
    0, true
  )
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id into v_form_b_id;

  return jsonb_build_object(
    'template_a_id', v_template_a_id,
    'template_b_id', v_template_b_id,
    'form_a_id', v_form_a_id,
    'form_b_id', v_form_b_id
  );
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(13000000001, 'inventory_summary_user'));
insert into _ids (key, payload)
values ('catalog', testutil.create_summary_catalog_fixture('inventory-summary'));
insert into _ids (key, id)
select 'template_a', ((select payload from _ids where key = 'catalog') ->> 'template_a_id')::uuid;
insert into _ids (key, id)
select 'template_b', ((select payload from _ids where key = 'catalog') ->> 'template_b_id')::uuid;
insert into _ids (key, id)
select 'form_a', ((select payload from _ids where key = 'catalog') ->> 'form_a_id')::uuid;
insert into _ids (key, id)
select 'form_b', ((select payload from _ids where key = 'catalog') ->> 'form_b_id')::uuid;

insert into inventory.item_instances (
  owner_user_id, template_id, form_id, level, power, status, source_type, metadata
) values
  ((select id from _ids where key = 'user'), (select id from _ids where key = 'template_a'), (select id from _ids where key = 'form_a'), 1, 10, 'available', 'admin', '{"fixture":true}'::jsonb),
  ((select id from _ids where key = 'user'), (select id from _ids where key = 'template_a'), (select id from _ids where key = 'form_a'), 3, 30, 'listed', 'admin', '{"fixture":true}'::jsonb),
  ((select id from _ids where key = 'user'), (select id from _ids where key = 'template_a'), (select id from _ids where key = 'form_a'), 2, 20, 'locked', 'admin', '{"fixture":true}'::jsonb),
  ((select id from _ids where key = 'user'), (select id from _ids where key = 'template_b'), (select id from _ids where key = 'form_b'), 5, 80, 'available', 'admin', '{"fixture":true}'::jsonb);

insert into _ids (key, payload)
select 'summary', api.inventory_get_collection_summary(
  (select id from _ids where key = 'user'),
  array['available', 'listed', 'locked']::text[]
);

select is(((select payload from _ids where key = 'summary') ->> 'total')::integer, 4, 'collection summary returns total owned instance count');
select is(((select payload from _ids where key = 'summary') ->> 'group_total')::integer, 2, 'collection summary groups by template and form');
select is(jsonb_array_length((select payload from _ids where key = 'summary') -> 'groups'), 2, 'collection summary returns two groups');

select is((
  select (group_row.value ->> 'owned_count')::integer
  from jsonb_array_elements((select payload from _ids where key = 'summary') -> 'groups') as group_row(value)
  where (group_row.value ->> 'template_id')::uuid = (select id from _ids where key = 'template_a')
), 3, 'summary group exposes exact owned count');

select is((
  select (group_row.value ->> 'available_count')::integer
  from jsonb_array_elements((select payload from _ids where key = 'summary') -> 'groups') as group_row(value)
  where (group_row.value ->> 'template_id')::uuid = (select id from _ids where key = 'template_a')
), 1, 'summary group exposes exact available count');

select is((
  select group_row.value #>> '{representative_item,status}'
  from jsonb_array_elements((select payload from _ids where key = 'summary') -> 'groups') as group_row(value)
  where (group_row.value ->> 'template_id')::uuid = (select id from _ids where key = 'template_a')
), 'available', 'summary representative prefers an available item for actions');

insert into _ids (key, payload)
select 'group_items', api.inventory_list_collection_group_items(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'template_a'),
  (select id from _ids where key = 'form_a'),
  array['available', 'listed', 'locked']::text[],
  100,
  0
);

select is(((select payload from _ids where key = 'group_items') ->> 'total')::integer, 3, 'group items returns the exact concrete item count');
select is(jsonb_array_length((select payload from _ids where key = 'group_items') -> 'items'), 3, 'group items returns concrete item rows');

select is((
  select array_agg((item_row.value ->> 'level')::integer order by item_row.ordinality)
  from jsonb_array_elements((select payload from _ids where key = 'group_items') -> 'items') with ordinality as item_row(value, ordinality)
), array[3, 2, 1], 'group items are sorted by level from high to low');

select ok(
  not exists (
    select 1
    from jsonb_array_elements((select payload from _ids where key = 'group_items') -> 'items') as item_row(value)
    where (item_row.value ->> 'template_id')::uuid <> (select id from _ids where key = 'template_a')
  ),
  'group items hides other collectible groups'
);

select ok(
  not has_function_privilege('anon', 'api.inventory_get_collection_summary(uuid,text[])', 'execute'),
  'collection summary RPC is not executable by anon'
);
select ok(
  not has_function_privilege('authenticated', 'api.inventory_get_collection_summary(uuid,text[])', 'execute'),
  'collection summary RPC is not executable by authenticated'
);
select ok(
  has_function_privilege('service_role', 'api.inventory_get_collection_summary(uuid,text[])', 'execute'),
  'collection summary RPC is executable by service_role'
);
select ok(
  not has_function_privilege('anon', 'api.inventory_list_collection_group_items(uuid,uuid,uuid,text[],integer,integer)', 'execute'),
  'collection group items RPC is not executable by anon'
);
select ok(
  not has_function_privilege('authenticated', 'api.inventory_list_collection_group_items(uuid,uuid,uuid,text[],integer,integer)', 'execute'),
  'collection group items RPC is not executable by authenticated'
);
select ok(
  has_function_privilege('service_role', 'api.inventory_list_collection_group_items(uuid,uuid,uuid,text[],integer,integer)', 'execute'),
  'collection group items RPC is executable by service_role'
);

select * from finish();

rollback;
