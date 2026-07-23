# 运行时

## Web

`apps/web` 使用 React、Vite 与 TypeScript。`app` 拥有启动、账号门禁、Provider、恢复协调、Router、顶部资产栏、全局弹窗和五个主导航壳层；`pages` 是跨领域 UI 的唯一组合层；`domains` 只拥有本领域 UI 与实际使用的类型；`workflows` 管理会话、操作、支付与 Mint 恢复；`platform` 封装 Telegram、TON、HTTP 与 React Query；`shared` 保存跨领域纯 UI。

Web 只导入 `@pokepets/api-contracts/app`。领域 UI 不导入其他领域，库存页组合库存、进化和分解，任务页组合任务和邀请，市场页组合市场和 VIP。

Telegram WebApp 在 `createRoot().render()` 前按 `ready → expand → disableVerticalSwipes → requestFullscreen` 同步初始化，不显示项目确认弹窗；内容区域下滑不能最小化或关闭主 Mini App，页面自身纵向滚动保持可用，Telegram 标题栏仍保留最小化和关闭能力。不支持垂直滑动控制的旧客户端继续使用客户端原生行为；原生全屏不可用时静默保留已展开的最大稳定视口。首帧即写入主题、稳定视口、四边设备安全区、四边内容安全区、Header/Background 和 HTML `theme-color`；运行中继续监听主题、安全区、视口和全屏事件。主壳层以设备顶部安全区与 Telegram 内容顶部安全区的较大值统一定位唯一的全局顶部资产栏和页面内容起点，确保资产栏位于 Telegram 原生头部控件下方；依赖可用高度的页面使用同一顶部值。TON Connect Provider 只在 Wallet 弹窗和 Mint 页面加载。普通页面启动不下载或初始化钱包能力。访问令牌只保存在 JavaScript 运行内存中，页面重载后重新使用 Telegram `initData` 交换。

正式藏品图片由仓库内 210 张非公开母版生成 420 张版本化 WebP。列表只读取 256×256 缩略图，主视觉和 NFT 元数据读取 768×768 详情图；浏览器不通过 Function 或 Supabase 读取图片二进制。

## Monster Tamer 嵌入式运行时

`apps/web/src/domains/monster-tamer` 在游戏页首位渲染启动卡片，并在当前 React 树内打开 native modal 全屏覆盖层。游戏页组合顺序固定为 `Monster Tamer → Expedition → Wheel`；关闭覆盖层只卸载游戏运行时，不重建远征或转盘。

覆盖层先通过统一 API client 获取已验证的 bootstrap，再延迟加载 Phaser 3.60.0。React 负责准备页、真实藏品、队伍、HUD、小地图、背包、错误状态、Telegram BackButton 和 API；Phaser 负责八张 64px 网格 Tilemap、移动、碰撞、可见敌人、相机与战斗表现。二者只通过带类型的 bridge 交换服务端快照和动作意图。Phaser 不接收 access token、session、用户 ID、API client 或 Supabase client。

每个区域按进入时创建、离开时销毁，目录缩略图与详情图只按当前地图和战斗按需加载。打开 React 面板、切到后台、会话 generation 变化或覆盖层关闭时立即停止世界输入；卸载时销毁 Phaser、监听器、动态纹理和音频。游戏进度不写浏览器持久存储，跨设备恢复只读取服务端权威进度。

## Functions

根目录 `api/app.ts`、`api/integrations.ts`、`api/jobs.ts` 是三个薄适配器，只创建 `@pokepets/api/entrypoints` 网关。每个 entrypoint 显式注入本网关的 route registry 与完整 handler map；三个 registry 互不导入。请求按“网关认证、路由匹配、会话认证、入口交接门禁、契约输入解析、领域查询或工作流、契约输出解析、标准信封”执行。只有 `referral.bind` 和 `operations.get` 声明 `allowPendingEntryHandoff`。

`apps/api/domains` 不跨领域组合业务，每个 handler 只完成输入映射并调用一个 RPC；支付、退款、Mint 对账、定时任务和操作恢复进入 `apps/api/workflows`。Functions 不计算价格、奖励、库存、资产归属或最终交易结果。

契约包 `/app`、`/integrations`、`/jobs` 分别服务三个网关；`/server` 只用于 OpenAPI 与服务端静态校验；`/common` 提供不加载路由注册表的信封、错误和基础路由类型。

## 部署

Web、嵌入式 Monster Tamer 与三个 Functions 位于同一 Vercel Pro Project，Functions 运行时为 Node.js 24。`/monster-tamer` 与 `/monster-tamer/` 由 SPA catch-all 接管并在统一账号门禁后回到 `/game`，仓库不发布独立游戏文档。版本化藏品静态资源使用一年 immutable 缓存，已发布目录不可覆盖。普通构建构建 API 契约、API 与包含 Phaser 延迟 chunk 的 Web；`contracts/ton` 使用独立 `pnpm chain:build` 门禁。真实开发环境与未来生产环境使用同一 Git commit 和迁移序列。
