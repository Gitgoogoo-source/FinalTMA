# ADR-054：Ably 浏览器 CSP 端点白名单

- 状态：已接受
- 日期：2026-08-10

## 背景

Battle Web 使用 `ably@2.26.0` 默认浏览器传输配置。SDK 的当前主连接端点是 `main.realtime.ably.net`，旧兼容端点是 `rest.ably.io` 与 `realtime.ably.io`，回退端点位于 `*.ably-realtime.com`，浏览器联网与 WebSocket 能力检测也使用该回退域。原 CSP 只允许 `*.ably.io`，因此 Safari WebView 会在 DNS 或 CNAME 解析之前按请求 URL 的主机名拒绝当前主 WebSocket 和联网检测请求。REST 权威读取仍可用，但页面会长期处于实时未连接状态，并按既定恢复节奏重复轮询。

## 决策

根路径和全部前端深链统一下发的 `connect-src` 固定为：

```text
'self'
https://rest.ably.io
https://realtime.ably.io
wss://realtime.ably.io
https://main.realtime.ably.net
wss://main.realtime.ably.net
https://*.ably-realtime.com
wss://*.ably-realtime.com
```

`rest.ably.io` 只需要 HTTPS；Realtime 主端点同时允许 HTTPS/XHR 与 WSS；`*.ably-realtime.com` 同时覆盖 SDK 的区域回退端点、`internet-up` 与 `ws-up` 检测端点。不得以 `https:`、`wss:`、`*` 或其他宽泛来源替代这份精确集合，也不得为解决 CSP 而固定旧端点、关闭 SDK 回退/联网检测、强制单一传输或通过 Vercel Function 代理 Ably。

浏览器继续只取得五分钟 subscribe-only token。Ably 只发送失效元数据，业务状态仍由同源 REST 与 PostgreSQL 最终裁决；实时连接恢复不会改变轮询失败时的既有 REST 回正能力。

## 不变量

- CSP 只允许同源与上述 Ably TLS 端点；不增加浏览器对 Supabase Data API、第三方 API 或明文 HTTP/WS 的访问。
- `img-src`、`script-src`、`worker-src` 与其他指令保持现有安全边界。
- Ably capability 仍只能 subscribe，浏览器不能 publish、presence-enter 或管理频道。
- 消息仍只含 `event_id`、`room_id`、`state_version` 与 `event_kind`，收到消息后只触发同源 REST 权威读取。
- 升级 Ably SDK、启用自定义 endpoint、改用环境级 endpoint 或观察到新的官方请求域时，必须先更新本 ADR、CSP 精确集合与静态门禁，再发布同一提交。

## 验收

`pnpm architecture:check` 必须结构化读取 `vercel.json`，确认根路径和深链共用唯一 CSP，`img-src` 没有扩张，且 `connect-src` 与本 ADR 的集合完全一致；多余、缺失或重复来源均失败。开发构建与完整静态门禁必须通过。

Git Integration 自动部署同一提交后，生产响应的根路径与 `/game` 必须返回该 CSP。关闭旧 Mini App 并从真实 Telegram iPhone WebView 重新打开；Safari Web Inspector 必须确认 `POST /api/battle/realtime-token` 成功、`wss://main.realtime.ably.net` 建立连接、联网检测和回退域不再产生 CSP 拒绝。真实 Battle 状态变化必须经 Ably 失效通知触发一次 REST 权威读取；连接稳定且 deadline 未到时不得继续固定每 1—2 秒轮询。

验收还必须临时阻断 Ably 网络请求并证明原有 REST 回正接管，恢复网络后客户端重新连接且固定短轮询停止。该阻断只作用于浏览器调试会话，验证后立即清除；不得修改生产 CSP、Ably key、Vercel 环境变量、数据库事实或 Battle 业务结果来制造降级。
