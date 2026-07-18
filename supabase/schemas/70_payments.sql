create table payments.orders (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references identity.users(id) on delete cascade,
  operation_id uuid not null unique,
  kind text not null check (kind in ('kcoin_topup', 'vip')),
  stars_amount bigint not null check (stars_amount > 0),
  kcoin_amount bigint not null default 0 check (kcoin_amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'delivered', 'expired', 'refunded', 'rejected')),
  invoice_payload text not null unique,
  invoice_url text,
  telegram_payment_charge_id text unique,
  provider_payment_charge_id text,
  intent jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  paid_at timestamptz,
  delivered_at timestamptz,
  refunded_stars bigint not null default 0 check (refunded_stars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_orders_pending_idx on payments.orders (expires_at, created_at) where status in ('pending', 'paid');
create index payment_orders_user_created_idx on payments.orders (user_id, created_at desc);
create unique index payment_orders_user_kind_open_idx on payments.orders (user_id, kind) where status in ('pending', 'paid');

create or replace function payments.order_json(p_order payments.orders)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'kind', p_order.kind,
    'status', p_order.status,
    'stars_amount', p_order.stars_amount,
    'kcoin_amount', p_order.kcoin_amount,
    'invoice_url', p_order.invoice_url,
    'expires_at', p_order.expires_at,
    'paid_at', p_order.paid_at,
    'delivered_at', p_order.delivered_at
  )
$$;
