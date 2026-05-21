-- harden_step5_rls_constraints.sql
-- Completes first-stage constraints, view RLS behavior, and direct-client write lockdown.

-- First-stage business rule: each user has one pity progress row per blind box.
-- The existing primary key still keeps pity_rule_id referential integrity, while this
-- unique index enforces the project-level user_id + box_id invariant.
create unique index if not exists user_pity_states_user_box_unique
  on gacha.user_pity_states (user_id, box_id);

drop index if exists gacha.user_pity_states_user_box_idx;

-- A blind box has one active pity rule in the first-stage model.
create unique index if not exists pity_rules_one_active_per_box
  on gacha.pity_rules (box_id)
  where active = true;

-- Public views must execute with the caller's privileges so underlying RLS still applies.
alter view public.v_collectible_catalog set (security_invoker = true);
alter view public.v_active_boxes set (security_invoker = true);
alter view public.v_box_rewards set (security_invoker = true);
alter view public.v_market_listings set (security_invoker = true);
alter view public.v_market_price_summary set (security_invoker = true);
alter view public.v_album_books set (security_invoker = true);
alter view public.v_weekly_leaderboard set (security_invoker = true);
alter view public.v_user_asset_summary set (security_invoker = true);
alter view public.v_user_inventory set (security_invoker = true);
alter view public.v_user_task_status set (security_invoker = true);

-- Frontend/direct Supabase roles remain read-only. Mutations must go through
-- Vercel API + service role + RPC, including admin and support flows.
revoke insert, update, delete, truncate
  on all tables in schema core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops
  from anon, authenticated;

revoke execute on all functions in schema api from anon, authenticated;
grant execute on all functions in schema api to service_role;

-- Advisor hardening: security-definer helper in public should not be callable through REST/RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;

-- Advisor hardening: make function name resolution deterministic.
alter function core.set_updated_at() set search_path = core, public;
alter function core.request_claims() set search_path = core, public;
alter function core.current_user_id() set search_path = core, public;
alter function core.current_admin_id() set search_path = core, public;
alter function economy.prevent_currency_ledger_mutation() set search_path = economy, public;
alter function gacha.refresh_drop_pool_total_weight() set search_path = gacha, public;
alter function album.record_discovery_from_inventory() set search_path = album, inventory, public;
alter function market.validate_listing_counts() set search_path = market, public;
