-- inventory.policies.sql
-- RLS for user-owned collectible instances, locks, events, upgrades, evolution and decomposition.

grant usage on schema inventory to authenticated, service_role;
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema inventory from anon, authenticated;
grant all privileges on all tables in schema inventory to service_role;

grant select on all tables in schema inventory to authenticated;
grant select on public.v_user_inventory to authenticated;

-- Admins may manage growth rule tables directly. User inventory mutations remain RPC/service-only.
grant insert, update, delete on table
  inventory.upgrade_rules,
  inventory.evolution_rules,
  inventory.decompose_rules
to authenticated;

alter table inventory.item_instances enable row level security;
alter table inventory.inventory_locks enable row level security;
alter table inventory.item_instance_events enable row level security;
alter table inventory.upgrade_rules enable row level security;
alter table inventory.upgrade_logs enable row level security;
alter table inventory.evolution_rules enable row level security;
alter table inventory.evolution_attempts enable row level security;
alter table inventory.evolution_consumed_items enable row level security;
alter table inventory.decompose_rules enable row level security;
alter table inventory.decompose_logs enable row level security;

DROP POLICY IF EXISTS inventory_items_select_own ON inventory.item_instances;
CREATE POLICY inventory_items_select_own ON inventory.item_instances
FOR SELECT TO authenticated
USING (owner_user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_items_admin_read ON inventory.item_instances;
CREATE POLICY inventory_items_admin_read ON inventory.item_instances
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_locks_select_own ON inventory.inventory_locks;
CREATE POLICY inventory_locks_select_own ON inventory.inventory_locks
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_locks_admin_read ON inventory.inventory_locks;
CREATE POLICY inventory_locks_admin_read ON inventory.inventory_locks
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('market:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_events_select_own ON inventory.item_instance_events;
CREATE POLICY inventory_events_select_own ON inventory.item_instance_events
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_events_admin_read ON inventory.item_instance_events;
CREATE POLICY inventory_events_admin_read ON inventory.item_instance_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_upgrade_rules_read_active ON inventory.upgrade_rules;
CREATE POLICY inventory_upgrade_rules_read_active ON inventory.upgrade_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS inventory_upgrade_rules_admin_read ON inventory.upgrade_rules;
CREATE POLICY inventory_upgrade_rules_admin_read ON inventory.upgrade_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('catalog:read'));

DROP POLICY IF EXISTS inventory_upgrade_rules_admin_write ON inventory.upgrade_rules;
CREATE POLICY inventory_upgrade_rules_admin_write ON inventory.upgrade_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'))
WITH CHECK (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'));

DROP POLICY IF EXISTS inventory_upgrade_logs_select_own ON inventory.upgrade_logs;
CREATE POLICY inventory_upgrade_logs_select_own ON inventory.upgrade_logs
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_upgrade_logs_admin_read ON inventory.upgrade_logs;
CREATE POLICY inventory_upgrade_logs_admin_read ON inventory.upgrade_logs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_evolution_rules_read_active ON inventory.evolution_rules;
CREATE POLICY inventory_evolution_rules_read_active ON inventory.evolution_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS inventory_evolution_rules_admin_read ON inventory.evolution_rules;
CREATE POLICY inventory_evolution_rules_admin_read ON inventory.evolution_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('catalog:read'));

DROP POLICY IF EXISTS inventory_evolution_rules_admin_write ON inventory.evolution_rules;
CREATE POLICY inventory_evolution_rules_admin_write ON inventory.evolution_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'))
WITH CHECK (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'));

DROP POLICY IF EXISTS inventory_evolution_attempts_select_own ON inventory.evolution_attempts;
CREATE POLICY inventory_evolution_attempts_select_own ON inventory.evolution_attempts
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_evolution_attempts_admin_read ON inventory.evolution_attempts;
CREATE POLICY inventory_evolution_attempts_admin_read ON inventory.evolution_attempts
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_evolution_consumed_select_own ON inventory.evolution_consumed_items;
CREATE POLICY inventory_evolution_consumed_select_own ON inventory.evolution_consumed_items
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from inventory.evolution_attempts ea
    where ea.id = attempt_id
      and ea.user_id = core.current_user_id()
  )
);

DROP POLICY IF EXISTS inventory_evolution_consumed_admin_read ON inventory.evolution_consumed_items;
CREATE POLICY inventory_evolution_consumed_admin_read ON inventory.evolution_consumed_items
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS inventory_decompose_rules_read_active ON inventory.decompose_rules;
CREATE POLICY inventory_decompose_rules_read_active ON inventory.decompose_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS inventory_decompose_rules_admin_read ON inventory.decompose_rules;
CREATE POLICY inventory_decompose_rules_admin_read ON inventory.decompose_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('catalog:read'));

DROP POLICY IF EXISTS inventory_decompose_rules_admin_write ON inventory.decompose_rules;
CREATE POLICY inventory_decompose_rules_admin_write ON inventory.decompose_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'))
WITH CHECK (ops.has_admin_permission('inventory:write') OR ops.has_admin_permission('catalog:write'));

DROP POLICY IF EXISTS inventory_decompose_logs_select_own ON inventory.decompose_logs;
CREATE POLICY inventory_decompose_logs_select_own ON inventory.decompose_logs
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS inventory_decompose_logs_admin_read ON inventory.decompose_logs;
CREATE POLICY inventory_decompose_logs_admin_read ON inventory.decompose_logs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('inventory:read') OR ops.has_admin_permission('users:read'));


