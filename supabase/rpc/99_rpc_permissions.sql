-- _rpc_permissions.sql
-- ============================================================
-- Generated RPC file for the Telegram Mini App blind-box game.
-- Place under supabase/rpc/. Execute after schema migrations 0001-0019.
-- Core policy: frontend only requests; all trusted mutations are enforced here by database transactions.

-- Execute this after loading all RPC files.
-- Frontend anon/authenticated roles must not call trusted business mutation RPCs directly.
-- Vercel API should call these functions using the Supabase service_role key.

revoke usage on schema api from public, anon, authenticated;
grant usage on schema api to service_role;

revoke execute on all functions in schema api from public, anon, authenticated;
grant execute on all functions in schema api to service_role;

alter default privileges in schema api
  revoke execute on functions from public, anon, authenticated;

alter default privileges in schema api
  grant execute on functions to service_role;
