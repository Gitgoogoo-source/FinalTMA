# 操作恢复

用户确认会创建 operation 的写操作时，操作注册中心先生成 UUID 并写入内存记录，再在下一动画帧提交请求。同一 operation 的会话恢复重试和结果查询始终复用该 UUID。`inventory.decompose` 是固定产品例外：分解领域组件生成 UUID 后直接创建一次 API 请求任务，请求任务创建后立即显示仅含“分解成功”的前端弹窗，不写入操作注册中心、不等待响应、不查询原操作、不刷新结果，也不展示服务器信息或操作号；客户端校验、请求构造或网络层确认请求无法发出时改为“提交失败”。Battle heartbeat 和 offline 不进入操作注册中心、不生成 UUID，也不通过 operations 查询恢复；Battle 结果按钮不发送请求。

除 `inventory.decompose` 的上述固定即时反馈外，网络失败不会展示业务成功。`unknown`、`pending` 通过 `GET /api/operations/:operation_id` 查询；只有明确返回 `OPERATION_NOT_FOUND` 时才用原 UUID 单次重提。恢复成功时，`use_case` 对应的原命令输出 Schema 会重新校验 `result`，随后按该路由声明的 refresh scope 刷新真实状态。入口交接未完成时，该查询只能读取当前用户的原 `referral.bind` 操作。

重新进入应用时，`identity.bootstrap.blocking_operations` 交给操作恢复工作流，前端先静默移除其中全部 `inventory.decompose` 记录，再处理其余操作；分解记录不形成弹窗、待确认入口或查询。`pending_payments` 和 `pending_mints` 分别交给支付与 Mint 恢复工作流，当前 `battle_participation` 交给 Battle 恢复工作流；已经终结的 Battle 结果不进入 bootstrap。开盒、幸运转盘与进化的 `pending`、`unknown` 以及尚未确认展示的 `succeeded`、`failed` 都进入 `blocking_operations`；前端分别通过 `GET /api/gacha/recovery`、`GET /api/wheel/recovery` 与 `GET /api/inventory/evolution/recovery` 使用同一通用发现 Hook，按 1 秒、2 秒、3 秒、5 秒、此后每 30 秒发现事务提交晚于首屏读取的原操作，发现后停止对应发现轮询并只按原 `operation_id` 查询终态。K-coin 创建订单命令在 invoice URL 持久化后立即完成，不作为长期阻塞操作；未提交 Stars 的 `pending` K-coin 订单不恢复、不打开弹窗。只有 `processing`、`paid` K-coin 订单恢复锁定弹窗，并按 1 秒、2 秒、3 秒、此后每 5 秒查询唯一终态；VIP 继续使用自身既有恢复交互。充值订单交付后，只恢复开盒、市场购买、转盘、`battle_create`、`battle_matchmaking` 或 `battle_accept` 的确认界面，不自动执行原业务。

Battle 创建、随机匹配、取消、接受或行动响应丢失时查询原 operation 与 `GET /api/battle/rooms/:room_id`；随机匹配恢复只回放同一 operation 的公开 waiting 或 lobby 快照，不重复入队、建房、锁币或占宠；接受恢复读取同一个 lobby，不再次锁币、创建 reservation 或提前创建第 1 个完整回合。`battle-share` integration 以原 `create_operation_id` 恢复同一 room 和同一 bearer token。heartbeat/offline 响应丢失时只在当前活动 lease 内以更高 command sequence 重试；隐藏、Telegram deactivated、`pagehide` 或离开 `/game` 立即结束 lease、中止在途 heartbeat 并尽力 offline，恢复先读取不带游标的 viewer snapshot、把表现游标初始化为最新动作 sequence，再申请下一 lifecycle version 的新 lease。数据库忽略低版本、旧 lease、重复与乱序命令；新 lease 接管后旧请求永久无副作用。两者都不查询 operation。普通结果只应用 room；请求内终结房间、重新可见回正终态或相关错误确认退款/释放时，才按契约一次刷新 Battle、顶部资产与 inventory。Ably 只触发 REST 回正；邀请 waiting、公开匹配 waiting、接受和 lobby 每 2 秒、`active_turn` 每 1 秒短轮询，并用 `state_version` 丢弃重复或乱序失效通知。deadline 到达后的权威读取失败或仍返回同一 deadline 时，即使 Ably 仍连接也继续按相同节奏读取；当前会话持有未终局 room 时，bootstrap 的空 participation 先触发该 room 读取，不能直接清空 room。页面持续可见期间用 `after_action_sequence` 补齐动作事件；初次进入、刷新、重认证和重新可见不补播历史。Battle 权威协调器对普通查询的内部抑制使用 TanStack cancellation 并回滚 observer 状态，不产生查询错误；房间 owner 读取完成后先发布权威快照并释放抑制，再执行 bearer invite 读取，禁止形成自冲突。

Battle 终局只在当前前台会话通过 `BattleRoomSnapshotDto.terminal_result` 展示；数据库终局事务已经完成全部资产结算。Web 立即应用终局快照并执行 Battle、identity 与 inventory 权威批次，失败时只在活动 `/game` 按 1 秒、2 秒、5 秒、此后每 5 秒静默重试，离页暂停、返回立即恢复；结果覆盖层等待当前客户端按 sequence 排列的动作表现队列清空后显示。结果按钮只在当前 session generation 内存中忽略该 room 并返回首页，不发送请求；迟到响应不得重新打开。重新加载或重新认证不恢复终局结果。Battle 页面不把 API、查询、网络、会话或协调器的错误对象、错误码和内部说明渲染为浮层、Toast、Alert 或手工重试入口；用户只消费游戏页面及其行内状态。玩家端不恢复旧结果、回合列表、审计或 replay。

