# 第五阶段监控指标

本文件定义第 16 步“监控”的仓库内落地口径。当前原监控接口已删除，监控数据应通过服务端日志、定时任务输出或后续独立监控系统汇总。

## 数据源

| 指标          | 数据源                             | 关键字段                                                |
| ------------- | ---------------------------------- | ------------------------------------------------------- |
| 支付失败率    | `payments.star_orders`             | `status`、`created_at`、`error_message`                 |
| 发货失败率    | `payments.star_orders`             | `status`、`paid_at`、`fulfilled_at`、`error_message`    |
| Webhook 延迟  | `payments.telegram_webhook_events` | `process_status`、`created_at`、`processed_at`          |
| Mint 卡住数量 | `onchain.mint_queue`               | `status`、`updated_at`、`attempt_count`、`max_attempts` |

接口只读上述表，不修改订单、队列、账本或风险记录。

## 默认窗口和阈值

| 项目             | 默认值  | 说明                                                            |
| ---------------- | ------- | --------------------------------------------------------------- |
| 观察窗口         | 24 小时 | 后续监控系统可切换 1 小时、6 小时、24 小时、72 小时、7 天。     |
| Webhook 卡住阈值 | 5 分钟  | `received` / `processing` 超过该时间未完成视为卡住。            |
| 发货卡住阈值     | 10 分钟 | `paid` / `fulfilling` 且 `paid_at` 超过该时间仍未完成视为卡住。 |
| Mint 卡住阈值    | 30 分钟 | active Mint 状态的 `updated_at` 超过该时间未推进视为卡住。      |

## 指标口径

### 支付失败率

窗口内 `payments.star_orders` 中，状态为 `failed`、`cancelled`、`expired`、
`refunded`、`disputed` 的订单数，除以窗口内支付订单总数。

告警级别：

- `ok`：低于 2%。
- `warning`：大于等于 2%，低于 5%。
- `critical`：大于等于 5%。

### 发货失败率

窗口内已进入支付生命周期的订单中，状态为 `failed` / `disputed`，或存在
`error_message` 且没有 `fulfilled_at` 的订单数，除以已支付生命周期订单数。

已支付生命周期包括：`paid`、`fulfilling`、`fulfilled`、`failed`、`refunded`、
`disputed`，以及 `paid_at` 不为空的订单。

告警级别：

- `ok`：低于 0.5%，且没有卡住发货订单。
- `warning`：大于等于 0.5%，低于 2%。
- `critical`：大于等于 2%，或存在超过 10 分钟仍停在 `paid` / `fulfilling` 的订单。

### Webhook 延迟

窗口内已处理 webhook 的 `processed_at - created_at`，监控系统展示 p95、平均值和最大值。
同时统计当前 `received` / `processing` 的未完成事件数。

告警级别：

- `ok`：p95 低于 15 秒，且没有卡住事件。
- `warning`：p95 大于等于 15 秒，低于 60 秒。
- `critical`：p95 大于等于 60 秒，或存在超过 5 分钟未处理完成的 webhook。

### Mint 卡住数量

当前 `onchain.mint_queue` 中，状态为 `queued`、`processing`、`submitted`、
`confirming`、`retrying` 且 `updated_at` 超过 30 分钟未推进的队列数量。

告警级别：

- `ok`：0 条。
- `warning`：1 到 4 条。
- `critical`：5 条及以上。

## 排查入口

| 异常              | 首先查看                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| 支付失败率升高    | Vercel logs、`payments.star_orders.error_message`                       |
| 发货失败率升高    | `api.gacha_process_paid_order` 返回、Supabase logs                      |
| Webhook 延迟升高  | `payments.telegram_webhook_events`、Vercel `/api/telegram/webhook` logs |
| Mint 卡住数量升高 | Mint worker logs、`onchain.transactions`                                |

## 回滚联动

监控进入 `critical` 后，优先关闭新请求，不删除历史数据：

- 支付异常：关闭 `FEATURE_STARS_PAYMENT_ENABLED`。
- 发货异常：关闭 `FEATURE_PAYMENT_WEBHOOK_FULFILLMENT_ENABLED`，已支付订单继续保留补发入口。
- Mint 异常：关闭 `FEATURE_TON_MINT_ENABLED` 和服务端 `TON_MINT_ENABLED`。
- Market 异常：关闭对应 market feature flag。

不得通过直接修改 `currency_ledger` 历史数据处理告警。
