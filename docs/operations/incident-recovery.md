# 故障恢复

## 会话与 API

先按 `request_id` 定位结构化日志，再按 `operation_id` 查询数据库。会话过期只允许重新交换一次；会话替换、撤销或 Telegram 入口缺失时要求用户重新进入 Mini App。

收到 `ENTRY_HANDOFF_PENDING` 时不得放开主页面。核对 `identity.sessions.referral_processed_at`、`identity.entry_candidates` 与当前 `referral.bind` 操作；只查询原邀请操作，确定成功或拒绝后由 RPC 完成交接，不得手工写会话完成时间。

## 未知操作

禁止重新生成幂等键。使用 `GET /api/operations/:operation_id` 查询原操作；数据库终态与前端临时状态不一致时刷新契约声明的资产、库存、支付或 Mint scope，以数据库结果覆盖。

封禁事故先确认客户端已切换到新 generation 且 DOM、查询缓存、操作弹窗和导航为空，再按旧 generation 定位迟到请求。禁止通过恢复缓存或重放成功响应复原页面。

## Stars

确认订单、Telegram update、charge 唯一键和账本记录。手工触发 `reconcile-payments` 只扫描数据库当前全部未决订单；不得手工写余额。重复 webhook 和重复任务必须由唯一约束及 RPC 返回同一结果。

## Mint

确认 Mint、交易 hash、接收地址、链上 NFT 地址和 `job_runs`。手工触发 `reconcile-mints` 前先确认没有 10 分钟内的活动租约；并发触发应记录 `skipped`。链上事实只能由对账 RPC 写回。

## Battle

先按 `room_id`、`state_version`、`operation_id` 和当前 viewer 定位 room、participant、stake、reservation、turn、action、settlement 与 outbox。不得从 Ably 消息或浏览器画面重建战斗；不得手工写 action、生命、胜负、stake、ledger 或 settlement。

- 创建响应丢失：查询原 operation；`battle-share` 只领取原 `create_operation_id`，恢复同一 room 和同一 bearer token。Telegram 明确失败时执行原 abort RPC；结果未知保持 60 秒恢复窗口。
- 接受或动作响应丢失：查询原 operation 和 viewer-specific room snapshot；已经锁定的 stake、reservation 或 action 不重做。
- Ably 故障：确认数据库 `state_version` 继续推进并启用 REST 1—2 秒回正；修复发布链路后只重投原 outbox，重复 `event_id/state_version` 不改变业务。
- `battle-tick-v1` 停止：保持 Battle 新建/接受关闭，修复唯一 cron job 后按数据库 waiting、lobby presence、lobby 总时限、开战倒计时和回合 deadline 追赶；同一截止时刻先终结 lobby，再考虑开战，禁止按浏览器剩余时间补写状态或动作。
- pg_net 或 integration 故障：核对 Vault callback、`BATTLE_OUTBOX_SECRET`、领取租约和重试时间；请求 body 只作唤醒信号，不能携带或裁决 Battle 状态。
- 永久不变量错误：使用既定安全 RPC 把 room 置为 `voided`、双方原额退款、释放 reservation 并写 violation；不得手工判胜、修改私有 seed 或删除审计。
- 终局结果恢复：identity bootstrap 与 Battle bootstrap 只返回本人最新未确认结果；acknowledge 丢失时重试原 room，不创建 history/replay/audit 响应。
- 验收夹具恢复：只允许 owner 查询 `admin.battle_fixture_status` 并以新 request UUID 调用 `admin.reconcile_battle_fixture`；不得裸 SQL 写余额、holding 或审计。project identity 不匹配、门禁关闭/过期、用户异常、任何活动业务状态或 product-data 漂移时保持拒绝。真实开发库重建后重新绑定当前 project ref 并按次写入最长 24 小时 enable；生产身份不得启用。

## 不变量

运行 `monitor-invariants`，处理 `BALANCE_LEDGER_MISMATCH`、`DUPLICATE_PAYMENT_DELIVERY`、`RESERVATION_OVERFLOW`、`ILLEGAL_RESERVATION`、`OPEN_OPERATION_WITHOUT_SUBJECT` 及正式 Battle 契约声明的 room/stake/settlement/outbox 不变量。正式生产上线前的结构修复直接修改原始声明式 Schema，并从空真实开发数据库重建三条迁移；正式生产上线后的数据修复使用审计过的前向 SQL 或既有 RPC。任何阶段都保存变更前后证据且不直接改写账本历史或 Battle 私有审计。
