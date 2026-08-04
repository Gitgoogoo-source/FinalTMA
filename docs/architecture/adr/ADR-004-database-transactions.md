# ADR-004：数据库事务与幂等

## 决定

前端不得直接访问数据库。读取使用具名查询 RPC，写入使用具名命令 RPC。玩家 RPC 接收 `session_id` 并在数据库内重新验证身份、账号、归属和前置条件。

创建 operation 的玩家命令使用同一个客户端 UUID 作为幂等键与 `operation_id`。数据库从真实 RPC 参数构造规范化请求并计算 SHA-256。重复相同请求返回原结果；重复不同请求固定拒绝。Battle 仅创建、随机匹配、取消、接受和行动创建 operation；heartbeat/offline 不接收幂等键且不创建 operation，数据库在 room-first 锁内先裁决 lifecycle version + lease UUID + command sequence，下一版本 lease 可以接管，当前 lease 只接受更高序号，低版本、旧 lease、重复和乱序命令不推进任何状态。Battle 结果展示不写数据库。公开匹配按规则版本与档位锁串行随机查找或建房，并在同一事务冻结 K-coin 和三宠；好友接受与公开加入共用唯一内部对手加入函数。加入事务锁定双方资产后进入 lobby，只有数据库倒计时事务在复核两名 participant、两份 stake/ledger、六个合法快照、六个 reservation 和启动条件后比较首发速度、固定整场先手并另行创建第 1 个完整回合。每个 `(room_id, round_no, action_ordinal)` 最多写入一个动作；`replace_attack` 的切换与攻击在同一事务完成。永久失败由 RPC 与 monitor 在同一 room lock 内复用幂等安全作废事务。余额、账本、库存、预留、奖励和任务状态在单个事务内落定。
