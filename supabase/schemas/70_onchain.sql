create table onchain.wallet_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  challenge text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index wallet_challenges_user_active_idx on onchain.wallet_challenges (user_id, expires_at desc) where consumed_at is null;

create table onchain.wallets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  address text not null unique,
  network text not null check (network in ('mainnet', 'testnet')),
  wallet_app_name text,
  public_key text not null,
  status text not null default 'verified' check (status in ('verified', 'disconnected', 'revoked')),
  verified_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index wallets_user_verified_idx on onchain.wallets (user_id) where status = 'verified';

create table onchain.mints (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  wallet_id uuid not null references onchain.wallets(id),
  template_id text not null references catalog.templates(id),
  operation_id uuid not null unique references core.operations(id),
  nft_number bigint generated always as identity (start with 0 minvalue 0) unique,
  nonce uuid not null default extensions.gen_random_uuid() unique,
  status text not null default 'reserved' check (status in ('reserved', 'submitted', 'succeeded', 'failed', 'cancelled', 'unknown')),
  permit_expires_at timestamptz not null,
  transaction_hash text unique,
  nft_address text unique,
  metadata_uri text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mints_pending_idx on onchain.mints (status, created_at) where status in ('reserved', 'submitted', 'unknown');
create index mints_user_created_idx on onchain.mints (user_id, created_at desc);

create table onchain.nft_metadata (
  nft_number bigint primary key,
  mint_id uuid not null unique references onchain.mints(id),
  snapshot jsonb not null,
  checksum text not null,
  created_at timestamptz not null default now()
);
