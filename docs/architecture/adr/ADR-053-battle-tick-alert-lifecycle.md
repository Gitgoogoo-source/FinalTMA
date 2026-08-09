# ADR-053：Battle Tick 告警自动闭环

- 状态：已接受
- 日期：2026-08-10

## 背景

`battle-tick-v1` 每秒执行 `battle.process_due(100)`，五分钟 `monitor-invariants` 读取 `cron.job`、`cron.job_run_details` 与 `battle.tick_health()`。现有实现把配置错误或调度停滞写为 `BATTLE_TICK_UNHEALTHY`，并在健康恢复时自动关闭；自然运行失败写为 `BATTLE_TICK_RUN_FAILED`，但只负责打开告警，没有任何自动关闭分支。失败扫描按固定 tick command 读取，因此已退出 job 的真实历史失败也会进入同一告警链路。

`operations.invariant_violations` 已通过 `(code, subject) where resolved_at is null` 部分唯一索引保证同一对象同时只有一条开放告警，并允许保留任意数量的已关闭历史。告警闭环不需要新增表、字段、索引或第二个调度任务。

## 决策

`battle.monitor_tick_health(p_scan_from, p_scan_to)` 继续扫描时间窗口内固定 command 的全部真实失败，包括已经退出的 job。每份失败证据必须记录来源 `jobid/runid`、开始和结束时间、截断错误摘要、SHA-256、检测时的当前 `jobid`，以及来源是否为当前 job。

扫描窗口发现失败时，`BATTLE_TICK_RUN_FAILED` 必须保持开放。不存在开放告警时创建一条；已经存在开放告警时保留 `first_failure`，只更新 `latest_failure` 与 `last_detected_at`。发现失败的同一次监控执行禁止关闭该告警。更新既有告警不增加 `processed_count`；只有新建开放告警才计为一个新增 violation。

没有扫描到新失败时，只有同时满足以下条件才自动关闭 `BATTLE_TICK_RUN_FAILED`：

1. `battle.tick_health().healthy = true`；
2. 当前 job 的最近两个自然完成周期均为 `succeeded`；
3. 当前 job 最近五分钟没有 `failed` 运行；
4. 距离该告警的 `last_detected_at` 至少五分钟；旧格式告警依次以 `latest_failure.end_time`、顶层 `end_time`、`detected_at` 回退。

关闭只写当前开放行的 `resolved_at`，并在原 `details` 追加 `current_job_stable` resolution、当前 jobid、最新成功 runid/结束时间、300 秒干净窗口与关闭时间。首次和最近失败证据永久保留；运行明细仍按既有规则保留七天。关闭后的同类新失败由部分唯一索引释放后的新行记录，不复用已经关闭的历史行。

`BATTLE_TICK_UNHEALTHY` 继续表示当前配置、scheduler 或最近成功记录不健康，并保持现有健康后自动关闭语义。两类告警可以在同一事故中同时开放，但必须分别依据各自条件关闭。

## 不变量

- 不删除、不覆盖或人工关闭失败历史来获得零开放告警。
- 不直接写 `cron.job`，不改变唯一 `battle-tick-v1`、每秒 schedule、command、database、worker 或 product-data 后置创建顺序。
- 不新增 Vercel Cron、Supabase Cron、API、RPC、前端请求、玩家文案或浏览器 Supabase 访问。
- `monitor-invariants.processed_count` 只表示本次新打开的 violation，不把详情更新或自动关闭计为新增故障。
- 数据库函数仍位于未暴露的 `battle` schema，现有 RLS、revoke 与 service-role API 边界不改变。

## 验收

静态门禁必须证明失败优先、首次/最近证据、当前 job 归属、五分钟门槛、两个连续自然成功周期、最近五分钟零失败、resolution 证据和新增计数语义均存在，baseline 与声明式 Schema 完全一致。

真实开发环境使用现存历史失败证明自动闭环：先由自然 `monitor-invariants` 自动关闭原开放告警，并确认原行 ID、首次失败与错误哈希未丢失；随后只允许在事务内重放该真实历史扫描窗口验证关闭后能够创建新开放行，验证完成立即回滚，不制造新的 tick 失败。最终从空库连续重放三条原始 migration，独立执行 `pg_reload_conf()`，保存同一当前 jobid 至少两个连续自然成功周期，并确认 `battle.tick_health()` 健康、开放 Battle violation 为零、`monitor-invariants` 新增数量为零。
