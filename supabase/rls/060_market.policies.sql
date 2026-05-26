-- market.policies.sql
-- RLS for marketplace listings, concrete listing items, orders, price snapshots and fees.

grant usage on schema market to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema market from anon, authenticated;
grant all privileges on all tables in schema market to service_role;

grant select on table market.listings, market.price_snapshots, market.depth_snapshots to anon, authenticated;
grant select on table
  market.listing_items,
  market.orders,
  market.order_items,
  market.listing_events,
  market.price_health_rules,
  market.fee_settlements
to authenticated;

grant select on public.v_market_listings to anon, authenticated;
grant select on public.v_market_price_summary to anon, authenticated;

-- Admins may manage market rule table. Listing/order mutations still go through service RPC.
grant insert, update, delete on table market.price_health_rules to authenticated;

alter table market.listings enable row level security;
alter table market.listing_items enable row level security;
alter table market.orders enable row level security;
alter table market.order_items enable row level security;
alter table market.listing_events enable row level security;
alter table market.price_snapshots enable row level security;
alter table market.depth_snapshots enable row level security;
alter table market.price_health_rules enable row level security;
alter table market.fee_settlements enable row level security;

DROP POLICY IF EXISTS market_listings_read_public ON market.listings;
CREATE POLICY market_listings_read_public ON market.listings
FOR SELECT TO anon, authenticated
USING (status in ('active', 'partially_sold') and remaining_count > 0 and (expires_at is null or expires_at > now()));

DROP POLICY IF EXISTS market_listings_select_own ON market.listings;
CREATE POLICY market_listings_select_own ON market.listings
FOR SELECT TO authenticated
USING (seller_user_id = core.current_user_id());

DROP POLICY IF EXISTS market_listings_admin_read ON market.listings;
CREATE POLICY market_listings_admin_read ON market.listings
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS market_listing_items_select_party ON market.listing_items;
CREATE POLICY market_listing_items_select_party ON market.listing_items
FOR SELECT TO authenticated
USING (
  buyer_user_id = core.current_user_id()
  or exists (
    select 1 from market.listings l
    where l.id = listing_id
      and l.seller_user_id = core.current_user_id()
  )
);

DROP POLICY IF EXISTS market_listing_items_admin_read ON market.listing_items;
CREATE POLICY market_listing_items_admin_read ON market.listing_items
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS market_orders_select_party ON market.orders;
CREATE POLICY market_orders_select_party ON market.orders
FOR SELECT TO authenticated
USING (buyer_user_id = core.current_user_id() OR seller_user_id = core.current_user_id());

DROP POLICY IF EXISTS market_orders_admin_read ON market.orders;
CREATE POLICY market_orders_admin_read ON market.orders
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS market_order_items_select_party ON market.order_items;
CREATE POLICY market_order_items_select_party ON market.order_items
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from market.orders o
    where o.id = order_id
      and (o.buyer_user_id = core.current_user_id() or o.seller_user_id = core.current_user_id())
  )
);

DROP POLICY IF EXISTS market_order_items_admin_read ON market.order_items;
CREATE POLICY market_order_items_admin_read ON market.order_items
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS market_listing_events_select_party ON market.listing_events;
CREATE POLICY market_listing_events_select_party ON market.listing_events
FOR SELECT TO authenticated
USING (
  user_id = core.current_user_id()
  or exists (
    select 1 from market.listings l
    where l.id = listing_id
      and l.seller_user_id = core.current_user_id()
  )
);

DROP POLICY IF EXISTS market_listing_events_admin_read ON market.listing_events;
CREATE POLICY market_listing_events_admin_read ON market.listing_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS market_price_snapshots_read_public ON market.price_snapshots;
CREATE POLICY market_price_snapshots_read_public ON market.price_snapshots
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS market_depth_snapshots_read_public ON market.depth_snapshots;
CREATE POLICY market_depth_snapshots_read_public ON market.depth_snapshots
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS market_price_health_rules_read_active ON market.price_health_rules;
CREATE POLICY market_price_health_rules_read_active ON market.price_health_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS market_price_health_rules_admin_read ON market.price_health_rules;
CREATE POLICY market_price_health_rules_admin_read ON market.price_health_rules
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read'));

DROP POLICY IF EXISTS market_price_health_rules_admin_write ON market.price_health_rules;
CREATE POLICY market_price_health_rules_admin_write ON market.price_health_rules
FOR ALL TO authenticated
USING (ops.has_admin_permission('market:write'))
WITH CHECK (ops.has_admin_permission('market:write'));

DROP POLICY IF EXISTS market_fee_settlements_select_party ON market.fee_settlements;
CREATE POLICY market_fee_settlements_select_party ON market.fee_settlements
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from market.orders o
    where o.id = market_order_id
      and (o.buyer_user_id = core.current_user_id() or o.seller_user_id = core.current_user_id())
  )
);

DROP POLICY IF EXISTS market_fee_settlements_admin_read ON market.fee_settlements;
CREATE POLICY market_fee_settlements_admin_read ON market.fee_settlements
FOR SELECT TO authenticated
USING (ops.has_admin_permission('market:read') OR ops.has_admin_permission('economy:read'));


