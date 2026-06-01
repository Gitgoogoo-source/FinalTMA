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
  p_rarity_code text default 'COMMON'
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
    10, 10, 'active', true, true, true, true, true, 10
  )
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      tradeable = true,
      upgradeable = true,
      evolvable = true,
      decomposable = true,
      nft_mintable = true,
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
    'form2_id', v_form2_id
  );
end;
$$;

create or replace function testutil.create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid,
  p_level integer default 1,
  p_power integer default 10
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
    p_user_id, p_template_id, p_form_id, p_level, p_power, 'available', 'admin',
    jsonb_build_object('fixture', true)
  ) returning id into v_item_id;

  insert into inventory.item_instance_events (item_instance_id, user_id, event_type, source_type, source_id, after_state)
  values (v_item_id, p_user_id, 'created', 'admin', null, jsonb_build_object('fixture', true));

  return v_item_id;
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id) values ('user', testutil.make_user(12000000001, 'growth_rpc_user'));
insert into _ids (key, payload) values ('catalog', testutil.create_catalog_fixture('growth-rpc', 'COMMON'));
insert into _ids (key, id) select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1', ((select payload from _ids where key = 'catalog') ->> 'form1_id')::uuid;
insert into _ids (key, id) select 'form2', ((select payload from _ids where key = 'catalog') ->> 'form2_id')::uuid;

do $$
begin
  perform api._credit_balance((select id from _ids where key = 'user'), 'KCOIN', 1000, 'test_setup', null, null, 'growth-rpc-kcoin-001', 'fixture', '{}'::jsonb);
  perform api._credit_balance((select id from _ids where key = 'user'), 'FGEMS', 100, 'test_setup', null, null, 'growth-rpc-fgems-001', 'fixture', '{}'::jsonb);
end;
$$;

insert into inventory.evolution_rules (
  from_template_id, from_form_id, to_template_id, to_form_id,
  required_count, cost_kcoin, success_rate_bps, active
)
values (
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form1'),
  (select id from _ids where key = 'template'),
  (select id from _ids where key = 'form2'),
  3,
  120,
  10000,
  true
);

insert into _ids (key, id) select 'item1', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 10);
insert into _ids (key, id) select 'item2', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 2, 20);
insert into _ids (key, id) select 'item3', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 3, 30);
insert into _ids (key, id) select 'item4', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 11);
insert into _ids (key, id) select 'item5', testutil.create_item((select id from _ids where key = 'user'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 12);

insert into _ids (key, id) values ('user2', testutil.make_user(12000000002, 'growth_rpc_user_2'));
insert into _ids (key, payload) values ('catalog2', testutil.create_catalog_fixture('growth-rpc-2', 'RARE'));
insert into _ids (key, id) select 'template2', ((select payload from _ids where key = 'catalog2') ->> 'template_id')::uuid;
insert into _ids (key, id) select 'form1_2', ((select payload from _ids where key = 'catalog2') ->> 'form1_id')::uuid;

do $$
begin
  perform testutil.create_item((select id from _ids where key = 'user2'), (select id from _ids where key = 'template'), (select id from _ids where key = 'form1'), 1, 10);
  perform testutil.create_item((select id from _ids where key = 'user2'), (select id from _ids where key = 'template2'), (select id from _ids where key = 'form1_2'), 1, 10);
end;
$$;

insert into _ids (key, payload)
select 'detail', api.inventory_get_item_detail((select id from _ids where key = 'user'), (select id from _ids where key = 'item1'));

select ok(((select payload from _ids where key = 'detail') -> 'upgrade_preview' ->> 'can_upgrade')::boolean, 'item detail includes upgrade preview');
select ok(((select payload from _ids where key = 'detail') -> 'evolution_preview' ->> 'can_evolve')::boolean, 'item detail includes evolution preview');
select ok(((select payload from _ids where key = 'detail') -> 'decompose_preview' ->> 'can_decompose')::boolean, 'item detail includes decompose preview');

update inventory.item_instances
set nft_mint_status = 'minting'
where id = (select id from _ids where key = 'item4');

insert into _ids (key, payload)
select 'minting_evolution_preview', api.inventory_get_evolution_preview(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2'), (select id from _ids where key = 'item4')],
  null
);

select is(((select payload from _ids where key = 'minting_evolution_preview') ->> 'reason'), 'ITEM_MINTING', 'evolution preview rejects minting materials');

insert into _ids (key, payload)
select 'minting_decompose_preview', api.inventory_get_decompose_preview(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'item4')]
);

