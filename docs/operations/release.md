# 一次性发布手册

## 1. 硬前提

在执行任何外部写入前，由负责人逐项记录证据：

- 测试、生产 Supabase 的 migration history 均为空；生产无须保留业务数据。
- 正式 210 张藏品图、3 张盲盒图、Telegram 分享图和 TON Connect 图标已提供。
- 测试/生产 Supabase、Vercel、Telegram、Stars、TON RPC 与观测平台配置齐全。
- 测试和生产将部署同一 Git commit、同一三条 migration、同一目录 manifest。
- Vercel 套餐支持 `vercel.json` 中四个 cron 的执行频率。

任何一项不成立：停止发布，不恢复旧 migration、占位素材、mock、默认业务值或功能开关。

## 2. 本地静态门禁

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:openapi
pnpm build
pnpm db:migrations:check
pnpm db:lint
pnpm db:diff:check
pnpm chain:build
pnpm assets:check:production
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

## 3. 测试环境

1. 将三条 migration 按文件名顺序应用到空测试库。
2. 对测试项目执行 `supabase db lint --linked --schema api,identity,catalog,operations,economy,inventory,gacha,expedition,wheel,market,payments,vip,tasks,referral,album,onchain,risk --level warning --fail-on error`。
3. 部署同一 Git commit 到测试 Vercel 项目并配置测试 secrets。
4. 发布 testnet collection，记录地址、交易 hash、owner、permit 公钥和 1% 版税验证结果。
5. 配置测试 Bot webhook/Mini App URL。
6. 按 `docs/operations/acceptance.md` 完成 Telegram 真机、支付、并发与 Mint 验收。
7. 执行四个 job；`monitor-invariants` 必须返回 0 个新增 violation。

## 4. 生产切换

顺序不可调整：

1. `pnpm assets:check:production` 成功。
2. 再次证明生产 migration history 为空且无须迁移数据。
3. 按 `find supabase/migrations -maxdepth 1 -name '*.sql' | sort` 输出的唯一三条迁移应用，后缀依次必须是 `_baseline.sql`、`_product_data_v1.sql`、`_api_security.sql`。
4. 用户明确授权并提供部署钱包后，设置 `TON_MAINNET_DEPLOY_APPROVED=I_UNDERSTAND_MAINNET` 发布 mainnet collection。
5. 验证链上 owner、permit 公钥、不可变 collection content 与 1% royalty。
6. 将真实 collection 地址和所有密钥写入平台 secrets。
7. 部署与测试环境完全相同的 Git commit。
8. 设置 Telegram webhook 与 Mini App 地址。
9. 执行生产 smoke check 与四个 job；保存 request/operation/ledger/inventory 证据。

## 5. 回滚边界

不回滚数据库到旧 schema，不重新开放旧 API。部署前失败直接停止；部署后应用层故障回滚到本次重构的前一个可验证 commit，但如果该 commit 不支持三条新 migration，则保持流量关闭并前滚修复。已经 Mint 的 NFT 和已确认 Stars 支付只能通过恢复 job 完成，不能重复交付或撤销链上事实。
