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
insert into _ids (key, id) values ('user', testutil.make_user(10200000001, 'album_user', null));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('album-reward', 'EPIC', true, true, true, true, true));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1', ((select payload from _ids where key = 'catalog') ->> 'form1_id')::uuid;
insert into _ids (key, payload) values ('item_reward_catalog', testutil.create_catalog_fixture('album-reward-item', 'RARE', true, true, true, true, true));
insert into _ids (key, id) select 'item_reward_template', ((select payload from _ids where key = 'item_reward_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'item_reward_form', ((select payload from _ids where key = 'item_reward_catalog') ->> 'form1_id')::uuid;
insert into _ids (key, payload) values ('decoration_reward_catalog', testutil.create_catalog_fixture('album-reward-decoration', 'COMMON', true, false, false, true, false));
insert into _ids (key, id) select 'decoration_reward_template', ((select payload from _ids where key = 'decoration_reward_catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'decoration_reward_form', ((select payload from _ids where key = 'decoration_reward_catalog') ->> 'form1_id')::uuid;

update catalog.collectible_templates
set type_code = 'DECORATION',
    updated_at = now()
where id = (select id from _ids where key = 'decoration_reward_template');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('ALBUM_TEST_BOOK', 'Album Test Book', 'pgTAP album book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

insert into _ids (key, id) select 'item', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 60, 'admin');
select ok(exists (select 1 from album.user_discoveries where user_id = (select id from _ids where key = 'user') and template_id = (select id from _ids where key = 'template')), 'inventory insert records album discovery through trigger');

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values ((select id from _ids where key = 'book'), 1, 'Collect 1', '[{"currency":"FGEMS","amount":33}]'::jsonb, true, 1)
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'milestone1', id from milestone_row;

select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, null, 0)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'milestone1')), '%idempotency key is required%'), 'album milestone claim requires idempotency key');

select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, %L, 9)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'milestone1'), 'album-reward-stale-version'), '%milestone version mismatch%'), 'album milestone claim rejects stale expected version');

insert into _ids (key, payload) select 'claim1', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'milestone1'), 'album-reward-claim-1', 0);
select is(((select payload from _ids where key = 'claim1') ->> 'collected_count')::int, 1, 'album claim counts discovered item');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 33::numeric, 'album milestone reward credits FGEMS');
select is((select count(*)::int from album.milestone_claims where user_id = (select id from _ids where key = 'user') and milestone_id = (select id from _ids where key = 'milestone1')), 1, 'one milestone claim row is created');

insert into _ids (key, payload) select 'claim_repeat', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'milestone1'), 'album-reward-claim-1', 0);
select ok(((select payload from _ids where key = 'claim_repeat') ->> 'idempotent')::boolean, 'repeated album milestone claim returns idempotent=true');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 33::numeric, 'repeated milestone claim does not credit again');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('ALBUM_TEST_STAR_BOOK', 'Album Star Reward Book', 'pgTAP album star reward book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'star_book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'star_book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values (
    (select id from _ids where key = 'star_book'),
    1,
    'Collect 1 for Stars',
    '[{"reward_type":"STAR_DISPLAY","amount":7}]'::jsonb,
    true,
    1
  )
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'star_milestone', id from milestone_row;

insert into _ids (key, payload) select 'star_claim', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'star_milestone'), 'album-reward-star-claim-1', 0);
select is(testutil.balance_of((select id from _ids where key = 'user'), 'STAR_DISPLAY'), 7::numeric, 'album milestone reward credits STAR_DISPLAY from reward_type');
select is(jsonb_array_length((select payload from _ids where key = 'star_claim') -> 'ledger_results'), 1, 'STAR_DISPLAY claim returns one ledger result');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('ALBUM_TEST_ITEM_BOOK', 'Album Item Reward Book', 'pgTAP album item reward book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'item_book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'item_book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values (
    (select id from _ids where key = 'item_book'),
    1,
    'Collect 1 for Items',
    jsonb_build_array(jsonb_build_object(
      'reward_type', 'ITEM',
      'template_id', (select id::text from _ids where key = 'item_reward_template'),
      'quantity', 2
    )),
    true,
    1
  )
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'item_milestone', id from milestone_row;