select is(((select payload from _ids where key = 'minting_decompose_preview') ->> 'reason'), 'ITEM_MINTING', 'decompose preview rejects minting item');
select ok(testutil.raises_like(format('select api.inventory_decompose_items(%L::uuid, array[%L::uuid], %L::text)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item4'), 'growth-rpc-decompose-minting-001'), '%item is minting%'), 'batch decomposition rejects minting item');

update inventory.item_instances
set nft_mint_status = 'not_minted'
where id = (select id from _ids where key = 'item4');

select ok(testutil.raises_like(format(
  'select api.inventory_decompose_items(%L::uuid, array[%L::uuid, %L::uuid], %L::text, 999::numeric)',
  (select id::text from _ids where key = 'user'),
  (select id::text from _ids where key = 'item1'),
  (select id::text from _ids where key = 'item2'),
  'growth-rpc-decompose-stale-preview-001'
), '%decompose preview mismatch%'), 'batch decomposition rejects stale expected FGEMS reward');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'growth-rpc-decompose-stale-preview-001'), 0, 'stale decompose preview writes no log');

insert into _ids (key, payload)
select 'batch_decompose', api.inventory_decompose_items(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')],
  'growth-rpc-decompose-batch-001'::text
);

select is(((select payload from _ids where key = 'batch_decompose') ->> 'total_reward_fgems')::numeric, 10::numeric, 'batch decomposition sums per-item FGEMS rewards');
select is(((select payload from _ids where key = 'batch_decompose') ->> 'fgems_balance_before')::numeric, 100::numeric, 'batch decomposition returns FGEMS balance before credit');
select is(((select payload from _ids where key = 'batch_decompose') ->> 'fgems_balance_after')::numeric, 110::numeric, 'batch decomposition returns FGEMS balance after credit');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 110::numeric, 'batch decomposition credits FGEMS once');
select is((select count(*)::integer from inventory.decompose_logs where idempotency_key = 'growth-rpc-decompose-batch-001'), 2, 'batch decomposition writes one log per item with shared idempotency key');

insert into _ids (key, payload)
select 'batch_decompose_repeat', api.inventory_decompose_items(
  (select id from _ids where key = 'user'),
  array[(select id from _ids where key = 'item1'), (select id from _ids where key = 'item2')],
  'growth-rpc-decompose-batch-001'::text
);

select ok(((select payload from _ids where key = 'batch_decompose_repeat') ->> 'idempotent')::boolean, 'batch decomposition repeat is idempotent');
select is(((select payload from _ids where key = 'batch_decompose_repeat') ->> 'fgems_balance_after')::numeric, 110::numeric, 'batch decomposition repeat returns original FGEMS balance after credit');
select is(testutil.balance_of((select id from _ids where key = 'user'), 'FGEMS'), 110::numeric, 'batch decomposition repeat does not credit again');
select ok(testutil.raises_like(format('select api.inventory_decompose_items(%L::uuid, array[%L::uuid], %L::text)', (select id::text from _ids where key = 'user'), (select id::text from _ids where key = 'item3'), 'growth-rpc-decompose-batch-001'), '%idempotency conflict%'), 'batch decomposition idempotency key rejects different inputs');

insert into _ids (key, payload)
select 'single_decompose', api.inventory_decompose_item(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'item3'),
  'growth-rpc-decompose-single-001'
);

