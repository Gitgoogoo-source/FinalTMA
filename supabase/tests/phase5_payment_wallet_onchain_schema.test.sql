-- Phase 5 payment, wallet proof and onchain schema hardening checks.

begin;

create schema if not exists extensions;
create extension if not exists pgtap with schema extensions;
create schema if not exists testutil;

set search_path = public, extensions, testutil, core, economy, catalog, gacha, inventory, market, payments, tasks, album, onchain, ops, api;

create or replace function testutil.raises_like(p_sql text, p_pattern text)
returns boolean
language plpgsql
as $$
begin
  execute p_sql;
  return false;
exception when others then
  return lower(sqlerrm) like lower(p_pattern);
end;
$$;

grant usage on schema testutil to public;
grant execute on function testutil.raises_like(text, text) to public;

select no_plan();

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'payments'
      and table_name = 'telegram_webhook_events'
      and column_name in (
        'processing_duration_ms',
        'retry_count',
        'next_retry_at',
        'request_headers_hash',
        'webhook_secret_verified'
      )
    having count(*) = 5
  ),
  'telegram_webhook_events has Phase 5 audit and retry columns'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'core'
      and table_name = 'wallet_proofs'
      and column_name in ('proof_nonce', 'request_id', 'used_at', 'wallet_public_key', 'proof_hash')
    having count(*) = 5
  ),
  'wallet_proofs has replay prevention columns'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'payments'
      and c.relname = 'star_orders'
      and con.conname = 'star_orders_status_check'
      and pg_get_constraintdef(con.oid) like '%precheckout_ok%'
      and pg_get_constraintdef(con.oid) like '%precheckout_checked%'
      and pg_get_constraintdef(con.oid) like '%fulfilling%'
      and pg_get_constraintdef(con.oid) like '%disputed%'
  ),
  'star_orders status check keeps precheckout_ok and adds Phase 5 states'
);

select ok(
  exists (
    select 1
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'onchain'
      and c.relname = 'mint_queue'
      and con.conname = 'mint_queue_status_check'
      and pg_get_constraintdef(con.oid) like '%submitted%'
      and pg_get_constraintdef(con.oid) like '%confirming%'
      and pg_get_constraintdef(con.oid) like '%retrying%'
      and pg_get_constraintdef(con.oid) like '%manual_review%'
  ),
  'mint_queue status check includes submitted, confirming, retrying and manual_review'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'onchain'
      and tablename = 'mint_queue'
      and indexname = 'mint_queue_one_active_per_item'
      and indexdef like '%submitted%'
      and indexdef like '%confirming%'
      and indexdef like '%retrying%'
      and indexdef like '%manual_review%'
  ),
  'active mint queue uniqueness covers all active Phase 5 statuses'
);

insert into core.users (id, telegram_user_id, username, invite_code)
values
  ('00000000-0000-5000-8000-000000000301', 105030001, 'phase5_schema_a', 'P5S301'),
  ('00000000-0000-5000-8000-000000000302', 105030002, 'phase5_schema_b', 'P5S302');

insert into catalog.series (id, slug, display_name, status)
values ('00000000-0000-5000-8000-000000000311', 'phase5-schema-series', 'Phase 5 Schema Series', 'active')
on conflict (slug) do update set display_name = excluded.display_name, status = 'active';

insert into catalog.factions (id, slug, display_name)
values ('00000000-0000-5000-8000-000000000312', 'phase5-schema-faction', 'Phase 5 Schema Faction')
on conflict (slug) do update set display_name = excluded.display_name;

insert into catalog.collectible_templates (
  id,
  slug,
  display_name,
  subtitle,
  description,
  rarity_code,
  type_code,
  series_id,
  faction_id,
  base_power,
  max_level,
  release_status,
  tradeable,
  upgradeable,
  evolvable,
  decomposable,
  nft_mintable,
  sort_order
) values (
  '00000000-0000-5000-8000-000000000313',
  'phase5-schema-template',
  'Phase 5 Schema Template',
  'fixture',
  'Phase 5 schema fixture',
  'COMMON',
  'CHARACTER',
  '00000000-0000-5000-8000-000000000311',
  '00000000-0000-5000-8000-000000000312',
  10,
  100,
  'active',
  true,
  true,
  true,
  true,
  true,
  1
)
on conflict (slug) do update
set display_name = excluded.display_name,
    release_status = 'active',
    nft_mintable = true;

