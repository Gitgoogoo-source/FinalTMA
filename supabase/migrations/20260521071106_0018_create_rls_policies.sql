-- 0018_create_rls_policies.sql
-- Row Level Security and grants. Core business writes are not granted to anon/authenticated; they must go through Vercel API with service role.

-- Schema usage grants for read paths. Mutations remain revoked from anon/authenticated.
grant usage on schema public to anon, authenticated;
grant usage on schema core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain to authenticated;
grant usage on schema catalog, gacha, market, album to anon;
grant usage on schema api to service_role;

-- CORE
alter table core.users enable row level security;
alter table core.user_profiles enable row level security;
alter table core.app_sessions enable row level security;
alter table core.user_devices enable row level security;
alter table core.user_wallets enable row level security;
alter table core.wallet_proofs enable row level security;
alter table core.user_flags enable row level security;
alter table core.notifications enable row level security;
alter table core.user_api_tokens enable row level security;

create policy core_users_select_own on core.users for select to authenticated using (id = core.current_user_id());
create policy core_profiles_select_own on core.user_profiles for select to authenticated using (user_id = core.current_user_id());
create policy core_sessions_select_own on core.app_sessions for select to authenticated using (user_id = core.current_user_id());
create policy core_devices_select_own on core.user_devices for select to authenticated using (user_id = core.current_user_id());
create policy core_wallets_select_own on core.user_wallets for select to authenticated using (user_id = core.current_user_id());
create policy core_wallet_proofs_select_own on core.wallet_proofs for select to authenticated using (user_id = core.current_user_id());
create policy core_flags_select_own on core.user_flags for select to authenticated using (user_id = core.current_user_id());
create policy core_notifications_select_own on core.notifications for select to authenticated using (user_id = core.current_user_id());
create policy core_tokens_select_own on core.user_api_tokens for select to authenticated using (user_id = core.current_user_id());

-- ECONOMY
alter table economy.currencies enable row level security;
alter table economy.user_balances enable row level security;
alter table economy.currency_ledger enable row level security;
alter table economy.balance_locks enable row level security;
alter table economy.reward_rules enable row level security;
alter table economy.fee_rules enable row level security;
alter table economy.reconciliation_runs enable row level security;

create policy economy_currencies_read on economy.currencies for select to anon, authenticated using (true);
create policy economy_balances_select_own on economy.user_balances for select to authenticated using (user_id = core.current_user_id());
create policy economy_ledger_select_own on economy.currency_ledger for select to authenticated using (user_id = core.current_user_id());
create policy economy_locks_select_own on economy.balance_locks for select to authenticated using (user_id = core.current_user_id());
create policy economy_reward_rules_read_active on economy.reward_rules for select to authenticated using (active = true);
create policy economy_fee_rules_read_active on economy.fee_rules for select to authenticated using (active = true);

-- CATALOG
alter table catalog.rarities enable row level security;
alter table catalog.item_types enable row level security;
alter table catalog.series enable row level security;
alter table catalog.factions enable row level security;
alter table catalog.collectible_templates enable row level security;
alter table catalog.collectible_forms enable row level security;
alter table catalog.collectible_media enable row level security;
alter table catalog.power_rules enable row level security;
alter table catalog.market_price_rules enable row level security;
alter table catalog.item_tags enable row level security;
alter table catalog.template_tags enable row level security;
alter table catalog.banner_campaigns enable row level security;

create policy catalog_rarities_read on catalog.rarities for select to anon, authenticated using (true);
create policy catalog_item_types_read on catalog.item_types for select to anon, authenticated using (true);
create policy catalog_series_read_active on catalog.series for select to anon, authenticated using (status in ('active', 'hidden'));
create policy catalog_factions_read on catalog.factions for select to anon, authenticated using (true);
create policy catalog_templates_read_active on catalog.collectible_templates for select to anon, authenticated using (release_status in ('active', 'hidden'));
create policy catalog_forms_read on catalog.collectible_forms for select to anon, authenticated using (true);
create policy catalog_media_read on catalog.collectible_media for select to anon, authenticated using (true);
create policy catalog_power_rules_read_active on catalog.power_rules for select to authenticated using (active = true);
create policy catalog_market_price_rules_read_active on catalog.market_price_rules for select to authenticated using (active = true);
create policy catalog_item_tags_read on catalog.item_tags for select to anon, authenticated using (true);
create policy catalog_template_tags_read on catalog.template_tags for select to anon, authenticated using (true);
create policy catalog_banners_read_active on catalog.banner_campaigns for select to anon, authenticated using (status = 'active' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));

-- GACHA
alter table gacha.blind_boxes enable row level security;
alter table gacha.box_price_rules enable row level security;
alter table gacha.drop_pool_versions enable row level security;
alter table gacha.drop_pool_items enable row level security;
alter table gacha.pity_rules enable row level security;
alter table gacha.user_pity_states enable row level security;
alter table gacha.draw_orders enable row level security;
alter table gacha.draw_results enable row level security;
alter table gacha.draw_audit enable row level security;

