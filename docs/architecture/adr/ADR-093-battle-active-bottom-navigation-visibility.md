# ADR-093：Battle 实际对战底部导航可见性

- 状态：已接受
- 日期：2026-08-29

## 背景

“游戏”主页面的八种 Battle 页面状态全部复用 `/game` 路由和同一个应用壳。路由只能说明玩家位于游戏主页面，不能区分 Battle 首页、选队、等待、双人房、实际对战和结果。`BattleView` 已在根节点通过 `data-battle-page-state` 发布当前唯一页面状态，但应用壳始终渲染共享底部导航；既有样式只在 `lobby_countdown` 隐藏顶部资产栏和底部导航。

真实 iPhone Telegram 与 Safari Web Inspector 证明，`battle` 状态中 `.battle-root` 和 `.bottom-nav` 同时存在，底部导航仍为可交互的固定定位网格，应用壳还继续为其保留导航高度。玩家进入实际对战后因此仍能看到并触发五个主导航，战场也不能使用这部分视口空间。产品最新裁决要求实际对战隐藏共享底部导航，同时保留顶部资产栏及 Telegram 底部安全区。

## 裁决

`data-battle-page-state="battle"` 是隐藏共享底部导航的唯一前端事实。Battle 领域样式使用应用壳对该状态的关系选择器，在同一次渲染中把 `.bottom-nav` 设为 `display: none`，使其同时退出绘制、命中、焦点顺序和辅助技术；禁止只使用透明度、位移、层级或 `visibility` 形成仍占状态边界的隐藏导航。

同一状态下，应用壳底部内边距固定收敛为 `var(--safe-bottom)`，释放共享底部导航原先预留的布局空间，同时继续保护 iPhone Home Indicator。顶部资产栏保持展示，不建立新的全局运行状态、React Context、路由或事件。`home`、`team_select`、`preparing_share`、`waiting`、`accept`、`lobby_waiting` 和 `result` 继续展示共享底部导航；`lobby_countdown` 继续使用既有全屏锁定规则覆盖顶部资产栏和底部导航。

架构静态门禁必须同时证明：`battle` 状态选择器存在、底部导航使用 `display: none`、应用壳只保留安全区、同一选择器不隐藏顶部资产栏。真实设备验收必须覆盖进入 `battle`、等待对手、本人行动、结果过渡、返回首页及再次进入，确认导航无闪现、战场操作不被 Home Indicator 遮挡、退出 `battle` 后导航恢复。

## 结果

该裁决只改变实际对战期间的共享底部导航可见性和应用壳底部布局，不改变 Battle 八种页面状态、Telegram 原生返回、顶部资产、金额、资产、库存、倒计时、实时连接、API、数据库或结算。ADR-020 关于 `battle` 状态继续展示共享底部导航的旧裁决由本文取代，ADR-020 的其余视觉作用域继续有效。
