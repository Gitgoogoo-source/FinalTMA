-- ops.policies.sql
-- RLS for admin roles, admin users, audit logs, feature flags, system settings, risk, idempotency, rate limits and support.
-- Ops writes should normally go through /api/admin and admin_write_audit_log RPC.

grant usage on schema ops to authenticated, service_role;
revoke all on all tables in schema ops from anon, authenticated;
grant all privileges on all tables in schema ops to service_role;

grant select on table
  ops.admin_roles,
  ops.admin_users,
  ops.admin_user_roles,
  ops.admin_audit_logs,
  ops.feature_flags,
  ops.system_settings,
  ops.risk_events,
  ops.idempotency_keys,
  ops.api_rate_limits,
  ops.support_tickets,
  ops.app_events
to authenticated;

-- Admin direct management policies. Normal users cannot pass ops.has_admin_permission().
grant insert, update, delete on table
  ops.admin_roles,
  ops.admin_users,
  ops.admin_user_roles,
  ops.feature_flags,
  ops.system_settings,
  ops.risk_events,
  ops.support_tickets
to authenticated;

-- Users may create and read their own support tickets. This is optional; remove these grants if all support goes through API.
grant insert on table ops.support_tickets to authenticated;

grant insert on table ops.app_events to authenticated;

alter table ops.admin_roles enable row level security;
alter table ops.admin_users enable row level security;
alter table ops.admin_user_roles enable row level security;
alter table ops.admin_audit_logs enable row level security;
alter table ops.feature_flags enable row level security;
alter table ops.system_settings enable row level security;
alter table ops.risk_events enable row level security;
alter table ops.idempotency_keys enable row level security;
alter table ops.api_rate_limits enable row level security;
alter table ops.telegram_init_data_consumptions enable row level security;
alter table ops.support_tickets enable row level security;
alter table ops.app_events enable row level security;

-- Admin roles and memberships.
DROP POLICY IF EXISTS ops_admin_roles_admin_read ON ops.admin_roles;
CREATE POLICY ops_admin_roles_admin_read ON ops.admin_roles
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read'));

DROP POLICY IF EXISTS ops_admin_roles_admin_write ON ops.admin_roles;
CREATE POLICY ops_admin_roles_admin_write ON ops.admin_roles
FOR ALL TO authenticated
USING (ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('ops:write'));

DROP POLICY IF EXISTS ops_admin_users_self_read ON ops.admin_users;
CREATE POLICY ops_admin_users_self_read ON ops.admin_users
FOR SELECT TO authenticated
USING (id = core.current_admin_id() AND status = 'active');

DROP POLICY IF EXISTS ops_admin_users_admin_read ON ops.admin_users;
CREATE POLICY ops_admin_users_admin_read ON ops.admin_users
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS ops_admin_users_admin_write ON ops.admin_users;
CREATE POLICY ops_admin_users_admin_write ON ops.admin_users
FOR ALL TO authenticated
USING (ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('ops:write'));

DROP POLICY IF EXISTS ops_admin_user_roles_admin_read ON ops.admin_user_roles;
CREATE POLICY ops_admin_user_roles_admin_read ON ops.admin_user_roles
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read'));

DROP POLICY IF EXISTS ops_admin_user_roles_admin_write ON ops.admin_user_roles;
CREATE POLICY ops_admin_user_roles_admin_write ON ops.admin_user_roles
FOR ALL TO authenticated
USING (ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('ops:write'));

-- Audit logs are append-only through service/RPC. Admins can read them.
DROP POLICY IF EXISTS ops_audit_logs_admin_read ON ops.admin_audit_logs;
CREATE POLICY ops_audit_logs_admin_read ON ops.admin_audit_logs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read'));

-- Feature flags and system settings.
DROP POLICY IF EXISTS ops_feature_flags_admin_read ON ops.feature_flags;
CREATE POLICY ops_feature_flags_admin_read ON ops.feature_flags
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read'));

DROP POLICY IF EXISTS ops_feature_flags_admin_write ON ops.feature_flags;
CREATE POLICY ops_feature_flags_admin_write ON ops.feature_flags
FOR ALL TO authenticated
USING (ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('ops:write'));

DROP POLICY IF EXISTS ops_system_settings_admin_read ON ops.system_settings;
CREATE POLICY ops_system_settings_admin_read ON ops.system_settings
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read'));

DROP POLICY IF EXISTS ops_system_settings_admin_write ON ops.system_settings;
CREATE POLICY ops_system_settings_admin_write ON ops.system_settings
FOR ALL TO authenticated
USING (ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('ops:write'));

-- Risk events.
DROP POLICY IF EXISTS ops_risk_events_admin_read ON ops.risk_events;
CREATE POLICY ops_risk_events_admin_read ON ops.risk_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('risk:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS ops_risk_events_admin_write ON ops.risk_events;
CREATE POLICY ops_risk_events_admin_write ON ops.risk_events
FOR ALL TO authenticated
USING (ops.has_admin_permission('risk:write'))
WITH CHECK (ops.has_admin_permission('risk:write'));

-- Idempotency and rate limits are backend/service-owned. Admins may inspect.
DROP POLICY IF EXISTS ops_idempotency_admin_read ON ops.idempotency_keys;
CREATE POLICY ops_idempotency_admin_read ON ops.idempotency_keys
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read') OR ops.has_admin_permission('risk:read'));

DROP POLICY IF EXISTS ops_rate_limits_admin_read ON ops.api_rate_limits;
CREATE POLICY ops_rate_limits_admin_read ON ops.api_rate_limits
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read') OR ops.has_admin_permission('risk:read'));

-- Support tickets.
DROP POLICY IF EXISTS ops_support_tickets_select_own ON ops.support_tickets;
CREATE POLICY ops_support_tickets_select_own ON ops.support_tickets
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS ops_support_tickets_insert_own ON ops.support_tickets;
CREATE POLICY ops_support_tickets_insert_own ON ops.support_tickets
FOR INSERT TO authenticated
WITH CHECK (user_id = core.current_user_id());

DROP POLICY IF EXISTS ops_support_tickets_admin_read ON ops.support_tickets;
CREATE POLICY ops_support_tickets_admin_read ON ops.support_tickets
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tickets:read') OR ops.has_admin_permission('payments:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS ops_support_tickets_admin_write ON ops.support_tickets;
CREATE POLICY ops_support_tickets_admin_write ON ops.support_tickets
FOR ALL TO authenticated
USING (ops.has_admin_permission('tickets:write') OR ops.has_admin_permission('ops:write'))
WITH CHECK (ops.has_admin_permission('tickets:write') OR ops.has_admin_permission('ops:write'));

-- App events. Users may insert their own lightweight events; reads are admin-only.
DROP POLICY IF EXISTS ops_app_events_insert_own ON ops.app_events;
CREATE POLICY ops_app_events_insert_own ON ops.app_events
FOR INSERT TO authenticated
WITH CHECK (user_id = core.current_user_id());

DROP POLICY IF EXISTS ops_app_events_admin_read ON ops.app_events;
CREATE POLICY ops_app_events_admin_read ON ops.app_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('ops:read') OR ops.has_admin_permission('risk:read'));
