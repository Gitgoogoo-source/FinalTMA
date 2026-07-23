# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP。

Telegram WebApp 在 `createRoot().render()` 前同步初始化，首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区和视口事件。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

正式藏品图片由仓库内 210 张非公开母版生成 420 张版本化 WebP。列表只读取 256×256 缩略图，主视觉和 NFT 元数据读取 768×768 详情图；浏览器不通过 Function 或 Supabase 读取图片二进制。

## Monster Tamer 静态子应用

`apps/web/src/domains/monster-tamer` 只拥有游戏页启动卡片。卡片通过普通链接打开 `/monster-tamer/`，游戏页组合顺序固定为 `Monster Tamer → Expedition → Wheel`；launcher 不调用 API，也不导入其他业务领域。

`apps/web/public/monster-tamer` 是独立 HTML、CSS、JavaScript、数据与资源树。Phaser 3.60.0、Web Font Loader 1.6.28 和 Tweakpane 4.0.3 从自身 `vendor` 目录加载；运行时不进入 React bundle。唯一持久化键为 `MONSTER_TAMER_DATA`，不跨设备同步，不写入 FinalTMA session、查询缓存、API、数据库或 Catalog 资产。

静态子应用公开可访问。Telegram WebApp SDK 负责 ready、expand、原生 fullscreen、稳定视口、设备/内容安全区、垂直滑动保护和 BackButton；原生全屏不可用时回退到已展开稳定视口，不存在 SDK 时仍使用普通 `/game` 返回链接运行。Phaser 画布占满稳定视口，逻辑高度随宽高比调整；世界场景把地图点击或拖动转换为 64px 网格目标并逐格移动，到达目标或遇到碰撞后停止。A、B、世界菜单保留为安全区内紧凑浮层，其他菜单使用点击或滑动选择；失焦、隐藏、Telegram 停用和 pointer cancel 均清空移动目标与输入。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Functions 不计算价格、奖励、库存、资产归属或最终交易结果。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web、Monster Tamer 静态子应用与三个 Functions 位于同一 Vercel Pro Project，Functions 运行时为 Node.js 24。`/monster-tamer` 与 `/monster-tamer/` 在 SPA catch-all 前重写到独立静态文档。版本化藏品静态资源使用一年 immutable 缓存，已发布目录不可覆盖。普通构建只构建 API 契约、API 与 Web，并原样复制 Monster Tamer 静态树；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit 和迁移序列。
