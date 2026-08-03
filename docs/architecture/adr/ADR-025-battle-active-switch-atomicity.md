# ADR-025：Battle active 宠物原子切换

## 状态

已接受。

## 决定

Battle 保留 `battle_team_members_one_active_idx`，继续由数据库保证每名参与者最多只有一只 active 宠物。普通换宠与强制换宠统一调用 `battle.switch_active_member`；该内部函数在既有 room 事务和锁内先把当前 active 宠物设为 inactive，再把已验证且存活的目标槽位设为 active。两个写入属于同一数据库事务，对其他事务不可见中间状态。

禁止使用 `set active = slot = target_slot` 形式的一条多行 `UPDATE` 同时关闭旧宠物和激活新宠物。PostgreSQL 唯一索引逐行即时检查且不保证多行更新顺序；目标行先被处理时会短暂与旧 active 行冲突，把合法换宠误判为永久战斗不变量错误。

目标槽位不存在或已死亡时，内部函数固定抛出 `BATTLE_INVARIANT`，由既有安全作废事务退款、释放占用并写入审计。普通换宠的创建者、对手分支以及强制换宠只能通过该函数改变 active 归属。静态架构门禁同时检查声明式 schema 和 baseline migration，拒绝旧写法、缺少任一调用方或两份数据库定义不一致。

## 结果

合法的换宠、换宠对攻击、双方换宠和超时强制换宠不再受表内物理行顺序影响。唯一索引、安全作废、服务端裁决、回合顺序、伤害规则、资产结算和前端契约均保持不变。
