-- phase5_payment_wallet_onchain_schema.sql
-- Extend existing payment, wallet and onchain tables for Phase 5 without rebuilding data.

begin;

-- Payments: keep the historical precheckout_ok status, and add the Phase 5 names
-- required by the webhook and fulfillment state machine.
alter table payments.star_orders
  drop constraint if exists star_orders_status_check;

alter table payments.star_orders
  add constraint star_orders_status_check
  check (
    status in (
      'created',
      'invoice_created',
      'precheckout_ok',
      'precheckout_checked',
      'paid',
      'fulfilling',
      'fulfilled',
      'cancelled',
      'expired',
      'failed',
      'refunded',
      'disputed'
    )
  );

comment on constraint star_orders_status_check on payments.star_orders
  is 'Phase 5 payment state machine. precheckout_ok remains for backward compatibility; precheckout_checked is the canonical new state.';

alter table payments.star_invoices
  add column if not exists open_mode text,
  add column if not exists bot_api_method text,
  add column if not exists expires_at timestamptz,
  add column if not exists last_opened_at timestamptz;

update payments.star_invoices
set open_mode = coalesce(open_mode, 'telegram_link')
where open_mode is null;

alter table payments.star_invoices
  alter column open_mode set default 'telegram_link',
  alter column open_mode set not null;

alter table payments.star_invoices
  drop constraint if exists star_invoices_open_mode_check;

alter table payments.star_invoices
  add constraint star_invoices_open_mode_check
  check (open_mode in ('telegram_link', 'web_app_open_invoice', 'bot_api', 'unknown'));

comment on column payments.star_invoices.open_mode is 'How the invoice is expected to be opened by the client or bot.';
comment on column payments.star_invoices.invoice_link is 'Telegram invoice link returned by the Bot API when available.';
comment on column payments.star_invoices.bot_api_method is 'Telegram Bot API method used to create or send this invoice.';
comment on column payments.star_invoices.expires_at is 'Invoice expiry copied from the application payment order when applicable.';
comment on column payments.star_invoices.last_opened_at is 'Last time the client reported opening the invoice.';

alter table payments.telegram_webhook_events
  add column if not exists processing_duration_ms integer,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists request_headers_hash text,
  add column if not exists webhook_secret_verified boolean not null default false;

alter table payments.telegram_webhook_events
  drop constraint if exists telegram_webhook_events_processing_duration_ms_check,
  drop constraint if exists telegram_webhook_events_retry_count_check;

alter table payments.telegram_webhook_events
  add constraint telegram_webhook_events_processing_duration_ms_check
  check (processing_duration_ms is null or processing_duration_ms >= 0),
  add constraint telegram_webhook_events_retry_count_check
  check (retry_count >= 0);

comment on column payments.telegram_webhook_events.processing_duration_ms is 'Webhook processing duration in milliseconds, recorded by the server handler.';
comment on column payments.telegram_webhook_events.retry_count is 'Number of retry attempts scheduled or performed for this webhook event.';
comment on column payments.telegram_webhook_events.next_retry_at is 'Next time a failed webhook event may be retried.';
comment on column payments.telegram_webhook_events.request_headers_hash is 'Hash of selected request headers for audit without storing raw secrets.';
comment on column payments.telegram_webhook_events.webhook_secret_verified is 'Whether the server verified the configured Telegram webhook secret for this request.';

-- Wallet proof:方案 1 reuses core.wallet_proofs as the challenge lifecycle table.
alter table core.wallet_proofs
  add column if not exists proof_nonce text,
  add column if not exists request_id text,
  add column if not exists used_at timestamptz,
  add column if not exists wallet_public_key text,
  add column if not exists proof_hash text;

