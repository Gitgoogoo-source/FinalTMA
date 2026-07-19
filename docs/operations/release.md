# 一次性发布手册

## 1. 硬前提

在执行任何外部写入前，由负责人逐项记录证据：

- 真实开发 Supabase 在首次初始化前 migration history 为空；未来生产 Supabase 在上线前保持空库且无须保留业务数据。
- 正式 210 张藏品图、3 张盲盒图、Telegram 分享图和 TON Connect 图标已提供。
- 本次真实开发部署的 Supabase、Vercel、Telegram、Stars 与观测平台配置齐全；TON RPC 和链上配置在启用 TON 前补齐。
- 生产将部署已在真实开发环境完成验收的同一 Git commit、同一 migration 序列和同一目录 manifest。
- Vercel 套餐支持 `vercel.json` 中三项当前 Cron 的执行频率；启用 TON 时同一套餐还必须支持第四项 Mint 对账 Cron。

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

`final-tma-real-test` 已于 2026-07-19 完成首次初始化，远端 migration history 依次为 `20260719104533_baseline`、`20260719104602_product_data_v1`、`20260719104614_api_security`；仓库中的迁移文件名必须与该历史保持一致。

1. 核对三条 migration 已按文件名顺序应用，且远端历史与仓库完全一致。
2. 对开发项目执行 `supabase db lint --linked --schema api,identity,catalog,operations,economy,inventory,gacha,expedition,wheel,market,payments,vip,tasks,referral,album,onchain,risk --level warning --fail-on error`。
3. 在 Supabase Data API 设置中把 Exposed schemas 固定为 `public,graphql_public,api`，不得暴露任何业务表 schema。
4. 部署当前 Git commit 到 `final-tma` Vercel Project 并配置开发 secrets。
5. 配置开发 Bot webhook/Mini App URL。
6. 按 `docs/operations/acceptance.md` 完成 Telegram 真机、支付与并发验收。
7. 执行 `reconcile-payments`、`cleanup-idempotency` 和 `monitor-invariants`；`monitor-invariants` 必须返回 0 个新增 violation。

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
8. 设置 Telegram webhook 与 Mini App 地址。
9. 执行生产 smoke check 与四个 job；保存 request/operation/ledger/inventory 证据。

## 5. 回滚边界

不回滚数据库到旧 schema，不重新开放旧 API。部署前失败直接停止；部署后应用层故障回滚到本次重构的前一个可验证 commit，但如果该 commit 不支持三条新 migration，则保持流量关闭并前滚修复。已经 Mint 的 NFT 和已确认 Stars 支付只能通过恢复 job 完成，不能重复交付或撤销链上事实。
