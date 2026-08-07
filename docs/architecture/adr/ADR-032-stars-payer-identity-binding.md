# ADR-032：Telegram Stars 付款人与订单账号绑定

## 结论

FinalTMA 禁止 Telegram Stars 代付与赠送。每笔 K-coin 或 VIP 订单都只允许订单所属账号本人付款；Telegram 预结账请求中的付款人 Telegram ID 必须等于订单所属用户的 Telegram ID。

预结账在同一数据库事务内锁定订单与用户，先核对 invoice payload、Stars 金额、订单开放状态、有效期、账号状态和付款人身份，再记录唯一 `pre_checkout_query_id`、`verified_payer_telegram_id` 与结账开始时间。付款人不一致时直接返回拒绝，不能改变订单、operation、资产、权益、任务、邀请、账本或审计业务状态；同一预结账请求只有在 query ID 与已记录付款人同时一致时才能幂等重放成功。

`successful_payment` 到达后，数据库同时核对预结账阶段保存的付款人和消息付款人。消息付款人缺失或不一致时，第一次 Telegram charge 仍原子绑定到原订单，但订单进入不可交付终态 `payment_identity_conflict`，记录冲突时间和内部原因；不得增加 K-coin、开通或续费 VIP、形成首次有效充值、发放 500 Fgems、推进 5/10 人阶梯、写入交付账本或自动退款。该终态重复回调只返回同一结果，不能重新进入 `paid` 或 `delivered`。平台以后确实发送与该 charge 对应的退款通知时，订单可转为 `refunded`，但保留付款身份冲突历史。

玩家接口只公开订单状态和既有非敏感字段，不公开付款人 Telegram ID、charge ID、冲突内部原因或订单所属身份。K-coin 与 VIP 界面收到该终态时展示“支付身份校验异常”和“本次未到账，请前往支付助手发送 /paysupport”，不显示项目内客服、工单、订单查询或申诉入口，也不自动退款。

## 原子性与幂等

- `payments.orders` 的状态约束保证冲突终态必须已经记录预结账付款人、charge、付款时间、冲突时间和原因，且不存在交付时间。
- `payment_begin_checkout` 在持有订单和用户行锁时完成身份比较与状态转换；身份拒绝路径零写入。
- `payment_apply_success` 以 Telegram update ID 去重，以 charge ID 唯一绑定订单，并在同一事务内决定交付或冲突终态。
- `payments.deliver` 只接受 `paid`，显式拒绝 `payment_identity_conflict`；首充、邀请奖励与 VIP/K-coin 交付只能从该函数发生。
- 订单清理、对账、后台夹具与开放订单索引都把冲突视为终态，不能过期、替换、补发或再次交付。

## 观测与复核

运行日志只记录低基数字段和阶段结果，不记录 Telegram ID、charge、invoice payload、订单 ID、operation ID、token 或完整 webhook。数据库不变量检查用于发现冲突订单出现交付时间、K-coin 充值账本或邀请奖励关联的不可达状态。
