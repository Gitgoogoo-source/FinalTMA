-- Phase 5 step 10 wallet security and idempotency checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.make_user(
  p_telegram_user_id bigint,
  p_username text default null
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
    p_first_name := 'Wallet',
    p_last_name := p_telegram_user_id::text,
    p_language_code := 'en',
    p_is_premium := false,
    p_photo_url := 'https://example.test/avatar/' || p_telegram_user_id::text || '.png',
    p_start_param := null,
    p_metadata := jsonb_build_object('test', true)
  );
  return (v_payload ->> 'user_id')::uuid;
end;
$$;

select plan(5);

create temp table _ids (key text primary key, id uuid, payload jsonb) on commit drop;

insert into _ids (key, id)
values ('user', testutil.make_user(51010000001, 'phase5_wallet_security_user'));

insert into _ids (key, payload)
values (
  'wallet_a_saved',
  api.wallet_save_verified_address(
    (select id from _ids where key = 'user'),
    'EQ_PHASE5_SECURITY_WALLET_A',
    'raw-phase5-security-wallet-a',
    'mainnet',
    'Tonkeeper',
    true
  )
);

insert into _ids (key, id)
select 'wallet_a_id', ((select payload from _ids where key = 'wallet_a_saved') ->> 'wallet_id')::uuid;

select is(
  (
    select count(*)::bigint
    from ops.app_events
    where user_id = (select id from _ids where key = 'user')
      and event_name = 'wallet_primary_switched'
  ),
  0::bigint,
  'first verified primary wallet does not create a switch audit event'
);

insert into _ids (key, payload)
values (
  'wallet_b_saved',
  api.wallet_save_verified_address(
    (select id from _ids where key = 'user'),
    'EQ_PHASE5_SECURITY_WALLET_B',
    'raw-phase5-security-wallet-b',
    'mainnet',
    'Tonkeeper',
    true
  )
);

insert into _ids (key, id)
select 'wallet_b_id', ((select payload from _ids where key = 'wallet_b_saved') ->> 'wallet_id')::uuid;

select is(
  (
    select count(*)::bigint
    from ops.app_events
    where user_id = (select id from _ids where key = 'user')
      and event_name = 'wallet_primary_switched'
  ),
  1::bigint,
  'verified primary wallet switch creates one audit event'
);

select ok(
  exists (
    select 1
    from ops.app_events
    where user_id = (select id from _ids where key = 'user')
      and event_name = 'wallet_primary_switched'
      and event_source = 'wallet_rpc'
      and payload ->> 'previous_wallet_id' = (select id::text from _ids where key = 'wallet_a_id')
      and payload ->> 'new_wallet_id' = (select id::text from _ids where key = 'wallet_b_id')
      and payload ->> 'network' = 'mainnet'
      and length(payload ->> 'previous_address_hash') = 64
      and length(payload ->> 'new_address_hash') = 64
  ),
  'wallet switch audit records wallet ids, network and address hashes'
);

insert into _ids (key, payload)
values (
  'wallet_b_saved_repeat',
  api.wallet_save_verified_address(
    (select id from _ids where key = 'user'),
    'EQ_PHASE5_SECURITY_WALLET_B',
    'raw-phase5-security-wallet-b',
    'mainnet',
    'Tonkeeper',
    true
  )
);

select is(
  (
    select count(*)::bigint
    from ops.app_events
    where user_id = (select id from _ids where key = 'user')
      and event_name = 'wallet_primary_switched'
  ),
  1::bigint,
  're-saving the same primary wallet does not duplicate switch audit'
);

select is(
  (
    select count(*)::bigint
    from core.user_wallets
    where user_id = (select id from _ids where key = 'user')
      and network = 'mainnet'
      and status = 'connected'
      and is_primary = true
  ),
  1::bigint,
  'only one primary connected wallet remains after verified switch'
);

select * from finish();

rollback;
