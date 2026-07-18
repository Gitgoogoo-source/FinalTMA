create table referral.relationships (
  invitee_id uuid primary key references identity.users(id) on delete cascade,
  inviter_id uuid not null references identity.users(id) on delete cascade,
  bound_at timestamptz not null default now(),
  first_recharge_at timestamptz,
  reward_fgems bigint not null default 0 check (reward_fgems in (0, 500)),
  reward_operation_id uuid,
  unique (inviter_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create index referrals_inviter_bound_idx on referral.relationships (inviter_id, bound_at);
create index referrals_inviter_recharge_idx on referral.relationships (inviter_id, first_recharge_at) where first_recharge_at is not null;

create table referral.milestones (
  user_id uuid not null references identity.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null,
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);
