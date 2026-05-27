# 第五阶段密钥与 Feature Flag 管理

本文记录第五阶段 Telegram Stars、TON 钱包、Mint、链上同步和后台运营相关的环境变量边界。真实密钥只允许存在于 Vercel server env、Supabase Secrets 或本地未提交的 `.env`。

## 前端可见变量

前端只能读取 `VITE_` 开头的公开变量，例如：

- `VITE_PUBLIC_BASE_URL`
- `VITE_API_BASE_URL`
- `VITE_TG_BOT_USERNAME`
- `VITE_TONCONNECT_MANIFEST_URL`
- `VITE_ENABLE_TON_CONNECT`
- `VITE_SENTRY_DSN`

禁止把 `Bot Token`、`service role key`、`Supabase secret key`、`webhook secret`、`TON minter private key`、`session secret`、`cron secret` 写成 `VITE_`。

## Vercel Server Env

以下变量必须只配置在 Vercel server env 或本地 `.env`：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `SUPABASE_SECRET_KEY` 或 `SUPABASE_SERVICE_ROLE_KEY`
- `APP_SESSION_SECRET`
- `IDEMPOTENCY_SECRET`
- `CRON_SECRET`
- `TON_API_KEY`
- `TONCENTER_API_KEY`
- `TON_MINTER_PRIVATE_KEY` 或 `TON_MINTER_MNEMONIC`
- `ADMIN_SESSION_SECRET`

Production 环境必须保证 `DEV_GACHA_PAYMENT_MODE=false`。支付、webhook fulfillment、Mint worker 和链上同步应通过 `ops.feature_flags` 保留紧急暂停能力。

## Feature Flags

`ops.feature_flags` 是后台和运行时开关来源。第 02 步补齐的第五阶段开关如下：

| Key                                           | 默认值  | 作用                                       |
| --------------------------------------------- | ------- | ------------------------------------------ |
| `FEATURE_WALLET_ENABLED`                      | `true`  | 钱包入口总开关。                           |
| `FEATURE_STARS_PAYMENT_ENABLED`               | `false` | 是否允许创建新的 Telegram Stars 支付订单。 |
| `FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED` | `false` | webhook 可落库，但关闭时不触发发货。       |
| `FEATURE_WALLET_PROOF_ENABLED`                | `true`  | TON proof 验证开关。                       |
| `FEATURE_WALLET_SYNC_ENABLED`                 | `true`  | 链上 NFT 同步开关。                        |
| `FEATURE_TON_MINT_ENABLED`                    | `false` | 用户 Mint 请求开关。                       |
| `FEATURE_MINT_WORKER_ENABLED`                 | `false` | Mint worker 执行开关。                     |
| `FEATURE_ADMIN_PAYMENT_OPS_ENABLED`           | `false` | 支付后台运营开关。                         |

运行时代码优先读取新增 `FEATURE_*` key；如果远程库缺少新 key，再 fallback 到旧 key，例如 `gacha.open_box`、`wallet.ton_connect` 和 `onchain.mint`。新增 `FEATURE_*` key 不应删除或重命名旧 key。

## System Settings

`ops.system_settings` 只放非敏感运营配置，例如：

- `PAYMENT_SUPPORT_CONFIG`
- `STARS_OPEN_ORDER_POLICY`
- `TON_MINT_RETRY_POLICY`
- `WALLET_SYNC_POLICY`

真实地址、私钥、token、service role key 不得写入 `ops.system_settings`。

## 审计要求

后台修改 feature flag 或 system setting 时必须写入 `ops.admin_audit_logs`，至少包含操作人、目标 key、before/after、原因、request id、IP hash 和 user agent。

## 轮换与事故处理

- `TELEGRAM_WEBHOOK_SECRET` 泄漏：立即更换 secret，关闭 `FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED`，检查 `payments.telegram_webhook_events`。
- `TON_MINTER_PRIVATE_KEY` 泄漏：关闭 `FEATURE_TON_MINT_ENABLED`、`FEATURE_MINT_WORKER_ENABLED` 和 `TON_MINT_ENABLED`，迁移 minter 权限。
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` 泄漏：立即轮换，审查后台/API 日志，确认没有异常资产写入。
- 支付异常：优先关闭新支付，不删除订单，已支付未发货订单仍应允许后台幂等补发。
