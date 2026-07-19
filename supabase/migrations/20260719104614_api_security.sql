-- Explicit security migration. Grants, default privileges, and RLS are not derived from schema diff.
do $$
declare
  v_table record;
  v_sequence record;
  v_schema text;
begin
  for v_table in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk')
  loop
    execute format('alter table %I.%I enable row level security', v_table.schemaname, v_table.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', v_table.schemaname, v_table.tablename);
  end loop;
  for v_sequence in
    select schemaname, sequencename
    from pg_sequences
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk')
  loop
    execute format('revoke all on sequence %I.%I from public, anon, authenticated, service_role', v_sequence.schemaname, v_sequence.sequencename);
  end loop;
  foreach v_schema in array array['identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk', 'api']
  loop
    execute format('alter default privileges in schema %I revoke all on tables from public, anon, authenticated, service_role', v_schema);
    execute format('alter default privileges in schema %I revoke all on sequences from public, anon, authenticated, service_role', v_schema);
    execute format('alter default privileges in schema %I revoke execute on functions from public, anon, authenticated, service_role', v_schema);
  end loop;
end
$$;

revoke all on schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk, api from public, anon, authenticated;
revoke all on schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk from service_role;
revoke execute on all functions in schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, market, payments, vip, tasks, referral, album, onchain, operations, risk, api from public, anon, authenticated, service_role;

grant usage on schema api to service_role;
grant execute on all functions in schema api to service_role;
