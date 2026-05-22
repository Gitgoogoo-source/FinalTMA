---
description: tmaGame 第二阶段交易市场编码规则。开发购买/出售/挂单管理、市场 API、Supabase RPC、库存锁、K-coin 结算和市场统计时使用。
globs:
  - "api/market/**/*.ts"
  - "api/cron/**/*market*.ts"
  - "apps/web/src/features/trade/**/*.{ts,tsx}"
  - "apps/web/src/api/endpoints.ts"
  - "packages/validation/src/market.schemas.ts"
  - "supabase/migrations/**/*.sql"
  - "supabase/tests/**/*market*.sql"
  - "tests/api/**/*market*.test.ts"
alwaysApply: false
---

# tmaGame 第二阶段交易市场 AI 编码规则

## 0. 项目真实来源

不要猜测项目结构、数据库名称、API helper、RPC 名称或数据表字段。
修改代码前，必须先检查现有仓库文件和当前 Supabase schema。
如果找不到某个文件、helper、表、字段、RPC、类型或路由，必须先停止并继续搜索，不要直接新建。
如果继续搜索后仍然找不到，应明确说明不确定点，并实现最小范围的兼容性补充。

当前项目架构：

```txt
frontend -> Vercel API -> Supabase RPC / Postgres transaction
```

前端位于 `apps/web`。
Vercel Functions 位于根目录 `api/`。
Supabase migrations 和 tests 位于 `supabase/`。
生成的数据库类型位于 `packages/db-types`；不要手动编辑生成类型。

## 1. 不可妥协的安全规则

前端只负责展示数据和发起请求。
前端绝不能决定最终余额、最终所有权、最终手续费、最终市场状态或最终库存状态。

前端代码中绝不能暴露或使用以下内容：

```txt
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY
TELEGRAM_BOT_TOKEN
TON private key
webhook secret
session secret
```

所有市场写操作必须使用：

```txt
frontend -> api/market/* -> requireSession -> validate -> callRpcRaw -> Supabase RPC
```

绝不能信任 request body 里的 `user_id`、`seller_user_id` 或 `buyer_user_id`。
必须始终通过 `requireSession(req)` 获取用户，并将 `session.userId` 传入 RPC。

市场写 API 必须要求幂等键。
可以从 `X-Idempotency-Key` 和/或 body 中读取，但必须向 RPC 传入一个规范化后的唯一值。
重复请求绝不能造成重复余额变更或重复创建挂单。

## 2. 必须遵循的现有后端模式

使用现有 API helper 模式。不要另起一套平行 API 框架。

使用这些模式：

```txt
withApiHandler(...)
requireSession(req)
parseJsonBody(req)
validate(schema, input)
getIdempotencyKey(req)
callRpcRaw(rpcName, args, { schema: "api" as never, context })
ApiError for mapped user-facing errors
```

每个 API route 必须定义：

```txt
methods
rateLimit.action
```

route handler 直接返回数据即可。`withApiHandler` 会包装标准响应结构。
除非现有 helper 要求，否则不要手动包装成功响应。

必须将 RPC/数据库错误映射为稳定的前端错误码和中文提示。
不要把原始 SQL 错误暴露给用户。

## 3. 必须遵循的现有前端模式

前端 API 请求使用 `apps/web/src/api/client.ts` 和 `apiRequest`。
除非当前仓库已经实现 `packages/api-client/src/client.ts`，否则不要使用它。

市场 API 路径添加到：

```txt
apps/web/src/api/endpoints.ts
```

交易市场前端代码放在：

```txt
apps/web/src/features/trade/
```

推荐结构：

```txt
apps/web/src/features/trade/
├── trade.api.ts
├── trade.types.ts
├── trade.utils.ts
├── trade.constants.ts
├── pages/TradePage.tsx
├── buy/
├── sell/
└── manage/
```

如果现有项目使用 TanStack Query 风格的数据流，应继续使用该风格。
不要把服务端拥有的业务状态存入 Zustand 或本地组件状态；临时 UI 状态除外。
临时 UI 状态示例：当前 tab、筛选条件、选中的挂单、选中的 item ids、弹窗打开状态、价格输入值。

在 `trade.api.ts` 中 normalize API 响应，再交给 UI 组件。
数据库/API 可以使用 `snake_case`；前端展示类型可以使用 `camelCase`。
必须优雅处理缺失的可选字段。

