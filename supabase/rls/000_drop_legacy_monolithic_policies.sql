-- rls_all.sql
-- Combined Row Level Security policies. Execute after migrations 0001-0019.

-- 000_drop_legacy_monolithic_policies.sql
-- Drops policy names created by an earlier monolithic 0018_create_rls_policies.sql.
-- Safe to run even if the old migration was never applied, because every line uses DROP POLICY IF EXISTS.

DROP POLICY IF EXISTS core_users_select_own ON core.users;
DROP POLICY IF EXISTS core_profiles_select_own ON core.user_profiles;
DROP POLICY IF EXISTS core_sessions_select_own ON core.app_sessions;
DROP POLICY IF EXISTS core_devices_select_own ON core.user_devices;
DROP POLICY IF EXISTS core_wallets_select_own ON core.user_wallets;
DROP POLICY IF EXISTS core_wallet_proofs_select_own ON core.wallet_proofs;
DROP POLICY IF EXISTS core_flags_select_own ON core.user_flags;
DROP POLICY IF EXISTS core_notifications_select_own ON core.notifications;
DROP POLICY IF EXISTS core_tokens_select_own ON core.user_api_tokens;
DROP POLICY IF EXISTS economy_currencies_read ON economy.currencies;
DROP POLICY IF EXISTS economy_balances_select_own ON economy.user_balances;
DROP POLICY IF EXISTS economy_ledger_select_own ON economy.currency_ledger;
DROP POLICY IF EXISTS economy_locks_select_own ON economy.balance_locks;
DROP POLICY IF EXISTS economy_reward_rules_read_active ON economy.reward_rules;
DROP POLICY IF EXISTS economy_fee_rules_read_active ON economy.fee_rules;
DROP POLICY IF EXISTS catalog_rarities_read ON catalog.rarities;
DROP POLICY IF EXISTS catalog_item_types_read ON catalog.item_types;
DROP POLICY IF EXISTS catalog_series_read_active ON catalog.series;
DROP POLICY IF EXISTS catalog_factions_read ON catalog.factions;
DROP POLICY IF EXISTS catalog_templates_read_active ON catalog.collectible_templates;
DROP POLICY IF EXISTS catalog_forms_read ON catalog.collectible_forms;
DROP POLICY IF EXISTS catalog_media_read ON catalog.collectible_media;
DROP POLICY IF EXISTS catalog_power_rules_read_active ON catalog.power_rules;
DROP POLICY IF EXISTS catalog_market_price_rules_read_active ON catalog.market_price_rules;
DROP POLICY IF EXISTS catalog_item_tags_read ON catalog.item_tags;
DROP POLICY IF EXISTS catalog_template_tags_read ON catalog.template_tags;
DROP POLICY IF EXISTS catalog_banners_read_active ON catalog.banner_campaigns;
DROP POLICY IF EXISTS gacha_boxes_read_public ON gacha.blind_boxes;
DROP POLICY IF EXISTS gacha_price_rules_read_active ON gacha.box_price_rules;
DROP POLICY IF EXISTS gacha_pool_versions_read_active ON gacha.drop_pool_versions;
DROP POLICY IF EXISTS gacha_pool_items_read_active ON gacha.drop_pool_items;
DROP POLICY IF EXISTS gacha_pity_rules_read_active ON gacha.pity_rules;
DROP POLICY IF EXISTS gacha_user_pity_select_own ON gacha.user_pity_states;
DROP POLICY IF EXISTS gacha_draw_orders_select_own ON gacha.draw_orders;
DROP POLICY IF EXISTS gacha_draw_results_select_own ON gacha.draw_results;
DROP POLICY IF EXISTS inventory_items_select_own ON inventory.item_instances;
DROP POLICY IF EXISTS inventory_locks_select_own ON inventory.inventory_locks;
DROP POLICY IF EXISTS inventory_events_select_own ON inventory.item_instance_events;
DROP POLICY IF EXISTS inventory_upgrade_rules_read_active ON inventory.upgrade_rules;
DROP POLICY IF EXISTS inventory_upgrade_logs_select_own ON inventory.upgrade_logs;
DROP POLICY IF EXISTS inventory_evolution_rules_read_active ON inventory.evolution_rules;
DROP POLICY IF EXISTS inventory_evolution_attempts_select_own ON inventory.evolution_attempts;
DROP POLICY IF EXISTS inventory_decompose_rules_read_active ON inventory.decompose_rules;
DROP POLICY IF EXISTS inventory_decompose_logs_select_own ON inventory.decompose_logs;
DROP POLICY IF EXISTS market_listings_read_active_or_own ON market.listings;
DROP POLICY IF EXISTS market_listings_read_public ON market.listings;
DROP POLICY IF EXISTS market_listing_items_select_owner_or_buyer ON market.listing_items;
DROP POLICY IF EXISTS market_orders_select_party ON market.orders;
DROP POLICY IF EXISTS market_order_items_select_party ON market.order_items;
DROP POLICY IF EXISTS market_listing_events_select_party ON market.listing_events;
DROP POLICY IF EXISTS market_price_snapshots_read ON market.price_snapshots;
DROP POLICY IF EXISTS market_depth_snapshots_read ON market.depth_snapshots;
DROP POLICY IF EXISTS market_price_health_rules_read_active ON market.price_health_rules;
DROP POLICY IF EXISTS payments_star_orders_select_own ON payments.star_orders;
DROP POLICY IF EXISTS payments_star_invoices_select_own ON payments.star_invoices;
DROP POLICY IF EXISTS payments_star_payments_select_own ON payments.star_payments;
DROP POLICY IF EXISTS payments_refunds_select_own ON payments.star_refunds;
DROP POLICY IF EXISTS payments_disputes_select_own ON payments.payment_disputes;
DROP POLICY IF EXISTS tasks_definitions_read_active ON tasks.task_definitions;
DROP POLICY IF EXISTS tasks_periods_read_active ON tasks.task_periods;
DROP POLICY IF EXISTS tasks_progress_select_own ON tasks.user_task_progress;
DROP POLICY IF EXISTS tasks_claims_select_own ON tasks.task_claims;
DROP POLICY IF EXISTS tasks_signin_campaigns_read_active ON tasks.signin_campaigns;
DROP POLICY IF EXISTS tasks_signin_days_read ON tasks.signin_days;
DROP POLICY IF EXISTS tasks_user_signins_select_own ON tasks.user_signins;
DROP POLICY IF EXISTS tasks_referrals_select_party ON tasks.referrals;
DROP POLICY IF EXISTS tasks_referral_rewards_select_own ON tasks.referral_rewards;
DROP POLICY IF EXISTS tasks_commissions_select_inviter ON tasks.referral_commissions;
DROP POLICY IF EXISTS tasks_share_events_select_own ON tasks.share_events;
DROP POLICY IF EXISTS album_books_read_active ON album.books;
DROP POLICY IF EXISTS album_book_items_read ON album.book_items;
DROP POLICY IF EXISTS album_discoveries_select_own ON album.user_discoveries;
DROP POLICY IF EXISTS album_milestones_read_active ON album.milestones;
DROP POLICY IF EXISTS album_milestone_claims_select_own ON album.milestone_claims;
DROP POLICY IF EXISTS album_weekly_leaderboards_read ON album.weekly_leaderboards;
DROP POLICY IF EXISTS album_leaderboard_entries_read ON album.leaderboard_entries;
DROP POLICY IF EXISTS album_score_rules_read_active ON album.score_rules;
DROP POLICY IF EXISTS onchain_collections_read_active ON onchain.nft_collections;
DROP POLICY IF EXISTS onchain_nft_items_select_own ON onchain.nft_items;
DROP POLICY IF EXISTS onchain_mint_queue_select_own ON onchain.mint_queue;
DROP POLICY IF EXISTS onchain_transactions_select_own ON onchain.transactions;
DROP POLICY IF EXISTS onchain_wallet_sync_jobs_select_own ON onchain.wallet_sync_jobs;
DROP POLICY IF EXISTS onchain_wallet_nft_snapshots_select_own ON onchain.wallet_nft_snapshots;


