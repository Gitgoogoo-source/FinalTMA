# 一次性发布手册

## 1. 硬前提

在执行任何外部写入前，由负责人逐项记录证据：

- 外部写入目标已核对为真实开发 Supabase `final-tma-real-test`（`ebewtjerusxcioegpzjd`）与 Vercel `final-tma`，未来生产 Supabase 在上线前保持空库且无须保留业务数据。
- 当前真实开发环境与未来生产环境使用同一组 210 张正式藏品母版生成的 420 张运行时图片；母版、缩略图、详情图、模板路径与 checksum 必须一一对应。
- 正式生产环境 `APP_ENV=production` 部署前，还必须提供正式 Telegram 分享图和 TON Connect 图标；任一已知开发占位 checksum 仍存在时禁止生产发布。
- 本次真实开发部署的 Supabase、Vercel、Telegram、Stars 与观测平台配置齐全；TON RPC 和链上配置在启用 TON 前补齐。
- 生产将部署已在真实开发环境完成验收的同一 Git commit、同一 migration 序列和同一目录 manifest。
- Vercel 套餐支持 `vercel.json` 中三项当前 Cron 的执行频率；启用 TON 时同一套餐还必须支持第四项 Mint 对账 Cron。
- Vercel Production 环境变量名称核查同时包含 `TELEGRAM_BOT_USERNAME` 与 `TELEGRAM_MINI_APP_SHORT_NAME`，开发 short name 固定为 `pokepets_dev`。
- 真实开发 Bot 固定为 `@FinalTMA_bot`；Main Mini App URL 固定为 `https://final-tma-pi.vercel.app/`；named Mini App 固定为 `https://t.me/FinalTMA_bot/pokepets_dev`；默认菜单按钮固定为 `Open PokePets` 并指向该 named Mini App 链接。
- Monster Tamer 的 `apps/web/public/monster-tamer` 静态树完整，固定上游提交、MIT 许可证、第三方声明和资源来源记录均已提交；Tuxemon 提交 `c34a9c727129999671e4206ade7425cbb45745b4`、四张允许源图的路径与 SHA-256、CC BY-SA 4.0 许可证、完整署名和修改说明已核对。运行时只发布并加载一张由精选图块组成的 `tuxemon-valley-4x-extruded.png`，不发布或加载四张完整源图。

任何一项与目标环境对应的前提不成立：停止发布，不恢复旧 migration、未获批准的占位素材、mock、默认业务值或功能开关。

## 2. 本地静态门禁

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm contracts:openapi
pnpm contracts:check
pnpm product-data:check
pnpm catalog:generate-assets
pnpm catalog:pin-assets
pnpm assets:check:catalog
APP_ENV=development pnpm build
pnpm db:migrations:check
pnpm db:lint
pnpm db:diff:check
pnpm architecture:check
pnpm chain:build
pnpm assets:check:development
pnpm manifest:check
pnpm manifest:check:production
```

`pnpm catalog:generate-assets` 要求 210 张母版均为 768×768 WebP，并生成 256×256 缩略图和 768×768 详情图。`pnpm assets:check:catalog` 强制核对 210 个 `template_id`、两个路径、420 个文件、WebP 格式、尺寸、单文件体积、50 MiB 总上限、内容唯一性和正式 checksum。`APP_ENV=development pnpm build` 在生成 `apps/web/dist` 后继续核对构建复制结果；`APP_ENV=test` 与 `APP_ENV=production` 额外拒绝 Telegram 分享图和 TON Connect 图标的已知开发 checksum。

`pnpm architecture:check` 同时验证 Monster Tamer 静态入口、launcher 纯链接、游戏页顺序、独立本地存档、业务引用为零、Vercel 路由优先级、唯一 480×240 `main_1` 地图、旧地图删除、图层和对象数量契约、虚拟摇杆、WASD、平滑相机，以及 Tuxemon 固定提交、四张允许源图 SHA-256、CC BY-SA 4.0 许可证和单运行时图集边界。`APP_ENV=development pnpm build` 后必须确认 `apps/web/dist/monster-tamer` 与源静态树文件清单一致；缺失任一脚本、样式、字体、音频、地图、数据、图片、许可证或第三方声明时停止发布。

生成正式 TON Connect manifest：

```sh
python3 tools/web/build_manifest.py \
  --app-url https://APP_HOST \
  --icon-url https://APP_HOST/assets/ton/tonconnect-icon.png \
  --terms-url https://APP_HOST/terms \
  --privacy-url https://APP_HOST/privacy
