# ADR-015：Battle 实时失效通知、调度与 outbox

## 状态

已接受。

## 决定

Ably Standard 只发送 Battle 状态失效通知，不承载业务状态或裁决。浏览器使用 5 分钟短期 token，capability 只允许 subscribe 当前用户、当前参与 room 或当前 invite 状态频道；浏览器不能 publish、presence-enter 或管理频道。消息固定只含 `event_id`、`room_id`、`state_version` 和 `event_kind`。

每次数据库状态变化递增 room 的 `state_version`，并在同一事务写入 `battle.outbox`。客户端收到 Ably 消息后通过 REST 读取 viewer-specific 权威快照，低于当前版本的重复、乱序和迟到消息直接丢弃。Ably 为 `disconnected`、`suspended` 或 `failed` 时，等待/接受状态每 2 秒轮询，正常选择/强制换宠状态每 1 秒轮询；重新可见和 deadline 到达时立即执行一次 REST 回正。Ably presence 不参与创建者在线裁决，REST 心跳是唯一在线事实。

Supabase `pg_cron` 使用唯一 job `battle-tick-v1`，每秒调用 `battle.process_due(limit => 100)`。advisory lock 阻止重叠执行，到期 room 通过索引与 `FOR UPDATE SKIP LOCKED` 分批推进；服务恢复后按数据库 deadline 追赶，不读取浏览器计时器。

玩家请求提交后立即尝试投递本次 outbox。cron 产生的状态通过 `pg_net` 唤醒 `/api/integrations/battle-outbox`；prepared share 恢复通过 `pg_net` 唤醒 `/api/integrations/battle-share`。两个接口使用 Supabase Vault 与 Vercel Secret 共同持有的 `BATTLE_OUTBOX_SECRET` 鉴权，请求 body 只作唤醒信号，真实任务由受保护 RPC 领取。失败投递按 1、2、5、10、30 秒重试，随后每 30 秒重试。

## 结果

Ably、pg_net、integration 或 WebView 中断只影响通知延迟，不改变数据库中的动作、deadline、胜负和资产结果。`state_version`、REST 回正、每秒数据库调度和事务 outbox 共同保证 Battle 在没有实时连接时仍能完成托管、退款与结算。
