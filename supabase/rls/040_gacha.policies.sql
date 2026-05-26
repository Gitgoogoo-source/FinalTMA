-- gacha.policies.sql
-- RLS for blind boxes, drop pools, pity state and draw orders/results.

grant usage on schema gacha to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema gacha from anon, authenticated;
grant all privileges on all tables in schema gacha to service_role;

grant select on table
  gacha.blind_boxes,
  gacha.box_price_rules,
  gacha.drop_pool_versions,
  gacha.drop_pool_items
to anon, authenticated;

grant select on table
  gacha.pity_rules,
  gacha.user_pity_states,
  gacha.draw_orders,
  gacha.draw_results,
  gacha.draw_audit
to authenticated;

grant select on public.v_active_boxes to anon, authenticated;
grant select on public.v_box_rewards to anon, authenticated;

grant insert, update, delete on table
  gacha.blind_boxes,
  gacha.box_price_rules,
  gacha.drop_pool_versions,
  gacha.drop_pool_items,
  gacha.pity_rules
to authenticated;

alter table gacha.blind_boxes enable row level security;
alter table gacha.box_price_rules enable row level security;
alter table gacha.drop_pool_versions enable row level security;
alter table gacha.drop_pool_items enable row level security;
alter table gacha.pity_rules enable row level security;
alter table gacha.user_pity_states enable row level security;
alter table gacha.draw_orders enable row level security;
alter table gacha.draw_results enable row level security;
alter table gacha.draw_audit enable row level security;

DROP POLICY IF EXISTS gacha_boxes_read_public ON gacha.blind_boxes;
CREATE POLICY gacha_boxes_read_public ON gacha.blind_boxes
FOR SELECT TO anon, authenticated
USING (
  status in ('not_started', 'active', 'paused', 'ended', 'sold_out')
  and (starts_at is null or starts_at <= now() or status = 'not_started')
);

DROP POLICY IF EXISTS gacha_boxes_admin_read ON gacha.blind_boxes;
CREATE POLICY gacha_boxes_admin_read ON gacha.blind_boxes
FOR SELECT TO authenticated
USING (ops.has_admin_permission('gacha:read'));

DROP POLICY IF EXISTS gacha_boxes_admin_write ON gacha.blind_boxes;
CREATE POLICY gacha_boxes_admin_write ON gacha.blind_boxes
FOR ALL TO authenticated
USING (ops.has_admin_permission('gacha:write'))
WITH CHECK (ops.has_admin_permission('gacha:write'));

DROP POLICY IF EXISTS gacha_price_rules_read_public ON gacha.box_price_rules;
CREATE POLICY gacha_price_rules_read_public ON gacha.box_price_rules
FOR SELECT TO anon, authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
  and exists (
    select 1 from gacha.blind_boxes b
    where b.id = box_id
      and b.status in ('not_started', 'active', 'paused', 'ended', 'sold_out')
  )
);

DROP POLICY IF EXISTS gacha_price_rules_admin_read ON gacha.box_price_rules;
CREATE POLICY gacha_price_rules_admin_read ON gacha.box_price_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('gacha:read'));
DROP POLICY IF EXISTS gacha_price_rules_admin_write ON gacha.box_price_rules;
CREATE POLICY gacha_price_rules_admin_write ON gacha.box_price_rules FOR ALL TO authenticated USING (ops.has_admin_permission('gacha:write')) WITH CHECK (ops.has_admin_permission('gacha:write'));

DROP POLICY IF EXISTS gacha_pool_versions_read_public ON gacha.drop_pool_versions;
CREATE POLICY gacha_pool_versions_read_public ON gacha.drop_pool_versions
FOR SELECT TO anon, authenticated
USING (
  status = 'active'
  and (effective_from is null or effective_from <= now())
  and (effective_to is null or effective_to > now())
);

