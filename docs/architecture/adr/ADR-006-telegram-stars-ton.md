# ADR-006：Telegram、Stars 与 TON

## 决定

Telegram webhook 使用 secret token 认证，并以 `update_id` 去重。Stars 商品只使用 XTR；预结账重新校验订单，只有 `successful_payment` 能交付，Telegram charge ID 保持唯一。退款以退款 ID 和 charge ID 去重并原子执行风控。

TON 钱包通过服务端 challenge 和 `ton_proof` 验证，一个地址只能属于一个账号。Mint 使用 reserve、submit、reconcile、complete/cancel 状态机；链上确认是最终事实，metadata 在成功时冻结为不可变快照。
