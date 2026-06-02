-- Harden auth session internals.
--
-- core.app_sessions and core.user_api_tokens contain token hashes and session
-- fingerprints. They are server-owned internal tables; browser roles should
-- not reach them through the Supabase Data API even with own-row RLS.
--
-- Rollback, if a future product intentionally exposes safe session metadata:
-- create a narrow view/RPC that omits token hashes/fingerprints, or explicitly
-- re-grant only that safe surface. Do not re-grant these base tables to browser
-- roles unless the sensitive columns have been split into a private table.

alter table core.app_sessions enable row level security;
alter table core.user_api_tokens enable row level security;

revoke select, insert, update, delete
on table core.app_sessions
from anon, authenticated;

revoke select, insert, update, delete
on table core.user_api_tokens
from anon, authenticated;

grant select, insert, update, delete
on table core.app_sessions
to service_role;

grant select, insert, update, delete
on table core.user_api_tokens
to service_role;

drop policy if exists core_sessions_select_own on core.app_sessions;
drop policy if exists core_sessions_admin_read on core.app_sessions;
drop policy if exists core_sessions_admin_write on core.app_sessions;

drop policy if exists core_tokens_select_own on core.user_api_tokens;
drop policy if exists core_tokens_admin_read on core.user_api_tokens;
drop policy if exists core_tokens_admin_write on core.user_api_tokens;
