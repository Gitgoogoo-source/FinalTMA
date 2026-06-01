-- Focused regression coverage for inventory detail Mint queue status mapping.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.inventory_mint_status_make_user(
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
    p_first_name := 'Mint',
    p_last_name := 'Status',
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := null,
    p_start_param := null,
    p_metadata := '{"test":true,"suite":"inventory_mint_status"}'::jsonb
  );

  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select no_plan();

create temp table _ids (key text primary key, id uuid) on commit drop;

insert into _ids (key, id)
values ('user', testutil.inventory_mint_status_make_user(12600000001, 'inventory_mint_status_user'));

with series_row as (
  insert into catalog.series (slug, display_name, status)
  values ('inventory-mint-status-series', 'Inventory Mint Status Series', 'active')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      status = excluded.status,
      updated_at = now()
  returning id
),
faction_row as (
  insert into catalog.factions (slug, display_name)
  values ('inventory-mint-status-faction', 'Inventory Mint Status Faction')
  on conflict (slug) do update
  set display_name = excluded.display_name,
      updated_at = now()
  returning id
),
template_row as (
  insert into catalog.collectible_templates (
    slug, display_name, subtitle, description, rarity_code, type_code,
    series_id, faction_id, base_power, max_level, release_status,
    tradeable, upgradeable, evolvable, decomposable, nft_mintable, sort_order
  )
  select
    'inventory-mint-status-template',
    'Inventory Mint Status Item',
    'mint status fixture',
    'mint status detail fixture',
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
      release_status = excluded.release_status,
      updated_at = now()
  returning id
),
form_row as (
  insert into catalog.collectible_forms (
    template_id, form_index, form_slug, display_name, description,
    image_url, thumbnail_url, avatar_url, base_power_bonus, is_default
  )
  select
    template_row.id,
    1,
    'base',
    'Base Form',
    'Base form',
    'https://example.test/inventory-mint-status/base.png',
    'https://example.test/inventory-mint-status/base-thumb.png',
    'https://example.test/inventory-mint-status/base-avatar.png',
    0,
    true
  from template_row
  on conflict (template_id, form_index) do update
  set display_name = excluded.display_name,
      is_default = excluded.is_default,
      updated_at = now()
  returning id, template_id
)
insert into _ids (key, id)
select 'template', template_id from form_row
union all
select 'form', id from form_row;

with item_row as (
  insert into inventory.item_instances (
    owner_user_id, template_id, form_id, level, power,
    status, source_type, nft_mint_status, metadata
  )
  values (
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'template'),
    (select id from _ids where key = 'form'),
    1,
    10,
    'minting',
    'admin',
    'queued',
    '{"fixture":"inventory_mint_status"}'::jsonb
  )
  returning id
)
insert into _ids (key, id) select 'item', id from item_row;

with collection_row as (
  insert into onchain.nft_collections (
    code, chain, network, collection_address, owner_address,
    contract_version, standard, metadata_url, status, deployed_at
  )
  values (
    'INVENTORY_MINT_STATUS_TEST',
    'TON',
    'mainnet',
    'EQ_INVENTORY_MINT_STATUS_COLLECTION',
    'EQ_INVENTORY_MINT_STATUS_OWNER',
    'test-v1',
    'TEP-62',
    'https://example.test/inventory-mint-status-collection.json',
    'active',
    now()
  )
  on conflict (code) do update
  set status = excluded.status,
      collection_address = excluded.collection_address,
      updated_at = now()
  returning id
)
insert into _ids (key, id) select 'collection', id from collection_row;

with queue_row as (
  insert into onchain.mint_queue (
    user_id, collection_id, item_instance_id, template_id, form_id,
    status, idempotency_key, metadata
  )
  values (
    (select id from _ids where key = 'user'),
    (select id from _ids where key = 'collection'),
    (select id from _ids where key = 'item'),
    (select id from _ids where key = 'template'),
    (select id from _ids where key = 'form'),
    'submitted',
    'inventory-mint-status-detail-001',
    '{"fixture":"inventory_mint_status"}'::jsonb
  )
  returning id
)
insert into _ids (key, id) select 'queue', id from queue_row;

create temp table _mint_status_results (
  status text primary key,
  detail_status text
) on commit drop;

do $$
declare
  v_status text;
  v_detail jsonb;
begin
  foreach v_status in array array['submitted', 'confirming', 'retrying', 'manual_review', 'cancelled']::text[] loop
    update onchain.mint_queue
    set status = v_status,
        updated_at = now()
    where id = (select id from _ids where key = 'queue');

    v_detail := api.inventory_get_item_detail(
      (select id from _ids where key = 'user'),
      (select id from _ids where key = 'item'),
      false,
      false,
      false,
      false,
      true
    );

    insert into _mint_status_results (status, detail_status)
    values (v_status, v_detail -> 'onchain_status' ->> 'mint_status');
  end loop;
end;
$$;

select is(
  (select jsonb_object_agg(status, detail_status order by status) from _mint_status_results),
  '{
    "cancelled": "cancelled",
    "confirming": "confirming",
    "manual_review": "manual_review",
    "retrying": "retrying",
    "submitted": "submitted"
  }'::jsonb,
  'inventory detail preserves every extended Mint queue status'
);

select * from finish();

rollback;
