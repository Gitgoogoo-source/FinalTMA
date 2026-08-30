# ADR-041：市场事务型供给读模型

- 状态：Accepted
- 日期：2026-08-08

## 背景

`market.my_listings` 曾按卖家聚合全部历史挂单来计算累计已售和预计金额；`market.bootstrap` 与 `market.template` 也直接聚合原始有效挂单。已售罄和已取消记录永久增长后，管理读取成本会随历史累计增长，且管理页面展示的历史聚合不属于当前产品规则。原始挂单又必须继续承担严格 FIFO、reservation、最终库存校验、余额、手续费、月卡返还和幂等结算，不能用缓存替代。

## 裁决

新增内部派生表 `market.seller_template_supply` 与 `market.template_supply`。前者以 `(seller_id, template_id)` 为主键保存该卖家该模板的有效剩余总量，归零删除且受三十种模板业务上限约束；后者以 `template_id` 为主键保存全部 `normal` 卖家的有效剩余总量，归零删除。

`market.listings` 的插入、删除及 `seller_id/template_id/remaining/status` 更新由 AFTER trigger 计算有效数量差值。差值更新先取得模板级事务 advisory lock，再对卖家和全市场汇总执行受正数约束保护的增减；缺失扣减、负数或键变更立即抛出完整性错误，使挂单、reservation、余额、成交事件和汇总共同回滚。operation 同键回放不重写挂单，因此不重复调整。

`identity.users.status` 在 `normal` 与 `banned` 间变化时保留原始挂单，并在同一事务按模板 ID 稳定顺序取得相同模板锁，从卖家汇总重算全市场供给。这样 banned 卖家立即从购买读取排除，解除封禁后又恢复其仍有效供给。

`api.market_bootstrap` 与 `api.market_template` 只按主键读取两级汇总，并从全市场数量减去当前用户数量；`api.market_my_listings` 最多读取当前卖家三十条汇总，新成交仍按 `(seller_id, sequence)` 游标每次最多读取 100 条。管理 DTO 和页面只保留藏品信息、`listed_quantity`、官方单价和下架动作；所有在售卡统一显示“出售中”，真实成交只由独立 SOLD 卡片表达。出售确认页的预计结算不变。

`market_create_listing` 在既有用户事务锁内通过卖家汇总行数裁决三十种模板上限，并按 [ADR-060](ADR-060-market-listing-quota.md) 在挂单插入事务内消耗成功上架次数。购买、下架、FIFO、最终库存、reservation、余额结算、手续费、月卡返还与幂等回放仍锁定原始挂单；两级汇总和上架配额绝不成为交易结算依据。

## 权限、恢复与监控

内部表、trigger helper 与 `market.rebuild_supply()` 均不进入 Data API，`public`、`anon`、`authenticated` 和 `service_role` 没有直接权限。重建函数只允许数据库 owner 在空库验收或事故维护窗口使用；它锁定用户、原始挂单和两张汇总表后从有效挂单完整重建。

`monitor-invariants` 只记录 `MARKET_SELLER_SUPPLY_MISMATCH` 与 `MARKET_TEMPLATE_SUPPLY_MISMATCH`，不在玩家请求中自动修复。前者比较原始有效挂单与卖家模板汇总，后者比较 `normal` 卖家汇总与全市场模板汇总。

## 迁移与验证

项目尚未正式生产上线，因此直接修改声明式 `50_market.sql`、`95_jobs.sql` 与原始 baseline migration，不新增补丁 migration，product-data migration 不变。架构门禁禁止三个读取 RPC 重新引用 `market.listings`、`market.trade_details` 或无游标成交历史，并禁止管理契约与 UI 恢复已删除聚合字段。

真实开发验收从空数据库连续应用 baseline、product data 和 security 三条迁移，覆盖上架、追加、三十种限制、每日和生命周期配额、FIFO、部分/全部成交、下架与购买并发、幂等回放、封禁切换、SOLD 游标、失败回滚和两项不变量。性能证据在同一当前供给下增加 100,000 条终态历史，比较三个读取结果、`EXPLAIN (ANALYZE, BUFFERS)`、读写耗时、shared buffers、死锁与超时；读取计划不得访问历史挂单或无界成交聚合。
