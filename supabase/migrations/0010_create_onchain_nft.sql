-- 0010_create_onchain_nft.sql
-- TON wallet sync, NFT collection/item mapping, mint queue and chain transactions.

create table if not exists onchain.nft_collections (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  chain text not null default 'TON' check (chain in ('TON')),
  network text not null default 'mainnet' check (network in ('mainnet', 'testnet')),
  collection_address text not null unique,
  owner_address text,
  contract_version text,
  standard text not null default 'TEP-62',
  metadata_url text,
  content_base_url text,
  royalty_config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('draft', 'active', 'paused', 'retired')),
  deployed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table onchain.nft_collections is 'TON NFT Collection contracts used to mint game collectibles as on-chain NFTs.';

create table if not exists onchain.nft_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references onchain.nft_collections(id) on delete cascade,
  item_instance_id uuid unique references inventory.item_instances(id) on delete set null,
  template_id uuid references catalog.collectible_templates(id) on delete set null,
  form_id uuid references catalog.collectible_forms(id) on delete set null,
  item_index bigint,
  item_address text unique,
  owner_address text,
  owner_user_id uuid references core.users(id) on delete set null,
  metadata_url text,
  status text not null default 'minted' check (status in ('queued', 'minting', 'minted', 'transferred', 'burned', 'failed')),
  minted_tx_hash text,
  minted_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onchain.mint_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  wallet_id uuid references core.user_wallets(id) on delete set null,
  collection_id uuid not null references onchain.nft_collections(id) on delete restrict,
  item_instance_id uuid not null references inventory.item_instances(id) on delete restrict,
  template_id uuid not null references catalog.collectible_templates(id) on delete restrict,
  form_id uuid references catalog.collectible_forms(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'processing', 'minted', 'failed', 'cancelled')),
  priority integer not null default 100,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz,
  nft_item_id uuid references onchain.nft_items(id) on delete set null,
  tx_hash text,
  error_message text,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table onchain.mint_queue is 'Server-side Mint queue. It locks a game item until success, cancellation or failure handling.';

create table if not exists onchain.transactions (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'TON' check (chain in ('TON')),
  network text not null default 'mainnet' check (network in ('mainnet', 'testnet')),
  tx_hash text unique,
  query_id text,
  user_id uuid references core.users(id) on delete set null,
  wallet_id uuid references core.user_wallets(id) on delete set null,
  related_type text,
  related_id uuid,
  direction text check (direction in ('inbound', 'outbound')),
  amount_nano numeric(38,0),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'failed', 'expired')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onchain.wallet_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  wallet_id uuid not null references core.user_wallets(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'success', 'failed')),
  sync_type text not null default 'nft' check (sync_type in ('nft', 'transactions', 'full')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onchain.wallet_nft_snapshots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references core.user_wallets(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  collection_address text,
  item_address text not null,
  owner_address text not null,
  metadata_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (wallet_id, item_address)
);