```

正式藏品资源固定按以下顺序更新：把 210 张新母版写入新的目录版本，运行 `pnpm catalog:generate-assets`，运行 `pnpm catalog:pin-assets`，复核并提交 checksum，再运行藏品、开发和 production 资产门禁。已经发布的 `v1` 不得覆盖；后续内容变化必须创建新版本并同步数据库路径。production 门禁会继续拒绝 `generated/assets/placeholders.json` 中 Telegram 分享图和 TON Connect 图标的已知开发 checksum，禁止通过重新 pin 绕过正式替换要求。

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
9. 对当前 Vercel 部署分别请求 `/monster-tamer` 与 `/monster-tamer/`，确认两者返回独立游戏文档且全部静态资源成功；按 `docs/operations/acceptance.md` 完成 Monster Tamer 唯一无缝地图、3 分 12 秒普通步行横穿、原有玩法、WASD、虚拟摇杆、动画停止帧、碰撞贴边滑动、平滑相机、旧存档位置迁移、业务零请求、单运行时图集边界和 Tuxemon 授权署名验收。
10. 按 `docs/operations/acceptance.md` 完成 Telegram 真机、支付与并发验收；`monitor-invariants` 必须返回 0 个新增 violation。

任一步失败都保持入口与 Cron 关闭，修正原始 Schema 或迁移并从第 1 条重新执行。禁止为尚未生产发布的错误定义追加修补 migration。

本次真实开发部署不发布 TON testnet Collection，不配置 TON runtime secrets，不调度 `reconcile-mints`，也不执行钱包与 Mint 验收。后续启用 TON 时必须先完成 testnet Collection 部署、链上 owner/permit 公钥/1% 版税验证和全部真实 TON 配置，再把 `reconcile-mints` 恢复到 Vercel Cron 并完成 `docs/operations/acceptance.md` 中的 TON 场景。

## 4. 生产切换

顺序不可调整：

1. `APP_ENV=production pnpm build` 与 `pnpm assets:check:production` 均成功。
2. 再次证明生产 migration history 为空且无须迁移数据。
3. 按 `find supabase/migrations -maxdepth 1 -name '*.sql' | sort` 输出的唯一三条迁移应用，后缀依次必须是 `_baseline.sql`、`_product_data_v1.sql`、`_api_security.sql`。
4. 用户明确授权并提供部署钱包后，设置 `TON_MAINNET_DEPLOY_APPROVED=I_UNDERSTAND_MAINNET` 发布 mainnet collection。
5. 验证链上 owner、permit 公钥、不可变 collection content 与 1% royalty。
6. 将真实 collection 地址和所有密钥写入平台 secrets。
7. 部署与真实开发环境验收通过的完全相同 Git commit。
8. 设置 Telegram webhook；启用生产 Bot 的 Main Mini App，将 Main Mini App 与 named Mini App 固定到该次部署的唯一生产域名，默认菜单按钮固定指向 named Mini App 链接，并用 Bot API 验证 `has_main_web_app=true` 与菜单 URL 完全一致。
9. 对生产域名执行 `/monster-tamer`、`/monster-tamer/`、游戏内返回、唯一 `main_1`、唯一 `tuxemon-valley-4x-extruded.png` 图集、Tuxemon 来源记录、署名和 CC BY-SA 4.0 许可证以及全部静态资源 smoke check，确认其使用同一提交中的完整静态树，不请求四张完整 Tuxemon 源图，且没有新增环境变量、API、数据库、Catalog 或第三方运行时依赖。
10. 执行生产 smoke check 与四个 job；保存 request/operation/ledger/inventory 证据。

## 5. 回滚边界

不回滚数据库到旧 schema，不重新开放旧 API。正式生产上线前，部署失败时保持流量关闭，修正原始三条迁移并从空真实开发数据库重建；正式生产上线后才使用只追加的前向修复。已经 Mint 的 NFT 和已确认 Stars 支付只能通过恢复 job 完成，不能重复交付或撤销链上事实。