create policy gacha_boxes_read_public on gacha.blind_boxes for select to anon, authenticated using (status in ('not_started', 'active', 'paused', 'sold_out'));
create policy gacha_price_rules_read_active on gacha.box_price_rules for select to anon, authenticated using (active = true);
create policy gacha_pool_versions_read_active on gacha.drop_pool_versions for select to anon, authenticated using (status = 'active');
create policy gacha_pool_items_read_active on gacha.drop_pool_items for select to anon, authenticated using (exists (select 1 from gacha.drop_pool_versions v where v.id = pool_version_id and v.status = 'active'));
create policy gacha_pity_rules_read_active on gacha.pity_rules for select to authenticated using (active = true);
create policy gacha_user_pity_select_own on gacha.user_pity_states for select to authenticated using (user_id = core.current_user_id());
create policy gacha_draw_orders_select_own on gacha.draw_orders for select to authenticated using (user_id = core.current_user_id());
create policy gacha_draw_results_select_own on gacha.draw_results for select to authenticated using (user_id = core.current_user_id());

-- INVENTORY
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

create policy inventory_items_select_own on inventory.item_instances for select to authenticated using (owner_user_id = core.current_user_id());
create policy inventory_locks_select_own on inventory.inventory_locks for select to authenticated using (user_id = core.current_user_id());
create policy inventory_events_select_own on inventory.item_instance_events for select to authenticated using (user_id = core.current_user_id());
create policy inventory_upgrade_rules_read_active on inventory.upgrade_rules for select to authenticated using (active = true);
create policy inventory_upgrade_logs_select_own on inventory.upgrade_logs for select to authenticated using (user_id = core.current_user_id());
create policy inventory_evolution_rules_read_active on inventory.evolution_rules for select to authenticated using (active = true);
create policy inventory_evolution_attempts_select_own on inventory.evolution_attempts for select to authenticated using (user_id = core.current_user_id());
create policy inventory_decompose_rules_read_active on inventory.decompose_rules for select to authenticated using (active = true);
create policy inventory_decompose_logs_select_own on inventory.decompose_logs for select to authenticated using (user_id = core.current_user_id());

-- MARKET
alter table market.listings enable row level security;
alter table market.listing_items enable row level security;
alter table market.orders enable row level security;
alter table market.order_items enable row level security;
alter table market.listing_events enable row level security;
alter table market.price_snapshots enable row level security;
alter table market.depth_snapshots enable row level security;
alter table market.price_health_rules enable row level security;
alter table market.fee_settlements enable row level security;

create policy market_listings_read_active_or_own on market.listings for select to authenticated using (status in ('active', 'partially_sold') or seller_user_id = core.current_user_id());
create policy market_listings_read_public on market.listings for select to anon using (status in ('active', 'partially_sold'));
create policy market_listing_items_select_owner_or_buyer on market.listing_items for select to authenticated using (
  exists (select 1 from market.listings l where l.id = listing_id and l.seller_user_id = core.current_user_id())
  or buyer_user_id = core.current_user_id()
);
create policy market_orders_select_party on market.orders for select to authenticated using (buyer_user_id = core.current_user_id() or seller_user_id = core.current_user_id());
create policy market_order_items_select_party on market.order_items for select to authenticated using (
  exists (select 1 from market.orders o where o.id = order_id and (o.buyer_user_id = core.current_user_id() or o.seller_user_id = core.current_user_id()))
);
create policy market_listing_events_select_party on market.listing_events for select to authenticated using (
  exists (select 1 from market.listings l where l.id = listing_id and l.seller_user_id = core.current_user_id())
);
create policy market_price_snapshots_read on market.price_snapshots for select to anon, authenticated using (true);
create policy market_depth_snapshots_read on market.depth_snapshots for select to anon, authenticated using (true);
create policy market_price_health_rules_read_active on market.price_health_rules for select to authenticated using (active = true);

-- PAYMENTS
alter table payments.star_orders enable row level security;
alter table payments.star_invoices enable row level security;
alter table payments.star_payments enable row level security;
alter table payments.telegram_webhook_events enable row level security;
alter table payments.star_refunds enable row level security;
alter table payments.payment_disputes enable row level security;

create policy payments_star_orders_select_own on payments.star_orders for select to authenticated using (user_id = core.current_user_id());
create policy payments_star_invoices_select_own on payments.star_invoices for select to authenticated using (exists (select 1 from payments.star_orders so where so.id = star_order_id and so.user_id = core.current_user_id()));
create policy payments_star_payments_select_own on payments.star_payments for select to authenticated using (user_id = core.current_user_id());
create policy payments_refunds_select_own on payments.star_refunds for select to authenticated using (user_id = core.current_user_id());
create policy payments_disputes_select_own on payments.payment_disputes for select to authenticated using (user_id = core.current_user_id());

-- TASKS
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

