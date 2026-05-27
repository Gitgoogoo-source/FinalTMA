# 第五阶段基线数据库快照

生成时间：2026-05-27 19:26-19:48 Asia/Shanghai

范围：记录《第五阶段开发指南.md》4.1「数据库开发工作」「安全和幂等要求」与「验收标准」的基线。不新增业务能力，不新增 SQL migration，不推送远程 Supabase。

## 数据来源

- 远程 Supabase 项目：`omopnbourswzyeigotbs`
- 远程数据库：Postgres 17.6.1.121，状态 `ACTIVE_HEALTHY`
- 远程真值读取方式：Supabase MCP 只读查询
- 本地仓库读取方式：`supabase/migrations/*.sql`
- Supabase changelog 已检查；本次仅做只读快照，不创建新表，不受新表 Data API 默认暴露规则影响。

## Migration 基线

远程最新 migration：

| version          | name                                                 |
| ---------------- | ---------------------------------------------------- |
| `20260527045136` | `20260527044358_phase4_redact_commission_source_ids` |

本地最新 migration 文件：

| file                                                     |
| -------------------------------------------------------- |
| `20260527044358_phase4_redact_commission_source_ids.sql` |

计数：

| 来源                                         | 数量 |
| -------------------------------------------- | ---: |
| 远程 `supabase_migrations.schema_migrations` |   86 |
| 本地 `supabase/migrations/*.sql`             |   82 |

差异说明：

- 远程最新版本与 4.1 指定的 `20260527045136 phase4_redact_commission_source_ids` 一致。
- 本地最新文件名是 `20260527044358_phase4_redact_commission_source_ids.sql`，远程记录的 `name` 保留了这个本地源文件名，远程 `version` 是实际应用时的版本号。
- 远程数量比本地多 4 条，主要来自本地 `20260524121704_phase3_growth_rpc_queries.sql` 在远程历史中被拆成 `part1` 到 `part5` 五条记录。
- 另有多条远程 migration 使用“远程应用 version + 本地源文件名”的形式记录，例如远程 `20260526182714 / 20260526182022_phase4_claim_commission_balance_fields`。这是 migration 历史命名差异，不代表本次新增 schema。
- 本地 CLI `supabase migration list --linked` 因缺少 `SUPABASE_ACCESS_TOKEN` 无法生成 linked diff；本快照以 Supabase MCP 远程读取结果为准。

## Payments / Onchain 表状态

所有下列表均已存在且启用 RLS。

| 表                                 | 远程行数 | 当前状态摘要                                                                                                        |
| ---------------------------------- | -------: | ------------------------------------------------------------------------------------------------------------------- |
| `payments.star_orders`             |        6 | `business_type=gacha_open`，`status=fulfilled` 共 6 行；时间范围 2026-05-22 06:17:21 UTC 到 2026-05-26 18:19:18 UTC |
| `payments.star_invoices`           |        0 | 无 invoice 记录                                                                                                     |
| `payments.star_payments`           |        6 | `currency=XTR` 共 6 行；时间范围 2026-05-22 06:17:21 UTC 到 2026-05-26 18:19:18 UTC                                 |
| `payments.telegram_webhook_events` |        0 | 无 webhook 事件                                                                                                     |
| `payments.star_refunds`            |        0 | 无退款记录                                                                                                          |
| `payments.payment_disputes`        |        0 | 无争议记录                                                                                                          |
| `onchain.nft_collections`          |        0 | 无链上 collection 数据                                                                                              |
| `onchain.nft_items`                |        0 | 无链上 NFT item 数据                                                                                                |
| `onchain.mint_queue`               |        0 | 无 Mint 队列数据                                                                                                    |
| `onchain.transactions`             |        0 | 无链上交易数据                                                                                                      |
| `onchain.wallet_sync_jobs`         |        0 | 无钱包同步任务                                                                                                      |
| `onchain.wallet_nft_snapshots`     |        0 | 无钱包 NFT 快照                                                                                                     |

上线风险标记：

