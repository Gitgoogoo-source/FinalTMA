# 安全边界

浏览器不安装或调用 Supabase 客户端，不接收 `service_role`、`IDENTITY_SECURITY_SECRET`、Bot Token、Cron Secret、TON 签名私钥或任何 `VITE_*` 机密。Telegram 是唯一登录身份；不使用 Supabase Auth、`auth.users`、Supabase Session、JWT 或 Refresh Token。登录来源、Telegram 用户、`initData` 和预认证请求只以 `IDENTITY_SECURITY_SECRET` 域隔离 HMAC 指纹进入限流与幂等表，日志不记录原 IP、原 `initData` 或 bearer token。

Data API 只暴露 `api` schema。安全迁移撤销 `PUBLIC`、`anon`、`authenticated` 对内部 schema、表、序列和函数的权限，也撤销 `service_role` 对内部对象的直接权限；Functions 的 `service_role` 只执行 `api` schema 中的 SECURITY DEFINER RPC。

所有 SECURITY DEFINER 函数使用空 `search_path` 和完全限定对象名。RLS 在内部表上启用且不创建玩家访问策略，只作为外围拒绝层；业务授权全部由 Functions 与 RPC 显式完成。

会话认证按令牌、撤销/过期状态、账号状态、入口交接状态顺序裁决。除 `referral.bind` 与受限的 `operations.get` 外，Functions 中间件和数据库 `api.session_user` 都拒绝 `pending` 交接，固定返回 `ENTRY_HANDOFF_PENDING`。浏览器构造请求、修改入口参数或跳过启动工作流均不能访问业务 RPC。

账号封禁切换先把内存账号状态设为 `banned` 并生成新 session generation，再取消请求并清空查询、操作、弹窗和导航。任何请求、预取或缓存种子写入前都同时验证原 generation 与当前 `normal` 状态，迟到响应只能作为 `AbortError` 丢弃。

Telegram webhook 使用 secret token，Cron 使用 `CRON_SECRET`。支付回调按 Telegram update 与 charge 唯一键去重；Cron 同时使用任务名 advisory lock、运行租约、状态扫描和幂等 RPC。

## Monster Tamer 只读渲染边界

Monster Tamer 业务入口位于已登录 React 主应用。领域组件只通过现有认证查询 `inventory.list` 读取数据库裁决后的藏品状态，过滤 `available > 0` 并按 `template_id` 去重；它不接受 Phaser 提交的归属、数量、图片、稀有度、阶段或战斗力。

`/monster-tamer/` 是公开可请求但业务上无能力的同源渲染文档。它不接收 Telegram `initData`、access token、session generation、用户标识或账号状态，不请求 `/api/*`、Supabase 或数据库。直接访问时显示入口门禁；React 的 `?embedded=1` 等待态隐藏门禁并只显示水面背景。两种模式未收到父页面消息时都不创建可用家园。

父页面与 `iframe` 的消息必须同时验证 `event.origin === window.location.origin` 和预期窗口对象。父页面只注入 `templateId`、名称和 `/assets/catalog/v1/thumb/` 正式图片路径；点击消息只返回 `template_id`，React 必须在当前认证查询结果中重新匹配。

静态渲染器不使用 `fetch`、XMLHttpRequest、WebSocket、浏览器持久化或业务命令。宠物位置、方向和漫游只存在于当前 `iframe` 页面生命周期，不能证明或改变藏品、资产、任务或任何业务结果。
