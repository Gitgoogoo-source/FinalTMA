-- Phase 4 / 4.1 table access cleanup.
-- The task/economy rows listed in the Phase 4 matrix are frontend read-only;
-- writes go through API/RPC with service_role. The ops rows stay backend-only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
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
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON TABLE ops.risk_events, ops.idempotency_keys
FROM public, anon, authenticated;

DROP POLICY IF EXISTS tasks_share_events_insert_own ON tasks.share_events;
DROP POLICY IF EXISTS tasks_signin_days_read ON tasks.signin_days;

DROP POLICY IF EXISTS tasks_definitions_admin_read ON tasks.task_definitions;
DROP POLICY IF EXISTS tasks_definitions_admin_write ON tasks.task_definitions;
DROP POLICY IF EXISTS tasks_periods_admin_read ON tasks.task_periods;
DROP POLICY IF EXISTS tasks_periods_admin_write ON tasks.task_periods;
DROP POLICY IF EXISTS tasks_progress_admin_read ON tasks.user_task_progress;
DROP POLICY IF EXISTS tasks_claims_admin_read ON tasks.task_claims;
DROP POLICY IF EXISTS tasks_signin_campaigns_admin_read ON tasks.signin_campaigns;
DROP POLICY IF EXISTS tasks_signin_campaigns_admin_write ON tasks.signin_campaigns;
DROP POLICY IF EXISTS tasks_signin_days_admin_read ON tasks.signin_days;
DROP POLICY IF EXISTS tasks_signin_days_admin_write ON tasks.signin_days;
DROP POLICY IF EXISTS tasks_user_signins_admin_read ON tasks.user_signins;
DROP POLICY IF EXISTS tasks_referrals_admin_read ON tasks.referrals;
DROP POLICY IF EXISTS tasks_referral_rewards_admin_read ON tasks.referral_rewards;
DROP POLICY IF EXISTS tasks_commissions_admin_read ON tasks.referral_commissions;
DROP POLICY IF EXISTS tasks_share_events_admin_read ON tasks.share_events;
DROP POLICY IF EXISTS economy_balances_admin_read ON economy.user_balances;
DROP POLICY IF EXISTS economy_ledger_admin_read ON economy.currency_ledger;
DROP POLICY IF EXISTS ops_risk_events_admin_read ON ops.risk_events;
DROP POLICY IF EXISTS ops_risk_events_admin_write ON ops.risk_events;
DROP POLICY IF EXISTS ops_idempotency_admin_read ON ops.idempotency_keys;

ALTER FUNCTION core.set_updated_at() SET search_path = core, public;
ALTER FUNCTION core.request_claims() SET search_path = core, public;
ALTER FUNCTION core.current_user_id() SET search_path = core, public;
ALTER FUNCTION core.current_admin_id() SET search_path = core, public;
ALTER FUNCTION economy.prevent_currency_ledger_mutation() SET search_path = economy, public;
ALTER FUNCTION gacha.refresh_drop_pool_total_weight() SET search_path = gacha, public;
ALTER FUNCTION album.record_discovery_from_inventory() SET search_path = album, inventory, public;
ALTER FUNCTION market.validate_listing_counts() SET search_path = market, public;

