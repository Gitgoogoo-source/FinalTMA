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

