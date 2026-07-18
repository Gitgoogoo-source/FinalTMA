do $$
declare
  v_table record;
begin
  for v_table in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('core', 'catalog', 'economy', 'inventory', 'gameplay', 'market', 'onchain', 'ops')
  loop
    execute format('alter table %I.%I enable row level security', v_table.schemaname, v_table.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated', v_table.schemaname, v_table.tablename);
  end loop;
end
$$;

revoke all on schema core, catalog, economy, inventory, gameplay, market, onchain, ops, api from public, anon, authenticated;
revoke execute on all functions in schema core, catalog, economy, inventory, gameplay, market, onchain, ops, api from public, anon, authenticated;

grant usage on schema api to service_role;
grant execute on all functions in schema api to service_role;

alter default privileges in schema core revoke execute on functions from public;
alter default privileges in schema catalog revoke execute on functions from public;
alter default privileges in schema economy revoke execute on functions from public;
alter default privileges in schema inventory revoke execute on functions from public;
alter default privileges in schema gameplay revoke execute on functions from public;
alter default privileges in schema market revoke execute on functions from public;
alter default privileges in schema onchain revoke execute on functions from public;
alter default privileges in schema ops revoke execute on functions from public;
alter default privileges in schema api revoke execute on functions from public;
