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

