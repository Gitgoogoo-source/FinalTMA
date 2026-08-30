# ADR-097：市场单次购买上限与有界 FIFO 结算

- 状态：已接受
- 日期：2026-08-30

## 背景

`market.purchase` 原契约只要求正整数，数据库 `api.market_purchase` 又在判断库存是否足够前锁定同模板全部有效挂单。普通认证玩家因此可以提交远大于业务需要的数量，让最终必然失败的一次请求锁住完整合格订单簿。余额不足流程会把相同数量写入市场充值补差意图，充值恢复还会从 URL 重新带回数量；只修改购买按钮、普通购买契约或单个 RPC 都会留下旁路。

市场继续采用官方固定单价、严格 FIFO、整笔成功或整笔失败、原 operation 幂等、数据库事务原子结算。不得为降低锁等待改成 `SKIP LOCKED`，因为跳过最早挂单会改变卖家成交顺序。

## 唯一结论

单次市场购买数量固定为 `1..100`。`packages/api-contracts` 导出唯一 TypeScript 常量 `MARKET_PURCHASE_MAX_QUANTITY = 100` 和对应 Zod Schema；普通市场购买输入、购买结果、成交明细、市场充值补差意图与 Web 购买界面共同使用该策略。OpenAPI 必须生成相同的 `maximum: 100`。

Web 购买确认弹窗的最大值为 `min(当前可购买数量, 100)`。当前库存大于 100 时显示“单次最多购买 100 个”；加号达到上限后立即禁用。充值到账后的恢复购买和 URL 数量解析最多恢复 100，不自动成交；出售数量不受本规则影响。前端限制只提供即时体验，不能替代 API 与数据库裁决。

数据库在非暴露 `market` schema 中定义只返回 `100` 的 `market.purchase_quantity_limit()`，撤销 `PUBLIC`、`anon`、`authenticated` 与 `service_role` 的直接执行权。`api.market_purchase` 保留 `begin_command` 和已完成 operation 回放顺序；新请求在模板读取、价格计算或挂单锁之前重新验证 `1..100`。同一模板的购买使用独立事务 advisory lock 串行取得 FIFO 候选，随后按 `(created_at, id)` 只选择并锁定最前面的 `p_quantity` 条有效原始挂单，因此一次请求最多锁 100 行。

候选锁定后重新汇总真实剩余数量；不足时返回既有 `MARKET_STOCK_INSUFFICIENT`，不扣余额、不创建交易、不改变挂单、reservation、holding、账本、图鉴、任务或成交提醒。库存足够时，扣款和结算只遍历已经锁定的候选 ID，不再查询完整订单簿；循环结束必须断言剩余待成交数量为零，否则整个内层事务回滚。手续费、VIP 返还、卖家稳定锁序、每卖家唯一 SOLD 事件和买家最终 holding 继续沿用现有规则。

`api.topup_create_order` 在把 JSON 数量转换为 PostgreSQL `integer` 之前，先验证它是规范整数且位于 `1..100`；非法值返回既有 `TOPUP_AMOUNT_INVALID`，不创建支付订单。合法市场意图只保存规范化的 `kind`、模板 ID 和数量，避免替代 JSON 表示绕过后续恢复边界。

## 数据与兼容性

本次不修改官方单价、手续费、VIP 返还、挂单数量、每账号上架配额、部分挂单成交方式、余额不足补差金额或任务规则。已经完成的同键同请求继续回放原结果；同键换数量继续返回 `IDEMPOTENCY_KEY_REUSED`。新的 HTTP 数量 `0` 或 `101` 在进入 handler 前返回 `REQUEST_INVALID`；service-role 直接调用 RPC 时仍由数据库第二道边界拒绝。

项目尚无已发布生产 migration，声明式 `50_market.sql`、`60_payments.sql` 与原始 baseline 必须形成同一干净最终定义，不追加修补 migration。真实开发数据库从空库重建，因此既有开发 payment intent 与 operation 数据不迁移；未来生产只使用已经完成验证的同一 migration 序列。

## 验收

静态门禁必须证明 TypeScript 策略值为 100，普通购买和充值 intent 共用数量 Schema，Web 使用同一常量，数据库在锁前复核上限，并且结算只访问候选 ID。OpenAPI、声明式 schema 和 baseline 必须同步。

真实开发环境验证数量 `1` 与 `100` 的正常成交、`0` 与 `101` 的拒绝、库存不足、同键回放、同键异请求、多卖家 FIFO、购买与下架并发，以及充值 intent `101` 不创建订单。准备至少 101 条单件挂单时，锁住第 101 条不得阻塞购买 100；锁住第 1 条时购买必须等待该最早挂单，不能跳到第 2 条。数据库证据必须证明一次购买最多锁 100 条挂单，失败事务没有任何资产或业务副作用。

同一 deployment SHA 的真实 iPhone Telegram 与 Safari Web Inspector 必须验证库存大于 100 和小于 100 两种弹窗、加减按钮、余额不足充值与到账恢复；Network 中的 `market.purchase` 数量始终不超过 100，页面不显示服务器、RPC、请求或其他技术文案。
