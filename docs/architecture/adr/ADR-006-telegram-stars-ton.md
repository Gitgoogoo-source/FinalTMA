# ADR-006：Telegram、Stars 与 TON

## 决定

Telegram webhook 使用 secret token 认证，并以 `update_id` 去重。Stars 商品只使用 XTR。订单创建完成即结束创建命令；付款订单独立经历 `pending`、`processing`、`paid` 与终态。预结账在数据库内原子校验并记录唯一 `pre_checkout_query_id` 和已验证付款人 Telegram ID；付款人必须是订单所属账号本人，否则预结账零写入拒绝。只有付款人身份在预结账与 `successful_payment` 两阶段都一致时才能交付，Telegram charge ID 和 K-coin 充值账本 reference 保持唯一。

K-coin 的 `pending` 未付款订单可随时取消或由下一笔创建原子替换，不形成充值冷却；VIP 的 `pending` 未付款订单在 Telegram 返回 `cancelled` 时通过 VIP 专属幂等 RPC 原子取消并恢复购买或续费入口。两类订单的 `processing` 与 `paid` 均不可由用户取消。客户端取消、失败、超时和乱序结果均不能否定付款人身份一致的迟到 `successful_payment`。成功回调付款人缺失或不一致时，第一次 charge 原子绑定到订单并进入 `payment_identity_conflict`：不交付 K-coin/VIP、不形成首充或奖励、不自动退款，重复回调保持同一结果并引导用户通过 `/paysupport` 外部入口处理。平台后续真实退款仍按退款 ID 和 charge ID 去重并原子执行风控，同时保留冲突历史。完整约束见 [ADR-032](ADR-032-stars-payer-identity-binding.md)。

TON 钱包通过服务端 challenge 和 `ton_proof` 验证，一个地址只能属于一个账号。Mint 使用 reserve、submit、reconcile、complete/cancel 状态机；链上确认是最终事实，metadata 在成功时冻结为不可变快照。

当前启用 Telegram 身份、Stars 支付和顶部 TON 钱包连接及验证。钱包接入与数据库归属保护见 [ADR-099](ADR-099-ton-wallet-connection.md)。Mint、对应奖励任务、Mint Web 路由、Mint 前端恢复和对账调度继续休眠。
