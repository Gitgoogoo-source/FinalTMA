# ADR-077：Telegram 支付支持命令闭环

- 状态：已接受
- 日期：2026-08-19

## 背景

支付异常的产品规则已把 `/paysupport` 定义为唯一支付支持聊天命令，但原 Telegram webhook 只处理预结账、支付成功和退款更新。用户发送 `/paysupport` 时原处理器直接返回成功，没有调用 Telegram Bot API 回复；入站契约也未保留 `message.chat`，服务端无法取得应回复的会话。HTTP 的 `/api/telegram/payment-support` 虽能返回同一文案，但它不是 Bot 聊天命令处理器，不能替代 Telegram 回复。

## 决策

Telegram Update 契约保留 `message.chat.id` 与 `message.chat.type`。通过 webhook secret token 校验后，处理器只在 `chat.type = private` 时识别去除首尾空白后的完整 `/paysupport` 或 `/paysupport@<当前 TELEGRAM_BOT_USERNAME>`，Bot 用户名匹配不区分大小写。命令不接受额外参数；普通文本、其他命令、群聊、超级群组和频道不回复并正常返回 `ok`。

每个环境设置或恢复 webhook 时，`setWebhook` 必须把该环境的 HTTPS `/api/telegram/webhook` 作为唯一 URL，`secret_token` 与同环境 `TELEGRAM_WEBHOOK_SECRET` 一致，`allowed_updates` 精确为 `["message", "pre_checkout_query"]`。`message` 同时承载支付支持命令、支付成功与退款消息；只订阅 `pre_checkout_query` 会让这三类更新都无法进入服务端。不依赖 Telegram 记住上一次 `allowed_updates` 的隐式状态。

命中后调用现有 Telegram Bot API 客户端的 `sendMessage`，向经验证 Update 中的私聊 `chat.id` 回复默认英语 `Payment support: <PAYMENT_SUPPORT_URL>`，并关闭链接预览。聊天命令与既有 HTTP 支付支持端点共用唯一文案生成函数，避免命令、文案或环境链接分叉。链接只取自服务端已校验的 `PAYMENT_SUPPORT_URL`，不从用户消息、订单或 URL 参数生成。

`sendMessage` 超时、网络失败或 Telegram API 拒绝时，webhook 不回假成功，统一返回 `TELEGRAM_API_FAILED` 非 2xx 结果，交由 Telegram 重试该 Update。支持链接回复不读写订单、operation、资产、权益或账本；相同 Update 在不确定网络结果后重试可能产生重复链接消息，但不会改变任何业务事实。预结账、支付成功、退款和现有去重与交付规则保持不变。

## 不变量

- `/paysupport` 不查询、显示或修改用户订单，不发起退款、补发或资产调整。
- Mini App 不新增客服页面、支付申诉、工单、订单查询或路由。
- Bot token、webhook secret 和支持 URL 不进入前端、日志或回复的内部错误细节。
- 不新增数据库表、RPC、migration、定时任务或持久化幂等状态。
- 无法获得账号语言上下文的公开支付支持回复继续使用默认英语。

## 验收

影响域必须通过 Prettier、ESLint、API 与契约 TypeScript、OpenAPI 漂移检查、架构检查和生产构建，发布前执行完整 `validate:static`。同一部署 SHA 的真实 Telegram 私聊必须确认 `/paysupport` 与带当前 Bot 用户名后缀的形式均只回复当前生产环境支持链接，普通文本与群聊命令不回复。伪造或错误 webhook secret 的请求必须被拒绝；模拟 `sendMessage` 失败时必须返回非 2xx，且不产生数据库和资产副作用。该命令验收不实际支付 Telegram Stars；未绑定真实生产 Bot、webhook 与支持 URL 前只能记录为 `UNVERIFIED`，不得以本地或静态通过替代。
