# 故障恢复

## 会话与 API

先按 `request_id` 定位结构化日志，再按 `operation_id` 查询数据库。会话过期只允许重新交换一次；会话替换、撤销或 Telegram 入口缺失时要求用户重新进入 Mini App。

收到 `ENTRY_HANDOFF_PENDING` 时不得放开主页面。核对 `identity.sessions.referral_processed_at`、`identity.entry_candidates` 与当前 `referral.bind` 操作；只查询原邀请操作，确定成功或拒绝后由 RPC 完成交接，不得手工写会话完成时间。

如果用户在候选 `pending` 时已经重认证，必须同时核对被撤销的请求会话与唯一未撤销会话；两者的 `referral_processed_at` 都只能由原绑定 RPC 或其幂等回放补齐。`entry_kind = direct|battle` 不能作为交接完成证据，也不能据此开放业务。

## 未知操作

禁止重新生成幂等键。使用 `GET /api/operations/:operation_id` 查询原操作；数据库终态与前端临时状态不一致时刷新契约声明的资产、库存、支付或 Mint scope，以数据库结果覆盖。

出现 operation 表增长或准入限流异常时，先核对 `operations.user_admission_counters`、最近 24 小时失败数、当前未决数和 `cleanup-idempotency` 的 `maintenance`/`job_runs.details`。不得手工删除有外键引用、未决、未确认进化或活动支付/Mint operation；恢复清理任务时只重跑原 job，由 UUIDv7 新鲜度和引用保护保证旧命令不重新执行。

封禁事故先确认客户端已切换到新 generation 且 DOM、查询缓存、操作弹窗和导航为空，再按旧 generation 定位迟到请求。禁止通过恢复缓存或重放成功响应复原页面。

## Stars

确认订单、Telegram update、charge 唯一键和账本记录。手工触发 `reconcile-payments` 只扫描数据库当前全部未决订单；不得手工写余额。重复 webhook 和重复任务必须由唯一约束及 RPC 返回同一结果。

## Mint

确认 Mint、交易 hash、接收地址、链上 NFT 地址和 `job_runs`。手工触发 `reconcile-mints` 前先确认没有 10 分钟内的活动租约；并发触发应记录 `skipped`。链上事实只能由对账 RPC 写回。

## Battle

先按 `request_id` 与 `route_id` 读取 Battle 结构日志：用 `auth_ms`、`input_parse_ms`、`db_rpc_ms/db_rpc_count`、`ably_ms/ably_operation_count`、`handler_ms`、`response_ms` 区分慢阶段；`battle.outbox_integration` 返回 200 时仍必须核对 `outbox_processed/outbox_published/outbox_deferred`。日志不含用户、room、operation 或事件标识，随后再从受控业务证据取得 `room_id`、`state_version`、`operation_id` 和当前 viewer，定位 room、participant、stake、reservation、turn、action、settlement 与 outbox。不得从 Ably 消息或浏览器画面重建战斗；不得手工写 action、生命、胜负、stake、ledger 或 settlement。

- 创建响应丢失：查询原 operation；`battle-share` 只领取原 `create_operation_id`，恢复同一 room 和同一 bearer token。Telegram 明确失败时执行原 abort RPC；结果未知保持 60 秒恢复窗口。
- 接受或动作响应丢失：查询原 operation 和 viewer-specific room snapshot；已经锁定的 stake、reservation 或 action 不重做。
- Ably 故障：确认数据库 `state_version` 继续推进并启用 REST 1—2 秒回正；修复发布链路后只重投原 outbox，重复 `event_id/state_version` 不改变业务。
- `battle-tick-v1` 停止：保持 Battle 新建/接受关闭，先查询 `battle.tick_health()`、`cron.job`、`cron.job_run_details` 和 `pg_stat_activity`，按来源 `jobid/runid`、检测时当前 jobid 与 `source_is_current` 区分当前配置错误、scheduler 停滞、当前 job 失败和已退出 job 的历史失败。job 定义正确但无新 run 时，在确认目标环境与零活动房后执行一次独立的 `pg_reload_conf()`，再保存同一 jobid 至少两个连续自然周期；禁止手工调用 tick 冒充恢复。恢复后按数据库 waiting、lobby presence、lobby 总时限、开战倒计时和回合 deadline 追赶；同一截止时刻先终结 lobby，再考虑开战，禁止按浏览器剩余时间补写状态或动作。`BATTLE_TICK_UNHEALTHY` 在当前健康恢复后自动关闭；`BATTLE_TICK_RUN_FAILED` 在没有新失败、当前 job 健康、最近两个自然完成周期成功、最近五分钟零失败且距最后检测至少五分钟时自动关闭。关闭只追加恢复证据并保留首次和最近失败；不得人工删除、覆盖或关闭告警来获得零开放 violation。原始 run 明细保留 7 天。
- pg_net 或 integration 故障：核对 Vault callback、`BATTLE_OUTBOX_SECRET`、领取租约和重试时间；请求 body 只作唤醒信号，不能携带或裁决 Battle 状态。
- 永久不变量错误：使用既定安全 RPC 把 room 置为 `voided`、双方原额退款、释放 reservation 并写 violation；不得手工判胜、修改私有 seed 或删除审计。
- 终局结果恢复：identity bootstrap 与 Battle bootstrap 只返回本人最新未确认结果；acknowledge 丢失时重试原 room，不创建 history/replay/audit 响应。
- 验收夹具恢复：只允许 owner 查询 `admin.battle_fixture_status` 并以新 request UUID 调用 `admin.reconcile_battle_fixture`；不得裸 SQL 写余额、holding 或审计。project identity 不匹配、门禁关闭/过期、用户异常、任何活动业务状态或 product-data 漂移时保持拒绝。真实开发库重建后重新绑定当前 project ref 并按次写入最长 24 小时 enable；生产身份不得启用。

