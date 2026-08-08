# 环境矩阵

| 项目            | 本地                  | 真实开发                                                                        | 真实生产                                      |
| --------------- | --------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| Git commit      | 当前工作提交          | 持续开发提交                                                                    | 与开发验收通过的提交相同                      |
| Node / pnpm     | Node 24 / pnpm 11.1.3 | Node 24 / pnpm 11.1.3                                                           | Node 24 / pnpm 11.1.3                         |
| Vercel          | `vercel dev`          | `final-tma` Project，`APP_ENV=development`                                      | 未来独立 Pro Project                          |
| Supabase        | 本地 Postgres 17      | `final-tma-real-test`（ref `ebewtjerusxcioegpzjd`）Postgres 17 Project          | 未来独立 Postgres 17                          |
| Telegram        | 开发 Bot              | 开发 Bot 与开发 webhook                                                         | 生产 Bot 与生产 webhook                       |
| Ably            | 独立开发 app/key      | 独立真实开发 Ably Standard app/key                                              | 独立生产 Ably Standard app/key                |
| TON             | 不启用                | 不发布 Collection、不启用 Mint 对账 Cron                                        | 不发布 Collection、不启用 Mint 对账 Cron      |
| 藏品图片        | 从受控候选目录生成    | `art-masters` 私有桶 + `pet-runtime` 公开桶                                     | 环境隔离的同名私有桶与公开桶                  |
| 数据            | 非业务本地数据        | 独立真实开发与验收数据                                                          | 真实生产数据                                  |
| Battle 验收夹具 | 默认未绑定、未启用    | owner 绑定 `real_development` 与 `ebewtjerusxcioegpzjd`，按次启用且最长 24 小时 | 默认未绑定、未启用，`production` 身份禁止启用 |

210 张正式母版永久保存在各环境的 `art-masters` 私有桶，每张固定生成 256×256 缩略图和 768×768 详情图写入 `pet-runtime` 公开桶。Git 不保存这些二进制，只保存当前 v2 清单和历史发布清单。真实开发与生产只允许公开桶基址、项目 ID、Bot 和项目密钥不同，必须使用同一 Git commit、同一 OpenAPI、同一资源清单结构、同一生成参数和同一 migration 序列；生产发布前必须把已在真实开发验收的同一母版 SHA-256 和运行时 SHA-256 上传并原子发布到生产自己的桶。公开 v2 对象响应固定为 `public, max-age=31536000, immutable`。Telegram 分享图完成正式替换前，全局 production 资产门禁保持失败；休眠的 TON Connect 图标不阻塞当前 MVP。

Battle 发布后，真实开发与生产固定启用 Web、API、Supabase、Telegram webhook、Ably subscribe-only、`battle-tick-v1`、两个 Battle integrations、支付对账、幂等清理和不变量监控。TON 配置为空，`reconcile-mints` 不进入 Vercel Cron；Web 不展示钱包或 Mint，不加载 TON Provider，也不执行 Mint 恢复。非 TON API 只解析自身所需配置，不接受任何 TON 占位值。

Supabase Data API 的 Exposed schemas 固定为 `public,graphql_public,api`。Vercel Functions 只以 `service_role` 调用 `api` schema RPC；浏览器不持有 Supabase key，也不直接访问任何 Supabase schema、RPC、Auth 或其他 Data API。唯一例外是浏览器匿名 GET `pet-runtime` 公开桶中由 API 返回的宠物图片完整 URL。业务表 schema 不加入 Exposed schemas。

`admin` schema 永不加入 Exposed schemas。Battle 验收夹具的 database identity、环境门禁、reconciliation 和状态读取均只属于数据库 owner 通道，不使用 Vercel/Supabase Sensitive 环境变量、Vault secret 或 `service_role`。