操作弹窗先按 `use_case` 选择展示组件，再校验该命令的唯一输出 Schema。`gacha.open`、`wheel.spin` 与 `inventory.evolve` 的展示组件位于操作恢复工作流，`OperationRegistryProvider` 只负责编排阶段、原操作查询、导航锁、刷新范围和服务端结果回执；领域组件直接消费持久结果，不在注册中心复制结果字段。开盒、转盘和进化只有在持久状态为 `succeeded` 且完整结果通过各自命令输出 Schema 校验时才展示对应业务内容；进化的随机失败仍是已完成结算，使用同一完整输出 Schema，前置拒绝则使用持久错误码和拒绝快照展示。Schema 不完整的成功结果只查询原操作且不得确认。专用弹窗的字段与动作唯一引用产品主文档第 14.4.6、4.3.6 和 18.6 节。

已经由领域页面、Telegram/钱包原生界面或支付恢复界面展示真实结果的操作，不再追加只含“服务器已确认”和操作号的通用成功弹窗。固定范围为 `expedition.create`、`mint.reserve`、`mint.cancel`、`referral.bind`、`referral.share_event`、`topup.create_order`、`topup.cancel_order`、`topup.fail_order`、`vip.create_order`、`vip.claim_fgems`、`vip.claim_free_box`、`wallet.verify` 与 `wallet.disconnect`；这些操作成功后立即移除前端通用操作记录并刷新路由声明的真实状态。`referral.share_event` 的复制或 Telegram 分享结果由邀请卡片行内反馈承载，提交时不激活全局操作弹窗；`pending` 与 `unknown` 保留原操作恢复能力，明确失败则刷新任务真实状态并允许用户重新执行分享动作。行内反馈只证明复制或 Telegram 分享入口已经成功，不得当作任务进度已经成功。`inventory.decompose` 另按产品第 11 章只展示请求任务创建后的固定前端成功弹窗，所有服务器状态均不进入通用操作弹窗。签到、任务领取、远征领取、交易、Mint 最终结果以及所有专用结果弹窗不属于上述固定范围。

开盒结果关闭、再次开盒或前往藏品页之前，前端调用 `POST /api/gacha/results/:operation_id/acknowledge`；转盘结果关闭前调用 `POST /api/wheel/results/:operation_id/acknowledge`；进化成功、随机失败或拒绝结果执行规定动作前调用 `POST /api/inventory/evolution/results/:operation_id/acknowledge`。数据库只允许当前用户确认匹配固定 `use_case` 的本人终态，并以首次确认时间幂等落库。确认响应丢失时弹窗保持打开并允许重试；确认完成后启动与领域恢复查询都不再返回该结果。前端内存和浏览器存储都不充当结果或确认事实来源。

`album.claim` 成功且结果通过该命令输出 Schema 校验时展示图鉴奖励专用结果，包含服务端返回的链条名称、真实 Fgems 奖励和操作号；确认前不提前显示奖励。图鉴是脱离主壳层的全屏页面，因此页面自身消费 `identity.bootstrap.blocking_operations` 并注入同一操作注册中心，网络中断后只查询原 `operation_id`。成功、失败或未知恢复都会按 `album.claim` 声明的资产与图鉴刷新范围重新读取 `album.get` 和顶部资产事实，不从临时弹窗状态重放领取。

每日幂等清理不得删除尚未确认展示的开盒、转盘或进化终态；确认完成后，该操作才按通用终态规则在创建满 30 天后清理。

每条前端操作记录绑定创建时的 session generation。会话过期、被替换或重新登录时先切换 generation，再清空全局操作、导航和查询状态；封禁时同时先切换为 `banned` 和新 generation。旧 generation 的请求、查询、动画及恢复结果全部丢弃。自然过期的并发请求共享一次认证交换，恢复只允许一次；新会话为 `pending` 时只继续邀请交接，不自动重做首屏或资产业务。

`gacha.open` 与 `wheel.spin` 的操作记录分别是开盒和转盘全局交互锁的唯一前端事实。记录在 `confirming`、`submitting`、`pending`、`unknown` 阶段锁定本领域按钮和全部底部导航；服务端结果进入 `succeeded` 或 `failed` 后，记录保留至用户通过真实结果弹窗处理结果，因此同一把锁不会在弹窗背景上提前释放。结果弹窗按钮、原操作查询和待确认操作恢复入口始终保持可操作。

`inventory.evolve` 在 `confirming`、`submitting`、`pending`、`unknown` 阶段锁定新的进化提交和全部底部导航；`pending` 与 `unknown` 只能查询原 `operation_id`，不得生成新幂等键。服务端终态通过进化专用结果组件展示；成功目标无论是否重复获得都写入当前 session generation 的 NEW 集合，查看该目标藏品详情后清除。完全重启不额外恢复已确认结果的 NEW；若重启恢复的是尚未确认展示的原成功结果，则该结果再次把目标写入新运行期的 NEW 集合。