## 市场供给汇总

玩家请求中禁止自动修复市场汇总。先运行 `monitor-invariants`，分别核对 `MARKET_SELLER_SUPPLY_MISMATCH` 与 `MARKET_TEMPLATE_SUPPLY_MISMATCH` 的开放记录；前者比较原始有效挂单与卖家模板汇总，后者比较全部 `normal` 卖家汇总与全市场模板汇总。任一不一致都暂停市场新写入，保存原始挂单、两级汇总、用户状态、相关 operation 和事务错误证据，不得通过手工改一行汇总掩盖根因。

只有数据库 owner 可在受控维护窗口执行 `market.rebuild_supply()`。执行前停止市场写流量并确认目标环境；函数在同一事务锁定 `identity.users`、`market.listings` 与两张汇总表，从有效原始挂单完整重建后返回卖家模板行数和市场模板行数。重建后再次运行两项不变量并用三个市场读取 RPC 对照原始有效挂单；`service_role`、`anon`、`authenticated` 和 Data API 均不得拥有该函数执行权。若根因来自声明式定义，正式上线前直接修正原始 Schema/baseline 并从空真实开发数据库重建三条迁移，不追加补丁 migration。

## 市场上架配额

玩家报告无法上架时，先通过 `api.market_bootstrap` 对照当前 UTC 日期、每日已用/剩余和生命周期已用/剩余，再由数据库 owner 只读核对 `market.seller_listing_quotas`、该用户成功挂单数量、相关 operation 与 reservation。每日达到 200 次必须等待下一个 UTC 自然日；生命周期达到 20,000 次是永久业务终态。不得通过删除挂单、删除 operation、下架、清理 reservation、修改日期、减少计数或重建供给汇总恢复上架能力。

配额行缺失但已有成功挂单、计数越界、每日次数大于生命周期次数、bootstrap 与计数行不一致、失败请求增加计数、成功请求未增加计数或配额拒绝仍留下 operation/listing/reservation 都属于完整性事故。立即暂停市场新写入，保存用户配额行、相关挂单、operation、reservation、UTC 日期和事务错误证据；不得在玩家请求中自动修正。当前项目正式上线前必须修正声明式 Schema/baseline 并从空真实开发数据库重建；正式上线后只能使用另行审计的前向恢复程序，且永远不能降低已经发生的生命周期成功次数。

## 不变量

运行 `monitor-invariants`，处理 `BALANCE_LEDGER_MISMATCH`、`DUPLICATE_PAYMENT_DELIVERY`、`RESERVATION_OVERFLOW`、`ILLEGAL_RESERVATION`、`OPEN_OPERATION_WITHOUT_SUBJECT`、`MARKET_SELLER_SUPPLY_MISMATCH`、`MARKET_TEMPLATE_SUPPLY_MISMATCH` 及正式 Battle 契约声明的 room/stake/settlement/outbox 不变量。正式生产上线前的结构修复直接修改原始声明式 Schema，并从空真实开发数据库重建三条迁移；正式生产上线后的数据修复使用审计过的前向 SQL 或既有 RPC。任何阶段都保存变更前后证据且不直接改写账本历史或 Battle 私有审计。
