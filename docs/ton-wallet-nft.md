# TON Wallet / NFT Mint Worker

## Scope

This document covers the phase-5 Mint worker and on-chain transaction sync
runtime. The database schema and RPCs are already provided by the phase-5
onchain migrations:

- `onchain.mint_queue`
- `onchain.transactions`
- `onchain.nft_items`
- `api.wallet_enqueue_mint`
- `api.onchain_mark_mint_success`
- `api.onchain_mark_mint_failed`

No private key, mnemonic, service-role key or provider token may be exposed to
frontend code.

## Runtime Flow

1. `/api/wallet/mint` validates the app session, verified TON wallet, item
   ownership and mintability, then calls `api.wallet_enqueue_mint`.
2. `api.wallet_enqueue_mint` locks the item and creates a `queued` row in
   `onchain.mint_queue`.
3. `/api/cron/retry-mint-queue` validates `CRON_SECRET`, checks
   `FEATURE_MINT_WORKER_ENABLED` and `TON_MINT_ENABLED`, claims due
   `queued/retrying` rows by conditional update, and marks them `processing`.
4. The worker sends a normalized server-side Mint request to the configured
   provider adapter.
5. The worker writes or updates `onchain.transactions` with `tx_hash`,
   `query_id`, `status`, provider name and `raw_response`.
6. Submitted transactions move the queue to `submitted` or `confirming`.
7. `/api/cron/sync-onchain-transactions` polls pending Mint transactions.
8. Confirmed transactions call `api.onchain_mark_mint_success`, which binds
   `onchain.nft_items` and updates the item instance.
9. Retryable failures move the queue to `retrying`; exhausted or unsafe states
   move it to `manual_review`.

## Provider Adapter Contract

The default adapter in `packages/server/src/ton/nft.ts` is intentionally an HTTP
adapter. It does not guess the Collection Mint ABI while the contract package is
still placeholder-only.

Set these server-only environment variables when a real Mint provider is ready:

- `TON_MINT_PROVIDER_URL` or `TON_NFT_MINT_PROVIDER_URL`
- `TON_TRANSACTION_PROVIDER_URL` or `TON_NFT_TX_PROVIDER_URL`
- `TON_MINT_PROVIDER_TOKEN` or `TON_NFT_PROVIDER_TOKEN`
- `TON_NFT_PROVIDER_NAME`

Mint submit request shape:

```json
{
  "operation": "mint_collection_item",
  "request_id": "req_...",
  "query_id": "mint:<mint_queue_id>:<attempt>",
  "mint_queue_id": "...",
  "idempotency_key": "...",
  "attempt_count": 1,
  "collection": {
    "id": "...",
    "network": "testnet",
    "collection_address": "EQ...",
    "collection_address_raw": "0:...",
    "metadata_url": "...",
    "content_base_url": "..."
  },
  "target_wallet": {
    "id": "...",
    "address": "EQ...",
    "address_raw": "0:...",
    "network": "testnet"
  },
  "item": {
    "item_instance_id": "...",
    "template_id": "...",
    "form_id": "...",
    "metadata_url": "...",
    "metadata": {}
  }
}
```

Accepted submit response fields:

```json
{
  "status": "submitted | confirming | minted",
  "tx_hash": "...",
  "query_id": "...",
  "item_address": "EQ...",
  "item_index": 1,
  "owner_address": "EQ...",
  "metadata_url": "...",
  "external_api_provider": "provider-name"
}
```

Transaction query request shape:

```json
{
  "operation": "query_transaction_status",
  "request_id": "req_...",
  "transaction_id": "...",
  "tx_hash": "...",
  "query_id": "...",
  "network": "testnet",
  "collection_address": "EQ...",
  "related_id": "mint_queue_id"
}
```

Accepted query response fields:

```json
{
  "status": "pending | confirmed | failed | expired",
  "tx_hash": "...",
  "query_id": "...",
  "item_address": "EQ...",
  "item_index": 1,
  "owner_address": "EQ...",
  "metadata_url": "...",
  "error_message": null,
  "external_api_provider": "provider-name"
}
```

## Safety Notes

- Worker claims use conditional updates on `id`, `status` and `next_attempt_at`
  so concurrent cron invocations do not both submit the same due row.
- If a provider timeout may have submitted a transaction, the worker stores the
  deterministic `query_id` and marks the row for recovery instead of blindly
  resubmitting.
- `api.onchain_mark_mint_success` remains the source of truth for binding
  NFT item rows and item instance status.
- `manual_review` keeps the item lock in place for operations review; it does
  not release the item as a terminal failure.
- Real TON minter keys must stay in Vercel server environment variables.
