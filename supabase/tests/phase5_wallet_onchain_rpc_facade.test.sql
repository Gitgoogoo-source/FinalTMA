-- Phase 5 wallet/onchain RPC facade checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;

set search_path = public, extensions, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

select plan(16);

create temp table _ids (
  key text primary key,
  id uuid,
  payload jsonb
) on commit drop;

insert into core.users (id, telegram_user_id, username, invite_code)
values
  ('10000000-0000-4000-8000-000000000601', 9500000601, 'phase5_wallet_facade', 'P5WAL0601'),
  ('10000000-0000-4000-8000-000000000602', 9500000602, 'phase5_wallet_facade_other', 'P5WAL0602');

insert into catalog.series (id, slug, display_name, status)
values ('20000000-0000-4000-8000-000000000601', 'phase5-wallet-facade-series', 'Phase 5 Wallet Facade Series', 'active');

insert into catalog.factions (id, slug, display_name)
values ('20000000-0000-4000-8000-000000000602', 'phase5-wallet-facade-faction', 'Phase 5 Wallet Facade Faction');

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  subtitle,
  description,
  rarity_code,
  type_code,
  series_id,
  faction_id,
  release_status,
  nft_mintable
) values (
  '30000000-0000-4000-8000-000000000601',
  'phase5-wallet-facade-template',
  'Phase 5 Wallet Facade Item',
  'Fixture',
  'Wallet facade fixture',
  'RARE',
  'CHARACTER',
  '20000000-0000-4000-8000-000000000601',
  '20000000-0000-4000-8000-000000000602',
  'active',
  true
);

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  image_url,
  thumbnail_url,
  avatar_url,
  is_default
) values (
  '30000000-0000-4000-8000-000000000602',
  '30000000-0000-4000-8000-000000000601',
  1,
  'base',
  'Base',
  'https://example.test/phase5-wallet/base.png',
  'https://example.test/phase5-wallet/base-thumb.png',
  'https://example.test/phase5-wallet/base-avatar.png',
  true
);

insert into catalog.collectible_media (template_id, form_id, media_type, url, mime_type, sort_order)
values
  (
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000602',
    'nft_image',
    'https://example.test/phase5-wallet/nft.png',
    'image/png',
    10
  ),
  (
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000602',
    'metadata',
    'https://example.test/phase5-wallet/metadata.json',
    'application/json',
    20
  );

insert into onchain.nft_collections (
  id,
  code,
  chain,
  network,
  collection_address,
  owner_address,
  standard,
  metadata_url,
  content_base_url,
  status
) values (
  '40000000-0000-4000-8000-000000000601',
  'PHASE5_WALLET_FACADE',
  'TON',
  'mainnet',
  'EQ_PHASE5_WALLET_FACADE_COLLECTION',
  'EQ_PHASE5_WALLET_FACADE_OWNER',
  'TEP-62',
  'https://example.test/phase5-wallet/collection.json',
  'https://example.test/phase5-wallet/items',
  'active'
);

insert into core.user_wallets (
  id,
  user_id,
  chain,
  network,
  address,
  address_raw,
  is_primary,
  status,
  verified_at
) values (
  '50000000-0000-4000-8000-000000000601',
  '10000000-0000-4000-8000-000000000601',
  'TON',
  'mainnet',
  'EQ_PHASE5_WALLET_FACADE_WALLET',
  '0:phase5walletfacade',
  true,
  'connected',
  now()
);

insert into inventory.item_instances (
  id,
  owner_user_id,
  template_id,
  form_id,
  level,
  power,
  status,
  source_type
) values
  (
    '60000000-0000-4000-8000-000000000601',
    '10000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000602',
    3,
    160,
    'available',
    'admin'
  ),
  (
    '60000000-0000-4000-8000-000000000602',
    '10000000-0000-4000-8000-000000000602',
    '30000000-0000-4000-8000-000000000601',
    '30000000-0000-4000-8000-000000000602',
    1,
    100,
    'available',
    'admin'
  );

select ok(
  to_regprocedure('api.wallet_prepare_mint_request(uuid,uuid,text,text)') is not null
    and to_regprocedure('api.wallet_save_mint_metadata_snapshot(uuid,uuid,integer,jsonb)') is not null
    and to_regprocedure('api.wallet_get_mint_status(uuid,uuid,uuid,text[],integer,integer)') is not null
    and to_regprocedure('api.wallet_list_nft_snapshots(uuid,text,text,text,boolean,integer,integer)') is not null,
  'wallet/onchain facade functions exist'
);