- `payments.star_orders` 和 `payments.star_payments` 当前各有 6 行已完成的 `gacha_open` / `XTR` 数据，但 `star_invoices` 与 `telegram_webhook_events` 均为 0。第五阶段上线前必须把这些记录视为 dev / smoke 基线数据，不应当误判为正式 Telegram Stars webhook 全链路数据。
- `onchain` schema 当前没有业务行，第五阶段 Mint / 同步上线前可作为空基线。

## 当前 Schema 摘要

| schema     | table                     | columns |
| ---------- | ------------------------- | ------: |
| `payments` | `star_orders`             |      18 |
| `payments` | `star_invoices`           |       9 |
| `payments` | `star_payments`           |      12 |
| `payments` | `telegram_webhook_events` |      11 |
| `payments` | `star_refunds`            |      14 |
| `payments` | `payment_disputes`        |      13 |
| `onchain`  | `nft_collections`         |      16 |
| `onchain`  | `nft_items`               |      17 |
| `onchain`  | `mint_queue`              |      20 |
| `onchain`  | `transactions`            |      18 |
| `onchain`  | `wallet_sync_jobs`        |      11 |
| `onchain`  | `wallet_nft_snapshots`    |      10 |

当前重要状态约束快照：

- `payments.star_orders.status` 当前允许：`created`、`invoice_created`、`precheckout_ok`、`paid`、`fulfilled`、`cancelled`、`expired`、`failed`、`refunded`。
- `payments.star_invoices.status` 当前允许：`created`、`sent`、`opened`、`paid`、`expired`、`failed`。
- `payments.telegram_webhook_events.process_status` 当前允许：`received`、`processing`、`processed`、`ignored`、`failed`。
- `onchain.mint_queue.status` 当前允许：`queued`、`processing`、`minted`、`failed`、`cancelled`。
- `onchain.transactions.status` 当前允许：`pending`、`confirmed`、`failed`、`expired`。
- `onchain.wallet_sync_jobs.status` 当前允许：`queued`、`processing`、`success`、`failed`。

## RPC 签名快照

4.1 点名 RPC 的远程签名均已读取。下列函数均为 `SECURITY DEFINER`，且 `anon` / `authenticated` 不具备执行权限。

| RPC                                   | 参数                                                                                                               | 返回    | service_role |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- | ------------ |
| `api.gacha_create_order`              | `p_user_id uuid, p_box_id uuid, p_quantity integer, p_idempotency_key text`                                        | `jsonb` | yes          |
| `api.gacha_process_dev_paid_order`    | `p_order_id uuid, p_user_id uuid`                                                                                  | `jsonb` | yes          |
| `api.gacha_get_draw_result`           | `p_user_id uuid, p_draw_order_id uuid, p_invoice_payload text`                                                     | `jsonb` | yes          |
| `api.task_daily_check_in`             | `p_user_id uuid`                                                                                                   | `jsonb` | yes          |
| `api.task_daily_check_in`             | `p_user_id uuid, p_campaign_id uuid, p_local_date date, p_timezone_offset_minutes integer, p_idempotency_key text` | `jsonb` | yes          |
| `api.task_claim_reward`               | `p_user_id uuid, p_task_id uuid, p_period_key text`                                                                | `jsonb` | yes          |
| `api.task_claim_reward`               | `p_user_id uuid, p_task_id uuid, p_period_key text, p_idempotency_key text`                                        | `jsonb` | yes          |
| `api.task_get_list`                   | `p_user_id uuid, p_filters jsonb`                                                                                  | `jsonb` | yes          |
| `api.task_record_progress`            | `p_user_id uuid, p_action text, p_amount integer, p_source_id uuid, p_period_key text`                             | `jsonb` | yes          |
| `api.referral_bind_inviter`           | `p_invitee_user_id uuid, p_invite_code text, p_idempotency_key text, p_metadata jsonb`                             | `jsonb` | yes          |
| `api.referral_claim_commission`       | `p_user_id uuid, p_commission_ids uuid[], p_idempotency_key text`                                                  | `jsonb` | yes          |
| `api.referral_create_commission`      | `p_invitee_user_id uuid, p_source_id uuid, p_base_amount_kcoin numeric, p_commission_bps integer`                  | `jsonb` | yes          |
| `api.referral_get_commission_history` | `p_user_id uuid, p_cursor timestamptz, p_status text, p_limit integer`                                             | `jsonb` | yes          |
| `api.referral_get_invite_stats`       | `p_user_id uuid, p_from timestamptz, p_to timestamptz`                                                             | `jsonb` | yes          |
| `api.referral_get_records`            | `p_user_id uuid, p_cursor timestamptz, p_status text, p_limit integer`                                             | `jsonb` | yes          |
| `api.referral_process_first_open`     | `p_invitee_user_id uuid, p_draw_order_id uuid`                                                                     | `jsonb` | yes          |
| `api.referral_record_share_event`     | `p_user_id uuid, p_share_type text, p_payload jsonb, p_idempotency_key text`                                       | `jsonb` | yes          |

