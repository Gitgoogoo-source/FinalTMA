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
  core.app_sessions,
  core.user_devices,
  core.user_wallets,
  core.wallet_proofs,
  core.user_flags,
  core.notifications,
  core.user_api_tokens
to authenticated;

-- Optional direct admin management through Supabase JWT with admin_user_id claim.
-- Normal users still cannot mutate these tables because admin policies require ops.has_admin_permission().
grant insert, update, delete on table
  core.users,
  core.user_profiles,
  core.app_sessions,
  core.user_devices,
  core.user_wallets,
  core.wallet_proofs,
  core.user_flags,
  core.notifications,
  core.user_api_tokens
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

-- core.app_sessions
DROP POLICY IF EXISTS core_sessions_select_own ON core.app_sessions;
CREATE POLICY core_sessions_select_own ON core.app_sessions
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_sessions_admin_read ON core.app_sessions;
CREATE POLICY core_sessions_admin_read ON core.app_sessions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS core_sessions_admin_write ON core.app_sessions;
CREATE POLICY core_sessions_admin_write ON core.app_sessions
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write'))
WITH CHECK (ops.has_admin_permission('core:write'));

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

-- core.user_api_tokens
DROP POLICY IF EXISTS core_tokens_select_own ON core.user_api_tokens;
CREATE POLICY core_tokens_select_own ON core.user_api_tokens
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS core_tokens_admin_read ON core.user_api_tokens;
CREATE POLICY core_tokens_admin_read ON core.user_api_tokens
FOR SELECT TO authenticated
USING (ops.has_admin_permission('core:read'));

DROP POLICY IF EXISTS core_tokens_admin_write ON core.user_api_tokens;
CREATE POLICY core_tokens_admin_write ON core.user_api_tokens
FOR ALL TO authenticated
USING (ops.has_admin_permission('core:write'))
WITH CHECK (ops.has_admin_permission('core:write'));


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


-- catalog.policies.sql
-- RLS for public collectible catalog and admin-managed game configuration.

grant usage on schema catalog to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema catalog from anon, authenticated;
grant all privileges on all tables in schema catalog to service_role;

grant select on all tables in schema catalog to anon, authenticated;
grant select on public.v_collectible_catalog to anon, authenticated;

-- Admin direct writes are allowed only for JWTs with catalog:write.
grant insert, update, delete on all tables in schema catalog to authenticated;

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

DROP POLICY IF EXISTS catalog_rarities_read_public ON catalog.rarities;
CREATE POLICY catalog_rarities_read_public ON catalog.rarities
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_item_types_read_public ON catalog.item_types;
CREATE POLICY catalog_item_types_read_public ON catalog.item_types
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_series_read_public ON catalog.series;
CREATE POLICY catalog_series_read_public ON catalog.series
FOR SELECT TO anon, authenticated
USING (
  status in ('active', 'hidden')
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS catalog_factions_read_public ON catalog.factions;
CREATE POLICY catalog_factions_read_public ON catalog.factions
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_templates_read_public ON catalog.collectible_templates;
CREATE POLICY catalog_templates_read_public ON catalog.collectible_templates
FOR SELECT TO anon, authenticated
USING (release_status in ('active', 'hidden'));

DROP POLICY IF EXISTS catalog_forms_read_public ON catalog.collectible_forms;
CREATE POLICY catalog_forms_read_public ON catalog.collectible_forms
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_media_read_public ON catalog.collectible_media;
CREATE POLICY catalog_media_read_public ON catalog.collectible_media
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_power_rules_read_active ON catalog.power_rules;
CREATE POLICY catalog_power_rules_read_active ON catalog.power_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS catalog_market_price_rules_read_active ON catalog.market_price_rules;
CREATE POLICY catalog_market_price_rules_read_active ON catalog.market_price_rules
FOR SELECT TO authenticated
USING (active = true);

DROP POLICY IF EXISTS catalog_item_tags_read_public ON catalog.item_tags;
CREATE POLICY catalog_item_tags_read_public ON catalog.item_tags
FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS catalog_template_tags_read_public ON catalog.template_tags;
CREATE POLICY catalog_template_tags_read_public ON catalog.template_tags
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from catalog.collectible_templates t
    where t.id = template_id
      and t.release_status in ('active', 'hidden')
  )
);

