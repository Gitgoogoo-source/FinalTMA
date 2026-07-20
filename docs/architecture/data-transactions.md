# 事务与数据

## Schema 所有权

`supabase/schemas` 按业务上下文编号。`catalog` 拥有链、模板、版本和共享固定属性；`33_decomposition.sql` 与 `43_evolution.sql` 分别拥有对应命令声明，进化保底表为 `evolution.pity`；`gacha` 拥有 `gacha.boxes`；`payments` 拥有 `payments.topup_products`；`70_wallet.sql` 与 `71_mint.sql` 分别声明钱包和 Mint，但继续使用内部 `onchain` schema；`90_payment_callbacks.sql` 与 `91_mint_reconciliation.sql` 分别声明支付回调和 Mint 对账。查询读模型 `api.catalog_get` 在所有依赖对象之后声明。

## 写入规则

所有玩家写操作只调用一个 `api` 命令 RPC。RPC 内依次验证会话、账号状态、资源归属、请求前置条件和幂等键，在一个 PostgreSQL 事务中完成资产、账本、库存、预留、奖励和业务状态写入。Functions 只能传递用户意图和目标标识。

库存占用统一调用 `inventory.reserve`：先锁定用户持有行，再重算全部活跃 reservation，最后写入出售、远征或 Mint 占用。库存扣减不得低于仍活跃的 reservation；市场成交和 Mint 成功先消费对应 reservation，再扣减总量。支付创建按用户和商品类型加事务锁，Mint 按用户和模板加事务锁并受活跃唯一约束，邀请奖励按邀请人加事务锁。

操作 UUID 同时是 `Idempotency-Key` 与 `operation_id`。数据库对规范化请求计算 SHA-256；同键同请求回放持久结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。市场购买响应不包含卖家身份；库存满足 `total = available + listed + trading + minting + expedition`。

预认证登录使用独立的 `identity.login_requests` 幂等表和域隔离 HMAC 请求摘要；用户创建、资料更新、首次入口候选、入口交接状态、旧会话撤销和新会话创建由 `api.identity_authenticate` 在同一事务完成。`banned` 分支只撤销会话，不创建新会话。邀请绑定的候选终态、邀请关系、操作终态和 `referral_processed_at` 必须在同一事务提交；异常回滚后交接仍为 `pending`。

## 迁移

初始空库只有三个迁移：`*_baseline.sql`、`*_product_data_v1.sql`、`*_api_security.sql`。baseline 由声明式 Schema 确定，product data 由 `tools/product_data/build.py` 统一生成，安全权限由显式迁移确定。用户明确宣布正式生产上线前，数据库定义直接修改声明式 Schema 和对应原始迁移，真实开发数据库及 migration history 清空后从第一条迁移重建。正式生产上线后才冻结历史迁移并只新增前向迁移。