注意：远程存在内部 helper `api.referral_process_first_open_without_task_progress(uuid, uuid)`，其 `service_role` 执行权限为 no；本地 migration 明确 revoke 了该 helper 权限，外部 API 不应直接调用它。

## 安全和幂等冻结记录

本节只执行 4.1「安全和幂等要求」，作为第五阶段开发前的冻结约束。

### 现有 idempotency 逻辑不得删除

- 开盒入口 `api/boxes/create-open-order.ts` 继续通过 `getIdempotencyKey(req)` 兼容 `X-Idempotency-Key` header，并把最终 `idempotencyKey` 传给 `api.gacha_create_order` 的 `p_idempotency_key`。
- 前端开盒请求 `apps/web/src/features/box/box.api.ts` 继续同时提交 body `idempotency_key` 和 `X-Idempotency-Key`。
- 阶段四任务、邀请、签到、分红、图鉴奖励、库存成长和市场写操作已经存在各自的 idempotency key 校验、RPC 参数和测试；第五阶段不得为了接入支付、钱包或 Mint 删除这些 guard。
- 支付、webhook、Mint 后续实现必须沿用同一原则：客户端请求带稳定幂等键，服务端/RPC 用唯一约束或 `ops.idempotency_keys` 兜底，ledger 写入使用唯一 `idempotency_key`。

### 敏感配置不得进入仓库或前端

