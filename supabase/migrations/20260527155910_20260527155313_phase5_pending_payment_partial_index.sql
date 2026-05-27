-- phase5_pending_payment_partial_index.sql
-- Add the dedicated Phase 5 partial index for payment orders that are still
-- waiting for Telegram payment completion.

create index if not exists star_orders_pending_payment_idx
  on payments.star_orders (status, expires_at, created_at desc)
  where status in ('created', 'invoice_created', 'precheckout_ok', 'precheckout_checked');
