# ADR-014：Battle 数据库权威与 `battle-v1` 规则快照

## 状态

已接受。

## 决定

Battle 使用 React + TypeScript 呈现界面，不引入 Phaser，也不在浏览器运行战斗模拟器。客户端只提交产品主文档第 21 章允许的房间档位、三个有序模板 ID、技能位置、换宠槽位和 operation-backed 命令的 UUID 幂等键；heartbeat、offline 和 acknowledge 不提交幂等键。Vercel Function 只完成 Telegram 身份、REST 契约、viewer 上下文和外部服务编排。

Supabase PostgreSQL 是 Battle 的唯一裁判。房间、参与资格、三宠 reservation、K-coin stake、秘密行动、deadline 托管、确定随机命中、伤害、行动顺序、强制换宠、终局、退款、结算、私有审计和 outbox 都由具名 RPC 在事务内完成。room 行是同房间写入的首个业务锁，涉及双方余额时再按用户 UUID 排序锁定；唯一约束、stake 状态和 ledger reference 保证重复恢复不重复改变资产。

唯一初始规则版本固定为 `battle-v1`。`generated/battle/battle-v1.json` 及数据库种子共享同一 SHA-256 checksum，覆盖产品第 21 章声明的属性、稀有度、角色档案、技能、70 链映射、210 模板最终配置、时限和结算档位。房间创建时保存 `ruleset_id`、checksum 和三宠不可变配置快照；新规则发布不能改变既有等待房、活动战斗或永久审计。

数据库读模型按当前 viewer 直接生成挑战卡、接受页、己方、对手和 resolution event 五种独立 DTO。Functions 与 Web 不接收全量双边私有对象、room seed、roll 或内部审计后再过滤。

规则、快照、生命、活动宠物、stake、ledger 或 settlement 出现永久不变量错误时，普通结算停止；独立安全事务把 room 写为 `voided`，双方原额退款，释放 Battle reservation，并记录 invariant violation 与永久私有审计。玩家端不建立 history、replay、audit、spectator、matchmaking 或公开 room 接口。

## 结果

前端即时反馈不具有业务权威；刷新、断线、请求乱序、Function 重启和重复提交都只能恢复数据库中的同一状态。Battle 配置与 Catalog v1 身份数据分别版本化，既有 70 条链、210 个模板和 Catalog v1 release checksum 不因 Battle 改变。
