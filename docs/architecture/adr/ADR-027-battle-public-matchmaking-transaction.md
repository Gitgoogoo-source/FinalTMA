# ADR-027：Battle 公开匹配使用数据库事务完成同档查找或建房

## 状态

已接受。

## 决策

Battle 陌生人匹配不引入 Redis、消息队列或独立匹配服务。`POST /api/battle/matchmaking` 只把玩家选择的档位、有序三宠和 UUID 幂等键交给 `api.battle_matchmake`；Supabase PostgreSQL 是候选选择、资源冻结、房间创建和对手加入的唯一裁判。

房间以 `room_mode = friend_invite | public_match` 隔离。公开候选只允许 `public_match + waiting + 未到期 + 正常创建者`，并且 `ruleset_id` 与 `entry_tier_id` 必须精确相同。每个规则版本和档位使用独立 `pg_advisory_xact_lock` 串行“查找或创建”，候选使用 `ORDER BY random() LIMIT 1 FOR UPDATE`。候选房被心跳、取消或到期事务短暂占用时等待并重新裁决，不使用会跳过有效候选的 `SKIP LOCKED`。找到候选时调用 `battle.attach_opponent_and_start_lobby`；没有候选时创建 120 秒公开 waiting 房。好友接受也调用同一内部加入函数，因此种子、大厅、倒计时和结算只有一套实现。

点击随机匹配即代表同意对战。RPC 在同一事务内重新校验身份、唯一参与、规则、档位、三宠可用量和 K-coin，创建三个 reservation 与一份 locked stake。任何校验或写入失败整笔回滚。公开等待取消或超时调用 `battle.close_unstarted_room`，原额退款、释放三宠且不创建 settlement；匹配成功事务固定直接写入不可撤销的 `lobby_countdown` 与 3 秒 deadline，不以创建者 presence 为前置条件，双方不再确认、取消或通过离线退出本场。好友接受仍按原在线事实进入 `lobby_waiting` 或 `lobby_countdown`。

公开房不生成 invite token、prepared message 或公开列表；好友房不进入候选索引。`BattleRoomSnapshotDto` 返回 `room_mode` 供当前参与者渲染正确等待界面，不公开其他候选、队伍或匹配池规模。

## 结果

匹配的并发正确性、幂等、资源一致性和超时回收全部落在现有 Postgres 事务与每秒 Battle tick 内；运行时不新增外部依赖、环境变量或持续服务。三个档位必须分别完成同档、跨档隔离、并发加入、取消、120 秒超时、余额与 reservation 回正的真实环境验收。
