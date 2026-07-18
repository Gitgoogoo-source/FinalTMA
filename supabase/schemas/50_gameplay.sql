create table gameplay.gacha_pity (
  user_id uuid not null references core.users(id) on delete cascade,
  tier text not null references catalog.boxes(tier),
  progress smallint not null default 0 check (progress >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, tier)
);

create table gameplay.evolution_pity (
  user_id uuid not null references core.users(id) on delete cascade,
  from_template_id text not null references catalog.templates(id),
  failures smallint not null default 0 check (failures >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, from_template_id)
);

create table gameplay.expeditions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  operation_id uuid not null unique references core.operations(id),
  tier text not null check (tier in ('normal', 'intermediate', 'advanced')),
  status text not null default 'running' check (status in ('running', 'claimable', 'claimed')),
  reward_fgems bigint not null check (reward_fgems > 0),
  started_at timestamptz not null default now(),
  completes_at timestamptz not null,
  claimed_at timestamptz,
  check (completes_at > started_at)
);

create unique index expeditions_user_tier_active_idx on gameplay.expeditions (user_id, tier) where status in ('running', 'claimable');
create index expeditions_due_idx on gameplay.expeditions (completes_at) where status = 'running';

create table gameplay.expedition_items (
  expedition_id uuid not null references gameplay.expeditions(id) on delete cascade,
  template_id text not null references catalog.templates(id),
  quantity bigint not null check (quantity > 0),
  primary key (expedition_id, template_id)
);

create index expedition_items_template_idx on gameplay.expedition_items (template_id, expedition_id);

create table gameplay.wheel_daily (
  user_id uuid not null references core.users(id) on delete cascade,
  business_date date not null,
  spin_count smallint not null default 0 check (spin_count between 0 and 20),
  normal_entitlements smallint not null default 0 check (normal_entitlements between 0 and 3),
  rare_entitlements smallint not null default 0 check (rare_entitlements between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date)
);

create table gameplay.wheel_results (
  operation_id uuid not null references core.operations(id) on delete cascade,
  sequence smallint not null check (sequence between 1 and 10),
  rolled_kind text not null,
  delivered_kind text not null,
  amount bigint not null check (amount > 0),
  replaced boolean not null default false,
  primary key (operation_id, sequence)
);

create table gameplay.task_definitions (
  code text primary key,
  sort_order smallint not null unique,
  category text not null,
  display_name text not null,
  target bigint not null check (target > 0),
  reward_fgems bigint not null check (reward_fgems > 0)
);

create table gameplay.daily_task_progress (
  user_id uuid not null references core.users(id) on delete cascade,
  business_date date not null,
  task_code text not null references gameplay.task_definitions(code),
  progress bigint not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  claim_operation_id uuid references core.operations(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date, task_code)
);

create index daily_task_progress_claimable_idx on gameplay.daily_task_progress (user_id, business_date) where claimed_at is null;

create table gameplay.checkins (
  user_id uuid primary key references core.users(id) on delete cascade,
  current_day smallint not null default 0 check (current_day between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

create table gameplay.referrals (
  invitee_id uuid primary key references core.users(id) on delete cascade,
  inviter_id uuid not null references core.users(id) on delete cascade,
  bound_at timestamptz not null default now(),
  first_recharge_at timestamptz,
  reward_fgems bigint not null default 0 check (reward_fgems in (0, 500)),
  reward_operation_id uuid references core.operations(id),
  unique (inviter_id, invitee_id),
  check (inviter_id <> invitee_id)
);

create index referrals_inviter_bound_idx on gameplay.referrals (inviter_id, bound_at);
create index referrals_inviter_recharge_idx on gameplay.referrals (inviter_id, first_recharge_at) where first_recharge_at is not null;

create table gameplay.referral_milestones (
  user_id uuid not null references core.users(id) on delete cascade,
  threshold smallint not null check (threshold in (5, 10)),
  operation_id uuid not null references core.operations(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, threshold)
);