DROP POLICY IF EXISTS catalog_banners_read_public ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_read_public ON catalog.banner_campaigns
FOR SELECT TO anon, authenticated
USING (
  status = 'active'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

-- Admin read for draft/retired catalog records.
DROP POLICY IF EXISTS catalog_all_admin_read ON catalog.rarities;
CREATE POLICY catalog_all_admin_read ON catalog.rarities FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_item_types_admin_read ON catalog.item_types;
CREATE POLICY catalog_item_types_admin_read ON catalog.item_types FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_series_admin_read ON catalog.series;
CREATE POLICY catalog_series_admin_read ON catalog.series FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_factions_admin_read ON catalog.factions;
CREATE POLICY catalog_factions_admin_read ON catalog.factions FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_templates_admin_read ON catalog.collectible_templates;
CREATE POLICY catalog_templates_admin_read ON catalog.collectible_templates FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_forms_admin_read ON catalog.collectible_forms;
CREATE POLICY catalog_forms_admin_read ON catalog.collectible_forms FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_media_admin_read ON catalog.collectible_media;
CREATE POLICY catalog_media_admin_read ON catalog.collectible_media FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_power_rules_admin_read ON catalog.power_rules;
CREATE POLICY catalog_power_rules_admin_read ON catalog.power_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_market_price_rules_admin_read ON catalog.market_price_rules;
CREATE POLICY catalog_market_price_rules_admin_read ON catalog.market_price_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read') OR ops.has_admin_permission('market:read'));
DROP POLICY IF EXISTS catalog_item_tags_admin_read ON catalog.item_tags;
CREATE POLICY catalog_item_tags_admin_read ON catalog.item_tags FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_template_tags_admin_read ON catalog.template_tags;
CREATE POLICY catalog_template_tags_admin_read ON catalog.template_tags FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));
DROP POLICY IF EXISTS catalog_banners_admin_read ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_admin_read ON catalog.banner_campaigns FOR SELECT TO authenticated USING (ops.has_admin_permission('catalog:read'));

-- Admin write policies.
DROP POLICY IF EXISTS catalog_rarities_admin_write ON catalog.rarities;
CREATE POLICY catalog_rarities_admin_write ON catalog.rarities FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_item_types_admin_write ON catalog.item_types;
CREATE POLICY catalog_item_types_admin_write ON catalog.item_types FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_series_admin_write ON catalog.series;
CREATE POLICY catalog_series_admin_write ON catalog.series FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_factions_admin_write ON catalog.factions;
CREATE POLICY catalog_factions_admin_write ON catalog.factions FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_templates_admin_write ON catalog.collectible_templates;
CREATE POLICY catalog_templates_admin_write ON catalog.collectible_templates FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_forms_admin_write ON catalog.collectible_forms;
CREATE POLICY catalog_forms_admin_write ON catalog.collectible_forms FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_media_admin_write ON catalog.collectible_media;
CREATE POLICY catalog_media_admin_write ON catalog.collectible_media FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_power_rules_admin_write ON catalog.power_rules;
CREATE POLICY catalog_power_rules_admin_write ON catalog.power_rules FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_market_rules_admin_write ON catalog.market_price_rules;
CREATE POLICY catalog_market_rules_admin_write ON catalog.market_price_rules FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write') OR ops.has_admin_permission('market:write')) WITH CHECK (ops.has_admin_permission('catalog:write') OR ops.has_admin_permission('market:write'));
DROP POLICY IF EXISTS catalog_item_tags_admin_write ON catalog.item_tags;
CREATE POLICY catalog_item_tags_admin_write ON catalog.item_tags FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_template_tags_admin_write ON catalog.template_tags;
CREATE POLICY catalog_template_tags_admin_write ON catalog.template_tags FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));
DROP POLICY IF EXISTS catalog_banners_admin_write ON catalog.banner_campaigns;
CREATE POLICY catalog_banners_admin_write ON catalog.banner_campaigns FOR ALL TO authenticated USING (ops.has_admin_permission('catalog:write')) WITH CHECK (ops.has_admin_permission('catalog:write'));


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


-- tasks.policies.sql
-- RLS for tasks, 7-day sign-in, referrals, commissions and share events.

grant usage on schema tasks to authenticated, service_role;
grant usage on schema public to authenticated, service_role;
revoke all on all tables in schema tasks from anon, authenticated;
grant all privileges on all tables in schema tasks to service_role;