## 4. 第二阶段范围

除非用户明确要求，否则只实现第二阶段交易市场。

范围内：

```txt
购买页
出售页
挂单管理页
可出售库存列表
创建挂单
挂单库存锁
购买挂单
K-coin 扣款/入账结算
市场手续费结算
修改挂单价格
取消/下架挂单
市场挂单详情
市场价格快照
市场深度快照
价格健康状态展示
市场 API 测试
数据库测试
```

除非明确要求，否则范围外：

```txt
Telegram Stars 支付变更
TON 钱包 / NFT Mint 流程
任务中心完整实现
图鉴排行榜实现
后台管理面板完整 UI
新游戏页玩法
修改与交易无关的第一阶段 gacha 行为
```

除非市场工作依赖某个共享工具或测试 fixture，否则不要修改第一阶段 gacha 逻辑。

## 5. 交易市场数据库真实规则

交易市场出售的是具体的 `inventory.item_instances`，不是抽象的藏品数量。

规则：

```txt
一个挂单包含一个或多个具体 item_instance_id。
用户只能出售自己拥有的 item_instances。
用户只能出售 status = available 的 item_instances。
用户只能出售 tradeable = true 的藏品模板。
已挂售 item 必须在 inventory.inventory_locks 中被锁定。
已挂售 item 不能升级、合成、分解、Mint 或再次挂售。
```

核心表：

```txt
market.listings
market.listing_items
market.orders
market.order_items
market.listing_events
market.price_snapshots
market.depth_snapshots
market.price_health_rules
market.fee_settlements
inventory.item_instances
inventory.inventory_locks
inventory.item_instance_events
economy.user_balances
economy.currency_ledger
economy.fee_rules
catalog.collectible_templates
catalog.collectible_forms
catalog.collectible_media
catalog.rarities
catalog.item_types
catalog.series
catalog.banner_campaigns
```

除非现有 schema 无法支撑需求，否则不要创建重复数据表。
优先新增 RPC、view、index 和 tests，而不是替换现有 schema。

## 6. 必需的市场状态流转

挂单流转：

```txt
market.listings.status:
active -> partially_sold -> sold
active -> cancelled
partially_sold -> cancelled
active/partially_sold -> expired，后续可选
```

挂单 item 流转：

```txt
market.listing_items.status:
reserved -> sold
reserved -> cancelled
reserved -> expired，后续可选
```

库存 item 流转：

```txt
inventory.item_instances.status:
available -> listed
listed -> available       # cancel / delist
listed -> available       # bought，但 owner_user_id 会变更为买家
```

库存锁流转：

```txt
inventory.inventory_locks.status:
active -> consumed        # sold
active -> released        # cancelled / delisted
active -> expired         # 可选过期
```

成功事务绝不能留下混合状态。
无效混合状态示例：

```txt
listing active 但 item status available
item status listed 但没有 active inventory lock
listing_item sold 但 item owner 仍然是卖家
买家已扣款但 item owner 未转移
卖家已入账但 order 缺失
```

## 7. 必需 RPC

新增 RPC 前，必须检查现有 migrations 和 RPC 定义。
如果函数已存在，应通过新的 migration 使用 `CREATE OR REPLACE FUNCTION` 扩展。
不要编辑已经应用到远程项目的历史 migrations。

必需 RPC 或等价函数：

```txt
market_list_listings
market_get_listing_detail
market_list_sellable_items
market_create_listing
market_buy_listing
market_list_my_listings
market_get_my_listing_stats
market_update_listing_price
market_cancel_listing
market_refresh_price_stats
```

所有写 RPC 必须：

```txt
在单个事务中运行。
锁定将要修改的行。
基于 p_user_id 校验所有权。
使用幂等键。
拒绝非法状态流转。
写入审计/事件行。
返回足够前端刷新和展示反馈的数据。
```

## 8. 创建挂单 RPC 规则

`market_create_listing` 必须：

