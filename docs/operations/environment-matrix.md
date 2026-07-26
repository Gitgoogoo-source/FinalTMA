# 环境矩阵

| 项目        | 本地                           | 真实开发                                                               | 真实生产                     |
| ----------- | ------------------------------ | ---------------------------------------------------------------------- | ---------------------------- |
| Git commit  | 当前工作提交                   | 持续开发提交                                                           | 与开发验收通过的提交相同     |
| Node / pnpm | Node 24 / pnpm 11.1.3          | Node 24 / pnpm 11.1.3                                                  | Node 24 / pnpm 11.1.3        |
| Vercel      | `vercel dev`                   | `final-tma` Project，`APP_ENV=development`                             | 未来独立 Pro Project         |
| Supabase    | 本地 Postgres 17               | `final-tma-real-test`（ref `ebewtjerusxcioegpzjd`）Postgres 17 Project | 未来独立 Postgres 17         |
| Telegram    | 开发 Bot                       | 开发 Bot 与开发 webhook                                                | 生产 Bot 与生产 webhook      |
| TON         | testnet                        | 本次部署不发布 Collection、不启用 Mint 对账 Cron                       | mainnet collection           |
| 藏品图片    | 210 张正式母版、420 张运行时图 | 与生产相同的版本化正式图                                               | 与开发验收相同的版本化正式图 |
| 数据        | 非业务本地数据                 | 独立真实开发与验收数据                                                 | 真实生产数据                 |

210 张正式母版保存在非公开源码目录，每张固定生成 256×256 缩略图和 768×768 详情图。真实开发与生产只允许域名、项目 ID、Bot、合约地址和密钥不同，生产必须使用同一 Git commit、同一 OpenAPI、同一目录版本、同一资产 checksum 和同一迁移序列。Telegram 分享图和 TON Connect 图标完成正式替换前，全局 production 资产门禁保持失败。

当前真实开发部署固定启用 Web、API、Supabase、Telegram webhook、支付对账、幂等清理和不变量监控。TON 配置为空，`reconcile-mints` 不进入 Vercel Cron；钱包验签、Mint permit 和 Mint 对账只有在后续完成 testnet Collection 部署并写入全部真实 TON 配置后才启用。非 TON API 只解析自身所需配置，不接受任何 TON 占位值。

Supabase Data API 的 Exposed schemas 固定为 `public,graphql_public,api`。Vercel Functions 只以 `service_role` 调用 `api` schema RPC；浏览器不持有 Supabase key，也不直接访问任何 Supabase schema。业务表 schema 不加入 Exposed schemas。

Web 公开构建当前不需要 `VITE_*`。API 机密配置以根 `.env.example` 为唯一名称清单，真实值只进入对应 Vercel Project Secret。真实开发与生产必须分别配置至少 32 字节的 `IDENTITY_SECURITY_SECRET`，且不得与 `REFERRAL_CODE_SECRET` 共用。任何 `SUPABASE_SERVICE_ROLE_KEY`、`IDENTITY_SECURITY_SECRET`、`TELEGRAM_BOT_TOKEN`、`CRON_SECRET`、`TELEGRAM_WEBHOOK_SECRET`、TON API Key 或签名私钥均不得进入浏览器环境。

真实开发 Vercel Production 固定配置 `TELEGRAM_BOT_USERNAME=FinalTMA_bot` 与 `TELEGRAM_MINI_APP_SHORT_NAME=pokepets_dev`。邀请链接必须为 `https://t.me/FinalTMA_bot/pokepets_dev?startapp=<当前用户邀请码>`；环境变量变更必须由新部署生效。

真实开发 Telegram 入口固定为同一组配置：Bot 为 `@FinalTMA_bot`；BotFather Main Mini App 已启用并指向 `https://final-tma-pi.vercel.app/`；named Mini App 的 short name 为 `pokepets_dev`，公开链接为 `https://t.me/FinalTMA_bot/pokepets_dev`；默认菜单按钮文字为 `Open PokePets`，目标为该 named Mini App 链接。发布验收必须同时满足 Bot API `getMe.result.has_main_web_app=true`，以及 `getChatMenuButton.result.web_app.url=https://t.me/FinalTMA_bot/pokepets_dev`。
