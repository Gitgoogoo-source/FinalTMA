create table risk.refunds (
  id uuid primary key default extensions.gen_random_uuid(),
  payment_id uuid not null references payments.orders(id),
  provider_event_id text not null unique,
  stars bigint not null check (stars > 0),
  created_at timestamptz not null default now()
);

create index refunds_payment_idx on risk.refunds (payment_id);
