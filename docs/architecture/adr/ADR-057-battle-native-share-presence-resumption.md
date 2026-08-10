# ADR-057：Battle 原生分享返回后的 Presence 恢复

- 状态：已接受
- 日期：2026-08-10

## 背景

Telegram Mini Apps 官方协议为 `shareMessage(message_id, callback)` 定义调用级 callback，并定义 `shareMessageSent` 与 `shareMessageFailed` 完成事件。真实 Telegram iOS 中，打开原生分享面板会使 Battle 收到 `deactivated` 并按既有规则结束当前 lease；面板发送或关闭后 callback 能正常返回，但客户端不保证再发一次 `activated`，`Telegram.WebApp.isActive` 也可能继续短暂为 `false`。原实现只更新分享反馈，presence 恢复完全依赖 `activated`、`visibilitychange`、`pageshow` 或 `focus`，因此创建者虽然已经回到可见 `waiting` 页面，数据库仍停留在 offline，直到页面重载。

[ADR-013](ADR-013-session-page-lifecycle.md)要求恢复时先读取权威 room，再使用数据库下一 lifecycle version 创建新 lease；[ADR-018](ADR-018-battle-share-platform-conditional-evidence.md)要求分享 callback 与全局事件必须按 session generation、room、side、status 和实际调用尝试隔离，且分享反馈不得进入业务裁决。本修复必须同时保留两项边界。

## 裁决

当前创建者 `friend_invite/waiting` room 实际调用 `shareMessage` 后，属于同一 `ShareAttempt` 的调用级 callback、`shareMessageSent` 或 `shareMessageFailed` 固定具有两种彼此独立的语义：

1. 继续按 ADR-018 更新仅存在于内存的发送、取消或失败反馈；该反馈不证明房间或业务成功。
2. 证明本次原生分享面板流程已经结束。Web 保存当前有效完成信号；若 `/game` 已是活动页且文档可见，立即把它作为受信前台恢复触发，令 `hostActiveRef` 回到 active，并调用既有 `restorePresence()` 权威恢复入口；若完成信号先于 WebView 恢复可见，则保留到紧随其后的 `visibilitychange`、`pageshow`、`focus` 或 `activated` 再消费。两条时序都不等待额外 `activated`，也不读取滞后的 `isActive=false` 作为否决条件。

callback 与全局事件可能为同一尝试各到达一次。Web 以 `ShareAttempt` 对象身份同时记录待恢复与已经启动恢复的尝试，同一尝试最多启动一次恢复。恢复前仍复核当前 session generation、room ID、创建者 side 与 `waiting` 状态；切换房间、终态退出、离开 `/game`、重新认证或 generation 改变时清除待恢复信号，迟到完成信号既不能更新反馈，也不能恢复 presence。

恢复必须复用 `restorePresence()`：先读取 viewer-specific 权威 room，确认 authority 健康后才开放 heartbeat effect；heartbeat 使用数据库快照的下一 lifecycle version、新 UUID lease 和从 1 开始递增的 command sequence。禁止直接复活分享前已经结束的 lease，禁止从 callback 直接写数据库 presence，禁止新增分享专用 API、RPC、持久状态或业务 operation。

## 结果

Telegram iOS 即使没有补发 `activated`，创建者回到可见等待页后也会在既有 REST/heartbeat 链路内恢复在线展示。普通 `activated`、`visibilitychange`、`pageshow`、`focus` 和网络恢复继续复用同一 presence 入口；数据库的版本、lease 与序号仍是最终裁决，旧请求和重复平台事件不能覆盖新生命周期。分享成功、取消、失败、房间、资产、邀请有效期与接受规则均不改变。

## 发布门禁

- TypeScript、架构、格式、完整静态构建门禁通过。
- 真实 Telegram iOS 分别执行成功发送与关闭面板，不能只用普通浏览器事件模拟。
- Safari Web Inspector 保存 callback/官方完成事件、缺失或滞后的激活事实、单次 room 回正和后续 heartbeat 网络证据。
- Supabase 证明 lifecycle version 增加、lease 更换、command sequence 递增、10 秒在线窗口保持，且旧 lease、资产、reservation、operation、outbox 与 violation 无异常变化。
