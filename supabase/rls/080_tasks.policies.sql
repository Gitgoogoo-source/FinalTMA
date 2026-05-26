-- tasks.policies.sql
-- RLS for tasks, 7-day sign-in, referrals, commissions and share events.

grant usage on schema tasks to authenticated, service_role;
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema tasks from anon, authenticated;
grant all privileges on all tables in schema tasks to service_role;

grant select on all tables in schema tasks to authenticated;
grant select on public.v_user_task_status to authenticated;

-- User share events may be inserted directly if you want lightweight tracking from the Mini App.
-- Core progress/reward tables remain RPC/service-only.
grant insert on table tasks.share_events to authenticated;

grant insert, update, delete on table
  tasks.task_definitions,
  tasks.task_periods,
  tasks.signin_campaigns,
  tasks.signin_days
to authenticated;

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

DROP POLICY IF EXISTS tasks_definitions_read_active ON tasks.task_definitions;
CREATE POLICY tasks_definitions_read_active ON tasks.task_definitions
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS tasks_definitions_admin_read ON tasks.task_definitions;
CREATE POLICY tasks_definitions_admin_read ON tasks.task_definitions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_definitions_admin_write ON tasks.task_definitions;
CREATE POLICY tasks_definitions_admin_write ON tasks.task_definitions
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_periods_read_active ON tasks.task_periods;
CREATE POLICY tasks_periods_read_active ON tasks.task_periods
FOR SELECT TO authenticated
USING (active = true and starts_at <= now() and ends_at > now());

DROP POLICY IF EXISTS tasks_periods_admin_read ON tasks.task_periods;
CREATE POLICY tasks_periods_admin_read ON tasks.task_periods
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_periods_admin_write ON tasks.task_periods;
CREATE POLICY tasks_periods_admin_write ON tasks.task_periods
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_progress_select_own ON tasks.user_task_progress;
CREATE POLICY tasks_progress_select_own ON tasks.user_task_progress
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_progress_admin_read ON tasks.user_task_progress;
CREATE POLICY tasks_progress_admin_read ON tasks.user_task_progress
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_claims_select_own ON tasks.task_claims;
CREATE POLICY tasks_claims_select_own ON tasks.task_claims
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_claims_admin_read ON tasks.task_claims;
CREATE POLICY tasks_claims_admin_read ON tasks.task_claims
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_signin_campaigns_read_active ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_read_active ON tasks.signin_campaigns
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS tasks_signin_campaigns_admin_read ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_admin_read ON tasks.signin_campaigns
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_signin_campaigns_admin_write ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_admin_write ON tasks.signin_campaigns
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_signin_days_read_active ON tasks.signin_days;
CREATE POLICY tasks_signin_days_read_active ON tasks.signin_days
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from tasks.signin_campaigns sc
    where sc.id = campaign_id
      and sc.active = true
      and (sc.starts_at is null or sc.starts_at <= now())
      and (sc.ends_at is null or sc.ends_at > now())
  )
);

DROP POLICY IF EXISTS tasks_signin_days_admin_read ON tasks.signin_days;
CREATE POLICY tasks_signin_days_admin_read ON tasks.signin_days
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_signin_days_admin_write ON tasks.signin_days;
CREATE POLICY tasks_signin_days_admin_write ON tasks.signin_days
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_user_signins_select_own ON tasks.user_signins;
CREATE POLICY tasks_user_signins_select_own ON tasks.user_signins
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_user_signins_admin_read ON tasks.user_signins;
CREATE POLICY tasks_user_signins_admin_read ON tasks.user_signins
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_referrals_select_party ON tasks.referrals;
CREATE POLICY tasks_referrals_select_party ON tasks.referrals
FOR SELECT TO authenticated
USING (inviter_user_id = core.current_user_id() OR invitee_user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_referrals_admin_read ON tasks.referrals;
CREATE POLICY tasks_referrals_admin_read ON tasks.referrals
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_referral_rewards_select_own ON tasks.referral_rewards;
CREATE POLICY tasks_referral_rewards_select_own ON tasks.referral_rewards
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_referral_rewards_admin_read ON tasks.referral_rewards;
CREATE POLICY tasks_referral_rewards_admin_read ON tasks.referral_rewards
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_commissions_select_inviter ON tasks.referral_commissions;
CREATE POLICY tasks_commissions_select_inviter ON tasks.referral_commissions
FOR SELECT TO authenticated
USING (inviter_user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_commissions_admin_read ON tasks.referral_commissions;
CREATE POLICY tasks_commissions_admin_read ON tasks.referral_commissions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_share_events_select_own ON tasks.share_events;
CREATE POLICY tasks_share_events_select_own ON tasks.share_events
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_share_events_insert_own ON tasks.share_events;
CREATE POLICY tasks_share_events_insert_own ON tasks.share_events
FOR INSERT TO authenticated
WITH CHECK (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_share_events_admin_read ON tasks.share_events;
CREATE POLICY tasks_share_events_admin_read ON tasks.share_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('risk:read'));


