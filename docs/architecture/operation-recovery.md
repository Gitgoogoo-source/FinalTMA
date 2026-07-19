# 操作恢复

用户确认写操作时，操作注册中心先生成 UUID 并写入内存记录，再在下一动画帧提交请求。同一操作的会话恢复重试和结果查询始终复用该 UUID。

网络失败不会创建新操作，也不会展示业务成功。`unknown`、`pending` 通过 `GET /api/operations/:operation_id` 查询；恢复成功时，`use_case` 对应的原命令输出 Schema 会重新校验 `result`，随后按该路由声明的 refresh scope 刷新真实状态。

重新进入应用时，`identity.bootstrap.blocking_operations` 交给操作恢复工作流，`pending_payments` 和 `pending_mints` 分别交给支付与 Mint 恢复工作流。Stars 恢复按订单类型分别打开 K-coin 或 VIP 界面；支付窗口返回只查询一次，之后仅在重新进入、切回对应页面或手动刷新时查询，不持续轮询。充值订单交付后，只恢复开盒、市场购买或转盘的确认界面，不自动执行原业务。
