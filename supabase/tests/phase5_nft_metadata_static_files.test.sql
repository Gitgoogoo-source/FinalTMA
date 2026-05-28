-- Phase 5 step 11 static NFT metadata preparation checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(6);

select ok(
  exists (
    select 1
    from catalog.collectible_templates
    where release_status = 'active'
      and nft_mintable = true
  ),
  'active mintable collectible templates exist'
);

with mintable_default_forms as (
  select t.id as template_id, f.id as form_id
  from catalog.collectible_templates t
  join lateral (
    select cf.*
    from catalog.collectible_forms cf
    where cf.template_id = t.id
    order by cf.is_default desc, cf.form_index asc, cf.created_at asc
    limit 1
  ) f on true
  where t.release_status = 'active'
    and t.nft_mintable = true
)
select is(
  (
    select count(*)::integer
    from mintable_default_forms f
    where not exists (
      select 1
      from catalog.collectible_media m
      where m.template_id = f.template_id
        and m.form_id = f.form_id
        and m.media_type = 'metadata'
        and m.url like '/nft-metadata/items/%.json'
        and m.mime_type = 'application/json'
    )
  ),
  0,
  'each active mintable default form has static item metadata media'
);

with mintable_default_forms as (
  select t.id as template_id, f.id as form_id
  from catalog.collectible_templates t
  join lateral (
    select cf.*
    from catalog.collectible_forms cf
    where cf.template_id = t.id
    order by cf.is_default desc, cf.form_index asc, cf.created_at asc
    limit 1
  ) f on true
  where t.release_status = 'active'
    and t.nft_mintable = true
)
select is(
  (
    select count(*)::integer
    from mintable_default_forms f
    where not exists (
      select 1
      from catalog.collectible_media m
      where m.template_id = f.template_id
        and m.form_id = f.form_id
        and m.media_type = 'nft_image'
        and nullif(m.url, '') is not null
    )
  ),
  0,
  'each active mintable default form has an NFT image media row'
);

select is(
  (
    select count(*)::integer
    from catalog.collectible_templates t
    where t.release_status = 'active'
      and t.nft_mintable = true
      and (
        t.metadata ->> 'nft_metadata_strategy' is distinct from 'static_public_vite'
        or t.metadata ->> 'nft_metadata_path' is distinct from '/nft-metadata/items/' || t.slug || '.json'
      )
  ),
  0,
  'active mintable templates record their static metadata strategy'
);

create temp table _phase5_step11_collection (id uuid) on commit drop;

with collection_row as (
  insert into onchain.nft_collections (
    code,
    chain,
    network,
    collection_address,
    owner_address,
    contract_version,
    standard,
    metadata_url,
    content_base_url,
    status,
    royalty_config,
    metadata
  )
  values (
    'PHASE5_STEP11_TEST_COLLECTION',
    'TON',
    'testnet',
    'EQ_PHASE5_STEP11_TEST_COLLECTION',
    'EQ_PHASE5_STEP11_TEST_OWNER',
    'test',
    'TEP-62',
    '/nft-metadata/collection.json',
    '/nft-metadata/items',
    'active',
    jsonb_build_object('basis_points', 0),
    jsonb_build_object('test', true)
  )
  returning id
)
insert into _phase5_step11_collection (id)
select id from collection_row;

select ok(
  exists (
    select 1
    from onchain.nft_collections c
    join _phase5_step11_collection fixture on fixture.id = c.id
    where c.status = 'active'
      and c.network = 'testnet'
      and c.metadata_url = '/nft-metadata/collection.json'
      and c.content_base_url = '/nft-metadata/items'
  ),
  'active NFT collection configuration can be queried with static metadata paths'
);

select ok(
  not exists (
    select 1
    from onchain.nft_collections
    where status = 'active'
      and (metadata_url is null or content_base_url is null)
  ),
  'active NFT collections must expose collection and item metadata URLs'
);

select * from finish();

rollback;
