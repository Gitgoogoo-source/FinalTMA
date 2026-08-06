# ADR-005：未知结果恢复

## 决定

操作具有 `pending`、`succeeded`、`failed`、`unknown` 四个持久状态。同步业务在提交事务内形成终态；支付和 Mint 允许由外部事实推进。随机结果在第一次裁决时持久化，不得重新生成。

前端只在用户完成领域确认后生成并保存 UUID，随后立即进入 `confirming`，下一帧进入 `submitting`，但不提前宣告业务成功。网络中断只进入 `unknown`，恢复只查询原操作。默认只锁定同一 `use_case` 的再次提交；`gacha.open` 与 `wheel.spin` 从 `confirming` 开始禁用本领域操作按钮和五个底部导航，经过 `submitting`、`pending`、`unknown` 持续锁定，并在服务端成功或失败结果弹窗中保持锁定，直到用户通过弹窗规定动作处理结果。`inventory.evolve` 从 `confirming` 到 `unknown` 锁定新进化提交和五个底部导航，终态由覆盖界面的专用弹窗处理。弹窗内的结果处理和原操作查询按钮不被这些锁禁用。`me/bootstrap` 返回阻塞操作、待处理支付和 Mint，以便重新进入后继续恢复。

`market.create_listing` 已取得服务端成功结果但尚未完成路由 refresh scope 时，继续保持 `submitting` 并显示玩家可理解的出售状态更新反馈。出售、管理、购买和藏品查询返回最新权威状态后才进入 `succeeded`，因此玩家能关闭成功结果时，管理页必须已可展示新挂单。

开盒和转盘终态都不使用 `result_acknowledged_at`，也不存在结果确认 API 或 RPC。`api.gacha_open` 和 `api.wheel_spin` 的原子终态已完成全部业务写入；它们的“确定”只改变当前 Web 内存展示，不发送 API、RPC、原操作查询或权威刷新。开盒 `pending`、`unknown` 只在同一前台运行期查询原 `operation_id`；离开后丢弃召唤结果与未决展示，不把 `gacha.open` 注入统一恢复。转盘 `pending`、`unknown` 仍进入 `identity.bootstrap.blocking_operations` 和 `GET /api/operations/recoverable`，但恢复注入时固定不具有终态展示资格；取得终态后只刷新权威状态并静默移除锁。转盘 `succeeded`、`failed` 不进入这两个恢复入口，隐藏、Telegram `deactivated`、`pagehide`、刷新、关闭或重新进入都不恢复旧结果。进化终态继续使用服务端 `result_acknowledged_at` 和专用确认 RPC。统一发现不接收前端指定的用户、用例或结果筛选，只在页面可见、Telegram 激活且在线时运行，恢复队列存在时暂停，队列清空时立即再追赶。浏览器持久存储不保存或裁决随机结果及资产结果事实。

进化复用同一服务端结果回执列，但只通过进化专用 RPC 确认 `inventory.evolve` 终态。统一发现查询返回晚于首屏快照提交的未确认进化原操作；成功、随机失败和前置拒绝均在用户执行结果弹窗动作后确认。当前会话直接取得进化终态时，结算后完成第一次权威 refresh scope；该刷新成功后，结果确认只写入回执并导航，不重复刷新同一范围。进化操作由恢复链路取得，或第一次权威刷新失败时，结果确认后补做一次权威刷新。第一次刷新成功标记只存在于当前 session generation 的内存中，不参与业务裁决。共享操作注册中心通过独立的进化展示组件、NEW 集成函数和统一发现 Hook 扩展，不复制进化业务字段或结算规则。

操作注册中心只对 `succeeded` 且通过原命令输出 Schema 校验的结果开放对应业务视图。开盒、转盘与进化分别使用领域专用结果组件，只消费各自服务端持久结果；开盒和转盘业务视图仅允许本次前台运行期取得的结果，启动注入固定忽略 `gacha.open` 和转盘终态。恢复注入的转盘未决操作取得终态后不开放业务视图。进化的随机失败是已完成结算，仍使用 `inventory.evolve` 的完整输出 Schema，前置拒绝则使用持久错误码与拒绝快照。其余操作继续使用通用状态弹窗，`pending`、`unknown`、Schema 不完整的成功结果不得进入成功视图；持久成功结果的 Schema 不完整时只查询原操作，在完整结果恢复前禁止确认。

已确认展示的进化终态保留 30 天；非终态操作与未确认展示的进化终态不得清理。开盒和转盘没有展示确认状态，终态 operation 均按通用 30 天规则保留。
