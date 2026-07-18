create table market.listings (
  id uuid primary key default extensions.gen_random_uuid(),
  seller_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  unit_price bigint not null check (unit_price > 0),
  quantity bigint not null check (quantity > 0),
  remaining bigint not null check (remaining >= 0 and remaining <= quantity),
  status text not null default 'active' check (status in ('active', 'sold', 'cancelled')),
  operation_id uuid not null references core.operations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_fifo_idx on market.listings (template_id, created_at, id) where status = 'active' and remaining > 0;
create index listings_seller_active_idx on market.listings (seller_id, template_id, created_at) where status = 'active';

create table market.trades (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references core.users(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  total_price bigint not null check (total_price > 0),
  operation_id uuid not null unique references core.operations(id),
  created_at timestamptz not null default now()
);

create index trades_buyer_created_idx on market.trades (buyer_id, created_at desc);
create index trades_template_created_idx on market.trades (template_id, created_at desc);

create table market.trade_details (
  id bigint generated always as identity primary key,
  trade_id uuid not null references market.trades(id) on delete cascade,
  listing_id uuid not null references market.listings(id),
  seller_id uuid not null references core.users(id),
  quantity bigint not null check (quantity > 0),
  gross bigint not null check (gross > 0),
  fee bigint not null check (fee >= 0),
  seller_net bigint not null check (seller_net >= 0),
  vip_rebate bigint not null default 0 check (vip_rebate >= 0)
);

create index trade_details_trade_idx on market.trade_details (trade_id);
create index trade_details_seller_idx on market.trade_details (seller_id, id desc);
