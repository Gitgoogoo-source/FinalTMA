# ADR-004：数据库事务与幂等

## 决定

前端不得直接访问数据库。读取使用具名查询 RPC，写入使用具名命令 RPC。玩家 RPC 接收 `session_id` 并在数据库内重新验证身份、账号、归属和前置条件。

创建 operation 的玩家命令使用同一个客户端 UUIDv7 作为幂等键与 `operation_id`。数据库先按 key 取得事务 advisory lock并查询旧记录；旧记录同请求回放且不占新请求配额，不同请求固定拒绝。只有 key 不存在时才校验版本与时间：不得早于 24 小时，也不得晚于当前时间 5 分钟。随后全部新 operation 按用户锁执行每 60 秒最多 60 个、每 24 小时最多 1000 个新 key、最近 24 小时最多 100 个失败终态、同时最多 20 个 `pending/unknown` 的固定上限；拒绝发生在 operation 插入前。Battle 的动作级限流继续叠加执行，不替代通用准入。数据库从真实 RPC 参数构造规范化请求并计算 SHA-256。每个 operation 首次进入 `succeeded` 或 `failed` 时，行触发器在同一业务事务内锁定用户权威序号行、递增序号并写回 operation；业务事务回滚时序号同步回滚。

市场成功上架另按 [ADR-060](ADR-060-market-listing-quota.md) 使用独立用户行锁，固定 UTC 每日 200 次和账号生命周期 20,000 次。旧 operation 回放不重新检查或消耗配额；新 key 超限使本次 RPC 连同刚建立的 operation 一起回滚，真正插入挂单时再由 BEFORE INSERT trigger 原子消耗一次，失败事务不计数。

终态完成 30 天后压缩请求与结果载荷；未确认进化、非终态、活动支付/Mint 不压缩。无任何业务外键引用的失败 operation 满 7 天删除，无引用的成功 operation 满 37 天删除；删除后旧 UUIDv7 已越过新鲜度窗口，不能重新执行。仍被账本、资产、订单、Battle、市场或其他业务事实引用的终态只保留压缩后的最小审计锚点。清理按稳定顺序使用 `FOR UPDATE SKIP LOCKED`，每次压缩与删除各最多 5000 条，引用清单与全部 operation 外键由静态门禁同步。Battle 仅创建、随机匹配、取消、接受和行动创建 operation；heartbeat/offline 不接收幂等键且不创建 operation，数据库在 room-first 锁内先裁决 lifecycle version + lease UUID + command sequence，下一版本 lease 可以接管，当前 lease 只接受更高序号，低版本、旧 lease、重复和乱序命令不推进任何状态。Battle 结果展示不写数据库。公开匹配按规则版本与档位锁串行随机查找或建房，并在同一事务冻结 K-coin 和三宠；好友接受与公开加入共用唯一内部对手加入函数。加入事务锁定双方资产后进入 lobby，只有数据库倒计时事务在复核两名 participant、两份 stake/ledger、六个合法快照、六个 reservation 和启动条件后比较首发速度、固定整场先手并另行创建第 1 个完整回合。每个 `(room_id, round_no, action_ordinal)` 最多写入一个动作；`replace_attack` 的切换与攻击在同一事务完成。永久失败由 RPC 与 monitor 在同一 room lock 内复用幂等安全作废事务。余额、账本、库存、预留、奖励和任务状态在单个事务内落定。