grant select on all tables in schema tasks to authenticated;
grant select on public.v_user_task_status to authenticated;

-- User share events may be inserted directly if you want lightweight tracking from the Mini App.
-- Core progress/reward tables remain RPC/service-only.
grant insert on table tasks.share_events to authenticated;

grant insert, update, delete on table
  tasks.task_definitions,
  tasks.task_periods,
  tasks.signin_campaigns,
  tasks.signin_days
to authenticated;

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

DROP POLICY IF EXISTS tasks_definitions_read_active ON tasks.task_definitions;
CREATE POLICY tasks_definitions_read_active ON tasks.task_definitions
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS tasks_definitions_admin_read ON tasks.task_definitions;
CREATE POLICY tasks_definitions_admin_read ON tasks.task_definitions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_definitions_admin_write ON tasks.task_definitions;
CREATE POLICY tasks_definitions_admin_write ON tasks.task_definitions
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_periods_read_active ON tasks.task_periods;
CREATE POLICY tasks_periods_read_active ON tasks.task_periods
FOR SELECT TO authenticated
USING (active = true and starts_at <= now() and ends_at > now());

DROP POLICY IF EXISTS tasks_periods_admin_read ON tasks.task_periods;
CREATE POLICY tasks_periods_admin_read ON tasks.task_periods
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_periods_admin_write ON tasks.task_periods;
CREATE POLICY tasks_periods_admin_write ON tasks.task_periods
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_progress_select_own ON tasks.user_task_progress;
CREATE POLICY tasks_progress_select_own ON tasks.user_task_progress
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_progress_admin_read ON tasks.user_task_progress;
CREATE POLICY tasks_progress_admin_read ON tasks.user_task_progress
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_claims_select_own ON tasks.task_claims;
CREATE POLICY tasks_claims_select_own ON tasks.task_claims
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_claims_admin_read ON tasks.task_claims;
CREATE POLICY tasks_claims_admin_read ON tasks.task_claims
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_signin_campaigns_read_active ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_read_active ON tasks.signin_campaigns
FOR SELECT TO authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS tasks_signin_campaigns_admin_read ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_admin_read ON tasks.signin_campaigns
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_signin_campaigns_admin_write ON tasks.signin_campaigns;
CREATE POLICY tasks_signin_campaigns_admin_write ON tasks.signin_campaigns
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_signin_days_read_active ON tasks.signin_days;
CREATE POLICY tasks_signin_days_read_active ON tasks.signin_days
FOR SELECT TO authenticated
USING (
  exists (
    select 1 from tasks.signin_campaigns sc
    where sc.id = campaign_id
      and sc.active = true
      and (sc.starts_at is null or sc.starts_at <= now())
      and (sc.ends_at is null or sc.ends_at > now())
  )
);

DROP POLICY IF EXISTS tasks_signin_days_admin_read ON tasks.signin_days;
CREATE POLICY tasks_signin_days_admin_read ON tasks.signin_days
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read'));

DROP POLICY IF EXISTS tasks_signin_days_admin_write ON tasks.signin_days;
CREATE POLICY tasks_signin_days_admin_write ON tasks.signin_days
FOR ALL TO authenticated
USING (ops.has_admin_permission('tasks:write'))
WITH CHECK (ops.has_admin_permission('tasks:write'));