insert into catalog.collectible_forms (
  id,
  template_id,
  form_index,
  form_slug,
  display_name,
  description,
  image_url,
  thumbnail_url,
  avatar_url,
  is_default
) values (
  '00000000-0000-5000-8000-000000000314',
  '00000000-0000-5000-8000-000000000313',
  1,
  'base',
  'Base',
  'Base form',
  'https://example.test/phase5/base.png',
  'https://example.test/phase5/base-thumb.png',
  'https://example.test/phase5/base-avatar.png',
  true
)
on conflict (template_id, form_index) do update
set display_name = excluded.display_name,
    is_default = true;

insert into core.user_wallets (id, user_id, network, address, address_raw, wallet_app_name, status, verified_at)
values
  ('00000000-0000-5000-8000-000000000321', '00000000-0000-5000-8000-000000000301', 'mainnet', 'EQ_PHASE5_SCHEMA_WALLET_A', 'raw-a', 'Tonkeeper', 'connected', now()),
  ('00000000-0000-5000-8000-000000000322', '00000000-0000-5000-8000-000000000302', 'mainnet', 'EQ_PHASE5_SCHEMA_WALLET_B', 'raw-b', 'Tonkeeper', 'connected', now());

insert into core.wallet_proofs (
  id,
  user_id,
  wallet_id,
  challenge,
  address,
  domain,
  payload,
  proof_signature,
  status,
  expires_at,
  proof_nonce,
  request_id,
  used_at,
  wallet_public_key,
  proof_hash
) values (
  '00000000-0000-5000-8000-000000000323',
  '00000000-0000-5000-8000-000000000301',
  '00000000-0000-5000-8000-000000000321',
  'phase5-schema-challenge-a',
  'EQ_PHASE5_SCHEMA_WALLET_A',
  'example.test',
  '{"fixture":true}'::jsonb,
  'signature-a',
  'verified',
  now() + interval '5 minutes',
  'nonce-a',
  'phase5-request-a',
  now(),
  'public-key-a',
  'proof-hash-a'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into core.wallet_proofs (
        user_id, wallet_id, challenge, address, domain, payload, proof_signature,
        status, expires_at, proof_hash
      ) values (
        '00000000-0000-5000-8000-000000000301',
        '00000000-0000-5000-8000-000000000321',
        'phase5-schema-challenge-duplicate-proof-hash',
        'EQ_PHASE5_SCHEMA_WALLET_A',
        'example.test',
        '{}'::jsonb,
        'signature-duplicate',
        'failed',
        now() + interval '5 minutes',
        'proof-hash-a'
      )
    $sql$,
    '%wallet_proofs_proof_hash_unique%'
  ),
  'wallet proof_hash rejects proof replay'
);

insert into payments.star_orders (
  id,
  user_id,
  business_type,
  business_id,
  status,
  xtr_amount,
  telegram_invoice_payload,
  title,
  idempotency_key
) values
  (
    '00000000-0000-5000-8000-000000000331',
    '00000000-0000-5000-8000-000000000301',
    'gacha_open',
    null,
    'precheckout_checked',
    10,
    'phase5-schema-payload-precheckout',
    'Phase 5 Precheckout',
    'phase5-schema-idem-precheckout'
  ),
  (
    '00000000-0000-5000-8000-000000000332',
    '00000000-0000-5000-8000-000000000301',
    'gacha_open',
    null,
    'fulfilling',
    10,
    'phase5-schema-payload-fulfilling',
    'Phase 5 Fulfilling',
    'phase5-schema-idem-fulfilling'
  ),
  (
    '00000000-0000-5000-8000-000000000333',
    '00000000-0000-5000-8000-000000000301',
    'gacha_open',
    null,
    'disputed',
    10,
    'phase5-schema-payload-disputed',
    'Phase 5 Disputed',
    'phase5-schema-idem-disputed'
  );

select is(
  (
    select count(*)::integer
    from payments.star_orders
    where id in (
      '00000000-0000-5000-8000-000000000331',
      '00000000-0000-5000-8000-000000000332',
      '00000000-0000-5000-8000-000000000333'
    )
  ),
  3,
  'star_orders accepts new compatible Phase 5 statuses'
);

insert into payments.star_invoices (id, star_order_id, invoice_link, payload, status, bot_api_method, expires_at)
values (
  '00000000-0000-5000-8000-000000000334',
  '00000000-0000-5000-8000-000000000331',
  'https://t.me/example/invoice',
  'phase5-schema-invoice-payload',
  'created',
  'createInvoiceLink',
  now() + interval '15 minutes'
);

select is(
  (select open_mode from payments.star_invoices where id = '00000000-0000-5000-8000-000000000334'),
  'telegram_link',
  'star_invoices defaults open_mode to telegram_link'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into payments.star_invoices (star_order_id, payload, status)
      values ('00000000-0000-5000-8000-000000000332', 'phase5-schema-invoice-payload', 'created')
    $sql$,
    '%star_invoices_payload_unique%'
  ),
  'star_invoices payload is unique'
);

