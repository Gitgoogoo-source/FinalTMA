-- payments.policies.sql
-- RLS for Telegram Stars orders, invoices, successful payments, webhook events, refunds and disputes.

grant usage on schema payments to authenticated, service_role;
revoke all on all tables in schema payments from anon, authenticated;
grant all privileges on all tables in schema payments to service_role;

grant select on table
  payments.star_orders,
  payments.star_invoices,
  payments.star_payments,
  payments.star_refunds,
  payments.payment_disputes
to authenticated;

grant select on table payments.telegram_webhook_events to authenticated;

-- Direct user dispute insert is allowed for support flows; all payment fulfillment still goes through webhook/RPC.
grant insert on table payments.payment_disputes to authenticated;

alter table payments.star_orders enable row level security;
alter table payments.star_invoices enable row level security;
alter table payments.star_payments enable row level security;
alter table payments.telegram_webhook_events enable row level security;
alter table payments.star_refunds enable row level security;
alter table payments.payment_disputes enable row level security;

DROP POLICY IF EXISTS payments_star_orders_select_own ON payments.star_orders;
CREATE POLICY payments_star_orders_select_own ON payments.star_orders
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS payments_star_orders_admin_read ON payments.star_orders;
CREATE POLICY payments_star_orders_admin_read ON payments.star_orders
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS payments_star_invoices_select_own ON payments.star_invoices;
CREATE POLICY payments_star_invoices_select_own ON payments.star_invoices
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from payments.star_orders so
    where so.id = star_order_id
      and so.user_id = core.current_user_id()
  )
);

DROP POLICY IF EXISTS payments_star_invoices_admin_read ON payments.star_invoices;
CREATE POLICY payments_star_invoices_admin_read ON payments.star_invoices
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read'));

DROP POLICY IF EXISTS payments_star_payments_select_own ON payments.star_payments;
CREATE POLICY payments_star_payments_select_own ON payments.star_payments
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS payments_star_payments_admin_read ON payments.star_payments;
CREATE POLICY payments_star_payments_admin_read ON payments.star_payments
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read'));

DROP POLICY IF EXISTS payments_webhook_events_admin_read ON payments.telegram_webhook_events;
CREATE POLICY payments_webhook_events_admin_read ON payments.telegram_webhook_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read') OR ops.has_admin_permission('risk:read'));

DROP POLICY IF EXISTS payments_refunds_select_own ON payments.star_refunds;
CREATE POLICY payments_refunds_select_own ON payments.star_refunds
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS payments_refunds_admin_read ON payments.star_refunds;
CREATE POLICY payments_refunds_admin_read ON payments.star_refunds
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read'));

DROP POLICY IF EXISTS payments_disputes_select_own ON payments.payment_disputes;
CREATE POLICY payments_disputes_select_own ON payments.payment_disputes
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS payments_disputes_insert_own ON payments.payment_disputes;
CREATE POLICY payments_disputes_insert_own ON payments.payment_disputes
FOR INSERT TO authenticated
WITH CHECK (user_id = core.current_user_id());

DROP POLICY IF EXISTS payments_disputes_admin_read ON payments.payment_disputes;
CREATE POLICY payments_disputes_admin_read ON payments.payment_disputes
FOR SELECT TO authenticated
USING (ops.has_admin_permission('payments:read') OR ops.has_admin_permission('tickets:read'));

DROP POLICY IF EXISTS payments_disputes_admin_write ON payments.payment_disputes;
CREATE POLICY payments_disputes_admin_write ON payments.payment_disputes
FOR ALL TO authenticated
USING (ops.has_admin_permission('payments:write') OR ops.has_admin_permission('tickets:write'))
WITH CHECK (ops.has_admin_permission('payments:write') OR ops.has_admin_permission('tickets:write'));


