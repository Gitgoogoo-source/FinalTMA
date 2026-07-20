# 安全边界

浏览器不安装或调用 Supabase 客户端，不接收 `service_role`、`IDENTITY_SECURITY_SECRET`、Bot Token、Cron Secret、TON 签名私钥或任何 `VITE_*` 机密。Telegram 是唯一登录身份；不使用 Supabase Auth、`auth.users`、Supabase Session、JWT 或 Refresh Token。登录来源、Telegram 用户、`initData` 和预认证请求只以 `IDENTITY_SECURITY_SECRET` 域隔离 HMAC 指纹进入限流与幂等表，日志不记录原 IP、原 `initData` 或 bearer token。

Data API 只暴露 `api` schema。安全迁移撤销 `PUBLIC`、`anon`、`authenticated` 对内部 schema、表、序列和函数的权限，也撤销 `service_role` 对内部对象的直接权限；Functions 的 `service_role` 只执行 `api` schema 中的 SECURITY DEFINER RPC。

所有 SECURITY DEFINER 函数使用空 `search_path` 和完全限定对象名。RLS 在内部表上启用且不创建玩家访问策略，只作为外围拒绝层；业务授权全部由 Functions 与 RPC 显式完成。

会话认证按令牌、撤销/过期状态、账号状态、入口交接状态顺序裁决。除 `referral.bind` 与受限的 `operations.get` 外，Functions 中间件和数据库 `api.session_user` 都拒绝 `pending` 交接，固定返回 `ENTRY_HANDOFF_PENDING`。浏览器构造请求、修改入口参数或跳过启动工作流均不能访问业务 RPC。

账号封禁切换先把内存账号状态设为 `banned` 并生成新 session generation，再取消请求并清空查询、操作、弹窗和导航。任何请求、预取或缓存种子写入前都同时验证原 generation 与当前 `normal` 状态，迟到响应只能作为 `AbortError` 丢弃。

Telegram webhook 使用 secret token，Cron 使用 `CRON_SECRET`。支付回调按 Telegram update 与 charge 唯一键去重；Cron 同时使用任务名 advisory lock、运行租约、状态扫描和幂等 RPC。
