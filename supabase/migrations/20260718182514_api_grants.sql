-- Generated from supabase/schemas. Edit declarative schemas, then regenerate.

-- source: 99_security.sql
do $$
declare
  v_table record;
begin
  for v_table in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'expedition', 'wheel', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk')
  loop
    execute format('alter table %I.%I enable row level security', v_table.schemaname, v_table.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', v_table.schemaname, v_table.tablename);
  end loop;
end
$$;

revoke all on schema identity, catalog, economy, inventory, gacha, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk, api from public, anon, authenticated;
revoke all on schema identity, catalog, economy, inventory, gacha, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk from service_role;
revoke execute on all functions in schema identity, catalog, economy, inventory, gacha, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk, api from public, anon, authenticated, service_role;

grant usage on schema api to service_role;
grant execute on all functions in schema api to service_role;

alter default privileges in schema identity revoke execute on functions from public;
alter default privileges in schema catalog revoke execute on functions from public;
alter default privileges in schema economy revoke execute on functions from public;
alter default privileges in schema inventory revoke execute on functions from public;
alter default privileges in schema gacha revoke execute on functions from public;
alter default privileges in schema expedition revoke execute on functions from public;
alter default privileges in schema wheel revoke execute on functions from public;
alter default privileges in schema market revoke execute on functions from public;
alter default privileges in schema payments revoke execute on functions from public;
alter default privileges in schema vip revoke execute on functions from public;
alter default privileges in schema tasks revoke execute on functions from public;
alter default privileges in schema referral revoke execute on functions from public;
alter default privileges in schema album revoke execute on functions from public;
alter default privileges in schema onchain revoke execute on functions from public;
alter default privileges in schema operations revoke execute on functions from public;
alter default privileges in schema risk revoke execute on functions from public;
alter default privileges in schema api revoke execute on functions from public;
