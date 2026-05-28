# Telegram Stars 支付与 Webhook

## pre_checkout_query

`/api/telegram/webhook` 现在处理 Telegram Stars 的 `pre_checkout_query`：

1. 只允许 `POST`。
2. 校验 `X-Telegram-Bot-Api-Secret-Token`，服务端读取 `TELEGRAM_WEBHOOK_SECRET` 或兼容的 `TELEGRAM_WEBHOOK_SECRET_TOKEN`。
3. 解析 Telegram update，当前处理 `pre_checkout_query` 和 `successful_payment`；其他 update 暂时返回 ignored。
4. 调用 `api.payment_mark_precheckout_checked`，先写入 `payments.telegram_webhook_events`，再在数据库事务里校验订单。
5. 根据 RPC 返回结果调用 Telegram Bot API `answerPreCheckoutQuery`。

RPC 校验内容：

- `payments.star_orders.telegram_invoice_payload` 能找到订单。
- Telegram `pre_checkout_query.from.id` 必须匹配订单用户的 `core.users.telegram_user_id`。
- `currency` 必须是 `XTR`。
- Telegram `total_amount` 必须等于 `star_orders.xtr_amount` 和 `gacha.draw_orders.total_price_stars`。
- `star_orders.status` 必须仍处于可支付状态：`created`、`invoice_created`、`precheckout_ok`、`precheckout_checked`。
- 订单未过期。
- 关联 `gacha.draw_orders` 仍可支付。
- 盲盒仍为 `active`，并且未超出开始 / 结束时间窗口。
- 盲盒剩余库存必须能覆盖本次 `draw_count`。

`pre_checkout_query` 只会把 `payments.star_orders.status` 标记为 `precheckout_checked`，不会发货，不会写入 `gacha.draw_results`，也不会写 `currency_ledger`。发货只能在后续 `successful_payment` webhook 通过后执行。

重复 `update_id` 会复用 `payments.telegram_webhook_events.update_id` 的唯一约束返回幂等结果，不会创建新的 webhook event，也不会重复推进订单。如果数据库校验已通过但调用 Telegram `answerPreCheckoutQuery` 失败，后续同一 `update_id` 重试会重新校验订单并再次尝试确认。

## successful_payment

`/api/telegram/webhook` 收到 Telegram `successful_payment` 后会先校验 webhook secret，再调用 `api.payment_record_successful_payment`。这个 RPC 只负责第 06 步的支付流水落库和幂等，不执行开盒发货；后续发货由下一步通过 `api.gacha_process_paid_order` 处理。

处理流程：

1. 原始 Telegram update 写入 `payments.telegram_webhook_events.payload`。
2. `update_id` 使用 `payments.telegram_webhook_events.update_id` 唯一约束防重复事件。
3. 通过 `invoice_payload` 查找 `payments.star_orders.telegram_invoice_payload`。
4. 校验 Telegram 用户、`currency='XTR'`、支付金额和订单状态。
5. 使用 `payments.star_payments.telegram_payment_charge_id` 唯一约束写入支付流水。
6. 支付流水写入成功后，将 `payments.star_orders.status` 标记为 `paid`。

异常记录规则：

- 金额不一致返回 `AMOUNT_MISMATCH`，webhook event 标记为 `failed`，可支付订单标记为 `failed`，不会写入 `star_payments`。
- payload 找不到订单返回 `ORDER_NOT_FOUND`，webhook event 标记为 `failed`，不会写入 `star_payments`。
- charge id 已绑定到其他订单返回 `PAYMENT_CHARGE_CONFLICT`，webhook event 标记为 `failed`。
- 已 fulfilled 订单如果收到新的 charge id，返回 `ORDER_ALREADY_FULFILLED`，不会新增支付流水。
- 已记录过的相同 charge id 会返回成功响应，webhook event 标记为 `ignored`，不会重复写支付流水，也不会触发重复发货。

审计查询位置：

- `payments.star_payments`：查询 `star_order_id`、`telegram_payment_charge_id`、`xtr_amount`、`currency`、`invoice_payload`、`raw_update`。
- `payments.telegram_webhook_events`：查询 `event_type`、`process_status`、`invoice_payload`、`payload`、`processed_at`、`error_message`、`request_headers_hash`、`webhook_secret_verified`。
- `payments.star_orders`：查询订单状态是否从 `precheckout_checked` 转为 `paid`，或在异常时转为 `failed`。

第 06 步验收边界：`successful_payment` 落库后不会创建 `gacha.draw_results`，不会写 `inventory.item_instances`，不会写 `economy.currency_ledger`。这些资产交付动作必须等待第 07 步发货事务。
