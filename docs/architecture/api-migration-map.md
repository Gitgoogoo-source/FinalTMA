# API 一次性迁移映射

本清单冻结于 2026-07-18，与 `packages/contracts/src/routes.ts` 同步。切换不设双轨和兼容窗口。

## C1：完整兼容

保留 method、path、HTTP status、成功/失败包装、字段名、类型和 nullability：

- `GET /api/health`
- `GET /api/me/assets`
- `POST /api/wallet/challenge`
- `POST /api/wallet/connect`
- `POST /api/wallet/proof`
- `GET /api/wallet/status`
- `POST /api/wallet/disconnect`
- `GET /api/telegram/payment-support`
- `POST /api/telegram/webhook`

内部实现已改为新 gateway、service module 与 PostgreSQL RPC；兼容字段只存在于 HTTP adapter。

## C2：只兼容 method/path

以下路径的输入、响应和错误已按功能说明一次性替换：

```text
POST /api/auth/telegram
GET  /api/me/bootstrap
GET  /api/boxes/list
GET  /api/boxes/rewards
POST /api/boxes/create-open-order
GET  /api/boxes/pity
GET  /api/boxes/result
POST /api/payments/kcoin-topup/create-order
GET  /api/payments/kcoin-topup/status
GET  /api/inventory/list
GET  /api/inventory/summary
GET  /api/inventory/group-items
GET  /api/inventory/detail
POST /api/inventory/evolve
POST /api/inventory/decompose
GET  /api/market/listings
POST /api/market/buy
GET  /api/market/sellable-items
GET  /api/market/sell-rules
POST /api/market/create-listing
GET  /api/market/my-listings
GET  /api/market/my-listing-stats
POST /api/market/cancel-listing
GET  /api/album/progress
GET  /api/album/items
POST /api/album/claim-reward
GET  /api/tasks/list
GET  /api/tasks/overview
POST /api/tasks/claim
GET  /api/tasks/check-in-status
POST /api/tasks/check-in
GET  /api/tasks/invite-stats
GET  /api/tasks/referral-link
GET  /api/tasks/prepared-share-message
POST /api/tasks/bind-referral
POST /api/tasks/share-event
GET  /api/vip/status
POST /api/vip/create-order
POST /api/vip/claim-daily
POST /api/vip/claim-free-box
POST /api/wallet/mint
GET  /api/wallet/mint-status
```

C2/C4 的已认证业务写接口必须提供 UUID `Idempotency-Key`，该值同时作为可由客户端持有的 `operation_id`。成功返回 `data + request_id + operation_id`；失败返回稳定 `code/message/retryable + request_id + operation_id`。`POST /api/auth/telegram` 是无业务资产写入的短会话交换：它不创建业务 operation，也不允许重放取回 token，因为数据库按安全约束只存 token hash。

## C3：删除或替换

以下旧路径不再注册，统一 `404 API_ROUTE_NOT_FOUND`：

| 删除路径                                                                | 一次性替代                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `/api/auth/refresh`、`/api/auth/logout`                                 | 15 分钟内存令牌；自然过期最多自动交换一次 Telegram 身份 |
| `/api/me/profile`                                                       | `/api/me/bootstrap`                                     |
| `/api/me/notifications`、`/api/banners/list`                            | 删除，无替代                                            |
| `/api/boxes/history`、`/api/boxes/payment-status`                       | `/api/boxes/result` 只恢复原操作                        |
| `/api/boxes/open-vip-daily`                                             | `/api/vip/claim-free-box` 后走标准开盒                  |
| `/api/game/placeholder`                                                 | C4 远征与转盘                                           |
| `/api/inventory/upgrade`、`/api/inventory/activity`                     | 删除，无替代                                            |
| `/api/inventory/sell-entry`、`/api/inventory/cancel-sell`               | 市场创建/取消接口                                       |
| `/api/market/listing-detail`                                            | `/api/market/template-detail`                           |
| `/api/market/update-price`、`/api/market/stats`                         | 删除；市场固定官方价格                                  |
| `/api/album/series`                                                     | `/api/catalog` 与 `/api/album/progress`                 |
| `/api/album/leaderboard`                                                | 删除，无替代                                            |
| `/api/tasks/referral-records`                                           | `/api/tasks/invite-stats`                               |
| `/api/tasks/commission-history`、`/api/tasks/claim-commission`          | 删除；不存在佣金                                        |
| `/api/tasks/reward-history`                                             | `/api/tasks/overview`                                   |
| `/api/telegram/commands`                                                | webhook 内部处理                                        |
| `/api/telegram/share`                                                   | Telegram 客户端分享能力                                 |
| `/api/wallet/sync-nfts`、`/api/wallet/nfts`、`/api/wallet/transactions` | 删除；Mint 只恢复本次操作                               |

## C4：新增

```text
GET  /api/catalog
GET  /api/market/template-detail
GET  /api/expeditions/bootstrap
GET  /api/expeditions/eligible-items
POST /api/expeditions/create
POST /api/expeditions/claim
GET  /api/expeditions/result
GET  /api/wheel/bootstrap
POST /api/wheel/spin
GET  /api/wheel/result
GET  /api/operations/result
GET  /api/nft-metadata/:nft_id
```

`operations.result` 只允许读取当前用户自己的操作。NFT metadata 为 TON 客户端直接读取的标准公开 JSON，因此该路径不套业务 API envelope，只返回 Mint 成功时冻结的公开快照，并使用 immutable cache；这是 C2/C4 通用包装的唯一协议例外。