select is(((select payload from _ids where key = 'single_decompose') ->> 'reward_fgems')::numeric, 5::numeric, 'single decomposition delegates to idempotent batch logic');
select is(((select payload from _ids where key = 'single_decompose') ->> 'fgems_balance_before')::numeric, 110::numeric, 'single decomposition returns FGEMS balance before credit');
select is(((select payload from _ids where key = 'single_decompose') ->> 'fgems_balance_after')::numeric, 115::numeric, 'single decomposition returns FGEMS balance after credit');

with book_row as (
  insert into album.books (code, display_name, description, book_type, active)
  values ('GROWTH_RPC_BOOK', 'Growth RPC Book', 'pgTAP growth RPC book', 'all', true)
  on conflict (code) do update set active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values ((select id from _ids where key = 'book'), (select id from _ids where key = 'template'), 1)
on conflict (book_id, template_id) do nothing;

with milestone_row as (
  insert into album.milestones (book_id, required_count, title, reward, active, sort_order)
  values ((select id from _ids where key = 'book'), 1, 'Collect 1', '[{"currency":"FGEMS","amount":10}]'::jsonb, true, 1)
  on conflict (book_id, required_count) do update set reward = excluded.reward, active = true, updated_at = now()
  returning id
)
insert into _ids (key, id) select 'milestone', id from milestone_row;

insert into _ids (key, payload)
select 'album_progress', api.album_get_progress((select id from _ids where key = 'user'), (select id from _ids where key = 'book'));

select is(((select payload from _ids where key = 'album_progress') -> 'book' ->> 'collected_count')::integer, 1, 'album progress remains based on user_discoveries after decomposition');
select is(((select payload from _ids where key = 'album_progress') -> 'milestones' -> 0 ->> 'status'), 'claimable', 'album progress marks reached milestone claimable');

insert into _ids (key, payload)
select 'album_books', api.album_list_books((select id from _ids where key = 'user'), 'all', null, null, null, 20, 0);

select ok(jsonb_array_length((select payload from _ids where key = 'album_books') -> 'books') >= 1, 'album_list_books returns active books with progress');

select ok((select count(*)::integer from album.score_rules where active = true) > 0, 'leaderboard score rules are seeded');

insert into _ids (key, payload)
select 'leaderboard_refresh', api.album_refresh_weekly_leaderboard();

select ok((select count(*)::integer from album.weekly_leaderboards where status = 'active' and now() >= starts_at and now() < ends_at) >= 1, 'current weekly leaderboard is available after refresh');
select ok(((select payload from _ids where key = 'leaderboard_refresh') ->> 'entry_count')::integer >= 1, 'leaderboard refresh writes entries');
select is((
  select count(*)::integer
  from (
    select rank
    from album.leaderboard_entries
    where leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
      and rank is not null
    group by rank
    having count(*) > 1
  ) duplicated_ranks
), 0, 'leaderboard ranks are unique');
select ok((
  select user2_entry.score > user1_entry.score
  from album.leaderboard_entries user1_entry
  join album.leaderboard_entries user2_entry
    on user2_entry.leaderboard_id = user1_entry.leaderboard_id
  where user1_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
    and user1_entry.user_id = (select id from _ids where key = 'user')
    and user2_entry.user_id = (select id from _ids where key = 'user2')
), 'user with more discoveries gets higher score');
select ok((
  select user2_entry.rank < user1_entry.rank
  from album.leaderboard_entries user1_entry
  join album.leaderboard_entries user2_entry
    on user2_entry.leaderboard_id = user1_entry.leaderboard_id
  where user1_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
    and user1_entry.user_id = (select id from _ids where key = 'user')
    and user2_entry.user_id = (select id from _ids where key = 'user2')
), 'higher score ranks ahead');

insert into _ids (key, payload)
select
  'leaderboard_user_before_new_discovery',
  jsonb_build_object(
    'score', user_entry.score,
    'collected_count', user_entry.collected_count
  )
from album.leaderboard_entries user_entry
where user_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid
  and user_entry.user_id = (select id from _ids where key = 'user');

insert into _ids (key, id)
select 'leaderboard_new_discovery_item', testutil.create_item(
  (select id from _ids where key = 'user'),
  (select id from _ids where key = 'template2'),
  (select id from _ids where key = 'form1_2'),
  1,
  10
);

select ok(exists (
  select 1
  from album.user_discoveries discovery
  where discovery.user_id = (select id from _ids where key = 'user')
    and discovery.template_id = (select id from _ids where key = 'template2')
), 'newly collected item records a new album discovery');

insert into _ids (key, payload)
select 'leaderboard_refresh_after_new_discovery', api.album_refresh_weekly_leaderboard();

select is(
  ((select payload from _ids where key = 'leaderboard_refresh_after_new_discovery') ->> 'board_id')::uuid,
  ((select payload from _ids where key = 'leaderboard_refresh') ->> 'board_id')::uuid,
  'leaderboard refresh after new discovery updates the same weekly board'
);

insert into _ids (key, payload)
select
  'leaderboard_user_after_new_discovery',
  jsonb_build_object(
    'score', user_entry.score,
    'collected_count', user_entry.collected_count
  )
from album.leaderboard_entries user_entry
where user_entry.leaderboard_id = ((select payload from _ids where key = 'leaderboard_refresh_after_new_discovery') ->> 'board_id')::uuid
  and user_entry.user_id = (select id from _ids where key = 'user');

select ok((
  ((select payload from _ids where key = 'leaderboard_user_after_new_discovery') ->> 'score')::numeric
  > ((select payload from _ids where key = 'leaderboard_user_before_new_discovery') ->> 'score')::numeric
), 'same user score increases after new discovery and leaderboard refresh');
select is(
  ((select payload from _ids where key = 'leaderboard_user_after_new_discovery') ->> 'collected_count')::integer,
  ((select payload from _ids where key = 'leaderboard_user_before_new_discovery') ->> 'collected_count')::integer + 1,
  'same user collected count increases after new discovery and leaderboard refresh'
);

insert into _ids (key, payload)
select 'leaderboard', api.album_get_leaderboard((select id from _ids where key = 'user'), null, 'current_week', 'global', null, null, null, 'score_desc', false, 50, 0);

select ok(jsonb_array_length((select payload from _ids where key = 'leaderboard') -> 'entries') >= 1, 'leaderboard query returns generated entries');
select is(((select payload from _ids where key = 'leaderboard') -> 'my_entry' ->> 'user_id')::uuid, (select id from _ids where key = 'user'), 'leaderboard query returns my entry');

select ok(not has_function_privilege('anon', 'api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean)', 'execute'), 'anon cannot execute inventory_get_item_detail directly');
select ok(not has_function_privilege('anon', 'api.album_claim_milestone(uuid, uuid, text, integer)', 'execute'), 'anon cannot execute album_claim_milestone directly');
select ok(not has_function_privilege('authenticated', 'api.inventory_decompose_item(uuid, uuid, text)', 'execute'), 'authenticated cannot execute inventory_decompose_item directly');
select ok(not has_function_privilege('authenticated', 'api.inventory_decompose_items(uuid, uuid[], text)', 'execute'), 'authenticated cannot execute inventory_decompose_items directly');
select ok(not has_function_privilege('authenticated', 'api.inventory_decompose_items(uuid, uuid[], text, numeric)', 'execute'), 'authenticated cannot execute guarded inventory_decompose_items directly');
select ok(has_function_privilege('service_role', 'api.inventory_get_item_detail(uuid, uuid, boolean, boolean, boolean, boolean, boolean)', 'execute'), 'service_role can execute inventory_get_item_detail');
select ok(has_function_privilege('service_role', 'api.inventory_decompose_items(uuid, uuid[], text, numeric)', 'execute'), 'service_role can execute guarded inventory_decompose_items');
select ok(has_function_privilege('service_role', 'api.album_claim_milestone(uuid, uuid, text, integer)', 'execute'), 'service_role can execute album_claim_milestone');
select ok(has_function_privilege('service_role', 'api.album_refresh_weekly_leaderboard(timestamp with time zone)', 'execute'), 'service_role can execute album_refresh_weekly_leaderboard');

select * from finish();

rollback;
