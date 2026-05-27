-- phase5_fk_covering_indexes.sql
-- Cover Phase 5 payment, wallet and onchain foreign keys reported by the
-- Supabase performance advisor. These indexes are additive only.

create index if not exists wallet_proofs_wallet_id_idx
  on core.wallet_proofs (wallet_id);

create index if not exists mint_queue_collection_id_idx
  on onchain.mint_queue (collection_id);
create index if not exists mint_queue_form_id_idx
  on onchain.mint_queue (form_id);
create index if not exists mint_queue_nft_item_id_idx
  on onchain.mint_queue (nft_item_id);
create index if not exists mint_queue_template_id_idx
  on onchain.mint_queue (template_id);
create index if not exists mint_queue_wallet_id_idx
  on onchain.mint_queue (wallet_id);

create index if not exists nft_items_form_id_idx
  on onchain.nft_items (form_id);
create index if not exists nft_items_template_id_idx
  on onchain.nft_items (template_id);

create index if not exists onchain_transactions_wallet_id_idx
  on onchain.transactions (wallet_id);

create index if not exists wallet_nft_snapshots_user_id_idx
  on onchain.wallet_nft_snapshots (user_id);

create index if not exists payment_disputes_star_order_idx
  on payments.payment_disputes (star_order_id);
create index if not exists payment_disputes_star_payment_idx
  on payments.payment_disputes (star_payment_id);

create index if not exists star_refunds_user_idx
  on payments.star_refunds (user_id);

create index if not exists telegram_webhook_events_user_idx
  on payments.telegram_webhook_events (user_id);
