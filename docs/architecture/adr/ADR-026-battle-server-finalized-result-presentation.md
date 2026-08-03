# ADR-026：Battle 服务端终局与当场结果展示

## 状态

已接受。

## 决定

Battle 的胜负、退款或结算、K-coin 账本、stake、reservation、participant、summary、settlement、event 与 outbox 全部由数据库终局事务原子完成。用户是否查看结果、点击按钮、关闭页面或重新打开 Mini App 均不参与结算，也不产生结果确认写入。

参与者专属 `BattleRoomSnapshotDto` 固定包含 `terminal_result: BattleTerminalResultDto | null`。数据库只从当前 viewer 的终局 summary 生成该字段；正常 `finished`、`draw` 和已开战安全作废 `voided` 必须返回完整结果，`cancelled`、`expired` 与 prepared-share 作废固定返回 `null`。Battle bootstrap 与 identity bootstrap 只恢复未终结 participation，不返回终局结果；项目删除 Battle acknowledge REST 路由、RPC、错误码、参与者确认时间和所有 Web 确认状态。

Web 收到终局 room snapshot 时先应用权威快照，再由终态协调器自动执行 Battle、identity、inventory 三域权威刷新。资产回正不等待用户点击；失败只在活动 `/game` 静默重试。结果按钮固定为“返回 Battle 首页”，只在当前 session generation 的内存中记录已离开的 room ID 并本地返回首页，不写浏览器存储或服务器。任何迟到的 room、Ably、bootstrap 或命令响应都必须经过同一内存边界，不能重新打开该 room 的结果页；新的 session generation 清空此集合。

重新认证后，`/game` 直接进入 Battle 首页。终局参与者从原 `BTL_` 入口重新打开时，`battle.current_invite` 复用既有 `none` 状态且 Web 直接进入 Battle 首页，不增加导航提示或结果恢复字段；未参与该房间的账号仍按邀请的真实状态显示接受或冲突页面。普通 TMA 入口继续进入项目默认首页。

关闭、刷新、重新认证或重新打开 Mini App 后不恢复已经终结的结果页。从 Battle 入口或 `/game` 重新打开进入 Battle 首页，从普通 TMA 入口重新打开仍进入项目默认首页。服务端永久 summary 与私有审计继续存在，但不提供玩家结果历史、确认或回放接口。

## 结果

数据库结算不再依赖客户端生命周期，用户可以立即关闭页面且不会阻塞双方资产释放。当前前台会话仍展示数据库权威结果，按钮不再承担业务副作用，重开应用也不会被旧结果拦截。
