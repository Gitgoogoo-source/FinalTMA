-- Stage 3 E2E acceptance: recommended flow 5, album reward only.
-- This test intentionally stops at the album reward path and verifies the
-- database artifacts required by "第十七步：端到端验收流程".

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.stage3_e2e_album_reward_make_user(
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
    p_last_name := 'AlbumReward',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := null,
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true, 'suite', 'stage3_e2e_album_reward')
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

create or replace function testutil.stage3_e2e_album_reward_balance_of(
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

create or replace function testutil.stage3_e2e_album_reward_create_catalog_fixture(
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
  values (p_prefix || '-series', 'Stage3 E2E Album Reward Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id into v_series_id;

  insert into catalog.factions (slug, display_name)
  values (p_prefix || '-faction', 'Stage3 E2E Album Reward Faction')
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
    'Stage3 E2E Album Reward Item',
    'album reward fixture',
    'stage3 album reward e2e fixture',
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
      release_status = 'active',
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
    'https://example.test/stage3-e2e-album-reward/base.png',
    'https://example.test/stage3-e2e-album-reward/base-thumb.png',
    'https://example.test/stage3-e2e-album-reward/base-avatar.png',
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

create or replace function testutil.stage3_e2e_album_reward_create_item(
  p_user_id uuid,
  p_template_id uuid,
  p_form_id uuid
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
    1,
    10,
    'available',
    'admin',
    jsonb_build_object('fixture', true, 'suite', 'stage3_e2e_album_reward')
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
    jsonb_build_object('level', 1, 'power', 10)
  );

  return v_item_id;
end;
$$;

select plan(18);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values (
  'user',
  testutil.stage3_e2e_album_reward_make_user(17000000007, 'stage3_e2e_album_reward_user')
);

insert into _ids (key, payload)
values (
  'catalog',
  testutil.stage3_e2e_album_reward_create_catalog_fixture('stage3-e2e-album-reward')
);

insert into _ids (key, id)
select 'template', ((select payload from _ids where key = 'catalog') ->> 'template_id')::uuid;

insert into _ids (key, id)
select 'form', ((select payload from _ids where key = 'catalog') ->> 'form_id')::uuid;

with book_row as (
  insert into album.books (
    code,
    display_name,
    description,
    book_type,
    active,
    sort_order,
    metadata
  ) values (
    'STAGE3_E2E_ALBUM_REWARD_BOOK',
    'Stage3 E2E Album Reward Book',
    'stage3 album reward e2e fixture',
    'all',
    true,
    10,
    jsonb_build_object('suite', 'stage3_e2e_album_reward')
  )
  on conflict (code) do update
  set display_name = excluded.display_name,
      active = true,
      metadata = album.books.metadata || excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'book', id from book_row;

insert into album.book_items (book_id, template_id, sort_order)
values (
  (select id from _ids where key = 'book'),
  (select id from _ids where key = 'template'),
  1
)
on conflict (book_id, template_id) do nothing;

insert into _ids (key, id)
select 'item',
       testutil.stage3_e2e_album_reward_create_item(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'template'),
         (select id from _ids where key = 'form')
       );

select ok(
  exists (
    select 1
    from album.user_discoveries
    where user_id = (select id from _ids where key = 'user')
      and template_id = (select id from _ids where key = 'template')
  ),
  'album reward flow starts with enough discovered progress'
);

with milestone_row as (
  insert into album.milestones (
    book_id,
    required_count,
    title,
    reward,
    active,
    sort_order,
    metadata
  ) values (
    (select id from _ids where key = 'book'),
    1,
    'Stage3 E2E Album Reward Milestone',
    '[{"currency":"FGEMS","amount":100}]'::jsonb,
    true,
    1,
    jsonb_build_object('suite', 'stage3_e2e_album_reward', 'version', 0)
  )
  on conflict (book_id, required_count) do update
  set title = excluded.title,
      reward = excluded.reward,
      active = true,
      metadata = album.milestones.metadata || excluded.metadata,
      updated_at = now()
  returning id
)
insert into _ids (key, id)
select 'milestone', id from milestone_row;

insert into _ids (key, payload)
select 'progress_before',
       api.album_get_progress(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'book'),
         null,
         null,
         null,
         null,
         true,
         true,
         true,
         true
       );

select is(
  ((select payload from _ids where key = 'progress_before') #>> '{book,collected_count}')::integer,
  1,
  'album page progress shows the user has enough collected count'
);

select is(
  (
    select milestone ->> 'status'
    from jsonb_array_elements((select payload from _ids where key = 'progress_before') -> 'milestones') as milestone
    where milestone ->> 'milestone_id' = (select id::text from _ids where key = 'milestone')
  ),
  'claimable',
  'album page can find a claimable milestone'
);

select is(
  (
    select (milestone #>> '{rewards,0,amount}')::integer
    from jsonb_array_elements((select payload from _ids where key = 'progress_before') -> 'milestones') as milestone
    where milestone ->> 'milestone_id' = (select id::text from _ids where key = 'milestone')
  ),
  100,
  'claimable milestone exposes the reward amount for the reward modal'
);

insert into _ids (key, payload)
select 'claim',
       api.album_claim_milestone(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'milestone'),
         'stage3-e2e-album-reward-claim-1',
         0
       );

select is((select payload ->> 'status' from _ids where key = 'claim'), 'claimed', 'clicking claim returns claimed status');
select is(((select payload ->> 'idempotent' from _ids where key = 'claim')::boolean), false, 'first claim is not an idempotent replay');
select is(((select payload #>> '{rewards,0,amount}' from _ids where key = 'claim')::integer), 100, 'claim response returns the reward for the success modal');
select is((select payload #>> '{ledger_results,0,currency_code}' from _ids where key = 'claim'), 'FGEMS', 'claim response returns the credited currency');
select is(testutil.stage3_e2e_album_reward_balance_of((select id from _ids where key = 'user'), 'FGEMS'), 100::numeric, 'asset balance refresh sees the FGEMS reward');
select is((select count(*)::integer from album.milestone_claims where user_id = (select id from _ids where key = 'user') and milestone_id = (select id from _ids where key = 'milestone')), 1, 'milestone claim row is created');
select is((select count(*)::integer from economy.currency_ledger where user_id = (select id from _ids where key = 'user') and source_type = 'album_milestone'), 1, 'album reward writes exactly one ledger credit');

insert into _ids (key, payload)
select 'progress_after',
       api.album_get_progress(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'book'),
         null,
         null,
         null,
         null,
         true,
         true,
         true,
         true
       );

select is(
  (
    select milestone ->> 'status'
    from jsonb_array_elements((select payload from _ids where key = 'progress_after') -> 'milestones') as milestone
    where milestone ->> 'milestone_id' = (select id::text from _ids where key = 'milestone')
  ),
  'claimed',
  'milestone status becomes claimed after reward claim'
);

select isnt(
  (
    select milestone ->> 'claimed_at'
    from jsonb_array_elements((select payload from _ids where key = 'progress_after') -> 'milestones') as milestone
    where milestone ->> 'milestone_id' = (select id::text from _ids where key = 'milestone')
  ),
  null,
  'claimed milestone exposes claimed_at for the UI state'
);

insert into _ids (key, payload)
select 'claim_repeat_same_key',
       api.album_claim_milestone(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'milestone'),
         'stage3-e2e-album-reward-claim-1',
         0
       );

select is(((select payload ->> 'idempotent' from _ids where key = 'claim_repeat_same_key')::boolean), true, 'repeating the same claim request returns an idempotent result');
select is(testutil.stage3_e2e_album_reward_balance_of((select id from _ids where key = 'user'), 'FGEMS'), 100::numeric, 'same-key repeat does not credit FGEMS again');

insert into _ids (key, payload)
select 'claim_repeat_new_key',
       api.album_claim_milestone(
         (select id from _ids where key = 'user'),
         (select id from _ids where key = 'milestone'),
         'stage3-e2e-album-reward-claim-2',
         0
       );

select is(((select payload ->> 'idempotent' from _ids where key = 'claim_repeat_new_key')::boolean), true, 'clicking an already claimed milestone with a new key still returns an idempotent result');
select is((select count(*)::integer from economy.currency_ledger where user_id = (select id from _ids where key = 'user') and source_type = 'album_milestone'), 1, 'repeat claim does not create another reward ledger entry');
select is((select count(*)::integer from album.milestone_claims where user_id = (select id from _ids where key = 'user') and milestone_id = (select id from _ids where key = 'milestone')), 1, 'repeat claim does not create another milestone claim row');

select * from finish();

rollback;