```txt
要求 p_user_id。
要求 p_item_instance_ids。
要求 p_unit_price_kcoin > 0。
要求 p_idempotency_key。
锁定选中的 inventory.item_instances 行。
验证所有 items 都属于 p_user_id。
验证所有 items 都是 status = available。
验证所有 items 没有 active inventory_locks。
验证所有 item templates 都是 tradeable。
验证所有选中 items 属于同一个 template_id + form_id + rarity_code。
读取 active economy.fee_rules，其中 fee_type = market_sell 且 currency_code = KCOIN。
计算 fee_bps 和 expected_net_amount。
创建 market.listings。
创建 status = reserved 的 market.listing_items。
创建 lock_type = market_listing 且 status = active 的 inventory.inventory_locks。
更新 inventory.item_instances.status = listed。
写入 inventory.item_instance_events，event_type = listed。
写入 market.listing_events，event_type = created。
返回 listing_id、item_count、remaining_count、unit_price_kcoin、fee_bps、expected_net_amount、status。
```

必须拒绝：

```txt
缺少幂等键。
空 item 列表。
属于其他用户的 items。
已经挂售或锁定的 items。
单个挂单中包含不同 template/form 的 items。
不可交易的 templates。
无效价格。
幂等冲突。
```

## 9. 购买挂单 RPC 规则

`market_buy_listing` 必须：

```txt
要求 p_buyer_user_id。
要求 p_listing_id。
要求 p_quantity；除非多件购买已完整处理，否则初期只支持 quantity = 1。
要求 p_expected_unit_price_kcoin。
要求 p_idempotency_key。
锁定 market.listings 行。
验证 listing status 是 active 或 partially_sold。
验证 listing.remaining_count >= p_quantity。
拒绝买家购买自己的挂单。
如果当前挂单价格和 expected price 不一致，必须拒绝。
锁定选中的 market.listing_items 行，其中 status = reserved。
锁定买家和卖家的 KCOIN balance 行。
验证买家 available KCOIN 足够。
计算 total_price_kcoin。
根据 listing fee_bps 快照计算 fee_amount_kcoin。
计算 seller_net_amount_kcoin。
写入买家 KCOIN debit 的 economy.currency_ledger，entry_type = debit。
写入卖家 KCOIN credit 的 economy.currency_ledger，entry_type = credit。
写入 market.fee_settlements。
创建 status = completed 的 market.orders。
创建 market.order_items。
将选中的 listing_items 更新为 sold。
将选中的 inventory_locks 更新为 consumed。
将选中的 item_instances.owner_user_id 转移给买家。
将买到的 item_instances.status 设置为 available。
写入 inventory.item_instance_events，包含 sold 和 bought。
更新 listing.remaining_count。
当 remaining_count = 0 时设置 listing.status = sold，否则设置为 partially_sold。
写入 market.listing_events，event_type = sold 或 partially_sold。
返回 order_id、purchased items、total_price_kcoin、fee_amount_kcoin、seller_net_amount_kcoin、buyer_balance_after。
```

必须拒绝：

```txt
挂单不存在。
挂单不可购买。
购买自己的挂单。
KCOIN 不足。
价格已变化。
已售罄。
幂等冲突。
并发购买冲突。
```

## 10. 改价 RPC 规则

`market_update_listing_price` 必须：

```txt
要求 p_user_id。
要求 p_listing_id。
要求 p_new_unit_price_kcoin > 0。
要求 p_idempotency_key。
锁定 listing 行。
验证 listing 属于 p_user_id。
验证 listing status 是 active 或 partially_sold。
重新计算 expected_net_amount。
重新计算 price_health。
更新 unit_price_kcoin。
更新 last_price_changed_at。
写入 market.listing_events，event_type = price_changed。
返回更新后的挂单摘要。
```

不要修改历史订单。
不要允许 sold 或 cancelled 挂单改价。

## 11. 取消/下架挂单 RPC 规则

`market_cancel_listing` 必须：

```txt
要求 p_user_id。
要求 p_listing_id。
要求 p_idempotency_key。
锁定 listing 行。
验证 listing 属于 p_user_id。
验证 listing status 是 active 或 partially_sold。
查找 remaining 的 listing_items，其中 status = reserved。
将剩余 listing_items.status 设置为 cancelled。
释放对应 inventory_locks，status = released。
将对应未售出的 item_instances.status 设置为 available。
将 listing.status 设置为 cancelled。
将 listing.remaining_count 设置为 0，用于表示取消剩余库存。
写入 inventory.item_instance_events，event_type = delisted。
写入 market.listing_events，event_type = cancelled。
返回取消后的挂单摘要和已释放 item ids。
```

