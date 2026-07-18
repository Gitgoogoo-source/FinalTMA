create table wheel.daily (
  user_id uuid not null references identity.users(id) on delete cascade,
  business_date date not null,
  spin_count smallint not null default 0 check (spin_count between 0 and 20),
  normal_entitlements smallint not null default 0 check (normal_entitlements between 0 and 3),
  rare_entitlements smallint not null default 0 check (rare_entitlements between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

create table wheel.results (
  operation_id uuid not null,
  sequence smallint not null check (sequence between 1 and 10),
  rolled_kind text not null,
  delivered_kind text not null,
  amount bigint not null check (amount > 0),
  replaced boolean not null default false,
  primary key (operation_id, sequence)
);
