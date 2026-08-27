# ADR-087：Telegram 聊天列表授权与首次欢迎消息

- 状态：已接受
- 日期：2026-08-27

## 背景

用户从 Main Mini App、named Mini App 或菜单按钮启动 EvoMyPet，不等于已经与 `@EvoMyPet_bot` 建立可持续发消息的私聊关系，也不能保证 Bot 出现在用户的 Telegram 聊天列表。Telegram 只允许 Mini App 通过原生 `requestWriteAccess()` 请求写入私聊权限，最终结果由用户在 Telegram 官方弹窗中确认；网页弹窗、BotFather 入口配置或浏览器直接调用 Bot API 均不能替代该授权。

## 唯一结论

正常账号完成 Telegram 认证、入口交接和首个可操作页面准备后，Web 检查当前 Telegram 用户的 `allows_write_to_pm`。授权协调器作为独立动态模块加载，不进入首屏静态闭包；如果模块晚于页面就绪信号加载，则读取同一 session generation 与路径的已就绪快照后继续，不丢失触发。已经授权时不再请求；未授权且客户端至少支持 Bot API 6.9、同时存在 `requestWriteAccess()` 时，每个新 WebView 自动调用一次原生授权弹窗。用户拒绝后，本 WebView 不循环弹窗、不阻塞游戏，也不写入持久关闭标记；用户下次完整关闭并重新进入 Mini App 时自动再次请求，直到用户授权。旧客户端、普通浏览器、方法缺失或调用抛错时静默跳过，游戏继续可用。

`allows_write_to_pm` 只用于前端体验分流，不作为服务端权限或身份事实。服务端只接受带正确 `X-Telegram-Bot-Api-Secret-Token` 的 Telegram webhook，并且只处理私聊中 `message.write_access_allowed.from_request=true`、`message.from.id=message.chat.id`、Telegram ID 为正安全整数的事件。数据库按 Telegram ID 找到 `status=normal` 的内部账号后，才允许至多尝试一次欢迎消息；未识别账号、封禁账号、非私聊、身份不一致、非请求产生的授权或非法数字全部返回成功确认但不发送消息。

授权成功后欢迎消息固定按账号 `preferred_language` 发送，并带一个指向 `https://t.me/EvoMyPet_bot/evomypet` 的 URL 按钮：

- 英语正文：`Welcome to EvoMyPet! 🐾\nYour adventure is ready. Open the game anytime from this chat.`；按钮：`Open EvoMyPet`。
- 简体中文正文：`欢迎来到 EvoMyPet！🐾\n你的冒险已经准备好了，以后可以随时从这个聊天打开游戏。`；按钮：`打开 EvoMyPet`。

数据库私有表 `operations.telegram_chat_onboarding` 以内部 `user_id` 为主键，并唯一保存 Telegram ID 与首次授权 `update_id`。记录在外部 `sendMessage` 前原子写入 `delivery_status=unknown` 与 `attempted_at`，因此重复 webhook、Telegram 重试、多设备并发或不同授权 update 都不能再次取得发送资格。发送成功写入 `sent`、Telegram message ID 与完成时间；明确失败写入 `failed`；网络或响应不确定写入 `unknown` 并记录完成时间。Bot API `sendMessage` 没有可由调用方提供的幂等键，所以任何已经开始的发送都不得自动重放；极少数不确定结果下缺少欢迎消息优先于重复骚扰。Telegram 自身的授权服务消息仍会建立私聊并实现聊天列表目标。

声明式 schema 提供两个只向 `service_role` 显式授权的 `api` RPC：`telegram_chat_onboarding_claim` 在事务内记录 webhook payload、验证正常账号并原子领取唯一发送资格；`telegram_chat_onboarding_finish` 只结束尚未完成的首次尝试，不能把任何记录重置为可发送。内部表启用 RLS 且不创建客户端 policy，`public`、`anon`、`authenticated` 和 `service_role` 均无表级权限；浏览器不新增 REST、Supabase SDK、Postgres、RPC 或 Auth 访问。

Telegram 顶层 webhook 编排归属于 `apps/api/src/workflows/telegram-webhook`，在同一 `message` update 类别内依次识别写权限授权、`/paysupport`、成功支付与退款；Stars 支付规则不变。Webhook 的 `allowed_updates` 继续精确为 `message` 与 `pre_checkout_query`，不新增环境变量、Bot、short name、Cron 或 Telegram Stars 支付。

## 验收与失败边界

同一 Production deployment SHA 必须在真实 iPhone Telegram 与 Android Telegram 验证：英语和简体中文首次授权；拒绝后同一 WebView 不重复、重新进入后再次弹出；拒绝后再次进入并授权只收到一条欢迎消息；已授权账号不再弹出且重复 update、多设备并发都不重复消息；既有未授权账号重新进入也会请求；封禁账号、伪造身份、非私聊和 `from_request` 缺失均不发送。Safari Web Inspector 只用于检查页面运行与调用异常，不能替代真实原生弹窗和聊天列表结果。Telegram API、数据库或客户端能力失败均不得阻塞游戏；不得为验收支付 Telegram Stars，也不得创建视觉验收记录日志。

## 关联裁决

本 ADR 补充 [ADR-001](ADR-001-runtime-and-deployment.md)、[ADR-074](ADR-074-account-language-and-en-us-localization.md)、[ADR-075](ADR-075-telegram-named-mini-app-release-isolation.md)、[ADR-077](ADR-077-telegram-payment-support-command.md) 与 [ADR-086](ADR-086-evomypet-production-cutover.md)。它不改变生产 Bot、named Mini App、菜单按钮、支付、发布隔离或首次开放后的 migration 冻结规则。
