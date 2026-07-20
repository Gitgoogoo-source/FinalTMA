# 操作恢复

用户确认写操作时，操作注册中心先生成 UUID 并写入内存记录，再在下一动画帧提交请求。同一操作的会话恢复重试和结果查询始终复用该 UUID。

网络失败不会展示业务成功。`unknown`、`pending` 通过 `GET /api/operations/:operation_id` 查询；只有明确返回 `OPERATION_NOT_FOUND` 时才用原 UUID 单次重提。恢复成功时，`use_case` 对应的原命令输出 Schema 会重新校验 `result`，随后按该路由声明的 refresh scope 刷新真实状态。入口交接未完成时，该查询只能读取当前用户的原 `referral.bind` 操作。

重新进入应用时，`identity.bootstrap.blocking_operations` 交给操作恢复工作流，`pending_payments` 和 `pending_mints` 分别交给支付与 Mint 恢复工作流。Stars 恢复按订单类型分别打开 K-coin 或 VIP 界面；支付窗口返回只查询一次，之后仅在重新进入、切回对应页面或手动刷新时查询，不持续轮询。充值订单交付后，只恢复开盒、市场购买或转盘的确认界面，不自动执行原业务。

每条前端操作记录绑定创建时的 session generation。会话过期、被替换或重新登录时先切换 generation，再清空全局操作、导航和查询状态；封禁时同时先切换为 `banned` 和新 generation。旧 generation 的请求、查询、动画及恢复结果全部丢弃。自然过期的并发请求共享一次认证交换，恢复只允许一次；新会话为 `pending` 时只继续邀请交接，不自动重做首屏或资产业务。
