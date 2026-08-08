# ADR-039：库存数量集合式读模型

- 状态：已接受
- 日期：2026-08-08

## 背景

原库存批量读取先扫描用户 holding，再为每个模板调用 `inventory.available_quantity` 和 `inventory.item_json`。后者分别聚合 listing、expedition、mint、battle reservation，库存列表还为 items、template_count 和 total_quantity 重复扫描 holding。真实开发 PostgreSQL 17.6 的可回滚 210 模板数据证明：展开后的库存读取有 6 个 reservation Aggregate 各执行 210 次，市场有 3 个、远征有 1 个、Battle 有 2 个；该问题因此属于已复现的集合读取缺陷，而不是静态推测。

库存写事务必须继续直接锁定 holding，并在锁内重算活跃 reservation。读性能修复不得引入持久汇总、触发器、缓存、异步最终一致性或新的数据权威，也不得改变公共 DTO、排序、错误码、金额、库存等式、幂等和并发裁决。

## 决定

`inventory.quantity_read_model` 是非持久化、`security_invoker = true` 的内部视图。它从 holding 出发，按 `(user_id, template_id)` 一次左连接并聚合全部 `status = 'active'` reservation，用 `FILTER` 生成 `listed`、`expedition`、`minting` 和 `battling`，`trading` 固定为 0；`available` 固定为 `greatest(total - active_reserved, 0)`。字段唯一固定为 `user_id、template_id、total、available、listed、trading、expedition、minting、battling`。

`inventory.item_read_model` 是建立在数量读模型上的非持久化、`security_invoker = true` 内部视图。它一次连接 Catalog 模板、链、当前资源发布、缩略图和详情图对象，返回公共库存 DTO 的全部字段以及内部 `user_id`、`sort_order`、`market_price`。`inventory.present_item(inventory.item_read_model)` 只移除三个内部字段；`inventory.item_json(user_id, template_id)` 保留原签名并经该函数返回完全相同的公共 JSON。

`inventory.available_quantity(user_id, template_id)` 保留原签名并读取数量模型。`inventory.change_holding` 和 `inventory.reserve` 不读取视图，继续锁定 holding 行、在同一事务内直接重算活跃 reservation，并由 `inventory.reserve` 唯一写入 reservation。读取视图不参与权限、幂等、锁序或业务成功裁决。

`api.inventory_list` 在一次 `item_read_model` 扫描中同时聚合 items、template_count 和 total_quantity。`api.market_bootstrap` 的可出售藏品、`api.expedition_eligible_items`、`api.battle_team_options` 分别只扫描一次 item 读模型；`admin.battle_fixture_state` 只扫描一次数量读模型。每条批量查询都先按目标用户物化一次读模型，再执行稀有度、Battle 配置等领域过滤或连接，防止优化器按模板参数化视图并重新引入重复 Aggregate。可用数量为 0 的模板继续不进入这些批量候选；`inventory.item_json` 与库存详情仍为总数量大于 0 的模板返回完整占用明细。

活跃 reservation 索引唯一固定为 `(user_id, template_id, kind) INCLUDE (quantity) WHERE status = 'active'`，不保留重复索引。两个视图都位于未暴露的 `inventory` schema；安全 migration 显式撤销 `PUBLIC`、`anon`、`authenticated`、`service_role` 的内部 view 权限。Data API 继续只暴露 `api`，service role 只能调用既有 allowlist RPC。该权限设计遵循 [PostgreSQL 17 security-invoker view](https://www.postgresql.org/docs/17/sql-createview.html)。

## 失败与返回路径

任一新旧结果逐字段不一致、库存等式不成立、单模板条件没有下推到 holding 主键和活跃 reservation 部分索引、批量计划仍出现随 holding 数量增长的相关 SubPlan、库存列表中位执行时间或 shared buffers 未低于旧实现，均禁止提交和推送。修正必须继续落在声明式 schema 和原始 baseline，不得追加补丁 migration，并从空库重新验证。

推送后真实接口或权限出现回归时，必须对该提交执行精确 revert，使用回退后的三条原始 migration 重建真实开发数据库，并等待 GitHub 触发的自动部署恢复。

## 迁移与验收

本项目尚未正式生产上线，因此直接修改 `32_inventory.sql`、原始 baseline 和原始 `api_security` migration，product-data migration 保持字节不变。静态门禁必须强制两个 security-invoker view、部分覆盖索引、内部 view 撤权、五个集合消费者和两条写事务锁路径，并禁止批量消费者重新调用逐行 helper。

真实开发验收必须在回滚事务中覆盖空库存、无 reservation、同模板多条 reservation、四种 reservation 并存、released/consumed 不计入、available 为 0 但 total 大于 0、holding 为 0、完整 210 模板和目录排序；新旧结果逐字段使用 `IS NOT DISTINCT FROM` 比较，并验证 `total = available + listed + trading + expedition + minting + battling`。执行计划要求批量 active reservation Aggregate 的 `Actual Loops = 1`、无相关 SubPlan，单模板读取只访问目标用户和模板。性能判定按同一数据、预热后重复执行的中位执行时间与 shared buffers 完成，遵循 [Supabase Query Optimization](https://supabase.com/docs/guides/database/query-optimization)。
