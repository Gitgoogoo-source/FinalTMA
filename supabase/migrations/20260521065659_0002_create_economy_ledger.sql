-- 0002_create_economy_ledger.sql
-- Economy layer: K-coin, Fgems, Stars display currency, balances, locks, ledger, reward and fee rules.

create table if not exists economy.currencies (
  code text primary key,
  display_name text not null,
  symbol text,
  decimals integer not null default 0 check (decimals >= 0),
  currency_type text not null default 'internal' check (currency_type in ('internal', 'external', 'display')),
  is_spendable boolean not null default true,
  is_transferable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table economy.currencies is 'Currency catalog. KCOIN and FGEMS are internal; XTR/Stars are external payment units.';

insert into economy.currencies (code, display_name, symbol, currency_type, is_spendable, is_transferable)
values
  ('KCOIN', 'K-coin', '★', 'internal', true, false),
  ('FGEMS', 'Fgems', '◆', 'internal', true, false),
  ('XTR', 'Telegram Stars', '⭐', 'external', false, false),
  ('STAR_DISPLAY', 'Stars Display', '⭐', 'display', false, false)
on conflict (code) do nothing;

create table if not exists economy.user_balances (
  user_id uuid not null references core.users(id) on delete cascade,
  currency_code text not null references economy.currencies(code),
  available_amount numeric(38,0) not null default 0 check (available_amount >= 0),
  locked_amount numeric(38,0) not null default 0 check (locked_amount >= 0),
  total_earned numeric(38,0) not null default 0 check (total_earned >= 0),
  total_spent numeric(38,0) not null default 0 check (total_spent >= 0),
  total_locked numeric(38,0) not null default 0 check (total_locked >= 0),
  total_unlocked numeric(38,0) not null default 0 check (total_unlocked >= 0),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, currency_code)
);

comment on table economy.user_balances is 'Fast balance snapshot. The immutable source of truth remains economy.currency_ledger.';

create table if not exists economy.currency_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references core.users(id) on delete set null,
  currency_code text not null references economy.currencies(code),
  entry_type text not null check (entry_type in ('credit', 'debit', 'lock', 'unlock', 'fee', 'refund', 'adjustment', 'reversal')),
  amount numeric(38,0) not null check (amount > 0),
  available_before numeric(38,0) check (available_before >= 0),
  available_after numeric(38,0) check (available_after >= 0),
  locked_before numeric(38,0) check (locked_before >= 0),
  locked_after numeric(38,0) check (locked_after >= 0),
  source_type text not null,
  source_id uuid,
  source_ref text,
  idempotency_key text unique,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table economy.currency_ledger is 'Immutable asset ledger. Never update or delete rows; use reversal entries for corrections.';
comment on column economy.currency_ledger.available_before is 'Available balance immediately before this ledger entry.';
comment on column economy.currency_ledger.available_after is 'Available balance immediately after this ledger entry.';
comment on column economy.currency_ledger.locked_before is 'Locked balance immediately before this ledger entry.';
comment on column economy.currency_ledger.locked_after is 'Locked balance immediately after this ledger entry.';
comment on column economy.currency_ledger.idempotency_key is 'Prevents duplicate balance mutations from repeated requests or webhooks.';

create table if not exists economy.balance_locks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  currency_code text not null references economy.currencies(code),
  amount numeric(38,0) not null check (amount > 0),
  lock_type text not null check (lock_type in ('market_buy', 'admin_hold', 'event_hold', 'refund_hold')),
  source_type text not null,
  source_id uuid,
  status text not null default 'active' check (status in ('active', 'released', 'consumed', 'expired')),
  expires_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table economy.balance_locks is 'Locked virtual currency amounts. Used for future escrow-like flows.';

create table if not exists economy.reward_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  reward_type text not null check (reward_type in ('open_box', 'task', 'signin', 'referral', 'album', 'decompose', 'admin')),
  currency_code text not null references economy.currencies(code),
  amount numeric(38,0) not null check (amount >= 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into economy.reward_rules (code, reward_type, currency_code, amount, metadata)
values
  ('OPEN_BOX_RETURN_KCOIN', 'open_box', 'KCOIN', 100, '{"description":"Return 100 K-coin per paid draw."}'::jsonb),
  ('REFERRAL_FIRST_OPEN_INVITER', 'referral', 'KCOIN', 500, '{"description":"Inviter reward after invitee first paid box open."}'::jsonb),
  ('REFERRAL_FIRST_OPEN_INVITEE', 'referral', 'KCOIN', 500, '{"description":"Invitee reward after first paid box open."}'::jsonb)
on conflict (code) do nothing;

create table if not exists economy.fee_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  fee_type text not null check (fee_type in ('market_sell', 'withdrawal', 'mint', 'admin')),
  currency_code text not null references economy.currencies(code),
  fee_bps integer not null default 0 check (fee_bps >= 0 and fee_bps <= 10000),
  min_fee numeric(38,0) not null default 0 check (min_fee >= 0),
  max_fee numeric(38,0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into economy.fee_rules (code, fee_type, currency_code, fee_bps, metadata)
values ('MARKET_SELL_FEE', 'market_sell', 'KCOIN', 500, '{"description":"Default 5% platform fee for marketplace sales."}'::jsonb)
on conflict (code) do nothing;

create table if not exists economy.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('ledger_balance', 'market_settlement', 'payment', 'inventory')),
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  created_by text
);

comment on table economy.reconciliation_runs is 'Operational records for scheduled reconciliation jobs.';