DROP POLICY IF EXISTS tasks_user_signins_select_own ON tasks.user_signins;
CREATE POLICY tasks_user_signins_select_own ON tasks.user_signins
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_user_signins_admin_read ON tasks.user_signins;
CREATE POLICY tasks_user_signins_admin_read ON tasks.user_signins
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_referrals_select_party ON tasks.referrals;
CREATE POLICY tasks_referrals_select_party ON tasks.referrals
FOR SELECT TO authenticated
USING (inviter_user_id = core.current_user_id() OR invitee_user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_referrals_admin_read ON tasks.referrals;
CREATE POLICY tasks_referrals_admin_read ON tasks.referrals
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_referral_rewards_select_own ON tasks.referral_rewards;
CREATE POLICY tasks_referral_rewards_select_own ON tasks.referral_rewards
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_referral_rewards_admin_read ON tasks.referral_rewards;
CREATE POLICY tasks_referral_rewards_admin_read ON tasks.referral_rewards
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_commissions_select_inviter ON tasks.referral_commissions;
CREATE POLICY tasks_commissions_select_inviter ON tasks.referral_commissions
FOR SELECT TO authenticated
USING (inviter_user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_commissions_admin_read ON tasks.referral_commissions;
CREATE POLICY tasks_commissions_admin_read ON tasks.referral_commissions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS tasks_share_events_select_own ON tasks.share_events;
CREATE POLICY tasks_share_events_select_own ON tasks.share_events
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_share_events_insert_own ON tasks.share_events;
CREATE POLICY tasks_share_events_insert_own ON tasks.share_events
FOR INSERT TO authenticated
WITH CHECK (user_id = core.current_user_id());

DROP POLICY IF EXISTS tasks_share_events_admin_read ON tasks.share_events;
CREATE POLICY tasks_share_events_admin_read ON tasks.share_events
FOR SELECT TO authenticated
USING (ops.has_admin_permission('tasks:read') OR ops.has_admin_permission('risk:read'));


-- album.policies.sql
-- RLS for collection album progress, milestones and weekly leaderboards.

grant usage on schema album to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
revoke all on all tables in schema album from anon, authenticated;
grant all privileges on all tables in schema album to service_role;

grant select on table
  album.books,
  album.book_items,
  album.milestones,
  album.weekly_leaderboards,
  album.leaderboard_entries,
  album.score_rules
to anon, authenticated;

grant select on table album.user_discoveries, album.milestone_claims to authenticated;
grant select on public.v_album_books to anon, authenticated;
grant select on public.v_weekly_leaderboard to anon, authenticated;

grant insert, update, delete on table
  album.books,
  album.book_items,
  album.milestones,
  album.weekly_leaderboards,
  album.leaderboard_entries,
  album.score_rules
to authenticated;

alter table album.books enable row level security;
alter table album.book_items enable row level security;
alter table album.user_discoveries enable row level security;
alter table album.milestones enable row level security;
alter table album.milestone_claims enable row level security;
alter table album.weekly_leaderboards enable row level security;
alter table album.leaderboard_entries enable row level security;
alter table album.score_rules enable row level security;

DROP POLICY IF EXISTS album_books_read_public ON album.books;
CREATE POLICY album_books_read_public ON album.books
FOR SELECT TO anon, authenticated
USING (
  active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at > now())
);

DROP POLICY IF EXISTS album_books_admin_read ON album.books;
CREATE POLICY album_books_admin_read ON album.books FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_books_admin_write ON album.books;
CREATE POLICY album_books_admin_write ON album.books FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_book_items_read_public ON album.book_items;
CREATE POLICY album_book_items_read_public ON album.book_items
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from album.books b
    where b.id = book_id
      and b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
  )
);