comment on table core.wallet_proofs is 'TON Connect proof challenges and verification results. Phase 5 reuses this table for challenge lifecycle; proof_hash and used_at prevent replay.';
comment on column core.wallet_proofs.proof_nonce is 'Nonce extracted from or associated with the ton_proof payload.';
comment on column core.wallet_proofs.request_id is 'Server request id that created or verified the challenge.';
comment on column core.wallet_proofs.used_at is 'Set when the challenge has been consumed, regardless of verification result.';
comment on column core.wallet_proofs.wallet_public_key is 'Wallet public key used during ton_proof verification when available.';
comment on column core.wallet_proofs.proof_hash is 'Stable hash of the submitted proof payload to reject replay.';

comment on column core.user_wallets.status is 'Connection lifecycle state. Verified wallet state is derived from status=connected and verified_at is not null.';
comment on column core.user_wallets.verified_at is 'When set with status=connected, the wallet is treated as backend verified.';

-- Mint queue: extend worker states while keeping existing terminal states.
alter table onchain.mint_queue
  drop constraint if exists mint_queue_status_check;

alter table onchain.mint_queue
  add constraint mint_queue_status_check
  check (
    status in (
      'queued',
      'processing',
      'submitted',
      'confirming',
      'minted',
      'failed',
      'retrying',
      'manual_review',
      'cancelled'
    )
  );

drop index if exists onchain.mint_queue_one_active_per_item;

create unique index if not exists mint_queue_one_active_per_item
  on onchain.mint_queue (item_instance_id)
  where status in ('queued', 'processing', 'submitted', 'confirming', 'retrying', 'manual_review');

comment on constraint mint_queue_status_check on onchain.mint_queue
  is 'Phase 5 Mint worker lifecycle: queued, processing, submitted, confirming, retrying, manual_review and terminal states.';

alter table onchain.transactions
  add column if not exists transaction_type text,
  add column if not exists external_api_provider text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists check_count integer not null default 0,
  add column if not exists raw_response jsonb not null default '{}'::jsonb;

update onchain.transactions
set transaction_type = coalesce(transaction_type, related_type, 'unknown')
where transaction_type is null;

alter table onchain.transactions
  alter column transaction_type set default 'unknown',
  alter column transaction_type set not null,
  alter column raw_response set default '{}'::jsonb,
  alter column raw_response set not null;

alter table onchain.transactions
  drop constraint if exists transactions_check_count_check;

alter table onchain.transactions
  add constraint transactions_check_count_check
  check (check_count >= 0);

comment on column onchain.transactions.transaction_type is 'High-level transaction category, for example mint, transfer or wallet_sync.';
comment on column onchain.transactions.external_api_provider is 'TON API provider used for the latest status check.';
comment on column onchain.transactions.last_checked_at is 'Last time a worker checked this transaction on-chain.';
comment on column onchain.transactions.check_count is 'Number of on-chain status checks.';
comment on column onchain.transactions.raw_response is 'Latest raw provider response, stored server-side for ops diagnostics.';

alter table onchain.wallet_sync_jobs
  add column if not exists idempotency_key text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists cursor text;

alter table onchain.wallet_sync_jobs
  drop constraint if exists wallet_sync_jobs_retry_count_check;

alter table onchain.wallet_sync_jobs
  add constraint wallet_sync_jobs_retry_count_check
  check (retry_count >= 0);

comment on column onchain.wallet_sync_jobs.idempotency_key is 'Optional idempotency key for user-triggered or scheduled wallet sync jobs.';
comment on column onchain.wallet_sync_jobs.retry_count is 'Number of retry attempts for this sync job.';
comment on column onchain.wallet_sync_jobs.next_retry_at is 'Next time a failed or queued sync job may be retried.';
comment on column onchain.wallet_sync_jobs.cursor is 'Provider pagination cursor for incremental wallet sync.';

-- Phase 5 read and worker indexes. These are intentionally additive and do not
-- weaken existing RLS or service-role-only write paths.
create index if not exists star_orders_status_created_idx
  on payments.star_orders (status, created_at desc);
create index if not exists star_orders_business_idx
  on payments.star_orders (business_type, business_id);

create unique index if not exists star_invoices_payload_unique_idx
  on payments.star_invoices (payload);
