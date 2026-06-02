-- core.policies.sql
-- Row Level Security for user identity, sessions, devices, wallet bindings and notifications.
-- Business writes should normally go through Vercel API + service_role + RPC.

-- Base grants.
grant usage on schema core to authenticated, service_role;
grant usage on schema ops to authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Helper: check whether a JWT contains an active admin identity.
-- The function is SECURITY DEFINER so policies can check admin status without being blocked by ops RLS.
create or replace function ops.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.admin_users au
    where au.id = core.current_admin_id()
      and au.status = 'active'
  );
$$;

create or replace function ops.has_admin_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ops, core, public
as $$
  select exists (
    select 1
    from ops.admin_users au
    join ops.admin_user_roles aur on aur.admin_user_id = au.id
    join ops.admin_roles ar on ar.id = aur.role_id
    where au.id = core.current_admin_id()
      and au.status = 'active'
      and (
        p_permission is null
        or ar.permissions ? '*'
        or ar.permissions ? p_permission
      )
  );
$$;

grant execute on function ops.is_active_admin() to authenticated, service_role;
grant execute on function ops.has_admin_permission(text) to authenticated, service_role;

-- Revoke public access first. Explicit grants below are narrow and RLS-controlled.
revoke all on all tables in schema core from anon, authenticated;
grant all privileges on all tables in schema core to service_role;

grant select on table
  core.users,
  core.user_profiles,
  core.user_devices,
  core.user_wallets,
  core.wallet_proofs,
  core.user_flags,
  core.notifications
to authenticated;

-- Optional direct admin management through Supabase JWT with admin_user_id claim.
-- Normal users still cannot mutate these tables because admin policies require ops.has_admin_permission().
grant insert, update, delete on table
  core.users,
  core.user_profiles,
  core.user_devices,
  core.user_wallets,
  core.wallet_proofs,
  core.user_flags,
  core.notifications
to authenticated;

alter table core.users enable row level security;
alter table core.user_profiles enable row level security;
alter table core.app_sessions enable row level security;
alter table core.user_devices enable row level security;
alter table core.user_wallets enable row level security;
alter table core.wallet_proofs enable row level security;
alter table core.user_flags enable row level security;
alter table core.notifications enable row level security;
alter table core.user_api_tokens enable row level security;

-- core.users
DROP POLICY IF EXISTS core_users_select_own ON core.users;
CREATE POLICY core_users_select_own ON core.users
FOR SELECT TO authenticated
USING (id = core.current_user_id());

DROP POLICY IF EXISTS core_users_admin_read ON core.users;
CREATE POLICY core_users_admin_read ON core.users
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_users_admin_write ON core.users;
CREATE POLICY core_users_admin_write ON core.users
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'))
WITH CHECK (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'));

-- core.user_profiles
DROP POLICY IF EXISTS core_profiles_select_own ON core.user_profiles;
CREATE POLICY core_profiles_select_own ON core.user_profiles
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_profiles_admin_read ON core.user_profiles;
CREATE POLICY core_profiles_admin_read ON core.user_profiles
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_profiles_admin_write ON core.user_profiles;
CREATE POLICY core_profiles_admin_write ON core.user_profiles
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'))
WITH CHECK (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'));

-- core.user_devices
DROP POLICY IF EXISTS core_devices_select_own ON core.user_devices;
CREATE POLICY core_devices_select_own ON core.user_devices
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_devices_admin_read ON core.user_devices;
CREATE POLICY core_devices_admin_read ON core.user_devices
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_devices_admin_write ON core.user_devices;
CREATE POLICY core_devices_admin_write ON core.user_devices
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write'))
WITH CHECK (ops.has_admin_permission('core:write'));

-- core.user_wallets
DROP POLICY IF EXISTS core_wallets_select_own ON core.user_wallets;
CREATE POLICY core_wallets_select_own ON core.user_wallets
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_wallets_admin_read ON core.user_wallets;
CREATE POLICY core_wallets_admin_read ON core.user_wallets
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read') OR ops.has_admin_permission('wallet:read'));

DROP POLICY IF EXISTS core_wallets_admin_write ON core.user_wallets;
CREATE POLICY core_wallets_admin_write ON core.user_wallets
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write') OR ops.has_admin_permission('wallet:write'))
WITH CHECK (ops.has_admin_permission('core:write') OR ops.has_admin_permission('wallet:write'));

-- core.wallet_proofs
DROP POLICY IF EXISTS core_wallet_proofs_select_own ON core.wallet_proofs;
CREATE POLICY core_wallet_proofs_select_own ON core.wallet_proofs
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_wallet_proofs_admin_read ON core.wallet_proofs;
CREATE POLICY core_wallet_proofs_admin_read ON core.wallet_proofs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('wallet:read'));

DROP POLICY IF EXISTS core_wallet_proofs_admin_write ON core.wallet_proofs;
CREATE POLICY core_wallet_proofs_admin_write ON core.wallet_proofs
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write') OR ops.has_admin_permission('wallet:write'))
WITH CHECK (ops.has_admin_permission('core:write') OR ops.has_admin_permission('wallet:write'));

-- core.user_flags
DROP POLICY IF EXISTS core_flags_select_own ON core.user_flags;
CREATE POLICY core_flags_select_own ON core.user_flags
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_flags_admin_read ON core.user_flags;
CREATE POLICY core_flags_admin_read ON core.user_flags
FOR SELECT TO authenticated
USING (ops.has_admin_permission('risk:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_flags_admin_write ON core.user_flags;
CREATE POLICY core_flags_admin_write ON core.user_flags
FOR ALL TO authenticated
USING (ops.has_admin_permission('risk:write') OR ops.has_admin_permission('users:write'))
WITH CHECK (ops.has_admin_permission('risk:write') OR ops.has_admin_permission('users:write'));

-- core.notifications
DROP POLICY IF EXISTS core_notifications_select_own ON core.notifications;
CREATE POLICY core_notifications_select_own ON core.notifications
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_notifications_admin_read ON core.notifications;
CREATE POLICY core_notifications_admin_read ON core.notifications
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_notifications_admin_write ON core.notifications;
CREATE POLICY core_notifications_admin_write ON core.notifications
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'))
WITH CHECK (ops.has_admin_permission('core:write') OR ops.has_admin_permission('users:write'));