DROP POLICY IF EXISTS album_book_items_admin_read ON album.book_items;
CREATE POLICY album_book_items_admin_read ON album.book_items FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_book_items_admin_write ON album.book_items;
CREATE POLICY album_book_items_admin_write ON album.book_items FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_discoveries_select_own ON album.user_discoveries;
CREATE POLICY album_discoveries_select_own ON album.user_discoveries
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS album_discoveries_admin_read ON album.user_discoveries;
CREATE POLICY album_discoveries_admin_read ON album.user_discoveries
FOR SELECT TO authenticated
USING (ops.has_admin_permission('album:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS album_milestones_read_public ON album.milestones;
CREATE POLICY album_milestones_read_public ON album.milestones
FOR SELECT TO anon, authenticated
USING (
  active = true
  and exists (
    select 1 from album.books b
    where b.id = book_id
      and b.active = true
      and (b.starts_at is null or b.starts_at <= now())
      and (b.ends_at is null or b.ends_at > now())
  )
);

DROP POLICY IF EXISTS album_milestones_admin_read ON album.milestones;
CREATE POLICY album_milestones_admin_read ON album.milestones FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_milestones_admin_write ON album.milestones;
CREATE POLICY album_milestones_admin_write ON album.milestones FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_claims_select_own ON album.milestone_claims;
CREATE POLICY album_claims_select_own ON album.milestone_claims
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS album_claims_admin_read ON album.milestone_claims;
CREATE POLICY album_claims_admin_read ON album.milestone_claims
FOR SELECT TO authenticated
USING (ops.has_admin_permission('album:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS album_weekly_leaderboards_read_public ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_read_public ON album.weekly_leaderboards
FOR SELECT TO anon, authenticated
USING (status in ('active', 'settled'));

DROP POLICY IF EXISTS album_weekly_leaderboards_admin_read ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_admin_read ON album.weekly_leaderboards FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_weekly_leaderboards_admin_write ON album.weekly_leaderboards;
CREATE POLICY album_weekly_leaderboards_admin_write ON album.weekly_leaderboards FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_entries_read_public ON album.leaderboard_entries;
CREATE POLICY album_entries_read_public ON album.leaderboard_entries
FOR SELECT TO anon, authenticated
USING (
  exists (
    select 1 from album.weekly_leaderboards wl
    where wl.id = leaderboard_id
      and wl.status in ('active', 'settled')
  )
);

DROP POLICY IF EXISTS album_entries_admin_read ON album.leaderboard_entries;
CREATE POLICY album_entries_admin_read ON album.leaderboard_entries FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_entries_admin_write ON album.leaderboard_entries;
CREATE POLICY album_entries_admin_write ON album.leaderboard_entries FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));

DROP POLICY IF EXISTS album_score_rules_read_public ON album.score_rules;
CREATE POLICY album_score_rules_read_public ON album.score_rules
FOR SELECT TO anon, authenticated
USING (active = true);

DROP POLICY IF EXISTS album_score_rules_admin_read ON album.score_rules;
CREATE POLICY album_score_rules_admin_read ON album.score_rules FOR SELECT TO authenticated USING (ops.has_admin_permission('album:read'));
DROP POLICY IF EXISTS album_score_rules_admin_write ON album.score_rules;
CREATE POLICY album_score_rules_admin_write ON album.score_rules FOR ALL TO authenticated USING (ops.has_admin_permission('album:write')) WITH CHECK (ops.has_admin_permission('album:write'));


-- onchain.policies.sql
-- RLS for TON NFT collections, NFT item mappings, Mint queue, transactions and wallet sync.

grant usage on schema onchain to authenticated, service_role;
revoke all on all tables in schema onchain from anon, authenticated;
grant all privileges on all tables in schema onchain to service_role;

grant select on all tables in schema onchain to authenticated;

-- Admins may manage collection config. Mint queue and chain status are backend/service-owned.
grant insert, update, delete on table onchain.nft_collections to authenticated;

alter table onchain.nft_collections enable row level security;
alter table onchain.nft_items enable row level security;
alter table onchain.mint_queue enable row level security;
alter table onchain.transactions enable row level security;
alter table onchain.wallet_sync_jobs enable row level security;
alter table onchain.wallet_nft_snapshots enable row level security;

DROP POLICY IF EXISTS onchain_collections_read_active ON onchain.nft_collections;
CREATE POLICY onchain_collections_read_active ON onchain.nft_collections
FOR SELECT TO authenticated
USING (status = 'active');

DROP POLICY IF EXISTS onchain_collections_admin_read ON onchain.nft_collections;
CREATE POLICY onchain_collections_admin_read ON onchain.nft_collections
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read'));

DROP POLICY IF EXISTS onchain_collections_admin_write ON onchain.nft_collections;
CREATE POLICY onchain_collections_admin_write ON onchain.nft_collections
FOR ALL TO authenticated
USING (ops.has_admin_permission('onchain:write'))
WITH CHECK (ops.has_admin_permission('onchain:write'));

DROP POLICY IF EXISTS onchain_nft_items_select_own ON onchain.nft_items;
CREATE POLICY onchain_nft_items_select_own ON onchain.nft_items
FOR SELECT TO authenticated
USING (owner_user_id = core.current_user_id());

DROP POLICY IF EXISTS onchain_nft_items_admin_read ON onchain.nft_items;
CREATE POLICY onchain_nft_items_admin_read ON onchain.nft_items
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS onchain_mint_queue_select_own ON onchain.mint_queue;
CREATE POLICY onchain_mint_queue_select_own ON onchain.mint_queue
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS onchain_mint_queue_admin_read ON onchain.mint_queue;
CREATE POLICY onchain_mint_queue_admin_read ON onchain.mint_queue
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS onchain_transactions_select_own ON onchain.transactions;
CREATE POLICY onchain_transactions_select_own ON onchain.transactions
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS onchain_transactions_admin_read ON onchain.transactions;
CREATE POLICY onchain_transactions_admin_read ON onchain.transactions
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read') OR ops.has_admin_permission('users:read'));

DROP POLICY IF EXISTS onchain_wallet_sync_jobs_select_own ON onchain.wallet_sync_jobs;
CREATE POLICY onchain_wallet_sync_jobs_select_own ON onchain.wallet_sync_jobs
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS onchain_wallet_sync_jobs_admin_read ON onchain.wallet_sync_jobs;
CREATE POLICY onchain_wallet_sync_jobs_admin_read ON onchain.wallet_sync_jobs
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read'));

DROP POLICY IF EXISTS onchain_wallet_snapshots_select_own ON onchain.wallet_nft_snapshots;
CREATE POLICY onchain_wallet_snapshots_select_own ON onchain.wallet_nft_snapshots
FOR SELECT TO authenticated
USING (user_id = core.current_user_id());

DROP POLICY IF EXISTS onchain_wallet_snapshots_admin_read ON onchain.wallet_nft_snapshots;
CREATE POLICY onchain_wallet_snapshots_admin_read ON onchain.wallet_nft_snapshots
FOR SELECT TO authenticated
USING (ops.has_admin_permission('onchain:read') OR ops.has_admin_permission('wallet:read'));


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

-- First-stage hardening.
-- Public views execute as the caller so underlying table RLS remains effective.
ALTER VIEW public.v_collectible_catalog SET (security_invoker = true);
ALTER VIEW public.v_active_boxes SET (security_invoker = true);
ALTER VIEW public.v_box_rewards SET (security_invoker = true);
ALTER VIEW public.v_market_listings SET (security_invoker = true);
ALTER VIEW public.v_market_price_summary SET (security_invoker = true);
ALTER VIEW public.v_album_books SET (security_invoker = true);
ALTER VIEW public.v_weekly_leaderboard SET (security_invoker = true);
ALTER VIEW public.v_user_asset_summary SET (security_invoker = true);
ALTER VIEW public.v_user_inventory SET (security_invoker = true);
ALTER VIEW public.v_user_task_status SET (security_invoker = true);

-- Frontend/direct Supabase roles are read-only. All writes go through Vercel API + RPC.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops
  FROM anon, authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA api FROM anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM public, anon, authenticated;
  END IF;
END;
$$;

ALTER FUNCTION core.set_updated_at() SET search_path = core, public;
ALTER FUNCTION core.request_claims() SET search_path = core, public;
ALTER FUNCTION core.current_user_id() SET search_path = core, public;
ALTER FUNCTION core.current_admin_id() SET search_path = core, public;
ALTER FUNCTION economy.prevent_currency_ledger_mutation() SET search_path = economy, public;
ALTER FUNCTION gacha.refresh_drop_pool_total_weight() SET search_path = gacha, public;
ALTER FUNCTION album.record_discovery_from_inventory() SET search_path = album, inventory, public;
ALTER FUNCTION market.validate_listing_counts() SET search_path = market, public;

-- Advisor cleanup: the app/admin boundary is Vercel API + service_role/RPC,
-- not direct authenticated admin writes against Supabase tables. Drop optional
-- direct-admin policies so authenticated reads do not evaluate multiple
-- permissive RLS branches per table/action.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN (
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
      AND (
        policyname LIKE '%\_admin\_read' ESCAPE '\'
        OR policyname LIKE '%\_admin\_write' ESCAPE '\'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  END LOOP;
END;
$$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON ALL TABLES IN SCHEMA core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops
  FROM anon, authenticated;

DROP POLICY IF EXISTS market_listings_read_active_or_own ON market.listings;
DROP POLICY IF EXISTS market_listings_read_public ON market.listings;
DROP POLICY IF EXISTS market_listings_select_own ON market.listings;
DROP POLICY IF EXISTS market_listings_read_anon_active ON market.listings;
DROP POLICY IF EXISTS market_listings_read_authenticated_active_or_own ON market.listings;

CREATE POLICY market_listings_read_anon_active
ON market.listings
FOR SELECT
TO anon
USING (status IN ('active', 'partially_sold'));

CREATE POLICY market_listings_read_authenticated_active_or_own
ON market.listings
FOR SELECT
TO authenticated
USING (
  status IN ('active', 'partially_sold')
  OR seller_user_id = core.current_user_id()
);
