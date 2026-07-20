# 操作恢复

用户确认写操作时，操作注册中心先生成 UUID 并写入内存记录，再在下一动画帧提交请求。同一操作的会话恢复重试和结果查询始终复用该 UUID。

网络失败不会展示业务成功。`unknown`、`pending` 通过 `GET /api/operations/:operation_id` 查询；只有明确返回 `OPERATION_NOT_FOUND` 时才用原 UUID 单次重提。恢复成功时，`use_case` 对应的原命令输出 Schema 会重新校验 `result`，随后按该路由声明的 refresh scope 刷新真实状态。入口交接未完成时，该查询只能读取当前用户的原 `referral.bind` 操作。

重新进入应用时，`identity.bootstrap.blocking_operations` 交给操作恢复工作流，`pending_payments` 和 `pending_mints` 分别交给支付与 Mint 恢复工作流。开盒的 `pending`、`unknown` 以及尚未确认展示的 `succeeded`、`failed` 都进入 `blocking_operations`；前端同时通过 `GET /api/gacha/recovery` 按 1 秒、2 秒、3 秒、5 秒、此后每 30 秒发现事务提交晚于首屏读取的原开盒操作，发现后停止发现轮询并只按原 `operation_id` 查询终态。K-coin 创建订单命令在 invoice URL 持久化后立即完成，不作为长期阻塞操作；未提交 Stars 的 `pending` K-coin 订单不恢复、不打开弹窗。只有 `processing`、`paid` K-coin 订单恢复锁定弹窗，并按 1 秒、2 秒、3 秒、此后每 5 秒查询唯一终态；VIP 继续使用自身既有恢复交互。充值订单交付后，只恢复开盒、市场购买或转盘的确认界面，不自动执行原业务。

操作弹窗先按 `use_case` 选择展示组件，再校验该命令的唯一输出 Schema。`gacha.open` 只有在持久状态为 `succeeded` 且完整结果通过合约校验时才展示开盒专用结果；组件直接呈现服务端返回的有序藏品、消耗和保底事实，并保留通用操作号与恢复能力。未确认、失败或结果结构不完整时不展示任何开盒成功内容。专用弹窗的字段和动作不在架构文档重复定义，唯一引用产品主文档第 14.4.6 节。

结果关闭、再次开盒或前往藏品页之前，前端必须先调用 `POST /api/gacha/results/:operation_id/acknowledge`；数据库只允许当前用户确认自己的开盒终态，并以首次确认时间幂等落库。确认响应丢失时弹窗保持打开并允许重试；确认完成后启动与恢复查询都不再返回该结果。前端内存和浏览器存储都不充当结果或确认事实来源。

每日幂等清理不得删除尚未确认展示的开盒终态；确认完成后，该操作才按通用终态规则在创建满 30 天后清理。

每条前端操作记录绑定创建时的 session generation。会话过期、被替换或重新登录时先切换 generation，再清空全局操作、导航和查询状态；封禁时同时先切换为 `banned` 和新 generation。旧 generation 的请求、查询、动画及恢复结果全部丢弃。自然过期的并发请求共享一次认证交换，恢复只允许一次；新会话为 `pending` 时只继续邀请交接，不自动重做首屏或资产业务。

`gacha.open` 的操作记录同时是开盒全局交互锁的唯一前端事实。记录在 `confirming`、`submitting`、`pending`、`unknown` 阶段锁定单抽、十连和全部底部导航；服务端结果进入 `succeeded` 或 `failed` 后，记录保留至用户通过真实结果弹窗处理结果，因此同一把锁不会在弹窗背景上提前释放。结果弹窗按钮、原操作查询和待确认操作恢复入口始终保持可操作。
