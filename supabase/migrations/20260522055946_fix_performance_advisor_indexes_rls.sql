-- Fix high-priority Supabase performance advisor findings.
-- Scope:
-- 1. Add covering indexes for the first-stage foreign-key columns that are
--    missing a leftmost btree index.
-- 2. Remove the optional direct-admin authenticated RLS policies that conflict
--    with the project boundary: admin app -> Vercel API -> service_role/RPC.
-- 3. Merge the authenticated marketplace listing read rules into one policy.

-- First-stage FK/index advisor fixes.
-- Existing indexes already cover:
-- core.app_sessions.session_token_hash via unique constraint
-- core.app_sessions.user_id
-- economy.user_balances.user_id
-- economy.currency_ledger.user_id
-- gacha.draw_orders.user_id
-- gacha.draw_results.draw_order_id
-- gacha.draw_results.user_id
-- gacha.user_pity_states.user_id
-- inventory.item_instances.owner_user_id
-- inventory.item_instances.template_id
-- inventory.item_instance_events.item_instance_id

create index if not exists draw_orders_box_created_idx
  on gacha.draw_orders (box_id, created_at desc);

create index if not exists draw_orders_pool_version_created_idx
  on gacha.draw_orders (pool_version_id, created_at desc);

create index if not exists draw_results_item_instance_idx
  on gacha.draw_results (item_instance_id);

create index if not exists user_pity_states_box_idx
  on gacha.user_pity_states (box_id);

create index if not exists item_instance_events_user_created_idx
  on inventory.item_instance_events (user_id, created_at desc);

-- The project uses backend admin APIs with service_role. Drop optional direct
-- admin RLS policies for authenticated clients so each table/action has a
-- single permissive policy path and Supabase does not evaluate redundant admin
-- predicates on user-facing reads.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in (
      'core',
      'economy',
      'catalog',
      'gacha',
      'inventory',
      'market',
      'payments',
      'tasks',
      'album',
      'onchain',
      'ops'
    )
      and (
        policyname like '%\_admin\_read' escape '\'
        or policyname like '%\_admin\_write' escape '\'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

-- Keep direct Supabase roles read-only. Mutations must go through Vercel API,
-- requireAdmin/requireSession, and service_role-backed RPC/functions.
revoke insert, update, delete, truncate
  on all tables in schema core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops
  from anon, authenticated;

-- market.listings had separate authenticated policies for public active rows
-- and seller-owned rows. Combine them so authenticated SELECT has one
-- permissive policy while anon keeps a public-active-only policy.
drop policy if exists market_listings_read_active_or_own on market.listings;
drop policy if exists market_listings_read_public on market.listings;
drop policy if exists market_listings_select_own on market.listings;
drop policy if exists market_listings_read_anon_active on market.listings;
drop policy if exists market_listings_read_authenticated_active_or_own on market.listings;

create policy market_listings_read_anon_active
on market.listings
for select
to anon
using (status in ('active', 'partially_sold'));

create policy market_listings_read_authenticated_active_or_own
on market.listings
for select
to authenticated
using (
  status in ('active', 'partially_sold')
  or seller_user_id = core.current_user_id()
);
