# 操作恢复

用户确认写操作时，操作注册中心先生成 UUID 并写入内存记录，再在下一动画帧提交请求。同一操作的会话恢复重试和结果查询始终复用该 UUID。

网络失败不会展示业务成功。`unknown`、`pending` 通过 `GET /api/operations/:operation_id` 查询；只有明确返回 `OPERATION_NOT_FOUND` 时才用原 UUID 单次重提。恢复成功时，`use_case` 对应的原命令输出 Schema 会重新校验 `result`，随后按该路由声明的 refresh scope 刷新真实状态。入口交接未完成时，该查询只能读取当前用户的原 `referral.bind` 操作。

重新进入应用时，`identity.bootstrap.blocking_operations` 交给操作恢复工作流，`pending_payments` 和 `pending_mints` 分别交给支付与 Mint 恢复工作流。开盒、幸运转盘与进化的 `pending`、`unknown` 以及尚未确认展示的 `succeeded`、`failed` 都进入 `blocking_operations`；前端分别通过 `GET /api/gacha/recovery`、`GET /api/wheel/recovery` 与 `GET /api/inventory/evolution/recovery` 使用同一通用发现 Hook，按 1 秒、2 秒、3 秒、5 秒、此后每 30 秒发现事务提交晚于首屏读取的原操作，发现后停止对应发现轮询并只按原 `operation_id` 查询终态。K-coin 创建订单命令在 invoice URL 持久化后立即完成，不作为长期阻塞操作；未提交 Stars 的 `pending` K-coin 订单不恢复、不打开弹窗。只有 `processing`、`paid` K-coin 订单恢复锁定弹窗，并按 1 秒、2 秒、3 秒、此后每 5 秒查询唯一终态；VIP 继续使用自身既有恢复交互。充值订单交付后，只恢复开盒、市场购买或转盘的确认界面，不自动执行原业务。

操作弹窗先按 `use_case` 选择展示组件，再校验该命令的唯一输出 Schema。`gacha.open`、`wheel.spin` 与 `inventory.evolve` 的展示组件位于操作恢复工作流，`OperationRegistryProvider` 只负责编排阶段、原操作查询、导航锁、刷新范围和服务端结果回执；领域组件直接消费持久结果，不在注册中心复制结果字段。开盒、转盘和进化只有在持久状态为 `succeeded` 且完整结果通过各自命令输出 Schema 校验时才展示对应业务内容；进化的随机失败仍是已完成结算，使用同一完整输出 Schema，前置拒绝则使用持久错误码和拒绝快照展示。Schema 不完整的成功结果只查询原操作且不得确认。专用弹窗的字段与动作唯一引用产品主文档第 14.4.6、4.3.6 和 18.6 节。

开盒结果关闭、再次开盒或前往藏品页之前，前端调用 `POST /api/gacha/results/:operation_id/acknowledge`；转盘结果关闭前调用 `POST /api/wheel/results/:operation_id/acknowledge`；进化成功、随机失败或拒绝结果执行规定动作前调用 `POST /api/inventory/evolution/results/:operation_id/acknowledge`。数据库只允许当前用户确认匹配固定 `use_case` 的本人终态，并以首次确认时间幂等落库。确认响应丢失时弹窗保持打开并允许重试；确认完成后启动与领域恢复查询都不再返回该结果。前端内存和浏览器存储都不充当结果或确认事实来源。

`album.claim` 成功且结果通过该命令输出 Schema 校验时展示图鉴奖励专用结果，包含服务端返回的链条名称、真实 Fgems 奖励和操作号；确认前不提前显示奖励。图鉴是脱离主壳层的全屏页面，因此页面自身消费 `identity.bootstrap.blocking_operations` 并注入同一操作注册中心，网络中断后只查询原 `operation_id`。成功、失败或未知恢复都会按 `album.claim` 声明的资产与图鉴刷新范围重新读取 `album.get` 和顶部资产事实，不从临时弹窗状态重放领取。

每日幂等清理不得删除尚未确认展示的开盒、转盘或进化终态；确认完成后，该操作才按通用终态规则在创建满 30 天后清理。

每条前端操作记录绑定创建时的 session generation。会话过期、被替换或重新登录时先切换 generation，再清空全局操作、导航和查询状态；封禁时同时先切换为 `banned` 和新 generation。旧 generation 的请求、查询、动画及恢复结果全部丢弃。自然过期的并发请求共享一次认证交换，恢复只允许一次；新会话为 `pending` 时只继续邀请交接，不自动重做首屏或资产业务。

`gacha.open` 与 `wheel.spin` 的操作记录分别是开盒和转盘全局交互锁的唯一前端事实。记录在 `confirming`、`submitting`、`pending`、`unknown` 阶段锁定本领域按钮和全部底部导航；服务端结果进入 `succeeded` 或 `failed` 后，记录保留至用户通过真实结果弹窗处理结果，因此同一把锁不会在弹窗背景上提前释放。结果弹窗按钮、原操作查询和待确认操作恢复入口始终保持可操作。

`inventory.evolve` 在 `confirming`、`submitting`、`pending`、`unknown` 阶段锁定新的进化提交和全部底部导航；`pending` 与 `unknown` 只能查询原 `operation_id`，不得生成新幂等键。服务端终态通过进化专用结果组件展示；成功目标无论是否重复获得都写入当前 session generation 的 NEW 集合，查看该目标藏品详情后清除。完全重启不额外恢复已确认结果的 NEW；若重启恢复的是尚未确认展示的原成功结果，则该结果再次把目标写入新运行期的 NEW 集合。
