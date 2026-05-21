-- 0008_create_tasks_referrals.sql
-- Tasks, 7-day sign-in campaign, referrals, referral rewards and commission records.

create table if not exists tasks.task_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  task_type text not null check (task_type in ('daily', 'social', 'trade', 'onchain', 'gacha', 'referral', 'one_time')),
  title text not null,
  description text,
  period_type text not null default 'once' check (period_type in ('once', 'daily', 'weekly', 'event')),
  target_count integer not null default 1 check (target_count > 0),
  reward jsonb not null default '[]'::jsonb,
  action_type text check (action_type in ('open_box', 'buy_market', 'sell_market', 'connect_wallet', 'sync_nft', 'join_group', 'share', 'invite', 'none')),
  action_url text,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table tasks.task_definitions is 'Task templates for daily, social, trade, on-chain and one-time tasks. Rewards are validated server-side.';

create table if not exists tasks.task_periods (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks.task_definitions(id) on delete cascade,
  period_key text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (task_id, period_key)
);

create table if not exists tasks.user_task_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  task_id uuid not null references tasks.task_definitions(id) on delete cascade,
  period_key text not null default 'once',
  progress_count integer not null default 0 check (progress_count >= 0),
  target_count integer not null default 1 check (target_count > 0),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'claimed', 'expired')),
  completed_at timestamptz,
  claimed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_id, period_key)
);

create table if not exists tasks.task_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  task_id uuid not null references tasks.task_definitions(id) on delete cascade,
  period_key text not null default 'once',
  reward jsonb not null default '[]'::jsonb,
  claimed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, task_id, period_key)
);

create table if not exists tasks.signin_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  cycle_days integer not null default 7 check (cycle_days > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks.signin_days (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references tasks.signin_campaigns(id) on delete cascade,
  day_index integer not null check (day_index > 0),
  reward jsonb not null default '[]'::jsonb,
  title text,
  metadata jsonb not null default '{}'::jsonb,
  unique (campaign_id, day_index)
);

create table if not exists tasks.user_signins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  campaign_id uuid not null references tasks.signin_campaigns(id) on delete cascade,
  day_index integer not null check (day_index > 0),
  signin_date date not null default current_date,
  reward jsonb not null default '[]'::jsonb,
  status text not null default 'claimed' check (status in ('claimed', 'reversed')),
  created_at timestamptz not null default now(),
  unique (user_id, campaign_id, signin_date)
);

create table if not exists tasks.referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references core.users(id) on delete cascade,
  invitee_user_id uuid not null references core.users(id) on delete cascade,
  invite_code text not null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded', 'cancelled')),
  first_open_order_id uuid,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invitee_user_id),
  check (inviter_user_id <> invitee_user_id)
);

comment on table tasks.referrals is 'Immutable referral relationship. Invitee can only bind one inviter.';

create table if not exists tasks.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references tasks.referrals(id) on delete cascade,
  user_id uuid not null references core.users(id) on delete cascade,
  reward_role text not null check (reward_role in ('inviter', 'invitee')),
  currency_code text not null references economy.currencies(code),
  amount numeric(38,0) not null check (amount > 0),
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  status text not null default 'granted' check (status in ('pending', 'granted', 'reversed')),
  created_at timestamptz not null default now(),
  unique (referral_id, reward_role)
);

create table if not exists tasks.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references tasks.referrals(id) on delete cascade,
  inviter_user_id uuid not null references core.users(id) on delete cascade,
  invitee_user_id uuid not null references core.users(id) on delete cascade,
  source_type text not null default 'gacha_open',
  source_id uuid,
  base_amount_kcoin numeric(38,0) not null default 0 check (base_amount_kcoin >= 0),
  commission_bps integer not null default 1000 check (commission_bps >= 0 and commission_bps <= 10000),
  commission_amount_kcoin numeric(38,0) not null check (commission_amount_kcoin >= 0),
  ledger_id uuid references economy.currency_ledger(id) on delete set null,
  status text not null default 'granted' check (status in ('pending', 'granted', 'reversed')),
  created_at timestamptz not null default now()
);

create table if not exists tasks.share_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.users(id) on delete cascade,
  share_type text not null check (share_type in ('copy_link', 'telegram_user', 'telegram_group', 'telegram_channel', 'card_share')),
  target text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
