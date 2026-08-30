# ADR-060：市场成功上架次数配额

- 状态：已接受
- 日期：2026-08-10

## 背景

市场每次成功上架都会创建独立 FIFO `market.listings`、`inventory.reservations` 和幂等 operation。全部下架只把挂单与 reservation 终态化并释放藏品，玩家可以持有一份可出售藏品后反复上架和下架。十种在售模板上限只约束同时在售种类；ADR-059 的通用 operation 准入约束全部新 key，但既不只统计成功上架，也没有市场账号生命周期上限，因此两者都不能阻止单账号无限积累市场历史。

## 决策

每个账号在 UTC+0 自然日内最多成功上架 200 次，在整个账号生命周期内最多成功上架 20,000 次。每次成功创建一条独立挂单计一次，与上架数量无关；同模板追加形成新的 FIFO 挂单，因此计一次。失败请求、相同幂等键重试或回放、取消上架和购买成交不增加次数；跨日只重置每日次数，售出、下架、重新认证、设备变化和任何维护都不减少账号生命周期次数。两项配额同时用尽时固定优先返回账号生命周期上限。

`market.seller_listing_quotas` 是唯一计数事实，每个用户最多一行，保存 `business_date`、`daily_count`、`lifetime_count` 和 `updated_at`。数据库约束固定 `daily_count` 为 `0..200`、`lifetime_count` 为 `0..20000` 且每日次数不得大于生命周期次数。每日日期只使用 `identity.utc_day()`；读接口遇到旧日期时把当日已用次数呈现为 0，首次新上架尝试在用户配额行锁内把日期更新为当前日期并把每日次数归零。

`api.market_create_listing` 对新 operation 保持以下顺序：`operations.begin_command` 先处理旧 key 回放和通用准入；旧 key 完成结果立即返回；新 key 在进入业务异常捕获块前调用 `market.lock_listing_quota`，锁定用户配额行并按“生命周期优先、每日其次”检查余量。超限错误发生在业务捕获块之外，使本次数据库语句整体回滚，不能留下新的 operation。通过预检查后，现有用户级市场 advisory lock、十种模板上限、价格和库存裁决继续保持原顺序。

`market.listings` 的 `BEFORE INSERT` 行级 trigger 是最终消耗边界。trigger 再调用同一配额锁定函数，并在插入挂单的同一事务内把每日和生命周期计数各加一。API 已持有的行锁可在同一事务中安全复用；任何并发新上架必须等待该行，最后一个名额只能被一个事务消耗。trigger 也覆盖未来其他受控服务端插入路径。挂单插入后的 reservation、任务进度或其他业务步骤失败时，PL/pgSQL 子事务同时回滚挂单和计数，operation 按既有失败语义完成；配额拒绝本身不创建失败 operation。

`api.market_bootstrap` 返回严格 `listing_quota`：当前 UTC 日期、每日已用/上限/剩余、生命周期已用/上限/剩余。出售页显示“今日剩余 N / 200 · 累计 M / 20,000”，任一剩余为零时立即禁用确认出售。前端预检查不具备裁决权；多设备或并发造成服务端拒绝时，`MARKET_DAILY_LISTING_LIMIT` 或 `MARKET_LIFETIME_LISTING_LIMIT` 使用 HTTP 409、不可重试、刷新 inventory/market 权威状态，玩家分别只看到“今日上架次数已用完”或“账号累计上架次数已达上限”。

配额表与 helper 位于非暴露 `market` schema，`PUBLIC`、`anon`、`authenticated` 和 `service_role` 均无直接表或函数权限；Functions 仍只执行显式 allowlist 中的 `api` RPC。RLS 继续作为外围拒绝层，不承担业务授权。

本裁决不删除、归档或聚合已有挂单、reservation、成交或 operation 历史，也不新增定时清理任务。20,000 次账号生命周期硬上限直接关闭本次单账号无限增长路径，交易审计与现有 7/30/37 天 operation 规则保持不变。项目正式生产上线前直接修改声明式 Schema 和原始 baseline，并从空真实开发数据库连续重建既有三条 migration，不新增修补 migration。

## 验收

数据库影响域验证必须覆盖第 200/201 次每日边界、UTC 跨日重置、第 20,000/20,001 次生命周期边界、两项同时达到时的错误优先级、相同幂等键回放、同键异请求、并发争抢最后一个名额、模板/数量/库存/十种模板失败不计数、下架和成交不增减、失败事务连同计数回滚，以及应用角色不能直接访问配额对象。配额拒绝必须没有新增 operation、listing 或 reservation。

契约、OpenAPI、Web、声明式 Schema、原始 baseline、架构静态门禁、事务与安全文档、验收与事故恢复文档必须在同一提交一致更新。真实 Telegram Mini App 验证出售页配额、立即禁用、两条业务化错误、成功后的权威刷新和单次请求；Safari Web Inspector 不得出现数据库、服务器、请求、operation 或其他后端处理文案。
