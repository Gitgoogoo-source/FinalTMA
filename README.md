# tmaGame 本地开发说明

Telegram Mini App 开盲盒抽卡小游戏。前端负责展示和交互，真实登录、资产、开盒、支付、库存、市场、任务、钱包和 NFT 写操作必须走：

```txt
frontend -> Vercel API -> Supabase RPC / Postgres transaction
```

不要把 Bot Token、Supabase service role key、TON 私钥、webhook secret、session secret 或真实钱包私钥放进前端。所有 `VITE_` 变量都会进入浏览器，只能放公开配置。

## 1. 基础准备

需要：

- Node.js `>=24.0.0`
- pnpm `>=11.1.3`
- Supabase CLI
- Vercel CLI
- Docker Desktop，本地 Supabase 和 `test:db` 需要它

安装依赖：

```bash
pnpm install
```

## 2. 环境变量

本项目分两类环境变量：

- 根目录 `.env`：服务端和本地工具使用，允许放后端密钥，但不要提交。
- `apps/web/.env`：Vite 前端使用，只能放 `VITE_` 公开变量。

可以从 `.env.example` 对照填写。不要直接把完整根 `.env` 复制到 `apps/web/.env`。

前端最小配置：

```env
VITE_APP_NAME=tmaGame
VITE_TMA_ENV=development
VITE_PUBLIC_BASE_URL=http://localhost:5173
VITE_API_BASE_URL=http://localhost:3000/api
VITE_TG_BOT_USERNAME=replace_with_bot_username_without_at
VITE_TONCONNECT_MANIFEST_URL=http://localhost:5173/tonconnect-manifest.json
VITE_ENABLE_MOCKS=false
VITE_ENABLE_SUPABASE_DIRECT_READS=false
VITE_ENABLE_TON_CONNECT=false
```

服务端最小配置：

```env
APP_ENV=development
NODE_ENV=development
PUBLIC_APP_URL=http://localhost:5173
API_BASE_URL=http://localhost:3000/api
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=replace_with_local_or_remote_anon_key
SUPABASE_SERVICE_ROLE_KEY=replace_with_local_or_remote_service_role_key
# 新版 Supabase secret key 可用 SUPABASE_SECRET_KEY 替代 SUPABASE_SERVICE_ROLE_KEY

TELEGRAM_BOT_TOKEN=replace_with_telegram_bot_token
TELEGRAM_BOT_USERNAME=replace_with_bot_username_without_at
TELEGRAM_MINI_APP_SHORT_NAME=replace_with_mini_app_short_name

APP_SESSION_SECRET=replace_with_at_least_32_chars_random_secret
DRAW_RANDOM_SECRET=replace_with_at_least_32_chars_random_secret
DEV_GACHA_PAYMENT_MODE=true
```

可选但常用：

```env
TELEGRAM_WEBHOOK_SECRET=replace_with_random_webhook_secret
TELEGRAM_WEBHOOK_URL=http://localhost:3000/api/telegram/webhook
TON_NETWORK=testnet
TON_API_KEY=replace_with_ton_api_key
CRON_SECRET=replace_with_random_cron_secret
```

生产或 preview 环境必须在 Vercel Environment Variables 中配置服务端密钥。不要把服务端密钥写成 `VITE_`。

## 3. 启动本地前端

只启动 Vite 前端：

```bash
pnpm dev:web
```

默认地址：

```txt
http://localhost:5173
```

如果要让本地前端访问 Vercel API，请另开一个终端启动 `pnpm dev:vercel`，并保持：

```env
VITE_API_BASE_URL=http://localhost:3000/api
```

## 4. 启动 Vercel dev

Vercel Functions 在根目录 `api/` 下。启动本地 Vercel dev：

```bash
pnpm dev:vercel
```

默认地址：

```txt
http://localhost:3000
```

健康检查：

```bash
curl http://localhost:3000/api/health
```

常见本地组合：

```txt
终端 1：pnpm dev:vercel  # API / Vercel Functions
终端 2：pnpm dev:web     # Vite 前端
```

## 5. 连接 Supabase

### 本地 Supabase

启动本地 Supabase：

```bash
pnpm db:start
pnpm db:status
```

把 `db:status` 输出中的 API URL、anon key、service role key 写入根目录 `.env`：

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

本地 Studio 默认地址：

```txt
http://127.0.0.1:54323
```

停止本地 Supabase：

```bash
pnpm db:stop
```

### 远程 Supabase

登录并关联项目：

```bash
supabase login
supabase link --project-ref <your-project-ref>
```

远程项目的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 或 `SUPABASE_SECRET_KEY` 必须放在根目录 `.env` 和 Vercel 环境变量中。前端默认不直连业务表，核心业务仍走 Vercel API。

