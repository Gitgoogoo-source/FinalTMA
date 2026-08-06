# ADR-013：登录会话内页面保活与事件驱动刷新

## 状态

已接受。

## 决定

交易、游戏、开盒、藏品和任务五个主页面在当前登录会话中首次访问时挂载，之后只切换可见性，不因路由切换卸载。每页独立保留组件状态、滚动位置和最后一次属于本页的查询参数；隐藏页面不可读取或响应其他页面的查询参数。图鉴详情路由临时覆盖主页面，返回时恢复原页面而不重新挂载；当前 MVP 不注册 Mint 详情路由。

页面切换不失效或重新读取任何 React Query 数据。服务端确认业务结果后继续按 API 契约的 `refreshScopes` 精确失效；若成功响应已经携带并应用目标查询的完整权威快照，则直接写入对应查询缓存，不再失效同 scope 的无变化入口数据。顶部人工刷新只重新读取 `identity.bootstrap` 和 `vip.get`。Mini App 以 Telegram `deactivated`/`activated` 作为客户端内前后台边界，并以浏览器 `visibilitychange` 作为普通浏览器与旧客户端回退；重复事件只记录最早离开时间且只执行一次恢复。后台连续停留不足五分钟时回到前台不读取普通页面数据；达到五分钟时保留当前界面并静默刷新顶部摘要与当前路由所属查询。普通市场数据不轮询，唯一例外是 [ADR-029](ADR-029-market-sold-device-inbox.md) 的成交提醒：交易页可见时无论购买、出售或管理页签是否激活都每 10 秒读取本人当前挂售与成交事件游标，进入交易页、重新可见和网络恢复时立即读取，隐藏或离开交易页时停止，使共享“管理”页签能在进入管理内容前显示未确认成交红点。

开盒召唤结果和转盘结果都只属于取得它们的当前前台运行期。`visibilitychange` 隐藏、Telegram `deactivated` 或 `pagehide` 立即移除开盒与转盘终态展示、清除转盘动画与临时计数，并使该运行期的转盘迟到响应失去展示资格。转盘 `pending`、`unknown` 仍保留交互锁并只查询原 `operation_id`；它在离开后取得终态时只刷新权威状态并静默移除。重新可见、`activated`、`pageshow` 或重新联网时精确刷新开盒和转盘的权威范围，不恢复旧结果。刷新、WebView 重载或重新认证时 `identity.bootstrap.blocking_operations` 不返回 `gacha.open` 或转盘终态，只返回转盘未决与进化规定状态。全局操作恢复发现只在当前正常 session generation 的入口交接完成、页面可见、Telegram 已激活且浏览器在线时调用 `GET /api/operations/recoverable`。`visibilitychange` 隐藏、Telegram `deactivated` 或 `offline` 会清除下一次计时并 abort 当前发现请求；重新可见、`activated` 或 `online` 后立即读取。发现记录时一次注入全部结果并暂停新发现，恢复队列清空后立即执行一次追赶读取，再进入 1 秒、2 秒、3 秒、5 秒、此后 30 秒的空结果节奏。

Battle 页面仍按主页面规则保持挂载，但活跃通信严格绑定页面可见性。每次可见/激活 `/game` 时段使用一个独立 UUID presence lease。离开 `/game`、Telegram `deactivated`、`pagehide` 或 WebView 隐藏时立即结束当前 lease、中止全部在途 heartbeat、停止邀请 waiting 的创建者展示心跳、lobby 的双方 presence 心跳和 Battle UI 轮询，并尽力以同 lease 下一序号发送 offline；返回可见/激活状态时立即通过 REST 读取 viewer-specific 当前快照，申请数据库下一 lifecycle version 的新 lease，数据库确认后再恢复 heartbeat、Ably subscribe 与降级轮询。新 lease 接管后旧生命周期任何迟到 heartbeat/offline 永久无副作用，安全不依赖 abort 或 offline 必达。进入 active 战斗后停止 presence 心跳。隐藏页面的内存状态不得替代数据库在线事实、deadline 或 `state_version`；普通 heartbeat/offline 只应用 room，确认退款终态才刷新 Battle、顶部资产和 inventory。

Battle prepared message 的即时分享反馈以当前 session generation 与创建者 `waiting` room ID 为唯一上下文。只有本上下文已实际调用 `shareMessage` 时，Telegram 不携带 room ID 的 `shareMessageSent`/`shareMessageFailed` 事件才可更新页面；调用级 callback 同样必须复核 generation、room ID、创建者 side 与 `waiting` 状态。房间切换、终态退出、离开再进入 `/game`、重新认证或 session generation 改变时，旧分享尝试立即失效，旧的 pending、sent、cancelled、failed 或 unknown 反馈不渲染到新上下文，迟到回调不能恢复。分享反馈只描述 Telegram 面板和消息动作，不代表房间、资产或业务成功。

Battle 页面的权威优先级固定为“当前会话未离开的 viewer-specific current-room 快照 → 当前邀请入口/本地流程 → Battle 首页”。终局 room snapshot 只有在包含 `terminal_result` 时渲染 result；点击返回后，本次 session generation 内任何迟到结果都不能重新打开同一 room。`BTL_` 入口只在当前账号没有权威 room 时决定邀请页；接受命令成功返回或 bootstrap/room 刷新已给出本账号的进行中 room 时，必须立即渲染该 room 的 lobby 或 battle 状态。迟到的邀请 `accepted` 刷新不得把本账号的成功 room 降级为“挑战已被其他玩家接受”；固定冲突只属于本账号自身的失败 accept operation。同键回放与响应乱序服从高 `state_version` 快照；重新加载和重新认证不恢复终局结果，不由前端猜测赢家。

页面保活和查询缓存只存在于当前内存登录会话，不写入 `localStorage`、`sessionStorage`、IndexedDB 或服务端。唯一持久化例外是 [ADR-029](ADR-029-market-sold-device-inbox.md) 定义的按内部用户 ID 隔离的 SOLD 提醒游标与未隐藏事件；它不保存查询缓存、会话令牌或业务裁决数据。Session generation 改变、身份恢复失败、会话清理或账号封禁时，全部持久页面、页内状态和查询缓存一并清除，旧 generation 的迟到结果不得恢复；SOLD 本地数据保留但在当前身份不匹配时绝不读取或展示。

## 结果

主页面代码、图片与页内状态只在当前会话首次需要时创建。React Query 的 `20 秒` `staleTime` 继续管理首次挂载和普通查询，但不会因主导航切换触发重新请求。页面刷新、WebView 重载或 Mini App 关闭仍重新执行 Telegram 身份交换与首屏启动。