insert into payments.star_payments (
  id,
  star_order_id,
  user_id,
  telegram_payment_charge_id,
  xtr_amount,
  currency,
  invoice_payload,
  raw_update
) values (
  '00000000-0000-5000-8000-000000000335',
  '00000000-0000-5000-8000-000000000331',
  '00000000-0000-5000-8000-000000000301',
  'phase5-schema-charge-id',
  10,
  'XTR',
  'phase5-schema-payload-precheckout',
  '{"fixture":true}'::jsonb
);

select ok(
  testutil.raises_like(
    $sql$
      insert into payments.star_payments (
        star_order_id, user_id, telegram_payment_charge_id, xtr_amount, currency, invoice_payload
      ) values (
        '00000000-0000-5000-8000-000000000332',
        '00000000-0000-5000-8000-000000000301',
        'phase5-schema-charge-id',
        10,
        'XTR',
        'phase5-schema-payload-fulfilling'
      )
    $sql$,
    '%star_payments_telegram_payment_charge_id_key%'
  ),
  'duplicate telegram_payment_charge_id is rejected'
);

insert into payments.telegram_webhook_events (
  id,
  update_id,
  event_type,
  user_id,
  telegram_user_id,
  invoice_payload,
  payload,
  process_status,
  request_headers_hash,
  webhook_secret_verified
) values (
  '00000000-0000-5000-8000-000000000336',
  105030003,
  'successful_payment',
  '00000000-0000-5000-8000-000000000301',
  105030001,
  'phase5-schema-payload-precheckout',
  '{"fixture":true}'::jsonb,
  'received',
  'headers-hash',
  true
);

select is(
  (select retry_count from payments.telegram_webhook_events where id = '00000000-0000-5000-8000-000000000336'),
  0,
  'telegram_webhook_events defaults retry_count to 0'
);

select is(
  (select webhook_secret_verified from payments.telegram_webhook_events where id = '00000000-0000-5000-8000-000000000336'),
  true,
  'telegram_webhook_events stores webhook_secret_verified'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into payments.telegram_webhook_events (event_type, payload, retry_count)
      values ('bad_retry', '{}'::jsonb, -1)
    $sql$,
    '%telegram_webhook_events_retry_count_check%'
  ),
  'telegram_webhook_events rejects negative retry_count'
);

insert into onchain.nft_collections (
  id,
  code,
  network,
  collection_address,
  owner_address,
  standard,
  metadata_url,
  status
) values (
  '00000000-0000-5000-8000-000000000341',
  'PHASE5_SCHEMA_COLLECTION',
  'mainnet',
  'EQ_PHASE5_SCHEMA_COLLECTION',
  'EQ_PHASE5_SCHEMA_OWNER',
  'TEP-62',
  'https://example.test/phase5-collection.json',
  'active'
);

insert into inventory.item_instances (id, owner_user_id, template_id, form_id, level, power, status, source_type)
values
  (
    '00000000-0000-5000-8000-000000000342',
    '00000000-0000-5000-8000-000000000301',
    '00000000-0000-5000-8000-000000000313',
    '00000000-0000-5000-8000-000000000314',
    1,
    10,
    'minting',
    'admin'
  ),
  (
    '00000000-0000-5000-8000-000000000343',
    '00000000-0000-5000-8000-000000000302',
    '00000000-0000-5000-8000-000000000313',
    '00000000-0000-5000-8000-000000000314',
    1,
    10,
    'minting',
    'admin'
  );

insert into onchain.mint_queue (
  id,
  user_id,
  wallet_id,
  collection_id,
  item_instance_id,
  template_id,
  form_id,
  status,
  next_attempt_at,
  idempotency_key
) values
  (
    '00000000-0000-5000-8000-000000000344',
    '00000000-0000-5000-8000-000000000301',
    '00000000-0000-5000-8000-000000000321',
    '00000000-0000-5000-8000-000000000341',
    '00000000-0000-5000-8000-000000000342',
    '00000000-0000-5000-8000-000000000313',
    '00000000-0000-5000-8000-000000000314',
    'retrying',
    now(),
    'phase5-schema-mint-a'
  ),
  (
    '00000000-0000-5000-8000-000000000345',
    '00000000-0000-5000-8000-000000000302',
    '00000000-0000-5000-8000-000000000322',
    '00000000-0000-5000-8000-000000000341',
    '00000000-0000-5000-8000-000000000343',
    '00000000-0000-5000-8000-000000000313',
    '00000000-0000-5000-8000-000000000314',
    'manual_review',
    now(),
    'phase5-schema-mint-b'
  );

