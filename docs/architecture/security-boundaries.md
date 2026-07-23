# 安全边界

浏览器不安装或调用 Supabase 客户端，不接收 `service_role`、`IDENTITY_SECURITY_SECRET`、Bot Token、Cron Secret、TON 签名私钥或任何 `VITE_*` 机密。Telegram 是唯一登录身份；不使用 Supabase Auth、`auth.users`、Supabase Session、JWT 或 Refresh Token。登录来源、Telegram 用户、`initData` 和预认证请求只以 `IDENTITY_SECURITY_SECRET` 域隔离 HMAC 指纹进入限流与幂等表，日志不记录原 IP、原 `initData` 或 bearer token。

Data API 只暴露 `api` schema。安全迁移撤销 `PUBLIC`、`anon`、`authenticated` 对内部 schema、表、序列和函数的权限，也撤销 `service_role` 对内部对象的直接权限；Functions 的 `service_role` 只执行 `api` schema 中的 SECURITY DEFINER RPC。

所有 SECURITY DEFINER 函数使用空 `search_path` 和完全限定对象名。RLS 在内部表上启用且不创建玩家访问策略，只作为外围拒绝层；业务授权全部由 Functions 与 RPC 显式完成。

会话认证按令牌、撤销/过期状态、账号状态、入口交接状态顺序裁决。除 `referral.bind` 与受限的 `operations.get` 外，Functions 中间件和数据库 `api.session_user` 都拒绝 `pending` 交接，固定返回 `ENTRY_HANDOFF_PENDING`。浏览器构造请求、修改入口参数或跳过启动工作流均不能访问业务 RPC。

账号封禁切换先把内存账号状态设为 `banned` 并生成新 session generation，再取消请求并清空查询、操作、弹窗和导航。任何请求、预取或缓存种子写入前都同时验证原 generation 与当前 `normal` 状态，迟到响应只能作为 `AbortError` 丢弃。

Telegram webhook 使用 secret token，Cron 使用 `CRON_SECRET`。支付回调按 Telegram update 与 charge 唯一键去重；Cron 同时使用任务名 advisory lock、运行租约、状态扫描和幂等 RPC。

## Monster Tamer 可信边界

Monster Tamer 只能从已经通过统一 Telegram 登录和账号门禁的 TMA React 页面打开。`/monster-tamer` 与 `/monster-tamer/` 不再提供独立文档，统一进入 SPA；无有效会话时只能执行主应用登录流程，不能加载藏品、地图或战斗。

React 通过 `@pokepets/api-contracts/app` 与统一 API client 提交动作意图。Phaser 不接收 token、session generation、用户标识、API client 或 Supabase 能力，也不自行发送网络请求。会话替换、过期或封禁会使现有 React 树和 Phaser 实例一起失效，迟到结果受 session generation 隔离。

`monster_tamer` RPC 每次重新解析 session 和账号状态。确认队伍、区域进入及战斗开始都在事务内按模板顺序锁定并重算 `inventory.available_quantity`；客户端不能提交归属、数量、战斗力、稀有度、阶段、属性、技能、敌方数值、伤害、奖励或胜负。服务端保存当前区域与网格坐标，按固定地图逐格验证经过路径，只接受路径两格范围内的迷雾，并按权威位置裁决节点邻接、出口、接战半径和再战祭坛。客户端不能通过直接调用节点或遭遇 ID 隔空推进。逐回合命令使用幂等操作、请求摘要、版本条件和行锁。

内部游戏只写 `monster_tamer` schema 的进度与战斗。它对目录和可用库存只读，不写 holdings、reservations、余额、账本、远征、市场、进化、分解、Mint、任务、邀请、VIP、支付或链上状态。浏览器不使用本地持久存储保存队伍、进度或战斗；数据库始终是最终事实来源。
