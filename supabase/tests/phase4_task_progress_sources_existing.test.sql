-- Phase 4 / 9.1 task progress source wiring.
-- This test intentionally covers only sources that already exist in
-- tasks.task_definitions.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null,
  p_start_param text default null
)
returns uuid
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := api.auth_upsert_telegram_user(
    p_telegram_user_id := p_telegram_user_id,
    p_username := coalesce(p_username, 'u' || p_telegram_user_id::text),
    p_first_name := 'Test',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := p_start_param,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select no_plan();

select ok(
  position('gacha_open_success' in pg_get_functiondef(to_regprocedure('api.gacha_process_paid_order(uuid,text,text,jsonb)'))) > 0,
  'gacha_process_paid_order records gacha_open_success progress'
);
select ok(
  position('referral_first_open' in pg_get_functiondef(to_regprocedure('api.referral_process_first_open(uuid,uuid)'))) > 0,
  'referral_process_first_open records referral_first_open progress'
);
select ok(
  position('market_listing_created' in pg_get_functiondef(to_regprocedure('api.market_create_listing(uuid,uuid[],numeric,text)'))) > 0,
  'market_create_listing records market_listing_created progress'
);
select ok(
  position('market_order_completed' in pg_get_functiondef(to_regprocedure('api.market_buy_listing(uuid,uuid,integer,numeric,text)'))) > 0,
  'market_buy_listing records market_order_completed progress'
);
select ok(
  position('inventory_upgrade_success' in pg_get_functiondef(to_regprocedure('api.inventory_upgrade_item(uuid,uuid,text)'))) > 0,
  'inventory_upgrade_item records inventory_upgrade_success progress'
);
select ok(
  position('wallet_verified' in pg_get_functiondef(to_regprocedure('api.wallet_save_verified_address(uuid,text,text,text,text,boolean)'))) > 0,
  'wallet_save_verified_address records wallet_verified progress'
);
select ok(
  position('nft_sync_success' in pg_get_functiondef(to_regprocedure('api.onchain_mark_mint_success(uuid,text,bigint,text,text,text)'))) > 0,
  'onchain_mark_mint_success records nft_sync_success progress'
);

select ok(
  position('task_record_progress' in pg_get_functiondef(to_regprocedure('api.inventory_evolve_item(uuid,uuid[],text)'))) > 0
    and position('inventory_evolve_item' in pg_get_functiondef(to_regprocedure('api.inventory_evolve_item(uuid,uuid[],text)'))) > 0,
  'inventory_evolve_item records inventory_evolve_item progress'
);
select ok(
  position('task_record_progress' in pg_get_functiondef(to_regprocedure('api.inventory_decompose_items(uuid,uuid[],text)'))) > 0
    and position('inventory_decompose_item' in pg_get_functiondef(to_regprocedure('api.inventory_decompose_items(uuid,uuid[],text)'))) > 0,
  'inventory_decompose_items records inventory_decompose_item progress'
);
select ok(
  position('task_record_progress' in pg_get_functiondef(to_regprocedure('api.inventory_decompose_item(uuid,uuid,text)'))) > 0
    and position('inventory_decompose_item' in pg_get_functiondef(to_regprocedure('api.inventory_decompose_item(uuid,uuid,text)'))) > 0,
  'inventory_decompose_item records inventory_decompose_item progress'
);
select ok(
  position('task_record_progress' in pg_get_functiondef(to_regprocedure('api.album_claim_milestone(uuid,uuid,text,integer)'))) > 0
    and position('album_claim_milestone' in pg_get_functiondef(to_regprocedure('api.album_claim_milestone(uuid,uuid,text,integer)'))) > 0,
  'album_claim_milestone records album_claim_milestone progress'
);
select ok(
  position('task_record_progress' in pg_get_functiondef(to_regprocedure('api.wallet_enqueue_mint(uuid,uuid,uuid,uuid,text)'))) = 0,
  'wallet_enqueue_mint is not wired because mint queueing is not the successful sync source'
);

select ok(
  not has_function_privilege('service_role', 'api.gacha_process_paid_order_without_task_progress(uuid,text,text,jsonb)', 'EXECUTE'),
  'gacha helper implementation is not directly service-role executable'
);
select ok(
  not has_function_privilege('service_role', 'api.market_buy_listing_without_task_progress(uuid,uuid,integer,numeric,text)', 'EXECUTE'),
  'market buy helper implementation is not directly service-role executable'
);
select ok(
  has_function_privilege('service_role', 'api.wallet_save_verified_address(uuid,text,text,text,text,boolean)', 'EXECUTE'),
  'public wallet progress wrapper remains service-role executable'
);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('wallet_user', testutil.make_user(10910000001, 'phase4_progress_wallet_user', null));

insert into _ids (key, payload)
values (
  'wallet_saved',
  api.wallet_save_verified_address(
    (select id from _ids where key = 'wallet_user'),
    'EQ_PHASE4_PROGRESS_WALLET',
    'raw-phase4-progress-wallet',
    'mainnet',
    'Tonkeeper',
    true
  )
);

insert into _ids (key, id)
select 'wallet_id', ((select payload from _ids where key = 'wallet_saved') ->> 'wallet_id')::uuid;

select is(
  (
    select up.progress_count
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'wallet_user')
      and td.code = 'WALLET_CONNECT'
      and up.period_key = 'once'
  ),
  1,
  'wallet_save_verified_address advances wallet task progress'
);

select is(
  (
    select up.status
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'wallet_user')
      and td.code = 'WALLET_CONNECT'
      and up.period_key = 'once'
  ),
  'completed',
  'wallet task is completed after verified wallet save'
);

insert into _ids (key, payload)
values (
  'wallet_saved_repeat',
  api.wallet_save_verified_address(
    (select id from _ids where key = 'wallet_user'),
    'EQ_PHASE4_PROGRESS_WALLET',
    'raw-phase4-progress-wallet',
    'mainnet',
    'Tonkeeper',
    true
  )
);

select is(
  (
    select up.progress_count
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'wallet_user')
      and td.code = 'WALLET_CONNECT'
      and up.period_key = 'once'
  ),
  1,
  're-saving the same verified wallet does not double-count wallet progress'
);

select is(
  (
    select jsonb_array_length(up.source_events)
    from tasks.user_task_progress up
    join tasks.task_definitions td on td.id = up.task_id
    where up.user_id = (select id from _ids where key = 'wallet_user')
      and td.code = 'WALLET_CONNECT'
      and up.period_key = 'once'
  ),
  1,
  're-saving the same verified wallet does not duplicate source events'
);

select * from finish();

rollback;