Web 公开构建当前不需要 `VITE_*`。API 机密配置以根 `.env.example` 为唯一名称清单，真实值只进入对应 Vercel Project Secret。`SUPABASE_SERVICE_ROLE_KEY` 可以承载目标环境的 legacy `service_role` JWT 或新式 Supabase secret key；服务端 HTTP 工具始终发送 `apikey`，只有 legacy JWT 同时发送 Bearer，新式 secret key 禁止作为 Bearer token。真实开发与生产必须分别配置至少 32 字节的 `IDENTITY_SECURITY_SECRET`、`BATTLE_INVITE_SECRET` 和 `BATTLE_OUTBOX_SECRET`，三者及 `REFERRAL_CODE_SECRET` 互不共用。`IDENTITY_SECURITY_SECRET` 同时用于域隔离登录指纹、确定性 session UUID 和访问令牌 HMAC；轮换会立即使最多 15 分钟的现有会话失效，轮换发布必须关闭旧 WebView 并要求从 Telegram 重新进入，不配置双密钥兼容。Vercel 另配置环境隔离的 `ABLY_API_KEY`；Supabase Vault 配置 Battle share callback URL、Battle outbox callback URL 和与对应 Vercel 环境一致的 `BATTLE_OUTBOX_SECRET`。任何 `SUPABASE_SERVICE_ROLE_KEY`、`IDENTITY_SECURITY_SECRET`、`TELEGRAM_BOT_TOKEN`、`CRON_SECRET`、`TELEGRAM_WEBHOOK_SECRET`、`ABLY_API_KEY`、Battle secret、TON API Key 或签名私钥均不得进入浏览器环境。

`BATTLE_INVITE_SECRET` 只用于按创建 operation 确定性生成 Battle bearer invite；`BATTLE_OUTBOX_SECRET` 只鉴权两个 Battle integration，不得用于玩家 API、Telegram webhook 或邀请签名；`ABLY_API_KEY` 只在服务端签发五分钟 subscribe-only token 和投递 outbox。三项 Battle 变量由 Battle share、outbox、realtime 与 integration 的独立配置边界校验，缺失时只阻断 Battle 路径，不得阻断 Telegram 登录、普通 webhook、钱包或其他非 Battle 路由。API workspace 固定 `ably@2.26.0`，浏览器只接收短期 token，绝不接收这三个服务端变量。

真实开发与生产 Supabase 都安装 `pg_cron`、`pg_net`、Vault 和 `pgcrypto`。三条 migration 提交后由 owner 独立执行 `pg_reload_conf()`；`battle-tick-v1` 每秒执行，`battle.tick_health()` 与 `monitor-invariants` 监控配置、停滞和失败，运行明细保留 7 天并由既有每日 cleanup 清理，不增加第二个 Supabase cron job。Data API 仍只暴露 `public,graphql_public,api`，内部 `battle` schema 不暴露。两个环境使用同一 `battle-v1` checksum、OpenAPI、Git commit 和 migration 序列，只允许 Bot、Ably key、callback URL、项目 ID、域名和机密不同。

真实开发 Vercel Production 固定配置 `TELEGRAM_BOT_USERNAME=FinalTMA_bot` 与 `TELEGRAM_MINI_APP_SHORT_NAME=pokepets_dev`。推荐链接固定为 `https://t.me/FinalTMA_bot/pokepets_dev?startapp=<当前用户邀请码>`，Battle prepared-share deep link 固定为同一 Bot 与 named Mini App 路径加 `startapp=BTL_<32位base64url>`；环境变量变更必须由新部署生效。

真实开发 Telegram 入口固定为同一组配置：Bot 为 `@FinalTMA_bot`；BotFather Main Mini App 已启用并指向 `https://final-tma-pi.vercel.app/`；named Mini App 的 short name 为 `pokepets_dev`，公开链接为 `https://t.me/FinalTMA_bot/pokepets_dev`；默认菜单按钮文字为 `Open PokePets`，目标为该 named Mini App 链接。发布验收必须同时满足 Bot API `getMe.result.has_main_web_app=true`，以及 `getChatMenuButton.result.web_app.url=https://t.me/FinalTMA_bot/pokepets_dev`。
