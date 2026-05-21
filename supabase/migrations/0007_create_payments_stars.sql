-- 0007_create_payments_stars.sql
-- Telegram Stars payment orders, invoices, successful payments, refunds, disputes and raw webhook events.

create table if not exists payments.star_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  business_type text not null check (business_type in ('gacha_open', 'admin_test', 'other')),
  business_id uuid,
  status text not null default 'created' check (status in ('created', 'invoice_created', 'precheckout_ok', 'paid', 'fulfilled', 'cancelled', 'expired', 'failed', 'refunded')),
  xtr_amount integer not null check (xtr_amount > 0),
  telegram_invoice_payload text not null unique,
  title text not null,
  description text,
  idempotency_key text not null unique,
  expires_at timestamptz,
  precheckout_at timestamptz,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payments.star_orders is 'Application-side Telegram Stars orders. Digital goods are delivered only after successful_payment is verified.';

create table if not exists payments.star_invoices (
  id uuid primary key default gen_random_uuid(),
  star_order_id uuid not null references payments.star_orders(id) on delete cascade,
  invoice_link text,
  payload text not null,
  status text not null default 'created' check (status in ('created', 'sent', 'opened', 'paid', 'expired', 'failed')),
  raw_request jsonb not null default '{}'::jsonb,
  raw_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments.star_payments (
  id uuid primary key default gen_random_uuid(),
  star_order_id uuid not null references payments.star_orders(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  telegram_payment_charge_id text not null unique,
  provider_payment_charge_id text,
  xtr_amount integer not null check (xtr_amount > 0),
  currency text not null default 'XTR',
  invoice_payload text not null,
  raw_update jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table payments.star_payments is 'Successful Telegram Stars payments. telegram_payment_charge_id uniqueness prevents duplicate fulfillment.';

create table if not exists payments.telegram_webhook_events (
  id uuid primary key default gen_random_uuid(),
  update_id bigint unique,
  event_type text not null,
  user_id uuid references core.users(id) on delete set null,
  telegram_user_id bigint,
  invoice_payload text,
  payload jsonb not null,
  process_status text not null default 'received' check (process_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table payments.telegram_webhook_events is 'Raw Telegram webhook events for audit, replay protection and debugging.';

create table if not exists payments.star_refunds (
  id uuid primary key default gen_random_uuid(),
  star_payment_id uuid not null references payments.star_payments(id) on delete cascade,
  star_order_id uuid not null references payments.star_orders(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  telegram_payment_charge_id text not null,
  xtr_amount integer not null check (xtr_amount > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'processed', 'failed')),
  reason text,
  requested_by_admin_id uuid,
  processed_at timestamptz,
  raw_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  star_order_id uuid references payments.star_orders(id) on delete set null,
  star_payment_id uuid references payments.star_payments(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'rejected')),
  subject text not null,
  message text,
  resolution text,
  resolved_by_admin_id uuid,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