## 6. 执行 migration

本地重建数据库并执行所有 migration：

```bash
pnpm db:reset
```

创建新 migration：

```bash
pnpm db:migration:new add_feature_name
```

推送本地 migration 到已 link 的远程 Supabase：

```bash
pnpm db:push
```

生成数据库类型：

```bash
pnpm db:types:local
# 或连接远程项目后：
pnpm db:types:linked
```

不要手动修改 `packages/db-types/src/database.types.ts`。

## 7. Seed

本项目的 seed 文件在 `supabase/seed/`，执行顺序写在 `supabase/config.toml` 的 `[db.seed].sql_paths`。

推荐方式是本地 reset，Supabase CLI 会按配置自动执行 seed：

```bash
pnpm db:reset
```

如果只想对已存在的数据库重新执行 seed，可手动按顺序执行：

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/001_currencies.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/002_rarities.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/003_item_types.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/004_series_factions.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/005_collectibles.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/006_boxes.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/007_drop_pools.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/008_tasks.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/009_album.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/010_market_rules.seed.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed/011_feature_flags.seed.sql
```

注意：当前 `pnpm db:seed` 指向 `scripts/seed-dev.ts`，但该文件目前为空；在实现 seed 脚本前，不要把它当作有效 seed 入口。

## 8. 开启 DEV_GACHA_PAYMENT_MODE

本地或测试环境在根目录 `.env` 设置：

```env
DEV_GACHA_PAYMENT_MODE=true
```

效果：

- `/api/boxes/create-open-order` 创建订单后会调用 `gacha_process_dev_paid_order`。
- 开盒订单会被开发模式处理为已支付，用于跑通第一阶段闭环。
- 不需要等待 Telegram `successful_payment` webhook。

生产环境必须关闭：

```env
DEV_GACHA_PAYMENT_MODE=false
```

后端环境校验会阻止生产环境开启开发支付模式。

## 9. 跑 test:db

数据库测试在 `supabase/tests/`，使用 Supabase CLI 的 pgTAP 风格测试。

先确保本地 Supabase 正在运行并已应用 migration：

```bash
pnpm db:start
pnpm db:reset
```

运行：

```bash
pnpm test:db
```

如果出现 `127.0.0.1:54322` connection refused，通常是本地 Supabase/Postgres 没启动或 Docker Desktop 没运行，不代表 SQL 断言失败。

## 10. 跑 API test

API test 位于 `tests/api/`，由 Vitest 运行。

只跑 API test：

```bash
pnpm exec vitest run tests/api
```

跑 unit + API test：

```bash
pnpm test:unit
```

当前 `vitest.config.ts` 只包含 `tests/unit/**/*.test.ts` 和 `tests/api/**/*.test.ts`，不会把 Playwright E2E 当成 Vitest 测试运行。

## 11. Telegram Mini App 中验证

Telegram Mini App 需要 HTTPS URL。可使用 Vercel preview / production 域名，或用 HTTPS tunnel 暴露本地服务。

验证前检查：

```txt
1. Vercel 环境变量已配置
2. Supabase migration 已执行
3. seed 数据已执行
4. API 能访问 Supabase
5. TELEGRAM_BOT_TOKEN 正确
6. BotFather 中的 Mini App URL 指向当前 HTTPS 前端地址
7. 测试环境 DEV_GACHA_PAYMENT_MODE=true
8. service role key、Bot token、TON 私钥没有出现在前端变量或前端 bundle
```

如果使用 Vercel preview 地址，需要同步更新：

```env
PUBLIC_APP_URL=https://your-preview-domain.vercel.app
API_BASE_URL=https://your-preview-domain.vercel.app/api
TELEGRAM_WEBHOOK_URL=https://your-preview-domain.vercel.app/api/telegram/webhook

VITE_PUBLIC_BASE_URL=https://your-preview-domain.vercel.app
VITE_API_BASE_URL=https://your-preview-domain.vercel.app/api
VITE_TONCONNECT_MANIFEST_URL=https://your-preview-domain.vercel.app/tonconnect-manifest.json
```

Telegram 内验证流程：

```txt
1. 从 Telegram 打开 Mini App
2. 检查是否自动登录
3. 检查顶部资产栏
4. 打开开盒页
5. 查看可能获得
6. 单抽
7. 十连
8. 查看藏品库存页
9. 在 Supabase 检查 gacha.draw_orders、gacha.draw_results、inventory.item_instances、economy.currency_ledger
```

第一阶段验证重点是登录、资产栏、开盒、结果展示、库存写入和 ledger 一致性；交易、任务、钱包、NFT Mint 属于后续完整业务验证范围。
