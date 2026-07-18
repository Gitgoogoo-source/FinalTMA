create table tasks.definitions (
  code text primary key,
  sort_order smallint not null unique check (sort_order between 1 and 19),
  category text not null,
  display_name text not null,
  target bigint not null check (target > 0),
  reward_fgems bigint not null check (reward_fgems > 0)
);

create table tasks.daily_progress (
  user_id uuid not null references identity.users(id) on delete cascade,
  business_date date not null,
  task_code text not null references tasks.definitions(code),
  progress bigint not null default 0 check (progress >= 0),
  claimed_at timestamptz,
  claim_operation_id uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, business_date, task_code)
);

create index task_progress_claimable_idx on tasks.daily_progress (user_id, business_date) where claimed_at is null;

create table tasks.checkins (
  user_id uuid primary key references identity.users(id) on delete cascade,
  current_day smallint not null default 0 check (current_day between 0 and 7),
  last_claim_date date,
  updated_at timestamptz not null default now()
);

create or replace function tasks.progress(p_user_id uuid, p_task_code text, p_amount bigint default 1)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tasks.daily_progress (user_id, business_date, task_code, progress)
  select p_user_id, identity.utc_day(), p_task_code, p_amount
  where exists (select 1 from tasks.definitions where code = p_task_code)
  on conflict (user_id, business_date, task_code)
  do update set progress = tasks.daily_progress.progress + excluded.progress, updated_at = now()
$$;
