# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP。首次进入 TMA 时同步下载并执行应用壳、会话与账号门禁及默认开盒页；`window.load` 后在浏览器空闲时段优先预加载游戏页模块、`inventory.list`、Monster Tamer 静态运行文件、地图素材和真实可用藏品缩略图，完成后再预加载交易、藏品、任务和图鉴页面模块。Mint 页面、TON Provider 与钱包弹窗不进入后台预加载。

Telegram WebApp 在 `createRoot().render()` 前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 同步初始化，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏仍保留最小化和关闭能力。不支持垂直滑动控制的旧客户端继续使用客户端原生行为；原生全屏不可用时静默保留已展开的最大稳定视口。首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区、视口和全屏事件。主壳层以设备顶部安全区与 Telegram 内容顶部安全区的较大值统一定位唯一的全局顶部资产栏和页面内容起点，确保资产栏位于 Telegram 原生头部控件下方；依赖可用高度的页面使用同一顶部值。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

进化确认通过 React Portal 挂载到 `document.body`，不进入藏品卡片或页面内容的层叠上下文。确认页固定覆盖主应用稳定视口，在 Telegram 内容顶部安全区下方开始布局，内部使用独立滚动区与位于设备底部安全区上方的固定操作区；确认页打开期间锁定根文档滚动，关闭后恢复原滚动状态。Catalog v1 产品数据构建同时生成 Web 专用的 140 条静态进化路线，打开确认页只读取该前端构建产物和页面已有库存、资产状态，不请求服务端进化预览；静态路线不参与提交后的保底或资产裁决。

正式藏品图片由仓库内 210 张非公开母版生成 420 张版本化 WebP。列表只读取 256×256 缩略图，主视觉和 NFT 元数据读取 768×768 详情图；浏览器不通过 Function 或 Supabase 读取图片二进制。

## Monster Tamer 藏品展示家园

`apps/web/src/domains/monster-tamer` 拥有游戏页内直接渲染的水上家园。进入 `/game` 时立即通过现有 `useApiQuery("inventory.list")` 读取认证结果，只保留 `available > 0` 并按 `template_id` 去重；React 不提交写操作，也不直连 Supabase。家园占用顶部资产栏与底部导航之间的全部可用视口，不存在启动卡片、进入按钮或顶层 Portal。

`apps/web/public/monster-tamer` 是同源 Phaser 3.60.0 渲染文档。直接访问时只显示从游戏中心进入的门禁文案；React 嵌入使用 `?embedded=1`，HTML 第一帧便隐藏该门禁，藏品查询和 Phaser 资源尚未完成时只显示与地图一致的水面背景，不显示居中加载卡。渲染文档不读取 session、不请求 `/api/*`，只有在已登录 React 父页面通过同源 `postMessage` 注入最小展示数据后才创建 Phaser；真实接口或渲染错误由 React 显示可重试错误状态。

世界只加载 `50×50`、`64px/格` 的 `main_1`。最外两格保持连续水域；`Flat-Ground`、`Collision`、`Scenery` 与 `Water-Scenery` 构成唯一不规则水上岛屿。可通行陆地保持连通，水域、岸边、建筑、树干、树桩和岩石不可通行。Tiny Swords `Tilemap_color1`、Blue Buildings 和环境白名单继续从本地加载，Catalog 宠物使用主应用注入的正式缩略图路径。

每个不同模板生成一个宠物实体。宠物主体世界尺寸固定为 `56×56` 像素，在 `0.5` 倍镜头下显示为原宠物尺寸的 `50%`；阴影、点击区域和动画位移同步缩小 `50%`。Phaser 用占用格和预定格避免宠物互相重叠，以相邻格移动、翻转、浮动和压缩伸展表现活动；不包含 NPC、探索、遭遇、战斗、捕捉、队伍、背包、道具、菜单或音频。

Phaser 恢复原开放 RPG 的 AxulArt 默认玩家精灵和四方向三帧动画。镜头固定 `0.5` 倍并平滑跟随人物，地图、人物与宠物以原 `1` 倍镜头的 `50%` 尺寸显示，横向和纵向可视范围各扩大到原来的 `2` 倍。手机触摸和桌面鼠标左键点按可通行地面时共用网格寻路；桌面 `W/A/S/D` 每次提交相邻一格，按住时连续逐格移动，移动中只缓存落地后的下一格。连续移动由场景维护的按下与松开状态驱动，不依赖操作系统的键盘重复事件；切换方向时完成当前格，再从下一格立即按最后按下且仍保持的方向移动，中间不进入静止状态。全部输入避开静态障碍与宠物占用/预定格；运行时不注册拖动、滚轮、双指缩放、方向键或摇杆输入，场景只负责逐格动画和镜头适配。

点击宠物先暂停 Phaser，再把 `template_id` 返回 React；该点击不触发人物移动。React 用当前认证结果重新匹配，并通过共享的现有藏品详情组件在游戏上方打开只读详情。关闭详情后恢复同一 Phaser 场景状态，离开游戏页后销毁该页面内存状态。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Functions 不计算价格、奖励、库存、资产归属或最终交易结果。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web、Monster Tamer 同源渲染文档与三个 Functions 位于同一 Vercel Pro Project，Functions 运行时为 Node.js 24。`/monster-tamer` 与 `/monster-tamer/` 在 SPA catch-all 前重写到渲染文档，但业务入口只存在于登录后的 React 游戏页。版本化藏品静态资源使用一年 immutable 缓存，已发布目录不可覆盖。普通构建同时复制 Monster Tamer 静态树；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit 和迁移序列。
