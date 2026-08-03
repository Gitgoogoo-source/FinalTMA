# 安全边界

浏览器不安装或调用 Supabase 客户端，不接收 `service_role`、`IDENTITY_SECURITY_SECRET`、Bot Token、Cron Secret、`ABLY_API_KEY`、`BATTLE_INVITE_SECRET`、`BATTLE_OUTBOX_SECRET`、TON 签名私钥或任何 `VITE_*` 机密。Telegram 是唯一登录身份；不使用 Supabase Auth、`auth.users`、Supabase Session、JWT 或 Refresh Token。登录来源、Telegram 用户、`initData` 和预认证请求只以 `IDENTITY_SECURITY_SECRET` 域隔离 HMAC 指纹进入限流与幂等表，日志不记录原 IP、原 `initData` 或 bearer token。

Data API 只暴露 `api` schema。安全迁移撤销 `PUBLIC`、`anon`、`authenticated` 对内部 schema、表、序列和函数的权限，也撤销 `service_role` 对内部对象的直接权限；Functions 的 `service_role` 只执行 `api` schema 中的 SECURITY DEFINER RPC。

所有 SECURITY DEFINER 函数使用空 `search_path` 和完全限定对象名。RLS 在内部表上启用且不创建玩家访问策略，只作为外围拒绝层；业务授权全部由 Functions 与 RPC 显式完成。

`admin` schema 不属于 Exposed schemas，也不存在对应应用路由。受控 Battle 验收函数使用 `SECURITY INVOKER`、空 `search_path`、owner membership 复核和显式全角色撤权；管理表启用 RLS且无应用策略。迁移不写 project ref、环境身份或 enable 记录。数据库 owner 必须先绑定不可改写的环境/project ref，再写入同值、明确启用、最长 24 小时的门禁；生产身份不能启用。审计只保存内部 UUID、有序 payload hash、不可逆 run key、前后聚合和结果，不保存 Telegram ID、用户名、`initData`、session、token 或其他凭据。

会话认证按令牌、撤销/过期状态、账号状态、入口交接状态顺序裁决。除 `referral.bind` 与受限的 `operations.get` 外，Functions 中间件和数据库 `api.session_user` 都拒绝 `pending` 交接，固定返回 `ENTRY_HANDOFF_PENDING`。浏览器构造请求、修改入口参数或跳过启动工作流均不能访问业务 RPC。

登录入口只分类为 `direct`、`referral`、`battle`。Battle bearer token 原值只在 Function 内存中存在，数据库和 session 只保存 SHA-256；Battle token 不写日志、错误详情、分析事件或浏览器持久存储。invite preview 只能由当前 session 的 Battle token hash 解析；participant snapshot 只能由 room 参与者读取；创建者本人不能接受自己的 token。

Battle viewer-specific DTO 的唯一清单是七个独立严格 Schema：`BattleChallengeCardDto`、`BattleInvitePreviewDto`、`BattleLobbyDto`、`BattleSelfTeamDto`、`BattleOpponentTeamDto`、`BattleActionEventDto`、`BattleRoomSnapshotDto`。挑战卡和接受预览继续允许创建者展示头像；lobby DTO 只公开固定 creator/opponent presence，不返回双方真实头像，固定红蓝 WebP 由 Web 静态资源提供。数据库 RPC 直接生成 viewer-specific JSON，不允许 Functions 取得全量双边状态后再过滤。动作事件只返回 viewer 可见的 sequence、回合、行动序号、表现动作和生命结果；`battle` 不加入 Exposed schemas，永久私有 seed、roll、公式中间值、operation ID、审计与 ledger 关联不进入玩家响应。

Battle 创建、取消、接受和行动必须携带 UUID `Idempotency-Key`，数据库 request hash 阻止同键篡改与重放产生第二次业务结果。行动联合输入只允许 `attack | switch | replace_attack`，客户端提交的回合、行动序号、技能和槽位都由数据库在 room-first 锁内重新验证，不能决定行动权。heartbeat 和 offline 禁止携带 `Idempotency-Key` 且不创建 operation；它们只提交 presence 意图、UUID lease、lifecycle version 与 lease 内 command sequence，数据库在 room-first 锁内先裁决当前活动 lease或下一版本接管，低版本、旧 lease、重复和乱序命令无副作用。结果页按钮不提交请求。邀请 `waiting` 只授权创建者执行纯展示 heartbeat/offline，不参与接受门禁；`lobby_waiting/lobby_countdown` 授权双方执行 presence。`lobby_waiting` 的在线、90 秒、5 分钟终结与倒计时锁定只由数据库裁决；`lobby_countdown` 的 deadline 是不可撤销的数据库事实，客户端 abort、offline 投递、旧/新 lease、刷新和重认证均没有取消、暂停、延后、重置、退款或释放能力。

Ably token 的 capability 只允许当前用户、当前参与 room 或当前 invite 状态频道的 subscribe，浏览器不能 publish、presence-enter 或管理频道。Ably 消息只携带失效元数据，不携带业务状态。`/api/integrations/battle-share` 与 `/api/integrations/battle-outbox` 以 Vercel Secret 和 Supabase Vault 共同持有的 `BATTLE_OUTBOX_SECRET` 鉴权；请求 body 只作唤醒信号，真实任务由受保护 RPC 领取。

账号封禁切换先把内存账号状态设为 `banned` 并生成新 session generation，再取消请求并清空查询、操作、弹窗和导航。任何请求、预取或缓存种子写入前都同时验证原 generation 与当前 `normal` 状态，迟到响应只能作为 `AbortError` 丢弃。

Telegram webhook 使用 secret token，Cron 使用 `CRON_SECRET`。支付回调按 Telegram update 与 charge 唯一键去重；Cron 同时使用任务名 advisory lock、运行租约、状态扫描和幂等 RPC。
