# ADR-056：Battle 实时授权上下文切换

- 状态：已接受
- 日期：2026-08-10

## 背景

Battle 的五分钟 Ably token 由当前数据库事实决定最小 subscribe capability。接受者打开挑战卡时持有用户频道与 invite 频道；接受成功后，同一 room ID 对应的权威权限变为用户频道与 room 频道。原 Web 连接 key 只使用裸 room ID，前后相同，因此不会重建连接；Ably 自动更新 token 时，客户端又要求新旧频道集合完全相同，把服务端合法的 `invite → room` 权限收缩与替换误判为无效 token，产生 `token_refresh_invalid` 和 401，随后长期退化为 REST 轮询。[Ably 官方 token auth](https://ably.com/docs/auth/token) 明确允许使用新 token 动态改变同一连接的频道权限，并在 AUTH 完成后以连接更新事件确认生效。

## 决策

Battle Web 对授权上下文采用两层确定性切换：

1. 连接 key 固定区分 `invite:<room_id>`、`room:<room_id>` 与 `user:<user_id>`。REST 权威状态从邀请进入参与房间时，即使 room ID 未变化，也必须关闭旧 Ably client，并以新的当前上下文重新请求 token、订阅和连接；不得等待五分钟 token 到期。
2. 为覆盖服务端状态已变化但 React 权威快照尚未回正的竞态，自动 token 更新允许频道集合在同一可信身份内变化。客户端必须结构化验证 token 只有精确 Battle 用户、room、invite 频道且每个频道只有 `subscribe`，禁止通配符；刷新前后的 `clientId` 与唯一用户频道必须完全相同。验证通过后先把 token 交给 Ably AUTH；只有连接收到 AUTH 成功后的 `connected/update`，才附加新增频道并取消、detach 已移除频道。

频道名始终来自同源 `/api/battle/realtime-token` 的服务端签发结果，浏览器不提交或选择频道。数据库 `api.battle_realtime_context`、五分钟 TTL、Ably key、outbox、消息 DTO、REST 回正与业务裁决均不改变。

## 安全不变量

- 任一刷新 token 缺少唯一用户频道、`clientId` 与用户频道不一致、身份相对初始连接发生变化、包含通配符、非 Battle 精确频道、重复同类 room/invite 频道或除 `subscribe` 外的操作时，固定拒绝并进入既有 REST 恢复。
- 合法上下文切换不能扩大到当前 token 未授权的频道；旧 invite 权限被新 token 移除后，客户端同时取消本地订阅并尝试 detach。
- 浏览器仍不能 publish、presence-enter、history 或管理频道；Ably 仍只发送四字段失效通知。
- 客户端日志继续遵循 ADR-055，不记录身份、频道、token 或 capability。

## 验收

架构门禁必须同时固定带类型的授权上下文 key、刷新 token 的同身份结构验证，以及 Ably AUTH 成功后才执行的订阅集合重协调。格式、ESLint、Web TypeScript、完整静态门禁和生产构建必须通过。

Git Integration 自动部署同一提交后，使用真实 Telegram Mini App 与 Safari Web Inspector，从有效挑战卡进入接受页并成功加入 room。Network 必须证明新上下文 token 仍为五分钟、subscribe-only、身份不变且频道从 invite 切换为 room；Ably 主连接保持或重新达到 `connected`，Console 不得出现 `token_refresh_invalid`、401、`connection_unavailable` 或 `channel_attach_failed`。随后持续超过一次 token 自动刷新窗口，确认连接仍为 `connected`、新 token 仍是当前最小 capability，且稳定阶段停止固定 1—2 秒 REST 轮询。
