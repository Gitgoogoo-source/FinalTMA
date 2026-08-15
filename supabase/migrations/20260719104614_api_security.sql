-- Explicit security migration. Grants, default privileges, and RLS are not derived from schema diff.
do $$
declare
  v_table record;
  v_view record;
  v_sequence record;
  v_schema text;
begin
  for v_table in
    select schemaname, tablename
    from pg_tables
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'battle', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk', 'admin')
  loop
    execute format('alter table %I.%I enable row level security', v_table.schemaname, v_table.tablename);
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', v_table.schemaname, v_table.tablename);
  end loop;
  for v_view in
    select schemaname, viewname
    from pg_views
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'battle', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk', 'admin')
  loop
    execute format('revoke all on table %I.%I from public, anon, authenticated, service_role', v_view.schemaname, v_view.viewname);
  end loop;
  for v_sequence in
    select schemaname, sequencename
    from pg_sequences
    where schemaname in ('identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'battle', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk', 'admin')
  loop
    execute format('revoke all on sequence %I.%I from public, anon, authenticated, service_role', v_sequence.schemaname, v_sequence.sequencename);
  end loop;
  foreach v_schema in array array['identity', 'catalog', 'economy', 'inventory', 'gacha', 'evolution', 'expedition', 'wheel', 'battle', 'market', 'payments', 'vip', 'tasks', 'referral', 'album', 'onchain', 'operations', 'risk', 'admin', 'api']
  loop
    execute format('alter default privileges in schema %I revoke all on tables from public, anon, authenticated, service_role', v_schema);
    execute format('alter default privileges in schema %I revoke all on sequences from public, anon, authenticated, service_role', v_schema);
    execute format('alter default privileges in schema %I revoke execute on functions from public, anon, authenticated, service_role', v_schema);
  end loop;
end
$$;

revoke all on schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, battle, market, payments, vip, tasks, referral, album, onchain, operations, risk, admin, api from public, anon, authenticated;
revoke all on schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, battle, market, payments, vip, tasks, referral, album, onchain, operations, risk, admin from service_role;
revoke execute on all functions in schema identity, catalog, economy, inventory, gacha, evolution, expedition, wheel, battle, market, payments, vip, tasks, referral, album, onchain, operations, risk, admin, api from public, anon, authenticated, service_role;

grant usage on schema api to service_role;
do $$
declare
  v_function record;
  v_missing text[];
  v_allowed text[] := array[
    'album_claim',
    'album_get',
    'battle_abort_share',
    'battle_accept_room',
    'battle_ack_outbox',
    'battle_activate_share',
    'battle_bootstrap',
    'battle_cancel_room',
    'battle_claim_outbox',
    'battle_claim_prepared_shares',
    'battle_complete_outbox',
    'battle_current_invite',
    'battle_heartbeat',
    'battle_mark_offline',
    'battle_matchmake',
    'battle_nack_outbox',
    'battle_nack_prepared_share',
    'battle_prepare_room',
    'battle_process_due',
    'battle_realtime_context',
    'battle_room',
    'battle_submit_action',
    'battle_team_options',
    'battle_validate_recovery_context',
    'catalog_asset_cleanup_claim',
    'catalog_asset_cleanup_finish',
    'catalog_asset_current',
    'catalog_asset_lock',
    'catalog_asset_mutation_abort',
    'catalog_asset_mutation_acquire',
    'catalog_asset_mutation_renew',
    'catalog_asset_publish',
    'catalog_asset_release_get',
    'catalog_asset_rollback',
    'catalog_current',
    'catalog_release',
    'expedition_claim',
    'expedition_create',
    'expedition_eligible_items',
    'expedition_list',
    'finish_job',
    'gacha_bootstrap',
    'gacha_open',
    'identity_authenticate',
    'identity_consume_login_source_rate_limit',
    'identity_initial',
    'identity_set_preferred_language',
    'identity_summary',
    'inventory_decompose',
    'inventory_detail',
    'inventory_evolution_acknowledge_result',
    'inventory_evolution_preview',
    'inventory_evolve',
    'inventory_list',
    'market_bootstrap',
    'market_cancel_template_listings',
    'market_create_listing',
    'market_my_listings',
    'market_purchase',
    'market_template',
    'mint_attach_permit',
    'mint_cancel',
    'mint_complete',
    'mint_get',
    'mint_list',
    'mint_mark_unknown',
    'mint_metadata',
    'mint_reconciliation_candidates',
    'mint_reserve',
    'mint_submit',
    'operations_get',
    'operations_recoverable',
    'payment_apply_refund',
    'payment_apply_success',
    'payment_begin_checkout',
    'payment_fail_invoice_creation',
    'payment_invoice_details',
    'payment_set_invoice_url',
    'referral_bind',
    'referral_get',
    'run_job',
    'tasks_check_in',
    'tasks_claim',
    'tasks_get',
    'topup_bootstrap',
    'topup_cancel_order',
    'topup_create_order',
    'topup_fail_order',
    'topup_order',
    'vip_claim',
    'vip_cancel_order',
    'vip_create_order',
    'vip_get',
    'wallet_create_challenge',
    'wallet_disconnect',
    'wallet_get',
    'wallet_save_verified',
    'wheel_get',
    'wheel_spin'
  ];
begin
  select array_agg(allowed_name order by allowed_name)
  into v_missing
  from unnest(v_allowed) allowed_name
  where not exists (
    select 1
    from pg_proc function_definition
    join pg_namespace function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'api'
      and function_definition.proname = allowed_name
  );
  if v_missing is not null then
    raise exception 'Missing allowlisted api functions: %', v_missing;
  end if;
  for v_function in
    select
      function_schema.nspname as schema_name,
      function_definition.proname as function_name,
      pg_get_function_identity_arguments(function_definition.oid) as arguments
    from pg_proc function_definition
    join pg_namespace function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'api'
      and function_definition.proname = any(v_allowed)
  loop
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      v_function.schema_name,
      v_function.function_name,
      v_function.arguments
    );
  end loop;
end
$$;
