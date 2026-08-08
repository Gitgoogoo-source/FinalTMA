# 安全边界

浏览器不安装或调用 Supabase 客户端，不接收 `service_role`、`IDENTITY_SECURITY_SECRET`、Bot Token、Cron Secret、`ABLY_API_KEY`、`BATTLE_INVITE_SECRET`、`BATTLE_OUTBOX_SECRET`、TON 签名私钥或任何 `VITE_*` 机密。Telegram 是唯一登录身份；不使用 Supabase Auth、`auth.users`、Supabase Session、JWT 或 Refresh Token。登录来源、Telegram 用户、`initData` 和预认证请求只以 `IDENTITY_SECURITY_SECRET` 域隔离 HMAC 指纹进入限流与幂等表；访问令牌按 [ADR-038](adr/ADR-038-local-session-proof-and-login-rpc-consolidation.md) 包含版本、session UUID 和域隔离 HMAC，浏览器只把它视为 opaque bearer。日志不记录原 IP、原 `initData` 或 bearer token。

Battle 阶段化结构日志只接受 [ADR-028](adr/ADR-028-battle-request-observability.md) 的固定耗时、调用次数和 outbox 聚合计数。日志不记录用户、session、operation、room、event、channel、token、capability、请求/响应内容、RPC 名称或原始外部错误；`request_id` 与 `route_id` 只用于同一请求的运行诊断。

Data API 只暴露 `api` schema。安全迁移撤销 `PUBLIC`、`anon`、`authenticated` 对内部 schema、表、视图、序列和函数的权限，也撤销 `service_role` 对内部对象的直接权限；`inventory.quantity_read_model` 与 `inventory.item_read_model` 额外使用 `security_invoker = true`，仍不能被非 owner 角色直接读取。Functions 的 `service_role` 只执行 `api` schema 中的 SECURITY DEFINER RPC。

所有 SECURITY DEFINER 函数使用空 `search_path` 和完全限定对象名。RLS 在内部表上启用且不创建玩家访问策略，只作为外围拒绝层；业务授权全部由 Functions 与 RPC 显式完成。

`admin` schema 不属于 Exposed schemas，也不存在对应应用路由。受控 Battle 验收函数使用 `SECURITY INVOKER`、空 `search_path`、owner membership 复核和显式全角色撤权；管理表启用 RLS且无应用策略。迁移不写 project ref、环境身份或 enable 记录。数据库 owner 必须先绑定不可改写的环境/project ref，再写入同值、明确启用、最长 24 小时的门禁；生产身份不能启用。审计只保存内部 UUID、有序 payload hash、不可逆 run key、前后聚合和结果，不保存 Telegram ID、用户名、`initData`、session、token 或其他凭据。

Functions 中间件严格证明令牌版本、规范 Base64URL 和 HMAC，只提取 `session_id`，不调用数据库也不裁决可变状态。每个玩家业务 RPC 在业务工作前通过 `api.session_user` 按会话存在、撤销/过期、账号状态、入口交接状态顺序最终裁决；除 `referral.bind` 与受限的 `operations.get` 外都拒绝 `pending` 交接并固定返回 `ENTRY_HANDOFF_PENDING`。篡改令牌不能进入业务 RPC；浏览器构造请求、修改入口参数或跳过启动工作流不能绕过数据库裁决。

浏览器唯一允许的 Supabase 直连是匿名 GET `pet-runtime` 公开桶中的宠物 WebP 完整 URL；Web 构建不包含 Supabase SDK、anon key 或 service-role key。根路径与全部前端深链统一下发 CSP：`script-src` 只放行同源脚本和 Telegram 官方 Mini App SDK，`img-src` 只额外放行 `https://*.supabase.co` 图片，`connect-src` 只额外放行 Ably，不允许 Supabase Data API 连接。私有 `art-masters`、Storage 上传/覆盖/删除/列举以及全部 Postgres、RPC、Auth 和其他 Data API 只允许受控服务端或发布工具使用 service role。资源 RPC 不进入玩家路由，公开对象清理端点只接受 Vercel 注入的 `CRON_SECRET`。

