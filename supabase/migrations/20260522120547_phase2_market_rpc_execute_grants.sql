-- Phase 2 marketplace RPC execute grants.
-- Remote migration version: 20260522120547.
-- Direct Supabase clients must not execute write RPCs. Vercel API calls these
-- functions through the service_role client after requireSession/validation.

grant execute on function api.market_create_listing(uuid, uuid[], numeric, text) to service_role;
grant execute on function api.market_buy_listing(uuid, uuid, integer, text) to service_role;
grant execute on function api.market_update_listing_price(uuid, uuid, numeric) to service_role;
grant execute on function api.market_cancel_listing(uuid, uuid) to service_role;

revoke execute on function api.market_create_listing(uuid, uuid[], numeric, text) from public, anon, authenticated;
revoke execute on function api.market_buy_listing(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function api.market_update_listing_price(uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function api.market_cancel_listing(uuid, uuid) from public, anon, authenticated;
