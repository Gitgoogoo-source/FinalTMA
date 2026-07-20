# 一次性发布手册

## 1. 硬前提

在执行任何外部写入前，由负责人逐项记录证据：

- 外部写入目标已核对为真实开发 Supabase `final-tma-real-test`（`ebewtjerusxcioegpzjd`）与 Vercel `final-tma`，未来生产 Supabase 在上线前保持空库且无须保留业务数据。
- 正式 210 张藏品图、3 张盲盒图、Telegram 分享图和 TON Connect 图标已提供。
- 本次真实开发部署的 Supabase、Vercel、Telegram、Stars 与观测平台配置齐全；TON RPC 和链上配置在启用 TON 前补齐。
- 生产将部署已在真实开发环境完成验收的同一 Git commit、同一 migration 序列和同一目录 manifest。
- Vercel 套餐支持 `vercel.json` 中三项当前 Cron 的执行频率；启用 TON 时同一套餐还必须支持第四项 Mint 对账 Cron。
- Vercel Production 环境变量名称核查同时包含 `TELEGRAM_BOT_USERNAME` 与 `TELEGRAM_MINI_APP_SHORT_NAME`，开发 short name 固定为 `pokepets_dev`。
- 真实开发 Bot 固定为 `@FinalTMA_bot`；Main Mini App URL 固定为 `https://final-tma-pi.vercel.app/`；named Mini App 固定为 `https://t.me/FinalTMA_bot/pokepets_dev`；默认菜单按钮固定为 `Open PokePets` 并指向该 named Mini App 链接。

任何一项不成立：停止发布，不恢复旧 migration、占位素材、mock、默认业务值或功能开关。

## 2. 本地静态门禁

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:openapi
pnpm contracts:check
pnpm product-data:check
pnpm build
pnpm db:migrations:check
pnpm db:lint
pnpm db:diff:check
pnpm architecture:check
pnpm chain:build
pnpm assets:check:production
pnpm manifest:check
pnpm manifest:check:production
```

生成正式 TON Connect manifest：

```sh
python3 tools/web/build_manifest.py \
  --app-url https://APP_HOST \
  --icon-url https://APP_HOST/assets/ton/tonconnect-icon.png \
  --terms-url https://APP_HOST/terms \
  --privacy-url https://APP_HOST/privacy
```

正式素材首次上传后运行 `pnpm catalog:pin-assets`，复核变更并提交 checksum；此后所有环境运行 `pnpm assets:check:production`，不得重新 pin 不一致的文件。

## 3. 真实开发环境

用户明确宣布正式生产上线前，真实开发环境不保留迁移历史。每次数据库定义调整都执行以下固定顺序：

1. 记录当前 commit、三条 migration 文件名及校验和，核对目标 ref 为 `ebewtjerusxcioegpzjd`。
2. 完成本地静态门禁；关闭开发 Bot webhook/Mini App 入口并暂停三项 Vercel Cron。
3. 清空真实开发数据库与 migration history，从空库依次执行仓库内唯一的 `*_baseline.sql`、`*_product_data_v1.sql`、`*_api_security.sql`。
4. 验证远端 migration history、RPC 定义、入口交接门禁、RLS、函数权限与仓库一致。
5. 对开发项目执行 `supabase db lint --linked --schema api,identity,catalog,operations,economy,inventory,gacha,expedition,wheel,market,payments,vip,tasks,referral,album,onchain,risk --level warning --fail-on error` 并运行 Supabase security/performance advisors。
6. 在 Supabase Data API 设置中把 Exposed schemas 固定为 `public,graphql_public,api`，不得暴露任何业务表 schema。
7. 核对 Vercel Production 同时存在 `TELEGRAM_BOT_USERNAME=FinalTMA_bot` 与 `TELEGRAM_MINI_APP_SHORT_NAME=pokepets_dev`，环境变量变更后部署包含全部修改的同一 Git commit；在 BotFather 的 `/mybots` → `@FinalTMA_bot` → `Bot Settings` → `Configure Mini App` 中启用 Main Mini App 并将 URL 固定为 `https://final-tma-pi.vercel.app/`，同时保持 named Mini App `pokepets_dev` 与默认菜单按钮 `Open PokePets` 指向 `https://t.me/FinalTMA_bot/pokepets_dev`。
8. 调用 Bot API，确认 `getMe.result.has_main_web_app=true` 且 `getChatMenuButton.result.web_app.url=https://t.me/FinalTMA_bot/pokepets_dev`；再验证 `/api/health`、Telegram 真机登录、登录交接门禁、`/api/referrals` 与三个手工 job，最后恢复 Cron。
9. 按 `docs/operations/acceptance.md` 完成 Telegram 真机、支付与并发验收；`monitor-invariants` 必须返回 0 个新增 violation。

任一步失败都保持入口与 Cron 关闭，修正原始 Schema 或迁移并从第 1 条重新执行。禁止为尚未生产发布的错误定义追加修补 migration。

本次真实开发部署不发布 TON testnet Collection，不配置 TON runtime secrets，不调度 `reconcile-mints`，也不执行钱包与 Mint 验收。后续启用 TON 时必须先完成 testnet Collection 部署、链上 owner/permit 公钥/1% 版税验证和全部真实 TON 配置，再把 `reconcile-mints` 恢复到 Vercel Cron 并完成 `docs/operations/acceptance.md` 中的 TON 场景。

## 4. 生产切换

顺序不可调整：

1. `pnpm assets:check:production` 成功。
2. 再次证明生产 migration history 为空且无须迁移数据。
3. 按 `find supabase/migrations -maxdepth 1 -name '*.sql' | sort` 输出的唯一三条迁移应用，后缀依次必须是 `_baseline.sql`、`_product_data_v1.sql`、`_api_security.sql`。
4. 用户明确授权并提供部署钱包后，设置 `TON_MAINNET_DEPLOY_APPROVED=I_UNDERSTAND_MAINNET` 发布 mainnet collection。
5. 验证链上 owner、permit 公钥、不可变 collection content 与 1% royalty。
6. 将真实 collection 地址和所有密钥写入平台 secrets。
7. 部署与真实开发环境验收通过的完全相同 Git commit。
8. 设置 Telegram webhook；启用生产 Bot 的 Main Mini App，将 Main Mini App 与 named Mini App 固定到该次部署的唯一生产域名，默认菜单按钮固定指向 named Mini App 链接，并用 Bot API 验证 `has_main_web_app=true` 与菜单 URL 完全一致。
9. 执行生产 smoke check 与四个 job；保存 request/operation/ledger/inventory 证据。

## 5. 回滚边界

不回滚数据库到旧 schema，不重新开放旧 API。正式生产上线前，部署失败时保持流量关闭，修正原始三条迁移并从空真实开发数据库重建；正式生产上线后才使用只追加的前向修复。已经 Mint 的 NFT 和已确认 Stars 支付只能通过恢复 job 完成，不能重复交付或撤销链上事实。
