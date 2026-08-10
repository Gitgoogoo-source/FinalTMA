# ADR-015：Battle 实时失效通知、调度与 outbox

## 状态

已接受。

## 决定

Ably Standard 只发送 Battle 状态失效通知，不承载业务状态或裁决。浏览器使用 5 分钟短期 token，capability 只允许 subscribe 当前用户、当前参与 room 或当前 invite 状态频道；浏览器不能 publish、presence-enter 或管理频道。邀请接受前后的最小权限切换固定遵循 [ADR-056](ADR-056-battle-realtime-authorization-context-handoff.md)：授权上下文 key 区分 invite 与 room，并在同一身份内于 Ably AUTH 成功后重协调频道集合。消息固定只含 `event_id`、`room_id`、`state_version` 和 `event_kind`。

数据库只为实际状态转换递增 room 的 `state_version` 并在同一事务写入 `battle.outbox`。普通心跳续租只更新 participant 服务端时间和 lease 命令序号，不增加 room 版本；online/offline 转换、lobby 倒计时锁定、开战、动作结算和等待期取消才产生事件，不存在倒计时中止事件。heartbeat/offline 在这些转换前先裁决 lifecycle version、lease UUID 与 command sequence；旧、重复和乱序命令不改变 presence、deadline、`state_version` 或资产，合法新命令在 `lobby_countdown` 也只能更新 presence，不能改变锁定 deadline 或产生退款。客户端收到 Ably 消息后通过 REST 携带 `after_action_sequence` 读取 viewer-specific 权威快照，按动作 sequence 补齐最多 16 条事件，并丢弃低于当前版本的重复、乱序和迟到通知。Ably 为 `disconnected`、`suspended` 或 `failed` 时，邀请 waiting、接受和 lobby 每 2 秒轮询，`active_turn` 每 1 秒轮询；重新可见时读取不带游标的快照并把游标直接初始化为最新 sequence。deadline 到达时立即执行 REST 回正；权威 deadline 尚未前进或读取失败时，即使 Ably 仍报告 connected，也按邀请 waiting、接受和 lobby 每 2 秒、`active_turn` 每 1 秒继续静默读取，直到权威状态前进或终结。当前会话已经持有未终局 room 时，bootstrap 的空 participation 只能触发该 room 权威读取，不能单独清空 room。Ably presence 不参与在线裁决，participant REST 命令与数据库时间字段是唯一 presence 事实；进入 active 战斗后停止 presence 心跳。heartbeat/offline 普通完成只应用 room，实际退款终态才刷新 `battle + assets + inventory`，不产生 5 秒资产轮询。

Supabase `pg_cron` 使用唯一 job `battle-tick-v1`，每秒调用 `battle.process_due(limit => 100)`。advisory lock 阻止重叠执行，到期 room 通过索引与 `FOR UPDATE SKIP LOCKED` 分批推进；服务恢复后按数据库 deadline 追赶，不读取浏览器计时器。`lobby_waiting` 每次推进先锁 room 并裁决连续离线、5 分钟总时限和封禁；只有完整 3 秒不越过 5 分钟边界时才锁定开战 deadline。`lobby_countdown` 推进不再执行 presence、5 分钟或封禁终结，也不复核在线；它复核两名 participant、两份 stake/ledger、六个合法快照、六个 reservation 和全部永久启动不变量后 exactly-once 开战。`active_turn` 到期只为当前行动者执行一次托管：当前宠物存活时使用技能位置 1，需要换宠反击时按队伍顺序换入第一只存活宠物并使用其技能位置 1。重复 tick 因 room lock、状态迁移和 `(room_id, round_no, action_ordinal)` 唯一键只能得到同一结果；永久失败仍走同一安全作废。

停用或重建前先 `cron.unschedule('battle-tick-v1')`，再在独立语句执行 `pg_reload_conf()`；只有原 `jobid` 连续两个调度周期没有新增 run 才允许删除 Battle schema。从空库重放时，baseline 不创建 job；`product_data_v1` 只在 active ruleset 和全部规则参数写入后创建唯一 `battle-tick-v1`，禁止调度器在规则数据未提交的迁移间隙运行。三条 migration 的提交事务结束后，owner 再在独立语句执行一次 `pg_reload_conf()`，使既有 `pg_cron scheduler` 进程重新加载新 job；随后必须从 `cron.job_run_details` 取得同一 `jobid` 的至少两个连续自然周期，手工 SQL 或直接 RPC 不作为调度证据。`battle.tick_health()` 固定核对唯一 job、每秒 schedule、command、database、worker、scheduler 数量和最近 5 秒成功记录。既有五分钟 `monitor-invariants` 把配置错误或调度停滞写为 `BATTLE_TICK_UNHEALTHY`，把自然运行失败写为 `BATTLE_TICK_RUN_FAILED`，私有记录包含 jobid、runid、开始/结束时间、截断错误摘要和 SHA-256。既有每日 `cleanup-idempotency` 只删除该 command 超过 7 天的运行明细，每次最多 100000 条；失败告警按 [ADR-053](ADR-053-battle-tick-alert-lifecycle.md) 保留首次与最近失败证据，并在当前 job 稳定健康后自动关闭，不增加第二个 Supabase cron job。

所有状态变化都由数据库在同一事务写入 outbox 并调用 `pg_net`；HTTP 请求只在事务提交后异步唤醒 `/api/integrations/battle-outbox`。玩家 Vercel Function 在数据库 RPC 完成后立即返回权威结果，不直接领取或发布 outbox，避免动作响应等待 Ably 以及与 integration 重复竞争租约；`battle.process_due` 每秒重新唤醒到期或租约过期的记录，保持失败恢复。prepared share 恢复通过 `pg_net` 唤醒 `/api/integrations/battle-share`。两个接口使用 Supabase Vault 与 Vercel Secret 共同持有的 `BATTLE_OUTBOX_SECRET` 鉴权，请求 body 只作唤醒信号，真实任务由受保护 RPC 领取。失败投递按 1、2、5、10、30 秒重试，随后每 30 秒重试。

玩家 Battle 请求与 `battle-outbox` integration 的阶段耗时、调用次数、outbox 发布/延后计数及日志隐私边界固定遵循 [ADR-028](ADR-028-battle-request-observability.md)，观测不得改变上述事务提交、异步唤醒、租约或重试路径。

## 结果

Ably、pg_net、integration 或 WebView 中断只影响通知延迟，不改变数据库中的动作、deadline、胜负和资产结果。`state_version`、REST 回正、每秒数据库调度和事务 outbox 共同保证 Battle 在没有实时连接时仍能完成托管、退款与结算。
