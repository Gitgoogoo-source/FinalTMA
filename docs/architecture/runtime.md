# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；五个主页面首次访问后在当前 session generation 内保持挂载，路由只切换 `hidden`/`inert`、本页查询参数和独立滚动位置，图鉴与 Mint 作为临时详情路由覆盖其上。`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP，游戏页组合 Battle UI 与 battle-realtime workflow。首次进入 TMA 时同步下载并执行应用壳、会话与账号门禁及默认开盒页；`window.load` 后在浏览器空闲时段预加载交易、游戏、藏品、任务和图鉴页面模块。Battle 使用 React + TypeScript、CSS 与 Web Animations API，不引入 Phaser；Mint 页面、TON Provider 与钱包弹窗不进入后台预加载。

Telegram WebApp 在 `createRoot().render()` 前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 同步初始化，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏仍保留最小化和关闭能力。不支持垂直滑动控制的旧客户端继续使用客户端原生行为；原生全屏不可用时静默保留已展开的最大稳定视口。首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区、视口和全屏事件。主壳层以设备顶部安全区与 Telegram 内容顶部安全区的较大值统一定位唯一的全局顶部资产栏和页面内容起点，确保资产栏位于 Telegram 原生头部控件下方；依赖可用高度的页面使用同一顶部值。主导航切换不失效查询；服务端业务结果继续按 `refreshScopes` 精确刷新。WebView 以前台 `activated`/后台 `deactivated` 事件计时，普通浏览器和旧客户端回退到 `visibilitychange`；重复事件只执行一次恢复。后台连续停留达到五分钟后恢复时，保留页面并静默刷新顶部摘要与当前路由查询；不足五分钟不请求。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

进化确认通过 React Portal 挂载到 `document.body`，不进入藏品卡片或页面内容的层叠上下文。确认页固定覆盖主应用稳定视口，在 Telegram 内容顶部安全区下方开始布局，内部使用独立滚动区与位于设备底部安全区上方的固定操作区；确认页打开期间锁定根文档滚动，关闭后恢复原滚动状态。Catalog v1 产品数据构建同时生成 Web 专用的 140 条静态进化路线，打开确认页只读取该前端构建产物和页面已有库存、资产状态，不请求服务端进化预览；静态路线不参与提交后的保底或资产裁决。

正式藏品图片由仓库内 210 张非公开母版生成 420 张版本化 WebP。列表只读取 256×256 缩略图，主视觉和 NFT 元数据读取 768×768 详情图；浏览器不通过 Function 或 Supabase 读取图片二进制。

Battle 页面在同一 session generation 内保持挂载，并只渲染产品第 21 章的九种页面状态。页面可见且 room 为邀请 `waiting` 时只有创建者每 5 秒发送纯展示心跳；room 为 `lobby_waiting/lobby_countdown` 时双方每 5 秒发送 participant presence 心跳；进入 `active_select` 后立即停止。每次可见/激活 `/game` 时段使用一个独立 UUID lease 和数据库快照的下一 lifecycle version，lease 内命令序号严格递增。页面隐藏、Telegram `deactivated`、`pagehide` 或离开 `/game` 时立即结束 lease、中止全部在途 heartbeat、停止 UI 轮询并尽力发送同 lease offline；重新可见、激活或返回时先 REST 回正，再申请并使用数据库认可的新 lease。新 lease 接管后旧 heartbeat/offline 永久无副作用，安全不依赖 abort 或 offline 必达。Ably client 只能 subscribe，通知只携带 `event_id`、`room_id`、`state_version` 与 `event_kind`；收到通知、deadline 到达或连接失败时，battle-realtime workflow 通过 REST 读取 viewer-specific snapshot。邀请 waiting、接受和 lobby 每 2 秒、选择/强制换宠每 1 秒短轮询，重新可见时立即完整回正。heartbeat/offline 普通响应只应用 room snapshot；同次请求或回正实际确认退款/释放终态时才一次刷新 `battle + assets + inventory`，不得由 5 秒心跳无条件刷新 assets/inventory。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Battle app handlers 只调用 viewer-specific 读取或单个 Battle RPC；`battle-share` 与 `battle-outbox` 分别属于 integrations workflow，并通过受保护 RPC 领取任务。Functions 不计算价格、奖励、库存、资产归属、Battle 命中/伤害/终局或最终交易结果。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web 与三个 Functions 位于同一 Vercel Pro Project，Functions 运行时为 Node.js 24。Battle 服务端发布使用 Ably Standard，数据库通过 `pg_cron` 每秒推进 deadline，并由 `pg_net` 唤醒两个受保护 integrations；Ably 不承担业务权威。版本化藏品静态资源使用一年 immutable 缓存，已发布目录不可覆盖；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit、migration 序列、OpenAPI 和 Battle checksum，只使用环境隔离的 Bot、Ably key、callback URL 与机密。
