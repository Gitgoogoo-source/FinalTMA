# ADR-086：EvoMyPet 品牌与既有云环境生产切换

- 状态：已接受
- 日期：2026-08-24

## 背景

项目原品牌已退役，原部署流程预留了另建独立生产 Vercel、Supabase 和 Bot 的方案。用户已完成生产 Telegram 账号加固并创建新 Bot，同时明确要求把品牌全面改为 EvoMyPet、完全替换旧 Bot、清空重建数据库，并复用现有 Vercel 与 Supabase 作为唯一生产资源。

## 唯一结论

玩家可见品牌固定为 `EvoMyPet`。生产 Bot 显示名称固定为 `EvoMyPet`，用户名固定为 `@EvoMyPet_bot`；named Mini App short name 固定为 `evomypet`，公开链接固定为 `https://t.me/EvoMyPet_bot/evomypet`，Main Mini App 与 named Mini App 的正常开放 URL 固定为 `https://final-tma-pi.vercel.app/`，默认菜单按钮固定显示 `Open EvoMyPet` 并指向 named Mini App 链接。Webhook 固定为 `https://final-tma-pi.vercel.app/api/telegram/webhook`。

生产入口恢复后，正常账号首次进入并完成首个可操作页面准备时按 [ADR-087](ADR-087-telegram-chat-list-onboarding.md) 请求一次 Telegram 原生写入私聊授权。用户授权后，Bot 私聊通过 Telegram 服务消息进入聊天列表，并由服务端按账号语言至多尝试一次欢迎消息；拒绝只在下一个新 WebView 再次自动请求，不改变 Main、named 或菜单入口配置。

Bot 头像固定使用用户确认的金龙图。金龙图只属于 Telegram Bot 头像，不进入 Git、Web、分享图、TON Connect manifest、启动页或游戏内 UI。Web、分享图和休眠 TON Connect manifest 继续使用项目自有的橙绿孵化舱与爪印通用标识；品牌切换只更新文字、文件名、引用和资源来源记录，不把金龙扩展为应用品牌资产。

既有 Vercel Project `final-tma`、稳定域名 `https://final-tma-pi.vercel.app/` 与 Supabase Project `final-tma-real-test`（ref `ebewtjerusxcioegpzjd`）固定作为正式生产资源，不新建第二套 Vercel、Supabase、Storage 或生产域名。`final-tma`、`final-tma-real-test` 和 project ref 只是不可见的基础设施标识，不属于玩家品牌，也不因本次改名而迁移或重命名。

生产 Vercel 固定设置 `APP_ENV=production`、`APP_BASE_URL=https://final-tma-pi.vercel.app`、`TELEGRAM_BOT_USERNAME=EvoMyPet_bot` 与 `TELEGRAM_MINI_APP_SHORT_NAME=evomypet`。生产 Bot token 只替换 `TELEGRAM_BOT_TOKEN`；`TELEGRAM_WEBHOOK_SECRET` 使用独立随机值，并同时用于 `setWebhook.secret_token` 与服务端验证。Bot token、webhook secret、Supabase service role、会话 secret、Battle secret 和 Ably key 均只保存在对应平台的生产 Secret，不进入 Git、聊天、截图、客户端或数据库表。

生产 `PAYMENT_SUPPORT_URL` 固定为 `https://t.me/EvoMyPetSupport`。该入口与 Bot 独立，由人工持续查看并处理付款问题；它不得改指向 `@EvoMyPet_bot`、Mini App 链接、占位账号或无人值守入口。真实 Bot 私聊验收未确认 `/paysupport` 正确回复该链接前，禁止开放充值和执行 Telegram Stars 付款。

## 一次性数据库切换

生产入口首次开放前，允许对 Supabase `ebewtjerusxcioegpzjd` 执行已经批准的最后一次清库和 migration history 重建。唯一合法顺序是：关闭 Main/named/menu 业务入口、webhook、Vercel Cron 与 `battle-tick-v1`；确认目标 project ref；部署并冻结同一 `main` commit；从空库连续应用仓库当前三条 migration；独立执行 `pg_reload_conf()`；恢复冻结的 Storage 资源登记与当前 Catalog；把 `admin.database_identity` 一次性绑定为 `production / ebewtjerusxcioegpzjd`；保持 Battle 验收夹具禁用；验证 OpenAPI、Catalog、Battle checksum、RLS、授权、Cron 和部署 SHA 一致后再恢复入口。

生产身份 `production` 不能启用 `admin.configure_battle_fixture_gate`。既有 `real_development` 绑定不得带入重建后的数据库。入口恢复并开始承载玩家后，当次 migration 历史立即冻结：不得清库、修改既有 migration、重建 history、恢复开发夹具或回滚数据库，只允许兼容现有数据和已加载客户端的前向应用与追加 migration。

## Telegram 发布隔离与恢复

切换期间 `evomypet` short name 必须保留，其 Web App URL 固定指向 `https://final-tma-pi.vercel.app/maintenance.html`；Main Mini App 停用，默认菜单恢复 Telegram 默认行为。禁止删除 named Mini App、创建临时 short name、复用旧 Bot token、把 webhook 暂时指向第三方地址或通过暂停 Vercel Project 代替入口隔离。

恢复顺序固定为：先确认稳定域名的维护页和目标 Production deployment；再恢复 webhook 并用 `getWebhookInfo` 核对 URL、`secret_token` 生效且 `allowed_updates` 精确为 `message` 与 `pre_checkout_query`；把 named Mini App URL 改回根 URL并从真实 Telegram 直链验收；启用 Main Mini App；最后把默认菜单设为 `Open EvoMyPet`。任一步失败都保持尚未恢复的入口关闭。

Bot 所有权转移只能在生产入口、webhook、支付支持和恢复流程全部验收后进行。转移前后都必须保存生产账号两步验证与恢复邮箱，接收方先加入 Bot 管理且确认可见，转移后立即用 BotFather 和 Bot API 复核 Bot username、token 有效性、Main/named/menu 配置及 webhook；转移本身不更换 token，只有 token 被撤销、泄露或 BotFather 明确重置时才同步更新 Vercel 并重新部署、重设 webhook。

## 取代关系

本 ADR 取代所有旧文档中关于“未来另建生产 Vercel/Supabase/Storage/Bot”“开发 Bot 与生产 Bot 并存”以及“生产上传另一份资源”的环境裁决。旧 ADR 中关于业务规则、事务、权限、资源内容哈希、真实 Telegram 验收和 Git Integration 的非环境结论继续有效。ADR-075 的维护页隔离机制继续有效，其目标环境由本 ADR 固定为上述唯一生产资源。
