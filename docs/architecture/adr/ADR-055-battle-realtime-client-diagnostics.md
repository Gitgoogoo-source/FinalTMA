# ADR-055：Battle 实时客户端安全诊断

- 状态：已接受
- 日期：2026-08-10

## 背景

Battle 的 Ably 模块将动态加载、token、连接和频道订阅的任何失败统一降级为 `offline`。这保证了 1—2 秒 REST 回正能够继续，但原实现同时丢弃了 Ably 的连接原因与频道 attach 错误，Safari Web Inspector 只能看到固定轮询，无法区分传输失败、token 更新失败或 capability/频道订阅失败。Vercel 服务端日志只能证明 token 签发与 outbox publish，不能替代浏览器连接证据。

## 决策

Battle realtime 动态模块永久保留一条浏览器控制台诊断 `battle_realtime_unavailable`。诊断只在以下真实失败边界产生：

- `token_refresh_invalid`
- `token_refresh_failed`
- `connection_unavailable`
- `channel_attach_failed`

每条诊断只包含固定 `stage`、固定 Ably `connection_state`、整数 `code` 与整数 `status_code`；不存在的值写 `null`。禁止记录原始异常消息、用户、Telegram 身份、session、room、invite、event、channel、token、capability、请求/响应内容或 URL。诊断不发起新的网络请求，不写入数据库，不改变 Ably、REST、轮询、重连、deadline 或业务状态。

玩家界面继续只显示实现无关的恢复反馈，不出现服务器、数据库、REST、请求、token、channel 或错误码等内部概念。Web Inspector 诊断只用于定位和验收，不作为业务成功或失败的事实来源。

## 验收

格式、ESLint、Web TypeScript、架构检查和生产构建必须通过。真实 Telegram Mini App 中，Safari Web Inspector 应能在 Ably 连接或频道订阅实际失败时读取上述脱敏字段，并确认控制台内容不含任何禁止字段；正常连接期间不得产生该诊断。诊断证据必须与同一部署的 Network 请求、Vercel Function 终态日志和 REST 轮询行为分开判定。