select ok(
  has_function_privilege('service_role', 'api.wallet_prepare_mint_request(uuid,uuid,text,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'api.wallet_save_mint_metadata_snapshot(uuid,uuid,integer,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'api.wallet_get_mint_status(uuid,uuid,uuid,text[],integer,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'api.wallet_list_nft_snapshots(uuid,text,text,text,boolean,integer,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'api.wallet_prepare_mint_request(uuid,uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'api.wallet_prepare_mint_request(uuid,uuid,text,text)', 'EXECUTE'),
  'wallet/onchain facade functions are service_role only'
);

insert into _ids (key, payload)
values (
  'prepare',
  api.wallet_prepare_mint_request(
    '10000000-0000-4000-8000-000000000601',
    '60000000-0000-4000-8000-000000000601',
    null,
    'mainnet'
  )
);

select is(
  (select payload #>> '{wallet,id}' from _ids where key = 'prepare'),
  '50000000-0000-4000-8000-000000000601',
  'prepare returns the verified wallet'
);

select is(
  (select payload #>> '{collections,0,id}' from _ids where key = 'prepare'),
  '40000000-0000-4000-8000-000000000601',
  'prepare returns active collections for the wallet network'
);

select is(
  (select payload #>> '{item,id}' from _ids where key = 'prepare'),
  '60000000-0000-4000-8000-000000000601',
  'prepare returns only the current user item'
);

select is(
  (select payload #>> '{template,id}' from _ids where key = 'prepare'),
  '30000000-0000-4000-8000-000000000601',
  'prepare returns the item template'
);

select is(
  (select jsonb_array_length(payload -> 'media') from _ids where key = 'prepare'),
  2,
  'prepare returns template media rows'
);

select is(
  api.wallet_prepare_mint_request(
    '10000000-0000-4000-8000-000000000601',
    '60000000-0000-4000-8000-000000000602',
    null,
    'mainnet'
  ) -> 'item',
  'null'::jsonb,
  'prepare does not expose another user item'
);

insert into _ids (key, payload)
values (
  'queue',
  api.wallet_enqueue_mint(
    '10000000-0000-4000-8000-000000000601',
    '60000000-0000-4000-8000-000000000601',
    '40000000-0000-4000-8000-000000000601',
    '50000000-0000-4000-8000-000000000601',
    'phase5-wallet-facade-mint'
  )
);

insert into _ids (key, payload)
values (
  'save_snapshot',
  api.wallet_save_mint_metadata_snapshot(
    '10000000-0000-4000-8000-000000000601',
    ((select payload from _ids where key = 'queue') ->> 'mint_queue_id')::uuid,
    50,
    '{"metadata_url":"https://example.test/phase5-wallet/metadata.json","source":"test"}'::jsonb
  )
);

select is(
  (select payload ->> 'priority' from _ids where key = 'save_snapshot'),
  '50',
  'save metadata snapshot returns the updated priority'
);

select is(
  (
    select priority
    from onchain.mint_queue
    where id = ((select payload from _ids where key = 'queue') ->> 'mint_queue_id')::uuid
  ),
  50,
  'save metadata snapshot writes the private mint queue row'
);

select is(
  (
    select metadata ->> 'metadata_url'
    from onchain.mint_queue
    where id = ((select payload from _ids where key = 'queue') ->> 'mint_queue_id')::uuid
  ),
  'https://example.test/phase5-wallet/metadata.json',
  'save metadata snapshot writes server metadata'
);

insert into onchain.transactions (
  chain,
  network,
  tx_hash,
  user_id,
  wallet_id,
  related_type,
  related_id,
  status
) values (
  'TON',
  'mainnet',
  'phase5_wallet_facade_tx',
  '10000000-0000-4000-8000-000000000601',
  '50000000-0000-4000-8000-000000000601',
  'mint_queue',
  ((select payload from _ids where key = 'queue') ->> 'mint_queue_id')::uuid,
  'pending'
);

insert into _ids (key, payload)
values (
  'mint_status',
  api.wallet_get_mint_status(
    '10000000-0000-4000-8000-000000000601',
    null,
    null,
    array['queued'],
    0,
    20
  )
);

select is(
  (select jsonb_array_length(payload -> 'items') from _ids where key = 'mint_status'),
  1,
  'mint status returns the current user queue row'
);

select is(
  (select payload #>> '{items,0,mintQueueId}' from _ids where key = 'mint_status'),
  (select payload ->> 'mint_queue_id' from _ids where key = 'queue'),
  'mint status exposes the queue id'
);

select is(
  (select payload #>> '{summary,queued}' from _ids where key = 'mint_status'),
  '1',
  'mint status summarizes the page'
);

insert into onchain.nft_items (
  id,
  collection_id,
  item_instance_id,
  template_id,
  form_id,
  item_index,
  item_address,
  owner_address,
  owner_user_id,
  metadata_url,
  status
) values (
  '70000000-0000-4000-8000-000000000601',
  '40000000-0000-4000-8000-000000000601',
  null,
  '30000000-0000-4000-8000-000000000601',
  '30000000-0000-4000-8000-000000000602',
  7,
  'EQ_PHASE5_WALLET_FACADE_NFT_ITEM',
  'EQ_PHASE5_WALLET_FACADE_WALLET',
  '10000000-0000-4000-8000-000000000601',
  'https://example.test/phase5-wallet/nft/7.json',
  'minted'
);

insert into onchain.wallet_nft_snapshots (
  wallet_id,
  user_id,
  collection_address,
  item_address,
  owner_address,
  metadata_url,
  raw_payload
) values (
  '50000000-0000-4000-8000-000000000601',
  '10000000-0000-4000-8000-000000000601',
  'EQ_PHASE5_WALLET_FACADE_COLLECTION',
  'EQ_PHASE5_WALLET_FACADE_NFT_ITEM',
  'EQ_PHASE5_WALLET_FACADE_WALLET',
  'https://example.test/phase5-wallet/nft/7.json',
  '{"name":"Known NFT","image_url":"https://example.test/phase5-wallet/nft/7.png"}'::jsonb
);

insert into _ids (key, payload)
values (
  'nfts',
  api.wallet_list_nft_snapshots(
    '10000000-0000-4000-8000-000000000601',
    null,
    null,
    null,
    false,
    0,
    20
  )
);

select is(
  (select jsonb_array_length(payload -> 'items') from _ids where key = 'nfts'),
  1,
  'wallet NFT facade returns the current user snapshot'
);

select is(
  (select payload #>> '{items,0,nftItemId}' from _ids where key = 'nfts'),
  '70000000-0000-4000-8000-000000000601',
  'wallet NFT facade links known onchain NFT items'
);

select * from finish();

rollback;
