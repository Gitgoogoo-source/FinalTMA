-- phase5_secrets_feature_flags.sql
-- Add Phase 5 payment, wallet, mint and operations feature flags.

begin;

insert into ops.feature_flags (key, enabled, description)
values
  ('FEATURE_WALLET_ENABLED', true, 'Allow TON wallet entry points and wallet status UI.'),
  ('FEATURE_STARS_PAYMENT_ENABLED', false, 'Allow creating new Telegram Stars payment orders.'),
  ('FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED', false, 'Allow Telegram payment webhook fulfillment after event persistence.'),
  ('FEATURE_WALLET_PROOF_ENABLED', true, 'Allow TON proof verification for wallet binding.'),
  ('FEATURE_WALLET_SYNC_ENABLED', true, 'Allow wallet NFT and onchain state synchronization.'),
  ('FEATURE_TON_MINT_ENABLED', false, 'Allow users to request NFT minting.'),
  ('FEATURE_MINT_WORKER_ENABLED', false, 'Allow scheduled mint worker execution.'),
  ('FEATURE_ADMIN_PAYMENT_OPS_ENABLED', false, 'Allow admin payment operations surfaces.')
on conflict (key) do update
set description = excluded.description;

insert into ops.system_settings (key, value, description)
values
  (
    'PAYMENT_SUPPORT_CONFIG',
    '{"support_url":null,"support_email":null,"configured":false}'::jsonb,
    'Non-sensitive payment support contact configuration. Real secrets must stay in server env.'
  ),
  (
    'STARS_OPEN_ORDER_POLICY',
    '{"expires_minutes":15,"webhook_idempotency_ttl_seconds":86400}'::jsonb,
    'Non-sensitive Telegram Stars open-order expiry and webhook idempotency policy.'
  ),
  (
    'TON_MINT_RETRY_POLICY',
    '{"batch_size":10,"max_retries":5,"retry_delay_seconds":60,"confirmation_timeout_seconds":300}'::jsonb,
    'Non-sensitive TON mint worker retry policy.'
  ),
  (
    'WALLET_SYNC_POLICY',
    '{"enabled":true,"batch_size":50,"cache_ttl_seconds":300}'::jsonb,
    'Non-sensitive wallet NFT sync policy.'
  )
on conflict (key) do update
set description = excluded.description;

commit;