登录入口只分类为 `direct`、`referral`、`battle`。Battle bearer token 原值只在 Function 内存中存在，数据库和 session 只保存 SHA-256；Battle token 不写日志、错误详情、分析事件或浏览器持久存储。invite preview 只能由当前 session 的 Battle token hash 解析；participant snapshot 只能由 room 参与者读取；创建者本人不能接受自己的 token。

Battle viewer-specific DTO 的唯一清单是七个独立严格 Schema：`BattleChallengeCardDto`、`BattleInvitePreviewDto`、`BattleLobbyDto`、`BattleSelfTeamDto`、`BattleOpponentTeamDto`、`BattleActionEventDto`、`BattleRoomSnapshotDto`。挑战卡和接受预览继续允许创建者展示头像；lobby DTO 只公开固定 creator/opponent presence，不返回双方真实头像，固定红蓝 WebP 由 Web 静态资源提供。数据库 RPC 直接生成 viewer-specific JSON，不允许 Functions 取得全量双边状态后再过滤。动作事件只返回 viewer 可见的 sequence、回合、行动序号、表现动作和生命结果；`battle` 不加入 Exposed schemas，永久私有 seed、roll、公式中间值、operation ID、审计与 ledger 关联不进入玩家响应。

Battle 创建、随机匹配、取消、接受和行动必须携带 UUID `Idempotency-Key`，数据库 request hash 阻止同键篡改与重放产生第二次业务结果。公开候选只在私有 `battle` schema 内按精确规则版本和档位随机锁定；玩家不能读取候选列表、池规模、其他玩家身份或跨档加入。公开房没有 invite token，好友房不进入匹配候选集。行动联合输入只允许 `attack | switch | replace_attack`，客户端提交的回合、行动序号、技能和槽位都由数据库在 room-first 锁内重新验证，不能决定行动权。heartbeat 和 offline 禁止携带 `Idempotency-Key` 且不创建 operation；它们只提交 presence 意图、UUID lease、lifecycle version 与 lease 内 command sequence，数据库在 room-first 锁内先裁决当前活动 lease或下一版本接管，低版本、旧 lease、重复和乱序命令无副作用。结果页按钮不提交请求。`waiting` 只授权创建者执行纯展示 heartbeat/offline，不参与接受或匹配门禁；`lobby_waiting/lobby_countdown` 授权双方执行 presence。`lobby_waiting` 的在线、90 秒、5 分钟终结与倒计时锁定只由数据库裁决；`lobby_countdown` 的 deadline 是不可撤销的数据库事实，客户端 abort、offline 投递、旧/新 lease、刷新和重认证均没有取消、暂停、延后、重置、退款或释放能力。

Ably token 的 capability 只允许当前用户、当前参与 room 或当前 invite 状态频道的 subscribe，浏览器不能 publish、presence-enter 或管理频道。Ably 消息只携带失效元数据，不携带业务状态。`/api/integrations/battle-share` 与 `/api/integrations/battle-outbox` 以 Vercel Secret 和 Supabase Vault 共同持有的 `BATTLE_OUTBOX_SECRET` 鉴权；请求 body 只作唤醒信号，真实任务由受保护 RPC 领取。

账号封禁切换先把内存账号状态设为 `banned` 并生成新 session generation，再取消请求并清空查询、操作、弹窗和导航。任何请求、预取或缓存种子写入前都同时验证原 generation 与当前 `normal` 状态，迟到响应只能作为 `AbortError` 丢弃。

Telegram webhook 使用 secret token，Cron 使用 `CRON_SECRET`。支付回调按 Telegram update 与 charge 唯一键去重；Cron 同时使用任务名 advisory lock、运行租约、状态扫描和幂等 RPC。
