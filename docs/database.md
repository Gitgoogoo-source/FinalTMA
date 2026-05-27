# 数据库设计记录

## 第五阶段第 03 步：支付 / 钱包 / onchain schema 扩展

本步骤采用方案 1：最小兼容扩展。现有表不重建，`payments.star_orders`
保留历史状态 `precheckout_ok`，同时新增标准状态 `precheckout_checked`、
`fulfilling`、`disputed`。后续 API 可以把 `precheckout_ok` 兼容映射为
`precheckout_checked`，但旧数据不需要迁移。

钱包 challenge 生命周期继续复用 `core.wallet_proofs`，不新增
`core.wallet_connect_sessions`。钱包是否 verified 由
`core.user_wallets.status = 'connected'` 且 `verified_at is not null` 派生。
`wallet_proofs` 新增 `proof_nonce`、`request_id`、`used_at`、
`wallet_public_key`、`proof_hash`，其中 `proof_hash` 使用唯一索引防重放。

支付相关扩展：

- `payments.star_invoices` 增加 `open_mode`、`bot_api_method`、
  `expires_at`、`last_opened_at`，并给 `payload` 增加唯一索引。
- `payments.telegram_webhook_events` 增加处理耗时、重试次数、下次重试时间、
  请求头 hash 和 webhook secret 校验结果。
- `payments.star_orders` 增加 `star_orders_pending_payment_idx` partial index，
  只覆盖 `created`、`invoice_created`、`precheckout_ok`、`precheckout_checked`
  这些仍等待 Telegram 支付完成的订单状态。
- `payments.star_payments.telegram_payment_charge_id` 继续用唯一约束保证支付回调
  只能处理一次。
- Supabase performance advisor 点名的支付 FK 覆盖索引已补齐：
  `payment_disputes.star_order_id`、`payment_disputes.star_payment_id`、
  `star_refunds.user_id`、`telegram_webhook_events.user_id`。

onchain 相关扩展：

- `onchain.mint_queue.status` 扩展为 `queued`、`processing`、`submitted`、
  `confirming`、`retrying`、`manual_review`、`minted`、`failed`、`cancelled`。
- `mint_queue_one_active_per_item` 覆盖所有 active Mint 状态，保证同一藏品不会
  同时存在多个 active Mint 队列。
- `onchain.transactions` 增加 `transaction_type`、`external_api_provider`、
  `last_checked_at`、`check_count`、`raw_response`。
- `onchain.wallet_sync_jobs` 增加 `idempotency_key`、`retry_count`、
  `next_retry_at`、`cursor`。
- Supabase performance advisor 点名的钱包 / onchain FK 覆盖索引已补齐：
  `wallet_proofs.wallet_id`、`mint_queue.collection_id`、
  `mint_queue.wallet_id`、`mint_queue.template_id`、`mint_queue.form_id`、
  `mint_queue.nft_item_id`、`nft_items.template_id`、`nft_items.form_id`、
  `transactions.wallet_id`、`wallet_nft_snapshots.user_id`。

本步骤只允许本地验证，不直接推送远程 Supabase。远程应用前必须先运行
`pnpm test:db`，通过后再单独确认是否执行远程推送。