create index if not exists star_invoices_star_order_idx
  on payments.star_invoices (star_order_id);
create index if not exists star_invoices_status_created_idx
  on payments.star_invoices (status, created_at desc);

create index if not exists star_payments_star_order_idx
  on payments.star_payments (star_order_id);
create index if not exists star_payments_invoice_payload_idx
  on payments.star_payments (invoice_payload);

create index if not exists telegram_webhook_events_event_created_idx
  on payments.telegram_webhook_events (event_type, created_at desc);
create index if not exists telegram_webhook_events_invoice_payload_idx
  on payments.telegram_webhook_events (invoice_payload);
create index if not exists telegram_webhook_events_retry_idx
  on payments.telegram_webhook_events (process_status, next_retry_at, created_at)
  where process_status in ('received', 'failed');

create index if not exists star_refunds_order_idx
  on payments.star_refunds (star_order_id);
create index if not exists star_refunds_payment_idx
  on payments.star_refunds (star_payment_id);
create index if not exists star_refunds_status_created_idx
  on payments.star_refunds (status, created_at desc);
create index if not exists payment_disputes_status_created_idx
  on payments.payment_disputes (status, created_at desc);
create index if not exists payment_disputes_user_created_idx
  on payments.payment_disputes (user_id, created_at desc);

create index if not exists user_wallets_verified_idx
  on core.user_wallets (user_id, verified_at desc)
  where status = 'connected' and verified_at is not null;
create index if not exists wallet_proofs_user_status_idx
  on core.wallet_proofs (user_id, status, created_at desc);
create index if not exists wallet_proofs_status_expires_idx
  on core.wallet_proofs (status, expires_at);
create index if not exists wallet_proofs_address_idx
  on core.wallet_proofs (address);
create unique index if not exists wallet_proofs_request_id_unique_idx
  on core.wallet_proofs (request_id)
  where request_id is not null;
create unique index if not exists wallet_proofs_proof_hash_unique_idx
  on core.wallet_proofs (proof_hash)
  where proof_hash is not null;

create index if not exists nft_collections_status_network_idx
  on onchain.nft_collections (status, network);
create index if not exists nft_items_item_address_idx
  on onchain.nft_items (item_address);
create index if not exists mint_queue_user_created_idx
  on onchain.mint_queue (user_id, created_at desc);
create index if not exists mint_queue_item_instance_idx
  on onchain.mint_queue (item_instance_id);
create index if not exists mint_queue_processing_idx
  on onchain.mint_queue (status, next_attempt_at, priority, created_at)
  where status in ('queued', 'retrying', 'processing');

create index if not exists onchain_transactions_status_created_idx
  on onchain.transactions (status, created_at desc);
create index if not exists onchain_transactions_user_created_idx
  on onchain.transactions (user_id, created_at desc);
create index if not exists onchain_transactions_query_id_idx
  on onchain.transactions (query_id)
  where query_id is not null;

create unique index if not exists wallet_sync_jobs_idempotency_key_unique_idx
  on onchain.wallet_sync_jobs (idempotency_key)
  where idempotency_key is not null;
create index if not exists wallet_sync_jobs_wallet_status_idx
  on onchain.wallet_sync_jobs (wallet_id, status, created_at desc);
create index if not exists wallet_sync_jobs_retry_idx
  on onchain.wallet_sync_jobs (status, next_retry_at, created_at)
  where status in ('queued', 'failed');

create index if not exists wallet_nft_snapshots_wallet_seen_idx
  on onchain.wallet_nft_snapshots (wallet_id, seen_at desc);
create index if not exists wallet_nft_snapshots_item_address_idx
  on onchain.wallet_nft_snapshots (item_address);
create index if not exists wallet_nft_snapshots_collection_idx
  on onchain.wallet_nft_snapshots (collection_address);

create index if not exists reconciliation_runs_type_started_idx
  on economy.reconciliation_runs (run_type, started_at desc);
create index if not exists reconciliation_runs_status_started_idx
  on economy.reconciliation_runs (status, started_at desc);

commit;
