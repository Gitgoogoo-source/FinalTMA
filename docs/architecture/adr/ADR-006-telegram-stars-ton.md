# ADR-006：Telegram、Stars 与 TON

## 决定

Telegram webhook 使用 secret token 认证，并以 `update_id` 去重。Stars 商品只使用 XTR。订单创建完成即结束创建命令；付款订单独立经历 `pending`、`processing`、`paid` 与终态。预结账在数据库内原子校验并记录唯一 `pre_checkout_query_id`；只有 `successful_payment` 能交付，Telegram charge ID 和 K-coin 充值账本 reference 保持唯一。

K-coin 的 `pending` 未付款订单可随时取消或由下一笔创建原子替换，不形成充值冷却；VIP 的 `pending` 未付款订单在 Telegram 返回 `cancelled` 时通过 VIP 专属幂等 RPC 原子取消并恢复购买或续费入口。两类订单的 `processing` 与 `paid` 均不可由用户取消。客户端取消、失败、超时和乱序结果均不能否定后续真实 `successful_payment`，真实扣款必须一次且仅一次交付。退款以退款 ID 和 charge ID 去重并原子执行风控。

TON 钱包通过服务端 challenge 和 `ton_proof` 验证，一个地址只能属于一个账号。Mint 使用 reserve、submit、reconcile、complete/cancel 状态机；链上确认是最终事实，metadata 在成功时冻结为不可变快照。
