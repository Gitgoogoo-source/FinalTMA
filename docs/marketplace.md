# 第二阶段交易市场开发文档

## 阶段 1：数据模型边界

本阶段只明确第二阶段交易市场的数据模型边界，不新增表、不修改 RPC、不改前端业务流程。

已核对当前仓库 migration 和远程 Supabase schema，第二阶段交易市场采用实例级交易模型：

```txt
市场交易对象 = inventory.item_instances 的具体实例
出售数量 = 被选择的 item_instance_id 数量
购买转移 = owner_user_id 从卖家改为买家
挂单锁定 = inventory_locks + item_instances.status=listed
```

### 核心边界

1. 交易市场卖的是具体库存实例，不是抽象藏品数量。
2. 出售时，用户必须选择一个或多个具体的 `inventory.item_instances.id`。
3. 出售数量等于被选择的 `item_instance_id` 数量。
4. 一个挂单可以包含多个 `template_id + form_id` 相同的 item instance。
5. 创建挂单成功后，每个被选择的 item instance 都必须写入一条 `market.listing_items`，状态为 `reserved`。
6. 创建挂单成功后，每个被选择的 item instance 都必须写入一条 `inventory.inventory_locks`，状态为 `active`，`lock_type` 为 `market_listing`。
7. 创建挂单成功后，每个被选择的 `inventory.item_instances.status` 必须从 `available` 变为 `listed`。
8. 初期购买只支持购买 1 个挂单单位，即从 `market.listing_items` 中锁定并转移 1 个 `reserved` item。

### 多件挂单流转

当一个挂单包含多件商品时：

1. 买走一件后，`market.listings.remaining_count` 减 1。
2. 仍有剩余时，`market.listings.status` 变为 `partially_sold`。
3. 全部售出时，`market.listings.status` 变为 `sold`。
4. 已售出的 `market.listing_items.status` 变为 `sold`。
5. 已售出的 `inventory.inventory_locks.status` 变为 `consumed`。
6. 已售出的 `inventory.item_instances.owner_user_id` 从卖家改为买家，`status` 回到 `available`。

### 不允许的模型

1. 不允许只按 `template_id` 或藏品数量创建挂单。
2. 不允许前端决定最终所有权、最终余额、最终手续费或最终市场状态。
3. 不允许跳过 `inventory.inventory_locks` 直接把 item 标记为已挂售。
4. 不允许购买时只减少数量而不转移具体 `item_instance_id`。
5. 不允许把已售出的 item 在取消挂单时返还给卖家。

### 后续阶段约束

后续 API、RPC、前端页面和测试都必须围绕这个边界实现：

```txt
frontend -> api/market/* -> requireSession -> validate -> callRpcRaw -> Supabase RPC
```

前端只能提交候选 `item_instance_id`、价格、数量和幂等键；最终校验必须由 Vercel API 和 Supabase RPC 完成，包括所有权、可售状态、库存锁、余额、手续费、订单和审计事件。
