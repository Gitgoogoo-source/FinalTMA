# ADR-014：Battle 数据库权威与 `battle-v1` 规则快照

## 状态

已接受。

## 决定

Battle 使用 React + TypeScript 呈现界面，不引入 Phaser，也不在浏览器运行战斗模拟器。客户端只提交产品主文档第 21 章允许的房间档位、三个有序模板 ID、技能位置、换宠槽位、operation-backed 命令 UUID 幂等键，以及 heartbeat/offline 的 presence 意图、lease UUID、lifecycle version 与 command sequence；heartbeat、offline 和 acknowledge 不提交幂等键。Vercel Function 只完成 Telegram 身份、REST 契约、viewer 上下文和外部服务编排。

Supabase PostgreSQL 是 Battle 的唯一裁判。房间、参与资格、三宠 reservation、K-coin stake、participant presence、双人 lobby、开战倒计时、秘密行动、deadline 托管、确定随机命中、伤害、行动顺序、强制换宠、终局、退款、结算、私有审计和 outbox 都由具名 RPC 在事务内完成。room 行是同房间写入的首个业务锁，涉及双方余额时再按用户 UUID 排序锁定；唯一约束、stake 状态和 ledger reference 保证重复恢复不重复改变资产。

等待邀请期间只有创建者 heartbeat/offline，在线只作展示，接受不检查创建者在线。首位接受事务原子锁定接受者 stake 与三宠后进入 `lobby_waiting/lobby_countdown`，并把双方 participant 写为 `lobby`；该事务可以生成 seed/commitment，但不得创建 turn 1。lobby 总时限固定 5 分钟，双方按 5 秒心跳和 10 秒在线窗口形成数据库 presence，连续离线恢复窗口固定 90 秒。每个可见生命周期使用数据库 version + UUID lease + command sequence；合法新 lease 接管后旧命令永久无副作用。双方在线后启动 3 秒数据库倒计时；任一方离线中止，恢复后重新完整计时。到期再次确认双方在线与完整 lobby 永久不变量后才原子创建 turn 1；与取消或到期相等时，取消或到期优先。

唯一初始规则版本固定为 `battle-v1`。`generated/battle/battle-v1.json` 及数据库种子共享同一 SHA-256 checksum，覆盖产品第 21 章声明的属性、稀有度、角色档案、技能、70 链映射、210 模板最终配置、时限和结算档位。房间创建时保存 `ruleset_id`、checksum 和三宠不可变配置快照；新规则发布不能改变既有等待房、活动战斗或永久审计。

数据库读模型按当前 viewer 直接生成唯一七种独立 DTO：`BattleChallengeCardDto`、`BattleInvitePreviewDto`、`BattleLobbyDto`、`BattleSelfTeamDto`、`BattleOpponentTeamDto`、`BattleResolutionEventDto`、`BattleRoomSnapshotDto`。严格 lobby 只包含 phase、expires/start deadline 与固定两方 presence，不返回真实头像；挑战卡/接受预览仍可含创建者允许的展示头像。Functions 与 Web 不接收全量双边私有对象、room seed、roll 或内部审计后再过滤。

规则、participant、stake/ledger、快照、reservation、生命、活动宠物或 settlement 出现永久不变量错误时，普通流程停止；advance 与 monitor 只在 room-first 锁内复用同一幂等安全事务，把 room/participants 写为 `voided`，退款已有原始 stake，释放 Battle reservation，并记录零手续费 settlement、invariant violation、outbox 与永久私有审计。prepared-share 明确失败的合法 `voided` 则固定为一份 stake refunded、reservation released、零 settlement；监控按明确终态来源区分。玩家端不建立 history、replay、audit、spectator、matchmaking 或公开 room 接口。

## 结果

前端即时反馈不具有业务权威；刷新、断线、请求乱序、Function 重启和重复提交都只能恢复数据库中的同一状态。Battle 配置与 Catalog v1 身份数据分别版本化，既有 70 条链、210 个模板和 Catalog v1 release checksum 不因 Battle 改变。