select ok(
  testutil.raises_like(
    $sql$
      insert into onchain.mint_queue (
        user_id, wallet_id, collection_id, item_instance_id, template_id, form_id, status, idempotency_key
      ) values (
        '00000000-0000-5000-8000-000000000301',
        '00000000-0000-5000-8000-000000000321',
        '00000000-0000-5000-8000-000000000341',
        '00000000-0000-5000-8000-000000000342',
        '00000000-0000-5000-8000-000000000313',
        '00000000-0000-5000-8000-000000000314',
        'submitted',
        'phase5-schema-mint-duplicate-active'
      )
    $sql$,
    '%mint_queue_one_active_per_item%'
  ),
  'same item cannot have a second active Phase 5 mint queue'
);

insert into onchain.transactions (
  id,
  network,
  tx_hash,
  query_id,
  user_id,
  wallet_id,
  related_type,
  related_id,
  direction,
  status,
  transaction_type,
  external_api_provider,
  last_checked_at,
  check_count,
  raw_response
) values (
  '00000000-0000-5000-8000-000000000346',
  'mainnet',
  'phase5-schema-tx',
  'phase5-schema-query',
  '00000000-0000-5000-8000-000000000301',
  '00000000-0000-5000-8000-000000000321',
  'mint_queue',
  '00000000-0000-5000-8000-000000000344',
  'outbound',
  'pending',
  'mint',
  'toncenter',
  now(),
  1,
  '{"ok":true}'::jsonb
);

select is(
  (select transaction_type from onchain.transactions where id = '00000000-0000-5000-8000-000000000346'),
  'mint',
  'onchain.transactions stores transaction_type'
);

insert into onchain.wallet_sync_jobs (
  id,
  user_id,
  wallet_id,
  status,
  sync_type,
  idempotency_key,
  retry_count,
  next_retry_at,
  cursor
) values (
  '00000000-0000-5000-8000-000000000347',
  '00000000-0000-5000-8000-000000000301',
  '00000000-0000-5000-8000-000000000321',
  'queued',
  'nft',
  'phase5-schema-wallet-sync',
  0,
  now(),
  'cursor-1'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into onchain.wallet_sync_jobs (user_id, wallet_id, sync_type, idempotency_key)
      values (
        '00000000-0000-5000-8000-000000000301',
        '00000000-0000-5000-8000-000000000321',
        'nft',
        'phase5-schema-wallet-sync'
      )
    $sql$,
    '%wallet_sync_jobs_idempotency_key_unique%'
  ),
  'wallet_sync_jobs idempotency_key is unique when present'
);

set local role authenticated;
set local request.jwt.claims to '{"app_user_id":"00000000-0000-5000-8000-000000000301"}';

select is(
  (
    select count(*)::integer
    from core.user_wallets
    where id in (
      '00000000-0000-5000-8000-000000000321',
      '00000000-0000-5000-8000-000000000322'
    )
  ),
  1,
  'authenticated user only reads own wallet rows'
);

select is(
  (
    select count(*)::integer
    from onchain.mint_queue
    where id in (
      '00000000-0000-5000-8000-000000000344',
      '00000000-0000-5000-8000-000000000345'
    )
  ),
  1,
  'authenticated user only reads own mint queue rows'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into payments.star_orders (
        user_id, business_type, status, xtr_amount, telegram_invoice_payload, title, idempotency_key
      ) values (
        '00000000-0000-5000-8000-000000000301',
        'gacha_open',
        'created',
        10,
        'phase5-schema-client-write-payment',
        'Client write',
        'phase5-schema-client-write-payment'
      )
    $sql$,
    '%permission denied%'
  ),
  'authenticated user cannot directly insert payments.star_orders'
);

select ok(
  testutil.raises_like(
    $sql$
      insert into onchain.mint_queue (
        user_id, wallet_id, collection_id, item_instance_id, template_id, form_id, status, idempotency_key
      ) values (
        '00000000-0000-5000-8000-000000000301',
        '00000000-0000-5000-8000-000000000321',
        '00000000-0000-5000-8000-000000000341',
        '00000000-0000-5000-8000-000000000342',
        '00000000-0000-5000-8000-000000000313',
        '00000000-0000-5000-8000-000000000314',
        'queued',
        'phase5-schema-client-write-mint'
      )
    $sql$,
    '%permission denied%'
  ),
  'authenticated user cannot directly insert onchain.mint_queue'
);

reset role;

select * from finish();

rollback;