- `.gitignore` 已忽略 `.env` 和 `.env.*`，只允许提交 `.env.example` 占位说明。
- `packages/server/src/env.ts` 是服务端私密变量入口，`SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_SECRET_KEY`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_WEBHOOK_SECRET`、`TON_MINTER_PRIVATE_KEY` 等只能在服务端 / Vercel server env 使用。
- `apps/web/src/env.ts` 已维护前端 `VITE_` 白名单和敏感 key 拦截逻辑；前端只能读取公开配置，例如 TON Connect manifest URL 和公开 Supabase anon key。
- `DEV_GACHA_PAYMENT_MODE` 只允许 local / test 使用；生产类环境必须为 false。

### `currency_ledger` 历史数据不得修改

- 本次没有新增 SQL migration，没有修改 `supabase/` 下任何文件，也没有执行远程写入。
- `economy.currency_ledger` 仍是资产不可变流水；修复资产问题只能追加 reversal / adjustment 记录，不能直接 update/delete 历史 ledger。
- 现有 `ledger_integrity.test.sql` 已覆盖 ledger update/delete 被 immutable trigger 阻止；第五阶段支付发货、退款、Mint 补偿都必须继续通过 RPC / ledger 追加路径处理。

### 本次本地安全检查

- `git check-ignore -v .env .env.local .env.production .env.preview` 确认 `.env` 和 `.env.*` 被忽略。
- `git ls-files .env .env.example .env.local .env.production` 仅返回 `.env.example`，真实 `.env` 未被 Git 跟踪。
- `git diff -- supabase` 无输出，确认本次没有修改 SQL / migration / RLS / RPC。
- 已运行验证：`pnpm exec vitest run tests/api/boxes.test.ts tests/api/server-env.test.ts`，结果 2 个测试文件、19 个用例通过。
- 已运行验证：`pnpm typecheck:tests` 通过。
- 已运行验证：`pnpm exec prettier --check docs/phase5-baseline.md docs/release-checklist.md tests/api/server-env.test.ts tests/api/boxes.test.ts` 通过。

## 4.1 验收执行记录

| 验收项                                                               | 结果     | 证据                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第四阶段任务中心功能仍可访问                                         | 通过     | `pnpm exec playwright test tests/e2e/tasks.spec.ts` 通过 7 个任务页 E2E 场景，覆盖邀请、签到、任务列表、领奖、分红和空状态。                                                                                                                                                                                                                                                                                                    |
| dev mode 开盒仍可生成 `draw_results`                                 | 条件通过 | `pnpm exec vitest run tests/api/boxes.test.ts tests/api/server-env.test.ts` 通过，确认 `DEV_GACHA_PAYMENT_MODE=true` 时 `/api/boxes/create-open-order` 调用 `api.gacha_process_dev_paid_order`；远程只读快照显示 `gacha.draw_results` 共 15 行，覆盖 6 个已完成订单，且无缺失 `item_instance_id`。本地 pgTAP 中 `supabase/tests/gacha_order.test.sql` 仍覆盖真实 `draw_results` 写入，但本次本地 DB gate 被 Docker 未运行阻塞。 |
| `currency_ledger` 与 `user_balances` 可对账                          | 通过     | 远程只读 SQL 使用每个用户 / 币种最新 ledger 快照对比 `economy.user_balances`，`balance_mismatch_count=0`。                                                                                                                                                                                                                                                                                                                      |
| 创建第五阶段开发分支                                                 | 通过     | 当前 Git 分支为 `phase5-payments-onchain`。                                                                                                                                                                                                                                                                                                                                                                                     |
| 记录当前 migration 最新版本                                          | 通过     | 远程最新 migration 为 `20260527045136 / 20260527044358_phase4_redact_commission_source_ids`。                                                                                                                                                                                                                                                                                                                                   |
| 生产环境 `DEV_GACHA_PAYMENT_MODE=false` 的检查项已写入上线 checklist | 通过     | 已写入 `docs/release-checklist.md`。                                                                                                                                                                                                                                                                                                                                                                                            |

### 验证命令记录

| 命令                                                                        | 结果                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm exec vitest run tests/api/boxes.test.ts tests/api/server-env.test.ts` | 2 个文件、19 个测试通过。                                    |
| `pnpm exec vitest run tests/api`                                            | 18 个文件、210 个测试通过。                                  |
| `pnpm exec playwright test tests/e2e/tasks.spec.ts`                         | 7 个任务页 E2E 场景通过。                                    |
| `SUPABASE_TELEMETRY_DISABLED=1 pnpm test:db`                                | 未通过；本地 Postgres `127.0.0.1:54322` connection refused。 |
| `SUPABASE_TELEMETRY_DISABLED=1 pnpm db:start`                               | 未通过；Docker daemon 未运行。                               |

### 本地 DB gate 阻塞说明

本次 DB 测试失败不是 pgTAP 断言失败，而是本机 Docker Desktop 未运行，Supabase CLI 无法启动或连接本地 Postgres：

- `failed to connect to 127.0.0.1:54322: connection refused`
- `Cannot connect to the Docker daemon at unix:///Users/mac/.docker/run/docker.sock`

在 Docker Desktop 启动后，需要重新执行：

```bash
SUPABASE_TELEMETRY_DISABLED=1 pnpm db:start
SUPABASE_TELEMETRY_DISABLED=1 pnpm test:db
```

## 本次未执行的动作

- 未新增或修改 SQL migration。
- 未执行 `supabase db push`。
- 未改动远程数据。
- 未完成本地 DB gate；原因是 Docker Desktop 未运行。
