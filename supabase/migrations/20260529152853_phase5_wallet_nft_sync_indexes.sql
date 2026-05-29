-- Phase 5 step 14 wallet NFT sync read-path indexes.
-- Additive only: keep the existing latest-snapshot uniqueness strategy and
-- make sync lookups, known collection matching, and owner-drift review cheap.

begin;

create index if not exists wallet_nft_snapshots_wallet_item_seen_idx
  on onchain.wallet_nft_snapshots (wallet_id, item_address, seen_at desc);

create index if not exists nft_items_collection_item_address_idx
  on onchain.nft_items (collection_id, item_address)
  where item_address is not null;

create index if not exists nft_items_owner_address_seen_idx
  on onchain.nft_items (owner_address, last_seen_at desc)
  where owner_address is not null;

create index if not exists risk_events_source_type_id_event_idx
  on ops.risk_events (source_type, source_id, event_type, created_at desc)
  where source_id is not null;

comment on index onchain.wallet_nft_snapshots_wallet_item_seen_idx
  is 'Phase 5 NFT sync lookup by wallet, chain item address and latest seen timestamp.';

comment on index onchain.nft_items_collection_item_address_idx
  is 'Phase 5 NFT sync matching path from known collection plus NFT item address to game NFT item.';

comment on index onchain.nft_items_owner_address_seen_idx
  is 'Phase 5 NFT sync review path for current on-chain owner address and last seen timestamp.';

comment on index ops.risk_events_source_type_id_event_idx
  is 'Phase 5 NFT sync owner-drift and retry diagnostics by source object and event type.';

commit;
