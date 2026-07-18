create table economy.balances (
  user_id uuid not null references core.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  available bigint not null default 0 check (available >= 0),
  locked bigint not null default 0 check (locked >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, currency)
);

create table economy.ledger (
  id bigint generated always as identity primary key,
  operation_id uuid references core.operations(id),
  user_id uuid not null references core.users(id) on delete cascade,
  currency text not null check (currency in ('KCOIN', 'FGEMS')),
  amount bigint not null check (amount <> 0),
  reason text not null,
  reference text,
  balance_after bigint not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index ledger_user_created_idx on economy.ledger (user_id, created_at desc);
create index ledger_operation_idx on economy.ledger (operation_id) where operation_id is not null;

create table economy.entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  kind text not null check (kind in ('free_normal_box', 'free_rare_box')),
  source text not null,
  status text not null default 'unused' check (status in ('unused', 'used', 'void')),
  operation_id uuid references core.operations(id),
  obtained_at timestamptz not null default now(),
  used_at timestamptz
);

create index entitlements_fifo_idx on economy.entitlements (user_id, kind, obtained_at, id) where status = 'unused';

create table economy.payments (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  operation_id uuid not null unique references core.operations(id),
  kind text not null check (kind in ('kcoin_topup', 'vip')),
  stars_amount bigint not null check (stars_amount > 0),
  kcoin_amount bigint check (kcoin_amount is null or kcoin_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'delivered', 'expired', 'cancelled', 'delivery_blocked')),
  invoice_payload text not null unique,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  paid_at timestamptz,
  delivered_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  refund_status text not null default 'none' check (refund_status in ('none', 'partial', 'full')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_pending_idx on economy.payments (expires_at, created_at) where status in ('pending', 'paid');
create index payments_user_created_idx on economy.payments (user_id, created_at desc);
create unique index payments_user_kind_open_idx on economy.payments (user_id, kind) where status in ('pending', 'paid');

create table economy.vip_subscriptions (
  user_id uuid primary key references core.users(id) on delete cascade,
  period_id uuid not null default extensions.gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  renewal_count smallint not null default 0 check (renewal_count between 0 and 2),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table economy.vip_claims (
  user_id uuid not null references core.users(id) on delete cascade,
  benefit_date date not null,
  benefit text not null check (benefit in ('fgems', 'free_rare_box')),
  operation_id uuid not null references core.operations(id),
  claimed_at timestamptz not null default now(),
  primary key (user_id, benefit_date, benefit)
);
