# 事务与数据

## Schema 所有权

`supabase/schemas` 按业务上下文编号。`catalog` 拥有链、模板、版本、共享固定属性以及 `image_thumbnail_path`、`image_detail_path` 两个版本化相对路径，不保存图片二进制；`33_decomposition.sql` 与 `43_evolution.sql` 分别拥有对应命令声明，进化保底表为 `evolution.pity`；`gacha` 拥有 `gacha.boxes`；`payments` 拥有 `payments.topup_products`；`70_wallet.sql` 与 `71_mint.sql` 分别声明钱包和 Mint，但继续使用内部 `onchain` schema；`90_payment_callbacks.sql` 与 `91_mint_reconciliation.sql` 分别声明支付回调和 Mint 对账。查询读模型 `api.catalog_get` 在所有依赖对象之后声明。

## 写入规则

所有玩家写操作只调用一个 `api` 命令 RPC。RPC 内依次验证会话、账号状态、资源归属、请求前置条件和幂等键，在一个 PostgreSQL 事务中完成资产、账本、库存、预留、奖励和业务状态写入。Functions 只能传递用户意图和目标标识。

库存占用统一调用 `inventory.reserve`：先锁定用户持有行，再重算全部活跃 reservation，最后写入出售、远征或 Mint 占用。库存扣减不得低于仍活跃的 reservation；市场成交和 Mint 成功先消费对应 reservation，再扣减总量。市场上架和按模板全部下架使用同一用户级事务 advisory lock；锁内按仍有剩余数量的不同模板计数，已有 10 种时只允许向现有模板追加。全部下架再按 FIFO 稳定顺序锁定本人该模板的全部有效挂单，原子取消并释放其剩余 reservation；没有有效挂单也以释放 0 的结果幂等成功。支付创建按用户和商品类型加事务锁，Mint 按用户和模板加事务锁并受活跃唯一约束，邀请奖励按邀请人加事务锁。

操作 UUID 同时是 `Idempotency-Key` 与 `operation_id`。数据库对规范化请求计算 SHA-256；同键同请求回放持久结果，同键不同请求返回 `IDEMPOTENCY_KEY_REUSED`。开盒、转盘与进化结果的确认时间同原操作保存；领域专用确认 RPC 锁定当前用户、匹配固定 `use_case` 和终态，并只写入首次确认时间，重复与并发确认不改变结果。进化预览 RPC 只读取目录、真实可用数量、Fgems 和路线保底；最终结算仍由 `api.inventory_evolve` 在单一事务内重新校验并裁决。市场购买响应不包含卖家身份；库存满足 `total = available + listed + trading + minting + expedition`。

`api.album_get` 是图鉴唯一读取模型：在同一次数据库读取中按 `catalog.chains.global_order` 聚合固定 70 条链和每链 3 个模板节点，并直接返回 `album.nodes` 的节点级永久点亮事实、`inventory.holdings.quantity` 的当前拥有总数、`album.rewards` 的领取事实以及完成链、可领取汇总。Web 不再联接公开目录补节点，也不得用链条点亮数量推断节点状态。`album.unlock_template` 只在节点主键首次插入成功时推进当日点亮任务，并以“用户 + 链”事务锁串行裁决第三个显式节点、仅推进一次完成链任务；所有合法获得方式共用这一事务边界。`api.album_claim` 通过操作幂等记录、`album.rewards (user_id, chain_id)` 主键、Fgems 账本唯一写入和同一数据库事务保证并发领取最多成功一次。

预认证登录使用独立的 `identity.login_requests` 幂等表和域隔离 HMAC 请求摘要；用户创建、资料更新、首次入口候选、入口交接状态、旧会话撤销和新会话创建由 `api.identity_authenticate` 在同一事务完成。`banned` 分支只撤销会话，不创建新会话。邀请绑定的候选终态、邀请关系、操作终态和 `referral_processed_at` 必须在同一事务提交；异常回滚后交接仍为 `pending`。

## Monster Tamer 状态机

`monster_tamer.chain_profiles` 为 70 条正式进化链保存唯一生态属性，阶段技能资料与世界、节点和遭遇定义由 product-data migration 确定。210 份战斗投影只从正式 `catalog.templates`、链属性和固定阶段技能计算，不复制图片、稀有度、阶段或 `combat_power` 的第二份事实。

`api.monster_tamer_bootstrap` 只读当前会话用户、`inventory.available_quantity`、固定内容、玩家进度和活动战斗。若已保存队伍中的任一模板不再可用，读取结果固定投影为营地和重新组队状态，不能把旧队伍快照交给运行时继续使用。

`api.monster_tamer_checkpoint` 接受确认队伍、进入区域、完成世界节点、使用内部补给，以及地图经过格与迷雾格同步。只有同步命令可以携带最多 256 个保持顺序且允许回走重复的 `traversed_cell_ids`；服务端从 `resume_position` 开始逐格验证相邻、固定 `walkable` 资料、未完成能力门禁和当前区域，再保存末格。迷雾格只能位于本次已验证路径及起点两格范围内。节点、出口和区域切换只读取已保存位置并校验邻接，不接受客户端坐标。它使用进度 `state_version` 阻止乱序覆盖；区域重入递增服务端 entry serial，普通敌人、治疗果和补给点只在当前 entry serial 内领取一次，永久节点只完成一次。活动战斗存在时拒绝推进世界状态。

`api.monster_tamer_battle` 接受开始固定遭遇、使用一个技能或确认本人已经显示的战斗终局。首次遭遇必须处于该定义的服务端接战半径并存在合法可达路线；首领再战必须提交与目标首领绑定、已经开放且邻接权威位置的祭坛节点。开始战斗时把服务端返回位置固化进战斗快照，胜利后恢复该确定位置，失败则回营。开始战斗的锁顺序固定为 operation、玩家进度、未确认战斗、按 template ID 排序的 holdings，再读取 reservations 并重算可用量；回合命令同时锁定原活动战斗和进度。伤害、环境效果、附加状态、敌方动作、自动换员、胜负和内部补给均由 RPC 计算。战斗版本每个成功回合递增，进度版本只在战斗开始或终态改变权威进度时递增。胜负终局在本人幂等确认前保持唯一未确认状态，bootstrap 持续恢复并阻止新战斗；确认成功后才从活动读取中移除。

普通遭遇可以随区域重入重复开始；精英首次胜利、区域首领首次胜利、永久能力和最终守护者首次通关在战斗终态事务中唯一写入。首胜后原首领遭遇不可再次开始，只能使用五个区域祭坛和一个最终祭坛再战，且不重复发放首次结果。全队倒下在同一事务返回营地并恢复队伍。所有 Monster Tamer 事务只能写 `monster_tamer` schema；正式目录、holdings 和 reservations 均为只读，不能改变任何 TMA 资产、任务或账本。

## 迁移

初始空库只有三个迁移：`*_baseline.sql`、`*_product_data_v1.sql`、`*_api_security.sql`。baseline 由声明式 Schema 确定，product data 由 `tools/product_data/build.py` 统一生成，安全权限由显式迁移确定。用户明确宣布正式生产上线前，数据库定义直接修改声明式 Schema 和对应原始迁移，真实开发数据库及 migration history 清空后从第一条迁移重建。正式生产上线后才冻结历史迁移并只新增前向迁移。
