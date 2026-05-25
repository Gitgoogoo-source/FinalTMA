-- Phase 4 task-system structure fields.
-- Scope: 第四阶段规划.md / 2.3 建议新增或补充的字段 only.

begin;

alter table tasks.task_claims
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column tasks.task_claims.idempotency_key is 'Client supplied idempotency key for task reward claims.';
comment on column tasks.task_claims.request_fingerprint is 'Stable fingerprint of the task claim request guarded by the idempotency key.';

create unique index if not exists task_claims_idempotency_key_uidx
  on tasks.task_claims (idempotency_key)
  where idempotency_key is not null;

alter table tasks.user_signins
  add column if not exists idempotency_key text,
  add column if not exists request_fingerprint text;

comment on column tasks.user_signins.idempotency_key is 'Client supplied idempotency key for daily sign-in requests.';
comment on column tasks.user_signins.request_fingerprint is 'Stable fingerprint of the daily sign-in request guarded by the idempotency key.';

create unique index if not exists user_signins_idempotency_key_uidx
  on tasks.user_signins (idempotency_key)
  where idempotency_key is not null;

alter table tasks.referral_commissions
  add column if not exists claimed_at timestamptz;

comment on column tasks.referral_commissions.claimed_at is 'Timestamp when a pending referral commission is claimed or marked granted.';

alter table tasks.share_events
  add column if not exists idempotency_key text;

comment on column tasks.share_events.idempotency_key is 'Client supplied idempotency key for share-event recording.';

create unique index if not exists share_events_idempotency_key_uidx
  on tasks.share_events (idempotency_key)
  where idempotency_key is not null;

alter table tasks.user_task_progress
  add column if not exists source_events jsonb not null default '[]'::jsonb;

comment on column tasks.user_task_progress.source_events is 'Audit trail of trusted business events that moved this task progress row.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_task_progress_source_events_array_check'
      and conrelid = 'tasks.user_task_progress'::regclass
  ) then
    alter table tasks.user_task_progress
      add constraint user_task_progress_source_events_array_check
      check (jsonb_typeof(source_events) = 'array');
  end if;
end $$;

create index if not exists user_task_progress_source_events_gin_idx
  on tasks.user_task_progress using gin (source_events);

create table if not exists tasks.user_signin_states (
  user_id uuid not null references core.users(id) on delete cascade,
  campaign_id uuid not null references tasks.signin_campaigns(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  cycle_position integer not null default 0 check (cycle_position >= 0),
  last_signin_date date,
  total_signins integer not null default 0 check (total_signins >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

comment on table tasks.user_signin_states is 'Per-user sign-in streak state for campaign cycle, break-streak and repeat-click handling.';
comment on column tasks.user_signin_states.current_streak is 'Current consecutive sign-in streak for this user and campaign.';
comment on column tasks.user_signin_states.cycle_position is 'Current position inside the sign-in campaign cycle; 0 means no active position yet.';
comment on column tasks.user_signin_states.last_signin_date is 'Most recent successful sign-in date for streak calculation.';
comment on column tasks.user_signin_states.total_signins is 'Total successful sign-ins recorded for this user and campaign.';

alter table tasks.user_signin_states enable row level security;

drop policy if exists tasks_user_signin_states_select_own on tasks.user_signin_states;
create policy tasks_user_signin_states_select_own
  on tasks.user_signin_states
  for select
  to authenticated
  using (user_id = core.current_user_id());

grant select on tasks.user_signin_states to authenticated;
grant all privileges on tasks.user_signin_states to service_role;
revoke insert, update, delete, truncate on tasks.user_signin_states from anon, authenticated;

create index if not exists user_signin_states_user_updated_idx
  on tasks.user_signin_states (user_id, updated_at desc);

create index if not exists user_signin_states_campaign_date_idx
  on tasks.user_signin_states (campaign_id, last_signin_date desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'user_signin_states_set_updated_at'
      and tgrelid = 'tasks.user_signin_states'::regclass
  ) then
    create trigger user_signin_states_set_updated_at
    before update on tasks.user_signin_states
    for each row execute function core.set_updated_at();
  end if;
end $$;

commit;
