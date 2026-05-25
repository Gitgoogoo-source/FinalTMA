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

select plan(10);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;
create temp table _payloads (key text primary key, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(10300000001, 'album_backfill_user'));

with series_row as (
  insert into catalog.series (slug, display_name, status)
  values ('album-backfill-series', 'Album Backfill Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = 'active',
      updated_at = now()
  returning id
),
faction_row as (
  insert into catalog.factions (slug, display_name)
  values ('album-backfill-faction', 'Album Backfill Faction')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id
),
template_row as (
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
  )
  select
    'album-backfill-template',
    'Album Backfill Template',
    'fixture',
    'fixture collectible for album backfill',
    'COMMON',
    'CHARACTER',
    series_row.id,
    faction_row.id,
    10,
    10,
    'active',
    true,
    true,
    true,
    true,
    true,
    10
  from series_row, faction_row
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      updated_at = now()
  returning id
),
form_row as (
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
  )
  select
    template_row.id,
    1,
    'base',
    'Base Form',
    'Base form',
    'https://example.test/album-backfill/base.png',
    'https://example.test/album-backfill/base-thumb.png',
    'https://example.test/album-backfill/base-avatar.png',
    0,
    true
  from template_row
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id, template_id
),
item_row as (
  insert into inventory.item_instances (
    owner_user_id,
    template_id,
    form_id,
    level,
    power,
    status,
    source_type,
    metadata
  )
  select
    (select id from _ids where key = 'user'),
    form_row.template_id,
    form_row.id,
    1,
    10,
    'locked',
    'admin',
    jsonb_build_object('fixture', true)
  from form_row
  returning id
)
insert into _ids (key, id)
select 'template', template_id from form_row
union all
select 'item', id from item_row;

insert into _payloads (key, payload)
values (
  'dry_run',
  api.album_backfill_discoveries_from_inventory(
    true,
    'album_backfill_test',
    array['locked']::text[]
  )
);

select is(
  ((_payloads.payload ->> 'missing_discovery_count')::integer),
  1,
  'album backfill dry-run reports one missing discovery'
)
from _payloads
where key = 'dry_run';

select is(
  ((_payloads.payload ->> 'inserted_discovery_count')::integer),
  0,
  'album backfill dry-run does not insert discoveries'
)
from _payloads
where key = 'dry_run';

select ok(
  not exists (
    select 1
    from album.user_discoveries
    where user_id = (select id from _ids where key = 'user')
      and template_id = (select id from _ids where key = 'template')
  ),
  'album discovery is still absent after dry-run'
);

insert into _payloads (key, payload)
values (
  'apply',
  api.album_backfill_discoveries_from_inventory(
    false,
    'album_backfill_test',
    array['locked']::text[]
  )
);

select is(
  ((_payloads.payload ->> 'inserted_discovery_count')::integer),
  1,
  'album backfill inserts the missing discovery'
)
from _payloads
where key = 'apply';

select ok(
  exists (
    select 1
    from album.user_discoveries
    where user_id = (select id from _ids where key = 'user')
      and template_id = (select id from _ids where key = 'template')
      and first_item_instance_id = (select id from _ids where key = 'item')
      and metadata ->> 'source' = 'album_backfill_test'
  ),
  'album backfill writes discovery metadata and first item reference'
);

insert into _payloads (key, payload)
values (
  'repeat',
  api.album_backfill_discoveries_from_inventory(
    false,
    'album_backfill_test',
    array['locked']::text[]
  )
);

select is(
  ((_payloads.payload ->> 'inserted_discovery_count')::integer),
  0,
  'album backfill is idempotent on repeat runs'
)
from _payloads
where key = 'repeat';

with template_row as (
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
  )
  select
    'album-backfill-history-template',
    'Album Backfill History Template',
    'fixture',
    'fixture collectible for historical album backfill',
    'COMMON',
    'CHARACTER',
    s.id,
    f.id,
    10,
    10,
    'active',
    true,
    true,
    true,
    true,
    true,
    11
  from catalog.series s
  cross join catalog.factions f
  where s.slug = 'album-backfill-series'
    and f.slug = 'album-backfill-faction'
  on conflict (slug) do update
  set display_name = excluded.display_name,
      rarity_code = excluded.rarity_code,
      release_status = 'active',
      updated_at = now()
  returning id
),
form_row as (
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
  )
  select
    template_row.id,
    1,
    'base',
    'Base Form',
    'Base form',
    'https://example.test/album-backfill-history/base.png',
    'https://example.test/album-backfill-history/base-thumb.png',
    'https://example.test/album-backfill-history/base-avatar.png',
    0,
    true
  from template_row
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = true,
      updated_at = now()
  returning id, template_id
),
item_row as (
  insert into inventory.item_instances (
    owner_user_id,
    template_id,
    form_id,
    level,
    power,
    status,
    source_type,
    metadata
  )
  select
    null::uuid,
    form_row.template_id,
    form_row.id,
    1,
    10,
    'consumed',
    'evolution',
    jsonb_build_object('fixture', true, 'history_only', true)
  from form_row
  returning id, template_id
),
event_row as (
  insert into inventory.item_instance_events (
    item_instance_id,
    user_id,
    event_type,
    source_type,
    source_id,
    after_state,
    created_at
  )
  select
    item_row.id,
    (select id from _ids where key = 'user'),
    'consumed',
    'inventory_evolution',
    null::uuid,
    jsonb_build_object('status', 'consumed'),
    now() - interval '1 day'
  from item_row
  returning item_instance_id
)
insert into _ids (key, id)
select 'history_template', template_id from item_row
union all
select 'history_item', id from item_row;

insert into _payloads (key, payload)
values (
  'history_dry_run',
  api.album_backfill_discoveries_from_inventory(
    true,
    'album_backfill_test',
    array['locked']::text[]
  )
);

select is(
  ((_payloads.payload ->> 'missing_discovery_count')::integer),
  1,
  'album backfill dry-run includes historical ownership events'
)
from _payloads
where key = 'history_dry_run';

insert into _payloads (key, payload)
values (
  'history_apply',
  api.album_backfill_discoveries_from_inventory(
    false,
    'album_backfill_test',
    array['locked']::text[]
  )
);

select is(
  ((_payloads.payload ->> 'inserted_discovery_count')::integer),
  1,
  'album backfill inserts discovery from historical ownership events'
)
from _payloads
where key = 'history_apply';

select ok(
  exists (
    select 1
    from album.user_discoveries
    where user_id = (select id from _ids where key = 'user')
      and template_id = (select id from _ids where key = 'history_template')
      and first_item_instance_id = (select id from _ids where key = 'history_item')
      and first_source_type = 'inventory_evolution'
      and metadata ->> 'candidate_source' = 'inventory_event'
      and metadata ->> 'event_type' = 'consumed'
  ),
  'album backfill records historical event provenance'
);

select ok(
  testutil.raises_like(
    $$select api.album_backfill_discoveries_from_inventory(true, 'album_backfill_test', array['consumed']::text[])$$,
    '%unsupported album backfill status%'
  ),
  'album backfill rejects unsupported statuses'
);

select * from finish();

rollback;
