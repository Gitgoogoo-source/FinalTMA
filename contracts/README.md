# TON NFT Collection

This folder contains the TON NFT Collection and NFT Item contracts used by the
Telegram Mini App collectible mint flow.

## Current Collection Configuration

The real Collection address is not configured in this repository yet. Do not use
placeholder addresses in production or in a remote Supabase rollout.

When the Collection is deployed, record the public values in
`onchain.nft_collections`:

| Field                | Source                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `network`            | `mainnet` or `testnet`, matching the deployed Collection and user wallet network.                |
| `collection_address` | Public deployed TON Collection address.                                                          |
| `owner_address`      | Public Collection owner or minter admin address.                                                 |
| `metadata_url`       | `NFT_COLLECTION_METADATA_URI`, for example `/nft-metadata/collection.json` in local development. |
| `content_base_url`   | `NFT_ITEM_METADATA_BASE_URI`, for example `/nft-metadata/items` in local development.            |
| `royalty_config`     | Public royalty parameters only. Do not store private keys.                                       |

Server-only secrets such as `TON_MINTER_PRIVATE_KEY` or
`TON_MINTER_MNEMONIC` must stay in Vercel environment variables and must never
be committed.

## Metadata Rules

Phase 5 uses static public metadata under
`apps/web/public/nft-metadata/` before the Mint worker is wired:

- Collection metadata: `/nft-metadata/collection.json`
- Item metadata: `/nft-metadata/items/{template_slug}.json`
- NFT image fallback: existing collectible card media under
  `/storage/v1/object/public/collectibles/{template_slug}_card.png`

The database mirrors these public paths in `catalog.collectible_media` using
the `metadata` and `nft_image` media types. The frontend may display these
values, but the frontend must not generate or override metadata for Mint.

The Mint worker must generate the final item metadata snapshot on the backend
from database-owned catalog and inventory state before submitting a chain
transaction.

## Deployment Notes

For local development, `.env.example` points metadata variables to the Vite
public directory:

```bash
NFT_METADATA_BASE_URL=http://localhost:5173/nft-metadata
NFT_COLLECTION_METADATA_URI=http://localhost:5173/nft-metadata/collection.json
NFT_ITEM_METADATA_BASE_URI=http://localhost:5173/nft-metadata/items
```

For preview or production, replace these with stable HTTPS URLs and insert the
matching active row into `onchain.nft_collections` only after the real TON
Collection address is known.
