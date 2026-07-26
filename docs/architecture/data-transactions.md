# 事务与数据

## Schema 所有权

`supabase/schemas` 按业务上下文编号。`catalog` 拥有链、模板、版本、共享固定属性以及 `image_thumbnail_path`、`image_detail_path` 两个版本化相对路径，不保存图片二进制；`33_decomposition.sql` 与 `43_evolution.sql` 分别拥有对应命令声明，进化保底表为 `evolution.pity`；`gacha` 拥有 `gacha.boxes`；`payments` 拥有 `payments.topup_products`；`44_battle.sql` 拥有内部 `battle` schema、`battle-v1` 配置、room 状态机、引擎、玩家 RPC、私有审计和 outbox；`70_wallet.sql` 与 `71_mint.sql` 分别声明钱包和 Mint，但继续使用内部 `onchain` schema；`90_payment_callbacks.sql` 与 `91_mint_reconciliation.sql` 分别声明支付回调和 Mint 对账；`95_jobs.sql` 拥有 Battle 不变量监控。查询读模型 `api.catalog_get` 在所有依赖对象之后声明。

## 写入规则

所有玩家写操作只调用一个 `api` 命令 RPC。创建 operation 的 RPC 依次验证会话、账号状态、资源归属、请求前置条件和幂等键；不创建 operation 的语义幂等 RPC 依次验证同一安全边界与目标状态。资产、账本、库存、预留、奖励和业务状态写入均在一个 PostgreSQL 事务中完成。Functions 只能传递用户意图和目标标识。

库存占用统一调用 `inventory.reserve`：先锁定用户持有行，再重算全部活跃 reservation，最后写入出售、远征、Battle 或 Mint 占用。库存扣减不得低于仍活跃的 reservation；市场成交和 Mint 成功先消费对应 reservation，再扣减总量。Battle 创建者与接受者分别按 `template_id` 排序锁定 holding，并对三个不同模板各创建数量 1、`kind = battle`、reference 指向 participant 的 reservation。统一库存等式为 `total = available + listed + trading + minting + expedition + battling`。市场上架和按模板全部下架使用同一用户级事务 advisory lock；锁内按仍有剩余数量的不同模板计数，已有 10 种时只允许向现有模板追加。全部下架再按 FIFO 稳定顺序锁定本人该模板的全部有效挂单，原子取消并释放其剩余 reservation；没有有效挂单也以释放 0 的结果幂等成功。支付创建按用户和商品类型加事务锁，Mint 按用户和模板加事务锁并受活跃唯一约束，邀请奖励按邀请人加事务锁。

创建 operation 的玩家命令使用同一个操作 UUID 作为 `Idempotency-Key` 与 `operation_id`。数据库对规范化请求计算 SHA-256；同键同请求回放持久结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。开盒、转盘与进化结果的确认时间同原操作保存；领域专用确认 RPC 锁定当前用户、匹配固定 `use_case` 和终态，并只写入首次确认时间，重复与并发确认不改变结果。当前 Web 打开进化确认页不调用预览 RPC；兼容保留的进化预览 RPC 仍只读取目录、真实可用数量、Fgems 和路线保底。无论前端静态预检查结果如何，最终结算都由 `api.inventory_evolve` 在单一事务内重新校验并裁决。市场购买响应不包含卖家身份；库存满足 `total = available + listed + trading + minting + expedition + battling`。

Battle room 行是该房间全部写事务的首个业务锁。创建、接受、取消、过期、动作、deadline 托管、强制换宠、终局、退款和结算分别通过一个具名 RPC 完成；命中、伤害、行动顺序和终局只读取房间的 `battle-v1` checksum 与不可变模板快照。创建、取消、接受、正常动作和强制换宠创建 operation 并使用 UUID 幂等键；heartbeat 仅以数据库服务端时间单调更新最近在线时间，offline 幂等进入离线重连期，acknowledge 仅首次写入本人确认时间，后三者不接收幂等键且不创建 operation。涉及双方余额时按用户 UUID 排序锁定 balance；stake 状态、room 唯一 settlement 和 ledger reference 阻止重复锁定、退款与到账。每次状态变化递增 `rooms.state_version`，追加私有 event，并在同一事务写 outbox。

Battle 在检测到规则、快照、生命、活动宠物、stake、ledger 或 settlement 永久不变量错误时停止普通结算，使用独立安全事务写入 `voided`、双方原额退款、释放 reservation 和 invariant violation。玩家接口不读取私有 seed、roll、审计事件或对手秘密字段；viewer-specific JSON 由数据库 RPC 直接裁剪。

`api.album_get` 是图鉴唯一读取模型：在同一次数据库读取中按 `catalog.chains.global_order` 聚合固定 70 条链和每链 3 个模板节点，并直接返回 `album.nodes` 的节点级永久点亮事实、`inventory.holdings.quantity` 的当前拥有总数、`album.rewards` 的领取事实以及完成链、可领取汇总。Web 不再联接公开目录补节点，也不得用链条点亮数量推断节点状态。`album.unlock_template` 只在节点主键首次插入成功时推进当日点亮任务，并以“用户 + 链”事务锁串行裁决第三个显式节点、仅推进一次完成链任务；所有合法获得方式共用这一事务边界。`api.album_claim` 通过操作幂等记录、`album.rewards (user_id, chain_id)` 主键、Fgems 账本唯一写入和同一数据库事务保证并发领取最多成功一次。

预认证登录使用独立的 `identity.login_requests` 幂等表和域隔离 HMAC 请求摘要；用户创建、资料更新、首次入口候选、入口交接状态、旧会话撤销和新会话创建由 `api.identity_authenticate` 在同一事务完成。`banned` 分支只撤销会话，不创建新会话。邀请绑定的候选终态、邀请关系、操作终态和 `referral_processed_at` 必须在同一事务提交；异常回滚后交接仍为 `pending`。

## 迁移

初始空库只有三个迁移：`*_baseline.sql`、`*_product_data_v1.sql`、`*_api_security.sql`。baseline 由声明式 Schema 确定，product data 由 `tools/product_data/build.py` 统一生成，安全权限由显式迁移确定。用户明确宣布正式生产上线前，数据库定义直接修改声明式 Schema 和对应原始迁移，真实开发数据库及 migration history 清空后从第一条迁移重建。正式生产上线后才冻结历史迁移并只新增前向迁移。