DROP POLICY IF EXISTS gacha_pool_versions_admin_read ON gacha.drop_pool_versions;
CREATE POLICY gacha_pool_versions_admin_read ON gacha.drop_pool_versions FOR SELECT TO authenticated USING (ops.has_admin_permission('gacha:read'));
DROP POLICY IF EXISTS gacha_pool_versions_admin_write ON gacha.drop_pool_versions;
CREATE POLICY gacha_pool_versions_admin_write ON gacha.drop_pool_versions FOR ALL TO authenticated USING (ops.has_admin_permission('gacha:write')) WITH CHECK (ops.has_admin_permission('gacha:write'));

DROP POLICY IF EXISTS gacha_pool_items_read_public ON gacha.drop_pool_items;
CREATE POLICY gacha_pool_items_read_public ON gacha.drop_pool_items
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1
    from gacha.drop_pool_versions v
    join gacha.blind_boxes b on b.id = v.box_id
    where v.id = pool_version_id
      and v.status = 'active'
      and (v.effective_from is null or v.effective_from <= now())
      and (v.effective_to is null or v.effective_to > now())
      and b.status in ('not_started', 'active', 'paused', 'ended', 'sold_out')
  )
);

DROP POLICY IF EXISTS gacha_pool_items_admin_read ON gacha.drop_pool_items;
CREATE POLICY gacha_pool_items_admin_read ON gacha.drop_pool_items FOR SELECT TO authenticated USING (ops.has_admin_permission('gacha:read'));
DROP POLICY IF EXISTS gacha_pool_items_admin_write ON gacha.drop_pool_items;
CREATE POLICY gacha_pool_items_admin_write ON gacha.drop_pool_items FOR ALL TO authenticated USING (ops.has_admin_permission('gacha:write')) WITH CHECK (ops.has_admin_permission('gacha:write'));

DROP POLICY IF EXISTS gacha_pity_rules_read_active ON gacha.pity_rules;
CREATE POLICY gacha_pity_rules_read_active ON gacha.pity_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS gacha_pity_rules_admin_read ON gacha.pity_rules;
CREATE POLICY gacha_pity_rules_admin_read ON gacha.pity_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('gacha:read'));
DROP POLICY IF EXISTS gacha_pity_rules_admin_write ON gacha.pity_rules;
CREATE POLICY gacha_pity_rules_admin_write ON gacha.pity_rules FOR ALL TO authenticated USING (ops.has_admin_permission('gacha:write')) WITH CHECK (ops.has_admin_permission('gacha:write'));

DROP POLICY IF EXISTS gacha_user_pity_select_own ON gacha.user_pity_states;
CREATE POLICY gacha_user_pity_select_own ON gacha.user_pity_states
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS gacha_user_pity_admin_read ON gacha.user_pity_states;
CREATE POLICY gacha_user_pity_admin_read ON gacha.user_pity_states
FOR SELECT TO authenticated
USING (ops.has_admin_permission('gacha:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS gacha_draw_orders_select_own ON gacha.draw_orders;
CREATE POLICY gacha_draw_orders_select_own ON gacha.draw_orders
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS gacha_draw_orders_admin_read ON gacha.draw_orders;
CREATE POLICY gacha_draw_orders_admin_read ON gacha.draw_orders
FOR SELECT TO authenticated
USING (ops.has_admin_permission('gacha:read') OR ops.has_admin_permission('payments:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS gacha_draw_results_select_own ON gacha.draw_results;
CREATE POLICY gacha_draw_results_select_own ON gacha.draw_results
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS gacha_draw_results_admin_read ON gacha.draw_results;
CREATE POLICY gacha_draw_results_admin_read ON gacha.draw_results
FOR SELECT TO authenticated
USING (ops.has_admin_permission('gacha:read') OR ops.has_admin_permission('users:read'));

-- Draw audit contains request_context and rule snapshots. It is admin-only.
DROP POLICY IF EXISTS gacha_draw_audit_admin_read ON gacha.draw_audit;
CREATE POLICY gacha_draw_audit_admin_read ON gacha.draw_audit
FOR SELECT TO authenticated
USING (ops.has_admin_permission('gacha:read') OR ops.has_admin_permission('risk:read'));