create policy tasks_definitions_read_active on tasks.task_definitions for select to authenticated using (active = true);
create policy tasks_periods_read_active on tasks.task_periods for select to authenticated using (active = true);
create policy tasks_progress_select_own on tasks.user_task_progress for select to authenticated using (user_id = core.current_user_id());
create policy tasks_claims_select_own on tasks.task_claims for select to authenticated using (user_id = core.current_user_id());
create policy tasks_signin_campaigns_read_active on tasks.signin_campaigns for select to authenticated using (active = true);
create policy tasks_signin_days_read on tasks.signin_days for select to authenticated using (true);
create policy tasks_user_signins_select_own on tasks.user_signins for select to authenticated using (user_id = core.current_user_id());
create policy tasks_referrals_select_party on tasks.referrals for select to authenticated using (inviter_user_id = core.current_user_id() or invitee_user_id = core.current_user_id());
create policy tasks_referral_rewards_select_own on tasks.referral_rewards for select to authenticated using (user_id = core.current_user_id());
create policy tasks_commissions_select_inviter on tasks.referral_commissions for select to authenticated using (inviter_user_id = core.current_user_id());
create policy tasks_share_events_select_own on tasks.share_events for select to authenticated using (user_id = core.current_user_id());

-- ALBUM
alter table album.books enable row level security;
alter table album.book_items enable row level security;
alter table album.user_discoveries enable row level security;
alter table album.milestones enable row level security;
alter table album.milestone_claims enable row level security;
alter table album.weekly_leaderboards enable row level security;
alter table album.leaderboard_entries enable row level security;
alter table album.score_rules enable row level security;

create policy album_books_read_active on album.books for select to anon, authenticated using (active = true);
create policy album_book_items_read on album.book_items for select to anon, authenticated using (true);
create policy album_discoveries_select_own on album.user_discoveries for select to authenticated using (user_id = core.current_user_id());
create policy album_milestones_read_active on album.milestones for select to authenticated using (active = true);
create policy album_milestone_claims_select_own on album.milestone_claims for select to authenticated using (user_id = core.current_user_id());
create policy album_weekly_leaderboards_read on album.weekly_leaderboards for select to anon, authenticated using (status in ('active', 'settled'));
create policy album_leaderboard_entries_read on album.leaderboard_entries for select to anon, authenticated using (true);
create policy album_score_rules_read_active on album.score_rules for select to authenticated using (active = true);

-- ONCHAIN
alter table onchain.nft_collections enable row level security;
alter table onchain.nft_items enable row level security;
alter table onchain.mint_queue enable row level security;
alter table onchain.transactions enable row level security;
alter table onchain.wallet_sync_jobs enable row level security;
alter table onchain.wallet_nft_snapshots enable row level security;

create policy onchain_collections_read_active on onchain.nft_collections for select to authenticated using (status = 'active');
create policy onchain_nft_items_select_own on onchain.nft_items for select to authenticated using (owner_user_id = core.current_user_id());
create policy onchain_mint_queue_select_own on onchain.mint_queue for select to authenticated using (user_id = core.current_user_id());
create policy onchain_transactions_select_own on onchain.transactions for select to authenticated using (user_id = core.current_user_id());
create policy onchain_wallet_sync_jobs_select_own on onchain.wallet_sync_jobs for select to authenticated using (user_id = core.current_user_id());
create policy onchain_wallet_nft_snapshots_select_own on onchain.wallet_nft_snapshots for select to authenticated using (user_id = core.current_user_id());

-- OPS: RLS enabled, no public policies. Admin access should go through trusted backend service role.
alter table ops.admin_roles enable row level security;
alter table ops.admin_users enable row level security;
alter table ops.admin_user_roles enable row level security;
alter table ops.admin_audit_logs enable row level security;
alter table ops.feature_flags enable row level security;
alter table ops.system_settings enable row level security;
alter table ops.risk_events enable row level security;
alter table ops.idempotency_keys enable row level security;
alter table ops.api_rate_limits enable row level security;
alter table ops.support_tickets enable row level security;
alter table ops.app_events enable row level security;

-- View grants.
grant select on public.v_collectible_catalog to anon, authenticated;
grant select on public.v_active_boxes to anon, authenticated;
grant select on public.v_box_rewards to anon, authenticated;
grant select on public.v_market_listings to anon, authenticated;
grant select on public.v_market_price_summary to anon, authenticated;
grant select on public.v_album_books to anon, authenticated;
grant select on public.v_weekly_leaderboard to anon, authenticated;
grant select on public.v_user_asset_summary to authenticated;
grant select on public.v_user_inventory to authenticated;
grant select on public.v_user_task_status to authenticated;

-- Table read grants where RLS controls access.
grant select on all tables in schema core to authenticated;
grant select on all tables in schema economy to authenticated;
grant select on all tables in schema catalog to anon, authenticated;
grant select on all tables in schema gacha to anon, authenticated;
grant select on all tables in schema inventory to authenticated;
grant select on all tables in schema market to anon, authenticated;
grant select on all tables in schema payments to authenticated;
grant select on all tables in schema tasks to authenticated;
grant select on all tables in schema album to anon, authenticated;
grant select on all tables in schema onchain to authenticated;

-- Mutations and RPC are backend-only.
revoke insert, update, delete, truncate on all tables in schema core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops from anon, authenticated;
revoke execute on all functions in schema api from anon, authenticated;
grant execute on all functions in schema api to service_role;
