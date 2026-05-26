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


