-- Phase 4 / 4.1 table access levels.
-- Keep frontend-facing roles read-only for the listed task/economy tables and
-- keep ops risk/idempotency tables backend-only. Share events are recorded via
-- API + RPC, not direct authenticated table inserts.

begin;

grant usage on schema tasks, economy to authenticated, service_role;
grant usage on schema ops to service_role;

alter table tasks.task_definitions enable row level security;
alter table tasks.task_periods enable row level security;
alter table tasks.user_task_progress enable row level security;
alter table tasks.task_claims enable row level security;
alter table tasks.signin_campaigns enable row level security;
alter table tasks.signin_days enable row level security;
alter table tasks.user_signins enable row level security;
alter table tasks.referrals enable row level security;
alter table tasks.referral_rewards enable row level security;
alter table tasks.referral_commissions enable row level security;
alter table tasks.share_events enable row level security;
alter table economy.user_balances enable row level security;
alter table economy.currency_ledger enable row level security;
alter table ops.risk_events enable row level security;
alter table ops.idempotency_keys enable row level security;

grant select on table
  tasks.task_definitions,
  tasks.task_periods,
  tasks.user_task_progress,
  tasks.task_claims,
  tasks.signin_campaigns,
  tasks.signin_days,
  tasks.user_signins,
  tasks.referrals,
  tasks.referral_rewards,
  tasks.referral_commissions,
  tasks.share_events,
  economy.user_balances,
  economy.currency_ledger
to authenticated;

grant all privileges on table
  tasks.task_definitions,
  tasks.task_periods,
  tasks.user_task_progress,
  tasks.task_claims,
  tasks.signin_campaigns,
  tasks.signin_days,
  tasks.user_signins,
  tasks.referrals,
  tasks.referral_rewards,
  tasks.referral_commissions,
  tasks.share_events,
  economy.user_balances,
  economy.currency_ledger,
  ops.risk_events,
  ops.idempotency_keys
to service_role;

revoke insert, update, delete, truncate on table
  tasks.task_definitions,
  tasks.task_periods,
  tasks.user_task_progress,
  tasks.task_claims,
  tasks.signin_campaigns,
  tasks.signin_days,
  tasks.user_signins,
  tasks.referrals,
  tasks.referral_rewards,
  tasks.referral_commissions,
  tasks.share_events,
  economy.user_balances,
  economy.currency_ledger
from anon, authenticated;

revoke all privileges on table ops.risk_events, ops.idempotency_keys
from public, anon, authenticated;

do $$
declare
  target record;
  column_list text;
begin
  for target in
    select *
    from (
      values
        ('ops', 'risk_events'),
        ('ops', 'idempotency_keys')
    ) as t(schema_name, table_name)
  loop
    select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into column_list
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = target.schema_name
      and c.relname = target.table_name
      and a.attnum > 0
      and not a.attisdropped;

    if column_list is not null then
      execute format(
        'revoke all privileges (%s) on table %I.%I from public, anon, authenticated',
        column_list,
        target.schema_name,
        target.table_name
      );
    end if;
  end loop;
end;
$$;

drop policy if exists tasks_definitions_read_active on tasks.task_definitions;
create policy tasks_definitions_read_active
on tasks.task_definitions
for select
to authenticated
using (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

drop policy if exists tasks_periods_read_active on tasks.task_periods;
create policy tasks_periods_read_active
on tasks.task_periods
for select
to authenticated
using (active = true and starts_at <= now() and ends_at > now());

drop policy if exists tasks_progress_select_own on tasks.user_task_progress;
create policy tasks_progress_select_own
on tasks.user_task_progress
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists tasks_claims_select_own on tasks.task_claims;
create policy tasks_claims_select_own
on tasks.task_claims
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists tasks_signin_campaigns_read_active on tasks.signin_campaigns;
create policy tasks_signin_campaigns_read_active
on tasks.signin_campaigns
for select
to authenticated
using (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

drop policy if exists tasks_signin_days_read on tasks.signin_days;
drop policy if exists tasks_signin_days_read_active on tasks.signin_days;
create policy tasks_signin_days_read_active
on tasks.signin_days
for select
to authenticated
using (
  exists (
    select 1
    from tasks.signin_campaigns sc
    where sc.id = campaign_id
      and sc.active = true
      and (sc.starts_at is null or sc.starts_at <= now())
      and (sc.ends_at is null or sc.ends_at > now())
  )
);

drop policy if exists tasks_user_signins_select_own on tasks.user_signins;
create policy tasks_user_signins_select_own
on tasks.user_signins
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists tasks_referrals_select_party on tasks.referrals;
create policy tasks_referrals_select_party
on tasks.referrals
for select
to authenticated
using (inviter_user_id = core.current_user_id() or invitee_user_id = core.current_user_id());

drop policy if exists tasks_referral_rewards_select_own on tasks.referral_rewards;
create policy tasks_referral_rewards_select_own
on tasks.referral_rewards
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists tasks_commissions_select_inviter on tasks.referral_commissions;
create policy tasks_commissions_select_inviter
on tasks.referral_commissions
for select
to authenticated
using (inviter_user_id = core.current_user_id());

drop policy if exists tasks_share_events_select_own on tasks.share_events;
create policy tasks_share_events_select_own
on tasks.share_events
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists economy_balances_select_own on economy.user_balances;
create policy economy_balances_select_own
on economy.user_balances
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists economy_ledger_select_own on economy.currency_ledger;
create policy economy_ledger_select_own
on economy.currency_ledger
for select
to authenticated
using (user_id = core.current_user_id());

drop policy if exists tasks_share_events_insert_own on tasks.share_events;

drop policy if exists tasks_definitions_admin_read on tasks.task_definitions;
drop policy if exists tasks_definitions_admin_write on tasks.task_definitions;
drop policy if exists tasks_periods_admin_read on tasks.task_periods;
drop policy if exists tasks_periods_admin_write on tasks.task_periods;
drop policy if exists tasks_progress_admin_read on tasks.user_task_progress;
drop policy if exists tasks_claims_admin_read on tasks.task_claims;
drop policy if exists tasks_signin_campaigns_admin_read on tasks.signin_campaigns;
drop policy if exists tasks_signin_campaigns_admin_write on tasks.signin_campaigns;
drop policy if exists tasks_signin_days_admin_read on tasks.signin_days;
drop policy if exists tasks_signin_days_admin_write on tasks.signin_days;
drop policy if exists tasks_user_signins_admin_read on tasks.user_signins;
drop policy if exists tasks_referrals_admin_read on tasks.referrals;
drop policy if exists tasks_referral_rewards_admin_read on tasks.referral_rewards;
drop policy if exists tasks_commissions_admin_read on tasks.referral_commissions;
drop policy if exists tasks_share_events_admin_read on tasks.share_events;
drop policy if exists economy_balances_admin_read on economy.user_balances;
drop policy if exists economy_ledger_admin_read on economy.currency_ledger;
drop policy if exists ops_risk_events_admin_read on ops.risk_events;
drop policy if exists ops_risk_events_admin_write on ops.risk_events;
drop policy if exists ops_idempotency_admin_read on ops.idempotency_keys;

drop policy if exists ops_risk_events_deny_client_access on ops.risk_events;
create policy ops_risk_events_deny_client_access
on ops.risk_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists ops_idempotency_keys_deny_client_access on ops.idempotency_keys;
create policy ops_idempotency_keys_deny_client_access
on ops.idempotency_keys
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

commit;
