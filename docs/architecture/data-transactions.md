# 事务与数据

## Schema 所有权

`supabase/schemas` 按业务上下文编号：foundation、identity、catalog、operations、economy、inventory、gacha、expedition、wheel、market、payments、vip、tasks、referral、album、onchain、risk、integrations、jobs。同一文件拥有本领域表、约束、内部函数及查询/命令 RPC。

## 写入规则

所有玩家写操作只调用一个 `api` 命令 RPC。RPC 内依次验证会话、账号状态、资源归属、请求前置条件和幂等键，在一个 PostgreSQL 事务中完成资产、账本、库存、预留、奖励和业务状态写入。Functions 只能传递用户意图和目标标识。

库存占用统一调用 `inventory.reserve`：先锁定用户持有行，再重算全部活跃 reservation，最后写入出售、远征或 Mint 占用。库存扣减不得低于仍活跃的 reservation；市场成交和 Mint 成功先消费对应 reservation，再扣减总量。支付创建按用户和商品类型加事务锁，Mint 按用户和模板加事务锁并受活跃唯一约束，邀请奖励按邀请人加事务锁。

操作 UUID 同时是 `Idempotency-Key` 与 `operation_id`。数据库对规范化请求计算 SHA-256；同键同请求回放持久结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。市场购买响应不包含卖家身份；库存满足 `total = available + listed + trading + minting + expedition`。

## 迁移

初始空库只有三个迁移：`*_baseline.sql`、`*_catalog_v1.sql`、`*_api_security.sql`。baseline 由声明式 Schema 确定，目录 DML 与安全权限显式迁移。初始基线进入真实测试环境后，只新增前向迁移，不覆盖现有迁移名或历史文件。