不要把已经售出的 items 返还给卖家。
不要修改已售出订单记录。

## 12. Ledger 和余额规则

KCOIN 余额只能通过后端/RPC 逻辑变更。
每一次余额变更都必须写入 economy.currency_ledger。
不要在没有 ledger 的情况下更新 economy.user_balances。
不要只写 ledger 而不更新余额快照。

市场购买：

```txt
买家：debit total_price_kcoin。
卖家：credit seller_net_amount_kcoin。
平台手续费：为 fee_amount_kcoin 写入 market.fee_settlements。
```

当存在 available_before、available_after、locked_before、locked_after 字段时，应使用这些字段。
余额绝不能变成负数。

## 13. 价格统计规则

市场详情应该展示参考价和市场深度，但缺少统计数据绝不能影响购买。

统计表：

```txt
market.price_snapshots
market.depth_snapshots
market.price_health_rules
```

`market_refresh_price_stats` 应按 `template_id + form_id` 计算：

```txt
floor_price_kcoin
avg_price_kcoin
last_sale_price_kcoin
active_listing_count
sale_count_24h
volume_24h_kcoin
snapshot_at
```

价格健康状态兜底规则：

```txt
没有 floor price -> unknown
price < floor_price * 0.5 -> too_low
price > floor_price * 2 -> too_high
其他 -> healthy
```

当前端缺少统计数据时，必须显示 `暂无参考` 或等价文案。

## 14. API endpoint 要求

在 `api/market/` 下添加这些 endpoints：

```txt
GET  /api/market/listings
GET  /api/market/listing-detail
POST /api/market/buy
GET  /api/market/sellable-items
POST /api/market/create-listing
GET  /api/market/my-listings
GET  /api/market/my-listing-stats
POST /api/market/update-price
POST /api/market/cancel-listing
GET  /api/market/stats
```

将这些路径添加到 `apps/web/src/api/endpoints.ts`。

所有写 API 必须将幂等键传给 RPC，并包含 request context：

```txt
requestId
userId
listingId when available
idempotencyKey
```

推荐用户可见 API 错误码：

```txt
LISTING_NOT_FOUND
LISTING_NOT_BUYABLE
CANNOT_BUY_OWN_LISTING
KCOIN_NOT_ENOUGH
LISTING_PRICE_CHANGED
LISTING_SOLD_OUT
ITEM_NOT_SELLABLE
ITEM_ALREADY_LOCKED
IDEMPOTENCY_CONFLICT
MARKET_PRICE_INVALID
```

## 15. 前端页面要求

将现有交易占位页替换为三个 tab：

```txt
购买
出售
报价/管理
```

使用 query param 或本地 route state 管理 tabs：

```txt
/trade?tab=buy
/trade?tab=sell
/trade?tab=manage
```

### 购买页

必须包含：

```txt
Market banner 或安全空状态。
价格/稀有度/类型筛选。
重置筛选。
挂单卡片。
挂单详情 sheet。
购买确认弹窗。
自己的挂单必须有清晰禁用状态。
当余额数据可用时，买不起的挂单必须有清晰禁用状态。
```

购买成功后刷新：

```txt
assets
market listings
listing detail
inventory/collection data
```

### 出售页

必须包含：

```txt
可出售 item 列表。
稀有度/类型/价格筛选。
已选 item 详情卡片。
数量选择器。
价格输入框。
建议价格区间。
手续费预览。
确认出售弹窗。
```

最终手续费和预计到手金额必须以服务端响应为准。
前端预览只用于信息展示。

创建挂单成功后刷新：

```txt
sellable items
my listings
market listings
inventory/collection data
```

### 管理页

必须包含：

```txt
当前活跃挂单数量。
总挂单价值。
预计净到账金额。
我的挂单卡片。
筛选和排序。
改价弹窗。
取消/下架挂单弹窗。
```

改价/取消后，刷新相关交易 queries 和库存 queries。

## 16. 前端 mutation 规则

每个写请求必须生成或提供幂等键。
尽可能在 request header 和 body 中使用同一个幂等键。
不要将 KCOIN 余额或所有权做最终乐观更新。
以服务端响应和 refetch 结果为准。

展示清晰的 toast/dialog 反馈：

```txt
上架成功
购买成功
改价成功
下架成功
余额不足
价格已变化，请刷新后重试
商品已售罄
藏品已被锁定
```

