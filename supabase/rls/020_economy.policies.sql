-- economy.policies.sql
-- RLS for currencies, balances, immutable ledger, balance locks, reward and fee rules.

grant usage on schema economy to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema economy from anon, authenticated;
grant all privileges on all tables in schema economy to service_role;

grant select on table economy.currencies to anon, authenticated;
grant select on table
  economy.user_balances,
  economy.currency_ledger,
  economy.balance_locks,
  economy.reward_rules,
  economy.fee_rules,
  economy.reconciliation_runs
to authenticated;

grant select on public.v_user_asset_summary to authenticated;

-- Admins may manage configurable rules, but ledger/balance mutations stay RPC/service-only.
grant insert, update, delete on table
  economy.reward_rules,
  economy.fee_rules,
  economy.reconciliation_runs
to authenticated;

alter table economy.currencies enable row level security;
alter table economy.user_balances enable row level security;
alter table economy.currency_ledger enable row level security;
alter table economy.balance_locks enable row level security;
alter table economy.reward_rules enable row level security;
alter table economy.fee_rules enable row level security;
alter table economy.reconciliation_runs enable row level security;

DROP POLICY IF EXISTS economy_currencies_read_public ON economy.currencies;
CREATE POLICY economy_currencies_read_public ON economy.currencies
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS economy_currencies_admin_write ON economy.currencies;
CREATE POLICY economy_currencies_admin_write ON economy.currencies
FOR ALL TO authenticated
USING (ops.has_admin_permission('economy:write'))
WITH CHECK (ops.has_admin_permission('economy:write'));

DROP POLICY IF EXISTS economy_balances_select_own ON economy.user_balances;
CREATE POLICY economy_balances_select_own ON economy.user_balances
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS economy_balances_admin_read ON economy.user_balances;
CREATE POLICY economy_balances_admin_read ON economy.user_balances
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('users:read'));

-- Direct writes to balances are intentionally not granted to authenticated users.
-- Use economy_credit/economy_debit/economy_lock_balance/economy_unlock_balance RPC through service_role.

DROP POLICY IF EXISTS economy_ledger_select_own ON economy.currency_ledger;
CREATE POLICY economy_ledger_select_own ON economy.currency_ledger
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS economy_ledger_admin_read ON economy.currency_ledger;
CREATE POLICY economy_ledger_admin_read ON economy.currency_ledger
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('users:read'));

-- Ledger is immutable. No authenticated insert/update/delete grants or policies.

DROP POLICY IF EXISTS economy_locks_select_own ON economy.balance_locks;
CREATE POLICY economy_locks_select_own ON economy.balance_locks
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS economy_locks_admin_read ON economy.balance_locks;
CREATE POLICY economy_locks_admin_read ON economy.balance_locks
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS economy_reward_rules_read_active ON economy.reward_rules;
CREATE POLICY economy_reward_rules_read_active ON economy.reward_rules
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS economy_reward_rules_admin_read ON economy.reward_rules;
CREATE POLICY economy_reward_rules_admin_read ON economy.reward_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('gacha:read'));

DROP POLICY IF EXISTS economy_reward_rules_admin_write ON economy.reward_rules;
CREATE POLICY economy_reward_rules_admin_write ON economy.reward_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('economy:write'))
WITH CHECK (ops.has_admin_permission('economy:write'));

DROP POLICY IF EXISTS economy_fee_rules_read_active ON economy.fee_rules;
CREATE POLICY economy_fee_rules_read_active ON economy.fee_rules
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS economy_fee_rules_admin_read ON economy.fee_rules;
CREATE POLICY economy_fee_rules_admin_read ON economy.fee_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS economy_fee_rules_admin_write ON economy.fee_rules;
CREATE POLICY economy_fee_rules_admin_write ON economy.fee_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('economy:write') OR ops.has_admin_permission('market:write'))
WITH CHECK (ops.has_admin_permission('economy:write') OR ops.has_admin_permission('market:write'));

DROP POLICY IF EXISTS economy_reconciliation_admin_read ON economy.reconciliation_runs;
CREATE POLICY economy_reconciliation_admin_read ON economy.reconciliation_runs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('economy:read') OR ops.has_admin_permission('ops:read'));

DROP POLICY IF EXISTS economy_reconciliation_admin_write ON economy.reconciliation_runs;
CREATE POLICY economy_reconciliation_admin_write ON economy.reconciliation_runs
FOR ALL TO authenticated
USING (ops.has_admin_permission('economy:write') OR ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('economy:write') OR ops.has_admin_permission('ops:write'));


