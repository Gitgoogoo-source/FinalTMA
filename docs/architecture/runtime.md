# 运行时

## Web

Battle 队伍选择页同时提交好友创建和公开随机匹配意图。公开匹配不新增浏览器队列运行时：Web 点击后立即锁定表单，`battle.matchmake` 的权威响应直接落到 `public_match/waiting` 或不可撤销的 `lobby_countdown`；公开 waiting 与邀请 waiting 共用 room snapshot、presence 和 2 秒 REST 回正，但按 `room_mode` 分别展示 120 秒匹配或 30 分钟分享界面。匹配成功后页面 presence 只用于回正显示，不得阻止、取消或重置 3 秒倒计时。

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；五个主页面首次访问后在当前 session generation 内保持挂载，路由只切换 `hidden`/`inert`、本页查询参数和独立滚动位置，图鉴与 Mint 作为临时详情路由覆盖其上。`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP，游戏页组合 Battle UI 与 battle-realtime workflow。首次进入 TMA 时同步下载并执行应用壳、会话与账号门禁及默认开盒页；`window.load` 后在浏览器空闲时段预加载交易、游戏、藏品、任务和图鉴页面模块。Battle 使用 React + TypeScript、CSS 与 Web Animations API，不引入 Phaser；Mint 页面、TON Provider 与钱包弹窗不进入后台预加载。

Telegram WebApp 在 `createRoot().render()` 前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 同步初始化，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏仍保留最小化和关闭能力。不支持垂直滑动控制的旧客户端继续使用客户端原生行为；原生全屏不可用时静默保留已展开的最大稳定视口。首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区、视口和全屏事件。平台层以 `max(safeAreaInset.top, contentSafeAreaInset.top)` 作为已报告顶部值；仅 `platform` 为 `ios` 或 `android` 时，再补充 `max(0, safeAreaInset.top + 44 - 已报告顶部值)`，主壳层以两者之和统一定位唯一的全局顶部资产栏和页面内容起点。该计算保证设备安全区之后仍保留 44 CSS px 原生控件行；官方 `contentSafeAreaInset.top` 已经覆盖控件行时补充量为零，并且不依赖可能滞后或为假的 `isFullscreen`。普通浏览器与 Telegram Desktop/Web 的补充量为零。依赖可用高度的页面使用同一顶部值。主导航切换不失效查询；服务端业务结果继续按 `refreshScopes` 精确刷新。WebView 以前台 `activated`/后台 `deactivated` 事件计时，普通浏览器和旧客户端回退到 `visibilitychange`；重复事件只执行一次恢复。后台连续停留达到五分钟后恢复时，保留页面并静默刷新顶部摘要与当前路由查询；不足五分钟不请求普通页面。市场成交提醒是唯一例外：交易页面可见时无论购买、出售或管理页签是否激活都每 10 秒同步本人当前挂售和成交事件游标，进入、重新可见或网络恢复时立即同步，隐藏或离开交易页面时停止；按内部用户 UUID 隔离的游标和未隐藏 SOLD 事件写入版本化 `localStorage`，同一待展示集合非空时直接显示“管理”红点，不保存第二份已读状态、会话或业务裁决数据。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

进化确认通过 React Portal 挂载到 `document.body`，不进入藏品卡片或页面内容的层叠上下文。确认页固定覆盖主应用稳定视口，在 Telegram 内容顶部安全区下方开始布局，内部使用独立滚动区与位于设备底部安全区上方的固定操作区；确认页打开期间锁定根文档滚动，关闭后恢复原滚动状态。Catalog v1 产品数据构建同时生成 Web 专用的 140 条静态进化路线，打开确认页只读取该前端构建产物和页面已有库存、资产状态，不请求服务端进化预览；静态路线不参与提交后的保底或资产裁决。

正式藏品图片由仓库内 210 张非公开母版生成 420 张版本化 WebP。列表只读取 256×256 缩略图，主视觉和 NFT 元数据读取 768×768 详情图；浏览器不通过 Function 或 Supabase 读取图片二进制。

Battle 页面在同一 session generation 内保持挂载，并只渲染产品第 21 章的八种页面状态。页面可见且 room 为邀请 `waiting` 时只有创建者每 5 秒发送纯展示心跳；room 为 `lobby_waiting/lobby_countdown` 时双方每 5 秒发送 participant presence 心跳；进入 `active_turn` 后立即停止。`lobby_waiting` 沿用红蓝双方卡、90 秒重连和 5 分钟时限；数据库进入 `lobby_countdown` 后立即改为全稳定视口的红蓝对决 3 秒专用页面，固定覆盖顶部资产栏、主导航与全部产品内按钮，显示“倒计时已锁定”“离开不会取消战斗”，不渲染取消、退出、分享或重新选队动作。每次可见/激活 `/game` 时段使用一个独立 UUID lease 和数据库快照的下一 lifecycle version，lease 内命令序号严格递增。页面隐藏、Telegram `deactivated`、`pagehide` 或离开 `/game` 时立即结束 lease、中止全部在途 heartbeat、停止 UI 轮询并尽力发送同 lease offline；重新可见、激活或返回时先读取不带动作游标的 REST 快照，把表现游标初始化为 `latest_action_sequence`，再申请并使用数据库认可的新 lease。新 lease 接管后旧 heartbeat/offline 永久无副作用，安全不依赖 abort 或 offline 必达；任何新旧 lease 与页面生命周期都不改变已经锁定的 countdown deadline。Ably client 只能 subscribe，通知只携带 `event_id`、`room_id`、`state_version` 与 `event_kind`；收到通知、deadline 到达或连接失败时，battle-realtime workflow 通过 REST 携带 `after_action_sequence` 读取 viewer-specific snapshot，按 sequence 补齐动作并串行排入表现队列。邀请 waiting、接受和 lobby 每 2 秒、`active_turn` 每 1 秒短轮询；deadline 到达后的权威读取失败或仍返回同一 deadline 时，即使 Ably 仍连接也继续按该节奏读取，直到权威状态前进或终结。当前会话持有未终局 room 时，bootstrap 的空 participation 只触发 room 读取，不能清空当前房间。权威 room 立即决定按钮和倒计时，表现动画不得遮挡操作；heartbeat/offline 普通响应只应用 room snapshot，同次请求或回正实际确认退款/释放终态时才一次刷新 `battle + assets + inventory`，不得由 5 秒心跳无条件刷新 assets/inventory。

Telegram `waiting` 房间的分享调用反馈只保存在内存，并以 session generation 与当前创建者 room ID 共同寻址。打开原生面板只产生非成功性的即时反馈；`USER_DECLINED` 或 callback 明确返回未发送属于可重试的本地取消，`shareMessageSent` 或成功 callback 属于发送成功，`MESSAGE_SEND_FAILED` 或 Telegram 官方等价的明确失败事件属于发送失败。官方 `UNKNOWN_ERROR` 仍是已经到达的明确失败事件，不等于“超过固定时限没有回调”。Telegram 没有为 `shareMessage` 规定 no-callback deadline，因此 Web 不新增或推断 waiting 分享 `unknown`。Web 只在本房间实际调用 `shareMessage` 后消费不含 room ID 的 Telegram sent/failed 事件；调用 callback 与事件落状态前都复核当前 generation、room、side 和 status。切换房间、进入终态、离开再进入 `/game` 或重新认证时先使旧尝试失效并隐藏旧反馈；延迟回调不能覆盖新房间。该反馈不进入 API、数据库、资产刷新或 Battle 业务裁决。

Prepared inline message 创建阶段的外部结果未知属于独立服务端路径：原 `create_operation_id`、同一 room 与同一 bearer invite 在 60 秒内恢复，超时后由数据库作废、退款并释放 reservation。该恢复不能与已经进入 `waiting` 后的原生分享 callback 混为一类，也不因 waiting 分享没有 no-callback `unknown` 而删除。

Battle 页面状态按“当前会话未离开的 viewer-specific current-room、`BTL_` 入口/本地流程、首页”依次渲染。终局 room snapshot 含数据库生成的 `terminal_result` 时显示当场结果；用户返回首页后，同一 session generation 的迟到 room、Ably、bootstrap 或命令响应不得重新打开该结果。接受成功的 room snapshot 一经应用，即使邀请刷新后回答 `accepted`，当前账号仍必须保持 lobby/current-room；只有本账号的 accept operation 返回 `BATTLE_ROOM_ALREADY_ACCEPTED` 时才渲染固定冲突。幂等回放与响应乱序以高 `state_version` 快照回正；重新加载和重新认证只恢复仍在进行的 participation，不恢复终局结果，邀请入口不得覆盖数据库参与事实。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Battle app handlers 只调用 viewer-specific 读取或单个 Battle RPC；`battle-share` 与 `battle-outbox` 分别属于 integrations workflow，并通过受保护 RPC 领取任务。Functions 不计算价格、奖励、库存、资产归属、Battle 命中/伤害/终局或最终交易结果。

玩家 `battle.*` 与 `battle.outbox_integration` 的请求终态日志按 [ADR-028](adr/ADR-028-battle-request-observability.md) 输出鉴权、输入解析、handler、响应、数据库 RPC 和 Ably 累计耗时；outbox 正常响应同时输出 processed/published/deferred。采集只贯穿既有调用，不改变玩家请求与 outbox integration 的异步解耦。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web 与三个 Functions 位于同一 Vercel Pro Project，Functions 运行时为 Node.js 24。Battle 服务端发布使用 Ably Standard，数据库通过 `pg_cron` 每秒推进 deadline，并由 `pg_net` 唤醒两个受保护 integrations；Ably 不承担业务权威。版本化藏品静态资源使用一年 immutable 缓存，已发布目录不可覆盖；`contracts/ton` 的 typecheck 先从 Tact 源码生成被 Git 忽略的绑定，正式发布再运行独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit、migration 序列、OpenAPI 和 Battle checksum，只使用环境隔离的 Bot、Ably key、callback URL 与机密。

受控 Battle 验收夹具没有 Web、Function、Cron 或 Data API 运行时。它只通过数据库 owner 通道执行；迁移后的默认状态没有数据库身份绑定和 enable 记录。真实开发数据库重建后显式绑定 `real_development` 与当前 project ref，并使用不超过 24 小时的非秘密门禁；生产身份不能启用。
