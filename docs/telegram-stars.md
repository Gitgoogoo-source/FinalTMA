# Telegram Stars 支付与 Webhook

## pre_checkout_query

`/api/telegram/webhook` 现在处理 Telegram Stars 的 `pre_checkout_query`：

1. 只允许 `POST`。
2. 校验 `X-Telegram-Bot-Api-Secret-Token`，服务端读取 `TELEGRAM_WEBHOOK_SECRET` 或兼容的 `TELEGRAM_WEBHOOK_SECRET_TOKEN`。
3. 解析 Telegram update，当前只处理 `pre_checkout_query`；其他 update 暂时返回 ignored，后续 `successful_payment` 步骤会继续扩展。
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
