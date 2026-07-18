create table vip.subscriptions (
  user_id uuid primary key references identity.users(id) on delete cascade,
  period_id uuid not null default extensions.gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  renewal_count smallint not null default 0 check (renewal_count between 0 and 2),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table vip.claims (
  user_id uuid not null references identity.users(id) on delete cascade,
  benefit_date date not null,
  benefit text not null check (benefit in ('fgems', 'free_rare_box')),
  operation_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, benefit_date, benefit)
);