绝不能向用户展示原始 SQL 或原始 RPC 错误信息。

## 17. 校验规则

创建或更新：

```txt
packages/validation/src/market.schemas.ts
```

校验：

```txt
UUID strings
positive KCOIN price
limit max value
allowed sort values
allowed rarity/type/status values
non-empty item_instance_ids
idempotency_key length
quantity currently 1 unless multi-buy is fully supported
```

不要接受 NaN、Infinity、负数、空字符串或未经检查的数组。

## 18. Migration 规则

第二阶段变更使用新的 migration。
不要修改旧的已应用 migrations。
清晰命名 migrations，例如：

```txt
xxxx_phase2_market_rpc_hardening.sql
xxxx_phase2_market_stats.sql
```

Migrations 应包含：

```txt
新增或替换 RPC。
必要索引。
必要约束。
可选 read model views。
API schema functions 需要的权限/grants。
```

不要仅因为 advisor 显示 unused 就删除现有索引。新项目使用量低是正常现象。
应为第二阶段高频路径添加必要索引。

## 19. 测试要求

添加数据库测试：

```txt
market_create_listing
market_buy_listing
market_update_listing_price
market_cancel_listing
market_concurrency
market_price_stats
```

测试成功和失败场景。
至少验证：

```txt
不能挂售其他用户的 item。
不能挂售 locked/listed item。
不能购买自己的挂单。
KCOIN 不足时不能购买。
不能购买 sold/cancelled 挂单。
相同幂等键不能重复购买。
并发购买最后一个 item 时只能成功一次。
购买成功会转移 item owner。
购买成功会写入买家 debit ledger。
购买成功会写入卖家 credit ledger。
购买成功会写入 fee settlement。
取消挂单会释放未售出 item locks。
取消挂单时，已售出的 item 不会返还给卖家。
```

添加 API 测试：

```txt
market listings
create listing
buy listing
update price
cancel listing
```

声明完成前，运行或明确要求用户运行：

```txt
pnpm typecheck
pnpm lint
pnpm test:db
pnpm exec vitest run tests/api
```

如果没有运行测试，必须明确说明未运行。
除非测试确实已经运行并通过，否则不要声称测试通过。

## 20. 减少幻觉检查清单

实现任何变更前，在内部回答这些问题：

```txt
我正在修改哪个现有文件？
我是否已经检查过该文件？
这个 helper 是否已经存在？
这个 RPC 是否已经存在？
这个表/字段是否真实存在？
我是否使用 session.userId，而不是 body.user_id？
这是否是应该放进 RPC 的核心写操作？
这个操作是否需要幂等？
哪些行需要被锁定？
必须写入哪些 event/ledger/audit 行？
成功后需要 refetch 哪些 queries？
哪些测试可以证明不会复制资产或丢失资产？
```

如果任何答案未知，必须先检查仓库或 Supabase schema，再继续。

## 21. 禁止的捷径

不要：

```txt
从前端直接更新余额。
从前端直接更新库存。
从前端直接插入市场挂单。
使用 body.user_id 做授权。
跳过幂等键。
跳过库存锁。
跳过 ledger entries。
跳过 order records。
跳过 listing events。
跳过 item instance events。
购买时假设当前价格等于前端缓存价格。
允许用户购买自己的挂单。
允许已挂售 items 被分解/合成/升级/Mint。
在生产路径中创建假的 mock 数据。
静默忽略 RPC 错误。
在 UI 中暴露原始数据库错误。
手动修改生成的数据库类型。
为了第二阶段重写应用架构。
```

## 22. 完成定义

只有满足以下条件，第二阶段才算完成：

```txt
/trade 显示购买/出售/管理 tabs。
卖家可以从 available 库存创建挂单。
已挂售库存被锁定，并从可出售列表中移除。
买家可以使用 KCOIN 购买。
购买会扣减买家余额、增加卖家余额、记录平台手续费、转移 item owner。
卖家可以修改价格。
卖家可以取消挂单。
取消会释放未售出库存。
市场详情展示价格参考/深度/健康状态，或安全空状态。
数据库测试覆盖挂单、购买、取消、改价、幂等和并发。
API 测试覆盖市场 endpoints 和错误映射。
前端代码不包含 service role secrets 或直接业务写入。
```