insert into _ids (key, payload) select 'item_claim', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'item_milestone'), 'album-reward-item-claim-1', 0);
select is((
  select count(*)::int
  from inventory.item_instances
  where owner_user_id = (select id from _ids where key = 'user')
    and template_id = (select id from _ids where key = 'item_reward_template')
    and source_type = 'album_milestone'
    and source_id = ((select payload from _ids where key = 'item_claim') ->> 'claim_id')::uuid
), 2, 'ITEM album reward grants two inventory instances');
select is((
  select count(*)::int
  from inventory.item_instance_events
  where user_id = (select id from _ids where key = 'user')
    and event_type = 'acquired'
    and source_type = 'album_milestone'
    and source_id = ((select payload from _ids where key = 'item_claim') ->> 'claim_id')::uuid
), 2, 'ITEM album reward writes acquired inventory events');
select ok(exists (
  select 1
  from album.user_discoveries
  where user_id = (select id from _ids where key = 'user')
    and template_id = (select id from _ids where key = 'item_reward_template')
), 'ITEM album reward records album discovery through inventory trigger');

insert into _ids (key, payload) select 'item_claim_repeat', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'item_milestone'), 'album-reward-item-claim-1', 0);
select is((
  select count(*)::int
  from inventory.item_instances
  where owner_user_id = (select id from _ids where key = 'user')
    and template_id = (select id from _ids where key = 'item_reward_template')
    and source_type = 'album_milestone'
), 2, 'repeated ITEM album claim does not create more inventory instances');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('ALBUM_TEST_DECORATION_BOOK', 'Album Decoration Reward Book', 'pgTAP album decoration reward book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'decoration_book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'decoration_book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values (
    (select id from _ids where key = 'decoration_book'),
    1,
    'Collect 1 for Decoration',
    jsonb_build_array(jsonb_build_object(
      'reward_type', 'DECORATION',
      'template_id', (select id::text from _ids where key = 'decoration_reward_template')
    )),
    true,
    1
  )
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'decoration_milestone', id from milestone_row;

insert into _ids (key, payload) select 'decoration_claim', api.album_claim_milestone((select id from _ids where key = 'user'), (select id from _ids where key = 'decoration_milestone'), 'album-reward-decoration-claim-1', 0);
select is((
  select count(*)::int
  from inventory.item_instances ii
  join catalog.collectible_templates ct on ct.id = ii.template_id
  where ii.owner_user_id = (select id from _ids where key = 'user')
    and ii.template_id = (select id from _ids where key = 'decoration_reward_template')
    and ii.source_type = 'album_milestone'
    and ii.source_id = ((select payload from _ids where key = 'decoration_claim') ->> 'claim_id')::uuid
    and ct.type_code = 'DECORATION'
), 1, 'DECORATION album reward grants a decoration inventory instance');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('ALBUM_TEST_BAD_DECORATION_BOOK', 'Album Bad Decoration Reward Book', 'pgTAP bad decoration reward book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'bad_decoration_book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'bad_decoration_book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values (
    (select id from _ids where key = 'bad_decoration_book'),
    1,
    'Collect 1 for Bad Decoration',
    jsonb_build_array(jsonb_build_object(
      'reward_type', 'DECORATION',
      'template_id', (select id::text from _ids where key = 'item_reward_template')
    )),
    true,
    1
  )
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'bad_decoration_milestone', id from milestone_row;

select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, %L, 0)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'bad_decoration_milestone'), 'album-reward-bad-decoration-claim-1'), '%invalid reward config%'), 'DECORATION reward rejects non-decoration templates');
select is((
  select count(*)::int
  from album.milestone_claims
  where user_id = (select id from _ids where key = 'user')
    and milestone_id = (select id from _ids where key = 'bad_decoration_milestone')
), 0, 'invalid decoration reward rolls back milestone claim row');

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values ((select id from _ids where key = 'book'), 2, 'Collect 2', '[{"currency":"KCOIN","amount":99}]'::jsonb, true, 2)
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'milestone2', id from milestone_row;
select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, %L, 0)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'milestone2'), 'album-reward-claim-2'), '%milestone not reached%'), 'cannot claim unreached album milestone');
select ok(testutil.raises_like(format('select api.album_claim_milestone(%L::uuid, %L::uuid, %L, 0)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'milestone2'), 'album-reward-claim-1'), '%idempotency conflict%'), 'idempotency key cannot be reused for another milestone claim');

select * from finish();

rollback;
