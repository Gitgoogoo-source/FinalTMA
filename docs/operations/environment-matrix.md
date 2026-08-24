# 环境矩阵

| 项目            | 本地                                  | 唯一生产资源                                                                 |
| --------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Git commit      | 当前工作提交                          | `main` 上经完整门禁并由 Git Integration 部署的同一提交                       |
| Node / pnpm     | Node 24 / pnpm 11.1.3                 | Node 24 / pnpm 11.1.3                                                        |
| Vercel          | `vercel dev`、`APP_ENV=development`   | `final-tma` Project、`APP_ENV=production`、`https://final-tma-pi.vercel.app` |
| Supabase        | 本地 Postgres 17                      | `final-tma-real-test`（ref `ebewtjerusxcioegpzjd`）Postgres 17               |
| Telegram        | 不接生产 webhook                      | `@EvoMyPet_bot` 与唯一生产 webhook                                           |
| Ably            | 本地配置                              | 当前 Production 对应的 Ably Standard app/key                                 |
| TON             | 不启用                                | 不发布 Collection、不启用 Mint 对账 Cron                                     |
| 藏品图片        | 1024 PNG 只读导入并在 Git 外生成 WebP | 既有 `art-masters` 私有桶 + `pet-runtime` 公开桶                             |
| 数据            | 非业务本地数据                        | 首次开放前清空重建；开放后作为不可丢失生产数据                               |
| Battle 验收夹具 | 默认未绑定、未启用                    | 绑定 `production / ebewtjerusxcioegpzjd`，生产身份永久禁止启用               |

本矩阵由 [ADR-086](../architecture/adr/ADR-086-evomypet-production-cutover.md) 固定。项目不再维护另一套云端开发、测试或未来生产资源；基础设施名称中的 `final-tma` 和 `real-test` 只是不向玩家展示的既有技术标识。

每轮 210 张 1024×1024 PNG 设计输入只在受控本地目录保存，导入过程不得修改原图；清单记录输入集合 SHA-256 和 ADR-078 的固定转换参数。210 张 768×768 lossless WebP 正式母版永久保存在现有 `art-masters` 私有桶，每张固定生成 256×256 缩略图和 768×768 详情图写入现有 `pet-runtime` 公开桶。Git 不保存 PNG、母版或运行时二进制，只保存当前 v2 清单和历史发布清单。生产继续使用已验收的同一对象字节，不重新转换、不复制到第二个项目；公开 v2 对象响应固定为 `public, max-age=31536000, immutable`。正式 EvoMyPet Telegram 分享图必须通过 production 资产门禁；休眠的 TON Connect 图标不阻塞当前 MVP。

生产固定启用 Web、API、Supabase、Telegram webhook、Ably subscribe-only、`battle-tick-v1`、两个 Battle integrations、支付对账、幂等清理、不变量监控和公开对象清理。TON 配置为空，`reconcile-mints` 不进入 Vercel Cron；Web 不展示钱包或 Mint，不加载 TON Provider，也不执行 Mint 恢复。非 TON API 只解析自身所需配置，不接受任何 TON 占位值。

Supabase Data API 的 Exposed schemas 固定为 `public,graphql_public,api`。Vercel Functions 只以 `service_role` 调用 `api` schema RPC；浏览器不持有 Supabase key，也不直接访问任何 Supabase schema、RPC、Auth 或其他 Data API。唯一例外是浏览器匿名 GET `pet-runtime` 公开桶中由 API 返回的宠物图片完整 URL。业务表和 `admin` schema 永不加入 Exposed schemas。

Web 公开构建不读取 `VITE_*`。API 配置名称以根 `.env.example` 为唯一清单，真实值只进入 Vercel Production Secret。`SUPABASE_SERVICE_ROLE_KEY` 可以承载 legacy `service_role` JWT 或新式 Supabase secret key；服务端 HTTP 工具始终发送 `apikey`，只有 legacy JWT 同时发送 Bearer，新式 secret key 禁止作为 Bearer token。`IDENTITY_SECURITY_SECRET`、`REFERRAL_CODE_SECRET`、`CRON_SECRET`、`BATTLE_INVITE_SECRET`、`BATTLE_OUTBOX_SECRET` 和 `TELEGRAM_WEBHOOK_SECRET` 必须各自独立；`ABLY_API_KEY` 只用于五分钟 subscribe-only token 与 outbox 发布。任何 Bot token、数据库 key、会话 secret、Battle secret、Ably key、TON key 或私钥均不得进入 Git、聊天、日志、截图或浏览器环境。

Supabase 固定安装 `pg_cron`、`pg_net`、Vault 和 `pgcrypto`。三条 migration 提交后由 owner 独立执行 `pg_reload_conf()`；`battle-tick-v1` 每秒执行，`battle.tick_health()` 与 `monitor-invariants` 监控配置、停滞和失败。Supabase Vault 的 Battle share callback URL、Battle outbox callback URL 和 `BATTLE_OUTBOX_SECRET` 必须与当前 Vercel Production 完全一致。运行明细保留 7 天并由既有每日 cleanup 清理。

Vercel Production 固定配置 `APP_BASE_URL=https://final-tma-pi.vercel.app`、`TELEGRAM_BOT_USERNAME=EvoMyPet_bot` 与 `TELEGRAM_MINI_APP_SHORT_NAME=evomypet`。推荐链接固定为 `https://t.me/EvoMyPet_bot/evomypet?startapp=<当前用户邀请码>`，Battle prepared-share deep link 固定追加 `startapp=BTL_<32位base64url>`；环境变量变更必须由新的 `main` Production deployment 生效。

生产 webhook URL 固定为 `https://final-tma-pi.vercel.app/api/telegram/webhook`，`secret_token` 与 Vercel Production 的 `TELEGRAM_WEBHOOK_SECRET` 一致，`allowed_updates` 精确为 `['message','pre_checkout_query']`。`message` 承载 `/paysupport`、`successful_payment` 和 `refunded_payment`，`pre_checkout_query` 承载付款前校验。`PAYMENT_SUPPORT_URL` 固定为独立且有人持续查看的人工支持入口 `https://t.me/EvoMyPetSupport`；真实 Bot 私聊验收未确认该回复前禁止开放充值。

Telegram 正常开放态固定为：Bot `@EvoMyPet_bot`；Main Mini App 和 named Mini App 都指向 `https://final-tma-pi.vercel.app/`；short name 为 `evomypet`；公开链接为 `https://t.me/EvoMyPet_bot/evomypet`；默认菜单文字为 `Open EvoMyPet` 并指向该公开链接。发布隔离态按 [ADR-075](../architecture/adr/ADR-075-telegram-named-mini-app-release-isolation.md) 停用 Main、恢复默认菜单行为并把 named Web App URL 改为 `https://final-tma-pi.vercel.app/maintenance.html`，不删除 short name。

生产入口恢复并开始承载用户后，数据库 migration history 立即冻结。此后禁止清库、重建 history、修改既有 migration、启用 Battle 验收夹具或恢复旧 schema，只允许兼容现有数据和已加载客户端的前向应用与追加 migration。
